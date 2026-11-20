import type { Rng } from '../core/rng';
import type { Grid } from '../core/grid';
import type { Rules } from '../rules/defaults';
import type { Element, Ailment } from '../rules/elements';
import type { SpeciesDef } from '../rules/species';
import type { StageDef } from '../rules/stages';
import type { Hooks } from '../mods/types';
import type { World } from './world';
import type { JumpControl, LocoState } from './locomotion';
import type { Cap } from '../rules/capabilities';

export type RunState = 'play' | 'dead' | 'over';

export interface InputFrame {
  mx: number; // desired world-space move direction (unnormalised ok, length <= 1)
  mz: number;
  jump: boolean; // held
  dash: boolean; // pressed this frame
  /** R6c (docs/LOCOMOTION.md "Controls"): Jump went down since the previous sample (a rising edge, input/input.ts
   *  jumpLatch: a tap that went down and up between two samples is still one press). Present (true or false) = the
   *  driver sends edges: the body jumps on a press, buffered (rules.player.jumpBuffer) and with coyote time
   *  (rules.player.coyote), and holding Jump never jumps again (it only glides). Absent (the bot, older replays, the
   *  tests' frames) = the legacy rule: held Jump jumps whenever the body is supported */
  jumpPressed?: boolean;
  /** R6c: vertical intent, ascend − descend in −1..1 (ascend = Jump held, descend = the `descend` action; both held
   *  cancel). Absent = 0. Only a volume body (R6d) reads it: supported, ballistic and scripted bodies ignore it. The
   *  look pitch never feeds it (invariant 4) */
  my?: number;
  /** world-space aim point (cursor on the ground, or a stick direction projected 8 m out); absent = no aim, so moves target the nearest enemy */
  aimX?: number;
  aimZ?: number;
  /** buttons held this tick, as BTN bits */
  btn?: number;
  /** buttons that went down since the previous sample (rising edges, BTN bits; input/input.ts Input.sample). A deliberate
   *  press, even one that went down and up between two samples, or a release and re-press inside one sample that `btn`
   *  alone shows as "held". Absent (the bot, older replays) = no presses: only `btn` drives the slots, as before Phase 3.
   *  The fire buffer (rules.combat.fireBuffer, sim/moves.ts) reads only this field */
  press?: number;
  /** the third-person crosshair ray (the camera's lens and the unit direction through the crosshair, each through
   *  Math.fround: render/hostframe.ts aimRayOf), or absent (fixed views, the bot). Under rules.aim.spatial the sim traces
   *  it itself (sim/aim.ts) for the archetypes in rules.aim.archetypes (direct shots, beams); aimX/aimZ stay the planar
   *  point every other move reads */
  aim?: AimRay;
  /** the device that aims (the assistance policy of roadmap Stage 5A reads it; Phase 2B gives every device none) */
  aimDev?: 'mouse' | 'stick' | 'touch';
}
/** a ray in world space: origin and direction (the direction need not be exactly unit after quantisation; the sim
 *  normalises it) */
export interface AimRay { ox: number; oy: number; oz: number; dx: number; dy: number; dz: number }

/** The spatial aim the sim resolved this tick (sim/aim.ts), for the HUD and the in-world marker to show. Presentation
 *  only reads it: it is derived from the input and the state, never hashed, and nothing in the sim reads it back.
 *  `on` is false whenever the spatial path is not in use (flag off, no ray, a move that is not migrated, auto mode). */
