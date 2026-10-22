# Expedition art direction

How Poke-Watch looks, why, and how to check it. The rules are data in `src/render/artdirection.ts` and `src/render/decor.ts`; this file explains them. Everything here is presentation only: the simulation never reads it, and the sim checksums (`scripts/checksum.ts`) are identical before and after this pass.

## What the game already was (constraints, confirmed in code)

- Hand-written WebGL2, fixed north-up camera (Wide preset, `docs/CAMERA.md`), 16 texels per metre, low internal resolution upscaled by an integer factor. The world is a 3D mesh (ground, cliffs, water, stairs, bridge) and every prop and Pokémon is an upright, alpha-tested pixel-art billboard. Creatures are PMD SpriteCollab atlases.
- Arenas are built in code (`src/world/arenas.ts`). **All four biomes share one map skeleton** and differ in dressing and palette. Changing layouts changes collision and spawns, so it changes the simulation and its regression hashes. This pass therefore leaves layouts alone and works on presentation.
- Before this pass the play floor was the brightest, most saturated surface in the frame (meadow grass `#8cd060`, frost near-white snow). The forest wall, the floor and the Pokémon all competed at similar values. Snow camouflaged pale and blue Pokémon. Surface overlays were hard squares. Every coated enemy had a ring. The player had no marker except a pale ring. Behind a tree wall the player disappeared.
- Not implemented in the game, so not addressed here: online co-op (teammates are the local squad), free camera rotation and zoom.

## Principles

The references set the job, not the look. Explorers of Sky contributes creature-centred scale, a wilderness that feels lived in, and dungeon walls that frame a lit floor. HeartGold/SoulSilver contributes tile-built ground with soft transitions, regional palettes and memorable landmarks. UNITE contributes the rule that combat signals own their hues and always sit on top.

The frame is built in four layers, from quietest to loudest:

| Layer | What | Rule |
|---|---|---|
| 1. Floor | walkable ground | Mid value and muted saturation. Large soft mottling (dithered, never a smooth gradient) so it is never one flat fill. A cool shade along dense forest edges. Low decor only. |
| 2. Frame | forest walls, cliffs, the decorative ring | Darker and cooler the deeper a tree sits behind open ground (up to `frameDark`, toward `frameCool`), so walls frame the clearing like PMD dungeon walls. |
| 3. Actors | Pokémon | Their own key light (`actor`), never dimmed by a biome's night tint. 1 px outline. After signals, the most saturated things on screen. |
| 4. Signals | telegraphs, the player marker, rings, projectiles | Reserved hues: hostile red/orange, own white/cyan. Drawn on top and kept scarce. |

Readability takes priority over atmosphere. Where a technique hurt it, it was cut back. The vignette and the edge shade were each reduced once after measurement (see Prototype).

## The system

**Colour** (`ART_DIRECTION` per biome, merged over `BIOME_ART`):

| Biome | Floor (base / mottle) | Edge shade | Frame | World light | Actor light | Vignette |
|---|---|---|---|---|---|---|
| Sunpetal Meadow | sage `#96ca6e`, mottle `#8abe66` / `#a2d07a`; path warm sand `#dcc596` | `#2c5a4c` × 0.8 | −34 %, cooler | 0.98 0.98 0.96 | 1.04 1.03 1.00 | 0.16 deep green |
| Cinder Badlands | ochre `#cfa26e`, mottle `#c49866` / `#dab07c` | `#5a3428` × 0.9 | −30 %, mauve | 1.00 0.96 0.90 | 1.04 1.00 0.96 | 0.18 ember brown |
| Rimefrost Heights | snow pulled down to `#dbe5ef`, mottle `#cfdbe8` / `#e6edf5` | `#4a5e80` × 1 | −30 %, blue | 0.95 0.97 1.02 | 1.00 1.00 1.02 | 0.14 slate |
| Duskwood Hollow | night green `#4a8052`, mottle `#447a4e` / `#558a5a` | `#14283a` × 1 | −36 %, blue | 0.86 0.90 1.05 | 1.06 1.02 1.00 | 0.24 night blue |

**Pixel treatment.** Every gradient this pass adds is quantised and ordered-dithered with a 4 × 4 Bayer matrix: ground mottling (3 levels), edge shade (2 steps), and the vignette (4 levels). This keeps the screen on the same pixel grid as the sprites. Nothing new is alpha-blended except the vignette's dither levels.

