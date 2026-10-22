// Enemy compositions (blueprint section 9): small groups the beat director sends at a Peak, each built
// to ask one question. Members are described by job, not by species, and are filled from the region's own
// wild Pokémon (spawns and elites), so a composition reads the same in every region but looks different.
// A composition whose jobs a region cannot fill is skipped there.

import type { Element } from './elements';
import { SPECIES_BY_ID, type SpeciesDef } from './species';
import type { StageDef } from './stages';

/** a member's job: who can fill it */
export type Job = 'pursuer' | 'ranged' | 'tank' | 'mender' | 'hexer' | 'raider' | 'charger';

export interface MemberDef {
  job: Job;
  count: number;
  /** only species carrying this agent element (a Wet Hexer, Electric chargers) */
  element?: Element;
  /** role bits added on top of the species' own (pools.ts ROLE) */
  roles: number;
}

export interface CompositionDef {
  id: string;
  name: string;
  /** the decision it asks of the player, for docs and the tuning panel */
  question: string;
  members: MemberDef[];
  /** 'peak' = any peak; 'objective' = sent while an objective is active */
  when: 'peak' | 'objective';
  weight: number;
}

// role bits (duplicated from sim/pools.ts ROLE to keep rules free of sim imports)
const R = { elite: 1, healer: 32, shielder: 64, hexer: 128, raider: 256 };

export const COMPOSITIONS: CompositionDef[] = [
  {
    id: 'wall-and-guns', name: 'Wall and guns', when: 'peak', weight: 3,
    question: 'Flank, go over the wall, or push the wall away?',
    members: [{ job: 'tank', count: 1, roles: R.shielder | R.elite }, { job: 'ranged', count: 2, roles: 0 }],
  },
  {
    id: 'pack-with-medic', name: 'Pack with a medic', when: 'peak', weight: 3,
    question: 'Kill the medic through the pack, or kite until it is exposed?',
    members: [{ job: 'pursuer', count: 6, roles: 0 }, { job: 'mender', count: 1, roles: R.healer }],
  },
  {
    id: 'soak-and-strike', name: 'Soak and strike', when: 'peak', weight: 4,
    question: 'Tag out the soaked Pokémon, jump the flood, or steam the water?',
    members: [{ job: 'hexer', count: 1, element: 'tide', roles: R.hexer }, { job: 'charger', count: 3, element: 'volt', roles: 0 }],
  },
  {
    id: 'hex-ambush', name: 'Hex ambush', when: 'peak', weight: 2,
    question: 'Get out of the puddle, or kill the Hexer first?',
    members: [{ job: 'hexer', count: 1, roles: R.hexer }, { job: 'pursuer', count: 4, roles: 0 }],
  },
  {
    id: 'raid-party', name: 'Raid party', when: 'objective', weight: 1,
    question: 'Defend the objective or chase the threat?',
    members: [{ job: 'raider', count: 4, roles: R.raider }, { job: 'tank', count: 1, roles: R.shielder }],
  },
];

/** species that can heal allies in a region that has no healer of its own (Present heals in the main games) */
const MENDERS = new Set(['paras', 'oddish', 'delibird']);
const AGENT_TYPES: Element[] = ['blaze', 'tide', 'frost', 'volt'];

export function agentElement(sp: SpeciesDef): Element | null {
  for (const e of sp.elements) if (AGENT_TYPES.includes(e)) return e;
  return null;
}

/** can this species do this job? */
export function fits(sp: SpeciesDef, m: MemberDef): boolean {
  const b = sp.behaviour ?? 'chase';
  if (m.element && !sp.elements.includes(m.element)) return false;
  switch (m.job) {
    case 'pursuer': return b === 'chase' || b === 'swarm' || b === 'charger';
    case 'charger': return b === 'charger';
    case 'ranged': return b === 'ranged';
    case 'tank': return b === 'tank';
    case 'mender': return b === 'healer' || MENDERS.has(sp.id);
    case 'hexer': return agentElement(sp) !== null;
    case 'raider': return (b === 'chase' || b === 'swarm' || b === 'charger') && !sp.flying;
  }
}

/** the region's wild Pokémon that can do each job of a composition, or null when one job has nobody */
export function resolve(def: CompositionDef, table: StageDef): SpeciesDef[][] | null {
  const pool = [...new Set([...table.spawns.map(([id]) => id), ...table.elites])].map((id) => SPECIES_BY_ID[id]).filter(Boolean);
  const out: SpeciesDef[][] = [];
  for (const m of def.members) {
    const can = pool.filter((sp) => fits(sp, m));
    if (!can.length) return null;
    out.push(can);
  }
  return out;
}

/** weather a region can have (Rain soaks, Sun dries and lights the grass) */
export const REGION_WEATHER: Record<string, ('rain' | 'sun')[]> = {
  meadow: ['rain', 'sun'], badlands: ['sun'], frost: [], dusk: ['rain'],
};
