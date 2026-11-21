import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HAB } from '../src/rules/habitats';
import { SPECIES_OVERRIDES, canSwim, habitatAllows, speciesProfile, traversalOf, validateProfiles } from '../src/rules/profiles';
import { TAG_ACTIONS, tagLineOf } from '../src/rules/tags';
import { MOVE_BY_KEY } from '../src/rules/moves';
import { SPECIES, SPECIES_BY_ID } from '../src/rules/species';
import { defaultRules } from '../src/rules/defaults';

test('the authored overrides are valid', () => {
  assert.deepEqual(validateProfiles(), []);
});

test('validation names a bad override instead of accepting it', () => {
  const saved = { ...SPECIES_OVERRIDES };
  try {
    SPECIES_OVERRIDES.missingno = { prefers: HAB.water };
    SPECIES_OVERRIDES.rattata = { prefers: 1 << 12, requires: HAB.water, avoids: HAB.water };
    const problems = validateProfiles().join('\n');
    assert.match(problems, /missingno: not a game species/);
    assert.match(problems, /rattata\.prefers/);
    assert.match(problems, /rattata: every required habitat is also avoided/);
  } finally {
    for (const k of Object.keys(SPECIES_OVERRIDES)) delete SPECIES_OVERRIDES[k];
    Object.assign(SPECIES_OVERRIDES, saved);
  }
});

test('capability, preference and restriction stay separate: a Water type swims but is not tied to water', () => {
  const poliwag = SPECIES_BY_ID.poliwag;
  assert.ok(canSwim(poliwag), 'Water type swims (rules.hazards.water.safeTypes)');
  assert.ok(!canSwim(SPECIES_BY_ID.geodude));
  assert.ok(canSwim(SPECIES_BY_ID.geodude, [{ key: 'surf' }]), 'knowing Surf is a capability too');
  // no restriction is derived from type: Poliwag may spawn on dry rock
  assert.ok(habitatAllows('poliwag', HAB.dry | HAB.rock));
  for (const sp of SPECIES) {
    const p = speciesProfile(sp);
    assert.equal(p.requires, SPECIES_OVERRIDES[sp.id]?.requires ?? 0, `${sp.id}: no hidden requirement`);
    assert.equal(traversalOf(sp).air, !!sp.flying, `${sp.id}: the roster's legacy flag maps to the glide and hover rows`);
  }
});

test('a hard restriction blocks a tile; a preference never does', () => {
  // profiles are cached by id, so the check uses a fresh synthetic id whose override requires water
  SPECIES_OVERRIDES.__aquatic = { requires: HAB.water, avoids: HAB.dry };
  try {
    assert.ok(habitatAllows('__aquatic', HAB.water | HAB.rock));
    assert.ok(!habitatAllows('__aquatic', HAB.rock));
    assert.ok(!habitatAllows('__aquatic', HAB.water | HAB.dry), 'avoids wins over requires');
  } finally {
    delete SPECIES_OVERRIDES.__aquatic;
  }
});

test('an authored Tag Action wins; any other species gets a derived one from its own damaging moves', () => {
  for (const [id, line] of Object.entries(TAG_ACTIONS)) assert.equal(tagLineOf(id), line);
  for (const sp of SPECIES) {
    if (TAG_ACTIONS[sp.id]) continue;
    const line = tagLineOf(sp.id);
    if (!line) continue;
    for (const d of [line.base]) {
      const m = MOVE_BY_KEY[d.move];
      assert.ok(m && m.power > 0 && m.cls !== 'status', `${sp.id}: ${d.move} is a damaging move`);
      // ...or, for a species that learns no damaging move (Cosmog), the basic attack (rules.moves.fallbackAttack)
      const learns = (sp.learnset?.length ? sp.learnset : sp.canon?.levelUp ?? []).some(([, k]) => k === d.move);
      const damaging = (sp.canon?.levelUp ?? []).some(([, k]) => MOVE_BY_KEY[k] && MOVE_BY_KEY[k].cls !== 'status' && MOVE_BY_KEY[k].power > 0);
      assert.ok(learns || (!damaging && d.move === defaultRules.moves.fallbackAttack), `${sp.id} learns ${d.move}`);
    }
  }
  assert.equal(tagLineOf('not-a-species'), null);
});
