// Third-person camera diagnostics (no GL). Drives the sim at 60 Hz and the chase rig at a chosen render rate exactly as
// the renderer does (interpolated player, the same probes via render/chaseinput.ts), on the maps the game builds by
// default (generated regions and Pokémon locations; --authored for the hand-made arenas), and reports how much the
// camera moves that the player did not ask for. See docs/THIRD_PERSON.md, "Diagnostics".
//   npx tsx scripts/camstats.ts [--fps 60,144] [--seeds 1,2,3] [--stages 0,1,2,3] [--species cyndaquil,feraligatr]
//                               [--authored] [--noprops] [--noswap] [--rawsize] [--legacypitch] [--r2envelope] [--sweep]
//                               [--sweepband 89,89] [--json]
// --noprops lets the lens pass through props (CHASE_CONFIG.propsBlockLens = false); --noswap never swaps shoulder.
// --legacypitch runs the pre-Phase-4A view pitch (CHASE_CONFIG.aimPitch.on = false: automatic tilt, the [-14, 20] window).
// --r2envelope runs the pre-R3 envelope (aimPitch up 60 / down 50, overhead off): its output equals the R2 tool's.
// --sweepband up,down sweeps that band (deg about the horizon) instead of the rig's own, so two rigs can be compared on the
// same gesture (the rig still clamps to its own envelope): --sweep --sweepband 89,89 --r2envelope is the R2 rig on R3's
// sweep.
// --sweep adds the sweep* columns: the walk again while the player sweeps the pitch over its whole envelope.
//
// Columns (per seed x stage x species x fps):
//   idleMove        m      how far the lens drifts while nothing is pressed (after 1.5 s)
//   turn*           deg/m  ranges while the camera turns on the spot at 1 rad/s: only the yaw should change
//   *DvP99/*DvMax   m/s    per-frame change of the lens velocity: a smooth camera changes speed gradually; a pop or a
//                          stutter is a large change in one frame. Independent of the frame rate for a smooth signal
//   *PitchTravel    deg    total up/down travel of the view axis during the walk (automatic tilt)
//   *BoomTravel     m      total in/out travel of the boom (automatic zoom)
//   *ElevMax        deg    highest the lens got above the pivot, as an angle, while it was at least 1 m from it (closer,
//                          the angle is dominated by centimetres; the Pokémon is dissolved there anyway)
//   *PitchMax       deg    furthest the view axis looked down (a top-down view is ~60°+; Explore is 6°)
//   *JumpMax        m      largest distance the lens moved in one frame (running at 6 m/s is 0.1 m per 60 Hz frame; a
//                          pop is several times that)
//   fightFlips             Explore/Combat/Pressure changes in 30 s of combat
//   slides                 frames the safety net had to slide the lens in along the boom (the eased boom was too slow)
//   fpsDev          m      largest gap between the lens path at this frame rate and at 60 fps, following the same
//                          recorded player path (so only the camera's own frame-rate dependence shows)
//   sweep*                 (--sweep) the walk with the view pitch swept from the up limit to the down limit and back
//                          every 8 s: DvP99 and JumpMax as above, ElevMax, Slides (safety-net slides), Floor (lowest
//                          lens clearance over the ground under it, m), AxisErr (deg the drawn axis was off the
//                          player's own pitch: 0 when the player owns the view)
import { CHASE_CONFIG, ChaseRig, lookPitchRange } from '../src/render/camera';
import { chaseFrameFor } from '../src/render/chaseinput';
import { botInput } from '../src/sim/bot';
import { createRun, startStage, step } from '../src/sim/run';
import { NO_INPUT, type InputFrame, type SimContext } from '../src/sim/types';
import { rawFrameSize, rigSize } from './lib/chasesize';

const arg = (k: string, d: string) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const SEEDS = arg('seeds', '1,2,3').split(',').map(Number);
const STAGES = arg('stages', '0,1,2,3').split(',').map(Number);
const SPECIES = arg('species', 'cyndaquil,charmander,feraligatr').split(',');
const FPS = arg('fps', '60').split(',').map(Number);
const AUTHORED = process.argv.includes('--authored');
if (process.argv.includes('--noprops')) CHASE_CONFIG.propsBlockLens = false;
if (process.argv.includes('--noswap')) CHASE_CONFIG.swap.below = -1;
if (process.argv.includes('--legacypitch')) CHASE_CONFIG.aimPitch.on = false;
if (process.argv.includes('--r2envelope')) { Object.assign(CHASE_CONFIG.aimPitch, { up: 60, down: 50 }); CHASE_CONFIG.aimPitch.overhead.on = false; }
const SWEEP = process.argv.includes('--sweep');
const D2R = Math.PI / 180;

