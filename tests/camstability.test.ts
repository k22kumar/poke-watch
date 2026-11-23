// Third-person camera stability (render/camera.ts, render/chaseinput.ts, render/view.ts): the defects found with
// scripts/camstats.ts and the browser probes, pinned down. Pure maths and a headless run, no GL. Run with `npm test`.
import test from 'node:test';
import assert from 'node:assert/strict';
import { CHASE_CONFIG, ChaseRig, boomElevation, chaseArm, smoothDamp, type ChaseFrame } from '../src/render/camera';
/** the back distance the framing law gives a subject with no measured art (the fallback outline of its size class) */
const chaseBoom = (visual: number) => chaseArm({ height: visual, visual }).back;

import { chaseFrameFor } from '../src/render/chaseinput';
import { classOutline } from '../src/render/framing';
import { CHASE_VIEW_R, chaseViewR, fogAt, FOG_VEIL, inStageView, VIEW_BEHIND, VIEW_MARGIN } from '../src/render/view';
import { SKY } from '../src/render/sky';
import { FOG_GLSL } from '../src/render/tilestage';
import { createRun, startStage, step } from '../src/sim/run';
import { botInput } from '../src/sim/bot';
import { NO_INPUT, type InputFrame, type SimContext } from '../src/sim/types';

const flat = () => 0;
const frame = (o: Partial<ChaseFrame> = {}): ChaseFrame => ({ dt: 1 / 60, x: 0, y: 0, z: 0, height: 1.1, lookYaw: 0, lookPitch: 0, ground: flat, ...o });
const settle = (r: ChaseRig, f: Partial<ChaseFrame>, secs: number, dt = 1 / 60) => { for (let t = 0; t < secs; t += dt) r.update(frame({ ...f, dt })); };
/** the lens at time t on a recorded path (linear between frames) */
const lensAt = (s: { t: number; e: number[] }[], t: number) => { let k = 1; while (k < s.length - 1 && s[k].t < t) k++; const a = s[k - 1], b = s[k], u = Math.max(0, Math.min(1, (t - a.t) / (b.t - a.t))); return a.e.map((v, c) => v + (b.e[c] - v) * u); };
/** how far path `a` at time t is from path `b` within one 30 fps frame of time either way: an arm that comes in at once
 *  for a wall (P1) does so on whichever frame first sees the wall, so two frame rates show the same jump a frame apart */
function apart(a: { t: number; e: number[] }[], b: { t: number; e: number[] }[], t: number): number {
  const p = lensAt(a, t);
  let best = Infinity;
  for (let w = -1 / 30; w <= 1 / 30 + 1e-9; w += 1 / 240) { const q = lensAt(b, t + w); best = Math.min(best, Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2])); }
  return best;
}

/** largest per-frame change of the lens velocity (m/s) over a run of frames */
function maxDv(r: ChaseRig, frames: (i: number) => Partial<ChaseFrame>, n: number, dt = 1 / 60) {
  let prev = r.eye.slice(), pv = [0, 0, 0], worst = 0;
  for (let i = 0; i < n; i++) {
    r.update(frame({ ...frames(i), dt }));
    const v = [0, 1, 2].map((c) => (r.eye[c] - prev[c]) / dt);
    if (i > 1) worst = Math.max(worst, Math.hypot(v[0] - pv[0], v[1] - pv[1], v[2] - pv[2]));
    pv = v; prev = r.eye.slice();
  }
  return worst;
}

test('smoothDamp: no overshoot, continuous speed, and the same curve at 30, 60 and 144 fps', () => {
  const curve = (fps: number) => { let x = 0, v = 0; const out: number[] = []; for (let t = 0; t < 1.5; t += 1 / fps) { [x, v] = smoothDamp(x, 1, v, 0.3, 1 / fps); out.push(x); if (x > 1 + 1e-9) assert.fail(`overshoot ${x}`); } return (t: number) => out[Math.min(out.length - 1, Math.round(t * fps) - 1)]; };
  const a = curve(30), b = curve(60), c = curve(144);
  for (const t of [0.1, 0.3, 0.6, 1]) { assert.ok(Math.abs(a(t) - b(t)) < 0.04 && Math.abs(c(t) - b(t)) < 0.03, `t=${t}: ${a(t)} ${b(t)} ${c(t)}`); }
  // maxSpeed caps it
  let x = 0, v = 0, top = 0; for (let i = 0; i < 60; i++) { const p = x; [x, v] = smoothDamp(x, 10, v, 0.05, 1 / 60, 2); top = Math.max(top, (x - p) * 60); }
  assert.ok(top <= 2 + 1e-6, `speed ${top}`);
});

