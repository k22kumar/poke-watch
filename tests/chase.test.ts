// Third-person camera rig (render/camera.ts): pure maths, no GL. Run with `npm test`.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ChaseRig, CHASE_CONFIG, RING, RETICLE_Y, bearingOf, boomElevation, chaseAim, chaseArm, chaseTilt, cameraPreset, CAMERA_PRESETS, lookPitchRange, neutralGround, ringAdd, type ChaseFrame } from '../src/render/camera';
import { backFor, cardPoint, classOutline, pivotHeight, seen, type Outline } from '../src/render/framing';
import { defaultRules } from '../src/rules/defaults';

const flat = () => 0;
const frame = (o: Partial<ChaseFrame> = {}): ChaseFrame => ({ dt: 1 / 60, x: 0, y: 0, z: 0, height: 1.1, lookYaw: 0, lookPitch: 0, ground: flat, ...o });
const settle = (r: ChaseRig, f: Partial<ChaseFrame>, secs: number) => { for (let t = 0; t < secs; t += 1 / 60) r.update(frame(f)); };
const D2R = Math.PI / 180;
/** an outline with no reach and no keep-out to its side: the lens sits straight behind the Pokémon (no shoulder) */
const NARROW: Outline = { top: 1.3, right: 0, left: 0, combat: [] };
const withNoShoulder = (fn: () => void) => { const was = CHASE_CONFIG.reticle.side; CHASE_CONFIG.reticle.side = 0; try { fn(); } finally { CHASE_CONFIG.reticle.side = was; } };

test('presets: third person is the default and the fixed views are still there', () => {
  assert.equal(cameraPreset(undefined).mode, 'chase');
  for (const id of ['classic', 'steep', 'wide']) assert.equal(CAMERA_PRESETS.find((p) => p.id === id)?.mode, undefined);
});

test('config: one low framing, never a top-down one: with no input the arm sits reticle.below over the neutral view', () => {
  assert.equal(boomElevation(0), CHASE_CONFIG.aimPitch.neutral + CHASE_CONFIG.reticle.below);
  assert.ok(boomElevation(0) <= 15, `arm elevation ${boomElevation(0)}° with no input`);
  assert.ok(CHASE_CONFIG.aimPitch.neutral <= 12, `the view looks ${CHASE_CONFIG.aimPitch.neutral}° below the horizon`);
  assert.equal(CHASE_CONFIG.elevation[1], 40, 'the arm only rises past 40° when the player looks further down than that');
});

test('the camera sits behind, beside and over the Pokémon: yaw pi looks north (-z), so the eye is at +z, on the right shoulder', () => {
  const r = new ChaseRig();
  settle(r, { x: 5, z: 5 }, 3);
  const top = classOutline(1.1).top;
  assert.ok(r.eye[2] > 5 + 2.5, 'eye behind (south of) the player');
  assert.ok(r.eye[0] > 5 + 0.5 && Math.abs(r.eye[0] - 5 - r.shoulderUsed) < 0.01, 'on the right shoulder, so the Pokémon sits left of the crosshair');
  assert.ok(r.eye[1] > top && r.eye[1] < top * 2.2, `over the outline's top (${top.toFixed(2)} m), not a bird's eye: ${r.eye[1].toFixed(2)}`);
  assert.ok(r.forward()[1] < -0.99, 'looking north');
  assert.ok(r.viewPitch > 0 && r.viewPitch < 12.01 * D2R, `the view axis is level-ish: ${r.viewPitch / D2R}°`);
});

test('turning right (look yaw > 0) swings the view direction towards +x', () => {
  const r = new ChaseRig();
  settle(r, {}, 1);
  const before = r.forward()[0];
  r.update(frame({ lookYaw: 0.5 }));
  assert.ok(r.forward()[0] > before + 0.1);
});

