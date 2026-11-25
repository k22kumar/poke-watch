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
| 5 | T2 planning: P1 | queued | After X1c (decisions D6, D7). **P1**: per-player systems, and teams in damage (today one player, one enemy side). **F12** (hero bots must not see through wall corners) folded into I1a and **P6** (spikes and navigation faults on the Hold maps, F1, F2) into I3 (decision D7). |
| 6 | The next `HAB_VERSION` bump | dropped | The habitat generator is replaced by the 3D overhaul (decision D7). Was: two parts in one bump, with `docs/habaudit/baseline.json` regenerated: the navigation profiles (F3), and P2c, the 68 habitat-generator `Math` call sites on the allow-list (`world/habitat/`: landforms 33, dress 9, families 9, sanctuary-checks 5, validate 5, graves 2, index 2, ruins 2, lagoon 1). |
| 7 | T1 co-op wave, T2 3v3, exp → Candy, the dream shop | queued | After X1c (decision D6). T1 takes the navigation faults it pays for (F1) and Hold balance (F4); T2 needs item 5 first. |

Done before this file: the hero-shooter pivot (`docs/hero-shooter-pivot.md`, merged `ad0cdc7`); pointer-lock request
handling, which unblocked the Pages deploy (`da19699`).

## The 3D overhaul (owner, 2026-11-22)

The tile world is replaced by a fully 3D one: a three.js renderer, a mesh world (WorldModel) and Rapier physics. The
plan, the WorldModel contract, the migration rules and the decisions are in `docs/OVERHAUL_3D.md`. Until the cutover
(X1a), new systems land behind flags that default off and every existing replay scenario prints "as recorded".
The overhaul's WM and WS were named P1 and P2 before the C0 review.

