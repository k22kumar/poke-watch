// A chasing crowd for tests and gates (docs/hero-shooter-pivot.md §10, Q21 amended 2026-11-20): the survivor director
// was the only source of a crowd that chases the player, and perf-sim, stuckwatch, the spatial crowd tests and the
// camera fight bench read one. Until the co-op wave (T1) exists, `crowd(n)` keeps n enemies alive around the player:
// plain spawnEnemy, every species a chase walker, put on the spawn ring (rules.enemy.spawnRadius).
//
// Not a game system: it lives here, not in src/sim, and no replay scenario uses it. It draws no random numbers of its
// own (spawnEnemy still draws its attack timer from rng.ai): the k-th spawn takes species[k % n] at golden-angle
// heading k and a radius stepped through the ring, skipping a spot its species may not use (src/sim/placement.ts).
import { dcos, dsin } from '../../src/core/detmath';
import { clamp } from '../../src/core/util';
import { SPECIES_BY_ID } from '../../src/rules/species';
import { spawnEnemy } from '../../src/sim/enemies';
import { allowedAt } from '../../src/sim/placement';
import type { Mod } from '../../src/mods/types';
import type { SimContext, System } from '../../src/sim/types';

/** chase walkers across the size classes, mostly small (the k-th spawn takes CROWD_SPECIES[k % length]) */
export const CROWD_SPECIES: readonly string[] = ['rattata', 'sandshrew', 'sentret', 'rattata', 'ekans', 'poliwag', 'gengar', 'sandshrew', 'cetoddle', 'centiskorch'];

const GOLDEN = Math.PI * (3 - Math.sqrt(5));

export interface CrowdOptions {
  /** the species cycle (each must be a chase walker); default CROWD_SPECIES */
  species?: readonly string[];
  /** at most this many spawns a tick while the crowd is below n (default 2) */
  perTick?: number;
}

/** the crowd as a System: tops the live enemy count up to `n` */
export function crowdSystem(n: number, o: CrowdOptions = {}): System {
  const species = o.species ?? CROWD_SPECIES, perTick = o.perTick ?? 2;
  for (const id of species) {
    const sp = SPECIES_BY_ID[id];
    if (!sp) throw new Error('crowd: unknown species ' + id);
    if ((sp.behaviour ?? 'chase') !== 'chase') throw new Error(`crowd: ${id} is not a chase walker (${sp.behaviour})`);
  }
  const next = new WeakMap<SimContext, number>();
  return {
    name: 'crowd',
    update(ctx: SimContext) {
      const P = ctx.player, b = ctx.world.bound, [rMin, rMax] = ctx.rules.enemy.spawnRadius;
      let k = next.get(ctx) ?? 0;
      for (let s = 0; s < perTick && ctx.enemies.count < n; s++) {
        for (let tries = 0; tries < 4; tries++, k++) {
          const id = species[k % species.length], a = k * GOLDEN, r = rMin + (rMax - rMin) * ((k * 0.618034) % 1);
          const x = clamp(P.x + dsin(a) * r, -b, b), z = clamp(P.z + dcos(a) * r, -b, b);
          if (!ctx.world.walkable(x, z) || !allowedAt(ctx, id, x, z)) continue;
          spawnEnemy(ctx, id, x, z);
          k++;
          break;
        }
      }
      next.set(ctx, k);
    },
  };
}

/** a Mod that adds the crowd where the survivor director used to run (before the targets and the grid) */
export function crowd(n: number, o: CrowdOptions = {}): Mod {
  const sys = crowdSystem(n, o);
  return {
    id: 'crowd', name: 'Crowd (tests)',
    systems: (list) => {
      const i = list.findIndex((s) => s.name === 'targets');
      return i < 0 ? [sys, ...list] : [...list.slice(0, i), sys, ...list.slice(i)];
    },
  };
}

/** add the crowd to a run already created (a test that builds its scene first) */
export function addCrowd(ctx: SimContext, n: number, o: CrowdOptions = {}) {
  const i = ctx.systems.findIndex((s) => s.name === 'targets');
  ctx.systems.splice(i < 0 ? 0 : i, 0, crowdSystem(n, o));
}
