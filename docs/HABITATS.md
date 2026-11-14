# Habitat recipes: procedural match maps around a shared control point

`?loc=river-gorge&mapseed=3` (or Settings → World → Map / Map seed) builds every region from a **habitat recipe**: a
data-driven environment envelope (landform, medium, anchors, vegetation, landmarks) with a **mode graph** (two sides,
two approaches each, one contested point) embedded in it, then proved playable on the finished collision. Two recipes
ship and share the same generator, geometry families and rules:

| Recipe | `?loc=` | Variant | Built from (physical references, adapted) |
| --- | --- | --- | --- |
| **Shrine Gorge** | `river-gorge` | `river-gorge/snow` | Hoenn Route 119 (river, waterfall, tall grass), Ilex Forest (dense forest, small shrine) |
| **Cinder Crater** | `volcanic-ridge` | `volcanic-ridge/ash` | Mt. Chimney (crater, lava), Fiery Path (cave through the mountain), Firespit Island (cooled lava slopes) |

Both are **adaptations**: the official places supply landforms and relationships; every combination is labelled in
the recipe (`anchors[].provenance`: `canon`, `reinterpretation`, `original`; `adaptations[]` says why).

## Launching and replaying

- URL: `index.html?go=1&loc=river-gorge&mapseed=3`, `loc=volcanic-ridge`, `loc=river-gorge/snow`, `loc=volcano` (loose
  names work). `loc=meadow:river-gorge,badlands:volcanic-ridge` maps stage biomes as for Pokémon locations.
- Settings → World → **Map** (default rotation, any location or habitat and its variants) and **Map seed** (`-1` =
  derived from the run seed). Both persist and take effect on the next run.
- **Which one wins:** the URL beats the saved settings. `?loc=` names the map; failing that, `?world=authored|gen` asks for
  handcrafted or classic regions and ignores the saved Map; failing that, the saved Map applies, and with no Map the
  Regions choice (default: Pokémon locations = Viridian Forest, then Mt. Moon) and the default rotation stand. `?mapseed=`
  beats the saved Map seed. A saved Map or seed that is not a map id / whole number is dropped on load; an id that no
  longer exists loads the default rotation and the console says `unknown map "…"`.
- **What the display says.** The region plaque names the seed that is actually loaded: `map seed 7` when the requested seed
  was accepted; `map seed 3 → 548672811 (try 4)` when it was re-rolled (the layout of seed 548672811 is on screen);
  `map seed 9 → 1 (9 rejected)` when every attempt failed and the known valid seed was loaded. The console prints the same
  with both links, and `pokewatch.hab()` returns `kind` (`direct` / `retry` / `fallback`), `requestedSeed`, `loadedSeed`,
  `version`, `checksum`, `replay`, `layoutOnly`, gates, metrics, repairs and rejected attempts.
- **Replay links.** `?loc=<recipe[/variant]>&mapseed=<requested>&hv=<version>` reloads the whole match setup (the same
  layout, retries and fallback included, and the same region seed, so chests and spawns agree). `…&mapseed=<loaded>` reloads
  the layout alone, in one attempt. `hv` is the generator version: a link from another version warns that the layout can
  differ. `?mapseed=` must be a whole number; empty or malformed values are ignored with a console warning (they used to
  become seed 0) and a value past 4294967295 wraps and says so (`src/world/replay.ts`).
- **Reproducibility:** recipe + variant + seed + `HAB_VERSION` (+ map size, 128) fully determine the layout. The
  generator is a pure function (named RNG streams `hab:<stage>`, detmath trig, no clock in the output); the vent cycle
  is a pure function of stage time. `mapChecksum` now also covers decks and fluid levels.
- **Fallback / error:** a seed that fails every attempt loads the recipe's first passing `fallbackSeeds` entry (each is
  tested to pass on its first attempt, the variants included) through the same validator, and the plaque says
  `map seed N → K (N rejected)`. If those fail too, no map is built: at the start of a run a dialog says which recipe and seed
  failed and why, and the title screen follows; a later region that fails does the same instead of freezing the run.

## Files

