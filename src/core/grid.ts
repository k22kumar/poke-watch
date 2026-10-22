// Uniform-grid spatial index rebuilt every tick by counting sort (as in PokéBonk:
// counts / starts / items / cellOf flat Int32Arrays). Allocation-free after construction.

export class Grid {
  readonly cell: number;
  readonly extent: number; // world spans [-extent/2, extent/2]
  readonly dim: number;
  private counts: Int32Array;
  private starts: Int32Array;
  private items: Int32Array;
  private cellOf: Int32Array;
  readonly result: Int32Array;
  resultCount = 0;

  constructor(extent: number, cell: number, capacity: number) {
    this.cell = cell;
    this.extent = extent;
    this.dim = Math.ceil(extent / cell);
    this.counts = new Int32Array(this.dim * this.dim);
    this.starts = new Int32Array(this.dim * this.dim + 1);
    this.items = new Int32Array(capacity);
    this.cellOf = new Int32Array(capacity);
    this.result = new Int32Array(capacity);
  }

  cellIndex(x: number, z: number): number {
    const h = this.extent / 2;
    let cx = Math.floor((x + h) / this.cell);
    let cz = Math.floor((z + h) / this.cell);
    if (cx < 0) cx = 0; else if (cx >= this.dim) cx = this.dim - 1;
    if (cz < 0) cz = 0; else if (cz >= this.dim) cz = this.dim - 1;
    return cz * this.dim + cx;
  }

  /** alive[i] != 0 marks live entries among 0..n-1 */
  rebuild(n: number, xs: Float32Array, zs: Float32Array, alive: Uint8Array) {
    const counts = this.counts;
    counts.fill(0);
    for (let i = 0; i < n; i++) {
      if (!alive[i]) { this.cellOf[i] = -1; continue; }
      const c = this.cellIndex(xs[i], zs[i]);
      this.cellOf[i] = c;
      counts[c]++;
    }
    let acc = 0;
    for (let c = 0; c < counts.length; c++) {
      this.starts[c] = acc;
      acc += counts[c];
      counts[c] = 0;
    }
    this.starts[counts.length] = acc;
    for (let i = 0; i < n; i++) {
      const c = this.cellOf[i];
      if (c < 0) continue;
      this.items[this.starts[c] + counts[c]++] = i;
    }
  }

  /** Collect candidates in cells overlapping the circle into this.result. Returns count. */
  query(x: number, z: number, r: number): number {
    const h = this.extent / 2;
    const x0 = Math.max(0, Math.floor((x - r + h) / this.cell));
    const x1 = Math.min(this.dim - 1, Math.floor((x + r + h) / this.cell));
    const z0 = Math.max(0, Math.floor((z - r + h) / this.cell));
    const z1 = Math.min(this.dim - 1, Math.floor((z + r + h) / this.cell));
    let n = 0;
    for (let cz = z0; cz <= z1; cz++) {
      for (let cx = x0; cx <= x1; cx++) {
        const c = cz * this.dim + cx;
        const s = this.starts[c], e = this.starts[c + 1];
        for (let k = s; k < e; k++) this.result[n++] = this.items[k];
      }
    }
    this.resultCount = n;
    return n;
  }
}
