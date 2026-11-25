// The character controller (task I1b; docs/OVERHAUL_3D.md "Division of responsibilities", docs/LOCOMOTION.md
// "Resolvers"): Rapier's kinematic character controller resolves one tick's translation of a partner's body against
// the static world (slide, snap to the ground, slope limits), and our own step rule resolves rises up to the step height
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
// The step rule (a supported move that came up short against a face, our own, S1 manualstep.ts reworked):
//   1 lift the capsule by the step height plus two offsets (a ceiling cuts it short);
//   2 carry it along the face's inward normal until its centre is `margin` past the face (radius + margin; a wall
//     further on cuts it short); when that carry does not end on a stand (step 3), the same carry turned 45° to the side
//     the wish leans to, then 45° to the other (a corner where a higher block meets the step: the tile maps' diagonal
//     staircases, where the tile footprint glides off the higher block and the capsule must step beside it);
//   3 set it down, and stand it there only when what it lands on is a stand: the capsule's own contact normal within the
//     climb angle (a flat top, or a block's edge under its round bottom that the controller will ride up next), and the
//     contact point between `minRise` and the step height (+ `tolerance`) above what it started the tick resting on (the
//     contact a short cast down from its start meets: a floor, a ramp, or the edge of a block it is perched on; else its
//     feet). Contact to contact, not feet to feet: a wide capsule climbs the location maps' diagonal staircases perched on
//     block edges (it cannot stand in a block lower than its feet as the tile footprint does, so it rests on the highest
//     one under it), and a capsule the controller rode part way up a block's edge (it climbs a lip lower than about
//     0.3 × its radius as a slope) rests on that block and has no rise left to step; a perch on the edge of a block
//     higher than the step is refused, so riding up an edge never adds up past the step (S1's over-climb), and the
//     millimetres a capsule sinks into its offset while it slides along a face are not counted. Else the plain move
//     stands.
// The carry is what makes it hold at every speed and angle: the centre lands on the top (or close enough over an edge
// to ride it), not perched on the edge's far side (S1's partial rule moved only the tick's own wish forward, so slow and
// 45° approaches perched and fell back). A step is therefore a hop of up to the step height and radius + margin in one
// tick. A tile corner where several blocks meet (the location maps' diagonal staircases) lands on an edge of the higher
// block within reach, which the next plain moves ride up.
//
// After the move and the step: the support (the tile model's stick at the axis: a supported body stays supported while
// the support under its axis drops less than `snap` plus the tick's gravity, every class alike; ROADMAP F66), the
// landing (on the floor under the axis; a ledge's edge that cuts a fall is rolled off, not landed on) and the rest (feet
// exactly on supportBelow's height when within `rest` of it): docs/LOCOMOTION.md "Resolvers" rules 4 to 6.
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
  step: { margin: number; tolerance: number; minRise: number; short: number };
}

/** the support under a point (PhysicsWorld's supportBelow over what stops a body): the top of the first solid within
 *  `drop` m below (x, y, z), or -Infinity */
export type SupportFn = (x: number, y: number, z: number, drop: number) => number;

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
  /** m: the rise the step rule may climb this tick (0: none) */
  stepUp: number;
  /** the body was supported at the start of the tick and is not taking off (the step rule runs only then) */
  supported: boolean;
  /** out: the controller found a floor under it */
  onGround: boolean;
  /** out: a rising move was cut short by something overhead */
  ceiling: boolean;
  /** out: the step rule climbed a rise this tick */
  stepped: boolean;
}

const UP = { x: 0, y: 1, z: 0 }, ROT = { x: 0, y: 0, z: 0, w: 1 };
/** the eight compass directions (cos = sin = √½ on the diagonals, no trigonometry) */
const H = Math.SQRT1_2;
const RING: readonly [number, number][] = [[1, 0], [H, H], [0, 1], [-H, H], [-1, 0], [-H, -H], [0, -1], [H, -H]];

/** The controller of one physics world: Rapier's character controller with autostep off, the capsule colliders, the
 *  step rule. Owned by its PhysicsWorld (freed with its Rapier world). */
export class CharacterKit {
  private readonly kcc: KCC;
  private readonly cols = new Map<string, { col: RCollider; cap: Capsule }>();
  private readonly cosClimb: number;
  private readonly v = { x: 0, y: 0, z: 0 };
  private readonly p = { x: 0, y: 0, z: 0 };
  /** counters for the perf report and the stepping test: moves resolved, steps climbed, step attempts, casts */
  readonly stats = { moves: 0, steps: 0, tries: 0, casts: 0 };

