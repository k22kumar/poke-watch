// The climb census (I3 review item 2; rules.nav.recastClimb): every rise between 4-adjacent walkable tile tops (elev +
// platform; walls and stairs excluded: S1 §7's method) over the 28 map sources of tests/worldmodel.test.ts, binned, and
// for each rise in (0.5, 0.65] m whether the narrow navmesh joins its two tiles at the build's climb: a string-pulled
// path from one tile's centre to the other's of at most 1.5 m (a route round counts as not joined).
//   npx tsx scripts/navrises.ts [--climb <cells>] [--ch 0.05|0.025|0.01] [--list]
// --ch: a finer cell height for the comparison, every height count scaled by 0.05 / ch (climb 12 at 0.05 is 60 at 0.01)
import { initNavNode } from '../src/nav/node';
import { NavWorld } from '../src/nav/world';
import { defaultRules, type Rules } from '../src/rules/defaults';
import { BIOMES } from '../src/rules/stages';
import { HABITATS } from '../src/world/habitat/recipes';
import { LOCATIONS } from '../src/world/locations';
import { World } from '../src/sim/world';
import { fromArenaMap } from '../src/world/adapter';

await initNavNode();
const arg = (k: string, d: string) => (process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : d);
const ch = Number(arg('--ch', String(defaultRules.nav.ch))), scale = Math.round(defaultRules.nav.ch / ch);
if (Math.abs(scale * ch - defaultRules.nav.ch) > 1e-12) throw new Error('--ch must divide 0.05');
const climb = Number(arg('--climb', String(defaultRules.nav.recastClimb * scale))), list = process.argv.includes('--list');
const G0 = defaultRules.nav.groups, sc = (a: { radius: number; height: number }) => ({ radius: a.radius, height: a.height * scale });
const gen = (loc: string): Rules => ({ ...defaultRules, worldgen: { ...defaultRules.worldgen, mode: 'generated' as const, locations: { meadow: loc } } }) as Rules;
const sources: { name: string; rules: Rules; seed: number }[] = [{ name: 'range', rules: { ...defaultRules, worldgen: { ...defaultRules.worldgen, arena: 'range' } } as Rules, seed: 1 }];
for (const [id, r] of Object.entries(HABITATS)) for (const v of ['', ...Object.keys(r.variants)]) for (const seed of [1, 3]) { const loc = v ? `${id}:${v}` : id; sources.push({ name: `${loc}@${seed}`, rules: gen(loc), seed }); }
for (const id of Object.keys(LOCATIONS)) sources.push({ name: `${id}@1`, rules: gen(id), seed: 1 });

const BINS: [number, number][] = [[0.5, 0.55], [0.55, 0.6], [0.6, 0.65]];
const tot = BINS.map(() => ({ n: 0, joined: 0 }));
const exact = new Map<string, number>();
const P = new Float64Array(3);
for (const S of sources) {
  const rules = { ...S.rules, nav: { ...S.rules.nav, ch, recastClimb: climb, walkableClimb: defaultRules.nav.walkableClimb * scale, giantHeight: defaultRules.nav.giantHeight * scale, groups: { narrow: sc(G0.narrow), large: sc(G0.large), xl: sc(G0.xl) } } } as Rules;
  const W = new World(rules, BIOMES.meadow, S.seed), m = W.map, half = W.half;
  const top = (k: number) => m.elev[k] + m.platform[k];
  const ok = (k: number) => !m.wall[k] && !m.stairs[k];
  const pairs: { a: number; b: number; rise: number; bin: number }[] = [];
  for (let j = 0; j < m.h; j++) for (let i = 0; i < m.w; i++) {
    const k = j * m.w + i;
    if (!ok(k)) continue;
    for (const [di, dj] of [[1, 0], [0, 1]]) {
      if (i + di >= m.w || j + dj >= m.h) continue;
      const q = (j + dj) * m.w + i + di;
      if (!ok(q)) continue;
      const rise = Math.abs(top(k) - top(q)), bin = BINS.findIndex(([lo, hi]) => rise > lo + 1e-9 && rise <= hi + 1e-9);
      if (bin < 0) continue;
      const [lo, hi] = top(k) < top(q) ? [k, q] : [q, k];
      pairs.push({ a: lo, b: hi, rise, bin });
      if (bin === 2) exact.set(rise.toFixed(3), (exact.get(rise.toFixed(3)) ?? 0) + 1);
    }
  }
  if (!pairs.length) { console.log(`${S.name.padEnd(28)} no rises in (0.5, 0.65]`); continue; }
  const N = NavWorld.build(fromArenaMap(m), rules);
  const per = BINS.map(() => ({ n: 0, joined: 0 }));
  try {
    const G = N.group('narrow'), Gr = N.graphs[G];
    for (const p of pairs) {
      const ax = (p.a % m.w) - half + 0.5, az = ((p.a / m.w) | 0) - half + 0.5, bx = (p.b % m.w) - half + 0.5, bz = ((p.b / m.w) | 0) - half + 0.5;
      const F = N.field(G, `rise${p.b}`, bx, top(p.b), bz, 0);
      const pa = N.locate(G, ax, top(p.a), az, 0, P);
      let joined = false, why = '';
      if (!F || F.goal < 0) why = 'upper tile centre off the narrow navmesh';
      else if (pa < 0) why = 'lower tile centre off the narrow navmesh';
      else if (!(F.cost[pa] < Infinity)) why = 'not reached at all';
      else {
        const pts = Gr.straight(F, pa, ax, az);
        let len = 0, x = ax, z = az;
        for (const [px, pz] of pts) { len += Math.hypot(px - x, pz - z); x = px; z = pz; }
        const end = pts[pts.length - 1];
        joined = !!end && Math.abs(end[0] - bx) < 1e-6 && Math.abs(end[1] - bz) < 1e-6 && len <= 1.5;
        if (!joined) why = `route ${len.toFixed(1)} m round`;
      }
      per[p.bin].n++; if (joined) per[p.bin].joined++;
      if (!joined && p.bin < 2 && list) console.log(`  NOT JOINED ${S.name} rise ${p.rise.toFixed(3)} m tiles ${p.a % m.w},${(p.a / m.w) | 0} -> ${p.b % m.w},${(p.b / m.w) | 0}: ${why}`);
      if (joined && p.bin === 2 && list) console.log(`  JOINED > 0.6 ${S.name} rise ${p.rise.toFixed(3)} m tiles ${p.a % m.w},${(p.a / m.w) | 0} -> ${p.b % m.w},${(p.b / m.w) | 0}`);
    }
  } finally { N.dispose(); }
  per.forEach((v, i) => { tot[i].n += v.n; tot[i].joined += v.joined; });
  console.log(`${S.name.padEnd(28)} ` + BINS.map(([lo, hi], i) => `(${lo}, ${hi}] ${per[i].joined}/${per[i].n}`).join('  '));
}
console.log(`\nch ${ch} m, climb ${climb} cells; joined / rises:`);
BINS.forEach(([lo, hi], i) => console.log(`  (${lo}, ${hi}] m  ${tot[i].joined}/${tot[i].n}`));
console.log('  rises in (0.6, 0.65] by value: ' + [...exact].sort().map(([k, v]) => `${k} m x${v}`).join(', '));
