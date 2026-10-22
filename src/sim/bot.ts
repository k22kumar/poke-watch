// A simple deterministic bot for headless balance runs and browser autoplay tests.
// Kites away from the local enemy centroid, drifts toward XP gems, picks the first card.
import { dcos, dhypot, dsin } from '../core/detmath';
import { BTN, type InputFrame, type SimContext } from './types';

export function botInput(ctx: SimContext): InputFrame {
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
  // gems
  const Pk = ctx.pickups;
  let gx = 0, gz = 0, gd = 1e9;
  for (let i = 0; i < Pk.hi; i++) {
    if (!Pk.alive[i]) continue;
    const d = Math.abs(Pk.x[i] - P.x) + Math.abs(Pk.z[i] - P.z);
    if (d < gd) { gd = d; gx = Pk.x[i] - P.x; gz = Pk.z[i] - P.z; }
  }
  // objectives (when the bot engages them): the pad, the Hunt target, the egg and then its goal
  let objPull = 0;
  const O = ctx.objective;
  if (botObjectives && O && (O.phase === 'offer' || O.phase === 'active')) {
    let ox = O.x, oz = O.z;
    if (O.kind === 'transport' && O.egg >= 0 && O.carrier !== -2) { ox = ctx.bodies.x[O.egg]; oz = ctx.bodies.z[O.egg]; }
    const d = Math.hypot(ox - P.x, oz - P.z);
    const stay = O.kind === 'hold' ? 2.5 : O.kind === 'hunt' ? 4 : 0;
    if (d > stay) { gx = ox - P.x; gz = oz - P.z; gd = 0; objPull = 1.6; }
  }
  // portal
  if (ctx.portal.active) { gx = ctx.portal.x - P.x; gz = ctx.portal.z - P.z; gd = 0; }
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
  // steer around trees, water and cliffs: rotate the heading until the way ahead is clear
  const W = ctx.world;
  if (W.blocks(P.x + mx * 1.4, P.z + mz * 1.4, P.y, ctx.rules.player.stepHeight)) {
    for (const turn of [0.5, -0.5, 1.0, -1.0, 1.6, -1.6, 2.3, -2.3]) {
      const c = dcos(turn), s = dsin(turn);
      const tx = mx * c - mz * s, tz = mx * s + mz * c;
      if (!W.blocks(P.x + tx * 1.4, P.z + tz * 1.4, P.y, ctx.rules.player.stepHeight)) { mx = tx; mz = tz; break; }
    }
  }
  const close = dhypot(ax, az) > 0.6;
  // moves are held down (they fire on cooldown at the nearest enemy, since the bot has no aim)
  const card = ctx.cards.offer ? cardAction(ctx) : undefined;
  // moves are held down (they fire on cooldown at the nearest enemy, since the bot has no aim); Tag is a tap
  const btn = BTN.a | BTN.b | (wantsTag(ctx) ? BTN.sig : 0);
  return { mx, mz, jump: false, dash: close && ctx.tick % 50 === 0, btn, card };
}

/**
 * How the bot picks cards (Phase 8b sweeps). 'first' takes card 1 (the v10 bot; in the build layer that is the Kit
 * card). 'random' picks uniformly with its own generator (seeded from the run seed, so runs stay reproducible and the
 * sim's RNG streams are untouched). 'plan' takes the techniques in `botPlan.techs` when offered and never others,
 * prefers transforms, then the Kit card. Swap offers: the plan discards the first technique not in its plan.
 */
export type BotCardPolicy = 'first' | 'random' | 'plan';
let cardPolicy: BotCardPolicy = 'first';
export const botPlan: { techs: string[]; xfs: string[] } = { techs: [], xfs: [] };
let botRng = 1;
export function setBotCards(p: BotCardPolicy, plan?: { techs?: string[]; xfs?: string[] }, seed = 1) {
  cardPolicy = p; botPlan.techs = plan?.techs ?? []; botPlan.xfs = plan?.xfs ?? []; botRng = (seed * 2654435761) >>> 0 || 1;
}
function nextRand() { botRng = (botRng + 0x6d2b79f5) >>> 0; let t = botRng; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }
/** the card input: pick botCard's choice; a plan bot skips an offer holding only techniques outside its plan */
function cardAction(ctx: SimContext): NonNullable<InputFrame['card']> {
  const i = botCard(ctx);
  const offer = ctx.cards.offer;
  if (cardPolicy === 'plan' && offer && ctx.cards.source !== 'swap' && ctx.cards.skips > 0 && offer.every((c) => c.kind === 'technique' && !botPlan.techs.includes(c.key))) return { action: 'skip', index: 0 };
  return { action: 'pick', index: i };
}
export function botCard(ctx: SimContext): number {
  const offer = ctx.cards.offer;
  if (!offer || !offer.length || cardPolicy === 'first') return 0;
  if (cardPolicy === 'random') return Math.min(offer.length - 1, Math.floor(nextRand() * offer.length));
  if (ctx.cards.source === 'swap') {
    const k = offer.findIndex((c) => c.key && !botPlan.techs.includes(c.key));
    return k >= 0 ? k : offer.length - 1;
  }
  const score = (c: (typeof offer)[number]) => c.kind === 'technique' ? (botPlan.techs.includes(c.key) ? 100 : -100)
    : c.kind === 'transform' ? (botPlan.xfs.length ? (botPlan.xfs.includes(c.key) ? 90 : -50) : 50)
    : c.kind === 'learn' ? 40 : c.kind === 'evolve' ? 35 : c.kind === 'replace' ? 10 : c.kind === 'heal' ? 20 : 0;
  let best = 0;
  for (let k = 1; k < offer.length; k++) if (score(offer[k]) > score(offer[best])) best = k;
  return best;
}

/** whether the bot goes for objectives (Hold, Hunt, Transport) or ignores them */
let botObjectives = true;
export function setBotObjectives(on: boolean) { botObjectives = on; }

/** how the bot uses Tag: 'off' never switches, 'smart' rests a hurt Pokémon, 'rotate' cycles for ready moves */
export type BotTagPolicy = 'off' | 'smart' | 'rotate';
let tagPolicy: BotTagPolicy = 'smart';
export function setBotTagPolicy(p: BotTagPolicy) { tagPolicy = p; }

function wantsTag(ctx: SimContext): boolean {
  const P = ctx.player;
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
