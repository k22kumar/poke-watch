# Spawning

Which wild Pokémon appear where is configuration, kept apart from maps, species and the director. No map lists Pokémon it must contain. No species is tied to a map, biome or type, and adding a Pokémon needs no map edit.

Code:
- `src/rules/spawning.ts`: pools, presets, resolution, validation.
- `src/rules/profiles.ts`: per-species capabilities, preferences and restrictions.
- `src/sim/director.ts`: picking and placing.

## Four questions, four places

| Question | Answered by |
|---|---|
| **Eligibility**: may this species appear here? | The resolved pool: region preset + map pool + override (below) |
| **Selection**: which eligible species now? | `director.ts pickSpawn`: weight × habitat preference (`rules.spawning.preference`: ×2 on a preferred tile, ×0.55 elsewhere, ×1 with no preference) |
| **Location**: where? | `ringPoint` (`src/sim/enemies.ts`): the spawn ring around the player, or a location map's entry anchors |
| **Compatibility**: can it stand there? | `allowedAt` (`director.ts`): the species' hard `requires` / `avoids` habitat tags (`profiles.ts`), and, for a wide footprint, ground the wide field toward the player reaches (docs/SIZING.md "Navigation classes"). `spawnEnemy` then puts the body where it fits (`World.nearestFit`: a tile centre, or a wide block's centre) |

If a spot fails compatibility, the director tries again: up to `rules.spawning.retries` spots for that species, then a species from the pool that may use the spot. If none may, the spawn is skipped and a `spawnSkipped` event says why. Nothing is placed where it may not be.

With no restriction configured, nothing is re-rolled. The random draws are then exactly those of the older director, which is why every older replay checksum still matches.

### Capability, preference, restriction

Each species profile (`speciesProfile`) keeps three kinds of fact apart:

- **Capability**: what it can do. Movement capabilities are traversal templates resolved by `traversalOf` (docs/LOCOMOTION.md "Capabilities").
  - A spawn pool's `fly` filter splits by navigation class: `fly: true` selects species whose wild body hovers (`traversalOf(sp).groundNav` false), `fly: false` the ground walkers. The roster's `flying` flag is the default source of the hover row.
  - Swimming comes from `canSwim`: a swim template (by default every type in `rules.hazards.water.safeTypes`, the Water type), or a Pokémon that knows a move in `rules.hazards.water.safeMoves`. A `traversal` override in `SPECIES_OVERRIDES` replaces the default per species.
- **Preference**: `prefers` is a set of habitat tags (`HAB` in `src/rules/habitats.ts`). It raises the odds on matching tiles and never makes a species ineligible anywhere.
- **Restriction**: `requires` (a spawn tile must carry one of these tags) and `avoids` (it must carry none of them). These are the only hard environmental rules. None are set by default, and none are ever derived from type.

So Poliwag prefers water, can swim, and still spawns on a dry map whose pool lists it. A species with `requires: HAB.water` would only appear on water-tagged tiles. On an authored arena, which has no habitat tags, it would never spawn and would be reported instead.

## Pools and layers

A pool is a `SpawnPoolDef`:

```ts
{
  preset?: string;                             // start over from this preset (its spawns, elites, boss)
  only?: (string | [string, number])[];        // replace the spawns with exactly these
  everyWild?: boolean;                         // add every wild species in the roster at weight 1
  include?: (string | [string, number])[];     // add species, or set their weight ('id' = weight 1)
  weights?: Record<string, number>;            // change weights of species already in the pool
  filter?: { types?, behaviours?, sizeClasses?, fly? };  // keep only species that pass every test (size class and
                                               // navigation class under the run's rules: spawnTableFor)
  exclude?: string[];                          // remove (spawns and elites)
  elites?: string[]; boss?: string;            // replace
}
```

Within one layer the fields apply in the order listed. A boss never enters the spawns: each layer drops any boss id
from them before its `filter` runs, so no filter (size class, type, behaviour, flight) ever sees one, and a boss spawns
only through `boss`. The resolver does this silently; the validators below report it. The layers then apply in this order, each one editing the result of the one before:

| Layer | Source | Default |
|---|---|---|
| 1. Region preset | `rules.spawning.regions[stage]` (`src/rules/defaults.ts`) | `meadow`, `badlands`, `frost`, `dusk` |
| 2. Map pool | `spawns` on a `LocationDef` (`src/world/locations/*.ts`) or a `HabitatRecipe` (`src/world/habitat/recipes.ts`) | none set |
| 3. Mode or mod override | `rules.spawning.override` | none |
| 4. Debug | `?pool=<preset>` or `?pool=id,id` in the URL | none |

The resolved table is computed once per stage (`startStage` → `ctx.spawnTable`). Every system reads it: the director, compositions, Hunt and Hold objectives, recruit offers and the debug boss button. `STAGES` (`src/rules/stages.ts`) is the region tables with no map or override, kept for biomes and UI.

### Presets

`SPAWN_PRESETS` in `src/rules/spawning.ts`:

| Preset | Contents |
|---|---|
| `meadow-classic`, `badlands-classic`, `frost-classic`, `dusk-classic` | The original region tables. Older rule layers select these through `CLASSIC_REGIONS`. |
| `meadow`, `badlands`, `frost`, `dusk` | Each classic table plus its share of the 2026-11 roster wave, written as `{ preset: 'meadow-classic', include: [...] }`. A preset can build on another. |
| `all-wild` | Every wild Pokémon in the roster at weight 1, so a newly added species is in it automatically. It names no boss or elites, so the region keeps its own. |

### Validation

`validateSpawnConfig()` lists every problem in readable form, and `tests/spawning.test.ts` requires the list to be empty. It catches:
- unknown species;
- weights ≤ 0;
- unknown presets and preset loops;
- an elite that is a boss, or a boss without a boss kit;
- a boss named in `only`, `include` or `weights` (the pool drops it from the spawns);
- a region or map pool that ends up with no wild Pokémon, no elites or no boss.

A mode's or mod's `rules.spawning.override` is checked where it loads, not inside the sim: `modeSpawnProblems(mode)`
(`src/mods/index.ts`) runs `validateSpawnOverride` on the mode's override and each of its mods', `src/main.ts`
`startRun` warns with the result, and `tests/spawning.test.ts` requires none for `MODES`. `?pool=` warns in
`src/main.ts` beside its unknown-id warning and leaves a named boss out.

`validateProfiles()` (`tests/profiles.test.ts`) does the same for `SPECIES_OVERRIDES`: unknown ids, invalid habitat masks, a `requires` that is fully `avoid`ed, and unknown size classes.

## What changed and why

Before this work, the only spawn source was `STAGE_TABLES` in the generated `src/content/pokedex.ts`, copied from `content/roster.json`. That had four problems:
- Changing a weight meant a full content rebuild over the network.
- Maps could not choose anything.
- Preferences were a hand-kept table in `habitats.ts`.
- The classic generator rejected layouts that lacked a spawn species' *preferred* habitat, so a preference acted as a map requirement.

Now the pools are typed TypeScript and no rebuild is needed. The generator gate checks only hard `requires`, and preference coverage is reported. All of this landed hash-neutral: every replay checksum was identical before the roster wave.

## Checking it

- `npx tsx --test tests/spawning.test.ts tests/profiles.test.ts` covers:
  - global eligibility;
  - include, exclude and weights;
  - filters;
  - preset composition;
  - precedence;
  - a Water type on a dry map;
  - a restricted species never placed on a forbidden tile;
  - seeded determinism;
  - a new species eligible with no map edit.
- `?pool=all-wild` or `?pool=onix,lapras` in the browser shows a pool live.
