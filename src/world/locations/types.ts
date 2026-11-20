// Pokémon location definitions: the data the location generator (src/world/locgen) builds a playable region from.
//
// A definition keeps four kinds of information apart (docs/LOCATIONS.md):
//   canon      — what the official games establish about the place (with references). Never invented here.
//   gameplay   — hard constraints from this game's movement, navigation, camera and combat (in metres and tiles).
//   freedoms   — what may vary between seeds: how many spaces, loops, raised tiers, bridges, shortcuts.
//   creative   — gameplay-driven interpretations that are plausible in the Pokémon world but are NOT canon.
// Plus the kit that realises it: surfaces, props, landmark stamps, habitat tags and the art palette.
//
// Adding a location means adding one of these files and registering it in ./index.ts. Nothing in the generator
// names a location or a species.
import type { ArenaPropKind, TerrainId } from '../tiles';

export interface Ref { title: string; url: string }

/** a statement the official games support; `refs` index into LocationDef.refs */
export interface CanonFact { fact: string; refs: number[] }

/** a gameplay-driven extension: what it is and why it serves play; always presented as interpretation */
export interface Interpretation { feature: string; why: string }

/** spatial roles a zone can play (Layer A). Kinds are generic: a location picks sizes and dressing for each. */
export type ZoneKind = 'hub' | 'boss' | 'arena' | 'chamber' | 'nook' | 'entrance';

/** link kinds (Layer A/B). path/trail/ramp/bridge are walkable by enemies; hop is a player-only shortcut. */
export type LinkKind = 'path' | 'trail' | 'ramp' | 'bridge' | 'hop';

/** the macro landform that biases which zones sit high or low (Layer A) */
export type Landform =
  | 'ridge' // a raised band across the map, low ground on both sides (forest bluffs)
  | 'descent' // high on one side, deepening toward the other (a cave going down floor by floor)
  | 'terraces' // concentric shelves around a deep core (a cavern hall)
  | 'twin'; // two high masses with a low trough between (paired hills, a split cave)

export interface LandmarkDef {
  id: string;
  name: string;
  /** stamp id implemented in src/world/locgen/stamps.ts */
  stamp: string;
  /** where it may go */
  zone: ZoneKind[];
  tier: 'low' | 'high' | 'top' | 'any';
  count: [number, number];
  /** canon = the landmark exists in the official games (adapted); false = creative */
  canon: boolean;
}

export interface LocationDef {
  id: string;
  name: string;
  region: string;
  summary: string;
  canon: {
    facts: CanonFact[];
    /** what must stay recognisable in every seed */
    identity: string[];
  };
  creative: Interpretation[];
  refs: Ref[];

  gameplay: {
    /** height between tiers (m). Must exceed the jump (1.84 m) so tiers are real cliffs, and be ≤ 2× it so a hop
     *  shortcut (two half-steps) works */
    tierGap: number;
    /** number of tiers (2–3) */
    tiers: number;
    /** zone radii (tiles) */
    arenaR: [number, number]; chamberR: [number, number]; nookR: [number, number];
    /** corridor widths (tiles): main paths, flank trails, ramps, bridges */
    pathW: [number, number]; trailW: [number, number]; rampW: number; bridgeW: number;
    /** share of tier-changing links built as terrace junctions (an overlook with a ramp on one side) */
    terrace: number;
    /** ramp slope (m per tile, ≤ 0.5 so every step is under the 0.6 m step rule) */
    slope: number;
    /** enemies may drop down ledges up to this height (m) */
    dropNav: number;
    /** open radius at the spawn (tiles) */
    spawnOpen: number;
    /** tier the spawn hub sits on */
    hubTier: number;
  };

  freedoms: {
    zones: [number, number]; // interior zones besides hub and boss
    loops: [number, number]; // independent cycles in the zone graph
    raised: [number, number]; // share of zones above tier 0
    bridges: [number, number];
    hops: [number, number];
    entrances: [number, number];
    landforms: Landform[];
  };

  enclosure: {
    /** what fills everything that is not playable */
    kind: 'forest' | 'rock';
    /** rock masses stand this far above the highest playable neighbour (m) */
    wallRise: number;
    /** what a bridge spans: a wooded gully or a dark abyss */
    chasm: 'gully' | 'abyss';
  };

  surface: {
    floor: TerrainId; path: TerrainId; high: TerrainId; ramp: TerrainId;
    /** share of arena/chamber floor in tall grass (encounter grass) */
    tallGrass: number;
    /** painted ground speckle density */
    dots: number;
    bridge: 'wood' | 'stone';
  };

  props: {
    /** 2×2 walls that fill forest enclosure */
    mass: ArenaPropKind[];
    /** 1×1 wall for gaps in the mass */
    massFill: ArenaPropKind;
    /** blocking cover inside combat spaces */
    cover: ArenaPropKind[];
    /** low (jumpable) cover */
    low: ArenaPropKind[];
    /** cover along raised edges (parapet) */
    lip: ArenaPropKind[];
    /** walkable decoration */
    decor: ArenaPropKind[];
    /** rock enclosure: share of rim tops that grow the mass-fill prop (spires, crystals) */
    rimRate?: number;
    /** walk-through prop set on each hop step against the upper cliff (e.g. Mt. Moon's ladders) */
    stepMark?: ArenaPropKind;
  };

  landmarks: LandmarkDef[];

  /** HAB bits (rules/habitats.ts) for floor, raised ground and decorated patches */
  habitat: { floor: number; high: number; patch: number };

  /** palette key for the renderer (render/tileart.ts BIOME_ART) */
  art: string;
  particles?: 'petals' | 'embers' | 'snow' | 'motes' | 'sparks' | 'dust';
  /** extra loose stones placed by the map (Push / Hold bodies) */
  bodies: number;
  /** overhead decks (locgen/decks.ts): how many cliff shelves, how deep (tiles out from the rim) and how long a run.
   *  Absent = single-layer map. Bridges over a gully between two lower spaces always become underpasses. */
  decks?: { shelves: [number, number]; depth: [number, number]; run: [number, number] };
  /** stage biomes whose spawn table fits this location's ecology (docs/LOCATIONS.md, "Species fit") */
  biomeFit: string[];
}
