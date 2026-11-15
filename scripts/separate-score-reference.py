"""Separate a source excerpt for transcription review; no runtime assets are replaced.

python scripts/separate-score-reference.py input.wav output_directory
Requires demucs, torch, soundfile, numpy, imageio-ffmpeg. First run downloads model weights.
"""
import hashlib
import importlib.metadata
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

cache = Path(tempfile.gettempdir()) / 'poke-watch-separation-models'
os.environ.setdefault('TORCH_HOME', str(cache / 'torch'))
os.environ.setdefault('HF_HOME', str(cache / 'huggingface'))
import imageio_ffmpeg
import numpy as np
import soundfile as sf
import torch
from demucs.api import Separator

source, output = Path(sys.argv[1]), Path(sys.argv[2])
output.mkdir(parents=True, exist_ok=True)
pcm, sr = sf.read(source, dtype='float32', always_2d=True)
torch.manual_seed(781)
torch.set_num_threads(2)
separator = Separator(model='htdemucs', device='cpu', shifts=1, overlap=0.25, segment=7, progress=True)
with torch.inference_mode():
    original, separated = separator.separate_tensor(torch.from_numpy(pcm.T.copy()), sr)
rate = separator.samplerate
stems = {name: wave.detach().cpu().numpy().T for name, wave in separated.items()}
raw = original.detach().cpu().numpy().T
reconstructed = sum(stems.values())
residual = raw - reconstructed
report = {
    'status': 'source separation candidate; not an isolated or verified melody',
    'model': 'htdemucs', 'demucsVersion': importlib.metadata.version('demucs'),
    'sourceSha256': hashlib.sha256(source.read_bytes()).hexdigest(),
    'sampleRate': rate, 'samples': len(raw), 'durationSeconds': len(raw) / rate,
    'reconstructionResidualRmsDbFS': float(20 * np.log10(np.sqrt(np.mean(residual ** 2)) + 1e-12)),
    'reconstructionSnrDb': float(10 * np.log10(np.mean(raw ** 2) / (np.mean(residual ** 2) + 1e-12))),
    'warning': 'Reconstruction metrics do not establish lead-note accuracy or isolation quality. The vocals label may contain instrumental lead material; do not discard it without listening.',
    'stems': {},
}
for name, wave in stems.items():
    if wave.shape != raw.shape or not np.isfinite(wave).all():
        raise ValueError(f'Invalid output for {name}')
    sf.write(output / f'{name}.wav', wave, rate, subtype='FLOAT')
    report['stems'][name] = {'rmsDbFS': float(20 * np.log10(np.sqrt(np.mean(wave ** 2)) + 1e-12)),
                             'peakDbFS': float(20 * np.log10(np.max(np.abs(wave)) + 1e-12))}

# Keep every non-drum source, including anything labeled vocals. The reference is instrumental,
# but a general-purpose separator can assign brass/woodwind melody to its vocals output.
non_drum = sum(wave for name, wave in stems.items() if name != 'drums')
sf.write(output / 'non-drum-candidate.wav', non_drum, rate, subtype='FLOAT')
audition_gain = min(1.0, 0.89 / max(1e-9, float(np.max(np.abs(non_drum)))))
report['auditionGain'] = audition_gain
subprocess.run([imageio_ffmpeg.get_ffmpeg_exe(), '-v', 'error', '-y', '-i',
                str(output / 'non-drum-candidate.wav'), '-af', f'volume={audition_gain}', '-codec:a', 'libmp3lame', '-b:a', '192k',
                str(output / 'non-drum-candidate.mp3')], check=True)
(output / 'separation-report.json').write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps(report, indent=2))
