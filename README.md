# Poke-Watch

A browser Pokémon hero shooter in a DS-era 2.5D presentation: Pokémon as animated PMD pixel sprites standing in a 3D world, a third-person camera with a crosshair, and procedural match maps. One Pokémon per player, picked from a prototype list of about 60 forms; today you play it against training targets on a range, or take and hold a point on a habitat map against a raid party. Co-op waves and 3v3 matches against hero bots come next (`docs/hero-shooter-pivot.md`).

The Pokémon are built in, generated from four sources by `scripts/build-content.mjs`:

- **PokéAPI**: species, stats, types, abilities, level-up moves merged across official game versions, evolutions and the official type chart.
- **PMD SpriteCollab**: animated sprites in 8 directions (idle, walk, attack, shoot, charge, hurt, faint, sleep), shadow anchors and portraits.
- **PokeAPI/cries**: each Pokémon's latest available recorded cry.
- **PokeAPI/sprites**: Pokémon type badges and item icons for the UI.

- Zero runtime dependencies: TypeScript + a hand-written WebGL2 renderer.
- Deterministic fixed-step simulation (60 Hz, seeded RNG streams): the same seed and inputs always give the same match, so it runs headless in Node for tests, replay hashes and bots.
- The output is a static site: `dist/index.html` (the code, under 3 MB) with the Pokémon art in `dist/art/` and the music in `dist/music/`, fetched as needed. Serve the folder (`npm run dev`, GitHub Pages); opened from `file://` the browser refuses the fetches.

