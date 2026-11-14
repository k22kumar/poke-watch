// Third-person camera rig (render/camera.ts): pure maths, no GL. Run with `npm test`.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ChaseRig, CHASE_CONFIG, CHASE_STATES, NO_THREAT, RING, RETICLE_Y, bearingOf, chaseAim, cameraPreset, CAMERA_PRESETS, ringAdd, type ChaseFrame } from '../src/render/camera';

const flat = () => 0;
const frame = (o: Partial<ChaseFrame> = {}): ChaseFrame => ({ dt: 1 / 60, x: 0, y: 0, z: 0, height: 1.1, threat: NO_THREAT, lookYaw: 0, lookPitch: 0, ground: flat, ...o });
const settle = (r: ChaseRig, f: Partial<ChaseFrame>, secs: number) => { for (let t = 0; t < secs; t += 1 / 60) r.update(frame(f)); };
const D2R = Math.PI / 180;
/** run `fn` with the shoulder offset (and nothing else) changed, then restore it */
const withShoulder = (v: number, fn: () => void) => { const was = CHASE_CONFIG.shoulder; CHASE_CONFIG.shoulder = v; try { fn(); } finally { CHASE_CONFIG.shoulder = was; } };
/** a tree: a solid cylinder of radius r around (cx, cz), `top` metres tall */
const trunk = (cx: number, cz: number, r: number, top = 4) => (x: number, y: number, z: number) => y < top && Math.hypot(x - cx, z - cz) < r;

test('presets: third person is the default and the fixed views are still there', () => {
  assert.equal(cameraPreset(undefined).mode, 'chase');
  for (const id of ['classic', 'steep', 'wide']) assert.equal(CAMERA_PRESETS.find((p) => p.id === id)?.mode, undefined);
});

test('config: every state is a low camera, never a top-down one', () => {
  for (const [name, s] of Object.entries(CHASE_STATES)) {
    assert.ok(s.pitch <= 20, `${name} boom elevation ${s.pitch}° (the old camera sat at 20-34°)`);
    assert.ok(s.tilt <= 12, `${name} looks ${s.tilt}° below the horizon`);
  }
  assert.ok(CHASE_CONFIG.elevation[1] + CHASE_CONFIG.maxLift <= 60);
});

test('the camera sits low behind and beside the Pokémon: yaw pi looks north (-z), so the eye is at +z, on the right shoulder', () => {
  const r = new ChaseRig();
  settle(r, { x: 5, z: 5 }, 3);
  assert.ok(r.eye[2] > 5 + 3, 'eye behind (south of) the player');
  assert.ok(r.eye[0] > 5 + 0.5 && Math.abs(r.eye[0] - 5 - r.shoulderUsed) < 0.01, 'on the right shoulder, so the Pokémon sits left of the crosshair');
  assert.ok(r.eye[1] > 1.0 && r.eye[1] < 1.1 * 1.7, `a head above a 1.1 m Pokémon, not a bird's eye: ${r.eye[1]}`);
  assert.ok(r.forward()[1] < -0.99, 'looking north');
  assert.ok(r.viewPitch > 0 && r.viewPitch < 12 * D2R, `the view axis is level-ish: ${r.viewPitch / D2R}°`);
});

