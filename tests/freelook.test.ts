// Player-owned free look and the vertical aiming envelope (Phase 4A and R3, docs/THIRD_PERSON_IMPLEMENTATION.md §16, §19;
// the camera as rebuilt in §24). CHASE_CONFIG.aimPitch: the view axis, and so the crosshair ray the sim receives, turns
// only with look input. Slopes, a wall behind, a jump, a step and boom collision may move the lens (and the ray moves
// with it, parallel), but never turn the axis.
//
// The rig is the real ChaseRig driven with the renderer's probes and size-class framing (render/chaseinput.ts). The shots
// are real step() ticks on a private flat world (as tests/aim3d.test.ts), aimed by turning the rig with look input until
// its crosshair is on the target, then sending its sample's ray.
import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultRules } from '../src/rules/defaults';
import { BIOMES } from '../src/rules/stages';
import { SPECIES } from '../src/rules/species';
import { bodyOf } from '../src/rules/sizing';
import { World } from '../src/sim/world';
import { createRun, step } from '../src/sim/run';
import { spawnEnemy } from '../src/sim/enemies';
import { compileMove } from '../src/sim/moves';
import { BTN, NO_INPUT, type InputFrame, type SimContext, type SimEvent } from '../src/sim/types';
import { CHASE_CONFIG, ChaseRig, boomElevation, chaseAim, lookPitchRange, offFrameCue, type ChaseFrame, type ViewSample } from '../src/render/camera';
import { chaseFrameFor } from '../src/render/chaseinput';
import { LOOK, aimRayOf, lookDelta } from '../src/render/hostframe';
import { mat4 } from '../src/render/gl';
import { LEAN_FROM, LEAN_GLSL } from '../src/render/tilestage';
import { VIEW_BEHIND, VIEW_DROP, chaseBehind, inStageView } from '../src/render/view';

type V3 = [number, number, number];
const D2R = Math.PI / 180;
const A = CHASE_CONFIG.aimPitch;
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const sub = (a: readonly number[], b: readonly number[]): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const norm = (a: V3): V3 => { const L = Math.hypot(a[0], a[1], a[2]); return [a[0] / L, a[1] / L, a[2] / L]; };
/** the angle between two directions (atan2 of |a × b| and a · b: exact for tiny angles, where acos of the dot is not) */
const angle = (a: readonly number[], b: readonly number[]) => Math.atan2(Math.hypot(a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]), a[0] * b[0] + a[1] * b[1] + a[2] * b[2]);

// ------------------------------------------------------------------------------------------------ synthetic rig frames
const flat = () => 0;
const frame = (o: Partial<ChaseFrame> = {}): ChaseFrame => ({ dt: 1 / 60, x: 0, y: 0, z: 0, height: 1.1, lookYaw: 0, lookPitch: 0, ground: flat, ...o });
const SIZES = ['pichu', 'cyndaquil', 'charmander', 'feraligatr'];
/** the frame fields chaseFrameFor gives a species: its size class's body height and visible core */
const bodyFrame = (id: string): Partial<ChaseFrame> => { const b = bodyOf(SPECIES.find((s) => s.id === id)!, defaultRules.size); return { height: b.height, visual: b.visualM }; };

// ------------------------------------------------------------------------------------------------ sim scene (aim3d)
function flatWorld(): World {
  const W = new World(defaultRules, BIOMES.meadow, 5);
  const n = W.w * W.h, M = W.map;
  const map = { ...M, terrain: new Uint8Array(n), elev: new Float32Array(n), stairs: new Uint8Array(n), wall: new Uint8Array(n), platform: new Float32Array(n), over: new Float32Array(n), wlevel: undefined };
  Object.assign(W, { map, over: map.over, voids: new Uint8Array(n), los: true });
  return W;
}
const K = (W: World, i: number, j: number) => j * W.w + i;
const C = (W: World, i: number) => i - W.half + 0.5;
function speciesOf(cls: string): string {
  return SPECIES.filter((s) => bodyOf(s, defaultRules.size).sizeClass === cls && !bodyOf(s, defaultRules.size).authored && !s.flying).map((s) => s.id).sort()[0];
}
function scene(species = 'cyndaquil') {
  const ctx = createRun({ seed: 1, species });
  const W = flatWorld();
  ctx.world = W;
  ctx.enemies.clear(); ctx.bodies.clear(); ctx.projectiles.clear(); ctx.zones.clear();
  const p = ctx.player;
  p.x = p.px = C(W, 50); p.z = p.pz = C(W, 50); p.y = p.py = 0; p.facing = 0;
  p.moves.length = 0;
  p.moves.push({ key: 'ember', level: 1, cd: 0, spec: compileMove(ctx.rules, 'ember') });
  ctx.grid.rebuild(ctx.enemies.hi, ctx.enemies.x, ctx.enemies.z, ctx.enemies.alive);
  return { ctx, W };
}
/** a raised block of tiles i0..i1 x j0..j1 at height h */
function raise(W: World, i0: number, i1: number, j0: number, j1: number, h: number) { for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) W.map.elev[K(W, i, j)] = h; }
function put(ctx: SimContext, x: number, y: number, z: number, hover = 0): number {
  const E = ctx.enemies, e = spawnEnemy(ctx, speciesOf('medium'), x, z);
  E.x[e] = E.px[e] = x; E.z[e] = E.pz[e] = z; E.y[e] = E.py[e] = y + hover; E.hover[e] = hover;
  E.spawnT[e] = 1; E.hp[e] = E.maxHp[e] = 1e6; E.speed[e] = 0; E.dmg[e] = 0;
  ctx.grid.rebuild(E.hi, E.x, E.z, E.alive);
  return e;
}
const centre = (ctx: SimContext, e: number): V3 => [ctx.enemies.x[e], ctx.enemies.y[e] + ctx.enemies.tall[e] / 2, ctx.enemies.z[e]];

