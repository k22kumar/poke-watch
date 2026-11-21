# Third-person camera

The default view is a close camera over the right shoulder of the Pokémon that the player turns with the mouse or the
right stick; the screen centre is the aim. It is render-side: nothing under `src/sim` or `src/world` reads it, and
`scripts/checksum.ts` prints the same hashes with it as without it. Rebuilt on 2026-11-18 as one stable combat framing
(see "Overhaul: what was wrong" below; ledger `docs/THIRD_PERSON_IMPLEMENTATION.md` §24), and reframed the same day from
the sprite as drawn, in screen space ("Composition" and "Second pass" below; ledger §25).

## What is in
| Piece | Where |
|---|---|
| Rig: an L-shaped arm (pivot, hand, lens) framed from the sprite's measured outline, rigid follow with stair smoothing, clearance (terrain, decks, map edge, bare walls), the player-owned ±89° envelope with the overhead lens (R3), aim ray, off-frame cue (pure maths, unit-tested); every tuning value in `CHASE_CONFIG` | `src/render/camera.ts`, `tests/chase.test.ts`, `tests/camstability.test.ts`, `tests/freelook.test.ts`, `tests/camfollow.test.ts` |
| Screen-space framing: the billboard card as the shaders draw it, the keep-out around the crosshair, the framing law, the fade | `src/render/framing.ts`, `tests/camframe.test.ts` |
| The sprite's outline, measured from the art at load (every frame's opaque bounds, the body, the combat corners) | `src/assets/measure.ts` `silhouetteOf`, `src/assets/pack.ts`, `scripts/lib/silhouette.ts` (the same in Node) |
| Host frame order: look → one `ViewSample` → the frame's sim ticks → render | `src/render/hostframe.ts`, `tests/viewsample.test.ts` |
| What the rig is told each frame: the Pokémon (position, outline, support flag) and the world (terrain, decks, map edge, bare walls; never a prop). Nothing about enemies or combat | `src/render/chaseinput.ts` |
| Look input: mouse (equal yaw and pitch per count), right stick (radial dead zone, response curve) | `src/render/hostframe.ts` `lookDelta`, `src/input/stick.ts`, `tests/lookinput.test.ts`, `docs/CONTROLS.md` "Look" |
| Camera branch, sky, fog, per-object billboard stretch and lean (R3), sprite direction relative to the camera | `src/render/renderer.ts`, `src/render/tilestage.ts`, `src/render/sky.ts` |
| Draw culling (lens-centred; the plane behind the lens follows a steep down-look, R3) | `src/render/view.ts` |
| Off-frame cue for the player's own Pokémon (R3) | `src/ui/ui.ts` `selfCue`, `src/main.ts` `drawAwareness` |
| Minification-aware sprite sampling | `src/render/spritesample.ts` |
| Mouse capture (pointer lock), right-stick look, hint, pause when the browser releases the mouse | `src/input/input.ts`, `src/main.ts` |
| Settings: Camera (Third person / Classic / Overhead / Wide), Look speed, Invert look, Field of view | `src/ui/ui.ts` |
| Diagnostics: composition report, motion bench, aim report, headless camera stats, browser scene captures | `scripts/camframe.ts`, `scripts/camstats.ts` (`--bench`), `scripts/camaim.ts`, `scripts/habcam.ts`, `tools/camframescenes.json`, `tools/chasecheck.json`, `docs/camaudit/` |

Classic, Overhead and Wide are the old fixed views, unchanged and still pixel-locked (`?cam=wide`, or Settings → Camera;
docs/CAMERA.md). Settings are loaded by `loadSettings` (`src/ui/settings.ts`, tested in `tests/settings.test.ts`): a new
player gets Third person; a copy saved before this camera existed moves to it once, keeping its other choices; a camera
the player picked after that is kept; an unknown camera id falls back to Third person.

## Camera
One framing, attached to the Pokémon, turned only by the player. The reference is Plants vs. Zombies: Garden Warfare 2's
close over-the-shoulder shooter camera (the hero in the lower left of the frame, the crosshair at the centre, the horizon
just above it). What that game does internally is not documented anywhere we found; the numbers here come from measured
composition, not from its code.

- **Update order (one authoritative path).** Each animation frame, `main.ts` runs `runFrame` (`src/render/hostframe.ts`):
  look input goes to the rig (`Renderer.look` → `ChaseRig.look`, yaw and pitch at once), one immutable `ViewSample` is taken
  (`Renderer.viewSample`), and every 60 Hz sim tick due that frame (zero, one or several) moves and aims with that sample.
  Then `Renderer.render` interpolates the player between the last two ticks and calls `ChaseRig.update` once with
  `chaseFrameFor(...)`. Nothing else writes the camera. See "View-state contract" below.
- **Fixed clock, exact anchor.** Inside `update` the rig steps on its own 120 Hz clock (`CHASE_CONFIG.tick`) with the
  Pokémon's position and the yaw interpolated to each tick's time, so every timer and threshold (collision easing and
  holds, the step smoothing, the deck cap) is decided at the same instants at 30, 60 or 144 fps. The frame then takes the
  arm (the lens relative to the Pokémon) between the last two ticks and puts it on the Pokémon where it is drawn this
  frame, turned to the yaw and pitch the player has now: the camera never trails the body, and look input has no added
  latency.
- **No states.** There is one framing. Nothing about enemies, bosses, crowds, combat, speed, animation or the Pokémon's
  traversal mode reaches the rig (`chaseFrameFor` passes none of it). The FOV is `CHASE_CONFIG.fov` (64° vertical) plus the
  player's Field of view setting (−10..+12), and nothing else changes it.
- **What wins when they conflict.** (1) The lens keeps `lens.clear` (0.3 m, the near plane) from terrain, bare walls,
  deck undersides and the map edge, on every drawn frame and every view sample. (2) The view direction is the player's
  yaw and pitch, exactly. (3) The composition below, when it fits: while no wall takes the shoulder, no slab the pivot,
  and the pitch is inside the orbit range. (4) Otherwise the Pokémon dissolves by how far its drawn frame is inside the
  keep-out. The rig's stages run in that order: ideal arm → clearance (unsmoothed) → smoothing → a last clearance check
  on the composed frame (`clearLens`, in `update` and in `look`).
