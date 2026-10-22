// Deterministic maths for the simulation.
//
// ECMAScript leaves Math.sin, cos, atan2, hypot, exp, log and pow "implementation-approximated", so two
// browser engines (or two versions of one) may round them differently, and a lockstep or rollback
// session would drift apart. Everything here is built only from +, -, *, /, Math.sqrt (correctly
// rounded under IEEE 754), Math.floor and Math.abs, which every engine computes identically.
// The kernels are the FreeBSD msun / Sun fdlibm ones (Copyright 1993 Sun Microsystems, Inc.;
// "Permission to use, copy, modify, and distribute this software is freely granted, provided that
// this notice is preserved."). Accuracy is about 1 ulp over the ranges the sim uses.
//
// Rule: sim/, world/, core/ and rules/ call these instead of the Math versions.

const buf = new DataView(new ArrayBuffer(8));

/** y * 2^k for integer k, built from the exponent bits (exact) */
function ldexp(y: number, k: number): number {
  while (k > 1023) { y *= 8.98846567431158e307; k -= 1023; } // 2^1023
  while (k < -1022) { y *= 2.2250738585072014e-308; k += 1022; } // 2^-1022
  buf.setUint32(0, (k + 1023) << 20);
  buf.setUint32(4, 0);
  return y * buf.getFloat64(0);
}

// ---------------------------------------------------------------- sin / cos
const S1 = -1.66666666666666324348e-01, S2 = 8.33333333332248946124e-03, S3 = -1.98412698298579493134e-04;
const S4 = 2.75573137070700676789e-06, S5 = -2.50507602534068634195e-08, S6 = 1.58969099521155010221e-10;
const C1 = 4.16666666666666019037e-02, C2 = -1.38888888888741095749e-03, C3 = 2.48015872894767294178e-05;
const C4 = -2.75573143513906633035e-07, C5 = 2.08757232129817482790e-09, C6 = -1.13596475577881948265e-11;
const INVPIO2 = 6.36619772367581382433e-01;
const PIO2_1 = 1.57079632673412561417e+00, PIO2_1T = 6.07710050650619224932e-11;
const PIO2_2 = 6.07710050630396597660e-11, PIO2_2T = 2.02226624879595063154e-21;
const PIO2_3 = 2.02226624871116645580e-21, PIO2_3T = 8.47842766036889956997e-32;

function kSin(x: number, y: number): number {
  const z = x * x, v = z * x;
  const r = S2 + z * (S3 + z * (S4 + z * (S5 + z * S6)));
  return x - ((z * (0.5 * y - v * r) - y) - v * S1);
}
function kCos(x: number, y: number): number {
  const z = x * x;
  const r = z * (C1 + z * (C2 + z * (C3 + z * (C4 + z * (C5 + z * C6)))));
  const hz = 0.5 * z, w = 1 - hz;
  return w + (((1 - w) - hz) + (z * r - x * y));
}

let remY0 = 0, remY1 = 0;
/** Cody-Waite reduction: x = n*pi/2 + (remY0 + remY1); returns n. Exact enough for |x| < 2^20 * pi/2. */
function remPio2(x: number): number {
  const fn = Math.floor(x * INVPIO2 + 0.5);
  let r = x - fn * PIO2_1, w = fn * PIO2_1T;
  let y0 = r - w;
  // two more steps keep the error tiny when x is near a multiple of pi/2
  let t = r;
  w = fn * PIO2_2; r = t - w; w = fn * PIO2_2T - ((t - r) - w); y0 = r - w;
  t = r; w = fn * PIO2_3; r = t - w; w = fn * PIO2_3T - ((t - r) - w); y0 = r - w;
  remY0 = y0; remY1 = (r - y0) - w;
  return fn;
}

export function dsin(x: number): number {
  if (x !== x || x === Infinity || x === -Infinity) return NaN;
  if (Math.abs(x) < 0.7853981633974483) return Math.abs(x) < 7.450580596923828e-9 ? x : kSin(x, 0);
  const n = remPio2(x) & 3;
  switch (n) {
    case 0: return kSin(remY0, remY1);
    case 1: return kCos(remY0, remY1);
    case 2: return -kSin(remY0, remY1);
    default: return -kCos(remY0, remY1);
  }
}

export function dcos(x: number): number {
  if (x !== x || x === Infinity || x === -Infinity) return NaN;
  if (Math.abs(x) < 0.7853981633974483) return Math.abs(x) < 7.450580596923828e-9 ? 1 : kCos(x, 0);
  const n = remPio2(x) & 3;
  switch (n) {
    case 0: return kCos(remY0, remY1);
    case 1: return -kSin(remY0, remY1);
    case 2: return -kCos(remY0, remY1);
    default: return kSin(remY0, remY1);
  }
}

// ---------------------------------------------------------------- atan / atan2
const ATANHI = [4.63647609000806093515e-01, 7.85398163397448278999e-01, 9.82793723247329054082e-01, 1.57079632679489655800e+00];
const ATANLO = [2.26987774529616870924e-17, 3.06161699786838301793e-17, 1.39033110312309984516e-17, 6.12323399573676603587e-17];
const AT = [
  3.33333333333329318027e-01, -1.99999999998764832476e-01, 1.42857142725034663711e-01, -1.11111104054623557880e-01,
  9.09088713343650656196e-02, -7.69187620504482999495e-02, 6.66107313738753120669e-02, -5.83357013379057348645e-02,
  4.97687799461593236017e-02, -3.65315727442169155270e-02, 1.62858201153657823623e-02,
];
const PI = 3.14159265358979311600e+00, PI_LO = 1.2246467991473531772e-16;

