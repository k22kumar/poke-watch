// The build layer (blueprint section 6, Phase 8b): transforms and techniques as data.
//
// A transform is a small edit to one move's compiled spec plus its capability tags. Each move below has exactly two,
// A and B, and they are mutually exclusive: taking one removes the other from the run. A transform never changes a
// move's type (so agents still follow type) and may only add a force verb (Push, Hold) that the Pokémon's line already
// has somewhere in its learnset or Tag Action (pillar 3: "no new capability from nowhere"; sim/build.ts checks it).
//
// A technique is a trainer-wide rule with a written gain and a written cost. The trainer holds at most three; they apply
// to whichever Pokémon is on the field. Their numbers are tunables in rules.build.tech (src/rules/defaults.ts).

import type { Cap, CapVerb } from './capabilities';

/** fields a transform may set on a compiled move spec (the sim reads them; see sim/moves.ts and sim/effects.ts) */
export interface MoveFlags {
  /** the transform applied (id) */
  xf?: string;
  /** angle between projectiles of one cast (rad); straight shots only */
  spread?: number;
  /** coat depth this move always applies (1 light, 2 deep), whatever slot casts it */
  coatDepth?: number;
  /** pierce does not grow with move level */
  fixedPierce?: boolean;
  /** s the caster cannot walk after it fires */
  selfRoot?: number;
  /** a strike that hits only the target nearest its centre */
  single?: boolean;
  /** radius (m) of Heat put on the ground where the shot ends */
  landHeat?: number;
  /** radius (m) of the Grass patch (Create) a lob leaves where it lands */
  bramble?: number;
  /** Hold suspends Light creatures (not only bodies and shots) */
  lasso?: boolean;
  /** root time (s) this move's root ailment applies */
  ccT?: number;
  /** length (m) of the Heat trail a dash leaves behind */
  trailHeat?: number;
}

export interface TransformDef {
  id: string;
  move: string;
  side: 'A' | 'B';
  title: string;
  /** player-facing gain and cost (cards, tooltips) */
  gain: string;
  cost: string;
  /** fields replaced on the compiled spec */
  set?: Partial<Record<'archetype', string>> & Partial<Record<'range' | 'radius' | 'duration' | 'knock' | 'pierce' | 'count' | 'speed' | 'ailmentChance', number>> & { ailment?: 'root' } & MoveFlags;
  /** fields multiplied on the compiled spec (after `set`) */
  mul?: Partial<Record<'dmg' | 'cd' | 'range' | 'radius' | 'duration' | 'knock', number>>;
  /** capability edits after the caps are re-derived from the edited spec (an added verb replaces the same verb) */
  caps?: { add?: Cap[]; remove?: CapVerb[] };
}

