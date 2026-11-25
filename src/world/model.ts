// The WorldModel contract (docs/OVERHAUL_3D.md "The WorldModel contract"): one plain, serialisable record per map, the
// only map data physics (src/physics), navigation (src/nav) and the three.js renderer read once the overhaul lands. Each
// builds its own runtime structures from it; visible geometry and collision come from the same generator output.
//
// Plain data only: numbers, strings, booleans, null, typed arrays and plain objects. No classes, no three, no Rapier, no
// functions, so a model survives structuredClone (a worker, a snapshot) and hashes byte for byte.
//
// Coordinates: world metres, y up, the sim's frame (x east, z south; a tile map's tile (i, j) covers
// x in [i − W/2, i − W/2 + 1), z in [j − H/2, j − H/2 + 1)). Triangles wind counter-clockwise seen from the side their
// normal points to (outward for solids, up for walkable faces). Polygons in xz wind counter-clockwise seen from above.
//
// Version 2 (task WM2) is the table of docs/WORLDGEN3D.md "WorldModel contract changes" written as types. It only adds
// beside version 1, except that a render chunk lost its normals and colours and gained a role (Q23). The fields marked
// "tile era" keep the meaning the tile adapter gives them until G1 writes generated maps.
import type { MaterialRole } from '../rules/materialroles';
import type { MaterialId } from '../rules/surfaces';

/** The contract's version (Q19.3). Bumped when the contract changes: its shape, the space tag union, the role union
 *  (rules/materialroles.ts), the volume kinds. Version 1 was the WM shape (render chunks with normals and colours). */
export const MODEL_VERSION = 2;

export type Vec3 = [number, number, number];

// ---- ids whose registries do not exist yet: named string aliases, each closed by the task named ----

/** a liquids-registry id (Q9.4: 'water', 'lava', 'poison', …). Closed by I4, which writes the registry with the liquid
 *  rules of Q9 (damage curve, knock-out time, element, capabilities). The tile adapter writes 'water' and 'lava'. */
export type LiquidId = string;
/** an environment state of a map (Q9.9, Q14: a tide level, a night variant that changes gameplay). Closed by G2, whose
 *  recipe schema declares a map's states. */
export type EnvStateId = string;
/** a stateful feature's kind (Q10f: breakable wall, evaporating pool, freezable water, …). Closed by the
 *  stateful-features task after X1c (WORLDGEN3D "Open items": the design is not final); G1 builds the range's one
 *  feature station against it. */
export type FeatureKind = string;
/** an archetype record in src/rules (Q15.1: a rock, a trunk, a wall piece, …). Closed by G1 (the kit and the
 *  archetypes). */
export type ArchetypeId = string;
/** a timed hazard's schedule, a pure function of the sim tick with a warning phase (Q21.1). Closed by I4. */
export type ScheduleId = string;
/** a traversal capability a link or route needs (Q8.1, Q9.5, Q10.3: 'fly', 'swim', 'dive', 'burrow', 'swim:lava', a
 *  size restriction). Seeded by rules/traversal.ts TraversalKind; closed by G1, whose class A gate checks each station
 *  by its declared capability (Q22.3). */
export type CapabilityId = string;
/** a space's zone-node role (Q1a: 'spawn', 'staging', 'objective', 'combat', 'transit', 'vantage', 'landmark',
 *  'hidden'). Closed by G1 (the IR types). */
export type SpaceRole = string;

/** a space's id; spaces and portals are sorted by id before hashing (Q2b) */
export type SpaceId = string;
export type PortalId = string;
export type FeatureId = string;
/** a breakable's id: the number ColliderBase.destructible holds (a tile map: its ArenaMap.props index) */
export type BreakableId = number;
/** a Hold side (the staging markers' names) */
export type TeamId = 'A' | 'B';
/** what fills a space or carries a route: open air, or a liquid (Q8e, Q9 "Data") */
export type Medium = 'air' | LiquidId;

