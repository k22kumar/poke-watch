// Enemy spawning (director), steering, behaviours (the bosses were deleted at pivot step 9).
// Steering [C]: desired direction straight at the player; velocity eases toward it by
// min(1, 10*dt); knockback decays by exp(-7*dt); neighbours within 2r + 1 push apart via the grid.

import { datan2, dcos, dexp, dhypot, dsin } from '../core/detmath';
import { channelOf, heroHealth } from '../rules/stats';
import { clamp } from '../core/util';
import { ABILITY_IDS, abilityOf } from '../rules/abilities';
import { ELEMENTS, type Element } from '../rules/elements';
import { SPECIES_BY_ID, weightClass, type SpeciesDef } from '../rules/species';
import { enemyHeight, enemyRadius, footprintOf, navWide, partnerFootprint, partnerHeight, partnerRadius } from '../rules/sizing';
import { DIAG_R } from '../world/navblocks';
import { clearLanding } from './locomotion';
import { damageEnemy, damagePlayer, enemyAttackMult, killEnemy, playerAbility } from './combat';
const AB_CHLOROPHYLL = ABILITY_IDS.indexOf('chlorophyll') + 1;
const AB_STATIC = ABILITY_IDS.indexOf('static') + 1, AB_SPORE = ABILITY_IDS.indexOf('effect_spore') + 1;
import { PK, ROLE, ZK } from './pools';
import { spawnBody, TEAM } from './bodies';
import { startThrow, throwTick, THROWING } from './actions';
import { applyAgent, agentOf, footing } from './cells';
import { coatMember } from './coats';
import { agentElement } from '../rules/compositions';
import { traversalOf } from '../rules/profiles';
import { agentIndex } from '../rules/reactions';
import type { SimContext } from './types';
import { shotWeight } from '../rules/capabilities';
import { tickHeldEnemy } from './capabilities';
import { avoidsStep } from './hazards';

import { targetGoal } from './targets';
export function spawnEnemy(ctx: SimContext, id: string, x: number, z: number, roles = 0): number {
  const sp = SPECIES_BY_ID[id];
  if (!sp) throw new Error('unknown species ' + id);
  const E = ctx.enemies;
  const i = E.spawn();
  if (i < 0) return -1;
  const R = ctx.rules.enemy;
  let hpRole = 1, dmgRole = 1, size = 1;
  if (roles & ROLE.boss) { hpRole = R.roles.boss.hp; dmgRole = R.roles.boss.dmg; size = R.roles.boss.size; }
  else if (roles & ROLE.alpha) { hpRole = R.roles.alpha.hp; dmgRole = R.roles.alpha.dmg; size = R.roles.alpha.size; }
  else if (roles & ROLE.elite) { hpRole = R.roles.elite.hp; dmgRole = R.roles.elite.dmg; size = R.roles.elite.size; }
  const beh = sp.behaviour ?? 'chase';
  if (beh === 'ranged') roles |= ROLE.ranged;
  if (beh === 'healer') roles |= ROLE.healer;
  if (beh === 'swarm') roles |= ROLE.swarm;
  // traversal (rules/traversal.ts): a hovering wild body floats over the terrain with no footprint or ground placement
  const tv = traversalOf(sp, ctx.rules), hv = tv.hover;
  if (hv) roles |= ROLE.flying;
  // health on the hero canon curve × the behaviour's multiplier; base speed keeps its own formula until the co-op wave
  // step puts enemies on the hero speed band (docs/hero-shooter-pivot.md Q20, Q36). No growth with match time or region.
  const hp = heroHealth(sp.stats.hp, ctx.rules) * R.behaviourHp[beh] * hpRole;
  let speed = Math.min(R.speedMax, R.speedBase + sp.stats.spe * R.speedPerSpe);
  if (beh === 'tank') speed *= 0.72;
  if (beh === 'swarm') speed *= 1.12;
  if (beh === 'ranged') speed *= 0.85;
  if (roles & ROLE.boss) speed *= 0.8;
  // a ground body with a footprint (size geometry on) is put down where it fits: a tile centre, or a wide block's centre
  const foot = tv.groundNav ? footprintOf(sp, size, ctx.rules) : 0;
  if (foot > 0) [x, z] = ctx.world.nearestFit(x, z, foot, navWide(foot, ctx.rules), true, enemyHeight(sp, size, ctx.rules));
  else if (tv.groundNav && !ctx.world.walkable(x, z)) [x, z] = ctx.world.nearestWalkable(x, z);
  E.x[i] = x; E.z[i] = z; E.px[i] = x; E.pz[i] = z;
  E.hover[i] = hv ? hv.height + ((i * 37) % hv.levels) * hv.step : 0;
  E.y[i] = ctx.world.height(x, z) + E.hover[i]; E.py[i] = E.y[i];
  E.hp[i] = E.maxHp[i] = hp;
  E.speed[i] = speed;
  E.dmg[i] = (R.dmgBase + sp.stats.atk * R.dmgPerAtk + sp.stats.spa * R.dmgPerSpa) * dmgRole;
  E.size[i] = size;
  E.radius[i] = enemyRadius(sp, size, ctx.rules);
  E.tall[i] = enemyHeight(sp, size, ctx.rules);
  E.foot[i] = foot;
  E.species[i] = ctx.speciesIndex.indexOf(sp);
  { const ab = abilityOf(sp); E.ability[i] = ab ? ABILITY_IDS.indexOf(ab) + 1 : 0; }
  E.roles[i] = roles;
  E.attackCd[i] = ctx.rng.ai.range(0.5, 2);
  E.facing[i] = datan2(ctx.player.x - x, ctx.player.z - z);
  return i;
}

