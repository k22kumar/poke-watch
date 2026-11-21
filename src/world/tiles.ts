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
  | 'flowerR' | 'flowerW' | 'flowerY' | 'flowerB' | 'tall' | 'reeds' | 'lily' // walkable decoration
  | 'thicket' | 'stalagmite' | 'moonstone' | 'magnetite' | 'fossil' | 'crate' // location kit (src/world/locgen)
  | 'gatehouse' | 'tent' | 'ladder'
  | 'grave'; // grave marker family (world/habitat/graves.ts): per-instance height (`top`), width and lean

export interface PropRule {
  /** footprint in tiles */
  w: number; h: number;
  /** wall = never passable; platform height (m) = can be jumped onto; 0 = walkable */
  wall?: boolean; platform?: number;
  /** wall props (R1b; docs/SIZING.md "Wall tops"): the physical height (m) of the prop above its
   *  footing, the one height every reader that opts in shares (World.wallTop). It is the tallest drawn variant over every
   *  biome palette, unstretched (the sprite's opaque rows ÷ 16 px per m, the shader's alpha cut), rounded up to 0.05 m;
   *  tests/walltops.test.ts measures the painters and fails when art and table drift apart. Billboard stretch and lean at
   *  steep views are presentation only and never raise it */
  top?: number;
}

export const PROP_RULES: Record<ArenaPropKind, PropRule> = {
  tree: { w: 2, h: 2, wall: true, top: 2.75 }, tree2: { w: 2, h: 2, wall: true, top: 2.75 }, round: { w: 2, h: 2, wall: true, top: 2.7 },
  blossom: { w: 2, h: 2, wall: true, top: 2.65 }, elder: { w: 4, h: 3, wall: true, top: 5.2 }, deadtree: { w: 2, h: 2, wall: true, top: 2.95 },
  icepine: { w: 2, h: 2, wall: true, top: 2.75 },
  bush: { w: 1, h: 1, platform: 0.7 }, bushR: { w: 1, h: 1, platform: 0.7 }, bushB: { w: 1, h: 1, platform: 0.7 },
  rock: { w: 1, h: 1, platform: 0.75 }, boulder: { w: 2, h: 2, wall: true, top: 1.6 }, stump: { w: 1, h: 1, platform: 0.65 },
  log: { w: 2, h: 1, platform: 0.65 }, berry: { w: 1, h: 1, wall: true, top: 1.6 },
  sign: { w: 1, h: 1, wall: true, top: 1.1 }, lantern: { w: 1, h: 1, wall: true, top: 1.65 }, pillar: { w: 1, h: 1, wall: true, top: 2 },
  pillarBroken: { w: 1, h: 1, platform: 0.8 }, statue: { w: 2, h: 2, wall: true, top: 2.5 }, shrine: { w: 3, h: 2, wall: true, top: 2.6 },
  crystal: { w: 1, h: 1, wall: true, top: 1.35 }, vent: { w: 1, h: 1, platform: 0.5 }, mushroom: { w: 1, h: 1, platform: 0.7 },
  cabin: { w: 4, h: 3, wall: true, top: 3.75 }, hedge: { w: 1, h: 1, wall: true, top: 1 }, fence: { w: 1, h: 1, wall: true, top: 0.9 }, well: { w: 2, h: 2, wall: true, top: 1.9 },
  lamp: { w: 1, h: 1, wall: true, top: 2.4 }, bench: { w: 2, h: 1, platform: 0.5 },
  flowerR: { w: 1, h: 1 }, flowerW: { w: 1, h: 1 }, flowerY: { w: 1, h: 1 }, flowerB: { w: 1, h: 1 },
  tall: { w: 1, h: 1 }, reeds: { w: 1, h: 1 }, lily: { w: 1, h: 1 },
  thicket: { w: 1, h: 1, wall: true, top: 1.2 }, stalagmite: { w: 1, h: 1, wall: true, top: 2 }, moonstone: { w: 2, h: 2, wall: true, top: 2 },
  magnetite: { w: 2, h: 2, wall: true, top: 2.75 }, fossil: { w: 1, h: 1, platform: 0.45 }, crate: { w: 1, h: 1, platform: 0.8 },
  gatehouse: { w: 4, h: 3, wall: true, top: 3.2 }, tent: { w: 2, h: 2, wall: true, top: 1.95 }, ladder: { w: 1, h: 1 },
  // a grave marker's height is its own (ArenaProp.top, one of GRAVE_TOP); this is the headstone default
  grave: { w: 1, h: 1, platform: 0.9 },
};

