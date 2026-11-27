# The `lowpoly` look sheet (ROADMAP F111)

The owner picks the ramp, the paint terms and the ink of the `lowpoly` profile from these frames (owner, 2026-11-27).
Claude builds the sheet and measures it; it does not pick. After the pick, the picks are applied and shown on the
hold-out maps.

## Pass marks

Written 2026-11-27, before any capture of the sheet existed, and committed on their own so the order is on record.

1. **Tops read apart from sides** (WORLDGEN3D Q23.3). For every role the tile maps write (ground, path, soil, rock,
   cliff, floor, cover, foliage, trunk), on the map's binding (the range: `meadow`; River Gorge: `forest`) at its fixed
   hour (10:00), the resolved top tone and the resolved side tone differ by **ΔL\* ≥ 12** (CIE L\*, the camouflage
   line of `src/render/metrics.ts`).
   - Top: an open-sky face looking up, with the facet tone at its darkest (−facet tone), at the local top (no
     vertical gradient).
   - Side: the **brightest** of the four vertical faces (±x, ±z; the one facing the sun at 10:00), open sky, with the
     facet tone at its brightest (+facet tone), at its top edge (no vertical gradient), between strata bands.
   - So the mark is the worst case the shader can produce, computed from the same maths as the shader
     (`scripts/toplint.ts`). Ink and edge light draw lines, not tones, and do not enter it.
   - A variant passes when every role passes on both maps; the table lists the smallest gap and its role.
2. **Signals keep their colour.** `tools/three-signal.mjs` with the variant's parameters reads (255, 102, 32) within ±2
   at all four signal points, in all five of its variants, on both backends.
