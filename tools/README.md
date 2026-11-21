# Verification tools

Headless-Chromium scripts used to check the build. Each takes the path to `dist/index.html` (or a private build: CLAUDE.md); they import `playwright`, which is not a project dependency: run `npm i --no-save playwright` first (the Python scripts in `tests/browser/` need Python's `playwright` package at the same version).

The merge check is `python3 -I tests/browser/range.py <html> <outdir>`: title, Training range, a featured hero, fire at a dummy and see its health drop, then Caterpie's Breakthrough on a held F, in capture mode, with screenshots; it exits 1 on any failed step or console error.

Scenes and tools from before the hero-shooter pivot were deleted at its merge check (the level-up, boss, card-tray, recruit, squad and swarm scenes, `menus.py`, `play.py`, `phase7scenes.json`, `squadscenes.json`, `traycheck.mjs`). A `go=1` query with no `loc` or `world` now starts the training range on the range arena.

| Script | What it checks |
|---|---|
| `cap.mjs <html> <scenes.json> <outdir> [filter]` | Deterministic screenshots of seeded scenes (`scenes.json` environment, `camscenes.json` camera presets, `uiscenes.json` menus, `anim.json` attack and faint strips) |
| `cap.mjs … chasescenes.json` | Third-person captures: explore (turned), combat (see docs/THIRD_PERSON.md) |
| `cap.mjs … chasecheck.json` | Third-person camera regression set: idle stability, turning, walking, sizes, combat, damage, cave, terraces, snow, under a deck; `stress-*` scenes measure elevation, frame steps and zoom over long fights, turns and cave walks in the page |
| `cap.mjs … camframescenes.json` | Third-person composition (docs/THIRD_PERSON.md "Composition"; written by `node tools/camframescenes.gen.mjs`): ten species on open ground idle, strafing, reversing, firing, hurt and looking up and down; four at 1280 × 720 with the move bar's box (the HUD is laid out in pixels: judge it there, not in the 640 × 360 scenes); a wall behind, beside and in a corner; a deck; forest and cave walks; frame strips across a 0.5 m step both ways; a target fired at. Every shot is followed by `pokewatch.renderer.subjectBox()`: the drawn frame's box on screen, its depth in the keep-out around the crosshair and its dissolve. A scene's `input` is in world axes, not the camera's |
| `cap.mjs … habplayscenes.json` | Habitat playtest frames (docs/HABITAT_PLAYTEST.md): third-person frames on wall-hugging ramps, causeways and tunnels (`cam-*`) and the vent warning from 3 and 8 tiles through dormant, warning and eruption (`vent-*`) |
| `cap.mjs … habscenes.json` | Habitat maps (docs/HABITATS.md): overview at the contest, third person at the shrine and the altar, spawns, the snow variant |
| `cap.mjs … cemeteryscenes.json` | Memorial Ridge (docs/HABITATS.md "Cemetery"): overview at the point, a headstone seen from the court side, a gate, the memorial, the spawn, the hollow variant |
| `cap.mjs … tidescenes.json` | Shoal Grotto's tide (docs/HABITATS.md "Tide"): overview at low and high water, a non-swimmer in the hall during the warning and at the flood, a Water type swimming the flooded hall |
| `cap.mjs … lagoonscenes.json` | Cascade Lagoon (docs/HABITATS.md "Lagoon"): the islet from above at seeds 1 and 3 (wide), the trainer on the raised bank and on the canopy path, the shore spawn, the dusk variant |
| `cap.mjs … sanctscenes.json` | Spear Sanctuary (docs/HABITATS.md "Sanctuary"): the court from above and from behind the trainer (plinth, landmark, columns), the foothill spawn, the platform stair, inside the gallery, on the balcony, the snow variant |
| `cap.mjs … sizescenes.json` | Visible size (docs/ART_BIBLE.md §4 "Visible size"): Rattata, Charmander, Charmeleon and Venusaur at one fixed camera, a wild row, and an authored-scale body (Sudowoodo). The `eval` steps print `pokewatch.renderer.sizes()` |
| `film.mjs <html> <outdir>` | Frame sequences for footage (combat, moving cast, a Breakthrough); assemble with ffmpeg |
| `navcheck.mjs <html>` | Keyboard and virtual-gamepad navigation through every screen (28 steps) |
| `audiocheck.mjs <html> <outdir> <phase>` | Records the mixer output: `cries`, `cryfix`, `music`, `play` (no synthesised effects: every music state is the adaptive score) |
| `musiccheck.mjs <html>` | Actual adaptive stem decoding, loop configuration, melody continuity through intensity changes, mixer, defeat and restart |
| `perf.mjs <html>` | Frame, render and sim-step timings. Its query still asks for the survivor's dense boss fight, so on hero-core it times the range; it needs a crowd before it measures anything again |
