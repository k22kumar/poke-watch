# Pokémon asset pipeline

How species data, sprites, portraits and cries get into Poke-Watch. Every Pokémon in the game comes from three sources:

- **PokéAPI** (static `PokeAPI/api-data`): species, stats, types, level-up moves, evolution chains, the type chart.
- **PMD SpriteCollab**: `sprite/<dex4>/AnimData.xml`, `<Anim>-Anim.png`, `<Anim>-Shadow.png`, `credits.txt`; `portrait/<dex4>/Normal.png`; `credit_names.txt`.
- **PokeAPI/cries**: `cries/pokemon/legacy/<id>.ogg` (or `latest`, by `cryEra`).
- **PokeAPI/sprites**: HGSS type badges and item icons listed in `content/icons.json`.

The content is generated at build time and shipped inside the game; nothing is downloaded while playing.

## Architecture

```
 content/roster.json            who plays which role (partners, wild + behaviour, bosses + kit, regions)
        │
 scripts/fetch-sources.sh       sparse git checkouts of the three sources, limited to the roster  -> ../src-data
        │
 scripts/build-content.mjs      runs scripts/import-pack.mjs for partners (+1 evolution) and enemies,
        │                       sizes bosses, builds the type chart, then writes:
        ├─ src/content/pokedex.ts   species, moves, TYPE_CHART, STAGE_TABLES      (imported by the sim)
        ├─ src/content/art.json     atlases, frames, anchors, portraits, cries, credits  (loaded at boot)
        └─ content/report.json      every source file with URL + SHA-256; content/preview/ contact sheets

 runtime: src/assets/builtin.ts  art.json -> buildArt -> resolveClips (fallback table) -> registry,
                                 renderer textures, CryBank samples (synth fallback)
          src/rules/*            SPECIES, MOVES, element chart and stages read pokedex.ts
```

| Responsibility | Module |
|---|---|
| Roster and roles | `content/roster.json` |
| Species data provider | importer (`importOne`, `toMoveRow`, `evolutionInfo`) → `build-content.mjs` → `src/content/pokedex.ts` → `rules/species.ts` |
| Visual asset provider | importer `importSprites` (PMD) → `art.json` → `src/assets/builtin.ts` / `pack.ts buildArt` |
| Audio provider | `src/assets/cries.ts` (`CryBank`: samples with loudness normalisation, synthesised calls as fallback) |
| Animation system | `src/assets/art.ts` (states, fallbacks, `frameAt`, `dirIndex`), `src/assets/clips.ts` (`resolveClips`), renderer animation controller |
| Combat and abilities | moves become `MoveData` rows; behaviour comes from `classify()` (hand-picked shapes for partner moves, then archetype hints from canonical targeting, then name rules) |
| Rendering integration | `Renderer.addArt` uploads any `CreatureArt`; `CREATURE_VS` draws per-frame rects with anchors; bosses at a whole-number scale |
| Manifest and registry | `art.json` is the manifest; `src/assets/registry.ts` holds per-Pokémon records (source, licence, credits, clip mapping, cry, status, checksum) shown on the Credits screen |

## Rebuilding the content

Requirements: Node 18 or newer and git. No npm packages.

```bash
npm run fetch-sources   # bash scripts/fetch-sources.sh ../src-data
npm run content         # node scripts/build-content.mjs --clones ../src-data
npm run build
```

`npm run content:net` fetches the same files over HTTPS (pokeapi.co, raw.githubusercontent.com) instead of from checkouts; responses are cached in `.import-cache/`. Open `content/preview/index.html` to check every animation in 8 directions with anchors marked.

### Roles

- **Partners** get a starter move (an early same-type attack), six more moves on the game's pacing, and their first evolution at its real level (Charmander → Charmeleon at 16).
- **Wild Pokémon** take a behaviour (`chase`, `tank`, `swarm`, `ranged` with a shot element, `charger`, `healer`) and an optional `flying` flag.
- **Bosses** take a title, an attack kit (`slam`, `radial`, `summon`, `charge`, `spiral`, `volley`), HP phase thresholds and the Pokémon they summon. They're drawn at `clamp(round(bossPixelHeight / idleHeight), 2, 3)`× so the pixel grid stays whole; the hitbox follows the drawn height.

## What the importer does (per Pokémon)