3. **The frame stays within budget.** GPU time ≤ 4.0 ms p95 (`src/rules/styles/budgets.ts`) by `tools/s2perf.mjs` at
   1920 × 1080 on the WebGL 2 backend (the budget's baseline), S2's scene (240 actors frozen, the camera orbiting), on
   the range and on River Gorge. WebGPU is measured too and listed for information.

A variant that fails any mark is still shown, marked fail.

## The grid

At 10:00 (the fixed hour), 2 × 2 × 2 = 8 variants per map, all from one camera pose per map with a creature in frame
(the spawn pose in capture mode, after 1 s; the player is in frame, and on the range the dummies too).

| | 0 | 1 |
|---|---|---|
| r: ramp | smooth (continuous, today's) | 3 bands with soft edges (`bands=3&soft=0.3`) |
| p: paint | all 0 (today's) | moderate: facet tone 0.06, vertical gradient 0.25, edge light 0.12, strata 0.08 on steep faces only (`facet=0.06&vgrad=0.25&edge=0.12&strata=0.08`) |
| i: ink | off (today's) | thin (1 px) and dark (sRGB 0.08, 0.07, 0.10) with a low world share: weight 1, every world role's share 0.35 (`ink=1&inkshare=0.35`) |

The moderate paint values and the ink share are the sheet's sample points, not picks.

**Maps.** Tuned on the range and River Gorge (seed 1). **Hold-outs: Chargestone Cave and the dusk lagoon** (Cascade
Lagoon, its `dusk` variant): no frame of either is taken or looked at until the variants are picked.

## Results (2026-11-27)

Build: `feat/i2a-look-sheet`, three 0.187.0, Apple M3 Max, headed Chrome for Testing, real GPU. Frames 1280 × 720 on
WebGPU, the 3D canvas alone (HUD hidden). Marks: `npx tsx tools/looksheet.ts <build>/index.html docs/looksheet/2026-11-27`
(`results.json` holds every number and the signal check's full output per variant).

**No variant passes: all eight fail mark 1.** Marks 2 and 3 pass everywhere: the signals read (255, 102, 32) in all
80 runs, and the heaviest variant costs 1.51 ms p95 against 4.0.

| Variant | Ramp | Paint | Ink | 1. Top/side min ΔL* (≥ 12) | info: mean-side min ΔL* | 2. Signals | 3. GPU p95 WebGL 2, range / gorge (≤ 4.0) | WebGPU p50 / p95, range; gorge | Result |
|---|---|---|---|---|---|---|---|---|---|
| r0p0i0 | smooth | 0 | off | **fail** 5.6 (range trunk) | 13.8 | pass | pass 1.08 / 1.15 | 0.87 / 0.99; 0.94 / 1.1 | **fail** (mark 1) |
| r0p0i1 | smooth | 0 | thin, share 0.35 | **fail** 5.6 (range trunk) | 13.8 | pass | pass 1.22 / 1.51 | 0.94 / 1.17; 1.12 / 1.28 | **fail** (mark 1) |
| r0p1i0 | smooth | moderate | off | **fail** 3.4 (range trunk) | 14.7 | pass | pass 1.2 / 1.25 | 1 / 1.19; 1.06 / 1.3 | **fail** (mark 1) |
| r0p1i1 | smooth | moderate | thin, share 0.35 | **fail** 3.4 (range trunk) | 14.7 | pass | pass 1.32 / 1.32 | 1.03 / 1.22; 1.12 / 1.31 | **fail** (mark 1) |
| r1p0i0 | 3 soft bands | 0 | off | **fail** 5.7 (range trunk) | 11.6 | pass | pass 1.1 / 1.2 | 0.85 / 1.01; 0.91 / 1.1 | **fail** (mark 1) |
| r1p0i1 | 3 soft bands | 0 | thin, share 0.35 | **fail** 5.7 (range trunk) | 11.6 | pass | pass 1.3 / 1.33 | 0.94 / 1.16; 1.04 / 1.23 | **fail** (mark 1) |
| r1p1i0 | 3 soft bands | moderate | off | **fail** 3.7 (range trunk) | 12.4 | pass | pass 1.29 / 1.27 | 1.01 / 1.22; 1.08 / 1.31 | **fail** (mark 1) |
| r1p1i1 | 3 soft bands | moderate | thin, share 0.35 | **fail** 3.7 (range trunk) | 12.4 | pass | pass 1.29 / 1.4 | 1.08 / 1.23; 1.1 / 1.32 | **fail** (mark 1) |

### Mark 1 per role (ΔL\*, darkest top against brightest side; `npx tsx scripts/toplint.ts`)

```
r0p0i0   FAIL  min ΔL* 5.6 (range trunk)   info: min mean-side ΔL* 13.8
         range  ground 9.3  path 9.7  soil 8.8  rock 10.2  cliff 8.0  floor 9.8  cover 8.9  foliage 7.9  trunk 5.6
         gorge  ground 8.7  path 8.2  soil 7.6  rock 10.2  cliff 6.9  floor 9.9  cover 8.1  foliage 8.0  trunk 5.6
r0p0i1   FAIL  min ΔL* 5.6 (range trunk)   info: min mean-side ΔL* 13.8
         range  ground 9.3  path 9.7  soil 8.8  rock 10.2  cliff 8.0  floor 9.8  cover 8.9  foliage 7.9  trunk 5.6
         gorge  ground 8.7  path 8.2  soil 7.6  rock 10.2  cliff 6.9  floor 9.9  cover 8.1  foliage 8.0  trunk 5.6
r0p1i0   FAIL  min ΔL* 3.4 (range trunk)   info: min mean-side ΔL* 14.7
         range  ground 5.8  path 6.0  soil 5.5  rock 6.4  cliff 4.9  floor 6.1  cover 5.5  foliage 5.0  trunk 3.4
         gorge  ground 5.4  path 5.1  soil 4.7  rock 6.4  cliff 4.3  floor 6.2  cover 5.1  foliage 5.0  trunk 3.5
r0p1i1   FAIL  min ΔL* 3.4 (range trunk)   info: min mean-side ΔL* 14.7
         range  ground 5.8  path 6.0  soil 5.5  rock 6.4  cliff 4.9  floor 6.1  cover 5.5  foliage 5.0  trunk 3.4
         gorge  ground 5.4  path 5.1  soil 4.7  rock 6.4  cliff 4.3  floor 6.2  cover 5.1  foliage 5.0  trunk 3.5
r1p0i0   FAIL  min ΔL* 5.7 (range trunk)   info: min mean-side ΔL* 11.6
         range  ground 9.5  path 9.9  soil 9.0  rock 10.5  cliff 8.2  floor 10.0  cover 9.1  foliage 8.1  trunk 5.7
         gorge  ground 8.9  path 8.4  soil 7.7  rock 10.5  cliff 7.0  floor 10.1  cover 8.3  foliage 8.2  trunk 5.7
r1p0i1   FAIL  min ΔL* 5.7 (range trunk)   info: min mean-side ΔL* 11.6
         range  ground 9.5  path 9.9  soil 9.0  rock 10.5  cliff 8.2  floor 10.0  cover 9.1  foliage 8.1  trunk 5.7
         gorge  ground 8.9  path 8.4  soil 7.7  rock 10.5  cliff 7.0  floor 10.1  cover 8.3  foliage 8.2  trunk 5.7
r1p1i0   FAIL  min ΔL* 3.7 (range trunk)   info: min mean-side ΔL* 12.4
         range  ground 6.2  path 6.4  soil 5.9  rock 6.8  cliff 5.3  floor 6.5  cover 5.9  foliage 5.3  trunk 3.7
         gorge  ground 5.8  path 5.4  soil 5.0  rock 6.8  cliff 4.6  floor 6.6  cover 5.4  foliage 5.4  trunk 3.7
r1p1i1   FAIL  min ΔL* 3.7 (range trunk)   info: min mean-side ΔL* 12.4
         range  ground 6.2  path 6.4  soil 5.9  rock 6.8  cliff 5.3  floor 6.5  cover 5.9  foliage 5.3  trunk 3.7
         gorge  ground 5.8  path 5.4  soil 5.0  rock 6.8  cliff 4.6  floor 6.6  cover 5.4  foliage 5.4  trunk 3.7
```

### Why mark 1 fails, and what the grid does not reach

Measured, not a pick:

- **The gap comes from the light split, which the grid holds fixed.** At 10:00 the key light stands 60° up on the flank
  side. The sun-facing side gets 0.75 × cos 60° of key plus the side ambient (0.35), about 0.72 of what an open top
  gets. That is 8–10 ΔL\* on mid-tone roles and 5.6 on the darkest (trunk), against 12. That split is the key-to-ambient
  share (0.65 day) and the fixed hour, both kept provisional or accepted on 2026-11-27.
- **The sides away from the sun are darker.** The mean of the four sides (information column) is 11.6–14.7 below the
  top, around the line; the sun-facing side is the one that sits close to its top.
- **The paint set narrows the worst case.** Facet tone ±0.06 brightens a side and darkens a top by up to 6 % each:
  about −2.4 ΔL\*. The vertical gradient only acts below the top edge, where the mark does not look; it widens the
  mean (+0.9).
- **Three bands barely move it** (+0.1 to +0.3). At 10:00 they quantise the top's n·l from 0.87 to 0.67 and the sun
  side's from 0.5 to 0.33: both lose about the same share of key light, so their ratio hardly changes (the mean gap
  narrows, 13.8 → 11.6, because the top loses most).
- **Ink and edge light** draw lines, not tones, so they cannot change mark 1. On screen they are what separates a
  top from a side at its edge.
- The levers outside this grid are each a look call: a higher key share against the ambient (more of the top's
  light then comes from overhead) or a higher sun (an earlier or later hour lowers it and narrows the gap); a top
  treatment from Q23.3's closed list (caps, lips,
  bands, bevels, deposits: G1b's builders); a per-role side tint; or a mark measured differently (the mean side, or a
  ΔE instead of ΔL\*).

### Frames

Hold-outs (Chargestone Cave, the dusk lagoon): not loaded or captured.

| Variant | Range | River Gorge |
|---|---|---|
| r0p0i0 | ![range r0p0i0](2026-11-27/range-r0p0i0.png) | ![gorge r0p0i0](2026-11-27/gorge-r0p0i0.png) |
| r0p0i1 | ![range r0p0i1](2026-11-27/range-r0p0i1.png) | ![gorge r0p0i1](2026-11-27/gorge-r0p0i1.png) |
| r0p1i0 | ![range r0p1i0](2026-11-27/range-r0p1i0.png) | ![gorge r0p1i0](2026-11-27/gorge-r0p1i0.png) |
| r0p1i1 | ![range r0p1i1](2026-11-27/range-r0p1i1.png) | ![gorge r0p1i1](2026-11-27/gorge-r0p1i1.png) |
| r1p0i0 | ![range r1p0i0](2026-11-27/range-r1p0i0.png) | ![gorge r1p0i0](2026-11-27/gorge-r1p0i0.png) |
| r1p0i1 | ![range r1p0i1](2026-11-27/range-r1p0i1.png) | ![gorge r1p0i1](2026-11-27/gorge-r1p0i1.png) |
| r1p1i0 | ![range r1p1i0](2026-11-27/range-r1p1i0.png) | ![gorge r1p1i0](2026-11-27/gorge-r1p1i0.png) |
| r1p1i1 | ![range r1p1i1](2026-11-27/range-r1p1i1.png) | ![gorge r1p1i1](2026-11-27/gorge-r1p1i1.png) |

## Round 2 (owner, 2026-11-27): the plan

The owner's changes after round 1: no pick yet; mark 1 unchanged; the bands axis dropped (it moves mark 1 by under 0.3
ΔL\* and does not show in frames; it returns later as a feel question); a toplint-only sweep before any capture; a
second pose per map; the ink checked against fog. Hold-outs stay closed. Written and committed before the sweep runs.

### The sweep (no frames)

`npx tsx scripts/toplint.ts --sweep`: mark 1 exactly as written above (darkest top against brightest side, ΔL\* ≥ 12,
every written role, both bindings), over:

- **key share** at the fixed hour (the key light's part of an open top's light, the rest ambient): 0.65 (today),
  0.75, 0.85;
- **the fixed hour:** 10:00 (the sun 60° up) and 11:00 (75° up: a higher sun). The keyframes are anchored at the
  hour swept, so an open top still shows its base colour there;
- **facet tone**, at the moderate set's 0.06: ± by plane (today: the mark takes the darkest top, −0.06, against the
  brightest side, +0.06), and locked to orientation (tops +0.06, sides −0.06); and 0 for reference.

The other paint terms do not enter mark 1 (the vertical gradient acts below the top edge, strata between bands,
edge light and ink draw lines). The report lists min ΔL\* per role for every cell.

**Crushing the ambient**, declared now: a light split crushes the ambient when the darkest written role's open top,
in full shadow (ambient only), falls below **L\* 20** on either binding. The report lists that L\* per cell. A split
that gets trunk and cliff to 12 only by crushing does not count.

If no cell gets trunk and cliff to 12 without crushing, mark 1 for the dark roles goes to G1b's top builders (Q23.3's
treatments, F111), and the owner picks ink and paint on feel.

### The re-capture

Paint (0 or moderate) × ink (off or thin, share 0.35): four variants, at 10:00 and today's key share (the sweep
changes nothing in the frames until the owner says so), on two poses per map: the spawn pose of round 1, and one
looking down onto a ledge or cliff top so tops are in frame. Marks 2 and 3 per variant as before.

## Round 2: the sweep's result

`npx tsx scripts/toplint.ts --sweep` (min ΔL\* per role over both bindings; the last column is the darkest role's open
top in full shadow, crushed below L\* 20):

