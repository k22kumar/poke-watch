// Spatial queries (Phase 2A, roadmap Stage 3; docs/THIRD_PERSON_IMPLEMENTATION.md §12): exact, ordered, deterministic
// rays, swept volumes and overlaps against the tile world and the actors. Phase 2B (§13) made the first consumers: the
// spatial aim (sim/aim.ts) and the linear 3D player shots (sim/effects.ts); Phase 2C (§14) the spatial beam (sim/moves.ts
// beam3D). All run only for input that carries a crosshair ray, which the bot never sends, so only the `aim` checksum
// sets depend on this module.
//
// Geometry model (one rule per thing, read live from the World every call, so ice, tides and W4 blocks are current):
//   tile        the half-open box [i, i + 1) × [j, j + 1) in grid coordinates (World.tile's rule): a point belongs to
//               exactly one tile
//   wall        a wall tile (not a chasm) is a column from -∞ to +∞, or up to a deck's underside when one is over it;
//               with QF.tops (R1b wall tops) a wall-prop tile ends at its World.wallTop (the prop's
//               measured height above its footing, world/tiles.ts wallTopsOf), so a line above a fence, a boulder or a
//               canopy passes; a bare wall (rock mass, cave wall) stays infinite either way
//   terrain     every other tile is solid below World.height(x, z) with no reference (ground, low props, ice, a stairs
//               ramp as its sloped plane); open water is the same column reported as `liquid`; a chasm (hazards on) has
//               no floor at all
//   deck        an overhead deck (ArenaMap.over) is a slab from its underside (top − DECK_SLAB) to its top, on top of
//               whatever the ground column holds (an underpass is the open air between the two)
//   bounds      outside the map: a column from -∞ to +∞
//   actors      upright cylinders, closed (touching counts, as effects.ts's `d² > rr²` reject does): an enemy from E.y to
//               E.y + E.tall with radius E.radius; a trainer's partner from P.y to P.y + partnerHeight with partnerRadius;
//               a body (rock, boulder, egg) from B.y to B.y + 2r with its template radius r (the bounding cylinder of the
//               ball it is drawn as)
//
// Foliage (Phase 2C): a tile covered by a prop whose authored material does not block shots (rules/surfaces.ts
// MATERIALS[..].blocksShots false: the leaf props, bushes, hedges, berry bushes, mushrooms) is, for a query with
// QF.foliage, open air above the ground under it: its wall column or low-prop platform is not cover. Every other wall
// tile (tree trunks, rock masses, buildings, thickets with no material row) and low prop (rocks, stumps, logs, grave
// markers) stays solid. Without the flag (World.sight parity, the oracles, movement-adjacent callers) foliage is solid.
//
// Wall tops (R1b): the player's attack traces opt in with QF.tops (sim/aim.ts combatFlags: the camera trace, the muzzle,
// shot flight, beams, device assist and the aimbot). World.sight, enemy fire, planar shots and the map validators do not,
// and keep every wall infinite until R7 (enemy sight and fire move together) and the validator unification.
//
// World solids are open sets: a contact needs a positive length of the query inside the solid, so a ray lying in a
// floor's plane or along a wall face does not hit it. One exception, the corner seal: a point ray that passes exactly
// through a tile corner whose two side tiles are both solid there is stopped at that corner (two walls touching at a
// corner leave no gap, as navigation's no-corner-cutting rule says).
//
// A query volume is an upright cylinder swept along the ray: radius r and half-height h around the ray point (r = h = 0
// is a ray). Against actors the cylinder Minkowski sum is exact (radius R + r, height extended by h). Against the world
// r is limited to < 1 m and the tile footprint grows to a rounded square; a stairs ramp is then taken at its higher edge
// (conservative). Separate radii for the world and for actors let a shot be thin against walls and fat against bodies.
//
// Order: contacts sort by entry distance t, then by kind (SK bit order: bounds, wall, deck, terrain, liquid, body,
// player, enemy: cover wins a tie), then by id. That key is total, so the result never depends on pool slot order or
// on the grid's iteration order.
//
// Responses: world kinds in the query mask always block (they are never overlapped); an actor kind in `block` blocks
// unless the query still has penetration (`pierce`) left, which marks it pierced and goes on; any other actor kind in
// the mask is an overlap (reported, never stops); a kind outside the mask is ignored (never tested). The first block
// ends the list; nothing behind it is reported.
//
// Tick state: actor tests read the pools as they are when the query runs (a system after enemySystem sees this tick's
// moved enemies). The enemy broad phase is ctx.grid, rebuilt by gridSystem before the enemies move, so cells are widened
// by rules.spatial.gridSlack and by the largest live enemy radius; an enemy that moved farther than the slack from its
// cell since the rebuild (a relocation) or was added since is a "stray", tested where it is (enemyBroad, Phase 2B), so
// no contact depends on the slack. Other grid readers (grid.query) still miss them until the next rebuild. The renderer may call the world-only
// functions (raycastWorld, segmentClear, solidAt): they read static map state only. It must not call the actor queries.
//
// Physics (I1a): with rules.physics.engine 'rapier' (ctx.physics set) a sweep's world contact and an overlap's sight lines
// come from src/physics through sim/physseam.ts instead of castWorld; the actor half below is the same either way.
// tests/physics-parity.test.ts lists where the two world models differ.
//
// Module split (C2): the world kinds, the column model, the tile walk and the map-only tests (mapSegmentClear,
// mapExposureClear) live in world/sight.ts so world code can read them without importing the sim; this module adds the
// World-bound entries and the actor queries.
//
// Allocation: no objects per call. Scratch lives in this module (sized up once per world and per grid), every number
// passed between internal steps goes through one Float64Array (V8 boxes doubles written to module variables or passed
// to calls it does not inline), and callers own and reuse their RayHit, Contacts and SpatialQuery objects
// (scripts/spatialbench.ts counts collections and heap growth). Only +, −, ×, /, sqrt, floor, abs, min and max are used.

