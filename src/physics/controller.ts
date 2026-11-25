// The character controller (task I1b; docs/OVERHAUL_3D.md "Division of responsibilities", docs/LOCOMOTION.md
// "Resolvers"): Rapier's kinematic character controller resolves one tick's translation of a partner's body against
// the static world (slide, slope limits), and our own roll resolves rises up to the step height
// (Rapier's autostep is off: it is speed- and angle-dependent and over-climbs, docs/spikes/S1-physics.md §7, owner O4).
// Gravity, jumps and every other rule of motion are the sim's (sim/locomotion.ts); this only says where the body ends.
//
// The body is a capsule per footprint and height (S1 §8): radius = footprint − offset, the shape `height − 2·offset −
// headMargin` tall, so the envelope the controller keeps clear (the shape plus its offset) is the body with a 1 mm head
// margin (O5). A body too short for a cylinder part is a ball (Tiny: 0.29 m, no head margin). One parentless collider
// per (footprint, height), created on first use, with collision groups 0: no query and no other collider ever meets it.
// Before each move it is set to the body's position, so the Rapier world keeps no state the next tick depends on (the
// collider's last position is overwritten before it is read; the controller object holds settings only): nothing of it
// enters the replay hash (ROADMAP F62).
//
// Exact unless cut (ROADMAP F70). A move Rapier's controller reports no collision on is the desired translation itself,
// in 64-bit (its own answer is the f32 sum); one it reports collisions on is its answer. Heights are the world model's:
// PhysicsWorld.supportBelow returns a box's f64 top, the height of what a cast meets is the touched box's f64 top, and a
// fall the controller met only floors on is the tile model's landing (the feet land on the support under the axis on the
// tick they reach it, not a tick early where the offset cut the fall a hair above it). Whether a capsule fits is decided
// in 64-bit too, against a box's bounds: neither Rapier's intersection test nor its contact query is exact within a
// centimetre (`clearOf`).
//
// The roll (ROADMAP F69; our own, S1 manualstep.ts's "tick's own travel" rule made to hold). A supported move the
// controller cut, and the move of a body resting on an edge ahead of its wish, goes the tick's own travel, lifted by the
// least height at which the capsule fits there:
//   1 where it fits at its own height there is nothing to roll over (the controller's skin cut the move short of a
//     face): the move is the desired one, and a body part way up an edge holds its height;
//   2 else the planar carry is the controller's own move at the body's height with what it may roll over left out (the
//     boxes whose top is within the step of what it rests on): the wish itself, or slid at full radius along what stands
//     higher (a corner where a higher block meets the rise: the tile footprint glides off it as it steps up). Then lift
//     the capsule by the step height plus two offsets (a ceiling cuts it short), carry it over (a slab refuses it), cast
//     it down onto what is under it, and take it when what it lands on is a rise (above the support under its axis), its
//     top no more than the step (+ `tolerance`) above what it rested on (its feet on its axis support; perched higher,
//     the top of the edge under its round bottom), the landing lifts it, and it fits. Top to top: rolling never adds up
//     past the step (S1's over-climb).
// The round bottom rolls up the edge tick by tick at the body's own speed and arrives on the top as its axis crosses the
// edge, as the tile body rises onto it then: a flight of steps takes the time of flat ground, no tick moves the body
// further than its own travel, and every tick of a roll is grounded. S1's rule perched and fell back at slow and 45°
// approaches: the controller's skin (1 cm) stopped a body slower than 0.6 m/s short of the face for good, and the support
// set a body part way up back down onto the edge; rule 1 is the answer to both. I1b's first cut carried the capsule a
// hop of up to the step height and radius + margin in one tick (20–57 % faster than flat ground); that is gone.
//
// After the move and the roll: the support (the tile model's stick at the axis: a supported body stays supported while
// its feet after the tick's gravity are less than `snap` above the support under its axis, every class alike; ROADMAP
// F66), the landing (on the floor under the axis; a ledge's edge that cuts a fall is rolled off, not landed on) and the
// rest (feet exactly on the world model's height when within `rest` of it): docs/LOCOMOTION.md "Resolvers".
//
// Casts use stopAtPenetration false: the controller rests at about its offset from the floor, a little less after a
// slide, and a cast must be free to move away from what it is touching.

