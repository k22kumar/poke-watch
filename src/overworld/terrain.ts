// Ground painter: paints the whole map's ground into one pixel texture (16 px per tile) with
// rounded, outlined transitions between grass / path / stone / sand / water — the hand-drawn
// look of DS overworld tilesets. Also paints cliff, bank, water and stair textures.
import { Pix, hex, h2, type RGB } from './paint';

import { T } from '../world/tiles';
export { T };
export type { TerrainId } from '../world/tiles';

// HGSS-referenced palette (docs/HGSS_REFERENCE.md): warm yellow-green grass, teal shadows,
// warm beige paths. Hue/value relationships taken from colours counted in extracted HGSS art.
const DEFAULT_GROUND = {
  grass: hex('#8cd060'), grassD: hex('#5ea242'), grassL: hex('#b8ec88'), grassEdge: hex('#5a9c40'),
  path: hex('#e0c890'), pathD: hex('#c8ac76'), pathL: hex('#f0dcaa'), pathEdge: hex('#a88a5a'), pathEdge2: hex('#8a6e46'),
  stone: hex('#d8d4c8'), stoneD: hex('#b8b4a8'), stoneL: hex('#eeeae0'), mortar: hex('#948e80'),
  sand: hex('#ecdcaa'), sandD: hex('#d8c48c'),
  water: hex('#4c94e8'),
  tallBase: hex('#4ea83e'), tallD: hex('#2f8a34'),
  wood: hex('#d8a868'), woodD: hex('#a8743c'), woodL: hex('#ecc488'), woodLine: hex('#7a4e28'),
  floor: hex('#e8c890'), floorD: hex('#d0a870'), floorLine: hex('#a87c48'),
  tatami: hex('#d8d8a0'), tatamiD: hex('#c0c088'), tatamiEdge: hex('#5a7048'),
  dirt: hex('#cdb07a'), dirtD: hex('#b49460'),
  bed: hex('#8a6040'), bedD: hex('#6a4830'),
  flowerbed: hex('#5aa040'), lipA: hex('#5aa844'), lipB: hex('#3c8a3a'),
  dots: [hex('#ffffff'), hex('#ffd0e0'), hex('#fff0a0')] as RGB[], dotCore: hex('#f8b030'),
};
export type GroundPalette = typeof DEFAULT_GROUND;
export const GROUND_DEFAULT = DEFAULT_GROUND;

export interface GroundInput {
  w: number; h: number;
  terrain: Uint8Array; // T ids per tile
  dots?: Uint8Array; // 1 = small ground flowers
  ledge?: Uint8Array; // 1 = ledge tile (paint a lip on its south half)
  palette?: Partial<GroundPalette>;
  /** optional large-scale mottling of grass (arena art direction): patches darker and lighter than the base, about
   *  `scale` tiles across, with dithered borders so the ground never reads as one flat colour. Off when absent. */
  macro?: { dark: RGB; light: RGB; scale: number; amount: number; seed: number };
  /** optional per-tile shade 0..1 (0 = none): the ground darkens toward a cool shadow colour in two dithered steps,
   *  e.g. along a forest edge so walls sit in their own shade. Off when absent. */
  shade?: Float32Array;
  shadeCol?: RGB;
}

/** 4x4 ordered-dither threshold (0..1) */
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16);
const bayer = (x: number, y: number) => BAYER[(y & 3) * 4 + (x & 3)];
/** smooth value noise in [0, 1] in units of `scale` pixels; lattice hashes are computed once per field */
function noiseField(w: number, h: number, scale: number, seed: number) {
  const LW = Math.ceil(w / scale) + 2, LH = Math.ceil(h / scale) + 2, L = new Float32Array(LW * LH);
  for (let j = 0; j < LH; j++) for (let i = 0; i < LW; i++) L[j * LW + i] = h2(i, j, seed);
  return (x: number, y: number) => {
    const fx = x / scale, fy = y / scale, i = Math.floor(fx), j = Math.floor(fy);
    let u = fx - i, v = fy - j; u = u * u * (3 - 2 * u); v = v * v * (3 - 2 * v);
    const k = j * LW + i, a = L[k], b = L[k + 1], c = L[k + LW], d = L[k + LW + 1];
    return a * (1 - u) * (1 - v) + b * u * (1 - v) + c * (1 - u) * v + d * u * v;
  };
}

/** two-tuft layouts per 16 px tile: [x0, y0, x1, y1] of each tuft's top-left */
const TUFTS: number[][] = [[2, 3, 9, 10], [9, 2, 3, 9], [5, 5, 11, 11, 1, 12]];

