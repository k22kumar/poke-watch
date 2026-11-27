// The gate runner's core (task GR, docs/tasks/GR.md): the judges that read a gate's result, the scheduler that runs a
// profile's gates in parallel processes (perf-sim alone at the end), the flag-off references cached per main commit, and
// the JSON summary with its schema check. scripts/gates.ts is the command line; scripts/lib/gateprofiles.ts the data.
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { GATES, PROFILES, type CompareName, type GateDef, type JudgeName, type ProfileName, type ReferenceDef } from './gateprofiles';

export type Status = 'pass' | 'fail' | 'skipped' | 'not built yet';
export const STATUSES: Status[] = ['pass', 'fail', 'skipped', 'not built yet'];

export interface Verdict { ok: boolean; note: string }

// ---------------------------------------------------------------- judges

const lastMatch = (out: string, src: string) => { const all = [...out.matchAll(new RegExp(src, 'gm'))]; return all.length ? all[all.length - 1][0].trim() : null; };
const notes = (out: string, srcs: string[] = []) => srcs.map((s) => lastMatch(out, s)).filter((s): s is string => !!s).join('; ');

/** Read a gate's result from its exit code and output. Each judge only reads what the gate prints; none changes it. */
export const JUDGES: Record<JudgeName, (code: number | null, out: string, g: GateDef) => Verdict> = {
  /** the gate's exit code decides */
  exit: (code, out, g) => ({ ok: code === 0, note: notes(out, g.note) }),
  /** a node:test run: its exit code, and the counts it prints at the end (spec ℹ or TAP #) */
  nodeTest: (code, out) => {
    const n = (k: string) => { const m = lastMatch(out, `^(?:ℹ|#) ${k} \\d+$`); return m ? Number(m.split(' ')[2]) : null; };
    const tests = n('tests'), pass = n('pass'), fail = n('fail'), todo = n('todo'), skip = n('skipped'), cancelled = n('cancelled');
    const note = tests === null ? 'no test counts printed' : `${tests} tests, ${pass} pass, ${fail} fail${todo ? `, ${todo} todo` : ''}${skip ? `, ${skip} skipped` : ''}${cancelled ? `, ${cancelled} cancelled` : ''}`;
    return { ok: code === 0 && tests !== null && tests > 0 && fail === 0 && !cancelled, note };
  },
  /** checksum.ts exits 0 whatever it prints: every scenario line must say "(as recorded)" */
  checksum: (code, out) => {
    const rows = [...out.matchAll(/^(\S+)\s.* end=\S+ (\(as recorded\)|MOVED|\(not recorded\))$/gm)];
    const same = rows.filter((r) => r[2] === '(as recorded)').length, other = rows.filter((r) => r[2] !== '(as recorded)');
    return { ok: code === 0 && rows.length > 0 && !other.length, note: `${same} of ${rows.length} as recorded${other.length ? `; ${other.map((r) => `${r[1]} ${r[2]}`).join(', ')}` : ''}` };
  },
  /** navhash.ts --check exits 1 on a moved hash; the note counts its rows */
  navhash: (code, out) => {
    const rows = [...out.matchAll(/^HASH (\S+)\s+\S+ (.*?)  polygons/gm)], same = rows.filter((r) => r[2] === '(as recorded)').length;
    return { ok: code === 0 && rows.length > 0, note: `${same} of ${rows.length} as recorded${same < rows.length ? `; ${rows.filter((r) => r[2] !== '(as recorded)').map((r) => `${r[1]} ${r[2]}`).join(', ')}` : ''}` };
  },
  /** habplay.ts sets no exit code: every run must complete, and there must be runs (`all --raid` alone runs none) */
  habplay: (code, out) => {
    const m = lastMatch(out, '^\\d+/\\d+ spawn → objective → retreat runs completed.*$');
    const [ok, total] = m ? m.split(' ')[0].split('/').map(Number) : [0, 0];
    return { ok: code === 0 && total > 0 && ok === total, note: m ?? 'no summary line printed' };
  },
  /** a check that prints one "ok" or "FAIL" line per case and exits 1 on a failure (three-signal.mjs) */
  okLines: (code, out) => {
    const ok = (out.match(/^ok\s/gm) ?? []).length, bad = (out.match(/^FAIL\s/gm) ?? []).length;
    return { ok: code === 0 && ok + bad > 0 && bad === 0, note: `${ok} of ${ok + bad} ok` };
  },
};

// ---------------------------------------------------------------- reference comparisons (diagnostics only)

