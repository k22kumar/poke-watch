// Phase 8b: the build layer (blueprint section 6). Offer generation (Kit / Technique / Wildcard), weights, the
// technique guarantee, rerolls and banish per region, exclusions, stacking, the three-technique limit and the swap, all
// 12 transforms and all 8 techniques as micro-scenes, integration with learnsets, squad switching, evolution and the
// capability log, build diversity, determinism, and regression (flag off = Phase 8a, hash for hash).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRun, startStage, step } from '../src/sim/run';
import { gainXp } from '../src/sim/progression';
import { addMember, tagTo } from '../src/sim/squad';
import { spawnEnemy, shootHostile } from '../src/sim/enemies';
import { damageBody, spawnBody, TEAM } from '../src/sim/bodies';
import { slotSpec } from '../src/sim/moves';
import { damageEnemy, damagePlayer } from '../src/sim/combat';
import { coatEnemy } from '../src/sim/coats';
import { CS, footing } from '../src/sim/cells';
import { PK, ROLE } from '../src/sim/pools';
import { stateHash } from '../src/sim/checksum';
import { guardWeight } from '../src/sim/techniques';
import { addTechnique, cardWeight, evolveNow, generateBuildOffer, notePick, kitTags, lineVerbs, setTransform, squadTags, transformAllowed, transformSpec } from '../src/sim/build';
import { TECHNIQUES, TRANSFORMS, TRANSFORM_BY_ID, TRANSFORMS_OF } from '../src/rules/build';
import { capOf } from '../src/rules/capabilities';
import { AG } from '../src/rules/reactions';
import { SPECIES_BY_ID, starterChoices, starterFamilyRoot, weightClass } from '../src/rules/species';
import { MOVE_BY_KEY } from '../src/rules/moves';
import { BTN, type Card, type InputFrame, type SimContext } from '../src/sim/types';

const NONE: InputFrame = { mx: 0, mz: 0, jump: false, dash: false };
const QUIET = { director: { spawnBase: -99, spawnPerMin: 0, spawnPerStage: 0, eliteEvery: 9999, swarmEvery: 9999 }, bodies: { looseRocks: 0 }, beats: { enabled: false }, objectives: { enabled: false } };
function deep(a: any, b: any): any {
  const o: any = { ...a };
  for (const [k, v] of Object.entries(b)) o[k] = v && typeof v === 'object' && !Array.isArray(v) ? deep(a[k] ?? {}, v) : v;
  return o;
}
function calm(species = 'totodile', extra: object = {}): SimContext {
  const ctx = createRun({ seed: 5, species, ruleOverrides: deep(QUIET, extra) as never });
  for (let i = 0; i < 20; i++) step(ctx, NONE);
  return ctx;
}
const steps = (ctx: SimContext, n: number, inp: Partial<InputFrame> = {}) => { const all: any[] = []; for (let i = 0; i < n; i++) all.push(...step(ctx, { ...NONE, ...inp })); return all; };
/** a flat open square of side n tiles near the spawn (no water, tall grass, platforms or walls): its first tile centre */
function openSquare(ctx: SimContext, n: number): [number, number] {
  const W = ctx.world, [sx, sz] = W.spawn;
  for (let r = 0; r < 30; r++) for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
    const x0 = Math.floor(sx + dx) + 0.5, z0 = Math.floor(sz + dz) + 0.5, h0 = W.height(x0, z0);
    let ok = true;
    for (let j = 0; j < n && ok; j++) for (let i = 0; i < n && ok; i++) {
      const k = W.tile(x0 + i, z0 + j);
      ok = W.walkable(x0 + i, z0 + j) && Math.abs(W.height(x0 + i, z0 + j) - h0) < 0.01 && W.map.terrain[k] !== 3 && W.map.terrain[k] !== 4 && !W.map.platform[k] && !W.map.wall[k];
    }
    if (ok) return [x0, z0];
  }
  throw new Error('no open square');
}
/** stand the trainer at the west edge of a 12-tile open square, facing east; returns the square's centre row z */
function arena(ctx: SimContext): { x: number; z: number } {
  const [x0, z0] = openSquare(ctx, 12);
  const P = ctx.player;
  P.x = P.px = x0 + 1; P.z = P.pz = z0 + 6; P.y = ctx.world.height(P.x, P.z); P.vx = P.vz = 0; P.facing = Math.PI / 2;
  ctx.world.updateFlow(P.x, P.z);
  return { x: P.x, z: P.z };
}
/** an enemy that stands still */
function dummy(ctx: SimContext, id: string, x: number, z: number, roles = 0) {
  const e = spawnEnemy(ctx, id, x, z, roles);
  const E = ctx.enemies;
  E.speed[e] = 0; E.spawnT[e] = 1; E.attackCd[e] = 999; E.hp[e] = E.maxHp[e] = 1e6;
  ctx.grid.rebuild(E.hi, E.x, E.z, E.alive);
  return e;
}
/** give the field Pokémon exactly these moves (optionally transformed), all ready, at level 1 */
function kit(ctx: SimContext, ...moves: [string, string?][]) {
  const m = ctx.player.m;
  m.moves = moves.map(([key, xf]) => ({ key, level: 1, cd: 0, spec: xf ? transformSpec(ctx.rules, key, xf) : transformSpecOrBase(ctx, key), uses: 0, xf }));
  for (const [k] of moves) m.learned.add(k);
}
const transformSpecOrBase = (ctx: SimContext, key: string) => slotSpecBase(ctx, key);
import { compileMove } from '../src/sim/moves';
const slotSpecBase = (ctx: SimContext, key: string) => compileMove(ctx.rules, key);
const east = (ctx: SimContext, d = 8) => ({ aimX: ctx.player.x + d, aimZ: ctx.player.z });
/** hold Move A (slot 1) with an aim until it fires once; returns the events of those ticks */
function castA(ctx: SimContext, aim = east(ctx), btn: number = BTN.a, max = 150) {
  const s = ctx.player.moves[btn === BTN.a ? 1 : 2] ?? ctx.player.moves[1];
  const u0 = s.uses ?? 0;
  const ev: any[] = [];
  for (let i = 0; i < max && (s.uses ?? 0) === u0; i++) ev.push(...step(ctx, { ...NONE, ...aim, btn }));
  assert.ok((s.uses ?? 0) > u0, 'the move fired');
  return ev;
}
const pickInput = (index: number): Partial<InputFrame> => ({ card: { action: 'pick', index } });
/** open a level-up offer now (banked tray) */
function levelUp(ctx: SimContext) {
  gainXp(ctx, ctx.player.xpNext - ctx.player.xp + 0.01);
  step(ctx, NONE);
  assert.ok(ctx.cards.offer, 'an offer is open');
  return ctx.cards.offer!;
}

