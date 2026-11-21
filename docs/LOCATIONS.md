# Pokémon locations: a lore-driven world generator

`?loc=chargestone-cave` (or Settings → World → Regions → *Pokémon locations*) builds a playable region from a
Pokémon location's data: its canonical identity, this game's movement and combat constraints, what may vary per seed,
and the gameplay interpretations it is allowed. The same generator builds every location; a location is a data file.

| Where | What |
| --- | --- |
| `src/world/locations/` | Location definitions (`types.ts` is the schema), one file each, registered in `index.ts` |
| `src/world/locgen/` | The generator: `topology.ts` (Layer A), `realize.ts` (Layer B), `decks.ts` (overhead decks), `dress.ts` + `stamps.ts` (Layer C), `nav.ts`, `validate.ts`, `index.ts` |
| `src/world/maps.ts` | Which stage biome uses which location (`rules.worldgen.locations`), cache |
| `src/sim/world.ts`, `enemies.ts`, `effects.ts`, `player.ts`, `bodies.ts` | Drop navigation, line of sight, spawn anchors, loose stones, corner-cut fix, two-layer height / collision / flow field for decks (location maps only) |
| `src/render/*` | Location palettes and `TERRAIN_STYLE` (rock tops, rock faces, veins, light pools), deck slabs, gatehouse / tent / ladder / house sprites, location stones, camera climb and deck ceiling |
| `scripts/locstats.ts`, `scripts/locsheet.ts` | Gate sweep and metrics, diagnostic contact sheet (the survivor bot playtest `locsurvival.ts` was deleted at hero-shooter pivot step 9) |
| `tests/locations.test.ts` | Determinism, gates over seeds, identity, sim rules, bot play |

## Why the old maps felt flat (the audit)

Measured on the classic generator (`src/world/gen`, 30 seeds) and read from the code:

1. **Elevation was clamped and relaxed away.** Base ground is quantised to 0–2 m and a slope relaxation lowers every
   free tile to within 0.5 m of its neighbours; a height budget keeps ground at ≥ 1 m under 11 %. Plateaus top out at
   2.5 m. Result: 16 % of reachable ground at ≥ 1 m, 5 % at ≥ 2.5 m.
2. **High ground was built as dead ends.** The `lookout` gate required *exactly one* access; 31 of 31 lookouts had a
   single ramp: a camping pad with one choke, overlooking nothing in particular.
3. **Terrain did not matter to ranged combat.** Enemy shots were placed at `ground + 0.9` every tick, so they climbed
   cliffs and passed through trees and rocks; ranged enemies fired whenever in range. Player shots used
   `y = max(ground + 0.7, …)`, which makes the "stop on a rising cliff" check (`ground > y + 1.5`) unreachable, and hit
   enemies at any height. Cover and sightlines were decoration.
4. **One template for every region.** All four biomes ran the same meadow plan (hub, shrine, oak, pond, hamlet,
   lookout); biomes changed palette and plant density only.
5. **Enemies arrived from nowhere.** The director picked a random point on a 21–27 m ring; habitat only weighted
   species. 7.7 % (classic) and 12.8 % (authored) of ground enemies at any moment had no path to the player.

What the engine allows (verified in code): a single heightfield per tile (no stacked floors, so nothing passes under a
bridge), 4-neighbour steps of ≤ 0.6 m, stairs that climb north only, a jump that reaches 1.84 m and then steps 0.6 m
(so ~2.44 m of climb), any drop, flying enemies that ignore terrain, a chase camera with terrain collision.

## The pipeline

Pure function of (location, seed, size); every layer has its own `Rng` stream (`loc:topology`, `loc:realize`, …);
trig through `core/detmath`; a failed attempt re-rolls with `mixSeed(seed, n)` up to 10 times and the best is kept.

**Layer A — topology** (`topology.ts`). Zone centres by dart throwing (hub toward one edge, boss hall toward the
other). Candidate links are a Gabriel graph (planar: corridors never cross). A spanning tree, then loop edges chosen by
the detour they save (graph distance ÷ straight length ≥ 1.6), up to the location's loop count. Tiers come from the
location's *landform* (`ridge`, `twin`, `descent`, `terraces`) sampled at each centre plus noise; repaired so every link
climbs at most one tier, and so the raised share sits in the location's band. **Every raised zone (not a nook) gets two
links** (a candidate edge is added, else the zone comes down a tier). Leaves become nooks (exploration, chests).
Links: a tier change is a ramp — most are *terraces* (below); same-tier raised pairs far enough apart become bridges;
the hub→boss route and arena–arena links are wide paths; the rest are flank trails. Entrances are placed around the
map edge and joined to their nearest zone. Hops pair zones one tier apart that sit close but are not linked.

