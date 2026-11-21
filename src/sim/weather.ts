// Weather on the ground (docs/hero-shooter-pivot.md §11, owner 2026-11-20): the weather a move sets (src/sim/moves.ts,
// ctx.weather) acts on the tiles around the player through the cell agents (src/sim/cells.ts applyAgent). Twice a
// second: Rain soaks open ground, harsh Sun now and then lights the tall grass, Hail chills water and wet ground.
// Draws only from rng.world, and only while a weather is up. Moved out of the survivor director, where it ran for
// the director's regional weather events too (deleted with it).
import { dcos, dsin } from '../core/detmath';
import { applyAgent, CS } from './cells';
import type { SimContext, System } from './types';

export const weatherSystem: System = {
  name: 'weather',
  update(ctx: SimContext) {
    const el = ctx.weather.element;
    if (!el || ctx.tick % 30 !== 0) return;
    const P = ctx.player, W = ctx.world, C = W.cells;
    const tries = el === 'tide' ? 10 : el === 'blaze' ? 4 : el === 'frost' ? 8 : 0;
    for (let k = 0; k < tries; k++) {
      const a = ctx.rng.world.range(0, Math.PI * 2), r = ctx.rng.world.range(1, 14);
      const x = P.x + dsin(a) * r, z = P.z + dcos(a) * r;
      const t = C.tile(x, z);
      if (t < 0) continue;
      if (el === 'tide') { if (W.walkable(x, z)) applyAgent(ctx, 'wet', x, z, 1.2); }
      else if (el === 'blaze' && C.isGrass(t) && ctx.rng.world.next() < 0.35) applyAgent(ctx, 'heat', x, z, 0.6);
      else if (el === 'frost' && (C.isWater(t) || C.state[t] === CS.wet)) applyAgent(ctx, 'cold', x, z, 0.8);
    }
  },
};
