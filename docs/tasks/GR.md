# Task GR: the gate runner

Type: engineering. Written: 2026-11-27, main ee6cfd6. Assumes: D8, D10, D13.

Context (owner, 2026-11-27): "AU" was the autonomy setup task planned in the claude.ai project (a /next-task loop with a
reviewer subagent). It was never pasted to Claude Code, so it is correctly absent from the repo. The owner decided: run
GR now, by hand, as a normal task; AU follows GR so its reviewer can use GR's profiles. D16 stays the I2b split; AU's
decisions take the next free numbers.

First, in your own worktree (`git worktree add <dir> -b chore/gr-gate-runner main`, from local main), save this brief as
docs/tasks/GR.md and point the GR row in docs/ROADMAP.md to it.

Goal: `npx tsx scripts/gates.ts --profile <base|movement|nav|world|render|hazards|full>` runs a task's gates in parallel
processes (capped by CPU count), with perf-sim run alone at the end so its timings stay clean.
- Output: a printed table, and a JSON summary under a gitignored .gates/ directory, named by commit and profile. Exit
  code nonzero on any failure.
- Profiles are data in scripts/lib/gateprofiles.ts. base = typecheck, npm test, the build, checksum all. Derive the
  other profiles from the gates that CLAUDE.md and the ROADMAP rows list for that kind of work (movement: I1b's; nav:
  I3's and I1c's; world: G1a's; render: I2a's, e.g. tools/three-signal.mjs and tests/browser/range.py --query
  render=three; hazards: habplay and hazplay; full: all). List the mapping in your report.
- Under D8 the profiles run with both flags on (navwalk --known tests/fixtures/navwalk-known.json, stuckwatch with no
  TRAPPED, perf-sim on the flags). Flag-off runs only for tile-only code.
- Flag-off reference results are cached per main commit under .gates/, generalising stuckwatch's --save/--compare.
- A script a profile names that does not exist yet (worldcheck, holdplay) is listed as "not built yet", not failed. A
  gate that needs a browser and cannot get one is listed as "skipped", never as passed.
- Tests: every script a profile names resolves to a file or is marked not built yet; the JSON summary's schema.
- Update CLAUDE.md's Commands with gates.ts.
- Out of scope: changing any gate's behaviour. If a gate must change to fit the runner, stop and report.

Gates: npm run check. Run --profile full once; show its results equal the individual runs; report wall time against a
sequential run.

Set the GR row to done on the branch. Lane B's I2b is running in parallel: preview conflicts with git merge-tree before
merging; a conflict outside ROADMAP rows is a stop. When done, stop and report: Decisions needed, What landed, Gates,
Decided without asking, Found not fixed, Next. Do not merge until the owner says so, and never push.

## Record (2026-11-27)

Branch `chore/gr-gate-runner`. Files: `scripts/gates.ts` (the command line), `scripts/lib/gateprofiles.ts` (the gates
and profiles, data), `scripts/lib/gaterun.ts` (judges, scheduler, references, summary schema), `tests/gates.test.ts`.
Output goes to `.gates/` (gitignored). No gate script changed.

### Profiles

Every profile starts with `base`. Flags on means `--physics rapier --nav navmesh` (D8).

| Profile | Gates added to base | Source |
|---|---|---|
| base | typecheck, `npm test`, the build (private `--out`), `checksum.ts all` | the brief; CLAUDE.md Commands |
| movement | navwalk-3d, stuckwatch-3d, jumptiming-rapier, locomotion-rapier, perf-sim-3d | I1b's gates (OVERHAUL_3D "Movement (I1b)"), on both flags |
| nav | navwalk-3d, stuckwatch-3d, navhash, perf-sim-3d | I3's (navhash, `--nav navmesh` on navwalk, stuckwatch, perf-sim) and I1c's (both flags, the known lists) |
| world | worldcheck (not built yet), navwalk-3d, stuckwatch-3d, navhash, perf-sim-3d | G1a's row: `scripts/worldcheck.ts`, and the walkers, the watch and the cost on what it generates |
| render | three-signal, range-three | I2a's closing gates (`tools/three-signal.mjs`, `range.py --query render=three`) |
| hazards | habplay-raid, hazplay, holdplay (not built yet) | the brief; CLAUDE.md "Habitat maps"; G2b's `holdplay` |
| full | every gate above | |

The gate commands:
- navwalk-3d: `navwalk.ts all 5` + both flags + `--known tests/fixtures/navwalk-known.json`.
- stuckwatch-3d: `stuckwatch.ts all 3` + both flags + `--known tests/fixtures/stuckwatch-known.json` + `--save`.
- jumptiming-rapier: `jumptiming.ts --physics rapier`.
- locomotion-rapier: `tsx --import ./tests/setup/physics-on.ts --test tests/locomotion.test.ts tests/jumpcontrol.test.ts`.
- navhash: `navhash.ts --check`.
- perf-sim-3d: `perf-sim.ts 500 --repeat 3 --gate` + both flags. It runs alone, after the parallel gates.
- habplay-raid: `habplay.ts all 6 1 --raid`. hazplay: `hazplay.ts`.

### Flag-off references

