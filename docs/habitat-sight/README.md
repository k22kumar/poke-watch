# Shrine Gorge and Cinder Crater sight baseline

On Shrine Gorge seed 3, a shot 2.25 m above world zero passes beneath the bridge at tile (58, 51). Habitat validation now agrees. All four reference maps kept their accepted seed, map, collision, paint, navigation and 300-tick simulation hashes. The before build was `a95c333`. The measurements and camera poses are in [baseline.json](baseline.json).

## Bridge witness

The horizontal segment runs east from (58.5, 51.5) to (60.5, 51.5) in map coordinates. Subtract 64 from each horizontal coordinate for the combat query. At the starting tile the liquid surface is −0.25 m, the deck underside is 2.4 m and the top is 3.0 m. Heights in this table are absolute.

| Height | Habitat before | Player combat before | Habitat and player combat after |
|---:|---|---|---|
| 2.25 m | Blocked | Clear | Clear |
| 2.4 m, along underside | Blocked | Clear | Clear |
| 2.41 m | Blocked | Blocked | Blocked |
| 3.0 m, along top | Clear | Clear | Clear |
| 3.01 m | Clear | Clear | Clear |

The old validator selected the deck at top minus 0.9 m, the distance used to snap feet onto the upper layer. That branch blocked the ray before it could reach the underside check. The legacy enemy sight sampler made the same mistake. An isolated trial also ruled out endpoint trimming as a sufficient fix for migrating *all* exposure metrics to exact rays. Both full and endpoint-trimmed continuous casts in the perch gate changed Crater 3 to candidate 1556944651 and checksum `2d88f5e4`.

`sightAbs` uses the same tile traversal and solid columns as `segmentClear`. Both require positive penetration of a slab, and both seal a corner where two side tiles touch at the ray height. The perch and route exposure estimates keep half-metre ground-cover samples and trace the entire segment against decks. This preserves the exposure measure that drives repairs. Enemy sight retains its half-metre samples and now reads those same solids at each sample. Player attacks retain their own foliage and finite wall-top flags. Body clearance and footprint rules continue to select movement layers independently.

## Four reference layouts

Inputs are the unmodified base recipes, generator v2, 128 × 128 one-metre tiles, `control-point`, and default movement profiles. Both maps load with intact cover. The Gorge starts with liquid water and validates base, frozen and stripped states. The Crater starts with dormant vents and validates base, venting and stripped states. All four passed the gates for essential-body round trips, two independent approaches per side and supported joins.

| Map and request | Accepted / attempts | Map checksum | A direct / flank length | Staging → contest elevation | Deck tiles | Hard / destructible cover tiles¹ | Generation ms, before → after² |
|---|---|---|---:|---:|---:|---:|---:|
| Gorge 3 | 3 / 1 | `7997d385` | 76.2 / 118.0 m | 6 → 3 m | 141 | 16 / 18 | 209 → 200 |
| Gorge 7 | 7 / 1 | `e549aa9b` | 74.4 / 117.1 m | 6 → 3 m | 131 | 13 / 12 | 215 → 212 |
| Crater 3 | 548672811 / 4 | `c59665d1` | 68.9 / 72.9 m | 0 → 3.5 m | 65 | 16 / 7 | 1802 → 1805 |
| Crater 7 | 7 / 1 | `c655a19c` | 69.6 / 78.1 m | 0 → 3.5 m | 66 | 17 / 12 | 422 → 417 |

¹ The audit counts tile footprints 4–16 m from the point. Route lengths follow the generated centreline. The JSON also records team B, vertical relief, crossings, contest usability and gate measurements.

² Median of three timed `generateHabitat({recipe, seed})` calls per case after one warm-up pass of the four cases, in table order. Values use the generator's own `gen.ms` on Node 24.21.0, Apple M3 Max. The JSON includes individual timings. These are local measurements.

Crater 3 rejected `3` and `1556944651` at the perch gate, then `3130656841` at the planned-approach gate. The fourth attempt passed. All four requests used the ordinary generation path without fallback. The corrected physical sight check counted 100 high-ground nodes overlooking the Crater 3 contest, down from 101. Unanswered positions stayed at zero.

## Player-height views

Each link opens the original 960 × 540 chase-camera capture. Run seed 1, suppressed director spawns, fixed simulation ticks and a fresh browser page are common to all six. The scene file sets the species, position, yaw and advance sequence. The JSON records the resulting pose and the engine's pixel metrics. [Capture scenes](scenes.json)

| View | Visible reference | Player ΔE / camouflaged pixels |
|---|---|---:|
| [Gorge 3, contest](gorge3-chase-shrine.png) | Stone pillar, crossing and forest rim behind the point | 60.8 / 1.6% |
| [Gorge 3, flank causeway](cam-G3-flank-deck-ahead-view.png) | Shrine roof across the channel, waterfall to the right and raised approach in the foreground | 67.4 / 1.1% |
| [Gorge 7, flank ramp](cam-G7-flank-ramp-ahead-view.png) | Near bank fills the right side and the partner is cut off at the bottom | 65.0 / 0.0% |
| [Crater 3, altar](crater3-chase-altar.png) | Marked stone, short cover and enclosing rock wall | 46.9 / 1.5% |
| [Crater 3, tunnel](cam-C3-direct-tunnel-ahead-view.png) | Narrow sightline between rock faces toward the opening | 54.5 / 0.1% |
| [Crater 7, flank ramp](cam-C7-flank-ramp-ahead-view.png) | Raised view of the lava margin, altar and foreground rock cover | 57.1 / 1.2% |

All six replayed with identical in-engine readability metrics. Five page screenshots also matched pixel for pixel. For the Gorge 3 causeway, 6,373 pixels differed, confined to the upper-right map plaque area. Compare the pose and world pixels for this view. The ramp capture illustrates a limit of the contrast metric. A visible part of the partner can have good contrast while the camera crops the rest.

## Reproduce and compare

From the repository root, the first command regenerates the accepted seeds, geometry, navigation and 300-tick hashes in fresh and warmed processes, plus the layout measurements and 30-seed sweep. The second replays the saved scenes against an absolute path to a local build of the game. Supply an empty capture directory because the tool appends pixel metrics.

```sh
node --import tsx scripts/habaudit.ts --out /tmp/habitat-sight-audit
node tools/cap.mjs /absolute/path/to/dist/index.html docs/habitat-sight/scenes.json /tmp/habitat-sight-views
node --import tsx --test tests/spatial.test.ts tests/habsanct.test.ts
node --import tsx scripts/spatialbench.ts --gate
```

The independent seed comparison checked requested seed, accepted seed and map checksum for 1–30 on each of six habitats and three generated locations. All 270 matched. Both revisions passed the spatial performance gate. On the authored meadow, one 20 m exact trace averaged 0.509 → 0.556 µs and legacy sampled sight averaged 0.400 → 0.499 µs in this workload. On Mt. Moon they measured 0.162 → 0.170 µs and 0.115 → 0.137 µs. The largest new shot-tick average was 1.337 µs against the 2 µs limit. Human combat readability and GPU frame time were outside these measurements.

## Next independent test

Prioritize height-aware Hold occupancy. In a controlled objective-system tick on Gorge 3, a trainer at the contest centre activated Hold and gained 0.0005556 charge at both y = 3 m and y = 7 m. The second pose was injected to isolate height. Test the scoring rule separately for pad contact, jumping and a separated floor with identical horizontal coordinates. Cover trainer activation and charge, Raider drain, and flat-map compatibility. The six frames provide a fixed reference for the subsequent visual identity pass.
