# Poke-Watch

A browser Pokémon survival roguelite in a DS-era 2.5D presentation: handcrafted tile routes, Pokémon as animated PMD pixel sprites standing in a 3D world, and the action-survival loop (waves, XP gems, cards, evolution, bosses) **rebuilt from PokéBonk's shipped mechanics**.

The Pokémon are built in, generated from three sources by `scripts/build-content.mjs`:

- **PokéAPI**: species, stats, types, abilities, level-up moves merged across official game versions, evolutions and the official type chart.
- **PMD SpriteCollab**: animated sprites in 8 directions (idle, walk, attack, shoot, charge, hurt, faint, sleep), shadow anchors and portraits.
- **PokeAPI/cries**: each Pokémon's latest available recorded cry.
- **PokeAPI/sprites**: Pokémon type badges and item icons for the UI.

The roster: 6 partners (Bulbasaur, Charmander, Squirtle, Chikorita, Cyndaquil, Totodile), each evolving twice to its final form, 16 wild Pokémon, and 4 bosses (Sudowoodo, Magcargo, Articuno, Houndoom): 38 Pokémon. Each carries a ability adapted to survival play (`docs/SPECIES.md`).

Music and move sounds are original but the music has slots for licensed recordings (`docs/AUDIO.md`).

- Zero runtime dependencies: TypeScript + a hand-written WebGL2 renderer.
- Deterministic fixed-step simulation (60 Hz, seeded RNG streams): the same seed and inputs always give the same run, so it runs headless in Node for tests and balance bots.
- The output is a single self-contained `dist/index.html`. Open it directly in a browser; no server needed.

