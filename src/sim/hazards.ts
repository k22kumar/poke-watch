// Habitat hazards (docs/HABITATS.md, docs/HABITAT_STATES.md): vent fields on habitat maps erupt on a fixed cycle of stage time.
//   dormant  safe ground (the validator still keeps every essential route out of the field)
//   warn     steam rises from the vents (rules.habitat.vent.warn s): the escape window for anyone already standing there
//   active   every `tick` s, anything on the ground in the field takes Fire damage and the tiles take Heat
// The phase is a pure function of the sim tick (stage time in whole steps), so a replay, a headless run and every client
// agree on it without sending it, and no boundary depends on how the float stage clock happened to round. On maps
// without a hazard field the system does nothing (replays of other maps are unchanged).
//
// Exposure is one rule for every actor: a creature whose centre is in the field, on the ground (flyers and anything in
// the air pass over: 3D contact), loses `vent.pct` of its maximum HP per damage tick, Fire types excepted (as for a burning
// tile). It does not read the trainer's attack, buffs, crits, hooks or the combat RNG stream (the environment is not a
// move), it is not skipped by hit i-frames (a dash still is), and bosses and alphas take `vent.bossMult` of it.
// Damage ticks fall on the onset step and every `tick` s after it, so an actor still in the field when the eruption
// begins takes the first tick, and the last tick lands `tick` s before the field goes quiet.
import { navWide, partnerRadius } from '../rules/sizing';
import { applyAgent, hurtPlayer, steamAt } from './cells';
import { killEnemy } from './combat';
import { ROLE } from './pools';
import type { Member, SimContext, System } from './types';
import type { World } from './world';
import { faint, onHpLoss } from './squad';
import { rec, setSrc } from './caplog';
import { T } from '../world/tiles';
import { canSwim, traversalOf } from '../rules/profiles';

export type VentPhase = 'dormant' | 'warn' | 'active';

/** the vent cycle in whole sim steps: where the current step falls in it */
function clock(ctx: SimContext) {
  const V = ctx.rules.habitat.vent, hz = ctx.rules.sim.hz;
  const period = Math.round(V.period * hz), active = Math.round(V.active * hz), warn = Math.round(V.warn * hz), tick = Math.max(1, Math.round(V.tick * hz));
  const at = Math.round(ctx.stageTime * hz) % period, activeFrom = period - active, warnFrom = activeFrom - warn;
  return { at, activeFrom, warnFrom, tick, hz };
}

export function ventPhase(ctx: SimContext): VentPhase {
  const c = clock(ctx);
  return c.at < c.warnFrom ? 'dormant' : c.at < c.activeFrom ? 'warn' : 'active';
}

/** true on the first step of the warning (the step the ground cue goes out) */
export function ventWarnOnset(ctx: SimContext): boolean {
  const c = clock(ctx);
  return c.at === c.warnFrom;
}

/** true on the steps where an erupting field hurts: the onset step and every `tick` s after it */
export function ventTick(ctx: SimContext): boolean {
  const c = clock(ctx);
  return c.at >= c.activeFrom && (c.at - c.activeFrom) % c.tick === 0;
}

