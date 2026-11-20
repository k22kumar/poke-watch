// The hero-shooter replay baseline (docs/hero-shooter-pivot.md §7, Q41–Q43). Each scenario is a map, a hero or loadout,
// a mode, a target set and a scripted input track: a schedule of InputFrame fields by tick, some of it steering toward a
// point it reads off the map (still a pure function of the sim state, so it replays exactly). The aim ray comes from
// the chase-camera crosshair (scripts/lib/aimbot.ts) unless the track sets its own (the pitch extremes). No bot.
//
// runScenario returns replayHash (src/sim/checksum.ts) every 10 s and at the end; tests/replays.test.ts asserts them
// against tests/fixtures/replays.json, and `npx tsx scripts/checksum.ts scenarios --update` rewrites that file (a commit
// that changes it says why).
import { createRun, step } from '../../src/sim/run';
import { BTN, NO_INPUT, type AimRay, type InputFrame, type SimContext } from '../../src/sim/types';
import { HOLD, RANGE, RANGE_SWAP } from '../../src/mods';
import type { Mode } from '../../src/mods/types';
import { HABITAT_TARGETS, RANGE_TARGETS, type TargetSet } from '../../src/rules/targets';
import { replayHash } from '../../src/sim/checksum';
import { withAim } from '../../scripts/lib/aimbot';
import { dcos, dsin } from '../../src/core/detmath';
import { pathBetween } from '../../src/world/locgen/nav';
import { clearance } from '../../src/world/habitat/validate';

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
  /** the track: the input for this tick (merged over NO_INPUT); return `aim` to override the crosshair ray */
  input: (ctx: SimContext, tick: number) => Partial<InputFrame>;
}

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
/** a tidal tile (Shoal Grotto) nearest the contest, else the contest */
function tidalPoint(ctx: SimContext): [number, number] {
  const W = ctx.world, H = W.hab!, m = W.map, cx = H.contest.x, cy = H.contest.y, mask = W.tide?.mask;
  let best: [number, number] = [cx - W.half, cy - W.half], bd = 1e9;
  if (mask) for (let k = 0; k < m.w * m.h; k++) if (mask[k]) { const x = k % m.w, y = Math.floor(k / m.w), d = (x - cx) ** 2 + (y - cy) ** 2; if (d < bd) { bd = d; best = [x - W.half + 0.5, y - W.half + 0.5]; } }
  return best;
}
/** the first tile of the map whose overlay is a deck (map.over), as world metres; else the spawn */
function deckPoint(ctx: SimContext): [number, number] {
  const W = ctx.world, m = W.map;
  if (m.over) for (let k = 0; k < m.w * m.h; k++) if (m.over[k] > 0 && W.walkable((k % m.w) - W.half + 0.5, Math.floor(k / m.w) - W.half + 0.5)) return [(k % m.w) - W.half + 0.5, Math.floor(k / m.w) - W.half + 0.5];
  return [W.spawn[0], W.spawn[1]];
}
/** fire the kit: primary held, Q and E tapped on their own cadence */
const fire = (tick: number) => mix({ btn: BTN.basic, press: tick % 30 === 0 ? BTN.basic : 0 }, tick % 150 === 40 ? { btn: BTN.a, press: BTN.a } : {}, tick % 210 === 100 ? { btn: BTN.b, press: BTN.b } : {});

