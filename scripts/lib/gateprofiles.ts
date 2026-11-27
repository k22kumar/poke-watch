// The gate runner's data (task GR, docs/tasks/GR.md): every gate a task runs before it is called done, and the profiles
// that group them by kind of work. scripts/gates.ts runs a profile; scripts/lib/gaterun.ts holds the scheduler, the
// judges and the summary. A gate here only names a command that already exists: the runner never changes what a gate
// does (out of scope for GR).
//
// Placeholders in `run`, filled by the runner: {root} the checkout's absolute path, {run} this run's directory under
// .gates/, {build} the run's private build ({run}/build, written by the `build` gate), {python} the Python of the
// browser checks (--python, else $GATES_PYTHON, else {root}/.venv/bin/python), {out} a reference's result file.
//
// Under decision D8 the movement, navigation and world gates run with both flags on (--physics rapier --nav navmesh);
// a flag-off run is only a reference (below), cached per main commit.

/** how a gate's result is read from its exit code and output (scripts/lib/gaterun.ts JUDGES) */
export type JudgeName = 'exit' | 'nodeTest' | 'checksum' | 'navhash' | 'habplay' | 'okLines';
/** how a gate's run is compared with its flag-off reference (diagnostic only: never a pass or a fail) */
export type CompareName = 'stuckwatchTraps' | 'perfSim';

/** A flag-off reference: the same gate with its flags off, run on the main commit the branch starts from (git merge-base
 *  HEAD main) in a clean snapshot of that commit, and cached under .gates/ref/<commit>/<id>.* so every later run on the
 *  same base reuses it. It generalises stuckwatch's --save / --compare: the gate's own run is compared with it as a
 *  diagnostic. */
export interface ReferenceDef {
  id: string;
  /** the flag-off command; {out} is the cached result file (a JSON file the command writes, or none) */
  run: string[];
  /** the command writes {out} (else the cached result is its log) */
  writesOut?: boolean;
  /** runs alone, after the parallel gates (its timings must stay clean) */
  alone?: boolean;
  compare: CompareName;
}

export interface GateDef {
  id: string;
  /** one line: what it checks */
  what: string;
  /** where the gate is listed (CLAUDE.md, a ROADMAP row, a doc) */
  from: string;
  /** the command, argv form (no shell); placeholders as above */
  run: string[];
  /** the file the gate runs, relative to the repo root (the gates test checks it exists unless notBuilt) */
  script?: string;
  /** the script is planned by a later task and not written yet: listed "not built yet", never failed or run */
  notBuilt?: string;
  /** gates that must pass first (in the same run); a gate whose need failed or was skipped is skipped */
  needs?: string[];
  /** needs a browser: 'node' (the Node playwright package and its Chromium) or 'python' (the .venv's playwright) */
  browser?: 'node' | 'python';
  /** runs alone after every parallel gate, one at a time (perf-sim: its timings must stay clean) */
  alone?: boolean;
  /** CPU slots it takes in the parallel phase (default 1; `npm test` runs its files in parallel itself) */
  slots?: number;
  /** typical wall time on the owner's machine (s), for starting the longest gates first */
  est?: number;
  judge?: JudgeName;
  /** regexes (multiline sources) whose last match per pattern is the gate's one-line note */
  note?: string[];
  reference?: ReferenceDef;
}

const TSX = ['npx', 'tsx'];
/** both flags on: the 3D stack (is3D, decision D8) */
const BOTH = ['--physics', 'rapier', '--nav', 'navmesh'];

