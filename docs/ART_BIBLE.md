# Poke-Watch art bible

The rules that keep the world, the creatures (original or imported), the effects and the UI looking like one DS-era production. Each rule names the code that enforces it, so a change is made in one place.

Reference: the 2.5D pixel presentation of Pokémon handheld adventures (16 px tiles, tilted perspective camera, tiered tree walls, outlined pixel sprites lit from the top-left, cream text boxes). Poke-Watch copies none of those games' assets; everything below is painted in code or imported by the player.

## 1. Camera and projection

| Rule | Value | Where |
|---|---|---|
| Projection | Perspective, 30° vertical FOV (narrow, so tiles stay nearly square across the screen) | `rules.camera.fov` |
| Pitch | Per preset: Wide (default) 0.86 rad (≈49°), Classic 0.82 rad (≈47°), Overhead 0.98 rad (≈56°) | `src/render/camera.ts` |
| Yaw | Fixed, looking north (−z). Up on the stick is always up on screen. No player camera control. | `Renderer.yaw` |
| Pixel density | **16 screen pixels per metre at the focus** — the camera distance is solved from the internal resolution every frame | `rules.camera.pxPerMetre`, `Renderer.render` |
| Internal resolution | About 250 lines, integer-upscaled with nearest filtering. "View size" in Settings changes how many lines (how much world) you see, never the pixel size | `Renderer.resize` |
| Snapping | The look-at point snaps to 1/16 m so the ground never shimmers | `Renderer.render` |
| Follow | Critically damped follow plus a 1.2 m lead in the movement direction | `rules.camera.lead` |

## 2. World units and tiles

- 1 tile = 1 m = 16 texels. Every ground texture, prop and sprite is authored at 16 texels per metre (`TEXELS_PER_METRE`, `PIXEL_DENSITY`).
- Arena size 112 × 112 tiles (`ARENA_SIZE`). Row j grows toward the camera (south, +z).
- Elevation steps: **2 m** bluff cliffs (rock face), **0.5 m** ledges (grassy lip), 0 m ground, water surface at −0.25 m (`WATER_Y`). Stairs are two-row flights (1 m rise per tile) so they stay inside the 0.6 m step rule.
- Collision is the tile grid (`src/world/tiles.ts`): *walls* (trees, boulders, statues, signs) never pass; *platforms* (rocks 0.75 m, bushes 0.7 m, logs and stumps 0.65 m) block walking but can be jumped onto; water blocks walkers; flyers ignore both.

## 3. Upright billboards

Everything that stands up (trees, rocks, flowers, tall grass, creatures) is an upright quad stretched vertically by `1 / cos(pitch)` (`Renderer.stretch`). With the camera at 47°, that maps one sprite texel to one screen pixel in both axes. Rules:

- Never rotate a billboard toward the camera's pitch; depth sorting depends on billboards being vertical planes at their base.
- Billboards are alpha-tested (`a < 0.5` discards), never alpha-blended, so depth testing sorts creatures behind trees, cliffs and grass with no transparency sorting.
- Placement: a prop stands at its footprint's south edge minus an inset. Trees use −0.55 m, tall grass −0.06 m (so wading creatures show above it), flowers −0.3 m with a small deterministic jitter, the elder tree −0.9 m (`TileStage.layoutProps`).
- Props between the camera and the player turn into a 50 % checkerboard dither, never transparency (`BB_FS`).

## 4. Creature sprites (any source)

