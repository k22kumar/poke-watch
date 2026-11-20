# Hazards: liquids you can enter, and edges you can fall from

Water and lava are no longer walls, and a location map's chasm is no longer rock. Any Pokémon can walk into a liquid
or off an open edge, or be knocked into one. What happens next depends on the Pokémon and on where its body actually is.
The code is in `src/sim/hazards.ts` (exposure), `src/sim/world.ts` (collision, support, contact), `src/sim/player.ts` and
`src/sim/enemies.ts` (movement). The numbers are in `rules.hazards` (`src/rules/defaults.ts`).
`rules.hazards.enabled: false` restores the earlier rules exactly.

## Three separate questions

| Question | Answered by | Notes |
| --- | --- | --- |
| Is something solid in the way? | `World.collides(x, z, feet, step)` | Walls, faces higher than a step, and deck slabs. Liquids and open air are not solid. |
| Is there a surface underneath? | `World.support(x, z, ref)` | A chasm tile has no surface (`-Infinity`) unless a deck is at the walker's level. A liquid supports at its surface. |
| What does the hazard do to this body? | `World.liquidAt(x, z, y, contact)` + `exposureSystem` | Contact uses the body's real height. Then the liquid's rule for that Pokémon applies. |

`World.blocks` keeps its old meaning ("don't walk there on your own": it includes liquids and chasms). AI steering,
bodies (rocks, the egg), the balance bot and route scripts use it. Movement collision uses `collides`. That is how
knockback can carry a creature over a lip that it would never walk over by choice.

## Liquids

| | Water | Lava |
| --- | --- | --- |
| Entry | Anyone can enter, by walking, falling or being knocked in | Same |
| Safe | A swim template (`traversalOf(species).swim`; by default the Water type, either slot of a dual type: docs/LOCOMOTION.md "Capabilities"), or `surf` anywhere in the move set. Surf does not have to be pressed, and its cooldown doesn't matter. | Only species in `rules.hazards.lava.safeSpecies`. The list is empty, so every Pokémon is vulnerable. A Fire-type rule would be a design decision. |
| `lethal` (s to knockout) | **5** | **3** |
| Drain | 20 % of max HP per second | 33⅓ % of max HP per second |
| Wading speed (exposed / safe) | ×0.75 / ×0.95 | ×0.7 / ×0.9 |
| Jump while exposed | no | no |

- **Contact.** The body's centre counts if its feet are within `contact` = 0.3 m of the surface, on the ground layer,
  with no deck carrying it and no ice. This gives one sample per body per tick, so a single contact is never counted
  twice. When liquids overlap, the one with the shorter `lethal` wins (`dominant`).
- **Clock.** Exposure time advances by the simulation step. Damage is maxHp / lethal per second, applied in whole HP
  points, and the leftover fraction carries to the next tick. When exposure reaches `lethal`, the Pokémon is knocked
  out, whatever healing it got. At full HP without healing, HP reaches 0 at exactly that moment. Lower HP means an
  earlier knockout.
- **What keeps the clock and what ends it.** Moving into another cell of the same liquid keeps the clock. So does a hop
  that leaves the surface. Standing on supported dry ground ends the exposure (a confirmed exit), and the damage
  already taken stays. Becoming safe also ends it, for example by tagging in a Water type while in the water.
- **Damage path.** The field Pokémon is damaged through `onHpLoss` and knocked out through `faint`, the same squad
  lifecycle as a hit. Difficulty, Guard and dash i-frames do not apply. Creatures lose HP, and `killEnemy` handles
  their knockout (the kill event and objective bookkeeping).
- **Getting out.** A body in a liquid can climb a bank up to `climbOut` = 0.8 m. A dry step is limited to 0.6 m, and
  some classic-region banks are 0.75 m above the water. A creature heads for the shore that `World.shore` picked when
  it entered.
- **Cues.** On entry the sim emits a `hazard` event with phase `enter` and the `lethal` time; the UI shows a banner
  ("Deep water! … reach solid ground within 5 s") and plays a sound. `safe` is emitted when a swimmer enters.
  `playerHurt` and `hazardHit` are emitted every `cueEvery` = 0.25 s. The death recap names deep water, lava or a fall.
- **Ice and bridges.** Frozen water is ground, so it causes no exposure. A deck over water carries anyone at its
  height. When ice thaws under someone, the actor is left in the water where it stood and the exposure rule decides.
  This replaces the old "put ashore, −10 %" rescue (the rescue still applies with `enabled: false`). Bodies such as
  rocks and the egg cannot swim, so they are still put ashore.

## Open edges and chasms

- A location map's chasm cells (`LocMeta.chasm`, from `locgen`) are open air: they are not walls, and nothing stands on
  them. Walking, dashing or being knocked over a lip lets gravity take over.
- Falling onto a lower floor uses the normal landing. Falling into a liquid starts that liquid's exposure.
- A ground body that falls below `World.killY` (the lowest floor on the map minus `killDepth` = 3 m) is knocked out,
  once. That is a faint for the field Pokémon and a kill for a creature.
- The location-map rescue ("never left inside rock") only fires on a real wall tile, so a fall is never pulled back to
  the lip.
- Creatures fall too. A creature whose drop exceeds a step falls under gravity instead of snapping down.

## Navigation