import type { World } from './world';
import { SK, SK_WORLD, CF, QF, QF_WORLD, RANK, RayHit, F, OX, OY, OZ, DX, DY, DZ, MAXT, RAD, HH, Geo, LOS_HIT, castWorld, pointSolid, clearSegment, samplesClear } from '../world/sight';
import type { SimContext } from './types';
import type { Grid } from '../core/grid';
import type { EnemyPool } from './pools';
import type { SpeciesDef } from '../rules/species';
import type { Rules } from '../rules/defaults';
import { partnerHeight, partnerRadius } from '../rules/sizing';
import { BODY_KINDS, BODY_TEMPLATES } from '../rules/materials';
import type { PhysicsBridge } from './physseam';
import { STOPS } from '../physics/world';

/** the world kinds, flags and first-hit record (world/sight.ts), re-exported for the sim's readers */
export { SK, SK_WORLD, CF, QF, RayHit } from '../world/sight';
export const SK_ACTOR = SK.body | SK.player | SK.enemy;
export const SK_ALL = SK_WORLD | SK_ACTOR;
/** the masks the plan's stages use (D4): what each query tests */
export const MASK = {
  /** line of sight and cover: the world only */
  los: SK_WORLD,
  /** the camera trace (Stage 4A): the world and what you can aim at (never your own partner: pass it as self) */
  camera: SK_WORLD | SK.enemy | SK.body,
  /** a player shot: the world, enemies and bodies */
  shot: SK_WORLD | SK.enemy | SK.body,
  /** an enemy shot: the world, the trainer's partner and bodies */
  hostile: SK_WORLD | SK.player | SK.body,
} as const;

/** an ordered contact list (struct of arrays; index 0 is the nearest) */
export class Contacts {
  readonly cap: number;
  /** contacts in the list */
  n = 0;
  /** more contacts than `cap` were found (the farthest were dropped; the kept ones are still the nearest, in order) */
  truncated = false;
  /** index of the contact that ended the query (CF.block), or -1 when nothing blocked */
  stop = -1;
  /** distance of that contact, or the query's length when nothing blocked */
  stopT = 0;
  /** overlaps with QF.sight: actors dropped because something solid stood between */
  occluded = 0;
  readonly t: Float64Array; readonly x: Float64Array; readonly y: Float64Array; readonly z: Float64Array;
  readonly nx: Float64Array; readonly ny: Float64Array; readonly nz: Float64Array;
  readonly kind: Uint8Array; readonly flags: Uint8Array; readonly id: Int32Array;
  constructor(cap = 32) {
    this.cap = cap;
    const F = () => new Float64Array(cap);
    this.t = F(); this.x = F(); this.y = F(); this.z = F(); this.nx = F(); this.ny = F(); this.nz = F();
    this.kind = new Uint8Array(cap); this.flags = new Uint8Array(cap); this.id = new Int32Array(cap);
  }
}

