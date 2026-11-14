// The reusable geometry families both recipes are built from (spec section B, "Eight geometric generator kernels").
// Each is a small kernel on the tile heightfield; recipes differ in what they compose, never in how a piece is made:
//
//   relief     relief patches and graded treads: path() sweeps a corridor through waypoints with a linear height
//              profile per leg and flat landings at the bends, so a switchback, a bench ramp and a cave rise are the
//              same kernel [kernel 1 + 2]
//   cliff      a cliff is the step between two relief levels; bench() is a flat ledge between them [kernel 1]
//   boulder    spur(): an indestructible rock outcrop (wall tiles raised above their footing) that breaks a sightline;
//              boulders and slabs are props placed by dress.ts [kernel 5]
//   channel    channel() and basin(): a fluid bed with a level, banks, falls between reaches; water and lava share it
//              and differ only in their medium contract [kernel 2 + 4]
//   chamber    tunnel(): a corridor carved through rock mass (its sides stay rock); chamber() a carved room [kernel 3]
//   structure  bridge() (low, over a channel, the fluid passes under), causeway() (an overhead deck between two
//              supported ends), arch() (a deck that carries a walkway over a tunnel), plinth() (a raised terrace with
//              retaining walls), ruinWall() [kernel 7]
//
// Every join records its ends, height, headroom and what passes under it (ctx.joins); validate.ts checks them.
import { fbm } from '../../core/rng';
import { HK, MED, type Approach, type HabCtx } from './ctx';

export type Pt = [number, number];
export interface WP { x: number; y: number; h: number }

const DIRS: Pt[] = [[1, 0], [0, 1], [-1, 0], [0, -1]];

/** Chaikin-smoothed polyline */
export function smooth(pts: Pt[], iters = 2): Pt[] {
  let p = pts;
  for (let c = 0; c < iters; c++) {
    const out: Pt[] = [p[0]];
    for (let i = 0; i < p.length - 1; i++) {
      const [ax, ay] = p[i], [bx, by] = p[i + 1];
      out.push([ax * 0.75 + bx * 0.25, ay * 0.75 + by * 0.25], [ax * 0.25 + bx * 0.75, ay * 0.25 + by * 0.75]);
    }
    out.push(p[p.length - 1]);
    p = out;
  }
  return p;
}

export function cumLen(pts: Pt[]): number[] {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  return cum;
}

/** nearest point on a polyline: [distance, arc length] */
export function project(pts: Pt[], cum: number[], px: number, py: number): [number, number] {
  let bd = Infinity, bs = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, ay] = pts[i], [bx, by] = pts[i + 1];
    const vx = bx - ax, vy = by - ay, l2 = vx * vx + vy * vy || 1e-9;
    const t = Math.max(0, Math.min(1, ((px - ax) * vx + (py - ay) * vy) / l2));
    const d = Math.hypot(px - ax - vx * t, py - ay - vy * t);
    if (d < bd) { bd = d; bs = cum[i] + t * Math.sqrt(l2); }
  }
  return [bd, bs];
}

export function along(pts: Pt[], cum: number[], s: number): Pt {
  for (let i = 0; i < pts.length - 1; i++) {
    if (s <= cum[i + 1] || i === pts.length - 2) {
      const t = Math.max(0, Math.min(1, (s - cum[i]) / Math.max(1e-9, cum[i + 1] - cum[i])));
      return [pts[i][0] + (pts[i + 1][0] - pts[i][0]) * t, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * t];
    }
  }
  return pts[pts.length - 1];
}

/** bounding box of a polyline padded by r, clipped to the map */
function box(g: HabCtx, pts: Pt[], r: number): [number, number, number, number] {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of pts) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  return [Math.max(1, Math.floor(x0 - r)), Math.max(1, Math.floor(y0 - r)), Math.min(g.S - 2, Math.ceil(x1 + r)), Math.min(g.S - 2, Math.ceil(y1 + r))];
}

// ---- relief ---------------------------------------------------------------------------------------------------

/** relief patch: every tile where f returns a level becomes that kind at that height */
export function relief(g: HabCtx, f: (x: number, y: number) => { h: number; kind: number } | null) {
  g.used.add('relief');
  for (let y = 0; y < g.S; y++) for (let x = 0; x < g.S; x++) {
    const r = f(x + 0.5, y + 0.5);
    if (!r) continue;
    const k = g.idx(x, y);
    g.H[k] = r.h; g.kind[k] = r.kind;
  }
}

