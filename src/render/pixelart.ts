// Pixel-art painters for the survivor arenas (props) and combat effects, built on the same
// region-shaded / outlined painter as the creature art. Every size is in texels; the arena
// renders everything at PIXEL_DENSITY texels per metre so all art shares one pixel size.
import { Sprite, type Ramp } from '../overworld/paint';

export const PIXEL_DENSITY = 16; // texels per world metre (one texel = one screen pixel at the camera focus)

type Pal = { leaf: Ramp; leaf2: Ramp; trunk: Ramp; outline: string };
const P = {
  meadow: { leaf: ['#a8c850', '#80a938', '#678038', '#566a3a'], leaf2: ['#98d070', '#70b850', '#559840', '#3f7a34'], trunk: ['#a07850', '#7a5838', '#5a4028'], outline: '#3c3820' },
  frost: { leaf: ['#7ab890', '#4f9070', '#3a7058', '#2c5848'], leaf2: ['#88c0a0', '#5a9a78', '#40785c'], trunk: ['#8a6a50', '#6a4c38', '#4a3428'], outline: '#24302c' },
  dusk: { leaf: ['#9a88d0', '#7060b0', '#544890', '#3e3470'], leaf2: ['#8878c0', '#6250a0', '#4a3c80'], trunk: ['#6a5070', '#4a3850', '#302438'], outline: '#1c1428' },
  badlands: { leaf: ['#c8a868', '#a88848', '#886a34', '#6a5028'], leaf2: ['#b89858', '#987840', '#785a30'], trunk: ['#8a6048', '#6a4434', '#4a2c24'], outline: '#2c1c14' },
} satisfies Record<string, Pal>;
export type BiomePal = keyof typeof P;

/** tiered round conifer, k = art scale (texels per design pixel stays 1; k enlarges the design) */
export function tieredTree(biome: BiomePal, k: number, variant = 0, snow = false): ImageData {
  const pal = P[biome];
  const W = Math.round(32 * k), H = Math.round(46 * k);
  const s = new Sprite(W, H);
  s.outline = pal.outline;
  const tr = s.ramp(pal.trunk);
  s.rect(13 * k, 35 * k, 6 * k, 9 * k, tr);
  s.rect(11 * k, 42 * k, 10 * k, 2 * k, tr);
  const L = variant % 2 ? pal.leaf2 : pal.leaf;
  const tiers: [number, number, number, number][] = [[16, 31, 15.4, 6.8], [16, 23, 13.2, 6.6], [16, 15, 10.4, 6.2], [16, 8, 6.8, 5.4]];
  for (const [cx, cy, rx, ry] of tiers) {
    const id = s.ramp(L);
    s.ellipse(cx * k, cy * k, rx * k, ry * k, id);
    for (let x = cx - rx + 3; x < cx + rx - 2; x += 4) s.ellipse(x * k, (cy + ry - 1.2) * k, 2.2 * k, 1.8 * k, id);
    if (snow) { const sn = s.ramp(['#ffffff', '#eef4fb', '#c8d8e8']); s.ellipse(cx * k, (cy - ry * 0.45) * k, rx * 0.75 * k, ry * 0.42 * k, sn); }
  }
  for (const [cx, cy, rx, ry] of tiers)
    for (let n = 0; n < rx * k * 1.2; n++) {
      const a = hh(n, cy, variant) * Math.PI * 2, r = hh(n, cx + cy, 3 + variant) * 0.85;
      const x = (cx + Math.cos(a) * rx * r) * k, y = (cy + Math.sin(a) * ry * r) * k;
      if (snow) continue;
      if (x < cx * k && y < cy * k) { s.dot(x, y, L[0]); s.dot(x + 1, y, L[0]); }
      else if (x > cx * k && y > (cy - 1) * k) s.dot(x, y, L[3] ?? L[2]);
    }
  return s.render();
}

