// Procedural Pokémon world: map = generate(regionSeed, biome, version). A hierarchical generate–validate–repair
// pipeline (blueprint section 2):
//   plan → terrain → water → flatten + relax → high ground → hamlet → routes → kit stamps → ecology →
//   gameplay pass → border → validate (repair up to 3 times) → seal → bake.
// Pure function of its inputs: no Math.random, no clock in the output, every stage on its own Rng stream, so every
// client generates the same map from the seed (blueprint section 8).
import { T, type ArenaMap } from '../tiles';
import { GenCtx, type GenMeta } from './context';
import { fields, plantEcology, tagHabitat } from './ecology';
import { addChoke, addLookout, chestSpots, cutTrail, measureSpaces, resolvePockets, shapeHub, sprinkleCover } from './gameplay';
import { featherGroves } from './ecology';
import { kindsOf, stampArch, stampBerry, stampBridges, stampCamp, stampGlade, stampHamlet, stampHedgeGate, stampLookout, stampOak, stampPond, stampShrine, stampSite } from './kit';
import { planRegion } from './plan';
import { buildRoutes } from './routes';
import { baseTerrain, budgetHeight, flattenPlaces, quantise, raiseHighGround, relax, stoneTops } from './terrain';
import { carveWater } from './water';
import { DIRS4, mixSeed, navOpen, walkDist } from './util';
import { validate, walkPath, type Validation } from './validate';

export const GEN_VERSION = 2;
export const MAX_ATTEMPTS = 12;
export const MAX_REPAIRS = 3;

export interface GenOptions {
  biome: string;
  seed: number;
  size?: number;
  version?: number;
  name?: string;
  /** species of the region's spawn table, for the habitat gate */
  species?: string[];
}

const NAMES: Record<string, string> = { meadow: 'Sunpetal Meadow', badlands: 'Cinder Badlands', frost: 'Rimefrost Heights', dusk: 'Duskwood Hollow' };

export function generateRegion(o: GenOptions): ArenaMap {
  const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
  const version = o.version ?? GEN_VERSION;
  let best: { g: GenCtx; v: Validation } | null = null;
  let attempts = 0, repairs = 0;
  for (let a = 0; a < MAX_ATTEMPTS; a++) {
    attempts++;
    const s = a === 0 ? o.seed >>> 0 : mixSeed(o.seed, a);
    const r = attempt(o, s);
    repairs += r.g.repairs;
    if (!best || r.v.failed.length < best.v.failed.length) best = r;
    if (r.v.ok) break;
  }
  const { g, v } = best!;
  const m = g.m;
  m.id = `${o.biome}@${o.seed >>> 0}v${version}`;
  const meta: GenMeta = {
    generator: 'poke-watch-worldgen', version, seed: o.seed >>> 0, attemptSeed: g.seed, attempts, repairs,
    archetype: g.archetype, places: g.places, lookouts: g.lookouts, spaces: g.spaces, sites: g.sites,
    habitat: g.habitat, cliffOk: g.cliffOk, route: g.route, gates: v.gates,
    ms: typeof performance !== 'undefined' ? performance.now() - t0 : 0,
  };
  m.gen = meta;
  return m;
}

export function generateAttempt(o: GenOptions, seed: number, timing = false): { g: GenCtx; v: Validation } {
  return attempt(o, seed, timing);
}