export const hazardSystem: System = {
  name: 'hazards',
  update(ctx: SimContext) {
    const W = ctx.world;
    if (!W.hazard || !W.hab) return;
    const V = ctx.rules.habitat.vent, phase = ventPhase(ctx);
    if (phase === 'dormant') return;
    // steam over the field: every third vent tile while warning, the whole field while active
    const hz = W.hab.hazard;
    // the warning's ground cue: one hostile ring on EVERY vent tile for the whole warning (the steam alone is a few small
    // particles on a third of the tiles and reads as nothing from a chase camera: docs/HABITAT_PLAYTEST.md)
    if (phase === 'warn' && ventWarnOnset(ctx)) for (const k of hz) ctx.events.push({ t: 'telegraph', x: (k % W.w) - W.half + 0.5, z: ((k / W.w) | 0) - W.half + 0.5, r: 0.85, life: V.warn, hostile: true });
    for (let i = 0; i < hz.length; i++) if (phase === 'active' || i % 3 === 0) steamAt(ctx, hz[i]);
    if (phase !== 'active' || !ventTick(ctx)) return;
    const P = ctx.player;
    if (P.faintT < 0 && W.hazardAt(P.x, P.z) && P.y <= W.height(P.x, P.z) + 0.3 && !traversalOf(P.species, ctx.rules).ventImmune && !P.species.elements.includes('blaze')) {
      const before = P.hp;
      hurtPlayer(ctx, P.maxHp * V.pct, 'vent');
      if (P.hp < before) ctx.events.push({ t: 'hazardHit', kind: 'vent', who: 'player', id: -1, amount: before - P.hp, x: P.x, z: P.z });
    }
    const E = ctx.enemies;
    for (let e = 0; e < E.hi; e++) {
      if (!E.alive[e] || E.spawnT[e] < 0.25 || !W.hazardAt(E.x[e], E.z[e])) continue;
      if (E.y[e] > W.height(E.x[e], E.z[e]) + 0.3) continue; // flyers and anything in the air pass over
      if (ctx.speciesIndex[E.species[e]].elements.includes('blaze')) continue;
      const amount = E.maxHp[e] * V.pct * (E.roles[e] & (ROLE.boss | ROLE.alpha) ? V.bossMult : 1);
      E.hp[e] -= amount;
      E.flash[e] = 0.12;
      ctx.events.push({ t: 'hit', x: E.x[e], y: E.y[e] + E.tall[e], z: E.z[e], amount, crit: false, eff: 1, element: 'blaze', enemy: e });
      ctx.events.push({ t: 'hazardHit', kind: 'vent', who: 'enemy', id: e, amount, x: E.x[e], z: E.z[e] });
      if (E.hp[e] <= 0) killEnemy(ctx, e);
    }
    for (let i = 0; i < hz.length; i += 4) { const k = hz[i]; applyAgent(ctx, 'heat', (k % W.w) - W.half + 0.5, ((k / W.w) | 0) - W.half + 0.5, 0.5); }
  },
};

// ------------------------------------------------------------------ the tide (docs/HABITATS.md "Tide")
// A tidal habitat (HabMeta.tide) runs one cycle of rules.habitat.tide.period s of stage time: low water, then `warn` s of
// warning (still dry), then high water to the end of the cycle. Like the vents, the phase is a pure function of the sim
// tick. At the flood the tidal tiles become open water at the tide's high level and navigation closes over them (the
// Raiders' flow field goes round by the dry approaches); at the ebb they are dry floor again. Nobody is moved: whoever is
// on the tidal floor at the flood is in the water where it stood, and the liquid exposure rule below decides (a Water
// type or anything knowing Surf swims; anyone else has the water's `lethal` s to reach a bank). The cues are sim events:
// `tide` warn (with the seconds left), flood and ebb.

export type TidePhase = 'low' | 'warn' | 'high';

function tideClock(ctx: SimContext) {
  const T0 = ctx.rules.habitat.tide, hz = ctx.rules.sim.hz;
  const period = Math.max(1, Math.round(T0.period * hz)), low = Math.min(period, Math.round(T0.low * hz)), warnEnd = Math.min(period, low + Math.round(T0.warn * hz));
  return { at: Math.round(ctx.stageTime * hz) % period, low, warnEnd, period, hz };
}

export function tidePhase(ctx: SimContext): TidePhase {
  const c = tideClock(ctx);
  return c.at < c.low ? 'low' : c.at < c.warnEnd ? 'warn' : 'high';
}

/** seconds until the next high water begins (0 while the water is high) */
export function tideIn(ctx: SimContext): number {
  const c = tideClock(ctx);
  if (c.at >= c.warnEnd) return 0;
  return (c.warnEnd - c.at) / c.hz;
}

export const tideSystem: System = {
  name: 'tide',
  update(ctx: SimContext) {
    const W = ctx.world;
    if (!W.tide) return;
    const c = tideClock(ctx), high = c.at >= c.warnEnd;
    if (c.at === c.low && c.warnEnd > c.low) ctx.events.push({ t: 'tide', phase: 'warn', in: (c.warnEnd - c.low) / c.hz });
    if (high !== W.tideHigh) {
      W.setTide(high);
      ctx.events.push({ t: 'tide', phase: high ? 'flood' : 'ebb', in: 0 });
    }
  },
};

