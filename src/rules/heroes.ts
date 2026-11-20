// Heroes: what a Pokémon brings to a match. Salvaged from progression (docs/hero-shooter-pivot.md §8 step 4); the kit
// rule (`heroKit`), the prototype list and the exclusions join it in later steps of the pivot. Pure rules: no sim state.
import { MOVE_BY_KEY } from './moves';
import { SPECIES, type SpeciesDef } from './species';
import { defaultRules } from './defaults';

/** a species' level-up moves: the curated partner set, else its cross-game level-up moves */
export function learnsetOf(sp: SpeciesDef): [number, string][] {
  if (sp.learnset?.length) return sp.learnset;
  return (sp.canon?.levelUp ?? []).filter(([, k]) => MOVE_BY_KEY[k]);
}

/** All forms in this line (base first) so evolved creatures keep earlier learnsets. */
export function lineage(sp: SpeciesDef): SpeciesDef[] {
  const out = [sp];
  let cur = sp;
  for (;;) {
    const pre = SPECIES.find((s) => s.evolvesTo === cur.id);
    if (!pre) break;
    out.unshift(pre);
    cur = pre;
  }
  return out;
}

/** The first attacks of a Pokémon arriving at `level`: its earliest non-status level-up moves (the first becomes the
 *  basic attack), else any non-status move it learns. Recruits join with these (sim/squad.ts addMember). */
export function firstAttacks(sp: SpeciesDef, level: number, count = 2): string[] {
  const keys = learnsetOf(sp).filter(([lv, k]) => lv <= Math.max(level, 1) && MOVE_BY_KEY[k] && MOVE_BY_KEY[k].cls !== 'status').map(([, k]) => k);
  const out = [...new Set(keys)].slice(0, count);
  if (!out.length) { const any = learnsetOf(sp).find(([, k]) => MOVE_BY_KEY[k] && MOVE_BY_KEY[k].cls !== 'status'); if (any) out.push(any[1]); }
  // a species that learns no damaging move (Cosmog) still has something to open with: the basic attack
  if (!out.length && MOVE_BY_KEY[defaultRules.moves.fallbackAttack]) out.push(defaultRules.moves.fallbackAttack);
  return out;
}

/** The move a run opens with: the species' curated starter, else its line's (an evolved partner picked directly),
 *  else its first attack, so any species can lead a run (docs/PLAYABILITY.md). */
export function openingMove(sp: SpeciesDef): string | undefined {
  return sp.starter ?? lineage(sp)[0].starter ?? firstAttacks(sp, 1, 1)[0];
}