function attempt(o: GenOptions, seed: number, timing = false): { g: GenCtx; v: Validation } {
  const S = o.size ?? 128;
  const g = new GenCtx(o.biome, o.name ?? NAMES[o.biome] ?? o.biome, S, seed);
  g.spawnSpecies = o.species ?? [];
  const m = g.m;
  let tPrev = timing ? performance.now() : 0;
  if (timing) g.timing = {};
  const lap = (name: string) => { if (!timing) return; const t = performance.now(); g.timing![name] = (g.timing![name] ?? 0) + t - tPrev; tPrev = t; };
  // 1. plan, 2. terrain, 3. water
  planRegion(g);
  baseTerrain(g);
  quantise(g);
  carveWater(g);
  lap('water');
  flattenPlaces(g);
  relax(g);
  budgetHeight(g);
  raiseHighGround(g);
  lap('terrain');
  // places keep their clearings
  for (const p of g.places) {
    const r = p.kind === 'hub' ? 13 : p.kind === 'boss' ? 9 : p.kind === 'hamlet' ? 10 : p.kind === 'pond' ? 0 : p.r;
    for (let y = p.y - r; y <= p.y + r; y++) for (let x = p.x - r; x <= p.x + r; x++) if (g.in(x, y) && (x - p.x) ** 2 + (y - p.y) ** 2 <= r * r) g.keepOpen[g.idx(x, y)] = 1;
  }
  const hub = g.place('hub')!, boss = g.place('boss')!;
  m.spawn = [hub.x, hub.y];
  m.bossSpot = [boss.x, boss.y];
  // 4. hamlet street (routes reuse it), routes, banks
  const hamlet = g.place('hamlet');
  if (hamlet) stampHamlet(g, hamlet);
  lap('places');
  const routes = buildRoutes(g);
  lap('routes');
  if (!routes.ok) g.notes.push('routes failed: ' + routes.failed.map((f) => f.join('–')).join(', '));
  g.b.banks(o.biome === 'badlands' ? T.dirt : T.sand, 1);
  // 5. kit stamps
  for (const p of g.places) {
    switch (p.kind) {
      case 'shrine': stampShrine(g, p); break;
      case 'oak': stampOak(g, p); break;
      case 'pond': stampPond(g, p); break;
      case 'boss': stampGlade(g, p); break;
      case 'arch': stampArch(g, p); break;
      case 'berry': stampBerry(g, p); break;
      case 'lookout': stampLookout(g, p); break;
      case 'site': stampSite(g, p); break;
      case 'hamlet': stampHedgeGate(g, p); break;
      default: break;
    }
  }
  stampCamp(g, hub, g.m.name);
  stampBridges(g);
  lap('stamps');
  // 6. ecology
  const F = fields(g);
  plantEcology(g, F);
  lap('ecology');
  // 7. gameplay pass
  shapeHub(g);
  sprinkleCover(g);
  chestSpots(g);
  lap('gameplay');
  // 8. frame, lips, stone tops
  g.b.border(5, 4, kindsOf(o.biome).wall, seed % 97, []);
  featherGroves(g);
  resolvePockets(g);
  g.b.ledgeLips();
  stoneTops(g);
  lap('frame');
  // validate and repair
  let v = check(g, F);
  for (let r = 0; r < MAX_REPAIRS && !v.ok; r++) {
    if (!repair(g, v)) break;
    g.repairs++;
    v = check(g, F);
  }
  lap('validate');
  g.b.sealPockets();
  lap('seal');
  return { g, v };
}

function check(g: GenCtx, F: ReturnType<typeof fields>): Validation {
  g.spaces = measureSpaces(g);
  tagHabitat(g, F);
  const m = g.m, S = g.S;
  const D = walkDist(m, m.spawn[1] * S + m.spawn[0]);
  let open = 0, reach = 0;
  for (let k = 0; k < S * S; k++) if (navOpen(m, k)) { open++; if (D[k] >= 0) reach++; }
  return validate(g, reach / Math.max(1, open));
}

/** local fixes; returns false when nothing applies (the seed is re-rolled) */
function repair(g: GenCtx, v: Validation): boolean {
  let did = false;
  const m = g.m, S = g.S;
  for (const id of v.failed) {
    if (id === 'spawnCover' || id === 'spawnOpen') { shapeHub(g); did = true; }
    else if ((id === 'vertical' && !v.gates.find((x) => x.id === 'vertical')!.value.startsWith('2')) || id === 'lookout') { if (addLookout(g)) did = true; }
    else if (id === 'groveEdge') { featherGroves(g); did = true; }
    else if (id === 'spaces') { if (addChoke(g)) did = true; }
    else if (id === 'reach') {
      // drop unreachable chest spots; landmarks and sites need a trail (cleared through trees)
      const D = walkDist(m, m.spawn[1] * S + m.spawn[0]);
      const before = m.chestSpots.length;
      m.chestSpots = m.chestSpots.filter(([x, y]) => D[y * S + x] >= 0);
      if (m.chestSpots.length !== before) did = true;
      for (const l of m.landmarks) {
        if (near(D, S, l.x, l.y)) continue;
        if (cutTrail(g, m.spawn, [l.x, l.y])) did = true;
      }
      for (const [x, y] of g.sites) if (D[y * S + x] < 0 && cutTrail(g, m.spawn, [x, y])) did = true;
    } else if (id === 'loop' || id === 'bossGlade') {
      const p1 = walkPath(m, m.spawn[1] * S + m.spawn[0], m.bossSpot[1] * S + m.bossSpot[0]);
      if (p1) {
        const avoid = new Uint8Array(S * S);
        for (const k of p1) { avoid[k] = 1; const x = k % S, y = (k / S) | 0; for (const [dx, dy] of DIRS4) for (let s = 1; s <= 3; s++) if (g.in(x + dx * s, y + dy * s)) avoid[g.idx(x + dx * s, y + dy * s)] = 1; }
        if (cutTrail(g, m.spawn, m.bossSpot, avoid)) did = true;
      }
    }
  }
  return did;
}

function near(D: Int32Array, S: number, x: number, y: number) {
  for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) { const i = x + dx, j = y + dy; if (i >= 0 && j >= 0 && i < S && j < S && D[j * S + i] >= 0) return true; }
  return false;
}