// ------------------------------------------------------------------ liquids and falls (docs/HAZARDS.md)
// Three questions, answered apart:
//   is something solid in the way?        World.collides (walls, faces above a step, deck slabs); liquids and open air are not
//   is there a supporting surface?        World.support (a chasm tile with no deck at the walker's level has none)
//   what does the hazard do to this body? exposure below: contact from the body's own height (World.liquidAt), then the
//                                         liquid's rule for this Pokémon (safe, or a clock to a knockout)
// One exposure rule for every actor. Contact is the actor's centre with its feet within `contact` of the surface, so a
// body is one sample per tick (overlapping samples cannot count one contact twice). A vulnerable actor loses
// maxHp / lethal per second of simulation time in whole points (the fraction carries to the next tick) and is knocked
// out when the exposure clock reaches `lethal`, healed or not. Elapsed time carries across cells of the same liquid and
// over a hop above it; only standing on supported dry ground (a confirmed exit) or becoming safe ends it. Liquids that
// overlap resolve to the one with the shorter `lethal`. A ground actor that falls below World.killY is knocked out once.

export const LIQUID = { none: 0, water: 1, lava: 2 } as const;
const KIND_NAME = ['', 'water', 'lava'] as const;

const ruleOf = (ctx: SimContext, kind: number) => (kind === LIQUID.lava ? ctx.rules.hazards.lava : ctx.rules.hazards.water);
/** s from first contact to a knockout in this liquid */
export const lethalOf = (ctx: SimContext, kind: number) => ruleOf(ctx, kind).lethal;

/** of two liquids in contact at once, the one that decides the exposure: the shorter lethal time (ties: the first) */
export function dominant(ctx: SimContext, a: number, b: number): number {
  if (!a) return b;
  if (!b) return a;
  return lethalOf(ctx, b) < lethalOf(ctx, a) ? b : a;
}

/** Is a Pokémon of these types and moves safe in this liquid? Water: the Water type (either slot of a dual type) or a
 *  `safeMoves` move in its move set, usable or cooling down (knowing Surf is enough; it need not be pressed). Lava: an
 *  explicit flag only (rules.hazards.lava.safeSpecies; nothing is configured, so every Pokémon is vulnerable). */
export function safeIn(ctx: SimContext, kind: number, species: { id: string; elements: readonly string[] }, moves?: readonly { key: string }[]): boolean {
  const H = ctx.rules.hazards;
  if (kind === LIQUID.water) return canSwim(species, moves, ctx.rules);
  if (kind === LIQUID.lava) return H.lava.safeSpecies.includes(species.id);
  return true;
}
export const memberSafeIn = (ctx: SimContext, kind: number, m: Member) => safeIn(ctx, kind, m.species, m.moves);

/** the liquid the trainer's body is in contact with (0 none) */
export function playerLiquid(ctx: SimContext): number {
  const P = ctx.player, W = ctx.world;
  return W.hazards ? W.liquidAt(P.x, P.z, P.y, ctx.rules.hazards.contact) : 0;
}

/** the walking-speed factor and whether a jump is allowed for the field Pokémon in liquid `kind` */
export function liquidMotion(ctx: SimContext, kind: number): [number, boolean] {
  if (!kind) return [1, true];
  const R = ruleOf(ctx, kind);
  return memberSafeIn(ctx, kind, ctx.player.m) ? [R.safeSpeed, true] : [R.speed, R.jump];
}

/** environment damage to the field Pokémon from a hazard: fixed share of max HP, so it ignores difficulty, Guard and the
 *  dash i-frames (a dash through water is still in the water); it goes through onHpLoss, the squad's faint path */
function hurtByHazard(ctx: SimContext, amount: number) {
  const P = ctx.player;
  if (P.m.fainted || P.faintT >= 0 || amount <= 0) return;
  P.hp = Math.max(0, P.hp - amount);
  P.hurtFlash = 0.2;
  ctx.stats.damageTaken += amount;
  onHpLoss(ctx, amount);
}

/** the trainer's field Pokémon is knocked out by a hazard: one faint through the squad's path; the next one comes in
 *  on the last safe ground */
function knockOutPlayer(ctx: SimContext, kind: 'water' | 'lava' | 'fall') {
  const P = ctx.player;
  if (P.m.fainted || P.faintT >= 0) return;
  setSrc('tile', kind);
  const r = rec(ctx, 'tile', 'hit', true);
  if (r) { r.amount = P.hp; r.tgt = 'player'; r.tgtName = P.species.name; r.type = kind === 'lava' ? 'blaze' : kind === 'water' ? 'tide' : 'plain'; r.x = P.x; r.z = P.z; }
  ctx.events.push({ t: 'hazard', kind, phase: 'ko', who: 'player', id: -1, lethal: 0, x: P.x, z: P.z });
  if (P.hp > 0) ctx.stats.damageTaken += P.hp;
  P.hp = 0;
  P.hzKind = 0; P.hzT = 0; P.hzAcc = 0; P.hzCue = 0; P.hzSafe = 0;
  P.hzRecover = kind;
  faint(ctx);
}

