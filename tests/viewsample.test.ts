// Third-person view-state contract (docs/THIRD_PERSON.md "View-state contract", docs/THIRD_PERSON_IMPLEMENTATION.md
// Phase 1): the host's real frame order (render/hostframe.ts runFrame, the function main.ts calls) driven headless with a
// real ChaseRig, the renderer's own probes and size-class framing (render/chaseinput.ts), against a real run. No GL, no
// DOM.
//
// What is pinned: the look input of a frame reaches the aim of that frame's ticks (yaw and pitch together); every tick
// of a frame aims with the same immutable sample; what is drawn at the end of the frame is that sample advanced by the
// rig's own clock, once; the sim depends only on the recorded InputFrames.
import test from 'node:test';
import assert from 'node:assert/strict';
import { CHASE_CONFIG, ChaseRig, chaseAim, chaseArm, lookPitchRange, type ViewSample } from '../src/render/camera';
/** the back distance the framing law gives a subject with no measured art (the fallback outline of its size class) */
const chaseBoom = (visual: number) => chaseArm({ height: visual, visual }).back;

import { chaseFrameFor, chaseSubject } from '../src/render/chaseinput';
import { spriteOutline } from '../scripts/lib/silhouette';
import { bodyOf } from '../src/rules/sizing';
import { lookDelta, runFrame } from '../src/render/hostframe';
import { createRun, startStage, step } from '../src/sim/run';
import { BTN, NO_INPUT, type InputFrame, type SimContext } from '../src/sim/types';

const D2R = Math.PI / 180;
const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);

function mapRun(seed: number, stage: number, species: string) {
  const ctx = createRun({ seed, species, ruleOverrides: { worldgen: { mode: 'generated' } } });
  if (stage) startStage(ctx, stage);
  for (let i = 0; i < ctx.enemies.hi; i++) ctx.enemies.alive[i] = 0;
  ctx.enemies.count = 0;
  return ctx;
}

interface FrameOut {
  /** the sample the frame's ticks used (null: the sim did not run) */
  view: ViewSample | null;
  /** aim points the ticks sent, in order */
  aims: [number, number][];
  /** the crosshair's aim point from the view drawn at the end of the frame */
  drawn: [number, number];
  steps: number;
}

/** main.ts frame() and Renderer's chase path, headless: look -> one sample -> due ticks -> rig.update once */
class Host {
  rig = new ChaseRig();
  acc = 0;
  width = 1280; height = 720;
  paused = false;
  hitstop = 0;
  /** the InputFrames the sim received, in order (the replay record) */
  readonly log: InputFrame[] = [];
  constructor(readonly ctx: SimContext) {
    const P = ctx.player;
    this.rig.snapTo(P.x, P.y, P.z, Math.PI);
  }
  ground = (x: number, z: number) => this.ctx.world.height(x, z);
  /** one animation frame of `real` seconds with this frame's look gesture (rad) and buttons / movement */
  frame(real: number, look: [number, number] | null = null, btn = 0, walk: 'fwd' | 'right' | null = null): FrameOut {
    const c = this.ctx, P = c.player, aims: [number, number][] = [];
    const simulate = !this.paused && c.state !== 'over';
    if (simulate) {
      let scale = 1;
      if (this.hitstop > 0) { this.hitstop -= real; scale *= c.rules.sim.hitstopScale; }
      this.acc += real * scale;
    }
    const fr = runFrame<ViewSample>({
      // main.ts lookInput: dropped while paused
      look: () => { if (look && !this.paused) this.rig.look(look[0], look[1]); },
      view: () => this.rig.sample(this.width, this.height), // Renderer.viewSample
      tick: (v) => {
        // main.ts sampleInput: movement relative to the sample's yaw, aim = the sample's crosshair ray
        const sy = Math.sin(v.yaw), cy = Math.cos(v.yaw);
        const [mx, mz] = walk === 'fwd' ? [sy, cy] : walk === 'right' ? [-cy, sy] : [0, 0];
        const [ax, az] = chaseAim(v, P.x, P.z, v.aspect, this.ground);
        aims.push([ax, az]);
        const inp: InputFrame = { ...NO_INPUT, mx, mz, btn, aimX: ax, aimZ: az };
        this.log.push(inp);
        step(c, inp);
        return 'go';
      },
    }, this.acc, c.dt, 5, simulate);
    this.acc = fr.acc;
    this.render(real);
    return { view: fr.view, aims, drawn: chaseAim(this.rig, P.x, P.z, this.width / this.height, this.ground), steps: fr.steps };
  }
  /** Renderer.render, chase branch: the player interpolated by acc / dt, the rig advanced by the frame time */
  render(real: number) {
    const c = this.ctx, P = c.player, a = clamp(this.acc / c.dt, 0, 1);
    this.rig.update(chaseFrameFor(c, { dt: real, x: P.px + (P.x - P.px) * a, y: P.py + (P.y - P.py) * a, z: P.pz + (P.z - P.pz) * a, lookPitch: 0 }), { pitchRange: lookPitchRange(), fovOffset: 0 });
  }
  settle(secs: number, fps = 60) { for (let t = 0; t < secs; t += 1 / fps) this.frame(1 / fps); }
}

