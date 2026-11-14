// Habitat generator: map = generateHabitat({ recipe, seed }). The pipeline (docs/HABITATS.md):
//   1. landform   the recipe's kernel lays out relief, medium and anchors and embeds the mode graph's routes
//   2. dress      surfaces, ruins, cover, vegetation by suitability, detail (after the routes are reserved)
//   3. seal       walkable pockets no enemy can reach become rock or thicket (bounded)
//   4. validate   playability on the final collision, in every environment state (validate.ts)
//   5. repair     bounded local repairs, re-validated: occlude a dominant perch with a rock block, widen an approach
//                 by clearing props; never on a locked anchor (the habitat's identity)
//   6. identity   the recipe's defining features survived (a seed that lost one is rejected, not repaired)
// A failed attempt re-rolls with mixSeed(seed, n); when every attempt fails, the recipe's known valid fallback seed
// is loaded and the map records why. Pure function of (recipe, variant, seed, size, version).
import { defaultRules } from '../../rules/defaults';
import type { GenMeta } from '../gen/context';
import { mixSeed, navOpen } from '../gen/util';
import { enemyCore } from '../locgen/nav';
import { PROP_RULES, T, type ArenaMap } from '../tiles';
import { HK, HabCtx, MED } from './ctx';
import { dress, write } from './dress';
import { smoothTreads, tidal } from './families';
import { LANDFORMS } from './landforms';
import { CONTROL_POINT, profilesFor } from './mode';
import { HABITATS } from './recipes';
import type { BodyProfile, HabMeta, HabitatRecipe, ModeGraph } from './types';
import { validateHabitat, type HabReport, type Layout } from './validate';

// v2: surface variants are collision- and footing-identical to the recipe (docs/HABITAT_AUDIT.md); crater fallback seeds
// re-verified. A base recipe's layout for a given seed is the same as v1.
export const HAB_VERSION = 2;
export const MAX_ATTEMPTS = 6;
export const DROP_NAV = 4;
const REPAIR_ROUNDS = 4;

export interface HabOptions {
  recipe: string | HabitatRecipe; seed: number; size?: number; variant?: string; mode?: ModeGraph; profiles?: BodyProfile[]; noFallback?: boolean;
  /** replaces attemptHabitat: tests inject a controlled fixture to drive retry exhaustion and the fallback (never set in the game) */
  attempt?: typeof attemptHabitat;
}
export interface HabAttempt { g: HabCtx; report: HabReport; identity: string[]; ok: boolean; failed: string[] }

export class HabitatError extends Error {
  constructor(msg: string, readonly rejections: { seed: number; failed: string[] }[], readonly recipe = '', readonly seed = 0) { super(msg); }
}

export function generateHabitat(o: HabOptions): ArenaMap {
  const recipe = typeof o.recipe === 'string' ? HABITATS[o.recipe] : o.recipe;
  if (!recipe) throw new Error(`unknown habitat recipe ${o.recipe}`);
  const variant = o.variant && recipe.variants[o.variant] ? o.variant : '';
  const size = o.size ?? 128, mode = o.mode ?? CONTROL_POINT, profiles = o.profiles ?? profilesFor(defaultRules, DROP_NAV);
  const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
  const attempt = o.attempt ?? attemptHabitat;
  const rejections: { seed: number; failed: string[] }[] = [];
  const run = (seed: number) => {
    for (let a = 0; a < MAX_ATTEMPTS; a++) {
      const s = a === 0 ? seed >>> 0 : mixSeed(seed, a);
      const r = attempt(recipe, mode, s, size, variant, profiles);
      if (r.ok) return { r, attempts: a + 1 };
      rejections.push({ seed: s, failed: r.failed });
    }
    return null;
  };
  let got = run(o.seed);
  let fallback: HabMeta['fallback'];
  if (!got && !o.noFallback) {
    for (const fs of recipe.fallbackSeeds) {
      if (fs === o.seed) continue;
      const f = attempt(recipe, mode, fs >>> 0, size, variant, profiles);
      if (f.ok) { got = { r: f, attempts: MAX_ATTEMPTS + 1 }; fallback = { requested: o.seed >>> 0, used: fs, why: rejections.map((x) => x.failed.join('+')).join('; ') }; break; }
      rejections.push({ seed: fs, failed: f.failed });
    }
  }
  if (!got) throw new HabitatError(`${recipe.name}: seed ${o.seed} and its fallbacks failed (${rejections.map((x) => `${x.seed}: ${x.failed.join(', ')}`).join(' | ')})`, rejections, recipe.id, o.seed >>> 0);
  const { r, attempts } = got;
  return finish(r, recipe, variant, o.seed >>> 0, attempts, rejections, fallback, typeof performance !== 'undefined' ? performance.now() - t0 : 0);
}