Two gates carry a flag-off reference. Each reference runs once per base commit (`git merge-base HEAD main`) in a
snapshot of that commit, `.gates/ref/<commit>/tree`, made with `git archive` plus a link to the checkout's
`node_modules`. Its result is cached under `.gates/ref/<commit>/`. A reference is a diagnostic: it never passes or fails
a gate.
- stuckwatch-3d against `stuckwatch.ts all 3 --nav navmesh --save` (physics off). stuckwatch's `--compare` needs the same
  nav setting, so the reference keeps nav on. The runner compares the two saved files by stuckwatch's identity (map,
  seed, species, window tick, tile).
- perf-sim-3d against `perf-sim.ts 500 --repeat 3` (both flags off), run alone.

### Decided without asking (D10)

- **The build gate writes to the run's own directory** (`.gates/<commit>-<profile>/build`), not `dist/`. Other sessions
  share `dist/` (CLAUDE.md "Parallel sessions"). `build.mjs --out` applies the same 3 MB budget. The browser gates open
  this build. Alternative: `npm run build`, which would overwrite another session's `dist/`.
- **`npm test` takes 4 CPU slots** of the cap; every other gate takes 1. `node --test` runs its files in parallel
  itself. No test in `npm test` has a time budget, so load changes only its wall time (66.5 s in the full run, 53 s in
  the base run).
- **Longest gate first.** Each gate has an estimate (`est`, seconds) and the parallel phase starts the longest first.
- **Judges read what a gate prints when its exit code says too little.** `checksum.ts` exits 0 on `MOVED` and
  `(not recorded)`, so the runner needs every row to print "(as recorded)". `habplay.ts` sets no exit code, so the runner
  needs `ok/total` with ok equal to total and total above 0 (`all --raid` alone runs 0 cases). `three-signal.mjs`: its exit code, and at
  least one `ok` row. The other gates are judged by their exit code alone. No gate changed.
- **The stuckwatch comparison is computed by the runner** from the two `--save` files. Alternative: run stuckwatch with
  `--known` and `--compare` together. That makes the gate wait for its reference, doubling the first run's critical path,
  and its exit code would mix the gate with the diagnostic.
- **A script that is missing and not marked "not built yet" fails.** Only `worldcheck` and `holdplay` carry the mark.
  `tests/gates.test.ts` fails when a marked script appears, so its mark is removed.
- **Browser gates are skipped, with the reason, when playwright, its Chromium or the `.venv` Python is missing.** The
  summary's `complete` is false when any gate is skipped or not built yet; `ok` is false only on a failure.
- **"dirty" in the summary's name counts untracked files**, so a run on uncommitted new files is not filed under the
  clean commit.
- **Left out as gates:** `navbench`, `actorbench`, `dropstress`, `navgiant`, `navheight` (measurements with no pass or
  fail), `habstate` and `habaudit` (the brief names habplay and hazplay for hazards; habaudit rewrites
  `docs/habaudit/baseline.json`).
- **locomotion-rapier runs on the physics flag alone**, as I1b ran it: `tests/setup/physics-on.ts` sets only the physics
  engine, and adding nav would mean a new setup file, which changes the gate.

### Results

`--profile full`, once, at `de749c7` (base `ee6cfd6`, both references uncached), 16 CPU slots, on the owner's machine
(Apple M3 Max): 14 pass, 0 fail, 0 skipped, 2 not built yet (worldcheck, holdplay). Wall 1268 s.

The same 14 commands run one by one (`seq.sh` in the session scratchpad, the runner's own `--list`): every gate has the
same status, exit code and summary line. Sum 1455 s.

| Gate | Result (both runs) | Runner s | Alone s |
|---|---|---|---|
| typecheck | exit 0 | 18.1 | 5.1 |
| test | 739 tests, 738 pass, 0 fail, 1 todo | 66.5 | 54.5 |
| build | index.html 2000 KB | 1.0 | 0.4 |
| checksum | 16 of 16 as recorded | 20.0 | 6.0 |
| navwalk-3d | known-failure gate: 2 known, 0 new or different: PASS | 1026.6 | 1046.8 |
| stuckwatch-3d | 13 player episodes, TRAPPED 0; known-site gate: 0 known, 0 new: PASS | 116.0 | 91.1 |
| jumptiming-rapier | PASS | 11.9 | 2.6 |
| locomotion-rapier | 27 tests, 27 pass | 7.3 | 1.5 |
| navhash | 6 of 6 as recorded | 12.3 | 2.8 |
| three-signal | 10 of 10 ok | 9.6 | 8.8 |
| range-three | PASS | 58.7 | 28.3 |
| habplay-raid | 72/72 runs completed | 47.9 | 24.8 |
| hazplay | 49/49 pass | 10.5 | 2.2 |
| perf-sim-3d | min of 3 p95 1.541 / p99 1.861 ms (alone: 1.592 / 1.935); gate PASS | 167.0 | 180.4 |

References (first run, then cached): stuckwatch physics off 67 s (parallel), perf-sim flags off 74 s (alone):
p95 0.717 / p99 0.955 ms. Diagnostics: stuckwatch-3d 0 TRAPPED matched, 0 new, 0 gone against physics off;
perf-sim-3d p95 1.541 / p99 1.861 against 0.717 / 0.955 flags off.

The saving is small (1268 s against 1455 s, 13 %) because navwalk-3d is one process of about 1030 s and the critical
path: navwalk plus the alone phase (perf-sim and its reference) is about 1270 s, which is the run's wall time. Every
other gate finished inside navwalk's run. With the references cached the floor is about 1195 s. See ROADMAP F127.