export function datan(x: number): number {
  if (x !== x) return NaN;
  const neg = x < 0;
  let ax = Math.abs(x);
  if (ax >= 7.378697629483821e19) return neg ? -ATANHI[3] - ATANLO[3] : ATANHI[3] + ATANLO[3];
  let id = -1;
  if (ax < 0.4375) {
    if (ax < 3.725290298461914e-9) return x;
  } else if (ax < 1.1875) {
    if (ax < 0.6875) { id = 0; ax = (2 * ax - 1) / (2 + ax); } else { id = 1; ax = (ax - 1) / (ax + 1); }
  } else if (ax < 2.4375) { id = 2; ax = (ax - 1.5) / (1 + 1.5 * ax); } else { id = 3; ax = -1 / ax; }
  const z = ax * ax, w = z * z;
  const s1 = z * (AT[0] + w * (AT[2] + w * (AT[4] + w * (AT[6] + w * (AT[8] + w * AT[10])))));
  const s2 = w * (AT[1] + w * (AT[3] + w * (AT[5] + w * (AT[7] + w * AT[9]))));
  if (id < 0) return neg ? -(ax - ax * (s1 + s2)) : ax - ax * (s1 + s2);
  const r = ATANHI[id] - ((ax * (s1 + s2) - ATANLO[id]) - ax);
  return neg ? -r : r;
}

export function datan2(y: number, x: number): number {
  if (x !== x || y !== y) return NaN;
  if (x === 0) return y > 0 ? PI / 2 : y < 0 ? -PI / 2 : (1 / x < 0 ? (1 / y < 0 ? -PI : PI) : y);
  if (y === 0) return x > 0 ? y : 1 / y < 0 ? -PI : PI;
  const a = datan(Math.abs(y / x));
  if (x > 0) return y > 0 ? a : -a;
  const r = PI - (a - PI_LO);
  return y > 0 ? r : -r;
}

// ---------------------------------------------------------------- hypot
export function dhypot(a: number, b: number, c = 0): number {
  return Math.sqrt(a * a + b * b + c * c);
}

// ---------------------------------------------------------------- exp / log / pow
const LN2_HI = 6.93147180369123816490e-01, LN2_LO = 1.90821492927058770002e-10, INVLN2 = 1.44269504088896338700e+00;
const P1 = 1.66666666666666019037e-01, P2 = -2.77777777770155933842e-03, P3 = 6.61375632143793436117e-05;
const P4 = -1.65339022054652515390e-06, P5 = 4.13813679705723846039e-08;

export function dexp(x: number): number {
  if (x !== x) return NaN;
  if (x > 709.782712893384) return Infinity;
  if (x < -745.1332191019411) return 0;
  if (Math.abs(x) < 3.725290298461914e-9) return 1 + x;
  const k = Math.floor(x * INVLN2 + 0.5);
  const hi = x - k * LN2_HI, lo = k * LN2_LO;
  const r = hi - lo;
  const t = r * r;
  const c = r - t * (P1 + t * (P2 + t * (P3 + t * (P4 + t * P5))));
  const y = 1 - ((lo - (r * c) / (2 - c)) - hi);
  return k === 0 ? y : ldexp(y, k);
}

const LG1 = 6.666666666666735130e-01, LG2 = 3.999999999940941908e-01, LG3 = 2.857142874366239149e-01;
const LG4 = 2.222219843214978396e-01, LG5 = 1.818357216161805012e-01, LG6 = 1.531383769920937332e-01, LG7 = 1.479819860511658591e-01;

export function dlog(x: number): number {
  if (x !== x || x < 0) return NaN;
  if (x === 0) return -Infinity;
  if (x === Infinity) return Infinity;
  let k = 0;
  if (x < 2.2250738585072014e-308) { x *= 18014398509481984; k -= 54; } // subnormal: scale by 2^54
  buf.setFloat64(0, x);
  let hx = buf.getUint32(0);
  k += (hx >>> 20) - 1023;
  hx &= 0x000fffff;
  // normalise the mantissa into [sqrt(2)/2, sqrt(2))
  const i = (hx + 0x95f64) & 0x100000;
  buf.setUint32(0, hx | (i ^ 0x3ff00000));
  k += i >>> 20;
  const f = buf.getFloat64(0) - 1;
  const hfsq = 0.5 * f * f;
  const s = f / (2 + f), z = s * s, w = z * z;
  const t1 = w * (LG2 + w * (LG4 + w * LG6));
  const t2 = z * (LG1 + w * (LG3 + w * (LG5 + w * LG7)));
  const R = t2 + t1;
  return k * LN2_HI - ((hfsq - (s * (hfsq + R) + k * LN2_LO)) - f);
}

/** a^b: exact repeated multiplication for small integer exponents, exp(b*log(a)) otherwise (a > 0) */
export function dpow(a: number, b: number): number {
  if (b === 0) return 1;
  if (Number.isInteger(b) && Math.abs(b) <= 64) {
    let r = 1, base = a, n = Math.abs(b);
    while (n > 0) { if (n & 1) r *= base; base *= base; n >>= 1; }
    return b < 0 ? 1 / r : r;
  }
  if (a === 0) return b > 0 ? 0 : Infinity;
  if (a < 0) return NaN;
  return dexp(b * dlog(a));
}
