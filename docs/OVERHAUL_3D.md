# The 3D overhaul

The plan for replacing the tile world with a fully 3D one. Owner decisions 2026-11-22, re-planned 2026-11-25 (D8 to D15). Task order and status: docs/ROADMAP.md.

## Why
Every map today is an ArenaMap (src/world/tiles.ts): a 1 m tile grid with one height per tile, one optional deck, wall columns and stair ramps. Generators produce it, the sim collides and navigates on it (sim/world.ts, sim/spatial.ts, world/navblocks.ts), and the renderer meshes it (render/tilestage.ts). It cannot express several floors, caves, tunnels, overhangs, enclosed interiors, real slopes or flight. The overhaul replaces that contract, not the game.

## Owner decisions (2026-11-22)
- D1 Direction. A three.js renderer, a mesh world (WorldModel) and Rapier physics replace the hand-written WebGL2 tile stage and the tile column collision. This reverses the earlier advice to keep both. The replay baseline is re-recorded once, at the cutover (X1a), named in that commit. Until X1a no shipped behaviour changes. *(Owner, 2026-11-25, D9: the baseline is re-recorded at X1a on the range and once more at G2b for the Hold. D8: the frozen tile game may drift or break in tile-only corners before X1a.)*
- D2 Determinism stays a hard rule: fixed 1/60 s ticks, one seeded RNG stream per system, physics inside the sim using Rapier's cross-platform deterministic build. Physics state is part of the replay hash.
- D3 Creatures stay PMD 8-direction pixel billboards in the 3D world. How they read from above or below during flight is accepted for now.
- D4 The fixed north-up camera views retire at X1a. Third person is the only view.
- D5 The Pokémon-location generator (world/locations, world/locgen) stays until X1b and is deleted with the tile stack.
- D6 T1 co-op waves, T2 3v3 hero bots and multiplayer come after the overhaul. Netcode stays out of scope (pivot Q1) until the owner reopens it; the foundation keeps per-player input and physics that can be snapshotted.
- D7 Roadmap: item 6 dropped, item 4 narrowed, F12 folded into I1a and P6 into I3, F1 to F3 closed at X1b, P1 after X1c.

The re-plan (owner, 2026-11-25, evening): D8 to D14. Where one supersedes or amends an earlier record, that record carries a dated note. F-numbers are docs/ROADMAP.md's.
- D8 The old game is frozen. With every flag off, the tile game is no longer a product requirement; it may drift or break in tile-only corners. Merges still deploy it until the cutover (no workflow change). It stays as test ground until X1b.
  - Flag-off `scripts/checksum.ts all` keeps running. A flag-off hash moved by a change the task names is re-recorded once with the reason in the commit; an unexplained move is still a stop.
  - The other flag-off gates (navwalk, stuckwatch, habplay, habstate, habaudit, hazplay, perf-sim, `range.py` on the old renderer) are no longer required. Tasks don't change tile-only code except to delete it.
  - New behaviour is judged on its own gates, not by matching the tile game. Rules that tie flag-on behaviour to the tile game's (e.g. F66's "walks down exactly the drops the tile game walks down") no longer bind later tasks. A test whose only subject is "flag-on equals tile" may be retired by the task that improves on it, named in the report, with the reason in the commit. Every other test is still never edited to pass.
  - The habitat and location generators are frozen: no `HAB_VERSION` or `LOC_VERSION` change and no work on them. The "layout would move" stop goes with them; the stop on an unexpected `gameplayHash` move of a generated map stays (WORLDGEN3D Q19).
  - With both flags on, the stuckwatch gate is "no TRAPPED". The identity comparison against the flag-off run stays as a diagnostic tool.
  - I1b's answers, given before D8, stand as recorded.
- D9 The cutover is the training range (supersedes G0 answer B of 2026-11-24).
  - X1a makes the 3D stack the game once the 3D range plays. It needs I1c, I2a, I2b, G1a and G1b, not I4. The range's liquid, breakable and timed-hazard stations are built as geometry by G1a, and the range gate lists them as inert until I4. *(Amended by D15: the pond's swimming keeps working at X1a; Q9's new liquid rules stay I4's.)*
  - X1a retires the fixed views (D4), takes Hold out of `MODES` until G2b (`TITLE_MODES` is already `[RANGE]`), records the new range replay baseline, and sets the mesh-world perf and stuck baselines.
  - X1b follows X1a directly. Tests whose subject is the Hold or habitat hazards and whose fixtures X1b deletes become named skips on G2b's or I4's gate list, each with an F-row, never silently deleted.
  - I4 and G2b then build on the 3D stack only, with no flags and no tile parity. X1c runs after G2b. River Gorge layer 1 stays G2's scope; layers 2 to 5 stay after X1c.
