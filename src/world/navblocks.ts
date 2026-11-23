// The wide navigation lattice (docs/SIZING.md "Navigation classes"). A footprint at or above rules.size.heavyRadius
// (0.5 m) does not fit a one-tile passage, so it does not route on tile centres: it routes on 2 × 2 blocks of tiles,
// centred at their shared corner. The sim (sim/world.ts) and the location validator (world/locgen/nav.ts) both read
// these functions, so the field a wide enemy follows and the gate that proves a map's essential spaces are reachable
// decide the same way.
//
// A block (i, j) is the tiles (i, j), (i+1, j), (i, j+1), (i+1, j+1), in that order (q = 0..3). On a decked map it
// has up to two variants: L = 0 takes each tile's ground when it is open and its deck otherwise, L = 1 its deck when
// it has one and its ground otherwise. The upper variant exists only where it differs, i.e. some tile has open ground
// under a deck. A variant is **wide** when all four nodes exist and the four orthogonal edges inside it are symmetric
// steps (a step of ≤ 0.6 m or a stair flight north–south, both ways). Two blocks are **linked** when they are adjacent
// and their shared tiles resolve to the same nodes.
//
// Why this is what collision allows (World.moveBody): a circle of radius r < 1 m centred on a block's centre lies
// inside the block's 2 m square; moved to an adjacent linked block's centre, it sweeps a 2 × 3 rectangle that is the
// union of the two blocks, every tile of which is open and joined by steps. Diagonal moves require both orthogonal
// blocks, so the sweep stays inside their 3 × 3 union. A ledge drop is never inside a wide block: wide routes climb
// and descend by ramps and stairs only (a drop is physically open to them; navigation just does not plan one).
//
// Earlier both callers accepted a block only when `max - min` of its four heights was ≤ 0.6 m. On a diagonal ramp
// (0.5 m per tile along its line) the orthogonal steps are ≤ 0.45 m but the block's diagonal spans 0.61-0.67 m, so
// every ramp tile read as too narrow, and a bridge abutment (two ground tiles, two deck tiles) fitted neither layer.
// That made a two-tile boss route look missing on 27-63 % of location seeds where one existed on all of them.

export interface NavGrid {
  readonly w: number;
  readonly h: number;
  /** deck heights per tile (> 0 where a deck is), or null on a single-layer map */
  readonly over: Float32Array | null;
  /** the ground node of tile k is open (walkable ground) */
  open(k: number): boolean;
  /** a symmetric step between 4-adjacent nodes a and b (k < w·h: ground of tile k; w·h + k: its deck) */
  step(a: number, b: number): boolean;
}

/** The four nodes of block (i, j) in variant L, into out[0..3]; false when a tile has no node there or the variant
 *  duplicates the lower one. Does not test steps. */
export function blockNodes(g: NavGrid, i: number, j: number, L: number, out: Int32Array): boolean {
  const W = g.w, n = W * g.h, ov = g.over;
  if (i < 0 || j < 0 || i >= W - 1 || j >= g.h - 1) return false;
  let both = false;
  for (let q = 0; q < 4; q++) {
    const k = (j + (q >> 1)) * W + i + (q & 1);
    const deck = ov !== null && ov[k] > 0, ground = g.open(k);
    if (deck && ground) both = true;
    const node = L === 1 ? (deck ? n + k : ground ? k : -1) : ground ? k : deck ? n + k : -1;
    if (node < 0) return false;
    out[q] = node;
  }
  return L === 0 || both;
}

/** Is variant L of block (i, j) wide (four nodes, every inner orthogonal edge a symmetric step)? */
export function wideBlock(g: NavGrid, i: number, j: number, L: number, tmp: Int32Array): boolean {
  if (!blockNodes(g, i, j, L, tmp)) return false;
  return g.step(tmp[0], tmp[1]) && g.step(tmp[2], tmp[3]) && g.step(tmp[0], tmp[2]) && g.step(tmp[1], tmp[3]);
}