**Layer B — realise** (`realize.ts`). Zones are wobbly ellipses at `tier × tierGap`. Links are Chaikin-smoothed
centre lines (flat links bow sideways). A ramp's height follows arc length at `slope` m/tile, so every 4-neighbour step
stays under 0.6 m. A **terrace junction** is wide (≈ 1.5 × the smaller zone's radius): the gap between the two zones
splits at a cliff line — the upper zone's rim overlooks the lower — and the ramp climbs along one side. A **bridge** is
a deck across a chasm cut into the enclosure on both sides, so a lower route never needs to pass under it. A **hop** is a
flat approach and a step at half a tier against the upper rim: two 1.5–1.75 m jumps for the player, a wall for ground
enemies. The enclosure: forest ground follows the nearest playable height (trees stand on the bluffs); rock masses rise
`wallRise` m above it.

**Layer C — dress** (`dress.ts`, `stamps.ts`). Surfaces; forest masses planted as 2×2 trees with 1×1 thickets on the
edge; the location's landmark stamps in zones that satisfy their kind and tier; **cover** as ring clusters (one blocking
piece and one or two low ones) with gaps between them; **parapets** of low cover on raised rims; a low piece beside wide
paths every few tiles; tall grass, mushrooms, flowers; habitat bits. Centre lines, ramps, decks, steps and the spawn
clearing are reserved, and a prop is refused if it would leave a one-tile gap to another blocker. Anchors are the
entrances, the nooks and the middle of each flank trail.

**Decks** (`decks.ts`, between B and C). A second walkable surface above open ground: `ArenaMap.over[k]` is a deck
height (0 = none) over tile k, whose ground keeps `elev`/`terrain`/`wall`. Three constructions, all on every seed:
*shelves* — a raised floor's rim continues 2–3 tiles past its cliff line (it may break through one tile of rock to do
so) along a curved run of 5–12 tiles, a balcony over the lower floor with a sheltered alcove beneath; *underpasses* —
where a flat trail meets a bridge deck at least 2.9 m above it (realize records the crossing instead of cutting the
trail), the deck moves to `over` and the trail runs on beneath; *hollows* — a bridge with lower floor on one side gets
a walkable gully that runs in under the deck and ends just past it, with a chest. Every deck clears the ground under it
by ≥ 2.9 m (a jump reaches 1.84 m; the sim snaps to a deck from 0.9 m below its top), and nothing blocking is placed
under a slab. Per location: `decks: { shelves, depth, run }`.

**Check** (`validate.ts`). Enemy-walkable tiles outside the spawn's strongly connected component are sealed (rock or
thicket) — then the gates below run.

## Engine rules the maps rely on (location maps only)

All gated on `map.gen.loc`; authored arenas and the classic generator replay bit-identically (`scripts/checksum.ts`:
`off`, `build-off`, `world-off`, `on` and the new `gen-classic` print the pre-change hashes).

| Rule | Where | Why |
| --- | --- | --- |
| Enemies may drop down ledges ≤ `dropNav` (3.5–4 m) in the flow field | `World.canStep` | High ground is reached by ramps; low ground is reached fast from above. Navigation is directed, so validation checks *strong* connectivity |
| Enemy shots keep their altitude and aim at the player's chest; a wall tile or terrain above the shot stops it | `shootHostile`, `effects.ts` | Trees, rocks, bushes, cliff lips are cover |
| Ranged enemies with no line of fire hold and move along the flow field | `enemies.ts` | Breaking line of sight works; they reposition instead of shooting into rock |
| Player shots sink off a ledge (7 m/s), stop on a rising cliff face and on wall tiles, and only hit a creature within 1.1 m + half its height | `effects.ts` | Both sides need distance to fight across a cliff; no sniping from safety |
| The landing point of a step is tested, not only the look-ahead; a player inside a wall is moved to footing | `player.ts` | A diagonal corner cut dropped the player into a chasm (found in bot play) |
| ~60 % of spawns enter at an anchor 18–43 m away | `ringPoint` | Pressure comes from cave mouths, gates and side trails |
| Loose stones at `bodySpots` | `seedBodies` | Chargestone's charged stones are Push / Hold bodies |
| Chase camera climbs (pitch up, 6° steps to 66°) instead of ramming into a wall, and looks down at the Pokémon while lifted | `render/camera.ts` | Cave walls and bluffs behind the player; render-only (applies everywhere) |
| Elevated `wood` tiles stand at their elevation; river bridges stay at 0.05 m | `tiles.deckTop` | Log bridges between bluffs |
| `World.height(x, z, ref)`: on a deck tile the deck is the surface for anything whose feet (or shot) are within 0.9 m below its top, else the ground; without `ref` always the ground | `world.ts`, `player.ts`, `enemies.ts`, `bodies.ts`, `effects.ts` | Walk over a deck and under it |
| `blocks` on a deck ignores the ground's walls; `sight` stops at a slab and ignores walls under a deck | `world.ts` | A slab is cover from above and below |
| The flow field runs on nodes (tile = ground, n + tile = deck); a step lands on the node the walker would physically occupy (no dropping through a deck) | `world.ts` `layeredFlow`, `locgen/nav.ts` | Enemies use shelves, drop off their edges, walk under them |
| Ground enemies with the player on another layer (> 2.4 m apart, one of them on or under a deck) follow the flow field instead of walking straight | `enemies.ts` | Nobody mills about under the player |
| Chase camera: under a deck, pitch is capped below the slab, no climb-over, the boom may shorten to 0.7 m | `render/camera.ts` | The lens never ends on top of the slab |