interface TrapRec { map: string; seed: number; species: string; tick: number; tile: [number, number] }
interface TrapFile { setting: { physics: string; nav: string; maps: string; seeds: number; seconds: number; first: number }; trapped: TrapRec[] }

/** perf-sim's min-of-N tick line: p95 and p99 (ms) */
export function perfLine(out: string): { p95: number; p99: number } | null {
  const m = lastMatch(out, '^min of \\d+: .*$') ?? lastMatch(out, '^p50 .*$');
  if (!m) return null;
  const p95 = /p95 ([\d.]+)/.exec(m), p99 = /p99 ([\d.]+)/.exec(m);
  return p95 && p99 ? { p95: Number(p95[1]), p99: Number(p99[1]) } : null;
}

/** Compare a gate's run with its reference. `run` and `ref` are the gate's and the reference's results: the files they
 *  wrote (stuckwatch --save) or their logs. Returns one line; never decides a pass. */
export const COMPARES: Record<CompareName, (run: string, ref: string) => string> = {
  /** stuckwatch's --compare identity (map, seed, species, window tick, tile), run against the physics-off reference */
  stuckwatchTraps: (run, ref) => {
    const A = JSON.parse(run) as TrapFile, B = JSON.parse(ref) as TrapFile, a = A.setting, b = B.setting;
    if (a.nav !== b.nav || a.maps !== b.maps || a.seeds !== b.seeds || a.seconds !== b.seconds || a.first !== b.first) return `not comparable: run ${JSON.stringify(a)}, reference ${JSON.stringify(b)}`;
    const id = (t: TrapRec) => `${t.map} seed ${t.seed} ${t.species} tick ${t.tick} tile ${t.tile[0]},${t.tile[1]}`;
    const have = new Set(B.trapped.map(id)), here = new Set(A.trapped.map(id));
    const fresh = A.trapped.filter((t) => !have.has(id(t))), gone = B.trapped.filter((t) => !here.has(id(t)));
    return `TRAPPED by identity against physics ${b.physics}, nav ${b.nav}: ${A.trapped.length - fresh.length} matched, ${fresh.length} new, ${gone.length} gone${fresh.length ? ` (new: ${fresh.map(id).join('; ')})` : ''}`;
  },
  perfSim: (run, ref) => {
    const a = perfLine(run), b = perfLine(ref);
    return a && b ? `p95 ${a.p95.toFixed(3)} / p99 ${a.p99.toFixed(3)} ms against the flags-off reference ${b.p95.toFixed(3)} / ${b.p99.toFixed(3)} ms` : 'no percentiles to compare';
  },
};

// ---------------------------------------------------------------- the summary

export interface GateResult {
  id: string; status: Status; what: string; cmd: string; script: string | null;
  exit: number | null; wallSec: number | null; note: string; log: string | null;
}
export interface RefResult { id: string; gate: string; commit: string; cached: boolean; status: 'ok' | 'failed' | 'skipped'; note: string; result: string | null; log: string | null }
export interface Summary {
  schema: 'gates/1';
  profile: string; commit: string; dirty: boolean; base: string | null;
  startedAt: string; wallSec: number; jobs: number;
  ok: boolean; complete: boolean;
  counts: Record<Status, number>;
  gates: GateResult[];
  references: RefResult[];
  diagnostics: { gate: string; reference: string; text: string }[];
}

export function summarize(head: Omit<Summary, 'schema' | 'ok' | 'complete' | 'counts' | 'gates' | 'references' | 'diagnostics'>, gates: GateResult[], references: RefResult[] = [], diagnostics: Summary['diagnostics'] = []): Summary {
  const counts = Object.fromEntries(STATUSES.map((s) => [s, gates.filter((g) => g.status === s).length])) as Record<Status, number>;
  return { schema: 'gates/1', ...head, ok: counts.fail === 0, complete: counts.pass === gates.length, counts, gates, references, diagnostics };
}

