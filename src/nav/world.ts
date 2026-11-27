// NavWorld: one map's navigation (task I3; docs/OVERHAUL_3D.md "Navigation (I3)"). Built from a WorldModel: a tiled
// navmesh per width group (src/nav/build.ts), each read back into a NavGraph (src/nav/graph.ts), the volume-routing
// graph's reader (src/nav/routes.ts), and the goal fields the sim steers by. It reads navInput, colliders and hazard
// volumes; never `spaces` (WORLDGEN3D Q2).
//   width groups (WORLDGEN3D Q7)  narrow (Tiny, Small, Medium), large, xl; rules.nav.groups gives each its agent in cells
//   geometry changes              replace(model, rect): the tiles whose build reads the changed rectangle are rebuilt,
//                                 the graphs read back, every field recomputed at its next use
//   temporary objects             addObstacle / removeObstacle, then update(): TileCache-style, only the tiles they
//                                 touch are rebuilt (WORLDGEN3D Q20.2(b), Q21.7(b))
// Ownership: dispose() frees every navmesh and the soup in wasm (sim/navseam.ts NavBridge calls it on map changes and
// sim/run.ts disposeRun).

import type { Rules } from '../rules/defaults';
import type { Aabb, WorldModel } from '../world/model';
import { isAdapterModel } from '../world/adapter';
import { NavSoup, NavTiles, type AgentCells, type NavConfig, type Obstacle } from './build';
import { NavGraph, NONE, type DropConfig, type Field, type FieldFilter } from './graph';
import { VolumeRoutes } from './routes';

/** the shared Recast settings of rules.nav */
export function navConfig(rules: Rules): NavConfig {
  const N = rules.nav;
  return {
    cs: N.cs, ch: N.ch, walkableClimb: N.walkableClimb, recastClimb: N.recastClimb, walkableSlopeAngle: N.walkableSlopeAngle, tileSize: N.tileSize, inset: N.inset,
    maxSimplificationError: N.maxSimplificationError, maxEdgeLen: N.maxEdgeLen, minRegionArea: N.minRegionArea, mergeRegionArea: N.mergeRegionArea,
    maxVertsPerPoly: N.maxVertsPerPoly,
  };
}

export type GroupName = 'narrow' | 'large' | 'xl';
/** the width groups in ascending agent height (rules.nav.groups' order is checked) */
export const GROUPS: readonly GroupName[] = ['narrow', 'large', 'xl'];

/** the groups rules.nav defines for a map (adapter: rules.nav.adapterRadius overrides a group's radius, the owner's F77
 *  decision), plus extras (the giant report adds one), in ascending agent height */
export function groupsOf(rules: Rules, extra: { name: string; agent: AgentCells }[] = [], adapter = false): { name: string; agent: AgentCells }[] {
  const A = rules.nav.adapterRadius as Partial<Record<GroupName, number>>;
  const agent = (g: GroupName): AgentCells => adapter && A[g] !== undefined ? { ...rules.nav.groups[g], radius: A[g]! } : rules.nav.groups[g];
  const out = [...GROUPS.map((g) => ({ name: g as string, agent: agent(g) })), ...extra];
  return out.sort((a, b) => a.agent.height - b.agent.height);
}

/** I1c: drop links for a build (rules.nav.drops, on the 3D stack only): `check(g, …)` is the sim's validation of a
 *  candidate for group g (DropConfig.check) */
export interface DropOptions {
  rules: { sample: number; min: number; max: number; probes: readonly number[] };
  check?: (g: number, x0: number, y0: number, z0: number, nx: number, nz: number, d: number, y1: number) => boolean;
}

/** the default field filter (one object, so a goal's cache sees the same filter) */
const NO_FILTER: FieldFilter = {};

/** a goal's cached field per group, and the goal point it was last asked for (y NaN: no reference height) */
interface Goal { filter: FieldFilter; fields: (Field | null)[]; polys: Int32Array; qx: Float64Array; qy: Float64Array; qz: Float64Array; asked: Uint8Array }

export class NavWorld {
  readonly tiles: NavTiles;
  readonly graphs: NavGraph[];
  readonly names: string[];
  readonly routes: VolumeRoutes;
  /** bumped by every rebuild (geometry or obstacles): fields are recomputed at their next use */
  version = 0;
  /** fields computed (each goal per group) */
  fieldsBuilt = 0;
  private goals = new Map<string, Goal>();
  private readonly pt = new Float64Array(3);
  private readonly corner = new Float64Array(2);

