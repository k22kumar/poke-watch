// The art loader's retry rule (src/assets/loader.ts, docs/ROADMAP.md "Item 3: A1 plan"): a species whose fetch failed
// is tried again on the next ensure() (a match start, a hero pick), not on every first sight, and not left missing for
// the session. The network and decode step is faked; the loader's bookkeeping is the real one.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ArtLoader, type ArtManifest, type ArtManifestEntry } from '../src/assets/loader';
import type { CreatureArt } from '../src/assets/art';

const entry: ArtManifestEntry = { atlas: 'a.png', frames: 'a.json', art: { source: 'test', credits: [] }, clips: {}, notes: [] };
const manifest = (ids: string[]): ArtManifest => ({ generated: '', licenses: [], heroes: { file: '', cells: {} }, species: Object.fromEntries(ids.map((id) => [id, entry])) });

/** a loader whose fetch fails `fails[id]` times before it succeeds; counts calls per species */
function fake(fails: Record<string, number>) {
  const calls: Record<string, number> = {};
  const L = new ArtLoader(async (_base, id) => {
    calls[id] = (calls[id] ?? 0) + 1;
    if ((fails[id] ?? 0) >= calls[id]) throw new Error('dropped');
    return { id } as unknown as CreatureArt;
  });
  L.manifest = manifest(['rattata', 'snorlax']);
  const arrived: string[] = [];
  L.onArt = (id) => arrived.push(id);
  return { L, calls, arrived };
}

test('a failed species is retried on the next ensure() and then arrives', async (t) => {
  t.mock.method(console, 'warn', () => {});
  const { L, calls, arrived } = fake({ rattata: 1 });
  await L.ensure(['rattata', 'snorlax']);
  assert.ok(L.failed.has('rattata') && !L.isLoaded('rattata'));
  assert.ok(L.isLoaded('snorlax'));
  // first sight does not retry it
  L.request('rattata');
  assert.equal(L.loading, false);
  assert.equal(calls.rattata, 1);
  // the next match's ensure does, once
  await L.ensure(['rattata', 'snorlax']);
  assert.equal(calls.rattata, 2);
  assert.equal(calls.snorlax, 1, 'a loaded species is not fetched again');
  assert.ok(L.isLoaded('rattata') && !L.failed.has('rattata'));
  assert.deepEqual(arrived.sort(), ['rattata', 'snorlax']);
});

test('ensure() retries once per call, not in a loop', async (t) => {
  t.mock.method(console, 'warn', () => {});
  const { L, calls } = fake({ rattata: 99 });
  await L.ensure(['rattata']);
  await L.ensure(['rattata']);
  assert.equal(calls.rattata, 2);
  assert.ok(L.failed.has('rattata'));
});

test('concurrent ensure() calls share one fetch', async () => {
  const { L, calls } = fake({});
  await Promise.all([L.ensure(['rattata']), L.ensure(['rattata']), L.ensure(['rattata', 'snorlax'])]);
  assert.deepEqual(calls, { rattata: 1, snorlax: 1 });
});
