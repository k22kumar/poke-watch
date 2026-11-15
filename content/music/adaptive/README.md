# Adaptive Trainer Battle prototype

**This is a playable reference remix, not the requested finished Tamil cinematic reorchestration.** The reference's full original mix carries the melody. It is not an isolated lead stem. Added membrane-drum, slap, low-drum and metallic textures are synthesized; they are not recordings of parai, thavil or urumi. No lyrics or vocal layers were added.

Further work, including full-track separation, a rejected draft transcription and a new adaptive audition with the original drums removed, is documented in [production/README.md](production/README.md).

Authoritative melody: [Pokémon Anime BGM – Trainer Battle (1997–1998-M56B)](https://www.youtube.com/watch?v=4ZrdWpWqVpQ), composed by Junichi Masuda, arranged by Shinji Miyazaki, reference uploaded by PocketMonstersMusic. The other two supplied links are style references, not playlist entries or alternate lead melodies.

## Deliverables

- `melody.mp3`: original recording, normalized with 20 ms fades at its edges; original pitch and timing retained. The final video silence is trimmed at 119.8 s.
- `pulse.mp3`: low percussion foundation.
- `drive.mp3`: rapid interlocking synthesized drum/slap accompaniment.
- `impact.mp3`: large low-drum, metallic accents and fills.
- `victory.mp3`, `defeat.mp3`: source-cadence excerpts, with filtered/fading treatment for defeat.
- `accent.mp3`: unpitched impact for pickups, boss resolution and evolution.
- `manifest.json`: shared loop duration, inferred musical boundaries and state gains.
- `render-report.json`: measured peaks, RMS, source fidelity comparison and unfinished production work.
- `masters/*.wav`: local 24-bit/44.1 kHz editable exports; `previews/*.wav`: four local full-length intensity mixes. These large reproducible exports are ignored by Git. Runtime MP3s and the manifest are tracked.

All four stems start together and keep playing on one AudioContext clock. Intensity changes alter gain only, preserving the melodic position. The inferred beat grid follows the reference recording's timing rather than retiming its notes. The nominal measured tempo is about 161.5 BPM. Inferred downbeats, phrase placement and the cadence-to-intro loop still require listening approval; endpoint fades prevent a waveform discontinuity but do not establish musical seamlessness.

## Runtime behavior

| State | Trigger | Arrangement |
|---|---|---|
| Anticipation | Fewer than 3 nearby enemies, no active objective | Quiet reference, sparse pulse |
| Combat | 3+ nearby enemies or active objective | Reference foregrounded, pulse and drum drive |
| Surge | 12+ nearby enemies; or health below 30% with nearby enemies; or active objective with 6+ nearby | Fuller drive and large percussion |
| Climax | Boss active, boss phase, or objective completion | All layers; event emphasis lasts 8 seconds |

Rising intensity must persist 1.25 s; falling intensity must persist 6 s. Boss and emphasis requests bypass that hold. Changes then wait for the next inferred bar boundary and fade in over approximately half a second. Pausing freezes the gameplay director while the music continues at reduced volume through a low-pass filter. Settings, mute, ducking, limiter, meters and captureStream all apply because these are local Web Audio sources. End-of-run cues stop the looping score; restarting cancels the cue and returns to anticipation.

The bundle embeds the compressed stems, so playback works offline with no YouTube iframe. Decoding is atomic: the original score remains the fallback until every stem and cue is ready. A failed decode retains that fallback. Four long buffers have a material memory cost; see the browser check output for measured decoded memory.

Validation: typecheck, 344 repository tests and the production build passed. Headless Chromium decoded the actual embedded assets and verified intensity changes without restarting the melody, mute/pause gain, defeat, restart and stop. The four decoded stems used approximately 100.8 MiB in that run; the standalone page was approximately 15.4 MiB. The sampled music-bus level was −26 dBFS. This is automated verification, not listening approval.

## Reproduction and remaining work

Decode the supplied source to a 44.1 kHz stereo WAV, then run:

```sh
python scripts/render-adaptive-score.py /path/to/reference.wav content/music/adaptive
npm run build
node --import tsx --test tests/adaptive-audio.test.ts tests/audio.test.ts
node tools/musiccheck.mjs /absolute/path/to/dist/index.html
```

The rendering script requires numpy, scipy, librosa, soundfile and imageio-ffmpeg. It uses a fixed noise seed. No title, instrument label or estimated beat position should be interpreted as a verified transcription.

Finishing the original brief requires: transcribe and verify the lead against the recording, replace the retained full mix with a melody-faithful instrumental orchestration, record or source the intended South Indian instruments, design harmonically matched sections and endings, and listen/revise the full score and transitions. There are no newly composed replacement lead notes in this prototype.