/** what a sweep or an overlap tests and how contacts respond (caller-owned; build once, reuse) */
export interface SpatialQuery {
  /** SK bits tested */
  mask: number;
  /** actor SK bits that block (world kinds in the mask always block) */
  block: number;
  /** blocking actor contacts the query may pass through before one stops it (0: the first stops it; Infinity: none do) */
  pierce: number;
  /** query volume against the world: radius (< 1 m) and half-height */
  worldR: number; worldH: number;
  /** query volume against actors: radius and half-height */
  actorR: number; actorH: number;
  /** the actor never reported (the shooter): its SK kind bit (0 = none) and id (enemy slot, trainer index, body slot) */
  selfKind: number; selfId: number;
  /** bodies tested, by team: bit (1 << team) per TEAM value (sim/bodies.ts: neutral 0, player 1, enemy 2) */
  bodyTeams: number;
  /** QF bits */
  flags: number;
}

export function spatialQuery(init: Partial<SpatialQuery> = {}): SpatialQuery {
  return { mask: MASK.shot, block: SK_ACTOR, pierce: 0, worldR: 0, worldH: 0, actorR: 0, actorH: 0, selfKind: 0, selfId: -1, bodyTeams: 7, flags: 0, ...init };
}

// ---------------------------------------------------------------------------------------------------- scratch
// Every double one internal step hands to the next lives in F: V8 boxes a double written to a module variable or passed
// to a call it does not inline (a heap allocation each time), so the internal helpers take small integers only and read
// and write their numbers here. Only the public functions take doubles.
// F (world/sight.ts) holds slots 0–29 and 59–62 for the world casts; the actor queries use 30–58.
// an actor cylinder (in) and its contact (out), and the actor pass length
const KX = 30, KZ = 31, KYB = 32, KYT = 33, KR = 34, KT = 35, KNX = 36, KNY = 37, KNZ = 38, KL = 39;
// the contact to insert
const IT = 40, IX = 41, IY = 42, IZ = 43, INX = 44, INY = 45, INZ = 46;
// the overlap shape
const QX = 47, QZ = 48, QY0 = 49, QY1 = 50, QYM = 51, QR = 52, QFX = 53, QFZ = 54, QCOS = 55, QSIN = 56;
// the partner cylinder of the cached species
const PRR = 57, PHH = 58;
/** the last cylinder test started inside it */
let KI = false;

const GEOS = new WeakMap<World, Geo>();
let lastW: World | null = null, lastG: Geo | null = null;
function geoOf(W: World): Geo {
  let g = W === lastW ? lastG : (GEOS.get(W) ?? null);
  if (!g || g.map !== W.map || g.overSrc !== W.over || g.voidSrc !== W.voids) GEOS.set(W, (g = new Geo(W.map, W)));
  lastW = W; lastG = g;
  return g;
}


/** The solid kind (SK bit, within `mask`) occupying the point (x, y, z), or 0 where it is open. Static geometry only:
 *  the renderer may call it. */
export function solidAt(W: World, x: number, y: number, z: number, mask: number = SK_WORLD, flags = 0): number {
  return pointSolid(geoOf(W), x, y, z, mask, flags);
}



/**
 * First world contact along o + d·t for 0 ≤ t ≤ maxT (d a unit vector, so t is metres; any other length scales t).
 * `mask`: the world kinds that block (SK bits). `r` / `h`: the swept upright cylinder's radius (< 1 m) and half-height
 * (0 = a ray). Returns false when the way is clear; otherwise `hit` holds t, the point, the outward normal of the surface
 * entered (−d for a start inside a solid, CF.initial), the kind and the tile index. Static geometry only: the renderer
 * may call it (a camera or reticle ray).
 */
export function raycastWorld(W: World, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxT: number,
  mask: number, hit: RayHit, r = 0, h = 0, flags = 0): boolean {
  F[OX] = ox; F[OY] = oy; F[OZ] = oz; F[DX] = dx; F[DY] = dy; F[DZ] = dz; F[MAXT] = maxT; F[RAD] = r; F[HH] = h;
  return castWorld(geoOf(W), mask, flags, hit);
}

/** Is the open segment between two points clear of the world kinds in `mask`? (Exact; World.sight samples.) */
export function segmentClear(W: World, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, mask: number = MASK.los, flags = 0): boolean {
  return clearSegment(geoOf(W), x0, y0, z0, x1, y1, z1, mask, flags);
}


/** Legacy enemy sight keeps its half-metre samples, including on decks. */
export function sampledSight(W: World, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): boolean {
  const dx = x1 - x0, dz = z1 - z0;
  return samplesClear(geoOf(W), x0, y0, z0, x1, y1, z1, Math.sqrt(dx * dx + dz * dz), SK_WORLD);
}


// ---------------------------------------------------------------------------------------------------- actors

/** the closed upright cylinder (KX, KZ, KYB..KYT, radius KR) against the cast in F, up to F[KL]: entry F[KT] (0 when the
 *  start is inside, KI), outward normal F[KNX..KNZ] */
