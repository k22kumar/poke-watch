# Hero-shooter pivot: inventory

Status: **decided, 2026-11-19.** The removal plan was grilled; the decisions are in §10 and the order in §8. Work happens on the `hero-core` branch.

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
| Evolution by level | **Split**: remove the XP/level trigger, keep the evolution transition for a future hold-F Breakthrough trigger (§2.4) | trigger: `progression.ts:332-360`; transition: `finishEvolution`, `ctx.state 'evolving'`, renderer, camera |
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

The owner keeps evolution as a mechanic with a future **Breakthrough** trigger: hold F (Touch) any time you can afford it (`docs/STATS_GROWTH_TARGET.md` §Breakthroughs, which supersedes the rest-gated trigger in `docs/CONTROL_SCHEME_TARGET.md`; rest now opens the dream shop). Only the XP/level trigger goes. The transition stays and must keep working when something other than a level calls it.

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

## 8. Removal order (decided, §10)

All work is on the `hero-core` branch (Q4). `main` is merged into it at each step boundary, and any `main` change that moves layouts, hashes or gates is re-gated there (Q49). Each step ends with `npm run check` (apart from the known pointer-lock reds) and the kept gates (`navwalk all 5`, `hazplay`, `habstate`; `habaudit` when worldgen is touched). From step 8 on, the new replay test (`tests/replays.test.ts`) must also hold.

Today's checksum sets keep printing their old hashes through steps 1–4. Steps 5 and 6 (importing the test lines, the stats step) move them on purpose; they are retired in step 10 and stay reproducible from `survivor-final` (Q5).

1. **The `range` Mode** (Q15): a `Mode` in `src/mods/index.ts` that drops the director, objectives, progression, pickups and stage flow from the system list. The ~40 `spawnBase: -99` / `firstAfter: 1e9` / `beats.enabled: false` sites switch to it. Hash-neutral for today's sets.
2. **Audio cut** (Q51), its own commit. No replay hash may move.
3. **Freeze `profilesFor`'s pool input** as constants (§3.1). Layouts and `HAB_VERSION` unchanged: `habaudit` against `baseline.json`.
4. **Salvage**: placement (`allowedAt`/`nearestFit`) into `sim/placement.ts`; `firstAttacks`/`openingMove` into `src/rules/heroes.ts`; the bot's movement core with its state in an instance (Q42).
5. **Import the test lines** (Q33): Caterpie, Metapod, Butterfree, Tauros, Mewtwo through `content/roster.json`. Shedinja `recruitable: false`; `NEEDS_ABILITY_RULE` list and test (Q34). **Stop rule**: any of the five below `ready`.
6. **Stats step** (Q12, Q25, Q26, Q27, Q29, Q36, Q37, Q40): `src/rules/stats.ts` canon curve, the physical/special split on both sides, the speed band, burn and deflect × `m`, flat coat strength and Tag Action level, `heroKit` and the fixed move level. **Stop rule**: a mandatory jump fails at the new speed (bring the choice; change neither the centre nor the jump).
7. **Match foundation for the baseline**: the per-player Breakthrough in `sim/evolution.ts` (Q30) with the range Touch trigger and `?evolve=` (Q39, Q23); the loadout (`members[]` length from the mode) and swap as an opt-in system (Q10, Q11); Hold as `sim/modes/hold.ts` (Q14); the range arena, T0 target sets and range rules (Q16, Q17, Q20).
8. **The new baseline** (Q41–Q43): `tests/fixtures/scenarios.ts`, `tests/fixtures/replays.json`, `tests/replays.test.ts`, `checksum.ts --update`. **Stop**: the drafted `PROTOTYPE` list goes to the owner before the baseline is committed (Q35).
9. **Delete the survivor systems**, one per commit, the new hashes held at each (a move is a stop):
   - the §8a extractions first (carry into `BodyPool.carrier`, `lassoHold` into `rules.caps`, `seedBodies` into the match start, the boulder throw as a bot action)
   - cards and build, with the technique identity path inlined
   - XP and pickups
   - the evolution level trigger
   - Transport and Hunt
   - recruiting and Tag variants
   - bosses
   - stages, portal and timer
   - director and difficulty curves
   - compositions and the mender/bulwark/hexer/hunt roles
   - spawn pools (`src/rules/spawning.ts` presets, waves, resolver; not `src/sim/pools.ts`)
   - survivor modes and mods (Q48)
   - survival scripts, and the `perf-sim`/`stuckwatch` workloads moved to targets (Q21)
   - survivor UI, title and HUD (Q46)
10. **Retire the old checksum layers and the flags** (Q5, Q18, Q44), rewrite `checksum.ts`, and the docs, README and CLAUDE.md (Q22).
11. **Merge bar** (Q4, Q45): `tests/browser/range.py`, the gates, my look at the frames. **Stop** before merging.

