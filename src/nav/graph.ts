// The navigation graph (task I3; docs/OVERHAUL_3D.md "Navigation (I3)"): one width group's Detour navmesh read back into
// plain JS arrays, and the three queries the sim asks of it.
//   locate   the polygon under a point: of those whose plan contains it, the floor nearest the feet within `layer` (the
//            lowest with no reference height, the tile World's ground layer), else the nearest within `snap`
//   field    the cost to a goal from every polygon: Dijkstra from the goal's polygon over the edges into each polygon,
//            each step costing the distance between consecutive portal midpoints (Detour's own path cost), an area
//            price on entering a polygon, off-mesh links only for agents holding every capability they need
//   corner   corridor following: from the agent's polygon the corridor is the field's next polygons toward the goal (up
//            to CORRIDOR of them); its portals are string-pulled from the agent (Detour's findStraightPath funnel) and
//            the first corner is where to head
// Everything is a function of the navmesh and the query: no clock, no RNG, + − × ÷ and Math.sqrt only, ties broken by
// polygon index, so the same inputs give the same paths on every platform. Detour's polygons and links are the source;
// nothing here reads spaces (WORLDGEN3D Q2).

import type { NavMesh } from '@recast-navigation/core';
import { recast } from './recast';
import type { OffMeshLink } from '../world/model';

/** polygons in a corridor the funnel reads at most */
export const CORRIDOR = 32;
/** "no polygon" */
export const NONE = -1;
/** plan bucket for locate (m) */
const LB = 2;
/** Detour: the internal-link side marker, DT_POLYTYPE_OFFMESH_CONNECTION (DT_NULL_LINK comes from the binding: the
 *  WebIDL getters return the unsigned 0xffffffff as -1) */
const SIDE_INTERNAL = 0xff, OFFMESH = 1;

/** how a field prices the map */
export interface FieldFilter {
  /** AREA id -> cost added on entering a polygon of it (m); absent: 0 */
  enter?: Readonly<Partial<Record<number, number>>>;
  /** capabilities the agents hold (OffMeshLink.needs) */
  caps?: readonly string[];
}

/** a distance field toward one goal */
export interface Field {
  /** the goal polygon and point */
  goal: number; gx: number; gy: number; gz: number;
  /** cost (m) per polygon from its exit point, Infinity unreached */
  cost: Float64Array;
  /** the next polygon toward the goal, NONE at the goal and where unreached */
  next: Int32Array;
  /** the adjacency entry (this polygon's own edge) taken to the next polygon */
  via: Int32Array;
  /** where each polygon is left toward the goal (the portal midpoint; the goal point at the goal) */
  ex: Float64Array; ey: Float64Array; ez: Float64Array;
}

export class NavGraph {
  /** polygon count; per polygon: vertex range in vx/vy/vz, area, off-mesh link index (or NONE) */
  n = 0;
  vOff = new Int32Array(1);
  vx = new Float64Array(0); vy = new Float64Array(0); vz = new Float64Array(0);
  area = new Uint8Array(0);
  link = new Int32Array(0);
  /** outgoing adjacency (CSR, by target index): the neighbour and the portal on this polygon's edge, left and right */
  aOff = new Int32Array(1);
  aTo = new Int32Array(0);
  pl = new Float64Array(0); pr = new Float64Array(0);
  /** incoming adjacency (CSR, by source index): the outgoing entry that reaches this polygon */
  iOff = new Int32Array(1);
  iEdge = new Int32Array(0);
  /** the source polygon of each outgoing entry */
  aFrom = new Int32Array(0);
  private bucket: Int32Array[] = [];
  private bw = 1; private bh = 1;
  /** extractions (map entry and every rebuild) */
  extracts = 0;

  /** `origin` and `size`: the plan rectangle locate buckets (the map's bounds); `layer`: locate's floor tolerance (m) */
  constructor(private readonly navMesh: NavMesh, private readonly links: readonly OffMeshLink[], private readonly origin: readonly [number, number], private readonly size: readonly [number, number], private readonly layer: number) {
    this.extract();
  }

