// Headless sim cost per tick at a given crowd size: `npx tsx scripts/perf-sim.ts [target=500] [--repeat N] [--gate] [--aim]`.
// `--aim` adds a chase-camera crosshair ray to the bot's input (scripts/lib/aimbot.ts), so the direct shots fly the
// spatial path (sim/aim.ts, 3D swept shots): the integrated cost of Phase 2B under a full crowd.
// The crowd is scripts/lib/crowd.ts (chase walkers kept at the target on the spawn ring; Q21 as amended 2026-11-20:
// not training targets, which skip the flow-field chase the co-op wave will pay for). The player is made unkillable,
// then tick times are sampled while the live count sits within ±10% of the target.
//
// `--physics rapier` runs the sim with rules.physics.engine 'rapier' (task I1a: the world half of aim, line of sight, shots and
// beams on src/physics) and reports physics' share: the time spent inside Rapier queries per tick (a profiling clock in
// PhysicsWorld), at the tick-time p95 and as its own percentiles. Map builds at entry happen before sampling.
//
// `--nav navmesh` runs the sim with rules.nav.engine 'navmesh' (task I3: enemies steer by src/nav's navmeshes; independent
// of --physics) and reports navigation's share the same way (a profiling clock on sim/navseam.ts NavBridge: steering,
// fields, rebuilds and the shore search), with each map's navmesh build time (at entry, before sampling).
//
// `--viewsight` turns rules.aim.viewSight on (task CL: spatial shots launch from and are checked from the anatomical eye;
// with --aim, the aimbot's lens follows the camera law).
// `--repeat N` replays every run N times and keeps, for each tick, the fastest of the N timings. The runs are
// deterministic, so tick i does the same work each time: the minimum strips scheduler and GC noise, which on a
// shared machine can triple the raw p99. Both the raw (first pass) and the min-of-N percentiles are printed;
// the gates (blueprint section 12: p95 <= 2 ms, p99 <= 3 ms) read the min-of-N numbers when N > 1.
import { createRun, step } from '../src/sim/run';
import { botInput } from '../src/sim/bot';
import { withAim } from './lib/aimbot';

