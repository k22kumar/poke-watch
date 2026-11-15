import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AdaptivePlayer, ScoreDirector, nextScoreBoundary, validateScore, type AdaptiveScore } from '../src/audio/adaptive';

const calm = { inRun: true, enemiesNear: 0, enemies: 0, boss: false, health: 1 };
const score: AdaptiveScore = {
  title: 'test', duration: 8, boundaries: [0, 2, 4, 6], cues: {},
  stems: ['melody', 'drums'].map((id) => ({ id, src: 'data:audio/wav;base64,', gain: { anticipation: 0.2, combat: 0.5, surge: 0.8, climax: 1 } })),
};

test('score director holds rising and falling transitions and handles danger, bosses and objectives', () => {
  const d = new ScoreDirector();
  assert.equal(d.update(0.5, { ...calm, enemiesNear: 5 }), 'anticipation');
  assert.equal(d.update(0.8, { ...calm, enemiesNear: 5 }), 'combat');
  assert.equal(d.update(1, calm), 'combat');
  assert.equal(d.update(5, calm), 'anticipation');
  assert.equal(d.update(1.3, { ...calm, enemiesNear: 1, health: 0.2 }), 'surge');
  assert.equal(d.update(0.01, { ...calm, boss: true }), 'climax');
  d.reset();
  assert.equal(d.update(1.3, { ...calm, objective: true }), 'combat');
  d.emphasize();
  assert.equal(d.update(0.01, calm), 'climax');
  assert.equal(d.update(0.1, { ...calm, inRun: false }), 'climax');
});

test('boundaries follow the original tempo map and continue across loops', () => {
  assert.equal(nextScoreBoundary(11, 10, 8, [0, 1.9, 4.1, 6]), 11.9);
  assert.equal(nextScoreBoundary(17.98, 10, 8, [0, 1.9, 4.1, 6]), 19.9);
  assert.equal(nextScoreBoundary(34.2, 10, 8, [0, 1.9, 4.1, 6]), 35.9);
  assert.equal(nextScoreBoundary(9, 10, 8, [0, 2, 4, 6]), 10);
});

test('invalid timing and gain manifests fail before playback', () => {
  assert.doesNotThrow(() => validateScore(score));
  assert.throws(() => validateScore({ ...score, boundaries: [0, 4, 2] }));
  assert.throws(() => validateScore({ ...score, duration: 0 }));
  assert.throws(() => validateScore({ ...score, stems: [score.stems[0], score.stems[0]] }));
});

function fakeContext() {
  const sources: any[] = [], gains: any[] = [];
  const context = {
    currentTime: 0,
    createGain() {
      const automation: any[] = [];
      const node = { connect() {}, disconnect() {}, gain: {
        value: 1, cancelScheduledValues(at: number) { automation.push(['cancel', at]); },
        setValueAtTime(value: number, at: number) { automation.push(['set', value, at]); },
        linearRampToValueAtTime(value: number, at: number) { automation.push(['ramp', value, at]); },
        setTargetAtTime(value: number, at: number) { automation.push(['target', value, at]); },
      }, automation }; gains.push(node); return node;
    },
    createBufferSource() {
      const source = { connect() {}, disconnect() {}, start(at: number) { this.started = at; }, stop(at: number) { this.stopped = at; }, started: -1, stopped: -1 };
      sources.push(source); return source;
    },
    async decodeAudioData() { return { duration: 8 }; },
  };
  return { context, sources, gains };
}

test('stems share an exact start/loop clock; intensity changes do not restart the lead', async () => {
  const { context, sources, gains } = fakeContext();
  const player = new AdaptivePlayer(context as unknown as AudioContext, {} as AudioNode, score);
  await player.load(); player.start();
  assert.equal(sources.length, 2);
  assert.equal(sources[0].started, sources[1].started);
  assert.equal(sources[0].loopEnd, 8);
  context.currentTime = 0.5; player.setState('surge');
  context.currentTime = 2; player.pump();
  assert.equal(player.state, 'surge');
  assert.equal(sources.length, 2);
  assert.ok(gains[1].automation.some((e: any[]) => e[0] === 'target' && e[1] === 0.8 && e[2] === 2.08));
  player.stop(); player.start('combat');
  assert.equal(sources.length, 4);
  assert.ok(sources[0].stopped > 2);
});

test('a request that changes before its boundary leaves no stale intensity ramp', async () => {
  const { context, gains } = fakeContext();
  const player = new AdaptivePlayer(context as unknown as AudioContext, {} as AudioNode, score);
  await player.load(); player.start();
  context.currentTime = 0.5; player.setState('climax'); player.setState('anticipation');
  context.currentTime = 2; player.pump();
  assert.equal(player.state, 'anticipation');
  assert.equal(gains[1].automation.length, 0);
});

test('a bad asset never activates a partially decoded adaptive score', async () => {
  const { context, sources } = fakeContext();
  let calls = 0;
  context.decodeAudioData = async () => { if (++calls === 2) throw new Error('corrupt stem'); return { duration: 8 }; };
  const player = new AdaptivePlayer(context as unknown as AudioContext, {} as AudioNode, score);
  await assert.rejects(player.load(), /corrupt stem/);
  player.start();
  assert.equal(player.ready, false);
  assert.equal(sources.length, 0);
});
