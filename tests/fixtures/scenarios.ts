// The hero-shooter replay baseline (docs/hero-shooter-pivot.md §7, Q41–Q43). Each scenario is a map, a hero or loadout,
// a mode, a target set and a scripted input track: a schedule of InputFrame fields by tick, some of it steering toward a
// point it reads off the map (still a pure function of the sim state, so it replays exactly). The aim ray comes from
// the chase-camera crosshair (scripts/lib/aimbot.ts) unless the track sets its own (the pitch extremes). No bot.
//
// runScenario returns replayHash (src/sim/checksum.ts) every 10 s and at the end, and the coverage counters (what the
// track actually reached: holds, throws, parries, ticks under a deck…). tests/replays.test.ts asserts the hashes against
// tests/fixtures/replays.json and each scenario's `needs` (a counter at least that high) and `never` (a counter at 0);
// `npx tsx scripts/checksum.ts scenarios --update` rewrites the fixture (a commit that changes it says why).
//
// Aim: like the browser (src/main.ts sampleInput), every tick sends the crosshair ray (InputFrame.aim, read by the
// direct shots) and the ground aim point (aimX / aimZ, read by every other move, the holds among them).
import { createRun, step } from '../../src/sim/run';
import { BTN, NO_INPUT, type AimRay, type InputFrame, type SimContext } from '../../src/sim/types';
import { HOLD, RANGE, RANGE_SWAP } from '../../src/mods';
import type { Mode } from '../../src/mods/types';
import { HABITAT_TARGETS, RANGE_TARGETS, type TargetSet } from '../../src/rules/targets';
import { replayHash } from '../../src/sim/checksum';
import { crosshairTarget, withAim } from '../../scripts/lib/aimbot';
import { dcos, dsin } from '../../src/core/detmath';
import { pathBetween } from '../../src/world/locgen/nav';
import { clearance } from '../../src/world/habitat/validate';
import { DECK_SLAB, T as Tile } from '../../src/world/tiles';
import { PK, ROLE } from '../../src/sim/pools';
import { partnerFootprint, partnerHeight } from '../../src/rules/sizing';
import { SPECIES_BY_ID } from '../../src/rules/species';
import { BODY_KINDS } from '../../src/rules/materials';
import { HOLD_MOVES } from '../../src/rules/capabilities';

export interface Scenario {
  id: string;
  /** what it covers (Q41) */
  covers: string;
  mode: Mode;
  species: string;
  loadout?: string[];
  worldgen: Record<string, unknown>;
  targets?: TargetSet;
  seconds: number;
  /** the track: the input for this tick (merged over NO_INPUT); return `aim` (and aimX / aimZ) to override the crosshair */
  input: (ctx: SimContext, tick: number) => Partial<InputFrame>;
  /** coverage the track must reach: counter → its minimum (tests/replays.test.ts) */
  needs: Partial<Record<Counter, number>>;
  /** counters that must stay 0 (what the scenario shows is refused) */
  never?: Counter[];
}

/** what a run reached, counted from its events and state each tick (runScenario) */
export const COUNTERS = [
  'jumps', 'dashes', 'guards', 'parries', 'hits', 'kills', 'hurt', 'castPrimary', 'castQ', 'castE',
  'hitDummy', 'hitPatrol', 'hitStrafe', 'pitchUp', 'pitchDown', 'breakthroughs', 'respawns', 'tags', 'tagActions',
  'holds', 'throws', 'underDeck', 'deckEdge', 'swimTicks', 'hazardEnter', 'hazardExit', 'floods', 'cells', 'coats', 'holdTicks', 'raiders',
] as const;
export type Counter = typeof COUNTERS[number];

const S = 60; // ticks per second (rules.sim.hz)
const arena = { arena: 'range' };
const habitat = (id: string, seed: number) => ({ mode: 'generated', regionSeed: seed, locations: { meadow: id, dusk: id, badlands: id, frost: id } });