| Where | What |
| --- | --- |
| `src/world/habitat/types.ts` | Schemas: `HabitatRecipe`, `ModeGraph`, `BodyProfile`, `HabMeta` |
| `src/world/habitat/recipes.ts` | The two recipes (data), `findHabitat` |
| `src/world/habitat/mode.ts` | `CONTROL_POINT` mode graph; `profilesFor()` derives body profiles from rules and roster |
| `src/world/habitat/families.ts` | The shared geometry families (kernels) |
| `src/world/habitat/landforms.ts` | `gorge` and `crater` kernels: environment fields + route embedding |
| `src/world/habitat/dress.ts` | Surfaces, ruins, cover, vegetation by suitability, detail |
| `src/world/habitat/validate.ts` | Playability on the final collision (every gate below) |
| `src/world/habitat/index.ts` | `generateHabitat`: attempts, sealing, bounded repair, identity, fallback, metadata |
| `src/world/maps.ts` | Recipes ride the existing `rules.worldgen.locations` seam (`id` or `id:variant`); `findMapSource` resolves `?loc=` and the saved Map |
| `src/sim/world.ts`, `objectives.ts`, `enemies.ts`, `hazards.ts`, `cells.ts`, `player.ts`, `effects.ts` | Fluid levels, Hold on the contest, Raider flow field, vents, lava medium, deck-over-wall rescue |
| `src/render/tilestage.ts`, `tileart.ts`, `sky.ts`, `artdirection.ts`, `decor.ts`, `pixelfx.ts` | Per-tile water level and falls sheets; the `volcano` palette |
| `src/world/replay.ts` | What a load reports (`loadInfo`: plaque, console, replay and layout links), `?mapseed=` parsing, replay query → worldgen rules, the dialog text when no map can be made |
| `scripts/habstats.ts`, `habsheet.ts`, `habplay.ts`; `tools/habscenes.json` | Seed sweep, contact sheet, scripted play-through, browser captures |
| `scripts/habtac.ts`, `habgeom.ts`, `habcam.ts`, `habvent.ts`, `habtac-sum.mjs`; `docs/HABITAT_PLAYTEST.md`, `tests/habtac.test.ts`, `tools/habplayscenes.json` | Tactical Hold evaluation: real Hold, Raid party, squad and horde (both approaches, forced Raider routes, retreat, controls), static route / denial geometry, camera along an approach (read-only), vent warning reaction; the replayable human checklist and the seeds to keep |
| `scripts/habaudit.ts`, `scripts/lib/habfixtures.ts`; `docs/HABITAT_AUDIT.md`, `docs/habaudit/` | Generation and replay audit: fresh-process loads, layout comparison, variant claims, retry / fallback / failure fixtures, timing baseline (`baseline.json`) |
| `docs/HABITAT_STATES.md`, `scripts/habstate.ts`, `tests/habstate.test.ts` | Environment-state lifecycle (what changes in a match, what is fixed at load), the occupied-transition rules (vent field, river ice) and the static / live check for each transition |
| `tests/habitat.test.ts`, `tests/habaudit.test.ts` | Determinism, gates over seeds, per-profile reach, fixture rejection, states, sim seam, play-through; replay after a retry or fallback, retry exhaustion and the failure path, `?mapseed=` parsing, variant claims |

## Engine integration point

This is a single-player survivor (no teams, no server). The **objective** that fits both maps is the existing
**Hold** (stand within 5 m for 30 s; Raiders on the pad drain it). On habitat maps every objective is a Hold on the
generated contest floor, so the two "teams" are the trainer's squad (A, defends) and the wild horde (B, whose Raid
party leaves B's staging and walks a flow field to the point; the party is exempt from the 46 m despawn relocation while the Hold is active, because B's staging is 33-47 m from the point and it would otherwise be relocated onto a ring around the trainer: docs/HABITAT_PLAYTEST.md). Both sides get the same contract, so the topology also
serves a future two-team mode. Habitat maps set `gen.loc`, so every location rule applies (terrain line of sight,
drop navigation, entry anchors, decks).

## The two representations

**Recipe** (environment): landform kernel, medium (`water` / `lava`), anchors with provenance and lock, vegetation rule
(stand kinds, density, moisture band, clearings), props by role, surfaces and surface **variants** (same geometry,
different paint and plants), optional features with chances, compatible seams, seed freedoms, levels, art, states.

