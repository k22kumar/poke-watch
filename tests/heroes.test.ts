// Heroes (src/rules/heroes.ts, docs/hero-shooter-pivot.md §10): the prototype's exclusions and the test lines.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NEEDS_ABILITY_RULE, NEEDS_ABILITY_RULE_REASON } from '../src/rules/heroes';
import { SPECIES_BY_ID } from '../src/rules/species';
import { SPECIES_OVERRIDES, isRecruitable } from '../src/rules/profiles';
import { controlReadiness } from '../src/sim/playability';

test('a species that needs its Ability rule is either not a game species or flagged recruitable: false with that reason', () => {
  for (const id of NEEDS_ABILITY_RULE) {
    if (!SPECIES_BY_ID[id]) continue;
    assert.equal(isRecruitable(id), false, `${id} is a game species: it needs recruitable: false`);
    assert.equal(SPECIES_OVERRIDES[id]?.recruitableReason, NEEDS_ABILITY_RULE_REASON, `${id}: the reason names the missing Ability rule`);
  }
  assert.ok(SPECIES_BY_ID.shedinja, 'Shedinja is the one that is a game species today');
});

test('the four test lines are game species, graded ready, and the Caterpie line evolves twice', () => {
  for (const id of ['caterpie', 'metapod', 'butterfree', 'charmander', 'charmeleon', 'charizard', 'tauros', 'mewtwo']) {
    const sp = SPECIES_BY_ID[id];
    assert.ok(sp, `${id} is a game species`);
    assert.equal(controlReadiness(sp).tier, 'ready', `${id}: ${controlReadiness(sp).reasons.join('; ')}`);
  }
  assert.equal(SPECIES_BY_ID.caterpie.evolvesTo, 'metapod');
  assert.equal(SPECIES_BY_ID.metapod.evolvesTo, 'butterfree');
});
