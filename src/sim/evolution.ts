// Evolution as a Breakthrough (docs/STATS_GROWTH_TARGET.md "Breakthroughs"; docs/hero-shooter-pivot.md Q23, Q30, Q39).
// A per-player state, never a world freeze: for rules.evolution.breakSeconds the Pokémon is rooted and invulnerable
// with its status cleared, then it swaps to its next form at full health. The world keeps running.
//
// The size change needs no code here: the new species' footprint, height and hurtbox (src/rules/sizing.ts) apply from
// the next tick, and a body that grew in a tight spot walks out of it, never further in (World.moveBody; a head already
// inside a deck slab rises no further, sim/locomotion.ts). The camera eases to the new outline on its own.
//
// Triggers: startEvolution is the one entry. The range Mode (rules.evolution.freeTrigger) starts one for free when Touch
// is held for rules.evolution.holdTime; Candy prices come with growth. The dev trigger is `?evolve=<seconds>`
// (src/main.ts).
import { SPECIES_BY_ID } from '../rules/species';
import { recomputeMember } from './progression';
import { BTN, type Player, type SimContext, type System } from './types';

/** can this member Breakthrough now? (an evolver, not already in one, alive) */
export function canBreakthrough(ctx: SimContext, P: Player = ctx.player, memberIndex = P.active): boolean {
  const m = P.squad[memberIndex];
  return !!m && !m.fainted && !!m.species.evolvesTo && !!SPECIES_BY_ID[m.species.evolvesTo] && P.breakT <= 0 && P.faintT < 0;
}

/** Start a Breakthrough for one member of one player. Returns false when it can't (see canBreakthrough). */
export function startEvolution(ctx: SimContext, P: Player = ctx.player, memberIndex = P.active): boolean {
  if (!canBreakthrough(ctx, P, memberIndex)) return false;
  const m = P.squad[memberIndex], R = ctx.rules.evolution;
  P.breakT = R.breakSeconds; P.breakMember = memberIndex; P.touchT = 0;
  // status cleared: paralysis, a coat, a slow or a root it carried in
  P.paraT = 0; m.paraT = 0; m.coat = 0; m.coatDeep = 0; m.coatT = 0;
  hold(P, ctx.dt);
  ctx.events.push({ t: 'evolveStart', from: m.species.id, to: m.species.evolvesTo! });
  return true;
}

/** rooted and invulnerable for the rest of this tick */
function hold(P: Player, dt: number) {
  P.rootT = Math.max(P.rootT, dt * 2);
  P.iframes = Math.max(P.iframes, dt * 2);
  P.vx = 0; P.vz = 0;
}

/** the swap: next form, recomputed stats, full health */
export function finishEvolution(ctx: SimContext, P: Player = ctx.player) {
  const k = P.breakMember >= 0 ? P.breakMember : P.active, m = P.squad[k];
  P.breakT = 0; P.breakMember = -1;
  const next = m && m.species.evolvesTo ? SPECIES_BY_ID[m.species.evolvesTo] : undefined;
  if (!m || !next) return;
  m.species = next;
  recomputeMember(ctx, m);
  m.hp = m.maxHp;
  ctx.events.push({ t: 'evolveEnd', species: next.id });
}

export const evolutionSystem: System = {
  name: 'evolution',
  update(ctx, dt) {
    for (const P of ctx.players) {
      if (P.breakT > 0) {
        hold(P, dt);
        P.breakT -= dt;
        if (P.breakT <= 0) finishEvolution(ctx, P);
        continue;
      }
      // the free trigger (range Mode): hold Touch
      const R = ctx.rules.evolution;
      if (!R.freeTrigger) continue;
      const held = P === ctx.player && ((ctx.input.btn ?? 0) & BTN.touch) !== 0;
      P.touchT = held ? P.touchT + dt : 0;
      if (held && P.touchT >= R.holdTime) { P.touchT = 0; startEvolution(ctx, P); }
    }
  },
};
