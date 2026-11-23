// DRAFT (task WS, before /grilling): the sim's one world seam. Not wired yet; open questions are marked Q<n> and are
// put to the owner before implementation (docs/OVERHAUL_3D.md "World seam" records the answers).
//
// WorldQuery is what physics (I1a/I1b) and navigation (I3) will provide: every question is asked at a 3D point, y up,
// heights in metres, (x, y, z) argument order. The tile World (sim/world.ts) implements it with wrappers that call its
// existing methods with the same arguments in the same order (no new arithmetic), so no replay hash moves.
//
// Tile-only state stays outside the seam as named tile extensions (TileExt below), each to be redesigned in I4 or
// deleted at X1b: surface states (CellField), the W4 prop overlay (PropField), the tide, vent fields, chasm tiles, deck
// tiles, the tile grid frame, and the column (no y) reads that have no 3D meaning.

import type { RayHit } from '../world/sight';
import type { CellField } from './cells';
import type { PropField } from './props';
import type { ArenaMap } from '../world/tiles';
import type { BiomeDef } from '../rules/stages';
import type { HabMeta } from '../world/habitat/types';

/** Q2: the explicit "no reference height" argument. Today's column calls (World.height(x, z), walkable(x, z), …) pass
 *  it, so every one of them is visible at its call site and I1 can give each a real y. The tile World reads it as
 *  "the ground layer" (exactly today's omitted argument). */
export const GROUND = undefined;
export type RefY = number | typeof GROUND;

/** Q5: an agent's size for navigation and placement (today's footprint, wide flag, diagonal links and height class) */
export interface NavAgent {
  /** footprint radius (0 = point collision) */
  readonly foot: number;
  /** routes on the wide lattice (rules/sizing.ts navWide) */
  readonly wide: boolean;
  /** may take diagonal-only lattice links (foot < DIAG_R) */
  readonly diag: boolean;
  /** sim height, for headroom (undefined = any) */
  readonly tall?: number;
}

/** Q6: navigation goals (today: the player's flow field, the Hold contest's) */
export type NavGoal = 'player' | 'contest';

export interface WorldQuery {
  // ---- frame and markers -------------------------------------------------------------------------------------------
  /** |x| and |z| stay within this (today World.bound) */
  readonly bound: number;
  /** an actor below this has fallen out of the world (World.killY) */
  readonly killY: number;
  /** where the trainer starts (World.spawn), Q7 */
  readonly spawn: readonly [number, number];
  /** where enemies enter (cave mouths, gates; World.anchors), Q7 */
  readonly anchors: readonly (readonly [number, number])[];

  // ---- support and medium ------------------------------------------------------------------------------------------
  /** the surface a body at (x, y, z) stands on, or would land on: World.height(x, z, y). Q3 */
  surfaceAt(x: number, y: RefY, z: number): number;
  /** as surfaceAt, but -Infinity where there is no supporting floor (open air): World.support(x, z, y). Q3 */
  supportAt(x: number, y: RefY, z: number): number;
  /** the liquid feet at y touch (0 none, 1 water, 2 lava): World.liquidAt(x, z, y, contact) */
  liquidAt(x: number, y: number, z: number, contact: number): number;
  /** lowest ceiling over a footprint of radius r above feet at y (World.headroomAt) */
  headroomAt(x: number, y: number, z: number, r: number): number;

  // ---- bodies ------------------------------------------------------------------------------------------------------
  /** move a footprint of radius r, feet at y, by (dx, dz) with step height `step` into out (World.moveBody) */
  moveBody(x: number, y: number, z: number, dx: number, dz: number, step: number, r: number, out: [number, number],
    stop?: (x: number, z: number) => boolean, tall?: number, over?: boolean): void;
  /** solid geometry at a point for feet at y (World.collides); Q4 */
  solidFor(x: number, y: number, z: number, step: number, tall?: number, over?: boolean): boolean;
  /** solid, or not to be walked into on one's own (open liquid, open air): World.blocks; Q4 */
  blockedFor(x: number, y: number, z: number, step: number, tall?: number, over?: boolean): boolean;
  /** does a footprint of radius r stand clear at (x, y, z)? (World.fits) */
  fits(x: number, y: number, z: number, r: number, step?: number, tall?: number, over?: boolean): boolean;
  /** R1b: the highest crossable top under a footprint that feet at y are at or above (World.topUnder), Q8 */
  topBelow(x: number, y: number, z: number, r: number): number;
  /** R1b: is a body at (x, y, z) inside rock (World.inRock), Q8 */
  inRock(x: number, y: number, z: number, over?: boolean): boolean;

