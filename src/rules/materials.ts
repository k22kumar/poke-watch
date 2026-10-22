// Bodies: objects that occupy space and can be moved (blueprint section 7). Every body has a Weight
// class (0-4) and a Pokémon type for damage, so the type chart decides what breaks it and how much
// its impact hurts. A force with Power >= Weight moves it; less only slows it.
import type { Element } from './elements';

export interface BodyTemplate {
  /** damage type when it is hit, and when it hits */
  type: Element;
  weight: 0 | 1 | 2 | 3 | 4;
  radius: number; // m
  integrity: number; // hit points; 0 = unbreakable
  /** rolling deceleration on plain ground (m/s²) */
  friction: number;
  /** seconds before it crumbles on its own (Infinity = stays) */
  life: number;
  /** what it breaks into */
  breaksInto?: { template: string; count: number; speedKeep: number };
  /** pixel sprite key and its scale */
  sprite: string; scale: number;
}

export const BODY_TEMPLATES: Record<string, BodyTemplate> = {
  // thrown by Rock-type bosses; Heavy, so only Heavy Pokémon can Guard it and only Power 3 moves it
  boulder: { type: 'stone', weight: 3, radius: 1.0, integrity: 120, friction: 1.6, life: 14, breaksInto: { template: 'rubble', count: 3, speedKeep: 0.5 }, sprite: 'bodyBoulder', scale: 2 },
  // loose rocks lying on the route; Medium, so Power 2 moves (Flame Wheel, Take Down, Bite…) roll them
  rock: { type: 'stone', weight: 2, radius: 0.7, integrity: 60, friction: 3.2, life: Infinity, breaksInto: { template: 'rubble', count: 2, speedKeep: 0.6 }, sprite: 'bodyRock', scale: 1.5 },
  // shrapnel from a break; Light, so anything with Power 1 can fling it
  // the Transport objective's egg: Medium (Power 2 pushes it), unbreakable, carried by walking into it
  egg: { type: 'plain', weight: 2, radius: 0.6, integrity: 0, friction: 5, life: Infinity, sprite: 'bodyEgg', scale: 1.2 },
  rubble: { type: 'stone', weight: 1, radius: 0.4, integrity: 12, friction: 6, life: 5, sprite: 'rockChunk', scale: 1 },
};
export const BODY_KINDS = Object.keys(BODY_TEMPLATES);
