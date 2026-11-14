// Layer B — meso structure. Turn the graph into playable space with purposeful heights:
//   zones     → wobbly ellipses at their tier height (overlapping zones of different tiers meet as a drop ledge)
//   links     → corridors along a smoothed centre line; flats keep their tier, ramps climb one tier at `slope` m per
//               tile along the line (so every 4-neighbour step stays under the 0.6 m step rule), bridges are decks
//               across a chasm cut into the enclosure, so a lower route never runs under them
//   hops      → a player-only climb: a flat approach and a step at half a tier against the upper zone's cliff
//   enclosure → forest ground under the trees follows the nearest playable height; rock masses rise above it
// Order matters and is fixed: zones, ramps, bridges, flats, hops, enclosure.
import { fbm } from '../../core/rng';
import { K, type Link, type LocCtx, type Zone } from './ctx';
import { CLEARANCE } from './decks';

const DIRS: [number, number][] = [[1, 0], [0, 1], [-1, 0], [0, -1]];

export function realize(g: LocCtx) {
  const S = g.S, R = g.rng('realize'), G = g.def.gameplay;
  const wob = R.int(1, 1e6);
  // zones: each tile goes to the zone whose ellipse it is deepest inside
  const best = new Float32Array(S * S).fill(Infinity);
  for (const z of g.zones) {
    const ext = Math.ceil(Math.max(z.rx, z.ry) + 3);
    for (let y = Math.floor(z.y - ext); y <= z.y + ext; y++) for (let x = Math.floor(z.x - ext); x <= z.x + ext; x++) {
      if (!g.in(x, y) || x < 2 || y < 2 || x >= S - 2 || y >= S - 2) continue;
      const ax = (x + 0.5 - z.x) / z.rx, ay = (y + 0.5 - z.y) / z.ry;
      const d = Math.sqrt(ax * ax + ay * ay) - (fbm(x / 6, y / 6, wob + z.id, 2) - 0.5) * 0.45;
      if (d > 1) continue;
      const k = g.idx(x, y);
      if (d < best[k]) { best[k] = d; g.kind[k] = K.zone; g.zoneOf[k] = z.id; g.H[k] = z.h; }
    }
  }
  for (const L of g.links) L.pts = centreLine(g, L, R.range(-0.16, 0.16));
  const order = [...g.links].sort((p, q) => rank(p) - rank(q) || p.id - q.id);
  for (const L of order) carve(g, L);
  for (const [lo, hi] of g.hops) hop(g, g.zones[lo], g.zones[hi]);
  enclose(g);
}

const rank = (L: Link) => (L.kind === 'ramp' ? 0 : L.kind === 'bridge' ? 1 : L.kind === 'path' ? 2 : 3);

/** smoothed centre line from zone a to zone b; flat links bow sideways by `bow` of their length */
function centreLine(g: LocCtx, L: Link, bow: number): [number, number][] {
  const A = g.zones[L.a], B = g.zones[L.b];
  const dx = B.x - A.x, dy = B.y - A.y, len = Math.sqrt(dx * dx + dy * dy) || 1;
  const off = L.kind === 'path' || L.kind === 'trail' ? bow * len : 0;
  let pts: [number, number][] = [[A.x, A.y], [(A.x + B.x) / 2 - (dy / len) * off, (A.y + B.y) / 2 + (dx / len) * off], [B.x, B.y]];
  for (let c = 0; c < 2; c++) {
    const out: [number, number][] = [pts[0]];
    for (let i = 0; i < pts.length - 1; i++) {
      const [ax, ay] = pts[i], [bx, by] = pts[i + 1];
      out.push([ax * 0.75 + bx * 0.25, ay * 0.75 + by * 0.25], [ax * 0.25 + bx * 0.75, ay * 0.25 + by * 0.75]);
    }
    out.push(pts[pts.length - 1]);
    pts = out;
  }
  return pts;
}

/** nearest point on the polyline: [distance, arc length, side (+1 left / -1 right of the direction of travel)] */
function project(pts: [number, number][], px: number, py: number, cum: number[]): [number, number, number] {
  let bd = Infinity, bs = 0, side = 1;
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, ay] = pts[i], [bx, by] = pts[i + 1];
    const vx = bx - ax, vy = by - ay, l2 = vx * vx + vy * vy || 1e-9;
    const t = Math.max(0, Math.min(1, ((px - ax) * vx + (py - ay) * vy) / l2));
    const qx = ax + vx * t, qy = ay + vy * t, d = Math.sqrt((px - qx) ** 2 + (py - qy) ** 2);
    if (d < bd) { bd = d; bs = cum[i] + t * Math.sqrt(l2); side = vx * (py - ay) - vy * (px - ax) >= 0 ? 1 : -1; }
  }
  return [bd, bs, side];
}

