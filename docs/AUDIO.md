# Audio

How Poke-Watch sounds, where each sound comes from, and what has and hasn't been verified.

**Hero-shooter pivot (2026-11-19, `docs/hero-shooter-pivot.md` Q51).** Only recordings play now. The adaptive score plays every music state, and nothing plays before it loads. The generated chip-tune score (`src/audio/music.ts`, `TrackPlayer`), the licensed-recording slots (`content/music/manifest.json` → `src/content/music.json`) and every synthesised sound effect (`src/audio/sfx.ts`: move, hit and UI sounds) are deleted, along with the synthesised fallback voice for a species without a cry. Combat and UI are silent until recorded sounds are added. `Audio`'s cue methods (`impact`, `hurt`, `dash`, `uiConfirm`, …) stay as the silent hook points those recordings plug into. The mixer buses and volume settings are unchanged. The deleted systems are documented as they were at the `survivor-final` tag.

## Coverage

| Area | Authentic recordings | Adapted | Original to Poke-Watch | Gap |
|---|---|---|---|---|
| Pokémon cries | Latest-available cries from PokeAPI/cries (OGG Vorbis) | Each cry is also stored as an MP3 transcode (ffmpeg) for browsers that can't decode Vorbis; loudness is normalised per cry at load | None | A species with no recording, or whose files both fail to decode, is silent |
| Move and hit sounds | None | None | None | **Silent** until recorded sounds are added |
| Music | Trainer Battle (1997–1998-M56B) reference recording retained as the melodic anchor | Adaptive percussion remix prototype; four synchronized layers and resolution cues | Synthesized added percussion in the stems | Full Tamil cinematic reorchestration and listening approval remain unfinished |
| UI, pickups, alarms | None | None | None | **Silent** until recorded sounds are added |

"Verified" in this document means measured in a recording of the game's own output (the mixer's `captureStream`, through headless Chromium), not that a person listened to it. Recordings are in `shots/audio/` of the working folder (`cries`, `cryfix`, `music`, `play`; the older `moves` and `loop` recordings predate the pivot; `.webm` and `.wav`, with a `.json` of timed labels and bus meters).

## Cries

### Era audit

PokeAPI/cries offers legacy and latest recordings. Both were measured for 38 of the 40 Pokémon with ffmpeg `volumedetect`; Joltik and Onix were imported on a machine without ffmpeg, so they ship their latest OGG recording with no measured loudness and no MP3 fallback (`npm run content` on a machine with ffmpeg fills both in).

| | Legacy | Latest |
|---|---|---|
| Format | Vorbis, 10 512 Hz | Vorbis, 32 728 Hz |
| Median mean loudness | −11.1 dB (range −13.1 to −10.3) | −10.4 dB (range −15.7 to −7.7) |
| Median length | 0.78 s | 0.94 s |
| Coverage of the roster | 38 / 38 | 38 / 38 |

**Decision: latest.** These are the most recent available official game recordings and bring the current sound identity into the roster. The measured legacy set is more consistent in loudness (a 2.8 dB spread against 8 dB) and shorter, which matters when several play close together in a swarm; the mixer normalises loudness and limits overlapping cries. The importer falls back to the alternate recording per Pokémon and records which one it used (`cry.era` in `art.json`, shown on the Credits screen).

<details><summary>Per-Pokémon measurements (mean dB / length)</summary>