test('composition: one law puts the top-right corner of every outline on the corner of the keep-out, at a comparable share of the frame', () => {
  // the five size classes through the fallback outline, and three shapes no class describes: tall and thin, squat and
  // wide, and one with a combat frame that reaches past the body both ways
  const R = CHASE_CONFIG.reticle, tv = Math.tan((CHASE_CONFIG.fov * Math.PI) / 360);
  const outlines: [string, Outline][] = [
    ...defaultRules.size.classes.map((c): [string, Outline] => [c.id, classOutline(c.visual)]),
    ['tall', { top: 2.8, right: 0.5, left: 0.5, drop: 0.3, combat: [] }], ['wide', { top: 1.0, right: 1.0, left: 1.0, drop: 0.5, combat: [] }],
    ['lunger', { top: 1.4, right: 0.6, left: 0.6, combat: [[0.75, 1.6]] }],
  ];
  let last = 0;
  for (const [id, outline] of outlines) {
    const r = new ChaseRig();
    settle(r, { outline }, 4);
    const I = chaseArm({ outline, height: 1 });
    // the law reads the body's drawn height: its top and what it draws below its anchor
    const drop = outline.drop ?? 0;
    assert.ok(Math.abs(r.boomUsed - backFor(outline.top + drop, CHASE_CONFIG.frame)) < 1e-9, `${id}: back distance ${r.boomUsed} is the law's`);
    assert.ok(Math.abs(r.shoulderUsed - I.shoulder) < 1e-9 && !I.sideCapped, `${id}: the shoulder is the law's ${I.shoulder.toFixed(2)} m`);
    assert.ok(Math.abs(r.pivotH - pivotHeight(I.top, r.boomUsed, r.shoulderUsed, boomElevation(0)).h) < 1e-6, `${id}: the pivot is on the corner's top as drawn`);
    // the corner the composition pins, as the billboard shader draws it, seen through the settled view
    const c = cardPoint(r, [0, 0, 0], I.right, I.top), a = seen(r, c[0], c[1], c[2]);
    assert.ok(Math.abs(a[0] + R.side) < 0.05 && Math.abs(a[1] + R.below) < 0.05, `${id}: corner at (${a[0].toFixed(2)}°, ${a[1].toFixed(2)}°), the keep-out's is (-${R.side}°, -${R.below}°)`);
    // the body's lowest drawn point (`drop` below the anchor, on the card) is in frame, over the HUD's move bar in a
    // 1080p window (1 - 58 / 1080), and the drawn body fills a comparable share of the frame's height
    const low = cardPoint(r, [0, 0, 0], 0, -drop), b = seen(r, low[0], low[1], low[2]);
    const share = (Math.tan(a[1] * D2R) - Math.tan(b[1] * D2R)) / tv / 2, by = 0.5 - Math.tan(b[1] * D2R) / tv / 2;
    assert.ok(by < 0.946, `${id}: lowest drawn point at ${by.toFixed(3)} of the frame's height`);
    assert.ok(share > 0.3 && share < 0.4, `${id}: drawn share ${share.toFixed(3)}`);
    if (id !== 'tall' && id !== 'wide' && id !== 'lunger') { assert.ok(r.boomUsed > last, `${id} is further back than the class before`); last = r.boomUsed; }
  }
  // the fixed combat allowance moved the lunger's corner sideways (never up), by no more than reticle.reach
  const L = chaseArm({ outline: outlines[7][1], height: 1 });
  assert.ok(L.right > 0.6 && L.right <= 0.75 + 1e-9 && L.top === 1.4, `corner (${L.right}, ${L.top})`);
  assert.ok(Math.atan((L.right - 0.6) / L.back) / D2R <= R.reach + 1e-9);
});

test('squad switch: tagging a Pokémon with another outline glides the lens to its framing without a jump', () => {
  const r = new ChaseRig();
  settle(r, { height: 0.6 }, 3);
  const before = r.eye.slice(), boom0 = r.boomUsed;
  let prev = before, maxStep = 0, t = 0;
  for (; t < 3; t += 1 / 60) {
    r.update(frame({ height: 2.6 }));
    maxStep = Math.max(maxStep, Math.hypot(r.eye[0] - prev[0], r.eye[1] - prev[1], r.eye[2] - prev[2]));
    prev = r.eye.slice();
  }
  assert.ok(maxStep < 0.3, `no single frame moved the lens ${maxStep.toFixed(3)} m (it travelled ${Math.hypot(prev[0] - before[0], prev[1] - before[1], prev[2] - before[2]).toFixed(1)} m)`);
  assert.ok(r.boomUsed > boom0 + 1.5, 'and it got there');
  // and it starts gently: the first frames after the switch hardly move
  const q = new ChaseRig();
  settle(q, { height: 0.6 }, 3);
  const e0 = q.eye.slice();
  q.update(frame({ height: 2.6 }));
  assert.ok(Math.hypot(q.eye[0] - e0[0], q.eye[1] - e0[1], q.eye[2] - e0[2]) < 0.03, 'eased in');
});

