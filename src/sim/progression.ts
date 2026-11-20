// Derived stats, the player and its members, and the survivor loop's remains: evolution by level and chests (cards,
// build, XP and pickups went first, docs/hero-shooter-pivot.md §8 step 9).
// XP to next level [C]: round(8 + 5.5*L + L^1.8).

import { dhypot } from '../core/detmath';
import { SPECIES_BY_ID, type SpeciesDef } from '../rules/species';
import type { Rules } from '../rules/defaults';
import { heroHealth, statMult, topSpeed } from '../rules/stats';
import { startEvolution } from './evolution';
import { compileMove } from './moves';
import { Player, type Derived, type Member, type SimContext } from './types';

/** recompute every squad member's derived stats (they share the squad level) */
export function recompute(ctx: SimContext) {
  for (const m of ctx.player.squad) recomputeMember(ctx, m);
}

/** derived stats from the canon curve (src/rules/stats.ts): levels add nothing (docs/hero-shooter-pivot.md Q12, Q25) */
export function recomputeMember(ctx: SimContext, P: Member) {
  const rules = ctx.rules;
  const s = P.species.stats;
  const d: Derived = {
    maxHp: heroHealth(s.hp, rules),
    atk: statMult(s.atk, rules),
    spa: statMult(s.spa, rules),
    def: statMult(s.def, rules),
    spd: statMult(s.spd, rules),
    speed: topSpeed(s.spe, rules),
    haste: 1,
    area: 1,
    crit: ctx.rules.damage.critChance,
  };
  const ratio = P.maxHp > 0 ? P.hp / P.maxHp : 1;
  P.derived = d;
  const oldMax = P.maxHp;
  P.maxHp = d.maxHp;
  P.hp = oldMax > 0 ? Math.min(P.maxHp, P.hp + Math.max(0, P.maxHp - oldMax)) : P.maxHp * ratio;
}

export function learnMove(ctx: SimContext, key: string) {
  const P = ctx.player;
  P.moves.push({ key, level: ctx.rules.hero.moveLevel, cd: 0.3, spec: compileMove(ctx.rules, key) });
  P.learned.add(key);
  ctx.events.push({ t: 'learn', key });
}

/** the survivor loop's level checks: benched Pokémon evolve at their level (no Breakthrough), and the field Pokémon's
 *  level starts a Breakthrough (sim/evolution.ts). Deleted with the loop (docs/hero-shooter-pivot.md §8 step 9) */
export function levelChecks(ctx: SimContext) {
  if (ctx.state !== 'play') return;
  const P = ctx.player;
  for (let k = 0; k < P.squad.length; k++) {
    if (k === P.active) continue;
    const m = P.squad[k];
    const bs = m.species;
    if (!m.fainted && bs.evolvesTo && bs.evolveLevel && P.level >= bs.evolveLevel) {
      m.species = SPECIES_BY_ID[bs.evolvesTo];
      recomputeMember(ctx, m);
      m.hp = m.maxHp;
      ctx.events.push({ t: 'benchEvolve', from: bs.id, to: m.species.id });
    }
  }
  const sp = P.species;
  if (P.breakT > 0) return;
  if (sp.evolvesTo && sp.evolveLevel && P.level >= sp.evolveLevel) startEvolution(ctx);
}

export const progressionSystem = {
  name: 'progression',
  update(ctx: SimContext) {
    const P = ctx.player;
    // chests
    for (const c of ctx.world.chests) {
      if (c.open) continue;
      if (dhypot(P.x - c.x, P.z - c.z) < 1.8) {
        c.open = true;
        ctx.events.push({ t: 'chest', x: c.x, z: c.z });
      }
    }
    levelChecks(ctx);
  },
};

export function makeMember(species: SpeciesDef): Member {
  return {
    species, hp: 1, maxHp: 0, grey: 0, moves: [], buffT: 0, buffAtk: 0, buffSpe: 0, paraT: 0,
    trailT: 0, trailSpec: null, trailLevel: 0, trailAcc: 0, regenAcc: 0,
    derived: { maxHp: 1, atk: 1, spa: 1, def: 1, spd: 1, speed: 6, haste: 1, area: 1, crit: 0.05 },
    learned: new Set(), coat: 0, coatDeep: 0, coatT: 0, fainted: false, tagVariant: 0, flashT: 0, sturdyUsed: false,
  };
}

export function makePlayer(ctx: { rules: Rules }, species: SpeciesDef): Player {
  const P = new Player();
  P.reflex = ctx.rules.combat.reflexCharges;
  P.squad.push(makeMember(species));
  return P;
}
