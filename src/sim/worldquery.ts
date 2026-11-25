// The sim's world seam (task WS; decisions in docs/OVERHAUL_3D.md "World seam"). Every sim system asks the world its
// questions through WorldQuery: at a 3D point, y up, metres, (x, y, z) argument order. It is what physics (I1a, I1b) and
// navigation (I3) will provide. Today the tile World (sim/world.ts) implements it with wrappers that call its own
// methods with the same arguments in the same order, so no replay hash depends on this file.
//
// Systems read the world only through worldOf(ctx), the one swap point for I1a (tests/worldseam.test.ts enforces it, and
// that no sim file outside the allow-list names the World type). The actor queries' world half (sim/spatial.ts geoOf +
// castWorld) is the second swap point.
//
// Tile-only state stays outside the seam as named tile extensions (TileExt, reached as W.tiles): the grid frame, the
// column reads with no 3D meaning, decks and chasms, surface states (CellField), the W4 prop overlay (PropField), the
// tide, the habitat meta and vent fields. They are redesigned in I4 or deleted at X1b.

import type { RayHit } from '../world/sight';
import type { CellField } from './cells';
import type { PropField } from './props';
import type { ArenaMap } from '../world/tiles';
import type { BiomeDef } from '../rules/stages';
import type { HabMeta } from '../world/habitat/types';

/** The explicit "no reference height" argument. A call that passes it is a column question (the tile World's ground
 *  layer, exactly today's omitted argument); every one is visible at its call site so I1 can give it a real y. */
export const GROUND = undefined;
/** a reference height, or GROUND */
export type RefY = number | typeof GROUND;

/** navigation goals: the player's field, the habitat Hold's contest field */
export type NavGoal = 'player' | 'contest';

export interface WorldQuery {
  // ---- frame and markers -------------------------------------------------------------------------------------------
  /** |x| and |z| stay within this */
  readonly bound: number;
  /** an actor below this height has fallen out of the world */
  readonly killY: number;
  /** where the trainer starts (x, z) */
  readonly spawn: [number, number];
  /** where enemies enter (cave mouths, forest gates, tunnels), (x, z) */
  readonly anchors: [number, number][];

  // ---- support and medium ------------------------------------------------------------------------------------------
  /** the surface a body with its feet at y stands on at (x, z), or lands on (a chasm's floor counts) */
  surfaceAt(x: number, y: RefY, z: number): number;
  /** as surfaceAt, but -Infinity where nothing supports feet at y (open air) */
  supportAt(x: number, y: RefY, z: number): number;
  /** the liquid feet at y are in contact with: 0 none, 1 water, 2 lava (`contact`: how far above the surface counts) */
  liquidContact(x: number, y: number, z: number, contact: number): number;
  /** the lowest ceiling over a footprint of radius r above feet at y, Infinity where there is none */
  headroomOver(x: number, y: number, z: number, r: number): number;

  // ---- bodies ------------------------------------------------------------------------------------------------------
  /** move a footprint of radius r, feet at y, by (dx, dz) with step height `step`, into out (the one collision
   *  resolver for bodies; `stop` adds centre-point refusals, `tall` headroom, `over` the R1b crossing permission) */
  moveFootprint(x: number, y: number, z: number, dx: number, dz: number, step: number, r: number, out: [number, number],
    stop?: (x: number, z: number) => boolean, tall?: number, over?: boolean): void;
  /** solid geometry in the way of feet at y at (x, z): walls, faces higher than `step`, slabs a head would hit */
  solidFor(x: number, y: number, z: number, step: number, tall?: number, over?: boolean): boolean;
  /** solidFor, or ground not to be walked into on one's own (open liquid, open air) */
  blockedFor(x: number, y: number, z: number, step: number, tall?: number, over?: boolean): boolean;
  /** does a footprint of radius r stand clear at (x, z) with its feet at y? (step default 0.6) */
  fitsAt(x: number, y: number, z: number, r: number, step?: number, tall?: number, over?: boolean): boolean;
  /** R1b: the highest crossable top under a footprint of radius r that feet at y are at or above (a descending body
   *  with the crossing permission stops there), -Infinity where there is none */
  topBelow(x: number, y: number, z: number, r: number): number;
  /** R1b: is a body with its feet at y inside rock? (`over`: at or above a crossable top is open air) */
  insideRock(x: number, y: number, z: number, over?: boolean): boolean;

