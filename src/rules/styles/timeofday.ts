// Time of day (docs/WORLDGEN3D.md Q23.2 as amended by D12; docs/RENDER3D.md "Time of day"). Every map ships one fixed
// time. All lighting — the sun, the two sets of six ambient colours, fog, the sky, grading and the lamp channel's
// strength — is read from one time-of-day value (an hour, 0 ≤ h < 24) through the map's keyframes: `lightingAt` is the
// one path, and src/render reads lighting from nowhere else (tests/timeofday.test.ts pins both). The running cycle,
// partial ranges and the preview controls are task TD's; it moves `hour` and nothing else.
//
// Pure data and maths (core/detmath, the rules layer's determinism rule), no three, no clock: the sim never reads it.
import { dcos, dhypot, dsin } from '../../core/detmath';
import { hexRgb, type BiomeBinding } from './bindings';

export type RGB = [number, number, number];
/** one colour per axis direction, in the order +x, −x, +y, −y, +z, −z (Q18.7, owner's clarification of 2026-11-24) */
export type Six = [RGB, RGB, RGB, RGB, RGB, RGB];
export const AXES = ['+x', '-x', '+y', '-y', '+z', '-z'] as const;

/** one keyframe of a map's light rig; colours are 0..1 sRGB, the renderer converts them */
export interface LightKey {
  hour: number;
  /** the key light (the sun by day, the moon by night: Q18.8's path either way) */
  sun: { colour: RGB; intensity: number };
  /** ambient fill: open sky and enclosed, blended per vertex by sky visibility (Q18.7) */
  ambient: { open: Six; enclosed: Six };
  sky: { hor: RGB; zen: RGB };
  fog: { colour: RGB; near: number; far: number; amount: number };
  /** applied in the output step (Q18.7); lift is added, gamma and gain per channel, saturation around luminance */
  grade: { lift: RGB; gamma: RGB; gain: RGB; saturation: number };
  /** the baked lamp channel's strength (Q18.9 as superseded by Q23) */
  lamp: number;
}

/** what the renderer applies: one resolved instant */
export interface Lighting extends Omit<LightKey, 'hour'> {
  hour: number;
  /** unit vector toward the key light */
  sunDir: [number, number, number];
}

/** a map's presentation of time: its keyframes and its one fixed hour (D12) */
export interface MapTime {
  keys: LightKey[];
  hour: number;
  /** the horizontal team axis the sun's path plane is perpendicular to (Q18.8); unit (x, z) */
  teamAxis: [number, number];
}

// ---- keyframes from a binding -------------------------------------------------------------------------------------

/** the fixed hour each light class ships with (D12; the owner, 2026-11-27, docs/RENDER3D.md "Look values"): day maps
 *  and caves at 11:00 (moved from 10:00 by the look sheet's sweep: the sun 75° up lets tops read apart from sides,
 *  Q23.3), the night biome at 22:00 (Duskwood Hollow is today's night look) */
export const FIXED_HOUR: Record<BiomeBinding['light'], number> = { day: 11, night: 22, cave: 11 };

/** at the fixed hour, an open-sky top facing up takes `sun` of its light from the key light and the rest from the
 *  ambient fill, so it shows the binding's base colour (× the world light). Provisional look values */
const KEY_SHARE: Record<BiomeBinding['light'], number> = { day: 0.65, night: 0.45, cave: 0.4 };
/** enclosed ambient as a share of open ambient (provisional) */
const ENCLOSED = 0.45;

const mixc = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const mulc = (a: RGB, k: number | RGB): RGB => (typeof k === 'number' ? [a[0] * k, a[1] * k, a[2] * k] : [a[0] * k[0], a[1] * k[1], a[2] * k[2]]);
const lum = (c: RGB) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
const norm = (c: RGB): RGB => mulc(c, 1 / Math.max(1e-4, lum(c)));
const six = (f: (i: number) => RGB): Six => [f(0), f(1), f(2), f(3), f(4), f(5)];
const NEUTRAL = { lift: [0, 0, 0] as RGB, gamma: [1, 1, 1] as RGB, gain: [1, 1, 1] as RGB, saturation: 1 };

/** the sun's elevation (sine) at an hour on Q18.8's path: up at 6:00, overhead at 12:00, down at 18:00 */
export const sunSine = (hour: number) => dsin(((hour - 6) / 12) * Math.PI);

