"""Export an explicitly UNVERIFIED monophonic transcription for musical review.

python scripts/draft-score-melody.py separated-other.wav output_directory
This estimator is not a polyphonic transcription model. Its output must not become the
authoritative melody or replace runtime audio without note-by-note verification.
"""
import hashlib
import json
import struct
import sys
from pathlib import Path

import librosa
import numpy as np
import soundfile as sf

source, output = Path(sys.argv[1]), Path(sys.argv[2])
output.mkdir(parents=True, exist_ok=True)
pcm, rate = sf.read(source, always_2d=True)
sr, hop = 22050, 256
y = librosa.resample(pcm.mean(axis=1), orig_sr=rate, target_sr=sr)
f0, voiced, probability = librosa.pyin(y, sr=sr, fmin=float(librosa.note_to_hz('C3')),
    fmax=float(librosa.note_to_hz('C7')), frame_length=2048, hop_length=hop, fill_na=np.nan)
frames = np.full(len(f0), -1, dtype=int)
valid = voiced & np.isfinite(f0) & (probability >= 0.2)
frames[valid] = np.rint(librosa.hz_to_midi(f0[valid])).astype(int)
notes = []
begin = 0
for end in range(1, len(frames) + 1):
    if end < len(frames) and frames[end] == frames[begin]:
        continue
    duration = (end - begin) * hop / sr
    if frames[begin] >= 0 and duration >= 0.045:
        notes.append({'pitch': int(frames[begin]), 'name': librosa.midi_to_note(int(frames[begin])),
                      'startSeconds': begin * hop / sr, 'durationSeconds': duration,
                      'estimatorConfidence': float(np.mean(probability[begin:end])), 'reviewed': False})
    begin = end

# Standard MIDI at a fixed timing scale, retaining estimated seconds rather than snapping to a grid.
def variable_length(value):
    data = [value & 127]
    while value >> 7:
        value >>= 7
        data.insert(0, (value & 127) | 128)
    return bytes(data)

label = b'UNVERIFIED lead candidate - review every note'
track = bytearray(b'\x00\xff\x03' + variable_length(len(label)) + label)
track.extend(b'\x00\xff\x51\x03\x07\xa1\x20')  # 500000 us/quarter, 960 ticks/quarter
events = []
for note in notes:
    start = round(note['startSeconds'] * 1920)
    end = round((note['startSeconds'] + note['durationSeconds']) * 1920)
    events.extend([(start, 1, note['pitch']), (end, 0, note['pitch'])])
last = 0
for tick, on, pitch in sorted(events):
    track.extend(variable_length(tick - last) + bytes([0x90 if on else 0x80, pitch, 80 if on else 0]))
    last = tick
track.extend(b'\x00\xff\x2f\x00')
(output / 'lead-candidate.mid').write_bytes(b'MThd' + struct.pack('>IHHH', 6, 0, 1, 960) + b'MTrk' + struct.pack('>I', len(track)) + track)

# Simple sine audition makes incorrect notes easier to spot; not a production instrument.
audition = np.zeros(len(y))
for note in notes:
    start = round(note['startSeconds'] * sr)
    count = min(round(note['durationSeconds'] * sr), len(y) - start)
    if count <= 0:
        continue
    t = np.arange(count) / sr
    envelope = np.minimum(1, t / 0.008) * np.minimum(1, (count / sr - t) / 0.018)
    audition[start:start + count] += np.sin(2 * np.pi * librosa.midi_to_hz(note['pitch']) * t) * envelope * 0.18
sf.write(output / 'lead-candidate-audition.wav', audition, sr, subtype='PCM_24')
report = {'status': 'UNVERIFIED — not authorized as a melody lock', 'sourceSha256': hashlib.sha256(source.read_bytes()).hexdigest(),
          'method': 'librosa pYIN, single fundamental, C3–C7; minimum voiced probability 0.2',
          'durationSeconds': len(y) / sr, 'estimatedVoicedFrameFraction': float(np.mean(valid)),
          'noteCount': len(notes), 'notes': notes,
          'limitations': ['Accompaniment and harmonics can be mistaken for the lead.',
                         'Quiet/short notes may be missing; repeated notes may merge.',
                         'Onsets are frame estimates, not verified source phrasing.',
                         'Estimator confidence measures model behavior, not note accuracy.']}
(output / 'lead-candidate.json').write_text(json.dumps(report, indent=2, ensure_ascii=False) + '\n')
print(json.dumps({key: value for key, value in report.items() if key != 'notes'}, indent=2))