test('clearance is exact: walking past a row of rock blocks on the shoulder side, the hand gives way and the lens is never within lens.clear of one', () => {
  // 1 m tiles: every other one a 6 m block just right of the path (the shoulder side), walked past at 6 m/s. Only the
  // shoulder is in their way: the back arm, behind the Pokémon, keeps its length (the Pokémon is drawn no larger)
  const blocks = (x: number, z: number) => (x > 0.6 && x < 1.6 && Math.floor(z) % 2 === 0 ? 6 : 0);
  const r = new ChaseRig();
  r.snapTo(0, 0, 0, Math.PI);
  const free = chaseArm({ height: 1.1 }), c = CHASE_CONFIG.lens.clear;
  let least = Infinity, backMin = Infinity;
  for (let i = 0; i < 300; i++) {
    r.update(frame({ z: -i / 10, ground: blocks }));
    least = Math.min(least, r.shoulderUsed); backMin = Math.min(backMin, r.boomUsed);
    const e = r.eye;
    for (const [dx, dz] of [[0, 0], [c - 0.02, 0], [-c + 0.02, 0], [0, c - 0.02], [0, -c + 0.02]]) assert.ok(e[1] >= blocks(e[0] + dx, e[2] + dz), `frame ${i}: lens (${e.map((v) => v.toFixed(2))}) within lens.clear of a block`);
  }
  assert.ok(least < free.shoulder - 0.3, `the blocks do cut into the shoulder (least ${least.toFixed(2)} m of ${free.shoulder.toFixed(2)})`);
  assert.ok(backMin > free.back - 1e-6, `and never into the back arm (${backMin.toFixed(2)} of ${free.back.toFixed(2)} m)`);
});

test('turning beside a cliff: the arm swings into the rock, the lens never does, and the arm is whole again once the turn has left it', () => {
  // a 6 m cliff along x > 1.6 (east); the Pokémon stands still while the camera turns at 2 rad/s, so the arm sweeps
  // through where the cliff is. The lens comes in at once (P1) rather than easing through the rock
  // (1.6 m: the hand of this outline stands 1.21 m out and keeps lens.clear, 0.3 m, from rock, so a cliff nearer than
  // 1.51 m takes a little of the shoulder even where the test ends, a full turn on)
  const cliff = (x: number) => (x > 1.6 ? 6 : 0);
  const r = new ChaseRig();
  r.snapTo(0, 0, 0, Math.PI);
  settle(r, { ground: cliff }, 1);
  const free = chaseArm({ height: 1.1 });
  let shortest = Infinity;
  for (let i = 0; i < 190; i++) {
    r.update(frame({ ground: cliff, lookYaw: 2 / 60 }));
    shortest = Math.min(shortest, Math.hypot(r.boomUsed, r.shoulderUsed));
    assert.ok(r.eye[0] <= 1.6 - CHASE_CONFIG.lens.clear + 0.02, `frame ${i}: lens at x ${r.eye[0].toFixed(2)}, in the cliff's clearance`);
  }
  assert.ok(shortest < Math.hypot(free.back, free.shoulder) - 1, `the arm does give way to the cliff (shortest ${shortest.toFixed(2)} m)`);
  // a full turn on: the cliff is beside the hand again, clear of it. The arm eases back out
  settle(r, { ground: cliff }, 2.5);
  assert.ok(Math.abs(r.boomUsed - free.back) < 0.01 && Math.abs(r.shoulderUsed - free.shoulder) < 0.01, `arm ${r.boomUsed.toFixed(2)} / ${r.shoulderUsed.toFixed(2)} m back to ${free.back.toFixed(2)} / ${free.shoulder.toFixed(2)}`);
});

test('never climbs: a wall, a ledge or a bank behind only shortens the arm; it stays at the elevation the pitch asks for', () => {
  // the rig of 2026-11 climbed up to 12° over a wall behind (tipping the whole view) and, on a 35° bank, hunted for partial gains
  const cases: [string, (x: number, z: number) => number, number][] = [
    ['corridor between 6 m walls', (x) => (Math.abs(x) > 0.5 ? 6 : 0), 1.1],
    ['2.5 m ledge behind a small Pokémon', (_x, z) => (z > 0.9 ? 2.5 : 0), 0.7],
    ['45° bank right behind', (_x, z) => (z > -0.1 ? z + 0.1 : 0), 1.1],
  ];
  for (const [label, ground, h] of cases) {
    const r = new ChaseRig();
    settle(r, { ground, height: h }, 3);
    const free = chaseArm({ height: h });
    assert.ok(r.boomUsed < free.back - 0.2 || r.shoulderUsed < free.shoulder - 0.2, `${label}: the arm shortens (${r.boomUsed.toFixed(2)} / ${r.shoulderUsed.toFixed(2)} of ${free.back.toFixed(2)} / ${free.shoulder.toFixed(2)} m)`);
    // the back arm's angle in the view's vertical plane (yaw pi: behind is +z)
    const back = r.eye[2] - r.pz, elev = Math.atan2(r.eye[1] - r.py - r.pivotH, back) / Math.PI * 180;
    assert.ok(elev <= boomElevation(r.userPitch) + 0.5 || r.boomUsed < 0.3, `${label}: arm at ${elev.toFixed(1)}° (the pitch asks for ${boomElevation(r.userPitch)}°)`);
    assert.ok(r.eye[1] >= ground(r.eye[0], r.eye[2]) + CHASE_CONFIG.lens.clear - 1e-6, `${label}: the lens is over the ground`);
  }
});

