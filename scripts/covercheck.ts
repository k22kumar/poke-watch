// R1b wall tops: what the finite tops change for cover (docs/SIZING.md "Wall tops", ledger §23 Q6). Report only: it
// changes nothing and gates nothing; the owner reviews it before any art, geometry or validator change.
//   npx tsx scripts/covercheck.ts [seeds] [pairs]        (default 2 seeds per generated map, 400 sampled lines per map)
//
// Per map (the four authored arenas, the three Pokémon locations, the six habitat recipes):
//   census     wall-prop tiles by kind and bare wall tiles (bare walls stay infinite)
//   level      for each size class, the wall props a level shot at its muzzle height clears (top ≤ muzzle): the props
//              that stopped being cover against that class's level fire
//   lines      seeded random lines of fire between open standable tiles 4–20 m apart, from each class's muzzle height to
//              a Medium body's centre (0.6 m): blocked with every wall infinite (as before R1b, and as the map validators
//              still judge it) and with the player's attack policy (QF.tops; foliage open in both, so only the tops
//              differ). `opened` = the share of lines the validators call blocked that the player's shots now pass
//   objective  habitat maps: the lines from each team's staging to the contest centre (+1 m); location maps: from each
//              enemy entry anchor to the spawn. Same two rules, per class
// Only the player's spatial families read the tops (bolt, orb, beam); every planar family, enemy fire and enemy sight are
// unchanged until R4 / R7, so the tables apply to those three families.
import { createRun, startStage } from '../src/sim/run';
import { MASK, QF, segmentClear } from '../src/sim/spatial';
import { Rng } from '../src/core/rng';
import { defaultRules } from '../src/rules/defaults';
import { PROP_RULES, type ArenaPropKind } from '../src/world/tiles';
import type { World } from '../src/sim/world';

const SEEDS = Number(process.argv[2] ?? 2), PAIRS = Number(process.argv[3] ?? 400);
const CLASSES = defaultRules.size.classes.map((c) => ({ id: c.id, muzzle: defaultRules.aim.muzzle.up * c.height }));
const TARGET = 0.6;
const BEFORE = QF.foliage, AFTER = QF.foliage | QF.tops;
/** the low wall props that block shots (hedges and berry bushes are foliage: already open to the player's shots) */
const BARRIERS: ArenaPropKind[] = ['fence', 'sign', 'thicket', 'crystal', 'boulder', 'lantern', 'well'];
const loc = (id: string, seed: number) => ({ worldgen: { mode: 'generated', regionSeed: seed, locations: { meadow: id, dusk: id, badlands: id, frost: id } } });

interface Row { map: string; W: World }
const maps: Row[] = [];
for (let stage = 0; stage < 4; stage++) { const c = createRun({ seed: 1, species: 'cyndaquil' }); if (stage) startStage(c, stage); maps.push({ map: 'authored ' + c.world.map.id, W: c.world }); }
for (const id of ['viridian-forest', 'mt-moon', 'chargestone-cave', 'river-gorge', 'volcanic-ridge', 'forest-cemetery', 'tropical-lagoon', 'tidal-cave', 'spear-sanctuary']) {
  for (let s = 1; s <= SEEDS; s++) {
    try { const c = createRun({ seed: 1, species: 'cyndaquil', ruleOverrides: loc(id, s) as never }); maps.push({ map: c.world.map.id, W: c.world }); }
    catch (e) { console.log(`<!-- ${id} seed ${s}: ${String(e).slice(0, 120)} -->`); }
  }
}

const pct = (a: number, b: number) => (b ? ((100 * a) / b).toFixed(1) + ' %' : '–');
const out: string[] = [];
out.push('### Census and level cover', '', '| map | wall-prop tiles | bare wall tiles | barrier props (count) | Tiny fires over | Small | Medium | Large | Extra Large |', '|---|---|---|---|---|---|---|---|---|');
const lines: string[] = ['### Sampled lines of fire (blocked with walls infinite → opened by tops)', '', '| map | lines | ' + CLASSES.map((c) => `${c.id} (${c.muzzle.toFixed(2)} m)`).join(' | ') + ' | first prop crossed (top 3) |', '|---|---|' + CLASSES.map(() => '---|').join('') + '---|'];
const objective: string[] = ['### Objective sightlines (combat vs the validators\' infinite walls)', '', '| map | line | ' + CLASSES.map((c) => c.id).join(' | ') + ' |', '|---|---|' + CLASSES.map(() => '---|').join('')];
const total = { blocked: CLASSES.map(() => 0), opened: CLASSES.map(() => 0) };

