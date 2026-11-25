// The volume-routing graph's reader (task I3; WORLDGEN3D Q8(d)(e), Q9 "Data"; src/world/model.ts VolumeGraph):
// coarse routes for flyers, swimmers and divers between spaces. Nodes sit at portal and space centres at travel height;
// each edge has a medium ('air' or a liquid id), a clear radius, the capabilities a body needs to take it, and an
// optional state it exists in. Navigation may not read `spaces` (Q2), so this graph is all it knows of the volume.
// Bank exits are navInput links between this graph and the navmesh (none on adapter maps yet).
//   route(from, to, q)   the shortest node path (Dijkstra by edge length, ties by node index) for a body of radius
//                        q.radius in medium q.medium holding q.caps, in state q.state
//   nearest(p, q)        the node nearest p that has an edge such a body may take
// The tile adapter writes an empty graph; tests/nav.test.ts reads a hand-made one.

import type { CapabilityId, Medium, Vec3, VolumeGraph, When } from '../world/model';

export interface RouteQuery {
  medium: Medium;
  /** the body's clear radius (m): edges narrower than it are closed */
  radius: number;
  caps?: readonly CapabilityId[];
  /** the current feature or environment state; an edge with `when` exists only in it */
  state?: When;
}

export class VolumeRoutes {
  readonly n: number;
  private readonly adj: { to: number; e: number; len: number }[][];

  constructor(private readonly g: VolumeGraph) {
    this.n = g.nodes.length;
    this.adj = Array.from({ length: this.n }, () => []);
    g.edges.forEach((E, e) => {
      if (!(E.a >= 0 && E.a < this.n && E.b >= 0 && E.b < this.n) || E.a === E.b) throw new Error(`nav: volume route edge ${e} joins nodes ${E.a} and ${E.b} of ${this.n}`);
      const a = g.nodes[E.a].position, b = g.nodes[E.b].position, len = dist(a, b);
      this.adj[E.a].push({ to: E.b, e, len });
      this.adj[E.b].push({ to: E.a, e, len });
    });
    for (const l of this.adj) l.sort((p, q) => p.to - q.to || p.e - q.e);
  }

  /** may a body take edge e? */
  open(e: number, q: RouteQuery): boolean {
    const E = this.g.edges[e];
    if (E.medium !== q.medium || E.radius < q.radius) return false;
    if (E.needs && E.needs.length && !(q.caps && E.needs.every((c) => q.caps!.includes(c)))) return false;
    if (E.when && !sameState(E.when, q.state)) return false;
    return true;
  }

  /** the shortest node path from `from` to `to` (both included), null when there is none */
  route(from: number, to: number, q: RouteQuery): { nodes: number[]; edges: number[]; length: number } | null {
    if (from < 0 || from >= this.n || to < 0 || to >= this.n) return null;
    const cost = new Float64Array(this.n).fill(Infinity), prev = new Int32Array(this.n).fill(-1), via = new Int32Array(this.n).fill(-1), done = new Uint8Array(this.n);
    cost[from] = 0;
    for (;;) {
      let a = -1;
      for (let i = 0; i < this.n; i++) if (!done[i] && cost[i] < Infinity && (a < 0 || cost[i] < cost[a])) a = i;
      if (a < 0) return null;
      if (a === to) break;
      done[a] = 1;
      for (const { to: b, e, len } of this.adj[a]) {
        if (done[b] || !this.open(e, q)) continue;
        const c = cost[a] + len;
        if (c < cost[b] || (c === cost[b] && a < prev[b])) { cost[b] = c; prev[b] = a; via[b] = e; }
      }
    }
    const nodes: number[] = [], edges: number[] = [];
    for (let v = to; v >= 0; v = prev[v]) { nodes.push(v); if (via[v] >= 0) edges.push(via[v]); }
    return { nodes: nodes.reverse(), edges: edges.reverse(), length: cost[to] };
  }

  /** the node nearest p with an edge the body may take, -1 when none */
  nearest(p: Vec3, q: RouteQuery): number {
    let best = -1, bd = Infinity;
    for (let i = 0; i < this.n; i++) {
      if (!this.adj[i].some(({ e }) => this.open(e, q))) continue;
      const d = dist(p, this.g.nodes[i].position);
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  }
}

function dist(a: Vec3, b: Vec3): number { const x = a[0] - b[0], y = a[1] - b[1], z = a[2] - b[2]; return Math.sqrt(x * x + y * y + z * z); }
function sameState(w: When, s: When | undefined): boolean {
  if (!s) return false;
  if ('feature' in w) return 'feature' in s && s.feature === w.feature && s.state === w.state;
  return 'env' in s && s.env === w.env;
}
