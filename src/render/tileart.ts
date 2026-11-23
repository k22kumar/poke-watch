// Arena art: per-biome palettes for ground, cliffs and water, and every prop sprite an
// arena can place, painted in code at 16 texels per tile. Sunpetal Meadow reuses the
// Maplebrook overworld painters (handheld route look); the other
// regions recolour the same shapes so all four read as one production.
import * as S from '../overworld/sprites';
import { Sprite, h2, hex, type Ramp, type RGB } from '../overworld/paint';
import type { CliffPalette, GroundPalette, WaterPalette } from '../overworld/terrain';
import * as A from './pixelart';

interface BiomeArt {
  ground: Partial<GroundPalette>;
  cliff: Partial<CliffPalette>;
  bank: Partial<CliffPalette>;
  water: Partial<WaterPalette>;
  waterGlow: boolean;
  clear: RGB; // colour behind everything (never visible in play; the skirt covers it)
  tint: [number, number, number]; // global light tint on sprites/meshes
}

const g = (o: Record<string, string | string[]>) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, Array.isArray(v) ? v.map(hex) : hex(v)]));

export const BIOME_ART: Record<string, BiomeArt> = {
  meadow: { ground: {}, cliff: {}, bank: {}, water: {}, waterGlow: false, clear: hex('#8cd060'), tint: [1, 1, 1] },
  badlands: {
    ground: g({ grass: '#d9a86c', grassD: '#c48e58', grassL: '#ecc490', grassEdge: '#a8703e', path: '#7a6458', pathD: '#685448', pathL: '#8c7868', pathEdge: '#5a463c', pathEdge2: '#46362e', stone: '#c8b0a0', stoneD: '#a8907e', stoneL: '#e0cab8', mortar: '#7a6052', sand: '#e8c890', sandD: '#d4ac70', tallBase: '#c89850', tallD: '#a87838', dirt: '#9a6a48', dirtD: '#7a5038', flowerbed: '#b07840', lipA: '#c08a50', lipB: '#9a6838', dots: ['#ffe0a0', '#ffc070'], dotCore: '#e06020' }),
    cliff: g({ base: '#8a5a44', dark: '#6a4232', deep: '#4a2c22', light: '#b07a5c', lipA: '#c08a50', lipB: '#9a6838' }),
    bank: g({ base: '#5a4038', dark: '#463028', deep: '#30201a', light: '#7a5a4a' }),
    water: g({ base: '#ff7a28', light: '#ffb050', foam: '#fff0a0', dark: '#e04818' }), waterGlow: true, clear: hex('#d9a86c'), tint: [1.04, 0.98, 0.92],
  },
  frost: {
    ground: g({ grass: '#e8f2fb', grassD: '#c8dcef', grassL: '#ffffff', grassEdge: '#a8c0d8', path: '#b8c8d8', pathD: '#a0b2c6', pathL: '#d0dcea', pathEdge: '#8098b0', pathEdge2: '#687e98', stone: '#d8e0ea', stoneD: '#b4c0d0', stoneL: '#f0f4f8', mortar: '#8a98a8', sand: '#dce6f0', sandD: '#c4d2e2', tallBase: '#a8c8b8', tallD: '#7aa898', dirt: '#a8b8c8', dirtD: '#90a2b6', flowerbed: '#c8dce8', lipA: '#d0e4f0', lipB: '#a8c4d8', dots: ['#ffffff', '#c8e8ff'], dotCore: '#80b8e8' }),
    cliff: g({ base: '#8ea4bc', dark: '#6e84a0', deep: '#506480', light: '#c0d0e0', lipA: '#e8f2fb', lipB: '#c8dcef' }),
    bank: g({ base: '#b8c8d8', dark: '#98aac0', deep: '#7890a8', light: '#dce6f0' }),
    water: g({ base: '#5aa0d8', light: '#8cc8f0', foam: '#e8f8ff', dark: '#3a80c0' }), waterGlow: false, clear: hex('#e8f2fb'), tint: [0.96, 0.99, 1.04],
  },
  dusk: {
    ground: g({ grass: '#4e8a54', grassD: '#3c7046', grassL: '#6aa868', grassEdge: '#2e5a3a', path: '#9a8a6e', pathD: '#82745c', pathL: '#ae9e80', pathEdge: '#6a5c48', pathEdge2: '#54483a', stone: '#8e8c9c', stoneD: '#72708a', stoneL: '#aaa8b8', mortar: '#52506a', sand: '#a89c80', sandD: '#8e8268', tallBase: '#2e6a40', tallD: '#205234', dirt: '#86785e', dirtD: '#6e624c', flowerbed: '#3e7048', lipA: '#3e7a4a', lipB: '#2a5a38', dots: ['#c8ffa0', '#a0e8ff', '#e0c0ff'], dotCore: '#ffffff' }),
    cliff: g({ base: '#6a6478', dark: '#524c62', deep: '#3a3448', light: '#8a849a', lipA: '#3e7a4a', lipB: '#2a5a38' }),
    bank: g({ base: '#6a5e4c', dark: '#564c3e', deep: '#40382c', light: '#8a7c68' }),
    water: g({ base: '#4a5ad8', light: '#8a9cff', foam: '#e0e8ff', dark: '#3a42b0' }), waterGlow: true, clear: hex('#4e8a54'), tint: [0.8, 0.84, 1.04],
  },
};