  /** read every tile of the navmesh again (after tiles were rebuilt) */
  extract(): void {
    const R = recast(), raw = this.navMesh.raw as unknown as RawNavMesh, M = raw.getMaxTiles();
    const tiles: { t: RawTile; x: number; y: number; base: number; n: number; ob: number }[] = [];
    for (let i = 0; i < M; i++) {
      const t = raw.getTile(i), h = t.get_header();
      if (!h || R.Raw.isNull(h) || h.get_polyCount() === 0) continue;
      tiles.push({ t, x: h.get_x(), y: h.get_y(), base: raw.getPolyRefBase(t), n: h.get_polyCount(), ob: h.get_offMeshBase() });
    }
    // tiles in grid order (z, then x), polygons in tile order: a stable index whatever slots Detour gave the tiles
    tiles.sort((a, b) => a.y - b.y || a.x - b.x);
    const NULL_LINK = R.Detour.DT_NULL_LINK;
    const refIndex = new Map<number, number>(), polys: { T: (typeof tiles)[0]; p: number; poly: RawPoly; nv: number }[] = [];
    for (const T of tiles) for (let p = 0; p < T.n; p++) {
      const poly = T.t.get_polys(p);
      refIndex.set(T.base | p, polys.length);
      polys.push({ T, p, poly, nv: poly.get_vertCount() });
    }
    const n = polys.length, vOff = new Int32Array(n + 1);
    for (let i = 0; i < n; i++) vOff[i + 1] = vOff[i] + polys[i].nv;
    const vx = new Float64Array(vOff[n]), vy = new Float64Array(vOff[n]), vz = new Float64Array(vOff[n]);
    const area = new Uint8Array(n), link = new Int32Array(n).fill(NONE);
    for (let i = 0; i < n; i++) {
      const { T, p, poly, nv } = polys[i];
      for (let k = 0; k < nv; k++) { const v = poly.get_verts(k); vx[vOff[i] + k] = T.t.get_verts(3 * v); vy[vOff[i] + k] = T.t.get_verts(3 * v + 1); vz[vOff[i] + k] = T.t.get_verts(3 * v + 2); }
      const at = poly.get_areaAndtype();
      area[i] = at & 0x3f;
      if (at >> 6 === OFFMESH) link[i] = T.t.get_offMeshCons(p - T.ob).get_userId();
    }
    // an off-mesh polygon's link to land polygon L names the vertex (0 start, 1 end) on L's side (Detour's portal)
    const offEnd = new Map<number, number>();
    const linkList: { i: number; to: number; e: number; side: number; bmin: number; bmax: number }[][] = [];
    for (let i = 0; i < n; i++) {
      const { T, poly } = polys[i], out: (typeof linkList)[0] = [];
      for (let L = poly.get_firstLink(); L !== NULL_LINK && L !== 0xffffffff; ) {
        const lk = T.t.get_links(L), to = refIndex.get(lk.get_ref());
        if (to !== undefined) {
          out.push({ i, to, e: lk.get_edge(), side: lk.get_side(), bmin: lk.get_bmin(), bmax: lk.get_bmax() });
          if (link[i] !== NONE) offEnd.set(i * n + to, lk.get_edge());
        }
        L = lk.get_next();
      }
      out.sort((a, b) => a.to - b.to);
      linkList.push(out);
    }
    const aOff = new Int32Array(n + 1);
    for (let i = 0; i < n; i++) aOff[i + 1] = aOff[i] + linkList[i].length;
    const E = aOff[n], aTo = new Int32Array(E), pl = new Float64Array(3 * E), pr = new Float64Array(3 * E);
    const vert = (i: number, k: number, o: Float64Array, at: number) => { const q = vOff[i] + k; o[at] = vx[q]; o[at + 1] = vy[q]; o[at + 2] = vz[q]; };
    for (let i = 0; i < n; i++) linkList[i].forEach((lk, k) => {
      const q = aOff[i] + k, to = lk.to, nv = vOff[i + 1] - vOff[i];
      aTo[q] = to;
      if (link[i] !== NONE) { vert(i, lk.e, pl, 3 * q); vert(i, lk.e, pr, 3 * q); return; }
      if (link[to] !== NONE) { const e = offEnd.get(to * n + i) ?? 0; vert(to, e, pl, 3 * q); vert(to, e, pr, 3 * q); return; }
      // Detour's getPortalPoints: this polygon's edge, cut to the link's sub-range on a tile border
      vert(i, lk.e, pl, 3 * q); vert(i, (lk.e + 1) % nv, pr, 3 * q);
      if (lk.side !== SIDE_INTERNAL && (lk.bmin !== 0 || lk.bmax !== 255)) {
        const s = 1 / 255, t0 = lk.bmin * s, t1 = lk.bmax * s;
        for (let c = 0; c < 3; c++) { const a = pl[3 * q + c], b = pr[3 * q + c]; pl[3 * q + c] = a + (b - a) * t0; pr[3 * q + c] = a + (b - a) * t1; }
      }
    });
    // incoming edges, by source index then entry
    const cnt = new Int32Array(n + 1);
    for (let q = 0; q < E; q++) cnt[aTo[q] + 1]++;
    for (let i = 0; i < n; i++) cnt[i + 1] += cnt[i];
    const fill = cnt.slice(), iEdge = new Int32Array(E), aFrom = new Int32Array(E);
    for (let i = 0; i < n; i++) for (let q = aOff[i]; q < aOff[i + 1]; q++) { iEdge[fill[aTo[q]]++] = q; aFrom[q] = i; }
    Object.assign(this, { n, vOff, vx, vy, vz, area, link, aOff, aTo, pl, pr, iOff: cnt, iEdge, aFrom });
    this.index();
    this.extracts++;
  }

