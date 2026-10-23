// UI icons. Imported: Pokémon type badges and bag icons (PokeAPI/sprites, see
// docs/ICONS.md), used only where the item's canonical effect matches the game effect.
// Original: pixel glyphs for survival-only concepts (EXP shards, attack shapes, cooldowns…)
// painted with the same outlined, top-left-lit painter as the rest of the game's pixel art,
// at the bag icons' density so they sit together.
import { Sprite, type Ramp } from '../overworld/paint';
import type { Element } from '../rules/elements';
import ICONS from '../content/icons.json';

const IC = ICONS as { types: Record<string, string>; items: Record<string, string>; license: string };

/** game element -> canonical type name */
export const TYPE_OF: Record<Element, string> = {
  plain: 'normal', blaze: 'fire', tide: 'water', bloom: 'grass', volt: 'electric', frost: 'ice', brawl: 'fighting', venom: 'poison', quake: 'ground',
  gale: 'flying', mind: 'psychic', hive: 'bug', stone: 'rock', wisp: 'ghost', wyrm: 'dragon', gloom: 'dark', alloy: 'steel', fae: 'fairy',
};

/** Pokémon type badge (48x16); a local fallback is used if an imported badge is unavailable. */
export function typeBadge(el: Element, scale = 1): HTMLElement {
  const t = TYPE_OF[el];
  const src = IC.types[t];
  if (src) {
    const im = document.createElement('img');
    im.src = src; im.alt = t; im.className = 'pix badge'; im.width = 48 * scale; im.height = 16 * scale; im.draggable = false;
    return im;
  }
  const im = document.createElement('img');
  im.src = glyph('fairyBadge'); im.alt = t; im.className = 'pix badge'; im.width = 48 * scale; im.height = 16 * scale;
  return im;
}

/** a DS-era bag icon (30x30) by PokeAPI item name */
export function itemIcon(name: string, scale = 1): HTMLImageElement | null {
  const src = IC.items[name];
  if (!src) return null;
  const im = document.createElement('img');
  im.src = src; im.alt = name.replace(/-/g, ' '); im.className = 'pix item'; im.width = 30 * scale; im.height = 30 * scale; im.draggable = false;
  return im;
}

// ------------------------------------------------------------------ original glyphs
const cache = new Map<string, string>();
function paint(w: number, h: number, outline: string, fn: (s: Sprite) => void): string {
  const s = new Sprite(w, h);
  s.outline = outline;
  fn(s);
  const img = s.render();
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  c.getContext('2d')!.putImageData(img, 0, 0);
  return c.toDataURL();
}
const WHITE: Ramp = ['#ffffff', '#f0f0f8', '#c8ccd8', '#9aa0b4'];

