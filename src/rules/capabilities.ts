// Capability tags (blueprint sections 5, 7 and 12, Phase 8a).
//
// Every compiled move carries the capabilities it can exercise, derived once from its type, damage class,
// base power and shape. They are data, not code: the sim's resolver (sim/capabilities.ts) reads them, the UI
// shows them on cards and in the move tooltip, and later phases (transforms, techniques, offer weights) edit
// or count them.
//
//   hit            - damages integrity through the type chart (every damaging move)
//   push:P         - Water moves, physical Fighting / Rock / Ground moves, special Flying moves, dash moves
//   hold:P         - binding and telekinetic moves (HOLD_MOVES)
//   apply:agent    - Fire, Water, Ice and Electric moves carry Heat, Wet, Cold and Charge
//   create:template - leaves a body where it lands (Rock Throw's rock); comes from Tag Action data
//
// Power from base power: under 60 = 1, 60-90 = 2, over 90 = 3 (a combined force can reach 4).

import type { Element } from './elements';
import type { AgentName } from './reactions';

export type CapVerb = 'hit' | 'push' | 'hold' | 'deflect' | 'apply' | 'create';

export type Cap =
  | { verb: 'push' | 'hold'; power: 1 | 2 | 3 | 4 }
  | { verb: 'apply'; agent: AgentName; depth: 1 | 2 }
  | { verb: 'create'; template: string }
  | { verb: 'hit' };

/** what a capability needs from a move: the compiled spec's identity fields */
export interface CapSource {
  key: string;
  element: Element;
  cls: 'physical' | 'special' | 'status';
  archetype: string;
  power: number;
}

/** binding and telekinetic moves. Confusion and Psychic are listed for the Psychic recruit (not yet in the content) */
export const HOLD_MOVES: ReadonlySet<string> = new Set(['vine_whip', 'wrap', 'bind', 'confusion', 'psychic', 'whirlpool', 'fire_spin']);

/** per-move edits on top of the derived capabilities (transforms in Phase 8b write here too) */
export const CAP_OVERRIDES: Record<string, { add?: Cap[]; remove?: CapVerb[] }> = {};

export const capPower = (p: number): 1 | 2 | 3 => (p <= 0 || p < 60 ? 1 : p <= 90 ? 2 : 3);

const AGENT_OF: Partial<Record<Element, AgentName>> = { blaze: 'heat', tide: 'wet', frost: 'cold', volt: 'charge' };

/** Push Power from the derivation rule (0 = cannot push) */
export function derivePush(s: CapSource): number {
  if (s.cls === 'status') return 0;
  const el = s.element;
  if (el === 'tide' || s.archetype === 'dash' || (s.cls === 'physical' && (el === 'brawl' || el === 'stone' || el === 'quake')) || (s.cls === 'special' && el === 'gale')) return capPower(s.power);
  return 0;
}

/** Hold Power from the derivation rule (0 = cannot hold) */
export function deriveHold(s: CapSource): number {
  return HOLD_MOVES.has(s.key) ? capPower(s.power) : 0;
}

/** Compile a move's capabilities. `depth` is the coat it applies when cast as a Move (deep); the basic attack
 *  applies light coats at cast time, so the tag records the move's own (deep) depth. */
export function compileCaps(s: CapSource, extra?: { create?: string }): Cap[] {
  const caps: Cap[] = [];
  if (s.cls !== 'status') caps.push({ verb: 'hit' });
  const push = derivePush(s);
  if (push) caps.push({ verb: 'push', power: push as 1 | 2 | 3 });
  const hold = deriveHold(s);
  if (hold) caps.push({ verb: 'hold', power: hold as 1 | 2 | 3 });
  const agent = AGENT_OF[s.element];
  if (agent && s.cls !== 'status') caps.push({ verb: 'apply', agent, depth: 2 });
  if (extra?.create) caps.push({ verb: 'create', template: extra.create });
  const o = CAP_OVERRIDES[s.key];
  if (!o) return caps;
  const kept = o.remove ? caps.filter((c) => !o.remove!.includes(c.verb)) : caps;
  return o.add ? [...kept.filter((c) => !o.add!.some((a) => a.verb === c.verb)), ...o.add] : kept;
}

/** the power of one verb in a capability list (0 = none) */
export function capOf(caps: readonly Cap[] | undefined, verb: 'push' | 'hold'): number {
  if (!caps) return 0;
  for (const c of caps) if (c.verb === verb) return (c as { power: number }).power;
  return 0;
}

/** short tags as shown on cards: hit, push:2, hold:1, apply:wet, create:rock */
export function capTag(c: Cap): string {
  switch (c.verb) {
    case 'push': case 'hold': return `${c.verb}:${c.power}`;
    case 'apply': return `apply:${c.agent}`;
    case 'create': return `create:${c.template}`;
    default: return c.verb;
  }
}
export const capTags = (caps: readonly Cap[] | undefined) => (caps ?? []).map(capTag);

/** player-facing label for a tag line: "Push 2 · Apply Wet" (Hit is implied by any damaging move) */
export function capLabel(caps: readonly Cap[] | undefined): string {
  const out: string[] = [];
  for (const c of caps ?? []) {
    if (c.verb === 'push') out.push(`Push ${c.power}`);
    else if (c.verb === 'hold') out.push(`Hold ${c.power}`);
    else if (c.verb === 'apply') out.push(`Apply ${c.agent[0].toUpperCase()}${c.agent.slice(1)}`);
    else if (c.verb === 'create') out.push(`Create ${c.template}`);
  }
  return out.join(' · ');
}

/** Weight of a projectile as a light body: shots 0; lobs and heavy shots (radius >= heavyRadius) 1 */
export function shotWeight(lob: boolean, radius: number, heavyRadius: number): number {
  return lob || radius >= heavyRadius ? 1 : 0;
}
