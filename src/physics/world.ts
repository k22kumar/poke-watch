// The physics world (task I1a; docs/OVERHAUL_3D.md "Division of responsibilities", docs/spikes/S1-physics.md): one
// Rapier World per loaded map, built from a WorldModel's static colliders, answering the world half of the sim's
// queries (rays, swept upright cylinders, overlaps, the support below a point, the liquid at a point). Actors are not
// Rapier bodies (owner O2): hits on enemies, partners and bodies stay in sim/spatial.ts's actor broad phase, which calls
// this for its world contact. Movement stays on the tile World until I1b.
//
// What a collider is to a query. Every collider carries
//   kind   one world kind bit (world/sight.ts SK: bounds, wall, deck, terrain, liquid), its collision-group membership:
//          a query's kind mask is its filter, so a mask without decks never meets a deck
//   modes  the query modes it stops, its collision-group filter (the other half of Rapier's two-sided group test). A
//          query's mode is one of eight: what it is stopped by (STOPS.shots or STOPS.sight; WORLDGEN3D Q15.4 keeps them
//          apart though the adapter sets blocksSight = blocksShots today) × QF.foliage (foliage is open air) × QF.tops
//          (wall props end at their measured tops; see the sim's bridge, sim/physseam.ts). A collider stops a mode when it
//          blocks that mode's stopper (blocksShots / blocksSight), or when it is foliage and the mode does not open
//          foliage (legacy cover: without QF.foliage every query treats foliage as solid, sim/spatial.ts header)
// so one Rapier group test decides "kind in mask and solid in this mode", with no filter callback on the common path.
//
// Liquids (WorldModel volumes of kind 'liquid') and the map edge are query-only colliders (Rapier sensors, so I1b's
// controller can exclude them): a liquid stops a query whose mask has SK.liquid at its surface, as the tile column
// does; the edge is four tall slabs around the model's bounds. Callers may add query-only boxes and hulls of their own
// (BuildExtra: the tile bridge adds the column model's pieces the adapter's colliders leave out).
//
// Conventions (the sim's RayHit; docs/OVERHAUL_3D.md "World seam" Q10): t along a unit direction in metres, the point at
// o + d·t (a sweep's centre at contact, not the witness), the outward normal of the surface entered, the kind, the
// collider index as id, CF.block. A start inside a solid is a t = 0 contact with normal −d and CF.initial;
// QF.skipInitialWorld ignores every collider containing the start and meets the next. Rapier's sets are closed and
// its geometry is f32 (tests/physics-parity.test.ts lists what that changes against the tile model).
//
// Ownership (S1 §6, owner O7): this module owns every Rapier object; the sim holds plain numbers. dispose() frees the
// World (bodies, colliders and their raw objects with it); a restored snapshot is a new PhysicsWorld to dispose too.
// Scratch: one Ray and one cylinder per world, so a query allocates only the bindings' own per-call objects.

import { rapier, type Rapier } from './rapier';
import { SK, CF, QF, RayHit, RANK } from '../world/sight';
import type { ColliderBase, WorldModel } from '../world/model';

type RWorld = InstanceType<Rapier['World']>;
type RCollider = InstanceType<Rapier['Collider']>;
type RShape = InstanceType<Rapier['Shape']>;

/** what stops a query: shots (blocksShots) or sight (blocksSight) */
export const STOPS = { shots: 0, sight: 1 } as const;
export type Stops = typeof STOPS[keyof typeof STOPS];

/** the query mode index of a stopper and QF flags: bit 0 sight, bit 1 foliage open, bit 2 wall tops */
export function modeOf(stops: number, flags: number): number {
  return (stops & 1) | (flags & QF.foliage ? 2 : 0) | (flags & QF.tops ? 4 : 0);
}
/** every mode */
export const MODES_ALL = 0xff;
/** the modes without QF.tops (a wall prop's column above its top stops these) */
export const MODES_UNTOPPED = (() => { let m = 0; for (let i = 0; i < 8; i++) if (!(i & 4)) m |= 1 << i; return m; })();
/** the modes with QF.foliage (the ground under a foliage wall stops these; foliage itself does not) */
export const MODES_FOLIAGE_OPEN = (() => { let m = 0; for (let i = 0; i < 8; i++) if (i & 2) m |= 1 << i; return m; })();