import type { Rapier } from './rapier';
import { dcos } from '../core/detmath';

type RWorld = InstanceType<Rapier['World']>;
type RCollider = InstanceType<Rapier['Collider']>;
type KCC = InstanceType<Rapier['KinematicCharacterController']>;

/** the controller's numbers (rules.physics.controller) */
export interface ControllerRules {
  offset: number;
  headMargin: number;
  maxSlopeDeg: number;
  minSlideDeg: number;
  snap: number;
  probe: number;
  rest: number;
  edge: number;
  backoff: number;
  step: { margin: number; tolerance: number };
}

/** the support under a point (PhysicsWorld's supportBelow over what stops a body): the top of the first solid within
 *  `drop` m below (x, y, z), or -Infinity */
export type SupportFn = (x: number, y: number, z: number, drop: number) => number;
/** the world model's f64 bounds of a box collider (by Rapier handle) into `out` (lo x y z, hi x y z); false for a mesh or
 *  a hull */
export type BoxFn = (handle: number, out: Float64Array) => boolean;

/** a body's capsule: the shape's radius and cylinder half-height (0 for a ball), and its centre's height above the feet */
export interface Capsule { radius: number; half: number; lift: number }

/** The capsule of a body with footprint r and height h (S1 §8): radius r − offset, shape height h − 2·offset −
 *  headMargin; a ball of radius r − offset when that leaves no cylinder (Tiny: 0.29 m, envelope 0.60 m, no margin). */
export function capsuleOf(r: number, h: number, offset: number, headMargin: number): Capsule {
  const radius = r - offset, hs = h - 2 * offset - headMargin, half = hs / 2 - radius;
  return half > 0 ? { radius, half, lift: offset + hs / 2 } : { radius, half: 0, lift: offset + radius };
}

/** One tick's move: the body's feet and the desired translation in, where it ends and what it met out. */
export interface CharacterMove {
  x: number; y: number; z: number;
  dx: number; dy: number; dz: number;
  /** footprint radius and height (m) */
  r: number; h: number;
  /** m: the rise the roll may climb this tick (0: none) */
  stepUp: number;
  /** the body was supported at the start of the tick and is not taking off (the roll runs only then) */
  supported: boolean;
  /** out: the controller found a floor under it */
  onGround: boolean;
  /** out: a rising move was cut short by something overhead */
  ceiling: boolean;
  /** out: the roll ran this tick (lifted the body toward a rise, or held it on the edge it is rolling over) */
  stepped: boolean;
}

const UP = { x: 0, y: 1, z: 0 }, ROT = { x: 0, y: 0, z: 0, w: 1 };
/** what the roll did: nothing (the controller's answer stands), the plain move (nothing to roll over), a roll up */
const ROLL = { none: 0, plain: 1, up: 2 } as const;
/** the eight compass directions (cos = sin = √½ on the diagonals, no trigonometry) */
const H = Math.SQRT1_2;
const RING: readonly [number, number][] = [[1, 0], [H, H], [0, 1], [-H, H], [-1, 0], [-H, -H], [0, -1], [H, -H]];

/** The controller of one physics world: Rapier's character controller with autostep off, the capsule colliders, the
 *  roll. Owned by its PhysicsWorld (freed with its Rapier world). */
export class CharacterKit {
  private readonly kcc: KCC;
  private readonly cols = new Map<string, { col: RCollider; cap: Capsule }>();
  private readonly cosClimb: number;
  private readonly v = { x: 0, y: 0, z: 0 };
  private readonly p = { x: 0, y: 0, z: 0 };
  /** counters for the perf report and the stepping test: moves resolved, steps climbed, step attempts, casts */
  readonly stats = { moves: 0, steps: 0, tries: 0, casts: 0 };

