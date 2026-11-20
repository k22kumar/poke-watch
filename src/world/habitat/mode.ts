// The match topology, described apart from any habitat: a shared control point (the sim's Hold objective) with two
// sides. In this game the sides are the trainer's squad (team A, which holds the point) and the wild horde (team B,
// whose Raiders drain it); both get the same contract, so the topology also serves a future two-team mode.
//
//   spawnA → stageA ─┬─ direct ─┐            ┌─ direct ─┬─ stageB ← spawnB
//                    └─ flank ──┴→ contest ←─┴─ flank ──┘
//                         contest → (return) → stageA, stageB
//
// Each approach edge carries the requirements validate.ts checks on the finished map (width from the largest body,
// headroom over the deck clearance, grade and step from the sim's movement rules, exposure, approach group).
// Movement profiles come from the sim's rules and the roster's real dimensions (profilesFor).
import { defaultRules, type Rules } from '../../rules/defaults';
import { SPECIES, type SpeciesDef } from '../../rules/species';
import { partnerFootprint } from '../../rules/sizing';
import type { BodyProfile, EdgeReq, ModeGraph } from './types';

const approach = (group: string, exposure: EdgeReq['exposure']): EdgeReq => ({ width: 5, clearance: 2.9, grade: 0.5, step: 0.6, rise: 8, exposure, group });

export const CONTROL_POINT: ModeGraph = {
  id: 'control-point',
  name: 'Shared control point',
  objective: 'hold',
  contestR: defaultRules.objectives.hold.radius,
  nodes: [
    { id: 'spawnA', role: 'spawn', team: 'A' }, { id: 'stageA', role: 'staging', team: 'A' },
    { id: 'A.direct', role: 'approach', team: 'A' }, { id: 'A.flank', role: 'approach', team: 'A' },
    { id: 'contest', role: 'contest', team: 'neutral' },
    { id: 'B.direct', role: 'approach', team: 'B' }, { id: 'B.flank', role: 'approach', team: 'B' },
    { id: 'stageB', role: 'staging', team: 'B' }, { id: 'spawnB', role: 'spawn', team: 'B' },
    { id: 'exitA', role: 'exit', team: 'A' }, { id: 'exitB', role: 'exit', team: 'B' },
  ],
  edges: [
    { from: 'spawnA', to: 'stageA', directed: false, kind: 'stage', req: { ...approach('A.stage', 'any'), width: 6 } },
    { from: 'stageA', to: 'A.direct', directed: true, kind: 'direct', req: approach('A1', 'any') },
    { from: 'stageA', to: 'A.flank', directed: true, kind: 'flank', req: approach('A2', 'screened') },
    { from: 'A.direct', to: 'contest', directed: true, kind: 'direct', req: approach('A1', 'any') },
    { from: 'A.flank', to: 'contest', directed: true, kind: 'flank', req: approach('A2', 'screened') },
    { from: 'spawnB', to: 'stageB', directed: false, kind: 'stage', req: { ...approach('B.stage', 'any'), width: 6 } },
    { from: 'stageB', to: 'B.direct', directed: true, kind: 'direct', req: approach('B1', 'any') },
    { from: 'stageB', to: 'B.flank', directed: true, kind: 'flank', req: approach('B2', 'screened') },
    { from: 'B.direct', to: 'contest', directed: true, kind: 'direct', req: approach('B1', 'any') },
    { from: 'B.flank', to: 'contest', directed: true, kind: 'flank', req: approach('B2', 'screened') },
    { from: 'contest', to: 'exitA', directed: true, kind: 'return', req: approach('A.exit', 'any') },
    { from: 'contest', to: 'exitB', directed: true, kind: 'return', req: approach('B.exit', 'any') },
  ],
};

/** every species the trainer can field: the partners and everything they evolve into */
export function playableLine(): SpeciesDef[] {
  const by = new Map(SPECIES.map((s) => [s.id, s]));
  const out = new Set<SpeciesDef>();
  for (const s of SPECIES) if (s.playable) for (let c: SpeciesDef | undefined = s; c && !out.has(c); c = c.evolvesTo ? by.get(c.evolvesTo) : undefined) out.add(c);
  return [...out];
}