/** main.ts + Renderer, headless at 60 fps (one tick per frame): look -> one sample -> the tick -> rig.update */
class Host {
  rig = new ChaseRig();
  constructor(readonly ctx: SimContext, yaw = 0) {
    const P = ctx.player;
    this.rig.snapTo(P.x, P.y, P.z, yaw);
  }
  render(dt = 1 / 60) {
    const P = this.ctx.player;
    this.rig.update(chaseFrameFor(this.ctx, { dt, x: P.x, y: P.y, z: P.z, lookPitch: 0 }), { pitchRange: lookPitchRange(), fovOffset: 0 });
  }
  /** one frame: optional look, then the tick with that frame's sample */
  frame(look: [number, number] | null, btn = 0, extra: Partial<InputFrame> = {}): { view: ViewSample; events: SimEvent[] } {
    if (look) this.rig.look(look[0], look[1]);
    const v = this.rig.sample(1280, 720), P = this.ctx.player;
    const sy = Math.sin(v.yaw), cy = Math.cos(v.yaw);
    const [ax, az] = chaseAim(v, P.x, P.z, v.aspect, (x, z) => this.ctx.world.height(x, z));
    const mv = extra.mx !== undefined ? { mx: sy * extra.mx, mz: cy * extra.mx } : {};
    const events = step(this.ctx, { ...NO_INPUT, btn, aimX: ax, aimZ: az, aim: aimRayOf(v), aimDev: 'mouse', ...extra, ...mv });
    this.render();
    return { view: v, events };
  }
  /** turn the rig with look input until its crosshair ray (from its own, moving lens) points at `at` */
  aimAt(at: V3): ViewSample {
    for (let k = 0; k < 12; k++) {
      const v = this.rig.sample(1280, 720), d = norm(sub(at, v.eye));
      this.rig.look(wrap(v.yaw - Math.atan2(d[0], d[2])), Math.asin(-d[1]) - v.viewPitch);
      if (k % 3 === 2) this.render(0); // let the rig recompose its ticks at the new pitch without time passing
    }
    return this.rig.sample(1280, 720);
  }
}
/** the shortest distance from point p to the ray (o, d) */
const rayMiss = (v: ViewSample, p: V3) => { const w = sub(p, v.eye), t = w[0] * v.dir[0] + w[1] * v.dir[1] + w[2] * v.dir[2]; return Math.hypot(w[0] - v.dir[0] * t, w[1] - v.dir[1] * t, w[2] - v.dir[2] * t); };

// ================================================================================================ ownership

test('free look: nothing automatic (slopes, a wall behind, a ledge, a jump, a step) turns the crosshair ray', () => {
  // one rig through every automatic presentation change in turn, no look input at all
  const r = new ChaseRig();
  r.snapTo(0, 0, 0, Math.PI);
  for (let i = 0; i < 120; i++) r.update(frame());
  const dir0 = r.sample(1280, 720).dir, eye0 = r.eye.slice(), elev0 = boomElevation(r.userPitch);
  let worst = 0, lensTravel = 0;
  const phases: Partial<ChaseFrame>[] = [
    { ground: (_x, z) => Math.max(0, -z * 0.4) }, { ground: (_x, z) => Math.min(0, z * 0.4) }, // slope ahead up, down
    { ground: (_x, z) => (z > 0.8 ? 0.9 : 0) },                                     // a 0.9 m ledge behind: the boom shortens
    { ground: (_x, z) => (z > 1.2 ? 4 : 0) },                                       // a 4 m wall behind
    { y: 1.6 }, {},                                                                   // a jump and the landing
    { y: 0.5, ground: () => 0.5 }, {},                                                // a step up and back down
  ];
  for (const ph of phases) for (let i = 0; i < 120; i++) {
    r.update(frame(ph));
    worst = Math.max(worst, angle(r.sample(1280, 720).dir, dir0));
    lensTravel = Math.max(lensTravel, Math.hypot(r.eye[0] - eye0[0], r.eye[1] - eye0[1], r.eye[2] - eye0[2]));
  }
  assert.ok(worst < 1e-6, `the ray turned ${worst}° with no input`);
  assert.ok(lensTravel > 0.5, `the lens still moves for them (${lensTravel.toFixed(2)} m): only the axis is player-owned`);
  assert.equal(boomElevation(r.userPitch), elev0, 'and nothing changed the arm elevation the pitch asks for');
});

test('pitch bounds: the configured envelope, at least 45 deg up (plan Stage 6A), absolute about the horizon at every size', () => {
  assert.deepEqual(lookPitchRange(), [-A.up - A.neutral, A.down - A.neutral]);
  assert.ok(A.up >= 45 && A.down >= 45, `envelope up ${A.up}, down ${A.down}`);
  for (const f of [{}, bodyFrame('feraligatr')]) {
    const r = new ChaseRig(); r.snapTo(0, 0, 0, Math.PI);
    for (let i = 0; i < 120; i++) r.update(frame(f));
    assert.ok(Math.abs(r.viewPitch - A.neutral * D2R) < 1e-12, `no input: the neutral ${A.neutral}°`);
    r.look(0, -10);
    for (let i = 0; i < 30; i++) r.update(frame(f));
    assert.ok(Math.abs(r.viewPitch + A.up * D2R) < 1e-12, `looks up at most ${A.up}°: ${r.viewPitch / D2R}`);
    assert.ok(Math.abs(r.sample(1280, 720).dir[1] - Math.sin(A.up * D2R)) < 1e-12);
    r.look(0, 10);
    for (let i = 0; i < 30; i++) r.update(frame(f));
    assert.ok(Math.abs(r.viewPitch - A.down * D2R) < 1e-12, `looks down at most ${A.down}°: ${r.viewPitch / D2R}`);
  }
});

