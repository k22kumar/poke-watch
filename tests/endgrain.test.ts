// The render-side endgrain role (owner, 2026-11-27; docs/RENDER3D.md "Look values", docs/looksheet "Endgrain"): the
// cut tops of stumps and logs are drawn as `endgrain`, their sides and every other trunk face stay `trunk`. The model
// is not touched: src/render/world3d/mesh.ts withEndgrain splits trunk chunks over the same positions.
import assert from 'node:assert/strict';
import test from 'node:test';
import { withEndgrain } from '../src/render/world3d/mesh';
import { fromArenaMap } from '../src/world/adapter';
import { getArena } from '../src/world/arenas';
import { generateHabitat } from '../src/world/habitat';
import type { WorldModel } from '../src/world/model';

/** the raised trunk boxes (stumps, logs) and the 1 m tiles their tops cover */
function raised(M: WorldModel) {
  const floor = M.bounds.min[1];
  return M.colliders.filter((c) => c.shape === 'box' && c.role === 'trunk' && c.centre[1] - c.half[1] > floor + 1e-6) as Extract<WorldModel['colliders'][number], { shape: 'box' }>[];
}
const tris = (cs: { role?: string; indices: Uint32Array }[], role: string) => cs.filter((c) => c.role === role).reduce((a, c) => a + c.indices.length / 3, 0);

test('endgrain: every stump and log top is endgrain, nothing else is, and no triangle is lost', () => {
  for (const m of [getArena('meadow'), generateHabitat({ recipe: 'river-gorge', seed: 1, size: 128 }), generateHabitat({ recipe: 'tropical-lagoon', seed: 2, size: 128 })]) {
    const M = fromArenaMap(m), out = withEndgrain(M), boxes = raised(M);
    assert.ok(boxes.length > 0, 'the map has stumps or logs');
    // one top quad (two triangles) per tile a raised trunk box covers
    const tiles = boxes.reduce((a, b) => a + Math.round(4 * b.half[0] * b.half[2]), 0);
    assert.equal(tris(out, 'endgrain'), 2 * tiles, 'endgrain triangles');
    assert.equal(tris(out, 'endgrain') + tris(out, 'trunk'), tris(M.surfaces, 'trunk'), 'trunk triangles kept or moved, none lost');
    for (const c of out.filter((x) => x.role === 'endgrain')) for (let t = 0; t < c.indices.length; t++) {
      const y = c.positions[c.indices[t] * 3 + 1];
      assert.ok(boxes.some((b) => Math.abs(b.centre[1] + b.half[1] - y) < 1e-3), 'an endgrain vertex lies on a raised trunk top');
    }
  }
});

test('endgrain: a map with no stumps or logs keeps its chunks as they are', () => {
  const M = fromArenaMap(getArena('range'));
  assert.equal(raised(M).length, 0);
  const out = withEndgrain(M);
  assert.equal(out.length, M.surfaces.length);
  assert.ok(out.every((c, i) => c === M.surfaces[i]));
});
