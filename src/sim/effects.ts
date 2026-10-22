// Projectile and zone systems.
import { datan2, dcos, dhypot, dsin } from '../core/detmath';
import { ELEMENTS } from '../rules/elements';
import { AILMENTS, damageEnemy, damagePlayer, type DamageSpec } from './combat';
import { enemiesInRadius, hitScratch } from './moves';
import { PK, ZK } from './pools';
import { deflecting } from './player';
import { damageBody, eachBodyIn, moveOnBody, tpl } from './bodies';
import { agentOf, applyAgent } from './cells';
import { slotSpec } from './moves';
import { coatMember } from './coats';
import { agentIndex } from '../rules/reactions';

/** the move spec behind a projectile or zone (slot index), or null for deflected / orphaned ones */
function sourceSpec(ctx: SimContext, slot: number) {
  return slot >= 0 && slot < ctx.player.moves.length ? slotSpec(ctx, slot) : null;
}
/** a player effect touches body b. Phase 8a: effects without a move slot (Tag Actions) still carry their
 *  move's Push and Hold Power (`push`, `hold`), so they move bodies by the same rule as everything else. */
function effectOnBody(ctx: SimContext, b: number, slot: number, dmg: number, element: number, dx: number, dz: number, push = 0, hold = 0) {
  if (ctx.bodies.holdT[b] > 0) return; // your own effects pass a body you are holding
  const s = sourceSpec(ctx, slot);
  if (s) moveOnBody(ctx, b, s, dmg, dx, dz, slot);
  else {
    if ((push || hold) && ctx.rules.caps.enabled && ctx.bodies.alive[b] && ctx.bodies.hitCd[b] <= ctx.time) {
      ctx.bodies.hitCd[b] = ctx.time + 0.2;
      setSrc(slot === TAG_SLOT ? 'tag' : 'shot', slot === TAG_SLOT ? 'Tag Action' : 'deflected shot');
      forceOnBody(ctx, b, push, hold, dx, dz, slot);
    }
    damageBody(ctx, b, dmg * ctx.rules.damage.playerMult, ELEMENTS[element], true);
  }
}
import { aimDir } from './moves';

/** Send a hostile shot back along the player's aim: it joins the player's team and hits enemies. */
function deflectShot(ctx: SimContext, i: number) {
  const Pr = ctx.projectiles, P = ctx.player;
  const [ux, uz] = aimDir(ctx, Pr.x[i] - P.x, Pr.z[i] - P.z, -Pr.vx[i], -Pr.vz[i]);
  if (ctx.rules.caps.enabled) {
    setSrc('player', P.species.name);
    const r = rec(ctx, 'deflect', 'ok');
    if (r) { r.power = guardWeight(ctx); r.weight = Pr.weight[i]; r.tgt = 'shot'; r.tgtName = Pr.src[i] >= 0 ? ctx.speciesIndex[Pr.src[i]].name : 'shot'; r.x = Pr.x[i]; r.z = Pr.z[i]; }
  }
  launchShot(ctx, i, ux, uz);
  P.guardHit = true;
  onGuardDeflect(ctx);
  P.aimFacing = datan2(ux, uz); P.aimT = 0.2;
  ctx.events.push({ t: 'deflect', x: Pr.x[i], z: Pr.z[i], element: ELEMENTS[Pr.element[i]] });
}
import type { SimContext } from './types';
import { capsOn, forceOnShots, interceptPass, launchShot, tickHeldShot } from './capabilities';
import { rec, setSrc } from './caplog';
import { forceOnBody, TEAM } from './bodies';
import { TAG_SLOT } from './squad';
import { guardWeight, onGuardDeflect } from './techniques';
import { brambleAt } from './cells';
import { resolve } from './capabilities';

const ds: DamageSpec = { element: 'plain', cls: 'special', ailment: 'knock', chance: 0, knock: 0, kx: 0, kz: 0, drain: 0, source: '' };

