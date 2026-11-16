// Spatial-query workloads (src/sim/spatial.ts, docs/THIRD_PERSON_IMPLEMENTATION.md §12):
// `npx tsx scripts/spatialbench.ts [--gate]`.
//
// Builds a crowded run on a generated location map (Mt. Moon: cliffs, decks, chasms) and on the authored meadow, freezes
// it, and times each query family over a fixed, pre-generated query set (min of 5 passes of the mean of 20 000 calls).
// Allocation: after a forced full collection, the collections during the 100 000 timed calls are counted with a
// PerformanceObserver and the heap growth is divided by the calls (with no collection in between, growth is what they
// allocated). The legacy equivalents (World.sight, the end-of-tick grid.query + point test) are timed on the same inputs
// for comparison and not gated. `--gate` fails the run when the average shot-tick sweep is over 2 µs (the Stage 3 gate),
// or a spatial loop collects or grows the heap by 4 B per call or more.
import { PerformanceObserver } from 'node:perf_hooks';
import { setFlagsFromString } from 'node:v8';
import { runInNewContext } from 'node:vm';
import { createRun, step } from '../src/sim/run';
import { botInput } from '../src/sim/bot';
import { Rng } from '../src/core/rng';
import { Contacts, MASK, RayHit, SK, overlapCylinder, overlapSector, raycastWorld, segmentClear, spatialQuery, sweep } from '../src/sim/spatial';
import type { SimContext } from '../src/sim/types';

setFlagsFromString('--expose_gc');
/** a full collection before each measured loop, so one that runs inside it is the loop's own */
const fullGc = runInNewContext('gc') as () => void;
let gcs = 0;
const obs = new PerformanceObserver((list) => { gcs += list.getEntries().length; });
obs.observe({ entryTypes: ['gc'] });

function crowd(world: 'mt-moon' | 'meadow', target: number): SimContext {
  const overrides: Record<string, unknown> = { director: { spawnBase: 12, spawnPerMin: 6, capBase: target * 1.1, capPerMin: 0 }, enemy: { liveCap: Math.round(target * 1.1) } };
  if (world === 'mt-moon') overrides.worldgen = { mode: 'generated', locations: { meadow: 'mt-moon' } };
  const ctx = createRun({ seed: 2, species: 'cyndaquil', ruleOverrides: overrides as never });
  while (ctx.enemies.count < target * 0.95 && ctx.time < 400) { ctx.player.hp = ctx.player.maxHp; step(ctx, botInput(ctx)); }
  return ctx;
}

const N = 20000;
/** query inputs: origin, unit direction, length */
const Q = { ox: new Float64Array(N), oy: new Float64Array(N), oz: new Float64Array(N), dx: new Float64Array(N), dy: new Float64Array(N), dz: new Float64Array(N) };
function inputs(ctx: SimContext, spread: number, pitch: number) {
  const rng = new Rng(9), P = ctx.player;
  for (let i = 0; i < N; i++) {
    const a = rng.range(0, Math.PI * 2), p = rng.range(-pitch, pitch * 0.3), r = rng.range(0, spread), b = rng.range(0, Math.PI * 2);
    const x = P.x + Math.cos(b) * r, z = P.z + Math.sin(b) * r;
    Q.ox[i] = x; Q.oz[i] = z; Q.oy[i] = ctx.world.height(x, z, P.y + 0.5) + 0.8;
    Q.dx[i] = Math.cos(a) * Math.cos(p); Q.dy[i] = Math.sin(p); Q.dz[i] = Math.sin(a) * Math.cos(p);
  }
}

/** gc entries are delivered asynchronously: yield so the ones from a finished loop are counted */
const settle = () => new Promise((r) => setTimeout(r, 30));

/** the timed loop, in a plain function: locals of an async function live in its context, where every double written
 *  is boxed, so a loop there allocates on its own */