/** The body numbers every shipped habitat map and `docs/habaudit/baseline.json` were accepted against, frozen
 *  (docs/hero-shooter-pivot.md §8 step 3). They used to be measured from the roster and the spawn pools: the trainer
 *  from the widest playable footprint and the tallest playable sprite, the wild bodies from what any pool fields, the
 *  boss from the widest ground boss. The pools are going away and the roster is growing, so the profiles no longer
 *  read either: a roster change can't move a layout. Changing a number here is a deliberate act that needs a
 *  HAB_VERSION bump and a new baseline. `measuredProfileInputs` keeps the roster measurement for the gate in
 *  tests/habitat.test.ts, which fails when the playable roster outgrows the frozen trainer. */
export const VALIDATED_PROFILES = {
  /** the widest partner footprint (an Extra Large partner) */
  trainerRadius: 0.88,
  /** eye / muzzle bracket: shots leave at +0.7 m, the top is 0.8 × the tallest playable sprite (1.77 m) */
  trainerEye: [0.7, 1.42] as [number, number],
  /** the trainer's planar speed the maps were timed with (rules.player.baseSpeed when they were accepted) */
  trainerSpeed: 7.2,
  /** the narrowest ground body a spawn pool fielded (the Tiny footprint) */
  wildSmallRadius: 0.3,
  /** the widest ground body the director spawned, the validated elite headroom */
  wildEliteRadius: 1.42,
  /** the widest ground boss at the boss role size */
  bossRadius: 0.95,
} as const;

/** What the roster measures today for the trainer profile (the widest playable footprint, the eye top from the
 *  tallest playable sprite). Only the habitat test reads it, to refuse a roster that outgrows VALIDATED_PROFILES. */
export function measuredProfileInputs(rules: Rules = defaultRules): { trainerRadius: number; trainerEyeTop: number; species: number } {
  const line = playableLine();
  return {
    trainerRadius: Math.max(...line.map((s) => partnerFootprint(s, rules))),
    trainerEyeTop: Math.max(...line.map((s) => s.height)) * 0.8,
    species: line.length,
  };
}

/** body and locomotion profiles for habitat validation (docs/HABITATS.md, "Roster assumptions"). Every body is a
 *  movement footprint, the circle the sim collides with (World.moveBody), not the hurtbox. Sizes are the frozen
 *  VALIDATED_PROFILES; step, climb and the jump apex still come from the rules. */
export function profilesFor(rules: Rules = defaultRules, dropNav = 4): BodyProfile[] {
  const R = rules.player, jumpApex = (R.jumpVelocity * R.jumpVelocity) / (2 * R.gravity);
  const V = VALIDATED_PROFILES;
  const eye: [number, number] = [V.trainerEye[0], V.trainerEye[1]];
  // shots leave the player at +0.7 m (sim/effects.ts) and enemies aim at the chest (+0.9 m); eyes sit near the top
  return [
    { id: 'trainer', radius: V.trainerRadius, step: R.stepHeight, climb: R.stepHeight, drop: dropNav, eye, speed: V.trainerSpeed, essential: true, note: `every playable Pokémon (the widest body r ${V.trainerRadius}), jump and glide disabled` },
    { id: 'trainer-jump', radius: V.trainerRadius, step: R.stepHeight, climb: +(jumpApex + R.stepHeight).toFixed(2), drop: Infinity, eye: [eye[0], eye[1]], speed: V.trainerSpeed, essential: false, note: `ordinary jump (apex ${jumpApex.toFixed(2)} m) and any drop: only used to prove there is no player-only perch` },
    { id: 'wild-small', radius: V.wildSmallRadius, step: 0.6, climb: 0.6, drop: dropNav, eye: [0.5, 0.9], speed: 3.5, essential: true, note: 'narrowest ground wild body (the Tiny footprint)' },
    { id: 'wild-elite', radius: V.wildEliteRadius, step: 0.6, climb: 0.6, drop: dropNav, eye: [0.9, 1.4], speed: 3.5, essential: true, note: `largest ground wild body, the validated ${V.wildEliteRadius} m headroom` },
    { id: 'boss', radius: V.bossRadius, step: 0.6, climb: 0.6, drop: dropNav, eye: [1.2, 2.5], speed: 3, essential: false, note: 'largest ground boss (reported, not gated)' },
  ];
}
