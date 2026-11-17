// Spawn pools: which wild Pokémon a region or map can field, kept apart from maps, species and the director.
//
// Four questions, four places (docs/SPAWNING.md):
//   eligibility    which species MAY appear here       the resolved table below (presets, map pools, overrides)
//   selection      which eligible species to spawn now  sim/director.ts: weight × habitat preference (profiles.ts)
//   location       where                                sim/enemies.ts ringPoint
//   compatibility  can it exist at that spot            canSpawnOn below: hard restrictions (profiles.ts `requires` /
//                                                       `avoids`); the director re-rolls the spot, then the species,
//                                                       and skips the spawn (a `spawnSkipped` event) rather than
//                                                       placing anything where it may not be
//
// A pool is built from layers, applied in this order, each editing the result of the one before:
//   1. the region's preset (rules.spawning.regions, one per region in REGION_BIOMES order)
//   2. the map's `spawns` (a Pokémon location or habitat recipe may set one; none does by default)
//   3. rules.spawning.override (a mode or a mod)
//   4. ?pool= in the URL (debug; src/main.ts turns it into an override)
// Inside one layer: `preset` (start over from that preset), `only` (replace the spawns), then `everyWild`, `include`,
// `weights`, `filter`, `exclude`,
// then `elites` / `boss` (replace). A layer that does not mention something leaves it as it was.
import { SPECIES, SPECIES_BY_ID, type Behaviour, type SpeciesDef } from './species';
import { bodyOf, type SizeClassId } from './sizing';
import { habitatAllows, traversalOf } from './profiles';
import type { StageDef } from './stages';
import { defaultRules } from './defaults';

export interface SpawnFilter {
  /** keep species with at least one of these official types ('water', 'ghost', …) */
  types?: string[];
  /** keep species with one of these behaviours */
  behaviours?: Behaviour[];
  /** keep species of these size classes */
  sizeClasses?: SizeClassId[];
  /** true: flyers only; false: ground only (a wild body's navigation class: traversalOf(sp).groundNav) */
  fly?: boolean;
}

export interface SpawnPoolDef {
  /** start over from this preset (its spawns, elites and boss) */
  preset?: string;
  /** replace the spawns with exactly these: 'id' (weight 1) or ['id', weight] */
  only?: (string | [string, number])[];
  /** add every wild species in the roster at weight 1 (so a new Pokémon is eligible without editing any pool) */
  everyWild?: boolean;
  /** add species, or set their weight: 'id' (weight 1) or ['id', weight] */
  include?: (string | [string, number])[];
  /** change the weight of species already in the pool */
  weights?: Record<string, number>;
  /** keep only species that pass every given test */
  filter?: SpawnFilter;
  /** remove species (from the spawns and the elites) */
  exclude?: string[];
  /** replace the elite list (spawned at elite / alpha scale) */
  elites?: string[];
  /** replace the boss */
  boss?: string;
}

/** Reusable pools. The four region presets are the original stage tables. Add a preset here and name it from a map's
 *  `spawns`, a mode's `rules.spawning.override`, or another preset. */
export const SPAWN_PRESETS: Record<string, SpawnPoolDef> = {
  // the four original region tables (before the 2026-11 roster wave); older rule layers select these
  'meadow-classic': {
    include: [['rattata', 5], ['ledyba', 3], ['sandshrew', 3], ['oddish', 1.4], ['poliwag', 1.6], ['mareep', 1.2], ['joltik', 1.4]],
    elites: ['heracross', 'sandshrew'],
    boss: 'sudowoodo',
  },
  'badlands-classic': {
    include: [['slugma', 4], ['geodude', 3], ['mareep', 3], ['vulpix', 1.6], ['sandshrew', 2], ['onix', 1.2]],
    elites: ['heracross', 'geodude'],
    boss: 'magcargo',
  },
  'frost-classic': {
    include: [['delibird', 2], ['swinub', 3], ['geodude', 2], ['ledyba', 3], ['rattata', 3]],
    elites: ['swinub', 'heracross'],
    boss: 'articuno',
  },
  'dusk-classic': {
    include: [['zubat', 4], ['gastly', 2], ['paras', 1.2], ['houndour', 3], ['poliwag', 2]],
    elites: ['houndour', 'heracross'],
    boss: 'houndoom',
  },
  // the regions as played: each classic table plus its share of the 2026-11 wave (docs/SPECIES.md)
  meadow: {
    preset: 'meadow-classic',
    include: [['sentret', 1.5], ['pikachu', 0.7], ['budew', 1.2], ['turtwig', 1], ['pichu', 0.5], ['togepi', 0.8], ['cutiefly', 0.8], ['furret', 0.9], ['doduo', 0.9], ['snorlax', 0.5]],
  },
  badlands: {
    preset: 'badlands-classic',
    include: [['ekans', 1.4], ['koffing', 1.2], ['rolycoly', 1.2], ['sizzlipede', 1.2], ['makuhita', 1], ['diglett', 0.8], ['silicobra', 0.8], ['hariyama', 0.5]],
  },
  frost: {
    preset: 'frost-classic',
    include: [['snorunt', 1.6], ['snom', 1.4], ['sneasel', 1.2], ['bergmite', 1.2], ['cetoddle', 1], ['lapras', 0.5]],
  },
  dusk: {
    preset: 'dusk-classic',
    include: [['murkrow', 1.4], ['litwick', 1.4], ['impidimp', 1.2], ['haunter', 1], ['honedge', 1], ['noibat', 0.8], ['dreepy', 0.8], ['gengar', 0.6]],
  },
  /** every wild Pokémon in the roster, equally likely (bosses and elites come from the layer below) */
  'all-wild': { everyWild: true },
};