/** round broadleaf / blossom / dusk tree */
export function roundTree(biome: BiomePal, k: number, blossom = false): ImageData {
  const pal = P[biome];
  const s = new Sprite(Math.round(34 * k), Math.round(44 * k));
  s.outline = pal.outline;
  const tr = s.ramp(pal.trunk);
  s.rect(15 * k, 30 * k, 5 * k, 12 * k, tr);
  s.rect(12 * k, 40 * k, 11 * k, 2 * k, tr);
  const L: Ramp = blossom ? ['#ffd0e0', '#f8a8c8', '#d880a8', '#b86090'] : pal.leaf2;
  for (const [x, y, r] of [[10, 22, 8], [24, 22, 8], [17, 26, 8], [17, 15, 9], [9, 14, 6], [25, 14, 6], [17, 8, 7]] as [number, number, number][]) s.ellipse(x * k, y * k, r * k, r * 0.9 * k, s.ramp(L));
  for (let n = 0; n < 40 * k; n++) {
    const x = (4 + hh(n, 1, 7) * 26) * k, y = (3 + hh(n, 2, 7) * 26) * k;
    if (s.get(Math.round(x), Math.round(y))) s.dot(x, y, n % 3 ? L[0] : L[3] ?? L[2]);
  }
  return s.render();
}

export function deadTree(k: number): ImageData {
  const s = new Sprite(Math.round(30 * k), Math.round(48 * k));
  s.outline = '#2c1c14';
  const b = s.ramp(['#8a6048', '#6a4434', '#4a2c24']);
  s.rect(13 * k, 14 * k, 4 * k, 32 * k, b);
  const br = (x0: number, y0: number, x1: number, y1: number) => { for (let w = 0; w < 2 * k; w++) s.line(x0 * k + w, y0 * k, x1 * k + w, y1 * k, b); };
  br(15, 26, 4, 14); br(15, 22, 26, 10); br(15, 16, 9, 4); br(15, 16, 20, 2); br(6, 18, 2, 12); br(23, 13, 28, 8);
  return s.render();
}

export function crystal(color: Ramp, k: number): ImageData {
  const s = new Sprite(Math.round(24 * k), Math.round(30 * k));
  s.outline = '#2a2440';
  for (const [x, w, h] of [[12, 5, 26], [6, 4, 16], [18, 4, 18]] as [number, number, number][]) {
    const id = s.ramp(color);
    for (let y = 0; y < h * k; y++) { const half = Math.max(1, (w * k) * Math.min(1, (y + 2) / (h * k * 0.35))); s.rect(x * k - half, (29 * k) - y, half * 2, 1, id); }
  }
  s.dot(11 * k, 8 * k, '#ffffff'); s.dot(11 * k, 9 * k, '#ffffff');
  return s.render();
}

export function mushroom(k: number, glow = '#c6ff6a'): ImageData {
  const s = new Sprite(Math.round(20 * k), Math.round(20 * k));
  s.outline = '#241830';
  s.rect(8 * k, 9 * k, 4 * k, 10 * k, s.ramp(['#f4ecd8', '#e0d4b8', '#b8a888']));
  s.ellipse(10 * k, 8 * k, 9 * k, 5.5 * k, s.ramp(['#a070d0', '#7a48a8', '#5a3088', '#402068']));
  for (const [x, y] of [[6, 6], [12, 4], [14, 8], [8, 9]]) { s.dot(x * k, y * k, glow); s.dot(x * k + 1, y * k, glow); }
  return s.render();
}

export function vent(k: number): ImageData {
  const s = new Sprite(Math.round(28 * k), Math.round(18 * k));
  s.outline = '#2c1c14';
  s.ellipse(14 * k, 11 * k, 13 * k, 6 * k, s.ramp(['#8a7468', '#6a5448', '#4a3830']));
  s.ellipse(14 * k, 9 * k, 7 * k, 3 * k, s.ramp(['#fff0a0', '#ffb040', '#e06020']));
  return s.render();
}