| Pokémon | Dex | Legacy | Latest |
|---|---|---|---|
| Bulbasaur | 1 | -12.3 / 0.78 s | -11.6 / 0.94 s |
| Ivysaur | 2 | -10.3 / 0.78 s | -11.0 / 0.88 s |
| Venusaur | 3 | -10.4 / 0.91 s | -10.1 / 1.06 s |
| Charmander | 4 | -10.9 / 0.68 s | -8.4 / 0.72 s |
| Charmeleon | 5 | -10.6 / 0.68 s | -10.3 / 1.0 s |
| Charizard | 6 | -10.7 / 0.91 s | -7.7 / 1.0 s |
| Squirtle | 7 | -10.6 / 0.68 s | -8.6 / 0.88 s |
| Wartortle | 8 | -10.6 / 0.81 s | -10.0 / 1.0 s |
| Blastoise | 9 | -10.5 / 0.91 s | -7.9 / 1.1 s |
| Chikorita | 152 | -10.7 / 0.24 s | -12.3 / 0.41 s |
| Bayleef | 153 | -10.8 / 0.41 s | -10.7 / 0.56 s |
| Meganium | 154 | -10.8 / 0.76 s | -8.1 / 0.94 s |
| Cyndaquil | 155 | -12.3 / 0.33 s | -10.6 / 0.47 s |
| Quilava | 156 | -12.3 / 0.56 s | -10.7 / 0.84 s |
| Typhlosion | 157 | -11.4 / 1.79 s | -8.8 / 1.88 s |
| Totodile | 158 | -12.0 / 0.86 s | -10.6 / 0.94 s |
| Croconaw | 159 | -12.1 / 0.95 s | -10.7 / 1.19 s |
| Feraligatr | 160 | -11.2 / 1.2 s | -9.2 / 1.66 s |
| Rattata | 19 | -12.2 / 0.37 s | -11.4 / 0.44 s |
| Geodude | 74 | -11.1 / 1.12 s | -9.2 / 1.35 s |
| Ledyba | 165 | -11.0 / 0.33 s | -12.4 / 0.41 s |
| Sandshrew | 27 | -10.8 / 0.44 s | -10.5 / 0.56 s |
| Oddish | 43 | -12.1 / 0.69 s | -15.7 / 0.88 s |
| Poliwag | 60 | -12.6 / 0.52 s | -12.3 / 0.66 s |
| Slugma | 218 | -13.1 / 0.8 s | -9.6 / 0.97 s |
| Vulpix | 37 | -11.8 / 1.12 s | -9.1 / 1.25 s |
| Mareep | 179 | -11.0 / 0.34 s | -11.7 / 0.53 s |
| Delibird | 225 | -11.1 / 0.76 s | -9.1 / 0.75 s |
| Swinub | 220 | -13.0 / 0.59 s | -11.4 / 0.75 s |
| Zubat | 41 | -10.7 / 0.91 s | -11.5 / 1.0 s |
| Gastly | 92 | -10.9 / 1.1 s | -11.9 / 1.38 s |
| Paras | 46 | -10.8 / 1.32 s | -14.2 / 1.5 s |
| Houndour | 228 | -12.9 / 0.59 s | -9.0 / 0.75 s |
| Heracross | 214 | -11.2 / 0.86 s | -8.6 / 0.91 s |
| Sudowoodo | 185 | -10.6 / 0.76 s | -9.3 / 0.84 s |
| Magcargo | 219 | -11.3 / 0.99 s | -9.6 / 1.06 s |
| Articuno | 144 | -11.6 / 1.11 s | -11.0 / 1.35 s |
| Houndoom | 229 | -11.9 / 0.93 s | -8.0 / 1.1 s |
</details>

### Pitch

Cries play at their recorded pitch except on a KO:

| Moment | Pitch | Why |
|---|---|---|
| Your Pokémon fainting | 0.85 | A short, audible "falling" version, used only on a KO |

Cries mark moments: choosing a hero, the start of a match, a Breakthrough (the old form, then the new) and your Pokémon fainting. The survivor build's level-up and boss cries went with those systems at pivot step 9. Wild Pokémon don't cry in combat; at swarm density that would bury every other sound.

### Playback fixes (`src/assets/cries.ts`)

