// The tide on a tidal habitat (Shoal Grotto, `tidal-cave`; docs/HABITATS.md "Tide"), exercised on the final collision and
// through the real sim:
//   npx tsx scripts/habtide.ts [seed ...]        (default: 1 2 7)
// Every check is tagged `static` (derived from the map, no sim steps) or `live` (the simulation is stepped with real actors).
// tests/habtide.test.ts runs the same checks and asserts every one passes.
//
//   static.gates             every gate passes, in both water states (base = low water, flooded = high water)
//   static.routes            each side's shortest route at low water runs over the tidal floor and saves ≥ 10 %; at high water
//                            the shortest walking route never touches it; a swimmer's route through the flood still exists
//   live.cycle               low → warning → high → low, twice: exact steps, one event each, the tidal floor closes and opens,
//                            the stagings and the point stay open in both waters
//   live.raid-flow           the Raiders' flow field from team B's staging runs over the tidal floor at low water and never at
//                            high water, and reaches the point in both
//   live.raid-party          the real Raid party with the Hold active: on the tidal floor at low water, never at high water;
//                            it reaches the point in both
//   live.warning-escape      the slowest non-swimmer, on the tidal tile farthest from a bank when the warning starts, walks
//                            out before the flood: no water damage
//   live.caught              the same Pokémon still there at the flood: in the water, out by the nearest bank within the
//                            water clock; HP lost and seconds in the water
//   live.caught-stays        one that stays: knocked out at the water clock; the next Pokémon comes in on dry ground that
//                            never floods (not on the tidal floor it last stood on)
//   live.swimmers            high water, a Water type and a non-Water Pokémon that knows Surf take the flooded shortcut from
//                            staging to the point: no exposure, no damage, sooner than the dry route
//   live.raider-caught       a Raider on the shortcut at the flood: in the water, out on a bank (or knocked out), then on to
//                            the point by a dry approach
//   live.hold-high           tide always high (the shortcut never opens): spawn → Hold → retreat by both approaches with the
//                            Raid party live (habplay); the Raiders reach the point
//   live.hold-transition     the default cycle, Hold active across the flood: the Raid party is rerouted and still reaches the
//                            point; nobody on the dry approaches takes water damage
import { createRun, step } from '../src/sim/run';
import { startObjective } from '../src/sim/objectives';
import { spawnEnemy } from '../src/sim/enemies';
import { shoreFor, tidePhase } from '../src/sim/hazards';
import { compileMove } from '../src/sim/moves';
import { addMember } from '../src/sim/squad';
import { ROLE } from '../src/sim/pools';
import { SPECIES } from '../src/rules/species';
import { defaultRules } from '../src/rules/defaults';
import { NO_INPUT, type SimContext } from '../src/sim/types';
import { generateHabitat } from '../src/world/habitat';
import { stateMap, tideExitField, clearance, TIDE_EXIT } from '../src/world/habitat/validate';
import { enemyCore, pathBetween } from '../src/world/locgen/nav';
import { T } from '../src/world/tiles';
import { drive, playHabitat, routeTo } from './habplay';

import { RANGE, swap } from '../src/mods';
import { assertRunning, runEnded } from './lib/ended';
export const RECIPE = 'tidal-cave';
export interface Check { id: string; seed: number; coverage: 'static' | 'live'; ok: boolean; detail: string }
type Tide = Partial<typeof defaultRules.habitat.tide>;

/** a run on the tidal map with nothing else in it: no director spawns, no Hunt or Hold offered on a timer, and the stage's
 *  loose rocks cleared (the scripted driver does not steer round a rock on the tread; a player does) */