function cylinder(): boolean {
  const dx = F[DX], dy = F[DY], dz = F[DZ], oy = F[OY], R = F[KR];
  const px = F[OX] - F[KX], pz = F[OZ] - F[KZ], a = dx * dx + dz * dz, c = px * px + pz * pz - R * R;
  let t1: number, t2: number;
  if (a === 0) { if (c > 0) return false; t1 = -Infinity; t2 = Infinity; }
  else {
    const b = px * dx + pz * dz, disc = b * b - a * c;
    if (disc < 0) return false;
    const s = Math.sqrt(disc);
    t1 = (-b - s) / a; t2 = (-b + s) / a;
  }
  let t3: number, t4: number;
  const yb = F[KYB], yt = F[KYT];
  if (dy === 0) { if (oy < yb || oy > yt) return false; t3 = -Infinity; t4 = Infinity; }
  else { const u = (yb - oy) / dy, v = (yt - oy) / dy; if (u < v) { t3 = u; t4 = v; } else { t3 = v; t4 = u; } }
  const entry = t1 > t3 ? t1 : t3, exit = t2 < t4 ? t2 : t4;
  if (entry > exit || exit < 0 || entry > F[KL]) return false;
  KI = entry <= 0;
  const t = KI ? 0 : entry;
  F[KT] = t;
  if (KI) { F[KNX] = -dx; F[KNY] = -dy; F[KNZ] = -dz; }
  else if (t1 >= t3) { F[KNX] = (px + dx * t) / R; F[KNY] = 0; F[KNZ] = (pz + dz * t) / R; }
  else { F[KNX] = 0; F[KNY] = dy < 0 ? 1 : -1; F[KNZ] = 0; }
  return true;
}

/** insert the contact in F[IT..INZ] in (t, kind rank, id) order, keeping the `cap` nearest */
function insert(out: Contacts, kind: number, id: number, flags: number) {
  const t = F[IT], rk = RANK[kind];
  let p = out.n;
  while (p > 0) {
    const q = p - 1, tq = out.t[q];
    if (tq < t || (tq === t && (RANK[out.kind[q]] < rk || (RANK[out.kind[q]] === rk && out.id[q] <= id)))) break;
    p--;
  }
  if (p >= out.cap) { out.truncated = true; return; }
  if (out.n === out.cap) out.truncated = true;
  for (let q = Math.min(out.n, out.cap - 1); q > p; q--) {
    out.t[q] = out.t[q - 1]; out.x[q] = out.x[q - 1]; out.y[q] = out.y[q - 1]; out.z[q] = out.z[q - 1];
    out.nx[q] = out.nx[q - 1]; out.ny[q] = out.ny[q - 1]; out.nz[q] = out.nz[q - 1];
    out.kind[q] = out.kind[q - 1]; out.flags[q] = out.flags[q - 1]; out.id[q] = out.id[q - 1];
  }
  out.t[p] = t; out.x[p] = F[IX]; out.y[p] = F[IY]; out.z[p] = F[IZ]; out.nx[p] = F[INX]; out.ny[p] = F[INY]; out.nz[p] = F[INZ];
  out.kind[p] = kind; out.flags[p] = flags; out.id[p] = id;
  if (out.n < out.cap) out.n++;
}

/** the cylinder contact in F[KT..KNZ] as the contact to insert */
function insertCylinder(out: Contacts, kind: number, id: number) {
  const t = F[KT];
  F[IT] = t; F[IX] = F[OX] + F[DX] * t; F[IY] = F[OY] + F[DY] * t; F[IZ] = F[OZ] + F[DZ] * t;
  F[INX] = F[KNX]; F[INY] = F[KNY]; F[INZ] = F[KNZ];
  insert(out, kind, id, KI ? CF.initial : 0);
}

/** The enemy broad phase of one tick: the largest live enemy radius, and the strays. A stray is a live enemy the grid
 *  cannot be trusted to hold within rules.spatial.gridSlack of where it is: one that moved farther than that from the
 *  cell the last rebuild filed it in (enemies.ts relocates an enemy ~30 m ahead of the trainer after gridSystem has
 *  run), or one added since (not in the grid at all). The cell walk skips strays and every query tests them where they
 *  are, so gridSlack bounds cost, not correctness. Recomputed when the tick, the live count, the pool bound or the grid
 *  (a rebuild) changes; positions are stable from the end of enemySystem until zoneSystem's pulls, which is where every
 *  spatial query runs. */