const dist = (a: readonly number[], b: readonly number[]) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

test('host order: a turn or a pitch on this frame reaches this frame\'s aim, the same as the crosshair drawn', () => {
  // Phase 0 claim 2: yaw was applied to the rig before the ticks but the lens and the pitch only at the render, so the
  // ticks aimed from last frame's lens along this frame's yaw (5.85 m at 90 degrees) and with last frame's pitch
  for (const [label, look] of [['17 deg', [17 * D2R, 0]], ['90 deg', [Math.PI / 2, 0]], ['126 deg', [126 * D2R, 0]], ['180 deg', [Math.PI, 0]], ['pitch 10 down', [0, 10 * D2R]], ['pitch 10 up', [0, -10 * D2R]], ['90 + pitch 8', [-Math.PI / 2, 8 * D2R]]] as [string, [number, number]][]) {
    const h = new Host(mapRun(1, 0, 'cyndaquil'));
    h.settle(2);
    const yaw0 = h.rig.yaw, up0 = h.rig.userPitch;
    const f = h.frame(1 / 60, look);
    assert.equal(f.steps, 1);
    const v = f.view!;
    // the sample carries this frame's look input, both axes
    assert.ok(Math.abs(wrap(v.yaw - (yaw0 - look[0]))) < 1e-9, `${label}: sample yaw`);
    assert.ok(Math.abs(v.userPitch - clamp(up0 + look[1] / D2R, ...lookPitchRange())) < 1e-9, `${label}: sample pitch`);
    // and it is internally consistent: the axis is the yaw and the pitch it states
    assert.ok(Math.abs(v.dir[0] - Math.sin(v.yaw) * Math.cos(v.viewPitch)) < 1e-12 && Math.abs(v.dir[1] + Math.sin(v.viewPitch)) < 1e-12 && Math.abs(v.dir[2] - Math.cos(v.yaw) * Math.cos(v.viewPitch)) < 1e-12, `${label}: dir`);
    // the lens is behind the Pokémon for the new yaw (not where the old yaw left it)
    const P = h.ctx.player, lat = (v.eye[0] - P.x) * -Math.cos(v.yaw) + (v.eye[2] - P.z) * Math.sin(v.yaw);
    assert.ok(Math.abs(lat) < CHASE_CONFIG.shoulderMax * CHASE_CONFIG.frame.max + 0.01, `${label}: lens ${lat.toFixed(2)} m to the side of the new view`);
    const err = dist(f.aims[0], f.drawn);
    assert.ok(err < 0.05, `${label}: the tick aimed ${err.toFixed(3)} m from the crosshair drawn that frame`);
  }
});

test('host order: zero, one and several ticks per frame at 30, 60, 144 and 240 fps all aim with the frame\'s one sample', () => {
  for (const fps of [30, 60, 144, 240]) {
    const h = new Host(mapRun(2, 0, 'cyndaquil'));
    h.settle(2, fps);
    const counts = [0, 0, 0];
    let worst = 0, worstTick = 0;
    for (let i = 0; i < fps * 3; i++) {
      // a steady mouse turn plus a pitch sweep: input on every frame, including the ones with no tick
      const f = h.frame(1 / fps, [1.2 / fps, Math.sin(i / fps * 2) * 0.3 / fps]);
      counts[Math.min(2, f.steps)]++;
      for (const a of f.aims) worstTick = Math.max(worstTick, dist(a, f.aims[0]));
      if (f.aims.length) worst = Math.max(worst, dist(f.aims[0], f.drawn));
    }
    if (fps === 30) assert.ok(counts[2] > 0, '30 fps runs two ticks a frame');
    if (fps === 60) assert.ok(counts[1] > 0, '60 fps runs one');
    if (fps >= 144) assert.ok(counts[0] > 0 && counts[1] > 0, `${fps} fps has frames with no tick`);
    assert.ok(worstTick < 1e-9, `${fps} fps: ticks of one frame aimed ${worstTick} m apart`);
    // standing still, the only difference left is the rig's own easing over one frame while it turns
    assert.ok(worst < 0.1, `${fps} fps: tick aim vs drawn crosshair ${worst.toFixed(3)} m`);
  }
});

