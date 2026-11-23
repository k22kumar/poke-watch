// Tile-grid navigation helpers the location and habitat generators share (src/world/locgen, src/world/habitat), moved
// here from the classic generator at C1. Deterministic: integer hashing, fixed iteration order. Deleted with the tile
// stack (docs/OVERHAUL_3D.md, X1b).
import { T, deckTop, type ArenaMap } from './tiles';

export const DIRS4: readonly [number, number][] = [[1, 0], [0, 1], [-1, 0], [0, -1]];

/** Walkable for ground navigation, exactly as sim/world.ts decides it (navOpen). */
export function navOpen(m: ArenaMap, k: number) {
  return !m.wall[k] && m.terrain[k] !== T.water && m.platform[k] <= 0.6;
}

/** Tile-centre surface height, as sim/world.ts navTop (stairs ramp; bridges at 0.05; water at -0.25). */
export function navTop(m: ArenaMap, k: number) {
  const t = m.terrain[k];
  if (m.stairs[k]) return m.elev[k];
  if (t === T.water) return -0.25;
  if (t === T.wood) return deckTop(m.elev[k]);
  return m.elev[k] + m.platform[k];
}

/** Can a walker step from tile a to its 4-neighbour b? Mirrors World.canStep (stairs join north-south). */
export function canStep(m: ArenaMap, a: number, b: number) {
  if (!navOpen(m, b)) return false;
  if ((m.stairs[a] || m.stairs[b]) && Math.abs(a - b) === m.w) return true;
  return Math.abs(navTop(m, b) - navTop(m, a)) <= 0.6;
}

/** Combine a seed with an attempt number into a new 32-bit seed. */
export function mixSeed(seed: number, k: number) {
  let h = Math.imul((seed ^ 0x5bd1e995) >>> 0, 0x01000193) ^ Math.imul(k + 1, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h ^= h >>> 13;
  return h >>> 0;
}