**Mode graph** (`CONTROL_POINT`, scenery-free): `spawnA → stageA → {A.direct, A.flank} → contest ← {B.direct, B.flank} ←
stageB ← spawnB`, `contest → exitA/exitB`. Approach edges carry width 5 m, headroom 2.9 m, grade 0.5, step 0.6 m,
rise, exposure (`screened` for flanks) and an approach group. A recipe decides what each edge is made of:

| | Shrine Gorge | Cinder Crater |
| --- | --- | --- |
| direct | rim lip path → switchback cut into the gorge wall → floor → **low wooden bridge** → landing pad → cut ramp onto the terrace | foot → **grounded switchback** cut into the flank → notch through the crest → forecourt |
| flank | deep rim-forest path (screened) → bench ramp cut into the wall → bench → **causeway at terrace height** onto the other end of the island | **dry cave**: mouth → tunnel → chamber → tunnel under the crest (**arch**: the crest walkway continues over it as a deck) → forecourt |
| contest | forecourt beside the ruined shrine on the island terrace | cooled forecourt between the lava lake and the breach, ringed by ruin stubs, altar beside it |
| return / exit | either approach reversed | either approach reversed; the **breach** is a grounded way out to the foot |
| hazard | the river: enterable, safe for Water types, 5 s to a knockout for anyone else (docs/HAZARDS.md); never on a required route; ice is an optional state | vent field at the end of an optional cave branch, visible exits; the lava lake: enterable, 3 s to a knockout (docs/HAZARDS.md), never on a required route |

## Geometry families (shared kernels)

