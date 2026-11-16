// Third-person camera stability (render/camera.ts, render/chaseinput.ts, render/view.ts): the defects found with
// scripts/camstats.ts and the browser probes, pinned down. Pure maths and a headless run, no GL. Run with `npm test`.
import test from 'node:test';
import assert from 'node:assert/strict';
import { CHASE_CONFIG, ChaseRig, NO_THREAT, smoothDamp, wobble, type ChaseFrame, type ChaseThreat } from '../src/render/camera';
import { chaseFrameFor } from '../src/render/chaseinput';
import { CHASE_VIEW_R, chaseViewR, fogAt, FOG_VEIL, inStageView, VIEW_BEHIND, VIEW_MARGIN } from '../src/render/view';
import { SKY } from '../src/render/sky';
import { FOG_GLSL } from '../src/render/tilestage';
import { createRun, startStage, step } from '../src/sim/run';
import { botInput } from '../src/sim/bot';
import { NO_INPUT, type InputFrame, type SimContext } from '../src/sim/types';
import { rigSize } from '../scripts/lib/chasesize';

const flat = () => 0;
const frame = (o: Partial<ChaseFrame> = {}): ChaseFrame => ({ dt: 1 / 60, x: 0, y: 0, z: 0, height: 1.1, threat: NO_THREAT, lookYaw: 0, lookPitch: 0, ground: flat, ...o });
const settle = (r: ChaseRig, f: Partial<ChaseFrame>, secs: number, dt = 1 / 60) => { for (let t = 0; t < secs; t += dt) r.update(frame({ ...f, dt })); };
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

test('shake noise is continuous in time (the same at every frame rate), not a new random offset each frame', () => {
  let worst = 0;
  for (let t = 0; t < 5; t += 0.001) worst = Math.max(worst, Math.abs(wobble((t + 0.001) * CHASE_CONFIG.shake.freq, 1) - wobble(t * CHASE_CONFIG.shake.freq, 1)));
  assert.ok(worst < 0.15, `largest step per ms ${worst}`);
});

test('state hysteresis: a crowd hovering at the Pressure threshold does not pump the boom in and out', () => {
  const r = new ChaseRig();
  settle(r, {}, 1);
  let flips = 0, last = r.state;
  for (let i = 0; i < 600; i++) {
    // weight alternates 21 / 17 every 0.25 s (the old rule switched on every crossing of 20)
    const th: ChaseThreat = { nearest: 6, weight: Math.floor(i / 15) % 2 ? 17 : 21, boss: Infinity };
    r.update(frame({ threat: th }));
    if (r.state !== last) { flips++; last = r.state; }
  }
  assert.ok(flips <= 1, `${flips} state changes in 10 s`);
  // and a hostile hovering around 20 m keeps Combat rather than toggling Explore
  const q = new ChaseRig(); settle(q, {}, 4);
  let qf = 0, ql = q.state;
  for (let i = 0; i < 600; i++) { q.update(frame({ threat: { nearest: i % 40 < 20 ? 19 : 23, weight: 0, boss: Infinity } })); if (q.state !== ql) { qf++; ql = q.state; } }
  assert.ok(qf <= 1, `${qf} changes`);
});

test('collision response is continuous: walking past a row of terrain blocks never jolts the lens', () => {
  // 1 m tiles: every other one a 3 m block just right of the path (the shoulder side, inside the boom), walked past at 6 m/s
  const blocks = (x: number, z: number) => (x > 0.6 && x < 1.6 && Math.floor(z) % 2 === 0 ? 3 : 0);
  const r = new ChaseRig();
  r.snapTo(0, 0, 0, Math.PI);
  let shortest = Infinity;
  const dv = maxDv(r, (i) => { shortest = Math.min(shortest, r.boomUsed); return { z: -i / 10, ground: blocks }; }, 300);
  assert.ok(shortest < 3, `the blocks do cut into the boom (shortest ${shortest.toFixed(2)} m)`);
  assert.ok(dv < 15, `largest per-frame change of lens velocity ${dv.toFixed(1)} m/s (the old exponential chase stepped at up to 14 m/s per frame, then 0, then 14 again)`);
});

