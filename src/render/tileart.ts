// Arena art: per-biome palettes for ground, cliffs and water, and every prop sprite an
// arena can place, painted in code at 16 texels per tile. Sunpetal Meadow reuses the
// Maplebrook overworld painters (the HeartGold/SoulSilver-style route look); the other
// regions recolour the same shapes so all four read as one production.
import * as S from '../overworld/sprites';
import { Sprite, h2, hex, type Ramp, type RGB } from '../overworld/paint';
import type { CliffPalette, GroundPalette, WaterPalette } from '../overworld/terrain';
import * as A from './pixelart';

export interface BiomeArt {
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

const ROCK: Record<string, Ramp> = { meadow: ['#e0d8c8', '#b8b0a0', '#908878', '#6a6458'], badlands: ['#e0a888', '#b87860', '#905040', '#683830'], frost: ['#e8f0f8', '#b8c8d8', '#8898b0', '#687890'], dusk: ['#a8a0b8', '#787090', '#585070', '#403850'] };
const GRASS: Record<string, Ramp> = { meadow: ['#8cd458', '#4ea83e', '#2f8a34', '#1f6a2c'], badlands: ['#f0d890', '#d0b060', '#a88840', '#806830'], frost: ['#e8f8ff', '#b8dce8', '#88b8c8', '#6898a8'], dusk: ['#6ab060', '#3e8a48', '#2a6a3c', '#1c4c2e'] };
const CRYSTAL: Record<string, Ramp> = { meadow: ['#ffffff', '#c8f4ff', '#78d8f8', '#40a8d8'], badlands: ['#fff0c0', '#ffc060', '#f08830', '#c05820'], frost: ['#ffffff', '#c8f4ff', '#78d8f8', '#40a8d8'], dusk: ['#f0d8ff', '#c8a0ff', '#9868e8', '#6840c0'] };
const FLOWER: Record<string, string> = { flowerR: '#ff5878', flowerW: '#ffffff', flowerY: '#ffd838', flowerB: '#80a8ff' };
const TRUNK: Ramp = ['#a07850', '#7a5838', '#5a4028'];
/** night forest foliage for Duskwood Hollow (the global tint cools it further) */
const NIGHT: S.TreeRamps = { hl: '#9ad870', light: '#5aa850', base: '#3a8448', shade: '#22604a', deep: '#14404a', outline: '#0e2630', trunk: ['#8a6a4c', '#5e4836', '#3e2e26'] };

/** Sprite set for one biome: key -> image (animated kinds have numbered frames, e.g. tall0..2) */
export function arenaSprites(biome: string): Map<string, ImageData> {
  const pal = (['meadow', 'badlands', 'frost', 'dusk'].includes(biome) ? biome : 'meadow') as A.BiomePal;
  const out = new Map<string, ImageData>();
  const put = (k: string, im: ImageData) => out.set(k, im);
  const meadow = pal === 'meadow';
  const forest = pal === 'meadow' || pal === 'dusk';
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
  put('rock', meadow ? S.paintRock() : A.rock(0.95, ROCK[pal]));
  put('boulder', boulder(ROCK[pal]));
  put('stump', stump());
  put('log', S.paintLog());
  put('berry', S.paintBerryTree());
  put('sign', S.paintSign());
  put('lantern', S.paintStoneLantern());
  put('pillar', pillar(ROCK[pal], false));
  put('pillarBroken', pillar(ROCK[pal], true));
  put('statue', statue(ROCK[pal]));
  put('shrine', shrine(ROCK[pal]));
  put('crystal', A.crystal(CRYSTAL[pal], 0.75));
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
  return out;
}

/** An original log cabin, 4 × 3 tiles: gabled roof, plank door facing the street (south), shuttered window, chimney. */
function cabin(pal: A.BiomePal): ImageData {
  const s = new Sprite(64, 62);
  s.outline = '#2a2018';
  const roofR: Ramp = pal === 'frost' ? ['#f4f8fc', '#d4e0ec', '#a8b8cc', '#7a8ca4'] : pal === 'badlands' ? ['#d89a6a', '#b07048', '#884e30', '#603420'] : pal === 'dusk' ? ['#8a7cc0', '#6a5ca0', '#4c4080', '#342a5c'] : ['#e07a5a', '#c0563c', '#94402c', '#6a2c20'];
  const logR = s.ramp(['#d8a870', '#b88450', '#94663a', '#6e4a28']);
  // walls: stacked logs
  s.rect(6, 30, 52, 30, logR);
  for (let y = 33; y < 60; y += 4) s.rect(6, y, 52, 1, s.ramp(['#7a5432', '#664428', '#523620']));
  // log ends at the corners
  for (let y = 31; y < 60; y += 4) { s.ellipse(6, y + 1, 2, 1.6, s.ramp(['#f0d0a0', '#d0a878', '#a88050'])); s.ellipse(57, y + 1, 2, 1.6, s.ramp(['#f0d0a0', '#d0a878', '#a88050'])); }
  // chimney behind the roof
  s.rect(44, 6, 7, 14, s.ramp(['#c8c0b4', '#a49c90', '#80786e']));
  s.rect(43, 5, 9, 3, s.ramp(['#d8d0c4', '#b4ac9e', '#8e867a']));
  // gabled roof with overhang
  const roof = s.ramp(roofR);
  for (let y = 0; y < 22; y++) { const w = 18 + y * 2.2; s.rect(32 - w / 2, 10 + y, w, 1, roof); }
  s.rect(2, 31, 60, 3, s.ramp([roofR[2], roofR[3]!, roofR[3]!]));
  for (let y = 13; y < 31; y += 3) s.rect(32 - (18 + (y - 10) * 2.2) / 2 + 2, y, 18 + (y - 10) * 2.2 - 4, 1, s.ramp([roofR[1], roofR[2], roofR[3]!]));
  // door (south face) and a window with shutters
  s.rect(22, 42, 11, 18, s.ramp(['#8a5a34', '#6e4426', '#52301a']));
  s.rect(22, 41, 11, 2, s.ramp(['#5a3a22', '#462c18', '#341e10']));
  s.dot(30, 51, '#f0d070');
  s.rect(39, 40, 12, 9, s.ramp(['#bfe4f4', '#8cc4e0', '#5a9cc4']));
  s.rect(44, 40, 1, 9, s.ramp(['#6e4426', '#52301a', '#3a2010'])); s.rect(39, 44, 12, 1, s.ramp(['#6e4426', '#52301a', '#3a2010']));
  s.rect(36, 40, 3, 9, s.ramp(['#4e8a5a', '#3a6e46', '#285234'])); s.rect(51, 40, 3, 9, s.ramp(['#4e8a5a', '#3a6e46', '#285234']));
  s.rect(12, 44, 6, 6, s.ramp(['#bfe4f4', '#8cc4e0', '#5a9cc4']));
  // a doorstep
  s.rect(20, 59, 15, 2, s.ramp(['#c8c0b4', '#a49c90', '#80786e']));
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

function boulder(r: Ramp): ImageData {
  const s = new Sprite(34, 30);
  s.outline = '#3a3830';
  s.ellipse(17, 19, 16, 10, s.ramp(r));
  s.ellipse(12, 13, 9, 7, s.ramp([r[0], r[0], r[1], r[2]]));
  s.ellipse(24, 15, 7, 6, s.ramp([r[0], r[1], r[2]]));
  s.dline(14, 20, 20, 25, r[3] ?? r[2]);
  s.dot(9, 10, '#ffffff');
  return s.render();
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
