// What each upgrade and pickup looks like and is called. An imported Pokémon item is used only
// when its canonical effect matches what it does here (docs/ICONS.md); everything else uses an
// original glyph with a plain descriptive name, so no icon implies a mechanic the game lacks.
export interface ItemLook { name: string; item?: string; glyph?: string; canon?: string }

export const VITAMIN_LOOK: Record<string, ItemLook> = {
  hp: { name: 'HP Up', item: 'hp-up', canon: 'raises HP' },
  atk: { name: 'Protein', item: 'protein', canon: 'raises Attack' },
  spa: { name: 'Calcium', item: 'calcium', canon: 'raises Sp. Atk' },
  def: { name: 'Iron', item: 'iron', canon: 'raises Defense' },
  spe: { name: 'Carbos', item: 'carbos', canon: 'raises Speed' },
  crit: { name: 'Scope Lens', item: 'scope-lens', canon: 'raises critical-hit ratio' },
  haste: { name: 'Cooldown Charm', glyph: 'cooldown' },
  area: { name: 'Area Charm', glyph: 'area' },
  magnet: { name: 'Pickup Charm', glyph: 'magnet' },
};
export const HEAL_LOOK: ItemLook = { name: 'Sitrus Berry', item: 'sitrus-berry', canon: 'restores HP' };
export const LEARN_LOOK = (type: string): ItemLook => ({ name: 'TM', item: 'tm-' + type, canon: 'teaches a move' });
export const UPGRADE_LOOK: ItemLook = { name: 'Move power-up', glyph: 'upgrade' };
export const PICKUP_LOOK: Record<string, ItemLook> = {
  xp: { name: 'EXP Shard', glyph: 'xp' },
  heal: { name: 'Oran Berry', item: 'oran-berry', canon: 'restores HP' },
  lure: { name: 'Lure', glyph: 'lure' },
  chest: { name: 'Item ball', item: 'poke-ball', canon: 'an item lying in the field' },
};

/** Phase 8b techniques: original glyphs (no item implies a mechanic the game lacks) */
export const TECH_LOOK: Record<string, ItemLook> = {
  undertow: { name: 'Undertow', glyph: 'vortex' },
  riposte: { name: 'Riposte', glyph: 'boomerang' },
  lodestone: { name: 'Lodestone', glyph: 'magnet' },
  heavy_footing: { name: 'Heavy Footing', glyph: 'nova' },
  catalyst: { name: 'Catalyst', glyph: 'chain' },
  slipstream: { name: 'Slipstream', glyph: 'dash' },
  quarry: { name: 'Quarry', glyph: 'meteor' },
  second_wind: { name: 'Second Wind', glyph: 'trail' },
};
export const EVOLVE_LOOK: ItemLook = { name: 'Evolution', glyph: 'upgrade' };
