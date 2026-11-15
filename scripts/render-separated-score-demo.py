"""Render an A/B adaptive audition with the original drum stem removed.

python scripts/render-separated-score-demo.py content/music/adaptive
Keeps candidates outside the runtime. This remains a remix, not a reorchestration.
"""
import json
import subprocess
import sys
from pathlib import Path

import imageio_ffmpeg
import numpy as np
import soundfile as sf

root = Path(sys.argv[1])
manifest = json.loads((root / 'manifest.json').read_text())
production = root / 'production'
out = production / 'candidates' / 'comparison'
out.mkdir(parents=True, exist_ok=True)
source, sr = sf.read(production / 'source.wav', always_2d=True)
bed, bed_sr = sf.read(production / 'candidates/full/non-drum-candidate.wav', always_2d=True)
if bed_sr != sr or bed.shape != source.shape:
    raise ValueError('Separation must preserve the original sample clock')
duration = manifest['boundaries'][41]
n = round(duration * sr)
time = np.arange(n) / sr
events = [(0.0, 'anticipation')] + [(manifest['boundaries'][i], state) for i, state in
    [(9, 'combat'), (17, 'surge'), (25, 'climax'), (33, 'anticipation')]]
gains = {stem['id']: stem['gain'] for stem in manifest['stems']}

def envelope(stem):
    result = np.full(n, gains[stem][events[0][1]], dtype=float)
    for at, state in events[1:]:
        start = round(at * sr)
        previous = result[max(0, start - 1)]
        result[start:] = gains[stem][state] + (previous - gains[stem][state]) * np.exp(-(time[start:] - at) / 0.18)
    return result[:, None]

melody_gain = 0.42 / np.max(np.abs(source[:round(manifest['duration'] * sr)]))
new_drums = np.zeros((n, 2))
for stem in ['pulse', 'drive', 'impact']:
    wave, rate = sf.read(root / 'masters' / f'{stem}.wav', always_2d=True)
    if rate != sr or len(wave) < n:
        raise ValueError(f'Stem alignment mismatch: {stem}')
    new_drums += wave[:n] * envelope(stem)
old_mix = source[:n] * melody_gain * envelope('melody') + new_drums
new_mix = bed[:n] * melody_gain * envelope('melody') + new_drums
# Identical master trim for an honest comparison, keeping the sample peak below -1.5 dBFS.
master_gain = min(1.0, 10 ** (-1.5 / 20) / max(np.max(np.abs(old_mix)), np.max(np.abs(new_mix))))
report = {'status': 'unverified arrangement audition; runtime unchanged',
          'description': 'Original reference versus separated non-drum bed, both with the same new percussion and gain automation.',
          'durationSeconds': n / sr, 'sampleRate': sr, 'masterGain': float(master_gain),
          'transitions': [{'timeSeconds': at, 'state': state} for at, state in events], 'mixes': {}}
for name, mix in [('original-drums-comparison', old_mix), ('replaced-drums-demo', new_mix)]:
    mix *= master_gain
    edge = round(0.03 * sr)
    mix[:edge] *= np.linspace(0, 1, edge)[:, None]
    tail = round(0.3 * sr)
    mix[-tail:] *= np.linspace(1, 0, tail)[:, None]
    if not np.isfinite(mix).all() or np.max(np.abs(mix)) >= 1:
        raise ValueError(f'Invalid mix: {name}')
    wav = out / f'{name}.wav'
    sf.write(wav, mix, sr, subtype='PCM_24')
    mp3 = out / f'{name}.mp3'
    subprocess.run([imageio_ffmpeg.get_ffmpeg_exe(), '-v', 'error', '-y', '-i', str(wav),
                    '-codec:a', 'libmp3lame', '-b:a', '192k', str(mp3)], check=True)
    report['mixes'][name] = {'peakDbFS': float(20 * np.log10(np.max(np.abs(mix)) + 1e-12)),
                           'rmsDbFS': float(20 * np.log10(np.sqrt(np.mean(mix * mix)) + 1e-12))}
(out / 'comparison-report.json').write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps(report, indent=2))