  /** plan buckets of the land polygons, with each polygon's plan bounds and winding */
  private index() {
    this.pb = new Float64Array(4 * this.n); this.wind = new Int8Array(this.n); this.flat = new Uint8Array(this.n);
    for (let p = 0; p < this.n; p++) {
      const o = this.vOff[p], nv = this.vOff[p + 1] - o;
      let a = Infinity, b = -Infinity, c = Infinity, d = -Infinity, area = 0;
      for (let i = 0, j = nv - 1; i < nv; j = i++) {
        const x = this.vx[o + i], z = this.vz[o + i];
        if (x < a) a = x; if (x > b) b = x; if (z < c) c = z; if (z > d) d = z;
        area += this.vx[o + j] * z - x * this.vz[o + j];
      }
      this.pb[4 * p] = a; this.pb[4 * p + 1] = b; this.pb[4 * p + 2] = c; this.pb[4 * p + 3] = d;
      this.wind[p] = area >= 0 ? 1 : -1;
      let f = 1;
      for (let k = o + 1; k < o + nv; k++) if (this.vy[k] !== this.vy[o]) { f = 0; break; }
      this.flat[p] = f;
    }
    this.bw = Math.max(1, Math.ceil(this.size[0] / LB)); this.bh = Math.max(1, Math.ceil(this.size[1] / LB));
    const lists: number[][] = Array.from({ length: this.bw * this.bh }, () => []);
    for (let p = 0; p < this.n; p++) {
      if (this.link[p] !== NONE) continue;
      let a = Infinity, b = -Infinity, c = Infinity, d = -Infinity;
      for (let k = this.vOff[p]; k < this.vOff[p + 1]; k++) { a = Math.min(a, this.vx[k]); b = Math.max(b, this.vx[k]); c = Math.min(c, this.vz[k]); d = Math.max(d, this.vz[k]); }
      for (let j = this.bj(c); j <= this.bj(d); j++) for (let i = this.bi(a); i <= this.bi(b); i++) lists[j * this.bw + i].push(p);
    }
    this.bucket = lists.map((l) => Int32Array.from(l));
  }
  private bi(x: number) { return Math.min(this.bw - 1, Math.max(0, Math.floor((x - this.origin[0]) / LB))); }
  private bj(z: number) { return Math.min(this.bh - 1, Math.max(0, Math.floor((z - this.origin[1]) / LB))); }

