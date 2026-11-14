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
import { T, WATER_Y, ICE_LIFT, deckTop, stairEdges, type ArenaMap, type ArenaProp } from '../world/tiles';
import { CellField, CS } from './cells';
import { PropField } from './props';

export interface Chest { x: number; z: number; open: boolean }

const UNREACHED = 0x7fff;
/** an overhead deck is the surface for anything whose feet (or shot) are within this many metres below its top */
export const DECK_REACH = 0.9;

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
  /** location maps (src/world/locgen): an enemy may step DOWN a ledge up to this many metres (0 = symmetric 0.6 m
   *  steps only, as on every authored and classic generated map) */
  readonly dropNav: number;
  /** location maps: shots respect terrain and walls (cliffs, trees and rock block lines of fire) */
  readonly los: boolean;
  /** location maps: tile anchors where enemies enter (cave mouths, forest gates, tunnels), map space */
  readonly anchors: [number, number][];
  /** location maps with overhead decks (ArenaMap.over): the deck height per tile, else null. Navigation then runs on
   *  two layers: node k is the ground of tile k, node n + k its deck (flow, queue are 2n long). */
  readonly over: Float32Array | null;
  /** habitat maps (src/world/habitat): recipe, contest, stagings and hazard tiles; null elsewhere */
  readonly hab: import('../world/habitat/types').HabMeta | null;
  /** habitat maps: hazard tile mask (vent fields), or null */
  readonly hazard: Uint8Array | null;
  /** habitat maps: flow field toward the contest (Raiders walk it), built on first use */
  private goalFlow: Uint16Array | null = null;
  /** rules.hazards.enabled: liquids are entered (not walls) and chasms are open air (sim/hazards.ts) */
  readonly hazards: boolean;
  /** location maps with hazards on: chasm tiles (1 = open air, no supporting floor), else null */
  readonly voids: Uint8Array | null = null;
  /** an actor below this height has fallen out of the map (hazards on: the lowest floor minus rules.hazards.killDepth) */
  readonly killY: number = -Infinity;
  /** habitat maps with a tide (HabMeta.tide, hazards on): the tiles high water covers, their dry terrain and fluid
   *  levels as built (low water), and whether the water is high now (World.setTide; sim/hazards.ts tideSystem) */
  readonly tide: { tiles: Int32Array; terrain: Uint8Array; wlevel: Float32Array; high: number; mask: Uint8Array } | null = null;
  tideHigh = false;

  constructor(rules: Rules, biome: BiomeDef, seed: number, species: string[] = []) {
    const base = regionMap(rules.worldgen, biome.id, seed, species);
    // W4: wall and platform become this world's own overlay over the cached base map, so burning and breaking change
    // one run without touching the map other runs (and the renderer cache) share
    const materials = rules.surfaces.enabled && (!!base.gen || rules.surfaces.inAuthored);
    this.map = materials ? { ...base, wall: base.wall.slice(), platform: base.platform.slice() } : base;
    // a tide changes terrain and fluid levels during the run: this world's own copy (the cached map is shared)
    const T0 = rules.hazards.enabled ? base.gen?.hab?.tide : undefined;
    if (T0 && T0.tiles.length) {
      this.map = { ...this.map, terrain: base.terrain.slice(), wlevel: (base.wlevel ?? new Float32Array(base.w * base.h).fill(WATER_Y)).slice() };
      const tiles = Int32Array.from(T0.tiles);
      const mask = new Uint8Array(base.w * base.h);
      for (const k of tiles) mask[k] = 1;
      this.tide = { tiles, terrain: Uint8Array.from(tiles, (k) => base.terrain[k]), wlevel: Float32Array.from(tiles, (k) => this.map.wlevel![k]), high: T0.high, mask };
    }
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
    this.over = this.map.over && this.map.over.some((v) => v > 0) ? this.map.over : null;
    this.flow = new Uint16Array(this.over ? 2 * n : n).fill(UNREACHED);
    this.queue = new Int32Array(this.over ? 2 * n : n);
    this.burnCost = rules.caps.enabled ? Math.max(1, Math.round(rules.caps.burnNavCost)) : 1;
    const loc = this.map.gen?.loc;
    this.dropNav = loc ? loc.dropNav : 0;
    this.los = loc ? loc.los : false;
    this.anchors = loc ? loc.anchors.map(([x, y]) => [x - this.w / 2 + 0.5, y - this.h / 2 + 0.5] as [number, number]) : [];
    this.hab = this.map.gen?.hab ?? null;
    this.hazards = rules.hazards.enabled;
    const chasm = this.hazards ? loc?.chasm ?? [] : [];
    if (chasm.length) { this.voids = new Uint8Array(this.w * this.h); for (const k of chasm) this.voids[k] = 1; }
    this.hazard = null;
    if (this.hab && this.hab.hazard.length) { this.hazard = new Uint8Array(this.w * this.h); for (const k of this.hab.hazard) this.hazard[k] = 1; }
    for (let j = 0; j < this.h; j++) for (let i = 0; i < this.w; i++) {
      const k = j * this.w + i;
      const t = this.map.terrain[k];
      this.navOpen[k] = this.map.wall[k] || t === T.water || this.map.platform[k] > 0.6 ? 0 : 1;
      this.navTop[k] = this.height(i - this.half + 0.5, j - this.half + 0.5);
    }
    if (this.hazards) {
      let low = Infinity;
      for (let k = 0; k < n; k++) if (!(this.voids && this.voids[k]) && !this.map.wall[k]) low = Math.min(low, this.navTop[k]);
      this.killY = (low === Infinity ? 0 : low) - rules.hazards.killDepth;
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

  /** standable surface height (m): ground elevation, stairs ramp, low props, water surface. `ref` is the height of
   *  whoever asks (feet, a shot): on a tile with an overhead deck (ArenaMap.over) it picks the deck when `ref` is at
   *  or above the deck's underside reach, else the ground beneath. Without `ref` it is always the ground. */
  height(x: number, z: number, ref?: number): number {
    const k = this.tile(x, z);
    if (k < 0) return 0;
    const M = this.map;
    if (ref !== undefined && M.over) { const ov = M.over[k]; if (ov > 0 && ref >= ov - DECK_REACH) return ov; }
    if (M.stairs[k]) {
      const i = k % this.w, j = (k / this.w) | 0;
      const [n, sth] = stairEdges(M, i, j);
      return n + (sth - n) * (z + this.half - j);
    }
    const t = M.terrain[k];
    if (t === T.water) return this.cells.iceAt(k) ? (M.wlevel ? M.wlevel[k] : WATER_Y) + ICE_LIFT : M.wlevel ? M.wlevel[k] : WATER_Y;
    if (t === T.wood) return deckTop(M.elev[k]);
    return M.elev[k] + M.platform[k];
  }

  /** true when a walker with its feet at `feet` cannot occupy (x, z), or should not walk there on its own: walls,
   *  faces higher than a step, open liquid and open air (a chasm). Steering, bodies and the bot read this; actors'
   *  own collision reads `collides` (only what is actually solid), so they can be carried into a liquid or a drop. */
  blocks(x: number, z: number, feet: number, step: number): boolean {
    const k = this.tile(x, z);
    if (k < 0) return true;
    if (this.over) {
      // on a deck: the deck is the floor (never a wall); under it: the ground rules, and the deck is out of reach
      const ov = this.over[k];
      if (ov > 0 && feet >= ov - DECK_REACH) return ov > feet + step;
    }
    if (this.map.wall[k] || (this.map.terrain[k] === T.water && !this.cells.iceAt(k))) return true;
    return this.height(x, z) > feet + step;
  }

  /** Solid geometry only: a wall, a face higher than `step` above `feet`, a deck's slab in the way. Open liquid and open
   *  air are not solid (hazards on); with hazards off this is `blocks` exactly. */
  collides(x: number, z: number, feet: number, step: number): boolean {
    if (!this.hazards) return this.blocks(x, z, feet, step);
    const k = this.tile(x, z);
    if (k < 0) return true;
    if (this.over) {
      const ov = this.over[k];
      if (ov > 0 && feet >= ov - DECK_REACH) return ov > feet + step;
    }
    if (this.voids && this.voids[k]) return false; // open air: nothing to bump into
    if (this.map.wall[k]) return true;
    return this.height(x, z) > feet + step;
  }

  /** a chasm tile (open air, no floor) */
  isVoid(k: number): boolean { return !!this.voids && k >= 0 && this.voids[k] === 1; }

  /** The supporting surface under feet at `ref` (World.height), or -Infinity where there is none: a chasm tile with no
   *  deck at the walker's level. Liquids support at their surface (a swimmer floats there). */
  support(x: number, z: number, ref?: number): number {
    const k = this.tile(x, z);
    if (this.voids && k >= 0 && this.voids[k]) {
      const ov = this.over ? this.over[k] : 0;
      if (!(ov > 0 && ref !== undefined && ref >= ov - DECK_REACH)) return -Infinity;
    }
    return this.height(x, z, ref);
  }

  /** The liquid an actor with its feet at `y` is in contact with at (x, z): 0 none, 1 water, 2 lava. Contact needs open
   *  (unfrozen) liquid on the ground layer, no deck carrying the actor, and feet within rules.hazards.contact of the
   *  surface (anything higher is jumping or flying over it). */
  liquidAt(x: number, z: number, y: number, contact: number): number {
    const k = this.tile(x, z);
    if (k < 0 || this.map.terrain[k] !== T.water || this.cells.iceAt(k)) return 0;
    if (this.over) { const ov = this.over[k]; if (ov > 0 && y >= ov - DECK_REACH) return 0; }
    const top = this.map.wlevel ? this.map.wlevel[k] : WATER_Y;
    if (y > top + contact) return 0;
    return this.hab?.medium === 'lava' ? 2 : 1;
  }

  /** underside of a deck above height `y` at (x, z) (decks are 0.6 m slabs), Infinity where there is none */
  ceilingAt(x: number, z: number, y: number): number {
    if (!this.over) return Infinity;
    const k = this.tile(x, z);
    if (k < 0) return Infinity;
    const ov = this.over[k];
    return ov > 0 && y < ov - DECK_REACH ? ov - 0.6 : Infinity;
  }

  /** navigation node for a walker at (x, z) with its feet at `y`: the tile, or n + tile on a deck; -1 outside */
  node(x: number, z: number, y?: number): number {
    const k = this.tile(x, z);
    if (k < 0 || !this.over || y === undefined) return k;
    const ov = this.over[k];
    return ov > 0 && y >= ov - DECK_REACH ? this.w * this.h + k : k;
  }

  /** wall or water: impassable for anything on the ground */
  solid(x: number, z: number): boolean {
    const k = this.tile(x, z);
    return k < 0 || this.map.wall[k] === 1 || (this.map.terrain[k] === T.water && !this.cells.iceAt(k));
  }

  /** water surface height if inside water, else -Infinity */
  waterAt(x: number, z: number): number {
    const k = this.tile(x, z);
    return k >= 0 && this.map.terrain[k] === T.water && !this.cells.iceAt(k) ? (this.map.wlevel ? this.map.wlevel[k] : WATER_Y) : -Infinity;
  }

  inTallGrass(x: number, z: number): boolean {
    const k = this.tile(x, z);
    return k >= 0 && this.map.terrain[k] === T.tall;
  }

  habitatAt(x: number, z: number): number {
    const k = this.tile(x, z);
    return k >= 0 ? this.map.gen?.habitat[k] ?? 0 : 0;
  }

  /** a tile ground walkers can stand on and reach the player from (`y`: on a deck when at its height) */
  walkable(x: number, z: number, y?: number): boolean {
    const k = this.node(x, z, y);
    if (k < 0) return false;
    const deck = k >= this.w * this.h;
    return (deck || this.navOpen[k] === 1) && (this.flowFrom < 0 || this.flow[k] !== UNREACHED);
  }

  /** ground walkers can stand on tile k right now (ice counts, thawed water and walls do not), and the height they stand at */
  isOpen(k: number): boolean { return this.navOpen[k] === 1; }
  topOf(k: number): number { return this.navTop[k]; }

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

  /** Flow-field edge: the search runs outward from the player, so an enemy on `b` moves to `a`. On location maps an
   *  enemy may also drop from `b` down a ledge onto `a` (dropNav); everywhere else steps are symmetric. */
  private canStep(a: number, b: number): boolean {
    if (this.navOpen[b] !== 1) return false;
    // a flight of stairs joins the tile below it (south) to the tile above it (north)
    if ((this.map.stairs[a] || this.map.stairs[b]) && Math.abs(a - b) === this.w) return true;
    const d = this.navTop[b] - this.navTop[a];
    if (this.dropNav > 0 && d > 0 && d <= this.dropNav && this.navOpen[a] === 1) return true;
    return Math.abs(d) <= 0.6;
  }

  /** wall tile (tree, rock mass, building): blocks movement and, on location maps, lines of fire (a chasm is open air,
   *  not a wall, with hazards on) */
  wallAt(x: number, z: number): boolean {
    const k = this.tile(x, z);
    return k < 0 || (this.map.wall[k] === 1 && !(this.voids && this.voids[k]));
  }

  /**
   * Line of sight between two points in 3D (location maps): false when a wall tile or terrain higher than the line
   * lies between them. Samples every 0.5 m, skipping the first and last half metre (the shooter's and target's own
   * footing). Pure function of the map; no allocation.
   */
  sight(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): boolean {
    const dx = x1 - x0, dz = z1 - z0, L = dhypot(dx, dz);
    const n = Math.floor(L / 0.5);
    for (let s = 1; s < n; s++) {
      const t = (s * 0.5) / L;
      const x = x0 + dx * t, z = z0 + dz * t, y = y0 + (y1 - y0) * t;
      const k = this.tile(x, z);
      if (k < 0) return false;
      if (this.over) {
        // a deck's slab blocks a line passing through it; above a deck the ground's walls do not matter
        const ov = this.over[k];
        if (ov > 0 && y >= ov - DECK_REACH) { if (ov > y) return false; continue; }
      }
      if (this.map.wall[k] === 1 && !(this.voids && this.voids[k])) return false;
      if (this.height(x, z) > y) return false;
    }
    return true;
  }

  /** Frozen or thawed water changed what is walkable: refresh the open tiles and force a new flow field. */
  refreshNav() {
    for (let k = 0; k < this.navOpen.length; k++) {
      if (this.map.terrain[k] !== T.water) continue;
      this.navOpen[k] = this.cells.iceAt(k) && !this.map.wall[k] ? 1 : 0;
      this.navTop[k] = this.cells.iceAt(k) ? (this.map.wlevel ? this.map.wlevel[k] : WATER_Y) + ICE_LIFT : this.map.wlevel ? this.map.wlevel[k] : WATER_Y;
    }
    this.flowFrom = -1;
    this.goalFlow = null;
  }

  /** Tidal maps: set the water high (every tidal tile is open water at the tide's high level) or low (the tiles as built:
   *  dry floor, and the sea at its low level). Navigation follows at once: tidal tiles close or open, both flow fields are
   *  rebuilt. Whoever is on a tile that floods is left where it is, in the water, and the exposure rule decides. */
  setTide(high: boolean) {
    const D = this.tide;
    if (!D || high === this.tideHigh) return;
    this.tideHigh = high;
    const M = this.map, wl = M.wlevel!;
    for (let i = 0; i < D.tiles.length; i++) {
      const k = D.tiles[i];
      M.terrain[k] = high ? T.water : D.terrain[i];
      wl[k] = high ? D.high : D.wlevel[i];
      this.navOpen[k] = M.wall[k] || (M.terrain[k] === T.water && !this.cells.iceAt(k)) || M.platform[k] > 0.6 ? 0 : 1;
      this.navTop[k] = this.height((k % this.w) - this.half + 0.5, ((k / this.w) | 0) - this.half + 0.5);
    }
    this.flowFrom = -1;
    this.goalFlow = null;
  }

  /** tidal maps: does high water cover (x, z)? (dry floor at low water counts) */
  tidalAt(x: number, z: number): boolean {
    const k = this.tile(x, z);
    return !!this.tide && k >= 0 && this.tide.mask[k] === 1;
  }

  /** W4: the only writer of the wall/platform overlay; keeps navigation in step and forces a new flow field. */
  setBlock(k: number, wall: number, platform: number) {
    this.map.wall[k] = wall; this.map.platform[k] = platform;
    const t = this.map.terrain[k];
    this.navOpen[k] = wall || (t === T.water && !this.cells.iceAt(k)) || platform > 0.6 ? 0 : 1;
    const i = k % this.w, j = (k / this.w) | 0;
    this.navTop[k] = this.height(i - this.half + 0.5, j - this.half + 0.5);
    this.flowFrom = -1;
    this.goalFlow = null;
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

  /** at least `n` tiles can be walked through from tile `t` by the navigation rules (a bounded flood: a pocket smaller
   *  than `n` is a trap, not a place to put someone) */
  private roomFrom(t: number, n: number): boolean {
    const seen = new Set<number>([t]), Q = [t];
    for (let h = 0; h < Q.length && seen.size < n; h++) {
      const a = Q[h], ai = a % this.w, aj = (a / this.w) | 0;
      for (const b of [ai > 0 ? a - 1 : -1, ai < this.w - 1 ? a + 1 : -1, aj > 0 ? a - this.w : -1, aj < this.h - 1 ? a + this.w : -1]) {
        if (b < 0 || seen.has(b) || !this.canStep(a, b)) continue;
        seen.add(b); Q.push(b);
      }
    }
    return seen.size >= n;
  }

  /**
   * Where something goes when the ground under it stops being walkable (frozen water opening): the centre of the nearest
   * dry open tile within `reach` tiles of (x, z) that has room for a body of `radius` (no wall, water or step the body
   * cannot take within its radius) and `room` tiles of walkable ground connected to it, else null. A shore within 1.5 m
   * of the height the actor stood at (`level`, default the ground under it) wins over a nearer one on another level, so
   * ice on a river's upper reach never drops anyone down the falls. Ties go to the lower tile index, so every client
   * picks the same shore.
   */
  shore(x: number, z: number, radius: number, level?: number, reach = 16, room = 48): [number, number] | null {
    const k0 = this.tile(x, z);
    if (k0 < 0) return null;
    const i0 = k0 % this.w, j0 = (k0 / this.w) | 0, cand: [number, number][] = [], at = level ?? this.height(x, z);
    const DIRS: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1], [0.7071, 0.7071], [-0.7071, 0.7071], [0.7071, -0.7071], [-0.7071, -0.7071]];
    for (const [lim, r] of [[1.5, radius], [1.5, 0], [Infinity, radius], [Infinity, 0]]) {
      cand.length = 0;
      for (let j = Math.max(0, j0 - reach); j <= Math.min(this.h - 1, j0 + reach); j++) {
        for (let i = Math.max(0, i0 - reach); i <= Math.min(this.w - 1, i0 + reach); i++) {
          const t = j * this.w + i;
          if (this.navOpen[t] !== 1 || this.cells.iceAt(t) || this.map.terrain[t] === T.water) continue;
          const cx = i - this.half + 0.5, cz = j - this.half + 0.5, h = this.height(cx, cz);
          if (Math.abs(h - at) > lim) continue;
          let fits = true;
          if (r > 0) for (const [dx, dz] of DIRS) if (this.blocks(cx + dx * r, cz + dz * r, h, 0.6)) { fits = false; break; }
          if (fits) cand.push([(i - i0) ** 2 + (j - j0) ** 2 + t * 1e-9, t]);
        }
      }
      cand.sort((a, b) => a[0] - b[0]);
      for (const [, t] of cand) if (this.roomFrom(t, room)) return [(t % this.w) - this.half + 0.5, ((t / this.w) | 0) - this.half + 0.5];
    }
    return null;
  }

  /** Burning tiles changed: rebuild the flow field now (same source tile). */
  refreshFlow(px: number, pz: number, py?: number) {
    this.flowFrom = -1;
    this.updateFlow(px, pz, py);
  }

  /** Rebuild the BFS flow field when the player enters a new tile. Deterministic and allocation-free.
   *  While tiles burn and burnCost > 1 it is a weighted field instead: a burning tile costs burnCost steps. */
  updateFlow(px: number, pz: number, py?: number) {
    const src = this.node(px, pz, py);
    if (src < 0 || src === this.flowFrom) return;
    this.flowFrom = src;
    if (this.over) { this.layeredFlow(src); return; }
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

  /** surface height and openness of a navigation node (ground node k, or deck node n + k) */
  private nodeTop(a: number): number { const n = this.w * this.h; return a >= n ? this.over![a - n] : this.navTop[a]; }
  private nodeOpen(a: number): boolean { const n = this.w * this.h; return a >= n ? true : this.navOpen[a] === 1; }
  /** canStep over nodes: an enemy on node `b` may move to node `a` (tiles 4-adjacent) */
  private canStepNode(a: number, b: number): boolean {
    if (!this.nodeOpen(b)) return false;
    const n = this.w * this.h, ka = a % n, kb = b % n;
    // a walker from b entering tile ka lands where World.height puts it: on ka's deck when it is at or above the
    // deck's reach, else on the ground — only that node is a real step (no dropping through a deck)
    const ov = this.over![ka];
    if ((ov > 0 && this.nodeTop(b) >= ov - DECK_REACH) !== a >= n) return false;
    if (a < n && b < n && (this.map.stairs[ka] || this.map.stairs[kb]) && Math.abs(ka - kb) === this.w) return true;
    const d = this.nodeTop(b) - this.nodeTop(a);
    if (this.dropNav > 0 && d > 0 && d <= this.dropNav && this.nodeOpen(a)) return true;
    return Math.abs(d) <= 0.6;
  }

  /** BFS over the two layers (ground and decks) from the player's node; unit cost (fire does not reroute here) */
  private layeredFlow(src: number) {
    const F = this.flow, Q = this.queue, W = this.w, H = this.h, n = W * H, over = this.over!;
    F.fill(UNREACHED);
    let head = 0, tail = 0;
    F[src] = 0; Q[tail++] = src;
    while (head < tail) {
      const a = Q[head++], ka = a % n;
      const ai = ka % W, aj = (ka / W) | 0;
      const d = F[a] + 1;
      for (let s = 0; s < 4; s++) {
        const kb = s === 0 ? (ai > 0 ? ka - 1 : -1) : s === 1 ? (ai < W - 1 ? ka + 1 : -1) : s === 2 ? (aj > 0 ? ka - W : -1) : aj < H - 1 ? ka + W : -1;
        if (kb < 0) continue;
        if (F[kb] === UNREACHED && this.canStepNode(a, kb)) { F[kb] = d; Q[tail++] = kb; }
        const db = n + kb;
        if (over[kb] > 0 && F[db] === UNREACHED && this.canStepNode(a, db)) { F[db] = d; Q[tail++] = db; }
      }
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
  flowDir(x: number, z: number, out: [number, number], y?: number): boolean {
    const a = this.node(x, z, y);
    if (a < 0 || this.flowFrom < 0) return false;
    const d = this.flow[a];
    if (d === UNREACHED || d <= 1) return false;
    const W = this.w, H = this.h, n = W * H, k = a % n;
    const i = k % W, j = (k / W) | 0;
    // on layered maps a neighbour is the node at the walker's own level (its deck when level with it, else ground)
    const top = this.over ? this.nodeTop(a) : 0;
    const at = (t: number) => (this.over && this.over[t] > 0 && top >= this.over[t] - DECK_REACH ? n + t : t);
    let best = d, bi = -1, bj = -1;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      if (!di && !dj) continue;
      const ni = i + di, nj = j + dj;
      if (ni < 0 || nj < 0 || ni >= W || nj >= H) continue;
      const nk = at(nj * W + ni);
      let v = this.flow[nk];
      if (v === UNREACHED) continue;
      if (di && dj) {
        // diagonal only if both orthogonal neighbours are open (no corner cutting through walls)
        if (this.flow[at(j * W + ni)] === UNREACHED || this.flow[at(nj * W + i)] === UNREACHED) continue;
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

  /** habitat maps: unit direction along the flow field toward the contest (built once, rebuilt when navigation
   *  changes), or false when there is none or the walker is already beside it */
  goalDir(x: number, z: number, out: [number, number], y?: number): boolean {
    if (!this.hab) return false;
    const n = this.w * this.h, N = this.over ? 2 * n : n;
    if (!this.goalFlow) {
      const F = new Uint16Array(N).fill(UNREACHED), Q = new Int32Array(N), W = this.w, H = this.h;
      const c = this.hab.contest;
      let head = 0, tail = 0;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
        const i = Math.floor(c.x) + dx, j = Math.floor(c.y) + dy;
        if (i < 0 || j < 0 || i >= W || j >= H) continue;
        let k = j * W + i;
        if (this.over && this.over[k] > 0 && Math.abs(this.over[k] - c.h) < 0.7) k += n;
        if (!this.nodeOpen(k) || F[k] !== UNREACHED) continue;
        F[k] = 0; Q[tail++] = k;
      }
      while (head < tail) {
        const a = Q[head++], ka = a % n, ai = ka % W, aj = (ka / W) | 0, d = F[a] + 1;
        for (let s = 0; s < 4; s++) {
          const kb = s === 0 ? (ai > 0 ? ka - 1 : -1) : s === 1 ? (ai < W - 1 ? ka + 1 : -1) : s === 2 ? (aj > 0 ? ka - W : -1) : aj < H - 1 ? ka + W : -1;
          if (kb < 0) continue;
          for (const b of this.over && this.over[kb] > 0 ? [kb, n + kb] : [kb]) {
            if (F[b] !== UNREACHED) continue;
            if (this.hazard && b < n && this.hazard[b]) continue; // the vent field is entered only in the second pass, at a penalty
            if (!(this.over ? this.canStepNode(a, b) : this.canStep(a, b))) continue;
            F[b] = d; Q[tail++] = b;
          }
        }
      }
      // A vent field (docs/HABITAT_STATES.md): never part of a route to the point, whatever side of it a creature starts
      // on, however long the way round is. Its tiles are valued above any tile outside it (`pen` is more than the longest
      // route on the map), so nothing steps into it, and a creature already inside walks out the cheapest way (relaxed
      // until nothing improves: the field is a few dozen tiles). Ground the validator's `venting` state cannot reach
      // from the point stays without a flow, as it is not on any route the gates cover.
      if (this.hazard) {
        const pen = 4096, field: number[] = [];
        for (let b = 0; b < n; b++) if (this.hazard[b] && this.navOpen[b] === 1) field.push(b);
        for (let changed = true, guard = 0; changed && guard < 200; guard++) {
          changed = false;
          for (const b of field) {
            const bi = b % W, bj = (b / W) | 0;
            for (const a of [bi > 0 ? b - 1 : -1, bi < W - 1 ? b + 1 : -1, bj > 0 ? b - W : -1, bj < H - 1 ? b + W : -1]) {
              if (a < 0 || F[a] === UNREACHED || !this.canStep(a, b)) continue;
              const v = F[a] + 1 + (this.hazard[a] ? 0 : pen);
              if (v < F[b]) { F[b] = v; changed = true; }
            }
          }
        }
      }
      this.goalFlow = F;
    }
    const F = this.goalFlow, a = this.node(x, z, y);
    if (a < 0 || F[a] === UNREACHED || F[a] <= 1) return false;
    const W = this.w, H = this.h, k = a % n, i = k % W, j = (k / W) | 0;
    const top = this.over ? this.nodeTop(a) : 0;
    const at = (t: number) => (this.over && this.over[t] > 0 && top >= this.over[t] - DECK_REACH ? n + t : t);
    // a step up of at most 0.6 m (or a flight of stairs) from node `from` to node `to` (see the neighbour test below)
    const climb = (to: number, from: number) => (this.over ? this.nodeTop(to) : this.navTop[to]) - (this.over ? this.nodeTop(from) : this.navTop[from]) <= 0.6 + 1e-6 || (!!(this.map.stairs[to % n] || this.map.stairs[from % n]) && Math.abs((to % n) - (from % n)) === W);
    let best = F[a], bi = -1, bj = -1;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      if (!di && !dj) continue;
      const ni = i + di, nj = j + dj;
      if (ni < 0 || nj < 0 || ni >= W || nj >= H) continue;
      const t = at(nj * W + ni);
      let v = F[t];
      if (v === UNREACHED) continue;
      // never head for a cheaper tile up a face higher than a step (a causeway's landing at the lip of a hall above the
      // walker): the flow reached it some other way, and steering at it pins the walker to the face. Drops are left as
      // they were. A diagonal counts when it is a step up at most through both side tiles (a diagonal up a ramp rises more
      // than a step between tile centres, but the slope itself is continuous; a corner over a dip or a face is not cut)
      if (!(di && dj ? climb(at(j * W + ni), a) && climb(t, at(j * W + ni)) && climb(at(nj * W + i), a) && climb(t, at(nj * W + i)) : climb(t, a))) continue;
      if (di && dj) {
        if (F[at(j * W + ni)] === UNREACHED || F[at(nj * W + i)] === UNREACHED) continue;
        if (this.hazard && !this.hazard[k] && (this.hazard[j * W + ni] || this.hazard[nj * W + i])) continue; // never clip a vent tile's corner
        v += 0.4;
      }
      if (v < best) { best = v; bi = ni; bj = nj; }
    }
    if (bi < 0) return false;
    const tx = bi - this.half + 0.5 - x, tz = bj - this.half + 0.5 - z, L = dhypot(tx, tz) || 1;
    out[0] = tx / L; out[1] = tz / L;
    return true;
  }

  /** habitat maps: is (x, z) in a vent field? */
  hazardAt(x: number, z: number): boolean {
    const k = this.tile(x, z);
    return !!this.hazard && k >= 0 && this.hazard[k] === 1;
  }

  /** flow distance (tiles) from the player, or Infinity */
  flowDist(x: number, z: number, y?: number): number {
    const k = this.node(x, z, y);
    if (k < 0) return Infinity;
    const d = this.flow[k];
    return d === UNREACHED ? Infinity : d;
  }

  get bound() { return this.half - 0.5; }
}
