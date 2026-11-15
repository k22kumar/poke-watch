// The ruin kit: reusable sanctuary and ruin pieces on the habitat tile field (docs/HABITATS.md, "The ruin kit").
//
// A landform kernel plans a precinct as an AXIS (a canonical column) with tiers along it and builds it from these pieces:
//
//   slab       a rectangular tier: a flat terrace at one height with a slightly ragged edge (the foundation or shelf)
//   block      a solid plinth: indestructible wall tiles `rise` above a tier, optionally skirted (the focal plinth, a pylon)
//   pillar     one indestructible column; colonnade() lays rows of them at a rhythm, with broken places
//   wall       a wall fragment along a polyline: pieces with gaps, 4-connected, never on reserved route space
//   walkway    a graded or flat tread (a balcony ledge, a stair between tiers) laid with the relief kernel
//
// Pieces are written in CANONICAL tile coordinates (u west→east, v north→south, before the seeded quarter turn and
// mirror), so one assembly serves any orientation; the kit converts through the context's own transform. Every piece
// is terrain (height, kind, wall flag), never a prop: it holds in every environment state, so a sightline built on one
// does not vanish when the stripped state removes destructible props. The kit counts what it laid (`pieces`), and the
// kernel records the counts so the tests and the audit can measure the assembly rather than trust it.
import { fbm } from '../../core/rng';
import { HK, type Approach, type HabCtx } from './ctx';
import { path, type Pt, type WP } from './families';

export interface Rect { u: [number, number]; v: [number, number] }
export interface Pieces { tiers: number; plinths: number; pillars: number; walls: number; walkways: number }

export class RuinKit {
  readonly g: HabCtx;
  readonly S1: number;
  readonly pieces: Pieces = { tiers: 0, plinths: 0, pillars: 0, walls: 0, walkways: 0 };
  constructor(g: HabCtx) { this.g = g; this.S1 = g.S - 1; }

  /** canonical tile coordinates → map tile coordinates */
  at(u: number, v: number): Pt { return this.g.P(u / this.S1, v / this.S1); }
  /** map tile coordinates → canonical */
  to(x: number, y: number): Pt { return this.g.Q(x, y); }
  /** a waypoint in canonical coordinates at height h */
  wp(u: number, v: number, h: number): WP { const [x, y] = this.at(u, v); return { x, y, h }; }

  /** every map tile whose centre lies in the canonical rectangle `r` grown by `grow` (tiles) */
  tilesIn(r: Rect, grow = 0): number[] {
    const g = this.g, out: number[] = [];
    for (let y = 0; y < g.S; y++) for (let x = 0; x < g.S; x++) {
      const [u, v] = this.to(x + 0.5, y + 0.5);
      if (u >= r.u[0] - grow && u <= r.u[1] + grow && v >= r.v[0] - grow && v <= r.v[1] + grow) out.push(g.idx(x, y));
    }
    return out;
  }

  /** a tier: the rectangle becomes floor of `kind` at height h. `ragged` (tiles) wobbles the edge so a terrace is not a
   *  ruler line; `can` keeps it off tiles it must not take (a tarn, a tread already laid). Returns the tiles. */
  slab(r: Rect, h: number, o: { kind?: number; lock?: boolean; platform?: boolean; ragged?: number; can?: (k: number) => boolean } = {}): number[] {
    const g = this.g, out: number[] = [], rg = o.ragged ?? 0, kind = o.kind ?? HK.terrace, sd = (g.seed & 0xfff) + 91 + this.pieces.tiers * 17;
    for (let y = 0; y < g.S; y++) for (let x = 0; x < g.S; x++) {
      const [u, v] = this.to(x + 0.5, y + 0.5), k = g.idx(x, y);
      const n = rg ? (fbm(u / 6, v / 6, sd, 2) - 0.5) * 2 * rg : 0;
      if (u < r.u[0] + n || u > r.u[1] + n || v < r.v[0] + n || v > r.v[1] + n) continue;
      if (g.kind[k] === HK.fluid || (o.can && !o.can(k))) continue;
      g.H[k] = h; g.kind[k] = kind;
      if (o.lock) g.lock[k] = 1;
      if (o.platform) g.platform[k] = 1;
      out.push(k);
    }
    this.pieces.tiers++; g.used.add('cliff');
    return out;
  }

