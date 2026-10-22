// Props as materials (Procedural Pokémon World Blueprint, sections 6 and 7). Every prop with a row in
// rules/surfaces.ts PROP_MATERIALS has a state: intact, burning, burnt (a stump or nothing) or broken (rubble).
// The map's wall and platform arrays are a mutable overlay over the baked base, written only through
// World.setBlock, which also refreshes navigation; the renderer reads the state to draw stumps and gaps.
//
//   Heat on wood or leaf      → it burns (wood 6 s, leaf 3 s), lights the tall grass and props beside it,
//                               then wood leaves a stump (walkable cover, 0.65 m) and leaf leaves nothing.
//   Wet or Cold on it burning → doused (back to intact; the tiles around it are wet).
//   A Push or impact with Power ≥ its Weight breaks it outright; weaker pushes chip its integrity (type chart).
//   Stone breaks into rubble bodies (which Push and Hold then act on) and a rubble patch; wood into a stump.
//   Buildings, landmarks and bridges never break (integrity 0).
// Permanent loss is capped: past `coverLossCap` of the region's cover, fire stops spreading to the rest and breaks
// stop. A watchdog checks every 2 s that the player can still reach most of the map.
import { PROP_MATERIALS, MATERIALS, flammable, type PropMaterial } from '../rules/surfaces';
import { effectiveness, type Element } from '../rules/elements';
import { T, type ArenaMap } from '../world/tiles';
import { CS, rubbleAt } from './cells';
import { spawnBody, TEAM } from './bodies';
import { dcos, dsin } from '../core/detmath';
import type { SimContext } from './types';

export const PS = { intact: 0, burning: 1, burnt: 2, broken: 3, doused: 4 } as const;

export class PropField {
  readonly n: number;
  readonly state: Uint8Array;
  readonly timer: Float32Array;
  readonly hp: Float32Array;
  /** tile → index of the material prop covering it (-1 none) */
  readonly at: Int32Array;
  readonly mat: (PropMaterial | undefined)[];
  /** props currently burning */
  burning: number[] = [];
  /** cover props in the region, and how many are gone for good */
  coverTotal = 0; lost = 0;
  burnt = 0; broken = 0;
  /** what lit each prop (debug and the recap): a move or shot's agent, a burning prop, burning grass */
  litBy = { agent: 0, prop: 0, grass: 0 };
  /** tiles the watchdog may revert, oldest first: [prop index, time] */
  changes: number[] = [];
  /** reachable tiles from the spawn at load (watchdog baseline) */
  baseReach = 0;
  nextWatch = 0;
  /** seconds the reachable area has been under the floor (Safe gate) */
  underFloor = 0;

  constructor(readonly map: ArenaMap) {
    const W = map.w, n = map.props.length;
    this.n = n;
    this.state = new Uint8Array(n); this.timer = new Float32Array(n); this.hp = new Float32Array(n);
    this.at = new Int32Array(W * map.h).fill(-1);
    this.mat = map.props.map((p) => PROP_MATERIALS[p.kind]);
    map.props.forEach((p, i) => {
      const pm = this.mat[i];
      if (!pm) return;
      this.hp[i] = pm.integrity;
      if (pm.cover) this.coverTotal++;
      for (let j = p.y; j < p.y + p.h; j++) for (let x = p.x; x < p.x + p.w; x++) if (x < W && j < map.h) this.at[j * W + x] = i;
    });
  }
  /** cover still allowed to go: the lost pieces plus those burning now stay under the cap */
  canLose(ctx: SimContext) {
    let committed = this.lost;
    for (const i of this.burning) if (this.mat[i]?.cover && this.state[i] === PS.burning) committed++;
    return committed < this.coverTotal * ctx.rules.surfaces.coverLossCap;
  }
}

const on = (ctx: SimContext) => ctx.rules.surfaces.enabled && !!ctx.world.propField;

function footprint(ctx: SimContext, i: number, f: (k: number) => void) {
  const p = ctx.world.map.props[i], W = ctx.world.w;
  for (let j = p.y; j < p.y + p.h; j++) for (let x = p.x; x < p.x + p.w; x++) if (x < W && j < ctx.world.h) f(j * W + x);
}

/** An agent reaches tile k: if a material prop stands there, apply the reaction table to it. */
export function propAgent(ctx: SimContext, k: number, agent: 'heat' | 'wet' | 'cold' | 'charge') {
  if (!on(ctx)) return;
  const F = ctx.world.propField!, i = F.at[k];
  if (i < 0) return;
  const st = F.state[i];
  if (agent === 'heat') { if ((st === PS.intact || st === PS.doused) && ignite(ctx, i)) F.litBy.agent++; }
  else if ((agent === 'wet' || agent === 'cold') && st === PS.burning) douse(ctx, i);
}

