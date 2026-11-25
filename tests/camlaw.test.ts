// CL: the single framing source (src/rules/framing.ts, WORLDGEN3D Q7c, CL-Q4, CL-Q5, CL-Q8) and the anatomy table
// (src/rules/anatomy.ts, CL-Q2, CL-Q6). The old renderer reads today's framing inputs from the source unchanged; the 3D
// law, the band clamp and the generator's numbers are pinned here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultRules } from '../src/rules/defaults';
import { SPECIES, SPECIES_BY_ID } from '../src/rules/species';
import { bodyOf, partnerFootprint, partnerHeight } from '../src/rules/sizing';
import { ANATOMY_OVERRIDES, anatomyOf, maxEyeFraction } from '../src/rules/anatomy';
import { FRAMING, cameraClearance, cameraDistance, clampToBand, lensHeight, tallestBody } from '../src/rules/framing';
import { CHASE_CONFIG } from '../src/render/camera';

const near = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) <= eps;

test('the old renderer reads today\'s framing inputs from the single source, unchanged', () => {
  assert.deepEqual(CHASE_CONFIG.frame, { ref: 1.9, boom: 4.3, exp: 1, min: 1.8, max: 14, settle: 0.45 });
  assert.deepEqual(CHASE_CONFIG.reticle, { side: 7, below: 3, reach: 4, rise: 0 });
  assert.equal(CHASE_CONFIG.shoulderMax, 0.6);
  assert.deepEqual(CHASE_CONFIG.elevation, [2, 40]);
  assert.equal(CHASE_CONFIG.aimPitch.neutral, 11);
  assert.equal(CHASE_CONFIG.lens.clear, 0.3);
  assert.equal(CHASE_CONFIG.deck.clearance, 0.45);
  for (const k of ['frame', 'reticle'] as const) assert.deepEqual(CHASE_CONFIG[k], FRAMING[k], `${k} is the source's`);
});

test('CL-Q8: the 3D distance D = 3.5 × the anatomy table\'s height inside 1.8–9.0 m; the max binds only above 2.57 m, no hero', () => {
  assert.deepEqual(FRAMING.law, { k: 3.5, min: 1.8, max: 9.0 });
  assert.equal(cameraDistance(0.4), 1.8);
  assert.ok(near(cameraDistance(1.2), 4.2));
  assert.equal(cameraDistance(3.57), 9.0);
  assert.ok(near(9.0 / 3.5, 2.5714285714285716));
  const hariyama = anatomyOf(SPECIES_BY_ID.hariyama);
  assert.ok(near(cameraDistance(hariyama.height), 3.5 * hariyama.height) && cameraDistance(hariyama.height) < 9, `Hariyama, the tallest hero, frames proportionally (${cameraDistance(hariyama.height)} m)`);
});

test('CL-Q4, CL-Q5: the lens is at the eye\'s height (no cap, never lifted); the band survives only as a clamp with its own test', () => {
  for (const eye of [0.33, 0.6, 1.0, 1.95, 3.12]) assert.equal(lensHeight(eye), eye);
  assert.deepEqual(FRAMING.band, { floor: 0.6, cap: 1.35 });
  assert.equal(clampToBand(0.33), 0.33, 'the floor is min(0.60, eye): a low eye is not lifted');
  assert.equal(clampToBand(0.6), 0.6);
  assert.equal(clampToBand(1.0), 1.0);
  assert.equal(clampToBand(1.35), 1.35);
  assert.equal(clampToBand(3.0), 1.35, 'the cap');
});

test('CL-Q8: the generator\'s camera numbers from the rules alone: ceiling 3.66, short side 10.18, keep-out 9.30 m', () => {
  assert.ok(near(tallestBody(), 4.0 * (2.4 / 2.69)), `the tallest body ${tallestBody()}`);
  assert.equal(maxEyeFraction(), 0.9);
  const c = cameraClearance();
  assert.equal(c.eye.toFixed(2), '3.21');
  assert.equal(c.ceiling.toFixed(2), '3.66');
  assert.ok(c.ceiling < 3.7, 'inside the 3.70 m clear height (Q7)');
  assert.equal(c.shortSide.toFixed(2), '10.18');
  assert.equal(c.keepOut.toFixed(2), '9.30');
  // no real species' eye exceeds the bound the generator is sized for
  for (const sp of SPECIES) if (!bodyOf(sp).authored) assert.ok(anatomyOf(sp).eye.up <= c.eye + 1e-9, `${sp.id}`);
});

test('CL-Q2, CL-Q6: the anatomy defaults by shape, no overrides, the mouth at today\'s muzzle figures', () => {
  assert.deepEqual(ANATOMY_OVERRIDES, {}, 'CL adds no override (the lint finds every default eye inside its sprite)');
  const R = defaultRules, A = R.anatomy;
  for (const sp of SPECIES) {
    const a = anatomyOf(sp), b = bodyOf(sp), f = A.eye[sp.canon?.shape ?? ''] ?? A.eyeUnknown;
    assert.ok(near(a.height, b.height), `${sp.id}: the sim height`);
    assert.ok(near(a.eye.up, b.height * f.up) && near(a.eye.fwd, b.body * f.fwd), `${sp.id}: the eye from its shape`);
    assert.ok(a.eye.fwd <= b.body + 1e-12, `${sp.id}: the eye inside the footprint`);
    assert.ok(near(a.length, 2 * b.body) && near(a.width, 2 * b.body), `${sp.id}: length and width = the footprint diameter`);
    if (!b.authored) {
      assert.ok(near(a.attacks.mouth.up, partnerHeight(sp) * R.aim.muzzle.up), `${sp.id}: the mouth at the muzzle's height`);
      assert.ok(near(a.attacks.mouth.fwd, partnerFootprint(sp) * R.aim.muzzle.fwd), `${sp.id}: the mouth at the muzzle's reach`);
    }
  }
  // the class enters only through the body: a continuous giant's eye grows with it
  const onix = anatomyOf(SPECIES_BY_ID.onix), steelix = anatomyOf(SPECIES_BY_ID.steelix);
  assert.ok(steelix.height > onix.height && steelix.eye.up > onix.eye.up, 'Steelix stands and sees higher than Onix');
  assert.ok(near(anatomyOf(SPECIES_BY_ID.tynamo).eye.up, 0.552 * 0.6, 1e-3), 'Tynamo, the lowest hero eye, 0.33 m');
});