1. **Identify**: `pokemon/<name>` → id, types, stats, height, moves, cry URL; `pokemon-species/<id>` → national dex number, English name, evolution chain.
2. **Normalise data**: types → Poke-Watch elements (fire→blaze, water→tide, …); stats → `hp/atk/def/spa/spd/spe`. Gameplay values are derived (hitbox height from the sprite, not the Pokédex height).
3. **Moves**: level-up moves for the version group are fetched one by one (`move/<name>`). Damage moves become rows with power, class, priority, accuracy, ailment and chance, drain and multi-hit. Weather moves become `weather`, self stat boosts `buff`, other status moves are dropped. **Archetype hints** come from canonical targeting: moves that hit every opponent become a radial `nova`, physical priority moves a `dash`; everything else goes through the runtime classifier.
4. **Learnsets**: partner lines use the curated `learnsets` in `content/roster.json` (a starter move plus `[gameLevel, move]` pairs). Every move is checked against the line's HGSS level-up list and attached to the earliest stage that learns it; a move the line can't learn in HGSS stops the import. Other Pokémon get the automatic pacing: an early same-type attack, then six moves at Lv 3, 6, 9, 13, 18, 24. Moves of another type become **coverage** offers, gated by their HGSS level. The HGSS facts themselves (abilities without hidden ones, the level-up list, evolution level, height, weight) are written to `canon` and never edited by balancing. `--learnsets <file>` overrides the roster's curated sets.
5. **Evolution**: the full chain is read, giving each stage and its level (Totodile → Croconaw at 18 → Feraligatr at 30). `partnerEvolutions` in the roster (or `--evolutions`) sets how many stages to include; the built-in roster uses 2.
6. **Sprites**: `AnimData.xml` is parsed (CopyOf resolved). For Idle, Walk, Attack, Strike, Shoot, Charge, Hurt, Faint and Sleep, the importer decodes `<Anim>-Anim.png` and `<Anim>-Shadow.png`. Each frame is cropped to its opaque box; its feet anchor is the centroid of the shadow marker (or the lowest opaque row if the shadow sheet is missing). Identical frames are deduplicated and everything is shelf-packed into one atlas per species. Frame durations and Hit frames are kept exactly.
7. **Portrait and credits**: `portrait/<dex4>/Normal.png` and the folder's credit list. Discord ids in `credits.txt` are resolved to artist names through `credit_names.txt`; ids with no public name are kept and labelled.
8. **Cry**: `cries/pokemon/<era>/<id>.ogg` for the chosen era (`--cry-era`, default `legacy`), falling back to the other era; checked for an OGG header. The content build adds an MP3 transcode (ffmpeg) and records loudness and length. The era actually used is stored per cry.
9. **Validate and report**: column/duration mismatch, missing direction rows, missing shadow sheets, missing cries or portraits are reported per species. The output has a preview contact sheet and `report.json` with every source URL and its SHA-256.

## Runtime loading

`loadBuiltinArt` (src/assets/builtin.ts) decodes each atlas, builds clips with `resolveClips` (the fallback table fills any missing state and records which fallback was used), measures visible height, registers art, cry and provenance, and uploads a texture. A Pokémon with only a walk cycle still plays every state (bob, lunge, flash, sink overlays). The registry marks each state as native or substitute (`NATIVE_CLIP`). A cry that fails to decode as OGG tries the MP3, then falls back to a synthesised call; requests made while it decodes are queued.

`npm run content` also embeds the UI icons (`content/icons.json` → `src/content/icons.json`) and any licensed music listed in `content/music/manifest.json` (→ `src/content/music.json`).

## Testing the pipeline offline

```bash
npm run fixtures         # tests/fixtures/mirror: PokéAPI-shaped JSON + SpriteCollab-layout sheets
npm run import:fixture   # packs/fixture/fixture.bonkpack.json
npm test                 # includes tests/pack.test.ts (end-to-end importer + validator + fallbacks)
```

The fixture mirror uses real stats, HGSS learnsets, evolution levels, move metadata, and the real SpriteCollab frame sizes and durations for 0004/0007/0158. Its pictures are placeholder blobs, and it contains two deliberate faults (Squirtle's Hurt has no shadow sheet; Totodile has no cry) so the reporting and fallbacks are exercised.

## Licensing

| Source | Licence of the repository | Rights in the content | Use in Poke-Watch |
|---|---|---|---|
| PMD SpriteCollab sprites and portraits | CC BY-NC 4.0 (contributors) | Underlying character designs © Nintendo / Creatures / GAME FREAK / The Pokémon Company | Built into the game; credited per Pokémon on the Credits screen and in `content/report.json`; non-commercial only |
| PokéAPI data | PokéAPI | Names, stats and move data are game data © the same companies | Built into the game |
| PokeAPI/cries | CC0 repository | Its LICENSE states the audio is © The Pokémon Company | Built into the game |
| PokeAPI/sprites (type badges, item icons) | CC0 repository | Its LICENCE states all image contents are © The Pokémon Company | Built into the UI |
| Pokémon Showdown | MIT (README: "distributed under the terms of the MIT License") | Game data © the same companies | Design reference only (schema of species, moves, learnsets); no code or data copied |
| Pokémon Essentials | CC BY-NC-SA 4.0 (LICENSE); an RPG Maker XP / Ruby kit | Same | Design reference only; its engine can't run in a browser, and ShareAlike would bind derived code |

Poke-Watch is a private, non-commercial fan project. Because the build now contains Pokémon sprites, cries and data, keep it private: don't sell it, monetise it or host it publicly.
