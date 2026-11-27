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
