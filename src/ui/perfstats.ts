// Frame-time statistics for the dev overlay (?perf=1, ui/perfhud.ts; docs/ROADMAP.md item 2, P5). Pure: no DOM, no
// clock of its own. The host pushes one sample per animation frame with the timestamps it already has; this keeps a
// ring of the last few seconds and answers the overlay's questions (the worst frame in the window, percentiles, how
// often a frame ran zero or several sim ticks). Nothing in the sim reads it.

export interface FrameSample {
  /** the frame's rAF timestamp (ms) */
  t: number;
  /** the interval since the previous frame (ms, uncapped: the main loop's own cap would hide a long stall) */
  frame: number;
  /** CPU time of the sim ticks this frame (ms) */
  sim: number;
  /** CPU time of renderer.render (ms; GL submission, not GPU time) */
  render: number;
  /** CPU time of the DOM HUD work after the render (ms) */
  ui: number;
  /** fixed sim ticks run this frame */
  ticks: number;
  /** mouse look movement consumed this frame (|dx| + |dy|, px; 0 when none or not in third person) */
  mouse: number;
}

export interface WindowStats {
  frames: number;
  /** seconds covered by the samples in the window */
  span: number;
  fps: number;
  frame: { p50: number; p95: number; p99: number; max: number; maxAgo: number };
  sim: { p50: number; max: number };
  render: { p50: number; max: number };
  ui: { p50: number; max: number };
  /** frames whose interval exceeded `hitchMs` */
  hitches: number;
  /** how many frames ran 0, 1, 2 and 3+ sim ticks */
  ticks: [number, number, number, number];
  /** mouse look: frames that moved the camera, and gaps (one or two frames with no movement between two that had
   *  some: the camera stood still for a frame while the mouse was moving, which reads as judder; a longer pause is the
   *  hand stopping, not a gap) */
  look: { frames: number; gaps: number };
  /** the display's typical interval (the median frame), the yardstick a hitch is measured against */
  refresh: number;
}

const FIELDS = 7;

export class PerfStats {
  private readonly buf: Float64Array;
  private head = 0;
  private n = 0;

  /** @param cap samples kept (enough for `windowMs` at the fastest display expected: 5 s at 240 Hz = 1200) */
  constructor(readonly windowMs = 5000, readonly cap = 1500) {
    this.buf = new Float64Array(cap * FIELDS);
  }

  push(s: FrameSample) {
    const o = this.head * FIELDS, b = this.buf;
    b[o] = s.t; b[o + 1] = s.frame; b[o + 2] = s.sim; b[o + 3] = s.render; b[o + 4] = s.ui; b[o + 5] = s.ticks; b[o + 6] = s.mouse;
    this.head = (this.head + 1) % this.cap;
    if (this.n < this.cap) this.n++;
  }

  get size() { return this.n; }

  /** the k-th most recent sample's field (k = 0 is the newest) */
  private at(k: number, f: number) { return this.buf[((this.head - 1 - k + this.cap * 2) % this.cap) * FIELDS + f]; }

  /** the last `count` frame intervals, oldest first (for the graph) */
  recentFrames(count: number, out: number[] = []): number[] {
    out.length = 0;
    const m = Math.min(count, this.n);
    for (let k = m - 1; k >= 0; k--) out.push(this.at(k, 1));
    return out;
  }

  /** statistics over the samples newer than `windowMs` before the newest one. A hitch is a frame longer than
   *  `hitchFactor` times the median interval and at least `hitchMinMs` (so a 144 Hz display's hitch is not judged
   *  by a 60 Hz yardstick, and timer noise is not one) */
  stats(hitchFactor = 1.8, hitchMinMs = 12): WindowStats | null {
    if (!this.n) return null;
    const now = this.at(0, 0);
    const fr: number[] = [], si: number[] = [], re: number[] = [], ui: number[] = [];
    const ticks: [number, number, number, number] = [0, 0, 0, 0];
    let maxF = -1, maxT = now, first = now, lookN = 0, gaps = 0, newer = -1, gapRun = 0;
    for (let k = 0; k < this.n; k++) {
      const t = this.at(k, 0);
      if (now - t > this.windowMs) break;
      first = t;
      const f = this.at(k, 1);
      fr.push(f); si.push(this.at(k, 2)); re.push(this.at(k, 3)); ui.push(this.at(k, 4));
      ticks[Math.min(3, this.at(k, 5))]++;
      if (f > maxF) { maxF = f; maxT = t; }
      // walking back in time: a run of still frames counts as gaps once an older moving frame closes it
      const m = this.at(k, 6) > 0;
      if (m) { lookN++; if (newer >= 0 && gapRun > 0 && gapRun <= 2) gaps += gapRun; newer = k; gapRun = 0; } else if (newer >= 0) gapRun++;
    }
    const q = (a: number[], p: number) => a[Math.min(a.length - 1, Math.floor(p * (a.length - 1) + 0.5))];
    const sorted = (a: number[]) => a.slice().sort((x, y) => x - y);
    const F = sorted(fr), S = sorted(si), R = sorted(re), U = sorted(ui);
    const refresh = q(F, 0.5);
    const lim = Math.max(hitchMinMs, refresh * hitchFactor);
    let hitches = 0;
    for (const f of fr) if (f > lim) hitches++;
    const span = (now - first) / 1000;
    return {
      frames: fr.length, span, fps: span > 0 ? (fr.length - 1) / span : 0,
      frame: { p50: refresh, p95: q(F, 0.95), p99: q(F, 0.99), max: maxF, maxAgo: (now - maxT) / 1000 },
      sim: { p50: q(S, 0.5), max: S[S.length - 1] },
      render: { p50: q(R, 0.5), max: R[R.length - 1] },
      ui: { p50: q(U, 0.5), max: U[U.length - 1] },
      hitches, ticks, refresh, look: { frames: lookN, gaps },
    };
  }
}
