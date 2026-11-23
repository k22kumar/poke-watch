// S1 spike §2: collider counts and build time per representation, range and river-gorge seed 1.
// npx tsx scripts/s1/colliders.ts [variant] [repeats]
import { initRapierNode, type Variant } from '../../src/physics/node';
import { buildStatic, type Representation } from '../../src/physics/colliders';
import { gorgeModel, rangeModel } from './maps';

const variant = (process.argv[2] ?? 'deterministic') as Variant, N = Number(process.argv[3] ?? 7);
const { R } = await initRapierNode(variant);
const maps = [['range', rangeModel().M], ['river-gorge@1', gorgeModel(1).M]] as const;
for (const [name, M] of maps) {
  const reps: Representation[] = name === 'range' ? ['boxes', 'chunks', 'boxmesh', 'heightfield'] : ['boxes', 'chunks', 'boxmesh'];
  for (const rep of reps) for (const fl of rep === 'chunks' || rep === 'boxmesh' ? [0, R.TriMeshFlags.FIX_INTERNAL_EDGES] : [0]) {
    const ms: number[] = [], stepMs: number[] = [];
    let last;
    for (let i = 0; i < N; i++) {
      const w = new R.World({ x: 0, y: 0, z: 0 });
      last = buildStatic(R, w, M, rep, { trimeshFlags: fl });
      const t = performance.now(); w.step(); stepMs.push(performance.now() - t); // first step builds the broad phase
      ms.push(last.ms);
      w.free();
    }
    ms.sort((a, b) => a - b); stepMs.sort((a, b) => a - b);
    const s = last!;
    console.log(`${name.padEnd(14)} ${(rep + (fl ? '+FIE' : '')).padEnd(14)} colliders ${String(s.colliders).padStart(5)} (box ${s.boxes}, trimesh ${s.trimeshes}, hf ${s.heightfields}) tris ${String(s.triangles).padStart(6)}  build median ${ms[N >> 1].toFixed(2)} ms (min ${ms[0].toFixed(2)})  first step ${stepMs[N >> 1].toFixed(2)} ms`);
  }
}
