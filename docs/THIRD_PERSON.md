# Third-person camera (Phase P0)

The default view is a camera behind the Pokémon that the player turns with the mouse or the right stick. It is a render-only
change: nothing under `src/sim` or `src/world` knows about it, and `scripts/checksum.ts` prints the same hashes as before.
The design behind the numbers is the "Third-Person Execution Blueprint".

## What is in
| Piece | Where |
|---|---|
| Rig: states, size framing, collision, climb, slope tilt, aim ray (pure maths, unit-tested); every tuning value in `CHASE_CONFIG` | `src/render/camera.ts`, `tests/chase.test.ts`, `tests/camstability.test.ts` |
| Host frame order: look → one `ViewSample` → the frame's sim ticks → render | `src/render/hostframe.ts`, `tests/viewsample.test.ts` |
| What the rig is told about the world each frame (terrain, decks, map edge, props, threat), shared by the renderer and the diagnostics | `src/render/chaseinput.ts` |
| Camera branch, sky, fog, per-object billboard stretch, sprite direction relative to the camera | `src/render/renderer.ts`, `src/render/tilestage.ts`, `src/render/sky.ts` |
| Draw culling (lens-centred in third person) | `src/render/view.ts` |
| Minification-aware sprite sampling | `src/render/spritesample.ts` |
| Mouse capture (pointer lock), right-stick look, hint, pause when the browser releases the mouse | `src/input/input.ts`, `src/main.ts` |
| Settings: Camera (Third person / Classic / Overhead / Wide), Look speed, Invert look, Field of view | `src/ui/ui.ts` |
| Diagnostics: headless camera stats, browser scene captures | `scripts/camstats.ts`, `tools/chasecheck.json` |

Classic, Overhead and Wide are unchanged and still pixel-locked (`?cam=wide`, or Settings → Camera). Settings are loaded by
`loadSettings` (`src/ui/settings.ts`, tested in `tests/settings.test.ts`): a new player gets Third person; a copy saved before
this phase (no `camV`, or the old `bonklab.settings` key) moves to Third person once, keeping its other choices; a camera the
player picked after that is kept (Settings → Camera → Third person, or Reset to defaults, brings the default back); an unknown
camera id falls back to Third person.

## Camera
Low and behind the Pokémon, on its right shoulder, looking into the world (Garden Warfare's framing: the lens about a head
above the hero and a body-and-a-half behind, the horizon just above the screen centre, the hero in the lower left third).

- **Update order (one authoritative path).** Each animation frame, `main.ts` runs `runFrame` (`src/render/hostframe.ts`):
  look input goes to the rig (`Renderer.look` → `ChaseRig.look`, yaw and pitch at once), one immutable `ViewSample` is taken
  (`Renderer.viewSample`), and every 60 Hz sim tick due that frame (zero, one or several) moves and aims with that sample.
  Then `Renderer.render` interpolates the player between the last two ticks and calls `ChaseRig.update` once with
  `chaseFrameFor(...)`. Nothing else writes the camera. See "View-state contract" below.
- **Fixed clock.** Inside `update` the rig steps on its own 120 Hz clock (`CHASE_CONFIG.tick`) whatever the frame rate, with
  the Pokémon's position and the yaw interpolated to each tick's time; the frame shows the rig between its last two ticks (at
  most 8 ms behind) and then turned to the yaw and pitch the player has now, so look input has no added latency. Every hold
  timer and threshold (shoulder swap, climb, state, collision) is decided at the same instants at 30, 60 or 144 fps.
- **States** (critically damped blend: 0.25 s towards a busier state, 0.6 s back; entry and exit thresholds apart):

  | State | Boom elevation | Boom | FOV | View tilt below horizon | Enter | Leave |
  |---|---|---|---|---|---|---|
  | Explore | 9° | 4.2 m | 64° | 6° | — | — |
  | Combat | 13° | 5 m | 68° | 7.5° | a hostile within 20 m | none within 26 m for 3 s |
  | Pressure | 17° | 6.2 m | 72° | 10° | a boss within 25 m, or crowd weight ≥ 20 within 12 m (fodder 1, elite 3, alpha 4, boss 8) | boss beyond 32 m and weight < 12 for 2 s |
