// Map factory (procedural world W0 seam): which map a region uses. Authored mode returns the handcrafted arena for the
// biome (cached, seed-independent, unchanged). Generated mode builds a stage biome that names a Pokémon location or a
// habitat recipe (rules.worldgen.locations) from its seed; other biomes stay authored (the classic generator was
// deleted at C1). Generated maps are cached by (source, seed, version) in a small LRU.
import { getArena } from './arenas';
import { LOC_VERSION, generateLocation } from './locgen';
import { LOCATIONS, findLocation } from './locations';
import { HAB_VERSION, HABITATS, findHabitat, generateHabitat } from './habitat';
import type { ArenaMap } from './tiles';

interface WorldgenRules { mode: 'authored' | 'generated'; size: number; locations?: Record<string, string>; arena?: string }

/** the Pokémon location or habitat recipe (`id` or `id:variant`, src/world/habitat) a stage biome is built from in
 *  generated mode, or '' when it stays authored */
export const locationFor = (wg: WorldgenRules | undefined, biome: string) => {
  const id = wg?.mode === 'generated' ? wg.locations?.[biome] ?? '' : '';
  return id && (LOCATIONS[id] || HABITATS[id.split(':')[0]]) ? id : '';
};
/** is this map source a habitat recipe (rather than a Pokémon location)? */
const isHabitat = (id: string) => !!id && !!HABITATS[id.split(':')[0]];

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

const usesGenerator = (wg: WorldgenRules | undefined, biome: string) => !!locationFor(wg, biome);

export function regionKey(biome: string, seed: number, wg: WorldgenRules) {
  const loc = locationFor(wg, biome);
  if (loc && isHabitat(loc)) return `${loc}@${seed >>> 0}H${HAB_VERSION}x${wg.size}`;
  return `${loc}@${seed >>> 0}L${LOC_VERSION}x${wg.size}`;
}

export function regionMap(wg: WorldgenRules | undefined, biome: string, seed: number): ArenaMap {
  // an authored arena named outright (the training range: rules.worldgen.arena 'range') wins over the stage's biome
  if (wg?.arena) return getArena(wg.arena);
  if (!usesGenerator(wg, biome)) return getArena(biome);
  const loc = locationFor(wg, biome);
  const key = regionKey(biome, seed, wg!);
  let m = cache.get(key);
  if (m) { cache.delete(key); cache.set(key, m); return m; }
  if (isHabitat(loc)) { const [recipe, variant] = loc.split(':'); m = generateHabitat({ recipe, variant, seed, size: wg!.size }); }
  else m = generateLocation({ location: loc, seed, size: wg!.size });
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