export interface AimState {
  on: boolean;
  /** the muzzle the shot leaves from (m) */
  ox: number; oy: number; oz: number;
  /** the aim point: where the crosshair ray first meets the world or a target, or its end in empty space */
  tx: number; ty: number; tz: number;
  /** what the crosshair ray met (SK bit from sim/spatial.ts; 0 = nothing within rules.aim.sightRange) and its id */
  hitKind: number; hitId: number;
  /** the launch direction (unit) */
  ux: number; uy: number; uz: number;
  /** the muzzle cannot reach the aim point: something solid or another body is in the way, at (bx, by, bz) */
  blocked: boolean; blockKind: number; bx: number; by: number; bz: number;
  /** the primary shot's flight distance and the distance from the muzzle to the aim point (m) */
  reach: number; dist: number;
}
export function freshAimState(): AimState {
  return { on: false, ox: 0, oy: 0, oz: 0, tx: 0, ty: 0, tz: 0, hitKind: 0, hitId: -1, ux: 0, uy: 0, uz: 1, blocked: false, blockKind: 0, bx: 0, by: 0, bz: 0, reach: 0, dist: 0 };
}
/** held-button bits in InputFrame.btn: Move A, Move B, Signature, Guard, and the basic attack (slot 0) */
export const BTN = { a: 1, b: 2, sig: 4, guard: 8, basic: 16, touch: 32 } as const;
export const NO_INPUT: InputFrame = { mx: 0, mz: 0, jump: false, dash: false };

/** flags a move spec can carry beyond its compiled data (the sim reads them; see sim/moves.ts and sim/effects.ts). The
 *  build layer's transforms set them until it was deleted (docs/hero-shooter-pivot.md §8 step 9); kept for the kits */
export interface MoveFlags {
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
  /** Hold suspends Light creatures (not only bodies and shots: the Lasso, src/sim/capabilities.ts creatureForce) */
  lasso?: boolean;
  /** root time (s) this move's root ailment applies */
  ccT?: number;
  /** length (m) of the Heat trail a dash leaves behind */
  trailHeat?: number;
}

export interface MoveSpec extends MoveFlags {
  key: string;
  name: string;
  element: Element;
  cls: 'physical' | 'special' | 'status';
  archetype: string;
  dmg: number; cd: number; range: number; speed: number; count: number;
  radius: number; pierce: number; duration: number; knock: number; tick: number;
  ailment: Ailment; ailmentChance: number;
  drain: number;
  priority: number;
  power: number;
  /** capability tags compiled from type, class, base power and shape (rules/capabilities.ts) */
  caps?: Cap[];
}

export interface MoveSlot {
  key: string;
  level: number;
  cd: number;
  spec: MoveSpec; // compiled at level 1
  /** >0 while the move winds up (pose playing, release pending) */
  windup?: number;
  /** Phase 3: ctx.tick of a press queued by the fire buffer (rules.combat.fireBuffer): the slot casts once when it
   *  becomes ready, held or not. Undefined = nothing queued. Consumed by that cast, dropped by Tag, carrying or age */
  queued?: number;
}

/** One Pokémon in the squad: everything that belongs to the creature rather than the trainer's body. */
export interface Member {
  species: SpeciesDef;
  hp: number;
  maxHp: number;
  /** recoverable health: refills while benched, drains to permanent loss while on the field */
  grey: number;
  moves: MoveSlot[];
  buffT: number; buffAtk: number; buffSpe: number;
  /** paralysis from Static / Effect Spore / charge: half move speed while > 0 */
  paraT: number;
  trailT: number; trailSpec: MoveSpec | null; trailLevel: number; trailAcc: number;
  regenAcc: number;
  derived: Derived;
  learned: Set<string>;
  /** coat on this Pokémon: agent index (0 none, see rules/reactions.ts), depth (1 light, 2 deep), time left */
  coat: number; coatDeep: number; coatT: number;
  fainted: boolean;
  /** chosen Tag Action variant (0 = base, 1 = the evolution variant) */
  /** Flash Fire armed (s left: its Fire moves hit x1.5); Sturdy spent this region */
  flashT: number; sturdyUsed: boolean;
}

/**
 * The trainer's body on the field plus its squad. Creature fields (hp, species, moves…) read and write
 * the active member, so systems written for one Pokémon keep working unchanged.
 */
