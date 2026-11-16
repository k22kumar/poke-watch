// Player controller. Gravity 30 m/s² [C]; flyers holding jump clamp fall speed to 2 m/s [C];
// a move is blocked when the ground just ahead is more than 0.6 m above the feet [C].

import { datan2, dcos, dexp, dhypot, dsin } from '../core/detmath';
import { clamp } from '../core/util';
import { BTN, type SimContext } from './types';
import { footing } from './cells';
import { TB } from '../rules/build';
import { logTech } from './techniques';
import { liquidMotion, playerLiquid } from './hazards';
import { navWide, partnerFootprint } from '../rules/sizing';

const MOVE: [number, number] = [0, 0];

/** release Guard; a tap that caught nothing costs a short lockout */
export function endGuard(ctx: SimContext) {
  const P = ctx.player;
  if (P.guardT < 0) return;
  if (!P.guardHit && P.guardT <= ctx.rules.combat.guardWindow + 0.05) P.guardLock = ctx.rules.combat.whiffLock;
  P.guardT = -1;
}

/** the deflect / parry window is open */
export const deflecting = (ctx: SimContext) => ctx.player.guardT >= 0 && ctx.player.guardT <= ctx.rules.combat.guardWindow;
/** holding Guard past the window */
export const bracing = (ctx: SimContext) => ctx.player.guardT > ctx.rules.combat.guardWindow;

/** Slipstream: the first coated enemy within reach of the dashing trainer lends its coat to the next Move */
function slipCopy(ctx: SimContext) {
  const P = ctx.player, E = ctx.enemies, r = ctx.rules.build.tech.slipstream.reach;
  const n = ctx.grid.query(P.x, P.z, r + 1);
  let best = -1;
  for (let k = 0; k < n; k++) {
    const e = ctx.grid.result[k];
    if (!E.alive[e] || !E.coat[e] || (best >= 0 && e > best)) continue;
    const dx = E.x[e] - P.x, dz = E.z[e] - P.z, rr = r + E.radius[e];
    if (dx * dx + dz * dz <= rr * rr) best = e;
  }
  if (best < 0) return;
  P.slipAg = E.coat[best];
  logTech(ctx, 'slipstream', ['', 'Heat', 'Wet', 'Cold', 'Charge'][P.slipAg] + ' copied', P.x, P.z);
}

