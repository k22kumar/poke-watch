import type { Rng } from '../core/rng';
import type { Grid } from '../core/grid';
import type { Rules } from '../rules/defaults';
import type { Element, Ailment } from '../rules/elements';
import type { SpeciesDef } from '../rules/species';
import type { Hooks } from '../mods/types';
import type { World } from './world';
import type { Cap } from '../rules/capabilities';
import type { MoveFlags } from '../rules/build';

export type RunState = 'play' | 'levelup' | 'evolving' | 'dead' | 'over' | 'victory' | 'transition';

export interface InputFrame {
  mx: number; // desired world-space move direction (unnormalised ok, length <= 1)
  mz: number;
  jump: boolean; // held
  dash: boolean; // pressed this frame
  /** world-space aim point (cursor on the ground, or a stick direction projected 8 m out); absent = no aim, so moves target the nearest enemy */
  aimX?: number;
  aimZ?: number;
  /** buttons held this tick, as BTN bits */
  btn?: number;
  card?: { action: 'pick' | 'reroll' | 'skip' | 'banish'; index: number };
}
/** held-button bits in InputFrame.btn: Move A, Move B, Signature, Guard */
export const BTN = { a: 1, b: 2, sig: 4, guard: 8 } as const;
export const NO_INPUT: InputFrame = { mx: 0, mz: 0, jump: false, dash: false };

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
  spec: MoveSpec; // compiled at level 1 (with its transform, if any)
  /** >0 while the move winds up (pose playing, release pending) */
  windup?: number;
  /** Phase 8b: the transform taken for this move (id in rules/build.ts), and casts so far ("used for a while") */
  xf?: string;
  uses?: number;
}

/** One Pokémon in the squad: everything that belongs to the creature rather than the trainer's body. */
export interface Member {
  species: SpeciesDef;
  hp: number;
  maxHp: number;
  /** recoverable health: refills while benched, drains to permanent loss while on the field */
  grey: number;
  moves: MoveSlot[];
  vitamins: Record<string, number>;
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
  tagVariant: number;
  /** Flash Fire armed (s left: its Fire moves hit x1.5); Sturdy spent this region */
  flashT: number; sturdyUsed: boolean;
}

/**
 * The trainer's body on the field plus its squad. Creature fields (hp, species, moves…) read and write
 * the active member, so systems written for one Pokémon keep working unchanged.
 */
export class Player {
  x = 0; y = 0; z = 0;
  px = 0; py = 0; pz = 0;
  vx = 0; vz = 0; vy = 0;
  kx = 0; kz = 0;
  grounded = true;
  facing = 0;
  moving = false;
  animT = 0;
  /** squad level and XP (one bar for the whole squad) */
  level = 1;
  xp = 0;
  xpNext = 0;
  /** level-ups not yet spent (banked picks) */
  pendingLevels = 0;
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
  /** Phase 8b: the trainer's techniques (at most rules.build.maxTechniques) and their bits (rules/build.ts TECH_BIT) */
  techs: string[] = [];
  techMask = 0;
  /** s the trainer cannot walk (Pressure Jet fires rooted) */
  rootT = 0;
  /** things held this tick (counted by the systems that tick them) and last tick (Lodestone roots you while > 0) */
  holdNext = 0; holding = 0;
  /** the current Dash came from the Dash input (not a dash-shaped move) */
  reflexDash = false;
  /** Slipstream: the coat copied by a Dash (agent index), carried by the next Move A or B */
  slipAg = 0;

