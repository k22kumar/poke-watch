// Abilities: canonical PokéAPI abilities, including hidden abilities, mapped onto
// explicit survival-game adaptations. Each Pokémon uses the first of its canonical abilities that
// is supported here; unsupported ones are listed with the reason so the gap is visible.
import type { SpeciesDef } from './species';

export interface AbilityDef {
  name: string;
  /** what it does in the main games (short) */
  canon: string;
  /** what it does here; empty when unsupported */
  game: string;
  supported: boolean;
}

export const ABILITIES: Record<string, AbilityDef> = {
  overgrow: { name: 'Overgrow', canon: 'Grass moves ×1.5 at ≤ 1/3 HP', game: 'Grass moves ×1.5 at ≤ 1/3 HP (green aura)', supported: true },
  blaze: { name: 'Blaze', canon: 'Fire moves ×1.5 at ≤ 1/3 HP', game: 'Fire moves ×1.5 at ≤ 1/3 HP (orange aura)', supported: true },
  torrent: { name: 'Torrent', canon: 'Water moves ×1.5 at ≤ 1/3 HP', game: 'Water moves ×1.5 at ≤ 1/3 HP (blue aura)', supported: true },
  levitate: { name: 'Levitate', canon: 'Immune to Ground moves', game: 'Immune to Ground damage', supported: true },
  flash_fire: { name: 'Flash Fire', canon: 'Immune to Fire; its Fire moves ×1.5 after absorbing one', game: 'Immune to Fire damage; after absorbing Fire its attacks deal ×1.5', supported: true },
  water_absorb: { name: 'Water Absorb', canon: 'Water moves heal 1/4 max HP instead', game: 'Water hits heal it 1/4 max HP instead of damaging', supported: true },
  dry_skin: { name: 'Dry Skin', canon: 'Water heals 1/4; Fire deals ×1.25', game: 'Water hits heal it 1/4 max HP; Fire damage ×1.25', supported: true },
  sturdy: { name: 'Sturdy', canon: 'Survives a one-hit KO from full HP (Gen 5+); blocks OHKO moves (Gen 4)', game: 'Survives one lethal hit at 1 HP when at full HP (the Gen 5 reading, since Gen 4 Sturdy only blocks OHKO moves, which do not exist here)', supported: true },
  magma_armor: { name: 'Magma Armor', canon: 'Cannot be frozen', game: 'Immune to chill (the game\'s freeze)', supported: true },
  early_bird: { name: 'Early Bird', canon: 'Wakes up twice as fast', game: 'Sleep lasts half as long', supported: true },
  vital_spirit: { name: 'Vital Spirit', canon: 'Cannot fall asleep', game: 'Immune to sleep', supported: true },
  guts: { name: 'Guts', canon: 'Attack ×1.5 while statused', game: 'Contact damage ×1.5 while burned, poisoned, asleep, chilled, confused or stunned', supported: true },
  swarm: { name: 'Swarm', canon: 'Bug moves ×1.5 at ≤ 1/3 HP', game: 'Contact damage ×1.5 at ≤ 1/3 HP', supported: true },
  static: { name: 'Static', canon: '30% to paralyse a Pokémon that makes contact', game: '30% to paralyse you (half speed for 1.5 s) when your contact move hits it', supported: true },
  effect_spore: { name: 'Effect Spore', canon: '30% to poison, paralyse or sleep a Pokémon that makes contact', game: '30% to paralyse you when your contact move hits it (poison and sleep need player statuses the game does not have)', supported: true },
  chlorophyll: { name: 'Chlorophyll', canon: 'Speed ×2 in harsh sunlight', game: 'Walks twice as fast while Fire weather is active', supported: true },
  pressure: { name: 'Pressure', canon: 'Moves used against it cost 2 PP', game: 'While it is within 12 m, your cooldowns recover 15% slower (there is no PP)', supported: true },
  run_away: { name: 'Run Away', canon: 'Always escapes wild battles', game: '', supported: false },
  rock_head: { name: 'Rock Head', canon: 'No recoil damage', game: '', supported: false },
  sand_veil: { name: 'Sand Veil', canon: 'Evasion up in a sandstorm', game: '', supported: false },
  damp: { name: 'Damp', canon: 'Prevents self-destructing moves', game: '', supported: false },
  flame_body: { name: 'Flame Body', canon: '30% to burn a Pokémon that makes contact', game: '', supported: false },
  hustle: { name: 'Hustle', canon: 'Attack ×1.5, physical accuracy ×0.8', game: '', supported: false },
  oblivious: { name: 'Oblivious', canon: 'Immune to infatuation (and Taunt later)', game: '', supported: false },
  snow_cloak: { name: 'Snow Cloak', canon: 'Evasion up in hail', game: '', supported: false },
  inner_focus: { name: 'Inner Focus', canon: 'Cannot flinch', game: '', supported: false },
};
export const ABILITY_IDS = Object.keys(ABILITIES);
/** why unsupported abilities have no effect (for docs and the Pokédex view) */
export const UNSUPPORTED_REASON: Record<string, string> = {
  run_away: 'There is no fleeing in survival.', rock_head: 'Enemies have no recoil moves.', sand_veil: 'There is no sandstorm weather.',
  damp: 'No enemy self-destructs.', flame_body: 'The player has no burn status.', hustle: 'Attacks never miss in survival.',
  oblivious: 'No infatuation or taunt.', snow_cloak: 'There is no hail weather.', inner_focus: 'Flinching is not modelled.',
};

/** the ability a species uses in this game: its first supported canonical ability (or none) */
export function abilityOf(sp: SpeciesDef): string | null {
  for (const a of sp.canon?.abilities ?? []) if (ABILITIES[a]?.supported) return a;
  return null;
}
