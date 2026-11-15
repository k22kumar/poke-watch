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
import { STAGE_TABLES } from '../../content/pokedex';
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
 *  The sim gives every playable Pokémon the same collision radius (rules.player.radius) and step; sprite height only
 *  changes where its eyes are, so the trainer extremes are the shortest and tallest of the playable line. Wild
 *  bodies use the sim's own radius formula (sim/enemies.ts: clamp(height × 0.4, 0.35, 3.2) × size). */
export function profilesFor(rules: Rules = defaultRules, dropNav = 4): BodyProfile[] {
  const R = rules.player, jumpApex = (R.jumpVelocity * R.jumpVelocity) / (2 * R.gravity);
  const line = playableLine();
  const hMin = Math.min(...line.map((s) => s.height)), hMax = Math.max(...line.map((s) => s.height));
  const rad = (s: SpeciesDef) => Math.min(3.2, Math.max(0.35, s.height * 0.4));
  const wild = SPECIES.filter((s) => !s.boss && !s.flying);
  const bosses = SPECIES.filter((s) => s.boss && !s.flying);
  const eliteSize = rules.enemy.roles.elite.size;
  // The biggest ground body the director actually spawns. Only a species listed in a region's
  // `elites` is ever spawned at elite or alpha scale (sim/director.ts), so the elite multiplier
  // belongs to those species alone; every other ground wild Pokémon appears at ×1. Multiplying the
  // tallest wild Pokémon instead would model a body that is never spawned: Onix is an ordinary
  // Badlands encounter (3.02 m, r 1.21), and at ×2 it would ask every approach to carry a 2.42 m
  // radius, which no recipe validates.
  //
  // VALIDATED_ELITE_R is the headroom every shipped map and `docs/habaudit/baseline.json` was
  // accepted against (Bayleef's 0.71 m body at ×2, from when this took max over the whole set,
  // partner forms included). The gate keeps it as a floor so adding or removing a roster entry
  // cannot quietly loosen the approaches; raising it is a deliberate act that needs a HAB_VERSION
  // bump and a new baseline.
  const VALIDATED_ELITE_R = 1.42;
  const eliteIds = new Set(STAGE_TABLES.flatMap((t) => t.elites));
  const elites = wild.filter((s) => eliteIds.has(s.id));
  const wMin = Math.min(...wild.map(rad));
  const wBig = Math.max(VALIDATED_ELITE_R, ...wild.map(rad), ...elites.map((s) => rad(s) * eliteSize));
  const bMax = Math.max(...bosses.map((s) => rad(s) * (rules.enemy.roles.boss.size)));
  // shots leave the player at +0.7 m (sim/effects.ts) and enemies aim at the chest (+0.9 m); eyes sit near the top
  return [
    { id: 'trainer', radius: R.radius, step: R.stepHeight, climb: R.stepHeight, drop: dropNav, eye: [0.7, +(hMax * 0.8).toFixed(2)], speed: R.baseSpeed, essential: true, note: `every playable Pokémon (${line.length} species, ${hMin}–${hMax} m tall), jump and glide disabled` },
    { id: 'trainer-jump', radius: R.radius, step: R.stepHeight, climb: +(jumpApex + R.stepHeight).toFixed(2), drop: Infinity, eye: [0.7, +(hMax * 0.8).toFixed(2)], speed: R.baseSpeed, essential: false, note: `ordinary jump (apex ${jumpApex.toFixed(2)} m) and any drop: only used to prove there is no player-only perch` },
    { id: 'wild-small', radius: +wMin.toFixed(2), step: 0.6, climb: 0.6, drop: dropNav, eye: [0.5, 0.9], speed: 3.5, essential: true, note: 'smallest ground wild Pokémon' },
    { id: 'wild-elite', radius: +wBig.toFixed(2), step: 0.6, climb: 0.6, drop: dropNav, eye: [0.9, 1.4], speed: 3.5, essential: true, note: `largest ground body the director spawns (elite-capable at ×${eliteSize}, any other ground wild Pokémon at ×1), never under the validated ${VALIDATED_ELITE_R} m headroom` },
    { id: 'boss', radius: +bMax.toFixed(2), step: 0.6, climb: 0.6, drop: dropNav, eye: [1.2, 2.5], speed: 3, essential: false, note: 'largest ground boss (bosses arrive after the objectives close; reported, not gated)' },
  ];
}
