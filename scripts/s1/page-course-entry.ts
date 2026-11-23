// S1 spike §4: the same course and pile in the page (Chromium's V8 wasm), bundled by scripts/s1/page-course.mjs
import { bootRapier } from '../../src/physics/web';
import { runCourse, runPile } from './courselib';
import { rangeModel } from './maps';
import type { Representation } from '../../src/physics/colliders';
(async () => {
  const { R } = await bootRapier();
  const { M } = rangeModel();
  const out: string[] = [];
  const cases: [Representation, number, string][] = [['boxes', 0, 'boxes'], ['chunks', 0, 'chunks'], ['chunks', R.TriMeshFlags.FIX_INTERNAL_EDGES, 'chunks+FIE'], ['boxmesh', 0, 'boxmesh'], ['boxmesh', R.TriMeshFlags.FIX_INTERNAL_EDGES, 'boxmesh+FIE'], ['heightfield', 0, 'heightfield']];
  for (const [rep, fl, name] of cases) {
    const { runs, hash } = runCourse(R, M, rep, 60, fl);
    out.push(`HASH ${name.padEnd(12)} ${hash}`);
    for (const r of runs) out.push(`  ${r.id.padEnd(6)} r ${r.radius} h ${r.height} hash ${r.hash} end ${r.end.map((v) => v.toFixed(6)).join(',')}`);
  }
  for (const rep of ['boxes', 'boxmesh', 'heightfield'] as Representation[]) out.push(`HASH pile+queries ${rep.padEnd(11)} ${runPile(R, M, rep)}`);
  (window as any).s1 = out.join('\n');
})().catch((e) => { (window as any).s1 = 'ERROR ' + e; });
