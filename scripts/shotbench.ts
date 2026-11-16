// The integrated cost of player shots (Phase 2B, docs/THIRD_PERSON_IMPLEMENTATION.md §13.6): the real projectileSystem
// over a live crowd, legacy planar shots (Pr.traj 0: end-of-tick point test, grid order) against linear 3D shots
// (Pr.traj 1: one sweep per shot per tick, contacts in order). `npx tsx scripts/shotbench.ts [--gate]`.
//
// A crowd is built with the bot on Mt. Moon (generated: cliffs, decks, chasms) and on the authored meadow, then frozen
// (enemies' hp raised so nothing dies, so every pass does the same work). Each pass spawns `shots` Ember-like bolts
// (26 m/s, radius 0.4, pierce 2) from points around the partner in fixed random directions, then times
// projectileSystem.update for 60 ticks, restoring the crowd's hp and clearing the events after each tick. Min of 5
// passes; collections are counted (a full collection runs before each timed pass). Gate: the 3D path costs at most
// 3 µs per live shot per tick and collects nothing.
import { PerformanceObserver } from 'node:perf_hooks';
import { setFlagsFromString } from 'node:v8';
import { runInNewContext } from 'node:vm';
import { createRun, step } from '../src/sim/run';
import { botInput } from '../src/sim/bot';
import { projectileSystem } from '../src/sim/effects';
import { PK } from '../src/sim/pools';
import { Rng } from '../src/core/rng';
import type { SimContext } from '../src/sim/types';

setFlagsFromString('--expose_gc');
const fullGc = runInNewContext('gc') as () => void;
let gcs = 0;
new PerformanceObserver((list) => { gcs += list.getEntries().length; }).observe({ entryTypes: ['gc'] });

function crowd(world: 'mt-moon' | 'meadow', target: number): SimContext {
  const overrides: Record<string, unknown> = { director: { spawnBase: 12, spawnPerMin: 6, capBase: target * 1.1, capPerMin: 0 }, enemy: { liveCap: Math.round(target * 1.1) } };
  if (world === 'mt-moon') overrides.worldgen = { mode: 'generated', locations: { meadow: 'mt-moon' } };
  const ctx = createRun({ seed: 2, species: 'cyndaquil', ruleOverrides: overrides as never });
  while (ctx.enemies.count < target * 0.95 && ctx.time < 400) { ctx.player.hp = ctx.player.maxHp; step(ctx, botInput(ctx)); }
  const E = ctx.enemies;
  for (let i = 0; i < E.hi; i++) if (E.alive[i]) { E.maxHp[i] = 1e12; E.hp[i] = 1e12; }
  return ctx;
}

function spawn(ctx: SimContext, shots: number, traj: number) {
  const Pr = ctx.projectiles, P = ctx.player, rng = new Rng(17);
  Pr.clear();
  for (let s = 0; s < shots; s++) {
    const i = Pr.spawn(), a = rng.range(0, Math.PI * 2), r = rng.range(0, 6), pitch = rng.range(-0.15, 0.1);
    const x = P.x + Math.cos(a) * r, z = P.z + Math.sin(a) * r, b = rng.range(0, Math.PI * 2), c = Math.cos(pitch);
    Pr.kind[i] = PK.straight; Pr.traj[i] = traj; Pr.x[i] = x; Pr.z[i] = z; Pr.y[i] = ctx.world.height(x, z) + 0.8;
    Pr.vx[i] = Math.sin(b) * c * 26; Pr.vy[i] = traj ? Math.sin(pitch) * 26 : 0; Pr.vz[i] = Math.cos(b) * c * 26; Pr.speed[i] = 26;
    Pr.life[i] = Pr.maxLife[i] = 1.07; Pr.rem[i] = 27.7; Pr.dmg[i] = 1; Pr.radius[i] = 0.4; Pr.pierce[i] = 2; Pr.move[i] = 0;
    Pr.element[i] = 1; Pr.ox[i] = x; Pr.oz[i] = z; Pr.oy[i] = Pr.y[i];
  }
}

interface Out { usPerTick: number; usPerShotTick: number; gc: number; shotTicks: number }
function measure(ctx: SimContext, shots: number, traj: number): Out {
  const E = ctx.enemies, t0 = ctx.time, tick0 = ctx.tick;
  let best = Infinity, shotTicks = 0, gc = 0;
  for (let pass = 0; pass < 5; pass++) {
    spawn(ctx, shots, traj);
    ctx.time = t0; ctx.tick = tick0;
    fullGc(); const g0 = gcs;
    let ms = 0, live = 0;
    for (let k = 0; k < 60; k++) {
      live += ctx.projectiles.count;
      const a = performance.now();
      projectileSystem.update(ctx, 1 / 60);
      ms += performance.now() - a;
      ctx.events.length = 0; ctx.time += 1 / 60;
      for (let i = 0; i < E.hi; i++) if (E.alive[i]) E.hp[i] = 1e12;
    }
    gc = Math.max(gc, gcs - g0);
    if (ms < best) { best = ms; shotTicks = live; }
  }
  return { usPerTick: (best * 1000) / 60, usPerShotTick: (best * 1000) / Math.max(1, shotTicks), gc, shotTicks };
}

const gate = process.argv.includes('--gate');
let fail = false;
for (const world of ['mt-moon', 'meadow'] as const) {
  const ctx = crowd(world, 475);
  console.log(`${world}: ${ctx.enemies.count} enemies`);
  for (const shots of [50, 300]) {
    // warm both paths first, so neither is measured cold
    measure(ctx, shots, 0); measure(ctx, shots, 1);
    const L = measure(ctx, shots, 0), S = measure(ctx, shots, 1);
    console.log(`  ${String(shots).padStart(3)} shots  legacy ${L.usPerTick.toFixed(1)} µs/tick (${L.usPerShotTick.toFixed(2)} µs per shot-tick, ${L.gc} gc; ${L.shotTicks} shot-ticks)  3D ${S.usPerTick.toFixed(1)} µs/tick (${S.usPerShotTick.toFixed(2)} µs per shot-tick, ${S.gc} gc; ${S.shotTicks} shot-ticks)`);
    if (S.usPerShotTick > 3 || S.gc > 0) fail = true;
  }
}
console.log(`gate (3D ≤ 3 µs per shot-tick, no collection): ${fail ? 'FAIL' : 'PASS'}`);
if (gate && fail) process.exitCode = 1;