function mix(a: RGB, b: RGB, t: number): RGB { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }

export function paintGround(g: GroundInput): Pix {
  const C = { ...DEFAULT_GROUND, ...(g.palette ?? {}) };
  const n1 = g.macro ? noiseField(g.w * 16, g.h * 16, g.macro.scale * 16, g.macro.seed) : null;
  const n2 = g.macro ? noiseField(g.w * 16, g.h * 16, g.macro.scale * 16 * 0.37, g.macro.seed + 1) : null;
  // tiles whose 3x3 neighbourhood holds any shade (the bilinear sample is zero everywhere else)
  let shaded: Uint8Array | null = null;
  if (g.shade) {
    shaded = new Uint8Array(g.w * g.h);
    for (let ty = 0; ty < g.h; ty++) for (let tx = 0; tx < g.w; tx++) {
      let any = 0;
      for (let dy = -1; dy <= 1 && !any; dy++) for (let dx = -1; dx <= 1; dx++) { const a = Math.max(0, Math.min(g.w - 1, tx + dx)), b = Math.max(0, Math.min(g.h - 1, ty + dy)); if (g.shade[b * g.w + a] > 0) { any = 1; break; } }
      shaded[ty * g.w + tx] = any;
    }
  }
  const W = g.w * 16, H = g.h * 16;
  const pix = new Pix(W, H);
  const at = (tx: number, ty: number) => {
    tx = Math.max(0, Math.min(g.w - 1, tx)); ty = Math.max(0, Math.min(g.h - 1, ty));
    return g.terrain[ty * g.w + tx];
  };
  // smoothed indicator of a terrain set at pixel (px, py): the per-tile indicator is blurred with
  // a 3x3 kernel, then sampled bilinearly between tile centres. The blur turns tile staircases on
  // diagonal paths and shores into smooth curves (HGSS edges), while straight runs stay straight.
  const blurCache = new Map<(t: number) => boolean, Float32Array>();
  const blurred = (test: (t: number) => boolean) => {
    let b = blurCache.get(test);
    if (b) return b;
    const raw = new Float32Array(g.w * g.h);
    for (let ty = 0; ty < g.h; ty++) for (let tx = 0; tx < g.w; tx++) raw[ty * g.w + tx] = +test(at(tx, ty));
    b = new Float32Array(g.w * g.h);
    const K = [1, 2, 1];
    for (let ty = 0; ty < g.h; ty++) for (let tx = 0; tx < g.w; tx++) {
      let acc = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const x = Math.max(0, Math.min(g.w - 1, tx + dx)), y = Math.max(0, Math.min(g.h - 1, ty + dy));
        acc += raw[y * g.w + x] * K[dx + 1] * K[dy + 1];
      }
      // keep fully interior / exterior tiles exact so narrow features never vanish
      const own = raw[ty * g.w + tx];
      b[ty * g.w + tx] = own ? Math.max(0.62, acc / 16) : Math.min(0.38, acc / 16);
    }
    blurCache.set(test, b);
    return b;
  };
  const smooth = (px: number, py: number, test: (t: number) => boolean, noise: number) => {
    const B = blurred(test);
    const fx = (px + 0.5) / 16 - 0.5, fy = (py + 0.5) / 16 - 0.5;
    const i = Math.floor(fx), j = Math.floor(fy);
    let u = fx - i, v = fy - j;
    u = u * u * (3 - 2 * u); v = v * v * (3 - 2 * v);
    const sb = (x: number, y: number) => B[Math.max(0, Math.min(g.h - 1, y)) * g.w + Math.max(0, Math.min(g.w - 1, x))];
    const val = sb(i, j) * (1 - u) * (1 - v) + sb(i + 1, j) * u * (1 - v) + sb(i, j + 1) * (1 - u) * v + sb(i + 1, j + 1) * u * v;
    return val + (h2(px >> 1, py >> 1, 9) - 0.5) * noise;
  };
  const isPath = (t: number) => t === T.path || t === T.dirt;
  const isStone = (t: number) => t === T.stone;
  const isSand = (t: number) => t === T.sand;
  const isWater = (t: number) => t === T.water;
  const isFloor = (t: number) => t === T.floor || t === T.tatami || t === T.void;

  // tiles whose 3x3 neighbourhood is one terrain need no transition maths (most of a map)
  const uni = new Uint8Array(g.w * g.h);
  for (let ty = 0; ty < g.h; ty++)
    for (let tx = 0; tx < g.w; tx++) {
      const t0 = at(tx, ty);
      let same = 1;
      for (let dy = -1; dy <= 1 && same; dy++) for (let dx = -1; dx <= 1; dx++) if (at(tx + dx, ty + dy) !== t0) { same = 0; break; }
      uni[ty * g.w + tx] = same;
    }
  const uniAt = (x: number, y: number) => uni[(y >> 4) * g.w + (x >> 4)] === 1;
  // classify every pixel first
  const cls = new Uint8Array(W * H);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const own = at(x >> 4, y >> 4);
      if (uniAt(x, y)) { cls[y * W + x] = own === T.dirt ? T.dirt : own; continue; }
      let c: number = T.grass;
      if (isFloor(own)) c = own;
      else if (own === T.wood) c = T.wood;
      else {
        if (own === T.tall) c = T.tall;
        if (own === T.flowerbed) c = T.flowerbed;
        if (smooth(x, y, isSand, 0.08) > 0.5) c = T.sand;
        if (smooth(x, y, isPath, 0.06) > 0.5) c = at(x >> 4, y >> 4) === T.dirt ? T.dirt : T.path;
        if (smooth(x, y, isStone, 0.08) > 0.5) c = T.stone;
        if (smooth(x, y, isWater, 0.06) > 0.55) c = T.water;
      }
      cls[y * W + x] = c;
    }
  const clsAt = (x: number, y: number) => cls[Math.max(0, Math.min(H - 1, y)) * W + Math.max(0, Math.min(W - 1, x))];
  const near = (x: number, y: number, t: number, r: number) => {
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (Math.abs(dx) + Math.abs(dy) <= r && clsAt(x + dx, y + dy) === t) return true;
    return false;
  };

  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const c = cls[y * W + x];
      let col: RGB;
      switch (c) {
        case T.grass: case T.tall: case T.flowerbed: {
          col = C.grass;
          if (g.macro && c === T.grass) {
            // two octaves of value noise, quantised into dark / base / light with an ordered-dither border band
            const M = g.macro;
            const n = n1!(x, y) * 0.7 + n2!(x, y) * 0.3;
            const b = (bayer(x, y) - 0.5) * 0.06;
            if (n + b < 0.5 - M.amount) col = M.dark;
            else if (n + b > 0.5 + M.amount) col = M.light;
          }
          if (c === T.tall) col = C.tallBase;
          if (c === T.flowerbed) col = mix(C.grass, C.flowerbed, 0.6);
          // HGSS-style ground: one flat base with a sparse, regular tuft motif. Each 16 px tile
          // gets one of three fixed two-tuft layouts, or none (about 40 % of tiles stay plain).
          const lx = x & 15, ly = y & 15, pick = h2(x >> 4, y >> 4, 3);
          if (pick < 0.72) {
            const L = TUFTS[Math.floor(pick / 0.24)];
            for (let k = 0; k < L.length; k += 2) {
              const tx = lx - L[k], ty = ly - L[k + 1];
              // zigzag tuft  . # . # .  over  # . # . #
              if (ty === 0 && (tx === 1 || tx === 3)) col = c === T.tall ? C.tallD : C.grassD;
              else if (ty === 1 && (tx === 0 || tx === 2 || tx === 4)) col = c === T.tall ? C.tallD : C.grassD;
              else if (ty === -1 && tx === 1 && c !== T.tall) col = C.grassL;
            }
          }
          break;
        }
        case T.path: case T.dirt: {
          const dirt = c === T.dirt;
          col = dirt ? C.dirt : C.path;
          // a few soft pebbles, never noise
          const pb = h2(x >> 2, y >> 2, 6);
          if (pb < 0.025 && (x & 3) < 2 && (y & 3) === 1) col = dirt ? C.dirtD : C.pathD;
          else if (pb > 0.985 && (x & 3) === 1 && (y & 3) === 1) col = C.pathL;
          const inner = uniAt(x, y) && (x & 15) > 2 && (x & 15) < 13 && (y & 15) > 2 && (y & 15) < 13;
          if (!inner) {
            const up1 = clsAt(x, y - 1), up2 = clsAt(x, y - 2);
            const grassy = (t: number) => t === T.grass || t === T.tall || t === T.flowerbed;
            if (clsNot(x, y, c, 1)) col = C.pathEdge; // one soft border pixel
            else if (clsNot(x, y, c, 2)) col = mix(col, C.pathD, 0.5);
            // grass blades overhang the path's north edge
            if (grassy(up1) && (x % 3) !== 1) col = (x % 3) === 0 ? C.grass : C.grassD;
            else if (grassy(up2) && (x % 3) === 0) col = C.grassD;
          }
          break;
        }
        case T.stone: {
          // offset paving stones 8x8 with mortar, per-stone shade
          const row = y >> 3;
          const xo = x + (row & 1) * 4;
          const sx = xo >> 3;
          const lx = xo & 7, ly = y & 7;
          const shade = h2(sx, row, 7);
          col = shade < 0.33 ? C.stoneD : shade > 0.8 ? C.stoneL : C.stone;
          if (lx === 0 || ly === 0) col = C.mortar;
          else if (lx === 1 || ly === 1) col = mix(col, C.stoneL, 0.5);
          if (clsNot(x, y, T.stone, 1)) col = C.mortar;
          break;
        }
        case T.sand: col = (h2(x >> 2, y >> 2, 12) < 0.05 && (x & 1) === 0) ? C.sandD : C.sand; if (clsNot(x, y, T.sand, 1)) col = C.sandD; break;
        case T.water: col = C.water; break;
        case T.wood: {
          // planks run across the direction of travel
          const tx = x >> 4, ty = y >> 4;
          const horizontal = at(tx - 1, ty) === T.wood || at(tx + 1, ty) === T.wood;
          const a = horizontal ? x & 7 : y & 7, b = horizontal ? y : x;
          col = a === 0 ? C.woodLine : a === 1 ? C.woodL : a === 7 ? C.woodD : C.wood;
          if (((b + (horizontal ? x >> 3 : y >> 3) * 5) & 15) === 0 && a > 1 && a < 7) col = C.woodD;
          break;
        }
        case T.floor: {
          const ly = y & 7;
          col = ly === 7 ? C.floorLine : ly === 6 ? C.floorD : C.floor;
          if (((x + (y >> 3) * 11) % 24) === 0) col = C.floorLine;
          break;
        }
        case T.tatami: {
          const lx = x & 31, ly = y & 15;
          col = (x >> 2) % 2 ? C.tatami : C.tatamiD;
          if (lx < 2 || ly < 1) col = C.tatamiEdge;
          break;
        }
        default: col = [16, 16, 24];
      }
      if (shaded && c !== T.water && shaded[(y >> 4) * g.w + (x >> 4)]) {
        // cool shade in two steps, dithered between them (pixel-art banding, never a smooth gradient)
        const sv = sampleShade(g, x, y);
        if (sv > 0.02) {
          const sc = g.shadeCol ?? [40, 60, 70];
          const step = sv + (bayer(x, y) - 0.5) * 0.25;
          const k = step > 0.66 ? 0.34 : step > 0.33 ? 0.18 : 0;
          if (k) col = mix(col, sc, k);
        }
      }
      pix.set(x, y, col);
    }

  // small painted ground flowers
  if (g.dots) for (let ty = 0; ty < g.h; ty++) for (let tx = 0; tx < g.w; tx++) {
    if (!g.dots[ty * g.w + tx]) continue;
    for (let k = 0; k < 3; k++) {
      const x = tx * 16 + 3 + Math.floor(h2(tx, ty, k) * 10), y = ty * 16 + 3 + Math.floor(h2(ty, tx, k + 9) * 10);
      const petal = C.dots[Math.floor(h2(tx, ty, k + 20) * C.dots.length)];
      pix.set(x - 1, y, petal); pix.set(x + 1, y, petal); pix.set(x, y - 1, petal); pix.set(x, y + 1, petal);
      pix.set(x, y, C.dotCore);
    }
  }
  // ledge lips: rounded dirt overhang along the south of ledge tiles
  if (g.ledge) for (let ty = 0; ty < g.h; ty++) for (let tx = 0; tx < g.w; tx++) {
    if (!g.ledge[ty * g.w + tx]) continue;
    for (let x = 0; x < 16; x++) {
      const bump = Math.round(1 + Math.sin((tx * 16 + x) * 0.6) * 1);
      for (let y = 10 - bump; y < 16; y++) pix.set(tx * 16 + x, ty * 16 + y, y === 10 - bump ? C.grassEdge : y < 13 ? C.lipA : C.lipB);
    }
  }
  return pix;

  function clsNot(x: number, y: number, t: number, r: number) {
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (Math.abs(dx) + Math.abs(dy) !== r) continue;
      const o = clsAt(x + dx, y + dy);
      if (o !== t && !(t === T.path && o === T.dirt) && !(t === T.dirt && o === T.path) && o !== T.water) return true;
    }
    return false;
  }
}