- **Player input:** mouse / right stick turn yaw (free) and pitch (−14°..+20° around the state's elevation). FOV offset −10..+12 (setting).
- **Size:** boom × clamp((framing size / 1.2 m)^0.55, 0.7, 1.8), framing size = max(sprite height, 0.6 × sprite width), so a
  wide, low Pokémon is framed like a tall one. The pivot sits at 0.8 × height (fliers 0.9). Tagging another squad member
  eases size, pivot and boom over 0.45 s.
- **Air:** the camera follows 65 % of a jump (fliers 85 %), so the Pokémon rises in frame instead of the world bobbing.
- **Collision.** Terrain rises, deck undersides and the map edge (treated as a wall: a cave's border is raised rock) shorten
  the boom over 0.1 s (at most 25 m/s) and let it back out over 0.45 s after 0.25 s of clear air. Props (trees, rocks,
  buildings) block only where they are dense: at least 3 of the 9 points of a 1 m grid around the lens (a thicket, a forest
  wall, a building), on a gentler channel (in 0.3 s, out 0.8 s after 0.5 s) and never below 45 % of the boom. A lone tree or
  rock never moves the boom: the lens passes through it while it dissolves (props within 4 m of the lens dither away; props
  between the lens and the Pokémon are screen-doored). `CHASE_CONFIG.propsBlockLens = false` lets the lens pass through all
  props. The boom is also tested from where the Pokémon will be (motion towards or across the lens only) and where the camera
  will point (turn rate × 0.35 s), so walking backwards or turning into a cliff pulls the lens in ahead of it.
- **Safety net (slide).** Where the end of the boom would still be within 0.2 m of the ground, inside a rise or against a
  deck's underside (a Pokémon backed against a terrace closer than the shortest boom; the eased boom still catching up), the
  lens slides in along the boom to the nearest clear point back from its end, and the boom is held there and eases back out.
  It is never lifted vertically out of what is behind (that put it on the terrace top). If the eased pivot is itself buried
  (lagging a Pokémon that just hopped onto a rock), the slide starts from the Pokémon's own chest; if even that reads as
  buried (an interpolated position cutting a wall's corner), the lens holds where it was last tick. Over open ground an eased
  floor keeps the lens 0.4 m up (at most 0.25 m of lift, continuously).
- **Climb:** only when shortening would leave less than 35 % of the boom, and only by the smallest climb (3° steps, up to 12°)
  that clears it; a wall too tall to see over is never climbed. A higher climb is taken over 0.2 s, a lower one only after it
  has held for 1 s, over 0.8 s.
- **Shoulder swap:** to the left when the right side has left less than 80 % of the boom open, and the left 25 % more, for 0.2 s;
  at most once a second; glides over 0.25 s.
- **Slope tilt:** follows the walkable ground ahead for up to 10 m (a rise of more than 0.6 m between metres is a wall and ends
  it); tilts the view by −0.5 × that slope (−9°..+8°), smoothed over 0.5 s. A wall ahead never tips the view.
- **Close lens:** at under ~0.95 m from the pivot (a wall or deck right behind the Pokémon) the Pokémon dissolves (ordered dither)
  rather than filling the screen: 75 % by 0.45 m, 95 % at the 0.3 m near plane. The x-ray silhouette is not drawn while it
  dissolves (with the sprite at the near plane it filled the screen with cyan stipple).
- **Shake:** smooth noise, 0.12 m at full trauma (the fixed views keep their 0.35–0.45 m shake, sized for a 20–30 m camera).
- **Aim = camera.** The aim point is the crosshair ray (screen centre) against the terrain, 4–26 m from the Pokémon, nudged by
  the lens' shoulder offset so shots converge on the crosshair. Move direction is camera-relative. The sim still receives an
  ordinary `aimX/aimZ`, so magnetism, Guard, Dash, Tag and every move work unchanged.
  **Phase 2B (2026-11-16):** the host also sends the crosshair ray itself (`InputFrame.aim`, `aimRayOf(view)`). Under
  `rules.aim.spatial` the sim traces it for the direct shots (bolt, orb): they leave the body's muzzle toward what the
  crosshair is on, in 3D, with no magnetism or lead, and the crosshair turns red when cover stands between muzzle and target
  (`docs/THIRD_PERSON_IMPLEMENTATION.md` §13). **Phase 2C:** beams take the same path: they leave the muzzle toward the
  crosshair point, stop on the first wall, rise, slab or cliff their core meets, touch only bodies the core can see within
  their width, and are drawn exactly from the muzzle to that end (§14). Foliage (bushes, hedges) is not cover for these
  attacks; trees, rocks and walls are. Every other move still reads `aimX/aimZ`.
- **Facing:** the sim turns the Pokémon toward its movement direction (and to the aim while a move is winding up), as before.

## View-state contract (Phase 1, 2026-11-16)
Owner: the render-side rig (`ChaseRig`, `src/render/camera.ts`). The sim never reads it; it receives only the `aimX/aimZ`, the
crosshair ray `aim` (the sample's `eye` and `dir` through `Math.fround`, Phase 2B) and camera-relative `mx/mz` the host writes
into each `InputFrame`, so replays depend on recorded input alone.

- **`ChaseRig.look(dyaw, dpitch)`** applies yaw and pitch at once and recomposes the public view (`eye`, `viewPitch`,
  `target`) exactly as `update()` composes a frame: the lens turned about the pivot by the yaw change and swung up or down by
  the boom elevation the pitch change gives, the axis tilted by the pitch change. It does not touch the rig's clock or its tick
  state. The rig's public fields are therefore a coherent view at every instant.
- **`ChaseRig.sample(width, height)` → `ViewSample`** is a frozen copy: `eye`, unit `dir`, `yaw`, `viewPitch`, `userPitch`,
  `fov`, viewport `width/height/aspect` and `reticleY`. `chaseAim` takes a sample (or the rig, which has the same fields).
- **Per frame:** look → one sample → the due ticks, all with that sample → render (`update`, the rig's only clock advance).
  With no look input the sample is bit-identical to the view drawn the frame before; with look input it is that view plus
  the input, which is what `update()` with no elapsed time would draw. The view drawn at the end of the frame is the sample
  advanced by one frame of the rig's own motion (pivot follow, boom easing): same yaw, same look-driven pitch.
- **Frame composition also swings the lens for pitch.** `update()` already turned the composed lens to the newest yaw; it now
  also swings it by the boom elevation the pitch input since the last tick gives (`swingLens`, zero once a tick has run with
  that pitch, and zero under a deck where the slab sets the elevation). Without pitch input nothing changes:
  `scripts/camstats.ts` is bit-identical before and after.
- **Fixed sim vs render interpolation stay separate:** the sim steps on its accumulator; the rig steps on its own 120 Hz
  clock inside `update` only; neither drives the other.
- Pinned by `tests/viewsample.test.ts` (the real `runFrame` with a real rig and run) and the rewritten
  "rapid direction changes" test in `tests/camstability.test.ts` (it used to update the rig before aiming, the opposite of
  the host). Findings and numbers: `docs/THIRD_PERSON_IMPLEMENTATION.md` §11.

## Renderer changes that were needed
- No texel snapping, no integer-pixel focus distance; internal resolution is ~400 lines (preset `lines`), integer upscaled.
- Billboards (creatures, props) stretch by 1 / cos(elevation they are seen at) per object, so far props are not stretched.
- Sprite direction is chosen from the facing relative to the camera yaw (`dirIndex(facing − (yaw − π))`; identical at yaw π).
- Sky gradient, distance fog (per biome in `sky.ts`), mip-mapped + anisotropic terrain textures, ambient particles at 55 % size.
- Culling is a disc around the lens plus a plane 6 m behind it (`render/view.ts`): it depends only on where the lens is, never
  on where it looks. Its radius is `chaseViewR(fogFar)` = 1.5 × the biome's fog far distance + 4 m (at most 230 m): past the
  far distance the fog closes completely over another half of it (`FOG_GLSL`), so everything beyond the radius is exactly the
  fog colour (as is the sky at the horizon) and skipping it can never make anything on screen appear or vanish. On today's
  128 m regions the radius (109–199 m) still reaches almost the whole map from the spawn; on larger maps it bounds the work.
- Sprites (props and creatures) are sampled with an n×n box of nearest taps, clamped to the sprite's own frame, wherever a
  texel is smaller than a screen pixel; at one texel per pixel or larger it is a single nearest tap (fixed views unchanged).
- The prop dither no longer assumes the camera is south of the player.

## Stability and flicker: what was found (November 2026)
Measured with `scripts/camstats.ts` (headless, real maps) and headless-Chromium probes before changing anything.

| Finding | Evidence | Fix |
|---|---|---|
| Boom collision followed a tile-quantised target with an exponential chase: the boom moved in stairs (14 m/s, 0, 14 m/s on consecutive frames) | per-frame trace while walking | critically damped `smoothDamp` with a speed cap; bisection refined to 1/640 of the boom |
| The climb target was searched from the current, moving climb: it reversed direction frame to frame (+124°/s, −4°/s) and props made it climb up to 20° along forest paths | per-frame trace; walk max boom elevation 21–23°, fights 25–31° | target worked out from no climb each frame, climb only when it clears, hold 1 s before descending, max 12°; props never climb |
| Slope tilt sampled one point 9 m ahead: a cliff or wall swept by the yaw tipped the view up to ±9° while turning on the spot | pitch range while turning up to 5.1°; walk pitch travel up to 67° in 20 s | follow walkable ground only |
| No hysteresis between Combat and Pressure: a crowd at the threshold pumped boom (5↔6.2 m) and FOV (68↔72°) | up to 7 state changes in 30 s of combat | enter/exit thresholds and holds |
| The lagging pivot cut corners through rock: under a deck the lens alternated between 0.85 m and the rock top at 3.45 m on consecutive frames (boom elevation shown as 90°) | per-frame trace in Viridian Forest | pivot kept out of rises; continuous (bisected) fall-backs |
| Turning beside a cliff cut the boom from 5.2 m to 1.5 m in one frame (a rise across the line of sight was treated like the lens being inside it) | per-frame trace | only the lens being inside rock is instant; anticipation of turns |
| Shake was a new random 0.45 m offset per frame, ~8× the fixed views' angular shake, and stronger at higher frame rates | code | smooth noise, 0.12 m |
| Prop culling (74 m around a point 20 m ahead) swung with the yaw; props were only ~30 % fogged at its edge | turning 2.4 rad on the spot: 500–870 on-screen pop-in/out events | lens-centred culling: 0 events |
| An elevated deck's edge beam had its top face exactly at deck height; a rock lip's outer face shared the deck's side plane | code (coplanar faces) | 1.5 cm separation |
| Not confirmed: z-fighting between billboards, depth precision (24-bit depth, near 0.3 m, far 240 m), frame-to-frame instability of a static scene (0 pixels change on repeated frames) | sub-pixel camera nudges change ≤ 7 pixels | — |

Before → after (60 fps, authored arenas, seeds 1–2, stages 0–3, Cyndaquil and Feraligatr; median / worst):

| | Before | After |
|---|---|---|
| Walk: 99th percentile per-frame change of lens velocity | 7.1 / 8.7 m/s | 1.4 / 1.8 m/s |
| Walk: largest per-frame change of lens velocity | 15.8 / 21.5 m/s | 4.7 / 6.0 m/s |
| Walk: view-tilt travel in 20 s | 28 / 67° | 0.9 / 17° |
| Walk: boom travel in 20 s | 10 / 17 m | 7.9 / 10.2 m |
| Walk: highest boom elevation | 21.7 / 23.1° | 9 / 20.4° |
| Turning on the spot: view-tilt range | 0.6 / 5.1° | 0 / 0° |
| Combat: state changes in 30 s | 3 / 7 | 2 / 4 |
| Combat: 99th percentile per-frame change of lens velocity | 12.8 / 14.9 m/s | 3.8 / 5.7 m/s |
| Combat: highest boom elevation | 28.1 / 31.1° | 17 / 30.9° |

On the maps the game builds by default (Viridian Forest, generated badlands and frost regions, Mt. Moon; seeds 1–3,
Cyndaquil, Charmander, Feraligatr) the medians match: walk 1.5 m/s, combat 4.8 m/s, highest walk elevation 9°, no idle drift.
The worst cases are in "Known limits".

## Stability, second pass (November 2026)
The first pass left four defects open. Each was reproduced with `scripts/camstats.ts` and a per-frame trace before changing
anything; file locations are `src/render/camera.ts` unless named.

| Defect | Cause found | Fix |
|---|---|---|
| 70° boom elevation in a badlands bot fight (seed 1, Feraligatr) | The Pokémon was backed against a 2 m terrace whose face was nearer than the shortest boom (0.4 m). The boom's end sat over the terrace, less than 0.5 m below its top, so it did not count as "inside" the rise, and the final ground clamp lifted it onto the terrace top: 1.05 m over the pivot, 0.37 m behind it, the Pokémon below the bottom of the frame | The final placement slides the lens in along the boom to the nearest clear point (never lifts it out of what is behind); the boom is held there |
| ~48 m/s single-frame lens velocity changes in caves and alcoves | (a) The same vertical lift at terrace and step edges: a lens resting on a collision boundary crossed it and was lifted 0.7 m, then dropped, on consecutive frames. (b) A convex corner entering the middle of the boom while the eased boom (≤ 14 m/s) was still behind it: the lens reached the rock and was cut 0.37 m, then backed out another 0.7 m on the next frame. (c) The eased pivot lagging a Pokémon that hopped onto a rock left no clear start for any fix-up | (a) the slide; (b) one slide to the nearest exit instead of two cuts, pull-in cap 25 m/s; (c) the slide starts from the Pokémon's chest when the pivot is buried, and holds the lens when even that is (an interpolated position cutting a wall corner) |
| 2–3 m of zoom turning beside trees | Only props: with `--noprops` the turning boom range was 0. Every trunk within 0.7 m of any point of the boom shortened it to 45 %, so a single tree swept by the boom pumped it in and out | Props block only where dense (≥ 3 of 9 grid points within ~1 m of the lens); lone props are passed through and dissolve (the shader already did this within 4 m of the lens) |
| Shoulder swap (and other decisions) differing with frame rate | The rig stepped once per frame: the swap's 0.2 s confirm, the climb's choice and hold, and the collision cuts were sampled at frame times, so near a threshold 30 / 60 / 144 fps runs decided on different frames (up to 1.8 m apart). Without swaps it was still 1.5 m: not only the swap | Fixed 120 Hz rig clock with inputs interpolated to tick times; the frame drawn between the last two ticks, yaw and pitch applied on top |
| Saved Classic / Wide kept by old saves | `main.ts` merged the saved copy over the defaults before testing `camV`, so a copy saved before the third-person camera (no `camV`) read as current and was never migrated | `loadSettings` tests the saved object; a camera chosen afterwards is kept |
| The fourth deliberately re-introduced bug escaped the first pass's tests | It was the climb choosing the best partial climb (climbing even when no climb clears the boom). The only climb test used a corridor of 3 m vertical walls, where no climb gains anything, so both rules chose 0 | New test: a 35° bank right behind the Pokémon, where climbing 12° gains boom but never the 35 % the climb is for |
| Fully dissolved Pokémon drawn as a full-screen cyan stipple (found by the browser stress probe) | The x-ray silhouette pass drew the near-plane sprite | No x-ray while the Pokémon dissolves |

Before → after (`scripts/camstats.ts`, default maps: Viridian Forest, generated badlands and frost, Mt. Moon; seeds 1–3;
Cyndaquil, Charmander, Feraligatr; 36 runs per frame rate; median / worst):

| | Before | After |
|---|---|---|
| Fight: highest boom elevation (lens ≥ 1 m from the pivot), 30 / 60 / 144 fps worst | 68.8 / 70 / 70.3° | 30.4 / 28.9 / 28.9° (the rig's own cap is 17° + 12° climb) |
| Walk: largest per-frame change of lens velocity, 60 fps | 5.05 / 47.8 m/s | 4.91 / 29.8 m/s |
| Walk: same, 144 fps (a pop of x m reads as x × 144 m/s here) | 4.28 / 98.2 m/s | 2.42 / 53.8 m/s |
| Fight: 99th percentile of the same, 60 / 144 fps worst | 17.9 / 29.6 m/s | 15.6 / 16.0 m/s |
| Turning on the spot: boom range (zoom) | 2.07 / 2.83 m | 0 / 0 m |
| Walk: boom travel in 20 s | 9 / 28.1 m | 8.1 / 27.5 m |
| Lens path at 30 fps vs 60 fps (same recorded player path) | 0.32 / 1.61 m | 0.045 / 0.54 m |
| Lens path at 144 fps vs 60 fps | 0.16 / 1.80 m | 0.004 / 0.23 m |
| Idle drift | 0 | 0 |
| Fight: largest single-frame lens move, 60 fps | 0.45 / 1.22 m | 0.42 / 1.66 m |

The browser stress probes (`stress-*` in `tools/chasecheck.json`, real build, real renderer) agree: badlands Feraligatr
fight 18.5° highest, turning among trees 0 m of zoom, Mt. Moon Feraligatr walk 0.45 m largest frame step.

Cost: the rig takes ≤ 0.05 ms per frame median, ≤ 0.13 ms at the 99th percentile (was ≤ 0.02 / 0.08 ms; up to 4 ticks per
frame at 30 fps). Props drawn per frame on the 128 m regions are unchanged (150–2150 billboards in one instanced draw); on a
256 m classic region the fog-bounded radius cuts them from up to 7300 to 4400–5500. Render time under SwiftShader at 640×360:
0.1–0.4 ms median, ≤ 1.2 ms p95. No real-GPU measurements were taken.

## Diagnostics
- `npx tsx scripts/camstats.ts [--fps 30,144] [--seeds 1,2,3] [--stages 0,1,2,3] [--species …] [--authored] [--noprops] [--noswap] [--rawsize]`:
  idle drift, turning on the spot, a scripted walk, 30 s of bot combat, and (at other frame rates) the lens path against
  60 fps along the same recorded player path. The column meanings are at the top of the script (`*ElevMax` only counts frames
  with the lens ≥ 1 m from the pivot; `*PitchMax` is how far the view looks down; `*JumpMax` the largest one-frame lens move;
  `slides` counts the safety net's 120 Hz ticks, not frames, and is not comparable with the old `groundPops`). Since
  2026-11-16 the rig is given the size the renderer submits (idle frame × the species' visible-size scale,
  `scripts/lib/chasesize.ts`); before, these diagnostics used the raw idle frame (Feraligatr 1.75 m instead of the 2.71 m
  it is framed at), so the tables above were measured on the wrong sizes. `--rawsize` reproduces the old sizing.
- `node tools/cap.mjs dist/index.html tools/chasecheck.json out`: idle (two shots 2 s apart: the view must not move; sprites and grass still animate), turning, walking and
  sudden turns in the forest, a large and a flying Pokémon, a squad tag, combat, taking damage, a boss, a cave, terraces,
  snow, and under a deck; `stress-*` run 8–30 s of combat, turning or walking frame by frame in the page and print the
  highest elevation, the largest frame step and the zoom range.
- `tests/camstability.test.ts` pins every defect above, on synthetic terrain and on generated maps (the badlands fight,
  turning among trees, idle in forest, badlands and cave, the replayed walk at 30 / 144 / jittery fps).

## Controls
Click the game once to capture the mouse (a hint shows until you do); that click only captures it and does not attack. Esc releases it and pauses; resuming recaptures it.
Right stick turns the camera. If the mouse is not captured, holding the right mouse button and dragging still turns the camera.

## Known limits
- **Thin ridges and fast sideways dashes in caves.** When a ridge comes between the Pokémon and a long boom (Feraligatr's
  7.6 m Pressure boom in Mt. Moon) or the Pokémon dashes sideways at ~24 m/s along rock, the eased boom cannot get in front
  of the rock before the lens reaches it, and the slide moves the lens to the near side in one frame: 1.5–1.7 m at 60 fps,
  up to 3.6 m in one 30 fps frame. Reproduce: `npx tsx scripts/camstats.ts --seeds 3 --stages 3 --species feraligatr --fps 30,60`
  (fight, ~24.5 s and ~25.9 s). Severity: moderate (rare, in combat, a cut rather than a swing). Follow-up: anticipate with
  the predicted lens position (pivot velocity including forward motion plus turn rate), or a faster pull-in only while the
  line of sight is blocked within ~1 m of the Pokémon.
- **Convex corners while walking.** The same mechanism at walking speed: one slide of ~0.5–0.7 m (walk worst 29.8 m/s at
  60 fps, Mt. Moon seed 3).
- **Lens right behind the Pokémon.** Backed into a wall, the lens may come to the near plane; the Pokémon then dissolves
  (95 %) and nothing behind is shown. Visible threats behind the Pokémon rely on the threat ring.
- **30 fps input sampling.** The rig decides at the same instants at any frame rate, but at 30 fps it sees the player only
  every other sim tick (interpolated between frames), so near a wall it can take a slide a moment earlier or later than at
  60 fps (0.54 m worst, 0.05 m median).
- Turning on the spot on a genuine ramp (Mt. Moon) tilts the view by up to 5.5°: that is the slope tilt, by design.
- Sprite edges still crawl by a pixel as the camera moves (nearest sampling at ~400 lines, no anti-aliasing): that is the
  pixel-art look, not a defect, but it reads as shimmer on high-contrast edges.
- **Not validated by hand.** All of the above comes from headless runs, scripted browser probes and screenshots. Nobody has
  played this build with a mouse or a gamepad: feel (responsiveness, how the slides read, the dissolve) and real-GPU
  performance are unverified.

## Not in yet (next phases)
The hero-shooter migration (a 3D aim ray in the sim, attacks from the body, vertical combat, input buffering, shooter
facing, headroom under decks) is planned in `docs/THIRD_PERSON_IMPLEMENTATION.md`; the aim ray and body-launched 3D direct
shots landed in Phase 2B (its §13), beams in Phase 2C (its §14); the other move families have not moved yet. This file stays canonical for the rig as built.

Rear-arc sim rules, compass, 3D audio (P1/P2); camera-relative sprite directions per creature with hysteresis, lock-on (P1);
terrain mesh from the tile grid, instanced grass with a trample texture, shadows, the 3D pilot (P3).

## Checks
`npm test` (includes `tests/chase.test.ts`, `tests/camstability.test.ts`, `tests/viewsample.test.ts` and `tests/settings.test.ts`), `npx tsx scripts/checksum.ts on` (must match
the pre-change hashes), `npx tsx scripts/camstats.ts`, and `node tools/cap.mjs dist/index.html tools/chasecheck.json out`
(or `tools/chasescenes.json`) for third-person captures.
