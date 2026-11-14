// Pokémon-location generator: map = generateLocation(location, seed). A hierarchical, gameplay-first pipeline
// (docs/LOCATIONS.md):
//   Layer A  topology.ts  zones, a planar graph with loops, tiers, access rules, link kinds, entrances, hop shortcuts
//   Layer B  realize.ts   zone floors, corridors, ramps, bridges over chasms, hop steps, the enclosure's heights
//   Layer C  dress.ts     surfaces, forest planting, landmark stamps, cover, parapets, decor, anchors, chests
//   check    validate.ts  seal stray pockets, hard gates (strong connectivity, no perches, two ways onto high ground,
//                         a loop to the boss…), quality metrics
// Pure function of (location, seed, size): no Math.random, no clock in the output, every layer on its own Rng stream.
// A failed attempt re-rolls with mixSeed(seed, attempt) up to MAX_ATTEMPTS; the best attempt is kept.
import type { GenMeta } from '../gen/context';
import { mixSeed } from '../gen/util';
import { LOCATIONS, type LocationDef } from '../locations';
import type { ArenaMap } from '../tiles';
import { K, LocCtx } from './ctx';
import { dress } from './dress';
import { realize } from './realize';
import { decks } from './decks';
import { planTopology } from './topology';
import { sealPockets, validateLocation, type LocValidation } from './validate';
import { enemyCore } from './nav';

export const LOC_VERSION = 1;
export const MAX_ATTEMPTS = 10;

export interface LocOptions { location: string | LocationDef; seed: number; size?: number }

export function generateLocation(o: LocOptions): ArenaMap {
  const def = typeof o.location === 'string' ? LOCATIONS[o.location] : o.location;
  if (!def) throw new Error(`unknown location ${o.location}`);
  const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
  let best: { g: LocCtx; v: LocValidation } | null = null;
  let attempts = 0, repairs = 0;
  for (let a = 0; a < MAX_ATTEMPTS; a++) {
    attempts++;
    const r = attemptLocation(def, a === 0 ? o.seed >>> 0 : mixSeed(o.seed, a), o.size ?? 128);
    repairs += r.g.repairs;
    if (!best || r.v.failed.length < best.v.failed.length) best = r;
    if (r.v.ok) break;
  }
  const { g, v } = best!;
  const m = g.m;
  m.id = `${def.id}@${o.seed >>> 0}v${LOC_VERSION}`;
  const zones = g.zones.map((z) => ({ id: z.id, kind: z.kind, x: Math.round(z.x), y: Math.round(z.y), r: z.r, tier: z.tier, name: z.name }));
  const meta: GenMeta = {
    generator: 'poke-watch-locgen', version: LOC_VERSION, seed: o.seed >>> 0, attemptSeed: g.seed, attempts, repairs,
    archetype: `${def.id}:${g.landform}`, places: [], lookouts: [], spaces: [], sites: [],
    habitat: g.habitat, cliffOk: new Uint8Array(g.S * g.S), route: routeMask(g), gates: v.gates,
    ms: typeof performance !== 'undefined' ? performance.now() - t0 : 0,
    loc: {
      id: def.id, art: def.art, particles: def.particles, dropNav: def.gameplay.dropNav, los: true,
      anchors: g.anchors, bodySpots: g.bodySpots, zones,
      chasm: chasmTiles(g),
      links: g.links.map((L) => ({ a: L.a, b: L.b, kind: L.kind, tiles: L.tiles.length })),
      metrics: { ...v.metrics, deckTiles: g.deckTiles, shelves: g.notes.filter((x) => x.startsWith('shelf')).length, underpasses: g.notes.filter((x) => x.startsWith('underpass')).length, hollows: g.notes.filter((x) => x.startsWith('hollow')).length },
    },
  };
  m.gen = meta;
  return m;
}

/** chasm cells still open air on the finished map (a deck's ground or a gully turned underpass is not one) */
function chasmTiles(g: LocCtx): number[] {
  const out: number[] = [], m = g.m;
  for (let k = 0; k < g.kind.length; k++) if (g.kind[k] === K.chasm && m.wall[k] === 1) out.push(k);
  return out;
}

/** one attempt: the three layers, pocket sealing, validation */
export function attemptLocation(def: LocationDef, seed: number, size: number): { g: LocCtx; v: LocValidation } {
  const g = new LocCtx(def, size, seed);
  planTopology(g);
  realize(g);
  decks(g);
  const hub = g.zone('hub')!, boss = g.zone('boss')!;
  g.m.spawn = [Math.floor(hub.x), Math.floor(hub.y)];
  g.m.bossSpot = [Math.floor(boss.x), Math.floor(boss.y)];
  dress(g);
  const sealed = sealPockets(g);
  if (sealed) g.repairs++;
  // keep only what an enemy (and so the player) can reach: chests, anchors, loose stones
  const S = g.S, core = enemyCore(g.m, g.m.spawn[1] * S + g.m.spawn[0], def.gameplay.dropNav);
  const ok = ([x, y]: [number, number]) => g.in(x, y) && core[g.idx(x, y)] === 1;
  g.m.chestSpots = g.m.chestSpots.filter(ok);
  g.anchors = g.anchors.filter(ok);
  g.bodySpots = g.bodySpots.filter(ok);
  return { g, v: validateLocation(g, sealed) };
}

/** 1 = main path, 2 = trail/ramp/bridge (the classic generator's route mask; the bot and decor read it) */
function routeMask(g: LocCtx) {
  const r = new Uint8Array(g.S * g.S);
  for (const L of g.links) for (const k of L.tiles) r[k] = L.kind === 'path' ? 1 : 2;
  for (let k = 0; k < r.length; k++) if (g.kind[k] === K.step) r[k] = 2;
  return r;
}
