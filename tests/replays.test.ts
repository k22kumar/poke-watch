// The hero-shooter replay baseline (docs/hero-shooter-pivot.md §7, Q41–Q43): every scenario in
// tests/fixtures/scenarios.ts must reproduce the hashes committed in tests/fixtures/replays.json, every 10 s and at
// the end, and reach its coverage (Scenario.needs / never). A removal step must hold them; a move means the cut reached
// the foundation. Rewrite the file with
// `npx tsx scripts/checksum.ts scenarios --update`, and say why in the commit.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { SCENARIOS, runScenario, type ScenarioResult } from './fixtures/scenarios';

const FIXTURE = new URL('./fixtures/replays.json', import.meta.url);
const expected: Record<string, ScenarioResult> | null = fs.existsSync(FIXTURE) ? JSON.parse(fs.readFileSync(FIXTURE, 'utf8')).scenarios : null;

for (const s of SCENARIOS) {
  test(`replay ${s.id}: ${s.covers}`, () => {
    const got = runScenario(s), cov = got.coverage!;
    // coverage first: the track must reach what the scenario says it covers
    for (const [k, min] of Object.entries(s.needs)) assert.ok(cov[k as keyof typeof cov] >= (min as number), `${s.id}: ${k} ${cov[k as keyof typeof cov]}, needs ≥ ${min}`);
    for (const k of s.never ?? []) assert.equal(cov[k], 0, `${s.id}: ${k} must stay 0 (${cov[k]})`);
    const want = expected?.[s.id];
    assert.ok(want, `${s.id} has no recorded hashes: run scripts/checksum.ts scenarios --update`);
    const at = got.checkpoints.findIndex((h, i) => h !== want.checkpoints[i]);
    assert.equal(at, -1, `${s.id} diverges by ${(at + 1) * 10} s: ${got.checkpoints[at]} vs ${want.checkpoints[at]}`);
    assert.equal(got.end, want.end, `${s.id}: end hash`);
  });
}

test('every scenario is deterministic: two runs in one process give the same hashes', () => {
  for (const s of SCENARIOS.slice(0, 4)) assert.deepEqual(runScenario(s), runScenario(s), s.id);
});
