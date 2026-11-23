// The visible extent of a sprite's neutral reference pose (the front-facing idle frame): what rules/sizing.ts scales
// against. Pure (no DOM), so the browser loader (assets/pack.ts) and the Node camera diagnostics measure the same pixels
// the same way.
import { ANIM_STATES, BODY_CLIPS, COMBAT_CLIPS, OVERLAY, type AnimState, type Clip, type FrameBounds, type FrameRect, type Silhouette } from './art';

/** `rgba`: the frame's own pixels (f.w x f.h, RGBA8, rows top-down). Height runs from the first opaque row down to the
 *  frame's anchor (its feet), at least 8 texels; width counts the opaque columns. */
export function neutralExtent(rgba: ArrayLike<number>, f: FrameRect): { heightPx: number; widthPx: number } {
  let top = f.ay;
  for (let y = 0; y < f.h && top === f.ay; y++) for (let x = 0; x < f.w; x++) if (rgba[(y * f.w + x) * 4 + 3] > 0) { top = y; break; }
  const heightPx = Math.max(8, f.ay - top);
  let x0 = f.w, x1 = -1;
  for (let y = 0; y < f.h; y++) for (let x = 0; x < f.w; x++) if (rgba[(y * f.w + x) * 4 + 3] > 0) { if (x < x0) x0 = x; if (x > x1) x1 = x; }
  const widthPx = x1 >= x0 ? x1 - x0 + 1 : heightPx;
  return { heightPx, widthPx };
}

/** the alpha at which the creature shader keeps a texel (render/renderer.ts CREATURE_FS: `c.a < 0.5` is discarded) */
const OPAQUE = 128;

/** The opaque extent of a frame around its anchor (texels). `alpha(x, y)`: the atlas's alpha (0-255) at an atlas texel.
 *  Null for a frame with no opaque texel */
function frameBounds(alpha: (x: number, y: number) => number, f: FrameRect): FrameBounds | null {
  let x0 = f.w, x1 = -1, y0 = f.h, y1 = -1;
  for (let y = 0; y < f.h; y++) for (let x = 0; x < f.w; x++) if (alpha(f.x + x, f.y + y) >= OPAQUE) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  return x1 < 0 ? null : { l: f.ax - x0, r: x1 + 1 - f.ax, t: f.ay - y0, b: y1 + 1 - f.ay };
}

/** how far a clip's procedural overlay can move its frames (m): sideways (either way) and up */
export function overlayReach(c: Clip): { x: number; y: number } {
  return c.overlay === 'lunge' ? { x: OVERLAY.lunge, y: OVERLAY.lunge * OVERLAY.lungeLift } : c.overlay === 'bob' ? { x: 0, y: OVERLAY.bob } : { x: 0, y: 0 };
}

/** The outline of a sprite set: every frame's opaque bounds, the ordinary body (idle + walk, all rows) and the outermost
 *  corners of the combat frames (see Silhouette). Pure: the browser loader and the Node diagnostics measure the same
 *  texels the same way */
export function silhouetteOf(clips: Record<AnimState, Clip>, alpha: (x: number, y: number) => number): Silhouette {
  const seen = new Map<string, FrameBounds | null>();
  const of = (f: FrameRect) => {
    const k = `${f.x},${f.y},${f.w},${f.h},${f.ax},${f.ay}`;
    let b = seen.get(k);
    if (b === undefined) seen.set(k, (b = frameBounds(alpha, f)));
    return b;
  };
  const frames = {} as Silhouette['frames'];
  for (const st of ANIM_STATES) frames[st] = clips[st].frames.map((row) => row.map(of));
  const body: FrameBounds = { l: 0, r: 0, t: 0, b: 0 }, bodyOver = { x: 0, y: 0 };
  for (const st of BODY_CLIPS) {
    const o = overlayReach(clips[st]);
    bodyOver.x = Math.max(bodyOver.x, o.x); bodyOver.y = Math.max(bodyOver.y, o.y);
    for (const row of frames[st]) for (const b of row) if (b) { body.l = Math.max(body.l, b.l); body.r = Math.max(body.r, b.r); body.t = Math.max(body.t, b.t); body.b = Math.max(body.b, b.b); }
  }
  // the combat corners no other corner of the same clip offset dominates (further right and at least as high)
  const combat: Silhouette['combat'] = [];
  for (const st of COMBAT_CLIPS) {
    const o = overlayReach(clips[st]);
    for (const row of frames[st]) for (const b of row) {
      if (!b) continue;
      if (combat.some((c) => c.ox === o.x && c.oy === o.y && c.r >= b.r && c.t >= b.t)) continue;
      for (let i = combat.length - 1; i >= 0; i--) { const c = combat[i]; if (c.ox === o.x && c.oy === o.y && b.r >= c.r && b.t >= c.t) combat.splice(i, 1); }
      combat.push({ r: b.r, t: b.t, ox: o.x, oy: o.y });
    }
  }
  return { frames, body, bodyOver, combat };
}
