// Shared tile vocabulary for every map in the game (survivor arenas and the Maplebrook
// overworld). Renderer-free: the simulation imports this to answer "can I stand here?",
// the renderer imports it to know what to paint.
//
// World units: 1 tile = 1 metre. Elevation is in metres; cliffs are whole metres, ledges
// half a metre. Tile (i, j) covers x in [i - W/2, i - W/2 + 1) and z in [j - H/2, j - H/2 + 1);
// row j grows toward the camera (south, +z).

export const T = { grass: 0, path: 1, stone: 2, water: 3, tall: 4, wood: 5, sand: 6, floor: 7, tatami: 8, void: 9, dirt: 10, flowerbed: 11 } as const;
export type TerrainId = (typeof T)[keyof typeof T];

/** Every prop kind an arena can place. Painters live in render/tileart.ts. */
export type ArenaPropKind =
  | 'tree' | 'tree2' | 'round' | 'blossom' | 'elder' // trees (walls)
  | 'bush' | 'bushR' | 'bushB' | 'rock' | 'boulder' | 'stump' | 'log' // low obstacles (standable)
  | 'sign' | 'lantern' | 'pillar' | 'pillarBroken' | 'statue' | 'shrine' | 'berry' | 'crystal' | 'vent' | 'mushroom' | 'deadtree' | 'icepine'
  | 'cabin' | 'hedge' | 'fence' | 'well' | 'lamp' | 'bench' // hamlet kit (procedural regions)
  | 'flowerR' | 'flowerW' | 'flowerY' | 'flowerB' | 'tall' | 'reeds' | 'lily'; // walkable decoration

export interface PropRule {
  /** footprint in tiles */
  w: number; h: number;
  /** wall = never passable; platform height (m) = can be jumped onto; 0 = walkable */
  wall?: boolean; platform?: number;
}

export const PROP_RULES: Record<ArenaPropKind, PropRule> = {
  tree: { w: 2, h: 2, wall: true }, tree2: { w: 2, h: 2, wall: true }, round: { w: 2, h: 2, wall: true },
  blossom: { w: 2, h: 2, wall: true }, elder: { w: 4, h: 3, wall: true }, deadtree: { w: 2, h: 2, wall: true },
  icepine: { w: 2, h: 2, wall: true },
  bush: { w: 1, h: 1, platform: 0.7 }, bushR: { w: 1, h: 1, platform: 0.7 }, bushB: { w: 1, h: 1, platform: 0.7 },
  rock: { w: 1, h: 1, platform: 0.75 }, boulder: { w: 2, h: 2, wall: true }, stump: { w: 1, h: 1, platform: 0.65 },
  log: { w: 2, h: 1, platform: 0.65 }, berry: { w: 1, h: 1, wall: true },
  sign: { w: 1, h: 1, wall: true }, lantern: { w: 1, h: 1, wall: true }, pillar: { w: 1, h: 1, wall: true },
  pillarBroken: { w: 1, h: 1, platform: 0.8 }, statue: { w: 2, h: 2, wall: true }, shrine: { w: 3, h: 2, wall: true },
  crystal: { w: 1, h: 1, wall: true }, vent: { w: 1, h: 1, platform: 0.5 }, mushroom: { w: 1, h: 1, platform: 0.7 },
  cabin: { w: 4, h: 3, wall: true }, hedge: { w: 1, h: 1, wall: true }, fence: { w: 1, h: 1, wall: true }, well: { w: 2, h: 2, wall: true },
  lamp: { w: 1, h: 1, wall: true }, bench: { w: 2, h: 1, platform: 0.5 },
  flowerR: { w: 1, h: 1 }, flowerW: { w: 1, h: 1 }, flowerY: { w: 1, h: 1 }, flowerB: { w: 1, h: 1 },
  tall: { w: 1, h: 1 }, reeds: { w: 1, h: 1 }, lily: { w: 1, h: 1 },
};

export interface ArenaProp { kind: ArenaPropKind; x: number; y: number; w: number; h: number; variant: number; text?: string }

/** A handcrafted arena: everything the sim and renderer need, in tile coordinates. */
export interface ArenaMap {
  id: string; name: string; w: number; h: number;
  terrain: Uint8Array; // T ids
  elev: Float32Array; // metres
  stairs: Uint8Array; // 1 = stairs rising toward -z (north)
  dots: Uint8Array; // painted ground flowers
  ledge: Uint8Array; // painted grass lip on the tile's south half
  wall: Uint8Array; // 1 = impassable
  platform: Float32Array; // extra standable height from low props
  props: ArenaProp[];
  spawn: [number, number]; // tile
  bossSpot: [number, number];
  chestSpots: [number, number][];
  landmarks: { x: number; y: number; name: string }[];
  /** procedural regions only (src/world/gen): how the map was made, its habitat and encounter spaces */
  gen?: import('./gen/context').GenMeta;
}

export const WATER_Y = -0.25;

/**
 * Heights at the north and south edges of a stairs tile. A flight may span several rows;
 * it ramps linearly from the tile north of the flight (high) to the tile south of it (low).
 */
export function stairEdges(m: ArenaMap, i: number, j: number): [number, number] {
  const W = m.w;
  let jt = j; while (jt > 0 && m.stairs[(jt - 1) * W + i]) jt--;
  let jb = j; while (jb < m.h - 1 && m.stairs[(jb + 1) * W + i]) jb++;
  const hi = jt > 0 ? m.elev[(jt - 1) * W + i] : 0, lo = jb < m.h - 1 ? m.elev[(jb + 1) * W + i] : 0;
  const n = jb - jt + 1;
  return [hi + ((lo - hi) * (j - jt)) / n, hi + ((lo - hi) * (j - jt + 1)) / n];
}