  constructor(private readonly R: Rapier, private readonly W: RWorld, private readonly rules: ControllerRules, private readonly groups: number, private readonly support: SupportFn, private readonly boxOf: BoxFn, handles?: [string, number][]) {
    const k = W.createCharacterController(rules.offset);
    k.setUp(UP);
    k.disableAutostep();
    k.disableSnapToGround(); // ours (move): Rapier's set capsules into step edges
    k.setMaxSlopeClimbAngle((rules.maxSlopeDeg * Math.PI) / 180);
    k.setMinSlopeSlideAngle((rules.minSlideDeg * Math.PI) / 180);
    k.setSlideEnabled(true);
    this.kcc = k;
    this.cosClimb = dcos((rules.maxSlopeDeg * Math.PI) / 180);
    // a restored snapshot keeps the capsule colliders (by handle): reuse them rather than add new ones
    for (const [key, h] of handles ?? []) {
      const col = W.getCollider(h), [r, hh] = key.split('|').map(Number);
      if (col) this.cols.set(key, { col, cap: capsuleOf(r, hh, rules.offset, rules.headMargin) });
    }
  }

  /** the capsule colliders' handles by key (PhysicsWorld.restore carries them over) */
  handles(): [string, number][] { return [...this.cols].map(([k, v]) => [k, v.col.handle]); }

  private colliderFor(r: number, h: number) {
    const key = `${r}|${h}`;
    let c = this.cols.get(key);
    if (!c) {
      // every body gives its real height (ROADMAP F72: no fallback); a missing one is a caller's bug, not a ball
      if (!(r > 0 && h > 0)) throw new Error(`physics: a body move needs its footprint and height (r ${r}, h ${h})`);
      const cap = capsuleOf(r, h, this.rules.offset, this.rules.headMargin), R = this.R;
      const desc = cap.half > 0 ? R.ColliderDesc.capsule(cap.half, cap.radius) : R.ColliderDesc.ball(cap.radius);
      desc.setCollisionGroups(0).setSensor(true);
      c = { col: this.W.createCollider(desc), cap };
      this.cols.set(key, c);
    }
    return c;
  }

  /** what the last cast met: the contact point on the obstacle, the capsule's own outward normal there reversed (the
   *  obstacle's surface normal at the contact; `up` its y: 1 on a flat floor), and the height of what it met (`top`: the
   *  world model's top of the box it touched, exactly, else the contact point's y: a cast's f32 witness is centimetres
   *  off where a round bottom barely overhangs an edge, ROADMAP F68) */
  private readonly met = { x: NaN, y: NaN, z: NaN, nx: NaN, up: NaN, nz: NaN, top: NaN };

  /** a capsule cast from p along unit d up to `max` m (offset kept from what it meets); its distance, or max when clear
   *  (this.met: the contact, NaN when clear) */
  private cast(col: RCollider, px: number, py: number, pz: number, dx: number, dy: number, dz: number, max: number, keep = this.rules.offset): number {
    this.stats.casts++;
    this.p.x = px; this.p.y = py; this.p.z = pz; this.v.x = dx; this.v.y = dy; this.v.z = dz;
    const hit = this.W.castShape(this.p, ROT, this.v, col.shape, keep, max, false, undefined, this.groups);
    const M = this.met;
    if (!hit) { M.x = M.y = M.z = M.nx = M.up = M.nz = M.top = NaN; return max; }
    // normal2 is the capsule's outward normal at its contact: straight down (−1) on a flat floor
    const w = hit.witness1, n = hit.normal2;
    M.x = w.x; M.y = w.y; M.z = w.z; M.nx = -n.x; M.up = -n.y; M.nz = -n.z; M.top = this.boxOf(hit.collider.handle, this.bb) ? this.bb[4] : w.y;
    return Math.max(0, hit.time_of_impact);
  }