/** The regions in stage order (biomes, src/rules/stages.ts BIOMES). Which preset each one fields is a rule:
 *  rules.spawning.regions (src/rules/defaults.ts), one preset id per region. */
export const REGION_BIOMES = ['meadow', 'badlands', 'frost', 'dusk'] as const;

/** rules.spawning.regions for the roster before the 2026-11 wave (replay checksums of older layers select it) */
export const CLASSIC_REGIONS = ['meadow-classic', 'badlands-classic', 'frost-classic', 'dusk-classic'];

/** a wild Pokémon: has a wild behaviour, is not a boss and is not one of the trainer's partners */
export const isWild = (sp: SpeciesDef) => !sp.boss && !sp.playable && sp.behaviour !== undefined;

interface Pool { spawns: [string, number][]; elites: string[]; boss: string }

function passes(sp: SpeciesDef, f: SpawnFilter): boolean {
  if (f.types && !(sp.types ?? []).some((t) => f.types!.includes(t))) return false;
  if (f.behaviours && !f.behaviours.includes(sp.behaviour ?? 'chase')) return false;
  if (f.sizeClasses && !f.sizeClasses.includes(bodyOf(sp).sizeClass)) return false;
  if (f.fly !== undefined && !traversalOf(sp).groundNav !== f.fly) return false;
  return true;
}

function applyLayer(pool: Pool, L: SpawnPoolDef, depth = 0): Pool {
  if (depth > 8) throw new Error('spawn presets refer to each other in a loop');
  let p: Pool = { spawns: pool.spawns.map(([id, w]) => [id, w]), elites: [...pool.elites], boss: pool.boss };
  if (L.preset !== undefined) {
    const base = SPAWN_PRESETS[L.preset];
    if (!base) throw new Error(`unknown spawn preset '${L.preset}'`);
    p = applyLayer({ spawns: [], elites: p.elites, boss: p.boss }, base, depth + 1);
  }
  const put = (id: string, w: number) => {
    const at = p.spawns.findIndex(([s]) => s === id);
    if (at >= 0) p.spawns[at][1] = w; else p.spawns.push([id, w]);
  };
  if (L.only) p.spawns = [];
  for (const e of L.only ?? []) typeof e === 'string' ? put(e, 1) : put(e[0], e[1]);
  if (L.everyWild) for (const sp of SPECIES) if (isWild(sp) && !p.spawns.some(([s]) => s === sp.id)) p.spawns.push([sp.id, 1]);
  for (const e of L.include ?? []) typeof e === 'string' ? put(e, 1) : put(e[0], e[1]);
  for (const [id, w] of Object.entries(L.weights ?? {})) { const at = p.spawns.findIndex(([s]) => s === id); if (at >= 0) p.spawns[at][1] = w; }
  if (L.filter) p.spawns = p.spawns.filter(([id]) => SPECIES_BY_ID[id] && passes(SPECIES_BY_ID[id], L.filter!));
  if (L.exclude) { const x = new Set(L.exclude); p.spawns = p.spawns.filter(([id]) => !x.has(id)); p.elites = p.elites.filter((id) => !x.has(id)); }
  if (L.elites) p.elites = [...L.elites];
  if (L.boss !== undefined) p.boss = L.boss;
  return p;
}

const regionOf = (stage: number) => ((stage % REGION_BIOMES.length) + REGION_BIOMES.length) % REGION_BIOMES.length;

