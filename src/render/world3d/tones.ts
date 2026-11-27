// Resolved top and side tones (WORLDGEN3D Q23.3: tops read apart from sides; docs/looksheet): the world material's
// lighting (src/render/three/worldmat.ts) evaluated on the CPU for one face, open sky, no lamps, before fog and
// grading. The same maths as the shader: the ramp on the key light, the ambient cube of the open set times the role's
// shadow tint, the paint terms. No three.
import type { MaterialRole } from '../../rules/materialroles';
import type { ResolvedStyle } from '../../rules/styles/resolve';
import { srgbToLinear, type LightUniforms } from './lighting';

type V3 = [number, number, number];
const smoothstep = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/** worldmat.ts ramp() */
export function rampOf(ndl: number, bands: number, soft: number): number {
  if (bands <= 0) return ndl;
  const x = ndl * bands, s = Math.max(0.001, soft);
  return Math.min(1, Math.max(0, (Math.floor(x) + smoothstep(1 - s, 1, x - Math.floor(x))) / bands));
}

/** worldmat.ts cube(): the six colours weighted by the squared normal components */
function cube(n: V3, six: Float32Array): V3 {
  const out: V3 = [0, 0, 0];
  for (let a = 0; a < 3; a++) {
    const k = (n[a] > 0 ? a * 2 : a * 2 + 1) * 3, w = n[a] * n[a];
    for (let c = 0; c < 3; c++) out[c] += six[k + c] * w;
  }
  return out;
}

/** a face's lit colour (linear RGB) for a role; `facet` is the face's tone seed in −1..1, `depth` its m below the top */
export function faceTone(S: ResolvedStyle, L: LightUniforms, role: MaterialRole, n: V3, facet = 0, depth = 0): V3 {
  const m = S.roles[role], P = S.paint;
  // locked to orientation, the face's own normal sets the sign (worldmat.ts), whatever `facet` asks
  const top = n[1] > 0.5, fs = P.facetMode === 'oriented' ? (top ? 1 : -1) : facet;
  // locked to orientation, a side's random tone (facet jitter) takes `facet` as its worst case
  const jitter = P.facetMode === 'oriented' && !top ? facet * (P.facetJitter ?? 0) : 0;
  const k = (1 + fs * P.facetTone + jitter) * (1 - Math.min(1, depth / 4) * P.verticalGradient);
  const ndl = Math.max(0, n[0] * L.sunDir[0] + n[1] * L.sunDir[1] + n[2] * L.sunDir[2]);
  const r = rampOf(ndl, m.ramp.bands, m.ramp.soft), amb = cube(n, L.ambOpen);
  return [0, 1, 2].map((c) => srgbToLinear(m.base[c]) * k * (r * L.sun[c] + amb[c] * m.shadowTint[c])) as V3;
}

/** CIE L* of a linear RGB colour (render/metrics.ts lab()) */
export function lstar(c: V3): number {
  const Y = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  const t = Y > 216 / 24389 ? Math.cbrt(Y) : (841 / 108) * Y + 4 / 29;
  return 116 * t - 16;
}

/** the worst-case top/side gap of docs/looksheet mark 1: the darkest top (facet −1) against the brightest of the four
 *  vertical sides (facet +1), both at the local top, open sky */
export function topSideGap(S: ResolvedStyle, L: LightUniforms, role: MaterialRole): { top: number; side: number; gap: number; meanGap: number; shadowTop: number } {
  const SIDES = [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]] as V3[];
  // by plane the facet tone is a hash, so the worst case is the darkest top (−) against the brightest side (+); locked
  // to orientation faceTone sets the signs itself (tops +, sides −)
  const top = lstar(faceTone(S, L, role, [0, 1, 0], -1));
  const side = Math.max(...SIDES.map((n) => lstar(faceTone(S, L, role, n, 1))));
  // for information: the plain top against the mean of the four sides, facet 0, 1 m below the top
  const mean = SIDES.reduce((a, n) => a + lstar(faceTone(S, L, role, n, 0, 1)), 0) / 4;
  // the open top in full shadow (ambient only): the round-2 crushing line
  const shadowTop = lstar(faceTone(S, { ...L, sun: [0, 0, 0] }, role, [0, 1, 0]));
  return { top, side, gap: top - side, meanGap: lstar(faceTone(S, L, role, [0, 1, 0])) - mean, shadowTop };
}
