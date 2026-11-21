# Audit: deterministic generation and replay (Shrine Gorge, Cinder Crater)

Scope: `river-gorge` and `volcanic-ridge` with their variants `river-gorge/snow` and `volcanic-ridge/ash`, requested seeds 3 and 7
first (generator `HAB_VERSION` 2). Everything below is reproduced by `npx tsx scripts/habaudit.ts` (about 90 s; writes
`docs/habaudit/baseline.json` and the two layout sheets). The regression checks are `tests/habaudit.test.ts`. Machine for the
timings: Apple M3 Max, Node 24 (the older table in HABITATS.md was measured on Node 22).

## What was found and what changed

| # | Finding | Evidence | Fix | Kept by |
| --- | --- | --- | --- | --- |
| 1 | **Cinder Crater's fallback list contained a seed that is not valid.** `fallbackSeeds` was `[1, 2, 3]`, documented as "verified to pass every gate", but seed 3 fails its own first attempt (perch, perch, planned) and needs four. A fallback walk skipped it silently, leaving two real fallbacks. | `habstats.ts all 8 1 -v`: `volcanic-ridge seed 3: attempts 4 … rejected: 3[perch] 1556944651[perch] 3130656841[planned]` | `[1, 2, 5]`; seeds 1, 2, 5 pass on the first attempt, as the recipe and as the ash variant | `every fallback seed is valid on its first attempt` (red when `3` is put back) |
| 2 | **After a retry the display never said which seed is loaded.** Seed 3 on the crater put the layout of seed 548672811 on screen and the plaque said `map seed 3`; `pokewatch.hab()` returned no accepted seed and no checksum. | the old plaque printed `hab.fallback ? hab.fallback.used : hab.seed`, so only the requested seed unless a fallback was used; `hab()` returned `seed`, `attempts`, `fallback`, no `attemptSeed` | Plaque, console and `pokewatch.hab()` name both seeds, the kind (`direct` / `retry` / `fallback`), the generator version, the checksum and two links (`src/world/replay.ts`) | `a retry is reproducible`, `retries exhausted → the known valid fallback` |
| 3 | **A replay link made after a fallback did not replay the match.** It used the fallback seed as the region seed, so the layout was identical but the region seed was not: the chest spots are shuffled by it. | Fixture, same four chest spots in a different order: requested 9 → `35.5,8.5 -20.5,-33.5 -36.5,8.5 22.5,-31.5`; the old link `mapseed=1` → `22.5,-31.5 -36.5,8.5 35.5,8.5 -20.5,-33.5` | `replay` is the requested seed (layout and region seed); `layoutOnly` is the loaded seed (the layout in one attempt). Both carry `hv=<version>`; a link from another generator version warns | same |
| 4 | **Ash changed how the map plays on the same geometry.** It swapped dirt and sand between floor and route; `footing()` slows sand in Rimefrost and dirt and sand in Cinder Badlands. In a Rimefrost region the routes ran 0.82 → 0.95 of base speed and the open floor 0.99 → 0.83. | `habaudit.ts` witness: `footing in frost (route speed 0.82 → 0.95, off-route 0.993 → 0.83)`; collision and navigation identical | Ash is palette only (`art: 'badlands'`, embers), no terrain swap | `surface variants keep what they claim`, and `the variant check catches the definitions it replaced` |
| 5 | **Snow changed the height of the ground under 1×1 understory.** It swapped bushes (platform 0.70 m) for rocks (0.75 m), so `geometry` and the collision checksum differed from the recipe's on every seed. `tests/habitat.test.ts` compared only elevation and decks. | witness: `collision geometry; under rock (platform=0.75) vs bush/bushR (platform=0.7)` | Snow keeps the recipe's understory; trees are swapped like for like (2×2 walls) | same; `variantPropRuleIssues` also checks every future variant |
| 6 | **`?mapseed=` with an empty value became seed 0** (`Number('') === 0`); `1e3`, `0x10`, `3.5` were read as other numbers. | `parseMapSeed('')` | Whole decimal numbers only; anything else is ignored with a console warning, above 4294967295 it wraps and says so | `?mapseed= is a whole number` |
| 7 | **A region that fails to generate mid-run was uncaught inside the frame loop.** Only the first region had the dialog. | `main.ts` caught `createRun` only | `step()` failures that are `HabitatError` go through the same `failMap` (dialog, title screen). Not covered by a Node test (it is DOM code); the same error and message are tested at `createRun` | typecheck, build |

`HAB_VERSION` is now 2: the snow and ash outputs changed (the recipes' own layouts are unchanged for a given seed, `HAB_VERSION` 1 → 2
gives the same recipe checksums, e.g. gorge seed 3 `7997d385`, crater seed 7 `c655a19c`). Region cache keys and map ids carry the version.