/** The closed tag union of Q2 (and Q10's soft soil). Contract: changing it bumps MODEL_VERSION (Q2c). */
export const SPACE_TAGS = ['camera-clearance', 'long-lane', 'cover-zone', 'landmark-anchor', 'soft-soil'] as const;
export type SpaceTag = (typeof SPACE_TAGS)[number];

/** when a piece exists: only in one state of a stateful feature, or only in one environment state (Q21.13). Absent: in
 *  every state. */
export type When = { feature: FeatureId; state: number } | { env: EnvStateId };

/** what made the map: the generator and the inputs that reproduce it */
export interface WorldMeta {
  /** the map source: 'arena:<id>', 'habitat:<recipe>[:<variant>]', 'location:<id>', or a generator's own name */
  source: string;
  /** the map's id and display name */
  id: string; name: string;
  /** the seed the map was built from (the used seed) */
  seed: number;
  /** the generator's version (HAB_VERSION, LOC_VERSION, …; 0 for an authored arena) */
  version: number;
  /** the seed asked for (Q13.8). Equal to `seed` unless the ladder fell back to a curated seed */
  requestedSeed: number;
  /** why `seed` differs from `requestedSeed` (the failed gates); absent when they are equal */
  seedReason?: string;
}

/** axis-aligned world box */
export interface Aabb { min: [number, number, number]; max: [number, number, number] }

/** what every static collider carries. The five collision kinds of Q15.4 are spelled with the flags: a collider always
 *  stops bodies; `solid` blocks shots and sight, `foliage` blocks sight only, `grate` blocks neither. (`screen` is a
 *  concealment volume and `dressing` has no collider.) */
export interface ColliderBase {
  /** tile era: a rules/surfaces.ts MaterialId ('stone', 'wood', 'leaf', …) for a prop, or a terrain name (world/tiles.ts
   *  T) for ground. G1 writes the resolved MaterialId of the role's physical binding (Q16.4) */
  material: string;
  /** stops shots. Tile era: shots and sight together (false: foliage that a shot passes, rules/surfaces.ts
   *  MATERIALS[..].blocksShots), so the tile adapter writes blocksSight equal to it */
  blocksShots: boolean;
  /** tile era: foliage cover (a leaf prop), open to the player's shots, solid to bodies (sim/spatial.ts QF.foliage). Not
   *  Q15.4's `foliage` kind, which also blocks sight: in the flags this one is a `grate` */
  foliage: boolean;
  /** set on a piece that can burn or break; one id per destructible thing (a tile map: its ArenaMap.props index). It
   *  points at a `breakables` record once generators write them (Q21.13); the tile adapter writes none */
  destructible?: number;
  /** what the face is for (Q16): the generator's output; physics and the sim read the dominant role */
  role: MaterialRole;
  /** stops sight rays (Q15.4) */
  blocksSight: boolean;
  /** exists only in this feature or environment state (Q21.13) */
  when?: When;
}

/** a solid box: centre and half extents (m), turned `yaw` radians about +y (0 for now) */
export interface BoxCollider extends ColliderBase {
  shape: 'box';
  centre: [number, number, number];
  half: [number, number, number];
  yaw: number;
}

/** a triangle surface: xyz triples and index triples */
export interface TrimeshCollider extends ColliderBase {
  shape: 'trimesh';
  positions: Float32Array;
  indices: Uint32Array;
}

// A convex-hull collider shape (Q3d) waits for G1's measurement of hull proxies.
export type Collider = BoxCollider | TrimeshCollider;

/** `concealment`: blocks sight only; shots and bodies pass both ways, and sight rays from inside pass (Q12.9).
 *  `barrier`: a team's spawn barrier, enforced by the sim (G2): it stops every body of the other team in every movement
 *  mode and lets shots and sight through (Q8h, Q9.8). */
export type VolumeKind = 'liquid' | 'hazard' | 'kill' | 'contest' | 'staging' | 'trigger' | 'concealment' | 'barrier';