/** heading in radians (0 = +z) as a move vector */
const go = (a: number): Partial<InputFrame> => ({ mx: dsin(a), mz: dcos(a) });
/** walk straight at a world point */
function toward(ctx: SimContext, x: number, z: number): Partial<InputFrame> {
  const P = ctx.player, dx = x - P.x, dz = z - P.z, L = Math.sqrt(dx * dx + dz * dz);
  return L < 0.3 ? {} : { mx: dx / L, mz: dz / L };
}
/** a press on its first tick, held for `dur` ticks from `at` */
function hold(tick: number, at: number, dur: number, bit: number): Partial<InputFrame> {
  if (tick < at || tick >= at + dur) return {};
  return tick === at ? { btn: bit, press: bit } : { btn: bit };
}
/** a jump press edge on one tick (a buffered or coyote jump) */
const jumpAt = (tick: number, at: number): Partial<InputFrame> => (tick === at ? { jump: true, jumpPressed: true } : tick > at && tick < at + 12 ? { jump: true, jumpPressed: false } : { jumpPressed: false });
/** a crosshair ray straight up or down at `deg` from the player's shoulder */
function pitchRay(ctx: SimContext, deg: number): AimRay {
  const P = ctx.player, r = (deg * Math.PI) / 180, c = Math.cos(r), f = Math.fround;
  return { ox: f(P.x), oy: f(P.y + 1.7), oz: f(P.z + 4.5), dx: 0, dy: f(Math.sin(r)), dz: f(-c) };
}
/** merge partial inputs, OR-ing the button bits */
function mix(...parts: Partial<InputFrame>[]): Partial<InputFrame> {
  const out: Partial<InputFrame> = {};
  for (const p of parts) for (const [k, v] of Object.entries(p)) {
    if ((k === 'btn' || k === 'press') && typeof v === 'number') (out as Record<string, unknown>)[k] = ((out as Record<string, number>)[k] ?? 0) | v;
    else (out as Record<string, unknown>)[k] = v;
  }
  return out;
}
/** follow a route to (tx, tz): a tile path over ground with at least `room` metres of clearance (World nav, the
 *  validator's clearance), computed once per run and key; walks to its next waypoint, else straight at the point */
const routes = new WeakMap<SimContext, Map<string, number[] | null>>();
function route(ctx: SimContext, key: string, tx: number, tz: number, room: number): Partial<InputFrame> {
  const W = ctx.world, m = W.map, P = ctx.player;
  let mine = routes.get(ctx);
  if (!mine) { mine = new Map(); routes.set(ctx, mine); }
  if (!mine.has(key)) {
    const cl = clearance(m), allow = new Uint8Array(cl.length);
    for (let v = 0; v < cl.length; v++) allow[v] = cl[v] >= room ? 1 : 0;
    mine.set(key, pathBetween(m, W.tile(P.x, P.z), W.tile(tx, tz), allow));
  }
  const path = mine.get(key);
  if (!path || !path.length) return toward(ctx, tx, tz);
  const n = m.w * m.h, at = (k: number): [number, number] => { const q = k % n; return [(q % m.w) - W.half + 0.5, Math.floor(q / m.w) - W.half + 0.5]; };
  // the first waypoint more than 1.2 m away, past the nearest one
  let best = 0, bd = 1e9;
  for (let i = 0; i < path.length; i++) { const [x, z] = at(path[i]); const d = (x - P.x) ** 2 + (z - P.z) ** 2; if (d < bd) { bd = d; best = i; } }
  for (let i = best; i < path.length; i++) { const [x, z] = at(path[i]); if ((x - P.x) ** 2 + (z - P.z) ** 2 > 1.44) return toward(ctx, x, z); }
  return toward(ctx, tx, tz);
}
/** a ray from the crosshair's lens to a world point (aiming at a body, which the crosshair does not pick) */
function rayAt(ctx: SimContext, x: number, y: number, z: number): AimRay {
  const P = ctx.player, ex = P.x, ey = P.y + 1.7, ez = P.z, dx = x - ex, dy = y - ey, dz = z - ez, L = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1, f = Math.fround;
  return { ox: f(ex), oy: f(ey), oz: f(ez), dx: f(dx / L), dy: f(dy / L), dz: f(dz / L) };
}
/** aim at a world point as the browser would: the crosshair ray to it and the ground aim point under it */
const aimAt = (ctx: SimContext, x: number, y: number, z: number): Partial<InputFrame> => ({ aim: rayAt(ctx, x, y, z), aimX: x, aimZ: z });
/** the nearest live body of a template kind (BODY_KINDS index), else -1 */
function nearestBody(ctx: SimContext, kind: number): number {
  const B = ctx.bodies, P = ctx.player;
  let near = -1, nd = 1e9;
  for (let i = 0; i < B.hi; i++) if (B.alive[i] && B.kind[i] === kind) { const d = (B.x[i] - P.x) ** 2 + (B.z[i] - P.z) ** 2; if (d < nd) { nd = d; near = i; } }
  return near;
}
/** a timed Guard: tap it the tick a hostile shot is about to reach the Guard's deflect reach (rules.combat.guardWindow),
 *  hold it a few ticks, else leave it up; reads only sim state */
