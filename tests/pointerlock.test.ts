// Pointer lock and play control (src/input/input.ts; the host side is main.ts resumeFromMenu / onLockGained /
// onLockError). A refused lock request is usually transient: Chrome refuses a re-lock for about a second after the player
// leaves it with Esc, and a request from an Esc keydown has no user activation. So one refusal must not turn the next
// click on the game into an attack; it should capture again. Only a page that keeps being refused (a frame without
// pointer-lock permission) gives up on the lock, so that clicks attack and the host stops waiting for it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { BTN } from '../src/sim/types';

class Target {
  l: Record<string, ((e: unknown) => void)[]> = {};
  addEventListener(t: string, f: (e: unknown) => void) { (this.l[t] ??= []).push(f); }
  fire(t: string, e: Record<string, unknown> = {}) { for (const f of this.l[t] ?? []) f({ preventDefault() {}, target: null, ...e }); }
}

/** an Input on a stubbed DOM whose canvas counts lock requests; grant() and refuse() answer the last one */
async function stub() {
  const win = new Target();
  const doc = Object.assign(new Target(), { pointerLockElement: null as unknown, exitPointerLock() { doc.pointerLockElement = null; doc.fire('pointerlockchange'); } });
  const el = Object.assign(new Target(), { requests: 0, requestPointerLock() { el.requests++; }, getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }) });
  Object.assign(globalThis, { window: win, document: doc });
  Object.defineProperty(globalThis, 'navigator', { value: { getGamepads: () => [] }, configurable: true, writable: true });
  const { Input } = await import('../src/input/input');
  const input = new Input(el as unknown as HTMLElement);
  input.chase = true;
  input.context = 'play';
  const ev = { gained: 0, error: 0, lost: 0 };
  input.onLockGained = () => ev.gained++;
  input.onLockError = () => ev.error++;
  input.onLockLost = () => ev.lost++;
  const grant = () => { doc.pointerLockElement = el; doc.fire('pointerlockchange'); };
  const refuse = () => doc.fire('pointerlockerror');
  /** the browser takes the lock away (the player's Esc), not the host */
  const browserRelease = () => { doc.pointerLockElement = null; doc.fire('pointerlockchange'); };
  const click = () => { el.fire('mousedown', { button: 0 }); win.fire('mouseup', { button: 0 }); };
  return { input, el, win, doc, ev, grant, refuse, browserRelease, click };
}

test('pointer lock: a refused request (the post-Esc cooldown) leaves the next click capturing, not attacking', async () => {
  const { input, el, ev, grant, refuse, browserRelease, click } = await stub();
  click(); grant();
  assert.equal(ev.gained, 1, 'granted');
  assert.equal(input.sample(0).btn, 0, 'the capturing click did not attack');
  browserRelease();
  assert.equal(ev.lost, 1, 'the browser\'s own release is reported (the host pauses)');
  input.capture(true); refuse();
  assert.equal(ev.error, 1);
  assert.equal(input.lockUnavailable, false, 'one refusal is transient');
  const before = el.requests;
  click();
  assert.equal(el.requests, before + 1, 'the click asks again');
  assert.equal(input.sample(0).btn, 0, 'and does not attack');
  assert.equal(input.sample(0).press ?? 0, 0);
  grant();
  assert.equal(ev.gained, 2);
});

test('pointer lock: a page that keeps being refused gives up on it; then clicks attack (and still ask)', async () => {
  // never locked: two refusals (a frame without pointer-lock permission refuses every time)
  {
    const { input, refuse, click } = await stub();
    click(); refuse();
    assert.equal(input.lockUnavailable, false);
    click(); refuse();
    assert.equal(input.lockUnavailable, true);
    click();
    assert.equal((input.sample(0).btn ?? 0) & BTN.basic, BTN.basic, 'now a click attacks');
  }
  // locked before: it takes three in a row, and a grant resets the count
  {
    const { input, grant, refuse, browserRelease, click } = await stub();
    click(); grant(); browserRelease();
    input.capture(true); refuse(); input.capture(true); refuse();
    assert.equal(input.lockUnavailable, false, 'two refusals after a real lock are still transient');
    click(); grant();
    browserRelease();
    input.capture(true); refuse(); input.capture(true); refuse();
    assert.equal(input.lockUnavailable, false, 'the grant reset the count');
    input.capture(true); refuse();
    assert.equal(input.lockUnavailable, true);
  }
});

