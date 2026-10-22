// Enemy spawning (director), steering, behaviours, bosses.
// Steering [C]: desired direction straight at the player; velocity eases toward it by
// min(1, 10*dt); knockback decays by exp(-7*dt); neighbours within 2r + 1 push apart via the grid.

import { datan2, dcos, dexp, dhypot, dpow, dsin } from '../core/detmath';
import { clamp } from '../core/util';
import { ABILITY_IDS, abilityOf } from '../rules/abilities';
import { ELEMENTS, type Element } from '../rules/elements';
import { SPECIES_BY_ID, bst, weightClass, type SpeciesDef } from '../rules/species';
import { STAGES } from '../rules/stages';
import { damageEnemy, damagePlayer, enemyAttackMult, killEnemy, playerAbility } from './combat';
const AB_CHLOROPHYLL = ABILITY_IDS.indexOf('chlorophyll') + 1;
const AB_STATIC = ABILITY_IDS.indexOf('static') + 1, AB_SPORE = ABILITY_IDS.indexOf('effect_spore') + 1;
import { PK, ROLE, ZK } from './pools';
import { spawnBody, TEAM } from './bodies';
import { applyAgent, agentOf, footing } from './cells';
import { coatMember } from './coats';
import { agentElement } from '../rules/compositions';
import { agentIndex } from '../rules/reactions';
import type { SimContext } from './types';
import { shotWeight } from '../rules/capabilities';
import { tickHeldEnemy } from './capabilities';

export function stageIndex(ctx: SimContext) {
  return Math.min(ctx.stage, ctx.rules.director.hpN.length - 1);
}

export function hpMultiplier(ctx: SimContext): number {
  const D = ctx.rules.director;
  const s = stageIndex(ctx);
  const t = ctx.stageTime / 60;
  let m = (1 + D.hpLinear * t + Math.max(0, t - D.hpKnee) ** 2 * D.hpR[s]) * D.hpN[s];
  m *= 1 + ctx.loop * 2;
  if (ctx.director.finalSwarm) {
    const since = Math.max(0, ctx.stageTime - ctx.rules.stage.finalSwarmAt) / 60;
    m *= dpow(D.finalSwarmBase, since);
  }
  return m;
}

export function toughness(ctx: SimContext): number {
  const D = ctx.rules.director;
  return D.toughnessBase + D.toughnessEarly * Math.max(0, 1 - ctx.time / D.toughnessWindow);
}

export function speedFactor(ctx: SimContext): number {
  const D = ctx.rules.director;
  const t = ctx.stageTime / 60;
  return Math.min(D.speedCap, 1 + D.speedPerMin * t + D.speedPerStage * stageIndex(ctx));
}