  /** the support under (x, z) from y down to `drop` m (one counted ray) */
  private under(x: number, y: number, z: number, drop: number): number {
    this.stats.casts++;
    return this.support(x, y, z, drop);
  }

  /** Is the last cast's contact the floor under the axis at (x, z), whose support is f: a stand (its slope within the
   *  climb angle) whose tangent plane, carried to the axis, passes no more than `edge` above f (a flat floor, a ramp)?
   *  A ledge's edge the round bottom sits on is not: its plane passes well above the lower floor under the axis (or there
   *  is none), and once the bottom has rolled past 46° its contact is no stand */
  private onFloor(x: number, z: number, f: number): boolean {
    const M = this.met;
    if (!(f > -Infinity) || !(M.up >= this.cosClimb)) return false;
    const plane = M.y + (M.nx * (M.x - x) + M.nz * (M.z - z)) / M.up;
    return f >= plane - this.rules.edge;
  }

  /** every collision the controller reported on its last move (n of them) is with a floor: its normal within the climb
   *  angle of straight up */
  private floorsOnly(n: number): boolean {
    for (let i = 0; i < n; i++) { const c = this.kcc.computedCollision(i); if (!c || c.normal1.y < this.cosClimb) return false; }
    return true;
  }

  /** the capsule fits at (x, y, z) (its centre): it meets nothing that stops a body (clearOf with the move's capsule) */
  private fits(col: RCollider, x: number, y: number, z: number): boolean {
    this.stats.casts++;
    return this.clearOf(col.shape, this.cap.radius, this.cap.half, x, y, z);
  }

  /** Is the capsule (shape, radius, cylinder half-height; centre at x, y, z) clear of what stops a body? Neither of
   *  Rapier's tests is exact within a centimetre: its intersection test reports a capsule over a box top as intersecting
   *  at gaps up to the offset (at a third of the positions), and its contact query put a capsule 5 mm into a box's
   *  vertical edge at +6e-5 m (mt-moon seed 5). So the candidates are the colliders whose bounding boxes meet the
   *  capsule's (the broad phase, a superset) that stop a body; a box among them is decided exactly, in 64-bit, from the
   *  world model's bounds (a vertical capsule against an axis-aligned box: the distance from its core segment to the box
   *  under its radius), a mesh or hull by Rapier's intersection test (it errs only toward "does not fit") */
  private clearOf(shape: RCollider['shape'], radius: number, half: number, x: number, y: number, z: number): boolean {
    const P = this.p, E = this.e, B = this.bb;
    P.x = x; P.y = y; P.z = z; E.x = E.z = radius; E.y = half + radius;
    let clear = true;
    this.W.collidersWithAabbIntersectingAabb(P, E, (c: RCollider) => {
      const g = c.collisionGroups();
      if (!(((g >>> 16) & (this.groups & 0xffff)) && ((g & 0xffff) & (this.groups >>> 16)))) return true;
      if (this.boxOf(c.handle, B)) {
        const dx = Math.max(B[0] - x, 0, x - B[3]), dz = Math.max(B[2] - z, 0, z - B[5]), dy = Math.max(B[1] - (y + half), 0, (y - half) - B[4]);
        if (dx * dx + dy * dy + dz * dz < radius * radius) clear = false;
      } else if (shape.intersectsShape(P, ROT, c.shape, c.translation(), c.rotation())) clear = false;
      return clear;
    });
    return clear;
  }
  private readonly bb = new Float64Array(6);
  private readonly e = { x: 0, y: 0, z: 0 };
  /** the roll's slide: the highest world-model top it may roll over, and the predicate that leaves those boxes out */
  private rollTop = 0;
  private rollPred: ((c: RCollider) => boolean) | null = null;
  /** the capsule of the move being resolved */
  private cap: Capsule = { radius: 0, half: 0, lift: 0 };