const guardTap = new WeakMap<SimContext, number>();
function timedGuard(ctx: SimContext, t: number): Partial<InputFrame> {
  const P = ctx.player, Pr = ctx.projectiles, since = guardTap.get(ctx) ?? -99;
  if (t - since < 8) return { btn: BTN.guard };
  if (P.guardT >= 0 || P.guardLock > 0 || P.reflex < 1) return {};
  const pr = partnerFootprint(P.species, ctx.rules);
  for (let i = 0; i < Pr.hi; i++) {
    if (!Pr.alive[i] || Pr.kind[i] !== PK.hostile) continue;
    // the shot's closest approach: tap when it will be inside the Guard's deflect reach (its radius + the body's +
    // 0.9 m, src/sim/effects.ts) within the next 0.1 s, so the 0.15 s window is open when it arrives
    const dx = P.x - Pr.x[i], dz = P.z - Pr.z[i], v = Math.sqrt(Pr.vx[i] ** 2 + Pr.vz[i] ** 2);
    if (v < 1e-3) continue;
    const along = (dx * Pr.vx[i] + dz * Pr.vz[i]) / v, side2 = dx * dx + dz * dz - along * along, R = Pr.radius[i] + pr + 0.9;
    if (along < 0 || side2 > R * R) continue;
    if (along - Math.sqrt(R * R - side2) < v * 0.1) { guardTap.set(ctx, t); return { btn: BTN.guard, press: BTN.guard }; }
  }
  return {};
}
/** a ground tile under a deck that a body of footprint `fp` and height `tall` fits on, reachable from the spawn on a
 *  route with `room` m of clearance: the one with the shortest route; computed once per run */
const lavaStep = new WeakMap<SimContext, number>();
const deckSpots = new WeakMap<SimContext, [number, number] | null>();
function deckSpot(ctx: SimContext, fp: number, tall: number, room: number): [number, number] | null {
  if (deckSpots.has(ctx)) return deckSpots.get(ctx)!;
  const W = ctx.world, m = W.map, cl = clearance(m), allow = new Uint8Array(cl.length);
  for (let v = 0; v < cl.length; v++) allow[v] = cl[v] >= room ? 1 : 0;
  let best: [number, number] | null = null, bl = 1e9;
  if (m.over) for (let k = 0; k < m.w * m.h; k++) {
    if (!(m.over[k] > 0) || !allow[k]) continue;
    const x = (k % m.w) - W.half + 0.5, z = Math.floor(k / m.w) - W.half + 0.5, g = W.height(x, z, 0);
    if (!W.walkable(x, z) || !W.fits(x, z, g, fp, 0.6, tall)) continue;
    const path = pathBetween(m, W.tile(W.spawn[0], W.spawn[1]), k, allow);
    if (path && path.length < bl) { bl = path.length; best = [x, z]; }
  }
  deckSpots.set(ctx, best);
  return best;
}
/** the walkable shore tile beside the habitat's liquid nearest the contest, and the liquid tile it borders (world m);
 *  else the contest twice */