test('the lens is lowest in Explore and rises only a little for a crowd or a boss', () => {
  const r = new ChaseRig();
  settle(r, {}, 3);
  const explore = r.eye[1];
  settle(r, { threat: { nearest: 5, weight: 30, boss: 10 } }, 3);
  assert.equal(r.state, 'pressure');
  assert.ok(r.eye[1] > explore + 0.5, 'pressure lifts the lens to see the crowd');
  assert.ok(r.eye[1] < 1.1 * 0.8 + CHASE_STATES.pressure.boom * 1.3 * Math.sin(20 * D2R) + 0.05, `but stays below a ${20}° boom: ${r.eye[1]}`);
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

test('sizes: boom, shoulder line and lens height grow with the Pokémon, inside the configured scale limits', () => {
  const Z = CHASE_CONFIG.size, base = CHASE_STATES.explore.boom;
  let last: ChaseRig | null = null;
  for (const h of [0.4, 0.7, 1.1, 1.8, 2.6, 4]) {
    const r = new ChaseRig();
    settle(r, { height: h }, 4);
    assert.ok(r.boomUsed >= base * Z.min - 1e-6 && r.boomUsed <= base * Z.max + 1e-6, `${h} m: boom ${r.boomUsed}`);
    assert.ok(r.eye[1] >= 0.5, `${h} m: the lens clears the ground`);
    // never a bird's-eye view whatever the size: the lens stays within about a body-and-a-half of the ground
    assert.ok(r.eye[1] <= Math.max(1.4, h * 0.9 + r.boomUsed * Math.sin(20 * D2R) + 0.1), `${h} m: eye ${r.eye[1]}`);
    if (last) { assert.ok(r.boomUsed >= last.boomUsed - 1e-6 && r.eye[1] > last.eye[1], `${h} m is further back and higher than the one before`); }
    last = r;
  }
  // a wide, low Pokémon backs the lens off as far as a tall one: width counts at CHASE_CONFIG.size.widthWeight
  const low = new ChaseRig(), wide = new ChaseRig();
  settle(low, { height: 0.6, width: 0.6 }, 4); settle(wide, { height: 0.6, width: 3 }, 4);
  assert.ok(wide.boomUsed > low.boomUsed + 0.3, `wide ${wide.boomUsed} vs ${low.boomUsed}`);
  // fliers: the shoulder line sits a little higher, and a glide is followed more closely
  const walker = new ChaseRig(), flier = new ChaseRig();
  settle(walker, { height: 1.6 }, 3); settle(flier, { height: 1.6, flying: true }, 3);
  assert.ok(flier.eye[1] > walker.eye[1]);
});

test('squad switch: tagging a different Pokémon glides the lens to its size without a jump', () => {
  const r = new ChaseRig();
  settle(r, { height: 0.6 }, 3);
  const before = r.eye.slice(), boom0 = r.boomUsed;
  let prev = before, maxStep = 0, t = 0;
  for (; t < 3; t += 1 / 60) {
    r.update(frame({ height: 3.2 }));
    maxStep = Math.max(maxStep, Math.hypot(r.eye[0] - prev[0], r.eye[1] - prev[1], r.eye[2] - prev[2]));
    prev = r.eye.slice();
  }
  assert.ok(maxStep < 0.2, `no single frame moved the lens ${maxStep.toFixed(3)} m (it travelled ${Math.hypot(prev[0] - before[0], prev[1] - before[1], prev[2] - before[2]).toFixed(1)} m)`);
  assert.ok(r.boomUsed > boom0 + 1.5, 'and it got there');
  // and it starts gently: the first frames after the switch hardly move
  const q = new ChaseRig();
  settle(q, { height: 0.6 }, 3);
  const e0 = q.eye.slice();
  q.update(frame({ height: 3.2 }));
  assert.ok(Math.hypot(q.eye[0] - e0[0], q.eye[1] - e0[1], q.eye[2] - e0[2]) < 0.03, 'eased in');
});

test('collision: a ridge behind the Pokémon shortens the boom and the eye stays above the ground', () => {
  const r = new ChaseRig();
  const ridge = (_x: number, z: number) => (z > 3 ? 6 : 0); // a 6 m wall 3 m behind the player (south)
  settle(r, { ground: ridge }, 2);
  assert.ok(r.boomUsed < CHASE_STATES.explore.boom - 1, `boom ${r.boomUsed}`);
  assert.ok(r.boomUsed >= CHASE_CONFIG.minBoom.hard - 1e-6);
  assert.ok(r.eye[1] >= ridge(r.eye[0], r.eye[2]) + 0.4 - 1e-6, 'above the ground under the lens');
  assert.ok(r.eye[2] < 3, 'the lens stays on the Pokémon\'s side of the wall');
  // clear again: it grows back, but not at once (0.25 s of clear air first)
  settle(r, { ground: flat }, 0.1);
  assert.ok(r.boomUsed < CHASE_STATES.explore.boom - 0.5);
  settle(r, { ground: flat }, 2.5);
  assert.ok(Math.abs(r.boomUsed - CHASE_STATES.explore.boom * Math.pow(1.1 / 1.2, CHASE_CONFIG.size.exp)) < 0.1);
});

test('collision: pressed against a cliff the lens comes in behind the Pokémon instead of climbing onto the cliff top', () => {
  for (const yaw of [Math.PI, 0.5, 2, -1.3]) {
    const r = new ChaseRig();
    r.snapTo(0, 0, 0, yaw);
    // a 5 m cliff whose face is 0.5 m behind the Pokémon, whatever way the camera looks
    const sy = Math.sin(yaw), cy = Math.cos(yaw);
    const cliff = (x: number, z: number) => (x * -sy + z * -cy > 0.5 ? 5 : 0);
    settle(r, { ground: cliff }, 2);
    assert.ok(r.eye[1] < 3.5, `yaw ${yaw}: eye ${r.eye[1].toFixed(2)} stays down on the Pokémon's side`);
    assert.ok(r.boomUsed < 1.5, `boom ${r.boomUsed}`);
  }
});

test('collision: orbiting a Pokémon among lone trees, the lens never sits in the ground and the trees never move the boom', () => {
  // lone trunks are passed through (the prop shader dissolves anything within 4 m of the lens and screen-doors what is
  // between the lens and the Pokémon); blocking on each one pumped the zoom by 2-3 m every time the camera turned past it
  const ground = (x: number, z: number) => Math.max(0, Math.sin(x * 0.7) * Math.cos(z * 0.5) * 1.4);
  const trees = [trunk(2, 3, 0.5), trunk(-3, 2, 0.5), trunk(0, -4, 0.5), trunk(-2, -2, 0.5), trunk(3, -1, 0.5)];
  const solid = (x: number, y: number, z: number) => trees.some((t) => t(x, y, z));
  const a = new ChaseRig(), b = new ChaseRig();
  a.snapTo(0, ground(0, 0), 0, 0); b.snapTo(0, ground(0, 0), 0, 0);
  let worst = Infinity, diff = 0;
  for (let i = 0; i < 400; i++) {
    a.update(frame({ y: ground(0, 0), ground, solid, lookYaw: 0.02 }));
    b.update(frame({ y: ground(0, 0), ground, lookYaw: 0.02 }));
    worst = Math.min(worst, a.eye[1] - ground(a.eye[0], a.eye[2]));
    diff = Math.max(diff, Math.abs(a.boomUsed - b.boomUsed));
  }
  assert.ok(worst >= 0.4 - 1e-6, `lens ${worst.toFixed(2)} m over the ground at its lowest`);
  assert.ok(diff < 1e-9, `the trees changed the boom by up to ${diff.toFixed(2)} m`);
});

test('collision: a thicket behind the Pokémon brings the lens in gently, never closer than minBoom', () => {
  // a 4 x 4 m block of tile-sized trunks 1.5 m behind (yaw pi: behind is +z)
  const thicket = (x: number, y: number, z: number) => y < 4 && Math.abs(x) < 2 && z > 1.5 && z < 5.5;
  const r = new ChaseRig();
  settle(r, {}, 1);
  const free = r.boomUsed;
  let step = 0, prev = r.boomUsed;
  for (let i = 0; i < 120; i++) { r.update(frame({ solid: thicket })); step = Math.max(step, Math.abs(r.boomUsed - prev)); prev = r.boomUsed; }
  const floor = Math.max(CHASE_CONFIG.minBoom.floor, CHASE_CONFIG.minBoom.frac * free);
  assert.ok(r.boomUsed < free - 1, `the thicket shortens the boom (${r.boomUsed.toFixed(2)} of ${free.toFixed(2)} m)`);
  assert.ok(r.boomUsed >= floor - 1e-6, `but not below ${floor.toFixed(2)} m (${r.boomUsed.toFixed(2)})`);
  assert.ok(step < 0.15, `eased: largest single-frame boom change ${step.toFixed(2)} m`);
});

test('collision: walking backwards into a clump of trees eases the boom in over several frames, not in one', () => {
  const tree = trunk(0, 5, 1.6); // a clump 3 m across: dense enough to block (a lone trunk is passed through)
  const r = new ChaseRig();
  settle(r, { solid: tree }, 2);
  const free = r.boomUsed;
  let maxStep = 0, prev = r.eye.slice();
  for (let i = 0; i < 90; i++) { // 6 m/s towards +z (towards the lens and the tree behind it)
    r.update(frame({ z: i / 10, solid: tree }));
    maxStep = Math.max(maxStep, Math.hypot(r.eye[0] - prev[0], r.eye[1] - prev[1], r.eye[2] - prev[2]));
    prev = r.eye.slice();
  }
  assert.ok(maxStep < 0.4, `largest single-frame lens move ${maxStep.toFixed(2)} m`);
  assert.ok(r.boomUsed < free - 1, `and it did come in (${r.boomUsed.toFixed(2)} of ${free.toFixed(2)} m)`);
});

test('collision: against a wall on the right shoulder the lens swaps to the left, and not back at once', () => {
  const wallRight = (x: number, y: number, z: number) => x > 1.3 && y < 4 && z > -20;
  const r = new ChaseRig();
  settle(r, {}, 1);
  assert.ok(r.shoulderUsed > 0.5);
  settle(r, { solid: wallRight }, 2.2);
  assert.ok(r.shoulderUsed < -0.5, `lens on the left shoulder: ${r.shoulderUsed.toFixed(2)}`);
  assert.ok(r.boomUsed > 3, `with its boom back (${r.boomUsed.toFixed(2)}) since the left is open`);
});

test('under a deck the boom stays low and flat', () => {
  const r = new ChaseRig();
  const ceiling = (_x: number, z: number) => (z < 2 && z >= -1 ? 2.4 : Infinity);
  settle(r, { height: 1, ceiling }, 2);
  assert.ok(r.eye[1] < 2.4, `eye ${r.eye[1].toFixed(2)} under the slab`);
});

test('pitch input is clamped to the player band', () => {
  const r = new ChaseRig();
  settle(r, { lookPitch: 1 }, 0.1);
  assert.ok(r.userPitch <= CHASE_CONFIG.pitchRange[1] + 1e-9);
  r.userPitch = 0;
  settle(r, { lookPitch: -1 }, 0.1);
  assert.ok(r.userPitch >= CHASE_CONFIG.pitchRange[0] - 1e-9);
  // looking down raises the lens and tips the view down; looking up lowers it and tips the view up
  const a = new ChaseRig(), b = new ChaseRig();
  a.userPitch = 12; b.userPitch = -10;
  settle(a, {}, 1); settle(b, {}, 1);
  assert.ok(a.eye[1] > b.eye[1] && a.viewPitch > b.viewPitch);
});

test('slopes: the view tilts up towards a rise and down over a drop, then settles', () => {
  const flatR = new ChaseRig(), up = new ChaseRig(), down = new ChaseRig();
  settle(flatR, {}, 3);
  settle(up, { ground: (_x, z) => Math.max(0, -z * 0.4) }, 3); // rising to the north, where the camera looks
  settle(down, { ground: (_x, z) => Math.min(0, z * 0.4) }, 3); // falling away to the north
  assert.ok(up.viewPitch < flatR.viewPitch - 3 * D2R, 'looks up at the crest');
  assert.ok(down.viewPitch > flatR.viewPitch + 2 * D2R, 'looks down over the drop');
  assert.ok(Math.abs(up.viewPitch - flatR.viewPitch) < CHASE_CONFIG.slope.range[1] * D2R + 10 * D2R, 'within the configured range');
});

test('jumping: the Pokémon rises in frame, the camera follows only part of it', () => {
  const r = new ChaseRig();
  settle(r, {}, 2);
  const py0 = r.py;
  let top = 0;
  for (let i = 0; i < 20; i++) { r.update(frame({ y: 1.8 })); top = Math.max(top, r.py - py0); }
  assert.ok(top > 0.3 && top < 1.8 * 0.8, `pivot rose ${top.toFixed(2)} of 1.8 m`);
});

test('the camera is in no state a player would call top-down, with or without tall props around', () => {
  // random terrain and boss pressure: elevation of the boom above the pivot never passes the configured ceiling
  const bumpy = (x: number, z: number) => 0.8 * Math.sin(x * 0.9) * Math.sin(z * 0.8);
  const r = new ChaseRig();
  let maxElev = 0;
  for (let i = 0; i < 600; i++) {
    r.update(frame({ x: i * 0.02, z: i * 0.03, y: bumpy(i * 0.02, i * 0.03), ground: bumpy, lookYaw: Math.sin(i / 40) * 0.05, threat: { nearest: 5, weight: 25, boss: 10 } }));
    const dx = r.eye[0] - r.px, dz = r.eye[2] - r.pz, dy = r.eye[1] - (r.py + 0.8 * 1.1);
    maxElev = Math.max(maxElev, Math.atan2(dy, Math.hypot(dx, dz)) / D2R);
  }
  assert.ok(maxElev < CHASE_CONFIG.elevation[1] + 1, `highest boom ${maxElev.toFixed(1)}°`);
});

test('aim: 4..26 m from the Pokémon, along the camera yaw with no shoulder', () => {
  withShoulder(0, () => {
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
  });
  // the crosshair ray meets flat ground at a useful range: the ring is on screen, not at the horizon
  withShoulder(0, () => {
    const r = new ChaseRig(); settle(r, {}, 3);
    const [, az] = chaseAim(r, 0, 0, 16 / 9, flat);
    assert.ok(Math.abs(az) > 6 && Math.abs(az) < 26, `explore aim ${az}`);
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
  assert.ok(Math.hypot(ax - hx, az - hz) < 0.6, `aim (${ax.toFixed(1)}, ${az.toFixed(1)}) vs crosshair hit (${hx.toFixed(1)}, ${hz.toFixed(1)})`);
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
