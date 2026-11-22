// The dev frame-time overlay (?perf=1; docs/ROADMAP.md item 2, P5). main.ts builds one only when the query asks for
// it, so without ?perf nothing here runs: no element, no observer, no per-frame work. Statistics: ui/perfstats.ts.
//
// The graph shows the last ~4 s of frames, one column each: the stacked CPU work of the frame (sim blue, render
// orange, HUD green) under a white tick for the frame interval, against lines at 16.7 ms (60 Hz) and at the display's
// own median interval. A column taller than its neighbours with little CPU under it is a stall outside our code (GC,
// compositor, GPU back-pressure, the browser); one with a tall coloured stack is our own work.

import { PerfStats, type FrameSample } from './perfstats';

const W = 300, H = 84, MAX_MS = 50;

interface HeapInfo { usedJSHeapSize: number }

export class PerfHud {
  readonly stats = new PerfStats(5000, 1500);
  private readonly el: HTMLDivElement;
  private readonly text: HTMLPreElement;
  private readonly g: CanvasRenderingContext2D;
  private readonly cols: number[] = [];
  private readonly parts: Float32Array = new Float32Array(W * 3);
  private col = 0;
  private textT = 0;
  /** long tasks (PerformanceObserver 'longtask', Chrome: main-thread tasks over 50 ms, whoever ran them, extensions'
   *  content scripts included) as end-time / duration pairs, for the 5 s count */
  private readonly longs: number[] = [];
  /** every long task since the overlay was built: count, longest, and when the last one ended (a player's report keeps
   *  a stall that has scrolled out of the 5 s window) */
  private longTotal = 0;
  private longWorst = 0;
  private longLastEnd = -1;
  private lastHeap = 0;
  /** heap drops of more than 1 MB between frames: garbage collections big enough to see (Chrome's performance.memory) */
  private readonly gcs: { t: number; mb: number }[] = [];

  constructor(parent: HTMLElement = document.body) {
    this.el = document.createElement('div');
    this.el.style.cssText = 'position:fixed;right:8px;top:8px;z-index:1000;pointer-events:none;background:rgba(10,14,24,.82);color:#e8eefc;font:11px/1.35 ui-monospace,Menlo,monospace;padding:6px 8px;border-radius:6px;white-space:pre';
    const cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    cv.style.cssText = `display:block;width:${W}px;height:${H}px;margin-bottom:4px`;
    this.g = cv.getContext('2d')!;
    this.text = document.createElement('pre');
    this.text.style.cssText = 'margin:0;font:inherit';
    this.el.append(cv, this.text);
    parent.appendChild(this.el);
    try {
      new PerformanceObserver((l) => {
        for (const e of l.getEntries()) {
          this.longs.push(e.startTime + e.duration, e.duration);
          this.longTotal++; this.longWorst = Math.max(this.longWorst, e.duration); this.longLastEnd = e.startTime + e.duration;
        }
      }).observe({ type: 'longtask', buffered: false });
    } catch { /* not supported (Firefox, Safari): the line says n/a */ }
  }

  /** one animation frame's measurements (main.ts frame()) */
  frame(s: FrameSample) {
    this.stats.push(s);
    const heap = (performance as unknown as { memory?: HeapInfo }).memory?.usedJSHeapSize;
    if (heap !== undefined) {
      if (this.lastHeap - heap > 1 << 20) this.gcs.push({ t: s.t, mb: (this.lastHeap - heap) / (1 << 20) });
      this.lastHeap = heap;
    }
    // the graph: one column per frame, drawn incrementally (a ring of columns, scrolled by drawing from `col`)
    const c = this.col;
    this.cols[c] = s.frame;
    this.parts[c * 3] = s.sim; this.parts[c * 3 + 1] = s.render; this.parts[c * 3 + 2] = s.ui;
    this.col = (c + 1) % W;
    this.draw();
    this.textT -= s.frame;
    if (this.textT <= 0) { this.textT = 250; this.writeText(s.t, heap); }
  }