export function mkTide(seed: number, species = 'cyndaquil', tide?: Tide): SimContext {
  const ctx = mkRaw(seed, species, tide);
  ctx.bodies.clear();
  return ctx;
}
function mkRaw(seed: number, species: string, tide?: Tide): SimContext {
  return createRun({ mode: RANGE, mods: [swap], seed: 1, species, ruleOverrides: { worldgen: { mode: 'generated', regionSeed: seed, locations: { meadow: RECIPE, dusk: RECIPE, badlands: RECIPE, frost: RECIPE } }, ...(tide ? { habitat: { tide } } : {}) } as never });
}
const ALWAYS_HIGH: Tide = { low: 0, warn: 0 };
const ALWAYS_LOW: Tide = { low: 1e6 };
const centre = (ctx: SimContext, k: number): [number, number] => [(k % ctx.world.w) - ctx.world.half + 0.5, ((k / ctx.world.w) | 0) - ctx.world.half + 0.5];
const tileAt = (ctx: SimContext, p: [number, number]) => Math.floor(p[1]) * ctx.world.w + Math.floor(p[0]);
const place = (ctx: SimContext, k: number) => { const P = ctx.player, [x, z] = centre(ctx, k); P.x = P.px = x; P.z = P.pz = z; P.y = P.py = ctx.world.height(x, z); P.vx = P.vz = P.vy = P.kx = P.kz = 0; P.grounded = true; };
const stepNo = (ctx: SimContext) => Math.round(ctx.stageTime * ctx.rules.sim.hz);
/** nothing else on the map: strays the director still sends are removed (the test actors are kept) */
const quiet = (ctx: SimContext, keep: Set<number> = new Set()) => { const E = ctx.enemies; for (let e = 0; e < E.hi; e++) if (E.alive[e] && !keep.has(e)) E.kill(e); };
/** step until the tide clock reaches stage step `at` */
function until(ctx: SimContext, at: number, each?: () => void) { while (stepNo(ctx) < at) { each?.(); step(ctx, NO_INPUT); } }
const floorTiles = (ctx: SimContext) => { const D = ctx.world.tide!; return [...D.tiles].filter((_, i) => D.terrain[i] !== T.water); };
const hzSteps = (ctx: SimContext, s: number) => Math.round(s * ctx.rules.sim.hz);
/** on the tidal floor itself (a deck over it, such as the gallery's causeway, is not) */
const onFloor = (ctx: SimContext, x: number, z: number, y: number) => ctx.world.tidalAt(x, z) && ctx.world.node(x, z, y) < ctx.world.w * ctx.world.h;
/** offer the Hold and stand on it until it is active (the Raid party leaves team B's staging then) */
function engageHold(ctx: SimContext) {
  const H = ctx.world.hab!;
  place(ctx, tileAt(ctx, [H.contest.x, H.contest.y]));
  startObjective(ctx, 'hold');
  for (let i = 0; i < 30 && ctx.objective!.phase === 'offer'; i++) step(ctx, NO_INPUT);
  return ctx.objective!;
}

/** the slowest playable Pokémon that is not safe in water (no Water type; nobody knows Surf by default) */
export function slowestDry(seed: number): { id: string; speed: number } {
  let best = { id: '', speed: Infinity };
  for (const s of SPECIES.filter((x) => x.playable && !x.elements.includes('tide'))) { const sp = mkTide(seed, s.id).player.derived.speed; if (sp < best.speed) best = { id: s.id, speed: sp }; }
  return best;
}

/** the tidal floor tile farthest (swimming) from a bank at high water, and that bank's direction */
function deepest(ctx: SimContext): { k: number; d: number } {
  const m = ctx.world.map, H = ctx.world.hab!, L = { mask: ctx.world.tide!.mask, low: H.tide!.low, high: H.tide!.high };
  const fm = stateMap(m, 'flooded', { contest: H.contest, stage: H.stage, dropNav: 4, states: ['flooded'], tide: L });
  const d = tideExitField(fm, enemyCore(fm, tileAt(ctx, [H.contest.x, H.contest.y]), 4), L.high);
  let best = -1, bd = -1;
  for (const k of floorTiles(ctx)) if (d[k] !== Infinity && d[k] > bd) { bd = d[k]; best = k; }
  return { k: best, d: bd };
}

