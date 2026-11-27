// Render budgets (docs/WORLDGEN3D.md Q20, recalibrated by I2a on the reference machine; docs/RENDER3D.md "Budgets").
// Starting tunables, like the rest of Q20's table: the counts are what G1b's builders, `dress` and I2b's effects are
// gated against; the times are CI measurements with tools/s2matrix.mjs, never a runtime cut-off (Q13.1).
//
// Reference: Apple M3 Max, headed Chrome, 1920 × 1080 at pixel ratio 1, the WebGL 2 backend (Q20(c)'s baseline), GPU
// time p95 from the backend's timestamp queries, S2's scene (the range, 240 actors, the camera orbiting).
// The rule (I2a, decided without asking, D10): the frame's GPU time stays ≤ 4.0 ms p95 there, a quarter of a 60 Hz
// frame, so a GPU four times slower still holds 60 Hz; S2's category shares (12.5 ms proposal) scaled to it.

export const RENDER_BUDGET = {
  /** the whole frame, GPU p95 on the reference (ms) */
  frameMs: 4.0,
  /** S2's shares of the frame (ms on the reference) */
  categoryMs: { terrain: 1.28, actors: 0.96, effects: 0.64, shadows: 0.64, post: 0.48 },
  /** backdrop (Q17.8, Q23): its own budget, outside the dressing caps; measured +0.26 ms p95 at 160,000 triangles */
  backdrop: { triangles: 150_000, ms: 0.25 },
  /** particle cards (Q23 effect cards: glow sprites, atmosphere emitters), additive and code-made: cards about 1.2 m
   *  across within 12 m of the lens; measured +0.25 ms p95 at 1,000 */
  particleCards: { cards: 1_000, ms: 0.32 },
  /** strokes (Q23.6 painted accents as geometry): measured +0.07 ms p50 at 60,000 triangles, +0.37 at 240,000 */
  strokes: { triangles: 120_000, ms: 0.2 },
} as const;