test('clearance: rock behind the Pokémon shortens the back arm only; the shoulder stays, and the arm eases back out', () => {
  const r = new ChaseRig();
  settle(r, {}, 2);
  const free = r.boomUsed, side = r.shoulderUsed;
  const ridge = (_x: number, z: number) => (z > 1.8 ? 6 : 0); // a 6 m wall 1.8 m behind the player (south), inside the back arm
  settle(r, { ground: ridge }, 2);
  assert.ok(r.boomUsed < free - 1, `back ${r.boomUsed}`);
  assert.ok(Math.abs(r.shoulderUsed - side) < 1e-9, `the shoulder is untouched (${r.shoulderUsed.toFixed(2)} m): the Pokémon stays beside the crosshair`);
  assert.ok(r.eye[2] <= 1.8 - CHASE_CONFIG.lens.clear + 1e-6, `the lens stays lens.clear on the Pokémon's side of the wall (z ${r.eye[2].toFixed(2)})`);
  assert.ok(r.eye[1] >= CHASE_CONFIG.lens.clear - 1e-6, 'and over the ground');
  // clear again: it grows back, but not at once (boomTime.hold of room first)
  settle(r, { ground: flat }, 0.1);
  assert.ok(r.boomUsed < free - 0.5);
  settle(r, { ground: flat }, 2.5);
  assert.ok(Math.abs(r.boomUsed - free) < 0.01, `and all the way back (${r.boomUsed.toFixed(3)} of ${free.toFixed(3)} m): what is in the way is the only thing that changes the arm`);
});

test('clearance: pressed against a cliff the lens comes in beside the Pokémon instead of climbing onto the cliff top', () => {
  for (const yaw of [Math.PI, 0.5, 2, -1.3]) {
    const r = new ChaseRig();
    r.snapTo(0, 0, 0, yaw);
    // a 5 m cliff whose face is 0.5 m behind the Pokémon, whatever way the camera looks
    const sy = Math.sin(yaw), cy = Math.cos(yaw);
    const cliff = (x: number, z: number) => (x * -sy + z * -cy > 0.5 ? 5 : 0);
    settle(r, { ground: cliff }, 2);
    assert.ok(r.eye[1] < 3.5, `yaw ${yaw}: eye ${r.eye[1].toFixed(2)} stays down on the Pokémon's side`);
    assert.ok(r.boomUsed < 0.5, `back ${r.boomUsed}`);
    assert.ok(r.eye[1] >= cliff(r.eye[0], r.eye[2]) + CHASE_CONFIG.lens.clear - 1e-6, 'never in the rock');
  }
});

test('clearance: a wall on the shoulder side shortens the shoulder only, at once, and never swaps sides', () => {
  // a bare wall 0.45 m to the right of the Pokémon's line (yaw pi: right is +x)
  const wallRight = (x: number) => x > 0.45;
  const r = new ChaseRig();
  settle(r, {}, 1);
  const free = r.boomUsed;
  assert.ok(r.shoulderUsed > 0.5);
  r.update(frame({ solid: wallRight }));
  const c = CHASE_CONFIG.lens.clear;
  assert.ok(r.eye[0] <= 0.45 - c + 1e-6, `one frame on, the lens is lens.clear from the wall (x ${r.eye[0].toFixed(2)})`);
  let minSide = Infinity;
  for (let t = 0; t < 2.2; t += 1 / 60) { r.update(frame({ solid: wallRight })); minSide = Math.min(minSide, r.shoulderUsed); }
  assert.ok(minSide > 0 && minSide >= 0.45 - c - 0.01, `the hand stayed on the right (${minSide.toFixed(2)} m)`);
  assert.ok(Math.abs(r.boomUsed - free) < 1e-6, `and the back arm kept its length (${r.boomUsed.toFixed(2)} of ${free.toFixed(2)} m): the Pokémon is drawn no larger`);
});

test('clearance: rock behind the shoulder side is passed on the inside: the hand comes in, the back arm keeps its length', () => {
  // a block that starts 0.9 m to the right and 0.8 m behind: the full shoulder would pin the lens at the hand
  const block = (x: number, _y: number, z: number) => x > 0.9 && z > 0.8;
  const r = new ChaseRig();
  settle(r, {}, 1);
  const free = r.boomUsed, side = r.shoulderUsed;
  assert.ok(side > 0.95, `the test needs a shoulder past the block (${side.toFixed(2)} m)`);
  settle(r, { solid: block }, 2);
  assert.ok(r.shoulderUsed < 0.9 && r.shoulderUsed > 0.3, `shoulder ${r.shoulderUsed.toFixed(2)} m, inside the block's edge`);
  assert.ok(r.boomUsed > free - 0.01, `back ${r.boomUsed.toFixed(2)} of ${free.toFixed(2)} m`);
  assert.ok(!block(r.eye[0] + CHASE_CONFIG.lens.clear, r.eye[1], r.eye[2]), 'and the lens keeps its clearance from it');
});

