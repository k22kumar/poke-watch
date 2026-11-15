import type { AdaptiveScore } from './adaptive';
import manifest from '../../content/music/adaptive/manifest.json';
import melody from '../../content/music/adaptive/melody.mp3';
import pulse from '../../content/music/adaptive/pulse.mp3';
import drive from '../../content/music/adaptive/drive.mp3';
import impact from '../../content/music/adaptive/impact.mp3';
import victory from '../../content/music/adaptive/victory.mp3';
import defeat from '../../content/music/adaptive/defeat.mp3';
import accent from '../../content/music/adaptive/accent.mp3';

const sources: Record<string, string> = { 'melody.mp3': melody, 'pulse.mp3': pulse, 'drive.mp3': drive, 'impact.mp3': impact };
export const ADAPTIVE_SCORE: AdaptiveScore = {
  title: manifest.title,
  duration: manifest.duration,
  boundaries: manifest.boundaries,
  stems: manifest.stems.map((stem) => ({ id: stem.id, gain: stem.gain, src: sources[stem.file] })),
  cues: { victory, defeat, accent },
};