export function ignite(ctx: SimContext, i: number): boolean {
  const F = ctx.world.propField!, pm = F.mat[i];
  if (!flammable(pm) || F.state[i] === PS.burning || F.state[i] === PS.burnt || F.state[i] === PS.broken) return false;
  if (pm!.cover && !F.canLose(ctx)) return false;
  const t = MATERIALS[pm!.mat].burn;
  F.state[i] = PS.burning; F.timer[i] = t;
  F.burning.push(i);
  const C = ctx.world.cells;
  footprint(ctx, i, (k) => C.set(k, CS.burning, t + 0.5));
  const p = ctx.world.map.props[i];
  ctx.events.push({ t: 'cell', k: p.y * ctx.world.w + p.x, change: 'ignite' });
  return true;
}

function douse(ctx: SimContext, i: number) {
  const F = ctx.world.propField!, C = ctx.world.cells;
  F.state[i] = PS.doused; F.timer[i] = 0;
  const q = F.burning.indexOf(i); if (q >= 0) F.burning.splice(q, 1);
  footprint(ctx, i, (k) => C.set(k, CS.wet, 10));
  const p = ctx.world.map.props[i];
  ctx.events.push({ t: 'cell', k: p.y * ctx.world.w + p.x, change: 'douse' });
}

/** burnt or broken: the prop leaves its footprint; wood leaves a stump on one tile */
function remove(ctx: SimContext, i: number, into: 'stump' | 'rubble' | 'gone', why: 'burnt' | 'broken') {
  const F = ctx.world.propField!, W = ctx.world, p = W.map.props[i], pm = F.mat[i]!;
  F.state[i] = why === 'burnt' ? PS.burnt : PS.broken;
  if (pm.cover) F.lost++;
  if (why === 'burnt') F.burnt++; else F.broken++;
  F.changes.push(i);
  const stumpK = (p.y + p.h - 1) * W.w + p.x;
  footprint(ctx, i, (k) => {
    F.at[k] = -1;
    const stump = into === 'stump' && k === stumpK && p.kind !== 'stump' && p.kind !== 'log';
    W.setBlock(k, 0, stump ? 0.65 : 0);
    if (stump) F.at[k] = i; // the stump is still wood and can burn or break (it is its own prop now)
  });
  if (into === 'stump' && p.kind !== 'stump' && p.kind !== 'log') { F.state[i] = why === 'burnt' ? PS.burnt : PS.broken; F.hp[i] = 40; }
  if (into === 'rubble') {
    const cx = p.x + p.w / 2 - W.half, cz = p.y + p.h / 2 - W.half;
    rubbleAt(ctx, cx, cz, p.w >= 2 ? 1 : 0);
    for (let n = 0; n < Math.max(1, pm.weight - 1); n++) {
      const a = ctx.rng.world.range(0, Math.PI * 2), s = ctx.rng.world.range(1.5, 3);
      spawnBody(ctx, 'rubble', cx + dsin(a) * 0.5, cz + dcos(a) * 0.5, dsin(a) * s, dcos(a) * s, TEAM.neutral);
    }
  }
  ctx.events.push({ t: 'break', x: p.x + p.w / 2 - W.half, z: p.y + p.h / 2 - W.half, r: Math.max(p.w, p.h) / 2, element: MATERIALS[pm.mat].type });
}

/** A stump left by a burnt or broken tree: when it burns or breaks again it is gone for good. */
function finishStump(ctx: SimContext, i: number) {
  const F = ctx.world.propField!, W = ctx.world, p = W.map.props[i];
  const k = (p.y + p.h - 1) * W.w + p.x;
  if (F.at[k] === i) { F.at[k] = -1; W.setBlock(k, 0, 0); }
}

/** A force or impact meets the prop on tile k: Power ≥ Weight breaks it, weaker forces chip it (type chart). */
export function forceOnProp(ctx: SimContext, k: number, power: number, amount: number, element: Element): boolean {
  if (!on(ctx)) return false;
  const F = ctx.world.propField!, i = F.at[k];
  if (i < 0) return false;
  const pm = F.mat[i]!;
  if (pm.integrity <= 0) return false;
  const st = F.state[i];
  if (st === PS.broken) return false;
  const stumpLeft = st === PS.burnt; // what is left is a stump
  const weight = stumpLeft ? 2 : pm.weight;
  if (power < 1 && amount <= 0) return false;
  if (power >= weight) F.hp[i] = 0;
  else F.hp[i] -= amount * ctx.rules.surfaces.hitIntegrity * effectiveness(ctx.chart, element, [MATERIALS[pm.mat].type]);
  if (F.hp[i] > 0) return false;
  if (stumpLeft) { finishStump(ctx, i); F.state[i] = PS.broken; return true; }
  if (pm.cover && !F.canLose(ctx)) { F.hp[i] = 1; return false; }
  const q = F.burning.indexOf(i); if (q >= 0) F.burning.splice(q, 1);
  remove(ctx, i, pm.breaksInto, 'broken');
  return true;
}