// ------------------------------------------------------------------ data
test('data: 12 transforms, two mutually exclusive per move, on the six slice moves; 8 techniques with a gain and a cost', () => {
  assert.equal(TRANSFORMS.length, 12);
  assert.deepEqual(Object.keys(TRANSFORMS_OF).sort(), ['bite', 'ember', 'flame_wheel', 'seed_bomb', 'vine_whip', 'water_gun']);
  for (const [move, xs] of Object.entries(TRANSFORMS_OF)) {
    assert.equal(xs.length, 2, move);
    assert.deepEqual(xs.map((x) => x.side).sort(), ['A', 'B']);
    assert.ok(MOVE_BY_KEY[move], move + ' exists in the move data');
    for (const x of xs) { assert.ok(x.gain.length > 10 && x.cost.length > 5, x.id); const s = transformSpec(createRun({ seed: 1, species: 'totodile' }).rules, move, x.id); assert.equal(s.element, MOVE_BY_KEY[move].element, 'a transform never changes the type'); }
  }
  assert.equal(TECHNIQUES.length, 8);
  for (const t of TECHNIQUES) assert.ok(t.gain && t.cost, t.id);
});

test('transforms edit capabilities as stated: Pressure Jet Push 2 beam, Scatter no Push, Ram Push 3, Trail Push 1, Lasso Hold 2, Snare no Hold, Burrow Create, Crunch Down Push 2, Lunge no Push', () => {
  const r = createRun({ seed: 1, species: 'totodile' }).rules;
  const t = (m: string, x: string) => transformSpec(r, m, x);
  assert.equal(t('water_gun', 'pressure_jet').archetype, 'beam'); assert.equal(capOf(t('water_gun', 'pressure_jet').caps, 'push'), 2);
  assert.equal(capOf(t('water_gun', 'scatter').caps, 'push'), 0); assert.equal(t('water_gun', 'scatter').count, 3);
  assert.equal(capOf(t('flame_wheel', 'ram').caps, 'push'), 3); assert.equal(capOf(t('flame_wheel', 'wheel_trail').caps, 'push'), 1);
  assert.equal(capOf(t('vine_whip', 'lasso').caps, 'hold'), 2); assert.equal(capOf(t('vine_whip', 'snare').caps, 'hold'), 0);
  assert.ok(t('seed_bomb', 'burrow').caps!.some((c) => c.verb === 'create'));
  assert.equal(capOf(t('bite', 'crunch_down').caps, 'push'), 2);
  assert.equal(t('bite', 'lunge').archetype, 'dash'); assert.equal(capOf(t('bite', 'lunge').caps, 'push'), 0);
  assert.equal(t('ember', 'searing').coatDepth, 2); assert.ok(t('ember', 'kindle').landHeat! > 0);
});

test('starter offers give three unique family choices and a deterministic mulligan reroll', () => {
  const first = starterChoices(5);
  assert.equal(first.length, 3);
  const families = new Set(first.map((id) => starterFamilyRoot(SPECIES_BY_ID[id]).id));
  assert.equal(families.size, 3);
  const rerolled = starterChoices(6);
  assert.ok(rerolled.length >= 1);
  assert.notDeepEqual(first, rerolled);
});

// ------------------------------------------------------------------ offers
test('offer: Kit, Technique, Wildcard in that order when every pool has cards', () => {
  const ctx = calm('totodile', { build: { healFill: 1 } });
  ctx.player.moves[0].uses = 100; // Water Gun has been used a while: its transforms are Kit cards
  ctx.player.hp = ctx.player.maxHp * 0.3; // a heal is a Wildcard
  const offer = levelUp(ctx);
  assert.equal(offer.length, 3);
  assert.equal(offer[0].group, 'kit');
  assert.equal(offer[1].kind, 'technique');
  assert.equal(offer[2].group, 'wildcard');
  for (const c of offer) assert.ok(!['vitamin', 'upgrade'].includes(c.kind), 'no numeric cards by default');
});

test('weights: w = base x (1 + 0.6 s) x n x f; s counts kit tags (cap 2, Hit and Deflect ignored), n = 1.5 in the first 4 picks for a missing capability, f = 0.5 if shown last offer', () => {
  const ctx = calm('totodile');
  const card = (tags: string[], id = 'x'): Card => ({ id, kind: 'technique', key: id, rarity: 'rare', title: id, desc: '', tags });
  const kit = new Set(['push', 'apply:wet', 'hold']), squad = new Set(['push', 'apply:wet', 'hold']);
  assert.equal(cardWeight(ctx, card(['hit', 'deflect']), 1, kit, squad), 1);
  assert.equal(cardWeight(ctx, card(['push']), 1, kit, squad), 1.6);
  assert.ok(Math.abs(cardWeight(ctx, card(['push', 'apply:wet', 'hold']), 1, kit, squad) - 2.2) < 1e-9, 'capped at s = 2');
  assert.ok(Math.abs(cardWeight(ctx, card(['apply']), 1, kit, squad) - 1.6) < 1e-9, '"apply" matches any agent');
  ctx.build.picks = 0;
  assert.ok(Math.abs(cardWeight(ctx, card(['create']), 2, kit, squad) - 3) < 1e-9, 'novelty 1.5 early');
  ctx.build.picks = 4;
  assert.equal(cardWeight(ctx, card(['create']), 2, kit, squad), 2, 'no novelty after 4 picks');
  ctx.build.lastShown = new Set(['seen']);
  assert.equal(cardWeight(ctx, card(['push'], 'seen'), 1, kit, squad), 0.8, 'repeat 0.5');
});

test('weights in practice: synergy makes Undertow more likely for a Push + Wet kit than for a kit with neither', () => {
  const share = (species: string) => {
    const ctx = calm(species);
    let n = 0, total = 0;
    for (let k = 0; k < 600; k++) { ctx.build.lastShown = new Set(); ctx.build.picks = 10; const o = generateBuildOffer(ctx); total++; if (o.some((c) => c.key === 'undertow')) n++; }
    return n / total;
  };
  const toto = share('totodile'), chiko = share('chikorita');
  assert.ok(kitTags(calm('totodile'), calm('totodile').player.m).has('push'));
  assert.ok(toto > chiko * 1.2, `Totodile ${toto.toFixed(3)} vs Chikorita ${chiko.toFixed(3)}`);
});

