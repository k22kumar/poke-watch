// The legendary sanctuary habitat (Spear Sanctuary, `spear-sanctuary`; docs/HABITATS.md "Sanctuary"): it loads through the
// regular map flow, every seed keeps the landmark sequence and passes every gate with the baseline roster, the secondary court,
// the shoulder and the gallery's door vary while the axis does not, the ruin kit assembles in any orientation (so other ruin
// recipes can use it), and the Hold plays differently from Cinder Crater (scripts/habsanct.ts prints the same measures).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultRules } from '../src/rules/defaults';
import { BIOMES } from '../src/rules/stages';
import { createRun, step } from '../src/sim/run';
import { startObjective } from '../src/sim/objectives';
import { NO_INPUT } from '../src/sim/types';
import { attemptHabitat, CONTROL_POINT, findHabitat, generateHabitat, HABITATS, HAB_VERSION, profilesFor } from '../src/world/habitat';
import { HabCtx, HK } from '../src/world/habitat/ctx';
import { colonnadeCourt, focalCourt, gateway, RuinKit } from '../src/world/habitat/ruins';
import { planOf } from '../src/world/habitat/sanctuary';
import { clearance } from '../src/world/habitat/validate';
import { pathBetween } from '../src/world/locgen/nav';
import { findMapSource, locationFor, mapChecksum, regionMap } from '../src/world/maps';
import { worldgenFromQuery } from '../src/world/replay';
import { analyse, type Geo } from '../scripts/habsanct';

const ID = 'spear-sanctuary';
const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

test('the sanctuary launches through the regular map flow: loose names, ?loc=, the regions seam, a Hold on its court', () => {
  assert.equal(findMapSource(ID), ID);
  assert.equal(findMapSource('Spear Sanctuary'), ID);
  assert.equal(findMapSource('coronet'), ID);
  assert.equal(findMapSource('spear pillar'), ID);
  assert.equal(findMapSource('sinnoh'), ID);
  assert.equal(findMapSource(`${ID}/snow`), `${ID}:snow`);
  assert.deepEqual(findHabitat('summit:snow'), { id: ID, variant: 'snow' });
  const wg = { mode: 'generated' as const, size: 128, locations: { meadow: ID } };
  assert.equal(locationFor(wg, 'meadow'), ID);
  assert.equal(regionMap({ ...defaultRules.worldgen, mode: 'generated', locations: { meadow: ID } }, 'meadow', 5).gen!.hab!.recipe, ID);
  const q = worldgenFromQuery({ world: 'locations', loc: 'spear-sanctuary', mapseed: '5', biomes: Object.keys(BIOMES) }, () => {});
  const ctx = createRun({ seed: 3, species: 'cyndaquil', ruleOverrides: { worldgen: q } as never });
  const H = ctx.world.hab!;
  assert.equal(H.recipe, ID);
  assert.equal(H.seed, 5);
  assert.equal(ctx.world.map.id, `${ID}@5h${H.version}`);
  assert.ok(ctx.world.los, 'habitat maps use the location rules (line of sight, drop navigation)');
  for (let i = 0; i < 30; i++) step(ctx, NO_INPUT);
  assert.ok(startObjective(ctx, 'hold'));
  assert.ok(Math.abs(ctx.objective!.x - (H.contest.x - ctx.world.half)) < 0.01 && Math.abs(ctx.objective!.z - (H.contest.y - ctx.world.half)) < 0.01, 'on the generated court');
  const out: [number, number] = [0, 0];
  assert.ok(ctx.world.goalDir(H.stage.B[0] - ctx.world.half, H.stage.B[1] - ctx.world.half, out), 'Raiders have a flow field to the court from team B\'s staging');
  assert.equal(HABITATS[ID].refs.length, 3);
  assert.ok(HABITATS[ID].anchors.some((a) => a.provenance === 'canon') && HABITATS[ID].anchors.some((a) => a.provenance === 'original'));
});