test('rapid flicks: turning and pitching hard then firing at once sends the shot at the crosshair drawn that frame', () => {
  // with no wind-up the shot leaves on the press tick, with the frame's sample; with the default wind-up the aim is
  // resolved again at release (moves.ts), and the press tick's aim must already be right for the wind-up's facing
  for (const windup of [false, true]) {
    const h = new Host(mapRun(1, 0, 'cyndaquil'));
    if (!windup) for (const k of Object.keys(h.ctx.rules.feel.windup)) h.ctx.rules.feel.windup[k] = 0;
    h.settle(2);
    const P = h.ctx.player, E = h.ctx.projectiles;
    for (const look of [[Math.PI / 2, 6 * D2R], [-2.4, -8 * D2R], [Math.PI, 12 * D2R], [0.6, -14 * D2R]] as [number, number][]) {
      for (let k = 0; k < 90; k++) h.frame(1 / 60); // off cooldown
      for (let i = 0; i < E.hi; i++) E.alive[i] = 0;
      const f = h.frame(1 / 60, look, BTN.basic);
      assert.ok(dist(f.aims[0], f.drawn) < 0.05, `press tick aimed ${dist(f.aims[0], f.drawn).toFixed(2)} m from the crosshair`);
      const want = Math.atan2(f.drawn[0] - P.x, f.drawn[1] - P.z);
      let shot = -1;
      for (let k = 0; k < 30 && shot < 0; k++) {
        for (let i = 0; i < E.hi; i++) if (E.alive[i] && E.src[i] === -1) { shot = i; break; }
        if (shot < 0) h.frame(1 / 60, null, BTN.basic);
      }
      assert.ok(shot >= 0, 'the primary fired a projectile');
      const got = Math.atan2(E.vx[shot], E.vz[shot]);
      assert.ok(Math.abs(wrap(got - want)) < 1 * D2R, `wind-up ${windup}: shot ${(got / D2R).toFixed(1)} vs crosshair ${(want / D2R).toFixed(1)} deg`);
    }
  }
});

test('pause, hitstop, resize and a lost pointer lock keep the sample and the drawn view in step', () => {
  const h = new Host(mapRun(1, 0, 'cyndaquil'));
  h.settle(2);
  // pause: the look gesture is dropped (main.ts lookInput), no sample is taken, nothing steps, the camera keeps its clock
  h.paused = true;
  const yaw = h.rig.yaw, tick = h.ctx.tick;
  const p = h.frame(1 / 60, [1, 0.2]);
  assert.equal(p.view, null); assert.equal(p.steps, 0); assert.equal(h.ctx.tick, tick);
  assert.equal(h.rig.yaw, yaw, 'look while paused is not applied or saved for later');
  h.paused = false;
  const after = h.frame(1 / 60);
  assert.equal(after.view!.yaw, yaw, 'and does not arrive on unpause');
  // hitstop: most frames run no tick; look keeps arriving and the next tick aims with all of it
  h.hitstop = 0.4;
  let zero = 0, worst = 0;
  for (let i = 0; i < 24; i++) { const f = h.frame(1 / 60, [0.05, 0.004]); if (!f.steps) zero++; else worst = Math.max(worst, dist(f.aims[0], f.drawn)); }
  assert.ok(zero > 10, `hitstop frames with no tick: ${zero}`);
  assert.ok(worst < 0.1, `hitstop: tick aim vs drawn ${worst.toFixed(3)} m`);
  // resize: the sample states the new viewport; the crosshair (the screen centre) aims the same
  const a = h.rig.sample(1280, 720), b = h.rig.sample(720, 1280);
  assert.equal(b.width, 720); assert.equal(b.height, 1280); assert.ok(Math.abs(b.aspect - 720 / 1280) < 1e-12);
  const P = h.ctx.player;
  assert.deepEqual(chaseAim(a, P.x, P.z, a.aspect, h.ground), chaseAim(b, P.x, P.z, b.aspect, h.ground));
  h.width = 720; h.height = 1280;
  const r = h.frame(1 / 60, [0.3, 0]);
  assert.ok(dist(r.aims[0], r.drawn) < 0.05, 'aim after a resize');
  // pointer lock lost (Input.clearButtons, no more mouse deltas): no look, no fire, and the sample is the drawn view
  const l = h.frame(1 / 60, lookDelta([0, 0], [0, 0], 1 / 60, 1, false), 0);
  assert.equal(lookDelta([0, 0], [0, 0], 1 / 60, 1, false), null);
  assert.ok(dist(l.aims[0], l.drawn) < 0.01);
});