test('pointer lock: capture(force) asks from a menu (the Start / Resume click); plain capture waits for play', async () => {
  const { input, el } = await stub();
  input.context = 'menu';
  input.capture();
  assert.equal(el.requests, 0, 'plain capture waits for play');
  input.capture(true);
  assert.equal(el.requests, 1, 'forced: inside the button\'s own click');
  input.chase = false;
  input.capture(true);
  assert.equal(el.requests, 1, 'the fixed views never lock');
});

test('pointer lock: a release the host asks for (pause, menus) is not reported as lost', async () => {
  const { input, ev, grant, click } = await stub();
  click(); grant();
  input.releaseLock();
  assert.equal(ev.lost, 0);
  assert.equal(input.locked, false);
});

test('pointer lock: a rejected promise reports failure even without a pointerlockerror event', async () => {
  const { input, el, ev } = await stub();
  el.requestPointerLock = () => Promise.reject(new Error('refused'));
  input.capture(true);
  await Promise.resolve();
  assert.equal(ev.error, 1, 'Resume must be told the request failed');
});

test('pointer lock: an event and a promise rejection count as one refusal', async () => {
  const { input, el, ev, refuse } = await stub();
  el.requestPointerLock = () => Promise.reject(new Error('refused'));
  input.capture(true);
  refuse();
  await Promise.resolve();
  assert.equal(ev.error, 1);
  assert.equal(input.lockUnavailable, false, 'one failed request must not trigger fallback');
});

test('pointer lock: a throwing or missing API reports failure and does not swallow every attack', async () => {
  const { input, el, ev, click } = await stub();
  el.requestPointerLock = () => { throw new TypeError('unsupported'); };
  input.capture(true);
  assert.equal(ev.error, 1);
  Object.assign(el, { requestPointerLock: undefined });
  assert.equal(input.lockUnavailable, true);
  click();
  assert.equal((input.sample(0).btn ?? 0) & BTN.basic, BTN.basic);
});

test('pointer lock: repeated Resume clicks share a pending request', async () => {
  const { input, el } = await stub();
  input.capture(true); input.capture(true); input.capture(true);
  assert.equal(el.requests, 1);
});

test('pointer lock: cancelling a pending request releases a late grant without resuming', async () => {
  const { input, ev, doc, grant } = await stub();
  input.capture(true);
  input.releaseLock();
  input.context = 'menu';
  grant();
  assert.equal(doc.pointerLockElement, null, 'the menu must retain the cursor');
  assert.equal(input.locked, false);
  assert.equal(ev.gained, 0, 'a cancelled Resume cannot resume later');
  assert.equal(ev.lost, 0);
});

test('pointer lock: a cancelled failure does not affect the next gameplay entry', async () => {
  const { input, el, ev, grant } = await stub();
  let reject!: (e: Error) => void;
  el.requestPointerLock = () => new Promise<void>((_, no) => { reject = no; });
  input.capture(true);
  input.releaseLock();
  reject(new Error('cancelled'));
  await Promise.resolve();
  assert.equal(ev.error, 0);
  el.requestPointerLock = () => { el.requests++; };
  input.capture(true); grant();
  assert.equal(ev.gained, 1);
});

test('pointer lock: an unanswered request expires after 1.5 s; the next click asks afresh and a late grant still counts', async (t) => {
  let clock = 1000;
  t.mock.method(performance, 'now', () => clock);
  // the next click asks afresh once the silent request has expired, and does not attack
  {
    const { input, el, ev, grant, click } = await stub();
    input.capture(true);
    assert.equal(el.requests, 1);
    clock += 1000; click();
    assert.equal(el.requests, 1, 'still in flight at 1 s: the click shares it');
    clock += 600; click();
    assert.equal(el.requests, 2, 'expired at 1.6 s: the click issues a fresh request');
    assert.equal(input.sample(0).btn, 0, 'and does not attack');
    grant();
    assert.equal(ev.gained, 1);
    assert.equal(input.locked, true);
  }
  // a grant that arrives after the expiry, with no new request, is still accepted
  {
    const { input, ev, grant } = await stub();
    input.capture(true);
    clock += 2000;
    grant();
    assert.equal(ev.gained, 1, 'the late grant is not treated as withdrawn');
    assert.equal(input.locked, true);
  }
});
