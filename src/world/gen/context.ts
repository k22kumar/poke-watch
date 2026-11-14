// The state one generation attempt carries between stages. Each stage draws from its own named Rng stream, so adding
// a call in one stage never reshuffles the others (blueprint section 9).
import { Rng, streamSeed } from '../../core/rng';
import { ArenaBuilder } from '../builder';
import type { ArenaMap } from '../tiles';
export { HAB } from '../../rules/habitats';

export type Archetype = 'ridge' | 'valley' | 'hollow';

export type PlaceKind = 'hub' | 'boss' | 'shrine' | 'oak' | 'pond' | 'hamlet' | 'berry' | 'arch' | 'lookout' | 'site';

export interface Place {
  id: number; kind: PlaceKind;
  x: number; y: number; // tile centre (map space)
  r: number; // clearing radius (tiles)
  name: string;
  /** elevation the place sits at once terrain is shaped (filled by terrain) */
  elev: number;
  /** for plateau places: where its ramp lands (a route ends here) */
  door?: [number, number];
}

export interface Lookout { x: number; y: number; w: number; h: number; height: number; ramps: number; name: string }

/** Encounter-space kinds the gameplay pass looks for (blueprint section 4). */
export type SpaceKind = 'hub' | 'choke' | 'overlook' | 'grove' | 'water';
export interface Space { kind: SpaceKind; x: number; y: number; score: number }

/** Location-driven maps (src/world/locgen): what the sim, renderer and tools read beyond the classic fields. */
export interface LocMeta {
  /** location id (src/world/locations) */
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
  generator: 'poke-watch-worldgen' | 'poke-watch-locgen' | 'poke-watch-habitat';
  version: number;
  seed: number; // the region seed asked for
  attemptSeed: number; // the seed of the attempt that passed
  attempts: number; repairs: number;
  archetype: Archetype | string;
  /** set on location maps only */
  loc?: LocMeta;
  /** set on habitat maps only (src/world/habitat): recipe, mode layout, gates, rejections */
  hab?: import('../habitat/types').HabMeta;
  places: Place[];
  lookouts: Lookout[];
  spaces: Space[];
  sites: [number, number][]; // objective sites (flat, non-flammable)
  habitat: Uint8Array;
  /** 1 where a step of 0.75 m or more is intended (plateau rims, ramp sides) */
  cliffOk: Uint8Array;
  /** 1 = main road, 2 = trail */
  route: Uint8Array;
  gates: GateResult[];
  ms: number;
}

export interface GateResult { id: string; ok: boolean; value: string }

export class GenCtx {
  readonly S: number;
  readonly b: ArenaBuilder;
  readonly m: ArenaMap;
  readonly biome: string;
  readonly seed: number;
  archetype: Archetype = 'valley';
  /** canonical-frame transform: rotation (quarter turns) and mirror */
  rot = 0; mir = false;
  places: Place[] = [];
  lookouts: Lookout[] = [];
  spaces: Space[] = [];
  sites: [number, number][] = [];
  /** continuous height before quantising (m) */
  h0: Float32Array;
  /** fixed tiles the slope relaxation must not change: 1 anchor (flattened place), 2 plateau, 3 ramp, 4 water */
  fixed: Uint8Array;
  cliffOk: Uint8Array;
  route: Uint8Array;
  /** tiles kept free of forest and clutter (clearings, streets, glade) */
  keepOpen: Uint8Array;
  /** ridge band (canonical ridge archetype) — rivers never cross it */
  ridge: Uint8Array;
  habitat: Uint8Array;
  repairs = 0;
  /** stage timings (ms), filled when `timing` is on */
  timing: Record<string, number> | null = null;
  /** lake rims the height budget must not lower */
  rim: Uint8Array;
  /** still water bodies carved (centre, radii) */
  lakes: [number, number, number, number][] = [];
  /** the region's spawn-table species (habitat gate) */
  spawnSpecies: string[] = [];
  notes: string[] = [];
  private streams = new Map<string, Rng>();

  constructor(biome: string, name: string, size: number, seed: number) {
    this.S = size; this.biome = biome; this.seed = seed >>> 0;
    this.b = new ArenaBuilder(`${biome}@${seed >>> 0}`, name, size, size);
    this.m = this.b.m;
    const n = size * size;
    this.h0 = new Float32Array(n); this.fixed = new Uint8Array(n); this.cliffOk = new Uint8Array(n);
    this.route = new Uint8Array(n); this.keepOpen = new Uint8Array(n); this.ridge = new Uint8Array(n); this.habitat = new Uint8Array(n); this.rim = new Uint8Array(n);
  }

  rng(stage: string): Rng {
    let r = this.streams.get(stage);
    if (!r) { r = new Rng(streamSeed(this.seed, 'gen:' + stage)); this.streams.set(stage, r); }
    return r;
  }

  idx(x: number, y: number) { return y * this.S + x; }
  in(x: number, y: number) { return x >= 0 && y >= 0 && x < this.S && y < this.S; }

  /** canonical (cx, cy) → map tile; quarter-turn rotation and mirror keep the grid exact */
  toMap(cx: number, cy: number): [number, number] {
    const S1 = this.S - 1;
    let x = this.mir ? S1 - cx : cx, y = cy;
    for (let r = 0; r < this.rot; r++) { const nx = S1 - y; y = x; x = nx; }
    return [x, y];
  }
  /** map tile → canonical */
  toCanon(x: number, y: number): [number, number] {
    const S1 = this.S - 1;
    let cx = x, cy = y;
    for (let r = 0; r < this.rot; r++) { const nx = cy; cy = S1 - cx; cx = nx; }
    if (this.mir) cx = S1 - cx;
    return [cx, cy];
  }

  place(kind: PlaceKind) { return this.places.find((p) => p.kind === kind); }
}