// ------------------------------------------------------------------------------------------------------------ static
export function staticChecks(seed: number): Check[] {
  const m = generateHabitat({ recipe: RECIPE, seed }), H = m.gen!.hab!, out: Check[] = [];
  const bad = H.gates.filter((g) => !g.ok);
  const tg = H.gates.filter((g) => g.id.startsWith('tide:') || g.id.endsWith(':flooded') || g.id.endsWith(':base'));
  out.push({ id: 'static.gates', seed, coverage: 'static', ok: !bad.length && tg.length >= 8 && H.attempts === 1 && !H.fallback, detail: bad.length ? bad.map((g) => `${g.id}: ${g.value}`).join('; ') : tg.map((g) => `${g.id}: ${g.value}`).join(' | ') });
  // routes per side on the final collision, the trainer's body
  const n = m.w * m.h, cl = clearance(m), mask = new Uint8Array(n);
  for (const k of H.tide!.tiles) mask[k] = 1;
  const fm = stateMap(m, 'flooded', { contest: H.contest, stage: H.stage, dropNav: 4, states: ['flooded'], tide: { mask, low: H.tide!.low, high: H.tide!.high } }), fcl = clearance(fm);
  const c = Math.floor(H.contest.y) * m.w + Math.floor(H.contest.x);
  const parts: string[] = [];
  let ok = true;
  for (const team of ['A', 'B'] as const) {
    const s = Math.floor(H.stage[team][1]) * m.w + Math.floor(H.stage[team][0]);
    const allow = (C: Float32Array) => { const a = new Uint8Array(C.length); for (let v = 0; v < C.length; v++) a[v] = C[v] >= 0.55 ? 1 : 0; return a; };
    const low = pathBetween(m, s, c, allow(cl)), high = pathBetween(fm, s, c, allow(fcl));
    const onLow = low ? low.filter((v) => v < n && mask[v]).length : 0, onHigh = high ? high.filter((v) => v < n && mask[v]).length : -1;
    const sideOk = !!low && !!high && onLow > 0 && onHigh === 0 && low.length < high.length && (H.metrics[`swim${team}`] ?? -1) > 0;
    ok &&= sideOk;
    parts.push(`${team}: low water ${low?.length ?? '-'} tiles (${onLow} on the tidal floor), high water ${high?.length ?? '-'} (${onHigh} on it), swimmer ${H.metrics[`swim${team}`]}, shortcut saves ${((H.metrics[`shortcut${team}`] ?? 0) * 100).toFixed(0)} %`);
  }
  out.push({ id: 'static.routes', seed, coverage: 'static', ok, detail: parts.join('; ') + `; tidal tiles ${H.tide!.tiles.length}, farthest from a bank ${H.metrics.tideExit} m (limit ${TIDE_EXIT})` });
  return out;
}

// ------------------------------------------------------------------------------------------------------------ live
export function cycleCheck(seed: number): Check {
  const ctx = mkTide(seed), W = ctx.world, H = W.hab!, hz = ctx.rules.sim.hz, TR = ctx.rules.habitat.tide;
  const seen: string[] = [], floor = floorTiles(ctx);
  const open = () => floor.filter((k) => W.isOpen(k)).length;
  const keyOpen = () => [H.stage.A, H.stage.B, [H.contest.x, H.contest.y] as [number, number]].every((p) => W.isOpen(tileAt(ctx, p)));
  const openAt: Record<string, number> = {}, keyAt: Record<string, boolean> = {};
  ctx.hooks.onTick.push((c) => { for (const e of c.events) if (e.t === 'tide') { seen.push(`${e.phase}@${(stepNo(c) / hz).toFixed(3)}`); openAt[e.phase] = open(); keyAt[e.phase] = keyOpen(); } });
  const startOpen = open(), reach0 = W.reachableCount(W.spawn[0], W.spawn[1]);
  let reachHigh = 0;
  for (let i = 0; i < 2 * TR.period * hz + 2; i++) { quiet(ctx); step(ctx, NO_INPUT); if (W.tideHigh && !reachHigh) reachHigh = W.reachableCount(W.spawn[0], W.spawn[1]); }
  const want = [`warn@${TR.low.toFixed(3)}`, `flood@${(TR.low + TR.warn).toFixed(3)}`, `ebb@${TR.period.toFixed(3)}`, `warn@${(TR.period + TR.low).toFixed(3)}`, `flood@${(TR.period + TR.low + TR.warn).toFixed(3)}`, `ebb@${(2 * TR.period).toFixed(3)}`];
  const ok = seen.join() === want.join() && startOpen === floor.length && openAt.warn === floor.length && openAt.flood === 0 && openAt.ebb === floor.length && keyAt.flood && keyAt.ebb && reachHigh < reach0 && reachHigh > 0;
  return { id: 'live.cycle', seed, coverage: 'live', ok, detail: `${seen.join(', ')}; tidal floor open ${startOpen}/${floor.length} → at warn ${openAt.warn}, flood ${openAt.flood}, ebb ${openAt.ebb}; stagings and point open at flood ${keyAt.flood}, ebb ${keyAt.ebb}; walkable from spawn ${reach0} → ${reachHigh} at high water` };
}

/** follow the Raiders' flow field tile by tile from team B's staging: how many tiles of the walk are tidal */
function flowWalk(ctx: SimContext): { tiles: number; tidal: number; arrived: boolean } {
  const W = ctx.world, H = W.hab!, dir: [number, number] = [0, 0];
  let [x, z] = [H.stage.B[0] - W.half, H.stage.B[1] - W.half], y = W.height(x, z), tidal = 0, tiles = 0, last = -1;
  for (let i = 0; i < 2000; i++) {
    if (!W.goalDir(x, z, dir, y)) break;
    x += dir[0] * 0.5; z += dir[1] * 0.5; y = W.height(x, z, y);
    const k = W.tile(x, z);
    if (k !== last) { tiles++; if (onFloor(ctx, x, z, y)) tidal++; last = k; }
  }
  return { tiles, tidal, arrived: Math.hypot(x - (H.contest.x - W.half), z - (H.contest.y - W.half)) < ctx.rules.objectives.hold.radius };
}

