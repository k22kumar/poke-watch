// Biome bindings (docs/WORLDGEN3D.md Q18.1): one record per biome art key, the visual half of Q16.3 (role → style
// material), plus the sky and the light rig's keyframes (Q18.7). Render data, never hashed.
//
// Transcribed, not designed (I2a): every colour is today's, read off the four tables the bindings replace (Q18.1):
// role bases from ART_DIRECTION ground palettes, BIOME_ART ground and cliff palettes and the tileart prop ramps; liquids
// from BIOME_ART water (and its `waterGlow`); sky and fog from render/sky.ts SKY; the world and actor light from
// ART_DIRECTION / BIOME_ART tint; the vignette from ART_DIRECTION. The old tables go at X1b (Q18.10). Roles the tile
// adapter never writes (bed, wall, roof, trim, objective, hazard: ROADMAP F54) take the nearest written role's colour.
// How the light rig turns these into keyframes is src/rules/styles/timeofday.ts.
import type { MaterialRole } from '../materialroles';

/** an sRGB colour as '#rrggbb' (data); the renderer converts to linear */
export type Hex = string;

/** Render-side roles: not MaterialRoles (the model's union, Q16; the tile adapter never writes them) but faces the
 *  renderer picks out itself (src/render/world3d/mesh.ts). `endgrain`: the cut-wood top of a stump or log (owner,
 *  2026-11-27, docs/looksheet "Endgrain"); its sides stay `trunk`. G1a's 3D stumps and logs carry it as a model role */
export const RENDER_ROLES = ['endgrain'] as const;
export type RenderRole = (typeof RENDER_ROLES)[number];
/** every role the world style shades */
export type StyleRole = MaterialRole | RenderRole;
/** the endgrain colour on every binding: pale cut wood (proposed by Claude, 2026-11-27; the owner checks it by eye) */
export const ENDGRAIN: Hex = '#d8c09a';

export interface LiquidLook {
  colour: Hex;
  /** 0..1: self-lit share (lava, glowing water: today's `waterGlow`) */
  emissive: number;
}

export interface BiomeBinding {
  id: string;
  /** role → base colour (a lit, open-sky top shows this colour at the map's fixed time) */
  roles: Record<MaterialRole, Hex>;
  /** render-side role → base colour */
  renderRoles: Record<RenderRole, Hex>;
  /** liquids-registry id → look; an id with no entry draws as `water` */
  liquids: Record<string, LiquidLook>;
  /** today's third-person sky gradient and fog (render/sky.ts) */
  sky: { hor: Hex; zen: Hex; fogNear: number; fogFar: number; fog: number };
  /** the light on the world and on actors (ART_DIRECTION world / actor, BIOME_ART tint) */
  world: [number, number, number];
  actor: [number, number, number];
  vignette: { amount: number; colour: [number, number, number] };
  /** the anchor's light class: how the key light splits from the ambient fill at the map's fixed time */
  light: 'day' | 'night' | 'cave';
}

interface Src {
  ground: Hex; path: Hex; soil: Hex; rock: Hex; cliff: Hex; floor: Hex; cover: Hex; foliage: Hex; trunk: Hex;
  water: Hex; glow: boolean; hor: Hex; zen: Hex; fogNear: number; fogFar: number; fogK: number;
  world: [number, number, number]; actor: [number, number, number]; vignette: number; vignetteCol: [number, number, number];
  light: BiomeBinding['light'];
}

/** lava wherever a map names it: Cinder Crater's lava (BIOME_ART.volcano water) */
const LAVA: LiquidLook = { colour: '#ff6a20', emissive: 1 };

const bind = (id: string, s: Src): BiomeBinding => ({
  id,
  roles: {
    ground: s.ground, path: s.path, soil: s.soil, rock: s.rock, cliff: s.cliff, bed: s.soil,
    floor: s.floor, wall: s.cliff, roof: s.cliff, trim: s.floor,
    cover: s.cover, foliage: s.foliage, trunk: s.trunk,
    objective: s.path, hazard: s.soil,
  },
  renderRoles: { endgrain: ENDGRAIN },
  liquids: { water: { colour: s.water, emissive: s.glow ? 0.6 : 0 }, lava: LAVA },
  sky: { hor: s.hor, zen: s.zen, fogNear: s.fogNear, fogFar: s.fogFar, fog: s.fogK },
  world: s.world, actor: s.actor, vignette: { amount: s.vignette, colour: s.vignetteCol }, light: s.light,
});

