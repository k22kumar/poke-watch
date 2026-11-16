# Customising Pokémon, sizes, maps and spawns

A practical guide to the common changes. Each section names the real file, shows a working example, and says which check to run. After any change, run `npm run check` (typecheck, every test, production build). The background is in docs/SIZING.md, docs/SPAWNING.md, docs/PIPELINE.md and docs/HABITATS.md.

**Where each kind of setting lives:**

| What | File | Rebuild content? |
|---|---|---|
| Which Pokémon exist, and their role (partner, wild behaviour, boss kit) | `content/roster.json` | yes (`npm run content`) |
| Per-species facts: habitat preferences, restrictions, size-class pin, mender | `src/rules/profiles.ts` (`SPECIES_OVERRIDES`) | no |
| Tag Action (optional; one is derived from the Pokémon's own moves) | `src/rules/tags.ts` (`TAG_ACTIONS`) | no |
| Size-class numbers, partner radius clamp, wide-body threshold | `src/rules/defaults.ts` (`size`) | no |
| Spawn presets and region tables | `src/rules/spawning.ts` (`SPAWN_PRESETS`), `src/rules/defaults.ts` (`spawning.regions`) | no |
| A map's own spawn pool | `spawns` on a location (`src/world/locations/*.ts`) or habitat recipe (`src/world/habitat/recipes.ts`) | no |
| A mode's spawn pool | `rules.spawning.override` in a `MODES` entry (`src/mods/index.ts`) | no |

When two settings disagree, the later one wins:
- **Pools:** region preset → map `spawns` → mode `rules.spawning.override` → `?pool=` in the URL.
- **Size class:** `sizeClass` pin → `NEUTRAL_CORE_EXTENT_M` → canonical height → sprite height.

---

## 1. Add a new Pokémon

Implemented. Example: Wooper as a Meadow wild Pokémon.

1. Add it to `wild` in `content/roster.json`. The behaviour is one of `chase`, `tank`, `swarm`, `ranged` (then also `shot`, an element), `charger` or `healer`. Add `"flying": true` for a flyer, or `"flying": false` to ground a Flying type such as Doduo.
   ```json
   "wooper": { "behaviour": "chase" }
   ```
2. Fetch its sources and rebuild the content. This writes `src/content/pokedex.ts` and `src/content/art.json`; never edit those by hand.
   ```bash
   npm run fetch-sources   # sparse clones into ../src-data (adds Wooper's data, sprite folder and cry)
   npm run content         # imports it; check the log for warnings (missing cry, animations)
   ```
3. Put it in a pool. For example, add `['wooper', 1]` to the `meadow` preset's `include` in `src/rules/spawning.ts`. Without this step it is already eligible wherever a pool uses `all-wild`.
4. Optional:
   - a habitat preference in `SPECIES_OVERRIDES` (`src/rules/profiles.ts`): `wooper: { prefers: HAB.water }`;
   - an authored Tag Action in `src/rules/tags.ts`, if the derived one (its earliest damaging move of its own type, then its strongest by Lv 30) doesn't suit.
5. Update the roster pins in `tests/catalogue.test.ts`: species count, sorted id list, move count. They are pinned on purpose, so an accidental roster change fails loudly.

No map, spawning, combat or render code changes. The size class comes from its canonical height (0.4 m: Small). The sim body, drawn size, habitat navigation profile and Tag Action all follow from that.

## 2. Change a Pokémon's size class

Implemented. Pin the class in `src/rules/profiles.ts`:
```ts
export const SPECIES_OVERRIDES: Record<string, SpeciesOverride> = {
  // …
  onix: { prefers: HAB.rock | HAB.dry, sizeClass: 'large' },   // 'tiny' | 'small' | 'medium' | 'large' | 'xl'
};
```
A pinned Pokémon sits at the class centre (no tilt). If the canonical height is simply measuring the wrong thing (a serpent's length), set a reviewed figure in `NEUTRAL_CORE_EXTENT_M` (`src/rules/sizing.ts`) instead. It then keeps its within-class tilt.

Check: `npx tsx --test tests/sizing.test.ts`. Then `pokewatch.renderer.sizes()` in the browser, or `node tools/cap.mjs <html> tools/sizescenes.json <out> size-` on a private build.

## 3. Change the size-class targets

Implemented. Edit `size.classes` in `src/rules/defaults.ts`:
```ts
{ id: 'large', name: 'Large', below: 2.05, visual: 1.92, radius: 0.68, height: 1.7, body: 0.66 },
```
- `below` is the class's upper cut in canonical metres.
- `visual` is the drawn core.
- `radius` and `height` are the hurtbox: what hits it.
- `body` is the movement footprint: the circle walls stop, and the navigation class (under `size.heavyRadius`, 0.5 m, a body fits one-tile passages; from it up, it routes on two-tile blocks). It has no tilt. Keep it under 1 m. Role sizes scale it up to `size.bodyCap` (0.95 m), and raising that needs a three-tile gate on the maps first (docs/SIZING.md "Footprint").
- `tilt` (±8 %) is how far apart Pokémon in one class may drift.

`tests/sizing.test.ts` fails if neighbouring classes end up less than 1.3× apart or overlap. A sim number change moves replay hashes. Record them again with `npx tsx scripts/checksum.ts`, after checking the run still plays well.

To change only how big things look and leave the sim alone, change `visual` only.

## 4. Configure movement or environmental capabilities

- **Flying.** Implemented. Set `"flying": true/false` in `content/roster.json`, then `npm run content`. A flyer hovers and ignores walls, water, footprints and wide-body routing.
- **Size and passability.** A physical capability, set per class (`body` in section 3), or per species by pinning its class (section 2). It is not inferred from type.
- **Swimming.** Implemented as a rule, not per species. A Pokémon of a type in `rules.hazards.water.safeTypes`, or knowing a move in `rules.hazards.water.safeMoves` (`src/rules/defaults.ts`), swims safely. Everything else has the liquid's `lethal` seconds to reach a bank. `canSwim()` in `src/rules/profiles.ts` answers it.
- **Burrowing, aquatic-only movement.** Not implemented. There is no burrow or swim-only locomotion in the sim. A water-only Pokémon would need a new movement mode in `src/sim/enemies.ts`. Until then, use the spawn restriction in section 10 to keep it to water tiles.

## 5. Create a new map

Implemented, at two levels:
- **A Pokémon location** (generated from a definition). Copy `src/world/locations/viridianForest.ts`, change its identity, landforms, `habitat` tags and props, and register it in `src/world/locations/index.ts`. docs/LOCATIONS.md covers the parameters.
- **A habitat recipe** (Hold maps). Add a `HabitatRecipe` to `src/world/habitat/recipes.ts` and follow docs/HABITATS.md. Run its gates, `scripts/habstate.ts` and `scripts/habaudit.ts`, as CLAUDE.md lists.

Then choose it for a biome with `rules.worldgen.locations` (`src/rules/defaults.ts`), or try it with `?loc=<id>`. A new map needs no Pokémon edits: it fields the region's pool unless you give it `spawns` (section 7).

## 6. Modify an existing map

Implemented. Edit its definition file (`src/world/locations/<name>.ts`, `src/world/habitat/recipes.ts`, or `src/world/arenas.ts` for the handcrafted arenas). A change that alters an accepted habitat layout needs a `HAB_VERSION` bump (CLAUDE.md). A location change that alters accepted layouts should bump `LOC_VERSION` (`src/world/locgen/index.ts`). The `wide` gate requires a two-tile route from the hub to the boss hall, every arena and three anchors (docs/LOCATIONS.md). Check a change with `npx tsx scripts/locstats.ts <id> 30 1` and `npx tsx scripts/navwalk.ts <id> 5`.

## 7. Change which Pokémon appear on a map

Implemented. Give the map a `spawns` pool. It layers over whichever region uses the map. For example, Mt. Moon keeping only cave-type Pokémon from the region's pool, plus Onix and Geodude:
```ts
// src/world/locations/mtMoon.ts, inside MT_MOON
spawns: {
  filter: { types: ['rock', 'ground', 'poison', 'ghost', 'dark'] },   // keep cave-type Pokémon from the region's pool
  include: [['onix', 1.5], 'geodude'],                               // and add these wherever this map is used
  exclude: ['zubat'],
},
```
Or fix the exact list: `spawns: { only: [['geodude', 3], ['onix', 1]] }`. Elites and the boss stay the region's unless the pool sets `elites` / `boss`.

Check: `npx tsx --test tests/spawning.test.ts`. Its configuration test validates every map's pool and fails on unknown ids or an empty result.

## 8. Adjust spawn weights and conditions

Implemented.
- **Weights:** change the numbers in a preset's `include` (`src/rules/spawning.ts`), or override them from a map, mode or another preset with `weights: { rattata: 2 }`.
- **Habitat odds:** `rules.spawning.preference` (`native: 2, foreign: 0.55`) scales a species on tiles it prefers or doesn't.
- **Other conditions:** see section 10.
- **Not implemented:** time- or event-based conditions (night-only, after a boss). The director would need a new layer for those. The four-layer resolution in `resolveSpawnTable` is where it would go.

## 9. Create a reusable spawning preset

Implemented. Add an entry to `SPAWN_PRESETS` in `src/rules/spawning.ts`. It can build on another preset:
```ts
'spooky': { preset: 'all-wild', filter: { types: ['ghost', 'dark'] }, elites: ['houndour'] },
```
Use it from a map (`spawns: { preset: 'spooky' }`), as a region's table (`rules.spawning.regions: ['meadow', 'badlands', 'frost', 'spooky']`), or from a mode:
```ts
// src/mods/index.ts, in MODES
{ id: 'haunted', name: 'Haunted', description: 'Only ghosts and dark Pokémon.',
  rules: { spawning: { override: { preset: 'spooky' } } } },
```
Try it without code: `index.html?go=1&pool=spooky`.

## 10. Define an environmental restriction, preference or override

Implemented, in `SPECIES_OVERRIDES` (`src/rules/profiles.ts`), using `HAB` tags (`meadow`, `grass`, `water`, `rock`, `dry`, `forest`):
```ts
lapras:  { prefers: HAB.water },                           // preference: more likely near water, still spawns anywhere
wooper:  { prefers: HAB.water, requires: HAB.water },      // restriction: only on water-tagged tiles (skipped elsewhere)
slugma:  { prefers: HAB.rock | HAB.dry, avoids: HAB.water }, // restriction: never on a water-tagged tile
```
- A restricted species that finds no allowed spot is skipped, with a `spawnSkipped` event, never placed somewhere wrong.
- Authored arenas carry no habitat tags, so a `requires` species never spawns there. Use it on generated regions and locations.
- `validateProfiles()` rejects contradictions (every required tag also avoided).

An override replaces defaults field by field: whatever it leaves out keeps its default. `fly` always comes from the roster.

## 11. Prepare behaviour for future HTN AI

Partly implemented: the inputs exist, the planner does not.
- **Today's behaviour.** One of six presets per wild Pokémon (`behaviour` in `content/roster.json`), implemented as one priority chain in `src/sim/enemies.ts`. Bosses use attack kits (`bosses` in `content/roster.json`, `bossThink`).
- **What an HTN domain would read, all already available:**
  - capabilities, preferences and restrictions: `speciesProfile(id)`, `canSwim(...)`;
  - body size: `bodyOf(sp)`, `enemyRadius(...)`;
  - the move set and its interaction verbs: `src/rules/capabilities.ts`, `src/sim/capabilities.ts`;
  - world affordances: `World.habitatAt`, `walkable`, `fitsHeavy`, `flowDir`, `wideDir`, `goalDir`, `wideGoalDir`, `nearestFit`, `shore`, location anchors (`World.anchors`);
  - objective state: `ctx.objective`.
- **To add a new behaviour today,** add a branch to the chain in `enemySystem.update` (`src/sim/enemies.ts`) and a value to `Behaviour` (`src/rules/species.ts`). Keep species-specific logic out of the sim: give a species the behaviour in the roster instead.
- **Not implemented:** an HTN planner, task or method data, per-species behaviour parameters. When that work starts, the natural seam is to replace the `behaviour` branch with a planner call that reads the facts above.