/** bilinear per-tile shade at pixel (x, y) */
function sampleShade(g: GroundInput, x: number, y: number) {
  const S = g.shade!, W = g.w, H = g.h;
  const fx = (x + 0.5) / 16 - 0.5, fy = (y + 0.5) / 16 - 0.5, i = Math.floor(fx), j = Math.floor(fy), u = fx - i, v = fy - j;
  const i0 = i < 0 ? 0 : i >= W ? W - 1 : i, i1 = i + 1 >= W ? W - 1 : i + 1 < 0 ? 0 : i + 1;
  const j0 = (j < 0 ? 0 : j >= H ? H - 1 : j) * W, j1 = (j + 1 >= H ? H - 1 : j + 1 < 0 ? 0 : j + 1) * W;
  return S[j0 + i0] * (1 - u) * (1 - v) + S[j0 + i1] * u * (1 - v) + S[j1 + i0] * (1 - u) * v + S[j1 + i1] * u * v;
}

/** Cliff face texture: 32x16 per unit of height, rocky strata. */
export interface CliffPalette { base: RGB; dark: RGB; deep: RGB; light: RGB; lipA: RGB; lipB: RGB }
export function paintCliff(kind: 'rock' | 'ledge' | 'bank' | 'snow' = 'rock', pal?: Partial<CliffPalette>): Pix {
  const p = new Pix(32, 16);
  const base = pal?.base ?? (kind === 'bank' ? hex('#c8b88a') : hex('#b8966c'));
  const dark = pal?.dark ?? (kind === 'bank' ? hex('#a89868') : hex('#8e6e4c'));
  const deep = pal?.deep ?? (kind === 'bank' ? hex('#887848') : hex('#664c34'));
  const light = pal?.light ?? (kind === 'bank' ? hex('#e4d8a8') : hex('#dcc094'));
  const lipA = pal?.lipA ?? hex('#5aa844'), lipB = pal?.lipB ?? hex('#3c8a3a');
  // texture v spans one metre per 16 px; horizontal strata 4 px tall with a lit top row and
  // a dark crack under each band (HGSS rock faces), staggered joints so bands don't tile visibly
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 32; x++) {
      let c = base;
      const band = y >> 2, ly = y & 3;
      const jx = (x + Math.floor(h2(band, 0, 3) * 32)) % 32;
      if (ly === 0) c = light;
      else if (ly === 3) c = dark;
      if (ly === 3 && h2(x >> 1, band, 8) < 0.35) c = deep;
      if (jx % 11 === 0 && ly > 0) c = deep;
      else if (jx % 11 === 1 && ly > 0 && ly < 3) c = mix(base, light, 0.5);
      if (kind === 'bank') { c = ly === 0 ? light : ly === 3 ? dark : base; if ((x + band * 3) % 7 === 0 && ly > 0) c = dark; }
      if (kind === 'ledge') { c = y < 2 ? lipA : y < 3 ? lipB : y === 3 ? light : (y & 3) === 3 ? dark : base; if (y > 3 && (x + (y >> 2) * 5) % 9 === 0) c = dark; }
      p.set(x, y, c);
    }
  return p;
}

