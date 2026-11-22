import type { DeepPartial } from '../core/util';
import type { Rules } from '../rules/defaults';
import type { Hit, SimContext, System } from '../sim/types';

/** Hooks fire at gameplay moments. Keep this list short; add one when a second mod needs it. */
export interface Hooks {
  modifyDamage(ctx: SimContext, hit: Hit): void; // mutate hit.amount / hit.crit etc.
  onKill(ctx: SimContext, enemy: number): void;
  onLevelUp(ctx: SimContext): void;
  onStageStart(ctx: SimContext): void;
  onTick(ctx: SimContext): void;
}

export interface Mod {
  id: string;
  name: string;
  description?: string;
  rules?: DeepPartial<Rules>;
  hooks?: Partial<Hooks>;
  /** insert / remove / replace simulation systems */
  systems?: (list: System[]) => System[];
  /** every species the mod's systems can put on the field: their art loads before the match starts (sim/matchart.ts) */
  shows?: readonly string[];
}

export interface Mode {
  id: string;
  name: string;
  description: string;
  rules?: DeepPartial<Rules>;
  mods?: Mod[];
}
