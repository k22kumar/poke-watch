// Polygon height against the tile surface (I3 review item 3; ROADMAP F78). With no detail mesh a polygon's floor is read
// from its own vertices (NavGraph.heightAt), so it can lie off the ground it covers (a polygon spanning flat ground and a
// ramp's foot). For every adapter map (the 28 sources of tests/worldmodel.test.ts) and every width group this samples a
// 0.25 m lattice on each standable tile surface (World.height: ground, stairs, low props, bridges; the deck where a
// location map has one), locates the point on the group's navmesh with its feet on that surface (no snap) and records
// |polygon floor - surface|. Water and wall tiles are skipped; points off the eroded navmesh are not counted.
//   npx tsx scripts/navheight.ts [--worst] [--detour [--detail <sampleDist m>,<sampleMaxError m>]]
// --detour: read the floor with Detour's own query instead (dtNavMeshQuery::findNearestPoly, half extents 0.01 m in plan
// and rules.nav.layer up and down: the nearest polygon's height at the point, from its detail mesh when one is built),
// to compare a build with a detail mesh (--detail) against one without on equal terms
import { initNavNode } from '../src/nav/node';
import { NavWorld, GROUPS, groupsOf, navConfig } from '../src/nav/world';
import { NavSoup, NavTiles, type NavConfig } from '../src/nav/build';
import { recast } from '../src/nav/recast';
import { defaultRules, type Rules } from '../src/rules/defaults';
import { BIOMES } from '../src/rules/stages';
import { HABITATS } from '../src/world/habitat/recipes';
import { LOCATIONS } from '../src/world/locations';
import { World } from '../src/sim/world';
import { T } from '../src/world/tiles';
import { fromArenaMap } from '../src/world/adapter';

await initNavNode();
const worst = process.argv.includes('--worst'), detour = process.argv.includes('--detour');
const arg = (k: string, d: string) => (process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : d);
const det = arg('--detail', ''), [sd, se] = det.split(',').map(Number);
/** the group's floor under (x, z) for feet at y into P[1]: NavGraph's (NavWorld.locate, no snap) or Detour's */
type Floor = (G: number, x: number, y: number, z: number) => boolean;
const gen = (loc: string): Rules => ({ ...defaultRules, worldgen: { ...defaultRules.worldgen, mode: 'generated' as const, locations: { meadow: loc } } }) as Rules;
const sources: { name: string; rules: Rules; seed: number }[] = [{ name: 'range', rules: { ...defaultRules, worldgen: { ...defaultRules.worldgen, arena: 'range' } } as Rules, seed: 1 }];
for (const [id, r] of Object.entries(HABITATS)) for (const v of ['', ...Object.keys(r.variants)]) for (const seed of [1, 3]) { const loc = v ? `${id}:${v}` : id; sources.push({ name: `${loc}@${seed}`, rules: gen(loc), seed }); }
for (const id of Object.keys(LOCATIONS)) sources.push({ name: `${id}@1`, rules: gen(id), seed: 1 });

const q = (a: Float64Array, p: number) => a[Math.min(a.length - 1, Math.floor(p * a.length))];
const all: number[][] = GROUPS.map(() => []);
const P = new Float64Array(3);
let worstAt = GROUPS.map(() => ({ e: 0, at: '' }));
for (const S of sources) {
  const W = new World(S.rules, BIOMES.meadow, S.seed), m = W.map, half = W.half;
  const model = fromArenaMap(m);
  let floor: Floor, done: () => void;
  if (!detour) {
    const N = NavWorld.build(model, S.rules);
    floor = (G, x, y, z) => N.locate(G, x, y, z, 0, P) >= 0;
    done = () => N.dispose();
  } else {
    const cfg: NavConfig = { ...navConfig(S.rules), ...(det ? { detail: { sampleDist: sd, sampleMaxError: se } } : {}) };
    const Tl = new NavTiles(new NavSoup(model, cfg.inset), cfg, groupsOf(S.rules, [], true));
    Tl.buildAll();
    const R = recast(), Q = Tl.groups.map((g) => new R.NavMeshQuery(g.navMesh)), ext = { x: 0.01, y: S.rules.nav.layer, z: 0.01 };
    floor = (G, x, y, z) => {
      const r = Q[G].findNearestPoly({ x, y, z }, { halfExtents: ext });
      if (!r.success || !r.nearestRef || r.isOverPoly === false) return false;
      P[1] = r.nearestPoint.y;
      return true;
    };
    done = () => { for (const q of Q) q.destroy(); Tl.dispose(); };
  }
  const row: string[] = [];
  try {
    GROUPS.forEach((name, G) => {
      const errs: number[] = [];
      for (let j = 0; j < m.h; j++) for (let i = 0; i < m.w; i++) {
        const k = j * m.w + i;
        if (m.wall[k] || m.terrain[k] === T.water || m.terrain[k] === T.void) continue;
        for (let sj = 0; sj < 4; sj++) for (let si = 0; si < 4; si++) {
          const x = i - half + 0.125 + 0.25 * si, z = j - half + 0.125 + 0.25 * sj;
          const surfaces = [W.height(x, z)];
          if (m.over && m.over[k] > 0) surfaces.push(m.over[k]);
          for (const s of surfaces) {
            if (!floor(G, x, s, z)) continue;
            const e = Math.abs(P[1] - s);
            errs.push(e);
            if (e > worstAt[G].e) worstAt[G] = { e, at: `${S.name} (${x.toFixed(2)}, ${z.toFixed(2)}) surface ${s.toFixed(3)} polygon ${P[1].toFixed(3)}` };
          }
        }
      }
      const E = Float64Array.from(errs).sort();
      for (const e of errs) all[G].push(e);
      row.push(`${name} n ${E.length} p99 ${q(E, 0.99).toFixed(3)} max ${E[E.length - 1].toFixed(3)}`);
    });
  } finally { done(); }
  console.log(`${S.name.padEnd(28)} ${row.join('  ')}`);
}
console.log('\nevery adapter map (m):');
GROUPS.forEach((name, G) => {
  const E = Float64Array.from(all[G]).sort();
  console.log(`  ${name.padEnd(6)} samples ${E.length}  p50 ${q(E, 0.5).toFixed(3)}  p99 ${q(E, 0.99).toFixed(3)}  p99.9 ${q(E, 0.999).toFixed(3)}  max ${E[E.length - 1].toFixed(3)}  over 0.6 m: ${E.filter((e) => e > 0.6).length}`);
  if (worst) console.log(`    worst: ${worstAt[G].at}`);
});