```
share hour facet            ground    path    soil    rock   cliff   floor   cover foliage   trunk   min  shadowTop L*min
0.65  10   0                   8.7     8.2     7.6    10.2     6.9     9.8     8.1     7.9     5.6   5.6    23.1
0.65  10   ±0.06 by plane      5.4     5.1     4.7     6.4     4.3     6.1     5.1       5     3.4   3.4    23.1
0.65  10   oriented 0.06      11.9    11.3    10.4      14     9.4    13.5    11.2    10.9     7.7   7.7    23.1
0.65  11   0                  16.4    15.7    14.5    19.5    13.1    18.9    15.5      15    10.8  10.8    23.1
0.65  11   ±0.06 by plane     13.3    12.7    11.8    15.9    10.7    15.3    12.6    12.2     8.7   8.7    23.1
0.65  11   oriented 0.06      19.5    18.6    17.2    23.2    15.6    22.4    18.4    17.8    12.8  12.8    23.1
0.75  10   0                  10.1     9.6     8.9      12     8.1    11.6     9.6     9.3     6.6   6.6    19 crushed
0.75  10   ±0.06 by plane      6.9     6.6     6.1     8.2     5.5     7.9     6.5     6.4     4.5   4.5    19 crushed
0.75  10   oriented 0.06      13.3    12.7    11.8    15.8    10.6    15.3    12.6    12.2     8.7   8.7    19 crushed
0.75  11   0                  19.7    18.9    17.5    23.5    15.8    22.8    18.6    18.1      13    13    19 crushed
0.75  11   ±0.06 by plane     16.7      16    14.8    19.9    13.4    19.3    15.8    15.3      11    11    19 crushed
0.75  11   oriented 0.06      22.7    21.8    20.2    27.1    18.2    26.2    21.5    20.8      15    15    19 crushed
0.85  10   0                  11.7    11.2    10.3    13.9     9.4    13.5      11    10.7     7.7   7.7    13.5 crushed
0.85  10   ±0.06 by plane      8.5     8.1     7.5    10.1     6.8     9.8       8     7.8     5.6   5.6    13.5 crushed
0.85  10   oriented 0.06      14.9    14.2    13.1    17.7    11.9    17.1      14    13.6     9.8   9.8    13.5 crushed
0.85  11   0                  23.4    22.5    20.8      28    18.8    27.1    22.2    21.5    15.5  15.5    13.5 crushed
0.85  11   ±0.06 by plane     20.5    19.7    18.2    24.5    16.5    23.7    19.4    18.8    13.6  13.6    13.5 crushed
0.85  11   oriented 0.06      26.4    25.3    23.4    31.4    21.2    30.5    24.9    24.2    17.5  17.5    13.5 crushed
```

