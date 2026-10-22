// Surface states on the 1 m tile grid (blueprint section 7, "cell reactions").
//
// Four agents arrive from moves, enemy shots and the cells themselves: Heat, Wet, Cold and Charge.
// They follow the chemistry rules:
//   1. agents change the state of a cell (and of the creatures standing on it)
//   2. agents change each other (water puts out fire; cold freezes wet ground; charge runs through water)
// The states: Wet (30 s), Burning (tall grass, 4 s, spreads), Frozen (water or wet ground, 12 s,
// walkable and slippery), Ash (45 s, then the grass regrows), Rubble (20 s, slows). Charge is a 0.5 s
// pulse that floods connected Wet and Water cells (up to 30) and stuns whatever stands on them;
// airborne bodies and Electric types are immune, so Jump is the answer.
// Everything decays, the active-cell list is capped, and all randomness uses the world RNG stream.

import type { Element } from '../rules/elements';
import { T, type ArenaMap } from '../world/tiles';
import { applyAilment } from './combat';
import { AG } from '../rules/reactions';
import { ccApply, coatEnemy, coatMember } from './coats';
import { onHpLoss } from './squad';
import { ROLE } from './pools';
import type { SimContext } from './types';
import { rec, setSrc } from './caplog';
import { propAgent, propPass } from './props';

/** bramble (Phase 8b): a Grass patch made by Burrow; slows enemies that are not Grass type and burns like tall grass */
export const CS = { none: 0, wet: 1, burning: 2, frozen: 3, ash: 4, rubble: 5, bramble: 6 } as const;
export type Agent = 'heat' | 'wet' | 'cold' | 'charge';

const BUDGET = 2000;
const PASS_EVERY = 6; // ticks: the reaction pass runs at 10 Hz

export class CellField {
  readonly w: number; readonly h: number; readonly half: number;
  readonly state: Uint8Array;
  readonly timer: Float32Array;
  /** Charge pulse time left (overlay on Wet / Water) */
  readonly charge: Float32Array;
  /** steam puff time left (cosmetic overlay) */
  readonly steam: Float32Array;
  readonly terrain: Uint8Array;
  private active: Int32Array;
  inList: Uint8Array;
  nActive = 0;
  /** queued discharges from Electric creatures standing in water: [time, x, z] */
  pending: number[] = [];
  /** set when a frozen water tile thaws or freezes (navigation must be rebuilt) */
  navDirty = false;
  /** burning tiles at the last reaction pass, and a signature of which (the flow field is rebuilt when it changes) */
  burning = 0;
  burnSig = 0;

  constructor(map: ArenaMap) {
    this.w = map.w; this.h = map.h; this.half = map.w / 2;
    const n = this.w * this.h;
    this.state = new Uint8Array(n); this.timer = new Float32Array(n);
    this.charge = new Float32Array(n); this.steam = new Float32Array(n);
    this.terrain = map.terrain;
    this.active = new Int32Array(BUDGET); this.inList = new Uint8Array(n);
  }

  tile(x: number, z: number): number {
    const i = Math.floor(x + this.half), j = Math.floor(z + this.half);
    if (i < 0 || j < 0 || i >= this.w || j >= this.h) return -1;
    return j * this.w + i;
  }
  isWater(k: number) { return this.terrain[k] === T.water; }
  isGrass(k: number) { return this.terrain[k] === T.tall; }
  /** a water tile currently frozen into ice */
  iceAt(k: number) { return k >= 0 && this.state[k] === CS.frozen && this.terrain[k] === T.water; }
  at(x: number, z: number) { const k = this.tile(x, z); return k < 0 ? CS.none : this.state[k]; }

  private activate(k: number): boolean {
    if (this.inList[k]) return true;
    if (this.nActive >= BUDGET) return false;
    this.inList[k] = 1;
    this.active[this.nActive++] = k;
    return true;
  }
  set(k: number, s: number, t: number) {
    if (!this.activate(k)) return;
    const wasIce = this.iceAt(k);
    this.state[k] = s; this.timer[k] = t;
    if (wasIce !== this.iceAt(k)) this.navDirty = true;
  }
  activeList() { return this.active.subarray(0, this.nActive); }
}