Not changed, reported below: the crater's mirror flag adds almost no variety (section 3).

## 1. Fresh loads: layout, collision, navigation, checksum

Each request was loaded through the game's own path (replay link → `worldgenFromQuery` → `createRun`) in separate Node processes:
three or two plain ones, plus one that first built and played other maps (so state leaking from one generation into the next would show).
Compared bit for bit: map id, requested and accepted seed, attempts, rejected attempts, repairs, optional features, shape signature,
`mapChecksum`, a collision hash (heights, walls, low-prop platforms, decks, fluid levels, stairs, fluid mask, hazards), a navigation hash
(the enemy flow field from the spawn and the Raiders' direction to the point on every route tile) and a hash of 300 ticks of a bot
playing the map (player, enemies, chests).

| Request | Kind | Requested → accepted seed | Attempts | `mapChecksum` | Navigation | Match state | Loads |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Shrine Gorge 3 | direct | 3 → 3 | 1 | `7997d385` | `f8d454a5.68ac9cad` | `e357c12d` | 4, agree |
| Shrine Gorge 7 | direct | 7 → 7 | 1 | `e549aa9b` | `0dcf5484.ac202381` | `ce4f6413` | 4, agree |
| Shrine Gorge / snow 3 | direct | 3 → 3 | 1 | `22f7cf39` | `f8d454a5.68ac9cad` | `e357c12d` | 3, agree |
| Shrine Gorge / snow 7 | direct | 7 → 7 | 1 | `4920363d` | `0dcf5484.ac202381` | `ce4f6413` | 3, agree |
| **Cinder Crater 3** | **retry** | **3 → 548672811** | **4** | `c59665d1` | `2b7ade24.65c1b8cb` | `960644b9` | 4, agree |
| Cinder Crater 7 | direct | 7 → 7 | 1 | `c655a19c` | `0719466b.def3146b` | `50a1658c` | 4, agree |
| Cinder Crater / ash 3 | retry | 3 → 548672811 | 4 | `c59665d1` | `2b7ade24.65c1b8cb` | `960644b9` | 3, agree |
| Cinder Crater / ash 7 | direct | 7 → 7 | 1 | `c655a19c` | `0719466b.def3146b` | `50a1658c` | 3, agree |

The same request also loaded in a real browser (Chromium, the built game): crater seed 3 printed
`[map] volcanic-ridge v2 seed 3 — seed 3 was re-rolled 3×; the layout of seed 548672811 is loaded: replay with ?loc=volcanic-ridge&mapseed=3&hv=2 (this layout alone: …&mapseed=548672811&hv=2) checksum c59665d1`,
the checksum Node produced. `docs/habaudit/crater3-retry-plaque.png` is the plaque: `Cinder Crater · Region 1 of 4 · map seed 3 → 548672811 (try 4)`.

**The retry (Cinder Crater 3).** Attempts: seed 3 `[perch]`, 1556944651 `[perch]`, 3130656841 `[planned]`, then 548672811 accepted
(`mixSeed(3, 3)`). Link check in fresh processes:

| Link | Loads | Checksum | Attempts |
| --- | --- | --- | --- |
| `?loc=volcanic-ridge&mapseed=3&hv=2` (replay) | seed 3, four attempts | `c59665d1` | 4 |
| `?loc=volcanic-ridge&mapseed=548672811&hv=2` (layout only) | the accepted seed directly | `c59665d1` | 1 |
| the same two links with `volcanic-ridge/ash` | | `c59665d1` | 4 / 1 |

The two links give the same map; the map ids differ (`volcanic-ridge@3h2` and `volcanic-ridge@548672811h2`), which only names the cache slot.
The layout link also loads in one attempt (0.54 s from link to a built `createRun`, against 1.87 s for the replay link). **Ash and the recipe have the same `mapChecksum`**: ash repaints
without touching a tile id; the checksum cannot tell them apart, which is correct for the sim and means a handshake would not detect
two clients on different palettes.

**Fallback and the failure path** are in section 5. Everything else that could differ between loads (the cache the sim shares) was
checked: 30 s of bot play on crater seed 7 leaves the cached map's checksum at `c655a19c`.

## 2. Seeds

`requested` (the URL or setting), `accepted` (`attemptSeed`: the attempt that passed), `variant` and `version` are carried by
`HabMeta`, printed by `loadInfo()` and returned by `pokewatch.hab()` (`requestedSeed`, `loadedSeed`, `kind`, `version`, `checksum`,
`replay`, `layoutOnly`). Retry seeds are `mixSeed(seed, attempt)`; the first attempt uses the seed as given; every fallback is one
attempt. In the 30-seed batch the six retried crater seeds were `3→548672811 (4)`, `4→2733250567 (2)`, `10→2096714884 (2)`,
`13→3770043983 (3)`, `15→389790312 (2)`, `27→1971284506 (2)`. The variant takes the same accepted seed as its recipe on every seed
tried (1-8), since its geometry is identical.

## 3. Two or more accepted layouts per recipe

`docs/habaudit/river-gorge-layouts.png` and `docs/habaudit/volcanic-ridge-layouts.png` (final collision, top-down: height as
brightness, cliffs dark, water blue, lava orange; routes A direct cyan, A flank blue, B direct yellow, B flank orange; the point a white
ring; stagings white and red). The fourth panel is the difference of the first two layouts: cyan = route only in the first, orange =
only in the second, white = both, red/blue = the second is higher/lower by more than 0.3 m.

Tile-by-tile overlap is dominated by orientation (every layout is rotated by a multiple of 90° and may be mirrored), so the metrics
below are orientation-free: route length (centre line, m), sinuosity (length ÷ straight distance), turns (summed heading change in
half-turns), rise and fall along the route, deck tiles, crossings by kind and height, hard cover (terrain rock and props nothing can
break or burn) against soft cover (trees, bushes, rocks, boulders that can burn or break) in the 4-16 tile ring around the point.

### Shrine Gorge

| | seed 3 | seed 7 | seed 11 |
| --- | --- | --- | --- |
| `mapChecksum` / accepted seed | `7997d385` / 3 | `e549aa9b` / 7 | `45215d8e` / 11 |
| orientation | 90° mirrored | 270° | 180° mirrored |
| A direct: length × sinuosity | 76.2 m × 1.87 | 74.4 m × 1.82 | 77.5 m × 1.97 |
| B direct | 79.0 m × 2.09 | 83.4 m × 2.08 | 80.9 m × 2.24 |
| A flank | 118.0 m × 2.90 | 117.1 m × 2.87 | 122.8 m × 3.13 |
| B flank | 122.2 m × 3.24 | 123.0 m × 3.06 | 127.0 m × 3.51 |
| routes (every seed) | rise 3 m / fall 6 m (direct), rise 0 / fall 3 m (flank) | same | same |
| vertical placement | point 3 m, stagings 6 m, relief 6 m; walkable tiles below 2 m: **1247** | 3 m, 6 m, 6 m; **2502** | 3 m, 6 m, 6 m; **1678** |
| river | bend 2.67, falls at 29.4, island 61.8 | bend 2.40, falls at 24.6, island 56.6 | bend 3.47, falls at 25.1, island 57.4 |
| crossings | 2 bridges at 0 m, 2 causeways at 3 m, **ford at 6 m** | same, **ford at 6 m** | 2 bridges, 2 causeways, **no ford** |
| deck tiles | 141 | 131 | 151 |
| hard / soft cover around the point | 16 / 18 | 13 / 12 | **20** / 14 |
| rock spurs added by repair | 0 | 0 | **12** (seed 11 failed its first sightline test) |

Route tiles shared: 3 vs 7 20.8 %, 3 vs 11 5.6 %, 7 vs 11 8.1 %; mean |Δelevation| 0.95-1.22 m; walls differ on 23-29 % of tiles.
What physically changes between seeds: which way the gorge runs, where the falls and the island sit, the length of the rim paths and
causeway legs (up to 4 m on a direct route, 6 m on a flank), how wide the open gorge floor is (1247 → 2502 low tiles), whether the
stepping-stone ford over the upper river exists, how many tiles of deck there are, and how much rock the sightline repair had to add
around the point. What does not: the height of the point (3 m), the stagings (6 m), the crossing kinds and counts below the ford.

### Cinder Crater

| | seed 3 (retry, accepted 548672811) | seed 7 | seed 4 (retry, accepted 2733250567) |
| --- | --- | --- | --- |
| `mapChecksum` | `c59665d1` | `c655a19c` | `32aa48dc` |
| orientation | 180° | 270° | 270° mirrored |
| crater radius / breach angle (shape) | 20.6 / 1.73 rad | 21.2 / 1.48 | 20.3 / 1.44 |
| A direct: length × sinuosity | 68.9 m × 1.58 | 69.6 m × 1.61 | **76.7 m × 1.74** |
| A flank | 72.9 m × 1.67 | 78.1 m × 1.80 | 80.5 m × 1.83 |
| B direct / B flank | 69.7 m × 1.57 / 74.6 m × 1.68 | 69.0 m × 1.62 / 77.7 m × 1.82 | 75.7 m × 1.73 / 77.6 m × 1.78 |
| every route | rise 3.5 m, fall 0, 0.7-0.8 half-turns | same | same |
| vertical placement | point 3.5 m, stagings 0 m, relief 7 m; tiles below 2 m: 10143 | same; 10320 | same; 10144 |
| crossings | 4 arches at 7 m | 4 arches at 7 m | 4 arches at 7 m |
| deck tiles | 65 | 66 | **86** |
| hard / soft cover around the point | 16 / 7 | 17 / 12 | 16 / 8 |
| rock spurs added by repair | 30 | 29 | 28 |

Route tiles shared: 3 vs 7 5.5 %, 3 vs 4 5.5 %, **7 vs 4 62.1 %** (mean |Δelevation| 0.43 m, walls differ on 5.1 % of tiles).
What physically changes: orientation, the crater's radius and breach angle (so where the lava lake and the forecourt sit relative to
the map), the route lengths (seed 4's direct routes are 9-11 % longer) and the area of the arches over the cave exits (65 → 86 deck
tiles). What does not change: the height profile, the number and height of the crossings, hard-cover count and the amount of repair rock.
**Seeds 7 and 4 are near twins**: same quarter-turn, one of them mirrored. The crater is mirror-symmetric across the breach axis
(teams A and B are mirrored by design), so the mirror flag mostly swaps A and B:

