// A simple deterministic bot for headless runs, gates and browser autoplay tests.
//
// The movement core (docs/hero-shooter-pivot.md §6) kites away from the local enemy centroid, orbits the map centre,
// heads for the shore when it is in a liquid, turns its footprint around walls and lips, and brakes at a hazard edge.
// The survivor pulls on top of it (XP gems, objectives, the portal, Tag) are separate and go with the survivor
// loop. Each run gets its own Bot (botInput keys one per SimContext), so no policy or random state leaks between runs.
import { dcos, dhypot, dsin } from '../core/detmath';
import { BTN, type InputFrame, type SimContext } from './types';
import { nearestEnemy, slotSpec } from './moves';
import { shoreFor } from './hazards';
import { partnerFootprint } from '../rules/sizing';

const TURNS = [0.5, -0.5, 1.0, -1.0, 1.6, -1.6, 2.3, -2.3], TURNS_BACK = [...TURNS, Math.PI];

/** an enemy within the basic attack's reach (the reach the automatic basic attack used to wait for) */
function basicInReach(ctx: SimContext): boolean {
  const P = ctx.player;
  if (ctx.rules.combat.basicNeedsTarget) return true; // the sim waits for a target itself (older builds' rule)
  if (!P.moves.length) return false;
  const s = slotSpec(ctx, 0);
  return nearestEnemy(ctx, P.x, P.z, Math.max(s.range, s.radius * 1.5, 8)) >= 0;
}

/** how the bot uses Tag: 'off' never switches, 'smart' rests a hurt Pokémon, 'rotate' cycles for ready moves */
export type BotTagPolicy = 'off' | 'smart' | 'rotate';

export interface BotOptions {
  /** go for objectives (Hold, Hunt, Transport) or ignore them */
  objectives?: boolean;
  tag?: BotTagPolicy;
}

/** the options a Bot made by botInput starts with; the set* functions below change them for runs created afterwards */
const defaults: Required<BotOptions> = { objectives: true, tag: 'smart' };

export class Bot {
  readonly objectives: boolean;
  readonly tag: BotTagPolicy;
  constructor(o: BotOptions = {}) {
    this.objectives = o.objectives ?? true;
    this.tag = o.tag ?? 'smart';
  }
  input(ctx: SimContext): InputFrame { return botStep(this, ctx); }
}

const perRun = new WeakMap<SimContext, Bot>();
/** this run's bot, made on first use from the current defaults */
export function botFor(ctx: SimContext): Bot {
  let b = perRun.get(ctx);
  if (!b) { b = new Bot(defaults); perRun.set(ctx, b); }
  return b;
}
export function botInput(ctx: SimContext): InputFrame { return botFor(ctx).input(ctx); }

/** The survivor loop's pull on the bot: (when the bot engages them) the objective's pad,
 *  Hunt target, egg or goal, else the open portal. Returns the offset to it, its distance (1e9 = nothing to drift to,
 *  0 = must go) and the objective's pull weight. Goes with the survivor loop (docs/hero-shooter-pivot.md §6). */
function survivorPull(bot: Bot, ctx: SimContext): [number, number, number, number] {
  const P = ctx.player;
  let gx = 0, gz = 0, gd = 1e9;
  // objectives (when the bot engages them): the pad, the Hunt target, the egg and then its goal
  let objPull = 0;
  const O = ctx.objective;
  if (bot.objectives && O && (O.phase === 'offer' || O.phase === 'active')) {
    let ox = O.x, oz = O.z;
    if (O.kind === 'transport' && O.egg >= 0 && ctx.bodies.carrier[O.egg] !== -2) { ox = ctx.bodies.x[O.egg]; oz = ctx.bodies.z[O.egg]; }
    const d = Math.hypot(ox - P.x, oz - P.z);
    const stay = O.kind === 'hold' ? 2.5 : O.kind === 'hunt' ? 4 : 0;
    if (d > stay) { gx = ox - P.x; gz = oz - P.z; gd = 0; objPull = 1.6; }
  }
  // portal
  if (ctx.portal.active) { gx = ctx.portal.x - P.x; gz = ctx.portal.z - P.z; gd = 0; }
  return [gx, gz, gd, objPull];
}

