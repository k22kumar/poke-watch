// Tag Actions (blueprint sections 5 to 7): tagging a Pokémon in fires one strong, aimed move toward the
// aim point. Each line has a base move and a variant it can switch to at its first evolution (or at
// rules.squad.variantLevel for Pokémon that do not evolve). Moves come from the line's own cross-game
// learnset where it has one, and every key must exist in the move database (tests/squad.test.ts).
// `create` leaves a body where the move lands (Rock Throw drops a rock).

import { MOVE_BY_KEY } from './moves';
import { defaultRules } from './defaults';
import { SPECIES_BY_ID } from './species';

export interface TagDef { move: string; create?: 'rock' }
export interface TagLine { base: TagDef; variant: TagDef }

/** keyed by the line's first form (rules/species lineage) */
export const TAG_ACTIONS: Record<string, TagLine> = {
  // partners
  totodile: { base: { move: 'aqua_tail' }, variant: { move: 'ice_fang' } },
  cyndaquil: { base: { move: 'flame_wheel' }, variant: { move: 'lava_plume' } },
  bulbasaur: { base: { move: 'vine_whip' }, variant: { move: 'seed_bomb' } },
  charmander: { base: { move: 'fire_spin' }, variant: { move: 'flamethrower' } },
  squirtle: { base: { move: 'water_pulse' }, variant: { move: 'rapid_spin' } },
  chikorita: { base: { move: 'razor_leaf' }, variant: { move: 'magical_leaf' } },
  // wild Pokémon you can recruit
  rattata: { base: { move: 'quick_attack' }, variant: { move: 'bite' } },
  geodude: { base: { move: 'rock_throw', create: 'rock' }, variant: { move: 'magnitude' } },
  ledyba: { base: { move: 'mach_punch' }, variant: { move: 'silver_wind' } },
  sandshrew: { base: { move: 'rollout' }, variant: { move: 'slash' } },
  oddish: { base: { move: 'acid' }, variant: { move: 'mega_drain' } },
  poliwag: { base: { move: 'bubble_beam' }, variant: { move: 'water_gun' } },
  slugma: { base: { move: 'ember' }, variant: { move: 'rock_throw', create: 'rock' } },
  vulpix: { base: { move: 'ember' }, variant: { move: 'flamethrower' } },
  mareep: { base: { move: 'thunder_shock' }, variant: { move: 'discharge' } },
  delibird: { base: { move: 'powder_snow' }, variant: { move: 'ice_shard' } },
  swinub: { base: { move: 'icy_wind' }, variant: { move: 'ice_shard' } },
  zubat: { base: { move: 'wing_attack' }, variant: { move: 'air_cutter' } },
  gastly: { base: { move: 'lick' }, variant: { move: 'shadow_ball' } },
  paras: { base: { move: 'leech_life' }, variant: { move: 'slash' } },
  houndour: { base: { move: 'fire_fang' }, variant: { move: 'ember' } },
  heracross: { base: { move: 'horn_attack' }, variant: { move: 'brick_break' } },
  joltik: { base: { move: 'electroweb' }, variant: { move: 'discharge' } },
  onix: { base: { move: 'rock_throw', create: 'rock' }, variant: { move: 'rock_slide' } },
  // the derived default (tagLineOf) would open with Covet: Snorlax leads with its weight instead
  snorlax: { base: { move: 'headbutt' }, variant: { move: 'body_slam' } },
};

/** moves a derived Tag Action never uses: they knock out or exhaust the user, or need a condition the game lacks */
const TAG_SKIP = new Set(['self_destruct', 'explosion', 'last_resort', 'struggle', 'snore', 'belch', 'dream_eater', 'covet', 'final_gambit', 'memento']);

const derived = new Map<string, TagLine | null>();

/**
 * The Tag Action of a line, by the line's first form: the authored entry above, else a default derived from the
 * species' own level-up moves, so a new Pokémon is recruitable without a hand-written entry. The default's base
 * is its earliest damaging move of its own type (any damaging move if it has none), its variant the strongest
 * other damaging move it learns by Lv 30. Add an entry above to choose different moves or a `create`.
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
    if (stab) {
      const rest = learn.filter(([lv, k]) => k !== stab[1] && lv <= 30);
      const strongest = rest.reduce<[number, string] | undefined>((best, m) => (!best || MOVE_BY_KEY[m[1]].power > MOVE_BY_KEY[best[1]].power ? m : best), undefined);
      line = { base: { move: stab[1] }, variant: { move: (strongest ?? stab)[1] } };
    }
  }
  derived.set(id, line);
  return line;
}
