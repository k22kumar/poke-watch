// Exact world-geometry casts over the tile map (moved from sim/spatial.ts, task C2): the world kinds, the column model,
// the tile walk and the map-only sight tests the generators and validators read. The geometry model, the open-set and
// corner-seal rules, the ordering and the allocation discipline are documented in sim/spatial.ts's header, which builds
// the World-bound and actor queries on top of this module. World code (habitat/validate.ts, locgen/nav.ts) calls the
// map functions here so it never imports src/sim.

import { T, WATER_Y, ICE_LIFT, DECK_SLAB, type ArenaMap } from './tiles';
import { MATERIALS, PROP_MATERIALS } from '../rules/surfaces';

/** contact kinds (bits; the bit order is the tie-break order) */
export const SK = { bounds: 1, wall: 2, deck: 4, terrain: 8, liquid: 16, body: 32, player: 64, enemy: 128 } as const;
export const SK_WORLD = SK.bounds | SK.wall | SK.deck | SK.terrain | SK.liquid;

/** contact flags */
export const CF = { block: 1, pierced: 2, overlap: 4, initial: 8, seal: 16 } as const;
/** query flags */
export const QF = {
  /** world solids that already contain the start point are ignored (a muzzle poking into a wall it is leaving) */
  skipInitialWorld: 1,
  /** include enemies inside their spawn guard (rules.spatial.spawnGuard) */
  spawning: 2,
  /** overlaps only: drop actors with no line of sight (MASK.los ∩ mask) from the query centre to their centre */
  sight: 4,
  /** foliage (props whose material does not block shots) is open air above its ground (header, Phase 2C) */
  foliage: 8,
  /** wall props are solid only up to their World.wallTop (header, R1b); bare walls stay infinite */
  tops: 16,
} as const;
/** the query flags a world test carries through to an internal cast (segmentClear, an overlap's sight line) */
export const QF_WORLD = QF.foliage | QF.tops;

export const RANK = new Uint8Array(256);
for (let b = 0; b < 8; b++) RANK[1 << b] = b;

/** one contact, for the first-hit queries */
export class RayHit {
  t = Infinity;
  x = 0; y = 0; z = 0;
  nx = 0; ny = 0; nz = 0;
  kind = 0; id = -1; flags = 0;
}

// ---------------------------------------------------------------------------------------------------- scratch
// Every double one internal step hands to the next lives in F: V8 boxes a double written to a module variable or passed
// to a call it does not inline (a heap allocation each time), so the internal helpers take small integers only and read
// and write their numbers here. Only the public functions take doubles.
// Slots 30–58 belong to sim/spatial.ts's actor queries (they share this array).
export const F = new Float64Array(64);
// the cast: origin, unit direction, length, world radius and half-height, origin in grid coordinates
export const OX = 0, OY = 1, OZ = 2, DX = 3, DY = 4, DZ = 5, MAXT = 6, RAD = 7, HH = 8;
const GX = 9, GZ = 10;
// the tile under test, the stairs plane, the y range, xz intervals (box or circle, rounded square)
const TIN = 11, TOUT = 12, SA = 13, SB = 14, YA = 15, YB = 16, BA = 17, BB = 18, RA = 19, RB = 20;
// box input (grid coordinates), circle input
const BX0 = 21, BZ0 = 22, BX1 = 23, BZ1 = 24, CCX = 25, CCZ = 26, CCR = 27;
// a point test (grid z, y)
const PZG = 28, PY = 29;
// a world contact being written (setHit)
const HT = 59, HNX = 60, HNY = 61, HNZ = 62;

// ---------------------------------------------------------------------------------------------------- world view

/** The live layers a sim World lays over its map (sim/world.ts World satisfies it structurally; world code never
 *  imports the sim). */
export interface GeoLayers {
  readonly over: Float32Array | null;
  readonly voids: Uint8Array | null;
  readonly half: number;
  readonly wallTop: Float64Array;
  readonly cells: { iceAt(k: number): boolean };
}

