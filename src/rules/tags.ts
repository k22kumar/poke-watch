// Tag Actions (blueprint sections 5 to 7): tagging a Pokémon in fires one strong, aimed move toward the
// aim point (the opt-in swap system, src/sim/swap.ts). Each line has one; the survivor run's Tag variants were deleted
// at hero-shooter pivot step 9. Moves come from the line's own cross-game
// learnset where it has one, and every key must exist in the move database (tests/squad.test.ts).
// `create` leaves a body where the move lands (Rock Throw drops a rock).

import { MOVE_BY_KEY } from './moves';
import { defaultRules } from './defaults';
import { SPECIES_BY_ID } from './species';

export interface TagDef { move: string; create?: 'rock' }
export interface TagLine { base: TagDef }

/** keyed by the line's first form (rules/species lineage) */
export const TAG_ACTIONS: Record<string, TagLine> = {
  // partners
  totodile: { base: { move: 'aqua_tail' } },
  cyndaquil: { base: { move: 'flame_wheel' } },
  bulbasaur: { base: { move: 'vine_whip' } },
  charmander: { base: { move: 'fire_spin' } },
  squirtle: { base: { move: 'water_pulse' } },
  chikorita: { base: { move: 'razor_leaf' } },
  // wild Pokémon you can recruit
  rattata: { base: { move: 'quick_attack' } },
  geodude: { base: { move: 'rock_throw', create: 'rock' } },
  ledyba: { base: { move: 'mach_punch' } },
  sandshrew: { base: { move: 'rollout' } },
  oddish: { base: { move: 'acid' } },
  poliwag: { base: { move: 'bubble_beam' } },
  slugma: { base: { move: 'ember' } },
  vulpix: { base: { move: 'ember' } },
  mareep: { base: { move: 'thunder_shock' } },
  delibird: { base: { move: 'powder_snow' } },
  swinub: { base: { move: 'icy_wind' } },
  zubat: { base: { move: 'wing_attack' } },
  gastly: { base: { move: 'lick' } },
  paras: { base: { move: 'leech_life' } },
  houndour: { base: { move: 'fire_fang' } },
  heracross: { base: { move: 'horn_attack' } },
  joltik: { base: { move: 'electroweb' } },
  onix: { base: { move: 'rock_throw', create: 'rock' } },
  // the derived default (tagLineOf) would open with Covet: Snorlax leads with its weight instead
  snorlax: { base: { move: 'headbutt' } },
};

/** moves a derived Tag Action never uses: they knock out or exhaust the user, or need a condition the game lacks */
const TAG_SKIP = new Set(['self_destruct', 'explosion', 'last_resort', 'struggle', 'snore', 'belch', 'dream_eater', 'covet', 'final_gambit', 'memento']);

const derived = new Map<string, TagLine | null>();

/**
 * The Tag Action of a line, by the line's first form: the authored entry above, else a default derived from the
 * species' own level-up moves, so a new Pokémon has one without a hand-written entry: its earliest damaging move of
 * its own type (any damaging move if it has none). Add an entry above to choose a different move or a `create`.
 */
export function tagLineOf(id: string): TagLine | null {
  const authored = TAG_ACTIONS[id];
  if (authored) return authored;
  if (derived.has(id)) return derived.get(id)!;
  const sp = SPECIES_BY_ID[id];
  let line: TagLine | null = null;
  if (sp) {
    const learn = (sp.learnset?.length ? sp.learnset : sp.canon?.levelUp ?? [])
      .filter(([, k]) => MOVE_BY_KEY[k] && MOVE_BY_KEY[k].cls !== 'status' && MOVE_BY_KEY[k].power > 0 && !TAG_SKIP.has(k))
      .sort((a, b) => a[0] - b[0]);
    // a species that learns no damaging move tags in with the basic attack (rules.moves.fallbackAttack)
    const basic = defaultRules.moves.fallbackAttack;
    if (!learn.length && MOVE_BY_KEY[basic]) learn.push([1, basic]);
    const stab = learn.find(([, k]) => sp.elements.includes(MOVE_BY_KEY[k].element)) ?? learn[0];
    if (stab) line = { base: { move: stab[1] } };
  }
  derived.set(id, line);
  return line;
}
