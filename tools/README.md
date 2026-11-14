# Verification tools

Headless-Chromium scripts used to check the build. Each takes the path to `dist/index.html`; they import `playwright`, which is not a project dependency: run `npm i --no-save playwright` first.

| Script | What it checks |
|---|---|
| `cap.mjs <html> <scenes.json> <outdir> [filter]` | Deterministic screenshots of seeded scenes (`scenes.json` environment, `camscenes.json` camera presets, `uiscenes.json` menus, `anim.json` attack and faint strips) |
| `cap.mjs … chasescenes.json` | Third-person captures: explore (turned), combat, boss pressure (see docs/THIRD_PERSON.md) |
| `cap.mjs … chasecheck.json` | Third-person camera regression set: idle stability, turning, walking, sizes, squad tag, combat, damage, boss, cave, terraces, snow, under a deck; `stress-*` scenes measure elevation, frame steps and zoom over long fights, turns and cave walks in the page |
| `cap.mjs … habplayscenes.json` | Habitat playtest frames (docs/HABITAT_PLAYTEST.md): third-person frames on wall-hugging ramps, causeways and tunnels (`cam-*`) and the vent warning from 3 and 8 tiles through dormant, warning and eruption (`vent-*`) |
| `cap.mjs … habscenes.json` | Habitat maps (docs/HABITATS.md): overview at the contest, third person at the shrine and the altar, spawns, the snow variant |
| `traycheck.mjs <html>` | The banked-pick tray clears on quit, restart and run end, and takes no picks while paused |
| `film.mjs <html> <outdir>` | Frame sequences for footage (combat, moving cast, boss, evolution); assemble with ffmpeg |
| `navcheck.mjs <html>` | Keyboard and virtual-gamepad navigation through every screen (27 steps) |
| `audiocheck.mjs <html> <phase> <outdir>` | Records the mixer output: `cries`, `cryfix`, `moves`, `music`, `loop`, `play` |
| `slotcheck.mjs <html>` | Licensed-recording slot looping, with a generated test tone |
| `perf.mjs <html>` | Frame, render and sim-step timings in a dense boss fight |