export function agentOf(el: Element): Agent | null {
  return el === 'blaze' ? 'heat' : el === 'tide' ? 'wet' : el === 'frost' ? 'cold' : el === 'volt' ? 'charge' : null;
}

/** Apply an agent to every cell within r of (x, z). */
export function applyAgent(ctx: SimContext, agent: Agent | null, x: number, z: number, r: number) {
  if (!agent) return;
  const C = ctx.world.cells;
  const r2 = Math.max(0.5, r) ** 2;
  const i0 = Math.floor(x - r + C.half), i1 = Math.floor(x + r + C.half);
  const j0 = Math.floor(z - r + C.half), j1 = Math.floor(z + r + C.half);
  for (let j = Math.max(0, j0); j <= Math.min(C.h - 1, j1); j++) {
    for (let i = Math.max(0, i0); i <= Math.min(C.w - 1, i1); i++) {
      const cx = i - C.half + 0.5, cz = j - C.half + 0.5;
      if ((cx - x) ** 2 + (cz - z) ** 2 > r2) continue;
      react(ctx, j * C.w + i, agent);
    }
  }
}

const WET_TIME = 30, BURN_TIME = 4, FROZEN_TIME = 12, ASH_TIME = 45, RUBBLE_TIME = 20, CHARGE_TIME = 0.5, STEAM_TIME = 2;

/** One agent arriving at one cell: the reaction table. */
function react(ctx: SimContext, k: number, agent: Agent) {
  const C = ctx.world.cells;
  // W4: a material prop on the tile takes the agent by the same table (rules/surfaces.ts)
  if (ctx.rules.surfaces.enabled) propAgent(ctx, k, agent);
  if (ctx.world.map.wall[k]) return;
  const s = C.state[k], water = C.isWater(k), grass = C.isGrass(k);
  const wetTime = ctx.world.biome.id === 'badlands' ? 8 : WET_TIME;
  switch (agent) {
    case 'heat':
      if (s === CS.frozen) { C.set(k, water ? CS.none : CS.wet, water ? 0 : 10); steamAt(ctx, k); ctx.events.push({ t: 'cell', k, change: 'thaw' }); }
      else if (s === CS.wet || water) { if (s === CS.wet) C.set(k, CS.none, 0); steamAt(ctx, k); }
      else if (s === CS.burning) C.timer[k] = Math.max(C.timer[k], BURN_TIME);
      else if ((grass && s === CS.none) || s === CS.bramble) { C.set(k, CS.burning, BURN_TIME); ctx.events.push({ t: 'cell', k, change: 'ignite' }); }
      break;
    case 'wet':
      if (water || s === CS.frozen) break;
      if (s === CS.burning) { C.set(k, CS.wet, wetTime); steamAt(ctx, k); ctx.events.push({ t: 'cell', k, change: 'douse' }); }
      else if (s === CS.none || s === CS.wet || s === CS.ash) C.set(k, CS.wet, wetTime);
      break;
    case 'cold':
      if (s === CS.burning) { C.set(k, CS.ash, ASH_TIME); steamAt(ctx, k); }
      else if (s === CS.frozen) C.timer[k] = Math.max(C.timer[k], FROZEN_TIME);
      else if (water || s === CS.wet) { C.set(k, CS.frozen, FROZEN_TIME); freezeCreatures(ctx, k); ctx.events.push({ t: 'cell', k, change: 'freeze' }); }
      break;
    case 'charge':
      if ((water && s !== CS.frozen) || s === CS.wet) flood(ctx, k);
      break;
  }
}

function steamAt(ctx: SimContext, k: number) {
  const C = ctx.world.cells;
  C.steam[k] = STEAM_TIME;
  C.set(k, C.state[k], C.timer[k]); // keep it in the active list for the steam timer
}