const shores = new WeakMap<SimContext, [number, number, number, number]>();
function shorePoint(ctx: SimContext): [number, number, number, number] {
  const hit = shores.get(ctx);
  if (hit) return hit;
  const W = ctx.world, H = W.hab!, m = W.map, cx = H.contest.x, cy = H.contest.y, at = (i: number) => i - W.half + 0.5;
  let best: [number, number, number, number] = [cx - W.half, cy - W.half, cx - W.half, cy - W.half], bd = 1e9;
  for (let k = 0; k < m.w * m.h; k++) {
    const x = k % m.w, y = Math.floor(k / m.w);
    if (m.terrain[k] === Tile.water || !W.walkable(at(x), at(y))) continue;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const q = (y + dy) * m.w + x + dx;
      if (q < 0 || q >= m.w * m.h || m.terrain[q] !== Tile.water) continue;
      const d = (x - cx) ** 2 + (y - cy) ** 2;
      if (d < bd) { bd = d; best = [at(x), at(y), at(x + dx), at(y + dy)]; }
    }
  }
  shores.set(ctx, best);
  return best;
}
/** a tidal tile (Shoal Grotto) nearest the contest, else the contest */
function tidalPoint(ctx: SimContext): [number, number] {
  const W = ctx.world, H = W.hab!, m = W.map, cx = H.contest.x, cy = H.contest.y, mask = W.tide?.mask;
  let best: [number, number] = [cx - W.half, cy - W.half], bd = 1e9;
  if (mask) for (let k = 0; k < m.w * m.h; k++) if (mask[k]) { const x = k % m.w, y = Math.floor(k / m.w), d = (x - cx) ** 2 + (y - cy) ** 2; if (d < bd) { bd = d; best = [x - W.half + 0.5, y - W.half + 0.5]; } }
  return best;
}
/** fire the kit: primary held, Q and E tapped on their own cadence */
const fire = (tick: number) => mix({ btn: BTN.basic, press: tick % 30 === 0 ? BTN.basic : 0 }, tick % 150 === 40 ? { btn: BTN.a, press: BTN.a } : {}, tick % 210 === 100 ? { btn: BTN.b, press: BTN.b } : {});