export const GATES: Record<string, GateDef> = {
  typecheck: {
    id: 'typecheck', what: 'TypeScript types (tsc --noEmit)', from: 'CLAUDE.md Commands; npm run check',
    run: ['npm', 'run', 'typecheck'], script: 'tsconfig.json', est: 25, note: ['^.*error TS\\d+.*$'],
  },
  test: {
    id: 'test', what: 'every test suite, headless (npm test)', from: 'CLAUDE.md Commands; npm run check',
    run: ['npm', 'test'], script: 'package.json', slots: 4, est: 240, judge: 'nodeTest',
  },
  build: {
    id: 'build', what: 'the production build into the run\'s private directory (the 3 MB page budget)',
    from: 'CLAUDE.md Commands ("npm run check"; a private --out build: "Parallel sessions")',
    run: ['node', 'scripts/build.mjs', '--out', '{build}'], script: 'scripts/build.mjs', est: 20,
    note: ['^.*index\\.html.*$'],
  },
  checksum: {
    id: 'checksum', what: 'every replay scenario prints its recorded hashes', from: 'CLAUDE.md Commands (replay baseline)',
    run: [...TSX, 'scripts/checksum.ts', 'all'], script: 'scripts/checksum.ts', est: 150, judge: 'checksum',
  },
  'navwalk-3d': {
    id: 'navwalk-3d', what: 'walkers of every size class reach every mandatory space, both flags, on the known list',
    from: 'CLAUDE.md Commands (movement); ROADMAP I1b, I3, I1c (F74, F118)',
    run: [...TSX, 'scripts/navwalk.ts', 'all', '5', ...BOTH, '--known', 'tests/fixtures/navwalk-known.json'],
    script: 'scripts/navwalk.ts', est: 900, note: ['^known-failure gate: .*$'],
  },
  'stuckwatch-3d': {
    id: 'stuckwatch-3d', what: 'live deadlock watch, both flags: no TRAPPED but at a known site',
    from: 'CLAUDE.md Commands (movement); ROADMAP I1b, I3, I1c; D8',
    run: [...TSX, 'scripts/stuckwatch.ts', 'all', '3', ...BOTH, '--known', 'tests/fixtures/stuckwatch-known.json', '--save', '{run}/stuckwatch-3d.json'],
    script: 'scripts/stuckwatch.ts', est: 1200, note: ['^player stuck episodes \\d+ .*?TRAPPED \\d+', '^known-site gate: .*$'],
    reference: {
      // stuckwatch's --compare needs the same nav setting: the reference is the physics flag off, nav on
      id: 'stuckwatch-physics-off', run: [...TSX, 'scripts/stuckwatch.ts', 'all', '3', '--nav', 'navmesh', '--save', '{out}'],
      writesOut: true, compare: 'stuckwatchTraps',
    },
  },
  'jumptiming-rapier': {
    id: 'jumptiming-rapier', what: 'jump input latency on the character controller', from: 'ROADMAP I1b (docs/OVERHAUL_3D.md "Movement (I1b)")',
    run: [...TSX, 'scripts/jumptiming.ts', '--physics', 'rapier'], script: 'scripts/jumptiming.ts', est: 30,
    note: ['^(PASS|FAIL).*$'],
  },
  'locomotion-rapier': {
    id: 'locomotion-rapier', what: 'the tile locomotion and jump tests on the physics flag',
    from: 'ROADMAP I1b (docs/OVERHAUL_3D.md "Movement (I1b)": tests/setup/physics-on.ts)',
    run: [...TSX, '--import', './tests/setup/physics-on.ts', '--test', 'tests/locomotion.test.ts', 'tests/jumpcontrol.test.ts'],
    script: 'tests/setup/physics-on.ts', est: 60, judge: 'nodeTest',
  },
  navhash: {
    id: 'navhash', what: 'the navigation hash matches its fixture', from: 'ROADMAP I3 (docs/OVERHAUL_3D.md "Navigation (I3)")',
    run: [...TSX, 'scripts/navhash.ts', '--check'], script: 'scripts/navhash.ts', est: 60, judge: 'navhash',
  },
  worldcheck: {
    id: 'worldcheck', what: 'the generator\'s gate classes A and C on the generated maps', from: 'ROADMAP G1a (D13)',
    run: [...TSX, 'scripts/worldcheck.ts'], script: 'scripts/worldcheck.ts', notBuilt: 'G1a writes it',
  },
  'three-signal': {
    id: 'three-signal', what: 'signal colours survive grade, fog and bloom (headed Chromium, both backends)',
    from: 'ROADMAP I2a', run: ['node', 'tools/three-signal.mjs', '{build}/index.html'], script: 'tools/three-signal.mjs',
    needs: ['build'], browser: 'node', est: 90, judge: 'okLines',
  },
  'range-three': {
    id: 'range-three', what: 'the merge check on the three.js renderer (title, hero, fire, Breakthrough)',
    from: 'ROADMAP I2a; CLAUDE.md Browser checks',
    run: ['{python}', '-I', 'tests/browser/range.py', '{build}/index.html', '{run}/range-three', '--query', 'render=three'],
    script: 'tests/browser/range.py', needs: ['build'], browser: 'python', est: 90, note: ['^(PASS|FAILED: .*)$'],
  },
  'habplay-raid': {
    id: 'habplay-raid', what: 'spawn → objective → retreat on every habitat, raid party live',
    from: 'CLAUDE.md Habitat maps (gates after habitat, hazard or objective code)',
    run: [...TSX, 'scripts/habplay.ts', 'all', '6', '1', '--raid'], script: 'scripts/habplay.ts', est: 600, judge: 'habplay',
  },
  hazplay: {
    id: 'hazplay', what: 'liquid exposure and exposed falls through the real sim', from: 'CLAUDE.md Habitat maps',
    run: [...TSX, 'scripts/hazplay.ts'], script: 'scripts/hazplay.ts', est: 120, note: ['^\\d+/\\d+ pass$'],
  },
  holdplay: {
    id: 'holdplay', what: 'the Hold played on the 3D Hold map', from: 'ROADMAP G2b (D13)',
    run: [...TSX, 'scripts/holdplay.ts'], script: 'scripts/holdplay.ts', notBuilt: 'G2b writes it',
  },
  'perf-sim-3d': {
    id: 'perf-sim-3d', what: 'sim cost per tick at 500 enemies, both flags (p95 <= 2 ms, p99 <= 3 ms, min of 3)',
    from: 'CLAUDE.md Commands (performance); ROADMAP I1b, I3, I1c; D8',
    run: [...TSX, 'scripts/perf-sim.ts', '500', '--repeat', '3', '--gate', ...BOTH], script: 'scripts/perf-sim.ts',
    alone: true, est: 150, note: ['^min of \\d+: .*$', '^gate .*$'],
    reference: {
      id: 'perf-sim-flags-off', run: [...TSX, 'scripts/perf-sim.ts', '500', '--repeat', '3'], alone: true, compare: 'perfSim',
    },
  },
};