| ID | Task | Status | Notes |
|---|---|---|---|
| C0 | Record this plan | done | Done on `docs/c0-overhaul-plan`: `docs/OVERHAUL_3D.md`, this section, the CLAUDE.md pointer. |
| C1 | Cleanup of obsolete code (overworld game, original creatures, classic generator, survivor chests, dead exports, historical docs) | done | Done on `chore/c1-cleanup` (2026-11-23); the pre-cleanup state is tag `maplebrook-final` (`0dec749`, local). Removed the Maplebrook overworld game and page, the original-creature pipeline and the build's `--tool` / `--overworld` paths, the classic generator (`src/world/gen`, `?world=gen`, the 'generated' World setting, `rules.worldgen.biomes` / `.version`; what locgen and habitat used moved to `src/world/tilenav.ts` and `genmeta.ts`), the survivor chests with `progressionSystem` and `noSurvivorLoop`, the overworld-only audio hooks (F9), 45 unused exports, with 145 more made file-local; historical docs moved to `docs/archive/`. Tests: the determinism guard moved to `tests/determinism.test.ts` (allow-list 84 → 80); the classic generator's 5 tests and the two map-seam tests that asserted classic behaviour were deleted; the 9 that used classic regions only as fixtures run on habitat and location maps instead (owner review, 2026-11-23). Replays 10/10 as recorded; no `HAB_VERSION` / `LOC_VERSION` change. `dist/index.html` 1,459,621 → 1,403,932 bytes. Follow-ups F20 (closed), F21–F23. |
| WM | WorldModel types and the tile adapter | done | Done on `feat/wm-worldmodel-clean`: `src/world/model.ts`, `src/world/adapter.ts`, `tests/worldmodel.test.ts` (OVERHAUL_3D "WorldModel"). Every map source matches the column model exactly. Nothing in the game reads it. Follow-ups F25–F29. |
| C2 | Layering fix and the import guard test | done | Done on `chore/c2-layering` (2026-11-23). The world-geometry core of `sim/spatial.ts` (the world kinds and flags, `RayHit`, the scratch array, `Geo`, the column model, the tile walk) moved unchanged to `src/world/sight.ts` with `mapSegmentClear` and `mapExposureClear`; `Geo` takes a structural `GeoLayers` instead of the sim `World`; `sim/spatial.ts` imports the core back and re-exports `SK`, `SK_WORLD`, `CF`, `QF`, `RayHit`. `habitat/validate.ts`, `locgen/nav.ts`, `scripts/habsanct.ts` and the import line of `tests/spatial.test.ts` read the map functions from `world/sight`; `render/chaseinput.ts` reads `DECK_SLAB` from `world/tiles`. New `tests/imports.test.ts` parses every import under `src/` (TypeScript `preProcessFile`: static, re-export, dynamic and `import()` types) against the README rule list, with a self-test per rule. The determinism allow-list entry `{ hypot: 1 }` followed `mapExposureClear` from `sim/spatial.ts` to `world/sight.ts` (total unchanged, 80). Replays 10/10 as recorded; habstate 24/24; habaudit digests identical to `main` (the `sim` field differs from the committed baseline on both, F23); baseline not rewritten. perf-sim 500 min of 3: p95 0.676 ms, p99 0.923 ms (PASS). Follow-up F24. |
| S1 | Rapier spike, record in docs/spikes/S1-physics.md | done | Done on `docs/s1-record` (2026-11-23); spike code on `spike/s1-rapier` (kept, never merged, head `ee251d0`). **Owner's answers (2026-11-23):** O1–O9 all yes (record "Decisions for the owner"); O2: enemies get no controller and are not Rapier bodies, ground height from the navmesh polygon; O4: I1b's own step rule climbs every rise ≤ 0.6 m (every class, 0.5–9 m/s, head-on and 45°) and refuses ≥ 0.62 m, plus a G0 dead band for generated rises. `@dimforge/rapier3d-deterministic` 0.21.0, plain build, wasm as a fetched file (`dist/physics/`, 3,105,893 B); `dist/index.html` 1,406,195 → 1,633,420 B; init 30.9 ms in Node, 11–12 ms in the page. **Deterministic:** a 60 s controller course (five size classes, per-tick hashes), a dynamic pile and 250 query results hash identically on macOS arm64 and Linux x64, Node 22 and 24, Node and Chromium, for `-deterministic` and `-simd` (CI run `45291331909`). Colliders: the adapter's boxes (919 on the range, 2,938 on River Gorge seed 1) are cheapest in a crowd; merged trimesh chunks for G1; no heightfield on adapter maps. Cost: 50 controllers already take 1.2–2.2 ms p95 per tick, so enemies follow navmesh corridors with a ground query (500 rays 0.6–0.7 ms), and controllers are for heroes and bots. Fit: stairs, underpasses (1 mm head margin), wall slides and controller seams work; **Rapier's autostep is speed- and angle-dependent and over-climbs** (risk R1, I1b). Follow-ups F34–F38. |
| S2 | three.js spike, record in docs/spikes/S2-renderer.md | done | Done 2026-11-23: record `docs/spikes/S2-renderer.md` (branch `docs/s2-record`); code on `spike/s2-three` (never merged). three 0.187.0 behind `?render=three` draws the WM adapter's surfaces (range, River Gorge seed 1) with a hemisphere light, a PCF-shadowed sun, vertex colour and fog, the ChaseRig driving the camera, and 240 creatures as instanced billboards written twice (GLSL `ShaderMaterial`, TSL node material). Measured on WebGLRenderer, WebGPURenderer on WebGPU and with `forceWebGL` (headed Chromium, M3 Max, GPU timer queries): bundle +589 / +879 KB (+150 / +242 KB gzip), first frame 236 / 286 / 318 ms, GPU p50 0.64 / 0.72 / 1.15 ms at 1080p (WebGPURenderer level with WebGLRenderer on both backends once its output pass is removed, F40); BatchedMesh works on all three; an edge pass over depth and normals on each. Recommends WebGPURenderer + TSL and lists six owner decisions. Owner's answers (2026-11-23, record "Decisions for the owner"): WebGPURenderer + TSL, conditional on F39; a `RenderPipeline` from the start, ending in `renderOutput`; three and the new renderer as a fetched side file, `dist/index.html` stays under 3 MB; blob decals for creature shadows; three pinned, upgraded as its own task. Lower-end machine not measured (owner). Follow-ups F39–F44. |
| WS | Sim world seam (hash-invariant refactor) | done | Done on `refactor/ws-world-seam` (2026-11-23). `src/sim/worldquery.ts`: `WorldQuery`, 3D-native questions in (x, y, z) order (support and surface, liquid contact, headroom, the footprint move and fit tests, wall tops, rays, walkable and placement, `navDir` / `navReached` / `navDist` for an agent size), the `GROUND` sentinel for today's 77 column calls, the named tile extensions `TileExt` (`W.tiles`) and the accessor `worldOf(ctx)`, I1a's swap point (the second is spatial.ts `geoOf` + `castWorld`). `class World implements WorldQuery` with one block of wrappers that call its existing methods with the same arguments in the same order; no existing method changed. Every src/sim system migrated: 0 World accesses outside world.ts / spatial.ts (was 342 over 54 members), 157 to 22 WorldQuery members, 189 to 31 TileExt members. `tests/worldseam.test.ts` guards it (217 violations on `main` before). Grilling answers Q1–Q16 in OVERHAUL_3D "World seam"; README §Architecture rule 6. Replays 10/10 as recorded; navwalk 0 failures (byte-identical); stuckwatch identical to `main` (14 player episodes, 3 TRAPPED, 31 enemy); habplay 72/72; perf-sim 500 min of 3, two runs: p95 0.672 / 0.679 ms, p99 0.921 / 0.939 ms (PASS; `main` alternated with it: p95 0.671 / 0.679, p99 0.934 / 0.947; recorded baseline 0.689 / 0.936). F24 closed. Follow-ups F30–F33. |
| G0 | 3D generator design, docs/WORLDGEN3D.md | done | Done on `docs/g0-worldgen3d` (2026-11-24). Design only, no code: `docs/WORLDGEN3D.md` holds the owner's 22 decisions (Q1–Q22, 2026-11-23 to 24), the owner's Q23 added after the grilling (the low-poly profile and the render plan, 2026-11-24), the consolidated WorldModel contract changes, the deliberate departures from the blueprint and the open items. In short: plan → check → embed → build → emit → validate → freeze → dress over a zone graph and a space IR; boxes for structures and trimesh for terrain and sweeps (no Rapier heightfield); dead bands on steps, slopes, gaps and cover derived from `rules.size`; a five-route Hold template with half-turn symmetry; gates in classes A–F with count-based attempts, IR-patch repairs and a curated-seed fallback; recipes, archetypes, material roles and styles as typed data in `src/rules/`; one shading model, a world material family that serves two dev profiles (`storybook`, `lowpoly`; which ships is open); a 64-bit `gameplayHash` with `WORLD_VERSION`, `MODEL_VERSION` and a computed `requirementsHash`; budgets as counts at `emit`; the range as authored space IR. Follow-ups F45–F51. The owner's review (2026-11-24) added two tasks, WM2 and CL, and narrowed the cutover to layer 1 of the first map (WORLDGEN3D "Open items", task order and scope). |
| WM2 | WorldModel contract v2 | done | Done on `feat/wm2-model-v2` (2026-11-25). The WORLDGEN3D contract table as types in `src/world/model.ts` with `MODEL_VERSION = 2`, the role union of Q16.2 in `src/rules/materialroles.ts`, and the tile adapter filling defaults that keep today's meaning: `blocksSight = blocksShots`, a role per collider and per render chunk (the crude table in `src/world/adapter.ts`'s header; Mt. Moon's crate and fossils `cover`, F52), the liquid id on liquid volumes and chunks, `requestedSeed = seed`, every new array empty. Render chunks lost `normals` and `colours`, are split by role and welded; triangle counts per map equal main's, and the adapter runs 0.85× main's time. Nothing in the game reads the model; replay hashes unchanged. The settled names are beside each row of WORLDGEN3D "WorldModel contract changes". Follow-ups F52–F56. |
| I1a | Physics world and queries | done | Done on `feat/i1a-physics` (2026-11-25); record in docs/OVERHAUL_3D.md "Physics (I1a)". `@dimforge/rapier3d-deterministic` 0.21.0 pinned exactly, loaded as S1 recommends (`src/physics/rapier.ts`, `node.ts`, `web.ts`, `scripts/lib/rapierwasm.mjs`; `engines` node ≥ 22.15; `tests/physics-load.test.ts` names the glue internal that moved, F38). `src/physics/world.ts` `PhysicsWorld`: static colliders from the adapter's WorldModel, rays and upright-cylinder sweeps (`cast` / `sweep`, the Probe's shapes, Q12.2), segments, points, overlaps, support below, liquid at; kind and query mode in Rapier's collision groups, shots and sight kept apart (Q15.4); actors stay in `sim/spatial.ts` (O2). `src/sim/physseam.ts`: the bridge behind `rules.physics.engine = 'rapier'` (default `'tiles'`; page `?physics=rapier`), swapped in at `worldOf` and spatial.ts's world casts; aim, line of sight, shots and beams on physics, movement on tiles. `disposeRun` and map changes free the world; wasm memory flat over 50 runs (`tests/physics.test.ts`, F36); a snapshot round trip gives the next 600 ticks identical hashes (O8, R12). `tests/physics-parity.test.ts`: the spatial scenes and 20,000 queries on 10 adapter maps agree except the documented differences D1–D6 (closed sets, f32 and shape-cast tolerance, ids, fat casts at ramps, the far field, skip-initial on merged boxes). **F12 closed on Rapier** (the seam's sight is exact; the tile `todo` stays until X1b). Replays: 10/10 as recorded with the flag off; `range-charmander-rapier` and `gorge-hold-rapier` recorded, equal to their tile hashes (24,580 and 4,086 physics queries, every one matching). perf-sim 500 --repeat 3 --gate, min of 3 (PASS all): flag off p95 0.674 / p99 0.922 ms (twice: 0.674 / 0.920); flag on 0.728 / 0.986, with `--aim` off 0.615 / 0.895 and on 0.668 / 0.970; physics' share with `--aim` 0.4 % of the ticks at or above p95 (p95 0.007 ms per tick), 0 without it, so the flag-on rise is the seam's forwarding (F59). `dist/index.html` 1,406,195 → 1,656,131 B; new side file `dist/physics/` 3,105,893 B. Follow-ups F52–F58. |
| I1b | Character movement | queued | From G0: F46 (the traversal kinds the generator assumes; by the owner's answer B their mechanics are tasks after X1c); the liquid modes of WORLDGEN3D Q9; the spawn barrier is not enforced here (it lands with G2: Q8h). |
| I3 | Navigation | queued | Acceptance includes P6: the F1 faults and the F2 shore search (D7). From G0: a tiled navmesh that rebuilds only the tiles a feature or state touches, temporary objects as TileCache-style obstacles, the volume-routing graph for air and water, and the Recast timings G0's budgets wait for (WORLDGEN3D Q8, Q20b, Q21b). |
| I1c | Enemies, bodies and bots on physics and navigation | queued | From G0: a breakable only removes its colliders when it breaks, and its residue has none (WORLDGEN3D Q21.9). |
| I4 | Hazards, surface states and destructibles | queued | G0's input is collected in WORLDGEN3D "Open items" (Input to I4): Q9 liquids, the Q10 notes, Q15(g), Q21. |
| I2a | three.js scene | queued | From G0 (WORLDGEN3D Q16, Q18, as amended by Q23): one world material family that serves the `storybook` and `lowpoly` profiles, with its parameters (ramp, normal mode per role, paint terms, pattern, ink); role-driven materials with no authored image textures (code-made textures are allowed); normals computed in the renderer, since render chunks carry none; the per-profile pass list from a closed registry (ink and bloom optional); the ambient rig (two sets of six colours per keyframe, blended by sky visibility) and grading in the output step; the baked lamp channel for local light; the complete time-of-day system for the cutover (per-map fixed times, partial cycles and complete cycles, with working time progression) and developer controls to preview and test any time of day (owner, 2026-11-24: WORLDGEN3D Q23.2); the pass order that keeps a signal's colour and luminance free of a map's grade, fog and bloom (with I2b). Measurements: the render budgets are recalibrated here once F39 is measured (Q20), and the same profiling sets the backdrop, particle-card and stroke budgets and bloom's default; I2a also restates what the emitter overlap number bounds under the baked lamp channel (Q20c). |
| CL | Camera law | queued | Owner, 2026-11-24. Runs before G2 and I2b. The view band and the camera distance law in `src/rules` (WORLDGEN3D Q7c, Q15g, Q15b), and the sim rule of Q15(g): a shot needs line of sight from the clamped view point (`src/sim/aim.ts`), flagged off until X1a. F45, F51. The generator waits on its distance number for the `camera-clearance` dimension and the tall-dressing keep-out. |
| I2b | Actors, effects and camera | queued | From G0: the owner's camera direction (WORLDGEN3D Q15g) replaces the framing law. CL sets the law and its numbers; the render side stays here (the rig on that law, own-body fade, the pull-in around walls). From WORLDGEN3D Q23: the per-instance actor tint for local light; the signal language (keyline, underlay, patterns, a shape and an icon per kind) with one occlusion rule per signal kind and its lint; team colours as a player setting with colour-vision presets; the effect cards (glow sprites, particles), code-made only: shader maths, or small procedurally generated textures made once and shared. |
| G1 | Generator core and the 3D range | queued | Scope from WORLDGEN3D Q22.6: the IR types, the kit, `build`, `emit`, gate classes A and C, the hash, the dressing interface, and the range as authored space IR with its stations. **Needs WM2, I1b, I2a and I3** (its class A gate needs the navmesh). The model types and `MODEL_VERSION` are WM2's, not G1's; G1 fills them from the generator. The measurements it owes are in "Open items", with controller cost on the generated terrain first, before the 80,000-triangle cap is accepted. From WORLDGEN3D Q23: hull proxies for rocks (with the Q15.2 measurement), the default exaggeration value and its per-archetype override, the first render-side mesh builders, and where the kit-piece list for their skins travels. |
| G2 | The first 3D Hold map | queued | Scope from WORLDGEN3D Q22.6: `plan`, `embed`, the Hold template, gate classes B, D and E, the repairs, and River Gorge re-authored in layers (Q14c). It calibrates the numbers listed for it in "Open items". Owner, 2026-11-24: the cutover needs **layer 1 only** (baseline walking routes, with liquids, timed hazards and breakables per Q9 and Q21); layers 2–5 and their mechanics are tasks after X1c. `plan` and `embed` lay out all five route roles of Q11 from layer 1: the "over" and "under" tertiaries are planned and their space is kept empty, so layers 2 and 3 fill it without moving the baseline routes. Each later layer changes River Gorge's `gameplayHash` as a planned change, named by its task, with the River Gorge scenarios re-recorded once and the reason in the commit (Q19.6); any other moved hash is still a stop. Needs CL. The sim rule for the team spawn barrier lands here, tested on G1's range station (Q8h, Q22a). |
| X1a | Cutover: flags on, fixed views retired, new replay baseline | queued | Owner, 2026-11-24 (WORLDGEN3D "Open items", task order and scope): needs layer 1 of the first map only (baseline walking routes, with liquids, timed hazards and breakables per Q9 and Q21). Fly, climb, burrow, dive, stateful features, concealment, items, the species section and overlays are tasks after X1c. The complete time-of-day system is in at the cutover (I2a); a map may ship on a fixed time, and switching its running cycle on once it passes its readability, consistency, fairness and performance checks is what comes after X1c. CL's aim rule (F51) turns on here. |
| X1b | Delete the tile stack | queued | Closes F1, F2, F3 (D7). |
| X1c | Docs and instructions | queued | Queue items 5 and 7 follow it (D6, D7). |

### Owner decisions (2026-11-22)

- **D1 Direction.** A three.js renderer, a mesh world (WorldModel) and Rapier physics replace the hand-written WebGL2
  tile stage and the tile column collision. This reverses the earlier advice to keep both. The replay baseline is
  re-recorded once, at the cutover (X1a), named in that commit. Until X1a no shipped behaviour changes.
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
  Logged, not fixed; `stuckwatch` not re-baselined. Superseded by the overhaul; closed at X1b.
- **F2. perf-sim spike on Totodile seed 1** [P6, before T1's crowd]: ticks up to 18 ms after about 199 s,
  deterministic. The exposure system's pond shore search for enemies knocked into the pond. Within the gate's p95 / p99;
  cache or bound the shore search. Superseded by the overhaul; closed at X1b.
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
- **F28. Adapter gaps by design** [I1a / I3]: every deck is `wood`, rock shelves included (ArenaMap does not say which is which). The stairs wedge between the ramp and its base box is left open; only the range has stairs (2 ramp triangles). No kill volume, because killY comes from `rules.hazards.killDepth`, not from map data. The contest is a marker (a cylinder, not a box). Ice, tides, burning and breaking are run state: colliders carry the prop index as `destructible`, and the model is the map as built. *I1a:* the physics bridge (`sim/physseam.ts`) fills the stairs wedge with query-only hulls, reads ice and chasms from the World, and rebuilds from the live map after a geometry change (F52); the adapter is unchanged.
- **F29. Conformance gate runtime** [tests]: `tests/worldmodel.test.ts` takes about 11 s, mostly map generation and World construction (the adapter itself runs in 14–38 ms per map). *(WM2, 2026-11-25: 12–19 ms per map, the median of 7 runs, against 14–23 ms on main by the same measure.)*

### Found in WS (2026-11-23)

- **F30. 77 column calls pass `GROUND`** [I1b, I1c]: `surfaceAt`, `walkableAt`, `nearestWalkableAt`, `place` and `setNavGoal` calls with no reference height (spawns, relocations, grounded checks, the bot's probes). Each needs a real y on the physics path; that changes behaviour, so it lands behind the physics flag. `grep -rn GROUND src/sim` lists them.
- **F31. World readers outside the seam** [I2a, X1b]: render (`renderer.ts` 33 `height` calls, `chaseinput.ts`, `camera.ts`), `ui/ui.ts` and about 1,500 accesses in tests and scripts read `World` directly (`SimContext.world` stays typed `World` on purpose, Q1). Render moves at I2a; the tile tests and gates go with the tile stack at X1b.
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
  rises out of a dead band below the lowest blocking ledge.
- **F35. The adapter's render surfaces are not collision-grade at stairs** [I2a, G1]: a stairs tile is drawn as a
  column at the ramp's mid height plus the slope quad, so 0.5–1 m lips stick up through the drawn ramp (the range's
  flight). Physics must build from the colliders; the renderer shows the lips too.
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

- **F39. Renderer timings on a lower-end machine** [owner, before I2a]: S2 measured only an M3 Max, which idles through every scene; step 4 (the owner on a weaker machine) was recorded as not measured. URLs and what to read: docs/spikes/S2-renderer.md "Step 4". WebGPU needs a secure context (`navigator.gpu` exists only on HTTPS or localhost): copy the `S2_THREE=all` build folder to the lower-end machine and serve it on that machine's localhost, or use HTTPS; the Mac's dev server over the LAN has no WebGPU. The frame budget there is a proposal until this is done, and the WebGPURenderer choice reopens if `forceWebGL` misses the budget where WebGLRenderer meets it.
- **F40. WebGPURenderer's output pass** [I2a]: with sRGB output it renders into an RGBA16F target and blits it with the colour transform: one more call and up to +0.9 ms GPU on this GPU when sprites overdraw (an RGBA8 target does not help). Owner (S2 decision 2): a `RenderPipeline` from the start, ending in `renderOutput`; no sRGB in the materials.
- **F41. The x-ray silhouette shows the player's feet** [I2b]: the sprite's lowest rows sit below the adapter's ground surface, so `GreaterDepth` draws them through the ground the Pokémon stands on (both renderer paths). Needs a depth bias or a test that ignores the ground under the subject.
- **F42. TSL churn and typings** [I2a]: renames inside 0.18x (`directionToColor` → `packNormalToRGB`, `PostProcessing` → `RenderPipeline`), `PCFSoftShadowMap` removed in 0.187, and `@types/three` 0.187 rejecting valid TSL calls (the spike casts them to `any`). Owner (S2 decision 6): three pinned exactly, upgraded as its own task with the S2 matrix re-run; I2a brings `tools/s2perf.mjs` and `tools/s2matrix.mjs` into `tools/`.
- **F43. Look of the three.js frame** [I2a]: the spike's frames are paler than the art direction (Lambert, untuned light intensities, three's linear fog instead of `FOG_GLSL`'s squared ramp and veil, the x-ray colours passed through the output transform under TSL). No art judgement was made in S2.
- **F44. Creature shadows** [I2b]: billboards can cast card shadows (free under TSL; a `customDepthMaterial` under WebGLRenderer), but a card faces the main camera, so its shadow turns with the camera's yaw. Owner (S2 decision 4): blob decals, as today; the decal work is deferred.

### Found in I1a (2026-11-25)

- **F52. A physics rebuild costs 25–50 ms** [I4]: a run-time geometry change (a prop burns or breaks, the tide turns, water freezes or thaws) rebuilds the whole physics world at the next query: the adapter 17–40 ms (most of it the render surfaces physics does not read), the extras 1–6 ms, Rapier 3–12 ms (range, River Gorge). No replay track changes geometry (one build each), so it is not in any gate. I4 owns the incremental update (remove and add the changed tiles' colliders).
- **F53. Sweeps stop up to about 1 cm short** [I1b, I4]: Rapier's shape cast stops within its GJK tolerance, a few millimetres before contact (decimetres of t on a grazing approach); rays are exact to f32. Shots with a world radius stop a little before walls on the physics path. Nothing in the replay tracks moves by it; the bodies' casts in I1b meet the same tolerance.
- **F54. skipInitialWorld skips a merged box whole** [CL, I1b]: on physics a collider containing the start is ignored entirely, on tiles only the start's own tile column (parity D6). Only the camera trace skips (from the partner's chest plane). The mesh world's chunks make it larger; CL's camera law decides what the crosshair trace may start inside.
- **F55. The far field** [G1]: the tile columns are infinite (walls and the map edge up, the ground down); physics stops at the model's bounds floor and EDGE_PAD (64 m) above its top (parity D5). Matters only for rays leaving the play space.
- **F56. Concealment volumes and the sight-only kinds** [WM2, I4]: the query modes keep shots and sight apart, and a collider's `blocksSight` is read when WM2 adds it, but the model has no `concealment` volume yet (WORLDGEN3D Q12.9, Q15.4 `screen`), so nothing blocks sight only.
- **F57. Physics in the replay hash** [I1b]: D2 says physics state is part of the replay hash. I1a's world is static and query-only, a function of the map, so `replayHash` reads nothing from it; I1b's bodies and controllers must be hashed.
- **F58. F32 left as it was** [X1b]: the physics path reads `W.tiles.los` (enemy fire on location maps) and `W.tiles.hazards` (chasms are voids only with hazards on) exactly as the tile World does; dropping them waits for the mesh world. The page bundles Rapier's JS always (+249,936 B on `dist/index.html`) and fetches the wasm only with `?physics=rapier`.

- **F59. The physics seam's forwarding costs about 0.05 ms at p95** [I1b]: with the flag on and no crosshair ray, Rapier answers nothing in perf-sim, yet p95 rises 0.674 → 0.728 ms (min of 3): every world call site now sees two receiver types (World and PhysicsSeam) and goes through one more call. I1b moves the movement members to physics anyway; if the forwarding stays, World can hold the bridge and branch in its four ray wrappers instead.

### Found in G0 (2026-11-24)

- **F45. The camera docs describe a superseded framing law** [CL]: the owner's camera direction (WORLDGEN3D Q15g) is a low, close chase camera with the view height clamped to a band (0.60–1.35 m as a starting tunable), own-body fade, wall pull-in and "what you see is what you can hit". `docs/CAMERA.md`, `docs/THIRD_PERSON.md` and `CHASE_CONFIG.frame` (`src/render/camera.ts`) still hold the law it replaces (back distance from drawn height, up to 14 m). The generator waits on one number from this: the camera distance, which sets the `camera-clearance` dimension and the tall-dressing keep-out.
- **F46. Traversal kinds the generator assumes** [I1b, owner; mechanics after X1c by the owner's answer B, 2026-11-24]: `climb` and `burrow` are not kinds in `src/rules/traversal.ts`; `fly`, `levitate` and `dive` are reserved with no mechanics. The flight mechanic (fuel, time or a jump count) is the owner's open decision (WORLDGEN3D Q8.2).
- **F47. A recipe's species section has no reader** [owner, T1]: WORLDGEN3D Q14(e) lets a recipe carry a species list or filter (wild and ambient spawns, an allowed roster). Pivot Q9 removed spawn pools, nothing in the sim reads such a list, and `SpeciesDef` has no region or theme field for a filter.
- **F48. No item system** [owner]: the generator emits item-candidate markers balanced between the teams (WORLDGEN3D Q10e); the sim would pick the items per match. Pickups left with the survivor loop.
- **F49. The blueprint and the research reports are not in the repo** [owner]: the G0 decisions quote "the blueprint" by section and term, and two research reports that the G0 brief summarised. The full text of none of them was given in the grilling, and the owner's answers never named the blueprint by title. (This entry first named the "Procedural Pokémon World Blueprint": that title was taken from the code comments in `src/rules/surfaces.ts` and `src/sim/props.ts`, not from the owner.) WORLDGEN3D records each deliberate departure, but a reader cannot check the sources. Add them under `docs/`, or accept WORLDGEN3D as the record. Owner, 2026-11-24: will add the blueprint to `docs/`, or name WORLDGEN3D the record. Still open. The owner believes the source is "Map and Environment Generation Blueprint" (`claude/00-blueprint.md` in another Claude project). The Claude Docs artifact titled "Procedural Pokémon World Blueprint" (2026-10-22) is an older tile-era document and holds none of the quoted terms (GameplayBundle, SDF, Zod), so it is not the source.
- **F50. The porting order of the other five habitat recipes** [owner, after G2]: River Gorge is the first recipe in the new format (WORLDGEN3D Q14.10); the order of the rest is not decided.
- **F51. Shots need line of sight from the clamped view point** [CL]: WORLDGEN3D Q15(g), "what you see is what you can hit". Today `src/sim/aim.ts` traces the crosshair ray from the partner's chest plane and launches from a muzzle at 0.6 × the class height (`rules.aim.muzzle`: Extra Large 1.44 m, more for the tall giants), which is above the 1.35 m view cap, so a tall body can fire over cover its clamped view cannot see over. CL adds the rule behind a flag that stays off until X1a; turning it on moves replay hashes, inside the cutover's planned new baseline.

### Found in WM2 (2026-11-25)

- **F52. The role of Mt. Moon's crate and fossils** [owner]: the `crate` (0.80 m) and `fossil` (0.45 m) low props have no `PROP_MATERIALS` row, so their colliders take the tile's terrain name (`dirt`) as material, as on main, and the adapter gives them that terrain's role, `soil` (4 tiles on Mt. Moon seed 1; their render tops were terrain-coloured on main too). The brief's prop rule (by material) does not cover them. Options: keep `soil` until G1; call them `cover`; or give them material rows, which changes the sim (props.ts reads the table) and moves hashes. **Resolved by the owner (2026-11-25):** `cover` in the tile adapter (collider, render top, side segments above the ground); the collider's `material` stays `dirt` (F55), no material rows, no sim change. G1 replaces it.
- **F53. The adapter does not read the habitat fallback** [G1]: `meta.requestedSeed` is written equal to `meta.seed` (= `ArenaMap.gen.seed`, the seed asked for), as the brief says. A habitat that fell back records `{ requested, used, why }` in `gen.hab.fallback`, and `m.id` names the used seed; no map source in the tests falls back today. G1 writes the real pair and `seedReason`.
- **F54. Crude roles to replace** [G1, I2a]: the side faces of ground are `cliff`, bridge-plank rims (`wood` ground) included; stairs are `rock` (their terrain is stone); a deck is `floor` on its top, underside and rim (not `trim`); `bed`, `wall`, `roof`, `trim`, `objective` and `hazard` are never written (no bed under a tile liquid, no built walls or roofs in the tile data, vent fields are volumes).
- **F55. `material` is still a string** [G1]: the additive rule kept `ColliderBase.material` as the tile era's string (a `MaterialId` for props, a terrain name for ground). Q16.4's resolved `MaterialId` is therefore not enforced by the type; narrowing it is a `MODEL_VERSION` change for G1, after the `soil` material of Q16.6 exists.
- **F56. Feature nav tiles need I3's tile size** [I3, G1]: `Feature.navTiles` lists navmesh tiles (tx, tz) per state (Q20b), and the tile size is not decided until I3 measures Recast.

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