/** One hidden class over every World's geometry, with no null or absent arrays (a map without decks gets a zero deck
 *  array, one without fluid levels a WATER_Y array). Authored and generated worlds differ in exactly those fields, and
 *  code that has seen both reads typed-array elements generically, boxing every float it loads: this keeps each load
 *  monomorphic. The arrays are the World's own (its W4 overlay and tide write into them in place), so the view stays
 *  current; it is rebuilt if the World's map or layer arrays are replaced. */
export class Geo {
  readonly map: ArenaMap;
  readonly wlevelSrc: ArenaMap['wlevel']; readonly chasmSrc?: number[];
  readonly overSrc: Float32Array | null; readonly voidSrc: Uint8Array | null;
  readonly w: number; readonly h: number; readonly half: number;
  readonly wall: Uint8Array; readonly terrain: Uint8Array; readonly elev: Float32Array; readonly platform: Float32Array; readonly stairs: Uint8Array;
  readonly over: Float32Array; readonly voids: Uint8Array; readonly wlevel: Float32Array;
  /** 1 = the tile is covered by foliage (a prop whose material does not block shots; the last prop placed on a tile
   *  owns it, as sim/props.ts PropField.at): static per map, the wall and platform arrays say whether it still stands */
  readonly soft: Uint8Array;
  /** R1b: the World's wallTop array (written in place by World.setBlock), or an all-Infinity one with no world */
  readonly top: Float64Array;
  readonly cells: GeoLayers['cells'] | undefined;
  constructor(M: ArenaMap, W?: GeoLayers) {
    const n = M.w * M.h;
    this.map = M; this.overSrc = W ? W.over : M.over ?? null; this.voidSrc = W?.voids ?? null;
    this.w = M.w; this.h = M.h; this.half = W?.half ?? 0;
    this.wall = M.wall; this.terrain = M.terrain; this.elev = M.elev; this.platform = M.platform; this.stairs = M.stairs;
    this.over = this.overSrc ?? new Float32Array(n); this.voids = this.voidSrc ?? new Uint8Array(n);
    this.chasmSrc = W ? undefined : M.gen?.loc?.chasm;
    if (this.chasmSrc) for (const k of this.chasmSrc) this.voids[k] = 1;
    this.wlevelSrc = M.wlevel;
    this.wlevel = M.wlevel ?? new Float32Array(n).fill(WATER_Y);
    this.top = W?.wallTop ?? new Float64Array(n).fill(Infinity);
    this.soft = new Uint8Array(n);
    for (const p of M.props ?? []) {
      const pm = PROP_MATERIALS[p.kind];
      if (!pm) continue; // decoration (flowers, reeds, tall grass) claims no tile, as in PropField.at
      const v = MATERIALS[pm.mat].blocksShots ? 0 : 1;
      for (let j = p.y; j < p.y + p.h && j < M.h; j++) for (let i = p.x; i < p.x + p.w && i < M.w; i++) if (i >= 0 && j >= 0) this.soft[j * M.w + i] = v;
    }
    this.cells = W?.cells;
  }
}

// ---------------------------------------------------------------------------------------------------- world columns

/** the solid intervals of the current column: (lo, hi) open, kind; CST is the stairs ramp's interval (plane SA + SB·(zg − j)) */
const CLO = new Float64Array(3), CHI = new Float64Array(3), CK = new Uint8Array(3);
let CN = 0, CST = -1;
/** the cast in progress treats foliage as open (QF.foliage): set by every public entry before it reads a column */
let SOFT = false;
/** the cast in progress ends wall-prop columns at their tops (QF.tops, R1b): set with SOFT */
let TOPS = false;

/** a stairs tile's ramp as top = SA + SB·(zg − j): world/tiles.ts stairEdges, without its tuple */
function stairPlane(G: Geo, i: number, j: number) {
  const st = G.stairs, el = G.elev, w = G.w;
  let jt = j; while (jt > 0 && st[(jt - 1) * w + i]) jt--;
  let jb = j; while (jb < G.h - 1 && st[(jb + 1) * w + i]) jb++;
  const hi = jt > 0 ? el[(jt - 1) * w + i] : 0, lo = jb < G.h - 1 ? el[(jb + 1) * w + i] : 0, n = jb - jt + 1;
  const a = hi + ((lo - hi) * (j - jt)) / n;
  F[SA] = a; F[SB] = hi + ((lo - hi) * (j - jt + 1)) / n - a;
}

