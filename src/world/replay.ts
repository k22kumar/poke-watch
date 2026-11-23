// Replaying a map (docs/HABITATS.md "Replay"): what a habitat map says about how it was loaded, the link that loads it
// again, how `?mapseed=` is read, and what the player is told when no map could be made. Pure functions, no DOM: the
// plaque (ui.ts), the console and `pokewatch.hab()` (main.ts), the audit (scripts/habaudit.ts) and the tests share them.
import { HAB_VERSION, HabitatError, HABITATS } from './habitat';
import type { HabMeta } from './habitat/types';
import { findMapSource } from './maps';

/** direct: the requested seed was accepted; retry: it was rejected and a re-rolled seed of its own was accepted;
 *  fallback: every attempt failed and the recipe's known valid seed was loaded */
type LoadKind = 'direct' | 'retry' | 'fallback';

interface LoadInfo {
  /** `recipe` or `recipe/variant`, as `?loc=` takes it */
  source: string;
  kind: LoadKind;
  /** the seed asked for (`?mapseed=`) and the seed whose layout is actually loaded */
  requested: number; loaded: number;
  attempts: number; version: number;
  /** reloads the same match setup: same layout (retries and fallback included) and the same region seed */
  replay: string;
  /** reloads only this layout, in one attempt: the loaded seed asked for directly */
  layout: string;
  /** the plaque beside the region name */
  label: string;
  /** the console line */
  note: string;
}

export function loadInfo(H: HabMeta): LoadInfo {
  const source = H.recipe + (H.variant ? '/' + H.variant : '');
  const kind: LoadKind = H.fallback ? 'fallback' : H.attempts > 1 ? 'retry' : 'direct';
  const requested = H.seed, loaded = H.attemptSeed;
  const q = (seed: number) => `?loc=${source}&mapseed=${seed}&hv=${H.version}`;
  const label = kind === 'direct' ? `map seed ${requested}` : kind === 'retry' ? `map seed ${requested} → ${loaded} (try ${H.attempts})` : `map seed ${requested} → ${loaded} (${requested} rejected)`;
  const why = kind === 'fallback' ? ` — seed ${requested} was rejected on every attempt (${H.fallback!.why}); loaded the known valid seed ${loaded}` : kind === 'retry' ? ` — seed ${requested} was re-rolled ${H.attempts - 1}×; the layout of seed ${loaded} is loaded` : '';
  return {
    source, kind, requested, loaded, attempts: H.attempts, version: H.version, replay: q(requested), layout: q(loaded), label,
    note: `[map] ${source} v${H.version} seed ${requested}${why}: replay with ${q(requested)}${kind === 'direct' ? '' : ` (this layout alone: ${q(loaded)})`}`,
  };
}

/** `?mapseed=` or the saved Map seed → a region seed. Whole decimal numbers only (so `?mapseed=` and `?mapseed=abc` do not
 *  become seed 0 or NaN); beyond 32 bits it wraps, as the generator reads it, and says so. -1 = derive it from the run seed. */
export function parseMapSeed(raw: string | null | undefined, warn: (m: string) => void = () => {}): number {
  if (raw === null || raw === undefined) return -1;
  const t = raw.trim();
  if (!/^\d{1,16}$/.test(t)) { warn(`mapseed "${raw}" is not a whole number ≥ 0; the map seed comes from the run seed`); return -1; }
  const n = Number(t);
  if (n > 0xffffffff) warn(`mapseed ${t} is above 4294967295 and wraps to ${n >>> 0}`);
  return n >>> 0;
}

interface ReplayQuery { world: 'authored' | 'locations'; loc: string | null; mapseed: string | null; hv?: string | null; biomes: string[] }

/** the worldgen rules a launch asks for: the World setting, `?loc=` (a map for every stage biome, or `biome:map,…`),
 *  `?mapseed=` and, when a replay link names one, the generator version it was made with */
export function worldgenFromQuery(q: ReplayQuery, warn: (m: string) => void = console.warn) {
  const regionSeed = parseMapSeed(q.mapseed, warn);
  if (q.hv && Number(q.hv) !== HAB_VERSION) warn(`this replay link was made with habitat generator v${q.hv}; this build is v${HAB_VERSION}, so the layout can differ`);
  if (q.world === 'authored') return { mode: 'authored' as const };
  if (!q.loc) return { mode: 'generated' as const, regionSeed };
  const locations: Record<string, string> = {};
  for (const part of q.loc.split(',')) {
    const [a, b] = part.includes(':') ? part.split(':') : ['*', part];
    const id = findMapSource(b);
    if (!id) { warn(`unknown map "${b}"`); continue; }
    for (const biome of a === '*' ? q.biomes : [a]) locations[biome] = id;
  }
  return { mode: 'generated' as const, regionSeed, locations };
}

/** what the player reads when a habitat map could not be made: nothing has started, and why (the full attempt list goes to the console) */
export function mapErrorMessage(e: unknown): string {
  if (e instanceof HabitatError) {
    const by: Record<string, number> = {};
    for (const r of e.rejections) for (const f of r.failed) by[f.split(':')[0]] = (by[f.split(':')[0]] ?? 0) + 1;
    const gates = Object.entries(by).map(([k, v]) => `${k}${v > 1 ? ' ×' + v : ''}`).join(', ');
    return `${HABITATS[e.recipe]?.name ?? 'The map'} could not be generated for seed ${e.seed}: all ${e.rejections.length} candidates, the re-rolls and the known valid seeds, failed the playability checks (${gates}). No match was started. Pick another seed or map in Settings → World.`;
  }
  return `${(e as Error)?.message ?? e}. Pick another seed or map in Settings → World.`;
}