test('the sample is immutable and never advances the rig clock; one render advances it once', () => {
  const h = new Host(mapRun(1, 0, 'cyndaquil'));
  h.settle(1);
  const s = h.rig.sample(1280, 720);
  assert.ok(Object.isFrozen(s) && Object.isFrozen(s.eye) && Object.isFrozen(s.dir));
  assert.throws(() => { (s.eye as unknown as number[])[0] = 9; });
  // look and sampling are pure on the rig's clock: rendering the same frame after any number of samples and looks
  // that cancel out draws exactly what it would have drawn
  const twin = new Host(mapRun(1, 0, 'cyndaquil'));
  twin.settle(1);
  for (let k = 0; k < 5; k++) { h.rig.sample(1280, 720); h.rig.look(0.4, 0.05); h.rig.look(-0.4, -0.05); }
  h.render(1 / 60); twin.render(1 / 60);
  for (let i = 0; i < 3; i++) assert.ok(Math.abs(h.rig.eye[i] - twin.rig.eye[i]) < 1e-9, `eye[${i}] ${h.rig.eye[i]} vs ${twin.rig.eye[i]}`);
  assert.ok(Math.abs(h.rig.viewPitch - twin.rig.viewPitch) < 1e-12);
});

test('camera collision and species sizes: walking and turning, the ticks aim where the frame is drawn', () => {
  // generated cave (walls on both sides: boom collision) and forest; tiny, small and XL bodies at their size-class framing.
  // Walking, the frame drawn at the end of a frame is its sample advanced by one frame of the rig's own motion (the
  // Pokémon's own travel, boom easing), so: the sample is exactly the last drawn view when no look input
  // arrived, the view direction drawn is the sample's, and the lens differs by one frame of camera travel. (Aim-point
  // distance is no measure here: a ray grazing the terrain moves its ground hit by metres for centimetres of lens.)
  for (const [seed, stage, sp] of [[3, 3, 'feraligatr'], [1, 3, 'cyndaquil'], [1, 0, 'pichu'], [3, 0, 'feraligatr']] as [number, number, string][]) {
    const h = new Host(mapRun(seed, stage, sp));
    h.settle(1.5);
    const eyeErr: number[] = [];
    let dirErr = 0, shortest = Infinity, lookless = 0;
    for (let i = 0; i < 60 * 8; i++) {
      const t = i / 60, prev = h.rig.sample(h.width, h.height);
      const look: [number, number] | null = i % 3 === 2 ? null : [Math.sin(t * 1.3) * 0.05, Math.cos(t * 0.9) * 0.01];
      // the pitch gesture integrates to about ±25°, kept inside [-14, 20] about the neutral pitch (the band this walk was
      // written for); the whole envelope's lens stability is measured by scripts/camstats.ts --sweep
      if (look) look[1] = (clamp(h.rig.userPitch + look[1] / D2R, -14, 20) - h.rig.userPitch) * D2R;
      const f = h.frame(1 / 60, look, 0, i % 120 < 80 ? 'fwd' : 'right');
      if (!f.view) continue;
      const v = f.view, r = h.rig;
      if (!look) { assert.deepEqual(v, prev, 'no look input: the sample is the view drawn last frame'); lookless++; }
      dirErr = Math.max(dirErr, Math.abs(wrap(r.yaw - v.yaw)), Math.abs(r.viewPitch - v.viewPitch));
      eyeErr.push(Math.hypot(v.eye[0] - r.eye[0], v.eye[1] - r.eye[1], v.eye[2] - r.eye[2]));
      shortest = Math.min(shortest, r.boomUsed);
    }
    // snap episodes: runs of consecutive frames whose lens moved 0.4 m or more (an arm coming in for rock that stays in
    // it is one episode however many frames it takes). At the hero band's 6 m/s the seed 3 cave course has 7 such frames
    // in 4 episodes, the forest Cyndaquil course 4 in 4, against a limit of 4.8
    let snaps = 0;
    for (let k = 0; k < eyeErr.length; k++) if (eyeErr[k] >= 0.4 && !(k > 0 && eyeErr[k - 1] >= 0.4)) snaps++;
    const max = Math.max(...eyeErr);
    const tag = `seed ${seed} stage ${stage} ${sp}`;
    assert.ok(lookless > 100, tag);
    // nothing but look input turns the axis, and the frame's look input is in the sample: the drawn axis is the sample's
    assert.ok(dirErr < 1e-9, `${tag}: drawn direction ${(dirErr / D2R).toFixed(6)} deg off the sample`);
    // one frame of lens travel: the Pokémon's own walk (0.12 m a frame at 7.2 m/s, followed 1:1), and now and then an
    // arm coming in at once for rock that has entered it (P1: the lens is never left where the sweep found something),
    // which no frame can exceed the arm by: snap episodes at most 1 % of the frames. A stale lens was metres off on
    // every frame
    const arm = chaseArm({ height: 1, visual: bodyOf(h.ctx.player.species).visualM, outline: spriteOutline(sp)?.outline });
    assert.ok(snaps <= eyeErr.length * 0.01 && max < Math.hypot(arm.back, arm.shoulder) + 0.2, `${tag}: ${snaps} lens snap episodes in ${eyeErr.length} frames, max ${max.toFixed(3)} m`);
    if (seed === 3 && stage === 3) assert.ok(shortest < chaseBoom(bodyOf(h.ctx.player.species).visualM) - 0.5, `${tag}: the course cuts the boom (${shortest.toFixed(2)} m)`);
  }
});

