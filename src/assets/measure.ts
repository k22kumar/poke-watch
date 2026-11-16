// The visible extent of a sprite's neutral reference pose (the front-facing idle frame): what rules/sizing.ts scales
// against. Pure (no DOM), so the browser loader (assets/pack.ts) and the Node camera diagnostics measure the same pixels
// the same way.
import type { FrameRect } from './art';

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
