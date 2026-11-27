// I1c stress: 500 enemies crossing drop links at once (owner's Q1, 2026-11-27): npx tsx scripts/dropstress.ts [map] [seed]
// [--n 500] [--seconds 20]. Both flags on. The trainer stands on the landing polygon that the most drop links reach (no
// input, kept alive); n enemies (by width group: Pikachu narrow, Heracross large, Onix xl, in proportion to each group's
// links) start on the top polygons of the links that bring them nearer to it, a little back from the edge. No spawns, no
// relocation. Reports the tick time (performance.now, never in sim output), what the movement did (sim/enemy3d.ts
// actorStats) and where the walkers ended: on the mesh, on a link, off the mesh; and how many came down.
import { initPhysicsNode } from '../src/physics/node';
import { initNavNode } from '../src/nav/node';
import { createRun, disposeRun, step } from '../src/sim/run';
import { spawnEnemy } from '../src/sim/enemies';
import { NO_INPUT } from '../src/sim/types';
import { NavBridge } from '../src/sim/navseam';
import { worldOf } from '../src/sim/worldquery';
import { actorStats } from '../src/sim/enemy3d';
import { assertRunning } from './lib/ended';
import { RANGE } from '../src/mods';
import type { Drop } from '../src/nav/graph';

await initPhysicsNode();
await initNavNode();
const arg = (k: string, d: string) => (process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : d);
const pos = process.argv.slice(2).filter((a, i, A) => !a.startsWith('--') && !(i > 0 && A[i - 1].startsWith('--')));
const map = pos[0] ?? 'river-gorge', seed = Number(pos[1] ?? 1), n = Number(arg('--n', '500')), seconds = Number(arg('--seconds', '20'));
const wg = { mode: 'generated', regionSeed: seed, locations: { meadow: map, dusk: map, badlands: map, frost: map } };
const ctx = createRun({ mode: RANGE, seed, species: 'totodile', ruleOverrides: { worldgen: wg, physics: { engine: 'rapier' }, nav: { engine: 'navmesh' }, enemy: { despawnDistance: 1e9, holdRelocate: 1e9 } } as never });
step(ctx, NO_INPUT);
const W = worldOf(ctx), B = ctx.nav!, N = B.nav!, P = ctx.player;
// the landing the most narrow links reach
const count = new Map<number, number>();
for (const D of N.drops(0)) count.set(D.to, (count.get(D.to) ?? 0) + 1);
const [land] = [...count.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0];
const L0 = N.drops(0).find((D) => D.to === land)!;
const gx = (L0.ax + L0.bx) / 2 + L0.nx * (L0.d + 1.5), gz = (L0.az + L0.bz) / 2 + L0.nz * (L0.d + 1.5);
P.x = P.px = gx; P.z = P.pz = gz; P.y = P.py = W.surfaceAt(gx, L0.y1, gz); P.vx = P.vz = P.vy = 0;
step(ctx, NO_INPUT);
// the links of each group that bring a walker nearer to the trainer
const SPECIES = ['pikachu', 'heracross', 'onix'];
const useful: Drop[][] = [0, 1, 2].map((g) => {
  const F = B.fieldOf(W, 'player', g);
  return N.drops(g).filter((D) => F && F.cost[D.from] < Infinity && F.cost[D.to] < F.cost[D.from] && F.next[D.from] === D.to);
});
const total = useful.reduce((s, u) => s + u.length, 0);
let spawned = 0;
for (let g = 0; g < 3; g++) {
  const want = Math.round((n * useful[g].length) / Math.max(1, total));
  for (let k = 0; k < want && spawned < n && useful[g].length; k++) {
    const D = useful[g][k % useful[g].length], t = ((k * 0.618) % 1), back = 0.3 + (Math.floor(k / useful[g].length) % 4) * 0.5;
    const x = D.ax + (D.bx - D.ax) * t - D.nx * back, z = D.az + (D.bz - D.az) * t - D.nz * back;
    if (spawnEnemy(ctx, SPECIES[g], x, z) >= 0) spawned++;
  }
}
const E = ctx.enemies, top = new Float64Array(E.hi);
for (let i = 0; i < E.hi; i++) top[i] = E.y[i];
NavBridge.clock = null;
const times: number[] = [];
while (ctx.time < seconds) {
  assertRunning(ctx, 'dropstress');
  P.hp = P.maxHp; P.iframes = 1;
  const t0 = performance.now();
  step(ctx, NO_INPUT);
  times.push(performance.now() - t0);
}
const q = (p: number) => { const s = [...times].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
let onMesh = 0, onLink = 0, off = 0, alive = 0, down = 0;
for (let i = 0; i < E.hi; i++) if (E.alive[i]) { alive++; if (E.mesh[i] === 0) onMesh++; else if (E.mesh[i] === 1) onLink++; else off++; if (E.y[i] < top[i] - 0.5) down++; }
const S = actorStats(B);
console.log(`${map} seed ${seed}: ${spawned} enemies on the tops of ${total} links toward the trainer (narrow ${useful[0].length}, large ${useful[1].length}, xl ${useful[2].length}); ${seconds} s`);
console.log(`tick: p50 ${q(0.5).toFixed(3)} ms  p95 ${q(0.95).toFixed(3)} ms  p99 ${q(0.99).toFixed(3)} ms  max ${q(1).toFixed(3)} ms`);
console.log(`movement: links taken ${S.drops}, landed ${S.landed}, off the mesh ${S.offMesh}, rejoined ${S.rejoined}, walked back ${S.rescues} ticks, put back ${S.putBacks}, link timeouts ${S.timeouts}; rays ${S.rays}, sweeps ${S.sweeps}`);
console.log(`at the end: ${alive} alive, ${down} came down at least 0.5 m; on the mesh ${onMesh}, on a link ${onLink}, off the mesh ${off}`);
disposeRun(ctx);