test('the pivot is the Pokémon itself: running tight along a block and turning its corner, no lag cuts through the rise and the lens never jumps', () => {
  // a raised 3 m block occupying x < 0, z < 0; the Pokémon runs tight along its east face at 8 m/s, then turns west along
  // its north face. The old rig's lagging pivot cut the corner through the block and threw the lens onto the rock
  const block = (x: number, z: number) => (x < 0 && z < 0 ? 3 : 0);
  const r = new ChaseRig();
  r.snapTo(0.15, 0, -6, Math.PI);
  const path: [number, number][] = [];
  for (let i = 0; i <= 46; i++) path.push([0.15, -6 + i * 0.133]);
  for (let i = 1; i <= 46; i++) path.push([0.15 - i * 0.133, 0.15]);
  const ey: number[] = [];
  for (const [x, z] of path) {
    r.update(frame({ x, z, ground: block }));
    assert.ok(Math.hypot(r.px - x, r.pz - z) < 1e-12, `the pivot base is the Pokémon (${r.px.toFixed(3)}, ${r.pz.toFixed(3)})`);
    ey.push(r.eye[1]);
  }
  let jump = 0; for (let k = 1; k < ey.length; k++) jump = Math.max(jump, Math.abs(ey[k] - ey[k - 1]));
  assert.ok(jump < 0.5, `lens height jumped ${jump.toFixed(2)} m in one frame`);
});

test('turning on the spot on open ground changes nothing but the yaw', () => {
  const r = new ChaseRig(); settle(r, {}, 2);
  const h = r.eye[1], b = r.boomUsed, p = r.viewPitch;
  for (let i = 0; i < 400; i++) { r.update(frame({ lookYaw: 1 / 60 })); assert.ok(Math.abs(r.eye[1] - h) < 1e-6 && Math.abs(r.boomUsed - b) < 1e-6 && Math.abs(r.viewPitch - p) < 1e-9); }
});

test('the world as the lens sees it: the map edge is a wall; a prop never stops the lens, a bare wall always does', () => {
  const ctx = createRun({ seed: 1, stage: 0, species: 'cyndaquil', ruleOverrides: { worldgen: { mode: 'generated' } } } as never);
  const W = ctx.world, M = W.map, P = ctx.player;
  const f = chaseFrameFor(ctx, { dt: 1 / 60, x: P.x, y: P.y, z: P.z, lookPitch: 0 });
  assert.ok(f.ground(W.half + 3, 0) > 20 && f.ground(0, -W.half - 3) > 20, 'outside the map is a wall');
  // every wall prop (trees, boulders, fences, buildings: a tile with a World.wallTop) is open to the lens at every
  // height: they dissolve around it instead (owner decision 2026-11-18, replacing R1b Q10)
  let props = 0;
  for (const p of M.props) {
    const k = p.y * M.w + p.x;
    if (!M.wall[k] || W.wallTop![k] === Infinity) continue;
    props++;
    const x = p.x - W.half + 0.5, z = p.y - W.half + 0.5;
    for (const dy of [0.1, 1, 2.5]) assert.equal(f.solid!(x, W.height(x, z) + dy, z), false, `prop ${p.kind} at ${p.x},${p.y}, ${dy} m up`);
  }
  assert.ok(props > 50, `${props} wall props checked`);
  // a bare wall (no prop: rock mass, cave wall) is solid at every height, as it is for bodies and shots
  const cave = createRun({ seed: 1, species: 'cyndaquil', ruleOverrides: { worldgen: { mode: 'generated' } } });
  startStage(cave, 3);
  const CW = cave.world, CM = CW.map, cf = chaseFrameFor(cave, { dt: 1 / 60, x: cave.player.x, y: cave.player.y, z: cave.player.z, lookPitch: 0 });
  let bare = 0;
  for (let k = 0; k < CM.w * CM.h && bare < 200; k++) {
    if (!CM.wall[k] || CW.wallTop![k] !== Infinity || (CW.over && CW.over[k] > 0)) continue;
    bare++;
    const x = (k % CM.w) - CW.half + 0.5, z = ((k / CM.w) | 0) - CW.half + 0.5;
    for (const y of [0.5, 3, 30]) assert.equal(cf.solid!(x, y, z), true, `bare wall at ${k % CM.w},${(k / CM.w) | 0}, y ${y}`);
  }
  assert.ok(bare > 50, `${bare} bare walls checked`);
});

