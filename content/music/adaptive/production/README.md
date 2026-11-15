# Reorchestration work in progress

This folder contains source preparation and auditions. **No new candidate here has been promoted into the game's runtime. The full cinematic reorchestration is still unfinished.**

## What was completed

The complete user-selected M56B reference was exported with its original sample clock. The full source, a 23.661-second pilot and a seven-second ending excerpt were checked against the decoded reference: the PCM samples matched exactly. `production-inputs.json` records hashes, source offsets and prepared service requests.

Demucs `htdemucs` separated the full 125.991-second recording into drums, bass, other and vocals. These labels are model outputs: “other” includes multiple instruments, and “vocals” can include instrumental lead leakage. No output is represented as an isolated lead. The combined separated stems reconstruct the source with approximately 29.43 dB signal-to-residual ratio; that measures reconstruction, not melody accuracy.

A local pYIN transcription experiment on the pilot's remaining-instrument stem produced 31 candidate notes and accepted pitch estimates in only 12.0% of frames. This is insufficient to establish a complete melody. The draft is explicitly unverified and was rejected as the basis for a new lead. The MIDI container and all 31 matching note-on/off pairs were validated; that does not validate the notes themselves.

## Listen and inspect

- [New adaptive audition: original drums removed](candidates/comparison/replaced-drums-demo.mp3)
- [Comparison: original drums retained](candidates/comparison/original-drums-comparison.mp3)
- [Source without its separated drum stem](candidates/full/non-drum-candidate.mp3)
- [Unverified MIDI draft](candidates/pilot/transcription/lead-candidate.mid)
- [Draft note estimates and limitations](candidates/pilot/transcription/lead-candidate.json)

The two comparison mixes use identical new percussion and gain automation. They share one master trim, so removal of the original drums changes loudness naturally. The new mix peaks at −3.36 dBFS; the original-drums comparison peaks at −1.64 dBFS. Neither measured PCM mix clips. The demo changes to combat at 12.957 s, surge at 24.799 s, climax at 36.664 s and anticipation at 48.506 s, ending at 60.418 s. It demonstrates layering; it is not evidence of a finished musical loop or a professional reorchestration.

Source and candidate audio is kept locally and ignored by Git. The separated WAVs use floating-point PCM to preserve model output above 0 dBFS; the listening MP3 is attenuated to prevent clipping. The source remains subject to its original ownership and attribution.

## Next production step

Obtain a substantially more complete polyphonic transcription and verify the isolated lead against the reference. Preserve the approved note sequence and timing while orchestrating the lead for brass/strings; build the Tamil percussion, bass, harmony and transitions around it. Render compatible stems from a single approved arrangement. Do not generate independent intensity versions and assume their melodic phase will match.

`production-inputs.json` prepares requests for [Mureka separation/MIDI](https://fal.ai/models/mureka/api/song/stem/api), [music transcription](https://fal.ai/models/mureka/api/song/transcribe/api) and a short [ACE-Step arrangement audition](https://fal.ai/models/fal-ai/ace-step/audio-to-audio/api). No cloud requests have been submitted. The fal integration was discovered but has not been confirmed installed or connected. Generated notes and audio will still require verification; prompting “preserve the melody” is not proof that it was preserved.

## Reproduce

Using the temporary audio environment, or an environment containing the listed script dependencies:

```sh
python scripts/prepare-score-production.py /path/to/reference.wav content/music/adaptive/production
python scripts/separate-score-reference.py content/music/adaptive/production/source.wav content/music/adaptive/production/candidates/full
python scripts/separate-score-reference.py content/music/adaptive/production/pilot.wav content/music/adaptive/production/candidates/pilot
python scripts/draft-score-melody.py content/music/adaptive/production/candidates/pilot/other.wav content/music/adaptive/production/candidates/pilot/transcription
python scripts/render-separated-score-demo.py content/music/adaptive
```

Source separation downloads model weights on first use and runs locally. Rendering the comparison also needs the original prototype's `masters/` exports. The draft transcription script is an experiment, not an approved production transcriber.