function botStep(bot: Bot, ctx: SimContext): InputFrame {
  const P = ctx.player;
  const E = ctx.enemies;
  let ax = 0, az = 0;
  for (let i = 0; i < E.hi; i++) {
    if (!E.alive[i]) continue;
    const dx = P.x - E.x[i], dz = P.z - E.z[i];
    const d2 = dx * dx + dz * dz;
    if (d2 > 144) continue;
    const w = 1 / Math.max(1, d2);
    ax += dx * w; az += dz * w;
  }
  // the survivor pulls: a target to drift to (an objective, the portal) and how hard
  const [gx, gz, gd, objPull] = survivorPull(bot, ctx);
  // orbit the centre so the bot does not pin itself on the map edge. Authored arenas are built around the map centre;
  // a generated region's open centre is its hub (the spawn clearing), which can sit anywhere
  const [ox0, oz0] = ctx.world.map.gen ? ctx.world.spawn : [0, 0];
  const rx = P.x - ox0, rz = P.z - oz0;
  const cx = -rz * 0.004 - rx * 0.002, cz = rx * 0.004 - rz * 0.002;
  const gl = dhypot(gx, gz) || 1;
  const threat = dhypot(ax, az);
  const gw = objPull > 0 ? objPull : gd < 1e9 ? (threat < 0.25 ? 1.2 : 0.4) : 0;
  let mx = ax * 3 + (gx / gl) * gw + cx;
  let mz = az * 3 + (gz / gl) * gw + cz;
  const L = dhypot(mx, mz);
  if (L > 0.001) { mx /= L; mz /= L; } else { mx = dsin(ctx.time * 0.3); mz = dcos(ctx.time * 0.3); }
  // steer around trees, water and cliffs: rotate the heading until the way ahead is clear; in a liquid (knocked or
  // pushed in), head straight for the nearest shore first
  const W = ctx.world;
  const shore = W.hazards ? shoreFor(ctx) : null;
  // hazards on, a lip or a shore is not a wall: probe the whole 1.4 m (a single point can sit past a narrow lip), and
  // also where the current velocity carries it
  const st = ctx.rules.player.stepHeight;
  const centre = W.hazards
    ? (dx: number, dz: number) => !W.blocks(P.x + dx * 0.6, P.z + dz * 0.6, P.y, st) && !W.blocks(P.x + dx, P.z + dz, P.y, st) && !W.blocks(P.x + dx * 1.4, P.z + dz * 1.4, P.y, st)
    : (dx: number, dz: number) => !W.blocks(P.x + dx * 1.4, P.z + dz * 1.4, P.y, st);
  // size geometry on: the partner's footprint must fit the way ahead too (its edges, not only its centre line), so the
  // bot does not steer a Large or Extra Large partner into a gap it cannot pass (docs/SIZING.md "Footprint")
  const pf = partnerFootprint(P.species, ctx.rules);
  const clear = pf > 0
    ? (dx: number, dz: number) => centre(dx, dz) && !W.blocks(P.x + dx - dz * pf, P.z + dz + dx * pf, P.y, st) && !W.blocks(P.x + dx + dz * pf, P.z + dz - dx * pf, P.y, st)
      && !W.blocks(P.x + dx * 1.4 - dz * pf, P.z + dz * 1.4 + dx * pf, P.y, st) && !W.blocks(P.x + dx * 1.4 + dz * pf, P.z + dz * 1.4 - dx * pf, P.y, st)
    : centre;
  if (shore) { const sx = shore[0] - P.x, sz = shore[1] - P.z, sl = dhypot(sx, sz) || 1; mx = sx / sl; mz = sz / sl; }
  else if (!clear(mx, mz)) {
    // size geometry on: straight back too, last (a dead-end alcove whose only way out is behind; replay layers with size
    // geometry off keep the older list)
    for (const turn of pf > 0 ? TURNS_BACK : TURNS) {
      const c = dcos(turn), s = dsin(turn);
      const tx = mx * c - mz * s, tz = mx * s + mz * c;
      if (clear(tx, tz)) { mx = tx; mz = tz; break; }
    }
  }
  if (W.hazards && !shore) {
    // momentum toward a hazard lip (not a wall): brake against it
    const v = dhypot(P.vx, P.vz);
    if (v > 1) { const ux = P.vx / v, uz = P.vz / v, d = 0.5 + v * 0.12; const hx = P.x + ux * d, hz = P.z + uz * d;
      if (W.blocks(hx, hz, P.y, st) && !W.collides(hx, hz, P.y, st)) { mx = -ux; mz = -uz; } }
  }
  const close = dhypot(ax, az) > 0.6;
  // moves are held down (they fire on cooldown at the nearest enemy, since the bot has no aim); the basic attack is
  // held only while an enemy is in its reach, so the bot does not spend it on empty ground; Tag is a tap
  let btn = (basicInReach(ctx) ? BTN.basic : 0) | BTN.a | BTN.b | (wantsTag(bot, ctx) ? BTN.sig : 0);
  // hazards on: a lunge (dash-shaped move) flies at the nearest enemy and crosses a lip like walking does, so the bot
  // holds one only when the line to that enemy stays on solid ground
  if (W.hazards) for (const [slot, bit] of [[0, BTN.basic], [1, BTN.a], [2, BTN.b]] as const) {
    if (!(btn & bit) || slot >= P.moves.length) continue;
    const s = slotSpec(ctx, slot);
    if (s.archetype !== 'dash') continue;
    const e = nearestEnemy(ctx, P.x, P.z, Math.max(s.range, 8) + 4);
    if (e < 0) continue;
    const dx = ctx.enemies.x[e] - P.x, dz = ctx.enemies.z[e] - P.z, L = dhypot(dx, dz) || 1;
    const reach = s.duration * ctx.rules.player.dashSpeed + 2; // the lunge runs its full length, past the target
    for (let d = 0.5; d <= reach; d += 0.5) { const x = P.x + (dx / L) * d, z = P.z + (dz / L) * d; if (W.blocks(x, z, P.y, st) && !W.collides(x, z, P.y, st)) { btn &= ~bit; break; } }
  }
  // hazards on: a dash and the slide after it cover ~5.5 m, far past the look-ahead, so none of it may cross open air
  // or a liquid
  let dash = close && ctx.tick % 50 === 0;
  if (dash && W.hazards && !shore) for (let d = 0.5; d <= 7 && dash; d += 0.5) { const x = P.x + mx * d, z = P.z + mz * d; if (W.blocks(x, z, P.y, st) && !W.collides(x, z, P.y, st)) dash = false; }
  return { mx, mz, jump: false, dash, btn };
}