export const SCENARIOS: Scenario[] = [
  {
    id: 'range-charmander', covers: 'movement, buffered and coyote jumps, dash, a timed guard against the strafer\'s shot (a parry), ±89° pitch, primary / Q / E, every target kind, Ember setting the tall grass alight (cells)',
    mode: RANGE, species: 'charmander', worldgen: arena, targets: RANGE_TARGETS, seconds: 60,
    needs: { jumps: 3, dashes: 1, guards: 1, parries: 1, pitchUp: 60, pitchDown: 60, castPrimary: 1, castQ: 1, castE: 1, hitDummy: 1, hitPatrol: 1, hitStrafe: 1, cells: 1 },
    input: (ctx, t) => {
      const T = ctx.targets!, E = ctx.enemies, g = T.slot[3];
      if (t < 4 * S) return mix(go(Math.PI), fire(t)); // north into the target field, firing
      if (t < 8 * S) return mix(go(Math.PI * 0.5), t % 40 === 0 ? { dash: true } : {}, fire(t)); // strafe east with dashes
      if (t < 12 * S) return mix(go(-Math.PI * 0.5), jumpAt(t % 50, 0), fire(t)); // west, a jump press every 50 ticks (buffered when it lands)
      if (t < 16 * S) return mix(toward(ctx, 30 - ctx.world.half, 44 - ctx.world.half), jumpAt(t, 15 * S + 30)); // to the terrace
      if (t < 20 * S) return mix(go(Math.PI * 0.5), jumpAt(t, 18 * S)); // off its edge, a late (coyote) press
      if (t < 28 * S) { // close on the strafer, then stand and Guard each shot as it arrives
        const near = g >= 0 && (E.x[g] - ctx.player.x) ** 2 + (E.z[g] - ctx.player.z) ** 2 < 64;
        return mix(g >= 0 && !near ? toward(ctx, E.x[g], E.z[g]) : {}, timedGuard(ctx, t));
      }
      if (t < 32 * S) return { ...fire(t), aim: pitchRay(ctx, 89) }; // straight up
      if (t < 36 * S) return { ...fire(t), aim: pitchRay(ctx, -89) }; // straight down
      if (t < 42 * S) { // the tall-grass patch west of the spawn: stand off its east edge and Ember it alight
        const W = ctx.world, gx = 42 - W.half, gz = 72 - W.half;
        return mix(toward(ctx, gx + 7, gz), fire(t), aimAt(ctx, gx, W.height(gx, gz) + 0.2, gz));
      }
      if (t < 50 * S) return mix(toward(ctx, ctx.world.spawn[0] - 6, ctx.world.spawn[1] - 12), fire(t)); // chase the patrol
      return mix(go((t / S) * 0.6), fire(t)); // circle and fire
    },
  },
  {
    id: 'range-caterpie', covers: 'Breakthrough ×2 (Metapod, Butterfree), the size and traversal change, the status-move Q',
    mode: RANGE, species: 'caterpie', worldgen: arena, targets: RANGE_TARGETS, seconds: 60,
    needs: { breakthroughs: 2, castQ: 1, hits: 1 },
    input: (_ctx, t) => mix(
      t < 5 * S ? go(Math.PI) : {},
      hold(t, 5 * S, 30, BTN.touch), // Breakthrough to Metapod
      hold(t, 20 * S, 30, BTN.touch), // to Butterfree
      t > 26 * S && t < 40 * S ? go(Math.PI * 0.75) : {},
      fire(t),
    ),
  },
  {
    id: 'range-tauros', covers: 'the physical channel, a charge into the field, a Wrap hold (Power 1) on the range\'s Light throwable and a throw at a dummy',
    mode: RANGE, species: 'tauros', worldgen: arena, targets: RANGE_TARGETS, seconds: 60,
    needs: { dashes: 1, castPrimary: 1, castE: 1, holds: 1, throws: 1, hits: 1 },
    input: (ctx, t) => (t >= 10 * S && t < 40 * S ? holdAndThrow(ctx, t, 1.2) : mix(go(t < 10 * S ? Math.PI : (t / S) * 0.5), t < 10 * S && t % 60 === 0 ? { dash: true } : {}, fire(t))),
  },
  {
    id: 'range-mewtwo', covers: 'the special channel, Def / SpD, timed guards against the strafer, a 2 m body, a Psychic hold on the Light throwable and a throw at a dummy',
    mode: RANGE, species: 'mewtwo', worldgen: arena, targets: RANGE_TARGETS, seconds: 60,
    needs: { guards: 1, parries: 1, castPrimary: 1, castE: 1, holds: 1, throws: 1, hits: 1 },
    input: (ctx, t) => {
      if (t < 20 * S) { // hold fire (Mewtwo fells the strafer at once): close to 8 m and Guard each shot as it arrives
        const g = ctx.targets!.slot[3], E = ctx.enemies, near = g >= 0 && (E.x[g] - ctx.player.x) ** 2 + (E.z[g] - ctx.player.z) ** 2 < 64;
        return mix(g >= 0 && !near ? toward(ctx, E.x[g], E.z[g]) : {}, timedGuard(ctx, t));
      }
      if (t < 50 * S) return holdAndThrow(ctx, t, 3);
      return mix(go((t / S) * 0.4), fire(t));
    },
  },
  {
    id: 'mtmoon-onix', covers: 'a giant (2.78 m, Extra Large footprint) walking under one of Mt. Moon\'s 2.9 m decks (replaces the `deck` set)',
    mode: RANGE, species: 'onix', worldgen: habitat('mt-moon', 5), targets: RANGE_TARGETS, seconds: 60,
    needs: { underDeck: 60 },
    input: (ctx, t) => mix(underDeckTrack(ctx, t, 'onix'), fire(t)),
  },
  {
    id: 'mtmoon-wailord', covers: 'xlTall: Wailord (3.23 m) refused at a 2.9 m deck it pushes against, routing on (replaces `deck-xl`)',
    mode: RANGE, species: 'wailord', worldgen: habitat('mt-moon', 3), targets: RANGE_TARGETS, seconds: 60,
    needs: { deckEdge: 60 }, never: ['underDeck'],
    input: (ctx, t) => mix(underDeckTrack(ctx, t, 'onix'), fire(t)),
  },
  {
    id: 'grotto-totodile', covers: 'swimming, the shore, the tide hazard (Shoal Grotto seed 1)',
    mode: RANGE, species: 'totodile', worldgen: habitat('tidal-cave', 1), targets: HABITAT_TARGETS, seconds: 60,
    needs: { swimTicks: 60, floods: 1 },
    input: (ctx, t) => { const [x, z] = tidalPoint(ctx); return mix(t < 40 * S ? route(ctx, 'tide', x, z, 0.45) : go((t / S) * 0.5), fire(t)); },
  },
  {
    id: 'crater-charmander', covers: 'the crater habitat (Cinder Crater): stepping into its lava and back out (the liquid exposure rule), coats from Ember on the targets',
    mode: RANGE, species: 'charmander', worldgen: habitat('volcanic-ridge', 1), targets: HABITAT_TARGETS, seconds: 60,
    needs: { hazardEnter: 1, hazardExit: 1, coats: 1, hits: 1 },
    input: (ctx, t) => {
      const H = ctx.world.hab!, W = ctx.world, P = ctx.player, [sx, sz, lx, lz] = shorePoint(ctx);
      const ashore = (P.x - sx) ** 2 + (P.z - sz) ** 2 < 0.36;
      if (t < 40 * S && !(lavaStep.get(ctx) ?? 0)) { if (ashore) lavaStep.set(ctx, t); return mix(route(ctx, 'shore', sx, sz, 0.45), fire(t)); }
      const k = t - (lavaStep.get(ctx) ?? t);
      if (k < 20) return toward(ctx, lx, lz); // a step into the lava
      if (k < 80) return toward(ctx, sx - (lx - sx), sz - (lz - sz)); // and straight back out
      return mix(toward(ctx, H.contest.x - W.half + 4 * dsin(t / 90), H.contest.y - W.half + 4 * dcos(t / 90)), fire(t));
    },
  },
  {
    id: 'gorge-hold', covers: 'the Hold contract: the point, the Raid party from team B\'s staging (Hold mode)',
    mode: HOLD, species: 'tauros', worldgen: habitat('river-gorge', 1), seconds: 60,
    needs: { holdTicks: 60, raiders: 1 },
    input: (ctx, t) => { const O = ctx.objective; return mix(O ? toward(ctx, O.x, O.z) : {}, fire(t)); },
  },
  {
    id: 'range-swap', covers: 'the opt-in swap system: a three-member loadout, Tag taps, a Tag Action, grey health',
    mode: RANGE_SWAP, species: 'charmander', loadout: ['caterpie', 'tauros'], worldgen: arena, targets: RANGE_TARGETS, seconds: 60,
    needs: { tags: 2, tagActions: 1 },
    input: (_ctx, t) => mix(go(Math.PI + 0.4 * dsin(t / 120)), hold(t % (8 * S), 4 * S, 3, BTN.sig), fire(t)),
  },
];