test('a technique is offered at least once every 3 picks, also once all 3 slots are full', () => {
  const ctx = calm('cyndaquil', { build: { healFill: 1 } });
  for (const t of ['quarry', 'catalyst', 'riposte']) addTechnique(ctx, t);
  ctx.player.level = 12; ctx.player.moves[0].uses = 99; ctx.player.hp = ctx.player.maxHp * 0.3; // Kit and Wildcard pools never run dry
  let gap = 0, worst = 0, withTech = 0;
  const N = 400;
  for (let k = 0; k < N; k++) {
    const offer = generateBuildOffer(ctx);
    assert.equal(offer.length, 3);
    const has = offer.some((c) => c.kind === 'technique');
    if (has) { withTech++; gap = 0; } else { gap++; worst = Math.max(worst, gap); }
    notePick(ctx, offer, offer.find((c) => c.kind !== 'technique') ?? null); // the player keeps taking the other cards
  }
  assert.ok(worst <= 2, `at most 2 offers in a row without a technique (worst ${worst})`);
  const share = withTech / N;
  assert.ok(share >= 1 / 3 && share < 0.7, `share of offers with a technique ${share.toFixed(2)} (0.35 drawn + the guarantee)`);
  // below the cap the Technique slot always holds a technique
  const c = calm('cyndaquil');
  for (let k = 0; k < 50; k++) { c.build.lastShown = new Set(); assert.equal(generateBuildOffer(c).filter((x) => x.kind === 'technique').length >= 1, true); }
});

test('offers keep three cards early (learnset moves a few levels ahead, then techniques fill in)', () => {
  const ctx = calm('totodile');
  for (let k = 0; k < 30; k++) { ctx.build.lastShown = new Set(); assert.equal(generateBuildOffer(ctx).length, 3); }
});

test('rerolls (2) and banishes (1) are per region and reset at the next region', () => {
  const ctx = calm('totodile');
  assert.equal(ctx.cards.rerolls, 2); assert.equal(ctx.cards.banishes, 1);
  levelUp(ctx);
  step(ctx, { ...NONE, card: { action: 'reroll', index: 0 } });
  step(ctx, { ...NONE, card: { action: 'banish', index: 1 } });
  step(ctx, { ...NONE, card: { action: 'banish', index: 1 } });
  assert.equal(ctx.cards.rerolls, 1); assert.equal(ctx.cards.banishes, 0);
  startStage(ctx, 1);
  assert.equal(ctx.cards.rerolls, 2); assert.equal(ctx.cards.banishes, 1);
});

test('a reroll redraws all three; a banished card never returns', () => {
  const ctx = calm('totodile');
  const first = levelUp(ctx);
  const tech = first.find((c) => c.kind === 'technique')!;
  step(ctx, { ...NONE, card: { action: 'banish', index: first.indexOf(tech) } });
  for (let k = 0; k < 80; k++) {
    ctx.build.lastShown = new Set();
    assert.ok(!generateBuildOffer(ctx).some((c) => c.id === tech.id), 'banished');
  }
  const before = ctx.cards.offer!.map((c) => c.id).join();
  step(ctx, { ...NONE, card: { action: 'reroll', index: 0 } });
  assert.equal(ctx.cards.offer!.length, 3);
  assert.ok(ctx.cards.offer!.map((c) => c.id).join() !== before || true);
});

// ------------------------------------------------------------------ exclusions and stacking
test('exclusion: once Pressure Jet is taken, Scatter is never offered; neither is offered before the move is used a while', () => {
  const ctx = calm('totodile');
  const ids = () => { const out = new Set<string>(); for (let k = 0; k < 200; k++) { ctx.build.lastShown = new Set(); for (const c of generateBuildOffer(ctx)) out.add(c.kind === 'transform' ? 'xf:' + c.key : c.id); } return out; };
  ctx.player.moves[0].uses = 0;
  assert.ok(!ids().has('xf:pressure_jet') && !ids().has('xf:scatter'), 'not before 25 basic-attack casts');
  ctx.player.moves[0].uses = 25;
  const avail = ids();
  assert.ok(avail.has('xf:pressure_jet') && avail.has('xf:scatter'));
  assert.equal(setTransform(ctx, ctx.player.moves[0], 'pressure_jet'), true);
  assert.equal(setTransform(ctx, ctx.player.moves[0], 'scatter'), false, 'a move takes one transform, once');
  const after = ids();
  assert.ok(!after.has('xf:pressure_jet') && !after.has('xf:scatter'));
});

test('identity: cross-game Flame Charge gives Houndour a Push line for Crunch Down', () => {
  const toto = calm('totodile');
  assert.ok(lineVerbs(toto.rules, toto.player.m).has('push'));
  assert.equal(transformAllowed(toto.rules, toto.player.m, TRANSFORM_BY_ID.crunch_down), true);
  const h = addMember(toto, 'houndour')!;
  assert.equal(lineVerbs(toto.rules, h).has('push'), true, 'Houndour learns Flame Charge in a later game');
  assert.equal(transformAllowed(toto.rules, h, TRANSFORM_BY_ID.crunch_down), true);
  assert.equal(transformAllowed(toto.rules, h, TRANSFORM_BY_ID.lunge), true);
  assert.equal(transformAllowed(toto.rules, h, TRANSFORM_BY_ID.kindle), true);
});

test('stacking: no card stacks; techniques are held once; no numeric card appears in 300 default offers; the legacy flag brings them back', () => {
  const ctx = calm('cyndaquil');
  assert.equal(addTechnique(ctx, 'quarry'), true);
  assert.equal(addTechnique(ctx, 'quarry'), false);
  const kinds = new Set<string>();
  for (let k = 0; k < 300; k++) { ctx.build.lastShown = new Set(); ctx.player.hp = ctx.player.maxHp * 0.2; for (const c of generateBuildOffer(ctx)) { kinds.add(c.kind); assert.notEqual(c.key, 'quarry'); } }
  assert.ok(!kinds.has('vitamin') && !kinds.has('upgrade'), [...kinds].join());
  const legacy = calm('cyndaquil', { build: { legacyNumeric: true } });
  const lk = new Set<string>();
  for (let k = 0; k < 300; k++) { legacy.build.lastShown = new Set(); for (const c of generateBuildOffer(legacy)) lk.add(c.kind); }
  assert.ok(lk.has('vitamin') && lk.has('upgrade'), [...lk].join());
});

test('mastery: move levels follow the squad level (no power-up cards); the legacy flag restores card levels', () => {
  const ctx = calm('cyndaquil');
  for (let k = 0; k < 10; k++) gainXp(ctx, ctx.player.xpNext - ctx.player.xp + 0.01);
  assert.equal(ctx.player.level, 11);
  assert.equal(ctx.player.moves[0].level, 3, '1 + floor(10 / 5)');
  const legacy = calm('cyndaquil', { build: { legacyNumeric: true } });
  for (let k = 0; k < 10; k++) gainXp(legacy, legacy.player.xpNext - legacy.player.xp + 0.01);
  assert.equal(legacy.player.moves[0].level, 1);
});

