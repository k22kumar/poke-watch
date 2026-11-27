// The top/side tone lint (WORLDGEN3D Q23.3; docs/looksheet mark 1): for each look-sheet variant, each role the tile
// maps write and each map's binding at its fixed hour, the worst-case ΔL* between a role's resolved top and its
// brightest side (src/render/world3d/tones.ts). A variant passes when every gap is ≥ 12 (render/metrics.ts's
// camouflage line).
// npx tsx scripts/toplint.ts [--json]          the look sheet's variants
// npx tsx scripts/toplint.ts --sweep [--json]  round 2's sweep: key share × fixed hour × facet mode (docs/looksheet)
// npx tsx scripts/toplint.ts --holdouts [--json]  the shipped profile on the hold-out maps
// npx tsx scripts/toplint.ts --holdout-sweep [--json]  the cave and night sweep, one table per hold-out map
// npx tsx scripts/toplint.ts --key-sweep [--json]  Chargestone's key sweep: ambient held, the key light raised in steps
import type { StyleRole } from '../src/rules/styles/bindings';
import { resolve } from '../src/rules/styles/resolve';
import { devLayer } from '../src/render/world3d/devlayer';
import { lightAt } from '../src/render/world3d/lighting';
import { faceTone, topSideGap } from '../src/render/world3d/tones';
import { HOLD_OUT_MAPS, HOLD_OUT_SWEEP, KEY_SWEEP, MARK1_ROLES, SIDE_OF, LOOK_MAPS as TUNING_MAPS, LOOK_VARIANTS as GRID } from './lib/looksheet';

// --holdouts: the shipped profile on the hold-out maps' bindings (after the owner's pick)
const holdouts = process.argv.includes('--holdouts');
const LOOK_MAPS = holdouts ? HOLD_OUT_MAPS : TUNING_MAPS;
const LOOK_VARIANTS = holdouts ? [{ id: 'pick', query: '' }] : GRID;

/** mark 1's roles (scripts/lib/looksheet.ts MARK1_ROLES: trunk replaced by endgrain on 2026-11-27, so tables printed
 *  before that date list trunk) */
const WRITTEN: StyleRole[] = MARK1_ROLES;
const gapOf = (S: Parameters<typeof topSideGap>[0], L: Parameters<typeof topSideGap>[1], role: StyleRole) => topSideGap(S, L, role, SIDE_OF[role]);
export const TOP_SIDE_MIN = 12;

if (process.argv.includes('--key-sweep')) {
  // the owner's Chargestone sweep (2026-11-27): the ambient held at the lowest share (to 0.01) that keeps every shadowed
  // top at L* ≥ 20, then the key light raised from 1 − ambient in steps of KEY_SWEEP.step until every role reaches 12 or
  // a top on the map clips (a channel of the brightest open top, before fog and grading, at or over 1: the output step
  // has no tone mapping). Facet tone is the profile's for caves (±0.10)
  const K = KEY_SWEEP, m = HOLD_OUT_MAPS.find((x) => x.id === K.map)!;
  const at = (q: string) => {
    const S = resolve('lowpoly', m.binding, { overlay: devLayer(new URLSearchParams(q)) });
    const L = lightAt(S.time, S.time.hour);
    const gaps = WRITTEN.map((role) => ({ role, ...gapOf(S, L, role) }));
    const peak = Object.fromEntries(WRITTEN.map((role) => [role, Math.max(...faceTone(S, L, role, [0, 1, 0]))]));
    return { S, gaps, peak, shadowMin: Math.min(...gaps.map((g) => g.shadowTop)), min: Math.min(...gaps.map((g) => g.gap)) };
  };
  let amb = 1;
  for (let a = 100; a >= 1; a--) { const r = at(`key=${1 - a / 100}&amb=${a / 100}`); if (r.shadowMin < 20) break; amb = a / 100; }
  const rows = [];
  for (let i = 0; i < K.maxSteps; i++) {
    const key = +(1 - amb + i * K.step).toFixed(2), query = `key=${key}&amb=${amb}`, r = at(query);
    const clipped = K.onMap.filter((role) => r.peak[role] >= 1);
    rows.push({ id: `a${Math.round(amb * 100)}-k${Math.round(key * 100)}`, query, key, ambient: amb, facet: r.S.paint.facetTone, roles: Object.fromEntries(r.gaps.map((g) => [g.role, +g.gap.toFixed(1)])), shadow: Object.fromEntries(r.gaps.map((g) => [g.role, +g.shadowTop.toFixed(1)])), peak: Object.fromEntries(WRITTEN.map((x) => [x, +r.peak[x].toFixed(3)])), min: +r.min.toFixed(1), shadowMin: +r.shadowMin.toFixed(1), clipped, pass: r.min >= 12 && r.shadowMin >= 20 && !clipped.length });
    if (r.min >= 12 || clipped.length) break;
  }
  if (process.argv.includes('--json')) console.log(JSON.stringify(rows));
  else {
    console.log(`${K.map}: ambient held at ${amb} (lowest with shadowed tops ≥ 20), facet ±${rows[0].facet}; roles on the map ${K.onMap.join(', ')}`);
    console.log(`  ${'variant'.padEnd(10)} ${WRITTEN.map((r) => r.padStart(7)).join(' ')}    min  shadowTop  peak top (roles on map)`);
    for (const r of rows) console.log(`  ${r.id.padEnd(10)} ${WRITTEN.map((x) => String(r.roles[x]).padStart(7)).join(' ')}  ${String(r.min).padStart(5)}  ${String(r.shadowMin).padStart(9)}  ${Math.max(...K.onMap.map((x) => r.peak[x])).toFixed(3)}${r.clipped.length ? ' clips: ' + r.clipped.join(', ') : ''}${r.pass ? '  pass' : ''}`);
  }
  process.exit(0);
}