test('the same look input gives the same aim direction on any terrain, collision or body size', () => {
  // the same gesture from a reset rig: a turn and a climb of the pitch in steps, then down again
  const gesture: [number, number][] = [[0.3, -0.2], [0.4, -0.3], [-0.1, -0.25], [0.2, 0.5], [0, 0.12]];
  const ceiling = (_x: number, z: number) => (z < 3 && z > -3 ? 2.6 : Infinity);
  const cases: [string, Partial<ChaseFrame>][] = [
    ['flat', {}], ['uphill', { ground: (_x, z) => Math.max(0, -z * 0.4) }],
    ['wall behind', { ground: (_x, z) => (z > 1.2 ? 4 : 0) }], ['under a deck', { ceiling }], ['Tiny body', bodyFrame('pichu')], ['XL body', bodyFrame('feraligatr')],
    ['airborne', { y: 1.4 }],
  ];
  let ref: ViewSample | null = null;
  for (const [label, f] of cases) {
    const r = new ChaseRig(); r.snapTo(0, 0, 0, Math.PI);
    for (let i = 0; i < 120; i++) r.update(frame(f));
    for (const [dy, dp] of gesture) { r.look(dy, dp); for (let i = 0; i < 10; i++) r.update(frame(f)); }
    const v = r.sample(1280, 720);
    ref ??= v;
    assert.ok(Math.abs(wrap(v.yaw - ref.yaw)) < 1e-12 && Math.abs(v.viewPitch - ref.viewPitch) < 1e-12, `${label}: yaw / pitch`);
    assert.ok(angle(v.dir, ref.dir) < 1e-9, `${label}: direction ${angle(v.dir, ref.dir) / D2R}°`);
  }
});

test('a wall on the right shoulder: the hand gives way, the lens stays on that side, the ray direction never moves', () => {
  // a 6 m wall close on the right of the view (yaw pi looks north, right is +x). The rig of 2026-11 swapped shoulder here
  // (a lateral jump of the whole composition the player did not ask for); the shoulder arm shortens instead, the back
  // arm keeps its length, and the Pokémon dissolves where it now has to cross the crosshair
  const ground = (x: number) => (x > 0.5 ? 6 : 0);
  const r = new ChaseRig(); r.snapTo(0, 0, 0, Math.PI);
  r.look(0, -20 * D2R); // looking up, off neutral, so anything that touched the pitch would show
  for (let i = 0; i < 30; i++) r.update(frame());
  const dir0 = r.sample(1280, 720).dir, free = r.boomUsed, side = r.shoulderUsed;
  let worst = 0, minSide = Infinity;
  for (let i = 0; i < 240; i++) {
    r.update(frame({ ground }));
    worst = Math.max(worst, angle(r.sample(1280, 720).dir, dir0));
    minSide = Math.min(minSide, r.shoulderUsed);
  }
  assert.ok(minSide > 0, `the lens stayed on the right shoulder (${minSide.toFixed(2)} m)`);
  assert.ok(r.shoulderUsed < side - 0.5 && r.shoulderUsed <= 0.5 - CHASE_CONFIG.lens.clear + 0.01, `the shoulder came in (${r.shoulderUsed.toFixed(2)} of ${side.toFixed(2)} m)`);
  assert.ok(Math.abs(r.boomUsed - free) < 1e-6, `the back arm did not (${r.boomUsed.toFixed(2)} of ${free.toFixed(2)} m)`);
  assert.ok(worst < 1e-9, `the ray turned ${worst / D2R}°`);
});

test('pitch never tilts ground movement: walking forward at the up limit, level and the down limit moves the body identically', () => {
  const paths: number[][] = [];
  for (const pitch of [-A.up, 0, A.down]) {
    const { ctx } = scene();
    const h = new Host(ctx, 0);
    for (let i = 0; i < 30; i++) h.render();
    h.rig.look(0, (pitch - A.neutral - h.rig.userPitch) * D2R);
    assert.ok(Math.abs(h.rig.viewPitch / D2R - pitch) < 1e-9);
    const P = ctx.player, path: number[] = [];
    for (let i = 0; i < 90; i++) { h.frame(null, 0, { mx: 1 }); path.push(P.x, P.z, P.y); }
    paths.push(path);
    // straight along the camera yaw (0 = +z), whatever the pitch
    assert.ok(Math.abs(P.x - C(ctx.world as World, 50)) < 1e-9 && P.z - C(ctx.world as World, 50) > 3, `pitch ${pitch}: moved (${P.x}, ${P.z})`);
  }
  assert.deepEqual(paths[0], paths[1]); assert.deepEqual(paths[2], paths[1]);
  // mouse and stick: a purely vertical gesture never turns the yaw, a purely horizontal one never the pitch
  assert.deepEqual(lookDelta([0, 40], [0, 0], 1 / 60, 1, false), [0, 40 * LOOK.mouse]);
  assert.deepEqual(lookDelta([0, 0], [0, -1], 1 / 60, 1, true), [0, 1.5 / 60]);
  assert.equal(lookDelta([25, 0], [0, 0], 1 / 60, 1, false)?.[1], 0);
});

test('render rate: the same mouse and stick input reaches the same pitch and ray at 30, 60, 144 and 240 fps', () => {
  const out: ViewSample[] = [];
  for (const fps of [30, 60, 144, 240]) {
    const r = new ChaseRig(); r.snapTo(0, 0, 0, Math.PI);
    for (let i = 0; i < 60; i++) r.update(frame({ dt: 1 / 60 }));
    // 0.5 s: the right stick up at 0.6 and right at 0.3, plus 240 px of mouse down spread evenly over the frames
    const n = Math.round(fps * 0.5), dt = 1 / fps;
    for (let k = 0; k < n; k++) {
      const d = lookDelta([0, 240 / n], [0.3, -0.6], dt, 1, false)!;
      r.look(d[0], d[1]);
      r.update(frame({ dt }));
    }
    for (let k = 0; k < fps; k++) r.update(frame({ dt })); // the lens settles; the axis already has its final value
    out.push(r.sample(1280, 720));
  }
  for (const v of out.slice(1)) {
    assert.ok(Math.abs(v.userPitch - out[0].userPitch) < 1e-9 && Math.abs(wrap(v.yaw - out[0].yaw)) < 1e-9, `pitch ${v.userPitch} vs ${out[0].userPitch}`);
    assert.ok(angle(v.dir, out[0].dir) < 1e-9);
    assert.ok(Math.hypot(...sub(v.eye, out[0].eye)) < 0.02, `settled lens ${Math.hypot(...sub(v.eye, out[0].eye))} m apart`);
  }
});

// ================================================================================================ 3D shots at the limits