| Rule | Value | Where |
|---|---|---|
| Density | 1 texel = 1/16 m. PMD sheets are used 1:1 | `CREATURE_VS` |
| Directions | 8, PMD order: down, down-right, right, up-right, up, up-left, left, down-left. Row = `round(facing / 45°)` with facing = `atan2(vx, vz)` | `dirIndex` |
| Anchor | Every frame carries its own feet anchor. PMD: centroid of the frame's Shadow-sheet marker; fallback: lowest opaque row, horizontal centre | `importSprites`, `FrameRect.ax/ay` |
| Outline | 1 px dark outline (#201c28 family). Baked designs get it from the baker; PMD art already has it | `baker.ts outline()` |
| Light | From the upper left. The baker's light vector and PMD's shading agree | `baker.ts` |
| Size classes | Elites ×1.5, alphas ×2 (rules); bosses drawn at a whole-number 2–3× so pixels stay square | `rules.enemy.roles`, `SpeciesDef.scale` |
| Shadows | Flat two-tone blob, hard edge: 0.42 m / 0.55 m / 0.8 m radius for PMD shadow size 0/1/2 | `DECAL_FS` kind 0, `fillDecals` |

### Animation states and timing

Gameplay asks for one of eight states; each source maps onto them through `ANIM_FALLBACKS` (`src/assets/art.ts`):

| State | Source chain (first match wins) | Used when |
|---|---|---|
| idle | Idle → Walk frame 0 + bob | standing |
| walk | Walk → Idle | moving; cadence 1.6 frames per metre travelled, whatever the source's frame count |
| attack | Attack → Strike → Swing → Double → Kick → lunge overlay | melee casts (strike, dash, cone, nova, spin, trail) |
| shoot | Shoot → Charge → Attack → lunge | projectile casts |
| charge | Charge → Shoot → Attack → lunge | zones, chains, buffs, boss wind-ups |
| hurt | Hurt → Pain → Cringe → flash overlay | hit (enemies: while the hit flash lasts; player: 0.3 s) |
| faint | Faint → Sleep frame 0, sinking → Hurt frame 0, sinking → Walk frame 0, sinking | KO. Native Faint plays through, then dissolves; substitutes sink into the ground over the clip and dissolve after |
| sleep | Sleep → EventSleep → Laying → Idle → bob | sleep status |

PMD durations are kept exactly (ticks of 1/60 s). Attacks follow a timeline: each attack shape has a short wind-up (`rules.feel.windup`, 0.06–0.14 s, refunded from the cooldown), the frames before the clip's HitFrame are fitted into it, and the move releases on the HitFrame. The Pokémon turns to face its target for the cast, and the attack clip plays even while walking (before, moving casts kept the walk cycle).

Native and substitute clips: 16 of 38 Pokémon have a native Faint; the other 22 use the sinking Sleep-frame substitute. The Animation notes column on the Credits screen lists every substitution.

## 5. Palettes

Ground, cliff, bank and water colours live per biome in `BIOME_ART` (`src/render/tileart.ts`); prop ramps in the same file and `pixelart.ts`. Every ramp is 3–4 tones: highlight, base, shade, deep shade.

| Biome | Ground | Path | Water | Wall props | Light tint |
|---|---|---|---|---|---|
| Sunpetal Meadow | grass `#8cd060` (light `#b8ec88`, dark `#5ea242`) | path `#e0c890` | blue `#4c94e8` | Johto broadleaf trees, round trees, bushes | neutral |
| Cinder Badlands | ochre `#d9a86c` | basalt `#7a6458` | lava `#ff7a28` (unlit, glows) | dead trees, boulders | warm |
| Rimefrost Heights | snow `#e8f2fb` | packed snow `#b8c8d8` | icy `#5aa0d8` | snowy pines, boulders | cool |
| Duskwood Hollow | night forest green | earth | violet `#6a50e0` (glows) | Johto trees in night ramps | cool night tint |

These are the painters' base palettes. The expedition art direction (`docs/ART_DIRECTION.md`, `src/render/artdirection.ts`) overrides the floor colours per biome with muted, mottled values. It also adds the forest-edge shade, the frame darkening, and separate world and actor light. Change floor colours there, not here.

Value hierarchy: floor (mid, muted) < frame (darker, cooler with depth) < actors (own key light) < signals (reserved hues). Hostile red/orange and own white/cyan are signal colours; no prop or decor uses them.

Contrast rule: creatures must stay readable on every ground. The 1 px outline does this; never ship a creature without it, and never use pure black ground.

## 6. Terrain transitions and composition

- Paths, sand, stone and water blend into grass along smoothed tile masks with a dark 1 px lip (`paintGround`). Never place hard rectangular terrain changes; use `blob` with `wobble`.
- Arenas are designed, not rolled: a forest wall around the edge, a central clearing for the opening minutes, paths joining landmarks, at least one raised feature with stairs, one water feature with banks, tall-grass fields and an open boss glade (`src/world/arenas.ts`).
- Keep combat space open: obstacles come in clumps of 3–6 with kiting room between them; low props (rocks, bushes) are sparse (≈1 % of tiles).
- Ground decor (`src/render/decor.ts`): clumps, litter, pebbles, edge ferns and the crossroads camp. It is non-colliding, ≤ 10 px tall, uses the ground's own ramp, is never placed on props, water, walls or tall grass, and is thinned near the spawn and boss glade.
- Every walkable tile must be reachable from the spawn; `sealPockets` turns isolated pockets inside the forest into wall, and `tests/world.test.ts` enforces it.

## 7. Layering (draw order)

1. Opaque meshes: ground, skirt, cliffs, ledges, banks, stairs, bridge, water (depth write).
2. Tree shadows (blended, no depth write).
3. Prop and decor billboards (alpha-tested, depth write; wall props darkened by forest depth).
4. Creatures (alpha-tested, depth write).
5. Decals: creature shadows, rings, zones (blended, polygon offset). Boss telegraphs draw over everything.
   The player silhouette (dark outline plus cyan/white checker, `depthFunc GREATER`) draws only where the player is behind something.
6. Pixel effects: projectiles, gems, particles (alpha-tested, camera-facing).
7. Faint additive halos and beam ribbons.
8. Vignette: dithered in four levels, keeps destination alpha at 1.
9. DOM UI and pixel-font damage numbers.

## 8. Effects

Effect sprites are 16 × 16 texels at 16 texels/m (`fxSprite`). Each element has a projectile and two particles (`ELEMENT_FX`). Fades are stippled, never alpha. Soft glows stay faint so the pixels underneath read. Ambient particles (petals, embers, snow, motes) stay under about 5 per second.

Signals stay scarce:
- Surface overlays (wet, burning, charged) are rounded per neighbour and stippled at the edge, never hard squares.
- Coat rings appear only on elites, alphas and bosses.
- The player always has a cyan ring and facing pip.

## 9. UI

- Boxes: cream `#f8f8f0` with a rounded double frame (white inner rule, slate `#3a4a62` outer, pale blue inset) — `--box-shadow` in `style.css`.
- Font: Pixelify Sans (OFL), embedded as a WOFF subset; damage numbers use the in-repo bitmap font on the same pixel grid as the scene.
- Battle info box: name, level, HP tag + bar (green > 50 %, amber > 20 %, red), numeric HP, EXP bar inside the box.
- Move buttons: element-coloured with an outlined white label; cooldown is a darkening wipe.
- Region names arrive on a wooden plaque at the top; events use a centred text box.
- Selection uses a ▶ cursor, not glows.

## 10. Asset naming and import

- Pokémon: one PMD SpriteCollab atlas per species in `src/content/art.json`, generated from `content/roster.json`.
- Imported creatures: species id = PokéAPI name; art from `sprite/<dex4>` in SpriteCollab; moves keyed `snake_case` of the PokéAPI move name.
- Prop sprite keys in the arena atlas: kind name, plus a frame number for animated kinds (`tall0..2`, `flowerR0..1`, `reeds0..1`).

## 11. QA checklist for new art

1. Seen at 16 px/m in the game, not zoomed in a paint program.
2. 1 px outline present; light from the upper left.
3. Feet anchor on the ground in all 8 directions (check the importer's preview: the red pixel is the anchor).
4. Readable on all four ground palettes.
5. Walk cadence looks natural at 7 m/s.
6. Nothing alpha-blended except shadows, rings and halos.
7. `npm test` passes (reachability, anchors, fallbacks).
8. `node tools/cap.mjs $PWD/dist/index.html tools/artscenes.json <dir>` and compare `metrics.jsonl` with the last run. Actor and player camouflage must not rise in the swarm scenes.
