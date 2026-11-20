// Aim against the crosshair with the real host order (look → one view sample → the tick → render), the real rig and the
// real sim, on real maps and in tight camera poses: acceptance criteria E1, E2, E3 and E5 of
// docs/THIRD_PERSON_IMPLEMENTATION.md §25. Replay hashes say the sim did not change; this says the shots still go where
// the crosshair is once collision, the deck cap and the stair smoothing have moved the lens.
//   npx tsx scripts/camaim.ts [--species cyndaquil,feraligatr] [--fight] [--json out.json]
//
//   E1 still   the sim's aim point (ctx.aim.tx/ty/tz) seen through the frame drawn, degrees off the crosshair, standing
//   E2 moving  the same while walking, reversing, strafing and crossing a 0.5 m step: the error, and how much of it the
//              frame's own lens travel does not explain (the aim was taken from the sample, the frame is drawn after it)
//   E3 shots   a target put on the crosshair is hit by the basic attack (or the crosshair says blocked and it is not)
//   E5 fight   (--fight) share of aimed frames with the crosshair blocked in 60 s of bot combat aimed through the rig
import fs from 'node:fs';
import { seen } from '../src/render/framing';
import { aimRayOf } from '../src/render/hostframe';
import { botInput } from '../src/sim/bot';
import { spawnEnemy } from '../src/sim/enemies';
import { createRun, startStage, step } from '../src/sim/run';
import { SK } from '../src/sim/spatial';
import { BTN, NO_INPUT, type InputFrame, type SimContext } from '../src/sim/types';
import type { RigAdapter, RigLike } from './lib/cambench';
import { ADAPTER } from './lib/camrig';
import { deckPose, openPose, place, stepPose, wallPoses, type Pose } from './lib/camposes';

const arg = (k: string, d: string) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const R2D = 180 / Math.PI;

/** the rig under test (scripts/lib/camrig.ts ADAPTER: the current one) */
let RIG: RigAdapter = ADAPTER;
export function useRig(a: RigAdapter) { RIG = a; }

/** the species whose basic attack takes the spatial aim (a direct shot), one or more per size class */
export const AIM_SPECIES = ['cyndaquil', 'quilava', 'charizard', 'feraligatr', 'totodile', 'croconaw', 'lapras'];

function run(species: string, stage: number, seed = 1): SimContext {
  const ctx = createRun({ seed, species, ruleOverrides: { worldgen: { mode: 'generated' } } });
  if (stage) startStage(ctx, stage);
  ctx.rules.director.spawnBase = -99;
  return ctx;
}

