// Placement: where a creature may legally appear. Salvaged from the director (docs/hero-shooter-pivot.md §8 step 4)
// because it is the only code that puts a wide footprint down legally: training targets, bots and any future spawner
// use it. A spot is allowed when the species' habitat restrictions accept the tile it would stand on
// (src/rules/profiles.ts `requires` / `avoids`) and, for a ground body whose footprint routes on the wide field, when
// that field reaches the spot at the body's own height (docs/SIZING.md "Navigation classes").
import { SPECIES_BY_ID } from '../rules/species';
import { habitatAllows, traversalOf } from '../rules/profiles';
import { enemyHeight, footprintOf, navWide } from '../rules/sizing';
import { DIAG_R } from '../world/navblocks';
import type { SimContext } from './types';

/** the tile a species would actually stand on at (x, z): spawnEnemy snaps a ground spawn off a wall or out of water to
 *  the nearest walkable tile, so compatibility is judged there (flyers hover where they appear) */
export function standAt(ctx: SimContext, id: string, x: number, z: number): [number, number] {
  const W = ctx.world;
  const sp = SPECIES_BY_ID[id];
  if ((sp && !traversalOf(sp, ctx.rules).groundNav) || W.walkable(x, z)) return [x, z];
  return W.nearestWalkable(x, z);
}

/** may `id` appear at (x, z) at this body size (E.size)? Its habitat restrictions, and
 *  room for a ground footprint that routes on the wide field: not in a one-tile pocket, not at an entrance only small
 *  bodies fit. A body taller than a deck's gap is judged on its own height's field. */
export function allowedAt(ctx: SimContext, id: string, x: number, z: number, roleSize = 1): boolean {
  const [sx, sz] = standAt(ctx, id, x, z), W = ctx.world;
  if (!habitatAllows(id, W.habitatAt(sx, sz))) return false;
  const sp = SPECIES_BY_ID[id];
  const foot = sp && traversalOf(sp, ctx.rules).groundNav ? footprintOf(sp, roleSize, ctx.rules) : 0;
  if (foot > 0 && navWide(foot, ctx.rules) && !W.wideReached(sx, sz, foot < DIAG_R, undefined, enemyHeight(sp, roleSize, ctx.rules))) return false;
  return true;
}
