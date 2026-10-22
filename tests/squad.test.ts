// Squad and Tag (blueprint section 6, Phase 6).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRun, step } from '../src/sim/run';
import { addMember, maybeOfferRecruit, onHpLoss, tagDefOf, tagSpec } from '../src/sim/squad';
import { damagePlayer } from '../src/sim/combat';
import { gainXp, lineage } from '../src/sim/progression';
import { MOVE_BY_KEY } from '../src/rules/moves';
import { SPECIES } from '../src/rules/species';
import { STAGES } from '../src/rules/stages';
import { TAG_ACTIONS } from '../src/rules/tags';
import { BTN, NO_INPUT, type InputFrame, type SimContext } from '../src/sim/types';

function calm(species = 'totodile'): SimContext {
  const ctx = createRun({ seed: 5, species, ruleOverrides: { director: { spawnBase: -99, spawnPerMin: 0, spawnPerStage: 0 }, bodies: { looseRocks: 0 } } as never });
  for (let i = 0; i < 6; i++) step(ctx, NO_INPUT);
  return ctx;
}
const press = (btn: number): InputFrame => ({ ...NO_INPUT, btn });
const secs = (ctx: SimContext, s: number, inp: InputFrame = NO_INPUT) => { for (let i = 0; i < Math.round(s * 60); i++) step(ctx, inp); };
/** tap Tag: one tick down, then up */
function tap(ctx: SimContext) { step(ctx, press(BTN.sig)); step(ctx, NO_INPUT); }

test('every partner and recruitable wild line has a Tag Action whose moves exist', () => {
  const recruitable = new Set(STAGES.flatMap((s) => s.spawns.map(([id]) => id)));
  for (const sp of SPECIES) {
    const base = lineage(sp)[0].id;
    if (!sp.playable && !recruitable.has(base)) continue;
    const line = TAG_ACTIONS[base];
    assert.ok(line, `${sp.id} has a Tag Action`);
    assert.ok(MOVE_BY_KEY[line.base.move], `${base} base ${line.base.move}`);
    assert.ok(MOVE_BY_KEY[line.variant.move], `${base} variant ${line.variant.move}`);
  }
});

test('a tap tags in the reserve, fires its Tag Action, and starts the 4 s cooldown', () => {
  const ctx = calm();
  addMember(ctx, 'mareep');
  const P = ctx.player;
  assert.equal(P.squad.length, 2);
  const x = P.x, z = P.z;
  tap(ctx);
  assert.equal(P.active, 1);
  assert.equal(P.species.id, 'mareep');
  assert.ok(Math.abs(P.x - x) < 0.5 && Math.abs(P.z - z) < 0.5, 'arrives where the other stood');
  assert.ok(P.tagCd > 3.9);
  let fired = false;
  for (let i = 0; i < 30 && !fired; i++) fired = step(ctx, NO_INPUT).some((e) => e.t === 'tagAction');
  assert.ok(fired, 'the Tag Action released');
  tap(ctx);
  assert.equal(P.active, 1, 'cooldown blocks a second tag');
  secs(ctx, 4.1);
  tap(ctx);
  assert.equal(P.active, 0, 'tap swaps back to the last Pokémon');
});

test('holding Tag and pressing Move B picks the second reserve, without casting Move B', () => {
  const ctx = calm();
  addMember(ctx, 'mareep'); addMember(ctx, 'geodude');
  const P = ctx.player;
  secs(ctx, 0.3, press(BTN.sig));
  step(ctx, press(BTN.sig | BTN.b));
  assert.equal(P.species.id, 'geodude');
  secs(ctx, 0.2, press(BTN.sig));
  step(ctx, NO_INPUT);
  assert.equal(P.species.id, 'geodude', 'releasing after a pick does not tag again');
});

test('benched Pokémon refill grey health; on the field it drains away', () => {
  const ctx = calm();
  addMember(ctx, 'mareep');
  const P = ctx.player;
  P.iframes = 0;
  damagePlayer(ctx, 60, P.x + 1, P.z);
  const m = P.m;
  assert.ok(m.grey > 0, 'part of the hit is grey');
  const hpHit = m.hp, grey = m.grey;
  tap(ctx);
  secs(ctx, 3);
  assert.ok(m.hp > hpHit + grey * 0.5, 'resting recovered most of the grey health');
  // on the field, grey drains instead
  const m2 = P.m;
  P.iframes = 0;
  damagePlayer(ctx, 60, P.x + 1, P.z);
  const g2 = m2.grey;
  secs(ctx, 8);
  assert.ok(m2.grey < g2 * 0.2, 'grey mostly gone after 8 s on the field');
});