// location palettes (src/world/locations): Viridian Forest, Mt. Moon, Chargestone Cave
BIOME_ART.forest = { ground: {}, cliff: g({ base: '#8a7a62', dark: '#6a5c48', deep: '#4a4032', light: '#a8987a', lipA: '#4c8c40', lipB: '#346e36' }), bank: {}, water: {}, waterGlow: false, clear: hex('#5c8c48'), tint: [0.96, 1, 0.95] };
BIOME_ART.moon = {
  ground: g({ dirt: '#8a7660', dirtD: '#72604e', sand: '#a48c6c', sandD: '#8c7658', stone: '#6e6866', stoneD: '#5a5452', stoneL: '#86807c', mortar: '#3e3a3a' }),
  cliff: g({ base: '#625a54', dark: '#4a4440', deep: '#302c2a', light: '#7e746c', lipA: '#6e6866', lipB: '#5a5452' }),
  bank: g({ base: '#4a4440', dark: '#3a3432', deep: '#262220', light: '#625a54' }),
  water: g({ base: '#3a4a7a', light: '#5a6aa0', foam: '#c8d0f0', dark: '#2a3460' }), waterGlow: false, clear: hex('#2a2628'), tint: [0.9, 0.88, 0.94],
};
BIOME_ART.chargestone = {
  ground: g({ stone: '#4a5a70', stoneD: '#3a485c', stoneL: '#5e7088', mortar: '#26303e', dirt: '#56607a', dirtD: '#464e66', sand: '#5a6a84', sandD: '#4a586e' }),
  cliff: g({ base: '#38445a', dark: '#2a3446', deep: '#1a2230', light: '#4e5e78', lipA: '#5ad0f0', lipB: '#3890c0' }),
  bank: g({ base: '#2a3446', dark: '#1e2636', deep: '#121822', light: '#38445a' }),
  water: g({ base: '#2a6ab0', light: '#5ac0f0', foam: '#e0f8ff', dark: '#1a4a90' }), waterGlow: true, clear: hex('#141c2a'), tint: [0.9, 0.96, 1.08],
};
// habitat palette (src/world/habitat): Cinder Crater — dark cooled basalt, ash floors, glowing lava
BIOME_ART.volcano = {
  ground: g({ dirt: '#6a5650', dirtD: '#584640', sand: '#8a6e5e', sandD: '#765c4e', stone: '#54484a', stoneD: '#443a3c', stoneL: '#6a5c5c', mortar: '#2a2224', grass: '#5a4c48', grassD: '#4a3e3a', grassL: '#6c5c56', grassEdge: '#3a302c' }),
  cliff: g({ base: '#4a3e3e', dark: '#382e2e', deep: '#221a1a', light: '#62524e', lipA: '#5a4c48', lipB: '#4a3e3a' }),
  bank: g({ base: '#3a2e2c', dark: '#2c2220', deep: '#1a1212', light: '#4a3e3a' }),
  water: g({ base: '#ff6a20', light: '#ffb048', foam: '#fff0a0', dark: '#d8400e' }), waterGlow: true, clear: hex('#2a2020'), tint: [1.06, 0.97, 0.92],
};
// habitat palette (src/world/habitat): Cascade Lagoon — bright sand beaches, lush green, warm limestone bluffs, turquoise water
BIOME_ART.tropic = {
  ground: g({ grass: '#58b04c', grassD: '#3f9640', grassL: '#7ccf62', grassEdge: '#2d7a38', tallBase: '#3a9a46', tallD: '#287a38', sand: '#f1deaa', sandD: '#dcc786', path: '#cfae72', pathD: '#b8965c', pathL: '#e2c590', pathEdge: '#94783f', pathEdge2: '#7a6030', dirt: '#b08a5a', dirtD: '#94703f', flowerbed: '#4a9a48', lipA: '#5cb84c', lipB: '#3e8e3a', dots: ['#fff3b0', '#c8ffe0'], dotCore: '#ffffff' }),
  cliff: g({ base: '#93805f', dark: '#715f45', deep: '#4c3f2d', light: '#b9a47e', lipA: '#5cb84c', lipB: '#3e8e3a' }),
  bank: g({ base: '#dbc78f', dark: '#bda772', deep: '#8f7d52', light: '#efe0ad' }),
  water: g({ base: '#27b6c4', light: '#78e6dc', foam: '#f2fffa', dark: '#168798' }), waterGlow: false, clear: hex('#58b04c'), tint: [1.02, 1.03, 0.98],
};
/**
 * How a location's terrain is built beyond its palette (render only). Caves paint the tops of their rock masses as
 * natural rock (never grass) and use one fractured rock face for every vertical, so a wall never reads as a lawn or a
 * brick course; Chargestone embeds crystals in that rock, runs charged veins through the floor and lets every crystal
 * cast a pool of light; the Moon Stone glows on Mt. Moon's top floor; Viridian's bluffs are mossy rock.
 */