  // ---- rays (sim/spatial.ts semantics; the actor sweeps and overlaps stay in spatial.ts) ---------------------------
  /** first world contact along o + d·t, 0 ≤ t ≤ maxT (sim/spatial.ts raycastWorld) */
  raycast(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxT: number, mask: number, hit: RayHit,
    r?: number, h?: number, flags?: number): boolean;
  /** is the open segment clear of the world kinds in mask? (sim/spatial.ts segmentClear) */
  segmentClear(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, mask?: number, flags?: number): boolean;
  /** the solid kind at a point, 0 where open (sim/spatial.ts solidAt) */
  solidAt(x: number, y: number, z: number, mask?: number, flags?: number): number;
  /** legacy enemy line of sight, sampled every 0.5 m */
  sight(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): boolean;

  // ---- navigation and placement ------------------------------------------------------------------------------------
  /** ground walkers can stand here and reach the player from here */
  walkableAt(x: number, y: RefY, z: number): boolean;
  /** the nearest walkable point to (x, z). The tile World ignores y (it searches the ground layer) */
  nearestWalkableAt(x: number, y: RefY, z: number): [number, number];
  /** where a body of footprint r is put down near (x, z) (spawn, relocation, rescue); `wide` routes on the wide lattice,
   *  `reach` (default true) keeps a wide body on ground the player's wide field reaches. The tile World ignores y */
  place(x: number, y: RefY, z: number, r: number, wide: boolean, reach?: boolean, tall?: number): [number, number];
  /** the player moved: navigation toward the player follows */
  setNavGoal(x: number, y: RefY, z: number): void;
  /** unit steering toward a goal into out: 1 a direction, 0 none (steer straight, or no route for a narrow agent), -1
   *  hold (a wide agent with no route). `wide`: footprint ≥ heavyRadius; `diag`: footprint under DIAG_R; `tall`: height */
  navDir(goal: NavGoal, x: number, y: RefY, z: number, out: [number, number], wide?: boolean, diag?: boolean, tall?: number): -1 | 0 | 1;
  /** wide agents: is (x, z) on the player's wide field (a route to the player, and back)? */
  navReached(goal: 'player', x: number, y: RefY, z: number, diag?: boolean, tall?: number): boolean;
  /** route length to the player (tiles today), Infinity where there is none */
  navDist(goal: 'player', x: number, y: RefY, z: number): number;

  /** the named tile extensions */
  readonly tiles: TileExt;
}

/** Tile-only state and reads, outside the seam (redesigned in I4, deleted at X1b). Names are the tile World's own. */
export interface TileExt {
  // the grid frame
  readonly w: number; readonly h: number; readonly half: number;
  readonly map: ArenaMap;
  tile(x: number, z: number): number;
  node(x: number, z: number, y?: number): number;
  readonly biome: BiomeDef;
  habitatAt(x: number, z: number): number;
  /** location maps: terrain and walls block shots and enemy sight */
  readonly los: boolean;
  /** rules.hazards.enabled as the world was built */
  readonly hazards: boolean;
  // column reads
  solid(x: number, z: number): boolean;
  wallAt(x: number, z: number): boolean;
  waterAt(x: number, z: number): number;
  shore(x: number, z: number, radius: number, level?: number, reach?: number, room?: number): [number, number] | null;
  /** I1a: bumped by every run-time geometry change (setBlock, setTide, refreshNav), so the physics bridge rebuilds */
  readonly geoGen: number;
  // decks and chasms
  readonly over: Float32Array | null;
  isVoid(k: number): boolean;
  // surface states
  readonly cells: CellField;
  readonly burnCost: number;
  burningAt(x: number, z: number): boolean;
  refreshNav(): void;
  refreshFlow(px: number, pz: number, py?: number): void;
  // the W4 prop overlay
  readonly propField: PropField | null;
  setBlock(k: number, wall: number, platform: number): void;
  reachableCount(x: number, z: number): number;
  // the tide
  readonly tide: { tiles: Int32Array; terrain: Uint8Array; wlevel: Float32Array; high: number; mask: Uint8Array } | null;
  readonly tideHigh: boolean;
  setTide(high: boolean): void;
  tidalAt(x: number, z: number): boolean;
  // habitat meta and vent fields
  readonly hab: HabMeta | null;
  readonly hazard: Uint8Array | null;
  hazardAt(x: number, z: number): boolean;
}

/** what worldOf asks when the run is on physics (sim/physseam.ts PhysicsBridge) */
export interface SeamSwap { seamFor(w: WorldQuery): WorldQuery }

/** The one way sim systems reach the world (I1a's swap point): the tile World, or with rules.physics.engine 'rapier'
 *  the physics seam over it (sim/physseam.ts: rays on Rapier, everything else forwarded). Hoist it once per function, at
 *  entry or before the first loop, never inside a loop body. */
export function worldOf(ctx: { readonly world: WorldQuery; readonly physics?: SeamSwap | null }): WorldQuery {
  const p = ctx.physics;
  return p ? p.seamFor(ctx.world) : ctx.world;
}