// Damage and cooldown edits keep damage per second per target close to the base move (a transform changes what the
// move does, not how hard it hits); the gain is a shape, a verb or a rule, and the cost is one too.
export const TRANSFORMS: TransformDef[] = [
  // Water Gun (bolt, Push 1, Wet): control vs coverage
  { id: 'pressure_jet', move: 'water_gun', side: 'A', title: 'Pressure Jet',
    gain: 'A 10 m beam with Push 2: rolls rocks, shoves a line of enemies, deflects shots along it',
    cost: 'You are rooted for 0.3 s each time it fires',
    set: { archetype: 'beam', range: 10, radius: 0.55, duration: 0.25, pierce: -1, knock: 6, selfRoot: 0.3 }, mul: { dmg: 1.5, cd: 1.5 },
    caps: { remove: ['push'], add: [{ verb: 'push', power: 2 }] } },
  { id: 'scatter', move: 'water_gun', side: 'B', title: 'Scatter',
    gain: '3 shots in a 40° fan; every shot leaves a light Wet coat, even as Move A or B',
    cost: 'No Push; each shot stops at the first enemy and hits for half',
    set: { count: 3, spread: 0.35, pierce: 0, fixedPierce: true, coatDepth: 1 }, mul: { dmg: 0.5 },
    caps: { remove: ['push', 'apply'], add: [{ verb: 'apply', agent: 'wet', depth: 1 }] } },
  // Ember (bolt, Heat): area setup vs focused damage
  { id: 'kindle', move: 'ember', side: 'A', title: 'Kindle',
    gain: 'Where it lands, the ground in 1.6 m gets Heat: lights grass, dries Wet, thaws ice',
    cost: 'Stops at the first enemy it hits (no pierce)',
    set: { landHeat: 1.6, pierce: 0, fixedPierce: true } },
  { id: 'searing', move: 'ember', side: 'B', title: 'Searing',
    gain: 'Pierces 1 enemy and always leaves a deep Heat coat, even as the basic attack (elites and bosses too)',
    cost: 'Range −30%; pierce never grows with move level',
    set: { pierce: 1, fixedPierce: true, coatDepth: 2 }, mul: { range: 0.7 } },
  // Flame Wheel (dash, Push 2, Heat): moving objects vs moving yourself
  { id: 'ram', move: 'flame_wheel', side: 'A', title: 'Ram',
    gain: 'Push 3: rolls a boulder (Weight 3) on its own; enemies are knocked back as before',
    cost: 'Dash distance −25%',
    mul: { duration: 0.75 }, caps: { add: [{ verb: 'push', power: 3 }] } },
  { id: 'wheel_trail', move: 'flame_wheel', side: 'B', title: 'Wheel Trail',
    gain: 'Leaves a 4 m Heat trail for 3 s: lights grass, coats whatever crosses it',
    cost: 'Push 2 → Push 1 (a rock no longer rolls; knockback weaker)',
    set: { trailHeat: 4, knock: 5 }, caps: { add: [{ verb: 'push', power: 1 }] } },
  // Vine Whip (strike, Hold 1): manipulation vs control
  { id: 'lasso', move: 'vine_whip', side: 'A', title: 'Lasso',
    gain: 'Hold 2: suspends rocks (Weight 2) and Light enemies 1.5 m in front of you, then throws them along your aim',
    cost: 'Catches one target per lash (no area)',
    set: { single: true, lasso: true }, caps: { add: [{ verb: 'hold', power: 2 }] } },
  { id: 'snare', move: 'vine_whip', side: 'B', title: 'Snare',
    gain: 'Every lash roots what it hits for 0.8 s (through the crowd-control meter)',
    cost: 'No Hold: it can no longer catch shots, rubble or Light enemies',
    set: { ailment: 'root', ailmentChance: 1, ccT: 0.8 }, caps: { remove: ['hold'] } },
  // Seed Bomb (lob): swarm clear vs zone
  { id: 'cluster', move: 'seed_bomb', side: 'A', title: 'Cluster',
    gain: '3 small lobs scattered around the target',
    cost: 'Each blast is 45% as wide and hits for 45%',
    set: { count: 3 }, mul: { radius: 0.55, dmg: 0.45 } },
  { id: 'burrow', move: 'seed_bomb', side: 'B', title: 'Burrow',
    gain: 'Leaves a 2.2 m Grass patch for 10 s (Create): enemies that are not Grass type cross it at 55% speed; it burns',
    cost: 'Blast 30% narrower and 20% weaker',
    set: { bramble: 2.2 }, mul: { radius: 0.7, dmg: 0.8 }, caps: { add: [{ verb: 'create', template: 'bramble' }] } },
  // Bite (strike, Dark): control the target vs reposition yourself. Not specified by the blueprint; Poke-Watch's own pair.
  { id: 'crunch_down', move: 'bite', side: 'A', title: 'Crunch Down',
    gain: 'Push 2 on one target: knocks it back hard enough to break a Bulwark guard, rolls rocks',
    cost: 'Bites one target (no area). Needs a line that can already push (Totodile, Squirtle, Rattata…)',
    set: { single: true, knock: 9 }, caps: { add: [{ verb: 'push', power: 2 }] } },
  { id: 'lunge', move: 'bite', side: 'B', title: 'Lunge',
    gain: 'A 5 m lunge through the target: you travel, untouchable while lunging, biting along the way',
    cost: 'Cooldown ×1.5; no Push',
    set: { archetype: 'dash', range: 5, radius: 1.3, duration: 0.2, knock: 4 }, mul: { cd: 1.5 }, caps: { remove: ['push'] } },
];
export const TRANSFORM_BY_ID: Record<string, TransformDef> = Object.fromEntries(TRANSFORMS.map((t) => [t.id, t]));
export const TRANSFORMS_OF: Record<string, TransformDef[]> = {};
for (const t of TRANSFORMS) (TRANSFORMS_OF[t.move] ??= []).push(t);

