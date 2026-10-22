# Third-person camera (Phase P0)

The default view is a camera behind the Pokémon that the player turns with the mouse or the right stick. It is a render-only
change: nothing under `src/sim` or `src/world` knows about it, and `scripts/checksum.ts` prints the same hashes as before.
The design behind the numbers is the "Third-Person Execution Blueprint".

## What is in
| Piece | Where |
|---|---|
| Rig: states, boom scaling, terrain collision, aim ray (pure maths, unit-tested) | `src/render/camera.ts`, `tests/chase.test.ts` |
| Camera branch, threat read, sky, fog, per-object billboard stretch, sprite direction relative to the camera | `src/render/renderer.ts`, `src/render/tilestage.ts`, `src/render/sky.ts` |
| Mouse capture (pointer lock), right-stick look, hint, pause when the browser releases the mouse | `src/input/input.ts`, `src/main.ts` |
| Settings: Camera (Third person / Classic / Overhead / Wide), Look speed, Invert look, Field of view | `src/ui/ui.ts` |

Classic, Overhead and Wide are unchanged and still pixel-locked (`?cam=wide`, or Settings → Camera). Settings saved before this
phase move to Third person once.

## Camera
- **States** (blend out to danger 0.4 s, back to calm 1.2 s, boom never faster than 6 m/s):

  | State | Pitch | Boom | FOV | Looks ahead | When |
  |---|---|---|---|---|---|
  | Explore | 20° | 6.5 m | 58° | 7 m | no hostile within 20 m for 3 s |
  | Combat | 30° | 8.5 m | 62° | 9 m | a hostile within 20 m |
  | Pressure | 34° | 10.5 m | 66° | 10 m | a boss within 25 m, or crowd weight ≥ 20 within 12 m (fodder 1, elite 3, alpha 4, boss 8) |
- **Player input:** mouse / right stick turn yaw (free) and pitch (−8°..+12° around the state's pitch). FOV offset −6 / 0 / +8 (setting).
- **Size:** boom × clamp((sprite height / 1.1 m)^0.6, 0.8, 1.45).
- **Collision:** terrain only for now. A 0.35 m capsule walks the boom; the boom shortens in 0.05 s and grows back over 0.4 s after
  0.25 s of clear air, never under 2 m. Trunks and cliffs-as-props are not in the collision yet (P1); the prop screen-door dither
  (props between the camera and the Pokémon) handles them visually.
- **Aim = camera.** The aim point is the reticle ray (44 % down the screen) against the terrain, kept in the camera's yaw plane,
  4–26 m from the Pokémon (about 12–15 m on flat ground). Move direction is camera-relative. The sim still receives an ordinary
  `aimX/aimZ`, so magnetism, Guard, Dash, Tag and every move work unchanged.
- **Facing:** the sim turns the Pokémon toward its movement direction (and to the aim while a move is winding up), as before.
  Whether it should face the camera while strafing is a Gate T question.

## Renderer changes that were needed
- No texel snapping, no integer-pixel focus distance; internal resolution is ~400 lines (preset `lines`), integer upscaled.
- Billboards (creatures, props) stretch by 1 / cos(elevation they are seen at) per object, so far props are not stretched.
- Sprite direction is chosen from the facing relative to the camera yaw (`dirIndex(facing − (yaw − π))`; identical at yaw π).
- Sky gradient, distance fog (per biome in `sky.ts`), mip-mapped + anisotropic terrain textures (sprites keep NEAREST), culling
  radius 74 m around a point 20 m ahead, ambient particles at 55 % size.
- The prop dither no longer assumes the camera is south of the player.

## Controls
Click the game once to capture the mouse (a hint shows until you do). Esc releases it and pauses; resuming recaptures it.
Right stick turns the camera. If the mouse is not captured, holding the right mouse button and dragging still turns the camera.

## Not in yet (next phases)
Rear-arc sim rules, threat ring, compass, 3D audio (P1/P2); camera-relative sprite directions per creature with hysteresis,
prop collision, lock-on (P1); terrain mesh from the tile grid, instanced grass with a trample texture, shadows, the 3D pilot (P3).

## Checks
`npm test` (includes `tests/chase.test.ts`), `npx tsx scripts/checksum.ts on` (must match the pre-change hashes), and
`node tools/cap.mjs dist/index.html tools/chasescenes.json out` for third-person captures.
