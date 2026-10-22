# Audio

How Poke-Watch sounds, where each sound comes from, and what has and hasn't been verified.

## Coverage

| Area | Authentic recordings | Adapted | Original to Poke-Watch | Gap |
|---|---|---|---|---|
| Pokémon cries (38) | 38 legacy-era cries from PokeAPI/cries (OGG Vorbis) | Each cry is also stored as an MP3 transcode (ffmpeg) for browsers that can't decode Vorbis; loudness is normalised per cry at load | Synthesised fallback voice per species, used only when both files fail to decode | None |
| Move sounds (112) | None | None | Every move: a type material, an attack-shape motion and, for 38 moves, a dedicated signature layer (table below) | **No authentic HGSS move SFX.** No licensable source was available; the original set is a stand-in |
| Music (8 loops, 4 stingers) | None | None | Original chiptune score written for Poke-Watch, played by an in-game sequencer | **No HGSS soundtrack.** It isn't licensable for this project; the music slots below take recordings you have rights to |
| UI, level-up, pickups, boss alarm | None | None | Synthesised | None |

"Verified" in this document means measured in a recording of the game's own output (the mixer's `captureStream`, through headless Chromium), not that a person listened to it. Recordings are in `shots/audio/` of the working folder (`cries`, `cryfix`, `moves`, `music`, `loop`, `play`; `.webm` and `.wav`, with a `.json` of timed labels and bus meters).

## Cries

### Era audit

PokeAPI/cries offers two sets: `legacy` (the original Game Boy–era cries as heard in HGSS) and `latest` (the remastered cries from Gen VI onward). Both were measured for all 38 Pokémon with ffmpeg `volumedetect`.

| | Legacy | Latest |
|---|---|---|
| Format | Vorbis, 10 512 Hz | Vorbis, 32 728 Hz |
| Median mean loudness | −11.1 dB (range −13.1 to −10.3) | −10.4 dB (range −15.7 to −7.7) |
| Median length | 0.78 s | 0.94 s |
| Coverage of the roster | 38 / 38 | 38 / 38 |

**Decision: legacy.** HGSS used the legacy cries, so they match the reference era. They're also more consistent in loudness (a 2.8 dB spread against 8 dB) and shorter, which matters when several play close together in a swarm. Set `"cryEra": "latest"` in `content/roster.json` and run `npm run content` to switch; the importer falls back to the other era per Pokémon and records which one it used (`cry.era` in `art.json`, shown on the Credits screen).

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
| Boss arrival | 1.0 (was lowered before) | Lowering made the cries muddy at 10.5 kHz and less recognisable; size comes from the drawn scale and the alarm under it |
| Your Pokémon fainting, a boss fainting | 0.85 | A short, audible "falling" version, used only on a KO |

Cries mark moments: choosing a partner, the start of a run, level-ups (at most one every 2 s), evolution (the old form, then the new), a boss arriving and a boss or your Pokémon fainting. Wild Pokémon don't cry in combat; at swarm density that would bury every other sound.

### Playback fixes (`src/assets/cries.ts`)

- **First play.** Cries decode on first use. A request made while decoding is now queued and plays when the buffer is ready, unless it is more than 0.6 s late or a newer request replaced it. (Before, the first request was dropped.)
- **Failed decode.** The OGG is tried first, then the MP3. If both fail, the species' synthesised voice plays and the cry is marked `fallback`. (Before, a failed decode left the Pokémon silent.)
- **Status.** `cries.status(id)` returns `pending`, `ready`, `fallback` or `missing`; `cries.stats` counts plays, queued, played from queue, dropped and fallbacks.
- **Swarm limit.** At most 3 cries at once; extras are skipped. Each cry ducks the music to 55 % for its length.

Verified (`cryfix` recording): four requests before decoding finished → four queued, four played from the queue; a deliberately broken cry played the fallback voice; all 38 real cries played from OGG and peaked around −20 dBFS on the cry bus.

## Move sounds (`src/audio/sfx.ts`)

Every move resolves to an explicit `MOVE_SFX` record, exported for tests and listed below. A move's sound is built from:

- **Material** (from its type): the timbre of the charge, release and impact. Fire is filtered noise with crackle, Water bubbly band-passed noise, Electric buzzing sawtooth with sparks, and so on for all 18 types.
- **Motion** (from its attack shape): how the release unfolds. Strikes are one short swish, barrages repeat, beams and cones sustain, novas and charges wind up first.
- **Signature** (38 moves): an extra layer for moves that need to be recognisable on their own, such as Ember's crackle, Bubble's pops and Hydro Pump's roar.

