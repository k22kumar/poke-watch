// The reaction table (blueprint section 8): one agent arriving on a creature that already carries a
// coat. Tiles keep their own chemistry in sim/cells.ts; creatures read this table. Four agents, four
// reactions and one cancel: there are no other elemental pairs.

import type { Element } from './elements';

/** coat / agent index on creatures: 0 = none */
export const AG = { none: 0, heat: 1, wet: 2, cold: 3, charge: 4 } as const;
export type AgentName = 'heat' | 'wet' | 'cold' | 'charge';
export const AGENT_NAMES: (AgentName | null)[] = [null, 'heat', 'wet', 'cold', 'charge'];
export const COAT_NAMES = ['', 'Scorched', 'Soaked', 'Chilled', 'Charged'] as const;

export type Reaction = 'refresh' | 'steam' | 'freeze' | 'conduct' | 'overload' | 'cancel' | 'none';

/** REACT[coat][arriving agent] */
export const REACT: Reaction[][] = [
  /* none    */ ['none', 'none', 'none', 'none', 'none'],
  /* heat    */ ['none', 'refresh', 'steam', 'cancel', 'overload'],
  /* wet     */ ['none', 'steam', 'refresh', 'freeze', 'conduct'],
  /* cold    */ ['none', 'cancel', 'freeze', 'refresh', 'none'],
  /* charge  */ ['none', 'overload', 'conduct', 'none', 'refresh'],
];

/** the agent a move type carries: Fire, Water, Ice and Electric */
export function agentIndex(el: Element): number {
  return el === 'blaze' ? AG.heat : el === 'tide' ? AG.wet : el === 'frost' ? AG.cold : el === 'volt' ? AG.charge : AG.none;
}

/** creatures of these types shrug off a coat: Fire ignores Heat, Ice ignores Cold, Electric and Ground ignore Charge */
export function coatImmune(types: readonly Element[], agent: number): boolean {
  if (agent === AG.heat) return types.includes('blaze');
  if (agent === AG.cold) return types.includes('frost');
  if (agent === AG.charge) return types.includes('volt') || types.includes('quake');
  return false;
}