/** the subject size the renderer submits to the rig (idle frame x the species' visible-size scale, scripts/lib/chasesize.ts);
 *  --rawsize uses the unscaled idle frame these diagnostics used before 2026-11-16, to compare against old tables */
const RAW = process.argv.includes('--rawsize');
const sizeOf = (id: string) => { const s = RAW ? rawFrameSize(id) : rigSize(id); return { h: s.height, w: s.width }; };

interface Sample { t: number; ground?: number; up?: number; eye: number[]; vp: number; boom: number; fov: number; elev: number; state: string; lift: number; gap: number; off: number[] }
type Control = (c: SimContext, r: ChaseRig, t: number, dt: number) => { inp: InputFrame; lookYaw?: number; lookPitch?: number };

/** one scenario at a render rate: like main.ts, the sim steps at 60 Hz from an accumulator and the rig sees the player
 *  interpolated between the last two ticks */
function run(ctx: SimContext, fps: number, secs: number, control: Control) {
  const rig = new ChaseRig();
  const P = ctx.player;
  rig.snapTo(P.x, P.y, P.z, Math.PI);
  const sz = sizeOf(P.species.id);
  const out: Sample[] = [];
  let acc = 0, t = 0;
  while (t < secs) {
    const real = 1 / fps;
    t += real;
    const ctl = control(ctx, rig, t, real);
    if (ctl.lookYaw || ctl.lookPitch) rig.look(ctl.lookYaw ?? 0, ctl.lookPitch ?? 0); // Renderer.look
    acc += real;
    // the same tolerance main.ts would need to step exactly once per tick at 60 fps
    while (acc >= ctx.dt - 1e-9) { step(ctx, ctl.inp); acc -= ctx.dt; }
    const alpha = Math.max(0, Math.min(1, acc / ctx.dt));
    const px = P.px + (P.x - P.px) * alpha, py = P.py + (P.y - P.py) * alpha, pz = P.pz + (P.z - P.pz) * alpha;
    const cf = chaseFrameFor(ctx, { dt: real, x: px, y: py, z: pz, height: sz.h, width: sz.w, lookPitch: 0 });
    rig.update(cf);
    const dx = rig.eye[0] - rig.px, dz = rig.eye[2] - rig.pz;
    // the ground under the lens as the rig itself sees it (the Pokémon's layer: render/chaseinput.ts)
    out.push({ t, ground: cf.ground(rig.eye[0], rig.eye[2]), up: rig.userPitch, eye: rig.eye.slice(), vp: rig.viewPitch / D2R, boom: rig.boomUsed, fov: rig.fov / D2R, elev: Math.atan2(rig.eye[1] - rig.py - rig.pivotH, Math.hypot(dx, dz)) / D2R, state: rig.state, lift: rig.liftDeg, gap: rig.lensGap, off: [rig.eye[0] - px, rig.eye[1] - py, rig.eye[2] - pz] });
  }
  return { s: out, pops: rig.groundPops };
}

const pct = (a: number[], p: number) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const range = (a: number[]) => (a.length ? Math.max(...a) - Math.min(...a) : 0);
/** per-frame change of the lens velocity (m/s) */
function dv(s: Sample[]) {
  const j: number[] = [];
  for (let k = 2; k < s.length; k++) {
    const dt1 = s[k].t - s[k - 1].t, dt0 = s[k - 1].t - s[k - 2].t;
    j.push(Math.hypot(...[0, 1, 2].map((c) => (s[k].eye[c] - s[k - 1].eye[c]) / dt1 - (s[k - 1].eye[c] - s[k - 2].eye[c]) / dt0)));
  }
  return j;
}
const elevMax = (s: Sample[]) => Math.max(0, ...s.filter((x) => x.gap >= 1).map((x) => x.elev));
const jumpMax = (s: Sample[]) => { let m = 0; for (let k = 1; k < s.length; k++) m = Math.max(m, Math.hypot(...s[k].eye.map((v, c) => v - s[k - 1].eye[c]))); return m; };
const flips = (s: Sample[]) => { let n = 0; for (let k = 1; k < s.length; k++) if (s[k].state !== s[k - 1].state) n++; return n; };
const travel = (s: Sample[], f: (x: Sample) => number) => { let n = 0; for (let k = 1; k < s.length; k++) n += Math.abs(f(s[k]) - f(s[k - 1])); return n; };
/** the lens position at time t (linear between samples) */
const at = (s: Sample[], t: number) => { let k = 1; while (k < s.length - 1 && s[k].t < t) k++; const a = s[k - 1], b = s[k], u = Math.max(0, Math.min(1, (t - a.t) / (b.t - a.t))); return a.eye.map((v, c) => v + (b.eye[c] - v) * u); };

