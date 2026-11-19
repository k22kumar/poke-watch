import type { Rules } from './defaults';
import { SIZE_CLASS_IDS, sizeClassIndex, speciesExtent } from './extent';
import type { Behaviour, SpeciesDef } from './species';

// The default role rule (docs/SPECIES.md "Default roles"; owner-approved 2026-11-18, docs/size-extremes-plan.md §S2).
// A wild roster entry that names no behaviour takes one from data the import already carries: base stats, official
// types, shape and abilities, and the canonical level-up moves (canon.levelUp and canon.levelUpOther). Nothing is
// per species, so a new generation needs data only. A field the roster entry sets always wins (content/roster.json):
// the hand roles written before the rule keep theirs.
//
// The first matching row decides (thresholds in rules.wildRole):
//   healer   learns an ally-heal move at level-up, base-stat total under healBstBelow
//   swarm    flies, extent class swarmMaxClass or smaller, base-stat total at most swarmBstMax
//   ranged   Sp. Atk ≥ Atk + rangedMargin (no `shot`: the sim fires the primary type's element)
//   tank     HP + Def ≥ tankRatio × (max(Atk, Sp. Atk) + Speed)
//   charger  Speed ≥ chargerSpeed
//   chase    otherwise
//
// The class is the extent's (src/rules/extent.ts), with no pinned class, so the rule can run while the roster loads.

export interface DefaultRole {
  behaviour: Behaviour;
  flying: boolean;
  /** the row that decided, for reports and the developer roster */
  why: string;
}

const bstOf = (sp: SpeciesDef) => sp.stats.hp + sp.stats.atk + sp.stats.def + sp.stats.spa + sp.stats.spd + sp.stats.spe;

/** Does the default rule make this species a flyer? (an authored `flying` on the roster entry wins over it) */
export function defaultFlying(sp: SpeciesDef, R: Rules['wildRole']): boolean {
  const types = sp.types ?? [], shape = sp.canon?.shape ?? '';
  if (types.includes('flying')) return !R.groundedShapes.includes(shape);
  if ((sp.canon?.abilities ?? []).some((a) => R.floatAbilities.includes(a))) return true;
  if (R.floatShapes.includes(shape)) return true;
  return types.includes('ghost') && R.ghostFloatShapes.includes(shape);
}

/** The behaviour and flight the default rule gives a wild species, under these rules. */
export function defaultRole(sp: SpeciesDef, rules: Pick<Rules, 'wildRole' | 'size'>): DefaultRole {
  const R = rules.wildRole, s = sp.stats, bst = bstOf(sp);
  const flying = defaultFlying(sp, R);
  const learns = new Set([...(sp.canon?.levelUp ?? []).map(([, k]) => k), ...(sp.canon?.levelUpOther ?? [])]);
  const heal = R.healMoves.filter((k) => learns.has(k));
  const cls = sizeClassIndex(speciesExtent(sp, rules.size).m, rules.size);
  const off = Math.max(s.atk, s.spa);
  if (heal.length && bst < R.healBstBelow) return { behaviour: 'healer', flying, why: `ally-heal ${heal.join('/')}, BST ${bst} < ${R.healBstBelow}` };
  if (flying && cls <= SIZE_CLASS_IDS.indexOf(R.swarmMaxClass) && bst <= R.swarmBstMax) return { behaviour: 'swarm', flying, why: `flyer, ${SIZE_CLASS_IDS[cls]}, BST ${bst} ≤ ${R.swarmBstMax}` };
  if (s.spa >= s.atk + R.rangedMargin) return { behaviour: 'ranged', flying, why: `Sp. Atk ${s.spa} ≥ Atk ${s.atk} + ${R.rangedMargin}` };
  if (s.hp + s.def >= R.tankRatio * (off + s.spe)) return { behaviour: 'tank', flying, why: `HP + Def ${s.hp + s.def} ≥ ${R.tankRatio} × ${off + s.spe}` };
  if (s.spe >= R.chargerSpeed) return { behaviour: 'charger', flying, why: `Speed ${s.spe} ≥ ${R.chargerSpeed}` };
  return { behaviour: 'chase', flying, why: `Speed ${s.spe} < ${R.chargerSpeed}` };
}