export class Player {
  /** a Breakthrough in progress (sim/evolution.ts): seconds left, the member evolving, how long Touch has been held */
  breakT = 0; breakMember = -1; touchT = 0;
  /** knocked out with a respawn coming (rules.hero.respawn): seconds left; 0 = up */
  respawnT = 0;
  x = 0; y = 0; z = 0;
  px = 0; py = 0; pz = 0;
  vx = 0; vz = 0; vy = 0;
  kx = 0; kz = 0;
  grounded = true;
  /** `grounded` at the start of the latest tick: with px/py/pz, the start of the span the renderer interpolates (the
   *  third-person camera smooths a step only over a span that was on the ground at both ends). Render-only: no system
   *  reads it and the state hash does not include it */
  pgrounded = true;
  /** locomotion state after the last player tick (sim/locomotion.ts): the integrator the next tick runs unless another
   *  system changes the body first (a lunge, a respawn), and the medium the body ended in. Read-only outside player.ts */
  loco: LocoState = { integrator: 0, medium: 0 }; // LOCO.supported, MEDIUM.support (type-only import: no cycle)
  /** R6c jump acceptance between ticks (sim/locomotion.ts jumpControl): a buffered press, coyote time, the airborne press
   *  spent. Only edge-sending input (InputFrame.jumpPressed) writes it; with legacy input it stays all zero */
  ctl: JumpControl = { buffer: 0, coyote: 0, airSpent: false };
  facing = 0;
  moving = false;
  animT = 0;
  /** squad level and XP (one bar for the whole squad) */
  level = 1;
  iframes = 0;
  hurtFlash = 0;
  dashT = 0; dashCd = 0; dashDx = 0; dashDz = 1;
  /** while > 0 the Pokémon faces aimFacing (its attack target) even while moving */
  aimT = 0; aimFacing = 0;
  /** Reflex charges (fractional while recharging); Dash and Guard each spend one */
  reflex = 0;
  /** seconds since Guard was pressed; < 0 when not guarding */
  guardT = -1;
  /** a deflect or parry landed during this guard (no whiff penalty) */
  guardHit = false;
  /** seconds held in Brace since the last charge drain */
  braceAcc = 0;
  /** after a whiffed Guard tap: no Guard or Dash until this reaches 0 */
  guardLock = 0;
  /** next time a burning or charged cell may hurt the player */
  cellHurt = 0;
  /** buttons held last tick (edge detection) */
  btnPrev = 0;
  /** the squad (1 to 3 Pokémon) and which one is on the field */
  squad: Member[] = [];
  active = 0;
  /** squad-wide Tag cooldown (s) */
  tagCd = 0;
  /** seconds the current member has been on the field */
  fieldT = 0;
  /** last member tagged out (Tag tap swaps back to it) */
  lastActive = -1;
  /** a fainted member is waiting to be replaced (s until the automatic tag) */
  faintT = -1;
  /** carrying the Transport egg: 70% speed, no Move A or B (blueprint section 9) */
  carrying = false;
  /** seconds Tag has been held (-1 = up), whether a hold-pick happened, A/B held last tick (pick edges) */
  tagDownT = -1; tagPicked = false; tagBtnPrev = 0;
  /** s until the incoming Pokémon's Tag Action releases (-1 = none pending) */
  tagPending = -1;
  /** s the trainer cannot walk (a move's selfRoot) */
  rootT = 0;
  /** things held this tick (counted by the systems that tick them) and last tick */
  holdNext = 0; holding = 0;
  /** the current Dash came from the Dash input (not a dash-shaped move) */
  reflexDash = false;
  /** Slipstream: the coat copied by a Dash (agent index), carried by the next Move A or B */
  slipAg = 0;
  /** liquid exposure of the trainer's body (sim/hazards.ts): liquid kind (0 none, 1 water, 2 lava), s exposed, damage
   *  carried below a whole point, damage since the last cue and the cue timer; in a liquid it is safe in (cue state) */
  hzKind = 0; hzT = 0; hzAcc = 0; hzCue = 0; hzCueT = 0; hzSafe = 0;
  /** the last supported dry ground stood on (a hazard knockout's next Pokémon comes in here), and the hazard whose
   *  knockout is waiting for that ('' = none) */
  safeX = 0; safeY = 0; safeZ = 0; hzRecover: '' | 'water' | 'lava' | 'fall' = '';

