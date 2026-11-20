// The default role rule (src/rules/roles.ts, docs/SPECIES.md "Default roles") and the recruitable field
// (SPECIES_OVERRIDES, src/rules/profiles.ts): docs/size-extremes-plan.md §S2.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { defaultRules, type Rules } from '../src/rules/defaults';
import { deepMerge } from '../src/core/util';
import { defaultFlying, defaultRole } from '../src/rules/roles';
import { SPECIES, SPECIES_BY_ID, type SpeciesDef } from '../src/rules/species';
import { SPECIES_OVERRIDES, isRecruitable, unrecruitableReason, validateProfiles } from '../src/rules/profiles';

const ROOT = path.join(import.meta.dirname, '..');
const roster = JSON.parse(fs.readFileSync(path.join(ROOT, 'content/roster.json'), 'utf8'));

/** a bare wild species: a Medium (1 m) upright normal type with flat stats, unless overridden */
function mon(over: Omit<Partial<SpeciesDef>, 'stats' | 'canon'> & { stats?: Partial<SpeciesDef['stats']>; canon?: Partial<NonNullable<SpeciesDef['canon']>> } = {}): SpeciesDef {
  return {
    id: '__mon', name: 'Mon', elements: ['plain'], types: ['normal'], height: 1, art: '', wild: true,
    ...over,
    stats: { hp: 50, atk: 50, def: 50, spa: 50, spd: 50, spe: 50, ...over.stats },
    canon: { levelUp: [], levelUpOther: [], abilities: [], heightM: 1, weightKg: 10, shape: 'upright', ...over.canon },
  } as SpeciesDef;
}

test('each row of the rule, in order', () => {
  const R = defaultRules;
  assert.equal(defaultRole(mon(), R).behaviour, 'chase');
  assert.equal(defaultRole(mon({ stats: { spe: 80 } }), R).behaviour, 'charger');
  assert.equal(defaultRole(mon({ stats: { spa: 59 } }), R).behaviour, 'chase', 'Sp. Atk 9 over Atk is short of the margin');
  assert.equal(defaultRole(mon({ stats: { spa: 60 } }), R).behaviour, 'ranged', 'Sp. Atk ≥ Atk + 10');
  assert.equal(defaultRole(mon({ stats: { hp: 70, def: 70 } }), R).behaviour, 'tank', '140 ≥ 1.15 × 100');
  assert.equal(defaultRole(mon({ stats: { spa: 60, hp: 90, def: 90 } }), R).behaviour, 'ranged', 'ranged comes before tank');
  // healer: an ally-heal move from either level-up list, under the base-stat limit
  assert.equal(defaultRole(mon({ canon: { levelUpOther: ['life_dew'] } }), R).behaviour, 'healer');
  assert.equal(defaultRole(mon({ canon: { levelUpOther: ['life_dew'] }, stats: { spe: 250 } }), R).behaviour, 'charger', 'BST 500 is not under 500');
  assert.equal(defaultRole(mon({ canon: { levelUpOther: ['helping_hand'] } }), R).behaviour, 'chase', 'Helping Hand heals nobody');
  // swarm: a flyer of Medium or smaller with BST ≤ 300; a Large one is not
  const fly = { types: ['flying'], canon: { shape: 'wings', heightM: 1 } };
  assert.equal(defaultRole(mon({ ...fly, stats: { hp: 50, atk: 50, def: 50, spa: 50, spd: 50, spe: 50 } }), R).behaviour, 'swarm');
  assert.equal(defaultRole(mon({ ...fly, canon: { shape: 'wings', heightM: 1.5 } }), R).behaviour, 'chase', 'Large');
  assert.equal(defaultRole(mon({ ...fly, stats: { spe: 51 } }), R).behaviour, 'chase', 'BST 301');
});

