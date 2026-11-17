// The encounter director (blueprint section 9, Phase 7).
//
// v8's director stays underneath as the background difficulty: the spawn accumulator, the HP and speed
// curves, elites, ring swarms and the boss at 5:00. On top of it the beat director paces a stage in beats:
//   Build (35-45 s)  spawns ramp from 0.75x to 1.15x
//   Peak  (20-30 s)  1.3x spawns plus one event: an objective, a composition, or regional weather
//   Relax (10-15 s)  spawns drop to 0.3x; the banked level-up picks are the thing to do
// A Peak ends early once intensity (recent damage, enemies within 6 m, missing health) has stayed at 0.85
// or more for 5 s. While the boss is out the beats rest. Objectives open at the first Peak after 1:30 and
// after 3:20 of each stage (sim/objectives.ts). The director never counter-picks your squad: compositions
// and weather are drawn from the region's own Pokémon and climate.

import { dexp, dhypot } from '../core/detmath';
import { clamp } from '../core/util';
import { COMPOSITIONS, REGION_WEATHER, resolve, type CompositionDef } from '../rules/compositions';
import { SPECIES_BY_ID } from '../rules/species';
import { applyAgent, CS } from './cells';
import { ringPoint, spawnEnemy, stageIndex } from './enemies';
import { objectiveDue, startObjective } from './objectives';
import { ROLE } from './pools';
import type { Beat, SimContext } from './types';
import { dcos, dsin } from '../core/detmath';
import { habitatSpawnFactor, traversalOf } from '../rules/profiles';
import { canSpawnOn } from '../rules/spawning';
import { enemyHeight, footprintOf, navWide } from '../rules/sizing';
import { DIAG_R } from '../world/navblocks';

export function freshBeat(): Beat {
  return { phase: 'build', t: 0, dur: 40, intensity: 0, hot: 0, dmgRecent: 0, dmgSeen: 0, peaks: 0, objectives: 0 };
}

/** spawn one composition at a point on the spawn ring; returns the enemy slots */
export function spawnComposition(ctx: SimContext, def: CompositionDef, near?: [number, number]): number[] {
  const table = ctx.spawnTable;
  const jobs = resolve(def, table);
  if (!jobs) return [];
  const [rMin, rMax] = ctx.rules.enemy.spawnRadius;
  const [cx, cz] = near ?? ringPoint(ctx, rMin, rMax);
  const P = ctx.player, R = ctx.rules.roles;
  // toward the player: the wall stands in front, the guns behind it
  const dx = P.x - cx, dz = P.z - cz, L = dhypot(dx, dz) || 1, ux = dx / L, uz = dz / L;
  const out: number[] = [];
  def.members.forEach((m, k) => {
    const can = jobs[k];
    for (let c = 0; c < m.count; c++) {
      const sp = ctx.rng.spawn.pick(can);
      const front = m.roles & ROLE.shielder ? 2.2 : m.job === 'ranged' || m.job === 'mender' || m.job === 'hexer' ? -1.6 : 0;
      const a = ctx.rng.spawn.range(0, Math.PI * 2), r = ctx.rng.spawn.range(0, 1.8);
      const b = ctx.world.bound;
      const x = clamp(cx + ux * front + dsin(a) * r, -b, b), z = clamp(cz + uz * front + dcos(a) * r, -b, b);
      // the first region's Bulwark is a plain tank with a shield; from the second region on it is an elite
      const roles = ctx.stage === 0 && ctx.loop === 0 ? m.roles & ~ROLE.elite : m.roles;
      // compatibility: a member that may not stand here is left out (the group still comes)
      if (!allowedAt(ctx, sp.id, x, z, roles & ROLE.elite ? ctx.rules.enemy.roles.elite.size : 1)) { ctx.events.push({ t: 'spawnSkipped', species: sp.id, reason: 'restricted habitat', x, z }); continue; }
      const i = spawnEnemy(ctx, sp.id, x, z, roles);
      if (i < 0) continue;
      if (m.roles & ROLE.raider) { ctx.enemies.speed[i] *= R.raiderSpeed; ctx.enemies.hp[i] *= R.raiderHp; ctx.enemies.maxHp[i] *= R.raiderHp; }
      out.push(i);
    }
  });
  return out;
}

/** compositions this region can field, for a peak or for an objective */
export function compositionsFor(ctx: SimContext, when: 'peak' | 'objective'): CompositionDef[] {
  const table = ctx.spawnTable;
  return COMPOSITIONS.filter((c) => c.when === when && resolve(c, table));
}

function startWeather(ctx: SimContext, kind: 'rain' | 'sun' | 'frost') {
  ctx.weather.element = kind === 'rain' ? 'tide' : kind === 'sun' ? 'blaze' : 'frost';
  ctx.weather.t = ctx.rules.beats.weatherTime;
  ctx.events.push({ t: 'weatherEvent', kind });
}

