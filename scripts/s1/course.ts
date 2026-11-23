// S1 spike §3/§4: the 60 s controller course on the range, hashed every tick; the CI workflow runs this too.
// npx tsx scripts/s1/course.ts [variant] [--quiet]
import { initRapierNode, type Variant } from '../../src/physics/node';
import { runCourse, runPile } from './courselib';
import { rangeModel } from './maps';
import type { Representation } from '../../src/physics/colliders';

const variant = (process.argv[2] ?? 'deterministic') as Variant;
const quiet = process.argv.includes('--quiet');
const { R } = await initRapierNode(variant);
const { M } = rangeModel();
console.log(`S1 course: @dimforge/rapier3d-${variant} ${R.version()} on ${process.platform}-${process.arch} node ${process.version}`);
const cases: [Representation, number, string][] = [['boxes', 0, 'boxes'], ['chunks', 0, 'chunks'], ['chunks', R.TriMeshFlags.FIX_INTERNAL_EDGES, 'chunks+FIE'], ['boxmesh', 0, 'boxmesh'], ['boxmesh', R.TriMeshFlags.FIX_INTERNAL_EDGES, 'boxmesh+FIE'], ['heightfield', 0, 'heightfield']];
for (const [rep, fl, name] of cases) {
  const { runs, hash, stepMs } = runCourse(R, M, rep, 60, fl);
  console.log(`HASH ${name.padEnd(12)} ${hash}`);
  console.log(`TIME ${name.padEnd(12)} controller+step ${(stepMs / 3600 / runs.length * 1000).toFixed(1)} µs per body-tick`);
  for (const r of runs) {
    console.log(`  ${r.id.padEnd(6)} r ${r.radius} h ${r.height} hash ${r.hash} end ${r.end.map((v) => v.toFixed(6)).join(',')}`);
    console.log(`  COVER ${r.id.padEnd(6)} legs ${r.legsDone} skipped [${r.skipped.join(',')}] ledge ${r.ledgeTicks} stairsMaxY ${r.stairsMaxY.toFixed(2)} deck ${r.deckTicks} under ${r.underDeckTicks} jumps ${r.jumps} slide ${r.slideDist.toFixed(2)} m collisions ${r.collisions}`);
    if (!quiet) console.log(`         10 s checkpoints ${r.checkpoints.join(' ')}`);
  }
}
for (const rep of ['boxes', 'boxmesh', 'heightfield'] as Representation[]) console.log(`HASH pile+queries ${rep.padEnd(11)} ${runPile(R, M, rep)}`);