- **One cell passes mark 1 for every role without crushing:** key share 0.65 (today's), fixed hour **11:00**, facet
  tone **locked to orientation** (tops +0.06, sides −0.06): trunk 12.8, cliff 15.6, every other role 15.6 or more;
  the shadowed top keeps L\* 23.1.
- **At 10:00 no cell passes**, crushed or not: the best is 9.8 on trunk (0.85, oriented), which crushes (L\* 13.5).
- **0.75 and 0.85 crush the ambient** by the line declared before the run (L\* 19.0 and 13.5 < 20). At 11:00, 0.75
  with facet 0 or oriented would pass mark 1, but crushed.
- **The facet tone by plane (today's shader) always hurts the worst case** (about −2 to −3 ΔL\*); locked to
  orientation it adds about +2 to +4, acting as a top/side tone term.
- So: mark 1 for the dark roles can be met by a light split, but only with **two changes that are the owner's**: the
  fixed hour 11:00 instead of the accepted 10:00, and facet tone locked to orientation (the shader has only the
  per-plane hash today; the lock is in the lint, not yet built). Otherwise it goes to G1b's top builders (F111).
  Nothing in the frames changes until the owner says.

## Round 2: the re-capture

Build: `feat/i2a-look-sheet` with the ink fog fix (below), same machine and method as round 1; the grid without the
bands axis, at 10:00 and today's key share; two poses per map. The ledge pose stands on the range's 2 m terrace,
5 m back from its edge, turned across it toward the field. The cliff pose stands on River Gorge's 6 m bluff, 4 m back
from its edge, looking down over the river. `results.json` holds every number.

| Variant | Paint | Ink | 1. Top/side min ΔL* (≥ 12) | 2. Signals | 3. GPU p95 WebGL 2, range / gorge (≤ 4.0) | WebGPU p50 / p95, range; gorge | Result |
|---|---|---|---|---|---|---|---|
| p0i0 | 0 | off | **fail** 5.6 (range trunk) | pass | pass 1.24 / 1.29 | 0.89 / 1.01; 0.93 / 1.1 | **fail** (mark 1) |
| p0i1 | 0 | thin, share 0.35 | **fail** 5.6 (range trunk) | pass | pass 1.37 / 1.42 | 1.12 / 1.22; 1.15 / 1.32 | **fail** (mark 1) |
| p1i0 | moderate | off | **fail** 3.4 (range trunk) | pass | pass 1.38 / 1.44 | 1.14 / 1.26; 1.19 / 1.38 | **fail** (mark 1) |
| p1i1 | moderate | thin, share 0.35 | **fail** 3.4 (range trunk) | pass | pass 1.41 / 1.44 | 1.14 / 1.27; 1.2 / 1.38 | **fail** (mark 1) |

Mark 1 is the round-1 number for each variant, unchanged (the frames are at 10:00 and the key share 0.65; the sweep
above lists what other splits would do). Marks 2 and 3 pass for all four: signals 40 of 40, at most 1.44 ms p95.

### The ink and the fog

The owner's report holds: in round 1 the ink and edge-light lines showed through the fog on far blocks (gorge,
r1p1i1). Two faults:

- The ink pass runs after the scene's fog, so its lines were never fogged.
- The pass computed depth with the `camera*` nodes, which inside the pipeline's quad pass are the quad's camera: the
  view distance came out near 0. S2's depth edge, ported unchanged, had the same fault.

Fixed (`src/render/three/passes.ts`): the pass reads the scene camera's projection and near/far explicitly. The ink
colour is fogged with the scene's own curve and colour at each pixel's view distance, and edge light fades by the
same amount. A line now loses contrast exactly as its surface does. The first try faded only the line's opacity,
which still left dark lines over fogged fill; it was replaced before the round-2 frames were taken.

### Frames

Hold-outs (Chargestone Cave, the dusk lagoon): not loaded or captured.

| Variant | Range, spawn | Range, ledge | River Gorge, spawn | River Gorge, cliff |
|---|---|---|---|---|
| p0i0 | ![range-spawn p0i0](2026-11-27-r2/range-spawn-p0i0.png) | ![range-ledge p0i0](2026-11-27-r2/range-ledge-p0i0.png) | ![gorge-spawn p0i0](2026-11-27-r2/gorge-spawn-p0i0.png) | ![gorge-ledge p0i0](2026-11-27-r2/gorge-ledge-p0i0.png) |
| p0i1 | ![range-spawn p0i1](2026-11-27-r2/range-spawn-p0i1.png) | ![range-ledge p0i1](2026-11-27-r2/range-ledge-p0i1.png) | ![gorge-spawn p0i1](2026-11-27-r2/gorge-spawn-p0i1.png) | ![gorge-ledge p0i1](2026-11-27-r2/gorge-ledge-p0i1.png) |
| p1i0 | ![range-spawn p1i0](2026-11-27-r2/range-spawn-p1i0.png) | ![range-ledge p1i0](2026-11-27-r2/range-ledge-p1i0.png) | ![gorge-spawn p1i0](2026-11-27-r2/gorge-spawn-p1i0.png) | ![gorge-ledge p1i0](2026-11-27-r2/gorge-ledge-p1i0.png) |
| p1i1 | ![range-spawn p1i1](2026-11-27-r2/range-spawn-p1i1.png) | ![range-ledge p1i1](2026-11-27-r2/range-ledge-p1i1.png) | ![gorge-spawn p1i1](2026-11-27-r2/gorge-spawn-p1i1.png) | ![gorge-ledge p1i1](2026-11-27-r2/gorge-ledge-p1i1.png) |

## Round 3 (owner, 2026-11-27): the plan

The owner's decisions after round 2: the fixed hour moves to 11:00 (day maps and caves; Duskwood Hollow keeps 22:00);
the facet tone is locked to orientation (+0.06 tops, −0.06 sides), built in the shader and the profile; toplint stays
the gate (`tests/looksheet.test.ts`); no ink or paint pick until the 11:00 frames exist; hold-outs stay closed.
Written and committed before the re-shoot.

- The grid: paint (0 | the moderate set's vertical gradient 0.25, edge light 0.12, strata 0.08) × ink (off | thin,
  share 0.35), all four carrying the profile's locked facet tone; 11:00; the same two poses per map as round 2.
- Mark 1 before the frames (`npx tsx scripts/toplint.ts`): all four pass, the smallest gap 12.8 (trunk on the range),
  every shadowed top L\* ≥ 23.
- Marks 2 and 3 by `tools/looksheet.ts`, as before.

## Round 3: results

Build: `feat/i2a-look-sheet` at 043563b (11:00, facet tone locked to orientation, the ink fog fix), same machine and
method as before; frames in `docs/looksheet/2026-11-27-r3/`, numbers in its `results.json`.

**All four variants pass all three marks.** Mark 1 is the same for all four (12.8, trunk on the range): the
vertical gradient, edge light, strata and ink do not change it. Signals 40 of 40; at most 1.34 ms p95.

| Variant | Paint | Ink | 1. Top/side min ΔL* (≥ 12) | 2. Signals | 3. GPU p95 WebGL 2, range / gorge (≤ 4.0) | WebGPU p50 / p95, range; gorge | Result |
|---|---|---|---|---|---|---|---|
| p0i0 | locked facet only | off | **pass** 12.8 (range trunk) | pass | pass 0.98 / 1.11 | 0.86 / 0.98; 0.94 / 1.09 | pass |
| p0i1 | locked facet only | thin, share 0.35 | **pass** 12.8 (range trunk) | pass | pass 1.18 / 1.3 | 1.08 / 1.2; 1.14 / 1.32 | pass |
| p1i0 | locked facet + moderate set | off | **pass** 12.8 (range trunk) | pass | pass 1.21 / 1.32 | 1.13 / 1.22; 1.17 / 1.36 | pass |
| p1i1 | locked facet + moderate set | thin, share 0.35 | **pass** 12.8 (range trunk) | pass | pass 1.24 / 1.34 | 1.1 / 1.22; 1.16 / 1.36 | pass |

Mark 1 per role (`npx tsx scripts/toplint.ts`):

```
p0i0     pass  min ΔL* 12.8 (range trunk)   info: min mean-side ΔL* 17.0
         range  ground 21.1  path 22.0  soil 20.2  rock 23.2  cliff 18.3  floor 22.4  cover 20.2  foliage 17.8  trunk 12.8
         gorge  ground 19.5  path 18.6  soil 17.2  rock 23.2  cliff 15.6  floor 22.5  cover 18.4  foliage 17.9  trunk 12.8
p0i1     pass  min ΔL* 12.8 (range trunk)   info: min mean-side ΔL* 17.0
         range  ground 21.1  path 22.0  soil 20.2  rock 23.2  cliff 18.3  floor 22.4  cover 20.2  foliage 17.8  trunk 12.8
         gorge  ground 19.5  path 18.6  soil 17.2  rock 23.2  cliff 15.6  floor 22.5  cover 18.4  foliage 17.9  trunk 12.8
p1i0     pass  min ΔL* 12.8 (range trunk)   info: min mean-side ΔL* 17.9
         range  ground 21.1  path 22.0  soil 20.2  rock 23.2  cliff 18.3  floor 22.4  cover 20.2  foliage 17.8  trunk 12.8
         gorge  ground 19.5  path 18.6  soil 17.2  rock 23.2  cliff 15.6  floor 22.5  cover 18.4  foliage 17.9  trunk 12.8
p1i1     pass  min ΔL* 12.8 (range trunk)   info: min mean-side ΔL* 17.9
         range  ground 21.1  path 22.0  soil 20.2  rock 23.2  cliff 18.3  floor 22.4  cover 20.2  foliage 17.8  trunk 12.8
         gorge  ground 19.5  path 18.6  soil 17.2  rock 23.2  cliff 15.6  floor 22.5  cover 18.4  foliage 17.9  trunk 12.8
```

The pick is the owner's: paint (locked facet only, or with the moderate set) and ink (off, or thin at share 0.35).
Then the picks are applied and shown on the hold-outs (Chargestone Cave, the dusk lagoon), which are still closed.

### Frames

| Variant | Range, spawn | Range, ledge | River Gorge, spawn | River Gorge, cliff |
|---|---|---|---|---|
| p0i0 | ![range-spawn p0i0](2026-11-27-r3/range-spawn-p0i0.png) | ![range-ledge p0i0](2026-11-27-r3/range-ledge-p0i0.png) | ![gorge-spawn p0i0](2026-11-27-r3/gorge-spawn-p0i0.png) | ![gorge-ledge p0i0](2026-11-27-r3/gorge-ledge-p0i0.png) |
| p0i1 | ![range-spawn p0i1](2026-11-27-r3/range-spawn-p0i1.png) | ![range-ledge p0i1](2026-11-27-r3/range-ledge-p0i1.png) | ![gorge-spawn p0i1](2026-11-27-r3/gorge-spawn-p0i1.png) | ![gorge-ledge p0i1](2026-11-27-r3/gorge-ledge-p0i1.png) |
| p1i0 | ![range-spawn p1i0](2026-11-27-r3/range-spawn-p1i0.png) | ![range-ledge p1i0](2026-11-27-r3/range-ledge-p1i0.png) | ![gorge-spawn p1i0](2026-11-27-r3/gorge-spawn-p1i0.png) | ![gorge-ledge p1i0](2026-11-27-r3/gorge-ledge-p1i0.png) |
| p1i1 | ![range-spawn p1i1](2026-11-27-r3/range-spawn-p1i1.png) | ![range-ledge p1i1](2026-11-27-r3/range-ledge-p1i1.png) | ![gorge-spawn p1i1](2026-11-27-r3/gorge-spawn-p1i1.png) | ![gorge-ledge p1i1](2026-11-27-r3/gorge-ledge-p1i1.png) |

## The pick and the hold-outs (owner, 2026-11-27)

**Pick: p1i1** — the moderate paint set on the locked facet tone, and thin ink at a 0.35 share. Caves at 11:00
confirmed. Applied to the `lowpoly` profile (`src/rules/styles/profiles.ts`): it ships flag-off with the rest of I2a's
look.

Before the hold-outs, the owner asked whether the sky stipple and the rings on the range grass are real. They are, and
both are transcriptions: the sky's six bands and the vignette's four levels are dithered on today's 4 × 4 Bayer grid.
At native resolution that reads as stipple. Switching each off on the range: the sky stipple is the sky's dither; the
rings and the sparse dark dots at the top of the sky are the vignette; the fog shows no banding (ROADMAP F113).

**The hold-outs**, opened after the pick: Chargestone Cave (the cave binding, 11:00) and Cascade Lagoon at dusk (the
night binding, 22:00), seed 1, the shipped profile, two poses each (the spawn, and a ledge chosen the same way as on
the tuning maps). Frames in `docs/looksheet/2026-11-27-holdouts/`, numbers in its `results.json`.

| Map | 1. Top/side min ΔL\* (≥ 12) | Shadowed top L\* (≥ 20) | 2. Signals | 3. GPU p95, WebGL 2 / WebGPU |
|---|---|---|---|---|
| Chargestone Cave | **fail** 6.5 (cliff) | 23.3 | pass (10/10, on the range) | 1.43 / 1.83 ms |
| Cascade Lagoon, dusk | **fail** 5.1 (trunk) | 23.9 | pass (the same run) | 1.70 / 2.63 ms |

```
pick     FAIL  min ΔL* 5.1 (dusklagoon trunk)   info: min mean-side ΔL* 8.9
         chargestone ground 6.6  path 8.9  soil 8.3  rock 7.9  cliff 6.5  floor 14.5  cover 8.8  foliage 14.9  trunk 8.4
         dusklagoon ground 6.8  path 7.8  soil 7.1  rock 8.0  cliff 6.4  floor 10.3  cover 7.0  foliage 6.9  trunk 5.1
```

**Both fail mark 1, as measured; not tuned.** The owner expected dusk to fail; Chargestone fails too. What the numbers
show:

- **Chargestone** is a cave: its key light takes 0.4 of an open top's light at the fixed hour (the provisional cave
  split), against 0.65 on day maps, so the sun-facing side keeps more of the top's light. Its palette is dark and
  blue (tops L\* 30–89), where the same light ratio is fewer ΔL\*. Two roles pass: floor 14.5, foliage 14.9.
