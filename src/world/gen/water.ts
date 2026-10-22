// Stage 3: water. Every region has moving water and at most two still bodies (blueprint section 3):
//   valley — a river crosses the map along the valley floor (two crossings make the loop);
//   ridge  — a spring at the ridge foot feeds the pond, which drains to the border;
//   hollow — a lake fills the bowl, fed by a stream from the rim.
// Paths are routed downhill over the continuous height field with an 8-neighbour A*, then smoothed, so rivers sit
// in valleys and never run as D8 staircases. Water is carved at 0 m; the slope relaxation then cuts the valley.
import { dhypot } from '../../core/detmath';
import { fbm } from '../../core/rng';
import { T } from '../tiles';
import type { GenCtx } from './context';
import { MARGIN } from './plan';
import { FIX } from './terrain';
import { Heap, d2 } from './util';

const N8: [number, number, number][] = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, 1.4142], [1, -1, 1.4142], [-1, 1, 1.4142], [-1, -1, 1.4142]];

export function carveWater(g: GenCtx) {
  const R = g.rng('water');
  const S = g.S, span = S - MARGIN * 2;
  const pond = g.place('pond')!;
  const ns = R.int(1, 1e6);
  // cost: high ground is expensive, places are forbidden, a little noise for meanders
  const placeCost = (x: number, y: number) => {
    let c = 0;
    for (const p of g.places) {
      if (p.kind === 'pond') continue;
      const dd = d2(x, y, p.x, p.y), rr = p.r + 4;
      if (dd < rr * rr) c += dd < (p.r + 1) ** 2 ? 1e4 : 40;
    }
    return c;
  };
  const shrine = g.place('shrine')!;
  const [, scy] = g.toCanon(shrine.x, shrine.y);
  const cost = (x: number, y: number) => {
    const k = g.idx(x, y);
    let c = 1 + 3 * Math.max(0, g.h0[k] + 0.3) + fbm(x / 9, y / 9, ns, 2) * 2 + placeCost(x, y);
    if (g.archetype === 'ridge') { const [, cy] = g.toCanon(x, y); if (cy < scy + 9) c += 500; }
    return c;
  };
  const lakes: [number, number, number, number][] = [];
  const pondR = g.archetype === 'hollow' ? [R.range(9, 11), R.range(7, 8.5)] : [R.range(5.5, 7), R.range(4, 5.5)];
  lakes.push([pond.x, pond.y, pondR[0], pondR[1]]);
  const border = (cx: number, cy: number) => g.toMap(Math.max(0, Math.min(S - 1, cx)), Math.max(0, Math.min(S - 1, cy)));
  const paths: { pts: [number, number][]; w: number }[] = [];
  if (g.archetype === 'valley') {
    // west to east along the valley floor, passing near the pond only if it is on the way
    const [ax, ay] = border(0, Math.round(MARGIN + span * R.range(0.42, 0.58)));
    const [bx, by] = border(S - 1, Math.round(MARGIN + span * R.range(0.42, 0.58)));
    paths.push({ pts: route(g, ax, ay, bx, by, cost), w: R.pick([3, 4]) });
    // a brook from the pond to the river
    const tgt = nearestOn(paths[0].pts, pond.x, pond.y);
    paths.push({ pts: route(g, pond.x, pond.y, tgt[0], tgt[1], cost), w: 2 });
  } else if (g.archetype === 'ridge') {
    // spring at the ridge foot → pond → the nearer side border, downhill
    const [pcx, pcy] = g.toCanon(pond.x, pond.y);
    const [sx, sy] = g.toMap(Math.round(pcx + R.range(-8, 8)), Math.round(scy + 10));
    paths.push({ pts: route(g, sx, sy, pond.x, pond.y, cost), w: 3 });
    // drain to the far side border, along the ridge foot: the brook crosses the region and makes the crossings
    const exitSide = pcx < S / 2 ? S - 1 : 0;
    const [ex, ey] = border(exitSide, Math.round(MARGIN + span * R.range(0.55, 0.8)));
    paths.push({ pts: route(g, pond.x, pond.y, ex, ey, cost), w: 4 });
  } else {
    // a stream from the rim into the lake, from the border away from the hub
    const hub = g.place('hub')!;
    const sides: [number, number][] = [[0, Math.round(MARGIN + span * 0.4)], [S - 1, Math.round(MARGIN + span * 0.4)]];
    let best = sides[0], bd = -1;
    for (const [cx, cy] of sides) { const [x, y] = border(cx, cy); const d = d2(x, y, hub.x, hub.y); if (d > bd) { bd = d; best = [cx, cy]; } }
    const [sx, sy] = border(best[0], best[1]);
    paths.push({ pts: route(g, sx, sy, pond.x, pond.y, cost), w: 3 });
  }
  const smoothed = paths.map((p) => ({ pts: smooth(p.pts), w: p.w }));
  for (const p of smoothed) rasterRiver(g, p.pts, p.w);
  for (const [x, y, rx, ry] of lakes) lake(g, x, y, rx, ry, R.int(1, 1e6));
  // keep the share of water in the region's band (3–9 %): a second pool in a basin, then wider streams, if short
  const share = () => { let w = 0; for (let k = 0; k < S * S; k++) if (g.m.terrain[k] === T.water) w++; return w / (S * S); };
  // aim above the 3 % floor: bridges later turn some water into planks
  if (share() < 0.038) {
    const site = basinSite(g, R.int(1, 1e6));
    if (site) lake(g, site[0], site[1], R.range(4.5, 6), R.range(3.5, 4.5), R.int(1, 1e6));
  }
  for (let widen = 1; widen <= 2 && share() < 0.036; widen++) for (const p of smoothed) if (p.w >= 3) rasterRiver(g, p.pts, p.w + widen);
}

