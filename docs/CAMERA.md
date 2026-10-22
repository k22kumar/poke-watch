# Camera comparison

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

## Decision

Default to **Wide** (49°, ~330 target lines, framed 2 m south). Classic and Overhead remain selectable in Settings for players who prefer bigger sprites, and `?cam=classic|steep|wide` selects one for testing. This choice comes from the measurements and seeded frames above, not from long playtests by players. Testing on real hardware with real players is still worth doing.