- **Dusk** is the night binding at 22:00: its key light is the moon, 0.45 of the top's light, at the antipode of
  10:00 on the path. So the moon stands 60° up, as the sun did at 10:00 before the move to 11:00. No role passes;
  floor is the closest at 10.3.
- Neither crushes the ambient (shadowed tops L\* 23.3 and 23.9).
- Marks 2 and 3 pass.

Seen in the frames, not a mark: on Chargestone's ledge pose the lower half of the player draws as the cyan x-ray
silhouette, because a stair step hides it from that camera (ROADMAP F41's family, I2b's).

| Map | Spawn | Ledge |
|---|---|---|
| Chargestone Cave | ![chargestone spawn](2026-11-27-holdouts/chargestone-spawn-pick.png) | ![chargestone ledge](2026-11-27-holdouts/chargestone-ledge-pick.png) |
| Cascade Lagoon, dusk | ![dusk lagoon spawn](2026-11-27-holdouts/dusklagoon-spawn-pick.png) | ![dusk lagoon ledge](2026-11-27-holdouts/dusklagoon-ledge-pick.png) |

## The cave and night sweep (owner, 2026-11-27): plan and mark 1

The owner's decisions after the hold-outs: night maps move from 22:00 to 23:00; caves and night are fixed by a sweep
the owner picks from; mark 1 keeps its line (ΔL\* ≥ 12); confirmed on Chargestone Cave and the dusk lagoon only; F113
parked. Written and committed, with the mark-1 tables below, before any frame of the sweep.

- **Night at 23:00 first:** the lagoon's mark 1 goes from 5.1 (22:00) to 7.8 (the `base` row below).
- **Key share** at the fixed hour: 0.50, 0.55, 0.65 (and `base`, the provisional split: cave 0.4, night 0.45).
- **The best share** is the highest mark-1 minimum that does not crush (shadowed top L\* ≥ 20): Chargestone 0.50
  (0.55 crushes at 19.7), the lagoon 0.55 (0.65 crushes at 18.3). At it: facet tone ±0.10 against the shipped ±0.06.
- **Chargestone only:** a random tone on side faces on top of the locked facet tone, `facetjitter=0.03`: each side
  face takes its plane's hash (−1..1) × 0.03 over its −0.06; tops are unchanged. Mark 1 takes the brightest case
  (+0.03).
- Frames: the hold-out poses (spawn, ledge), every variant, the rest of the profile as shipped (p1i1). GPU p95 on both
  backends per map and variant. No variant is applied.

Mark 1 per role (ΔL\*) and the smallest shadowed-top L\* (`npx tsx scripts/toplint.ts --holdout-sweep`):

```
chargestone
  variant     ground    path    soil    rock   cliff   floor   cover foliage   trunk    min  shadowTop L* min
  base           6.6     8.9     8.3     7.9     6.5    14.5     8.8    14.9     8.4    6.5  23.3
  k50              8    10.7    10.1     9.5     7.9    17.6    10.6      18    10.2    7.9  21
  k55            8.8    11.7      11    10.4     8.6    19.2    11.6    19.7    11.1    8.6  19.7 crushed
  k65           10.4    13.8      13    12.3    10.2    22.7    13.7    23.2    13.1   10.2  16.8 crushed
  k50-f10        9.2    12.2    11.5    10.9       9      20    12.1    20.5    11.5      9  21.4
  k50-jit03      7.6    10.2     9.6       9     7.5    16.7    10.1    17.1     9.7    7.5  21
dusklagoon
  variant     ground    path    soil    rock   cliff   floor   cover foliage   trunk    min  shadowTop L* min
  base          10.4      12    10.8    12.2     9.7    15.8    10.6    10.5     7.8    7.8  23.9
  k50           11.5    13.2    11.9    13.4    10.6    17.4    11.6    11.5     8.6    8.6  22.6
  k55           12.6    14.4      13    14.6    11.6      19    12.7    12.6     9.4    9.4  21.3
  k65           14.9      17    15.4    17.2    13.7    22.5      15    14.9    11.1   11.1  18.3 crushed
  k55-f10       14.2    16.2    14.7    16.4    13.1    21.4    14.3    14.2    10.6   10.6  21.7
```

**No variant passes mark 1 on either map without crushing.** The closest:

- the lagoon at 0.55 with facet 0.10: only trunk is under 12 (10.6); every other role is 13.1 or more;
- Chargestone at 0.50 with facet 0.10: five roles under 12 (cliff 9.0, ground 9.2, rock 10.9, soil 11.5, trunk 11.5).

The side jitter lowers Chargestone's worst case (7.9 → 7.5 at 0.50), since it brightens some sides.

## The cave and night sweep: frames and timings