  /** Is a body of footprint r and height h with its feet at (x, y, z) clear of everything that stops a body, its capsule
   *  shrunk by `shrink` m all round (a harness's overlap check: scripts/navwalk.ts on physics)? */
  clearAt(x: number, y: number, z: number, r: number, h: number, shrink: number): boolean {
    const cap = capsuleOf(r, h, this.rules.offset, this.rules.headMargin), R = this.R;
    const shape = cap.half > 0 ? new R.Capsule(cap.half, cap.radius - shrink) : new R.Ball(cap.radius - shrink);
    const clear = this.clearOf(shape, cap.radius - shrink, cap.half, x, y + cap.lift, z);
    (shape as unknown as { free?: () => void }).free?.();
    return clear;
  }

  /** Resolve one tick's move (see the header). Positions are kept as the feet (the tile model's y): a capsule's centre is
   *  its lift above them only for Rapier's calls, every distance Rapier returns moves the feet, and the support ray starts
   *  `probe` above the feet, so the support does not depend on the body's height */
  move(io: CharacterMove): void {
    this.stats.moves++;
    const { col, cap } = this.colliderFor(io.r, io.h), k = this.kcc, C = this.rules, off = C.offset, L = cap.lift, P = C.probe;
    this.cap = cap;
    this.p.x = io.x; this.p.y = io.y + L; this.p.z = io.z;
    col.setTranslation(this.p);
    // a supported body moves planar only and the support below sets it down (the tile model's planar move, then the
    // support). Rapier's controller asked to move a capsule that rests at its offset even slightly into the floor reads
    // the floor as hit at once and returns no movement at all (a dead stop on flat ground)
    this.v.x = io.dx; this.v.y = io.supported && io.dy < 0 ? 0 : io.dy; this.v.z = io.dz;
    k.computeColliderMovement(col, this.v, undefined, this.groups);
    // exact unless cut (ROADMAP F70): a move the controller met nothing on is the desired translation itself, in 64-bit
    // (its own answer is the f32 sum); a move it reports collisions on is its answer
    const n = k.numComputedCollisions();
    let nx: number, fy: number, nz: number, ground = k.computedGrounded();
    if (n === 0) { nx = io.x + io.dx; fy = io.y + this.v.y; nz = io.z + io.dz; }
    else { const m = k.computedMovement(); nx = io.x + m.x; fy = io.y + m.y; nz = io.z + m.z; }
    // a rising move cut by a ceiling: a collision with a surface that faces down (within the climb angle of straight down)
    io.ceiling = false;
    if (this.v.y > 0) for (let i = 0; i < n; i++) { const c = k.computedCollision(i); if (c && c.normal1.y <= -this.cosClimb) { io.ceiling = true; break; } }
    io.stepped = false;
    // the support under the axis at the start of a supported tick (the support rule below, and the roll)
    const s0 = io.supported ? this.under(io.x, io.y + P, io.z, P + io.stepUp + C.snap) : -Infinity;
    // The roll (ROADMAP F69): a supported move the controller cut, and the move of a body resting on an edge ahead of its
    // wish (its feet above the support under its axis: part way up a rise, or on a ramp, its round bottom on the edge),
    // goes the tick's own travel, lifted as little as fits. A body part way up holds its height where it fits there (the
    // support rule would set it down onto the edge it is rolling over by its skin, a fall back of up to a centimetre)
    const want = Math.sqrt(io.dx * io.dx + io.dz * io.dz);
    let rolled: number = ROLL.none, hold = false;
    if (io.supported && io.stepUp > 0 && want > 0 && (n > 0 || io.y > s0 + C.rest)) {
      // what it rests on: its feet when they stand on the support under its axis (within `rest` of it, the rest rule's
      // stand: a block edge it is pressed against is not what it rests on, though the controller's slide may have lifted
      // it a hair up the face); when they are higher (perched on an edge, part way up one, on a ramp), the top of what a
      // short cast down from its start meets under its round bottom's centre: on a diagonal staircase a wide body climbs
      // from block edge to block edge
      const perched = s0 > -Infinity && io.y > s0 + C.rest;
      this.cast(col, io.x, io.y + L, io.z, 0, -1, 0, C.snap, 0);
      const M = this.met, base = perched && M.y < io.y + L - cap.half ? M.top : io.y;
      hold = perched && (M.x - io.x) * io.dx + (M.z - io.z) * io.dz > 0;
      if (n > 0 || hold) rolled = this.roll(col, io, L, base, s0);
    }
    if (rolled !== ROLL.none) { nx = this.p.x; fy = this.p.y; nz = this.p.z; }
    if (rolled === ROLL.up) { ground = true; io.stepped = true; this.stats.steps++; }
    else if (rolled === ROLL.plain && hold) { ground = true; io.stepped = true; }
    // The support (ours; Rapier's snap is off: it set capsules 2–5 cm into a step's edge). The tile model's rule, at the
    // axis (ROADMAP F66): a supported body stays supported while its feet after the tick's gravity are less than the snap
    // above the support under its axis at the end (sim/locomotion.ts STICK: drops up to 0.3583 m are walked down, deeper
    // ones fall, the same for every size class), measured from the support under its axis at the start. Its capsule is
    // then set down by a shape cast onto what is under it: the floor under the axis, or the edge of the ledge its round
    // bottom rides down (the next ticks carry it off). Deeper, it leaves its support this tick and falls. The contact's own
    // slope does not decide it: a round bottom on a ledge's edge reads as a walkable slope until it has ridden 0.3 × its
    // radius down, which made Medium to Extra Large walk down 0.5 m and Extra Large 0.6 m (I1b's first cut)
    let falls = !io.supported;
    if (io.dy <= 0 && !io.stepped && io.supported) {
      const from = (s0 > -Infinity ? s0 : io.y) + io.dy, low = from - C.snap;
      const s1 = fy > low ? this.under(nx, fy + P, nz, fy + P - low) : -Infinity;
      if (s1 > -Infinity && from - s1 < C.snap) {
        const d = this.setDown(col, nx, fy + L, nz, Math.max(0, fy - s1) + off);
        if (d === d) fy -= d;
        ground = true;
      } else { ground = false; falls = true; }
    }
    // A falling body (and one that just left its support) lands only as the tile model lands it: on the floor under its
    // axis, on the tick its feet reach the floor's height (the world model's, exactly: ROADMAP F70), there and not a tick
    // early where the controller's offset cut the fall a hair above it. A ledge's edge that cuts the fall is not a landing
    // (the tile body falls past it, the footprint over the ledge): the capsule is carried clear by the least horizontal
    // shift that lets the tick's fall go on (its round bottom rolling off the edge), and falls on. Only where that shift
    // has no room does it land on the edge (perched)
    if (falls && io.dy <= 0) {
      const target = io.y + io.dy, ex = io.x + io.dx, ez = io.z + io.dz;
      ground = false; // not the controller's grounded: it calls a capsule on a ledge's edge grounded
      // a fall the controller met only floors on (every reported collision a stand): the floor does not cut the planar
      // move, and the tile model's landing decides the height against the support under the axis (feet at or below it
      // land on it, else the fall goes on), where the capsule fits there (not over a ledge's edge or on a ramp)
      let done = false;
      if (!io.supported && n > 0 && this.floorsOnly(n)) {
        const f = this.under(ex, io.y + P, ez, P + (io.y - target) + C.rest), yt = target > f ? target : f;
        if (this.fits(col, ex, yt + L, ez)) { nx = ex; fy = yt; nz = ez; ground = !(target > f); done = true; }
      }
      if (done) { /* landed or falling on, exactly */ } else if (fy > target) {
        const span = fy - target, d = this.cast(col, nx, fy + L, nz, 0, -1, 0, span);
        if (d < span) {
          const f = this.under(nx, fy + P, nz, P + span + off);
          if (this.onFloor(nx, nz, f)) {
            // the floor under the axis: the tile model's landing, as above, where the capsule fits at that height (a body
            // that just left its support, or a fall cut by more than floors); else (a ramp under its round bottom) it
            // lands on contact
            const yt = target > f ? target : f;
            if (this.fits(col, nx, yt + L, nz)) { fy = yt; ground = !(target > f); }
            else { fy -= d; ground = true; }
          } else {
            // a ledge's edge. Where the tick's own planar move, once more, takes the axis over a support higher than the
            // one under it now and at or above this tick's feet (a corner cut across the corner of a chasm or a drop: the
            // tile body falls one tick and lands back up there, its feet at or below that support), the capsule waits on
            // the edge, airborne, for that landing; else it rolls off
            const yt = f > -Infinity ? Math.max(target, f) : target;
            const ahead = this.under(nx + io.dx, fy + P, nz + io.dz, P + (fy - target));
            if (ahead > f && ahead >= target) { fy -= d; }
            else if (this.clearEdge(col, io.r, nx, fy + L, nz, yt + L)) { nx = this.p.x; fy = yt; nz = this.p.z; ground = f > -Infinity && yt <= f; }
            else { fy -= d; ground = true; }
          }
        } else fy = target;
      } else fy = target;
      // and, as the tile model lands a body (y ≤ support), when its feet end at or below the support under its axis
      if (!ground) {
        const f = this.under(nx, fy + P, nz, P + C.rest);
        if (f > -Infinity && fy <= f) ground = true;
      }
    }
    // stand exactly on the support under the axis when the feet end within `rest` of it (the world model's height: the
    // tile model's feet on its support), where the capsule fits there. It also lifts the dip Rapier lets a walking capsule
    // sink into its offset where two boxes meet (S1 §7 "Seams": 1 cm). A capsule on a ramp or rolling over an edge stands
    // where the controller left it
    if (ground && io.dy <= 0) {
      const f = this.under(nx, fy + P, nz, P + C.rest);
      if (f > -Infinity && Math.abs(fy - f) <= C.rest && this.fits(col, nx, f + L, nz)) fy = f;
    }
    io.x = nx; io.y = fy; io.z = nz; io.onGround = ground;
  }

