// Does the vent warning leave a moving player time to see it and get out? Through the real sim (vent clock, damage ticks, player
// physics): a trainer walks into a vent field of Cinder Crater at every phase of the 10 s cycle, and either
//   blind     keeps walking to the deepest vent tile and stands there for 4 s (a player who never looks at the ground), or
//   reacts    the same, but `r` seconds after the warning starts it turns for the nearest safe tile (reaction time r: 0.35 s
//             is a quick player, 0.5 s typical, 0.8 s a player in a fight)
// and the vent hits it takes are counted (a hit is 2 % of maximum HP, five per eruption).
//   npx tsx scripts/habvent.ts [seeds] [--speeds 5.4,7.2] [--react 0.35,0.5,0.8] [-v]
import { createRun, step } from '../src/sim/run';
import { NO_INPUT, type InputFrame, type SimContext } from '../src/sim/types';

const arg = (k: string, d: string) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const SEEDS = (process.argv[2] && !process.argv[2].startsWith('-') ? process.argv[2] : '1,2,3,5,7,9').split(',').map(Number);
const SPEEDS = arg('speeds', '5.4,7.2').split(',').map(Number);
const REACT = arg('react', '0.35,0.5,0.8').split(',').map(Number);

function mk(seed: number): SimContext {
  return createRun({ seed: 1, species: 'bulbasaur', ruleOverrides: { worldgen: { mode: 'generated', regionSeed: seed, locations: { meadow: 'volcanic-ridge', dusk: 'volcanic-ridge', badlands: 'volcanic-ridge', frost: 'volcanic-ridge' } }, objectives: { firstAfter: 1e9, secondAfter: 1e9 }, director: { spawnBase: -99, eliteEvery: 1e9, swarmEvery: 1e9 } } as never });
}

const N4: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]];
/** BFS over open tiles from `src`; distance map */
function bfs(ctx: SimContext, src: number[]): Map<number, number> {
  const W = ctx.world, d = new Map<number, number>(src.map((k) => [k, 0])), Q = [...src];
  for (let h = 0; h < Q.length; h++) { const k = Q[h], v = d.get(k)!; for (const [dx, dy] of N4) { const i = (k % W.w) + dx, j = ((k / W.w) | 0) + dy; if (i < 0 || j < 0 || i >= W.w || j >= W.h) continue; const t = j * W.w + i; if (d.has(t) || !W.isOpen(t) || (W.map.over && W.map.over[t] > 0)) continue; d.set(t, v + 1); Q.push(t); } }
  return d;
}
const pathFrom = (ctx: SimContext, dist: Map<number, number>, from: number): number[] => { const W = ctx.world, out = [from]; let k = from; while ((dist.get(k) ?? 0) > 0) { let best = k, bv = dist.get(k)!; for (const [dx, dy] of N4) { const t = ((((k / W.w) | 0) + dy) * W.w) + (k % W.w) + dx; const v = dist.get(t); if (v !== undefined && v < bv) { bv = v; best = t; } } if (best === k) break; out.push(best); k = best; } return out; };

/** the trainer's top walking speed on open ground (m/s): the input magnitude of a slower walk is scaled from it */
const VMAX = (() => { const c = mk(1), P = c.player; const x0 = P.x, z0 = P.z; for (let t = 0; t < 45; t++) step(c, { ...NO_INPUT, mx: 1, mz: 0 }); void x0; void z0; return Math.hypot(P.vx, P.vz); })();

export interface VentRow { seed: number; field: number; deepest: number; speed: number; model: string; runs: number; hitRate: number; meanHits: number; worstHits: number }