  /** the floor height of polygon p at (x, z): its fan triangle containing the point, else its mean height */
  heightAt(p: number, x: number, z: number): number {
    const o = this.vOff[p], nv = this.vOff[p + 1] - o;
    if (this.flat[p]) return this.vy[o];
    for (let k = 1; k + 1 < nv; k++) {
      const h = triHeight(this.vx[o], this.vy[o], this.vz[o], this.vx[o + k], this.vy[o + k], this.vz[o + k], this.vx[o + k + 1], this.vy[o + k + 1], this.vz[o + k + 1], x, z);
      if (h === h) return h;
    }
    let s = 0;
    for (let k = 0; k < nv; k++) s += this.vy[o + k];
    return s / nv;
  }

  /** does polygon p's plan contain (x, z)? Detour's polygons are convex: inside (or on an edge) when no edge has the
   *  point on its outer side; the plan bounds reject first */
  contains(p: number, x: number, z: number): boolean {
    const b = 4 * p;
    if (x < this.pb[b] || x > this.pb[b + 1] || z < this.pb[b + 2] || z > this.pb[b + 3]) return false;
    const o = this.vOff[p], nv = this.vOff[p + 1] - o, w = this.wind[p];
    for (let i = 0, j = nv - 1; i < nv; j = i++) {
      const ax = this.vx[o + j], az = this.vz[o + j];
      if (((this.vx[o + i] - ax) * (z - az) - (this.vz[o + i] - az) * (x - ax)) * w < 0) return false;
    }
    return true;
  }
  /** per polygon: plan bounds (x0, x1, z0, z1) and winding (+1 / -1) */
  private pb = new Float64Array(0);
  private wind = new Int8Array(0);
  /** per polygon: every vertex at one height */
  private flat = new Uint8Array(0);