test('flying: type and shape, abilities, and the Ghost float shapes', () => {
  const W = defaultRules.wildRole;
  assert.equal(defaultFlying(mon({ types: ['flying'], canon: { shape: 'wings' } }), W), true);
  assert.equal(defaultFlying(mon({ types: ['normal', 'flying'], canon: { shape: 'legs' } }), W), false, 'a runner (Doduo, Dodrio)');
  assert.equal(defaultFlying(mon({ types: ['flying'], canon: { shape: 'upright' } }), W), true, 'Dragonite flies');
  assert.equal(defaultFlying(mon({ canon: { abilities: ['levitate'], shape: 'ball' } }), W), true);
  assert.equal(defaultFlying(mon({ canon: { shape: 'bug-wings' } }), W), true);
  assert.equal(defaultFlying(mon({ types: ['ghost'], canon: { shape: 'arms' } }), W), true);
  assert.equal(defaultFlying(mon({ types: ['ghost'], canon: { shape: 'upright' } }), W), false, 'Gengar walks');
});

test('the thresholds are rules: a different rules.wildRole gives a different role', () => {
  const r = deepMerge(defaultRules, { wildRole: { chargerSpeed: 40 } } as never) as Rules;
  assert.equal(defaultRole(mon(), defaultRules).behaviour, 'chase');
  assert.equal(defaultRole(mon(), r).behaviour, 'charger');
});

test('the roster: hand roles always win; every entry without a behaviour takes the rule', () => {
  for (const sp of SPECIES.filter((s) => s.wild)) {
    const entry = roster.wild[sp.id];
    assert.ok(entry, sp.id);
    if (entry.behaviour) {
      assert.equal(sp.behaviour, entry.behaviour, `${sp.id}: the hand role`);
      assert.equal(sp.roleFrom, undefined, sp.id);
    } else {
      const want = defaultRole(sp, defaultRules);
      assert.equal(sp.behaviour, want.behaviour, `${sp.id}: ${want.why}`);
      assert.equal(sp.roleFrom, 'rule', sp.id);
      if ('flying' in entry) assert.equal(!!sp.flying, entry.flying, `${sp.id}: the entry's flying wins`);
      else assert.equal(!!sp.flying, want.flying, `${sp.id}: flying from the rule`);
      assert.equal(sp.shot, undefined, `${sp.id}: a ranged rule role fires its primary element`);
    }
  }
  // the counts of 2026-11-18 (docs/size-extremes-plan.md §S2)
  const rule = SPECIES.filter((s) => s.roleFrom === 'rule');
  const count: Record<string, number> = {};
  for (const s of rule) count[s.behaviour!] = (count[s.behaviour!] ?? 0) + 1;
  assert.deepEqual(count, { charger: 40, ranged: 51, chase: 33, tank: 32, healer: 6, swarm: 2 }); // + Tauros (charger), Mewtwo (ranged)
  assert.equal(rule.filter((s) => s.flying).length, 39);
  assert.equal(SPECIES_BY_ID.dodrio.flying, undefined, 'Dodrio runs');
});

test('recruitable: false holds a species out of the squad, with a reason', () => {
  assert.deepEqual(Object.keys(SPECIES_OVERRIDES).filter((id) => !isRecruitable(id)).sort(), ['eternatus', 'shedinja', 'stakataka']);
  for (const id of ['eternatus', 'shedinja', 'stakataka']) assert.ok(SPECIES_OVERRIDES[id].recruitableReason, id);
  assert.ok(isRecruitable('wailord') && isRecruitable('rattata'));
  assert.equal(unrecruitableReason('rattata'), null);
  assert.match(unrecruitableReason('eternatus')!, /lens/, 'the developer roster shows the reason');
  assert.deepEqual(validateProfiles(), []);
  SPECIES_OVERRIDES.__x = { recruitable: false };
  try { assert.ok(validateProfiles().some((m) => m.includes('needs a recruitableReason'))); } finally { delete SPECIES_OVERRIDES.__x; }
});