if (process.argv.includes('--holdout-sweep')) {
  // one table per hold-out map: mark 1 per role and the shadowed-top L* for every variant of HOLD_OUT_SWEEP
  const out: Record<string, unknown[]> = {};
  for (const m of HOLD_OUT_MAPS) {
    out[m.id] = HOLD_OUT_SWEEP[m.id].map((v) => {
      const S = resolve('lowpoly', m.binding, { overlay: devLayer(new URLSearchParams(v.query)) });
      const L = lightAt(S.time, S.time.hour);
      const gaps = WRITTEN.map((role) => ({ role, ...gapOf(S, L, role) }));
      const min = Math.min(...gaps.map((g) => g.gap)), shadowMin = Math.min(...gaps.map((g) => g.shadowTop));
      return { id: v.id, query: v.query, hour: S.time.hour, roles: Object.fromEntries(gaps.map((g) => [g.role, +g.gap.toFixed(1)])), shadow: Object.fromEntries(gaps.map((g) => [g.role, +g.shadowTop.toFixed(1)])), min: +min.toFixed(1), shadowMin: +shadowMin.toFixed(1), pass: min >= 12 && shadowMin >= 20, crushed: shadowMin < 20 };
    });
  }
  if (process.argv.includes('--json')) console.log(JSON.stringify(out));
  else for (const [map, rows] of Object.entries(out)) {
    console.log(`${map}\n  ${'variant'.padEnd(10)} ${WRITTEN.map((r) => r.padStart(7)).join(' ')}    min  shadowTop L* min`);
    for (const r of rows as any[]) console.log(`  ${r.id.padEnd(10)} ${WRITTEN.map((x) => String(r.roles[x]).padStart(7)).join(' ')}  ${String(r.min).padStart(5)}  ${r.shadowMin}${r.crushed ? ' crushed' : ''}${r.pass ? '  pass' : ''}`);
  }
  process.exit(0);
}

if (process.argv.includes('--sweep')) {
  const out = [];
  for (const share of [0.65, 0.75, 0.85]) for (const hour of [10, 11]) for (const [facetName, facet, mode] of [['0', 0, 'plane'], ['±0.06 by plane', 0.06, 'plane'], ['oriented 0.06', 0.06, 'oriented']] as const) {
    const per = LOOK_MAPS.map((m) => {
      const S = resolve('lowpoly', m.binding, { overlay: { keyShare: share, hour, paint: { facetTone: facet, facetMode: mode } } });
      const L = lightAt(S.time, S.time.hour);
      return { map: m.id, gaps: WRITTEN.map((role) => ({ role, ...gapOf(S, L, role) })) };
    });
    const minBy = (role: StyleRole) => Math.min(...per.map((p) => p.gaps.find((g) => g.role === role)!.gap));
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
    const gaps = WRITTEN.map((role) => ({ role, ...gapOf(S, L, role) }));
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
