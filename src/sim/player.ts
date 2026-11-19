// Player controller: Reflex, Guard and Dash, the player's speed rules, facing and regen. Body motion (gravity 30 m/s² [C],
// flyers holding jump clamp fall speed to 2 m/s [C], the 0.6 m step rule [C]) and the Jump control (R6c: press edges,
// buffer, coyote time, the airborne press) are the shared step in sim/locomotion.ts.

import { datan2, dcos, dhypot, dsin } from '../core/detmath';
import { BTN, type SimContext } from './types';
import { footing } from './cells';
import { TB } from '../rules/build';
import { logTech } from './techniques';
import { liquidMotion, playerLiquid } from './hazards';
import { navWide, partnerFootprint, partnerHeight } from '../rules/sizing';
import { traversalOf } from '../rules/profiles';
import { LOCO, mediumAt, selectIntegrator, stepBallistic, stepScripted, stepSupported, type LocoIntent, type LocoResult, type LocoTick } from './locomotion';

// per-tick scratch for the shared locomotion step (no allocation)
const INTENT: LocoIntent = { mx: 0, mz: 0, jump: false, jumpPressed: undefined, my: undefined };
const TICK: LocoTick = { speed: 0, stance: 1, footSpeed: 1, grip: 1, canJump: true, lift: false, airPress: 'none', stepUp: 0, foot: 0, tall: undefined, wide: false };
const STEP: LocoResult = { jumped: false };

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
    P.px = P.x; P.py = P.y; P.pz = P.z; P.pgrounded = P.grounded;
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

    // locomotion (sim/locomotion.ts): the integrator follows from the body's state at the start of the tick; the dash
    // (and dash-shaped moves) is the scripted case. Player-only rules (Dash, Brace, footing, liquids, buffs) become the
    // tick's numbers here; the body step itself is shared
    const integ = selectIntegrator(P.dashT > 0, P.grounded);
    const it = INTENT, t = TICK;
    // R6c: the Jump edge (absent = the legacy held rule) and the vertical intent (read by no integrator before R6d)
    it.mx = mx; it.mz = mz; it.jump = inp.jump; it.jumpPressed = inp.jumpPressed; it.my = inp.my;
    // climbing out of a liquid
    t.stepUp = liquid ? Math.max(R.stepHeight, ctx.rules.hazards.climbOut) : R.stepHeight;
    // headroom (rules.size.headroom, docs/SIZING.md "Headroom"): the body's height meets deck slabs, so a partner taller
    // than the gap under a deck does not walk (or jump) in under it. Undefined = heads pass through slabs, as before
    t.tall = W.headroom && W.over ? partnerHeight(P.species, ctx.rules) : undefined;
    t.foot = partnerFootprint(P.species, ctx.rules);
    t.wide = navWide(t.foot, ctx.rules);
    t.canJump = canJump;
    const tr = traversalOf(P.species, ctx.rules);
    t.lift = tr.glide !== null; // the glide row (rules/traversal.ts)
    t.airPress = tr.airPress; // what an airborne Jump press means (none for every shipped template)
    t.speed = speed;
    if (integ === LOCO.scripted) {
      P.dashT -= dt;
      // Slipstream: dashing through a coated enemy copies its coat onto the next Move A or B
      if (tm & TB.slipstream && P.reflexDash && !P.slipAg) slipCopy(ctx);
      stepScripted(W, P, it, P.dashDx, P.dashDz, R.dashSpeed, t, R, dt, STEP);
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
      t.stance = P.guardT > C.guardWindow ? C.braceSpeed : 1;
      if (integ === LOCO.supported) {
        // ice is slippery (low grip), rubble is slow
        [t.footSpeed, t.grip] = footing(ctx, P.x, P.z, P.species.elements);
        stepSupported(W, P, it, t, R, dt, STEP);
      } else { t.footSpeed = 1; t.grip = 1; stepBallistic(W, P, it, t, R, dt, STEP); }
      mx = it.mx; mz = it.mz; // the wish the body was driven by (footing scales it): facing turns toward it
    }
    if (STEP.jumped) ctx.events.push({ t: 'jump' });
    P.loco.integrator = selectIntegrator(P.dashT > 0, P.grounded);
    P.loco.medium = mediumAt(W, P, ctx.rules.hazards.contact);

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