export const SCENARIOS: Scenario[] = [
  {
    id: 'range-charmander', covers: 'movement, buffered and coyote jumps, dash, guard, ±89° pitch, primary / Q / E, every target kind',
    mode: RANGE, species: 'charmander', worldgen: arena, targets: RANGE_TARGETS, seconds: 60,
    input: (ctx, t) => {
      if (t < 4 * S) return mix(go(Math.PI), fire(t)); // north into the target field, firing
      if (t < 8 * S) return mix(go(Math.PI * 0.5), t % 40 === 0 ? { dash: true } : {}, fire(t)); // strafe east with dashes
      if (t < 12 * S) return mix(go(-Math.PI * 0.5), jumpAt(t % 50, 0), fire(t)); // west, a jump press every 50 ticks (buffered when it lands)
      if (t < 16 * S) return mix(toward(ctx, 30 - ctx.world.half, 44 - ctx.world.half), jumpAt(t, 15 * S + 30)); // to the terrace
      if (t < 20 * S) return mix(go(Math.PI * 0.5), jumpAt(t, 18 * S)); // off its edge, a late (coyote) press
      if (t < 24 * S) return mix({ btn: BTN.guard }, fire(t)); // guard against the strafer
      if (t < 28 * S) return { ...fire(t), aim: pitchRay(ctx, 89) }; // straight up
      if (t < 32 * S) return { ...fire(t), aim: pitchRay(ctx, -89) }; // straight down
      if (t < 44 * S) return mix(toward(ctx, ctx.world.spawn[0] - 6, ctx.world.spawn[1] - 12), fire(t)); // chase the patrol
      return mix(go((t / S) * 0.6), fire(t)); // circle and fire
    },
  },
  {
    id: 'range-caterpie', covers: 'Breakthrough ×2 (Metapod, Butterfree), the size and traversal change, the status-move Q',
    mode: RANGE, species: 'caterpie', worldgen: arena, targets: RANGE_TARGETS, seconds: 60,
    input: (_ctx, t) => mix(
      t < 5 * S ? go(Math.PI) : {},
      hold(t, 5 * S, 30, BTN.touch), // Breakthrough to Metapod
      hold(t, 20 * S, 30, BTN.touch), // to Butterfree
      t > 26 * S && t < 40 * S ? go(Math.PI * 0.75) : {},
      fire(t),
    ),
  },
  {
    id: 'range-tauros', covers: 'the physical channel, a charge into the field, a Wrap hold on a rock (Power 1 against Weight 2: the hold fails, as the rules say)',
    mode: RANGE, species: 'tauros', worldgen: arena, targets: RANGE_TARGETS, seconds: 60,
    input: (ctx, t) => {
      const B = ctx.bodies;
      let near = -1, nd = 1e9;
      for (let i = 0; i < B.hi; i++) if (B.alive[i]) { const d = (B.x[i] - ctx.player.x) ** 2 + (B.z[i] - ctx.player.z) ** 2; if (d < nd) { nd = d; near = i; } }
      if (t < 10 * S) return mix(go(Math.PI), t % 60 === 0 ? { dash: true } : {}, fire(t));
      if (t < 30 * S && near >= 0) return { ...mix(nd > 9 ? toward(ctx, B.x[near], B.z[near]) : {}, hold(t % (6 * S), 2 * S, 90, BTN.b)), aim: rayAt(ctx, B.x[near], B.y[near] + 0.3, B.z[near]) }; // walk to a body, hold Wrap on it, release (throw)
      return mix(go((t / S) * 0.5), fire(t));
    },
  },
  {
    id: 'range-mewtwo', covers: 'the special channel, Def / SpD, guard deflect of the strafer, a 2 m body, hold and throw a rock with Psychic (E)',
    mode: RANGE, species: 'mewtwo', worldgen: arena, targets: RANGE_TARGETS, seconds: 60,
    input: (ctx, t) => {
      if (t < 20 * S) return mix(toward(ctx, ctx.world.spawn[0] - 10, ctx.world.spawn[1] - 2), t % (5 * S) < 90 ? { btn: BTN.guard } : fire(t)); // guard windows: deflect the strafer
      const B = ctx.bodies, T = ctx.targets!, E = ctx.enemies;
      let near = -1, nd = 1e9;
      for (let i = 0; i < B.hi; i++) if (B.alive[i]) { const d = (B.x[i] - ctx.player.x) ** 2 + (B.z[i] - ctx.player.z) ** 2; if (d < nd) { nd = d; near = i; } }
      if (t < 50 * S && near >= 0) {
        // every 6 s: walk to the nearest rock, hold Psychic on it for 1 s, swing the aim to the Geodude dummy, release
        const c = t % (6 * S), g = T.slot[0];
        if (nd > 16 && c < 2 * S) return toward(ctx, B.x[near], B.z[near]);
        const aim = c < 3 * S || g < 0 ? rayAt(ctx, B.x[near], B.y[near] + 0.3, B.z[near]) : rayAt(ctx, E.x[g], E.y[g] + 0.5, E.z[g]);
        return { ...hold(c, 2 * S, 90, BTN.b), aim };
      }
      return mix(go((t / S) * 0.4), fire(t));
    },
  },
  {
    id: 'mtmoon-onix', covers: 'a giant under Mt. Moon\'s decks (replaces the `deck` set)',
    mode: RANGE, species: 'onix', worldgen: habitat('mt-moon', 5), targets: RANGE_TARGETS, seconds: 60,
    input: (ctx, t) => { const [x, z] = deckPoint(ctx); return mix(t < 40 * S ? route(ctx, 'deck', x, z, 0.9) : go((t / S) * 0.5), fire(t)); },
  },
  {
    id: 'mtmoon-wailord', covers: 'xlTall routing under the 2.9 m decks (replaces `deck-xl`)',
    mode: RANGE, species: 'wailord', worldgen: habitat('mt-moon', 3), targets: RANGE_TARGETS, seconds: 60,
    input: (ctx, t) => { const [x, z] = deckPoint(ctx); return mix(t < 40 * S ? route(ctx, 'deck', x, z, 0.9) : go((t / S) * 0.5), fire(t)); },
  },
  {
    id: 'grotto-totodile', covers: 'swimming, the shore, the tide hazard (Shoal Grotto seed 1)',
    mode: RANGE, species: 'totodile', worldgen: habitat('tidal-cave', 1), targets: HABITAT_TARGETS, seconds: 60,
    input: (ctx, t) => { const [x, z] = tidalPoint(ctx); return mix(t < 40 * S ? route(ctx, 'tide', x, z, 0.45) : go((t / S) * 0.5), fire(t)); },
  },
  {
    id: 'crater-charmander', covers: 'tile burn, coats and cells on the crater habitat (volcanic ridge)',
    mode: RANGE, species: 'charmander', worldgen: habitat('volcanic-ridge', 1), targets: HABITAT_TARGETS, seconds: 60,
    input: (ctx, t) => { const H = ctx.world.hab!, W = ctx.world; return mix(toward(ctx, H.contest.x - W.half + 4 * dsin(t / 90), H.contest.y - W.half + 4 * dcos(t / 90)), fire(t)); },
  },
  {
    id: 'gorge-hold', covers: 'the Hold contract: the point, the Raid party from team B\'s staging (Hold mode)',
    mode: HOLD, species: 'tauros', worldgen: habitat('river-gorge', 1), seconds: 60,
    input: (ctx, t) => { const O = ctx.objective; return mix(O ? toward(ctx, O.x, O.z) : {}, fire(t)); },
  },
  {
    id: 'range-swap', covers: 'the opt-in swap system: a three-member loadout, Tag taps, a Tag Action, grey health',
    mode: RANGE_SWAP, species: 'charmander', loadout: ['caterpie', 'tauros'], worldgen: arena, targets: RANGE_TARGETS, seconds: 60,
    input: (_ctx, t) => mix(go(Math.PI + 0.4 * dsin(t / 120)), hold(t % (8 * S), 4 * S, 3, BTN.sig), fire(t)),
  },
];

export interface ScenarioResult { checkpoints: string[]; end: string }

const hex = (n: number) => (n >>> 0).toString(16).padStart(8, '0');

export function runScenario(s: Scenario): ScenarioResult {
  const ctx = createRun({ mode: s.mode, seed: 1, species: s.species, loadout: s.loadout, targets: s.targets, ruleOverrides: { worldgen: s.worldgen } as never });
  const checkpoints: string[] = [];
  const n = Math.round(s.seconds * S);
  for (let t = 0; t < n; t++) {
    let inp: InputFrame = { ...NO_INPUT, ...s.input(ctx, t) };
    if (!inp.aim) inp = withAim(ctx, inp);
    step(ctx, inp);
    if ((t + 1) % (10 * S) === 0 && t + 1 < n) checkpoints.push(hex(replayHash(ctx)));
  }
  return { checkpoints, end: hex(replayHash(ctx)) };
}
