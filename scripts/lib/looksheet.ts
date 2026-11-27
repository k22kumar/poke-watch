// The look sheet's grid and maps (docs/looksheet, ROADMAP F111): one list for the lint, the captures and the
// measurements. The query strings are the page's dev experiment layer (src/render/world3d/devlayer.ts).
// Round 1 (2026-11-27) had a ramp axis r (smooth | `bands=3&soft=0.3`); round 2 dropped it (owner: it moves mark 1 by
// under 0.3 ΔL* and does not show in frames; it returns later as a feel question).
// Round 3 (owner, 2026-11-27): the facet tone is the profile's, locked to orientation (+0.06 tops, −0.06 sides), so
// both paint variants carry it and the moderate set adds the vertical gradient, edge light and strata.
export const LOOK_AXES = {
  p: ['', 'vgrad=0.25&edge=0.12&strata=0.08'],
  i: ['', 'ink=1&inkshare=0.35'],
} as const;

export const LOOK_VARIANTS = [0, 1].flatMap((p) => [0, 1].map((i) => ({
  id: `p${p}i${i}`,
  query: [LOOK_AXES.p[p], LOOK_AXES.i[i]].filter(Boolean).join('&'),
})));

/** a camera pose: stand at (x, z) on the map's surface, face `yaw` (rad; forward = (sin, cos)), pitch the view down by
 *  `pitch` (rad). `spawn` is round 1's pose */
export interface LookPose { id: string; at?: [number, number]; yaw?: number; pitch?: number }

/** tuned on these two; Chargestone Cave and the dusk lagoon are hold-outs, never captured before the pick */
export const LOOK_MAPS: { id: string; binding: string; query: string; poses: LookPose[] }[] = [
  // the ledge: on the range's 2 m terrace, 5 m back from its edge (x −18.5), turned across it toward the field
  { id: 'range', binding: 'meadow', query: 'go=1&mode=range&species=charmander', poses: [{ id: 'spawn' }, { id: 'ledge', at: [-23.5, -4.5], yaw: Math.PI / 2 + 0.5, pitch: 0.3 }] },
  // the cliff: on River Gorge's 6 m bluff, 4 m back from its edge (z 21.5), looking down over the river
  { id: 'gorge', binding: 'forest', query: 'go=1&mode=range&species=charmander&map=river-gorge&mapseed=1', poses: [{ id: 'spawn' }, { id: 'ledge', at: [-15.5, 25.5], yaw: Math.PI + 0.5, pitch: 0.35 }] },
];

/** the hold-outs, opened only after the owner's pick (2026-11-27, p1i1): the shipped profile shown on maps the sheet was
 *  not tuned on. Chargestone Cave (a cave, 11:00) and Cascade Lagoon's dusk variant (the night binding, 22:00) */
export const HOLD_OUT_MAPS: { id: string; binding: string; query: string; poses: LookPose[] }[] = [
  // the ledge: 3 m above the cave floor, 3 m back from its edge (x 22.5), turned across it
  { id: 'chargestone', binding: 'chargestone', query: 'go=1&mode=range&species=charmander&map=chargestone-cave&mapseed=1', poses: [{ id: 'spawn' }, { id: 'ledge', at: [19.5, 19.5], yaw: Math.PI / 2 + 0.5, pitch: 0.35 }] },
  // the bank: 2.1 m above the shore, 4 m back from its edge (x −32.5), turned across it
  { id: 'dusklagoon', binding: 'dusk', query: 'go=1&mode=range&species=charmander&map=cascade-lagoon/dusk&mapseed=1', poses: [{ id: 'spawn' }, { id: 'ledge', at: [-28.5, 17.5], yaw: -Math.PI / 2 + 0.5, pitch: 0.35 }] },
];

/** the owner's cave and night sweep (2026-11-27, after the hold-outs): per hold-out map, the key share at the fixed hour
 *  (night now 23:00), then at the best share the facet tone 0.10 against 0.06, and on Chargestone a random side tone on
 *  top of the locked facet tone. `base` is the provisional split (cave 0.4, night 0.45). The query strings are the dev
 *  experiment layer's (`key`, `facet`, `facetjitter`). */
export const HOLD_OUT_SWEEP: Record<string, { id: string; query: string }[]> = {
  // the best share is the highest mark-1 minimum that does not crush (shadowed top L* ≥ 20): Chargestone 0.50 (0.55
  // crushes, 19.7), the lagoon 0.55 (0.65 crushes, 18.3). Measured with scripts/toplint.ts --holdout-sweep before any frame
  chargestone: [{ id: 'base', query: '' }, { id: 'k50', query: 'key=0.5' }, { id: 'k55', query: 'key=0.55' }, { id: 'k65', query: 'key=0.65' },
    { id: 'k50-f10', query: 'key=0.5&facet=0.1' }, { id: 'k50-jit03', query: 'key=0.5&facetjitter=0.03' }],
  dusklagoon: [{ id: 'base', query: '' }, { id: 'k50', query: 'key=0.5' }, { id: 'k55', query: 'key=0.55' }, { id: 'k65', query: 'key=0.65' },
    { id: 'k55-f10', query: 'key=0.55&facet=0.1' }],
};
