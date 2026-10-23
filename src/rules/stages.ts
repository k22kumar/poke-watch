// Biomes and stage tables. PokéBonk keeps biomes as data entries (size, ground set,
// cliff colours, prop densities); this file is the Poke-Watch equivalent.

import { STAGE_TABLES } from '../content/pokedex';

export interface BiomeDef {
  id: string;
  name: string;
  ground: [string, string]; // two ground colours blended by noise
  path: string;
  cliff: string;
  water?: string; // pond / lava colour
  waterGlow?: boolean;
  skyTop: string;
  skyBottom: string;
  fog: string;
  sun: string;
  ambient: string;
  props: Record<string, number>; // prop type -> count over the map
  particles?: 'petals' | 'embers' | 'snow' | 'motes';
  ecology: { moisture: number; canopy: number; tallGrass: number; reeds: number };
  music: { root: number; scale: number[]; tempo: number };
}

export interface StageDef {
  biome: string;
  spawns: [string, number][]; // species, weight
  elites: string[];
  boss: string;
}

export const BIOMES: Record<string, BiomeDef> = {
  meadow: {
    id: 'meadow', name: 'Sunpetal Meadow',
    ground: ['#5cbf8c', '#6fcc98'], path: '#e6cc90', cliff: '#b89870', water: '#3c8ce0',
    skyTop: '#6cb8ff', skyBottom: '#dff4ff', fog: '#d6f0ff', sun: '#fff6e0', ambient: '#9cc4dc',
    props: { tree: 260, bush: 320, rock: 120, flower: 1400, grass: 2600, pond: 7 },
    ecology: { moisture: 0, canopy: 0.5, tallGrass: 1, reeds: 1 },
    particles: 'petals', music: { root: 60, scale: [0, 2, 4, 7, 9], tempo: 118 },
  },
  badlands: {
    id: 'badlands', name: 'Cinder Badlands',
    ground: ['#b8693e', '#cf8a52'], path: '#5a4038', cliff: '#7a3f2c', water: '#ff6a1a', waterGlow: true,
    skyTop: '#d9663a', skyBottom: '#ffc58a', fog: '#f0a070', sun: '#ffd0a0', ambient: '#b07060',
    props: { deadtree: 160, rock: 380, crystal: 120, grass: 900, pond: 9, vent: 40 },
    ecology: { moisture: -0.24, canopy: 0.16, tallGrass: 0.45, reeds: 0.35 },
    particles: 'embers', music: { root: 57, scale: [0, 3, 5, 7, 10], tempo: 128 },
  },
  frost: {
    id: 'frost', name: 'Rimefrost Heights',
    ground: ['#e8f2fb', '#c6dcef'], path: '#9fb3c8', cliff: '#7e93ad', water: '#8fd8ff',
    skyTop: '#7fa9d6', skyBottom: '#eef6ff', fog: '#e4eef8', sun: '#ffffff', ambient: '#a8c0de',
    props: { pine: 300, rock: 160, crystal: 160, grass: 700, pond: 6, snowman: 0 },
    ecology: { moisture: -0.08, canopy: 0.34, tallGrass: 0.55, reeds: 0.55 },
    particles: 'snow', music: { root: 62, scale: [0, 2, 3, 7, 9], tempo: 108 },
  },
  dusk: {
    id: 'dusk', name: 'Duskwood Hollow',
    ground: ['#3d4a3a', '#4b3f5c'], path: '#6b5a4a', cliff: '#3a3048', water: '#7a5cff', waterGlow: true,
    skyTop: '#1d1640', skyBottom: '#6a4a8a', fog: '#3a2e55', sun: '#c9b6ff', ambient: '#6a5a9a',
    props: { darktree: 300, mushroom: 260, rock: 120, crystal: 90, grass: 1600, pond: 6 },
    ecology: { moisture: 0.2, canopy: 0.72, tallGrass: 0.72, reeds: 1.8 },
    particles: 'motes', music: { root: 55, scale: [0, 1, 5, 7, 8], tempo: 112 },
  },
};

// Wild Pokémon, elites and the boss for each region come from content/roster.json.
export const STAGES: StageDef[] = STAGE_TABLES;
