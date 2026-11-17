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
import { blockCentre, blockMask, blockNodes, DIAG_R, type NavGrid } from '../world/navblocks';

/** wide block neighbour directions: four orthogonal, then four diagonal (World.wideNb and its link cache) */
const WIDE_DI = [-1, 1, 0, 0, -1, 1, -1, 1], WIDE_DJ = [0, 0, -1, 1, -1, -1, 1, 1];

export interface Chest { x: number; z: number; open: boolean }

const UNREACHED = 0x7fff;
/** an overhead deck is the surface for anything whose feet (or shot) are within this many metres below its top */
export const DECK_REACH = 0.9;
/** an overhead deck is a slab this thick: solid from its underside (top − DECK_SLAB) to its top (render/tilestage.ts
 *  draws the same 0.6 m). DECK_REACH is the layer-selection reach, not geometry */
export const DECK_SLAB = 0.6;
/** headroom (rules.size.headroom): a head may reach this far above a slab's underside (float32 positions and heights;
 *  an Extra Large body of exactly the class height, 2.4 m, fits the generators' 2.4 m gap under a 3.0 m deck) */
export const HEAD_EPS = 1e-3;

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
  /** size-aware navigation (docs/SIZING.md "Navigation classes"): the wide 2 × 2 blocks (world/navblocks.ts), built on
   *  first use and dropped whenever navigation changes, and block fields over them toward the player and toward a
   *  habitat contest, one per link rule ([0] orthogonal links only, [1] with diagonal-only links for footprints under
   *  DIAG_R) and height class (index + 2 × class, built on demand: class 0 fits under every deck, see heightClass). A
   *  field is current while its generation matches flowGen (the ordinary field's rebuild count). */
  private wideOpen: Uint8Array | null = null;
  private wideFlow: (Uint16Array | null)[] = [null, null];
  private wideGen = [-1, -1];
  private wideSrc = [-1, -1];
  private goalWide: (Uint16Array | null)[] = [null, null];
  private goalWideGen = [-1, -1];
  private flowGen = 0;
  private readonly wideSeed: number;
  /** the pursuit field only steers at a neighbour the walker can step to (rules.size.geometry; see descend) */
  private readonly stepChecked: boolean;
  /** this world's navigation as a NavGrid for world/navblocks.ts (open tiles and symmetric steps change with ice and tide) */
  private readonly grid: NavGrid;
  private readonly blk = new Int32Array(4);
  private readonly blk2 = new Int32Array(4);
  private readonly blkNb = new Int32Array(16);
  /** rules.hazards.enabled: liquids are entered (not walls) and chasms are open air (sim/hazards.ts) */
  readonly hazards: boolean;
  /** rules.size.headroom: a body height passed to the collision and wide-routing queries meets deck slabs (R1, docs/SIZING.md
   *  "Headroom"). Off, every `tall` argument is ignored and the queries are the ones before it */
  readonly headroom: boolean;
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
    this.wideSeed = rules.size.wideSeed;
    this.stepChecked = rules.size.geometry;
    this.grid = { w: this.w, h: this.h, over: this.over, open: (k) => this.navOpen[k] === 1, step: (a, b) => this.symStep(a, b) };
    const loc = this.map.gen?.loc;
    this.dropNav = loc ? loc.dropNav : 0;
    this.los = loc ? loc.los : false;
    this.anchors = loc ? loc.anchors.map(([x, y]) => [x - this.w / 2 + 0.5, y - this.h / 2 + 0.5] as [number, number]) : [];
    this.hab = this.map.gen?.hab ?? null;
    this.hazards = rules.hazards.enabled;
    this.headroom = rules.size.headroom;
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
  blocks(x: number, z: number, feet: number, step: number, tall?: number): boolean {
    const k = this.tile(x, z);
    if (k < 0) return true;
    if (this.over) {
      // on a deck: the deck is the floor (never a wall); under it: the ground rules, and the deck is out of reach
      const ov = this.over[k];
      if (ov > 0 && feet >= ov - DECK_REACH) return ov > feet + step;
      if (ov > 0 && tall !== undefined && this.headroom && this.underSlab(x, z, ov, feet, tall)) return true;
    }
    if (this.map.wall[k] || (this.map.terrain[k] === T.water && !this.cells.iceAt(k))) return true;
    return this.height(x, z) > feet + step;
  }

  /** Solid geometry only: a wall, a face higher than `step` above `feet`, a deck's slab in the way. Open liquid and open
   *  air are not solid (hazards on); with hazards off this is `blocks` exactly. */
  collides(x: number, z: number, feet: number, step: number, tall?: number): boolean {
    if (!this.hazards) return this.blocks(x, z, feet, step, tall);
    const k = this.tile(x, z);
    if (k < 0) return true;
    if (this.over) {
      const ov = this.over[k];
      if (ov > 0 && feet >= ov - DECK_REACH) return ov > feet + step;
      if (ov > 0 && tall !== undefined && this.headroom && this.underSlab(x, z, ov, feet, tall)) return true;
    }
    if (this.voids && this.voids[k]) return false; // open air: nothing to bump into
    if (this.map.wall[k]) return true;
    return this.height(x, z) > feet + step;
  }

  /** Headroom (rules.size.headroom): would a body `tall` m high, feet at `feet` below the deck `ov` at (x, z), have its
   *  head in the slab? It stands at its feet or on the ground there, whichever is higher (a grounded body steps up onto
   *  it; a face too high to step is the caller's wall test), so a body taller than the gap under a deck cannot enter
   *  it, walking or airborne, and one already under it is not stopped by a slab it fits under. */
  private underSlab(x: number, z: number, ov: number, feet: number, tall: number): boolean {
    return Math.max(feet, this.height(x, z)) + tall > ov - DECK_SLAB + HEAD_EPS;
  }

  /** Headroom over a body (rules.size.headroom): the lowest deck underside above feet at `feet` over any tile a circle of
   *  radius r at (x, z) covers (the centre's tile when r = 0); Infinity where there is none or headroom is off. A
   *  rising body clamps its head here (sim/player.ts). */
  headroomAt(x: number, z: number, feet: number, r = 0): number {
    if (!this.over || !this.headroom) return Infinity;
    const gx = x + this.half, gz = z + this.half, E = 1e-4;
    let top = Infinity;
    for (let j = Math.floor(gz - r); j <= Math.floor(gz + r); j++) for (let i = Math.floor(gx - r); i <= Math.floor(gx + r); i++) {
      if (i < 0 || j < 0 || i >= this.w || j >= this.h) continue;
      const qx = Math.min(i + 1 - E, Math.max(i + E, gx)), qz = Math.min(j + 1 - E, Math.max(j + E, gz));
      if (r > 0 && (gx - qx) * (gx - qx) + (gz - qz) * (gz - qz) >= r * r && !(i === Math.floor(gx) && j === Math.floor(gz))) continue;
      const ov = this.over[j * this.w + i];
      if (ov > 0 && feet < ov - DECK_REACH) top = Math.min(top, ov - DECK_SLAB);
    }
    return top;
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
    return ov > 0 && y < ov - DECK_REACH ? ov - DECK_SLAB : Infinity;
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
    this.wideOpen = null;
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
    this.wideOpen = null;
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
    this.wideOpen = null;
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
   * picks the same shore. Within each pass a candidate with no wall on the straight line from (x, z) wins: an actor heads
   * straight for its shore, so the nearest tile behind a pillar is only taken when nothing in view will do.
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
      // a shore in a straight line first (an actor heads straight for it); round a pillar only if there is no other
      for (const clear of [true, false]) for (const [, t] of cand) {
        const cx = (t % this.w) - this.half + 0.5, cz = ((t / this.w) | 0) - this.half + 0.5;
        if ((clear && this.wallBetween(x, z, cx, cz)) || !this.roomFrom(t, room)) continue;
        return [cx, cz];
      }
    }
    return null;
  }

  /** Is there a wall tile on the straight line between two points? (A shore behind a pillar is not the nearest way out.) */
  wallBetween(x0: number, z0: number, x1: number, z1: number): boolean {
    const d = Math.sqrt((x1 - x0) ** 2 + (z1 - z0) ** 2), n = Math.ceil(d / 0.25);
    for (let s = 1; s < n; s++) {
      const k = this.tile(x0 + ((x1 - x0) * s) / n, z0 + ((z1 - z0) * s) / n);
      if (k < 0 || this.map.wall[k] === 1) return true;
    }
    return false;
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
    this.flowGen++;
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

  /** does a wide body fit on the navigation node at (x, z) (its deck when `y` is on one): is that node one of the four
   *  nodes of some wide 2 × 2 block (world/navblocks.ts)? */
  fitsHeavy(x: number, z: number, y?: number): boolean {
    const a = this.node(x, z, y);
    if (a < 0) return false;
    const M = this.wideMask(), n = this.w * this.h, k = a % n, i = k % this.w, j = (k / this.w) | 0, t = this.blk;
    for (let L = 0; L < M.length / n; L++) for (let dj = -1; dj <= 0; dj++) for (let di = -1; di <= 0; di++) {
      const bi = i + di, bj = j + dj;
      if (bi < 0 || bj < 0 || bi >= this.w - 1 || bj >= this.h - 1 || !M[L * n + bj * this.w + bi]) continue;
      if (this.blockHas(L * n + bj * this.w + bi, a)) return true;
    }
    return false;
  }

  /** the wide blocks of the current navigation (world/navblocks.ts), rebuilt after any change to open tiles */
  private wideMask(): Uint8Array {
    if (!this.wideOpen) {
      const M = (this.wideOpen = blockMask(this.grid)), W = this.w, n = W * this.h, C = (this.bnodes = new Int32Array(M.length * 4)), t = this.blk;
      this.wideLink = new Uint32Array(M.length);
      // each wide block's four nodes, so neighbour and link tests are array compares (the predicate stays navblocks')
      for (let b = 0; b < M.length; b++) if (M[b] && blockNodes(this.grid, (b % n) % W, ((b % n) / W) | 0, (b / n) | 0, t)) C.set(t, b * 4);
      this.wideGen.fill(-1); this.goalWideGen.fill(-1);
      // headroom: each wide block's lowest gap under a deck (ground nodes beneath one), and the distinct gaps on the map
      this.bclear = null; this.clearSteps = []; this.lowFns = [];
      if (this.headroom && this.over) {
        const BC = (this.bclear = new Float32Array(M.length).fill(Infinity)), ov = this.over, steps = new Set<number>();
        for (let b = 0; b < M.length; b++) {
          if (!M[b]) continue;
          for (let q = 0; q < 4; q++) { const a = C[b * 4 + q]; if (a < n && ov[a] > 0) BC[b] = Math.min(BC[b], ov[a] - DECK_SLAB - this.navTop[a]); }
          if (BC[b] < Infinity) steps.add(BC[b]);
        }
        this.clearSteps = [...steps].sort((p, q) => p - q);
      }
    }
    return this.wideOpen;
  }
  /** headroom (rules.size.headroom): per wide block, the lowest gap (m) between a deck's underside and the ground under it
   *  among its four nodes (Infinity: none of its nodes is under a deck); null when headroom is off or the map has no
   *  decks. Filled with the mask */
  private bclear: Float32Array | null = null;
  /** the distinct finite gaps of bclear, ascending: a body's height class is how many of them it does not fit */
  private clearSteps: number[] = [];

  /** a body's height class for wide routing (0 = it fits under every deck; the fields for class c leave out the blocks
   *  whose gap is one of the c lowest). Always 0 with headroom off, on a map with no decks, or with no height given */
  private heightClass(tall?: number): number {
    if (tall === undefined || !this.bclear) return 0;
    const S = this.clearSteps;
    let c = 0;
    while (c < S.length && S[c] + HEAD_EPS < tall) c++;
    return c;
  }
  /** blocks a body of height class c may not enter (a gap under a deck lower than it), or undefined for class 0; one
   *  predicate per class, made once per mask (wide steering asks every tick) */
  private lowFor(c: number): ((b: number) => boolean) | undefined {
    if (c === 0 || !this.bclear) return undefined;
    let f = this.lowFns[c];
    if (!f) { const BC = this.bclear, top = this.clearSteps[c - 1]; f = this.lowFns[c] = (b) => BC[b] <= top; }
    return f;
  }
  private lowFns: ((b: number) => boolean)[] = [];
  /** the four nodes of wide blocks (index b·4 + q), filled with the mask */
  private bnodes = new Int32Array(0);
  /** each wide block's links, filled on first use and dropped with the mask (so with every navigation change): bit s·2 + L
   *  for the neighbour in direction s (WIDE_DI / WIDE_DJ, wideNb's order) on layer L, and bit 16 once filled. A field
   *  search pops every block it reaches, and testing up to 8 links on each pop dominated the rebuild (docs/SIZING.md) */
  private wideLink = new Uint32Array(0);

  /** does wide block b include node a? */
  private blockHas(b: number, a: number): boolean {
    const C = this.bnodes, o = b * 4;
    return C[o] === a || C[o + 1] === a || C[o + 2] === a || C[o + 3] === a;
  }

  /** wide blocks a and b, 4-adjacent (or diagonal, sharing their one common tile), on the same nodes where they meet:
   *  world/navblocks.ts blocksLinked / blocksDiagonal over the cached nodes */
  private linked(a: number, b: number): boolean {
    const W = this.w, n = W * this.h, ka = a % n, kb = b % n, di = (kb % W) - (ka % W), dj = ((kb / W) | 0) - ((ka / W) | 0), C = this.bnodes, A = a * 4, B = b * 4;
    if (dj === 0 && di === 1) return C[A + 1] === C[B] && C[A + 3] === C[B + 2];
    if (dj === 0 && di === -1) return C[A] === C[B + 1] && C[A + 2] === C[B + 3];
    if (di === 0 && dj === 1) return C[A + 2] === C[B] && C[A + 3] === C[B + 1];
    if (di === 0 && dj === -1) return C[A] === C[B + 2] && C[A + 1] === C[B + 3];
    if ((di === 1 || di === -1) && (dj === 1 || dj === -1)) { const q = (dj > 0 ? 2 : 0) + (di > 0 ? 1 : 0); return C[A + q] === C[B + 3 - q]; }
    return false;
  }

  /** block a's link bits (wideLink), filled on first use with the link predicate (linked) */
  private linkBits(a: number): number {
    const M = this.wideOpen!, W = this.w, H = this.h, n = W * H, layers = M.length / n, k = a % n, i = k % W, j = (k / W) | 0;
    let v = this.wideLink[a];
    if (v) return v;
    v = 1 << 16;
    for (let s = 0; s < 8; s++) {
      const ni = i + WIDE_DI[s], nj = j + WIDE_DJ[s];
      if (ni < 0 || nj < 0 || ni >= W - 1 || nj >= H - 1) continue;
      for (let L = 0; L < layers; L++) { const b = L * n + nj * W + ni; if (M[b] && this.linked(a, b)) v |= 1 << (s * 2 + L); }
    }
    return (this.wideLink[a] = v);
  }

  /** the wide blocks linked to block a (with `diag`, diagonal ones too), into out; returns how many */
  private wideNb(a: number, diag: boolean, out: Int32Array): number {
    const W = this.w, n = W * this.h, layers = this.wideOpen!.length / n, k = a % n, v = this.linkBits(a);
    let c = 0;
    for (let s = 0; s < (diag ? 8 : 4); s++) {
      if (!(v & (3 << (s * 2)))) continue;
      const nk = k + WIDE_DJ[s] * W + WIDE_DI[s];
      for (let L = 0; L < layers; L++) if (v & (1 << (s * 2 + L))) out[c++] = L * n + nk;
    }
    return c;
  }

  /** a symmetric step between 4-adjacent nodes (both directions, so no ledge drop): the edge rule inside a wide block */
  private symStep(a: number, b: number): boolean {
    return this.over ? this.canStepNode(a, b) && this.canStepNode(b, a) : this.canStep(a, b) && this.canStep(b, a);
  }

  /** breadth-first search over linked wide blocks from `seeds` (block index, start distance; any order), into F */
  private blockSearch(F: Uint16Array, seeds: number[], diag: boolean, skip?: (b: number) => boolean) {
    const M = this.wideMask(), Q = this.queue, WL = this.wideLink, W = this.w, n = W * this.h, layers = M.length / n, S = diag ? 8 : 4;
    F.fill(UNREACHED);
    // seeds sorted by start distance (ties by index), injected when the search reaches their distance
    const order: number[] = [];
    for (let s = 0; s < seeds.length; s += 2) order.push(s);
    order.sort((p, q) => seeds[p + 1] - seeds[q + 1] || seeds[p] - seeds[q]);
    let head = 0, tail = 0, next = 0;
    const inject = (upTo: number) => {
      while (next < order.length && seeds[order[next] + 1] <= upTo) {
        const b = seeds[order[next]], d = seeds[order[next] + 1];
        next++;
        if (F[b] === UNREACHED) { F[b] = d; Q[tail++] = b; }
      }
    };
    inject(next < order.length ? seeds[order[0] + 1] : 0);
    while (head < tail || next < order.length) {
      if (head === tail) inject(seeds[order[next] + 1]);
      const a = Q[head++], d = F[a] + 1;
      if (next < order.length) inject(F[a]);
      // wideNb inlined over the cached link bits (same blocks, same order)
      const v = WL[a] || this.linkBits(a), k = a % n;
      for (let s = 0; s < S; s++) {
        if (!(v & (3 << (s * 2)))) continue;
        const nk = k + WIDE_DJ[s] * W + WIDE_DI[s];
        for (let L = 0; L < layers; L++) {
          if (!(v & (1 << (s * 2 + L)))) continue;
          const b = L * n + nk;
          if (F[b] !== UNREACHED || (skip && skip(b))) continue;
          F[b] = d; Q[tail++] = b;
        }
      }
      if (next < order.length) inject(d);
    }
  }

  /** The wide field toward the player (`diag`: footprints under DIAG_R may take diagonal-only block links). Seeded from
   *  every wide block within rules.size.wideSeed ordinary-field steps of the player, at that distance, so where the player
   *  stands somewhere a wide body does not fit, it still comes as close as the ground allows. Rebuilt with the ordinary
   *  field. */
  private wideField(diag: boolean, tall?: number): Uint16Array | null {
    if (this.flowFrom < 0) return null;
    const M = this.wideMask(), hc = this.heightClass(tall), c = (diag ? 1 : 0) + 2 * hc, low = this.lowFor(hc);
    let F = this.wideFlow[c];
    const W = this.w, n = W * this.h, src = this.flowFrom % n, si = src % W, sj = (src / W) | 0, R = this.wideSeed + 1, t = this.blk;
    // kept while the player stays within a tile of where it was built, on the same layer (it is seeded around the player,
    // and the walkers near it steer straight), so it is not rebuilt on every tile the player crosses
    const was = this.wideSrc[c];
    if (F && this.wideGen[c] >= 0 && was >= 0 && (was >= n) === (this.flowFrom >= n) && Math.abs((was % n) % W - si) <= 1 && Math.abs((((was % n) / W) | 0) - sj) <= 1) return F;
    if (!F) F = this.wideFlow[c] = new Uint16Array(M.length);
    this.wideSrc[c] = this.flowFrom;
    // seeds: the blocks covering the player's own node when it stands on wide ground; else only the closest approach
    // blocks (least ordinary distance, within wideSeed). Seeding every nearby block at its ordinary distance made false
    // minima: a block three narrow steps from the player but five wide ones held a wide walker 3.7 m short (mt-moon 2)
    const seeds: number[] = [];
    let best = Infinity;
    for (let L = 0; L < M.length / n; L++) for (let bj = sj - R; bj <= sj + R; bj++) for (let bi = si - R; bi <= si + R; bi++) {
      if (bi < 0 || bj < 0 || bi >= W - 1 || bj >= this.h - 1) continue;
      const b = L * n + bj * W + bi;
      if (!M[b] || (low && low(b))) continue;
      t.set(this.bnodes.subarray(b * 4, b * 4 + 4));
      const own = t[0] === this.flowFrom || t[1] === this.flowFrom || t[2] === this.flowFrom || t[3] === this.flowFrom;
      const v = own ? 0 : Math.min(this.flow[t[0]], this.flow[t[1]], this.flow[t[2]], this.flow[t[3]]);
      if (v > this.wideSeed || v > best) continue;
      if (v < best) { best = v; seeds.length = 0; }
      seeds.push(b, v);
    }
    this.blockSearch(F, seeds, diag, low);
    this.wideGen[c] = this.flowGen;
    return F;
  }

  /** The block a wide body at (x, z, feet y) stands in: the block whose centre is nearest, in the variant holding the
   *  body's own node; -1 when that block is not wide. */
  private bodyBlock(x: number, z: number, y?: number): number {
    const a = this.node(x, z, y);
    if (a < 0) return -1;
    const M = this.wideMask(), W = this.w, n = W * this.h, bi = Math.floor(x + this.half - 0.5), bj = Math.floor(z + this.half - 0.5), t = this.blk;
    if (bi < 0 || bj < 0 || bi >= W - 1 || bj >= this.h - 1) return -1;
    for (let L = 0; L < M.length / n; L++) {
      const b = L * n + bj * W + bi;
      if (M[b] && this.blockHas(b, a)) return b;
    }
    return -1;
  }

  /** Steering for a wide body down block field F: 1 with a unit direction in `out`, 0 when it is beside the target
   *  (distance ≤ 1: steer straight), -1 when it has no route (its block is off the field and no reached block is
   *  within 2 tiles, or it is already at the closest point the field offers): it should hold, never squeeze. */
  private blockSteer(F: Uint16Array, x: number, z: number, y: number | undefined, out: [number, number], diag: boolean): -1 | 0 | 1 {
    const M = this.wideMask(), g = this.grid, W = this.w, n = W * this.h, nb = this.blkNb, ta = this.blk, tb = this.blk2;
    const a = this.bodyBlock(x, z, y);
    let best = -1, bestV = Infinity;
    if (a < 0 || F[a] === UNREACHED) {
      // off the field (a tight spot it was placed, pushed or evolved into): the cheapest reached block within 2 tiles
      // whose floor is level with its feet
      const feet = y ?? this.height(x, z), bi = Math.floor(x + this.half - 0.5), bj = Math.floor(z + this.half - 0.5);
      for (let L = 0; L < M.length / n; L++) for (let dj = -2; dj <= 2; dj++) for (let di = -2; di <= 2; di++) {
        const ci = bi + di, cj = bj + dj;
        if (ci < 0 || cj < 0 || ci >= W - 1 || cj >= this.h - 1) continue;
        const b = L * n + cj * W + ci;
        if (F[b] === UNREACHED || Math.abs(this.nodeTop(this.bnodes[b * 4]) - feet) > 0.7) continue;
        const v = F[b] + (di * di + dj * dj) * 0.01;
        if (v < bestV) { bestV = v; best = b; }
      }
      if (best < 0) return -1;
    } else {
      if (F[a] <= 1) return 0;
      const k = a % n, i = k % W, j = (k / W) | 0;
      bestV = F[a];
      const c = this.wideNb(a, diag, nb);
      for (let q = 0; q < c; q++) { const b = nb[q], kb = b % n, v = F[b] + ((kb % W) !== i && ((kb / W) | 0) !== j ? 0.4 : 0); if (F[b] !== UNREACHED && v < bestV) { bestV = v; best = b; } }
      if (!diag) {
        // a diagonal through both orthogonal neighbours (no corner cut), as the ordinary field descends
        const orth: number[] = [];
        for (let q = 0; q < c; q++) if (F[nb[q]] !== UNREACHED) orth.push(nb[q]);
        for (let p = 0; p < orth.length; p++) for (let q = p + 1; q < orth.length; q++) {
          const kp = orth[p] % n, kq = orth[q] % n, pi = kp % W, pj = (kp / W) | 0, qi = kq % W, qj = (kq / W) | 0;
          if (pi === qi || pj === qj) continue;
          // the block diagonal to `a` through p and q: must be wide, reached and linked to both
          const di = pi !== i ? pi : qi, dj = pj !== j ? pj : qj;
          for (let L = 0; L < M.length / n; L++) {
            const d = L * n + dj * W + di;
            if (!M[d] || F[d] === UNREACHED || !this.linked(orth[p], d) || !this.linked(orth[q], d)) continue;
            if (F[d] + 0.4 < bestV) { bestV = F[d] + 0.4; best = d; }
          }
        }
      }
      if (best < 0) return -1; // the closest point the field offers (a seed beside a pocket the body cannot enter)
    }
    const [cx, cz] = blockCentre(W, n, this.half, best), tx = cx - x, tz = cz - z, L = dhypot(tx, tz) || 1;
    out[0] = tx / L; out[1] = tz / L;
    return 1;
  }

  /** Steering toward the player for a wide body (footprint ≥ rules.size.heavyRadius): see blockSteer. `diag` for
   *  footprints under DIAG_R. */
  wideDir(x: number, z: number, out: [number, number], y?: number, diag = false, tall?: number): -1 | 0 | 1 {
    const F = this.wideField(diag, tall);
    return F ? this.blockSteer(F, x, z, y, out, diag) : 0;
  }

  /** Is the ground at (x, z) on the wide field toward the player (a wide body there has a route to the player, and so
   *  the player to it: the lattice is symmetric)? Any of the up to eight blocks covering the tile counts. */
  wideReached(x: number, z: number, diag = false, y?: number, tall?: number): boolean {
    const F = this.wideField(diag, tall), a = this.node(x, z, y);
    if (!F || a < 0) return false;
    const M = this.wideMask(), n = this.w * this.h, k = a % n, i = k % this.w, j = (k / this.w) | 0, t = this.blk;
    for (let L = 0; L < M.length / n; L++) for (let dj = -1; dj <= 0; dj++) for (let di = -1; di <= 0; di++) {
      const bi = i + di, bj = j + dj;
      if (bi < 0 || bj < 0 || bi >= this.w - 1 || bj >= this.h - 1) continue;
      const b = L * n + bj * this.w + bi;
      if (F[b] !== UNREACHED && this.blockHas(b, a)) return true;
    }
    return false;
  }

  /** Unit direction toward the player along the flow field (8 neighbours, no corner cutting), or false where direct
   *  steering is fine (beside the player) or there is no route. Wide bodies use wideDir instead. */
  flowDir(x: number, z: number, out: [number, number], y?: number): boolean {
    const a = this.node(x, z, y);
    if (a < 0 || this.flowFrom < 0) return false;
    return this.descend(this.flow, a, x, z, out);
  }

  /** can a walker on node `from` step to node `to` (canStep's direction: the search ran from the player)? */
  private stepTo(to: number, from: number): boolean { return this.over ? this.canStepNode(to, from) : this.canStep(to, from); }

  /** step down a flow field from node `a` (8 neighbours, no corner cutting) */
  private descend(field: Uint16Array, a: number, x: number, z: number, out: [number, number]): boolean {
    const d = field[a];
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
      let v = field[nk];
      if (v === UNREACHED) continue;
      // size geometry on: only a neighbour the walker can step to from here (the search reached the cheaper tile some
      // other way; steering at it across a face pins the walker there, e.g. beside a diagonal ramp: docs/SIZING.md). A
      // diagonal steps through both side tiles. Off: the older rule, so replay layers keep their hashes.
      if (this.stepChecked) {
        if (!(di && dj ? this.stepTo(at(j * W + ni), a) && this.stepTo(nk, at(j * W + ni)) && this.stepTo(at(nj * W + i), a) && this.stepTo(nk, at(nj * W + i)) : this.stepTo(nk, a))) continue;
      }
      if (di && dj) {
        // diagonal only if both orthogonal neighbours are open (no corner cutting through walls)
        if (field[at(j * W + ni)] === UNREACHED || field[at(nj * W + i)] === UNREACHED) continue;
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

  /** habitat maps: steering toward the contest for a wide body (Raiders of team B with a footprint ≥
   *  rules.size.heavyRadius), as wideDir: the block field seeded from the wide blocks beside the contest. Blocks holding a
   *  vent tile are left out of every route; a body already inside one has no route and holds (the vent field is a few
   *  tiles, and the ordinary walkers' rule for it is in goalDir). */
  wideGoalDir(x: number, z: number, out: [number, number], y?: number, diag = false, tall?: number): -1 | 0 | 1 {
    if (!this.hab) return 0;
    const M = this.wideMask(), hc = this.heightClass(tall), c = (diag ? 1 : 0) + 2 * hc, low = this.lowFor(hc);
    let F = this.goalWide[c];
    if (!F || this.goalWideGen[c] !== 0) {
      if (!F) F = this.goalWide[c] = new Uint16Array(M.length);
      const W = this.w, n = W * this.h, C = this.hab.contest, t = this.blk, seeds: number[] = [];
      for (let L = 0; L < M.length / n; L++) for (let dj = -3; dj <= 2; dj++) for (let di = -3; di <= 2; di++) {
        const bi = Math.floor(C.x) + di, bj = Math.floor(C.y) + dj;
        if (bi < 0 || bj < 0 || bi >= W - 1 || bj >= this.h - 1) continue;
        const b = L * n + bj * W + bi;
        if (!M[b] || (low && low(b)) || Math.hypot(bi + 1 - C.x, bj + 1 - C.y) > 2.5 || Math.abs(this.nodeTop(this.bnodes[b * 4]) - C.h) > 0.7) continue;
        seeds.push(b, 0);
      }
      const hz = this.hazard;
      const vent = hz ? (b: number) => { const v = this.bnodes, o = b * 4; return !!(hz[v[o] % n] || hz[v[o + 1] % n] || hz[v[o + 2] % n] || hz[v[o + 3] % n]); } : undefined;
      this.blockSearch(F, seeds, diag, vent && low ? (b) => vent(b) || low(b) : vent ?? low);
      this.goalWideGen[c] = 0;
    }
    return this.blockSteer(F, x, z, y, out, diag);
  }

  // ---- movement footprint (docs/SIZING.md "Footprint") -----------------------------------------------------------

  /** How deep a circle of radius r at (x, z), feet at `feet`, overlaps solid geometry (World.collides read at the
   *  circle's nearest point inside each tile it covers), and the push that clears it into `out` (summed per tile). A
   *  tile diagonal to the centre's tile is measured from the higher of the two orthogonal tiles between them that are
   *  open to the body (it already stands partly on them): on a diagonal ramp that corner tile is one step above them,
   *  not a face, which is the edge rule of a wide block (world/navblocks.ts). Footprints stay under 1 m, so only the
   *  centre's tile and its eight neighbours are ever covered. */
  private overlap(x: number, z: number, feet: number, step: number, r: number, out?: [number, number], ref?: number, tall?: number): number {
    let pen = 0, px = 0, pz = 0;
    const gx = x + this.half, gz = z + this.half, E = 1e-4, ci = Math.floor(gx), cj = Math.floor(gz);
    // fast path: a tile whose eight neighbours are open ground level with it within a step has nothing a sub-metre circle
    // standing on it could overlap (grounded or above it)
    if (r < 1 && step >= 0.6 && ref === undefined && this.freeAt(ci, cj) && feet >= this.navTop[cj * this.w + ci] - 0.05) { if (out) { out[0] = 0; out[1] = 0; } return 0; }
    // faces are measured from where the body stands: the surface under its centre while it is grounded (feet within a
    // step of it; the feet lag a tick behind on a slope, up or down, so a ramp's next tile or a terrace beside a ramp
    // would read wrong from them), its actual feet while airborne (a jump, a ledge drop, a fall: a lip it is clearing is
    // not a face, and the cliff it drops past becomes one as it falls, which pushes it off)
    const surf = this.height(x, z, feet);
    if (ref !== undefined) feet = ref;
    else if (feet - surf <= step) feet = surf;
    for (let j = Math.floor(gz - r); j <= Math.floor(gz + r); j++) for (let i = Math.floor(gx - r); i <= Math.floor(gx + r); i++) {
      if (i === ci && j === cj) continue; // the centre's own tile: the caller tests the centre
      const qx = Math.min(i + 1 - E, Math.max(i + E, gx)), qz = Math.min(j + 1 - E, Math.max(j + E, gz));
      const dx = gx - qx, dz = gz - qz, d = Math.sqrt(dx * dx + dz * dz);
      if (d >= r) continue;
      let f = feet;
      if (i !== ci && j !== cj) {
        // the two orthogonal tiles between the centre's tile and this one, each read at its point nearest the circle
        const ax = Math.min(i + 1 - E, Math.max(i + E, gx)) - this.half, az = Math.min(cj + 1 - E, Math.max(cj + E, gz)) - this.half;
        const bx = Math.min(ci + 1 - E, Math.max(ci + E, gx)) - this.half, bz = Math.min(j + 1 - E, Math.max(j + E, gz)) - this.half;
        if (!this.collides(ax, az, feet, step, tall)) f = Math.max(f, this.height(ax, az, feet));
        if (!this.collides(bx, bz, feet, step, tall)) f = Math.max(f, this.height(bx, bz, feet));
      }
      if (!this.collides(qx - this.half, qz - this.half, f, step, tall)) continue;
      const p = r - d;
      if (p > pen) pen = p;
      if (d > 1e-6) { px += (dx / d) * p; pz += (dz / d) * p; }
    }
    if (out) { out[0] = px; out[1] = pz; }
    return pen;
  }

  /** per tile: 1 when it and its eight neighbours are open single-layer ground (no stairs, deck, chasm or liquid) whose
   *  heights differ by at most 0.6 m from its own, 2 when not, 0 not yet known; dropped with any navigation change */
  private free: Uint8Array | null = null;
  private freeAt(i: number, j: number): boolean {
    if (i < 1 || j < 1 || i >= this.w - 1 || j >= this.h - 1) return false;
    if (!this.free || this.freeFor !== this.wideOpen) { this.free = new Uint8Array(this.w * this.h); this.freeFor = this.wideMask(); }
    const k = j * this.w + i, F = this.free;
    if (F[k]) return F[k] === 1;
    let ok = true;
    const h0 = this.navTop[k];
    for (let dj = -1; dj <= 1 && ok; dj++) for (let di = -1; di <= 1 && ok; di++) {
      const t = k + dj * this.w + di;
      ok = this.navOpen[t] === 1 && !this.map.stairs[t] && !(this.over && this.over[t] > 0) && !(this.voids && this.voids[t]) && Math.abs(this.navTop[t] - h0) <= 0.6;
    }
    F[k] = ok ? 1 : 2;
    return ok;
  }
  private freeFor: Uint8Array | null = null;

  /** Does a body of footprint r stand clear of solid geometry at (x, z) with its feet at `feet`? */
  fits(x: number, z: number, feet: number, r: number, step = 0.6, tall?: number): boolean {
    return !this.collides(x, z, feet, step, tall) && this.overlap(x, z, feet, step, r, undefined, undefined, tall) <= 1e-4;
  }

  /**
   * The one collision resolver for bodies with a footprint (docs/SIZING.md "Footprint"): move a circle of radius r,
   * feet at `feet`, from (x, z) by (dx, dz), into `out`. Solid is World.collides (walls, faces higher than `step`, deck
   * slabs), read at the centre and at the circle's nearest point inside each tile it covers, so one rule decides; a
   * chasm or a liquid is not solid here (the caller's `stop` adds centre-point rules such as an enemy's refusal to walk
   * into open air on its own). The move is cut into steps of at most 0.25 m, so a dash or a knockback never tunnels
   * through a corner. Each step tries the full move, then each axis alone, pushing the circle out of whatever it
   * overlaps (it glides round a corner into a passage it fits), and accepts the first whose overlap is no deeper than
   * before: a body left in a tight spot (an evolution inside a corridor) can walk out of it but never further in.
   * r = 0 is the point collision used with rules.size.geometry off.
   */
  moveBody(x: number, z: number, dx: number, dz: number, feet: number, step: number, r: number, out: [number, number], stop?: (x: number, z: number) => boolean, tall?: number) {
    const L = Math.max(Math.abs(dx), Math.abs(dz)), N = Math.max(1, Math.ceil(L / 0.25)), sx = dx / N, sz = dz / N, P = this.pushTmp;
    if (!this.headroom || !this.over) tall = undefined;
    let cx = x, cz = z;
    for (let s = 0; s < N; s++) {
      const pen0 = r > 0 ? this.overlap(cx, cz, feet, step, r, undefined, undefined, tall) : 0;
      let moved = false;
      for (let tryk = 0; tryk < 3 && !moved; tryk++) {
        let nx = tryk === 2 ? cx : cx + sx, nz = tryk === 1 ? cz : cz + sz;
        if (tryk > 0 && (tryk === 1 ? sx === 0 : sz === 0)) continue;
        if (this.collides(nx, nz, feet, step, tall) || (stop && stop(nx, nz))) continue;
        if (r > 0) {
          // a grounded body stepping off a ledge (a drop the step rule allows on location maps) lands clear of the lip it
          // left: the push is measured from the surface it lands on, not from its feet still level with the lip
          const s0 = this.height(cx, cz, feet), s1 = this.height(nx, nz, feet);
          const land = feet - s0 <= step && s0 - s1 > step ? s1 : undefined;
          for (let it = 0; it < 2; it++) {
            const before = this.overlap(nx, nz, feet, step, r, P, land, tall);
            if (before <= 1e-4) break;
            const qx = nx + P[0], qz = nz + P[1];
            if (this.collides(qx, qz, feet, step, tall) || (stop && stop(qx, qz))) break;
            // only a push that clears something (a body wedged between two faces is not shoved back along its way)
            if (this.overlap(qx, qz, feet, step, r, undefined, land, tall) >= before - 1e-4) break;
            nx = qx; nz = qz;
          }
          // a drop is taken only where the body fits once it lands (a wide body does not drop into a one-tile slot)
          if (this.overlap(nx, nz, feet, step, r, undefined, land, tall) > pen0 + 1e-4) continue;
        }
        cx = nx; cz = nz; moved = true;
      }
      if (!moved) break;
    }
    out[0] = cx; out[1] = cz;
  }
  private readonly pushTmp: [number, number] = [0, 0];

  /** Where a body of footprint r goes when it must be put down near (x, z) (spawn, relocation, a rescue): (x, z) itself
   *  when it is walkable and the body fits there, else the nearest tile centre (narrow) or wide-block centre (`wide`)
   *  that is walkable and fits, searching outward in rings; the nearest walkable tile when nothing fits within 20. A
   *  wide body is only put on a block the wide field toward the player reaches (once there is one), so it is never left in
   *  a pocket that only narrow routes join. */
  nearestFit(x: number, z: number, r: number, wide: boolean, reach = true, tall?: number): [number, number] {
    if (r <= 0) return this.walkable(x, z) ? [x, z] : this.nearestWalkable(x, z);
    const diag = r < DIAG_R, F = wide ? this.wideField(diag, tall) : null;
    if (this.walkable(x, z) && this.fits(x, z, this.height(x, z), r, 0.6, tall) && (!F || !reach || this.wideReached(x, z, diag, undefined, tall))) return [x, z];
    const M = wide ? this.wideMask() : null, W = this.w, n = W * this.h;
    const ox = Math.floor(x + this.half - (wide ? 0.5 : 0)), oz = Math.floor(z + this.half - (wide ? 0.5 : 0));
    for (let rr = 0; rr < 20; rr++)
      for (let dz = -rr; dz <= rr; dz++)
        for (let dx = -rr; dx <= rr; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== rr) continue;
          const i = ox + dx, j = oz + dz;
          if (i < 0 || j < 0 || i >= W - (wide ? 1 : 0) || j >= this.h - (wide ? 1 : 0)) continue;
          if (M && !M[j * W + i]) continue;
          if (F && reach && F[j * W + i] === UNREACHED && !(M && M.length > n && M[n + j * W + i] && F[n + j * W + i] !== UNREACHED)) continue;
          const px = i - this.half + (wide ? 1 : 0.5), pz = j - this.half + (wide ? 1 : 0.5);
          if (this.walkable(px, pz) && this.fits(px, pz, this.height(px, pz), r, 0.6, tall)) return [px, pz];
        }
    // a wide body is never put where it does not fit: wide ground off the field before any narrow tile
    if (F && reach) return this.nearestFit(x, z, r, wide, false, tall);
    return this.nearestWalkable(x, z);
  }

  get bound() { return this.half - 0.5; }
}