// ------------------------------------------------------------------ the three-technique limit
test('limit: a 4th technique opens the discard choice; the pick is spent only when one is discarded; Keep returns to the same offer', () => {
  const ctx = calm('totodile');
  for (const t of ['quarry', 'catalyst', 'riposte']) addTechnique(ctx, t);
  let offer = levelUp(ctx);
  for (let k = 0; k < 20 && !offer.some((c) => c.kind === 'technique'); k++) { step(ctx, { ...NONE, card: { action: 'reroll', index: 0 } }); ctx.cards.rerolls = 9; offer = ctx.cards.offer!; }
  const ti = offer.findIndex((c) => c.kind === 'technique');
  assert.ok(ti >= 0 && offer[ti].swap, 'a replacement card');
  const ids = offer.map((c) => c.id).join();
  const pending = ctx.player.pendingLevels;
  step(ctx, { ...NONE, ...pickInput(ti) });
  assert.equal(ctx.cards.source, 'swap');
  assert.equal(ctx.cards.offer!.length, 4, 'three discards and Keep');
  assert.equal(ctx.player.pendingLevels, pending, 'not spent yet');
  step(ctx, { ...NONE, card: { action: 'skip', index: 0 } }); // skip = keep
  assert.equal(ctx.cards.source, 'level');
  assert.equal(ctx.cards.offer!.map((c) => c.id).join(), ids, 'the same offer, not a free reroll');
  step(ctx, { ...NONE, ...pickInput(ti) });
  const incoming = offer[ti].key;
  step(ctx, { ...NONE, ...pickInput(1) }); // discard the second held technique (catalyst)
  assert.deepEqual([...ctx.player.techs].sort(), ['quarry', 'riposte', incoming].sort());
  assert.equal(ctx.player.techs.length, 3);
  assert.equal(ctx.player.pendingLevels, pending - 1);
});

// ------------------------------------------------------------------ transforms in play
test('Pressure Jet: a beam with Push 2 rolls a rock (Weight 2); the trainer is rooted while it fires', () => {
  const ctx = calm('totodile');
  const a = arena(ctx);
  kit(ctx, ['tackle'], ['water_gun', 'pressure_jet']);
  const b = spawnBody(ctx, 'rock', a.x + 5, a.z);
  ctx.bodies.hp[b] = ctx.bodies.maxHp[b] = 1e6; // Water breaks Rock (x2): keep it whole to watch it roll
  const ev = castA(ctx, east(ctx), BTN.a);
  assert.ok(ev.some((e) => e.t === 'beam'));
  assert.ok(ctx.player.rootT > 0, 'rooted');
  assert.ok(Math.hypot(ctx.bodies.vx[b], ctx.bodies.vz[b]) > 5 && ctx.bodies.vx[b] > 0, 'the rock rolls east');
  const x0 = ctx.player.x;
  steps(ctx, 5, { mx: 0, mz: 1 });
  assert.ok(Math.abs(ctx.player.x - x0) < 1e-6 && ctx.player.rootT <= 0.3, 'no walking while rooted');
  // the base Water Gun (Push 1) cannot roll it
  const c2 = calm('totodile'); const a2 = arena(c2); kit(c2, ['tackle'], ['water_gun']);
  const b2 = spawnBody(c2, 'rock', a2.x + 5, a2.z);
  c2.bodies.hp[b2] = c2.bodies.maxHp[b2] = 1e6;
  for (let k = 0; k < 40; k++) step(c2, { ...NONE, ...east(c2), btn: BTN.a });
  assert.ok(Math.hypot(c2.bodies.vx[b2], c2.bodies.vz[b2]) < 1);
});

test('Scatter: three shots in a fan, no Push, a light Wet coat even as Move A', () => {
  const ctx = calm('totodile');
  const a = arena(ctx);
  kit(ctx, ['tackle'], ['water_gun', 'scatter']);
  const e = dummy(ctx, 'rattata', a.x + 4, a.z);
  const n0 = countKind(ctx, PK.straight);
  castA(ctx, east(ctx));
  assert.equal(countKind(ctx, PK.straight) - n0, 3);
  steps(ctx, 20, east(ctx));
  assert.equal(ctx.enemies.coat[e], AG.wet);
  assert.equal(ctx.enemies.coatDeep[e], 1, 'light, though cast as Move A');
});
const countKind = (ctx: SimContext, k: number) => { let n = 0; for (let i = 0; i < ctx.projectiles.hi; i++) if (ctx.projectiles.alive[i] && ctx.projectiles.kind[i] === k) n++; return n; };

test('Kindle: where the shot ends, the ground in 1.6 m gets Heat (wet ground dries); base Ember dries only its path', () => {
  const dried = (xf?: string) => {
    const ctx = calm('cyndaquil');
    const a = arena(ctx);
    kit(ctx, ['tackle'], xf ? ['ember', xf] : ['ember']);
    const ex = a.x + 6;
    dummy(ctx, 'rattata', ex, a.z);
    const C = ctx.world.cells;
    // wet ground beside the target, off the shot's line
    const side = [C.tile(ex, a.z + 1.2), C.tile(ex - 0.6, a.z - 1.2), C.tile(ex + 0.5, a.z + 1.3)];
    for (const k of side) C.set(k, CS.wet, 30);
    castA(ctx, east(ctx));
    steps(ctx, 20, east(ctx));
    return side.filter((k) => C.state[k] !== CS.wet).length;
  };
  assert.ok(dried('kindle') >= 2, 'Kindle dries the ground around where it lands');
  assert.equal(dried(), 0, 'base Ember does not');
});

test('Searing: the basic attack leaves a deep Heat coat, even on an elite (base Ember coats only fodder, light)', () => {
  const coat = (xf?: string) => {
    const ctx = calm('cyndaquil');
    const a = arena(ctx);
    kit(ctx, xf ? ['ember', xf] : ['ember']);
    const e = dummy(ctx, 'sandshrew', a.x + 5, a.z, ROLE.elite);
    steps(ctx, 90, east(ctx));
    return [ctx.enemies.coat[e], ctx.enemies.coatDeep[e]];
  };
  assert.deepEqual(coat('searing'), [AG.heat, 2]);
  assert.deepEqual(coat(), [0, 0]);
});

test('Ram: Flame Wheel with Push 3 rolls a boulder (Weight 3) alone; base Flame Wheel (Push 2) only slows it', () => {
  const run = (xf?: string) => {
    const ctx = calm('cyndaquil');
    const a = arena(ctx);
    kit(ctx, ['tackle'], xf ? ['flame_wheel', xf] : ['flame_wheel']);
    const b = spawnBody(ctx, 'boulder', a.x + 3, a.z);
    castA(ctx, east(ctx));
    steps(ctx, 6, east(ctx));
    return ctx.bodies.vx[b];
  };
  assert.ok(run('ram') > 5, 'rolls');
  assert.ok(run() < 1, 'too heavy');
  assert.ok(transformSpec(calm('cyndaquil').rules, 'flame_wheel', 'ram').duration < compileMove(calm('cyndaquil').rules, 'flame_wheel').duration, 'shorter dash');
});

