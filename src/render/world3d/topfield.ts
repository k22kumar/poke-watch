// The top field: the highest render surface over each cell of a 0.5 m plan grid, from a WorldModel's chunks. The
// renderer's load-time bakes (sky visibility, the lamp channel's confinement, the vertical gradient) read it; it is
// render data built at load (WORLDGEN3D Q23 "Sky visibility and the lamp channel are computed by the renderer at
// load"), never a model field. No three: Node tests build it.
import type { SurfaceChunk, WorldModel } from '../../world/model';

export class TopField {
  readonly x0: number; readonly z0: number; readonly nx: number; readonly nz: number;
  /** highest surface y per cell (−∞: nothing drawn there) */
  readonly top: Float32Array;
  /** lowest surface y per cell */
  readonly low: Float32Array;
  constructor(readonly cell: number, minX: number, minZ: number, maxX: number, maxZ: number) {
    this.x0 = minX; this.z0 = minZ;
    this.nx = Math.max(1, Math.ceil((maxX - minX) / cell)); this.nz = Math.max(1, Math.ceil((maxZ - minZ) / cell));
    this.top = new Float32Array(this.nx * this.nz).fill(-Infinity);
    this.low = new Float32Array(this.nx * this.nz).fill(Infinity);
  }
  private idx(x: number, z: number): number {
    const i = Math.floor((x - this.x0) / this.cell), j = Math.floor((z - this.z0) / this.cell);
    return i < 0 || j < 0 || i >= this.nx || j >= this.nz ? -1 : j * this.nx + i;
  }
  /** the highest surface over (x, z), −∞ outside the field */
  at(x: number, z: number): number { const k = this.idx(x, z); return k < 0 ? -Infinity : this.top[k]; }
  lowAt(x: number, z: number): number { const k = this.idx(x, z); return k < 0 ? Infinity : this.low[k]; }
  private put(k: number, y: number) { if (y > this.top[k]) this.top[k] = y; if (y < this.low[k]) this.low[k] = y; }

  /** rasterise one chunk's triangles: every cell centre inside a triangle's plan takes its height there, and every
   *  vertex its own cell (so vertical faces, which have no plan area, still mark their top edge) */
  add(c: SurfaceChunk) {
    const P = c.positions, I = c.indices, s = this.cell;
    for (let v = 0; v < P.length; v += 3) { const k = this.idx(P[v], P[v + 2]); if (k >= 0) this.put(k, P[v + 1]); }
    for (let t = 0; t < I.length; t += 3) {
      const a = I[t] * 3, b = I[t + 1] * 3, d = I[t + 2] * 3;
      const ax = P[a], az = P[a + 2], bx = P[b], bz = P[b + 2], cx = P[d], cz = P[d + 2];
      const den = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
      if (Math.abs(den) < 1e-9) continue; // vertical: no plan area
      const i0 = Math.max(0, Math.floor((Math.min(ax, bx, cx) - this.x0) / s)), i1 = Math.min(this.nx - 1, Math.floor((Math.max(ax, bx, cx) - this.x0) / s));
      const j0 = Math.max(0, Math.floor((Math.min(az, bz, cz) - this.z0) / s)), j1 = Math.min(this.nz - 1, Math.floor((Math.max(az, bz, cz) - this.z0) / s));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const px = this.x0 + (i + 0.5) * s, pz = this.z0 + (j + 0.5) * s;
        const w0 = ((bz - cz) * (px - cx) + (cx - bx) * (pz - cz)) / den, w1 = ((cz - az) * (px - cx) + (ax - cx) * (pz - cz)) / den, w2 = 1 - w0 - w1;
        if (w0 < -1e-6 || w1 < -1e-6 || w2 < -1e-6) continue;
        this.put(j * this.nx + i, w0 * P[a + 1] + w1 * P[b + 1] + w2 * P[d + 1]);
      }
    }
  }

  static of(model: WorldModel, cell = 0.5): TopField {
    const b = model.bounds;
    const f = new TopField(cell, b.min[0], b.min[2], b.max[0], b.max[2]);
    for (const c of model.surfaces) f.add(c);
    return f;
  }
}