/** fill the solid intervals of tile k = (i, j) (k = -1 outside the map) that the mask selects */
function column(G: Geo, k: number, i: number, j: number, mask: number) {
  CN = 0; CST = -1;
  if (k < 0) { if (mask & SK.bounds) { CLO[0] = -Infinity; CHI[0] = Infinity; CK[0] = SK.bounds; CN = 1; } return; }
  const ov = G.over[k], soft = SOFT && G.soft[k] === 1;
  if (G.voids[k] !== 1) {
    if (G.wall[k] === 1 && !soft) {
      if (mask & SK.wall) {
        let hi = ov > 0 ? ov - DECK_SLAB : Infinity;
        if (TOPS) { const t = G.top[k]; if (t < hi) hi = t; }
        CLO[CN] = -Infinity; CHI[CN] = hi; CK[CN] = SK.wall; CN++;
      }
    } else {
      const t = G.terrain[k], water = t === T.water, ice = water && G.cells?.iceAt(k), kind = water && !ice ? SK.liquid : SK.terrain;
      if (mask & kind) {
        // World.height(x, z) with no reference, per tile: the stairs plane, a water surface (or the ice on it), a bridge
        // plank's deck top, else the ground plus its low prop
        let top: number;
        if (G.stairs[k]) { stairPlane(G, i, j); CST = CN; top = F[SB] > 0 ? F[SA] + F[SB] : F[SA]; }
        else if (water) { const wl = G.wlevel[k]; top = ice ? wl + ICE_LIFT : wl; }
        else if (t === T.wood) { const e = G.elev[k]; top = e > 0.05 ? e : 0.05; }
        else top = soft ? G.elev[k] : G.elev[k] + G.platform[k];
        CLO[CN] = -Infinity; CHI[CN] = top; CK[CN] = kind; CN++;
      }
    }
  }
  if (ov > 0 && mask & SK.deck) { CLO[CN] = ov - DECK_SLAB; CHI[CN] = ov; CK[CN] = SK.deck; CN++; }
}

/** the solid kind at the point (grid z F[PZG], height F[PY]) of tile k = (i, j); 0 = open */
function solidIn(G: Geo, k: number, i: number, j: number, mask: number): number {
  column(G, k, i, j, mask);
  const zg = F[PZG], y = F[PY];
  for (let c = 0; c < CN; c++) {
    let hi = CHI[c];
    if (c === CST) { const f = zg < j ? 0 : zg > j + 1 ? 1 : zg - j; hi = F[SA] + F[SB] * f; }
    if (CLO[c] < y && y < hi) return CK[c];
  }
  return 0;
}

export function pointSolid(G: Geo, x: number, y: number, z: number, mask: number, flags: number): number {
  const gx = x + G.half, gz = z + G.half, i = Math.floor(gx), j = Math.floor(gz);
  F[PZG] = gz; F[PY] = y; SOFT = (flags & QF.foliage) !== 0; TOPS = (flags & QF.tops) !== 0;
  return solidIn(G, i < 0 || j < 0 || i >= G.w || j >= G.h ? -1 : j * G.w + i, i, j, mask);
}

// ---------------------------------------------------------------------------------------------------- world casts

/** t range where the cast is strictly inside interval c (its open (lo, hi) grown by the half-height, or under the
 *  stairs plane; `flat` takes the ramp at its higher edge): F[YA], F[YB]; false when it never is */
function yRange(c: number, j: number, flat: boolean): boolean {
  const oy = F[OY], dy = F[DY], h = F[HH];
  if (c === CST && !flat) {
    // y − h < SA + SB·(zg − j), zg = GZ + DZ·t:  c0 + c1·t < 0
    const c0 = oy - h - F[SA] - F[SB] * (F[GZ] - j), c1 = dy - F[SB] * F[DZ];
    if (c1 === 0) { if (c0 >= 0) return false; F[YA] = -Infinity; F[YB] = Infinity; }
    else if (c1 > 0) { F[YA] = -Infinity; F[YB] = -c0 / c1; }
    else { F[YA] = -c0 / c1; F[YB] = Infinity; }
    return true;
  }
  const lo = CLO[c] - h, hi = CHI[c] + h;
  if (dy === 0) { if (!(lo < oy && oy < hi)) return false; F[YA] = -Infinity; F[YB] = Infinity; return true; }
  const a = (lo - oy) / dy, b = (hi - oy) / dy;
  if (a < b) { F[YA] = a; F[YB] = b; } else { F[YA] = b; F[YB] = a; }
  return true;
}

