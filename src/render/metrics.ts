// Art-direction evaluation (docs/ART_DIRECTION.md): repeatable, in-engine measurements of readability. The same frame
// is rendered several times with a zero time step (nothing moves, no particles spawn, no shake) while layers are
// hidden, and the internal-resolution pixels are compared:
//   actors   - creature sprite pixels (frame with creatures minus frame without): their colour distance (CIE76 ΔE in
//              Lab) and lightness difference to the background they cover; "camouflaged" = ΔL* < 12 and ΔE < 20
//   player   - the same for the active Pokémon alone, plus its on-screen size in internal pixels
//   overlays - share of the screen changed by ground overlays (rings, zones, surface states, aim): visual clutter
//   colour   - mean saturation and lightness of the whole frame and of the background alone
// Evaluation only: it changes no sim state and nothing a player sees.
import type { Renderer } from './renderer';
import type { SimContext } from '../sim/types';

function lab(r: number, g: number, b: number): [number, number, number] {
  const f = (c: number) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  const R = f(r), G = f(g), B = f(b);
  const X = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047, Y = R * 0.2126 + G * 0.7152 + B * 0.0722, Z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883;
  const t = (v: number) => (v > 0.008856 ? Math.cbrt(v) : 7.787 * v + 16 / 116);
  return [116 * t(Y) - 16, 500 * (t(X) - t(Y)), 200 * (t(Y) - t(Z))];
}
function sat(r: number, g: number, b: number) { const mx = Math.max(r, g, b), mn = Math.min(r, g, b); return mx === 0 ? 0 : (mx - mn) / mx; }

export function artMetrics(R: Renderer, ctx: SimContext) {
  const gl = R.gl, W = R.canvas.width, H = R.canvas.height;
  const grab = () => { R.trauma = 0; R.render(ctx, 1, 0, 0); const px = new Uint8Array(W * H * 4); gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, px); return px; };
  const set = (a: boolean, p: boolean, o: boolean) => { R.debugHide.actors = a; R.debugHide.player = p; R.debugHide.overlays = o; };
  set(false, false, false); const full = grab();
  set(true, false, false); const noActors = grab();
  set(false, true, false); const noPlayer = grab();
  set(false, false, true); const noOver = grab();
  set(true, false, true); const bg = grab();
  set(false, false, false); R.render(ctx, 1, 0, 0);
  const diff = (a: Uint8Array, b: Uint8Array, i: number) => a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2];
  const contrast = (fig: Uint8Array, ground: Uint8Array) => {
    let n = 0, dE = 0, dL = 0, camo = 0;
    for (let i = 0; i < fig.length; i += 4) {
      if (!diff(fig, ground, i)) continue;
      const a = lab(fig[i], fig[i + 1], fig[i + 2]), b = lab(ground[i], ground[i + 1], ground[i + 2]);
      const e = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]), l = Math.abs(a[0] - b[0]);
      n++; dE += e; dL += l; if (l < 12 && e < 20) camo++;
    }
    return { px: n, meanDeltaE: n ? +(dE / n).toFixed(1) : 0, meanDeltaL: n ? +(dL / n).toFixed(1) : 0, camouflaged: n ? +(camo / n).toFixed(3) : 0 };
  };
  let over = 0;
  for (let i = 0; i < full.length; i += 4) if (diff(full, noOver, i)) over++;
  const stats = (p: Uint8Array) => { let s = 0, l = 0; for (let i = 0; i < p.length; i += 4) { s += sat(p[i], p[i + 1], p[i + 2]); l += lab(p[i], p[i + 1], p[i + 2])[0]; } const n = p.length / 4; return { meanSat: +(s / n).toFixed(3), meanL: +(l / n).toFixed(1) }; };
  return { size: [W, H], actors: contrast(noOver, bg), player: contrast(full, noPlayer), overlayCover: +(over / (W * H)).toFixed(4), frame: stats(full), background: stats(bg), actorsHidden: noActors.length > 0 };
}