/** whether bots created afterwards go for objectives */
export function setBotObjectives(on: boolean) { defaults.objectives = on; }
/** the Tag policy for bots created afterwards */
export function setBotTagPolicy(p: BotTagPolicy) { defaults.tag = p; }

function wantsTag(bot: Bot, ctx: SimContext): boolean {
  const P = ctx.player;
  const tagPolicy = bot.tag;
  if (tagPolicy === 'off' || P.squad.length < 2 || P.tagCd > 0 || P.tagDownT >= 0 || P.faintT >= 0 || ctx.state !== 'play') return false;
  const others = P.squad.filter((m, k) => k !== P.active && !m.fainted);
  if (!others.length) return false;
  const m = P.m;
  if (tagPolicy === 'rotate') {
    // cooldown cycling: leave when every manual move is cooling and a reserve has one ready
    const busy = m.moves.slice(1).every((s) => s.cd > 0.5);
    return busy && others.some((o) => o.moves.slice(1).some((s) => s.cd <= 0));
  }
  // smart: rest a hurt Pokémon while a healthier one holds the field, or bank the grey health
  if (m.hp < m.maxHp * 0.35 && others.some((o) => o.hp > o.maxHp * 0.6)) return true;
  return m.grey > m.maxHp * 0.15 && others.some((o) => o.hp > o.maxHp * 0.5);
}