/** walk to the nearest Light throwable until within `reach` m, press the kit's hold move on it and keep the button
 *  down 1.5 s, the aim swinging from the body to the Geodude dummy after 0.5 s, then release (the throw); again 1 s
 *  later. State is the tick the press began, kept per run */
const holdAt = new WeakMap<SimContext, { at: number }>();
function holdAndThrow(ctx: SimContext, t: number, reach: number): Partial<InputFrame> {
  const B = ctx.bodies, P = ctx.player, T = ctx.targets!, E = ctx.enemies;
  const g = T.slot[0], b = nearestBody(ctx, BODY_KINDS.indexOf('cobble'));
  const slot = P.moves.findIndex((m) => HOLD_MOVES.has(m.key));
  if (b < 0 || slot < 1) return {};
  const bit = slot === 1 ? BTN.a : BTN.b, st = holdAt.get(ctx) ?? { at: -1 };
  holdAt.set(ctx, st);
  const atBody = aimAt(ctx, B.x[b], B.y[b] + 0.2, B.z[b]), atDummy = g >= 0 ? aimAt(ctx, E.x[g], E.y[g] + 0.5, E.z[g]) : atBody;
  if (st.at >= 0) {
    const k = t - st.at;
    if (k < 90) return { btn: bit, ...(k === 0 ? { press: bit } : {}), ...(k < 30 ? atBody : atDummy) };
    if (k < 150) return atDummy;
    st.at = -1;
  }
  if ((B.x[b] - P.x) ** 2 + (B.z[b] - P.z) ** 2 > reach * reach) return { ...toward(ctx, B.x[b], B.z[b]), ...atBody };
  st.at = t;
  return { btn: bit, press: bit, ...atBody };
}