function fill(ctx: SimContext, i: number, kx: number, kz: number, fromZone = false) {
  if (fromZone) {
    const Z = ctx.zones;
    ds.element = ELEMENTS[Z.element[i]]; ds.cls = Z.cls[i] ? 'special' : 'physical';
    ds.ailment = AILMENTS[Z.ailment[i]]; ds.chance = Z.chance[i]; ds.knock = Z.knock[i]; ds.drain = 0;
  } else {
    const Pr = ctx.projectiles;
    ds.element = ELEMENTS[Pr.element[i]]; ds.cls = Pr.cls[i] ? 'special' : 'physical';
    ds.ailment = AILMENTS[Pr.ailment[i]]; ds.chance = Pr.chance[i]; ds.knock = Pr.knock[i]; ds.drain = Pr.drain[i];
  }
  ds.kx = kx; ds.kz = kz; ds.source = 'fx';
  // coat depth: the basic attack (slot 0) light; moves A/B, Tag Actions and deflected shots (-1) deep
  // (Phase 8b: unless the move always coats one way, or Catalyst stops the basic attack's light coats)
  const slot = fromZone ? ctx.zones.move[i] : ctx.projectiles.move[i];
  const od = fromZone ? ctx.zones.depth[i] : ctx.projectiles.depth[i];
  ds.depth = od !== 255 ? od : slot === 0 ? 1 : 2;
  ds.push = fromZone ? ctx.zones.pushP[i] : ctx.projectiles.pushP[i];
  ds.extra = fromZone ? ctx.zones.extra[i] : ctx.projectiles.extra[i];
  return ds;
}

/** Phase 8b: where a shot ends (it hits, stops or runs out): Kindle puts Heat on the ground there */
function endShot(ctx: SimContext, i: number) {
  const Pr = ctx.projectiles;
  if (Pr.fx[i] === 1 && Pr.kind[i] !== PK.hostile) applyAgent(ctx, 'heat', Pr.x[i], Pr.z[i], Pr.fxR[i]);
  Pr.kill(i);
}

function explode(ctx: SimContext, i: number) {
  const Pr = ctx.projectiles;
  const r = Pr.aoe[i];
  const x = Pr.x[i], z = Pr.z[i];
  const n = enemiesInRadius(ctx, x, z, r);
  const E = ctx.enemies;
  for (let k = 0; k < n; k++) {
    const e = hitScratch[k];
    damageEnemy(ctx, e, Pr.dmg[i], fill(ctx, i, E.x[e] - x, E.z[e] - z));
  }
  eachBodyIn(ctx, x, z, r, (b) => effectOnBody(ctx, b, Pr.move[i], Pr.dmg[i], Pr.element[i], ctx.bodies.x[b] - x, ctx.bodies.z[b] - z, Pr.pushP[i], Pr.holdP[i]));
  applyAgent(ctx, agentOf(ELEMENTS[Pr.element[i]]), x, z, r * 0.8);
  ctx.events.push({ t: 'ring', x, z, r, element: ELEMENTS[Pr.element[i]], life: 0.35 });
  // Phase 8b Burrow: a Grass patch where it lands (Create, through the resolver)
  if (Pr.fx[i] === 2) resolve(ctx, { verb: 'create', power: 0, type: ELEMENTS[Pr.element[i]], owner: TEAM.player, x, z, dx: 0, dz: 0, r: Pr.fxR[i], source: { kind: 'move', id: Pr.move[i], name: 'Burrow' }, target: { kind: 'tile', id: -1 }, template: 'bramble' });
  void brambleAt;
}

