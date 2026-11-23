// The crosshair, the shots and the picture on real maps (acceptance criteria C, D and E of
// docs/THIRD_PERSON_IMPLEMENTATION.md §25), with the real host order, rig and sim. Replay hashes say the sim did not
// change; these say the shots still go where the crosshair is once clearance, the deck cap and the stair smoothing have
// moved the lens, and that the camera keeps its distance on the maps the game builds. The pass marks are the criteria's
// (fixed before the rig was changed), not the results'.
import test from 'node:test';
import assert from 'node:assert/strict';
import type { SimContext } from '../src/sim/types';
import { poseAim } from '../scripts/camaim';
import { deckPose, openPose, wallPoses, type Pose } from '../scripts/lib/camposes';

test('criteria E1-E3: in the open, under a deck, with rock behind, beside and both: the aim is on the crosshair, and a target on it is hit or reported blocked', () => {
  const poses: [number, string, (c: SimContext) => Pose | null][] = [[0, 'open', openPose], [0, 'deck', deckPose], ...[0, 1, 2, 3].map((i) => [3, `wall ${i}`, (c: SimContext) => wallPoses(c)[i] ?? null] as [number, string, (c: SimContext) => Pose | null])];
  let shots = 0;
  for (const sp of ['cyndaquil', 'feraligatr']) for (const [stage, name, f] of poses) {
    const r = poseAim(sp, stage, f);
    assert.ok(r, `${sp}: no ${name} pose on the map`);
    const tag = `${sp}, ${r.pose}`;
    // E1: standing, the sim's aim point is on the crosshair of the frame drawn
    assert.ok(r.still <= 0.05, `${tag}: aim ${r.still}° off the crosshair, standing`);
    // E2: moving, the only error is the frame's own lens travel (the aim is taken from the sample, the frame drawn after)
    assert.ok(r.unexplained <= 0.05, `${tag}: ${r.unexplained}° of aim error that the lens' travel does not explain (largest error ${r.moving}°)`);
    // E3: a target on the crosshair is hit, or the crosshair says the muzzle cannot reach it; never a silent miss
    assert.notEqual(r.shot, 'miss', `${tag}: the target was on the crosshair, not reported blocked, and not hit`);
    if (r.shot === 'hit') shots++;
  }
  assert.ok(shots >= 6, `${shots} poses had a clear shot, and it hit`);
});