  /**
   * The polygon under (x, z) for feet at y, the point on it in out[0..2]: of the polygons whose plan contains the point,
   * the one whose floor there is nearest the feet within `layer` m (y undefined: the lowest floor, the tile World's
   * ground layer); else the nearest point of the nearest polygon within `snap` m in plan, its floor within `layer` of the
   * feet. NONE when there is none. A polygon's floor is read from its own vertices (no detail mesh), so a polygon that
   * spans flat ground and a ramp reads up to a ramp's rise off on the flat part: `layer` absorbs that and stays under the
   * rise of a deck over the ground (2.9 m on the tile maps).
   */
  locate(x: number, y: number | undefined, z: number, snap: number, out: Float64Array): number {
    const L = this.bucket[this.bj(z) * this.bw + this.bi(x)], lay = this.layer;
    let best = NONE, bh = 0, bd = Infinity;
    for (let q = 0; q < L.length; q++) {
      const p = L[q];
      if (!this.contains(p, x, z)) continue;
      const h = this.heightAt(p, x, z);
      if (y === undefined) { if (best === NONE || h < bh) { best = p; bh = h; } continue; }
      const d = h > y ? h - y : y - h;
      if (d <= lay && d < bd) { best = p; bh = h; bd = d; }
    }
    if (best !== NONE) { out[0] = x; out[1] = bh; out[2] = z; return best; }
    if (!(snap > 0)) return NONE;
    let bp = snap * snap, by = 0;
    for (let j = this.bj(z - snap); j <= this.bj(z + snap); j++) for (let i = this.bi(x - snap); i <= this.bi(x + snap); i++) {
      const B = this.bucket[j * this.bw + i];
      for (let q = 0; q < B.length; q++) {
        const p = B[q], o = this.vOff[p], nv = this.vOff[p + 1] - o;
        // a polygon whose plan bounds lie farther than the best so far cannot hold a nearer point
        const pb = 4 * p, gx = x < this.pb[pb] ? this.pb[pb] - x : x > this.pb[pb + 1] ? x - this.pb[pb + 1] : 0, gz = z < this.pb[pb + 2] ? this.pb[pb + 2] - z : z > this.pb[pb + 3] ? z - this.pb[pb + 3] : 0;
        if (gx * gx + gz * gz > bp) continue;
        for (let a = 0, b = nv - 1; a < nv; b = a++) {
          const ax = this.vx[o + b], az = this.vz[o + b], ex = this.vx[o + a] - ax, ez = this.vz[o + a] - az, L2 = ex * ex + ez * ez;
          let t = L2 > 0 ? ((x - ax) * ex + (z - az) * ez) / L2 : 0;
          t = t < 0 ? 0 : t > 1 ? 1 : t;
          const cx = ax + ex * t, cz = az + ez * t, d = (cx - x) * (cx - x) + (cz - z) * (cz - z);
          if (d > bp) continue;
          const cy = this.vy[o + b] + (this.vy[o + a] - this.vy[o + b]) * t;
          if (y !== undefined && (cy > y ? cy - y : y - cy) > lay) continue;
          // nearer, or as near and (no reference) lower or (a reference) nearer the feet, or the same and a lower index
          const dy = y === undefined ? cy : cy > y ? cy - y : y - cy, bdy = y === undefined ? by : by > y ? by - y : y - by;
          const better = d < bp || (d === bp && (best === NONE || dy < bdy || (dy === bdy && p < best)));
          if (!better) continue;
          bp = d; best = p; by = cy; out[0] = cx; out[1] = cy; out[2] = cz;
        }
      }
    }
    return best;
  }

  /**
   * The nearest point within `reach` m in plan of a polygon `accept` takes, its floor within `layer` of feet at y, into
   * out[0..2]; NONE when there is none. Bounded: it reads the (2 * ceil(reach / 2) + 1)² locate buckets round the point.
   * Ties: the lower polygon index.
   */
  nearest(x: number, y: number, z: number, reach: number, accept: (p: number) => boolean, out: Float64Array): number {
    let best = NONE, bd = reach * reach;
    const lay = this.layer;
    this.visited = 0;
    for (let j = this.bj(z - reach); j <= this.bj(z + reach); j++) for (let i = this.bi(x - reach); i <= this.bi(x + reach); i++) {
      const B = this.bucket[j * this.bw + i];
      this.visited++;
      for (let q = 0; q < B.length; q++) {
        const p = B[q];
        if (!accept(p)) continue;
        if (this.contains(p, x, z)) {
          const h = this.heightAt(p, x, z);
          if ((h > y ? h - y : y - h) <= lay && (0 < bd || (0 === bd && p < best))) { bd = 0; best = p; out[0] = x; out[1] = h; out[2] = z; }
          continue;
        }
        const o = this.vOff[p], nv = this.vOff[p + 1] - o;
        for (let a = 0, b = nv - 1; a < nv; b = a++) {
          const ax = this.vx[o + b], az = this.vz[o + b], ex = this.vx[o + a] - ax, ez = this.vz[o + a] - az, L2 = ex * ex + ez * ez;
          let t = L2 > 0 ? ((x - ax) * ex + (z - az) * ez) / L2 : 0;
          t = t < 0 ? 0 : t > 1 ? 1 : t;
          const cx = ax + ex * t, cz = az + ez * t, d = (cx - x) * (cx - x) + (cz - z) * (cz - z);
          const cy = this.vy[o + b] + (this.vy[o + a] - this.vy[o + b]) * t;
          if ((cy > y ? cy - y : y - cy) > lay) continue;
          if (d < bd || (d === bd && p < best)) { bd = d; best = p; out[0] = cx; out[1] = cy; out[2] = cz; }
        }
      }
    }
    return best;
  }
  /** locate buckets the last nearest() read */
  visited = 0;

