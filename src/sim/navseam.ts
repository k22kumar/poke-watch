// The sim's navigation bridge (task I3; docs/OVERHAUL_3D.md "Navigation (I3)"): with rules.nav.engine = 'navmesh' the
// seam's navigation members (setNavGoal, navDir, navReached, navDist) answer from src/nav's navmeshes instead of the tile
// World's flow and wide fields. worldOf composes the two swaps: the physics seam (when rules.physics.engine = 'rapier')
// wraps the tile World, and the NavSeam wraps whichever of them it gets, so the flags are independent. Every other member
// is forwarded unchanged: enemies still move on the tile World (I1c moves them); only their steering changes.
//
// The navmeshes are built from the tile adapter's WorldModel of the World's live map (sim/physseam.ts liveMap: ice as
// ground at the ice, the World's voids as chasms) at map entry. A run-time geometry change (World.geoGen: a prop burns or
// breaks, the tide turns, water freezes or thaws) rebuilds only the navmesh tiles whose build reads a changed map tile.
//
// The seam's answers (agents by width group: wide ? (diag ? large : xl) : narrow; `tall` is not read, each group has one
// agent height, rules.nav.groups):
//   setNavGoal   the player's point; each group's player field is recomputed when the player's polygon changes (the
//                tile World's flow follows too: place() and walkableAt still read it)
//   navDir       corridor following along the field: 1 with the direction to the first corner; 0 on the goal's
//                polygon (straight is clear); no route: 0 for a narrow agent, -1 (hold) for a wide one, as the tile World
//   navReached   on a polygon of the agent's group the player's field reaches
//   navDist      the narrow group's route length to the player (m), Infinity where there is none
// The 'contest' goal (habitat Holds) prices AREA.hazard (vent fields) at rules.nav.hazardCost, so no route crosses one
// that need not, and a walker inside one walks out the cheapest way (the tile goalDir's rule).
//
// Ownership: the bridge owns its NavWorld; reset() and dispose() free it (sim/run.ts disposeRun, map changes).

import { NavWorld } from '../nav/world';
import { recast, recastReady } from '../nav/recast';
import { AREA } from '../nav/build';
import { fromArenaMap } from '../world/adapter';
import { liveMap } from './physseam';
import type { ArenaMap } from '../world/tiles';
import type { Rules } from '../rules/defaults';
import type { RayHit } from '../world/sight';
import type { NavGoal, RefY, TileExt, WorldQuery } from './worldquery';

/** group index by agent (the NavWorld's ascending-height order: narrow, large, xl) */
const groupOf = (wide: boolean | undefined, diag: boolean | undefined) => (wide ? (diag ? 1 : 2) : 0);

/** the tile state the navmesh was built from, to find what a geometry change touched */
interface Snapshot { terrain: Uint8Array; elev: Float32Array; platform: Float32Array; wall: Uint8Array; stairs: Uint8Array; over: Float32Array | null; voids: Uint8Array }

function snapshot(m: ArenaMap): Snapshot {
  const voids = new Uint8Array(m.w * m.h);
  for (const k of m.gen?.loc?.chasm ?? []) voids[k] = 1;
  return { terrain: m.terrain.slice(), elev: Float32Array.from(m.elev), platform: Float32Array.from(m.platform), wall: m.wall.slice(), stairs: Uint8Array.from(m.stairs), over: m.over ? Float32Array.from(m.over) : null, voids };
}

/** the map tiles whose column changed between two snapshots */
function changedTiles(a: Snapshot, b: Snapshot): number[] {
  const out: number[] = [];
  for (let k = 0; k < a.terrain.length; k++) {
    if (a.terrain[k] !== b.terrain[k] || a.elev[k] !== b.elev[k] || a.platform[k] !== b.platform[k] || a.wall[k] !== b.wall[k] || a.stairs[k] !== b.stairs[k] || a.voids[k] !== b.voids[k] || (a.over ? a.over[k] : 0) !== (b.over ? b.over[k] : 0)) out.push(k);
  }
  return out;
}

/** The bridge a run with rules.nav.engine = 'navmesh' carries (SimContext.nav). */
export class NavBridge {
  constructor(readonly rules: Rules) {
    if (!recastReady()) recast(); // throws the init message: recast-navigation loads once, asynchronously, before createRun
    this.contestFilter = { enter: { [AREA.hazard]: rules.nav.hazardCost } };
  }
  /** the current map's navigation (null until the first query, and after reset or dispose) */
  nav: NavWorld | null = null;
  private T: TileExt | null = null;
  private gen = -1;
  private snap: Snapshot | null = null;
  private seam: NavSeam | null = null;
  private base: WorldQuery | null = null;
  /** the player's point (the 'player' goal) */
  px = 0; py: RefY = undefined; pz = 0;
  /** full builds (map entries) and incremental updates (geometry changes), and the navmesh tiles they rebuilt */
  builds = 0; updates = 0; tilesRebuilt = 0;
  /** a profiling clock (perf-sim sets it): time spent in navigation, builds and rebuilds included; never in the output */
  static clock: (() => number) | null = null;
  /** ms in navigation (with the clock), and each full build's time */
  ms = 0; buildMs: number[] = [];
  /** what the seam answered: navDir by result, the 1s that turned more than 30° off the straight line to the goal,
   *  navReached and navDist calls (tests/navseam.test.ts reads them) */
  answers = { dir1: 0, dir0: 0, dirHold: 0, turned: 0, reached: 0, dist: 0 };