/** the host: one drawn frame = look, one sample, one tick aimed with it, the rig's update (render/hostframe.ts order) */
export class Host {
  rig: RigLike = RIG.make();
  /** the last frame's aim error (deg) and the part of it the frame's lens travel does not explain */
  err = 0; unexplained = 0;
  constructor(readonly ctx: SimContext, yaw: number) {
    const P = ctx.player;
    this.rig.snapTo(P.x, P.y, P.z, yaw);
    this.rig.update(RIG.chaseFrame(ctx, { dt: 0, x: P.x, y: P.y, z: P.z, lookPitch: 0 }));
  }
  /** one frame: `move` is in the view's frame (x right, z forward), `btn` the buttons held, `press` those just pressed */
  frame(move: [number, number] = [0, 0], btn = 0, press = 0, look?: [number, number]) {
    const ctx = this.ctx, P = ctx.player, rig = this.rig;
    if (look) rig.look(look[0], look[1]);
    const v = rig.sample(1280, 720), sy = Math.sin(v.yaw), cy = Math.cos(v.yaw);
    const aim = RIG.chaseAim(v, P.x, P.z, v.aspect, (x, z) => ctx.world.height(x, z));
    const inp: InputFrame = { ...NO_INPUT, mx: sy * move[1] - cy * move[0], mz: cy * move[1] + sy * move[0], btn, press, aim: aimRayOf(v), aimDev: 'mouse', aimX: aim[0], aimZ: aim[1] };
    const ev = step(ctx, inp);
    rig.update(RIG.chaseFrame(ctx, { dt: 1 / 60, x: P.x, y: P.y, z: P.z, lookPitch: 0 }));
    const A = ctx.aim;
    this.err = 0; this.unexplained = 0;
    if (A.on) {
      const s = seen(rig, A.tx, A.ty, A.tz);
      this.err = Math.hypot(s[0], s[1]);
      // the lens moved by d between the sample and the frame drawn; the part of d across the axis, seen from the aim
      // point's distance, is what one frame of lens travel accounts for
      const d = [rig.eye[0] - v.eye[0], rig.eye[1] - v.eye[1], rig.eye[2] - v.eye[2]], along = d[0] * v.dir[0] + d[1] * v.dir[1] + d[2] * v.dir[2];
      const perp = Math.hypot(d[0] - v.dir[0] * along, d[1] - v.dir[1] * along, d[2] - v.dir[2] * along);
      const dist = Math.hypot(A.tx - rig.eye[0], A.ty - rig.eye[1], A.tz - rig.eye[2]);
      // (the aim point lies on the sample's ray and the axis has not turned: seen from the new lens it is off the axis by
      // asin(perp / dist) exactly)
      this.unexplained = Math.max(0, this.err - Math.asin(Math.min(1, perp / Math.max(dist, 1e-6))) * R2D);
    }
    return ev;
  }
  /** turn the view until the crosshair is on a world point (the lens orbits as it turns, so it takes a few passes) */
  aimAt(x: number, y: number, z: number) {
    for (let k = 0; k < 12; k++) {
      const e = this.rig.eye, dx = x - e[0], dy = y - e[1], dz = z - e[2];
      const yawWant = Math.atan2(dx, dz), pitchWant = Math.atan2(-dy, Math.hypot(dx, dz));
      this.rig.look(Math.atan2(Math.sin(this.rig.yaw - yawWant), Math.cos(this.rig.yaw - yawWant)), pitchWant - this.rig.viewPitch);
    }
  }
}

/** `shot`: the target on the crosshair was hit; the crosshair was on it and said blocked (the muzzle cannot reach it);
 *  something else stood between the lens and it (`occluded`: the crosshair was never on it); it was on the crosshair,
 *  not blocked, and not hit (`miss`: never acceptable); or there was nowhere to put one */
export interface PoseAim { pose: string; still: number; moving: number; unexplained: number; shot: 'hit' | 'blocked' | 'occluded' | 'miss' | 'no target' }

/** E1-E3 at one pose: standing 1.5 s, then walking forward, back and sideways 0.5 s each, then a shot at a target put
 *  9 m out on the crosshair's heading */
export function poseAim(species: string, stage: number, pose: (ctx: SimContext) => Pose | null): PoseAim | null {
  const ctx = run(species, stage), p = pose(ctx);
  if (!p) return null;
  place(ctx, p);
  const h = new Host(ctx, p.yaw);
  for (let k = 0; k < 90; k++) h.frame([0, 0], BTN.basic, k === 0 ? BTN.basic : 0);
  const still = h.err;
  let moving = 0, unexplained = 0;
  for (const m of [[0, 1], [0, -1], [-1, 0], [1, 0]] as [number, number][]) for (let k = 0; k < 30; k++) { h.frame(m, BTN.basic); moving = Math.max(moving, h.err); unexplained = Math.max(unexplained, h.unexplained); }
  // a target on the crosshair
  place(ctx, p);
  const h2 = new Host(ctx, p.yaw);
  for (let k = 0; k < 60; k++) h2.frame();
  const P = ctx.player, W = ctx.world;
  // the furthest of 9, 7, 5.5 and 4 m ahead that is open ground near the trainer's level
  let tx = 0, tz = 0, found = false;
  for (const d of [9, 7, 5.5, 4]) {
    tx = P.x + Math.sin(p.yaw) * d; tz = P.z + Math.cos(p.yaw) * d;
    const tk = W.tile(tx, tz);
    if (tk >= 0 && !W.map.wall[tk] && Math.abs(W.height(tx, tz) - P.y) < 1.5) { found = true; break; }
  }
  let shot: PoseAim['shot'] = 'no target';
  if (found) {
    const e = spawnEnemy(ctx, 'snorlax', tx, tz), E = ctx.enemies;
    E.vx[e] = E.vz[e] = 0;
    h2.aimAt(E.x[e], E.y[e] + E.tall[e] / 2, E.z[e]);
    let hit = false, blocked = false, onIt = false;
    for (let k = 0; k < 90 && !hit; k++) {
      h2.aimAt(E.x[e], E.y[e] + E.tall[e] / 2, E.z[e]);
      for (const ev of h2.frame([0, 0], BTN.basic, k === 0 ? BTN.basic : 0)) if (ev.t === 'hit' && (ev as { enemy?: number }).enemy === e) hit = true;
      if (ctx.aim.on && ctx.aim.hitKind === SK.enemy && ctx.aim.hitId === e) { onIt = true; if (ctx.aim.blocked) blocked = true; }
    }
    shot = hit ? 'hit' : !onIt ? 'occluded' : blocked ? 'blocked' : 'miss';
  }
  return { pose: p.name, still: +still.toFixed(4), moving: +moving.toFixed(2), unexplained: +unexplained.toFixed(4), shot };
}