Machine: Apple M3 Max (Metal 3). Browser: Chromium 158.0.8127.18 (Playwright's Chrome for Testing), headed, real GPU,
1920 × 1080 at pixel ratio 1, S2's scene (240 actors frozen, the camera orbiting) on each map; GPU p95 from the
backends' timestamp queries. Frames 1280 × 720 on WebGPU, the 3D canvas alone, on the hold-out poses; the rest of the
profile as shipped (p1i1). Build `feat/i2a-look-sheet` at 1b329db; `docs/looksheet/2026-11-27-cavenight/results.json`.
No variant is applied. Bold: a role under 12, or a crushed ambient.

### Chargestone Cave (cave, 11:00; base key 0.40)

| Variant | ground | path | soil | rock | cliff | floor | cover | foliage | trunk | Min (≥ 12) | Shadowed top L* min (≥ 20) | GPU p95 WebGL 2 / WebGPU |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| base (provisional split) | **6.6** | **8.9** | **8.3** | **7.9** | **6.5** | 14.5 | **8.8** | 14.9 | **8.4** | 6.5 fail | 23.3 | 1.39 / 1.77 ms |
| k50 (key 0.50) | **8** | **10.7** | **10.1** | **9.5** | **7.9** | 17.6 | **10.6** | 18 | **10.2** | 7.9 fail | 21 | 1.41 / 1.85 ms |
| k55 (key 0.55) | **8.8** | **11.7** | **11** | **10.4** | **8.6** | 19.2 | **11.6** | 19.7 | **11.1** | 8.6 fail | 19.7 **crushed** | 1.48 / 1.81 ms |
| k65 (key 0.65) | **10.4** | 13.8 | 13 | 12.3 | **10.2** | 22.7 | 13.7 | 23.2 | 13.1 | 10.2 fail | 16.8 **crushed** | 1.4 / 1.8 ms |
| k50-f10 (key 0.50, facet ±0.10) | **9.2** | 12.2 | **11.5** | **10.9** | **9** | 20 | 12.1 | 20.5 | **11.5** | 9 fail | 21.4 | 1.48 / 1.82 ms |
| k50-jit03 (key 0.50, side jitter 0.03) | **7.6** | **10.2** | **9.6** | **9** | **7.5** | 16.7 | **10.1** | 17.1 | **9.7** | 7.5 fail | 21 | 1.43 / 1.81 ms |

Shadowed-top L* per role: base: ground 23.8, path 37, soil 33.7, rock 31.2, cliff 23.3, floor 66.6, cover 36.8, foliage 72.5, trunk 30.6; k50: ground 21.5, path 33.9, soil 30.8, rock 28.4, cliff 21, floor 61.7, cover 33.6, foliage 67.3, trunk 27.9; k55: ground 20.2, path 32.1, soil 29.2, rock 26.8, cliff 19.7, floor 59.1, cover 31.9, foliage 64.4, trunk 26.3; k65: ground 17.3, path 28.3, soil 25.5, rock 23.4, cliff 16.8, floor 53, cover 28.1, foliage 58, trunk 22.9; k50-f10: ground 21.9, path 34.5, soil 31.4, rock 28.9, cliff 21.4, floor 62.7, cover 34.3, foliage 68.3, trunk 28.4; k50-jit03: ground 21.5, path 33.9, soil 30.8, rock 28.4, cliff 21, floor 61.7, cover 33.6, foliage 67.3, trunk 27.9.

### Cascade Lagoon, dusk (night, 23:00; base key 0.45)

| Variant | ground | path | soil | rock | cliff | floor | cover | foliage | trunk | Min (≥ 12) | Shadowed top L* min (≥ 20) | GPU p95 WebGL 2 / WebGPU |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| base (provisional split) | **10.4** | 12 | **10.8** | 12.2 | **9.7** | 15.8 | **10.6** | **10.5** | **7.8** | 7.8 fail | 23.9 | 1.74 / 2.65 ms |
| k50 (key 0.50) | **11.5** | 13.2 | **11.9** | 13.4 | **10.6** | 17.4 | **11.6** | **11.5** | **8.6** | 8.6 fail | 22.6 | 1.72 / 2.71 ms |
| k55 (key 0.55) | 12.6 | 14.4 | 13 | 14.6 | **11.6** | 19 | 12.7 | 12.6 | **9.4** | 9.4 fail | 21.3 | 1.69 / 2.65 ms |
| k65 (key 0.65) | 14.9 | 17 | 15.4 | 17.2 | 13.7 | 22.5 | 15 | 14.9 | **11.1** | 11.1 fail | 18.3 **crushed** | 1.67 / 2.67 ms |
| k55-f10 (key 0.55, facet ±0.10) | 14.2 | 16.2 | 14.7 | 16.4 | 13.1 | 21.4 | 14.3 | 14.2 | **10.6** | 10.6 fail | 21.7 | 1.75 / 2.48 ms |

Shadowed-top L* per role: base: ground 38.2, path 45.4, soil 39.5, rock 46.8, cliff 34, floor 64.9, cover 38.7, foliage 38.6, trunk 23.9; k50: ground 36.5, path 43.5, soil 37.7, rock 44.8, cliff 32.4, floor 62.3, cover 37, foliage 36.9, trunk 22.6; k55: ground 34.7, path 41.4, soil 35.9, rock 42.7, cliff 30.8, floor 59.6, cover 35.2, foliage 35.1, trunk 21.3; k65: ground 30.6, path 36.8, soil 31.7, rock 38, cliff 27, floor 53.6, cover 31.1, foliage 31, trunk 18.3; k55-f10: ground 35.3, path 42.1, soil 36.5, rock 43.5, cliff 31.4, floor 60.6, cover 35.8, foliage 35.7, trunk 21.7.

Every variant fails mark 1 and nothing is tuned further; the pick is the owner's. All stay far inside the 4.0 ms budget
(at most 1.48 ms p95 on WebGL 2, 2.71 on WebGPU).

### Frames

| Variant | Chargestone, spawn | Chargestone, ledge |
|---|---|---|
| base | ![](2026-11-27-cavenight/chargestone-spawn-base.png) | ![](2026-11-27-cavenight/chargestone-ledge-base.png) |
| k50 | ![](2026-11-27-cavenight/chargestone-spawn-k50.png) | ![](2026-11-27-cavenight/chargestone-ledge-k50.png) |
| k55 | ![](2026-11-27-cavenight/chargestone-spawn-k55.png) | ![](2026-11-27-cavenight/chargestone-ledge-k55.png) |
| k65 | ![](2026-11-27-cavenight/chargestone-spawn-k65.png) | ![](2026-11-27-cavenight/chargestone-ledge-k65.png) |
| k50-f10 | ![](2026-11-27-cavenight/chargestone-spawn-k50-f10.png) | ![](2026-11-27-cavenight/chargestone-ledge-k50-f10.png) |
| k50-jit03 | ![](2026-11-27-cavenight/chargestone-spawn-k50-jit03.png) | ![](2026-11-27-cavenight/chargestone-ledge-k50-jit03.png) |

| Variant | Dusk lagoon, spawn | Dusk lagoon, ledge |
|---|---|---|
| base | ![](2026-11-27-cavenight/dusklagoon-spawn-base.png) | ![](2026-11-27-cavenight/dusklagoon-ledge-base.png) |
| k50 | ![](2026-11-27-cavenight/dusklagoon-spawn-k50.png) | ![](2026-11-27-cavenight/dusklagoon-ledge-k50.png) |
| k55 | ![](2026-11-27-cavenight/dusklagoon-spawn-k55.png) | ![](2026-11-27-cavenight/dusklagoon-ledge-k55.png) |
| k65 | ![](2026-11-27-cavenight/dusklagoon-spawn-k65.png) | ![](2026-11-27-cavenight/dusklagoon-ledge-k65.png) |
| k55-f10 | ![](2026-11-27-cavenight/dusklagoon-spawn-k55-f10.png) | ![](2026-11-27-cavenight/dusklagoon-ledge-k55-f10.png) |

## After the cave and night sweep (owner, 2026-11-27): plan, mark 1 and the trunk count

The owner's decisions, recorded in docs/RENDER3D.md "Look values" and ROADMAP F111:

1. **Night:** key share 0.55 and facet tone ±0.10, applied (`KEY_SHARE.night`, `paintByLight.night`). Provisional
   until the owner confirms it by eye from the frames below.
2. **Facet tone ±0.10 for dim scenes only** (caves and night: `paintByLight`); day maps keep ±0.06. The range and
   River Gorge do not move: `npx tsx scripts/toplint.ts --json` gives byte-identical output before and after (every
   variant: range trunk 12.8 min, gorge cliff 15.6; table "Round 3: results").
3. **Trunk:** count first which trunk tops a body can stand on (below); trunk's colour is not changed.
4. **Chargestone:** a stronger key light with the ambient held, never taken from it; steps and frames below.
5. **The side jitter is dropped** (`paint.facetJitter`, its dev parameter `facetjitter` and the k50-jit03 variant are
   gone from the code). Cave colours are not changed.
6. **No cave variant is applied.** The cave key share stays 0.40 (with ambient 0.60), now at facet ±0.10.

**Mark 1 on the hold-outs as applied** (`npx tsx scripts/toplint.ts --holdouts`): the dusk lagoon 10.6 (trunk; every
other role 13.1 or more; shadowed tops 21.7 min), the same as the sweep's k55-f10. Chargestone 7.7 (cliff), up from
6.5 by the facet tone alone.

### The Chargestone key sweep: plan and mark 1

Written and committed before any frame. `npx tsx scripts/toplint.ts --key-sweep` (`KEY_SWEEP`, scripts/lib/looksheet.ts):

- **Ambient held at 0.45**: the lowest ambient share, to 0.01, at which every role's shadowed top keeps L\* ≥ 20 at
  facet ±0.10 (cliff 20.1; at 0.44 it is 19.9). It is the ambient of the old k55 split. The other reading of "the
  level that keeps shadowed tops at 20" was ambient 0.50 (the old k50 split, shadowed tops 21.4), which needs more
  key light for the same mark 1.
- **The key light** starts at 1 − ambient (0.55, an open top at 1.0, the calibrated split) and rises by 0.10 a step
  (`key=<k>&amb=0.45`, the dev parameters `key` and `amb`; `amb` sets the ambient apart from the key, so an open top
  takes key + ambient). The sweep stops at the first step where every role reaches 12, or where a top of a role on
  the map (ground, soil, cliff, cover, floor) clips: a channel of its brightest open top at or over 1.0 before fog and
  grading (the output step has no tone mapping).
- Facet tone ±0.10 (the cave profile). Frames: the two hold-out poses (spawn, ledge) for every step.

```
chargestone: ambient held at 0.45 (lowest with shadowed tops ≥ 20), facet ±0.1; roles on the map ground, soil, cliff, cover, floor
  variant     ground    path    soil    rock   cliff   floor   cover foliage   trunk    min  shadowTop  peak top (roles on map)
  a45-k55        9.9    13.2    12.4    11.7     9.8    21.6    13.1    22.2    12.5    9.8       20.1  0.681
  a45-k65       10.9    14.5    13.6    12.9    10.7    23.7    14.4    24.3    13.7   10.7       20.1  0.765
  a45-k75       11.8    15.7    14.7    13.9    11.6    25.6    15.6    26.3    14.8   11.6       20.1  0.848
  a45-k85       12.6    16.8    15.8    14.9    12.4    27.4    16.6    28.2    15.8   12.4       20.1  0.931  pass
```

Key 0.85 over ambient 0.45 (an open top at 1.30) is the first step where every role reaches 12 (cliff 12.4, ground
12.6); no top clips there (the brightest is floor at 0.931). The shadowed tops do not move (20.1): the ambient is held.

### Trunk: tops a body can stand on

`npx tsx scripts/trunktops.ts 3`: every trunk-role box the tile adapter builds, on the training range, the four
authored arenas, the three Pokémon locations and the six habitat recipes (seeds 1–3; surface variants are
footing-identical, docs/HABITAT_AUDIT.md), split by what stands under it.

- **Low props** (stump, log; PROP_RULES `platform` 0.65 m): the tile model's ground is the prop's top (World.height),
  so a body that jumps up (apex 1.84 m) stands on it, and on the physics flag it is a box collider with a top; the
  adapter writes it as a walkable face. Recast's narrow group keeps a polygon on few of them (a 1 × 1 or 2 × 1 m top
  eroded by the agent radius): a player can stand there, the bots rarely path there.
