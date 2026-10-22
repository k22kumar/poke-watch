// Expedition art direction (docs/ART_DIRECTION.md): the shared rules every biome follows, as data.
//
// Four layers, from quiet to loud:
//   1. Floor  - the walkable ground: mid value, muted saturation, large soft mottling so it never reads as one flat
//               colour, and a cool shade along forest edges so the play space is "lit" and the walls are not.
//   2. Frame  - forest walls, cliffs, the decorative ring: darker and cooler the deeper they sit (PMD-style dungeon
//               walls), so they frame the clearing instead of competing with it.
//   3. Actors - Pokémon: lit by their own key light (never dimmed by a biome's night tint), outlined, the most
//               saturated things in the frame after combat signals.
//   4. Signals - telegraphs, rings, the player marker, projectiles: reserved hues (hostile red/orange, own white/cyan),
//               drawn on top, and kept scarce (no coat rings on fodder, organic surface overlays).
// Every value here is presentation only: the simulation never reads this file.
import { hex, type RGB } from '../overworld/paint';
import type { GroundPalette } from '../overworld/terrain';
import { T, type ArenaMap } from '../world/tiles';

export interface ArtDirection {
  /** muted ground palette (merged over the biome's own) */
  ground: Partial<GroundPalette>;
  /** large-scale grass mottling */
  macro: { dark: RGB; light: RGB; scale: number; amount: number; seed: number };
  /** colour the ground shades toward along forest edges, and how strong the edge shade is (0..1) */
  shadeCol: RGB; edgeShade: number;
  /** frame: forest props darken by up to `frameDark` (deepest) and shift toward `frameCool` */
  frameDark: number; frameCool: [number, number, number];
  /** light on the world (meshes, props) and on actors (creatures, effects) */
  world: [number, number, number]; actor: [number, number, number];
  /** screen-edge darkening, dithered (0 = none) and its colour */
  vignette: number; vignetteCol: [number, number, number];
}

const g = (o: Record<string, string>) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, hex(v)])) as Partial<GroundPalette>;

export const ART_DIRECTION: Record<string, ArtDirection> = {
  // warm late-morning meadow: grass pulled from saturated lime toward sage, paths warm sand
  meadow: {
    ground: g({ grass: '#96ca6e', grassD: '#6c9f52', grassL: '#b6de94', grassEdge: '#5c9048', tallBase: '#4c9846', tallD: '#2f7a38', path: '#dcc596', pathD: '#c4aa7c', pathL: '#ecdab0', pathEdge: '#a68a60', dirt: '#c8ae80', dirtD: '#ae9468', sand: '#e6d8ae', sandD: '#d0bf8e', lipA: '#5c9c48', lipB: '#3e7e3c', flowerbed: '#5c9a46' }),
    macro: { dark: hex('#8abe66'), light: hex('#a2d07a'), scale: 7, amount: 0.13, seed: 41 },
    shadeCol: hex('#2c5a4c'), edgeShade: 0.8, frameDark: 0.34, frameCool: [0.84, 0.95, 1.08],
    world: [0.98, 0.98, 0.96], actor: [1.04, 1.03, 1.0], vignette: 0.16, vignetteCol: [0.06, 0.12, 0.1],
  },
  badlands: {
    ground: g({ grass: '#cfa26e', grassD: '#b88a5a', grassL: '#e2bc8e', grassEdge: '#a06e42', path: '#76625a', pathD: '#64524a', pathL: '#887468' }),
    macro: { dark: hex('#c49866'), light: hex('#dab07c'), scale: 8, amount: 0.12, seed: 42 },
    shadeCol: hex('#5a3428'), edgeShade: 0.9, frameDark: 0.3, frameCool: [0.95, 0.9, 0.95],
    world: [1.0, 0.96, 0.9], actor: [1.04, 1.0, 0.96], vignette: 0.18, vignetteCol: [0.16, 0.06, 0.04],
  },
  // snow pulled down from near-white so pale and blue Pokémon keep their highlights against it
  frost: {
    ground: g({ grass: '#dbe5ef', grassD: '#bccbdc', grassL: '#f2f6fa', grassEdge: '#9cb2ca', path: '#aebdce', pathD: '#97a8bc', pathL: '#c6d2e0', pathEdge: '#7890aa', sand: '#d2dce8', sandD: '#bac8d8' }),
    macro: { dark: hex('#cfdbe8'), light: hex('#e6edf5'), scale: 8, amount: 0.12, seed: 43 },
    shadeCol: hex('#4a5e80'), edgeShade: 1, frameDark: 0.3, frameCool: [0.86, 0.94, 1.1],
    world: [0.95, 0.97, 1.02], actor: [1.0, 1.0, 1.02], vignette: 0.14, vignetteCol: [0.1, 0.14, 0.24],
  },
  // night: the world stays in moonlight, the actors keep a warm key light so dark Pokémon read
  dusk: {
    ground: g({ grass: '#4a8052', grassD: '#3a6a46', grassL: '#62a066' }),
    macro: { dark: hex('#447a4e'), light: hex('#558a5a'), scale: 7, amount: 0.12, seed: 44 },
    shadeCol: hex('#14283a'), edgeShade: 1, frameDark: 0.36, frameCool: [0.82, 0.88, 1.12],
    world: [0.86, 0.9, 1.05], actor: [1.06, 1.02, 1.0], vignette: 0.24, vignetteCol: [0.03, 0.04, 0.1],
  },
};
export const artDirection = (biome: string) => ART_DIRECTION[biome] ?? ART_DIRECTION.meadow;

/** walkable for the eye: open ground a Pokémon can stand on (not a wall, not water) */
const open = (m: ArenaMap, k: number) => !m.wall[k] && m.terrain[k] !== T.water;

/** distance in tiles from every tile to the nearest open tile (0 on open ground): how deep into the forest it sits */
export function forestDepth(m: ArenaMap): Float32Array {
  const W = m.w, H = m.h, d = new Float32Array(W * H).fill(1e9);
  const q: number[] = [];
  for (let k = 0; k < W * H; k++) if (open(m, k) || m.terrain[k] === T.water) { d[k] = 0; q.push(k); }
  for (let h = 0; h < q.length; h++) {
    const k = q[h], x = k % W, y = (k / W) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const n = ny * W + nx;
      if (d[n] > d[k] + 1) { d[n] = d[k] + 1; q.push(n); }
    }
  }
  return d;
}

/** ground shade per tile: open tiles next to a thick forest wall sit in its shade (0..1) */
export function edgeShade(m: ArenaMap, strength: number): Float32Array {
  const W = m.w, H = m.h, out = new Float32Array(W * H);
  const isTree = new Uint8Array(W * H);
  for (const p of m.props) {
    if (!(p.kind === 'tree' || p.kind === 'tree2' || p.kind === 'round' || p.kind === 'icepine' || p.kind === 'deadtree' || p.kind === 'elder' || p.kind === 'blossom')) continue;
    for (let y = p.y; y < p.y + p.h; y++) for (let x = p.x; x < p.x + p.w; x++) isTree[y * W + x] = 1;
  }
  const R = 3;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let n = 0, t = 0;
    for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
      const a = x + dx, b = y + dy;
      const w = 1 / (1 + dx * dx + dy * dy);
      t += w;
      if (a < 0 || b < 0 || a >= W || b >= H) { n += w; continue; }
      if (isTree[b * W + a]) n += w;
    }
    // only dense tree masses cast the edge shade (a lone tree keeps its own blob shadow)
    out[y * W + x] = Math.max(0, Math.min(1, (n / t - 0.18) * 2.2)) * strength;
  }
  return out;
}
