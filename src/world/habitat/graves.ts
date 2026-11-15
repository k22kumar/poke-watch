// The grave marker family (spec A14 grave marker and stele, C10 cemetery precinct; docs/HABITATS.md "Cemetery").
//
// One module, no recipe: a marker is a footprint (1 or 2 tiles wide), a height class and a lean, and a *plot* lays markers
// on a lattice along a contour with a pitch, a row spacing, a shear angle, a curvature and a seed-drawn mix. Any habitat
// that has a reserved piece of walkable ground and a contour (a terrace edge, a ridge line, a ruin court) can call
// `planPlot`, then `commitGraves` after the map is written (tests/graves.test.ts lays one on the Shrine Gorge's rim).
//
// What the family guarantees, whatever the habitat:
//   height     three classes bracket the roster's muzzle extremes (tiles.ts GRAVE_TOP): a kerb (0.45 m) stands under every
//              muzzle and is walkable; a headstone (0.9 m) stops the smallest muzzles (0.5 m) and the tallest fire over it
//              (1.42 m); a stele (1.7 m) stands over every muzzle. The collision is the platform height, so a ray at a
//              muzzle height meets exactly what the sprite shows (validate.ts checks the bracket on the built map).
//   spacing    markers keep ≥ 2 clear tiles between blockers (never a one-tile gap a large body half-fits) and sit ≥ `tread`
//              tiles from any tread, route, hazard, platform, deck or reserved tile; a plot only ever uses ground that is
//              flat, playable and open.
//   angles     the lattice is sheared by `angle`, and `planPlot` is called with alternating signs for neighbouring plots, so
//              no straight lane between rows runs through two plots (R21: opposing angles at each plot seam).
//   lean       -1, 0 or 1: which way the stone settled. Cosmetic by design (the collision is the tile); recorded so a map
//              and its checksum agree on how it looks.
//   immutable  a grave is terrain-grade cover (rules/surfaces.ts: integrity 0): the stripped state keeps it, so a sightline
//              built on markers holds in every state.
import { GRAVE_TOP, type GraveClass } from '../tiles';
import type { Rng } from '../../core/rng';
import { HK, type HabCtx } from './ctx';
import { along, cumLen, type Pt } from './families';

export interface GraveMark {
  /** top-left tile */
  x: number; y: number;
  /** footprint width in tiles (the height is one tile) */
  w: 1 | 2;
  cls: GraveClass;
  /** height above the footing (m) */
  top: number;
  lean: -1 | 0 | 1;
  /** which plot laid it */
  plot: number;
}

/** how one plot grouping lays its markers. Every number is a freedom a recipe can range over by seed. */
export interface PlotRule {
  /** the contour the rows follow: a polyline in tile coordinates, in walking order */
  contour: Pt[];
  /** rows across the contour and the cell count along it (a plot is a rows × cols lattice, some cells skipped) */
  rows: number; cols: number;
  /** centre-to-centre spacing along a row and between rows (tiles; at least 3 so two clear tiles remain between 1-wide markers) */
  pitch: number; rowGap: number;
  /** where along the contour the plot starts (tiles of arc length) */
  start: number;
  /** shear (radians): the lanes between rows lean this far off the contour; neighbouring plots use opposite signs */
  angle: number;
  /** alternate markers kink this far (tiles) to either side of their row's line, so the alley between two rows is never straight */
  wave: number;
  /** how far each marker is moved off its lattice cell (tiles, each axis) */
  jitter: number;
  /** chance a cell is left empty (a plot with gaps, sunken or lost stones) */
  skip: number;
  /** class weights: kerb / stone / stele, and the chance a stone is a double slab (2 wide) */
  mix: { kerb: number; stone: number; stele: number };
  wide: number;
  /** chance a marker leans (its direction follows the plot's side) */
  lean: number;
  /** tiles kept clear of treads, routes, hazards and other reserved ground */
  tread: number;
  /** extra rule for a candidate tile (e.g. stay inside a terrace); the family's own rules always apply */
  can?: (k: number) => boolean;
}

export interface GravePlot { id: number; marks: GraveMark[]; rule: PlotRule }

/** a marker's plot zone (tiles from its footprint): the ground a row alley lies on, and where the lane test counts a lane */
export const PLOT_ZONE = 1.8;

/** a free footprint: flat, open ground the plot may use, ≥ `tread` from reserved tiles, ≥ 2 clear tiles from other markers */
function fits(g: HabCtx, x: number, y: number, w: number, tread: number, can?: (k: number) => boolean): boolean {
  if (!g.in(x, y) || !g.in(x + w - 1, y)) return false;
  const k0 = g.idx(x, y), e0 = g.H[k0];
  for (let i = x; i < x + w; i++) {
    const k = g.idx(i, y);
    const kind = g.kind[k];
    if (kind !== HK.floor && kind !== HK.terrace && kind !== HK.shelf && kind !== HK.bank) return false;
    if (g.H[k] !== e0 || g.hazard[k] || g.over[k] > 0 || (g.lock[k] && kind !== HK.terrace) || g.platform[k] || g.culvert[k] || g.tide[k]) return false;
    if (can && !can(k)) return false;
  }
  // clear of every reserved tile within `tread`, and of treads (a route, ramp or tunnel) a little further than that
  for (let j = y - tread; j <= y + tread; j++) for (let i = x - tread; i < x + w + tread; i++) {
    if (!g.in(i, j)) return false;
    const k = g.idx(i, j), t = g.kind[k];
    if (g.keep[k] || t === HK.route || t === HK.ramp || t === HK.tunnel || t === HK.fluid || g.over[k] > 0) return false;
  }
  // two clear tiles to every other marker and every wall piece (centres 3 apart at the least): never a one-tile gap
  for (let j = y - 2; j <= y + 2; j++) for (let i = x - 2; i <= x + w + 1; i++) {
    if (!g.in(i, j)) continue;
    const k = g.idx(i, j);
    if (g.kind[k] === HK.rock || g.marked[k]) return false;
  }
  return true;
}