export const projectileSystem = {
  name: 'projectiles',
  update(ctx: SimContext, dt: number) {
    const Pr = ctx.projectiles;
    const E = ctx.enemies;
    const P = ctx.player;
    const W = ctx.world;
    const lightBodies = capsOn(ctx, 'interception');
    for (let i = 0; i < Pr.hi; i++) {
      if (!Pr.alive[i]) continue;
      // a caught shot waits at the hold point (Phase 8a); it neither ages nor hits until it is released
      if (Pr.heldT[i] > 0) { tickHeldShot(ctx, i, dt); continue; }
      Pr.life[i] -= dt;
      Pr.t[i] += dt;
      const kind = Pr.kind[i];
      // shots leave their element on the ground they cross: Embers light grass, Water Gun wets it…
      if ((ctx.tick + i) % 3 === 0 && kind !== PK.lob && kind !== PK.orbit) applyAgent(ctx, agentOf(ELEMENTS[Pr.element[i]]), Pr.x[i], Pr.z[i], 0.5);

      if (kind === PK.hostile) {
        Pr.x[i] += Pr.vx[i] * dt;
        Pr.z[i] += Pr.vz[i] * dt;
        Pr.y[i] = W.height(Pr.x[i], Pr.z[i]) + 0.9;
        // rocks and boulders are cover: enemy shots stop on them
        let blocked = false;
        eachBodyIn(ctx, Pr.x[i], Pr.z[i], Pr.radius[i], (b) => { if (tpl(ctx, b).weight >= 1) blocked = true; });
        if (blocked) { Pr.kill(i); continue; }
        const dx = P.x - Pr.x[i], dz = P.z - Pr.z[i];
        const rr = Pr.radius[i] + ctx.rules.player.radius;
        // a Guard deflect window reaches a little further than the body, so a timed tap meets the shot
        // Phase 8a: Guard deflects only shots no heavier than the guarding Pokémon (shots are Weight 0 or 1)
        const canDeflect = deflecting(ctx) && (!lightBodies || Pr.weight[i] <= guardWeight(ctx));
        const reach = canDeflect ? rr + 0.9 : rr;
        if (dx * dx + dz * dz < reach * reach && Math.abs(P.y + 0.6 - Pr.y[i]) < 1.6) {
          if (canDeflect) { deflectShot(ctx, i); continue; }
          if (dx * dx + dz * dz < rr * rr) {
            const res = damagePlayer(ctx, Pr.dmg[i], Pr.x[i], Pr.z[i], 0.5, lightBodies ? Pr.weight[i] : 0, ELEMENTS[Pr.element[i]], { kind: 'shot', name: Pr.src[i] >= 0 ? ctx.speciesIndex[Pr.src[i]].name : '' });
            // an enemy shot of Fire, Water, Ice or Electric coats the Pokémon it hits (light)
            if (res === 'hit') coatMember(ctx, P.m, agentIndex(ELEMENTS[Pr.element[i]]), 1);
            Pr.kill(i);
            continue;
          }
        }
        if (Pr.life[i] <= 0) Pr.kill(i);
        continue;
      }

      if (kind === PK.homing) {
        const t = Pr.target[i];
        if (t >= 0 && E.alive[t]) {
          const dx = E.x[t] - Pr.x[i], dz = E.z[t] - Pr.z[i], L = dhypot(dx, dz) || 1;
          const turn = Math.min(1, 7 * dt);
          const sp = Pr.speed[i] * (1 + Pr.t[i] * 0.8);
          Pr.vx[i] += ((dx / L) * sp - Pr.vx[i]) * turn;
          Pr.vz[i] += ((dz / L) * sp - Pr.vz[i]) * turn;
        } else if (Pr.t[i] > 0.1) {
          Pr.target[i] = -1;
        }
      } else if (kind === PK.boomerang) {
        const out = Pr.t[i] < Pr.maxLife[i] * 0.4;
        if (!out) {
          const dx = P.x - Pr.x[i], dz = P.z - Pr.z[i], L = dhypot(dx, dz) || 1;
          const sp = Pr.speed[i] * 1.2;
          Pr.vx[i] += ((dx / L) * sp - Pr.vx[i]) * Math.min(1, 5 * dt);
          Pr.vz[i] += ((dz / L) * sp - Pr.vz[i]) * Math.min(1, 5 * dt);
          if (L < 1 && Pr.t[i] > 0.5) { Pr.kill(i); continue; }
        }
      } else if (kind === PK.orbit) {
        const a = Pr.ax[i] + Pr.t[i] * Pr.speed[i]; // phase + rad/s * t
        const R = Pr.aoe[i];
        Pr.x[i] = P.x + dsin(a) * R;
        Pr.z[i] = P.z + dcos(a) * R;
      }

      if (kind !== PK.orbit) {
        Pr.x[i] += Pr.vx[i] * dt;
        Pr.z[i] += Pr.vz[i] * dt;
      }
      const ground = W.height(Pr.x[i], Pr.z[i]);
      if (kind === PK.lob) {
        const f = 1 - Math.max(0, Pr.life[i]) / Pr.maxLife[i];
        Pr.y[i] = ground + 0.6 + dsin(f * Math.PI) * 4.5;
        if (Pr.life[i] <= 0) { explode(ctx, i); Pr.kill(i); }
        continue;
      }
      Pr.y[i] = Math.max(ground + 0.7, P.y + 0.8);

      // a Bulwark's shield stops shots coming at its front (lobs go over it, orbits are melee)
      if (kind !== PK.orbit && ctx.director.bulwarks.length && blockedByBulwark(ctx, i)) { endShot(ctx, i); continue; }

      // collisions
      const n = ctx.grid.query(Pr.x[i], Pr.z[i], Pr.radius[i] + 2.5);
      for (let k = 0; k < n && Pr.alive[i]; k++) {
        const e = ctx.grid.result[k];
        if (!E.alive[e] || E.spawnT[e] < 0.25) continue;
        const dx = E.x[e] - Pr.x[i], dz = E.z[e] - Pr.z[i];
        const rr = Pr.radius[i] + E.radius[e];
        if (dx * dx + dz * dz > rr * rr) continue;
        if (Pr.recentlyHit(i, e, ctx.time)) continue;
        const cool = kind === PK.orbit || kind === PK.boomerang ? 0.45 : 999;
        Pr.markHit(i, e, ctx.time + cool);
        damageEnemy(ctx, e, Pr.dmg[i], fill(ctx, i, Pr.vx[i] || dx, Pr.vz[i] || dz));
        if (Pr.pierce[i] >= 0) {
          Pr.pierce[i]--;
          if (Pr.pierce[i] < 0) {
            endShot(ctx, i);
          }
        }
      }
      // bodies: a shot that reaches a rock hits it (and stops, unless it pierces)
      if (Pr.alive[i] && kind !== PK.orbit) {
        eachBodyIn(ctx, Pr.x[i], Pr.z[i], Pr.radius[i], (b) => {
          if (!Pr.alive[i] || Pr.recentlyHit(i, -2 - b, ctx.time)) return;
          Pr.markHit(i, -2 - b, ctx.time + 999);
          effectOnBody(ctx, b, Pr.move[i], Pr.dmg[i], Pr.element[i], Pr.vx[i], Pr.vz[i], Pr.pushP[i], Pr.holdP[i]);
          if (Pr.pierce[i] >= 0) { Pr.pierce[i]--; if (Pr.pierce[i] < 0) endShot(ctx, i); }
        });
      } else if (Pr.alive[i]) {
        eachBodyIn(ctx, Pr.x[i], Pr.z[i], Pr.radius[i], (b) => {
          if (Pr.recentlyHit(i, -2 - b, ctx.time)) return;
          Pr.markHit(i, -2 - b, ctx.time + 0.45);
          effectOnBody(ctx, b, Pr.move[i], Pr.dmg[i], Pr.element[i], ctx.bodies.x[b] - P.x, ctx.bodies.z[b] - P.z, Pr.pushP[i], Pr.holdP[i]);
        });
      }
      if (Pr.alive[i] && Pr.life[i] <= 0) endShot(ctx, i);
      // out of bounds / hit wall
      if (Pr.alive[i] && kind === PK.straight && ground > Pr.y[i] + 1.5) endShot(ctx, i);
    }
    // Phase 8a: shots of opposite teams that overlap after moving: deflect, catch or cancel by Weight
    interceptPass(ctx);
  },
};

