// Run construction and the fixed-step tick. The sim never imports render/ui/audio,
// so it runs headless in Node (tests, balance bots, replays).

import { dhypot } from '../core/detmath';
import { Grid } from '../core/grid';
import { Rng, streamSeed } from '../core/rng';
import { deepMerge } from '../core/util';
import { defaultRules, type Rules } from '../rules/defaults';
import { buildTypeChart } from '../rules/elements';
import { SPECIES, SPECIES_BY_ID } from '../rules/species';
import { BIOMES, STAGES } from '../rules/stages';
import type { Mod, Mode } from '../mods/types';
import { projectileSystem, zoneSystem } from './effects';
import { enemySystem } from './enemies';
import { directorSystem, freshBeat } from './director';
import { objectiveSystem } from './objectives';
import { movesSystem } from './moves';
import { playerSystem } from './player';
import { EnemyPool, PickupPool, ProjectilePool, ZonePool } from './pools';
import { BodyPool, bodySystem, seedBodies } from './bodies';
import { cellSystem } from './cells';
import { coatSystem } from './coats';
import { reviveFainted, squadSystem } from './squad';
import { finishEvolution, handleCardInput, learnMove, makePlayer, pickupSystem, progressionSystem, recompute } from './progression';
import { NO_INPUT, type HookRunner, type InputFrame, type SimContext, type System } from './types';
import { World } from './world';
import { CapLog } from './caplog';

export interface RunOptions {
  seed: number;
  species: string;
  mode?: Mode;
  mods?: Mod[];
  ruleOverrides?: import('../core/util').DeepPartial<Rules>;
}

const gridSystem: System = {
  name: 'grid',
  update(ctx) {
    const E = ctx.enemies;
    ctx.grid.rebuild(E.hi, E.x, E.z, E.alive);
  },
};

export const DEFAULT_SYSTEMS: System[] = [playerSystem, squadSystem, directorSystem, gridSystem, enemySystem, coatSystem, movesSystem, projectileSystem, zoneSystem, bodySystem, objectiveSystem, cellSystem, pickupSystem, progressionSystem];

export function createRun(opts: RunOptions): SimContext {
  const mods = [...(opts.mode?.mods ?? []), ...(opts.mods ?? [])];
  const rules = deepMerge(defaultRules, opts.mode?.rules, ...mods.map((m) => m.rules), opts.ruleOverrides) as Rules;
  let systems = [...DEFAULT_SYSTEMS];
  for (const m of mods) if (m.systems) systems = m.systems(systems);
  const hooks: HookRunner = { modifyDamage: [], onKill: [], onLevelUp: [], filterCards: [], onStageStart: [], onTick: [] };
  for (const m of mods) for (const [k, fn] of Object.entries(m.hooks ?? {})) (hooks as any)[k].push(fn);

  const species = SPECIES_BY_ID[opts.species];
  if (!species) throw new Error('unknown species ' + opts.species);
  const seed = opts.seed >>> 0;
  const ctx: SimContext = {
    rules, chart: buildTypeChart(rules.damage.immuneMult), seed,
    tick: 0, dt: 1 / rules.sim.hz, time: 0, stageTime: 0, stage: 0, loop: 0,
    state: 'play', stateTimer: 0,
    rng: {
      spawn: new Rng(streamSeed(seed, 'spawn')), combat: new Rng(streamSeed(seed, 'combat')),
      cards: new Rng(streamSeed(seed, 'cards')), world: new Rng(streamSeed(seed, 'world')), ai: new Rng(streamSeed(seed, 'ai')),
    },
    world: null as unknown as World,
    grid: new Grid((rules.worldgen.mode === 'generated' ? Math.max(rules.world.size, rules.worldgen.size) : rules.world.size) + 40, rules.world.gridCell, rules.enemy.cap),
    player: makePlayer({ rules }, species),
    players: [],
    enemies: new EnemyPool(rules.enemy.cap),
    projectiles: new ProjectilePool(3000),
    zones: new ZonePool(400),
    pickups: new PickupPool(rules.pickups.cap),
    bodies: new BodyPool(rules.bodies.cap),
    events: [], hooks, systems,
    director: freshDirector(rules),
    beat: freshBeat(), objective: null,
    recruit: { offered: 0, pending: null, variants: [] },
    cards: { offer: null, chest: false, chestsQueued: 0, source: 'level', rerolls: rules.cards.rerolls, skips: rules.cards.skips, banishes: rules.cards.banishes, banished: new Set() },
    weather: { element: null, t: 0 },
    stats: { kills: 0, damageDealt: 0, damageTaken: 0, xp: 0, bosses: 0, maxHit: 0 },
    input: NO_INPUT,
    speciesIndex: SPECIES,
    portal: { active: false, x: 0, z: 0 },
    caplog: new CapLog(rules.caps.logSize),
    recap: null,
    build: { picks: 0, sinceTech: 0, lastShown: new Set(), swap: null, history: [] },
  };
  ctx.players.push(ctx.player);
  recompute(ctx);
  ctx.player.hp = ctx.player.maxHp;
  if (species.starter) learnMove(ctx, species.starter);
  startStage(ctx, 0);
  return ctx;
}