/** one attempt: landform, dress, seal, validate with bounded repairs, identity */
export function attemptHabitat(recipe: HabitatRecipe, mode: ModeGraph, seed: number, size: number, variant: string, profiles: BodyProfile[]): HabAttempt {
  const g = new HabCtx(recipe, mode, size, seed, variant);
  LANDFORMS[recipe.landform](g);
  const smoothed = smoothTreads(g);
  if (smoothed) g.notes.push(`smoothed ${smoothed} tread tiles`);
  // a tidal recipe: the floor its water covers at high water, measured on the final heights (nothing is dressed there)
  if (recipe.tide) {
    const tiles = tidal(g, MED.water, recipe.tide.low, recipe.tide.high);
    for (const k of tiles) g.keep[k] = 1;
    g.notes.push(`tide covers ${tiles.length} tiles at high water`);
  }
  write(g);
  const m = g.m;
  m.spawn = [Math.floor(g.nodes.spawnA[0]), Math.floor(g.nodes.spawnA[1])];
  dress(g);
  const sealed = seal(g);
  if (sealed) g.repairs.push(`sealed ${sealed} unreachable tiles`);
  const L = layoutOf(g);
  let report = validateHabitat(m, L, profiles);
  for (let round = 0; round < REPAIR_ROUNDS && !report.ok; round++) {
    const fixable = report.failed.every((f) => f === 'perch' || f.startsWith('reach') || f.startsWith('independent') || f === 'planned' || f === 'contest');
    if (!fixable) break;
    let did = 0;
    if (report.failed.includes('perch')) did += occlude(g, report);
    if (report.failed.some((f) => f.startsWith('reach') || f === 'planned' || f === 'contest' || f.startsWith('independent'))) did += widen(g);
    if (!did) break;
    seal(g);
    report = validateHabitat(m, layoutOf(g), profiles);
  }
  const identity = identityOf(g, report);
  const failed = [...report.failed, ...(identity.length ? ['identity'] : [])];
  return { g, report, identity, ok: report.ok && !identity.length, failed: identity.length ? [...report.failed, ...identity.map((x) => 'identity:' + x)] : failed };
}

export function layoutOf(g: HabCtx): Layout {
  return {
    contest: g.contest, stage: { A: g.nodes.stageA, B: g.nodes.stageB },
    approaches: g.approaches.map((a) => ({ id: a.id, team: a.team, tiles: a.tiles })),
    hazard: g.hazard, culvert: g.culvert, platform: g.platform, joins: g.joins, outlets: g.outlets, sinks: g.sinks,
    dropNav: DROP_NAV, states: g.recipe.states,
    tide: g.tideLevels ? { mask: g.tide, ...g.tideLevels } : undefined,
  };
}

/** walkable tiles outside the spawn's strongly connected component become rock (or thicket in a forest) */
function seal(g: HabCtx): number {
  const m = g.m, S = g.S, n = S * S;
  const core = enemyCore(m, m.spawn[1] * S + m.spawn[0], DROP_NAV);
  let sealed = 0;
  for (let k = 0; k < n; k++) {
    if (!navOpen(m, k) || core[k]) continue;
    sealed++;
    // ground under a deck stays where it is (the slab spans it); it only becomes impassable
    if (m.over && m.over[k] > 0) { m.wall[k] = 1; continue; }
    if (g.recipe.landform !== 'gorge' || g.lock[k] || g.keep[k]) { m.wall[k] = 1; m.elev[k] += 2.5; m.terrain[k] = T.stone; g.kind[k] = HK.rock; }
    else if (!g.b.prop(g.vegetation().fill as never, k % S, (k / S) | 0, { force: true, allowPath: true })) { m.wall[k] = 1; g.kind[k] = HK.rock; m.terrain[k] = T.stone; m.elev[k] += 2.5; }
  }
  // decks nobody can reach (an arch over a sealed tunnel) are removed
  if (m.over) for (let k = 0; k < n; k++) if (m.over[k] > 0 && !core[n + k]) { m.over[k] = 0; sealed++; }
  // an optional crossing whose ends were sealed leads nowhere: it is dropped from the plan (a recorded repair)
  g.joins = g.joins.filter((J) => {
    const dead = J.ends.some((e) => e >= 0 && g.kind[e] === HK.rock && !g.lock[e]);
    if (dead) { g.repairs.push(`dropped unreachable ${J.what}`); g.optional = g.optional.filter((o) => !(J.what === 'ford' && o === 'lip-ford') && !(J.what === 'bridge' && o === 'south-bridge' && J.h === 0)); }
    return !dead;
  });
  return sealed;
}

