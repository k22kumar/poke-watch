"""Render a melody-preserving adaptive *prototype*, not a full reorchestration.

Usage: python scripts/render-adaptive-score.py reference.wav output_directory
Dependencies: numpy, scipy, librosa, soundfile, imageio-ffmpeg.
The supplied reference is the melodic anchor. No transcription is invented.
"""
import json
import subprocess
import sys
from pathlib import Path

import imageio_ffmpeg
import librosa
import numpy as np
import soundfile as sf
from scipy.signal import butter, sosfilt

source, output = Path(sys.argv[1]), Path(sys.argv[2])
output.mkdir(parents=True, exist_ok=True)
pcm = output / 'masters'
pcm.mkdir(exist_ok=True)
audio, sr = sf.read(source, always_2d=True)
if sr != 44100:
    raise ValueError('Supply a 44.1 kHz reference WAV')
# The recording finishes its cadence at ~119 s; the remaining video is a fading tail/silence.
# Keep the cadence and remove only the trailing fade/silence. This is an auditionable loop,
# not a claim that the inferred bar grid has been approved by a music editor.
duration = min(119.8, len(audio) / sr)
n = round(duration * sr)
reference = audio[:n].copy()
reference *= 0.56 / max(1e-9, np.max(np.abs(reference)))
melody_gain = 0.56 / max(1e-9, np.max(np.abs(audio[:n])))
fade = round(0.02 * sr)
reference[:fade] *= np.linspace(0, 1, fade)[:, None]
reference[-fade:] *= np.linspace(1, 0, fade)[:, None]
y = librosa.resample(audio.mean(axis=1), orig_sr=sr, target_sr=22050)
tempo, beat_times = librosa.beat.beat_track(y=y, sr=22050, units='time')
beats = beat_times[beat_times < duration - 0.5]
beat_length = float(np.median(np.diff(beats)))
boundaries = [0.0] + [float(t) for t in beats[1::4] if t > 0.1]
rng = np.random.default_rng(781)
layers = {key: np.zeros(n) for key in ['pulse', 'drive', 'impact']}

def filtered_noise(count, cutoff, kind='lowpass'):
    return sosfilt(butter(2, cutoff, kind, fs=sr, output='sos'), rng.normal(0, 1, count))

def drum(kind, strength=1):
    length = {'kick': 0.65, 'skin': 0.23, 'slap': 0.14, 'low': 1.2, 'metal': 1.6}[kind]
    t = np.arange(round(length * sr)) / sr
    if kind == 'kick':
        freq = 46 + 125 * np.exp(-t * 34)
        signal = np.sin(2 * np.pi * np.cumsum(freq) / sr) * np.exp(-t * 9)
        signal += filtered_noise(len(t), 2200) * np.exp(-t * 100) * 0.25
    elif kind == 'skin':
        signal = sum(np.sin(2 * np.pi * f * t) * np.exp(-t * decay) * weight
                     for f, decay, weight in [(176, 21, 0.6), (283, 30, 0.28), (431, 42, 0.15)])
        signal += filtered_noise(len(t), 1200, 'highpass') * np.exp(-t * 45) * 0.28
    elif kind == 'slap':
        signal = filtered_noise(len(t), 1700, 'highpass') * np.exp(-t * 52) * 0.65
        signal += np.sin(2 * np.pi * 315 * t) * np.exp(-t * 32) * 0.3
    elif kind == 'low':
        freq = 42 + 70 * np.exp(-t * 16)
        signal = np.sin(2 * np.pi * np.cumsum(freq) / sr) * np.exp(-t * 5)
        signal += filtered_noise(len(t), 800) * np.exp(-t * 13) * 0.6
    else:
        signal = sum(np.sin(2 * np.pi * f * t) * np.exp(-t * (3 + i)) / (i + 3)
                     for i, f in enumerate([740, 1081, 1571, 2137, 3127]))
        signal += filtered_noise(len(t), 2500, 'highpass') * np.exp(-t * 8) * 0.25
    attack = np.minimum(1, t / 0.0015)
    return np.tanh(signal * 1.4) * attack * strength

def hit(layer, at, kind, strength):
    event = drum(kind, strength)
    start = round(at * sr)
    if start < 0 or start >= n:
        return
    length = min(len(event), n - start)
    layer[start:start + length] += event[:length]