/** what a Peak brings: an objective when one is due, else a composition, sometimes the weather */
function peakEvent(ctx: SimContext, noObjective: boolean): string {
  const due = noObjective ? null : objectiveDue(ctx);
  if (due && startObjective(ctx, due)) return 'objective:' + due;
  const biome = ctx.spawnTable.biome;
  const skies = REGION_WEATHER[biome] ?? [];
  if (skies.length && !ctx.weather.element && ctx.rng.spawn.next() < ctx.rules.beats.weatherChance) {
    const kind = ctx.rng.spawn.pick(skies);
    startWeather(ctx, kind);
    return 'weather:' + kind;
  }
  if (ctx.stageTime < ctx.rules.beats.compositionsAfter) return 'none';
  const opts = compositionsFor(ctx, 'peak');
  if (!opts.length) return 'none';
  const def = ctx.rng.spawn.weighted(opts, (c) => c.weight);
  spawnComposition(ctx, def);
  return 'composition:' + def.id;
}

function enter(ctx: SimContext, phase: Beat['phase'], noObjective = false) {
  const B = ctx.beat, R = ctx.rules.beats;
  B.phase = phase; B.t = 0; B.hot = 0;
  const [lo, hi] = R[phase];
  B.dur = ctx.rng.spawn.range(lo, hi);
  let event = '';
  if (phase === 'peak') { B.peaks++; event = peakEvent(ctx, noObjective); }
  ctx.events.push({ t: 'beat', phase, event });
}

/** an objective lapsed or failed: the pressure comes now (a Peak without a new objective) */
export function forcePeak(ctx: SimContext) {
  if (!ctx.rules.beats.enabled || ctx.director.bossSpawned || ctx.beat.phase === 'peak') return;
  enter(ctx, 'peak', true);
}

/** intensity and the beat clock; returns the spawn-rate multiplier for this tick */
function beats(ctx: SimContext, dt: number): number {
  const B = ctx.beat, R = ctx.rules.beats, P = ctx.player;
  // intensity: damage over the last ~10 s, enemies close by, health missing
  const taken = ctx.stats.damageTaken - B.dmgSeen;
  B.dmgSeen = ctx.stats.damageTaken;
  B.dmgRecent = B.dmgRecent * dexp(-dt / 10) + taken;
  const n = ctx.grid.query(P.x, P.z, 6);
  let near = 0;
  for (let k = 0; k < n; k++) if (ctx.enemies.alive[ctx.grid.result[k]]) near++;
  const raw = 0.45 * Math.min(1, B.dmgRecent / Math.max(1, 0.35 * P.maxHp)) + 0.35 * Math.min(1, near / 14) + 0.2 * (1 - P.hp / Math.max(1, P.maxHp));
  B.intensity += (raw - B.intensity) * Math.min(1, dt * 1.5);

  if (!R.enabled || ctx.director.bossSpawned) return 1;
  B.t += dt;
  if (B.phase === 'peak') B.hot = B.intensity >= R.hotIntensity ? B.hot + dt : 0;
  if (B.t >= B.dur || (B.phase === 'peak' && B.hot >= R.hotTime)) enter(ctx, B.phase === 'build' ? 'peak' : B.phase === 'peak' ? 'relax' : 'build');
  if (B.phase === 'build') return R.rate.build[0] + (R.rate.build[1] - R.rate.build[0]) * Math.min(1, B.t / B.dur);
  return B.phase === 'peak' ? R.rate.peak : R.rate.relax;
}

/** Rain soaks open ground near you; Sun now and then lights the tall grass (moves can set the weather too) */
function weatherTick(ctx: SimContext) {
  const el = ctx.weather.element;
  if (!el || ctx.tick % 30 !== 0) return;
  const P = ctx.player, W = ctx.world, C = W.cells;
  const tries = el === 'tide' ? 10 : el === 'blaze' ? 4 : el === 'frost' ? 8 : 0;
  for (let k = 0; k < tries; k++) {
    const a = ctx.rng.world.range(0, Math.PI * 2), r = ctx.rng.world.range(1, 14);
    const x = P.x + dsin(a) * r, z = P.z + dcos(a) * r;
    const t = C.tile(x, z);
    if (t < 0) continue;
    if (el === 'tide') { if (W.walkable(x, z)) applyAgent(ctx, 'wet', x, z, 1.2); }
    else if (el === 'blaze' && C.isGrass(t) && ctx.rng.world.next() < 0.35) applyAgent(ctx, 'heat', x, z, 0.6);
    else if (el === 'frost' && (C.isWater(t) || C.state[t] === CS.wet)) applyAgent(ctx, 'cold', x, z, 0.8);
  }
}

