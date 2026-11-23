// S1 spike §3: the scripted 60 s controller run on the range. One capsule per size class (rules.size.classes: footprint
// `body` as radius, class `height`), each in its own Rapier world over the same static colliders plus two spike
// fixtures the range does not have (a 0.5 m ledge box and a deck: top 3.0 m, 0.6 m slab, 2.4 m gap, beside the
// terrace). Gravity, jump and planar acceleration are ours (rules.player); the Rapier character controller only resolves
// the translation (autostep, snap to ground, slope limits, sliding). Inputs steer to a fixed list of waypoints from the
// body's own position each tick (no RNG, no clock); every tick hashes each body's translation (float32 bits).
import type { World as RWorld, KinematicCharacterController, Collider as RCollider, RigidBody } from '@dimforge/rapier3d-deterministic/exports';
import { defaultRules } from '../../src/rules/defaults';
import type { WorldModel } from '../../src/world/model';
import { buildStatic, type Representation } from '../../src/physics/colliders';
import type { Rapier } from '../../src/physics/rapier';

export const DT = 1 / 60;
/** controller numbers (the record's table) */
export const KCC = {
  /** m: the controller's skin. The shape is the body shrunk by it, so the envelope it keeps clear is the body itself */
  offset: 0.01,
  autostep: 0.6, autostepMinWidth: 0.2,
  /** m: snap to ground (the sim's STICK, 0.35: a 0.5 m ledge is a drop, a ramp going down is not) */
  snap: 0.35,
  /** the range's stair flight is 2 m over 2 m: 45°; climb up to 46° (float margin), slide on anything steeper */
  maxSlopeDeg: 46,
};
const SPEED = 6;
const P = defaultRules.player;

/** the spike's own fixtures on the range (world coordinates; tile (i, j) → x = i − 56, z = j − 56) */
export const FIXTURES = {
  ledge: { centre: [-6, 0.25, 10.5], half: [2, 0.25, 4.5] },
  deck: { centre: [-14, 2.7, -12], half: [4, 0.3, 4] },
} as const;

/** waypoints: x, z, and what the leg does. 'jump' legs jump once the body is within reach of the deck's west edge
 *  while standing on the terrace; 'slide' legs push into the terrace's east face for `t` seconds */
type Leg = { x: number; z: number; kind?: 'jump' | 'slide'; t?: number };
const LEGS: Leg[] = [
  { x: -2, z: 10.5 },
  { x: -10, z: 10.5 }, // over the 0.5 m ledge (autostep up at x = −4, a drop off at x = −8)
  { x: -27, z: 0 },
  { x: -27, z: -7.5 }, // up the 45° stairs onto the 2 m terrace
  { x: -24, z: -12 },
  { x: -11, z: -12, kind: 'jump' }, // jump from the terrace (2 m) onto the deck (3 m)
  { x: -7, z: -12 }, // off the deck's east end: a 3 m drop
  { x: -5, z: -12 },
  { x: -17.2, z: -12 }, // back west under the deck (2.4 m gap)
  { x: -40, z: -30, kind: 'slide', t: 2.5 }, // into the terrace's east face (x = −18), sliding north along it
  { x: -14, z: -2 },
  { x: 0.5, z: 10.5 },
];
const START = { x: 0.5, z: 10.5 };
const LEG_TIMEOUT = 10;

export interface ClassRun {
  id: string; radius: number; height: number;
  hash: string; checkpoints: string[];
  /** coverage */
  ledgeTicks: number; stairsMaxY: number; deckTicks: number; underDeckTicks: number; jumps: number; skipped: number[];
  slideDist: number; legsDone: number; collisions: number; end: [number, number, number];
}

class Hash {
  a = 0x811c9dc5 | 0; b = 0x01000193 ^ 0x9e3779b9;
  private f = new Float32Array(1); private u = new Uint32Array(this.f.buffer);
  f32(v: number) {
    this.f[0] = v; const w = this.u[0];
    for (let s = 0; s < 32; s += 8) { const by = (w >>> s) & 255; this.a = Math.imul(this.a ^ by, 0x01000193); this.b = Math.imul(this.b ^ by, 0x5bd1e995); }
  }
  hex() { return (this.a >>> 0).toString(16).padStart(8, '0') + (this.b >>> 0).toString(16).padStart(8, '0'); }
}

export interface Body { body: RigidBody; col: RCollider; ctl: KinematicCharacterController; r: number; h: number }