Impacts of the same type within 40 ms are merged into one louder hit, so 30 Embers landing at once don't stack into noise. Super-effective hits rise in pitch with a bright tick, resisted hits drop, critical hits add a crack, and immune hits make a dull blip.

### Swarm mix

| Rule | Value |
|---|---|
| Voices on the Effects bus | 26 at most |
| Priorities | 4: player hurt, level-up, boss alarm, UI · 3: your move releases and crits · 2: impacts and charge-ups · 1: KOs, immune hits · 0: EXP pickups |
| When full | A new sound replaces the lower-priority voice that ends soonest; if no voice has lower priority, the new sound is skipped |
| Repeats | UI, pickup, kill and charge-up sounds repeated within their gate time (25–150 ms) are skipped |

Verified (`play` recording, 45 s of bot play from 4:32 in the meadow, through the boss arrival): 492 sounds played, 283 merged impacts, 109 gated repeats, at most 10 voices at once, none dropped. In the `moves` recording all 112 moves were audible above −45 dBFS: median −20 dB, 10th–90th percentile −25.6 to −16.6 dB.

112 moves; 38 with a dedicated signature layer; all origin: original synthesis.

| Move | Type | Material | Motion | Charge-up | Signature | Origin |
|---|---|---|---|---|---|---|
| Absorb | Grass | bloom | drain |  |  | Original synthesis |
| Acid | Poison | venom | nova | yes |  | Original synthesis |
| Aerial Ace | Flying | gale | dash |  |  | Original synthesis |
| Agility | Psychic | mind | buff | yes |  | Original synthesis |
| Air Cutter | Flying | gale | nova | yes |  | Original synthesis |
| Air Slash | Flying | gale | cone |  | yes | Original synthesis |
| Ancient Power | Rock | stone | meteor | yes |  | Original synthesis |
| Aqua Tail | Water | tide | dash |  | yes | Original synthesis |
| Astonish | Ghost | wisp | strike |  |  | Original synthesis |
| Beat Up | Dark | gloom | strike |  |  | Original synthesis |
| Bite | Dark | gloom | strike |  | yes | Original synthesis |
| Blizzard | Ice | frost | nova | yes |  | Original synthesis |
| Body Slam | Normal | plain | dash |  |  | Original synthesis |
| Brick Break | Fighting | brawl | strike |  |  | Original synthesis |
| Bubble | Water | tide | orb |  | yes | Original synthesis |
| Bubble Beam | Water | tide | beam | yes |  | Original synthesis |
| Charge | Electric | volt | buff | yes |  | Original synthesis |
| Comet Punch | Normal | plain | barrage |  |  | Original synthesis |
| Counter | Fighting | brawl | strike |  |  | Original synthesis |
| Crunch | Dark | gloom | strike |  | yes | Original synthesis |
| Dark Pulse | Dark | gloom | orb |  |  | Original synthesis |
| Defense Curl | Normal | plain | buff | yes |  | Original synthesis |
| Discharge | Electric | volt | nova | yes |  | Original synthesis |
| Double Slap | Normal | plain | barrage |  |  | Original synthesis |
| Double-Edge | Normal | plain | strike |  |  | Original synthesis |
| Dragon Claw | Dragon | wyrm | strike |  | yes | Original synthesis |
| Dragon Rage | Dragon | wyrm | beam | yes | yes | Original synthesis |
| Dream Eater | Psychic | mind | drain |  |  | Original synthesis |
| Ember | Fire | blaze | bolt |  | yes | Original synthesis |
| Eruption | Fire | blaze | nova | yes | yes | Original synthesis |
| Extrasensory | Psychic | mind | orb |  |  | Original synthesis |
| Feint Attack | Dark | gloom | strike |  |  | Original synthesis |
| Fire Blast | Fire | blaze | cone |  |  | Original synthesis |
| Fire Fang | Fire | blaze | cone |  | yes | Original synthesis |
| Fire Spin | Fire | blaze | vortex | yes | yes | Original synthesis |
| Flail | Normal | plain | strike |  |  | Original synthesis |
| Flame Wheel | Fire | blaze | dash |  |  | Original synthesis |
| Flamethrower | Fire | blaze | cone |  | yes | Original synthesis |
| Flare Blitz | Fire | blaze | dash |  | yes | Original synthesis |
| Flash Cannon | Steel | alloy | strike |  | yes | Original synthesis |
| Fury Attack | Normal | plain | barrage |  |  | Original synthesis |
| Fury Swipes | Normal | plain | barrage |  |  | Original synthesis |
| Giga Drain | Grass | bloom | drain |  |  | Original synthesis |
| Growth | Normal | plain | buff | yes | yes | Original synthesis |
| Gust | Flying | gale | homing |  |  | Original synthesis |
| Harden | Normal | plain | buff | yes |  | Original synthesis |
| Heat Wave | Fire | blaze | nova | yes | yes | Original synthesis |
| Horn Attack | Normal | plain | strike |  |  | Original synthesis |
| Hydro Pump | Water | tide | beam | yes | yes | Original synthesis |
| Hyper Fang | Normal | plain | cone |  |  | Original synthesis |
| Ice Beam | Ice | frost | beam | yes |  | Original synthesis |
| Ice Fang | Ice | frost | cone |  | yes | Original synthesis |
| Ice Shard | Ice | frost | dash |  |  | Original synthesis |
| Icy Wind | Ice | frost | cone |  |  | Original synthesis |
| Lava Plume | Fire | blaze | nova | yes |  | Original synthesis |
| Leech Life | Bug | hive | drain |  |  | Original synthesis |
| Lick | Ghost | wisp | strike |  |  | Original synthesis |
| Low Kick | Fighting | brawl | strike |  |  | Original synthesis |
| Mach Punch | Fighting | brawl | dash |  |  | Original synthesis |
| Magical Leaf | Grass | bloom | homing |  | yes | Original synthesis |
| Magnitude | Ground | quake | strike |  |  | Original synthesis |
| Mega Drain | Grass | bloom | drain |  |  | Original synthesis |
| Mud Bomb | Ground | quake | lob |  |  | Original synthesis |
| Mud Shot | Ground | quake | bolt |  |  | Original synthesis |
| Mud-Slap | Ground | quake | nova | yes |  | Original synthesis |
| Natural Gift | Normal | plain | strike |  |  | Original synthesis |
| Night Shade | Ghost | wisp | homing |  |  | Original synthesis |
| Night Slash | Dark | gloom | strike |  |  | Original synthesis |
| Payback | Dark | gloom | strike |  |  | Original synthesis |
| Petal Dance | Grass | bloom | boomerang |  | yes | Original synthesis |
| Poison Fang | Poison | venom | cone |  |  | Original synthesis |
| Poison Sting | Poison | venom | strike |  |  | Original synthesis |
| Powder Snow | Ice | frost | cone |  |  | Original synthesis |
| Power Gem | Rock | stone | meteor | yes |  | Original synthesis |
| Present | Normal | plain | strike |  |  | Original synthesis |
| Pursuit | Dark | gloom | strike |  |  | Original synthesis |
| Quick Attack | Normal | plain | dash |  | yes | Original synthesis |
| Rage | Normal | plain | strike |  |  | Original synthesis |
| Rain Dance | Water | tide | weather | yes | yes | Original synthesis |
| Rapid Spin | Normal | plain | spin |  | yes | Original synthesis |
| Razor Leaf | Grass | bloom | boomerang |  | yes | Original synthesis |
| Rock Blast | Rock | stone | barrage |  |  | Original synthesis |
| Rock Slide | Rock | stone | nova | yes |  | Original synthesis |
| Rock Throw | Rock | stone | strike |  |  | Original synthesis |
| Rock Tomb | Rock | stone | strike |  |  | Original synthesis |
| Rollout | Rock | stone | dash |  | yes | Original synthesis |
| Scratch | Normal | plain | strike |  | yes | Original synthesis |
| Seed Bomb | Grass | bloom | lob |  | yes | Original synthesis |
| Self-Destruct | Normal | plain | nova | yes |  | Original synthesis |
| Shadow Ball | Ghost | wisp | orb |  |  | Original synthesis |
| Shadow Claw | Ghost | wisp | strike |  |  | Original synthesis |
| Signal Beam | Bug | hive | beam | yes |  | Original synthesis |
| Silver Wind | Bug | hive | bolt |  |  | Original synthesis |
| Skull Bash | Normal | plain | strike |  |  | Original synthesis |
| Slash | Normal | plain | strike |  | yes | Original synthesis |
| Smog | Poison | venom | lob |  |  | Original synthesis |
| Solar Beam | Grass | bloom | beam | yes | yes | Original synthesis |
| Sucker Punch | Dark | gloom | dash |  |  | Original synthesis |
| Superpower | Fighting | brawl | strike |  | yes | Original synthesis |
| Swift | Normal | plain | homing |  | yes | Original synthesis |
| Tackle | Normal | plain | dash |  | yes | Original synthesis |
| Take Down | Normal | plain | strike |  |  | Original synthesis |
| Thrash | Normal | plain | strike |  | yes | Original synthesis |
| Thunder | Electric | volt | chain | yes |  | Original synthesis |
| Thunder Fang | Electric | volt | chain | yes |  | Original synthesis |
| Thunder Shock | Electric | volt | chain | yes | yes | Original synthesis |
| Vine Whip | Grass | bloom | strike |  | yes | Original synthesis |
| Water Gun | Water | tide | bolt |  | yes | Original synthesis |
| Water Pulse | Water | tide | orb |  | yes | Original synthesis |
| Wing Attack | Flying | gale | dash |  | yes | Original synthesis |
| Wood Hammer | Grass | bloom | strike |  |  | Original synthesis |
| X-Scissor | Bug | hive | strike |  |  | Original synthesis |