  get m(): Member { return this.squad[this.active]; }
  get species() { return this.m.species; } set species(v) { this.m.species = v; }
  get hp() { return this.m.hp; } set hp(v) { this.m.hp = v; }
  get maxHp() { return this.m.maxHp; } set maxHp(v) { this.m.maxHp = v; }
  get moves() { return this.m.moves; } set moves(v) { this.m.moves = v; }
  get buffT() { return this.m.buffT; } set buffT(v) { this.m.buffT = v; }
  get buffAtk() { return this.m.buffAtk; } set buffAtk(v) { this.m.buffAtk = v; }
  get buffSpe() { return this.m.buffSpe; } set buffSpe(v) { this.m.buffSpe = v; }
  get paraT() { return this.m.paraT; } set paraT(v) { this.m.paraT = v; }
  get trailT() { return this.m.trailT; } set trailT(v) { this.m.trailT = v; }
  get trailSpec() { return this.m.trailSpec; } set trailSpec(v) { this.m.trailSpec = v; }
  get trailLevel() { return this.m.trailLevel; } set trailLevel(v) { this.m.trailLevel = v; }
  get trailAcc() { return this.m.trailAcc; } set trailAcc(v) { this.m.trailAcc = v; }
  get regenAcc() { return this.m.regenAcc; } set regenAcc(v) { this.m.regenAcc = v; }
  get derived() { return this.m.derived; } set derived(v) { this.m.derived = v; }
  get learned() { return this.m.learned; } set learned(v) { this.m.learned = v; }
}

export interface Derived {
  maxHp: number;
  atk: number; // multiplier for physical
  spa: number; // multiplier for special
  def: number; // m(Def): divides incoming physical damage
  spd: number; // m(SpD): divides incoming special damage
  speed: number; // top planar speed, m/s (the Spe band, src/rules/stats.ts)
  haste: number; // cooldown divisor
  area: number;
  crit: number;
}

export interface Hit {
  enemy: number;
  amount: number;
  element: Element;
  cls: 'physical' | 'special' | 'status';
  crit: boolean;
  effectiveness: number;
  stab: boolean;
  source: string; // move key or 'dot'
}

