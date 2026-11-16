# Verification tools

Headless-Chromium scripts used to check the build. Each takes the path to `dist/index.html`; they import `playwright`, which is not a project dependency: run `npm i --no-save playwright` first.

| Script | What it checks |
|---|---|
| `cap.mjs <html> <scenes.json> <outdir> [filter]` | Deterministic screenshots of seeded scenes (`scenes.json` environment, `camscenes.json` camera presets, `uiscenes.json` menus, `anim.json` attack and faint strips) |
| `cap.mjs … chasescenes.json` | Third-person captures: explore (turned), combat, boss pressure (see docs/THIRD_PERSON.md) |
| `cap.mjs … chasecheck.json` | Third-person camera regression set: idle stability, turning, walking, sizes, squad tag, combat, damage, boss, cave, terraces, snow, under a deck; `stress-*` scenes measure elevation, frame steps and zoom over long fights, turns and cave walks in the page |
| `cap.mjs … habplayscenes.json` | Habitat playtest frames (docs/HABITAT_PLAYTEST.md): third-person frames on wall-hugging ramps, causeways and tunnels (`cam-*`) and the vent warning from 3 and 8 tiles through dormant, warning and eruption (`vent-*`) |
| `cap.mjs … habscenes.json` | Habitat maps (docs/HABITATS.md): overview at the contest, third person at the shrine and the altar, spawns, the snow variant |
| `cap.mjs … cemeteryscenes.json` | Memorial Ridge (docs/HABITATS.md "Cemetery"): overview at the point, a headstone seen from the court side, a gate, the memorial, the spawn, the hollow variant |
| `cap.mjs … tidescenes.json` | Shoal Grotto's tide (docs/HABITATS.md "Tide"): overview at low and high water, a non-swimmer in the hall during the warning and at the flood, a Water type swimming the flooded hall |
| `cap.mjs … lagoonscenes.json` | Cascade Lagoon (docs/HABITATS.md "Lagoon"): the islet from above at seeds 1 and 3 (wide), the trainer on the raised bank and on the canopy path, the shore spawn, the dusk variant |
| `cap.mjs … sanctscenes.json` | Spear Sanctuary (docs/HABITATS.md "Sanctuary"): the court from above and from behind the trainer (plinth, landmark, columns), the foothill spawn, the platform stair, inside the gallery, on the balcony, the snow variant |
| `cap.mjs … sizescenes.json` | Visible size (docs/ART_BIBLE.md §4 "Visible size"): Rattata, Charmander, Charmeleon and Venusaur at one fixed camera, a wild row, a boss at its authored scale, and an evolution transition. The `eval` steps print `pokewatch.renderer.sizes()` |
| `traycheck.mjs <html>` | The banked-pick tray clears on quit, restart and run end, and takes no picks while paused |
| `film.mjs <html> <outdir>` | Frame sequences for footage (combat, moving cast, boss, evolution); assemble with ffmpeg |
| `navcheck.mjs <html>` | Keyboard and virtual-gamepad navigation through every screen (28 steps) |
| `audiocheck.mjs <html> <phase> <outdir>` | Records the mixer output: `cries`, `cryfix`, `moves`, `music`, `loop`, `play` |
| `slotcheck.mjs <html>` | Licensed-recording slot looping, with a generated test tone |
| `musiccheck.mjs <html>` | Actual adaptive stem decoding, loop configuration, melody continuity through intensity changes, mixer, defeat and restart |
| `perf.mjs <html>` | Frame, render and sim-step timings in a dense boss fight |