import { assertRunning } from './lib/ended';
import { crowd } from './lib/crowd';
import { initPhysicsNode } from '../src/physics/node';
import { PhysicsWorld } from '../src/physics/world';
import { initNavNode } from '../src/nav/node';
import { NavBridge } from '../src/sim/navseam';
const engine = process.argv.includes('--physics') ? process.argv[process.argv.indexOf('--physics') + 1] : 'tiles';
if (engine !== 'tiles' && engine !== 'rapier') throw new Error(`--physics tiles|rapier, not ${engine}`);
if (engine === 'rapier') { await initPhysicsNode(); PhysicsWorld.clock = () => performance.now(); }
// I3: --nav flow|navmesh
const navEngine = process.argv.includes('--nav') ? process.argv[process.argv.indexOf('--nav') + 1] : 'flow';
if (navEngine !== 'flow' && navEngine !== 'navmesh') throw new Error(`--nav flow|navmesh, not ${navEngine}`);
if (navEngine === 'navmesh') { await initNavNode(); NavBridge.clock = () => performance.now(); }
/** per sampled tick (first pass): the ms spent in navigation; each map's navmesh build (ms) */
const navRaw: number[] = [], navBuilds: string[] = [];
/** per sampled tick (first pass): the ms spent in physics queries */
const physRaw: number[] = [];
const target = Number(process.argv.find((a, i) => i >= 2 && /^\d+$/.test(a) && process.argv[i - 1] !== '--repeat') ?? 500);
const repeat = Math.max(1, Number(process.argv[process.argv.indexOf('--repeat') + 1]) || 1);
const aimed = process.argv.includes('--aim');
// `--viewsight` turns rules.aim.viewSight on (CL: spatial shots launch from and are checked from the anatomical eye)
const viewSight = process.argv.includes('--viewsight');
const raw: number[] = [], best: number[] = [];
let coated = 0, coatSamples = 0;
for (const [species, seed] of [['totodile', 1], ['cyndaquil', 2], ['bulbasaur', 3]] as [string, number][]) {
  let mins: Float64Array | null = null, mask: Uint8Array | null = null;
  for (let r = 0; r < (process.argv.includes('--repeat') ? repeat : 1); r++) {
    const ctx = createRun({ seed, species, mods: [crowd(target)], ruleOverrides: { physics: { engine }, nav: { engine: navEngine }, ...(viewSight ? { aim: { viewSight: true } } : {}) } as never });
    if (r === 0 && ctx.nav) navBuilds.push(`${species} seed ${seed} ${ctx.nav.buildMs.map((v) => v.toFixed(0)).join('+')} ms`);
    const times: number[] = [], inBand: number[] = [];
    // keep the bot alive so the crowd can build
    while (ctx.time < 240) {
      assertRunning(ctx, 'perf-sim');
      ctx.player.hp = ctx.player.maxHp;
      const inp = aimed ? withAim(ctx, botInput(ctx)) : botInput(ctx);
      const pw = ctx.physics?.physics, pm0 = pw ? pw.stats.ms : 0, nm0 = ctx.nav ? ctx.nav.ms : 0;
      const t0 = performance.now();
      step(ctx, inp);
      const dt = performance.now() - t0;
      const pw1 = ctx.physics?.physics, pms = pw1 ? (pw1 === pw ? pw1.stats.ms - pm0 : pw1.stats.ms) : 0;
      const n = ctx.enemies.count;
      const ok = n > target * 0.9 && n < target * 1.1;
      times.push(dt); inBand.push(ok ? 1 : 0);
      if (r === 0 && ok) {
        raw.push(dt); physRaw.push(pms); navRaw.push(ctx.nav ? ctx.nav.ms - nm0 : 0);
        if (ctx.tick % 60 === 0) { let c = 0; for (let i = 0; i < ctx.enemies.hi; i++) if (ctx.enemies.alive[i] && ctx.enemies.coat[i]) c++; coated += c; coatSamples++; }
      }
    }
    if (!mins) { mins = Float64Array.from(times); mask = Uint8Array.from(inBand); }
    else for (let i = 0; i < Math.min(mins.length, times.length); i++) mins[i] = Math.min(mins[i], times[i]);
  }
  for (let i = 0; i < mins!.length; i++) if (mask![i]) best.push(mins![i]);
}
const pct = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return (p: number) => s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const line = (a: number[]) => { const q = pct(a); return `p50 ${q(0.5).toFixed(3)} ms  p95 ${q(0.95).toFixed(3)} ms  p99 ${q(0.99).toFixed(3)} ms  max ${q(1).toFixed(3)} ms`; };
console.log(`ticks sampled at ~${target} enemies: ${raw.length}${aimed ? ' (spatial aim: crosshair ray on every input)' : ''}, physics ${engine}, nav ${navEngine}`);
console.log(line(raw));
const gateOn = repeat > 1 ? best : raw;
if (repeat > 1) console.log(`min of ${repeat}: ${line(best)}`);
if (engine === 'rapier') {
  // physics' share: its time on the ticks at and above the tick-time p95, and its own percentiles
  const order = raw.map((_, i) => i).sort((a, b) => raw[a] - raw[b]), top = order.slice(Math.floor(0.95 * order.length));
  const tickSum = top.reduce((s, i) => s + raw[i], 0), physSum = top.reduce((s, i) => s + physRaw[i], 0);
  const pq = pct(physRaw), mean = physRaw.reduce((a, b) => a + b, 0) / Math.max(1, physRaw.length), tmean = raw.reduce((a, b) => a + b, 0) / Math.max(1, raw.length);
  console.log(`physics (Rapier queries) per tick: mean ${mean.toFixed(3)} ms (${((100 * mean) / tmean).toFixed(1)} % of the mean tick)  p50 ${pq(0.5).toFixed(3)}  p95 ${pq(0.95).toFixed(3)}  p99 ${pq(0.99).toFixed(3)} ms; on the ticks at or above the tick p95: ${((100 * physSum) / tickSum).toFixed(1)} % of their time`);
}
if (navEngine === 'navmesh') {
  // navigation's share, as physics' above
  const order = raw.map((_, i) => i).sort((a, b) => raw[a] - raw[b]), top = order.slice(Math.floor(0.95 * order.length));
  const tickSum = top.reduce((s, i) => s + raw[i], 0), navSum = top.reduce((s, i) => s + navRaw[i], 0);
  const nq = pct(navRaw), mean = navRaw.reduce((a, b) => a + b, 0) / Math.max(1, navRaw.length), tmean = raw.reduce((a, b) => a + b, 0) / Math.max(1, raw.length);
  console.log(`navigation (navmesh) per tick: mean ${mean.toFixed(3)} ms (${((100 * mean) / tmean).toFixed(1)} % of the mean tick)  p50 ${nq(0.5).toFixed(3)}  p95 ${nq(0.95).toFixed(3)}  p99 ${nq(0.99).toFixed(3)}  max ${nq(1).toFixed(3)} ms; on the ticks at or above the tick p95: ${((100 * navSum) / tickSum).toFixed(1)} % of their time`);
  console.log(`navmesh builds at map entry: ${navBuilds.join(', ')}`);
}
console.log(`coated enemies on average: ${(coated / Math.max(1, coatSamples)).toFixed(0)}`);
// gates (blueprint section 12): p95 <= 2 ms, p99 <= 3 ms at about 500 enemies. `--gate` makes a miss fail the run.
const q = pct(gateOn), p95ok = q(0.95) <= 2, p99ok = q(0.99) <= 3;
console.log(`gate (${repeat > 1 ? 'min of ' + repeat : 'raw'}) p95 <= 2 ms: ${p95ok ? 'PASS' : 'FAIL'}   p99 <= 3 ms: ${p99ok ? 'PASS' : 'FAIL'}`);
if (process.argv.includes('--gate') && !(p95ok && p99ok)) process.exitCode = 1;