export function raidFlowCheck(seed: number): Check {
  const lo = mkTide(seed, 'cyndaquil', ALWAYS_LOW), hi = mkTide(seed, 'cyndaquil', ALWAYS_HIGH);
  step(lo, NO_INPUT); step(hi, NO_INPUT);
  const a = flowWalk(lo), b = flowWalk(hi);
  return { id: 'live.raid-flow', seed, coverage: 'live', ok: a.arrived && b.arrived && a.tidal > 0 && b.tidal === 0 && a.tiles < b.tiles, detail: `team B staging → point along the flow field: low water ${a.tiles} tiles (${a.tidal} tidal) ${a.arrived ? 'arrives' : 'STOPS'}; high water ${b.tiles} tiles (${b.tidal} tidal) ${b.arrived ? 'arrives' : 'STOPS'}` };
}

/** the real Raid party, Hold active, trainer invulnerable on the point: raider steps on the tidal floor, first arrival */
function raidParty(ctx: SimContext, budget = 40): { steps: number; tidal: number; at: number | null; water: number } {
  const W = ctx.world, E = ctx.enemies;
  const O = engageHold(ctx), t0 = ctx.time;
  let steps = 0, tidal = 0, at: number | null = null, water = 0;
  ctx.hooks.onTick.push((c) => { for (const e of c.events) if (e.t === 'hazardHit' && e.who === 'enemy' && (c.enemies.roles[e.id] & ROLE.raider) && e.kind === 'water') water++; });
  while (ctx.time - t0 < budget && O.phase === 'active') {
    assertRunning(ctx, 'habtide raid party');
    ctx.player.iframes = 1; ctx.player.hp = ctx.player.maxHp;
    for (let e = 0; e < E.hi; e++) if (E.alive[e] && !(E.roles[e] & ROLE.raider)) E.kill(e);
    step(ctx, NO_INPUT);
    for (let e = 0; e < E.hi; e++) {
      if (!E.alive[e] || !(E.roles[e] & ROLE.raider)) continue;
      steps++; if (onFloor(ctx, E.x[e], E.z[e], E.y[e])) tidal++;
      if (at === null && Math.hypot(E.x[e] - O.x, E.z[e] - O.z) < ctx.rules.objectives.hold.radius) at = +(ctx.time - t0).toFixed(1);
    }
    if (at !== null && ctx.time - t0 > at + 1) break;
  }
  return { steps, tidal, at, water };
}

export function raidPartyCheck(seed: number): Check {
  const a = raidParty(mkTide(seed, 'cyndaquil', ALWAYS_LOW)), b = raidParty(mkTide(seed, 'cyndaquil', ALWAYS_HIGH));
  return { id: 'live.raid-party', seed, coverage: 'live', ok: a.at !== null && b.at !== null && a.tidal > 0 && b.tidal === 0 && b.water === 0, detail: `Raid party, Hold active: low water ${a.tidal}/${a.steps} raider-steps on the tidal floor, first on the point at ${a.at ?? '-'} s; high water ${b.tidal}/${b.steps} on it (${b.water} water hits), first on the point at ${b.at ?? '-'} s` };
}

/** walk the trainer from where it stands to the nearest tile off the tidal floor, along the final collision */
function walkOut(ctx: SimContext, budget: number): number | null {
  const W = ctx.world, n = W.w * W.h, here = W.tile(ctx.player.x, ctx.player.z), m = W.map, cl = clearance(m);
  // nearest dry tile that never floods, by a walking route at the current water
  let best: number[] | null = null;
  const allow = new Uint8Array(cl.length);
  for (let v = 0; v < cl.length; v++) allow[v] = cl[v] >= 0.45 ? 1 : 0;
  const D = new Int32Array(n).fill(-1), Q = [here];
  D[here] = 0;
  // (a tile whose neighbours are dry too: the driver stops within a metre of its goal, never on the waterline)
  const solid = (a: number) => !W.tide!.mask[a] && W.isOpen(a) && [1, -1, W.w, -W.w].every((o) => !W.tide!.mask[a + o] && W.isOpen(a + o));
  for (let h = 0; h < Q.length; h++) { const a = Q[h]; if (solid(a)) { best = pathBetween(m, here, a, allow); if (best) break; } const x = a % W.w, y = (a / W.w) | 0; for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const b = (y + dy) * W.w + x + dx; if (D[b] < 0 && W.isOpen(b) && Math.abs(W.topOf(b) - W.topOf(a)) <= 0.6) { D[b] = D[a] + 1; Q.push(b); } } }
  if (!best) return null;
  return drive(ctx, best, budget, { n: 0 });
}