function carve(g: LocCtx, L: Link) {
  const S = g.S, G = g.def.gameplay, A = g.zones[L.a], B = g.zones[L.b], pts = L.pts;
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.sqrt((pts[i][0] - pts[i - 1][0]) ** 2 + (pts[i][1] - pts[i - 1][1]) ** 2));
  const total = cum[cum.length - 1];
  // where the line leaves A and enters B (sampled every half tile)
  let sA = 0, sB = total;
  for (let s = 0; s <= total; s += 0.5) { const [x, y] = at(pts, cum, s); const k = g.idx(Math.floor(x), Math.floor(y)); if (g.zoneOf[k] !== A.id) { sA = s; break; } }
  for (let s = total; s >= 0; s -= 0.5) { const [x, y] = at(pts, cum, s); const k = g.idx(Math.floor(x), Math.floor(y)); if (g.zoneOf[k] !== B.id) { sB = s; break; } }
  const dh = B.h - A.h;
  // a ramp sits centred on the gap; when the gap is short it reaches into the zones (a ramp down into a hall)
  const lr = Math.abs(dh) / G.slope;
  const mid = (sA + sB) / 2;
  const s0 = Math.max(1, mid - lr / 2), s1 = Math.min(total - 1, s0 + lr);
  const hAt = (s: number) => (L.kind !== 'ramp' ? A.h : s <= s0 ? A.h : s >= s1 ? B.h : A.h + (dh * (s - s0)) / (s1 - s0));
  const half = L.w / 2;
  // terrace: the ramp is a strip along one side (rampW wide); the rest of the junction splits at the cliff line
  const rampSide = L.id & 1 ? 1 : -1, strip = half - G.rampW;
  const chasmW = L.kind === 'bridge' ? 4 : 0;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of pts) { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); }
  const pad = Math.ceil(half + chasmW + 1);
  for (let y = Math.max(2, Math.floor(minY - pad)); y <= Math.min(S - 3, maxY + pad); y++)
    for (let x = Math.max(2, Math.floor(minX - pad)); x <= Math.min(S - 3, maxX + pad); x++) {
      const [d, s, side] = project(pts, x + 0.5, y + 0.5, cum);
      const k = g.idx(x, y), own = g.zoneOf[k];
      if (d <= half && L.terrace && !(side === rampSide && d >= strip)) {
        // terrace floor: the gap between the zones splits at the cliff line; the zones keep their own floors
        if (own >= 0 || g.linkOf[k] >= 0) continue;
        g.kind[k] = K.corridor; g.H[k] = s < mid ? A.h : B.h; g.linkOf[k] = L.id;
        L.tiles.push(k);
      } else if (d <= half) {
        if (L.kind === 'ramp') {
          // the ramp may cut into its own two zones, never into a third or another link
          if (own >= 0 && own !== A.id && own !== B.id) continue;
          if (g.linkOf[k] >= 0) continue;
          if (own >= 0 && (s < s0 - 0.5 || s > s1 + 0.5)) continue;
          g.kind[k] = s > s0 - 0.5 && s < s1 + 0.5 ? K.ramp : K.corridor; g.H[k] = hAt(s); g.linkOf[k] = L.id; g.zoneOf[k] = -1;
          L.tiles.push(k);
        } else {
          // a flat trail meeting a bridge deck well above it passes under the deck (decks.ts builds the underpass)
          if (own < 0 && g.linkOf[k] >= 0 && g.kind[k] === K.deck && L.kind !== 'bridge' && g.H[k] - hAt(s) >= CLEARANCE) {
            if (g.under[k] < 0 || hAt(s) < g.under[k]) g.under[k] = hAt(s);
            if (!L.tiles.includes(k)) L.tiles.push(k);
            continue;
          }
          if (own >= 0 || g.linkOf[k] >= 0) continue;
          g.kind[k] = L.kind === 'bridge' ? K.deck : K.corridor; g.H[k] = hAt(s); g.linkOf[k] = L.id;
          L.tiles.push(k);
        }
      } else if (chasmW && d <= half + chasmW && own < 0 && g.linkOf[k] < 0 && g.kind[k] === K.mass && s > 1 && s < total - 1) {
        g.kind[k] = K.chasm;
      }
    }
}

function at(pts: [number, number][], cum: number[], s: number): [number, number] {
  for (let i = 0; i < pts.length - 1; i++) {
    if (s <= cum[i + 1] || i === pts.length - 2) {
      const t = (s - cum[i]) / Math.max(1e-9, cum[i + 1] - cum[i]);
      return [pts[i][0] + (pts[i + 1][0] - pts[i][0]) * t, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * t];
    }
  }
  return pts[pts.length - 1];
}

