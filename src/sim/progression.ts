// XP, levels, evolution by level, pickups, chests (the survivor loop; the cards and build layer went first,
// docs/hero-shooter-pivot.md §8 step 9).
// XP to next level [C]: round(8 + 5.5*L + L^1.8).

import { dhypot, dpow } from '../core/detmath';
import { SPECIES_BY_ID, type SpeciesDef } from '../rules/species';
import type { Rules } from '../rules/defaults';
import { heroHealth, statMult, topSpeed } from '../rules/stats';
import { startEvolution } from './evolution';
import { healPlayer } from './combat';
import { compileMove } from './moves';
import { Player, type Derived, type Member, type SimContext } from './types';

export function xpNext(rules: Rules, level: number, endless = false): number {
  const X = rules.xp;
  const v = Math.round(X.base + X.linear * level + dpow(level, X.exponent));
  return endless ? Math.round(v * X.endlessMult) : v;
}

/** recompute every squad member's derived stats (they share the squad level) */
export function recompute(ctx: SimContext) {
  for (const m of ctx.player.squad) recomputeMember(ctx, m);
}

/** derived stats from the canon curve (src/rules/stats.ts): levels add nothing (docs/hero-shooter-pivot.md Q12, Q25) */
export function recomputeMember(ctx: SimContext, P: Member) {
  const R = ctx.rules.player, rules = ctx.rules;
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
    magnet: R.magnetRadius,
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

export function gainXp(ctx: SimContext, v: number) {
  const P = ctx.player;
  P.xp += v;
  ctx.stats.xp += v;
  while (P.xp >= P.xpNext) {
    P.xp -= P.xpNext;
    P.level++;
    P.xpNext = xpNext(ctx.rules, P.level, ctx.rules.mode.endless);
    recompute(ctx);
    ctx.events.push({ t: 'levelUp', level: P.level });
    for (const h of ctx.hooks.onLevelUp) h(ctx);
  }
}

export const pickupSystem = {
  name: 'pickups',
  update(ctx: SimContext, dt: number) {
    const Pk = ctx.pickups;
    const P = ctx.player;
    const mag = P.derived.magnet;
    const pr = ctx.rules.player.pickupRadius;
    const ms = ctx.rules.pickups.magnetSpeed;
    for (let i = 0; i < Pk.hi; i++) {
      if (!Pk.alive[i]) continue;
      Pk.t[i] += dt;
      const dx = P.x - Pk.x[i], dz = P.z - Pk.z[i];
      const d = dhypot(dx, dz);
      if (!Pk.magnet[i] && d < mag && Pk.t[i] > 0.2) Pk.magnet[i] = 1;
      if (Pk.magnet[i]) {
        const sp = ms + Pk.t[i] * 4;
        const step = Math.min(d, sp * dt);
        Pk.x[i] += (dx / (d || 1)) * step;
        Pk.z[i] += (dz / (d || 1)) * step;
        Pk.y[i] += (P.y + 0.5 - Pk.y[i]) * Math.min(1, 8 * dt);
      }
      if (d < pr) {
        const kind = Pk.kind[i];
        if (kind === 0) gainXp(ctx, Pk.value[i]);
        else if (kind === 1) healPlayer(ctx, P.maxHp * 0.2);
        else if (kind === 2) for (let j = 0; j < Pk.hi; j++) if (Pk.alive[j] && Pk.kind[j] === 0) Pk.magnet[j] = 1;
        ctx.events.push({ t: 'pickup', value: Pk.value[i], kind });
        Pk.kill(i);
      }
    }
  },
};

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
    derived: { maxHp: 1, atk: 1, spa: 1, def: 1, spd: 1, speed: 6, haste: 1, area: 1, crit: 0.05, magnet: 4 },
    learned: new Set(), coat: 0, coatDeep: 0, coatT: 0, fainted: false, tagVariant: 0, flashT: 0, sturdyUsed: false,
  };
}

export function makePlayer(ctx: { rules: Rules }, species: SpeciesDef): Player {
  const P = new Player();
  P.xpNext = xpNext(ctx.rules, 1);
  P.reflex = ctx.rules.combat.reflexCharges;
  P.squad.push(makeMember(species));
  return P;
}