export function bush(biome: BiomePal, k: number, berries?: string): ImageData {
  const pal = P[biome];
  const s = new Sprite(Math.round(20 * k), Math.round(17 * k));
  s.outline = pal.outline;
  for (const [x, y, r] of [[6.5, 10, 5.5], [13.5, 10, 5.5], [10, 6.5, 5.5]] as [number, number, number][]) s.ellipse(x * k, y * k, r * k, r * 0.85 * k, s.ramp(pal.leaf2));
  if (berries) for (const [x, y] of [[6, 7], [12, 9], [9, 12], [14, 5]]) s.dot(x * k, y * k, berries);
  return s.render();
}

export function rock(k: number, tone: Ramp = ['#e0d8c8', '#b8b0a0', '#908878', '#6a6458']): ImageData {
  const s = new Sprite(Math.round(20 * k), Math.round(16 * k));
  s.outline = '#3a3830';
  s.ellipse(10 * k, 10 * k, 9 * k, 5.6 * k, s.ramp(tone));
  s.ellipse(7.5 * k, 7 * k, 4.6 * k, 3.4 * k, s.ramp([tone[0], tone[0], tone[1]]));
  return s.render();
}

/** the Transport objective's egg: cream shell with green spots (an original design) */
export function egg(): ImageData {
  const s = new Sprite(14, 18);
  s.outline = '#4a4030';
  s.ellipse(7, 10, 6, 7.5, s.ramp(['#fffaf0', '#f4ecdc', '#dcd0b8', '#b8ac94']));
  const spot = s.ramp(['#98d078', '#70b058', '#4f8a40']);
  for (const [x, y, r] of [[4.5, 8, 1.7], [9.5, 11.5, 1.9], [6.5, 14, 1.3], [9, 6, 1.1]] as [number, number, number][]) s.ellipse(x, y, r, r * 0.85, spot);
  return s.render();
}

export function grassTuft(color: Ramp, k: number, frame = 0): ImageData {
  const s = new Sprite(Math.round(18 * k), Math.round(13 * k));
  s.outline = '#2a5038';
  const g = s.ramp(color);
  const lean = frame ? 1 : 0;
  const tops = [4, 1, 3, 0, 2, 1, 4, 2];
  for (let i = 0; i < 8; i++) {
    const x = (1 + i * 2.1) * k;
    s.line(x, 12 * k, x + lean, tops[i] * k, g);
    if (k > 1) s.line(x + 1, 12 * k, x + 1 + lean, tops[i] * k + 2, g);
  }
  s.ellipse(9 * k, 11 * k, 8.5 * k, 2.5 * k, g);
  return s.render();
}

export function flowers(color: string, k: number): ImageData {
  const s = new Sprite(Math.round(16 * k), Math.round(12 * k));
  s.outline = '#2e5a38';
  const st = s.ramp(['#78c858', '#58a848', '#3f8a3a']);
  const pet = s.ramp([lighten(color), color, darken(color)]);
  for (const [x, y] of [[4, 4], [11, 3], [8, 7]]) {
    s.line(x * k, (y + 2) * k, x * k, 11 * k, st);
    s.rect((x - 1) * k, (y - 1) * k, 3 * k, 3 * k, pet);
    s.dot(x * k, y * k, '#fff8b0');
  }
  return s.render();
}

