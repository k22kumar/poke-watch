// How a generated map was made (ArenaMap.gen): the record the location and habitat generators attach, moved here from
// the classic generator at C1. Deleted with the tile stack (docs/OVERHAUL_3D.md, X1b).

/** Location-driven maps (src/world/locgen) and habitat maps: what the sim, renderer and tools read beyond the map. */
export interface LocMeta {
  /** location id (src/world/locations) or habitat recipe id */
  id: string;
  /** art palette key for the renderer (sky, ground, cliffs, props); overrides the stage biome's */
  art: string;
  particles?: 'petals' | 'embers' | 'snow' | 'motes' | 'sparks' | 'dust';
  /** enemies may drop down ledges up to this height (m) */
  dropNav: number;
  /** shots respect terrain and walls */
  los: boolean;
  /** enemy entry anchors (tile coords): cave mouths, forest gates, tunnels */
  anchors: [number, number][];
  /** extra loose bodies (tile coords), e.g. Chargestone's floating stones */
  bodySpots: [number, number][];
  /** tile indices of chasm cells (open air beside a bridge: no supporting floor; sim/world.ts voids) */
  chasm?: number[];
  /** the macro graph as built (for diagnostics, tests and the contact sheet) */
  zones: { id: number; kind: string; x: number; y: number; r: number; tier: number; name?: string }[];
  links: { a: number; b: number; kind: string; tiles: number }[];
  /** quality metrics measured on the final map (docs/LOCATIONS.md) */
  metrics: Record<string, number>;
}

export interface GenMeta {
  generator: 'poke-watch-locgen' | 'poke-watch-habitat';
  version: number;
  seed: number; // the region seed asked for
  attemptSeed: number; // the seed of the attempt that passed
  attempts: number; repairs: number;
  /** `location:landform` or `recipe:landform` */
  archetype: string;
  loc?: LocMeta;
  /** set on habitat maps only (src/world/habitat): recipe, mode layout, gates, rejections */
  hab?: import('./habitat/types').HabMeta;
  sites: [number, number][]; // objective sites (flat, non-flammable)
  habitat: Uint8Array;
  /** 1 = main road, 2 = trail */
  route: Uint8Array;
  gates: GateResult[];
  ms: number;
}

export interface GateResult { id: string; ok: boolean; value: string }