| 30-seed batch: pairs of accepted layouts | pairs | mean route tiles shared | above 50 % |
| --- | --- | --- | --- |
| gorge, same quarter-turn, same mirror | 51 | 0.376 | 7 |
| gorge, same quarter-turn, other mirror | 61 | 0.268 | 0 |
| gorge, other quarter-turn | 323 | 0.113 | 0 |
| **crater, same quarter-turn, same mirror** | 47 | 0.407 | 11 |
| **crater, same quarter-turn, other mirror** | 61 | **0.402** | **13** |
| crater, other quarter-turn | 327 | 0.057 | 0 |

For the gorge the mirror flag does what it should (other mirror: lower overlap than the same mirror, none above 50 %); for the crater
it makes no difference, so the crater has four effective orientations, not eight, and 24 of 435 pairs repeat more than half of
each other's routes (none repeat 80 %; the gorge has 7). **Not fixed**: the fix is a design change (break the A/B symmetry or widen
`craterR`, `breachW`, `legLen`, the cave and switchback sectors, and the crater's vertical profile) that moves the fairness
numbers the sweep reports (skew 1 %) and needs a playtest, not a seed fix.

## 4. Variants against their recipe

`variantAgainstBase` generates both, then compares: the accepted seed and attempts, the collision hash, route shape and metrics, prop
footprints, the enemy flow field, and the footing speed of every walkable tile in each of the four stage biomes (meadow, dusk,
badlands, frost). Eight seeds each (1-8, which includes the crater retries 3 and 4): all identical. The static rule
`variantPropRuleIssues` checks that a variant's replacement trees and understory have the footprint, wall flag and platform height of the
props they replace.