test('only what is in the way moves the arm: not the direction of travel, not the turn rate (a wall 3 m off)', () => {
  // walls 3 m beyond where the arm reaches, all around; the Pokémon runs forward, back, left and right and the view is
  // flicked, and the arm never changes. (The rig before this read the velocity and the turn rate to pull in early.)
  const free = new ChaseRig();
  settle(free, {}, 2);
  const reach = Math.hypot(free.boomUsed, free.shoulderUsed) + 3;
  const ring = (x: number, _y: number, z: number) => Math.hypot(x, z) > reach;
  for (const [vx, vz] of [[0, -7.2], [0, 7.2], [-7.2, 0], [7.2, 0]]) {
    const r = new ChaseRig();
    settle(r, { solid: ring }, 1);
    for (let i = 1; i <= 12; i++) {
      r.update(frame({ x: (vx * i) / 60, z: (vz * i) / 60, solid: ring, lookYaw: i % 3 === 0 ? 0.15 : 0 }));
      assert.ok(Math.abs(r.boomUsed - free.boomUsed) < 1e-9 && Math.abs(r.shoulderUsed - free.shoulderUsed) < 1e-9, `moving (${vx}, ${vz}), frame ${i}: arm ${r.boomUsed.toFixed(3)} / ${r.shoulderUsed.toFixed(3)}`);
    }
  }
});

test('under a deck the arm stays low and flat, and the pivot under the slab', () => {
  const r = new ChaseRig();
  const ceiling = (_x: number, z: number) => (z < 2 && z >= -1 ? 2.4 : Infinity);
  settle(r, { height: 1, ceiling }, 2);
  assert.ok(r.eye[1] < 2.4, `eye ${r.eye[1].toFixed(2)} below the slab's underside`);
  // an outline taller than the gap: the pivot comes down to the slab's clearance instead of standing in it
  const tall = new ChaseRig();
  settle(tall, { outline: { top: 2.6, right: 0.8, left: 0.8, combat: [] }, ceiling: () => 2.4 }, 2);
  assert.ok(tall.pivotH <= 2.4 - CHASE_CONFIG.deck.clearance + 1e-6, `pivot ${tall.pivotH.toFixed(2)} m under a 2.4 m slab`);
  assert.ok(tall.eye[1] < 2.4 - CHASE_CONFIG.lens.clear + 1e-6, `eye ${tall.eye[1].toFixed(2)}`);
});

test('pitch input is clamped to the absolute view limits, and moves the lens with the view', () => {
  const r = new ChaseRig();
  settle(r, { lookPitch: 1 }, 0.1);
  assert.ok(r.userPitch <= lookPitchRange()[1] + 1e-9);
  assert.ok(Math.abs(r.viewPitch - CHASE_CONFIG.aimPitch.down * D2R) < 1e-9, `down limit ${r.viewPitch / D2R}`);
  r.userPitch = 0;
  settle(r, { lookPitch: -1 }, 0.1);
  assert.ok(r.userPitch >= lookPitchRange()[0] - 1e-9);
  assert.ok(Math.abs(r.viewPitch + CHASE_CONFIG.aimPitch.up * D2R) < 1e-9, `up limit ${r.viewPitch / D2R}`);
  // looking down raises the lens and tips the view down; looking up lowers it and tips the view up
  const a = new ChaseRig(), b = new ChaseRig();
  a.userPitch = 12; b.userPitch = -10;
  settle(a, {}, 1); settle(b, {}, 1);
  assert.ok(a.eye[1] > b.eye[1] && a.viewPitch > b.viewPitch);
});

test('slopes and walls ahead never tilt the view', () => {
  const flatR = new ChaseRig(), up = new ChaseRig(), down = new ChaseRig(), wall = new ChaseRig();
  settle(flatR, {}, 3);
  settle(up, { ground: (_x, z) => Math.max(0, -z * 0.4) }, 3); // rising to the north, where the camera looks
  settle(down, { ground: (_x, z) => Math.min(0, z * 0.4) }, 3); // falling away to the north
  settle(wall, { ground: (_x, z) => (z < -5 ? 4 : 0) }, 3); // a 4 m wall 5 m in front
  for (const r of [up, down, wall]) assert.equal(r.viewPitch, flatR.viewPitch);
});