  // ---- rays (sim/spatial.ts shape; the actor sweeps and overlaps stay in spatial.ts and call these) ----------------
  raycast(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxT: number, mask: number, hit: RayHit,
    r?: number, h?: number, flags?: number): boolean;
  segmentClear(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, mask?: number, flags?: number): boolean;
  solidAt(x: number, y: number, z: number, mask?: number, flags?: number): number;
  /** legacy enemy sight, 0.5 m samples (World.sight) */
  sight(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): boolean;

  // ---- navigation and placement ------------------------------------------------------------------------------------
  /** ground walkers stand here and reach the player from here (World.walkable) */
  walkable(x: number, y: RefY, z: number): boolean;
  /** nearest walkable point (World.nearestWalkable) */
  nearestWalkable(x: number, y: RefY, z: number): [number, number];
  /** where a body is put down near (x, z) (World.nearestFit) */
  place(x: number, y: RefY, z: number, agent: NavAgent, reach?: boolean): [number, number];
  /** the goal moved (World.updateFlow: the player's position) */
  setNavGoal(x: number, y: RefY, z: number): void;
  /** unit steering toward a goal into out: 1 a direction, 0 steer straight / none, -1 hold (World.flowDir, wideDir,
   *  goalDir, wideGoalDir), Q5/Q6 */
  navDir(goal: NavGoal, x: number, y: RefY, z: number, agent: NavAgent, out: [number, number]): -1 | 0 | 1;
  /** does an agent here have a route to the goal (World.wideReached; narrow agents: walkable), Q5 */
  navReached(goal: NavGoal, x: number, y: RefY, z: number, agent: NavAgent): boolean;
  /** route length toward the goal, Infinity when none (World.flowDist), Q9 */
  navDist(goal: NavGoal, x: number, y: RefY, z: number): number;

  /** the named tile extensions (Q1) */
  readonly tiles: TileExt;
}

/** Tile-only state and reads, outside the seam (redesigned in I4, deleted at X1b). Q1, Q10 */
export interface TileExt {
  // grid frame
  readonly w: number; readonly h: number; readonly half: number;
  readonly map: ArenaMap;
  tile(x: number, z: number): number;
  readonly biome: BiomeDef;
  habitatAt(x: number, z: number): number;
  /** location maps: shots and enemy sight respect terrain (World.los) */
  readonly los: boolean;
  /** rules.hazards.enabled as the world was built (World.hazards) */
  readonly hazards: boolean;
  // column reads with no 3D meaning
  groundAt(x: number, z: number): number;
  solid(x: number, z: number): boolean;
  wallAt(x: number, z: number): boolean;
  waterAt(x: number, z: number): number;
  shore(x: number, z: number, radius: number, level?: number, reach?: number, room?: number): [number, number] | null;
  // decks
  readonly over: Float32Array | null;
  onDeck(x: number, z: number, y: number): boolean;
  // chasms
  isVoid(k: number): boolean;
  // surface states
  readonly cells: CellField;
  readonly burnCost: number;
  burningAt(x: number, z: number): boolean;
  refreshNav(): void;
  refreshFlow(px: number, pz: number, py?: number): void;
  // W4 overlay
  readonly propField: PropField | null;
  setBlock(k: number, wall: number, platform: number): void;
  reachableCount(x: number, z: number): number;
  // tide
  readonly tide: World['tide'];
  readonly tideHigh: boolean;
  setTide(high: boolean): void;
  tidalAt(x: number, z: number): boolean;
  // habitat meta and vent fields
  readonly hab: HabMeta | null;
  readonly hazard: Uint8Array | null;
  hazardAt(x: number, z: number): boolean;
}

import type { World } from './world';
