"""Prepare exact source excerpts and service inputs; never submit paid/cloud jobs.

Usage: python scripts/prepare-score-production.py reference.wav output_directory
Requires numpy, soundfile and imageio-ffmpeg (the score-rendering environment).
"""
import hashlib
import json
import subprocess
import sys
from pathlib import Path

import imageio_ffmpeg
import numpy as np
import soundfile as sf

root = Path(__file__).resolve().parent.parent
source, output = Path(sys.argv[1]), Path(sys.argv[2])
output.mkdir(parents=True, exist_ok=True)
audio, sr = sf.read(source, always_2d=True)
if sr != 44100 or audio.shape[1] != 2:
    raise ValueError('Use the original 44.1 kHz stereo decoded reference')
manifest = json.loads((root / 'content/music/adaptive/manifest.json').read_text())
if len(audio) / sr < manifest['duration']:
    raise ValueError('Source is shorter than the confirmed reference asset')
boundaries = manifest['boundaries']
# Sixteen inferred bars provide enough melody for an audition before a full render.
sections = {
    'source': (0, len(audio)),
    'pilot': (round(boundaries[1] * sr), round(boundaries[17] * sr)),
    'resolution-reference': (round(114 * sr), round(121 * sr)),
}
ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
files = {}
for name, (start, end) in sections.items():
    excerpt = audio[start:end]
    wav = output / f'{name}.wav'
    sf.write(wav, excerpt, sr, subtype='PCM_24')
    decoded, _ = sf.read(wav, always_2d=True)
    error = float(np.max(np.abs(decoded - excerpt)))
    if error > 1 / 2 ** 23:
        raise ValueError(f'Unexpected sample changes in {name}')
    mp3 = output / f'{name}.mp3'
    subprocess.run([ffmpeg, '-v', 'error', '-y', '-i', str(wav), '-codec:a', 'libmp3lame',
                    '-b:a', '192k', str(mp3)], check=True)
    if name == 'source' and mp3.stat().st_size > 10_000_000:
        raise ValueError('Source exceeds the selected separation service input limit')
    files[name] = {
        'wav': wav.name, 'mp3': mp3.name, 'sampleRate': sr, 'channels': 2,
        'startSampleInReference': start, 'endSampleInReference': end,
        'durationSeconds': len(excerpt) / sr,
        'wavSha256': hashlib.sha256(wav.read_bytes()).hexdigest(),
        'mp3Sha256': hashlib.sha256(mp3.read_bytes()).hexdigest(),
        'pcmMaxError': error,
    }

tags = (
    'instrumental only, modern Tamil cinematic mass-action score, explosive heroic brass, '
    'full orchestral strings, interlocking parai and thavil percussion, urumi tension textures, '
    'cinematic low drums, controlled sub-bass, aggressive synth bass, dramatic percussion breaks, '
    'wide cinematic mix, preserve the reference lead melody note for note, '
    'preserve original lead pitch intervals and rhythmic phrasing, '
    'no new lead hook, no lyrics, no singing, no vocal chants, no spoken voice'
)
package = {
    'status': 'prepared locally; no cloud job submitted',
    'authoritativeReference': 'https://www.youtube.com/watch?v=4ZrdWpWqVpQ',
    'sourceTitle': 'Pokémon Anime BGM - Trainer Battle (1997~1998-M56B)',
    'sourceWavSha256': hashlib.sha256(source.read_bytes()).hexdigest(),
    'files': files,
    'jobs': [
        {'purpose': 'Separate the original instrumentation and request candidate MIDI',
         'endpoint': 'mureka/api/song/stem', 'inputAudioFile': 'source.mp3',
         'input': {'model': 'audio-separation-3'},
         'documentation': 'https://fal.ai/models/mureka/api/song/stem/api'},
        {'purpose': 'Create notation for lead transcription review',
         'endpoint': 'mureka/api/song/transcribe', 'inputAudioFile': 'source.mp3',
         'input': {'title': 'Trainer Battle M56B — transcription candidate'},
         'documentation': 'https://fal.ai/models/mureka/api/song/transcribe/api'},
        {'purpose': 'Audition the cinematic treatment on a short reference excerpt',
         'endpoint': 'fal-ai/ace-step/audio-to-audio', 'inputAudioFile': 'pilot.mp3',
         'input': {'edit_mode': 'remix', 'original_tags': 'instrumental, melodic battle soundtrack, original arrangement',
                   'original_lyrics': '', 'tags': tags, 'lyrics': '[instrumental]'},
         'documentation': 'https://fal.ai/models/fal-ai/ace-step/audio-to-audio/api'},
    ],
    'execution': 'After connection, upload the named local audio and add the returned audio_url to that job input. Use the available connector capabilities; inspect them before submission.',
    'acceptance': {
        'melody': 'Compare the lead alone against the authoritative reference; verify every note, onset, duration, rest, accent and phrase. Candidate MIDI and generation prompts are not proof of fidelity.',
        'arrangement': 'Instrumental only; judge the Tamil cinematic treatment by listening. Reject new hooks, reharmonizations that obscure the lead, vocals or timing drift.',
        'stems': 'Derive aligned stems from one approved arrangement; never generate the four intensities independently. Preserve common start, loop length and melodic phase.',
        'release': 'Keep all returned candidates out of the runtime imports until melody, arrangement, loops and mix are verified.',
    },
}
(output / 'production-inputs.json').write_text(json.dumps(package, indent=2, ensure_ascii=False) + '\n')
print(json.dumps({'status': package['status'], 'files': files}, indent=2))