- **Wall props** (trees, the elder, fences, signs, cabins): not standable today. The tile model lets a body over a
  wall top only with R1b's crossing permission, which no driver grants (sim/locomotion.ts `over`), and the physics
  seam stands the wall column to the sky for movement (sim/physseam.ts pass 1).
- **The 3D range** is G1a's and is not built, so it has no trunk to count.

| Map | Standable trunk tops (low props), seeds 1 / 2 / 3 | of them on the narrow navmesh | Not standable (wall props), seeds 1 / 2 / 3 |
|---|---|---|---|
| Training range (arena) | 0 | 0 | 701 (trees) |
| Sunpetal Meadow (arena) | 13 stumps | 0 | 788 |
| Cinder Badlands (arena) | 11 stumps | 0 | 533 |
| Rimefrost Heights (arena) | 14 stumps | 0 | 752 |
| Duskwood Hollow (arena) | 15 stumps | 0 | 791 |
| Viridian Forest | 13 / 13 / 13 (4–5 logs, 8–9 stumps) | 0 / 1 / 1 | 2551 / 2682 / 2689 |
| Mt. Moon | 0 | 0 | 0 / 1 / 1 (a sign) |
| Chargestone Cave | 0 | 0 | 0 |
| Shrine Gorge (river-gorge) | 22 / 13 / 26 | 0 / 1 / 2 | 875 / 876 / 987 |
| Cinder Crater (volcanic-ridge) | 0 | 0 | 3 / 19 / 9 |
| Shoal Grotto (tidal-cave) | 0 | 0 | 0 |
| Memorial Ridge (forest-cemetery) | 5 / 4 / 4 | 0 / 0 / 1 | 941 / 903 / 815 |
| Cascade Lagoon (tropical-lagoon) | 3 / 8 / 4 (logs) | 0 / 1 / 1 | 2337 / 2193 / 2270 |
| Spear Sanctuary | 0 | 0 | 0 / 12 / 0 |

**Some trunk tops are standable** (stumps and logs, on 8 of the 14 maps; none on the training range), so trunk is not
proposed for exclusion from mark 1. Stopped here for the owner, as asked; trunk's colour is unchanged.

## After the cave and night sweep: frames and timings

Same machine, browser and method as "The cave and night sweep: frames and timings" (Apple M3 Max, Chromium 158,
headed, GPU p95 at 1920 × 1080 on S2's scene; frames 1280 × 720 on WebGPU, the 3D canvas alone). Build
`feat/i2a-look-sheet` at 90478a5; `npx tsx tools/looksheet.ts <build>/index.html docs/looksheet/2026-11-27-keysweep
--key-sweep`, `docs/looksheet/2026-11-27-keysweep/results.json`. Scene lightness: each frame's mean CIE L\* over every
pixel. Bold: a role under 12. No cave variant is applied.

| Map, variant | ground | path | soil | rock | cliff | floor | cover | foliage | trunk | Min (≥ 12) | Shadowed top L\* min (≥ 20) | Scene L\* spawn / ledge | GPU p95 WebGL 2 / WebGPU |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Chargestone a45-k55 (key 0.55, ambient 0.45) | **9.9** | 13.2 | 12.4 | **11.7** | **9.8** | 21.6 | 13.1 | 22.2 | 12.5 | 9.8 fail | 20.1 | 24.8 / 20.9 | 1.42 / 1.66 ms |
| Chargestone a45-k65 (key 0.65, ambient 0.45) | **10.9** | 14.5 | 13.6 | 12.9 | **10.7** | 23.7 | 14.4 | 24.3 | 13.7 | 10.7 fail | 20.1 | 25.4 / 21.8 | 1.65 / 1.59 ms |
| Chargestone a45-k75 (key 0.75, ambient 0.45) | **11.8** | 15.7 | 14.7 | 13.9 | **11.6** | 25.6 | 15.6 | 26.3 | 14.8 | 11.6 fail | 20.1 | 26 / 22.6 | 1.68 / 1.58 ms |
| Chargestone a45-k85 (key 0.85, ambient 0.45) | 12.6 | 16.8 | 15.8 | 14.9 | 12.4 | 27.4 | 16.6 | 28.2 | 15.8 | 12.4 pass | 20.1 | 26.6 / 23.4 | 1.66 / 1.6 ms |
| Dusk lagoon, night as applied (key 0.55, facet ±0.10) | 14.2 | 16.2 | 14.7 | 16.4 | 13.1 | 21.4 | 14.3 | 14.2 | **10.6** | 10.6 fail | 21.7 | 37.6 / 28.5 | 1.78 / 2.55 ms |

Chargestone at key 0.85 over ambient 0.45 is the first step that passes mark 1 for every role (cliff 12.4); no top
clips (brightest floor 0.931). Each step of 0.10 adds about 0.6–0.9 to the frame's mean L\*: 24.8 → 26.6 at the spawn,
20.9 → 23.4 on the ledge, against the shadowed tops held at 20.1. GPU p95 stays far inside 4.0 ms on both backends
(1.42–1.68 WebGL 2, 1.58–1.66 WebGPU; the step-to-step spread is run noise). The night as applied matches the
sweep's k55-f10 (trunk 10.6 the one role under 12), for the owner to confirm by eye.

### Frames

| Key | Chargestone, spawn | Chargestone, ledge |
|---|---|---|
| 0.55 | ![](2026-11-27-keysweep/chargestone-spawn-a45-k55.png) | ![](2026-11-27-keysweep/chargestone-ledge-a45-k55.png) |
| 0.65 | ![](2026-11-27-keysweep/chargestone-spawn-a45-k65.png) | ![](2026-11-27-keysweep/chargestone-ledge-a45-k65.png) |
| 0.75 | ![](2026-11-27-keysweep/chargestone-spawn-a45-k75.png) | ![](2026-11-27-keysweep/chargestone-ledge-a45-k75.png) |
| 0.85 | ![](2026-11-27-keysweep/chargestone-spawn-a45-k85.png) | ![](2026-11-27-keysweep/chargestone-ledge-a45-k85.png) |

| Night as applied | Dusk lagoon, spawn | Dusk lagoon, ledge |
|---|---|---|
| key 0.55, facet ±0.10 | ![](2026-11-27-keysweep/dusklagoon-spawn-applied.png) | ![](2026-11-27-keysweep/dusklagoon-ledge-applied.png) |

## Endgrain (owner, 2026-11-27): plan and mark 1

The owner's decisions after the key sweep: the night is confirmed as applied (key 0.55, facet ±0.10; no Duskwood
Hollow frame); Chargestone's split (key 0.85 over ambient 0.45) goes to caves; stump and log tops take their own role,
a pale cut-wood colour, assigned on the render side; trunk leaves mark 1 and the new role joins it; Chargestone Cave
and the dusk lagoon are gated in `tests/looksheet.test.ts`; F113 stays parked. Written and committed before any frame.