test('culling: turning the camera never changes what is drawn in front of the lens', () => {
  for (let k = 0; k < 64; k++) {
    const yaw = (k / 64) * Math.PI * 2, fx = Math.sin(yaw), fz = Math.cos(yaw);
    const v = { x: 3, z: -7, r: CHASE_VIEW_R, fx, fz };
    // every point within 70° of the view direction (wider than the widest field of view) and the draw radius is drawn
    for (const d of [2, 10, 40, 90, 150, 220]) for (const a of [-1.2, -0.6, 0, 0.6, 1.2]) {
      const x = 3 + Math.sin(yaw + a) * d, z = -7 + Math.cos(yaw + a) * d;
      assert.ok(inStageView(v, x, z), `yaw ${yaw.toFixed(2)}: point ${d} m at ${a} rad not drawn`);
    }
    assert.ok(!inStageView(v, 3 - fx * (VIEW_BEHIND + 1), -7 - fz * (VIEW_BEHIND + 1)), 'behind the lens is skipped');
  }
});

// ---------------------------------------------------------------------------------------------------------------------
// November 2026, second pass: the defects the first pass left open (docs/THIRD_PERSON.md, "Stability, second pass").
// ---------------------------------------------------------------------------------------------------------------------
const D2R = Math.PI / 180;
/** the lens' height over the pivot and its angle (deg) as camstats measures it */
const elevOf = (r: ChaseRig) => { const up = r.eye[1] - r.py - r.pivotH; return { up, deg: Math.atan2(up, Math.hypot(r.eye[0] - r.px, r.eye[2] - r.pz)) / D2R }; };
/** the regions these tests ran on before C1, with a habitat map for each classic region (badlands → Cinder Crater's
 *  rough ground, frost → Memorial Ridge's trees); meadow and dusk keep the default rotation's locations */
const STAND_IN = { mode: 'generated', locations: { meadow: 'viridian-forest', badlands: 'volcanic-ridge', frost: 'forest-cemetery', dusk: 'mt-moon' } };
/** a generated map, as the game builds it by default (or the `worldgen` rules given) */
function mapRun(seed: number, stage: number, species: string, calm: boolean, worldgen?: object) {
  const ctx = createRun({ seed, species, ruleOverrides: { worldgen: worldgen ?? { mode: 'generated' } } as never });
  if (stage) startStage(ctx, stage);
  return ctx;
}
/** the renderer's loop, headless: the sim at 60 Hz from an accumulator, the rig once per drawn frame on the player
 *  interpolated between the last two ticks; `each` sees the rig after every frame */
function drive(ctx: SimContext, fps: number, secs: number, control: (t: number, dt: number) => { inp: InputFrame; lookYaw?: number }, each: (r: ChaseRig, t: number) => void) {
  const P = ctx.player, r = new ChaseRig();
  r.snapTo(P.x, P.y, P.z, Math.PI);
  let acc = 0;
  for (let t = 1 / fps; t < secs; t += 1 / fps) {
    const c = control(t, 1 / fps);
    if (c.lookYaw) r.look(c.lookYaw, 0); // Renderer.look
    acc += 1 / fps;
    while (acc >= ctx.dt - 1e-9) { step(ctx, c.inp); acc -= ctx.dt; }
    const a = Math.max(0, Math.min(1, acc / ctx.dt));
    r.update(chaseFrameFor(ctx, { dt: 1 / fps, x: P.px + (P.x - P.px) * a, y: P.py + (P.y - P.py) * a, z: P.pz + (P.z - P.pz) * a, lookPitch: 0 }));
    each(r, t);
  }
}