export interface PathOpts {
  w: number;
  kind?: number;
  /** may this tile be claimed? (default: anything not locked and not fluid) */
  can?: (k: number) => boolean;
  /** claim for this approach */
  approach?: Approach;
  /** keep this many extra tiles around the centre line free of vegetation and cover */
  keep?: number;
  /** grade limit (m per tile); a leg steeper than this is reported */
  grade?: number;
}

/** a graded tread through waypoints: each leg's height runs linearly from one waypoint to the next. Each leg ends in a
 *  round cap at its end height, so a bend between a sloped leg and a flat one is a landing as wide as the tread (a
 *  hairpin fits the turning body); where legs overlap the nearer centre line wins. Returns the tiles claimed. */
export function path(g: HabCtx, wps: WP[], o: PathOpts): number[] {
  g.used.add('relief');
  const kind = o.kind ?? HK.route, half = o.w / 2, grade = o.grade ?? 0.5;
  const can = o.can ?? ((k: number) => !g.lock[k] && g.kind[k] !== HK.fluid);
  const claimed = new Set<number>();
  const best = new Map<number, number>();
  const put = (k: number, h: number, d: number, kd: number) => {
    const prev = best.get(k);
    if (prev !== undefined && prev <= d) return;
    // a ramp laid by an earlier tread keeps its grade: a later tread starting at its foot or head joins it, never
    // flattens it
    if (prev === undefined && g.kind[k] === HK.ramp && Math.abs(g.H[k] - h) > 0.05) return;
    if (!can(k)) return;
    best.set(k, d);
    g.H[k] = h; g.kind[k] = kd; claimed.add(k);
  };
  for (let i = 0; i < wps.length - 1; i++) {
    const a = wps[i], b = wps[i + 1];
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const dh = b.h - a.h;
    if (Math.abs(dh) / len > grade + 1e-6) g.notes.push(`steep leg ${i} (${(Math.abs(dh) / len).toFixed(2)} m/tile)`);
    const [x0, y0, x1, y1] = box(g, [[a.x, a.y], [b.x, b.y]], half + 1);
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const px = x + 0.5, py = y + 0.5;
      const vx = b.x - a.x, vy = b.y - a.y;
      const t = Math.max(0, Math.min(1, ((px - a.x) * vx + (py - a.y) * vy) / (len * len)));
      const d = Math.hypot(px - a.x - vx * t, py - a.y - vy * t);
      if (d > half) continue;
      put(g.idx(x, y), a.h + dh * t, d, Math.abs(dh) > 0.01 && kind !== HK.tunnel ? HK.ramp : kind);
    }
  }
  const tiles = [...claimed].sort((a, b) => a - b);
  if (o.keep !== undefined) for (let i = 0; i < wps.length - 1; i++) keepLine(g, [[wps[i].x, wps[i].y], [wps[i + 1].x, wps[i + 1].y]], half + o.keep);
  if (o.approach) { o.approach.tiles.push(...tiles); o.approach.pts.push(...wps.map((p) => [p.x, p.y] as Pt)); }
  return tiles;
}

/** reserve the space within r of a polyline (no vegetation, no cover) */
export function keepLine(g: HabCtx, pts: Pt[], r: number) {
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, ay] = pts[i], [bx, by] = pts[i + 1];
    const n = Math.ceil(Math.hypot(bx - ax, by - ay) * 2);
    for (let s = 0; s <= n; s++) g.disc(ax + ((bx - ax) * s) / n, ay + ((by - ay) * s) / n, r, (k) => { g.keep[k] = 1; });
  }
}

/** a switchback down a wall: legs alternate along `dir` and step `side`-ward, each leg falling at `grade` m/tile, with
 *  flat hairpin landings. Starts at `top` (height h0), ends at height h1. Returns the waypoints. */
export function switchback(top: Pt, dir: Pt, side: Pt, h0: number, h1: number, legLen: number, spacing: number, grade = 0.45): WP[] {
  const out: WP[] = [{ x: top[0], y: top[1], h: h0 }];
  let h = h0, x = top[0], y = top[1], sgn = 1;
  const fall = legLen * grade;
  for (let leg = 0; leg < 8 && h > h1 + 1e-6; leg++) {
    const dh = Math.min(fall, h - h1);
    const L = dh / grade;
    x += dir[0] * sgn * L; y += dir[1] * sgn * L; h -= dh;
    out.push({ x, y, h });
    if (h <= h1 + 1e-6) break;
    x += side[0] * spacing; y += side[1] * spacing;
    out.push({ x, y, h });
    sgn = -sgn;
  }
  return out;
}

