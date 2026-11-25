// The cost of the information gate's query (CL-Q7, sim/aim.ts eyeSeesEnemy: two thin rays at most, from the player's
// eye to an enemy's top, then its centre) over the scripts/lib/crowd.ts crowd at a target size, on the tile model and on
// Rapier. The query is called by the renderer, not by the tick: this prints what a full pass over every live enemy costs
// per frame, so a rate (staggered, in-view only) can be chosen inside the frame budget.
//   npx tsx scripts/eyecost.ts [target=500]
import { createRun, disposeRun, step } from '../src/sim/run';
import { initPhysicsNode } from '../src/physics/node';
import { botInput } from '../src/sim/bot';
import { crowd } from './lib/crowd';
import { withAim } from './lib/aimbot';
import { eyeSeesEnemy } from '../src/sim/aim';

await initPhysicsNode();
const target = Number(process.argv[2] ?? 500);
const pct = (a: number[], p: number) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
for (const engine of ['tiles', 'rapier'] as const) {
  const pass: number[] = [], perRay: number[] = [], seen: number[] = [];
  for (const [species, seed] of [['totodile', 1], ['cyndaquil', 2], ['bulbasaur', 3]] as [string, number][]) {
    const ctx = createRun({ seed, species, mods: [crowd(target)], ruleOverrides: { physics: { engine } } as never });
    while (ctx.time < 240) {
      ctx.player.hp = ctx.player.maxHp;
      step(ctx, withAim(ctx, botInput(ctx)));
      const n = ctx.enemies.count;
      if (n < target * 0.9 || n > target * 1.1 || ctx.tick % 10) continue;
      const E = ctx.enemies;
      let rays = 0, vis = 0;
      const t0 = performance.now();
      for (let i = 0; i < E.hi; i++) if (E.alive[i]) { const v = eyeSeesEnemy(ctx, i); rays += v ? 1 : 2; if (v) vis++; }
      const dt = performance.now() - t0;
      pass.push(dt); perRay.push((dt * 1000) / Math.max(1, rays)); seen.push(vis / n);
    }
    disposeRun(ctx);
  }
  console.log(`${engine.padEnd(6)} ${pass.length} passes over ~${target} enemies: full pass p50 ${pct(pass, 0.5).toFixed(3)} ms, p95 ${pct(pass, 0.95).toFixed(3)} ms, p99 ${pct(pass, 0.99).toFixed(3)} ms; per ray p50 ${pct(perRay, 0.5).toFixed(2)} µs; seen ${(100 * pct(seen, 0.5)).toFixed(0)} % (median)`);
}