/** The spawn table of region `stage` (wrapping): the region's preset from `regions` (rules.spawning.regions), with an
 *  optional map pool and override layered on top. */
export function resolveSpawnTable(stage: number, regions: readonly string[] = defaultRules.spawning.regions, ...layers: (SpawnPoolDef | undefined)[]): StageDef {
  const r = regionOf(stage);
  let p = applyLayer({ spawns: [], elites: [], boss: '' }, { preset: regions[r] });
  for (const L of layers) if (L) p = applyLayer(p, L);
  return { biome: REGION_BIOMES[r], spawns: p.spawns, elites: p.elites, boss: p.boss };
}

/** Compatibility: may this species spawn on a tile with these habitat tags? (Preference plays no part here.) */
export const canSpawnOn = (species: string, habitat: number) => habitatAllows(species, habitat);

/** Every species any configured pool can field (region presets, every preset, and the given map pools): what the
 *  habitat navigation profiles must make room for (src/world/habitat/mode.ts). */
export function spawnableSpecies(mapPools: SpawnPoolDef[] = []): { spawns: Set<string>; elites: Set<string> } {
  const spawns = new Set<string>(), elites = new Set<string>();
  const tables: StageDef[] = [];
  for (let s = 0; s < REGION_BIOMES.length; s++) {
    tables.push(resolveSpawnTable(s));
    for (const id of Object.keys(SPAWN_PRESETS)) tables.push(resolveSpawnTable(s, undefined, { preset: id }));
    for (const m of mapPools) tables.push(resolveSpawnTable(s, undefined, m));
  }
  for (const t of tables) { for (const [id] of t.spawns) spawns.add(id); for (const id of t.elites) elites.add(id); }
  return { spawns, elites };
}

/** Problems with the spawn configuration, as readable messages (tests/spawning.test.ts asserts none). */
export function validateSpawnConfig(mapPools: Record<string, SpawnPoolDef> = {}, regions: readonly string[] = defaultRules.spawning.regions): string[] {
  const out: string[] = [];
  const check = (where: string, L: SpawnPoolDef) => {
    if (L.preset !== undefined && !SPAWN_PRESETS[L.preset]) out.push(`${where}: unknown preset '${L.preset}'`);
    const ids = [...[...(L.include ?? []), ...(L.only ?? [])].map((e) => (typeof e === 'string' ? e : e[0])), ...Object.keys(L.weights ?? {}), ...(L.exclude ?? []), ...(L.elites ?? [])];
    for (const id of ids) if (!SPECIES_BY_ID[id]) out.push(`${where}: '${id}' is not a game species (content/roster.json)`);
    for (const e of [...(L.include ?? []), ...(L.only ?? [])]) if (typeof e !== 'string' && !(e[1] > 0)) out.push(`${where}: '${e[0]}' has weight ${e[1]} (must be > 0)`);
    for (const [id, w] of Object.entries(L.weights ?? {})) if (!(w > 0)) out.push(`${where}: '${id}' has weight ${w} (must be > 0)`);
    for (const id of L.elites ?? []) if (SPECIES_BY_ID[id]?.boss) out.push(`${where}: elite '${id}' is a boss`);
    if (L.boss !== undefined && !SPECIES_BY_ID[L.boss]?.boss) out.push(`${where}: boss '${L.boss}' has no boss kit (content/roster.json bosses)`);
  };
  for (const [id, L] of Object.entries(SPAWN_PRESETS)) check(`preset ${id}`, L);
  for (const [id, L] of Object.entries(mapPools)) check(`map ${id}`, L);
  if (regions.length !== REGION_BIOMES.length) out.push(`rules.spawning.regions: ${regions.length} presets for ${REGION_BIOMES.length} regions`);
  regions.forEach((id, i) => { if (!SPAWN_PRESETS[id]) out.push(`region ${REGION_BIOMES[i]}: unknown preset '${id}'`); });
  if (!out.length) {
    for (let s = 0; s < REGION_BIOMES.length; s++) {
      for (const [where, L] of [['', undefined], ...Object.entries(mapPools)] as [string, SpawnPoolDef | undefined][]) {
        let t: StageDef;
        try { t = resolveSpawnTable(s, regions, L); } catch (e) { out.push(`${where || 'region'} ${s}: ${(e as Error).message}`); continue; }
        const at = `${REGION_BIOMES[s]}${where ? ' with map ' + where : ''}`;
        if (!t.spawns.length) out.push(`${at}: no wild Pokémon left in the pool`);
        if (!t.boss) out.push(`${at}: no boss`);
        if (!t.elites.length) out.push(`${at}: no elites`);
      }
    }
  }
  return out;
}
