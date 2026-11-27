// The look sheet's mark 1 as a gate (docs/looksheet, ROADMAP F111; WORLDGEN3D Q23.3): on the tuning maps' bindings
// (the range: meadow; River Gorge: forest) at the fixed hour, every role the tile maps write keeps its darkest top
// ΔL* ≥ 12 above its brightest side, for the shipped lowpoly profile and every variant of the sheet's grid, without
// crushing the ambient (the darkest role's shadowed top keeps L* ≥ 20). The hold-out maps' bindings are not read here
// until the owner has picked.
import assert from 'node:assert/strict';
import test from 'node:test';
import type { MaterialRole } from '../src/rules/materialroles';
import { resolve } from '../src/rules/styles/resolve';
import { devLayer } from '../src/render/world3d/devlayer';
import { lightAt } from '../src/render/world3d/lighting';
import { topSideGap } from '../src/render/world3d/tones';
import { LOOK_MAPS, LOOK_VARIANTS } from '../scripts/lib/looksheet';

const WRITTEN: MaterialRole[] = ['ground', 'path', 'soil', 'rock', 'cliff', 'floor', 'cover', 'foliage', 'trunk'];

test('look sheet mark 1: tops read apart from sides on the tuning maps, for lowpoly and every variant', () => {
  const fails: string[] = [];
  for (const v of [{ id: 'lowpoly', query: '' }, ...LOOK_VARIANTS]) for (const m of LOOK_MAPS) {
    const S = resolve('lowpoly', m.binding, { overlay: devLayer(new URLSearchParams(v.query)) });
    const L = lightAt(S.time, S.time.hour);
    for (const role of WRITTEN) {
      const g = topSideGap(S, L, role);
      if (g.gap < 12) fails.push(`${v.id} ${m.id} ${role}: ΔL* ${g.gap.toFixed(1)}`);
      if (g.shadowTop < 20) fails.push(`${v.id} ${m.id} ${role}: shadowed top L* ${g.shadowTop.toFixed(1)}`);
    }
  }
  assert.deepEqual(fails, []);
  assert.equal(resolve('lowpoly', 'meadow').time.hour, 11);
});
