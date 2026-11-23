// S1 spike §5b: what the alternative to a controller per enemy costs. Per tick for N bodies: (a) world.step() alone
// with N kinematic capsules moved by setNextKinematicTranslation (no controller), (b) N short ground rays (3 m down from
// the hips), (c) N controller moves with no step. npx tsx scripts/s1/cost2.ts [variant] [ticks]
import { initRapierNode, type Variant } from '../../src/physics/node';
import { buildStatic, type Representation } from '../../src/physics/colliders';
import { defaultRules } from '../../src/rules/defaults';
import { DT, makeCharacter } from './courselib';
import { gorgeModel, rangeModel } from './maps';

const variant = (process.argv[2] ?? 'deterministic') as Variant, TICKS = Number(process.argv[3] ?? 400);
const { R } = await initRapierNode(variant);
const G_STATIC = (0x0001 << 16) | 0xffff, G_CHAR = (0x0002 << 16) | 0x0001, Q_STATIC = ((0xffff << 16) | 0x0001) >>> 0;
const pct = (a: number[], p: number) => a[Math.min(a.length - 1, Math.floor(a.length * p))];
const fmt = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return `p50 ${pct(s, 0.5).toFixed(3)} p95 ${pct(s, 0.95).toFixed(3)} p99 ${pct(s, 0.99).toFixed(3)}`; };
function lcg(seed: number) { let s = seed >>> 0; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296); }

console.log(`S1 cost2: rapier3d-${variant} ${process.platform}-${process.arch}, ms per tick`);
for (const [name, m] of [['range', rangeModel()], ['river-gorge@1', gorgeModel(1)]] as const) for (const rep of ['boxes', 'boxmesh'] as Representation[]) for (const n of [50, 150, 500]) {
  const w = new R.World({ x: 0, y: 0, z: 0 });
  buildStatic(R, w, m.M, rep);
  w.forEachCollider((c) => c.setCollisionGroups(G_STATIC));
  const rnd = lcg(7 + n), W = m.W, b = W.bound - 6;
  const bodies = [];
  while (bodies.length < n) {
    const x = (rnd() * 2 - 1) * b, z = (rnd() * 2 - 1) * b;
    if (!W.walkable(x, z) || W.liquidAt(x, z)) continue;
    const c = defaultRules.size.classes[bodies.length % 5];
    const B = makeCharacter(R, w, c.body, c.height, x, W.height(x, z) + 0.05, z);
    B.col.setCollisionGroups(G_CHAR);
    const a = rnd() * 6.283;
    bodies.push({ ...B, dx: Math.cos(a) * 5 * DT, dz: Math.sin(a) * 5 * DT });
  }
  w.step();
  const ray = new R.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 });
  const sA: number[] = [], sB: number[] = [], sC: number[] = [];
  let hits = 0;
  for (let t = 0; t < TICKS; t++) {
    const t0 = performance.now();
    for (const B of bodies) { const p = B.body.translation(); B.body.setNextKinematicTranslation({ x: p.x + B.dx, y: p.y, z: p.z + B.dz }); }
    w.step();
    const t1 = performance.now();
    for (const B of bodies) { const p = B.body.translation(); ray.origin = { x: p.x, y: p.y, z: p.z }; const h = w.castRay(ray, 3, true, undefined, Q_STATIC); if (h) hits++; }
    const t2 = performance.now();
    for (const B of bodies) { B.ctl.computeColliderMovement(B.col, { x: B.dx, y: -0.01, z: B.dz }, undefined, Q_STATIC); B.ctl.computedMovement(); }
    const t3 = performance.now();
    if (t % 100 === 99) for (const B of bodies) { B.dx = -B.dx; B.dz = -B.dz; }
    if (t >= 20) { sA.push(t1 - t0); sB.push(t2 - t1); sC.push(t3 - t2); }
  }
  console.log(`${name.padEnd(14)} ${rep.padEnd(8)} n ${String(n).padStart(3)}  step(kinematic) ${fmt(sA)}  ground rays ${fmt(sB)}  controllers(no step) ${fmt(sC)}  (ray hits ${(hits / TICKS / n * 100).toFixed(0)} %)`);
  w.free();
}
