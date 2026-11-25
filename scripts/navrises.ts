// The climb census (I3 review item 2; rules.nav.recastClimb): every rise between 4-adjacent walkable tile tops (elev +
// platform; walls and stairs excluded: S1 §7's method) over the 28 map sources of tests/worldmodel.test.ts, binned, and
// for each rise in (0.5, 0.65] m whether the narrow navmesh joins its two tiles at the build's climb: a string-pulled
// path from one tile's centre to the other's of at most 1.5 m (a route round counts as not joined).
//   npx tsx scripts/navrises.ts [--ch <m>] [--climb <cells>] [--group narrow|large|xl|all] [--list]
// --ch: another cell height, every vertical count derived from its physical size (scripts/lib/navcells.ts); --climb:
// Recast's build climb (default one cell under the step). A group's rise counts where both tile centres are on its
// navmesh; `off` counts the rest (eroded, water). Bins: (0.5, 0.55], (0.55, 0.6], (0.6, 0.65] m, and exactly 0.6 m.
import { initNavNode } from '../src/nav/node';
import { NavWorld } from '../src/nav/world';
import { defaultRules, type Rules } from '../src/rules/defaults';
import { BIOMES } from '../src/rules/stages';
import { HABITATS } from '../src/world/habitat/recipes';
import { LOCATIONS } from '../src/world/locations';
import { World } from '../src/sim/world';
import { fromArenaMap } from '../src/world/adapter';
import { withNavCells } from './lib/navcells';
import { GROUPS } from '../src/nav/world';

await initNavNode();
const arg = (k: string, d: string) => (process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : d);
const ch = Number(arg('--ch', String(defaultRules.nav.ch))), climbArg = process.argv.includes('--climb') ? Number(arg('--climb', '0')) : undefined;
const list = process.argv.includes('--list'), only = arg('--group', 'narrow');
const gen = (loc: string): Rules => ({ ...defaultRules, worldgen: { ...defaultRules.worldgen, mode: 'generated' as const, locations: { meadow: loc } } }) as Rules;
const sources: { name: string; rules: Rules; seed: number }[] = [{ name: 'range', rules: { ...defaultRules, worldgen: { ...defaultRules.worldgen, arena: 'range' } } as Rules, seed: 1 }];
for (const [id, r] of Object.entries(HABITATS)) for (const v of ['', ...Object.keys(r.variants)]) for (const seed of [1, 3]) { const loc = v ? `${id}:${v}` : id; sources.push({ name: `${loc}@${seed}`, rules: gen(loc), seed }); }
for (const id of Object.keys(LOCATIONS)) sources.push({ name: `${id}@1`, rules: gen(id), seed: 1 });

/** rise bins (m): the sim climbs every rise <= rules.player.stepHeight (0.6) and refuses every one above */
const BINS: { name: string; test: (r: number) => boolean; valid: boolean }[] = [
  { name: '(0.50, 0.55]', test: (r) => r > 0.5 + 1e-5 && r <= 0.55 + 1e-5, valid: true },
  { name: '(0.55, 0.58]', test: (r) => r > 0.55 + 1e-5 && r <= 0.58 + 1e-5, valid: true },
  { name: '(0.58, 0.60)', test: (r) => r > 0.58 + 1e-5 && r < 0.6 - 1e-5, valid: true },
  { name: '0.60', test: (r) => Math.abs(r - 0.6) <= 1e-5, valid: true },
  { name: '(0.60, 0.65]', test: (r) => r > 0.6 + 1e-5 && r <= 0.65 + 1e-5, valid: false },
];
const groups = only === 'all' ? [...GROUPS] : [only];
type Tally = { n: number; joined: number; off: number };
const tot = groups.map(() => BINS.map((): Tally => ({ n: 0, joined: 0, off: 0 })));
const P = new Float64Array(3);
let climbUsed = 0;
for (const S of sources) {
  const rules = withNavCells(S.rules, ch, climbArg);
  climbUsed = rules.nav.recastClimb;
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
      const rise = Math.abs(top(k) - top(q)), bin = BINS.findIndex((b) => b.test(rise));
      if (bin < 0) continue;
      const [lo, hi] = top(k) < top(q) ? [k, q] : [q, k];
      pairs.push({ a: lo, b: hi, rise, bin });
    }
  }
  if (!pairs.length) { console.log(`${S.name.padEnd(28)} no rises in (0.5, 0.65]`); continue; }
  const N = NavWorld.build(fromArenaMap(m), rules);
  const row: string[] = [];
  try {
    groups.forEach((gname, gi) => {
      const G = N.group(gname), Gr = N.graphs[G], per = BINS.map((): Tally => ({ n: 0, joined: 0, off: 0 }));
      for (const p of pairs) {
        const ax = (p.a % m.w) - half + 0.5, az = ((p.a / m.w) | 0) - half + 0.5, bx = (p.b % m.w) - half + 0.5, bz = ((p.b / m.w) | 0) - half + 0.5;
        const F = N.field(G, `rise${p.b}`, bx, top(p.b), bz, 0);
        const pa = N.locate(G, ax, top(p.a), az, 0, P);
        const T = per[p.bin];
        if (!F || F.goal < 0 || pa < 0) { T.off++; continue; }
        T.n++;
        let joined = false, why = 'not reached at all';
        if (F.cost[pa] < Infinity) {
          const pts = Gr.straight(F, pa, ax, az);
          let len = 0, x = ax, z = az;
          for (const [px, pz] of pts) { len += Math.hypot(px - x, pz - z); x = px; z = pz; }
          const end = pts[pts.length - 1];
          joined = !!end && Math.abs(end[0] - bx) < 1e-6 && Math.abs(end[1] - bz) < 1e-6 && len <= 1.5;
          if (!joined) why = `route ${len.toFixed(1)} m round`;
        }
        if (joined) T.joined++;
        const at = `${S.name} ${gname} rise ${p.rise.toFixed(4)} m tiles ${p.a % m.w},${(p.a / m.w) | 0} -> ${p.b % m.w},${(p.b / m.w) | 0}`;
        if (list && !joined && BINS[p.bin].valid) console.log(`  CUT ${at}: ${why}`);
        if (joined && !BINS[p.bin].valid) console.log(`  JOINED INVALID ${at}`);
      }
      per.forEach((v, i) => { tot[gi][i].n += v.n; tot[gi][i].joined += v.joined; tot[gi][i].off += v.off; });
      row.push(`${gname} ` + per.map((v) => `${v.joined}/${v.n}`).join(' '));
    });
  } finally { N.dispose(); }
  console.log(`${S.name.padEnd(28)} ${row.join('  ')}`);
}
console.log(`\nch ${ch} m, climb ${climbUsed} cells; joined / rises with both tile centres on the group's navmesh (off: either off it)`);
console.log('  ' + 'group'.padEnd(7) + BINS.map((b) => b.name.padStart(18)).join(''));
groups.forEach((g, gi) => console.log('  ' + g.padEnd(7) + tot[gi].map((v) => `${v.joined}/${v.n} off ${v.off}`.padStart(18)).join('')));