test('jumping: the camera follows the jump 1:1, so the Pokémon keeps its place in the frame', () => {
  const r = new ChaseRig();
  settle(r, {}, 2);
  const off0 = r.eye[1] - 0, py0 = r.py;
  for (let i = 0; i < 20; i++) {
    const y = Math.min(1.8, i * 0.15);
    r.update(frame({ y }));
    assert.ok(Math.abs(r.py - y) < 1e-9, `pivot base at the feet (${r.py.toFixed(3)} vs ${y})`);
    assert.ok(Math.abs(r.eye[1] - y - off0) < 1e-6, `lens ${(r.eye[1] - y).toFixed(3)} m over the feet, as on the ground`);
  }
  assert.ok(r.py - py0 > 1.79);
});

test('the camera is in no state a player would call top-down, with or without tall props around', () => {
  // random terrain: elevation of the boom above the pivot never passes the configured ceiling
  const bumpy = (x: number, z: number) => 0.8 * Math.sin(x * 0.9) * Math.sin(z * 0.8);
  const r = new ChaseRig();
  let maxElev = 0;
  for (let i = 0; i < 600; i++) {
    r.update(frame({ x: i * 0.02, z: i * 0.03, y: bumpy(i * 0.02, i * 0.03), ground: bumpy, lookYaw: Math.sin(i / 40) * 0.05 }));
    const dx = r.eye[0] - r.px, dz = r.eye[2] - r.pz, dy = r.eye[1] - (r.py + r.pivotH);
    maxElev = Math.max(maxElev, Math.atan2(dy, Math.hypot(dx, dz)) / D2R);
  }
  assert.ok(maxElev < CHASE_CONFIG.elevation[1] + 1, `highest boom ${maxElev.toFixed(1)}°`);
});

test('aim: 4..26 m from the Pokémon, along the camera yaw with no shoulder', () => {
  withNoShoulder(() => {
    for (const yaw of [0, 1, Math.PI, -2.2]) {
      const r = new ChaseRig();
      r.snapTo(10, 0, -4, yaw);
      settle(r, { x: 10, z: -4, outline: NARROW }, 3);
      const [ax, az] = chaseAim(r, 10, -4, 16 / 9, flat);
      const d = Math.hypot(ax - 10, az + 4);
      assert.ok(d >= 4 - 1e-6 && d <= 26 + 1e-6, `aim distance ${d}`);
      const ux = (ax - 10) / d, uz = (az + 4) / d;
      assert.ok(Math.abs(ux - Math.sin(r.yaw)) < 1e-6 && Math.abs(uz - Math.cos(r.yaw)) < 1e-6, 'along the camera yaw');
    }
  });
  // the crosshair ray meets flat ground at a useful range: the ring is on screen, not at the horizon
  withNoShoulder(() => {
    const r = new ChaseRig(); settle(r, { outline: NARROW }, 3);
    const [, az] = chaseAim(r, 0, 0, 16 / 9, flat);
    assert.ok(Math.abs(az) > 5 && Math.abs(az) < 26, `neutral aim ${az}`);
  });
});

test('aim: with the lens on a shoulder the shot converges on the crosshair', () => {
  const r = new ChaseRig();
  settle(r, { x: 3, z: 2 }, 3);
  const [ax, az] = chaseAim(r, 3, 2, 16 / 9, flat);
  // the ground point under the crosshair: march the same ray
  const ty = Math.tan(r.fov / 2) * (0.5 - RETICLE_Y) * 2, ang = r.viewPitch - Math.atan(ty);
  const s = r.eye[1] / Math.tan(ang), sy = Math.sin(r.yaw), cy = Math.cos(r.yaw);
  const hx = r.eye[0] + sy * s, hz = r.eye[2] + cy * s;
  // (the sideways part is eased in over the first 16 m, so a close target does not swing the shot: at this range the aim
  // point is the crosshair's ground point less (1 - along / 16) of the lens' own offset)
  const along = -(az - 2), short = r.shoulderUsed * (1 - Math.min(1, along / 16));
  assert.ok(Math.abs(Math.hypot(ax - hx, az - hz) - short) < 0.3, `aim (${ax.toFixed(1)}, ${az.toFixed(1)}) vs crosshair hit (${hx.toFixed(1)}, ${hz.toFixed(1)}), ${short.toFixed(2)} m short of it sideways`);
  assert.ok(ax > 3, 'right of the Pokémon\'s own line, where the lens is');
  // it is a small correction, not a sideways shot: under 8 degrees from the camera yaw at working range
  const dev = Math.atan2(ax - 3, -(az - 2));
  assert.ok(Math.abs(dev) < 8 * D2R, `${(dev / D2R).toFixed(1)}° off the camera yaw`);
});