  /** The roll (ROADMAP F69; the header's rules 1 and 2): `base` is the height of what the body rests on, `s0` the support
   *  under its axis at the start. The pose (feet) into this.p */
  private roll(col: RCollider, io: CharacterMove, L: number, base: number, s0: number): number {
    this.stats.tries++;
    const k = this.kcc, tol = this.rules.step.tolerance, off = this.rules.offset, reach = io.stepUp + 2 * off;
    const ex = io.x + io.dx, ez = io.z + io.dz;
    // where the capsule fits at its own height there is nothing to roll over: the controller's skin (its offset) cut the
    // move short of a face it has not reached, so the move is the desired one, plain (a body slower than the offset per
    // tick, 0.6 m/s, would otherwise stop short of every face for good)
    if (this.fits(col, ex, io.y + L, ez)) { this.p.x = ex; this.p.y = io.y; this.p.z = ez; return ROLL.plain; }
    // the carry in the plane: the controller's own planar move at the body's height, with what it may roll over left out
    // (every box whose world-model top is within the step of what it rests on): it slides at its full radius along what
    // stands higher than the step (a corner where a higher block meets the rise: the tile footprint glides off the
    // higher block as it steps up) and is the wish itself where it meets nothing else
    this.rollTop = base + io.stepUp + tol;
    this.v.x = io.dx; this.v.y = 0; this.v.z = io.dz;
    k.computeColliderMovement(col, this.v, undefined, this.groups, this.rollPred ??= (c: RCollider) => !(this.boxOf(c.handle, this.bb) && this.bb[4] <= this.rollTop));
    let tx = ex, tz = ez;
    if (k.numComputedCollisions() > 0) { const m = k.computedMovement(); tx = io.x + m.x; tz = io.z + m.z; }
    // lift the capsule by the step height plus two offsets (a ceiling cuts it short; keep 0: a body pressed against the
    // face is inside the offset of it, where a cast keeping the offset stops at once), carry it there (a slab overhead
    // refuses it), and set it down on what is under it
    const lift = this.cast(col, io.x, io.y + L, io.z, 0, 1, 0, reach, 0);
    const ly = io.y + lift, cx = tx - io.x, cz = tz - io.z, cl = Math.sqrt(cx * cx + cz * cz);
    if (cl > 0 && this.cast(col, io.x, ly + L, io.z, cx / cl, 0, cz / cl, cl) < cl) return ROLL.none;
    const drop = this.cast(col, tx, ly + L, tz, 0, -1, 0, lift + 2 * off);
    // what it lands on must be a rise (higher than the support under its axis at the start: a slide along a wall sets it
    // back on its own floor, and that is the controller's answer) no more than the step above what it rested on
    const top = this.met.top;
    if (!(drop < lift + 2 * off) || !(top > s0) || top - base > io.stepUp + tol) return ROLL.none;
    const fy = ly - drop;
    if (!(fy > io.y) || !this.fits(col, tx, fy + L, tz)) return ROLL.none; // a roll lifts the body
    this.p.x = tx; this.p.y = fy; this.p.z = tz;
    return ROLL.up;
  }