export const zoneSystem = {
  name: 'zones',
  update(ctx: SimContext, dt: number) {
    const Z = ctx.zones;
    const E = ctx.enemies;
    const P = ctx.player;
    for (let i = 0; i < Z.hi; i++) {
      if (!Z.alive[i]) continue;
      if (Z.attach[i]) { Z.x[i] = P.x; Z.z[i] = P.z; }
      const kind = Z.kind[i];

      if (Z.delay[i] > 0) {
        Z.delay[i] -= dt;
        if (Z.delay[i] > 0) continue;
        // detonate
        if (kind === ZK.meteor) {
          const n = enemiesInRadius(ctx, Z.x[i], Z.z[i], Z.radius[i]);
          for (let k = 0; k < n; k++) {
            const e = hitScratch[k];
            damageEnemy(ctx, e, Z.dmg[i], fill(ctx, i, E.x[e] - Z.x[i], E.z[e] - Z.z[i], true));
          }
          eachBodyIn(ctx, Z.x[i], Z.z[i], Z.radius[i], (b) => effectOnBody(ctx, b, Z.move[i], Z.dmg[i], Z.element[i], ctx.bodies.x[b] - Z.x[i], ctx.bodies.z[b] - Z.z[i], Z.pushP[i], Z.holdP[i]));
          applyAgent(ctx, agentOf(ELEMENTS[Z.element[i]]), Z.x[i], Z.z[i], Z.radius[i] * 0.8);
          ctx.events.push({ t: 'ring', x: Z.x[i], z: Z.z[i], r: Z.radius[i], element: ELEMENTS[Z.element[i]], life: 0.5 });
          ctx.events.push({ t: 'shake', amount: 0.2, x: Z.x[i], z: Z.z[i] });
          Z.kill(i);
          continue;
        }
        if (kind === ZK.hostileSlam) {
          const dx = P.x - Z.x[i], dz = P.z - Z.z[i];
          if (dx * dx + dz * dz < Z.radius[i] * Z.radius[i] && P.y - ctx.world.height(P.x, P.z) < 1.2) damagePlayer(ctx, Z.dmg[i], Z.x[i], Z.z[i], 1.6, 3, ELEMENTS[Z.element[i]], { kind: 'zone', name: Z.src[i] >= 0 ? ctx.speciesIndex[Z.src[i]].name : '' });
          ctx.events.push({ t: 'ring', x: Z.x[i], z: Z.z[i], r: Z.radius[i], element: ELEMENTS[Z.element[i]], life: 0.5 });
          ctx.events.push({ t: 'shake', amount: 0.5, x: Z.x[i], z: Z.z[i] });
          Z.kill(i);
          continue;
        }
      }

      Z.life[i] -= dt;
      if (Z.life[i] <= 0) { Z.kill(i); continue; }
      Z.tickT[i] -= dt;
      const doTick = Z.tickT[i] <= 0;
      if (doTick) Z.tickT[i] = Z.tick[i];

      if (kind === ZK.heal) continue;
      if (kind === ZK.steam) {
        // steam: enemies inside lose their target and stop shooting (bosses see through it)
        const ns = enemiesInRadius(ctx, Z.x[i], Z.z[i], Z.radius[i]);
        for (let k = 0; k < ns; k++) { const e = hitScratch[k]; if (!(E.roles[e] & 4)) E.blind[e] = Math.max(E.blind[e], 0.3); }
        continue;
      }
      const n = enemiesInRadius(ctx, Z.x[i], Z.z[i], Z.radius[i]);
      for (let k = 0; k < n; k++) {
        const e = hitScratch[k];
        if (Z.pull[i] > 0) {
          const dx = Z.x[i] - E.x[e], dz = Z.z[i] - E.z[e], L = dhypot(dx, dz) || 1;
          const pull = (E.roles[e] & 4) ? 0 : Z.pull[i];
          E.x[e] += (dx / L) * pull * dt;
          E.z[e] += (dz / L) * pull * dt;
        }
        if (kind === ZK.root) E.root[e] = Math.max(E.root[e], 0.3);
        if (!doTick) continue;
        if (kind === ZK.dashHit) {
          damageEnemy(ctx, e, Z.dmg[i], fill(ctx, i, E.x[e] - P.x, E.z[e] - P.z, true));
        } else {
          damageEnemy(ctx, e, Z.dmg[i], fill(ctx, i, E.x[e] - Z.x[i], E.z[e] - Z.z[i], true));
        }
      }
      if (doTick && kind !== ZK.hostileSlam) {
        const fromP = kind === ZK.dashHit;
        eachBodyIn(ctx, Z.x[i], Z.z[i], Z.radius[i], (b) => effectOnBody(ctx, b, Z.move[i], Z.dmg[i], Z.element[i], ctx.bodies.x[b] - (fromP ? P.x : Z.x[i]), ctx.bodies.z[b] - (fromP ? P.z : Z.z[i]), Z.pushP[i], Z.holdP[i]));
        // Phase 8a: a pushing or holding zone (a dash, a whirlpool, a Fire Spin) meets enemy shots inside it
        if (Z.pushP[i] || Z.holdP[i]) {
          const zx = Z.x[i], zz = Z.z[i], zr = Z.radius[i];
          forceOnShots(ctx, Z.pushP[i], Z.holdP[i], ELEMENTS[Z.element[i]], TEAM.player, 'zone', Z.move[i],
            (x, z, r) => (x - zx) ** 2 + (z - zz) ** 2 <= (zr + r) ** 2,
            (x, z) => (fromP ? [x - P.x, z - P.z] : [x - zx, z - zz]));
        }
        applyAgent(ctx, agentOf(ELEMENTS[Z.element[i]]), Z.x[i], Z.z[i], Z.radius[i] * 0.7);
      }
    }
  },
};

/** true when projectile i meets a raised Bulwark shield head-on (blueprint section 9: Protect) */
export function blockedByBulwark(ctx: SimContext, i: number): boolean {
  const Pr = ctx.projectiles, E = ctx.enemies, R = ctx.rules.roles;
  for (const b of ctx.director.bulwarks) {
    if (!E.alive[b]) continue;
    const dx = Pr.x[i] - E.x[b], dz = Pr.z[i] - E.z[b];
    const reach = R.bulwarkRadius * E.size[b];
    const d2 = dx * dx + dz * dz;
    if (d2 > reach * reach || d2 < 1e-6) continue;
    const d = Math.sqrt(d2);
    // in front of it, and flying toward it
    if ((dx * dsin(E.facing[b]) + dz * dcos(E.facing[b])) / d < R.bulwarkArc) continue;
    if (Pr.vx[i] * dx + Pr.vz[i] * dz >= 0) continue;
    if (ctx.tick % 4 === 0) ctx.events.push({ t: 'block', x: E.x[b] + (dx / d) * 1.2, z: E.z[b] + (dz / d) * 1.2, enemy: b });
    return true;
  }
  return false;
}
