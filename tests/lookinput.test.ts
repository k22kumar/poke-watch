// Look input as the third-person camera receives it (docs/CONTROLS.md "Look"): the mouse turns yaw and pitch by the same
// angle per count, and the right stick goes through a radial dead zone, a rescale and a response curve
// (input/stick.ts). Pure maths, no DOM.
import test from 'node:test';
import assert from 'node:assert/strict';
import { LOOK, lookDelta } from '../src/render/hostframe';
import { STICK, shapeStick } from '../src/input/stick';

test('mouse: one count turns yaw and pitch by the same angle, so a diagonal flick keeps its direction', () => {
  const [yaw, pitch] = lookDelta([30, 30], [0, 0], 1 / 60, 1, false)!;
  assert.equal(yaw, pitch, 'a 45° mouse motion is a 45° turn (before: pitch 0.0018 rad / count against yaw 0.0022, so 39°)');
  assert.equal(yaw, 30 * LOOK.mouse);
  // sensitivity scales both, invert flips only the pitch
  const [y2, p2] = lookDelta([10, 10], [0, 0], 1 / 60, 1.6, true)!;
  assert.ok(Math.abs(y2 - 10 * LOOK.mouse * 1.6) < 1e-15 && Math.abs(p2 + 10 * LOOK.mouse * 1.6) < 1e-15);
  assert.equal(lookDelta([0, 0], [0, 0], 1 / 60, 1, false), null);
});

test('stick: inside the dead zone nothing turns; past it the turn starts from zero, with no jump to a minimum rate', () => {
  for (const a of [0, 0.4, 1.2, 2.7]) {
    const c = Math.cos(a), s = Math.sin(a);
    assert.deepEqual(shapeStick(c * STICK.dead * 0.99, s * STICK.dead * 0.99), [0, 0], `${a}: inside the dead zone`);
    const just = shapeStick(c * (STICK.dead + 1e-4), s * (STICK.dead + 1e-4));
    assert.ok(Math.hypot(...just) < 1e-6, `${a}: just past it the output is ~0 (${Math.hypot(...just)}); the old per-axis dead zone jumped to 0.18`);
  }
  // full deflection is the full rate, in any direction
  for (const a of [0, 0.7, 2, -2.5]) { const o = shapeStick(Math.cos(a), Math.sin(a)); assert.ok(Math.abs(Math.hypot(...o) - 1) < 1e-12); }
});

test('stick: radial, not per axis, so a push just off an axis turns just off it (the old per-axis dead zone snapped it onto the axis)', () => {
  // 0.9 right, 0.15 up: the old per-axis dead zone zeroed the vertical (0.15 < 0.18) and turned purely sideways
  const [x, y] = shapeStick(0.9, -0.15);
  assert.ok(y < 0, 'the small vertical part survives');
  assert.ok(Math.abs(Math.atan2(y, x) - Math.atan2(-0.15, 0.9)) < 1e-12, 'and the direction is the stick\'s');
});

test('stick: the response curve is monotone and finer near the centre (half deflection turns at a quarter of the full rate)', () => {
  let prev = 0;
  for (let m = 0; m <= 1 + 1e-12; m += 0.01) {
    const o = Math.hypot(...shapeStick(m, 0));
    assert.ok(o >= prev - 1e-15, `monotone at ${m.toFixed(2)}`);
    prev = o;
  }
  const half = STICK.dead + (1 - STICK.dead) / 2;
  assert.ok(Math.abs(Math.hypot(...shapeStick(half, 0)) - Math.pow(0.5, STICK.exp)) < 1e-12);
  // through lookDelta: full right deflection for one second turns LOOK.stickYaw radians
  let yaw = 0; for (let k = 0; k < 60; k++) yaw += lookDelta([0, 0], shapeStick(1, 0), 1 / 60, 1, false)![0];
  assert.ok(Math.abs(yaw - LOOK.stickYaw) < 1e-9);
});