export function warningEscapeCheck(seed: number): Check {
  const sp = slowestDry(seed), ctx = mkTide(seed, sp.id), TR = ctx.rules.habitat.tide, deep = deepest(ctx);
  let waterHits = 0;
  const kinds: string[] = [];
  ctx.hooks.onTick.push((c) => { for (const e of c.events) if (e.t === 'hazardHit' && e.who === 'player') { waterHits++; kinds.push(`${e.kind}@${c.stageTime.toFixed(2)}`); } });
  until(ctx, hzSteps(ctx, TR.low) - 1, () => quiet(ctx));
  place(ctx, deep.k);
  step(ctx, NO_INPUT); // the warning goes out on this step
  const out = walkOut(ctx, TR.warn + 4);
  until(ctx, hzSteps(ctx, TR.low + TR.warn), () => quiet(ctx));
  const dry = !ctx.world.tidalAt(ctx.player.x, ctx.player.z); // where it stands when the water comes in
  until(ctx, hzSteps(ctx, TR.low + TR.warn) + 30, () => quiet(ctx));
  const ok = out !== null && out < TR.warn && dry && waterHits === 0 && ctx.player.hzKind === 0;
  return { id: 'live.warning-escape', seed, coverage: 'live', ok, detail: `${sp.id} (${sp.speed.toFixed(2)} m/s) on the tidal tile farthest from a bank (${deep.d.toFixed(1)} m swim at high water) when the warning starts: off the tidal floor after ${out?.toFixed(2) ?? '-'} s of the ${TR.warn} s warning, ${waterHits} water hits ${kinds.join(' ')}` };
}

export function caughtCheck(seed: number): Check {
  const sp = slowestDry(seed), ctx = mkTide(seed, sp.id), TR = ctx.rules.habitat.tide, W = ctx.world, P = ctx.player, deep = deepest(ctx);
  let enter = null as number | null, lethal = 0, exit = null as number | null;
  ctx.hooks.onTick.push((c) => { for (const e of c.events) if (e.t === 'hazard' && e.who === 'player') { if (e.phase === 'enter' && enter === null) { enter = c.time; lethal = e.lethal; } if (e.phase === 'exit' && exit === null) exit = c.time; } });
  until(ctx, hzSteps(ctx, TR.low + TR.warn) - 1, () => { quiet(ctx); place(ctx, deep.k); });
  step(ctx, NO_INPUT); // the flood
  const hp0 = P.maxHp, t0 = ctx.time, inWater = !!P.hzKind;
  // out by the nearest bank (World.shore, as a player would head for the nearest dry ground)
  for (let i = 0; i < hzSteps(ctx, 8) && shoreFor(ctx); i++) { quiet(ctx); const s = shoreFor(ctx)!, dx = s[0] - P.x, dz = s[1] - P.z, L = Math.hypot(dx, dz) || 1; step(ctx, { ...NO_INPUT, mx: dx / L, mz: dz / L }); }
  for (let i = 0; i < 30; i++) step(ctx, NO_INPUT);
  const lost = (hp0 - P.hp) / hp0, alive = !P.m.fainted && ctx.player.m === P.m;
  const ok = inWater && enter !== null && exit !== null && alive && P.hzKind === 0 && W.map.terrain[W.tile(P.x, P.z)] !== T.water && (exit! - t0) < lethal;
  return { id: 'live.caught', seed, coverage: 'live', ok, detail: `${sp.id} still on the farthest tile at the flood: in the water (${lethal} s clock), out on a bank after ${exit !== null ? (exit - t0).toFixed(2) : '-'} s, ${(lost * 100).toFixed(0)} % of its HP lost, ${alive ? 'still in the fight' : 'KNOCKED OUT'}` };
}

