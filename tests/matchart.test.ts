// A match starts only when its art has loaded (docs/ROADMAP.md "Item 3: A1 plan"): the set the browser loads is
// matchArt(ctx, mode) (src/sim/matchart.ts), read right after createRun. Every replay scenario is played here and every
// species that appears on the field (a target, a raider, a squad member, a Breakthrough's next form) must be in it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import ART from '../src/content/art.json';
import { matchArt, wholeLine } from '../src/sim/matchart';
import { SPECIES_BY_ID } from '../src/rules/species';
import { PROTOTYPE } from '../src/rules/heroes';
import { HOLD } from '../src/mods';
import { RAID_PARTY } from '../src/sim/modes/hold';
import { SCENARIOS, runScenario } from './fixtures/scenarios';

const ART_IDS = new Set(Object.keys((ART as unknown as { species: Record<string, unknown> }).species));

test('wholeLine: base to last form, from any form', () => {
  for (const id of ['caterpie', 'metapod', 'butterfree']) assert.deepEqual(wholeLine(SPECIES_BY_ID[id]).map((s) => s.id), ['caterpie', 'metapod', 'butterfree']);
  assert.deepEqual(wholeLine(SPECIES_BY_ID.tauros).map((s) => s.id), ['tauros']);
});

test('the Hold mode shows its whole Raid party', () => {
  const shows = new Set(HOLD.mods!.flatMap((m) => m.shows ?? []));
  for (const g of RAID_PARTY) for (const id of g.species) assert.ok(shows.has(id), id);
});

test('every hero line and every species a mode can show has art', () => {
  for (const id of PROTOTYPE) for (const s of wholeLine(SPECIES_BY_ID[id])) assert.ok(ART_IDS.has(s.id), `${s.id} (line of ${id})`);
  for (const g of RAID_PARTY) for (const id of g.species) assert.ok(ART_IDS.has(id), id);
});

for (const sc of SCENARIOS) {
  test(`matchArt covers everything ${sc.id} shows`, () => {
    let set: Set<string> | null = null;
    const seen = new Set<string>();
    runScenario(sc, (ctx) => {
      set ??= new Set(matchArt(ctx, sc.mode));
      for (const m of ctx.player.squad) seen.add(m.species.id);
      const E = ctx.enemies;
      for (let i = 0; i < E.hi; i++) if (E.alive[i]) seen.add(ctx.speciesIndex[E.species[i]].id);
    });
    const missing = [...seen].filter((id) => !set!.has(id));
    assert.deepEqual(missing, [], `shown but not loaded before the match: ${missing.join(', ')}`);
  });
}