test('turning beside a cliff pulls the lens in ahead of the rock instead of cutting the zoom in one frame', () => {
  // a 4 m cliff along x > 1.5 (east); the Pokémon stands still while the camera turns at 2 rad/s, so the boom sweeps into it
  const cliff = (x: number) => (x > 1.5 ? 4 : 0);
  const r = new ChaseRig();
  r.snapTo(0, 0, 0, Math.PI);
  settle(r, { ground: cliff }, 1);
  let worst = 0, prev = r.boomUsed, shortest = Infinity;
  for (let i = 0; i < 120; i++) { r.update(frame({ ground: cliff, lookYaw: 2 / 60 })); worst = Math.max(worst, Math.abs(r.boomUsed - prev)); prev = r.boomUsed; shortest = Math.min(shortest, r.boomUsed); }
  assert.ok(shortest < 2, `the boom does swing into the cliff (shortest ${shortest.toFixed(2)} m)`);
  assert.ok(worst < 0.4, `largest single-frame boom change ${worst.toFixed(2)} m`);
  assert.ok(r.eye[1] >= cliff(r.eye[0]) + CHASE_CONFIG.lens.hardFloor - 1e-6 || r.eye[0] < 1.5, 'and the lens never ends up in the rock');
});

test('climbing: never for a wall too tall to see over, and no hunting up and down for a low one', () => {
  // a corridor between 3 m walls 0.7 m either side (the shoulder lens would be in the right one): climbing cannot
  // clear them, so the boom only shortens
  const corridor = (x: number) => (Math.abs(x) > 0.7 ? 3 : 0);
  const a = new ChaseRig(); settle(a, { ground: corridor }, 3);
  assert.ok(a.boomUsed < CHASE_CONFIG.states.explore.boom * 0.8, `the corridor shortens the boom (${a.boomUsed.toFixed(2)} m)`);
  assert.equal(a.liftDeg, 0, 'no climb in a tall corridor');
  // a 1.4 m ledge right behind a small Pokémon: a small climb clears it, and the climb holds steady
  const ledge = (_x: number, z: number) => (z > 0.9 ? 1.4 : 0);
  const b = new ChaseRig();
  settle(b, { ground: ledge, height: 0.7 }, 2);
  let reversals = 0, dir = 0, prev = b.liftDeg;
  for (let i = 0; i < 180; i++) { b.update(frame({ ground: ledge, height: 0.7 })); const d = Math.sign(b.liftDeg - prev); if (d && dir && d !== dir) reversals++; if (d) dir = d; prev = b.liftDeg; }
  assert.ok(b.liftDeg <= CHASE_CONFIG.maxLift + 1e-6);
  assert.ok(reversals === 0, `the climb reversed ${reversals} times while nothing moved`);
});

test('the pivot never cuts a corner through a rise (a lens thrown onto the rock and back on alternate frames)', () => {
  // a raised 3 m block occupying x < 0, z < 0; the Pokémon runs tight along its east face at 8 m/s, then turns west
  // along its north face (the lagging pivot cuts the corner, through the block)
  const block = (x: number, z: number) => (x < 0 && z < 0 ? 3 : 0);
  const r = new ChaseRig();
  r.snapTo(0.15, 0, -6, Math.PI);
  const path: [number, number][] = [];
  for (let i = 0; i <= 46; i++) path.push([0.15, -6 + i * 0.133]);
  for (let i = 1; i <= 46; i++) path.push([0.15 - i * 0.133, 0.15]);
  let ey: number[] = [];
  for (const [x, z] of path) { r.update(frame({ x, z, ground: block })); assert.ok(block(r.px, r.pz) <= 0.5, `pivot inside the block at (${r.px.toFixed(2)}, ${r.pz.toFixed(2)})`); ey.push(r.eye[1]); }
  let jump = 0; for (let k = 1; k < ey.length; k++) jump = Math.max(jump, Math.abs(ey[k] - ey[k - 1]));
  assert.ok(jump < 0.5, `lens height jumped ${jump.toFixed(2)} m in one frame`);
});

test('slope tilt follows walkable ground only: a wall ahead is not a hill', () => {
  const plain = new ChaseRig(), walled = new ChaseRig();
  settle(plain, {}, 3);
  settle(walled, { ground: (_x, z) => (z < -5 ? 4 : 0) }, 3); // a 4 m wall 5 m in front (yaw pi looks north, -z)
  assert.ok(Math.abs(walled.viewPitch - plain.viewPitch) < 0.5 * Math.PI / 180, `tilted ${((walled.viewPitch - plain.viewPitch) * 180 / Math.PI).toFixed(1)}°`);
});

