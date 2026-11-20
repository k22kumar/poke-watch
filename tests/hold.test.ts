// Hold (src/sim/modes/hold.ts, docs/hero-shooter-pivot.md Q14): the point's charge, the Raid party's drain and the
// lapse. Kept from the deleted Phase 7 suite (tests/phase7.test.ts, the survivor roles and the beat director).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRun, step } from '../src/sim/run';
import { damageEnemy, type DamageSpec } from '../src/sim/combat';
import { startObjective } from '../src/sim/objectives';
import { ROLE } from '../src/sim/pools';
import { BTN, NO_INPUT, type InputFrame, type SimContext } from '../src/sim/types';

function calm(species = 'totodile', seed = 3): SimContext {
  const ctx = createRun({ seed, species, ruleOverrides: { bodies: { looseRocks: 0 } } as never });
  for (let i = 0; i < 6; i++) step(ctx, NO_INPUT);
  return ctx;
}
const secs = (ctx: SimContext, s: number, inp: InputFrame = NO_INPUT) => { for (let i = 0; i < Math.round(s * 60); i++) step(ctx, inp); };
const hit = (element: DamageSpec['element'], cls: DamageSpec['cls'] = 'special'): DamageSpec => ({ element, cls, ailment: 'knock', chance: 0, knock: 0, kx: 0, kz: 0, drain: 0, source: 'test' });
const teleport = (ctx: SimContext, x: number, z: number) => { const P = ctx.player; P.x = P.px = x; P.z = P.pz = z; P.y = P.py = ctx.world.height(x, z); };

test('Hold: standing on the pad for 30 s completes it', () => {
  const ctx = calm();
  assert.ok(startObjective(ctx, 'hold'));
  const O = ctx.objective!;
  teleport(ctx, O.x, O.z);
  secs(ctx, 0.5);
  assert.equal(O.phase, 'active');
  // Raiders arrive with it; on the pad they drain it faster than you charge it
  const E = ctx.enemies;
  const raiders = () => { const out: number[] = []; for (let e = 0; e < E.hi; e++) if (E.alive[e] && E.roles[e] & ROLE.raider) out.push(e); return out; };
  assert.ok(raiders().length >= 3, 'a raid party');
  for (const e of raiders()) { E.x[e] = O.x + 0.5; E.z[e] = O.z; E.speed[e] = 0; }
  const c0 = O.charge;
  secs(ctx, 2);
  assert.ok(O.charge <= c0, 'four Raiders out-drain one defender');
  for (const e of raiders()) damageEnemy(ctx, e, 1e9, hit('plain'));
  teleport(ctx, O.x, O.z);
  secs(ctx, 31, { ...NO_INPUT, btn: BTN.basic }); // defend the pad with the basic attack
  assert.equal(O.phase, 'done');
});

test('an ignored Hold lapses after rules.objectives.offerTime', () => {
  const ctx = calm('totodile', 4);
  assert.ok(startObjective(ctx, 'hold'));
  teleport(ctx, ctx.objective!.x + 30, ctx.objective!.z); // far away
  let expired = false;
  for (let k = 0; k < (ctx.rules.objectives.offerTime + 2) * 60; k++) for (const ev of step(ctx, NO_INPUT)) if (ev.t === 'objective' && ev.phase === 'expired') expired = true;
  assert.ok(expired);
});
