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
import { SPECIES, SPECIES_BY_ID, type SpeciesDef } from '../../rules/species';
import { enemyRadius, partnerRadius } from '../../rules/sizing';
import { spawnableSpecies, type SpawnPoolDef } from '../../rules/spawning';
import { LOCATIONS } from '../locations';
import { HABITATS } from './recipes';
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

/** body and locomotion profiles from the sim's rules and the roster (docs/HABITATS.md, "Roster assumptions").
 *  Every body comes from the size classes (src/rules/sizing.ts), the same numbers the sim collides with:
 *    trainer     the widest partner body (rules.size.playerRadius clamps it); eyes from the sprite heights, as before
 *    wild-small  the narrowest ground body any spawn pool can field
 *    wild-elite  the widest ground body the director spawns: any pool's ground species at ×1, an elite at the elite
 *                role size, never under the validated headroom below
 *    boss        the widest ground boss at the boss role size (bosses keep their authored encounter body)
 *  Which species count is read from the spawn pools (src/rules/spawning.ts: region presets, every named preset and
 *  every map source's own pool), not from the whole roster, so a species no pool fields never widens a route. With
 *  rules.size.geometry off the old sprite-height bodies and the shared partner radius come back. */
export function profilesFor(rules: Rules = defaultRules, dropNav = 4): BodyProfile[] {
  const R = rules.player, jumpApex = (R.jumpVelocity * R.jumpVelocity) / (2 * R.gravity);
  const line = playableLine();
  // eye / muzzle heights stay on the sprite-derived height: the sim fires every partner's shots from a fixed +0.8 m
  // (sim/moves.ts), so the size classes widen bodies but do not raise a muzzle, and the validated marker bracket holds
  const hMin = Math.min(...line.map((s) => s.height)), hMax = Math.max(...line.map((s) => s.height));
  const trainerR = Math.max(...line.map((s) => partnerRadius(s, rules)));
  const pools: SpawnPoolDef[] = [...Object.values(LOCATIONS), ...Object.values(HABITATS)].flatMap((d) => (d.spawns ? [d.spawns] : []));
  const fielded = spawnableSpecies(pools);
  const ground = (ids: Set<string>) => [...ids].map((id) => SPECIES_BY_ID[id]).filter((s): s is SpeciesDef => !!s && !s.boss && !s.flying);
  const wild = ground(fielded.spawns), elites = ground(fielded.elites);
  const bosses = SPECIES.filter((s) => s.boss && !s.flying);
  const eliteSize = rules.enemy.roles.elite.size;
  // VALIDATED_ELITE_R is the headroom every shipped map and `docs/habaudit/baseline.json` was accepted against. The
  // gate keeps it as a floor so a roster or pool change cannot quietly loosen the approaches; raising it is a deliberate
  // act that needs a HAB_VERSION bump and a new baseline.
  const VALIDATED_ELITE_R = 1.42;
  const wMin = Math.min(...wild.map((s) => enemyRadius(s, 1, rules)));
  const wBig = Math.max(VALIDATED_ELITE_R, ...wild.map((s) => enemyRadius(s, 1, rules)), ...elites.map((s) => enemyRadius(s, eliteSize, rules)));
  const bMax = Math.max(...bosses.map((s) => enemyRadius(s, rules.enemy.roles.boss.size, rules)));
  // shots leave the player at +0.7 m (sim/effects.ts) and enemies aim at the chest (+0.9 m); eyes sit near the top
  return [
    { id: 'trainer', radius: +trainerR.toFixed(2), step: R.stepHeight, climb: R.stepHeight, drop: dropNav, eye: [0.7, +(hMax * 0.8).toFixed(2)], speed: R.baseSpeed, essential: true, note: `every playable Pokémon (${line.length} species, ${hMin}–${hMax} m tall, the widest body r ${trainerR.toFixed(2)}), jump and glide disabled` },
    { id: 'trainer-jump', radius: +trainerR.toFixed(2), step: R.stepHeight, climb: +(jumpApex + R.stepHeight).toFixed(2), drop: Infinity, eye: [0.7, +(hMax * 0.8).toFixed(2)], speed: R.baseSpeed, essential: false, note: `ordinary jump (apex ${jumpApex.toFixed(2)} m) and any drop: only used to prove there is no player-only perch` },
    { id: 'wild-small', radius: +wMin.toFixed(2), step: 0.6, climb: 0.6, drop: dropNav, eye: [0.5, 0.9], speed: 3.5, essential: true, note: `narrowest ground body a spawn pool fields (${wild.length} ground species)` },
    { id: 'wild-elite', radius: +wBig.toFixed(2), step: 0.6, climb: 0.6, drop: dropNav, eye: [0.9, 1.4], speed: 3.5, essential: true, note: `largest ground body the director spawns (elite-capable at ×${eliteSize}, any other ground wild Pokémon at ×1), never under the validated ${VALIDATED_ELITE_R} m headroom` },
    { id: 'boss', radius: +bMax.toFixed(2), step: 0.6, climb: 0.6, drop: dropNav, eye: [1.2, 2.5], speed: 3, essential: false, note: 'largest ground boss (bosses arrive after the objectives close; reported, not gated)' },
  ];
}
