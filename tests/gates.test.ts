// The gate runner (task GR, docs/tasks/GR.md; scripts/gates.ts): its data resolves to real files, and its JSON summary
// keeps its schema. No gate is run here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { GATES, PROFILES, PROFILE_NAMES } from '../scripts/lib/gateprofiles';
import { JUDGES, checkSummary, planProfile, summarize, type GateResult } from '../scripts/lib/gaterun';

const root = path.resolve(import.meta.dirname, '..');

test('gates: every script a profile names exists, or is marked not built yet (and then does not exist)', () => {
  for (const p of PROFILE_NAMES) for (const g of planProfile(p)) {
    assert.ok(g.script, `${g.id}: names no script`);
    const there = fs.existsSync(path.join(root, g.script));
    if (g.notBuilt) assert.ok(!there, `${g.id}: ${g.script} exists now; drop its notBuilt mark`);
    else assert.ok(there, `${g.id}: ${g.script} does not exist`);
    // the command's own file arguments resolve too (fixtures, setup files, scripts)
    for (const a of g.run) if (/^(\.\/)?(scripts|tests|tools)\//.test(a) && !g.notBuilt) assert.ok(fs.existsSync(path.join(root, a)), `${g.id}: ${a} does not exist`);
  }
});

test('gates: profiles hold known gates; base is the four of npm run check plus checksum; full is every other profile', () => {
  for (const p of PROFILE_NAMES) for (const id of PROFILES[p]) assert.ok(GATES[id], `${p}: no gate ${id}`);
  assert.deepEqual(PROFILES.base, ['typecheck', 'test', 'build', 'checksum']);
  for (const p of PROFILE_NAMES) for (const id of PROFILES.base) assert.ok(PROFILES[p].includes(id), `${p} lacks base gate ${id}`);
  const others = new Set(PROFILE_NAMES.filter((p) => p !== 'full').flatMap((p) => PROFILES[p]));
  assert.deepEqual(new Set(PROFILES.full), others);
  for (const g of Object.values(GATES)) assert.ok(others.has(g.id), `${g.id} is in no profile`);
});

test('gates: under D8 every navwalk, stuckwatch and perf-sim gate runs both flags on, with its known list', () => {
  for (const g of Object.values(GATES)) {
    const s = g.run.join(' ');
    if (!/navwalk|stuckwatch|perf-sim/.test(s)) continue;
    assert.match(s, /--physics rapier --nav navmesh/, g.id);
    if (/navwalk/.test(s)) assert.match(s, /--known tests\/fixtures\/navwalk-known\.json/, g.id);
    if (/stuckwatch/.test(s)) assert.match(s, /--known tests\/fixtures\/stuckwatch-known\.json/, g.id);
    if (/perf-sim/.test(s)) { assert.ok(g.alone, `${g.id} must run alone`); assert.match(s, /--gate/, g.id); }
    if (g.reference) assert.doesNotMatch(g.reference.run.join(' '), /--physics rapier/, `${g.id}: its reference is flag-off`);
  }
  for (const g of Object.values(GATES)) if (g.browser) assert.ok(g.needs?.includes('build'), `${g.id}: a browser gate needs the build`);
});

const row = (id: string, status: GateResult['status'], exit: number | null): GateResult => ({ id, status, what: id, cmd: id, script: null, exit, wallSec: exit === null ? null : 1, note: '', log: exit === null ? null : `.gates/x/logs/${id}.log` });
const head = { profile: 'base', commit: 'abc', dirty: false, base: 'abc', startedAt: '2026-11-27T00:00:00.000Z', wallSec: 1, jobs: 4 };

test('gates: the JSON summary keeps its schema; skipped and not built yet are never passes', () => {
  const s = summarize(head, [row('a', 'pass', 0), row('b', 'skipped', null), row('c', 'not built yet', null)], [{ id: 'r', gate: 'a', commit: 'abc', cached: true, status: 'ok', note: 'cached', result: 'x.json', log: 'x.log' }], [{ gate: 'a', reference: 'r@abc', text: 't' }]);
  assert.deepEqual(checkSummary(s), []);
  assert.equal(s.schema, 'gates/1');
  assert.deepEqual(s.counts, { pass: 1, fail: 0, skipped: 1, 'not built yet': 1 });
  assert.equal(s.ok, true);
  assert.equal(s.complete, false, 'a skipped or not-built gate leaves the run incomplete');
  // a JSON round trip keeps it valid
  assert.deepEqual(checkSummary(JSON.parse(JSON.stringify(s))), []);
  const f = summarize(head, [row('a', 'pass', 0), row('d', 'fail', 1)]);
  assert.equal(f.ok, false);
  assert.deepEqual(checkSummary(f), []);
  // what the check refuses
  const bad = (edit: (o: Record<string, any>) => void) => { const o = JSON.parse(JSON.stringify(s)); edit(o); return checkSummary(o); };
  assert.ok(bad((o) => { o.schema = 'gates/0'; }).length);
  assert.ok(bad((o) => { o.gates[1].status = 'passed'; }).length);
  assert.ok(bad((o) => { o.gates[1].status = 'pass'; }).length, 'a pass that never ran');
  assert.ok(bad((o) => { o.gates[1].exit = 0; }).length, 'a skipped gate that ran');
  assert.ok(bad((o) => { o.counts.pass = 3; }).length);
  assert.ok(bad((o) => { o.complete = true; }).length);
  assert.ok(bad((o) => { o.ok = false; }).length);
  assert.ok(bad((o) => { delete o.commit; }).length);
  assert.ok(bad((o) => { o.references[0].status = 'cached'; }).length);
});

test('gates: the judges read what the gates print', () => {
  const g = GATES.checksum;
  const line = (id: string, tail: string) => `${id.padEnd(18)} a b end=deadbeef ${tail}\n${''.padEnd(18)} hits=3\n`;
  assert.equal(JUDGES.checksum(0, line('one', '(as recorded)') + line('two', '(as recorded)'), g).ok, true);
  assert.equal(JUDGES.checksum(0, line('one', '(as recorded)') + line('two', '(as recorded)'), g).note, '2 of 2 as recorded');
  assert.equal(JUDGES.checksum(0, line('one', '(as recorded)') + line('two', 'MOVED'), g).ok, false);
  assert.equal(JUDGES.checksum(0, line('one', '(not recorded)'), g).ok, false);
  assert.equal(JUDGES.checksum(0, '', g).ok, false, 'no scenario ran');
  const hp = (ok: number, total: number) => `\n${ok}/${total} spawn → objective → retreat runs completed (raid party live, trainer invulnerable: pass = raiders reached the point)\n`;
  assert.equal(JUDGES.habplay(0, hp(12, 12), GATES['habplay-raid']).ok, true);
  assert.equal(JUDGES.habplay(0, hp(11, 12), GATES['habplay-raid']).ok, false);
  assert.equal(JUDGES.habplay(0, hp(0, 0), GATES['habplay-raid']).ok, false, '`all --raid` runs no case and exits 0');
  const nt = (fail: number) => `ℹ tests 10\nℹ suites 0\nℹ pass ${10 - fail}\nℹ fail ${fail}\nℹ cancelled 0\nℹ skipped 0\nℹ todo 1\n`;
  assert.equal(JUDGES.nodeTest(0, nt(0), GATES.test).ok, true);
  assert.equal(JUDGES.nodeTest(0, nt(0), GATES.test).note, '10 tests, 10 pass, 0 fail, 1 todo');
  assert.equal(JUDGES.nodeTest(1, nt(1), GATES.test).ok, false);
  assert.equal(JUDGES.nodeTest(0, 'no counts', GATES.test).ok, false);
  assert.equal(JUDGES.okLines(0, 'ok   a\nok   b\n', GATES['three-signal']).note, '2 of 2 ok');
  assert.equal(JUDGES.okLines(1, 'ok   a\nFAIL b\n', GATES['three-signal']).ok, false);
  assert.equal(JUDGES.exit(0, 'x\nknown-failure gate: 2 known, 0 new or different: PASS\n', GATES['navwalk-3d']).note, 'known-failure gate: 2 known, 0 new or different: PASS');
  assert.equal(JUDGES.exit(1, '', GATES['navwalk-3d']).ok, false);
});