After the merge: A1 (Q19), then the co-op wave (T1) and the 3v3 (T2) (Q38), growth and Candy (Q31), the dream shop (Q32).

## 8a. Carrying and throwing: the foundation step 9 must not cut

Carrying and throwing objects is a planned core mechanic. I checked every removal in §8 step 9 against the code it would touch.

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

### What step 9 would cut, and what to do first

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
3. **Technique helpers sit inside the hold and throw code.** `bodies.ts` calls `holdSeconds`, `guardWeight`, `onGuardDeflect` and `logTech`, and reads `TB` bits. The identity inlining in step 9 must keep exactly the no-technique values (`holdSeconds` = `rules.caps.holdTime`). The new replay baseline should include a hold-and-throw scenario so a slip shows as a hash move.
4. **Body seeding runs inside `startStage`** (`run.ts:131`, `seedBodies`). Deleting "stages, portal and timer" must move seeding into the match start, or maps lose their boulders and rocks.
5. **The only enemy that throws is a boss.** Boulder rolls come from `aimBoulder`/`bossThink` state 7 (`enemies.ts:164, 589-598`, `rules.bosses.boulder*`). They use the ordinary `spawnBody` with `TEAM.enemy`. Deleting bosses loses the one enemy-side thrower. The body path itself survives, so T1/T2 bots can throw with the same call. Keep the boulder windup and throw as a reusable bot action, not boss code.
6. **No conflict** with XP and pickups, recruiting, director, compositions or spawn pools: none of them reads or writes bodies, props, materials or elements. The director's weather writes cell agents only through `cells.ts`, which stays.

## 9. Questions for the grilling (answered in §10)

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

## 10. Decisions (grilling, 2026-11-19)

The owner's answers. They override §1–§9 where they differ. `docs/STATS_GROWTH_TARGET.md` (owner-confirmed) overrides the rest-gated evolution in `docs/CONTROL_SCHEME_TARGET.md`.

### Shape and process

- **Q1 Match shape.** Offline, human against bots: T0 targets, then T2 hero bots (players in `ctx.players[]` driven by `InputFrame`s). Netcode out of scope, but per-player systems are built so a remote player could slot in later.
- **Q2 Hero unit.** One Pokémon per player. Built modular, so a future mode or mechanic with swapping is easy to add, change and maintain.
- **Q3 Baseline first.** The new replay baseline exists before anything is deleted, and each deletion holds it.
- **Q4 Branch.** All pivot work on `hero-core`. The live site stays on `survivor-final`. Merge when title → hero pick → training range works end to end and the kept gates pass: `npm run check` (apart from the known pointer-lock reds), `navwalk all 5`, `hazplay`, `habstate` and the new replay test.
- **Q5 Old checksum layers.** All 19 flag-off sets retire in one commit once the director is gone; `survivor-final` reproduces them. The deck coverage moves into T0 scenarios first.
- **Q49 `main` during the pivot.** `main` is merged into `hero-core` at each step boundary, and a `main` change that moves layouts, hashes or gates is re-gated there. Survivor-only work stops.
- **Q50 Record.** This section, then `hero-core`, then go.

### What goes and what stays