  private constructor(model: WorldModel, readonly cfg: NavConfig, groups: { name: string; agent: AgentCells }[], bounds: Aabb, layer: number, drops: DropOptions | null) {
    this.tiles = new NavTiles(new NavSoup(model, cfg.inset), cfg, groups);
    this.tiles.buildAll();
    this.names = this.tiles.groups.map((g) => g.name);
    const org: [number, number] = [bounds.min[0], bounds.min[2]], size: [number, number] = [bounds.max[0] - bounds.min[0], bounds.max[2] - bounds.min[2]];
    const dropCfg = (gi: number, agent: AgentCells): DropConfig | null => {
      if (!drops) return null;
      const D = drops.rules, ck = drops.check;
      return { sample: D.sample, min: D.min, max: D.max, probes: D.probes, radius: agent.radius * cfg.cs, check: ck ? (x0, y0, z0, nx, nz, d, y1) => ck(gi, x0, y0, z0, nx, nz, d, y1) : undefined };
    };
    this.graphs = this.tiles.groups.map((g, gi) => new NavGraph(g.navMesh, model.navInput.links, org, size, layer, dropCfg(gi, g.agent)));
    this.routes = new VolumeRoutes(model.navInput.routes);
  }

  /** build every width group's navmesh for `model` (rules.nav; an adapter map's radii from rules.nav.adapterRadius;
   *  `extra` groups for reports) */
  static build(model: WorldModel, rules: Rules, extra: { name: string; agent: AgentCells }[] = [], drops: DropOptions | null = null): NavWorld {
    return new NavWorld(model, navConfig(rules), groupsOf(rules, extra, isAdapterModel(model)), model.bounds, rules.nav.layer, drops);
  }

  /** a group's index by name (-1 when absent) */
  group(name: string): number { return this.names.indexOf(name); }

  /** a geometry change: `model` is the map's new state (same bounds); the tiles reading `rect` (plan, m) are rebuilt.
   *  Returns the tiles rebuilt */
  replace(model: WorldModel, rects: { x0: number; z0: number; x1: number; z1: number }[]): number[] {
    const touched = new Set<number>();
    for (const r of rects) for (const t of this.tiles.tilesTouching(r.x0, r.z0, r.x1, r.z1)) touched.add(t);
    const list = [...touched].sort((a, b) => a - b);
    this.tiles.setSoup(new NavSoup(model, this.cfg.inset), list);
    this.reread();
    return list;
  }

  /** temporary objects (TileCache-style): their tiles rebuild at update() */
  addObstacle(o: Obstacle): number { return this.tiles.addObstacle(o); }
  removeObstacle(id: number): boolean { return this.tiles.removeObstacle(id); }
  /** rebuild the tiles obstacles touched; returns them */
  update(): number[] {
    const list = this.tiles.update();
    if (list.length) this.reread();
    return list;
  }

  private reread() {
    for (const G of this.graphs) G.extract();
    this.version++;
    for (const goal of this.goals.values()) { goal.fields.fill(null); goal.polys.fill(NONE); goal.asked.fill(0); }
  }

  /** the polygon of group g under (x, y, z) within `snap` (NONE), the point on it in `out` */
  locate(g: number, x: number, y: number | undefined, z: number, snap: number, out: Float64Array = this.pt): number {
    return this.graphs[g].locate(x, y, z, snap, out);
  }

  /**
   * The field of goal `key` for group g, the goal at (x, y, z) (located within `snap`; with no polygon there the field
   * is empty). It is recomputed only when the goal's polygon or the navmesh changed, so the goal point may move within
   * its polygon freely (the corridor's end follows it).
   */
  field(g: number, key: string, x: number, y: number | undefined, z: number, snap: number, filter: FieldFilter = NO_FILTER): Field | null {
    let goal = this.goals.get(key);
    if (!goal) {
      const n = this.graphs.length;
      goal = { filter, fields: this.graphs.map(() => null), polys: new Int32Array(n).fill(NONE), qx: new Float64Array(n), qy: new Float64Array(n), qz: new Float64Array(n), asked: new Uint8Array(n) };
      this.goals.set(key, goal);
    }
    // the same goal point as the last ask (the player between its moves; a fixed contest): the same answer
    const qy = y === undefined ? NaN : y;
    if (goal.asked[g] && goal.filter === filter && goal.qx[g] === x && goal.qz[g] === z && (goal.qy[g] === qy || (qy !== qy && goal.qy[g] !== goal.qy[g]))) return goal.fields[g];
    goal.filter = filter; goal.asked[g] = 1; goal.qx[g] = x; goal.qy[g] = qy; goal.qz[g] = z;
    const G = this.graphs[g], P = this.pt, p = G.locate(x, y, z, snap, P);
    if (p === NONE) { goal.polys[g] = NONE; return (goal.fields[g] = null); }
    let F = goal.fields[g];
    if (!F || goal.polys[g] !== p) {
      F = G.field(p, P[0], P[1], P[2], filter, F ?? undefined);
      goal.polys[g] = p;
      this.fieldsBuilt++;
    } else { F.gx = P[0]; F.gy = P[1]; F.gz = P[2]; }
    goal.fields[g] = F;
    return F;
  }