  /** may an agent holding `caps` take link polygon p? */
  private linkOpen(p: number, caps: readonly string[] | undefined): boolean {
    const L = this.links[this.link[p]];
    if (!L || !L.needs || L.needs.length === 0) return true;
    return !!caps && L.needs.every((c) => caps.includes(c));
  }

  /** the field toward (gx, gy, gz) on goal polygon g (NONE: an empty field) */
  field(g: number, gx: number, gy: number, gz: number, filter: FieldFilter = {}, reuse?: Field): Field {
    const n = this.n;
    const F: Field = reuse && reuse.cost.length === n ? reuse : { goal: g, gx, gy, gz, cost: new Float64Array(n), next: new Int32Array(n), via: new Int32Array(n), ex: new Float64Array(n), ey: new Float64Array(n), ez: new Float64Array(n) };
    F.goal = g; F.gx = gx; F.gy = gy; F.gz = gz;
    F.cost.fill(Infinity); F.next.fill(NONE); F.via.fill(NONE);
    if (g === NONE) return F;
    const heap = this.heap;
    heap.clear();
    F.cost[g] = 0; F.ex[g] = gx; F.ey[g] = gy; F.ez[g] = gz;
    heap.push(g, 0);
    const enter = filter.enter ?? {};
    while (heap.size > 0) {
      const a = heap.pop();
      if (heap.key > F.cost[a]) continue;
      const ca = F.cost[a];
      for (let s = this.iOff[a]; s < this.iOff[a + 1]; s++) {
        const q = this.iEdge[s], b = this.aFrom[q];
        if (this.link[b] !== NONE && !this.linkOpen(b, filter.caps)) continue;
        const mx = (this.pl[3 * q] + this.pr[3 * q]) / 2, my = (this.pl[3 * q + 1] + this.pr[3 * q + 1]) / 2, mz = (this.pl[3 * q + 2] + this.pr[3 * q + 2]) / 2;
        const dx = mx - F.ex[a], dy = my - F.ey[a], dz = mz - F.ez[a];
        const c = ca + Math.sqrt(dx * dx + dy * dy + dz * dz) + (enter[this.area[b]] ?? 0);
        if (c < F.cost[b] || (c === F.cost[b] && a < F.next[b])) {
          F.cost[b] = c; F.next[b] = a; F.via[b] = q; F.ex[b] = mx; F.ey[b] = my; F.ez[b] = mz;
          heap.push(b, c);
        }
      }
    }
    return F;
  }
  private heap = new Heap(2);