export function ventCase(seed: number): VentRow[] {
  const probe = mk(seed), W0 = probe.world, H0 = W0.hab!;
  if (!H0.hazard.length) return [];
  const rows: VentRow[] = [];
  const hazard = new Set(H0.hazard);
  // the safe-ground distance of every vent tile, and the deepest one
  const safe = [...bfs(probe, [...(function* () { for (const k of probe.world.hab!.hazard) for (const [dx, dy] of N4) { const t = ((((k / W0.w) | 0) + dy) * W0.w) + (k % W0.w) + dx; if (!hazard.has(t) && W0.isOpen(t)) yield t; } })()]).entries()];
  void safe;
  const outside = new Map<number, number>(); // distance from any non-vent open tile next to the field, over vent tiles only
  const exits: number[] = []; for (const k of H0.hazard) for (const [dx, dy] of N4) { const t = ((((k / W0.w) | 0) + dy) * W0.w) + (k % W0.w) + dx; if (!hazard.has(t) && W0.isOpen(t) && !(W0.map.over && W0.map.over[t] > 0)) exits.push(t); }
  const depth = bfs(probe, [...new Set(exits)]);
  let deepest = H0.hazard[0], dd = -1; for (const k of H0.hazard) { const v = depth.get(k) ?? 0; if (v > dd) { dd = v; deepest = k; } }
  void outside;
  // the start: 8 tiles out from the deepest vent tile, on the flow, nearest to team A's staging (the side a trainer comes from)
  const fromDeep = bfs(probe, [deepest]);
  let start = -1, bs = Infinity; for (const [k, v] of fromDeep) if (v === 8 && !hazard.has(k)) { const s = Math.hypot((k % W0.w) - H0.stage.A[0], ((k / W0.w) | 0) - H0.stage.A[1]); if (s < bs) { bs = s; start = k; } }
  if (start < 0) return [];
  const V = probe.rules.habitat.vent;
  for (const speed of SPEEDS) for (const model of ['blind', ...REACT.map((r) => 'reacts ' + r + 's')]) {
    let runs = 0, hit = 0, sum = 0, worst = 0;
    for (let ph = 0; ph < V.period * 10; ph++) {
      const ctx = mk(seed), W = ctx.world, P = ctx.player;
      ctx.stageTime = ph / 10; ctx.time = ph / 10;
      P.x = P.px = (start % W.w) - W.half + 0.5; P.z = P.pz = ((start / W.w) | 0) - W.half + 0.5; P.y = P.py = W.height(P.x, P.z);
      const mag = Math.min(1, speed / VMAX);
      const inPath = pathFrom(ctx, fromDeep, start), idxDeep = inPath.length - 1;
      let leg = 0, hits = 0, reactAt = Infinity, outPath: number[] = [], oleg = 0, stand = 0;
      const r = model.startsWith('reacts') ? Number(model.split(' ')[1].replace('s', '')) : Infinity;
      const nodeXZ = (k: number): [number, number] => [(k % W.w) - W.half + 0.5, ((k / W.w) | 0) - W.half + 0.5];
      let prevWarn = false;
      for (let t = 0; t < 60 * 14; t++) {
        const phase = ctx.stageTime % V.period;
        const warn = phase >= V.period - V.active - V.warn && phase < V.period - V.active;
        // the cue is on from the start of the warning (and from the eruption itself): when the player first has a reason to react
        if ((warn || phase >= V.period - V.active) && !prevWarn && reactAt === Infinity && r !== Infinity) reactAt = ctx.stageTime + r;
        prevWarn = warn || phase >= V.period - V.active;
        let inp: InputFrame = NO_INPUT;
        const here = W.tile(P.x, P.z);
        if (reactAt !== Infinity && ctx.stageTime >= reactAt && hazard.has(here) && outPath.length === 0) { const d2 = bfs(ctx, [...new Set(exits)]); outPath = pathFrom(ctx, d2, here); oleg = 0; }
        if (outPath.length) {
          if (oleg < outPath.length - 1) { const [tx, tz] = nodeXZ(outPath[Math.min(outPath.length - 1, oleg + 1)]); const dx = tx - P.x, dz = tz - P.z, L = Math.hypot(dx, dz); if (L < 0.35) oleg++; inp = { ...NO_INPUT, mx: mag * dx / (L || 1), mz: mag * dz / (L || 1) }; }
        } else if (leg < idxDeep) {
          const [tx, tz] = nodeXZ(inPath[leg + 1]); const dx = tx - P.x, dz = tz - P.z, L = Math.hypot(dx, dz); if (L < 0.35) leg++; inp = { ...NO_INPUT, mx: mag * dx / (L || 1), mz: mag * dz / (L || 1) };
        } else { stand += ctx.dt; if (stand > 4 && r === Infinity) break; }
        for (const e of step(ctx, inp)) if (e.t === 'hazardHit' && e.kind === 'vent' && e.who === 'player') hits++;
        if (outPath.length && oleg >= outPath.length - 1 && !hazard.has(W.tile(P.x, P.z)) && t > 60) break;
      }
      runs++; if (hits) hit++; sum += hits; worst = Math.max(worst, hits);
    }
    rows.push({ seed, field: H0.hazard.length, deepest: dd, speed, model, runs, hitRate: +(hit / runs).toFixed(3), meanHits: +(sum / runs).toFixed(2), worstHits: worst });
  }
  return rows;
}

if (process.argv[1]?.endsWith('habvent.ts')) {
  console.log(`trainer top speed on open ground ${VMAX.toFixed(2)} m/s`);
  const all: VentRow[] = [];
  for (const s of SEEDS) all.push(...ventCase(s));
  console.table(all.map((r) => ({ seed: r.seed, 'vent tiles': r.field, 'deepest (tiles from safe)': r.deepest, 'speed m/s': r.speed, model: r.model, phases: r.runs, 'hit rate': r.hitRate, 'mean hits': r.meanHits, worst: r.worstHits })));
}