/** The binding's keyframes. The anchor (the fixed hour) is transcribed from today's tables (bindings.ts); the other
 *  three are derived from it by one rule so the dev parameter can show other times. Provisional until TD tunes them:
 *  only the fixed hour ships (D12). */
/** `o.hour` and `o.share` anchor the keyframes at another fixed hour or key share (a map's `look`, the look sheet's
 *  sweep); the anchor is calibrated at that hour either way */
export function keysFor(b: BiomeBinding, o: { hour?: number; share?: number } = {}): LightKey[] {
  const hor = hexRgb(b.sky.hor), zen = hexRgb(b.sky.zen), ground = hexRgb(b.roles.ground);
  const fixed = o.hour ?? FIXED_HOUR[b.light], share = o.share ?? KEY_SHARE[b.light];
  // the key light's elevation at the fixed hour (the moon's at night: the antipode on the same path)
  const s = Math.max(0.2, Math.abs(sunSine(fixed)));
  // ambient colours from the sky, each normalised to luminance 1, then scaled so up + key = 1 on an open top
  const up = norm(mixc(zen, hor, 0.5)), side = norm(hor), down = norm(mulc(ground, 0.5));
  const amb = 1 - share;
  const open: Six = six((i) => mulc(i === 2 ? up : i === 3 ? down : side, amb * (i === 3 ? 0.5 : 1)));
  const anchor: LightKey = {
    hour: fixed,
    sun: { colour: norm(b.world), intensity: share / s },
    ambient: { open, enclosed: six((i) => mulc(open[i], ENCLOSED)) },
    sky: { hor, zen },
    fog: { colour: hor, near: b.sky.fogNear, far: b.sky.fogFar, amount: b.sky.fog },
    grade: NEUTRAL,
    lamp: b.light === 'day' ? 0.35 : 1,
  };
  const night = (k: LightKey, hour: number): LightKey => {
    const blue: RGB = [0.23, 0.29, 0.5];
    const dim = (c: RGB, t: number) => mixc(mulc(c, 0.35), mulc(blue, lum(c) * 0.35), t);
    return {
      hour, sun: { colour: norm(mixc(k.sun.colour, [0.79, 0.71, 1], 0.6)), intensity: k.sun.intensity * 0.3 },
      ambient: { open: six((i) => dim(k.ambient.open[i], 0.5)), enclosed: six((i) => dim(k.ambient.enclosed[i], 0.5)) },
      sky: { hor: dim(k.sky.hor, 0.4), zen: dim(k.sky.zen, 0.4) },
      fog: { ...k.fog, colour: dim(k.fog.colour, 0.4) },
      grade: { lift: [0, 0, 0.015], gamma: [1, 1, 1], gain: [1, 1, 1], saturation: 0.82 }, lamp: 1,
    };
  };
  const warm = (k: LightKey, hour: number): LightKey => ({
    ...k, hour, sun: { colour: norm(mixc(k.sun.colour, [1, 0.69, 0.44], 0.55)), intensity: k.sun.intensity * 0.9 },
    ambient: { open: six((i) => mulc(k.ambient.open[i], 0.8)), enclosed: six((i) => mulc(k.ambient.enclosed[i], 0.8)) },
    sky: { hor: mixc(k.sky.hor, [1, 0.72, 0.52], 0.35), zen: mulc(k.sky.zen, 0.85) },
    fog: { ...k.fog, colour: mixc(k.fog.colour, [1, 0.72, 0.52], 0.3) },
    grade: { ...NEUTRAL, saturation: 1.05 }, lamp: 0.6,
  });
  // a night-anchored map derives its day from the anchor brightened back (the inverse rule), so every class has all four
  if (b.light === 'night') {
    const day: LightKey = { ...anchor, hour: 12, sun: { colour: [1, 1, 1], intensity: anchor.sun.intensity * 2.5 }, ambient: { open: six((i) => mulc(anchor.ambient.open[i], 2)), enclosed: six((i) => mulc(anchor.ambient.enclosed[i], 2)) }, lamp: 0.35 };
    return sortKeys([anchor, warm(day, 6.5), day, warm(day, 17.5)]);
  }
  return sortKeys([night(anchor, (fixed + 12) % 24), warm(anchor, 6.5), anchor, warm(anchor, 17.5)]);
}

const sortKeys = (k: LightKey[]) => [...k].sort((a, b) => a.hour - b.hour);

// ---- the one path ---------------------------------------------------------------------------------------------------