/** the agent a tile puts on whatever stands on it: water and wet ground Wet, fire Heat, ice Cold, a charge pulse Charge */
function tileAgent(C: CellField, k: number, charged: boolean): number {
  if (charged) return AG.charge;
  const s = C.state[k];
  if (s === CS.burning) return AG.heat;
  if (s === CS.frozen) return AG.cold;
  if (s === CS.wet || C.isWater(k)) return AG.wet;
  return 0;
}

/** Charge runs through connected Wet and Water cells, at most 30, as one pulse. */
function flood(ctx: SimContext, start: number) {
  const C = ctx.world.cells;
  const conducts = (k: number) => (C.isWater(k) && C.state[k] !== CS.frozen) || C.state[k] === CS.wet;
  const seen = new Set<number>([start]);
  const queue = [start];
  let n = 0;
  while (queue.length && n < 30) {
    const k = queue.shift()!;
    if (C.charge[k] > 0.1) continue; // already pulsing
    C.charge[k] = CHARGE_TIME; C.set(k, C.state[k], C.timer[k]); n++;
    const i = k % C.w, j = (k / C.w) | 0;
    for (const nk of [i > 0 ? k - 1 : -1, i < C.w - 1 ? k + 1 : -1, j > 0 ? k - C.w : -1, j < C.h - 1 ? k + C.w : -1]) {
      if (nk < 0 || seen.has(nk) || !conducts(nk)) continue;
      seen.add(nk); queue.push(nk);
    }
  }
  if (n) ctx.events.push({ t: 'cell', k: start, change: 'charge' });
}

/** Wet ground freezing under a creature locks it in ice for 1.2 s (Ice types and bosses resist). */
function freezeCreatures(ctx: SimContext, k: number) {
  const C = ctx.world.cells, E = ctx.enemies;
  const cx = (k % C.w) - C.half + 0.5, cz = ((k / C.w) | 0) - C.half + 0.5;
  const n = ctx.grid.query(cx, cz, 1.5);
  for (let q = 0; q < n; q++) {
    const e = ctx.grid.result[q];
    if (!E.alive[e] || E.hover[e] > 0 || C.tile(E.x[e], E.z[e]) !== k) continue;
    if (ctx.speciesIndex[E.species[e]].elements.includes('frost')) continue;
    const t = ccApply(ctx, e, E.roles[e] & (ROLE.boss | ROLE.alpha) ? 0.3 : 1.2);
    if (t > 0) { E.stun[e] = Math.max(E.stun[e], t); E.frozen[e] = Math.max(E.frozen[e], t); }
  }
}

/** Phase 8b Burrow (Create): a Grass patch of radius r on open ground; returns the tiles it covered */
export function brambleAt(ctx: SimContext, x: number, z: number, r: number): number {
  const C = ctx.world.cells, B = ctx.rules.build;
  let n = 0;
  const ri = Math.ceil(r);
  for (let dz = -ri; dz <= ri; dz++) for (let dx = -ri; dx <= ri; dx++) {
    if (dx * dx + dz * dz > r * r) continue;
    const k = C.tile(x + dx, z + dz);
    if (k < 0 || ctx.world.map.wall[k] || C.isWater(k)) continue;
    const st = C.state[k];
    if (st === CS.none || st === CS.wet || st === CS.ash || st === CS.bramble) { C.set(k, CS.bramble, B.brambleTime); n++; }
  }
  return n;
}

/** Rubble left by a broken boulder: a patch that slows anything not Rock, Ground or Steel. */
export function rubbleAt(ctx: SimContext, x: number, z: number, r: number) {
  const C = ctx.world.cells;
  for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
    const k = C.tile(x + dx, z + dz);
    if (k < 0 || ctx.world.map.wall[k] || C.isWater(k)) continue;
    if (C.state[k] === CS.none || C.state[k] === CS.wet || C.state[k] === CS.ash) C.set(k, CS.rubble, RUBBLE_TIME);
  }
}

const HARD: Element[] = ['stone', 'quake', 'alloy'];
const F_ICE: [number, number] = [1, 0.2], F_RUBBLE: [number, number] = [0.7, 1], F_NONE: [number, number] = [1, 1];
/** movement multiplier and slipperiness for a creature at (x, z): [speed, grip]. A Grass patch (Burrow) slows
 *  enemies that are not Grass type; the trainer's own Pokémon walk through it. */