test('backed against a terrace, the lens stays on the Pokémon\'s side of its face, never up on the terrace (the 70° badlands fight)', () => {
  // a Feraligatr-sized Pokémon (1.75 m) with a terrace face just behind it, its top above the arm. The rig of 2026-11
  // lifted the lens out of the terrace onto its top: a metre over the pivot, 0.4 m behind it, looking down past it
  const c = CHASE_CONFIG.lens.clear;
  for (const yaw of [Math.PI, 0.5, 2, -1.3]) for (const face of [0.25, 0.35, 0.45]) for (const top of [4, 5, 6]) {
    const sy = Math.sin(yaw), cy = Math.cos(yaw);
    const back = (x: number, z: number) => x * -sy + z * -cy; // metres behind the Pokémon along the view
    const ground = (x: number, z: number) => (back(x, z) > face ? top : 0);
    const r = new ChaseRig();
    r.snapTo(0, 0, 0, yaw);
    settle(r, { ground, height: 1.75 }, 1.5);
    for (let i = 0; i < 60; i++) {
      r.update(frame({ ground, height: 1.75, lookYaw: Math.sin(i / 9) * 0.004 }));
      const e = elevOf(r);
      const tag = `yaw ${yaw} face ${face} top ${top}`;
      assert.ok(back(r.eye[0], r.eye[2]) <= face + 0.02, `${tag}: lens ${back(r.eye[0], r.eye[2]).toFixed(2)} m behind, past the face`);
      assert.ok(r.eye[1] < top, `${tag}: lens at ${r.eye[1].toFixed(2)} m, on the terrace top`);
      assert.ok(e.up < 0.5, `${tag}: lens ${e.up.toFixed(2)} m over the pivot`);
      void c;
    }
  }
  // a terrace the arm passes over (its top `lens.clear` under the arm all the way) is not in the way at all
  const low = new ChaseRig(), free = chaseArm({ height: 1.75 });
  settle(low, { ground: (_x, z) => (z > 0.4 ? 0.5 : 0), height: 1.75 }, 2);
  assert.ok(Math.abs(low.boomUsed - free.back) < 1e-6, `a 0.5 m terrace behind leaves the arm whole (${low.boomUsed.toFixed(2)} m)`);
});

test('the reported badlands fight (seed 1, Feraligatr, 30 s of bot combat): never a steep lens, never on what is behind', () => {
  const ctx = mapRun(1, 1, 'feraligatr', false, STAND_IN);
  const cap = boomElevation(0) + 1; // the arm's elevation at the neutral pitch: nothing in a fight raises it
  let worst = 0, worstUp = -Infinity;
  drive(ctx, 60, 30, (_t, dt) => ({ inp: botInput(ctx), lookYaw: 0.25 * dt }), (r, t) => {
    if (t < 2) return;
    const e = elevOf(r);
    if (r.lensGap >= 1) worst = Math.max(worst, e.deg); else worstUp = Math.max(worstUp, e.up);
  });
  assert.ok(worst <= cap, `boom elevation ${worst.toFixed(1)}° (cap ${cap}°; it reached 70° in 2026-11, 31° after the first fix)`);
  assert.ok(worstUp < 0.5, `with the lens close, it sat ${worstUp.toFixed(2)} m over the pivot`);
});

test('a terrace step under the end of the boom never pops the lens up and down while the camera turns', () => {
  // a 1.25 m step 2.9 m behind a small Pokémon, the camera swinging slowly to and fro: the boom end crosses the step's
  // edge. Lifting the lens out of the step when it crossed popped it 0.7 m up and back on consecutive frames
  for (const at of [2.6, 2.9, 3.2]) {
    const ground = (_x: number, z: number) => (z > at ? 1.25 : 0);
    const r = new ChaseRig();
    settle(r, { ground }, 1.5);
    let prev = r.eye.slice(), worst = 0;
    for (let i = 0; i < 360; i++) {
      r.update(frame({ ground, lookYaw: Math.cos(i / 30) * 0.012 }));
      worst = Math.max(worst, Math.abs(r.eye[1] - prev[1]));
      // never in the step (to within the centimetre a frame drawn between two ticks may turn it past the edge)
      const g = Math.min(...[[0, 0], [0.01, 0], [-0.01, 0], [0, 0.01], [0, -0.01]].map(([dx, dz]) => ground(r.eye[0] + dx, r.eye[2] + dz)));
      assert.ok(r.eye[1] >= g + CHASE_CONFIG.lens.clear - 1e-6, `lens at ${r.eye.map((v) => v.toFixed(3))} is in the step`);
      prev = r.eye.slice();
    }
    assert.ok(worst < 0.08, `step at ${at} m: lens height jumped ${worst.toFixed(2)} m in one frame`);
  }
});