test('elevated targets: an enemy at the rim of a 6 m ledge and one hovering 7 m up are centred with look input and hit', () => {
  const cases: [string, (ctx: SimContext, W: World) => number][] = [
    // a 6 m block whose near face is 3.5 m ahead (the partner faces +z); the enemy stands at its rim (deeper in, the lip
    // hides it from the muzzle though the lens sees it: the reticle's blocked case, tests/aim3d.test.ts)
    ['ledge', (ctx, W) => { raise(W, 49, 51, 54, 56, 6); return put(ctx, ctx.player.x, 6, ctx.player.z + 3.8); }],
    ['airborne', (ctx) => put(ctx, ctx.player.x - 1, 0, ctx.player.z + 5, 7)],
  ];
  for (const [label, make] of cases) {
    const { ctx, W } = scene();
    const e = make(ctx, W);
    const h = new Host(ctx, 0);
    for (let i = 0; i < 60; i++) h.render();
    const v = h.aimAt(centre(ctx, e)), miss = rayMiss(v, centre(ctx, e));
    assert.ok(miss < 0.05, `${label}: the crosshair is on it (${miss.toFixed(3)} m)`);
    assert.ok(-v.viewPitch / D2R > 25, `${label}: that needs ${(-v.viewPitch / D2R).toFixed(1)}° of look up`);
    let hits = 0;
    for (let k = 0; k < 60; k++) for (const ev of h.frame(null, k === 0 ? BTN.basic : 0).events) if (ev.t === 'hit' && ev.enemy === e) hits++;
    assert.ok(hits >= 1, `${label}: hit`);
  }
});

test('steep downward aim: from a 4 m rise, an enemy on the ground below is centred and hit', () => {
  {
    const { ctx, W } = scene();
    raise(W, 40, 60, 40, 50, 4); // the partner stands 0.5 m back from the rim (its tile row j = 50 is the last)
    const P = ctx.player; P.y = P.py = 4;
    const e = put(ctx, P.x, 0, P.z + 4.5);
    const h = new Host(ctx, 0);
    for (let i = 0; i < 60; i++) h.render();
    const v = h.aimAt(centre(ctx, e)), miss = rayMiss(v, centre(ctx, e));
    assert.ok(miss < 0.05, `the crosshair is on it (${miss.toFixed(3)} m)`);
    assert.ok(v.viewPitch / D2R > 30, `that needs ${(v.viewPitch / D2R).toFixed(1)}° of look down`);
    let hits = 0;
    for (let k = 0; k < 60; k++) for (const ev of h.frame(null, k === 0 ? BTN.basic : 0).events) if (ev.t === 'hit' && ev.enemy === e) hits++;
    assert.ok(hits >= 1, 'hit');
  }
});

test('jump aiming: aiming up at a hovering enemy through a jump, the shot fired at the apex hits it', () => {
  const { ctx } = scene();
  const P = ctx.player, e = put(ctx, P.x + 1, 0, P.z + 6, 4.5);
  const h = new Host(ctx, 0);
  for (let i = 0; i < 60; i++) h.render();
  h.frame(null, 0, { jump: true });
  let apex = 0, fired = false, hits = 0;
  for (let k = 0; k < 90; k++) {
    const vy = P.vy;
    h.aimAt(centre(ctx, e)); // the player keeps the crosshair on it while the lens follows the jump
    const btn = !fired && P.y > 0.3 && vy <= 0 ? BTN.basic : 0;
    if (btn) { fired = true; apex = P.y; }
    for (const ev of h.frame(null, btn).events) if (ev.t === 'hit' && ev.enemy === e) hits++;
  }
  assert.ok(fired && apex > 0.3, `fired in the air (${apex.toFixed(2)} m)`);
  assert.ok(hits >= 1, 'hit');
});

// ================================================================================================ visibility at the limits

test('low ceilings: under a deck at both pitch limits the lens stays under the slab and the ray keeps its pitch', () => {
  const slab = 2.4, ceiling = (_x: number, z: number) => (z < 6 && z > -6 ? slab : Infinity);
  // every size class that fits under a 2.4 m slab, Extra Large included: the pivot comes from the class's body height
  // (an XL body is at most 2.4 m tall, so its pivot is under the slab's lens clearance; the old pivot came from the drawn
  // sprite, 2.7 m, and an XL lens collapsed onto its back under every 2.4 m deck: F5)
  for (const id of ['cyndaquil', 'feraligatr']) for (const pitch of [-A.up, A.down]) {
    const r = new ChaseRig(); r.snapTo(0, 0, 0, Math.PI);
    const f = frame({ ceiling, ...bodyFrame(id) });
    for (let i = 0; i < 60; i++) r.update(f);
    r.look(0.5, (pitch - A.neutral) * D2R);
    for (let i = 0; i < 120; i++) {
      r.update(f);
      assert.ok(r.eye[1] <= slab - 0.3 + 1e-9, `${id} ${pitch}°: lens ${r.eye[1].toFixed(2)} m under a ${slab} m slab`);
      assert.ok(r.eye[1] >= CHASE_CONFIG.lens.clear - 1e-9, `${id} ${pitch}°: lens above the floor`);
      assert.ok(Math.abs(r.viewPitch / D2R - pitch) < 1e-9);
    }
  }
});

test('geometry behind the bounds: the arm holds its elevation band to 40° down with the crosshair ahead of the feet; past ~33 deg up the body has left the frame', () => {
  // the measurements that set aimPitch (docs/THIRD_PERSON_IMPLEMENTATION.md §16.3), pinned so a retune revisits them; past
  // the 40° cap the R3 tests below pin the rise
  const CAP = CHASE_CONFIG.elevation[1];
  for (const id of SIZES) {
    const b = bodyFrame(id);
    const at = (pitch: number) => {
      const r = new ChaseRig(); r.snapTo(0, 0, 0, Math.PI);
      const f = frame(b);
      for (let i = 0; i < 180; i++) r.update(f);
      r.look(0, (pitch - A.neutral) * D2R);
      for (let i = 0; i < 120; i++) r.update(f);
      return r;
    };
    // where the crosshair meets level ground, ahead of the feet (yaw pi looks -z)
    const ahead = (r: ChaseRig) => -(r.eye[2] - Math.cos(r.viewPitch) * (r.eye[1] / Math.sin(r.viewPitch)));
    assert.ok(ahead(at(45)) > 0, `${id}: at 45° down the crosshair is still ahead of the feet`);
    assert.ok(ahead(at(CAP)) > 0, `${id}: at ${CAP}° the crosshair is ahead of the feet (${ahead(at(CAP)).toFixed(2)} m)`);
    // the head's height on screen at 40 deg up, as a fraction of the half-height (-1 = the bottom edge)
    const r = at(-40), vp = r.viewPitch, up = [0, Math.cos(vp), -Math.sin(vp)], dir = r.sample(1, 1).dir;
    const w = sub([0, b.visual!, 0], r.eye), z = w[0] * dir[0] + w[1] * dir[1] + w[2] * dir[2], y = w[0] * up[0] + w[1] * up[1] + w[2] * up[2];
    assert.ok(y / z / Math.tan(r.fov / 2) < -1, `${id}: at 40° up the body is below the frame`);
    // up to the cap the lens never leaves its elevation band for pitch
    const hi = at(CAP), elev = Math.atan2(hi.eye[1] - hi.py - hi.pivotH, Math.hypot(hi.eye[0] - hi.px, hi.eye[2] - hi.pz)) / D2R;
    assert.ok(elev <= CHASE_CONFIG.elevation[1] + 0.5, `${id}: boom elevation ${elev.toFixed(1)}°`);
  }
});