interface Broad { tick: number; count: number; hi: number; grid: Grid | null; gen: number; r: number; n: number; strays: Int32Array; mark: Uint32Array; stamp: number }
const BROAD = new WeakMap<EnemyPool, Broad>();
function enemyBroad(ctx: SimContext): Broad {
  const E = ctx.enemies, G = ctx.grid;
  let c = BROAD.get(E);
  if (!c) BROAD.set(E, (c = { tick: -1, count: -1, hi: -1, grid: null, gen: -1, r: 0.5, n: 0, strays: new Int32Array(E.cap), mark: new Uint32Array(E.cap), stamp: 0 }));
  if (c.tick !== ctx.tick || c.count !== E.count || c.hi !== E.hi || c.grid !== G || c.gen !== G.gen) {
    let r = 0, n = 0;
    if (++c.stamp === 0x3fffffff) { c.mark.fill(0); c.stamp = 1; }
    const slack = ctx.rules.spatial.gridSlack, cell = G.cell, ext = G.extent / 2, dim = G.dim, gn = G.n, st = c.stamp;
    for (let i = 0; i < E.hi; i++) {
      if (!E.alive[i]) continue;
      if (E.radius[i] > r) r = E.radius[i];
      const g = i < gn ? G.cellOf[i] : -1;
      let stray = g < 0;
      if (!stray) {
        const cx = g % dim, cz = (g - cx) / dim, lx = cx * cell - ext, lz = cz * cell - ext, x = E.x[i], z = E.z[i];
        // an edge cell also holds everything clamped beyond it
        stray = (cx > 0 && x < lx - slack) || (cx < dim - 1 && x > lx + cell + slack) || (cz > 0 && z < lz - slack) || (cz < dim - 1 && z > lz + cell + slack);
      }
      if (stray) { c.strays[n++] = i; c.mark[i] = st; }
    }
    c.tick = ctx.tick; c.count = E.count; c.hi = E.hi; c.grid = G; c.gen = G.gen; c.r = r; c.n = n;
  }
  return c;
}

/** the partner cylinder (radius F[PRR], height F[PHH]) of a species, recomputed only when the species or rules change */
let PSP: SpeciesDef | null = null, PRU: Rules | null = null;
function partnerCylinder(sp: SpeciesDef, rules: Rules) {
  if (sp === PSP && rules === PRU) return;
  PSP = sp; PRU = rules; F[PRR] = partnerRadius(sp, rules); F[PHH] = partnerHeight(sp, rules);
}

/** grid cells already walked in this query */
interface CellStamps { stamp: Uint32Array; gen: number }
const CELLS = new WeakMap<Grid, CellStamps>();
function cellStamps(G: Grid): CellStamps {
  let s = CELLS.get(G);
  if (!s) CELLS.set(G, (s = { stamp: new Uint32Array(G.dim * G.dim), gen: 0 }));
  if (++s.gen === 0x3fffffff) { s.stamp.fill(0); s.gen = 1; }
  return s;
}

function enemyOk(ctx: SimContext, e: number, q: SpatialQuery): boolean {
  const E = ctx.enemies;
  if (!E.alive[e]) return false;
  if (q.selfKind === SK.enemy && q.selfId === e) return false;
  return (q.flags & QF.spawning) !== 0 || E.spawnT[e] >= ctx.rules.spatial.spawnGuard;
}

/** classify the sorted list (block / pierced / overlap) and cut it after the first block */
function finish(out: Contacts, q: SpatialQuery) {
  let pierce = q.pierce;
  out.stop = -1;
  // a full list may have dropped the contact that stops the query: then nothing past the last kept one is known
  out.stopT = out.truncated && out.n > 0 ? out.t[out.n - 1] : F[MAXT];
  for (let p = 0; p < out.n; p++) {
    const kind = out.kind[p];
    if (kind & SK_WORLD || (kind & q.block && !(pierce > 0))) {
      out.flags[p] |= CF.block; out.stop = p; out.stopT = out.t[p]; out.n = p + 1;
      return;
    }
    if (kind & q.block) { out.flags[p] |= CF.pierced; pierce--; }
    else out.flags[p] |= CF.overlap;
  }
}

const WH = new RayHit();

/**
 * Ordered contacts of a volume swept along o + d·t, 0 ≤ t ≤ maxT (d a unit vector): the world (q.worldR, q.worldH) and
 * the actors (q.actorR, q.actorH) in q.mask, nearest first (§ order above), up to and including the first that blocks.
 * Returns out.n. out.stop / out.stopT say what ended it; out.flags[i] says block, pierced or overlap (and initial for a
 * start inside a volume, seal for a corner seal). Actor state is read as it is now (call it from a system, never from
 * render).
 */