## Music

### What plays

| State | Track | Tempo | Loop |
|---|---|---|---|
| Title, partner select | Sunrise Over the Route | 132 | bars 3–end (2-bar intro plays once) |
| Exploring, Sunpetal Meadow | Petal Path | 118 | whole track |
| Exploring, Cinder Badlands | Cinder Trail | 112 | whole track |
| Exploring, Rimefrost Heights | Rime Steps | 104 | whole track |
| Exploring, Duskwood Hollow | Moonlit Hollow | 96 | whole track |
| Swarm combat | Wild Rush; a swarm layer fades in with the enemy count | 152 | bars 2–end |
| Boss (intro, then sustain) | Lord of the Glade | 166 | bars 3–end (2-bar intro) |
| Evolution | Something's Happening | 100 | whole track |
| Stingers (play once) | Congratulations (evolved), Region Cleared (victory), Fainted (defeat), Item Get (item ball) | — | — |
| Pause | Current track, low-passed to 900 Hz at 45 % volume | — | — |

All melodies are original to Poke-Watch. Loops are scheduled by the sequencer on exact bar boundaries, so there's no gap or seam. In the `loop` recording, 40 s of the meadow track crossed its loop point several times with the level never dropping below −36 dB.

### Director (`src/audio/audio.ts`)

