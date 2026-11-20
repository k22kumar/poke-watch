# The training range, targets and hero modes

The match foundation the hero shooter's replay baseline is built on (`docs/hero-shooter-pivot.md` §8 step 7; decisions Q10, Q11, Q14–Q17, Q20, Q23, Q30, Q39, Q48). Stats, speed and kits are in `docs/HEROES.md`.

## Modes (`src/mods/index.ts`)

| Mode | Systems | Rules |
|---|---|---|
| `range` (`RANGE`) | no survivor loop (`noSurvivorLoop`: director, progression), no swap (`solo`) | `hero.fillE`, `hero.respawn` 3 s, `evolution.freeTrigger` |
| `range-swap` (`RANGE_SWAP`) | the range plus the opt-in `swap` Mod | `hero.loadout` 3 |
| `hold` (`HOLD`) | no survivor loop, solo, `holdMod` (opens a Hold on the first tick of a habitat map) | — |

The survivor modes (Classic, Survival, Glass Cannon, Boss Rush) still run with the default system list until pivot step 9 deletes them. `RANGE` also serves tests and gates as "the foundation with no survivor loop" on any map; the range *arena* is a separate choice (`rules.worldgen.arena: 'range'`), which the title flow makes for the range modes (`src/main.ts startRun`) unless the URL names a map (`?loc=`, `?world=`).

## The range arena (`src/world/arenas.ts buildRange`)

Map id `range`, the meadow's palette. An open firing field north of the spawn where the range targets stand, a 2 m terrace with a stair flight on the west (walk off its edge, climb back by the stairs), a 1.5 m block on the east that a jump reaches (the 1.84 m apex), four rocks for cover, a pond in the south-east, a tall-grass patch west of the spawn (Fire sets it alight), and three Light throwables beside the spawn.

- **Throwables** (`ArenaMap.throwables`, seeded by `src/sim/bodies.ts seedBodies`): the `cobble` body template, Weight 1 and unbreakable (integrity 0), so any hold move (Wrap, Vine Whip: Power 1; Psychic) picks one up and its release throws it along the aim. It stays to be thrown again. The scattered loose rocks (Weight 2) still need Power 2.

## Targets (`src/rules/targets.ts`, `src/sim/targets.ts`)

A target set is data: per target a species, a kind, an anchor (`spawn`, or a habitat ModeGraph place: `contest`, `stageA`, `stageB`) and an offset, plus a patrol's loop. `RunOptions.targets` puts one down when the run starts.

| Kind | Moves | Damage |
|---|---|---|
| dummy | stands still | none, and no contact |
| patrol | walks its loop (`targetGoal`, read by `src/sim/enemies.ts`) | none |
| strafe | the ranged behaviour: keeps its distance, shoots | `rules.targets.strafeDamage` 0.3 of its own |

- **Health:** the canon curve, `heroHealth(HP) × rules.targets.hp[kind]`, so a target and a future hero bot take the same time to kill. Incoming damage is divided by the target's guard (docs/HEROES.md).
- **No survivor curves:** a target's speed is its base speed (no stage-time curve), and nothing drops on a kill (XP and pickups were deleted at pivot step 9).
- **Every other enemy** (the Hold Raid party, `pokewatch.spawn` in the dev console) takes the same canon curve, `heroHealth(HP) × rules.enemy.behaviourHp[behaviour]` × its role's `hp` (Raiders also `rules.roles.raiderHp`). Health never grows with match time or region. Base speed keeps its own formula (`rules.enemy.speedBase + Spe × speedPerSpe`, capped at `speedMax`, × the behaviour's factor) until the co-op wave puts enemies on the hero speed band (pivot Q36).
- **Placement:** `src/sim/placement.ts allowedAt` (habitat restrictions and wide-field reach), else the nearest walkable tile, then `spawnEnemy`'s footprint fit.
- **Pinned:** the far-behind relocation (`rules.enemy.despawnDistance`) never moves a target.
- **Respawn:** a fixed tick count, `round(rules.targets.respawn / dt)` (3 s), at its anchor; no RNG.
- `RANGE_TARGETS`: Geodude and Snorlax dummies, a Rattata patrol, a Gastly strafer. `HABITAT_TARGETS`: a dummy and a patrol on the contest, a strafer on team B's staging.

## Range rules

- **No fail state:** with `rules.hero.respawn` > 0, a player who faints with no Pokémon left is down for that long (rooted, invulnerable), then back at the spawn with every member at full health (`respawn` event; `src/sim/squad.ts`). With 0 the run ends as before.
- **Free Breakthrough:** `rules.evolution.freeTrigger` makes holding Touch (F) for `rules.evolution.holdTime` (0.4 s) a Breakthrough for an evolver (docs/HEROES.md; `src/sim/evolution.ts`). Elsewhere Touch does nothing yet; Candy prices come with growth.

## Breakthrough (`src/sim/evolution.ts`)

A per-player state, never a world freeze: for `rules.evolution.breakSeconds` (2 s) the Pokémon is rooted and invulnerable (hits and hazards) with its status cleared, then it becomes its next form at full health. `startEvolution(ctx, player, member)` is the one entry (the survivor level trigger that also called it was deleted at pivot step 9); `?evolve=<seconds>` (or `pokewatch.evolve()`) is the dev trigger. The renderer alternates the two forms' sprites over the Breakthrough and the overlay is not modal. Growing needs no code of its own: the new footprint applies from the next tick and `World.moveBody` lets a body out of a tight spot, never further in (`tests/evolution.test.ts`: a corridor, a deck).

## Loadout and swapping (`src/sim/swap.ts`)

`Player.squad` stays an array. `rules.hero.loadout` (1) caps how many Pokémon a player brings; `RunOptions.loadout` names the rest, each with its hero kit (`addLoadoutMember`). Swapping is the `swap` system a mode registers (the `swap` Mod): Tag input and cooldown, the faint replacement, Tag Actions, grey health and the bench. With one Pokémon it never runs. The `tagAction` readiness check counts only where `hero.loadout` > 1. The squad's core (`squadSystem`: the field timer, Flash Fire, the respawn) runs in every mode.

## Hold (`src/sim/modes/hold.ts`)

The control point as its own module: the point (the habitat contest floor, else a site near the player), the offer time, charging, the Raiders' drain and the Raid party from team B's staging. `src/sim/objectives.ts` still schedules and finishes objectives and calls these; `src/sim/enemies.ts` pins Raiders of an active habitat Hold (CLAUDE.md "Hold Raid party"). The item-ball reward is the survivor loop's: it is paid only where the progression system runs.

## The replay baseline

`tests/fixtures/scenarios.ts`: ten scripted input tracks (no bot) on the range, Mt. Moon, Shoal Grotto, Cinder Crater and Shrine Gorge, hashed every 10 s against `tests/fixtures/replays.json` (`npx tsx scripts/checksum.ts scenarios [--update]`). Each scenario names the coverage it must reach (`needs`: holds, throws, parries, Breakthroughs, ticks under a deck, Tag Actions…; `never`: Wailord's ticks under a 2.9 m deck), counted from events and state every tick; `tests/replays.test.ts` asserts them before the hashes. The harness aims as the browser does: the crosshair ray and the ground aim point under it.