- **First play.** Cries decode on first use. A request made while decoding is now queued and plays when the buffer is ready, unless it is more than 0.6 s late or a newer request replaced it. (Before, the first request was dropped.)
- **Failed decode.** The OGG is tried first, then the MP3. If both fail, the cry is marked `failed` and the Pokémon is silent. There is no synthesised fallback voice (Q51).
- **No recording.** A species with no cry is not registered and is silent (`status` `none`).
- **Status.** `cries.status(id)` returns `idle`, `pending`, `ready`, `failed` or `none`; `cries.stats` counts plays, queued, played from queue, dropped and failures.
- **Swarm limit.** At most 3 cries at once; extras are skipped. Each cry ducks the music to 55 % for its length.

Verified (`cryfix` recording, before the pivot): four requests before decoding finished → four queued, four played from the queue; a deliberately broken cry then played the fallback voice that Q51 removed (it is now silent); all 38 real cries played from OGG and peaked around −20 dBFS on the cry bus.

## Sound effects

None. The synthesised move, hit, UI, level-up, pickup and alarm sounds were removed in the pivot (Q51); the per-move mapping table and swarm-mix rules are in `docs/AUDIO.md` at the `survivor-final` tag. The cue methods on `Audio` are where recorded sounds will plug in; the Effects bus and its compressor stay for them.

## Music

### Default adaptive reference remix

The game now loads the four local stems in `content/music/adaptive/`, using the source selected by the user: [Trainer Battle (1997–1998-M56B)](https://www.youtube.com/watch?v=4ZrdWpWqVpQ). The original recorded mix retains the lead at its original pitch and timing. Added synthesized percussion builds through anticipation, combat, surge and climax. This is a **prototype reference remix, not a finished reorchestration or isolated melody transcription**.

See [the score notes](../content/music/adaptive/README.md) for files, thresholds, limitations and reproduction. `src/audio/adaptive.ts` controls the shared sample clock, inferred bar boundaries, gain ramps and end cues. `src/audio/audio.ts` connects it to combat, health, objectives, bosses, pause, mute, ducking and the existing mixer. The default score works offline and has no YouTube player. If the stems can't load, the music stays silent: there is no fallback score.

### What plays

Every music state plays the adaptive score. Nothing plays before the score has loaded.

| State | Score |
|---|---|
| Title, select, exploring | The score director's intensity (anticipation → combat → surge → climax), driven by the fight around the player: enemies near, health, objectives. Range targets are ordinary enemies, so they drive combat and surge |
| Battle | Combat |
| Boss | Climax. With bosses removed from the hero shooter, nothing reaches it in the range (Q47); a match-intensity input comes with the 3v3 |
| Evolution | The current intensity; the end of an evolution plays the accent cue |
| Victory, defeat | The victory and defeat cues; an item ball plays the accent cue |
| Pause | The current score, low-passed to 900 Hz at 45 % volume |

### Director (`src/audio/audio.ts`)

- The music state changes immediately, and the adaptive player moves to the new intensity on its next bar boundary (`src/audio/adaptive.ts`).
- Evolution returns to whatever state was playing before.
- `Audio.log` keeps the last 60 state changes with their reasons.

## Mixing

| Bus | Default | Notes |
|---|---|---|
| Master | 80 % | Then a compressor (−20 dB, 4:1) and a limiter (−4 dB, 20:1) |
| Music | 55 % | Ducked under cries (55 %) |
| Effects | 80 % | Silent until recorded sounds are added; its compressor stays for them |
| Cries | 85 % | 3 voices at most |

Settings has a slider for each bus, mute (M), a preview button next to each slider, and a reset button. Settings persist in browser storage where it's available.

## Not verified

- Listening on real speakers and headphones. Levels were measured; the balance hasn't been judged by ear.
- The Safari path: Safari can't decode Vorbis, so it should take the MP3 copy. The code path is covered by the cry test, but it hasn't been run in Safari.
- Long sessions. The longest recording is 100 s; memory and voice behaviour over a 30-minute run weren't measured.