/** what a technique hooks into (blueprint section 12) */
export type TechHook = 'capability' | 'reaction' | 'deflect' | 'tag' | 'dash' | 'hold' | 'guard' | 'body';

export interface TechniqueDef {
  id: string;
  title: string;
  gain: string;
  cost: string;
  /** capability tags it works with (offer synergy): verbs and agents, 'apply' = any agent, 'tag' = a squad */
  tags: string[];
  on: TechHook;
}

export const TECHNIQUES: TechniqueDef[] = [
  { id: 'undertow', title: 'Undertow', on: 'capability', tags: ['push', 'apply:wet'],
    gain: 'Your Pushes also Apply Wet: to what they hit, and to the ground under a rock they roll',
    cost: 'Your Push moves deal 20% less damage' },
  { id: 'riposte', title: 'Riposte', on: 'deflect', tags: ['deflect'],
    gain: 'A Guard deflect or parry refunds your Move A cooldown',
    cost: 'No Brace: Guard is a tap only (it ends when the deflect window closes)' },
  { id: 'lodestone', title: 'Lodestone', on: 'hold', tags: ['hold'],
    gain: 'Your Holds have +1 Power and last up to 1.5 s (Lasso + Lodestone catches a boulder)',
    cost: 'You cannot walk while you hold something' },
  { id: 'heavy_footing', title: 'Heavy Footing', on: 'guard', tags: ['deflect'],
    gain: '+1 Weight class for Guard (deflect heavier shots and bodies, up to Heavy) and half the knockback',
    cost: 'Move speed −15%; your Dash is 30% shorter' },
  { id: 'catalyst', title: 'Catalyst', on: 'reaction', tags: ['apply'],
    gain: 'A reaction you trigger takes 1 s off Move A and Move B',
    cost: 'Your basic attack applies no light coats' },
  { id: 'slipstream', title: 'Slipstream', on: 'dash', tags: ['apply'],
    gain: 'Dashing through a coated enemy copies its coat onto your next Move A or B (deep)',
    cost: 'Dash costs 1.3 Reflex charges' },
  { id: 'quarry', title: 'Quarry', on: 'body', tags: ['push', 'hold'],
    gain: 'Rocks and boulders you break leave 2 extra rubble pieces, yours, flung outward',
    cost: 'Your hits deal 25% less integrity damage to bodies' },
  { id: 'second_wind', title: 'Second Wind', on: 'tag', tags: ['tag'],
    gain: 'Tagging in clears the incoming Pokémon\'s coat',
    cost: 'Tag cooldown 5 s instead of 4 s' },
];
export const TECHNIQUE_BY_ID: Record<string, TechniqueDef> = Object.fromEntries(TECHNIQUES.map((t) => [t.id, t]));
/** bit of each technique in Player.techMask */
export const TECH_BIT: Record<string, number> = Object.fromEntries(TECHNIQUES.map((t, i) => [t.id, 1 << i]));
export const TB = {
  undertow: TECH_BIT.undertow, riposte: TECH_BIT.riposte, lodestone: TECH_BIT.lodestone, heavy: TECH_BIT.heavy_footing,
  catalyst: TECH_BIT.catalyst, slipstream: TECH_BIT.slipstream, quarry: TECH_BIT.quarry, secondWind: TECH_BIT.second_wind,
} as const;