interface TerrainStyle {
  /** paint wall tiles without a prop as natural rock tops */
  rockTops?: { base: string; dark: string; light: string; deep: string; glint?: string; glint2?: string };
  /** every cliff face (and, in caves, every ledge face) is this rock face */
  face: { moss?: [string, string]; glint?: [string, string, string] };
  /** ledge faces use the rock face too (no grassy lip) */
  rockLedges: boolean;
  veins?: { col: string; scale: number };
  /** light pools: prop kind -> radius (tiles) */
  glow?: { col: string; props: Partial<Record<string, number>> };
}
export const TERRAIN_STYLE: Record<string, TerrainStyle> = {
  volcano: {
    rockTops: { base: '#4a3e3e', dark: '#3a3030', light: '#5e504c', deep: '#221a1a', glint: '#ff8a3a', glint2: '#ffd080' },
    face: {}, rockLedges: true,
    veins: { col: '#e8602a', scale: 7 },
    glow: { col: '#ff9a50', props: { vent: 2.2 } },
  },
  forest: { face: { moss: ['#4c8c40', '#346e36'] }, rockLedges: false },
  moon: {
    rockTops: { base: '#5e5650', dark: '#4c4540', light: '#746a62', deep: '#2e2a28' },
    face: {}, rockLedges: true,
    glow: { col: '#d8d0ff', props: { moonstone: 6 } },
  },
  chargestone: {
    rockTops: { base: '#323c52', dark: '#262e40', light: '#44506a', deep: '#161c28', glint: '#8ae8ff', glint2: '#e8fcff' },
    face: { glint: ['#ffffff', '#8ae8ff', '#3aa8e0'] }, rockLedges: true,
    veins: { col: '#5ac8f0', scale: 5 },
    glow: { col: '#7ad8ff', props: { magnetite: 6.5, crystal: 2.6 } },
  },
};

/** location art keys draw their props with a base palette's shapes */
const BASE_PAL: Record<string, A.BiomePal> = { forest: 'meadow', moon: 'badlands', chargestone: 'frost', volcano: 'badlands' };

const ROCK: Record<string, Ramp> = { meadow: ['#e0d8c8', '#b8b0a0', '#908878', '#6a6458'], badlands: ['#e0a888', '#b87860', '#905040', '#683830'], frost: ['#e8f0f8', '#b8c8d8', '#8898b0', '#687890'], dusk: ['#a8a0b8', '#787090', '#585070', '#403850'] };
const GRASS: Record<string, Ramp> = { meadow: ['#8cd458', '#4ea83e', '#2f8a34', '#1f6a2c'], badlands: ['#f0d890', '#d0b060', '#a88840', '#806830'], frost: ['#e8f8ff', '#b8dce8', '#88b8c8', '#6898a8'], dusk: ['#6ab060', '#3e8a48', '#2a6a3c', '#1c4c2e'] };
const ROCK_LOC: Record<string, Ramp> = { volcano: ['#7a6a66', '#5a4c4a', '#423634', '#2c2222'], moon: ['#a89e94', '#82786e', '#5e564e', '#403a34'], chargestone: ['#7a8aa8', '#58688a', '#3e4c6a', '#28344a'], forest: ['#c4c8b4', '#969e8a', '#6e7866', '#4c5448'] };
/** moss on top of forest stones (Viridian's boulders sit in shade and damp) */
const MOSS: Record<string, Ramp> = { forest: ['#9ccc6a', '#6aa848', '#4a8a3c'] };
const CRYSTAL: Record<string, Ramp> = { chargestone: ['#ffffff', '#b8f8ff', '#58d8ff', '#2890e0'], moon: ['#fff8ff', '#e8d8ff', '#b8a0e8', '#8068c0'], meadow: ['#ffffff', '#c8f4ff', '#78d8f8', '#40a8d8'], badlands: ['#fff0c0', '#ffc060', '#f08830', '#c05820'], frost: ['#ffffff', '#c8f4ff', '#78d8f8', '#40a8d8'], dusk: ['#f0d8ff', '#c8a0ff', '#9868e8', '#6840c0'] };
const FLOWER: Record<string, string> = { flowerR: '#ff5878', flowerW: '#ffffff', flowerY: '#ffd838', flowerB: '#80a8ff' };
const TRUNK: Ramp = ['#a07850', '#7a5838', '#5a4028'];
/** night forest foliage for Duskwood Hollow (the global tint cools it further) */
const NIGHT: S.TreeRamps = { hl: '#9ad870', light: '#5aa850', base: '#3a8448', shade: '#22604a', deep: '#14404a', outline: '#0e2630', trunk: ['#8a6a4c', '#5e4836', '#3e2e26'] };

