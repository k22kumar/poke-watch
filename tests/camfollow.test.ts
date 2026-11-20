// The third-person camera's relationship to the Pokémon (docs/THIRD_PERSON.md "Camera"; docs/THIRD_PERSON_IMPLEMENTATION.md
// §24): regression scenarios for the problems the 2026-11 camera overhaul fixed, on the real sim and the real rig, driven
// as the renderer drives them (60 Hz ticks from an accumulator, the Pokémon interpolated between the last two, the rig fed
// by render/chaseinput.ts). A private flat plain keeps collision out of it, so any lens motion relative to the Pokémon is
// the camera's own. Measured on the rig before the overhaul (scripts at HEAD b89fb55): walking moved the lens 0.51 m along
// the view, reversing 1.03 m, strafing 0.51 m sideways, a dash 1.0 m, a jump 1.0 m vertically (the Pokémon moved 0.24 to
// 0.42 of the half-screen); one Pokémon arriving 15 m away and then a crowd moved it 1.6 m (Cyndaquil) to 2.8 m
// (Feraligatr), the boom 1.8 to 3.1 m and the FOV 8°. Every one of those is 0 now.
import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultRules } from '../src/rules/defaults';
import { BIOMES } from '../src/rules/stages';
import { SPECIES } from '../src/rules/species';
import { bodyOf } from '../src/rules/sizing';
import { World } from '../src/sim/world';
import { createRun, step } from '../src/sim/run';
import { spawnEnemy } from '../src/sim/enemies';
import { botInput } from '../src/sim/bot';
import { ROLE } from '../src/sim/pools';
import { NO_INPUT, type InputFrame, type SimContext } from '../src/sim/types';
import { CHASE_CONFIG, ChaseRig, chaseArm, type ViewSample } from '../src/render/camera';
/** the back distance the framing law gives a subject with no measured art (the fallback outline of its size class) */
const chaseBoom = (visual: number) => chaseArm({ height: visual, visual }).back;

import { chaseFrameFor } from '../src/render/chaseinput';
import { addCrowd } from '../scripts/lib/crowd';

/** an authored world whose map is replaced by a private flat plain at height 0 (arrays copied: the base map is shared) */
function flatWorld() {
  const W = new World(defaultRules, BIOMES.meadow, 5);
  const n = W.w * W.h, M = W.map;
  const map = { ...M, terrain: new Uint8Array(n), elev: new Float32Array(n), stairs: new Uint8Array(n), wall: new Uint8Array(n), platform: new Float32Array(n), over: undefined, wlevel: undefined };
  Object.assign(W, { map, over: undefined, voids: new Uint8Array(n) });
  for (let k = 0; k < n; k++) W.setBlock(k, 0, 0); // refresh the nav caches the copied map left stale
  return W;
}
function scene(species: string) {
  const ctx = createRun({ seed: 1, species });
  ctx.world = flatWorld();
  ctx.enemies.clear(); ctx.bodies.clear(); ctx.projectiles.clear(); ctx.zones.clear();
  const P = ctx.player;
  P.x = P.px = 0.5; P.z = P.pz = 0.5; P.y = P.py = 0; P.facing = Math.PI;
  ctx.grid.rebuild(ctx.enemies.hi, ctx.enemies.x, ctx.enemies.z, ctx.enemies.alive);
  return ctx;
}
/** every tile north of z0 (the walks go north, -z) at height h */
function terrace(ctx: SimContext, h: number, z0: number) {
  const W = ctx.world;
  for (let j = 0; j < W.h; j++) for (let i = 0; i < W.w; i++) if (j - W.half + 0.5 < z0) { W.map.elev[j * W.w + i] = h; W.setBlock(j * W.w + i, 0, 0); }
}
const firstOf = (cls: string) => SPECIES.filter((s) => bodyOf(s, defaultRules.size).sizeClass === cls && !bodyOf(s, defaultRules.size).authored).map((s) => s.id).sort()[0];
const CLASSES = ['tiny', 'medium', 'xl'].map(firstOf);