/** player-only climb from `lo` up to `hi`: a 3-wide approach at lo's height and a half-tier step against hi's rim */
function hop(g: LocCtx, lo: Zone, hi: Zone) {
  // the closest pair of tiles between the two zones
  let bp = -1, bq = -1, bd = Infinity;
  const S = g.S;
  for (let k = 0; k < S * S; k++) {
    if (g.zoneOf[k] !== lo.id) continue;
    const x = k % S, y = (k / S) | 0;
    const dd = (x - hi.x) ** 2 + (y - hi.y) ** 2;
    if (dd < bd) { bd = dd; bp = k; }
  }
  if (bp < 0) return;
  const px = bp % S, py = (bp / S) | 0;
  const len = Math.sqrt(bd), ux = (hi.x - px) / len, uy = (hi.y - py) / len;
  // walk toward hi until its floor; remember the strip
  const strip: [number, number, number][] = [];
  for (let s = 0; s < 22; s += 0.5) {
    const x = Math.floor(px + 0.5 + ux * s), y = Math.floor(py + 0.5 + uy * s);
    if (!g.in(x, y)) return;
    const k = g.idx(x, y);
    if (g.zoneOf[k] === hi.id) { bq = k; break; }
    if (!strip.some((t) => t[0] === k)) strip.push([k, x, y]);
  }
  if (bq < 0 || strip.length < 1) return;
  const mid = lo.h + (hi.h - lo.h) / 2;
  const n = strip.length;
  for (let i = 0; i < n; i++) {
    const [, x, y] = strip[i];
    const step = i >= n - 2;
    for (let o = -1; o <= 1; o++) {
      const ax = x + (Math.abs(ux) > Math.abs(uy) ? 0 : o), ay = y + (Math.abs(ux) > Math.abs(uy) ? o : 0);
      if (!g.in(ax, ay)) continue;
      const k = g.idx(ax, ay);
      if (g.zoneOf[k] === hi.id || g.linkOf[k] >= 0) continue;
      if (g.zoneOf[k] >= 0 && g.zoneOf[k] !== lo.id) continue;
      if (step) { g.kind[k] = K.step; g.H[k] = mid; g.zoneOf[k] = -1; }
      else if (g.zoneOf[k] !== lo.id) { g.kind[k] = K.corridor; g.H[k] = lo.h; }
    }
  }
  // the middle tile of the step row nearest the upper cliff: where a ladder (or similar) can lean
  const [, sx, sy] = strip[n - 1];
  g.steps.push([sx, sy]);
  g.notes.push(`hop ${lo.id}->${hi.id}`);
}

/** height and walls of everything that is not playable */
function enclose(g: LocCtx) {
  const S = g.S, n = S * S, E = g.def.enclosure, m = g.m;
  // multi-source BFS from playable tiles: nearest playable height (ties keep the higher) and distance
  const near = new Float32Array(n).fill(-1), dist = new Int32Array(n).fill(-1), Q = new Int32Array(n);
  let h = 0, t = 0;
  for (let k = 0; k < n; k++) if (g.play(k)) { near[k] = g.H[k]; dist[k] = 0; Q[t++] = k; }
  while (h < t) {
    const a = Q[h++], ax = a % S, ay = (a / S) | 0;
    for (const [dx, dy] of DIRS) {
      const x = ax + dx, y = ay + dy;
      if (!g.in(x, y)) continue;
      const b = g.idx(x, y);
      if (dist[b] < 0) { dist[b] = dist[a] + 1; near[b] = near[a]; Q[t++] = b; }
      else if (dist[b] === dist[a] + 1 && near[a] > near[b]) near[b] = near[a];
    }
  }
  const s = g.rng('enclose').int(1, 1e6);
  let low = Infinity;
  for (let k = 0; k < n; k++) if (g.play(k)) low = Math.min(low, g.H[k]);
  if (low === Infinity) low = 0;
  for (let k = 0; k < n; k++) {
    const x = k % S, y = (k / S) | 0;
    if (g.play(k)) { m.elev[k] = g.H[k]; continue; }
    if (g.kind[k] === K.chasm) { m.elev[k] = low - (E.chasm === 'abyss' ? 6 : 4.5); m.wall[k] = 1; continue; }
    const base = near[k] < 0 ? low : near[k];
    if (E.kind === 'rock') {
      // big flat-topped masses in 0.6 m steps (a few broad shoulders, not a ring of thin terraces every tile)
      m.elev[k] = base + E.wallRise + (dist[k] >= 3 ? 1.2 : 0) + Math.round(fbm(x / 9, y / 9, s, 2) * 3) * 0.6;
      m.wall[k] = 1;
    } else {
      m.elev[k] = base; // forest floor under the trees; dress.ts plants them and sets the walls
    }
  }
}