const GLYPHS: Record<string, () => string> = {
  // survival concepts
  xp: () => paint(16, 16, '#103a6a', (s) => { const c = s.ramp(['#e8fbff', '#80e0ff', '#30a8e8', '#1878c0']); for (let y = 2; y < 14; y++) { const w = y < 7 ? (y - 2) * 0.9 : (13 - y) * 0.65; s.rect(8 - w, y, w * 2 + 1, 1, c); } s.dot(6, 6, '#ffffff'); s.dot(7, 5, '#ffffff'); }),
  lure: () => paint(16, 16, '#7a2860', (s) => { const c = s.ramp(['#ffffff', '#ffd0f0', '#ff88d0', '#d04a9a']); s.ellipse(8, 8, 3.2, 3.2, c); for (const [x, y] of [[8, 1], [8, 15], [1, 8], [15, 8]]) s.line(8, 8, x, y, c); s.dot(7, 7, '#ffffff'); }),
  cooldown: () => paint(16, 16, '#3a2a18', (s) => { const g = s.ramp(['#ffffff', '#e0f0ff', '#a8c8e8']); const f = s.ramp(['#f0d098', '#c89858', '#906838']); s.rect(3, 1, 10, 2, f); s.rect(3, 13, 10, 2, f); for (let y = 3; y < 13; y++) { const w = Math.abs(8 - y) * 0.75 + 0.5; s.rect(8 - w, y, w * 2, 1, g); } s.dot(7, 11, '#f0c040'); s.dot(8, 11, '#f0c040'); s.dot(8, 10, '#f0c040'); s.dot(7, 5, '#f0c040'); }),
  area: () => paint(16, 16, '#283860', (s) => { const r = s.ramp(['#d8f0ff', '#80b8f0', '#4878c8']); for (let a = 0; a < 32; a++) { const t = (a / 32) * Math.PI * 2; s.px(8 + Math.cos(t) * 6.5, 8 + Math.sin(t) * 6.5, r); } s.ellipse(8, 8, 2.5, 2.5, s.ramp(['#ffffff', '#c8e0ff', '#80b8f0'])); for (const [x, y] of [[8, 4], [12, 8], [8, 12], [4, 8]]) s.dot(x, y, '#80b8f0'); }),
  magnet: () => paint(16, 16, '#283048', (s) => { const r = s.ramp(['#ffffff', '#e8f0ff', '#a8b8d8']); for (let a = 0; a < 3; a++) { const rr = 2 + a * 2.6; for (let k = -6; k <= 6; k++) { const t = (k / 6) * 1.2 - Math.PI / 2; s.px(8 + Math.cos(t) * rr, 12 + Math.sin(t) * rr, r); } } s.ellipse(8, 12, 1.8, 1.8, s.ramp(['#e8fbff', '#80e0ff', '#30a8e8'])); }),
  upgrade: () => paint(16, 16, '#1a3a20', (s) => { const g = s.ramp(['#d8ffc0', '#70d050', '#3a9a30']); for (let y = 2; y < 9; y++) { const w = y - 2; s.rect(8 - w, y, w * 2 + 1, 1, g); } s.rect(6, 9, 5, 5, g); }),
  heal: () => paint(16, 16, '#6a1830', (s) => { const c = s.ramp(['#ffd0e0', '#ff6890', '#d04068']); s.ellipse(5.5, 6, 3, 2.8, c); s.ellipse(10.5, 6, 3, 2.8, c); for (let y = 7; y < 14; y++) { const w = Math.max(0, 6 - (y - 7) * 1); s.rect(8 - w, y, w * 2, 1, c); } s.dot(4, 5, '#ffffff'); }),
  // move categories (original designs)
  physical: () => paint(20, 14, '#4a1808', (s) => { s.rect(0, 0, 20, 14, s.ramp(['#ffb070', '#f07030', '#c04818'])); const st = s.ramp(['#ffffff', '#fff4c0', '#ffd060']); for (let a = 0; a < 8; a++) { const t = (a / 8) * Math.PI * 2; s.line(10, 7, 10 + Math.cos(t) * 5.5, 7 + Math.sin(t) * 4.5, st); } s.ellipse(10, 7, 2.2, 2, st); }),
  special: () => paint(20, 14, '#201848', (s) => { s.rect(0, 0, 20, 14, s.ramp(['#a8a0ff', '#6858d8', '#4030a8'])); const r = s.ramp(['#ffffff', '#e0e0ff', '#b0b0f0']); for (const rr of [5, 2.6]) for (let a = 0; a < 28; a++) { const t = (a / 28) * Math.PI * 2; s.px(10 + Math.cos(t) * rr, 7 + Math.sin(t) * rr * 0.8, r); } s.dot(10, 7, '#ffffff'); }),
  status: () => paint(20, 14, '#282830', (s) => { s.rect(0, 0, 20, 14, s.ramp(['#e0e0e8', '#a8a8b8', '#7a7a8c'])); const r = s.ramp(['#ffffff', '#f0f0f8', '#c8c8d8']); for (let y = 2; y < 12; y++) { const w = 5 - Math.abs(7 - y) * 0.9; if (w > 0) s.rect(10 - w, y, w * 2, 1, r); } }),
  fairyBadge: () => paint(48, 16, '#5a2a48', (s) => { s.rect(1, 1, 46, 14, s.ramp(['#ffd0ec', '#f4a0d8', '#d070b0'])); }),
  // attack shapes (archetypes)
  strike: () => paint(16, 16, '#283048', (s) => { const w = s.ramp(WHITE); for (let k = 0; k < 3; k++) s.line(3 + k * 3, 13, 9 + k * 3, 3, w); }),
  dash: () => paint(16, 16, '#283048', (s) => { const w = s.ramp(WHITE); s.rect(2, 7, 9, 2, w); for (let y = 3; y < 13; y++) { const ww = 5 - Math.abs(8 - y); if (ww > 0) s.rect(10, y, ww, 1, w); } s.rect(1, 4, 5, 1, w); s.rect(1, 11, 5, 1, w); }),
  homing: () => paint(16, 16, '#283048', (s) => { const w = s.ramp(WHITE); for (let a = 0; a < 14; a++) { const t = a / 13; s.px(2 + t * 10, 13 - Math.sin(t * 2.4) * 10, w); s.px(3 + t * 10, 13 - Math.sin(t * 2.4) * 10, w); } s.rect(11, 2, 4, 2, w); s.rect(13, 2, 2, 4, w); }),
  orb: () => paint(16, 16, '#283048', (s) => { s.ellipse(8, 8, 5.5, 5.5, s.ramp(WHITE)); s.dot(6, 6, '#ffffff'); }),
  lob: () => paint(16, 16, '#283048', (s) => { const w = s.ramp(WHITE); for (let a = 0; a < 12; a += 2) { const t = a / 11; s.px(1 + t * 10, 13 - Math.sin(t * Math.PI) * 9, w); } s.ellipse(12, 11, 3, 3, w); }),
  bolt: () => paint(16, 16, '#283048', (s) => { const w = s.ramp(WHITE); s.line(2, 12, 11, 6, w); s.line(2, 11, 11, 5, w); s.rect(10, 3, 4, 2, w); s.rect(12, 3, 2, 5, w); }),
  beam: () => paint(16, 16, '#283048', (s) => { s.rect(1, 6, 14, 5, s.ramp(WHITE)); }),
  chain: () => paint(16, 16, '#283048', (s) => { const w = s.ramp(WHITE); s.line(2, 2, 7, 7, w); s.line(7, 7, 5, 9, w); s.line(5, 9, 11, 13, w); s.line(11, 13, 10, 10, w); s.line(10, 10, 14, 11, w); }),
  barrage: () => paint(16, 16, '#283048', (s) => { for (const [x, y] of [[3, 11], [7, 7], [11, 11], [13, 4]]) s.ellipse(x, y, 1.8, 1.8, s.ramp(WHITE)); }),
  boomerang: () => paint(16, 16, '#283048', (s) => { const w = s.ramp(WHITE); s.line(2, 4, 8, 9, w); s.line(8, 9, 14, 4, w); s.line(2, 5, 8, 10, w); s.line(8, 10, 14, 5, w); }),
  vortex: () => paint(16, 16, '#283048', (s) => { const w = s.ramp(WHITE); for (let a = 0; a < 40; a++) { const t = a / 6; const r = 1 + a * 0.16; s.px(8 + Math.cos(t) * r, 8 + Math.sin(t) * r, w); } }),
  nova: () => paint(16, 16, '#283048', (s) => { const w = s.ramp(WHITE); for (let a = 0; a < 8; a++) { const t = (a / 8) * Math.PI * 2; s.line(8 + Math.cos(t) * 4, 8 + Math.sin(t) * 4, 8 + Math.cos(t) * 7, 8 + Math.sin(t) * 7, w); } s.ellipse(8, 8, 2.5, 2.5, w); }),
  spin: () => paint(16, 16, '#283048', (s) => { const w = s.ramp(WHITE); for (let a = 0; a < 22; a++) { const t = (a / 22) * Math.PI * 1.7; s.px(8 + Math.cos(t) * 5.5, 8 + Math.sin(t) * 5.5, w); } s.rect(12, 1, 3, 3, w); }),
  cone: () => paint(16, 16, '#283048', (s) => { const w = s.ramp(WHITE); for (let x = 2; x < 15; x++) { const hh = (x - 2) * 0.5; s.rect(x, 8 - hh, 1, hh * 2 + 1, w); } }),
  aura: () => paint(16, 16, '#283048', (s) => { const w = s.ramp(WHITE); s.ellipse(8, 8, 2, 2, w); for (const rr of [4.5, 7]) for (let a = 0; a < 24; a += 2) { const t = (a / 24) * Math.PI * 2; s.px(8 + Math.cos(t) * rr, 8 + Math.sin(t) * rr, w); } }),
  orbit: () => paint(16, 16, '#283048', (s) => { for (const [x, y] of [[8, 2], [3, 11], [13, 11]]) s.ellipse(x, y, 2, 2, s.ramp(WHITE)); }),
  trail: () => paint(16, 16, '#283048', (s) => { for (const [x, y] of [[3, 12], [8, 8], [13, 4]]) s.ellipse(x, y, 2.4, 1.6, s.ramp(WHITE)); }),
  meteor: () => paint(16, 16, '#283048', (s) => { const w = s.ramp(WHITE); s.line(1, 1, 8, 8, w); s.line(2, 1, 9, 8, w); s.ellipse(10, 10, 3.6, 3.6, w); }),
  drain: () => paint(16, 16, '#283048', (s) => { const w = s.ramp(WHITE); s.ellipse(8, 10, 4, 4, w); for (let y = 2; y < 8; y++) { const ww = (y - 2) * 0.6; s.rect(8 - ww, y, ww * 2 + 1, 1, w); } }),
  smite: () => paint(16, 16, '#283048', (s) => { const w = s.ramp(WHITE); s.line(10, 1, 5, 8, w); s.line(5, 8, 11, 8, w); s.line(11, 8, 6, 15, w); }),
  trap: () => paint(16, 16, '#283048', (s) => { const w = s.ramp(WHITE); for (let a = 0; a < 28; a++) { const t = (a / 28) * Math.PI * 2; s.px(8 + Math.cos(t) * 5.5, 9 + Math.sin(t) * 4.5, w); } s.line(4, 2, 6, 5, w); s.line(12, 2, 10, 5, w); }),
  buff: () => paint(16, 16, '#283048', (s) => { const w = s.ramp(WHITE); for (let y = 2; y < 8; y++) { const ww = y - 2; s.rect(8 - ww, y, ww * 2 + 1, 1, w); } s.rect(6, 8, 5, 6, w); }),
  weather: () => paint(16, 16, '#283048', (s) => { s.ellipse(6, 6, 3.5, 3.5, s.ramp(['#fff8c0', '#ffd040', '#e0a020'])); const w = s.ramp(WHITE); s.ellipse(10, 11, 4.5, 2.6, w); s.ellipse(6, 11, 3, 2.2, w); }),
};

/** data URL of an original glyph */
export function glyph(name: string): string {
  let u = cache.get(name);
  if (!u) { u = (GLYPHS[name] ?? GLYPHS.orb)(); cache.set(name, u); }
  return u;
}
export function glyphImg(name: string, scale = 2, cls = 'pix glyph'): HTMLImageElement {
  const im = document.createElement('img');
  im.src = glyph(name); im.alt = ''; im.className = cls; im.draggable = false;
  im.onload = () => { im.width = im.naturalWidth * scale; im.height = im.naturalHeight * scale; };
  return im;
}
export const GLYPH_NAMES = Object.keys(GLYPHS);
export const ICON_LICENSE = IC.license;