/** E2 across a 0.5 m tile step, up and back down, firing: the largest aim error and its unexplained part */
export function stepAim(species: string): { moving: number; unexplained: number; steps: number } | null {
  const ctx = run(species, 1), p = stepPose(ctx);
  if (!p) return null;
  place(ctx, p);
  const h = new Host(ctx, p.yaw);
  for (let k = 0; k < 60; k++) h.frame([0, 0], BTN.basic, k === 0 ? BTN.basic : 0);
  let moving = 0, unexplained = 0, steps = 0, y = ctx.player.y;
  for (const m of [[0, 1], [0, -1]] as [number, number][]) for (let k = 0; k < 60; k++) {
    h.frame(m, BTN.basic);
    if (Math.abs(ctx.player.y - y) > 0.3) steps++;
    y = ctx.player.y;
    moving = Math.max(moving, h.err); unexplained = Math.max(unexplained, h.unexplained);
  }
  return { moving: +moving.toFixed(2), unexplained: +unexplained.toFixed(4), steps };
}

/** E5: 60 s of bot combat with the crosshair steered through the rig onto the nearest hostile (at most 6 rad/s): the
 *  share of aimed frames whose muzzle cannot reach the aim point */
export interface FightTally {
  /** frames with an aim, and those whose shot something stops short of the crosshair's point (E5) */
  aimed: number; blocked: number;
  /** of the aimed frames: the crosshair on an enemy; those blocked; those blocked by the world (not by another enemy) */
  onEnemy: number; onEnemyBlocked: number; onEnemyWorld: number;
  /** aimed frames with the view more than 60 degrees down (the bot chasing an enemy the crosshair cannot reach: one nearer
   *  the Pokémon than the shoulder offset) */
  steep: number;
}

export function fightBlocked(species: string, stage: number, seed: number): FightTally {
  const ctx = createRun({ seed, species, ruleOverrides: { worldgen: { mode: 'generated' } } });
  if (stage) startStage(ctx, stage);
  const P = ctx.player, E = ctx.enemies, rig = RIG.make();
  rig.snapTo(P.x, P.y, P.z, Math.PI);
  const T: FightTally = { aimed: 0, blocked: 0, onEnemy: 0, onEnemyBlocked: 0, onEnemyWorld: 0, steep: 0 };
  for (let k = 0; k < 3600 && ctx.state !== 'over'; k++) {
    let best = -1, bd = 900;
    for (let i = 0; i < E.hi; i++) if (E.alive[i]) { const d = (E.x[i] - P.x) ** 2 + (E.z[i] - P.z) ** 2; if (d < bd) { bd = d; best = i; } }
    if (best >= 0) {
      const e = rig.eye, dx = E.x[best] - e[0], dy = E.y[best] + E.tall[best] / 2 - e[1], dz = E.z[best] - e[2];
      const dy2 = Math.atan2(Math.sin(rig.yaw - Math.atan2(dx, dz)), Math.cos(rig.yaw - Math.atan2(dx, dz))), dp = Math.atan2(-dy, Math.hypot(dx, dz)) - rig.viewPitch;
      rig.look(Math.max(-0.1, Math.min(0.1, dy2)), Math.max(-0.05, Math.min(0.05, dp)));
    }
    const v = rig.sample(1280, 720), aim = RIG.chaseAim(v, P.x, P.z, v.aspect, (x, z) => ctx.world.height(x, z));
    const inp: InputFrame = { ...botInput(ctx), aim: aimRayOf(v), aimDev: 'mouse', aimX: aim[0], aimZ: aim[1] };
    step(ctx, inp);
    rig.update(RIG.chaseFrame(ctx, { dt: 1 / 60, x: P.x, y: P.y, z: P.z, lookPitch: 0 }));
    const a = ctx.aim;
    if (!a.on) continue;
    T.aimed++;
    if (rig.viewPitch * R2D > 60) T.steep++;
    const enemy = (a.hitKind & SK.enemy) !== 0;
    if (enemy) T.onEnemy++;
    if (a.blocked) { T.blocked++; if (enemy) { T.onEnemyBlocked++; if (!(a.blockKind & SK.enemy)) T.onEnemyWorld++; } }
  }
  return T;
}

