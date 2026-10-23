# Procedural world (slice W0–W4)

Design: *Procedural Pokémon World Blueprint* (2026-10-22). This file records what the code does, the rules it uses and
what was measured. The generator lives in `src/world/gen/`, the map factory in `src/world/maps.ts`, the material table
in `src/rules/surfaces.ts` and the prop overlay in `src/sim/props.ts`. Every number is in `src/rules/defaults.ts`
(`worldgen`, `surfaces`) or at the top of the generator file that uses it.

## Turning it on

- Settings → World → Sunpetal Meadow: **Handcrafted** (default) or **Generated each run**.
- URL: `?world=gen` (or `?world=authored`), e.g. `index.html?go=1&world=gen&seed=7`.
- Rules: `worldgen.mode: 'generated'`, `worldgen.biomes` (defaults to all four regions), `worldgen.size` (128),
  `worldgen.version` (2), `worldgen.regionSeed` (≥ 0 holds the map fixed across runs, for experiments).

The map is a pure function: `map = generate(regionSeed, biome, version)`; the region seed is the existing stage seed
`seed + stage*7919 + loop*104729`. Same seed, same map, on every client (`mapChecksum` in `world/maps.ts` is the value
a co-op handshake would compare).

## W0: the seam

| Change | Where |
| --- | --- |
| `World` asks `regionMap(rules.worldgen, biome, seed, species)` instead of `getArena(biome)` | `sim/world.ts`, `world/maps.ts` |
| Generated maps cached by (biome, seed, version, size), LRU of 6 | `world/maps.ts` |
| Renderer stages and the ground texture keyed by `map.id` (`meadow` for the arena, `meadow@7v2` for a region); at most 3 generated stages kept, older ones disposed | `render/renderer.ts`, `render/tilestage.ts` |
| Spatial grid sized for the larger map when generation is on | `sim/run.ts` |
| Authored arenas are untouched and remain "authored mode" | `world/arenas.ts` |

Exit gate: replay checksums identical in authored mode. `scripts/checksum.ts world-off` prints the pre-change `on`
hashes exactly (all four configurations, every 60 s mark), and `off` / `build-off` are unchanged.

## W1–W3: the pipeline

`generateRegion` runs one attempt, validates it, repairs up to 3 times, and re-rolls the seed (`mixSeed(seed, n)`) up
to 12 attempts. Every stage draws from its own named `Rng` stream (`gen:plan`, `gen:terrain`, …), trig goes through
`core/detmath`, heap ties break by index, and no object-key or Set order is iterated where it changes output. A test
greps the generator for `Math.sin/cos/atan/hypot/exp/log/pow/random`.