export function caughtStaysCheck(seed: number): Check {
  const sp = slowestDry(seed), ctx = mkTide(seed, sp.id), TR = ctx.rules.habitat.tide, W = ctx.world, P = ctx.player, deep = deepest(ctx);
  addMember(ctx, 'charmander'); // the next Pokémon in the squad
  const first = P.m;
  let ko = null as number | null, rec = null as [number, number] | null;
  ctx.hooks.onTick.push((c) => { for (const e of c.events) if (e.t === 'hazard' && e.who === 'player') { if (e.phase === 'ko' && ko === null) ko = c.time; if (e.phase === 'recover' && !rec) rec = [e.x, e.z]; } });
  // it walked there over the dry tidal floor at low water (so its last footing is on the floor), and stays
  until(ctx, hzSteps(ctx, TR.low) - 1, () => quiet(ctx));
  const k0 = deep.k;
  place(ctx, k0);
  for (let i = 0; i < 30; i++) step(ctx, NO_INPUT); // standing on the dry tidal floor
  until(ctx, hzSteps(ctx, TR.low + TR.warn), () => quiet(ctx));
  const t0 = ctx.time;
  for (let i = 0; i < hzSteps(ctx, 9) && !rec; i++) { quiet(ctx); step(ctx, NO_INPUT); }
  for (let i = 0; i < 60; i++) { quiet(ctx); step(ctx, NO_INPUT); }
  const lethal = ctx.rules.hazards.water.lethal;
  const recDry = !!rec && !W.tidalAt(rec[0], rec[1]) && W.map.terrain[W.tile(rec[0], rec[1])] !== T.water;
  const ok = ko !== null && Math.abs(ko - t0 - lethal) < 0.05 && first.fainted && recDry && P.hzKind === 0 && ctx.state !== 'dead';
  return { id: 'live.caught-stays', seed, coverage: 'live', ok, detail: `${sp.id} stays on the farthest tile: knocked out ${ko !== null ? (ko - t0).toFixed(2) : '-'} s after the flood (water clock ${lethal} s); the next Pokémon came in at ${rec ? rec.map((v) => v.toFixed(1)).join(',') : '-'} (${recDry ? 'dry ground that never floods' : 'ON THE TIDAL FLOOR'}), not exposed afterwards: ${P.hzKind === 0}` };
}

/** high water: drive a swimmer from staging A to the point along the swimmer's route through the flood */
function swimRun(seed: number, species: string, surf: boolean): { t: number | null; exposed: number; hits: number; wet: number; dryT: number | null } {
  const ctx = mkTide(seed, species, ALWAYS_HIGH), W = ctx.world, H = W.hab!, P = ctx.player;
  if (surf) P.m.moves.push({ key: 'surf', level: 1, cd: 9, spec: { ...compileMove(ctx.rules, P.m.moves[0].key), key: 'surf', name: 'Surf' }, uses: 0 } as never);
  step(ctx, NO_INPUT);
  let exposed = 0, hits = 0, wet = 0;
  ctx.hooks.onTick.push((c) => { for (const e of c.events) { if (e.t === 'hazard' && e.who === 'player' && e.phase === 'enter') exposed++; if (e.t === 'hazardHit' && e.who === 'player') hits++; } if (c.world.map.terrain[c.world.tile(c.player.x, c.player.z)] === T.water) wet++; });
  // the swimmer's route: water tiles of the flood are passable at the surface (validate.ts swimPath's rule, as a node path)
  const m = W.map, n = m.w * m.h, s = tileAt(ctx, H.stage.A), c = tileAt(ctx, [H.contest.x, H.contest.y]), cl = clearance(m);
  const D = new Int32Array(n).fill(-1), prev = new Int32Array(n).fill(-1), Q = [s];
  const water = (k: number) => m.terrain[k] === T.water && W.tide!.mask[k] === 1;
  const top = (k: number) => (water(k) ? H.tide!.high : W.topOf(k));
  D[s] = 0;
  for (let h = 0; h < Q.length && D[c] < 0; h++) { const a = Q[h], x = a % m.w, y = (a / m.w) | 0; for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const b = (y + dy) * m.w + x + dx; if (D[b] >= 0 || !(water(b) || (W.isOpen(b) && cl[b] >= 0.55))) continue; const dh = top(b) - top(a); if (Math.abs(dh) > (water(a) || water(b) ? 0.8 : 0.6) && !(water(b) && dh < 0)) continue; D[b] = D[a] + 1; prev[b] = a; Q.push(b); } }
  if (D[c] < 0) return { t: null, exposed, hits, wet, dryT: null };
  const path: number[] = [];
  for (let k = c; k >= 0; k = prev[k]) path.unshift(k);
  const t = driveLine(ctx, path, 40);
  // the same Pokémon's dry route at high water, for comparison
  const c2 = mkTide(seed, species, ALWAYS_HIGH);
  step(c2, NO_INPUT);
  const dryPath = routeTo(c2, tileAt(c2, H.stage.A), tileAt(c2, [H.contest.x, H.contest.y]));
  const dryT = dryPath ? drive(c2, dryPath, 60, { n: 0 }, () => quiet(c2)) : null;
  return { t, exposed, hits, wet, dryT };
}