  /**
   * Steering along field F for group g from (x, y, z): the unit direction to the corridor's first corner in out.
   *  1  a direction;  0  none needed (the agent is on the goal's polygon: straight is clear);  -1  no route (off the
   *  navmesh beyond `snap`, or on a polygon the field does not reach)
   */
  steer(g: number, F: Field | null, x: number, y: number | undefined, z: number, snap: number, out: [number, number]): -1 | 0 | 1 {
    if (!F) return -1;
    const G = this.graphs[g], p = G.locate(x, y, z, snap, this.pt);
    if (p === NONE || !(F.cost[p] < Infinity)) return -1;
    if (p === F.goal) return 0;
    if (!G.corner(F, p, x, z, this.corner)) return -1;
    const dx = this.corner[0] - x, dz = this.corner[1] - z, L = Math.sqrt(dx * dx + dz * dz);
    if (!(L > 1e-6)) return 0;
    out[0] = dx / L; out[1] = dz / L;
    return 1;
  }

  /** is (x, y, z) on a polygon of group g that field F reaches (within `snap`)? */
  reaches(g: number, F: Field | null, x: number, y: number | undefined, z: number, snap: number): boolean {
    if (!F) return false;
    const p = this.graphs[g].locate(x, y, z, snap, this.pt);
    return p !== NONE && F.cost[p] < Infinity;
  }

  /** the route length (m) from (x, y, z) along field F, Infinity where there is none */
  distance(g: number, F: Field | null, x: number, y: number | undefined, z: number, snap: number): number {
    if (!F) return Infinity;
    const G = this.graphs[g], P = this.pt, p = G.locate(x, y, z, snap, P);
    return G.distance(F, p, P[0], P[1], P[2]);
  }

  /** the nearest point within `reach` of group g's navmesh that field F reaches (its floor within the layer tolerance of
   *  feet at y), into out; false when there is none. Bounded by NavGraph.nearest's bucket count */
  nearestReached(g: number, F: Field | null, x: number, y: number, z: number, reach: number, out: Float64Array): boolean {
    if (!F) return false;
    return this.graphs[g].nearest(x, y, z, reach, (p) => F.cost[p] < Infinity, out) !== NONE;
  }

  /**
   * I1c: the drop link of polygon p in group g that a move from (ox, oz) to (x, z) crosses, and that brings the walker
   * nearer F's goal (its landing polygon's cost below p's); NONE when there is none. Crossing: the move goes from the
   * polygon's side of the drop's edge to its outer side, through the drop's stretch of the edge.
   */
  dropCrossed(g: number, F: Field | null, p: number, ox: number, oz: number, x: number, z: number): number {
    if (!F || p === NONE) return NONE;
    const G = this.graphs[g];
    if (!(F.cost[p] < Infinity)) return NONE;
    for (let q = G.aOff[p]; q < G.aOff[p + 1]; q++) {
      const d = G.dropOf[q];
      if (d === NONE) continue;
      const D = G.drops[d];
      if (!(F.cost[D.to] < F.cost[p])) continue;
      const s0 = (ox - D.ax) * D.nx + (oz - D.az) * D.nz, s1 = (x - D.ax) * D.nx + (z - D.az) * D.nz;
      if (!(s1 > 0) || s0 > 0) continue;
      const f = s0 === s1 ? 0 : s0 / (s0 - s1), cx = ox + (x - ox) * f, cz = oz + (z - oz) * f;
      const ex = D.bx - D.ax, ez = D.bz - D.az, L2 = ex * ex + ez * ez;
      const t = L2 > 0 ? ((cx - D.ax) * ex + (cz - D.az) * ez) / L2 : 0;
      if (t >= 0 && t <= 1) return d;
    }
    return NONE;
  }

  /** the drop links of group g (I1c) */
  drops(g: number) { return this.graphs[g].drops; }

  dispose(): void { this.tiles.dispose(); this.goals.clear(); }
}