function cuePlayer(ctx: SimContext, kind: number) {
  const P = ctx.player;
  if (P.hzCue <= 0) return;
  const name = KIND_NAME[kind] as 'water' | 'lava';
  setSrc('tile', name);
  const r = rec(ctx, 'tile', 'hit', true);
  if (r) { r.amount = P.hzCue; r.tgt = 'player'; r.tgtName = P.species.name; r.type = kind === LIQUID.lava ? 'blaze' : 'tide'; r.x = P.x; r.z = P.z; }
  ctx.events.push({ t: 'playerHurt', amount: P.hzCue, x: P.x, z: P.z });
  ctx.events.push({ t: 'hazardHit', kind: name, who: 'player', id: -1, amount: P.hzCue, x: P.x, z: P.z });
  P.hzCue = 0;
}

/** Is the ground under (x, z) at `y` supported dry footing with a margin around it (a place to come back to)? */
function safeFooting(ctx: SimContext, x: number, z: number, y: number): boolean {
  const W = ctx.world, c = ctx.rules.hazards.contact;
  for (const [dx, dz] of [[0, 0], [0.6, 0], [-0.6, 0], [0, 0.6], [0, -0.6]]) {
    const g = W.support(x + dx, z + dz, y);
    if (g === -Infinity || Math.abs(g - y) > 0.6 || W.liquidAt(x + dx, z + dz, g, c) || W.wallAt(x + dx, z + dz)) return false;
  }
  return true;
}

function exposePlayer(ctx: SimContext, dt: number) {
  const P = ctx.player, W = ctx.world, H = ctx.rules.hazards;
  if (ctx.state === 'dead') return;
  // the next Pokémon after a hazard knockout comes in on the last safe ground
  if (P.hzRecover && P.faintT < 0 && !P.m.fainted) {
    const kind = P.hzRecover;
    P.hzRecover = '';
    P.x = P.px = P.safeX; P.z = P.pz = P.safeZ; P.y = P.py = W.height(P.safeX, P.safeZ, P.safeY);
    P.vx = P.vz = P.vy = P.kx = P.kz = 0; P.grounded = true; P.dashT = 0;
    ctx.events.push({ t: 'hazard', kind, phase: 'recover', who: 'player', id: -1, lethal: 0, x: P.x, z: P.z });
  }
  if (P.m.fainted || P.faintT >= 0) {
    // a fainted body that fell out of the map waits at the kill plane for the next Pokémon
    if (P.y < W.killY) { P.y = W.killY; P.vy = 0; }
    return;
  }
  // out of the map: a fall with nothing under it
  if (P.y < W.killY) {
    ctx.events.push({ t: 'hazardHit', kind: 'fall', who: 'player', id: -1, amount: P.hp, x: P.x, z: P.z });
    knockOutPlayer(ctx, 'fall');
    return;
  }
  const kind = playerLiquid(ctx);
  if (kind && !memberSafeIn(ctx, kind, P.m)) {
    const prev = P.hzKind;
    const k = dominant(ctx, prev, kind) === kind ? kind : prev;
    if (!prev) {
      P.hzT = 0; P.hzAcc = 0; P.hzCue = 0; P.hzCueT = 0;
      ctx.events.push({ t: 'hazard', kind: KIND_NAME[kind] as 'water' | 'lava', phase: 'enter', who: 'player', id: -1, lethal: lethalOf(ctx, kind), x: P.x, z: P.z });
    }
    P.hzKind = k; P.hzSafe = 0;
    const lethal = lethalOf(ctx, k);
    P.hzT += dt;
    P.hzAcc += (P.maxHp * dt) / lethal;
    const whole = Math.floor(P.hzAcc + 1e-9);
    if (whole > 0) { P.hzAcc -= whole; const before = P.hp; hurtByHazard(ctx, whole); P.hzCue += before - P.hp; }
    P.hzCueT += dt;
    if (P.hzCueT >= H.cueEvery - 1e-9) { P.hzCueT = 0; cuePlayer(ctx, k); }
    if (P.m.fainted) {
      // the drain took the last HP before the deadline: the squad's faint already ran
      cuePlayer(ctx, k);
      ctx.events.push({ t: 'hazard', kind: KIND_NAME[k] as 'water' | 'lava', phase: 'ko', who: 'player', id: -1, lethal: 0, x: P.x, z: P.z });
      P.hzKind = 0; P.hzT = 0; P.hzAcc = 0; P.hzRecover = KIND_NAME[k] as 'water' | 'lava';
      return;
    }
    if (P.hzT >= lethal - 1e-9) { cuePlayer(ctx, k); knockOutPlayer(ctx, KIND_NAME[k] as 'water' | 'lava'); }
    return;
  }
  if (kind) {
    // safe in it: a compatibility change ends any exposure
    if (P.hzKind) { cuePlayer(ctx, P.hzKind); P.hzKind = 0; P.hzT = 0; P.hzAcc = 0; }
    if (!P.hzSafe) { P.hzSafe = kind; ctx.events.push({ t: 'hazard', kind: KIND_NAME[kind] as 'water' | 'lava', phase: 'safe', who: 'player', id: -1, lethal: 0, x: P.x, z: P.z }); }
    return;
  }
  P.hzSafe = 0;
  // no contact: a hop above the liquid keeps the clock; standing on supported dry ground ends it
  const g = W.support(P.x, P.z, P.y);
  const onGround = P.grounded && g !== -Infinity && P.y - g < 0.05;
  if (P.hzKind && onGround) {
    cuePlayer(ctx, P.hzKind);
    ctx.events.push({ t: 'hazard', kind: KIND_NAME[P.hzKind] as 'water' | 'lava', phase: 'exit', who: 'player', id: -1, lethal: 0, x: P.x, z: P.z });
    P.hzKind = 0; P.hzT = 0; P.hzAcc = 0; P.hzCueT = 0;
  }
  // (never on a tidal floor: dry now, it may be under water when the next Pokémon comes in)
  if (onGround && !P.hzKind && !W.tidalAt(P.x, P.z) && safeFooting(ctx, P.x, P.z, P.y)) { P.safeX = P.x; P.safeY = P.y; P.safeZ = P.z; }
}