function freshDirector(rules: Rules) {
  return {
    spawnAcc: 0, nextElite: rules.director.eliteEvery, nextSwarm: rules.director.swarmEvery,
    alphaSpawned: false, bossSpawned: false, bossIndex: -1, bossDead: false, finalSwarm: false, liveCap: rules.enemy.liveCap, bulwarks: [] as number[],
  };
}

export function startStage(ctx: SimContext, stage: number) {
  ctx.stage = stage;
  const def = STAGES[stage % STAGES.length];
  const biome = BIOMES[def.biome];
  ctx.world = new World(ctx.rules, biome, ctx.rules.worldgen.regionSeed >= 0 ? ctx.rules.worldgen.regionSeed : (ctx.seed + stage * 7919 + ctx.loop * 104729) >>> 0, [...def.spawns.map((s) => s[0]), ...def.elites]);
  ctx.enemies.clear(); ctx.projectiles.clear(); ctx.zones.clear(); ctx.pickups.clear(); ctx.bodies.clear();
  const liveCap = ctx.director.liveCap;
  ctx.director = freshDirector(ctx.rules);
  ctx.director.liveCap = liveCap;
  ctx.stageTime = 0;
  { const seen = ctx.stats.damageTaken; ctx.beat = freshBeat(); ctx.beat.dmgSeen = seen; }
  ctx.objective = null;
  ctx.player.carrying = false;
  ctx.portal = { active: false, x: 0, z: 0 };
  const P = ctx.player;
  const [sx, sz] = ctx.world.spawn;
  P.x = P.px = sx; P.z = P.pz = sz; P.y = P.py = ctx.world.height(sx, sz); P.vx = P.vz = P.vy = 0; P.facing = Math.PI;
  ctx.world.updateFlow(sx, sz);
  seedBodies(ctx);
  for (const m of P.squad) m.sturdyUsed = false;
  // Phase 8b: rerolls and banishes are per region
  if (ctx.rules.build.enabled) { ctx.cards.rerolls = ctx.rules.build.rerolls; ctx.cards.banishes = ctx.rules.build.banishes; }
  ctx.events.push({ t: 'stageStart', stage, biome: biome.id });
  for (const h of ctx.hooks.onStageStart) h(ctx);
}

/** Advance exactly one fixed tick. Returns (and keeps) ctx.events for this tick. */
export function step(ctx: SimContext, input: InputFrame = NO_INPUT) {
  ctx.events.length = 0;
  ctx.input = input;
  const dt = ctx.dt;
  ctx.tick++;

  switch (ctx.state) {
    case 'levelup':
      handleCardInput(ctx);
      return ctx.events;
    case 'evolving':
      ctx.stateTimer -= dt;
      if (ctx.stateTimer <= 0) finishEvolution(ctx);
      return ctx.events;
    case 'transition':
      ctx.stateTimer -= dt;
      if (ctx.stateTimer <= 0) nextStage(ctx);
      return ctx.events;
    case 'over':
    case 'victory':
      return ctx.events;
    case 'dead':
      ctx.stateTimer -= dt;
      if (ctx.stateTimer <= 0) ctx.state = 'over';
      // world keeps moving (host applies slow motion), player input ignored
      ctx.input = NO_INPUT;
      break;
  }

  // banked picks: an open offer takes card input while the world keeps running
  if (ctx.cards.offer && ctx.input.card && ctx.state === 'play') handleCardInput(ctx);

  ctx.time += dt;
  ctx.stageTime += dt;
  for (const s of ctx.systems) {
    if (ctx.state === 'dead' && (s.name === 'player' || s.name === 'squad' || s.name === 'moves' || s.name === 'pickups' || s.name === 'progression')) continue;
    s.update(ctx, dt);
    if (isModal(ctx)) break; // modal opened mid-tick
  }
  for (const h of ctx.hooks.onTick) h(ctx);

  // portal
  if (ctx.state === 'play' && ctx.portal.active) {
    const P = ctx.player;
    if (dhypot(P.x - ctx.portal.x, P.z - ctx.portal.z) < ctx.rules.stage.portalRadius) {
      ctx.state = 'transition';
      ctx.stateTimer = 1.2;
    }
  }
  return ctx.events;
}

function nextStage(ctx: SimContext) {
  let next = ctx.stage + 1;
  if (next >= ctx.rules.stage.count) {
    if (!ctx.rules.mode.endless) {
      ctx.state = 'victory';
      ctx.events.push({ t: 'victory' });
      return;
    }
    ctx.loop++;
    next = 0;
  }
  ctx.state = 'play';
  const P = ctx.player;
  reviveFainted(ctx);
  P.hp = Math.min(P.maxHp, P.hp + P.maxHp * 0.3);
  startStage(ctx, next);
}

function isModal(ctx: SimContext) {
  return ctx.state === 'levelup' || ctx.state === 'evolving';
}