/** the habitat under the tile a species would actually stand on at (x, z): spawnEnemy snaps a ground spawn off a wall
 *  or out of water to the nearest walkable tile, so compatibility is judged there (flyers hover where they appear) */
function standAt(ctx: SimContext, id: string, x: number, z: number): [number, number] {
  const W = ctx.world;
  const sp = SPECIES_BY_ID[id];
  if ((sp && !traversalOf(sp, ctx.rules).groundNav) || W.walkable(x, z)) return [x, z];
  return W.nearestWalkable(x, z);
}
/** compatibility at (x, z): the species' habitat restrictions, and (size geometry on) room for a ground body whose
 *  footprint at this role size (elite ×2, alpha ×3) routes on the wide field — it may not appear in a one-tile pocket or
 *  at an entrance only small bodies fit (docs/SIZING.md "Navigation classes") */
function allowedAt(ctx: SimContext, id: string, x: number, z: number, roleSize = 1): boolean {
  const [sx, sz] = standAt(ctx, id, x, z), W = ctx.world;
  if (!canSpawnOn(id, W.habitatAt(sx, sz))) return false;
  const sp = SPECIES_BY_ID[id];
  const foot = ctx.rules.size.geometry && sp && traversalOf(sp, ctx.rules).groundNav ? footprintOf(sp, roleSize, ctx.rules) : 0;
  // headroom: a body taller than a deck's gap does not route under it, so it is judged on its own height's field
  if (foot > 0 && navWide(foot, ctx.rules) && !W.wideReached(sx, sz, foot < DIAG_R, undefined, enemyHeight(sp, roleSize, ctx.rules))) return false;
  return true;
}

/**
 * One ordinary spawn: selection (weight × habitat preference), location (the spawn ring) and compatibility (the
 * species' hard restrictions, src/rules/profiles.ts) kept apart. Generated maps pick the spot first so the local
 * habitat can weight the species; authored arenas pick the species first. A spot the species may not use is re-rolled
 * up to rules.spawning.retries times, then the director falls back to a species that may use it; if none may, the
 * spawn is skipped and a `spawnSkipped` event says why. With no restrictions configured nothing is re-rolled, so the
 * random draws are exactly the older director's.
 */
function pickSpawn(ctx: SimContext, spawns: [string, number][], rMin: number, rMax: number): [string, number, number] | null {
  if (!spawns.length) return null;
  const W = ctx.world, pref = ctx.rules.spawning.preference, tries = Math.max(1, ctx.rules.spawning.retries);
  let x = 0, z = 0;
  if (W.map.gen) {
    for (let k = 0; k < tries; k++) {
      [x, z] = ringPoint(ctx, rMin, rMax);
      const habitat = W.habitatAt(x, z);
      const ok = spawns.filter(([species]) => allowedAt(ctx, species, x, z));
      if (ok.length) return [ctx.rng.spawn.weighted(ok, ([species, weight]) => weight * habitatSpawnFactor(species, habitat, pref))[0], x, z];
    }
    ctx.events.push({ t: 'spawnSkipped', species: '', reason: 'no species in the pool may spawn on the spots tried', x, z });
    return null;
  }
  const [id] = ctx.rng.spawn.weighted(spawns, (w) => w[1]);
  for (let k = 0; k < tries; k++) {
    [x, z] = ringPoint(ctx, rMin, rMax);
    if (allowedAt(ctx, id, x, z)) return [id, x, z];
  }
  const ok = spawns.filter(([species]) => allowedAt(ctx, species, x, z));
  if (ok.length) return [ctx.rng.spawn.weighted(ok, (w) => w[1])[0], x, z];
  ctx.events.push({ t: 'spawnSkipped', species: id, reason: 'restricted habitat: no allowed spot found', x, z });
  return null;
}

/** a spawn-ring spot `id` may use (re-rolled up to rules.spawning.retries times), or null with a `spawnSkipped` event */
function spotFor(ctx: SimContext, id: string | null, rMin: number, rMax: number, roleSize = 1): [number, number] | null {
  const tries = Math.max(1, ctx.rules.spawning.retries);
  let x = 0, z = 0;
  for (let k = 0; k < tries; k++) {
    [x, z] = ringPoint(ctx, rMin, rMax);
    if (id === null || allowedAt(ctx, id, x, z, roleSize)) return [x, z];
  }
  ctx.events.push({ t: 'spawnSkipped', species: id ?? '', reason: 'restricted habitat: no allowed spot found', x, z });
  return null;
}