## Gates (hard; every seed must pass or re-roll)

| Gate | Rule |
| --- | --- |
| connected | every enemy-walkable tile and every deck is in the spawn's strongly connected component (with drops); ≤ 260 tiles sealed |
| zones | every zone (entrances excepted) is reachable within 3 tiles of its centre |
| perches | no tile or deck the player can reach (jumps ≤ 2.4 m, any drop) is out of enemy reach |
| access | every raised zone (not a nook) has ≥ 2 realised enemy links |
| vertical | the largest tier holds ≤ 75 % of reachable ground and the next ≥ 15 % |
| overlooks | ≥ 2 raised spaces have a rim over lower playable ground |
| loop | a second spawn→boss route shares < 60 % of the first |
| spawnOpen | no blocker within `spawnOpen` (8 m) of the spawn |
| bossHall | the boss hall has ≥ 2 ways in |
| anchors | ≥ 3 anchors in the enemy core |
| landmarks | every canonical landmark placed at least its minimum count |
| pinch | ≤ 24 one-tile passages |

Gated: `wide`. Footprints of 0.5 m and up (Large and Extra Large Pokémon, partners included) route on the wide block lattice (`src/world/navblocks.ts`, read by both the sim and `wideCore` in `locgen/nav.ts`; docs/SIZING.md "Navigation classes"). The gate uses the strictest wide body, an Extra Large partner at 0.88 m with no diagonal-only links. From the hub it must reach every mandatory space: the boss hall and every arena (the main-route spaces), plus at least three enemy anchors, so wide enemies always have a way in. `wideBoss` and `wideAnchors` are still reported.

### Size-restricted spaces

Chambers and nooks are side spaces off trails, and they may be closed to wide bodies on purpose. Two cases do it: a one-tile neck where a two-tile trail meets a chamber offset by a column, and a two-tile trail stepping along a diagonal (about 1.41 m across, which fits a Large body at 0.66 m but not an Extra Large one). Anchors outside the wide core are narrow-only entrances, and the director never spawns a wide body at one. The one-tile pinches the `pinch` gate allows stay Tiny, Small and Medium chokepoints.

Before this gate, `wideBoss` read 73 / 50 / 37 % of seeds (Viridian Forest / Mt. Moon / Chargestone Cave). That was a measurement defect: the old block rule rejected diagonal ramps and bridge abutments (docs/SIZING.md). With the edge rule the boss hall is wide-reachable on 30 of 30 seeds in each location. Adding the gate re-rolled 13 of 300 Viridian Forest seeds and 2 of 300 Mt. Moon seeds (an arena was reachable only through such trails); attempts rose 597 → 624 and 479 → 482, no seed is left unsatisfied, and Chargestone Cave is unchanged. That is `LOC_VERSION` 2. Mt. Moon seed 275 used to throw in `planTopology` at both versions. A zone 53.6 tiles from its nearest centre had no candidate edge (the cap is 52), so the spanning tree was a forest, and the two-ways-in rule read the tier of a neighbour it did not have. The tree now joins any stray part by its shortest link to another part. It draws no randomness, so every connected graph is untouched: 899 of 900 seeds (1–300 in each location) keep their checksum, attempts and gates, and seed 275 is accepted on its first attempt. The survey found no other disconnected topology. `LOC_VERSION` stays 2, since no accepted layout changed (`tests/locations.test.ts`).

