import type { DeepPartial } from '../core/util';
import type { Rules } from '../rules/defaults';
import type { Card, Hit, SimContext, System } from '../sim/types';

/** Hooks fire at gameplay moments. Keep this list short; add one when a second mod needs it. */
export interface Hooks {
  modifyDamage(ctx: SimContext, hit: Hit): void; // mutate hit.amount / hit.crit etc.
  onKill(ctx: SimContext, enemy: number): void;
  onLevelUp(ctx: SimContext): void;
  filterCards(ctx: SimContext, cards: Card[]): Card[];
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
}

export interface Mode {
  id: string;
  name: string;
  description: string;
  rules?: DeepPartial<Rules>;
  mods?: Mod[];
}