  /** the navigation of tile world w, built at a new map, updated after a geometry change */
  navFor(w: WorldQuery): NavWorld {
    const t = w.tiles;
    if (t !== this.T || !this.nav) {
      this.nav?.dispose();
      const t0 = NavBridge.clock ? NavBridge.clock() : 0;
      const m = liveMap(t);
      this.nav = NavWorld.build(fromArenaMap(m), this.rules);
      if (NavBridge.clock) this.buildMs.push(NavBridge.clock() - t0);
      this.snap = snapshot(m);
      this.T = t; this.gen = t.geoGen;
      this.builds++;
    } else if (t.geoGen !== this.gen) {
      const m = liveMap(t), s = snapshot(m), half = t.half;
      const rects = changedTiles(this.snap!, s).map((k) => ({ x0: (k % t.w) - half, z0: ((k / t.w) | 0) - half, x1: (k % t.w) - half + 1, z1: ((k / t.w) | 0) - half + 1 }));
      if (rects.length) this.tilesRebuilt += this.nav.replace(fromArenaMap(m), rects).length;
      this.snap = s; this.gen = t.geoGen;
      this.updates++;
    }
    return this.nav;
  }

  /** the WorldQuery the systems see over w (worldOf's navigation swap) */
  seamFor(w: WorldQuery): WorldQuery {
    if (w !== this.base || !this.seam) { this.seam = new NavSeam(w, this); this.base = w; }
    return this.seam;
  }

  /** the field toward goal `goal` for group g (null where the goal has no polygon near it) */
  fieldOf(w: WorldQuery, goal: NavGoal, g: number) {
    const N = this.navFor(w), R = this.rules.nav;
    if (goal === 'player') return N.field(g, 'player', this.px, this.py, this.pz, R.goalSnap);
    const H = w.tiles.hab;
    if (!H) return null;
    const half = w.tiles.half;
    return N.field(g, 'contest', H.contest.x - half, H.contest.h, H.contest.y - half, R.goalSnap, this.contestFilter);
  }
  /** the contest field's prices: vent fields (AREA.hazard) at rules.nav.hazardCost */
  private readonly contestFilter: { enter: Record<number, number> };

  /**
   * ROADMAP F2 on the navmesh: where a body in a liquid it is not safe in heads for (hazards.ts), in place of the tile
   * World's shore search. The nearest point within rules.nav.shoreReach of its group's navmesh that the player's field
   * reaches (so never a pocket), its floor within the layer tolerance of the body's feet. Bounded: NavGraph.nearest reads
   * at most (2 * ceil(shoreReach / 2) + 1)² = 289 locate buckets (shoreReach 16 m). Null when there is none.
   */
  shoreFor(w: WorldQuery, x: number, y: number, z: number, wide: boolean, diag: boolean): [number, number] | null {
    const t0 = NavBridge.clock ? NavBridge.clock() : 0, g = groupOf(wide, diag), F = this.fieldOf(w, 'player', g), P = this.shorePt;
    const found = this.nav!.nearestReached(g, F, x, y, z, this.rules.nav.shoreReach, P);
    this.shoreSearches++;
    if (NavBridge.clock) this.ms += NavBridge.clock() - t0;
    return found ? [P[0], P[2]] : null;
  }
  private shorePt = new Float64Array(3);
  /** shore searches answered (perf-sim and the F2 test count them) */
  shoreSearches = 0;

  /** free the navigation (a map change; the next query builds the new one) */
  reset(): void {
    this.nav?.dispose();
    this.nav = null; this.T = null; this.gen = -1; this.snap = null; this.seam = null; this.base = null;
  }

  dispose(): void { this.reset(); }
}