function loop(fn: (i: number) => number, n: number): number {
  let sink = 0;
  for (let i = 0; i < n; i++) sink += fn(i % N);
  return sink;
}
const TIMES = new Float64Array(2);
function passes(fn: (i: number) => number): number {
  let best = Infinity;
  for (let pass = 0; pass < 5; pass++) {
    const t0 = performance.now();
    TIMES[0] += loop(fn, N);
    best = Math.min(best, ((performance.now() - t0) * 1000) / N);
  }
  return best;
}

/** `strict`: the loop must not allocate (no collection; under 4 B per call, i.e. well under one boxed number per call:
 *  what is left is the optimiser's own occasional box, ~1.5 B/call on fat sweeps that hit walls). The legacy functions
 *  are timed for comparison and not gated */
async function time(label: string, fn: (i: number) => number, rows: string[], gate?: number, legacy = false, strict = false): Promise<number> {
  // warm up until the optimising compiler is done with it: code it emits mid-loop would count as heap growth
  let sink = 0;
  for (let w = 0; w < 3; w++) sink += loop(fn, N);
  fullGc();
  await settle();
  const g0 = gcs, h0 = process.memoryUsage().heapUsed;
  const best = passes(fn);
  const grown = process.memoryUsage().heapUsed - h0;
  await settle();
  const g = gcs - g0;
  // with no collection in between, heap growth over the 5 × N calls is what they allocated
  const perCall = g === 0 ? `${Math.max(0, grown / (5 * N)).toFixed(2)} B/call` : 'collected';
  rows.push(`${label.padEnd(60)} ${best.toFixed(3).padStart(7)} µs   gc ${g}   ${perCall}${gate !== undefined ? `   (gate ${gate} µs: ${best <= gate ? 'PASS' : 'FAIL'})` : ''}${Number.isNaN(sink) ? ' NaN' : ''}`);
  if (!legacy && strict && (g > 0 || grown / (5 * N) > 4)) fail = true;
  if (gate !== undefined && best > gate) fail = true;
  return best;
}