test('every seed keeps the landmark sequence and passes every gate in every state with the baseline roster, on the first attempt', () => {
  const P = profilesFor();
  for (const s of [...SEEDS, 101, 102, 103, ...HABITATS[ID].fallbackSeeds]) {
    const m = generateHabitat({ recipe: ID, seed: s }), b = generateHabitat({ recipe: ID, seed: s }), H = m.gen!.hab!;
    assert.equal(mapChecksum(m), mapChecksum(b), `seed ${s}: the same map twice`);
    assert.equal(m.id, `${ID}@${s}h${HAB_VERSION}`);
    assert.equal(H.attempts, 1, `seed ${s}: accepted on its first attempt (${H.rejections.map((r) => r.failed.join('+')).join('; ')})`);
    assert.deepEqual(H.gates.filter((g) => !g.ok).map((g) => `${g.id}: ${g.value}`), [], `seed ${s}`);
    for (const id of ['reach:base', 'reach:stripped', 'independent:base', 'independent:stripped', 'sanctuary:sequence', 'sanctuary:entry', 'sanctuary:exit', 'sanctuary:counter', 'drainage', 'perch', 'counter']) assert.ok(H.gates.some((g) => g.id === id && g.ok), `seed ${s}: ${id}`);
    // the landmark sits beside the court, on the platform's height; the stagings are on the foothill
    const lm = m.landmarks[0], ct = H.contest;
    assert.ok(Math.hypot(lm.x - ct.x, lm.y - ct.y) <= ct.r + 6, `seed ${s}: landmark beside the Hold`);
    assert.equal(ct.h, 9);
    for (const t of ['A', 'B'] as const) assert.ok(m.elev[Math.floor(H.stage[t][1]) * m.w + Math.floor(H.stage[t][0])] < 0.6, `seed ${s}: staging ${t} on the foothill`);
    // both approaches per side for every essential body, and back
    const cl = clearance(m), n = m.w * m.h, c = Math.floor(ct.y) * m.w + Math.floor(ct.x);
    if (s <= 3) for (const team of ['A', 'B'] as const) for (const p of P.filter((x) => x.essential)) {
      const allow = new Uint8Array(cl.length);
      for (let v = 0; v < cl.length; v++) allow[v] = cl[v] >= p.radius ? 1 : 0;
      const st = Math.floor(H.stage[team][1]) * m.w + Math.floor(H.stage[team][0]);
      assert.ok(pathBetween(m, st, c, allow) && pathBetween(m, c, st, allow), `seed ${s} ${team} ${p.id}: to the court and back (${n} tiles)`);
    }
  }
});

test('the axis keeps its order in every orientation while the shoulder, the side court and the gallery doors vary', () => {
  const rots = new Set<string>(), sides = new Set<number>(), courtSides = new Set<number>(), gaps: number[] = [], doorsA: number[] = [], rear = new Set<boolean>(), shapes = new Set<string>();
  const P = profilesFor();
  for (const s of SEEDS) {
    const a = attemptHabitat(HABITATS[ID], CONTROL_POINT, s, 128, '', P), g = a.g, plan = planOf(g)!;
    assert.ok(a.ok, `seed ${s}: ${a.failed.join(', ')}`);
    rots.add(`${g.rot}${g.mir ? 'm' : ''}`); sides.add(plan.balcony.side); courtSides.add(plan.court.side); rear.add(plan.doors.A.rear); shapes.add(JSON.stringify(g.shape));
    gaps.push(g.shape.courtGap); doorsA.push(plan.doors.A.v);
    // the four axis points, in map space: strictly in order along one line from the foothill to the platform, in height too
    const pts = Object.values(plan.sequence).map(([u, v]) => g.P(u / (g.S - 1), v / (g.S - 1)));
    const dir = [pts[3][0] - pts[0][0], pts[3][1] - pts[0][1]], len = Math.hypot(dir[0], dir[1]);
    const along = pts.map((p) => ((p[0] - pts[0][0]) * dir[0] + (p[1] - pts[0][1]) * dir[1]) / len);
    for (let i = 1; i < 4; i++) assert.ok(along[i] > along[i - 1] + 8, `seed ${s}: tier ${i} lies beyond tier ${i - 1} along the axis (${along.map((x) => x.toFixed(0))})`);
    const e = pts.map(([x, y]) => g.m.elev[Math.floor(y) * g.S + Math.floor(x)]);
    for (let i = 1; i < 4; i++) assert.ok(e[i] - e[i - 1] >= 2.4, `seed ${s}: tier ${i} a tier above tier ${i - 1} (${e})`);
    assert.equal(a.report.metrics.axisOff, 0);
  }
  assert.ok(rots.size >= 4, `orientations: ${[...rots]}`);
  assert.equal(sides.size, 2, 'the shoulder is on either side');
  assert.equal(courtSides.size, 2, 'the side court is on either side');
  assert.equal(rear.size, 2, 'team A\'s gallery comes in at the rear or at the flank');
  assert.ok(Math.max(...gaps) - Math.min(...gaps) > 0.3, 'the side court\'s opening moves');
  assert.ok(Math.max(...doorsA) - Math.min(...doorsA) > 8, 'the gallery door moves along the platform');
  assert.equal(shapes.size, SEEDS.length, 'every seed is its own layout');
});