**The role: `endgrain`, render side only.** `withEndgrain` (src/render/world3d/mesh.ts) draws as `endgrain` every
up-facing face of a `trunk` chunk that lies on the top of a raised trunk box (a box collider of role `trunk` whose
bottom is above the model's floor: the adapter's stumps and logs, PROP_RULES `platform`); their sides, the trees,
fences, signs, cabins and the elder stay `trunk`. Neither the model, the adapter nor the generators change. It is a
render-side role (`RENDER_ROLES`, src/rules/styles/bindings.ts), not a `MaterialRole`: the model's union is contract
(adding one bumps `MODEL_VERSION`, Q16.9), so G1a adds it there when its 3D stumps and logs carry it. Its shading is
trunk's (flat), its normals follow the trunk chunk it was split from. A bench (wood, `platform` 0.5 m) would take it
too; no current map has one. Gate: `tests/endgrain.test.ts`.

**The colour (proposed, for the owner's eye): `#d8c09a`**, one pale cut-wood tan on every binding, between the
bindings' wooden `floor` (`#e8c890`, warmer and more yellow) and their pale rock (`#d8d4c8`, grey).

**Mark 1 reads endgrain in place of trunk** (`MARK1_ROLES`, `SIDE_OF`, scripts/lib/looksheet.ts): an endgrain top sits
on trunk sides, so its mark is its darkest top against the brightest trunk side. Its own-colour sides are listed for
information.

| Setting (binding, fixed hour) | Endgrain top vs trunk side, ΔL\* (≥ 12) | Top L\* / trunk side L\* | Against its own sides | Shadowed top L\* |
|---|---|---|---|---|
| Day: meadow (the range), 11:00 | 52.2 | 80.5 / 28.3 | 21.7 | 51.8 |
| Day: forest (Shrine Gorge), 11:00 | 52.3 | 80.5 / 28.2 | 21.7 | 51.9 |
| Day: tropic (Cascade Lagoon), 11:00 | 52.2 | 80.5 / 28.3 | 21.7 | 51.7 |
| Night: dusk (the dusk lagoon, Duskwood Hollow), 23:00 | 58.3 | 81.3 / 23.0 | 20.7 | 58.3 |
| Cave: chargestone, the cave split as shipped (0.40 / 0.60) | 49.9 | 80.9 / 30.9 | 16.3 | 65.3 |
| Cave: chargestone, the owner's split (0.85 / 0.45) | 59.5 | 90.1 / 30.5 | 26.5 | 57.8 |

No cave map has a stump or log today ("Trunk"). Under the owner's cave split the endgrain top peaks at 0.79 on
chargestone and 1.02 on moon (it would clip on Mt. Moon and Shoal Grotto if they had one).

With trunk out, mark 1 on the tuning maps' worst case is the gorge's cliff, 15.6 (was trunk 12.8); the dusk lagoon
passes, 13.1 (cliff; was trunk 10.6).

**The cave split is not applied: stopped.** `tests/timeofday.test.ts` "at the fixed hour an open-sky top facing up is
lit to its base colour" holds every binding's open top at luminance 1 ± 0.03; key 0.85 over ambient 0.45 lights an
open cave top to 1.30 by design. Tests are the spec, so the split waits on the owner's ruling. The mechanism is in
(`AMBIENT_SHARE` in src/rules/styles/timeofday.ts, empty), and so is the gate for the dusk lagoon; Chargestone joins
the gate with the split. Also found: under the split the `moon` binding's floor top peaks at 1.19, so wooden floor
tops clip on Mt. Moon (228 floor triangles) and Shoal Grotto (288; its surface variant `glimmer` uses chargestone,
where floor peaks at 0.93).

## Endgrain: frames

`npx tsx tools/endgrain-frames.ts docs/looksheet/2026-11-27-endgrain before=<082b60d build> after=<838e88b build>`:
Shrine Gorge (day, River Gorge seed 1) and the dusk lagoon (night, seed 1), the two stumps or logs nearest the spawn
with a clear, level stand point 3.5 m away; the player stands there facing the prop, turned 0.3 rad, the camera at its
gameplay pitch; 1280 × 720 on WebGPU, the 3D canvas alone. Poses in `poses.json`. Before: the 082b60d build (trunk
tops); after: endgrain `#d8c09a`. Everything else is the same build state.

| Pose | Before (trunk top) | After (endgrain) |
|---|---|---|
| Shrine Gorge 1: a stump 3.5 m off, logs beyond | ![](2026-11-27-endgrain/gorge-1-before.png) | ![](2026-11-27-endgrain/gorge-1-after.png) |
| Shrine Gorge 2: a stump | ![](2026-11-27-endgrain/gorge-2-before.png) | ![](2026-11-27-endgrain/gorge-2-after.png) |
| Dusk lagoon 1: a log | ![](2026-11-27-endgrain/dusklagoon-1-before.png) | ![](2026-11-27-endgrain/dusklagoon-1-after.png) |
| Dusk lagoon 2: a log | ![](2026-11-27-endgrain/dusklagoon-2-before.png) | ![](2026-11-27-endgrain/dusklagoon-2-after.png) |

Waiting on the owner's check by eye of the colour, and the ruling on the cave split.

## Rulings and closing checks (owner, 2026-11-27)

**Rulings:** the cave split goes to Chargestone's binding only (`BINDING_SPLIT`, timeofday.ts: key 0.85 over ambient
0.45; every other cave binding, `moon` included, keeps 0.40). `tests/timeofday.test.ts` expects an open top at 1.30
± 0.03 on `chargestone` and 1.0 ± 0.03 elsewhere; RENDER3D "Time of day" states the exception, in the same commit.
`tests/looksheet.test.ts` gates Chargestone Cave (mark 1 12.4, cliff; shadowed tops 20.1) and the dusk lagoon (13.1,
cliff; 21.7). Cinder Crater is ROADMAP F114. Shoal Grotto's paint variant `glimmer` uses the `chargestone` binding, so
it takes the split too (a binding decision, as ruled).

**Check: what endgrain catches** (`npx tsx scripts/trunktops.ts 3 --endgrain`; the training range, the four arenas,
the three locations and the six recipes, seeds 1–3): every endgrain triangle's tile is covered by a stump or a log
and by nothing else with a material (`flowerW` and `tall` are decoration props sharing a stump's tile). Over all maps:
stump 240 triangles (224 alone, 14 with tall grass, 2 with a flower), log 244. **No tree trunk, fence post, sign post
or cabin part matches.** None on the range, the caves, Cinder Crater or Spear Sanctuary.

**Check: Mt. Moon and Shoal Grotto at 0.40** (the `moon` binding, 11:00, facet ±0.10; recorded, not tuned):

| Role | ground | path | soil | rock | cliff | floor | cover | foliage | endgrain |
|---|---|---|---|---|---|---|---|---|---|
| Mark 1, ΔL\* (≥ 12) | **9.3** | 13.0 | **11.5** | **10.4** | **9.4** | 16.8 | **11.5** | 15.3 | 49.4 |
| Shadowed top L\* (≥ 20) | 31.1 | 49.8 | 42.3 | 36.7 | 31.7 | 69.3 | 42.4 | 61.4 | 66.5 |

Mark 1 fails (9.3, ground); nothing crushes (31.1); no top clips (peak 0.93).

**Closing gates** (2026-11-27, build of this commit's tree): `npm run check` 719 tests, 718 pass, 0 fail, 1 todo (the
Stage 7A sight test in `tests/spatial.test.ts`); `npx tsx scripts/checksum.ts all` 14 of 14 as recorded;
`node tools/three-signal.mjs` 10 of 10 ok (both backends, five variants each); `.venv/bin/python -I
tests/browser/range.py <build>/index.html <out> --query render=three` PASS, no console errors. **The look sheet is
done.** Endgrain ships at the proposed `#d8c09a`.