/** the cast's closed xz interval in the box [BX0, BX1] × [BZ0, BZ1] (grid coordinates): F[BA], F[BB] */
function boxXZ(): boolean {
  const px = F[GX], pz = F[GZ], dx = F[DX], dz = F[DZ];
  let a = -Infinity, b = Infinity;
  if (dx === 0) { if (px < F[BX0] || px > F[BX1]) return false; }
  else { let u = (F[BX0] - px) / dx, v = (F[BX1] - px) / dx; if (u > v) { const s = u; u = v; v = s; } if (u > a) a = u; if (v < b) b = v; }
  if (dz === 0) { if (pz < F[BZ0] || pz > F[BZ1]) return false; }
  else { let u = (F[BZ0] - pz) / dz, v = (F[BZ1] - pz) / dz; if (u > v) { const s = u; u = v; v = s; } if (u > a) a = u; if (v < b) b = v; }
  if (a > b) return false;
  F[BA] = a; F[BB] = b;
  return true;
}
/** the cast's closed xz interval in the disc (CCX, CCZ, CCR): F[BA], F[BB] */
function circleXZ(): boolean {
  const qx = F[GX] - F[CCX], qz = F[GZ] - F[CCZ], dx = F[DX], dz = F[DZ], r = F[CCR];
  const a = dx * dx + dz * dz, c = qx * qx + qz * qz - r * r;
  if (a === 0) { if (c > 0) return false; F[BA] = -Infinity; F[BB] = Infinity; return true; }
  const b = qx * dx + qz * dz, disc = b * b - a * c;
  if (disc < 0) return false;
  const s = Math.sqrt(disc);
  F[BA] = (-b - s) / a; F[BB] = (-b + s) / a;
  return true;
}
/** the cast's xz interval in tile (i, j)'s square grown by F[RAD] with round corners (convex: one interval): F[RA], F[RB] */
function roundSquare(i: number, j: number): boolean {
  const r = F[RAD];
  let a = Infinity, b = -Infinity;
  F[BX0] = i - r; F[BX1] = i + 1 + r; F[BZ0] = j; F[BZ1] = j + 1;
  if (boxXZ()) { if (F[BA] < a) a = F[BA]; if (F[BB] > b) b = F[BB]; }
  F[BX0] = i; F[BX1] = i + 1; F[BZ0] = j - r; F[BZ1] = j + 1 + r;
  if (boxXZ()) { if (F[BA] < a) a = F[BA]; if (F[BB] > b) b = F[BB]; }
  F[CCR] = r;
  for (let c = 0; c < 4; c++) {
    F[CCX] = i + (c & 1); F[CCZ] = j + (c >> 1);
    if (circleXZ()) { if (F[BA] < a) a = F[BA]; if (F[BB] > b) b = F[BB]; }
  }
  if (a > b) return false;
  F[RA] = a; F[RB] = b;
  return true;
}

/** write the contact at F[HT] with normal F[HNX..HNZ] into H */
function setHit(H: RayHit, kind: number, id: number, flags: number) {
  const t = F[HT];
  H.t = t; H.x = F[OX] + F[DX] * t; H.y = F[OY] + F[DY] * t; H.z = F[OZ] + F[DZ] * t;
  H.nx = F[HNX]; H.ny = F[HNY]; H.nz = F[HNZ]; H.kind = kind; H.id = id; H.flags = flags;
}


/** a point cast's contact in tile k = (i, j) between F[TIN] and F[TOUT] (entered across `axis`: 0 start, 1 x, 2 z,
 *  3 a corner): the earliest goes into H when it is nearer (or ties lower in kind order) */
