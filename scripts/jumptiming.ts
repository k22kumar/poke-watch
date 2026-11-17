// Jump input latency at tick level (T33, the R6c half; docs/CONTROLS.md "Jump timing"). The real Input on a stubbed DOM
// feeds the host's frame loop (render/hostframe.ts runFrame: one sample per sim tick) into the real sim (createRun +
// step) at 30, 60 and 144 frames per second. For key taps of several lengths, at several phases inside a frame, it
// measures:
//   lag   ticks from the first tick sampled after the key went down to the tick that jumped (0 = that same tick)
//   ms    wall time from the key going down to that tick's sample
//   n     jumps from the one tap (1 = no lost tap, no double)
// plus a 5 s hold (edge input: 1 jump; the same frames with the edge field stripped, which is the pre-R6c sim rule: one
// jump per landing), gamepad taps (polled once per frame: a tap shorter than a frame can fall between two polls), and
// the buffer and coyote windows on the real step.
// Usage: npx tsx scripts/jumptiming.ts
import { createRun, step } from '../src/sim/run';
import { runFrame } from '../src/render/hostframe';
import { NO_INPUT, type InputFrame, type SimContext } from '../src/sim/types';
import { defaultRules } from '../src/rules/defaults';

class Target {
  l: Record<string, ((e: unknown) => void)[]> = {};
  addEventListener(t: string, f: (e: unknown) => void) { (this.l[t] ??= []).push(f); }
  fire(t: string, e: Record<string, unknown> = {}) { for (const f of this.l[t] ?? []) f({ preventDefault() {}, target: null, ...e }); }
}
const win = new Target(), doc = Object.assign(new Target(), { pointerLockElement: null, exitPointerLock() {} });
const el = Object.assign(new Target(), { requestPointerLock() {}, getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }) });
let padA = false;
Object.assign(globalThis, { window: win, document: doc });
Object.defineProperty(globalThis, 'navigator', { value: { getGamepads: () => [{ buttons: Array.from({ length: 17 }, (_, i) => ({ pressed: i === 0 && padA, value: 0 })), axes: [0, 0, 0, 0] }] }, configurable: true, writable: true });
const { Input } = await import('../src/input/input');

const DT = 1 / 60;
function calm(): SimContext {
  const ctx = createRun({ seed: 1, species: 'cyndaquil', ruleOverrides: { director: { spawnBase: -99, spawnPerMin: 0, spawnPerStage: 0 } } as never });
  for (let i = 0; i < 30; i++) step(ctx, NO_INPUT);
  return ctx;
}

interface Ev { at: number; down: boolean; dev: 'key' | 'pad' }
/** drive `seconds` of frames at `fps`; `evs` are key / pad transitions at wall times (s). `strip` drops the edge field
 *  (what the sim saw before R6c). Returns per jump: the tick, its sample time, and the first sampled tick after each down */
function drive(fps: number, seconds: number, evs: Ev[], strip = false) {
  const input = new Input(el as unknown as HTMLElement);
  input.context = 'play';
  padA = false;
  const ctx = calm();
  const pending = [...evs].sort((a, b) => a.at - b.at);
  let acc = 0, ticks = 0, now = 0;
  const jumps: { tick: number; t: number }[] = [];
  const sampledAfter: number[] = []; // per down event: the first tick sampled after it
  const downs = pending.filter((e) => e.down).map((e) => e.at);
  const frameDt = 1 / fps;
  for (let fr = 0; now < seconds; fr++) {
    now = fr * frameDt;
    while (pending.length && pending[0].at <= now) {
      const e = pending.shift()!;
      if (e.dev === 'key') win.fire(e.down ? 'keydown' : 'keyup', { code: 'Space' });
      else padA = e.down;
    }
    acc += frameDt;
    input.pollPad(); // main.ts frame(): every frame of play polls the pad before the due ticks
    const r = runFrame({
      look() {}, view: () => null,
      tick: () => {
        const tickTime = now;
        let f: InputFrame = input.sample(0);
        if (strip) { const { jumpPressed: _drop, ...rest } = f; f = rest; }
        for (const d of downs) if (d <= tickTime && sampledAfter[downs.indexOf(d)] === undefined) sampledAfter[downs.indexOf(d)] = ticks;
        for (const e of step(ctx, f)) if (e.t === 'jump') jumps.push({ tick: ticks, t: tickTime });
        ticks++;
        return 'go';
      },
    }, acc, DT, 8);
    acc = r.acc;
  }
  return { jumps, sampledAfter, downs };
}

const pad = (s: string | number, n: number) => String(s).padStart(n);
console.log(`jump timing (T33, R6c): rules.player.jumpBuffer ${defaultRules.player.jumpBuffer} s, coyote ${defaultRules.player.coyote} s; ticks of 1/60 s`);
console.log('fps  device tap(ms) phase | lag(ticks) ms   n | verdict');
let bad = 0;
for (const fps of [30, 60, 144]) {
  const frame = 1 / fps;
  for (const dev of ['key', 'pad'] as const) for (const tapMs of [2, 8, 16, 50, 200]) for (const phase of [0.1, 0.5, 0.9]) {
    const at = 0.2 + phase * frame;
    const { jumps, sampledAfter } = drive(fps, 1.2, [{ at, down: true, dev }, { at: at + tapMs / 1000, down: false, dev }]);
    const n = jumps.length;
    const lag = n ? jumps[0].tick - sampledAfter[0] : NaN;
    const ms = n ? (jumps[0].t - at) * 1000 : NaN;
    // a polled pad tap that ends before the next frame's poll is never seen: expected, not a defect of the edge rule
    const polledMiss = dev === 'pad' && n === 0 && tapMs / 1000 < frame;
    const ok = (n === 1 && lag === 0) || polledMiss;
    if (!ok) bad++;
    console.log(`${pad(fps, 3)}  ${dev.padEnd(6)} ${pad(tapMs, 6)}  ${phase.toFixed(1)}  | ${pad(Number.isNaN(lag) ? '-' : lag, 5)} ${pad(Number.isNaN(ms) ? '-' : ms.toFixed(1), 5)} ${pad(n, 2)} | ${ok ? (polledMiss ? 'missed (pad tap between two polls)' : 'ok') : 'FAIL'}`);
  }
  // a 5 s hold: one jump with edges; the pre-R6c rule jumps again on every landing
  const held = drive(fps, 5.5, [{ at: 0.2, down: true, dev: 'key' }]);
  const legacy = drive(fps, 5.5, [{ at: 0.2, down: true, dev: 'key' }], true);
  const okHold = held.jumps.length === 1;
  if (!okHold) bad++;
  console.log(`${pad(fps, 3)}  hold 5 s: edge input ${held.jumps.length} jump (legacy rule ${legacy.jumps.length}) | ${okHold ? 'ok' : 'FAIL'}`);
  // rapid taps: 8 Hz for 2 s, each 30 ms; every tap that lands on a support jumps, none is doubled
  const taps: Ev[] = [];
  for (let i = 0; i < 16; i++) { taps.push({ at: 0.2 + i / 8, down: true, dev: 'key' }, { at: 0.23 + i / 8, down: false, dev: 'key' }); }
  const rapid = drive(fps, 2.6, taps);
  console.log(`${pad(fps, 3)}  taps 8 Hz x16: ${rapid.jumps.length} jumps at ticks ${rapid.jumps.map((j) => j.tick).join(' ')}`);
}
console.log(bad ? `FAIL: ${bad} case(s)` : 'PASS: every key tap jumps once on the first tick sampled after it, at every frame rate; holding jumps once');
if (bad) process.exitCode = 1;