function lake(g: GenCtx, cx: number, cy: number, rx: number, ry: number, seed: number) {
  g.lakes.push([cx, cy, rx, ry]);
  g.b.blob(cx, cy, rx, ry, T.water, 1.2, seed % 97);
  for (let y = Math.floor(cy - ry - 3); y <= cy + ry + 3; y++) for (let x = Math.floor(cx - rx - 3); x <= cx + rx + 3; x++) {
    if (!g.in(x, y)) continue;
    const k = g.idx(x, y);
    if (g.m.terrain[k] === T.water) { g.m.elev[k] = 0; g.fixed[k] = FIX.water; }
  }
  // a rim around it so it sits in a basin (the slope relaxation grades the bank afterwards)
  for (let y = Math.floor(cy - ry - 11); y <= cy + ry + 11; y++) for (let x = Math.floor(cx - rx - 11); x <= cx + rx + 11; x++) {
    if (!g.in(x, y)) continue;
    const k = g.idx(x, y);
    if (g.fixed[k] !== 0) continue;
    const ax = (x - cx) / rx, ay = (y - cy) / ry, r = Math.sqrt(ax * ax + ay * ay) * Math.min(rx, ry);
    const d = r - Math.min(rx, ry);
    if (d >= 2 && d <= 10) { g.m.elev[k] = Math.max(g.m.elev[k], d <= 3.5 || d > 8.5 ? 0.5 : 1); g.rim[k] = 1; }
  }
}

/** lowest open basin away from places and existing water */
function basinSite(g: GenCtx, seed: number): [number, number] | null {
  const S = g.S;
  let best: [number, number] | null = null, bh = 1e9;
  for (let y = MARGIN + 6; y < S - MARGIN - 6; y += 3) for (let x = MARGIN + 6; x < S - MARGIN - 6; x += 3) {
    let ok = true;
    for (const p of g.places) if (d2(x, y, p.x, p.y) < (p.r + 7) ** 2) { ok = false; break; }
    if (!ok) continue;
    let near = false;
    for (let dy = -7; dy <= 7 && !near; dy += 1) for (let dx = -7; dx <= 7 && !near; dx += 1) if (g.in(x + dx, y + dy) && g.m.terrain[g.idx(x + dx, y + dy)] === T.water) near = true;
    if (near) continue;
    const h = g.h0[g.idx(x, y)] + fbm(x / 7, y / 7, seed, 1) * 0.05;
    if (h < bh) { bh = h; best = [x, y]; }
  }
  return best;
}