for (const { map, W } of maps) {
  const M = W.map, n = M.w * M.h, T = W.wallTop!;
  // census
  let propTiles = 0, bare = 0;
  for (let k = 0; k < n; k++) if (M.wall[k]) { if (T[k] < Infinity) propTiles++; else bare++; }
  const count = new Map<ArenaPropKind, number>();
  for (const p of M.props) if (BARRIERS.includes(p.kind)) count.set(p.kind, (count.get(p.kind) ?? 0) + 1);
  const fires = CLASSES.map((c) => [...count].filter(([k]) => PROP_RULES[k].top! <= c.muzzle).map(([k, v]) => `${k} ${v}`).join(', ') || '–');
  out.push(`| ${map} | ${propTiles} | ${bare} | ${[...count].map(([k, v]) => `${k} ${v}`).join(', ') || '–'} | ${fires.join(' | ')} |`);
  // sampled lines
  const open: number[] = [];
  for (let k = 0; k < n; k++) if (W.isOpen(k) && !W.isVoid(k) && !(W.over && W.over[k] > 0)) open.push(k);
  const rng = new Rng(0x7a11 ^ n ^ map.length);
  const blocked = CLASSES.map(() => 0), opened = CLASSES.map(() => 0), crossed = new Map<string, number>();
  let tried = 0;
  for (let guard = 0; tried < PAIRS && guard < PAIRS * 50; guard++) {
    const a = open[rng.int(0, open.length - 1)], b = open[rng.int(0, open.length - 1)];
    const ax = (a % M.w) - W.half + 0.5, az = ((a / M.w) | 0) - W.half + 0.5, bx = (b % M.w) - W.half + 0.5, bz = ((b / M.w) | 0) - W.half + 0.5;
    const d = Math.hypot(bx - ax, bz - az);
    if (d < 4 || d > 20) continue;
    tried++;
    const ty = W.topOf(b) + TARGET;
    CLASSES.forEach((c, ci) => {
      const ay = W.topOf(a) + c.muzzle;
      if (segmentClear(W, ax, ay, az, bx, ty, bz, MASK.los, BEFORE)) return;
      blocked[ci]++;
      if (!segmentClear(W, ax, ay, az, bx, ty, bz, MASK.los, AFTER)) return;
      opened[ci]++;
      // the first wall-prop tile the line crosses (sampled at 5 cm)
      for (let s = 1, N = Math.ceil(d / 0.05); s < N; s++) {
        const t = s / N, k = W.tile(ax + (bx - ax) * t, az + (bz - az) * t);
        if (k >= 0 && M.wall[k] && T[k] < Infinity) { const i = k % M.w, j = (k / M.w) | 0; const p = M.props.find((q) => PROP_RULES[q.kind].wall && i >= q.x && i < q.x + q.w && j >= q.y && j < q.y + q.h); crossed.set(p?.kind ?? '?', (crossed.get(p?.kind ?? '?') ?? 0) + 1); break; }
      }
    });
  }
  CLASSES.forEach((_, ci) => { total.blocked[ci] += blocked[ci]; total.opened[ci] += opened[ci]; });
  lines.push(`| ${map} | ${tried} | ${CLASSES.map((_, ci) => `${blocked[ci]} → ${opened[ci]} (${pct(opened[ci], blocked[ci])})`).join(' | ')} | ${[...crossed].sort((x, y) => y[1] - x[1]).slice(0, 3).map(([k, v]) => `${k} ${v}`).join(', ') || '–'} |`);
  // objective sightlines
  const hab = W.hab, L = M.gen?.loc;
  const pairs: { what: string; a: [number, number]; b: [number, number]; by: number }[] = [];
  if (hab) {
    const c: [number, number] = [hab.contest.x - W.half, hab.contest.y - W.half];
    for (const team of ['A', 'B'] as const) pairs.push({ what: `staging ${team} → point`, a: [hab.stage[team][0] - W.half + 0.5, hab.stage[team][1] - W.half + 0.5], b: c, by: 1 });
  } else if (L) {
    L.anchors.forEach(([x, y], i) => pairs.push({ what: `entry ${i + 1} → spawn`, a: [x - W.half + 0.5, y - W.half + 0.5], b: [W.spawn[0], W.spawn[1]], by: TARGET }));
  }
  for (const p of pairs) {
    const ground = (x: number, z: number) => W.height(x, z);
    const cells = CLASSES.map((c) => {
      const ay = ground(p.a[0], p.a[1]) + c.muzzle, by = ground(p.b[0], p.b[1]) + p.by;
      const before = segmentClear(W, p.a[0], ay, p.a[1], p.b[0], by, p.b[1], MASK.los, BEFORE), after = segmentClear(W, p.a[0], ay, p.a[1], p.b[0], by, p.b[1], MASK.los, AFTER);
      return before === after ? (after ? 'open' : 'blocked') : `**${before ? 'open' : 'blocked'} → ${after ? 'open' : 'blocked'}**`;
    });
    objective.push(`| ${map} | ${p.what} | ${cells.join(' | ')} |`);
  }
}
lines.push(`| **all maps** | | ${CLASSES.map((_, ci) => `${total.blocked[ci]} → ${total.opened[ci]} (${pct(total.opened[ci], total.blocked[ci])})`).join(' | ')} | |`);
console.log([...out, '', ...lines, '', ...objective].join('\n'));
