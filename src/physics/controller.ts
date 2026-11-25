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
  step: { margin: number; tolerance: number; minRise: number; short: number };
}

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
/** m: a grounded body is seated from this far above where the controller left it */
const SEAT = 0.02;

/** The controller of one physics world: Rapier's character controller with autostep off, the capsule colliders, the
 *  step rule. Owned by its PhysicsWorld (freed with its Rapier world). */
export class CharacterKit {
  private readonly kcc: KCC;
  private readonly cols = new Map<string, { col: RCollider; cap: Capsule }>();
  private readonly cosClimb: number;
  private readonly v = { x: 0, y: 0, z: 0 };
  private readonly ray: InstanceType<Rapier['Ray']>;
  private readonly p = { x: 0, y: 0, z: 0 };
  /** counters for the perf report and the stepping test: moves resolved, steps climbed, step attempts, casts */
  readonly stats = { moves: 0, steps: 0, tries: 0, casts: 0 };

  constructor(private readonly R: Rapier, private readonly W: RWorld, private readonly rules: ControllerRules, private readonly groups: number, handles?: [string, number][]) {
    const k = W.createCharacterController(rules.offset);
    k.setUp(UP);
    k.disableAutostep();
    k.disableSnapToGround(); // ours (move): Rapier's set capsules into step edges
    k.setMaxSlopeClimbAngle((rules.maxSlopeDeg * Math.PI) / 180);
    k.setMinSlopeSlideAngle((rules.minSlideDeg * Math.PI) / 180);
    k.setSlideEnabled(true);
    this.kcc = k;
    this.ray = new R.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 });
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
      const cap = capsuleOf(r, h, this.rules.offset, this.rules.headMargin), R = this.R;
      const desc = cap.half > 0 ? R.ColliderDesc.capsule(cap.half, cap.radius) : R.ColliderDesc.ball(cap.radius);
      desc.setCollisionGroups(0).setSensor(true);
      c = { col: this.W.createCollider(desc), cap };
      this.cols.set(key, c);
    }
    return c;
  }

  /** what the last cast met: the contact point's height on the obstacle, and the capsule's own outward normal there */
  private readonly met = { y: NaN, up: NaN };

  /** a capsule cast from p along unit d up to `max` m (offset kept from what it meets); its distance, or max when clear
   *  (this.met: the contact, NaN when clear) */
  private cast(col: RCollider, px: number, py: number, pz: number, dx: number, dy: number, dz: number, max: number, keep = this.rules.offset): number {
    this.stats.casts++;
    this.p.x = px; this.p.y = py; this.p.z = pz; this.v.x = dx; this.v.y = dy; this.v.z = dz;
    const hit = this.W.castShape(this.p, ROT, this.v, col.shape, keep, max, false, undefined, this.groups);
    if (!hit) { this.met.y = this.met.up = NaN; return max; }
    // normal2 is the capsule's outward normal at its contact: straight down (−1) on a flat floor
    this.met.y = hit.witness1.y; this.met.up = -hit.normal2.y;
    return Math.max(0, hit.time_of_impact);
  }

  /** the walkable face straight below (x, y, z) within `max` m: its height, or NaN (none, or too steep to stand on) */
  private floorBelow(x: number, y: number, z: number, max: number): number {
    this.stats.casts++;
    this.p.x = x; this.p.y = y; this.p.z = z;
    this.ray.origin = this.p;
    const hit = this.W.castRayAndGetNormal(this.ray, max, true, undefined, this.groups);
    return hit && hit.normal.y >= this.cosClimb ? y - hit.timeOfImpact : NaN;
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

  /** Resolve one tick's move (see the header). */
  move(io: CharacterMove): void {
    this.stats.moves++;
    const { col, cap } = this.colliderFor(io.r, io.h), k = this.kcc;
    const cy = io.y + cap.lift;
    this.p.x = io.x; this.p.y = cy; this.p.z = io.z;
    col.setTranslation(this.p);
    // a supported body moves planar only and the snap below sets it down (the tile model's planar move, then the support).
    // Rapier's controller asked to move a capsule that rests at its offset even slightly into the floor reads the floor
    // as hit at once and returns no movement at all (a dead stop on flat ground)
    this.v.x = io.dx; this.v.y = io.supported && io.dy < 0 ? 0 : io.dy; this.v.z = io.dz;
    k.computeColliderMovement(col, this.v, undefined, this.groups);
    const m = k.computedMovement();
    let nx = io.x + m.x, ny = cy + m.y, nz = io.z + m.z, ground = k.computedGrounded();
    io.ceiling = this.v.y > 0 && m.y < this.v.y - 1e-4;
    io.stepped = false;
    const want = Math.sqrt(io.dx * io.dx + io.dz * io.dz), got = Math.sqrt(m.x * m.x + m.z * m.z);
    if (io.supported && io.stepUp > 0 && want > 1e-6 && got < want * this.rules.step.short) {
      this.stats.tries++;
      // the face that stopped it: the steepest contact against the wish, else the wish itself
      let ux = io.dx / want, uz = io.dz / want;
      for (let i = 0, n = k.numComputedCollisions(); i < n; i++) {
        const c = k.computedCollision(i);
        if (!c) continue;
        const nn = c.normal1, l = Math.sqrt(nn.x * nn.x + nn.z * nn.z);
        if (nn.y < this.cosClimb && l > 1e-6 && nn.x * io.dx + nn.z * io.dz < 0) { ux = -nn.x / l; uz = -nn.z / l; break; }
      }
      const S = this.rules.step, off = this.rules.offset;
      const lift = this.cast(col, nx, ny, nz, 0, 1, 0, io.stepUp + 2 * off);
      if (lift >= S.minRise) {
        const reach = io.r + S.margin, ly = ny + lift;
        // what it started the tick resting on: a short cast down from its start to the contact itself (a floor, a ramp, or
        // the edge of a block it is perched on), taken only when that is a stand (a face it is pressed against is not what
        // it rests on); else its feet
        this.cast(col, io.x, cy, io.z, 0, -1, 0, this.rules.snap, 0);
        const base = this.met.up >= this.cosClimb ? this.met.y : io.y;
        // the side the wish leans to, across the face's normal (+1: turn the carry counter-clockwise first)
        const side = ux * io.dz - uz * io.dx >= 0 ? 1 : -1;
        for (let c = 0; c < 3; c++) {
          // the carry along the normal, then turned ±45° (cos = sin = √½, no trigonometry)
          const ca = c === 0 ? 1 : Math.SQRT1_2, sa = c === 0 ? 0 : (c === 1 ? side : -side) * Math.SQRT1_2;
          const vx = ux * ca - uz * sa, vz = ux * sa + uz * ca;
          const f = this.cast(col, nx, ly, nz, vx, 0, vz, reach);
          const fx = nx + vx * f, fz = nz + vz * f;
          const drop = this.cast(col, fx, ly, fz, 0, -1, 0, lift + 2 * off), top = this.met.y, stand = this.met.up >= this.cosClimb;
          const rise = top - base;
          if (drop < lift + 2 * off && stand && rise >= S.minRise && rise <= io.stepUp + S.tolerance && this.fits(col, fx, ly - drop, fz)) {
            nx = fx; ny = ly - drop; nz = fz; ground = true; io.stepped = true; this.stats.steps++;
            break;
          }
        }
      }
    }
    // the snap (ours, not Rapier's: its snap-to-ground set capsules 2–5 cm into a step's edge as they walked down a tile
    // staircase): a body supported at the start of the tick, or one the controller calls grounded, is set down on what
    // is under it within the snap distance, by a shape cast from where the controller left it. It stays supported when
    // the capsule's contact there is a stand (a flat top, or an edge within the climb angle), or when it rides a ledge's
    // edge down with a floor under its axis within the snap (the tile model's stick: a body walking off a 0.3 m ledge
    // never leaves the ground); else it leaves its support (a deeper drop falls). A falling body lands only as the tile
    // model lands it: when its fall was cut short this tick (it reached the floor) or it ends touching (the controller
    // calls it grounded up to a few centimetres early, a tick before the tile model would)
    const cut = m.y > this.v.y + 1e-6;
    if (io.dy <= 0 && !io.stepped && (io.supported || ground)) {
      const snap = this.rules.snap;
      let d = this.cast(col, nx, ny, nz, 0, -1, 0, snap);
      if (!io.supported && !cut && d > this.rules.offset / 2) d = snap; // still falling: no landing yet
      // a cast grazing an edge on its way down can stop centimetres past contact (ROADMAP F58): a set-down of more than a
      // millimetre is taken only to a pose the capsule fits, backing off up to three offsets
      if (d < snap && d > 1e-3) {
        let k = 0;
        while (k < 4 && !this.fits(col, nx, ny - d, nz)) { d = Math.max(0, d - this.rules.offset); k++; }
        if (k === 4) d = snap; // nothing it fits on: no set-down
      }
      if (d < snap) {
        ny -= d;
        let f = NaN;
        ground = this.met.up >= this.cosClimb || ((f = this.floorBelow(nx, ny, nz, cap.lift + snap)), f === f);
      } else ground = false;
    }
    // seat a grounded body that dipped into its offset: the controller lets a walking capsule sink up to its offset into
    // the floor where two boxes meet (S1 §7 "Seams": 1 cm). Measured from SEAT above, down to the contact itself (no
    // offset kept: a face it is pressed against, within its offset, must not stop the cast); lifted back by the dip, and
    // only into free room (a head pressed under a slab's edge keeps where it is). Only a dip over half the offset: the
    // controller's own millimetre of play is left alone (seated exactly at its offset it can read itself as touching and
    // refuse a slow move)
    if (ground && io.dy <= 0) {
      const d = this.cast(col, nx, ny + SEAT, nz, 0, -1, 0, SEAT + this.rules.offset, 0);
      const up = SEAT - d + this.rules.offset, feet = ny - cap.lift;
      // a floor it stands in: a stand contact no higher than the dip above its feet (a face it slides along is not one)
      const floor = this.met.up >= this.cosClimb && this.met.y - feet <= this.rules.offset * 1.5;
      if (d < SEAT + this.rules.offset && floor && up > this.rules.offset / 2) ny += this.cast(col, nx, ny, nz, 0, 1, 0, Math.min(up, this.rules.offset * 1.5));
    }
    io.x = nx; io.y = ny - cap.lift; io.z = nz; io.onGround = ground;
  }
}
