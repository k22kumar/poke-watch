# Habitat recipes: procedural match maps around a shared control point

`?loc=river-gorge&mapseed=3` (or Settings → World → Map / Map seed) builds every region from a **habitat recipe**: a
data-driven environment envelope (landform, medium, anchors, vegetation, landmarks) with a **mode graph** (two sides,
two approaches each, one contested point) embedded in it, then proved playable on the finished collision. Three recipes
ship and share the same generator, geometry families and rules:

| Recipe | `?loc=` | Variant | Built from (physical references, adapted) |
| --- | --- | --- | --- |
| **Shrine Gorge** | `river-gorge` | `river-gorge/snow` | Hoenn Route 119 (river, waterfall, tall grass), Ilex Forest (dense forest, small shrine) |
| **Cinder Crater** | `volcanic-ridge` | `volcanic-ridge/ash` | Mt. Chimney (crater, lava), Fiery Path (cave through the mountain), Firespit Island (cooled lava slopes) |
| **Shoal Grotto** | `tidal-cave` | `tidal-cave/glimmer` | Shoal Cave (Hoenn: a sea cave whose lower rooms flood and drain with the tide) |
| **Spear Sanctuary** | `spear-sanctuary` | `spear-sanctuary/snow` | Mt. Coronet (the mountain and its interior), Spear Pillar (summit colonnade, focal platform), Temple of Sinnoh (axial thresholds, stairs, focal platform) |
| **Memorial Ridge** | `forest-cemetery` | `forest-cemetery/hollow` | Old Cemetery (Galar: worn tombstones), Memorial Hill (Alola: an outdoor burial route), Eterna Forest (a forest approach to a dormant place); loose names `cemetery`, `memorial hill` |
| **Cascade Lagoon** | `tropical-lagoon` | `tropical-lagoon/dusk` | Lush Jungle (Alola: layered jungle), Brooklet Hill (Alola: a stream falling through pools), Loop Lagoon (Galar: a sheltered lagoon shore); loose names `lagoon`, `tropical`, `jungle` |

All three are **adaptations**: the official places supply landforms and relationships; every combination is labelled in
the recipe (`anchors[].provenance`: `canon`, `reinterpretation`, `original`; `adaptations[]` says why).

## Launching and replaying

- URL: `index.html?go=1&loc=river-gorge&mapseed=3`, `loc=volcanic-ridge`, `loc=river-gorge/snow`, `loc=volcano`,
  `loc=tidal-cave&mapseed=7`, `loc=shoal` (loose names work). `loc=meadow:river-gorge,badlands:volcanic-ridge` maps stage biomes as for Pokémon locations.
- Settings → World → **Map** (default rotation, any location or habitat and its variants) and **Map seed** (`-1` =
  derived from the run seed). Both persist and take effect on the next run.
- **Which one wins:** the URL beats the saved settings. `?loc=` names the map; failing that, `?world=authored` asks for
  handcrafted regions and ignores the saved Map; failing that, the saved Map applies, and with no Map the
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
  generator is a pure function (named RNG streams `hab:<stage>`, no clock in the output); its trig still calls `Math`
  (68 allow-listed sites in `tests/worldgen.test.ts`), so layouts are reproducible within one JS engine, and moving them
  to `core/detmath` is P2c, a `HAB_VERSION` bump (`docs/ROADMAP.md`); the vent cycle
  is a pure function of stage time. `mapChecksum` now also covers decks and fluid levels.
- **Fallback / error:** a seed that fails every attempt loads the recipe's first passing `fallbackSeeds` entry (each is
  tested to pass on its first attempt, the variants included) through the same validator, and the plaque says
  `map seed N → K (N rejected)`. If those fail too, no map is built: at the start of a run a dialog says which recipe and seed
  failed and why, and the title screen follows; a later region that fails does the same instead of freezing the run.

## Files

| Where | What |
| --- | --- |
| `src/world/habitat/types.ts` | Schemas: `HabitatRecipe`, `ModeGraph`, `BodyProfile`, `HabMeta` |
| `src/world/habitat/recipes.ts` | The three recipes (data), `findHabitat` |
| `src/world/habitat/mode.ts` | `CONTROL_POINT` mode graph; `profilesFor()` derives body profiles from rules and roster |
| `src/world/habitat/families.ts` | The shared geometry families (kernels), including `tidal()` (the floor a tidal fluid body covers at high water) |
| `src/world/habitat/landforms.ts` | `gorge`, `crater` and `shoal` kernels: environment fields + route embedding |
| `src/world/habitat/ruins.ts`, `sanctuary.ts`, `sanctuary-checks.ts` | The ruin kit (slab, block, pillar, colonnade, wall fragment, walkway, and the `gateway`, `colonnadeCourt` and `focalCourt` assemblies), the `sanctuary` kernel built from it, and the sanctuary's identity and gates (section "Sanctuary") |
| `src/world/habitat/dress.ts` | Surfaces, ruins, cover, vegetation by suitability, detail |
| `src/world/habitat/validate.ts` | Playability on the final collision (every gate below) |
| `src/world/habitat/index.ts` | `generateHabitat`: attempts, sealing, bounded repair, identity, fallback, metadata |
| `src/world/maps.ts` | Recipes ride the existing `rules.worldgen.locations` seam (`id` or `id:variant`); `findMapSource` resolves `?loc=` and the saved Map |
| `src/sim/world.ts`, `objectives.ts`, `enemies.ts`, `hazards.ts`, `cells.ts`, `player.ts`, `effects.ts` | Fluid levels, Hold on the contest, Raider flow field, vents, the tide (`World.setTide`, `tideSystem`), lava medium, deck-over-wall rescue |
| `src/render/tilestage.ts`, `tileart.ts`, `sky.ts`, `artdirection.ts`, `decor.ts`, `pixelfx.ts` | Per-tile water level and falls sheets; the `volcano` palette |
| `src/world/replay.ts` | What a load reports (`loadInfo`: plaque, console, replay and layout links), `?mapseed=` parsing, replay query → worldgen rules, the dialog text when no map can be made |
| `scripts/habstats.ts`, `habsheet.ts`, `habplay.ts`; `tools/habscenes.json` | Seed sweep, contact sheet, scripted play-through, browser captures |
| `scripts/habtac.ts`, `habgeom.ts`, `habcam.ts`, `habvent.ts`, `habtac-sum.mjs`; `docs/HABITAT_PLAYTEST.md`, `tests/habtac.test.ts`, `tools/habplayscenes.json` | Tactical Hold evaluation: real Hold, Raid party, squad and horde (both approaches, forced Raider routes, retreat, controls), static route / denial geometry, camera along an approach (read-only), vent warning reaction; the replayable human checklist and the seeds to keep |
| `scripts/habaudit.ts`, `scripts/lib/habfixtures.ts`; `docs/HABITAT_AUDIT.md`, `docs/habaudit/` | Generation and replay audit: fresh-process loads, layout comparison, variant claims, retry / fallback / failure fixtures, timing baseline (`baseline.json`) |
| `tools/sanctscenes.json` | Browser captures of the sanctuary (`node tools/cap.mjs <html> tools/sanctscenes.json <outdir>`; build to a private directory first) |
| `scripts/habsanct.ts`, `tests/habsanct.test.ts` | The sanctuary against Cinder Crater: entry angles, sightline lengths, use of high ground, measured on the final collision; the sanctuary's seeds, axis order in every orientation, variation, kit reuse in every orientation, and the comparison as assertions |
| `scripts/habtide.ts`, `tests/habtide.test.ts` | The tide on Shoal Grotto: static gates and routes per water, the live cycle, the Raiders' routes at low and high water, actors on the shortcut at the warning and the flood, swimmers, the Hold with the shortcut never open and across a flood (section "Tide") |
| `src/world/habitat/graves.ts`, `scripts/habgraves.ts`, `tests/graves.test.ts`, `tools/cemeteryscenes.json` | The grave marker family (`planPlot`, `placeMark`, `commitGraves`, heights bracketing the muzzles), Memorial Ridge's evidence (markers per class, lanes, watched shares, the accepted/retry result, an optional real-sim walk), its tests (determinism, replays, both approaches, small and tall muzzles, lanes, the watch gate with the walls removed, reuse on the gorge's rim) and browser captures (`node tools/cap.mjs <html> tools/cemeteryscenes.json <outdir>`; build to a private directory first) |
| `src/world/habitat/lagoon.ts`, `scripts/hablagoon.ts`, `tests/lagoon.test.ts`, `tools/lagoonscenes.json` | The `lagoon` kernel (catchment, cascade, pool, islet, lagoon, inlet, shore bands, both approaches, the sightline breaks); the route-geometry and exposure comparison of two recipes (`npx tsx scripts/hablagoon.ts tropical-lagoon,river-gorge 12 1`); the lagoon's gates, drainage, landings, bands, angles, exposure and play-through (section "Lagoon") |
| `docs/HABITAT_STATES.md`, `scripts/habstate.ts`, `tests/habstate.test.ts` | Environment-state lifecycle (what changes in a match, what is fixed at load), the occupied-transition rules (vent field, river ice) and the static / live check for each transition |
| `tests/habitat.test.ts`, `tests/habaudit.test.ts` | Determinism, gates over seeds, per-profile reach, fixture rejection, states, sim seam, play-through; replay after a retry or fallback, retry exhaustion and the failure path, `?mapseed=` parsing, variant claims |