function tileRay(G: Geo, k: number, i: number, j: number, axis: number, si: number, sj: number, mask: number, flags: number, H: RayHit): boolean {
  column(G, k, i, j, mask);
  const tIn = F[TIN], tOut = F[TOUT], maxT = F[MAXT];
  let found = false;
  for (let c = 0; c < CN; c++) {
    if (!yRange(c, j, false)) continue;
    const ya = F[YA], yb = F[YB];
    const initial = tIn === 0 && ya < 0 && yb > 0;
    const entry = tIn > ya ? tIn : ya, exit = Math.min(tOut, yb, maxT);
    if (!(initial || entry < exit)) continue;
    if (initial && flags & QF.skipInitialWorld) continue;
    const t = initial ? 0 : entry;
    if (t > H.t || (t === H.t && RANK[CK[c]] >= RANK[H.kind])) continue;
    if (initial) { F[HT] = 0; F[HNX] = -F[DX]; F[HNY] = -F[DY]; F[HNZ] = -F[DZ]; setHit(H, CK[c], k, CF.initial | CF.block); }
    else if (axis !== 0 && entry === tIn) { F[HT] = t; F[HNX] = axis === 2 ? 0 : -si; F[HNY] = 0; F[HNZ] = axis === 2 ? -sj : 0; setHit(H, CK[c], k, CF.block); }
    else if (c === CST) { const L = Math.sqrt(1 + F[SB] * F[SB]); F[HT] = t; F[HNX] = 0; F[HNY] = 1 / L; F[HNZ] = -F[SB] / L; setHit(H, CK[c], k, CF.block); }
    else { F[HT] = t; F[HNX] = 0; F[HNY] = F[DY] < 0 ? 1 : -1; F[HNZ] = 0; setHit(H, CK[c], k, CF.block); }
    found = true;
  }
  return found;
}

/** a fat cast's contact with tile (i, j) (outside the map: bounds): its footprint grown by F[RAD], intervals by F[HH] */
function tileFat(G: Geo, i: number, j: number, mask: number, flags: number, H: RayHit) {
  const k = i < 0 || j < 0 || i >= G.w || j >= G.h ? -1 : j * G.w + i;
  if (!roundSquare(i, j)) return;
  const ta = F[RA], tb = F[RB], maxT = F[MAXT];
  column(G, k, i, j, mask);
  for (let c = 0; c < CN; c++) {
    if (!yRange(c, j, true)) continue;
    const ya = F[YA], yb = F[YB];
    const initial = ta < 0 && tb > 0 && ya < 0 && yb > 0;
    const entry = Math.max(ta, ya, 0), exit = Math.min(tb, yb, maxT);
    if (!(initial || entry < exit)) continue;
    if (initial && flags & QF.skipInitialWorld) continue;
    const t = initial ? 0 : entry;
    if (t > H.t || (t === H.t && (RANK[CK[c]] > RANK[H.kind] || (RANK[CK[c]] === RANK[H.kind] && k >= H.id)))) continue;
    if (initial) { F[HT] = 0; F[HNX] = -F[DX]; F[HNY] = -F[DY]; F[HNZ] = -F[DZ]; setHit(H, CK[c], k, CF.initial | CF.block); }
    else if (entry === ta && ta >= ya) {
      // across the grown footprint: away from the nearest point of the tile's square
      const qx = F[GX] + F[DX] * t, qz = F[GZ] + F[DZ] * t, cx = qx < i ? i : qx > i + 1 ? i + 1 : qx, cz = qz < j ? j : qz > j + 1 ? j + 1 : qz;
      const ex = qx - cx, ez = qz - cz, L = Math.sqrt(ex * ex + ez * ez);
      if (L > 1e-12) { F[HT] = t; F[HNX] = ex / L; F[HNY] = 0; F[HNZ] = ez / L; setHit(H, CK[c], k, CF.block); }
      else { F[HT] = t; F[HNX] = -F[DX]; F[HNY] = 0; F[HNZ] = -F[DZ]; setHit(H, CK[c], k, CF.block); }
    } else { F[HT] = t; F[HNX] = 0; F[HNY] = F[DY] < 0 ? 1 : -1; F[HNZ] = 0; setHit(H, CK[c], k, CF.block); }
  }
}