test('frame rate: the same walk past walls gives the same lens path at 30, 60, 144 fps and a jittery rate', () => {
  // a wall on the right, blocks behind, a ramp; the path and yaw are functions of time, set once per frame as the renderer
  // does (Renderer.look writes the yaw, then the rig updates). The shoulder never swaps (it used to here, and the swap's
  // timing had to be pinned across frame rates)
  const ground = (x: number, z: number) => (x > 1.4 && z > -14 ? 3 : 0) + (z < -16 ? Math.min(2, (-16 - z) * 0.3) : 0) + (x < -2.5 && Math.floor(z) % 3 === 0 ? 2.2 : 0);
  const pos = (t: number) => [Math.sin(t * 0.8) * 0.4, 0, -t * 2.2];
  const yawAt = (t: number) => Math.PI + Math.sin(t * 0.9) * 0.35;
  function path(dts: () => number) {
    const r = new ChaseRig(); r.snapTo(0, 0, 0, Math.PI);
    const out: { t: number; e: number[]; side: number }[] = [];
    for (let t = 0; t < 10;) {
      const dt = dts(); t += dt;
      const p = pos(t); r.yaw = yawAt(t);
      r.update(frame({ dt, x: p[0], y: ground(p[0], p[2]), z: p[2], ground }));
      out.push({ t, e: r.eye.slice(), side: Math.sign(r.shoulderUsed) });
    }
    return out;
  }
  const at = (s: { t: number; e: number[] }[], t: number) => { let k = 1; while (k < s.length - 1 && s[k].t < t) k++; const a = s[k - 1], b = s[k], u = Math.max(0, Math.min(1, (t - a.t) / (b.t - a.t))); return a.e.map((v, c) => v + (b.e[c] - v) * u); };
  let seed = 7; const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  const ref = path(() => 1 / 60);
  assert.ok(ref.every((p) => p.side >= 0), 'the lens stays on the right shoulder');
  for (const [name, dts] of [['30', () => 1 / 30], ['144', () => 1 / 144], ['jitter', () => 1 / 144 + rnd() * (1 / 30 - 1 / 144)]] as [string, () => number][]) {
    const p = path(dts);
    let dev = 0; for (let t = 0.5; t < 9.8; t += 0.01) dev = Math.max(dev, apart(p, ref, t));
    // a frame at 30 fps shows the lens up to one 30 fps frame apart in time; along a 2.2 m/s walk that is ~7 cm
    assert.ok(dev < 0.12, `${name}: lens path ${dev.toFixed(3)} m from the 60 fps one`);
  }
});

test('turning on the spot beside trees on a generated map never zooms (vegetation used to pump the boom 2-3 m)', () => {
  for (const [seed, stage] of [[1, 1], [2, 1], [1, 2]]) {
    const ctx = mapRun(seed, stage, 'cyndaquil', true, STAND_IN);
    let lo = Infinity, hi = -Infinity;
    drive(ctx, 60, 1.2 + Math.PI * 2, (t, dt) => ({ inp: NO_INPUT, lookYaw: t > 0.5 ? dt : 0 }), (r, t) => { if (t > 1.2) { lo = Math.min(lo, r.boomUsed); hi = Math.max(hi, r.boomUsed); } });
    assert.ok(hi - lo < 0.05, `seed ${seed} stage ${stage}: boom ranged ${(hi - lo).toFixed(2)} m over a full turn`);
  }
});

test('rapid direction changes: the move direction and the aim follow the camera on the very frame it turns', async () => {
  // in the host's order (render/hostframe.ts): the look input, then the sample the sim ticks aim with, then the render.
  // The aim is taken BEFORE this frame's update; this test used to update first, the opposite of main.ts, and passed
  // while the host aimed from last frame's lens (docs/THIRD_PERSON_IMPLEMENTATION.md, Phase 1)
  const { chaseAim } = await import('../src/render/camera');
  const r = new ChaseRig(); settle(r, {}, 1);
  for (const flip of [Math.PI, -2.2, 1.1, Math.PI, 0.4]) {
    r.look(flip, 0); // Renderer.look
    const want = r.yaw;
    const v = r.sample(1280, 720); // Renderer.viewSample, before the ticks
    const [fx, fz] = [Math.sin(v.yaw), Math.cos(v.yaw)];
    assert.ok(Math.abs(Math.atan2(Math.sin(v.yaw - want), Math.cos(v.yaw - want))) < 1e-9, 'the ticks move relative to the yaw the player set');
    // the lens is behind the Pokémon for the new yaw (not still where the old one put it)
    const back = -(v.eye[0] * fx + v.eye[2] * fz);
    assert.ok(back > 2, `lens ${back.toFixed(2)} m behind along the new view`);
    const [ax, az] = chaseAim(v, 0, 0, v.aspect, flat);
    assert.ok(ax * fx + az * fz > 3, 'the aim point is in front along the new view');
    r.update(frame({}));
    const [dx, dz] = chaseAim(r, 0, 0, 16 / 9, flat);
    assert.ok(Math.abs(Math.atan2(Math.sin(r.yaw - want), Math.cos(r.yaw - want))) < 1e-9, 'the yaw the player set is the yaw drawn');
    assert.ok(Math.hypot(ax - dx, az - dz) < 0.05, `the ticks aimed ${Math.hypot(ax - dx, az - dz).toFixed(3)} m from the crosshair drawn`);
  }
});

