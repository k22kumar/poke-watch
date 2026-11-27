# S2: how three.js enters the game

The spike that picks the renderer class, and with it the shading language every custom shader of the 3D overhaul is
written in (docs/OVERHAUL_3D.md, task S2). Done 2026-11-23. The code is on branch `spike/s2-three` (never merged;
commits `b44ca6b`, `de005f8`, `c033c4d`); the raw measurements, generated shaders and comparison shots are in that
branch's `spike-data/s2/` (the branch is on origin). The spike took no decisions; the owner's answers to the six it
listed (2026-11-23) are at the end, under "Decisions for the owner". I2a (2026-11-27) ported the billboard, the backend
selection, `tools/s2perf.mjs` and `tools/s2matrix.mjs` to the game page; their record, and the budgets this spike
proposed as recalibrated, are in docs/RENDER3D.md.

## What was built

On `spike/s2-three`, `?render=three` runs `src/spike/s2/entry.ts` instead of the game's renderer (the old renderer is
not built on that path and its code is untouched; `src/main.ts` gained one branch):

- three **0.187.0**, pinned exactly (`"three": "0.187.0"`, `"@types/three": "0.187.0"`).
- The sim runs unchanged (`createRun` + `step` at 1/60 s) on the training range or River Gorge seed 1, with the
  range's or the habitat's target set. 240 chase walkers (the 10 species of `scripts/lib/crowd.ts`) are spawned on a
  ring around the player; the player gets `iframes` each tick so the scene stays up.
- The world: `fromArenaMap(ctx.world.map).surfaces` (the WM tile adapter) as one `Mesh` per surface chunk,
  `MeshLambertMaterial` with per-vertex colour (liquid chunks transparent), a `HemisphereLight`, one
  `DirectionalLight` with a 2048² shadow map following the player (±40 m box), `Fog` from the biome's sky
  (`render/sky.ts`).
