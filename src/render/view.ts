// Which world points the stage draws (render/tilestage.ts props and tree shadows, render/renderer.ts creatures).

/** what to draw: everything within `r` of (x, z); with a view direction (fx, fz) also nothing more than VIEW_BEHIND
 *  metres behind that point. The third-person view centres it on the lens: a disc that only depends on where the lens is,
 *  never on where it looks, so turning the camera can never make a prop on screen appear or vanish. */
export interface StageView { x: number; z: number; r: number; fx?: number; fz?: number }
/** a billboard whose base is this far behind the lens cannot reach into the view (the tallest props are ~4 m) */
export const VIEW_BEHIND = 6;

/** true when a point at (x, z) is drawn */
export function inStageView(v: StageView, x: number, z: number): boolean {
  const dx = x - v.x, dz = z - v.z;
  if (dx * dx + dz * dz > v.r * v.r) return false;
  return v.fx === undefined || dx * v.fx + dz * (v.fz ?? 0) >= -VIEW_BEHIND;
}

/** third-person draw radius around the lens (m), at most: the whole map and its decorative ring from anywhere in it
 *  (a 128 m region plus 15 m of ring is 223 m corner to corner) */
export const CHASE_VIEW_R = 230;
/** past the fog's far distance the fog closes completely over this fraction of it more (see FOG_GLSL) */
export const FOG_VEIL = 0.5;
/** the third-person draw radius for a biome's fog: nothing past it can be seen (it is exactly the fog colour, as is the
 *  sky at the horizon), so skipping it never makes anything on screen appear or vanish. Bounds what is drawn on a map
 *  of any size (the whole-map radius pushed every prop in front of the lens: ~7300 billboards on a 256 m region) */
export const chaseViewR = (fogFar: number) => Math.min(CHASE_VIEW_R, fogFar * (1 + FOG_VEIL) + VIEW_MARGIN);
/** a billboard reaches this far sideways of its base (the widest props are ~6 m) */
export const VIEW_MARGIN = 4;
/** how much fog covers a point `d` m from the lens (the same curve as FOG_GLSL, for tests) */
export function fogAt(d: number, near: number, far: number, amount: number): number {
  const f = Math.min(1, Math.max(0, (d - near) / (far - near))), veil = Math.min(1, Math.max(0, (d - far) / (FOG_VEIL * far)));
  return f * f * amount + (1 - amount) * veil;
}
