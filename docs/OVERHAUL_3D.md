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