test('against walls, over steps and under pitch: a sample is exactly what the rig would draw with no time passed', () => {
  // the walled scene of camstability's frame-rate test (a wall on the right, rises behind, a ramp, 0.25 m steps); every
  // frame: look input, a sample, then a zero-time update (what the renderer would draw at that instant) must equal the
  // sample, so look() composes the view exactly as update() does, whatever the boom collision, the step being taken up
  // or the pitch
  const flat0 = (x: number, z: number) => (x > 1.4 && z > -14 ? 3 : 0) + (z < -16 ? Math.min(2, (-16 - z) * 0.3) : 0) + (x < -2.5 && Math.floor(z) % 3 === 0 ? 2.2 : 0) + (Math.floor(-z / 3) % 2 ? 0.25 : 0);
  const base = { height: 1.75, lookYaw: 0, lookPitch: 0, ground: flat0, grounded: true };
  const r = new ChaseRig(); r.snapTo(0, 0, 0, Math.PI);
  let worst = 0, stepped = 0, x = 0, z = 0;
  for (let i = 1; i <= 600; i++) {
    const t = i / 60;
    x = Math.sin(t * 0.8) * 0.4; z = -t * 2.2;
    r.update({ ...base, dt: 1 / 60, x, y: flat0(x, z), z });
    stepped = Math.max(stepped, Math.abs(r.stepOffset));
    r.look(Math.cos(t * 0.9) * 0.02, Math.sin(t * 1.7) * 0.03);
    const s = r.sample(1280, 720);
    r.update({ ...base, dt: 0, x, y: flat0(x, z), z });
    worst = Math.max(worst, Math.hypot(s.eye[0] - r.eye[0], s.eye[1] - r.eye[1], s.eye[2] - r.eye[2]), Math.abs(s.viewPitch - r.viewPitch), Math.abs(wrap(s.yaw - r.yaw)));
  }
  assert.ok(stepped > 0.1, `the walk takes steps up and down (${stepped.toFixed(2)} m being taken up at most)`);
  assert.ok(worst < 1e-9, `sample vs zero-time draw: ${worst}`);
});

test('the renderer and the diagnostics frame a Pokémon by its size class, one function for both', () => {
  // chaseFrameFor (render/chaseinput.ts) is what the renderer, scripts/camstats.ts and these tests feed the rig; it frames
  // the active Pokémon from rules/sizing.ts bodyOf, never from the art (the old rig read the idle frame, and the
  // diagnostics had to decode the atlas to match it)
  for (const id of ['cyndaquil', 'charmander', 'feraligatr', 'pichu']) {
    const ctx = createRun({ seed: 1, species: id }), b = bodyOf(ctx.player.species, ctx.rules.size);
    const f = chaseFrameFor(ctx, { dt: 1 / 60, x: 0, y: 0, z: 0, lookPitch: 0 });
    assert.equal(f.visual, b.visualM, `${id}: framed at its class's visible core`);
    assert.equal(f.height, b.height, `${id}: pivot from its class's body height`);
    assert.deepEqual(chaseSubject(ctx), { visual: b.visualM, height: b.height });
  }
});
