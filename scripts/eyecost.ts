// The cost of the information gate's query (CL-Q7, sim/aim.ts eyeSeesEnemy: two thin rays at most, from the player's
// eye to an enemy's top, then its centre, from the frame's eye: frameEye, one upward ray and one wall check per frame)
// over the scripts/lib/crowd.ts crowd at a target size, on the tile model and on
// Rapier. The query is called by the renderer, not by the tick: this prints what a full pass over every live enemy costs
// per frame, so a rate (staggered, in-view only) can be chosen inside the frame budget.
//   npx tsx scripts/eyecost.ts [target=500]
import { createRun, disposeRun, step } from '../src/sim/run';
import { initPhysicsNode } from '../src/physics/node';
import { botInput } from '../src/sim/bot';
import { crowd } from './lib/crowd';
import { withAim } from './lib/aimbot';
import { eyeSeesEnemy, frameEye } from '../src/sim/aim';
import { worldOf } from '../src/sim/worldquery';
import type { WorldQuery } from '../src/sim/worldquery';

await initPhysicsNode();
const target = Number(process.argv[2] ?? 500);
const pct = (a: number[], p: number) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
for (const engine of ['tiles', 'rapier'] as const) {
  const pass: number[] = [], perRay: number[] = [], seen: number[] = [], quarter: number[] = [], perPass: number[] = [];
  for (const [species, seed] of [['totodile', 1], ['cyndaquil', 2], ['bulbasaur', 3]] as [string, number][]) {
    const ctx = createRun({ seed, species, mods: [crowd(target)], ruleOverrides: { physics: { engine } } as never });
    while (ctx.time < 240) {
      ctx.player.hp = ctx.player.maxHp;
      step(ctx, withAim(ctx, botInput(ctx)));
      const n = ctx.enemies.count;
      if (n < target * 0.9 || n > target * 1.1 || ctx.tick % 10) continue;
      const E = ctx.enemies, W = worldOf(ctx) as WorldQuery & Record<string, unknown>;
      // count every world query the pass makes (the frame's eye included) by wrapping the seam's three query members
      let queries = 0, vis = 0;
      const orig = { raycast: W.raycast, segmentClear: W.segmentClear, solidAt: W.solidAt };
      for (const k of Object.keys(orig) as (keyof typeof orig)[]) { const f = orig[k] as (...a: unknown[]) => unknown; (W as Record<string, unknown>)[k] = (...a: unknown[]) => { queries++; return f.apply(W, a); }; }
      const live: number[] = [];
      for (let i = 0; i < E.hi; i++) if (E.alive[i]) live.push(i);
      let t0 = performance.now();
      const eye = frameEye(ctx);
      for (const i of live) if (eyeSeesEnemy(ctx, eye, i)) vis++;
      const counted = queries;
      Object.assign(W, orig);
      // time the pass again unwrapped, then a staggered pass: a quarter of the crowd (every 4th enemy, by frame phase)
      t0 = performance.now();
      const eye2 = frameEye(ctx);
      for (const i of live) eyeSeesEnemy(ctx, eye2, i);
      const dt = performance.now() - t0;
      const ph = (ctx.tick / 10) & 3;
      const t1 = performance.now();
      const eye3 = frameEye(ctx);
      for (let k = ph; k < live.length; k += 4) eyeSeesEnemy(ctx, eye3, live[k]);
      quarter.push(performance.now() - t1);
      pass.push(dt); perRay.push((dt * 1000) / Math.max(1, counted)); seen.push(vis / n); perPass.push(counted);
    }
    disposeRun(ctx);
  }
  console.log(`${engine.padEnd(6)} ${pass.length} passes over ~${target} enemies: queries per full pass p50 ${pct(perPass, 0.5)} (max ${pct(perPass, 1)}); full pass p50 ${pct(pass, 0.5).toFixed(3)} ms, p95 ${pct(pass, 0.95).toFixed(3)} ms, p99 ${pct(pass, 0.99).toFixed(3)} ms; per query p50 ${pct(perRay, 0.5).toFixed(2)} µs; staggered quarter p95 ${pct(quarter, 0.95).toFixed(3)} ms, p99 ${pct(quarter, 0.99).toFixed(3)} ms; seen ${(100 * pct(seen, 0.5)).toFixed(0)} % (median)`);
}
