// S1 spike §5: cost per tick. N capsules (size classes in turn) each resolving a controller move every tick, one
// world.step(); then 100 rays and 20 shape casts per tick. Against perf-sim's budget (p95 2 ms, p99 3 ms per tick for the
// whole sim; today's sim p95 0.689 ms). npx tsx scripts/s1/cost.ts [variant] [ticks]
import type { World as RWorld } from '@dimforge/rapier3d-deterministic/exports';
import { initRapierNode, type Variant } from '../../src/physics/node';
import { buildStatic, type Representation } from '../../src/physics/colliders';
import { defaultRules } from '../../src/rules/defaults';
import { DT, KCC, makeCharacter, type Body } from './courselib';
import { gorgeModel, rangeModel } from './maps';
import type { World } from '../../src/sim/world';

const variant = (process.argv[2] ?? 'deterministic') as Variant, TICKS = Number(process.argv[3] ?? 600);
const { R } = await initRapierNode(variant);
// collision groups: statics in group 1; characters in group 2 and their controller queries see group 1 only
const G_STATIC = (0x0001 << 16) | 0xffff, G_CHAR = (0x0002 << 16) | 0x0001, Q_STATIC = ((0xffff << 16) | 0x0001) >>> 0;

function lcg(seed: number) { let s = seed >>> 0; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296); }
const pct = (a: number[], p: number) => a[Math.min(a.length - 1, Math.floor(a.length * p))];
const fmt = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return `p50 ${pct(s, 0.5).toFixed(3)} p95 ${pct(s, 0.95).toFixed(3)} p99 ${pct(s, 0.99).toFixed(3)} ms`; };

function spots(W: World, n: number, rnd: () => number): [number, number, number][] {
  const out: [number, number, number][] = [];
  const b = W.bound - 6;
  while (out.length < n) {
    const x = (rnd() * 2 - 1) * b, z = (rnd() * 2 - 1) * b;
    if (!W.walkable(x, z) || W.liquidAt(x, z)) continue;
    out.push([x, W.height(x, z), z]);
  }
  return out;
}

function bench(name: string, M: Parameters<typeof buildStatic>[2], W: World, rep: Representation, n: number, queries: boolean) {
  const w: RWorld = new R.World({ x: 0, y: 0, z: 0 });
  w.timestep = DT;
  const st = buildStatic(R, w, M, rep);
  // tag statics
  w.forEachCollider((c) => c.setCollisionGroups(G_STATIC));
  const rnd = lcg(12345 + n);
  const bodies: (Body & { vy: number; dx: number; dz: number })[] = [];
  const C = defaultRules.size.classes;
  for (const [i, p] of spots(W, n, rnd).entries()) {
    const c = C[i % C.length];
    const B = makeCharacter(R, w, c.body, c.height, p[0], p[1] + 0.05, p[2]);
    B.col.setCollisionGroups(G_CHAR);
    const a = rnd() * 6.283;
    bodies.push({ ...B, vy: 0, dx: Math.cos(a), dz: Math.sin(a) });
  }
  w.step();
  const ray = new R.Ray({ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 });
  const ball = new R.Ball(0.3), rot = { x: 0, y: 0, z: 0, w: 1 };
  const tick: number[] = [], ctl: number[] = [], qms: number[] = [];
  let hits = 0;
  for (let t = 0; t < TICKS; t++) {
    const t0 = performance.now();
    for (const B of bodies) {
      if ((t + bodies.length) % 120 === 0) { const a = rnd() * 6.283; B.dx = Math.cos(a); B.dz = Math.sin(a); }
      B.vy -= 30 * DT;
      B.ctl.computeColliderMovement(B.col, { x: B.dx * 5 * DT, y: B.vy * DT, z: B.dz * 5 * DT }, undefined, Q_STATIC);
      const mv = B.ctl.computedMovement();
      if (B.ctl.computedGrounded() && B.vy < 0) B.vy = 0;
      const p = B.body.translation();
      B.body.setNextKinematicTranslation({ x: p.x + mv.x, y: p.y + mv.y, z: p.z + mv.z });
    }
    w.step();
    const t1 = performance.now();
    if (queries) {
      for (let k = 0; k < 100; k++) {
        const B = bodies[k % bodies.length], p = B.body.translation(), a = rnd() * 6.283;
        ray.origin = { x: p.x, y: p.y + 0.3, z: p.z }; ray.dir = { x: Math.cos(a), y: (rnd() - 0.5) * 0.4, z: Math.sin(a) };
        if (w.castRay(ray, 40, true)) hits++;
      }
      for (let k = 0; k < 20; k++) {
        const B = bodies[(k * 7) % bodies.length], p = B.body.translation(), a = rnd() * 6.283;
        if (w.castShape({ x: p.x, y: p.y + 0.5, z: p.z }, rot, { x: Math.cos(a) * 20, y: 0, z: Math.sin(a) * 20 }, ball, 0, 1, true)) hits++;
      }
    }
    const t2 = performance.now();
    if (t >= 30) { ctl.push(t1 - t0); qms.push(t2 - t1); tick.push(t2 - t0); }
  }
  console.log(`${name.padEnd(14)} ${rep.padEnd(8)} n ${String(n).padStart(3)} colliders ${st.colliders}  controllers+step ${fmt(ctl)}${queries ? `  queries ${fmt(qms)}  total ${fmt(tick)}  (hits ${hits})` : ''}`);
  w.free();
}

console.log(`S1 cost: rapier3d-${variant} ${R.version()} ${process.platform}-${process.arch} ${TICKS} ticks (first 30 dropped); KCC offset ${KCC.offset}, autostep ${KCC.autostep}, snap ${KCC.snap}`);
for (const [name, m] of [['range', rangeModel()], ['river-gorge@1', gorgeModel(1)]] as const) {
  for (const rep of ['boxes', 'boxmesh'] as Representation[]) {
    for (const n of [50, 150, 500]) bench(name, m.M, m.W, rep, n, false);
    bench(name, m.M, m.W, rep, 150, true);
  }
}
// queries alone (no characters moving) on each map: the aim / sight cost
for (const [name, m] of [['range', rangeModel()], ['river-gorge@1', gorgeModel(1)]] as const) for (const rep of ['boxes', 'boxmesh'] as Representation[]) bench(name + ' q-only', m.M, m.W, rep, 20, true);
