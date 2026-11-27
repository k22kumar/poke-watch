// Lamp emitters for the tile maps (docs/RENDER3D.md "Local light"): today's light pools (render/tileart.ts
// TERRAIN_STYLE `glow`: a colour and a radius in tiles per prop kind, painted into the ground by the tile stage) become
// emitters at each pool prop's centre, 0.8 m over its ground. Temporary like the adapter: on generated maps the
// emitters come from `Dressing` (WORLDGEN3D Q17.8, Q18.9), and this file goes at X1b. Runs in the page bundle (it reads
// the tile art tables), never in the three side file.
import type { ArenaMap } from '../../world/tiles';
import { TERRAIN_STYLE } from '../tileart';
import type { LampEmitter } from './bake';

const hexRgb = (h: string): [number, number, number] => [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255];

/** the pool radius today is in tiles (1 m); the emitter reaches a little past the painted pool (provisional) */
const REACH = 1.5;
/** provisional: the emitters' intensity, until the owner sets the lamp look */
const INTENSITY = 1.2;

export function tileLamps(m: ArenaMap, artKey: string, height: (x: number, z: number) => number): LampEmitter[] {
  const glow = TERRAIN_STYLE[artKey]?.glow;
  if (!glow) return [];
  const col = hexRgb(glow.col), hx = m.w / 2, hz = m.h / 2;
  const out: LampEmitter[] = [];
  for (const p of m.props) {
    const r = glow.props[p.kind];
    if (!r) continue;
    const x = p.x + p.w / 2 - hx, z = p.y + p.h / 2 - hz;
    out.push({ position: [x, height(x, z) + 0.8, z], colour: col, radius: r * REACH, intensity: INTENSITY });
  }
  return out;
}
