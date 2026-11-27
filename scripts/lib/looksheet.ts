// The look sheet's grid and maps (docs/looksheet, ROADMAP F111): one list for the lint, the captures and the
// measurements. The query strings are the page's dev experiment layer (src/render/world3d/devlayer.ts).
export const LOOK_AXES = {
  r: ['', 'bands=3&soft=0.3'],
  p: ['', 'facet=0.06&vgrad=0.25&edge=0.12&strata=0.08'],
  i: ['', 'ink=1&inkshare=0.35'],
} as const;

export const LOOK_VARIANTS = [0, 1].flatMap((r) => [0, 1].flatMap((p) => [0, 1].map((i) => ({
  id: `r${r}p${p}i${i}`,
  query: [LOOK_AXES.r[r], LOOK_AXES.p[p], LOOK_AXES.i[i]].filter(Boolean).join('&'),
}))));

/** tuned on these two; Chargestone Cave and the dusk lagoon are hold-outs, never captured before the pick */
export const LOOK_MAPS = [
  { id: 'range', binding: 'meadow', query: 'go=1&mode=range&species=charmander' },
  { id: 'gorge', binding: 'forest', query: 'go=1&mode=range&species=charmander&map=river-gorge&mapseed=1' },
];