/** The summary's schema, checked field by field. Returns the problems (none: valid). */
export function checkSummary(s: unknown): string[] {
  const bad: string[] = [];
  const o = s as Record<string, unknown>;
  if (!o || typeof o !== 'object') return ['not an object'];
  const want = (obj: Record<string, unknown>, where: string, k: string, t: 'string' | 'number' | 'boolean' | 'array' | 'object', nullable = false) => {
    const v = obj[k];
    if (v === null && nullable) return;
    const ok = t === 'array' ? Array.isArray(v) : t === 'object' ? !!v && typeof v === 'object' && !Array.isArray(v) : typeof v === t;
    if (!ok) bad.push(`${where}${k}: want ${t}${nullable ? ' or null' : ''}, got ${JSON.stringify(v)}`);
  };
  if (o.schema !== 'gates/1') bad.push(`schema: want "gates/1", got ${JSON.stringify(o.schema)}`);
  for (const k of ['profile', 'commit', 'startedAt']) want(o, '', k, 'string');
  want(o, '', 'base', 'string', true);
  for (const k of ['wallSec', 'jobs']) want(o, '', k, 'number');
  for (const k of ['dirty', 'ok', 'complete']) want(o, '', k, 'boolean');
  want(o, '', 'counts', 'object'); want(o, '', 'gates', 'array'); want(o, '', 'references', 'array'); want(o, '', 'diagnostics', 'array');
  if (bad.length) return bad;
  const gates = o.gates as Record<string, unknown>[], counts = o.counts as Record<string, unknown>;
  for (const st of STATUSES) if (typeof counts[st] !== 'number') bad.push(`counts.${st}: want number`);
  for (const k of Object.keys(counts)) if (!STATUSES.includes(k as Status)) bad.push(`counts.${k}: not a status`);
  gates.forEach((g, i) => {
    const w = `gates[${i}].`;
    for (const k of ['id', 'what', 'cmd', 'note']) want(g, w, k, 'string');
    for (const k of ['script', 'log']) want(g, w, k, 'string', true);
    for (const k of ['exit', 'wallSec']) want(g, w, k, 'number', true);
    if (!STATUSES.includes(g.status as Status)) bad.push(`${w}status: ${JSON.stringify(g.status)} is not one of ${STATUSES.join(', ')}`);
    if (g.status === 'pass' && g.exit !== 0) bad.push(`${w}status pass with exit ${g.exit}`);
    if ((g.status === 'skipped' || g.status === 'not built yet') && g.exit !== null) bad.push(`${w}status ${g.status} but it ran (exit ${g.exit})`);
  });
  for (const st of STATUSES) if (gates.filter((g) => g.status === st).length !== counts[st]) bad.push(`counts.${st} does not match the gates`);
  if (o.ok !== (counts.fail === 0)) bad.push('ok: must be true exactly when no gate failed');
  if (o.complete !== (counts.pass === gates.length)) bad.push('complete: must be true exactly when every gate passed');
  (o.references as Record<string, unknown>[]).forEach((r, i) => {
    const w = `references[${i}].`;
    for (const k of ['id', 'gate', 'commit', 'note']) want(r, w, k, 'string');
    want(r, w, 'cached', 'boolean');
    for (const k of ['result', 'log']) want(r, w, k, 'string', true);
    if (!['ok', 'failed', 'skipped'].includes(r.status as string)) bad.push(`${w}status: ${JSON.stringify(r.status)}`);
  });
  (o.diagnostics as Record<string, unknown>[]).forEach((d, i) => { for (const k of ['gate', 'reference', 'text']) want(d, `diagnostics[${i}].`, k, 'string'); });
  return bad;
}

// ---------------------------------------------------------------- planning

/** A profile's gates with their needs pulled in, in profile order (a need before the gate that needs it). */
export function planProfile(profile: ProfileName): GateDef[] {
  const out: GateDef[] = [], seen = new Set<string>();
  const add = (id: string) => {
    if (seen.has(id)) return;
    const g = GATES[id];
    if (!g) throw new Error(`profile ${profile}: no gate ${id}`);
    seen.add(id);
    for (const n of g.needs ?? []) add(n);
    out.push(g);
  };
  for (const id of PROFILES[profile]) add(id);
  return out;
}

