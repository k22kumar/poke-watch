// Tile world for the survivor arenas. Replaces the old seeded heightfield: arenas are now
// handcrafted tile maps (src/world/arenas.ts), 1 tile = 1 m, with flat ground, 1 m cliffs,
// 0.5 m ledges, stairs, water, walls (trees, boulders) and low platforms (rocks, bushes)
// that can be jumped onto. The public surface the sim uses is unchanged (height, waterAt,
// bound, chests) plus `blocks` for collision and a flow field for enemy navigation.

import { dhypot } from '../core/detmath';
import { Rng, streamSeed } from '../core/rng';
import type { Rules } from '../rules/defaults';
import type { BiomeDef } from '../rules/stages';
import { regionMap } from '../world/maps';
import { T, WATER_Y, stairEdges, type ArenaMap, type ArenaProp } from '../world/tiles';
import { CellField, CS } from './cells';
import { PropField } from './props';

export interface Chest { x: number; z: number; open: boolean }

const UNREACHED = 0x7fff;

export class World {
  readonly size: number;
  readonly half: number;
  readonly w: number; readonly h: number;
  readonly map: ArenaMap;
  readonly props: ArenaProp[];
  readonly chests: Chest[] = [];
  readonly biome: BiomeDef;
  readonly seed: number;
  readonly spawn: [number, number];
  /** surface states (wet, burning, frozen…) on each tile; see sim/cells.ts */
  readonly cells: CellField;
  /** W4 materials: prop states over a mutable wall/platform overlay (null when rules.surfaces is off) */
  readonly propField: PropField | null = null;
  readonly bossSpot: [number, number];
  /** tile-centre heights used for navigation */
  private navTop: Float32Array;
  private navOpen: Uint8Array;
  /** BFS distance (tiles) from the player's tile; UNREACHED where no path exists */
  readonly flow: Uint16Array;
  private flowFrom = -1;
  private queue: Int32Array;
  /** Phase 8a: flow-field cost of entering a burning tile (1 = fire does not change paths) */
  readonly burnCost: number;
  /** bucket queue for the weighted flow field */
  private dial: { nb: number; ring: Int32Array; hd: Int32Array; tl: Int32Array } | null = null;

  constructor(rules: Rules, biome: BiomeDef, seed: number, species: string[] = []) {
    const base = regionMap(rules.worldgen, biome.id, seed, species);
    // W4: wall and platform become this world's own overlay over the cached base map, so burning and breaking change
    // one run without touching the map other runs (and the renderer cache) share
    const materials = rules.surfaces.enabled && (!!base.gen || rules.surfaces.inAuthored);
    this.map = materials ? { ...base, wall: base.wall.slice(), platform: base.platform.slice() } : base;
    this.w = this.map.w; this.h = this.map.h;
    this.size = this.w;
    this.half = this.w / 2;
    this.biome = biome;
    this.seed = seed;
    this.props = this.map.props;
    this.cells = new CellField(this.map);
    const n = this.w * this.h;
    this.navTop = new Float32Array(n);
    this.navOpen = new Uint8Array(n);
    this.flow = new Uint16Array(n).fill(UNREACHED);
    this.queue = new Int32Array(n);
    this.burnCost = rules.caps.enabled ? Math.max(1, Math.round(rules.caps.burnNavCost)) : 1;
    for (let j = 0; j < this.h; j++) for (let i = 0; i < this.w; i++) {
      const k = j * this.w + i;
      const t = this.map.terrain[k];
      this.navOpen[k] = this.map.wall[k] || t === T.water || this.map.platform[k] > 0.6 ? 0 : 1;
      this.navTop[k] = this.height(i - this.half + 0.5, j - this.half + 0.5);
    }
    if (materials) {
      this.propField = new PropField(this.map);
      this.propField.baseReach = this.reachableCount(this.map.spawn[0] - this.half + 0.5, this.map.spawn[1] - this.half + 0.5);
    }
    this.spawn = [this.map.spawn[0] - this.half + 0.5, this.map.spawn[1] - this.half + 0.5];
    this.bossSpot = [this.map.bossSpot[0] - this.half + 0.5, this.map.bossSpot[1] - this.half + 0.5];
    // chests: a seeded subset of the arena's designed chest spots
    const rng = new Rng(streamSeed(seed, 'chests:' + biome.id));
    const spots = rng.shuffle(this.map.chestSpots.slice());
    for (const [x, y] of spots.slice(0, Math.min(rules.world.chests, spots.length))) this.chests.push({ x: x - this.half + 0.5, z: y - this.half + 0.5, open: false });
  }

