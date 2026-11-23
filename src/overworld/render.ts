// The texture atlas the match renderer's tile stage packs its painted tiles into (src/render/tilestage.ts). The
// Maplebrook overworld's renderer that once lived here went with the overworld (tag maplebrook-final); this file is
// one of the tile stage's painters and is deleted with it (docs/OVERHAUL_3D.md, X1b).

export class Atlas {
  canvas = document.createElement('canvas');
  ctx: CanvasRenderingContext2D;
  map = new Map<string, { x: number; y: number; w: number; h: number }>();
  private sx = 1; private sy = 1; private rowH = 0;
  constructor(public size = 2048) {
    this.canvas.width = this.canvas.height = size;
    this.ctx = this.canvas.getContext('2d')!;
  }
  add(key: string, src: ImageData | HTMLCanvasElement) {
    const w = src.width, h = src.height;
    if (this.sx + w + 1 > this.size) { this.sx = 1; this.sy += this.rowH + 1; this.rowH = 0; }
    if (src instanceof ImageData) this.ctx.putImageData(src, this.sx, this.sy); else this.ctx.drawImage(src, this.sx, this.sy);
    this.map.set(key, { x: this.sx, y: this.sy, w, h });
    this.sx += w + 1; this.rowH = Math.max(this.rowH, h);
  }
  uv(key: string, cx = 0, cy = 0, cw?: number, ch?: number) {
    const e = this.map.get(key);
    if (!e) throw new Error('atlas: missing ' + key);
    const w = cw ?? e.w, h = ch ?? e.h;
    const x = e.x + cx * w, y = e.y + cy * h;
    return [x / this.size, y / this.size, (x + w) / this.size, (y + h) / this.size];
  }
  has(key: string) { return this.map.has(key); }
}