// generated once from the old tables (I2a); see the header
export const BIOME_BINDINGS: Record<string, BiomeBinding> = {
  meadow: bind('meadow', { ground: '#96ca6e', path: '#dcc596', soil: '#c8ae80', rock: '#d8d4c8', cliff: '#b8966c', floor: '#e8c890', cover: '#b8b0a0', foliage: '#4ea83e', trunk: '#7a5838', water: '#3c8ce0', glow: false, hor: '#cfe6d2', zen: '#6fb2e8', fogNear: 30, fogFar: 130, fogK: 0.85, world: [0.98, 0.98, 0.96], actor: [1.04, 1.03, 1], vignette: 0.16, vignetteCol: [0.06, 0.12, 0.1], light: 'day' }),
  badlands: bind('badlands', { ground: '#cfa26e', path: '#76625a', soil: '#9a6a48', rock: '#c8b0a0', cliff: '#8a5a44', floor: '#e8c890', cover: '#b87860', foliage: '#d0b060', trunk: '#7a5838', water: '#ff7a28', glow: true, hor: '#f0cfa0', zen: '#d98a62', fogNear: 26, fogFar: 115, fogK: 0.9, world: [1, 0.96, 0.9], actor: [1.04, 1, 0.96], vignette: 0.18, vignetteCol: [0.16, 0.06, 0.04], light: 'day' }),
  frost: bind('frost', { ground: '#dbe5ef', path: '#aebdce', soil: '#a8b8c8', rock: '#d8e0ea', cliff: '#8ea4bc', floor: '#e8c890', cover: '#b8c8d8', foliage: '#b8dce8', trunk: '#7a5838', water: '#5aa0d8', glow: false, hor: '#e4eef8', zen: '#9cb8dc', fogNear: 22, fogFar: 95, fogK: 0.95, world: [0.95, 0.97, 1.02], actor: [1, 1, 1.02], vignette: 0.14, vignetteCol: [0.1, 0.14, 0.24], light: 'day' }),
  dusk: bind('dusk', { ground: '#4a8052', path: '#9a8a6e', soil: '#86785e', rock: '#8e8c9c', cliff: '#6a6478', floor: '#e8c890', cover: '#787090', foliage: '#3a8448', trunk: '#5e4836', water: '#4a5ad8', glow: true, hor: '#4a5a86', zen: '#141a3a', fogNear: 20, fogFar: 85, fogK: 0.95, world: [0.86, 0.9, 1.05], actor: [1.06, 1.02, 1], vignette: 0.24, vignetteCol: [0.03, 0.04, 0.1], light: 'night' }),
  forest: bind('forest', { ground: '#7cb662', path: '#b89a6e', soil: '#a88a62', rock: '#d8d4c8', cliff: '#8a7a62', floor: '#e8c890', cover: '#969e8a', foliage: '#4ea83e', trunk: '#7a5838', water: '#4c94e8', glow: false, hor: '#a8cfa0', zen: '#4f8a6a', fogNear: 18, fogFar: 80, fogK: 0.95, world: [0.9, 0.96, 0.9], actor: [1.04, 1.03, 1], vignette: 0.24, vignetteCol: [0.03, 0.08, 0.05], light: 'day' }),
  moon: bind('moon', { ground: '#5c5a52', path: '#a48c6c', soil: '#8a7660', rock: '#6e6866', cliff: '#625a54', floor: '#e8c890', cover: '#82786e', foliage: '#d0b060', trunk: '#7a5838', water: '#3a4a7a', glow: false, hor: '#3a3440', zen: '#0c0a12', fogNear: 16, fogFar: 70, fogK: 1, world: [0.82, 0.8, 0.86], actor: [1.08, 1.04, 1], vignette: 0.25, vignetteCol: [0.02, 0.02, 0.04], light: 'cave' }),
  chargestone: bind('chargestone', { ground: '#3a4658', path: '#5a6a84', soil: '#56607a', rock: '#4a5a70', cliff: '#38445a', floor: '#e8c890', cover: '#58688a', foliage: '#b8dce8', trunk: '#7a5838', water: '#2a6ab0', glow: true, hor: '#1c3450', zen: '#060c18', fogNear: 16, fogFar: 72, fogK: 1, world: [0.84, 0.9, 1.04], actor: [1.06, 1.04, 1.02], vignette: 0.25, vignetteCol: [0.01, 0.03, 0.08], light: 'cave' }),
  volcano: bind('volcano', { ground: '#5a4c48', path: '#8a6e5e', soil: '#6a5650', rock: '#54484a', cliff: '#4a3e3e', floor: '#e8c890', cover: '#5a4c4a', foliage: '#d0b060', trunk: '#7a5838', water: '#ff6a20', glow: true, hor: '#7a4a3a', zen: '#2a1a1e', fogNear: 24, fogFar: 100, fogK: 0.95, world: [0.92, 0.86, 0.84], actor: [1.06, 1.02, 0.98], vignette: 0.24, vignetteCol: [0.08, 0.03, 0.02], light: 'day' }),
  tropic: bind('tropic', { ground: '#58b04c', path: '#cfae72', soil: '#b08a5a', rock: '#d8d4c8', cliff: '#93805f', floor: '#e8c890', cover: '#b8b0a0', foliage: '#4ea83e', trunk: '#7a5838', water: '#27b6c4', glow: false, hor: '#d6efe0', zen: '#5fb4e6', fogNear: 28, fogFar: 125, fogK: 0.85, world: [1.02, 1.03, 0.98], actor: [1, 1, 1], vignette: 0, vignetteCol: [0, 0, 0], light: 'day' }),
};

export const bindingFor = (artKey: string): BiomeBinding => BIOME_BINDINGS[artKey] ?? BIOME_BINDINGS.meadow;

/** '#rrggbb' → 0..1 sRGB */
export const hexRgb = (h: Hex): [number, number, number] => [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255];