- **Composition** (`src/render/framing.ts`, `CHASE_CONFIG.reticle`, `.frame`, `.shoulderMax`): framed from the sprite as it
  is drawn, not from the size class. The art is measured at load (`assets/measure.ts silhouetteOf`): every frame's opaque
  bounds around its anchor; the **body** (idle + walk, all eight rows: its top, its reach to the right, and its **drop**,
  how far it draws below the anchor); and the **combat corners** (the outermost right-and-up corners of the attack,
  shoot, charge and hurt frames, with the procedural lunge and bob offsets of `assets/art.ts OVERLAY`, which the renderer
  draws with too). The body goes in the band between the crosshair and the HUD's move bar, left of the crosshair:
  - **Keep-out**: the Pokémon lies 7° or more left of the crosshair (`reticle.side`) **or** 3° or more below it
    (`reticle.below`). The outline's top-right corner is put exactly on the keep-out's lower-left corner.
  - **Pivot** = the corner's top as the shader draws it: `top ×` the billboard stretch at the lens (`pivotHeight`, closed
    form; past the stretch cap, where a card leans, the top's own sight line). The arm sits `reticle.below` over the view
    axis, so the outline's top is that far under the crosshair line at every pitch of the orbit range and at every arm
    length. Past the orbit range the pivot stays where that range left it (`chasePivotH`): see "Arm elevation".
  - **Shoulder** = the corner's reach + back × cos(3°) × tan(7°), at most `shoulderMax` (0.6) × the back distance. No
    species of the roster reaches the cap (the most is 0.48).
  - **Back distance** = 4.3 m × (drawn body height / 1.9 m), inside 1.8 to 14 m (9 m until F3, 2026-11-18: Onix, Furret
    and the capture-only giants were held short of their framing; the largest, Eternatus, wants 13.75 m). The drawn body height is `top + drop`: a
    PMD sprite's anchor is the middle of its ground footprint, and the picture reaches below it by a fifth of its height
    at the median species and three quarters for a few (Diglett, Sizzlipede, Quilava). With the top pinned, the arm's
    length is what decides where the body's lowest drawn point lands: 0.88 to 0.94 of the frame height, for every
    species. Framed from the top alone (the first version of this pass) that point was at 0.85 to 1.11: half the roster
    drew its feet under the move bar and six species drew theirs off the bottom of the screen.
  - **Fixed combat allowance** (`reserveCorner`): one figure per sprite, never per frame. Where a combat frame reaches past
    the body's corner both ways, the corner moves sideways (never up: `reticle.rise` 0) by the smallest shift that keeps
    every such frame out, at most 4° (`reticle.reach`). 34 of 68 species need one (0.7° to 19°); 22 need more than the
    cap, and the frames past it (hurt frames of 20 species, attack frames of Cyndaquil and Koffing: 131 of 24 952)
    dissolve instead.
  - A subject with no measured art (a Node run that decodes no atlas, a synthetic frame) gets the roster's medians for its
    size class (`classOutline`: top 1.2 ×, reach 0.7 ×, drop 0.25 × the visible core).
  - **Subject tilt** (`chaseTilt`, F3): with no input the view axis meets flat ground inside `aim.max` (26 m, criterion
    E4) for every partner. One whose ground point would lie past it is framed with just enough extra pitch to bring it
    back (at most `aimPitch.tiltMax`, 10°), and the arm elevation follows, so the corner stays on the keep-out's. Today
    only Onix (0.52°) and the capture-only Eternatus (2.35°) get any; every other partner gets none. Like the ideal arm it
    is one figure per outline, eased over `frame.settle` when the outline changes (a tag swap, an evolution, any size
    change), never otherwise. The look band stays absolute (±89° about the horizon). This is the one condition-bound
    exception to "the crosshair ray does not move without input" (`THIRD_PERSON_IMPLEMENTATION.md` §26).

  | (roster of 68, open flat ground, no input, FOV 64°) | min | median | max |
  |---|---|---|---|
  | Back distance | 1.80 m | 4.30 m | 9.00 m |
  | Shoulder | 0.49 m | 1.50 m | 4.01 m |
  | Lens height over the feet | 1.43 m | 3.03 m | 6.63 m |
  | Pinned corner, from the crosshair | (−7°, −3°) for all | | |
  | Body top, down the frame (0 top, 1 bottom) | 0.542 for all | | |
  | Lowest drawn point of an idle / walk frame | 0.880 | 0.916 | 0.938 |
  | Drawn body (top to lowest point), share of the frame height | 0.338 | 0.374 | 0.396 |
  | Crosshair's ground point with no input | Tiny 5.3–6.1 m | Medium 9.7–15.3 m | Extra Large 18.9–25.4 m |

  **The HUD.** The move bar (`ui/style.css .hud-bottom`) is laid out in fixed pixels at the bottom centre: its top edge is
  at 0.946 of a 1080-pixel-high window and 0.919 of a 720-pixel one. No idle or walk frame of any species is under it at
  1920 × 1080 or 1920 × 970; at 1280 × 720, frames of 18 species reach up to 1.8 % of the screen height under it (7 % of
  one frame at most); at 1366 × 650, 51 species, 2.7 % (10 %). `scripts/camframe.ts` prints this ("HUD"), and
  `tests/camframe.test.ts` holds the first two.