  /** a solid plinth: the rectangle's tiles stand `rise` above their footing as indestructible wall (the focal block, a
   *  pylon). `skirt` adds a ring one tile wide at `skirtRise`, so the block reads as stepped. Reserved route space is
   *  never taken. Returns the tiles. */
  block(r: Rect, rise: number, o: { skirt?: number; skirtRise?: number; lock?: boolean } = {}): number[] {
    const g = this.g, out: number[] = [], sk = o.skirt ?? 0;
    for (const k of this.tilesIn(r, sk)) {
      if (g.keep[k] || g.kind[k] === HK.fluid || g.kind[k] === HK.rock || g.kind[k] === HK.ramp || g.kind[k] === HK.tunnel) continue;
      const x = k % g.S, y = (k / g.S) | 0, [u, v] = this.to(x + 0.5, y + 0.5);
      const inner = u >= r.u[0] && u <= r.u[1] && v >= r.v[0] && v <= r.v[1];
      g.H[k] += inner ? rise : (o.skirtRise ?? rise * 0.5); g.kind[k] = HK.rock;
      if (o.lock !== false) g.lock[k] = 1;
      out.push(k);
    }
    this.pieces.plinths++; g.used.add('structure');
    return out;
  }

  /** one column: a single indestructible tile `rise` above its footing. False where something reserved is there. */
  pillar(u: number, v: number, rise: number, can: (k: number) => boolean = () => true): number {
    const g = this.g, [x, y] = this.at(u, v), tx = Math.floor(x), ty = Math.floor(y);
    if (!g.in(tx, ty)) return -1;
    const k = g.idx(tx, ty);
    if (g.keep[k] || g.kind[k] === HK.fluid || g.kind[k] === HK.rock || g.kind[k] === HK.ramp || g.kind[k] === HK.tunnel || g.kind[k] === HK.mass || !can(k)) return -1;
    g.H[k] += rise; g.kind[k] = HK.rock; g.lock[k] = 1;
    this.pieces.pillars++; g.used.add('structure');
    return k;
  }

  /** rows of columns at a rhythm: for each u in `rows`, one column every `pitch` tiles from v0 to v1 (the rhythm may start
   *  `phase` tiles in). `broken(i, row)` omits one (a fallen column). Returns the columns laid. */
  colonnade(rows: number[], v0: number, v1: number, pitch: number, rise: number, o: { phase?: number; broken?: (i: number, row: number) => boolean; can?: (k: number) => boolean } = {}): number[] {
    const out: number[] = [];
    rows.forEach((u, row) => {
      let i = 0;
      for (let v = v0 + (o.phase ?? 0); v <= v1 + 1e-6; v += pitch, i++) {
        if (o.broken?.(i, row)) continue;
        const k = this.pillar(u, v, rise, o.can);
        if (k >= 0) out.push(k);
      }
    });
    return out;
  }

  /** a wall fragment along a canonical polyline: indestructible wall `rise` above the footing, laid as 4-connected tiles
   *  (no ray slips through a diagonal). `gaps` are [t0, t1] fractions of the length left open. Reserved route space, the
   *  platform's open floor (`avoid`) and fluid are left alone. Returns the tiles. */
  wall(pts: Pt[], rise: number, o: { gaps?: [number, number][]; avoid?: (k: number) => boolean } = {}): number[] {
    const g = this.g, out: number[] = [], seen = new Set<number>();
    let total = 0;
    for (let i = 1; i < pts.length; i++) total += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    const n = Math.max(1, Math.ceil(total * 2)), segAt = (t: number): Pt => {
      let s = t * total;
      for (let i = 1; i < pts.length; i++) {
        const l = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
        if (s <= l || i === pts.length - 1) { const f = l ? Math.min(1, s / l) : 0; return [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * f, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * f]; }
        s -= l;
      }
      return pts[pts.length - 1];
    };
    let px = -1, py = -1;
    const put = (x: number, y: number) => {
      if (!g.in(x, y)) return;
      const k = g.idx(x, y);
      if (seen.has(k)) return;
      if (g.keep[k] || g.kind[k] === HK.fluid || g.kind[k] === HK.rock || g.kind[k] === HK.ramp || g.kind[k] === HK.tunnel || g.kind[k] === HK.mass || (o.avoid && o.avoid(k))) return;
      seen.add(k); g.H[k] += rise; g.kind[k] = HK.rock; g.lock[k] = 1; out.push(k);
    };
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      if (o.gaps?.some(([a, b]) => t >= a && t <= b)) { px = -1; continue; }
      const [u, v] = segAt(t), [x, y] = this.at(u, v), tx = Math.floor(x), ty = Math.floor(y);
      if (px >= 0 && tx !== px && ty !== py) put(tx, py);
      put(tx, ty); px = tx; py = ty;
    }
    this.pieces.walls++; g.used.add('structure');
    return out;
  }

  /** a walkway: a tread through canonical waypoints (u, v, h). Flat legs are ledges (`shelf`); sloped legs are ramps. The
   *  tread may cut any tile that is not fluid, and claims it for `approach` when one is given. Returns the tiles. */
  walkway(pts: [number, number, number][], w: number, o: { approach?: Approach; keep?: number; kind?: number; can?: (k: number) => boolean } = {}): number[] {
    const g = this.g;
    const t = path(g, pts.map(([u, v, h]) => this.wp(u, v, h)), { w, kind: o.kind ?? HK.shelf, approach: o.approach, keep: o.keep ?? 1, can: o.can ?? ((k: number) => g.kind[k] !== HK.fluid && g.kind[k] !== HK.rock) });
    this.pieces.walkways++;
    return t;
  }
}