test('the gates name what they measure: entry, exit, counter-angle, and the sanctuary identity survives dressing', () => {
  const P = profilesFor();
  for (const s of [2, 5, 9]) {
    const a = attemptHabitat(HABITATS[ID], CONTROL_POINT, s, 128, '', P), M = a.report.metrics, g = a.g;
    for (const t of ['A', 'B']) assert.ok(M[`entry:${t}`] >= 40 || M[`entryRise:${t}`] >= 2.5, `seed ${s} ${t}: the two approaches arrive differently`);
    assert.ok(M['exitSeen:A'] < 0.5 && M['exitSeen:B'] < 0.5, `seed ${s}: the gallery's door is screened from the balcony`);
    assert.ok(M.balconyDrops >= 1, `seed ${s}: a drop from the balcony`);
    assert.ok(M.counterWalk <= 34 && M.counterSee >= 0.5, `seed ${s}: the balcony is ${M.counterWalk} tiles from the court and in its view`);
    assert.equal(g.shape.plinths >= 3 && g.shape.pillars >= 14 && g.shape.walls >= 4 && g.shape.walkways >= 1, true, `seed ${s}: assembled from pillars, wall fragments, plinths and walkway pieces`);
    for (const f of ['boulder', 'channel', 'chamber', 'cliff', 'relief', 'structure']) assert.ok(a.g.used.has(f as never), `seed ${s}: the ${f} family`);
    assert.ok(a.identity.length === 0, a.identity.join(','));
  }
});

test('the ruin kit assembles the same parts in every orientation, so another ruin recipe can use it', () => {
  const foot = (rot: number, mir: boolean) => {
    // a bare context of another recipe: the kit and its assemblies never name a place
    const g = new HabCtx(HABITATS['volcanic-ridge'], CONTROL_POINT, 128, 7);
    g.rot = rot; g.mir = mir;
    g.H.fill(8); g.kind.fill(HK.mass);
    const K = new RuinKit(g);
    K.slab({ u: [40.2, 88.7], v: [30.2, 100.7] }, 6, { kind: HK.terrace });
    gateway(K, { axis: 63.37, v: 90.3, pylon: 3.6, wall: 1.3, wallLen: 4 });
    colonnadeCourt(K, { axis: 63.37, rows: [9.5, 16.5], v0: 70.3, v1: 88.3, pitch: 4.6, rise: 2.7, phase: 0.4, broken: (i, row) => (i + row) % 5 === 3 });
    const f = focalCourt(K, { axis: 63.37, v0: 30.2, v1: 62.3, half: 17.3, plinthW: 9.2, plinthD: 5.1, plinthTop: 6.4, plinthRise: 2.5, spearRise: 4.6, flank: { offset: 12.8, pitch: 5.7, rise: 3, phase: 0.6 }, shoulder: 1, balustradeRise: 0.9, balustradeGaps: [[0.62, 0.72]] });
    K.walkway([[44.4, 80.3, 6], [44.4, 74.3, 8.5]], 5, { kind: HK.ramp, keep: 0 }); // a stair, and a ledge at its head
    K.walkway([[44.4, 74.3, 8.5], [44.4, 66.3, 8.5]], 4, { keep: 0 });
    const cells = new Set<string>();
    for (let y = 0; y < g.S; y++) for (let x = 0; x < g.S; x++) {
      const k = g.idx(x, y);
      if (g.kind[k] !== HK.rock && g.kind[k] !== HK.terrace) continue;
      const [u, v] = K.to(x + 0.5, y + 0.5);
      cells.add(`${g.kind[k]}:${Math.floor(u)},${Math.floor(v)}:${g.H[k].toFixed(1)}`);
    }
    return { cells, pieces: { ...K.pieces }, plinth: f.plinth };
  };
  const base = foot(0, false);
  assert.ok(base.pieces.plinths >= 3 && base.pieces.pillars >= 12 && base.pieces.walls >= 3 && base.pieces.walkways === 2 && base.pieces.tiers === 1, JSON.stringify(base.pieces));
  assert.ok(base.cells.size > 1000);
  for (const [rot, mir] of [[1, false], [2, false], [3, false], [0, true], [1, true], [2, true], [3, true]] as const) {
    const o = foot(rot, mir);
    assert.deepEqual(o.pieces, base.pieces, `rot ${rot}${mir ? ' mirrored' : ''}: the same pieces`);
    assert.equal(o.cells.size, base.cells.size, `rot ${rot}${mir ? ' mirrored' : ''}: the same footprint size`);
    let diff = 0;
    for (const c of o.cells) if (!base.cells.has(c)) diff++;
    assert.ok(diff <= base.cells.size * 0.01, `rot ${rot}${mir ? ' mirrored' : ''}: the same footprint in canonical tiles (${diff} of ${base.cells.size} differ)`);
  }
});