/** steer straight at each node in turn (water allowed: habplay's driver refuses lines over water) */
function driveLine(ctx: SimContext, path: number[], budget: number): number | null {
  const P = ctx.player, t0 = ctx.time;
  let i = 0;
  while (ctx.time - t0 < budget) {
    if (runEnded(ctx)) return null;
    quiet(ctx);
    while (i < path.length - 1) { const [x, z] = centre(ctx, path[i]); if (Math.hypot(x - P.x, z - P.z) < 0.9) i++; else break; }
    const [tx, tz] = centre(ctx, path[Math.min(path.length - 1, i + 1)]);
    if (i >= path.length - 2 && Math.hypot(tx - P.x, tz - P.z) < 1.2) return ctx.time - t0;
    const dx = tx - P.x, dz = tz - P.z, L = Math.hypot(dx, dz) || 1;
    step(ctx, { ...NO_INPUT, mx: dx / L, mz: dz / L });
    if (ctx.state === 'dead') return null;
  }
  return null;
}

export function swimmersCheck(seed: number): Check {
  const a = swimRun(seed, 'totodile', false), b = swimRun(seed, 'cyndaquil', true);
  const good = (r: typeof a) => r.t !== null && r.dryT !== null && r.exposed === 0 && r.hits === 0 && r.wet > 0 && r.t < r.dryT;
  return { id: 'live.swimmers', seed, coverage: 'live', ok: good(a) && good(b), detail: `high water, staging A → point through the flood: Water type (totodile) ${a.t?.toFixed(1) ?? '-'} s (${(a.wet / 60).toFixed(1)} s swimming, ${a.exposed} exposures, ${a.hits} hits) vs its dry route ${a.dryT?.toFixed(1) ?? '-'} s; non-Water with Surf (cyndaquil) ${b.t?.toFixed(1) ?? '-'} s (${(b.wet / 60).toFixed(1)} s swimming, ${b.exposed} exposures, ${b.hits} hits) vs ${b.dryT?.toFixed(1) ?? '-'} s` };
}

export function raiderCaughtCheck(seed: number): Check {
  const ctx = mkTide(seed), TR = ctx.rules.habitat.tide, W = ctx.world, H = W.hab!, E = ctx.enemies;
  // a tile of team B's low-water shortcut (its flow field) a few tiles past the point where it reaches the floor
  const dir: [number, number] = [0, 0];
  step(ctx, NO_INPUT);
  let [x, z] = [H.stage.B[0] - W.half, H.stage.B[1] - W.half], y = W.height(x, z), pick = -1, on = 0;
  for (let i = 0; i < 2000 && W.goalDir(x, z, dir, y); i++) { x += dir[0] * 0.5; z += dir[1] * 0.5; y = W.height(x, z, y); if (W.tidalAt(x, z)) { on++; if (on === 24) { pick = W.tile(x, z); break; } } }
  until(ctx, hzSteps(ctx, TR.low + TR.warn) - 40, () => quiet(ctx));
  const O = engageHold(ctx);
  quiet(ctx);
  const [rx, rz] = centre(ctx, pick), r = spawnEnemy(ctx, 'rattata', rx, rz, ROLE.raider), spawnStep = stepNo(ctx);
  let entered = false, exitT = null as number | null, at = null as number | null, flood = 0;
  ctx.hooks.onTick.push((c) => { for (const e of c.events) { if (e.t === 'tide' && e.phase === 'flood') flood = c.time; if (e.t === 'hazard' && e.who === 'enemy' && e.id === r) { if (e.phase === 'enter') entered = true; if (e.phase === 'exit' && exitT === null) exitT = c.time; } } });
  for (let i = 0; i < hzSteps(ctx, 40) && E.alive[r] && at === null; i++) {
    ctx.player.iframes = 1; ctx.player.hp = ctx.player.maxHp;
    quiet(ctx, new Set([r]));
    step(ctx, NO_INPUT);
    if (O.phase === 'active' && Math.hypot(E.x[r] - O.x, E.z[r] - O.z) < ctx.rules.objectives.hold.radius) at = ctx.time - flood;
  }
  const ok = pick >= 0 && entered && (exitT !== null || !E.alive[r]) && (at !== null || !E.alive[r]);
  return { id: 'live.raider-caught', seed, coverage: 'live', ok, detail: `a rattata Raider on team B's shortcut ${((hzSteps(ctx, TR.low + TR.warn) - spawnStep) / 60).toFixed(2)} s before the flood: ${entered ? 'in the water at the flood' : 'NEVER IN THE WATER'}, ${exitT !== null ? `out on a bank ${(exitT - flood).toFixed(2)} s later` : E.alive[r] ? 'STILL IN THE WATER' : 'knocked out by the water'}; ${at !== null ? `on the point ${at.toFixed(1)} s after the flood by a dry approach` : E.alive[r] ? 'NEVER REACHED THE POINT' : '-'}` };
}

