// Recast build timing (task I3; docs/OVERHAUL_3D.md "Navigation (I3)"): builds every width group's tiled navmesh for
// adapter maps and prints per-map and per-group times against WORLDGEN3D Q20.2's run-start target (a curated seed's
// p95 <= 250 ms for everything).
//   npx tsx scripts/navbench.ts [map|all] [seed] [--repeat N] [--tile <cells>] [--group narrow|large|xl|giant]
// map: 'range', a habitat id (river-gorge, ...) or a location id; default river-gorge seed 1. Times are the median and
// p95 of N runs after one warm-up (default 7), split into the adapter (fromArenaMap), the soup and each group's tiles.
import { initNavNode } from '../src/nav/node';
import { NavTiles, NavSoup, navClock, type NavConfig } from '../src/nav/build';
import { defaultRules, type Rules } from '../src/rules/defaults';
import { BIOMES } from '../src/rules/stages';
import { HABITATS } from '../src/world/habitat/recipes';
import { LOCATIONS } from '../src/world/locations';
import { World } from '../src/sim/world';
import { fromArenaMap } from '../src/world/adapter';
import { navConfig } from '../src/nav/world';

await initNavNode();
navClock.now = () => performance.now();
const arg = (k: string, d: string) => (process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : d);
const pos = process.argv.slice(2).filter((a, i, A) => !a.startsWith('--') && !(i > 0 && A[i - 1].startsWith('--')));
const which = pos[0] ?? 'river-gorge', seed = Number(pos[1] ?? 1), repeat = Number(arg('--repeat', '7'));
const tile = Number(arg('--tile', String(defaultRules.nav.tileSize))), only = arg('--group', '');

function rulesFor(id: string): Rules {
  if (id === 'range') return { ...defaultRules, worldgen: { ...defaultRules.worldgen, arena: 'range' } } as Rules;
  return { ...defaultRules, worldgen: { ...defaultRules.worldgen, mode: 'generated' as const, locations: { meadow: id } } } as Rules;
}
const ids = which === 'all' ? ['range', ...Object.keys(HABITATS), ...Object.keys(LOCATIONS)] : [which];
const q = (a: number[], p: number) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };

for (const id of ids) {
  const rules = rulesFor(id), W = new World(rules, BIOMES.meadow, seed);
  const cfg: NavConfig = { ...navConfig(rules), tileSize: tile };
  const all = [...Object.entries(rules.nav.groups).map(([name, agent]) => ({ name, agent })), { name: 'giant', agent: { radius: rules.nav.groups.xl.radius, height: rules.nav.giantHeight } }];
  const groups = only ? all.filter((g) => g.name === only) : all.slice(0, 3);
  const T: Record<string, number[]> = { adapter: [], soup: [], tiles: [], total: [] };
  let info = '', grid = '';
  for (const k of Object.keys(navClock.stages)) delete navClock.stages[k];
  for (let r = 0; r <= repeat; r++) {
    if (r === 1) for (const k of Object.keys(navClock.stages)) delete navClock.stages[k];
    const t0 = performance.now();
    const model = fromArenaMap(W.map);
    const t1 = performance.now();
    const soup = new NavSoup(model, cfg.inset);
    soup.vertsArray();
    const t2 = performance.now();
    const N = new NavTiles(soup, cfg, groups);
    N.buildAll();
    const t3 = performance.now();
    info = `${soup.walkCount} walkable + ${soup.solidCount} solid triangles; ` + N.groups.map((g) => `${g.name} ${g.polys.reduce((x, y) => x + y, 0)} polys`).join(', ');
    grid = `${N.tw} x ${N.th} tiles`;
    N.dispose();
    if (r > 0) { T.adapter.push(t1 - t0); T.soup.push(t2 - t1); T.tiles.push(t3 - t2); T.total.push(t3 - t0); }
  }
  console.log(`${id} seed ${seed}: ${W.map.w} x ${W.map.h} m, tile ${tile} cells (${(tile * cfg.cs).toFixed(1)} m, ${grid}); ${info}`);
  for (const [k, v] of Object.entries(T)) console.log(`  ${k.padEnd(8)} median ${q(v, 0.5).toFixed(1)} ms  p95 ${q(v, 0.95).toFixed(1)} ms`);
  console.log('  stages (mean per build, ms): ' + Object.entries(navClock.stages).map(([k, v]) => `${k} ${(v / repeat).toFixed(1)}`).join(', '));
}
