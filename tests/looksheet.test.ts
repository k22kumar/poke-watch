// The look sheet's mark 1 as a gate (docs/looksheet, ROADMAP F111; WORLDGEN3D Q23.3): on the tuning maps' bindings
// (the range: meadow; River Gorge: forest) at the fixed hour, every role of mark 1 keeps its darkest top ΔL* ≥ 12 above
// its brightest side, for the shipped lowpoly profile and every variant of the sheet's grid, without crushing the
// ambient (the darkest role's shadowed top keeps L* ≥ 20). Since the owner's decisions of 2026-11-27 mark 1 reads
// endgrain (against the trunk sides it sits on) in place of trunk, and the hold-out maps (Chargestone Cave: a cave, on
// its own split, key 0.85 over ambient 0.45; the dusk lagoon: night) are gated too, on the shipped profile.
import assert from 'node:assert/strict';
import test from 'node:test';
import { resolve } from '../src/rules/styles/resolve';
import { devLayer } from '../src/render/world3d/devlayer';
import { lightAt } from '../src/render/world3d/lighting';
import { topSideGap } from '../src/render/world3d/tones';
import { HOLD_OUT_MAPS, LOOK_MAPS, LOOK_VARIANTS, MARK1_ROLES, SIDE_OF } from '../scripts/lib/looksheet';


test('look sheet mark 1: tops read apart from sides on the tuning maps, for lowpoly and every variant', () => {
  const fails: string[] = [];
  for (const v of [{ id: 'lowpoly', query: '' }, ...LOOK_VARIANTS]) for (const m of LOOK_MAPS) {
    const S = resolve('lowpoly', m.binding, { overlay: devLayer(new URLSearchParams(v.query)) });
    const L = lightAt(S.time, S.time.hour);
    for (const role of MARK1_ROLES) {
      const g = topSideGap(S, L, role, SIDE_OF[role]);
      if (g.gap < 12) fails.push(`${v.id} ${m.id} ${role}: ΔL* ${g.gap.toFixed(1)}`);
      if (g.shadowTop < 20) fails.push(`${v.id} ${m.id} ${role}: shadowed top L* ${g.shadowTop.toFixed(1)}`);
    }
  }
  assert.deepEqual(fails, []);
  assert.equal(resolve('lowpoly', 'meadow').time.hour, 11);
});

test('look sheet mark 1: tops read apart from sides on the hold-out maps (a cave and night), for lowpoly as shipped', () => {
  const fails: string[] = [];
  assert.deepEqual(HOLD_OUT_MAPS.map((m) => m.id), ['chargestone', 'dusklagoon']);
  for (const m of HOLD_OUT_MAPS) {
    const S = resolve('lowpoly', m.binding);
    const L = lightAt(S.time, S.time.hour);
    for (const role of MARK1_ROLES) {
      const g = topSideGap(S, L, role, SIDE_OF[role]);
      if (g.gap < 12) fails.push(`${m.id} ${role}: ΔL* ${g.gap.toFixed(1)}`);
      if (g.shadowTop < 20) fails.push(`${m.id} ${role}: shadowed top L* ${g.shadowTop.toFixed(1)}`);
    }
  }
  assert.deepEqual(fails, []);
  assert.deepEqual(HOLD_OUT_MAPS.map((m) => resolve('lowpoly', m.binding).time.hour), [11, 23]);
});
