# Customising Pokémon, sizes, maps and what stands on them

A practical guide to the common changes. Each section names the real file, shows a working example, and says which check to run. After any change, run `npm run check` (typecheck, every test, production build). The background is in docs/SIZING.md, docs/SPAWNING.md, docs/PIPELINE.md and docs/HABITATS.md.

**Where each kind of setting lives:**

| What | File | Rebuild content? |
|---|---|---|
| Which Pokémon exist, and their role (partner, wild behaviour, boss kit) | `content/roster.json` | yes (`npm run content`) |
| Per-species facts: habitat preferences, restrictions, size-class pin | `src/rules/profiles.ts` (`SPECIES_OVERRIDES`) | no |
| Tag Action (optional; one is derived from the Pokémon's own moves) | `src/rules/tags.ts` (`TAG_ACTIONS`) | no |
| Size-class numbers, partner radius clamp, wide-body threshold | `src/rules/defaults.ts` (`size`) | no |
| Training targets | `src/rules/targets.ts` (`RANGE_TARGETS`, `HABITAT_TARGETS`) | no |
| The Hold's Raid party | `RAID_PARTY` in `src/sim/modes/hold.ts` | no |

When two settings disagree, the later one wins:
- **Size class:** `sizeClass` pin → `NEUTRAL_CORE_EXTENT_M` → canonical height → sprite height.

---

## 1. Add a new Pokémon

Implemented. Example: Wooper as a Meadow wild Pokémon.

1. Add it to `wild` in `content/roster.json`. The behaviour is one of `chase`, `tank`, `swarm`, `ranged` (then also `shot`, an element), `charger` or `healer`. Add `"flying": true` for a flyer, or `"flying": false` to ground a Flying type such as Doduo. Both are optional: an entry with no behaviour takes the default role rule (`src/rules/roles.ts`, docs/SPECIES.md "Default roles"), and one with no `flying` takes the rule's flight. A field you set always wins. The key is the PokéAPI Pokémon slug (`aegislash-shield`). If the species' own SpriteCollab folder is empty, `spriteFolders` can pin a form folder (`"falinks": "0003"`); a species with no usable art is skipped and reported, not fatal.
   ```json
   "wooper": { "behaviour": "chase" }
   ```
2. Fetch its sources and rebuild the content. This writes `src/content/pokedex.ts` and `src/content/art.json`; never edit those by hand.
   ```bash
   npm run fetch-sources   # sparse clones into ../src-data (adds Wooper's data, sprite folder and cry)
   npm run content         # imports it; check the log for warnings (missing cry, animations)
   ```
3. Put it on a map, if you want one to meet: a target in a set (`src/rules/targets.ts`, §7). There are no spawn pools since hero-shooter pivot step 9.
4. Optional:
   - a habitat preference in `SPECIES_OVERRIDES` (`src/rules/profiles.ts`): `wooper: { prefers: HAB.water }`;
   - an authored Tag Action in `src/rules/tags.ts`, if the derived one (its earliest damaging move of its own type, then its strongest by Lv 30) doesn't suit;
   - `recruitable: false` with a `recruitableReason` in `SPECIES_OVERRIDES`, to keep it wild only (no Hunt objective offers it).
5. Update the roster pins in `tests/catalogue.test.ts`: species count, sorted id list, move count. They are pinned on purpose, so an accidental roster change fails loudly.

No map, spawning, combat or render code changes. The size class comes from its canonical height (0.4 m: Small). The sim body, drawn size, habitat navigation profile and Tag Action all follow from that.

It also becomes playable on its own: `npx tsx --test tests/playability.test.ts` grades it, and `?dev=1` lists it in the partner screen's All Pokémon view and the tuning panel's Play as list (docs/PLAYABILITY.md). If the test reports it as anything but ready, the reason names what is missing.

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

- **Traversal templates.** Movement capabilities are reusable template rows in `rules.locomotion.templates` (`src/rules/traversal.ts`): `glider` (the player's glide: holding Jump in the air clamps the fall), `fixed-hover` (the wild float: no footprint, no wall test, height and bob from the row), `surface-swimmer` (safe in open water). A species holds a list of them; `traversalOf(species, rules)` in `src/rules/profiles.ts` resolves it, and every system reads that, never the type. docs/LOCOMOTION.md "Capabilities" has the full table.
  - Default list: `"flying": true` in `content/roster.json` gives `glider` + `fixed-hover` (what the flag always meant); a type in `rules.hazards.water.safeTypes` (the Water type) gives `surface-swimmer`. Nothing else is derived from type: Doduo is a Flying type with no capability, Koffing floats with no Flying type.
  - Per species: `traversal: ['glider', 'surface-swimmer']` in `SPECIES_OVERRIDES` (`src/rules/profiles.ts`) replaces the derived list entirely (`[]` grounds a species). At most one template per kind. `ventImmune: true/false` sets the habitat-vent policy separately (default: any air template). Run `npx tsx --test tests/traversal.test.ts`: `validateTraversal()` names unknown templates, duplicates and reserved kinds.
  - Different numbers for one species: add a template row of its own (for example `'high-hover': { kind: 'hover', height: 2, … }`) and name it. Retuning a shipped row changes every species that holds it.
  - What an airborne Jump press does (R6c): `airPress: 'doubleJump'` on any of the species' rows gives one double jump per airtime (for example `'flap-glider': { kind: 'glide', airPress: 'doubleJump' }`); `'takeoff'` waits for the fly and levitate rows of R6d / R6e. A species' rows may give the press one meaning only; `validateTraversal()` names a second one. No shipped row sets it. docs/CONTROLS.md "Jump" has the rules.
  - Controls themselves (keys, pad buttons, the descend default) are not species data: `src/input/bindings.ts`, docs/CONTROLS.md.
  - Not yet: `fly` (sustained flight, R6d), `levitate` (R6e) and `dive` (R8) are reserved kinds; the validator rejects a row of those kinds until their mechanics land.
- **Size and passability.** A physical capability, set per class (`body` in section 3), or per species by pinning its class (section 2). It is not inferred from type.
- **Swimming.** A swim template (above), or knowing a move in `rules.hazards.water.safeMoves` (`src/rules/defaults.ts`; Surf lends it), swims safely. Everything else has the liquid's `lethal` seconds to reach a bank. `canSwim()` in `src/rules/profiles.ts` answers it.
- **Burrowing, aquatic-only movement.** Not implemented. There is no burrow or swim-only locomotion in the sim. A water-only Pokémon would need a new movement mode in `src/sim/enemies.ts`. Until then, use the spawn restriction in section 10 to keep it to water tiles.

## 5. Create a new map

Implemented, at two levels:
- **A Pokémon location** (generated from a definition). Copy `src/world/locations/viridianForest.ts`, change its identity, landforms, `habitat` tags and props, and register it in `src/world/locations/index.ts`. docs/LOCATIONS.md covers the parameters.
- **A habitat recipe** (Hold maps). Add a `HabitatRecipe` to `src/world/habitat/recipes.ts` and follow docs/HABITATS.md. Run its gates, `scripts/habstate.ts` and `scripts/habaudit.ts`, as CLAUDE.md lists.

Then choose it for a biome with `rules.worldgen.locations` (`src/rules/defaults.ts`), or try it with `?loc=<id>`. A new map needs no Pokémon edits: it fields the region's pool unless you give it `spawns` (section 7).

## 6. Modify an existing map

Implemented. Edit its definition file (`src/world/locations/<name>.ts`, `src/world/habitat/recipes.ts`, or `src/world/arenas.ts` for the handcrafted arenas). A change that alters an accepted habitat layout needs a `HAB_VERSION` bump (CLAUDE.md). A location change that alters accepted layouts should bump `LOC_VERSION` (`src/world/locgen/index.ts`). The `wide` gate requires a two-tile route from the hub to the boss hall, every arena and three anchors (docs/LOCATIONS.md). Check a change with `npx tsx scripts/locstats.ts <id> 30 1` and `npx tsx scripts/navwalk.ts <id> 5`.

## 7. Change which Pokémon appear on a map

Implemented, per source (docs/SPAWNING.md). Spawn pools, presets and `?pool=` were deleted at hero-shooter pivot step 9; they are on the `survivor-final` tag.
- **Training targets:** edit or add a `TargetSet` in `src/rules/targets.ts`: each target is a species, a kind (`dummy`, `patrol`, `strafe`), an anchor (`spawn`, `contest`, `stageA`, `stageB`) with an offset, and a patrol's loop. Check with `npx tsx --test tests/range.test.ts`.
- **The Hold's Raid party:** edit `RAID_PARTY` in `src/sim/modes/hold.ts`. It moves the `gorge-hold` replay: re-record it with `npx tsx scripts/checksum.ts scenarios --update` and say why in the commit.

## 8. Adjust spawn weights and conditions

Not implemented since the pools went. A Raid party member's species is an even draw from its list; repeat an id to weight it (it moves `gorge-hold`). The co-op wave (T1) will bring its own rules.

## 9. Create a reusable spawning preset

Not implemented since the pools went: a target set (section 7) is the reusable unit.

## 10. Define an environmental restriction, preference or override

Implemented, in `SPECIES_OVERRIDES` (`src/rules/profiles.ts`), using `HAB` tags (`meadow`, `grass`, `water`, `rock`, `dry`, `forest`):
```ts
lapras:  { prefers: HAB.water },                           // preference: data only (nothing reads it as odds since the pools went)
wooper:  { prefers: HAB.water, requires: HAB.water },      // restriction: only on water-tagged tiles (skipped elsewhere)
slugma:  { prefers: HAB.rock | HAB.dry, avoids: HAB.water }, // restriction: never on a water-tagged tile
```
- A restricted Raid party member that finds no allowed spot is skipped, with a `spawnSkipped` event, never placed somewhere wrong (`allowedAt`, `src/sim/placement.ts`).
- Authored arenas carry no habitat tags, so a `requires` species never spawns there. Use it on generated regions and locations.
- `validateProfiles()` rejects contradictions (every required tag also avoided).

An override replaces defaults field by field: whatever it leaves out keeps its default. `fly` always comes from the roster.

## 11. Prepare behaviour for future HTN AI

Partly implemented: the inputs exist, the planner does not.
- **Today's behaviour.** One of six presets per wild Pokémon (`behaviour` in `content/roster.json`), implemented as one priority chain in `src/sim/enemies.ts`. Bosses use attack kits (`bosses` in `content/roster.json`, `bossThink`).
- **What an HTN domain would read, all already available:**
  - capabilities, preferences and restrictions: `traversalOf(species, rules)`, `speciesProfile(id)`, `canSwim(...)`;
  - body size: `bodyOf(sp)`, `enemyRadius(...)`;
  - the move set and its interaction verbs: `src/rules/capabilities.ts`, `src/sim/capabilities.ts`;
  - world affordances: `World.habitatAt`, `walkable`, `fitsHeavy`, `flowDir`, `wideDir`, `goalDir`, `wideGoalDir`, `nearestFit`, `shore`, location anchors (`World.anchors`);
  - objective state: `ctx.objective`.
- **To add a new behaviour today,** add a branch to the chain in `enemySystem.update` (`src/sim/enemies.ts`) and a value to `Behaviour` (`src/rules/species.ts`). Keep species-specific logic out of the sim: give a species the behaviour in the roster instead.
- **Not implemented:** an HTN planner, task or method data, per-species behaviour parameters. When that work starts, the natural seam is to replace the `behaviour` branch with a planner call that reads the facts above.