/** a capsule character for a body of footprint radius r and height h, feet at (x, y, z) */
export function makeCharacter(R: Rapier, w: RWorld, r: number, h: number, x: number, y: number, z: number, opt = KCC): Body {
  const rs = r - opt.offset, hs = h - 2 * opt.offset, half = Math.max(0, hs / 2 - rs);
  const body = w.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setTranslation(x, y + h / 2, z));
  const col = w.createCollider(half > 0 ? R.ColliderDesc.capsule(half, rs) : R.ColliderDesc.ball(rs), body);
  const ctl = w.createCharacterController(opt.offset);
  ctl.setUp({ x: 0, y: 1, z: 0 });
  ctl.enableAutostep(opt.autostep, opt.autostepMinWidth, false);
  ctl.enableSnapToGround(opt.snap);
  ctl.setMaxSlopeClimbAngle((opt.maxSlopeDeg * Math.PI) / 180);
  ctl.setMinSlopeSlideAngle((opt.maxSlopeDeg * Math.PI) / 180);
  ctl.setSlideEnabled(true);
  if (process.env.S1NUDGE) ctl.setNormalNudgeFactor(Number(process.env.S1NUDGE));
  return { body, col, ctl, r, h };
}

export function addFixtures(R: Rapier, w: RWorld) {
  for (const f of [FIXTURES.ledge, FIXTURES.deck]) w.createCollider(R.ColliderDesc.cuboid(f.half[0], f.half[1], f.half[2]).setTranslation(f.centre[0], f.centre[1], f.centre[2]));
}

const inBox = (x: number, z: number, f: { centre: readonly number[]; half: readonly number[] }, pad = 0) =>
  Math.abs(x - f.centre[0]) <= f.half[0] - pad && Math.abs(z - f.centre[2]) <= f.half[2] - pad;

/** run the course for every size class; seconds of sim time */
export function runCourse(R: Rapier, M: WorldModel, rep: Representation, seconds = 60, trimeshFlags = 0): { runs: ClassRun[]; hash: string; stepMs: number } {
  const runs: ClassRun[] = [];
  const all = new Hash();
  let stepMs = 0;
  for (const C of defaultRules.size.classes) {
    const w = new R.World({ x: 0, y: 0, z: 0 });
    w.timestep = DT;
    buildStatic(R, w, M, rep, { trimeshFlags });
    addFixtures(R, w);
    const B = makeCharacter(R, w, C.body, C.height, START.x, 0, START.z);
    w.step();
    const hsh = new Hash();
    const run: ClassRun = { id: C.id, radius: C.body, height: C.height, hash: '', checkpoints: [], ledgeTicks: 0, stairsMaxY: 0, deckTicks: 0, underDeckTicks: 0, jumps: 0, skipped: [], slideDist: 0, legsDone: 0, collisions: 0, end: [0, 0, 0] };
    let vx = 0, vy = 0, vz = 0, grounded = true, leg = 0, legT = 0, jumped = false;
    const ticks = Math.round(seconds / DT);
    for (let t = 0; t < ticks; t++) {
      const p = B.body.translation();
      const x = p.x, feet = p.y - C.height / 2, z = p.z;
      // intent: toward the leg's waypoint (unit), or the slide push
      const L = LEGS[leg];
      let mx = L.x - x, mz = L.z - z;
      const d = Math.sqrt(mx * mx + mz * mz);
      let wantJump = false;
      if (L.kind === 'slide') {
        const s = Math.sqrt(mx * mx + mz * mz); mx /= s; mz /= s;
        if (legT >= (L.t ?? 2)) { leg = (leg + 1) % LEGS.length; legT = 0; run.legsDone++; }
      } else if (d < 0.5) {
        leg = (leg + 1) % LEGS.length; legT = 0; run.legsDone++; jumped = false; mx = 0; mz = 0;
      } else {
        mx /= d; mz /= d;
        if (L.kind === 'jump' && !jumped && grounded && feet > 1.9 && x >= -18 - C.body - 0.9) { wantJump = true; jumped = true; }
      }
      legT += DT;
      if (legT > LEG_TIMEOUT && L.kind !== 'slide') { run.skipped.push(leg); leg = (leg + 1) % LEGS.length; legT = 0; jumped = false; }
      // our planar drive and vertical (locomotion.ts's numbers)
      const acc = Math.min(1, (grounded ? P.groundAccel : P.airAccel) * DT);
      vx += (mx * SPEED - vx) * acc; vz += (mz * SPEED - vz) * acc;
      if (wantJump && grounded) { vy = P.jumpVelocity; grounded = false; run.jumps++; }
      vy -= P.gravity * DT;
      const want = { x: vx * DT, y: vy * DT, z: vz * DT };
      const t0 = performance.now();
      B.ctl.computeColliderMovement(B.col, want);
      const mv = B.ctl.computedMovement();
      grounded = B.ctl.computedGrounded();
      run.collisions += B.ctl.numComputedCollisions();
      B.body.setNextKinematicTranslation({ x: p.x + mv.x, y: p.y + mv.y, z: p.z + mv.z });
      w.step();
      stepMs += performance.now() - t0;
      if (grounded && vy < 0) vy = 0;
      if (vy > 0 && mv.y < want.y - 1e-4) vy = 0; // head met a ceiling: speed spent
      // planar velocity is not fed back from the resolved move (locomotion.ts: walls stop the body, not its drive).
      // Feeding it back (vx = mv.x / dt when blocked) starved the autostep: the next tick's desired move was ~0 and
      // Tiny-Medium never climbed the 0.5 m ledge (record §7)
      const q = B.body.translation();
      hsh.f32(q.x); hsh.f32(q.y); hsh.f32(q.z);
      all.f32(q.x); all.f32(q.y); all.f32(q.z);
      const fy = q.y - C.height / 2;
      if (inBox(q.x, q.z, FIXTURES.ledge) && fy > 0.45) run.ledgeTicks++;
      if (q.x > -28 && q.x < -26 && q.z > -6.2 && q.z < -3.8) run.stairsMaxY = Math.max(run.stairsMaxY, fy);
      if (inBox(q.x, q.z, FIXTURES.deck) && fy > 2.95) run.deckTicks++;
      if (inBox(q.x, q.z, FIXTURES.deck, 0) && fy < 0.1) run.underDeckTicks++;
      if (L.kind === 'slide') run.slideDist += Math.abs(mv.z);
      if ((t + 1) % 600 === 0) run.checkpoints.push(hsh.hex());
    }
    const e = B.body.translation();
    run.end = [e.x, e.y - C.height / 2, e.z];
    run.hash = hsh.hex();
    runs.push(run);
    w.free();
  }
  return { runs, hash: all.hex(), stepMs };
}