export function sweep(ctx: SimContext, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxT: number, q: SpatialQuery, out: Contacts): number {
  F[OX] = ox; F[OY] = oy; F[OZ] = oz; F[DX] = dx; F[DY] = dy; F[DZ] = dz; F[MAXT] = maxT;
  return sweepCore(ctx, q, out);
}

function sweepCore(ctx: SimContext, q: SpatialQuery, out: Contacts): number {
  out.n = 0; out.truncated = false; out.occluded = 0;
  const W = ctx.world;
  F[RAD] = q.worldR; F[HH] = q.worldH;
  if (!(F[MAXT] >= 0)) F[MAXT] = 0;
  if (F[MAXT] === Infinity) F[MAXT] = 2 * (W.w + W.h) + 64;
  F[KL] = F[MAXT];
  // I1a swap: with rules.physics.engine 'rapier' the world contact comes from src/physics (sim/physseam.ts)
  const PB = ctx.physics;
  if (q.mask & SK_WORLD && (PB ? PB.castWorld(W, F[OX], F[OY], F[OZ], F[DX], F[DY], F[DZ], F[MAXT], F[RAD], F[HH], q.mask, q.flags, WH) : castWorld(geoOf(W), q.mask, q.flags, WH))) {
    F[IT] = WH.t; F[IX] = WH.x; F[IY] = WH.y; F[IZ] = WH.z; F[INX] = WH.nx; F[INY] = WH.ny; F[INZ] = WH.nz;
    insert(out, WH.kind, WH.id, WH.flags & (CF.initial | CF.seal));
    F[KL] = WH.t;
  }
  const r = q.actorR, h = q.actorH;
  if (q.mask & SK.enemy) {
    const E = ctx.enemies, G = ctx.grid, cell = G.cell, ext = G.extent / 2, dim = G.dim, S = cellStamps(G), st = S.stamp, gen = S.gen;
    const BR = enemyBroad(ctx), mark = BR.mark, sg = BR.stamp;
    const m = BR.r + r + ctx.rules.spatial.gridSlack, L = F[KL];
    const chunks = Math.max(1, Math.ceil(L / cell));
    for (let c = 0; c < chunks; c++) {
      const ta = (L * c) / chunks, tb = (L * (c + 1)) / chunks;
      const xa = F[OX] + F[DX] * ta, xb = F[OX] + F[DX] * tb, za = F[OZ] + F[DZ] * ta, zb = F[OZ] + F[DZ] * tb;
      const x0 = Math.max(0, Math.floor(((xa < xb ? xa : xb) - m + ext) / cell)), x1 = Math.min(dim - 1, Math.floor(((xa > xb ? xa : xb) + m + ext) / cell));
      const z0 = Math.max(0, Math.floor(((za < zb ? za : zb) - m + ext) / cell)), z1 = Math.min(dim - 1, Math.floor(((za > zb ? za : zb) + m + ext) / cell));
      for (let cz = z0; cz <= z1; cz++) for (let cx = x0; cx <= x1; cx++) {
        const ci = cz * dim + cx;
        if (st[ci] === gen) continue;
        st[ci] = gen;
        for (let s = G.starts[ci], e2 = G.starts[ci + 1]; s < e2; s++) {
          const e = G.items[s];
          if (mark[e] === sg || !enemyOk(ctx, e, q)) continue;
          F[KX] = E.x[e]; F[KZ] = E.z[e]; F[KYB] = E.y[e] - h; F[KYT] = E.y[e] + E.tall[e] + h; F[KR] = E.radius[e] + r;
          if (cylinder()) insertCylinder(out, SK.enemy, e);
        }
      }
    }
    for (let k = 0; k < BR.n; k++) {
      const e = BR.strays[k];
      if (!enemyOk(ctx, e, q)) continue;
      F[KX] = E.x[e]; F[KZ] = E.z[e]; F[KYB] = E.y[e] - h; F[KYT] = E.y[e] + E.tall[e] + h; F[KR] = E.radius[e] + r;
      if (cylinder()) insertCylinder(out, SK.enemy, e);
    }
  }
  if (q.mask & SK.player) {
    for (let p = 0; p < ctx.players.length; p++) {
      if (q.selfKind === SK.player && q.selfId === p) continue;
      const P = ctx.players[p];
      partnerCylinder(P.species, ctx.rules);
      F[KX] = P.x; F[KZ] = P.z; F[KYB] = P.y - h; F[KYT] = P.y + F[PHH] + h; F[KR] = F[PRR] + r;
      if (cylinder()) insertCylinder(out, SK.player, p);
    }
  }
  if (q.mask & SK.body) {
    const B = ctx.bodies;
    for (let b = 0; b < B.hi; b++) {
      if (!B.alive[b] || !((1 << B.team[b]) & q.bodyTeams) || (q.selfKind === SK.body && q.selfId === b)) continue;
      const R = BODY_TEMPLATES[BODY_KINDS[B.kind[b]]].radius;
      F[KX] = B.x[b]; F[KZ] = B.z[b]; F[KYB] = B.y[b] - h; F[KYT] = B.y[b] + 2 * R + h; F[KR] = R + r;
      if (cylinder()) insertCylinder(out, SK.body, b);
    }
  }
  finish(out, q);
  return out.n;
}