export function ringPoint(ctx: SimContext, rMin: number, rMax: number): [number, number] {
  const P = ctx.player;
  const b = ctx.world.bound;
  // location maps: most enemies enter from the map's approach anchors (cave mouths, forest gates, side passages)
  // that lie in a band around the player, so pressure comes from places, not from thin air
  const W = ctx.world;
  if (W.anchors.length && ctx.rng.spawn.chance(0.6)) {
    let pick = -1, seen = 0;
    for (let k = 0; k < W.anchors.length; k++) {
      const [ax, az] = W.anchors[k];
      const d = dhypot(ax - P.x, az - P.z);
      if (d < rMin - 3 || d > rMax + 16 || !W.walkable(ax, az)) continue;
      seen++;
      if (ctx.rng.spawn.next() * seen < 1) pick = k;
    }
    if (pick >= 0) {
      const [ax, az] = W.anchors[pick];
      for (let t = 0; t < 4; t++) {
        const x = ax + ctx.rng.spawn.range(-2, 2), z = az + ctx.rng.spawn.range(-2, 2);
        if (W.walkable(x, z)) return [x, z];
      }
      return [ax, az];
    }
  }
  for (let k = 0; k < 10; k++) {
    const a = ctx.rng.spawn.range(0, Math.PI * 2);
    const r = ctx.rng.spawn.range(rMin, rMax);
    const x = P.x + dcos(a) * r, z = P.z + dsin(a) * r;
    if (Math.abs(x) < b && Math.abs(z) < b && ctx.world.walkable(x, z)) return [x, z];
  }
  const a = ctx.rng.spawn.range(0, Math.PI * 2);
  return [clamp(P.x + dcos(a) * rMin, -b, b), clamp(P.z + dsin(a) * rMin, -b, b)];
}

export function shootHostile(ctx: SimContext, x: number, z: number, dx: number, dz: number, speed: number, dmg: number, element: Element, radius = 0.45, srcSp = -1, fromY?: number) {
  const Pr = ctx.projectiles;
  const i = Pr.spawn();
  if (i < 0) return;
  const L = dhypot(dx, dz) || 1;
  Pr.kind[i] = PK.hostile;
  Pr.x[i] = x; Pr.z[i] = z; Pr.y[i] = ctx.world.height(x, z) + 0.9;
  if (ctx.world.los) {
    // location maps: the shot keeps its own altitude and climbs or dips toward the player's chest, so a cliff lip,
    // a tree or a rock between them stops it (effects.ts)
    const P = ctx.player;
    const y0 = fromY !== undefined ? Math.max(fromY + 0.5, Pr.y[i]) : Pr.y[i];
    const t = Math.max(0.15, dhypot(P.x - x, P.z - z) / speed);
    Pr.y[i] = y0;
    Pr.vy[i] = clamp((P.y + 0.6 - y0) / t, -speed * 0.7, speed * 0.7);
  }
  Pr.vx[i] = (dx / L) * speed; Pr.vz[i] = (dz / L) * speed;
  Pr.life[i] = Pr.maxLife[i] = 4.5;
  Pr.dmg[i] = dmg; Pr.radius[i] = radius; Pr.pierce[i] = 0;
  Pr.element[i] = ELEMENTS.indexOf(element);
  // Phase 8a: a shot is a light body (Weight 0; heavy shots 1) and remembers who fired it (death recap)
  Pr.weight[i] = shotWeight(false, radius, ctx.rules.caps.heavyShotRadius); Pr.src[i] = srcSp;
}

