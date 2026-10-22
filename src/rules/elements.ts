// The 18 types. Internal ids are Poke-Watch's element keys; display names and the effectiveness
// chart are the official ones, imported from PokéAPI into src/content/pokedex.ts (TYPE_CHART).
// `ailment` and `fallback` are Poke-Watch's: the default status a type inflicts and the archetype
// used when no move rule matches.

import { TYPE_CHART } from '../content/pokedex';

export const ELEMENTS = [
  'plain', 'blaze', 'tide', 'bloom', 'volt', 'frost', 'brawl', 'venom', 'quake',
  'gale', 'mind', 'hive', 'stone', 'wisp', 'wyrm', 'gloom', 'alloy', 'fae',
] as const;
export type Element = (typeof ELEMENTS)[number];

export type Ailment = 'burn' | 'poison' | 'sleep' | 'root' | 'confuse' | 'chill' | 'stun' | 'knock';

export interface ElementDef {
  name: string;
  color: string; // UI + VFX colour
  strong: Element[]; // x2
  weak: Element[]; // x0.5 (attacks into these are resisted)
  immune: Element[]; // x0 -> clamped to rules.damage.immuneMult
  ailment: Ailment; // default status applied by moves of this element (rules.damage.defaultAilmentChance)
  /** archetype fallback when no regex rule matches: [physical, special] */
  fallback: [string, string];
}

export const ELEMENT_DEFS: Record<Element, ElementDef> = {
  plain: { name: TYPE_CHART.plain.name, color: '#a8a77a', strong: [], weak: ['stone', 'alloy'], immune: ['wisp'], ailment: 'knock', fallback: ['strike', 'homing'] },
  blaze: { name: TYPE_CHART.blaze.name, color: '#ee8130', strong: ['bloom', 'frost', 'hive', 'alloy'], weak: ['blaze', 'tide', 'stone', 'wyrm'], immune: [], ailment: 'burn', fallback: ['dash', 'cone'] },
  tide: { name: TYPE_CHART.tide.name, color: '#6390f0', strong: ['blaze', 'quake', 'stone'], weak: ['tide', 'bloom', 'wyrm'], immune: [], ailment: 'knock', fallback: ['dash', 'orb'] },
  bloom: { name: TYPE_CHART.bloom.name, color: '#7ac74c', strong: ['tide', 'quake', 'stone'], weak: ['blaze', 'bloom', 'venom', 'gale', 'hive', 'wyrm', 'alloy'], immune: [], ailment: 'root', fallback: ['strike', 'boomerang'] },
  volt: { name: TYPE_CHART.volt.name, color: '#f7d02c', strong: ['tide', 'gale'], weak: ['volt', 'bloom', 'wyrm'], immune: ['quake'], ailment: 'stun', fallback: ['strike', 'chain'] },
  frost: { name: TYPE_CHART.frost.name, color: '#96d9d6', strong: ['bloom', 'quake', 'gale', 'wyrm'], weak: ['blaze', 'tide', 'frost', 'alloy'], immune: [], ailment: 'chill', fallback: ['strike', 'bolt'] },
  brawl: { name: TYPE_CHART.brawl.name, color: '#c22e28', strong: ['plain', 'frost', 'stone', 'gloom', 'alloy'], weak: ['venom', 'gale', 'mind', 'hive', 'fae'], immune: ['wisp'], ailment: 'knock', fallback: ['strike', 'nova'] },
  venom: { name: TYPE_CHART.venom.name, color: '#a33ea1', strong: ['bloom', 'fae'], weak: ['venom', 'quake', 'stone', 'wisp'], immune: ['alloy'], ailment: 'poison', fallback: ['strike', 'lob'] },
  quake: { name: TYPE_CHART.quake.name, color: '#e2bf65', strong: ['blaze', 'volt', 'venom', 'stone', 'alloy'], weak: ['bloom', 'hive'], immune: ['gale'], ailment: 'knock', fallback: ['dash', 'nova'] },
  gale: { name: TYPE_CHART.gale.name, color: '#a98ff3', strong: ['bloom', 'brawl', 'hive'], weak: ['volt', 'stone', 'alloy'], immune: [], ailment: 'knock', fallback: ['dash', 'homing'] },
  mind: { name: TYPE_CHART.mind.name, color: '#f95587', strong: ['brawl', 'venom'], weak: ['mind', 'alloy'], immune: ['gloom'], ailment: 'confuse', fallback: ['strike', 'orb'] },
  hive: { name: TYPE_CHART.hive.name, color: '#a6b91a', strong: ['bloom', 'mind', 'gloom'], weak: ['blaze', 'brawl', 'venom', 'gale', 'wisp', 'alloy', 'fae'], immune: [], ailment: 'poison', fallback: ['strike', 'bolt'] },
  stone: { name: TYPE_CHART.stone.name, color: '#b6a136', strong: ['blaze', 'frost', 'gale', 'hive'], weak: ['brawl', 'quake', 'alloy'], immune: [], ailment: 'knock', fallback: ['strike', 'meteor'] },
  wisp: { name: TYPE_CHART.wisp.name, color: '#735797', strong: ['mind', 'wisp'], weak: ['gloom'], immune: ['plain'], ailment: 'confuse', fallback: ['strike', 'homing'] },
  wyrm: { name: TYPE_CHART.wyrm.name, color: '#6f35fc', strong: ['wyrm'], weak: ['alloy'], immune: ['fae'], ailment: 'knock', fallback: ['dash', 'beam'] },
  gloom: { name: TYPE_CHART.gloom.name, color: '#705746', strong: ['mind', 'wisp'], weak: ['brawl', 'gloom', 'fae'], immune: [], ailment: 'sleep', fallback: ['strike', 'homing'] },
  alloy: { name: TYPE_CHART.alloy.name, color: '#b7b7ce', strong: ['frost', 'stone', 'fae'], weak: ['blaze', 'tide', 'volt', 'alloy'], immune: [], ailment: 'knock', fallback: ['strike', 'orb'] },
  fae: { name: TYPE_CHART.fae.name, color: '#d685ad', strong: ['brawl', 'wyrm', 'gloom'], weak: ['blaze', 'venom', 'alloy'], immune: [], ailment: 'confuse', fallback: ['strike', 'orb'] },
};

/** chart[atk][def] multiplier */
// official matchups replace the hand-written lists above
for (const el of ELEMENTS) Object.assign(ELEMENT_DEFS[el], { strong: TYPE_CHART[el].strong, weak: TYPE_CHART[el].weak, immune: TYPE_CHART[el].immune });

export function buildTypeChart(immuneMult: number): Record<Element, Record<Element, number>> {
  const out = {} as Record<Element, Record<Element, number>>;
  for (const a of ELEMENTS) {
    out[a] = {} as Record<Element, number>;
    const d = ELEMENT_DEFS[a];
    for (const b of ELEMENTS) {
      out[a][b] = d.immune.includes(b) ? immuneMult : d.strong.includes(b) ? 2 : d.weak.includes(b) ? 0.5 : 1;
    }
  }
  return out;
}

export function effectiveness(chart: Record<Element, Record<Element, number>>, atk: Element, defs: readonly Element[]) {
  let m = 1;
  for (const d of defs) m *= chart[atk][d];
  return m;
}