/** sweep() from (x0, y0, z0) to (x1, y1, z1) */
export function sweepTo(ctx: SimContext, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, q: SpatialQuery, out: Contacts): number {
  const dx = x1 - x0, dy = y1 - y0, dz = z1 - z0, L = Math.sqrt(dx * dx + dy * dy + dz * dz);
  return L === 0 ? sweep(ctx, x0, y0, z0, 0, 0, 0, 0, q, out) : sweep(ctx, x0, y0, z0, dx / L, dy / L, dz / L, L, q, out);
}

// ---------------------------------------------------------------------------------------------------- overlaps

let QWEDGE = false, QLOS = 0, QLOSF = 0;
let QW: Geo | null = null;
/** I1a: the overlap's sight lines on physics (the run's bridge and tile world), else null */
let QPB: PhysicsBridge | null = null, QPW: World | null = null;

/** the actor cylinder in F[KX..KR] (KYB..KYT its vertical extent, KR its radius) against the overlap shape in F[Q*] */
function overlapActor(out: Contacts, kind: number, id: number) {
  const ab = F[KYB], at = F[KYT], R = F[KR];
  if (at < F[QY0] || ab > F[QY1]) return;
  const cx = F[KX], cz = F[KZ], ux = cx - F[QX], uz = cz - F[QZ], d2 = ux * ux + uz * uz, rr = F[QR] + R;
  if (d2 > rr * rr) return;
  const d = Math.sqrt(d2), fx = F[QFX], fz = F[QFZ], cos = F[QCOS];
  if (QWEDGE && d > R && ux * fx + uz * fz < cos * d) {
    // centre outside the wedge's angle: the disc meets the sector only across one of its two edge segments
    const sin = F[QSIN], len = F[QR];
    let near = false;
    for (let s = -1; s <= 1 && !near; s += 2) {
      const ex = fx * cos - s * fz * sin, ez = fz * cos + s * fx * sin;
      let p = ux * ex + uz * ez;
      p = p < 0 ? 0 : p > len ? len : p;
      const qx = ux - ex * p, qz = uz - ez * p;
      near = qx * qx + qz * qz <= R * R;
    }
    if (!near) return;
  }
  const cy = (ab + at) / 2;
  if (QLOS) {
    // segmentClear from the shape's centre to the actor's, written into F directly (no boxed arguments)
    const lx = cx - F[QX], ly = cy - F[QYM], lz = cz - F[QZ], L = Math.sqrt(lx * lx + ly * ly + lz * lz);
    if (L > 0) {
      F[OX] = F[QX]; F[OY] = F[QYM]; F[OZ] = F[QZ]; F[DX] = lx / L; F[DY] = ly / L; F[DZ] = lz / L; F[MAXT] = L; F[RAD] = 0; F[HH] = 0;
      if (QPB ? !QPB.worldFor(QPW!).clear(F[QX], F[QYM], F[QZ], cx, cy, cz, QLOS, QLOSF, STOPS.sight) : castWorld(QW!, QLOS, QLOSF, LOS_HIT)) { out.occluded++; return; }
    }
  }
  F[IT] = d; F[IX] = cx; F[IY] = cy; F[IZ] = cz; F[INX] = d > 0 ? ux / d : 0; F[INY] = 0; F[INZ] = d > 0 ? uz / d : 0;
  insert(out, kind, id, CF.overlap);
}