// ---- assemblies: pieces composed into the parts of a ruin ---------------------------------------------------------------------
//
// Each takes the kit, an axis (a canonical column) and the numbers for one part, and lays only kit pieces, so another ruin recipe
// (a shrine terrace, a tomb forecourt, a ring of standing stones) assembles the same parts with its own numbers, on its own axis,
// in any orientation. Nothing here names a place.

/** the gateway: two pylons either side of a stair's head (`v` is the row of the head's first step) and a wall fragment beyond each */
export function gateway(K: RuinKit, o: { axis: number; v: number; pylon: number; wall: number; wallLen: number }): void {
  K.block({ u: [o.axis - 6.5, o.axis - 5], v: [o.v - 3, o.v - 1.5] }, o.pylon);
  K.block({ u: [o.axis + 5, o.axis + 6.5], v: [o.v - 3, o.v - 1.5] }, o.pylon);
  for (const s of [-1, 1]) K.wall([[o.axis + s * 9, o.v - 1.5], [o.axis + s * (9 + o.wallLen), o.v - 1.5]], o.wall);
}

/** rows of columns either side of a lane: for each offset in `rows`, one row at `axis - offset` and one at `axis + offset` */
export function colonnadeCourt(K: RuinKit, o: { axis: number; rows: number[]; v0: number; v1: number; pitch: number; rise: number; phase: number; broken?: (i: number, row: number) => boolean }): number[] {
  return K.colonnade(o.rows.flatMap((r) => [o.axis - r, o.axis + r]), o.v0, o.v1, o.pitch, o.rise, { phase: o.phase, broken: o.broken });
}

/** the focal court of a platform spanning rows [v0, v1) and ±half of the axis: a solid plinth `plinthTop` rows in from the north edge
 *  (skirted), three tall columns about it, a flank row of columns either side, and a balustrade on the south edge laid from the
 *  `shoulder` side (-1 west, 1 east) so it is unbroken there, with its openings (fractions of its length) on the far side.
 *  Returns the plinth's footprint and the canonical point just in front of its south face where the landmark stands. */
export function focalCourt(K: RuinKit, o: {
  axis: number; v0: number; v1: number; half: number;
  plinthW: number; plinthD: number; plinthTop: number; plinthRise: number; spearRise: number;
  flank: { offset: number; pitch: number; rise: number; phase: number; broken?: (i: number, row: number) => boolean };
  shoulder: -1 | 1; balustradeRise: number; balustradeGaps: [number, number][];
}): { plinth: Rect; landmark: Pt } {
  const top = o.v0 + o.plinthTop, plinth: Rect = { u: [o.axis - o.plinthW / 2, o.axis + o.plinthW / 2], v: [top, top + o.plinthD] };
  K.block(plinth, o.plinthRise, { skirt: 1, skirtRise: 1.1 });
  K.pillar(o.axis - o.plinthW / 2 - 3.2, top + 1, o.spearRise); K.pillar(o.axis + o.plinthW / 2 + 3.2, top + 1, o.spearRise); K.pillar(o.axis, top - 3, o.spearRise);
  K.colonnade([o.axis - o.flank.offset, o.axis + o.flank.offset], top + 4, o.v1 - 9, o.flank.pitch, o.flank.rise, { phase: o.flank.phase, broken: o.flank.broken });
  K.wall([[o.axis + o.shoulder * (o.half - 1.5), o.v1 - 1.5], [o.axis - o.shoulder * (o.half - 1.5), o.v1 - 1.5]], o.balustradeRise, { gaps: o.balustradeGaps });
  return { plinth, landmark: [o.axis, top + o.plinthD + 2.4] };
}