/** Wide blocks of the whole map: index L·w·h + j·w + i (2·w·h long on a decked map, w·h otherwise). */
export function blockMask(g: NavGrid): Uint8Array {
  const W = g.w, H = g.h, n = W * H, layers = g.over ? 2 : 1, M = new Uint8Array(layers * n), tmp = new Int32Array(4);
  for (let L = 0; L < layers; L++) for (let j = 0; j < H - 1; j++) for (let i = 0; i < W - 1; i++) if (wideBlock(g, i, j, L, tmp)) M[L * n + j * W + i] = 1;
  return M;
}

/** Are wide blocks a and b (block indices as in blockMask) 4-adjacent with their shared tiles on the same nodes? */
function blocksLinked(g: NavGrid, a: number, b: number, ta: Int32Array, tb: Int32Array): boolean {
  const W = g.w, n = W * g.h, ka = a % n, kb = b % n, ai = ka % W, aj = (ka / W) | 0, bi = kb % W, bj = (kb / W) | 0;
  if (!blockNodes(g, ai, aj, (a / n) | 0, ta) || !blockNodes(g, bi, bj, (b / n) | 0, tb)) return false;
  if (bj === aj && bi === ai + 1) return ta[1] === tb[0] && ta[3] === tb[2];
  if (bj === aj && bi === ai - 1) return ta[0] === tb[1] && ta[2] === tb[3];
  if (bi === ai && bj === aj + 1) return ta[2] === tb[0] && ta[3] === tb[1];
  if (bi === ai && bj === aj - 1) return ta[0] === tb[2] && ta[1] === tb[3];
  return false;
}

/** Are wide blocks a and b diagonal neighbours sharing their one common tile on the same node? A circle of radius
 *  r < DIAG_R moved between their centres stays inside their union: the two tiles the union lacks are √½ m from the
 *  segment. That is what lets a Large body (0.66 m) take a two-tile trail that steps along a diagonal (about 1.41 m
 *  across), where an Extra Large one (0.88 m) does not fit. */
function blocksDiagonal(g: NavGrid, a: number, b: number, ta: Int32Array, tb: Int32Array): boolean {
  const W = g.w, n = W * g.h, ka = a % n, kb = b % n, di = (kb % W) - (ka % W), dj = ((kb / W) | 0) - ((ka / W) | 0);
  if (Math.abs(di) !== 1 || Math.abs(dj) !== 1) return false;
  if (!blockNodes(g, ka % W, (ka / W) | 0, (a / n) | 0, ta) || !blockNodes(g, kb % W, (kb / W) | 0, (b / n) | 0, tb)) return false;
  const q = (dj > 0 ? 2 : 0) + (di > 0 ? 1 : 0);
  return ta[q] === tb[3 - q];
}
/** the largest footprint that may take a diagonal-only block link (√½ m, less a margin for float positions) */
export const DIAG_R = 0.7;

/** The wide blocks adjacent to block a and linked to it (both variants), into out; returns how many (≤ 16). With
 *  `diag`, diagonal neighbours sharing a tile count too (footprints under DIAG_R). */
export function blockNeighbours(g: NavGrid, M: Uint8Array, a: number, out: Int32Array, ta: Int32Array, tb: Int32Array, diag = false): number {
  const W = g.w, H = g.h, n = W * H, layers = M.length / n, k = a % n, i = k % W, j = (k / W) | 0;
  let c = 0;
  for (let s = 0; s < (diag ? 8 : 4); s++) {
    const ni = i + (s === 0 || s === 4 || s === 6 ? -1 : s === 1 || s === 5 || s === 7 ? 1 : 0);
    const nj = j + (s === 2 || s === 4 || s === 5 ? -1 : s === 3 || s === 6 || s === 7 ? 1 : 0);
    if (ni < 0 || nj < 0 || ni >= W - 1 || nj >= H - 1) continue;
    for (let L = 0; L < layers; L++) {
      const b = L * n + nj * W + ni;
      if (M[b] && (s < 4 ? blocksLinked(g, a, b, ta, tb) : blocksDiagonal(g, a, b, ta, tb))) out[c++] = b;
    }
  }
  return c;
}

/** World-space centre of block index b (its four tiles' shared corner) for a map of half-size `half`. */
export function blockCentre(W: number, n: number, half: number, b: number): [number, number] {
  const k = b % n;
  return [(k % W) + 1 - half, ((k / W) | 0) + 1 - half];
}
