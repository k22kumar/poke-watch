// Control readiness (docs/PLAYABILITY.md): every species is graded from the game's own data, every selectable species
// really runs as the player, and the production starter offer is untouched by the developer roster.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import ART from '../src/content/art.json';
import { createRun, step } from '../src/sim/run';
import { botInput } from '../src/sim/bot';
import { spawnEnemy } from '../src/sim/enemies';
import { controlReadiness, controlRoster, selectableSpecies, type ReadinessCheck } from '../src/sim/playability';
import { firstAttacks, openingMove } from '../src/sim/progression';
import { SPECIES, SPECIES_BY_ID, starterEligibleSpecies } from '../src/rules/species';
import { MOVE_BY_KEY } from '../src/rules/moves';

const art = (ART as unknown as { species: Record<string, { art?: { atlas?: unknown; portrait?: unknown; anims?: Record<string, { frames?: unknown[][] }> } }> }).species;

test('every species in the registry is graded, with a reason for anything short of ready', () => {
  const roster = controlRoster();
  assert.equal(roster.length, SPECIES.length);
  assert.deepEqual(roster.map((r) => r.id), SPECIES.map((s) => s.id));
  for (const r of roster) {
    if (r.tier === 'ready') assert.equal(r.reasons.length, 0, r.id);
    else assert.ok(r.reasons.length > 0, `${r.id} is ${r.tier} without a reason`);
  }
});

test('the current roster: partners, their evolutions and every wild species are ready; bosses are partial (boss-scale body)', () => {
  for (const r of controlRoster()) {
    const sp = SPECIES_BY_ID[r.id];
    if (sp.boss) {
      assert.equal(r.tier, 'partial', r.id);
      assert.ok(r.checks.some((c) => c.id === 'body' && !c.ok), `${r.id} flags its body`);
    } else assert.equal(r.tier, 'ready', `${r.id}: ${r.reasons.join('; ')}`);
  }
});

test('opening move: starters keep their curated move, evolved partners take their line\'s, everyone else a first attack', () => {
  for (const sp of SPECIES) {
    const key = openingMove(sp);
    if (sp.starter) assert.equal(key, sp.starter, sp.id);
    else if (!sp.behaviour) assert.ok(key && MOVE_BY_KEY[key], `${sp.id} opens with a known move`);
    else assert.equal(key, firstAttacks(sp, 1, 1)[0], sp.id);
  }
  assert.equal(openingMove(SPECIES_BY_ID.ivysaur), SPECIES_BY_ID.bulbasaur.starter);
});

test('every selectable species starts a run with a move and damages an enemy under bot control', () => {
  const calm = { director: { spawnBase: -99, spawnPerMin: 0, spawnPerStage: 0, swarmEvery: 1e9, eliteEvery: 1e9 }, objectives: { firstAfter: 1e9, secondAfter: 1e9 } };
  for (const r of selectableSpecies()) {
    const ctx = createRun({ seed: 3, species: r.id, ruleOverrides: calm as never });
    assert.ok(ctx.player.moves.length >= 1, `${r.id} has an opening move`);
    assert.equal(ctx.player.moves[0].key, r.opening, r.id);
    const P = ctx.player;
    for (const [dx, dz] of [[3, 0], [-3, 0], [0, 3], [0, -3]]) spawnEnemy(ctx, 'rattata', P.x + dx, P.z + dz);
    for (let i = 0; i < 60 * 8 && ctx.state === 'play'; i++) step(ctx, botInput(ctx));
    assert.ok(ctx.stats.damageDealt > 0, `${r.id} dealt damage`);
    for (const v of [P.x, P.y, P.z]) assert.ok(Number.isFinite(v), `${r.id} position stays finite`);
  }
});

test('every species ships the art the browser needs to draw it as the player (atlas, portrait, an Idle or Walk clip)', () => {
  for (const sp of SPECIES) {
    const a = art[sp.id]?.art;
    assert.ok(a, `${sp.id} has art`);
    assert.ok(a.atlas && a.portrait, `${sp.id} atlas and portrait`);
    const base = a.anims?.Walk ?? a.anims?.Idle;
    assert.ok(base?.frames?.length && base.frames[0]?.length, `${sp.id} Walk or Idle frames (every other state falls back to them)`);
  }
});

test('host checks extend the grading: a failing block check makes a species unavailable', () => {
  const noArt: ReadinessCheck = { id: 'art', severity: 'block', test: (sp) => (sp.id === 'lapras' ? 'art did not load' : null) };
  const r = controlReadiness(SPECIES_BY_ID.lapras, undefined, [noArt]);
  assert.equal(r.tier, 'unavailable');
  assert.deepEqual(r.reasons, ['art did not load']);
  assert.ok(!selectableSpecies(undefined, [noArt]).some((x) => x.id === 'lapras'));
  assert.equal(controlReadiness(SPECIES_BY_ID.totodile, undefined, [noArt]).tier, 'ready');
});

test('the production starter offer is still the six partner lines (the dev roster does not touch `playable`)', () => {
  assert.deepEqual(starterEligibleSpecies().map((s) => s.id), ['bulbasaur', 'charmander', 'squirtle', 'chikorita', 'cyndaquil', 'totodile']);
});
