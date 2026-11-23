// S1 spike §6: create and free 100 worlds in one process (river-gorge@1 boxes + the course's 5 controllers, 60 steps,
// 100 rays each), JS heap and wasm linear memory before and after; then the same without free() for contrast.
// node --expose-gc via tsx: npx tsx --expose-gc scripts/s1/memory.ts [variant]
import { initRapierNode, type Variant } from '../../src/physics/node';
import { rapierMemory } from '../../src/physics/rapier';
import { buildStatic } from '../../src/physics/colliders';
import { defaultRules } from '../../src/rules/defaults';
import { makeCharacter } from './courselib';
import { gorgeModel } from './maps';

const variant = (process.argv[2] ?? 'deterministic') as Variant;
const { R } = await initRapierNode(variant);
const { M } = gorgeModel(1);
const gc = (globalThis as { gc?: () => void }).gc ?? (() => {});
const mem = () => { gc(); gc(); return { heap: process.memoryUsage().heapUsed, wasm: rapierMemory()!.buffer.byteLength }; };
const MB = (b: number) => (b / 1048576).toFixed(1) + ' MB';

function oneWorld(free: boolean) {
  const w = new R.World({ x: 0, y: -30, z: 0 });
  buildStatic(R, w, M, 'boxes');
  const bodies = defaultRules.size.classes.map((c, i) => makeCharacter(R, w, c.body, c.height, -20 + i * 3, 6.05, 20));
  const ray = new R.Ray({ x: 0, y: 10, z: 0 }, { x: 0, y: -1, z: 0 });
  for (let t = 0; t < 60; t++) {
    for (const B of bodies) { B.ctl.computeColliderMovement(B.col, { x: 0.05, y: -0.05, z: 0 }); const m = B.ctl.computedMovement(), p = B.body.translation(); B.body.setNextKinematicTranslation({ x: p.x + m.x, y: p.y + m.y, z: p.z + m.z }); }
    w.step();
  }
  for (let k = 0; k < 100; k++) { ray.origin = { x: (k % 20) - 10, y: 20, z: ((k / 20) | 0) - 2 }; w.castRay(ray, 40, true); }
  if (free) w.free();
}

const m0 = mem();
console.log(`S1 memory: rapier3d-${variant}; start heap ${MB(m0.heap)}, wasm ${MB(m0.wasm)}`);
oneWorld(true);
const m1 = mem();
console.log(`after 1 world (freed): heap ${MB(m1.heap)}, wasm ${MB(m1.wasm)}`);
for (let i = 0; i < 100; i++) oneWorld(true);
const m2 = mem();
console.log(`after 100 more worlds, each freed: heap ${MB(m2.heap)} (Δ ${MB(m2.heap - m1.heap)}), wasm ${MB(m2.wasm)} (Δ ${MB(m2.wasm - m1.wasm)})`);
for (let i = 0; i < 100; i++) oneWorld(true);
const m3 = mem();
console.log(`after 100 more, each freed: heap ${MB(m3.heap)} (Δ ${MB(m3.heap - m2.heap)}), wasm ${MB(m3.wasm)} (Δ ${MB(m3.wasm - m2.wasm)})`);
for (let i = 0; i < 100; i++) oneWorld(false);
const m4 = mem();
console.log(`after 100 worlds NOT freed (JS wrappers dropped, GC run): heap ${MB(m4.heap)} (Δ ${MB(m4.heap - m3.heap)}), wasm ${MB(m4.wasm)} (Δ ${MB(m4.wasm - m3.wasm)})`);
await new Promise((r) => setTimeout(r, 200));
const m5 = mem();
console.log(`  +200 ms and GC again (FinalizationRegistry): heap ${MB(m5.heap)}, wasm ${MB(m5.wasm)}`);
for (let i = 0; i < 100; i++) oneWorld(true);
const m6 = mem();
console.log(`then 100 freed worlds again: wasm ${MB(m6.wasm)} (Δ ${MB(m6.wasm - m5.wasm)}): freed memory is reused, never returned`);
