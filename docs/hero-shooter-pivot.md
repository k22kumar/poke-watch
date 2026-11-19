# Hero-shooter pivot: inventory

Status: **inventory only, 2026-11-19.** Nothing has been deleted or changed. The removal plan is still to be grilled.

- **Direction.** Develop the hero-shooter core (map traversal, movement, aiming, combat). Remove the survivor run and its upgrade loop.
- **Last survivor state.** It is tagged `survivor-final` (annotated tag on `6e9b63e`, pushed to origin with `git push origin survivor-final`). Everything listed as "remove" stays recoverable from that tag.
- **`main` is already live.** `origin/main` was pushed on 2026-11-18 at 22:56 (`092a487`, the size-flag flip) and on 2026-11-19 at 09:08 (`6e9b63e`, the S2 roster import and its follow-up) (`git reflog show origin/main`). `.github/workflows/deploy.yml` deploys on every push to `main`, so the live GitHub Pages site already runs the size-extremes, F3 framing and S2 catalogue-wave changes. The tag and `origin/main` point at the same commit.

Verdicts:

- **Remove**: survivor-only. Nothing in the hero-shooter core needs it once its call sites are cut.
- **Keep**: shared foundation, which the core is built from.
- **Split**: one file or system that does both. The survivor half goes, the foundation half stays.

Line counts are today's (`wc -l`), to size the work.

---

## 1. Summary

| System | Verdict | Main files |
|---|---|---|
| Director, waves, ring swarms, elites/alpha timers, beat director, weather events | **Remove** | `src/sim/director.ts` (303) |
| Enemy difficulty curves (HP/speed/toughness over stage time) | **Remove** | `src/sim/enemies.ts:28-55` |
| XP, gems, magnet, heal/magnet drops | **Remove** | `src/sim/progression.ts` (`gainXp`, `pickupSystem`), `src/sim/combat.ts:218` (`dropXp`) |
| Levels | **Split** | level feeds stat growth and move scaling, which stay as a fixed hero level (§3.3) |
| Evolution by level | **Split**: remove the XP/level trigger, keep the evolution transition for a future rest-gated trigger (§2.4) | trigger: `progression.ts:332-360`; transition: `finishEvolution`, `ctx.state 'evolving'`, renderer, camera |
| Level-up cards, rerolls/skips/banishes | **Remove** | `progression.ts:86-370` |
| Build layer: transforms, techniques, mastery, wildcards | **Remove** (data and offers); **Split** (`sim/techniques.ts` helpers) | `src/sim/build.ts` (438), `src/rules/build.ts` (164), `src/sim/techniques.ts` (72) |
| Items: vitamins, chests (item balls), pickups UI | **Remove** | `rules.vitamins`, `world.chests`, `src/ui/items.ts`, `src/ui/icons.ts` (vitamin glyph) |
| Run timer, stages/regions sequence, portal, final swarm, victory | **Remove** | `src/sim/run.ts` (`startStage`/`nextStage`/portal), `rules.stage`, `src/rules/stages.ts` |
| Bosses (boss kits, phases, boulders) | **Remove** (for now) | `enemies.ts:508-644` `bossThink`, `rules.bosses`, roster `bosses` |
| Objectives: Hunt, Transport | **Remove** | `src/sim/objectives.ts` (233) |
| Objective: Hold | **Split**: candidate hero-shooter mode (§5) | `objectives.ts`, habitat `ModeGraph` |
| Recruiting (Hunt rewards, v8 recruit offers) | **Remove** | `src/sim/squad.ts:152-216` |
| Squad and Tag (three partners, swap, Tag Actions) | **Keep** (owner call: a hero kit or a team) | `src/sim/squad.ts`, `src/rules/tags.ts` |
| Spawn pools and region presets | **Split** (§4) | `src/rules/spawning.ts` (247), `rules.spawning` |
| Compositions and enemy roles (raider, mender, bulwark, hexer, hunt) | **Remove**, salvage roles as bot behaviours | `src/rules/compositions.ts` (102), `enemies.ts` roles |
| Survival scripts (balance and bot sweeps) | **Remove** | `scripts/headless.ts`, `h2.ts`, `h6.ts`, `h8b.ts`, `worldsurvival.ts`, `locsurvival.ts` |
| Bot harness | **Split** (§6) | `src/sim/bot.ts` (181), `scripts/lib/aimbot.ts` |
| Checksum layers | **Split**: replaced by a new baseline (§7) | `scripts/checksum.ts` (141), `src/sim/checksum.ts` |
| Modes and mods (Classic, Survival, Glass Cannon, Boss Rush; Vampiric, …) | **Split**: keep the mechanism, drop survivor modes | `src/mods/index.ts`, `src/mods/types.ts` |
| Locomotion, player controller, world, collision, navigation | **Keep** | `sim/locomotion.ts`, `sim/player.ts`, `sim/world.ts`, `world/navblocks.ts` |
| Aim, spatial queries, shots, beams, moves, damage, abilities | **Keep** | `sim/aim.ts`, `sim/spatial.ts`, `sim/effects.ts`, `sim/moves.ts`, `sim/combat.ts`, `rules/moves.ts`, `rules/abilities.ts` |
| Systemic layer: capabilities, bodies, cells, coats, props, hazards, caplog | **Keep** | `sim/capabilities.ts`, `bodies.ts`, `cells.ts`, `coats.ts`, `props.ts`, `hazards.ts`, `caplog.ts` |
| Size, traversal, profiles, species roster, content pipeline | **Keep** | `rules/sizing.ts`, `extent.ts`, `shapes.ts`, `traversal.ts`, `profiles.ts`, `species.ts`, `src/content/*` |
| Worldgen: habitat recipes, Pokémon locations, classic generator, arenas | **Keep** (habitats are already team maps, §5) | `src/world/**` |
| Camera, renderer, input, audio engine | **Keep** (they lose some event reactions) | `src/render/**`, `src/input/**`, `src/audio/**` |
| Maplebrook overworld | **Untouched**: not part of the survivor loop | `src/overworld/**`, `src/rules/originals.ts` |