| | Shrine Gorge / snow | Cinder Crater / ash |
| --- | --- | --- |
| collision, navigation, route shape, footing (4 biomes), accepted seed | identical on seeds 1-8 | identical on seeds 1-8 |
| what differs | tree sprites (icepine for tree / tree2 / round, all 2×2 walls), frost palette, snow | palette (`badlands` for `volcano`), embers |
| `mapChecksum` seed 1: recipe vs variant | `396a9622` vs `6b5c5e7c` (props paint) | `1b8a6fdc` vs `1b8a6fdc` (paint only) |
| collision hash seed 1 (both) | `048828ba.383c3b22.9559ac88.81f84765.90fa5c98.38699dc5.7a8399c2.811c9dc5` | `4fe6ec22.124d3ad7.81dbe2e8.159ad87d.27668885.38699dc5.5f47fc16.1f7c94c6` |

The old definitions are kept as witnesses (`registerRecipe('legacy-ash' …)`): the check reports **old ash** as
`footing in frost (route speed 0.82 → 0.95, off-route 0.993 → 0.83)` with collision and navigation unchanged, and **old snow** as
`collision geometry` and `under rock (platform=0.75) vs bush/bushR (platform=0.7)`. The tests assert both, so the check cannot go quiet.

## 5. Retry exhaustion, fallback, failure

Real retry: section 1. For the paths a real seed does not reach (six rejected attempts), `scriptedAttempt` (an `attempt` option on
`generateHabitat`, never set in the game) runs the real generator and validator only for the seeds it lets through and rejects the
rest with a named gate; `registerPoisoned` does the same on the whole pipeline by walling the point in for every seed but one.