/** the modes a collider with these flags stops */
export function modesOf(blocksShots: boolean, blocksSight: boolean, foliage: boolean): number {
  let m = 0;
  for (let i = 0; i < 8; i++) {
    const solid = (i & 1 ? blocksSight : blocksShots) || (foliage && !(i & 2));
    if (solid) m |= 1 << i;
  }
  return m;
}
/** a model collider's blocksSight: the field WM2 adds when present, else blocksShots (the adapter's equal flags) */
export const blocksSightOf = (c: ColliderBase): boolean => (c as ColliderBase & { blocksSight?: boolean }).blocksSight ?? c.blocksShots;

/** a query-only piece the caller adds: an axis-aligned box or a convex hull (xyz triples) */
export interface ExtraPiece {
  min?: [number, number, number]; max?: [number, number, number];
  hull?: Float32Array;
  kind: number;
  /** the modes it stops (MODES_* bits) */
  modes: number;
}
export interface BuildExtra {
  /** the world kind (SK bit) of each model collider, by index; default SK.terrain */
  kinds?: Uint8Array;
  /** query-only additions */
  pieces?: ExtraPiece[];
}

/** how tall the edge slabs reach past the model's bounds (m) */
export const EDGE_PAD = 64;
/** how thick the edge slabs are (m) */
const EDGE_THICK = 16;
/** liquid ids (sim/worldquery.ts liquidContact) */
const LIQUID = { tide: 1, blaze: 2 } as Record<string, number>;

/** the plain per-collider record (index = id) */
interface Meta {
  kind: Uint8Array;
  /** query-only (sensor) */
  sensor: Uint8Array;
  /** f64 box bounds (NaN for a mesh or hull): strict containment tests */
  lo: Float64Array; hi: Float64Array;
  /** liquids: the surface level and the liquid id */
  level: Float64Array; liquid: Uint8Array;
}

const UNIT_ROT = { x: 0, y: 0, z: 0, w: 1 };

export class PhysicsWorld {
  /** the Rapier world (src/physics only) */
  private W: RWorld | null;
  private readonly R: Rapier;
  private readonly meta: Meta;
  private readonly byHandle: Map<number, number>;
  readonly colliders: number;
  /** the source map (WorldModel meta.source) */
  readonly source: string;
  /** counters for the perf report (queries asked, Rapier casts made, and with a profiling clock the ms spent in them) */
  readonly stats = { queries: 0, casts: 0, ms: 0 };
  /** a timing clock for the perf report (scripts/perf-sim.ts --physics rapier); null in the game: no clock is read */
  static clock: (() => number) | null = null;
  /** liquidAt's surface level, when it found one */
  level = -Infinity;
  private readonly ray: InstanceType<Rapier['Ray']>;
  private readonly cyl = new Map<string, RShape>();
  private readonly skip = new Set<number>();
  private readonly skipFn = (c: RCollider) => !this.skip.has(c.handle);
  private readonly vo = { x: 0, y: 0, z: 0 };
  private readonly vd = { x: 0, y: 0, z: 0 };