  /** the route cost (m) from point (x, y, z) on polygon p to F's goal, Infinity where there is none */
  distance(F: Field, p: number, x: number, y: number, z: number): number {
    if (p === NONE || !(F.cost[p] < Infinity)) return Infinity;
    const dx = F.ex[p] - x, dy = F.ey[p] - y, dz = F.ez[p] - z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz) + F.cost[p];
  }

  /**
   * Corridor following: from (x, z) on polygon p toward F's goal, the first corner of the string-pulled corridor into
   * out (x, z). Returns false when p is the goal polygon or has no route.
   */
  corner(F: Field, p: number, x: number, z: number, out: Float64Array): boolean {
    if (p === NONE || p === F.goal || !(F.cost[p] < Infinity)) return false;
    const m = this.portals(F, p, CORRIDOR);
    return funnel(this.funL, this.funR, m, x, z, out, 1) > 0;
  }
  /** the corridor's portals into funL / funR (plan), the last one the end point; returns the index of the end */
  private portals(F: Field, p: number, max: number): number {
    if (this.funL.length < 2 * (max + 1)) { this.funL = new Float64Array(2 * (max + 1)); this.funR = new Float64Array(2 * (max + 1)); }
    const L = this.funL, Rr = this.funR;
    let m = 0, a = p;
    while (a !== F.goal && m < max) {
      const q = F.via[a];
      L[2 * m] = this.pl[3 * q]; L[2 * m + 1] = this.pl[3 * q + 2]; Rr[2 * m] = this.pr[3 * q]; Rr[2 * m + 1] = this.pr[3 * q + 2];
      m++;
      a = F.next[a];
    }
    // the end: the goal, or (a truncated corridor) the farthest portal's midpoint in place of that portal
    let endX = F.gx, endZ = F.gz;
    if (a !== F.goal) { m--; endX = (L[2 * m] + Rr[2 * m]) / 2; endZ = (L[2 * m + 1] + Rr[2 * m + 1]) / 2; }
    L[2 * m] = endX; L[2 * m + 1] = endZ; Rr[2 * m] = endX; Rr[2 * m + 1] = endZ;
    return m;
  }
  private funL = new Float64Array(2 * (CORRIDOR + 1));
  private funR = new Float64Array(2 * (CORRIDOR + 1));

  /** the whole straight path (Detour's findStraightPath corners, the goal last) from (x, z) on p, for tools and tests;
   *  empty where there is no route, [goal] on the goal's polygon */
  straight(F: Field, p: number, x: number, z: number): [number, number][] {
    if (p === NONE || !(F.cost[p] < Infinity)) return [];
    if (p === F.goal) return [[F.gx, F.gz]];
    const m = this.portals(F, p, this.n), out = new Float64Array(2 * (m + 2));
    const k = funnel(this.funL, this.funR, m, x, z, out, m + 2);
    const pts: [number, number][] = [];
    for (let i = 0; i < k; i++) pts.push([out[2 * i], out[2 * i + 1]]);
    return pts;
  }

  /** the polygons of the corridor from p toward F's goal (all of it), for tests and tools */
  path(F: Field, p: number): number[] {
    const out: number[] = [];
    if (p === NONE || !(F.cost[p] < Infinity)) return out;
    for (let a = p; a !== NONE; a = F.next[a]) { out.push(a); if (a === F.goal) break; }
    return out;
  }
}

/**
 * Detour's funnel (dtNavMeshQuery::findStraightPath's string pulling) over portals 0..m (portal m is the end point,
 * left = right) from (x, z): up to `max` corners into out (x, z pairs), the end point last. Returns the count.
 */
function funnel(L: Float64Array, Rr: Float64Array, m: number, x: number, z: number, out: Float64Array, max: number): number {
  let apx = x, apz = z, lx = x, lz = z, rx = x, rz = z, li = 0, ri = 0, k = 0;
  for (let i = 0; i <= m; i++) {
    const plx = L[2 * i], plz = L[2 * i + 1], prx = Rr[2 * i], prz = Rr[2 * i + 1];
    if (i === 0 && m > 0 && segDist2(apx, apz, plx, plz, prx, prz) < 1e-6) continue;
    if (triArea2(apx, apz, rx, rz, prx, prz) <= 0) {
      if ((apx === rx && apz === rz) || triArea2(apx, apz, lx, lz, prx, prz) > 0) { rx = prx; rz = prz; ri = i; }
      else {
        out[2 * k] = lx; out[2 * k + 1] = lz; if (++k >= max) return k;
        apx = lx; apz = lz; rx = lx; rz = lz; ri = li; i = li; continue;
      }
    }
    if (triArea2(apx, apz, lx, lz, plx, plz) >= 0) {
      if ((apx === lx && apz === lz) || triArea2(apx, apz, rx, rz, plx, plz) < 0) { lx = plx; lz = plz; li = i; }
      else {
        out[2 * k] = rx; out[2 * k + 1] = rz; if (++k >= max) return k;
        apx = rx; apz = rz; lx = rx; lz = rz; li = ri; i = ri; continue;
      }
    }
  }
  out[2 * k] = L[2 * m]; out[2 * k + 1] = L[2 * m + 1];
  return k + 1;
}

