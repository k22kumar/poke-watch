// Trunk tops a body can stand on (owner, 2026-11-27, docs/looksheet "Trunk"): per current map, every face the tile
// adapter gives the `trunk` role that faces up, split by what stands under it, and whether a body can stand on it on
// the tile model and on the navmesh.
//   low prop   a stump, log or bench (PROP_RULES platform): the adapter's walkable navInput face; World.height is its
//              top, so the tile model stands bodies on it; checked on the narrow group's navmesh at the top's centre
//   wall prop  a tree, fence, sign, cabin or elder (PROP_RULES wall + top): no navInput face; the tile model stands a
//              body on it only with R1b's crossing permission, which no driver grants (sim/locomotion.ts `over`), and the
//              physics seam stands its column to the sky for movement (sim/physseam.ts pass 1): not standable today
// The 3D range is G1a's and not built yet, so it has no trunk to count.
// npx tsx scripts/trunktops.ts [seeds=5] [--json]
import { RN } from '../tests/setup/nav';
import { defaultRules } from '../src/rules/defaults';
import { fromArenaMap } from '../src/world/adapter';
import { getArena } from '../src/world/arenas';
import { generateHabitat } from '../src/world/habitat';
import { HABITATS } from '../src/world/habitat/recipes';
import { LOCATIONS } from '../src/world/locations';
import { generateLocation } from '../src/world/locgen';
import { PROP_RULES, type ArenaMap } from '../src/world/tiles';
import { PROP_MATERIALS } from '../src/rules/surfaces';
import { NavWorld } from '../src/nav/world';
void RN;

const SEEDS = Number(process.argv.find((a) => /^\d+$/.test(a)) ?? 5);
const rules = defaultRules;

interface Row { map: string; seed: number | null; lowProps: Record<string, number>; wallProps: Record<string, number>; lowTops: number; lowTopsOnNavmesh: number; wallTops: number }

function count(id: string, seed: number | null, m: ArenaMap): Row {
  const lowProps: Record<string, number> = {}, wallProps: Record<string, number> = {};
  for (const p of m.props) {
    if (PROP_MATERIALS[p.kind]?.mat !== 'wood') continue;
    const R = PROP_RULES[p.kind];
    if (R.wall) wallProps[p.kind] = (wallProps[p.kind] ?? 0) + 1;
    else if (R.platform) lowProps[p.kind] = (lowProps[p.kind] ?? 0) + 1;
  }
  const model = fromArenaMap(m), floor = model.bounds.min[1];
  const trunks = model.colliders.filter((c) => c.shape === 'box' && c.role === 'trunk') as Extract<(typeof model.colliders)[number], { shape: 'box' }>[];
  const low = trunks.filter((c) => c.centre[1] - c.half[1] > floor + 1e-6), wall = trunks.filter((c) => !(c.centre[1] - c.half[1] > floor + 1e-6));
  let onNav = 0;
  if (low.length) {
    const nav = NavWorld.build(model, rules), g = nav.group('narrow'), out = new Float64Array(3);
    for (const c of low) {
      const top = c.centre[1] + c.half[1];
      const poly = nav.locate(g, c.centre[0], top, c.centre[2], 0.05, out);
      if (poly >= 0 && Math.abs(out[1] - top) < 0.15 && Math.abs(out[0] - c.centre[0]) < 0.05 && Math.abs(out[2] - c.centre[2]) < 0.05) onNav++;
    }
    nav.dispose();
  }
  return { map: id, seed, lowProps, wallProps, lowTops: low.length, lowTopsOnNavmesh: onNav, wallTops: wall.length };
}

const rows: Row[] = [];
for (const a of ['range', 'meadow', 'badlands', 'frost', 'dusk']) rows.push(count(`arena:${a}`, null, getArena(a)));
for (const id of Object.keys(LOCATIONS)) for (let s = 1; s <= SEEDS; s++) rows.push(count(`location:${id}`, s, generateLocation({ location: id, seed: s, size: rules.worldgen.size })));
for (const id of Object.keys(HABITATS)) for (let s = 1; s <= SEEDS; s++) rows.push(count(`habitat:${id}`, s, generateHabitat({ recipe: id, seed: s, size: rules.worldgen.size })));

if (process.argv.includes('--json')) console.log(JSON.stringify(rows));
else for (const r of rows) {
  const f = (o: Record<string, number>) => Object.entries(o).map(([k, v]) => `${k} ${v}`).join(', ') || '-';
  console.log(`${(r.map + (r.seed === null ? '' : ` s${r.seed}`)).padEnd(34)} standable tops ${String(r.lowTops).padStart(3)} (navmesh ${String(r.lowTopsOnNavmesh).padStart(3)})  [${f(r.lowProps)}]   wall tops ${String(r.wallTops).padStart(3)} [${f(r.wallProps)}]`);
}
process.exit(0);
