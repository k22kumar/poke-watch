// Tag Actions (blueprint sections 5 to 7): tagging a Pokémon in fires one strong, aimed move toward the
// aim point. Each line has a base move and a variant it can switch to at its first evolution (or at
// rules.squad.variantLevel for Pokémon that do not evolve). Moves come from the line's own cross-game
// learnset where it has one, and every key must exist in the move database (tests/squad.test.ts).
// `create` leaves a body where the move lands (Rock Throw drops a rock).

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
};