/** every material prop inside a circle (world coordinates) meets a force */
export function forceOnPropsIn(ctx: SimContext, x: number, z: number, r: number, power: number, amount: number, element: Element) {
  if (!on(ctx) || (power < 1 && amount <= 0)) return;
  const W = ctx.world, F = W.propField!;
  const i0 = Math.floor(x - r + W.half), i1 = Math.floor(x + r + W.half), j0 = Math.floor(z - r + W.half), j1 = Math.floor(z + r + W.half);
  let last = -2;
  for (let j = Math.max(0, j0); j <= Math.min(W.h - 1, j1); j++) for (let i = Math.max(0, i0); i <= Math.min(W.w - 1, i1); i++) {
    const k = j * W.w + i, pi = F.at[k];
    if (pi < 0 || pi === last) continue;
    const cx = i - W.half + 0.5, cz = j - W.half + 0.5;
    if ((cx - x) ** 2 + (cz - z) ** 2 > r * r) continue;
    last = pi;
    forceOnProp(ctx, k, power, amount, element);
  }
}

/** the 0.1 s pass (called from the cell pass): burning props tick, spread, and burn out */
export function propPass(ctx: SimContext, pdt: number) {
  if (!on(ctx)) return;
  const W = ctx.world, F = W.propField!, C = W.cells, R = ctx.rules.surfaces;
  for (let q = F.burning.length - 1; q >= 0; q--) {
    const i = F.burning[q];
    F.timer[i] -= pdt;
    const p = W.map.props[i];
    // spread to the ring around the footprint: tall grass catches like grass does, props by propIgnite (each
    // neighbouring prop rolls once per pass, however many of its tiles touch the ring)
    let lastO = -1;
    for (let j = p.y - 1; j <= p.y + p.h; j++) for (let x = p.x - 1; x <= p.x + p.w; x++) {
      if (x < 0 || j < 0 || x >= W.w || j >= W.h) continue;
      if (x >= p.x && x < p.x + p.w && j >= p.y && j < p.y + p.h) continue;
      const k = j * W.w + x;
      if (W.map.terrain[k] === T.tall && C.state[k] === CS.none && ctx.rng.world.next() < 0.18) C.set(k, CS.burning, 4);
      const o = F.at[k];
      if (o === lastO) continue;
      lastO = o;
      if (o >= 0 && o !== i && (F.state[o] === PS.intact || F.state[o] === PS.doused) && flammable(F.mat[o]) && ctx.rng.world.next() < R.propIgnite * (F.mat[o]!.mat === 'wood' ? R.woodSpread : 1) && ignite(ctx, o)) F.litBy.prop++;
    }
    if (F.timer[i] > 0) continue;
    F.burning.splice(q, 1);
    const pm = F.mat[i]!;
    remove(ctx, i, MATERIALS[pm.mat].burnsInto === 'stump' ? 'stump' : 'gone', 'burnt');
  }
  // burning grass lights the props beside it
  if (C.burning > 0) {
    const list = C.activeList();
    for (let q = 0; q < list.length; q++) {
      const k = list[q];
      if (C.state[k] !== CS.burning || F.at[k] >= 0) continue; // a burning prop's own tiles spread by the prop rule
      const x = k % W.w, y = (k / W.w) | 0;
      for (const nk of [x > 0 ? k - 1 : -1, x < W.w - 1 ? k + 1 : -1, y > 0 ? k - W.w : -1, y < W.h - 1 ? k + W.w : -1]) {
        if (nk < 0) continue;
        const o = F.at[nk];
        if (o >= 0 && (F.state[o] === PS.intact || F.state[o] === PS.doused) && flammable(F.mat[o]) && ctx.rng.world.next() < R.grassToProp * (F.mat[o]!.mat === 'wood' ? R.woodSpread : 1) && ignite(ctx, o)) F.litBy.grass++;
      }
    }
  }
  // the watchdog: reachable area against the base map
  if (ctx.time >= F.nextWatch) {
    F.nextWatch = ctx.time + R.watchdogEvery;
    // from the region's spawn, not the player (who may stand on a rock or a stump, off the walking graph)
    const reach = W.reachableCount(W.spawn[0], W.spawn[1]);
    if (F.baseReach > 0 && reach < F.baseReach * R.watchdogFloor) {
      F.underFloor += R.watchdogEvery;
      // revert: the oldest removals' stumps go entirely (stumps are the only thing a change adds)
      for (const i of F.changes.splice(0, 4)) finishStump(ctx, i);
    } else F.underFloor = 0;
  }
}