/** A WorldQuery with its navigation members on the navmesh: every other member is forwarded unchanged. */
export class NavSeam implements WorldQuery {
  constructor(private readonly w: WorldQuery, private readonly bridge: NavBridge) {}
  get bound() { return this.w.bound; }
  get killY() { return this.w.killY; }
  get spawn() { return this.w.spawn; }
  get anchors() { return this.w.anchors; }
  get tiles(): TileExt { return this.w.tiles; }
  /** I1b: the partner's character controller (the World's, on physics; ROADMAP F64) */
  get mover() { return this.w.mover; }
  surfaceAt(x: number, y: RefY, z: number): number { return this.w.surfaceAt(x, y, z); }
  supportAt(x: number, y: RefY, z: number): number { return this.w.supportAt(x, y, z); }
  liquidContact(x: number, y: number, z: number, contact: number): number { return this.w.liquidContact(x, y, z, contact); }
  headroomOver(x: number, y: number, z: number, r: number): number { return this.w.headroomOver(x, y, z, r); }
  moveFootprint(x: number, y: number, z: number, dx: number, dz: number, step: number, r: number, out: [number, number], stop?: (x: number, z: number) => boolean, tall?: number, over?: boolean): void {
    this.w.moveFootprint(x, y, z, dx, dz, step, r, out, stop, tall, over);
  }
  solidFor(x: number, y: number, z: number, step: number, tall?: number, over?: boolean): boolean { return this.w.solidFor(x, y, z, step, tall, over); }
  blockedFor(x: number, y: number, z: number, step: number, tall?: number, over?: boolean): boolean { return this.w.blockedFor(x, y, z, step, tall, over); }
  fitsAt(x: number, y: number, z: number, r: number, step?: number, tall?: number, over?: boolean): boolean { return this.w.fitsAt(x, y, z, r, step, tall, over); }
  topBelow(x: number, y: number, z: number, r: number): number { return this.w.topBelow(x, y, z, r); }
  insideRock(x: number, y: number, z: number, over?: boolean): boolean { return this.w.insideRock(x, y, z, over); }
  raycast(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxT: number, mask: number, hit: RayHit, r?: number, h?: number, flags?: number): boolean {
    return this.w.raycast(ox, oy, oz, dx, dy, dz, maxT, mask, hit, r, h, flags);
  }
  segmentClear(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, mask?: number, flags?: number): boolean { return this.w.segmentClear(x0, y0, z0, x1, y1, z1, mask, flags); }
  solidAt(x: number, y: number, z: number, mask?: number, flags?: number): number { return this.w.solidAt(x, y, z, mask, flags); }
  sight(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): boolean { return this.w.sight(x0, y0, z0, x1, y1, z1); }
  walkableAt(x: number, y: RefY, z: number): boolean { return this.w.walkableAt(x, y, z); }
  nearestWalkableAt(x: number, y: RefY, z: number): [number, number] { return this.w.nearestWalkableAt(x, y, z); }
  place(x: number, y: RefY, z: number, r: number, wide: boolean, reach?: boolean, tall?: number): [number, number] { return this.w.place(x, y, z, r, wide, reach, tall); }
  // ---- on the navmesh
  setNavGoal(x: number, y: RefY, z: number): void {
    this.w.setNavGoal(x, y, z);
    const B = this.bridge, t0 = NavBridge.clock ? NavBridge.clock() : 0;
    B.px = x; B.py = y; B.pz = z;
    B.navFor(this.w);
    if (NavBridge.clock) B.ms += NavBridge.clock() - t0;
  }
  navDir(goal: NavGoal, x: number, y: RefY, z: number, out: [number, number], wide?: boolean, diag?: boolean, _tall?: number): -1 | 0 | 1 {
    const B = this.bridge, t0 = NavBridge.clock ? NavBridge.clock() : 0, g = groupOf(wide, diag), F = B.fieldOf(this.w, goal, g);
    const r = B.nav!.steer(g, F, x, y, z, B.rules.nav.snap, out), A = B.answers;
    if (NavBridge.clock) B.ms += NavBridge.clock() - t0;
    if (r === 1) {
      A.dir1++;
      const gx = F!.gx - x, gz = F!.gz - z, L = Math.sqrt(gx * gx + gz * gz);
      if (L > 1e-6 && (out[0] * gx + out[1] * gz) / L < 0.866) A.turned++;
    } else if (r === 0) A.dir0++; else A.dirHold++;
    return r < 0 && !wide ? 0 : r;
  }
  navReached(_goal: 'player', x: number, y: RefY, z: number, diag?: boolean, _tall?: number): boolean {
    const B = this.bridge, g = groupOf(true, diag);
    B.answers.reached++;
    const t0 = NavBridge.clock ? NavBridge.clock() : 0, ok = B.nav!.reaches(g, B.fieldOf(this.w, 'player', g), x, y, z, B.rules.nav.reachSnap);
    if (NavBridge.clock) B.ms += NavBridge.clock() - t0;
    return ok;
  }
  navDist(_goal: 'player', x: number, y: RefY, z: number): number {
    const B = this.bridge;
    B.answers.dist++;
    const t0 = NavBridge.clock ? NavBridge.clock() : 0, d = B.nav!.distance(0, B.fieldOf(this.w, 'player', 0), x, y, z, B.rules.nav.snap);
    if (NavBridge.clock) B.ms += NavBridge.clock() - t0;
    return d;
  }
}