## Metrics (30 seeds each, this build, Node 22 on an Apple laptop)

| | Viridian Forest | Mt. Moon | Chargestone Cave | classic Meadow |
| --- | --- | --- | --- | --- |
| seeds passing every gate (total attempts for 30) | 30/30 (72) | 30/30 (48) | 30/30 (44) | — |
| generation time p50 / p95 / max | 45 / 119 / 146 ms | 14 / 41 / 65 ms | 15 / 42 / 43 ms | p50 73, p95 160 ms (WORLDGEN.md) |
| distinct zone graphs | 30/30 | 30/30 | 30/30 | — |
| tiers used (mean) | 2.0 | 2.63 | 2.83 | — |
| reachable ground ≥ 2.5 m | 37 % | 85 % (spawn floor is tier 1) | 69 % | 5 % |
| highest floor | 3 m | 7 m | 6 m | 2.5 m |
| loops in the zone graph (mean) | 3.80 | 3.67 | 4.60 | — |
| overlooks (mean) / rim exposure (mean) | 2.97 / 0.98 | 3.73 / 0.99 | 4.80 / 0.99 | single-access lookouts 31/31 |
| ramps / bridges / hops (mean) | 6.3 / 1.4 / 0.7 | 7.0 / 1.5 / 0.2 | 8.0 / 2.3 / 1.1 | — |
| 12 m sightlines blocked from combat floors | 74 % | 69 % | 71 % | (terrain did not block shots) |

*Exposure*: share of sampled rim tiles of each raised space that a shooter on lower ground within 16 m can see.
High is intended — a rim is where you stand to shoot down, and where you can be shot from below; the interior of a
raised space is safe from below and cannot shoot down either.

Bot playtest (historical: `scripts/locsurvival.ts`, deleted at hero-shooter pivot step 9; `npx tsx scripts/locsurvival.ts 6 180`: 6 seeds × Totodile and Cyndaquil, 180 s, meadow roster):

| Map | reach 180 s | mean survival | KOs/min | damage taken/min | ground enemies with no path |
| --- | --- | --- | --- | --- | --- |
| authored Meadow | 8/12 | 161 s | 194 | 93 | 12.8 % |
| classic generated | 8/12 | 153 s | 216 | 99 | 7.7 % |
| Viridian Forest | 9/12 | 166 s | 226 | 102 | 1.2 % |
| Mt. Moon | 8/12 | 153 s | 172 | 80 | 0.2 % |
| Chargestone Cave | 10/12 | 164 s | 174 | 83 | 0.0 % |

The bot does not aim, guard, jump or use terrain, so this says the maps work for the director and navigation (not
worse than the authored arena, and nobody stranded), not that the spaces are good for people.

## The three locations: canon and interpretation

Each file lists its facts with references (`refs`) and its interpretations (`creative`) separately; the summary:

**Viridian Forest** (Kanto). Canon: on Route 2 between Viridian City and Pewter City with gatehouses at both ends; a
dense forest maze; tall grass; Bug-type Pokémon and Bug Catchers; Trainer Tips signs with items nearby. Every seed has
tree-wall enclosure, winding 2–3-tile trails, tall-grass clearings, two Route 2 gatehouses, Trainer Tips signs with a
chest. Interpretation: raised mossy bluffs (two tiers, 3 m), fallen-log bridges over wooded gullies, rock-step
shortcuts, an old giant tree in the boss clearing, a Bug Catcher camp.

**Mt. Moon** (Kanto). Canon: between Route 3 and Route 4; floors 1F/B1F/B2F joined by ladders; Zubat, Geodude,
Paras, Clefairy; fossils on B2F guarded by a Super Nerd, Team Rocket digging; Moon Stones, and in Gen II / HGSS the
summit Mt. Moon Square with its large Moon Stone. Every seed has three floors 3.5 m apart (the spawn on the middle one),
rock walls, a fossil dig on the lowest floor and the Moon Stone on the highest. Interpretation: ramps and stairs for
ladders, an open dark vault instead of a ceiling (camera), natural rock bridges over shafts, rubble-step shortcuts,
moss and mushroom patches for the Paras that live there.