> **Fan-made, non-commercial project. Not affiliated with PokéBonk, Nintendo, Creatures, GAME FREAK or The Pokémon Company.** Pokémon names, designs, cries and data are © those companies. The sprites are CC BY-NC 4.0 (most are credited to CHUNSOFT, from the Pokémon Mystery Dungeon games). Do not sell or monetise it. Read [Licensing and takedown](#licensing-and-takedown) before sharing it.

## Play

**Play in your browser: https://k22kumar.github.io/poke-watch/**

Or run it yourself: `npm ci && npm run build`, then open `dist/index.html` in Chrome, Edge, Firefox or Safari (WebGL2 required, keyboard / mouse or touch controls; no server needed). For live editing use `npm run dev`.

| Action | Keys |
|---|---|
| Move | WASD / arrows / left stick |
| Aim | Mouse / right stick (the basic attack autofires along it) |
| Move A / Move B | Left / right mouse (J / K) · RT / LT, hold to repeat |
| Tag (tap: swap to the last Pokémon; hold + LMB / RMB: pick the first / second reserve) | Q · Y |
| Guard (tap: deflect or parry; hold: brace) | E · RB / LB |
| Dash (brief invulnerability) | Shift / B |
| Jump (onto rocks, logs, bushes; flyers glide while holding) | Space / A |
| Level-up cards (compact top tray; the run keeps going): Kit, Technique, Wildcard | 1–3 pick (4 when discarding a technique) · F reroll · X skip · Z banish · d-pad ← ↑ → pick, ↓ reroll · C toggle cursor/camera control |
| Menus | Arrows / Tab to move, Enter / Space to choose, Esc / Backspace to go back; gamepad d-pad, A, B, Start |
| Pause | Esc / P |
| Tuning panel | ` (backtick) |
| Mute | M |

Runs default to a generated Sunpetal Meadow (seeded, so the same seed produces the same map) and a third-person camera. Settings can switch to the handcrafted Meadow or choose the Classic, Overhead or Wide camera presets; reduced or no screen shake is also available (`docs/WORLDGEN.md`, `docs/CAMERA.md`). Settings → Controls → Combat picks Aimed (default), Assist (basic attack targets the nearest enemy) or Auto (classic: every move fires on its own). Collect EXP gems, level up, pick cards, evolve. Trees, water and cliffs block the way; bluffs have stairs, ledges can be hopped. A boss arrives at 5:00 in each region; defeat it and step into the portal.

### Changing the roster

Edit `content/roster.json` (partners, wild Pokémon with their behaviour, bosses with their attack kit, and each region's spawn table), then:

```bash
npm run fetch-sources    # sparse git checkouts of PokeAPI/api-data, SpriteCollab and PokeAPI/cries -> ../src-data
npm run content          # -> src/content/pokedex.ts + src/content/art.json (+ content/preview, content/report.json)
npm run build
```

`npm run content:net` reads the same sources over HTTPS instead. See `docs/PIPELINE.md`.

### URL parameters (testing)

`index.html?go=1&species=totodile&mode=survival&seed=42` starts a run immediately. Also: `world=gen` (a generated Sunpetal Meadow, see `docs/WORLDGEN.md`), `autoplay=1` (bot), `autopick=1`, `speed=4`, `stage=2&stageTime=290&level=15`, `tp=56,84` (teleport to a tile), `calm=1` (no spawns), `squad=mareep,geodude` (recruits join at once), `cam=classic|steep|wide`, `capture=1` (the sim only advances through `pokewatch.advance(seconds)`, for deterministic screenshots; see `tools/` in the working folder).

## Systemic combat (blueprint phases 0–3)

- **Aimed combat.** Slot 0 autofires along your aim with light magnetism; slots 1–3 are cast with their buttons. Manual moves hit 1.5× harder on a 1.5× cooldown, so damage per second matches autofire.
- **Reflex charges.** Two charges, 1.8 s each, shared by Dash and Guard. Guard's first 0.15 s deflects shots back along your aim and parries attackers no heavier than you; holding it braces (half damage, no knockback, 40% speed, a charge every 2 s). A tap that catches nothing locks Guard and Dash for 0.35 s.
- **Weight and Power.** Every creature and body has a Weight class from PokéAPI kilograms (under 10 kg Light, under 50 Medium, under 200 Heavy; bosses one heavier). Water moves, physical Fighting/Rock/Ground moves, special Flying moves and dash moves Push with Power 1–3 by base power; Vine Whip, Wrap, Confusion and Psychic Hold instead (a suspend since phase 8a). Power ≥ Weight moves it; less only slows it; two pushes within 0.2 s and 45° add one Power.
- **Bodies** (`sim/bodies.ts`, `rules/materials.ts`): loose Medium rocks on every route, Heavy boulders thrown by Sudowoodo and Magcargo, Light rubble. They take type-chart damage, break into rubble, hit enemies when moving, block enemy shots, and can be deflected by a Guard heavy enough.
- **Surface states** (`sim/cells.ts`): Heat lights tall grass (spreads, 4 s, then ash for 45 s), Wet soaks ground (30 s), Cold freezes water and wet ground (12 s; frozen water is walkable and slippery), Charge floods up to 30 connected wet or water cells (0.5 s stun; airborne and Electric types are immune). Electric enemies standing in water discharge after a 0.5 s spark.
- **Determinism.** All sim trigonometry, exp, log and pow go through `core/detmath.ts` (fdlibm kernels), so replays should match across browser engines.

## Squad, Tag and coats (unified squad blueprint, phases 4–6)

The Pokémon-first content process is in [`docs/POKEMON_FIRST.md`](docs/POKEMON_FIRST.md). The design is in the *Poke-Watch Unified Squad Blueprint* doc; [`docs/SQUAD.md`](docs/SQUAD.md) lists what is built, the numbers and what was measured.

- **Banked picks.** Upgrade offers stay in a compact top-edge tray while the run continues. Cards show their type, name and key effects; hover or focus a card to inspect its full details. Choose with 1–3 (4 when swapping a technique), D-pad left/up/right, or click when the cursor is free; `C` toggles cursor/camera control. Multiple level-ups queue one offer at a time.
- **Squad of three.** You start with your partner. After an elite falls (from 2:00 for the first recruit, 5:00 for the second) two wild Pokémon from the region offer to join; pick one or let it go. One squad level and XP bar; every Pokémon evolves at its own level, benched ones on the bench.
- **Tag (Q / Y).** A tap swaps to the last Pokémon; hold Tag and press Move A or Move B to pick the first or second reserve. The incoming Pokémon arrives where the other stood, invulnerable for 0.15 s, and 0.2 s later fires its **Tag Action** (`rules/tags.ts`: Aqua Tail, Flame Wheel, Vine Whip, Thunder Shock, Rock Throw that leaves a rock…) toward your aim. 4 s squad-wide cooldown; Reflex charges belong to the trainer. At its first evolution (level 18 for Pokémon that do not evolve) each Pokémon can switch to a variant Tag Action.
- **Resting.** Benched Pokémon keep their cooldowns ticking, refill grey health (40% of each hit, which drains away if you stay on the field) and shed coats and paralysis twice as fast. They give no passive bonuses. A fainted Pokémon is replaced after 1 s with a free Tag Action; the run ends when all three faint; the next region's portal revives them at 30%.
- **Coats.** The four tile agents now coat creatures too. The basic attack gives **light** coats (3 s, fodder only); moves A and B, Tag Actions, deflected shots and tiles give **deep** coats (8 s, everything, rings under elites and bosses). Reactions: **Steam** (Heat + Wet: a cloud that blinds enemies and spends the burn), **Freeze** (Wet + Cold; the next physical hit or push shatters it for ×2), **Conduct** (Charge into Wet: chains through every Soaked creature in reach and stuns them), **Overload** (Heat + Charge: a burst that pushes outward), **Cancel** (Heat + Cold). Light agents never spend a deep coat. Fire into a Soaked creature does half damage.
- **Limits.** A crowd-control meter per creature (2 s of stun, freeze or root, decaying) grants 4 s of immunity; bosses fill it twice as fast. Ground types ignore Charge, like the type chart says.

## Capabilities, interception and Hold (systemic combat blueprint, phase 8a)

`docs/SYSTEMIC.md` has the rules, the numbers, the flags and what was measured.

- **Capability tags.** Every compiled move carries its capabilities as data (`rules/capabilities.ts`): `hit`, `push:P`, `hold:P`, `apply:agent`, `create:template`. Cards and the move tooltip show them.
- **One resolver** (`sim/capabilities.ts`) settles Hit, Push, Hold, Deflect, Apply and Create for creatures, bodies, projectiles and tiles by the same Power-against-Weight rules, whatever produced the event.
- **Projectiles are light bodies** (Weight 0; lobs and heavy shots 1). A Push deflects an enemy shot it overlaps (Water Gun bats an Oddish shot back), a Hold catches one and throws it along your aim, and opposing shots cancel by Weight. Guard deflects only shots no heavier than your Pokémon. At most 32 interceptions a tick.
- **Hold suspends.** A Hold no lighter than the target lifts it 1.5 m in front of you for up to 1 s (a manual move lets go when you release its button), then throws it as a Push of the same Power along your aim. Holds combine like pushes. A stun drops it.
- **Bodies collide.** A body moving at 5 m/s or more strikes the bodies it runs into and shoves them as a Push of its own Weight: a boulder knocks a loose rock on, a rock bounces off a boulder.
- **Fire blocks paths.** Burning tiles cost 8× in the enemy flow field, so pursuers route around a grass fire (Fire types walk through).
- **Death recap.** The end screen lists the last 5 s as short lines naming the rule that decided each hit ("Boulder (Weight 3, Rock) hit you for 34. Only a Pokémon of Weight 3 or more can deflect it…"). In the console, `pokewatch.debug('caps')` toggles an overlay with Weight badges, Power pips, hold tethers and the last 3 s of capability events; `pokewatch.caps(s)` and `pokewatch.recap()` print them. `?debug=caps` starts with the overlay on.
- **Flags.** `rules.caps.enabled: false` (or each feature flag) restores the v10 rules exactly; the replay checksums are unchanged.

## Builds: offers, transforms and techniques (systemic combat blueprint, phase 8b)

`docs/BUILDS.md` has the rules, the numbers, the flags and what was measured.

- **Three cards per pick.** A **Kit** card for the field Pokémon (learn a move, replace one, or transform one), a **Technique** for the trainer, and a **Wildcard** (a benched Pokémon's transform, a Tag Action you passed on, an evolution two levels early, a berry). Weighted by synergy with the kit, novelty for the squad in the first 4 picks, and a penalty for repeats; a technique at least once every 3 picks. 2 rerolls and 1 banish per region.
- **12 transforms**, two mutually exclusive per move, on Water Gun (Pressure Jet / Scatter), Ember (Kindle / Searing), Flame Wheel (Ram / Wheel Trail), Vine Whip (Lasso / Snare), Seed Bomb (Cluster / Burrow) and Bite (Crunch Down / Lunge). Each changes a shape, a verb or a rule and states its cost; a transform can only add Push or Hold to a line that already has it.
- **8 techniques**, at most 3 held (a fourth means discarding one): Undertow, Riposte, Lodestone, Heavy Footing, Catalyst, Slipstream, Quarry, Second Wind. Each states a gain and a cost and applies to whichever Pokémon is on the field.
- **Raw power from levels.** Move levels follow the squad level; vitamins and move power-up cards are retired behind `rules.build.legacyNumeric` (off). `rules.build.enabled: false` restores the Phase 8a cards exactly (replay checksums unchanged).
- Test hooks: `?techs=undertow,lodestone&xf=lasso`, `pokewatch.tech(id)`, `pokewatch.xf(id)`, `pokewatch.build()`.

## Roles, objectives and the beat director (phase 7)

`docs/ENCOUNTERS.md` has the rules, the numbers and what was measured.

- **Enemy roles.** Bulwarks (shielded tanks) block shots aimed at their front; flank them, lob over them, or break the guard with a Fighting move, a hold or a big shove. Menders heal everything near them. Hexers keep their distance and drop a deep Wet, Heat, Cold or Charge puddle where you are heading after a 0.8 s warning. Raiders ignore you and go for the objective.
- **Objectives**, two per region, each optional and timed: **Hold** the pad for 30 s (an item ball), **Hunt** the marked Pokémon before it reaches its Mender (it offers to join you), **Transport** the Egg to the goal by carrying it (walk into it; Guard, Dash or Tag drops it) or pushing it (an evolution, or a full heal). The objective panel sits under the timer; an arrow points to it when it is off screen.
- **Beats.** Each region runs Build, Peak and Relax beats on top of the old difficulty curve. A Peak brings an objective, a composition (Wall and guns, Pack with a medic, Soak and strike, Hex ambush) or Rain or harsh Sun.

## Build

The project needs Node 18+ and three dev tools: esbuild, TypeScript and tsx.

```bash
npm install          # esbuild, typescript, tsx
npm run build        # -> dist/index.html (single file, ~1.9 MB with the Pokémon art, cries and icons)
npm run dev          # rebuild-on-change server at http://localhost:5173
npm run check        # typecheck, tests, and production build
npm test             # sim, tile-world, asset-pipeline, audio, identity, combat, bodies, cells, banked-pick, coat, squad, phase 7, capability and build tests
npx tsx scripts/checksum.ts    # replay checksums (same seed + inputs => same hashes); "off" must equal v10, "build-off" must equal Phase 8a
npx tsx scripts/perf-sim.ts 500 --repeat 3 --gate # sim cost per tick at ~500 enemies (min of 3 replays strips machine noise); fails if p95 > 2 ms or p99 > 3 ms
npx tsx scripts/h2.ts           # H2: damage gain from rotating Tag for cooldowns (ceiling 15%)
npx tsx scripts/h6.ts           # H6: objectives engaged vs ignored, with the bot
npx tsx scripts/h8b.ts 3 360    # Phase 8b: technique x partner survival (dominance), technique frequency, transform sweep
npm run typecheck
npm run sim -- --species cyndaquil --seconds 1500 --seed 2 --mode classic   # headless balance run
npm run fixtures && npm run import:fixture   # offline importer run on the test mirror
node scripts/build.mjs --overworld           # Maplebrook overworld -> dist/overworld.html
```

## Architecture

```
src/
  core/      rng (mulberry32 + FNV-1a), uniform grid (counting sort), deep-merge utils
  content/   GENERATED: pokedex.ts (species, moves, type chart, stage tables) and art.json
             (atlases, frames, portraits, cries, credits) from scripts/build-content.mjs
  rules/     ALL tunable data: defaults.ts (every number, camera), elements.ts (types and chart),
             moves.ts (move rows + classifier rules), capabilities.ts (capability tags),
             build.ts (transforms and techniques), species.ts (the roster), stages.ts,
             originals.ts (Maplebrook's original creatures)
  world/     renderer-free tile vocabulary (tiles.ts), arena builder (builder.ts) and the four
             handcrafted arenas (arenas.ts)
  sim/       renderer-free deterministic simulation: world.ts (tile collision, platforms,
             stairs, BFS / fire-weighted flow field), run.ts, pools.ts, player.ts, enemies.ts
             (director, AI, flow-field navigation, bosses), moves.ts (classifier + 23 archetypes),
             effects.ts, combat.ts, bodies.ts, capabilities.ts (the capability resolver,
             interception), caplog.ts (capability event log, death recap), build.ts (offers, transforms,
             mastery), techniques.ts (technique hooks), progression.ts, bot.ts
  assets/    creature asset layer: art.ts (CreatureArt, 8 states, fallback table), clips.ts,
             builtin.ts (loads art.json), pack.ts (pack format + atlas decode), cries.ts,
             registry.ts
  render/    WebGL2: renderer.ts (fixed DS camera, creature billboards, VFX), tilestage.ts
             (ground/cliff/water meshes, prop billboards), tileart.ts (biome palettes, props),
             baker.ts, kit.ts, designs.ts, pixelart.ts, pixelfx.ts
  overworld/ Maplebrook (DS-style town + route); its painters are shared with the arenas
  ui/        DOM overlay in a DS-era style (title, partner select, battle info box, cards,
             credits, pause, tuning)
  audio/     mixer and music director (audio.ts), original score + sequencer (music.ts), per-move SFX (sfx.ts)
  input/     keyboard / gamepad action map
scripts/     build, dev server, headless sim, fetch-sources.sh, build-content.mjs,
             import-pack.mjs (+ lib/png.mjs), fixture mirror
content/     roster.json (who plays which role), report.json (provenance), preview/
tests/       sim, world, pack (importer on the fixture mirror), audio, identity
docs/        ART_BIBLE.md, PIPELINE.md, ASSETS.md, ANALYSIS.md, FIDELITY.md, MAPLEBROOK.md,
             SQUAD.md, ENCOUNTERS.md, SYSTEMIC.md
```

The rules that keep it modular:

1. `sim/` and `world/` never import `render/`, `ui/`, `audio/`, `input/` or `assets/`, so they run in Node.
2. The sim advances in fixed 1/60 s ticks with one RNG stream per system (spawn, combat, cards, world, ai).
3. Systems read `ctx.rules`, never literals. Rules are deep-merged as `defaults ← mode ← mods ← overrides`.
4. The sim emits events (hit, kill, cast, levelUp, bossSpawn, …). Rendering, audio and UI only react to them.
5. Every creature, whatever its source, is a `CreatureArt` (atlas + 8 clips with per-frame anchors). Nothing downstream branches on where art came from.

## Customising

**Change a number.** Edit `src/rules/defaults.ts`, or use the in-game tuning panel (backtick) for live changes to the current run.

**Add a Pokémon.** Add its name to `content/roster.json` (as a partner, or as a wild Pokémon with a behaviour: chase, tank, swarm, ranged, charger, healer), put it in a region's spawn table, then `npm run fetch-sources && npm run content`. Missing animation states come from the fallback table in `src/assets/art.ts`.

**Change an arena.** Edit `src/world/arenas.ts` (builder calls: `blob`, `path`, `river`, `bridge`, `elevBlob`, `stairs`, `prop`, `clump`, `tall`, `scatter`, `border`). `npm test` checks every walkable tile stays reachable.

**Moves.** Moves are the roster's level-up moves from PokéAPI. The classifier in `src/rules/moves.ts` picks each move's behaviour from its key, class, power, hits and drain. To force a behaviour, add the key to `archetypeOverrides`.

**Add a behaviour (archetype).** Add a template to `defaultRules.archetypes` and an implementation to `ARCHETYPES` in `src/sim/moves.ts`, then map moves to it.

**Change waves or bosses.** Edit `stages` and `bosses` in `content/roster.json` (spawn weights, elites, the boss for each region, its attack kit, phase thresholds and summons), then `npm run content`. Bosses are drawn at a whole-number scale (2–3×) so their pixels stay crisp.

**Write a mod.**

```ts
export const lifesteal: Mod = {
  id: 'lifesteal', name: 'Lifesteal',
  rules: { damage: { critChance: 0.2 } },                 // rule overrides
  hooks: {                                                 // gameplay hooks
    modifyDamage(ctx, hit) { if (hit.effectiveness > 1) hit.amount *= 1.5; },
    onKill(ctx, e) { /* ... */ },
    filterCards: (ctx, cards) => cards.filter(c => c.kind !== 'heal'),
  },
  systems: (list) => list.filter(s => s.name !== 'pickups'), // remove / replace systems
};
```

**Add a mode.** Add an entry to `MODES` in `src/mods/index.ts` with rule overrides and a list of mods. It appears on the title screen automatically.

**Reskin.** Biome palettes and prop art are in `src/render/tileart.ts`; music scales in `stages.ts`.

## Maplebrook (overworld slice)

The survivor arenas reuse Maplebrook's ground, cliff, water and prop painters.

`node scripts/build.mjs --overworld` builds `dist/overworld.html`. It's a separate DS-style 2.5D overworld: an original town, a route, four interiors, a following partner and NPCs. The code lives in `src/overworld/`; see `docs/MAPLEBROOK.md`. Maps are hand-authored in `src/overworld/maps.ts` with a small builder (`path`, `trees`, `building`, `prop`, `npc`, `warp`, `zone`, …). Pixel art is painted in code in `src/overworld/sprites.ts` and `terrain.ts`.

## Docs

- `docs/ART_BIBLE.md`: camera, pixel density, sprite, animation, palette, layering and UI standards.
- `docs/ART_DIRECTION.md`: the expedition art direction (floor/frame/actor/signal layers, per-biome values, decor, the crossroads camp), the before/after measurements and their limits.
- `docs/POKEMON_FIRST.md`: how to research and adapt Pokémon identities across official appearances.
- `docs/CAMERA.md`: the camera preset comparison and decision.
- `docs/AUDIO.md`: cries (era audit), every move's sound, music states, mixing, verification.
- `docs/ICONS.md`: which icons are Pokémon items and why, and which are original.
- `docs/SPECIES.md`: abilities, curated learnsets, unmodelled move mechanics and cross-game canon.
- `docs/PIPELINE.md`: how PokéAPI, SpriteCollab and cries become the built-in roster.
- `docs/MAPLEBROOK.md`: the overworld visual spec, reference comparison and feature list.

- `docs/ANALYSIS.md`: what was verified about PokéBonk, with each finding tagged confirmed / observed / inferred / unknown.
- `docs/FIDELITY.md`: side-by-side comparison with the original, test results and known limitations.
- `docs/ASSETS.md`: asset inventory and licensing.

## Procedural world (slice W0–W4)

Settings → World → Sunpetal Meadow → *Generated each run* (or `?world=gen`) builds the Meadow from the run seed: terrain,
rivers and lakes in basins, roads and trails, a hamlet, landmarks, encounter spaces and cover, validated against hard
gates. Trees, bushes and rocks have materials: they burn, break and leave stumps or rubble. `docs/WORLDGEN.md` has the
rules and measurements; `npx tsx scripts/worldsheet.ts 8 1 sheet.png` draws a contact sheet, `scripts/worldstats.ts`
runs the gate sweep and `scripts/worldsurvival.ts` the bot gates.

## Deploying (GitHub Pages)

The game is one static file (`dist/index.html`, about 2 MB, all sprites, cries and fonts embedded). It makes no network requests and has no backend, so GitHub Pages hosts it for free.

`.github/workflows/deploy.yml` runs on every push to `main`: `npm ci`, `npm test`, `npm run build`, then publishes the page. One-time setup: repository **Settings → Pages → Build and deployment → Source: GitHub Actions**. Progress shows under the **Actions** tab. To publish an update: commit and `git push`.

`dist/` is not committed; CI rebuilds it.

## Checks

```bash
npm test          # 171 deterministic tests (sim, worlds, build, audio)
npm run typecheck
npm audit
```

Known limitations: desktop keyboard and mouse still feel best, touch controls are supported on portable screens, and gamepad works; needs WebGL2; audio starts after the first click; settings are stored in the browser's localStorage only. There is no multiplayer and no server.

## Licensing and takedown

The code in this repository is the author's. The game content is not:

- Pokémon names, designs, cries, sprites and data belong to Nintendo, Creatures, GAME FREAK and The Pokémon Company. No licence in this repository grants rights in them.
- Sprites come from [PMD SpriteCollab](https://github.com/PMDCollab/SpriteCollab) (CC BY-NC 4.0, attribution required, non-commercial only). Most are official Pokémon Mystery Dungeon art credited to CHUNSOFT.
- Cries and icons come from PokeAPI repositories whose own licence is CC0, but whose contents are © The Pokémon Company.
- Per-asset provenance and credits: [docs/ASSETS.md](docs/ASSETS.md), the in-game Credits screen, and `content/report.json`.
- Font: Pixelify Sans, SIL OFL 1.1 (`content/fonts/PixelifySans-OFL.txt`). Music and sound effects are synthesised in code.

Hosting these assets publicly is redistribution of third-party intellectual property, and rights holders can ask for removal. If you are a rights holder and want something taken down, open an issue and it will be removed promptly.
