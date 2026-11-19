// Screen-space framing for the third-person view (docs/THIRD_PERSON.md "Composition"). Pure maths: no GL, no DOM, no
// sim. Three things live here so the rig (render/camera.ts), the renderer, the Node diagnostics and the tests all use
// the same numbers:
//
//   the billboard card   where the shaders put a sprite's texels (stretch by 1 / cos of the seen elevation, lean past
//                        the stretch cap), so a sprite's outline can be projected without a GPU
//   the keep-out         the region around the crosshair the player's own Pokémon stays out of: it must lie left of
//                        `side` degrees or below `below` degrees (the crosshair is the view axis)
//   the framing law      the ideal arm (back distance, shoulder offset, pivot height) for a sprite's measured outline:
//                        its top-right corner sits on the keep-out's lower-left corner
import { TEXELS_PER_METRE, type FrameBounds, type Silhouette } from '../assets/art';

const D2R = Math.PI / 180, R2D = 180 / Math.PI;
const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);

/** the billboard shaders' stretch cap, and the seen elevation (rad) up to which it keeps texels square: past it a card
 *  leans back instead (render/tilestage.ts LEAN_GLSL) */
export const STRETCH_MAX = 1.6;
export const LEAN_FROM = Math.acos(1 / STRETCH_MAX);

/** The vertical stretch the billboard shaders give a card whose anchor is (dx, dy, dz) from the lens: 1 / cos of the
 *  elevation it is seen at, with the horizontal distance floored at 0.5 m, inside [1, STRETCH_MAX]. The GLSL twin is
 *  `clamp(length(d) / max(length(d.xz), 0.5), 1.0, 1.6)` in CREATURE_VS and BB_VS */
export function billboardStretch(dx: number, dy: number, dz: number): number {
  return clamp(Math.hypot(dx, dy, dz) / Math.max(Math.hypot(dx, dz), 0.5), 1, STRETCH_MAX);
}

/** what a point is seen through: the lens, the yaw (the view direction is (sin yaw, cos yaw)) and the axis' pitch below
 *  the horizon. A ViewSample, an AimView and the rig itself all fit */
export interface ViewLike { readonly eye: readonly number[]; readonly yaw: number; readonly viewPitch: number }

/** A world point as `v` sees it: its angles from the view axis (deg; right +, up +) and its depth along the axis (m).
 *  The depth is floored at 5 cm so a point at the lens still has angles */
export function seen(v: ViewLike, x: number, y: number, z: number): [number, number, number] {
  const sy = Math.sin(v.yaw), cy = Math.cos(v.yaw), sp = Math.sin(v.viewPitch), cp = Math.cos(v.viewPitch);
  const d0 = x - v.eye[0], d1 = y - v.eye[1], d2 = z - v.eye[2];
  // the basis of mat4.viewYawPitch: forward, right from the yaw (no roll), up = back × right
  const depth = d0 * sy * cp - d1 * sp + d2 * cy * cp, rx = d0 * -cy + d2 * sy, uy = d0 * sy * sp + d1 * cp + d2 * cy * sp;
  const q = Math.max(depth, 0.05);
  return [Math.atan2(rx, q) * R2D, Math.atan2(uy, q) * R2D, depth];
}

/** The outline of a drawn sprite frame around its anchor, in metres before the stretch: left and right of the anchor,
 *  above and below it. `dx` / `dy`: the procedural offset the frame is drawn with (OVERLAY), sideways and up */
export interface CardBounds { l: number; r: number; t: number; b: number; dx?: number; dy?: number }

/** The world position of a point of an upright billboard anchored at `a` (the feet): `lx` m to the right of the anchor
 *  along the camera's right, `ly` m above it before the stretch, plus the vertical offset `dy`. Mirrors CREATURE_VS:
 *  stretched by billboardStretch, leaning back about the camera's right axis by the excess over LEAN_FROM when `lean` */
export function cardPoint(v: ViewLike, a: readonly number[], lx: number, ly: number, dy = 0, lean = true): [number, number, number] {
  const sy = Math.sin(v.yaw), cy = Math.cos(v.yaw);
  const d0 = a[0] - v.eye[0], d1 = a[1] - v.eye[1], d2 = a[2] - v.eye[2];
  const h = ly * billboardStretch(d0, d1, d2);
  let ux = 0, uy = 1, uz = 0;
  if (lean) {
    const el = Math.atan2(-d1, Math.hypot(d0, d2)), ex = Math.sign(el) * Math.max(0, Math.abs(el) - LEAN_FROM);
    if (ex !== 0) { ux = sy * Math.sin(ex); uy = Math.cos(ex); uz = cy * Math.sin(ex); }
  }
  return [a[0] - cy * lx + ux * h, a[1] + uy * h + dy, a[2] + sy * lx + uz * h];
}

/** the keep-out around the crosshair (CHASE_CONFIG.reticle, degrees): the Pokémon must lie left of `side` or below `below` */
export interface KeepOut { side: number; below: number }

/** A drawn frame on screen: its bounds in degrees from the view axis (right +, up +), the depth of its anchor along the
 *  axis, and `depth`: how far it reaches into the keep-out (deg; the smaller of how far right of the keep-out's left edge
 *  and how far above its lower edge the worst point of the frame's right edge is). 0 or less: outside */