test('aim stops at a hill in front instead of going through it', () => {
  const r = new ChaseRig(); settle(r, {}, 3);
  const hill = (_x: number, z: number) => (z < -6 ? 8 : 0);
  const [, az] = chaseAim(r, 0, 0, 16 / 9, hill);
  const [, az0] = chaseAim(r, 0, 0, 16 / 9, flat);
  assert.ok(Math.abs(az) <= Math.abs(az0));
});

test('awareness: bearings are relative to the camera, and the ring counts near hostiles by sector', () => {
  // facing north (yaw pi): north is ahead (0), east is to the right (+pi/2), south is behind (±pi)
  assert.ok(Math.abs(bearingOf(Math.PI, 0, 0, 0, -5)[0]) < 1e-9);
  assert.ok(Math.abs(bearingOf(Math.PI, 0, 0, 5, 0)[0] - Math.PI / 2) < 1e-9);
  assert.ok(Math.abs(Math.abs(bearingOf(Math.PI, 0, 0, 0, 5)[0]) - Math.PI) < 1e-9);
  assert.ok(Math.abs(bearingOf(0, 0, 0, 0, 5)[0]) < 1e-9, 'turning the camera turns the bearing with it');
  const ring = new Float32Array(RING.sectors);
  ringAdd(ring, Math.PI, 4, 1); // straight behind and close
  ringAdd(ring, Math.PI, RING.range + 1, 8); // too far: ignored
  ringAdd(ring, -Math.PI + 0.01, 8, 3); // behind, further
  const behind = RING.sectors / 2;
  assert.ok(ring[behind] > 0.7 + 3 * 0.45, 'both land in the rear sector, nearer weighs more');
  assert.equal(ring.reduce((a, b) => a + (b > 0 ? 1 : 0), 0), 1);
});

test('overhead rise: past the orbit range the pivot stays where the range left it, so the lens rises on an arc of one length and never flies up', () => {
  // the pivot sits on the outline's top as drawn, and a card leans back when it is seen from above: followed to 89°, that
  // top's sight line put the pivot 5 to 6 outline heights up (the lens 8 m over a Tiny, 24 m over an Extra Large), and
  // the Pokémon shrank to a third as the player looked down
  const D = CHASE_CONFIG.aimPitch.neutral;
  for (const c of defaultRules.size.classes) {
    const at = (pitch: number) => { const r = new ChaseRig(), f = { outline: classOutline(c.visual) }; settle(r, f, 2); r.look(0, (pitch - D) * D2R); settle(r, f, 2); return r; };
    const cap = at(CHASE_CONFIG.elevation[1]);
    assert.ok(cap.pivotH > at(D).pivotH, `${c.id}: inside the orbit range the pivot follows the drawn top (the card stretches as the lens rises)`);
    for (const p of [50, 60, 75, 89]) {
      const r = at(p);
      assert.ok(Math.abs(r.pivotH - cap.pivotH) < 1e-6, `${c.id} at ${p}°: pivot ${r.pivotH.toFixed(3)} m, ${cap.pivotH.toFixed(3)} m where the orbit range ends`);
      assert.ok(Math.abs(r.lensGap - cap.lensGap) < 1e-6, `${c.id} at ${p}°: the lens is ${r.lensGap.toFixed(3)} m from the pivot, ${cap.lensGap.toFixed(3)} m at 40°`);
      assert.ok(r.eye[1] <= cap.pivotH + r.boomUsed + 1e-6, `${c.id} at ${p}°: lens ${r.eye[1].toFixed(2)} m up, over the pivot by more than the arm`);
    }
  }
});

