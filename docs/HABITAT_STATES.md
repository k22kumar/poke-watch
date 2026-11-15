# Habitat environment states: what changes in a match, and what happens to whoever is in the way

Scope: Shrine Gorge (`river-gorge`), Cinder Crater (`volcanic-ridge`) and Shoal Grotto (`tidal-cave`, the tide:
section 7), docs/HABITATS.md. Cascade Lagoon (`tropical-lagoon`) adds no state of its own: its water, bank, bridge and terrace are fixed at load, the lagoon, pool and arms can freeze like any water (Cold, 12 s; the gorge's rule, section 2), and its props can burn and break (`tropical-lagoon.hold-stripped`, section 4). This page says which states
change while a match runs and which are fixed when the map loads, what each change does to an actor standing in the
affected space, which defects that turned up (all fixed), and which check covers each transition. Everything below was
measured in the running sim; `npx tsx scripts/habstate.ts all 2` prints the same measurements for a seed.

**Rules source.** The "task 00" hazard document is not in the repository. The entry and exposure rules used are the ones
the repo's own spec states (docs/Pokemon_Environment_Interaction_Specification.md, "Occupied transition policy" and
"Hazard access and physical support"): hazard entry is separate from AI route choice; contact is 3D; a state that removes
support must warn, leave a legal exit for anyone on it and never strand a body; required travel never forces hazard damage;
optional risk may cost HP. If task 00 says something different, the numbers to change are `rules.habitat` (below) and the
two functions named in the table.

## 1. Which states change during a match