export function holdHighCheck(seed: number): Check {
  const runs = playHabitat(RECIPE, seed, { raid: true, prepare: (ctx) => {
    ctx.bodies.clear();
    // this run only (a fresh rules object: the defaults are shared by every run in the process)
    (ctx as { rules: unknown }).rules = { ...ctx.rules, habitat: { ...ctx.rules.habitat, tide: { ...ctx.rules.habitat.tide, ...ALWAYS_HIGH } } };
    step(ctx, NO_INPUT);
  } });
  const ok = runs.length === 2 && runs.every((r) => r.reach !== null && r.raidAt !== null && r.back !== null && r.trainerHits === 0);
  return { id: 'live.hold-high', seed, coverage: 'live', ok, detail: runs.map((r) => `${r.route}: reach ${r.reach?.toFixed(1) ?? '-'} s, raiders on the point at ${r.raidAt ?? '-'} s, back ${r.back?.toFixed(1) ?? '-'} s, trainer env hits ${r.trainerHits}`).join('; ') + ' (tide always high: the shortcut never opens)' };
}

export function holdTransitionCheck(seed: number): Check {
  const ctx = mkTide(seed), TR = ctx.rules.habitat.tide, W = ctx.world, H = W.hab!, E = ctx.enemies;
  until(ctx, hzSteps(ctx, TR.low + TR.warn - 5), () => quiet(ctx));
  const O = engageHold(ctx);
  let onFloorAtFlood = 0, reachedAfter = 0, flood = 0, waterRaid = 0;
  const arrived = new Set<number>();
  ctx.hooks.onTick.push((c) => { for (const e of c.events) { if (e.t === 'tide' && e.phase === 'flood') { flood = c.time; for (let i = 0; i < E.hi; i++) if (E.alive[i] && E.roles[i] & ROLE.raider && onFloor(c, E.x[i], E.z[i], E.y[i])) onFloorAtFlood++; } if (e.t === 'hazardHit' && e.who === 'enemy' && E.roles[e.id] & ROLE.raider) waterRaid++; } });
  for (let i = 0; i < hzSteps(ctx, 40) && O.phase === 'active'; i++) {
    ctx.player.iframes = 1; ctx.player.hp = ctx.player.maxHp;
    for (let e = 0; e < E.hi; e++) if (E.alive[e] && !(E.roles[e] & ROLE.raider)) E.kill(e);
    step(ctx, NO_INPUT);
    for (let e = 0; e < E.hi; e++) if (E.alive[e] && E.roles[e] & ROLE.raider && !arrived.has(e) && Math.hypot(E.x[e] - O.x, E.z[e] - O.z) < ctx.rules.objectives.hold.radius) { arrived.add(e); if (flood && ctx.time > flood) reachedAfter++; }
  }
  const ok = flood > 0 && arrived.size > 0 && reachedAfter > 0;
  return { id: 'live.hold-transition', seed, coverage: 'live', ok, detail: `Hold started 5 s before the flood (${tidePhase(ctx)} now): ${onFloorAtFlood} raiders on the tidal floor at the flood, ${waterRaid} water hits on raiders, ${arrived.size} raiders reached the point (${reachedAfter} after the flood, by the dry approaches)` };
}

export function tideChecks(seed: number): Check[] {
  return [...staticChecks(seed), cycleCheck(seed), raidFlowCheck(seed), raidPartyCheck(seed), warningEscapeCheck(seed), caughtCheck(seed), caughtStaysCheck(seed), swimmersCheck(seed), raiderCaughtCheck(seed), holdHighCheck(seed), holdTransitionCheck(seed)];
}

if (process.argv[1]?.endsWith('habtide.ts')) {
  const seeds = process.argv.slice(2).map(Number).filter((s) => Number.isFinite(s));
  let ok = 0, total = 0;
  for (const s of seeds.length ? seeds : [1, 2, 7]) for (const c of tideChecks(s)) {
    total++; if (c.ok) ok++;
    console.log(`${c.ok ? 'ok  ' : 'FAIL'} seed ${c.seed} ${c.id.padEnd(22)} [${c.coverage}] ${c.detail}`);
  }
  console.log(`\n${ok}/${total} tide checks passed`);
}