- Exploring → battle when 8 or more enemies stay within 12 m for 2.5 s.
- Battle → exploring after 6 s with 2 or fewer nearby.
- No battle/explore switch within 8 s of the last change.
- Boss, evolution, victory and defeat switch immediately. Evolution returns to whatever was playing before.
- Changes start on the old track's next bar boundary when it is less than 1.2 s away, and crossfade over about 1 s (0.35 s for immediate switches).

Verified (`music` recording): every state above was triggered in turn with no silent gaps between tracks. In bot play the director moved from exploring to battle on its own ("crowd 76 close").

### Licensed recordings (slots)

`content/music/manifest.json` takes a recording for any state (`title`, `route_meadow`, `route_badlands`, `route_frost`, `route_dusk`, `battle`, `boss`, `evolution`) or stinger (`evolved`, `victory`, `defeat`, `item`), with `loopStart` and `loopEnd` in seconds. `npm run content` embeds them, and the director then plays the recording with sample-accurate looping (an `AudioBufferSourceNode` with `loopStart` and `loopEnd`) in place of the original track. The manifest ships empty. `tools/slotcheck.mjs` exercised this path with a generated 2 s test tone (quiet first second, loud second, loop 1–2 s): the quiet intro played once (−46 dB), then the loud loop held steady at −22 dB for 5 s with no return to the intro and no dropout. Only add recordings you have the right to use (see `content/music/README.md`).

## Mixing

| Bus | Default | Notes |
|---|---|---|
| Master | 80 % | Then a compressor (−20 dB, 4:1) and a limiter (−4 dB, 20:1) |
| Music | 55 % | Ducked under cries (55 %), level-up (40 %), boss alarm (30 %) and stingers |
| Effects | 80 % | Voice-limited as above |
| Cries | 85 % | 3 voices at most |

Settings has a slider for each bus, mute (M), a preview button next to each slider, and a reset button. Settings persist in browser storage where it's available.

## Not verified

- Listening on real speakers and headphones. Levels were measured; the balance hasn't been judged by ear.
- The Safari path: Safari can't decode Vorbis, so it should take the MP3 copy. The code path is covered by the cry test, but it hasn't been run in Safari.
- Long sessions. The longest recording is 100 s; memory and voice behaviour over a 30-minute run weren't measured.