/** the whole report: E1-E3 at every pose for each species, and E5 with `fight` */
export function aimReport(list: string[], fight: boolean): { rig: string; summary: Record<string, unknown>; rows: Record<string, unknown>[] } {
  const rows: Record<string, unknown>[] = [];
  for (const sp of list) {
    const poses: [number, (c: SimContext) => Pose | null][] = [[0, openPose], [0, deckPose], ...[0, 1, 2, 3].map((i) => [3, (c: SimContext) => wallPoses(c)[i] ?? null] as [number, (c: SimContext) => Pose | null])];
    for (const [stage, f] of poses) { const r = poseAim(sp, stage, f); if (r) rows.push({ species: sp, ...r }); }
    const s = stepAim(sp);
    if (s) rows.push({ species: sp, pose: 'step 0.5 (walk)', still: '-', moving: s.moving, unexplained: s.unexplained, shot: `${s.steps} steps` });
  }
  const num = (k: string) => rows.map((r) => r[k]).filter((v): v is number => typeof v === 'number');
  const summary: Record<string, unknown> = {
    'E1 still, worst (deg)': Math.max(...num('still')), 'E2 moving, worst error (deg)': Math.max(...num('moving')), 'E2 worst not explained by lens travel (deg)': Math.max(...num('unexplained')),
    'E3 shots': Object.fromEntries(['hit', 'blocked', 'occluded', 'miss', 'no target'].map((k) => [k, rows.filter((r) => r.shot === k).length])),
  };
  if (fight) {
    const fights: Record<string, string> = {}, detail: Record<string, string> = {};
    const pc = (x: number, of: number) => (of ? ((100 * x) / of).toFixed(1) : '-') + ' %';
    for (const sp of list) {
      const t: FightTally = { aimed: 0, blocked: 0, onEnemy: 0, onEnemyBlocked: 0, onEnemyWorld: 0, steep: 0 };
      for (const stage of [0, 2]) for (const seed of [1, 2]) { const r = fightBlocked(sp, stage, seed); for (const k of Object.keys(t) as (keyof FightTally)[]) t[k] += r[k]; }
      fights[sp] = `${pc(t.blocked, t.aimed)} of ${t.aimed} aimed frames`;
      detail[sp] = `crosshair on an enemy ${pc(t.onEnemy, t.aimed)} of aimed; of those blocked ${pc(t.onEnemyBlocked, t.onEnemy)}, by the world ${pc(t.onEnemyWorld, t.onEnemy)}; view over 60 deg down ${pc(t.steep, t.aimed)} of aimed`;
    }
    summary['E5 blocked crosshair'] = fights;
    summary['E5 detail'] = detail;
  }
  return { rig: RIG.version, summary, rows };
}

if (process.argv[1]?.endsWith('camaim.ts')) {
  const R = aimReport(arg('species', AIM_SPECIES.join(',')).split(','), process.argv.includes('--fight'));
  console.log(`rig ${R.rig}`);
  console.table(R.rows);
  console.log(R.summary);
  const out = arg('json', '');
  if (out) fs.writeFileSync(out, JSON.stringify(R, null, 1));
}
