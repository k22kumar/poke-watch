// The gate runner (task GR, docs/tasks/GR.md): runs a profile's gates in parallel processes, capped by the CPU count,
// then the perf gates alone, one at a time, so their timings stay clean.
//   npx tsx scripts/gates.ts --profile <base|movement|nav|world|render|hazards|full> [--jobs N] [--no-ref] [--base <commit>]
//                            [--python <path>] [--list]
// Prints a table and writes the JSON summary .gates/<commit>-<profile>.json (schema: scripts/lib/gaterun.ts checkSummary;
// <commit> is HEAD's short hash, with "-dirty" when the checkout has changes), each gate's log under
// .gates/<commit>-<profile>/logs/. Exits 1 when a gate failed. A gate whose script a later task writes is listed "not built
// yet"; a browser gate with no browser to drive is "skipped": neither is a pass (the summary's `complete` is false).
// The gates and profiles are data: scripts/lib/gateprofiles.ts.
//   --jobs N       CPU slots for the parallel phase (default: os.availableParallelism())
//   --no-ref       skip the flag-off references
//   --base <c>     the main commit the references are taken on (default: git merge-base HEAD main)
//   --python <p>   the Python of tests/browser/*.py (default: $GATES_PYTHON, else .venv/bin/python)
//   --list         print the profile's commands, one per line, and exit
// Flag-off references (a gate's `reference`): the gate's flag-off command, run once per base commit in a clean snapshot of
// that commit (.gates/ref/<commit>/tree, git archive plus a link to node_modules), cached under .gates/ref/<commit>/; the
// gate's run is compared with it as a diagnostic, never a pass or a fail.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { GATES, PROFILE_NAMES, type GateDef, type ProfileName } from './lib/gateprofiles';
import {
  COMPARES, JUDGES, browserMissing, checkSummary, fill, git, planProfile, refPaths, schedule, shellLine, snapshot, summarize,
  type Ctx, type GateResult, type Job, type RefResult, type Summary,
} from './lib/gaterun';

const argv = process.argv.slice(2);
const opt = (k: string) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : undefined; };
const profile = opt('--profile') as ProfileName | undefined;
if (!profile || !PROFILE_NAMES.includes(profile)) {
  console.error(`usage: npx tsx scripts/gates.ts --profile <${PROFILE_NAMES.join('|')}> [--jobs N] [--no-ref] [--base <commit>] [--python <path>] [--list]`);
  process.exit(2);
}
const root = path.resolve(import.meta.dirname, '..');
const cap = Math.max(1, Number(opt('--jobs') ?? os.availableParallelism()));
const head = git(root, 'rev-parse', '--short=12', 'HEAD') ?? 'nocommit';
const dirty = (git(root, 'status', '--porcelain') ?? '') !== '';
const name = `${head}${dirty ? '-dirty' : ''}-${profile}`;
const runDir = path.join(root, '.gates', name);
const ctx: Ctx = { root, run: runDir, build: path.join(runDir, 'build'), python: opt('--python') ?? process.env.GATES_PYTHON ?? path.join(root, '.venv', 'bin', 'python') };
const plan = planProfile(profile);

if (argv.includes('--list')) {
  for (const g of plan) console.log(`${g.id.padEnd(18)} ${g.notBuilt ? `(not built yet: ${g.notBuilt}) ` : ''}${g.alone ? '(alone) ' : ''}${shellLine(fill(g.run, ctx))}`);
  process.exit(0);
}

const t0 = performance.now(), startedAt = new Date().toISOString();
fs.rmSync(runDir, { recursive: true, force: true });
fs.mkdirSync(path.join(runDir, 'logs'), { recursive: true });
const rel = (p: string) => path.relative(root, p);
const clock = () => new Date().toTimeString().slice(0, 8);