  /** tile index for a world position, or -1 outside the map */
  tile(x: number, z: number): number {
    const i = Math.floor(x + this.half), j = Math.floor(z + this.half);
    if (i < 0 || j < 0 || i >= this.w || j >= this.h) return -1;
    return j * this.w + i;
  }

  /** standable surface height (m): ground elevation, stairs ramp, low props, water surface */
  height(x: number, z: number): number {
    const k = this.tile(x, z);
    if (k < 0) return 0;
    const M = this.map;
    if (M.stairs[k]) {
      const i = k % this.w, j = (k / this.w) | 0;
      const [n, sth] = stairEdges(M, i, j);
      return n + (sth - n) * (z + this.half - j);
    }
    const t = M.terrain[k];
    if (t === T.water) return this.cells.iceAt(k) ? 0 : WATER_Y;
    if (t === T.wood) return 0.05;
    return M.elev[k] + M.platform[k];
  }

  /** true when a walker with its feet at `feet` cannot occupy (x, z) */
  blocks(x: number, z: number, feet: number, step: number): boolean {
    const k = this.tile(x, z);
    if (k < 0) return true;
    if (this.map.wall[k] || (this.map.terrain[k] === T.water && !this.cells.iceAt(k))) return true;
    return this.height(x, z) > feet + step;
  }

  /** wall or water: impassable for anything on the ground */
  solid(x: number, z: number): boolean {
    const k = this.tile(x, z);
    return k < 0 || this.map.wall[k] === 1 || (this.map.terrain[k] === T.water && !this.cells.iceAt(k));
  }

  /** water surface height if inside water, else -Infinity */
  waterAt(x: number, z: number): number {
    const k = this.tile(x, z);
    return k >= 0 && this.map.terrain[k] === T.water && !this.cells.iceAt(k) ? WATER_Y : -Infinity;
  }

  inTallGrass(x: number, z: number): boolean {
    const k = this.tile(x, z);
    return k >= 0 && this.map.terrain[k] === T.tall;
  }

  /** a tile ground walkers can stand on and reach the player from */
  walkable(x: number, z: number): boolean {
    const k = this.tile(x, z);
    return k >= 0 && this.navOpen[k] === 1 && (this.flowFrom < 0 || this.flow[k] !== UNREACHED);
  }