test('turning on the spot on open ground changes nothing but the yaw', () => {
  const r = new ChaseRig(); settle(r, {}, 2);
  const h = r.eye[1], b = r.boomUsed, p = r.viewPitch;
  for (let i = 0; i < 400; i++) { r.update(frame({ lookYaw: 1 / 60 })); assert.ok(Math.abs(r.eye[1] - h) < 1e-6 && Math.abs(r.boomUsed - b) < 1e-6 && Math.abs(r.viewPitch - p) < 1e-9); }
});

test('the world as the lens sees it: the map edge is a wall; props block only when propsBlockLens is on', () => {
  const ctx = createRun({ seed: 1, species: 'cyndaquil', ruleOverrides: { worldgen: { mode: 'generated' } } });
  const W = ctx.world, M = W.map, P = ctx.player;
  const f = chaseFrameFor(ctx, { dt: 1 / 60, x: P.x, y: P.y, z: P.z, height: 1.1, lookPitch: 0 });
  assert.ok(f.ground(W.half + 3, 0) > 20 && f.ground(0, -W.half - 3) > 20, 'outside the map is a wall');
  const k = M.props.findIndex((p) => M.wall[p.y * M.w + p.x]);
  assert.ok(k >= 0);
  const p = M.props[k], x = p.x - W.half + 0.5, z = p.y - W.half + 0.5, y = W.height(x, z) + 1;
  const was = CHASE_CONFIG.propsBlockLens;
  try {
    CHASE_CONFIG.propsBlockLens = true;
    assert.equal(chaseFrameFor(ctx, { dt: 1 / 60, x: P.x, y: P.y, z: P.z, height: 1.1, lookPitch: 0 }).solid?.(x, y, z), true, 'a tree trunk blocks');
    CHASE_CONFIG.propsBlockLens = false;
    assert.equal(chaseFrameFor(ctx, { dt: 1 / 60, x: P.x, y: P.y, z: P.z, height: 1.1, lookPitch: 0 }).solid, undefined, 'or nothing does');
  } finally { CHASE_CONFIG.propsBlockLens = was; }
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
/** the subject size the renderer submits to the rig (idle frame x the species' visible-size scale) */
const idleSize = (id: string) => { const s = rigSize(id); return { h: s.height, w: s.width }; };
/** a generated map, as the game builds it by default */
function mapRun(seed: number, stage: number, species: string, calm: boolean) {
  const ctx = createRun({ seed, species, ruleOverrides: { worldgen: { mode: 'generated' } } });
  if (stage) startStage(ctx, stage);
  if (calm) ctx.rules.director.spawnBase = -99;
  return ctx;
}
/** the renderer's loop, headless: the sim at 60 Hz from an accumulator, the rig once per drawn frame on the player
 *  interpolated between the last two ticks; `each` sees the rig after every frame */
function drive(ctx: SimContext, fps: number, secs: number, control: (t: number, dt: number) => { inp: InputFrame; lookYaw?: number }, each: (r: ChaseRig, t: number) => void) {
  const P = ctx.player, sz = idleSize(P.species.id), r = new ChaseRig();
  r.snapTo(P.x, P.y, P.z, Math.PI);
  let acc = 0;
  for (let t = 1 / fps; t < secs; t += 1 / fps) {
    const c = control(t, 1 / fps);
    if (c.lookYaw) r.look(c.lookYaw, 0); // Renderer.look
    acc += 1 / fps;
    while (acc >= ctx.dt - 1e-9) { step(ctx, c.inp); acc -= ctx.dt; }
    const a = Math.max(0, Math.min(1, acc / ctx.dt));
    r.update(chaseFrameFor(ctx, { dt: 1 / fps, x: P.px + (P.x - P.px) * a, y: P.py + (P.y - P.py) * a, z: P.pz + (P.z - P.pz) * a, height: sz.h, width: sz.w, lookPitch: 0 }));
    each(r, t);
  }
}

test('backed against a terrace closer than the shortest boom, the lens stays on the Pokémon\'s side, never up on the terrace (the 70° badlands fight)', () => {
  // a Feraligatr-sized Pokémon (1.75 m) with a terrace face just behind it; its top a little above the pivot. The lens
  // used to be lifted out of the terrace onto its top: a metre over the pivot, 0.4 m behind it, looking down past it
  for (const yaw of [Math.PI, 0.5, 2, -1.3]) for (const face of [0.25, 0.35, 0.45]) for (const top of [1.6, 2, 2.4]) {
    const sy = Math.sin(yaw), cy = Math.cos(yaw);
    const back = (x: number, z: number) => x * -sy + z * -cy; // metres behind the Pokémon along the view
    const ground = (x: number, z: number) => (back(x, z) > face ? top : 0);
    const r = new ChaseRig();
    r.snapTo(0, 0, 0, yaw);
    settle(r, { ground, height: 1.75, threat: { nearest: 8, weight: 0, boss: Infinity } }, 1.5);
    for (let i = 0; i < 60; i++) {
      r.update(frame({ ground, height: 1.75, threat: { nearest: 8, weight: 0, boss: Infinity }, lookYaw: Math.sin(i / 9) * 0.004 }));
      const e = elevOf(r);
      const tag = `yaw ${yaw} face ${face} top ${top}`;
      // (the frame is drawn between two 120 Hz ticks, turned to the latest yaw: a few millimetres either side of the face)
      assert.ok(back(r.eye[0], r.eye[2]) <= face + 0.02, `${tag}: lens ${back(r.eye[0], r.eye[2]).toFixed(2)} m behind, past the face`);
      assert.ok(r.eye[1] < top, `${tag}: lens at ${r.eye[1].toFixed(2)} m, on the terrace top`);
      assert.ok(e.up < 0.5, `${tag}: lens ${e.up.toFixed(2)} m over the pivot`);
    }
  }
});

test('the reported badlands fight (seed 1, Feraligatr, 30 s of bot combat): never a steep lens, never on what is behind', () => {
  const ctx = mapRun(1, 1, 'feraligatr', false);
  const cap = CHASE_CONFIG.states.pressure.pitch + CHASE_CONFIG.maxLift + 1; // the highest the rig is meant to go
  let worst = 0, worstUp = -Infinity;
  drive(ctx, 60, 30, (_t, dt) => ({ inp: botInput(ctx), lookYaw: 0.25 * dt }), (r, t) => {
    if (t < 2) return;
    const e = elevOf(r);
    if (r.lensGap >= 1) worst = Math.max(worst, e.deg); else worstUp = Math.max(worstUp, e.up);
  });
  assert.ok(worst <= cap, `boom elevation ${worst.toFixed(1)}° (cap ${cap}°; it reached 70° before)`);
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
      assert.ok(r.eye[1] >= g + CHASE_CONFIG.lens.hardFloor - 1e-6, `lens at ${r.eye.map((v) => v.toFixed(3))} is in the step`);
      prev = r.eye.slice();
    }
    assert.ok(worst < 0.08, `step at ${at} m: lens height jumped ${worst.toFixed(2)} m in one frame`);
  }
});

