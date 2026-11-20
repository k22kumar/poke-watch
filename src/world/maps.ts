// Map factory (procedural world W0 seam): which map a region uses. Authored mode returns the handcrafted arena for the
// biome (cached, seed-independent, unchanged). Generated mode builds the region from its seed with src/world/gen for
// the biomes listed in rules.worldgen.biomes; others stay authored. Generated maps are cached by (biome, seed, version)
// in a small LRU, so a prewarm (portal transition, attract screen) makes the stage start instant.
import { getArena } from './arenas';
import { GEN_VERSION, generateRegion } from './gen';
import { LOC_VERSION, generateLocation } from './locgen';
import { LOCATIONS, findLocation } from './locations';
import { HAB_VERSION, HABITATS, findHabitat, generateHabitat } from './habitat';
import type { ArenaMap } from './tiles';
import type { SpawnPoolDef } from '../rules/spawning';

export interface WorldgenRules { mode: 'authored' | 'generated'; biomes: string[]; size: number; version: number; locations?: Record<string, string>; arena?: string }

/** the Pokémon location or habitat recipe (`id` or `id:variant`, src/world/habitat) a stage biome is built from in
 *  generated mode, or '' for the classic generator */
export const locationFor = (wg: WorldgenRules | undefined, biome: string) => {
  const id = wg?.mode === 'generated' ? wg.locations?.[biome] ?? '' : '';
  return id && (LOCATIONS[id] || HABITATS[id.split(':')[0]]) ? id : '';
};
/** the spawn pool the map source of a stage biome layers over the region's (undefined: the region's own) */
export function mapSpawnPool(wg: WorldgenRules | undefined, biome: string): SpawnPoolDef | undefined {
  const id = locationFor(wg, biome);
  if (!id) return undefined;
  return LOCATIONS[id]?.spawns ?? HABITATS[id.split(':')[0]]?.spawns;
}

/** every spawn pool a map source declares, by source id (validation and habitat navigation profiles) */
export function allMapSpawnPools(): Record<string, SpawnPoolDef> {
  const out: Record<string, SpawnPoolDef> = {};
  for (const [id, L] of Object.entries(LOCATIONS)) if (L.spawns) out[id] = L.spawns;
  for (const [id, H] of Object.entries(HABITATS)) if (H.spawns) out[id] = H.spawns;
  return out;
}

/** is this map source a habitat recipe (rather than a Pokémon location)? */
export const isHabitat = (id: string) => !!id && !!HABITATS[id.split(':')[0]];

/** a map source by loose name, as `?loc=` and the saved Settings → World → Map choice give it: a Pokémon location id,
 *  or a habitat recipe (`river-gorge`, `volcano`, with an optional surface variant as `river-gorge/snow` or
 *  `river-gorge:snow`) as `id` or `id:variant`. undefined when nothing matches. */
export function findMapSource(q: string): string | undefined {
  const L = findLocation(q);
  if (L) return L.id;
  const H = findHabitat(q.replace('/', ':'));
  return H ? H.id + (H.variant ? ':' + H.variant : '') : undefined;
}

const cache = new Map<string, ArenaMap>();
const CACHE_MAX = 6;

export const usesGenerator = (wg: WorldgenRules | undefined, biome: string) => !!wg && wg.mode === 'generated' && (wg.biomes.includes(biome) || !!locationFor(wg, biome));

export function regionKey(biome: string, seed: number, wg: WorldgenRules) {
  const loc = locationFor(wg, biome);
  if (loc && isHabitat(loc)) return `${loc}@${seed >>> 0}H${HAB_VERSION}x${wg.size}`;
  return loc ? `${loc}@${seed >>> 0}L${LOC_VERSION}x${wg.size}` : `${biome}@${seed >>> 0}v${wg.version}x${wg.size}`;
}

export function regionMap(wg: WorldgenRules | undefined, biome: string, seed: number, species: string[] = []): ArenaMap {
  // an authored arena named outright (the training range: rules.worldgen.arena 'range') wins over the stage's biome
  if (wg?.arena) return getArena(wg.arena);
  if (!usesGenerator(wg, biome)) return getArena(biome);
  const loc = locationFor(wg, biome);
  if (!loc && wg!.version !== GEN_VERSION) throw new Error(`worldgen version ${wg!.version} requested; this build generates version ${GEN_VERSION}`);
  const key = regionKey(biome, seed, wg!);
  let m = cache.get(key);
  if (m) { cache.delete(key); cache.set(key, m); return m; }
  if (loc && isHabitat(loc)) { const [recipe, variant] = loc.split(':'); m = generateHabitat({ recipe, variant, seed, size: wg!.size }); }
  else m = loc ? generateLocation({ location: loc, seed, size: wg!.size }) : generateRegion({ biome, seed, size: wg!.size, version: wg!.version, species });
  cache.set(key, m);
  while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value as string);
  return m;
}

/** Map checksum for the co-op handshake (blueprint section 8): terrain, elevation, wall, platform and props. */
export function mapChecksum(m: ArenaMap): number {
  let h = 0x811c9dc5;
  const mix = (v: number) => { h = Math.imul(h ^ (v | 0), 0x01000193); };
  for (let k = 0; k < m.terrain.length; k++) { mix(m.terrain[k]); mix(Math.round(m.elev[k] * 4)); mix(m.wall[k]); mix(Math.round(m.platform[k] * 100)); mix(m.stairs[k]); }
  for (const p of m.props) { mix(p.x); mix(p.y); mix(p.kind.length); mix(p.kind.charCodeAt(0)); mix(p.kind.charCodeAt(p.kind.length - 1)); mix(p.variant); if (p.lean) mix(p.lean); }
  mix(m.spawn[0]); mix(m.spawn[1]); mix(m.bossSpot[0]); mix(m.bossSpot[1]);
  // layered and fluid-level maps: decks and water levels are part of the layout (absent on other maps: unchanged hash)
  if (m.over) for (let k = 0; k < m.over.length; k++) if (m.over[k] > 0) { mix(k); mix(Math.round(m.over[k] * 4)); }
  if (m.wlevel) for (let k = 0; k < m.wlevel.length; k++) if (m.terrain[k] === 3) mix(Math.round(m.wlevel[k] * 4));
  return h >>> 0;
}