// ------------------------------------------------------------------------------------------------ R2: the view basis
// docs/THIRD_PERSON_IMPLEMENTATION.md §18, audit F8. The renderer builds its view matrix from the yaw (mat4.viewYawPitch)
// instead of lookAt with world up, whose `up × forward` vanishes at a vertical view.
test('R2: the view matrix from yaw and pitch is orthonormal up to and at ±90°, and is lookAt\'s matrix inside the envelope', () => {
  const rows = (m: Float32Array): V3[] => [[m[0], m[4], m[8]], [m[1], m[5], m[9]], [m[2], m[6], m[10]]];
  const dot3 = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const eye = [3.5, 2.2, -7.25];
  for (const yawDeg of [0, 37, 90, 180, -123]) {
    const yaw = yawDeg * D2R;
    for (const pDeg of [-90, -89.99, -89.9, -89, -60, -20, 0, 20, 50, 89, 89.9, 89.99, 90]) {
      const p = pDeg * D2R, V = mat4.viewYawPitch(new Float32Array(16), eye, yaw, p), [x, y, z] = rows(V);
      for (const [a, b, want] of [[x, x, 1], [y, y, 1], [z, z, 1], [x, y, 0], [y, z, 0], [z, x, 0]] as [V3, V3, number][]) {
        assert.ok(Math.abs(dot3(a, b) - want) < 1e-6, `yaw ${yawDeg} pitch ${pDeg}: orthonormal`);
      }
      // right-handed, the view looking along (yaw, pitch), right horizontal (no roll), the eye at the origin
      const look: V3 = [Math.sin(yaw) * Math.cos(p), -Math.sin(p), Math.cos(yaw) * Math.cos(p)];
      assert.ok(dot3(z, look) < -1 + 1e-6, `yaw ${yawDeg} pitch ${pDeg}: looks along the view direction`);
      assert.ok(Math.abs(x[1]) < 1e-7 && Math.abs(dot3(x, [-Math.cos(yaw), 0, Math.sin(yaw)]) - 1) < 1e-6, `yaw ${yawDeg} pitch ${pDeg}: right from the yaw`);
      const c: V3 = [y[1] * z[2] - y[2] * z[1], y[2] * z[0] - y[0] * z[2], y[0] * z[1] - y[1] * z[0]];
      assert.ok(dot3(c, x) > 1 - 1e-6, `yaw ${yawDeg} pitch ${pDeg}: right-handed`);
      for (let r = 0; r < 3; r++) assert.ok(Math.abs(V[12 + r] + dot3(rows(V)[r], eye as V3)) < 1e-4, 'translation');
      // inside today's envelope it is the lookAt matrix the renderer used before
      if (Math.abs(pDeg) <= 60) {
        const at = [eye[0] + look[0] * 20, eye[1] + look[1] * 20, eye[2] + look[2] * 20];
        const L = mat4.lookAt(new Float32Array(16), eye, at, [0, 1, 0]);
        for (let k = 0; k < 16; k++) assert.ok(Math.abs(L[k] - V[k]) < 1e-5, `yaw ${yawDeg} pitch ${pDeg}: element ${k} equals lookAt's`);
      }
    }
    // continuous into the pole: 89.9° → 90° changes no element by more than the 0.1° turn itself
    for (const sgn of [1, -1]) {
      const a = mat4.viewYawPitch(new Float32Array(16), eye, yaw, sgn * 89.9 * D2R), b = mat4.viewYawPitch(new Float32Array(16), eye, yaw, sgn * 90 * D2R);
      for (let k = 0; k < 12; k++) assert.ok(Math.abs(a[k] - b[k]) < 0.0018, `yaw ${yawDeg} ${sgn > 0 ? 'down' : 'up'}: element ${k} continuous at the pole`);
    }
  }
});

// ================================================================================================ R3: the full envelope
// docs/THIRD_PERSON_IMPLEMENTATION.md §19, audit F4 and F9, owner decisions B, C, E. The view looks up to 89° above and
// 89° below the horizon. Past 40° down the lens leaves the elevation cap and rises over the Pokémon; looking up the lens
// stays low and an edge cue shows the body.
/** where the crosshair meets level ground (y = 0), ahead of the feet at the origin along the view yaw (pi looks -z) */
const aheadOf = (r: ChaseRig) => -(r.eye[2] - Math.cos(r.viewPitch) * (r.eye[1] / Math.sin(r.viewPitch)));
/** a rig settled on flat ground at view pitch `pitch` (deg, + down) */
function settledAt(id: string, pitch: number) {
  const r = new ChaseRig(); r.snapTo(0, 0, 0, Math.PI);
  const f = frame(bodyFrame(id));
  for (let i = 0; i < 180; i++) r.update(f);
  r.look(0, (pitch - A.neutral - r.userPitch) * D2R);
  for (let i = 0; i < 60; i++) r.update(f);
  return r;
}

