// Techniques at run time (blueprint sections 6 and 12, Phase 8b): the small helpers every system calls where a
// technique edits a capability event. They are trainer-wide (Player.techMask), so they apply to whichever Pokémon is on
// the field. With no technique held every helper returns exactly what the Phase 8a code computed.

import { TB, TECHNIQUE_BY_ID } from '../rules/build';
import { capOf, type Cap } from '../rules/capabilities';
import { weightClass } from '../rules/species';
import { rec, setSrc } from './caplog';
import type { MoveSpec, SimContext } from './types';

/** the trainer holds this technique (TB bit) */
export const tech = (ctx: SimContext, bit: number) => (ctx.player.techMask & bit) !== 0;

/** the Weight the field Pokémon's Guard counts as: its class, +1 with Heavy Footing (never above Heavy) */
export function guardWeight(ctx: SimContext): number {
  const w = weightClass(ctx.player.species);
  if (!tech(ctx, TB.heavy)) return w;
  const H = ctx.rules.build.tech.heavyFooting;
  return Math.max(w, Math.min(H.maxGuard, w + H.weight));
}

/** how long a Hold suspends what it caught */
export function holdSeconds(ctx: SimContext): number {
  return tech(ctx, TB.lodestone) ? ctx.rules.build.tech.lodestone.holdTime : ctx.rules.caps.holdTime;
}

const lodeCache = new WeakMap<readonly Cap[], Cap[]>();
/** Lodestone's +1 Hold, only on something that already holds (no capability from nowhere) */
function lodestoneCaps(ctx: SimContext, caps: readonly Cap[]): Cap[] {
  let out = lodeCache.get(caps);
  if (!out) {
    const bonus = ctx.rules.build.tech.lodestone.holdBonus;
    out = caps.map((c) => (c.verb === 'hold' ? { verb: 'hold' as const, power: Math.min(4, c.power + bonus) as 1 | 2 | 3 | 4 } : c));
    lodeCache.set(caps, out);
  }
  return out;
}

/** a cast spec after the trainer's techniques: Undertow's damage cost on Push moves, Lodestone's Hold bonus.
 *  Mutates and returns `s`, which must be a fresh copy (slotSpec and tagSpec build one per cast). */
export function techSpec(ctx: SimContext, s: MoveSpec): MoveSpec {
  const m = ctx.player.techMask;
  if (!m || !s.caps) return s;
  if (m & TB.undertow && capOf(s.caps, 'push') > 0) s.dmg *= ctx.rules.build.tech.undertow.pushDmg;
  if (m & TB.lodestone && capOf(s.caps, 'hold') > 0) s.caps = lodestoneCaps(ctx, s.caps);
  return s;
}

/** write a technique's effect to the capability log (death recap, pokewatch.debug('caps')) */
export function logTech(ctx: SimContext, id: string, what: string, x: number, z: number) {
  setSrc('trainer', TECHNIQUE_BY_ID[id]?.title ?? id);
  const r = rec(ctx, 'technique', 'ok');
  if (r) { r.tgt = 'player'; r.tgtName = what; r.x = x; r.z = z; }
}

/** Riposte: a Guard deflect or parry refunds Move A's cooldown */
export function onGuardDeflect(ctx: SimContext) {
  if (!tech(ctx, TB.riposte)) return;
  const s = ctx.player.moves[1];
  if (!s || s.cd <= 0) return;
  s.cd = 0;
  logTech(ctx, 'riposte', 'Move A ready', ctx.player.x, ctx.player.z);
}

/** Catalyst: a reaction the trainer's hit triggered takes time off Move A and Move B */
export function onReaction(ctx: SimContext, x: number, z: number) {
  if (!tech(ctx, TB.catalyst)) return;
  const k = ctx.rules.build.tech.catalyst.refund;
  const P = ctx.player;
  for (let i = 1; i <= 2; i++) { const s = P.moves[i]; if (s && s.cd > 0) s.cd = Math.max(0, s.cd - k); }
  logTech(ctx, 'catalyst', `cooldowns −${k} s`, x, z);
}