function exposeEnemies(ctx: SimContext, dt: number) {
  const E = ctx.enemies, W = ctx.world, H = ctx.rules.hazards, c = H.contact;
  for (let e = 0; e < E.hi; e++) {
    if (!E.alive[e]) continue;
    const ground = E.hover[e] === 0;
    if (ground && E.y[e] < W.killY) {
      ctx.events.push({ t: 'hazard', kind: 'fall', phase: 'ko', who: 'enemy', id: e, lethal: 0, x: E.x[e], z: E.z[e] });
      ctx.events.push({ t: 'hazardHit', kind: 'fall', who: 'enemy', id: e, amount: E.hp[e], x: E.x[e], z: E.z[e] });
      E.hp[e] = 0;
      killEnemy(ctx, e);
      continue;
    }
    const kind = ground ? W.liquidAt(E.x[e], E.z[e], E.y[e], c) : 0;
    const sp = ctx.speciesIndex[E.species[e]];
    if (kind && !safeIn(ctx, kind, sp)) {
      if (!E.hzKind[e]) {
        E.hzT[e] = 0; E.hzAcc[e] = 0; E.hzCue[e] = 0; E.hzCueT[e] = 0;
        // the way out: the nearest dry shore with room, on the level it is swimming at
        const s = W.shore(E.x[e], E.z[e], E.foot[e] || E.radius[e], E.y[e]) ?? (E.foot[e] > 0 ? W.nearestFit(E.x[e], E.z[e], E.foot[e], navWide(E.foot[e], ctx.rules), true, E.tall[e]) : W.nearestWalkable(E.x[e], E.z[e]));
        E.hzX[e] = s[0]; E.hzZ[e] = s[1];
        ctx.events.push({ t: 'hazard', kind: KIND_NAME[kind] as 'water' | 'lava', phase: 'enter', who: 'enemy', id: e, lethal: lethalOf(ctx, kind), x: E.x[e], z: E.z[e] });
      }
      const k = dominant(ctx, E.hzKind[e], kind);
      E.hzKind[e] = k;
      const lethal = lethalOf(ctx, k);
      E.hzT[e] += dt;
      E.hzAcc[e] += (E.maxHp[e] * dt) / lethal;
      const whole = Math.floor(E.hzAcc[e] + 1e-6);
      if (whole > 0) { E.hzAcc[e] -= whole; E.hp[e] -= whole; E.hzCue[e] += whole; E.flash[e] = 0.12; }
      E.hzCueT[e] += dt;
      const dead = E.hp[e] <= 0 || E.hzT[e] >= lethal - 1e-6;
      if ((E.hzCueT[e] >= H.cueEvery - 1e-6 || dead) && E.hzCue[e] > 0) {
        const el = k === LIQUID.lava ? 'blaze' : 'tide';
        ctx.events.push({ t: 'hit', x: E.x[e], y: E.y[e] + E.tall[e], z: E.z[e], amount: E.hzCue[e], crit: false, eff: 1, element: el, enemy: e });
        ctx.events.push({ t: 'hazardHit', kind: KIND_NAME[k] as 'water' | 'lava', who: 'enemy', id: e, amount: E.hzCue[e], x: E.x[e], z: E.z[e] });
        E.hzCue[e] = 0; E.hzCueT[e] = 0;
      }
      if (dead) {
        ctx.events.push({ t: 'hazard', kind: KIND_NAME[k] as 'water' | 'lava', phase: 'ko', who: 'enemy', id: e, lethal: 0, x: E.x[e], z: E.z[e] });
        E.hp[e] = 0;
        killEnemy(ctx, e);
      }
      continue;
    }
    if (!E.hzKind[e]) continue;
    // safe in it (compatibility), or out on dry ground with support: the exposure ends
    const g = W.support(E.x[e], E.z[e], E.y[e]);
    if (kind || (g !== -Infinity && E.fallV[e] === 0)) {
      ctx.events.push({ t: 'hazard', kind: KIND_NAME[E.hzKind[e]] as 'water' | 'lava', phase: 'exit', who: 'enemy', id: e, lethal: 0, x: E.x[e], z: E.z[e] });
      E.hzKind[e] = 0; E.hzT[e] = 0; E.hzAcc[e] = 0; E.hzCue[e] = 0;
    }
  }
}

