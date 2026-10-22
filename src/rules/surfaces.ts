// One material table for the world (Procedural Pokémon World Blueprint, section 6). The generator never writes
// behaviour, it writes material references: every tile type and prop kind points to a row here, and every agent and
// force reads it. A generated forest burns because "wood" burns, with no forest script.
//
// Six materials × four agents = 24 cells, defined once in REACTIONS. Tiles (grass, water, ice) are run by
// sim/cells.ts; props (leaf, wood, stone) by sim/props.ts. tests/surfaces.test.ts checks every cell of the table
// against what the simulation does.
import type { ArenaPropKind } from '../world/tiles';
import type { Element } from './elements';

export type MaterialId = 'grass' | 'leaf' | 'wood' | 'stone' | 'water' | 'ice';
export type AgentId = 'heat' | 'wet' | 'cold' | 'charge';
/** what one agent does to one material */
export type Reaction = 'ignite' | 'douse' | 'freeze' | 'melt' | 'steam' | 'conduct' | 'none';

export interface Material {
  /** Pokémon type it takes damage as (type chart) */
  type: Element;
  /** seconds it burns (0 = does not burn) */
  burn: number;
  /** what it leaves when it burns out: grass → ash then regrows, leaf → nothing, wood → stump */
  burnsInto: 'ash' | 'gone' | 'stump' | null;
  /** blocks ground shots when it stands as a prop */
  blocksShots: boolean;
}

export const MATERIALS: Record<MaterialId, Material> = {
  grass: { type: 'bloom', burn: 4, burnsInto: 'ash', blocksShots: false },
  leaf: { type: 'bloom', burn: 3, burnsInto: 'gone', blocksShots: false },
  wood: { type: 'bloom', burn: 6, burnsInto: 'stump', blocksShots: true },
  stone: { type: 'stone', burn: 0, burnsInto: null, blocksShots: true },
  water: { type: 'tide', burn: 0, burnsInto: null, blocksShots: false },
  ice: { type: 'frost', burn: 0, burnsInto: null, blocksShots: false },
};

/** the 24-cell reaction table: REACTIONS[material][agent] */
export const REACTIONS: Record<MaterialId, Record<AgentId, Reaction>> = {
  grass: { heat: 'ignite', wet: 'douse', cold: 'douse', charge: 'none' },
  leaf: { heat: 'ignite', wet: 'douse', cold: 'douse', charge: 'none' },
  wood: { heat: 'ignite', wet: 'douse', cold: 'douse', charge: 'none' },
  stone: { heat: 'none', wet: 'none', cold: 'none', charge: 'none' },
  water: { heat: 'steam', wet: 'none', cold: 'freeze', charge: 'conduct' },
  ice: { heat: 'melt', wet: 'none', cold: 'freeze', charge: 'none' },
};

export interface PropMaterial {
  mat: MaterialId;
  /** Weight class (0–4): a Push or impact of at least this Power breaks it outright */
  weight: number;
  /** integrity (hit points against weaker forces); 0 = unbreakable (landmarks, buildings, bridges) */
  integrity: number;
  /** what breaking leaves */
  breaksInto: 'stump' | 'rubble' | 'gone';
  /** counts toward the region's cover (the permanent-loss cap) */
  cover: boolean;
}

const tree: PropMaterial = { mat: 'wood', weight: 3, integrity: 80, breaksInto: 'stump', cover: true };
const bush: PropMaterial = { mat: 'leaf', weight: 1, integrity: 20, breaksInto: 'gone', cover: true };

/** prop kind → material. Kinds not listed (flowers, reeds, lilies, tall grass props) are decoration. */
export const PROP_MATERIALS: Partial<Record<ArenaPropKind, PropMaterial>> = {
  tree, tree2: tree, round: tree, blossom: tree, deadtree: { ...tree, integrity: 50 }, icepine: tree,
  elder: { mat: 'wood', weight: 4, integrity: 0, breaksInto: 'stump', cover: true }, // a landmark: scorches, never falls
  bush, bushR: bush, bushB: bush, hedge: { ...bush, integrity: 30 }, berry: { ...bush, integrity: 0 }, mushroom: { ...bush, mat: 'leaf' },
  stump: { mat: 'wood', weight: 2, integrity: 40, breaksInto: 'gone', cover: true },
  log: { mat: 'wood', weight: 2, integrity: 50, breaksInto: 'gone', cover: true },
  fence: { mat: 'wood', weight: 1, integrity: 20, breaksInto: 'gone', cover: true },
  bench: { mat: 'wood', weight: 1, integrity: 20, breaksInto: 'gone', cover: false },
  cabin: { mat: 'wood', weight: 4, integrity: 0, breaksInto: 'gone', cover: false }, // homes scorch, never burn down
  sign: { mat: 'wood', weight: 4, integrity: 0, breaksInto: 'gone', cover: false },
  rock: { mat: 'stone', weight: 2, integrity: 60, breaksInto: 'rubble', cover: true },
  boulder: { mat: 'stone', weight: 3, integrity: 120, breaksInto: 'rubble', cover: true },
  pillar: { mat: 'stone', weight: 3, integrity: 90, breaksInto: 'rubble', cover: true },
  pillarBroken: { mat: 'stone', weight: 2, integrity: 60, breaksInto: 'rubble', cover: true },
  statue: { mat: 'stone', weight: 4, integrity: 0, breaksInto: 'rubble', cover: false },
  shrine: { mat: 'stone', weight: 4, integrity: 0, breaksInto: 'rubble', cover: false },
  lantern: { mat: 'stone', weight: 4, integrity: 0, breaksInto: 'rubble', cover: false },
  well: { mat: 'stone', weight: 4, integrity: 0, breaksInto: 'rubble', cover: false },
  lamp: { mat: 'stone', weight: 4, integrity: 0, breaksInto: 'rubble', cover: false },
  crystal: { mat: 'stone', weight: 4, integrity: 0, breaksInto: 'rubble', cover: false },
  vent: { mat: 'stone', weight: 4, integrity: 0, breaksInto: 'rubble', cover: false },
};

/** a prop burns only if its material burns and it can be lost (landmarks and homes only scorch) */
export const flammable = (pm: PropMaterial | undefined) => !!pm && MATERIALS[pm.mat].burn > 0 && pm.integrity > 0;