  get m(): Member { return this.squad[this.active]; }
  get species() { return this.m.species; } set species(v) { this.m.species = v; }
  get hp() { return this.m.hp; } set hp(v) { this.m.hp = v; }
  get maxHp() { return this.m.maxHp; } set maxHp(v) { this.m.maxHp = v; }
  get moves() { return this.m.moves; } set moves(v) { this.m.moves = v; }
  get vitamins() { return this.m.vitamins; } set vitamins(v) { this.m.vitamins = v; }
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
  def: number;
  speed: number;
  haste: number; // cooldown divisor
  area: number;
  crit: number;
  magnet: number;
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

export interface Card {
  id: string; // banish key
  kind: 'learn' | 'upgrade' | 'vitamin' | 'heal' | 'recruit' | 'tag' | 'replace' | 'transform' | 'technique' | 'swap' | 'evolve';
  /** Phase 8b: which of the three offer slots the card came from */
  group?: 'kit' | 'technique' | 'wildcard';
  /** move slot the card changes (replace, transform) */
  slot?: number;
  /** capability tags the card works with (offer weighting, UI) */
  tags?: string[];
  /** a technique card while 3 are held: taking it means discarding one */
  swap?: boolean;
  /** squad member the card is for ('tag' variant cards) */
  member?: number;
  key: string; // move key / vitamin key
  rarity: 'common' | 'rare' | 'epic';
  title: string;
  desc: string;
  element?: Element;
  archetype?: string;
  level?: number;
}

export type SimEvent =
  | { t: 'hit'; x: number; y: number; z: number; amount: number; crit: boolean; eff: number; element: Element; enemy: number }
  | { t: 'kill'; x: number; y: number; z: number; species: number; roles: number; element: Element }
  | { t: 'cast'; archetype: string; element: Element; x: number; z: number; tx: number; tz: number; key: string }
  | { t: 'ability'; name: string; x: number; z: number; enemy: number }
  | { t: 'windup'; archetype: string; element: Element; slot: number; dur: number; tx: number; tz: number; key: string }
  | { t: 'beam'; x1: number; z1: number; x2: number; z2: number; width: number; element: Element; life: number }
  | { t: 'chain'; pts: number[]; element: Element }
  | { t: 'ring'; x: number; z: number; r: number; element: Element; life: number }
  | { t: 'telegraph'; x: number; z: number; r: number; life: number; hostile: boolean }
  | { t: 'line'; x1: number; z1: number; x2: number; z2: number; width: number; life: number }
  | { t: 'smite'; x: number; z: number; element: Element }
  | { t: 'pickup'; value: number; kind: number }
  | { t: 'playerHurt'; amount: number; x: number; z: number }
  | { t: 'heal'; amount: number }
  | { t: 'levelUp'; level: number }
  | { t: 'cards'; cards: Card[]; chest: boolean }
  | { t: 'cardPicked'; card: Card | null }
  | { t: 'evolveStart'; from: string; to: string }
  | { t: 'evolveEnd'; species: string }
  | { t: 'learn'; key: string }
  | { t: 'bossSpawn'; species: string; enemy: number }
  | { t: 'bossPhase'; phase: number }
  | { t: 'bossDead'; species: string; x: number; z: number }
  | { t: 'portal'; x: number; z: number }
  | { t: 'stageStart'; stage: number; biome: string }
  | { t: 'finalSwarm' }
  | { t: 'swarm' }
  | { t: 'chest'; x: number; z: number }
  | { t: 'jump' }
  | { t: 'dash' }
  | { t: 'death' }
  | { t: 'victory' }
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
  | { t: 'cell'; k: number; change: 'ignite' | 'douse' | 'freeze' | 'thaw' | 'charge' }
  | { t: 'spark'; x: number; z: number; life: number }
  | { t: 'cellHurt'; kind: string }
  | { t: 'tag'; from: string; to: string; free: boolean }
  | { t: 'tagAction'; species: string; key: string; element: Element; x: number; z: number }
  | { t: 'faint'; species: string; out: boolean }
  | { t: 'recruit'; species: string }
  | { t: 'benchEvolve'; from: string; to: string }
  | { t: 'objective'; kind: ObjectiveKind; phase: 'offer' | 'active' | 'done' | 'failed' | 'expired'; x: number; z: number; reward?: string }
  | { t: 'beat'; phase: 'build' | 'peak' | 'relax'; event: string }
  | { t: 'weatherEvent'; kind: 'rain' | 'sun' }
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
  filterCards: Hooks['filterCards'][];
  onStageStart: Hooks['onStageStart'][];
  onTick: Hooks['onTick'][];
}

export interface Director {
  spawnAcc: number;
  nextElite: number;
  nextSwarm: number;
  alphaSpawned: boolean;
  bossSpawned: boolean;
  bossIndex: number; // enemy slot, -1 none
  bossDead: boolean;
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

export type ObjectiveKind = 'hold' | 'hunt' | 'transport';
/** the stage's live objective (blueprint section 9): optional, timed, and paid in the scarce currencies */
export interface Objective {
  kind: ObjectiveKind;
  /** 'offer' = waiting for you to engage (45 s), 'active' = under way, then 'done' or 'failed' */
  phase: 'offer' | 'active' | 'done' | 'failed';
  /** s left in the current phase */
  t: number;
  /** the site: Hold's pylon or Transport's goal; Hunt: where the target was marked */
  x: number; z: number;
  /** Transport: where the egg started */
  sx: number; sz: number;
  /** Hold: charge 0-1 */
  charge: number;
  /** Hunt: target enemy slot and its generation; the Mender it flees to */
  target: number; targetGen: number; mender: number;
  /** Transport: the egg body, and who carries it (-1 nobody, -2 the player, else an enemy slot) */
  egg: number; carrier: number;
  /** the target's species (Hunt) */
  species: string;
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
  loop: number; // endless loops completed
  state: RunState;
  stateTimer: number;
  rng: { spawn: Rng; combat: Rng; cards: Rng; world: Rng; ai: Rng };
  world: World;
  grid: Grid;
  /** the active trainer (players[0] in solo) */
  player: Player;
  /** every trainer in the run (one in solo; co-op later) */
  players: Player[];
  enemies: import('./pools').EnemyPool;
  projectiles: import('./pools').ProjectilePool;
  zones: import('./pools').ZonePool;
  pickups: import('./pools').PickupPool;
  bodies: import('./bodies').BodyPool;
  events: SimEvent[];
  hooks: HookRunner;
  systems: System[];
  director: Director;
  beat: Beat;
  objective: Objective | null;
  /** recruits offered so far, a pending recruit choice (species ids), and members waiting to pick a Tag variant */
  recruit: { offered: number; pending: string[] | null; variants: number[] };
  cards: { offer: Card[] | null; chest: boolean; chestsQueued: number; source: 'level' | 'chest' | 'recruit' | 'tag' | 'swap'; rerolls: number; skips: number; banishes: number; banished: Set<string> };
  /** Phase 8b build state: picks resolved, picks since an offer showed a technique, the ids shown in the last offer,
   *  a pending technique swap (the new technique and the offer to return to), and every card picked (build summary) */
  build: { picks: number; sinceTech: number; lastShown: Set<string>; swap: { tech: string; offer: Card[]; chest: boolean; source: 'level' | 'chest' } | null; history: string[] };
  weather: { element: Element | null; t: number };
  stats: { kills: number; damageDealt: number; damageTaken: number; xp: number; bosses: number; maxHit: number };
  input: InputFrame;
  speciesIndex: SpeciesDef[];
  portal: { active: boolean; x: number; z: number };
  /** Phase 8a: the capability event log (death recap, pokewatch.debug('caps')) and the recap written when the run ends */
  caplog: import('./caplog').CapLog;
  recap: string[] | null;
}
