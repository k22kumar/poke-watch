// The top/side tone lint (WORLDGEN3D Q23.3; docs/looksheet mark 1): for each look-sheet variant, each role the tile
// maps write and each map's binding at its fixed hour, the worst-case ΔL* between a role's resolved top and its
// brightest side (src/render/world3d/tones.ts). A variant passes when every gap is ≥ 12 (render/metrics.ts's
// camouflage line).
// npx tsx scripts/toplint.ts [--json]          the look sheet's variants
// npx tsx scripts/toplint.ts --sweep [--json]  round 2's sweep: key share × fixed hour × facet mode (docs/looksheet)
// npx tsx scripts/toplint.ts --holdouts [--json]  the shipped profile on the hold-out maps
import type { MaterialRole } from '../src/rules/materialroles';
import { resolve } from '../src/rules/styles/resolve';
import { devLayer } from '../src/render/world3d/devlayer';
import { lightAt } from '../src/render/world3d/lighting';
import { topSideGap } from '../src/render/world3d/tones';
import { HOLD_OUT_MAPS, LOOK_MAPS as TUNING_MAPS, LOOK_VARIANTS as GRID } from './lib/looksheet';

// --holdouts: the shipped profile on the hold-out maps' bindings (after the owner's pick)
const holdouts = process.argv.includes('--holdouts');
const LOOK_MAPS = holdouts ? HOLD_OUT_MAPS : TUNING_MAPS;
const LOOK_VARIANTS = holdouts ? [{ id: 'pick', query: '' }] : GRID;

/** the roles the tile adapter writes (src/world/adapter.ts header) */
const WRITTEN: MaterialRole[] = ['ground', 'path', 'soil', 'rock', 'cliff', 'floor', 'cover', 'foliage', 'trunk'];
export const TOP_SIDE_MIN = 12;

if (process.argv.includes('--sweep')) {
  const out = [];
  for (const share of [0.65, 0.75, 0.85]) for (const hour of [10, 11]) for (const [facetName, facet, mode] of [['0', 0, 'plane'], ['±0.06 by plane', 0.06, 'plane'], ['oriented 0.06', 0.06, 'oriented']] as const) {
    const per = LOOK_MAPS.map((m) => {
      const S = resolve('lowpoly', m.binding, { overlay: { keyShare: share, hour, paint: { facetTone: facet, facetMode: mode } } });
      const L = lightAt(S.time, S.time.hour);
      return { map: m.id, gaps: WRITTEN.map((role) => ({ role, ...topSideGap(S, L, role) })) };
    });
    const minBy = (role: MaterialRole) => Math.min(...per.map((p) => p.gaps.find((g) => g.role === role)!.gap));
    const all = per.flatMap((p) => p.gaps);
    const shadowMin = Math.min(...all.map((g) => g.shadowTop));
    const row = { share, hour, facet: facetName, roles: Object.fromEntries(WRITTEN.map((r) => [r, +minBy(r).toFixed(1)])), min: +Math.min(...all.map((g) => g.gap)).toFixed(1), shadowMin: +shadowMin.toFixed(1), crushed: shadowMin < 20 };
    out.push(row);
  }
  if (process.argv.includes('--json')) console.log(JSON.stringify(out));
  else {
    console.log(['share', 'hour', 'facet'.padEnd(15), ...WRITTEN.map((r) => r.padStart(7)), '  min', ' shadowTop L*min'].join(' '));
    for (const r of out) console.log([r.share.toFixed(2).padEnd(5), String(r.hour).padEnd(4), r.facet.padEnd(15), ...WRITTEN.map((x) => String(r.roles[x]).padStart(7)), String(r.min).padStart(5), `   ${r.shadowMin}${r.crushed ? ' crushed' : ''}`].join(' '));
  }
  process.exit(0);
}

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
