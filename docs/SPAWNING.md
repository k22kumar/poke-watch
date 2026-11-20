# Spawning: target sets and placement

What stands on a map is decided by the mode, never by a spawn pool. The survivor spawn pools (region presets, map
pools, mode overrides, `?pool=`, roster waves, `ctx.spawnTable`) and the director that drew from them were deleted at
hero-shooter pivot step 9 (`docs/hero-shooter-pivot.md` §8, Q9, Q20). Their code and the last version of this
document are on the `survivor-final` tag.

## Where enemies come from

| Source | What | Where it is defined |
|---|---|---|
| Training targets (T0) | dummies, patrols and strafers at fixed anchors, respawning on a fixed tick count | `src/rules/targets.ts` (`RANGE_TARGETS`, `HABITAT_TARGETS`), `src/sim/targets.ts`; docs/RANGE.md |
| The Hold's Raid party | four Raiders and a tank from team B's staging when the point activates | `RAID_PARTY` in `src/sim/modes/hold.ts`: the species are frozen from the first region's old pool (Rattata, Sandshrew, Poliwag, Mareep, Sentret, Pikachu, Pichu, Furret, Doduo; tank Turtwig, Snorlax, Heracross), drawn on `rng.spawn` |
| The dev console | `pokewatch.spawn(id, dx, dz, roles)` | `src/main.ts` |
| Tests and gates | a chasing crowd kept at N | `scripts/lib/crowd.ts` (not a game system, used by no replay scenario; Q21 as amended) |

Every one of them goes through `spawnEnemy` (`src/sim/enemies.ts`): health on the canon curve × the behaviour's
multiplier (docs/RANGE.md), base speed from Speed, the size-class body (docs/SIZING.md). The role bits a spawner may
pass are `raider` and `target`; `ranged`, `healer` and `swarm` come from the species' behaviour and `flying` from its
traversal. The elite, alpha, boss and stampede roles went at pivot step 10 (no spawner was left). The co-op wave
(T1, after the merge) is the next source.

## Placement

| Question | Answered by |
|---|---|
| **Location**: where? | The source's own point: a target's anchor and offset, team B's staging (the Raid party on a habitat map), else `ringPoint` (`src/sim/enemies.ts`, the spawn ring `rules.enemy.spawnRadius` around the player, or a location map's entry anchors) |
| **Compatibility**: may it stand there? | `allowedAt` (`src/sim/placement.ts`): the species' hard `requires` / `avoids` habitat tags (`src/rules/profiles.ts`), and, for a wide footprint, ground the wide field toward the player reaches (docs/SIZING.md "Navigation classes") |
| **Fit**: exactly where? | `spawnEnemy` puts the body where it fits (`World.nearestFit`: a tile centre, or a wide block's centre) |

A Raid party member that may not stand at its spot is left out with a `spawnSkipped` event; a target that may not is
moved to the nearest walkable tile. Nothing is placed where it may not be.

## Capability, preference, restriction

Each species profile (`speciesProfile`, `src/rules/profiles.ts`) keeps three kinds of fact apart:

- **Capability**: what it can do. Movement capabilities are traversal templates resolved by `traversalOf` (docs/LOCOMOTION.md "Capabilities"). Swimming comes from `canSwim`: a swim template (by default every type in `rules.hazards.water.safeTypes`, the Water type), or a Pokémon that knows a move in `rules.hazards.water.safeMoves`. A `traversal` override in `SPECIES_OVERRIDES` replaces the default per species.
- **Preference**: `prefers` is a set of habitat tags (`HAB` in `src/rules/habitats.ts`). Data only since the pools went: nothing reads it as encounter odds, and it never makes a species ineligible anywhere. Bots and the co-op wave may read it.
- **Restriction**: `requires` (a tile must carry one of these tags) and `avoids` (it must carry none of them). These are the only hard environmental rules. None are set by default, and none are ever derived from type.

`validateProfiles()` (`tests/profiles.test.ts`) rejects unknown ids, invalid habitat masks, a `requires` that is fully
`avoid`ed, and unknown size classes.

## Maps

No map lists the Pokémon it must contain, and no species is tied to a map, biome or type. The classic generator's
habitat gate used to read the spawn species' `requires`; no species sets one, so it was always satisfied, and the
generator now gets no species (every classic region × seeds 1–12 gives the same `mapChecksum` either way). The habitat
navigation profiles are frozen constants (`VALIDATED_PROFILES`, `src/world/habitat/mode.ts`, pivot step 3).

## Checking it

- `npx tsx --test tests/range.test.ts tests/hold.test.ts tests/profiles.test.ts`
- `tests/replays.test.ts`: the `range-*` scenarios cover the target sets, `gorge-hold` the Raid party.