let fail = false;
const H = new RayHit(), out = new Contacts(64);
async function main() {
for (const world of ['mt-moon', 'meadow'] as const) {
  const ctx = crowd(world, 500);
  const W = ctx.world, rows: string[] = [];
  console.log(`\n${world}: ${ctx.enemies.count} enemies, ${ctx.bodies.count} bodies, map ${W.w}×${W.h}, decks ${W.over ? 'yes' : 'no'}, t = ${ctx.time.toFixed(0)} s`);
  // camera and visibility rays from the trainer: 26 m (the chase aim range), pitch −35°..+10°
  inputs(ctx, 0, 0.6);
  // the harness's own loops compile on their first use: run one discarded row so that is not charged to a query
  await time('(harness warm-up)', (i) => +raycastWorld(W, Q.ox[i], Q.oy[i] + 1.5, Q.oz[i], Q.dx[i], Q.dy[i], Q.dz[i], 26, MASK.los, H), [], undefined, true);
  const cam = spatialQuery({ mask: MASK.camera, selfKind: SK.player, selfId: 0 });
  await time('camera ray, world only, 26 m (raycastWorld)', (i) => +raycastWorld(W, Q.ox[i], Q.oy[i] + 1.5, Q.oz[i], Q.dx[i], Q.dy[i], Q.dz[i], 26, MASK.los, H), rows, undefined, false, true);
  await time('camera trace, world + enemies + bodies, 26 m (sweep)', (i) => sweep(ctx, Q.ox[i], Q.oy[i] + 1.5, Q.oz[i], Q.dx[i], Q.dy[i], Q.dz[i], 26, cam, out), rows, undefined, false, true);
  // shots anywhere within 20 m of the trainer, one tick of a 26 m/s bolt
  inputs(ctx, 20, 0.15);
  const shot = spatialQuery({ mask: MASK.shot, actorR: 0.4, actorH: 0.4, pierce: 2 });
  const fat = spatialQuery({ mask: MASK.shot, actorR: 0.4, actorH: 0.4, worldR: 0.3, worldH: 0.3, pierce: 2 });
  await time('shot tick 0.433 m, thin vs world, r 0.4 vs actors (sweep)', (i) => sweep(ctx, Q.ox[i], Q.oy[i], Q.oz[i], Q.dx[i], Q.dy[i], Q.dz[i], 26 / 60, shot, out), rows, 2, false, true);
  await time('shot tick 0.433 m, r 0.3 vs world, r 0.4 vs actors (sweep)', (i) => sweep(ctx, Q.ox[i], Q.oy[i], Q.oz[i], Q.dx[i], Q.dy[i], Q.dz[i], 26 / 60, fat, out), rows, 2, false, true);
  // the legacy collision of one tick (effects.ts): grid.query(r + 2.5) and a 2D distance test per candidate, wall point test
  const E = ctx.enemies, G = ctx.grid;
  await time('  legacy tick: grid.query + point tests + wallAt (effects.ts)', (i) => {
    const x = Q.ox[i] + Q.dx[i] * 0.433, z = Q.oz[i] + Q.dz[i] * 0.433, n = G.query(x, z, 0.4 + 2.5);
    let c = 0;
    for (let k = 0; k < n; k++) { const e = G.result[k], dx = E.x[e] - x, dz = E.z[e] - z, rr = 0.4 + E.radius[e]; if (E.alive[e] && dx * dx + dz * dz <= rr * rr) c++; }
    return c + +W.wallAt(x, z) + W.height(x, z, Q.oy[i]);
  }, rows, undefined, true);
  const beam = spatialQuery({ mask: MASK.shot, actorR: 0.6, actorH: 0.6, pierce: Infinity });
  await time('beam 14 m, r 0.6, pierce all (sweep)', (i) => sweep(ctx, Q.ox[i], Q.oy[i], Q.oz[i], Q.dx[i], Q.dy[i], Q.dz[i], 14, beam, out), rows, undefined, false, true);
  // line of sight, 20 m
  await time('line of sight 20 m (segmentClear, exact)', (i) => +segmentClear(W, Q.ox[i], Q.oy[i], Q.oz[i], Q.ox[i] + Q.dx[i] * 20, Q.oy[i] + Q.dy[i] * 20, Q.oz[i] + Q.dz[i] * 20), rows, undefined, false, true);
  await time('  legacy: World.sight 20 m (0.5 m samples)', (i) => +W.sight(Q.ox[i], Q.oy[i], Q.oz[i], Q.ox[i] + Q.dx[i] * 20, Q.oy[i] + Q.dy[i] * 20, Q.oz[i] + Q.dz[i] * 20), rows, undefined, true);
  // areas and melee around the trainer's surroundings
  const area = spatialQuery({ mask: SK.enemy | SK.body });
  const areaLos = spatialQuery({ mask: SK.enemy | SK.body | MASK.los, flags: 4 });
  await time('area: overlapCylinder r 3, band 2.5 m', (i) => overlapCylinder(ctx, Q.ox[i], Q.oy[i] - 0.8, Q.oy[i] + 1.7, Q.oz[i], 3, area, out), rows, undefined, false, true);
  await time('area: overlapCylinder r 3 with line of sight', (i) => overlapCylinder(ctx, Q.ox[i], Q.oy[i] - 0.8, Q.oy[i] + 1.7, Q.oz[i], 3, areaLos, out), rows, undefined, false, true);
  await time('melee: overlapSector r 2.5, 60° half-angle', (i) => overlapSector(ctx, Q.ox[i], Q.oy[i] - 0.8, Q.oy[i] + 1.7, Q.oz[i], 2.5, Q.dx[i], Q.dz[i], 0.5, area, out), rows, undefined, false, true);
  for (const r of rows) console.log('  ' + r);
}
obs.disconnect();
console.log(`\n${fail ? 'FAIL' : 'PASS'}: shot-tick sweep under 2 µs; no collection and no heap growth (< 4 B/call) in any spatial loop`);
if (process.argv.includes('--gate') && fail) process.exitCode = 1;
}
void main();
