// The physics world's lifecycle (task I1a; docs/spikes/S1-physics.md §6, owners O7 and O8): a run's Rapier world is
// freed by disposeRun and by a map change, so wasm memory (which never shrinks) stays flat over a batch of runs; and a
// snapshot round trip is exact: a world restored from takeSnapshot answers the next 600 ticks so that every tick hashes
// as the original run does.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { wasmBytes } from './setup/physics';
import { createRun, disposeRun, startStage, step } from '../src/sim/run';
import { replayHash } from '../src/sim/checksum';
import { NO_INPUT } from '../src/sim/types';
import { SCENARIOS, runScenario } from './fixtures/scenarios';

const ON = { physics: { engine: 'rapier' } } as const;
const run = (worldgen: object) => createRun({ seed: 1, species: 'charmander', ruleOverrides: { ...ON, worldgen } as never });
const gorge = { mode: 'generated', regionSeed: 1, locations: { meadow: 'river-gorge' } };

test('a run on physics builds its world at map entry and frees it on disposeRun (idempotent)', () => {
  const ctx = run({ arena: 'range' });
  const B = ctx.physics!;
  assert.ok(B.physics && !B.physics.disposed && B.rebuilds === 1, 'enterMap built the world');
  const P = B.physics;
  disposeRun(ctx);
  assert.ok(P.disposed && B.physics === null);
  disposeRun(ctx);
  assert.equal(createRun({ seed: 1, species: 'charmander' }).physics, null, 'the default engine (tiles) carries no bridge');
});

test('a map change frees the previous map\'s physics world', () => {
  const ctx = run({ arena: 'range' });
  const first = ctx.physics!.physics!;
  startStage(ctx, 1);
  assert.ok(first.disposed, 'the old world is freed');
  assert.ok(ctx.physics!.physics && !ctx.physics!.physics.disposed && ctx.physics!.rebuilds === 2);
  disposeRun(ctx);
});

test('wasm memory is flat over a batch of 50 runs (each disposed), and grows when runs are not disposed', () => {
  // warm up: the allocator reaches its working size on the largest map of the batch
  for (let i = 0; i < 2; i++) { const c = run(gorge); step(c, NO_INPUT); disposeRun(c); }
  const before = wasmBytes();
  for (let i = 0; i < 50; i++) {
    const c = run(i % 2 ? gorge : { arena: 'range' });
    for (let t = 0; t < 3; t++) step(c, NO_INPUT);
    disposeRun(c);
  }
  const after = wasmBytes();
  assert.equal(after, before, `wasm memory ${before} → ${after} bytes over 50 disposed runs`);
  // the control: the same runs left undisposed leak (S1: about 1.7 MB per River Gorge world), so the check above can fail
  const kept = [];
  for (let i = 0; i < 4; i++) kept.push(run(gorge));
  assert.ok(wasmBytes() > after, `undisposed runs grow wasm memory (${after} → ${wasmBytes()})`);
  for (const c of kept) disposeRun(c);
});

test('snapshot round trip: a restored world gives the next 600 ticks the same hashes as the original', () => {
  const base = SCENARIOS.find((s) => s.id === 'range-charmander-rapier')!;
  const s = { ...base, seconds: 20 };
  const plain: string[] = [], swapped: string[] = [];
  let snapBytes = 0, sameBytes = false;
  // the original: hashes of ticks 601..1200
  runScenario(s, (ctx) => { if (ctx.tick > 600) plain.push(replayHash(ctx).toString(16)); });
  // the same track, its physics world replaced at tick 600 by one restored from a snapshot
  runScenario(s, (ctx) => {
    if (ctx.tick === 600) {
      const B = ctx.physics!, bytes = B.snapshot();
      snapBytes = bytes.length;
      B.restore(bytes);
      const again = B.snapshot();
      sameBytes = again.length === bytes.length && again.every((v, i) => v === bytes[i]);
    }
    if (ctx.tick > 600) swapped.push(replayHash(ctx).toString(16));
  });
  assert.equal(plain.length, 600);
  assert.ok(snapBytes > 0 && sameBytes, `the restored world snapshots to the same ${snapBytes} bytes`);
  const at = plain.findIndex((h, i) => h !== swapped[i]);
  assert.equal(at, -1, `diverges at tick ${601 + at}`);
});