/** Water: 4 animation frames of a 32x32 tile, laid out horizontally (128x32). */
export interface WaterPalette { base: RGB; light: RGB; foam: RGB; dark: RGB }
export function paintWater(pal?: Partial<WaterPalette>): Pix {
  const p = new Pix(128, 32);
  const base = pal?.base ?? hex('#4c94e8'), light = pal?.light ?? hex('#8cc4f8'), foam = pal?.foam ?? hex('#e6f6ff'), dark = pal?.dark ?? hex('#3a7ad0');
  // clean surface with drifting ripple lines (two per 16 px), a light crest on some of them
  for (let f = 0; f < 4; f++)
    for (let y = 0; y < 32; y++)
      for (let x = 0; x < 32; x++) {
        let c = base;
        for (let k = 0; k < 4; k++) {
          const wy = k * 8 + 2 + (k & 1) * 3;
          const wx = (Math.floor(h2(k, 0, 7) * 32) + f * 2 * (k & 1 ? -1 : 1) + 64) % 32;
          const dx = (x - wx + 32) % 32;
          if (y === wy && dx < 7) c = dx === 0 || dx === 6 ? light : k === 1 && dx > 1 && dx < 5 ? foam : light;
          if (y === wy + 1 && dx > 1 && dx < 6) c = dark;
        }
        p.set(f * 32 + x, y, c);
      }
  return p;
}

/** Stairs texture (16x16 per tile): stone steps. */
export function paintStairs(): Pix {
  const p = new Pix(16, 16);
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) {
      const ly = y & 3;
      const c = ly === 0 ? hex('#f2eee2') : ly === 3 ? hex('#7e7a6c') : ly === 2 ? hex('#b4b0a2') : hex('#d4d0c2');
      p.set(x, y, x === 0 || x === 15 ? hex('#7e7a6c') : c);
    }
  return p;
}