| Stage | File | What it does |
| --- | --- | --- |
| Plan | `plan.ts` | Archetype (north ridge, river valley, central hollow), a quarter-turn and mirror, and a place graph: hub, boss glade, shrine, oak, pond, hamlet, lookout, berry grove or rock gate, two objective sites. Edges: a Prim tree from the hub, a hub–boss road, a second hub→side→boss path for the loop, and a second route into the glade. |
| Terrain | `terrain.ts` | Two-scale rolling noise plus the archetype's landform and a basin around the pond; quantised to 0.5 m; two majority passes remove specks; places flattened to the lowest level around them; a max-slope relaxation makes all free ground walkable; a height budget keeps base ground at 1 m or more under 11 %. |
| Water | `water.ts` | 8-neighbour A* over the continuous height field for the river or streams (cost cached per attempt), resampled and Chaikin-smoothed (no D8 staircases); lakes with raised rims; a second pool in the lowest basin, then wider streams, until water is 3.8 % before bridges. |
| High ground | `terrain.ts` | The ridge (ridge archetype) as a plateau broken by one pass; the shrine knoll; lookouts. Each access is planned dry and committed only if it fits: a stone stair when the edge faces south (the engine's stairs climb north), otherwise a graded ramp of 0.5 m per tile landing on the lowest ground across its width. Plateau rims and ramp sides are marked as intended cliffs. |
| Routes | `routes.ts` | A* over (tile, heading) with a turn penalty, so routes are straight runs with corners; only legal steps; reuses earlier routes; crosses water straight on bridges of at most 6 tiles; ponds are reached at their shore; bridge ends are paved onto the route. Roads 3 wide (`path`), trails 2 wide (`dirt`). |
| Kit | `kit.ts` | 12 stamps with footprint, sockets, precondition, cover and height values (`STAMPS`): shrine ruin, elder oak, pond shore, camp and signpost, hamlet (grammar), battle glade, rock gate, log bridge, hedge gate, stone stair, berry grove, lookout. Objective sites get bare dirt (non-flammable). |
| Hamlet grammar | `kit.ts` | An E–W street through the site; 5–6-tile lots on its north side, cabins with doors facing the street (the DS camera looks north); hedges behind the lots; a well, fenced garden, flower beds, bench, lamp and a sign on the south side. |
| Ecology | `ecology.ts`, `rules/stages.ts` | Moisture, canopy, tall-grass and reed densities are biome data, not palette swaps. Meadow has broad grass cover; the arid Badlands thin it and expose sand and vents; Frost limits understory and keeps snowbound ground open; humid Duskwood grows dense canopy and reed-fringed wet ground. Existing map structures (rivers, ponds, ridges, hamlets, groves) remain shared. |
| Habitat | `rules/habitats.ts`, `ecology.ts` | Per-tile bits: water edge, tall grass, rock, dry open ground, meadow, forest edge. Each native species has one or more affinities; generated-region spawns in matching habitat get 2× weight, mismatches retain 0.55× weight, and unclassified species remain neutral. The decor layer draws burrow mounds, wool tufts and water-edge prints (`render/decor.ts`). |
| Field play | `sim/cells.ts`, `sim/director.ts` | Generated tall grass slows most ground-builds but not Bloom/Hive Pokémon; Badlands sand slows non-Quake/Stone builds and becomes deeper mud when soaked; Frost ground slows non-Ice builds and periodic frost weather can freeze wet ground or ponds into slippery shortcuts; Duskwood wet edges slow builds without Tide, Bloom, Venom or Quake affinity. Rain, fire spread, water-created Wet cells and Electric discharge keep cross-biome counterplay useful. Terrain footing is generated-map-only; regional weather and cell chemistry also apply to authored arenas. |
| Gameplay pass | `gameplay.ts` | Spawn clearing: no blockers within 12 m, 6–8 cover pieces at 13–21 m, at most 12 within 22 m. Light cover across the map. Chest spots tucked against walls or on high ground. Encounter spaces measured from 64 route samples (hub, chokepoint, overlook, grove, water edge). |
| Pockets | `gameplay.ts` | Walkable ground the routes never reach is connected by a trail when a legal one exists (it may bridge or climb), otherwise planted as forest, so nothing that looks walkable is an invisible wall. Repair trails clear only trees, bushes and rocks, never buildings or stamps. |
| Frame | `index.ts` | Border forest, ledge lips, stone outcrops on the 2.5 m ridge top. |

### Gates (`validate.ts`)

Hard gates from blueprint section 2, rule tests from section 3. Where a gate was calibrated against the authored Meadow
it says so.

| Gate | Rule |
| --- | --- |
| reach | spawn, boss glade, every landmark (within 3 tiles), objective site and chest reachable by walking |
| reachShare | reachable ≥ 55 % of open ground before pockets are sealed |
| spawnOpen | no wall, water or blocking prop within 12 m of the spawn (the signpost does not count) |
| spawnCover | 4–12 cover pieces within 22 m. A *piece* is a connected group of blocking prop tiles (a grove is one piece). The authored Meadow has 21 and an open radius of 8, so it would fail this gate as written; the blueprint asks for it on generated regions. |
| bossGlade | open radius ≥ 7 and at least two ways in (a walkable arc over half the ring counts as two) |
| loop | a second spawn→boss path sharing under 50 % of the first, at most 1.8× its length |
| vertical / lookout | 8–25 % of reachable tiles at ≥ 1 m; a reachable lookout with exactly one access |
| spaces | at least 3 encounter-space kinds besides the hub |
| water | water and bridges 3–9 % of the map |
| groundMix | no ground type over 45 % of walkable area, except plain grass, held to 80 %: the authored Meadow is 78 % plain grass, so 45 % would reject the handcrafted reference itself |
| cliffs | no step of 0.75 m or more between walkable neighbours unless both tiles are marked as an intended cliff |
| bridges | each bridge's two ends step onto route tiles |
| rivers / lakes | no water on the ridge; at most 2 lakes, each with a rim ≥ 0.5 m on 3 of 4 sides (land 2–5 tiles out) |
| groveEdge | no straight tree edge over 12 tiles (hedges, fences and buildings are deliberate lines and do not count) |
| hamlet | 3–5 cabins, every door on the street and reachable |
| habitat | every classified spawn-table species of the region has at least 30 reachable tiles of its habitat |

## W4: materials and the overlay

`rules/surfaces.ts` holds six materials (grass, leaf, wood, stone, water, ice), the 24-cell reaction table and the prop
kind → material map. Tiles keep running in `sim/cells.ts`; props run in `sim/props.ts`.

| Rule | Value |
| --- | --- |
| Overlay | each `World` copies the map's `wall` and `platform` (the cached base map other runs share is never written); `World.setBlock` is the only writer and refreshes navigation |
| Heat on leaf / wood | burns 3 s / 6 s; its tiles burn (the existing fire overlay and flow-field cost apply) |
| Spread | a burning prop lights tall grass beside it (0.18 per pass, as grass does) and props beside it (0.06 per pass for leaf, × 0.045 for wood: about 1 in 7 over a neighbour's burn, so a forest fire dies out instead of crossing the region); burning grass lights props beside it (0.02 per pass, wood × 0.045) |
| Burn out | wood leaves a stump (0.65 m platform on one tile, the rest open ground); leaf leaves nothing; tiles go to ash |
| Wet / Cold on a burning prop | doused (its tiles wet) |
| Force | a Push (area moves) or an impact (a body hitting it at ≥ 5 m/s) of Power ≥ the prop's Weight breaks it; weaker pushes chip integrity × type chart |
| Break | stone → rubble bodies (Push and Hold act on them) and a rubble patch; wood → stump; leaf, fences → gone |
| Never break | the elder oak, cabins, the shrine, statues, lanterns, lamps, the well, signs, crystals, vents; bridges are terrain |
| Cover cap | lost + burning cover may not exceed 40 % of the region's cover pieces; past it nothing more ignites or breaks |
| Watchdog | every 2 s, reachable tiles from the spawn against the base map; under 90 % reverts the oldest stumps |
| State hash | prop states are hashed when any prop has changed (an untouched overlay hashes as nothing) |
| Flags | `surfaces.enabled: false` gives today's rules exactly; `surfaces.inAuthored` (default false) applies materials to the handcrafted arenas too. By default they apply to generated regions only, because on the authored Meadow bot runs die much earlier with them (Cyndaquil seed 2: level 9 instead of 24), a balance change that needs people, not a bot |

The renderer draws burnt wood as a stump at the footprint's south-west tile, skips burnt leaf and broken props, and drops
their shadows.

## Measurements (2026-10-22, this build, headless)

Node 22, esbuild bundle (the browser build's code), single thread, a shared container. Software GL for captures.

| Gate (blueprint) | Threshold | Result | Verdict |
| --- | --- | --- | --- |
| W0: authored replay unchanged | identical hashes | `off`, `build-off`, `world-off` and `on` (default) print the baseline hashes at every 60 s mark of all four configurations | pass |
| W1 / Validity: seeds pass every gate | 1,000 seeds, 0 unreachable sites | 1,000 / 1,000 pass all 20 gates; 914 on the first attempt, 78 on the second, 8 on the third; archetypes valley 323, ridge 325, hollow 352 | pass |
| W1: generation time | p95 ≤ 150 ms in a worker | p50 73 ms, p95 160 ms, max 346 ms, main thread in Node (a retry costs ~80 ms; no worker built) | narrow miss, worker not measured |
| Different places (automated half) | no two seeds share a place graph and route shape | 12 / 12 distinct in the test; 1,000-seed archetype × place layout not checked pairwise | partial |
| Not worse | bot survival within 10 % of authored | authored 17/24 reach 300 s (mean 259 s); generated 14/24 (mean 225 s): −18 % reaching 300 s, −13 % mean time | **fail** |
| Different play | between-map F > 2 | damage/min F 1.76, survival time F 1.29, KOs/min F 1.75 (20 maps × 3 runs, Totodile, 180 s) | **fail** |
| W4: reaction matrix | every cell holds | 24 / 24 (`tests/surfaces.test.ts`) | pass |
| W4 / Safe: flags off equals today | identical hashes | yes (see W0) | pass |
| Safe: watchdog | never under 90 % reachable for > 10 s | 0 s under the floor in every bot run checked | pass (bot only) |
| Tests | — | 161 / 161 (148 existing, 7 materials, 6 generator); typecheck clean | pass |

What changed during tuning (all measured): the first sheets showed straight grove edges along straight roads, invisible
walls on unreachable grass (520–1,760 tiles per region, now 0–11), a bridge running into the pond, wood fire spreading
supercritically (1,070 props burnt in 60 s, now ~180), the decorative outer forest picking a boulder, and a bot that
orbits the map centre (on a generated region that can be a river; it now orbits the hub on generated maps only).

Why "not worse" fails, as far as measured: generated runs pin the bot more (37–47 % of seconds barely moving, against
30 % on the authored arena); water and cliffs are the largest map-side blockers, and most pinned seconds are on open
ground between enemies. The bot never aims, guards or jumps, so this is a bot-measured gap, not yet a player one.
Candidates: lower verticality toward the gate's 8 % floor, fewer river crossings near the hub, more cover pieces
between 12 and 22 m.

Why "different play" fails: run-to-run noise on one map is about as large as map-to-map variation for this bot. With
three runs per map the test has little power; it needs more runs per map and a bot that uses terrain, or people.

## Not done or not verified

- **Merged onto source_14 (third-person P0)** as bonklab-source_15, with the _13-uifix tray and screen fixes ported back
  in (P0 had branched before them). Third-person captures of generated regions: `tools/genchasescenes.json`. The
  bot-survival and variety figures above were measured on the _13 base; the simulation is identical (P0 is render-only,
  checksums unchanged), so they carry over.
- **No Web Worker.** Generated regions are built at stage start on the main thread; see the timings above.
- **Blind review and human playtests** (Different places 90 %, Believable ≥ 3.5) need people. The contact sheet and
  captures are the inputs for them.
- **W5/W6** (map checksum handshake in co-op, overlay recap lines, PvP fairness and seed pool) are not built;
  `mapChecksum` and the hashed overlay are their footholds.
- **Habitat signs** are decoration; the director still spawns on its ring.
- **Real GPU** frame time and ground paint at 128² on real hardware were not measured (software GL only).
