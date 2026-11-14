// Habitat recipes and mode graphs: the data the habitat generator (src/world/habitat) builds a playable match map from
// (docs/HABITATS.md). Two representations are kept apart, as the environment specification recommends
// (docs/Pokemon_World_Environment_Specification.md, section H):
//
//   HabitatRecipe  the environment envelope: landform, support and medium, structural anchors, vegetation and landmark
//                  rules, optional features, surface variants, compatible seams, and what seeds may vary. Every anchor is
//                  tagged as canon (a physical reference from the games), reinterpretation, or original adaptation.
//   ModeGraph      the match topology, independent of scenery: team spawns, staging, approaches, the contest area and
//                  exits as a directed graph whose edges carry width, clearance, grade, rise, direction and exposure.
//
// The generator embeds the mode graph in the recipe's landform, then derives routes and sightlines from the finished
// collision (validate.ts). Nothing in the generator names a recipe; recipes name generator kernels.
import type { TerrainId } from '../tiles';

export interface Ref { title: string; url: string }

/** how a recipe element relates to the official games */
export type Provenance = 'canon' | 'reinterpretation' | 'original';

export interface Anchor {
  id: string;
  /** what it is in physical terms */
  form: string;
  /** the reusable family it is built from (families.ts) */
  family: FamilyId;
  provenance: Provenance;
  /** reference indices (HabitatRecipe.refs) for canon and reinterpretation anchors */
  refs: number[];
  /** a locked anchor defines the habitat: repairs may never alter its tiles, and a seed that loses it is rejected */
  locked: boolean;
}

/** the minimum set of geometry families both recipes share (spec catalogue ids in brackets) */
export type FamilyId =
  | 'relief' // relief patches, slopes and ramps [B01, B11]
  | 'cliff' // cliffs, scarps and benches [B05, B11]
  | 'boulder' // boulders, slabs, outcrops and spurs [A01, A02, C01]
  | 'stand' // tree stands, understory and clearings [A06, C02, D03]
  | 'channel' // channels and basins of a fluid medium: river, falls, plunge pool, lava lake [B07, B08, C03, E01]
  | 'chamber' // chambers and tunnels carved from solid rock [B09, B10, C06]
  | 'structure'; // walls, decks, bridges, causeways and plinths [A16, A17, A18, C11, C14]

/** a fluid the map holds; each has its own movement and state contract */
export type Medium = 'water' | 'lava';

export interface VegetationRule {
  /** prop kinds a stand is made of (2×2 walls) and its edge fill */
  trees: string[];
  fill: string;
  /** understory and low cover a stand edge carries */
  under: string[];
  /** stand density (0..1) where suitability is best */
  density: number;
  /** suitability: moisture band (0 dry .. 1 riparian) and how strongly moisture raises density */
  moisture: [number, number];
  /** share of open floor left as clearings with tall grass (0 = none) */
  clearings: number;
}

export interface HabitatRecipe {
  id: string;
  name: string;
  summary: string;
  /** the generator kernel that lays out this landform (landforms.ts) */
  landform: 'gorge' | 'crater' | 'shoal';
  /** support model: every playable surface is supported ground or a supported deck */
  support: 'ground';
  medium: Medium;
  anchors: Anchor[];
  /** interpretations made for play, listed apart from canon */
  adaptations: { feature: string; why: string }[];
  refs: Ref[];
  vegetation: VegetationRule;
  /** prop kinds per role */
  props: { cover: string[]; low: string[]; ruin: string[]; decor: string[]; landmark: string; landmarkProp: string };
  /** physical surfaces; a snow or ash variant swaps these and keeps every geometry family */
  surfaces: Record<'floor' | 'rim' | 'route' | 'ramp' | 'bank' | 'terrace' | 'shelf', TerrainId>;
  /** surface variants with the same physical roles: the same geometry, different paint and plants (a snow-covered
   *  boulder is still a boulder; spec section B, "What earns dedicated geometry") */
  variants: Record<string, { name: string; surfaces?: Partial<HabitatRecipe['surfaces']>; art?: string; particles?: HabitatRecipe['particles']; trees?: string[]; fill?: string; under?: string[] }>;
  /** optional features: each may be on or off per seed */
  optional: { id: string; chance: number; what: string }[];
  /** recipes this one can border through a physical seam (spec R06) */
  seams: { recipe: string; via: string }[];
  /** what seeds may vary (ranges in tiles or metres); the landform kernel reads these */
  freedoms: Record<string, [number, number]>;
  /** heights of the landform's levels (m) */
  levels: Record<string, number>;
  /** palette key for the renderer (render/tileart.ts BIOME_ART) */
  art: string;
  particles?: 'petals' | 'embers' | 'snow' | 'motes' | 'sparks' | 'dust';
  /** stage biomes whose spawn tables fit this habitat's ecology */
  biomeFit: string[];
  /** seeds verified to pass every gate at this generator version: the known valid fallback */
  fallbackSeeds: number[];
  /** the environment states this map really has (validate.ts enumerates every one) */
  states: HabitatState[];
  /** a tidal fluid body (sim/hazards.ts tideSystem, rules.habitat.tide): its level moves between `low` and `high` (m) over
   *  one fixed floor, so ground below `high` that the water reaches is dry at low water and flooded at high water */
  tide?: { low: number; high: number };
}