/** 8-neighbour A* from (ax, ay) to (bx, by) over a per-tile cost; returns tile path */
let costCache: { g: GenCtx; C: Float32Array } | null = null;
function route(g: GenCtx, ax: number, ay: number, bx: number, by: number, cost: (x: number, y: number) => number): [number, number][] {
  const S = g.S, n = S * S;
  // the cost field is the same for every path of one attempt: compute it once
  if (!costCache || costCache.g !== g) {
    const C0 = new Float32Array(n);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) C0[y * S + x] = cost(x, y);
    costCache = { g, C: C0 };
  }
  const C = costCache.C;
  const G = new Float64Array(n).fill(Infinity), from = new Int32Array(n).fill(-1);
  const H = new Heap(4096);
  const s = ay * S + ax, t = by * S + bx;
  G[s] = 0; H.push(0, s);
  while (H.n) {
    const a = H.pop();
    if (a === t) break;
    const x = a % S, y = (a / S) | 0;
    for (const [dx, dy, L] of N8) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= S || ny >= S) continue;
      const b = ny * S + nx;
      const ng = G[a] + L * (C[a] + C[b]) * 0.5;
      if (ng < G[b]) { G[b] = ng; from[b] = a; H.push(ng + dhypot(nx - bx, ny - by), b); }
    }
  }
  const out: [number, number][] = [];
  for (let k = t; k >= 0; k = from[k]) { out.push([k % S, (k / S) | 0]); if (k === s) break; }
  return out.reverse();
}

/** resample every 3rd point and two Chaikin passes: no staircases */
function smooth(pts: [number, number][]): [number, number][] {
  if (pts.length < 4) return pts;
  let p: [number, number][] = pts.filter((_, i) => i % 3 === 0 || i === pts.length - 1);
  for (let it = 0; it < 2; it++) {
    const q: [number, number][] = [p[0]];
    for (let i = 0; i < p.length - 1; i++) {
      const [ax, ay] = p[i], [bx, by] = p[i + 1];
      q.push([ax * 0.75 + bx * 0.25, ay * 0.75 + by * 0.25], [ax * 0.25 + bx * 0.75, ay * 0.25 + by * 0.75]);
    }
    q.push(p[p.length - 1]);
    p = q;
  }
  return p;
}

function nearestOn(pts: [number, number][], x: number, y: number): [number, number] {
  let best = pts[0], bd = 1e18;
  for (const p of pts) { const d = d2(p[0], p[1], x, y); if (d < bd) { bd = d; best = p; } }
  return [Math.round(best[0]), Math.round(best[1])];
}

function rasterRiver(g: GenCtx, pts: [number, number][], w: number) {
  const r = w / 2;
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, ay] = pts[i], [bx, by] = pts[i + 1];
    const n = Math.max(1, Math.ceil(Math.max(Math.abs(bx - ax), Math.abs(by - ay)) * 2));
    for (let s = 0; s <= n; s++) {
      const x = ax + ((bx - ax) * s) / n, y = ay + ((by - ay) * s) / n;
      for (let j = Math.floor(y - r); j <= Math.ceil(y + r); j++) for (let i2 = Math.floor(x - r); i2 <= Math.ceil(x + r); i2++) {
        if (!g.in(i2, j)) continue;
        if ((i2 + 0.5 - x) ** 2 + (j + 0.5 - y) ** 2 > r * r) continue;
        const k = g.idx(i2, j);
        g.m.terrain[k] = T.water; g.m.elev[k] = 0; g.fixed[k] = FIX.water;
      }
    }
  }
}
