# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Deterministic, data-driven survivor game: TypeScript, esbuild, `node:test` via tsx. The build is a single static `dist/index.html` deployed to GitHub Pages (`.github/workflows/deploy.yml`). The README has the full picture. This file lists only what a session needs up front.

## Commands (repo root)
- One suite: `npx tsx --test tests/<name>.test.ts` (add `--test-name-pattern "<regex>"` to pick a single test)
- All tests: `npm test` (headless, no browser)
- Types: `npm run typecheck` (CI runs it too)
- Before calling work done: `npm run check` (typecheck, tests, production build; writes `dist/`)
- Sim changes: `npx tsx scripts/checksum.ts [on|off|build-off|world-off|hazards-off|size-off|roster-off|gen|gen-classic|gen-size-off|gen-headroom-off|aim|aim-off|aim-2b|aim-pole-off|aim-tops-off|giants-off|gen-giants-off|deck|deck-giants-off|deck-tall|catalogue-off|gen-catalogue-off|deck-catalogue-off|deck-xl|deck-xl-tall-off]` (no arg prints all; `aim` adds a chase crosshair ray to the bot so the spatial aim and beams are covered, `aim-off` must print the `on` hashes, `aim-2b` the Phase 2B `aim` hashes, `aim-pole-off` the `aim` hashes before R2 pole-safe aim maths, `aim-tops-off` the `aim` hashes before R1b wall tops; the size flags `axis`, `xlContinuous` and `xlTall` are on by default: `giants-off`, `gen-giants-off` and `deck-giants-off` turn them off and must print the `on`, `gen` and `deck` hashes from before that flip; `deck*` replay Mt. Moon with Onix, and `deck-tall` (axis off, pinned) covers xlTall's routing; `deck-xl` replays it with Wailord (3.23 m, seed 3), the default game's giant over the 2.9 m gaps, and `deck-xl-tall-off` with xlTall off; the catalogue wave (`rules.spawning.waves.catalogue`) is on by default: `catalogue-off`, `gen-catalogue-off` and `deck-catalogue-off` must print the `on`, `gen` and `deck` hashes from before it). A feature flagged off must reproduce the older layer's hashes exactly (`off` = v10, `build-off` = phase 8a, `hazards-off` = pre-hazards, `size-off` = before size-class bodies and the 2026-11 roster wave, `gen-headroom-off` = `gen` before R1 headroom, `giants-off` = `on` before the size-flag default flip; older sets select `CLASSIC_REGIONS`, `size.geometry: false`, `size.headroom: false`, the three size flags false, `world.wallTops: false` and the catalogue wave off too); see README §Build. Performance-sensitive sim changes: `npx tsx scripts/perf-sim.ts 500 --repeat 3 --gate`. Movement, collision or navigation changes: `npx tsx scripts/navwalk.ts all 5` (real walkers of every size class reach every mandatory space; docs/SIZING.md) and `npx tsx scripts/stuckwatch.ts all 3` (live deadlock watch). navwalk, stuckwatch, habplay and perf-sim take `--size a,b=false` (any boolean `rules.size` flags; a bare name turns one on, `=false` off, e.g. `--size axis=false` for the no-axis worst case)
- Dev server: `npm run dev` (http://localhost:5173)

## Architecture rules (details in README §Architecture)
- `src/sim/` and `src/world/` never import `render/`, `ui/`, `audio/`, `input/` or `assets/`. They must run in Node.
- Fixed 1/60 s ticks, one RNG stream per system. No `Math.random`, and no clock in sim or worldgen output (`performance.now()` is used for timing metrics only).
- Tunable numbers live in `src/rules/` (`defaults.ts` and friends). Systems read `ctx.rules`, never literals.
- The sim emits events. Render, audio and UI only react to them.
- Each subsystem has a doc in `docs/` (SYSTEMIC, SQUAD, HAZARDS, HABITATS, LOCATIONS, WORLDGEN, THIRD_PERSON, CAMERA, SIZING, SPAWNING, …). Read the matching doc before changing a subsystem, and update it when its rules or numbers change. `docs/CUSTOMISING.md` is the how-to for roster, size, map and spawn changes.
- There are no spawn pools (deleted at pivot step 9): enemies come from target sets (`src/rules/targets.ts`), the Hold's `RAID_PARTY` (`src/sim/modes/hold.ts`) and, in tests and gates only, `scripts/lib/crowd.ts`. Per-species facts (preferences, restrictions, size pins) live in `src/rules/profiles.ts`, placement in `src/sim/placement.ts`. Sizes come from `rules.size` through `bodyOf` / `enemyRadius` / `partnerRadius` / `footprintOf` / `partnerFootprint` (`src/rules/sizing.ts`); never derive a body radius in the sim. Walls stop footprints through `World.moveBody` only, and wide footprints route on `src/world/navblocks.ts`, which the location `wide` gate also reads.

## Habitat maps (`src/world/habitat/`, `docs/HABITATS.md`)
- A layout is fully determined by recipe + variant + seed + `HAB_VERSION` (`src/world/habitat/index.ts`). A generator change that alters any accepted layout needs a `HAB_VERSION` bump. Compare timing and retry behaviour against `docs/habaudit/baseline.json`.
- Gates to run after touching habitat, hazard or objective code: `npx tsx scripts/habstate.ts`, `scripts/habplay.ts all 6 1 --raid` (the shorter `all --raid` runs 0 cases and exits 0), `scripts/hazplay.ts`, `scripts/habaudit.ts` (slow). `tests/habitat*.test.ts`, `habstate`, `habaudit`, `habtac` and `hazards` assert the same checks.
- Hold Raid party: it spawns at team B's staging, 33–47 m from the point. `rules.enemy.despawnDistance` (46) relocates any non-boss enemy farther than that from the player to a ring ahead of them, which skipped the approaches. `src/sim/enemies.ts` pins Raiders of an active habitat Hold. Check the same relocation before adding any other far-spawned actor on these maps.
- Tactical playtest evidence, seeds worth replaying and the human checklist: `docs/HABITAT_PLAYTEST.md`.

## Generated and oversized files
- Generated by `scripts/build-content.mjs`; do not hand-edit: `src/content/pokedex.ts`, `src/content/art.json`, `src/content/icons.json`, `src/content/catalogue.ts`, `content/report.json`.
- `src/content/catalogue.ts` (130 KB) is the reference catalogue, not game species: regenerate it alone with `node scripts/build-content.mjs --catalogue-only` (add `--catalogue-out <dir>` for an isolated copy). Authored input is `content/catalogue.json`; read it through `src/rules/catalogue.ts`. Nothing in `src/sim/`, `src/world/`, `src/render/`, `src/ui/` or `src/rules/species.ts` may import it — a catalogue record inside `SPECIES` moves the habitat profiles and every replay hash. `tests/catalogue.test.ts` is the gate.
- Never read these whole. Use grep or targeted ranges: `src/content/art.json` (3 MB), `src/content/icons.json` (470 KB), `content/report.json` (290 KB), `docs/Pokemon_*_Specification.md` (90–230 KB). The `docs/*.xlsx` and `content/preview/*.png` files are binary.

## Browser checks
- `tools/*.mjs` and `tests/browser/*.py` drive headless Chromium. Playwright is not a dependency: run `npm i --no-save playwright` first. Usage is in `tools/README.md`.
- Capture mode (`?capture=1`): the sim only steps through `pokewatch.advance(seconds, {frames})`, which runs `round(seconds/frames/dt)` steps per frame. Pass `frames = seconds × 60` (one step per frame). Anything else silently under-steps (`advance(1.4, {frames: 70})` runs 1.17 s) and particles never appear.

## Parallel sessions
- Several Claude sessions often work in this checkout at once. Check `git status` before editing, and leave alone uncommitted changes you didn't make.
- `npm run build`, `npm run dev` and `npm run check` all write `dist/`. For screenshot captures, build into a private directory instead: copy `scripts/build.mjs` to your scratchpad with the output path changed, then pass that HTML to `tools/cap.mjs`. This keeps you from overwriting another session's build.

## Agent skills
- `/grilling` before committing to a change with undecided design questions whose wrong answer is expensive to undo — e.g. a `HAB_VERSION` bump, a regenerated baseline, moved replay hashes, or a contract other systems read (hazards × objectives × enemies). Not for mechanical work — the decisions are already made and only transcription is left.
- `diagnosing-bugs` for a bug or regression with no deterministic repro yet (wrong sim behaviour at a known seed, a hash that moved unexpectedly, a layout failing a gate, a `perf-sim --gate` regression). Not for a failing test that already names its cause.
- Both are vendored in `.claude/skills/`; see `.claude/skills/README.md` for provenance and local edits. Review stays the built-in `/code-review`.