// ---- the references this profile needs, and whether each is cached
const noRef = argv.includes('--no-ref');
const base = noRef ? null : (opt('--base') ? git(root, 'rev-parse', '--short=12', opt('--base')!) : (() => { const m = git(root, 'merge-base', 'HEAD', 'main'); return m ? m.slice(0, 12) : null; })());
const refs: RefResult[] = [];
const refJobs: Job[] = [];
let tree: string | null = null;
for (const g of plan) {
  const r = g.reference;
  if (!r || g.notBuilt) continue;
  if (!base) { refs.push({ id: r.id, gate: g.id, commit: '', cached: false, status: 'skipped', note: noRef ? '--no-ref' : 'no merge base with main', result: null, log: null }); continue; }
  const P = refPaths(root, base, r);
  if (fs.existsSync(P.meta)) { refs.push({ id: r.id, gate: g.id, commit: base, cached: true, status: 'ok', note: 'cached', result: rel(P.result), log: rel(P.log) }); continue; }
  tree ??= snapshot(root, base);
  if (!tree) { refs.push({ id: r.id, gate: g.id, commit: base, cached: false, status: 'failed', note: `could not snapshot ${base}`, result: null, log: null }); continue; }
  refs.push({ id: r.id, gate: g.id, commit: base, cached: false, status: 'skipped', note: 'not run', result: rel(P.result), log: rel(P.log) });
  refJobs.push({ key: `ref:${r.id}`, argv: fill(r.run, { ...ctx, root: tree }, P.result), cwd: tree, log: P.log, slots: g.slots ?? 1, alone: !!r.alone, est: g.est ?? 60, after: [] });
}

// ---- the gates
const results = new Map<string, GateResult>();
const missing = new Map<string, string>();
for (const g of plan) {
  const cmd = shellLine(fill(g.run, ctx));
  const row = { id: g.id, what: g.what, cmd, script: g.script ?? null, exit: null, wallSec: null, log: null };
  if (g.notBuilt) { results.set(g.id, { ...row, status: 'not built yet', note: g.notBuilt }); continue; }
  // a script that should exist and does not is a failure (tests/gates.test.ts catches it first)
  if (g.script && !fs.existsSync(path.join(root, g.script))) { results.set(g.id, { ...row, status: 'fail', note: `${g.script} does not exist` }); continue; }
  if (g.browser) {
    const why = browserMissing(g.browser, root, ctx.python);
    if (why) { results.set(g.id, { ...row, status: 'skipped', note: `no browser: ${why}` }); continue; }
  }
}
const gateJobs: Job[] = plan.filter((g) => !results.has(g.id)).map((g) => ({
  key: g.id, argv: fill(g.run, ctx), cwd: root, log: path.join(runDir, 'logs', `${g.id}.log`), slots: g.slots ?? 1, alone: !!g.alone, est: g.est ?? 60,
  after: g.needs ?? [],
}));
// alone order: the references first (they warm nothing the gate reads: separate processes), then the gates in profile order
const jobs = [...refJobs, ...gateJobs];
const alone = jobs.filter((j) => j.alone).map((j) => j.key);

console.log(`gates: profile ${profile} at ${head}${dirty ? ' (dirty)' : ''}, ${plan.length} gates, ${cap} CPU slots${refJobs.length ? `, ${refJobs.length} reference run(s) on ${base}` : ''}${alone.length ? `; alone at the end: ${alone.join(', ')}` : ''}`);
for (const [id, r] of results) console.log(`${clock()}  ${r.status.padEnd(13)} ${id}: ${r.note}`);