/** plan one plot: choose its markers and reserve their footprints (g.marked) and the ground between them (g.keep stays
 *  untouched: the family never changes what a route owns). Nothing is drawn until `commitGraves`. */
export function planPlot(g: HabCtx, R: Rng, rule: PlotRule): GravePlot {
  g.used.add('structure'); g.used.add('boulder'); // a marker is the boulder family's upright outcrop, a plot a structure
  const id = g.plots.length, plot: GravePlot = { id, marks: [], rule };
  g.plots.push(plot);
  const cum = cumLen(rule.contour), total = cum[cum.length - 1];
  const wsum = rule.mix.kerb + rule.mix.stone + rule.mix.stele;
  const shear = Math.tan(rule.angle);
  for (let r = 0; r < rule.rows; r++) {
    const off = (r - (rule.rows - 1) / 2) * rule.rowGap;
    for (let c = 0; c < rule.cols; c++) {
      // a brick lattice: odd rows shift half a pitch, so no lane runs straight along a column; the shear tilts the lanes
      const s = rule.start + c * rule.pitch + (r % 2 ? rule.pitch / 2 : 0) + off * shear;
      if (s < 0 || s > total) continue;
      const [px, py] = along(rule.contour, cum, s), [qx, qy] = along(rule.contour, cum, Math.min(total, s + 1)), [ox, oy] = along(rule.contour, cum, Math.max(0, s - 1));
      let tx = qx - ox, ty = qy - oy; const tl = Math.hypot(tx, ty) || 1; tx /= tl; ty /= tl;
      // every draw is taken whether or not the cell is used, so one plot's cells never shift another's by a refusal
      const jx = R.range(-1, 1) * rule.jitter, jy = R.range(-1, 1) * rule.jitter, skip = R.next() < rule.skip, u = R.next() * wsum;
      const wideDraw = R.next() < rule.wide, leanDraw = R.next() < rule.lean, dir = R.next() < 0.5 ? 1 : -1;
      if (skip) continue;
      const wv = rule.wave * ((c + r) % 2 ? 1 : -1), no = off + wv;
      const x = px - ty * no + jx, y = py + tx * no + jy;
      const cls: GraveClass = u < rule.mix.kerb ? 'kerb' : u < rule.mix.kerb + rule.mix.stone ? 'stone' : 'stele';
      const w: 1 | 2 = cls === 'stone' && wideDraw ? 2 : 1;
      const leans = leanDraw;
      placeMark(g, plot, x, y, cls, w, leans ? (dir as 1 | -1) : 0);
    }
  }
  return plot;
}

/** take the last planned plot back (a plot that came out too small to read as a group): its footprints are free again */
export function dropPlot(g: HabCtx, plot: GravePlot) {
  for (const mk of plot.marks) for (let i = mk.x; i < mk.x + mk.w; i++) g.marked[g.idx(i, mk.y)] = 0;
  const at = g.plots.indexOf(plot);
  if (at >= 0) g.plots.splice(at, 1);
}

/** one marker at a point (tile coordinates; its footprint centred there), by the plot's rules: refused (null) when the ground
 *  is not free. `planPlot` places every marker through here, so a lone stele beside a gate follows the same spacing. */
export function placeMark(g: HabCtx, plot: GravePlot, x: number, y: number, cls: GraveClass, w: 1 | 2 = 1, lean: -1 | 0 | 1 = 0): GraveMark | null {
  const mx = Math.round(x - w / 2), my = Math.round(y - 0.5);
  if (!fits(g, mx, my, w, plot.rule.tread, plot.rule.can)) return null;
  const mark: GraveMark = { x: mx, y: my, w, cls, top: GRAVE_TOP[cls], lean, plot: plot.id };
  plot.marks.push(mark);
  for (let i = mx; i < mx + w; i++) g.marked[g.idx(i, my)] = 1;
  return mark;
}

/** draw every planned marker into the map (after `write`): one `grave` prop each, its height the platform the sim reads */
export function commitGraves(g: HabCtx): number {
  let n = 0;
  for (const P of g.plots) for (const mk of P.marks) {
    if (g.b.prop('grave', mk.x, mk.y, { top: mk.top, w: mk.w, lean: mk.lean, force: true, allowPath: true })) { g.graves.push(mk); n++; }
  }
  return n;
}

/** change a planned marker's class in place (before `commitGraves`): used to guarantee every class exists in a map. A stele and a kerb
 *  are one tile wide, so a double slab gives its second tile back. */
export function retype(g: HabCtx, mark: GraveMark, cls: GraveClass) {
  if (cls !== 'stone' && mark.w === 2) { g.marked[g.idx(mark.x + 1, mark.y)] = 0; mark.w = 1; }
  mark.cls = cls; mark.top = GRAVE_TOP[cls];
}

/** the classes' tops bracket the muzzle extremes: kerb under the lowest, stone between, stele over the highest */
export function bracketsMuzzles(lo: number, hi: number): { ok: boolean; why: string } {
  const { kerb, stone, stele } = GRAVE_TOP;
  const ok = kerb < lo && lo < stone && stone < hi && hi < stele;
  return { ok, why: `kerb ${kerb} < muzzle ${lo} < stone ${stone} < muzzle ${hi} < stele ${stele}` };
}