  /** nearest walkable tile centre to (x, z), searching outward in rings */
  nearestWalkable(x: number, z: number): [number, number] {
    for (let r = 0; r < 20; r++)
      for (let dz = -r; dz <= r; dz++)
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          const px = Math.floor(x) + dx + 0.5, pz = Math.floor(z) + dz + 0.5;
          if (this.walkable(px, pz)) return [px, pz];
        }
    return this.spawn;
  }

  private canStep(a: number, b: number): boolean {
    if (this.navOpen[b] !== 1) return false;
    // a flight of stairs joins the tile below it (south) to the tile above it (north)
    if ((this.map.stairs[a] || this.map.stairs[b]) && Math.abs(a - b) === this.w) return true;
    return Math.abs(this.navTop[b] - this.navTop[a]) <= 0.6;
  }

  /** Frozen or thawed water changed what is walkable: refresh the open tiles and force a new flow field. */
  refreshNav() {
    for (let k = 0; k < this.navOpen.length; k++) {
      if (this.map.terrain[k] !== T.water) continue;
      this.navOpen[k] = this.cells.iceAt(k) && !this.map.wall[k] ? 1 : 0;
      this.navTop[k] = this.cells.iceAt(k) ? 0 : WATER_Y;
    }
    this.flowFrom = -1;
  }

  /** W4: the only writer of the wall/platform overlay; keeps navigation in step and forces a new flow field. */
  setBlock(k: number, wall: number, platform: number) {
    this.map.wall[k] = wall; this.map.platform[k] = platform;
    const t = this.map.terrain[k];
    this.navOpen[k] = wall || (t === T.water && !this.cells.iceAt(k)) || platform > 0.6 ? 0 : 1;
    const i = k % this.w, j = (k / this.w) | 0;
    this.navTop[k] = this.height(i - this.half + 0.5, j - this.half + 0.5);
    this.flowFrom = -1;
  }

  /** walkable tiles reachable from (x, z) by the navigation rules (watchdog; allocation per call, run every 2 s) */
  reachableCount(x: number, z: number): number {
    const src = this.tile(x, z);
    if (src < 0 || !this.navOpen[src]) return 0;
    const n = this.w * this.h, seen = new Uint8Array(n), Q = this.queue;
    let h = 0, t = 0;
    seen[src] = 1; Q[t++] = src;
    while (h < t) {
      const a = Q[h++], ai = a % this.w, aj = (a / this.w) | 0;
      if (ai > 0 && !seen[a - 1] && this.canStep(a, a - 1)) { seen[a - 1] = 1; Q[t++] = a - 1; }
      if (ai < this.w - 1 && !seen[a + 1] && this.canStep(a, a + 1)) { seen[a + 1] = 1; Q[t++] = a + 1; }
      if (aj > 0 && !seen[a - this.w] && this.canStep(a, a - this.w)) { seen[a - this.w] = 1; Q[t++] = a - this.w; }
      if (aj < this.h - 1 && !seen[a + this.w] && this.canStep(a, a + this.w)) { seen[a + this.w] = 1; Q[t++] = a + this.w; }
    }
    return t;
  }

  /** Burning tiles changed: rebuild the flow field now (same source tile). */
  refreshFlow(px: number, pz: number) {
    this.flowFrom = -1;
    this.updateFlow(px, pz);
  }

  /** Rebuild the BFS flow field when the player enters a new tile. Deterministic and allocation-free.
   *  While tiles burn and burnCost > 1 it is a weighted field instead: a burning tile costs burnCost steps. */
  updateFlow(px: number, pz: number) {
    const src = this.tile(px, pz);
    if (src < 0 || src === this.flowFrom) return;
    this.flowFrom = src;
    if (this.burnCost > 1 && this.cells.burning > 0) { this.weightedFlow(src); return; }
    const F = this.flow, Q = this.queue, W = this.w, H = this.h;
    F.fill(UNREACHED);
    let head = 0, tail = 0;
    F[src] = 0; Q[tail++] = src;
    while (head < tail) {
      const a = Q[head++];
      const ai = a % W, aj = (a / W) | 0;
      const d = F[a] + 1;
      if (ai > 0) { const b = a - 1; if (F[b] === UNREACHED && this.canStep(a, b)) { F[b] = d; Q[tail++] = b; } }
      if (ai < W - 1) { const b = a + 1; if (F[b] === UNREACHED && this.canStep(a, b)) { F[b] = d; Q[tail++] = b; } }
      if (aj > 0) { const b = a - W; if (F[b] === UNREACHED && this.canStep(a, b)) { F[b] = d; Q[tail++] = b; } }
      if (aj < H - 1) { const b = a + W; if (F[b] === UNREACHED && this.canStep(a, b)) { F[b] = d; Q[tail++] = b; } }
    }
  }

  /** Dijkstra from the player's tile with Dial's bucket queue (edge costs are 1, or burnCost into a burning
   *  tile): one FIFO ring per distance bucket, so it runs at about the cost of the plain BFS. Deterministic and
   *  allocation-free after the first call. */
  private weightedFlow(src: number) {
    const F = this.flow, W = this.w, H = this.h, n = W * H, st = this.cells.state, cost = this.burnCost, NB = cost + 1;
    if (!this.dial || this.dial.nb !== NB) this.dial = { nb: NB, ring: new Int32Array(NB * n), hd: new Int32Array(NB), tl: new Int32Array(NB) };
    const { ring, hd, tl } = this.dial;
    hd.fill(0); tl.fill(0);
    F.fill(UNREACHED);
    F[src] = 0; ring[0] = src; tl[0] = 1;
    let pending = 1;
    const BURN = CS.burning;
    for (let d = 0; pending > 0 && d < UNREACHED - 1; d++) {
      const bk = d % NB, base = bk * n;
      while (hd[bk] !== tl[bk]) {
        const a = ring[base + (hd[bk] % n)];
        hd[bk]++; pending--;
        if (F[a] !== d) continue; // stale entry
        const ai = a % W, aj = (a / W) | 0;
        if (ai > 0) { const b = a - 1; const nd = d + (st[b] === BURN ? cost : 1); if (nd < F[b] && this.canStep(a, b)) { F[b] = nd; const k = nd % NB; ring[k * n + (tl[k]++ % n)] = b; pending++; } }
        if (ai < W - 1) { const b = a + 1; const nd = d + (st[b] === BURN ? cost : 1); if (nd < F[b] && this.canStep(a, b)) { F[b] = nd; const k = nd % NB; ring[k * n + (tl[k]++ % n)] = b; pending++; } }
        if (aj > 0) { const b = a - W; const nd = d + (st[b] === BURN ? cost : 1); if (nd < F[b] && this.canStep(a, b)) { F[b] = nd; const k = nd % NB; ring[k * n + (tl[k]++ % n)] = b; pending++; } }
        if (aj < H - 1) { const b = a + W; const nd = d + (st[b] === BURN ? cost : 1); if (nd < F[b] && this.canStep(a, b)) { F[b] = nd; const k = nd % NB; ring[k * n + (tl[k]++ % n)] = b; pending++; } }
      }
      hd[bk] = 0; tl[bk] = 0;
    }
  }

  /** true if (x, z) is on a burning tile */
  burningAt(x: number, z: number): boolean {
    const k = this.tile(x, z);
    return k >= 0 && this.cells.state[k] === CS.burning;
  }

  /** Unit direction toward the player along the flow field, or null if direct steering is fine. */
  flowDir(x: number, z: number, out: [number, number]): boolean {
    const k = this.tile(x, z);
    if (k < 0 || this.flowFrom < 0) return false;
    const d = this.flow[k];
    if (d === UNREACHED || d <= 1) return false;
    const W = this.w, H = this.h;
    const i = k % W, j = (k / W) | 0;
    let best = d, bi = -1, bj = -1;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      if (!di && !dj) continue;
      const ni = i + di, nj = j + dj;
      if (ni < 0 || nj < 0 || ni >= W || nj >= H) continue;
      const nk = nj * W + ni;
      let v = this.flow[nk];
      if (v === UNREACHED) continue;
      if (di && dj) {
        // diagonal only if both orthogonal neighbours are open (no corner cutting through walls)
        if (this.flow[j * W + ni] === UNREACHED || this.flow[nj * W + i] === UNREACHED) continue;
        v += 0.4;
      }
      if (v < best) { best = v; bi = ni; bj = nj; }
    }
    if (bi < 0) return false;
    const tx = bi - this.half + 0.5 - x, tz = bj - this.half + 0.5 - z;
    const L = dhypot(tx, tz) || 1;
    out[0] = tx / L; out[1] = tz / L;
    return true;
  }

  /** flow distance (tiles) from the player, or Infinity */
  flowDist(x: number, z: number): number {
    const k = this.tile(x, z);
    if (k < 0) return Infinity;
    const d = this.flow[k];
    return d === UNREACHED ? Infinity : d;
  }

  get bound() { return this.half - 0.5; }
}
