// I1c: the cost of the parts an enemy's move on the 3D stack is made of, to compare the designs of the owner's Q1
// (docs/OVERHAUL_3D.md "Actors (I1c)"): npx tsx scripts/actorbench.ts [map] [seed] [--n 500] [--repeat 200]
//   locate   the mesh test of a walking enemy (its move's end on its group's navmesh: options a, c, drop links)
//   ray      the one ground ray per moving enemy per tick (Rapier's support from a step above the feet; every option)
//   sweep    an upright cylinder swept along the tick's move (option b for every enemy; options c and drop links only
//            for an enemy off the mesh or on a link)
//   build    the navmesh build at map entry with and without drop links (their generation and Rapier checks)
// Points: n polygon centres of the narrow group's navmesh (every k-th polygon), each with a tick's move of 0.08 m (a
// 4.8 m/s walker) in a fixed heading per point. Clock: performance.now(), never in sim output.
import { initPhysicsNode } from '../src/physics/node';
import { initNavNode } from '../src/nav/node';
import { createRun, disposeRun, step } from '../src/sim/run';
import { NO_INPUT } from '../src/sim/types';
import { NavBridge } from '../src/sim/navseam';
import { NavGraph } from '../src/nav/graph';
import { worldOf } from '../src/sim/worldquery';
import { RayHit } from '../src/world/sight';
import { RANGE } from '../src/mods';

await initPhysicsNode();
await initNavNode();
const arg = (k: string, d: string) => (process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : d);
const pos = process.argv.slice(2).filter((a, i, A) => !a.startsWith('--') && !(i > 0 && A[i - 1].startsWith('--')));
const map = pos[0] ?? 'river-gorge', seed = Number(pos[1] ?? 1), n = Number(arg('--n', '500')), repeat = Number(arg('--repeat', '200'));
const wg = { mode: 'generated', regionSeed: seed, locations: { meadow: map, dusk: map, badlands: map, frost: map } };
const runOf = (extra: object = {}) => createRun({ mode: RANGE, seed, species: 'totodile', ruleOverrides: { worldgen: wg, physics: { engine: 'rapier' }, nav: { engine: 'navmesh', ...extra } } as never });
const q = (a: number[], p: number) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };

// the build, with drop links and without (rules.nav.drops.max 0: no fall qualifies)
NavBridge.clock = () => performance.now();
NavGraph.clock = () => performance.now();
const builds: Record<string, number[]> = { drops: [], none: [] }, gen: number[] = [];
let info = '';
for (let r = 0; r < 6; r++) for (const v of ['drops', 'none'] as const) {
  const ctx = runOf(v === 'none' ? { drops: { max: 0 } } : {});
  step(ctx, NO_INPUT);
  const B = ctx.nav!;
  if (r > 0) { builds[v].push(B.buildMs[0]); if (v === 'drops') gen.push(B.nav!.graphs.reduce((s, G) => s + G.dropMs, 0)); }
  if (v === 'drops') info = `${B.nav!.graphs.map((G, g) => `${B.nav!.names[g]} ${G.drops.length}`).join(', ')} links; ${B.dropChecks} candidates checked, ${B.dropRefused} refused`;
  disposeRun(ctx);
}
const med = (a: number[]) => q(a, 0.5);
console.log(`${map} seed ${seed}: ${info}`);
console.log(`build at map entry: with drop links median ${med(builds.drops).toFixed(1)} ms, without ${med(builds.none).toFixed(1)} ms (+${(100 * (med(builds.drops) / med(builds.none) - 1)).toFixed(1)} %); link generation and checks median ${med(gen).toFixed(1)} ms`);

// the per-call costs
const ctx = runOf();
step(ctx, NO_INPUT);
const W = worldOf(ctx), B = ctx.nav!, N = B.nav!, P = B.physFor(W), G = N.graphs[0], H = new RayHit(), pt = new Float64Array(3);
const stride = Math.max(1, Math.floor(G.n / n)), pts: number[] = [];
for (let p = 0; p < G.n && pts.length < 4 * n; p += stride) {
  if (G.link[p] >= 0) continue;
  let x = 0, z = 0, y = 0; const o = G.vOff[p], m = G.vOff[p + 1] - o;
  for (let k = 0; k < m; k++) { x += G.vx[o + k]; y += G.vy[o + k]; z += G.vz[o + k]; }
  pts.push(x / m, y / m, z / m, (p * 2.399963) % (2 * Math.PI));
}
const cnt = pts.length / 4;
const time = (f: (x: number, y: number, z: number, a: number) => void) => {
  const per: number[] = [];
  for (let r = 0; r < repeat; r++) {
    const t0 = performance.now();
    for (let i = 0; i < cnt; i++) f(pts[4 * i], pts[4 * i + 1], pts[4 * i + 2], pts[4 * i + 3]);
    per.push(((performance.now() - t0) * 1e3) / cnt);
  }
  return per;
};
const line = (name: string, per: number[]) => console.log(`  ${name.padEnd(7)} per call median ${med(per).toFixed(2)} µs  p95 ${q(per, 0.95).toFixed(2)} µs;  × ${n}: ${((med(per) * n) / 1e3).toFixed(3)} ms a tick`);
console.log(`per-call costs over ${cnt} points (narrow group), ${repeat} rounds:`);
const lo = time((x, y, z, a) => { N.locate(0, x + Math.sin(a) * 0.08, y, z + Math.cos(a) * 0.08, 0, pt); });
const ray = time((x, y, z) => { P.bodySupportBelow(x, y + 0.6, z, 1.3); });
const sw = time((x, y, z, a) => { P.bodySweep(x, y + 0.61 + 0.125, z, Math.sin(a), 0, Math.cos(a), 0.08, 0.4, 0.125, H, true); });
line('locate', lo); line('ray', ray); line('sweep', sw);
const L = med(lo), R = med(ray), S = med(sw);
console.log(`a tick at ${n} enemies, every one moving (the parts only, µs → ms):`);
console.log(`  (a) clamp to the mesh              locate + ray        ${(((L + R) * n) / 1e3).toFixed(3)} ms`);
console.log(`  (b) collider sweep                 sweep + ray         ${(((S + R) * n) / 1e3).toFixed(3)} ms`);
console.log(`  (c) hybrid, k % off the mesh       (a) + k % × sweep   k 5: ${(((L + R) * n + 0.05 * n * S) / 1e3).toFixed(3)} ms, k 20: ${(((L + R) * n + 0.2 * n * S) / 1e3).toFixed(3)} ms`);
console.log(`  drop links                         (c) + the links' build cost above (traversal: sweep + ray per enemy on a link)`);
disposeRun(ctx);