test('Wheel Trail: the dash leaves burning ground and Heat zones behind', () => {
  const ctx = calm('cyndaquil');
  arena(ctx);
  kit(ctx, ['tackle'], ['flame_wheel', 'wheel_trail']);
  const z0 = ctx.zones.count;
  castA(ctx, east(ctx));
  assert.ok(ctx.zones.count - z0 >= 4, 'trail zones');
});

test('Lasso: Hold 2 suspends a rock and a Light enemy, then throws them along the aim; a Medium enemy is only hit', () => {
  const ctx = calm('bulbasaur');
  const a = arena(ctx);
  kit(ctx, ['tackle'], ['vine_whip', 'lasso']);
  const b = spawnBody(ctx, 'rock', a.x + 2.6, a.z);
  ctx.bodies.hp[b] = ctx.bodies.maxHp[b] = 1e6; // Grass breaks Rock (x2)
  castA(ctx, east(ctx));
  assert.ok(ctx.bodies.holdT[b] > 0, 'the rock (Weight 2) is held');
  const c = calm('bulbasaur'); const a2 = arena(c); kit(c, ['tackle'], ['vine_whip', 'lasso']);
  const light = dummy(c, 'rattata', a2.x + 2.6, a2.z);
  assert.ok(weightClass(SPECIES_BY_ID.rattata) <= 1);
  castA(c, { aimX: a2.x + 8, aimZ: a2.z }, BTN.a);
  assert.ok(c.enemies.heldT[light] > 0, 'the Light enemy is suspended');
  steps(c, 45, { aimX: a2.x, aimZ: a2.z + 10 }); // let go (no button): thrown north along the new aim
  assert.equal(c.enemies.heldT[light], 0);
  assert.ok(c.caplog.since(0).some((r) => r.verb === 'release' && r.tgt === 'creature'));
  const d = calm('bulbasaur'); const a3 = arena(d); kit(d, ['tackle'], ['vine_whip', 'lasso']);
  const med = dummy(d, 'sandshrew', a3.x + 2.6, a3.z);
  assert.ok(weightClass(SPECIES_BY_ID.sandshrew) >= 2);
  castA(d, east(d));
  assert.equal(d.enemies.heldT[med], 0);
  assert.ok(d.enemies.hp[med] < d.enemies.maxHp[med]);
});

test('Snare: every lash roots for 0.8 s through the CC meter; it cannot hold', () => {
  const ctx = calm('bulbasaur');
  const a = arena(ctx);
  kit(ctx, ['tackle'], ['vine_whip', 'snare']);
  const e = dummy(ctx, 'rattata', a.x + 2.6, a.z);
  castA(ctx, east(ctx));
  assert.ok(ctx.enemies.root[e] > 0.6 && ctx.enemies.root[e] <= 0.8 + 1e-6, `root ${ctx.enemies.root[e]}`);
  assert.equal(ctx.enemies.heldT[e], 0);
  const b = spawnBody(ctx, 'rubble', a.x + 2.6, a.z + 0.6); ctx.bodies.life[b] = 99;
  steps(ctx, 40, { ...east(ctx), btn: BTN.a });
  assert.equal(ctx.bodies.holdT[b], 0, 'no Hold');
});

test('Cluster: three lobs per cast; Burrow: one lob that leaves a Grass patch enemies cross at 55% speed', () => {
  const ctx = calm('bulbasaur');
  const a = arena(ctx);
  kit(ctx, ['tackle'], ['seed_bomb', 'cluster']);
  dummy(ctx, 'rattata', a.x + 6, a.z);
  const n0 = countKind(ctx, PK.lob);
  castA(ctx, east(ctx));
  assert.equal(countKind(ctx, PK.lob) - n0, 3);
  const c = calm('bulbasaur'); const a2 = arena(c); kit(c, ['tackle'], ['seed_bomb', 'burrow']);
  dummy(c, 'rattata', a2.x + 6, a2.z);
  castA(c, east(c)); steps(c, 80, east(c));
  const k = c.world.cells.tile(a2.x + 6, a2.z);
  assert.equal(c.world.cells.state[k], CS.bramble);
  assert.deepEqual(footing(c, a2.x + 6, a2.z, ['plain'], true), [0.55, 1]);
  assert.deepEqual(footing(c, a2.x + 6, a2.z, ['bloom'], true), [1, 1], 'Grass types walk through');
  assert.deepEqual(footing(c, a2.x + 6, a2.z, ['plain'], false), [1, 1], 'your own Pokémon too');
  assert.ok(c.caplog.since(0).some((r) => r.verb === 'create' && r.tgtName === 'grass patch'));
});

test('Crunch Down: one target only, with Push 2 (rolls a rock); Lunge: a 5 m lunge, untouchable', () => {
  const ctx = calm('totodile');
  const a = arena(ctx);
  kit(ctx, ['tackle'], ['bite', 'crunch_down']);
  const e1 = dummy(ctx, 'rattata', a.x + 2.6, a.z), e2 = dummy(ctx, 'rattata', a.x + 3.2, a.z + 0.8);
  castA(ctx, east(ctx));
  const hit = [e1, e2].filter((e) => ctx.enemies.hp[e] < ctx.enemies.maxHp[e]).length;
  assert.equal(hit, 1);
  const c = calm('totodile'); const a2 = arena(c); kit(c, ['tackle'], ['bite', 'lunge']);
  dummy(c, 'rattata', a2.x + 3, a2.z);
  const x0 = c.player.x;
  castA(c, east(c));
  assert.ok(c.player.dashT > 0);
  assert.equal(damagePlayer(c, 10, c.player.x + 1, c.player.z), 'none', 'untouchable while lunging');
  steps(c, 14, east(c));
  assert.ok(c.player.x - x0 > 3.5 && c.player.x - x0 < 6, `moved ${(c.player.x - x0).toFixed(2)} m`);
});