**Terrain and decor** (`src/render/decor.ts`). Small, muted, non-colliding sprites are placed from the arena map with a fixed hash: grass clumps, leaf litter or twigs, pebbles (also kicked to trail edges), and ferns or frosted shrubs or dry scrub along forest walls. Decor follows these rules:

- It stays lower than a Pokémon's knee (≤ 10 px).
- It uses the ground's own ramp and never a signal hue.
- It is never placed on a prop, water, wall or tall-grass tile.
- It is denser near forest edges (it softens the floor-to-frame seam) and thinned to a quarter within 8 tiles of the spawn and 10 tiles of the boss glade, where fights happen.
- Grass decor burns away with the cell, like tall grass.

About 530 sprites per arena.

**Storytelling.** A cold expedition camp sits beside the crossroads signpost in every region: a stone fire ring, a bedroll and an explorer's satchel. It tells you a team has passed through, and it is the one landmark you see at spawn. Each piece tries a few nearby tiles, so it survives small layout edits.

**Combat VFX and signals.**

- Surface overlays (wet, burning, charged) take their four neighbours into account. Patches have rounded, stippled edges instead of hard squares, and wet is capped at 0.22 alpha.
- Coat rings show only on elites, alphas and bosses (fodder keeps its tint).
- The player gets a cyan ring (alpha 0.95) and a facing pip. The magnet radius ring drops to 0.1 alpha.
- When the player is behind a tree, wall or crowd, an x-ray silhouette is drawn through it (a second draw with `depthFunc GREATER`). The sprite's dark outline is kept and the body is a cyan/white checker.

**Camera.** The camera is unchanged: the Wide preset, fixed north-up. The comparison in `docs/CAMERA.md` still holds. The occlusion problem it left open, a player hidden behind a canopy, is now handled by the silhouette rather than by fading trees. Fading trees would cost depth sorting and break the frame layer.

**UI.** The existing cream-box UI already matches a PMD/HGSS hybrid and was left alone. Own-team colour in the squad HUD is a possible follow-up.

## Prototype: the Sunpetal Meadow crossroads

The vertical slice is the central crossroads of Sunpetal Meadow, where every run spawns. It covers the path junction, signpost, forest edges, a flower bed, the opening swarm and the boss approach. It was measured against the pre-pass build in ten seeded scenes (`tools/artscenes.json`) at the same camera, seed and time: exploration in all four biomes, a stage-1 swarm, a dense swarm along the forest wall, the Sudowoodo boss approach, a night swarm, a three-Pokémon squad on snow, and a forest-edge run.

The measurement is `pokewatch.metrics()` (`src/render/metrics.ts`). It renders the same frame with layers hidden and compares pixels in CIELAB:

- **actors**: Pokémon pixels against the ground behind them.
- **player**: the active Pokémon, its marker and shadow against what is behind it.
- **cam**: share of pixels with ΔL < 12 and ΔE < 20, i.e. camouflaged.
- **over**: share of the screen covered by overlays.

Run it with `node tools/cap.mjs $PWD/dist/index.html tools/artscenes.json <out>`.

After values are the range over three capture runs. Combat scenes are not pixel-identical between runs because the browser bot's timing varies; exploration scenes are. Before values come from a single run.