test('R3: the envelope is ±89° about the horizon (decision E) at every size, and the ray stays a unit vector there', () => {
  assert.equal(A.up, 89); assert.equal(A.down, 89);
  for (const id of SIZES) for (const pitch of [-89, 89]) {
    const r = settledAt(id, pitch), v = r.sample(1280, 720);
    assert.ok(Math.abs(v.viewPitch / D2R - pitch) < 1e-9, `${pitch}°: ${v.viewPitch / D2R}`);
    assert.ok(Math.abs(Math.hypot(...v.dir) - 1) < 1e-12 && Math.abs(v.dir[1] + Math.sin(pitch * D2R)) < 1e-12);
    r.look(0, Math.sign(pitch) * 0.5); // past the limit: clamped
    assert.ok(Math.abs(r.viewPitch / D2R - pitch) < 1e-9);
  }
});

test('R3: past 40° down the lens rises with the view (elevation = view pitch); the crosshair meets level ground ahead of the feet from 30° to 89°, moving monotonically toward them', () => {
  for (const id of SIZES) {
    const st = 'framed';
    let prevElev = -Infinity, prevAhead = Infinity;
    for (let p = 30; p <= 89 + 1e-9; p += 0.5) {
      const r = settledAt(id, p);
      // the boom's elevation in the view's vertical plane (the shoulder offset is across it)
      const bx = r.eye[0] - r.px, bz = r.eye[2] - r.pz, back = -(bx * Math.sin(r.yaw) + bz * Math.cos(r.yaw));
      const elev = Math.atan2(r.eye[1] - r.py - r.pivotH, back) / D2R;
      assert.ok(Math.abs(elev - boomElevation(r.userPitch)) < 1e-6, `${id} ${st} ${p}°: lens at the mapped elevation (${elev.toFixed(3)}°)`);
      assert.ok(elev >= prevElev - 1e-9, `${id} ${st} ${p}°: the lens only rises as the view looks further down`);
      assert.ok(elev >= p - 1e-6, `${id} ${st} ${p}°: never below the view pitch (${elev.toFixed(4)})`);
      if (p >= CHASE_CONFIG.elevation[1]) assert.ok(Math.abs(elev - p) < 1e-6, `${id} ${st} ${p}°: elevation = view pitch (${elev.toFixed(4)})`);
      const ahead = aheadOf(r);
      assert.ok(ahead > 0, `${id} ${st} ${p}°: the crosshair is ahead of the feet (${ahead.toFixed(3)} m)`);
      assert.ok(ahead <= prevAhead + 1e-9, `${id} ${st} ${p}°: monotone toward the feet (${ahead.toFixed(3)} after ${prevAhead.toFixed(3)})`);
      prevAhead = ahead; prevElev = elev;
    }
    assert.ok(aheadOf(settledAt(id, 80)) > 0.05, `${id} ${st}: ahead of the feet at 80°`);
  }
});

test('R3: sweeping the pitch in 0.05° steps over the whole envelope moves the lens smoothly, and the same overhead gesture gives the same view at 30, 60, 144, 240 fps', () => {
  const step = 0.05;
  for (const id of SIZES) {
    const st = 'framed';
    const r = new ChaseRig(); r.snapTo(0, 0, 0, Math.PI);
    const f = frame(bodyFrame(id));
    for (let i = 0; i < 180; i++) r.update(f);
    let worst = 0, prev = r.eye.slice();
    for (const [a, b] of [[A.neutral, 89], [89, -89], [-89, A.neutral]]) {
      const n = Math.round(Math.abs(b - a) / step), dir = Math.sign(b - a);
      for (let k = 0; k < n; k++) {
        r.look(0, dir * step * D2R); r.update(f);
        // the lens swings about the pivot no faster than the pitch (elevation = the pitch + reticle.below, the cap, or the
        // pitch), and the pivot rides the top of the sprite as drawn, which the billboard stretch moves with the lens'
        // elevation (up to 0.6 of the outline's top over the 51° the stretch works in): together under 1.7 arcs a step
        const moved = Math.hypot(r.eye[0] - prev[0], r.eye[1] - prev[1], r.eye[2] - prev[2]), arc = r.lensGap * step * D2R;
        worst = Math.max(worst, moved / arc); prev = r.eye.slice();
      }
    }
    assert.ok(worst < 1.7, `${id} ${st}: largest lens step ${worst.toFixed(3)} × the arc of the pitch step`);
    assert.equal(r.groundPops, 0, `${id} ${st}: no safety-net slides on open ground`);
  }
  // the same mouse and stick gesture into the overhead band (about 80° down) at four frame rates
  const out: ChaseRig[] = [];
  for (const fps of [30, 60, 144, 240]) {
    const r = new ChaseRig(); r.snapTo(0, 0, 0, Math.PI);
    for (let i = 0; i < 60; i++) r.update(frame({ dt: 1 / 60 }));
    const n = Math.round(fps * 0.5), dt = 1 / fps;
    for (let k = 0; k < n; k++) { const d = lookDelta([0, 700 / n], [0.2, 0.3], dt, 1, false)!; r.look(d[0], d[1]); r.update(frame({ dt })); }
    for (let k = 0; k < fps; k++) r.update(frame({ dt }));
    out.push(r);
  }
  assert.ok(out[0].viewPitch / D2R > 75, `the gesture reaches the overhead band (${(out[0].viewPitch / D2R).toFixed(1)}°)`);
  for (const r of out.slice(1)) {
    assert.ok(Math.abs(r.userPitch - out[0].userPitch) < 1e-9 && Math.abs(wrap(r.yaw - out[0].yaw)) < 1e-9);
    assert.ok(Math.hypot(...sub(r.eye, out[0].eye)) < 0.02, `settled overhead lens ${Math.hypot(...sub(r.eye, out[0].eye)).toFixed(4)} m apart`);
  }
});