/** fat casts: tiles already tested in this cast (one stamp per tile, a one-tile ring outside the map included) */
let tileStamp = new Uint32Array(0), tileGen = 0, stampW = 0;

/** the cast in F (origin, unit direction, length, radius, half-height) as a tile walk (Amanatides–Woo) over grid
 *  coordinates: the nearest contact of the masked world kinds into H */
export function castWorld(G: Geo, mask: number, flags: number, H: RayHit): boolean {
  H.t = Infinity; H.kind = 0; H.id = -1; H.flags = 0;
  SOFT = (flags & QF.foliage) !== 0; TOPS = (flags & QF.tops) !== 0;
  let maxT = F[MAXT];
  if (!(maxT >= 0)) maxT = 0;
  if (maxT === Infinity) maxT = 2 * (G.w + G.h) + 64;
  F[MAXT] = maxT;
  if ((mask & SK_WORLD) === 0) return false;
  const w = G.w, hh = G.h, fat = F[RAD] > 0, dx = F[DX], dz = F[DZ];
  if (fat && F[RAD] >= 1) throw new Error('spatial: world radius must be under 1 m');
  const gx = F[OX] + G.half, gz = F[OZ] + G.half;
  F[GX] = gx; F[GZ] = gz;
  let t0 = 0, i = Math.floor(gx), j = Math.floor(gz);
  if (i < 0 || j < 0 || i >= w || j >= hh) {
    if (mask & SK.bounds) { F[HT] = 0; F[HNX] = -dx; F[HNY] = -F[DY]; F[HNZ] = -dz; setHit(H, SK.bounds, -1, CF.initial | CF.block); return true; }
    // a start outside the map with the edge ignored: walk from where the cast enters it
    F[BX0] = 0; F[BZ0] = 0; F[BX1] = w; F[BZ1] = hh;
    if (!boxXZ() || F[BB] < 0 || F[BA] > maxT) return false;
    t0 = F[BA] > 0 ? F[BA] : 0;
    i = Math.min(w - 1, Math.max(0, Math.floor(gx + dx * t0)));
    j = Math.min(hh - 1, Math.max(0, Math.floor(gz + dz * t0)));
  }
  const si = dx > 0 ? 1 : dx < 0 ? -1 : 0, sj = dz > 0 ? 1 : dz < 0 ? -1 : 0;
  // the next boundary crossings, each computed fresh from the origin (no accumulated drift: corner ties stay exact)
  let tmx = si > 0 ? (i + 1 - gx) / dx : si < 0 ? (i - gx) / dx : Infinity;
  let tmz = sj > 0 ? (j + 1 - gz) / dz : sj < 0 ? (j - gz) / dz : Infinity;
  if (tmx < t0) tmx = t0;
  if (tmz < t0) tmz = t0;
  if (fat) {
    const sw = w + 2, need = sw * (hh + 2);
    if (tileStamp.length < need || stampW !== sw) { tileStamp = new Uint32Array(need); stampW = sw; tileGen = 0; }
    if (++tileGen === 0x3fffffff) { tileStamp.fill(0); tileGen = 1; }
  }
  let tIn = t0, axis = 0;
  for (let guard = 0; guard < 4 * (w + hh) + 16; guard++) {
    if (tIn > maxT) break;
    const tOut = tmx < tmz ? tmx : tmz;
    const inside = i >= 0 && j >= 0 && i < w && j < hh;
    if (!fat) {
      const k = inside ? j * w + i : -1;
      F[TIN] = tIn; F[TOUT] = tOut;
      if (tileRay(G, k, i, j, axis, si, sj, mask, flags, H)) return true;
      if (!inside) return false;
      // the corner seal: exactly through a corner whose two side tiles are both solid at the cast's height there
      if (tmx === tmz && tmx < maxT && si !== 0 && sj !== 0) {
        F[PY] = F[OY] + F[DY] * tmx; F[PZG] = j + (sj > 0 ? 1 : 0);
        const ia = i + si, ka = ia < 0 || ia >= w ? -1 : j * w + ia;
        const jb = j + sj, kb = jb < 0 || jb >= hh ? -1 : jb * w + i;
        const a = solidIn(G, ka, ia, j, mask);
        if (a && solidIn(G, kb, i, jb, mask)) { F[HT] = tmx; F[HNX] = -si; F[HNY] = 0; F[HNZ] = 0; setHit(H, a, ka, CF.block | CF.seal); return true; }
      }
    } else {
      if (!inside || tIn > H.t) break;
      for (let b = -1; b <= 1; b++) for (let a = -1; a <= 1; a++) {
        const ti = i + a, tj = j + b, s = (tj + 1) * stampW + ti + 1;
        if (tileStamp[s] === tileGen) continue;
        tileStamp[s] = tileGen;
        tileFat(G, ti, tj, mask, flags, H);
      }
    }
    if (tOut === Infinity) break;
    // step across the nearer boundary (both at an exact corner)
    if (tmx < tmz) { i += si; tIn = tmx; axis = 1; }
    else if (tmz < tmx) { j += sj; tIn = tmz; axis = 2; }
    else { i += si; j += sj; tIn = tmx; axis = 3; }
    if (axis & 1) tmx = si > 0 ? (i + 1 - gx) / dx : (i - gx) / dx;
    if (axis & 2) tmz = sj > 0 ? (j + 1 - gz) / dz : (j - gz) / dz;
  }
  return H.t !== Infinity;
}