- The camera: the game's `ChaseRig` fed by `chaseFrameFor` exactly as `Renderer.render` feeds it, copied into a three
  `PerspectiveCamera` (`rotation.order = 'YXZ'`, `y = yaw − π`, `x = −viewPitch`, the rig's FOV, near 0.3, far 240).
- Creatures: the PMD atlases as instanced billboards (below), in each renderer configuration.
- `?backend=webgl | webgpu | webgpu-gl` picks the configuration; `?perf=1` shows the overlay (frame p50 / p95 / p99,
  CPU render, sim, GPU time, draw calls, triangles, boot time). Other switches: `map`, `actors`, `shadow`,
  `shadowSize`, `cshadow` (creatures cast shadows), `props=instanced | batched`, `propN`, `edges=1`, `res=WxH`,
  `orbit` (deg/s of automatic yaw), `freeze=1` (no sim ticks after a 0.5 s warm-up, so every configuration draws the
  same frames), `obuf=8` / `olinear=1` (WebGPURenderer output path, below).
- `S2_THREE=all | webgl | webgpu | off` in `scripts/build.mjs` builds each configuration's bundle alone.
- Tools: `tools/s2perf.mjs` (one headed Chromium run, prints `s2.report()`), `tools/s2matrix.mjs` (the measurement
  matrix), `tools/s2gameboot.mjs` (the current game's boot), `tools/s2shader.mjs` (dumps a TSL material's generated
  shader).

## How it was measured

- Machine: Apple M3 Max (40-core GPU), macOS, the built-in 120/144 Hz ProMotion display. Chrome for Testing 158
  (Playwright 1.65.0), **headed**, real GPU (no SwiftShader), `deviceScaleFactor` 1, canvas at exactly 1280 × 720 or
  1920 × 1080, `setPixelRatio(1)`.
- Page served from `file://` (local disk), so boot excludes the network.
- Each timing run: 3 s warm-up, then 8 s of frames, freeze on, camera orbiting at 20°/s around the player on the
  range (the 240 actors on their ring, in and out of view). "Live" runs leave the sim on: the crowd walks onto the
  player and fills the lower screen, the heaviest sprite overdraw seen.
- **Frame time** is the `requestAnimationFrame` interval. Vsync is on, so on this display it only shows hitches; it
  never separates the configurations. Uncapped runs (`--disable-gpu-vsync --disable-frame-rate-limit`) were tried and
  rejected: rAF then runs far ahead of presentation (0.2 ms intervals) and measures nothing.
- **GPU time** is the GPU's own timer: `EXT_disjoint_timer_query_webgl2` around `renderer.render` (WebGLRenderer), and
  three's timestamp queries (`trackTimestamp`, `resolveTimestampsAsync('render')`) for WebGPURenderer on both of its
  backends. All three were available. This is the number to read.
- **CPU render** is the wall time of the `render` call (scene traversal, uniform upload, command encoding).
- Draw calls and triangles are three's `info.render` for the whole frame (shadow pass and post passes included).
- An M3 Max shrugs all of this off: every configuration stays under 3.5 ms of GPU time even in the stress scene. The
  numbers rank the configurations and price each feature; they do not show what a weak GPU does. Step 4 was meant to,
  and was not measured (below).

## The numbers

### Bundle (step 3)

`dist/index.html` built with each `S2_THREE` variant (minified, three's own share from esbuild's metafile):

| Build | Page bytes | Added | gzip -9 | Added gzip | three.js in it | Spike code |
|---|---|---|---|---|---|---|
| off (today's game) | 1,406,550 | — | 395,458 | — | 0 | 88 |
| WebGLRenderer only (`'three'`) | 1,995,643 | **+589,093** | 545,929 | **+150,471** | 563,395 | 15,812 |
| WebGPURenderer only (`'three/webgpu'`, `'three/tsl'`) | 2,285,801 | **+879,251** | 637,378 | **+241,920** | 856,030 | 13,795 |
| both | 2,654,299 | +1,247,749 | 726,126 | +330,668 | 1,218,669 | 19,188 |

All fit the 3 MB page budget, but the 0.71 MB the WebGPU-only page leaves counts three alone. Rapier's glue already
adds 227,225 B to the page (docs/spikes/S1-physics.md §1), which leaves about 487 KB (3,000,000 − 2,285,801 − 227,225
= 486,974 B) for recast's JS (unmeasured) and every overhaul system, while the old renderer and the tile stage stay in
the page until X1b. The 3 MB budget exists for the page's DOM text size, not its download size: extensions that read
the page's HTML pay per megabyte of it (ROADMAP item 3, the A1 plan). The "both" build is what the owner's spike page
uses; no shipping build should carry both. Owner, 2026-11-23 (decision 5): three and the new renderer ship as a
fetched, content-hashed side file instead, so none of this lands in `dist/index.html`.

**Import paths for the smallest bundle** (measured with probes on three 0.187.0):
- WebGPURenderer: import every class from `'three/webgpu'` and every TSL function from `'three/tsl'`; never import
  `'three'`. Importing core classes from `'three'` next to `WebGPURenderer` from `'three/webgpu'` keeps
  `three.module.js` (WebGLRenderer and its GLSL chunks) in the bundle: 982 KB instead of 818 KB for a minimal scene.
  Addons (`three/addons/...`) import `'three'`, so the build must resolve `'three'` to
  `node_modules/three/build/three.webgpu.js` (an esbuild `onResolve` plugin: `scripts/build.mjs` on the spike branch).
  Both builds share `three.core.js`, so class identity is safe.
- WebGLRenderer: import from `'three'` only (534 KB for a minimal scene).

### Frame cost, 240 actors on the range (steps 1–3)

Median of two runs per cell, freeze on, shadows 2048², vsync on.

| | WebGLRenderer | WebGPURenderer on WebGPU | WebGPURenderer, `forceWebGL` |
|---|---|---|---|
| frame p95, 1280 × 720 | 7.4–8.2 ms (vsync) | 7.3–8.2 ms (vsync) | 7.7–8.2 ms (vsync) |
| frame p95, 1920 × 1080 | 7.3–8.7 ms (vsync) | 7.3–8.7 ms (vsync) | 7.5–8.6 ms (vsync) |
| GPU p50 / p95, 1280 × 720 | 0.50 / 0.80 ms | 0.50 / 0.54 ms | 0.81 / 1.03 ms |
| GPU p50 / p95, 1920 × 1080 | 0.64 / 0.94 ms | 0.72 / 0.82 ms | 1.15 / 1.37 ms |
| CPU render p50 / p95 | 0.2 / 0.9 ms | 0.3–0.4 / 0.4–1.8 ms | 0.4–0.5 / 1.8–2.1 ms |
| draw calls | 21 | 22 (+1: the output blit) | 22 |
| triangles | 51,650 | 51,651 | 51,651 |
| River Gorge seed 1, 1080p: GPU p50 / p95, calls | 0.72 / 1.00 ms, 19 | 0.75 / 0.89 ms, 20 | 1.20 / 1.48 ms, 20 |
| Live crowd on the player, 1080p: GPU p50 / p95 | 1.13 / 1.59 ms | 1.91 / 2.78 ms | 2.12 / 2.83 ms |
| Sim p95 (live) | 0.8 ms | 0.8 ms | 0.9 ms |

The range surfaces are 29,534 triangles in 5 chunks, River Gorge 45,506 in 8; the shadow pass draws the terrain again.
One draw call per creature atlas (10 crowd species + the player + its x-ray), as in the game today.

### The WebGPURenderer output path (found during the spike)

With the default `outputColorSpace` (sRGB), `WebGPURenderer` does not draw to the canvas: it renders the scene into an
internal RGBA16F target (`outputBufferType`, default `HalfFloatType`) and then draws a full-screen pass that applies
the output colour transform (`Renderer.needsFrameBufferTarget`: on whenever tone mapping or a colour-space change is
needed). That pass is the extra draw call, and it is the whole GPU gap to WebGLRenderer:

| 1080p, GPU p50 / p95 | WebGLRenderer | WebGPU, default (RGBA16F + blit) | WebGPU, `outputBufferType: UnsignedByteType` | WebGPU, linear output (no blit) | `forceWebGL`, default | `forceWebGL`, linear |
|---|---|---|---|---|---|---|
| live crowd | 1.13 / 1.59 | 1.93 / 2.85 | 1.89 / 2.83 | **1.04 / 1.55** | 1.89 / 2.81 | **1.12 / 1.72** |
| stress (below) | 1.84 / 2.06 | 2.67 / 3.36 | 2.54 / 3.39 | **1.89 / 2.38** | 2.85 / 3.42 | **1.86 / 2.23** |

An RGBA8 intermediate does not help; skipping the pass does. With linear output both WebGPURenderer backends draw the
same frames at the same GPU cost as WebGLRenderer (colours are then wrong unless the materials or a final post pass
apply the sRGB transform: measurement only). A `RenderPipeline` (the ink pass, below) owns that final pass anyway and
applies `renderOutput` in it, so a game with a post pass pays for one full-screen pass, not two.

The generated creature shader was checked for waste first (`spike-data/s2/creature-tsl-generated.*`): it is lean. On
the WebGPU backend the NEAREST, explicit-level samples compile to `textureLoad` with a clamp; `MeshBasicNodeMaterial`
computes one hemisphere-irradiance term it never uses, and every `texture()` call adds a `flipY` uniform and branch
(ten here). None of it is measurable next to the output pass.

### Shadows

1920 × 1080, range, 240 actors; GPU p50 (p95).

| | WebGLRenderer | WebGPU | `forceWebGL` |
|---|---|---|---|
| shadows off | 0.39 (0.64) ms, 17 calls, 22,416 tris | 0.39 (0.47) ms, 18 calls | 0.59 (0.86) ms, 18 calls |
| 1024² | 0.63 (0.87) ms | 0.70 (0.76) ms | 1.05 (1.37) ms |
| 2048² (default) | 0.64 (0.94) ms, 21 calls, 51,650 tris | 0.72 (0.82) ms, 22 calls | 1.15 (1.37) ms, 22 calls |
| 4096² | 1.04 (1.19) ms | 0.87 (1.36) ms | 1.51 (1.97) ms |
| 2048² + creatures cast (`cshadow=1`) | 0.65 (0.94) ms, 34 calls | 0.83 (0.92) ms, 35 calls | 1.19 (1.44) ms, 35 calls |

The shadow pass costs +4 draw calls and +29k triangles (the terrain again), about +0.24–0.33 ms on WebGL / WebGPU at
1–2K² and +0.48–0.65 ms at 4K². Creature casters add one call per atlas (+13) and almost no GPU time here.
`PCFSoftShadowMap` **no longer exists** in 0.187 (both renderers warn and use `PCFShadowMap`); soft edges come from
`PCFShadowMap` with `shadow.radius` (a 5-tap Vogel disc of hardware-compared taps), used here with radius 2.

### 500 identical props: InstancedMesh against BatchedMesh

An 80-triangle bush (an indexed icosphere), 500 copies, range, 1080p, shadows on:

| | WebGLRenderer | WebGPU | `forceWebGL` |
|---|---|---|---|
| `InstancedMesh` | +2 calls (main + shadow), +80,000 tris, GPU 0.72 ms | +2 calls, GPU 0.83 ms | +2 calls, GPU 1.23 ms |
| `BatchedMesh` | +2 calls, +50,800 tris, GPU 0.79 ms, CPU p50 0.4 ms | +2 calls, GPU 0.77 ms, CPU p50 0.6 ms | +2 calls, GPU 1.31 ms, CPU p50 0.6 ms |

**BatchedMesh is usable on all three.** It renders correctly and costs one draw per pass for one geometry everywhere:
WebGLRenderer and the WebGL 2 backend use `WEBGL_multi_draw`; the WebGPU backend merges consecutive instances of the
same geometry into one `drawIndexed` (`_mergedDraw*`), and issues one `drawIndexed` per run of a different geometry
(no state change between them; without `WEBGL_multi_draw` the WebGL backend does the same). Only one geometry was
measured. BatchedMesh frustum-culls per instance (fewer triangles on this view) and pays for it on the CPU
(+0.2 ms p50 with 500 instances).

### Edge pass over depth and normals (step 3 extra)

A full-screen pass darkening pixels where the depth Laplacian or the normal bend to the four neighbours crosses a
threshold (`webgl.ts` `EDGE_FS`, `webgpu.ts` `enableEdges`), 1080p:

| | WebGLRenderer | WebGPU | `forceWebGL` |
|---|---|---|---|
| how | lit pass into a target with a `DepthTexture`, plus a **normal pre-pass** (`scene.overrideMaterial = MeshNormalMaterial`, billboards hidden): WebGLRenderer's built-in materials write one colour output, so there is no MRT normal | one `pass()` with `mrt({ output, normal: packNormalToRGB(normalView) })`, its depth texture, a TSL node as the `RenderPipeline`'s output | as WebGPU |
| cost | +4 calls, +22k tris, GPU 0.64 → 0.99 ms | +0 calls (the pipeline's quad replaces the output blit), GPU 0.72 → 0.88 ms | GPU 1.15 → 1.14 ms |

Shots: `spike-data/s2/shots/edge-*.png`. Billboards have quad normals, so the normal half of the edge test ignores
creature silhouettes; their outlines are in the art already.

### Stress scene

1,506 actors, 5,000 props (`InstancedMesh`), creatures casting, a 4096² shadow map, 1080p: 857,180 triangles, 36–37
draw calls. GPU p50 / p95: WebGLRenderer 1.84 / 2.06 ms, WebGPU 2.65 / 3.35 ms (1.89 / 2.38 with linear output),
`forceWebGL` 2.69 / 3.33 ms (1.86 / 2.23). CPU render p50 0.3–0.5 ms on all three: draw calls stay flat as actors
and props grow, because both scale by instancing.

### Boot to first frame

Navigation start to the first presented frame, the configuration's own build (`S2_THREE=webgl` or `webgpu`), range,
1280 × 720, median of five:

| | WebGLRenderer | WebGPU | `forceWebGL` |
|---|---|---|---|
| first frame | **236 ms** (234–238) | **286 ms** (283–289) | **318 ms** (310–325) |
| of which: renderer created and initialised | 6–13 ms | 6–13 ms (`await renderer.init()`) | 6–13 ms |
| of which: first `render` (pipeline and shader compile) | 24 ms | 57 ms | 80 ms |

Before that: the script starts at about 58 ms, the art manifest and the match's atlases are in at 150–172 ms, and
spawning, the freeze warm-up ticks, the renderer, the WM adapter and the scene take the next 55–61 ms. The
first `render` is the price of the shading language path: TSL builds node graphs and generates WGSL or GLSL before the
driver compiles it. Over every run of the spike (36 per WebGPURenderer backend, 30 for WebGLRenderer, all scene
variants), the first `render` took 20–34 ms on WebGLRenderer, 52–83 ms on WebGPU, and 75–340 ms on the WebGL 2
backend, over 120 ms in 9 of its 36 runs. For reference, today's game is ready on the range at 886–902 ms and draws
its first frame at 893–911 ms (`spike-data/s2/game-boot.json`; that includes the UI, audio and painting the tile
stage, so only the differences between the three configurations above carry over).

### Step 4: a lower-end machine

**Not measured.** The owner chose to record it as not measured (2026-11-23); it runs before I2a starts (F39). How:

- Build `spike/s2-three` with `S2_THREE=all node scripts/build.mjs --out <dir>` (the branch is on origin) and copy the
  whole folder (`index.html`, `art/`, `music/`) to the lower-end machine.
- Serve it **on that machine's own localhost** with any static server (for example `python3 -m http.server 8000` in
  the folder), or over HTTPS. WebGPU needs a secure context: `navigator.gpu` exists only on HTTPS or localhost, so the
  page opened from the Mac's dev server over the LAN has no WebGPU, and `backend=webgpu` would silently measure the
  wrong thing.
- Open `http://localhost:8000/?render=three&perf=1&freeze=1&orbit=20&backend=webgl`, then `backend=webgpu` and
  `backend=webgpu-gl`. After about 10 s read the overlay's `frame` (p50 / p95 / p99), `cpu render` (p95), `gpu` and
  `draw calls` lines, and note the machine, browser and GPU, and the overlay's first line (which backend actually ran).

## The billboard port (step 2)

Both materials draw the same instance layout as the game's `InstanceBatch` (20 floats: position and scale, frame size
and anchor, frame UVs, flash / dissolve / dx / bias, tint and dy) from one `InstancedBufferGeometry` + `Mesh` per
atlas (`frustumCulled = false`, `instanceCount` set each frame; three reads the five instanced attributes by name in
both renderers). The x-ray is the player's sprite drawn again with the material's `depthFunc = GreaterDepth`,
`depthWrite = false`, `renderOrder = 10`. Atlases are `CanvasTexture`s, NEAREST, no mipmaps, `flipY = false`,
`SRGBColorSpace`. The JS side (frame pick, the 8-direction row from `dirIndex(facing − (yaw − π))`, `frameAt`, the feet
anchor, the size scale) is shared and is `Renderer.drawSprites` copied. Both look the same (`spike-data/s2/shots/`).

| | GLSL `ShaderMaterial` (WebGLRenderer) | TSL node material (WebGPURenderer) |
|---|---|---|
| Code | `src/spike/s2/webgl.ts`: two shader strings, about 45 lines | `src/spike/s2/webgpu.ts`: about 60 lines of node code |
| Effort (one author, approximate) | about 30 min: `CREATURE_VS` / `CREATURE_FS` pasted, `LEAN_GLSL` and `SPRITE_SAMPLE_GLSL` imported unchanged, `uVP` → three's `viewMatrix` / `projectionMatrix`, the game's fog → three's `fog_*` chunks, `#include <colorspace_fragment>` | about 2.5 h, mostly finding the API and fighting the typings, not the maths |
| Feet anchor, frame rect, 8 rows, stretch 1 / cos elevation capped at 1.6 | as the game | the same maths |
| R3 lean (`leanUp`) | as the game (a branch on `up.y < 1`) | without the branch: with no excess the lean formula is the upright one |
| `SPRITE_SAMPLE_GLSL` (an n×n box when a texel is smaller than a pixel) | unchanged | `If` / `Else`, the GLSL `for` with `continue` unrolled in JS with a mask per tap, derivatives taken before the branch and every sample at an explicit level (WGSL's uniformity rules). The first port `select`ed between both results, so every pixel paid all ten taps |
| `flat` frame-rect varying | `flat varying` | `varying(iUV).setInterpolation('flat')` |
| Dissolve (Bayer on the pixel grid) | `gl_FragCoord` | `screenCoordinate`, `Discard(cond)` |
| x-ray checker | `#ifdef XRAY` with an early `return` | two materials chosen in JS (no early return in TSL); outline or checker by `select` |
| Fog | three's chunks (linear `Fog`) | automatic for node materials |
| Output colour space | must be included by hand (forgetting it in the edge pass gave a dark frame) | automatic |
| Casting shadows (`cshadow=1`) | a second `ShaderMaterial` as `customDepthMaterial` (the same vertex shader, an alpha-test fragment shader) | **nothing**: the shadow pass reuses `positionNode` and the `colorNode`'s alpha and `Discard` (`Renderer._getShadowNodes`); `castShadow = true` is all |

What did not port, or ported differently:
- Nothing in the creature shader was impossible in TSL. The differences are of form: no early return, no `continue`,
  the x-ray as a compile-time variant (cheaper than the game's uniform branch anyway).
- The x-ray colours: GLSL writes them raw (before `colorspace_fragment`, as the game does); TSL sends them through the
  output transform, so they come out lighter. A design call for I2b.
- The game's fog curve (`FOG_GLSL`: a squared ramp plus a veil past `far`) was not ported; both paths use three's
  linear `Fog` out to `far × 1.5`. In TSL a custom curve is one `fogNode` on the scene; in GLSL it is a chunk override
  in every material.
- `@types/three` 0.187 rejects plain numbers and `TextureSizeNode` in several TSL overloads (`vec2`, `max`, `select`,
  `textureSize`, `texture().level`). The spike aliases those functions as `any`.
- TSL changes names inside the 0.18x line: `directionToColor` → `packNormalToRGB` (warns), `PostProcessing` →
  `RenderPipeline`, `renderAsync` deprecated (r181). `PassNode.getLinearDepthNode()` is not a texture node and cannot
  be sampled at an offset (the edge pass reads `getTextureNode('depth')` through `perspectiveDepthToViewZ`).
- TSL errors surface at the first render as a minified stack from the node builder (`Q.sample is not a function`),
  not at type-check time. `renderer.debug.getShaderAsync(scene, camera, mesh)` prints the generated code
  (`tools/s2shader.mjs`).
- The x-ray shows a few rows of the player's feet where the sprite's lowest pixels sit below the adapter's ground
  surface (`GreaterDepth` against the ground it stands on). Both paths; the game's tile stage has the same geometry.
  F41.

## Recommendation (as written for the owner; answers under "Decisions for the owner")

**Renderer class: `WebGPURenderer` from `'three/webgpu'`, on its WebGPU backend where the browser has it and its
WebGL 2 backend everywhere else. Shading language: TSL** for every custom shader (creature billboards, decals, glows,
the storybook material, the ink pass). Reasons, from the measurements:
- One language for both backends. The `forceWebGL` path drew the same frames as WebGPU with the same TSL; WebGLRenderer
  would need a second language later (or forever) to reach WebGPU.
- Same GPU cost as WebGLRenderer once the output transform is not a separate pass (above), on both backends.
- The overhaul's own features are cheaper in TSL: MRT normals for the ink pass with no extra geometry pass (WebGL
  needs a normal pre-pass: +4 calls and +22k triangles here, more on a real map), billboard shadows with no second
  material, a fog curve as one node, post as a `RenderPipeline`.
- three's new work (post nodes, compute, node lighting) lands in WebGPURenderer and TSL.

What it costs:
- +879 KB raw / +242 KB gzip on the page against +589 / +150 KB for WebGLRenderer (+290 KB / +92 KB more).
- +50 ms to the first frame on WebGPU, +82 ms on the WebGL 2 backend (TSL compiles at first render; the WebGL 2
  backend's first render went over 120 ms in 9 of 36 runs, up to 340 ms). A compile-ahead step (`renderer.compileAsync`) during loading should hide it
  (not measured).
- CPU render p95 0.4–2.1 ms against 0.9 ms for WebGLRenderer (p50 0.2–0.5 ms on all three).
- A younger, faster-moving API (renames and a removed shadow type within the 0.18x line) with typings that lag it.

The alternative: **`WebGLRenderer` and GLSL.** The creature shader ports in half an hour, the bundle is 290 KB smaller,
the first frame 50–80 ms sooner, the API settled. It never runs on WebGPU, its post passes are hand-written (or
`three/addons` `EffectComposer`), and features the overhaul wants (ink normals, billboard shadows) cost an extra pass
or material each.

### Shadows
One `DirectionalLight` sun with a `PCFShadowMap` (soft via `shadow.radius`), a 2048² map in a box that follows the
player (±40 m here). It costs 0.25–0.33 ms on this GPU, the largest single item in the frame. Cascades
(`CSMShadowNode` for WebGPURenderer, `three/addons/csm` for WebGLRenderer) when a 3D map shows long sight lines; not
measured. Creatures can cast card shadows for free in TSL, but a card faces the main camera, so its shadow turns
with the camera's yaw (visible in `shots/cshadow-*.png`): a blob decal (as today) is the other choice (F44).

### Billboards
As built: one instanced mesh per atlas with the game's 20-float instance layout, a `MeshBasicNodeMaterial` whose
`positionNode` builds the card in world space (stretch, lean, feet anchor) and whose `colorNode` samples with the
box filter, tints, dissolves and discards; the x-ray as a second material with `GreaterDepth`. Draw calls stay one
per atlas.

### Decals, glows and particles
None was built; these follow from what was measured.
- **Decals** (blob shadows, rings, zones, telegraphs). On a mesh world with slopes and steps, flat quads clip into
  the ground. Draw them as instanced boxes that read the scene depth and project onto whatever is there (a deferred
  decal: reconstruct the world position from depth, discard outside the box, sample the decal). In TSL the depth is
  `viewportDepthTexture()` (or the `RenderPipeline` pass's depth texture); one instanced draw per decal kind. The
  always-on-top telegraphs stay a depth-test-off draw.
- **Glows** (halos under projectiles, beams, ribbons): additive instanced quads and ribbon strips, as the game draws
  them today, as node materials with `blending = AdditiveBlending` and `depthWrite = false`. A bloom node in the
  `RenderPipeline` is an option for later, not a need.
- **Particles**: simulated on the CPU (they are presentation; the render layer may use `Math.random`) into one
  instanced buffer per atlas, drawn like the creature billboards. Compute-shader particles are possible on WebGPU but
  the WebGL 2 backend has no compute shaders (three emulates compute there with transform feedback), so one CPU path
  keeps both backends the same.

### BatchedMesh
Usable on all three configurations (above). For many copies of one prop `InstancedMesh` is simpler and has no
per-frame CPU culling cost; `BatchedMesh` earns its place for many different prop geometries sharing one material
(one call per pass on WebGL; one call per geometry run on WebGPU, with no state changes).

### Frame budget per category (proposal)
For 60 Hz on the target lower-end machine (not yet named or measured: F39), with 25 % headroom: 12.5 ms of GPU time.
The split follows the shares measured here (1080p, WebGLRenderer and linear-output WebGPU agree):

| Category | Budget | Measured on the M3 Max (1080p) |
|---|---|---|
| Terrain (surfaces, props) | 4.0 ms | ≈ 0.3 ms with 240 actors (the shadows-off frame is 0.39 ms all in); 500 props +0.08–0.12 ms |
| Actors (creature billboards) | 3.0 ms | +0.5 ms when the crowd fills the lens (live 1.04–1.13 ms against 0.64 frozen) |
| Effects (decals, glows, particles) | 2.0 ms | not built |
| Shadows | 2.0 ms | 0.25–0.33 ms at 2048², 0.48–0.65 ms at 4096² |
| Post (ink pass, output transform) | 1.5 ms | edges +0.16–0.35 ms; the output blit alone up to +0.9 ms in overdraw |
| CPU: render submit | 2 ms p95 | 0.4–2.1 ms p95 |
| CPU: sim | 4 ms p95 (on the lower-end machine) | 0.8 ms p95 (240 live actors) |

If the lower-end machine is about 20× slower than this GPU (an integrated laptop GPU), today's frame (≈ 1 ms here)
would land near 20 ms: over budget before effects. That is a guess until F39 is measured. The CPU sim row is the
lower-end machine's figure; on this Mac perf-sim's gate stays p95 2 ms with physics inside the sim (S1).

## Open risks

1. **No lower-end measurement** (F39). Every number above is from a GPU that idles through it.
2. **WebGPURenderer's output pass** costs up to 0.9 ms here when sprites overdraw. I2a must choose: a `RenderPipeline`
   that ends in `renderOutput` (the ink pass will need one anyway), or linear output with the transform in the
   materials (F40).
3. **TSL churn and typings.** Renames inside minor versions, a removed shadow type, typings that reject valid calls.
   Pinning three exactly (as here) and upgrading deliberately, with a re-run of `tools/s2matrix.mjs`, contains it (F42).
4. **First-frame compile** on the WebGL 2 backend: usually 80 ms, up to 340 ms; every new material adds to it.
   Not yet hidden behind loading.
5. **CPU render p95** of WebGPURenderer is higher (up to 2.1 ms) with this small scene; not profiled.
6. **Debuggability.** TSL errors appear at render time from generated code; shader authors read generated WGSL / GLSL.
7. **Colour and art.** The spike's frames look paler than the game's art direction (Lambert, linear vertex colours,
   untuned light intensities, three's linear fog). Nothing here judged the look; I2a owns it (F43).
   The adapter's surfaces are crude on purpose; at stairs they draw lips through the ramp (S1's F35).
8. **The x-ray against its own ground** (F41).
9. **Billboard shadows turn with the camera** if cards cast them (F44).
10. **WebGPU support.** Chrome on this Mac exposed WebGPU and timestamp queries; Firefox, Linux and older machines
    take the WebGL 2 backend: about 1.6× the GPU time of WebGPU in the frozen scenes with the default output path, and
    level with it (and with WebGLRenderer) with linear output in the two scenes measured that way. Safari was not tried.

## Decisions for the owner

Answered by the owner on 2026-11-23 (the review of S2).

1. **Renderer class and shading language:** WebGPURenderer + TSL (recommended above), or WebGLRenderer + GLSL.
   **Owner, 2026-11-23:** WebGPURenderer + TSL, conditional on F39, which runs before I2a starts. If the `forceWebGL`
   backend misses the budget on the lower-end machine where WebGLRenderer meets it, the choice reopens.
   **Owner, 2026-11-25 (ROADMAP D14):** F39 is waived. WebGPURenderer + TSL, with the WebGL 2 fallback by its
   backend, stands without the lower-end-machine condition; measure one if it turns up.
2. **Output path:** a `RenderPipeline` from the start (owning the output transform and the ink pass), or linear
   output with sRGB in every material. **Owner, 2026-11-23:** a `RenderPipeline` from the start, ending in
   `renderOutput` (F40). No sRGB in every material.
3. **The lower-end target machine** that the frame budget is measured on, and the budget itself. **Owner,
   2026-11-23:** the owner names the machine when F39 is run; until then the budget table stands as a proposal.
4. **Creature shadows:** card shadows from the billboards (free in TSL, turn with the camera) or blob decals.
   **Owner, 2026-11-23:** blob decals, as today; the decals are drawn as "Decals, glows and particles" describes, and
   that work is deferred (F44).
5. **The 3 MB page budget** with three inside. **Owner, 2026-11-23:** keep 3 MB on `dist/index.html`. three and the
   new renderer ship as a fetched, content-hashed side file (like `dist/physics/`), loaded only with `?render=three`
   until X1a. Every task that adds a runtime library reports `index.html` bytes and side-file bytes.
6. **Upgrade policy for three.** **Owner, 2026-11-23:** pinned exactly, upgraded as its own task with the S2 matrix
   re-run; I2a brings `tools/s2perf.mjs` and `tools/s2matrix.mjs` into `tools/`.
