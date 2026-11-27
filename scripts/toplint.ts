// The top/side tone lint (WORLDGEN3D Q23.3; docs/looksheet mark 1): for each look-sheet variant, each role the tile
// maps write and each map's binding at its fixed hour, the worst-case ΔL* between a role's resolved top and its
// brightest side (src/render/world3d/tones.ts). A variant passes when every gap is ≥ 12 (render/metrics.ts's
// camouflage line).
// npx tsx scripts/toplint.ts [--json]
import type { MaterialRole } from '../src/rules/materialroles';
import { resolve } from '../src/rules/styles/resolve';
import { devLayer } from '../src/render/world3d/devlayer';
import { lightAt } from '../src/render/world3d/lighting';
import { topSideGap } from '../src/render/world3d/tones';
import { LOOK_MAPS, LOOK_VARIANTS } from './lib/looksheet';

/** the roles the tile adapter writes (src/world/adapter.ts header) */
const WRITTEN: MaterialRole[] = ['ground', 'path', 'soil', 'rock', 'cliff', 'floor', 'cover', 'foliage', 'trunk'];
export const TOP_SIDE_MIN = 12;

const rows = LOOK_VARIANTS.map((v) => {
  const per = LOOK_MAPS.map((m) => {
    const S = resolve('lowpoly', m.binding, { overlay: devLayer(new URLSearchParams(v.query)) });
    const L = lightAt(S.time, S.time.hour);
    const gaps = WRITTEN.map((role) => ({ role, ...topSideGap(S, L, role) }));
    const worst = gaps.reduce((a, b) => (b.gap < a.gap ? b : a));
    return { map: m.id, worst, gaps };
  });
  const worst = per.flatMap((p) => p.gaps.map((g) => ({ map: p.map, ...g }))).reduce((a, b) => (b.gap < a.gap ? b : a));
  return { id: v.id, pass: worst.gap >= TOP_SIDE_MIN, worst, per };
});
if (process.argv.includes('--json')) console.log(JSON.stringify(rows));
else for (const r of rows) {
  const meanMin = Math.min(...r.per.flatMap((p) => p.gaps.map((g) => g.meanGap)));
  console.log(`${r.id.padEnd(8)} ${r.pass ? 'pass' : 'FAIL'}  min ΔL* ${r.worst.gap.toFixed(1)} (${r.worst.map} ${r.worst.role})   info: min mean-side ΔL* ${meanMin.toFixed(1)}`);
  for (const p of r.per) console.log(`         ${p.map.padEnd(6)} ${p.gaps.map((g) => `${g.role} ${g.gap.toFixed(1)}`).join('  ')}`);
}