/** the shape is in F[Q*] */
function overlap(ctx: SimContext, q: SpatialQuery, out: Contacts): number {
  out.n = 0; out.truncated = false; out.occluded = 0; out.stop = -1; out.stopT = F[QR];
  QPB = ctx.physics; QPW = ctx.world;
  QW = QPB ? null : geoOf(ctx.world); QLOS = (q.flags & QF.sight) !== 0 ? q.mask & SK_WORLD : 0; QLOSF = q.flags & QF_WORLD;
  if (q.mask & SK.enemy) {
    const E = ctx.enemies, G = ctx.grid, cell = G.cell, ext = G.extent / 2, dim = G.dim, x = F[QX], z = F[QZ];
    const BR = enemyBroad(ctx), mark = BR.mark, sg = BR.stamp;
    const m = F[QR] + BR.r + ctx.rules.spatial.gridSlack;
    const x0 = Math.max(0, Math.floor((x - m + ext) / cell)), x1 = Math.min(dim - 1, Math.floor((x + m + ext) / cell));
    const z0 = Math.max(0, Math.floor((z - m + ext) / cell)), z1 = Math.min(dim - 1, Math.floor((z + m + ext) / cell));
    for (let cz = z0; cz <= z1; cz++) for (let cx = x0; cx <= x1; cx++) {
      const ci = cz * dim + cx;
      for (let s = G.starts[ci], e2 = G.starts[ci + 1]; s < e2; s++) {
        const e = G.items[s];
        if (mark[e] === sg || !enemyOk(ctx, e, q)) continue;
        F[KX] = E.x[e]; F[KZ] = E.z[e]; F[KYB] = E.y[e]; F[KYT] = E.y[e] + E.tall[e]; F[KR] = E.radius[e];
        overlapActor(out, SK.enemy, e);
      }
    }
    for (let k = 0; k < BR.n; k++) {
      const e = BR.strays[k];
      if (!enemyOk(ctx, e, q)) continue;
      F[KX] = E.x[e]; F[KZ] = E.z[e]; F[KYB] = E.y[e]; F[KYT] = E.y[e] + E.tall[e]; F[KR] = E.radius[e];
      overlapActor(out, SK.enemy, e);
    }
  }
  if (q.mask & SK.player) {
    for (let p = 0; p < ctx.players.length; p++) {
      if (q.selfKind === SK.player && q.selfId === p) continue;
      const P = ctx.players[p];
      partnerCylinder(P.species, ctx.rules);
      F[KX] = P.x; F[KZ] = P.z; F[KYB] = P.y; F[KYT] = P.y + F[PHH]; F[KR] = F[PRR];
      overlapActor(out, SK.player, p);
    }
  }
  if (q.mask & SK.body) {
    const B = ctx.bodies;
    for (let b = 0; b < B.hi; b++) {
      if (!B.alive[b] || !((1 << B.team[b]) & q.bodyTeams) || (q.selfKind === SK.body && q.selfId === b)) continue;
      const R = BODY_TEMPLATES[BODY_KINDS[B.kind[b]]].radius;
      F[KX] = B.x[b]; F[KZ] = B.z[b]; F[KYB] = B.y[b]; F[KYT] = B.y[b] + 2 * R; F[KR] = R;
      overlapActor(out, SK.body, b);
    }
  }
  QW = null; QPB = null; QPW = null;
  return out.n;
}


/**
 * Actors whose volume meets the upright cylinder at (x, z), radius r, from y0 to y1 (an area: nova, aura, a landing),
 * nearest centre first (t = horizontal distance between centres, then kind, then id). Every contact is an overlap; with
 * QF.sight an actor behind a solid (the mask's world kinds, from the cylinder's mid-height to the actor's centre) is
 * left out and counted in out.occluded.
 */
export function overlapCylinder(ctx: SimContext, x: number, y0: number, y1: number, z: number, r: number, q: SpatialQuery, out: Contacts): number {
  F[QX] = x; F[QZ] = z; F[QY0] = y0; F[QY1] = y1; F[QYM] = (y0 + y1) / 2; F[QR] = r; F[QFX] = 0; F[QFZ] = 0; F[QCOS] = -1; F[QSIN] = 0;
  QWEDGE = false;
  return overlap(ctx, q, out);
}

/**
 * Actors whose volume meets the wedge of the upright cylinder at (x, z) (radius r, y0 to y1) that opens along the unit
 * facing (fx, fz) with half-angle cos `cosHalf` (melee: cone, strike arc). Exact disc-against-sector. Pass the cosine
 * from detmath (dcos), never Math.cos.
 */
export function overlapSector(ctx: SimContext, x: number, y0: number, y1: number, z: number, r: number, fx: number, fz: number, cosHalf: number, q: SpatialQuery, out: Contacts): number {
  const c = cosHalf < -1 ? -1 : cosHalf > 1 ? 1 : cosHalf;
  F[QX] = x; F[QZ] = z; F[QY0] = y0; F[QY1] = y1; F[QYM] = (y0 + y1) / 2; F[QR] = r; F[QFX] = fx; F[QFZ] = fz; F[QCOS] = c; F[QSIN] = Math.sqrt(1 - c * c);
  QWEDGE = true;
  return overlap(ctx, q, out);
}