const gateOf = (key: string): GateDef | undefined => GATES[key];
await schedule(jobs, cap, {
  start: (j) => console.log(`${clock()}  start         ${j.key}`),
  skip: (j) => {
    const g = gateOf(j.key);
    const bad = j.after.find((k) => results.get(k)?.status !== 'pass');
    if (!g || !bad) return false;
    results.set(g.id, { id: g.id, what: g.what, cmd: shellLine(j.argv), script: g.script ?? null, exit: null, wallSec: null, log: null, status: 'skipped', note: `needs ${bad}, which did not pass` });
    console.log(`${clock()}  skipped       ${g.id}: needs ${bad}`);
    return true;
  },
  end: (j) => {
    const d = j.done!, out = fs.readFileSync(j.log, 'utf8');
    if (j.key.startsWith('ref:')) {
      const r = refs.find((x) => `ref:${x.id}` === j.key)!;
      const def = plan.find((g) => g.reference?.id === r.id)!.reference!, P = refPaths(root, base!, def);
      const ok = d.exit === 0 && fs.existsSync(P.result);
      r.status = ok ? 'ok' : 'failed'; r.note = ok ? `ran ${d.wallSec.toFixed(0)} s` : `exit ${d.exit}${d.signal ? ` (${d.signal})` : ''}`;
      if (ok) fs.writeFileSync(P.meta, JSON.stringify({ id: r.id, commit: base, cmd: shellLine(j.argv), exit: d.exit, wallSec: d.wallSec, at: new Date().toISOString() }, null, 1) + '\n');
      console.log(`${clock()}  ${ok ? 'reference' : 'ref failed'}     ${r.id} on ${base} (${d.wallSec.toFixed(0)} s)`);
      return;
    }
    const g = gateOf(j.key)!;
    const v = JUDGES[g.judge ?? 'exit'](d.exit, out, g);
    const said = (v.note || `exit ${d.exit}`).replaceAll(root + path.sep, '');
    const note = d.signal ? `killed by ${d.signal}; ${said}` : said;
    results.set(g.id, { id: g.id, what: g.what, cmd: shellLine(j.argv), script: g.script ?? null, exit: d.exit, wallSec: Math.round(d.wallSec * 10) / 10, log: rel(j.log), status: v.ok ? 'pass' : 'fail', note });
    console.log(`${clock()}  ${(v.ok ? 'pass' : 'FAIL').padEnd(13)} ${g.id} (${d.wallSec.toFixed(1)} s) ${note}`);
  },
});

// ---- diagnostics against the references
const diagnostics: Summary['diagnostics'] = [];
for (const r of refs) {
  const g = GATES[r.gate], res = results.get(r.gate);
  if (r.status !== 'ok' || !res?.log || !g.reference) continue;
  const P = refPaths(root, r.commit, g.reference);
  const mine = g.reference.writesOut ? path.join(runDir, `${g.id}.json`) : path.join(root, res.log);
  if (!fs.existsSync(mine)) { diagnostics.push({ gate: g.id, reference: r.id, text: `no result to compare (${rel(mine)})` }); continue; }
  let text: string;
  try { text = COMPARES[g.reference.compare](fs.readFileSync(mine, 'utf8'), fs.readFileSync(P.result, 'utf8')); } catch (e) { text = `compare failed: ${(e as Error).message}`; }
  diagnostics.push({ gate: g.id, reference: `${r.id}@${r.commit}`, text });
}

const gates = plan.map((g) => results.get(g.id)!);
const summary = summarize({ profile, commit: head, dirty, base, startedAt, wallSec: Math.round((performance.now() - t0) / 100) / 10, jobs: cap }, gates, refs, diagnostics);
const problems = checkSummary(summary);
if (problems.length) throw new Error(`gates: the summary breaks its own schema: ${problems.join('; ')}`);
const file = path.join(root, '.gates', `${name}.json`);
fs.writeFileSync(file, JSON.stringify(summary, null, 1) + '\n');

// ---- the table
const w = Math.max(...gates.map((g) => g.id.length));
console.log(`\n${'gate'.padEnd(w)}  ${'status'.padEnd(13)} ${'wall s'.padStart(7)}  note`);
for (const g of gates) console.log(`${g.id.padEnd(w)}  ${g.status.padEnd(13)} ${(g.wallSec === null ? '-' : g.wallSec.toFixed(1)).padStart(7)}  ${g.note}`);
for (const r of refs) console.log(`reference ${r.id}${r.commit ? ` @ ${r.commit}` : ''}: ${r.status} (${r.note})`);
for (const d of diagnostics) console.log(`diagnostic ${d.gate}: ${d.text}`);
const c = summary.counts;
console.log(`\n${c.pass} pass, ${c.fail} fail, ${c.skipped} skipped, ${c['not built yet']} not built yet; wall ${summary.wallSec.toFixed(1)} s; summary ${rel(file)}`);
console.log(summary.ok ? (summary.complete ? 'GATES PASS' : 'GATES PASS, INCOMPLETE (skipped or not built yet: not passes)') : 'GATES FAIL');
process.exitCode = summary.ok ? 0 : 1;
