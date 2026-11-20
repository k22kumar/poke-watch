// In-match stats (docs/STATS_GROWTH_TARGET.md "Stats"; docs/hero-shooter-pivot.md Q12, Q25, Q36, Q37). Pure functions
// of a species' base stats and rules.hero; no sim state.
//
// Level-50 Canon Curve, k = 0.6, no Upkeep. `base + 20` is the canonical level-50 stat at IV 31, EV 0:
//   m(stat)  = ((base + statOffset) / statRef) ^ k           a base 80 stat is ×1.0
//   health   = health × ((HP + hpOffset) / hpRef) ^ k        base 80 HP is 250
// "No Upkeep" means no BST-keyed cost multiplier on strong Pokémon, and levels add nothing: they will only pay Candy.
// Attack and Sp. Atk scale physical and special moves; Defense and Sp. Def divide incoming damage of their class
// (damage = move power × power ÷ guard, per channel). Speed sets top speed inside a narrow logistic band; acceleration
// and Burst refill come with the Burst system.
import { dexp, dpow } from '../core/detmath';
import type { Rules } from './defaults';
import type { SpeciesDef } from './species';

export type Channel = 'physical' | 'special';

/** a base stat's multiplier on the canon curve (base 80 → 1.0) */
export function statMult(base: number, rules: Rules): number {
  const H = rules.hero;
  return dpow(Math.max(0, base + H.statOffset) / H.statRef, H.k);
}

/** health from base HP on the canon curve (base 80 → rules.hero.health, 250) */
export function heroHealth(hp: number, rules: Rules): number {
  const H = rules.hero;
  return H.health * dpow(Math.max(0, hp + H.hpOffset) / H.hpRef, H.k);
}

/** top planar speed (m/s) from base Speed: a logistic band of width speedBand centred on topSpeed at Spe speedMid */
export function topSpeed(spe: number, rules: Rules): number {
  const H = rules.hero;
  return H.topSpeed - H.speedBand / 2 + H.speedBand / (1 + dexp(-(spe - H.speedMid) / H.speedScale));
}

/** the channel a creature attacks on when its hit has no move class of its own (an enemy's contact, shots and
 *  slams): whichever of Attack and Sp. Atk is higher, Attack on a tie */
export function channelOf(sp: SpeciesDef): Channel {
  return sp.stats.spa > sp.stats.atk ? 'special' : 'physical';
}

/** the guard a creature divides incoming damage of a channel by: m(Def) for physical, m(SpD) for special */
export function guardOf(sp: SpeciesDef, cls: Channel, rules: Rules): number {
  return statMult(cls === 'special' ? sp.stats.spd : sp.stats.def, rules);
}