/** environment states the validator enumerates (PBL04) */
export type HabitatState =
  | 'base'
  | 'frozen' // water frozen by Cold: ice is walkable (adds edges; essential routes may not depend on it)
  | 'venting' // vent fields erupt: hazard tiles deal damage (essential routes may not touch them)
  | 'flooded' // high water: every tidal tile is open water at the tide's high level (essential routes may not touch them)
  | 'stripped'; // every destructible prop (trees, bushes, rocks, boulders, pillars) burnt or broken

// ---- mode graph ----------------------------------------------------------------------------------------------

export type ModeRole = 'spawn' | 'staging' | 'approach' | 'contest' | 'exit';
export type Team = 'A' | 'B' | 'neutral';

export interface ModeNode { id: string; role: ModeRole; team: Team }

export interface EdgeReq {
  /** minimum clear width (m) along the edge */
  width: number;
  /** minimum headroom (m) where the edge runs under a deck */
  clearance: number;
  /** maximum grade (m rise per m) and maximum single step (m) */
  grade: number; step: number;
  /** total rise allowed along the edge (m, absolute) */
  rise: number;
  /** exposure the route should have: screened routes keep cover between them and the far rim */
  exposure: 'open' | 'screened' | 'any';
  /** approaches in the same group share a physical bottleneck by design (they count as one) */
  group: string;
}

/** stage: spawn to staging; direct / flank: the two approaches (a recipe decides what they are made of: a bridge, a
 *  screened bench and causeway, a switchback, a cave); return: contest back to staging */
export interface ModeEdge { from: string; to: string; directed: boolean; req: EdgeReq; kind: 'stage' | 'direct' | 'flank' | 'return' }

export interface ModeGraph {
  id: string;
  name: string;
  /** the objective kind of the sim this mode drives (sim/objectives.ts) */
  objective: 'hold';
  /** contest radius (m): the sim's Hold radius */
  contestR: number;
  nodes: ModeNode[];
  edges: ModeEdge[];
}

// ---- movement profiles ----------------------------------------------------------------------------------------

/** a body and locomotion profile measured from the sim and roster (mode.ts derives them, validate.ts uses them) */
export interface BodyProfile {
  id: string;
  /** body radius (m) */
  radius: number;
  /** highest step without a jump (m) */
  step: number;
  /** highest ledge reachable with the profile's ordinary locomotion (m); baseline = no jump */
  climb: number;
  /** highest drop it takes on purpose (m) */
  drop: number;
  /** eye / muzzle heights above the feet (m): lowest and highest of the profile */
  eye: [number, number];
  speed: number;
  /** essential profiles must pass every hard gate; the others are reported */
  essential: boolean;
  note: string;
}

// ---- what a generated map records (ArenaMap.gen.hab) ------------------------------------------------------------

export interface HabMeta {
  recipe: string;
  variant: string;
  /** generator version: recipe + seed + version (+ map size) reproduce the layout */
  version: number;
  /** the seed asked for, and the seed of the attempt that was accepted */
  seed: number; attemptSeed: number; attempts: number;
  medium: Medium;
  contest: { x: number; y: number; r: number; h: number };
  stage: { A: [number, number]; B: [number, number] };
  approaches: { id: string; team: 'A' | 'B'; kind: 'direct' | 'flank'; form: string; tiles: number }[];
  /** hazard tile indices (vent fields) */
  hazard: number[];
  /** tidal maps: the tiles the water covers at high water (dry floor at low water), and the two levels (m) */
  tide?: { tiles: number[]; low: number; high: number };
  optional: string[];
  /** the geometry families the map was built from */
  families: FamilyId[];
  /** variety signature of the traversable geometry */
  shape: Record<string, number>;
  gates: { id: string; ok: boolean; value: string }[];
  metrics: Record<string, number>;
  repairs: string[];
  /** every attempt that was rejected, with the gates it failed */
  rejections: { seed: number; failed: string[] }[];
  /** set when the requested seed failed every attempt and a known valid seed was loaded instead */
  fallback?: { requested: number; used: number; why: string };
  anchors: { id: string; provenance: Provenance; locked: boolean }[];
  notes: string[];
}
