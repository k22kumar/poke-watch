// Navigation and sight on a finished map, mirroring the sim exactly (sim/world.ts with dropNav, sim/player.ts):
//   enemy move f → t: both open, and a step of ≤ 0.6 m, a stair flight north–south, or a drop of ≤ dropNav
//   player move f → t: t not wall or water, and a rise of ≤ 2.4 m (a jump reaches 1.84 m and then steps 0.6 m)
// The enemy graph is directed (drops), so connectivity means strong connectivity: every enemy tile must be able to
// reach the spawn and be reached from it, or enemies get trapped and the player finds unreachable perches.
import { DIRS4, canStep as symStep, navOpen, navTop } from '../gen/util';
import { T, type ArenaMap } from '../tiles';
import { blockMask, blockNeighbours, blockNodes, type NavGrid } from '../navblocks';

export const PLAYER_CLIMB = 2.4;

export function enemyMove(m: ArenaMap, f: number, t: number, drop: number): boolean {
  if (!navOpen(m, f) || !navOpen(m, t)) return false;
  if (symStep(m, f, t)) return true;
  const d = navTop(m, f) - navTop(m, t);
  return d > 0 && d <= drop;
}

// Layered maps (ArenaMap.over, locgen/decks.ts): node k < n is the ground of tile k, node n + k its deck. Every helper
// below works on nodes; on a map without decks there are only ground nodes and they behave exactly as before.
const nodes = (m: ArenaMap) => (m.over ? 2 : 1) * m.w * m.h;
const nTop = (m: ArenaMap, a: number) => { const n = m.w * m.h; return a >= n ? m.over![a - n] : navTop(m, a); };
const nOpen = (m: ArenaMap, a: number) => { const n = m.w * m.h; return a >= n ? true : navOpen(m, a); };
/** symmetric enemy step between 4-adjacent nodes (stairs only on the ground) */
function nodeStep(m: ArenaMap, a: number, b: number): boolean {
  const n = m.w * m.h;
  if (!lands(m, a, b) || !lands(m, b, a)) return false;
  if (a < n && b < n) return symStep(m, a, b);
  if (!nOpen(m, b)) return false;
  return Math.abs(nTop(m, b) - nTop(m, a)) <= 0.6;
}
/** a walker on node f entering t's tile lands on its deck when within reach of it (World.height), else the ground */
function lands(m: ArenaMap, f: number, t: number): boolean {
  if (!m.over) return true;
  const n = m.w * m.h, ov = m.over[t % n];
  return (ov > 0 && nTop(m, f) >= ov - 0.9) === t >= n;
}
function nodeMove(m: ArenaMap, f: number, t: number, drop: number): boolean {
  const n = m.w * m.h;
  if (!lands(m, f, t)) return false;
  if (f < n && t < n) return enemyMove(m, f, t, drop);
  if (!nOpen(m, f) || !nOpen(m, t)) return false;
  if (nodeStep(m, f, t)) return true;
  const d = nTop(m, f) - nTop(m, t);
  return d > 0 && d <= drop;
}

function bfs(m: ArenaMap, src: number, ok: (a: number, b: number) => boolean): Uint8Array {
  const W = m.w, H = m.h, n = W * H, N = nodes(m), seen = new Uint8Array(N), Q = new Int32Array(N);
  let h = 0, t = 0;
  seen[src] = 1; Q[t++] = src;
  while (h < t) {
    const a = Q[h++], ka = a % n, x = ka % W, y = (ka / W) | 0;
    for (const [dx, dy] of DIRS4) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const b = ny * W + nx;
      if (!seen[b] && ok(a, b)) { seen[b] = 1; Q[t++] = b; }
      if (m.over && m.over[b] > 0 && !seen[n + b] && ok(a, n + b)) { seen[n + b] = 1; Q[t++] = n + b; }
    }
  }
  return seen;
}

/** The map as a navigation grid for the shared wide lattice (world/navblocks.ts): symmetric enemy steps (nodeStep). */
export function navGrid(m: ArenaMap): NavGrid {
  return { w: m.w, h: m.h, over: m.over ?? null, open: (k) => navOpen(m, k), step: (a, b) => nodeStep(m, a, b) };
}

/** nodes a wide body fits on: every node of a wide 2 × 2 block (world/navblocks.ts, the sim's wide field reads the same
 *  lattice) */
export function wideMask(m: ArenaMap): Uint8Array {
  const g = navGrid(m), B = blockMask(g), n = m.w * m.h, M = new Uint8Array(nodes(m)), t = new Int32Array(4);
  for (let b = 0; b < B.length; b++) if (B[b] && blockNodes(g, (b % n) % m.w, ((b % n) / m.w) | 0, (b / n) | 0, t)) for (let q = 0; q < 4; q++) M[t[q]] = 1;
  return M;
}

/** Wide blocks reachable from the hub through linked wide blocks (the lattice is symmetric, so reach is strong
 *  connectivity): the block indices, and every node they cover. Seeded from every wide block that covers the hub tile. */
