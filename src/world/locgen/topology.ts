// Layer A — macro structure. Decide the playable structure before any geometry exists:
//   1. zone centres by dart throwing (hub near one edge, the boss glade/hall near the opposite one)
//   2. a planar candidate graph (Gabriel graph), a spanning tree, then loop edges chosen for the detour they save
//   3. tiers from the location's landform plus noise, repaired so every link climbs at most one tier
//   4. constraints: every raised zone (not a nook) has ≥ 2 links, so no high ground has a single choke to camp
//   5. zone kinds by degree (leaf = nook), link kinds by tier change (ramp) and exposure (bridge, path, trail)
//   6. entrances on the map edge (enemy approach regions) and player-only hop shortcuts between near tiers
import { dcos, dsin } from '../../core/detmath';
import { fbm } from '../../core/rng';
import type { LinkKind, ZoneKind } from '../locations/types';
import type { LocCtx, Zone } from './ctx';

export const MARGIN = 12;

const d2 = (a: { x: number; y: number }, b: { x: number; y: number }) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
const smooth = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

export function planTopology(g: LocCtx) {
  const R = g.rng('topology'), D = g.def, S = g.S, G = D.gameplay;
  g.landform = R.pick(D.freedoms.landforms);
  g.rot = R.int(0, 3); g.mir = R.chance(0.5);
  const span = S - MARGIN * 2;
  const canon = (u: number, v: number) => g.toMap(Math.round(MARGIN + u * span), Math.round(MARGIN + v * span));
  const mk = (kind: ZoneKind, x: number, y: number): Zone => ({ id: g.zones.length, kind, x, y, r: 0, rx: 0, ry: 0, tier: 0, h: 0, marks: [] });

  // 1. centres: hub toward the canonical south, boss toward the north, the rest by dart throwing
  const [hx, hy] = canon(R.range(0.3, 0.7), R.range(0.8, 0.88));
  const [bx, by] = canon(R.range(0.28, 0.72), R.range(0.1, 0.18));
  // pushed one at a time: mk() numbers a zone by the list length, so both built first would share id 0
  g.zones.push(mk('hub', hx, hy)); g.zones.push(mk('boss', bx, by));
  const N = R.int(D.freedoms.zones[0], D.freedoms.zones[1]);
  let dmin = 0.95 * Math.sqrt((span * span) / (N + 2));
  for (let pass = 0; pass < 6 && g.zones.length < N + 2; pass++) {
    for (let t = 0; t < 500 && g.zones.length < N + 2; t++) {
      const [x, y] = canon(R.next(), R.next());
      if (g.zones.some((z) => d2(z, { x, y }) < dmin * dmin)) continue;
      g.zones.push(mk('arena', x, y));
    }
    dmin *= 0.9;
  }

  // 2. candidate graph (Gabriel: no third centre inside the circle on the edge's diameter), spanning tree, loops
  const Z = g.zones, n = Z.length;
  const cand: [number, number, number][] = [];
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    const L2 = d2(Z[i], Z[j]);
    if (L2 > 52 * 52) continue;
    const mx = (Z[i].x + Z[j].x) / 2, my = (Z[i].y + Z[j].y) / 2;
    let ok = true;
    for (let k = 0; k < n && ok; k++) if (k !== i && k !== j && d2(Z[k], { x: mx, y: my }) < L2 / 4) ok = false;
    if (ok) cand.push([i, j, Math.sqrt(L2)]);
  }
  cand.sort((a, b) => a[2] - b[2] || a[0] - b[0] || a[1] - b[1]);
  const parent = Z.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const edges: [number, number][] = [];
  const rest: [number, number, number][] = [];
  for (const e of cand) {
    const ra = find(e[0]), rb = find(e[1]);
    if (ra !== rb) { parent[ra] = rb; edges.push([e[0], e[1]]); } else rest.push(e);
  }
  const loops = R.int(D.freedoms.loops[0], D.freedoms.loops[1]);
  // a loop edge earns its place by the detour it saves (graph distance ÷ straight length); ties by order
  const graphDist = (a: number, b: number) => {
    const dist = new Float64Array(n).fill(Infinity); dist[a] = 0;
    const done = new Uint8Array(n);
    for (;;) {
      let u = -1;
      for (let i = 0; i < n; i++) if (!done[i] && dist[i] < Infinity && (u < 0 || dist[i] < dist[u])) u = i;
      if (u < 0 || u === b) break;
      done[u] = 1;
      for (const [p, q] of edges) {
        const v = p === u ? q : q === u ? p : -1;
        if (v < 0) continue;
        const nd = dist[u] + Math.sqrt(d2(Z[u], Z[v]));
        if (nd < dist[v]) dist[v] = nd;
      }
    }
    return dist[b];
  };
  for (let l = 0; l < loops && rest.length; l++) {
    let best = -1, bs = 0;
    for (let i = 0; i < rest.length; i++) {
      const [a, b, L] = rest[i];
      const s = graphDist(a, b) / L * R.range(0.85, 1.15);
      if (s > bs) { bs = s; best = i; }
    }
    if (best < 0 || bs < 1.6) break;
    edges.push([rest[best][0], rest[best][1]]);
    rest.splice(best, 1);
  }

  // 3. tiers: the landform field at each centre, plus noise; the hub's tier is fixed
  const T = G.tiers, s1 = R.int(1, 1e6);
  const phase = R.range(0, 6.28), lineV = R.range(0.38, 0.52);
  const twinA = [R.range(0.15, 0.35), R.range(0.3, 0.55)], twinB = [R.range(0.65, 0.85), R.range(0.45, 0.7)];
  const field = (z: Zone) => {
    // back to canonical (u, v)
    let [cx, cy] = [z.x, z.y];
    const S1 = S - 1;
    for (let r = 0; r < g.rot; r++) { const nx = cy; cy = S1 - cx; cx = nx; }
    if (g.mir) cx = S1 - cx;
    const u = (cx - MARGIN) / span, v = (cy - MARGIN) / span;
    switch (g.landform) {
      case 'ridge': return 1 - smooth(0.06, 0.24, Math.abs(v - (lineV + 0.08 * dsin(u * 5 + phase))));
      case 'twin': return Math.max(1 - smooth(0.1, 0.3, Math.sqrt((u - twinA[0]) ** 2 + (v - twinA[1]) ** 2)), 1 - smooth(0.1, 0.3, Math.sqrt((u - twinB[0]) ** 2 + (v - twinB[1]) ** 2)));
      case 'descent': return Math.min(1, Math.max(0, 0.55 * (1 - v) + 0.45 * (dcos(phase) > 0 ? u : 1 - u)));
      default: return smooth(0.12, 0.45, Math.sqrt((u - 0.5) ** 2 + (v - 0.5) ** 2)); // terraces
    }
  };
  for (const z of Z) {
    const noise = (fbm(z.x / 23, z.y / 23, s1, 2) - 0.5) * 0.9;
    z.tier = Math.max(0, Math.min(T - 1, Math.round(field(z) * (T - 1) + noise)));
  }
  const hub = Z[0];
  hub.tier = Math.min(T - 1, G.hubTier);
  const adj = () => { const A: number[][] = Z.map(() => []); for (const [a, b] of edges) { A[a].push(b); A[b].push(a); } return A; };
  const fixSteps = () => {
    for (let it = 0; it < 12; it++) {
      let changed = false;
      for (const [a, b] of edges) {
        const za = Z[a], zb = Z[b];
        if (Math.abs(za.tier - zb.tier) <= 1) continue;
        const mov = za === hub ? zb : zb === hub ? za : (a < b ? zb : za);
        const other = mov === za ? zb : za;
        mov.tier += mov.tier > other.tier ? -1 : 1;
        changed = true;
      }
      if (!changed) break;
    }
  };
  fixSteps();
  // raised share in the location's band
  const [rLo, rHi] = D.freedoms.raised;
  for (let it = 0; it < n; it++) {
    const raised = Z.filter((z) => z.tier > 0).length / n;
    if (raised < rLo) {
      const A = adj();
      const c = Z.filter((z) => z.tier === 0 && z !== hub).sort((p, q) => A[q.id].filter((v) => Z[v].tier > 0).length - A[p.id].filter((v) => Z[v].tier > 0).length || p.id - q.id)[0];
      if (!c) break; c.tier = 1;
    } else if (raised > rHi) {
      const c = Z.filter((z) => z.tier > 0 && z !== hub).sort((p, q) => p.tier - q.tier || q.id - p.id)[0];
      if (!c) break; c.tier--;
    } else break;
    fixSteps();
  }

  // 4. raised zones need two ways in: add a candidate edge, else bring the zone down to its neighbour's tier
  for (let it = 0; it < 3; it++) {
    const A = adj();
    for (const z of Z) {
      if (z.tier === 0 || A[z.id].length >= 2 || z === hub) continue;
      const extra = rest.find(([a, b]) => (a === z.id || b === z.id) && Math.abs(Z[a].tier - Z[b].tier) <= 1);
      if (extra) { edges.push([extra[0], extra[1]]); rest.splice(rest.indexOf(extra), 1); }
      else z.tier = Z[A[z.id][0]].tier;
    }
  }

  // 5. kinds and sizes
  const A = adj();
  const [aLo, aHi] = G.arenaR, [cLo, cHi] = G.chamberR, [nLo, nHi] = G.nookR;
  for (const z of Z) {
    if (z.kind === 'hub') z.r = aLo + 1;
    else if (z.kind === 'boss') { z.r = aHi + 1; }
    else if (A[z.id].length <= 1) { z.kind = 'nook'; z.r = R.int(nLo, nHi); }
    else if (A[z.id].length >= 3 && R.chance(0.6)) { z.kind = 'arena'; z.r = R.int(aLo, aHi); }
    else { z.kind = 'chamber'; z.r = R.int(cLo, cHi); }
    z.rx = z.r * R.range(0.88, 1.15); z.ry = z.r * R.range(0.88, 1.15);
    z.h = z.tier * G.tierGap;
  }
  // the boss hall sits low or mid, never alone on the top tier without two ways in (rule 4 already holds)

  // the hub→boss route through the graph: its edges become main paths
  const prev = new Int32Array(n).fill(-1), seen = new Uint8Array(n), q = [0];
  seen[0] = 1;
  while (q.length) { const u = q.shift()!; for (const v of A[u]) if (!seen[v]) { seen[v] = 1; prev[v] = u; q.push(v); } }
  const main = new Set<string>();
  for (let v = 1; prev[v] >= 0; v = prev[v]) main.add(Math.min(v, prev[v]) + ',' + Math.max(v, prev[v]));

  let bridges = R.int(D.freedoms.bridges[0], D.freedoms.bridges[1]);
  const [pLo, pHi] = G.pathW, [tLo, tHi] = G.trailW;
  for (const [a, b] of edges) {
    const za = Z[a], zb = Z[b], L = Math.sqrt(d2(za, zb));
    let kind: LinkKind, w: number;
    let terrace = false;
    if (za.tier !== zb.tier) {
      kind = 'ramp'; w = G.rampW;
      // most climbs are terraces: the two spaces meet along a cliff edge (an overlook) and the ramp runs up one side
      if (za.kind !== 'nook' && zb.kind !== 'nook' && R.chance(G.terrace)) { terrace = true; w = Math.max(G.rampW + 5, Math.min(16, Math.round(Math.min(za.r, zb.r) * 1.5))); }
    }
    else if (bridges > 0 && za.tier > 0 && L - za.r - zb.r >= 7 && za.kind !== 'nook' && zb.kind !== 'nook') { kind = 'bridge'; w = G.bridgeW; bridges--; }
    else if (main.has(Math.min(a, b) + ',' + Math.max(a, b)) || (za.kind === 'arena' && zb.kind === 'arena')) { kind = 'path'; w = R.int(pLo, pHi); }
    else { kind = 'trail'; w = R.int(tLo, tHi); }
    g.links.push({ id: g.links.length, a, b, kind, w, pts: [], tiles: [], terrace });
  }

  // every raised zone with a way down overlooks something: at least one of its downward links is a terrace
  for (const z of Z) {
    if (z.tier === 0 || z.kind === 'nook') continue;
    const down = g.links.filter((L) => L.kind === 'ramp' && (L.a === z.id || L.b === z.id) && Z[L.a === z.id ? L.b : L.a].tier < z.tier && Z[L.a === z.id ? L.b : L.a].kind !== 'nook');
    if (!down.length || down.some((L) => L.terrace)) continue;
    const L = down[0];
    L.terrace = true; L.w = Math.max(G.rampW + 5, Math.min(16, Math.round(Math.min(Z[L.a].r, Z[L.b].r) * 1.5)));
  }

  // 6. entrances: evenly spread around the map edge, each joined to its nearest zone at that zone's tier
  const E = R.int(D.freedoms.entrances[0], D.freedoms.entrances[1]);
  const a0 = R.range(0, 6.28);
  const cx = S / 2, cy = S / 2, reach = S / 2 - 7;
  let made = 0;
  for (let e = 0; e < E * 3 && made < E; e++) {
    const a = a0 + (e / E) * 6.283 + (e >= E ? 0.5 + e * 0.37 : 0) + R.range(-0.3, 0.3);
    const x = Math.round(cx + dcos(a) * reach), y = Math.round(cy + dsin(a) * reach);
    let near = -1, nd = Infinity;
    for (const z of Z) if (z.kind !== 'entrance' && z.kind !== 'nook') { const dd = d2(z, { x, y }); if (dd < nd) { nd = dd; near = z.id; } }
    if (near < 0 || Math.sqrt(nd) < Z[near].r + 6) continue;
    if (g.zones.some((z) => z.kind === 'entrance' && d2(z, { x, y }) < 30 * 30)) continue;
    // the entrance trail must not run through another zone (it would be cut and the entrance sealed)
    const nz = Z[near], sx = nz.x - x, sy = nz.y - y, sl = sx * sx + sy * sy || 1;
    const crosses = Z.some((z) => {
      if (z === nz || z.kind === 'entrance') return false;
      const t = Math.max(0, Math.min(1, ((z.x - x) * sx + (z.y - y) * sy) / sl));
      return d2(z, { x: x + sx * t, y: y + sy * t }) < (z.r + 3) ** 2;
    });
    if (crosses) continue;
    made++;
    const ez: Zone = mk('entrance', x, y);
    ez.r = G.nookR[1] + 2; ez.rx = ez.r; ez.ry = ez.r; ez.tier = Z[near].tier; ez.h = Z[near].h;
    g.zones.push(ez);
    g.links.push({ id: g.links.length, a: ez.id, b: near, kind: 'trail', w: Math.max(3, tLo), pts: [], tiles: [] });
  }

  // 7. hop shortcuts: pairs one tier apart, close, not already linked
  const H = R.int(D.freedoms.hops[0], D.freedoms.hops[1]);
  const linked = new Set(g.links.map((l) => Math.min(l.a, l.b) + ',' + Math.max(l.a, l.b)));
  const pairs: [number, number, number][] = [];
  for (const p of Z) for (const o of Z) {
    if (p.id >= o.id || Math.abs(p.tier - o.tier) !== 1 || linked.has(p.id + ',' + o.id)) continue;
    if (p.kind === 'entrance' || o.kind === 'entrance') continue;
    const gap = Math.sqrt(d2(p, o)) - p.r - o.r;
    if (gap < 16) pairs.push([p.id, o.id, gap + R.next()]);
  }
  pairs.sort((x, y) => x[2] - y[2]);
  for (const [p, o] of pairs.slice(0, H)) g.hops.push(Z[p].tier < Z[o].tier ? [p, o] : [o, p]);
}