export type ProfileName = 'base' | 'movement' | 'nav' | 'world' | 'render' | 'hazards' | 'full';

const BASE = ['typecheck', 'test', 'build', 'checksum'];

/** Each profile is base plus the gates its kind of work lists (docs/tasks/GR.md; the mapping is in the GR report). */
export const PROFILES: Record<ProfileName, string[]> = {
  base: BASE,
  // I1b's gates, on both flags (D8)
  movement: [...BASE, 'navwalk-3d', 'stuckwatch-3d', 'jumptiming-rapier', 'locomotion-rapier', 'perf-sim-3d'],
  // I3's and I1c's
  nav: [...BASE, 'navwalk-3d', 'stuckwatch-3d', 'navhash', 'perf-sim-3d'],
  // G1a's: the generator's own gate, and the walkers, the watch and the cost on what it generates
  world: [...BASE, 'worldcheck', 'navwalk-3d', 'stuckwatch-3d', 'navhash', 'perf-sim-3d'],
  // I2a's
  render: [...BASE, 'three-signal', 'range-three'],
  // habitat hazards and objectives (tile), and G2b's Hold
  hazards: [...BASE, 'habplay-raid', 'hazplay', 'holdplay'],
  full: [],
};
PROFILES.full = [...new Set(Object.entries(PROFILES).filter(([k]) => k !== 'full').flatMap(([, v]) => v))];

export const PROFILE_NAMES = Object.keys(PROFILES) as ProfileName[];