interface Frame { t: number; feet: number[]; eye: readonly number[]; dir: readonly number[]; off: number[]; ndc: number[]; boom: number; fov: number; sample: ViewSample }
type Ctl = (t: number, yaw: number) => InputFrame;
/** the renderer's loop, headless, at `fps`; `hook` runs before each frame's ticks */
function drive(ctx: SimContext, fps: number, secs: number, ctl: Ctl, hook?: (t: number) => void): Frame[] {
  const rig = new ChaseRig(), P = ctx.player, out: Frame[] = [];
  rig.snapTo(P.x, P.y, P.z, Math.PI);
  const visual = bodyOf(P.species, ctx.rules.size).visualM;
  let acc = 0, t = 0;
  while (t < secs) {
    const real = 1 / fps; t += real;
    hook?.(t);
    acc += real;
    while (acc >= ctx.dt - 1e-9) { step(ctx, ctl(t, rig.yaw)); acc -= ctx.dt; }
    const a = Math.max(0, Math.min(1, acc / ctx.dt));
    const px = P.px + (P.x - P.px) * a, py = P.py + (P.y - P.py) * a, pz = P.pz + (P.z - P.pz) * a;
    rig.update(chaseFrameFor(ctx, { dt: real, x: px, y: py, z: pz, lookPitch: 0 }));
    const v = rig.sample(1600, 900), fy = Math.sin(v.yaw), fz = Math.cos(v.yaw);
    const ex = v.eye[0] - px, ey = v.eye[1] - py, ez = v.eye[2] - pz;
    // the Pokémon's middle on screen (NDC), through the sample's own basis
    const sp = Math.sin(v.viewPitch), cp = Math.cos(v.viewPitch), F = [fy * cp, -sp, fz * cp], R = [-fz, 0, fy], U = [fy * sp, cp, fz * sp];
    const d = [px - v.eye[0], py + visual / 2 - v.eye[1], pz - v.eye[2]], zz = d[0] * F[0] + d[1] * F[1] + d[2] * F[2], tv = Math.tan(v.fov / 2);
    out.push({
      t, feet: [px, py, pz], eye: v.eye, dir: v.dir, sample: v, boom: rig.boomUsed, fov: v.fov,
      off: [ex * fy + ez * fz, ex * -fz + ez * fy, ey],
      ndc: [(d[0] * R[0] + d[2] * R[2]) / (zz * tv * v.aspect), (d[0] * U[0] + d[1] * U[1] + d[2] * U[2]) / (zz * tv)],
    });
  }
  return out;
}
/** the largest change of f over the frames from `from` s on, against the frame before them */
function drift(fr: Frame[], from: number, f: (x: Frame) => number[]): number {
  const i0 = fr.findIndex((x) => x.t >= from), ref = f(fr[i0 - 1]);
  let m = 0;
  for (let i = i0; i < fr.length; i++) { const v = f(fr[i]); for (let k = 0; k < v.length; k++) m = Math.max(m, Math.abs(v[k] - ref[k])); }
  return m;
}
const NO = NO_INPUT;
const fwd = (yaw: number, s = 1): InputFrame => ({ ...NO, mx: Math.sin(yaw) * s, mz: Math.cos(yaw) * s });
const side = (yaw: number, s = 1): InputFrame => ({ ...NO, mx: -Math.cos(yaw) * s, mz: Math.sin(yaw) * s });

