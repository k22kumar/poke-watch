# Camera comparison

## Direction for the 3D camera (owner, 2026-11-25)

Recorded in the CL grilling (task CL, "Camera law"); the full text is docs/WORLDGEN3D.md Q15c, which amends Q15b and
Q15(g). For the camera:

- The presentation camera, the gameplay sight origin and line of sight, visual concealment, physical cover, the attack
  origin and trajectory, and body and collision geometry are separate systems kept geometrically consistent.
- The 0.60–1.35 m view band is **not** a gameplay visibility constraint. Gameplay sight origins come from each
  Pokémon's anatomy, orientation and posture (a per-species measurement table, defaults by size class, overridable).
  Larger Pokémon may naturally see over what blocks smaller ones.
- The camera may keep presentation rules (a height band among them), but it must give no information advantage:
  it must not show enemies through or over obstacles that conceal them from the gameplay sight origin. Camera peek
  is to be prevented.
- The band and the 1.45 m cover rung are provisional values, under review.

What CL settled (2026-11-25; answers CL-Q2 to CL-Q13 and their measurements are in docs/WORLDGEN3D.md, under Q15c):

- **Sight origin.** Every body has an anatomical eye from `src/rules/anatomy.ts` (defaults by official shape, as
  fractions of the sim height; species overrides are reviewed data). The sim never reads the art. It rides the feet,
  sits ahead along the crosshair's heading (capped at the footprint radius) and is pulled back to the axis by a wall
  and down under an overhang (CL-Q3, CL-Q6).
- **Lens height.** At the neutral pitch the lens is at the eye's height, with no cap; the floor is min(0.60, eye), so
  the lens is never above the eye. The band (0.60 / 1.35 m) stays only as rules values in its clamp function's test
  (CL-Q4, CL-Q5).
- **Distance.** D = 3.5 × the anatomy table's height inside 1.8–9.0 m, in the single framing source in `src/rules`
  (CL-Q8). Giants above 2.57 m frame at 9.0 m and lean on pull-in and fade. The generator reads the same source:
  `camera-clearance` ceiling 3.66 m, short side 10.18 m, tall-dressing keep-out 9.30 m.
- **Camera peek.** The shoulder offset and the orbit stay as today; an information gate draws enemy bodies and the
  signals declared "hidden by the world" only when the player's eye sees them (`eyeSees`, two thin rays, top and
  centre). Telegraphs and attacks aimed at the player, teammates and the player's own partner are never gated
  (CL-Q7). The eye is computed once per frame (`frameEye`), by the shot's own heading rule. Cost at about 500 enemies,
  a full pass: p95 0.70 ms on tiles, 1.09 ms on Rapier (`scripts/eyecost.ts`, every query counted); the proposed rate
  for I2b is in-view enemies only, staggered over 4 frames (a quarter pass p95 0.18 ms on tiles, 0.28 ms on Rapier).
- **Pull-in and fade.** I2b's. The generator leaves no room beyond the `camera-clearance` spaces and the transit rule;
  I2b reports the fade rate on G2's map (CL-Q9).
- **Shots** (behind `rules.aim.viewSight`, off until X1a): spatial shots and beams launch from the eye and are checked
  by their own sweep from it to the crosshair's point; a blocked shot fires and is shown blocked (CL-Q10, CL-Q11,
  CL-Q13).

The sections below describe the fixed views (the old renderer), which this direction does not change.

## The fixed views

These are the fixed views (Classic, Overhead, Wide), kept selectable in Settings → Camera. The default camera is the
third-person rig: `docs/THIRD_PERSON.md`.

Three presets were compared in the same seeded scenes (`tools/camscenes.json`, captured with `tools/cap.mjs`): a stage-1 swarm at 3:50, a jump next to a tree line, the Sudowoodo fight, and a forest-edge run. All presets keep the fixed north-up yaw, 16 px per metre and integer upscaling, so pixels stay stable.

| Preset | Pitch | Internal lines (720p) | Pixel scale (720p) | Visible metres N / S / E / W | Effective N / S (minus HUD bands) | Enemies on screen (same swarm) | 1 m jump on screen | Charmander height on screen | Ground hidden behind canopies |
|---|---|---|---|---|---|---|---|---|---|
| Classic (old default) | 47° | 240 | 3× | 15.3 / 7.5 / 13 / 14 | 10.8 / **6.0** | 28 | 32 px | 51 px | 5.2 % |
| Overhead | 56° | 240 | 3× | 12.5 / 7.0 / 13 / 14.3 | 9.0 / 5.5 | 27 | 26 px | 51 px | 5.2 % |
| **Wide (new default)** | 49° | 360 | 2× | 18.8 / 13.3 / 20.3 / 21.5 | 12.5 / **11.3** | 67 | 21 px | 34 px | 5.2 % |

Hidden-ground is the share of walkable tiles in the central 64 × 64 area that sit within a tree billboard's line-of-sight shadow (depth = canopy height / sin(pitch): 3.6 m, 3.2 m, 3.5 m). At tile granularity the steeper pitch doesn't change it.

## Observations

- **Warning distance.** Classic gave only 6 m of usable view to the south once the move bar is subtracted, about 1.3 s for an enemy at 4.5 m/s. Wide, with the look-at shifted 2 m toward the camera, gives 11 m south and 12.5 m north, and about 50 % more to each side.
- **Swarms.** In the same 3:50 swarm, Wide shows the whole Ledyba/Rattata front and the path around it; Classic shows the nearest third of it.
- **Legibility.** Wide draws Pokémon at 2× instead of 3× on a 720p window (3× instead of 4× at 1080p). All 32 species remain identifiable in the swarm and boss frames, but small ones (Zubat, Ledyba) lose some detail.
- **Jumps.** Steeper pitch shrinks the on-screen height of a jump (26 px per metre against 32 px). Wide is 21 px per metre because of the smaller pixel scale; the shadow staying on the ground keeps height readable.
- **Occlusion and comfort.** Pitch made little difference to occlusion. None of the presets rotate or zoom automatically; camera shake now has a Reduced/Off setting.

Prop heights (R1b, 2026-11-17): the comparison above predates wall tops. A wall prop now blocks bodies and the player's
shots up to its measured height (docs/SIZING.md "Wall tops"). The chase lens passes every prop, which dissolves around it
(the camera's second pass, 2026-11-18: docs/THIRD_PERSON.md "Clearance").
Billboard stretch and lean at steep views are presentation only: from above a canopy is drawn taller than the height that
blocks, and collision is never enlarged to match it.

## Decision

Default to **Wide** (49°, ~330 target lines, framed 2 m south). Classic and Overhead remain selectable in Settings for players who prefer bigger sprites, and `?cam=classic|steep|wide` selects one for testing. This choice comes from the measurements and seeded frames above, not from long playtests by players. Testing on real hardware with real players is still worth doing.