/** a liquid's level in one environment state other than the base (Q9.9) */
export interface LiquidLevel { env: EnvStateId; level: number }

/** a region of space with a rule attached; never solid */
export interface Volume {
  kind: VolumeKind;
  box: Aabb;
  /** liquids: the surface height (m) in the base state */
  level?: number;
  /** the element it deals or is (rules/elements.ts: 'tide' water, 'blaze' lava and vents) */
  element?: string;
  /** liquids: the liquids-registry id (Q9.4) */
  liquid?: LiquidId;
  /** liquids: the level in each other environment state; absent: the same level in every state */
  levels?: LiquidLevel[];
  /** liquids: the height (world y, m) of the bed beneath; the depth in a state is that state's level − bed. Absent: no
   *  bed (the tile maps: every water tile's elevation lies above its surface) */
  bed?: number;
  /** hazards: the timed source's schedule (Q21.1); absent: always on */
  schedule?: ScheduleId;
  /** hazards: the box a body is exposed in when it differs from `box` (Q21.1) */
  exposure?: Aabb;
  /** barrier: the team it protects (enemies of that team are stopped) */
  team?: TeamId;
  /** exists only in this feature or environment state (Q21.13) */
  when?: When;
}

/** a link the navmesh cannot see (a drop, a jump, a ladder, a `burrow` underpass); empty until generators write them */
export interface OffMeshLink {
  a: [number, number, number]; b: [number, number, number];
  /** 'drop', 'jump', 'ladder', 'burrow', … (Q8e, Q10.9) */
  kind: string;
  bidirectional: boolean;
  /** every capability a body needs to take it (Q10.3: a size restriction is one); absent or empty: every body */
  needs?: CapabilityId[];
  /** exists only in this feature or environment state (Q21.13) */
  when?: When;
}

/** navmesh area flags, one byte per walkable triangle (bits) */
export const NAV_AREA = {
  /** soft soil: from the material's `burrowable` property, never from a role name (Q10.9, Q16.6) */
  softSoil: 1,
} as const;

/** a node of the volume-routing graph: at a portal centre or a space centre, at travel height (Q8e) */
export interface RouteNode { position: Vec3 }

/** an edge of the volume-routing graph, swept with its clear radius at emit (Q8d) */
export interface RouteEdge {
  /** node indices */
  a: number; b: number;
  medium: Medium;
  /** clear radius (m) */
  radius: number;
  /** every capability a body needs to take it ('fly' for a fly edge, 'dive' for a submerged one) */
  needs?: CapabilityId[];
  when?: When;
}

/** coarse routes for flyers, swimmers and divers between spaces (Q8e, Q9 "Data"); navigation may not read `spaces` */
export interface VolumeGraph { nodes: RouteNode[]; edges: RouteEdge[] }

/** what navigation builds from: the walkable faces (up-facing triangles) and the links between them */
export interface NavInput {
  positions: Float32Array;
  indices: Uint32Array;
  links: OffMeshLink[];
  /** one NAV_AREA bit set per triangle (indices.length / 3) */
  areas: Uint8Array;
  /** the volume-routing graph; bank exits are `links` between it and the navmesh */
  routes: VolumeGraph;
}

/** a terrain vertex's soft edge into a second role (Q16.5): visual only; physics and the sim read the chunk's role */
export interface RoleBlend {
  /** the second role, the same for every vertex of the chunk (a chunk is split by its role pair) */
  role: MaterialRole;
  /** per vertex, the weight of the second role in [0, 1] */
  weight: Float32Array;
}

/** A render chunk: triangles of one role (or one liquid), at most SURFACE_CHUNK m on a side in x and z. Positions are
 *  welded: one vertex per distinct position in the chunk. No normals and no colour (Q23): the renderer computes the
 *  normals across chunk borders and resolves colour from the world style. Outside gameplayHash (Q19.4). */