**Chargestone Cave** (Unova). Canon: between Route 6 and Mistralton City; magnetism makes charged stones float, and
some must be pushed toward large magnetic crystals; three floors; Joltik, Klink, Ferroseed, Tynamo; listed among
special magnetic field locations. Every seed has slate rock, glowing crystal rims and clusters, 3–4 large magnetic
crystals each with loose stones beside it (Push/Hold bodies), three shelves 3 m apart. Interpretation: stones as
bodies you shove into the horde, crystal bridges across rifts, crystal-step shortcuts.

References are in each file; the main ones: [Bulbapedia — Viridian Forest](https://bulbapedia.bulbagarden.net/wiki/Viridian_Forest),
[Bulbapedia — Mt. Moon](https://bulbapedia.bulbagarden.net/wiki/Mt._Moon),
[Bulbapedia — Chargestone Cave](https://bulbapedia.bulbagarden.net/wiki/Chargestone_Cave),
[Serebii — Chargestone Cave](https://serebii.net/pokearth/unova/chargestonecave.shtml).

**Species fit.** `biomeFit` names the stage biomes a location suits; the region spawn pools it once fed were deleted at hero-shooter pivot step 9 (docs/SPAWNING.md). The default
mapping puts a location where its canonical ecology overlaps the roster: Viridian Forest in the first region (Ledyba,
Oddish, Rattata are forest and grass dwellers, and Pikachu is now in the Meadow pool; Caterpie and Weedle are not in the roster), Mt. Moon
in the last (Zubat and Paras are canonical Mt. Moon Pokémon). Badlands (Fire) and Frost (Articuno) keep the classic
generator: none of these locations fits them. `?loc=` overrides this for testing.

## Using it

- `index.html?go=1&loc=chargestone-cave&seed=7` — every region from Chargestone Cave; `loc=meadow:mt-moon,dusk:viridian-forest` per stage biome. Names are matched loosely (`loc=Chargestone%20Cave`, `loc=mtmoon`).
- Settings → World → Regions: *Handcrafted*, *Generated (classic)*, *Pokémon locations* (default).
- Console: `pokewatch.loc()` (gates, metrics, zones, links of the current map), `pokewatch.locations`.
- `npx tsx scripts/locstats.ts all 30 1` — gate pass rate, timing, every metric; `-v` prints every seed.
- `npx tsx scripts/locsheet.ts mt-moon 8 1 sheet.png 3` — contact sheet: tiers by colour, cliff lines, zone graph
  (white path/trail, blue ramp, orange bridge), spawn (white), boss (red), anchors (orange), chests (yellow), stones
  (cyan), pinches (magenta), and any player-only perch (red; there should be none).

## Adding a location

1. Copy a file in `src/world/locations/`, fill `canon` (facts with `refs`), `identity`, `creative`; keep facts and
   interpretations apart.
2. Set `gameplay`: `tierGap` > 2.44 m (a jump-and-step reaches 2.44 m) and ≤ 4.8 m (a hop is half a tier),
   `slope` ≤ 0.5, zone radii, widths, `dropNav`.
3. Set `freedoms` (zone count, loops, raised share, bridges, hops, entrances, landforms) — these are what seeds vary.
4. Choose `enclosure`, `surface`, `props`, `habitat`, `art` (a key in `render/tileart.ts` `BIOME_ART`, `sky.ts`,
   `artdirection.ts`; reuse one or add one), `particles`, `bodies`.
5. Landmarks: reuse a stamp in `locgen/stamps.ts` or add one (a function that places props in one zone through the
   `Dresser`, which refuses reserved and gap-making tiles).
6. Register it in `src/world/locations/index.ts`; map a stage biome in `rules.worldgen.locations` if its roster fits.
7. Run `scripts/locstats.ts <id> 30` (all gates should pass in ≤ 3 attempts on average) and look at `locsheet.ts`.

Nothing in `src/world/locgen` names a location or a species (a test enforces it).

## Limitations

- **Two layers, not full 3D.** A tile has a ground and at most one deck. No tunnels through solid rock, no ceilings
  over whole chambers (caves stay open-top under a dark vault), no stairs between layers inside a tile, decks are flat.
- **Underpasses are rare** (a trail must already cross a bridge: about one map in ten for Viridian, almost never in the
  caves). Shelves carry most of the layered space; planning skyways over lower arenas needs topology support.
- **Fire does not reroute the layered flow field** (unit cost; the classic weighted field is used on maps without decks).
- **Camera under a shelf** comes in to an over-the-shoulder 0.7 m with a flat pitch; in a 2-tile alcove that is cramped.
- **Billboard props** (trees, crystals) are upright sprites; nothing hangs from a slab's underside yet.
- **No water** in these three locations (none canonically central); the classic generator's rivers and lakes are not
  yet a location feature, so Route 119 / Meteor Falls style places need that next.
- **No new interactions.** Chargestone's stones reuse the body system; Electric moves do not yet charge crystals.
- **Flying and swimming** add nothing location-specific: flyers already ignore terrain; the player's flyers glide off
  ledges (existing).
- **Hops are rare** in Mt. Moon (0.23 per map) because its zones sit far apart; they are optional shortcuts. Mt. Moon
  marks each hop step with a ladder, so ladders appear on only ~4 maps in 30.
- **Narrow cave trails** (4 tiles) between tall walls still force the camera steep when it looks across them.
- **Measured by bot, not people.** Survival parity and navigation validity are measured; whether overlooks, loops and
  cover make better fights for players needs playtests.
- **Viridian Forest has ~3,700 props** (mostly tree walls), against ~3,160 on the classic generated Meadow and 1,535
  on the authored one; the renderer culls by view radius and generation stays under 150 ms, but frame time on real
  GPUs was not measured (captures used software GL).

## Art direction for locations (second pass)

Audited from running-game captures of seeds 1 and 4 of each location (third-person and the fixed Wide view):

| Problem seen | Source | Change |
| --- | --- | --- |
| Cave walls topped with lawn: green lips and grass tufts on Mt. Moon and Chargestone rock | `dress.ts` paints mass tiles `T.grass`; ledge lips use the default green | `TERRAIN_STYLE.rockTops`: bare wall tiles are painted as faceted natural rock (Voronoi facets, half the borders cracked so facets merge into masses); no ledge lips in caves |
| Every wall a brick course (thin strata, 0.3 m terraces every tile) | `paintCliff` 32×16 strata; enclosure heights `dist × 0.3 + fbm` | `paintRockFace`: 64×48 seamless fractured rock (4 tiles × 3 m before it repeats), moss fringe in the forest, embedded crystal shards in Chargestone; rock masses rise in 0.6 m shoulders |
| Trees around cave maps; a flat lawn skirt outside the walls | decorative forest ring; skirt at ground level | caves get a raised rock skirt and an inward face instead of a tree ring |
| Tan sandstone boulders and loose stones everywhere | `ROCK.meadow`; pixelfx body sprites hard-coded tan | mossy grey forest stones; per-location body sprites (`bodyRock.<art>`): Chargestone's charged stones are slate with crystal shards and hover |
| Chargestone identity = a few crystal props | — | charged veins through the floor, light pools around every crystal, crystals in every wall face, glints in the rock tops, shards at the wall feet |
| Gatehouse drawn as a log cabin; hamlet houses too | `cabin()` | `gatehouse`: a low cream checkpoint building with a slate roof and glass sliding doors; `cabin` repainted as a town house (plaster, tiled roof, white-framed windows) |
| 17 wooden crates as Mt. Moon cover; crates at the Bug Catcher camp | `props.low` included `crate` | Mt. Moon low cover is rock; the camp has a tent with a bug net; crates stay only at the fossil dig |
| — | — | Mt. Moon ladders on hop steps (canon: floors joined by ladders); rubble at Mt. Moon's wall feet |

A generator bug also showed up in the captures: the hub and the boss zone were both created with id 0, so links meant
for the boss attached to the hub; an entrance trail could then run across the whole map, be cut by raised zones and get
sealed into a straight line of thicket. Zones now get unique ids (test: *zones have unique ids*).

### Metrics after this pass (30 seeds each)

| | Viridian Forest | Mt. Moon | Chargestone Cave |
| --- | --- | --- | --- |
| seeds passing every gate (attempts for 30) | 30/30 (71) | 30/30 (48) | 30/30 (44) |
| generation p50 / p95 | 57 / 123 ms | 17 / 47 ms | 18 / 49 ms |
| deck tiles per map (mean, min) | 33.6, 13 | 48.6, 26 | 56.7, 29 |
| shelves / underpasses / hollows (mean) | 1.53 / 0.07 / 0.33 | 2.43 / 0 / 0.23 | 2.53 / 0 / 0.47 |
| bot: reach 180 s, mean survival, ground enemies with no path | 7/12, 151 s, 0.8 % | 8/12, 163 s, 0.1 % | 8/12, 155 s, 0.0 % |

The same bot with decks switched off: 7/12, 8/12, 9/12 — the difference is within one run of noise.
