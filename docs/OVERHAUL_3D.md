# The 3D overhaul

The plan for replacing the tile world with a fully 3D one. Owner decisions 2026-11-22. Task order and status: docs/ROADMAP.md.

## Why
Every map today is an ArenaMap (src/world/tiles.ts): a 1 m tile grid with one height per tile, one optional deck, wall columns and stair ramps. Generators produce it, the sim collides and navigates on it (sim/world.ts, sim/spatial.ts, world/navblocks.ts), and the renderer meshes it (render/tilestage.ts). It cannot express several floors, caves, tunnels, overhangs, enclosed interiors, real slopes or flight. The overhaul replaces that contract, not the game.

## Owner decisions (2026-11-22)
- D1 Direction. A three.js renderer, a mesh world (WorldModel) and Rapier physics replace the hand-written WebGL2 tile stage and the tile column collision. This reverses the earlier advice to keep both. The replay baseline is re-recorded once, at the cutover (X1a), named in that commit. Until X1a no shipped behaviour changes.
- D2 Determinism stays a hard rule: fixed 1/60 s ticks, one seeded RNG stream per system, physics inside the sim using Rapier's cross-platform deterministic build. Physics state is part of the replay hash.
- D3 Creatures stay PMD 8-direction pixel billboards in the 3D world. How they read from above or below during flight is accepted for now.
- D4 The fixed north-up camera views retire at X1a. Third person is the only view.
- D5 The Pokémon-location generator (world/locations, world/locgen) stays until X1b and is deleted with the tile stack.
- D6 T1 co-op waves, T2 3v3 hero bots and multiplayer come after the overhaul. Netcode stays out of scope (pivot Q1) until the owner reopens it; the foundation keeps per-player input and physics that can be snapshotted.
- D7 Roadmap: item 6 dropped, item 4 narrowed, F12 folded into I1a and P6 into I3, F1 to F3 closed at X1b, P1 after X1c.

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
- `src/world/adapter.ts`: `fromArenaMap(m)`, the tile adapter. It reproduces the column model of sim/world.ts and sim/spatial.ts: ground columns from the bounds floor (lowest surface − 1 m) to World.height, merged into boxes; low props as boxes with the foliage flag; stairs ramps as trimesh quads; wall-prop tiles to their wallTopsOf top, bare walls to the bounds top (highest surface + 8 m), both ending at a deck's underside; deck slabs; no collider on chasms or under liquids (the column model has no bed), liquid volumes from the floor to the surface; vent fields as hazard volumes; markers for the spawn, staging, contest, bodies, anchors and landmarks. Surfaces are crude on purpose. Deleted at X1b.
- `tests/worldmodel.test.ts`: the conformance gate. A downward probe against the colliders matches World.height, wallTopAt, the deck and the ground under it, and liquidAt at every tile centre of every map source (the range, every habitat recipe and variant at seeds 1 and 3, every location at seed 1). It also checks that output is byte-identical, that structuredClone round-trips, and the budgets (under 20,000 colliders and 500,000 triangles per map). The probe stays in tests/ until I1a brings the physics queries.

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

## Division of responsibilities
- Gameplay locomotion (sim/locomotion.ts, rules/traversal.ts): intent to desired velocity per mode (walk, jump, coyote time, air jumps, glide, hover, swim, fly, climb), gravity, speeds.
- Rapier character controller: resolves that translation against colliders (slide, autostep, snap to ground, slope limits, platforms). It applies no gravity and no jumping.
- Rapier rigid bodies: throwables, debris, destructible pieces, moving platforms.
- Rapier queries: aim rays, line of sight, shot sweeps, overlaps, the camera lens (render reads them only).
- Navigation: navmesh paths for ground enemies and bots; flyers steer in the volume with queries.

## Migration rules
- Flags, all default off until X1a: rules.physics.engine ('tiles' | 'rapier'), rules.nav.engine ('flow' | 'navmesh'), rules.world.source ('tiles' | 'mesh'), and the renderer by ?render=three and a Settings entry.
- With every flag off, every existing replay scenario prints "as recorded". With a flag on, new scenarios are recorded under names that say which flags they use.
- The tile adapter (world/adapter.ts, fromArenaMap) expresses tile maps as a WorldModel so physics, renderer and navigation can be built and compared on maps that already pass the playability gates. It is temporary and is deleted at X1b.
- Deleted at X1b: world/tiles.ts, arenas.ts, builder.ts, navblocks.ts, adapter.ts, habitat/, locgen/, locations/; sim/world.ts, spatial.ts, cells.ts, props.ts and the tile parts of hazards.ts; the tile stage in render/ and the painters in overworld/; the tile gates in scripts/ and tests/ whose behaviour has a mesh-world equivalent by then; the flags and their off paths.
- Async WASM (Rapier, recast) is initialised once at boot and once in a shared test setup; createRun stays synchronous.

## Tasks
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
| I1a | Physics world and queries |
| I1b | Character movement |
| I3 | Navigation |
| I1c | Enemies, bodies and bots on physics and navigation |
| I4 | Hazards, surface states and destructibles |
| I2a | three.js scene |
| I2b | Actors, effects and camera |
| G1 | Generator core and the 3D range |
| G2 | The first 3D Hold map |
| X1a | Cutover: flags on, fixed views retired, new replay baseline |
| X1b | Delete the tile stack |
| X1c | Docs and instructions |