/** walk to the reachable ground tile under a deck that `fitFor`'s body fits (deckSpot), push on into it, then back out
 *  and in again; the tile is chosen by `fitFor`, so a taller hero walking the same track is refused at the slab */
function underDeckTrack(ctx: SimContext, t: number, fitFor: string): Partial<InputFrame> {
  const sp = SPECIES_BY_ID[fitFor], fp = partnerFootprint(sp, ctx.rules), tall = partnerHeight(sp, ctx.rules);
  const spot = deckSpot(ctx, fp, tall, fp);
  if (!spot) return go((t / S) * 0.5);
  if (t < 45 * S) return route(ctx, 'deck', spot[0], spot[1], fp);
  return t < 52 * S ? toward(ctx, ctx.world.spawn[0], ctx.world.spawn[1]) : route(ctx, 'deck', spot[0], spot[1], fp);
}

export type Coverage = Record<Counter, number>;
export interface ScenarioResult { checkpoints: string[]; end: string; coverage?: Coverage }

const hex = (n: number) => (n >>> 0).toString(16).padStart(8, '0');

/** count one tick's coverage (after its step) */
function count(ctx: SimContext, inp: InputFrame, cov: Coverage, held: Float64Array) {
  const P = ctx.player, W = ctx.world, m = W.map, T = ctx.targets, keys = P.moves.map((mv) => mv.key);
  const kindOf = (e: number) => { if (!T) return null; const k = T.slot.indexOf(e); return k >= 0 ? T.set.targets[k].kind : null; };
  for (const e of ctx.events) {
    switch (e.t) {
      case 'jump': cov.jumps++; break;
      case 'dash': cov.dashes++; break;
      case 'guard': cov.guards++; break;
      case 'parry': cov.parries++; break;
      case 'deflect': if (P.guardT >= 0) cov.parries++; break; // a shot met by a timed Guard
      case 'hit': { cov.hits++; const k = kindOf(e.enemy); if (k === 'dummy') cov.hitDummy++; else if (k === 'patrol') cov.hitPatrol++; else if (k === 'strafe') cov.hitStrafe++; break; }
      case 'kill': cov.kills++; break;
      case 'playerHurt': cov.hurt++; break;
      case 'cast': { const s = keys.indexOf(e.key); if (s === 0) cov.castPrimary++; else if (s === 1) cov.castQ++; else if (s === 2) cov.castE++; break; }
      case 'evolveEnd': cov.breakthroughs++; break;
      case 'respawn': cov.respawns++; break;
      case 'tag': cov.tags++; break;
      case 'tagAction': cov.tagActions++; break;
      case 'tide': if (e.phase === 'flood') cov.floods++; break;
      case 'cell': cov.cells++; break;
      case 'hazard': if (e.who === 'player' && e.phase === 'enter') cov.hazardEnter++; else if (e.who === 'player' && e.phase === 'exit') cov.hazardExit++; break;
    }
  }
  if (inp.aim && inp.aim.dy > 0.95) cov.pitchUp++;
  if (inp.aim && inp.aim.dy < -0.95) cov.pitchDown++;
  const B = ctx.bodies;
  for (let b = 0; b < B.hi; b++) {
    const now = B.alive[b] ? B.holdT[b] : 0;
    if (held[b] <= 0 && now > 0) cov.holds++;
    if (held[b] > 0 && now <= 0 && B.alive[b] && B.vx[b] * B.vx[b] + B.vz[b] * B.vz[b] > 1) cov.throws++;
    held[b] = now;
  }
  if (m.over) {
    const k = W.tile(P.x, P.z);
    if (m.over[k] > 0 && P.y < m.over[k] - DECK_SLAB - 0.5) cov.underDeck++;
    else {
      let edge = false;
      for (let dz = -1; dz <= 1 && !edge; dz++) for (let dx = -1; dx <= 1 && !edge; dx++) {
        const x = P.x + dx, z = P.z + dz, q = W.tile(x, z);
        if (q >= 0 && m.over[q] > 0 && Math.abs(W.height(x, z, 0) - P.y) < 0.7 && P.y < m.over[q] - DECK_SLAB - 0.5) edge = true;
      }
      if (edge) cov.deckEdge++;
    }
  }
  if (P.hzSafe) cov.swimTicks++;
  if (P.m.coat) cov.coats++;
  else for (let e = 0; e < ctx.enemies.hi; e++) if (ctx.enemies.alive[e] && ctx.enemies.coat[e]) { cov.coats++; break; }
  if (ctx.objective && ctx.objective.kind === 'hold' && ctx.objective.phase === 'active') cov.holdTicks++;
  const E = ctx.enemies;
  for (let e = 0; e < E.hi; e++) if (E.alive[e] && E.roles[e] & ROLE.raider) { cov.raiders = Math.max(cov.raiders, 1); break; }
}

export function runScenario(s: Scenario): ScenarioResult {
  const ctx = createRun({ mode: s.mode, seed: 1, species: s.species, loadout: s.loadout, targets: s.targets, ruleOverrides: { worldgen: s.worldgen } as never });
  const checkpoints: string[] = [];
  const cov = Object.fromEntries(COUNTERS.map((c) => [c, 0])) as Coverage;
  const held = new Float64Array(ctx.bodies.cap);
  const n = Math.round(s.seconds * S);
  for (let t = 0; t < n; t++) {
    let inp: InputFrame = { ...NO_INPUT, ...s.input(ctx, t) };
    if (!inp.aim) {
      inp = withAim(ctx, inp);
      if (inp.aimX === undefined) { const [x, , z] = crosshairTarget(ctx); inp.aimX = x; inp.aimZ = z; }
    }
    step(ctx, inp);
    count(ctx, inp, cov, held);
    if ((t + 1) % (10 * S) === 0 && t + 1 < n) checkpoints.push(hex(replayHash(ctx)));
  }
  return { checkpoints, end: hex(replayHash(ctx)), coverage: cov };
}
