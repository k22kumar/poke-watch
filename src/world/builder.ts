// Small authoring API for arenas: paint terrain, raise plateaus, cut stairs, plant trees,
// scatter decoration. Everything is deterministic (hash-based), so a layout is the same
// on every load — arenas are designed, not rolled.
import { datan2, dcos, dsin } from '../core/detmath';
import { PROP_RULES, T, type ArenaMap, type ArenaPropKind } from './tiles';

/** deterministic 0..1 hash of integers */
export function hash3(a: number, b: number, c = 0): number {
  let h = Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263) + Math.imul(c | 0, 982451653) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

export class ArenaBuilder {
  m: ArenaMap;
  constructor(id: string, name: string, w: number, h: number) {
    const n = w * h;
    this.m = {
      id, name, w, h,
      terrain: new Uint8Array(n).fill(T.grass), elev: new Float32Array(n), stairs: new Uint8Array(n),
      dots: new Uint8Array(n), ledge: new Uint8Array(n), wall: new Uint8Array(n), platform: new Float32Array(n),
      props: [], spawn: [w >> 1, h >> 1], bossSpot: [w >> 1, h >> 1], chestSpots: [], landmarks: [],
    };
  }
  in(x: number, y: number) { return x >= 0 && y >= 0 && x < this.m.w && y < this.m.h; }
  i(x: number, y: number) { return y * this.m.w + x; }
  get(x: number, y: number) { return this.in(x, y) ? this.m.terrain[this.i(x, y)] : -1; }