  /** Set a capsule (centre at x, y, z) down by a shape cast up to `max` m: the distance, backed off by the offset up to
   *  `backoff` times until it fits (a cast grazing an edge on its way down can stop past contact, ROADMAP F58), or NaN
   *  when it fits nowhere */
  private setDown(col: RCollider, x: number, y: number, z: number, max: number): number {
    let d = this.cast(col, x, y, z, 0, -1, 0, max);
    if (d > 1e-3) {
      let k = 0;
      while (k <= this.rules.backoff && !this.fits(col, x, y - d, z)) { d = Math.max(0, d - this.rules.offset); k++; }
      if (k > this.rules.backoff) return NaN;
    }
    return d;
  }

  /** Carry a capsule off the ledge edge the last cast met: the least horizontal shift away from the contact (toward and
   *  past its axis, up to footprint r + margin) at which it fits with its centre at height `yt`, the path clear at its
   *  current height y (no offset kept on the path: it starts resting on the edge). The pose into this.p; false when
   *  there is no room */
  private clearEdge(col: RCollider, r: number, x: number, y: number, z: number, yt: number): boolean {
    // away from the edge: from the ring of supports 0.9 r round the axis, the samples that stand at the edge's height
    // (within `edge`) point at the ledge; the push is against their sum. A contact's own witness and normal are noisy
    // where the round bottom barely overhangs the edge (centimetres along it)
    const M = this.met, top = M.y - this.rules.edge, rho = 0.9 * r, drop = y - top;
    let ux = 0, uz = 0;
    for (let i = 0; i < 8; i++) {
      const [cx, cz] = RING[i];
      if (this.under(x + cx * rho, y, z + cz * rho, drop) > -Infinity) { ux -= cx; uz -= cz; }
    }
    let l = Math.sqrt(ux * ux + uz * uz);
    if (!(l > 1e-6)) { ux = x - M.x; uz = z - M.z; l = Math.sqrt(ux * ux + uz * uz); }
    if (!(l > 1e-6)) return false;
    ux /= l; uz /= l;
    const far = r + this.rules.step.margin, px = x + ux * far, pz = z + uz * far;
    if (!this.fits(col, px, yt, pz)) return false;
    const s = far - this.cast(col, px, yt, pz, -ux, 0, -uz, far);
    if (this.cast(col, x, y, z, ux, 0, uz, s, 0) < s) return false;
    this.p.x = x + ux * s; this.p.y = yt; this.p.z = z + uz * s;
    return true;
  }
}
