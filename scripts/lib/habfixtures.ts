// Controlled fixtures for the habitat generator's retry, fallback and failure paths (scripts/habaudit.ts,
// tests/habaudit.test.ts). Nothing here ships in the game: it registers throwaway recipes or injects an attempt function.
import { attemptHabitat, HABITATS, type HabAttempt } from '../../src/world/habitat';
import { HK } from '../../src/world/habitat/ctx';
import { LANDFORMS } from '../../src/world/habitat/landforms';
import type { HabitatRecipe } from '../../src/world/habitat/types';

/** an attempt function that really generates and validates the seeds `accept` allows and rejects every other seed with a
 *  named gate; `log` records each seed it was asked for, in order (retries, then fallbacks) */
export function scriptedAttempt(accept: (seed: number) => boolean, log: number[] = [], why = 'fixture:rejected'): typeof attemptHabitat {
  return (recipe, mode, seed, size, variant, profiles): HabAttempt => {
    log.push(seed);
    if (accept(seed)) return attemptHabitat(recipe, mode, seed, size, variant, profiles);
    return { g: undefined as never, report: undefined as never, identity: [], ok: false, failed: [why] };
  };
}

const originals = new Map<string, (g: import('../../src/world/habitat/ctx').HabCtx) => void>();

/** register a copy of `base` under `id` whose landform walls the contest in for every seed not in `good`: those seeds
 *  fail the real validator (reach, planned) on the real pipeline, and the `good` seeds are untouched. The kernel is
 *  wrapped, not replaced: every other recipe and every `good` seed builds exactly as in the game. Call unregister(id). */
export function registerPoisoned(id: string, base: HabitatRecipe, good: number[], fallbackSeeds: number[] = [good[0]]): HabitatRecipe {
  const name = base.landform;
  if (!originals.has(name)) originals.set(name, LANDFORMS[name]);
  const kernel = originals.get(name)!, prev = LANDFORMS[name];
  LANDFORMS[name] = (g) => {
    prev(g);
    if (g.recipe.id !== id || good.includes(g.seed)) return;
    const c = g.contest;
    for (let k = 0; k < g.S * g.S; k++) {
      const d = Math.hypot((k % g.S) + 0.5 - c.x, ((k / g.S) | 0) + 0.5 - c.y);
      if (d > c.r + 1.5 && d < c.r + 4.5) { g.kind[k] = HK.mass; g.H[k] = Math.max(g.H[k], c.h + 3); }
    }
  };
  void kernel;
  const R: HabitatRecipe = { ...base, id, name: 'Fixture ' + base.name, fallbackSeeds };
  HABITATS[id] = R;
  return R;
}

/** register a copy of `base` under `id` with the given recipe fields replaced (a witness of an old or broken definition) */
export function registerRecipe(id: string, base: HabitatRecipe, patch: Partial<HabitatRecipe>): HabitatRecipe {
  const R: HabitatRecipe = { ...base, ...patch, id };
  HABITATS[id] = R;
  return R;
}

export function unregister(id: string) {
  delete HABITATS[id];
  // restore the kernels the wrappers sat on (every poisoned recipe of a landform shares one wrapper chain)
  if (!Object.keys(HABITATS).some((k) => k.startsWith('fixture-'))) for (const [n, k] of originals) LANDFORMS[n] = k;
}