---

## 2. Survivor loop systems

Each entry lists the files, then what depends on it: tests, gates and scripts, docs, and CLAUDE.md rules.

### 2.1 Director and waves

- **Files**
  - `src/sim/director.ts`:
    - spawn accumulator, live cap ramp and swarm clusters of 4
    - elites every 40 s and ring swarms every 55 s
    - the alpha at 3:30 (v8 pacing)
    - the boss at 5:00 and the final swarm at 8:00
    - beat director (Build/Peak/Relax), Peak events, regional weather
    - `pickSpawn`/`allowedAt`/`spotFor`: placement, habitat preference and compatibility re-rolls
  - `src/sim/enemies.ts:28-55`: `stageIndex`, `hpMultiplier`, `toughness`, `speedFactor`, the difficulty curves over stage minutes.
  - `src/sim/enemies.ts:223-240`: far-behind relocation, which moves an enemy more than `despawnDistance` (46 m) away into a ring ahead of the player.
  - `rules.director`, `rules.beats`, `rules.enemy.spawnRadius`/`liveCap`/`despawnDistance`, `rules.spawning.preference`/`retries`.
- **Salvage before removing**
  - `allowedAt` + `World.nearestFit` (`director.ts:151-215`) is the only code that places a wide footprint legally. A target or bot spawner needs it, so move it to a neutral module (e.g. `sim/placement.ts`) first.
  - `spawnEnemy` (`enemies.ts:56`) stays. It is the actor constructor.
- **Tests**
  - `phase7.test.ts`: beats, compositions, objectives; 25 survivor references.
  - `sim.test.ts`, `combat.test.ts`, `spatial.test.ts` and `habtac.test.ts` drive the director through the bot.
  - About 40 test and script call sites silence it with rule hacks: `director: { spawnBase: -99, … }`, `objectives: { firstAfter: 1e9 }`, `beats: { enabled: false }`. That pattern is the clearest sign the foundation tests want "no director". It is also the first seam to cut (§8 step 1).
- **Gates and scripts**
  - `perf-sim.ts` workload: director boosts on the authored arenas, 240 s, meadow pool.
  - `stuckwatch.ts`: live bot runs against director crowds.
  - `habtac.ts`, `habplay.ts --raid`: the Raid party is director/objective spawned.
  - Every `checksum.ts` set.
- **Docs**
  - `ENCOUNTERS.md`: the director, beats, objectives and compositions, all survivor.
  - `SPAWNING.md` "Four questions": selection and location.
  - `HABITAT_PLAYTEST.md`: tactical Holds under "the director's ordinary" spawns.
  - `ANALYSIS.md` and `FIDELITY.md`: the PokéBonk comparison, a historical record only.
- **CLAUDE.md**
  - The "Hold Raid party … `despawnDistance` (46) relocates …" rule.
  - "Spawn pools … sim systems read `ctx.spawnTable`".

### 2.2 XP

- **Files**
  - `progression.ts`: `xpNext`, `gainXp`, `pickupSystem`.
  - `combat.ts:218` `dropXp`: gems, gem merging, heal and magnet drops, all on `rng.combat`.
  - `pools.ts` `PickupPool`, `rules.xp`, `rules.pickups`, `Member.derived.magnet`, `rules.player.magnetRadius`/`pickupRadius`.
  - Renderer gem/pickup sprites (`renderer.ts:1164-1235`), HUD XP bar (`ui.ts` `update`).
- **Tests**: `banked.test.ts`, `sim.test.ts`, `build.test.ts`, `combat.test.ts`, `identity.test.ts`.
- **Gates**
  - `checksum.ts` `legacyHash` and `src/sim/checksum.ts` `stateHash` both hash `stats.xp`, `P.xp` and `P.level`.
  - `bot.ts` drifts toward gems.
- **Docs**: `BUILDS.md`, `ANALYSIS.md` (the [C] XP formula).
- **Trap**: `dropXp` draws from `rng.combat`. Removing it shifts every later combat draw (crits, ailments), so removal can never be hash-neutral on a run with kills (§7).

### 2.3 Levels

- **Files**
  - `P.level` feeds `recomputeMember` (`progression.ts:26`): HP, Atk and SpA grow with level, `hpPerLevel`.
  - It also feeds:
    - `moveSlots` / `lateSlotLevel`
    - `squad.ts:44`: Tag Action level
    - `squad.ts:216`: Tag variant unlock at `variantLevel` 18
    - `cells.ts:313`: burn strength
    - `capabilities.ts:231`: deflect damage
    - `coats.ts:66`: tile coat strength
  - Move levels: `MoveSlot.level`, `moves.ts:72-76` scaling, `rules.moves.maxLevel`/`levelDmg`, and `build.ts` mastery (`masteryLevel`/`applyMastery`), which sets slot levels from squad level.
  - UI: `ui.ts:601` level, `:647` slots, `:661` pips, and card text.
- **Split proposal**: replace the run-time level with a **fixed hero level** (e.g. `rules.hero.level`), so every formula above keeps working with no code change in combat. Whether heroes later get hand-tuned stat profiles instead is a grilling question.
- **Tests**: `squad.test.ts`, `identity.test.ts`, `playability.test.ts`, `caps.test.ts` (level in formulas), `build.test.ts`.
- **Docs**: `BUILDS.md` (mastery), `SQUAD.md` (variant level), `SYSTEMIC.md` (level terms in deflect/burn).

### 2.4 Evolution: a split, not a removal

The owner's control-scheme decisions keep evolution as a mechanic with a future **rest-gated trigger**. Only the XP/level trigger goes. The transition stays and must keep working when something other than a level calls it.