/** repair: an occluding rock spur across the sightline from each dominant perch to the approach it watches, set back
 *  near the perch (spec R30: "set it back, cut its firing arc, add an occluding spur"); tall enough to cut the ray
 *  where it stands, never on reserved, locked, route or platform space */
function occlude(g: HabCtx, rep: HabReport): number {
  const m = g.m, S = g.S;
  let did = 0;
  const done = new Set<number>();
  for (const p of rep.perches) {
    if (did >= 14) break;
    if (done.has(p.tile)) continue;
    const px = (p.tile % S) + 0.5, py = ((p.tile / S) | 0) + 0.5;
    const eye = (p.deck && m.over ? m.over[p.tile] : m.elev[p.tile]) + 1.4;
    // block the sightline to each visible sample of the less-exposed segment, as near the perch as will work
    for (const t of p.targets) {
      const tx = (t % S) + 0.5, ty = ((t / S) | 0) + 0.5, tgt = m.elev[t] + 0.9;
      const L = Math.hypot(tx - px, ty - py) || 1, nx = -(ty - py) / L, ny = (tx - px) / L;
      for (let f = 0.06; f <= 0.94; f += 0.04) {
        const cx = px + (tx - px) * f, cy = py + (ty - py) * f, ray = eye + (tgt - eye) * f;
        const tiles: number[] = [];
        for (const o of [-1, 0, 1]) {
          const x = Math.floor(cx + nx * o), y = Math.floor(cy + ny * o);
          if (!g.in(x, y)) continue;
          const k = g.idx(x, y);
          if (g.lock[k] || g.platform[k] || !g.play(k) || g.kind[k] === HK.route || g.kind[k] === HK.ramp || g.kind[k] === HK.tunnel || g.over[k] > 0) continue;
          // reserved margin may take a spur, but never within 2 tiles of a tread (the route keeps its width)
          if (g.keep[k] && nearTread(g, x, y, 2)) continue;
          tiles.push(k);
        }
        if (tiles.length < 2) continue;
        const base = Math.max(...tiles.map((k) => m.elev[k]));
        const top = Math.max(base + 1.2, ray + 0.5);
        if (top - base > 3.2) continue; // taller would read as a pillar of rock on open ground
        for (const k of tiles) {
          m.props = m.props.filter((q) => !((k % S) >= q.x && (k % S) < q.x + q.w && ((k / S) | 0) >= q.y && ((k / S) | 0) < q.y + q.h));
          m.wall[k] = 1; m.platform[k] = 0; m.elev[k] = top; m.terrain[k] = T.stone; g.kind[k] = HK.rock; g.H[k] = top;
        }
        g.repairs.push(`occlude perch ${p.tile % S},${(p.tile / S) | 0}: ${tiles.length}-tile spur ${(top - base).toFixed(1)} m at ${Math.floor(cx)},${Math.floor(cy)}`);
        did++;
        break;
      }
    }
    for (const q of rep.perches) if (Math.abs((q.tile % S) - (p.tile % S)) <= 1 && Math.abs(((q.tile / S) | 0) - ((p.tile / S) | 0)) <= 1) done.add(q.tile);
  }
  return did;
}

