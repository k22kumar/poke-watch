// Pixel painter: draws sprites into a region buffer (each pixel = palette ramp id), then
// shades each region DS-style (lit top-left, shaded bottom-right) and adds a 1px outline.
// Everything the overworld shows is painted by these helpers at load — no image files.

export type RGB = [number, number, number];
export const hex = (h: string): RGB => {
  const n = parseInt(h.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

/** A ramp: [highlight, base, shade, deep shade] */
export type Ramp = [string, string, string, string?];

export class Sprite {
  w: number; h: number;
  /** region id per pixel (0 = empty) */
  id: Uint8Array;
  /** explicit colour override per pixel (0 = none) */
  ink: Uint32Array;
  ramps: Ramp[] = [['#000', '#000', '#000']];
  outline = '#282830';
  constructor(w: number, h: number) {
    this.w = w; this.h = h;
    this.id = new Uint8Array(w * h);
    this.ink = new Uint32Array(w * h);
  }
  ramp(r: Ramp): number { this.ramps.push(r); return this.ramps.length - 1; }
  px(x: number, y: number, r: number) {
    x = Math.round(x); y = Math.round(y);
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    this.id[y * this.w + x] = r;
    this.ink[y * this.w + x] = 0;
  }
  /** force an exact colour (eyes, highlights, details) */
  dot(x: number, y: number, color: string) {
    x = Math.round(x); y = Math.round(y);
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const [r, g, b] = hex(color);
    this.ink[y * this.w + x] = 0xff000000 | (b << 16) | (g << 8) | r;
    if (!this.id[y * this.w + x]) this.id[y * this.w + x] = 255;
  }
  rect(x: number, y: number, w: number, h: number, r: number) {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.px(x + i, y + j, r);
  }
  /** filled ellipse centred at (cx,cy) with radii rx, ry (pixel-snapped) */
  ellipse(cx: number, cy: number, rx: number, ry: number, r: number) {
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++)
      for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
        const dx = (x + 0.5 - cx) / rx, dy = (y + 0.5 - cy) / ry;
        if (dx * dx + dy * dy <= 1) this.px(x, y, r);
      }
  }
  line(x0: number, y0: number, x1: number, y1: number, r: number) {
    const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
    for (let k = 0; k <= n; k++) this.px(x0 + ((x1 - x0) * k) / n, y0 + ((y1 - y0) * k) / n, r);
  }
  dline(x0: number, y0: number, x1: number, y1: number, color: string) {
    const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
    for (let k = 0; k <= n; k++) this.dot(x0 + ((x1 - x0) * k) / n, y0 + ((y1 - y0) * k) / n, color);
  }
  get(x: number, y: number) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return 0;
    return this.id[y * this.w + x];
  }
  clear(x: number, y: number) { if (x >= 0 && y >= 0 && x < this.w && y < this.h) { this.id[y * this.w + x] = 0; this.ink[y * this.w + x] = 0; } }

  /**
   * Render to RGBA. Shading: a pixel whose lower-right neighbour leaves its region is
   * shaded; a pixel whose upper-left neighbour leaves it is highlighted (light from top-left).
   */
  render(opts: { outline?: boolean; shade?: boolean; outlineInside?: boolean } = {}): ImageData {
    const { outline = true, shade = true } = opts;
    const W = this.w, H = this.h;
    const img = new ImageData(W, H);
    const d = img.data;
    const cache = this.ramps.map((r) => r.map((c) => (c ? hex(c) : null)));
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        const r = this.id[i];
        if (!r) continue;
        let col: RGB;
        if (this.ink[i]) { const v = this.ink[i]; col = [v & 255, (v >> 8) & 255, (v >> 16) & 255]; }
        else {
          const ramp = cache[r]!;
          let k = 1;
          if (shade) {
            const br = this.get(x + 1, y) !== r || this.get(x, y + 1) !== r;
            const br2 = this.get(x + 2, y) !== r || this.get(x, y + 2) !== r;
            const tl = this.get(x - 1, y) !== r || this.get(x, y - 1) !== r;
            if (br) k = ramp[3] ? 3 : 2;
            else if (br2) k = 2;
            else if (tl) k = 0;
          }
          col = (ramp[k] ?? ramp[1]) as RGB;
        }
        d[i * 4] = col[0]; d[i * 4 + 1] = col[1]; d[i * 4 + 2] = col[2]; d[i * 4 + 3] = 255;
      }
    if (outline) {
      const o = hex(this.outline);
      const src = new Uint8Array(W * H);
      for (let i = 0; i < W * H; i++) src[i] = d[i * 4 + 3] ? 1 : 0;
      for (let y = 0; y < H; y++)
        for (let x = 0; x < W; x++) {
          const i = y * W + x;
          if (src[i]) continue;
          const n = (x > 0 && src[i - 1]) || (x < W - 1 && src[i + 1]) || (y > 0 && src[i - W]) || (y < H - 1 && src[i + W]);
          if (n) { d[i * 4] = o[0]; d[i * 4 + 1] = o[1]; d[i * 4 + 2] = o[2]; d[i * 4 + 3] = 255; }
        }
    }
    return img;
  }
}

/** Raw RGBA canvas helpers for tiles / ground painting. */
export class Pix {
  w: number; h: number; d: Uint8ClampedArray; img: ImageData;
  constructor(w: number, h: number) { this.w = w; this.h = h; this.img = new ImageData(w, h); this.d = this.img.data; }
  set(x: number, y: number, c: RGB, a = 255) {
    x |= 0; y |= 0;
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const i = (y * this.w + x) * 4;
    this.d[i] = c[0]; this.d[i + 1] = c[1]; this.d[i + 2] = c[2]; this.d[i + 3] = a;
  }
  get(x: number, y: number): RGB {
    x = Math.max(0, Math.min(this.w - 1, x | 0)); y = Math.max(0, Math.min(this.h - 1, y | 0));
    const i = (y * this.w + x) * 4;
    return [this.d[i], this.d[i + 1], this.d[i + 2]];
  }
  alpha(x: number, y: number) { if (x < 0 || y < 0 || x >= this.w || y >= this.h) return 0; return this.d[(y * this.w + x) * 4 + 3]; }
  fill(x: number, y: number, w: number, h: number, c: RGB) { for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.set(x + i, y + j, c); }
  blit(src: ImageData, dx: number, dy: number, flip = false) {
    for (let y = 0; y < src.height; y++)
      for (let x = 0; x < src.width; x++) {
        const sx = flip ? src.width - 1 - x : x;
        const si = (y * src.width + sx) * 4;
        if (src.data[si + 3] < 128) continue;
        this.set(dx + x, dy + y, [src.data[si], src.data[si + 1], src.data[si + 2]]);
      }
  }
  canvas(): HTMLCanvasElement {
    const c = document.createElement('canvas');
    c.width = this.w; c.height = this.h;
    c.getContext('2d')!.putImageData(this.img, 0, 0);
    return c;
  }
}

/** deterministic hash noise for painting */
export function h2(x: number, y: number, s = 0): number {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(s | 0, 982451653)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

export function imageToCanvas(img: ImageData): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = img.width; c.height = img.height;
  c.getContext('2d')!.putImageData(img, 0, 0);
  return c;
}