test('locomotion never moves the camera against the Pokémon: accelerating, stopping, reversing, strafing and dashing, at every size and 60 / 144 fps', () => {
  const scenarios: [string, number, number, Ctl][] = [
    ['accelerate', 3.5, 1.5, (t, y) => (t < 1.5 ? NO : fwd(y))],
    ['stop', 5, 3.5, (t, y) => (t < 1.5 ? NO : t < 3.5 ? fwd(y) : NO)],
    ['reverse', 5.5, 3.5, (t, y) => (t < 1.5 ? NO : t < 3.5 ? fwd(y) : fwd(y, -1))],
    ['strafe', 4.5, 1.5, (t, y) => (t < 1.5 ? NO : t < 3 ? side(y) : side(y, -1))],
    ['dash', 4, 2.4, (t, y) => (t < 1.5 ? NO : { ...fwd(y), dash: t >= 2.5 && t < 2.52 })],
    ['dash sideways', 4, 2.4, (t, y) => (t < 1.5 ? NO : { ...side(y), dash: t >= 2.5 && t < 2.52 })],
  ];
  for (const sp of CLASSES) for (const fps of [60, 144]) for (const [name, secs, from, ctl] of scenarios) {
    const ctx = scene(sp), fr = drive(ctx, fps, secs, ctl), tag = `${sp} ${name} ${fps} fps`;
    const moved = Math.max(...fr.map((x) => Math.hypot(x.feet[0] - 0.5, x.feet[2] - 0.5)));
    assert.ok(moved > 3, `${tag}: the Pokémon did move (${moved.toFixed(1)} m from where it started)`);
    assert.ok(drift(fr, from, (x) => x.off) < 1e-9, `${tag}: the lens moved ${drift(fr, from, (x) => x.off).toExponential(2)} m against the Pokémon`);
    assert.ok(drift(fr, from, (x) => x.ndc) < 1e-9, `${tag}: the Pokémon moved on screen`);
    assert.ok(drift(fr, from, (x) => [...x.dir]) < 1e-12, `${tag}: the crosshair ray turned`);
    assert.ok(drift(fr, from, (x) => [x.boom, x.fov]) === 0, `${tag}: boom or FOV changed`);
  }
});

test('jumping and falling are followed 1:1: the Pokémon keeps its place on screen and the crosshair keeps its direction', () => {
  for (const sp of CLASSES) for (const fps of [60, 144]) {
    const ctx = scene(sp);
    let top = 0;
    const fr = drive(ctx, fps, 3, (t) => ({ ...NO, jump: t >= 1.5 && t < 1.55 }), () => { top = Math.max(top, ctx.player.y); });
    assert.ok(top > 1.5, `${sp}: it jumped (${top.toFixed(2)} m)`);
    // the landing frame: the sim's support flag is set while the frame is still drawn between the last airborne tick and
    // the grounded one, so up to one tick of the fall is taken up at the stair-smoothing rate (a few centimetres)
    const air = fr.filter((x) => x.t >= 1.5 && x.feet[1] > 0.2);
    let worst = 0; for (const x of air) worst = Math.max(worst, ...x.off.map((v, k) => Math.abs(v - fr[0].off[k])));
    assert.ok(worst < 1e-9, `${sp} ${fps} fps: in the air the lens moved ${worst} m against the Pokémon`);
    assert.ok(drift(fr, 1.5, (x) => x.off) < 0.07, `${sp} ${fps} fps: landing took up ${drift(fr, 1.5, (x) => x.off).toFixed(3)} m`);
    assert.ok(drift(fr, 1.5, (x) => [...x.dir]) < 1e-12, `${sp}: the crosshair ray turned`);
  }
});