  private draw() {
    const g = this.g, y = (ms: number) => H - Math.min(H, (ms / MAX_MS) * H);
    g.clearRect(0, 0, W, H);
    const n = this.cols.length;
    for (let k = 0; k < n; k++) {
      const i = (this.col + k) % n, x = W - n + k;
      let base = H;
      const pc = ['#4f8cff', '#ff9b3d', '#47c97a'];
      for (let p = 0; p < 3; p++) { const h = Math.min(base, (this.parts[i * 3 + p] / MAX_MS) * H); if (h > 0) { g.fillStyle = pc[p]; g.fillRect(x, base - h, 1, h); base -= h; } }
      const f = this.cols[i];
      g.fillStyle = f > 34 ? '#ff4d4d' : f > 20 ? '#ffd84d' : '#ffffff';
      g.fillRect(x, y(f), 1, 2);
    }
    const st = this.stats.stats();
    g.fillStyle = 'rgba(255,255,255,.35)'; g.fillRect(0, y(1000 / 60), W, 1);
    if (st && Math.abs(st.refresh - 1000 / 60) > 1) { g.fillStyle = 'rgba(120,200,255,.45)'; g.fillRect(0, y(st.refresh), W, 1); }
  }

  private writeText(now: number, heap: number | undefined) {
    const s = this.stats.stats();
    if (!s) return;
    while (this.longs.length && now - this.longs[0] > 5000) this.longs.splice(0, 2);
    while (this.gcs.length && now - this.gcs[0].t > 5000) this.gcs.shift();
    let longN = 0, longMax = 0;
    for (let i = 0; i < this.longs.length; i += 2) { longN++; longMax = Math.max(longMax, this.longs[i + 1]); }
    const f1 = (v: number) => v.toFixed(1).padStart(5);
    const hz = 1000 / s.refresh;
    const tk = s.ticks, tn = Math.max(1, s.frames);
    const pct = (v: number) => `${Math.round((v / tn) * 100)}%`;
    const gcMb = this.gcs.reduce((a, b) => a + b.mb, 0);
    const longOk = !!PerformanceObserver.supportedEntryTypes?.includes('longtask');
    this.text.textContent = [
      `fps ${s.fps.toFixed(0)} (display ~${hz.toFixed(0)} Hz)   frames ${s.frames} / ${s.span.toFixed(1)} s`,
      `frame ms  p50 ${f1(s.frame.p50)}  p95 ${f1(s.frame.p95)}  p99 ${f1(s.frame.p99)}`,
      `worst 5 s ${f1(s.frame.max)} ms, ${s.frame.maxAgo.toFixed(1)} s ago   hitches ${s.hitches}`,
      `cpu ms p50/max  sim ${f1(s.sim.p50)}/${f1(s.sim.max)}  render ${f1(s.render.p50)}/${f1(s.render.max)}`,
      `                hud ${f1(s.ui.p50)}/${f1(s.ui.max)}`,
      `ticks/frame  0: ${pct(tk[0])}  1: ${pct(tk[1])}  2: ${pct(tk[2])}  3+: ${pct(tk[3])}`,
      `mouse look  frames ${s.look.frames}  gaps ${s.look.gaps}`,
      `long tasks >50 ms  5 s: ${this.longs.length ? `${longN} (max ${longMax.toFixed(0)} ms)` : longOk ? '0' : 'n/a'}   ` +
        (longOk ? `session: ${this.longTotal}${this.longTotal ? ` (max ${this.longWorst.toFixed(0)} ms, last ${((now - this.longLastEnd) / 1000).toFixed(0)} s ago)` : ''}` : ''),
      heap !== undefined ? `heap ${(heap / (1 << 20)).toFixed(0)} MB  gc ${this.gcs.length} (${gcMb.toFixed(0)} MB)` : 'heap n/a',
    ].join('\n');
  }
}