  rect(x: number, y: number, w: number, h: number, t: number) {
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) if (this.in(i, j)) this.m.terrain[this.i(i, j)] = t;
    return this;
  }
  /** filled ellipse of terrain; `wobble` roughens the edge (tiles) */
  blob(cx: number, cy: number, rx: number, ry: number, t: number, wobble = 0, seed = 1) {
    for (let j = Math.floor(cy - ry - wobble - 1); j <= cy + ry + wobble + 1; j++)
      for (let i = Math.floor(cx - rx - wobble - 1); i <= cx + rx + wobble + 1; i++) {
        if (!this.in(i, j)) continue;
        const a = datan2(j + 0.5 - cy, i + 0.5 - cx);
        const w = wobble * (dsin(a * 3 + seed) * 0.5 + dsin(a * 5 + seed * 2.3) * 0.3 + (hash3(Math.round(a * 4), seed, 7) - 0.5) * 0.4);
        const dx = (i + 0.5 - cx) / (rx + w), dy = (j + 0.5 - cy) / (ry + w);
        if (dx * dx + dy * dy <= 1) this.m.terrain[this.i(i, j)] = t;
      }
    return this;
  }
  /** polyline path of terrain `t`, `width` tiles wide */
  path(pts: [number, number][], width = 2, t: number = T.path) {
    for (let k = 0; k < pts.length - 1; k++) {
      const [ax, ay] = pts[k], [bx, by] = pts[k + 1];
      const n = Math.max(Math.abs(bx - ax), Math.abs(by - ay)) * 2 + 1;
      for (let s = 0; s <= n; s++) {
        const x = ax + ((bx - ax) * s) / n, y = ay + ((by - ay) * s) / n;
        for (let j = Math.round(y - width / 2); j < Math.round(y - width / 2) + width; j++)
          for (let i = Math.round(x - width / 2); i < Math.round(x - width / 2) + width; i++)
            if (this.in(i, j) && this.m.terrain[this.i(i, j)] !== T.water) this.m.terrain[this.i(i, j)] = t;
      }
    }
    return this;
  }
  /** a river: water along a polyline; bridges are placed later with `bridge` */
  river(pts: [number, number][], width = 3) {
    for (let k = 0; k < pts.length - 1; k++) {
      const [ax, ay] = pts[k], [bx, by] = pts[k + 1];
      const n = Math.max(Math.abs(bx - ax), Math.abs(by - ay)) * 2 + 1;
      for (let s = 0; s <= n; s++) {
        const x = ax + ((bx - ax) * s) / n, y = ay + ((by - ay) * s) / n;
        this.blob(x, y, width / 2, width / 2, T.water);
      }
    }
    return this;
  }
  /** wooden bridge tiles over water in a rectangle */
  bridge(x: number, y: number, w: number, h: number) {
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) if (this.in(i, j) && this.m.terrain[this.i(i, j)] === T.water) this.m.terrain[this.i(i, j)] = T.wood;
    return this;
  }
  /** sand bank ring around water */
  banks(t: number = T.sand, r = 1) {
    const M = this.m;
    const add: number[] = [];
    for (let j = 0; j < M.h; j++) for (let i = 0; i < M.w; i++) {
      const k = this.i(i, j);
      if (M.terrain[k] === T.water || M.terrain[k] === T.wood) continue;
      let near = false;
      for (let dy = -r; dy <= r && !near; dy++) for (let dx = -r; dx <= r && !near; dx++) if (this.get(i + dx, j + dy) === T.water) near = true;
      if (near && M.elev[k] === 0) add.push(k);
    }
    for (const k of add) M.terrain[k] = t;
    return this;
  }
  elevRect(x: number, y: number, w: number, h: number, e: number) {
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) if (this.in(i, j)) this.m.elev[this.i(i, j)] = e;
    return this;
  }
  elevBlob(cx: number, cy: number, rx: number, ry: number, e: number, wobble = 0, seed = 3) {
    for (let j = Math.floor(cy - ry - wobble - 1); j <= cy + ry + wobble + 1; j++)
      for (let i = Math.floor(cx - rx - wobble - 1); i <= cx + rx + wobble + 1; i++) {
        if (!this.in(i, j)) continue;
        const a = datan2(j + 0.5 - cy, i + 0.5 - cx);
        const w = wobble * (dsin(a * 3 + seed) * 0.6 + dcos(a * 2 + seed) * 0.4);
        const dx = (i + 0.5 - cx) / (rx + w), dy = (j + 0.5 - cy) / (ry + w);
        if (dx * dx + dy * dy <= 1) this.m.elev[this.i(i, j)] = Math.max(this.m.elev[this.i(i, j)], e);
      }
    return this;
  }
  /** stairs at (x, y) climbing north: the tile south of it must be low, the tile north high */
  stairs(x: number, y: number, w = 1) {
    for (let i = x; i < x + w; i++) if (this.in(i, y)) { this.m.stairs[this.i(i, y)] = 1; this.m.terrain[this.i(i, y)] = T.stone; }
    return this;
  }
  /** mark painted ledge lips along the north edge of a lower terrace (cosmetic; elevation does the work) */
  ledgeLips() {
    const M = this.m;
    for (let j = 1; j < M.h; j++) for (let i = 0; i < M.w; i++) {
      const a = M.elev[this.i(i, j - 1)], b = M.elev[this.i(i, j)];
      if (a - b > 0.25 && a - b < 0.75 && !M.stairs[this.i(i, j)]) M.ledge[this.i(i, j - 1)] = 1;
    }
    return this;
  }
  dots(x: number, y: number, w: number, h: number, density = 0.4, seed = 1) {
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) {
      if (!this.in(i, j)) continue;
      if (this.m.terrain[this.i(i, j)] !== T.grass) continue;
      if (hash3(i, j, seed) < density) this.m.dots[this.i(i, j)] = 1;
    }
    return this;
  }

  /** can a prop with this footprint go here? (in bounds, dry, flat, not stairs, not blocked) */
  free(x: number, y: number, w: number, h: number, allowPath = false) {
    const M = this.m;
    const e0 = this.in(x, y) ? M.elev[this.i(x, y)] : 0;
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) {
      if (!this.in(i, j)) return false;
      const k = this.i(i, j);
      const t = M.terrain[k];
      if (M.wall[k] || M.platform[k] || M.stairs[k] || t === T.water || t === T.wood) return false;
      if (!allowPath && (t === T.path || t === T.dirt || t === T.stone)) return false;
      if (M.elev[k] !== e0) return false;
    }
    return true;
  }
  prop(kind: ArenaPropKind, x: number, y: number, opts: { variant?: number; text?: string; force?: boolean; allowPath?: boolean } = {}) {
    const R = PROP_RULES[kind];
    const blocking = R.wall || R.platform;
    if (blocking) {
      if (!opts.force && !this.free(x, y, R.w, R.h, opts.allowPath)) return false;
      // even forced props never overlap another blocker
      for (let j = y; j < y + R.h; j++) for (let i = x; i < x + R.w; i++) if (this.in(i, j) && (this.m.wall[this.i(i, j)] || this.m.platform[this.i(i, j)])) return false;
    }
    if (!blocking) {
      if (!this.in(x, y)) return false;
      const k = this.i(x, y), t = this.m.terrain[k];
      if (kind === 'lily' ? t !== T.water : this.m.wall[k] || this.m.platform[k] || t === T.water || t === T.wood || this.m.stairs[k]) return false;
      if (this.m.props.some((p) => p.x === x && p.y === y && !PROP_RULES[p.kind].wall && !PROP_RULES[p.kind].platform)) return false;
    }
    this.m.props.push({ kind, x, y, w: R.w, h: R.h, variant: opts.variant ?? Math.floor(hash3(x, y, 77) * 8), text: opts.text });
    for (let j = y; j < y + R.h; j++) for (let i = x; i < x + R.w; i++) {
      if (!this.in(i, j)) continue;
      const k = this.i(i, j);
      if (R.wall) this.m.wall[k] = 1;
      if (R.platform) this.m.platform[k] = R.platform;
    }
    if (kind === 'tall') this.m.terrain[this.i(x, y)] = T.tall;
    return true;
  }
  /** solid 2x2 tree wall over a rectangle (skips tiles that aren't free) */
  forest(x: number, y: number, w: number, h: number, kinds: ArenaPropKind[] = ['tree', 'tree2']) {
    for (let j = y; j + 1 < y + h + 1; j += 2) for (let i = x; i + 1 < x + w + 1; i += 2) {
      const k = kinds[((i >> 1) * 7 + (j >> 1) * 3) % kinds.length];
      this.prop(k, i, j, { allowPath: true });
    }
    return this;
  }
  /** border forest with an irregular inner edge: `depth` tiles thick plus up to `bulge` more */
  border(depth: number, bulge: number, kinds: ArenaPropKind[], seed = 5, gaps: { x: number; y: number; w: number; h: number }[] = []) {
    const M = this.m;
    const inGap = (i: number, j: number) => gaps.some((g) => i >= g.x && i < g.x + g.w && j >= g.y && j < g.y + g.h);
    // rows aligned to the map edge (no clamped overlaps); alternate rows are staggered by one
    // tile away from the edges so the wall reads as woven canopies, not a lattice
    const cols = (j: number) => { const out: number[] = []; const st = (j >> 1) & 1 && j > 1 && j < M.h - 4; for (let i = 0; i < M.w - 1; i += 2) out.push(st && i > 0 ? i + 1 : i); return out.filter((i) => i <= M.w - 2); };
    for (let j = 0; j < M.h - 1; j += 2) for (const i of cols(j)) {
      const dEdge = Math.min(i, j, M.w - 2 - i, M.h - 2 - j);
      const along = i + j * 3;
      const b = bulge * (0.5 + 0.5 * dsin(along * 0.13 + seed) * dcos(along * 0.07 + seed * 1.7));
      if (dEdge > depth + b) continue;
      if (inGap(i, j)) continue;
      const k = kinds[Math.floor(hash3(i, j, seed) * kinds.length)];
      const R = PROP_RULES[k];
      this.prop(k, Math.max(0, Math.min(M.w - R.w, i)), Math.max(0, Math.min(M.h - R.h, j)), { force: dEdge < 2, allowPath: true });
    }
    return this;
  }
  /** a clump of trees around (cx, cy) */
  clump(cx: number, cy: number, n: number, kinds: ArenaPropKind[], seed = 1, spread = 3) {
    let placed = 0;
    for (let k = 0; k < n * 6 && placed < n; k++) {
      const a = hash3(k, seed, 1) * Math.PI * 2, r = Math.sqrt(hash3(k, seed, 2)) * spread;
      const x = Math.round(cx + dcos(a) * r - 1), y = Math.round(cy + dsin(a) * r * 0.8 - 1);
      if (this.prop(kinds[k % kinds.length], x, y)) placed++;
    }
    return this;
  }
  /** scatter `kind` over an ellipse with density 0..1 */
  scatter(kind: ArenaPropKind | ArenaPropKind[], cx: number, cy: number, rx: number, ry: number, density: number, seed = 1) {
    const kinds = Array.isArray(kind) ? kind : [kind];
    for (let j = Math.floor(cy - ry); j <= cy + ry; j++) for (let i = Math.floor(cx - rx); i <= cx + rx; i++) {
      const dx = (i + 0.5 - cx) / rx, dy = (j + 0.5 - cy) / ry;
      if (dx * dx + dy * dy > 1) continue;
      if (hash3(i, j, seed) >= density) continue;
      this.prop(kinds[Math.floor(hash3(i, j, seed + 11) * kinds.length)], i, j);
    }
    return this;
  }
  /** tall grass patch with a soft, wobbly edge */
  tall(cx: number, cy: number, rx: number, ry: number, seed = 2) {
    for (let j = Math.floor(cy - ry - 1); j <= cy + ry + 1; j++) for (let i = Math.floor(cx - rx - 1); i <= cx + rx + 1; i++) {
      const dx = (i + 0.5 - cx) / rx, dy = (j + 0.5 - cy) / ry;
      const d = dx * dx + dy * dy;
      if (d > 1 + (hash3(i, j, seed) - 0.5) * 0.5) continue;
      if (this.get(i, j) !== T.grass) continue;
      this.prop('tall', i, j);
    }
    return this;
  }
  /** rectangular tall-grass block, corners nibbled for a softer read */
  tallRect(x: number, y: number, w: number, h: number, seed = 3) {
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) {
      const corner = (i === x || i === x + w - 1) && (j === y || j === y + h - 1);
      if (corner && hash3(i, j, seed) < 0.7) continue;
      if (this.get(i, j) !== T.grass) continue;
      this.prop('tall', i, j);
    }
    return this;
  }
  /** a compact flower bed: every tile of the rectangle gets a flower clump */
  flowerBed(x: number, y: number, w: number, h: number, kinds: ArenaPropKind[], seed = 4) {
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) if (this.get(i, j) === T.grass) this.prop(kinds[Math.floor(hash3(i, j, seed) * kinds.length)], i, j);
    return this;
  }
  /** a straight row of 2x2 trees (hedgerow / tree line) from (x, y) stepping by (dx, dy) */
  treeLine(x: number, y: number, n: number, dx: number, dy: number, kinds: ArenaPropKind[], seed = 6) {
    for (let k = 0; k < n; k++) this.prop(kinds[Math.floor(hash3(k, seed, 3) * kinds.length)], x + dx * k, y + dy * k);
    return this;
  }

  /**
   * Turn walkable pockets that can't be reached from the spawn into wall. They only occur
   * inside the border forest, where they're hidden by trees anyway; sealing them keeps
   * enemies from spawning where the player can never go.
   */
  sealPockets() {
    const M = this.m, W = M.w, H = M.h;
    const top = (k: number) => {
      if (M.stairs[k]) return 1e9; // stairs connect north-south below
      return M.elev[k] + M.platform[k];
    };
    const open = (k: number) => !M.wall[k] && M.terrain[k] !== T.water && M.platform[k] <= 0.6;
    const seen = new Uint8Array(W * H);
    const q = [M.spawn[1] * W + M.spawn[0]];
    seen[q[0]] = 1;
    while (q.length) {
      const a = q.pop()!;
      const ai = a % W, aj = (a / W) | 0;
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const ni = ai + di, nj = aj + dj;
        if (ni < 0 || nj < 0 || ni >= W || nj >= H) continue;
        const b = nj * W + ni;
        if (seen[b] || !open(b)) continue;
        const ok = ((M.stairs[a] || M.stairs[b]) && dj !== 0) || Math.abs(top(a) - top(b)) <= 0.6;
        if (!ok) continue;
        seen[b] = 1; q.push(b);
      }
    }
    let sealed = 0;
    for (let k = 0; k < W * H; k++) if (!seen[k] && open(k)) { M.wall[k] = 1; sealed++; }
    return sealed;
  }
  landmark(x: number, y: number, name: string) { this.m.landmarks.push({ x, y, name }); return this; }
  chest(x: number, y: number) { this.m.chestSpots.push([x, y]); return this; }
}
