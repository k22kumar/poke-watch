// Map factory (procedural world W0 seam): which map a region uses. Authored mode returns the handcrafted arena for the
// biome (cached, seed-independent, unchanged). Generated mode builds the region from its seed with src/world/gen for
// the biomes listed in rules.worldgen.biomes; others stay authored. Generated maps are cached by (biome, seed, version)
// in a small LRU, so a prewarm (portal transition, attract screen) makes the stage start instant.
import { getArena } from './arenas';
import { GEN_VERSION, generateRegion } from './gen';
import type { ArenaMap } from './tiles';

export interface WorldgenRules { mode: 'authored' | 'generated'; biomes: string[]; size: number; version: number }

const cache = new Map<string, ArenaMap>();
const CACHE_MAX = 6;

export const usesGenerator = (wg: WorldgenRules | undefined, biome: string) => !!wg && wg.mode === 'generated' && wg.biomes.includes(biome);

export function regionKey(biome: string, seed: number, wg: WorldgenRules) { return `${biome}@${seed >>> 0}v${wg.version}x${wg.size}`; }

export function regionMap(wg: WorldgenRules | undefined, biome: string, seed: number, species: string[] = []): ArenaMap {
  if (!usesGenerator(wg, biome)) return getArena(biome);
  if (wg!.version !== GEN_VERSION) throw new Error(`worldgen version ${wg!.version} requested; this build generates version ${GEN_VERSION}`);
  const key = regionKey(biome, seed, wg!);
  let m = cache.get(key);
  if (m) { cache.delete(key); cache.set(key, m); return m; }
  m = generateRegion({ biome, seed, size: wg!.size, version: wg!.version, species });
  cache.set(key, m);
  while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value as string);
  return m;
}

/** Map checksum for the co-op handshake (blueprint section 8): terrain, elevation, wall, platform and props. */
export function mapChecksum(m: ArenaMap): number {
  let h = 0x811c9dc5;
  const mix = (v: number) => { h = Math.imul(h ^ (v | 0), 0x01000193); };
  for (let k = 0; k < m.terrain.length; k++) { mix(m.terrain[k]); mix(Math.round(m.elev[k] * 4)); mix(m.wall[k]); mix(Math.round(m.platform[k] * 100)); mix(m.stairs[k]); }
  for (const p of m.props) { mix(p.x); mix(p.y); mix(p.kind.length); mix(p.kind.charCodeAt(0)); mix(p.kind.charCodeAt(p.kind.length - 1)); mix(p.variant); }
  mix(m.spawn[0]); mix(m.spawn[1]); mix(m.bossSpot[0]); mix(m.bossSpot[1]);
  return h >>> 0;
}
