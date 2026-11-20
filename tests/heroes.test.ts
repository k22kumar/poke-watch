// Heroes (src/rules/heroes.ts, docs/hero-shooter-pivot.md §10): the prototype's exclusions and the test lines.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FEATURED, NEEDS_ABILITY_RULE, NEEDS_ABILITY_RULE_REASON, PROTOTYPE } from '../src/rules/heroes';
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

test('the prototype list: featured first, every form ready and recruitable, whole lines linked so each can Breakthrough', () => {
  assert.deepEqual(PROTOTYPE.slice(0, FEATURED.length), FEATURED);
  assert.equal(new Set(PROTOTYPE).size, PROTOTYPE.length, 'no duplicates');
  const set = new Set(PROTOTYPE);
  const parents = new Set<string>();
  for (const id of PROTOTYPE) {
    const sp = SPECIES_BY_ID[id];
    assert.ok(sp, `${id} is a game species`);
    assert.equal(controlReadiness(sp).tier, 'ready', `${id}: ${controlReadiness(sp).reasons.join('; ')}`);
    assert.ok(isRecruitable(id), `${id} is recruitable`);
    if (sp.evolvesTo) { assert.ok(set.has(sp.evolvesTo), `${id} → ${sp.evolvesTo}: the whole line is in the list`); parents.add(sp.evolvesTo); }
  }
  // a line is whole downwards too: the form before every non-root is in the list
  for (const sp of Object.values(SPECIES_BY_ID)) if (sp.evolvesTo && set.has(sp.evolvesTo)) assert.ok(set.has(sp.id), `${sp.id} evolves into ${sp.evolvesTo} but is not in the list`);
  const roots = PROTOTYPE.filter((id) => !parents.has(id));
  assert.equal(roots.length, 22, `22 families (${roots.join(', ')})`);
  // the wild lines Breakthrough like the partner lines (the content build links every species to its single next form)
  for (const [a, b] of [['pichu', 'pikachu'], ['rookidee', 'corvisquire'], ['geodude', 'graveler'], ['bagon', 'shelgon'], ['shelgon', 'salamence']]) assert.equal(SPECIES_BY_ID[a].evolvesTo, b);
  const els = new Set(PROTOTYPE.flatMap((id) => SPECIES_BY_ID[id].elements));
  for (const e of ['stone', 'wyrm']) assert.ok(els.has(e as never), `a ${e} family`);
});

test('a branching species is left unlinked by the content build (how a Breakthrough would choose a branch is open)', () => {
  for (const id of ['snorunt', 'tyrogue', 'nincada', 'applin']) if (SPECIES_BY_ID[id]) assert.equal(SPECIES_BY_ID[id].evolvesTo, undefined, id);
  // a single-next-form wild species is linked, with no evolveLevel (only a Breakthrough evolves it)
  assert.equal(SPECIES_BY_ID.onix.evolvesTo, 'steelix');
  assert.equal(SPECIES_BY_ID.onix.evolveLevel, undefined);
});