for i, beat in enumerate(beats):
    # Measured beat spacing follows the original performance, with no time stretch.
    spacing = float(beats[i + 1] - beat) if i + 1 < len(beats) else beat_length
    barbeat = (i - 1) % 4
    if barbeat in [0, 2]:
        hit(layers['pulse'], beat, 'kick', 0.25 if barbeat == 0 else 0.17)
    for step in range(4):
        sixteenth = barbeat * 4 + step
        strength = [0.16, 0.055, 0.09, 0.13, 0.06, 0.08, 0.16, 0.055][sixteenth % 8]
        hit(layers['drive'], beat + spacing * step / 4, 'skin' if step % 2 == 0 else 'slap', strength)
    if barbeat == 0:
        hit(layers['impact'], beat, 'low', 0.23)
        if ((i - 1) // 4) % 4 == 0:
            hit(layers['impact'], beat, 'metal', 0.16)
    if barbeat == 3 and ((i - 1) // 4) % 4 == 3:
        for step in range(6):
            hit(layers['impact'], beat + spacing * step / 6, 'skin', 0.07 + step * 0.02)

for key, layer in layers.items():
    # Short stereo room with no new pitched musical material; tails wrap around the loop.
    stereo = np.column_stack([layer, layer])
    for delay, gain in [(0.037, 0.12), (0.061, 0.08), (0.109, 0.05)]:
        stereo[:, 0] += np.roll(layer, round(delay * sr)) * gain
        stereo[:, 1] += np.roll(layer, round((delay + 0.009) * sr)) * gain
    stereo = np.tanh(stereo * 1.1) / 1.1
    stereo[:fade] *= np.linspace(0, 1, fade)[:, None]
    stereo[-fade:] *= np.linspace(1, 0, fade)[:, None]
    layers[key] = stereo

reference *= 0.75
melody_gain *= 0.75
stems = {'melody': reference, **{key: value * 0.75 for key, value in layers.items()}}
gains = {
    'melody': {'anticipation': 0.48, 'combat': 0.86, 'surge': 0.93, 'climax': 1.0},
    'pulse': {'anticipation': 0.25, 'combat': 0.8, 'surge': 0.9, 'climax': 1.0},
    'drive': {'anticipation': 0, 'combat': 0.5, 'surge': 0.85, 'climax': 1.0},
    'impact': {'anticipation': 0, 'combat': 0, 'surge': 0.5, 'climax': 0.85},
}
ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()

def export(name, data):
    wav = pcm / f'{name}.wav'
    sf.write(wav, data, sr, subtype='PCM_24')
    # MP3 provides broad browser decoding support; all files have identical sample counts.
    channels = ['-ac', '1'] if name in ['pulse', 'drive', 'impact', 'accent'] else []
    subprocess.run([ffmpeg, '-v', 'error', '-y', '-i', str(wav), *channels, '-codec:a', 'libmp3lame',
                    '-b:a', '160k', str(output / f'{name}.mp3')], check=True)

for name, data in stems.items():
    export(name, data)

# Endings quote the source cadence at original pitch and timing; no invented lead notes.
victory = reference[round(114.0 * sr):].copy()
defeat = sosfilt(butter(2, 1100, fs=sr, output='sos'), victory, axis=0) * 0.8
defeat *= np.linspace(1, 0, len(defeat))[:, None]
victory[:round(0.015 * sr)] *= np.linspace(0, 1, round(0.015 * sr))[:, None]
defeat[:round(0.015 * sr)] *= np.linspace(0, 1, round(0.015 * sr))[:, None]
accent = drum('low', 0.25)
export('victory', victory)
export('defeat', defeat)
export('accent', np.column_stack([accent, accent]))

report = {
    'status': 'adaptive reference remix prototype — not a complete reorchestration',
    'source': 'https://www.youtube.com/watch?v=4ZrdWpWqVpQ',
    'sourceTitle': 'Pokémon Anime BGM - Trainer Battle (1997~1998-M56B)',
    'duration': duration, 'sampleRate': sr, 'samples': n,
    'estimatedTempo': float(np.asarray(tempo).flat[0]),
    'melodyTreatment': 'Original full mix retained; gain and 20 ms edge fades only. No pitch or timing changes.',
    'interiorMelodyMaxError': float(np.max(np.abs(reference[fade:-fade] - audio[fade:n-fade] * melody_gain))),
    'needsReview': ['Perceptual listening and loop/phrase approval', 'Exact lead transcription and isolated melody',
                    'Full Tamil cinematic reorchestration with recorded instruments', 'Final mix/master approval'],
    'levels': {},
}
previews = output / 'previews'
previews.mkdir(exist_ok=True)
for state in ['anticipation', 'combat', 'surge', 'climax']:
    mix = sum(data * gains[name][state] for name, data in stems.items())
    peak = float(np.max(np.abs(mix)))
    report['levels'][state] = {'peakDbFS': float(20 * np.log10(peak + 1e-12)),
                             'rmsDbFS': float(20 * np.log10(np.sqrt(np.mean(mix ** 2)) + 1e-12))}
    if peak >= 0.98:
        raise ValueError(f'Clipping risk in {state}: {peak}')
    sf.write(previews / f'{state}.wav', mix, sr, subtype='PCM_24')

manifest = {'title': 'Trainer Battle — adaptive reference remix', 'duration': duration,
            'boundaries': boundaries, 'stems': [{'id': name, 'file': f'{name}.mp3', 'gain': gains[name]} for name in stems],
            'cues': {key: f'{key}.mp3' for key in ['victory', 'defeat', 'accent']},
            'source': report['source'], 'status': report['status']}
(output / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
(output / 'render-report.json').write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps(report, indent=2))