test('grounded steps: a 0.25 m and a 0.5 m step up and a 0.3 m step down are taken up at the stair rate, never in one frame', () => {
  const S = CHASE_CONFIG.step;
  for (const sp of CLASSES) for (const fps of [30, 60, 144]) for (const h of [0.25, 0.5, -0.3]) {
    // (a Tiny Pokémon stepping down: its 0.48 m pivot's boom grazes the 0.3 m lip behind it, and the boom collision, not
    // the stair smoothing, moves the lens there)
    if (h < 0 && sp === CLASSES[0]) continue;
    const ctx = scene(sp);
    if (h < 0) { for (let k = 0; k < ctx.world.w * ctx.world.h; k++) { ctx.world.map.elev[k] = -h; ctx.world.setBlock(k, 0, 0); } ctx.player.y = ctx.player.py = -h; terrace(ctx, 0, -4); }
    else terrace(ctx, h, -4);
    const fr = drive(ctx, fps, 3, (t, y) => (t < 1 ? NO : fwd(y))), tag = `${sp} ${h} m at ${fps} fps`;
    let feetPop = 0, lensStep = 0, settled = -1, stepAt = -1;
    for (let i = 1; i < fr.length; i++) {
      const df = Math.abs(fr[i].feet[1] - fr[i - 1].feet[1]), de = Math.abs(fr[i].eye[1] - fr[i - 1].eye[1]);
      if (df > 0.05 && stepAt < 0) stepAt = fr[i].t;
      feetPop = Math.max(feetPop, df); lensStep = Math.max(lensStep, de);
      if (stepAt >= 0 && settled < 0 && Math.abs(fr[i].off[2] - fr[0].off[2]) < 1e-9 && fr[i].t > stepAt) settled = fr[i].t;
    }
    assert.ok(stepAt > 0, `${tag}: the body took the step`);
    // one frame's worth of the rate, plus the one-tick slack of a step taken between two rig ticks
    const cap = S.rate / fps + S.rate * CHASE_CONFIG.tick + 1e-6;
    assert.ok(lensStep <= cap, `${tag}: the lens moved ${lensStep.toFixed(3)} m in a frame (the body popped ${feetPop.toFixed(2)} m; cap ${cap.toFixed(3)})`);
    assert.ok(settled > 0 && settled - stepAt <= Math.abs(h) / S.rate + 0.05, `${tag}: back on the body ${(settled - stepAt).toFixed(3)} s after the step`);
    assert.ok(drift(fr, 1.2, (x) => [x.off[0], x.off[1]]) < 1e-9, `${tag}: the step moved the lens sideways or along the view`);
  }
});

test('other Pokémon never move the camera: a crowd and a boss arriving around a standing Pokémon leave every view sample bit-identical', () => {
  for (const sp of ['cyndaquil', 'feraligatr']) {
    const look = (t: number, y: number): InputFrame => (void t, void y, NO);
    const quiet = drive(scene(sp), 60, 6, look);
    const ctx = scene(sp);
    const put = (id: string, x: number, z: number, role = 0) => { const E = ctx.enemies, e = spawnEnemy(ctx, id, x, z, role); E.speed[e] = 0; E.dmg[e] = 0; E.hp[e] = E.maxHp[e] = 1e6; E.spawnT[e] = 1; };
    let a = false, b = false;
    const busy = drive(ctx, 60, 6, look, (t) => {
      // one Pokémon walks in 15 m ahead (the old rig's Combat state), then a crowd of 24 at 9 m and a boss at 12 m (Pressure)
      if (!a && t >= 2) { a = true; put('rattata', 0.5, -14.5); }
      if (!b && t >= 4) { b = true; for (let k = 0; k < 24; k++) { const g = (k / 24) * Math.PI * 2; put('rattata', 0.5 + Math.cos(g) * 9, 0.5 + Math.sin(g) * 9); } put('sudowoodo', 12.5, 0.5, ROLE.boss); }
    });
    assert.ok(ctx.enemies.count >= 26, `${sp}: they are there (${ctx.enemies.count})`);
    for (let i = 0; i < quiet.length; i++) assert.deepEqual(busy[i].sample, quiet[i].sample, `${sp}: frame ${i} (t ${busy[i].t.toFixed(2)} s) differs`);
  }
});

test('a fight on open ground never changes the framing: 20 s of bot combat moves the Pokémon, never the lens against it, the boom or the FOV', () => {
  for (const sp of ['cyndaquil', 'feraligatr']) {
    const ctx = scene(sp);
    addCrowd(ctx, 30); // a chasing crowd around the bot (scripts/lib/crowd.ts)
    const fr = drive(ctx, 60, 20, () => botInput(ctx));
    assert.ok(ctx.enemies.count > 5, `${sp}: enemies came (${ctx.enemies.count})`);
    // the lens offset against the Pokémon: only the stair smoothing of a landing may move it (the bot never jumps here)
    assert.ok(drift(fr, 0.5, (x) => [x.off[0], x.off[1]]) < 1e-9, `${sp}: the lens moved against the Pokémon in the fight`);
    assert.ok(drift(fr, 0.5, (x) => [x.boom, x.fov]) === 0, `${sp}: the fight changed the boom or the FOV`);
    assert.equal(fr[fr.length - 1].boom, chaseBoom(bodyOf(ctx.player.species).visualM), `${sp}: the boom is the size class's`);
  }
});
