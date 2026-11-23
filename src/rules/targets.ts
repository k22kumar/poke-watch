// Training targets (T0; docs/hero-shooter-pivot.md §5, Q16, Q17, Q20). A target set is data: each target is a species, a
// kind, where it stands (an anchor on the map plus an offset) and, for a patrol, the loop it walks. The sim side is
// src/sim/targets.ts. Targets are ordinary enemy actors (size-class bodies and hurtboxes, so aim, beams, cover and hit
// tests work unchanged), with canon-curve health (src/rules/stats.ts) and no survivor difficulty curves.
//   dummy   stands still and never touches you
//   patrol  walks its loop (offsets from its anchor) and never touches you
//   strafe  the ranged behaviour (keeps its distance, shoots) at rules.targets.strafeDamage of its damage
// Respawn is a fixed tick count (rules.targets.respawn), no RNG.

type TargetKind = 'dummy' | 'patrol' | 'strafe';
/** where on the map: the player's spawn, or a habitat ModeGraph place (the contest, team A's or B's staging) */
export type AnchorFrom = 'spawn' | 'contest' | 'stageA' | 'stageB';
interface TargetDef {
  species: string;
  kind: TargetKind;
  from: AnchorFrom;
  /** metres from the anchor */
  dx: number; dz: number;
  /** patrol: the loop, metres from the anchor (it walks to each in turn and back to the first) */
  path?: [number, number][];
}
export interface TargetSet { id: string; targets: TargetDef[] }

/** the training range's set: two dummies, a patrol loop and a strafer, around the spawn */
export const RANGE_TARGETS: TargetSet = {
  id: 'range',
  targets: [
    { species: 'geodude', kind: 'dummy', from: 'spawn', dx: 0, dz: -8 },
    { species: 'snorlax', kind: 'dummy', from: 'spawn', dx: 6, dz: -12 },
    { species: 'rattata', kind: 'patrol', from: 'spawn', dx: -6, dz: -10, path: [[-6, -10], [-6, -16], [2, -16], [2, -10]] },
    { species: 'gastly', kind: 'strafe', from: 'spawn', dx: -10, dz: -4 },
  ],
};

/** a habitat map's set: on the contest and on team B's staging (the Hold's two ends) */
export const HABITAT_TARGETS: TargetSet = {
  id: 'habitat',
  targets: [
    { species: 'geodude', kind: 'dummy', from: 'contest', dx: 2, dz: 0 },
    { species: 'rattata', kind: 'patrol', from: 'contest', dx: -3, dz: 0, path: [[-3, 0], [-3, 4], [3, 4], [3, 0]] },
    { species: 'gastly', kind: 'strafe', from: 'stageB', dx: 0, dz: 0 },
  ],
};