const NAV: [number, number] = [0, 0];
const MOVE: [number, number] = [0, 0];

export const enemySystem = {
  name: 'enemies',
  update(ctx: SimContext, dt: number) {
    const E = ctx.enemies;
    const P = ctx.player;
    const R = ctx.rules.enemy;
    const W = ctx.world;
    const steer = Math.min(1, R.steerRate * dt);
    const kdecay = dexp(-R.knockDecay * dt);
    const pr = partnerRadius(ctx.player.species, ctx.rules);
    const sized = ctx.rules.size.geometry, pf = partnerFootprint(ctx.player.species, ctx.rules);
    const RR = ctx.rules.roles, O = ctx.objective;
    const bulwarks = ctx.director.bulwarks;
    bulwarks.length = 0;
    W.updateFlow(P.x, P.z, P.y);
    const burning = W.burnCost > 1 && W.cells.burning > 0;
    for (let i = 0; i < E.hi; i++) {
      if (!E.alive[i]) continue;
      E.px[i] = E.x[i]; E.pz[i] = E.z[i]; E.py[i] = E.y[i];
      E.spawnT[i] += dt;
      if (E.flash[i] > 0) E.flash[i] -= dt;
      if (E.contactCd[i] > 0) E.contactCd[i] -= dt;
      E.attackCd[i] -= dt;

      // damage over time
      if (E.burn[i] > 0 || E.poison[i] > 0) {
        E.burn[i] -= dt; E.poison[i] -= dt;
        E.hp[i] -= E.dot[i] * dt;
        if (((ctx.tick + i) % 30) === 0) ctx.events.push({ t: 'hit', x: E.x[i], y: E.y[i] + 1, z: E.z[i], amount: E.dot[i] * 0.5, crit: false, eff: 1, element: E.burn[i] > 0 ? 'blaze' : 'venom', enemy: i });
        if (E.burn[i] <= 0 && E.poison[i] <= 0) E.dot[i] = 0;
        if (E.hp[i] <= 0) { killEnemy(ctx, i); continue; }
      }
      // Phase 8b Lasso: a suspended creature follows the hold point (no AI, no contact) until it is thrown
      if (E.heldT[i] > 0 && tickHeldEnemy(ctx, i, dt)) continue;
      if (E.sleep[i] > 0) E.sleep[i] -= dt;
      if (E.root[i] > 0) E.root[i] -= dt;
      if (E.stun[i] > 0) E.stun[i] -= dt;
      if (E.chill[i] > 0) E.chill[i] -= dt;
      if (E.confuse[i] > 0) E.confuse[i] -= dt;

      const dx = P.x - E.x[i], dz = P.z - E.z[i];
      const dist = dhypot(dx, dz) || 0.001;
      const roles = E.roles[i];
      const sp = ctx.speciesIndex[E.species[i]];
      if (E.guardDown[i] > 0) E.guardDown[i] -= dt;
      if (roles & ROLE.shielder && E.guardDown[i] <= 0 && bulwarks.length < 16) bulwarks.push(i);

      // far behind -> relocate in front (keeps pressure; bosses excluded)
      // habitat maps: the Raid party of an active Hold walks team B's approaches from its staging (docs/HABITATS.md). B's
      // staging is 33-47 m from the point, so with the trainer on the far side of it the party starts past despawnDistance
      // and the relocation below would put it on a ring ahead of the trainer, skipping the approaches (and sometimes in
      // ground nothing connects to the point). It stays where it is until it is killed or the Hold ends.
      const raiding = !!W.hab && O !== null && O.kind === 'hold' && O.phase === 'active' && (roles & ROLE.raider) !== 0;
      // training targets are pinned too (src/sim/targets.ts): they stand, patrol or strafe where the set put them
      const pinned = raiding || (roles & ROLE.target) !== 0;
      // a wide body with no wide route to the player (it holds: see the pursuit below) is moved the same way after
      // rules.enemy.holdRelocate seconds, onto ground the wide field reaches, rather than standing idle for good
      const far = dist > R.despawnDistance;
      if ((far || E.holdT[i] > R.holdRelocate) && !(roles & ROLE.boss) && !pinned) {
        E.holdT[i] = 0;
        const a = datan2(P.vx, P.vz) + ctx.rng.ai.range(-1, 1);
        let nx = clamp(P.x + dsin(a) * 30, -W.bound, W.bound), nz = clamp(P.z + dcos(a) * 30, -W.bound, W.bound);
        if (E.foot[i] > 0) [nx, nz] = W.nearestFit(nx, nz, E.foot[i], navWide(E.foot[i], ctx.rules), true, E.tall[i]);
        else if (traversalOf(sp, ctx.rules).groundNav && !W.walkable(nx, nz)) [nx, nz] = W.nearestWalkable(nx, nz);
        // a holder is only moved onto ground with a wide route to the player; with none anywhere near (the player is in a
        // pocket only small bodies fit) it keeps holding
        if (!far && !W.wideReached(nx, nz, E.foot[i] < DIAG_R, undefined, E.tall[i])) { nx = E.x[i]; nz = E.z[i]; }
        E.x[i] = nx; E.z[i] = nz;
        E.px[i] = E.x[i]; E.pz[i] = E.z[i];
        continue;
      }

      let speed = E.speed[i];
      if (E.chill[i] > 0) speed *= 0.5;
      if (E.ability[i] === AB_CHLOROPHYLL && ctx.weather.element === 'blaze') speed *= 2;
      const frozen = E.sleep[i] > 0 || E.stun[i] > 0 || E.root[i] > 0 || E.spawnT[i] < 0.25;
      let ux = dx / dist, uz = dz / dist;
      const ground = E.hover[i] === 0;
      // layered maps: the player on a deck above (or on the ground below) is not reached by walking straight at them
      const layerGap = W.over !== null && ground && Math.abs(P.y - E.y[i]) > 2.4 && (W.over[W.tile(P.x, P.z)] > 0 || W.over[W.tile(E.x[i], E.z[i])] > 0);
      if (ground && (dist > 1.5 || layerGap)) {
        // straight at the player unless a wall, water or cliff is in the way; then follow the flow field
        const feet = E.y[i];
        // size classes (rules/sizing.ts, docs/SIZING.md "Navigation classes"): a body looks ahead past its own edge. A wide
        // one (footprint ≥ heavyRadius) follows the wide block field wherever it has a route, and walks straight only
        // beside the player: point probes cannot tell whether the lane its whole width needs is clear (a drop off a bridge
        // it would not fit below reads as open), so straight steering and the field fought, tick by tick. With no wide
        // route it holds where it is: it never follows the ordinary field into a gap it does not fit
        const f = E.foot[i], wide = sized && navWide(f, ctx.rules);
        const p1 = sized ? Math.max(1.1, f + 0.75) : 1.1, p2 = sized ? Math.max(2.4, f + 2.05) : 2.4;
        let ahead = wide || layerGap || W.blocks(E.x[i] + ux * p1, E.z[i] + uz * p1, feet, 0.6) || W.blocks(E.x[i] + ux * p2, E.z[i] + uz * p2, feet, 0.6);
        // size geometry on: once the way ahead is blocked the walker keeps to the field for rules.enemy.navHold seconds. The
        // two probes are points, so with one sitting on a tile edge the test flips every tick, and the walker alternated
        // between straight at the player (into the wall) and the field (away from it) and stood still for good (viridian
        // seed 1, beside a terrace: docs/SIZING.md "Navigation classes")
        // It also walks straight only while straight agrees with the field (they point less than 90° apart): the player on a
        // terrace reached by a ramp behind the walker is straight ahead across open ground that ends at the terrace face,
        // and the walker went back and forth between that dead end and the ramp (viridian seed 1)
        // (checked every fourth tick per walker; the hold below carries a disagreement between checks)
        if (sized && !ahead && ((ctx.tick + i) & 3) === 0 && W.flowDir(E.x[i], E.z[i], NAV, feet) && NAV[0] * ux + NAV[1] * uz < 0) ahead = true;
        // and it does not walk off a ledge toward a player who is not below it: the walker that had climbed a ramp to the
        // player's terrace walked straight off the terrace's edge, landed at the ramp's foot and climbed it again, round and
        // round (tropical-lagoon seed 3, a Sandshrew, 1.2 m drop). With the player below, the drop is the short way down
        if (sized && !ahead && P.y > feet - 0.6 && W.height(E.x[i] + ux * p1, E.z[i] + uz * p1, feet) < feet - 0.6) ahead = true;
        if (sized) { if (ahead) E.navT[i] = R.navHold; else if (E.navT[i] > 0) { E.navT[i] -= dt; ahead = true; } }
        const fireAhead = !ahead && burning && !sp.elements.includes('blaze') && (W.burningAt(E.x[i], E.z[i]) || W.burningAt(E.x[i] + ux * 1.1, E.z[i] + uz * 1.1) || W.burningAt(E.x[i] + ux * 2.4, E.z[i] + uz * 2.4));
        if (ahead || fireAhead) {
          // Phase 8a: fire ahead (or underfoot): follow the weighted flow field around it (Fire types walk through)
          if (wide) {
            const r = W.wideDir(E.x[i], E.z[i], NAV, feet, f < DIAG_R, E.tall[i]);
            if (r === 1) { ux = NAV[0]; uz = NAV[1]; } else if (r < 0) speed = 0;
            E.holdT[i] = r < 0 ? E.holdT[i] + dt : 0;
          } else if (W.flowDir(E.x[i], E.z[i], NAV, feet)) { ux = NAV[0]; uz = NAV[1]; }
        }
      }
      if (E.confuse[i] > 0 || E.blind[i] > 0) { const a = dsin(ctx.time * 3 + i) * Math.PI; ux = dsin(a); uz = dcos(a); }

      // a target's goal (src/sim/targets.ts), or the Hold a Raider is after (blueprint section 9)
      let goal: [number, number] | null = roles & ROLE.target ? targetGoal(ctx, i) : null;
      if (!goal && O && O.phase === 'active' && roles & ROLE.raider) goal = [O.x, O.z];

      if (goal) {
        const gx = goal[0] - E.x[i], gz = goal[1] - E.z[i], gl = dhypot(gx, gz);
        if (gl < 1.4) speed *= 0.15; else { ux = gx / gl; uz = gz / gl; }
        // habitat maps: a Raider bound for the point walks the contest's flow field (bridges, causeways, caves); the
        // field already steers around walls, so the look-ahead slide below (which turns at every hairpin) is skipped
        let flowed = false;
        const gf = E.foot[i];
        if (ground && gl > 3 && O && O.kind === 'hold' && W.hab && sized && navWide(gf, ctx.rules)) {
          // a wide Raider walks the wide block field to the point; with no wide route it holds (docs/SIZING.md)
          const r = W.wideGoalDir(E.x[i], E.z[i], NAV, E.y[i], gf < DIAG_R, E.tall[i]);
          if (r === 1) { ux = NAV[0]; uz = NAV[1]; flowed = true; } else if (r < 0) { speed = 0; flowed = true; }
        } else if (ground && gl > 3 && O && O.kind === 'hold' && W.hab && W.goalDir(E.x[i], E.z[i], NAV, E.y[i])) {
          ux = NAV[0]; uz = NAV[1]; flowed = true;
          // a diagonal step clipping an inner corner (a hairpin, a cave mouth): take one axis, the larger if it is free
          if (ux && uz && W.blocks(E.x[i] + ux * 0.8, E.z[i] + uz * 0.8, E.y[i], 0.6)) {
            const sx = Math.sign(ux), sz = Math.sign(uz), xFree = !W.blocks(E.x[i] + sx * 0.8, E.z[i], E.y[i], 0.6), zFree = !W.blocks(E.x[i], E.z[i] + sz * 0.8, E.y[i], 0.6);
            const xFirst = Math.abs(ux) >= Math.abs(uz);
            if (xFirst ? xFree || !zFree : xFree && !zFree) { ux = sx; uz = 0; } else { ux = 0; uz = sz; }
          }
        }
        // around walls: slide along the blocked axis
        if (!flowed && ground && W.blocks(E.x[i] + ux * 1.1, E.z[i] + uz * 1.1, E.y[i], 0.6)) { const t = ux; ux = -uz; uz = t; }
      } else if (roles & ROLE.hexer) {
        // a Hexer keeps its distance and lays a deep agent where you are heading (0.8 s warning)
        const el = agentElement(sp) ?? 'tide';
        if (E.state[i] === 3) {
          speed = 0;
          E.stateT[i] -= dt;
          if (E.stateT[i] <= 0) {
            E.state[i] = 0;
            E.attackCd[i] = RR.hexCooldown * ctx.rng.ai.range(0.9, 1.1);
            applyAgent(ctx, agentOf(el), E.tx[i], E.tz[i], RR.hexRadius * 0.8);
            const grounded = P.y - W.height(P.x, P.z) < 0.4;
            if (grounded && P.dashT <= 0 && P.faintT < 0 && dhypot(P.x - E.tx[i], P.z - E.tz[i]) < RR.hexRadius) coatMember(ctx, P.m, agentIndex(el), 2);
          }
        } else {
          if (dist < RR.hexRange * 0.8) { ux = -ux; uz = -uz; }
          else if (dist < RR.hexRange * 1.3) { const s = (i & 1) ? 1 : -1; const tx = -uz * s, tz = ux * s; ux = tx; uz = tz; speed *= 0.6; }
          if (!frozen && E.blind[i] <= 0 && E.attackCd[i] <= 0 && dist < RR.hexRange * 1.8) {
            const b = W.bound;
            E.tx[i] = clamp(P.x + P.vx * 0.6, -b, b); E.tz[i] = clamp(P.z + P.vz * 0.6, -b, b);
            E.state[i] = 3; E.stateT[i] = RR.hexWindup;
            ctx.events.push({ t: 'hex', x: E.tx[i], z: E.tz[i], r: RR.hexRadius, element: el, life: RR.hexWindup });
          }
        }
      } else if (roles & ROLE.healer) {
        // a Mender heals everything near it and keeps away from you
        if (E.attackCd[i] <= 0) {
          E.attackCd[i] = RR.menderEvery;
          const n = ctx.grid.query(E.x[i], E.z[i], RR.menderRadius);
          for (let k = 0; k < n; k++) {
            const j = ctx.grid.result[k];
            if (E.alive[j] && j !== i) E.hp[j] = Math.min(E.maxHp[j], E.hp[j] + E.maxHp[j] * RR.menderHeal);
          }
          ctx.events.push({ t: 'ring', x: E.x[i], z: E.z[i], r: RR.menderRadius, element: 'bloom', life: 0.5 });
        }
        if (dist < 7) { ux = -ux; uz = -uz; speed *= 0.6; }
      } else if (roles & ROLE.ranged) {
        if (dist < R.rangedRange * 0.65) { const s = (i & 1) ? 1 : -1; const tx = -uz * s, tz = ux * s; ux = tx * 0.8 - ux * 0.4; uz = tz * 0.8 - uz * 0.4; }
        if (!frozen && E.blind[i] <= 0 && dist < R.rangedRange && E.attackCd[i] <= 0 && W.los && !W.sight(E.x[i], E.y[i] + 0.9, E.z[i], P.x, P.y + 0.6, P.z)) {
          // location maps: no line of fire (a cliff lip, trees, a rock) — hold fire and work around along the flow field
          E.attackCd[i] = 0.35;
          if (W.flowDir(E.x[i], E.z[i], NAV, E.y[i] - E.hover[i])) { ux = NAV[0]; uz = NAV[1]; }
        } else if (!frozen && E.blind[i] <= 0 && dist < R.rangedRange && E.attackCd[i] <= 0) {
          E.attackCd[i] = R.rangedCooldown * ctx.rng.ai.range(0.8, 1.2);
          shootHostile(ctx, E.x[i], E.z[i], dx, dz, R.rangedShotSpeed, E.dmg[i] * 0.8, sp.shot ?? sp.elements[0], 0.45, E.species[i], E.y[i]);
          ctx.events.push({ t: 'enemyShot', x: E.x[i], z: E.z[i], element: sp.shot ?? sp.elements[0] });
        }
      } else if (sp.behaviour === 'charger') {
        if (E.state[i] === 0 && dist < 10 && E.attackCd[i] <= 0) { E.state[i] = 1; E.stateT[i] = R.chargeWindup; E.tx[i] = ux; E.tz[i] = uz; }
        if (E.state[i] === 1) { speed = 0; E.stateT[i] -= dt; if (E.stateT[i] <= 0) { E.state[i] = 2; E.stateT[i] = R.chargeTime; } }
        else if (E.state[i] === 2) { ux = E.tx[i]; uz = E.tz[i]; speed *= R.chargeSpeedMult; E.stateT[i] -= dt; if (E.stateT[i] <= 0) { E.state[i] = 0; E.attackCd[i] = R.chargeCooldown; } }
      } else if (roles & ROLE.swarm) {
        const w = dsin(ctx.time * 4 + i * 1.7) * 0.6;
        const tx = ux * dcos(w) - uz * dsin(w), tz = ux * dsin(w) + uz * dcos(w);
        ux = tx; uz = tz;
      }

      // in a liquid it is not safe in (sim/hazards.ts): head for the shore picked on entry, wading slowly; over open air
      // (falling) it has nothing to push against
      if (E.hzKind[i] && ground && !(roles & ROLE.boss)) {
        const gx = E.hzX[i] - E.x[i], gz = E.hzZ[i] - E.z[i], gl = dhypot(gx, gz) || 1;
        ux = gx / gl; uz = gz / gl;
        speed *= E.hzKind[i] === 2 ? ctx.rules.hazards.lava.speed : ctx.rules.hazards.water.speed;
      }
      if (E.fallV[i] > 0) speed = 0;
      // any enemy started on a throw (src/sim/actions.ts) stands and winds up
      if (E.state[i] === THROWING) { E.stateT[i] -= dt; speed = 0; throwTick(ctx, i, 0); }
      if (frozen) speed = 0;
      if (!(roles & ROLE.boss)) {
        const [fs, grip] = E.hover[i] > 0 ? [1, 1] : footing(ctx, E.x[i], E.z[i], sp.elements, true);
        E.vx[i] += (ux * speed * fs - E.vx[i]) * steer * grip;
        E.vz[i] += (uz * speed * fs - E.vz[i]) * steer * grip;
      }

      // separation via grid
      const r2 = 2 * E.radius[i] + R.separationPad;
      const n = ctx.grid.query(E.x[i], E.z[i], r2);
      let sx = 0, sz = 0;
      for (let k = 0; k < n && k < 24; k++) {
        const j = ctx.grid.result[k];
        if (j === i || !E.alive[j]) continue;
        const ox = E.x[i] - E.x[j], oz = E.z[i] - E.z[j];
        const d2 = ox * ox + oz * oz;
        const lim = E.radius[i] + E.radius[j] + 0.15;
        if (d2 < lim * lim && d2 > 1e-6) {
          const d = Math.sqrt(d2);
          const push = (lim - d) / lim;
          sx += (ox / d) * push; sz += (oz / d) * push;
        }
      }
      const sepK = roles & ROLE.boss ? 0.2 : R.separationForce;
      const ox = E.x[i], oz = E.z[i];
      // positions are stored as float32: round before the wall test so the stored point is the tested one
      let nx = Math.fround(clamp(ox + (E.vx[i] + E.kx[i] + sx * sepK) * dt, -W.bound, W.bound));
      let nz = Math.fround(clamp(oz + (E.vz[i] + E.kz[i] + sz * sepK) * dt, -W.bound, W.bound));
      E.kx[i] *= kdecay; E.kz[i] *= kdecay;
      if (ground) {
        const feet = E.py[i];
        // solid geometry stops anything; a lethal liquid or open air only stops a creature walking there on its own
        // (knockback past rules.hazards.forcedKnock carries it over the lip)
        const forced = W.hazards && dhypot(E.kx[i], E.kz[i]) > ctx.rules.hazards.forcedKnock;
        const up = W.hazards && W.liquidAt(ox, oz, feet, ctx.rules.hazards.contact) ? Math.max(0.6, ctx.rules.hazards.climbOut) : 0.6; // climbing out of a liquid
        // headroom: its height meets deck slabs (World ignores it with rules.size.headroom off, as before)
        const tall = E.tall[i];
        const stop = W.hazards
          ? (x: number, z: number) => W.collides(x, z, feet, up, tall) || (!forced && avoidsStep(ctx, i, ox, oz, x, z, feet))
          : (x: number, z: number) => W.blocks(x, z, feet, 0.6, tall);
        if (E.foot[i] > 0) {
          // its footprint against walls and faces (World.moveBody); the centre-point rules (no walking into open air or a
          // liquid on its own) stay as `stop`
          W.moveBody(ox, oz, nx - ox, nz - oz, feet, W.hazards ? up : 0.6, E.foot[i], MOVE, W.hazards && !forced ? (x, z) => avoidsStep(ctx, i, ox, oz, x, z, feet) : undefined, tall);
          const fx = Math.fround(MOVE[0]), fz = Math.fround(MOVE[1]);
          if (stop(fx, fz) && !stop(ox, oz)) { nx = ox; nz = oz; } else { nx = fx; nz = fz; }
        } else if (stop(nx, nz)) {
          if (!stop(nx, oz)) nz = oz;
          else if (!stop(ox, nz)) nx = ox;
          else { nx = ox; nz = oz; }
        }
      }
      E.x[i] = nx; E.z[i] = nz;
      if (W.hazards && ground) {
        // support ends over open air: it falls (sim/hazards.ts knocks it out below the map's floor)
        const sg = W.support(E.x[i], E.z[i], E.y[i]);
        if (sg === -Infinity || E.y[i] - sg > 0.65 + E.fallV[i] * dt) {
          E.fallV[i] += ctx.rules.player.gravity * dt;
          E.y[i] = Math.max(sg, E.y[i] - E.fallV[i] * dt);
          if (E.y[i] <= sg) E.fallV[i] = 0;
        } else { E.fallV[i] = 0; E.y[i] = sg; }
        // landed this tick (a ledge drop or a fall): faces were measured from its feet on the way down, so it may stand in
        // the lip of the ground it landed on; clear the footprint now (World.moveBody's push), not on its next move
        if (E.foot[i] > 0 && E.fallV[i] === 0 && E.py[i] - E.y[i] > 0.3) {
          clearLanding(W, E.x[i], E.z[i], E.y[i], 0.6, E.foot[i], E.tall[i], MOVE); // shared with the player (sim/locomotion.ts)
          E.x[i] = Math.fround(MOVE[0]); E.z[i] = Math.fround(MOVE[1]);
        }
      } else {
        const g = W.over ? W.height(E.x[i], E.z[i], E.y[i] - E.hover[i]) : W.height(E.x[i], E.z[i]);
        {
          const hv = E.hover[i] > 0 ? traversalOf(sp, ctx.rules).hover : null; // the hover row's bob
          E.y[i] = g + E.hover[i] + (hv ? dsin(ctx.time * hv.bobRate + i) * hv.bob : 0);
        }
      }

      const vlen = dhypot(E.vx[i], E.vz[i]);
      if (vlen > 0.3) E.facing[i] = datan2(E.vx[i], E.vz[i]);
      else if (dist < 20) E.facing[i] = datan2(dx, dz);
      E.animT[i] += Math.max(vlen, 1.2) * dt;

      // contact damage + crowd push on player
      const cr = E.radius[i] + pr;
      if (dist < cr && Math.abs(E.y[i] - E.hover[i] - P.y) < 1.4 + E.radius[i]) {
        const push = (cr - dist) / cr;
        const qx = P.x - ux * push * ctx.rules.player.crowdPush * dt * (roles & ROLE.boss ? 3 : 1);
        const qz = P.z - uz * push * ctx.rules.player.crowdPush * dt * (roles & ROLE.boss ? 3 : 1);
        const ph = partnerHeight(P.species, ctx.rules); // headroom: the partner's height meets deck slabs
        if (pf > 0) { W.moveBody(P.x, P.z, qx - P.x, qz - P.z, P.y, ctx.rules.player.stepHeight, pf, MOVE, undefined, ph); P.x = MOVE[0]; P.z = MOVE[1]; }
        else if (!W.collides(qx, qz, P.y, ctx.rules.player.stepHeight, ph)) { P.x = qx; P.z = qz; }
        if (E.contactCd[i] <= 0 && !frozen && E.dmg[i] > 0) {
          E.contactCd[i] = R.contactCooldown;
          const charging = sp.behaviour === 'charger' && E.state[i] === 2;
          const res = damagePlayer(ctx, E.dmg[i] * (charging ? 1.5 : 1) * enemyAttackMult(ctx, i), E.x[i], E.z[i], 1, weightClass(sp, (roles & ROLE.boss) !== 0), sp.elements[0], { kind: 'creature', name: sp.name }, channelOf(sp));
          // your Pokémon's Static or Effect Spore: 30% to stun whatever touched it
          if (res === 'hit' && (playerAbility(ctx) === AB_STATIC || playerAbility(ctx) === AB_SPORE) && ctx.rng.combat.next() < 0.3) {
            E.stun[i] = Math.max(E.stun[i], roles & ROLE.boss ? 0.3 : 1.2);
            ctx.events.push({ t: 'ability', name: playerAbility(ctx) === AB_STATIC ? 'Static' : 'Effect Spore', x: E.x[i], z: E.z[i], enemy: i });
          }
          if (res === 'parry') {
            // a timed Guard against something no heavier than you: it bounces off, stunned
            const G = ctx.rules.combat;
            const kx = E.x[i] - P.x, kz = E.z[i] - P.z, kl = dhypot(kx, kz) || 1;
            const resist = roles & ROLE.boss ? 0.15 : roles & ROLE.alpha ? 0.4 : roles & ROLE.elite ? 0.7 : 1;
            E.kx[i] += (kx / kl) * G.parryKnock * resist; E.kz[i] += (kz / kl) * G.parryKnock * resist;
            E.stun[i] = Math.max(E.stun[i], G.parryStun * resist);
            if (E.state[i] === 2) E.state[i] = 0; // a parried charge ends
            E.contactCd[i] = Math.max(E.contactCd[i], 0.6);
            ctx.events.push({ t: 'parry', x: E.x[i], z: E.z[i], enemy: i });
          }
        }
      }
    }
  },
};