export const directorSystem = {
  name: 'director',
  update(ctx: SimContext, dt: number) {
    const D = ctx.rules.director;
    const dir = ctx.director;
    const E = ctx.enemies;
    const table = ctx.spawnTable;
    const S = ctx.rules.stage;
    const s = stageIndex(ctx);
    const t = ctx.stageTime / 60;
    const [rMin, rMax] = ctx.rules.enemy.spawnRadius;

    // boss
    if (!dir.bossSpawned && ctx.stageTime >= S.bossAt) {
      dir.bossSpawned = true;
      const P = ctx.player;
      const a = P.facing;
      const x = clamp(P.x + dsin(a) * 22, -ctx.world.bound, ctx.world.bound);
      const z = clamp(P.z + dcos(a) * 22, -ctx.world.bound, ctx.world.bound);
      const b = spawnEnemy(ctx, table.boss, x, z, ROLE.boss);
      dir.bossIndex = b;
      ctx.events.push({ t: 'bossSpawn', species: table.boss, enemy: b });
      ctx.events.push({ t: 'shake', amount: ctx.rules.feel.shakeBoss, x, z });
    }
    if (!dir.finalSwarm && ctx.stageTime >= S.finalSwarmAt && !dir.bossDead) {
      dir.finalSwarm = true;
      ctx.events.push({ t: 'finalSwarm' });
    }

    const bossAlive = dir.bossIndex >= 0;
    let rate = D.spawnBase + D.spawnPerMin * t + D.spawnPerStage * s;
    if (bossAlive) rate *= 0.45;
    if (dir.finalSwarm) rate *= 2.5;
    if (dir.bossDead) rate *= 0.3;
    rate *= beats(ctx, dt);
    weatherTick(ctx);
    dir.spawnAcc += rate * dt;
    while (dir.spawnAcc >= 1) {
      dir.spawnAcc -= 1;
      const cap = Math.min(dir.liveCap, D.capBase + D.capPerMin * t + (dir.finalSwarm ? 9999 : 0));
      if (E.count >= cap) { dir.spawnAcc = 0; break; }
      const pick = pickSpawn(ctx, table.spawns, rMin, rMax);
      if (!pick) continue;
      const [id, x, z] = pick;
      const sp = SPECIES_BY_ID[id];
      const cluster = sp.behaviour === 'swarm' ? 4 : 1;
      for (let c = 0; c < cluster; c++) spawnEnemy(ctx, id, x + c * 0.9, z + (c % 2) * 0.9);
    }

    // elites
    if (ctx.stageTime >= dir.nextElite) {
      dir.nextElite += D.eliteEvery;
      if (ctx.stageTime > 20 && table.elites.length) {
        let at = spotFor(ctx, null, rMin, rMax);
        const id = ctx.rng.spawn.pick(table.elites), size = ctx.rules.enemy.roles.elite.size;
        if (at && !allowedAt(ctx, id, at[0], at[1], size)) at = spotFor(ctx, id, rMin, rMax, size);
        if (at) spawnEnemy(ctx, id, at[0], at[1], ROLE.elite);
      }
    }
    // swarm rings (not while you are meant to be resting)
    if (ctx.stageTime >= dir.nextSwarm) {
      dir.nextSwarm += D.swarmEvery;
      const swarmers = table.spawns.filter(([id]) => ['swarm', 'chase'].includes(SPECIES_BY_ID[id].behaviour ?? 'chase'));
      if (ctx.stageTime > 30 && !bossAlive && !(ctx.rules.beats.enabled && ctx.beat.phase === 'relax') && swarmers.length) {
        const n = ctx.rng.spawn.int(D.swarmSize[0], D.swarmSize[1]) + s * 4;
        const P = ctx.player;
        const habitat = ctx.world.habitatAt(P.x, P.z);
        const id = ctx.world.map.gen
          ? ctx.rng.spawn.weighted(swarmers, ([species, weight]) => weight * habitatSpawnFactor(species, habitat, ctx.rules.spawning.preference))[0]
          : ctx.rng.spawn.pick(swarmers)[0];
        for (let k = 0; k < n && E.count < dir.liveCap; k++) {
          const a = (k / n) * Math.PI * 2;
          spawnEnemy(ctx, id, clamp(P.x + dcos(a) * 20, -ctx.world.bound, ctx.world.bound), clamp(P.z + dsin(a) * 20, -ctx.world.bound, ctx.world.bound), ROLE.stampede);
        }
        ctx.events.push({ t: 'swarm' });
      }
    }
    // alpha (v8 pacing only: with objectives on, the Hunt is the alpha)
    if (!ctx.rules.objectives.enabled && !dir.alphaSpawned && ctx.stageTime >= D.alphaAt) {
      dir.alphaSpawned = true;
      if (table.elites.length) {
        let at = spotFor(ctx, null, rMin, rMax);
        const id = ctx.rng.spawn.pick(table.elites), size = ctx.rules.enemy.roles.alpha.size;
        if (at && !allowedAt(ctx, id, at[0], at[1], size)) at = spotFor(ctx, id, rMin, rMax, size);
        if (at) spawnEnemy(ctx, id, at[0], at[1], ROLE.alpha);
      }
    }
  },
};