## Engine integration point

This is a single-player survivor (no teams, no server). The **objective** that fits every habitat map is the existing
**Hold** (stand within 5 m for 30 s; Raiders on the pad drain it). On habitat maps every objective is a Hold on the
generated contest floor, so the two "teams" are the trainer's squad (A, defends) and the wild horde (B, whose Raid
party leaves B's staging and walks a flow field to the point; the party is exempt from the 46 m despawn relocation while the Hold is active, because B's staging is 33-47 m from the point and it would otherwise be relocated onto a ring around the trainer: docs/HABITAT_PLAYTEST.md). Both sides get the same contract, so the topology also
serves a future two-team mode. The Raiders' steering along that flow field (`World.goalDir`) never heads for a cheaper
neighbour that is up a face higher than a step (or a diagonal that is not a step through both side tiles): on the tidal
cave a causeway's landing sits on the lip of the hall, 3 m above Raiders walking the hall, and steering at it pinned them
to the wall for good. On the gorge and crater this changes the choice on roughly 100 of ~6 000 nodes per map (a creature
on the floor beside a rim or a 0.7 m ledge); drops are unchanged, Raid arrival times are within 0.1 s of before on every
seed tried except one gorge seed, where a group that used to stall arrives 1 s sooner. Habitat maps set `gen.loc`, so every location rule applies (terrain line of sight,
drop navigation, entry anchors, decks).

## The two representations

**Recipe** (environment): landform kernel, medium (`water` / `lava`), anchors with provenance and lock, vegetation rule
(stand kinds, density, moisture band, clearings), props by role, surfaces and surface **variants** (same geometry,
different paint and plants), optional features with chances, compatible seams, seed freedoms, levels, art, states.

**Mode graph** (`CONTROL_POINT`, scenery-free): `spawnA → stageA → {A.direct, A.flank} → contest ← {B.direct, B.flank} ←
stageB ← spawnB`, `contest → exitA/exitB`. Approach edges carry width 5 m, headroom 2.9 m, grade 0.5, step 0.6 m,
rise, exposure (`screened` for flanks) and an approach group. A recipe decides what each edge is made of:

| | Shrine Gorge | Cinder Crater | Shoal Grotto |
| --- | --- | --- | --- |
| direct | rim lip path → switchback cut into the gorge wall → floor → **low wooden bridge** → landing pad → cut ramp onto the terrace | foot → **grounded switchback** cut into the flank → notch through the crest → forecourt | **stable gallery**: round the hall's end, along the hall's far wall on the upper floor (a ledge with stalagmites and a rock spur as cover) → **causeway** over the hall (the hall passes under it, 3 m headroom) → landing → point from its own side |
| flank | deep rim-forest path (screened) → bench ramp cut into the wall → bench → **causeway at terrace height** onto the other end of the island | **dry cave**: mouth → tunnel → chamber → tunnel under the crest (**arch**: the crest walkway continues over it as a deck) → forecourt | **sheltered tunnel** through the massif, arcing away from the hall, arriving at the point from its far side |
| contest | forecourt beside the ruined shrine on the island terrace | cooled forecourt between the lava lake and the breach, ringed by ruin stubs, altar beside it | the upper floor above the lower chamber (3 m, above maximum tide 1 m), rock stubs round it, the Tidewatch Stone beside it |
| return / exit | either approach reversed | either approach reversed; the **breach** is a grounded way out to the foot | either approach reversed |
| hazard | the river: enterable, safe for Water types, 5 s to a knockout for anyone else (docs/HAZARDS.md); never on a required route; ice is an optional state | vent field at the end of an optional cave branch, visible exits; the lava lake: enterable, 3 s to a knockout (docs/HAZARDS.md), never on a required route | the **tide** (section "Tide"): the lower hall, chamber and ramp feet are dry at low water (the optional shortcut) and open water at high water; the sea inlet is water at every tide; never on a required route |

## Geometry families (shared kernels)

`relief` (graded treads: switchbacks, bench ramps, cave rises are one kernel), `cliff` (level steps and benches),
`boulder` (indestructible rock spurs; boulders and slabs as props), `stand` (tree stands by suitability), `channel`
(channels and basins of a fluid with a level; water and lava differ only in medium), `chamber` (tunnels and rooms
carved from rock), `structure` (bridges, causeways, arches, plinths, ruin walls). Every recipe builds from at least
six of them (the gorge uses all but `chamber`; the crater and the tidal cave use all seven); the test measures this on
generated maps. `tidal()` belongs to `channel`: from a fluid body it floods every floor tile the water reaches through
open ground below the tide's high level, and that mask is what the sim floods and the validator's `flooded` state tests. Every join records its ends, height, headroom and what passes under it.

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
   reachable crest; tidal cave: ≥ 150 tiles of tidal floor, the inlet, both causeways, a shortcut worth taking
   (`tide:shortcut`); all: the landmark beside the contest, drainage. Sanctuary: ≥ 150 / 300 / 350 open tiles on the threshold, forecourt and platform, ≥ 14 columns, ≥ 3 plinth blocks and ≥ 4 wall fragments, ≥ 60 gallery tiles on each side's flank approach, a surviving balcony (≥ 40 tiles), the tarn. Losing one rejects the attempt. A tidal recipe
   measures its tidal floor (`tidal()`) after tread smoothing and before dressing; nothing is dressed on it.
6. Up to 6 attempts (`mixSeed(seed, n)`), then the fallback seeds, then an error.

## Gates (all hard; on the final collision)