function fresh(seed: number, stage: number, species: string, calm: boolean) {
  const ctx = createRun({ seed, species, ruleOverrides: AUTHORED ? {} : { worldgen: { mode: 'generated' } } });
  if (stage) startStage(ctx, stage);
  if (calm) ctx.rules.director.spawnBase = -99;
  return ctx;
}

// the scripted walk: forward along the camera while it swings slowly left and right
const walkCtl: Control = (_c, r, t, dt) => ({ inp: { ...NO_INPUT, mx: Math.sin(r.yaw), mz: Math.cos(r.yaw) }, lookYaw: Math.sin(t * 0.7) * 0.9 * dt });
/** the same walk while the player sweeps the pitch over the whole band in force (lookPitchRange), up first, every 8 s */
const BAND = process.argv.includes('--sweepband') ? arg('sweepband', '89,89').split(',').map(Number) : null;
const sweepCtl: Control = (c, r, t, dt) => {
  const [lo, hi] = BAND ? [-BAND[0] - CHASE_CONFIG.aimPitch.neutral, BAND[1] - CHASE_CONFIG.aimPitch.neutral] : lookPitchRange(), mid = (lo + hi) / 2, amp = (hi - lo) / 2;
  const want = mid - amp * Math.sin((t * 2 * Math.PI) / 8 + Math.asin(Math.max(-1, Math.min(1, mid / amp))));
  return { ...walkCtl(c, r, t, dt), lookPitch: (Math.max(lo, Math.min(hi, want)) - r.userPitch) * D2R };
};
/** the walk's yaw as a function of time (the integral of walkCtl's look input) */
const walkYaw = (t: number) => Math.PI - (0.9 / 0.7) * (1 - Math.cos(t * 0.7));

/** the walk's player path, one position per 60 Hz tick */
function recordWalk(ctx: SimContext) {
  const P = ctx.player, track: { ctx: SimContext; pos: number[][] } = { ctx, pos: [[P.x, P.y, P.z]] };
  for (let k = 1; k * ctx.dt < 20.5; k++) { const y = walkYaw(k * ctx.dt); step(ctx, { ...NO_INPUT, mx: Math.sin(y), mz: Math.cos(y) }); track.pos.push([P.x, P.y, P.z]); }
  return track;
}
/** the rig following a recorded path at a render rate (position interpolated between ticks, as the renderer does) */
function replay(track: { ctx: SimContext; pos: number[][] }, fps: number) {
  const { ctx, pos } = track, rig = new ChaseRig(), sz = sizeOf(ctx.player.species.id), out: Sample[] = [];
  rig.snapTo(pos[0][0], pos[0][1], pos[0][2], Math.PI);
  for (let t = 1 / fps; t < 20; t += 1 / fps) {
    const u = t / ctx.dt, i = Math.min(pos.length - 2, Math.floor(u)), a = u - i, p = pos[i], q = pos[i + 1];
    rig.yaw = walkYaw(t);
    rig.update(chaseFrameFor(ctx, { dt: 1 / fps, x: p[0] + (q[0] - p[0]) * a, y: p[1] + (q[1] - p[1]) * a, z: p[2] + (q[2] - p[2]) * a, height: sz.h, width: sz.w, lookPitch: 0 }));
    out.push({ t, eye: rig.eye.slice(), vp: 0, boom: rig.boomUsed, fov: 0, elev: 0, state: rig.state, lift: rig.liftDeg, gap: rig.lensGap, off: [0, 0, 0] });
  }
  return out;
}