/** Would a ground creature stepping from (ox, oz) to (x, z) walk into a hazard of its own accord? A lethal liquid or open
 *  air it is not already in. Steering stops at the lip; knockback beyond rules.hazards.forcedKnock still carries it over. */
export function avoidsStep(ctx: SimContext, e: number, ox: number, oz: number, x: number, z: number, feet: number): boolean {
  const W = ctx.world;
  if (!W.hazards) return false;
  const k = W.tile(x, z), k0 = W.tile(ox, oz);
  if (k < 0 || k === k0) return false;
  if (W.isVoid(k) && W.support(x, z, feet) === -Infinity) return W.support(ox, oz, feet) !== -Infinity;
  const M = W.map;
  if (M.terrain[k] !== T.water || W.cells.iceAt(k)) return false;
  const kind = W.liquidAt(x, z, W.height(x, z), ctx.rules.hazards.contact);
  if (!kind || W.liquidAt(ox, oz, feet, ctx.rules.hazards.contact)) return false;
  // a deck at the walker's level carries it over the liquid
  if (W.over && W.over[k] > 0 && feet >= W.over[k] - 0.9) return false;
  return !safeIn(ctx, kind, ctx.speciesIndex[ctx.enemies.species[e]]);
}

/** the last shore answer per world: the tile it was asked from and the result. Keyed by the World, so two worlds (two
 *  runs, or two regions of one run) never share an answer, even on maps with the same layout, and an entry goes with its
 *  world (tests/crossrun.test.ts; docs/HAZARDS.md "Shore target") */
const SHORES = new WeakMap<World, { tile: number; x: number; z: number; ok: boolean }>();
/** Where the trainer should head to leave the liquid it is in: the nearest dry shore with room on its level (World.shore),
 *  cached per tile of each world. For drivers of the trainer (the balance bot, scripted routes); null when not in a liquid. */
export function shoreFor(ctx: SimContext): [number, number] | null {
  const P = ctx.player, W = ctx.world;
  if (!playerLiquid(ctx)) return null;
  let c = SHORES.get(W);
  if (!c) SHORES.set(W, (c = { tile: -1, x: 0, z: 0, ok: false }));
  const k = W.tile(P.x, P.z);
  if (k !== c.tile) {
    const s = W.shore(P.x, P.z, partnerRadius(ctx.player.species, ctx.rules), P.y);
    c.tile = k; c.ok = !!s;
    if (s) { c.x = s[0]; c.z = s[1]; }
  }
  return c.ok ? [c.x, c.z] : null;
}

export const exposureSystem: System = {
  name: 'exposure',
  update(ctx: SimContext, dt: number) {
    if (!ctx.world.hazards) return;
    exposePlayer(ctx, dt);
    exposeEnemies(ctx, dt);
  },
};