export const playerSystem = {
  name: 'player',
  update(ctx: SimContext, dt: number) {
    const P = ctx.player;
    const R = ctx.rules.player;
    const W = ctx.world;
    const inp = ctx.input;
    P.px = P.x; P.py = P.y; P.pz = P.z;
    // Phase 8b: things held last tick (Lodestone roots you while you hold), Pressure Jet's root
    P.holding = P.holdNext; P.holdNext = 0;
    if (P.rootT > 0) P.rootT -= dt;
    const tm = P.techMask, BT = ctx.rules.build.tech;
    const rooted = P.rootT > 0 || (tm & TB.lodestone && P.holding > 0);

    let mx = inp.mx, mz = inp.mz;
    const ml = dhypot(mx, mz);
    if (ml > 1) { mx /= ml; mz /= ml; }
    P.moving = ml > 0.05;

    // a liquid underfoot (hazards on): an exposed Pokémon wades slowly and cannot jump out; a safe swimmer keeps pace
    const liquid = playerLiquid(ctx);
    const [swim, canJump] = W.hazards ? liquidMotion(ctx, liquid) : [W.waterAt(P.x, P.z) > P.y + 0.3 ? 0.8 : 1, true];
    const speed = P.derived.speed * (P.buffT > 0 ? 1 + P.buffSpe : 1) * swim * (P.paraT > 0 ? 0.5 : 1) * (P.carrying ? ctx.rules.objectives.transport.carrySpeed : 1)
      * (tm & TB.heavy ? BT.heavyFooting.speed : 1) * (rooted ? 0 : 1);

    // Reflex: two charges shared by Dash and Guard
    const C = ctx.rules.combat;
    if (P.reflex < C.reflexCharges) P.reflex = Math.min(C.reflexCharges, P.reflex + dt / C.reflexRecharge);
    if (P.guardLock > 0) P.guardLock -= dt;
    const btn = inp.btn ?? 0;
    const guardDown = (btn & BTN.guard) !== 0;
    const guardPressed = guardDown && !(P.btnPrev & BTN.guard);
    P.btnPrev = btn;

    if (P.guardT >= 0) {
      // holding Guard: deflect window first, then Brace (drains a charge every few seconds)
      P.guardT += dt;
      // Riposte: no Brace, Guard ends when the deflect window closes
      if (!guardDown || (tm & TB.riposte && P.guardT > C.guardWindow)) endGuard(ctx);
      else if (P.guardT > C.guardWindow) {
        P.braceAcc += dt;
        if (P.braceAcc >= C.braceDrainEvery) {
          P.braceAcc = 0;
          if (P.reflex >= 1) P.reflex -= 1; else endGuard(ctx);
        }
      }
    } else if (guardPressed && P.dashT <= 0 && P.guardLock <= 0 && P.reflex >= 1) {
      P.reflex -= 1;
      P.guardT = 0; P.guardHit = false; P.braceAcc = 0;
      ctx.events.push({ t: 'guard', x: P.x, z: P.z });
    }

    if (P.dashT > 0) {
      P.dashT -= dt;
      P.vx = P.dashDx * R.dashSpeed;
      P.vz = P.dashDz * R.dashSpeed;
      // Slipstream: dashing through a coated enemy copies its coat onto the next Move A or B
      if (tm & TB.slipstream && P.reflexDash && !P.slipAg) slipCopy(ctx);
    } else {
      const dashCost = tm & TB.slipstream ? BT.slipstream.dashCost : 1;
      if (inp.dash && P.guardT < 0 && P.guardLock <= 0 && P.reflex >= dashCost) {
        const dx = P.moving ? mx : dsin(P.facing), dz = P.moving ? mz : dcos(P.facing);
        const L = dhypot(dx, dz) || 1;
        const dashTime = R.dashTime * (tm & TB.heavy ? BT.heavyFooting.dash : 1);
        P.dashDx = dx / L; P.dashDz = dz / L;
        P.dashT = dashTime; P.reflex -= dashCost; P.reflexDash = true;
        P.iframes = Math.max(P.iframes, dashTime + 0.08);
        ctx.events.push({ t: 'dash' });
      }
      const brace = P.guardT > C.guardWindow ? C.braceSpeed : 1;
      // ice is slippery (low grip), rubble is slow
      const [footSpeed, grip] = P.grounded ? footing(ctx, P.x, P.z, P.species.elements) : [1, 1];
      const accel = Math.min(1, (P.grounded ? 16 * grip : 7) * dt) ;
      mx *= footSpeed; mz *= footSpeed;
      P.vx += (mx * speed * brace - P.vx) * accel;
      P.vz += (mz * speed * brace - P.vz) * accel;
    }
    const kd = dexp(-8 * dt);
    P.kx *= kd; P.kz *= kd;

    // horizontal move with terrain step rule, axis-separated sliding. Only solid geometry stops it (World.collides):
    // open liquid and open air are entered, by walking or by being knocked
    const stepX = (P.vx + P.kx) * dt, stepZ = (P.vz + P.kz) * dt;
    const feet = P.y;
    const stepUp = liquid ? Math.max(R.stepHeight, ctx.rules.hazards.climbOut) : R.stepHeight; // climbing out of a liquid
    const blocked = (x: number, z: number) => W.collides(x, z, feet, stepUp);
    let nx = P.x + stepX, nz = P.z + stepZ;
    const foot = partnerFootprint(P.species, ctx.rules);
    if (foot > 0) {
      // size geometry on: the partner's footprint against walls and faces (World.moveBody, docs/SIZING.md "Footprint"):
      // it glides round corners, never cuts one, and a Large or Extra Large partner does not fit a one-tile gap
      W.moveBody(P.x, P.z, stepX, stepZ, feet, stepUp, foot, MOVE);
      nx = MOVE[0]; nz = MOVE[1];
    } else {
      const ahead = 0.35;
      const ax = Math.sign(stepX) * ahead, az = Math.sign(stepZ) * ahead;
      if (blocked(nx + ax, nz + az)) {
        if (!blocked(nx + ax, P.z)) nz = P.z;
        else if (!blocked(P.x, nz + az)) nx = P.x;
        else { nx = P.x; nz = P.z; }
      }
      // location maps: the look-ahead test can pass on a diagonal while the landing point itself is a wall (corner
      // cutting); beside a chasm that would drop the player into it, so test where the step actually lands too
      if (W.los && blocked(nx, nz)) {
        if (!blocked(nx, P.z)) nz = P.z;
        else if (!blocked(P.x, nz)) nx = P.x;
        else { nx = P.x; nz = P.z; }
      }
    }
    const b = W.bound;
    P.x = clamp(nx, -b, b);
    P.z = clamp(nz, -b, b);

    // vertical
    if (inp.jump && P.grounded && canJump) {
      P.vy = R.jumpVelocity;
      P.grounded = false;
      ctx.events.push({ t: 'jump' });
    }
    P.vy -= R.gravity * dt;
    if (P.species.flying && inp.jump && P.vy < -R.glideFallSpeed) P.vy = -R.glideFallSpeed;
    P.y += P.vy * dt;
    // the supporting surface: -Infinity over open air (a chasm), so gravity takes over where support ends
    const g = W.support(P.x, P.z, P.y);
    if (P.y <= g) {
      // landing from a fall or a drop: clear the footprint of the ground it landed on (faces were measured from the feet
      // on the way down, so it may stand in the lip; World.moveBody's push)
      if (foot > 0 && !P.grounded && P.py - g > 0.3) { W.moveBody(P.x, P.z, 0, 0, g, R.stepHeight, foot, MOVE); P.x = MOVE[0]; P.z = MOVE[1]; }
      P.y = g;
      P.vy = 0;
      P.grounded = true;
    } else if (P.grounded && P.y - g < 0.35 && P.vy <= 0) {
      P.y = g; P.vy = 0; // stick to slopes going down
    } else {
      P.grounded = false;
    }

    // location maps: never left inside rock (a shove or knockback through a corner): back to footing. A chasm is not
    // rock (hazards on: World.wallAt is false there), so a real fall is never pulled back to the lip.
    // (a walker standing on a deck is above the ground's wall: on location maps nothing solid ever sits under a deck, so
    // this only matters where a habitat causeway spans sealed ground)
    if (W.los && W.wallAt(P.x, P.z) && !(W.over && W.node(P.x, P.z, P.y) >= W.w * W.h)) {
      [P.x, P.z] = foot > 0 ? W.nearestFit(P.x, P.z, foot, navWide(foot, ctx.rules)) : W.nearestWalkable(P.x, P.z);
      P.y = W.height(P.x, P.z, P.y); P.vy = 0; P.grounded = true;
    }

    if (P.aimT > 0) P.aimT -= dt;
    if ((P.moving || P.aimT > 0) && P.dashT <= 0) {
      const target = P.aimT > 0 ? P.aimFacing : datan2(mx, mz);
      let d = target - P.facing;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      P.facing += d * Math.min(1, (P.aimT > 0 ? 22 : 14) * dt);
    }
    P.animT += (P.moving ? dhypot(P.vx, P.vz) : 0.8) * dt;
    if (P.iframes > 0) P.iframes -= dt;
    if (P.hurtFlash > 0) P.hurtFlash -= dt;
    if (!P.m.fainted && P.hp < P.maxHp) P.hp = Math.min(P.maxHp, P.hp + R.regenPerSec * dt);
  },
};