> **Fan-made, non-commercial project. Not affiliated with Nintendo, Creatures, GAME FREAK or The Pokémon Company.** Pokémon names, designs, cries and data are © those companies. The sprites are CC BY-NC 4.0 (most are credited to CHUNSOFT, from the Pokémon Mystery Dungeon games). Do not sell or monetise it. Read [Licensing and takedown](#licensing-and-takedown) before sharing it.

The survivor game this grew out of (waves, XP gems, cards, bosses, stages) is on the `survivor-final` tag; the live site may still run it until `hero-core` is merged.

## Play

**Play in your browser: https://k22kumar.github.io/poke-watch/**

Or run it yourself: `npm ci && npm run build`, then open `dist/index.html` in Chrome, Edge, Firefox or Safari (WebGL2 required, keyboard / mouse, gamepad or touch; no server needed). For live editing use `npm run dev`.

Title → **Training range** → hero pick (the prototype list, featured lines first: `PROTOTYPE` and `FEATURED` in `src/rules/heroes.ts`) → the match. The range has no fail state and no end: targets stand, patrol and strafe, respawn on fixed tick counts, and a fainted hero comes back at the spawn after 3 s (`docs/RANGE.md`). **Hold** is off the title screen until the 3v3 (T2) and reached by URL: `?go=1&mode=hold&map=river-gorge` (any habitat recipe) opens a point on a habitat map; stand on it for 30 s while the raid party comes from team B's staging (`src/sim/modes/hold.ts`, `docs/HABITATS.md`).

| Action | Keys |
|---|---|
| Move | WASD / arrows / left stick |
| Aim | Mouse / right stick |
| Primary (hold to repeat) | Left mouse (J) · RT |
| Ability 1 / Ability 2 (hold to repeat) | Right mouse (K) / R · LT / RB |
| Signature / Tag | Q · Y (Tag only in a mode with a loadout above one) |
| Guard (tap: deflect or parry; hold: brace) | E (L) · LB |
| Dash (brief invulnerability) | Shift / B |
| Jump (onto rocks, logs, bushes; flyers glide while holding). A press jumps once (buffered just before landing, still allowed just after walking off a ledge); holding does not jump again | Space / A |
| Descend (reserved for flight, which arrives later; does nothing yet) | V · left-stick click (provisional; X can be bound instead) |
| Touch; held 0.4 s on the range: Breakthrough (evolve on the spot) | F |
| Menus | Arrows / Tab to move, Enter / Space to choose, Esc / Backspace to go back; gamepad d-pad, A, B, Start |
| Pause | Esc / P |
| Tuning panel | ` (backtick) |
| Mute | M |
| Change any key or button | Settings → Controls → Bindings (saved in the browser) |

Maps: the range arena by default; Settings → World picks Pokémon locations (Viridian Forest, Mt. Moon, Chargestone Cave), the classic generator or the handcrafted arenas, and Settings → World → Map / Map seed a habitat recipe or a location for every region (`docs/LOCATIONS.md`, `docs/HABITATS.md`). The camera is third person by default; Classic, Overhead and Wide fixed presets remain (`docs/THIRD_PERSON.md`, `docs/CAMERA.md`). Settings → Controls → Combat picks Aimed (default), Assist (the primary aims at the nearest enemy) or Auto (every move fires on its own). Trees and cliffs block the way; bluffs have stairs, ledges can be hopped; water and lava can be entered but only Water types swim safely, and open edges can be fallen from (`docs/HAZARDS.md`).

### Changing the roster

Edit `content/roster.json` (partner lines, wild Pokémon with their behaviour), then:

```bash
npm run fetch-sources    # sparse git checkouts of PokeAPI/api-data, SpriteCollab and PokeAPI/cries -> ../src-data
npm run content          # -> src/content/pokedex.ts + src/content/art.json (+ content/preview, content/report.json)
npm run build
```

`npm run content:net` reads the same sources over HTTPS instead. See `docs/PIPELINE.md`. A hero's stats, top speed and kit come from its species (`docs/HEROES.md`); what stands on a map comes from the mode (target sets, the Hold's raid party: `docs/SPAWNING.md`); how big each Pokémon is comes from its size class (`docs/SIZING.md`). `docs/CUSTOMISING.md` walks through adding a Pokémon, changing its size class, target sets, maps and more.

### URL parameters (testing)

`index.html?go=1&species=charmander&mode=range&seed=42` starts a match immediately (`mode` is `range`, or `hold` with a habitat `map`). Also: `map=river-gorge` or `loc=river-gorge` (every region built from that habitat recipe or Pokémon location; `loc=meadow:mt-moon,dusk:viridian-forest` per region; `mapseed=3` holds the map seed), `world=gen|authored` (the classic generator or the handcrafted arenas), `evolve=N` (a Breakthrough after N s), `autoplay=1` (the bot), `speed=4`, `tp=56,84` (teleport to a tile), `cam=classic|steep|wide`, `combat=aimed|assist|auto`, `dev=1` (the hero pick lists every species, graded: `docs/PLAYABILITY.md`), `debug=caps`, `capture=1` (the sim only advances through `pokewatch.advance(seconds, {frames})`, for deterministic screenshots; see `tools/README.md`).

## Combat

- **Aimed combat.** Every slot fires on its button: the primary (left mouse / RT) shoots along your aim, even with nothing there; holding repeats it on its cooldown and releasing starts nothing new (a wind-up already under way still lands). A click up to 0.15 s before it is ready is buffered and fires once the moment it is ready (`rules.combat.fireBuffer`). With the chase camera, direct shots and beams trace the crosshair ray in 3D from the body's muzzle: no magnetism and no lead, and the crosshair turns red when cover stands between (`docs/THIRD_PERSON.md`). A gamepad or touch aim bends toward a visible enemy near the aim line (`rules.aim.deviceAssist`).
- **Kit.** Primary is the species' opening move; Ability 1 (Q) the first learnset move in canonical order; Ability 2 (E) empty in a match and the next learnset move on the range; the Ultimate slot is unbound. Featured lines have authored kits (`HERO_KITS`, `docs/HEROES.md`).
- **Stats.** A level-50 canon curve with no levels: `m = ((base + 20) / 100) ^ 0.6`, health `250 × ((HP + 75) / 155) ^ 0.6`; physical and special channels on both sides; top speed a logistic band in Speed around 6 m/s (`src/rules/stats.ts`, `docs/HEROES.md`).
- **Breakthrough.** Holding F on the range evolves the hero on the spot: about 2 s rooted and invulnerable, status cleared, full heal, then the next form (`src/sim/evolution.ts`).
- **Reflex charges.** Two charges, 1.8 s each, shared by Dash and Guard. Guard's first 0.15 s deflects shots back along your aim and parries attackers no heavier than you; holding it braces (half damage, no knockback, 40 % speed, a charge every 2 s). A tap that catches nothing locks Guard and Dash for 0.35 s.
- **Weight and Power.** Every creature and body has a Weight class from PokéAPI kilograms (under 1 kg Weightless, under 10 Light, under 50 Medium, under 200 Heavy, else Massive). Water moves, physical Fighting/Rock/Ground moves, special Flying moves and dash moves Push with Power 1–3 by base power; Vine Whip, Wrap, Confusion and Psychic Hold. Power ≥ Weight moves it; less only slows it; two pushes within 0.2 s and 45° add one Power.
- **One capability resolver** (`sim/capabilities.ts`, `docs/SYSTEMIC.md`) settles Hit, Push, Hold, Deflect, Apply and Create for creatures, bodies, projectiles and tiles by the same Power-against-Weight rules. Projectiles are light bodies: a Push deflects an enemy shot, a Hold catches one and throws it along your aim, opposing shots cancel by Weight. A Hold suspends its target in front of you, then throws it. Bodies moving at 5 m/s or more strike what they run into. Burning tiles cost 8× in the enemy flow field. The death recap names the rule that decided each hit (`pokewatch.debug('caps')`, `?debug=caps`).
- **Bodies** (`sim/bodies.ts`, `rules/materials.ts`): loose Medium rocks on every route, Light throwables on the range, rubble. They take type-chart damage, break, hit enemies when moving, block enemy shots, and can be deflected by a Guard heavy enough. Any enemy behaviour can wind up and throw a boulder (`sim/actions.ts`).
- **Surface states and coats** (`sim/cells.ts`, `sim/coats.ts`, `docs/SQUAD.md`): Heat lights tall grass, Wet soaks ground, Cold freezes water, Charge floods connected wet cells. The four agents also coat creatures (light from the primary, deep from Abilities and tiles) and react: Steam, Freeze then Shatter, Conduct, Overload, Cancel.
- **Swap** is a system a mode opts into (`sim/swap.ts`, the `swap` Mod): a loadout of three, Tag Actions, grey health and the bench. No shipped title-screen mode registers it; `RANGE_SWAP` and its replay scenario keep it alive (`docs/SQUAD.md`).
- **Determinism.** Replays match within one JS engine (Node and Chromium are both V8). Cross-engine matching is not claimed yet: `core/detmath.ts` (fdlibm kernels) carries most sim maths, but 8 sim and rules call sites (P2b) and 68 habitat-generator ones (P2c, a `HAB_VERSION` bump) still call `Math.hypot`, `sin`, `cos`, `tan`, `atan2`, `exp`, `log` or pow, which engines may round differently (`docs/ROADMAP.md`). `tests/worldgen.test.ts` holds the allow-list, which can only shrink.

## Water, lava and open edges

`docs/HAZARDS.md` has the rules, the numbers, the tested map seeds and the known gaps.

- **Liquids can be entered.** Water types (and a Pokémon that knows Surf) swim safely. Any other Pokémon loses 20 % of its max HP per second in water and is knocked out after 5 s; lava drains 33⅓ % per second and knocks out after 3 s. Reaching dry ground ends the exposure. An exposed Pokémon wades slowly and cannot jump.
- **Edges are real.** On the Pokémon-location maps a chasm beside a bridge or ledge is open air: walk, dash or get knocked over the lip and you fall.
- **Creatures** stop at a lip by themselves but can be knocked over it. In a liquid they head for the shore, on the same clock.
- `rules.hazards.enabled: false` restores the earlier rules (liquids and chasms as walls). `npx tsx scripts/hazplay.ts` replays every case through the sim.

## Build

The project needs Node 18+ and three dev tools: esbuild, TypeScript and tsx.

```bash
npm install          # esbuild, typescript, tsx
npm run build        # -> dist/index.html (code, UI icons, font), dist/art/ (sprites, portraits, cries), dist/music/; fails if the page is over 3 MB
npm run dev          # rebuild-on-change server at http://localhost:5173
npm run check        # typecheck, tests, and production build
npm test             # every tests/*.test.ts suite (headless, deterministic); one suite: npx tsx --test tests/<name>.test.ts
npx tsx scripts/checksum.ts [scenario|all] [--update]   # the replay baseline (below)
npx tsx scripts/perf-sim.ts 500 --repeat 3 --gate       # sim cost per tick at ~500 enemies (the test crowd, scripts/lib/crowd.ts); fails if p95 > 2 ms or p99 > 3 ms; --aim drives the spatial aim
npx tsx scripts/navwalk.ts all 5                        # real walkers of every size class reach every mandatory space (docs/SIZING.md)
npx tsx scripts/stuckwatch.ts all 3                     # live movement-deadlock watch (bot + crowd)
npx tsx scripts/shotbench.ts --gate                     # player shots over a ~475-enemy crowd: planar vs 3D swept
npx tsx scripts/camframe.ts                             # third-person composition against the crosshair's keep-out and the HUD
npx tsx scripts/camstats.ts --bench tuning              # third-person motion on real maps by movement mode
npm run typecheck
npm run fixtures && npm run import:fixture              # offline importer run on the test mirror
node scripts/build.mjs --overworld                      # Maplebrook overworld -> dist/overworld.html
```

**Replay baseline.** `tests/fixtures/scenarios.ts` holds ten 60 s scripted scenarios (the range with Charmander, Caterpie, Tauros and Mewtwo; Onix and Wailord under Mt. Moon's decks; Totodile in Shoal Grotto; Charmander in Cinder Crater; a Shrine Gorge Hold; the swap range). Each is hashed every 10 s and at the end (`replayHash`, `src/sim/checksum.ts`) against `tests/fixtures/replays.json`, and must reach the coverage it names; `tests/replays.test.ts` asserts both in `npm test`. `scripts/checksum.ts` runs them by name and prints MOVED for a hash that changed; `--update` rewrites the fixture, and a commit that moves a hash says why.

## Architecture

```
src/
  core/      rng (mulberry32 + FNV-1a), uniform grid (counting sort), detmath, deep-merge utils
  content/   GENERATED: pokedex.ts (species, moves, type chart) and art.json (atlases, frames, portraits, cries,
             credits) from scripts/build-content.mjs; catalogue.ts (reference catalogue, not game species)
  rules/     ALL tunable data: defaults.ts (every number), stats.ts (the canon curve), heroes.ts (kits, PROTOTYPE),
             targets.ts (target sets), sizing.ts, elements.ts, moves.ts, capabilities.ts, profiles.ts, traversal.ts,
             species.ts (the roster), stages.ts
  world/     renderer-free tile vocabulary (tiles.ts), arena builder and arenas (the range), the classic generator (gen/),
             Pokémon locations (locations/, locgen/), habitat recipes (habitat/), navblocks.ts (wide-body lattice)
  sim/       renderer-free deterministic simulation: run.ts, world.ts (collision, flow fields), locomotion.ts, player.ts,
             enemies.ts (behaviours, navigation), targets.ts, modes/hold.ts, evolution.ts (Breakthrough), swap.ts,
             moves.ts, aim.ts and spatial.ts (3D aim and queries), effects.ts, combat.ts, bodies.ts, capabilities.ts,
             caplog.ts, carry.ts, actions.ts, cells.ts, coats.ts, hazards.ts, weather.ts, placement.ts, checksum.ts, bot.ts
  mods/      Mode and Mod: RANGE and HOLD (MODES; the title offers TITLE_MODES, the range), RANGE_SWAP; the mods
  assets/    creature asset layer: art.ts (CreatureArt, 8 states, fallback table), clips.ts, builtin.ts, pack.ts, cries.ts
  render/    WebGL2: renderer.ts, camera.ts (the third-person rig), framing.ts, chaseinput.ts, tilestage.ts, tileart.ts, …
  overworld/ Maplebrook (DS-style town + route); its painters are shared with the arenas
  ui/        DOM overlay: title, hero pick, HUD (health, primary / Q / E, an empty Ultimate slot), settings, bindings, pause, tuning
  audio/     mixer and the adaptive score (adaptive.ts); recorded cries; no synthesised sounds
  input/     keyboard / gamepad / touch action map and bindings
scripts/     build, dev server, gates and benches, fetch-sources.sh, build-content.mjs, lib/ (crowd, aimbot, …)
content/     roster.json (who plays which role), catalogue.json, report.json (provenance), music/, preview/
tests/       node:test suites, fixtures/ (replay scenarios and hashes), browser/ (Playwright checks)
docs/        one doc per subsystem (below)
```

The rules that keep it modular:

1. `sim/` and `world/` never import `render/`, `ui/`, `audio/`, `input/` or `assets/`, so they run in Node.
2. The sim advances in fixed 1/60 s ticks with one RNG stream per system (spawn, combat, world, ai).
3. Systems read `ctx.rules`, never literals. Rules are deep-merged as `defaults ← mode ← mods ← overrides`.
4. The sim emits events (hit, kill, cast, evolveStart, objective, …). Rendering, audio and UI only react to them.
5. Every creature, whatever its source, is a `CreatureArt` (atlas + 8 clips with per-frame anchors). Nothing downstream branches on where art came from.

## Customising

**Change a number.** Edit `src/rules/defaults.ts`, or use the in-game tuning panel (backtick) for live changes to the current match.

**Add a Pokémon.** Add it to `content/roster.json` (as a partner line, or as a wild Pokémon with a behaviour: chase, tank, swarm, ranged, charger, healer), then `npm run fetch-sources && npm run content`. It is playable at once in the dev hero pick (`?dev=1`); put it in a target set (`src/rules/targets.ts`) to meet it on the range, or in `PROTOTYPE` (`src/rules/heroes.ts`) to offer it as a hero. Missing animation states come from the fallback table in `src/assets/art.ts`. Step by step: `docs/CUSTOMISING.md`.

**Sizes, preferences.** `src/rules/profiles.ts` (habitat preferences and restrictions, size-class pins, traversal templates per species: `traversalOf`), `rules.size` in `src/rules/defaults.ts` (size-class targets). See `docs/SPAWNING.md` and `docs/SIZING.md`.

**Moves.** Moves are the roster's level-up moves from PokéAPI. The classifier in `src/rules/moves.ts` picks each move's behaviour from its key, class, power, hits and drain. To force a behaviour, add the key to `archetypeOverrides`; to give a hero a kit of its own, add it to `HERO_KITS`.

**Add a behaviour (archetype).** Add a template to `defaultRules.archetypes` and an implementation to `ARCHETYPES` in `src/sim/moves.ts`, then map moves to it.

**Write a mod.**

```ts
export const lifesteal: Mod = {
  id: 'lifesteal', name: 'Lifesteal',
  rules: { damage: { critChance: 0.2 } },                 // rule overrides
  hooks: {                                                 // gameplay hooks (src/mods/types.ts)
    modifyDamage(ctx, hit) { if (hit.effectiveness > 1) hit.amount *= 1.5; },
    onKill(ctx, e) { /* ... */ },
  },
  systems: (list) => list.filter((s) => s.name !== 'weather'), // remove / replace systems
};
```

**Add a mode.** Add a `Mode` to `MODES` in `src/mods/index.ts` with rule overrides and a list of mods (reached with `?go=1&mode=<id>`), and to `TITLE_MODES` to offer it on the title screen.

**Reskin.** Biome palettes and prop art are in `src/render/tileart.ts`.

## Maplebrook (overworld slice)

The match maps reuse Maplebrook's ground, cliff, water and prop painters.

`node scripts/build.mjs --overworld` builds `dist/overworld.html`. It's a separate DS-style 2.5D overworld: an original town, a route, four interiors, a following partner and NPCs. The code lives in `src/overworld/`; see `docs/MAPLEBROOK.md`.

## Docs

- `docs/hero-shooter-pivot.md`: the pivot from the survivor game: inventory, decisions (Q1–Q51), the removal order and progress.
- `docs/HEROES.md`: stats, speed band, kits, the prototype list. `docs/STATS_GROWTH_TARGET.md`: the stats and growth design.
- `docs/RANGE.md`: modes, the range arena, target sets, respawns, Breakthrough, the replay scenarios.
- `docs/SQUAD.md`: the loadout, the opt-in swap module, Tag Actions, coats and reactions.
- `docs/SYSTEMIC.md`: capabilities, interception, Hold and bodies.
- `docs/SPAWNING.md`: where enemies come from (target sets, the raid party, the test crowd) and placement.
- `docs/SIZING.md`: size classes: drawn size, sim bodies, footprints, headroom, wall tops, wide-body navigation.
- `docs/LOCOMOTION.md`, `docs/CONTROLS.md`, `docs/CONTROL_SCHEME_TARGET.md`: the shared body step, traversal capabilities, bindings and the control scheme.
- `docs/HAZARDS.md`, `docs/HABITAT_STATES.md`: liquids, edges, vents, ice and tide.
- `docs/HABITATS.md`, `docs/HABITAT_AUDIT.md`, `docs/HABITAT_PLAYTEST.md`: habitat recipes, their gates and audits, and the tactical playtest record.
- `docs/LOCATIONS.md`, `docs/WORLDGEN.md`: the Pokémon-location generator and the classic generator.
- `docs/THIRD_PERSON.md`, `docs/CAMERA.md`, `docs/THIRD_PERSON_IMPLEMENTATION.md`: the third-person camera as built, the fixed presets, and the spatial roadmap ledger.
- `docs/AUDIO.md`: cries, the adaptive score, mixing.
- `docs/SPECIES.md`, `docs/POKEMON_FIRST.md`, `docs/PIPELINE.md`, `docs/ICONS.md`, `docs/ASSETS.md`: species identity, the content pipeline, icons, assets and licensing.
- `docs/PLAYABILITY.md`: the developer roster and readiness grading. `docs/CUSTOMISING.md`: how-to for roster, size, map and target changes.
- `docs/ART_BIBLE.md`, `docs/ART_DIRECTION.md`, `docs/MAPLEBROOK.md`: visual standards and the overworld.
- Historical: `docs/archive/ANALYSIS.md`, `docs/archive/FIDELITY.md` (the survivor build against PokéBonk), `docs/archive/size-extremes-*.md`, `docs/archive/pokemon-integration-*.md`.

## Pokémon locations (lore-driven world generation)

`src/world/locations/` holds Pokémon locations as data — canonical facts with references, the identity every seed must
keep, gameplay constraints, what may vary per seed, and clearly labelled interpretations — and `src/world/locgen/`
builds a region from any of them: a zone graph with loops and tiers, terraces, ramps, log or rock bridges over chasms
and hop shortcuts, then landmarks, cover rings, parapets and enemy entry anchors, validated for strong connectivity, no
player-only perches, two ways onto every raised space and two-tile routes for wide bodies. On these maps terrain and
walls are cover. Three locations ship: **Viridian Forest**, **Mt. Moon**, **Chargestone Cave**.
`?loc=chargestone-cave`, `pokewatch.loc()`, `npx tsx scripts/locstats.ts all 30`, `npx tsx scripts/locsheet.ts mt-moon 8`;
everything is in `docs/LOCATIONS.md`.

## Habitat recipes (procedural match maps)

`src/world/habitat/` builds a match map from a **habitat recipe** (landform, medium, anchors tagged canon /
reinterpretation / original, vegetation and landmark rules, surface variants) with a scenery-free **mode graph** embedded
in it: two sides, two independent approaches each, one shared control point (the Hold on a generated contest floor; the
raid party leaves team B's staging). Every map is proved playable on its final collision for the roster's real body
sizes and in every environment state (frozen water, erupting vents, all destructible cover gone), with bounded repairs
and a known-valid fallback. Recipes include **Shrine Gorge** (`river-gorge`), **Cinder Crater** (`volcanic-ridge`),
**Shoal Grotto** (`tidal-cave`), **Memorial Ridge** (`forest-cemetery`), **Cascade Lagoon** (`tropical-lagoon`) and
**Spear Sanctuary** (`spear-sanctuary`). `?loc=river-gorge&mapseed=3`, `?loc=volcanic-ridge/ash`, Settings → World → Map / Map seed,
`pokewatch.hab()`, `npx tsx scripts/habstats.ts all 30`, `scripts/habsheet.ts`, `scripts/habplay.ts`; everything is in
`docs/HABITATS.md`.

## Procedural world (slice W0–W4)

`?world=gen` builds each region from the run seed with the classic generator: terrain, rivers and lakes in basins, roads
and trails, a hamlet, landmarks, encounter spaces and cover, validated against hard gates. Trees, bushes and rocks have
materials: they burn, break and leave stumps or rubble. `docs/WORLDGEN.md` has the rules and measurements;
`npx tsx scripts/worldsheet.ts 8 1 sheet.png` draws a contact sheet, `scripts/worldstats.ts` runs the gate sweep.

## Deploying (GitHub Pages)

The game is a static site: `dist/index.html` (about 1.4 MB: code, UI icons and the font), `dist/art/` (every Pokémon's atlas, frame table, portrait and cry, plus a manifest and the hero pick's portrait sheet, all content-hashed) and `dist/music/` (the adaptive score). The page fetches the manifest and the hero sheet at boot and a match's Pokémon before the match starts (docs/ROADMAP.md "Item 3: A1 plan"). It has no backend, so GitHub Pages hosts it for free.

`.github/workflows/deploy.yml` runs on every push to `main`: `npm ci`, `npm test`, `npm run build`, then publishes `index.html`, `art/` and `music/`. One-time setup: repository **Settings → Pages → Build and deployment → Source: GitHub Actions**. Progress shows under the **Actions** tab. To publish an update: commit and `git push`.

`dist/` is not committed; CI rebuilds it.

## Checks

```bash
npm test          # deterministic node:test suites, the replay baseline among them
npm run typecheck
npm audit
```

The gates for movement, maps and performance are listed under [Build](#build) and in `CLAUDE.md`. The browser merge check is `tests/browser/range.py` (title, hero pick, fire at a dummy, a Breakthrough), run by hand with Playwright, not in `npm run check` (`tools/README.md`).

Known limitations: desktop keyboard and mouse still feel best, touch controls are supported on portable screens, and gamepad works; needs WebGL2; audio starts after the first click; combat and UI sounds are silent until recorded ones are added; settings are stored in the browser's localStorage only. There is no multiplayer and no server.

## Licensing and takedown

The code in this repository is the author's. The game content is not:

- Pokémon names, designs, cries, sprites and data belong to Nintendo, Creatures, GAME FREAK and The Pokémon Company. No licence in this repository grants rights in them.
- Sprites come from [PMD SpriteCollab](https://github.com/PMDCollab/SpriteCollab) (CC BY-NC 4.0, attribution required, non-commercial only). Most are official Pokémon Mystery Dungeon art credited to CHUNSOFT.
- Cries and icons come from PokeAPI repositories whose own licence is CC0, but whose contents are © The Pokémon Company.
- Per-asset provenance and credits: [docs/ASSETS.md](docs/ASSETS.md), the in-game Credits screen, and `content/report.json`.
- Font: Pixelify Sans, SIL OFL 1.1 (`content/fonts/PixelifySans-OFL.txt`).

Hosting these assets publicly is redistribution of third-party intellectual property, and rights holders can ask for removal. If you are a rights holder and want something taken down, open an issue and it will be removed promptly.