export type SimEvent =
  | { t: 'hit'; x: number; y: number; z: number; amount: number; crit: boolean; eff: number; element: Element; enemy: number }
  | { t: 'kill'; x: number; y: number; z: number; species: number; roles: number; element: Element }
  /** `o`: a cast on the spatial path (Phase 2B): the muzzle `o`, the aim point `t`, what the crosshair met (`kind`, SK
   *  bit, 0 = nothing) and whether the muzzle's line to the aim point is obstructed.
   *  `assist` (Phase 3): the enemy a device's aim assistance (rules.aim.assist) bent this planar cast to */
  | { t: 'cast'; archetype: string; element: Element; x: number; z: number; tx: number; tz: number; key: string; o?: { o: [number, number, number]; t: [number, number, number]; kind: number; blocked: boolean }; assist?: number }
  /** a spatial (3D) player shot ended: on a world solid (`kind`: SK bit), on the actor that used up its pierce
   *  ('actor'), or at the end of its reach ('range'), at (x, y, z) */
  | { t: 'shotEnd'; why: 'world' | 'actor' | 'range'; kind: number; x: number; y: number; z: number; element: Element }
  | { t: 'ability'; name: string; x: number; z: number; enemy: number }
  /** a slot accepted its button and started its wind-up (`queued`: the accept spent a buffered press, Phase 3) */
  | { t: 'windup'; archetype: string; element: Element; slot: number; dur: number; tx: number; tz: number; key: string; queued?: boolean }
  /** Phase 3 input acceptance (sim/moves.ts): a press on a slot that was not ready was queued, to cast in `wait` ticks */
  | { t: 'fireQueued'; slot: number; wait: number }
  /** a press that will not cast: 'early' (the slot is more than the fire buffer from ready; `wait` ticks), 'queued' (a
   *  press is already queued: exactly one is kept), 'cancel' (Tag held, or the egg carried, took the slot), 'expired' (the
   *  queued press outlived its bound without the slot casting) */
  | { t: 'fireDropped'; slot: number; why: 'early' | 'queued' | 'cancel' | 'expired'; wait: number }
  /** a beam: from (x1, z1) to (x2, z2), `width` its half-width. Phase 2C (spatial beams): y1 / y2 are the muzzle and end
   *  heights, the end is where the core stopped (`why`: 'world' on a solid of SK kind `kind`, 'actor' on the body that
   *  used up its pierce, 'range' at its length), and `hits` counts the bodies it damaged. Without y1 the beam is planar
   *  and the renderer draws it at the partner's chest */
  | { t: 'beam'; x1: number; z1: number; x2: number; z2: number; width: number; element: Element; life: number; y1?: number; y2?: number; why?: 'world' | 'actor' | 'range'; kind?: number; hits?: number }
  | { t: 'chain'; pts: number[]; element: Element }
  | { t: 'ring'; x: number; z: number; r: number; element: Element; life: number }
  | { t: 'telegraph'; x: number; z: number; r: number; life: number; hostile: boolean }
  | { t: 'line'; x1: number; z1: number; x2: number; z2: number; width: number; life: number }
  | { t: 'smite'; x: number; z: number; element: Element }
  | { t: 'playerHurt'; amount: number; x: number; z: number }
  | { t: 'heal'; amount: number }
  | { t: 'levelUp'; level: number }
  | { t: 'evolveStart'; from: string; to: string }
  | { t: 'evolveEnd'; species: string }
  | { t: 'respawn'; species: string }
  | { t: 'learn'; key: string }
  | { t: 'stageStart'; stage: number; biome: string }
  | { t: 'spawnSkipped'; species: string; reason: string; x: number; z: number }
  | { t: 'finalSwarm' }
  | { t: 'swarm' }
  | { t: 'chest'; x: number; z: number }
  | { t: 'jump' }
  | { t: 'dash' }
  | { t: 'death' }
  | { t: 'hitstop'; dur: number }
  | { t: 'shake'; amount: number; x: number; z: number }
  | { t: 'enemyShot'; x: number; z: number; element: Element }
  | { t: 'guard'; x: number; z: number }
  | { t: 'deflect'; x: number; z: number; element: Element }
  | { t: 'parry'; x: number; z: number; enemy: number }
  | { t: 'brace'; x: number; z: number; amount: number }
  | { t: 'push'; x: number; z: number; ok: boolean; combined: boolean }
  | { t: 'bodyHit'; x: number; y: number; z: number; amount: number; eff: number; element: Element }
  | { t: 'break'; x: number; z: number; r: number; element: Element }
  | { t: 'throw'; x: number; z: number; tx: number; tz: number; element: Element }
  | { t: 'cell'; k: number; change: 'ignite' | 'douse' | 'freeze' | 'crack' | 'thaw' | 'charge' }
  | { t: 'spark'; x: number; z: number; life: number }
  | { t: 'cellHurt'; kind: string }
  /** an environment rule hurt an actor: a vent tick, the cold water under opened ice, or exposure to a liquid / a fall
   *  (who: 'player' or 'enemy', id the enemy slot or -1) */
  | { t: 'hazardHit'; kind: 'vent' | 'dunk' | 'water' | 'lava' | 'fall'; who: 'player' | 'enemy'; id: number; amount: number; x: number; z: number }
  /** an actor's exposure changed: entered a liquid it is not safe in (lethal: s to a knockout), is swimming safely,
   *  left it, or was knocked out by it (fall: out of the map); recover: the next Pokémon after that knockout was put on
   *  the last safe ground */
  /** tidal maps: the tide's phase changed (warn: high water in `in` s; flood: the tidal floor is open water; ebb: dry again) */
  | { t: 'tide'; phase: 'warn' | 'flood' | 'ebb'; in: number }
  | { t: 'hazard'; kind: 'water' | 'lava' | 'fall'; phase: 'enter' | 'safe' | 'exit' | 'ko' | 'recover'; who: 'player' | 'enemy'; id: number; lethal: number; x: number; z: number }
  | { t: 'tag'; from: string; to: string; free: boolean }
  | { t: 'tagAction'; species: string; key: string; element: Element; x: number; z: number }
  | { t: 'faint'; species: string; out: boolean }
  | { t: 'recruit'; species: string }
  | { t: 'benchEvolve'; from: string; to: string }
  | { t: 'objective'; kind: ObjectiveKind; phase: 'offer' | 'active' | 'done' | 'failed' | 'expired'; x: number; z: number; reward?: string }
  | { t: 'beat'; phase: 'build' | 'peak' | 'relax'; event: string }
  | { t: 'weatherEvent'; kind: 'rain' | 'sun' | 'frost' }
  | { t: 'block'; x: number; z: number; enemy: number }
  | { t: 'hex'; x: number; z: number; r: number; element: Element; life: number }
  | { t: 'react'; kind: 'steam' | 'freeze' | 'shatter' | 'conduct' | 'overload' | 'cancel'; x: number; z: number; r: number; deep: boolean; n: number };