export interface SubjectBox { left: number; right: number; top: number; bottom: number; dist: number; depth: number }

/** Project the frame `b` of a sprite anchored at `a` through `v` (see cardPoint) and measure it against the keep-out */
export function subjectBox(v: ViewLike, a: readonly number[], b: CardBounds, K: KeepOut, lean = true): SubjectBox {
  const dx = b.dx ?? 0, dy = b.dy ?? 0;
  let left = Infinity, right = -Infinity, top = -Infinity, bottom = Infinity, depth = -Infinity;
  // the right edge, bottom to top: the keep-out is entered where a point is both right of its left edge and above its
  // lower edge (the card is seen in perspective, so its right edge is not a vertical line on screen)
  const N = 6;
  for (let i = 0; i <= N; i++) {
    const ly = -b.b + ((b.t + b.b) * i) / N, p = cardPoint(v, a, b.r + dx, ly, dy, lean), s = seen(v, p[0], p[1], p[2]);
    if (s[0] > right) right = s[0];
    if (s[1] > top) top = s[1];
    if (s[1] < bottom) bottom = s[1];
    const d = Math.min(s[0] + K.side, s[1] + K.below);
    if (d > depth) depth = d;
  }
  for (const ly of [-b.b, b.t]) {
    const p = cardPoint(v, a, -b.l + dx, ly, dy, lean), s = seen(v, p[0], p[1], p[2]);
    if (s[0] < left) left = s[0];
    if (s[1] > top) top = s[1];
    if (s[1] < bottom) bottom = s[1];
  }
  return { left, right, top, bottom, dist: seen(v, a[0], a[1], a[2])[2], depth };
}

/** how far inside the keep-out (deg) a frame may reach before it dissolves: the composition puts the outline's corner
 *  exactly on the keep-out's, so a frame that is the outline sits at 0, give or take the lean of a steeply seen card */
export const KEEP_SLACK = 0.3;
/** The dissolve the player's own Pokémon is drawn with for a frame `depth` degrees inside the keep-out (the documented
 *  fallback, docs/THIRD_PERSON.md "Composition"): none up to KEEP_SLACK, half at once past it, three quarters two
 *  degrees in */
export function fadeFor(depth: number): number {
  return depth <= KEEP_SLACK ? 0 : 0.5 + 0.25 * Math.min(1, (depth - KEEP_SLACK) / 2);
}

// ----------------------------------------------------------------------------------------------------------
// The framing law
// ----------------------------------------------------------------------------------------------------------

/** A sprite's outline as the rig frames it, in metres before the stretch, procedural offsets included: the ordinary body
 *  (idle + walk, all rows: `top` above the anchor, `right` / `left` of it, `drop` below it) and the combat frames'
 *  outermost (right, top) corners. A PMD sprite's anchor is the middle of its ground footprint, so the picture reaches
 *  below it (`drop`, 0 when absent): the body's drawn height is `top + drop` */
export interface Outline { top: number; right: number; left: number; drop?: number; combat: readonly (readonly [number, number])[] }

/** A measured silhouette (texels) at the species' drawn scale (SpeciesSizing.scale × any authored scale) as an Outline */
export function outlineOf(s: Silhouette, scale: number): Outline {
  const k = scale / TEXELS_PER_METRE;
  return { top: s.body.t * k + s.bodyOver.y, right: s.body.r * k + s.bodyOver.x, left: s.body.l * k + s.bodyOver.x, drop: s.body.b * k, combat: s.combat.map((c) => [c.r * k + c.ox, c.t * k + c.oy] as const) };
}

/** The outline assumed for a subject whose art is not measured (a Node run that decodes no atlas, a synthetic frame):
 *  the medians of the measured roster against the size class's visible core (top 1.2 ×, reach 0.7 ×, drop 0.25 ×) */
export function classOutline(visual: number): Outline {
  return { top: 1.2 * visual, right: 0.7 * visual, left: 0.7 * visual, drop: 0.25 * visual, combat: [] };
}

/** one frame's bounds (texels) at a drawn scale, as a CardBounds */
export function cardOf(b: FrameBounds, scale: number, dx = 0, dy = 0): CardBounds {
  const k = scale / TEXELS_PER_METRE;
  return { l: b.l * k, r: b.r * k, t: b.t * k, b: b.b * k, dx, dy };
}

/** back distance = `boom` × (drawn body height / `ref`) ^ `exp`, inside [`min`, `max`] (CHASE_CONFIG.frame). The drawn
 *  body height is the outline's `top + drop`: with the top pinned under the crosshair line, the arm's length decides
 *  where the body's lowest drawn point lands, and that has to stay over the HUD's move bar */
export interface FrameLaw { ref: number; boom: number; exp: number; min: number; max: number }
export function backFor(top: number, F: FrameLaw): number {
  return clamp(F.boom * Math.pow(Math.max(top, 0.05) / F.ref, F.exp), F.min, F.max);
}