const wrap24 = (h: number) => ((h % 24) + 24) % 24;

/** the unit direction toward the key light at an hour, on a path plane perpendicular to the team axis (Q18.8): the sun
 *  rises on one flank, passes overhead at noon and sets on the other; by night the moon takes the antipodal point */
export function keyLightDir(hour: number, teamAxis: [number, number]): [number, number, number] {
  let a = ((wrap24(hour) - 6) / 12) * Math.PI;
  if (dsin(a) < 0) a += Math.PI; // night: the moon
  // the flank direction: perpendicular to the team axis in the ground plane
  const fx = teamAxis[1], fz = -teamAxis[0];
  const c = dcos(a), s = dsin(a);
  // never exactly overhead: a 2° lean toward neither team keeps shadow edges defined (the same for both sides)
  const y = Math.max(s, 0.035);
  const l = dhypot(c, y);
  return [(fx * c) / l, y / l, (fz * c) / l];
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const lerp3 = (a: RGB, b: RGB, t: number): RGB => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
const lerp6 = (a: Six, b: Six, t: number): Six => six((i) => lerp3(a[i], b[i], t));

/** The lighting of a map at an hour: the keyframes on either side of it, blended linearly in time (wrapping at 24),
 *  and the key light's direction from the path. The only reader of a map's keyframes. */
export function lightingAt(t: MapTime, hour: number): Lighting {
  const h = wrap24(hour), K = t.keys;
  if (!K.length) throw new Error('lightingAt: a map needs at least one keyframe');
  let i1 = K.findIndex((k) => k.hour > h);
  if (i1 < 0) i1 = 0;
  const i0 = (i1 - 1 + K.length) % K.length;
  const a = K[i0], b = K[i1];
  const span = wrap24(b.hour - a.hour) || 24, u = K.length === 1 ? 0 : wrap24(h - a.hour) / span;
  // the key light fades out near the horizon (sun and moon swap there)
  const fade = Math.min(1, Math.abs(sunSine(h)) / 0.12);
  return {
    hour: h,
    sunDir: keyLightDir(h, t.teamAxis),
    sun: { colour: lerp3(a.sun.colour, b.sun.colour, u), intensity: lerp(a.sun.intensity, b.sun.intensity, u) * fade },
    ambient: { open: lerp6(a.ambient.open, b.ambient.open, u), enclosed: lerp6(a.ambient.enclosed, b.ambient.enclosed, u) },
    sky: { hor: lerp3(a.sky.hor, b.sky.hor, u), zen: lerp3(a.sky.zen, b.sky.zen, u) },
    fog: { colour: lerp3(a.fog.colour, b.fog.colour, u), near: lerp(a.fog.near, b.fog.near, u), far: lerp(a.fog.far, b.fog.far, u), amount: lerp(a.fog.amount, b.fog.amount, u) },
    grade: { lift: lerp3(a.grade.lift, b.grade.lift, u), gamma: lerp3(a.grade.gamma, b.grade.gamma, u), gain: lerp3(a.grade.gain, b.grade.gain, u), saturation: lerp(a.grade.saturation, b.grade.saturation, u) },
    lamp: lerp(a.lamp, b.lamp, u),
  };
}

/** a map's time: its binding's keyframes and fixed hour, and the team axis from its staging markers (A → B; the z axis
 *  when it has none, as on the range) */
export function mapTime(b: BiomeBinding, stagings: [number, number][] = [], o: { hour?: number; share?: number } = {}): MapTime {
  let axis: [number, number] = [0, 1];
  if (stagings.length >= 2) {
    const dx = stagings[1][0] - stagings[0][0], dz = stagings[1][1] - stagings[0][1], l = dhypot(dx, dz);
    if (l > 1e-6) axis = [dx / l, dz / l];
  }
  return { keys: keysFor(b, o), hour: o.hour ?? FIXED_HOUR[b.light], teamAxis: axis };
}

/** the dev URL parameter (D12): ?tod=<hour> (0 ≤ h < 24; '9:30' also reads), else the map's fixed hour */
export function hourFromParam(v: string | null | undefined, fixed: number): number {
  if (v == null || v === '') return fixed;
  const m = /^(\d{1,2})(?::(\d{2}))?$/.exec(v.trim());
  const n = m ? Number(m[1]) + (m[2] ? Number(m[2]) / 60 : 0) : Number(v);
  return Number.isFinite(n) ? wrap24(n) : fixed;
}