| Scene | Actors ΔE | Actors camouflaged | Player visible px | Player camouflaged | Overlay cover | Floor L* / sat |
|---|---|---|---|---|---|---|
| explore meadow | 75.7 → 71.3 | 0 → 0 | 306 → 308 | 0 → 0.013 | 0.40 → 0.45 % | 74 / .52 → 70 / .45 |
| explore badlands | 51.6 → 51.3–54.5 | 0.066 → 0–0.065 | 334 → 336–359 | 0.054 → 0.065–0.097 | 0.41 → 0.47 % | 64 / .53 → 58 / .49 |
| explore frost | 49.2 → 46.7 | **0.210 → 0.060** | 358 → 360 | **0.251 → 0.128** | 0.37 → 0.43 % | 86 / .17 → 79 / .19 |
| explore dusk | 53.3 → 50.0 | 0.063 → 0.062 | 335 → 337 | 0.054 → 0.074 | 0.40 → 0.46 % | 44 / .40 → 43 / .39 |
| swarm meadow | 79.7 → 72.3–72.4 | 0.009 → 0.006–0.010 | 144 → 156–284 | 0.076 → 0.099–0.103 | 2.63 → 2.03–2.07 % | 66 / .57 → 56 / .53 |
| dense swarm at forest wall | 78.1 → 71.4–71.6 | 0.013 → 0.006–0.009 | **9 → 235–246** | 0.111 → 0–0.051 | 2.80 → 2.92–3.01 % | 63 / .58 → 49 / .54 |
| swarm dusk | 65.1 → 56.4–56.6 | 0.008 → 0.011–0.013 | 159 → 202–220 | 0.283 → 0.202–0.336 | **9.84 → 6.40–6.49 %** | 40 / .48 → 34 / .49 |
| boss approach | 71.8 → 63.8–63.9 | 0.004 → 0.007 | 187 → 218 | 0 → 0.055 | 3.45 → 3.75–3.94 % | 70 / .54 → 65 / .47 |
| squad on snow | 63.3 → 60.8–60.9 | 0.032 → 0.048–0.049 | 338 → 355–389 | 0.127 → 0.177–0.208 | 0.48 → 0.51–0.52 % | 74 / .26 → 66 / .29 |
| forest edge | 60.7 → 65.2 | 0 → 0.009 | **76 → 230** | 0 → 0.009 | 0.29 → 0.29 % | 71 / .54 → 64 / .48 |

**What the numbers support:**

- Snow no longer camouflages pale and blue Pokémon: the camouflaged share dropped from 21 % to 6 % for actors and from 25 % to 13 % for the player (Totodile).
- A player hidden behind trees or inside a crowd is now visible: 9 → ~240 px in the dense scene, 76 → 230 px at the forest edge. This is the silhouette, an outlined cyan/white checker; the first version was a plain cyan stipple, which got lost in a blue Zubat swarm.
- Overlay coverage in the heaviest scene fell by a third.
- The floor now sits below the actors in saturation everywhere, which is the intended hierarchy.

**What they do not support:**

- Mean actor contrast fell by 3–9 ΔE in most scenes, because the floor moved from a bright lime to a mid sage. It stays above 50 everywhere. The camouflaged share of actor pixels stayed at or below 1 % in the meadow and dusk scenes.
- Player camouflage rose in the boss scene (0 → 0.055) and the snow squad scene (0.127 → about 0.19), and slightly in the meadow swarm. Darkening the snow helps pale and blue Pokémon but brings it closer to mid-toned ones like Ivysaur. That is a real trade-off. The figures include the player's shadow and marker pixels and were not decomposed further.
- In response, the meadow floor was lightened once (`#90c46a` → `#96ca6e`, edge shade 1 → 0.8).
- The first-round vignette (0.22–0.30, starting at 42 % radius) and edge shade darkened combat frames to L* 30–54. Both were reduced. Dusk remains the darkest region by design.

**Not measured:**

- Artistic cohesion and sense of place are judgements. They come from the before/after frames, not the metrics. The intended reading: the clearing reads as a lit place framed by forest, the camp and decor make it feel visited, and the four regions share one treatment.
- No human playtest was run.

## Performance

Measured in the cloud container with SwiftShader (CPU rendering), `tools/perf.mjs`, 228–240 live enemies, three runs each:

- **Frame:** p50 render submit is unchanged at 0.4 ms. p95 was 0.9–2.0 ms before and 0.7–1.0 ms after; these numbers are noisy on CPU.
- **Sim step:** unchanged (p50 0.4 ms).
- **Additions per frame:** one full-screen dithered vignette triangle and at most one extra silhouette instance. The ≈530 decor billboards per arena go through the existing prop batch (capacity 8192) with the same view culling.
- **Boot:** the ground texture paints the mottle and shade per pixel. After caching the noise lattice and skipping unshaded tiles, painting costs about 5–15 % more than before in a Node timing. Time to the first stage in the browser rose from about 1.1–1.5 s to about 1.4–1.7 s in this container.
- **Not measured:** GPU cost on real hardware.

## Adding to it

- A new biome gets an `ART_DIRECTION` entry (floor, mottle, edge shade, frame, lights, vignette) and a `PAL` entry in `decor.ts`. Nothing else is biome-specific.
- New decor must pass the decor rules above. Check it with `pokewatch.metrics()` in the swarm scenes: actor camouflage must not rise.
- New signals use the reserved hues and draw in the decal/FX layers, never as props.