/** Sprite set for one biome: key -> image (animated kinds have numbered frames, e.g. tall0..2) */
export function arenaSprites(biome: string): Map<string, ImageData> {
  const pal = (BASE_PAL[biome] ?? (['meadow', 'badlands', 'frost', 'dusk'].includes(biome) ? biome : 'meadow')) as A.BiomePal;
  const rockR = ROCK_LOC[biome] ?? ROCK[pal], crystalR = CRYSTAL[biome] ?? CRYSTAL[pal];
  const cave = biome === 'moon' || biome === 'chargestone';
  const out = new Map<string, ImageData>();
  const put = (k: string, im: ImageData) => out.set(k, im);
  const meadow = pal === 'meadow';
  const forest = !cave && (pal === 'meadow' || pal === 'dusk');
  const R = pal === 'dusk' ? NIGHT : S.JOHTO, R2 = pal === 'dusk' ? NIGHT : S.JOHTO_DARK;
  put('tree', forest ? S.paintJohtoTree(0, R) : A.tieredTree(pal, 1, 0, pal === 'frost'));
  put('tree2', forest ? S.paintJohtoTree(1, R2) : A.tieredTree(pal, 1, 1, pal === 'frost'));
  put('tree3', forest ? S.paintJohtoTree(2, R) : A.tieredTree(pal, 1, 2, pal === 'frost'));
  put('round', forest ? S.paintJohtoTree(2, pal === 'dusk' ? NIGHT : { ...S.JOHTO, hl: '#e0f088', light: '#b8d860', base: '#8cbc48' }) : A.roundTree(pal, 1));
  put('blossom', S.paintRoundTree(2));
  put('elder', elderTree(pal));
  put('deadtree', A.deadTree(1));
  put('icepine', A.tieredTree('frost', 1, 0, true));
  put('bush', forest ? S.paintBush(0, R) : A.bush(pal, 0.95));
  put('bushR', forest ? S.paintBush(1, R) : A.bush(pal, 0.95, '#ff5070'));
  put('bushB', forest ? S.paintBush(2, R) : A.bush(pal, 0.95, '#80a0ff'));
  put('rock', meadow && !MOSS[biome] ? S.paintRock() : mossy(A.rock(0.95, rockR), MOSS[biome]));
  put('boulder', boulder(rockR, MOSS[biome]));
  put('stump', stump());
  put('log', S.paintLog());
  put('berry', S.paintBerryTree());
  put('sign', S.paintSign());
  put('lantern', S.paintStoneLantern());
  put('pillar', pillar(ROCK[pal], false));
  put('pillarBroken', pillar(ROCK[pal], true));
  put('statue', statue(ROCK[pal]));
  put('shrine', shrine(ROCK[pal]));
  put('crystal', A.crystal(crystalR, 0.75));
  put('vent', A.vent(0.6));
  put('mushroom', A.mushroom(0.8));
  const STEM: Record<string, [Ramp, string]> = { meadow: [['#7cc850', '#4ea83e', '#2f8a34'], '#245a2c'], dusk: [['#6ab060', '#3e8a48', '#2a6a3c'], '#14303a'], badlands: [['#d8b070', '#a8803c', '#7a5a2c'], '#4a3018'], frost: [['#b8d8e0', '#80a8b8', '#5a7e90'], '#3a5468'] };
  for (const [k, c] of Object.entries(FLOWER)) for (let f = 0; f < 2; f++) put(k + f, S.paintFlowers(pal === 'dusk' && k === 'flowerW' ? '#c8ffa0' : c, f, STEM[pal][0], STEM[pal][1]));
  for (let f = 0; f < 3; f++) put('tall' + f, meadow ? S.paintTallGrass(f) : A.grassTuft(GRASS[pal], 1, f === 0 ? 0 : 1));
  for (let f = 0; f < 2; f++) put('reeds' + f, reeds(f, pal));
  put('lily', lily());
  // hamlet kit (procedural regions)
  put('cabin', cabin(pal));
  put('hedge', S.paintHedge());
  put('fence', S.paintFence());
  put('well', S.paintWell());
  put('lamp', S.paintLamp());
  put('bench', S.paintBench());
  // location kit (src/world/locgen)
  put('thicket', forest ? S.paintBush(1, R2) : A.bush(pal, 1.2));
  put('stalagmite', stalagmite(rockR));
  put('moonstone', moonstone());
  put('magnetite', A.crystal(crystalR, 1.6));
  put('fossil', fossil());
  put('crate', crate());
  put('gatehouse', gatehouse());
  put('tent', tent());
  put('ladder', ladder());
  // grave markers: kerb / headstone / stele, 1 or 2 tiles wide, three leans (render/tilestage.ts picks by the prop's top, w, lean)
  for (const cls of ['kerb', 'stone', 'stele'] as const) for (const w of [1, 2]) for (const lean of [-1, 0, 1]) put(`grave_${cls}_${w}_${lean + 1}`, graveStone(ROCK[pal], cls, w, lean));
  return out;
}

/** a cave spire, 1 tile */
function stalagmite(r: Ramp): ImageData {
  const s = new Sprite(16, 34);
  s.outline = '#201c1a';
  const st = s.ramp(r);
  for (let y = 0; y < 30; y++) { const w = 2 + (y / 30) * 11; s.rect(8 - w / 2, 3 + y, w, 1, st); }
  s.ellipse(8, 32, 7, 2, s.ramp([r[1], r[2], r[3] ?? r[2]]));
  for (let y = 8; y < 30; y += 5) s.dot(7 - (y / 30) * 3, y, r[0]);
  return s.render();
}

/** the Moon Stone of Mt. Moon Square: a pale meteorite, 2 × 2 tiles (an interpretation of the canonical stone) */
function moonstone(): ImageData {
  const s = new Sprite(36, 40);
  s.outline = '#2a2440';
  s.ellipse(18, 24, 16, 14, s.ramp(['#f4f0ff', '#d4ccec', '#aaa0cc', '#7c72a4']));
  s.ellipse(13, 16, 8, 7, s.ramp(['#ffffff', '#ece6ff', '#cec4ec']));
  for (const [x, y, r] of [[22, 22, 3], [12, 28, 2.5], [25, 31, 2]] as [number, number, number][]) s.ellipse(x, y, r, r * 0.8, s.ramp(['#9a90c0', '#7c72a4', '#625a8a']));
  for (const [x, y] of [[9, 12], [27, 14], [17, 9]]) s.dot(x, y, '#fff6c0');
  s.ellipse(18, 37, 15, 2.5, s.ramp(['#5a5452', '#46403e', '#36302e']));
  return s.render();
}