/** CHASE_CONFIG.reticle: the keep-out, and the most the fixed combat allowance may move the corner: `reach` degrees
 *  sideways, `rise` degrees upward (0: the allowance only ever moves the Pokémon further left, never lower) */
export interface Reticle extends KeepOut { reach: number; rise: number }

/** The corner the composition pins to the keep-out: the body's (right, top), moved by the fixed combat allowance. The
 *  allowance is the smallest shift (the larger of its sideways and upward angles at `back` m, the upward one through the
 *  stretch `st`) after which no combat corner lies both further right and higher, with the sideways part capped at
 *  `reach` degrees and the upward part at `rise`. `need`: that shift before the caps (deg); `capped`: some combat frame
 *  still reaches past the corner */
export function reserveCorner(o: Outline, back: number, st: number, R: Reticle): { right: number; top: number; need: number; capped: boolean } {
  const off = o.combat.filter((c) => c[0] > o.right + 1e-9 && c[1] > o.top + 1e-9);
  if (!off.length) return { right: o.right, top: o.top, need: 0, capped: false };
  const limX = back * Math.tan(R.reach * D2R), limY = (back * Math.tan(R.rise * D2R)) / st;
  let best = Infinity, bR = o.right, bT = o.top;
  for (const r of [o.right, ...off.map((c) => c[0])]) {
    let t = o.top;
    for (const c of off) if (c[0] > r + 1e-9 && c[1] > t) t = c[1];
    if (t > o.top + limY + 1e-9 && R.rise <= 0) continue; // sideways only: the corner never rises
    const cost = Math.max(Math.atan((r - o.right) / back), Math.atan(((t - o.top) * st) / back)) * R2D;
    if (cost < best - 1e-12) { best = cost; bR = r; bT = t; }
  }
  const right = Math.min(bR, o.right + limX), top = Math.min(bT, o.top + limY);
  return { right, top, need: best, capped: off.some((c) => c[0] > right + 1e-9 && c[1] > top + 1e-9) };
}

/** The pivot height over the feet that puts the pivot on a card's top as drawn: `top` × the stretch the shader gives the
 *  card from a lens `back` m behind the pivot at `elevDeg` over it and `shoulder` m to its side (the stretch depends on
 *  the lens' height, which depends on the pivot: solved in closed form). Past the stretch cap the card leans back
 *  instead (LEAN_FROM): its top is then lower and further from the lens, and the pivot is put where that top is seen
 *  from the lens (the same sight line), so the outline's top stays `reticle.below` under the crosshair line there too */
export function pivotHeight(top: number, back: number, shoulder: number, elevDeg: number): { h: number; st: number } {
  const e = elevDeg * D2R, rho = Math.hypot(back * Math.cos(e), shoulder), rf = Math.max(rho, 0.5), a = top / rf, c = back * Math.sin(e);
  let st = STRETCH_MAX;
  if (a < 0.999) {
    // lens height y over the feet: y - c = a * hypot(rho, y)
    const y = (c + a * Math.sqrt(Math.max(0, c * c + (1 - a * a) * rho * rho))) / (1 - a * a);
    st = clamp(Math.hypot(rho, y) / rf, 1, STRETCH_MAX);
  }
  let h = top * st;
  if (st >= STRETCH_MAX && e > 0) {
    // leaning: the card's top is top × 1.6 along an axis tipped `ex` away from the lens; seen along the arm, a point that
    // far forward stands as high as one tan(e) × that higher on the pivot's own vertical
    const te = Math.tan(Math.min(e, 80 * D2R));
    for (let i = 0; i < 4; i++) {
      const ex = Math.max(0, Math.atan2(h + c, rho) - LEAN_FROM);
      h = top * STRETCH_MAX * (Math.cos(ex) + Math.sin(ex) * te);
    }
  }
  return { h, st };
}

/** the stretch the corner's allowance is costed with (the arm at the neutral pitch stretches a card by about this): a
 *  constant, so the corner is one fixed figure per sprite and never follows the pitch */
export const CORNER_STRETCH = 1.13;

/** The ideal arm for an outline (CHASE_CONFIG.frame, .reticle, .shoulderMax): the back distance from the body's drawn
 *  height; the
 *  corner (reserveCorner); and the shoulder offset that puts the corner `side` degrees left of the crosshair, at most
 *  `shoulderMax` × the back distance (`sideCapped`: a body too long for it). One fixed figure per sprite: nothing in it
 *  depends on the pitch or on what the Pokémon is doing. The pivot height follows from it per pose (pivotHeight) */
export interface IdealArm { back: number; shoulder: number; right: number; top: number; need: number; capped: boolean; sideCapped: boolean }
export function idealArm(o: Outline, F: FrameLaw, R: Reticle, shoulderMax: number): IdealArm {
  const back = backFor(o.top + (o.drop ?? 0), F), c = reserveCorner(o, back, CORNER_STRETCH, R);
  const want = c.right + back * Math.cos(R.below * D2R) * Math.tan(R.side * D2R);
  return { back, shoulder: Math.min(want, shoulderMax * back), right: c.right, top: c.top, need: c.need, capped: c.capped, sideCapped: want > shoulderMax * back + 1e-9 };
}
