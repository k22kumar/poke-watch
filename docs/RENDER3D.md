# The three.js scene (I2a)

The 3D renderer's scene: the WorldModel's render chunks as lit world meshes, the light rig read from one time-of-day
value, the sky and the fog curve, the creature billboards S2 ported, and one `RenderPipeline`. Task I2a (docs/ROADMAP.md,
D11–D14); the design is docs/WORLDGEN3D.md Q16, Q18, Q20 and Q23 with the owner's confirmations, and S2's decisions
(docs/spikes/S2-renderer.md). Actors, effects and the camera rig are I2b's; the render-side mesh builders and the 3D
range are G1b's; `storybook` is SB's and the running time-of-day cycle TD's.

**Behind a flag until X1a.** `?render=three` turns it on. With the flag off the page is the game as before: the three
side file is never fetched, and the page renderer draws exactly what it drew (tests and `scripts/checksum.ts all` are
unchanged; the renderer's draw path did not change).

## How it loads

- three 0.187.0 and `@types/three` 0.187.0, pinned exactly (S2 decision 6). Upgrades are their own task, with
  `tools/s2matrix.mjs` re-run.
- **A side file** (S2 decision 5): `scripts/lib/threebundle.mjs` bundles `src/render/three/entry.ts` alone into
  `dist/three/scene.<hash>.js`, a classic script (it runs from `file://` too, where module scripts do not). `'three'`
  resolves to `three.webgpu.js`, so WebGLRenderer never enters it. The page is built with the file's name
  (`__THREE_URL__`); `src/render/threeload.ts` loads it only with `?render=three`, and the file registers its factory
  on `window.__pokewatchThree`. The build fails if the page bundle takes in three or `src/render/three`
  (`assertNoThree`). `scripts/dev.mjs` builds the side file once at start (restart it after editing `src/render/three`).
- Bytes (I2a, minified): `dist/index.html` 2,035,549 B (2,033,372 B on `main` 267cffe: +2,177 B for the loader, the
  tile lamps and the renderer's switch); the side file 881,852 B, of which three is 824 KB.
- **The page/side contract** is `src/render/threehost.ts` (types only). The page passes a `ThreeHost`: the canvas, the
  URL parameters, `world(ctx)` (the map's WorldModel through the tile adapter, its art key and its lamp emitters, cached
  per map) and `sheet(id)` (each creature sheet's size and walk cadence, as the page renderer sized it). The side file
  never bundles a page singleton.
- **The page renderer keeps the lens.** With the flag on, `Renderer.present` is false: its `render()` still runs the
  camera rig (and the projections, aim, the HUD hooks, damage numbers) and writes the lens to `Renderer.cam3`, then
  returns before any draw; no tile stage is built. The scene draws on its own canvas (`#scene3d`, above the page's
  canvas, pointer events off), from `cam3`. I2b replaces the rig.

## Files

| | |
|---|---|
| `src/rules/styles/profiles.ts` | the closed profile registry (`lowpoly` only, D11): per-role shading, `shape`, `paint`, the pass list, ink and bloom parameters, constraints |
| `src/rules/styles/passes.ts` | the closed registry of post passes (`ink`, `bloom`) and what each reads |
| `src/rules/styles/bindings.ts` | one biome binding per art key: role → base colour, liquids, sky, fog, world and actor light, vignette, light class |
| `src/rules/styles/timeofday.ts` | keyframes, the fixed hour, the key light's path, `lightingAt` (the one path), `?tod=` |
| `src/rules/styles/resolve.ts` | `resolve(profile, artKey, { look, overlay, stagings })` → `ResolvedStyle`, with the clamp log |
| `src/render/world3d/` | no three: the top field, the bakes (sky visibility, lamps), the mesh builder (normals), the lighting uniforms; `tilelamps.ts` (page side, X1b deletes it) |
| `src/render/three/` | the side file: `entry`, `view` (the scene), `backend`, `worldmat` (the material family), `passes` (the pipeline), `billboard` (S2's port) |
| `src/render/threehost.ts`, `threeload.ts` | the contract and the page's loader |
| `tools/s2perf.mjs`, `tools/s2matrix.mjs` | measurement (ported from the spike), `tools/three-signal.mjs` (the signal check) |
| `tests/styles.test.ts`, `tests/timeofday.test.ts`, `tests/world3d.test.ts` | the gates |

## Style data

Four layers and one resolver (Q18.1): profile defaults ← biome binding ← map `look` ← theme overlay, then clamped by
the profile's constraints, each clamp logged. `look` (a recipe's section, G1a) and overlays (Q14g) have no producer
yet; their shape is `LookLayer`. The dev experiment layer (Q18.4a) is an overlay built from URL parameters.

**Transcribed, not designed.** Every binding colour is today's, read off the tables the bindings replace (Q18.1): role
bases from ART_DIRECTION and BIOME_ART ground and cliff palettes and the tile-art prop ramps; liquids from BIOME_ART
water and its `waterGlow`; sky and fog from `render/sky.ts`; world and actor light from ART_DIRECTION or BIOME_ART
tint; the vignette from ART_DIRECTION. Roles the adapter never writes (F54) take the nearest written role's colour.
`tests/styles.test.ts` checks the transcription against the old tables. The old tables go at X1b.

**Neutral where nothing was recorded.** The low-poly profile is flat normals, a continuous ramp, white shadow tint, no
pattern, no paint terms and both optional passes at weight 0 (so neither is built). These are placeholders, not a look:
see "Look values".

## The material family

One TSL node material for every opaque world surface (Q18.2 as superseded by Q23; `worldmat.ts`), with a custom
`LightingModel`:

- **Key light:** one `DirectionalLight` with S2's shadow (2048², PCF, radius 2, a ±40 m box following the player),
  through the role's ramp (continuous at `bands` 0, else banded with soft edges).
- **Ambient rig:** two sets of six colours, one per axis direction (open sky, enclosed), read by the world normal as an
  ambient cube and blended by the vertex's baked sky visibility, times the role's shadow tint.
- **Lamp channel:** the vertex's baked local light × the time-of-day lamp strength.
- **Paint:** facet tone (per plane), the vertical gradient below the local top, strata on steep faces; edge light is
  drawn by the ink pass. Terms at zero build no nodes.
- **Liquids:** the same family, transparent (the profile's opacity), self-lit by the binding's `emissive` share (lava,
  today's glowing water). Flow is a profile number, 0 today.
- **No image textures.** Nothing samples an authored texture; only the creature atlases (sprite art is exempt, Q23.6).
- Materials are `DoubleSide`: the adapter's tops are wound up, but about a fifth of its side faces fail an outward
  test (range 871 of 4,454, River Gorge 2,889 of 12,074), and back faces get the flipped normal.

## World meshes

`render/world3d/mesh.ts` builds each chunk's geometry: positions, **normals computed here** (render chunks carry none,
Q16.4 / Q23), and four per-vertex channels.

- **Normals across chunk borders.** Corners are matched by position (1 mm) across every terrain chunk. A vertex's
  normal is the corner-angle-weighted mean of the faces it keeps: in `flat` mode its own face (coplanar faces share
  vertices), in `crease` mode the faces within the profile's crease angle of its own, in `smooth` mode all. Angle
  weighting makes the result independent of how a surface was split into triangles or chunks (`tests/world3d.test.ts`).
- **The top field** (`topfield.ts`): the highest drawn surface over each 0.5 m cell, rasterised from the chunks.
- **Sky visibility** (`bake.ts`): per vertex, the horizon the top field raises in 8 azimuths out to 15 m, weighted to
  the directions the face sees, cut to a quarter under anything drawn overhead. 1 on open ground, under 0.3 below a
  deck.
- **Lamp channel:** each emitter's colour × intensity × (1 − d/r)² × a wrapped n·l, where the straight line from the
  emitter clears the top field (its own body, 1.5 m, excepted). On generated maps the confinement is the model's
  spaces and portals (Q18.9); the adapter maps have none.
- **Facet tone** (a hash of the plane) and **depth below the local top** (the column behind a steep face).
- Liquids are level: normal up, sky and lamp baked, no paint.
- Cost at load (this machine, Chrome, WebGPU): range 29,534 triangles in 2.7 + 12 + 20 ms (field, normals, bakes);
  River Gorge 45,506 in 3.5 + 19 + 41 ms; Chargestone Cave (54 emitters) 3.6 + 15 + 56 ms. Node is 2–4× slower.

## Time of day (D12)

Every map ships one fixed time. All lighting — the key light, the two sets of six ambient colours, the sky, fog,
grading and the lamp channel's strength — is read from one time-of-day value through the map's keyframes:

- **Keyframes** (`timeofday.ts keysFor`): four per binding. The anchor, at the map's fixed hour, is the transcription
  (an open-sky top facing up gets exactly its base colour: key light × n·l + the open +y ambient = luminance 1); the
  others (night, dawn, dusk, or day for a night map) are derived from it by one rule so `?tod=` can show other times.
  Provisional until TD.
- **The fixed hour** by light class: day maps 10:00, the night biome (Duskwood Hollow) 22:00, caves 10:00.
- **The key light's path** (Q18.8): a plane perpendicular to the team axis (A → B staging markers; z on the range),
  up at 6:00, overhead at noon, down at 18:00; by night the moon takes the antipode on the same path. It never stands
  exactly overhead (2° off, toward neither team).
- **The one path:** `lightingAt(time, hour)` (rules) → `lightAt` / `lightUniforms` (`render/world3d/lighting.ts`) →
  the scene's `apply`, which alone writes every light, fog, sky and grading uniform. `tests/timeofday.test.ts` pins
  that the value changes each part of the lighting, that the scene reads lighting from nowhere else, and that `apply`
  is the only writer.
- **The dev parameter:** `?tod=<hour>` (`17.5` or `17:30`). The preview controls and the running cycle are TD's.

## Pass order

One `RenderPipeline` (S2 decision 2; `passes.ts`):

1. the scene pass (world, actors, sky); an MRT normal target only when a built pass needs it (its alpha is the
   material's ink share, written by world materials through their own `mrtNode`);
2. the profile's registry passes in its order: `ink` (S2's edge pass: depth and normal edges darkened by weight ×
   role share, normal creases lightened by the paint block's edge light; both take the fog of the surface they outline, since
   the pass runs after the scene's fog: the ink colour is fogged with the scene's curve and colour at the pixel's view
   distance, and edge light fades by the same amount), `bloom` (three's BloomNode, added over the
   scene). A pass at weight 0 is not built;
3. `renderOutput` (no tone mapping; the sRGB transform);
4. grading (lift, gain, gamma per channel, saturation) and the vignette, in display space;
5. **the signal composite:** the signal scene's own pass, sRGB-encoded, over the graded frame.

Signals never see the map's fog (their scene has none), bloom (scene pass only) or grading (after it), so a signal's
colour and luminance on screen are the map's grade-, fog- and bloom-free value (Q23 confirmed point 6). The signal pass
is built only when the signal scene has content (today only `?signalcheck=1`; I2b adds the signal kinds and their
occlusion rules). **Check:** `node tools/three-signal.mjs <build>/index.html` draws signal and world cards of one
colour 3 m and 100 m ahead under five variants (plain, a strong grade, night with its fog, bloom 2.5, all at once) on
both backends; the signal cards read sRGB (255, 102, 32) in all ten runs while the world cards move (100 m by day
234,177,150; by night 180,89,60; graded 160,137,123). Result recorded 2026-11-27.

## Local light

The technique is the baked lamp channel (Q18.9 as superseded by Q23): emitters are data, baked per vertex at load,
scaled by the time-of-day lamp strength. On the tile maps the emitters are today's light pools (`TERRAIN_STYLE` glow:
a colour and a radius per prop kind), placed at each pool prop's centre 0.8 m over its ground, reach 1.5 × the
pool's radius, intensity 1.2 (provisional). Generated maps take them from `Dressing` (G1a).

**What the Q20(c) numbers bound under baking** (restated by I2a, as the owner asked): the frame does not pay per
emitter. The bake loops emitters per vertex at load and the shader reads one baked colour per vertex, so frame cost
is the same with 0 or 54 emitters (measured below). So:

- **≤ 64 emitters per map** bounds the bake: load time and nothing else. Chargestone Cave's 54 bake in about 56 ms of
  the 75 ms world build here.
- **≤ 4 overlapping** no longer bounds a screen region's shading cost. It bounds the **lamp channel at any one
  vertex**: at most 4 emitters reach the same vertex (a contribution over 0.02 counts). What it protects is
  readability and range, not time: more overlapping pools saturate the channel and wash a surface flat, and the
  per-side fairness lint (Q17.6a) compares light levels the channel can still tell apart. `buildWorld` reports
  `maxLampOverlap`; the tile maps measure Chargestone 2, Mt. Moon 1 and Cinder Crater **7** (its vent pools, F105).
- Both stay checked at the darkest sampled times inside a map's range (the night samples), on the WebGL 2 backend.

## Budgets (Q20, recalibrated by I2a)

Measured with `tools/s2matrix.mjs` (52 runs, `matrix` groups main, gorge, shadow, passes, bloom, backdrop, cards,
strokes, live, lamps) on this machine, F39 being waived (D14): Apple M3 Max (Metal 3, timestamp queries on), headed
Chrome for Testing, vsync, pixel ratio 1; S2's scene (the range, 240 crowd actors frozen on their ring, the camera
orbiting at 20°/s) unless stated; GPU time from the backend's timestamps, ms p50 / p95. The frame interval is vsync
(8.3 ms at 120 Hz) in every run.

| Scene (1920 × 1080 unless stated) | WebGPU | WebGL 2 backend | Calls, triangles |
|---|---|---|---|
| range, 1280 × 720 | 0.58 / 0.62 | 0.71–0.84 / 0.92–0.99 | 47, 53,331 |
| range | 0.79–0.83 / 0.94–0.96 | 0.85 / 1.01–1.07 | 47, 53,331 |
| River Gorge seed 1 | 0.84 / 1.04 | 0.90 / 1.12 | 55, 56,123 |
| shadows off | 0.40 / 0.54 | 0.62 / 0.90 | 28, 24,097 |
| ink (0.8) | 1.00 / 1.13 | 1.01 / 1.21 | 47 |
| bloom (0.5), its first target at 0.25 / 0.5 / 1 of the frame | 3.71 / 5.06, 4.90 / 6.39, 9.41 / 11.03 | 1.63 / 2.30, 1.96 / 2.62, 2.93 / 5.23 | 59 |
| ink + bloom (0.5) | 6.27 / 7.68 | 2.36 / 2.94 | 59 |
| live crowd (the sim runs, 240 actors close on the player) | 2.06 / 2.68 | 1.37 / 2.80 | 49, 60,237 |
| backdrop 500 / 2,000 / 8,000 hulls (40k / 160k / 640k triangles) | 0.99 / 1.06, 1.27 / 1.35, 2.20 / 3.52 | 0.89 / 1.00, 1.13 / 1.30, 2.21 / 3.93 | 48 |
| particle cards 250 / 1,000 / 4,000 | 0.97 / 1.09, 1.36 / 1.55, 2.51 / 3.64 | 0.89 / 1.07, 1.12 / 1.29, 1.97 / 4.06 | 48 |
| strokes 5k / 20k / 80k (60k / 240k / 960k triangles) | 0.96 / 1.05, 1.30 / 1.35, 2.11 / 2.50 | 0.92 / 1.09, 1.22 / 1.40, 2.40 / 4.26 | 48 |
| Chargestone Cave, 54 lamps / lamps off | 1.01 / 1.18, 1.04 / 1.18 | 1.05 / 1.38, 1.02 / 1.32 | 46, 77,551 |

CPU render (the pipeline's `render` call) is p50 0.4–0.7 ms, p95 0.6–0.9 ms in every run (S2's proposal: 2 ms).
Load: the side file's script and `renderer.init()` take about 100 ms over `file://` on WebGPU; the world build is in
"World meshes".

**The rule** (decided without asking, D10; `src/rules/styles/budgets.ts`): on this reference machine, on the WebGL 2
backend (Q20(c)'s baseline) at 1080p, the frame's GPU time stays **≤ 4.0 ms p95**: a quarter of a 60 Hz frame, so a GPU
four times slower still holds 60 Hz. S2's proposed split keeps its shares, scaled from 12.5 ms to 4.0: terrain 1.28,
actors 0.96, effects 0.64, shadows 0.64, post 0.48 ms. Today's frame is 1.0–1.1 ms p95 (2.8 with the live crowd on the
player), shadows +0.16–0.24, ink +0.15.

**The three new rows of Q20's table**, from the slopes above (WebGL 2, p95 over the 1.0–1.1 ms frame):

| Budget | Number | Basis |
|---|---|---|
| Backdrop | ≤ 150,000 triangles | +0.26 ms at 160,000 (instanced, no shadow pass); its share 0.25 ms of terrain |
| Particle cards | ≤ 1,000 cards (about 1.2 m across, within 12 m of the lens) | +0.25 ms at 1,000 (+0.5 on WebGPU); its share 0.32 ms of effects. Overdraw, not count, is the cost: larger cards or cards nearer the lens count more |
| Strokes | ≤ 120,000 triangles | +0.07 ms p50 at 60,000, +0.37 at 240,000; its share 0.2 ms of terrain |

**Bloom's default:** off. Its quality when a profile turns it on is a quarter-resolution first target (`bloom.resolution`
0.25), the cheapest measured, and it is still over the post budget there (+0.8 ms p50 / +1.3 p95 on WebGL 2), and 2–3×
that on WebGPU (F108). Glow never depends on it (Q23.5).

These numbers bind the shipped profile; dev-only experiment layers are exempt (Q20.5).

## Dev parameters

With `?render=three`: `backend=webgpu|webgl|auto` (WebGL forces the WebGL 2 backend), `profile=lowpoly`, `tod=<hour>`,
`shadow=0`, `perf=1` (the overlay and GPU timestamps), `lamps=0` (no lamp channel). The dev experiment layer (Q18.4a):
`ink=<w>`, `edge=<l>`, `bloom=<s>`, `bloomres=<fraction>`, `facet=<t>`, `vgrad=<v>`, `strata=<s>`, `bands=<n>`,
`grade=<lift>,<gamma>,<gain>,<saturation>`. Checks and benches: `signalcheck=1`, `bench3=backdrop:<n>,cards:<n>,strokes:<n>`.
`window.pokewatchThree` has `report()`, `collect(seconds)`, `lighting()`, `setHour(h)` and `probe()`.

## Measuring

- `node tools/s2perf.mjs <build>/index.html '<query>' [seconds] [warm] [--shot out.png]`: one headed real-GPU run of
  the game page with S2's 240-actor crowd frozen on its ring and the camera orbiting (`live=1` lets it walk), printing
  the scene's report.
- `node tools/s2matrix.mjs <build>/index.html <out.jsonl> [groups]`: the matrix (both backends per line).
- `node tools/three-signal.mjs <build>/index.html`: the signal check.
- Build privately for any of them: `node scripts/build.mjs --out <dir>`.

## Look values

**Owner decisions (2026-11-27)**, in the review of I2a:

- **Bloom:** off at the cutover (Q23.5: glow never depends on it; over budget, F108). It stays a dev profile option
  at quarter resolution (`?bloom=`, `bloom.resolution` 0.25).
- **Fixed hours:** accepted: 10:00 for day maps, 22:00 for Duskwood Hollow, 10:00 for caves. 10:00 also stays clear of
  the low-sun stripes (F110). The key-to-ambient splits (0.65 day, 0.45 night, 0.4 caves) and the enclosed set's share
  of the open set (0.45) stay provisional.
- **Derived keyframes** (night, dawn, dusk): accepted as provisional until TD.
- **Liquids:** opacity 0.78 and flow 0 until G1b.
- **Lamps on the tile maps:** intensity 1.2 and reach 1.5 × the pool radius, accepted; they go at X1b, so no tuning.
- **Resolution:** the scene draws at the window's size with a pixel ratio of 1, the basis the budget was measured on.
  The pixel-step upscale belongs to the sprite and tile look. Measured at native 2560 × 1440 (2026-11-27, same
  scene and method as "Budgets"): the range 1.22 / 1.34 ms (WebGL 2) and 1.39 / 1.64 (WebGPU), River Gorge 1.26 / 1.42
  and 1.35 / 1.65, all inside 4.0. The live crowd on the player is 1.92 / 2.59 on WebGL 2, the budget's baseline, but
  2.17 / **4.90** p95 on WebGPU: the one figure over 4.0 ms (240 actors' sprite overdraw filling the lower screen).
- **Merged as provisional:** the neutral values below ship flag-off with I2a.

**Still open, chosen from a look sheet** (ROADMAP F111; the owner picks from frames, never Claude): the ramp and the
normal mode per role (smooth, flat facets today), the paint terms (all 0 today), ink (off today), and the shadow tint
per role (white today).

## Decided without asking (D10)

Each is undoable without moving a recorded decision or a shipped baseline, covered by a test or gate, and measurable.

1. **The page renderer keeps the lens under the flag** (`Renderer.present`, `cam3`) instead of a second camera rig:
   alternatives were porting the rig into the side file (I2b's work) or drawing both canvases. Gate: `npm test`,
   `checksum all` as recorded, the draw path unchanged with the flag off.
2. **The side file is a classic script that registers on the window**, not an ES module: module scripts do not load
   from `file://`, which the tools use. Gate: the build's `assertNoThree`, the captures.
3. **Normals by corner-angle weighting**, not area weighting: area weighting tilted a ridge's normal by how its quads
   were split (0.059 off vertical). Gate: `tests/world3d.test.ts`.
4. **Sky visibility from a 0.5 m top field** (8 azimuths to 15 m, a quarter under anything overhead) rather than ray
   casts against the triangles: 20–60 ms at load in the browser against seconds. Gate: `tests/world3d.test.ts`.
5. **Lamp confinement by the top-field line test** on the adapter maps (they have no spaces or portals), skipping
   1.5 m around the emitter (its own prop). Gate: `tests/world3d.test.ts`.
6. **`DoubleSide` world materials** (F104) and a shadow normal bias of 0.08 m (S2's 0.03 left acne; back-face casting
   lost real shadows): the captures, F110.
7. **The budget rule**: 4.0 ms GPU p95 on the reference's WebGL 2 backend at 1080p, S2's shares scaled to it, and the
   three new rows from the measured slopes ("Budgets"). Gate: `tools/s2matrix.mjs`; `tests/styles.test.ts` pins the
   shares and bloom's default.
8. **The PassNode frame advance** (F103): one `nodeFrame.update()` per drawn frame, so capture mode draws what it steps.
   Gate: the captures, `tools/three-signal.mjs`.
9. **Transcriptions I chose the source for**: role colours from ART_DIRECTION first, then BIOME_ART, then the default
   palettes; prop roles from the tile-art ramps' second shade; today's dithered sky bands and vignette kept. Gate:
   `tests/styles.test.ts`. (Every new look value is in "Look values", not here.)
10. **`scripts/dev.mjs` gained `navWasm`** (F109) beside the side file, since the dev server could not bundle without it.
11. **Ink and edge light take the fog, from the scene camera** (F112): the ink colour is fogged with the scene's curve
    and colour; the pass reads the scene camera's projection and near/far explicitly. Gate: `tools/three-signal.mjs`,
    the look sheet's frames.