test('frame rate: the same walk past walls gives the same lens path and the same shoulder swaps at 30, 60, 144 fps and a jittery rate', () => {
  // a wall on the right that forces a shoulder swap, blocks behind, a ramp; the path and yaw are functions of time,
  // set once per frame as the renderer does (Renderer.look writes the yaw, then the rig updates)
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
  const swaps = (s: { t: number; side: number }[]) => { const w: number[] = []; for (let k = 1; k < s.length; k++) if (s[k].side !== s[k - 1].side && s[k].side) w.push(s[k].t); return w; };
  let seed = 7; const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  const ref = path(() => 1 / 60), refSwaps = swaps(ref);
  assert.ok(refSwaps.length >= 1, 'the scene does make the lens swap shoulder');
  for (const [name, dts] of [['30', () => 1 / 30], ['144', () => 1 / 144], ['jitter', () => 1 / 144 + rnd() * (1 / 30 - 1 / 144)]] as [string, () => number][]) {
    const p = path(dts);
    let dev = 0; for (let t = 0.5; t < 9.8; t += 0.01) { const a = at(p, t), b = at(ref, t); dev = Math.max(dev, Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])); }
    const sw = swaps(p);
    assert.equal(sw.length, refSwaps.length, `${name}: ${sw.length} shoulder swaps, ${refSwaps.length} at 60 fps`);
    for (let k = 0; k < sw.length; k++) assert.ok(Math.abs(sw[k] - refSwaps[k]) <= 1 / 30 + 1e-6, `${name}: swap ${k} at ${sw[k].toFixed(3)} s, at 60 fps ${refSwaps[k].toFixed(3)} s`);
    // a frame at 30 fps shows the lens up to one 30 fps frame apart in time; along a 2.2 m/s walk that is ~7 cm
    assert.ok(dev < 0.12, `${name}: lens path ${dev.toFixed(3)} m from the 60 fps one`);
  }
});