/** Detour's dtTriArea2D in plan */
function triArea2(ax: number, az: number, bx: number, bz: number, cx: number, cz: number): number {
  const abx = bx - ax, abz = bz - az, acx = cx - ax, acz = cz - az;
  return acx * abz - abx * acz;
}
/** squared plan distance from (px, pz) to segment a-b */
function segDist2(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const ex = bx - ax, ez = bz - az, L2 = ex * ex + ez * ez;
  let t = L2 > 0 ? ((px - ax) * ex + (pz - az) * ez) / L2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const dx = ax + ex * t - px, dz = az + ez * t - pz;
  return dx * dx + dz * dz;
}
/** the height of triangle (a, b, c) at plan (x, z), NaN outside it */
function triHeight(ax: number, ay: number, az: number, bx: number, by: number, bz: number, cx: number, cy: number, cz: number, x: number, z: number): number {
  const v0x = cx - ax, v0z = cz - az, v1x = bx - ax, v1z = bz - az, v2x = x - ax, v2z = z - az;
  const den = v0x * v1z - v0z * v1x;
  if (den === 0) return NaN;
  const u = (v2x * v1z - v2z * v1x) / den, v = (v0x * v2z - v0z * v2x) / den, e = 1e-6;
  if (u < -e || v < -e || u + v > 1 + e) return NaN;
  return ay + (cy - ay) * u + (by - ay) * v;
}

/** a binary min-heap of polygon indices keyed (cost, index), with lazy deletion (the caller skips a stale pop) */
class Heap {
  private k: Float64Array; private v: Int32Array; size = 0;
  /** the popped entry's key */
  key = 0;
  constructor(cap: number) { this.k = new Float64Array(cap); this.v = new Int32Array(cap); }
  clear() { this.size = 0; }
  push(v: number, k: number) {
    if (this.size === this.k.length) { const K = new Float64Array(2 * this.size + 2), V = new Int32Array(2 * this.size + 2); K.set(this.k); V.set(this.v); this.k = K; this.v = V; }
    let i = this.size++;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.k[p] < k || (this.k[p] === k && this.v[p] <= v)) break;
      this.k[i] = this.k[p]; this.v[i] = this.v[p]; i = p;
    }
    this.k[i] = k; this.v[i] = v;
  }
  pop(): number {
    const top = this.v[0];
    this.key = this.k[0];
    const k = this.k[--this.size], v = this.v[this.size];
    let i = 0;
    for (;;) {
      let c = 2 * i + 1;
      if (c >= this.size) break;
      if (c + 1 < this.size && (this.k[c + 1] < this.k[c] || (this.k[c + 1] === this.k[c] && this.v[c + 1] < this.v[c]))) c++;
      if (k < this.k[c] || (k === this.k[c] && v <= this.v[c])) break;
      this.k[i] = this.k[c]; this.v[i] = this.v[c]; i = c;
    }
    this.k[i] = k; this.v[i] = v;
    return top;
  }
}

// the raw (WebIDL) Detour objects extraction reads
interface RawHeader { get_x(): number; get_y(): number; get_polyCount(): number; get_offMeshBase(): number }
interface RawPoly { get_firstLink(): number; get_verts(i: number): number; get_vertCount(): number; get_areaAndtype(): number }
interface RawLink { get_ref(): number; get_next(): number; get_edge(): number; get_side(): number; get_bmin(): number; get_bmax(): number }
interface RawTile { get_header(): RawHeader; get_polys(i: number): RawPoly; get_verts(i: number): number; get_links(i: number): RawLink; get_offMeshCons(i: number): { get_userId(): number } }
interface RawNavMesh { getMaxTiles(): number; getTile(i: number): RawTile; getPolyRefBase(t: RawTile): number }