export interface System {
  name: string;
  update(ctx: SimContext, dt: number): void;
}

export interface HookRunner {
  modifyDamage: Hooks['modifyDamage'][];
  onKill: Hooks['onKill'][];
  onLevelUp: Hooks['onLevelUp'][];
  onStageStart: Hooks['onStageStart'][];
  onTick: Hooks['onTick'][];
}

export interface Director {
  spawnAcc: number;
  nextElite: number;
  nextSwarm: number;
  alphaSpawned: boolean;
  finalSwarm: boolean;
  liveCap: number;
  /** Bulwarks alive this tick (enemy slots), for projectile blocking */
  bulwarks: number[];
}

/** the beat director's state (blueprint section 9): pacing on top of the v8 difficulty curves */
export interface Beat {
  phase: 'build' | 'peak' | 'relax';
  /** s spent in this phase, and how long it lasts */
  t: number; dur: number;
  /** 0-1: recent damage, nearby enemies and missing health, smoothed */
  intensity: number;
  /** s intensity has stayed above the cut-off during this peak */
  hot: number;
  /** recent damage taken (exponential average, ~10 s) and the stat it was last read from */
  dmgRecent: number; dmgSeen: number;
  /** peaks so far this stage; objectives started this stage */
  peaks: number; objectives: number;
}

/** the objective kinds (Hunt and Transport were deleted at pivot step 9) */
export type ObjectiveKind = 'hold';

export interface Objective {
  kind: ObjectiveKind;
  /** 'offer' = waiting for you to engage (45 s), 'active' = under way, then 'done' or 'failed' */
  phase: 'offer' | 'active' | 'done' | 'failed';
  /** s left in the current phase */
  t: number;
  /** the pylon */
  x: number; z: number;
  /** charge 0-1 */
  charge: number;
}

export interface SimContext {
  rules: Rules;
  chart: Record<Element, Record<Element, number>>;
  seed: number;
  tick: number;
  dt: number;
  time: number;
  stageTime: number;
  stage: number;
  /** the current region's resolved spawn pool (src/rules/spawning.ts): region preset + map pool + rules override */
  spawnTable: StageDef;
  state: RunState;
  stateTimer: number;
  rng: { spawn: Rng; combat: Rng; world: Rng; ai: Rng };
  world: World;
  grid: Grid;
  /** the active trainer (players[0] in solo) */
  player: Player;
  /** every trainer in the run (one in solo; co-op later) */
  players: Player[];
  enemies: import('./pools').EnemyPool;
  projectiles: import('./pools').ProjectilePool;
  zones: import('./pools').ZonePool;
  bodies: import('./bodies').BodyPool;
  events: SimEvent[];
  hooks: HookRunner;
  systems: System[];
  director: Director;
  beat: Beat;
  objective: Objective | null;
  weather: { element: Element | null; t: number };
  stats: { kills: number; damageDealt: number; damageTaken: number; maxHit: number };
  input: InputFrame;
  /** the spatial aim resolved this tick, for presentation (sim/aim.ts) */
  aim: AimState;
  speciesIndex: SpeciesDef[];
  /** training targets (src/sim/targets.ts), null when the run has none */
  targets: import('./targets').TargetState | null;
  /** Phase 8a: the capability event log (death recap, pokewatch.debug('caps')) and the recap written when the run ends */
  caplog: import('./caplog').CapLog;
  recap: string[] | null;
}
