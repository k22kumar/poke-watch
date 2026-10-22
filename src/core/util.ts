export const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const TAU = Math.PI * 2;

export function angleDiff(a: number, b: number) {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
}

export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends (infer U)[]
    ? U[]
    : T[K] extends object
      ? DeepPartial<T[K]>
      : T[K];
};

export function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Deep merge: objects merge, arrays and scalars replace. Returns a new object. */
export function deepMerge<T>(base: T, ...overrides: (DeepPartial<T> | undefined)[]): T {
  let out: any = structuredClone(base);
  for (const o of overrides) {
    if (!o) continue;
    out = mergeInto(out, o);
  }
  return out;
}

function mergeInto(target: any, src: any): any {
  for (const k of Object.keys(src)) {
    const sv = src[k];
    if (isPlainObject(sv) && isPlainObject(target[k])) target[k] = mergeInto(target[k], sv);
    else target[k] = structuredClone(sv);
  }
  return target;
}

export function deepFreeze<T>(o: T): T {
  if (o && typeof o === 'object') {
    Object.freeze(o);
    for (const v of Object.values(o as any)) deepFreeze(v);
  }
  return o;
}

/** Stable 32-bit hash of numbers, for determinism checks. */
export class Hasher {
  h = 0x811c9dc5;
  private f = new Float32Array(1);
  private u = new Uint32Array(this.f.buffer);
  num(n: number) {
    this.f[0] = n;
    this.h ^= this.u[0];
    this.h = Math.imul(this.h, 0x01000193) >>> 0;
    return this;
  }
}