test('stair smoothing: the sprite shares the step offset up to step.sprite of its outline top, so a small sprite is not sunk into the tile it climbed', () => {
  const S = CHASE_CONFIG.step;
  for (const [name, top, whole] of [['small', 0.8, false], ['tall', 2.8, true]] as [string, number, boolean][]) {
    const r = new ChaseRig(), outline: Outline = { top, right: 0.4, left: 0.4, combat: [] };
    let y = 0;
    const f = () => frame({ y, outline, grounded: true, ground: () => y });
    for (let i = 0; i < 120; i++) r.update(f());
    assert.equal(r.spriteStep, 0, `${name}: nothing to take up on level ground`);
    y = 0.5;
    r.update(f());
    const most = Math.min(S.max, S.sprite * top);
    assert.ok(r.stepOffset < -0.4 && r.stepOffset > -0.5, `${name}: the lens is ${(-r.stepOffset).toFixed(3)} m under the 0.5 m step on its first frame`);
    assert.ok(Math.abs(r.spriteStep - Math.max(r.stepOffset, -most)) < 1e-9, `${name}: the sprite takes ${(-r.spriteStep).toFixed(3)} m of it (at most ${most.toFixed(2)} m)`);
    assert.equal(r.spriteStep === r.stepOffset, whole, `${name}: ${whole ? 'the whole offset: the Pokémon does not move in the frame' : 'less than the lens: 0.28 m of a 0.8 m sprite under the tile, not 0.43 m'}`);
    for (let i = 0; i < 30; i++) r.update(f());
    assert.equal(r.spriteStep, 0, `${name}: back on the body`);
    assert.equal(r.stepOffset, 0);
  }
});

// ---------------------------------------------------------------------------------------------- F3: the subject tilt
// (docs/THIRD_PERSON_IMPLEMENTATION.md §26, docs/size-extremes-plan.md F3): a partner whose neutral crosshair would meet
// flat ground past aim.max gets just enough extra pitch to bring it back; every other partner gets none. Eased over
// frame.settle whenever the outline changes (a tag swap, an evolution, any size change); never moving otherwise.
/** giant outlines as the capture-only pack measures them (tests/fixtures/giants-frame.json): Onix-like and Eternatus-like */
const ONIXISH: Outline = { top: 3.92, right: 3.11, left: 3.11, drop: 0.41, combat: [] };
const ETERNATUSISH: Outline = { top: 4.54, right: 3.49, left: 3.49, drop: 1.54, combat: [] };
/** where the settled rig's view axis meets flat ground, metres ahead of the feet along the yaw (criterion E4) */
const groundAhead = (r: ChaseRig, x = 0, z = 0) => {
  const fx = Math.sin(r.yaw), fz = Math.cos(r.yaw), s = r.eye[1] / Math.sin(r.viewPitch);
  return (r.eye[0] - x) * fx + (r.eye[2] - z) * fz + Math.cos(r.viewPitch) * s;
};

test('subject tilt: none for any outline whose neutral ground point is inside aim.max, just enough for one past it', () => {
  const max = CHASE_CONFIG.aim.max;
  for (const c of defaultRules.size.classes) {
    const I = chaseArm({ outline: classOutline(c.visual), height: 1 });
    assert.equal(I.tilt, 0, `${c.id}: no tilt`);
    assert.ok(neutralGround(I, 0) <= max, `${c.id}: ground point ${neutralGround(I, 0).toFixed(1)} m`);
  }
  for (const [id, outline] of [['onix-like', ONIXISH], ['eternatus-like', ETERNATUSISH]] as const) {
    const I = chaseArm({ outline, height: 1 });
    assert.ok(neutralGround(I, 0) > max && I.tilt > 0 && I.tilt < CHASE_CONFIG.aimPitch.tiltMax, `${id}: tilt ${I.tilt.toFixed(2)}°`);
    assert.equal(I.tilt, chaseTilt(I));
    assert.ok(Math.abs(neutralGround(I, I.tilt) - max) < 1e-3, `${id}: brought back to aim.max (${neutralGround(I, I.tilt).toFixed(3)} m)`);
    assert.ok(neutralGround(I, I.tilt - 0.01) > max, `${id}: and no more than that`);
    // the settled rig frames it so: the view axis is neutral + tilt, the corner still on the keep-out's, the ground point
    // where the closed form puts it
    const r = new ChaseRig();
    settle(r, { outline }, 4);
    assert.ok(Math.abs(r.tilt - I.tilt) < 1e-6 && Math.abs(r.viewPitch / D2R - (CHASE_CONFIG.aimPitch.neutral + I.tilt)) < 1e-6, `${id}: view pitch ${(r.viewPitch / D2R).toFixed(3)}°`);
    assert.ok(Math.abs(groundAhead(r) - max) < 0.05, `${id}: the rig's neutral ground point ${groundAhead(r).toFixed(2)} m`);
    const c = cardPoint(r, [0, 0, 0], I.right, I.top), a = seen(r, c[0], c[1], c[2]);
    assert.ok(Math.abs(a[0] + CHASE_CONFIG.reticle.side) < 0.05 && Math.abs(a[1] + CHASE_CONFIG.reticle.below) < 0.05, `${id}: corner (${a[0].toFixed(2)}°, ${a[1].toFixed(2)}°)`);
  }
});