// ---- cliff, bench, spur ----------------------------------------------------------------------------------------

/** a flat bench (ledge) along a wall: a strip of floor at height h */
export function bench(g: HabCtx, pts: Pt[], w: number, h: number): number[] {
  g.used.add('cliff');
  const out: number[] = [];
  const cum = cumLen(pts);
  const [x0, y0, x1, y1] = box(g, pts, w);
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const k = g.idx(x, y);
    if (g.lock[k] || g.kind[k] === HK.fluid || g.kind[k] === HK.ramp) continue; // a ramp arriving at the bench keeps its grade
    if (project(pts, cum, x + 0.5, y + 0.5)[0] > w / 2) continue;
    g.H[k] = h; g.kind[k] = HK.shelf; out.push(k);
  }
  return out;
}

/** an indestructible rock outcrop along a polyline: wall tiles standing `rise` m above the highest tile they replace.
 *  A spur is the decisive sightline break (props can burn or break; terrain cannot). */
export function spur(g: HabCtx, pts: Pt[], w: number, rise: number, can: (k: number) => boolean = (k) => !g.lock[k] && !g.keep[k] && g.kind[k] !== HK.fluid): number[] {
  g.used.add('boulder');
  const out: number[] = [];
  const cum = cumLen(pts);
  const [x0, y0, x1, y1] = box(g, pts, w);
  const sd = (g.seed & 0xffff) + pts.length;
  let top = 0;
  const cand: number[] = [];
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const k = g.idx(x, y);
    const [d, s] = project(pts, cum, x + 0.5, y + 0.5);
    const taper = 1 - 0.35 * Math.min(1, s / Math.max(1, cum[cum.length - 1])); // narrows toward its tip
    if (d > (w / 2) * taper + (fbm(x / 3, y / 3, sd, 1) - 0.5) * 0.8 || !can(k)) continue;
    cand.push(k); top = Math.max(top, g.H[k]);
  }
  for (const k of cand) { g.H[k] = top + rise; g.kind[k] = HK.rock; out.push(k); }
  return out;
}

// ---- channels and basins (fluid medium) -----------------------------------------------------------------------

export interface FluidOpts { med: number; wl: (s: number) => number; bank?: number; bankH?: (s: number) => number; lock?: boolean; depth?: number }

/** a channel reach along a polyline: a bed `depth` below its level, optional dry banks at bankH */
export function channel(g: HabCtx, pts: Pt[], w: number, o: FluidOpts): number[] {
  g.used.add('channel');
  const out: number[] = [];
  const cum = cumLen(pts);
  const half = w / 2, bank = o.bank ?? 0, depth = o.depth ?? 0.6;
  const [x0, y0, x1, y1] = box(g, pts, half + bank + 1);
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const k = g.idx(x, y);
    const [d, s] = project(pts, cum, x + 0.5, y + 0.5);
    const wob = (fbm(x / 5, y / 5, 917 + (g.seed & 0xfff), 2) - 0.5) * 1.2;
    if (d <= half + wob * 0.5) {
      g.kind[k] = HK.fluid; g.med[k] = o.med; g.wl[k] = o.wl(s); g.H[k] = g.wl[k] - depth;
      if (o.lock) g.lock[k] = 1;
      out.push(k);
    } else if (bank && d <= half + bank + wob && g.kind[k] !== HK.fluid && o.bankH) {
      g.kind[k] = HK.bank; g.H[k] = o.bankH(s);
    }
  }
  return out;
}

/** a basin: an elliptical fluid body at one level (spec R03: standing fluid fills to one local level) */
export function basin(g: HabCtx, cx: number, cy: number, rx: number, ry: number, o: { med: number; wl: number; lock?: boolean; depth?: number; wobble?: number }): number[] {
  g.used.add('channel');
  const out: number[] = [];
  const wb = o.wobble ?? 0.25, sd = (g.seed & 0xfff) + 331;
  for (let y = Math.floor(cy - ry - 2); y <= cy + ry + 2; y++) for (let x = Math.floor(cx - rx - 2); x <= cx + rx + 2; x++) {
    if (!g.in(x, y)) continue;
    const ax = (x + 0.5 - cx) / rx, ay = (y + 0.5 - cy) / ry;
    if (Math.sqrt(ax * ax + ay * ay) > 1 + (fbm(x / 4, y / 4, sd, 2) - 0.5) * wb) continue;
    const k = g.idx(x, y);
    g.kind[k] = HK.fluid; g.med[k] = o.med; g.wl[k] = o.wl; g.H[k] = o.wl - (o.depth ?? 0.6);
    if (o.lock) g.lock[k] = 1;
    out.push(k);
  }
  return out;
}