test('standing still on generated maps (forest, badlands, cave): the lens does not drift at all', () => {
  for (const [seed, stage, sp] of [[1, 0, 'cyndaquil'], [3, 1, 'feraligatr'], [3, 3, 'charmander']] as [number, number, string][]) {
    const ctx = mapRun(seed, stage, sp, true, STAND_IN);
    let first: number[] | null = null, drift = 0;
    drive(ctx, 144, 4, () => ({ inp: NO_INPUT }), (r, t) => { if (t < 1.5) return; first ??= r.eye.slice(); drift = Math.max(drift, Math.hypot(r.eye[0] - first[0], r.eye[1] - first[1], r.eye[2] - first[2])); });
    assert.ok(drift < 1e-6, `seed ${seed} stage ${stage}: drifted ${drift} m`);
  }
});

test('frame rate on generated maps: the scripted walk replayed at 30 / 144 / jittery fps follows the 60 fps lens path', () => {
  // the player path is recorded once at 60 Hz and the rig replays it at each rate (as camstats' fpsDev does), so only
  // the camera's own frame-rate dependence shows. Stepping the rig once per frame, these drifted 1.3-1.8 m apart (a
  // shoulder swap or a boom cut decided on a different frame); on its fixed 120 Hz clock they agree to centimetres
  const walkYaw = (t: number) => Math.PI - (0.9 / 0.7) * (1 - Math.cos(t * 0.7));
  for (const [seed, stage, sp, fps] of [[3, 0, 'feraligatr', 144], [1, 3, 'feraligatr', 30], [2, 0, 'cyndaquil', 30], [1, 3, 'cyndaquil', 0]] as [number, number, string, number][]) {
    const ctx = mapRun(seed, stage, sp, true), P = ctx.player, pos = [[P.x, P.y, P.z, +P.grounded]];
    for (let k = 1; k * ctx.dt < 20.5; k++) { const y = walkYaw(k * ctx.dt); step(ctx, { ...NO_INPUT, mx: Math.sin(y), mz: Math.cos(y) }); pos.push([P.x, P.y, P.z, +P.grounded]); }
    let seedR = 11; const rnd = () => ((seedR = (seedR * 1103515245 + 12345) % 2147483648) / 2147483648);
    const replay = (dtOf: () => number) => {
      const r = new ChaseRig(), out: { t: number; e: number[] }[] = [];
      r.snapTo(pos[0][0], pos[0][1], pos[0][2], Math.PI);
      for (let t = 0; t < 19.8;) {
        const dt = dtOf(); t += dt;
        const u = t / ctx.dt, i = Math.min(pos.length - 2, Math.floor(u)), a = u - i, p = pos[i], q = pos[i + 1];
        r.yaw = walkYaw(t);
        r.update(chaseFrameFor(ctx, { dt, x: p[0] + (q[0] - p[0]) * a, y: p[1] + (q[1] - p[1]) * a, z: p[2] + (q[2] - p[2]) * a, lookPitch: 0, grounded: !!p[3] && !!q[3] }));
        out.push({ t, e: r.eye.slice() });
      }
      return out;
    };
    const at = (s: { t: number; e: number[] }[], t: number) => { let k = 1; while (k < s.length - 1 && s[k].t < t) k++; const a = s[k - 1], b = s[k], u = Math.max(0, Math.min(1, (t - a.t) / (b.t - a.t))); return a.e.map((v, c) => v + (b.e[c] - v) * u); };
    const A = replay(fps ? () => 1 / fps : () => 1 / 144 + rnd() * (1 / 30 - 1 / 144)), B = replay(() => 1 / 60);
    let dev = 0, far = 0, n = 0; for (let t = 1; t < 19.5; t += 0.05) { const d = apart(A, B, t); dev = Math.max(dev, d); n++; if (d > 0.6) far++; }
    // On open ground the paths agree to centimetres (0.02 m here; 0.26 m at worst in the forest, an Extra Large passing
    // under a deck, where the pivot comes down 1.9 m in a fifth of a second).
    // In the cave the arm is choosing between ways round rock most of the time, and a millimetre of difference in where
    // a frame rate samples the walk can pick another way for a moment: both are clear poses, and the paths rejoin. On
    // the arms the drawn-height law gives (an Extra Large's is 8.3 m) those moments are up to 3.4 m apart, for under
    // 0.8 % of this walk (Feraligatr) and 3.8 % of it (Cyndaquil, jittery frames); on the shorter arms before it they
    // were up to 1.5 m apart for 2.4 %. What is held to: together for over nine tenths of the walk, and together at
    // its end (docs/THIRD_PERSON.md "Known limits")
    if (stage === 3) {
      assert.ok(far / n < 0.1, `seed ${seed} stage ${stage} ${sp} at ${fps || 'jittery'} fps: over 0.6 m from the 60 fps path for ${((100 * far) / n).toFixed(1)} % of the walk (worst ${dev.toFixed(2)} m)`);
      assert.ok(apart(A, B, 19.45) < 0.6, `seed ${seed} stage ${stage} ${sp} at ${fps || 'jittery'} fps: ${apart(A, B, 19.45).toFixed(2)} m apart at the end`);
    } else assert.ok(dev < 0.3, `seed ${seed} stage ${stage} ${sp} at ${fps || 'jittery'} fps: ${dev.toFixed(2)} m from the 60 fps path`);
  }
});