test('decks: walking under, through and out of a 2.4 m deck at the neutral pitch, the 40° cap, 70° and 89° down, the lens stays out of the slab, never slides and never moves more than 0.5 m in a frame, at every size', () => {
  // the deck covers z in (-1, 8); yaw pi looks -z. Walks at 6 m/s: forward out from under it, backward in, forward under and
  // through. The slab's cap on the arm's elevation is eased and tested along the boom's whole track and ahead of the
  // Pokémon (CHASE_CONFIG.deck); switched by the slab over the pivot alone, as before, walking out threw the lens up 1.5 m
  // (Pichu) to 9 m (Extra Large: F5) in one frame
  const ceiling = (_x: number, z: number) => (z > -1 && z < 8 ? 2.4 : Infinity);
  for (const id of SIZES) for (const mode of ['out', 'back', 'thru'] as const) for (const pitch of [A.neutral, CHASE_CONFIG.elevation[1], 70, 89]) {
    const r = new ChaseRig();
    let z = mode === 'out' ? 4 : mode === 'back' ? -7 : 12;
    r.snapTo(0, 0, z, Math.PI);
    const f = () => frame({ z, ...bodyFrame(id), ceiling });
    for (let i = 0; i < 60; i++) r.update(f());
    r.look(0, (pitch - A.neutral - r.userPitch) * D2R);
    for (let i = 0; i < 60; i++) r.update(f());
    let jump = 0, prev = r.eye.slice();
    const pops = r.groundPops;
    for (let i = 0; i < (mode === 'thru' ? 270 : 150); i++) {
      z += (mode === 'back' ? 1 : -1) * 0.1; r.update(f());
      if (ceiling(r.eye[0], r.eye[2]) < Infinity) assert.ok(r.eye[1] <= 2.4 - 0.3 + 1e-9, `${id} ${pitch}° ${mode}: lens ${r.eye[1].toFixed(2)} m under the slab`);
      jump = Math.max(jump, Math.hypot(...sub(r.eye, prev))); prev = r.eye.slice();
    }
    // (P1's last check on the composed frame may bring the lens in a few centimetres at the slab's edge: `pops` counts
    // those; what matters is that no frame moves the lens far)
    // 0.5 m at the pitches a player holds; looking 70° or more down, the lens (then almost over the pivot, with no
    // ground track behind it to see the slab coming) is brought under the slab, or let back up, faster: up to 0.8 m in
    // a frame. The rig no longer reads the velocity, which is what saw that slab early
    // (and an Extra Large, whose outline stands 1.4 m over the slab's clearance: its pivot has that far to come down as
    // the slab comes over the arm, and what the easing has not done by then is done at once: up to 1.0 m, on the 8.3 m
    // arm the drawn-height law gives it. An Extra Large does not fit under a 2.4 m deck: this is the rig's bound only)
    const lim = bodyOf(SPECIES.find((s) => s.id === id)!, defaultRules.size).sizeClass === 'xl' ? 1.1 : pitch >= 70 ? 0.8 : 0.5;
    assert.ok(jump <= lim, `${id} ${mode} at ${pitch}°: largest frame step ${jump.toFixed(2)} m (${r.groundPops - pops} frames checked in)`);
  }
});

test('R3: at the limits an enemy down a 3 m pit at the feet and one hovering 16 m overhead are centred with look input and hit', () => {
  const cases: [string, (ctx: SimContext, W: World) => number, (p: number) => boolean][] = [
    // a pit whose near edge is 0.5 m ahead of the feet (the partner faces +z); the enemy 1.5 m past the edge, 3 m down.
    // A lens behind and low sees the pit's far wall, not its floor: it takes a look past the old 50° limit
    ['pit', (ctx, W) => { for (let i = 45; i <= 55; i++) for (let j = 51; j <= 56; j++) W.map.elev[K(W, i, j)] = -3; return put(ctx, ctx.player.x - 0.4, -3, ctx.player.z + 2); }, (p) => p > 50],
    // 16 m up, 1.5 m ahead. (Not straight over the head: the crosshair's ground track always passes the Pokémon's
    // vertical axis at the shoulder offset, 0.24 × the boom, so a point nearer that axis than that cannot be centred)
    ['overhead', (ctx) => put(ctx, ctx.player.x, 0, ctx.player.z + 1.5, 16), (p) => p < -70],
  ];
  for (const [label, make, steep] of cases) {
    {
      const { ctx, W } = scene();
      const e = make(ctx, W);
      const h = new Host(ctx, 0);
      for (let i = 0; i < 60; i++) h.render();
      // the player looks toward it first (the steep solution, not a shallow one through the ground)
      h.rig.look(0, ((steep(80) ? 80 : -80) - A.neutral - h.rig.userPitch) * D2R);
      for (let i = 0; i < 30; i++) h.render();
      // steep up the yaw is slow to settle (turning orbits the lens about the pivot), so the player corrects again
      let v = h.aimAt(centre(ctx, e));
      for (let k = 0; k < 3 && rayMiss(v, centre(ctx, e)) > 0.02; k++) v = h.aimAt(centre(ctx, e));
      const miss = rayMiss(v, centre(ctx, e));
      let hits = 0;
      for (let k = 0; k < 60; k++) for (const ev of h.frame(null, k === 0 ? BTN.basic : 0).events) if (ev.t === 'hit' && ev.enemy === e) hits++;
      assert.ok(miss < 0.05, `${label}: the crosshair is on it (${miss.toFixed(3)} m)`);
      assert.ok(steep(v.viewPitch / D2R), `${label}: that needs ${(v.viewPitch / D2R).toFixed(1)}°`);
      assert.ok(hits >= 1, `${label}: hit`);
    }
  }
});

test('R3: off-frame cue: none while the body is on screen (20° up to 89° down, every size); looking further up it points down at the body and fades in', () => {
  const cueAt = (id: string, pitch: number) => {
    const h = bodyFrame(id).visual!, r = settledAt(id, pitch);
    return offFrameCue(r.sample(1280, 720), [[0, 0, 0], [0, h / 2, 0], [0, h, 0]]);
  };
  for (const id of SIZES) {
    const st = 'framed';
    // (the composition keeps the Pokémon under the crosshair line, so it leaves the bottom of the frame sooner than it
    // did: by about 25° up, where it left at about 33°)
    for (let p = -20; p <= 89; p += 1) assert.equal(cueAt(id, p), null, `${id} ${st} ${p}°: the body is in frame, no cue`);
    let prev = 0;
    for (let p = -20; p >= -89; p -= 0.5) {
      const c = cueAt(id, p), a = c ? c.alpha : 0;
      assert.ok(a >= prev - 1e-9 && a - prev < 0.35, `${id} ${st} ${p}°: the cue fades in continuously (${prev.toFixed(2)} -> ${a.toFixed(2)})`);
      if (c) assert.ok(c.dy > 0.9 && c.dx <= 0, `${id} ${st} ${p}°: points down (and left: the lens is on the right shoulder) ${c.dx.toFixed(2)}, ${c.dy.toFixed(2)}`);
      prev = a;
    }
    const c45 = cueAt(id, -45), c89 = cueAt(id, -89);
    assert.ok(c45 && c45.alpha === 1 && c89 && c89.alpha === 1, `${id} ${st}: full cue by 45° up (${c45?.alpha})`);
  }
});