`relief` (graded treads: switchbacks, bench ramps, cave rises are one kernel), `cliff` (level steps and benches),
`boulder` (indestructible rock spurs; boulders and slabs as props), `stand` (tree stands by suitability), `channel`
(channels and basins of a fluid with a level; water and lava differ only in medium), `chamber` (tunnels and rooms
carved from rock), `structure` (bridges, causeways, arches, plinths, ruin walls). Both recipes build from six of
them (all but `chamber`, which only the crater's caves use); the test measures this on generated maps. Every join records its ends, height, headroom and what passes under it.

Composition rules: fluids run source → outlet or declared sink, falls connect a reach to a receiving pool, levels never
rise downstream (gate `drainage`); routes, landings, the contest floor and kept sightlines are reserved before any
prop; stands grow where a patch field clears a density threshold, raised by moisture near water and suppressed near
lava; decisive sightline breaks are terrain (props can burn or break).

## Pipeline

1. **Landform** — relief, fluid, anchors (locked), mode nodes, approaches fitted with the families.
2. **Dress** — surfaces, landmark and ruins, cover, stands, understory, tall grass, reeds, vents.
3. **Seal** — walkable pockets outside the enemy space become rock or thicket; ground under a deck stays put; an
   optional crossing whose end was sealed is dropped.
4. **Validate** (below), then up to 4 rounds of **bounded repair**: *occlude* (a 2–3 tile rock spur across the
   sightline from a dominant perch, ≤ 3.2 m, never on locked, platform or tread space, ≥ 2 tiles from a tread) and
   *widen* (clear props within 2 tiles of an approach). Repairs never touch a locked anchor.
5. **Identity** — gorge: falls, terrace, forest, tall grass, both spurs, causeways; crater: lava, ≥ 2 arches, a
   reachable crest; both: the landmark beside the contest, drainage. Losing one rejects the attempt.
6. Up to 6 attempts (`mixSeed(seed, n)`), then the fallback seeds, then an error.

## Gates (all hard; on the final collision)

Navigation, clearance and sight are derived from the finished `ArenaMap` exactly as the sim reads it (`locgen/nav.ts`
mirrors `sim/world.ts`). Approaches are **baseline walking**: steps ≤ 0.6 m, no jump, no drop, symmetric (so the
route back is the same route). Clearance per node is the widest disc that fits at the tile centre or a corner within
continuous footing on the walker's layer (slopes are free; walls, water, faces, drops and slabs overhead bound it).

| Gate | Test (workbook id) |
| --- | --- |
| `reach:<state>` | from each staging to the contest and back, for every essential profile (PBL01, PBL02, PBL06) |
| `independent:<state>` | two approaches per side, ≥ 4 tiles apart outside the shared spawn funnel (12) and contest shoulder, none through a hazard or the other side's funnel; the failure names the bottleneck (PBL03, PBL05, PBL07) |
| `planned` | every planned approach is walkable as built within its own corridor (PBL10) |
| `perch` | no standable high node off the side's own routes and off the contest platform sees ≥ 50 % of **both** of a side's final approach segments **and** the point, measured with every destructible prop gone (R30, PBL08) |
| `counter` | every high position overlooking the contest is baseline-reachable from both sides or in view of the contest floor (PBL08) |
| `contest` | ≥ 60 % of the contest disc fits the largest essential body at the point's level (PBL06) |
| `spawns` | stagings ≥ 40 m apart and out of sight unless beyond twice the 30 m engagement range (PBL07) |
| `hazardExit` | every vent tile has safe ground within 4 tiles (the 1.5 s warning at a walk) (PBL04, PBL05) |
| `connected`, `playerOnly` | one strongly connected enemy space; no tile only the player can stand on |
| `joins` | bridge, causeway, ford and arch ends supported at their height; ≥ 2.9 m headroom under decks (R02) |
| `drainage` | every fluid tile drains to an outlet or sink without rising (R03) |

**Environment states** enumerated per recipe (PBL04): gorge `base`, `frozen` (all water is ice: adds edges; essential
routes must not need it), `stripped` (every destructible prop burnt or broken: the perch test runs here); crater
`base`, `venting` (vent tiles impassable), `stripped`. The vent cycle (10 s: 6 dormant, 1.5 warning with steam, 2.5
erupting: every 0.5 s a grounded actor in the field loses 2 % of its maximum HP, five ticks) is rules data (`rules.habitat.vent`). Which
states change in a match, what happens to whoever stands in them and the check behind each transition: docs/HABITAT_STATES.md.

## Roster assumptions (body profiles)

From `rules.player`, `rules.enemy.roles` and the roster (`profilesFor`). The sim gives every playable Pokémon the same
collision radius and step, so sprite height only moves the eyes.

| Profile | Radius | Step / climb | Eyes | Gated |
| --- | --- | --- | --- | --- |
| trainer (all 18 playable species, 0.9–1.77 m tall; jump and glide off; drops ≤ 4 m) | 0.55 m | 0.6 / 0.6 m | 0.7–1.42 m | yes |
| trainer-jump (ordinary jump, apex 1.84 m, any drop) | 0.55 m | 0.6 / 2.44 m | 0.7–1.42 m | only for the no-player-only-perch gate |
| wild-small (smallest ground wild Pokémon) | 0.36 m | 0.6 m | 0.5–0.9 m | yes |
| wild-elite (largest ground wild Pokémon at elite ×2) | 1.42 m | 0.6 m | 0.9–1.4 m | yes |
| boss (largest ground boss) | 1.8 m | 0.6 m | 1.2–2.5 m | reported (bosses arrive after objectives close) |

Treads are 5 tiles wide so the 2.84 m elite fits on diagonals. Swim, flight, glide and burrow add nothing essential:
flyers already ignore terrain; frozen water is the only extra-edge state and is optional by construction.

## Measurements

(30 seeds per recipe, `npx tsx scripts/habstats.ts all 30 1`; play-throughs `scripts/habplay.ts`; Node 22, Apple laptop. The timing and retry
baseline to compare later changes against, with the generator at version 2 on Node 24, is `docs/habaudit/baseline.json`, written by
`scripts/habaudit.ts`; `habstats.ts` times include an extra raw first attempt, so they read about twice as long.)

| | Shrine Gorge | Cinder Crater |
| --- | --- | --- |
| seeds accepted on the first attempt / accepted / by fallback / errors | 30 / 30 / 0 / 0 | 24 / 30 / 0 / 0 |
| rejected attempts by gate (all re-rolled successfully) | none | perch 4, planned 3, identity:arches 2 |
| generation p50 / p95 / max (with validation and repair) | 385 / 762 / 902 ms | 751 / 1799 / 2177 ms |
| distinct traversable layouts (shape signature) | 30 / 30 | 30 / 30 |
| dominant perches after repair | 0 | 0 |
| contest floor usable by the largest essential body (mean, min) | 0.97, 0.91 | 0.93, 0.78 |
| baseline travel time staging → point, A / B (mean) | 11.9 / 12.7 s | 11.9 / 11.9 s |
| first-contact skew (mean, max; review flag 10–15 %) | 7 %, 15.6 % | 1 %, 2.4 % |
| falls edges / vent tiles (mean) / farthest vent tile from safe ground | 6.8 / — / — | — / 13.9 / 2 tiles |
| play-through, geometry only (6 seeds × direct and flank) | 12 / 12 | 12 / 12 |
| play-through, Raid party live (6 seeds; raiders reached the point) | 6 / 6 | 6 / 6 |

Gorge skew reaches 15.6 % on one seed (just above the 10–15 % review flag): a review item for playtests, not a gate.
With every enemy live (`--enemies`) the scripted trainer, which never fights, is overrun before the Hold completes on
every seed tried; that run shows pressure arrives, not that the maps are fair.

## What used final geometry, and what needs people

**Checked on the final collision / in the real sim:** every gate above (navigation, clearance, sight, decks, fluids,
hazard states); `tests/habitat.test.ts`; `scripts/habplay.ts` drives the real player controller from spawn along each
side's approaches to the generated point, holds it to completion through the real objective system and walks back
(this run found and fixed a disagreement the graph missed: the player's wall rescue ignored decks over sealed ground);
`--raid` checks that the Raid party reaches the point along team B's routes; browser captures (`tools/habscenes.json`)
check the renderer (fluid levels, falls, lava, decks, palettes).

**Needs human (and, later, multiplayer) playtesting (PBL09, PBL11, PBL12):** whether the approaches are tactically
comparable (the sweep reports a travel-time skew, not fight quality), how the rims, crest and terrace actually play,
readability of the vent warning, camera comfort under the causeways and in the cave, encounter variety across seeds.
There is **no multiplayer** in this project: client agreement is covered only by determinism (same recipe, seed and
version give the same checksum and the vent phase is a function of time); no network authority exists to test.

## Limitations

- **Variety.** The crater's mirror flag adds almost no variety: the layout is mirror-symmetric (teams A and B are mirrored), so it has
  four effective orientations, and 24 of 435 seed pairs in a 30-seed batch repeat more than half of each other's route tiles. Its
  height profile, crossing count (4 arches) and hard-cover count barely vary by seed. The gorge varies more (docs/HABITAT_AUDIT.md §3).
- **Variants are paint only.** A variant may change palette, particles, tree and prop sprites (2×2 walls for 2×2 walls, platform for platform)
  and terrain ids whose footing is the same in every stage biome; `tests/habaudit.test.ts` keeps collision, navigation, footing and the
  accepted seed equal to the recipe's.
- Tile engine: one ground height plus one deck per tile. Caves are open-topped slots in rock with arches where a
  walkway crosses; no full ceilings. Ramps render as small ledges.
- River ice is a runtime state (Cold freezes a water tile for 12 s, Heat or the timer opens it): whoever is on it when it opens is in the
  water and the liquid exposure rule decides (docs/HAZARDS.md; with `rules.hazards.enabled: false`, the old rule: put on the nearest dry
  shore for 10 % of its maximum HP, docs/HABITAT_STATES.md). The crack cue is a sim event with the frost impact sound, no art yet.
- Lava is a fluid tile with a lava palette: enterable (3 s to a knockout, docs/HAZARDS.md), never freezes or conducts; it does not burn
  things beside it.
- The crater's rim crest is reached by one ramp per side; crest segments nobody can climb back onto are sealed as
  rock. The gorge's lower floor downstream is partly sealed where stands enclose it (scenery, not play space).
- The validator's independence test is a buffered two-path search, not an exact vertex cut; the fixtures in the test
  show it rejects a blocked and a shared approach.

## Next extensions the shared system supports

Each is a recipe plus, at most, a landform kernel; the families, mode graph, validator and sim seam stay as they are:
**forest cemetery** (stands + relief benches + ruin walls and plinths as grave rows; the spec's worked example 1),
**tropical lagoon** (channel/basin with a shore band, causeway and bridge crossings, falls into a receiving pool),
**snowy ruins** (the gorge's snow variant shows the surface swap; a frozen-lake state already exists), **tidal cave
with an always-dry gallery** (a tide state that floods a lower tunnel while an upper chamber gallery stays the
essential route; the state machine and `independent:<state>` gate are in place). Full underwater combat, variable
gravity and live topology changes need their own movement, aim and state contracts and their own tests; they are
separate prototypes.