/** a pile of fossil bones and shell fragments at the dig */
function fossil(): ImageData {
  const s = new Sprite(16, 12);
  s.outline = '#3a2e22';
  s.ellipse(8, 8, 7, 3.5, s.ramp(['#b8a080', '#98805e', '#78603e']));
  s.ellipse(6, 6, 3.5, 3, s.ramp(['#f0e4c8', '#d8c8a0', '#b8a47a']));
  for (let a = 0; a < 3; a++) s.dline(5 + a * 0.5, 4 + a, 8 + a, 5 + a, '#a08a64');
  s.rect(10, 5, 4, 2, s.ramp(['#f0e4c8', '#d8c8a0', '#b8a47a']));
  return s.render();
}

/** a wooden supply crate (dig sites, trainer camps) */
function crate(): ImageData {
  const s = new Sprite(16, 16);
  s.outline = '#3a2614';
  s.rect(1, 3, 14, 12, s.ramp(['#c89a60', '#a87a44', '#86602e']));
  s.rect(1, 3, 14, 2, s.ramp(['#e0b878', '#c89a60', '#a87a44']));
  s.dline(2, 5, 13, 14, '#7a5426'); s.dline(13, 5, 2, 14, '#7a5426');
  s.rect(1, 9, 14, 1, s.ramp(['#86602e', '#6e4c22', '#563a18']));
  return s.render();
}

/**
 * A small house, 4 × 3 tiles, in the handheld-adventure town style (original design): pale plaster walls on a stone
 * footing, timber corner posts, a tiled gable roof in the region's colour with a light ridge, white-framed windows,
 * a dark door under a little awning facing the street (south). Replaces an earlier log cabin that read as generic
 * fantasy rather than a Pokémon-world town.
 */
function cabin(pal: A.BiomePal): ImageData {
  const s = new Sprite(64, 62);
  s.outline = '#2a2420';
  const roofR: Ramp = pal === 'frost' ? ['#a8c4e0', '#7898c0', '#56769c', '#3c5476'] : pal === 'badlands' ? ['#e09a6a', '#c07448', '#985430', '#6a3a20'] : pal === 'dusk' ? ['#8a7cc0', '#6a5ca0', '#4c4080', '#342a5c'] : ['#f08a6a', '#d0604a', '#a84434', '#782e24'];
  // walls: plaster over a stone footing, timber posts at the corners
  s.rect(6, 30, 52, 28, s.ramp(['#fbf4e0', '#efe4c6', '#d8caa6', '#b8a882']));
  s.rect(6, 55, 52, 5, s.ramp(['#c8c4bc', '#a8a49c', '#88847c']));
  for (const x of [6, 55]) s.rect(x, 30, 3, 26, s.ramp(['#b88a5a', '#946a40', '#704e2c']));
  s.rect(6, 30, 52, 2, s.ramp(['#b88a5a', '#946a40', '#704e2c']));
  // chimney
  s.rect(44, 4, 7, 14, s.ramp(['#d8d0c4', '#b4ac9e', '#8e867a']));
  s.rect(43, 3, 9, 3, s.ramp(['#e8e0d4', '#c4bcae', '#9e968a']));
  // tiled gable roof: rows of tiles with dark joints, a pale ridge cap, overhanging eaves
  const roof = s.ramp(roofR);
  for (let y = 0; y < 22; y++) { const w = 20 + y * 2.2; s.rect(32 - w / 2, 9 + y, w, 1, roof); }
  for (let y = 12; y < 31; y += 4) { const w = 20 + (y - 9) * 2.2; s.rect(32 - w / 2 + 1, y, w - 2, 1, s.ramp([roofR[2], roofR[3]!, roofR[3]!])); for (let x = Math.ceil(32 - w / 2) + ((y >> 2) & 1) * 3; x < 32 + w / 2 - 1; x += 6) s.px(x, y + 1, s.ramp([roofR[2], roofR[3]!, roofR[3]!])); }
  s.rect(22, 8, 20, 2, s.ramp(['#fff0e0', '#f0dcc8', '#d8c0a8']));
  s.rect(1, 30, 62, 2, s.ramp([roofR[2], roofR[3]!, roofR[3]!]));
  // door with a small awning and step
  s.rect(25, 41, 12, 16, s.ramp(['#8a5a3a', '#6e4428', '#54321c']));
  s.rect(30, 41, 1, 16, s.ramp(['#54321c', '#40240e', '#30180a']));
  s.dot(28, 49, '#f0d070'); s.dot(33, 49, '#f0d070');
  s.rect(23, 38, 16, 3, roof);
  s.rect(23, 57, 16, 2, s.ramp(['#d8d0c4', '#b4ac9e', '#8e867a']));
  // windows: white frames, sky-blue glass with a highlight, flower boxes under them
  for (const wx of [11, 42]) {
    s.rect(wx, 38, 11, 10, s.ramp(['#ffffff', '#f4f4f0', '#d8d8d0']));
    s.rect(wx + 1, 39, 9, 8, s.ramp(['#cceefc', '#98d0ec', '#68a8d0']));
    s.rect(wx + 5, 39, 1, 8, s.ramp(['#ffffff', '#f4f4f0', '#d8d8d0'])); s.rect(wx + 1, 43, 9, 1, s.ramp(['#ffffff', '#f4f4f0', '#d8d8d0']));
    s.dot(wx + 2, 40, '#ffffff'); s.dot(wx + 3, 40, '#ffffff');
    s.rect(wx, 48, 11, 2, s.ramp(['#a87a4c', '#86603a', '#664628']));
    for (let k = 0; k < 4; k++) s.dot(wx + 1 + k * 3, 47, k & 1 ? '#ffd040' : '#ff7088');
  }
  return s.render();
}