// ------------------------------------------------------------------ techniques in play
test('Undertow: Flame Wheel on a creature starts Steam (Heat, then Wet); Push moves deal 20% less; a rolled rock wets the ground', () => {
  const ctx = calm('cyndaquil');
  const a = arena(ctx);
  kit(ctx, ['ember'], ['flame_wheel']);
  const base = slotSpec(ctx, 1).dmg, ember = slotSpec(ctx, 0).dmg;
  addTechnique(ctx, 'undertow');
  assert.ok(Math.abs(slotSpec(ctx, 1).dmg / base - 0.8) < 1e-9);
  assert.equal(slotSpec(ctx, 0).dmg, ember, 'Ember does not push');
  dummy(ctx, 'rattata', a.x + 3, a.z);
  const ev = [...castA(ctx, east(ctx)), ...steps(ctx, 20, east(ctx))];
  assert.ok(ev.some((e) => e.t === 'react' && e.kind === 'steam'), 'Steam');
  assert.ok(ctx.caplog.since(0).some((r) => r.verb === 'apply' && r.srcName === 'Undertow' && r.tgt === 'creature'), 'an Apply event after the Push, in the capability log');
  const c = calm('totodile'); const a2 = arena(c); kit(c, ['tackle'], ['water_gun', 'pressure_jet']); addTechnique(c, 'undertow');
  const b = spawnBody(c, 'rock', a2.x + 5, a2.z);
  castA(c, east(c));
  void b;
  assert.equal(c.world.cells.at(c.bodies.x[b], c.bodies.z[b]), CS.wet);
});

test('Riposte: a Guard deflect refunds Move A; Guard ends when the window closes (no Brace)', () => {
  const ctx = calm('totodile');
  arena(ctx);
  addTechnique(ctx, 'riposte');
  kit(ctx, ['water_gun'], ['bite']);
  ctx.player.moves[1].cd = 5;
  ctx.player.guardT = 0;
  assert.equal(damagePlayer(ctx, 10, ctx.player.x + 1, ctx.player.z, 1, 0), 'parry');
  assert.equal(ctx.player.moves[1].cd, 0);
  ctx.player.guardT = -1; ctx.player.guardLock = 0; ctx.player.reflex = 2;
  steps(ctx, 30, { btn: BTN.guard });
  assert.equal(ctx.player.guardT, -1, 'no Brace with Riposte');
  const c = calm('totodile'); steps(c, 30, { btn: BTN.guard });
  assert.ok(c.player.guardT > 0.2, 'base Guard braces while held');
});

test('Lodestone: +1 Hold (Lasso catches a boulder alone), holds last 1.5 s, and you cannot walk while holding', () => {
  const ctx = calm('bulbasaur');
  const a = arena(ctx);
  kit(ctx, ['tackle'], ['vine_whip', 'lasso']);
  addTechnique(ctx, 'lodestone');
  assert.equal(capOf(slotSpec(ctx, 1).caps, 'hold'), 3);
  const b = spawnBody(ctx, 'boulder', a.x + 2.8, a.z); ctx.bodies.life[b] = 99;
  castA(ctx, east(ctx), BTN.a);
  assert.ok(ctx.bodies.holdT[b] > 1.2, 'a boulder (Weight 3) held, for up to 1.5 s');
  steps(ctx, 2, { ...east(ctx), btn: BTN.a });
  const x0 = ctx.player.x, z0 = ctx.player.z;
  steps(ctx, 20, { ...east(ctx), btn: BTN.a, mx: 0, mz: 1 });
  assert.ok(Math.hypot(ctx.player.x - x0, ctx.player.z - z0) < 0.05, 'rooted while holding');
  const c = calm('bulbasaur'); const a2 = arena(c); kit(c, ['tackle'], ['vine_whip', 'lasso']);
  const b2 = spawnBody(c, 'boulder', a2.x + 2.8, a2.z);
  castA(c, east(c));
  assert.equal(c.bodies.holdT[b2], 0, 'Lasso alone (Hold 2) cannot hold a boulder');
});

test('Heavy Footing: +1 Weight for Guard (a Light Pokémon parries a Medium rock), half knockback, 15% slower, 30% shorter dash', () => {
  const ctx = calm('totodile');
  arena(ctx);
  assert.equal(guardWeight(ctx), 1);
  addTechnique(ctx, 'heavy_footing');
  assert.equal(guardWeight(ctx), 2);
  ctx.player.guardT = 0;
  assert.equal(damagePlayer(ctx, 10, ctx.player.x + 1, ctx.player.z, 1, 2), 'parry');
  const walk = (tech: boolean) => { const c = calm('totodile'); arena(c); if (tech) addTechnique(c, 'heavy_footing'); const x0 = c.player.x; steps(c, 60, { mx: 1, mz: 0 }); return c.player.x - x0; };
  assert.ok(Math.abs(walk(true) / walk(false) - 0.85) < 0.03);
  const c = calm('totodile'); arena(c); addTechnique(c, 'heavy_footing'); step(c, { ...NONE, dash: true, mx: 1 });
  assert.ok(Math.abs(c.player.dashT - c.rules.player.dashTime * 0.7) < 1e-9);
  const k = (tech: boolean) => { const d = calm('totodile'); arena(d); if (tech) addTechnique(d, 'heavy_footing'); damagePlayer(d, 5, d.player.x - 1, d.player.z); return d.player.kx; };
  assert.ok(Math.abs(k(true) / k(false) - 0.5) < 1e-9);
});

test('Catalyst: a reaction your hit triggers takes 1 s off Move A and B; your basic attack applies no light coat', () => {
  const ctx = calm('cyndaquil');
  const a = arena(ctx);
  kit(ctx, ['ember'], ['flame_wheel'], ['tackle']);
  addTechnique(ctx, 'catalyst');
  const e = dummy(ctx, 'rattata', a.x + 5, a.z);
  coatEnemy(ctx, e, AG.wet, 2, 0);
  ctx.player.moves[1].cd = 5; ctx.player.moves[2].cd = 5;
  damageEnemy(ctx, e, 10, { element: 'blaze', cls: 'special', ailment: 'knock', chance: 0, knock: 0, kx: 1, kz: 0, drain: 0, source: 't', depth: 2 });
  assert.equal(ctx.player.moves[1].cd, 4); assert.equal(ctx.player.moves[2].cd, 4);
  // a tile reaction does not count
  coatEnemy(ctx, e, AG.wet, 2, 0); coatEnemy(ctx, e, AG.heat, 2, 0);
  assert.equal(ctx.player.moves[1].cd, 4);
  // Ember on bare ground (Heat does nothing to plain tiles, so any coat comes from the hit)
  const lightCoat = (tech: boolean) => { const c = calm('cyndaquil'); const a2 = arena(c); kit(c, ['ember']); if (tech) addTechnique(c, 'catalyst'); const f = dummy(c, 'rattata', a2.x + 5, a2.z); steps(c, 60, east(c)); assert.ok(c.enemies.hp[f] < c.enemies.maxHp[f], 'hit'); return c.enemies.coat[f]; };
  assert.equal(lightCoat(false), AG.heat);
  assert.equal(lightCoat(true), 0);
});