  private constructor(R: Rapier, W: RWorld, meta: Meta, byHandle: Map<number, number>, source: string) {
    this.R = R; this.W = W; this.meta = meta; this.byHandle = byHandle; this.source = source;
    this.colliders = meta.kind.length;
    this.ray = new R.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 });
  }

  /** Build the static world of a WorldModel (and the caller's query-only pieces). Rapier must be initialised. */
  static build(model: WorldModel, extra: BuildExtra = {}): PhysicsWorld {
    const R = rapier();
    const W = new R.World({ x: 0, y: 0, z: 0 });
    const kinds: number[] = [], sensors: number[] = [], lo: number[] = [], hi: number[] = [], level: number[] = [], liquid: number[] = [];
    const byHandle = new Map<number, number>();
    const add = (desc: InstanceType<Rapier['ColliderDesc']>, kind: number, modes: number, sensor: boolean, b: [number[], number[]] | null, lev = -Infinity, liq = 0) => {
      desc.setCollisionGroups(((kind & 0xffff) << 16) | (modes & 0xffff)).setSensor(sensor);
      const c = W.createCollider(desc);
      byHandle.set(c.handle, kinds.length);
      kinds.push(kind); sensors.push(sensor ? 1 : 0);
      if (b) lo.push(...b[0]), hi.push(...b[1]); else lo.push(NaN, NaN, NaN), hi.push(NaN, NaN, NaN);
      level.push(lev); liquid.push(liq);
    };
    const box = (mn: number[], mx: number[]) => R.ColliderDesc.cuboid((mx[0] - mn[0]) / 2, (mx[1] - mn[1]) / 2, (mx[2] - mn[2]) / 2).setTranslation((mn[0] + mx[0]) / 2, (mn[1] + mx[1]) / 2, (mn[2] + mx[2]) / 2);
    model.colliders.forEach((c, i) => {
      const kind = extra.kinds ? extra.kinds[i] : SK.terrain, modes = modesOf(c.blocksShots, blocksSightOf(c), c.foliage);
      if (c.shape === 'box') {
        if (c.yaw !== 0) throw new Error('physics: yawed boxes are not built yet (the adapter writes yaw 0)');
        const mn = [c.centre[0] - c.half[0], c.centre[1] - c.half[1], c.centre[2] - c.half[2]], mx = [c.centre[0] + c.half[0], c.centre[1] + c.half[1], c.centre[2] + c.half[2]];
        add(box(mn, mx), kind, modes, false, [mn, mx]);
      } else {
        add(R.ColliderDesc.trimesh(c.positions, c.indices), kind, modes, false, null);
      }
    });
    // liquids: query-only boxes to their surface
    for (const v of model.volumes) {
      if (v.kind !== 'liquid') continue;
      add(box(v.box.min, v.box.max), SK.liquid, MODES_ALL, true, [v.box.min.slice(), v.box.max.slice()], v.level ?? v.box.max[1], LIQUID[v.element ?? 'tide'] ?? 1);
    }
    // the map edge: four slabs outside the bounds, past its floor and top
    const b = model.bounds, y0 = b.min[1] - EDGE_PAD, y1 = b.max[1] + EDGE_PAD, T = EDGE_THICK;
    const x0 = b.min[0], x1 = b.max[0], z0 = b.min[2], z1 = b.max[2];
    for (const [mn, mx] of [
      [[x0 - T, y0, z0 - T], [x0, y1, z1 + T]], [[x1, y0, z0 - T], [x1 + T, y1, z1 + T]],
      [[x0, y0, z0 - T], [x1, y1, z0]], [[x0, y0, z1], [x1, y1, z1 + T]],
    ] as [number[], number[]][]) add(box(mn, mx), SK.bounds, MODES_ALL, true, [mn, mx]);
    for (const p of extra.pieces ?? []) {
      if (p.hull) {
        const d = R.ColliderDesc.convexHull(p.hull);
        if (!d) throw new Error('physics: a degenerate hull piece');
        add(d, p.kind, p.modes, true, null);
      } else add(box(p.min!, p.max!), p.kind, p.modes, true, [p.min!.slice(), p.max!.slice()]);
    }
    // the first step builds the broad phase the queries walk (S1 §2 "first step")
    W.step();
    const meta: Meta = {
      kind: Uint8Array.from(kinds), sensor: Uint8Array.from(sensors), lo: Float64Array.from(lo), hi: Float64Array.from(hi),
      level: Float64Array.from(level), liquid: Uint8Array.from(liquid),
    };
    return new PhysicsWorld(R, W, meta, byHandle, model.meta.source);
  }

  private world(): RWorld {
    if (!this.W) throw new Error('physics: this world was disposed');
    return this.W;
  }

  /** the collider index of a Rapier collider */
  private idOf(c: RCollider): number {
    return this.byHandle.get(c.handle) ?? -1;
  }

  /** a box collider's f64 bounds strictly contain (x, y, z) (open sets); true for meshes and hulls (Rapier's answer) */
  private strictlyIn(id: number, x: number, y: number, z: number): boolean {
    const M = this.meta, o = id * 3;
    if (M.lo[o] !== M.lo[o]) return true;
    return M.lo[o] < x && x < M.hi[o] && M.lo[o + 1] < y && y < M.hi[o + 1] && M.lo[o + 2] < z && z < M.hi[o + 2];
  }

  private cylinder(r: number, h: number): RShape {
    const key = `${r}|${h}`;
    let s = this.cyl.get(key);
    if (!s) { s = new this.R.Cylinder(h, r); this.cyl.set(key, s); }
    return s;
  }

  /** the collision-group word of a query: membership the mode bit, filter the kind mask */
  private static groups(kinds: number, mode: number): number {
    return ((1 << mode) << 16) | (kinds & 0xffff);
  }

  /** collect every collider containing the start (point, or the cylinder at the start) into this.skip */
  private gather(ox: number, oy: number, oz: number, r: number, h: number, groups: number) {
    const W = this.world(), S = this.skip;
    S.clear();
    this.vo.x = ox; this.vo.y = oy; this.vo.z = oz;
    if (r > 0 || h > 0) W.intersectionsWithShape(this.vo, UNIT_ROT, this.cylinder(r, h), (c) => { S.add(c.handle); return true; }, undefined, groups);
    else W.intersectionsWithPoint(this.vo, (c) => { S.add(c.handle); return true; }, undefined, groups);
  }

  /**
   * The first world contact along o + d·t, 0 ≤ t ≤ maxT (d a unit vector): a ray (r = h = 0), else an upright cylinder
   * of radius r and half-height h swept along it. `kinds`: the SK bits that count; `flags`: QF bits (skipInitialWorld,
   * foliage, tops); `stops`: STOPS.shots or STOPS.sight. Writes `hit` and returns true, or returns false when the way is
   * clear. The generator's Probe (WORLDGEN3D Q12.2) wraps this and `sweep` as its ray and shape sweep.
   */
  cast(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxT: number, kinds: number, flags: number, stops: number, hit: RayHit, r = 0, h = 0): boolean {
    const clock = PhysicsWorld.clock;
    if (!clock) return this.castOnce(ox, oy, oz, dx, dy, dz, maxT, kinds, flags, stops, hit, r, h);
    const t0 = clock(), met = this.castOnce(ox, oy, oz, dx, dy, dz, maxT, kinds, flags, stops, hit, r, h);
    this.stats.ms += clock() - t0;
    return met;
  }

  private castOnce(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxT: number, kinds: number, flags: number, stops: number, hit: RayHit, r: number, h: number): boolean {
    this.stats.queries++;
    hit.t = Infinity; hit.kind = 0; hit.id = -1; hit.flags = 0;
    if (!(maxT >= 0)) maxT = 0;
    if ((kinds & 0x1f) === 0) return false;
    const groups = PhysicsWorld.groups(kinds, modeOf(stops, flags));
    const skip = (flags & QF.skipInitialWorld) !== 0;
    let pred: ((c: RCollider) => boolean) | undefined;
    if (skip) { this.gather(ox, oy, oz, r, h, groups); if (this.skip.size) pred = this.skipFn; }
    return r > 0 || h > 0 ? this.sweepCast(ox, oy, oz, dx, dy, dz, maxT, groups, r, h, pred, hit) : this.rayCast(ox, oy, oz, dx, dy, dz, maxT, groups, pred, hit);
  }

  /** cast() with an upright cylinder: the Probe's shape sweep */
  sweep(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxT: number, r: number, h: number, kinds: number, flags: number, stops: number, hit: RayHit): boolean {
    return this.cast(ox, oy, oz, dx, dy, dz, maxT, kinds, flags, stops, hit, r, h);
  }

  private rayCast(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxT: number, groups: number, pred: ((c: RCollider) => boolean) | undefined, hit: RayHit): boolean {
    const W = this.world(), ray = this.ray;
    this.vo.x = ox; this.vo.y = oy; this.vo.z = oz; this.vd.x = dx; this.vd.y = dy; this.vd.z = dz;
    ray.origin = this.vo; ray.dir = this.vd;
    this.stats.casts++;
    const res = W.castRayAndGetNormal(ray, maxT, true, undefined, groups, undefined, undefined, pred);
    if (!res) return false;
    const t = res.timeOfImpact;
    let id = this.idOf(res.collider);
    if (t === 0) id = this.firstContaining(ox, oy, oz, 0, 0, groups, pred, id);
    hit.t = t; hit.x = ox + dx * t; hit.y = oy + dy * t; hit.z = oz + dz * t; hit.kind = this.meta.kind[id]; hit.id = id;
    if (t === 0) { hit.nx = -dx; hit.ny = -dy; hit.nz = -dz; hit.flags = CF.initial | CF.block; }
    else { hit.nx = res.normal.x; hit.ny = res.normal.y; hit.nz = res.normal.z; hit.flags = CF.block; }
    return true;
  }

  private sweepCast(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxT: number, groups: number, r: number, h: number, pred: ((c: RCollider) => boolean) | undefined, hit: RayHit): boolean {
    const W = this.world();
    this.vo.x = ox; this.vo.y = oy; this.vo.z = oz; this.vd.x = dx; this.vd.y = dy; this.vd.z = dz;
    this.stats.casts++;
    const res = W.castShape(this.vo, UNIT_ROT, this.vd, this.cylinder(r, h), 0, maxT, true, undefined, groups, undefined, undefined, pred);
    if (!res) return false;
    const t = res.time_of_impact;
    let id = this.idOf(res.collider);
    if (t === 0) id = this.firstContaining(ox, oy, oz, r, h, groups, pred, id);
    hit.t = t; hit.x = ox + dx * t; hit.y = oy + dy * t; hit.z = oz + dz * t; hit.kind = this.meta.kind[id]; hit.id = id;
    if (t === 0) { hit.nx = -dx; hit.ny = -dy; hit.nz = -dz; hit.flags = CF.initial | CF.block; }
    else { hit.nx = res.normal1.x; hit.ny = res.normal1.y; hit.nz = res.normal1.z; hit.flags = CF.block; }
    return true;
  }

  /** A start inside several solids reports the first in kind order, then the lowest id (the tile model's tie-break), not
   *  whichever Rapier's traversal met first. */
  private firstContaining(ox: number, oy: number, oz: number, r: number, h: number, groups: number, pred: ((c: RCollider) => boolean) | undefined, id0: number): number {
    const W = this.world(), K = this.meta.kind;
    let best = id0;
    const pick = (c: RCollider) => {
      if (pred && !pred(c)) return true;
      const id = this.idOf(c);
      if (RANK[K[id]] < RANK[K[best]] || (K[id] === K[best] && id < best)) best = id;
      return true;
    };
    this.vo.x = ox; this.vo.y = oy; this.vo.z = oz;
    if (r > 0 || h > 0) W.intersectionsWithShape(this.vo, UNIT_ROT, this.cylinder(r, h), pick, undefined, groups);
    else W.intersectionsWithPoint(this.vo, pick, undefined, groups);
    return best;
  }

  /** Is the open segment between two points clear? A contact within END_EPS of its end is the end resting on a surface
   *  (the tile model's open sets: a segment ending on the ground is clear). */
  clear(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, kinds: number, flags: number, stops: number): boolean {
    const dx = x1 - x0, dy = y1 - y0, dz = z1 - z0, L = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (L === 0) return this.solidAt(x0, y0, z0, kinds, flags, stops) === 0;
    if (!this.cast(x0, y0, z0, dx / L, dy / L, dz / L, L, kinds, flags & ~QF.skipInitialWorld, stops, SEG_HIT)) return true;
    return SEG_HIT.t >= L - END_EPS;
  }

  /** the world kind (SK bit, lowest in kind order) of a solid strictly containing (x, y, z), or 0 where it is open */
  solidAt(x: number, y: number, z: number, kinds: number, flags = 0, stops: number = STOPS.shots): number {
    const clock = PhysicsWorld.clock, t0 = clock ? clock() : 0;
    const k = this.solidOnce(x, y, z, kinds, flags, stops);
    if (clock) this.stats.ms += clock() - t0;
    return k;
  }

  private solidOnce(x: number, y: number, z: number, kinds: number, flags: number, stops: number): number {
    this.stats.queries++;
    const W = this.world(), groups = PhysicsWorld.groups(kinds, modeOf(stops, flags));
    let best = 0;
    this.vo.x = x; this.vo.y = y; this.vo.z = z;
    W.intersectionsWithPoint(this.vo, (c) => {
      const id = this.idOf(c), k = this.meta.kind[id];
      if (this.strictlyIn(id, x, y, z) && (best === 0 || RANK[k] < RANK[best])) best = k;
      return true;
    }, undefined, groups);
    return best;
  }

  /** how many colliders of the masked kinds meet the upright cylinder at (x, z), radius r, from y0 to y1 (their ids
   *  into `out` while it has room) */
  overlapCylinder(x: number, y0: number, y1: number, z: number, r: number, kinds: number, flags: number, stops: number, out?: Int32Array): number {
    this.stats.queries++;
    const W = this.world(), groups = PhysicsWorld.groups(kinds, modeOf(stops, flags));
    let n = 0;
    this.vo.x = x; this.vo.y = (y0 + y1) / 2; this.vo.z = z;
    W.intersectionsWithShape(this.vo, UNIT_ROT, this.cylinder(r, (y1 - y0) / 2), (c) => {
      if (out && n < out.length) out[n] = this.idOf(c);
      n++;
      return true;
    }, undefined, groups);
    if (out && n > 1) out.subarray(0, Math.min(n, out.length)).sort();
    return n;
  }

  /** The top of the first solid at or below feet at y (a ray straight down, up to `drop` m): the support a body at
   *  (x, y, z) stands or lands on; -Infinity over open air. Liquids are not support unless `kinds` asks for them. */
  supportBelow(x: number, y: number, z: number, drop = 1e3, kinds: number = SK.wall | SK.deck | SK.terrain, stops: number = STOPS.shots): number {
    return this.cast(x, y, z, 0, -1, 0, drop, kinds, 0, stops, SUP_HIT) ? y - SUP_HIT.t : -Infinity;
  }

  /** The liquid at (x, y, z): 0 none, 1 water, 2 lava (sim/worldquery.ts liquidContact's ids); its surface in
   *  this.level. A point exactly at a surface is in it (closed). */
  liquidAt(x: number, y: number, z: number): number {
    this.stats.queries++;
    const W = this.world(), M = this.meta;
    let best = 0, lev = -Infinity, bestId = -1;
    this.vo.x = x; this.vo.y = y; this.vo.z = z;
    W.intersectionsWithPoint(this.vo, (c) => {
      const id = this.idOf(c);
      if (M.liquid[id] && (bestId < 0 || id < bestId)) { best = M.liquid[id]; lev = M.level[id]; bestId = id; }
      return true;
    }, undefined, PhysicsWorld.groups(SK.liquid, 0));
    this.level = lev;
    return best;
  }

  /** the kind of collider `id` (SK bit) */
  kindOf(id: number): number { return id >= 0 && id < this.colliders ? this.meta.kind[id] : 0; }

  /** The Rapier world's state as bytes (S1 O8, R12): restore() makes an identical world. */
  snapshot(): Uint8Array {
    return this.world().takeSnapshot();
  }

  /** A new PhysicsWorld from a snapshot of `from` (the per-collider records are copied; Rapier keeps the handles). */
  static restore(bytes: Uint8Array, from: PhysicsWorld): PhysicsWorld {
    const R = rapier();
    const W = R.World.restoreSnapshot(bytes);
    const M = from.meta;
    const meta: Meta = { kind: M.kind.slice(), sensor: M.sensor.slice(), lo: M.lo.slice(), hi: M.hi.slice(), level: M.level.slice(), liquid: M.liquid.slice() };
    return new PhysicsWorld(R, W, meta, new Map(from.byHandle), from.source);
  }

  /** free the Rapier world (S1 §6: an unfreed world leaks its wasm memory for good). Idempotent. */
  dispose(): void {
    if (!this.W) return;
    this.W.free();
    this.W = null;
    for (const s of this.cyl.values()) (s as unknown as { free?: () => void }).free?.();
    this.cyl.clear();
  }

  get disposed(): boolean { return this.W === null; }
}

/** a segment's contact this close to its end is its end resting on the surface (f32 geometry) */
export const END_EPS = 1e-5;
const SEG_HIT = new RayHit(), SUP_HIT = new RayHit();