/**
 * A Route gatehouse, 4 × 3 tiles (original design in the Kanto/Johto gate style): a long, low checkpoint building with
 * cream walls, a shallow slate roof with a pale cornice, a wide pair of glass sliding doors in the middle under a
 * route plate, and square windows either side. The forest trail runs through its doors.
 */
function gatehouse(): ImageData {
  const s = new Sprite(64, 58);
  s.outline = '#262a30';
  // body
  s.rect(3, 22, 58, 33, s.ramp(['#fbf6e6', '#efe6cc', '#d6caa8', '#b4a682']));
  s.rect(3, 51, 58, 5, s.ramp(['#b8b8b0', '#98988e', '#787870']));
  // horizontal trim band under the windows
  s.rect(3, 44, 58, 1, s.ramp(['#c8bc98', '#b0a480', '#988c68']));
  // shallow slate roof: a low slope with tile lines and a light cornice
  const roof = s.ramp(['#8cb0c8', '#6a8ea8', '#4c6e88', '#34506a']);
  for (let y = 0; y < 14; y++) { const inset = Math.max(0, 8 - y); s.rect(1 + inset, 8 + y, 62 - inset * 2, 1, roof); }
  for (let y = 11; y < 22; y += 3) s.rect(3, y, 58, 1, s.ramp(['#4c6e88', '#34506a', '#283e54']));
  s.rect(0, 21, 64, 2, s.ramp(['#ffffff', '#e8eef2', '#c4ccd4']));
  // route plate above the doors
  s.rect(24, 24, 16, 5, s.ramp(['#4a5a6a', '#38485a', '#28384a']));
  for (let x = 26; x < 38; x += 2) s.dot(x, 26, '#f0f4f8');
  // sliding glass doors
  s.rect(22, 31, 20, 22, s.ramp(['#7a8088', '#5e646c', '#484c54']));
  s.rect(23, 32, 18, 21, s.ramp(['#c8ecfc', '#90cce8', '#5aa0c8']));
  s.rect(31, 32, 2, 21, s.ramp(['#7a8088', '#5e646c', '#484c54']));
  for (const x of [25, 35]) { s.dot(x, 34, '#ffffff'); s.dot(x + 1, 35, '#ffffff'); }
  s.rect(21, 53, 22, 3, s.ramp(['#8a5050', '#6e3a3a', '#542a2a']));
  // windows either side
  for (const wx of [7, 47]) {
    s.rect(wx, 31, 10, 10, s.ramp(['#6a7078', '#50565e', '#3c4048']));
    s.rect(wx + 1, 32, 8, 8, s.ramp(['#c8ecfc', '#90cce8', '#5aa0c8']));
    s.rect(wx + 1, 35, 8, 1, s.ramp(['#6a7078', '#50565e', '#3c4048']));
    s.dot(wx + 2, 33, '#ffffff');
  }
  return s.render();
}

/** a Bug Catcher's tent, 2 × 2 tiles: a small canvas A-frame with a rolled flap and a bug net leaning on it */
function tent(): ImageData {
  const s = new Sprite(36, 32);
  s.outline = '#3a2c18';
  const can = s.ramp(['#fbe6a0', '#ecc870', '#c89c48', '#987030']);
  for (let y = 0; y < 22; y++) { const w = 4 + y * 1.4; s.rect(17 - w / 2, 7 + y, w, 1, can); }
  // stripe and the open door
  for (let y = 9; y < 29; y++) s.px(17 - (y - 7) * 0.7, y, s.ramp(['#7ab070', '#5a9058', '#3e7044']));
  for (let y = 15; y < 29; y++) { const w = (y - 15) * 0.9; s.rect(17 - w / 2, y, w + 1, 1, s.ramp(['#5a4428', '#46341e', '#342614'])); }
  s.rect(3, 28, 29, 2, s.ramp(['#8a7a5a', '#6e6046', '#544834']));
  // bug net: a pole and a white mesh hoop
  s.line(31, 30, 26, 6, s.ramp(['#c89a60', '#a07840', '#7a5a2c']));
  s.ellipse(25, 6, 5, 4.5, s.ramp(['#ffffff', '#eef0f4', '#c8ccd4']));
  for (let k = -3; k <= 3; k += 2) s.dline(25 + k, 3, 25 + k, 9, '#b8bcc8');
  return s.render();
}

/** a wooden ladder against a rock face (canon: Mt. Moon's floors are joined by ladders) */
function ladder(): ImageData {
  const s = new Sprite(14, 44);
  s.outline = '#2a1e12';
  const rail = s.ramp(['#d0a068', '#a87a44', '#80582c']);
  s.rect(2, 0, 2, 44, rail); s.rect(10, 0, 2, 44, rail);
  for (let y = 3; y < 44; y += 5) s.rect(4, y, 6, 1, s.ramp(['#e0b478', '#b88a50', '#8e6634']));
  return s.render();
}