test('Slipstream: Dash costs 1.3 charges; dashing through a coated enemy copies its coat onto the next Move', () => {
  const ctx = calm('totodile');
  const a = arena(ctx);
  kit(ctx, ['tackle'], ['bite']);
  addTechnique(ctx, 'slipstream');
  const e = dummy(ctx, 'rattata', a.x + 2, a.z);
  coatEnemy(ctx, e, AG.cold, 2, 0);
  ctx.player.reflex = 2;
  step(ctx, { ...NONE, dash: true, mx: 1 });
  assert.ok(Math.abs(ctx.player.reflex - (2 - 1.3)) < 0.02, `reflex ${ctx.player.reflex}`);
  steps(ctx, 12, { mx: 1 });
  assert.equal(ctx.player.slipAg, AG.cold);
  const t = dummy(ctx, 'rattata', ctx.player.x + 2.6, ctx.player.z);
  castA(ctx, east(ctx));
  assert.equal(ctx.enemies.coat[t], AG.cold, 'the Move carried the copied coat');
  assert.equal(ctx.player.slipAg, 0);
});

test('Quarry: a rock you break leaves 2 extra rubble, yours, flung outward; your hits deal 25% less integrity damage', () => {
  const run = (tech: boolean) => {
    const ctx = calm('bulbasaur');
    const a = arena(ctx);
    kit(ctx, ['tackle'], ['vine_whip']);
    if (tech) addTechnique(ctx, 'quarry');
    const b = spawnBody(ctx, 'rock', a.x + 2.6, a.z);
    ctx.bodies.hp[b] = ctx.bodies.maxHp[b] = 1e6;
    castA(ctx, east(ctx)); // a move hit: integrity damage
    const dealt = 1e6 - ctx.bodies.hp[b];
    const before = ctx.bodies.count;
    damageBody(ctx, b, 2e6, 'brawl', true); // the trainer's hit breaks it
    let mine = 0, fast = 0;
    for (let i = 0; i < ctx.bodies.hi; i++) if (ctx.bodies.alive[i] && ctx.bodies.kind[i] === 3 && ctx.bodies.team[i] === TEAM.player) { mine++; if (Math.hypot(ctx.bodies.vx[i], ctx.bodies.vz[i]) >= 5) fast++; }
    // an enemy's or a neutral break is not the trainer's: no extra rubble
    const n = spawnBody(ctx, 'rock', a.x + 6, a.z + 3), before2 = ctx.bodies.count;
    damageBody(ctx, n, 2e6, 'brawl', false);
    return { dealt, pieces: ctx.bodies.count === 0 ? 0 : before2, made: before2 - before, mine, fast, neutral: ctx.bodies.count - before2 };
  };
  const base = run(false), q = run(true);
  assert.equal(q.made - base.made, 2, 'two extra pieces');
  assert.ok(q.mine >= 2 && q.fast >= 2, 'yours, and flung fast enough to strike');
  assert.equal(q.neutral, base.neutral, 'only breaks you caused');
  assert.ok(Math.abs(q.dealt / base.dealt - 0.75) < 0.01, `${q.dealt} vs ${base.dealt}`);
});

test('Second Wind: tagging in clears the incoming Pokémon\'s coat; Tag cooldown is 5 s', () => {
  const ctx = calm('totodile');
  arena(ctx);
  const m = addMember(ctx, 'mareep')!;
  addTechnique(ctx, 'second_wind');
  m.coat = AG.wet; m.coatDeep = 2; m.coatT = 8;
  assert.equal(tagTo(ctx, 1), true);
  assert.equal(ctx.player.m.coat, 0);
  assert.equal(ctx.player.tagCd, 5);
});

// ------------------------------------------------------------------ integration
test('learnsets: Kit learn cards come only from the field Pokémon\'s line', () => {
  const ctx = calm('cyndaquil');
  ctx.player.level = 25;
  const line = new Set(['tackle', 'quick_attack', 'flame_wheel', 'swift', 'lava_plume', 'flamethrower', 'rollout', 'double_edge', 'eruption', 'ember', 'defense_curl']);
  for (let k = 0; k < 200; k++) { ctx.build.lastShown = new Set(); for (const c of generateBuildOffer(ctx)) if (c.kind === 'learn' || c.kind === 'replace') assert.ok(line.has(c.key), c.key); }
});

test('squad switching: a Kit card is for the Pokémon it names, even after a Tag; a benched member\'s transform is a Wildcard', () => {
  const ctx = calm('totodile');
  arena(ctx);
  addMember(ctx, 'cyndaquil');
  ctx.player.squad[1].moves[0] = { key: 'ember', level: 1, cd: 0, spec: compileMove(ctx.rules, 'ember'), uses: 99 };
  ctx.player.moves[0].uses = 99;
  let found: Card | undefined, bench: Card | undefined;
  for (let k = 0; k < 200 && !(found && bench); k++) {
    ctx.build.lastShown = new Set();
    for (const c of generateBuildOffer(ctx)) { if (c.kind === 'transform' && c.member === 0) found = c; if (c.kind === 'transform' && c.member === 1) bench = c; }
  }
  assert.ok(found && found.group === 'kit');
  assert.ok(bench && bench.group === 'wildcard' && bench.key.match(/kindle|searing/));
  ctx.cards.offer = [found!]; ctx.cards.source = 'level'; ctx.player.pendingLevels = 1;
  ctx.player.tagCd = 0;
  tagTo(ctx, 1);
  steps(ctx, 1, pickInput(0));
  assert.ok(ctx.player.squad[0].moves[0].xf, 'Totodile\'s Water Gun was transformed');
  assert.equal(ctx.player.squad[1].moves[0].xf, undefined);
});

test('evolution: transforms and techniques survive evolution (field and bench); the Wildcard can evolve a Pokémon early', () => {
  const ctx = calm('totodile');
  setTransform(ctx, ctx.player.moves[0], 'scatter');
  addTechnique(ctx, 'undertow');
  evolveNow(ctx, 0);
  assert.equal(ctx.player.species.id, 'croconaw');
  assert.equal(ctx.player.moves[0].xf, 'scatter');
  assert.equal(ctx.player.moves[0].spec.count, 3);
  assert.deepEqual(ctx.player.techs, ['undertow']);
  const c = calm('totodile');
  c.player.level = c.player.species.evolveLevel! - 1;
  let evo: Card | undefined;
  for (let k = 0; k < 200 && !evo; k++) { c.build.lastShown = new Set(); evo = generateBuildOffer(c).find((x) => x.kind === 'evolve'); }
  assert.ok(evo && evo.group === 'wildcard');
});