// ================================================================= combat effect sprites
/** Effect sprite set per element: [projectile, particle A, particle B]. Each is 16x16 texels. */
export function fxSprite(kind: string): ImageData {
  const s = new Sprite(16, 16);
  s.outline = '#201820';
  const R = (r: Ramp) => s.ramp(r);
  switch (kind) {
    case 'fireball': { s.ellipse(9, 9, 5.5, 5, R(['#fff8c0', '#ffd040', '#ff8020', '#d84010'])); s.ellipse(5, 6, 3, 2.5, R(['#ffd040', '#ff8020', '#d84010'])); s.ellipse(3, 4, 1.8, 1.5, R(['#ff8020', '#d84010', '#a02808'])); s.dot(10, 8, '#ffffff'); break; }
    case 'flame': { s.ellipse(8, 10, 4.5, 4.5, R(['#fff0a0', '#ffb030', '#f06018'])); s.ellipse(8, 6, 2.5, 3.5, R(['#ffd040', '#ff8020', '#d84010'])); s.px(8, 2, R(['#ff8020', '#ff8020', '#d84010'])); break; }
    case 'ember': { s.ellipse(8, 8, 2.5, 2.5, R(['#ffffa0', '#ffc030', '#f07018'])); s.outline = '#802008'; break; }
    case 'bubble': { const c = R(['#e8f8ff', '#80c8ff', '#3890e8', '#2068c0']); s.ellipse(8, 8, 6, 6, c); s.ellipse(8, 8, 4, 4, R(['#c8ecff', '#a8dcff', '#80c8ff'])); s.dot(6, 5, '#ffffff'); s.dot(5, 6, '#ffffff'); s.dot(10, 11, '#3890e8'); break; }
    case 'drop': { s.ellipse(8, 10, 3, 3.5, R(['#c8ecff', '#70b8f8', '#3088e0'])); s.px(8, 5, R(['#70b8f8', '#70b8f8', '#3088e0'])); s.px(8, 6, R(['#70b8f8', '#70b8f8', '#3088e0'])); s.dot(7, 9, '#ffffff'); break; }
    case 'leaf': { const c = R(['#c8f080', '#78c840', '#4a9828', '#2f7020']); s.ellipse(8, 8, 6.5, 3.2, c); s.dline(3, 8, 13, 8, '#2f7020'); s.dot(5, 7, '#e8ffb0'); break; }
    case 'petal': { s.ellipse(8, 8, 2, 1.5, R(['#ffe0f0', '#ffa8d0', '#e070a8'])); break; }
    case 'spark': { const c = R(['#ffffe0', '#fff060', '#f0c000']); s.line(8, 1, 8, 15, c); s.line(1, 8, 15, 8, c); s.line(4, 4, 12, 12, c); s.line(12, 4, 4, 12, c); s.ellipse(8, 8, 2.5, 2.5, R(['#ffffff', '#ffffe0', '#fff060'])); break; }
    case 'voltball': { s.ellipse(8, 8, 5.5, 5.5, R(['#ffffe0', '#fff060', '#f0c000', '#c09000'])); s.dline(2, 3, 5, 6, '#fffff0'); s.dline(14, 12, 11, 9, '#fffff0'); s.dline(13, 2, 11, 5, '#fffff0'); s.dot(7, 6, '#ffffff'); break; }
    case 'shard': { const c = R(['#ffffff', '#c8f4ff', '#78d8f8', '#40a8d8']); for (let y = 1; y < 15; y++) { const w = y < 8 ? (y - 1) * 0.5 : (15 - y) * 0.5; s.rect(8 - w, y, w * 2 + 1, 1, c); } s.dot(7, 4, '#ffffff'); break; }
    case 'snow': { s.dline(8, 3, 8, 13, '#ffffff'); s.dline(3, 8, 13, 8, '#ffffff'); s.dline(5, 5, 11, 11, '#e0f4ff'); s.dline(11, 5, 5, 11, '#e0f4ff'); s.outline = '#6aa8d8'; break; }
    case 'psi': { s.ellipse(8, 8, 6, 6, R(['#ffd0f0', '#ff80c8', '#d050a0', '#a03080'])); s.ellipse(8, 8, 3, 3, R(['#ffffff', '#ffe0f4', '#ffb0e0'])); break; }
    case 'star': { const c = R(['#ffffff', '#ffe8ff', '#ffa8e0']); s.line(8, 2, 8, 14, c); s.line(2, 8, 14, 8, c); s.ellipse(8, 8, 2.5, 2.5, c); break; }
    case 'goo': { s.ellipse(8, 9, 5.5, 4.5, R(['#e0a8ff', '#b060e0', '#8838b8', '#602090'])); s.ellipse(6, 6, 2, 1.5, R(['#f0d0ff', '#e0a8ff', '#b060e0'])); break; }
    case 'gooDrop': { s.ellipse(8, 9, 3, 3, R(['#e0a8ff', '#b060e0', '#8838b8'])); break; }
    case 'rockChunk': { s.ellipse(8, 9, 5.5, 4.5, R(['#e0d0b0', '#b8a080', '#907858', '#6a5840'])); s.ellipse(6, 7, 2.5, 2, R(['#f0e4c8', '#e0d0b0', '#b8a080'])); break; }
    case 'dust': { s.ellipse(8, 8, 3.5, 3, R(['#e8dcc0', '#c8b898', '#a89878'])); s.outline = '#8a7a60'; break; }
    case 'wind': { const c = R(['#ffffff', '#e0f0ff', '#a8c8e8']); for (let a = 0; a < 11; a++) { const t = a / 10; s.px(3 + t * 10, 11 - Math.sin(t * Math.PI) * 7, c); s.px(3 + t * 10, 12 - Math.sin(t * Math.PI) * 7, c); } break; }
    case 'feather': { s.ellipse(8, 8, 2, 5.5, R(['#ffffff', '#e8f0f8', '#c0d0e0'])); s.dline(8, 3, 8, 13, '#a0b0c0'); break; }
    case 'shadow': { s.ellipse(8, 9, 5.5, 5.5, R(['#9a80d8', '#6a50a8', '#483080', '#2a1858'])); s.ellipse(8, 5, 3, 3, R(['#b8a0f0', '#8a70c8', '#6a50a8'])); s.dot(7, 8, '#ffe060'); s.dot(10, 8, '#ffe060'); break; }
    case 'wisp': { s.ellipse(8, 10, 4, 4, R(['#d8c8ff', '#9a80e8', '#6a50c0'])); s.ellipse(8, 6, 2, 3, R(['#b8a0f0', '#8a70d0', '#6a50c0'])); break; }
    case 'metal': { const c = R(['#ffffff', '#d8e0e8', '#a0acb8', '#707c88']); s.ellipse(8, 8, 5.5, 5.5, c); s.ellipse(8, 8, 2, 2, R(['#707c88', '#505c68', '#404850'])); break; }
    case 'impact': { const c = R(['#ffffff', '#fffbe0', '#ffe080']); s.line(8, 0, 8, 15, c); s.line(0, 8, 15, 8, c); s.ellipse(8, 8, 3.5, 3.5, c); s.line(3, 3, 13, 13, c); s.line(13, 3, 3, 13, c); s.outline = '#c08020'; break; }
    case 'impactBig': { const c = R(['#ffffff', '#fff4c0', '#ffc040']); for (let a = 0; a < 8; a++) { const ang = (a / 8) * Math.PI * 2; s.line(8, 8, 8 + Math.cos(ang) * 7.5, 8 + Math.sin(ang) * 7.5, c); } s.ellipse(8, 8, 4.5, 4.5, c); s.outline = '#b04010'; break; }
    // Oran Berry (the heal pickup): blue berry with a leaf, drawn at world pixel density
    case 'heart': { const c = R(['#ffd0e0', '#ff6890', '#d04068']); s.ellipse(6.5, 7, 2.2, 2, c); s.ellipse(9.5, 7, 2.2, 2, c); for (let y = 8; y < 13; y++) { const w = Math.max(0, 4 - (y - 8)); s.rect(8 - w, y, w * 2, 1, c); } break; }
    case 'oran': { s.outline = '#1a2a5a'; s.ellipse(8, 9.5, 4.2, 3.8, R(['#a8d8ff', '#5890f0', '#3060c8', '#204890'])); s.ellipse(8, 5.5, 2.2, 1.2, R(['#a8e070', '#58a840', '#3a8030'])); s.dot(6, 8, '#e8f8ff'); s.dot(7, 7, '#e8f8ff'); break; }
    // item ball: an item lying in the field (chests); opening it offers a rare upgrade
    case 'itemball': { s.outline = '#202028'; const top = R(['#ff9080', '#e83838', '#b01818']); const bot = R(['#ffffff', '#f0f0f0', '#c8c8d0']); s.ellipse(8, 8, 5.5, 5.5, bot); for (let y = 2; y < 8; y++) for (let x = 2; x < 15; x++) if (s.get(x, y)) s.px(x, y, top); s.rect(2, 8, 13, 1, R(['#303038', '#303038', '#202028'])); s.ellipse(8, 8.5, 1.6, 1.6, R(['#ffffff', '#e8e8f0', '#b8b8c8'])); s.dot(5, 4, '#ffd8d0'); break; }
    case 'xp': { const c = R(['#e8fbff', '#80e0ff', '#30a8e8', '#1878c0']); for (let y = 5; y < 13; y++) { const w = y < 8 ? (y - 5) * 0.9 : (12 - y) * 0.7; s.rect(8 - w, y, w * 2 + 1, 1, c); } s.dot(7, 7, '#ffffff'); break; }
    default: s.ellipse(8, 8, 4, 4, R(['#ffffff', '#e0e0e0', '#b0b0b0']));
  }
  return s.render();
}