Physical sight shares the combat raycast. Tactical exposure samples ground cover at half-metre intervals and tests the entire ray against overhead decks. The four reference replays, player-height frames and bridge regression are in the [sight baseline](habitat-sight/README.md).

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
| `tide:dry` | tidal maps: the contest, both stagings and every planned approach stay off the tidal floor, the point above maximum tide |
| `tide:exit` | tidal maps, high water: every flooded tile is ≤ 11 m of swimming (8 directions, no corner cutting) from dry, connected ground ≤ 0.8 m above the surface (`TIDE_EXIT`: about 2 s for the slowest partner wading, ~40 % of its HP of the 5 s clock) |
| `tide:shortcut` | tidal maps, low water: each side's shortest route runs over the tidal floor and is ≥ 10 % shorter than its best route that avoids it |
| `tide:swim` | tidal maps, high water: a swimmer (Water type, or knowing Surf) still has a route through the flood from each staging to the point, entering and leaving by banks it can climb, shorter than the best dry route |
| `sanctuary:sequence` | sanctuary maps: foothill < threshold < forecourt < platform, each ≥ 2.4 m above the last, on one line; the Hold on the platform with the landmark within the contest radius + 6; each side's direct lane climbs threshold > forecourt > platform in that order |
| `sanctuary:entry` | sanctuary maps: each side's two approaches reach the court ≥ 40° apart in bearing, or ≥ 2.5 m apart in height, 26 tiles out |
| `sanctuary:exit` | sanctuary maps: the balcony (the strongest upper position) sees under 50 % of the gallery's doorway (its lane within 8 tiles of the door), and ≥ 1 balcony edge tile drops 2-4 m onto the platform (the quick exit) |
| `sanctuary:counter` | sanctuary maps: the balcony floor is reachable by baseline walking from both stagings and ≤ 34 tiles from the point, and half of the sampled court sees its edge |
| `marker:height` | cemetery maps: the grave classes bracket the roster's muzzle extremes (0.45 < 0.5 < 0.9 < 1.42 < 1.7 m); every marker's footprint carries its class height; none touches a tread or the platform; every class is present |
| `lane` | cemetery maps: the longest straight run through a plot, at the small and the tall muzzle, is ≤ 18 tiles (section "Cemetery") |
| `watch` | cemetery maps: a watcher on one of a side's approaches, from 16 m out, sees under 50 % of the other's final stretch at either muzzle: the second way to the monument stays unwatched |
| `shore` | lagoon maps: no standable open-shore tile (low ground within 9 tiles of the lagoon, off the routes and the islet) sees ≥ 50 % of **both** of a side's final approach segments at weapon range (30 m), with every destructible prop gone. Unlike `perch` it needs no height, and it does not need the point: a beach has none to give. The hits feed the same bounded repair as a perch (a rock spur across the sightline) |

**Environment states** enumerated per recipe (PBL04): gorge `base`, `frozen` (all water is ice: adds edges; essential
routes must not need it), `stripped` (every destructible prop burnt or broken: the perch test runs here); crater
`base`, `venting` (vent tiles impassable), `stripped`; tidal cave `base` (low water: the map as built), `flooded` (every
tidal tile is water at the high level: `reach:flooded` and `independent:flooded` prove both approaches per side with
the shortcut gone), `stripped`. The vent cycle (10 s: 6 dormant, 1.5 warning with steam, 2.5
erupting: every 0.5 s a grounded actor in the field loses 2 % of its maximum HP, five ticks) is rules data (`rules.habitat.vent`). Which
states change in a match, what happens to whoever stands in them and the check behind each transition: docs/HABITAT_STATES.md. Memorial Ridge has `base` and `stripped` only (no transition besides props burning); its markers are indestructible, so both states keep every sightline built on them. Cascade Lagoon has `base`, `frozen` (the lagoon, pool and arms freeze: walkable ice adds edges, the essential routes never need it) and `stripped` (the perch and the shore sightline are measured here); nothing else about it changes in a match.

## Tide (Shoal Grotto)