// ---- chambers and tunnels ---------------------------------------------------------------------------------------

/** a tunnel: a graded tread carved through rock mass; its sides stay rock. Returns the tiles. */
export function tunnel(g: HabCtx, wps: WP[], w: number, approach?: Approach): number[] {
  g.used.add('chamber');
  return path(g, wps, { w, kind: HK.tunnel, approach, keep: 0, can: (k) => !g.lock[k] && g.kind[k] !== HK.fluid });
}

/** a carved chamber: a room of floor at height h inside rock */
export function chamber(g: HabCtx, cx: number, cy: number, r: number, h: number): number[] {
  g.used.add('chamber');
  const out: number[] = [];
  const sd = (g.seed & 0xfff) + 77;
  g.disc(cx, cy, r + 1, (k, d) => {
    const x = k % g.S, y = (k / g.S) | 0;
    if (d > r + (fbm(x / 3, y / 3, sd, 2) - 0.5) * 1.6 || g.lock[k] || g.kind[k] === HK.fluid) return;
    g.H[k] = h; g.kind[k] = HK.tunnel; out.push(k);
  });
  return out;
}

// ---- structures -----------------------------------------------------------------------------------------------

/** the tiles of a straight strip from a to b, w wide */
export function strip(g: HabCtx, a: Pt, b: Pt, w: number): number[] {
  const out: number[] = [];
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  const [x0, y0, x1, y1] = box(g, [a, b], w);
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const px = x + 0.5, py = y + 0.5, vx = b[0] - a[0], vy = b[1] - a[1];
    const t = ((px - a[0]) * vx + (py - a[1]) * vy) / (len * len);
    if (t < 0 || t > 1) continue;
    if (Math.hypot(px - a[0] - vx * t, py - a[1] - vy * t) <= w / 2) out.push(g.idx(x, y));
  }
  return out;
}

/** a low bridge across a channel at bank height: fluid tiles under it keep flowing (culvert), the tread is wood */
export function bridge(g: HabCtx, a: Pt, b: Pt, w: number, approach?: Approach): number[] {
  g.used.add('structure');
  const tiles = strip(g, a, b, w);
  let lo = Infinity;
  for (const k of tiles) if (g.kind[k] !== HK.fluid) lo = Math.min(lo, g.H[k]);
  if (lo === Infinity) lo = 0;
  for (const k of tiles) {
    if (g.kind[k] === HK.fluid) { g.culvert[k] = 1; g.kind[k] = HK.route; g.H[k] = Math.max(0, lo); g.med[k] = MED.water; }
    else if (!g.lock[k]) { g.kind[k] = HK.route; g.H[k] = lo; }
    g.keep[k] = 1;
  }
  const ends = endsOf(g, a, b);
  g.joins.push({ family: 'structure', what: 'bridge', ends, h: lo, clearance: 0, medium: 'water' });
  if (approach) { approach.tiles.push(...tiles); approach.pts.push(a, b); }
  return tiles;
}

/** an overhead deck from a to b at height h (a causeway over a channel or a gully); the ground below is untouched */
export function causeway(g: HabCtx, a: Pt, b: Pt, w: number, h: number, approach?: Approach, what = 'causeway'): number[] {
  g.used.add('structure');
  const tiles = strip(g, a, b, w);
  let lowest = Infinity, fluid = false;
  for (const k of tiles) {
    if (g.play(k) && Math.abs(g.H[k] - h) < 0.61) continue; // supported ends: already at deck height
    g.over[k] = h; g.keep[k] = 1;
    lowest = Math.min(lowest, g.kind[k] === HK.fluid ? g.wl[k] : g.H[k]);
    if (g.kind[k] === HK.fluid) fluid = true;
  }
  g.joins.push({ family: 'structure', what, ends: endsOf(g, a, b), h, clearance: lowest === Infinity ? 0 : h - lowest, medium: fluid ? (g.recipe.medium) : 'air' });
  if (approach) { approach.tiles.push(...tiles); approach.pts.push(a, b); }
  return tiles;
}

/** a rock arch: the walkway at height h continues as a deck over a tunnel cut beneath it */
export function arch(g: HabCtx, tiles: number[], h: number) {
  g.used.add('structure');
  let lowest = Infinity;
  for (const k of tiles) { if (g.kind[k] !== HK.tunnel) continue; g.over[k] = h; lowest = Math.min(lowest, g.H[k]); }
  if (lowest < Infinity) g.joins.push({ family: 'structure', what: 'arch', ends: [tiles[0], tiles[tiles.length - 1]], h, clearance: h - lowest, medium: 'walkway' });
}