test('a faint brings in the next Pokémon; the run ends only when all have fainted', () => {
  const ctx = calm();
  addMember(ctx, 'geodude');
  const P = ctx.player;
  P.m.hp = 1; P.iframes = 0;
  damagePlayer(ctx, 500, P.x + 1, P.z);
  assert.equal(ctx.state, 'play');
  assert.ok(P.squad[0].fainted);
  secs(ctx, 1.2);
  assert.equal(P.species.id, 'geodude');
  assert.ok(P.tagCd <= 0, 'the replacement tag is free');
  P.m.hp = 1; P.iframes = 0;
  damagePlayer(ctx, 500, P.x + 1, P.z);
  assert.equal(ctx.state, 'dead');
});

test('without objectives (v8 pacing), recruits are offered after an elite once enough time has passed, and join at squad level', () => {
  const ctx = calm();
  ctx.rules.objectives.enabled = false;
  maybeOfferRecruit(ctx);
  assert.equal(ctx.recruit.pending, null, 'not in the first two minutes');
  ctx.time = 130;
  maybeOfferRecruit(ctx);
  const pending = ctx.recruit.pending as string[] | null;
  assert.ok(pending && pending.length === 2);
  step(ctx, NO_INPUT);
  assert.equal(ctx.cards.source, 'recruit');
  step(ctx, { ...NO_INPUT, card: { action: 'pick', index: 0 } });
  assert.equal(ctx.player.squad.length, 2);
  const m = ctx.player.squad[1];
  assert.ok(m.moves.length >= 1, 'it arrives with a move');
  assert.ok(m.maxHp > 0 && m.hp === m.maxHp);
});

test('the first evolution offers the Tag variant', () => {
  const ctx = calm('cyndaquil');
  const P = ctx.player;
  while (P.level < 15) gainXp(ctx, P.xpNext - P.xp + 0.01);
  for (let i = 0; i < 400 && P.species.id === 'cyndaquil'; i++) step(ctx, { ...NO_INPUT, card: ctx.cards.source === 'level' && ctx.cards.offer ? { action: 'pick', index: 0 } : undefined });
  assert.equal(P.species.id, 'quilava');
  for (let i = 0; i < 400 && ctx.cards.source !== 'tag'; i++) step(ctx, { ...NO_INPUT, card: ctx.cards.offer ? { action: 'pick', index: 0 } : undefined });
  assert.equal(ctx.cards.source, 'tag');
  step(ctx, { ...NO_INPUT, card: { action: 'pick', index: 0 } });
  assert.equal(P.m.tagVariant, 1);
  assert.equal(tagDefOf(P.m)!.move, 'lava_plume');
  assert.ok(tagSpec(ctx, P.m)!.dmg > 0);
});

test('grey health never exceeds the missing health', () => {
  const ctx = calm();
  const P = ctx.player;
  P.m.hp = P.m.maxHp - 5;
  onHpLoss(ctx, 100);
  assert.ok(P.m.grey <= 5 + 1e-9);
});

// ------------------------------------------------------------------ the field Pokémon's own type and ability
/** a hit of `element` on a fresh, unguarded field Pokémon: HP lost */
function hitWith(species: string, element: Parameters<typeof damagePlayer>[6], raw = 40) {
  const ctx = calm(species);
  const P = ctx.player;
  P.iframes = 0; P.dashT = 0;
  const before = P.hp;
  const res = damagePlayer(ctx, raw, P.x + 1, P.z, 1, 1, element);
  return { ctx, lost: before - P.hp, res };
}

test('hits on your Pokémon use the type chart, softened (weak x1.41, resist x0.71)', () => {
  const neutral = hitWith('chikorita', 'plain').lost;
  const weak = hitWith('chikorita', 'blaze').lost; // Grass is weak to Fire
  const resist = hitWith('chikorita', 'tide').lost; // Grass resists Water
  assert.ok(Math.abs(weak / neutral - Math.SQRT2) < 0.01, `weak ${weak / neutral}`);
  assert.ok(Math.abs(resist / neutral - Math.SQRT1_2) < 0.01, `resist ${resist / neutral}`);
  // no element (a legacy call) stays neutral
  assert.equal(hitWith('chikorita', undefined).lost, neutral);
});

test('Water Absorb heals from Water hits; Levitate ignores Ground; Flash Fire arms on Fire', () => {
  const p = hitWith('poliwag', 'tide');
  assert.equal(p.res, 'none');
  assert.ok(p.lost <= 0, 'Poliwag is not hurt by Water');
  const g = hitWith('gastly', 'quake');
  assert.equal(g.res, 'none'); assert.equal(g.lost, 0);
  const v = hitWith('vulpix', 'blaze');
  assert.equal(v.res, 'none'); assert.equal(v.lost, 0);
  assert.ok(v.ctx.player.m.flashT > 0, 'Flash Fire is armed');
});

test('Sturdy survives one lethal hit from full health per region', () => {
  const ctx = calm('geodude');
  const P = ctx.player;
  P.iframes = 0;
  damagePlayer(ctx, 99999, P.x + 1, P.z, 1, 1, 'plain');
  assert.equal(Math.round(P.hp), 1);
  assert.ok(P.m.sturdyUsed);
  assert.equal(ctx.state, 'play');
});