const rows: Record<string, number | string>[] = [];
for (const fps of FPS) for (const seed of SEEDS) for (const stage of STAGES) for (const sp of SPECIES) {
  const map = fresh(seed, stage, sp, true).world.map.id;
  const idle = run(fresh(seed, stage, sp, true), fps, 4, () => ({ inp: NO_INPUT })).s.filter((s) => s.t > 1.5);
  const idleMove = Math.max(...idle.map((s) => Math.hypot(s.eye[0] - idle[0].eye[0], s.eye[1] - idle[0].eye[1], s.eye[2] - idle[0].eye[2])));
  const turn = run(fresh(seed, stage, sp, true), fps, 7.5, (_c, _r, _t, dt) => ({ inp: NO_INPUT, lookYaw: dt })).s.filter((s) => s.t > 1.2);
  const w = run(fresh(seed, stage, sp, true), fps, 20, walkCtl), walk = w.s.filter((s) => s.t > 1);
  const fr = run(fresh(seed, stage, sp, false), fps, 30, (c, _r, _t, dt) => ({ inp: botInput(c), lookYaw: 0.25 * dt })), fight = fr.s.filter((s) => s.t > 2);
  let fpsDev = 0;
  if (fps !== 60) {
    // the same player path (recorded once at 60 Hz) and the same yaw curve, seen by the rig at this rate and at 60
    const track = recordWalk(fresh(seed, stage, sp, true));
    const a = replay(track, fps), b = replay(track, 60);
    for (let t = 1; t < 19.5; t += 0.05) { const p = at(a, t), q = at(b, t); fpsDev = Math.max(fpsDev, Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2])); }
  }
  const dw = dv(walk), df = dv(fight);
  rows.push({
    fps, seed, stage, sp, map,
    idleMove: +idleMove.toFixed(4),
    turnPitch: +range(turn.map((s) => s.vp)).toFixed(2), turnElev: +range(turn.map((s) => s.elev)).toFixed(2), turnBoom: +range(turn.map((s) => s.boom)).toFixed(2),
    walkDvP99: +pct(dw, 0.99).toFixed(2), walkDvMax: +Math.max(...dw).toFixed(2), walkPitchTravel: +travel(walk, (s) => s.vp).toFixed(1), walkBoomTravel: +travel(walk, (s) => s.boom).toFixed(1), walkElevMax: +elevMax(walk).toFixed(1), walkPitchMax: +Math.max(...walk.map((s) => s.vp)).toFixed(1), walkJumpMax: +jumpMax(walk).toFixed(2),
    fightFlips: flips(fight), fightDvP99: +pct(df, 0.99).toFixed(2), fightBoomTravel: +travel(fight, (s) => s.boom).toFixed(1), fightFovRange: +range(fight.map((s) => s.fov)).toFixed(1), fightElevMax: +elevMax(fight).toFixed(1), fightPitchMax: +Math.max(...fight.map((s) => s.vp)).toFixed(1), fightJumpMax: +jumpMax(fight).toFixed(2),
    slides: w.pops + fr.pops, fpsDev: +fpsDev.toFixed(3),
  });
  if (SWEEP) {
    const sw = run(fresh(seed, stage, sp, true), fps, 20, sweepCtl), sweep = sw.s.filter((s) => s.t > 1), ds = dv(sweep);
    const A = CHASE_CONFIG.aimPitch;
    Object.assign(rows[rows.length - 1], {
      sweepDvP99: +pct(ds, 0.99).toFixed(2), sweepJumpMax: +jumpMax(sweep).toFixed(2), sweepElevMax: +elevMax(sweep).toFixed(1),
      sweepSlides: sw.pops, sweepFloor: +Math.min(...sweep.map((s) => s.eye[1] - (s.ground ?? 0))).toFixed(2),
      sweepAxisErr: A.on ? +Math.max(...sweep.map((s) => Math.abs(s.vp - (A.neutral + (s.up ?? 0))))).toFixed(6) : -1,
      sweepPitch: `${Math.min(...sweep.map((s) => s.vp)).toFixed(0)}..${Math.max(...sweep.map((s) => s.vp)).toFixed(0)}`,
    });
  }
}
if (!process.argv.includes('--quiet')) console.table(rows);
const num = Object.keys(rows[0]).filter((k) => typeof rows[0][k] === 'number' && !['fps', 'seed', 'stage'].includes(k));
const summary: Record<string, { median: number; worst: number }> = {};
for (const k of num) { const v = rows.map((r) => r[k] as number); summary[k] = { median: +pct(v, 0.5).toFixed(3), worst: +Math.max(...v).toFixed(3) }; }
console.table(summary);
if (process.argv.includes('--json')) console.log(JSON.stringify({ rows, summary }));