/** a raised terrace with retaining walls: the ellipse becomes floor at h */
export function plinth(g: HabCtx, cx: number, cy: number, rx: number, ry: number, h: number, kind: number = HK.terrace, lock = true): number[] {
  g.used.add('structure');
  const out: number[] = [];
  for (let y = Math.floor(cy - ry - 1); y <= cy + ry + 1; y++) for (let x = Math.floor(cx - rx - 1); x <= cx + rx + 1; x++) {
    if (!g.in(x, y)) continue;
    const ax = (x + 0.5 - cx) / rx, ay = (y + 0.5 - cy) / ry;
    if (ax * ax + ay * ay > 1) continue;
    const k = g.idx(x, y);
    g.H[k] = h; g.kind[k] = kind; g.med[k] = MED.none; if (lock) g.lock[k] = 1;
    out.push(k);
  }
  return out;
}

/** a ruined wall segment: indestructible wall tiles `rise` m above the floor, broken where `gap` says */
export function ruinWall(g: HabCtx, a: Pt, b: Pt, rise: number, gap: (t: number) => boolean = () => false): number[] {
  g.used.add('structure');
  const out: number[] = [];
  const n = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]));
  for (let s = 0; s <= n; s++) {
    if (gap(s / Math.max(1, n))) continue;
    const x = Math.floor(a[0] + ((b[0] - a[0]) * s) / Math.max(1, n)), y = Math.floor(a[1] + ((b[1] - a[1]) * s) / Math.max(1, n));
    if (!g.in(x, y)) continue;
    const k = g.idx(x, y);
    if (g.keep[k] || g.kind[k] === HK.fluid || g.kind[k] === HK.rock) continue;
    g.H[k] += rise; g.kind[k] = HK.rock; out.push(k);
  }
  return out;
}

/** the supporting tiles at each end of a span: walking outward along its axis from each end, the first playable tile
 *  that is not itself part of the span */
function endsOf(g: HabCtx, a: Pt, b: Pt): [number, number] {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, ux = (b[0] - a[0]) / len, uy = (b[1] - a[1]) / len;
  const beyond = (p: Pt, sx: number, sy: number) => {
    for (let s = 0; s <= 4; s += 0.5) {
      const x = Math.floor(p[0] + sx * s), y = Math.floor(p[1] + sy * s);
      if (!g.in(x, y)) continue;
      const k = g.idx(x, y);
      if (g.play(k) && g.over[k] === 0 && !g.culvert[k]) return k;
    }
    return -1;
  };
  return [beyond(a, -ux, -uy), beyond(b, ux, uy)];
}

/** relax sloped treads where they meet landings or other treads at a near-step (0.5–1.2 m between 4-neighbours): a
 *  sloped tile moves toward its neighbour until the step is under the walking limit. Flat landings, cliffs (bigger
 *  differences) and locked tiles never move. Run after every tread is laid. Returns how many tiles moved. */
export function smoothTreads(g: HabCtx, iters = 8): number {
  const S = g.S, moved = new Set<number>();
  const tread = (k: number) => g.kind[k] === HK.route || g.kind[k] === HK.ramp || g.kind[k] === HK.tunnel || g.kind[k] === HK.shelf;
  for (let it = 0; it < iters; it++) {
    let any = false;
    for (let k = 0; k < S * S; k++) {
      if (g.kind[k] !== HK.ramp && !(g.kind[k] === HK.tunnel && g.over[k] === 0)) continue;
      if (g.lock[k]) continue;
      const x = k % S, y = (k / S) | 0;
      for (const [dx, dy] of DIRS) {
        if (!g.in(x + dx, y + dy)) continue;
        const b = g.idx(x + dx, y + dy);
        if (!tread(b)) continue;
        const d = g.H[b] - g.H[k], ad = Math.abs(d);
        if (ad <= 0.5 || ad > 1.2) continue;
        const sloped = g.kind[b] === HK.ramp;
        const shift = (ad - 0.45) * (sloped ? 0.5 : 1) * Math.sign(d);
        g.H[k] += shift; if (sloped && !g.lock[b]) g.H[b] -= shift;
        moved.add(k); any = true;
      }
    }
    if (!any) break;
  }
  return moved.size;
}

export { DIRS };
