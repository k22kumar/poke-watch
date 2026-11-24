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
| G0 | 3D generator design, docs/WORLDGEN3D.md | queued | |
| I1a | Physics world and queries | queued | Acceptance includes F12 (D7). |
| I1b | Character movement | queued | |
| I3 | Navigation | queued | Acceptance includes P6: the F1 faults and the F2 shore search (D7). |
| I1c | Enemies, bodies and bots on physics and navigation | queued | |
| I4 | Hazards, surface states and destructibles | queued | |
| I2a | three.js scene | queued | |
| I2b | Actors, effects and camera | queued | |
| G1 | Generator core and the 3D range | queued | |
| G2 | The first 3D Hold map | queued | |
| X1a | Cutover: flags on, fixed views retired, new replay baseline | queued | |
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
- **F28. Adapter gaps by design** [I1a / I3]: every deck is `wood`, rock shelves included (ArenaMap does not say which is which). The stairs wedge between the ramp and its base box is left open; only the range has stairs (2 ramp triangles). No kill volume, because killY comes from `rules.hazards.killDepth`, not from map data. The contest is a marker (a cylinder, not a box). Ice, tides, burning and breaking are run state: colliders carry the prop index as `destructible`, and the model is the map as built.
- **F29. Conformance gate runtime** [tests]: `tests/worldmodel.test.ts` takes about 11 s, mostly map generation and World construction (the adapter itself runs in 14–38 ms per map).

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
  This needs a dispose entry point and a flat-memory check in the shared test setup (decision O7).
- **F37. Determinism coverage** [I1a, before X1a]: shown on macOS arm64 and Linux x64 with V8 only. Firefox,
  WebKit, Windows and the snapshot round trip (D6) are untested (decision O8).
- **F38. The loader depends on wasm-bindgen glue internals** [I1a]: `__wbg_set_wasm`, the import module name
  `./rapier_wasm3d_bg.js` and the extensionless `raw.js`. A Rapier upgrade can break it, so keep the exact pin and a
  load test. The Node path needs Node ≥ 22.15 (`module.registerHooks`). Owner (O1): I1a adds
  `"engines": { "node": ">=22.15" }` and the load test.

### Found in S2 (2026-11-23)

- **F39. Renderer timings on a lower-end machine** [owner, before I2a]: S2 measured only an M3 Max, which idles through every scene; step 4 (the owner on a weaker machine) was recorded as not measured. URLs and what to read: docs/spikes/S2-renderer.md "Step 4". WebGPU needs a secure context (`navigator.gpu` exists only on HTTPS or localhost): copy the `S2_THREE=all` build folder to the lower-end machine and serve it on that machine's localhost, or use HTTPS; the Mac's dev server over the LAN has no WebGPU. The frame budget there is a proposal until this is done, and the WebGPURenderer choice reopens if `forceWebGL` misses the budget where WebGLRenderer meets it.
- **F40. WebGPURenderer's output pass** [I2a]: with sRGB output it renders into an RGBA16F target and blits it with the colour transform: one more call and up to +0.9 ms GPU on this GPU when sprites overdraw (an RGBA8 target does not help). Owner (S2 decision 2): a `RenderPipeline` from the start, ending in `renderOutput`; no sRGB in the materials.
- **F41. The x-ray silhouette shows the player's feet** [I2b]: the sprite's lowest rows sit below the adapter's ground surface, so `GreaterDepth` draws them through the ground the Pokémon stands on (both renderer paths). Needs a depth bias or a test that ignores the ground under the subject.
- **F42. TSL churn and typings** [I2a]: renames inside 0.18x (`directionToColor` → `packNormalToRGB`, `PostProcessing` → `RenderPipeline`), `PCFSoftShadowMap` removed in 0.187, and `@types/three` 0.187 rejecting valid TSL calls (the spike casts them to `any`). Owner (S2 decision 6): three pinned exactly, upgraded as its own task with the S2 matrix re-run; I2a brings `tools/s2perf.mjs` and `tools/s2matrix.mjs` into `tools/`.
- **F43. Look of the three.js frame** [I2a]: the spike's frames are paler than the art direction (Lambert, untuned light intensities, three's linear fog instead of `FOG_GLSL`'s squared ramp and veil, the x-ray colours passed through the output transform under TSL). No art judgement was made in S2.
- **F44. Creature shadows** [I2b]: billboards can cast card shadows (free under TSL; a `customDepthMaterial` under WebGLRenderer), but a card faces the main camera, so its shadow turns with the camera's yaw. Owner (S2 decision 4): blob decals, as today; the decal work is deferred.

### Found in housekeeping (2026-11-21)

- **F10. The determinism allow-list** (`tests/determinism.test.ts` since C1): 76 maths call sites (75 `Math.*`, one
  `**` with a non-literal exponent) and 4 timing clocks (8 until the classic generator went at C1), per file and function. It may shrink, not grow. P2b and P2c empty it.
- **F11. `x ** 2`** appears 111 times in the same scope. It is allowed: engines compute an integer-literal power
  exactly in practice, but the spec leaves `**` implementation-approximated like `Math.pow` [4]. Owner, 2026-11-21:
  P2b replaces all 111 with `x * x`, and the guard counts `** 2` from then on.
- **F12. The one `todo` test** (`tests/spatial.test.ts`, "World.sight (I2)"): the 0.5 m sampled sight line sees
  through a wall corner. Its note names Stage 7A (enemy line of fire on `segmentClear`, enemy hashes migrated once)
  [I1a]. Owner, 2026-11-21: part of T2 planning; hero bots must not see through wall corners.

Closed in §11 since it was written: Hold off the title (`81e7050`), the empty title plaque (`03f7d4b`), the dead
survivor event paths (`5b6fcde`), the survivor scenes (Q45, `dacdda8`), the elite, alpha, boss and stampede roles
(`22e6f2a`).
