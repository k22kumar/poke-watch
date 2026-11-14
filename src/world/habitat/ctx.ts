// State one habitat-generation attempt carries between its stages. Every stage draws from its own named Rng stream
// ('hab:<stage>'), so adding a draw in one stage never reshuffles another; trig goes through core/detmath.
import { Rng, streamSeed } from '../../core/rng';
import { ArenaBuilder } from '../builder';
import type { ArenaMap } from '../tiles';
import type { FamilyId, HabitatRecipe, ModeGraph } from './types';

/** what each tile became */
export const HK = { mass: 0, floor: 1, route: 2, ramp: 3, fluid: 4, terrace: 5, tunnel: 6, bank: 7, shelf: 8, rock: 9 } as const;
/** medium per tile */
export const MED = { none: 0, water: 1, lava: 2 } as const;

/** a join between two pieces, with the support, clearance and medium contract validate.ts checks (spec R02) */
export interface Join {
  family: FamilyId;
  what: string;
  /** tiles at each end that must carry it (supported ground or deck at the join height ± step) */
  ends: [number, number];
  /** height the join is made at (m) */
  h: number;
  /** headroom under it where something passes beneath (m), or 0 */
  clearance: number;
  /** what passes under or through: a fluid (culvert, bridge over a channel) or a walkway (an arch over a tunnel) */
  medium: 'water' | 'lava' | 'air' | 'walkway';
}

/** a planned approach as embedded: which mode edge it realises and the tiles it claimed */
export interface Approach {
  id: string; // 'A.direct', 'A.flank', 'B.direct', 'B.flank'
  team: 'A' | 'B';
  kind: 'direct' | 'flank';
  /** what the recipe built it from */
  form: string;
  /** centre line (tile space, map coords), staging → contest */
  pts: [number, number][];
  tiles: number[];
}

export class HabCtx {
  readonly S: number;
  readonly recipe: HabitatRecipe;
  readonly mode: ModeGraph;
  readonly seed: number;
  readonly b: ArenaBuilder;
  readonly m: ArenaMap;
  rot = 0; mir = false;
  /** surface height per tile (m): floor, route or the top of the mass */
  H: Float32Array;
  kind: Uint8Array;
  med: Uint8Array;
  /** fluid surface level (m) on fluid tiles */
  wl: Float32Array;
  /** overhead deck height (0 = none) */
  over: Float32Array;
  /** identity anchor tiles: repairs may not touch them */
  lock: Uint8Array;
  /** reserved space: routes, landings, the contest floor and kept sightlines (no vegetation, no cover) */
  keep: Uint8Array;
  /** hazard tiles (vent fields): never on an essential route */
  hazard: Uint8Array;
  /** fluid connectivity through a dry crossing (a causeway's culvert) */
  culvert: Uint8Array;
  /** the contest platform (the terrace or forecourt the point sits on): not a perch over its own entries */
  platform: Uint8Array;
  approaches: Approach[] = [];
  joins: Join[] = [];
  /** mode nodes as placed (tile coords) */
  nodes: Record<string, [number, number]> = {};
  contest: { x: number; y: number; h: number; r: number } = { x: 0, y: 0, h: 0, r: 5 };
  /** the landmark the contest sits beside */
  landmark: { x: number; y: number; name: string } | null = null;
  /** optional features switched on for this seed */
  optional: string[] = [];
  /** drainage: fluid sources and outlets (tile coords) and terminal sinks */
  sources: [number, number][] = [];
  outlets: [number, number][] = [];
  sinks: [number, number][] = [];
  anchors: [number, number][] = [];
  habitat: Uint8Array;
  notes: string[] = [];
  repairs: string[] = [];
  /** the geometry families this map was actually built from (families.ts and dress.ts record each use) */
  used = new Set<FamilyId>();
  /** variety signature of traversable geometry (validate.ts and tests compare seeds with it) */
  shape: Record<string, number> = {};
  /** surface variant ('' = the recipe's own surfaces) */
  readonly variant: string;
  private streams = new Map<string, Rng>();

  constructor(recipe: HabitatRecipe, mode: ModeGraph, size: number, seed: number, variant = '') {
    this.recipe = recipe; this.mode = mode; this.S = size; this.seed = seed >>> 0; this.variant = variant;
    this.b = new ArenaBuilder(`${recipe.id}@${seed >>> 0}`, recipe.name, size, size);
    this.m = this.b.m;
    const n = size * size;
    this.H = new Float32Array(n); this.kind = new Uint8Array(n); this.med = new Uint8Array(n);
    this.wl = new Float32Array(n); this.over = new Float32Array(n);
    this.lock = new Uint8Array(n); this.keep = new Uint8Array(n); this.hazard = new Uint8Array(n); this.culvert = new Uint8Array(n); this.platform = new Uint8Array(n);
    this.habitat = new Uint8Array(n);
  }

  /** the recipe's surfaces with the variant's swaps (geometry never depends on these) */
  surfaces(): HabitatRecipe['surfaces'] { return { ...this.recipe.surfaces, ...(this.recipe.variants[this.variant]?.surfaces ?? {}) }; }
  vegetation(): HabitatRecipe['vegetation'] {
    const v = this.recipe.variants[this.variant];
    return { ...this.recipe.vegetation, ...(v?.trees ? { trees: v.trees } : {}), ...(v?.fill ? { fill: v.fill } : {}), ...(v?.under ? { under: v.under } : {}) };
  }
  art(): string { return this.recipe.variants[this.variant]?.art ?? this.recipe.art; }

  rng(stage: string): Rng {
    let r = this.streams.get(stage);
    if (!r) { r = new Rng(streamSeed(this.seed, 'hab:' + stage)); this.streams.set(stage, r); }
    return r;
  }

  idx(x: number, y: number) { return y * this.S + x; }
  in(x: number, y: number) { return x >= 0 && y >= 0 && x < this.S && y < this.S; }
  /** playable ground: not mass, not fluid */
  play(k: number) { const t = this.kind[k]; return t !== HK.mass && t !== HK.fluid && t !== HK.rock; }

  /** canonical (u, v in 0..1) → map tile coords (float), by quarter turns and a mirror */
  P(u: number, v: number): [number, number] {
    const S1 = this.S - 1;
    let x = u * S1, y = v * S1;
    if (this.mir) x = S1 - x;
    for (let r = 0; r < this.rot; r++) { const nx = S1 - y; y = x; x = nx; }
    return [x, y];
  }
  /** map coords → canonical tile coords (the inverse of P, in tiles rather than 0..1) */
  Q(mx: number, my: number): [number, number] {
    const S1 = this.S - 1;
    let x = mx, y = my;
    for (let r = 0; r < this.rot; r++) { const nx = y; y = S1 - x; x = nx; }
    if (this.mir) x = S1 - x;
    return [x, y];
  }
  /** canonical direction → map direction */
  D(du: number, dv: number): [number, number] {
    let x = this.mir ? -du : du, y = dv;
    for (let r = 0; r < this.rot; r++) { const nx = -y; y = x; x = nx; }
    return [x, y];
  }

  /** every tile within r of (x, y) */
  disc(x: number, y: number, r: number, f: (k: number, d: number) => void) {
    for (let j = Math.floor(y - r); j <= Math.ceil(y + r); j++) for (let i = Math.floor(x - r); i <= Math.ceil(x + r); i++) {
      if (!this.in(i, j)) continue;
      const d = Math.sqrt((i + 0.5 - x) ** 2 + (j + 0.5 - y) ** 2);
      if (d <= r) f(this.idx(i, j), d);
    }
  }
}