test('R3: the stage view keeps every ground point the frame shows at 89° down from the highest lens; inside the Phase 4A envelope the plane behind the lens is where it was', () => {
  // inside the old envelope at the FOVs the setting reaches the frame's bottom edge never looks back past the lens
  for (const fov of [54, 64, 72]) for (let p = -60; p <= 50; p += 0.5) assert.equal(chaseBehind(5, p * D2R, fov * D2R), VIEW_BEHIND, `${fov}° fov, ${p}°`);
  // the highest lens there is: Extra Large with the widest FOV setting, looking straight down
  const r = new ChaseRig(); r.snapTo(0, 0, 0, Math.PI);
  const f = frame(bodyFrame('feraligatr'));
  for (let i = 0; i < 300; i++) r.update(f, { pitchRange: lookPitchRange(), fovOffset: 12 });
  r.look(0, (89 - A.neutral - r.userPitch) * D2R);
  for (let i = 0; i < 120; i++) r.update(f, { pitchRange: lookPitchRange(), fovOffset: 12 });
  const v = r.sample(1280, 720), fx = Math.sin(v.yaw), fz = Math.cos(v.yaw);
  const view = { x: v.eye[0], z: v.eye[2], r: 200, fx, fz, behind: chaseBehind(v.eye[1] - 0, v.viewPitch, v.fov) };
  const old = { ...view, behind: undefined };
  const sp = Math.sin(v.viewPitch), cp = Math.cos(v.viewPitch), F = [fx * cp, -sp, fz * cp], R = [-fz, 0, fx], U = [fx * sp, cp, fz * sp];
  const tv = Math.tan(v.fov / 2), th = tv * v.aspect;
  let culledBefore = 0;
  for (const g of [0, -VIEW_DROP]) for (let i = -8; i <= 8; i++) for (let j = -8; j <= 8; j++) {
    const d = [0, 1, 2].map((k) => F[k] + R[k] * th * (i / 8) + U[k] * tv * (j / 8));
    if (d[1] >= 0) continue;
    const t = (g - v.eye[1]) / d[1], x = v.eye[0] + d[0] * t, z = v.eye[2] + d[2] * t;
    assert.ok(inStageView(view, x, z), `ground point (${i}, ${j}) at ${g} m is drawn`);
    if (!inStageView(old, x, z)) culledBefore++;
  }
  assert.ok(culledBefore > 0, 'without the R3 extension part of that frame was skipped (the defect it fixes)');
});

test('R3: billboard lean (LEAN_GLSL): upright up to 51.3° of seen elevation, past it the card leans back and keeps its screen height, to 90° from above and below', () => {
  // the GLSL is pinned so the TS mirror below stays the shader's maths
  assert.equal(LEAN_GLSL, `
vec3 leanUp(vec3 d, vec3 fwd, float lim){
  if (lim <= 0.0) return vec3(0.0, 1.0, 0.0);
  float el = atan(-d.y, length(d.xz));
  float ex = sign(el) * max(0.0, abs(el) - lim);
  if (ex == 0.0) return vec3(0.0, 1.0, 0.0);
  return vec3(fwd.x * sin(ex), cos(ex), fwd.z * sin(ex));
}`);
  const leanUp = (d: V3, fwd: V3, lim: number): V3 => {
    if (lim <= 0) return [0, 1, 0];
    const el = Math.atan2(-d[1], Math.hypot(d[0], d[2])), ex = Math.sign(el) * Math.max(0, Math.abs(el) - lim);
    return ex === 0 ? [0, 1, 0] : [fwd[0] * Math.sin(ex), Math.cos(ex), fwd[2] * Math.sin(ex)];
  };
  assert.ok(Math.abs(LEAN_FROM - Math.acos(1 / 1.6)) < 1e-15 && Math.abs(LEAN_FROM / D2R - 51.318) < 1e-3);
  for (const yawDeg of [0, 50, 180, -110]) {
    const fwd: V3 = [Math.sin(yawDeg * D2R), 0, Math.cos(yawDeg * D2R)];
    for (let el = -90; el <= 90; el += 0.5) {
      // a card straight ahead of the lens, seen `el` degrees from above (+) or below (-), 6 m away
      const e = el * D2R, d: V3 = [fwd[0] * Math.cos(e) * 6, -Math.sin(e) * 6, fwd[2] * Math.cos(e) * 6];
      const U = leanUp(d, fwd, LEAN_FROM), st = Math.min(1.6, Math.max(1, 6 / Math.max(Math.hypot(d[0], d[2]), 0.5)));
      if (Math.abs(el) <= LEAN_FROM / D2R) assert.deepEqual(U, [0, 1, 0], `${el}°: exactly upright`);
      const n = norm(d), along = U[0] * n[0] + U[1] * n[1] + U[2] * n[2];
      const screen = st * Math.sqrt(Math.max(0, 1 - along * along)); // its height across the line of sight, per metre of card
      assert.ok(Math.abs(screen - 1) < 1e-9, `yaw ${yawDeg}, ${el}°: screen height ${screen.toFixed(6)} of the level view's`);
      if (el > LEAN_FROM / D2R) assert.ok(U[0] * fwd[0] + U[2] * fwd[2] > 0, `${el}°: seen from above it leans away from the lens`);
      if (el < -LEAN_FROM / D2R) assert.ok(U[0] * fwd[0] + U[2] * fwd[2] < 0, `${el}°: seen from below it leans toward it`);
    }
  }
  assert.deepEqual(leanUp([0, -5, 0.1], [0, 0, 1], 0), [0, 1, 0], 'lean off: upright');
});