test('the sanctuary plays differently from Cinder Crater: entry angles, sightlines and the use of high ground', () => {
  const S: Geo[] = [], C: Geo[] = [];
  for (const s of [1, 2, 3, 4]) { S.push(analyse(ID, s)); C.push(analyse('volcanic-ridge', s)); }
  // entry: the sanctuary's two sides climb the same stairs and meet at the court from one bearing; the crater's come from opposite sides
  for (const g of S) assert.ok(g.convergence <= 25, `${ID} ${g.seed}: both direct approaches arrive from one bearing (${g.convergence}°)`);
  for (const g of C) assert.ok(g.convergence >= 80, `crater ${g.seed}: the sides arrive from opposite bearings (${g.convergence}°)`);
  assert.ok(mean(S.flatMap((g) => g.within)) >= mean(C.flatMap((g) => g.within)) + 20, 'a side\'s own two approaches are further apart in the sanctuary (the gallery comes in through a door)');
  // arrival: the sanctuary's direct lane climbs into the court; the crater's runs level across its floor
  assert.ok(mean(S.flatMap((g) => [g.slope[0], g.slope[2]])) <= -1.5, 'the direct lane climbs into the court');
  assert.ok(mean(C.flatMap((g) => [g.slope[0], g.slope[2]])) >= -0.5, 'the crater\'s lane does not');
  // sightlines: a different profile (more short ground, less of the approach in view from the court)
  assert.ok(Math.abs(mean(S.map((g) => g.ray.p90)) - mean(C.map((g) => g.ray.p90))) >= 5, 'the long sightlines differ in length');
  assert.ok(mean(S.map((g) => g.ray.short)) >= mean(C.map((g) => g.ray.short)) + 0.08, 'more of the court is short ground');
  assert.ok(mean(S.flatMap((g) => g.seen)) + 0.15 <= mean(C.flatMap((g) => g.seen)), 'the court sees much less of each approach\'s last 60 m');
  // high ground: one shoulder on one side, against the crater's ring of crest
  assert.ok(mean(S.map((g) => g.high.arc)) <= 4 && mean(C.map((g) => g.high.arc)) >= 5, `high ground covers ${mean(S.map((g) => g.high.arc)).toFixed(1)} of 16 sectors against ${mean(C.map((g) => g.high.arc)).toFixed(1)}`);
  for (const g of S) assert.ok(g.high.tiles >= 20 && g.high.rise >= 2.4 && g.high.reach, `${ID} ${g.seed}: a real upper position, reachable from both stagings (${JSON.stringify(g.high)})`);
});