/** the tilt over a change of outline from `a` to `b` (the same Pokémon, no look input): every frame's tilt and view pitch */
const across = (a: Outline, b: Outline) => {
  const r = new ChaseRig();
  settle(r, { outline: a }, 3);
  const up = r.userPitch, from = r.tilt, to = chaseArm({ outline: b, height: 1 }).tilt, tilts: number[] = [];
  for (let t = 0; t < 3; t += 1 / 60) { r.update(frame({ outline: b })); tilts.push(r.tilt); assert.equal(r.userPitch, up, 'the player\'s own pitch never moves'); }
  return { r, from, to, tilts };
};
const eases = (label: string, { from, to, tilts }: ReturnType<typeof across>) => {
  const F = CHASE_CONFIG.frame.settle, at = (s: number) => tilts[Math.round(s * 60) - 1];
  assert.ok(Math.abs(to - from) > 0.5, `${label}: the tilt changes (${from.toFixed(2)}° -> ${to.toFixed(2)}°)`);
  const share = (v: number) => (v - from) / (to - from);
  assert.ok(share(at(1 / 60)) < 0.1, `${label}: no jump on the first frame (${(100 * share(at(1 / 60))).toFixed(0)} %)`);
  assert.ok(share(at(F)) > 0.4 && share(at(F)) < 0.95, `${label}: about half way after frame.settle (${(100 * share(at(F))).toFixed(0)} %)`);
  assert.ok(Math.abs(share(tilts[tilts.length - 1]) - 1) < 1e-3, `${label}: there after 3 s`);
  for (let k = 1; k < tilts.length; k++) assert.ok(share(tilts[k]) >= share(tilts[k - 1]) - 1e-12 && share(tilts[k]) <= 1 + 1e-12, `${label}: monotonic, no overshoot`);
};

test('subject tilt: a tag swap onto a giant eases it in over frame.settle; swapping back eases it out', () => {
  const small = classOutline(defaultRules.size.classes[1].visual);
  eases('swap in', across(small, ETERNATUSISH));
  eases('swap out', across(ETERNATUSISH, small));
});

test('subject tilt: an evolution (or any size change) that changes the tilt eases it over frame.settle', () => {
  // the same Pokémon, its outline grown from one giant's to a larger one's: both tilted, by different amounts
  const run = across(ONIXISH, ETERNATUSISH);
  assert.ok(run.from > 0 && run.to > run.from, `${run.from.toFixed(2)}° -> ${run.to.toFixed(2)}°`);
  eases('evolution', run);
});

test('subject tilt: while the same partner stays, the crosshair ray never moves without input', () => {
  const r = new ChaseRig();
  settle(r, { outline: ETERNATUSISH }, 4);
  const p0 = r.viewPitch, t0 = r.tilt;
  // standing, then walking straight ahead (no look input): the view pitch and the tilt stay exactly where they are
  for (let k = 0; k < 120; k++) r.update(frame({ outline: ETERNATUSISH }));
  for (let k = 0; k < 240; k++) r.update(frame({ outline: ETERNATUSISH, z: -k * 0.05 }));
  assert.equal(r.viewPitch, p0);
  assert.equal(r.tilt, t0);
});

test('subject tilt: the look band stays absolute (aimPitch up / down about the horizon) for a tilted partner', () => {
  const r = new ChaseRig(), A = CHASE_CONFIG.aimPitch;
  settle(r, { outline: ETERNATUSISH }, 4);
  assert.ok(r.tilt > 0);
  r.look(0, 200 * D2R);
  settle(r, { outline: ETERNATUSISH }, 0.2);
  assert.ok(Math.abs(r.viewPitch / D2R - A.down) < 1e-6, `looking fully down: ${(r.viewPitch / D2R).toFixed(3)}°`);
  r.look(0, -400 * D2R);
  settle(r, { outline: ETERNATUSISH }, 0.2);
  assert.ok(Math.abs(r.viewPitch / D2R + A.up) < 1e-6, `looking fully up: ${(r.viewPitch / D2R).toFixed(3)}°`);
});