- D10 Engineering choices (amends CLAUDE.md "Working with the owner", the stop list).
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
- D11 Low-poly first (answers WORLDGEN3D Q23.1 for the cutover). `lowpoly` is the look that ships at the cutover; `storybook` moves to its own task after X1c (SB). I2a builds the material family and the profile registry with `lowpoly` only, so adding `storybook` later is additive. I2b, G1b and the lints target `lowpoly`.
- D12 Fixed time of day at the cutover (amends WORLDGEN3D Q23.2).
  - Every map ships one fixed time.
  - I2a reads all lighting (the sun, the two sets of six ambient colours, fog, grading, the lamp channel's strength) from one time-of-day value through keyframed per-map data, with a dev URL parameter to set it. A test pins that changing the value changes the lighting through that one path, so a cycle can be added later without architectural change.
  - The running cycle (progression, partial and complete cycles, per-map cycle settings) and the developer preview controls are a task after X1c (TD). The range's day/night cycle (WORLDGEN3D Q22(c)) waits for it.
- D13 Task splits and order (from the owner's efficiency audit).
  - G1a (world side): the IR types, the kit, `build`, `emit`, gate classes A and C, the 64-bit hash, the dressing interface, the range as authored space IR with its stations, `scripts/worldcheck.ts`, and the "Numbers that G1 measures" that need no renderer. Needs WM2, I1b, I3, CL. Stop and report if it needs any I2a piece.
  - G1b (render side): the render-side mesh builders, the kit-piece skin list, hull-proxy visuals, the range's readability lints, `range.py` with every flag on and `?render=three`. Needs G1a, I2a.
  - G2a (headless): `plan`, `embed`, the Hold template with all five route roles, gate classes B, D and E, the repairs, the curated-seed fallback. Needs G1a.
  - G2b: layer 1's liquids, timed hazards and breakables, the spawn barrier, `holdplay`, the calibrations of "Numbers that G2 measures", the Hold scenarios. Needs G2a, I4, X1b.
  - Order: lane A, a gate-runner task (GR; its own prompt) → G1a → G1b → G2a; lane B, I2a → I1c → I2b; then X1a → X1b → I4 → G2b → X1c. After X1c: storybook (SB), the time-of-day cycle (TD), then P1, T1, T2 as before.
- D14 Follow-ups F39, F77 and F49.
  - F39 waived: S2 decision 1 (WebGPURenderer + TSL, WebGL 2 fallback by its backend) stands without the lower-end-machine condition; measure one if it turns up.
  - F77 answered, widen: on generated maps the narrow clear-width rung (WORLDGEN3D Q7's table, 1.10 m) becomes 1.20 m; G1a pins it with a test that a 1.20 m neck is open to the 5-cell narrow agent at every plan offset and refused to Large. The 5-cell narrow agent stays, and G1a recomputes and lists every number derived from the rung. *(Wording from the owner's review of RP, 2026-11-25: it replaces "at least 1.20 m" and a measure-plus-margin step.)*
  - F49 closed. The blueprint is "Map and Environment Generation Blueprint" (the owner's claude.ai project "map generation", exported 2026-11-24). The claude.ai reviewer checked every quote and departure WORLDGEN3D attributes to it on 2026-11-25, and all match: §7's heightfield per terrain chunk; rule 4 (trimesh only for SDF features); milestone 12 (SDF caves); the zone-graph node set; the phantom-concealment lint; ranked maps as validated bundles; the expert layer; Zod; three style families and shading models; report 1's 150,000 trimesh triangles. WORLDGEN3D is the record. The blueprint is kept in the owner's claude.ai project, not in the repo.
- D15 The 3D range at the cutover (owner, 2026-11-25, in the review of RP; amends D9).
  - X1a ships the 3D range with its tall grass (Fire burning it) and the breakable and timed-hazard stations inert until I4. Accepted as a short gap.
  - The pond's swimming keeps working at X1a. G1a's mesh-world seam answers liquid contact from the model's liquid volumes with the tile model's rule (no bed, F25), so swimming behaves as it does today; on the physics flag, `physseam.liquidContact` forwards to the tile world now.
  - Q9's new liquid rules (wade, float, dive, depth-relative damage) stay I4's.

## Target layout
- src/core: RNG streams, detmath, small vec3 maths, utils. No dependencies.
- src/rules: every tunable and data table, including map recipes and world styles.
- src/world: procedural generation producing a WorldModel (plain data). Never imports three, Rapier, recast or src/sim.
- src/physics: the only importer of Rapier. Colliders from a WorldModel, the character controller, queries, dynamic bodies.
- src/nav: the only importer of recast. Navmesh from a WorldModel, path queries, flyer steering.
- src/sim: gameplay systems. Uses physics and nav through ctx. Never imports render, ui, audio, input, assets or three.
- src/render: three.js. Scene from the WorldModel, actors from sim state, effects from sim events. Reads sim state, never writes it.
- src/ui, audio, input, assets, mods: as today.
Folders are created when they get code.

## The WorldModel contract
One plain, serialisable record per map (typed arrays, no classes), the only map data other layers read:
- meta: source, seed, generator version.
- bounds.
- colliders: static collision (box, trimesh, later others), each with a surface material from rules/surfaces.ts and an optional destructible id.
- volumes: liquids with surface level, hazards, kill zones, triggers, the contest zone, staging areas.
- navInput: walkable geometry and off-mesh links.
- surfaces: render chunks (positions, normals, colours or UVs, indices, material id).
- markers: spawns, objectives, landmarks, body spots.
Render, physics and navigation each build their own runtime structures from it. Visible geometry and collision come from the same generator output.

## WorldModel
- `src/world/model.ts`: the types (WorldModel, colliders `box` and `trimesh`, volumes, navInput, surface chunks of at most 64 × 64 m, markers). Plain data only; it survives structuredClone.
- Contract v2 (WM2, 2026-11-25): `MODEL_VERSION = 2` in `src/world/model.ts`; the 15 material roles of WORLDGEN3D Q16.2 in `src/rules/materialroles.ts` (`MATERIAL_ROLES`, `MaterialRole`). Added beside v1: `ColliderBase.role`, `blocksSight` and `when`; volume kinds `concealment` and `barrier` (with `team`); liquid volumes' `liquid`, `levels` and `bed`; hazard volumes' `schedule` and `exposure`; marker kinds `item` (with `value`) and `station`; `OffMeshLink.needs` and `when`; `NavInput.areas` (`NAV_AREA` bits) and `routes` (the volume-routing graph); `meta.requestedSeed` and `seedReason`; `spaces`, `portals`, `features`, `breakables` and `cells` (surface cells per space). Render chunks lost `normals` and `colours` and carry `role` (or `liquid`) and an optional `blend`; their positions are welded. The names against each row of the contract table are in WORLDGEN3D "WorldModel contract changes".
- `src/world/adapter.ts`: `fromArenaMap(m)`, the tile adapter. It reproduces the column model of sim/world.ts and sim/spatial.ts: ground columns from the bounds floor (lowest surface − 1 m) to World.height, merged into boxes; low props as boxes with the foliage flag; stairs ramps as trimesh quads; wall-prop tiles to their wallTopsOf top, bare walls to the bounds top (highest surface + 8 m), both ending at a deck's underside; deck slabs; no collider on chasms or under liquids (the column model has no bed), liquid volumes from the floor to the surface; vent fields as hazard volumes; markers for the spawn, staging, contest, bodies, anchors and landmarks. Surfaces are crude on purpose: chunks split by role and welded. Since WM2 it fills the v2 fields with defaults that keep today's meaning (its header holds the role table). Deleted at X1b.
- `tests/worldmodel.test.ts`: the conformance gate. A downward probe against the colliders matches World.height, wallTopAt, the deck and the ground under it, and liquidAt at every tile centre of every map source (the range, every habitat recipe and variant at seeds 1 and 3, every location at seed 1). It also checks that output is byte-identical, that structuredClone round-trips, the v2 defaults (roles in the union, blocksSight = blocksShots, welded chunks, empty new arrays, surface triangles equal to main's before WM2), and the budgets (under 20,000 colliders and 500,000 triangles per map). The probe stays in tests/ until I1a brings the physics queries.

## World seam
Task WS (2026-11-23), hash-invariant: every sim system asks the world its questions through one 3D-native query set, `WorldQuery` (src/sim/worldquery.ts), which the tile World implements today and physics (I1a, I1b) and navigation (I3) implement next. Owner decisions from the WS grilling, Q1–Q16:
- Q1 Enforcement by the compiler, not by member names. `class World implements WorldQuery`; `SimContext.world` stays typed `World`, so tests, scripts and render compile unchanged (render's reads are I2a's to replace). In src/sim only world.ts, spatial.ts, run.ts (it constructs the World) and types.ts (`SimContext.world`) name the World type; every function that takes a world takes `WorldQuery` (locomotion's nine). Systems read `ctx.world` only through `worldOf(ctx)` in worldquery.ts. Tile-only state is read as `W.tiles.*` (`TileExt`). `tests/worldseam.test.ts` holds both rules (Q15).
- Q2 Every seam question takes y. Today's column calls (no y) pass the explicit `GROUND` sentinel (77 call sites), which the tile World reads as the omitted argument, so I1 can find each and give it a real y. Where the tile World ignores y (`nearestWalkableAt`, `place`) the seam's doc comment says so.
- Q3 Two support reads: `surfaceAt` (World.height with a reference height; a chasm's floor counts) and `supportAt` (World.support, −∞ over open air). They differ only on void tiles.
- Q4 (x, y, z) argument order with fresh names wherever World's own name or order differs (tests call World's methods by their names). Returned points stay (x, z); callers read y with `surfaceAt`.
- Q5 One `navDir(goal, x, y, z, out, wide, diag, tall)` for the four steering methods, the agent size positional (no allocation per call). Narrow agents map today's true / false to 1 / 0; callers compare with `=== 1`. `navReached` is wide-only. `place` is positional too (nearestFit has no diag).
- Q6 `navDist('player', …)` is in the seam (backed by flowDist), unused by the sim until I3.
- Q7 Markers in the seam: `bound`, `killY`, `spawn`, `anchors`. `hab` (contest and stagings in tile coordinates) stays a tile extension until G2 defines 3D Hold markers against the WorldModel's markers.
- Q8 R1b wall tops in the seam: `topBelow(x, y, z, r)` (y is topUnder's `from`) and `insideRock(x, y, z, over)`; `wallTopAt` has no sim caller and stays off.
- Q9 `TileExt` keeps the World's own names, transcribed raw (no new helpers such as an `onDeck`): the grid frame (`w`, `h`, `half`, `map`, `tile`, `node`), `biome`, `habitatAt`, the World copies of `los` and `hazards`, the column reads (`solid`, `wallAt`, `waterAt`, `shore`), `over`, `isVoid`, the cells group (`cells`, `burnCost`, `burningAt`, `refreshNav`, `refreshFlow`), the W4 group (`propField`, `setBlock`, `reachableCount`), the tide group (`tide`, `tideHigh`, `setTide`, `tidalAt`), `hab`, `hazard`, `hazardAt`. Redesigned in I4 or deleted at X1b.
- Q10 Rays: `raycast`, `segmentClear`, `solidAt` (no sim caller yet; kept for I1a) and `sight` are seam methods. spatial.ts keeps its `raycastWorld(W, …)`, `segmentClear(W, …)`, `solidAt(W, …)` exports for tests and scripts.
- Q11 The before and after call inventory is in the WS commit message and report; this section keeps the summary.
- Q12 The names (every argument passed through in the order shown; nothing computed):

| Seam member | Tile World |
|---|---|
| `bound`, `killY`, `spawn`, `anchors` | the same fields |
| `surfaceAt(x, y, z)` / `supportAt(x, y, z)` | `height(x, z, y)` / `support(x, z, y)` |
| `liquidContact(x, y, z, contact)` | `liquidAt(x, z, y, contact)` |
| `headroomOver(x, y, z, r)` | `headroomAt(x, z, y, r)` |
| `solidFor(x, y, z, step, tall?, over?)` / `blockedFor(…)` | `collides(x, z, y, …)` / `blocks(x, z, y, …)` |
| `fitsAt(x, y, z, r, step?, tall?, over?)` | `fits(x, z, y, r, step, tall, over)` |
| `moveFootprint(x, y, z, dx, dz, step, r, out, stop?, tall?, over?)` | `moveBody(x, z, dx, dz, y, step, r, out, stop, tall, over)` |
| `topBelow(x, y, z, r)` / `insideRock(x, y, z, over?)` | `topUnder(x, z, r, y)` / `inRock(x, z, y, over)` |
| `raycast(…)`, `segmentClear(…)`, `solidAt(…)` | spatial.ts `raycastWorld(this, …)`, `segmentClear(this, …)`, `solidAt(this, …)` |
| `sight(x0, y0, z0, x1, y1, z1)` | the same method |
| `walkableAt(x, y, z)` | `walkable(x, z, y)` |
| `nearestWalkableAt(x, y, z)` | `nearestWalkable(x, z)` (y ignored) |
| `place(x, y, z, r, wide, reach?, tall?)` | `nearestFit(x, z, r, wide, reach, tall)` (y ignored) |
| `setNavGoal(x, y, z)` | `updateFlow(x, z, y)` |
| `navDir(goal, x, y, z, out, wide?, diag?, tall?)` | player: `wide ? wideDir(x, z, out, y, diag, tall) : flowDir(x, z, out, y) ? 1 : 0`; contest: the same with `wideGoalDir` / `goalDir` |
| `navReached('player', x, y, z, diag?, tall?)` | `wideReached(x, z, diag, y, tall)` |
| `navDist('player', x, y, z)` | `flowDist(x, z, y)` |
| `tiles` | `this`, typed `TileExt` |

- Q13 The accessor is `worldOf(ctx)`, structural (`{ readonly world: WorldQuery }`, so stub contexts pass). It is hoisted once per function that reads the world, at entry or before the first loop, never inside a loop body; where a loop reads tile extensions repeatedly, `T = W.tiles` (or `WT` where the file already has a `T`) is hoisted beside it. In run.ts enterMap it follows the `ctx.world = new World(…)` assignment.
- Q14 **Two I1a swap points.** `worldOf` for the systems, and in spatial.ts `geoOf` + `castWorld`, the world half of the actor sweeps and overlaps (`sweepCore`, `overlap`), which stays on F-scratch values because routing it through `W.raycast` would box doubles on every shot (scripts/spatialbench.ts counts that).
- Q15 `tests/worldseam.test.ts`, two AST rules over src/sim: no import naming `World` from src/sim/world, matched by resolved path (named, renamed, namespace, re-export, `import()` type, dynamic `import()`), allowed in world.ts, spatial.ts, run.ts, types.ts; and no `.world` read (`ctx.world`, `ctx['world']`, `{ world }` destructuring; `rng` and `rules` receivers excepted) outside world.ts, spatial.ts and worldquery.ts, plus exactly one `ctx.world = …` assignment in run.ts. hazards.ts's `SHORES` WeakMap is keyed by `W.tiles`, the same object as before.
- Q16 The wrappers sit in one "World seam (WS)" block at the end of sim/world.ts; no existing World method changed.

Inventory, src/sim outside world.ts and spatial.ts: before WS, 342 accesses to 54 World members, 26 to 7 ArenaMap fields and 4 spatial.ts calls taking the World (segmentClear ×3, raycastWorld ×1), through 106 `.world` reads in 60 functions. After: 0 World accesses; 157 to 22 WorldQuery members, 189 to 31 TileExt members and 26 to the same ArenaMap fields (through `tiles.map`), with 65 `.tiles` hops, through 62 `worldOf(ctx)` calls. Tile extensions are 189 of 372 world reads: what I4 and X1b have left to redesign.

## Physics (I1a)
Task I1a (2026-11-25): Rapier answers the world half of the sim's queries behind `rules.physics.engine = 'rapier'` (default `'tiles'`; the page's `?physics=rapier`). With the flag on, physics answers the spatial aim (the camera trace, the muzzle and its obstruction sweep), line of sight (the seam's `sight` and `segmentClear`, overlaps' sight lines), the spatial player shots (`traj` 1, effects.ts `flyLinear`) and beams. Every other shot still stops on the tile model: enemy shots (`PK.hostile`) and the planar player shots (`traj` 0: the bot and the fixed views, lob, orbit, boomerang) end through `T.wallAt` and `W.surfaceAt` in effects.ts (ROADMAP F65, I1c). Since I1b the partner's body moves through Rapier's character controller ("Movement (I1b)" below); enemies, bodies, the other movement members and navigation stay on the tile World (I1c, I3). Loading, the collider representation and the free() discipline are docs/spikes/S1-physics.md's, as the owner accepted them (O1–O9).

Files:
- `src/physics/rapier.ts`: the namespace holder, `initRapier` (compile, check, instantiate against the glue) and `checkGlue`, which names the glue internal that moved when a Rapier upgrade breaks the loader (F38).
- `src/physics/node.ts`: the Node loader (`module.registerHooks`, Node ≥ 22.15, package.json `engines`), `initPhysicsNode()`, once per process.
- `src/physics/web.ts` and `scripts/lib/rapierwasm.mjs`: the page loader and the esbuild plugin; the wasm is the fetched side file `dist/physics/rapier3d-deterministic.<hash>.wasm` (3,105,893 B), staged by the deploy workflow. `src/main.ts` fetches and instantiates it once at boot, only with `?physics=rapier`.
- `src/physics/world.ts`: `PhysicsWorld`, one Rapier World per loaded map, built from a WorldModel's static colliders (boxes and trimeshes), its liquid volumes (query-only sensors) and four edge slabs around its bounds, plus query-only pieces the caller adds. Entry points: `cast` (a ray, or an upright cylinder swept along it) and `sweep`, the shapes the generator's `Probe` wraps (WORLDGEN3D Q12.2); `clear` (a segment); `solidAt`; `overlapCylinder`; `supportBelow`; `liquidAt`; `snapshot` / `restore`; `dispose`. Actors are not Rapier bodies (O2).
- `src/sim/physseam.ts`: the bridge. `PhysicsBridge` (`SimContext.physics`, and held by the run's World since I1b) builds the physics world from the tile adapter's model of the World's live map, adds the column model's pieces the adapter leaves out, and rebuilds when `World.geoGen` moves (`setBlock`, `setTide`, `refreshNav`). The World's `raycast`, `segmentClear`, `solidAt` and `sight` ask it on the flag; every other member is the tile World's own. `PhysicsSeam`, the forwarding WorldQuery `worldOf` returned at I1a, remains as a view for `tests/physics-parity.test.ts` (ROADMAP F64).
- Tests: `tests/setup/physics.ts` (the shared setup: Rapier once per test process), `tests/physics-load.test.ts`, `tests/physics.test.ts` (disposal, flat wasm memory over 50 runs, the snapshot round trip), `tests/physics-parity.test.ts` (both implementations on the spatial scenes and adapter maps, with the documented differences D1–D6 in its header).

Rules:
- **The swap points** are the two WS named: the world `worldOf(ctx)` returns, and `sim/spatial.ts` asking `ctx.physics.castWorld` for a sweep's world contact and an overlap's sight lines. At I1a `worldOf` returned the physics seam; since I1b it returns the tile World, which holds the bridge and branches in its four ray members, so every call site sees one receiver type (ROADMAP F64). The actor broad phase is unchanged.
- **Query modes.** A collider's collision-group membership is its world kind (SK bit) and its filter the query modes it stops; a query's membership is its mode and its filter the kind mask, so Rapier's two-sided group test decides "kind in the mask and solid in this mode" with no callback. Eight modes: what stops the query (`STOPS.shots` or `STOPS.sight`, kept apart though the adapter sets `blocksSight = blocksShots`; WORLDGEN3D Q15.4 splits them) × `QF.foliage` × `QF.tops`. Shots stop sweeps, `raycast` and `solidAt`; sight stops `segmentClear`, `sight` and the overlaps' sight lines. Each model collider's `blocksSight` (WM2) is read directly; the tile adapter writes it equal to `blocksShots`.
- **The tile extras** (query-only, deleted at X1b): the SK kind of each adapter collider (WM2's `role` is a material role, not a world kind), a wall prop's column above its top for queries without `QF.tops`, a bare wall's column above the bounds top, the ground under a foliage wall for queries with `QF.foliage`, and the stairs wedge (F28). Ice is ground at the ice; chasms follow `World.isVoid`.
- **F12** is closed on the physics path: the seam's `sight` is the exact segment, so it never sees through a wall corner. The tile World's sampled `sight` and its `todo` test stay until X1b.
- **Disposal:** `disposeRun(ctx)` (sim/run.ts) and every map change free the run's physics world; `main.ts` disposes a run it drops. A restored snapshot is a new PhysicsWorld.
- **Replay:** with the flag off every scenario is as recorded. `range-charmander-rapier` and `gorge-hold-rapier` run the same tracks on the flag; they were recorded at I1a with the same hashes as their tile scenarios, because every physics answer on those tracks matched the tile model's, and re-recorded at I1b, when the partner moved onto the controller, once more in I1b's fix round, when the controller took the tile model's support rule (ROADMAP F66), and once more in the second fix round, for the roll (F69) and exact moves, heights and landings (F70). Physics state is not in the replay hash: the world is static, and the controller leaves nothing in it that a later tick reads (ROADMAP F62).

### Movement (I1b)
Task I1b (2026-11-25): with `rules.physics.engine = 'rapier'` the partner's body (the hero) moves through Rapier's kinematic character controller. The rules of motion stay the sim's (`sim/locomotion.ts`: intent, the three integrators, gravity, jumps, coyote time, air presses, glide, hover, swim); the flag picks only the resolver that turns a tick's translation into where the body ends and whether it stands on something. The contract, the roll and the differences from the tile model are docs/LOCOMOTION.md "Resolvers".
- `src/physics/controller.ts`: `CharacterKit`, one per physics world: Rapier's controller (autostep and snap off, slide on, climb and slide at 46°), one capsule collider per footprint and height (`capsuleOf`: S1 §8's capsules, the 1 mm head margin, Tiny a ball), exact unless cut (a move Rapier reports no collision on is the desired 64-bit translation; heights and fits from the world model's f64 boxes; F70), our roll (a rise climbed at the body's own speed, the round bottom rolling up the edge, lifted by the least height that fits; S1 O4, F34, F69), the tile model's support rule at the axis (walk down below 0.3583 m, fall deeper, every class; F66) and its landing (a ledge's edge rolled off, not landed on; on the tile tick), the rest on the world model's height. `PhysicsWorld.moveCharacter` and `characterClear`. Capsules are their body's own height on every map, required (F72).
- `src/physics/world.ts`: `supportBelow` returns a box's f64 top (F70). A ninth collision mode, `MODE_MOVE`, is what stops a body: every model collider, the liquids (a floor at their surface, F25), the map edge, and the extras the bridge marks (a wall prop's column above its top, a bare wall's column, the stair wedges).
- `src/sim/physseam.ts`: `PhysicsMover`, the World's `mover`; `bodyClear` for the reachability harness.
- `src/sim/locomotion.ts`: `resolveOnController` beside the tile resolver; `pushFootprint` and `flushShoves` for the crowd's and the resting bodies' shoves of the partner (`enemies.ts`, `bodies.ts`; on physics summed over the system's loop and resolved in one move: one move per shove cost 2 ms a tick under a crowd of 500).
- Gates: `tests/stepping.test.ts` (steps, drops against the tile model tick for tick, liquids, collision groups, the roll's own-travel and grounded bounds and flight timing, exact free moves and landings); the tile locomotion tests on the flag (`tests/setup/physics-on.ts`, 27 of 27); `scripts/navwalk.ts all 5 --physics rapier`, `scripts/stuckwatch.ts all 3 --physics rapier`, `scripts/jumptiming.ts --physics rapier`.
- Not here: enemies and bodies (I1c, O2), moving platforms (none exists; O6's horizontal carry lands with the first kinematic body, ROADMAP F67), the spawn barrier (G2, WORLDGEN3D Q8h), new traversal kinds (F46), WORLDGEN3D Q9's liquid modes (I4).

## Navigation (I3)
Task I3 (2026-11-25): recast-navigation answers the seam's navigation behind `rules.nav.engine = 'navmesh'` (default `'flow'`; the page's `?nav=navmesh`). With the flag on, `navDir`, `navReached` and `navDist` come from navmesh paths (corridor following), and an enemy in a liquid it is not safe in heads for the nearest reached navmesh (ROADMAP F2). Enemies still move on the tile World (I1c moves them): only their steering changes. `place`, `walkableAt` and `nearestWalkableAt` stay on the tile World (F83). The flag is independent of `rules.physics.engine`.

Files:
- `src/nav/recast.ts`: the namespace holder, `initRecast` and `checkGlue`. recast-navigation 0.44.0, pinned exactly with its `@recast-navigation/core`, `/wasm` and `/generators` 0.44.0. The wasm package's `./wasm` entry is the Emscripten glue beside a separate `recast-navigation.wasm.wasm` (340,097 B); the loaders compile the module themselves and hand it to the glue through Emscripten's `instantiateWasm` hook, so the glue never locates or fetches anything. The default `wasm-compat` entry (the wasm inlined as 1,013,548 B of base64) never ships.
- `src/nav/node.ts` (`initNavNode()`, once per process) and `src/nav/web.ts` with `scripts/lib/navwasm.mjs`: the Node and page loaders. The wasm is the fetched side file `dist/nav/recast-navigation.<hash>.wasm`, staged by the deploy workflow; the plugin also stubs core's fallback import of the compat entry. `src/main.ts` fetches and instantiates it once at boot, only with `?nav=navmesh`.
- `src/nav/build.ts`: the Recast build, our own tiled pipeline (`NavSoup`, `NavTiles`). It reads a WorldModel's `navInput` (the walkable faces, each with its `NAV_AREA` byte), its colliders and its hazard volumes, never `spaces`.
- `src/nav/graph.ts`: `NavGraph`, one group's Detour navmesh read back into JS arrays (polygons, links, portals), and the queries: `locate`, `field` (Dijkstra from the goal's polygon), `corner` (Detour's funnel over the corridor), `straight`, `nearest`.
- `src/nav/routes.ts`: `VolumeRoutes`, the reader of `navInput.routes` (the volume-routing graph of WORLDGEN3D Q8e and Q9 "Data"): routes by medium, clear radius, capabilities and state. The adapter writes an empty graph.
- `src/nav/world.ts`: `NavWorld`, one map's navigation: the groups' navmeshes and graphs, the goal fields, per-tile rebuilds, obstacles.
- `src/sim/navseam.ts`: the bridge. `NavBridge` (`SimContext.nav`) builds the NavWorld from the tile adapter's model of the World's live map (`liveMap`, shared with the physics bridge) at map entry and updates it when `World.geoGen` moves. `NavSeam` is the WorldQuery `worldOf` returns on the flag: its navigation members on the navmesh, every other member forwarded.
- Tests: `tests/setup/nav.ts` (recast once per test process), `tests/nav-load.test.ts`, `tests/nav.test.ts` (hand-made fixtures, `tests/fixtures/navmodels.ts`), `tests/navseam.test.ts`.
- Tools: `scripts/navbench.ts` (build timing per map and group), `scripts/navgiant.ts` (what a giant at the 3.57 m cap would lose), `scripts/navhash.ts` (the navigation hash; `.github/workflows/nav-determinism.yml` checks it on Linux against `tests/fixtures/navhash.json`, recorded on the Mac: identical on Linux x64, Node 22 and 24, run `45637263959`); `--nav navmesh` on `navwalk`, `stuckwatch` and `perf-sim`.

Rules (`rules.nav`, every Recast number an integer cell count written in rules, never computed):
- **Cells** (S1 §8, O9 as amended in the I3 review): cs 0.1 m, **ch 0.02 m**, walkableSlopeAngle 45.5°. The sim's 0.6 m step (`rules.player.stepHeight`) and the bodies' heights are the authority; the vertical counts are derived from them and written as integers: step 30 cells, agent heights 48 / 85 / 139, the giant report 179. **Recast's build climb is 29**, one cell under the step: Recast rounds span tops up to whole cells, so a rise joins by where its two tops fall in their cells as well as by its size, and a count of n joins every rise up to n cells and some up to n + 1. At 0.02 / 29 no rise over 0.6 m joins and every rise up to 0.58 m does, at every alignment, for every group (`tests/nav.test.ts` "the step boundary"); one in (0.58, 0.6] m may be cut and routed round, the known approximation (on the adapter maps 8 of the 223 valid rises in (0.5, 0.6] m, each about 2 m round; a rise of exactly 0.600 m is cut at every alignment and none exists on them). Census over the 28 adapter sources (`scripts/navrises.ts --group all`), valid rises joined, 5 cm / 11 against 2 cm / 29: narrow 176 → 211, large 85 → 105, xl 14 → 18; rises over 0.6 m joined: 0 and 0 of 621 (climb 12 at 5 cm would join 31). **Limits**: Recast's compact span stores clearance in 8 bits (`rcCompactSpan::h`, clamped to 255 in `rcBuildCompactHeightfield`, recastnavigation `599fd0f`, the commit 0.44.0 builds), so an agent height over 255 cells never connects: at ch 0.01 Extra Large would be 278 cells and builds nothing (measured), so 2 cm is the finest cell height with every group; span heights are 13 bits (8191 cells, 163.8 m of relief at 0.02). TileCache, which we do not use, stores a layer's heights as bytes over its lowest span: a layer spans under 255 cells (5.1 m at 0.02, 12.75 m at 0.05), and taller relief splits into more layers.
- **Width groups** (WORLDGEN3D Q7): narrow (Tiny, Small, Medium), large, xl. Each agent's radius is its group's widest footprint and its height the tallest body today's gates carry for it, rounded up to cells:

  | group | classes | radius (cells) | height (cells) |
  |---|---|---|---|
  | narrow | Tiny, Small, Medium | **4 on adapter maps**, 5 on generated maps (0.5 m: Medium 0.46) | 48 (0.96 m: Totodile 0.953) |
  | large | Large | 7 (0.7 m: Large 0.66) | 85 (1.70 m: Heracross 1.689) |
  | xl | Extra Large | 9 (0.9 m: Extra Large 0.88) | 139 (2.78 m: Onix 2.777) |

  A test checks overhead clearance at 10 alignments: each group passes under a deck 5 cm higher than its tallest gated body and not under one 5 cm lower.

  **The adapter maps' narrow radius is the owner's F77 decision (2026-11-25)**: 4 cells (`rules.nav.adapterRadius.narrow`; `isAdapterModel` in `src/world/adapter.ts` reads the model's `meta.source`), so the tile maps' 1.0 m one-tile necks stay open as the tile sim has them; at 5 they erode shut. Medium (0.46 m) then overlaps a neck's walls, and a drop's edge, by 6 cm, which I1c re-checks (ROADMAP F77). A generated map keeps 5 (`groups.narrow`); a neck stays open to it at every cell offset from 1.18 m (fixture sweep), more than WORLDGEN3D's 1.10 m narrow rung, so G1 sizes necks for it (F77). *(D14, 2026-11-25: the rung becomes 1.20 m and the 5-cell agent stays; G1a pins it with a test at every plan offset.)* An agent is in a group by `navDir`'s arguments: `wide ? (diag ? large : xl) : narrow`; `tall` is not read.
- **Tiles**: 128 cells (12.8 m; F56). A tile builds every group in about 2.6 ms; River Gorge seed 1's three navmeshes take about 282 ms median with the adapter (p95 306; the 2 cm cell height costs nothing measurable, wasm heap 64 MB either way; ROADMAP F76). The rasterisation (63 ms on River Gorge) is shared and each group's own stages (filter, compact, erode, regions, contours, Detour) take about 68 ms, so one group alone is about 135 ms and three about 285. The build runs synchronously on the main thread inside the first `setNavGoal` after a map entry.

The build (`NavTiles.buildTile`, once per tile for every group):
- **Walkable and solid.** navInput's faces are rasterised walkable (Recast's slope test, then the area from their byte). The colliders are rasterised with the null area, so a deck's underside limits the headroom of the ground under it and a cliff's foot reads as a wall: a box standing on the model's floor by its four sides only (its top is a navInput face or a wall's top, its bottom buried, and Recast never fills a solid), a box above the floor (a deck slab, a low prop) by all six faces.
- **Inset.** Every rasterised triangle and box is moved 0.01 m in from its plan outline. Tile geometry lies exactly on cell boundaries and Recast's float `1 / cs` floors an integer boundary one cell low; a walkable face leaking into a wall's column would make the wall's top walkable (Recast keeps the higher area of two spans whose tops are within the climb).
- **One rasterisation per tile**, the groups filtered on it in ascending agent height. The ledge filter is not run: its steep-slope rule (reachable neighbours whose floors differ by more than the climb) cleared the corner cells of every diagonal terraced slope on the tile maps, cutting ramps the sim walks (Viridian Forest, F80). Drops need no filter: a cell does not connect across one, and erosion keeps the agent its radius from it. Measured on a fixture (a 1 m drop): without the filter the navmesh's edge is the agent's radius from the drop (0.40 / 0.70 / 0.90 m), with it one cell more; so the filter being off moves paths 0.1 m nearer drop edges, and no group's agent overhangs one (Medium on the 4-cell narrow agent does, by 6 cm, as at walls).
- **Areas**: `AREA.ground`, `AREA.soft` (navInput's `NAV_AREA.softSoil`, WORLDGEN3D Q10.9), `AREA.hazard` (hazard volumes, the vent fields), `AREA.link`.
- **Off-mesh links** from `navInput.links` (none on adapter maps yet), each in its start's tile, with its index as user id; a field takes a link only for agents holding every capability in its `needs`; one-way links are one way.
- **No detail mesh**: a polygon's floor is read from its own vertices (F78). `rcBuildPolyMeshDetail` (`R.buildPolyMeshDetail(ctx, polyMesh, compactHeightfield, sampleDist, sampleMaxError, detailMesh)`) fails at sampleDist 0 with `RuntimeError: memory access out of bounds` inside the wasm (also on the range); at 0.6 m / 0.05 m (the generators' defaults) it builds and costs 10–25 % more per map (River Gorge tiles 267 → 311 ms). Polygon floor against the tile surface over the 28 adapter sources (`scripts/navheight.ts`, every walkable surface on a 0.25 m lattice): narrow p50 0.050 m, p99 0.338, max 1.567 (Viridian Forest seed 1, a terrace polygon); with the detail mesh, read through Detour's own query, p99 0.144, max 0.749. `NavConfig.detail` is a measurement switch, off in the game.

Queries (`src/nav/graph.ts`; + − × ÷ and `Math.sqrt` only, ties by polygon index, no clock or RNG):
- **locate**: of the polygons whose plan contains the point, the floor nearest the feet within `rules.nav.layer` (2 m; the lowest with no reference height, the tile World's ground layer); else the nearest within `snap` (2 m). A polygon spanning flat ground and a ramp reads up to the ramp's rise off on the flat part, which a cut at feet plus a step mistook for no polygon (Spear Sanctuary seed 3); 2 m stays under the 2.4–2.9 m gap under a deck (a test: a point on the floor under a deck locates to the floor's polygon). The same tolerance lets a body in a one-tile pit with no polygon of its own snap to the lip 1.4 m above it (F85).
- **field**: Dijkstra from the goal's polygon over the edges into each polygon, a step costing the distance between consecutive portal midpoints (Detour's path cost), plus an area price on entering a polygon. A goal's field is recomputed when the goal's polygon or the navmesh changes; the goal point moves freely within its polygon. The player goal has one field per group; the contest goal prices `AREA.hazard` at `rules.nav.hazardCost` (4096 m), so no route crosses a vent field that need not, and a walker inside one walks out the cheapest way (the tile `goalDir`'s rule).
- **Corridor following** (`corner`): the corridor is the field's next polygons from the agent's (up to 32), its portals string-pulled from the agent (Detour's `findStraightPath` funnel); the agent heads for the first corner.
- **The seam's answers**: `navDir` 1 with the direction to the corner; 0 on the goal's polygon (straight is clear); no route: 0 for a narrow agent, −1 (hold) for a wide one, as the tile World. `navReached`: on a polygon of the agent's group the player's field reaches (within 1 m). `navDist`: the narrow group's route length to the player (m).
- **F2** (`NavBridge.shoreFor`): an enemy entering a liquid it is not safe in heads for the nearest point within `rules.nav.shoreReach` (16 m) of its group's navmesh that the player's field reaches, in place of the tile World's shore search. **The bound**: `NavGraph.nearest` reads at most (2 ⌈16 / 2⌉ + 1)² = 289 locate buckets (2 m squares) and the polygons listed in them; the tile shore read up to 4 passes over 33 × 33 tiles with a flood of up to 48 tiles per candidate.

Changes and obstacles (WORLDGEN3D Q20.2(b), Q21.7(b)):
- **Geometry changes** (`NavWorld.replace`): the bridge diffs the live map against the one the navmesh was built from and rebuilds only the tiles whose build reads a changed map tile (its square plus the widest group's border). A rebuilt tile equals the same tile of a fresh build (tests). One prop removed on River Gorge rebuilds 1–2 tiles in about 31 ms, most of it the adapter (as F57).
- **Temporary objects** (`addObstacle` / `removeObstacle`, then `update`): TileCache-style. recast-navigation 0.44.0's `TileCache` (both `@recast-navigation/core`'s class and the raw WebIDL `Module.TileCache`) binds `addTile`, `buildNavMeshTile`, `buildNavMeshTilesAt`, `update` and the obstacle calls but not `dtTileCache::removeTile` or `getTilesAt`, so a tile's compressed layers cannot be replaced after a geometry change; the obstacles are our own: each marks its cells null before erosion in the tiles it touches (agents keep their radius from it), and only those tiles are rebuilt (`tests/nav.test.ts` "obstacles rebuild exactly the tiles their bounds touch": the tile lists, every other Detour tile ref unchanged, the result equal to a full build). Nothing in the sim adds one yet; `scripts/navwalk.ts` adds the resting bodies for the trainer's route (F82).

Ownership: `disposeRun(ctx)` and every map change free the run's navmeshes; `main.ts` disposes a run it drops. wasm memory stays flat over 40 builds (`tests/nav.test.ts`).

Replay: with the flag off every scenario is as recorded. `gorge-hold-navmesh` runs the Hold track on the flag, recorded at I3 and re-recorded in its review for the 4-cell narrow agent (F77) and the 2 cm cells (F79); `tests/navseam.test.ts` "gorge-hold-navmesh steers by the navmesh" asserts the run carried the bridge, navDir answered with a direction over 500 times and turned more than 30° off the straight line over 50 times, one build, and the navmeshes freed at the end: 5,698 directions, 4,258 of them corridor corners.

Cost: perf-sim 500 on the flag, min of 3, p95 0.725 / p99 0.862 ms against 0.673 / 0.927 off (2 cm cells; 0.716 / 0.859 at I3); navigation 0.118 ms a tick (the goal fields cached per goal point; a polygon's plan bounds reject before the convex test and the snap search).

## Division of responsibilities
- Gameplay locomotion (sim/locomotion.ts, rules/traversal.ts): intent to desired velocity per mode (walk, jump, coyote time, air jumps, glide, hover, swim, fly, climb), gravity, speeds.
- Rapier character controller: resolves that translation against colliders (slide, autostep, snap to ground, slope limits, platforms). It applies no gravity and no jumping.
- Rapier rigid bodies: throwables, debris, destructible pieces, moving platforms.
- Rapier queries: aim rays, line of sight, shot sweeps, overlaps, the camera lens (render reads them only).
- Navigation: navmesh paths for ground enemies and bots; flyers steer in the volume with queries.

## Migration rules
- Flags, all default off until X1a: rules.physics.engine ('tiles' | 'rapier'), rules.nav.engine ('flow' | 'navmesh'), rules.world.source ('tiles' | 'mesh'), and the renderer by ?render=three and a Settings entry. X1a, the range cutover (D9), turns them on; X1b deletes them and their off paths.
- Tile parity is not required (D8, 2026-11-25). With every flag off the tile game is frozen test ground until X1b, not a product requirement. Flag-off `scripts/checksum.ts all` keeps running: a flag-off hash moved by a change the task names is re-recorded once, with the reason in the commit, and an unexplained move is still a stop. The other flag-off gates (navwalk, stuckwatch, habplay, habstate, habaudit, hazplay, perf-sim, range.py on the old renderer) are no longer required, and tasks change tile-only code only to delete it. Before D8 this rule read: with every flag off, every existing replay scenario prints "as recorded".
- New behaviour is judged on its own gates, not by matching the tile game (D8). A rule that ties flag-on behaviour to the tile game's no longer binds later tasks, and a test whose only subject is "flag-on equals tile" may be retired by the task that improves on it, named in the report, with the reason in the commit. With both flags on the stuckwatch gate is "no TRAPPED"; the identity comparison against the flag-off run stays as a diagnostic.
- With a flag on, new scenarios are recorded under names that say which flags they use.
- The tile adapter (world/adapter.ts, fromArenaMap) expresses tile maps as a WorldModel so physics, renderer and navigation can be built and compared on maps that already pass the playability gates. It is temporary and is deleted at X1b.
- Deleted at X1b: world/tiles.ts, arenas.ts, builder.ts, navblocks.ts, adapter.ts, habitat/, locgen/, locations/; sim/world.ts, spatial.ts, cells.ts, props.ts and the tile parts of hazards.ts; the tile stage in render/ and the painters in overworld/; the tile gates in scripts/ and tests/ whose behaviour has a mesh-world equivalent by then; the flags and their off paths. X1b follows X1a directly (D9), before I4 and G2b: tests whose subject is the Hold or habitat hazards and whose fixtures X1b deletes become named skips on G2b's or I4's gate list, each with an F-row, never silently deleted.
- Async WASM (Rapier, recast) is initialised once at boot and once in a shared test setup; createRun stays synchronous.

## Tasks
Order since the re-plan (D13): the done tasks; then lane A, GR → G1a → G1b → G2a, beside lane B, I2a → I1c → I2b (G1b also needs I2a); then X1a → X1b → I4 → G2b → X1c; after X1c, SB and TD, then P1, T1 and T2. Where a section above says G1 or G2, it reads G1a or G1b, G2a or G2b, by the scopes in D13. Status and notes: docs/ROADMAP.md.

| ID | Task |
|---|---|
| C0 | Record this plan |
| C1 | Cleanup of obsolete code (overworld game, original creatures, classic generator, survivor chests, dead exports, historical docs) |
| WM | WorldModel types and the tile adapter |
| C2 | Layering fix and the import guard test |
| S1 | Rapier spike, record in docs/spikes/S1-physics.md |
| S2 | three.js spike, record in docs/spikes/S2-renderer.md |
| WS | Sim world seam (hash-invariant refactor) |
| G0 | 3D generator design, docs/WORLDGEN3D.md |
| WM2 | WorldModel contract v2 (docs/WORLDGEN3D.md "WorldModel contract changes"); before I2a, I3 and G1 |
| I1a | Physics world and queries |
| I1b | Character movement |
| I3 | Navigation |
| CL | Camera law (docs/WORLDGEN3D.md Q15g); before G2 and I2b |
| RP | Record the owner's re-plan of 2026-11-25 (D8 to D15) |
| GR | The gate runner (its own prompt); before G1a |
| G1a | Generator core and the 3D range: world side (needs WM2, I1b, I3, CL) |
| G1b | The 3D range: render side (needs G1a, I2a) |
| G2a | The first 3D Hold map: headless (needs G1a) |
| I2a | three.js scene (`lowpoly` only, one fixed time of day per map) |
| I1c | Enemies, bodies and bots on physics and navigation |
| I2b | Actors, effects and camera |
| X1a | Cutover: flags on, fixed views retired, new replay baseline; the cutover is the 3D range (needs I1c, I2a, I2b, G1a, G1b) |
| X1b | Delete the tile stack; directly after X1a |
| I4 | Hazards, surface states and destructibles; on the 3D stack only |
| G2b | The first 3D Hold map: hazards and the Hold (needs G2a, I4, X1b) |
| X1c | Docs and instructions; after G2b |
| SB | The `storybook` profile; after X1c |
| TD | The time-of-day cycle; after X1c |