/** Large landmark tree: broad oak, 4 x 3 tile footprint (original design). */
function elderTree(pal: A.BiomePal): ImageData {
  const s = new Sprite(72, 84);
  s.outline = pal === 'dusk' ? '#0e2630' : '#173a2e';
  const tr = s.ramp(pal === 'dusk' ? ['#8a6a4c', '#5e4836', '#3e2e26'] : ['#b08860', '#8a6640', '#6a4c30', '#4c3420']);
  // trunk with flared roots
  s.rect(30, 50, 12, 30, tr);
  s.ellipse(36, 80, 14, 3.5, tr);
  s.line(30, 76, 22, 81, tr); s.line(42, 76, 50, 81, tr);
  s.line(33, 56, 20, 44, tr); s.line(39, 54, 54, 42, tr);
  const L: Ramp = pal === 'dusk' ? ['#9ad870', '#5aa850', '#3a8448', '#22604a'] : pal === 'frost' ? ['#a8d8c0', '#78b098', '#588c78', '#3e6a5a'] : pal === 'badlands' ? ['#d8c070', '#b09848', '#887838', '#6a5a2c'] : ['#c4f080', '#8ed458', '#5cb444', '#2e8a46'];
  const D: Ramp = [L[1], L[2], L[3]!, pal === 'meadow' ? '#1c6248' : L[3]!];
  const puffs: [number, number, number, boolean][] = [[18, 40, 14, true], [54, 40, 14, true], [36, 44, 15, true], [26, 26, 15, false], [46, 26, 15, false], [36, 14, 14, false], [12, 28, 9, false], [60, 28, 9, false]];
  for (const [x, y, r, dark] of puffs) s.ellipse(x, y, r, r * 0.86, s.ramp(dark ? D : L));
  for (let n = 0; n < 120; n++) {
    const x = 4 + h2(n, 1, 9) * 64, y = 2 + h2(n, 2, 9) * 54;
    if (!s.get(Math.round(x), Math.round(y))) continue;
    s.dot(x, y, x < 36 && y < 30 ? L[0] : n % 3 ? L[0] : L[3]!);
  }
  if (pal === 'meadow') for (let n = 0; n < 16; n++) { const x = 8 + h2(n, 5, 3) * 56, y = 8 + h2(n, 6, 3) * 40; if (s.get(Math.round(x), Math.round(y))) { s.dot(x, y, '#ffe0f0'); s.dot(x + 1, y, '#ffb8d8'); } }
  return s.render();
}

function boulder(r: Ramp, moss?: Ramp): ImageData {
  const s = new Sprite(34, 30);
  s.outline = '#3a3830';
  s.ellipse(17, 19, 16, 10, s.ramp(r));
  s.ellipse(12, 13, 9, 7, s.ramp([r[0], r[0], r[1], r[2]]));
  s.ellipse(24, 15, 7, 6, s.ramp([r[0], r[1], r[2]]));
  s.dline(14, 20, 20, 25, r[3] ?? r[2]);
  if (moss) {
    // a moss cap over the crown, ragged at its lower edge
    const mr = s.ramp(moss);
    for (let x = 5; x < 30; x++) {
      let top = -1;
      for (let y = 0; y < 30; y++) if (s.get(x, y)) { top = y; break; }
      if (top < 0) continue;
      const len = 2 + Math.floor(h2(x, 1, 5) * 3) + (x > 9 && x < 26 ? 1 : 0);
      for (let y = top; y < top + len; y++) s.px(x, y, mr);
    }
  } else s.dot(9, 10, '#ffffff');
  return s.render();
}

/** add a moss fringe to the top of an already rendered stone */
function mossy(im: ImageData, moss?: Ramp): ImageData {
  if (!moss) return im;
  const d = im.data, W = im.width, cols = moss.slice(0, 3).map((c) => hex(c!));
  for (let x = 0; x < W; x++) {
    let top = -1;
    for (let y = 0; y < im.height; y++) if (d[(y * W + x) * 4 + 3]) { top = y; break; }
    if (top < 0) continue;
    const len = 1 + Math.floor(h2(x, 2, 5) * 3);
    // skip the outline pixel; paint the cap below it
    for (let y = top + 1; y < Math.min(im.height, top + 1 + len); y++) { const o = (y * W + x) * 4; if (!d[o + 3]) continue; const c = cols[y === top + 1 ? 0 : y < top + len ? 1 : 2]; d[o] = c[0]; d[o + 1] = c[1]; d[o + 2] = c[2]; }
  }
  return im;
}

function stump(): ImageData {
  const s = new Sprite(16, 14);
  s.outline = '#3a2818';
  s.rect(3, 5, 10, 8, s.ramp(['#b08860', '#8a6840', '#6a4c30', '#503820']));
  s.ellipse(8, 5, 5, 2.5, s.ramp(['#f0d8a8', '#d8b888', '#b89868']));
  s.dot(8, 5, '#a07848');
  return s.render();
}

function pillar(r: Ramp, broken: boolean): ImageData {
  const H = broken ? 18 : 32;
  const s = new Sprite(14, H);
  s.outline = '#383838';
  const st = s.ramp(r);
  s.rect(2, H - 4, 10, 3, st);
  s.rect(3, broken ? 6 : 4, 8, H - (broken ? 9 : 7), s.ramp([r[0], r[1], r[2]]));
  if (!broken) s.rect(1, 1, 12, 3, st);
  else { s.px(3, 5, st); s.px(4, 4, st); s.px(9, 5, st); }
  for (let y = broken ? 8 : 7; y < H - 5; y += 3) s.dot(5, y, r[2]);
  return s.render();
}