| Step | Cinder Crater (Shrine Gorge identical in shape) |
| --- | --- |
| requested seed 9, only the first fallback allowed | attempts asked: `9, 2917061395, 2052309553, 3971438100, 1012188843, 2355227048, 1` (six re-rolls, then fallback 1) |
| the accepted map | `fallback {requested: 9, used: 1}`, 16 gates present and all passing (the validator ran on it), checksum `1b8a6fdc` = seed 1 generated directly |
| plaque | `Region 1 of 4 · map seed 9 → 1 (9 rejected)` |
| console | `[map] volcanic-ridge v2 seed 9 — seed 9 was rejected on every attempt (…); loaded the known valid seed 1: replay with ?loc=volcanic-ridge&mapseed=9&hv=2 (this layout alone: ?loc=volcanic-ridge&mapseed=1&hv=2)` |
| first fallback fails too | the list is walked in order: `…, 1, 2` and 2 is used |
| nothing usable | `HabitatError` listing all 9 candidates (6 re-rolls + 3 fallbacks); `createRun` throws before any match exists |
| dialog | `Cinder Crater could not be generated for seed 9: all 9 candidates, the re-rolls and the known valid seeds, failed the playability checks (perch ×9). No match was started. Pick another seed or map in Settings → World.` then **Title screen** |

The end-to-end test (`registerPoisoned('fixture-crater', …, [1])`) runs it through `createRun`: seed 9 fails six attempts on real gates
(reach / planned), seed 1 is loaded with all gates passing, the spawn is walkable and the run is in `play`; with no fallbacks listed
`createRun` throws `HabitatError`. The poisoned recipe's good seed builds exactly the recipe's map.

## 6. Timing and retry rates (baseline for later changes)

Seeds 1-30 per recipe, `generateHabitat` end to end (landform, dress, seal, validate, repair, identity), one process, no cache; Apple M3 Max, Node 24.
`docs/habaudit/baseline.json` holds the full rows; compare a later run with `npx tsx scripts/habaudit.ts --out /tmp/x` and diff the `batch`
section (timings vary by a few percent run to run: gorge p50 196-202 ms and crater p50 427 ms across two runs).

| | Shrine Gorge | Cinder Crater |
| --- | --- | --- |
| accepted on the first attempt | 30 / 30 | 24 / 30 |
| retried / fallback / errors | 0 / 0 / 0 | 6 / 0 / 0 |
| attempts per seed: mean, max | 1.00, 1 | 1.30, 4 |
| rejected attempts by gate | none | perch 4, planned 3, identity:arches 2 |
| ms p50 / p95 / max / mean | 196 / 385 / 394 / ~240 | 427 / 1485 / 1780 / ~570 |
| routes shared by two seeds: median / max | 0.130 / 0.654 | 0.059 / 0.702 |
| pairs above 50 % / 80 % | 7 / 0 of 435 | 24 / 0 of 435 |

The existing `scripts/habstats.ts all 30 1` agrees on every count (gorge 30 / 30 first attempt; crater 24 / 30, 39 attempts, perch 4, planned 3,
identity:arches 2); its times read about twice the table's because it also runs a raw first attempt on its own (gorge p50 395 ms,
crater p50 782 ms). Retry rates differ by gate: every crater rejection is a sightline (`perch`), a planned approach that
did not survive dressing (`planned`) or the arch count (`identity:arches`); no seed has needed more than four attempts, so the six-attempt
budget has two attempts of headroom on this batch.

## What this audit did not establish

- **One machine.** Fresh processes and a Chromium agree with each other and with Node (V8 both times); no other CPU, OS or JS engine
  was tried. The generator draws from named RNG streams and its own trig (`detmath`), and a test forbids `Math.random` and clocks in the
  output, which is why agreement is expected, but one CPU is not a proof of cross-platform agreement. (Correction, 2026-11-21:
  the habitat generator's trig still calls `Math` at 68 sites, allow-listed in `tests/worldgen.test.ts`; only the classic
  generator and locgen use `detmath`. Moving them is P2c in `docs/ROADMAP.md`.)
- **The browser failure dialog.** `main.ts`'s `failMap` (and the new catch around `step`) are typechecked and built; `ui.error`'s
  text is `mapErrorMessage`, tested, but no browser run triggered a failing map (the shipped recipes do not fail).
- **Playing quality.** The sheets and metrics show that layouts differ; whether the differences change how a match plays needs people
  (HABITATS.md "needs human playtesting").
- **Crater variety** (above): measured and left alone.