export function spawnEnemy(ctx: SimContext, id: string, x: number, z: number, roles = 0): number {
  const sp = SPECIES_BY_ID[id];
  if (!sp) throw new Error('unknown species ' + id);
  const E = ctx.enemies;
  const i = E.spawn();
  if (i < 0) return -1;
  const R = ctx.rules.enemy;
  const diff = ctx.rules.mode.difficulty;
  const b = bst(sp.stats);
  let hpRole = 1, dmgRole = 1, size = 1, xpRole = 1;
  if (roles & ROLE.boss) { hpRole = R.roles.boss.hp; dmgRole = R.roles.boss.dmg; size = R.roles.boss.size; xpRole = R.roles.boss.xp; }
  else if (roles & ROLE.alpha) { hpRole = R.roles.alpha.hp; dmgRole = R.roles.alpha.dmg; size = R.roles.alpha.size; xpRole = R.roles.alpha.xp; }
  else if (roles & ROLE.elite) { hpRole = R.roles.elite.hp; dmgRole = R.roles.elite.dmg; size = R.roles.elite.size; xpRole = R.roles.elite.xp; }
  const beh = sp.behaviour ?? 'chase';
  if (beh === 'ranged') roles |= ROLE.ranged;
  if (beh === 'healer') roles |= ROLE.healer;
  if (beh === 'swarm') roles |= ROLE.swarm;
  if (sp.flying) roles |= ROLE.flying;
  const hp = (R.hpBase + b * R.hpPerBst) * hpMultiplier(ctx) * toughness(ctx) * hpRole * diff;
  let speed = Math.min(R.speedMax, R.speedBase + sp.stats.spe * R.speedPerSpe) * speedFactor(ctx) * Math.sqrt(diff);
  if (beh === 'tank') speed *= 0.72;
  if (beh === 'swarm') speed *= 1.12;
  if (beh === 'ranged') speed *= 0.85;
  if (roles & ROLE.boss) speed *= 0.8;
  if (!sp.flying && !ctx.world.walkable(x, z)) [x, z] = ctx.world.nearestWalkable(x, z);
  E.x[i] = x; E.z[i] = z; E.px[i] = x; E.pz[i] = z;
  E.hover[i] = sp.flying ? 0.9 + ((i * 37) % 10) * 0.05 : 0;
  E.y[i] = ctx.world.height(x, z) + E.hover[i]; E.py[i] = E.y[i];
  E.hp[i] = E.maxHp[i] = hp;
  E.speed[i] = speed;
  E.dmg[i] = (R.dmgBase + sp.stats.atk * R.dmgPerAtk + sp.stats.spa * R.dmgPerSpa) * dmgRole;
  E.size[i] = size;
  E.radius[i] = clamp(sp.height * 0.4, 0.35, 3.2) * size;
  E.species[i] = ctx.speciesIndex.indexOf(sp);
  { const ab = abilityOf(sp); E.ability[i] = ab ? ABILITY_IDS.indexOf(ab) + 1 : 0; }
  E.roles[i] = roles;
  E.xp[i] = (ctx.rules.xp.gemBase + b * ctx.rules.xp.gemPerBst) * xpRole;
  E.attackCd[i] = ctx.rng.ai.range(0.5, 2);
  E.facing[i] = datan2(ctx.player.x - x, ctx.player.z - z);
  if (roles & ROLE.boss) { E.state[i] = 0; E.stateT[i] = 1.6; E.attackCd[i] = 2.5; }
  return i;
}

export function ringPoint(ctx: SimContext, rMin: number, rMax: number): [number, number] {
  const P = ctx.player;
  const b = ctx.world.bound;
  for (let k = 0; k < 10; k++) {
    const a = ctx.rng.spawn.range(0, Math.PI * 2);
    const r = ctx.rng.spawn.range(rMin, rMax);
    const x = P.x + dcos(a) * r, z = P.z + dsin(a) * r;
    if (Math.abs(x) < b && Math.abs(z) < b && ctx.world.walkable(x, z)) return [x, z];
  }
  const a = ctx.rng.spawn.range(0, Math.PI * 2);
  return [clamp(P.x + dcos(a) * rMin, -b, b), clamp(P.z + dsin(a) * rMin, -b, b)];
}

export function shootHostile(ctx: SimContext, x: number, z: number, dx: number, dz: number, speed: number, dmg: number, element: Element, radius = 0.45, srcSp = -1) {
  const Pr = ctx.projectiles;
  const i = Pr.spawn();
  if (i < 0) return;
  const L = dhypot(dx, dz) || 1;
  Pr.kind[i] = PK.hostile;
  Pr.x[i] = x; Pr.z[i] = z; Pr.y[i] = ctx.world.height(x, z) + 0.9;
  Pr.vx[i] = (dx / L) * speed; Pr.vz[i] = (dz / L) * speed;
  Pr.life[i] = Pr.maxLife[i] = 4.5;
  Pr.dmg[i] = dmg; Pr.radius[i] = radius; Pr.pierce[i] = 0;
  Pr.element[i] = ELEMENTS.indexOf(element);
  // Phase 8a: a shot is a light body (Weight 0; heavy shots 1) and remembers who fired it (death recap)
  Pr.weight[i] = shotWeight(false, radius, ctx.rules.caps.heavyShotRadius); Pr.src[i] = srcSp;
}

