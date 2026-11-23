// The WorldModel contract (docs/OVERHAUL_3D.md "The WorldModel contract"): one plain, serialisable record per map, the
// only map data physics (src/physics), navigation (src/nav) and the three.js renderer read once the overhaul lands. Each
// builds its own runtime structures from it; visible geometry and collision come from the same generator output.
//
// Plain data only: numbers, strings, booleans, typed arrays and plain objects. No classes, no three, no Rapier, no
// functions, so a model survives structuredClone (a worker, a snapshot) and hashes byte for byte.
//
// Coordinates: world metres, y up, the sim's frame (x east, z south; a tile map's tile (i, j) covers
// x in [i − W/2, i − W/2 + 1), z in [j − H/2, j − H/2 + 1)). Triangles wind counter-clockwise seen from the side their
// normal points to (outward for solids, up for walkable faces).

/** what made the map: the generator and the inputs that reproduce it */
export interface WorldMeta {
  /** the map source: 'arena:<id>', 'habitat:<recipe>[:<variant>]', 'location:<id>', or a generator's own name */
  source: string;
  /** the map's id and display name */
  id: string; name: string;
  seed: number;
  /** the generator's version (HAB_VERSION, LOC_VERSION, …; 0 for an authored arena) */
  version: number;
}

/** axis-aligned world box */
export interface Aabb { min: [number, number, number]; max: [number, number, number] }

/** what every static collider carries */
export interface ColliderBase {
  /** surface material: a rules/surfaces.ts MaterialId ('stone', 'wood', 'leaf', …) or a terrain name (world/tiles.ts T) */
  material: string;
  /** stops shots and sight (false: foliage that a shot passes, rules/surfaces.ts MATERIALS[..].blocksShots) */
  blocksShots: boolean;
  /** foliage cover (a leaf prop): open to the player's shots, solid to bodies (sim/spatial.ts QF.foliage) */
  foliage: boolean;
  /** set on a piece that can burn or break; one id per destructible thing (a tile map: its ArenaMap.props index) */
  destructible?: number;
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

export type Collider = BoxCollider | TrimeshCollider;

export type VolumeKind = 'liquid' | 'hazard' | 'kill' | 'contest' | 'staging' | 'trigger';

/** a region of space with a rule attached; never solid */
export interface Volume {
  kind: VolumeKind;
  box: Aabb;
  /** liquids: the surface height (m) */
  level?: number;
  /** the element it deals or is (rules/elements.ts: 'tide' water, 'blaze' lava and vents) */
  element?: string;
}

/** a link the navmesh cannot see (a drop, a jump, a ladder); empty until generators write them */
export interface OffMeshLink { a: [number, number, number]; b: [number, number, number]; kind: string; bidirectional: boolean }

/** what navigation builds from: the walkable faces (up-facing triangles) and the links between them */
export interface NavInput {
  positions: Float32Array;
  indices: Uint32Array;
  links: OffMeshLink[];
}

/** a render chunk: flat or smooth shaded triangles of one material, at most SURFACE_CHUNK m on a side in x and z */
export interface SurfaceChunk {
  /** the chunk's cell in the SURFACE_CHUNK grid */
  cx: number; cz: number;
  /** 'terrain' (opaque ground, walls, decks) or 'liquid' (water and lava surfaces) */
  material: string;
  positions: Float32Array;
  normals: Float32Array;
  /** linear rgb triples in [0, 1], one per vertex */
  colours: Float32Array;
  indices: Uint32Array;
}

/** the largest render chunk side (m) */
export const SURFACE_CHUNK = 64;

export type MarkerKind = 'spawn' | 'staging' | 'contest' | 'body' | 'landmark' | 'anchor';

/** a named point the game places things at */
export interface Marker {
  kind: MarkerKind;
  position: [number, number, number];
  name?: string;
  /** contest: the capture radius and height (m) */
  radius?: number; height?: number;
}

export interface WorldModel {
  meta: WorldMeta;
  bounds: Aabb;
  colliders: Collider[];
  volumes: Volume[];
  navInput: NavInput;
  surfaces: SurfaceChunk[];
  markers: Marker[];
}