- **Player input:** mouse / right stick turn yaw (free) and pitch: the view looks from 89° above the horizon to 89° below it
  (`CHASE_CONFIG.aimPitch`, owner decision E), 11° below with no input (it was 6°: the lens stands higher, and 11° keeps
  the crosshair's ground point inside the planar aim range for every class). The view axis, which is also the crosshair
  ray the sim receives, is `aimPitch.neutral + userPitch` and nothing else (Phase 4A): no slope, wall, jump, step or
  clearance turns it.
- **Arm elevation** (`boomElevation`): the view pitch + 3° (`reticle.below`), inside 2°..40° (`elevation`, the orbit
  range), so with no input the lens sits 14° over the pivot; the lens orbits with the pitch.
  Past 40° down it rises with the view (elevation = view pitch, R3, owner decision C, the 40° start approved 2026-11-17):
  the crosshair ray passes the pivot's vertical line at the pivot's height and meets level ground ahead of the feet,
  moving toward them as the view goes down; there the Pokémon is under the crosshair's region and dissolves (rule 4).
  The pivot does not move in that range: the lens rises on an arc of one length about a fixed point, so the Pokémon keeps
  its size (lens height over the feet at 11° / 40° / 89° down: Pichu 1.7 / 3.1 / 4.0 m, Feraligatr 5.6 / 10.3 / 13.2 m).
  Following the leaning card's top all the way, as the pivot does inside the orbit range, put it five to six outline
  heights up at 89° and the lens 8 m over a Pichu and 24 m over a Feraligatr. Looking up, the
  lens stays at 2° and the Pokémon leaves the bottom of the frame by about 25°:
  a small pale-cyan ring with a point sits on the screen edge toward it, fading in over the first 15 % of the half-screen
  past the edge (`offFrameCue`, `CHASE_CONFIG.cue`); it never shows while any of the body is on screen.
- **Follow.** The anchor is the Pokémon's feet as drawn: walking, accelerating, braking, reversing, strafing, dashing,
  jumping, falling, gliding and knockback move the camera with the body 1:1, so the Pokémon never moves in the frame and
  the crosshair ray never moves against it. The rig keeps no velocity: where the Pokémon is going never moves the camera.
  The one exception is the **stair smoothing** (`CHASE_CONFIG.step`): the sim
  moves a supported body up or down a tile edge (0.25 m and 0.5 m are the common ones) in one tick; while the body is on
  the ground over the span drawn (the sim's `Player.pgrounded && grounded`), the rig's height follows it at no more than
  4 m/s and never more than 0.6 m behind, so a 0.5 m step is taken up in 0.125 s instead of in one frame; a ramp or stairs
  climbed slower than 4 m/s vertically are followed exactly (the Source SDK declares a `C_BasePlayer::SmoothViewOnStairs`
  for the same problem; its body was not checked). **The sprite is drawn with the same offset** (`ChaseRig.spriteStep`), so
  the Pokémon does not move in the frame either; its shadow, ground ring, hurtbox, muzzle and shots stay where the body
  is. The sprite takes at most 0.35 × its outline's top of the offset (`step.sprite`): the offset draws the feet under
  the tile just climbed, and all of a 0.5 m step hid more than half of 12 of the 68 sprites on its first frame. With the
  share, that is one (Diglett, 60 %); 47 sprites still take a 0.5 m step whole and the 21 smallest move against the lens
  on its first frame (11 of them by over 0.1 m, 0.16 m at most). A 0.25 m step is shared whole by every sprite.
  Over open air (a chasm) the renderer holds the camera at the last safe height and watches the fall.
- **Clearance.** The arm is L-shaped: pivot → hand (the shoulder, sideways) → lens (back from the hand, at the arm's
  elevation). Each tick two sweeps find how much of each arm is free (sampled every 0.25 m, then bisected; a point is
  free when it is 0.3 m over the floor and under a slab there, in no bare wall, and 0.3 m along x and z from rock, a wall
  or a slab). A wall behind the Pokémon shortens the back arm only: the shoulder stays, so the Pokémon grows down and to
  the left from its pinned corner and the crosshair stays clear at any arm length. A wall on the shoulder side shortens
  the shoulder only: the Pokémon is drawn no larger, moves toward the crosshair, and dissolves where it crosses the
  keep-out. Rock behind the shoulder side is passed on the inside: of the hands the world leaves free, the rig takes the
  one whose lens ends nearest the ideal lens (the hand in use has to be beaten clearly). A Pokémon pressed into a corner
  has its pivot inside the walls' clearance; the arm leaves that place for the first clear point beyond, and the hand may
  back off the other way by up to 0.6 m. The arms ease back out over 0.45 s once there has been room for 0.25 s.
  **The way in** (`boomTime.in`): the two arm lengths that respect everything in their way give a clear point for the
  lens. The lens goes there from where it was along the straight line between the two, at no more than 15 m/s (a quarter
  metre a frame at 60 fps), and hops only the stretch of that line that is itself within 0.3 m of a solid. What cuts an
  arm is mostly a wall's end or a ridge's corner crossing it near the Pokémon while the lens, further out, is in free
  air: in three of four cuts of over a metre the line had 1.3 m of rock on it or less. For those few frames the rock is
  between the lens and the Pokémon (which shows as its x-ray stipple); the sim's aim trace starts at the Pokémon's own
  plane, so it does not see that rock. Coming in all at once, as the first version of this pass did, moved the lens over
  a metre in one frame 2.3 times a minute in the forest and 4.3 in the cave, by up to 8 m.
  **Solid for the lens:** terrain, deck undersides, the map edge (a cave's border is raised rock) and bare walls (rock
  masses, cave walls, the habitats' low ruin walls: solid at every height, or up to the underside of a deck over them, as
  for bodies and shots). **Props never** (trees, rocks, fences, buildings; owner decision 2026-11-18, which replaces R1b
  Q10): the lens passes through them and they dissolve around it, out to where the Pokémon stands (`tilestage.ts`
  `uNearLens`), and any prop between the lens and the Pokémon is screen-doored. Nothing looks ahead: not along the
  velocity, not along the turn, not along the pitch. Only what is in the way moves the arm.
- **Decks** (`CHASE_CONFIG.deck`): a deck over the back arm's ground track (out to 1.2 × the back distance at the
  elevation in force) caps the arm's elevation so the lens stays 0.45 m under the slab there; a slab over the Pokémon,
  over the shoulder arm or over the back arm as far as the lens lowers the pivot to 0.45 m under it (an outline's top may
  stand taller than the gap), and a slab within 2 m of the Pokémon, any way round, starts both coming in. They come in
  over 0.2 s and go over 0.3 s (toward the elevation the pitch asks for, not toward 90°). All of it depends on where the
  Pokémon stands, never on where it is heading. Walking out from under a 2.4 m deck, in under one and through one at the
  neutral pitch and 40° down, no frame moves the lens more than 0.5 m for Tiny to Large; 0.8 m looking 70° or more down,
  1.0 m for an Extra Large (see "Known limits").
- **Close lens:** at under ~0.95 m from the pivot (an arm with nowhere to go) the Pokémon dissolves (ordered dither)
  rather than filling the screen: 75 % by 0.45 m, 95 % at the 0.3 m near plane. The x-ray silhouette is not drawn while it
  dissolves.
- **Fade** (`framing.ts fadeFor`): the frame about to be drawn is projected through the final view (`subjectBox`); more than
  0.3° inside the keep-out (`KEEP_SLACK`) it dissolves by half at once, three quarters two degrees further in, and eases
  back over a quarter of a second. One mechanism for every exception: a wall on the shoulder, a slab over the pivot, a
  combat frame past the allowance, the overhead view. `Renderer.subjectBox()` reports the box drawn.
- **No shake.** The lens is the crosshair ray's origin: shaking it moved the aim and the whole view on every hit and boss
  slam. Third person never shakes; Settings → Screen shake applies to the fixed views only. (Cinemachine's third-person
  aim extension cancels camera noise for the same reason.)
- **Aim = camera.** The crosshair ray (`InputFrame.aim`, `aimRayOf(view)`) is the sample's lens and axis. The sim
  traces it for the direct shots (bolt, orb) and beams: they leave the body's muzzle (class
  height × 0.6 above the feet, ahead by the footprint) toward what the crosshair is on, in 3D, with no magnetism or lead,
  and the crosshair turns red when cover stands between muzzle and target (Phase 2B/2C, `docs/THIRD_PERSON_IMPLEMENTATION.md`
  §13, §14). This is the standard camera-ray targeting with physical attack origins: the camera picks the point, the body
  is where the attack starts, and an obstruction the camera does not see is reported, not hidden. Every other move still
  reads `aimX/aimZ`: the crosshair ray against the terrain, 4–26 m from the Pokémon, nudged by the shoulder offset so they
  converge on the crosshair (`chaseAim`: the sideways part is eased in over the first 16 m, so with the wider shoulder
  the planar ring sits further inside the crosshair's ground point at close range than it did). R2 keeps the aim maths
  pole-safe (§18); Phase 3 sets the device assistance on the planar moves (§15). Clearance and the stair smoothing move
  the ray's origin (parallel) but never its direction.
- **Facing:** the sim turns the Pokémon toward its movement direction (and to the aim while a move is winding up). The
  camera never reads the facing; sprites pick their direction from the facing relative to the camera yaw.

## Overhaul: what was wrong (2026-11-18)
Each problem was reproduced on the rig at HEAD b89fb55 before changing it, with a headless probe driving the real sim and
the real rig on a flat plain (no collision), 60 and 144 fps, Cyndaquil and Feraligatr. "Lens vs Pokémon" is the lens'
offset from the drawn Pokémon in the view's frame; after the change every one of these is 0 (`tests/camfollow.test.ts`).

| Reported problem | Cause | Before | Fix |
|---|---|---|---|
| Camera moves forward / backward when accelerating, braking, reversing, dashing | The pivot followed the Pokémon through a first-order lag (`1 − e^(−16 dt)`): it trails by speed / 16 | lens vs Pokémon along the view 0.51 m (walk), 1.03–1.07 m (reverse), 1.0 m (dash) | anchor at the drawn position |
| Lateral drift while strafing | the same lag | 0.51–0.53 m; the Pokémon moved 0.07–0.12 of the half-width on screen | same |
| The camera bobs and the Pokémon moves in frame on a jump | vertical lag (`e^(−7 dt)`) and only 65 % of a jump followed (fliers 85 %, read from the traversal capability) | 1.0 m; 0.24–0.42 of the half-height on screen | 1:1 in the air; stair smoothing on the ground only |
| Distance and angle change when Pokémon appear nearby | three threat states (Explore / Combat / Pressure) chosen from hostiles within 20–30 m: boom 4.2 → 5 → 6.2 m, elevation 9 → 13 → 17°, FOV 64 → 68 → 72° | one Pokémon 15 m away then a crowd: lens 1.6 m (Cyndaquil) to 2.8 m (Feraligatr), boom +1.8 / +3.1 m, FOV +8°; the crosshair's point 15 m ahead moved as much with no input | removed: one framing |
| Unexpected lateral shifts | automatic shoulder swap when the right side was walled in | a 2 × 0.24 × boom jump of the composition and the ray | removed: fixed shoulder, the boom shortens |
| View-angle changes near walls | automatic climb of up to 12° over a wall behind | measured to 26.5° walking, 29° fighting (camstats, default maps) | removed |
| Camera reacts to combat | screen shake on the lens (0.12 m), i.e. on the ray's origin | | removed in third person |
| Too distant | Explore boom 4.5 m for a Medium, 6.7 m in Pressure; vertical FOV up to 72° (105° horizontal at 16:9) | the Pokémon filled 0.11–0.33 of the frame height | boom 3.5 m (Medium), FOV fixed at 64° + setting; share 0.28–0.34 |
| Inconsistent sizes | framing from the art's idle frame, boom ∝ size^0.55, pivot from the drawn sprite | Tiny 0.17 vs XL 0.30 of the frame; XL pivot above a 2.4 m deck's clearance (F5: 815 safety-net slides in a camstats run) | size-class law, pivot from the body height |
| Pops at decks | the slab cap on the elevation switched in one tick by the deck over the pivot alone | 1.5 m (Pichu) to 9 m (XL) one-frame jumps leaving a 2.4 m deck | eased cap over the boom's whole track |
| Mouse diagonal aim bends | pitch 0.0018 rad per count against yaw 0.0022 | a 45° flick turned at 39° | equal (`docs/CONTROLS.md` "Look") |
| Stick cannot aim finely | per-axis 0.18 dead zone, no rescale, linear | slowest turn 27°/s; slight off-axis pushes snapped to the axis | radial dead zone, rescale, exponent 2 |
| Death sequence jitter | `P.px` (start of the interpolation span) not refreshed while the player system is skipped in the `dead` state; knockback still moved `P.x` | the drawn Pokémon (and a rigid camera) swung up to 0.9 m a frame at 144 fps | `run.ts` refreshes it while dead (render-only state, hashes identical) |

On the default maps (`scripts/camstats.ts`, seeds 1–3, stages 0–3, Cyndaquil, Charmander, Feraligatr, 36 runs; median /
worst, 60 fps):

| | Before (b89fb55) | After |
|---|---|---|
| Walk: highest arm elevation | 9 / 26.5° | 8.7 / 11.3° |
| Fight: highest arm elevation | 18.5 / 29° | 8.7 / 19.7° |
| Fight: FOV travel | 4.2 / 8° | 0 / 0° |
| Walk / fight: boom travel (zoom) | 11.1 / 23.8 m; 23.2 / 83.6 m | 7.4 / 20.3 m; 14.6 / 58 m |
| Walk: largest one-frame lens move | 0.31 / 7.54 m | 0.24 / 1.27 m |
| Safety-net slides (walk + fight; pitch sweep) | 0 / 814; 0 / 557 | 0 / 15; 0 / 2 |
| Lens vs Pokémon, per-frame change of velocity, 99th pct (the camera's own motion): walk / fight | 5.98 / 29.4; 15.3 / 29.2 m/s | 2.0 / 26; 2.95 / 26.5 m/s |
| Lens in world space, the same (now includes the Pokémon's own starts, stops and dashes) | 1.48 / 4.82 m/s | 4.37 / 12.5 m/s |
| Lens path at 144 fps against 60 fps (same recorded walk) | 0.004 / 0.065 m | 0.033 / 0.175 m |
| Lens path at 30 fps against 60 fps | 0.045 / 0.54 m (second pass) | 0.07 / 0.42 m |
| Turning on the spot: zoom, elevation or pitch change; idle drift | 0 | 0 |

The browser stress probes (`tools/chasecheck.json`, private builds, headless Chromium 1254) agree: highest elevation in
the badlands fight 17° → 8.7°, cave walk 20.4° → 10.7°, cave fight 29° → 8.7°; boom range 5.1–5.7 m → 2.4–5.0 m; the
combat and boss scenes keep boom and FOV (before: 3.78 → 4.82 → 5.05 m and FOV 69.9°).

## Second pass: composition, apparent size, aim (2026-11-18)

The overhaul above made the lens rigid against the Pokémon and proved it on a flat plain. On the maps the game builds,
the player still saw the Pokémon over the crosshair, growing when reversing, strafing and attacking, and a camera that
kept moving. This pass measured the picture: the sprite as the shader draws it, projected to the screen, on real maps,
by movement direction, against pass marks fixed before any tuning (ledger §25; figures in `docs/camaudit/`).

| What the player saw | Cause (measured on the rig before this pass) |
|---|---|
| The Pokémon over the crosshair | The shoulder offset was 0.24 × the boom, from the size class alone, and the pivot 0.8 × the class height: all 68 species had standing or walking frames inside 7° / 3° of the crosshair (23 548 of 24 952 gameplay frames); the body's top stood at 0.20 to 0.44 of the frame height, over the crosshair line |
| | The class's visible core is not what is drawn: the drawn body took 0.31 to 0.76 of the frame height (median 0.48) |
| The Pokémon growing | One diagonal arm: a wall behind shortened it and the shoulder with it, so the sprite grew into the centre. More than 1.25 × its size in 39 % of frames on the tuning maps (74 % in the worst cell) |
| | Dense props pulled the boom to 45 %; collision looked 0.35 s ahead along the velocity and the turn, so the boom followed the movement keys |
| | The sprite itself: facing follows movement and snaps to the aim on an attack, and rows and clips differ (0.9 to 3.0 × the idle back view's area). Not the camera: left for Stage 6B by owner decision |
| The camera kept moving | The same boom changes (0.39 m/s of arm travel; a lens step over 0.25 m 12 times a minute); the stair smoothing moved the lens but not the sprite |

What changed: the L-shaped arm, the measured outline, the keep-out and the fade ("Camera" above). No library was
adopted: the ones looked at (camera-controls, three-player-controller, ecctrl, the Babylon and PlayCanvas cameras) need
three.js or a whole engine and mesh colliders, and none frames a sprite's silhouette. The structure is borrowed: the arm
is Cinemachine's Third Person Follow (origin, shoulder, hand, camera; "the rig bends and stretches to keep the camera
outside the obstacle"), clearance apart from smoothing is its Decollider, pull-in only on a hit is Unreal's spring arm.
Garden Warfare 2 was the reference for the picture; only its 70° vertical FOV is documented, the rest (hero lower left,
whole body in view, crosshair clear) is read from play and stated as that.

Before / after, on the same benches (the rig before was rebuilt from its source and re-measured with the final benches;
it reproduced its first recording exactly):

| | Before | After |
|---|---|---|
| **Composition**, 68 species, open ground, no input | | |
| Species with a standing or walking frame in the keep-out | 68 | 0 |
| Gameplay frames in the keep-out (all dissolve after) | 23 548 of 24 952, none dissolved | 131 (hurt frames of 20 species, attack frames of 2) |
| Body top, down the frame (crosshair at 0.5) | 0.20 – 0.44 | 0.542, every species |
| Lowest drawn point of a standing or walking frame | 0.68 – 1.01 | 0.88 – 0.94 |
| Drawn body, share of the frame height | 0.31 – 0.76 (median 0.48) | 0.34 – 0.40 (median 0.37) |
| **Motion, tuning maps** (generated seeds 1–3, four regions, 8 headings, 5 movement modes, 5 species) | | |
| Frames with the Pokémon over 1.25 × its size | 39.4 %; worst cell 74.5 %; 18 of 25 cells over 25 % | 2.6 %; worst cell 7.4 %; none |
| Clear frames (nothing in the arm's way) off the nominal size by over 2 % | 39.5 % | 0.1 % |
| Clear frames with the outline in the keep-out | 100 % | 0.02 % (one stand against a deck's edge), dissolved |
| Tight frames in the keep-out and not dissolved | 70 % | 0 |
| Clear frames where the Pokémon shifts on screen (over 0.2 % of its height in a frame) | 10.0 % | 0.2 % |
| Lens steps over 0.25 m in a frame, per minute (of those, nothing forced) | 12.1 (11.3) | 5.5 (1.2) |
| Lens steps over 1 m, per minute; the largest | 0.01; 1.1 m | 0.93; 4.3 m |
| Arm travel | 0.39 m/s | 0.12 m/s |
| Lens within 0.3 m of rock, a wall or a slab / inside one | 3.9 % / 0.28 % | 0.2 % / 0.06 % |
| **Motion, hold-out maps** (generated seeds 7–9, authored arenas, two habitat approaches, 5 other species) | | |
| Frames over 1.25 × | 35.7 %; worst cell 66.1 %; 21 of 30 cells over 25 % | 2.3 %; worst cell 10.9 %; none |
| Clear frames off the nominal size / with the Pokémon shifting | 38.1 % / 8.6 % | 0.0 % / 0.1 % |
| Lens steps over 0.25 m per minute (nothing forced) | 9.5 (8.6) | 3.4 (0.4) |
| Lens steps over 1 m, per minute; the largest | 0.00; 1.4 m | 0.39; 7.6 m |
| **Aim** (`scripts/camaim.ts`) | | |
| Aim point against the crosshair, standing, every tight pose | 0.0003° | 0.0026° |
| The same while moving, not explained by that frame's lens travel | 0° | 0.0044° |
| A target on the crosshair, basic attack, 35 poses | 28 hit, 7 occluded | 28 hit, 6 report blocked and stop on the cover, 1 occluded |
| Crosshair blocked in bot fights (share of aimed frames, 7 species) | 7 – 27 % | 28 – 38 % |
| The same with the crosshair on an enemy, blocked by the world | 1.3 – 2.9 % | 8 – 15 % |
| **Sim** | | |
| Replay hashes (`scripts/checksum.ts`, 64 lines) | | identical |

What the pass marks did not catch, and looking at the captured frames did (each is in ledger §25):
- **The feet.** The mark was "feet above 0.95 of the frame", measured on the sprite's anchor. A PMD anchor is the middle
  of the footprint, and the first version of this pass, framed from the outline's top, drew half the roster's feet under
  the HUD's move bar and six species' off the screen. The framing law now reads the drawn height, and the bench the
  lowest drawn point and the move bar.
- **Looking down.** The pivot followed the drawn top past the orbit range, where the card leans: at 89° the lens stood
  8 m over a Pichu and 24 m over a Feraligatr. It holds now, and the lens orbits at one length.
- **The step.** Sharing all of a 0.5 m step's offset drew more than half of 12 small sprites under the tile they had
  climbed. The sprite's share is capped by its own height.
- **The size of a lens step.** The mark counted steps over 0.25 m, and those fell by more than half. It did not ask how
  far: with each arm coming in all at once the lens moved over a metre in one frame about 1.7 times a minute on the
  tuning maps and up to 8 m, where the rig before never moved it more than 1.1 m. The lens now comes in at a capped
  speed and hops only what is in its own way: 0.9 a minute, 4.3 m at most. Still more and further than before.

What it costs is in "Known limits": the crosshair cannot be put on an enemy nearer the Pokémon than the shoulder offset,
the muzzle is further from the crosshair's line than it was, the body is drawn smaller than before, and near rock the
lens steps less often but further than it did.

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
  advanced by one frame of motion (the Pokémon's own travel, boom easing, a step being taken up): same yaw, same look-driven
  pitch.
- **Frame composition also swings the lens for pitch.** `update()` already turned the composed lens to the newest yaw; it now
  also swings it by the boom elevation the pitch input since the last tick gives (`swingLens`, zero once a tick has run with
  that pitch, and zero while a deck caps the elevation).
- **Fixed sim vs render interpolation stay separate:** the sim steps on its accumulator; the rig steps on its own 120 Hz
  clock inside `update` only; neither drives the other.
- Pinned by `tests/viewsample.test.ts` (the real `runFrame` with a real rig and run) and the rewritten
  "rapid direction changes" test in `tests/camstability.test.ts` (it used to update the rig before aiming, the opposite of
  the host). Findings and numbers: `docs/THIRD_PERSON_IMPLEMENTATION.md` §11.

## Renderer changes that were needed
- No texel snapping, no integer-pixel focus distance; internal resolution is ~400 lines (preset `lines`), integer upscaled.
- Billboards (creatures, props) stretch by 1 / cos(elevation they are seen at) per object, so far props are not stretched.
  The stretch is capped at 1.6, which squares texels up to 51.3° of seen elevation. R3 (`CHASE_CONFIG.lean`, `LEAN_GLSL`
  in `tilestage.ts`): seen from steeper than that, a card leans back about the camera's right axis by the excess (its top
  away from a lens above it, toward one below), so its screen height stays what it is at 51.3° instead of flattening into a
  sliver (from an overhead lens the Pokémon was drawn at about a quarter of its height). Below 51.3° nothing changes.
- Sprite direction is chosen from the facing relative to the camera yaw (`dirIndex(facing − (yaw − π))`; identical at yaw π).
- Sky gradient, distance fog (per biome in `sky.ts`), mip-mapped + anisotropic terrain textures, ambient particles at 55 % size.
- Culling is a disc around the lens plus a plane 6 m behind it (`render/view.ts`): it depends only on where the lens is, never
  on where it looks (R3: except that the plane moves back as far as the frame's bottom edge reaches once a high lens looks so
  steeply down that the edge points back past the vertical, `chaseBehind`: never inside the Phase 4A envelope at the FOVs
  the setting reaches; at 89° from an Extra Large lens the old plane skipped ground the frame shows). Its radius is `chaseViewR(fogFar)` = 1.5 × the biome's fog far distance + 4 m (at most 230 m): past the
  far distance the fog closes completely over another half of it (`FOG_GLSL`), so everything beyond the radius is exactly the
  fog colour (as is the sky at the horizon) and skipping it can never make anything on screen appear or vanish. On today's
  128 m regions the radius (109–199 m) still reaches almost the whole map from the spawn; on larger maps it bounds the work.
- Sprites (props and creatures) are sampled with an n×n box of nearest taps, clamped to the sprite's own frame, wherever a
  texel is smaller than a screen pixel; at one texel per pixel or larger it is a single nearest tap (fixed views unchanged).
- The prop dither no longer assumes the camera is south of the player.

## History: the stability passes on the earlier rig (November 2026)
These two passes were made on the rig before the 2026-11-18 overhaul, which had threat states, a lagging pivot, a climb
over walls behind and an automatic shoulder swap; those are gone, and their rows below are history. The collision
machinery they produced (critically damped boom, the slide, dense-prop blocking, the eased floor, the 120 Hz clock,
lens-centred culling, smooth-noise shake for the fixed views) is what the current rig keeps.

### First pass
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

### Second pass
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
The second pass's benches measure the picture, and the same code measures the rig before and after a change (only
`scripts/lib/camrig.ts`, the adapter, knows the rig's insides). The pass marks they are read against are in ledger §25.
- `npx tsx scripts/camframe.ts [--species a,b] [--pitch …] [--set frame.boom=4.5,…] [--json out.json] [-v]`: the
  **composition** report. Every frame of every gameplay clip of the 68 framed species, projected through the settled rig
  with the billboard shader's own maths: frames in the keep-out by clip, the pinned corner, the body's top, anchor and
  lowest drawn point on screen, the drawn share, the HUD's move bar against the body at six window sizes, the crosshair's
  ground point by class, the whole pitch range, and the FOV settings and aspects. No GL: it decodes the atlases in Node
  (`scripts/lib/silhouette.ts`).
- `npx tsx scripts/camstats.ts --bench tuning|holdout [--species …] [--set …] [--json out.json]`: the **motion** bench
  (`scripts/lib/cambench.ts`). Walks on real maps by movement mode (forward, reverse, strafe left and right, stop, and
  the habitat approaches), each frame classed clear (the ideal arm unobstructed now and for the last 2 s) or tight:
  apparent size, keep-out and fade, lens clearance, lens motion against the drawn Pokémon, lens steps (how many, whether
  anything forced them, and how far: over 1 m, over 2 m, the largest), arm travel, frames with the Pokémon out of the
  frame. `tuning` is the set the config was tuned
  on; `holdout` (other seeds, the authored arenas, two habitat approaches, other species) is only ever read.
- `npx tsx scripts/camaim.ts [--species …] [--fight] [--json out.json]`: the **aim** report, with the real host order
  (look, one view sample, the tick, render) on real maps: the sim's aim point seen through the frame drawn, standing and
  moving, in tight poses and across a step; a target on the crosshair fired at; and with `--fight` the share of aimed
  frames with the crosshair blocked in bot combat aimed through the rig, with what the crosshair was on and how often
  the bot was looking over 60° down.
- `node tools/cap.mjs <private build> tools/camframescenes.json out`: the composition **captures**
  (`tools/camframescenes.gen.mjs` writes the scenes): open ground for ten species (idle, strafing, reversing, firing,
  hurt, looking up and down), four at 1280 × 720 with the move bar's box, walls behind and beside and a corner, a deck,
  forest and cave walks, frame strips across a 0.5 m step both ways, a target fired at. Each shot is followed by
  `pokewatch.renderer.subjectBox()`: the drawn frame's box on screen, its depth in the keep-out and its fade. The HUD is
  laid out in pixels, so judge it in the 1280 × 720 scenes, not the 640 × 360 ones.
- `docs/camaudit/2026-11-18-before.json` and `-after.json`: the three reports for the rig before and after the pass.

The older tools:
- `npx tsx scripts/camstats.ts [--fps 30,144] [--seeds 1,2,3] [--stages 0,1,2,3] [--species …] [--authored] [--sweep] [--sweepband 89,89] [--json]`:
  idle drift, turning on the spot, a scripted walk, 30 s of bot combat, and (at other frame rates) the lens path against
  60 fps along the same recorded player path. The column meanings are at the top of the script (`*ElevMax` only counts
  frames with the lens ≥ 1 m from the pivot; `*JumpMax` the largest one-frame lens move; `*DvP99` the per-frame change of
  the lens velocity in the world, which since the lens follows the Pokémon 1:1 includes the Pokémon's own starts, stops and
  dashes; `*RelDvP99` the same relative to the Pokémon, i.e. the camera's own motion; `*LagMax` the anchor's distance from
  the Pokémon drawn, always 0; `walkStepMax` the largest step being taken up; `slides` counts the safety net's 120 Hz
  ticks). The rig is fed as the renderer feeds it (`chaseFrameFor`), with the size class's fallback outline: the measured
  one goes in through `scripts/lib/camrig.ts chaseFrame`, as the benches above do. `--sweep` adds `sweep*`
  columns: the walk again while the player sweeps the pitch over its whole envelope (lens smoothness, slides, lowest lens
  clearance, and `sweepAxisErr`, how far the drawn axis was from the player's own pitch: always 0). `--sweepband up,down`
  sweeps that band instead of the rig's own. The flags for the earlier rigs (`--legacypitch`, `--r2envelope`, `--rawsize`,
  `--noswap`, `--noprops`) went with the code they reproduced (2026-11-18).
- `npx tsx scripts/habcam.ts <recipe> [seeds]`: the rig along a habitat Hold approach (boom share, closest lens, terrain
  between lens and Pokémon, how far ahead the route is seen).
- `node tools/cap.mjs <html> tools/chasecheck.json out` (build into a private directory: CLAUDE.md): idle (two shots 2 s
  apart: the view must not move), turning, walking and sudden turns in the forest, a large and a flying Pokémon, a squad
  tag, combat, taking damage, a boss, a cave, terraces, snow, and under a deck; `stress-*` run 8–30 s of combat, turning or
  walking frame by frame in the page and print the highest elevation, the largest frame step and the zoom range. Run
  the `stress-*` scenes on the build before a change as well: their largest frame step is what showed that the lens had
  started to move several metres at once (ledger §25.5).
- Tests: `tests/camframe.test.ts` (the composition on the real atlases: keep-out, corner, drawn size, lowest point, the
  move bar, the whole look range, tight poses), `tests/camaim.test.ts` (aim in tight poses and across a step; the motion
  marks on a reduced tuning set), `tests/camfollow.test.ts` (the overhaul's regression scenarios on the real sim:
  locomotion, jumps, steps, other Pokémon, a fight), `tests/camstability.test.ts` (clearance on synthetic terrain and
  generated maps, frame-rate replays), `tests/chase.test.ts` (the framing law, the arm, the held pivot, the sprite's step
  share, aim), `tests/freelook.test.ts` (pitch ownership, the envelope, decks, 3D shots at the limits),
  `tests/viewsample.test.ts` (host order), `tests/lookinput.test.ts` (mouse and stick).

## Controls
Start run (and Restart) capture the mouse inside their own click, so a run starts with mouse look. Otherwise click the game
once to capture it (a hint shows until you do); that click only captures it and does not attack. Esc releases it and
pauses. **Resume waits for the mouse** (2026-11-16, `main.ts` `resumeFromMenu`): in third person with a mouse, the game stays
paused until the browser grants the pointer lock (`Input.onLockGained`). A refusal keeps the pause menu up with a note,
"Click Resume again". Chrome refuses a re-lock for about a second after Esc. Before this, a refused Resume left a running
game with a free cursor, dead mouse look and a first click that attacked. Esc in the pause menu does not resume in third
person (an Esc keydown cannot grant the lock, and the same Esc that released it could reach the menu); click Resume or
press Enter on it. One refused request no longer makes clicks attack: the next click captures again. Only a page refused
twice before it ever locked, or three times in a row after, gives up on the lock (`Input.lockUnavailable`: a frame without
pointer-lock permission). Clicks then attack, Resume no longer waits, and right-drag looks. With a gamepad connected, and in
the fixed views, nothing waits for a lock. **One request at a time** (2026-11-21, `Input.capture`): a refusal counts
whether the browser reports it by the `pointerlockerror` event, by rejecting the promise `requestPointerLock()` returns,
or both (once), and a throwing or missing API is a refusal too. Repeated Resume clicks share the request still in
flight (one the browser never answers expires after 1.5 s). `releaseLock` (pause, menus, quit) withdraws a request in
flight: its refusal is dropped, and a late grant is handed straight back, so the menu keeps the cursor and the game does
not resume. Pinned by `tests/pointerlock.test.ts`.
**Locked clicks stop at the window** (2026-11-21, `Input` constructor): while the pointer is locked, `mousedown` and
`mouseup` are handled by window listeners in the capture phase, which then stop propagation, so no listener after them
(a browser extension's page-level one) sees a game click. Ghostery's `whotracksme.js` listens at window (bubble phase) and
serialises the `innerHTML` of the clicked element's three nearest ancestors on every mousedown; on the canvas that reaches
`<body>` and its inline 26 MB script: a 100–350 ms main-thread stall per click (docs/ROADMAP.md item 2). Unlocked clicks
(menus, the capturing click) propagate as before, and still pay it.
Right stick turns the camera (radial dead zone, response curve: `docs/CONTROLS.md` "Look"). If the mouse is not captured,
holding the right mouse button and dragging still turns the camera.
Look never changes altitude, and moving never reads the pitch: keys, buttons and their bindings (Settings → Controls →
Bindings), the Jump edge and the descend control are in `docs/CONTROLS.md` (R6c).

## Known limits
Measured figures are from `docs/camaudit/2026-11-18-after.json`; "before" is the rig before the second pass.
- **The crosshair cannot be put on an enemy nearer the Pokémon than the shoulder offset.** The crosshair ray passes the
  Pokémon's vertical axis at the shoulder offset whatever the yaw and pitch: 0.49 to 4.0 m (median 1.5 m), 1.7 to 4.7 ×
  the body's collision radius. It was 0.24 × the boom, about the distance of an enemy in contact, and the price of that
  was the sprite on the crosshair. An enemy inside that distance is hit by aiming past it: the shot leaves the Pokémon
  toward the crosshair's point, so what stands between the Pokémon and the crosshair on screen is in its way. A bot that
  turns the crosshair onto the nearest enemy had it on an enemy in 41 to 51 % of aimed frames (61 to 71 % before) and
  spent 10 to 41 % of them looking over 60° down after one it could not reach (2 to 15 % before). The trade is
  `reticle.side` and `shoulderMax`: a smaller shoulder puts the widest rows of the sprite back in the keep-out, where
  they dissolve.
- **The muzzle is further from the crosshair's line (criterion E5: not met).** The lens stands 1.4 to 6.6 m over the feet
  and 0.5 to 4 m to the side; shots leave the Pokémon at 0.6 × its class height. The crosshair was blocked in 28 to 38 %
  of a bot fight's aimed frames, against 7 to 27 % (the mark was "no more than 5 points over"; one species of seven
  meets it). Part of that is the bot's chase above; with the crosshair on an enemy, terrain or a wall stopped the shot in
  8 to 15 % of frames, against 1.3 to 2.9 %. The crosshair shows blocked and the shot stops on the cover, as before. The
  remedy is where the shot leaves from, or a trace from the camera: sim work, not done here (the sim is unchanged).
- **The Pokémon is drawn smaller.** Top to lowest point it takes 0.34 to 0.40 of the frame height (median 0.37), against
  0.31 to 0.76 (median 0.48): what fits between the crosshair line and the move bar. A sprite that draws far below its
  anchor (Quilava, Sizzlipede, Diglett, Furret) stands further back for it: 0.21 to 0.30 of the frame from its top to its
  anchor.
- **The HUD in small windows.** The move bar is laid out in pixels: at 1280 × 720 frames of 18 species reach up to 1.8 %
  of the screen height under it, at 1366 × 650 those of 51 species 2.7 %; in a 640 × 360 window it covers the feet. At
  the FOV setting −10 (54°) the anchors of 25 species are below 0.95 of the frame.
- **A wall right behind.** The back arm comes in and the shoulder stays, so with rock within about 2 m behind it the
  Pokémon is at the frame's left edge or off it (the lens is beside it), and the off-frame cue points to it. On the bench
  maps that is 0.03 % of frames (0.23 % in the worst cell); in the capture scenes that put a wall one or two tiles behind
  it is every frame. In the 640 × 360 captures the cue falls under the move bar; it was not captured at a real size.
- **A wall on the shoulder side** takes the shoulder: the Pokémon is drawn no larger, moves under the crosshair and
  dissolves where it crosses the keep-out. There is no shoulder swap.
- **Looking down past about 37°** frames enter the keep-out and dissolve by half or more: 2 % of all gameplay frames at
  40°, 14 % at 60°, 46 % straight down. Looking up past about 25° the Pokémon leaves the bottom of the frame and the cue
  shows where it is; past about 60° the frame can be all sky.
- **Near rock the lens steps less often and further.** The rig before eased the arm in, with the lens in rock for a
  moment (0.28 % of frames) and the sprite growing over the crosshair; it never moved the lens more than about a metre
  in a frame. This one keeps the lens out of rock on every frame, so where rock comes across an arm the lens has to get
  past it: steps over 0.25 m fell from 12.1 to 5.5 a minute on the tuning maps and 9.5 to 3.4 on the hold-out maps, but
  0.93 and 0.39 a minute are over a metre (0.01 and 0.00 before) and the largest are 4.3 and 7.6 m. Almost all of them
  are in the forest and the cave, for the larger Pokémon, whose arm is 8 m back and up to 4 m to the side. Half of the
  forest's are a deck's slab coming over a tall Pokémon's arm and lowering its pivot. In the browser stress scenes the
  largest one-frame lens move is 0.43 m in a 30 s badlands fight (0.44 before; the arm's length no longer changes there
  at all, against a range of 3.2 m), 0.77 m in a cave fight (0.73) and 2.78 m on a cave walk with an Extra Large (0.42).
  With nothing in the way at all,
  0.1 to 0.2 % of frames are still off the nominal size or shift the Pokémon: the tail of an arm easing back out, and
  the steps below. What would remove more: looking ahead of the arm sideways so that it shortens before rock reaches it
  (smoother, and the arm length then follows the surroundings), or a shorter arm for the two largest classes.
- **Decks.** Walking in under a 2.4 m deck or out from under it moves the lens up to 0.5 m in a frame (Tiny to Large),
  0.8 m looking 70° or more down, 1.0 m for an Extra Large (which does not fit under one).
- **Caves and the frame rate.** Where the arm is choosing between ways round rock, a millimetre of difference in where
  two frame rates sample the walk can pick another way for a moment. Both are clear poses and the paths rejoin: up to
  3.7 m apart, for 0.3 to 6 % of a cave walk and at most about a second at a time (1.5 m and 2.4 % on the shorter arms
  before the drawn-height law). On open ground they agree to centimetres.
- **Steps and the smallest sprites.** On the first frame of a 0.5 m step the 21 smallest sprites move against the lens
  (up to 0.16 m) because they take only part of the offset; Diglett is still drawn 60 % under the tile on that frame,
  and Diglett, Snom and Cutiefly over a third under it three frames later. The part under the tile shows as the cyan
  x-ray stipple. 1.2 % of a bot fight's casts are fired while the sprite is more than 0.15 m off the body (0.56 m at
  most). A frame at 30 fps spans two sim ticks: a step right next to a landing can be smoothed at one frame rate and
  not another.
- **The planar marker at close range.** `chaseAim` eases the sideways part in over 16 m, so with the wider shoulder the
  planar ring sits further inside the crosshair's ground point close to the Pokémon than it did.
- **The sprite's own size changes.** Facing follows movement and snaps to the aim on an attack, and rows and clips differ
  (0.9 to 3.0 × the idle back view's area, camera fixed). The camera does not cause it and does not hide it: Stage 6B.
- **The lens follows the Pokémon's own jolts.** A rigid camera shows the Pokémon's motion exactly: a dash start, a
  knockback or a wall stop moves the whole view in one frame. That is the intent (the Pokémon never moves in the frame),
  but how a knockback reads with no filtering at all is for the playtest; a short, aim-neutral presentation offset would
  be the remedy, not a lag.
- **The view does not widen for a fight.** Awareness of what is off screen is the threat ring's job, and turning the
  camera is the player's.
- **The dissolve** is a 4 × 4 ordered dither: on a sprite the lens is very close to it reads as stripes.
- Sprite edges still crawl by a pixel as the camera moves (nearest sampling at ~400 lines, no anti-aliasing): that is the
  pixel-art look, not a defect, but it reads as shimmer on high-contrast edges.
- **Not validated by hand.** Everything above comes from headless runs, scripted browser probes and screenshots (headless
  Chromium with software rendering) that were looked at frame by frame. Nobody has played this build with a mouse or a
  gamepad: feel (responsiveness, the framing, aiming past a close enemy, how steps and arm changes read, the dissolve)
  and real-GPU performance are unverified.

## Not in yet (next phases)
The hero-shooter migration (a 3D aim ray in the sim, attacks from the body, vertical combat, input buffering, shooter
facing, headroom under decks) is planned in `docs/THIRD_PERSON_IMPLEMENTATION.md`; the aim ray and body-launched 3D direct
shots landed in Phase 2B (its §13), beams in Phase 2C (its §14), player-owned free look in Phase 4A (its §16), the full
envelope in R3 (§19) and the overhaul to one rigid framing in §24; the other move families (strikes, cones, lobs, areas)
are still planar. This file stays canonical for the rig as built.

Rear-arc sim rules, compass, 3D audio (P1/P2); camera-relative sprite directions per creature with hysteresis, lock-on (P1);
terrain mesh from the tile grid, instanced grass with a trample texture, shadows, the 3D pilot (P3).

## Checks
`npm test` (includes `tests/camframe.test.ts`, `tests/camaim.test.ts`, `tests/camfollow.test.ts`, `tests/chase.test.ts`,
`tests/camstability.test.ts`, `tests/viewsample.test.ts`, `tests/freelook.test.ts`, `tests/lookinput.test.ts` and
`tests/settings.test.ts`), `npx tsx scripts/checksum.ts` (the camera never moves a hash), `npx tsx scripts/camframe.ts`,
`npx tsx scripts/camstats.ts --bench tuning`, `npx tsx scripts/camaim.ts --fight`, and
`node tools/cap.mjs <private build> tools/camframescenes.json out` (or `tools/chasecheck.json`) for third-person
captures. After a change to the rig, read the captured frames as well as the numbers: three of this pass's defects were
only in the frames.