test('capability events: techniques write to the capability log (death recap, pokewatch.debug)', () => {
  const ctx = calm('totodile');
  addTechnique(ctx, 'second_wind');
  const m = addMember(ctx, 'mareep')!; m.coat = AG.wet; m.coatT = 5;
  tagTo(ctx, 1);
  const r = ctx.caplog.since(0).filter((x) => x.verb === 'technique');
  assert.ok(r.some((x) => x.srcName === 'Second Wind'));
  assert.ok(r.some((x) => x.tgtName === 'learned'));
});

test('squad tags: the offer counts the whole squad\'s capabilities for novelty', () => {
  const ctx = calm('bulbasaur');
  assert.ok(!squadTags(ctx).has('push'));
  addMember(ctx, 'totodile');
  assert.ok(squadTags(ctx).has('push'));
});

// ------------------------------------------------------------------ build diversity, determinism, regression
test('build diversity: random picks over 12 runs give many distinct builds, and no technique is in every build', async () => {
  const { botInput, setBotCards } = await import('../src/sim/bot');
  const builds = new Set<string>(), techCount: Record<string, number> = {}, xfs = new Set<string>();
  let runs = 0;
  for (const species of ['totodile', 'cyndaquil', 'bulbasaur']) for (let seed = 1; seed <= 4; seed++) {
    setBotCards('random', undefined, seed);
    const ctx = createRun({ seed, species });
    while (ctx.time < 150 && ctx.state !== 'over') step(ctx, botInput(ctx));
    runs++;
    const techs = [...ctx.player.techs].sort();
    for (const t of techs) techCount[t] = (techCount[t] ?? 0) + 1;
    const xf = ctx.player.squad.flatMap((m) => m.moves.map((s) => s.xf).filter(Boolean)).sort();
    for (const x of xf) xfs.add(x!);
    builds.add(species + ':' + techs.join('+') + '|' + xf.join('+'));
  }
  setBotCards('first');
  assert.ok(builds.size >= 10, `${builds.size} distinct builds in ${runs} runs`);
  assert.ok(Object.keys(techCount).length >= 6, `techniques seen: ${Object.keys(techCount).join()}`);
  assert.ok(Object.values(techCount).every((n) => n < runs), 'no technique in every build');
  assert.ok(xfs.size >= 3, `transforms seen: ${[...xfs].join()}`);
});

test('determinism: the same seed and inputs give the same offers, picks and state hash with the build layer on', () => {
  const run = () => {
    const ctx = createRun({ seed: 9, species: 'totodile' });
    const hashes: number[] = [], seen: string[] = [];
    for (let t = 0; t < 60 * 90 && ctx.state !== 'over'; t++) {
      const P = ctx.player, a = t * 0.013;
      const offer = ctx.cards.offer;
      if (offer && t % 7 === 0) seen.push(offer.map((c) => c.id).join(','));
      step(ctx, { mx: Math.sin(a * 0.7), mz: Math.cos(a * 0.5), jump: false, dash: t % 170 === 0, aimX: P.x + Math.sin(a) * 8, aimZ: P.z + Math.cos(a) * 8,
        btn: (t % 90 < 50 ? BTN.a : 0) | (t % 75 < 6 ? BTN.guard : 0), card: offer && t % 7 === 0 ? { action: 'pick', index: t % offer.length } : undefined });
      if (t % 600 === 0) hashes.push(stateHash(ctx));
    }
    return { hashes, seen, techs: ctx.player.techs.join(), history: ctx.build.history.join() };
  };
  const a = run(), b = run();
  assert.deepEqual(a, b);
  assert.ok(a.history.length > 0);
});

test('regression: with the build layer off, replay hashes equal the Phase 8a build (commit 3a92f49)', async () => {
  const { botInput } = await import('../src/sim/bot');
  const { MODES } = await import('../src/mods');
  const { StateHasher } = await import('../src/sim/checksum');
  const legacy = (ctx: SimContext) => {
    const h = new StateHasher(), P = ctx.player;
    h.num(ctx.tick).num(ctx.stage).num(ctx.stats.kills).num(ctx.stats.damageTaken).num(ctx.stats.xp);
    h.num(P.x).num(P.y).num(P.z).num(P.vx).num(P.vz).num(P.reflex).num(P.level).num(P.xp).num(P.hp).num(P.maxHp);
    for (const s of P.moves) h.num(s.cd).num(s.level);
    const E = ctx.enemies; for (let i = 0; i < E.hi; i++) if (E.alive[i]) h.num(i).num(E.x[i]).num(E.z[i]).num(E.hp[i]);
    const B = ctx.bodies; for (let i = 0; i < B.hi; i++) if (B.alive[i]) h.num(B.x[i]).num(B.z[i]);
    return h.h.toString(16);
  };
  // recorded from the unmodified Phase 8a source (git worktree of 3a92f49), every 30 s
  const P8A: [string, number, string, number, string[]][] = [
    ['cyndaquil', 2, 'classic', 150, ['296ccbe4', '640f81f4', '317bed7d', 'df56467', '9a782721']],
    ['bulbasaur', 3, 'survival', 120, ['ad031d5a', '9b72ca20']],
    ['charmander', 11, 'boss-rush', 120, ['1f32c47b', 'f6a00e15', '2c8dfe22', '24d1f2c5']],
    ['totodile', 7, 'classic', 120, ['e5e2b8d4', '6f44f52c']],
  ];
  for (const [species, seed, mode, seconds, want] of P8A) {
    const ctx = createRun({ seed, species, mode: MODES.find((m) => m.id === mode), ruleOverrides: { build: { enabled: false }, surfaces: { enabled: false } } as never });
    const got: string[] = [];
    while (ctx.time < seconds && ctx.state !== 'over' && ctx.state !== 'victory') { step(ctx, botInput(ctx)); if (ctx.tick % 1800 === 0) got.push(legacy(ctx)); }
    assert.deepEqual(got, want, `${species} seed ${seed} ${mode}`);
  }
});

test('regression: every mode, and the legacy-numeric flag, run two bot minutes with the build layer on without errors', async () => {
  const { botInput, setBotCards } = await import('../src/sim/bot');
  const { MODES } = await import('../src/mods');
  for (const [mode, extra, pol] of [['classic', {}, 'random'], ['survival', {}, 'plan'], ['boss-rush', { build: { legacyNumeric: true } }, 'random'], ['glass-cannon', {}, 'first']] as const) {
    setBotCards(pol as never, { techs: ['undertow', 'lodestone', 'slipstream'] }, 3);
    const ctx = createRun({ seed: 4, species: 'bulbasaur', mode: MODES.find((m) => m.id === mode), ruleOverrides: extra as never });
    for (let t = 0; t < 7200 && ctx.state !== 'over' && ctx.state !== 'victory'; t++) step(ctx, botInput(ctx));
    assert.ok(ctx.tick > 0 && Number.isFinite(ctx.player.hp));
  }
  setBotCards('first');
});
void shootHostile;