/** start (or queue) a boulder throw at the player: `left` throws remain, the first after `delay` s */
function aimBoulder(ctx: SimContext, i: number, left: number, delay = ctx.rules.bosses.boulderWindup) {
  const E = ctx.enemies, P = ctx.player;
  const dx = P.x - E.x[i], dz = P.z - E.z[i], L = dhypot(dx, dz) || 1;
  E.state[i] = 7; E.stateT[i] = delay; E.tx[i] = dx / L; E.tz[i] = dz / L; E.sx[i] = left;
  E.facing[i] = datan2(dx, dz);
  ctx.events.push({ t: 'line', x1: E.x[i], z1: E.z[i], x2: E.x[i] + (dx / L) * 26, z2: E.z[i] + (dz / L) * 26, width: 2.2, life: delay });
}

const NAV: [number, number] = [0, 0];

export const enemySystem = {
  name: 'enemies',
  update(ctx: SimContext, dt: number) {
    const E = ctx.enemies;
    const P = ctx.player;
    const R = ctx.rules.enemy;
    const W = ctx.world;
    const steer = Math.min(1, R.steerRate * dt);
    const kdecay = dexp(-R.knockDecay * dt);
    const pr = ctx.rules.player.radius;
    const RR = ctx.rules.roles, O = ctx.objective;
    const bulwarks = ctx.director.bulwarks;
    bulwarks.length = 0;
    W.updateFlow(P.x, P.z);
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
      const pinned = O !== null && (O.target === i || O.mender === i) && (O.phase === 'offer' || O.phase === 'active');
      if (dist > R.despawnDistance && !(roles & ROLE.boss) && !pinned) {
        const a = datan2(P.vx, P.vz) + ctx.rng.ai.range(-1, 1);
        let nx = clamp(P.x + dsin(a) * 30, -W.bound, W.bound), nz = clamp(P.z + dcos(a) * 30, -W.bound, W.bound);
        if (!sp.flying && !W.walkable(nx, nz)) [nx, nz] = W.nearestWalkable(nx, nz);
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
      if (ground && dist > 1.5) {
        // straight at the player unless a wall, water or cliff is in the way; then follow the flow field
        const feet = E.y[i];
        if (W.blocks(E.x[i] + ux * 1.1, E.z[i] + uz * 1.1, feet, 0.6) || W.blocks(E.x[i] + ux * 2.4, E.z[i] + uz * 2.4, feet, 0.6)) {
          if (W.flowDir(E.x[i], E.z[i], NAV)) { ux = NAV[0]; uz = NAV[1]; }
        } else if (burning && !sp.elements.includes('blaze') && (W.burningAt(E.x[i], E.z[i]) || W.burningAt(E.x[i] + ux * 1.1, E.z[i] + uz * 1.1) || W.burningAt(E.x[i] + ux * 2.4, E.z[i] + uz * 2.4))) {
          // Phase 8a: fire ahead (or underfoot): follow the weighted flow field around it (Fire types walk through)
          if (W.flowDir(E.x[i], E.z[i], NAV)) { ux = NAV[0]; uz = NAV[1]; }
        }
      }
      if (E.confuse[i] > 0 || E.blind[i] > 0) { const a = dsin(ctx.time * 3 + i) * Math.PI; ux = dsin(a); uz = dcos(a); }

      // the objective a Raider is after, or the Mender a hurt Hunt target runs to (blueprint section 9)
      let goal: [number, number] | null = null;
      if (O && (O.phase === 'offer' || O.phase === 'active')) {
        if (roles & ROLE.hunt && O.kind === 'hunt' && O.target === i && E.hp[i] < E.maxHp[i] * ctx.rules.objectives.hunt.flee && O.mender >= 0 && E.alive[O.mender]) goal = [E.x[O.mender], E.z[O.mender]];
        else if (roles & ROLE.raider && O.phase === 'active') {
          if (O.kind === 'hold') goal = [O.x, O.z];
          else if (O.kind === 'transport' && O.egg >= 0) {
            if (O.carrier === i) goal = [E.x[i] - dx, E.z[i] - dz]; // got it: run away from you
            else if (O.carrier === -1) goal = [ctx.bodies.x[O.egg], ctx.bodies.z[O.egg]];
          }
        }
      }

      if (roles & ROLE.boss) {
        bossThink(ctx, i, sp, dist, ux, uz, dt);
      } else if (goal) {
        const gx = goal[0] - E.x[i], gz = goal[1] - E.z[i], gl = dhypot(gx, gz);
        if (gl < 1.4) speed *= 0.15; else { ux = gx / gl; uz = gz / gl; }
        // around walls: slide along the blocked axis
        if (ground && W.blocks(E.x[i] + ux * 1.1, E.z[i] + uz * 1.1, E.y[i], 0.6)) { const t = ux; ux = -uz; uz = t; }
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
        if (!frozen && E.blind[i] <= 0 && dist < R.rangedRange && E.attackCd[i] <= 0) {
          E.attackCd[i] = R.rangedCooldown * ctx.rng.ai.range(0.8, 1.2);
          shootHostile(ctx, E.x[i], E.z[i], dx, dz, R.rangedShotSpeed, E.dmg[i] * 0.8, sp.shot ?? sp.elements[0], 0.45, E.species[i]);
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

      if (frozen || (roles & ROLE.boss && E.state[i] === 99)) speed = 0;
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
      if (ground && !(roles & ROLE.boss && E.state[i] === 5)) {
        const feet = E.py[i];
        if (W.blocks(nx, nz, feet, 0.6)) {
          if (!W.blocks(nx, oz, feet, 0.6)) nz = oz;
          else if (!W.blocks(ox, nz, feet, 0.6)) nx = ox;
          else { nx = ox; nz = oz; }
        }
      }
      E.x[i] = nx; E.z[i] = nz;
      const g = W.height(E.x[i], E.z[i]);
      if (!(roles & ROLE.boss && E.state[i] === 5)) E.y[i] = g + E.hover[i] + (E.hover[i] > 0 ? dsin(ctx.time * 3 + i) * 0.15 : 0);

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
        if (!W.blocks(qx, qz, P.y, ctx.rules.player.stepHeight)) { P.x = qx; P.z = qz; }
        if (E.contactCd[i] <= 0 && !frozen) {
          E.contactCd[i] = R.contactCooldown;
          const charging = (sp.behaviour === 'charger' && E.state[i] === 2) || (roles & ROLE.boss && E.state[i] === 2);
          const res = damagePlayer(ctx, E.dmg[i] * (charging ? 1.5 : 1) * enemyAttackMult(ctx, i), E.x[i], E.z[i], 1, weightClass(sp, (roles & ROLE.boss) !== 0), sp.elements[0], { kind: 'creature', name: sp.name });
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
            if (E.state[i] === 2) E.state[i] = roles & ROLE.boss ? 1 : 0; // a parried charge ends
            E.contactCd[i] = Math.max(E.contactCd[i], 0.6);
            ctx.events.push({ t: 'parry', x: E.x[i], z: E.z[i], enemy: i });
          }
        }
      }
    }
  },
};

