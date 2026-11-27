// The lighting the 3D scene applies, as flat uniform values (docs/RENDER3D.md "Time of day"). `lightAt` is the one
// path from a time-of-day value to the scene (D12): src/render/three applies its result through one `apply` call and
// reads no keyframe, binding or hour itself (tests/timeofday.test.ts pins both). No three.
//
// Colour spaces: surface-like colours (sky, fog) are '#rrggbb' sRGB data, decoded to linear here; light colours (the
// key light, the ambient sets) are linear multipliers already (timeofday.ts normalises them to luminance 1), so they
// pass through.
import { lightingAt, type Lighting, type MapTime } from '../../rules/styles/timeofday';

export interface LightUniforms {
  hour: number;
  sunDir: [number, number, number];
  /** colour × intensity */
  sun: [number, number, number];
  /** six RGB per set, +x −x +y −y +z −z */
  ambOpen: Float32Array;
  ambEnclosed: Float32Array;
  skyHor: [number, number, number]; skyZen: [number, number, number];
  fogColour: [number, number, number]; fogNear: number; fogFar: number; fogAmount: number;
  lift: [number, number, number]; gamma: [number, number, number]; gain: [number, number, number]; saturation: number;
  lamp: number;
}

export const srgbToLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const lin3 = (c: [number, number, number]): [number, number, number] => [srgbToLinear(c[0]), srgbToLinear(c[1]), srgbToLinear(c[2])];

export function lightUniforms(L: Lighting): LightUniforms {
  const flat = (s: Lighting['ambient']['open']) => { const a = new Float32Array(18); s.forEach((c, i) => a.set(c, i * 3)); return a; };
  return {
    hour: L.hour,
    sunDir: L.sunDir,
    sun: [L.sun.colour[0] * L.sun.intensity, L.sun.colour[1] * L.sun.intensity, L.sun.colour[2] * L.sun.intensity],
    ambOpen: flat(L.ambient.open), ambEnclosed: flat(L.ambient.enclosed),
    skyHor: lin3(L.sky.hor), skyZen: lin3(L.sky.zen),
    fogColour: lin3(L.fog.colour), fogNear: L.fog.near, fogFar: L.fog.far, fogAmount: L.fog.amount,
    lift: L.grade.lift, gamma: L.grade.gamma, gain: L.grade.gain, saturation: L.grade.saturation,
    lamp: L.lamp,
  };
}

/** the one path: a map's time at an hour → the values the scene applies */
export const lightAt = (t: MapTime, hour: number): LightUniforms => lightUniforms(lightingAt(t, hour));
