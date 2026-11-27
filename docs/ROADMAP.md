# Roadmap

The work queue and its status. One task per chat, on a branch off `main` (CLAUDE.md "Working with the owner"); each
task updates this file when it ends. Records of finished work stay in their own docs; this file points to them.

Status words: **done** (merged to `main`), **review** (on a branch, waiting for the owner), **next**, **queued**,
**decision** (blocked on an owner decision), **dropped** (will not be done; the reason is in its notes).

Started 2026-11-21 from the owner's queue and the open items of `docs/hero-shooter-pivot.md` §11, which is now a closed
record.

## Queue

| # | Task | Status | Notes |
|---|---|---|---|
| 1 | Housekeeping | done | `chore/housekeeping` (`df5c465`, `4571d2d`): this file, CLAUDE.md "Working with the owner", P7, P2(a). |
| 2 | P5: the live stutter and real-GPU frame time | done | `perf/stutter`. **Cause: not our code.** The owner's Chrome trace: every mousedown ran Ghostery's content script `whotracksme.js` for 325–363 ms (4 of 4 clicks); held fire, with no new mousedowns, was smooth. The script listens at window (bubble phase) and serialises the `innerHTML` of the clicked element's three nearest ancestors; on the canvas that reaches `<body>`, which holds the inline 26 MB script, and sends the string to the extension. Fix: while the pointer is locked, game clicks are handled at window in the capture phase and stop there (`e577720`; forced on, Ghostery loaded: 0 ms per click, was 103–132 ms). Unlocked clicks on the canvas (the capturing click, every click in the fixed views) paid it too until F13 (done). Also: the `?perf=1` overlay and `tools/stutter.mjs` (`ddf0b8b`), a session long-task count in the overlay (`cb6cd4e`), no per-prop garbage in `TileStage.draw` (`99d4650`). Mouse-look smoothing parked (F14). `tools/perf.mjs` still has no crowd to time (F8). |
| 3 | A1: Pokémon art outside the HTML | done | `perf/a1-art`: `dist/index.html` 26.7 MB → 1.43 MB. Plan and results: "Item 3: A1 plan" below (it replaces `docs/archive/size-extremes-plan.md` "Proposed stage A1", written for the survivor game). `dist/index.html` was 26.7 MB. **Second reason** (2026-11-21, item 2): an extension that reads the page's HTML pays for its size. Ghostery's per-click cost scaled with it: 26.7 MB → 110–130 ms, 14.6 MB (art.json stubbed) → 61–73 ms, 1.5 MB (art and mp3 stubbed) → 6–9 ms in Playwright Chromium here (about 4.6 ms per MB; the owner's Chrome is about 3× slower), and 25 MB of inert text in `<body>` reproduced it, so it is the DOM text, not the script's parse. |
| 4 | P2b: sim determinism | queued | Narrowed to the sim code that survives the 3D overhaul (decision D7): the allow-list call sites (`tests/determinism.test.ts`) `Math.hypot` in `sim/bot.ts` and `sim/targets.ts`, `Math.tan` in `sim/moves.ts`, `Math.log` ×2 and a non-literal `**` in `rules/sizing.ts`. `sim/world.ts` and `sim/spatial.ts` are skipped: the overhaul replaces them (deleted at X1b). Also F11: every `x ** 2` (111 sites) becomes `x * x`, and the guard counts `** 2` from then on. Moves replay hashes: a planned re-record. |
| 5 | T2 planning: P1 | queued | After X1c, SB and TD (decisions D6, D7, D13). **P1**: per-player systems, and teams in damage (today one player, one enemy side). **F12** (hero bots must not see through wall corners) folded into I1a and **P6** (spikes and navigation faults on the Hold maps, F1, F2) into I3 (decision D7); I3 (2026-11-25) reproduces neither on the navmesh (F1, F2 notes). |
| 6 | The next `HAB_VERSION` bump | dropped | The habitat generator is replaced by the 3D overhaul (decision D7). Was: two parts in one bump, with `docs/habaudit/baseline.json` regenerated: the navigation profiles (F3), and P2c, the 68 habitat-generator `Math` call sites on the allow-list (`world/habitat/`: landforms 33, dress 9, families 9, sanctuary-checks 5, validate 5, graves 2, index 2, ruins 2, lagoon 1). |
| 7 | T1 co-op wave, T2 3v3, exp → Candy, the dream shop | queued | After X1c, SB and TD (decisions D6, D13). T1 takes the navigation faults it pays for (F1) and Hold balance (F4); T2 needs item 5 first. |

Done before this file: the hero-shooter pivot (`docs/hero-shooter-pivot.md`, merged `ad0cdc7`); pointer-lock request
handling, which unblocked the Pages deploy (`da19699`).

## The 3D overhaul (owner, 2026-11-22)

The tile world is replaced by a fully 3D one: a three.js renderer, a mesh world (WorldModel) and Rapier physics. The
plan, the WorldModel contract, the migration rules and the decisions are in `docs/OVERHAUL_3D.md`. Until the cutover
(X1a), new systems land behind flags that default off. The owner re-planned the rest on 2026-11-25 (D8 to D15 below):
the cutover is the 3D training range (D9), and the tile game is frozen until X1b deletes it (D8), so flag-off
`scripts/checksum.ts all` keeps running and the other flag-off gates are no longer required.
The overhaul's WM and WS were named P1 and P2 before the C0 review.

**Order (D13).** Lane A: GR → G1a → G1b → G2a. Lane B: I2a → I1c → I2b. G1b also needs lane B's I2a. Then X1a → X1b →
I4 → G2b → X1c. After X1c: SB, TD, then queue items 5 and 7 (P1, T1, T2).

A done task's row is one line and a pointer to its record. Each row as it stood before the re-plan, with its gate
results, is in `git show 01c2169:docs/ROADMAP.md`. In follow-ups written before D13, "G1" reads G1a (world side) or
G1b (render side) and "G2" reads G2a (headless) or G2b, by the scopes in the table.

| ID | Task | Status | Notes |
|---|---|---|---|
| C0 | Record this plan | done | `docs/c0-overhaul-plan` (merged `0dec749`). Record: `docs/OVERHAUL_3D.md`. |
| C1 | Cleanup of obsolete code (overworld game, original creatures, classic generator, survivor chests, dead exports, historical docs) | done | `chore/c1-cleanup` (2026-11-23, merged `bb92c11`); the pre-cleanup state is tag `maplebrook-final`. Record: the merge commit, and `docs/archive/` for the historical docs. Follow-ups F20–F23. |
| WM | WorldModel types and the tile adapter | done | `feat/wm-worldmodel-clean` (2026-11-23, merged `e4c7a97`): `src/world/model.ts`, the tile adapter and its conformance gate. Record: docs/OVERHAUL_3D.md "WorldModel". Follow-ups F25–F29. |
| C2 | Layering fix and the import guard test | done | `chore/c2-layering` (2026-11-23, merged `e34952a`): the world-geometry core in `src/world/sight.ts`, and `tests/imports.test.ts`. Record: README §Architecture rule 1. Follow-up F24 (closed). |
| S1 | Rapier spike, record in docs/spikes/S1-physics.md | done | 2026-11-23 (merged `6bbdf73`); spike code on `spike/s1-rapier` (kept, never merged). Record, with the owner's answers O1–O9: docs/spikes/S1-physics.md. Follow-ups F34–F38. |
| S2 | three.js spike, record in docs/spikes/S2-renderer.md | done | 2026-11-23 (merged `583dcea`); spike code on `spike/s2-three` (never merged; I2a ports from it). Record, with the owner's six answers: docs/spikes/S2-renderer.md; decision 1's F39 condition is waived (D14). Follow-ups F39–F44. |
| WS | Sim world seam (hash-invariant refactor) | done | `refactor/ws-world-seam` (2026-11-23, merged `5823e91`): every sim system reads the world through `WorldQuery` and `worldOf(ctx)`, guarded by `tests/worldseam.test.ts`. Record: docs/OVERHAUL_3D.md "World seam". Follow-ups F30–F33. |
| G0 | 3D generator design, docs/WORLDGEN3D.md | done | `docs/g0-worldgen3d` (2026-11-24, merged `5126a3b`), design only. Record: `docs/WORLDGEN3D.md` (Q1–Q23; its Q-index names each decision's task), amended by D9, D11, D12 and D14. Follow-ups F45–F51. |
| WM2 | WorldModel contract v2 | done | `feat/wm2-model-v2` (2026-11-25, merged `cb03810`): the contract table as types, the material roles, the adapter's defaults. Record: docs/OVERHAUL_3D.md "WorldModel" and WORLDGEN3D "WorldModel contract changes". Follow-ups F52–F56. |
| I1a | Physics world and queries | done | `feat/i1a-physics` (2026-11-25, merged `25e20ed`): Rapier answers the sim's world queries behind `rules.physics.engine = 'rapier'`. Record: docs/OVERHAUL_3D.md "Physics (I1a)". Follow-ups F57–F65. |
| I1b | Character movement | done | `feat/i1b-movement` (2026-11-25, merged `01c2169`): on the physics flag the partner moves through Rapier's character controller. Record: docs/LOCOMOTION.md "Resolvers (I1b)" and docs/OVERHAUL_3D.md "Movement (I1b)". Its answers stand as recorded; its stuckwatch identity gate is a diagnostic since D8. Follow-ups F66–F75. |
| I3 | Navigation | done | `feat/i3-nav-mesh` (2026-11-25, merged `a749628`): recast navmeshes answer the seam's navigation behind `rules.nav.engine = 'navmesh'`; P6 folded in (D7). Record: docs/OVERHAUL_3D.md "Navigation (I3)". Follow-ups F76–F85. |
| CL | Camera law | done | `feat/cl-camera-law` (2026-11-25, merged `773c308`): the anatomy table, the single framing source and, behind `rules.aim.viewSight` (on at X1a), the eye check and the eye launch. Record: WORLDGEN3D Q15c and CL-Q2 to CL-Q13; docs/CAMERA.md "Direction for the 3D camera". Follow-ups F45, F51, F86–F99. |
| RP | Record the owner's re-plan of 2026-11-25 | done | `docs/rp-replan` (2026-11-25, merged `20ae318`), docs only; the owner's review answers (D15; F77, F100 and F102 answered; CLAUDE.md's F101 lines) followed on `main` the same day. Record: D8 to D15 below and in docs/OVERHAUL_3D.md. Follow-ups F100–F102. |
| GR | The gate runner | queued | Lane A's first task, before G1a (D13). Its scope is its own prompt. |
| G1a | Generator core and the 3D range: world side | queued | D13 (the world half of WORLDGEN3D Q22.6's G1): the IR types, the kit, `build`, `emit`, gate classes A and C, the 64-bit hash, the dressing interface, the range as authored space IR with its stations, `scripts/worldcheck.ts`, and the "Numbers that G1 measures" (WORLDGEN3D "Open items") that need no renderer, with controller cost on the generated terrain first, before the 80,000-triangle cap is accepted. **Needs WM2, I1b, I3 and CL** (its class A gate needs the navmesh); it stops and reports if it needs any I2a piece. The model types and `MODEL_VERSION` are WM2's; G1a fills them from the generator. D9: it builds the range's liquid, breakable and timed-hazard stations as geometry. D15: its mesh-world seam answers liquid contact from the model's liquid volumes with the tile model's rule (no bed, F25), so the pond's swimming behaves at X1a as it does today; what the range gate lists as inert until I4 is the tall grass's burning, the breakable and timed-hazard stations, and Q9's new liquid rules. D14: the narrow clear-width rung is 1.20 m; it pins it with a test that a 1.20 m neck is open to the 5-cell narrow agent at every plan offset and refused to Large, and recomputes every number derived from the rung (F77). The camera inputs are CL-Q8's: `cameraClearance(rules)` in the framing source gives the `camera-clearance` ceiling (3.66 m), short side (10.18 m) and tall-dressing keep-out (9.30 m); F94, F97, F99. From WORLDGEN3D Q23: hull proxies for rocks (with the Q15.2 measurement), the default exaggeration value and its per-archetype override. Also F70 (64-bit triangle versions of the floor height, contact heights and fit test) and F74 (the deck-corner limitation, on its generated decks). From F111 (owner, 2026-11-27): its 3D stumps and logs carry the `endgrain` role on their cut tops (sides `trunk`), added to `MATERIAL_ROLES` (a `MODEL_VERSION` bump), replacing I2a's render-side split. |
| G1b | The 3D range: render side | queued | D13 (the render half of G1): the render-side mesh builders, the kit-piece skin list (where it travels is settled here, WORLDGEN3D Q23), hull-proxy visuals, the range's readability lints, `range.py` with every flag on and `?render=three`. Targets `lowpoly` (D11). **Needs G1a and I2a.** |
| G2a | The first 3D Hold map: headless | queued | D13 (the headless half of WORLDGEN3D Q22.6's G2): `plan`, `embed`, the Hold template with all five route roles, gate classes B, D and E, the repairs, the curated-seed fallback. **Needs G1a.** The map is River Gorge re-authored in layers (Q14c); layer 1 stays G2's scope (D9), and G2b takes its liquids, timed hazards and breakables. `plan` and `embed` lay out all five route roles of Q11 from layer 1: the "over" and "under" tertiaries are planned and their space is kept empty, so layers 2 and 3 fill it without moving the baseline routes. Its camera inputs are CL-Q8's `cameraClearance(rules)` (ceiling 3.66 m, short side 10.18 m, keep-out 9.30 m) and CL-Q9 (no further room for pull-in), F99; it does not wait for CL-Q9's fade-rate report (F100). Layer 1 needs no cave: the SDF cave builder of Q4 lands with the first River Gorge layer that needs one, after X1c (F102). |
| I2a | three.js scene | done | `feat/i2a-three-scene` (2026-11-27, merged `3f66724`; the look sheet `feat/i2a-look-sheet` fast-forwarded into it, so the branch carries the owner's look values): the scene behind `?render=three` as the side file `dist/three/scene.<hash>.js`; the material family and the closed profile registry with `lowpoly` alone, the closed pass registry (ink, bloom), the biome bindings transcribed from today's tables, normals and the sky-visibility and lamp bakes at load, the ambient rig, grading in the output step, the signal composite after it (checked: `tools/three-signal.mjs`), all lighting from one time-of-day value (`tests/timeofday.test.ts`, D12), S2's billboard, backend selection and tools ported, the render budgets recalibrated (Q20). Record: docs/RENDER3D.md. The owner's answers of 2026-11-27 are in RENDER3D "Look values"; the neutral values merge as provisional, and the rest is chosen from a look sheet (F111). Follow-ups F103–F112; F40 and F42 closed, F31 and F43 narrowed. Look sheet closed 2026-11-27 (F111): `lowpoly` p1i1 at 11:00 (night 23:00, key 0.55), facet ±0.06 day / ±0.10 caves and night, Chargestone's binding key 0.85 over ambient 0.45, the render-side `endgrain` role (`#d8c09a`, as proposed: the owner's colour line came back unfilled), mark 1 gated on the range, River Gorge, Chargestone Cave and the dusk lagoon. Closing gates: `npm run check` 719 tests (718 pass, 0 fail, 1 todo), `checksum all` 14 as recorded, `tools/three-signal.mjs` 10 of 10, `tests/browser/range.py --query render=three` PASS. Open elsewhere: F103–F108, F110, F113 (parked), F114. |
| I1c | Enemies, bodies and bots on physics and navigation | queued | Lane B, after I2a (D13). Gate (F1, D8): stuckwatch with both flags on, no TRAPPED. From G0: a breakable only removes its colliders when it breaks, and its residue has none (WORLDGEN3D Q21.9). Follow-ups it owns: F30, F65, F73, F74 (the enemy walkers), F75, F77 (Medium at adapter-map necks), F78, F82, F83. |
| I2b | Actors, effects and camera | queued | Lane B, after I1c (D13); targets `lowpoly` (D11). From G0: the owner's camera direction (WORLDGEN3D Q15g) replaces the framing law. CL sets the law and its numbers; the render side stays here (the rig on that law, own-body fade, the pull-in around walls). From the CL grilling (WORLDGEN3D Q15c, CL-Q4 to CL-Q9): the lens at eye height with no cap and the floor min(0.60, eye) (CL-Q4, CL-Q5); the distance law from the framing source (CL-Q8); the information gate against camera peek, wiring CL's gate query into what the rig draws (`frameEye` once per frame, then `eyeSeesEnemy`; CL builds, tests and measures it: a full pass over about 500 enemies p95 0.70 ms on tiles, 1.09 ms on Rapier; the proposed rate, in-view only and staggered over 4 frames, a quarter pass p95 0.18 / 0.28 ms; CL-Q7); pull-in and fade owned here, with the fade rate reported on the 3D range (G1b's), split as CL-Q9 says, and repeated by G2b on River Gorge (F100); I2b needs G1b only for that report, so if G1b has not merged when I2b's other work is done, I2b merges without it and the report moves to X1a; F96, F97, F99. From WORLDGEN3D Q23: the per-instance actor tint for local light; the signal language (keyline, underlay, patterns, a shape and an icon per kind) with one occlusion rule per signal kind and its lint; team colours as a player setting with colour-vision presets; the effect cards (glow sprites, particles), code-made only: shader maths, or small procedurally generated textures made once and shared. |
| X1a | Cutover: flags on, fixed views retired, new replay baseline | queued | D9 (supersedes G0 answer B of 2026-11-24): the cutover is the training range. X1a makes the 3D stack the game once the 3D range plays. **Needs I1c, I2a, I2b, G1a and G1b, not I4.** D15: the range ships with its tall grass (Fire burning it) and its breakable and timed-hazard stations inert until I4, accepted as a short gap; the pond's swimming keeps working, on the tile model's liquid rule through G1a's mesh-world seam; Q9's new liquid rules stay I4's. It retires the fixed views (D4), takes Hold out of `MODES` until G2b (`TITLE_MODES` is already `[RANGE]`), records the new range replay baseline (the range scenarios re-scripted against the station markers, WORLDGEN3D Q22.7), and sets the mesh-world perf and stuck baselines. Every map ships `lowpoly` (D11) on one fixed time of day (D12). CL's aim rule (F51) turns on here. When the bot moves onto the spatial path (it sends no crosshair ray today; THIRD_PERSON_IMPLEMENTATION.md Stage 7A), it takes the eye check and the eye launch of WORLDGEN3D CL-Q10 and CL-Q11; the fixed views retire here rather than move. F37 (determinism on Firefox, WebKit and Windows) is owed before it. It takes CL-Q9's fade-rate report on the range if I2b merged without it (F100). |
| X1b | Delete the tile stack | queued | Directly after X1a (D9). Tests whose subject is the Hold or habitat hazards and whose fixtures X1b deletes become named skips on G2b's or I4's gate list, each with an F-row, never silently deleted. It deletes the flags and their off paths (docs/OVERHAUL_3D.md "Migration rules"). Closes F1, F2, F3 (D7). |
| I4 | Hazards, surface states and destructibles | queued | After X1b (D9), on the 3D stack only, with no flags and no tile parity; it starts on what the range ships inert at X1a (the tall grass's burning, the breakable and timed-hazard stations) and owns Q9's new liquid rules (wade, float, dive, depth-relative damage), which replace the tile model's liquid rule the pond swims on from X1a (D15). G0's input is collected in WORLDGEN3D "Open items" (Input to I4): Q9 liquids, the Q10 notes, Q15(g), Q21. |
| G2b | The first 3D Hold map: hazards and the Hold | queued | D13: layer 1's liquids, timed hazards and breakables (WORLDGEN3D Q9, Q21), the sim rule for the team spawn barrier (tested on G1a's range station; Q8h, Q22a), `holdplay`, the calibrations of "Numbers that G2 measures" (WORLDGEN3D "Open items"), the Hold scenarios. It repeats CL-Q9's fade-rate report on River Gorge before Hold returns; if fading while moving exceeds CL-Q9's line there, the 2.0 m free arm applies to River Gorge's required routes inside G2b (F100). **Needs G2a, I4 and X1b**; built on the 3D stack only, with no flags and no tile parity (D9). Hold returns to `MODES` here, and the replay baseline is re-recorded once more, for the Hold (D1's note). Layers 2–5 and their mechanics are tasks after X1c. Each later layer changes River Gorge's `gameplayHash` as a planned change, named by its task, with the River Gorge scenarios re-recorded once and the reason in the commit (Q19.6); any other moved hash is still a stop. |
| X1c | Docs and instructions | queued | After G2b (D9). SB, TD, then queue items 5 and 7 follow it (D6, D7, D13). F33, F101. |
| SB | The `storybook` profile | queued | After X1c (D11, D13): the second look, added to I2a's material family and profile registry without changing either. |
| TD | The time-of-day cycle | queued | After X1c and SB (D12, D13): the running cycle (progression, partial and complete cycles, per-map cycle settings) and the developer preview controls, on I2a's one time-of-day path. The range's day/night cycle (WORLDGEN3D Q22(c)) waits for it. |

### Owner decisions (2026-11-22)

- **D1 Direction.** A three.js renderer, a mesh world (WorldModel) and Rapier physics replace the hand-written WebGL2
  tile stage and the tile column collision. This reverses the earlier advice to keep both. The replay baseline is
  re-recorded once, at the cutover (X1a), named in that commit. Until X1a no shipped behaviour changes.
  *(Owner, 2026-11-25, D9: the baseline is re-recorded at X1a on the range and once more at G2b for the Hold. D8: the
  frozen tile game may drift or break in tile-only corners before X1a.)*
- **D2 Determinism** stays a hard rule: fixed 1/60 s ticks, one seeded RNG stream per system, physics inside the sim
  using Rapier's cross-platform deterministic build. Physics state is part of the replay hash.
- **D3** Creatures stay PMD 8-direction pixel billboards in the 3D world. How they read from above or below during
  flight is accepted for now.
- **D4** The fixed north-up camera views retire at X1a. Third person is the only view.
- **D5** The Pokémon-location generator (`world/locations`, `world/locgen`) stays until X1b and is deleted with the
  tile stack.
- **D6** T1 co-op waves, T2 3v3 hero bots and multiplayer come after the overhaul. Netcode stays out of scope (pivot
  Q1) until the owner reopens it; the foundation keeps per-player input and physics that can be snapshotted.
- **D7 Roadmap:** item 6 dropped, item 4 narrowed, F12 folded into I1a and P6 into I3, F1 to F3 closed at X1b, P1
  after X1c.

**The re-plan (owner, 2026-11-25, evening): D8 to D14. Where one supersedes or amends an earlier record, that record carries a dated note.**

- **D8 The old game is frozen.** With every flag off, the tile game is no longer a product requirement; it may drift or break in tile-only corners. Merges still deploy it until the cutover (no workflow change). It stays as test ground until X1b.
  - Flag-off `scripts/checksum.ts all` keeps running. A flag-off hash moved by a change the task names is re-recorded once with the reason in the commit; an unexplained move is still a stop.
  - The other flag-off gates (navwalk, stuckwatch, habplay, habstate, habaudit, hazplay, perf-sim, `range.py` on the old renderer) are no longer required. Tasks don't change tile-only code except to delete it.
  - New behaviour is judged on its own gates, not by matching the tile game. Rules that tie flag-on behaviour to the tile game's (e.g. F66's "walks down exactly the drops the tile game walks down") no longer bind later tasks. A test whose only subject is "flag-on equals tile" may be retired by the task that improves on it, named in the report, with the reason in the commit. Every other test is still never edited to pass.
  - The habitat and location generators are frozen: no `HAB_VERSION` or `LOC_VERSION` change and no work on them. The "layout would move" stop goes with them; the stop on an unexpected `gameplayHash` move of a generated map stays (WORLDGEN3D Q19).
  - With both flags on, the stuckwatch gate is "no TRAPPED". The identity comparison against the flag-off run stays as a diagnostic tool.
  - I1b's answers, given before D8, stand as recorded.
- **D9 The cutover is the training range** (supersedes G0 answer B of 2026-11-24).
  - X1a makes the 3D stack the game once the 3D range plays. It needs I1c, I2a, I2b, G1a and G1b, not I4. The range's liquid, breakable and timed-hazard stations are built as geometry by G1a, and the range gate lists them as inert until I4. *(Amended by D15: the pond's swimming keeps working at X1a; Q9's new liquid rules stay I4's.)*
  - X1a retires the fixed views (D4), takes Hold out of `MODES` until G2b (`TITLE_MODES` is already `[RANGE]`), records the new range replay baseline, and sets the mesh-world perf and stuck baselines.
  - X1b follows X1a directly. Tests whose subject is the Hold or habitat hazards and whose fixtures X1b deletes become named skips on G2b's or I4's gate list, each with an F-row, never silently deleted.
  - I4 and G2b then build on the 3D stack only, with no flags and no tile parity. X1c runs after G2b. River Gorge layer 1 stays G2's scope; layers 2 to 5 stay after X1c.
- **D10 Engineering choices** (amends CLAUDE.md "Working with the owner", the stop list).
  - Claude Code makes an engineering choice itself when all three hold:
    - it can be undone without moving a recorded decision, a contract other systems read, or a shipped baseline;
    - a test or gate covers it;
    - it has a measurable acceptance criterion.
  - It records each such choice where the task's records go (alternatives, numbers, why), and the report lists them under a new heading "Decided without asking", placed after "deviations from the brief".
  - It still stops for:
    - design, feel, look or scope, or anything a player experiences as a rule;
    - anything costly to undo: a contract, a version bump that regenerates baselines, the renderer or shading language, removing something no task names;
    - an unexplained replay or `gameplayHash` move;
    - a test that looks wrong.
- **D11 Low-poly first** (answers WORLDGEN3D Q23.1 for the cutover). `lowpoly` is the look that ships at the cutover; `storybook` moves to its own task after X1c (SB). I2a builds the material family and the profile registry with `lowpoly` only, so adding `storybook` later is additive. I2b, G1b and the lints target `lowpoly`.
- **D12 Fixed time of day at the cutover** (amends WORLDGEN3D Q23.2).
  - Every map ships one fixed time.
  - I2a reads all lighting (the sun, the two sets of six ambient colours, fog, grading, the lamp channel's strength) from one time-of-day value through keyframed per-map data, with a dev URL parameter to set it. A test pins that changing the value changes the lighting through that one path, so a cycle can be added later without architectural change.
  - The running cycle (progression, partial and complete cycles, per-map cycle settings) and the developer preview controls are a task after X1c (TD). The range's day/night cycle (WORLDGEN3D Q22(c)) waits for it.
- **D13 Task splits and order** (from the owner's efficiency audit).
  - G1a (world side): the IR types, the kit, `build`, `emit`, gate classes A and C, the 64-bit hash, the dressing interface, the range as authored space IR with its stations, `scripts/worldcheck.ts`, and the "Numbers that G1 measures" that need no renderer. Needs WM2, I1b, I3, CL. Stop and report if it needs any I2a piece.
  - G1b (render side): the render-side mesh builders, the kit-piece skin list, hull-proxy visuals, the range's readability lints, `range.py` with every flag on and `?render=three`. Needs G1a, I2a.
  - G2a (headless): `plan`, `embed`, the Hold template with all five route roles, gate classes B, D and E, the repairs, the curated-seed fallback. Needs G1a.
  - G2b: layer 1's liquids, timed hazards and breakables, the spawn barrier, `holdplay`, the calibrations of "Numbers that G2 measures", the Hold scenarios. Needs G2a, I4, X1b.
  - Order: lane A, a gate-runner task (GR; its own prompt) → G1a → G1b → G2a; lane B, I2a → I1c → I2b; then X1a → X1b → I4 → G2b → X1c. After X1c: storybook (SB), the time-of-day cycle (TD), then P1, T1, T2 as before.
- **D14 Follow-ups F39, F77 and F49.**
  - F39 waived: S2 decision 1 (WebGPURenderer + TSL, WebGL 2 fallback by its backend) stands without the lower-end-machine condition; measure one if it turns up.
  - F77 answered, widen: on generated maps the narrow clear-width rung (WORLDGEN3D Q7's table, 1.10 m) becomes 1.20 m; G1a pins it with a test that a 1.20 m neck is open to the 5-cell narrow agent at every plan offset and refused to Large. The 5-cell narrow agent stays, and G1a recomputes and lists every number derived from the rung. *(Wording from the owner's review of RP, 2026-11-25: it replaces "at least 1.20 m" and a measure-plus-margin step.)*
  - F49 closed. The blueprint is "Map and Environment Generation Blueprint" (the owner's claude.ai project "map generation", exported 2026-11-24). The claude.ai reviewer checked every quote and departure WORLDGEN3D attributes to it on 2026-11-25, and all match: §7's heightfield per terrain chunk; rule 4 (trimesh only for SDF features); milestone 12 (SDF caves); the zone-graph node set; the phantom-concealment lint; ranked maps as validated bundles; the expert layer; Zod; three style families and shading models; report 1's 150,000 trimesh triangles. WORLDGEN3D is the record. The blueprint is kept in the owner's claude.ai project, not in the repo.
- **D15 The 3D range at the cutover** (owner, 2026-11-25, in the review of RP; amends D9).
  - X1a ships the 3D range with its tall grass (Fire burning it) and the breakable and timed-hazard stations inert until I4. Accepted as a short gap.
  - The pond's swimming keeps working at X1a. G1a's mesh-world seam answers liquid contact from the model's liquid volumes with the tile model's rule (no bed, F25), so swimming behaves as it does today; on the physics flag, `physseam.liquidContact` forwards to the tile world now.
  - Q9's new liquid rules (wade, float, dive, depth-relative damage) stay I4's.

## Item 3: A1 plan (2026-11-22)

For the hero shooter. It replaces `docs/archive/size-extremes-plan.md` "Proposed stage A1", whose loader keyed on stages,
spawn tables, elites, bosses, recruits and regions (all deleted at the pivot). Owner decisions, 2026-11-22: no
single-file variant; the hero pick is one portrait sheet fetched at boot, nothing inlined; the dev roster's "All
Pokémon" portraits load as rows scroll into view; a match starts only when its art has loaded; cries may load on first
use.

1. **Build.** `scripts/build.mjs` writes `dist/art/` from `src/content/art.json`, every name content-hashed: per species
   the atlas PNG, a frame table (JSON), the portrait PNG and the cry (OGG and its MP3 transcode); `heroes.<hash>.png`,
   one sheet of every `PROTOTYPE` portrait; `manifest.<hash>.json`, with each species' file names, credits, licences,
   cry facts and the clip report the Credits table shows. The bundle is given the manifest's and the sheet's names at
   build time. `dist/poke-watch-artifact.html` is no longer written.
2. **Boot.** The manifest and the hero sheet, fetched together. The title and the hero pick need nothing else. Cries
   are registered with their file names and fetched and decoded on first use.
3. **Match.** `startRun` builds the run as today (the pointer lock is still asked for inside the Start click); the sim
   does not step until the match's art has loaded, behind a short loading line. The set comes from the run itself
   (`matchArt`, `src/sim/matchart.ts`, runs in Node): every squad member's whole line, the run's target set, and the
   Raid party's species when the mode holds a point. A test plays the range and a Hold and checks that every species
   that appears, and every form a Breakthrough reaches, is in the set.
4. **Placeholders** only for a species nothing can know in advance (`pokewatch.spawn` and other dev parameters): it
   draws as a placeholder of its size class while its art loads on first sight.
5. **Dev roster.** Each "All Pokémon" row fetches its portrait when it scrolls into view. Its art check reads the
   manifest, not the loaded art.
6. **Music.** The adaptive score's seven MP3s (9.9 MB, about 13 MB as data URLs) leave the page too, as `dist/music/`
   files: the 3 MB budget cannot hold with them inline. They were already fetched and decoded after the audio unlock.
7. **Unchanged.** The sim (no replay hash moves), Node tests and scripts (they keep reading `src/content/art.json`), the
   content build.
8. **Tools.** The page fetches its art, so it no longer runs from `file://` in a plain browser. The tools that open
   `file://` launch Chromium with `--allow-file-access-from-files`. `pokewatch.ready` waits for a `?go=1` match's art,
   and `pokewatch.loading` is true while art is in flight (`cap.mjs` and `range.py` wait on it).
9. **Gates.** `dist/index.html` ≤ 3 MB (the build fails above it); the Pages workflow stages `dist/art/` and
   `dist/music/`; capture parity (the same frames with inline and loaded art); boot-to-title and pick-to-play before
   and after; the Ghostery click cost before and after; no replay hash moves; `range.py` passes.

**Results (2026-11-22, `perf/a1-art`).** `dist/index.html` 1,425 KB (was 26,040 KB); `dist/art/` 976 files,
9.4 MB; `dist/music/` 7 files, 9.9 MB. Beyond the plan: the title's backdrop run draws Charmander, so boot also loads
that one species; the hero pick prefetches the picked hero's line and the mode's species (Start still waits for the
run's real set); the score's MP3s are fetched one at a time at low priority, so they do not crowd out a match's art;
`node scripts/build.mjs --out <dir>` replaces copying the build script for private builds (its art writer is a sibling
module).

| Gate | Before (`main`, `e72ded5`) | After |
|---|---|---|
| Page size | 26.7 MB, 1 request | 1.43 MB; boot fetches 1.77 MB in 6 requests (manifest 242 KB, hero sheet) |
| Boot to title, local http (median of 5) | 1,302 ms | 596 ms |
| Boot to title, 20 Mbps / 40 ms (median of 3) | 12,072 ms | 1,422 ms |
| Pick to play, local, Start 1.5 s after the pick opens | 368 ms | 430 ms (the score still downloading and decoding in the background) |
| Pick to play, local, Start after 6 s | 377 ms | 392 ms |
| Pick to play, 20 Mbps / 40 ms | 365 ms | 435 ms (1,150 ms before the score's fetches were serialised) |
| Ghostery, canvas clicks (`?go=1`, 6) | 0 ms each, no long task | 0 ms each, no long task |
| Ghostery, title clicks (4) | first click 192 ms long task | first click 144 ms long task; without the extension 175 → 134 ms: the game's own first click (audio unlock), not Ghostery |
| Capture parity, 19 scenes, 60 game-canvas frames | | 60/60 identical (a second `main` run: 60/60) |
| Capture parity, 128 page screenshots | | 114 identical; the rest are the camframe `open-*` scenes and one Breakthrough banner, which differ between two runs of the same `main` build too (CSS fades and slides on wall-clock time) |
| Replay hashes | | 10/10 as recorded |
| `range.py` | PASS | PASS (Snorlax dummy 320.9 → 163.9 in both) |

The Ghostery stall itself was already gone after F13; A1 does not change the canvas-click cost.

After the owner's review: a species whose fetch failed is fetched again on the next `ensure()` (a match start, a hero
pick), once per call; first sight does not retry (`tests/loader.test.ts`). F18 closed. Deferring the score was
measured and declined (F19).

## Open follow-ups

From `docs/hero-shooter-pivot.md` §11 unless marked. The queue item each belongs to is in brackets.

### Navigation and performance

- **F1. Enemy stuckwatch episodes: 31 over 217 415 enemy-seconds** [T1, P6]. Navigation, not the crowd's placement
  (pivot §11 "Before step 10"): small walkers jam in a staircase-wall notch on Viridian Forest seed 1 (15); walkers at
  the ledge lip above River Gorge seed 3's pocket, the same fault that TRAPs the player 3 times at (−28.6, 16.4) (9);
  the wide field against `moveBody` at a prop corner on Volcanic Ridge seed 3 (1); six single walkers elsewhere.
  Logged, not fixed; `stuckwatch` not re-baselined. Superseded by the overhaul; closed at X1b. **Not reproduced on the
  navmesh (I3, 2026-11-25):** `stuckwatch all 3 --nav navmesh` has no episode at any of the three sites (nor the 3
  TRAPPED player episodes at River Gorge seed 3), with the narrow agent at 5 cells and at the 4 of the review (F77); its own episodes (12 at 4 cells) are in F85. **With the partner on physics (I1b, 2026-11-25):** the 3 TRAPPED player episodes at River Gorge seed 3 (−28.5, 16.5; t 15, 20, 25: ticks 900, 1200, 1500, tile −29,16) reproduce exactly with `--physics rapier`, matched by identity against the flag-off run (`stuckwatch --save`/`--compare`), because F70's exact moves put the partner on the tile path into the pocket; the cause is the enemy crowd at the ledge lip, which moves on the tile World until I1c (owner O2). Owner now (the owner's record, 2026-11-25): I1c, whose gate is stuckwatch with the flags on and no TRAPPED; F1 closes at X1b.
- **F2. perf-sim spike on Totodile seed 1** [P6, before T1's crowd]: ticks up to 18 ms after about 199 s,
  deterministic. The exposure system's pond shore search for enemies knocked into the pond. Within the gate's p95 / p99;
  cache or bound the shore search. Superseded by the overhaul; closed at X1b. **Not reproduced on the navmesh (I3,
  2026-11-25):** with `rules.nav.engine = 'navmesh'` the enemy's shore is the nearest reached navmesh within 16 m
  (`NavBridge.shoreFor`), a search bounded at 289 locate buckets; perf-sim's tick max falls from 17.1 to 1.28 ms (min of
  3; 17.3 to 3.75 ms at I3). The tile path, flag off, is unchanged.
- **F3. 54 `ready` species exceed the frozen habitat profiles** (footprint 0.88 m, eye 1.42 m: Onix, Lugia,
  Wailord…) [6]. Making one a hero re-measures `profilesFor`, which moves accepted layouts. Superseded by the
  overhaul; closed at X1b.

### Balance and design

- **F4. Hold is easy for a ranged hero** since the Bulwark went (Charmander's mean damage taken 60 → 10, lowest health
  171 of 208); every `rules.enemy.behaviourHp` is 1 [T1 or T2].
- **F5. Kit tuning**: `KIT_TUNING` logs Bagon, Graveler, Golem, Magneton, Magnezone and Diglett beside `HERO_KITS`
  [no slot yet].
- **F6. How a Breakthrough chooses a branch** [decision]. Snorunt, Tyrogue, Nincada, Applin, Cosmoem and Sneasel have
  more than one next form, so none is linked and no branching line is a hero. Options: a choice at the Breakthrough, a
  rule by stat or form, or one authored branch per line.

### Tools and dead paths

- **F7. Scene files after the bare-`?go=1` change** [no slot yet]: a bare `?go=1` opens the range arena, so scene
  files whose queries name no map capture the arena, and many still carry dead parameters (`calm`, `level`,
  `autopick`).
- **F8. `tools/perf.mjs` and the `play` phase of `tools/audiocheck.mjs` need a map with a crowd** [2, T1]. Their URLs
  ask for the survivor boss fight, which now opens the training range: their numbers are not comparable with the
  survivor build's. Needs T1's wave or a dev parameter that runs `scripts/lib/crowd.ts` in the page.
- **F9. Survivor leftovers with one caller each** [no slot yet] — **partly closed** (C1, 2026-11-23): `audio.boss()`,
  `portal()` and `pickup()` (only the Maplebrook overworld called them) and the `chest` event (with the chests) are
  gone. Still there: `onBossSpawn` and the `boss` music state (`tools/musiccheck.mjs` drives the climax through it),
  and the `learn` and `stageStart` events (one emitter each).

### Found in C1 (2026-11-23)

- **F20. CLAUDE.md lines C1 made stale** — **done** (2026-11-23, owner review of C1): "Modes and mods" says `RANGE`
  runs "with `solo`", and the subsystem-doc list no longer names WORLDGEN (its W4 materials rules are in
  `docs/SYSTEMIC.md`).
- **F21. Camera benches lost their rough-terrain regions** [I2b]: `scripts/camaim.ts`, `scripts/camstats.ts` and
  `scripts/lib/cambench.ts` run `mode: 'generated'` over stages 0–3 by default; the badlands and frost stages were
  classic regions and are now the handcrafted arenas, so the benches' numbers do not compare with earlier runs. The
  tests no longer depend on that default: `stepAim` and `modeTrack` take an optional worldgen override, and the 9
  restored tests pin their maps (camaim A/C/D, camstability ×3 and the viewsample replay: Cinder Crater for badlands,
  Memorial Ridge for frost, the default locations otherwise; camaim E2: Cascade Lagoon map seed 4, the only habitat or
  location map with a bare 0.5 m step in seeds 1–30; habstate ice ×3: Shrine Gorge). Pointing the benches' own
  defaults at those maps is still open.
- **F22. `SpeciesDef.ability` and `rules.damage.stabAdaptive`** [no slot yet]: only the deleted original creatures set
  `ability: 'adaptive'`; `sim/combat.ts` still checks it on every STAB hit (always false). Left in place (a sim edit
  outside the brief).
- **F23. The habaudit `sim` digest** [next habaudit regeneration]: `scripts/habaudit.ts` no longer hashes chest
  positions, so a fresh run changes the `sim` field of all 24 entries in `docs/habaudit/baseline.json` and nothing else
  (checksum, geometry, paint, nav and the six layout sheets are byte-identical; `main` with only that hash line removed
  gives the same digests, e.g. river-gorge seed 3 `46929314` → `55812614`). The committed baseline is unchanged.

### Found in C2 (2026-11-23)

- **F24. CLAUDE.md's first architecture rule predates C2** — **done** (WS, 2026-11-23): the rule now matches README rule 1 and names `tests/imports.test.ts`. Was: it still reads "`src/sim/` and `src/world/` never import `render/`, …" and does not say that `src/world/` never imports `src/sim/`, the overhaul's `three` / Rapier / recast rules, or that `tests/imports.test.ts` enforces them (README §Architecture rule 1 has the full list). Left alone: CLAUDE.md is outside the brief.

### Found in P5 (2026-11-21)

- **F13. Unlocked clicks paid the Ghostery stall too** [2] — **done** (2026-11-21, `perf/stutter`). The capturing click and every click in the fixed views (no lock) target the canvas, whose third ancestor is `<body>`. The inline `<script>` now removes itself at the end of its synchronous start (`index.html`: `document.currentScript?.remove()` after the bundle, so the bundle's `"use strict"` stays first; the engine keeps the source). Nothing reads the element: no `currentScript`, `document.scripts`, script query or page serialisation in `src`, `tools`, `tests`, `scripts` or the bundle; the deploy copies `dist/index.html` only. With Ghostery, 26.7 MB page: unlocked canvas clicks 0–1 ms (were 103–132 ms), the capturing click no long task (was 121 ms), locked clicks 0 ms (as with the window-capture fix alone). Title-menu buttons never reached `<body>` within three ancestors: 0 ms before and after.
- **F14. Mouse-look gaps** [2, parked by the owner]: the overlay's "mouse look gaps" (a frame with no look movement while the mouse moves) read as judder. A timestamp-based look resampler would add up to a frame of latency; an owner decision, parked.

### Found in A1 (2026-11-22)

- **F15. Page screenshots are not repeatable** [tools, no slot yet]: two `cap.mjs` runs of the same build differ in the
  camframe `open-*` scenes and in DOM layers animated on wall-clock time (the map plaque's slide, the hurt vignette, the
  Breakthrough banner, the HP bar's transition). The game canvas is repeatable (`raw` steps: 60/60). Parity checks
  should compare `raw` frames, or capture mode should freeze CSS animations.
- **F16. The art manifest is 242 KB** [no slot yet]: every species' provenance (SHA-256 per source file, fetch date)
  rides in it for the Credits screen's checksum column. It could move to a second file fetched by the Credits screen.
- **F17. Cries are OGG only** [pre-existing, no slot yet]: the bundle carries no MP3 transcodes (docs/ASSETS.md), so a
  browser without Vorbis (Safari) plays no cries. Unchanged by A1.
- **F18. No Python `playwright` on this machine** — **done** (2026-11-22): `tests/browser/requirements.txt` pins
  `playwright==1.65.0`; setup in `tools/README.md` "Python checks" (a gitignored `.venv`).
- **F19. Fetch the score after the first match's art?** — **declined** (owner, 2026-11-22): about 40 ms of pick to play
  is not worth silent menus; the music keeps playing on the title and hero pick. Measured on `perf/a1-art` (Start 1.5 s after the
  pick opens, same session): pick to play local 445 → 409 ms, 20 Mbps / 40 ms 430 → 391 ms (`main`: 368 / 365). The
  cost: the title and hero pick are silent until the first match starts, and `tools/musiccheck.mjs`, which waits for
  the score on the title, would need to start a match. Not applied. The change is small: `Audio.unlock` creates the
  player but loads it only after an `allowScore()` that `main.ts loadMatchArt` calls once a match's art is in.

### Found in WM (2026-11-23)

- **F25. No water bed** [I1a / I4]: on every map, every water tile's `elev` lies above its surface. The column model has no bed (spatial.ts: liquid down to −∞), so the adapter puts no collider under a liquid, and its volume runs from the bounds floor. Physics needs a bed depth (a rule or generator data) before bodies sink in it.
- **F26. Wall under a deck: two rules** [I1a]: spatial.ts ends a wall column at the deck's underside; World.wallTopAt does not. The adapter follows spatial.ts. This affects 36–55 tiles per River Gorge map, 1 on Shoal Grotto seed 3 and 1 on Cascade Lagoon seed 1.
- **F27. Bare walls are 8 m+ boxes** [G1]: the low ruin and cemetery walls (1.1–1.4 m, stored as bare walls) become full-height boxes, the recorded limitation in docs/SIZING.md "Wall tops". The generators fix it, not the adapter.
- **F28. Adapter gaps by design** [I1a / I3]: every deck is `wood`, rock shelves included (ArenaMap does not say which is which). The stairs wedge between the ramp and its base box is left open; only the range has stairs (2 ramp triangles). No kill volume, because killY comes from `rules.hazards.killDepth`, not from map data. The contest is a marker (a cylinder, not a box). Ice, tides, burning and breaking are run state: colliders carry the prop index as `destructible`, and the model is the map as built. *I1a:* the physics bridge (`sim/physseam.ts`) fills the stairs wedge with query-only hulls, reads ice and chasms from the World, and rebuilds from the live map after a geometry change (F57); the adapter is unchanged.
- **F29. Conformance gate runtime** [tests]: `tests/worldmodel.test.ts` takes about 11 s, mostly map generation and World construction (the adapter itself runs in 14–38 ms per map). *(WM2, 2026-11-25: 12–19 ms per map, the median of 7 runs, against 14–23 ms on main by the same measure.)*

### Found in WS (2026-11-23)

- **F30. 77 column calls pass `GROUND`** [I1b, I1c]: `surfaceAt`, `walkableAt`, `nearestWalkableAt`, `place` and `setNavGoal` calls with no reference height (spawns, relocations, grounded checks, the bot's probes). Each needs a real y on the physics path; that changes behaviour, so it lands behind the physics flag. `grep -rn GROUND src/sim` lists them.
- **F31. World readers outside the seam** [I2a, X1b]: render (`renderer.ts` 33 `height` calls, `chaseinput.ts`, `camera.ts`), `ui/ui.ts` and about 1,500 accesses in tests and scripts read `World` directly (`SimContext.world` stays typed `World` on purpose, Q1). Render moves at I2a; the tile tests and gates go with the tile stack at X1b. **Narrowed by I2a (2026-11-27):** the three.js scene reads the WorldModel (through `render/threeload.ts`) and sim state, never `World`; its one tile read is `World.height` for the tile lamps' emitter heights (`render/world3d/tilelamps.ts`, deleted at X1b). The page renderer's reads stay: its tile stage goes at X1b, and the camera's (`chaseinput.ts`, `camera.ts`) move with I2b's rig.
- **F32. `W.tiles.hazards` and `W.tiles.los`** [I1a]: World copies of `rules.hazards.enabled` and the location maps' "terrain blocks shots" flag, kept as tile extensions so nothing changed. A mesh world has no `los` off state; I1a decides whether the physics path reads `ctx.rules` and drops both.
- **F33. Subsystem docs name the tile World's methods** [X1c]: docs/LOCOMOTION.md, SIZING.md and HAZARDS.md describe `World.moveBody`, `topUnder`, `inRock`, `liquidAt`, `nearestFit` (still accurate: the seam calls them), without the seam names. Rewrite with the 3D docs.

### Found in S1 (2026-11-23)

- **F34. Stepping** [I1b]: Rapier 0.21's autostep climbs a 0.5 m step only above about 4 m/s head-on and rarely at
  45°, and with autostep 0.6 it climbs 0.62–0.78 m. The tile sim climbs any rise up to 0.6 m at any speed and angle,
  and the navmesh (walkableClimb 0.6) will claim the same. The partial fixes and the test matrices are in
  docs/spikes/S1-physics.md §7 "Steps". 0.5 m is not enough: over the 28 map sources of `tests/worldmodel.test.ts`
  there are 227 rises between adjacent walkable tile tops in (0.5, 0.6] m (147 in (0.5, 0.55], 80 in (0.55, 0.6];
  none on the range, River Gorge 14–21 per seed; owner's count, 2026-11-23). Owner (O4): I1b's own step rule must
  climb every rise ≤ 0.6 m for every class at 0.5–9 m/s, head-on and at 45°, and refuse ≥ 0.62 m; G0 keeps generated
  rises out of a dead band below the lowest blocking ledge. **Closed (I1b):** Rapier's autostep is off and our step rule (the roll since I1b's second fix round, F69)
  (`src/physics/controller.ts`) meets the gate: `tests/stepping.test.ts` climbs 0.3, 0.5, 0.55 and 0.6 m for every
  class at every speed and both angles and refuses 0.62, 0.65 and 0.8 m; on the adapter maps' real rises navwalk on the
  flag reaches every mandatory target with every class. The dead band is G0's (WORLDGEN3D Q6).
- **F35. The adapter's render surfaces are not collision-grade at stairs** [I2a, G1]: a stairs tile is drawn as a
  column at the ramp's mid height plus the slope quad, so 0.5–1 m lips stick up through the drawn ramp (the range's
  flight). Physics must build from the colliders; the renderer shows the lips too.
  **I2a (2026-11-27):** unchanged: the 3D scene draws the adapter's chunks as they are, lips included; G1b's builders
  draw from generated geometry.
- **F36. No run or map disposal for physics** [I1a]: an unfreed Rapier world leaks about 1.7 MB of wasm memory (River
  Gorge), and wasm memory never shrinks. `createRun` has no dispose step, and `npm test` builds runs by the hundred.
  This needs a dispose entry point and a flat-memory check in the shared test setup (decision O7). **Closed (I1a):**
  `disposeRun(ctx)` and map changes free the world; `tests/physics.test.ts` asserts flat wasm memory over 50 runs.
- **F37. Determinism coverage** [I1a, before X1a]: shown on macOS arm64 and Linux x64 with V8 only. Firefox,
  WebKit, Windows and the snapshot round trip (D6) are untested (decision O8). **I1a:** the snapshot round trip is in
  `tests/physics.test.ts` (Node, this machine). Firefox and WebKit page runs and Windows are still open, before X1a.
- **F38. The loader depends on wasm-bindgen glue internals** [I1a]: `__wbg_set_wasm`, the import module name
  `./rapier_wasm3d_bg.js` and the extensionless `raw.js`. A Rapier upgrade can break it, so keep the exact pin and a
  load test. The Node path needs Node ≥ 22.15 (`module.registerHooks`). Owner (O1): I1a adds
  `"engines": { "node": ">=22.15" }` and the load test. **Closed (I1a):** both added (`tests/physics-load.test.ts`).

### Found in S2 (2026-11-23)

- **F39. Renderer timings on a lower-end machine** — **waived** (owner, 2026-11-25, D14): S2 decision 1 (WebGPURenderer + TSL, WebGL 2 fallback by its backend) stands without the lower-end-machine condition; measure one if it turns up. Was [owner, before I2a]: S2 measured only an M3 Max, which idles through every scene, and step 4 (the owner on a weaker machine) was recorded as not measured; the WebGPURenderer choice would have reopened if `forceWebGL` missed the budget where WebGLRenderer met it. If a machine turns up: URLs and what to read are in docs/spikes/S2-renderer.md "Step 4". WebGPU needs a secure context (`navigator.gpu` exists only on HTTPS or localhost): copy the `S2_THREE=all` build folder to the lower-end machine and serve it on that machine's localhost, or use HTTPS; the Mac's dev server over the LAN has no WebGPU. The frame budget there stays a proposal until then.
- **F40. WebGPURenderer's output pass** [I2a]: with sRGB output it renders into an RGBA16F target and blits it with the colour transform: one more call and up to +0.9 ms GPU on this GPU when sprites overdraw (an RGBA8 target does not help). Owner (S2 decision 2): a `RenderPipeline` from the start, ending in `renderOutput`; no sRGB in the materials. **Closed (I2a):** one `RenderPipeline` whose final quad applies `renderOutput`, grading, the vignette and the signal composite (`outputColorTransform` off); no separate output blit, no sRGB in the materials (docs/RENDER3D.md "Pass order").
- **F41. The x-ray silhouette shows the player's feet** [I2b]: the sprite's lowest rows sit below the adapter's ground surface, so `GreaterDepth` draws them through the ground the Pokémon stands on (both renderer paths). Needs a depth bias or a test that ignores the ground under the subject.
- **F42. TSL churn and typings** [I2a]: renames inside 0.18x (`directionToColor` → `packNormalToRGB`, `PostProcessing` → `RenderPipeline`), `PCFSoftShadowMap` removed in 0.187, and `@types/three` 0.187 rejecting valid TSL calls (the spike casts them to `any`). Owner (S2 decision 6): three pinned exactly, upgraded as its own task with the S2 matrix re-run; I2a brings `tools/s2perf.mjs` and `tools/s2matrix.mjs` into `tools/`. **Closed (I2a):** three and `@types/three` pinned at 0.187.0; `tools/s2perf.mjs` and `tools/s2matrix.mjs` ported to the game page. The typings still reject valid TSL calls (`src/render/three` casts node chains to `any`), and I2a uses one internal (F103).
- **F43. Look of the three.js frame** [I2a]: the spike's frames are paler than the art direction (Lambert, untuned light intensities, three's linear fog instead of `FOG_GLSL`'s squared ramp and veil, the x-ray colours passed through the output transform under TSL). No art judgement was made in S2. **Narrowed (I2a):** the scene now transcribes today's look: binding colours from the old tables, light calibrated so an open top shows its base colour at the map's fixed hour, `FOG_GLSL`'s squared ramp and veil, today's banded sky. Every new look value (ramp, paint, ink, bloom, the hours, the key-to-ambient split) is open: docs/RENDER3D.md "Look values" [owner]. The x-ray colours are I2b's.
- **F44. Creature shadows** [I2b]: billboards can cast card shadows (free under TSL; a `customDepthMaterial` under WebGLRenderer), but a card faces the main camera, so its shadow turns with the camera's yaw. Owner (S2 decision 4): blob decals, as today; the decal work is deferred.

### Found in I1a (2026-11-25)

- **F57. A physics rebuild costs about 16–23 ms** [I4]: a run-time geometry change (a prop burns or breaks, the tide turns, water freezes or thaws) rebuilds the whole physics world at the next query. Re-measured on WM2's adapter (2026-11-25, median of 7 after a warm-up, the bridge's own rebuild): range 16.0 ms (13.9–33.4), River Gorge seed 1 22.7 ms (22.3–24.2). Of that the adapter is 11.1 / 15.1 ms (most of it the render surfaces physics does not read), the extras 0.6 / 1.1 ms, Rapier 2.9 / 6.5 ms. Before WM2's welded surfaces it was 25–50 ms. No replay track changes geometry (one build each, asserted in `tests/physics.test.ts`), so it is in no gate. I4 owns the incremental update (remove and add the changed tiles' colliders), or a model build that skips the surfaces.
- **F58. Sweeps stop up to about 1 cm short** [I4]: Rapier's shape cast stops within its GJK tolerance, a few millimetres before contact (decimetres of t on a grazing approach); rays are exact to f32. Shots with a world radius stop a little before walls on the physics path. Nothing in the replay tracks moves by it. *I1b, narrowed:* the character controller keeps a 1 cm offset from everything, so a cast stopping millimetres short changes nothing it does; the other side of the tolerance did matter: a capsule cast grazing a step's edge on its way down can end 2–5 cm past contact (River Gorge seed 2, Chargestone Cave seed 1). The controller takes a set-down or a step landing only to a pose its capsule fits (an intersection test), backing off by offsets (`src/physics/controller.ts`). Left for I4: shots with a world radius.
- **F59. skipInitialWorld skips a merged box whole** [G1]: on physics a collider containing the start is ignored entirely, on tiles only the start's own tile column (parity D6). Only the camera trace skips (from the partner's chest plane). The mesh world's chunks make it larger; **Narrowed by CL (2026-11-25, WORLDGEN3D CL-Q13):** under `rules.aim.viewSight` the crosshair trace starts at the eye's plane with the skip, and the shot's own sweep starts at the eye point with no skip on both engines, so D6 moves only the aim point T, never whether a shot passes a solid. With the flagged aimbot (CL-Q12, with its harness pull-in) the trace start lies inside a solid on 207 of 3,600 Grotto ticks and 371 of range-swap's (unflagged: 1,360 and 209), and that moves only the aim point. What remains is that aim-point difference, re-measured on the mesh world at G1. *I1b, narrowed:* the controller never uses skipInitialWorld; its casts start from a capsule that touches at most what it rests on and use Rapier's `stopAtPenetration: false`, which lets a shape move away from a collider it starts in contact with and still meets every other.
- **F60. The far field** [G1]: the tile columns are infinite (walls and the map edge up, the ground down); physics stops at the model's bounds floor and EDGE_PAD (64 m) above its top (parity D5). Matters only for rays leaving the play space.
- **F61. Concealment volumes and the sight-only kinds** [I4, G1]: the query modes keep shots and sight apart and read each collider's `blocksSight` directly. WM2 added the `concealment` volume kind to the model (WORLDGEN3D Q12.9, Q15.4 `screen`), but nothing writes one until I4 or G1, so physics builds nothing from it yet and nothing blocks sight only. Whoever writes the first one adds it to `PhysicsWorld.build` as a sight-only, query-only piece that sight rays from inside pass (Q12.9).
- **F62. Physics in the replay hash** [I1b]: D2 says physics state is part of the replay hash. I1a's world is static and query-only, a function of the map, so `replayHash` reads nothing from it; I1b's bodies and controllers must be hashed. **Closed (I1b): nothing to hash.** The controller adds no rigid body. Its capsule colliders (collision groups 0, so no query meets them) are set to the body's position before every move, so their stored position is never read before it is overwritten, and Rapier's controller object holds settings only (its computed results are read in the same move). The next tick depends on the sim state alone, which `replayHash` already covers (position, vertical speed, grounded). The snapshot round trip still holds (`tests/physics.test.ts`: the restored world reuses the capsules by handle; the next 600 ticks hash as the original). The first kinematic body (a moving platform, F67) is state a later tick reads, and enters the hash with it.
- **F63. F32 left as it was** [X1b]: the physics path reads `W.tiles.los` (enemy fire on location maps) and `W.tiles.hazards` (chasms are voids only with hazards on) exactly as the tile World does; dropping them waits for the mesh world. The page bundles Rapier's JS always (+249,936 B on `dist/index.html`) and fetches the wasm only with `?physics=rapier`.

- **F64. The physics seam's forwarding costs about 0.05 ms at p95** [I1b]: with the flag on and no crosshair ray, Rapier answers nothing in perf-sim, yet p95 rises 0.674 → 0.728 ms (min of 3): every world call site now sees two receiver types (World and PhysicsSeam) and goes through one more call. I1b moves the movement members to physics anyway; if the forwarding stays, World can hold the bridge and branch in its four ray wrappers instead. **Closed (I1b): World holds the bridge.** The movement members cannot move to physics in I1b: enemies, bodies, the bot's probes and placement call them and stay on the tile World until I1c, and the partner's controller is a resolver of its own (`World.mover`), not a seam member. So `worldOf` returns the World, which branches in `raycast`, `segmentClear`, `solidAt` and `sight` (`PhysicsSeam` stays as a view for `tests/physics-parity.test.ts`). perf-sim 500 --repeat 3 --gate, min of 3, the same machine and session against `main` (25e20ed): flag off 0.685 / 0.940 ms against 0.686 / 0.942 (p95 / p99, no cost from the branches). With the flag on the two do different work, since the partner now moves on the controller and the crowd follows a different path: 0.921 / 1.059 against 0.743 / 1.017 (with `--aim` 0.896 / 1.035 against 0.681 / 0.994). Physics' own share of that is small: mean 0.038 ms a tick, p95 0.097 ms, 3.8 % of the ticks at or above the tick p95 (`--aim`: 0.042, 0.109, 4.2 %). The rest of the rise was not separated from the changed run (no tile run follows the same path to compare with). Before the shoves were summed, one controller move per shove gave p95 2.9 ms (gate FAIL), with physics at 84 % of the slow ticks.
- **F65. Enemy shots and planar player shots still stop on the tile model** [I1c]: with the flag on, only the spatial player shots (`traj` 1, `flyLinear`), beams, aim and sight ask Rapier. Enemy shots (`PK.hostile`) and the planar player shots (`traj` 0: the bot and the fixed views, lob, orbit, boomerang) end on `T.wallAt` and `W.surfaceAt` in `src/sim/effects.ts` (the 0.15 m ground band, the deck node test, `T.los`). I1c owns them, since it moves enemies and bots onto physics and the fixed views retire at X1a; the planar path may go with them rather than move.

### Found in I1b (2026-11-25)

- **F66. Walking off a ledge** [owner, first 3D playtest]: **rule (owner, 2026-11-25, option 1): the tile model's, for every size class.** On the controller a supported body stays supported while the support under its axis drops less than the snap (0.35 m, the tile STICK) plus the tick's gravity: drops up to 0.3583 m are walked down, 0.359 m and deeper are falls (gravity, coyote time, air presses), the same at every speed (docs/LOCOMOTION.md "Resolvers" rules 4–5; `tests/stepping.test.ts` "down (F66)": every class at 0.5–9 m/s from two starts, grounded per tick from the edge as on tiles). The cause of I1b's first cut (every class walked down 0.4 m, Medium to Extra Large 0.5 m, Extra Large 0.6 m) was the capsule's rounded bottom riding the ledge's edge: its contact there reads as a walkable slope until it has ridden 0.3 × its radius down, and the snap then measured the floor under the axis from those lowered feet; the fix decides by the support under the axis, not by the contact, and rolls a falling capsule off the edge instead of landing it there. Open for the playtest: symmetric walk-down (≤ 0.6 m, all classes) to be judged at the first 3D playtest; note that snap drops the full height in one tick. Second fix round: the drops agree with the tile model tick for tick on all 420 walks (the round before: 6 crossings a tick late from Rapier's planar drift, 90 landings a tick early from F70; both 0 now). Two findings on the way: (1) a corner cut across a chasm's corner (navwalk viridian-forest seed 4, Small): the tile body falls one tick and lands back up on the next tile; the capsule, its fall cut by the floor's edges, rolled off them into the chasm, so it now waits on the edge, airborne, when its own next planar move takes the axis over a higher support at or above its feet (docs/LOCOMOTION.md "Resolvers" rule 5); (2) the tile model's first airborne tick (owner: a note here, no number): a Large body walking off a 0.6 m drop at 2 m/s (from x 1.66) moves 1.3231 m in its first airborne tick on tiles, 40 times its travel of 0.0333 m. That is on main today (measured at a749628), not introduced by I1b; the airborne footprint clear of `moveVertical` (`clearLanding` at its new feet) is the likely cause, not traced. Flag on, the same walk's first airborne tick moves 0.1229 m (the roll-off below; F69 has no forward hop and F70's moves are exact), so the controller path does not reproduce it. It ends with the tile model at X1b. ***D8 (owner, 2026-11-25): the tile-parity clause no longer binds after I1b.*** The rule above (the tile model's walk-down, for every size class) stands as I1b recorded it. Later tasks judge walk-down on its own gates, not by matching the tile game, and a test whose only subject is that parity may be retired by the task that improves on it, named in its report, with the reason in the commit.
- **F67. Moving platforms are not built** [I4]: owner O6 (our code carries a body by its support's horizontal delta, never the vertical) has nothing to act on: no system makes a kinematic body before I4. The first moving platform adds the carry to `src/physics/controller.ts` (the support collider's parent body, its next translation minus its translation, horizontal only) and its state to `replayHash` (F62).
- **F68. Rapier controller workarounds** [with F38, any Rapier upgrade]: behaviours of Rapier 0.21 that I1b works around in `src/physics/controller.ts`, to re-check on an upgrade with `tests/stepping.test.ts` and `scripts/navwalk.ts all 5 --physics rapier`: its snap-to-ground set capsules 2–5 cm into a step's edge on tile staircases (ours replaces it); asked to move a capsule resting at its offset even slightly into the floor, it returns no movement at all (supported moves are sent planar); it calls a capsule on a ledge's edge, and a falling one a few centimetres above the floor, grounded (the support and landing are ours, at the axis); its offset cuts a fall that ends a hair above the floor (a fall it met only floors on is resolved exactly, F70); it lets a walking capsule dip up to its offset where two boxes meet (the rest lifts it out); its answers are f32 sums: free moves on flat floor drifted 0.7 mm along and 0.5 mm across over a 3 m walk (free moves now return the desired translation: 0 drift); its 1 cm skin stops a body slower than 0.6 m/s short of a face for good (the roll's plain move); a shape cast's witness and normal are centimetres off along an edge a round bottom barely overhangs (heights come from the touched box's top; the roll-off direction from a ring of support rays); its intersection test reports a capsule over a box top as intersecting at gaps up to its offset (about a third of positions), and its contact query put a capsule 5 mm into a box's vertical edge at +6e-5 m (fits are decided in 64-bit against boxes). Capsules are also never in the broad phase (the world is stepped once, at build): no query could meet them even without their collision groups 0.
- **F69. The step is a hop** [closed, I1b second fix round]: owner's answer (2026-11-25): the roll. Built (docs/LOCOMOTION.md "Resolvers" rule 3): a supported move the controller cut goes the tick's own travel, lifted by the least height that fits; where the capsule fits at its own height the move is plain (the 1 cm skin had stopped slow bodies short of faces for good); the planar carry is the controller's own move at body height with climbable boxes left out, sliding at full radius along anything higher (navwalk volcanic-ridge seed 5: a Large body stepping onto 0.90 m beside a 1.34 m block's corner; chargestone-cave seed 3's Large and Tiny walks pass with the same change, not traced); the carry hop and the ±45° candidates are gone. Measured: the stepping test's roll case over 81,172 controller moves of the step matrices, no tick moves the body further than its own travel along the wish or at all, and on all 240 climbs every one of 6,053 rolling ticks is grounded, goes its whole travel and never sinks. A flight of four 0.3 m or 0.5 m steps on 1 m treads is crossed in exactly the ticks of flat ground by every class at 0.5, 2, 6 and 9 m/s, on both resolvers (ticks, flight = flat: Tiny 696 at 0.5 m/s, 39 at 9; Small 708, 40; Medium 716, 40; Large 740, 42; Extra Large 766, 43); carry beyond the tick's own travel 0 for all 80 runs (the hop: 0.30–0.92 m, flights 20–57 % faster). Not covered: a fall's roll-off of a ledge's edge (F66) still carries a body up to 0.154 m beyond its travel in one tick (Extra Large walking off at 0.5 m/s; 0.114 m at 6 m/s), the one place a tick moves further than its own travel.
- **F70. supportBelow is f32** [closed, I1b second fix round]: owner's answer (2026-11-25): exact unless cut. A move Rapier's controller reports no collision on returns the desired 64-bit translation ("cut" is read from its reported collisions, not by comparing its answer with the wish); `supportBelow` returns a box's f64 top when its ray enters the box from above; the height of what a cast meets is the touched box's f64 top; a fall the controller met only floors on is the tile landing at the exact planar end. Measured: `tests/locomotion.test.ts` "a ballistic body … lands on the support" lands at y === 0 and the tile tests pass 27 of 27 on the flag (with F72's one line); F72's case passes without its line too (all 240 ticks bit for bit: the 7e-9 m came from an f32 answer on the knife-edge tick); the planar drift (F68) is 0 over a 3 m walk at 0.5, 3 and 9 m/s; the F66 pin's 6 late crossings and 90 early landings are 0 and 0; `jumptiming --physics rapier` taps 12 54 96 as on tiles (were 12 53 94). New test: a free walk, fall and take-off return the desired translation exactly, and a flat-floor jump flies the tile arc bit for bit and lands at y === 0 on the tile tick, at 0, 1, 4 and 9 m/s. **For G1:** only boxes are exact. On a mesh (the stair ramps today, all of G1's terrain) the floor height, the contact heights and the fit test are still Rapier's f32 (its intersection test reports touching at gaps up to 1 cm). G1 needs 64-bit triangle versions of all three, not only of the floor height.
- **F71. Steps measured top to top can chain** [G0 band, X1a]: the roll measures a rise from what the body rests on: its feet on its axis support, or, perched higher (its round bottom on a block's edge), that block's top. So a body perched on a low block's edge may roll onto a block up to 0.6 m above that block's top without its axis ever standing on the low block, which the tile model would refuse from the floor. That is how a wide body climbs the location maps' diagonal staircases (navwalk volcanic-ridge seed 1); not seen as an over-climb on the adapter maps (navwalk and stuckwatch on the flag); WORLDGEN3D Q6's band (no rise in (0.50, 0.80) m) keeps it off generated maps.
- **F72. The capsule's height where there are no decks** [closed, I1b fix rounds]: one rule: a body's capsule is its own height on every map, and the height is required (`LocoTick.height`, `BodyMove.h`; no size-class fallback, and a move without a positive height throws). Production callers, all passing `partnerHeight`: `sim/player.ts` (the tick), `sim/enemies.ts` and `sim/bodies.ts` (the shoves, `pushFootprint`), `scripts/stuckwatch.ts` (its escape probe), `scripts/navwalk.ts` (its overlap check). Test inputs (owner, 2026-11-25: input lines allowed, no assertion changed): the tick helpers of `tests/locomotion.test.ts`, `tests/jumpcontrol.test.ts`, `tests/walltops.test.ts` and `tests/stepping.test.ts` give the height the old fallback gave (identical results flag off and on, shown before the fallback was removed), and `tests/locomotion.test.ts` "one body, two callers" gives `partnerHeight` as player.ts does. The old switch existed only because the tile model's `tall` is undefined on maps with no decks; no cost found. With F70 the two-callers case passes with or without its line.
- **F73. stuckwatch on the flag** [I1c]: the escape probe's headings move the partner's capsule through the controller, but its room flood stays the tile lattice's; and the enemies it watches are still on the tile World.
- **F74. navwalk on the flag walks only the trainer** [I1c]: the enemy walkers stay on the tile World until I1c, so `--physics rapier` drives the trainer of every size class and skips them; I1c adds them. **Both flags (rebase onto I3, 2026-11-25):** `navwalk all 5 --physics rapier --nav navmesh` (each flag alone 0 failures). The gate with both flags is a known-failure list (owner, 2026-11-25): `navwalk --known tests/fixtures/navwalk-known.json` passes only on the two cases listed there (1 and 3 below), matched by map, seed, space and size class and by how they fail. (1) **Known, not fixed:** viridian-forest seed 4, arena2, Medium, stuck at (−15.90, 17.55): perched on a 0.434 m step's edge beside a 0.934 m block, the roll's climb check measures from the support it rests on (the edge's top, top to top: F71) while its lift is measured from its feet, so the lift never clears the 0.934 m block it may roll onto. Lifting from the support it rests on fixes it, but moves `gorge-hold-rapier`, and is not in (owner, 2026-11-25). (2) **Fixed:** chargestone-cave seed 5, boss1, Extra Large, wedged against a deck's corner at head height (underside 1.72 m above its feet) beside a 0.29 m step: free in every heading away from the corner, stopped only pushing into it; the roll now lifts at its carry's end when a ceiling over the start cuts its lift. (3) **Known, not fixed (owner, 2026-11-25: listed, not to be fixed further):** chargestone-cave seed 5, arena10, Extra Large, stuck at (−14.41, 47.64): perched on a stair's edge (base 1.094 m) with a deck's corner (underside 2.4 m) over both the start and the carry's end, so lifting at the target cannot clear it. It moves freely in every other heading (e.g. (−0.71, 0.71): 0.0997 m, rising); only pushing −x into the corner makes no progress. Tried and not kept: lifting at the target in every case (fails the climb matrix, moves `gorge-hold-rapier`), a glide along head contacts (fails three stepping cases). **The controller limitation behind it [G1a]:** under a deck's corner overhead that cuts the lift, the body gets no slide and makes no progress while it pushes in (Rapier's slide along the down-facing contact goes into the floor, and the roll has no height to climb). G1a tests it on its generated decks, with this case as the fixture that reproduces it: `npx tsx scripts/navwalk.ts chargestone-cave 1 5 --physics rapier --nav navmesh`.
- **F75. Spawns and respawns are put at the tile surface** [I1c, with F30]: the partner's spawn, a hazard respawn and a swap put it at `W.surfaceAt(x, GROUND, z)`, which the adapter's colliders match at tile centres; on a stair ramp the capsule starts inside the ramp (the ramp's height at the centre is below where a capsule rests on it) and its first move lifts it out, 0.06–0.18 m up and along the slope (the range's flight, Tiny to Extra Large). Nothing gated spawns on a ramp. F30's real heights land with I1c.

### Found in I3 (2026-11-25)

- **F76. The Recast build is over the run-start target** [G1, owner]: River Gorge seed 1 through the adapter takes 292 ms median (p95 324) for the three width groups at tile 128 (`scripts/navbench.ts`, M3 Max; 285.7 / 306.4 at I3, before the 4-cell narrow agent): adapter 19, soup 3, tiles 268. WORLDGEN3D Q20.2's run-start target is a curated seed's p95 ≤ 250 ms for everything; G1 measures run start on generated maps, where this number belongs. Why the numbers differ: (a) one group alone is about 135 ms but three are about 285, not 400, because the rasterisation (63 ms) is shared and each group's own stages (filter 4, compact 15, erode 21, regions 14, contours 13, Detour 1 ms) are about 68 ms; (b) perf-sim's 225–276 ms are not River Gorge but its default map (meadow, 112 × 112 m, seeds 1–3; the first build of a process about 40 ms slower, JIT), while per map at seed 1 `navbench all` gives 97 (Tidal Cave) to 298 ms (Forest Cemetery). **The build blocks the main thread**: the sim runs on it, and the bridge builds synchronously inside the first `setNavGoal` after a map entry, so the first tick takes the whole build. Options (not implemented): build during the map-entry load, before the first tick, tile by tile across frames (removes the hitch, not the cost; the sim needs the navmesh before its first answer, so never on wall time); the groups in parallel workers (each about 135 ms alone, so about 140 ms wall with three wasm instances); bake the navmeshes of curated seeds at build time as side files (Detour's tile data; load cost is `addTile`, a few ms, and bytes per map); build only the groups a run's bodies need; tile 256 (with the ledge filter it measured 262 ms of tiles against 304). A run-time change rebuilds 1–2 tiles in about 31 ms, most of it the adapter (F57's shape). Q20.2(b)'s free-seed targets and feature and state caps wait on this number.
- **F77. Neck widths and the narrow agent** [G1a; I1c] — **answered, widen** (owner, 2026-11-25: D14, worded in the review of RP): on generated maps the narrow clear-width rung (WORLDGEN3D Q7's table, 1.10 m) is 1.20 m; G1a pins it with a test that a 1.20 m neck is open to the 5-cell narrow agent at every plan offset and refused to Large. The 5-cell narrow agent stays (`rules.nav.groups.narrow`), and G1a recomputes and lists every number derived from the rung. Why 1.20 m: I3's fixture has a neck open at every plan offset to the cells from 1.18 m (one of 1.17 m shuts at some), and WORLDGEN3D Q6.4's 0.10 m keep-away from Large's 1.32 m footprint diameter allows at most 1.22 m. Unchanged, adapter maps (owner, 2026-11-25): the narrow agent is 4 cells (`rules.nav.adapterRadius.narrow`), so the tile maps' one-tile (1.0 m) necks stay open on the navmesh (`navwalk all 5 --nav navmesh`: narrow 313/313, no `closed` category; at 4 cells the minimum is 0.98 m). I1c re-checks Medium's 6 cm wall overlap at adapter-map necks once enemies leave the tile World; the same 6 cm overhangs a drop's edge (the navmesh keeps the agent's radius, 0.40 m, from it).
- **F78. No detail mesh** [I1c]: a polygon's floor is read from its vertices. Polygon floor against the tile surface on the 28 adapter sources (`scripts/navheight.ts`, every walkable surface on a 0.25 m lattice, 3.0 million narrow samples): at 2 cm cells p50 0.020 m (the cell), p99 0.333, p99.9 0.784, max 1.591 (Viridian Forest seed 1, a terrace polygon); large and xl p99 0.32 / 0.31, max 1.45 / 1.50; 0.22 % of samples over 0.6 m (5 cm: p50 0.050, p99 0.338, max 1.567); the error is the polygon's, not the cell's. Detour's own query reads the same without a detail mesh. With one at 0.6 m / 0.05 m (the generators' defaults): p99 0.144, max 0.749, and the build costs 10–25 % more per map (River Gorge tiles 267 → 311 ms). `rcBuildPolyMeshDetail` at sample distance 0 (`R.buildPolyMeshDetail(ctx, polyMesh, chf, 0, 0.05, detailMesh)`, every map, the range included) fails with `RuntimeError: memory access out of bounds` in the wasm. `locate`'s 2 m layer tolerance absorbs the error and stays under the 2.4–2.9 m deck gaps (tested); it also lets a body in a one-tile pit snap to the lip above it (F85). Owner O2's "ground height from the navmesh polygon" for enemies on physics (I1c) needs the detail mesh and NavGraph reading it (`NavConfig.detail` is a measurement switch today).
- **F79. Recast's climb: 2 cm cells** [G1]: resolved in the I3 review (owner, 2026-11-25): `rules.nav.ch` 0.02 m with every vertical count re-derived from its physical size (step 30 cells, Recast's build climb 29, agent heights 48 / 85 / 139, giant 179; cs and radii unchanged; S1 O9's review note). The sim's 0.6 m step stays the authority. Recast rounds span tops up to cells, so one cell under the step never joins a rise over 0.6 m and joins every rise up to 0.58 m at every alignment (`tests/nav.test.ts` "the step boundary", 20 alignments, every group); a rise in (0.58, 0.6] m may be cut and routed round, the known approximation (a rise of exactly 0.600 m is cut at every alignment; none exists on the adapter maps). Census over the 28 adapter sources (`scripts/navrises.ts --group all`; 223 valid rises in (0.5, 0.6] m, S1's 227 counted 4 rises of 0.5 m plus float noise): valid rises joined narrow 176 → 211 (12 not: 4 have water below, 8 in (0.58, 0.6) routed round in 2.1–2.2 m), large 85 → 105, xl 14 → 18; rises over 0.6 m joined 0 of 621 at both (climb 12 at 5 cm would join 31). Build time and memory unchanged (River Gorge 282 ms median against 285; wasm heap 64 MB). Rejected: ch 0.01, because Recast stores a compact span's clearance in 8 bits (`rcCompactSpan::h`, clamped to 255; recastnavigation `599fd0f`), so Extra Large (278 cells) and the giant (357) build nothing; TileCache (unused) keeps a layer's heights in a byte, under 255 cells (5.1 m at 0.02). **G1** validates generated geometry against the physical traversal capabilities (the 0.6 m step, body heights and footprints) and checks the navmesh against those, not the other way round: voxel dimensions are not the gameplay authority, and a generated step in (0.58, 0.6] m costs a detour until G1 or a finer representation answers it; WORLDGEN3D Q6 keeps generated walkable rises at or under 0.50 m (0.50–0.80 m is the step dead band), so that band arises only on adapter maps.
- **F80. Recast's ledge filter is not run** [G1]: its steep-slope rule cut the tile maps' terraced diagonal slopes (Viridian Forest seeds 1–5: 167 navwalk failures with it, 14 without, at I3). The 14 went later and not through the filter: 12 were narrow walks behind one-tile necks, shut by the 5-cell agent and open at 4 (F77); 2 were the trainer, fixed in navwalk (densified routes and the resting bodies as obstacles). What the filter being off allows: on a fixture with a 1 m drop the navmesh's edge is the agent's radius from the drop (0.40 / 0.70 / 0.90 m), and one cell more with the filter; Recast's erosion already treats a drop over the climb as a boundary, so paths come 0.1 m nearer drop edges and no agent's body overhangs one (Medium on the 4-cell agent by 6 cm, F77), and diagonal slopes whose neighbours spread more than the climb stay walkable. G1 re-checks it on generated slopes, which are continuous.
- **F81. Surface states are not navmesh costs** [I4]: the tile flow's weighted field (burning tiles at `burnCost`) has no navmesh counterpart yet; WORLDGEN3D Q21.6 makes surface states nav cost fields. Ice is geometry (a freeze or thaw rebuilds the touched tiles), as on the tile World.
- **F82. Nothing in the sim adds a navmesh obstacle** [I4, I1c]: TileCache-style obstacles exist (`NavWorld.addObstacle`, tested) for I4's temporary objects (Q21.7(b)). `scripts/navwalk.ts` adds the loose rocks as obstacles for the trainer's route (the lattice route stepped round them); enemies do not collide with resting bodies today.
- **F83. Placement stays on the tile World** [I1c]: `place`, `walkableAt` and `nearestWalkableAt` are not among I3's three members, so spawn fit, relocation and rescue still read the tile fields (`place`'s `reach` the tile wide field; `setNavGoal` forwards to keep it current). With the flag on, a spot is fitted on the lattice and judged by `navReached` on the navmesh.
- **F84. Off-mesh links carry no traversal** [I1b, after X1c]: links route by `needs`, and an agent on one steers to its far end; drops, jumps, ladders and burrows need mechanics (F46). The tile maps write none.
- **F85. stuckwatch on the navmesh** [T1]: `stuckwatch all 3 --nav navmesh` (2 cm cells, 4-cell narrow agent): 14 player episodes (1 pinned, 0 TRAPPED), 12 enemy episodes over 227,908 enemy-seconds (5 cm: 12 / 12 over 207,550; 5 cells: 13 / 18). F1's three faults do not appear. Nine are one site, a one-tile pit on Tropical Lagoon seed 2 (31.5, 4.5): a 1.10 m tile walled north and east, 1.4 m under the 2.50 m plateau on its other sides, too small to keep a narrow polygon; a body that ends up in it (3 Medium Ekans, 6 Small Sandshrew) snaps to the plateau's polygon 1.45 m above its feet (`locate`'s 2 m layer, F78), so it has a route and walks into the face (the tile World gives it none, so flag off it is not counted). The rest: Mt. Moon seed 1 (1 Medium, by a wall, also flag off), River Gorge seed 2 (1 Large), and at 2 cm Mt. Moon seed 3 (2.5, 18.5; 1 Medium Sentret), where Tidal Cave seed 2's 1 Extra Large went. The Mt. Moon seed 3 site is F1's flag-off single walker at the same spot and time (tile flow: Sentret at 2.5, 18.1, t 28): at 5 cm a Sentret stands there with the same navmesh direction (0.04, −1.00, a 0.45 m step down the sim allows) and leaves at t 30, inside stuckwatch's 5 s window, so it is the tile movement fault, not the cell height. No Medium episode is at a neck. Player episodes are crowd oscillations whose sites move with the run.

### Found in G0 (2026-11-24)

- **F45. The camera docs describe a superseded framing law** [CL; **narrowed** by CL, 2026-11-25]: the 3D rig's law is settled and documented (WORLDGEN3D Q15c, CL-Q4 to CL-Q9; docs/CAMERA.md "Direction for the 3D camera"): the lens at eye height, D = 3.5 × the anatomy table's height inside 1.8–9.0 m, the information gate, pull-in and fade I2b's. The framing inputs live in the single framing source (`src/rules/framing.ts` FRAMING), which `CHASE_CONFIG` reads unchanged. What remains: the old renderer's law (back distance from drawn height, up to 14 m) stays in force for the old renderer and docs/THIRD_PERSON.md describes it, until I2b builds the 3D rig on the new law.
- **F46. Traversal kinds the generator assumes** [I1b, owner; mechanics after X1c by the owner's answer B, 2026-11-24]: `climb` and `burrow` are not kinds in `src/rules/traversal.ts`; `fly`, `levitate` and `dive` are reserved with no mechanics. The flight mechanic (fuel, time or a jump count) is the owner's open decision (WORLDGEN3D Q8.2).
- **F47. A recipe's species section has no reader** [owner, T1]: WORLDGEN3D Q14(e) lets a recipe carry a species list or filter (wild and ambient spawns, an allowed roster). Pivot Q9 removed spawn pools, nothing in the sim reads such a list, and `SpeciesDef` has no region or theme field for a filter.
- **F48. No item system** [owner]: the generator emits item-candidate markers balanced between the teams (WORLDGEN3D Q10e); the sim would pick the items per match. Pickups left with the survivor loop.
- **F49. The blueprint and the research reports are not in the repo** — **closed** (owner, 2026-11-25, D14). The blueprint is "Map and Environment Generation Blueprint" (the owner's claude.ai project "map generation", exported 2026-11-24). The claude.ai reviewer checked every quote and departure WORLDGEN3D attributes to it on 2026-11-25, and all match: §7's heightfield per terrain chunk; rule 4 (trimesh only for SDF features); milestone 12 (SDF caves); the zone-graph node set; the phantom-concealment lint; ranked maps as validated bundles; the expert layer; Zod; three style families and shading models; report 1's 150,000 trimesh triangles. WORLDGEN3D is the record. The blueprint is kept in the owner's claude.ai project, not in the repo. Not the source: the Claude Docs artifact titled "Procedural Pokémon World Blueprint" (2026-10-22), an older tile-era document that holds none of the quoted terms; this entry first used that title, taken from code comments in `src/rules/surfaces.ts` and `src/sim/props.ts`.
- **F50. The porting order of the other five habitat recipes** [owner, after G2]: River Gorge is the first recipe in the new format (WORLDGEN3D Q14.10); the order of the rest is not decided.
- **F51. Shots need line of sight from the eye** [CL; **narrowed** by CL, 2026-11-25; turns on at X1a]: built behind `rules.aim.viewSight` (default off). Spatial shots and beams launch from the anatomical eye (after its wall and overhang pull-backs) and their own sweep from there is the check and the HUD's `blocked` (WORLDGEN3D CL-Q3, CL-Q10, CL-Q11, CL-Q13); tested on both engines (`tests/viewsight.test.ts`) and replayed by `range-mewtwo-viewsight`. What remains: switching it on at X1a (a planned baseline change), and the bot onto the spatial path (Stage 7A), which takes the same check.

### Found in WM2 (2026-11-25)

- **F52. The role of Mt. Moon's crate and fossils** [owner]: the `crate` (0.80 m) and `fossil` (0.45 m) low props have no `PROP_MATERIALS` row, so their colliders take the tile's terrain name (`dirt`) as material, as on main, and the adapter gives them that terrain's role, `soil` (4 tiles on Mt. Moon seed 1; their render tops were terrain-coloured on main too). The brief's prop rule (by material) does not cover them. Options: keep `soil` until G1; call them `cover`; or give them material rows, which changes the sim (props.ts reads the table) and moves hashes. **Resolved by the owner (2026-11-25):** `cover` in the tile adapter (collider, render top, side segments above the ground); the collider's `material` stays `dirt` (F55), no material rows, no sim change. G1 replaces it.
- **F53. The adapter does not read the habitat fallback** [G1]: `meta.requestedSeed` is written equal to `meta.seed` (= `ArenaMap.gen.seed`, the seed asked for), as the brief says. A habitat that fell back records `{ requested, used, why }` in `gen.hab.fallback`, and `m.id` names the used seed; no map source in the tests falls back today. G1 writes the real pair and `seedReason`.
- **F54. Crude roles to replace** [G1, I2a]: the side faces of ground are `cliff`, bridge-plank rims (`wood` ground) included; stairs are `rock` (their terrain is stone); a deck is `floor` on its top, underside and rim (not `trim`); `bed`, `wall`, `roof`, `trim`, `objective` and `hazard` are never written (no bed under a tile liquid, no built walls or roofs in the tile data, vent fields are volumes). I2a (2026-11-27): the renderer resolves every role through the binding, written or not, so G1a's real roles need no render change.
- **F55. `material` is still a string** [G1]: the additive rule kept `ColliderBase.material` as the tile era's string (a `MaterialId` for props, a terrain name for ground). Q16.4's resolved `MaterialId` is therefore not enforced by the type; narrowing it is a `MODEL_VERSION` change for G1, after the `soil` material of Q16.6 exists.
- **F56. Feature nav tiles need I3's tile size** [I3, G1]: `Feature.navTiles` lists navmesh tiles (tx, tz) per state (Q20b), and the tile size is not decided until I3 measures Recast. **Answered by I3 (2026-11-25):** `rules.nav.tileSize` 128 cells (12.8 m) from the model's bounds minimum; a tile's build reads its square plus the widest group's border (12 cells), so a feature's tiles are `NavTiles.tilesTouching` of its footprint (F76 has the size sweep).

### Found in CL (2026-11-25)

From the owner's direction WORLDGEN3D Q15c and the CL grilling answers recorded under it (CL-Q2 to CL-Q13).

- **F86. The anatomy lint becomes a gate** [the task that builds hit bodies from the table, at the latest]: CL ships `src/rules/anatomy.ts` and a report-only lint comparing the table with each sprite's measured outline (drawn top ÷ sim height was 1.09–1.99 over 240 species on `main` 25e20ed, median 1.32). It gets a pass/fail tolerance once the owner sets an expected ratio, no later than F91.
- **F87. A review flag for new species whose sprite contradicts the table** [owner, content]: a species added to the roster whose measured outline disagrees with its table entry (default or override) is flagged for review automatically, not left to the next lint report.
- **F88. Attack origins from the table** [later task]: the table stores named attack origins (`mouth` now; tail, horns, hands later) and nothing in the sim reads them. Since CL-Q10, flagged spatial shots and beams launch from the eye (`rules.aim.viewSight`). What remains: whether a table origin (the mouth or another) becomes the gameplay origin, and the paths still on the muzzle or their own origin (planar casts, melee, `assistSees`). The table's default mouth is 0.6 × the species' sim height up and 0.9 × its footprint forward, the same figures as `rules.aim.muzzle` (which also multiplies `bodyOf().height`); a mouth would not carry `rules.aim.muzzleBy`'s per-move and per-archetype overrides, and per-species or per-shape mouths would move launch points, so reading it is a planned behaviour change.
- **F89. Postures beyond `stand`** [later task]: the table has room for postures (for example `low`, `swim`, `fly`) that override its dimensions and points; only `stand` is used.
- **F90. Cover, partial cover and concealment from the table's dimensions** [I4, G1]: concealment, cover and exposure should follow each species' shape and posture against environmental geometry, with partial states (Q15c). Today cover is binary per trace.
- **F91. Sim bodies from the table** [owner; its own task or X1a]: hurt heights and dimensions still come from `rules.size` class rows × tilt (`bodyOf`). Moving them onto the table moves replay hashes. Movement collision and navigation stay in class tiers (CL-Q2 direction).
- **F92. Enemy detection on the same sight origin** [I4, T1]: Q15c asks that concealment apply the same to targeting and enemy detection. `src/sim/enemies.ts` ranged fire checks sight from literals (enemy +0.9 m to player +0.6 m), `assistSees` (`src/sim/aim.ts`) from the muzzle height, and `scripts/lib/aimbot.ts` from +0.7 m.
- **F93. Environmental material properties** [I4, Q16]: Q15c's system separation lists material properties as their own system (vegetation hides without protecting, solids do both). The current flags are `blocksShots` and `blocksSight` per material.
- **F94. Environmental scale** [G1, G2, owner]: Q15c asks for environmental dimensions from believable world-scale proportions and intentional level design, not derived only from size classes. The Q15b cover ladder (1.45 / 2.00 / 3.70 m), the Q7 clear-height rungs for optional spaces, the cover dead-band and Q23.7's "on the ladder" are provisional until this is settled.
- **F95. Tall grass decoration hides small bodies on screen only** [I4]: the `tall` grass prop (and flowers, reeds, lilies) has no `PROP_MATERIALS` row, so neither engine gives it a collider or a sight block, while on screen it can cover a small body. A Q15c consistency gap for the `screen` kind.
- **F96. The low lens and the 0.30 m near plane** [I2b]: CL-Q5 puts the lens at eye height for every body, down to 0.33 m (Tynamo, on the draft eye fractions), 0.03 m above the 0.30 m lens clearance. I2b reports how often pull-in triggers for the lowest eye on the adapter maps and owns the pull-in rule (CL-Q(d)).
- **F97. Dressing height and the concealment eye band for low eyes** [G1, I2b]: the 0.50 m dressing height (Q15.9, Q17.5) and the phantom-concealment check (Q15.8) were derived for eyes at 0.60 m or higher; eyes now go down to 0.33 m, so dressing with no collider can hide on screen what the sim eye sees and can hit. I2b decides how dressing in front of a low lens is drawn (faded near the lens, or actors drawn through it); G1 re-derives the dressing height and the check's eye band for the lowest eye.
- **F98. The default eye fractions are balance values** [owner, first 3D playtest]: CL-Q6's fractions of sim height by official shape are provisional. The lint report (eye against the drawn picture; who sees over each cover rung) is checked at the first 3D playtest. On `main` 25e20ed, 80 of 240 species have their eye under 0.6 of the drawn picture, and 45 Large and Extra Large species (11 heroes) have an eye within 0.10 m of a cover rung. Whether eyes should follow the drawn height instead of the sim height is decided then, through reviewed override data; the sim never reads the art.
- **F99. The camera distance law is provisional** [owner, first 3D playtest; I2b]: The generator's eye bound (3.21 m) leaves out the authored boss bodies (`SpeciesDef.scale`: Sudowoodo eye 3.72 m, above the 3.70 m clear height; Articuno and Houndoom 3.60 m; Magcargo 2.87 m) are excluded from the eye bound and from the anatomy lint: no mode uses a boss role today. If one returns on generated maps, or such a body becomes a partner, the bound and the clear height are a planned layout change. CL-Q8 sets D = 3.5 × the anatomy table's height inside 1.8–9.0 m, in the single framing source. k and the limits are re-judged at the first 3D playtest (framing, awareness and any advantage at the size extremes). Pull-in and obstruction across body sizes are I2b's. Giants above 2.57 m frame at 9.0 m and rely on pull-in and fade (I2b); if a body taller than 2.57 m becomes a hero, its framing is judged at a playtest. A change to the framing source after G1 (raising the max among them) is a planned layout change, since the generator sizes `camera-clearance` spaces (short side 10.18 m) and the tall-dressing keep-out (9.30 m) from it. CL-Q9: the generator owes nothing more for pull-in and fade; I2b reports the fade rate on G2's map split into moving along required routes and stationary, and if fading while moving on required routes exceeds the adapter maps' 5.5 %, a free arm ≥ 2.0 m both ways along the route axis on required routes is reopened for G2. *(F100, owner, 2026-11-25: I2b reports the rate on the 3D range and G2b repeats it on River Gorge, where the free arm, if needed, applies inside G2b.)*

### Found in I2a (2026-11-27)

- **F103. One internal three API** [three upgrade task]: three's `PassNode` renders once per node-frame id, which three
  advances only on its own animation-loop tick; capture mode (`pokewatch.advance`, many frames in one task) therefore
  redrew a stale scene pass. `src/render/three/view.ts` calls `renderer._nodes.nodeFrame.update()` once per drawn
  frame. Re-check it, with `tools/s2matrix.mjs` and `tools/three-signal.mjs`, on every three upgrade.
- **F104. The adapter's side faces are not consistently wound** [G1a]: about a fifth fail an outward test (range 871 of
  4,454, River Gorge 2,889 of 12,074), so world materials are `DoubleSide`. G1a's `emit` writes outward winding; then
  `FrontSide` (and back-face culling in the shadow pass) can return. Revisit both I2a choices together then (owner,
  2026-11-27): world materials are `DoubleSide` (so the shadow map holds both sides of every face) and the sun's shadow
  `normalBias` is 0.08 m, up from S2's 0.03, to clear acne on level ground under a low sun. With outward winding,
  back-face shadow casting (`shadowSide = BackSide`) can replace most of that bias and cure F110's stripes; under
  I2a it removed real shadows (the range's rocks at 7:00) on the mis-wound faces.
- **F105. Cinder Crater's vent pools overlap 7 at one vertex** [G1b, owner]: the tile light pools transcribed as lamp
  emitters reach Q20(c)'s overlap bound (≤ 4 at a vertex, as I2a restated it) 7 deep among the crater's vents;
  Chargestone Cave (54 emitters, 2 deep) and Mt. Moon (1) pass. A generated map's `Dressing` emitters meet the bound at
  `dress`; the tile maps' pools go at X1b.
- **F106. Under `?render=three` the frame shows only the world and the creatures** [I2b]: decals and blob shadows,
  telegraphs, projectiles, particles, glows, ribbons and the fainting clip are drawn by the page renderer, which
  presents nothing with the flag on. Damage numbers and the HUD (DOM) still show. The fixed views still drive the lens
  (they retire at X1a). F41's x-ray feet show here too.
- **F107. No Settings entry for the renderer** [X1a]: docs/OVERHAUL_3D.md "Migration rules" names `?render=three` and
  a Settings entry; I2a built the URL flag only (G1b's row names the flag). X1a turns it on for everyone.
- **F108. Bloom on the WebGPU backend** [owner, before bloom is turned on]: three's BloomNode measured 3.7–9.4 ms of
  GPU time at 1080p on WebGPU against 1.6–2.9 ms on the WebGL 2 backend, the same scene (docs/RENDER3D.md "Budgets"),
  and over the post budget on both. It has about a dozen render passes; the per-pass timestamps may overstate WebGPU.
  `lowpoly` lists bloom at weight 0 (not built). Before a profile turns it on: profile it without timestamps, and
  consider a cheaper glow pass in the registry.
- **F110. Shadow stripes under a grazing sun** [TD; G1a]: below about 15° of key-light elevation (before 7:00 and after
  17:00 on the day path) the shadow map shades level ground in whole-tile stripes; `?shadow=0` removes them. The fixed
  hours (10:00, 22:00) are clear, so nothing ships with them; the running cycle passes through those angles. Back-face
  shadow casting cures it but loses real shadows on the adapter's mis-wound faces (F104), so it waits for G1a's
  winding; slope-scaled bias or fading the key light's shadow below 15° are the other options.
- **F111. The `lowpoly` look sheet** [before G1b, or as part of it; does not hold up I1c] (owner, 2026-11-27): the
  ramp and normal mode, the paint terms, ink and the shadow tint are chosen by the owner from frames. Pass marks are
  written before any capture: tops read apart from sides (Q23.3, the luminance gap between each role's resolved top
  and side tones), `tools/three-signal.mjs` still reads (255, 102, 32), the frame stays within 4.0 ms p95. Tuned on
  the range and River Gorge at 10:00 on one camera pose with a creature in frame: ramp smooth or 3 soft bands × paint
  all 0 or a moderate set × ink off or thin and dark with a low world share, 8 frames per map, in one capture folder
  with a table of variants, marks and pass/fail. Chargestone Cave and the dusk lagoon are hold-outs, not looked at
  until the variants are picked; the picks are then applied and shown on them.
  **Sheet built (2026-11-27, `feat/i2a-look-sheet`): docs/looksheet/README.md**, frames in `docs/looksheet/2026-11-27/`.
  All eight variants fail mark 1 (the sun-facing side sits 3.4–5.7 ΔL\* under its top at worst, the light split
  being outside the grid); marks 2 and 3 pass for all (signals 80 of 80, at most 1.51 ms p95). Waiting on the owner's
  pick, or a change to the grid or the mark.
  **Round 2 (2026-11-27):** bands dropped; a toplint-only sweep first (key share 0.65 / 0.75 / 0.85 × 10:00 / 11:00 ×
  facet tone by plane or locked to orientation; the crushing line declared before the run). Exactly one split
  passes mark 1 for every role without crushing: share 0.65 at **11:00** with facets **locked to orientation**
  (trunk 12.8, cliff 15.6); both are owner calls (the accepted hour is 10:00; the lock is in the lint only). Re-capture
  on 4 variants × 2 poses × 2 maps: marks 2 and 3 pass, mark 1 fails as in round 1. Found and fixed: ink and edge
  light ignored the fog, and the ink pass's depth read the quad's camera (S2's edge pass too). Waiting on the owner.
  **Round 3 (owner, 2026-11-27):** the fixed hour is 11:00 for day maps and caves, facet tone locked to orientation
  (+0.06 tops, −0.06 sides) in the shader and the profile, `tests/looksheet.test.ts` gates mark 1; the ink fix is on
  `feat/i2a-three-scene` as F112. Re-shot at 11:00: all four variants pass all three marks (mark 1 min 12.8 on
  trunk; signals 40/40; at most 1.34 ms p95).
  **Picked and shown (owner, 2026-11-27):** p1i1, in the `lowpoly` profile. On the hold-outs mark 1 **fails on both**:
  Chargestone Cave 6.5 (cliff; the cave split is 0.4) and the dusk lagoon 5.1 (trunk; the moon stands 60° up at
  22:00); no crushing, marks 2 and 3 pass. Reported, not tuned: docs/looksheet "The pick and the hold-outs". Open: the
  cave and night light splits and the night hour [owner]; F113.
  **Cave and night sweep (owner, 2026-11-27):** night moves to 23:00 (the lagoon: 5.1 → 7.8). Key share 0.50 /
  0.55 / 0.65, facet ±0.10 at the best uncrushed share (Chargestone 0.50, the lagoon 0.55), and on Chargestone a side
  jitter of 0.03. Mark 1 per role and shadowed-top L* in docs/looksheet; no variant passes without crushing (closest:
  the lagoon 0.55 + facet 0.10, only trunk under, 10.6; Chargestone 0.50 + facet 0.10, 9.0). Frames on the hold-out
  poses with GPU p95 on both backends. Waiting on the owner's pick. F113 parked.
  **After the sweep (owner, 2026-11-27):** night takes key share 0.55 and facet ±0.10, applied, provisional until
  the owner confirms it by eye (the lagoon: mark 1 10.6 on trunk, the rest ≥ 13.1). Facet ±0.10 is for dim scenes
  only (caves and night, the profile's `paintByLight`); day keeps ±0.06, and the range and River Gorge numbers do not
  move. The side jitter is dropped; cave colours and the cave split (0.40) are unchanged, no cave variant applied.
  Trunk: stumps and logs are standable on 8 of 14 maps (none on the range; wall-prop trunks are not standable today;
  the 3D range is not built), so trunk stays in mark 1, colour unchanged, **waiting on the owner**. Chargestone: a
  key sweep with the ambient held at 0.45 (the lowest keeping shadowed tops ≥ 20), key 0.55 → 0.85 in 0.10 steps;
  at 0.85 every role reaches 12 (cliff 12.4) with no top clipping; frames, scene lightness and GPU p95 in
  docs/looksheet "After the cave and night sweep". **Waiting on the owner** for the night confirmation, trunk and
  Chargestone.
  **Key sweep accepted (owner, 2026-11-27):** night confirmed (0.55, ±0.10). Caves to key 0.85 over ambient 0.45:
  **not applied, stopped** on `tests/timeofday.test.ts` (every open top lit to luminance 1; the split gives 1.30), the
  owner rules on that test; the mechanism is in; under it floor tops clip on the `moon` binding (1.19). Stump and log
  tops take a render-side role `endgrain` (proposed `#d8c09a`); trunk leaves mark 1, endgrain joins it against trunk
  sides (≥ 49.9 everywhere); **G1a's 3D stumps and logs must carry `endgrain`** (a model role there: `MODEL_VERSION`).
  `tests/looksheet.test.ts` gates the dusk lagoon (Chargestone with the split). Frames before/after on Shrine Gorge
  and the dusk lagoon: docs/looksheet "Endgrain". F113 stays parked. **Waiting on the owner:** the endgrain colour
  by eye, and the ruling on the time-of-day test. Then the look sheet is done.
  **Closed (owner rulings, 2026-11-27):** the split is Chargestone's binding's alone (`BINDING_SPLIT`; `moon` keeps
  0.40), `tests/timeofday.test.ts` and RENDER3D "Time of day" amended for it; Chargestone gated in
  `tests/looksheet.test.ts`; Cinder Crater is F114; endgrain catches only stumps and logs on every current map; Mt.
  Moon / Shoal Grotto at 0.40 recorded (mark 1 9.3, ground; shadowed tops 31.1), not tuned. Endgrain ships at the
  proposed `#d8c09a` (the owner's colour line came back unfilled; a one-line change in `ENDGRAIN` if it changes).
  The look sheet is done: docs/looksheet "Rulings and closing checks".
- **F112. The ink pass ignored the fog and read the wrong camera** [found by the owner in the look sheet, fixed on
  this branch, 2026-11-27]: ink and edge-light lines showed through the fog on far blocks (River Gorge, round 1). The
  pass runs after the scene's fog, and inside the pipeline's quad pass the TSL `camera*` nodes are the quad's camera,
  so its view distance was about 0 and S2's ported depth edge used the wrong near and far. Fixed: the pass reads the
  scene camera explicitly; the ink colour is fogged with the scene's curve and colour and edge light fades by it.
  Ink is at weight 0 in `lowpoly`, so nothing shipped showed it. Any later post pass that reads depth takes the scene
  camera the same way.
- **F113. The transcribed dithers at native resolution** [owner; parked 2026-11-27]: the sky's six bands and the vignette's four levels
  are dithered on a 4 × 4 Bayer grid, as today's `SKY_FS` and `VIG_FS` draw them (I2a transcribed both). Today they
  sit on the low internal resolution and are upscaled in pixel steps, so the dither reads as pixel art; the 3D scene
  draws at native resolution (owner, 2026-11-27), where it reads as a 1 px stipple across the sky and a stippled
  ellipse on the ground ("rings on the range grass"). Checked on the range by switching each off: the sky stipple is
  the sky's dither, the rings and the sparse dark dots at the top of the sky are the vignette, and the fog shows no
  banding. Options: keep them; drop the dither (smooth gradients); or dither at a coarser grid.
- **F114. Cinder Crater fails mark 1 and the crushing line** [owner, 2026-11-27; before any `volcano` map ships in
  3D]: on the `volcano` binding (day, 11:00, key share 0.65, facet ±0.06) the look sheet's mark 1 is **9.9 (cliff)**
  and the shadowed tops reach **L\* 15.6**, under both lines (ΔL\* ≥ 12, L\* ≥ 20; docs/looksheet "Pass marks").
  Found by the look sheet's last round, unchanged by it; the binding has never been on the sheet. Must be fixed before
  any `volcano` map ships in 3D. Not tuned now (owner).
- **F109. `scripts/dev.mjs` had no recast plugin** [found and fixed by I2a]: since I3 the dev server's bundle imports
  `src/nav/web.ts`'s `.wasm`, which esbuild cannot load without `navWasm`; I2a added it beside the three side file.

### Found in RP (2026-11-25)

- **F100. Where CL-Q9's fade rate is reported** — **answered and closed** (owner, 2026-11-25, the review of RP). I2b reports CL-Q9's fade rate on the 3D range (G1b's), split as CL-Q9 says. G2b repeats it on River Gorge before Hold returns. If fading while moving exceeds CL-Q9's line there, the 2.0 m free arm applies to River Gorge's required routes inside G2b; River Gorge has no shipped baseline yet. G2a does not wait. I2b needs G1b only for this report (owner, 2026-11-25, the review of fc6d310): if G1b has not merged when I2b's other work is done, I2b merges without the report, and the report moves to X1a, where the 3D range is played; no order change. Was: CL-Q9 had I2b report on G2's map, which D13's order does not give it.
- **F101. Code comments and other docs that still say G1 or G2** [X1c]: `src/world/model.ts`, `src/world/adapter.ts`, `src/rules/framing.ts`, `src/rules/defaults.ts` and `src/physics/world.ts`; docs/LOCOMOTION.md, SIZING.md, CAMERA.md, THIRD_PERSON_IMPLEMENTATION.md and spikes/S1-physics.md. They read by D13's split until X1c rewrites them. `.claude/skills/README.md` still describes `/grilling` by a `HAB_VERSION` bump. Narrowed (owner, 2026-11-25, the review of RP): the CLAUDE.md lines this entry first listed (the perf-sim line, the habitat sentence on a planned `HAB_VERSION` bump, the `/grilling` examples) are fixed.
- **F102. Which task builds the SDF cave builder** — **answered and closed** (owner, 2026-11-25, the review of RP; it follows D9 and WORLDGEN3D Q14.10(c)). Layer 1 needs no cave. The SDF cave builder lands with the first River Gorge layer that needs one (the waterfall cave, layers 3 to 5, after X1c), and the range's SDF cave station waits for it. Was: WORLDGEN3D Q4 puts SDF caves at G2, and D13 lists the builder under neither G2a nor G2b.

### Found in housekeeping (2026-11-21)

- **F10. The determinism allow-list** (`tests/determinism.test.ts` since C1): 76 maths call sites (75 `Math.*`, one
  `**` with a non-literal exponent) and 4 timing clocks (8 until the classic generator went at C1), per file and function. It may shrink, not grow. P2b and P2c empty it.
- **F11. `x ** 2`** appears 111 times in the same scope. It is allowed: engines compute an integer-literal power
  exactly in practice, but the spec leaves `**` implementation-approximated like `Math.pow` [4]. Owner, 2026-11-21:
  P2b replaces all 111 with `x * x`, and the guard counts `** 2` from then on.
- **F12. The one `todo` test** (`tests/spatial.test.ts`, "World.sight (I2)"): the 0.5 m sampled sight line sees
  through a wall corner. Its note names Stage 7A (enemy line of fire on `segmentClear`, enemy hashes migrated once)
  [I1a]. Owner, 2026-11-21: part of T2 planning; hero bots must not see through wall corners. **Closed under Rapier
  (I1a, 2026-11-25):** on the physics flag the seam's `sight` is the exact segment and the same 50 phases are blocked
  (`tests/physics-parity.test.ts` "F12 on physics"). The tile World's sampled sight and its `todo` stay until X1b
  deletes them.

Closed in §11 since it was written: Hold off the title (`81e7050`), the empty title plaque (`03f7d4b`), the dead
survivor event paths (`5b6fcde`), the survivor scenes (Q45, `dacdda8`), the elite, alpha, boss and stampede roles
(`22e6f2a`).