test('turning on the spot beside trees on a generated map never zooms (vegetation used to pump the boom 2-3 m)', () => {
  for (const [seed, stage] of [[1, 1], [2, 1], [1, 2]]) {
    const ctx = mapRun(seed, stage, 'cyndaquil', true);
    let lo = Infinity, hi = -Infinity;
    drive(ctx, 60, 1.2 + Math.PI * 2, (t, dt) => ({ inp: NO_INPUT, lookYaw: t > 0.5 ? dt : 0 }), (r, t) => { if (t > 1.2) { lo = Math.min(lo, r.boomUsed); hi = Math.max(hi, r.boomUsed); } });
    assert.ok(hi - lo < 0.05, `seed ${seed} stage ${stage}: boom ranged ${(hi - lo).toFixed(2)} m over a full turn`);
  }
});

test('climbing: never for a bank it cannot see over, even where climbing would open a little more of the boom', () => {
  // a 35° bank rising from right behind the Pokémon: climbing 12° gains some boom but never the 35 % the climb is for,
  // and every degree climbed tips the whole view down (this escaped the first pass: the corridor walls gave no partial
  // gain at any climb, so a rule that climbs for partial gains passed too)
  const bank = (_x: number, z: number) => (z > -0.1 ? (z + 0.1) * 0.7 : 0);
  const r = new ChaseRig();
  settle(r, { ground: bank }, 2);
  assert.ok(r.boomUsed < CHASE_CONFIG.liftClear * CHASE_CONFIG.states.explore.boom, `the bank does block (${r.boomUsed.toFixed(2)} m)`);
  assert.equal(r.liftDeg, 0, 'no climb');
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
    const ctx = mapRun(seed, stage, sp, true);
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
    const ctx = mapRun(seed, stage, sp, true), P = ctx.player, sz = idleSize(sp), pos = [[P.x, P.y, P.z]];
    for (let k = 1; k * ctx.dt < 20.5; k++) { const y = walkYaw(k * ctx.dt); step(ctx, { ...NO_INPUT, mx: Math.sin(y), mz: Math.cos(y) }); pos.push([P.x, P.y, P.z]); }
    let seedR = 11; const rnd = () => ((seedR = (seedR * 1103515245 + 12345) % 2147483648) / 2147483648);
    const replay = (dtOf: () => number) => {
      const r = new ChaseRig(), out: { t: number; e: number[] }[] = [];
      r.snapTo(pos[0][0], pos[0][1], pos[0][2], Math.PI);
      for (let t = 0; t < 19.8;) {
        const dt = dtOf(); t += dt;
        const u = t / ctx.dt, i = Math.min(pos.length - 2, Math.floor(u)), a = u - i, p = pos[i], q = pos[i + 1];
        r.yaw = walkYaw(t);
        r.update(chaseFrameFor(ctx, { dt, x: p[0] + (q[0] - p[0]) * a, y: p[1] + (q[1] - p[1]) * a, z: p[2] + (q[2] - p[2]) * a, height: sz.h, width: sz.w, lookPitch: 0 }));
        out.push({ t, e: r.eye.slice() });
      }
      return out;
    };
    const at = (s: { t: number; e: number[] }[], t: number) => { let k = 1; while (k < s.length - 1 && s[k].t < t) k++; const a = s[k - 1], b = s[k], u = Math.max(0, Math.min(1, (t - a.t) / (b.t - a.t))); return a.e.map((v, c) => v + (b.e[c] - v) * u); };
    const A = replay(fps ? () => 1 / fps : () => 1 / 144 + rnd() * (1 / 30 - 1 / 144)), B = replay(() => 1 / 60);
    let dev = 0; for (let t = 1; t < 19.5; t += 0.05) { const p = at(A, t), q = at(B, t); dev = Math.max(dev, Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2])); }
    assert.ok(dev < 0.25, `seed ${seed} stage ${stage} ${sp} at ${fps || 'jittery'} fps: ${dev.toFixed(2)} m from the 60 fps path`);
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