- **Q6 Bosses.** Deleted now. The boulder windup and throw stays as a reusable bot action.
- **Q7 Chests.** Placement stays in the generators (layouts, `HAB_VERSION` and `LOC_VERSION` unchanged); the sim and renderer ignore them. Stripping placement waits for a planned version bump.
- **Q8 Maplebrook.** Untouched.
- **Q9 Spawn-pool grilling.** Dead. The S2 roster import and its role rule stay.
- **Q14 Hold and Transport.** Hold moves into its own mode module (`sim/modes/hold.ts`) with the Raid party and its `despawnDistance` pin; the habitat Hold gates keep running, and Hold is the T2 objective later. Transport and Hunt are deleted after the §8a carry extraction.
- **Q18 Flags.** `hazards.enabled`, `aim.foliageCover` and `aim.deviceAssist` stay as tunables. Hard-wired on, with the off-paths deleted: `caps.enabled`, `surfaces.enabled`, `size.geometry`, `size.headroom`, `size.axis`, `size.xlContinuous`, `size.xlTall`, `world.wallTops`, `aim.spatial`, `aim.poleSafe`. `build.enabled`, `spawning.waves`, `CLASSIC_REGIONS` and the `*-classic` presets go with their systems.
- **Q20 Enemy actors.** Keep `spawnEnemy`, the behaviours (chase, charger, ranged, tank, healer, swarm) and the Raider role. Delete `compositions.ts` and the mender, bulwark, hexer and hunt roles. Targets take health from the hero canon curve, with a per-behaviour multiplier in rules.
- **Q21 Scripts.** Delete `headless`, `h2`, `h6`, `h8b`, `worldsurvival`, `locsurvival`. `perf-sim` and `stuckwatch` move to N T0 targets plus the bot, re-baselining `perf-sim --gate` once. Camera and aim benches get a T0 target set where they need enemies.
  - **Amended (owner, 2026-11-20, the director stop).** Where a test or gate needs a crowd that chases the player, it uses `scripts/lib/crowd.ts`: plain `spawnEnemy` chase walkers kept at N on the spawn ring, no RNG of its own, not in `src/sim`, used by no replay scenario. `perf-sim` runs on it too, not on targets: targets skip the flow-field chase the co-op wave will pay for. So do `stuckwatch`, the spatial crowd tests, the camera fight bench, `shotbench`, `spatialbench`, the `habtac` horde and `habplay --enemies`. Everything moves onto the co-op wave (T1) when it exists. Tests of deleted features are deleted, not ported (the anchor-spawn location test, `phase7`, the director tests in `spawning`). `perf-sim --gate` re-baselined once on the crowd (500, `--repeat 3`): p95 0.689 ms, p99 0.936 ms (was 0.619 / 0.884 on the director's crowd).
- **Q22 Docs.** Delete `BUILDS.md` and `ENCOUNTERS.md`. Mark `ANALYSIS.md` and `FIDELITY.md` historical. Rewrite `SPAWNING.md` (as target sets and placement), `SQUAD.md`, `PLAYABILITY.md`, `CUSTOMISING.md`, `SPECIES.md`, `HABITAT_PLAYTEST.md`, CLAUDE.md and the README in the step that removes their system.
- **Q31 XP.** Gems, magnet, `dropXp`, `xpNext`, `PickupPool` and the XP bar are deleted. The exp → Candy bar is built fresh after the merge (`sim/growth.ts`, event-fed). `stats.kills` stays; assists come with growth.
- **Q32 Cards.** Cards and build are deleted wholesale. The dream shop is built fresh after the merge.
- **Q47 Music climax.** Unreachable in range; it gets a match-intensity input in T2.
- **Q48 Modes and mods.** All survivor modes and mods go, as do the `onLevelUp`/`filterCards` hooks. Shipped modes: `range` and `hold`, with swap a system a mode can register. The `Mode`/`Mod` mechanism stays.
- **Q51 Audio** (owner addition).
  - **Keep, unchanged:** the adaptive score: `content/music/adaptive/` (melody, pulse/drive/impact stems, victory/defeat/accent cues, manifest), `src/audio/adaptive.ts`, `adaptive-score.ts` and the score director's intensity states. Range targets still drive the combat and surge states. Cries (real recordings) stay. The mixer buses and volume settings stay.
  - **Delete:** the generated chip-tune music (`src/audio/music.ts` tracks and `TrackPlayer`, the `content/music/manifest.json` slot mechanism, `src/content/music.json`); every synthesized sound effect (`src/audio/sfx.ts`, including move, hit and UI sounds); the synthesized fallback call for species without a cry.
  - Every music state plays the adaptive score, and nothing plays before it loads. Combat and UI are silent until recorded sounds are added.
  - `docs/AUDIO.md` and the audio tests are updated. Its own commit on `hero-core` at the next step boundary; it must not move a replay hash.

### Squad, heroes and kits

- **Q10 Squad shape.** `Player.members[]` and `Member` stay; the mode's loadout sets the length (default 1). Swap is an opt-in system a `Mode` registers; with one member it never runs.
- **Q11 Tag.** Tag Actions, grey health and the swap cooldown live in the opt-in swap module, off by default, kept alive by one replay scenario. Tag variants are deleted. The `tagAction` readiness check counts only in modes that register swap.
- **Q13 Hero pool** (amended). Hero pick shows the prototype list from `STATS_GROWTH_TARGET.md` (about 50 forms), with the four test lines (Caterpie, Charmander, Tauros, Mewtwo) featured; the baseline and tests use them. The dev roster still picks any ready species. All species playable stays the long-term goal; loading size is A1's job.
- **Q27 Kit** (changed). Primary = `openingMove(sp)`; Q = the first learnset move in canonical order (status moves allowed); E empty. Range mode fills E with the next learnset move for testing. An override table holds featured kits. Ultimate unbound.
- **Q28 Boss species.** Sudowoodo, Magcargo, Articuno and Houndoom stay as ordinary species. Hero pick shows `ready` only; `partial` stays in the dev roster. Their warn checks are fixed if they still grade partial.
- **Q33 Test lines.** Caterpie, Metapod, Butterfree, Tauros and Mewtwo come in through `content/roster.json`, after `profilesFor` is frozen and before the stats step. Stop rule: any of the five below `ready`.
- **Q34 Exclusions.** Shedinja gets `recruitable: false` with "needs its Ability rule". Slaking, Regigigas and Wishiwashi (not game species) go in `NEEDS_ABILITY_RULE` in `src/rules/heroes.ts`; a test asserts each is absent from `SPECIES` or flagged. `validateProfiles` stays strict.
- **Q35 Prototype list.** Drafted by rule (whole lines in the roster; spread across size classes, elements and traversal; the four lines featured; no `recruitable: false`), stored as `PROTOTYPE` and `FEATURED` in `heroes.ts`. The owner approves it before the baseline is committed.
- **Q46 Title and HUD.** The survivor UI goes. Hero pick (`openSelect`) shows `PROTOTYPE`, `FEATURED` first. HUD: health, primary/Q/E slots, an empty Ultimate slot. Tagline "A Pokémon hero shooter fan game"; the title stays.

### Stats

- **Q12 / Q25 Canon curve.** Level-50 Canon Curve, k = 0.6, no Upkeep: `m = ((base + 20) / 100) ^ k`, health = `250 × ((HP + 75) / 155) ^ k`. Base 80 is ×1.0 and 250 health. Atk, SpA and Def (and SpD for special damage) are on the curve. "No Upkeep" means no BST-keyed cost multiplier on strong Pokémon; levels add nothing (they pay Candy later). Mastery is deleted; move slots sit at a fixed `rules.hero.moveLevel`. Per-hero stat overrides can come later as data.
- **Q36 Speed.** Top speed is a logistic band in Spe, tunable as `rules.hero.topSpeed` (centre, 6.0 m/s) and `rules.hero.speedBand` (width, 5.6–6.4). Buff, swim, paralysis, carry and stance multiply on top. Targets and enemies keep their own formula until the co-op wave step, where enemies move onto the same band so heroes can disengage. Acceleration and Burst refill come with the Burst system. **Stop rule**: if a mandatory jump stops reaching, bring the owner the choice between raising the centre and re-tuning the jump; change neither.
- **Q37 Physical/special split.** Lands in the stats step. Heroes take damage × `1/m(Def)` (physical) or `1/m(SpD)` (special). Enemy and target attacks take the channel of their higher attack stat; the `E.dmg` magnitude stays. Targets divide incoming damage by their own `m(Def|SpD)`.
- **Q26 / Q40 Level terms.** Burn from a move and deflect damage scale with the attacker's `m` for the move's channel (the deflector is the attacker, on the deflected projectile's channel). Tile burn, coat strength and the Tag Action level are flat tunables at the old level-10 values (tile burn 14, coat 30).
- **Q29 Order.** The curve, the flat terms, `heroKit` and the speed band land as one step after salvage and before the baseline. `src/rules/stats.ts` is pure, with tests pinning base 80 → ×1.0 and 250 health.

### Evolution

- **Q23 Transition.** `sim/evolution.ts` is kept alive by a unit test (swap, heal, size, the Breakthrough state, growing in a corridor and under a deck), the dev trigger and a replay scenario.
- **Q30 Breakthrough.** Per-player state `breakT` (about 2 s): rooted and invulnerable, status cleared, full heal, then the species swap. The world keeps running; the overlay and alternating sprite are not modal. Entry: `startEvolution(ctx, player, memberIndex)`.
- **Q39 Range trigger.** In `range`, holding F for `rules.evolution.holdTime` (0.4 s) is a free Breakthrough for an evolver; a non-evolver is a no-op until the burst dial is played. A new held Touch bit in `InputFrame`. Plus `?evolve=`.

### Range, targets and the baseline

- **Q15 Switch.** The `range` Mode replaces the hack sites.
- **Q16 Range map.** One authored arena in `world/arenas.ts`; T0 target sets also anchor on habitat maps (`ModeGraph` roles) and on locations through a dev `?map=`. The biome comes from the map. Shipped layouts stay identical, so a match calls `new World(...)` with the seed each map was accepted at.
- **Q17 Range rules.** No fail state, no end. A fainted hero respawns at the spawn after a fixed delay. Targets respawn on fixed tick counts with no RNG. Strafe targets shoot back at reduced damage.
- **Q19 A1.** Not a merge blocker; the first item after the merge.
- **Q38 Scope.** T1 becomes the co-op wave and T2 the 3v3 on one habitat Hold map, both after the merge.
- **Q41 Scenarios.** Ten 60 s scenarios, aim ray on: Charmander range (movement, jumps, dash, guard, ±89°, primary/Q/E, all target kinds); Caterpie range (Breakthrough ×2, status Q); Tauros range (physical, hold and throw, override kit if needed); Mewtwo range (special, Def/SpD, deflect, 2 m body); Onix on Mt. Moon; Wailord on Mt. Moon seed 3; Totodile on Shoal Grotto seed 1; Charmander on a crater habitat (tile burn, coats, cells); a Gorge Hold with the Raid party; a three-member loadout in swap mode. `deck-tall` is dropped with `size.axis` hard-wired.
- **Q42 Format.** `tests/fixtures/scenarios.ts`: map, hero or loadout, mode, target set and a scripted input track (tick → `InputFrame` keyframes). The aimbot adds the aim ray only. The wandering bot, with its state in an instance, drives `perf-sim` and `stuckwatch` only.
- **Q43 Hash.** `stateHash` plus `vy`, jump and coyote state, `breakT`, target and body state; checkpoints every 10 s and an end hash; in `tests/fixtures/replays.json`, asserted by `tests/replays.test.ts` in `npm test`. `checksum.ts --update` rewrites it, and the commit says why.
- **Q44 `checksum.ts`.** Runs scenarios by name (`[scenario|all] [--update]`); the old set names and `legacyHash` go in the retire commit.
- **Q45 Merge check.** `tests/browser/range.py` in capture mode: title, pick a featured hero, spawn, fire at a dummy and see its health drop, hold F with Caterpie to Breakthrough, with screenshots; plus a look at the frames. `play.py`, `menus.py` and the survivor scene JSONs are deleted. Run at merge time, not in `npm run check`.

## 11. Progress on `hero-core`

| Step | Commit | State |
|---|---|---|
| 1 `range` Mode | `cdaa96c` | done |
| 2 Audio cut (Q51) | `a73fa22` | done |
| 3 Frozen habitat profiles | `914b86b` | done |
| 4 Salvage | `9b08b67` | done |
| 5 Test lines | `f0b0c9b` | done |
| 6 Stats | `7f635d9`, fixes `d8f5c89` `a44d76f` `44dbcff` `5f4bc16`, closed `d3d65b9` | done, two open findings below |
| 7 Match foundation | `3321d90` | done (docs/RANGE.md) |
| 8 Baseline | `9b313b5` (infrastructure), content `48268cb`, list and baseline `8be2889` | done: `PROTOTYPE` approved with a Rock and a Dragon family; `tests/fixtures/replays.json` committed |
| 9 Survivor deletions | §8a: carry `2de2534`, lasso `3e6b00a`, enterMap `07fa253`, throw action `c98b1db`; cards and build `43df45b`, XP and pickups `46cc74b`, level trigger `58520c8`, Transport and Hunt `af7adf6`, recruiting `40543d1`, bosses `11a52f7`, stage flow `a93d78d`, difficulty curves `91ed06c` (+ no difficulty term `3eb98fe`), weather system `236f175`, director `c510be8`, compositions and roles `7010c88`, spawn pools `afa6aab`, modes and mods `d268eaa`, survival scripts `d6d0adc`, survivor UI `10fa8a0` | done (below) |
| 10 Old layers, flags, roles, docs | checksum `7afe7de`, flags `45c3d6a`, roles `22e6f2a`, saved bindings `4cc9e29`, docs `658fecd`, README and CLAUDE.md `e723e0f` | done (below) |
| 11 Merge bar | `range.py` and Q45 deletions `dacdda8`, habaudit baseline `c96d6c2` | done up to the stop before merging (below) |

Step 8 closing work (owner, after the Q35 stop):

- **Evolution links for every species** (`48268cb`). The content build stripped `evolvesTo` from the enemy lane, so only the seven partner lines could Breakthrough. Now every species whose single next form was imported links to it (84 new links, no `evolveLevel`, so the survivor level trigger never fires on them and every checksum set is unchanged). Branching species stay unlinked: Snorunt, Sneasel, Tyrogue, Nincada, Cosmoem, Applin. Graded after the rebuild: 240 ready, 4 partial (the four boss-scale bodies, as before).
- **Rock and Dragon families.** The Geodude line (Geodude, Graveler, Golem) and the Bagon line (Bagon, Shelgon, Salamence) fit the frozen profile at every form; the five later forms joined the roster as the `heroes` wave, imported last so every registry index holds. The Dratini (Dragonite eye 1.58 m) and Dreepy (Dragapult 1.78 m) lines do not fit; nor do Gible, Axew, Jangmo-o, Deino or Trapinch (their last forms). Goomy fits by 4 mm (Goodra eye 1.416 m). `PROTOTYPE`: 58 forms, 22 families.
- **Scenario coverage.** Each scenario names the counters it must reach (`Scenario.needs`, `never`); tests/replays.test.ts asserts them before the hashes. The harness now sends the ground aim point beside the crosshair ray, as the browser does (`src/main.ts sampleInput`); without it every non-ray move, the holds among them, fired along the facing, which is why no hold landed. The range arena gained three Light throwables (`cobble`, Weight 1, unbreakable) and a tall-grass patch. Fixed on the way: an integrity-0 body (the throwable, the Transport egg) broke the first time it changed hands (`changeOwner`), hash-neutral on every set.
- **habtide**: the warning-escape driver arrives only standing on a dry tile (36/36). **viewsample**: the lens check counts snap episodes (runs of frames with the lens moved ≥ 0.4 m), at most 1 % of frames as before: 4 episodes over 7 frames on the seed 3 cave course, 4 over 4 on the forest course, limit 4.8.

Open design question:

- **How a Breakthrough chooses a branch.** Snorunt (Glalie or Froslass), Tyrogue (three), Nincada (Ninjask, and Shedinja on the side), Applin (three), Cosmoem (Solgaleo or Lunala) and Sneasel (by region) have more than one next form, so the content build leaves them unlinked and no branching line is a hero. A choice at the Breakthrough, a rule by stat or form, or one authored branch per line are the options.

Follow-up:

- **54 `ready` species exceed the frozen habitat profiles** (footprint 0.88 m, eye 1.42 m: Onix, Lugia, Wailord…). Making any of them a hero means re-measuring the habitat profiles, which moves accepted layouts: a planned `HAB_VERSION` bump with `docs/habaudit/baseline.json` regenerated, not a side effect of a roster change.

Step 9, difficulty curves (owner: replace now, 2026-11-20; `91ed06c`): every non-target enemy's health is `heroHealth(HP) × rules.enemy.behaviourHp[behaviour]` (all 1) × role × difficulty, with no growth; base speed keeps its formula without the curve. `gorge-hold` re-recorded in that commit. Hold read: `habplay all 6 1 --raid` passes 72/72 before and after (its trainer is invulnerable and never fights, so it shows the raiders still reach the point, not winnability). A fighting probe (the `gorge-hold` track with routing, Tauros and Charmander, every recipe × seeds 1–6, 150 s) before and after: the Raiders' health goes from about 56 to 165 each; Holds taken: Tauros 24 → 25 of 36, Charmander 33 → 33 of 36 (the misses are the probe's driver not reaching the point, the same runs in both); the hero kills all four Raiders every time, takes the point 1–7 s later and takes about 2–3× the damage (Charmander's lowest health 76 of 208, Tropical Lagoon seed 3); no new faints. Neither unwinnable nor trivial.

Also on the way: `range-charmander` walks through the burning grass, with a `tileBurn` counter (`98bcddc`); the Bagon, Graveler and Golem kits are logged in `KIT_TUNING` beside `HERO_KITS` for the kit-tuning pass (`189debc`). Spawn pools checked against the map builder: `profilesFor` was frozen at step 3, and the only other reader, the classic generator's habitat gate, reads `requires`, which no species sets; generating every classic region × seeds 1–12 with and without the spawn species gives identical `mapChecksum`s (48/48), so deleting the pools moves no layout.

Step 9 closing (owner, 2026-11-20: crowd option (c), compositions re-baseline approved in advance):

- **Director** (`c510be8`): deleted with the objective schedule, `rules.director`/`beats`, the live-cap governor. Crowds for tests and gates come from `scripts/lib/crowd.ts` (Q21 as amended in §10). `perf-sim --gate` re-baselined once at 500, min of 3: p95 0.689 ms, p99 0.936 ms (director crowd 0.619 / 0.884); one deterministic spike up to 18 ms on Totodile seed 1 after 199 s is the exposure system (enemies knocked into the pond searching for a shore), a cost the denser always-on crowd shows. `stuckwatch all 3` on the crowd: the same 3 TRAPPED player episodes at River Gorge seed 3 (−28.6, 16.4) as on the director's crowd; enemy stuck 31 over 217 415 enemy-seconds (was 2 over 73 918), 24 of them on Viridian Forest seed 1 and River Gorge seed 3. Far-behind relocation lives in `enemies.ts`, not the Hold module (Hold only pins its active Raiders), so the spatial stray test was deleted; the relocation itself still runs for unpinned enemies.
- **Weather** (`236f175`): the ground effects of the weather a move sets run as `sim/weather.ts` in every mode; no scenario sets the weather, hashes held.
- **Difficulty** (`3eb98fe`, `d268eaa`): `rules.mode.difficulty` left the enemy formula, then went entirely with the survivor modes.
- **Compositions and roles** (`7010c88`): Bulwark, Hexer and the Mender job deleted; the Raid party is `RAID_PARTY` in `src/sim/modes/hold.ts`, species frozen from the meadow resolution (checked hash-neutral with the old draw and the shield on), the tank now plain. `gorge-hold` re-recorded. Fighting probe before → after: Holds taken Tauros 25 → 25 of 36, Charmander 33 → 33; on runs taken both times about 1 s quicker; damage taken Tauros 36 → 18, Charmander 60 → 10 (lowest health 76 → 171 of 208); faints 1 → 1. A Charmander A/B with the old species and no shield gives 16: the shield was most of the pressure. Hold is now easy for a ranged hero; tuning is open.
- **Spawn pools** (`afa6aab`): deleted; the map builder gets no species (48/48 identical `mapChecksum`s before). `habaudit` at `afa6aab`: all checks pass; accepted seeds, checksums, geometry and nav identical to `docs/habaudit/baseline.json`; only its load-run `sim` hash and timings differ, and that hash has moved with every sim change since the baseline was regenerated (`12dadf8`). Not regenerated.
- **Modes and mods** (`d268eaa`), **survival scripts** (`d6d0adc`), **survivor UI** (`10fa8a0`, checked in a private build at 1280 × 720).

Open after step 9:
- **Kit tuning:** `KIT_TUNING` logs Bagon, Graveler, Golem, Magneton, Magnezone and Diglett; a test refuses any new unlogged power-0 damaging move in a kit.
- **Hold balance** without the Bulwark (above); enemy `behaviourHp` all 1.
- **Elite, alpha, swarm and stampede roles** and `rules.enemy.roles` have no spawner left (the director was the only one); `ROLE.boss` is dead too. Step 10 or the co-op wave decides.
- **tools/*scenes.json** still hold survivor scenes (boss, level-up, `addLevel`); Q45 deletes them at the merge check.

Before step 10 (owner, 2026-11-20):

- **The 31 stuckwatch enemy episodes are navigation, not the crowd's placement.** Each stuck walker's spawn point recorded beside its episode (`stuckwatch all 3` reproduces 31 exactly):
  - *Viridian Forest seed 1, Totodile, 15:* a jam. The flow field funnels small walkers into the notch of a diagonal staircase wall at (−29.5, −42); up to 30 bodies within 1.2 m, every one moving at full speed into the notch, the field and the straight probes both reading open. Each had walked 20–35 m from its spawn (most from a terrace at y 3).
  - *River Gorge seed 3, Totodile, 9:* walkers at the lip of the ledge (y 6) 5 m above the pocket (y 0.7) where the player is TRAPPED in the same run, the known 3 player episodes at (−28.6, 16.4). Their route to the pocket flickers between finite and none as the player oscillates in it. The same world fault as the player trap.
  - *Volcanic Ridge seed 3, Feraligatr, 1:* the only walker stuck where it was put: a Cetoddle (footprint 0.66, wide) 0.1 m from its spawn. The point is `spawnEnemy`'s own `nearestFit` (a wide-block centre), not the crowd's ring point, beside a 1 m wall prop. The wide field heads it past the prop's corner, which its footprint cannot clear (`moveBody` gives 0.00–0.05 m of a 0.1 m step along that heading). Any spawner, or a walker arriving at that lattice point, stalls the same way: the wide field and `moveBody` disagree at a prop corner.
  - *The other 6* (Shoal Grotto seed 1, Memorial Ridge seeds 2 and 3, Mt. Moon seeds 1 and 3 ×2): one walker each, 6–82 m from its spawn.
  
  Why 2 became 31: the crowd keeps 120 alive all the time (217 415 enemy-seconds against the director's 73 918), so chokes the director's thinner, staggered crowd rarely filled now jam. The rate went from 2.7 per 100 000 enemy-seconds to 14. Not fixed and stuckwatch not re-baselined (owner: navigation is logged, not fixed, now). It belongs to the co-op wave (T1), which pays for the flow-field chase: crowd jams at chokes, the wide field against `moveBody` at prop corners, and River Gorge seed 3's pocket.
- **Hold is easy for a ranged hero since the Bulwark went** (compositions above: Charmander's mean damage taken 60 → 10, lowest health 171 of 208). Tune in the co-op wave or T2, not before the merge.
- **perf-sim spike on Totodile seed 1:** ticks up to 18 ms after about 199 s, deterministic. It is the exposure system's pond shore search for enemies knocked into the pond, which the denser always-on crowd hits. Within the gate's p95 / p99, but a worst-case tick to cut (cache or bound the shore search) before the co-op wave's crowd lands.

Step 10 (2026-11-20), every replay scenario as recorded after each commit:

- **Checksum** (`7afe7de`): `scripts/checksum.ts [scenario|all] [--update]` runs the replay scenarios by name and marks each as recorded or MOVED; `--update` rewrites only what it ran. `legacyHash`, the survivor configs and all sets (the 19 flag-off layers, `on`, `gen`, `aim`, `deck*`) are gone, with the skipped v10 capability-layer test.
- **Flags** (`45c3d6a`, Q18): `caps.enabled`, `surfaces.enabled`, `size.geometry`, `size.headroom`, `size.axis`, `size.xlContinuous`, `size.xlTall`, `world.wallTops`, `aim.spatial`, `aim.poleSafe` hard-wired with their off paths (every partner now has a footprint, so the bot's and the locomotion's centre-point fallbacks went too). No boolean `rules.size` flag is left, so `scripts/lib/sizeflags.ts` and every `--size` option went, with perf-sim's `--caps-off`; `sizegiants` and `sizetable` report the current rules. `navwalk all 5` 0 failures; `stuckwatch all 3` output identical line for line.
- **Roles** (`22e6f2a`): elite, alpha, boss and stampede deleted with `rules.enemy.roles`, every resist or immunity keyed on them, the boss steering exceptions, the role visuals, the never-emitted stampede event and the dead rules. Not a stop: no kept behaviour depended on them. `ROLE.swarm` stays: `spawnEnemy` sets it from behaviour `swarm`, as `ranged` and `healer` from theirs, so it is the swarm behaviour's own flag, not a spawner role (§11's "swarm role" note above lumped the two). navwalk lost its Large-elite walker.
- **Saved settings** (`4cc9e29`): a survivor-final save with card keys, the C toggle and pad picks loads through `loadSettings` and `Input.setBindings` with no error; no code change was needed (the sanitizers keep known actions only). Edge: a survivor override that moved a live action's default key onto a card action left that live action's override empty, and it stays empty (unbound) until rebound.
- **Docs** (`658fecd`, `e723e0f`, Q22): BUILDS and ENCOUNTERS were already gone; ANALYSIS and FIDELITY marked historical; SQUAD rewritten; PLAYABILITY, CUSTOMISING, SPECIES, SPAWNING updated; HABITAT_PLAYTEST keeps its evidence under a hero-core status note; SIZING and the other subsystem docs lose the retired flags, roles and sets; README and CLAUDE.md describe hero-core.

Step 11 (2026-11-20):

- **`tests/browser/range.py`** (`dacdda8`): passes in capture mode on a private build, no console errors: title (tagline, two modes), hero pick (featured first), Charmander on the range, the Snorlax dummy 320.9 → 163.9 under 3 s of held primary, Caterpie's held F starts a Breakthrough (breakT 1.82) and ends as Metapod. It fires at Snorlax with an explicit crosshair ray: the Geodude dummy stands behind a cover rock and straight-ahead Embers hit the rock. Python `playwright` 1.65.0 (the Node version) is needed; it is not a dependency.
- **Q45 deletions** (`dacdda8`): `play.py`, `menus.py`, `phase7scenes.json`, `squadscenes.json`, `traycheck.mjs`, and the swarm, boss, level-up, squad and Tag-switch scenes in seven scene files.
- **Gates**: `npm run check` stops only at the 4 known pointer-lock reds (587 pass); the build run by hand; replays 10/10 as recorded; `navwalk all 5` 0 failures (after the roles commit; nothing in the sim changed since); `hazplay` 49/49; `habstate` 24/24; `habplay all 6 1 --raid` 72/72; `habaudit` all checks pass.
- **habaudit baseline** (`c96d6c2`): regenerated on hero-core. Seeds, attempts, checksums, geometry, paint, nav and the sheets are identical; only the 24 load-run `sim` hashes (a short bot match, compared between fresh loads, never against the baseline) and the timings moved.

Found at step 11, not fixed (not covered by Q1–Q51):

- **Hold from the title on default settings is an empty map.** The Hold mode opens a Hold only on a habitat map; with Settings → World on Pokémon locations and no Map set, it loads Viridian Forest with no objective and no enemies. **Resolved (owner, 2026-11-21):** Hold is off the title until T2. The title offers `TITLE_MODES` (`[RANGE]`); `MODES` stays `[RANGE, HOLD]` for URLs, so `?go=1&mode=hold&map=river-gorge` (any habitat recipe; `map` is an alias of `loc`) still plays it, and a `mode=hold` URL on a non-habitat map warns in the console.
- **A bare `?go=1` opens the range arena** (the range is `MODES[0]`), so the remaining scene files whose queries name no map now capture the arena, and many still carry dead parameters (`calm`, `level`, `autopick`). `tools/perf.mjs` and `audiocheck.mjs`'s `play` phase still ask for the survivor's boss fight and measure nothing useful until a crowd exists in the browser.
- **An empty bordered pill** shows at the top right of the title and hero-pick screens.
- **The audio module keeps dead survivor hooks** (`onBossSpawn`, `levelUp`, the `boss` music state), and `SimEvent` still lists `levelUp` and `benchEvolve`, which nothing emits (`learn`, `stageStart`, `recruit` and `chest` still have one emitter each, to review with them).

