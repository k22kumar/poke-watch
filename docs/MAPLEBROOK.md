# Maplebrook: overworld vertical slice

Maplebrook is a small town joined to a forest route, Fernwood Trail, with four interiors. It's built to look and feel like a late Nintendo DS 2.5D overworld, combining the cosy world design of handheld Pokémon adventures with the rendering style of the DS-era games. Every map, character, building and creature in it is original.

Build: `node scripts/build.mjs --overworld` produces `dist/overworld.html` (a single file, about 125 KB).

## Controls

| Action | Keys |
|---|---|
| Walk | Arrow keys or WASD (tap to turn in place) |
| Run | Hold X or Shift |
| Talk, read, advance text | Z, Space or Enter |
| Switch the partner that follows you | C |
| Gamepad | D-pad or stick to walk, A to talk, B to run |

There are no touch controls yet. A tap only dismisses the title card.

## Visual spec measured from the references

| Characteristic | Reference (DS-era Pokémon field and city screenshots, 256×192 shown at ≈2.93×) | Maplebrook |
|---|---|---|
| Native resolution | 256×192 per screen; every element on one pixel grid | Rendered at about 240 px tall, integer-scaled with nearest filtering |
| Tile and character scale | 16 px tiles; people ≈ 16×27 px (≈1.7 tiles) | 16 px tiles; people 16×27 px inside 24×32 cells; partners 16–24 px |
| Camera | Perspective, tilted, follows the player; BW changes angle at bridges and in cities | Perspective camera, 40° pitch, 32° FOV, locked to the player and snapped to the texel grid. Zones change the angle: low, rotated view on the bridge; steeper view at the shrine and indoors |
| Sprites | 1 px dark outlines, light from the top-left, 3–4 tone ramps | Painted in code with region shading and auto-outlining in the same style |
| Ground | Mint grass with small strokes; sand paths with olive borders and rounded corners | One painted ground texture per map, with smoothed tile masks giving rounded, outlined transitions |
| Trees | 2×2-tile tiered round conifers forming solid walls | Same 2×2 footprint, tiered canopy, olive outline; the forest continues past the map edges |
| Buildings | 3D walls and roofs with pixel textures | 3D boxes, gable or hip roofs with overhang, chimneys, awnings and signboards, all with painted pixel textures |
| Water | Bright blue animated tiles with stone banks | 4-frame animated water, bank faces, bridge with rails |
| Atmosphere | Dense props, flowers, NPCs | Flowers that sway, rustling tall grass, chimney smoke, wandering NPCs, signs, lamps, benches, a shrine gate and stone lanterns |

## Why the Poke-Watch renderer didn't fit, and what changed

| Problem in Poke-Watch's look | Kind | Fix in Maplebrook |
|---|---|---|
| High-resolution render with smooth geometry; sprites had a different pixel size from the world | Rendering | One low internal resolution, integer upscale, 16 texels per tile everywhere |
| Free analogue movement and an orbit camera | Gameplay and camera | 4-direction grid movement (0.25 s per tile, 0.125 s running), turn-on-tap, fixed camera with zones |
| Procedurally scattered props on a heightfield | Content | Hand-authored tile maps: paths, tree walls, buildings, elevation, ledges, stairs |
| Low-poly untextured props | Assets | Pixel-art billboards and pixel-textured 3D buildings |
| No people, follower, text box or doors | Features | Player, 10 NPC designs, a following partner, a DS-style text box, door and mat warps with fades, location plaques |

## Features included

The following were tested in a browser:

- Grid walking and running.
- Collisions with props, buildings, water and NPCs.
- Turning in place.
- A partner that follows on your trail. You can talk to it, and C swaps between six partners.
- NPCs that wander, pace or look around, and turn to face you when you talk to them.
- Signs and examinable objects.
- Doors that warp into four interiors (home, store, field lab, teahouse) and mats that warp back out.
- Locked-door messages.
- One-way ledges you hop down.
- Stone stairs up to a lookout plateau, and an elevated shrine terrace with cliff faces.
- A river crossed by a bridge, with a contextual camera angle.
- Tall grass that rustles, covers characters' legs and triggers encounters. An encounter shows a flash and bar-wipe transition, an "!" emote, a wild creature popping out, a text box, and the creature darting away.
- Area-name plaques when you cross from town to route.
- Chimney smoke, animated water and swaying flowers.
- Music that changes between areas.

## Remaining gaps against the reference feel

- No day/night cycle and no seasonal palettes.
- No touch controls.
- Interiors are single rooms with no second floors.
- Encounters don't lead into battles; Poke-Watch's combat isn't wired in.
- Buildings have no cast shadows on the ground. Characters and trees have blob shadows only.
- Frame rate on real GPUs wasn't measured. Testing used software rendering, where the slice runs in real time at 960×720.