export const FX_KINDS = ['fireball', 'flame', 'ember', 'bubble', 'drop', 'leaf', 'petal', 'spark', 'voltball', 'shard', 'snow', 'psi', 'star', 'goo', 'gooDrop', 'rockChunk', 'dust', 'wind', 'feather', 'shadow', 'wisp', 'metal', 'impact', 'impactBig', 'heart', 'oran', 'xp', 'itemball'];

/** element -> [projectile, particle, secondary particle] */
export const ELEMENT_FX: Record<string, [string, string, string]> = {
  plain: ['star', 'star', 'dust'], blaze: ['fireball', 'flame', 'ember'], tide: ['bubble', 'drop', 'bubble'], bloom: ['leaf', 'leaf', 'petal'],
  volt: ['voltball', 'spark', 'spark'], frost: ['shard', 'snow', 'shard'], brawl: ['impact', 'dust', 'star'], venom: ['goo', 'gooDrop', 'goo'],
  quake: ['rockChunk', 'dust', 'rockChunk'], gale: ['wind', 'feather', 'wind'], mind: ['psi', 'star', 'psi'], hive: ['shard', 'leaf', 'dust'],
  stone: ['rockChunk', 'dust', 'rockChunk'], wisp: ['wisp', 'wisp', 'shadow'], wyrm: ['shadow', 'wisp', 'flame'], gloom: ['shadow', 'wisp', 'dust'],
  alloy: ['metal', 'star', 'metal'], fae: ['star', 'heart', 'petal'],
};

function hh(x: number, y: number, s: number) { let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(s | 0, 982451653)) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16; return (h >>> 0) / 4294967296; }
function lighten(c: string, k = 0.35) { const n = parseInt(c.slice(1), 16); const f = (v: number) => Math.round(v + (255 - v) * k); return rgb(f((n >> 16) & 255), f((n >> 8) & 255), f(n & 255)); }
function darken(c: string, k = 0.28) { const n = parseInt(c.slice(1), 16); const f = (v: number) => Math.round(v * (1 - k)); return rgb(f((n >> 16) & 255), f((n >> 8) & 255), f(n & 255)); }
function rgb(r: number, g: number, b: number) { return '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join(''); }
