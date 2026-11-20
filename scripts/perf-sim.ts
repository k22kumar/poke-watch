// Headless sim cost per tick at a given crowd size: `npx tsx scripts/perf-sim.ts [target=500] [--repeat N] [--gate] [--caps-off] [--aim]`.
// `--aim` adds a chase-camera crosshair ray to the bot's input (scripts/lib/aimbot.ts), so the direct shots fly the
// spatial path (sim/aim.ts, 3D swept shots): the integrated cost of Phase 2B under a full crowd.
// The crowd is scripts/lib/crowd.ts (chase walkers kept at the target on the spawn ring; Q21 as amended 2026-11-20:
// not training targets, which skip the flow-field chase the co-op wave will pay for). The player is made unkillable,
// then tick times are sampled while the live count sits within ±10% of the target.
//
// `--repeat N` replays every run N times and keeps, for each tick, the fastest of the N timings. The runs are
// deterministic, so tick i does the same work each time: the minimum strips scheduler and GC noise, which on a
// shared machine can triple the raw p99. Both the raw (first pass) and the min-of-N percentiles are printed;
// the gates (blueprint section 12: p95 <= 2 ms, p99 <= 3 ms) read the min-of-N numbers when N > 1.
import { createRun, step } from '../src/sim/run';
import { botInput } from '../src/sim/bot';
import { withAim } from './lib/aimbot';
import { sizeLabel, sizeOverride } from './lib/sizeflags';

import { assertRunning } from './lib/ended';
import { crowd } from './lib/crowd';
const target = Number(process.argv.find((a, i) => i >= 2 && /^\d+$/.test(a) && process.argv[i - 1] !== '--repeat') ?? 500);
const repeat = Math.max(1, Number(process.argv[process.argv.indexOf('--repeat') + 1]) || 1);
const capsOff = process.argv.includes('--caps-off');
const aimed = process.argv.includes('--aim');
const raw: number[] = [], best: number[] = [];
let coated = 0, coatSamples = 0;
for (const [species, seed] of [['totodile', 1], ['cyndaquil', 2], ['bulbasaur', 3]] as [string, number][]) {
  let mins: Float64Array | null = null, mask: Uint8Array | null = null;
  for (let r = 0; r < (process.argv.includes('--repeat') ? repeat : 1); r++) {
    const ctx = createRun({ seed, species, mods: [crowd(target)], ruleOverrides: { ...(capsOff ? { caps: { enabled: false } } : {}), ...sizeOverride() } as never });
    const times: number[] = [], inBand: number[] = [];
    // keep the bot alive so the crowd can build
    while (ctx.time < 240) {
      assertRunning(ctx, 'perf-sim');
      ctx.player.hp = ctx.player.maxHp;
      const inp = aimed ? withAim(ctx, botInput(ctx)) : botInput(ctx);
      const t0 = performance.now();
      step(ctx, inp);
      const dt = performance.now() - t0;
      const n = ctx.enemies.count;
      const ok = n > target * 0.9 && n < target * 1.1;
      times.push(dt); inBand.push(ok ? 1 : 0);
      if (r === 0 && ok) {
        raw.push(dt);
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
console.log(sizeLabel);
console.log(`ticks sampled at ~${target} enemies: ${raw.length}${capsOff ? ' (capability layer off)' : ''}${aimed ? ' (spatial aim: crosshair ray on every input)' : ''}`);
console.log(line(raw));
const gateOn = repeat > 1 ? best : raw;
if (repeat > 1) console.log(`min of ${repeat}: ${line(best)}`);
console.log(`coated enemies on average: ${(coated / Math.max(1, coatSamples)).toFixed(0)}`);
// gates (blueprint section 12): p95 <= 2 ms, p99 <= 3 ms at about 500 enemies. `--gate` makes a miss fail the run.
const q = pct(gateOn), p95ok = q(0.95) <= 2, p99ok = q(0.99) <= 3;
console.log(`gate (${repeat > 1 ? 'min of ' + repeat : 'raw'}) p95 <= 2 ms: ${p95ok ? 'PASS' : 'FAIL'}   p99 <= 3 ms: ${p99ok ? 'PASS' : 'FAIL'}`);
if (process.argv.includes('--gate') && !(p95ok && p99ok)) process.exitCode = 1;