**Layout.** A sea cave in a coastal massif on two connected floors. The **sea inlet** (the coastal mouth) runs in from the
map edge to the **lower chamber** (floor 0 m); a **lower hall** crosses the cave through the chamber from each side's
staging, down a ramp at each end; an **up-ramp** climbs from the chamber's middle to the **point** on the upper floor (3 m).
Each side's two required approaches stay on the upper floor: the **stable gallery** and the **sheltered tunnel** (table
above). Exit ramps climb out of the hall onto the gallery (one up the far wall either side of the causeway, one up the near
wall onto the gallery's landing), and a **beach** on each side of the inlet climbs from the water to the gallery's end, so
the waterline is never far from anyone at any tide. A seeded quarter turn and mirror orient it; team B's numbers are drawn
apart from team A's, so the sides are not mirror images.

**Water levels** (recipe `tide`, one floor): low water −0.5 m, high water 1.0 m. `tidal()` marks every tile the sea reaches
through open ground below 0.95 m: the hall, the chamber, the lower part of every ramp, the beach toes and the inlet itself
(578-686 tiles over 30 seeds). The tidal floor is painted as the bank surface, so the tide line reads at low water too.

**Cycle** (`rules.habitat.tide`, a pure function of the sim tick like the vents): `period` 90 s, low water for the first
`low` 44 s, `warn` 8 s of warning (still dry), then high water to 90 s. `low = period` keeps it low; `low = warn = 0` keeps it
high. The harness and tests use both.

**What changes, and what does not.** At the flood every tidal tile becomes open water at 1.0 m in this run's own copy of
the map (`World.setTide`; the cached map is never touched and every run starts at low water); navigation closes over it
and both flow fields are rebuilt, so the Raiders' route to the point goes round by the dry approaches. At the ebb the floor
is dry again and the hall reopens. Nothing else moves: the chamber, the gallery, the tunnel, decks and walls are the same
at every tide. With `rules.hazards.enabled: false` there is no tide (water would be a wall).

**Whoever is on the floor at the flood** is left where it stood, in the water, and the liquid exposure rule decides
(docs/HAZARDS.md): a Water type or anything knowing Surf swims; anyone else wades at ×0.75, loses 20 % of its maximum HP per
second and is knocked out at 5 s unless it reaches a bank. After a knockout the next Pokémon comes in on the last dry ground
the trainer stood on that **never floods** (a tidal tile is never recorded as safe ground: dry when the trainer stood on
it, it can be under water when the next one arrives).

**Cues.** Warning: a `tide`/`warn` sim event (banner "The tide is rising! The lower hall floods in 8 s · only Water types
and Surf swim there", the water impact sound) and, for the whole warning, the floor that will flood pulses blue on the
top decal layer (seen through bodies, like a telegraph). Flood: banner "High water", a water sheet over the flooded floor
at the surface the sim uses. Ebb: banner "Low water". Entering the water raises the existing "Deep water! … within 5 s"
banner.

**Measured** (`npx tsx scripts/habtide.ts 1 2 7`; 30-seed sweep `npx tsx scripts/habstats.ts tidal-cave 30 1`):

| | |
| --- | --- |
| seeds accepted on the first attempt / distinct layouts | 30 / 30, 30 / 30; generation p50 / p95 / max 86 / 155 / 217 ms |
| low-water shortcut vs best dry route (tiles, per side) | saves 18-24 % (seed 1: A 68 vs 88, B 66 vs 86; seed 7: A 64 vs 84, B 68 vs 90) |
| high water, shortest walking route on the tidal floor | 0 tiles, every seed |
| swimmer through the flood vs dry route (staging A → point, in the sim) | Water type 8.1-9.7 s vs 9.9-10.4 s; non-Water with Surf 7.6-9.1 s vs 9.2-9.7 s; no exposure, no damage |
| Raid party on the tidal floor (raider-steps), Hold active | low water 38-44 %, first raider on the point 9.3-10.4 s; high water 0, first raider 11.6-13.1 s, 0 water hits |
| farthest flooded tile from a bank | 9.5-10.5 m (limit 11) |
| slowest non-swimmer (bulbasaur, 7.2 m/s) on that tile at the warning | off the tidal floor in 1.4 s of the 8 s warning, no water damage |
| the same Pokémon still there at the flood | out on a bank in 1.9-2.0 s, 37-40 % of its HP lost, still in the fight |
| one that stays | knocked out at 5 s; the next Pokémon comes in on ground that never floods |
| a Raider on the shortcut 0.65 s before the flood | in the water, out on a bank 2.2-2.7 s later, on the point 7-13 s after the flood by a dry approach |
| Hold with the tide always high (shortcut never opens) | both approaches: reach 9.9-10.9 s, raiders on the point, retreat 11-16 s, 0 environment hits on the trainer |
| Hold started 5 s before a flood | 4 raiders caught on the floor, all 4 reach the point after it by the dry approaches |

## Sanctuary (Spear Sanctuary)

**Layout.** One processional **axis** (a canonical column; the seeded quarter turn and mirror keep its order) with tiers along it, each
a tier higher than the last and separated from the next by solid rock or a 3 m face. A **foothill** plain at 0 m with a tarn between
the two stagings; a **threshold** terrace at 3 m (closed to the south by rock); the **forecourt** at 6 m with rows of columns either
side of its lane, a side court off it; the **focal platform** at 9 m with a solid plinth (the landmark stands on its south face) and the
Hold's court tangent to it; and a **balcony** on a rock shoulder beside the platform at 11.7-12.2 m, the strongest upper position. The
spec's worked example 5 (§ "Legendary sanctuary integrated into a mountain") is the plan: an external switchback or a gallery that joins
the terrace from a different side, a short drop from a ruined balcony as the quick exit, an upper occluding wall between the balcony's
firing edge and the gallery's entry, columns spaced so both short and long positions matter, the axis kept while the rock profile and
the side court vary.

| | direct | flank |
| --- | --- | --- |
| route | foothill → **external switchback** cut into the massif's flank (two legs and a hairpin) → along the threshold terrace → the **threshold stair** on the axis between two pylons → the forecourt's lane between the column rows → the **platform stair** → the court | foothill → a **dry bedrock gallery**: mouth at the foot of the massif, a climb of 9 m inside the rock (grade 0.38-0.42), across to a **door** in the platform's flank → the court |
| arrives | from the south by the axis, climbing into the court (the lane is 2.5 m below it 18 tiles out) | from the side or from behind (the side with the balcony comes in at the rear, behind the plinth); level with the court |
| sees | open ground below it (the threshold, then the forecourt); the court sees about 40 % of its last 60 m | rock on both sides; the balcony sees under half of its doorway |

Both sides' direct lanes climb the same stairs (the axis is the way up, so it is one lane the Raiders and the squad both use); the
two galleries come in from opposite flanks. Each side draws its own numbers, A then B, so the plan is not a mirror image.

**What varies by seed** (the axis never does): the shoulder's side, length, height and the stair up to it; the side court's side, depth,
width and where the wall's opening is; each gallery's door along the platform's flank (the shoulder's side comes in at the rear);
the switchback's legs, the gallery's grade and mouth; tier depths and half widths; the plinth's size; the column rhythm and fallen places;
the stagings; the tarn; the balustrade's openings. 100 of 100 seeds are distinct layouts.

**The ruin kit** (`ruins.ts`) is the reusable landmark assembly. Pieces are terrain, never props, so they hold in every environment
state: `slab` (a tier, optionally the platform mask), `block` (a solid plinth, skirted), `pillar` and `colonnade` (rows at a rhythm
with fallen places), `wall` (fragments along a polyline with gaps, 4-connected), `walkway` (a graded or flat tread: a stair, a balcony
ledge). Three assemblies compose them: `gateway` (two pylons and wall fragments at a stair's head), `colonnadeCourt` (rows either side
of a lane), `focalCourt` (a platform's plinth, spear columns, flank columns, a balustrade laid from one side so it is unbroken there).
They take canonical coordinates and an axis; `tests/habsanct.test.ts` builds the same assembly on another recipe's context in all eight
orientations and compares footprints. A shrine terrace, a tomb forecourt or a ring of standing stones calls the same assemblies with its
own numbers. Nothing in the kit or the kernel names a place (the recipe names them).

**Gates and identity.** The four `sanctuary:*` gates (Gates, above) and the identity checks are in `sanctuary-checks.ts`; the shared
gates (`reach`, `independent`, `planned`, `perch`, `counter`, `contest`, `drainage`) all apply. The shoulder is the only high ground the
`perch` and `counter` gates see, and the repair loop's occluding spurs were not needed on any seed measured.

**Measured** (`npx tsx scripts/habstats.ts spear-sanctuary 100 1`; `scripts/habplay.ts spear-sanctuary 6 1 [--raid]`; `scripts/habsanct.ts`;
`scripts/habtac.ts spear-sanctuary 2,5,7 --stage 1`):

| | |
| --- | --- |
| seeds accepted on the first attempt / accepted / distinct layouts | 99 / 100, 100 / 100, 100 / 100 (seed 52: `sanctuary:exit` at 50 %, retry accepted); no fallback |
| generation p50 / p95 / max (habstats, with its extra raw attempt) | 208 / 233 / 352 ms |
| contest floor usable by the largest essential body (mean, min) | 0.93, 0.86 |
| baseline travel time staging → point, A / B (mean, range) | 15.2 / 15.2 s (13.8-16.8); skew mean 7 %, max 12.7 % (30 seeds) |
| entry bearings: a side's two approaches apart (range); the two sides' direct lanes apart | 76-148°; 0-8° (they share the stairs) |
| balcony: doorway seen (mean, max); edge tiles with a 2-4 m drop; walk from the point; court sees its edge | 0.13-0.16, 0.44; 1-4; 16-33 tiles; 85-100 % |
| play-through, geometry only (6 seeds × direct and flank) | 12 / 12 |
| play-through, Raid party live (trainer invulnerable) | 12 / 12: a Raider reached the point |
| tactical Hold at the crater's stage (stage 1, seeds 2, 5, 7 × direct / flank, squad of three), calm | 6 / 6 done in 30.8-38.3 s, charge drained ≤ 0.03, never off the pad; Raiders on the pad 17.7-20.0 s after the Hold opens (the crater: 6 / 6, 32.8-34.7 s, ≤ 0.03; Raiders 11.7-15.3 s) |
| the same with the director's horde live | 4 / 6 done (39-57 s), 2 failed (the crater: 4 / 6, 43-53 s, 2 failed) |
| the same at the sanctuary's own stage (frost, stage 2; 12 runs) | 7 done (41-59 s), 3 failed, 2 wiped under a live horde: that stage's enemies are tougher than the badlands', not the map |

**How it plays differently from Cinder Crater** (`scripts/habsanct.ts spear-sanctuary volcanic-ridge 8 1`, final collision, no sim steps):

| | Spear Sanctuary | Cinder Crater |
| --- | --- | --- |
| entry: the two sides' direct lanes arrive apart by | 3° (one bearing, one stair) | 126° (opposite sides) |
| entry: a side's own two approaches apart (mean, min) | 105°, 75° | 62°, 27° |
| arrival: the direct lane 18 tiles out, against the point | 2.5 m below: it climbs into the court | level (it crosses the crater floor) |
| sightlines from the point (64 rays at 0.9 m): mean / p90 / short (< 10 m) / long (> 25 m) | 17.0 m / 30.9 m / 30 % / 15 % | 21.2 m / 35.9 m / 17 % / 17 % |
| how much of each approach's last 60 m the point sees | 40 % | 67 % |
| high ground (≥ 2.4 m up, seeing the point, within 24 m): tiles / sectors of 16 / reachable from both stagings | 43 / 2.3 / 8 of 8 | 83 / 7.8 / 6 of 8 |

The sanctuary's high ground is one shoulder on one side, with a stair from the court to it; the crater's is a ring of crest all
round. The sanctuary's court is broken ground (plinth, columns, wall fragments) with one long lane down the axis; the crater's is an open
bowl. `tests/habsanct.test.ts` asserts each of these differences.

## Cemetery (Memorial Ridge)

**Layout.** An old burial precinct on a dry ridge in wild woodland, built from the shared families (`relief`, `cliff`, `structure`,
`boulder`, `stand`; there is no fluid and no tunnel, so no `channel` or `chamber`: five of the seven). In a frame where team A is
west: the woodland floor (0 m); a near-circular **lower terrace** (1.2 m, 58-62 × 52-56 tiles, a wobbling rim) carrying the
precinct; two **raised terraces** (2.1 m, 0.9 m above it, so a node on one is never the 1.5 m a perch needs over a route on the
other); the **forecourt** at the middle (the point's platform, 9 m radius, flat lower-terrace floor) with a **memorial** (`statue`,
the recipe's landmark) beside the point at the angle farthest from every tread. The plan is point-symmetric (team B is A turned a
half turn about the point) and each side draws its own numbers, so B is not A's mirror image; a seeded quarter turn and mirror
orient it.

| | lower path | upper path |
| --- | --- | --- |
| route | woodland → a ramp straight onto the lower terrace's rim → along the lower wall → the forecourt gate from the west-south-west | woodland → a ramp straight onto a raised terrace's far end → along its north contour behind a plot group → a ramp down → the forecourt gate from the north-west |
| made of | `relief` (ramps), `cliff` (terraces), `structure` (rim wall) | the same, 0.9 m higher for the last stretch |
| the two gates | 78-98° apart on the forecourt wall (about 88° on average) | |

**Ramps are short steep cuts across the rim** (grade 0.4, found where the ramp's axis meets the rim the relief drew), and the last 6
tiles of the woodland leg run along the ramp's axis. A first version used gentle ramps (grade 0.12 over ten tiles): they leave a long
band beside them where the bank is 0.5-0.7 m, the 0.6 m step limit, so the validator's shortest path cut across the ramp's side at
0.54 m and the scripted trainer, aiming a tile off, wedged on the 0.64 m neighbour for 40 s. The woodland leg also clears 2 tiles either
side of its tread (the validator lets a route stray 2 tiles off it), every wall stays 2.5 tiles clear of any tread, and a wall piece under
3 tiles is taken down as rubble (a stub pinched a corridor on one seed). With those, 60 of 60 walks and 32 of 32 Raid-party runs have zero stalls.

**Walls** (`families.ts brokenWall`: indestructible wall tiles, 1.3 m, laid as pieces and gaps, 4-connected so no ray slips through
a diagonal):
- a **broken perimeter** round the lower terrace's rim, a gap wherever a route crosses it and 0-3 seeded openings;
- a **broken forecourt wall** just outside the platform (radius 10.3 m), a gap at each of the four gates;
- **wing walls** from the forecourt wall to the edge of the precinct along the bisector of each pair of neighbouring gates: each
  route's last stretch runs in its own wedge, and a wing is the only thing that blocks a watcher on a raised terrace, whose eye is
  0.9 m higher than any marker (removing the walls between the forecourt wall and the rim, 51 tiles on seed 3, makes all four directions 100 % watched: `tests/graves.test.ts`).

**Plots** (two or three, seeded). Each is an arc concentric with the forecourt, in a sector between a wing and a gate, at its own
radius (staggered: each sits a step further in or out than the last), three rows deep. A plot that comes out under five markers is
taken back and the next sector tried. Each plot shears **opposite** to its nearest neighbour (R21: opposing angles at each plot
seam), and a stele stands beyond each end of the arc.

### The grave marker family (`src/world/habitat/graves.ts`)

One module, no recipe. A marker is a footprint (1 or 2 tiles wide), a height class and a lean; a plot lays markers on a lattice along a
contour. `planPlot` chooses them and reserves their footprints (`ctx.marked`), `commitGraves` draws each as one `grave` prop whose
`top` is the platform height the sim reads, `placeMark` adds a lone marker by the same rules, `dropPlot` takes a plot back.

| Class | Height | Against the roster's muzzles (`BodyProfile.eye`: 0.5 m smallest wild Pokémon, 1.42 m tallest partner) |
| --- | --- | --- |
| kerb | 0.45 m | under every muzzle: stops no ray; walkable (≤ the 0.6 m step) |
| headstone | 0.9 m | stops the small muzzle, the tall muzzle fires over it; blocks walking |
| stele | 1.7 m | over every muzzle: stops both |

| Rule | |
| --- | --- |
| configurable | rows, columns, pitch (3-3.6), row gap (3-3.4), shear angle (0.28-0.55 rad), wave (0.2-0.45: alternate markers kink off the row line so the alley between two rows is never straight), jitter, skip chance, class mix, double-slab chance, lean chance; a recipe supplies them as `freedoms` and `graves` |
| spacing | ≥ 2 clear tiles between any two markers and any wall piece (centres ≥ 3 apart); never a one-tile gap |
| placement | only flat, open ground (floor, terrace, shelf, bank), one height under the footprint; never on a tread, a ramp, a route's reserved margin, the contest platform, a hazard, a deck or fluid; `tread` tiles clear of reserved space |
| lean | -1, 0, 1: which way the stone settled. Cosmetic by design (the collision is the tile); stored on the prop and in the checksum |
| immutable | `PROP_MATERIALS.grave` has integrity 0: the stripped state keeps every marker, so a sightline built on markers holds in every state |
| every class | a map is rejected (`identity:plots` / `markers`) unless it has ≥ 2 plots of ≥ 4 markers and ≥ 10 in all; where a seed's draw left a class out, one marker of the commonest class is retyped |

The prop kind `grave` (`tiles.ts`) carries `top` and `lean` per instance (`ArenaProp.top`, `.lean`; `ArenaBuilder.prop` takes
`top`, `w`, `lean`); `render/tileart.ts` paints a sprite per class × width × lean at 16 texels per metre, so the height on screen is the
height the collision uses.

### Sightline gates (`validate.ts`, run when a map has markers)

| Gate | Test |
| --- | --- |
| `marker:height` | the three tops bracket the roster's muzzles (kerb < smallest muzzle < headstone < tallest muzzle < stele); every footprint on the built map carries its class height; no marker touches a tread or the platform; every class is present |
| `lane` | the longest straight run through a plot (from every open tile within `PLOT_ZONE` = 1.8 tiles of a marker, 16 directions, at the small and the tall muzzle, ending at a wall, a rise over the ray, the platform or where it leaves the zone) is ≤ `LANE` = ranged reach (13 m) + 2 × 1.8 m zone margin + 1.4 = 18 tiles. A longer lane lets one end of a row fire down it from beyond return range (spec T26: "a firing grid with one dominant end") |
| `watch` | in the stripped state, a watcher on a side's first approach sees under 50 % of the other approach's final 14 nodes, at either muzzle, and the other way round: the second way to the monument stays unwatched |

**The gate zone.** `watch` judges a route from 16 m out (`contest.r + PLATFORM + SHOULDER` = 5 + 5 + 6), not inside. The forecourt is
open by design, so a body standing in a gate sees through the court and out of the neighbouring gate. For two gates about 90° apart the
chord between points the same distance out enters the forecourt wall only inside about 15 m from the point; beyond that it passes
outside the wall (and the wings), so from 16 m out it cannot thread both gates. Inside that radius a body is in the fight for the
point, not on an approach. In the first layout, with the two gates 108° apart, most seeds failed `watch` until the gates moved closer
and the zone was set.

**What the sim does.** Every shot leaves at +0.7 m whatever the shooter's height (`sim/effects.ts`; the roster gives every partner one
collision radius and sprite height only moves the eyes), so in the sim a headstone stops every player shot through its tile and a kerb
stops none; the Raiders' ranged sight runs chest (+0.9 m) to chest (+0.6 m) and stops at a headstone too. The 1.42 m muzzle is the
validator's design-time extreme (`BodyProfile.eye`), kept so a taller partner or a sim that raises shots does not find every
headstone a wall. `tests/graves.test.ts` casts the same two rays (small and tall muzzle) through `sightAbs` over a flat fixture of one marker per class and through `World.sight` over a built map.

**Measured** (`npx tsx scripts/habgraves.ts 1:30 --play`; tests `tests/graves.test.ts`; `scripts/habplay.ts forest-cemetery 30 [--raid]`):

| | |
| --- | --- |
| seeds accepted on the first attempt / by retry / by fallback | 30 / 0 / 0 over seeds 1-30; 59 of 60 over seeds 1-60 (seed 56 is re-rolled on `lane`) |
| generation (validation and repair), mean | 169 ms (150-264 ms) |
| audit (`scripts/habaudit.ts`, entry in `docs/habaudit/baseline.json`) | four fresh Node processes load seeds 3 and 7 (base and `hollow`) to the same checksum, geometry, navigation and match state; batch of 30: 30 first attempts, p50 161 ms, p95 171 ms |
| plots / markers (kerbs, headstones, steles) | 2-3 plots, 11-21 markers (1-9 / 4-12 / 1-6) |
| longest straight lane through a plot, small / tall muzzle | 13.5-17.5 / 13.5-17.5 tiles (limit 18) |
| worst share of the other approach seen from a watcher | 0.29 (limit 0.5); 0.00 on 29 of 30 seeds |
| perches | 0 on every seed |
| baseline travel staging → point, A / B | 9.9-11.0 s / 9.7-11.0 s; skew ≤ 8 % |
| play-through, geometry only (30 seeds × direct and flank; trainer reaches the point in 7.9-10.9 s) | 60 / 60, 0 stalls |
| play-through, Raid party live (16 seeds × both routes) | 32 / 32, 0 stalls (first Raider on the point 8.3-10.5 s) |
| tactical Hold, horde and squad live (`scripts/habtac.ts forest-cemetery 3,5,7,11 --route both`, both Raid routes) | trainer on the point in 7.7-10.7 s (gorge: 9.4-13.9 s), 4 Raiders on the pad at 8.1-12 s, every Hold completed. One run in the sample (seed 3, run seed 1) took 28.6 s and 42.6 s: a wave on the staging pinned the scripted trainer; run seeds 2-4 of the same map take 8.7-10.7 s |

### Reusing the family

`tests/graves.test.ts` lays a plot on the Shrine Gorge's rim with the same call a recipe makes:

```ts
const plot = planPlot(g, rng, { contour: [[x, y], [x + 16, y]], rows: 3, cols: 5, pitch: 3.3, rowGap: 3.1, start: 0, angle: 0.4, wave: 0.3,
  jitter: 0.2, skip: 0.1, mix: { kerb: 0.3, stone: 0.55, stele: 0.15 }, wide: 0.2, lean: 0.5, tread: 1 });
write(g); commitGraves(g);        // markers are props over the written map
```

and gets markers on flat rim ground, clear of the gorge's routes, at the same three heights. A recipe adds `graves` and its lattice
`freedoms`, its kernel calls `planPlot` after its routes and walls are laid (so the family sees reserved space), and the validator
runs the three gates whenever `generateHabitat` hands it markers.

## Lagoon (Cascade Lagoon)

**Layout.** A tropical island coast, drawn once in a canonical frame (north = jungle, south = sea) and turned and mirrored by seed.
A stream rises at the north edge, crosses a **jungle terrace** (2.5 m) and leaves it over a short **cascade** (a 2.75 m fall off the
terrace's south face) into a **plunge pool**. The pool's outflow runs south, splits round a **sandy islet** that carries the point on a
raised terrace, rejoins and widens into a sheltered **lagoon** (two wings on a main body), which drains through a **barrier inlet** to the
map's south edge: the outlet. Low ground (0.4 m) rings the lagoon; a **bluff** (a tongue of the terrace) follows each arm's outer bank down
to the islet. Team A holds the west shore, team B the east, 40-55 m from the point (inside the 33-47 m range the Raid pin was written for
and past it, so the pin does its work: section "Engine integration point"), and the sides are drawn apart, so they are not mirror images.

**Bands, from the water inland** (heights above the lagoon, which stands at -0.5 m):

| Band | Height | Made of | What grows |
| --- | --- | --- | --- |
| lagoon shelf | water | the shallow rim of the lagoon: **scenery** (lilies on about a tenth of the shore water tiles); no route and no gate depends on it, and a Water type can swim it under the ordinary liquid rules (docs/HAZARDS.md) | water lilies |
| dry beach | 0.25-0.45 m, 3-4.5 tiles | sand | nothing but low cover (rocks, driftwood) |
| backshore | 0.4 m | grass and scrub, out to 14 tiles from the water (`vegetation.dry`: low ground beside open water grows no stands) | scrub, flowers, tall grass |
| raised bank | 1.3 m | the shore route's berm, the bridge deck and the islet's apron: one height, so the bridge ends and its deck agree | none |
| jungle | 0.4 m inland, 2.5 m on the terrace and the bluffs | stands by suitability, density 1.5 (the gorge's is 0.6), thickened and without clearings within 9 tiles of a flank approach (`vegetation.canopy`) | round and broadleaf trees, understory, thicket at the map border |

**The inland-to-shore seam** is one surface: the low ground (beach, backshore, jungle fringe) has no step between neighbours above
0.6 m (the beach rises 0.05 m per tile; `tests/lagoon.test.ts`), the sand meets grass, the water, the raised bank or the bluff's face and
nothing else, and the two ways across it are the bank's ramp and the bluff's: both walked as built in every state.

Stands never stand on a reserved tile: every approach tile is open ground and no stand's footprint touches one (`tests/lagoon.test.ts`);
the flank's canopy path keeps no margin, so the stand closes in to the tread's edge and the route is walked between trees.

**The two approaches** (each side; the point is on the islet's terrace, 2.5 m up):

| | Direct: the shore bank | Flank: the inland causeway |
| --- | --- | --- |
| route | out of staging along the lagoon's north beach, up a long gentle ramp onto a **raised bank** (a 1.3 m berm, 5 wide, about a metre above the sand on either side, so nobody leaves it sideways), **low bridge** over the arm (deck 1.3 m, the water 1.8 m below), onto the islet's apron, **cut ramp** up the terrace | out of staging to the bluff's outer face, **ramp** cut into it (2.1 m at 0.4 m per tile), a **canopy path** that swings up into the jungle's middle, back down to the arm's bank, **causeway** at terrace height (3 m above the arm) onto the islet's north edge |
| arrives | from the south-west or south-east, up the islet's apron | from the north-west or north-east, along the terrace |
| exposure | beside open water for ~63 % of its length, watched from across the lagoon; the beach and backshore are clear out to 14 tiles | beside water ~22 %; between stands, under the bluff's cover |
| bends with the seed | the lagoon's bank (the wings' sag), the crossing's latitude | the canopy edge, the crossing's latitude, the path's swing |

The two arrive 43-76° apart in bearing from the point (seeds 1-8, measured 12 m out; the test asks for 40°). Everything is dry: the bridge keeps a culvert and the causeway is a deck,
so the stream flows on beneath both, and the validator never lets a route enter water.

**Sightline breaks (boulder family: terrain, so they hold with every prop gone).** A **karst tower** across each bluff's south shoulder
between the crossings (+2.4 m, 3.2-4 wide, 8-10.5 long from the arm's bank inward) hides the shore bridge from the canopy path and the
causeway's head, and the other way round. **Beach stacks** (two per side: one at the arm's mouth, one a few tiles off the shore route)
break the open shore's long lines. The `shore` gate is the check: from every standable shore tile, in the stripped state, at weapon
range, no tile sees half of both final stretches. A long open shore sightline exists on this map (89 m dry to dry, across the water,
against the gorge's 63 m) but it cannot lock both approaches: the strongest lock measured on a shore tile is 13 % of the weaker approach
(30 seeds: mean 13 %, worst 43 %). The bank's final stretch is a metre above the sand, so the terrace (1.2 m higher) is not a `perch`:
the perch test finds nothing to repair on any seed.

**Seed variety.** The inlet (two bends), the bank curvature (the wings' sag, -4 to +6 tiles), the lagoon's size, the cascade's latitude,
the canopy edge (phase and amplitude), the crossings' latitudes (B drawn apart from A), the bluff's width and length, the stream's meander
and the islet's size all come from the seed. 30 seeds give 30 distinct traversable layouts.

**Measured** (`npx tsx scripts/habstats.ts tropical-lagoon 30 1`; `npx tsx scripts/hablagoon.ts tropical-lagoon,river-gorge 12 1`):

| | Cascade Lagoon | Shrine Gorge |
| --- | --- | --- |
| seeds accepted on the first attempt / by fallback / errors | 30 / 0 / 0 (298 of the first 300 seeds on the first attempt) | 30 / 0 / 0 |
| generation p50 / p95 / max (with validation and repair; `habstats` reads about twice as long: `habaudit` batch 139 / 294 / 381 ms) | 275 / 562 / 650 ms | 385 / 762 / 902 ms |
| repairs per seed (beyond sealing pockets; 30 seeds) | 0-3, mean 0.3 | 0-12, mean 0.9 |
| route length, direct / flank | 58 / 73 m | 87 / 135 m |
| bend (length / straight line), direct / flank | 1.24 / 1.54 | 2.19 / 3.39 |
| climb along the route, direct / flank | 2.1 / 2.1 m | 3.1 / 0.1 m |
| water within 5 tiles of the route, direct / flank | 63 % / 22 % | 20 % / 9 % |
| cover within 6 tiles (share of the compass), direct / flank | 0.46 / 0.38 | 0.40 / 0.21 |
| open (share of rays clear for 15 m), direct / flank | 0.34 / 0.27 | 0.31 / 0.60 |
| gap in `open` between a side's two approaches | 0.09 | 0.29 |
| point sees of the route's last 40 m, direct / flank | 40 % / 45 % | 35 % / 48 % |
| longest dry-to-dry open line on the low ground | 89 m | 63 m |
| travel time staging → point (trainer, mean) / skew | 8.4 s / 11 % (max 25 %) | 11.9 s / 7 % (max 15.6 %) |
| play-through, geometry only / Raid party live (6 seeds, both routes) | 12 / 12, 12 / 12 | 12 / 12, 6 / 6 |

**What differs from Shrine Gorge, and what does not.** Route geometry changes: the lagoon's routes are shorter (58 / 73 m against 87 /
135 m), straighter (bend 1.2-1.5 against 2.2-3.4), and have no switchback or rim walk: the climb is two ramps of 1-2 m. In the gorge each
side's direct route goes down a 6 m wall by a switchback and its flank runs the rim and a bench; in the lagoon one route runs along a raised
bank beside open water and the other over a bluff. Exposure changes in kind: the bank is walked beside water (63 % of its length, three times the gorge's), under the eyes of
an 89 m open line across the lagoon (the gorge's longest is 63 m); the canopy path is walked between stands, with the bluff's face and
the karst tower between it and the water. **Not** a larger difference in plain ray openness: the gorge's rim path is far more open than its floor route
(`open` 0.60 against 0.31), the lagoon's two are 0.34 and 0.27, because the bank's inland side is backshore and tree line, and its
water side is broken by stacks on purpose. Browser frames (`tools/lagoonscenes.json`) show the sand, stone and turquoise palette (`tropic`: `BIOME_ART`, `SKY`) and the canopy path;
whether the bank reads as a bank at chase-camera height (the lens collapses against the bluff's face at one point of it) needs a person.

## Roster assumptions (body profiles)

**Frozen (2026-11-19, `docs/hero-shooter-pivot.md` §8 step 3).** The sizes, eyes and trainer speed below are constants (`VALIDATED_PROFILES` in `src/world/habitat/mode.ts`), the numbers every shipped map and `docs/habaudit/baseline.json` were accepted against. `profilesFor` no longer reads the roster or the spawn pools, so importing species or deleting the pools can't move a layout. Step, climb and the jump apex still come from `rules.player`. `tests/habitat.test.ts` pins the numbers and fails when the playable roster outgrows the trainer (`measuredProfileInputs`). Changing a constant needs a `HAB_VERSION` bump and a new baseline. The rest of this section records how the numbers were measured when they were accepted.

From `rules.player`, `rules.size`, `rules.enemy.roles` and the spawn pools (`profilesFor`, as it was). Bodies are movement footprints from the size classes (`body`, docs/SIZING.md "Footprint"), the circle the sim collides with (`World.moveBody`), not the hurtboxes. The species counted are the ones a spawn pool can field (`spawnableSpecies`, src/rules/spawning.ts: region presets, every named preset, every map source's own pool), not the whole roster. Eyes and muzzles stay on the sprite-derived heights, because the sim fires every partner's shots from a fixed +0.8 m.

| Profile | Radius | Step / climb | Eyes | Gated |
| --- | --- | --- | --- | --- |
| trainer (all 18 playable species; jump and glide off; drops ≤ 4 m) | 0.88 m (the widest partner footprint, an Extra Large partner) | 0.6 / 0.6 m | 0.7–1.42 m | yes |
| trainer-jump (ordinary jump, apex 1.84 m, any drop) | 0.88 m | 0.6 / 2.44 m | 0.7–1.42 m | only for the no-player-only-perch gate |
| wild-small (narrowest ground footprint a pool fields) | 0.30 m | 0.6 m | 0.5–0.9 m | yes |
| wild-elite (the widest ground body the survivor director spawned, an elite at ×2; frozen at the validated 1.42 m floor at pivot step 3, and no spawner scales a body since the elite role went) | 1.42 m | 0.6 m | 0.9–1.4 m | yes |
| boss (widest ground boss footprint, capped at `rules.size.bodyCap`) | 0.95 m | 0.6 m | 1.2–2.5 m | reported (bosses arrive after objectives close) |

When the size classes landed (2026-11), the trainer body grew from 0.55 m to 0.72 m. `scripts/habaudit.ts` was re-run: every accepted seed, layout checksum, geometry hash and route metric for all six recipes was identical, so `HAB_VERSION` stayed 2.

When the profiles moved to movement footprints (2026-11-15: trainer 0.72 → 0.88 m, wild-small 0.29 → 0.30 m, boss 1.8 → 0.95 m), every recipe was regenerated for seeds 1–30: 0 of 180 accepted attempts or layouts changed, so `HAB_VERSION` stayed 2. `scripts/navwalk.ts habitat` then drives real walkers of every class and the trainer (Small and Extra Large) from team B's staging and the spawn to the contest on the built map.

The widest ordinary wild body is Onix's Extra Large 0.93 m, which is under the 1.42 m floor. The 1.42 m floor is the headroom every shipped map and `docs/habaudit/baseline.json` was accepted against, so roster edits cannot quietly loosen the approaches. Raising it needs a `HAB_VERSION` bump and a new baseline. Treads are 5 tiles wide so the 2.84 m elite the profile was validated with fits on diagonals.

Swim, flight, glide and burrow add nothing essential: flyers already ignore terrain, and frozen water is the only extra-edge state and is optional by construction.

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
- **Tide: creatures do not plan through water.** A Water-type Raider (or any creature) never chooses the flooded hall:
  navigation closes over water at high water for every creature, as on the other maps (docs/HAZARDS.md "Known gaps"). The
  swimmer's shortcut is the squad's (any Water type or Surf user, which the trainer steers). A creature already in the
  water at the flood heads for the bank picked on entry; a Water-type creature there is safe and walks out the same way.
- **Tide art.** The flood is a decal sheet over the floor and the pulse during the warning; the inlet's water mesh keeps its
  low-water height under the sheet (the renderer builds water geometry once). No splash or rising-water animation.
- **Tide numbers** (90 s cycle, 8 s warning, 1.5 m of rise) are placeholders chosen to make both waters appear in a match
  and to give the slowest partner time to leave; the Hold (30 s) straddles a flood in about a third of offers.
- **Tidal cave variety.** The cave's plan is fixed (hall, chamber, gallery, tunnel); seeds move it, so within one of the
  8 orientations 28 of 51 seed pairs share more than half their route tiles (audit batch, `docs/habaudit/baseline.json`),
  more than the crater (11 / 47). The cave also fills one band of the map; the rest is rock.
- **Stalagmites** grow only on the gallery's outer ledge; the cave's other open floor (platform, stagings) is kept clear.

### Sanctuary limitations

- **One lane for both sides' direct approaches.** The two direct approaches share the threshold stair, the forecourt lane and the
  platform stair, so the Raid party and the squad meet on the axis; only the galleries are independent per side. That is the recipe's
  point (one processional way) and the validator counts each side's pair separately, but it is a stair choke, not a two-front fight.
- **Longer walks than the crater** (15 s against 12 s for the trainer, the Raid party on the pad 18-20 s after the Hold opens against
  12-15 s): the way up is three tiers. Skew is low (7 %). Seed 52 shows the exit gate's margin: the balcony sees exactly 50 % of the doorway where the route
  leaves the screened strip; the retry handles it.
- **The tier faces are 3 m open edges** (the forecourt over the threshold, the platform over the forecourt). Knockback or a Raider's
  charge can drop someone one tier; the route back is a stair (7-8 tiles). The balustrade on the platform's front edge is unbroken
  over the balcony's reach and has openings on the far side.
- **The switchback and the gallery are rock cuts** (walls both sides), so the exposure is the open sky and the long way up, not a ledge
  over a drop. A 3 m face is climbed by no jump (apex 1.84 m + step 0.6 m), so nobody skips a stair.
- **Ruins are terrain, not props** (indestructible rock columns and wall pieces): they stay in the stripped state, and a column
  is one tile, so the colonnade is a rhythm of 1 m pillars, not carved capitals. Nothing is destructible except the dressing's rocks.
- **Stage fit.** `biomeFit` is `frost`, `dusk`: `scripts/habtac.ts` runs it at stage 2 by default, a harder stage than the crater's;
  compare with `--stage 1`.

- **Cemetery: the second way in is judged from 16 m out.** Inside the forecourt's gate zone two gates see each other through the open
  court by design; the validator treats that stretch as the fight for the point (section "Cemetery").
- **Cemetery: lanes are measured through plots, not across the whole precinct.** An open precinct has long rays by nature; the lane gate
  targets the rows' alleys (spec T26), and the wing walls and the `watch` gate keep the approaches apart. The limit (18 tiles) includes the
  plot zone's 1.8 m margin at both ends, so it is the Raiders' ranged reach plus about 2 m of a body's own length, not a fixed range.
- **Cemetery: markers are heights, not shapes.** Three classes at 0.45, 0.9 and 1.7 m, one tile tall in footprint (1 or 2 wide); a marker's
  lean is cosmetic. The sim fires every shot at +0.7 m, so a headstone is full cover in play and the tall-muzzle ray is a design-time
  extreme (section "Cemetery", "What the sim does").
- **Cemetery: variety is the lowest of the recipes.** The plan is half-turn symmetric (team B is A turned a half turn), so a 180° rotation
  lays the routes on themselves. Audit batch, seeds 1-30 (`docs/habaudit/baseline.json`): the median share of route tiles two seeds have in
  common is 0.27 (the other recipes 0.06-0.13); 61 of 435 pairs share more than half and 2 more than 80 %; pairs of different rotation share 0.26 on
  average (33 of 323 above 50 %), where the others share 0.06. Plot grouping, wall openings, path bends and markers do differ per seed
  (`tests/graves.test.ts`).
- **Cemetery: the plan is fixed.** Four gates about 90° apart, four wings, a lower and a raised terrace per side, 2-3 plots; seeds move
  plots, wall openings, path bends and the quarter turn. No crypt (an overlay recipe: a `chamber` below the forecourt, its exit outside the
  grave rows, spec R21) and no fluid, so the recipe builds from five of the seven families (`tests/habitat.test.ts` asks every recipe for five and every recipe with a fluid anchor for `channel`).
- **Cemetery: large bodies do not walk between markers.** Two clear tiles is a trainer's width and not the 2.84 m elite's; plots are cover, not
  routes, and the tread and the gates are wider.

- **Lagoon: the plan is fixed.** Stream, pool, islet, lagoon and inlet run in one order; seeds move and bend them (and the turn and
  mirror give eight orientations) but the two crossings are always on the islet's south and north faces. Within one orientation 21 of
  51 seed pairs share more than half their route tiles (audit batch; the gorge 7, the cave 28, the sanctuary 25), 43 of 435 pairs in all. The islet is the gorge's
  island in a wider, lower, wetter place: its approaches share a topology with the gorge's, and what changes is the relief, the
  medium round them and the exposure (above).
- **Lagoon: the shelf is scenery, the sea is not a place.** No tide (Shoal Grotto owns the tide: `tidal()` would flood this lagoon's
  barrier beach too, and the recipe would need its own freeboard), no reef and no sand spit: a walkable shelf would be a route the
  gates would have to prove, and the dry shelf in the spec (T17) is left to a later recipe. The inlet ends against the map border;
  the sea beyond it is not drawn.
- **Lagoon: first-attempt acceptance is 99 %, not 100 %.** 298 of seeds 1-300 pass on their first attempt; seed 136 fails
  `independent` / `planned` (a crossing whose strip lands on a stack) and seed 161 `shore` (a pocket of beach between a bluff's foot and
  the bank that the repair cannot reach); each re-rolls to another attempt (docs/HABITAT_AUDIT.md). The fallback seeds 1, 2 and 3 pass on
  their first attempt, both surfaces.
- **Lagoon: the scripted trainer walks into loose rocks.** `seedBodies` (sim/bodies.ts) scatters loose rocks anywhere walkable, the bank
  included; `scripts/habplay.ts` steers straight at its waypoints and can stall on one for a long time (lagoon seed 6, direct, 50 s). A
  player walks round it.

## Next extensions the shared system supports

Each is a recipe plus, at most, a landform kernel; the families, mode graph, validator and sim seam stay as they are:
**crypt** (the cemetery's lower crypt spur as an overlay recipe: `chamber` below the forecourt, daylight openings at both exits, spec worked example 1; Memorial Ridge shipped the outdoor precinct, section "Cemetery"),
**tidal lagoon** (the lagoon of section "Lagoon" with `tide` set: the barrier beach and the apron flood; `tidal()` and the `flooded` state already work for it; the shipped lagoon is tideless),
**snowy ruins** (the gorge's snow variant shows the surface swap; a frozen-lake state already exists). The tidal cave
shipped as Shoal Grotto (section "Tide"); `tidal()`, `World.setTide`, `tideSystem` and the `flooded` state work for any
recipe that sets `tide`, such as a tidal lagoon. Full underwater combat, variable
gravity and live topology changes need their own movement, aim and state contracts and their own tests; they are
separate prototypes.
