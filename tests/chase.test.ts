// Third-person camera rig (render/camera.ts): pure maths, no GL. Run with `npm test`.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ChaseRig, CHASE_STATES, NO_THREAT, chaseAim, cameraPreset, CAMERA_PRESETS, type ChaseFrame } from '../src/render/camera';

const flat = () => 0;
const frame = (o: Partial<ChaseFrame> = {}): ChaseFrame => ({ dt: 1 / 60, x: 0, y: 0, z: 0, height: 1.1, threat: NO_THREAT, lookYaw: 0, lookPitch: 0, ground: flat, ...o });
const settle = (r: ChaseRig, f: Partial<ChaseFrame>, secs: number) => { for (let t = 0; t < secs; t += 1 / 60) r.update(frame(f)); };

test('presets: third person is the default and the fixed views are still there', () => {
  assert.equal(cameraPreset(undefined).mode, 'chase');
  for (const id of ['classic', 'steep', 'wide']) assert.equal(CAMERA_PRESETS.find((p) => p.id === id)?.mode, undefined);
});

test('the camera sits behind the Pokémon: yaw pi looks north (-z), so the eye is at +z', () => {
  const r = new ChaseRig();
  settle(r, { x: 5, z: 5 }, 3);
  assert.ok(r.eye[2] > 5 + 3, 'eye behind (south of) the player');
  assert.ok(Math.abs(r.eye[0] - 5) < 0.01, 'on the player\'s line');
  assert.ok(r.eye[1] > 1.5, 'above the ground');
  assert.ok(r.forward()[1] < -0.9, 'looking north');
});

test('turning right (look yaw > 0) swings the view direction towards +x', () => {
  const r = new ChaseRig();
  settle(r, {}, 1);
  const before = r.forward()[0];
  r.update(frame({ lookYaw: 0.5 }));
  assert.ok(r.forward()[0] > before + 0.1);
});

test('states: calm is Explore, a hostile within 20 m is Combat, a boss or a crowd is Pressure', () => {
  const r = new ChaseRig();
  settle(r, {}, 4);
  assert.equal(r.state, 'explore');
  settle(r, { threat: { nearest: 15, weight: 3, boss: Infinity } }, 0.1);
  assert.equal(r.state, 'combat');
  settle(r, { threat: { nearest: 15, weight: 25, boss: Infinity } }, 0.1);
  assert.equal(r.state, 'pressure');
  settle(r, { threat: { nearest: 30, weight: 0, boss: 22 } }, 0.1);
  assert.equal(r.state, 'pressure');
});

test('state blend: out in about 0.4 s, back in about 1.2 s, boom never faster than 6 m/s', () => {
  const r = new ChaseRig();
  settle(r, {}, 5);
  const e = CHASE_STATES.explore, c = CHASE_STATES.combat;
  const hostile = { nearest: 10, weight: 2, boss: Infinity };
  let maxStep = 0, prev = r.cur.boom;
  const t90 = (() => { for (let t = 0; t < 3; t += 1 / 60) { r.update(frame({ threat: hostile })); maxStep = Math.max(maxStep, Math.abs(r.cur.boom - prev) * 60); prev = r.cur.boom; if (r.cur.pitch >= e.pitch + 0.9 * (c.pitch - e.pitch)) return t; } return 99; })();
  assert.ok(t90 > 0.2 && t90 < 0.7, `out blend took ${t90}`);
  assert.ok(maxStep <= 6 + 1e-6, `boom rate ${maxStep}`);
  // calm again: the 3 s hold first, then a slower return
  settle(r, {}, 3.05);
  const back = (() => { for (let t = 0; t < 4; t += 1 / 60) { r.update(frame()); if (r.cur.pitch <= c.pitch - 0.9 * (c.pitch - e.pitch)) return t; } return 99; })();
  assert.ok(back > 0.6 && back < 2.2, `in blend took ${back}`);
});

test('size scaling: a tall Pokémon gets a longer boom than a small one, within 0.8x..1.45x', () => {
  const small = new ChaseRig(), tall = new ChaseRig();
  settle(small, { height: 0.5 }, 4); settle(tall, { height: 3.2 }, 4);
  assert.ok(tall.boomUsed > small.boomUsed);
  const base = CHASE_STATES.explore.boom;
  assert.ok(small.boomUsed >= base * 0.8 - 1e-6 && tall.boomUsed <= base * 1.45 + 1e-6);
});

test('collision: a ridge behind the Pokémon shortens the boom (never below 2 m) and the eye stays above the ground', () => {
  const r = new ChaseRig();
  const ridge = (x: number, z: number) => (z > 3 ? 6 : 0); // a 6 m wall 3 m behind the player (south)
  settle(r, { ground: ridge }, 2);
  assert.ok(r.boomUsed < CHASE_STATES.explore.boom - 1, `boom ${r.boomUsed}`);
  assert.ok(r.boomUsed >= 2 - 1e-6);
  assert.ok(r.eye[1] >= ridge(r.eye[0], r.eye[2]) + 0.5 - 1e-6);
  // clear again: it grows back, but not at once (0.25 s of clear air first)
  settle(r, { ground: flat }, 0.1);
  assert.ok(r.boomUsed < CHASE_STATES.explore.boom - 0.5);
  settle(r, { ground: flat }, 2);
  assert.ok(Math.abs(r.boomUsed - CHASE_STATES.explore.boom * Math.pow(1.1 / 1.1, 0.6)) < 0.1);
});

test('pitch input is clamped to the player band', () => {
  const r = new ChaseRig();
  settle(r, { lookPitch: 1 }, 0.1);
  assert.ok(r.userPitch <= 12 + 1e-9);
  r.userPitch = 0;
  settle(r, { lookPitch: -1 }, 0.1);
  assert.ok(r.userPitch >= -8 - 1e-9);
});

test('aim: in the camera yaw plane, 4..26 m from the Pokémon, and the same direction as the camera', () => {
  for (const yaw of [0, 1, Math.PI, -2.2]) {
    const r = new ChaseRig();
    r.snapTo(10, 0, -4, yaw);
    settle(r, { x: 10, z: -4 }, 3);
    const [ax, az] = chaseAim(r, 10, -4, 16 / 9, flat);
    const d = Math.hypot(ax - 10, az + 4);
    assert.ok(d >= 4 - 1e-6 && d <= 26 + 1e-6, `aim distance ${d}`);
    const ux = (ax - 10) / d, uz = (az + 4) / d;
    assert.ok(Math.abs(ux - Math.sin(r.yaw)) < 1e-6 && Math.abs(uz - Math.cos(r.yaw)) < 1e-6, 'along the camera yaw');
  }
  // Explore looks further ahead than 4 m but not to the far limit on flat ground
  const r = new ChaseRig(); settle(r, {}, 3);
  const [, az] = chaseAim(r, 0, 0, 16 / 9, flat);
  assert.ok(Math.abs(az) > 6 && Math.abs(az) < 26, `explore aim ${az}`);
});

test('aim stops at a hill in front instead of going through it', () => {
  const r = new ChaseRig(); settle(r, {}, 3);
  const hill = (x: number, z: number) => (z < -6 ? 8 : 0);
  const [, az] = chaseAim(r, 0, 0, 16 / 9, hill);
  const [, az0] = chaseAim(r, 0, 0, 16 / 9, flat);
  assert.ok(Math.abs(az) <= Math.abs(az0));
});