/** Grave marker height classes (m above its footing). The classes bracket the roster's muzzle extremes (BodyProfile.eye:
 *  0.5 m for the smallest wild Pokémon, 1.42 m for the tallest trainer partner): a kerb stands under every muzzle and is
 *  walkable (≤ 0.6 m, the step limit), a headstone stops the smallest muzzles and the tallest fires over it, a stele
 *  stands over every muzzle. validate.ts checks the bracket on the built map ('marker:height'). */
export const GRAVE_TOP = { kerb: 0.45, stone: 0.9, stele: 1.7 } as const;
export type GraveClass = keyof typeof GRAVE_TOP;
/** the class a marker height belongs to (nearest class) */
export const graveClassOf = (top: number): GraveClass => (top < 0.675 ? 'kerb' : top < 1.3 ? 'stone' : 'stele');

export interface ArenaProp {
  kind: ArenaPropKind; x: number; y: number; w: number; h: number; variant: number; text?: string;
  /** grave markers: height above the footing (m; the platform the sim reads) and lean (-1, 0, 1: which way it settled) */
  top?: number; lean?: number;
}

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
  /** location maps only: a second, walkable surface above the ground (m; 0 = none), e.g. a log bridge or a rock
   *  shelf with open ground beneath it. The ground layer keeps elev/terrain/wall; the deck is never a wall. */
  over?: Float32Array;
  /** habitat maps only (src/world/habitat): the fluid surface height per water tile (m), so a river can run on a
   *  plateau and fall into a pool, or a lava lake sit in a crater. Absent = every water surface at WATER_Y. */
  wlevel?: Float32Array;
  /** authored arenas only: tiles where a throwable body (the `cobble` template, src/rules/materials.ts) lies at the start
   *  (the training range, docs/RANGE.md) */
  throwables?: [number, number][];
  /** procedural regions only (src/world/gen): how the map was made, its habitat and encounter spaces */
  gen?: import('./gen/context').GenMeta;
}

export const WATER_Y = -0.25;
/** Thickness of the solid overhead deck, measured down from ArenaMap.over (metres). */
export const DECK_SLAB = 0.6;
/** a frozen water tile's surface sits this far above the water it covers (sim: World.height; the validator's frozen state) */
export const ICE_LIFT = 0.25;

/**
 * R1b wall tops (docs/SIZING.md "Wall tops"): the absolute height (m) up to which each tile's wall column is solid.
 * A tile under a wall prop gets its footing plus the kind's `top`, the footing being the elevation the renderer stands
 * the prop's card on (its bottom-left tile, render/tilestage.ts), and never less than the tile's own ground (a prop
 * forced across a cliff keeps the higher tile's rock). Every other tile is Infinity: a bare wall (rock mass, cave wall,
 * the habitat's low ruin and cemetery walls) stays solid to any height; readers consult the value on wall tiles only.
 * Built once per World; a prop that burns or breaks clears its tiles' walls and tops in one World.setBlock call.
 * Float64, so a top is exactly its footing + the table's height (a body or a line at that height clears it).
 */
export function wallTopsOf(m: ArenaMap): Float64Array {
  const W = m.w, out = new Float64Array(W * m.h).fill(Infinity);
  for (const p of m.props) {
    const top = PROP_RULES[p.kind].top;
    if (!PROP_RULES[p.kind].wall || top === undefined) continue;
    const bj = Math.min(m.h - 1, p.y + p.h - 1), bi = Math.max(0, Math.min(W - 1, p.x));
    const base = m.elev[bj * W + bi] + top;
    for (let j = p.y; j < p.y + p.h; j++) for (let i = p.x; i < p.x + p.w; i++) {
      if (i < 0 || j < 0 || i >= W || j >= m.h) continue;
      const k = j * W + i;
      if (m.wall[k] === 1) out[k] = Math.max(m.elev[k], base);
    }
  }
  return out;
}

/** Standing height of a bridge (wood) tile: river bridges sit at 0.05 m; elevated decks (location maps) at their elev. */
export const deckTop = (elev: number) => (elev > 0.05 ? elev : 0.05);

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
