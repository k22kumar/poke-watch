import type { Ailment, Element } from './elements';
import { POKEDEX_MOVES } from '../content/pokedex';

// Moves are database rows (power / class / priority / ailment / hits / drain), classified into
// a behaviour archetype at load time — the same pipeline PokéBonk runs over its move database.
// Change a move's behaviour with `archetypeOverrides`.

export interface MoveData {
  key: string;
  name: string;
  element: Element;
  cls: 'physical' | 'special' | 'status';
  power: number;
  priority?: number;
  accuracy?: number | null; // null = never misses -> special moves become homing
  ailment?: Ailment;
  ailmentChance?: number; // percent
  drain?: number; // fraction of damage healed
  hits?: number; // multi-hit -> barrage
  statusKind?: 'buff' | 'weather' | 'trap';
  desc?: string;
}

// The game's moves are the Pokémon moves the roster learns by level-up, imported from PokéAPI
// (power, class, priority, accuracy, ailment and chance, drain, multi-hit) by
// scripts/build-content.mjs. Behaviour comes from the classifier below; moves whose canonical
// targeting implies a shape (hits every opponent -> nova; physical priority -> dash) carry an
// archetype hint that wins over the name rules.
export const MOVES: MoveData[] = POKEDEX_MOVES.map(({ archetype: _a, source: _s, ...row }) => row);

export const MOVE_BY_KEY: Record<string, MoveData> = Object.fromEntries(MOVES.map((m) => [m.key, m]));

// Classifier data (order matters: first match wins).
export const archetypeOverrides: Record<string, string> = {
  // key: archetype  (wins over every rule below). Content hints first; the hand-picked shapes
  // for partner moves come after so they win.
  ...Object.fromEntries(POKEDEX_MOVES.filter((m) => m.archetype).map((m) => [m.key, m.archetype!])),
  air_slash: 'cone',
  flamethrower: 'cone', ember: 'bolt', water_gun: 'bolt', bubble: 'orb', razor_leaf: 'boomerang', vine_whip: 'strike',
  solar_beam: 'beam', hydro_pump: 'beam', swift: 'homing', magical_leaf: 'homing', rollout: 'dash', flame_wheel: 'dash',
  fire_spin: 'vortex', whirlpool: 'vortex', sludge_bomb: 'lob', seed_bomb: 'lob', lava_plume: 'nova', earthquake: 'nova',
  powder_snow: 'cone', icy_wind: 'cone', petal_dance: 'boomerang', bubble_beam: 'beam', thunder_shock: 'chain',
};

export const archetypeRegexRules: [RegExp, string][] = [
  [/bomb|grenade/, 'lob'],
  [/ball|orb|sphere|pulse/, 'orb'],
  [/rush|tackle|slam|charge|ram/, 'dash'],
  [/thunder|bolt|zap/, 'chain'],
  [/rang|disc/, 'boomerang'],
  [/beam|ray/, 'beam'],
  [/smite|judg/, 'smite'],
  [/nova|burst/, 'nova'],
  [/meteor|comet|rockfall|hail/, 'meteor'],
  [/storm|vortex|whirlpool|cyclone/, 'vortex'],
  [/spin|twister|whirl/, 'spin'],
  [/breath|spray|fan/, 'cone'],
  [/trail|wake/, 'trail'],
  [/aura|field/, 'aura'],
  [/orbit|satellite/, 'orbit'],
  [/seek|missile|dart/, 'homing'],
  [/shard|needle|shot|spit/, 'bolt'],
  [/claw|slash|bite|punch|kick|fang|strike|lash|pound/, 'strike'],
];