export function wideBlocksFrom(m: ArenaMap, hub: number, diag = false): { blocks: Uint8Array; nodes: Uint8Array } {
  const g = navGrid(m), B = blockMask(g), n = m.w * m.h, W = m.w, seen = new Uint8Array(B.length), cover = new Uint8Array(nodes(m));
  const Q = new Int32Array(B.length), nb = new Int32Array(16), ta = new Int32Array(4), tb = new Int32Array(4);
  let h = 0, t = 0;
  const hi = hub % W, hj = (hub / W) | 0;
  for (let L = 0; L < B.length / n; L++) for (let dj = -1; dj <= 0; dj++) for (let di = -1; di <= 0; di++) {
    const i = hi + di, j = hj + dj;
    if (i < 0 || j < 0 || i >= W - 1 || j >= m.h - 1) continue;
    const b = L * n + j * W + i;
    if (B[b] && !seen[b]) { seen[b] = 1; Q[t++] = b; }
  }
  while (h < t) {
    const a = Q[h++];
    const c = blockNeighbours(g, B, a, nb, ta, tb, diag);
    for (let q = 0; q < c; q++) if (!seen[nb[q]]) { seen[nb[q]] = 1; Q[t++] = nb[q]; }
  }
  for (let b = 0; b < B.length; b++) if (seen[b] && blockNodes(g, (b % n) % W, ((b % n) / W) | 0, (b / n) | 0, ta)) for (let q = 0; q < 4; q++) cover[ta[q]] = 1;
  return { blocks: seen, nodes: cover };
}

/** the hub's component for a wide body: every node covered by a wide block reachable from the hub (`drop` is unused —
 *  wide routes take no ledge drops, see world/navblocks.ts) */
export function wideCore(m: ArenaMap, hub: number, _drop?: number, diag = false): Uint8Array {
  return wideBlocksFrom(m, hub, diag).nodes;
}

/** nodes in the hub's strongly connected component under enemy movement (index k < w·h: ground; n + k: decks) */
export function enemyCore(m: ArenaMap, hub: number, drop: number): Uint8Array {
  const fwd = bfs(m, hub, (a, b) => nodeMove(m, a, b, drop));
  const back = bfs(m, hub, (a, b) => nodeMove(m, b, a, drop));
  const out = new Uint8Array(fwd.length);
  for (let k = 0; k < out.length; k++) out[k] = fwd[k] & back[k];
  return out;
}

const standTop = (m: ArenaMap, k: number) => (k >= m.w * m.h ? m.over![k - m.w * m.h] : m.stairs[k] ? m.elev[k] : navTop(m, k));

/** nodes the player can stand on from the hub (jumps up to PLAYER_CLIMB, any drop, low props are standable) */
export function playerReach(m: ArenaMap, hub: number): Uint8Array {
  const n = m.w * m.h;
  return bfs(m, hub, (a, b) => {
    if (!lands(m, a, b) && !(b >= n && standTop(m, b) - standTop(m, a) <= PLAYER_CLIMB && standTop(m, b) - standTop(m, a) > 0.9)) return false;
    if (b < n && (m.wall[b] || m.terrain[b] === T.water)) return false;
    if (a < n && b < n && (m.stairs[a] || m.stairs[b]) && Math.abs(a - b) === m.w) return true;
    return standTop(m, b) - standTop(m, a) <= PLAYER_CLIMB;
  });
}

/** surface height for sight tests (as World.height at a tile centre) */
const surf = (m: ArenaMap, k: number) => navTop(m, k);

/** 3D line of sight between tile centres at given heights above their surfaces (World.sight's rule) */
export function sightTiles(m: ArenaMap, a: number, ha: number, b: number, hb: number): boolean {
  const W = m.w;
  const x0 = (a % W) + 0.5, z0 = ((a / W) | 0) + 0.5, x1 = (b % W) + 0.5, z1 = ((b / W) | 0) + 0.5;
  const y0 = surf(m, a) + ha, y1 = surf(m, b) + hb;
  const dx = x1 - x0, dz = z1 - z0, L = Math.sqrt(dx * dx + dz * dz), n = Math.floor(L / 0.5);
  for (let s = 1; s < n; s++) {
    const t = (s * 0.5) / L;
    const x = Math.floor(x0 + dx * t), z = Math.floor(z0 + dz * t);
    const k = z * W + x, y = y0 + (y1 - y0) * t;
    if (m.over && m.over[k] > 0 && y >= m.over[k] - 0.9) { if (m.over[k] > y) return false; continue; }
    if (m.wall[k]) return false;
    if (surf(m, k) > y) return false;
  }
  return true;
}

/** BFS path (tile list) between two tiles over `allowed` with symmetric enemy steps, avoiding `avoid` when set */
export function pathBetween(m: ArenaMap, a: number, b: number, allowed: Uint8Array, cost?: Uint8Array): number[] | null {
  // Dial's algorithm with edge cost 1, or 4 into tiles marked in `cost`; nodes on layered maps (decks)
  const W = m.w, n = W * m.h, N = nodes(m);
  const D = new Int32Array(N).fill(-1), prev = new Int32Array(N).fill(-1);
  const buckets: number[][] = [[a]];
  D[a] = 0;
  for (let d = 0; d < buckets.length; d++) {
    const q = buckets[d];
    if (!q) continue;
    for (let i = 0; i < q.length; i++) {
      const u = q[i];
      if (D[u] !== d) continue;
      if (u === b) break;
      const ku = u % n, x = ku % W, y = (ku / W) | 0;
      for (const [dx, dy] of DIRS4) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= m.h) continue;
        const t = ny * W + nx;
        for (const v of m.over && m.over[t] > 0 ? [t, n + t] : [t]) {
          if (!allowed[v] || !nodeStep(m, u, v)) continue;
          const nd = d + (cost && cost[v] ? 4 : 1);
          if (D[v] >= 0 && D[v] <= nd) continue;
          D[v] = nd; prev[v] = u;
          (buckets[nd] ??= []).push(v);
        }
      }
    }
  }
  if (D[b] < 0) return null;
  const out: number[] = [];
  for (let k = b; k >= 0; k = prev[k]) out.push(k);
  return out.reverse();
}
