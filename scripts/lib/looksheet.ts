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