/** A grave marker (world/habitat/graves.ts): a kerb (a low flat slab), a headstone (arched slab on a plinth) or a stele (a tall
 *  narrow stone with a carved mark), `tiles` wide, settled `lean` px (-1, 0, 1) toward one side at its top. The sprite is as
 *  tall as the marker (16 texels per metre) so what the player sees is the height the collision uses. */
function graveStone(r: Ramp, cls: 'kerb' | 'stone' | 'stele', tiles: number, lean: number): ImageData {
  const top = { kerb: 0.45, stone: 0.9, stele: 1.7 }[cls];
  const W = 16 * tiles, H = Math.round(top * 16) + 4;
  const s = new Sprite(W, H);
  s.outline = '#2c2a34';
  const st = s.ramp(r), lit = s.ramp([r[0], r[1], r[2]]);
  const bw = W - { kerb: 4, stone: 6, stele: 9 }[cls]; // body width
  const x0 = Math.round((W - bw) / 2), bodyTop = 1, bodyH = H - 4;
  s.rect(Math.max(0, x0 - 2), H - 3, Math.min(W, bw + 4), 2, st); // plinth
  for (let y = 0; y < bodyH; y++) {
    const f = 1 - y / Math.max(1, bodyH - 1); // 1 at the top, 0 at the base
    const dx = Math.round(lean * 2 * f);
    // an arched shoulder on headstones and steles: the top two rows narrow in
    const inset = cls !== 'kerb' && y < 2 ? 2 - y : 0;
    s.rect(x0 + dx + inset, bodyTop + y, bw - inset * 2, 1, y < 2 || x0 === 0 ? lit : st);
  }
  // a lit left edge and a shaded right edge read as stone, not a flat slab
  for (let y = 2; y < bodyH; y++) { const dx = Math.round(lean * 2 * (1 - y / Math.max(1, bodyH - 1))); s.dot(x0 + dx, bodyTop + y, '#d6d2da'); s.dot(x0 + dx + bw - 1, bodyTop + y, '#5a566a'); }
  // the carving: a short cross on a headstone, a stack of marks on a stele, nothing on a kerb
  const cx = x0 + Math.round(bw / 2) + Math.round(lean * 2 * 0.6);
  if (cls === 'stone') { s.dline(cx, 4, cx, 8, '#4a4658'); s.dline(cx - 2, 5, cx + 2, 5, '#4a4658'); }
  if (cls === 'stele') for (let y = 5; y < bodyH - 3; y += 4) s.dline(cx - 1, y, cx + 1, y, '#4a4658');
  return s.render();
}

/** an original carved standing stone with a rune */
function statue(r: Ramp): ImageData {
  const s = new Sprite(30, 42);
  s.outline = '#383038';
  s.rect(4, 36, 22, 5, s.ramp(r));
  const st = s.ramp([r[0], r[1], r[2], r[3] ?? r[2]]);
  s.rect(8, 6, 14, 30, st);
  s.ellipse(15, 7, 7, 4, st);
  for (const [x0, y0, x1, y1] of [[15, 12, 15, 28], [11, 16, 19, 16], [12, 24, 18, 20]]) s.dline(x0, y0, x1, y1, '#ffd870');
  return s.render();
}

/** a small original wayside shrine, 3 x 2 tiles */
function shrine(r: Ramp): ImageData {
  const s = new Sprite(48, 44);
  s.outline = '#2e2a28';
  const st = s.ramp(r);
  s.rect(4, 36, 40, 6, st);
  s.rect(8, 18, 32, 18, s.ramp([r[0], r[1], r[2]]));
  s.rect(19, 22, 10, 14, s.ramp(['#4a4048', '#383038', '#282028']));
  const roof = s.ramp(['#d07060', '#a84838', '#803028', '#602018']);
  for (let y = 0; y < 14; y++) { const w = 6 + y * 3; s.rect(24 - w / 2, 4 + y, w, 1, roof); }
  s.rect(2, 16, 44, 3, roof);
  s.dot(24, 28, '#ffe890'); s.dot(23, 29, '#ffd060'); s.dot(25, 29, '#ffd060');
  return s.render();
}

function reeds(frame: number, pal: A.BiomePal): ImageData {
  const s = new Sprite(14, 22);
  s.outline = '#1a4a26';
  const st = s.ramp(pal === 'badlands' ? ['#d0b070', '#a88848', '#806830'] : pal === 'frost' ? ['#d8e8f0', '#a8c0d0', '#7890a8'] : ['#8cd458', '#4ea83e', '#2f8a34']);
  const head = s.ramp(['#a87050', '#7a4c30', '#5a3420']);
  const sw = frame;
  for (const [x, top] of [[3, 4], [7, 1], [11, 5]]) {
    s.line(x, 21, x + sw, top + 4, st);
    s.rect(x - 1 + sw, top, 2, 5, head);
  }
  s.line(5, 21, 2 - sw, 9, st); s.line(9, 21, 12 + sw, 10, st);
  return s.render();
}

function lily(): ImageData {
  const s = new Sprite(14, 7);
  s.outline = '#1e5a3a';
  s.ellipse(7, 3.5, 6.5, 3, s.ramp(['#a8e070', '#5cb444', '#2e8a46']));
  s.px(7, 2, 0); s.px(8, 3, 0);
  s.dot(4, 2, '#ffd0e8'); s.dot(5, 2, '#ff98c8');
  void TRUNK;
  return s.render();
}