export interface SurfaceChunk {
  /** the chunk's cell in the SURFACE_CHUNK grid */
  cx: number; cz: number;
  /** 'terrain' (opaque ground, walls, decks, props) or 'liquid' (water and lava surfaces) */
  material: string;
  positions: Float32Array;
  indices: Uint32Array;
  /** terrain chunks: the role */
  role?: MaterialRole;
  /** liquid chunks: the liquid's id instead of a role */
  liquid?: LiquidId;
  /** terrain chunks: the optional two-role blend */
  blend?: RoleBlend;
}

/** the largest render chunk side (m) */
export const SURFACE_CHUNK = 64;

/** `item`: an item spawn candidate with a value (Q10e). `station`: a named range station (Q22.4); `anchor` markers are
 *  named too where a test anchors to them */
export type MarkerKind = 'spawn' | 'staging' | 'contest' | 'body' | 'landmark' | 'anchor' | 'item' | 'station';

/** a named point the game places things at */
export interface Marker {
  kind: MarkerKind;
  position: [number, number, number];
  name?: string;
  /** contest: the capture radius and height (m) */
  radius?: number; height?: number;
  /** item: the candidate's value (balanced between the teams, Q10e) */
  value?: number;
}

/** A space of the space IR, projected (Q2): a footprint prism. Physics and navigation never read it; the sim may read
 *  its role and tags, never its geometry for collision. */
export interface Space {
  id: SpaceId;
  role: SpaceRole;
  tags: SpaceTag[];
  /** the footprint polygon, (x, z) corners */
  footprint: [number, number][];
  /** floor and ceiling heights (m); ceiling null: open sky */
  floor: number;
  ceiling: number | null;
  /** 'air', or the liquid a submerged space holds (a prism from the bed to the surface) */
  medium: Medium;
}

/** the opening between spaces a and b (Q2) */
export interface Portal {
  id: PortalId;
  a: SpaceId; b: SpaceId;
  centre: Vec3;
  /** clear width and height (m) */
  width: number; height: number;
}

/** A stateful feature (Q10f): pre-placed, a small fixed set of states. Its per-state colliders, links and volumes sit in
 *  the flat arrays with `when: { feature, state }`; state 0 is the base. */
export interface Feature {
  id: FeatureId;
  kind: FeatureKind;
  /** the state count (at least 2) */
  states: number;
  position: Vec3;
  /** per state, the navmesh tiles (tx, tz) it touches, which navigation rebuilds (Q20b). The tile size is I3's */
  navTiles: [number, number][][];
}

/** a breakable gameplay-tier prop (Q21.8): breaking removes its colliders and never changes routes */
export interface Breakable {
  id: BreakableId;
  archetype: ArchetypeId;
  position: Vec3;
}

/** One space's surface cells on the 1.0 m lattice (Q21.5): cell (i, j) covers x in [i, i + 1), z in [j, j + 1) in world
 *  metres. Parallel arrays, one entry per cell; stacked floors get distinct cells through their spaces. The sim keys
 *  surface states (wet, burning, frozen, ash) on the material. */
export interface SurfaceCells {
  space: SpaceId;
  i: Int32Array;
  j: Int32Array;
  /** floor height (m) */
  floor: Float32Array;
  /** per cell, an index into `materials` */
  material: Uint8Array;
  materials: MaterialId[];
}

export interface WorldModel {
  meta: WorldMeta;
  bounds: Aabb;
  colliders: Collider[];
  volumes: Volume[];
  navInput: NavInput;
  surfaces: SurfaceChunk[];
  markers: Marker[];
  /** the space IR's projection, sorted by id (Q2) */
  spaces: Space[];
  portals: Portal[];
  /** stateful features (Q10f, Q21.13) */
  features: Feature[];
  /** breakables (Q21.13), sorted by id */
  breakables: Breakable[];
  /** surface cells, one record per space (Q21.5) */
  cells: SurfaceCells[];
}
