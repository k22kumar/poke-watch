# Roadmap

The work queue and its status. One task per chat, on a branch off `main` (CLAUDE.md "Working with the owner"); each
task updates this file when it ends. Records of finished work stay in their own docs; this file points to them.

Status words: **done** (merged to `main`), **review** (on a branch, waiting for the owner), **next**, **queued**,
**decision** (blocked on an owner decision).

Started 2026-11-21 from the owner's queue and the open items of `docs/hero-shooter-pivot.md` §11, which is now a closed
record.

## Queue

| # | Task | Status | Notes |
|---|---|---|---|
| 1 | Housekeeping | done | `chore/housekeeping` (`df5c465`, `4571d2d`): this file, CLAUDE.md "Working with the owner", P7, P2(a). |
| 2 | P5: the live stutter and real-GPU frame time | done | `perf/stutter`. **Cause: not our code.** The owner's Chrome trace: every mousedown ran Ghostery's content script `whotracksme.js` for 325–363 ms (4 of 4 clicks); held fire, with no new mousedowns, was smooth. The script listens at window (bubble phase) and serialises the `innerHTML` of the clicked element's three nearest ancestors; on the canvas that reaches `<body>`, which holds the inline 26 MB script, and sends the string to the extension. Fix: while the pointer is locked, game clicks are handled at window in the capture phase and stop there (`e577720`; forced on, Ghostery loaded: 0 ms per click, was 103–132 ms). Unlocked clicks on the canvas (the capturing click, every click in the fixed views) paid it too until F13 (done). Also: the `?perf=1` overlay and `tools/stutter.mjs` (`ddf0b8b`), a session long-task count in the overlay (`cb6cd4e`), no per-prop garbage in `TileStage.draw` (`99d4650`). Mouse-look smoothing parked (F14). `tools/perf.mjs` still has no crowd to time (F8). |
| 3 | A1: Pokémon art outside the HTML | done | `perf/a1-art`: `dist/index.html` 26.7 MB → 1.43 MB. Plan and results: "Item 3: A1 plan" below (it replaces `docs/size-extremes-plan.md` "Proposed stage A1", written for the survivor game). `dist/index.html` was 26.7 MB. **Second reason** (2026-11-21, item 2): an extension that reads the page's HTML pays for its size. Ghostery's per-click cost scaled with it: 26.7 MB → 110–130 ms, 14.6 MB (art.json stubbed) → 61–73 ms, 1.5 MB (art and mp3 stubbed) → 6–9 ms in Playwright Chromium here (about 4.6 ms per MB; the owner's Chrome is about 3× slower), and 25 MB of inert text in `<body>` reproduced it, so it is the DOM text, not the script's parse. |
| 4 | P2b: sim determinism | queued | The 8 sim and rules call sites on the allow-list (`tests/worldgen.test.ts`): `Math.hypot` in `sim/bot.ts`, `sim/spatial.ts`, `sim/targets.ts`, `sim/world.ts`; `Math.tan` in `sim/moves.ts`; `Math.log` ×2 and a non-literal `**` in `rules/sizing.ts`. Also F11: every `x ** 2` (111 sites) becomes `x * x`, and the guard counts `** 2` from then on. Moves replay hashes: a planned re-record. |
| 5 | T2 planning: P1 and P6 | queued | **P1**: per-player systems, and teams in damage (today one player, one enemy side). **P6**: spikes and navigation faults on the Hold maps (F1, F2). Also F12: hero bots must not see through wall corners. |
| 6 | The next `HAB_VERSION` bump | queued | Two parts in one bump, with `docs/habaudit/baseline.json` regenerated: the navigation profiles (F3), and P2c, the 68 habitat-generator `Math` call sites on the allow-list (`world/habitat/`: landforms 33, dress 9, families 9, sanctuary-checks 5, validate 5, graves 2, index 2, ruins 2, lagoon 1). |
| 7 | T1 co-op wave, T2 3v3, exp → Candy, the dream shop | queued | T1 takes the navigation faults it pays for (F1) and Hold balance (F4); T2 needs item 5 first. |

Done before this file: the hero-shooter pivot (`docs/hero-shooter-pivot.md`, merged `ad0cdc7`); pointer-lock request
handling, which unblocked the Pages deploy (`da19699`).

## Item 3: A1 plan (2026-11-22)

For the hero shooter. It replaces `docs/size-extremes-plan.md` "Proposed stage A1", whose loader keyed on stages,
spawn tables, elites, bosses, recruits and regions (all deleted at the pivot). Owner decisions, 2026-11-22: no
single-file variant; the hero pick is one portrait sheet fetched at boot, nothing inlined; the dev roster's "All
Pokémon" portraits load as rows scroll into view; a match starts only when its art has loaded; cries may load on first
use.

1. **Build.** `scripts/build.mjs` writes `dist/art/` from `src/content/art.json`, every name content-hashed: per species
   the atlas PNG, a frame table (JSON), the portrait PNG and the cry (OGG and its MP3 transcode); `heroes.<hash>.png`,
   one sheet of every `PROTOTYPE` portrait; `manifest.<hash>.json`, with each species' file names, credits, licences,
   cry facts and the clip report the Credits table shows. The bundle is given the manifest's and the sheet's names at
   build time. `dist/poke-watch-artifact.html` is no longer written.
2. **Boot.** The manifest and the hero sheet, fetched together. The title and the hero pick need nothing else. Cries
   are registered with their file names and fetched and decoded on first use.
3. **Match.** `startRun` builds the run as today (the pointer lock is still asked for inside the Start click); the sim
   does not step until the match's art has loaded, behind a short loading line. The set comes from the run itself
   (`matchArt`, `src/sim/matchart.ts`, runs in Node): every squad member's whole line, the run's target set, and the
   Raid party's species when the mode holds a point. A test plays the range and a Hold and checks that every species
   that appears, and every form a Breakthrough reaches, is in the set.
4. **Placeholders** only for a species nothing can know in advance (`pokewatch.spawn` and other dev parameters): it
   draws as a placeholder of its size class while its art loads on first sight.
5. **Dev roster.** Each "All Pokémon" row fetches its portrait when it scrolls into view. Its art check reads the
   manifest, not the loaded art.
6. **Music.** The adaptive score's seven MP3s (9.9 MB, about 13 MB as data URLs) leave the page too, as `dist/music/`
   files: the 3 MB budget cannot hold with them inline. They were already fetched and decoded after the audio unlock.
7. **Unchanged.** The sim (no replay hash moves), Node tests and scripts (they keep reading `src/content/art.json`), the
   content build.
8. **Tools.** The page fetches its art, so it no longer runs from `file://` in a plain browser. The tools that open
   `file://` launch Chromium with `--allow-file-access-from-files`. `pokewatch.ready` waits for a `?go=1` match's art,
   and `pokewatch.loading` is true while art is in flight (`cap.mjs` and `range.py` wait on it).
9. **Gates.** `dist/index.html` ≤ 3 MB (the build fails above it); the Pages workflow stages `dist/art/` and
   `dist/music/`; capture parity (the same frames with inline and loaded art); boot-to-title and pick-to-play before
   and after; the Ghostery click cost before and after; no replay hash moves; `range.py` passes.

**Results (2026-11-22, `perf/a1-art`).** `dist/index.html` 1,425 KB (was 26,040 KB); `dist/art/` 976 files,
9.4 MB; `dist/music/` 7 files, 9.9 MB. Beyond the plan: the title's backdrop run draws Charmander, so boot also loads
that one species; the hero pick prefetches the picked hero's line and the mode's species (Start still waits for the
run's real set); the score's MP3s are fetched one at a time at low priority, so they do not crowd out a match's art;
`node scripts/build.mjs --out <dir>` replaces copying the build script for private builds (its art writer is a sibling
module).

| Gate | Before (`main`, `e72ded5`) | After |
|---|---|---|
| Page size | 26.7 MB, 1 request | 1.43 MB; boot fetches 1.77 MB in 6 requests (manifest 242 KB, hero sheet) |
| Boot to title, local http (median of 5) | 1,302 ms | 596 ms |
| Boot to title, 20 Mbps / 40 ms (median of 3) | 12,072 ms | 1,422 ms |
| Pick to play, local, Start 1.5 s after the pick opens | 368 ms | 430 ms (the score still downloading and decoding in the background) |
| Pick to play, local, Start after 6 s | 377 ms | 392 ms |
| Pick to play, 20 Mbps / 40 ms | 365 ms | 435 ms (1,150 ms before the score's fetches were serialised) |
| Ghostery, canvas clicks (`?go=1`, 6) | 0 ms each, no long task | 0 ms each, no long task |
| Ghostery, title clicks (4) | first click 192 ms long task | first click 144 ms long task; without the extension 175 → 134 ms: the game's own first click (audio unlock), not Ghostery |
| Capture parity, 19 scenes, 60 game-canvas frames | | 60/60 identical (a second `main` run: 60/60) |
| Capture parity, 128 page screenshots | | 114 identical; the rest are the camframe `open-*` scenes and one Breakthrough banner, which differ between two runs of the same `main` build too (CSS fades and slides on wall-clock time) |
| Replay hashes | | 10/10 as recorded |
| `range.py` | PASS | PASS (Snorlax dummy 320.9 → 163.9 in both) |

The Ghostery stall itself was already gone after F13; A1 does not change the canvas-click cost.

After the owner's review: a species whose fetch failed is fetched again on the next `ensure()` (a match start, a hero
pick), once per call; first sight does not retry (`tests/loader.test.ts`). F18 closed. Deferring the score was
measured and declined (F19).

## Open follow-ups

From `docs/hero-shooter-pivot.md` §11 unless marked. The queue item each belongs to is in brackets.

### Navigation and performance

- **F1. Enemy stuckwatch episodes: 31 over 217 415 enemy-seconds** [T1, P6]. Navigation, not the crowd's placement
  (pivot §11 "Before step 10"): small walkers jam in a staircase-wall notch on Viridian Forest seed 1 (15); walkers at
  the ledge lip above River Gorge seed 3's pocket, the same fault that TRAPs the player 3 times at (−28.6, 16.4) (9);
  the wide field against `moveBody` at a prop corner on Volcanic Ridge seed 3 (1); six single walkers elsewhere.
  Logged, not fixed; `stuckwatch` not re-baselined.
- **F2. perf-sim spike on Totodile seed 1** [P6, before T1's crowd]: ticks up to 18 ms after about 199 s,
  deterministic. The exposure system's pond shore search for enemies knocked into the pond. Within the gate's p95 / p99;
  cache or bound the shore search.
- **F3. 54 `ready` species exceed the frozen habitat profiles** (footprint 0.88 m, eye 1.42 m: Onix, Lugia,
  Wailord…) [6]. Making one a hero re-measures `profilesFor`, which moves accepted layouts.

### Balance and design

- **F4. Hold is easy for a ranged hero** since the Bulwark went (Charmander's mean damage taken 60 → 10, lowest health
  171 of 208); every `rules.enemy.behaviourHp` is 1 [T1 or T2].
- **F5. Kit tuning**: `KIT_TUNING` logs Bagon, Graveler, Golem, Magneton, Magnezone and Diglett beside `HERO_KITS`
  [no slot yet].
- **F6. How a Breakthrough chooses a branch** [decision]. Snorunt, Tyrogue, Nincada, Applin, Cosmoem and Sneasel have
  more than one next form, so none is linked and no branching line is a hero. Options: a choice at the Breakthrough, a
  rule by stat or form, or one authored branch per line.

### Tools and dead paths

- **F7. Scene files after the bare-`?go=1` change** [no slot yet]: a bare `?go=1` opens the range arena, so scene
  files whose queries name no map capture the arena, and many still carry dead parameters (`calm`, `level`,
  `autopick`).
- **F8. `tools/perf.mjs` and the `play` phase of `tools/audiocheck.mjs` need a map with a crowd** [2, T1]. Their URLs
  ask for the survivor boss fight, which now opens the training range: their numbers are not comparable with the
  survivor build's. Needs T1's wave or a dev parameter that runs `scripts/lib/crowd.ts` in the page.
- **F9. Survivor leftovers with one caller each** [no slot yet]: `audio.boss()`, `portal()` and `pickup()` (the
  Maplebrook overworld calls them), `onBossSpawn` and the `boss` music state (`tools/musiccheck.mjs` drives the climax
  through it), and the `learn`, `stageStart` and `chest` events (one emitter each).

### Found in P5 (2026-11-21)

- **F13. Unlocked clicks paid the Ghostery stall too** [2] — **done** (2026-11-21, `perf/stutter`). The capturing click and every click in the fixed views (no lock) target the canvas, whose third ancestor is `<body>`. The inline `<script>` now removes itself at the end of its synchronous start (`index.html`: `document.currentScript?.remove()` after the bundle, so the bundle's `"use strict"` stays first; the engine keeps the source). Nothing reads the element: no `currentScript`, `document.scripts`, script query or page serialisation in `src`, `tools`, `tests`, `scripts` or the bundle; the deploy copies `dist/index.html` only. With Ghostery, 26.7 MB page: unlocked canvas clicks 0–1 ms (were 103–132 ms), the capturing click no long task (was 121 ms), locked clicks 0 ms (as with the window-capture fix alone). Title-menu buttons never reached `<body>` within three ancestors: 0 ms before and after.
- **F14. Mouse-look gaps** [2, parked by the owner]: the overlay's "mouse look gaps" (a frame with no look movement while the mouse moves) read as judder. A timestamp-based look resampler would add up to a frame of latency; an owner decision, parked.

### Found in A1 (2026-11-22)

- **F15. Page screenshots are not repeatable** [tools, no slot yet]: two `cap.mjs` runs of the same build differ in the
  camframe `open-*` scenes and in DOM layers animated on wall-clock time (the map plaque's slide, the hurt vignette, the
  Breakthrough banner, the HP bar's transition). The game canvas is repeatable (`raw` steps: 60/60). Parity checks
  should compare `raw` frames, or capture mode should freeze CSS animations.
- **F16. The art manifest is 242 KB** [no slot yet]: every species' provenance (SHA-256 per source file, fetch date)
  rides in it for the Credits screen's checksum column. It could move to a second file fetched by the Credits screen.
- **F17. Cries are OGG only** [pre-existing, no slot yet]: the bundle carries no MP3 transcodes (docs/ASSETS.md), so a
  browser without Vorbis (Safari) plays no cries. Unchanged by A1.
- **F18. No Python `playwright` on this machine** — **done** (2026-11-22): `tests/browser/requirements.txt` pins
  `playwright==1.65.0`; setup in `tools/README.md` "Python checks" (a gitignored `.venv`).
- **F19. Fetch the score after the first match's art?** — **declined** (owner, 2026-11-22): about 40 ms of pick to play
  is not worth silent menus; the music keeps playing on the title and hero pick. Measured on `perf/a1-art` (Start 1.5 s after the
  pick opens, same session): pick to play local 445 → 409 ms, 20 Mbps / 40 ms 430 → 391 ms (`main`: 368 / 365). The
  cost: the title and hero pick are silent until the first match starts, and `tools/musiccheck.mjs`, which waits for
  the score on the title, would need to start a match. Not applied. The change is small: `Audio.unlock` creates the
  player but loads it only after an `allowScore()` that `main.ts loadMatchArt` calls once a match's art is in.

### Found in housekeeping (2026-11-21)

- **F10. The determinism allow-list** (`tests/worldgen.test.ts`): 76 maths call sites (75 `Math.*`, one `**` with a
  non-literal exponent) and 8 timing clocks, per file and function. It may shrink, not grow. P2b and P2c empty it.
- **F11. `x ** 2`** appears 111 times in the same scope. It is allowed: engines compute an integer-literal power
  exactly in practice, but the spec leaves `**` implementation-approximated like `Math.pow` [4]. Owner, 2026-11-21:
  P2b replaces all 111 with `x * x`, and the guard counts `** 2` from then on.
- **F12. The one `todo` test** (`tests/spatial.test.ts`, "World.sight (I2)"): the 0.5 m sampled sight line sees
  through a wall corner. Its note names Stage 7A (enemy line of fire on `segmentClear`, enemy hashes migrated once)
  [5]. Owner, 2026-11-21: part of T2 planning; hero bots must not see through wall corners.

Closed in §11 since it was written: Hold off the title (`81e7050`), the empty title plaque (`03f7d4b`), the dead
survivor event paths (`5b6fcde`), the survivor scenes (Q45, `dacdda8`), the elite, alpha, boss and stampede roles
(`22e6f2a`).