export function footing(ctx: SimContext, x: number, z: number, elements: readonly Element[], enemy = false): [number, number] {
  const s = ctx.world.cells.at(x, z);
  if (s === CS.frozen) return F_ICE;
  if (s === CS.rubble && !elements.some((e) => HARD.includes(e))) return F_RUBBLE;
  if (s === CS.bramble && enemy && !elements.includes('bloom')) return [ctx.rules.build.brambleSlow, 1];
  return F_NONE;
}

// ------------------------------------------------------------------ system
export const cellSystem = {
  name: 'cells',
  update(ctx: SimContext, dt: number) {
    const C = ctx.world.cells;
    // queued discharges from Electric creatures standing in water
    for (let q = C.pending.length - 3; q >= 0; q -= 3) {
      if (C.pending[q] > ctx.time) continue;
      applyAgent(ctx, 'charge', C.pending[q + 1], C.pending[q + 2], 0.8);
      C.pending.splice(q, 3);
    }
    if (ctx.tick % PASS_EVERY !== 0) return;
    const pdt = dt * PASS_EVERY;
    const passN = (ctx.tick / PASS_EVERY) | 0;
    const list = C.activeList();
    const n0 = C.nActive;
    // timers and spread; rebuild the active list in place (deterministic order)
    let w = 0;
    const act = list;
    const ignite: number[] = [];
    let nBurn = 0, sig = 0;
    for (let q = 0; q < n0; q++) {
      const k = act[q];
      let s = C.state[k];
      if (C.charge[k] > 0) C.charge[k] = Math.max(0, C.charge[k] - pdt);
      if (C.steam[k] > 0) C.steam[k] = Math.max(0, C.steam[k] - pdt);
      if (s !== CS.none) {
        C.timer[k] -= pdt;
        if (s === CS.burning) {
          // fire spreads to neighbouring dry tall grass, about two cells a second
          const i = k % C.w, j = (k / C.w) | 0;
          for (const nk of [i > 0 ? k - 1 : -1, i < C.w - 1 ? k + 1 : -1, j > 0 ? k - C.w : -1, j < C.h - 1 ? k + C.w : -1]) {
            if (nk >= 0 && ((C.isGrass(nk) && C.state[nk] === CS.none) || C.state[nk] === CS.bramble) && ctx.rng.world.next() < 0.18) ignite.push(nk);
          }
        }
        if (C.timer[k] <= 0) {
          const wasIce = C.iceAt(k);
          if (s === CS.burning) { C.state[k] = CS.ash; C.timer[k] = ASH_TIME; }
          else if (s === CS.frozen) { C.state[k] = C.isWater(k) ? CS.none : CS.wet; C.timer[k] = 6; ctx.events.push({ t: 'cell', k, change: 'thaw' }); }
          else { C.state[k] = CS.none; C.timer[k] = 0; }
          if (wasIce !== C.iceAt(k)) C.navDirty = true;
          s = C.state[k];
        }
      }
      if (s === CS.burning) { nBurn++; sig = (Math.imul(sig, 31) + k + 1) | 0; }
      if (s === CS.none && C.charge[k] <= 0 && C.steam[k] <= 0) { C.inList[k] = 0; continue; }
      act[w++] = k;
    }
    C.nActive = w;
    for (const k of ignite) if (C.state[k] === CS.none || C.state[k] === CS.bramble) { C.set(k, CS.burning, BURN_TIME); nBurn++; sig = (Math.imul(sig, 31) + k + 1) | 0; }
    if (C.navDirty) { C.navDirty = false; ctx.world.refreshNav(); }
    // W4: burning props tick, spread and burn out; the watchdog checks reachability
    if (ctx.rules.surfaces.enabled) propPass(ctx, pdt);
    // Phase 8a: fire changes the flow field (burning tiles cost rules.caps.burnNavCost), so enemies route around it
    if (ctx.world.burnCost > 1 && (nBurn !== C.burning || sig !== C.burnSig)) {
      C.burning = nBurn; C.burnSig = sig;
      ctx.world.refreshFlow(ctx.player.x, ctx.player.z);
    }

    // creatures on the cells
    const E = ctx.enemies, P = ctx.player, W = ctx.world;
    for (let e = 0; e < E.hi; e++) {
      if (!E.alive[e] || E.hover[e] > 0 || E.spawnT[e] < 0.25) continue;
      const k = C.tile(E.x[e], E.z[e]);
      if (k < 0) continue;
      const els = ctx.speciesIndex[E.species[e]].elements;
      if (C.state[k] === CS.burning && !els.includes('blaze') && E.burn[e] <= 0) applyAilment(ctx, e, 'burn', 6 + P.level * 0.8);
      // Electric types ignore the flood, and so do Ground types (Electric does nothing to Ground)
      const charged = C.charge[k] > 0 && !els.includes('volt') && !els.includes('quake') && E.y[e] - W.height(E.x[e], E.z[e]) < 0.4;
      if (charged) { const t = ccApply(ctx, e, E.roles[e] & (ROLE.boss | ROLE.alpha) ? 0.2 : 0.6); if (t > 0) E.stun[e] = Math.max(E.stun[e], t); }
      // tiles coat what stands on them (deep), once a second per creature
      if ((passN + e) % 10 === 0) {
        const ag = tileAgent(C, k, charged);
        if (ag) coatEnemy(ctx, e, ag, 2, 0);
      }
      // Electric creatures standing in water or on wet ground discharge every few seconds (0.5 s spark first)
      if (els.includes('volt') && ((C.isWater(k) && C.state[k] !== CS.frozen) || C.state[k] === CS.wet) && ctx.rng.world.next() < 0.04) {
        C.pending.push(ctx.time + 0.5, E.x[e], E.z[e]);
        ctx.events.push({ t: 'spark', x: E.x[e], z: E.z[e], life: 0.5 });
      }
    }
    // the player
    const pk = C.tile(P.x, P.z);
    if (pk >= 0 && ctx.state === 'play') {
      const els = P.species.elements;
      const grounded = P.y - W.height(P.x, P.z) < 0.3;
      if (grounded && passN % 10 === 0) {
        const ag = tileAgent(C, pk, C.charge[pk] > 0);
        if (ag) coatMember(ctx, P.m, ag, 2);
      }
      if (C.state[pk] === CS.burning && !els.includes('blaze') && P.cellHurt <= ctx.time) {
        P.cellHurt = ctx.time + 1;
        hurtPlayer(ctx, P.maxHp * 0.05, 'burn');
      }
      if (C.charge[pk] > 0 && grounded && !els.includes('volt') && !els.includes('quake') && P.cellHurt <= ctx.time) {
        P.cellHurt = ctx.time + 0.6;
        P.paraT = Math.max(P.paraT, 1.2);
        hurtPlayer(ctx, P.maxHp * 0.06, 'charge');
      }
    }
  },
};

/** environmental damage to the player: no Guard, no knockback; it still respects dash i-frames */
function hurtPlayer(ctx: SimContext, amount: number, kind: string) {
  const P = ctx.player;
  if (P.dashT > 0 || P.m.fainted || P.faintT >= 0) return;
  setSrc('tile', kind);
  const r = rec(ctx, 'tile', 'hit', true);
  if (r) { r.amount = amount * ctx.rules.mode.difficulty; r.tgt = 'player'; r.tgtName = P.species.name; r.type = kind === 'burn' ? 'blaze' : 'volt'; r.x = P.x; r.z = P.z; }
  P.hp -= amount * ctx.rules.mode.difficulty;
  P.hurtFlash = 0.2;
  ctx.stats.damageTaken += amount;
  ctx.events.push({ t: 'playerHurt', amount, x: P.x, z: P.z });
  ctx.events.push({ t: 'cellHurt', kind });
  if (P.hp <= 0) P.hp = 0;
  onHpLoss(ctx, amount * ctx.rules.mode.difficulty);
}