export interface Ctx { root: string; run: string; build: string; python: string }
export const fill = (argv: string[], c: Ctx, out = '') => argv.map((a) => a.replace(/\{(root|run|build|python|out)\}/g, (_, k: string) => (k === 'out' ? out : c[k as keyof Ctx])));
export const shellLine = (argv: string[]) => argv.map((a) => (/^[\w./:=@%+,-]+$/.test(a) ? a : `'${a.replace(/'/g, `'\\''`)}'`)).join(' ');

// ---------------------------------------------------------------- browsers

/** Can this checkout drive a browser for a gate? Returns why not, or null. */
export function browserMissing(kind: 'node' | 'python', root: string, python: string): string | null {
  if (kind === 'node') {
    let pw: string;
    try { pw = createRequire(path.join(root, 'package.json')).resolve('playwright'); } catch { return 'the Node playwright package is not installed (npm i --no-save playwright)'; }
    const r = spawnSync(process.execPath, ['-e', `const p=require(${JSON.stringify(pw)});process.stdout.write(p.chromium.executablePath())`], { encoding: 'utf8' });
    if (r.status !== 0 || !r.stdout || !fs.existsSync(r.stdout)) return 'playwright\'s Chromium is not downloaded (npx playwright install chromium)';
    return null;
  }
  if (!fs.existsSync(python)) return `no Python at ${python} (tools/README.md "Python checks"; or --python <path>)`;
  const r = spawnSync(python, ['-I', '-c', 'import playwright.sync_api'], { encoding: 'utf8' });
  if (r.status !== 0) return `${python} has no playwright package (tests/browser/requirements.txt)`;
  return null;
}

// ---------------------------------------------------------------- running

export interface Job {
  key: string; argv: string[]; cwd: string; log: string; slots: number; alone: boolean; est: number;
  after: string[];
  done?: { exit: number | null; wallSec: number; signal: string | null };
}

const children = new Set<ReturnType<typeof spawn>>();
process.on('SIGINT', () => { for (const c of children) c.kill('SIGTERM'); process.exit(130); });

function runOne(j: Job): Promise<NonNullable<Job['done']>> {
  return new Promise((resolve) => {
    fs.mkdirSync(path.dirname(j.log), { recursive: true });
    const fd = fs.openSync(j.log, 'w');
    const t0 = performance.now();
    const c = spawn(j.argv[0], j.argv.slice(1), { cwd: j.cwd, stdio: ['ignore', fd, fd], env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' } });
    children.add(c);
    const end = (exit: number | null, signal: string | null) => { children.delete(c); fs.closeSync(fd); resolve({ exit, signal, wallSec: (performance.now() - t0) / 1000 }); };
    c.on('error', (e) => { fs.appendFileSync(j.log, `\n[gates] could not start: ${e.message}\n`); end(127, null); });
    c.on('exit', (code, signal) => end(code, signal));
  });
}

/** Run the jobs: the parallel ones longest first within `cap` CPU slots, each when what it waits on has finished (a job
 *  whose wait failed is dropped and reported through `skip`); then the alone ones one at a time, in order. */
export async function schedule(jobs: Job[], cap: number, hooks: { start?(j: Job): void; end?(j: Job): void; skip(j: Job): boolean }) {
  const byKey = new Map(jobs.map((j) => [j.key, j]));
  const waiting = jobs.filter((j) => !j.alone).sort((a, b) => b.est - a.est);
  const running = new Set<Job>();
  let used = 0;
  await new Promise<void>((resolve) => {
    const pump = () => {
      for (let i = 0; i < waiting.length; i++) {
        const j = waiting[i];
        if (j.after.some((k) => byKey.has(k) && !byKey.get(k)!.done)) continue;
        if (hooks.skip(j)) { waiting.splice(i--, 1); continue; }
        const slots = Math.min(j.slots, cap);
        if (used + slots > cap && running.size) continue;
        waiting.splice(i--, 1); running.add(j); used += slots; hooks.start?.(j);
        runOne(j).then((d) => { j.done = d; running.delete(j); used -= slots; hooks.end?.(j); pump(); });
      }
      if (!waiting.length && !running.size) resolve();
    };
    pump();
  });
  for (const j of jobs.filter((x) => x.alone)) {
    if (hooks.skip(j)) continue;
    hooks.start?.(j); j.done = await runOne(j); hooks.end?.(j);
  }
}

// ---------------------------------------------------------------- references

export const git = (root: string, ...args: string[]) => {
  const r = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim() : null;
};

/** The reference's cache: .gates/ref/<commit>/<id>.{json|log} and a meta file written last (its presence = complete). */
export function refPaths(root: string, commit: string, r: ReferenceDef) {
  const dir = path.join(root, '.gates', 'ref', commit);
  return { dir, tree: path.join(dir, 'tree'), result: path.join(dir, `${r.id}${r.writesOut ? '.json' : '.log'}`), log: path.join(dir, `${r.id}.log`), meta: path.join(dir, `${r.id}.meta.json`) };
}

/** A clean snapshot of `commit` to run references in (git archive: no worktree is registered), with the checkout's
 *  node_modules linked in. */
export function snapshot(root: string, commit: string): string | null {
  const dir = path.join(root, '.gates', 'ref', commit, 'tree');
  if (fs.existsSync(path.join(dir, '.gates-snapshot'))) return dir;
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const r = spawnSync('sh', ['-c', `git -C "$1" archive "$2" | tar -x -C "$3"`, 'sh', root, commit, dir], { encoding: 'utf8' });
  if (r.status !== 0) return null;
  fs.symlinkSync(path.join(root, 'node_modules'), path.join(dir, 'node_modules'));
  fs.writeFileSync(path.join(dir, '.gates-snapshot'), commit + '\n');
  return dir;
}