test('culling is bounded by the fog: everything past the draw radius is exactly the fog colour, on a map of any size', () => {
  assert.ok(FOG_GLSL.includes(FOG_VEIL.toFixed(3)), 'the shader closes the fog over the same veil');
  for (const [name, sk] of Object.entries(SKY)) {
    const r = chaseViewR(sk.fogFar);
    // a billboard's nearest pixel is at most VIEW_MARGIN closer than its base
    assert.ok(fogAt(r - VIEW_MARGIN, sk.fogNear, sk.fogFar, sk.fog) >= 1 - 1e-9, `${name}: not fully fogged at the draw radius`);
    // and the fog inside the old far distance is what it was (the veil only adds beyond it)
    for (const d of [sk.fogNear, (sk.fogNear + sk.fogFar) / 2, sk.fogFar]) {
      const f = Math.min(1, Math.max(0, (d - sk.fogNear) / (sk.fogFar - sk.fogNear)));
      assert.ok(Math.abs(fogAt(d, sk.fogNear, sk.fogFar, sk.fog) - f * f * sk.fog) < 1e-9, `${name}: fog at ${d} m changed`);
    }
    assert.ok(r <= CHASE_VIEW_R);
  }
});

test('a pillar crossing the back arm: the lens comes in at boomTime.in and hops only the pillar, never the whole arm', () => {
  // an Extra Large's arm (8.2 m back, 2.7 m of shoulder) and a 1 m pillar of bare rock 2 to 3 m behind the hand's line,
  // 3 m to the right of the arm. Yaw pi: the lens is at +z, right is +x. The Pokémon strafes right at 5 m/s, so the arm
  // sweeps broadside across the pillar. The lens, 8 m back, is in free air the whole time: all at once, the cut moved it
  // over 5 m in one frame
  const outline = classOutline(2.5), arm = chaseArm({ outline, height: 1 });
  const px0 = arm.shoulder + 3, pillar = (x: number, _y: number, z: number) => x >= px0 && x <= px0 + 1 && z >= 2 && z <= 3;
  const run = (speedIn: number) => {
    const was = CHASE_CONFIG.boomTime.in;
    CHASE_CONFIG.boomTime.in = speedIn;
    try {
      const r = new ChaseRig();
      let x = 0, worst = 0, shortest = Infinity, prev: number[] | null = null;
      const f = () => frame({ x, outline, solid: pillar });
      for (let i = 0; i < 180; i++) r.update(f());
      for (let i = 0; i < 150; i++) {
        x += 5 / 60; r.update(f());
        const rel = [r.eye[0] - x, r.eye[1], r.eye[2]];
        if (prev) worst = Math.max(worst, Math.hypot(rel[0] - prev[0], rel[1] - prev[1], rel[2] - prev[2]));
        prev = rel; shortest = Math.min(shortest, r.boomUsed);
        // P1 either way: the lens keeps lens.clear from the pillar's faces on every frame (the rig's own test: the lens
        // point and the four points lens.clear from it along x and z)
        const c = CHASE_CONFIG.lens.clear - 1e-6, [ex, , ez] = r.eye;
        assert.ok(![[0, 0], [c, 0], [-c, 0], [0, c], [0, -c]].some(([ux, uz]) => pillar(ex + ux, 0, ez + uz)), `frame ${i}: lens at (${ex.toFixed(2)}, ${ez.toFixed(2)}), within lens.clear of the pillar`);
      }
      for (let i = 0; i < 180; i++) r.update(f());
      return { worst, shortest, back: r.boomUsed };
    } finally { CHASE_CONFIG.boomTime.in = was; }
  };
  const all = run(Infinity), now = run(CHASE_CONFIG.boomTime.in);
  assert.ok(all.worst > 5, `all at once the lens moved ${all.worst.toFixed(2)} m in a frame`);
  // a quarter metre a frame on the way in, and at most the pillar with its clearance either side in one hop
  assert.ok(now.worst < 2, `the lens moved ${now.worst.toFixed(2)} m in a frame`);
  assert.ok(now.shortest < arm.back - 1, `the arm does give way to the pillar (shortest ${now.shortest.toFixed(2)} m of ${arm.back.toFixed(2)})`);
  assert.ok(Math.abs(now.back - arm.back) < 0.01, `and is whole again once the pillar is past (${now.back.toFixed(2)} m)`);
});
