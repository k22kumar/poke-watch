// What a giant at the 3.57 m draw cap would lose on the navmesh (task I3; WORLDGEN3D Q7: the 2.4 m deck gap fault). The
// Extra Large group's agent is 56 cells tall (Onix, 2.78 m); a giant at the cap is 72 cells (rules.nav.giantHeight,
// 3.60 m). For every adapter map this builds both and lists the targets the Extra Large navmesh reaches from the start
// and the giant's does not, and the walkable area only the shorter agent has. A report, not a gate (the brief's rule).
//   npx tsx scripts/navgiant.ts [seeds] [firstSeed]
import { initNavNode } from '../src/nav/node';
import { NavWorld } from '../src/nav/world';
import { defaultRules, type Rules } from '../src/rules/defaults';
import { BIOMES } from '../src/rules/stages';
import { HABITATS } from '../src/world/habitat/recipes';
import { LOCATIONS } from '../src/world/locations';
import { World } from '../src/sim/world';
import { fromArenaMap } from '../src/world/adapter';

await initNavNode();
const N0 = Number(process.argv[2] ?? 5), first = Number(process.argv[3] ?? 1);
const rulesFor = (id: string, seed: number): Rules => ({ ...defaultRules, worldgen: { ...defaultRules.worldgen, mode: 'generated' as const, regionSeed: seed, locations: { meadow: id } } }) as Rules;
const giant = { name: 'giant', agent: { radius: defaultRules.nav.groups.xl.radius, height: defaultRules.nav.giantHeight } };
let lost = 0, lostMandatory = 0, checked = 0;
for (const id of [...Object.keys(HABITATS), ...Object.keys(LOCATIONS)]) for (let s = first; s < first + N0; s++) {
  const rules = rulesFor(id, s), W = new World(rules, BIOMES.meadow, s), half = W.half;
  const N = NavWorld.build(fromArenaMap(W.map), rules, [giant]);
  try {
    const xl = N.group('xl'), gi = N.group('giant'), P = new Float64Array(3);
    // the start: a Hold's team B staging (where Raiders leave), a location's hub
    const L = W.map.gen?.loc, hub = L?.zones.find((z) => z.kind === 'hub');
    const [sx, sz] = W.hab ? [W.hab.stage.B[0] - half, W.hab.stage.B[1] - half] : hub ? [Math.floor(hub.x) - half + 0.5, Math.floor(hub.y) - half + 0.5] : W.spawn;
    const targets: { name: string; x: number; z: number; mandatory: boolean }[] = [];
    if (W.hab) targets.push({ name: 'contest', x: W.hab.contest.x - half, z: W.hab.contest.y - half, mandatory: true }, { name: 'spawn', x: W.spawn[0], z: W.spawn[1], mandatory: true });
    for (const z of L?.zones ?? []) if (z.kind !== 'hub' && z.kind !== 'entrance') targets.push({ name: z.kind + z.id, x: Math.floor(z.x) - half + 0.5, z: Math.floor(z.y) - half + 0.5, mandatory: z.kind === 'boss' || z.kind === 'arena' });
    const Fx = N.field(xl, 'start', sx, W.height(sx, sz), sz, 4), Fg = N.field(gi, 'start', sx, W.height(sx, sz), sz, 4);
    for (const t of targets) {
      const y = W.height(t.x, t.z), a = N.reaches(xl, Fx, t.x, y, t.z, 3), b = N.reaches(gi, Fg, t.x, y, t.z, 3);
      if (!a) continue;
      checked++;
      if (!b) { lost++; if (t.mandatory) lostMandatory++; console.log(`LOST ${id} seed ${s} ${t.name}${t.mandatory ? ' (mandatory)' : ''}: the Extra Large navmesh reaches it, a giant at the cap does not`); }
    }
    // walkable area (m²) on the Extra Large navmesh with no giant polygon over it, sampled on a 0.5 m lattice
    let only = 0;
    for (let z = -half + 0.25; z < half; z += 0.5) for (let x = -half + 0.25; x < half; x += 0.5) {
      const p = N.locate(xl, x, undefined, z, 0, P);
      if (p < 0) continue;
      if (N.locate(gi, x, P[1], z, 0, P) < 0) only += 0.25;
    }
    if (only > 0) console.log(`  ${id} seed ${s}: ${only.toFixed(0)} m² Extra Large ground a giant cannot stand on (under decks)`);
  } finally { N.dispose(); }
}
console.log(`\n${checked} targets the Extra Large navmesh reaches; a giant at the 3.57 m cap loses ${lost} (${lostMandatory} mandatory)`);
