// Shared helpers for the procedural world (src/world/gen). Everything here is deterministic: integer hashing,
// fixed iteration order, heap ties broken by index, no Math.sin/cos/hypot (core/detmath has the ones we need).
import { T, type ArenaMap } from '../tiles';

export const DIRS4: readonly [number, number][] = [[1, 0], [0, 1], [-1, 0], [0, -1]];

/** Binary min-heap of (priority, value) with ties broken by value, so pop order never depends on insertion luck. */
export class Heap {
  private p: Float64Array; private v: Int32Array; n = 0;
  constructor(cap = 1024) { this.p = new Float64Array(cap); this.v = new Int32Array(cap); }
  private less(a: number, b: number) { return this.p[a] < this.p[b] || (this.p[a] === this.p[b] && this.v[a] < this.v[b]); }
  private swap(a: number, b: number) { const tp = this.p[a]; this.p[a] = this.p[b]; this.p[b] = tp; const tv = this.v[a]; this.v[a] = this.v[b]; this.v[b] = tv; }
  push(pr: number, val: number) {
    if (this.n === this.p.length) { const np = new Float64Array(this.n * 2), nv = new Int32Array(this.n * 2); np.set(this.p); nv.set(this.v); this.p = np; this.v = nv; }
    let i = this.n++; this.p[i] = pr; this.v[i] = val;
    while (i > 0) { const q = (i - 1) >> 1; if (!this.less(i, q)) break; this.swap(i, q); i = q; }
  }
  /** priority of the top */
  top() { return this.p[0]; }
  pop(): number {
    const out = this.v[0];
    this.n--;
    if (this.n > 0) {
      this.p[0] = this.p[this.n]; this.v[0] = this.v[this.n];
      let i = 0;
      for (;;) {
        const l = i * 2 + 1, r = l + 1;
        let m = i;
        if (l < this.n && this.less(l, m)) m = l;
        if (r < this.n && this.less(r, m)) m = r;
        if (m === i) break;
        this.swap(i, m); i = m;
      }
    }
    return out;
  }
  clear() { this.n = 0; }
}

/** Walkable for ground navigation, exactly as sim/world.ts decides it (navOpen). */
export function navOpen(m: ArenaMap, k: number) {
  return !m.wall[k] && m.terrain[k] !== T.water && m.platform[k] <= 0.6;
}

/** Tile-centre surface height, as sim/world.ts navTop (stairs ramp; bridges at 0.05; water at -0.25). */
export function navTop(m: ArenaMap, k: number) {
  const t = m.terrain[k];
  if (m.stairs[k]) return m.elev[k];
  if (t === T.water) return -0.25;
  if (t === T.wood) return 0.05;
  return m.elev[k] + m.platform[k];
}

/** Can a walker step from tile a to its 4-neighbour b? Mirrors World.canStep (stairs join north-south). */
export function canStep(m: ArenaMap, a: number, b: number) {
  if (!navOpen(m, b)) return false;
  if ((m.stairs[a] || m.stairs[b]) && Math.abs(a - b) === m.w) return true;
  return Math.abs(navTop(m, b) - navTop(m, a)) <= 0.6;
}

/** BFS distance in tiles from `src` over walkable tiles (Int32Array, -1 = unreached). */
export function walkDist(m: ArenaMap, src: number, out?: Int32Array): Int32Array {
  const W = m.w, H = m.h, n = W * H;
  const D = out ?? new Int32Array(n);
  D.fill(-1);
  if (src < 0 || !navOpen(m, src)) return D;
  const Q = new Int32Array(n);
  let h = 0, t = 0;
  D[src] = 0; Q[t++] = src;
  while (h < t) {
    const a = Q[h++], ai = a % W, aj = (a / W) | 0;
    for (let d = 0; d < 4; d++) {
      const ni = ai + DIRS4[d][0], nj = aj + DIRS4[d][1];
      if (ni < 0 || nj < 0 || ni >= W || nj >= H) continue;
      const b = nj * W + ni;
      if (D[b] >= 0 || !canStep(m, a, b)) continue;
      D[b] = D[a] + 1; Q[t++] = b;
    }
  }
  return D;
}

/** Multi-source BFS distance (4-neighbour, ignores walkability) to any tile where `isSrc` is true. */
export function distanceTo(W: number, H: number, isSrc: (k: number) => boolean, limit = 1e9): Int32Array {
  const n = W * H, D = new Int32Array(n).fill(-1), Q = new Int32Array(n);
  let h = 0, t = 0;
  for (let k = 0; k < n; k++) if (isSrc(k)) { D[k] = 0; Q[t++] = k; }
  while (h < t) {
    const a = Q[h++];
    if (D[a] >= limit) continue;
    const ai = a % W, aj = (a / W) | 0;
    for (let d = 0; d < 4; d++) {
      const ni = ai + DIRS4[d][0], nj = aj + DIRS4[d][1];
      if (ni < 0 || nj < 0 || ni >= W || nj >= H) continue;
      const b = nj * W + ni;
      if (D[b] >= 0) continue;
      D[b] = D[a] + 1; Q[t++] = b;
    }
  }
  return D;
}

/** Chebyshev-free squared distance helper */
export const d2 = (ax: number, ay: number, bx: number, by: number) => (ax - bx) * (ax - bx) + (ay - by) * (ay - by);

/** Deterministic 32-bit integer hash of up to four ints, as a float in [0, 1). */
export function hashf(a: number, b: number, c = 0, d = 0): number {
  let h = (Math.imul(a | 0, 0x27d4eb2d) ^ Math.imul(b | 0, 0x165667b1) ^ Math.imul(c | 0, 0x9e3779b1) ^ Math.imul(d | 0, 0x85ebca77)) | 0;
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

/** Combine a seed with an attempt number into a new 32-bit seed. */
export function mixSeed(seed: number, k: number) {
  let h = Math.imul((seed ^ 0x5bd1e995) >>> 0, 0x01000193) ^ Math.imul(k + 1, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h ^= h >>> 13;
  return h >>> 0;
}

/** Integer square root free distance: round(sqrt(x)) without Math.sqrt surprises (sqrt is exact in IEEE, kept for clarity). */
export const isqrt = (x: number) => Math.sqrt(x);

export const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
export const smoothstep = (a: number, b: number, x: number) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