  constructor(private readonly R: Rapier, private readonly W: RWorld, private readonly rules: ControllerRules, private readonly groups: number, private readonly support: SupportFn, handles?: [string, number][]) {
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

  /** what the last cast met: the contact point on the obstacle, and the capsule's own outward normal there reversed (the
   *  obstacle's surface normal at the contact; `up` its y: 1 on a flat floor) */
  private readonly met = { x: NaN, y: NaN, z: NaN, nx: NaN, up: NaN, nz: NaN };

  /** a capsule cast from p along unit d up to `max` m (offset kept from what it meets); its distance, or max when clear
   *  (this.met: the contact, NaN when clear) */
  private cast(col: RCollider, px: number, py: number, pz: number, dx: number, dy: number, dz: number, max: number, keep = this.rules.offset): number {
    this.stats.casts++;
    this.p.x = px; this.p.y = py; this.p.z = pz; this.v.x = dx; this.v.y = dy; this.v.z = dz;
    const hit = this.W.castShape(this.p, ROT, this.v, col.shape, keep, max, false, undefined, this.groups);
    const M = this.met;
    if (!hit) { M.x = M.y = M.z = M.nx = M.up = M.nz = NaN; return max; }
    // normal2 is the capsule's outward normal at its contact: straight down (−1) on a flat floor
    const w = hit.witness1, n = hit.normal2;
    M.x = w.x; M.y = w.y; M.z = w.z; M.nx = -n.x; M.up = -n.y; M.nz = -n.z;
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

  /** the capsule fits at (x, y, z) (its centre): it meets nothing that stops a body */
  private fits(col: RCollider, x: number, y: number, z: number): boolean {
    this.stats.casts++;
    this.p.x = x; this.p.y = y; this.p.z = z;
    return !this.W.intersectionWithShape(this.p, ROT, col.shape, undefined, this.groups);
  }

  /** Is a body of footprint r and height h with its feet at (x, y, z) clear of everything that stops a body, its capsule
   *  shrunk by `shrink` m all round (a harness's overlap check: scripts/navwalk.ts on physics)? */
  clearAt(x: number, y: number, z: number, r: number, h: number, shrink: number): boolean {
    const cap = capsuleOf(r, h, this.rules.offset, this.rules.headMargin), R = this.R;
    const shape = cap.half > 0 ? new R.Capsule(cap.half, cap.radius - shrink) : new R.Ball(cap.radius - shrink);
    this.p.x = x; this.p.y = y + cap.lift; this.p.z = z;
    const hit = this.W.intersectionWithShape(this.p, ROT, shape, undefined, this.groups);
    (shape as unknown as { free?: () => void }).free?.();
    return !hit;
  }

  /** Resolve one tick's move (see the header). Positions are kept as the feet (the tile model's y): a capsule's centre is
   *  its lift above them only for Rapier's calls, every distance Rapier returns moves the feet, and the support ray starts
   *  `probe` above the feet, so where nothing overhead meets them two bodies of one footprint and different heights end a
   *  tick on the same bit (tests/locomotion.test.ts "one body, two callers" on the flag) */
  move(io: CharacterMove): void {
    this.stats.moves++;
    const { col, cap } = this.colliderFor(io.r, io.h), k = this.kcc, C = this.rules, S = C.step, off = C.offset, L = cap.lift, P = C.probe;
    this.p.x = io.x; this.p.y = io.y + L; this.p.z = io.z;
    col.setTranslation(this.p);
    // a supported body moves planar only and the support below sets it down (the tile model's planar move, then the
    // support). Rapier's controller asked to move a capsule that rests at its offset even slightly into the floor reads
    // the floor as hit at once and returns no movement at all (a dead stop on flat ground)
    this.v.x = io.dx; this.v.y = io.supported && io.dy < 0 ? 0 : io.dy; this.v.z = io.dz;
    k.computeColliderMovement(col, this.v, undefined, this.groups);
    const m = k.computedMovement();
    let nx = io.x + m.x, fy = io.y + m.y, nz = io.z + m.z, ground = k.computedGrounded();
    io.ceiling = this.v.y > 0 && m.y < this.v.y - 1e-4;
    io.stepped = false;
    const want = Math.sqrt(io.dx * io.dx + io.dz * io.dz), got = Math.sqrt(m.x * m.x + m.z * m.z);
    if (io.supported && io.stepUp > 0 && want > 1e-6 && got < want * S.short) {
      this.stats.tries++;
      // the face that stopped it: the steepest contact against the wish, else the wish itself
      let ux = io.dx / want, uz = io.dz / want;
      for (let i = 0, n = k.numComputedCollisions(); i < n; i++) {
        const c = k.computedCollision(i);
        if (!c) continue;
        const nn = c.normal1, l = Math.sqrt(nn.x * nn.x + nn.z * nn.z);
        if (nn.y < this.cosClimb && l > 1e-6 && nn.x * io.dx + nn.z * io.dz < 0) { ux = -nn.x / l; uz = -nn.z / l; break; }
      }
      const lift = this.cast(col, nx, fy + L, nz, 0, 1, 0, io.stepUp + 2 * off);
      if (lift >= S.minRise) {
        const reach = io.r + S.margin, ly = fy + lift;
        // what it started the tick resting on: a short cast down from its start to the contact itself (a floor, a ramp, or
        // the edge of a block it is perched on), taken only when that is a stand (a face it is pressed against is not what
        // it rests on); else its feet
        this.cast(col, io.x, io.y + L, io.z, 0, -1, 0, C.snap, 0);
        const base = this.met.up >= this.cosClimb ? this.met.y : io.y;
        // the side the wish leans to, across the face's normal (+1: turn the carry counter-clockwise first)
        const side = ux * io.dz - uz * io.dx >= 0 ? 1 : -1;
        for (let c = 0; c < 3; c++) {
          // the carry along the normal, then turned ±45° (cos = sin = √½, no trigonometry)
          const ca = c === 0 ? 1 : Math.SQRT1_2, sa = c === 0 ? 0 : (c === 1 ? side : -side) * Math.SQRT1_2;
          const vx = ux * ca - uz * sa, vz = ux * sa + uz * ca;
          const f = this.cast(col, nx, ly + L, nz, vx, 0, vz, reach);
          const fx = nx + vx * f, fz = nz + vz * f;
          const drop = this.cast(col, fx, ly + L, fz, 0, -1, 0, lift + 2 * off), top = this.met.y, stand = this.met.up >= this.cosClimb;
          const rise = top - base;
          if (drop < lift + 2 * off && stand && rise >= S.minRise && rise <= io.stepUp + S.tolerance && this.fits(col, fx, ly - drop + L, fz)) {
            nx = fx; fy = ly - drop; nz = fz; ground = true; io.stepped = true; this.stats.steps++;
            break;
          }
        }
      }
    }
    // The support (ours; Rapier's snap is off: it set capsules 2–5 cm into a step's edge). The tile model's rule, at the
    // axis (ROADMAP F66): a supported body stays supported while the support under its axis at the end of the tick is
    // less than the snap below the support under its axis at the start, after the tick's gravity (sim/locomotion.ts
    // STICK: drops up to 0.3583 m are walked down, deeper ones fall, the same for every size class). Its capsule is then
    // set down by a shape cast onto what is under it: the floor under the axis, or the edge of the ledge its round bottom
    // rides down (the next ticks carry it off). Deeper, it leaves its support this tick and falls. The contact's own
    // slope does not decide it: a round bottom on a ledge's edge reads as a walkable slope until it has ridden 0.3 × its
    // radius down, which made Medium to Extra Large walk down 0.5 m and Extra Large 0.6 m (I1b's first cut)
    let falls = !io.supported;
    if (io.dy <= 0 && !io.stepped && io.supported) {
      const s0 = this.under(io.x, io.y + P, io.z, P + io.stepUp + C.snap);
      const low = (s0 > -Infinity ? s0 : io.y) + io.dy - C.snap;
      const s1 = fy > low ? this.under(nx, fy + P, nz, fy + P - low) : -Infinity;
      if (s1 > low) {
        const d = this.setDown(col, nx, fy + L, nz, Math.max(0, fy - s1) + off);
        if (d === d) fy -= d;
        ground = true;
      } else { ground = false; falls = true; }
    }
    // A falling body (and one that just left its support) lands only as the tile model lands it: on the floor under its
    // axis, on the tick its fall reaches it (the controller cut the fall short there). A ledge's edge that cuts the fall
    // is not a landing (the tile body falls past it, the footprint over the ledge): the capsule is carried clear by the
    // least horizontal shift that lets the tick's fall go on (its round bottom rolling off the edge), and falls on.
    // Only where that shift has no room does it land on the edge (perched)
    if (falls && io.dy <= 0) {
      const target = io.y + io.dy;
      ground = false; // not the controller's grounded: it calls a capsule on a ledge's edge grounded
      if (fy > target + 1e-6) {
        const d = this.cast(col, nx, fy + L, nz, 0, -1, 0, fy - target);
        if (d < fy - target) {
          const f = this.under(nx, fy + P, nz, P + (fy - target) + off);
          if (this.onFloor(nx, nz, f)) { fy -= d; ground = true; }
          else {
            const yt = f > -Infinity ? Math.max(target, f) : target;
            if (this.clearEdge(col, io.r, nx, fy + L, nz, yt + L)) { nx = this.p.x; fy = yt; nz = this.p.z; ground = f > -Infinity && yt <= f; }
            else { fy -= d; ground = true; }
          }
        } else fy = target;
      }
      // and, as the tile model lands a body (y ≤ support), when its feet end at or below the support under its axis:
      // Rapier's controller lets the shape come within its offset of the floor without cutting the move
      if (!ground) {
        const f = this.under(nx, fy + P, nz, P + C.rest);
        if (f > -Infinity && fy <= f) ground = true;
      }
    }
    // stand exactly on the support under the axis when the feet end within `rest` of it (the height supportBelow
    // returns: the tile model's feet on its support), where the capsule fits there. It also lifts the dip Rapier lets a
    // walking capsule sink into its offset where two boxes meet (S1 §7 "Seams": 1 cm). A capsule on a ramp or perched on
    // an edge stands where the controller left it
    if (ground && io.dy <= 0) {
      const f = this.under(nx, fy + P, nz, P + C.rest);
      if (f > -Infinity && Math.abs(fy - f) <= C.rest && this.fits(col, nx, f + L, nz)) fy = f;
    }
    io.x = nx; io.y = fy; io.z = nz; io.onGround = ground;
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