- **Remove: the triggers**
  - The level check in `maybeOpenCards` (`progression.ts:332-360`): `P.level >= sp.evolveLevel` starts the cinematic. Bench members evolve on level with no cinematic (`benchEvolve`, `:335-345`).
  - `build.ts:388` `evolveNow` (the early-evolution wildcard), card kind `'evolve'`, `rules.build.evolveWithin`, `weights.evolve`.
  - The Transport reward, the evolution stone (`objectives.ts:152-165`).
  - The help text at `ui.ts:1217` ("Partners evolve at their real levels").
- **Keep: the transition**, moved out of `progression.ts` into its own module (e.g. `sim/evolution.ts`) with a `startEvolution(ctx, memberIndex)` entry for the future trigger:
  - **Swap**:
    - the `ctx.state === 'evolving'` modal (`run.ts:147`, world frozen for `rules.sim.evolveSeconds` 2.4 s)
    - `finishEvolution` (`progression.ts:370`): species swap, `recompute`, full heal, `evolveEnd`
    - events `evolveStart`/`evolveEnd` and the bench variant `benchEvolve`
    - the renderer's alternating sprite (`renderer.ts:891-904`) and the `evolveEnd` burst (`:489`)
    - UI overlay `overlay-evolve` (`ui.ts:967-976`, `main.ts:473`)
    - audio `onEvolveStart`/`onEvolveEnd` and cries (`main.ts:287-288`)
  - **Size change**: the new species' `bodyOf`/`partnerFootprint`/`partnerHeight` (`src/rules/sizing.ts`) apply on the next tick with no extra code. Keep it that way: evolution never sets a body size itself.
  - **Eased camera tilt**: `chaseTilt` and the arm ease over `frame.settle` 0.45 s on any outline change (`src/render/camera.ts:243-245`, `docs/THIRD_PERSON_IMPLEMENTATION.md` §26 "Exception to §24.2", `docs/THIRD_PERSON.md:89`).
  - **Grow check**: a body that grows in a tight spot must get out, never further in.
    - `World.moveBody` accepts a move only when the overlap does not grow (`docs/SIZING.md:124`).
    - A head already inside a deck slab rises no further (`src/sim/locomotion.ts:262`, `docs/SIZING.md:174`).
    - A footprint left off the field walks to the cheapest reached block within 2 tiles (`src/sim/world.ts:884`).
    - These are general rules today, not evolution code. The future trigger should add an explicit test that evolves a partner inside a corridor and under a deck.
  - **Cut from the transition**: `finishEvolution` calls `queueVariant` (Tag variant offer on the first evolution) and `maybeOpenCards`. Both go with recruiting and cards. Whether the Tag variant comes back is a grilling question.
  - **Data**: the roster's `evolvesTo`/`evolveLevel` and `lineage()` stay. Learnsets and Tag lines read the whole line. `evolveLevel` stops being a trigger but can rank evolutions.