function nearTread(g: HabCtx, x: number, y: number, r: number): boolean {
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    if (!g.in(x + dx, y + dy)) continue;
    const t = g.kind[g.idx(x + dx, y + dy)];
    if (t === HK.route || t === HK.ramp || t === HK.tunnel || g.over[g.idx(x + dx, y + dy)] > 0) return true;
  }
  return false;
}

/** repair: clear blocking props within 2 tiles of every planned approach (never a locked landmark) */
function widen(g: HabCtx): number {
  const m = g.m, S = g.S, n = S * S, near = new Uint8Array(n);
  for (const A of g.approaches) for (const k of A.tiles) {
    const x = k % S, y = (k / S) | 0;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) if (g.in(x + dx, y + dy)) near[g.idx(x + dx, y + dy)] = 1;
  }
  let did = 0;
  m.props = m.props.filter((p) => {
    const P = PROP_RULES[p.kind];
    if (!P.wall && !P.platform) return true;
    if (p.kind === g.recipe.props.landmarkProp) return true;
    for (let y = p.y; y < p.y + p.h; y++) for (let x = p.x; x < p.x + p.w; x++) {
      if (!g.in(x, y) || !near[g.idx(x, y)]) continue;
      for (let j = p.y; j < p.y + p.h; j++) for (let i = p.x; i < p.x + p.w; i++) if (g.in(i, j)) { const k = g.idx(i, j); if (g.kind[k] !== HK.rock && g.kind[k] !== HK.mass) { m.wall[k] = 0; m.platform[k] = 0; } }
      did++;
      return false;
    }
    return true;
  });
  if (did) g.repairs.push(`widen: cleared ${did} props beside the approaches`);
  return did;
}

/** the recipe's defining features, measured on the result */
function identityOf(g: HabCtx, rep: HabReport): string[] {
  const m = g.m, n = g.S * g.S, out: string[] = [];
  let terrace = 0, fluid = 0, tall = 0, trees = 0, decks = 0, rock = 0;
  for (let k = 0; k < n; k++) {
    if (g.kind[k] === HK.terrace) terrace++;
    if (m.terrain[k] === T.water) fluid++;
    if (m.terrain[k] === T.tall) tall++;
    if (m.over && m.over[k] > 0) decks++;
    if (g.kind[k] === HK.rock) rock++;
  }
  for (const p of m.props) if (p.kind === 'tree' || p.kind === 'tree2' || p.kind === 'round' || p.kind === 'icepine' || p.kind === 'deadtree') trees++;
  if (!g.landmark) out.push('landmark');
  else if (Math.hypot(g.landmark.x - g.contest.x, g.landmark.y - g.contest.y) > g.contest.r + 6) out.push('landmark-far');
  const drained = rep.gates.find((x) => x.id === 'drainage');
  if (drained && !drained.ok) out.push('drainage');
  if (g.recipe.landform === 'gorge') {
    if ((rep.metrics.fallsEdges ?? 0) < 2) out.push('falls');
    if (terrace < 100) out.push('terrace');
    if (trees < 60) out.push('forest');
    if (tall < 25) out.push('tall-grass');
    if (!(g.shape.spurA > 0 && g.shape.spurB > 0)) out.push('spurs');
    if (decks < 20) out.push('causeways');
  } else if (g.recipe.landform === 'shoal') {
    // the tide floods a real floor (hall, chamber, ramp feet), the sea inlet is there, the gallery crosses on a deck
    let floor = 0;
    for (let k = 0; k < n; k++) if (g.tide[k] && g.kind[k] !== HK.fluid && navOpen(m, k)) floor++;
    if (floor < 150) out.push('tidal-floor');
    if (fluid < 30) out.push('inlet');
    if (g.joins.filter((j) => j.what === 'causeway').length < 2 || decks < 8) out.push('causeways');
    const sc = rep.gates.find((x) => x.id === 'tide:shortcut');
    if (!sc || !sc.ok) out.push('shortcut');
  } else {
    let lava = 0;
    for (let k = 0; k < n; k++) if (m.terrain[k] === T.water) lava++;
    if (lava < 60) out.push('lava');
    if (g.joins.filter((j) => j.what === 'arch').length < 2 || decks < 8) out.push('arches');
    // the crest: some rim high ground survived the pocket repair
    const core = enemyCore(m, m.spawn[1] * g.S + m.spawn[0], DROP_NAV);
    let crest = 0;
    for (let k = 0; k < n; k++) if (core[k] && Math.abs(m.elev[k] - g.recipe.levels.crest) < 0.3 && navOpen(m, k)) crest++;
    if (crest < 20) out.push('crest');
  }
  void fluid; void rock;
  return out;
}