export const LOS_HIT = new RayHit();

export function clearSegment(G: Geo, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, mask: number, flags: number): boolean {
  const dx = x1 - x0, dy = y1 - y0, dz = z1 - z0, L = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (L === 0) return pointSolid(G, x0, y0, z0, mask, flags) === 0;
  F[OX] = x0; F[OY] = y0; F[OZ] = z0; F[DX] = dx / L; F[DY] = dy / L; F[DZ] = dz / L; F[MAXT] = L; F[RAD] = 0; F[HH] = 0;
  return !castWorld(G, mask, flags & QF_WORLD, LOS_HIT);
}

// Generation edits the map layers in place during repairs. Each environmental state has its own map.
const mapGeometry = new WeakMap<ArenaMap, Geo>();

function geoOfMap(m: ArenaMap): Geo {
  let g = mapGeometry.get(m);
  if (!g || g.wall !== m.wall || g.elev !== m.elev || g.platform !== m.platform || g.terrain !== m.terrain ||
      g.stairs !== m.stairs || g.overSrc !== (m.over ?? null) || g.wlevelSrc !== m.wlevel || g.chasmSrc !== m.gen?.loc?.chasm) {
    g = new Geo(m);
    mapGeometry.set(m, g);
  }
  return g;
}

/** Exact physical sight on the supplied map state, in grid coordinates. Validation counts foliage and walls as cover. */
export function mapSegmentClear(m: ArenaMap, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): boolean {
  return clearSegment(geoOfMap(m), x0, y0, z0, x1, y1, z1, SK_WORLD, 0); // SK_WORLD is sim MASK.los
}

/** Tactical exposure, in grid coordinates and absolute heights. Keep the half-metre samples for
 *  legacy ground cover and endpoint footing. A thin overhead slab can fit between those samples
 *  (including on a vertical ray), so test it over the entire segment. Both read combat's columns.
 *  The map already represents the environmental state. Walls and foliage count as cover here. */
export function mapExposureClear(m: ArenaMap, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): boolean {
  const g = geoOfMap(m);
  const length = Math.hypot(x1 - x0, z1 - z0);
  return samplesClear(g, x0, y0, z0, x1, y1, z1, length, SK_WORLD & ~SK.deck) &&
    (!m.over || clearSegment(g, x0, y0, z0, x1, y1, z1, SK.deck, 0));
}

export function samplesClear(g: Geo, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, length: number, mask: number): boolean {
  const dx = x1 - x0, dy = y1 - y0, dz = z1 - z0, steps = Math.floor(length / 0.5);
  for (let s = 1; s < steps; s++) {
    const t = (s * 0.5) / length;
    if (pointSolid(g, x0 + dx * t, y0 + dy * t, z0 + dz * t, mask, 0)) return false;
  }
  return true;
}