- **Tests**: `build.test.ts` (evolve cards, removed), `squad.test.ts`, `identity.test.ts`. There is no test of the transition on its own yet; add one when it moves module (swap, heal, size, the `evolving` freeze).
- **Docs**: `BUILDS.md`, `SQUAD.md`, `SIZING.md` (evolved partners' radii), `THIRD_PERSON.md`.

### 2.5 Builds and upgrades

- **Remove**
  - `src/sim/build.ts`: three-card offers, Kit/Technique/Wildcard pools, transforms, mastery, swap.
  - `src/rules/build.ts`: the transform and technique data, `TB` bits.
  - `progression.ts:86-370`: cards, rarity, reroll/skip/banish, banked picks, `openOffer`/`openSpecial`/`maybeOpenCards`.
  - `ctx.cards`, `ctx.build`, `InputFrame.card`, `rules.cards`, `rules.build`.
  - `ui.ts:759-965`: the card screens; `tools/slotcheck.mjs`/`traycheck.mjs` (if card-only).
- **Split**: `src/sim/techniques.ts` is imported by `bodies`, `capabilities`, `caplog`, `cells`, `coats`, `combat`, `effects`, `moves`, `player` and `squad`.
  - With no technique held, every helper returns the Phase 8a value. So removal is mechanical: inline the identity path, then delete the file.
  - `P.techMask` and `TB` reads in `player.ts` go too.
- **Mods hooks**: `onLevelUp` and `filterCards` in `HookRunner` (`run.ts:42`) and `src/mods/types.ts`.
- **Tests**
  - `build.test.ts`: 116 survivor references; whole file.
  - `banked.test.ts`, plus parts of `caps.test.ts` and `beam3d.test.ts` (which imports `sim/build`).
  - `caps.test.ts:504` and `build.test.ts:745` pin hashes under `CLASSIC_REGIONS`.
- **Gates**: `h8b.ts` (build sweeps), `h2.ts`, the bot's `cardPolicy`.
- **Docs**: `BUILDS.md` (whole), `ICONS.md` (survival-only item mapping).

### 2.6 Items

- **Files**
  - `rules.vitamins` and `Member.vitamins` (the legacy flag `build.legacyNumeric`).
  - `world.chests` (item balls, placed by worldgen) and `progressionSystem` chest opening.
  - `src/ui/items.ts` (looks for upgrades and pickups), the vitamin glyph in `src/ui/icons.ts`, renderer chest sprites (`renderer.ts:1200`).
  - Pickups are listed under 2.2.
- **Watch**: chests are placed by the world generators (arenas, gen, locgen, habitats). Removing their placement can move layouts, which means a `HAB_VERSION` or `LOC_VERSION` question. Prefer leaving placement and ignoring the chests at first.
- **Tests**: `world.test.ts`/`worldgen.test.ts` (chest counts, if any), `build.test.ts`.
- **Docs**: `ICONS.md`, `BUILDS.md`.

### 2.7 Run timer, stages, final swarm, victory

- **Files**
  - `run.ts`:
    - `startStage` (region pool, world build per stage with seed `seed + stage × 7919 + loop × 104729`)
    - `nextStage`, the portal, the `transition`/`victory`/`over` states
    - `ctx.stage`/`loop`/`stageTime`, the revive at a portal
  - `rules.stage` (`count` 4, `bossAt` 300, `finalSwarmAt` 480, `portalRadius`).
  - `src/rules/stages.ts` (`STAGES`, `BIOMES`).
  - `rules.mode.endless`/`difficulty`.
  - UI: the timer and boss countdown (`ui.ts:608-610`), the stage banner, the end screen; the portal draw (`renderer.ts:1154, 1236`).
- **Split**: biomes (`BIOMES`: ground set, colours, props) are map dressing and stay. Only the four-stage run sequence goes. A match needs its own clock and end condition (§5).
- **Watch**: `ctx.world` is rebuilt inside `startStage`, and its seed formula decides every shipped layout. A match start must call the same `new World(...)` with the same seed to keep maps identical.
- **Tests**: `sim.test.ts`, `crossrun.test.ts`, `habitat.test.ts` (stage flow), `world.test.ts`.
- **Docs**: `ui.ts` help, `README`, `WORLDGEN.md` (regions per stage), `HABITATS.md` ("builds every region").

### 2.8 Bosses

- **Files**
  - `enemies.ts:508-644` `bossThink` (phases, kit attacks, boulders).
  - `ROLE.boss` branches throughout `enemySystem`.
  - The roster `bosses` (Sudowoodo, Magcargo, Articuno, Houndoom) with boss kits, `rules.bosses`, `rules.enemy.roles.boss`.
  - Events `bossSpawn`/`bossPhase`: `main.ts`, hitstop and shake in `rules.feel`.
  - Habitat profile `boss` (`world/habitat/mode.ts:96`), which is non-essential.
- **Grilling item**: bosses could come back as a PvE mode. Removing them is cheap to undo from the tag.
- **Tests**: `phase7.test.ts`, `spawning.test.ts` (boss-not-in-spawns rule), `combat.test.ts`.
- **Docs**: `ENCOUNTERS.md`, `SPECIES.md`.

### 2.9 Objectives and recruiting

- **Files**
  - `src/sim/objectives.ts`: Hold, Hunt, Transport, their schedule and rewards (`openOffer`, recruits, evolution).
  - `squad.ts:152-216`: `addMember`, `maybeOfferRecruit`, recruit offers, variant queue.
  - `ctx.recruit`, `rules.objectives`, `rules.squad.recruitAfter`.
- **Split**
  - **Hold** is a control point. Every habitat recipe is already built around one (§5).
  - **Transport** (carry or push the egg to a goal) is a payload in all but name.
  - Hunt and recruiting are survivor-only.
- **Gates**
  - `habplay.ts all 6 1 --raid`, `habtac.ts`, `habstate.ts`, `habtide.ts` and `habsanct.ts` drive the real Hold.
  - `tests/habitat.test.ts`, `habtac.test.ts` and `habsanct.test.ts` assert it.
- **CLAUDE.md**: the "Habitat maps" section (gate list, Hold Raid party rule).
- **Docs**: `ENCOUNTERS.md`, `HABITAT_PLAYTEST.md`, `HABITATS.md` (Hold contract), `SQUAD.md` (recruits).

---

## 3. Spawn pools, survival scripts and other splits

### 3.1 Spawn pools

- **Files**
  - `src/rules/spawning.ts`: presets, layers, `waveOn`, `spawnableSpecies`, validators.
  - `rules.spawning` (`regions`, `waves`, `everyWildSkips`, `override`, `preference`).
  - Map pools (`spawns` on locations and recipes; none set), `mapSpawnPool` (`world/maps.ts`), `?pool=` (`main.ts:188`), `ctx.spawnTable`.
- **The coupling that matters**: worldgen reads the pools.
  - `profilesFor` (`src/world/habitat/mode.ts:82`) sizes the habitat navigation profiles (`wild-small`, `wild-elite`) from `spawnableSpecies`.
  - `startStage` passes the table's species to `new World(...)`, which the classic generator's habitat gate reads (only `requires`, and none is set).
  - Today the profiles are pinned by floors: `VALIDATED_ELITE_R` 1.42, Tiny 0.30, `bodyCap` 0.95. So the pools barely move them.
  - Even so, deleting `spawnableSpecies` without freezing those numbers first would change validated layouts. That would need a `HAB_VERSION` bump and a new `docs/habaudit/baseline.json`.
- **Proposal**: replace the pool input to `profilesFor` with explicit **profile constants**, the values the shipped maps were accepted against. Do it hash-neutral and layout-neutral before the pools go.
- **Split**: per-species `prefers`/`requires`/`avoids` (`profiles.ts`) and the size/traversal facts stay (bots and targets need them). Region presets, waves and `everyWild` go.
- **Tests**: `spawning.test.ts` (38 references), `profiles.test.ts`, `squad.test.ts:24-33`, `habitats.test.ts:31-36`, `catalogue.test.ts` (roster membership, unaffected).
- **Docs**: `SPAWNING.md`, `CUSTOMISING.md` (spawn sections), `SPECIES.md` (region table), `size-extremes-plan.md` §S2.10/§S2.12.
- **CLAUDE.md**: "Spawn pools live in `src/rules/spawning.ts` …", the catalogue-wave checksum notes.
- **Open grilling**: the stopped region-pool grilling (Q1–Q5 settled, Q6–Q9 open) is moot if pools are removed.

### 3.2 Survival scripts

| Script | What it measures | Verdict |
|---|---|---|
| `scripts/headless.ts` (`npm run sim`) | survival, kills, level per species/mode | Remove (or rewrite as a match runner) |
| `scripts/h2.ts` | Tag-rotation damage bound (H2) | Remove |
| `scripts/h6.ts` | objectives engaged vs ignored (H5/H6) | Remove |
| `scripts/h8b.ts` | build-layer balance sweeps | Remove |
| `scripts/worldsurvival.ts` | W3 survival gates on generated regions | Remove; its geometry gates live in `worldstats.ts` |
| `scripts/locsurvival.ts` | bot playtest of location maps | Remove |
| `scripts/perf-sim.ts` | sim cost per tick at a crowd size (director-boosted) | **Split**: keep the gate, replace the workload with N bots/targets |
| `scripts/stuckwatch.ts` | movement deadlock watch over live bot runs | **Split**: keep the watch, replace the crowd source |
| `scripts/habplay.ts`, `habtac.ts` | scripted Hold runs with the Raid party | **Split**: keep if Hold becomes a mode |
| `scripts/camstats.ts`, `camaim.ts`, `shotbench.ts`, `spatialbench.ts` | camera/aim/shot benches that use the bot for motion | Keep; swap the bot for a scripted mover where it needs enemies |
| `navwalk`, `hazplay`, `habstate`, `habvent`, `habtide`, `habaudit`, `jumptiming`, `firetiming`, `covercheck`, `sizegiants`, `sizetable`, the `*stats`/`*sheet`/`habgeom`/`hablagoon`/`habsanct`/`habgraves`/`habcam` geometry tools | traversal, hazards, generation, aim | Keep (several silence the director with the `spawnBase: -99` hack, cleaned up in §8 step 1) |

### 3.3 Other splits

- **Squad and Tag** (`squad.ts`, `rules/tags.ts`, `rules.squad`):
  - Three partners, the swap, Tag Actions and grey health are combat. They fit a hero with three forms or a three-hero team.
  - Recruiting goes. A squad becomes a loadout chosen before the match.
- **Enemy roles** (`ROLE.*`, `rules.roles`, `compositions.ts`): raider, mender, bulwark, hexer and hunt were authored for the director's Peaks. They are reusable as bot behaviours, but compositions themselves go.
- **Modes and mods** (`src/mods/index.ts`):
  - Keep the `Mode`/`Mod` mechanism: rule layers, `systems` edits, hooks.
  - Survivor modes (Classic, Survival, Glass Cannon, Boss Rush) and survivor mods (Vampiric, No heal cards, Volatile) go or are rewritten for matches.
  - `checksum.ts` CONFIGS name Classic, Survival and Boss Rush.
- **SimContext / types** (`src/sim/types.ts` 480 lines): drop `stage`, `loop`, `portal`, `cards`, `build`, `recruit`, `beat`, `director`, `objective` (if not Hold), `pickups`, `stats.xp`, `stats.bosses`, `Player.xp`/`xpNext`/`pendingLevels`, `Member.vitamins`.
  - `ctx.players[]` already exists. The sim hashes every player (`stateHash`), which is the seam for bots as players (§5).
- **RNG streams**: `rng.cards` becomes unused. `rng.spawn` is the director's and also the objectives' (`site`). Streams are seeded by name (`streamSeed(seed, 'spawn')`), so dropping one does not shift the others.
- **UI** (`ui.ts` 1479 lines): remove the cards, evolution banners, run timer, boss countdown, XP bar, recruit screen and end-of-run summary. Keep the title, settings, bindings, help, pause, HUD health and moves, the crosshair, awareness/threat ring and the dev roster.
  - The partner-select screen (`openSelect`) becomes hero select.
  - The tagline "A Pokémon survival fan game across four handcrafted regions" changes.
- **Render, audio, main** react to survivor events: `levelUp`, `chest`, `pickup`, `evolve*`, `bossSpawn`, `bossPhase`, `finalSwarm`, `swarm`, `objective`, `recruit`, `portal`, `stageStart`, `victory`.
  - Those handlers go with their events.
  - `src/audio/adaptive.ts` picks its score state from `inRun`, `enemiesNear`, `enemies` and `boss` (the `climax` state is boss-driven), so it needs a match-intensity input once bosses go.
  - Only `checksum.ts`, `coats.ts:259` and `spatial.ts` iterate `ctx.players`. Every other system reads `ctx.player`.
- **Browser checks**: `tests/browser/play.py`, `menus.py`, `tools/phase7scenes.json`, `squadscenes.json`, `uiscenes.json` and `habplayscenes.json` script survivor flow. They are rewritten with the new menus.

---

## 4. Shared foundation (keep)

Each item notes the survivor reach it still has.

| Area | Files | Survivor reach to cut |
|---|---|---|
| Locomotion seam (R6a–R6c) | `sim/locomotion.ts`, `sim/player.ts`, `rules/traversal.ts`, `rules/capabilities.ts` | `player.ts` reads `TB` technique bits |
| World and collision | `sim/world.ts` (1263), `world/navblocks.ts`, `world/tiles.ts`, `World.moveBody`/`nearestFit` | `world.chests`, flow field (enemy navigation: keep for bots) |
| Aim and spatial | `sim/aim.ts`, `sim/spatial.ts`, `InputFrame.aim`/`press` | none |
| Moves and damage | `sim/moves.ts` (1038), `sim/effects.ts`, `sim/combat.ts`, `rules/moves.ts`, `rules/elements.ts`, `rules/abilities.ts` | slot level (2.3), `dropXp` in `combat.ts`, the `rules.damage` "sleep bonus/hooks" from mods |
| Systemic | `sim/capabilities.ts`, `bodies.ts`, `cells.ts`, `coats.ts`, `props.ts`, `hazards.ts`, `caplog.ts`, `rules/reactions.ts`, `surfaces.ts`, `materials.ts` | technique helpers (2.5), level terms (2.3) |
| Enemy actors | `sim/enemies.ts` steering, behaviours (chase, charger, ranged, tank, healer, swarm), `spawnEnemy`, `sim/pools.ts` | difficulty curves, relocation, boss branch, objective branches (Hunt flee, Raider) |
| Size and species | `rules/sizing.ts`, `extent.ts`, `shapes.ts`, `profiles.ts`, `roles.ts`, `species.ts`, `playability.ts`, content pipeline | `playability.ts` imports `progression` (`firstAttacks`/`openingMove`: move these to a neutral module) |
| Worldgen | `world/habitat/**`, `world/locations/**`, `world/locgen/**`, `world/gen/**`, `world/arenas.ts`, `world/maps.ts`, `world/replay.ts` | `profilesFor` pool input (3.1), chest placement (2.6), per-stage biome choice |
| Camera, render, input | `src/render/**`, `src/input/**` | survivor event reactions, gem/portal/chest sprites |
| Core | `src/core/**` (rng, detmath, grid, util) | none |

Gates that stay as they are: `navwalk.ts all 5`, `hazplay.ts`, `habstate.ts`, `habaudit.ts`, `typecheck`, the camera suites, `catalogue.test.ts`.

---

## 5. What replaces the waves

The habitat maps are already team maps. `src/world/habitat/types.ts` `ModeGraph` has team spawns, staging A and B, `direct`/`flank` approaches, a contest area and exits, with `objective: 'hold'`. Raid parties already spawn at team B's staging. So the targets have a natural home.

The proposal, in three steps, each usable on its own:

1. **Training range (T0).** Map-authored target sets instead of a director.
   - A `TargetSet` rule is data: species, position or anchor (`ModeGraph` role, location anchor), behaviour, and respawn delay.
   - **Dummy** targets stand still. **Patrol** targets walk a fixed loop on the existing locomotion seam and flow field. **Strafe** targets reuse the `ranged` behaviour (keep distance, shoot) with damage scaled down.
   - Each is an ordinary `spawnEnemy` actor with size-class bodies and hurtboxes, so aim, beams, cover and hit tests all work unchanged.
   - Placement goes through the salvaged `allowedAt`/`nearestFit`.
   - Respawn is on a fixed tick count: deterministic, no RNG.
   - A shooting gallery on any map tests the whole core (traversal, aim, damage, cover) with nothing survivor-shaped.
2. **Enemy bots (T1).** Wild actors with existing behaviours (chase, charger, ranged, tank, healer) spawned in fixed squads at team B's staging. They push the Hold point on habitat maps, as the Raid party does today.
   - Reuses `enemySystem` steering and the Raider role, minus the director, difficulty curves and relocation.
   - Ends when the squad is down or the point is held: a first match loop.
3. **Hero bots (T2, the real target).** Opponents that are *players*: a `Player` in `ctx.players[]` driven by a bot controller that emits `InputFrame`s (move, jump, aim ray, press).
   - Symmetric combat: the same moves, cooldowns, Guard/Dash/Reflex, Tag and locomotion as the human.
   - Needs:
     - per-player teams in damage (`damagePlayer`/`damageEnemy` today assume one side)
     - per-player systems (`playerSystem` and `movesSystem` iterate `ctx.player` only)
     - an aim controller like `scripts/lib/aimbot.ts`
   - This is the R7 "AI steering" the locomotion seam was built for (`docs/LOCOMOTION.md`).

**Recommendation**: build T0 first and use it as the new replay baseline (§7). T1 is then a short step. T2 is its own staged plan.

---

## 6. The bot harness

`src/sim/bot.ts` today:

- kites from the enemy centroid
- drifts to XP gems
- walks to objectives (`botObjectives`) and the portal
- orbits the map centre
- picks cards (`cardPolicy`: first / random / plan)
- presses fire when an enemy is in basic reach

`scripts/lib/aimbot.ts` adds a chase-camera crosshair ray.

- **Users**
  - `checksum.ts` (every set), `perf-sim`, `stuckwatch`
  - `camstats`, `camaim`, `shotbench`, `spatialbench`, `habtac`
  - `h2`, `h6`, `h8b`, `headless`, `worldsurvival`, `locsurvival`
  - tests `sim`, `crossrun`, `camfollow`, `camstability`, `locations`, `world`, `worldgen`, `phase7`, `playability`, `spatial`
- **Split**
  - Keep the movement core (kite, orbit, shore avoidance via `shoreFor`, footprint-aware turning) and the aim layer.
  - Remove gems, cards, objectives and portal.
  - Long term the bot becomes the T2 hero-bot controller, so one module drives both the harness and the opponents.
- **Known limits to fix in the rewrite**
  - The bot never sends a crosshair ray, so only the `aim` sets reach `spatial.ts`.
  - It never sends jump presses, which is why `legacyHash` misses `vy` and jump state (R6a "strict oracle" note).
  - It carries module-level state (`cardPolicy`, `botRng`, the shore cache leak fixed in `5d85b19`). Move that state into the bot instance.

---

## 7. The checksum layers and a fresh baseline

Today, `scripts/checksum.ts` has:

- **26 sets** over 4 bot replays (Cyndaquil, Totodile, Bulbasaur, Charmander; classic, survival and boss-rush modes; 240–420 s)
- **3 deck replays** (Onix and Wailord on Mt. Moon)

Every set except `on`, `gen`, `aim`, `aim-off` (must equal `on`), `deck`, `deck-tall` (pinned flags, the only xlTall routing replay) and `deck-xl` is an *older layer* that turns a feature flag off and must print an older commit's hashes. Expected hashes live only in docs (`size-extremes-plan.md`, ledgers), not in a test.

The replays are survivor runs: the director, XP drops on `rng.combat`, cards and objectives all shape them. So:

- **No removal step can keep today's hashes.** Removing the director or `dropXp` changes every replay with a kill. The older layers then guard nothing anyone still runs.
- **The tag keeps them.** `survivor-final` reproduces every current hash. Anyone who needs an old layer checks out the tag.

Proposal: build the new baseline *before* removing anything, so removal steps can be verified against it.

1. **New replay scenarios on the foundation only.** Each is a map (habitat recipe + seed, location, arena), a hero, a T0 target set and a scripted input track, plus the aim bot for the spatial path. The track covers:
   - move, jump (buffered and coyote presses), dash, guard
   - aim pitch extremes, primary and Move A/B, Tag
   
   All run with the director, objectives, beats and progression switched off by one flag (§8 step 1). Nothing survivor-shaped runs inside them.
2. **Hash with `stateHash`, not `legacyHash`.** `stateHash` covers every player, squad members, jump-control state and the prop overlay. Add `vy` and the target set's state.
3. **Commit the expected hashes** in `tests/fixtures/replays.json` with a test that asserts them. Today's are doc-only. `checksum.ts --update` rewrites the file. A commit that changes it says why in its message, so each move of the baseline is a reviewed decision.
4. **Removal steps must keep the new hashes.** Each step deletes survivor code that the scenarios never run, so the hashes must not move. A move means the cut reached the foundation.
5. **Retire the old layers in one commit.** Once the director is gone, delete:
   - the flag-off sets (`off`, `build-off`, `world-off`, `hazards-off`, `size-off`, `roster-off`, `gen-classic`, `gen-size-off`, `gen-headroom-off`, `aim-2b`, `aim-pole-off`, `aim-tops-off`, `giants-off`, `gen-giants-off`, `deck-giants-off`, `catalogue-off`, `gen-catalogue-off`, `deck-catalogue-off`, `deck-xl-tall-off`). The deck scenarios (`deck`, `deck-tall`, `deck-xl`) cover giants under Mt. Moon's 2.9 m decks, so their coverage moves into new T0 scenarios rather than disappearing
   - the flags that exist only for them, owner call per flag:
     - `caps.enabled`, `build.enabled`, `surfaces.enabled`, `hazards.enabled`
     - `size.geometry`, `size.headroom`, `size.axis`/`xlContinuous`/`xlTall`
     - `world.wallTops`, `aim.spatial`, `aim.poleSafe`, `aim.foliageCover`
     - `spawning.waves`, `CLASSIC_REGIONS`, the `*-classic` presets
   
   Flags with a live design purpose stay as tunables.
6. **Feature flags from here on.** A new feature can still land flagged off with an `x-off` scenario that must print the baseline. That keeps the method, but each layer is retired as soon as its flag defaults on and is accepted, instead of being kept forever.

---

## 8. Suggested removal order (for the grilling)

Each step ends with `npm run check`, the new replay test and the kept gates (`navwalk all 5`, `stuckwatch` once rewritten, `hazplay`, `habstate`, `habaudit` when worldgen is touched).

1. **One "no survivor loop" switch**, replacing the `spawnBase: -99` / `firstAfter: 1e9` / `beats.enabled: false` hacks. It skips the director, objectives, progression, pickups and stage flow.
   - Hash-neutral for today's sets: they don't use it.
   - Rewrite the ~40 call sites to use it; check each one's hashes or asserts before and after.
2. **Freeze `profilesFor`'s pool input** as constants (3.1). Layouts and `HAB_VERSION` stay unchanged: `habaudit` against `baseline.json`.
3. **Move the salvage out**: placement (`allowedAt`/`nearestFit`), `firstAttacks`/`openingMove`, the bot's movement core.
4. **T0 target sets and the new replay baseline** (§5, §7), committed as a test.
5. **Fixed hero level** (2.3) and the inlined technique identity path (2.5). This is the combat path, so the new hashes must hold.
6. **Delete the survivor systems** behind the switch, one per commit, new hashes held at each. First do the carry/throw extractions in §8a.
   - cards and build
   - XP and pickups
   - the evolution level trigger (the transition stays, §2.4)
   - objectives other than Hold
   - recruiting
   - bosses
   - stages, portal and timer
   - director
   - compositions
   - spawn pools: the region presets, waves and resolver in `src/rules/spawning.ts`, after step 2 froze the habitat profile input. This is **not** `src/sim/pools.ts`: those are the struct-of-arrays actor pools (`EnemyPool`, `ProjectilePool`, `ZonePool`, `BodyPool`) and they stay. Only `PickupPool` goes, with XP.
7. **Retire the old checksum layers and their flags** (§7 step 5). Rewrite CLAUDE.md's Commands and Habitat sections, the README, and the docs listed above:
   - `BUILDS.md` and `ENCOUNTERS.md` go
   - `SPAWNING.md`, `SQUAD.md`, `HABITAT_PLAYTEST.md`, `PLAYABILITY.md`, `CUSTOMISING.md` and `SPECIES.md` are rewritten
   - `ANALYSIS.md` and `FIDELITY.md` are marked historical
8. **T1 enemy bots on the Hold point**, then plan T2.

## 8a. Carrying and throwing: the foundation step 6 must not cut

Carrying and throwing objects is a planned core mechanic. I checked every removal in §8 step 6 against the code it would touch.

### The foundation (keep)

| Part | Files | What it does |
|---|---|---|
| Bodies and force verbs | `src/sim/bodies.ts` (514) | Hit/Push/Hold. `holdBody` suspends a body 1.5 m ahead. `tickHeld` carries it to the hold point, and on release or timeout throws it along the aim at `8 × (1 + 0.5 × (Power − Weight))` m/s. Impacts at ≥ 5 m/s hurt for `10 × Weight × speed/10`. `changeOwner` costs 25 % integrity per change of hands. Deflect and Brace. `spawnBody`, `breakBody` (rubble), `seedBodies` |
| Materials | `src/rules/materials.ts` | `BODY_TEMPLATES` (boulder, rock, rubble, egg, …): Weight class 0–4, type, integrity, radius |
| Capability tags | `src/rules/capabilities.ts` | `capOf`, `derivePush`, `deriveHold`: each move's Push and Hold Power from its data |
| Resolver | `src/sim/capabilities.ts` (429) | one event shape for creatures, bodies, projectiles and tiles. The Create verb (`:170`) spawns bodies. `creatureForce` holds Light creatures (Lasso path, `:190-253`). `holdAim`/`holdButton`/`currentCastSlot` |
| Elements | `src/rules/elements.ts`, `buildTypeChart` | the type chart decides what breaks a body and how hard a thrown one hits |
| Props | `src/sim/props.ts`, `src/rules/surfaces.ts` `PROP_MATERIALS` | `forceOnProp`: pushes and impacts on wood, leaf and stone props; broken props drop rubble bodies |
| Cells and coats | `src/sim/cells.ts` (`rubbleAt`, `applyAgent`), `src/sim/coats.ts`, `src/rules/reactions.ts` | rubble tiles and typed agents from impacts |
| Damage | `src/sim/combat.ts` | `damageEnemy`/`damagePlayer` from impacts; `DamageSpec.hold`/`lasso`/push |
| Actor state | `src/sim/pools.ts` `BodyPool`, `EnemyPool.heldT` | body and held-creature state |
| Player side | `src/sim/player.ts` (`deflecting`), `src/sim/squad.ts:110` (a Tag Action creates a rock) | guard deflects bodies no heavier than the guard's class |
| Logs and weights | `src/sim/caplog.ts` (hold/release records), `src/rules/species.ts` `weightClass`, `src/rules/sizing.ts` (`partnerRadius` sets the hold distance) | |
| Rules | `rules.caps` (`holdTime`, `holdDistance`, `holdSpeed`, `combineWindow`, `combineCos`), `rules.bodies` | |

### What step 6 would cut, and what to do first

1. **Transport is today's only carry mechanic.** The egg is a body (`objectives.ts:105`).
   - Carrying lives in:
     - objective state: `O.carrier` (−2 is the player, ≥ 0 an enemy) and `P.carrying`, with pick-up and drop on Guard/Dash/Tag/faint (`objectives.ts:134, 201-211`)
     - the carry speed `rules.objectives.transport.carrySpeed` (`player.ts:71`)
     - "only the basic attack while carrying" (`moves.ts:934-935`)
     - Raider steals (`enemies.ts:295-300`)
     - four `ctx.objective.egg` reads in `bodies.ts` (`:181, 208, 441, 463`)
   - Deleting "objectives other than Hold" deletes all of it.
   - **Before that step**: move carrying into the body layer. `BodyPool.carrier` replaces `O.carrier`, `rules.caps.carry` replaces `rules.objectives.transport.carrySpeed`, and the `bodies.ts` reads go to the body's own state. Transport then becomes one user of a general carry.
2. **Lasso (hold and throw a creature) has only one trigger: a build transform.** That is `lasso` on Vine Whip (`src/rules/build.ts:88-91`). Its timing constant `rules.build.lassoHold` is read by `capabilities.ts:197-198`, and `rules.build.brambleTime`/`brambleSlow` sit beside it.
   - The Lodestone technique (+1 Hold Power, longer holds) and Quarry (extra rubble from broken bodies, `quarryRubble`, `bodies.ts:266-272`) are build data too.
   - Deleting "cards and build" removes the trigger and the constant.
   - **Before that step**: move `lassoHold` into `rules.caps` and keep the `lasso` spec flag and the `creatureForce` path. Whether a move grabs creatures without the transform is a grilling question.
3. **Technique helpers sit inside the hold and throw code.** `bodies.ts` calls `holdSeconds`, `guardWeight`, `onGuardDeflect` and `logTech`, and reads `TB` bits. Step 5's identity inlining must keep exactly the no-technique values (`holdSeconds` = `rules.caps.holdTime`). The new replay baseline should include a hold-and-throw scenario so a slip shows as a hash move.
4. **Body seeding runs inside `startStage`** (`run.ts:131`, `seedBodies`). Deleting "stages, portal and timer" must move seeding into the match start, or maps lose their boulders and rocks.
5. **The only enemy that throws is a boss.** Boulder rolls come from `aimBoulder`/`bossThink` state 7 (`enemies.ts:164, 589-598`, `rules.bosses.boulder*`). They use the ordinary `spawnBody` with `TEAM.enemy`. Deleting bosses loses the one enemy-side thrower. The body path itself survives, so T1/T2 bots can throw with the same call. Keep the boulder windup and throw as a reusable bot action, not boss code.
6. **No conflict** with XP and pickups, recruiting, director, compositions or spawn pools: none of them reads or writes bodies, props, materials or elements. The director's weather writes cell agents only through `cells.ts`, which stays.

## 9. Questions for the grilling

- Hold and Transport: keep as match modes, or remove with the rest and rebuild later?
- Squad and Tag: one hero with three forms, a three-hero team, or one Pokémon per player?
- Fixed hero level or explicit per-hero stat profiles? Do move levels survive?
- Bosses: delete now, or keep as a PvE mode?
- Chests: stop placing them (a layout move and `HAB`/`LOC_VERSION` bump), or leave placement and ignore them?
- Region biomes per stage: what decides a match map's biome once stages are gone?
- Which flags in §7 step 5 stay as live tunables?
- Does the stopped spawn-pool grilling die with the pools? The roster import and its role rule stay either way.
- Maplebrook overworld: keep, or out of scope for the pivot?
- The browser build size blocker (25.7 MB, stage A1): still a priority once only a few heroes and targets load per match?