function finish(r: HabAttempt, recipe: HabitatRecipe, variant: string, seed: number, attempts: number, rejections: { seed: number; failed: string[] }[], fallback: HabMeta['fallback'], ms: number): ArenaMap {
  const { g, report } = r;
  const m = g.m, S = g.S;
  m.id = `${recipe.id}${variant ? ':' + variant : ''}@${fallback ? fallback.used : seed}h${HAB_VERSION}`;
  m.name = variant ? recipe.variants[variant].name : recipe.name;
  m.bossSpot = [Math.floor(g.contest.x), Math.floor(g.contest.y)];
  const route = new Uint8Array(S * S);
  for (const A of g.approaches) for (const k of A.tiles) route[k] = A.kind === 'direct' ? 1 : 2;
  const core = enemyCore(m, m.spawn[1] * S + m.spawn[0], DROP_NAV);
  const anchors = g.anchors.map(([x, y]) => [Math.floor(x), Math.floor(y)] as [number, number]).filter(([x, y]) => g.in(x, y) && core[g.idx(x, y)]);
  m.chestSpots = m.chestSpots.filter(([x, y]) => g.in(x, y) && core[g.idx(x, y)]);
  const hab: HabMeta = {
    recipe: recipe.id, variant, version: HAB_VERSION, seed, attemptSeed: g.seed, attempts, medium: recipe.medium,
    contest: g.contest, stage: { A: g.nodes.stageA, B: g.nodes.stageB },
    approaches: g.approaches.map((a) => ({ id: a.id, team: a.team, kind: a.kind, form: a.form, tiles: a.tiles.length })),
    hazard: [...g.hazard.keys()].filter((k) => g.hazard[k]), optional: g.optional,
    ...(g.tideLevels ? { tide: { tiles: [...g.tide.keys()].filter((k) => g.tide[k] && g.kind[k] !== HK.rock), ...g.tideLevels } } : {}), families: [...g.used].sort(), shape: g.shape,
    gates: report.gates, metrics: report.metrics, repairs: g.repairs, rejections, fallback,
    anchors: recipe.anchors.map((a) => ({ id: a.id, provenance: a.provenance, locked: a.locked })), notes: g.notes,
  };
  const zones = [
    { id: 0, kind: 'hub', x: Math.round(g.nodes.stageA[0]), y: Math.round(g.nodes.stageA[1]), r: 6, tier: 0, name: 'Team A staging' },
    { id: 1, kind: 'boss', x: Math.round(g.contest.x), y: Math.round(g.contest.y), r: g.contest.r, tier: 0, name: g.landmark?.name ?? 'Contest' },
    { id: 2, kind: 'entrance', x: Math.round(g.nodes.stageB[0]), y: Math.round(g.nodes.stageB[1]), r: 6, tier: 0, name: 'Team B staging' },
  ];
  const meta: GenMeta = {
    generator: 'poke-watch-habitat', version: HAB_VERSION, seed, attemptSeed: g.seed, attempts, repairs: g.repairs.length,
    archetype: `${recipe.id}:${recipe.landform}`, places: [], lookouts: [], spaces: [], sites: [[Math.floor(g.contest.x), Math.floor(g.contest.y)]],
    habitat: g.habitat, cliffOk: new Uint8Array(S * S), route, gates: report.gates, ms,
    loc: {
      id: recipe.id, art: g.art(), particles: recipe.variants[variant]?.particles ?? recipe.particles, dropNav: DROP_NAV, los: true,
      anchors, bodySpots: [], zones,
      links: g.approaches.map((a) => ({ a: a.team === 'A' ? 0 : 2, b: 1, kind: a.kind === 'direct' ? 'path' : 'trail', tiles: a.tiles.length })),
      metrics: report.metrics,
    },
    hab,
  };
  m.gen = meta;
  return m;
}

export { HABITATS, findHabitat } from './recipes';
export { CONTROL_POINT, profilesFor } from './mode';