/** §4 extra: a dynamic pile (the solver and contacts, which the controller course never runs) and query results.
 *  60 bodies (boxes, balls, capsules) dropped in a 6 × 6 m column onto the range's floor beside the spawn, 600 ticks,
 *  hashing every body's translation and rotation each tick, then 200 rays and 50 shape casts whose hit distances and
 *  normals are hashed too. */
export function runPile(R: Rapier, M: WorldModel, rep: Representation): string {
  const w = new R.World({ x: 0, y: -P.gravity, z: 0 });
  w.timestep = DT;
  buildStatic(R, w, M, rep);
  const bodies: RigidBody[] = [];
  for (let i = 0; i < 60; i++) {
    const x = 6 + (i % 4) * 1.3 + ((i * 7) % 5) * 0.05, z = 4 + (((i / 4) | 0) % 4) * 1.3, y = 1 + ((i / 16) | 0) * 1.4 + (i % 3) * 0.2;
    const b = w.createRigidBody(R.RigidBodyDesc.dynamic().setTranslation(x, y, z).setRotation({ x: 0.1 * (i % 3), y: 0.2, z: 0, w: 1 }).setLinvel(((i % 5) - 2) * 0.3, 0, ((i % 7) - 3) * 0.2));
    const d = i % 3 === 0 ? R.ColliderDesc.cuboid(0.4, 0.3, 0.5) : i % 3 === 1 ? R.ColliderDesc.ball(0.4) : R.ColliderDesc.capsule(0.3, 0.3);
    w.createCollider(d.setFriction(0.7).setRestitution(0.1), b);
    bodies.push(b);
  }
  const h = new Hash();
  for (let t = 0; t < 600; t++) {
    w.step();
    for (const b of bodies) { const p = b.translation(), q = b.rotation(); h.f32(p.x); h.f32(p.y); h.f32(p.z); h.f32(q.x); h.f32(q.y); h.f32(q.z); h.f32(q.w); }
  }
  const ray = new R.Ray({ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 });
  for (let k = 0; k < 200; k++) {
    // directions from rational components (no trig), normalised with sqrt
    const dx = ((k * 37) % 21) - 10, dy = ((k * 11) % 9) - 6, dz = ((k * 53) % 17) - 8, l = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
    ray.origin = { x: 7 + (k % 5), y: 1.5, z: 5 + (k % 7) }; ray.dir = { x: dx / l, y: dy / l, z: dz / l };
    const hit = w.castRayAndGetNormal(ray, 60, true);
    if (hit) { h.f32(hit.timeOfImpact); h.f32(hit.normal.x); h.f32(hit.normal.y); h.f32(hit.normal.z); } else h.f32(-1);
  }
  const ball = new R.Ball(0.3);
  for (let k = 0; k < 50; k++) {
    const vx = ((k * 13) % 11) - 5, vz = ((k * 29) % 13) - 6;
    const hit = w.castShape({ x: 2 + (k % 9), y: 0.8, z: (k % 6) - 2 }, { x: 0, y: 0, z: 0, w: 1 }, { x: vx, y: -0.5, z: vz }, ball, 0, 4, true);
    if (hit) { h.f32(hit.time_of_impact); h.f32(hit.normal1.x); h.f32(hit.normal1.y); h.f32(hit.normal1.z); } else h.f32(-1);
  }
  w.free();
  return h.hex();
}