| State | Set when | Changes in play? | By what |
| --- | --- | --- | --- |
| Layout (recipe + seed + `HAB_VERSION`), terrain, heights, walls, decks, water and lava *levels*, falls, stagings, the Hold, **the vent field's tiles**, which medium the map holds | map load | **no** | never |
| **Vent phase** (dormant, warn, active) | derived | **yes, on a fixed cycle** | the sim tick (`rules.habitat.vent`: 10 s; warn from 6.0 s, erupts 7.5 s, quiet 10.0 s) |
| **River ice** (a water tile frozen / open) | open at load | **yes, any time** | Cold on water (Frost moves, a Frost Hexer's lob) freezes it for 12 s; Heat melts it at once; the 12 s timer thaws it; Cold on ice resets the timer |
| Props (trees, rocks burn or break; `stripped` in the validator) | intact at load | **yes** | fire, force; the sim stops at its cover-loss cap (`rules.surfaces.coverLossCap`, 40 % of cover), the validator tests the worse case of all of it gone |
| Tile conditions (wet, burning grass, ash, rubble) | none at load | yes | the existing cell rules; not habitat-specific |
| Lava | liquid at load | **no**: Cold on it makes steam, never ice; Heat does nothing | (`cells.ts`) |
| **Tide** (Shoal Grotto only: the tidal floor dry / flooded, the sea's level) | low water at load | **yes, on a fixed cycle** | the sim tick (`rules.habitat.tide`: 90 s; warning from 44 s, high water 52-90 s); section 7 |
| Water level elsewhere, falls, a second vent field appearing, a bridge breaking | — | **no such transition exists** | nothing in the game does it |

So the Gorge's river **can** freeze and thaw during play (it is a runtime state, not a load-time one), and the Crater's only
timed hazard is the vent cycle. Both are covered live below. "River frozen when the match starts" is not something a
match can begin with; it is checked anyway as an extreme (all water frozen at tick 0) for support, spawning and routes.

## 2. What happens to an actor (as implemented)

**Vent field** (`src/sim/hazards.ts`). The phase is whole sim steps (`ventPhase`, `ventTick`), so no boundary depends on float
rounding. Dormant: safe. Warn (1.5 s): steam on every third vent tile, and a hostile telegraph ring on **every** vent tile for the whole warning (the steam alone was not visible from a chase camera: docs/HABITAT_PLAYTEST.md). Active (2.5 s): steam on every vent tile;
at the onset step and every 0.5 s after it (5 ticks) every grounded actor whose centre is in a vent tile loses `vent.pct` = 2 %
of its **maximum HP** (10 % per eruption). One rule for the trainer and every creature. Not affected: anything more than
0.3 m above the ground (3D contact), flyers, Fire types (as for a burning tile), a dashing trainer (dash i-frames). Not read:
the trainer's attack, buffs, crits, hooks, the combat RNG, hit i-frames or Guard. Bosses and alphas take `vent.bossMult` of it.
Late entry: an actor in the field at the onset step takes that tick, however late it walked in; one that has left before it
takes nothing; there is no grace and no skipped tick. After the last tick the field is safe at once (steam lingers 2 s, cosmetic).
Required travel: the validator keeps every essential route out of the field (`hazardExit` ≤ 4 tiles to safe ground, `reach` and
`independent` in the `venting` state), measured here at ≥ 8 tiles of margin for all three body profiles on seeds 1-9.

> **Since liquid exposure (docs/HAZARDS.md):** water can be entered, so the thaw no longer moves anyone. The actor on the tile is in
> the water where it stood and the exposure rule decides (a Water type swims, anyone else has 5 s to reach a shore); only bodies are
> still put ashore. The checks below (`gorge.*-ice*`, `gorge.many-occupants`) now assert that: not moved, swimming or exposed,
> out on dry ground afterwards, no dunk. The rescue described next is the rule with `rules.hazards.enabled: false`.

**River ice** (`src/sim/cells.ts`, `settleMelted`; `World.shore` in `src/sim/world.ts`). Ice is support, 0.25 m above the water
(`ICE_LIFT`). Two seconds before it opens (`ice.crack`) one `cell`/`crack` event goes out (a cue: the sound is the frost impact;
there is no art for it yet). When it opens (timer, or Heat at once, no cue) whatever is still on the tile is put on the
**nearest dry open shore** with room for its body and 48 tiles of connected ground, preferring the level it stood on (ice on the
upper reach never drops anyone down the falls), and loses `ice.dunk` = 10 % of its maximum HP, never its last HP. This covers
the trainer (velocity cleared), grounded creatures and bodies (the Transport egg); hovering and flying things are above the
water and stay. A refreeze at the crack re-arms the 12 s timer and nobody is moved. Someone on the bank beside the ice is never
touched by it. Ice has no hazard of its own: standing on it costs nothing, it is slippery (`footing`).

## 3. Defects found, and fixed

| # | Found | Fix |
| --- | --- | --- |
| 1 | **Ice that thawed under an actor left it stuck in the water tile for good**: no movement (even inside the tile), no damage, no recovery. Reproduced with the trainer: position unchanged after 5 s of input. Creatures and the Transport egg the same. Same on the classic regions' rivers. | `settleMelted` + `World.shore`: ashore on the nearest dry shore, one dunk, queue drained at the cell pass for both thaw paths |
| 2 | **The Raid's goal flow routed through the vent field.** Counted from every open tile outside it: 4 to 385 of ~6 100 starts per seed (seed 5, a 4-tile field, 385) walked through the vents on the way to the Hold, so a Raider's *required* travel could cost HP | the field is valued above any way round (`pen` 4096) in `goalDir`'s flow and corner-cutting its tiles is refused; a creature already inside walks out. 0 crossings on the 10 seeds with a field (1-9, 11) |
| 3 | **The trainer took vent damage at half the rate of a creature**: `damagePlayer` gives 0.55 s of i-frames and the tick is 0.5 s, so every second tick was swallowed (3 hits per eruption, not 5), and Guard, Flash Fire and hit i-frames from any other source changed it | environment damage path: no i-frames or Guard, dash still immune |
| 4 | **Vent damage to creatures was a trainer move**: `damageEnemy` scaled it by the trainer's attack, STAB, crit roll (drawing from the combat RNG), damage hooks and weather, added it to `stats.damageDealt`, and lost to Flash Fire. A 62 HP Raider lost 14 % per tick (70 % per eruption) against the trainer's 2 % (spec: "keep structure work independent of hero critical hits, damage buffs") | one rule, 2 % of maximum HP per tick for everyone, no combat RNG; test asserts a buffed trainer takes the same and the stream is untouched |
| 5 | **Phase boundaries and the onset tick depended on float rounding of the stage clock** (`6.017 s`, `7.517 s`; whether tick 1 landed on the onset step was luck of the accumulated sum) | whole sim steps: 6.000, 7.500, 10.000 s, ticks at 450, 480, 510, 540, 570 of every 600 |
| 6 | The validator's `frozen` state put ice at the water level; the sim lifts it 0.25 m, so seam steps were judged on different heights | `ICE_LIFT` shared by `World.height`, `refreshNav` and `stateMap`; all fixed seeds still pass every gate |
| 7 | (tool) `scripts/habplay.ts`'s driver cut across a vent corner when it steered at a node four ahead | it now refuses a line through a vent tile |

Replay hashes of the existing configurations (`scripts/checksum.ts all`) are identical before and after. Habitat runs differ
only where a vent or a thaw acts, as intended. `rules.habitat.vent.dmg` (6) became `pct` (0.02).

## 4. What each check covers

`static` = derived from the map or a rule, no sim steps. `live` = the simulation is stepped through the transition with
real actors. Measurements are for seed 2 of each recipe (`tests/habstate.test.ts` also runs Crater seeds 1, 5, 9 and Gorge
seed 6; seed 10 has no vent branch and is checked as such). Every id below is in `scripts/habstate.ts`.

| Check | Transition / situation | |
| --- | --- | --- |
| `static.required-travel-clear` | both stagings reach the Hold and return for the trainer, the smallest and the largest essential body with every vent tile ≥ 8 tiles from the route; gates `hazardExit` (2 tiles), `reach:venting`, `independent:venting` | static |
| `static.field-on-ground` | no vent tile under a deck or in lava; every standable one ≤ 4 tiles from safe ground | static |
| `crater.timeline` | dormant → warn → active → dormant twice; trainer on the boundary and a raider deeper in: warn from 6.00 s, erupts 7.50 s, quiet 10.00 s; 5 hits each per eruption at 7.50, 8.00, 8.50, 9.00, 9.50 s, 2 % of maximum HP each, none outside the window | live |
| `crater.footprint` | a probe on each of the 25 vent tiles took 5 hits; 127 open tiles within 3 tiles outside took 0; steam only on vent tiles (a third of them in the warning, all of them in the eruption) | live |
| `crater.late-entry` | by real walking: in 0.88 s before the eruption → 5 hits; 0.08 s before → 5; 0.02 s after → 4; 0.78 s after → 3; leaving 0.20 s before it → 0; leaving 0.08 s after it → 1 | live |
| `crater.escape` | the slowest playable Pokémon (squirtle, 7.2 m/s) from the deepest tile (2 deep) when the steam starts is out after 0.28 s, 1.22 s before the eruption, 0 hits | live |
| `crater.raider-in-field` | a raider in the deepest tile with the Hold active walks the flow field out in 0.48 s: 0 ticks if put there at the start of the warning, 1 of 5 if put there 0.33 s before the eruption; 20 m closer to the point 20 s later | live |
| `crater.contact` | 1.2 m up: no hit; dashing: no hit; with hit i-frames: still hit; a Fire type: no hit | live |
| `crater.hold-through-eruptions`, `crater.hold-geometry` | spawn → Hold → retreat by both approaches, 20 s of eruption, Raid party live (raiders reach the point) and with nothing else on the map (Hold held to completion): 0 vent hits to the trainer, 0 to a Raider on its way to the Hold | live |
| `crater.flow-field` | "path updates": the flow field is built once and steers round the field in every phase; from every second open tile outside it 0 routes enter the field, from all 25 vent tiles 0 fail to walk out | live |
| `volcanic-ridge.hold-stripped` | 28 props burnt and broken first (same match; cover stops at the 40 % cap), vents cycling: the same two runs, 0 environment hits on the trainer or a Raider on its way | live |
| `static.no-field` (seed 10) | a seed without the optional vent branch never reads the cycle | static |
| `gorge.shore-everywhere` | every one of 1 011 water tiles has a dry open shore for the trainer and the largest wild body (≤ 11.3 m away), none on water or ice | static |
| `gorge.frozen-at-load` | the whole river frozen at tick 0: spawn, both stagings and the Hold dry, open and unblocked; walkable area 11 389 → 12 400 tiles (ice only adds); the Raid's goal flow exists | static |
| `gorge.player-on-ice-timer` | trainer walks onto lower-reach ice; crack cue 2.00 s before the thaw; thaw 11.87 s after (12 s timer); put 1.0 m away on dry ground, −10.0 % HP, then walks on | live |
| `gorge.player-on-ice-heat` | Heat melts the ice under the trainer: no cue, ashore, −10 %, walks on | live |
| `gorge.raider-on-ice` | a Raider on the ice when it thaws: ashore, −10 %, walks on towards the trainer | live |
| `gorge.upper-reach-ice` | trainer on ice above the falls (ice at 6.00 m): ashore 2.2 m away at the same level, not dropped to the lower reach | live |
| `gorge.refreeze-occupied` | Cold again at the crack: timer re-armed, thaw ~11 s later, one dunk, ashore | live |
| `gorge.seam-bystander` | trainer on the bank beside ice that forms and thaws: position, footing and HP untouched | live |
| `gorge.many-occupants` | the whole river thaws at once under the trainer and 9 Raiders spread over both reaches: all ashore, all alive, one dunk each | live |
| `gorge.hold-frozen-stripped` | river frozen and the props stripped in the same match, then spawn → Hold → retreat by both approaches (both reach, Hold held, Raiders reach the point, 0 hits on the trainer or a Raider on its way) | live |
| `river-gorge.hold-stripped` | 428 props burnt and broken, river running: the same | live |
| `tropical-lagoon.hold-stripped` | 929 props burnt and broken (seed 2; cover stops at the 40 % cap), stream and lagoon running: the same two runs, 0 environment hits on the trainer or a Raider on its way (`npx tsx scripts/habstate.ts lagoon 2`) | live |
| `tests/habstate.test.ts` unit checks | vent phase in whole steps and the five tick steps; buffed trainer, combat RNG and i-frames; `shore` is deterministic; an empty thaw moves nobody; classic regions get the same ice rule and an empty thaw drains the queue | live / static |

Movement in every check is walking only: no jump, glide, dash or swim (the only optional abilities the checks touch are
the ones asserted to be *immune* in `crater.contact`). Body sizes: trainer r 0.55, smallest wild r 0.36, largest wild r 1.42
for the static travel and shore checks; the live ones use the trainer and a Rattata-class raider.

Static coverage (the validator's gates over fixed seeds, `tests/habitat.test.ts`) and live coverage are reported apart by the
`coverage` field on every check; a transition with only a static check is marked so above (`frozen-at-load`,
`shore-everywhere`, the travel margin).

## 5. Reproducible manual tests (what the harness cannot judge)

Whether the cues read, not whether the rules hold. In a browser build (`npm run dev`):

1. **Vent warning and eruption.** `index.html?go=1&loc=volcanic-ridge&mapseed=2&calm=1&stageTime=5`. `pokewatch.ctx.world.hab.hazard`
   lists the vent tiles; walk to the field's edge (`&tp=<tile x>,<tile y>` teleports, tile coordinates). At 6 s steam rises on
   some tiles, at 7.5 s the whole field erupts. Check: can you tell the field's edge and the countdown from the steam alone, and
   leave in the warning from the far side? Record whether the first third-of-tiles steam reads as the whole footprint.
2. **Ice and the crack cue.** `?go=1&loc=river-gorge&mapseed=2&calm=1`. No starting move freezes water, so freeze a tile from the
   console, the same call the Cold reaction makes: find a water tile `k` beside a bank, then
   `pokewatch.ctx.world.cells.set(k, 3, 12)` (state 3 = frozen, 12 s) and walk onto it. Watch the crack sound two seconds before
   it opens, then the landing on the shore and the 10 % cost. Check: is two seconds enough to leave, and is the cue audible with
   no art on the tile?
3. **Browser capture of the cue states** is not wired (`tools/habscenes.json` captures the maps, not the transitions); adding
   scenes for warn / active steam and cracked ice is the next visual step.

## 6. Not covered, and why

- How the cues look and sound to a person (section 5). The cell `crack` event exists and reuses the frost impact sound; no tile
  art or distinct sound was added.
- Tuning: `vent.pct` (10 % per eruption, a 25 % duty cycle), `ice.dunk` (10 %), `ice.crack` (2 s) are placeholders chosen to make
  the cost visible and never lethal in one event; the playtests that would set them are the ones in docs/HABITATS.md.
- Multi-client agreement: there is none in this project. The vent phase and the shore are pure functions of the tick and the map,
  and the new tests assert determinism.
- Bosses in a vent field (`bossMult` 0.3) and Fire-typed or flying trainers are exempt/immune by the rules above; only the
  trainer's Fire-type exemption and the 3D rule are asserted.
- Decks over a vent field: none occur (checked on seeds 1-9); the damage rule reads ground height, so a walker on a deck above
  would be safe, by design.

## 7. The tide (Shoal Grotto)

The tidal cave's lower hall, chamber and ramp feet are dry floor at low water and open water at high water (the full
description, layout and numbers are in docs/HABITATS.md "Tide"). The phase is a pure function of the sim tick (`tidePhase`,
`tideIn` in `src/sim/hazards.ts`): low water, `warn` s of warning, high water, then low again at the end of the `period`.

**What happens to an actor (as implemented).** Warning: nothing changes on the ground; a `tide` warn event (banner, sound)
and a pulsing blue overlay on the floor that will flood, on the top decal layer. Flood (`World.setTide(true)`): every
tidal tile becomes water at the high level in this run's own copy of the map, navigation closes over it, both flow fields
are rebuilt. Nobody is moved: an actor on the floor is in the water where it stood (a swimmer at the surface) and the liquid
exposure rule decides, the same rule as a thawed river tile (docs/HAZARDS.md): a Water type or a Pokémon that knows Surf is
safe; anyone else has 5 s to climb out onto a bank (≤ 0.8 m above the surface). A creature heads for the shore picked on
entry, then rejoins its route. Ebb (`setTide(false)`): the floor is dry again under whoever is swimming over it (it settles
onto the floor), the hall reopens. The last safe ground the trainer's next Pokémon comes back to is never a tidal tile.
Ice on a flooded tile is the river's rule (Cold freezes it); at the ebb the tile is floor again and its cell state thaws to
wet harmlessly (nobody is put ashore: the ice test needs water under it). That last case is read from the code
(`cells.ts`), not exercised by a check.

| Check (`scripts/habtide.ts`, asserted by `tests/habtide.test.ts`, seeds 1, 2, 7) | Transition / situation | |
| --- | --- | --- |
| `static.gates`, `static.routes` | both waters on the final collision: every gate incl. `reach:flooded`, `independent:flooded`, `tide:*`; low-water shortest route over the tidal floor, high-water shortest route off it | static |
| `live.cycle` | warn 44.000 s, flood 52.000 s, ebb 90.000 s, twice; tidal floor all open → none → all; stagings and point open at both | live |
| `live.raid-flow`, `live.raid-party` | the Raiders' flow field and the real Raid party: on the shortcut at low water, never on it at high water, on the point in both | live |
| `live.warning-escape` | the slowest non-swimmer on the farthest tile at the warning walks out in 1.4 s, no water damage | live |
| `live.caught`, `live.caught-stays` | the same one at the flood: out on a bank in about 2 s with 37-40 % of its HP lost; one that stays is knocked out at 5 s and the next Pokémon comes in on ground that never floods | live |
| `live.swimmers` | high water: a Water type and a non-Water Pokémon with Surf take the flooded shortcut, no exposure, sooner than the dry route | live |
| `live.raider-caught` | a Raider on the shortcut at the flood: in the water, out on a bank, on the point by a dry approach | live |
| `live.hold-high`, `live.hold-transition` | the Hold by both approaches with the shortcut never open (Raid party live); a Hold across a flood: the raiders caught on the floor all reach the point afterwards | live |