- Flow fields, the Raiders' contest field and the habitat validator are unchanged: liquids and chasms are not
  navigable. Required approaches never use them.
- A creature walking by itself stops at the lip of a lethal liquid or a chasm (`avoidsStep`). Knockback above
  `forcedKnock` = 2 m/s still carries it over.
- After a hazard knockout, the next Pokémon comes in on the last supported dry ground the trainer stood on. That point
  is only recorded when the ground 0.6 m around it is also safe, so the new Pokémon doesn't start on the lip, and never on
  a tidal floor (dry when the trainer stood there, it can be flooded when the next one arrives).
- **Tide** (Shoal Grotto, docs/HABITATS.md "Tide"): at high water the tidal floor is ordinary water at the tide's level;
  whoever is on it at the flood is in the water where it stood and the rules above apply unchanged.
- **Shore target** (`shoreFor` in `src/sim/hazards.ts`): where a driver of the trainer (the balance bot, `habplay`,
  `habtide`) heads to leave a liquid. No sim system and no human input reads it. It is `World.shore` from the point
  where the trainer entered a tile, kept until it enters another tile, one answer per World (a `WeakMap`, so it goes
  with its world). Until 2026-11-17 it was one slot for the whole process, keyed by tile index alone: a run on a map
  with the same layout (the authored meadow) could be handed the shore another run, or an earlier region of the same
  run, had computed for that index, so bot-driven runs depended on what ran before them in the process (repro: a
  bulbasaur seed 3 boss-rush run, then gastly seed 4 classic with held jumps: the gastly run diverged at tick 3261).
  The sim itself never did: recorded frames replay identically in any order. `tests/crossrun.test.ts` pins both.

## Tested maps and locations

Run `npx tsx scripts/hazplay.ts` to replay the cases (`tests/hazards.test.ts` asserts all of them). Tiles are `i,j`.
In the browser, use `?go=1&loc=<map>&mapseed=<seed>&species=<id>&calm=1&tp=<i>,<j>`.

| Map | Seed | Tile | Used for |
| --- | --- | --- | --- |
| Shrine Gorge (`river-gorge`) | 3 | 60,56 (shore, water to the north) | safe swimmers, exposure, escape, KO, max HP, healing, cadence, re-entry, Tag, recovery, ice, thaw, creatures |
| Shrine Gorge | 3 | 58,51 (deck at 3.0 m over water) | bridge: no contact |
| Shrine Gorge | 3 | 73,27 / 76,69 | walking off a 3.15 m drop onto ground / a 3.25 m bank into the river |
| Shrine Gorge | 7 | 69,63 | the water cases on a second seed |
| Cinder Crater (`volcanic-ridge`) | 7 | 47,63 (lava lake rim) | lava escape, KO at 3 s, configured immunity, Fire type not immune by default |
| Mt. Moon | 1 | 19,81 (7 m lip) | walking, diagonal and knocked falls, recovery, creature holds at the lip and falls when knocked |
| Chargestone Cave | 1 | 39,101 | the same |
| Viridian Forest | 1 | 62,53 / 58,57 (bridge side) | the same, including walking off a bridge's side |
| Shoal Grotto (`tidal-cave`) | 1, 2, 7 | the tidal tile farthest from a bank (`scripts/habtide.ts`) | the flood under a standing trainer and Raider, escape, KO and recovery off the tidal floor, swimmers through the flood |

Escape distances (`World.shore`, straight line, for the slowest partner wading at ×0.75 = 5.36 m/s): Shrine Gorge 3, max
12.1 m (2.25 s); seed 7, max 8.1 m; Cinder Crater 7, max 6.4 m (1.28 s at ×0.7). Every liquid tile can be escaped within
its `lethal` time. The worst cases cost about 45 % of max HP in water and 43 % in lava.

## Known gaps

- **Surf is not in the game's move data.** The import only brings in level-up moves. The rule is in place and was
  tested by giving a Pokémon a move slot with the key `surf`, but no Pokémon can learn Surf in play yet.
- **The Viridian Forest gully is drawn with a floor 4.5 m down, but it is a void.** The pit has no exit, so landing in
  it would leave a Pokémon stuck. The kill plane sits 1.5 m above the drawn floor.
- **Lunges cross lips.** Dash-shaped moves fly their full length past the target, so they can carry a Pokémon over a
  lip. This is deliberate, but an Assist or Auto aim at an enemy across a chasm can be costly. The balance bot holds
  back such lunges itself.
- **Creatures don't route through water.** No creature, Water types included, takes a swimming shortcut.
- **Contact is the body's centre only.** A Pokémon half over a lip stands until its centre crosses. There are no
  guardrails in the tile data, so bridge sides are open.
- **The shore target can be stale within one world** (not fixed: no measured harm, and fixing it would change bot
  behaviour). The per-tile answer ignores what changes while the trainer stays on that tile: the partner's footprint
  (a Tag or an evolution in the water keeps the shore picked for the previous body, which may not fit the new one) and
  the water (a tide or a thaw that floods or uncovers ground keeps the old target, which may now be under water). It
  also keeps the answer for the point the tile was entered from. Only the bot and the habitat scripts steer by it.
- **No swimming art.** Sprites stand at the surface. There is no splash or lava-sizzle effect beyond the impact
  sound and the banner.