// ------------------------------------------------------------------ bosses
// states: 0 intro, 1 idle/chase, 2 charging, 3 charge windup, 4 spiral, 5 leaping, 6 volley
function bossThink(ctx: SimContext, i: number, sp: SpeciesDef, dist: number, ux: number, uz: number, dt: number) {
  const E = ctx.enemies;
  const P = ctx.player;
  const kit = sp.boss!;
  const phase = E.bossPhase[i];
  const el = sp.elements[0];
  E.stateT[i] -= dt;

  // phase changes [C]: clear hostile projectiles
  const frac = E.hp[i] / E.maxHp[i];
  if (phase < kit.phaseHp.length && frac < kit.phaseHp[phase]) {
    E.bossPhase[i]++;
    ctx.projectiles.clearHostile();
    ctx.events.push({ t: 'bossPhase', phase: E.bossPhase[i] });
    ctx.events.push({ t: 'hitstop', dur: 0.3 });
    ctx.events.push({ t: 'shake', amount: 0.7, x: E.x[i], z: E.z[i] });
    ctx.events.push({ t: 'ring', x: E.x[i], z: E.z[i], r: 7, element: el, life: 0.6 });
  }

  const steer = Math.min(1, ctx.rules.enemy.steerRate * dt);
  const st = E.state[i];
  let speed = E.speed[i] * (1 + phase * 0.15);
  if (st === 0) { // intro
    speed = 0;
    if (E.stateT[i] <= 0) { E.state[i] = 1; }
  } else if (st === 1) {
    if (E.attackCd[i] <= 0) {
      const extra = (ctx.rules.bosses.extraAttacks[sp.id] ?? []) as typeof kit.attacks;
      const atk = ctx.rng.ai.pick(extra.length ? [...kit.attacks, ...extra] : kit.attacks);
      E.attackCd[i] = Math.max(1.2, 3.0 - phase * 0.6) * ctx.rng.ai.range(0.85, 1.15);
      switch (atk) {
        case 'charge':
          E.state[i] = 3; E.stateT[i] = 0.8; E.tx[i] = ux; E.tz[i] = uz;
          ctx.events.push({ t: 'line', x1: E.x[i], z1: E.z[i], x2: E.x[i] + ux * 22, z2: E.z[i] + uz * 22, width: E.radius[i] * 1.6, life: 0.8 });
          break;
        case 'slam': {
          const zi = ctx.zones.spawn();
          if (zi >= 0) {
            const Z = ctx.zones;
            Z.kind[zi] = ZK.hostileSlam; Z.x[zi] = P.x; Z.z[zi] = P.z; Z.radius[zi] = 5 + phase;
            Z.delay[zi] = 1.15; Z.life[zi] = Z.maxLife[zi] = 2; Z.dmg[zi] = E.dmg[i] * 1.6; Z.element[zi] = ELEMENTS.indexOf(el); Z.src[zi] = E.species[i];
            ctx.events.push({ t: 'telegraph', x: P.x, z: P.z, r: 5 + phase, life: 1.15, hostile: true });
            E.state[i] = 5; E.stateT[i] = 1.15; E.tx[i] = P.x; E.tz[i] = P.z;
            E.sx[i] = E.x[i]; E.sz[i] = E.z[i];
          }
          break;
        }
        case 'radial': {
          const n = 16 + phase * 6;
          const off = ctx.rng.ai.range(0, 1);
          for (let k = 0; k < n; k++) {
            const a = ((k + off) / n) * Math.PI * 2;
            shootHostile(ctx, E.x[i], E.z[i], dsin(a), dcos(a), 8.5, E.dmg[i] * 0.6, el, 0.6, E.species[i]);
          }
          ctx.events.push({ t: 'ring', x: E.x[i], z: E.z[i], r: 4, element: el, life: 0.4 });
          break;
        }
        case 'spiral':
          E.state[i] = 4; E.stateT[i] = 2.4; E.tx[i] = 0;
          break;
        case 'volley':
          E.state[i] = 6; E.stateT[i] = 1.1; E.tx[i] = 0;
          break;
        case 'boulder': {
          // Rock Throw: a 0.6 s wind-up with the path drawn on the ground, then a Heavy boulder rolls at you
          aimBoulder(ctx, i, phase >= 1 ? 2 : 1);
          break;
        }
        case 'summon': {
          const n = 6 + phase * 3;
          for (let k = 0; k < n; k++) {
            const a = (k / n) * Math.PI * 2;
            spawnEnemy(ctx, kit.summon ?? 'burrowbun', E.x[i] + dsin(a) * 4, E.z[i] + dcos(a) * 4);
          }
          ctx.events.push({ t: 'ring', x: E.x[i], z: E.z[i], r: 5, element: el, life: 0.5 });
          break;
        }
      }
    }
  } else if (st === 7) { // boulder wind-up
    speed = 0;
    if (E.stateT[i] <= 0) {
      const R = ctx.rules.bosses, dx = E.tx[i], dz = E.tz[i];
      const off = E.radius[i] + 1.3;
      const sx0 = E.x[i] + dx * off, sz0 = E.z[i] + dz * off;
      const [bx, bz] = ctx.world.walkable(sx0, sz0) ? [sx0, sz0] : [E.x[i], E.z[i]];
      spawnBody(ctx, 'boulder', bx, bz, dx * R.boulderSpeed, dz * R.boulderSpeed, TEAM.enemy, E.dmg[i] * R.boulderDmg * 10 / R.boulderSpeed);
      ctx.events.push({ t: 'throw', x: bx, z: bz, tx: bx + dx * 20, tz: bz + dz * 20, element: 'stone' });
      if (E.sx[i] > 1) aimBoulder(ctx, i, E.sx[i] - 1, 1.5); else E.state[i] = 1;
    }
  } else if (st === 3) { // windup
    speed = 0;
    if (E.stateT[i] <= 0) { E.state[i] = 2; E.stateT[i] = 1.0; }
  } else if (st === 2) { // charging
    ux = E.tx[i]; uz = E.tz[i]; speed *= 3.4;
    if (E.stateT[i] <= 0) E.state[i] = 1;
  } else if (st === 4) { // spiral
    speed *= 0.3;
    E.tx[i] -= dt;
    if (E.tx[i] <= 0) {
      E.tx[i] = 0.11;
      const base = ctx.time * 2.6;
      const arms = 3 + phase;
      for (let k = 0; k < arms; k++) {
        const a = base + (k / arms) * Math.PI * 2;
        shootHostile(ctx, E.x[i], E.z[i], dsin(a), dcos(a), 7.5, E.dmg[i] * 0.5, el, 0.5, E.species[i]);
      }
    }
    if (E.stateT[i] <= 0) E.state[i] = 1;
  } else if (st === 6) { // volley
    speed = 0;
    E.tx[i] -= dt;
    if (E.tx[i] <= 0) {
      E.tx[i] = 0.36;
      const base = datan2(P.x - E.x[i], P.z - E.z[i]);
      for (let k = -2; k <= 2; k++) shootHostile(ctx, E.x[i], E.z[i], dsin(base + k * 0.18), dcos(base + k * 0.18), 13, E.dmg[i] * 0.55, el, 0.55, E.species[i]);
    }
    if (E.stateT[i] <= 0) E.state[i] = 1;
  } else if (st === 5) { // leaping to slam point
    speed = 0;
    const sx = E.sx[i], sz = E.sz[i];
    const f = 1 - Math.max(0, E.stateT[i]) / 1.15;
    E.x[i] = sx + (E.tx[i] - sx) * f;
    E.z[i] = sz + (E.tz[i] - sz) * f;
    E.y[i] = ctx.world.height(E.x[i], E.z[i]) + dsin(f * Math.PI) * 7;
    E.vx[i] = 0; E.vz[i] = 0;
    if (E.stateT[i] <= 0) { E.state[i] = 1; }
    return;
  }
  E.vx[i] += (ux * speed - E.vx[i]) * steer;
  E.vz[i] += (uz * speed - E.vz[i]) * steer;
  void dist;
}

export { damageEnemy };
