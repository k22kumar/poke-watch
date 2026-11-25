# S1: the Rapier spike

How Rapier enters the game (docs/OVERHAUL_3D.md task S1). This is a record: the spike recommended and did not decide.
Decisions that docs/OVERHAUL_3D.md did not already record are listed in "Decisions for the owner", each with the
owner's answer (review, 2026-11-23).

- **Code:** branch `spike/s1-rapier` (pushed, never merged). Its head is `ee251d0`, four commits on `5823e91`.
- **CI:** `.github/workflows/s1-determinism.yml` on that branch.
- **Machine:** every number below was measured on an Apple M3 Max with Node 24.21.0 and Playwright Chromium 158,
  unless marked Linux.
- **Date:** 2026-11-23.

## Summary

| Question | Answer |
|---|---|
| Package | `@dimforge/rapier3d-deterministic` **0.21.0**, pinned exactly. Use the plain (bundler) build. The compat build is not needed |
| Loading | The `.wasm` is a fetched file, `dist/physics/rapier3d-deterministic.<hash>.wasm`, like `dist/art/`. An esbuild plugin writes it and gives the page its URL. In Node, a `module.registerHooks` resolve hook plus a dynamic import loads it. Init runs once, asynchronously |
| Determinism | **Identical.** Mac arm64 and Linux x64, Node 22 and 24, Node and the Chromium page, for both `-deterministic` and `-simd`. Covered: the per-tick controller hashes, a dynamic-body pile and 250 query results |
| Colliders, adapter maps | The adapter's boxes, one cuboid each, are the cheapest in a crowd and pass the whole course. Merged trimesh chunks are cheaper for a few bodies and slower for many |
| Colliders, open ground | A heightfield does not pay on adapter maps. It saved 153 of the range's 918 boxes, made the controller about 2× slower and puts a bed under liquids |
| Enemies | **Navmesh corridors with a ground query, not a controller each.** 50 controllers already cost 1.2 ms (p95, range) to 2.2 ms (River Gorge) per tick. Controllers are for heroes and bots |
| `free()` | `World.free()` frees its bodies, colliders and controllers. Freed worlds cost nothing extra. A world that is not freed leaks about 1.7 MB of wasm memory (a River Gorge world), and wasm memory never shrinks |
| Fit | Stairs, underpasses, wall slides and seams (for the controller) work. **Stepping does not**: Rapier's autostep depends on speed and approach angle, and over-climbs to 0.62–0.78 m. This is the top open risk, for I1b |

## 1. Package and loading

### What the package is
The plain package is a wasm-pack **bundler** build. Three facts decide how it loads:

- `rapier_wasm3d.js` does `import * as wasm from "./rapier_wasm3d_bg.wasm"`, which is WebAssembly ESM integration.
- `raw.js` re-exports `"./rapier_wasm3d"` with no file extension.
- The package's `package.json` has no `main`, `exports` or `type`.

So neither Node nor an esbuild iife bundle can load it as published.

The wasm module has no start function, and its only import module is `"./rapier_wasm3d_bg.js"` (the glue). The glue
keeps the instance in a module-level `let` that every `Raw*` class reads at call time (`__wbg_set_wasm`). The spike
therefore instantiates the wasm itself:

- `src/physics/rapier.ts` runs `WebAssembly.instantiate(bytes, { './rapier_wasm3d_bg.js': glue })`, then
  `glue.__wbg_set_wasm(exports)`. In the page it uses `instantiateStreaming`, with an `arrayBuffer` fallback for
  `file://`.
- **Page.** `scripts/lib/rapierwasm.mjs` is an esbuild plugin with two jobs:
  - It resolves `./rapier_wasm3d` inside `@dimforge/*` to the glue, so the `.wasm` import never runs.
  - It turns an `import url from '…/rapier_wasm3d_bg.wasm'` into the URL of a content-hashed copy written to
    `<out>/physics/`.

  `src/physics/web.ts` fetches that URL. The spike boots it only with `?physics=rapier`; nothing in the game reads it.
- **Node.** `src/physics/node.ts` registers a synchronous `module.registerHooks` resolve hook, which needs
  Node ≥ 22.15. The hook adds `.js` or `/index.js` to the package's extensionless specifiers, points `./rapier_wasm3d`
  at the glue and sets `format: 'module'`. It then imports the namespace dynamically: static imports resolve before
  any hook exists. The bytes are read from `node_modules`.
- **The compat fallback** (`-deterministic-compat`, wasm inlined as base64) was not needed: esbuild loads the plain
  build through the plugin.

### Numbers

| | Value |
|---|---|
| wasm, `-deterministic` 0.21.0 | 3,105,893 B (gzip 1,179,524, brotli 855,167) |
| wasm, `-simd` 0.21.0 | 3,292,228 B (gzip 1,151,160, brotli 836,316) |
| `dist/index.html` before (main `5823e91`) | 1,406,195 B (gzip 397,687) |
| `dist/index.html` after (namespace and glue bundled, wasm outside) | 1,633,420 B, +227,225 (gzip 437,768). Budget 3 MB |
| Init in Node, 7 fresh processes (dynamic import, read, compile, instantiate) | `-deterministic` median 30.9 ms (27.5–31.4); `-simd` median 30.5 ms (29.7–34.0) |
| Init in the page, 7 cold loads (fetch, compile, instantiate) | `file://` median 11.2 ms (10.3–22.0); local http with `application/wasm` (streaming) median 12.4 ms (12.0–17.2) |

The page's network time on GitHub Pages is not measured. About 1.2 MB gzip is fetched once at boot, before any
physics is needed. The art loads later anyway.

## 2. Colliders from `fromArenaMap()`

Four representations were built, all in `src/physics/colliders.ts`:

- **boxes:** the adapter's colliders as they are.
- **chunks:** the adapter's *render* surface chunks ('terrain', at most 64 × 64 m) as one trimesh each.
- **boxmesh:** the adapter's colliders triangulated and merged into one trimesh per 64 m chunk, bucketed by box
  centre. It keeps every box face except the bottom of a floor-standing box, plus the ramp triangles.
- **heightfield:** the range's open ground (each box from the floor to y = 0) as one 112 × 112 Rapier heightfield,
  with `FIX_INTERNAL_EDGES`. Every other collider stays a box.

The medians below are over 7 builds; "first step" is the first `world.step()`, which builds the broad phase.

| Map | Representation | Colliders | Triangles | Build | First step |
|---|---|---|---|---|---|
| range | boxes | 919 (918 boxes, 1 ramp trimesh) | 2 | 1.57 ms | 0.64 ms |
| range | chunks (render surfaces) | 4 | 29,234 | 4.98 ms (FIX_INTERNAL_EDGES 13.97) | 0.06 ms |
| range | boxmesh | 4 | 9,190 | 1.82 ms (FIX_INTERNAL_EDGES 4.20) | 0.02 ms |
| range | heightfield + boxes | 767 (765 boxes, 1 trimesh, 1 heightfield) | 25,090 | 2.00 ms | 0.38 ms |
| river-gorge@1 | boxes | 2,938 | 0 | 3.35 ms | 1.74 ms |
| river-gorge@1 | chunks (render surfaces) | 4 | 43,420 | 7.09 ms (FIX_INTERNAL_EDGES 20.35) | 0.03 ms |
| river-gorge@1 | boxmesh | 4 | 29,884 | 6.80 ms (FIX_INTERNAL_EDGES 14.62) | 0.04 ms |

**The render surfaces are not collision-grade.** The adapter draws a stairs tile as a column topped at the ramp's mid
height, plus the slope quad. That leaves 0.5–1 m vertical lips through the ramp: a face from 0.5 to 1.5 m at z = −5,
where the slope is at 1.0 m. Every class stopped at the foot of the range's stairs on "chunks"
(`scripts/s1/stairsurf.ts`). The adapter calls its surfaces crude on purpose, so this is no adapter bug. It is the
reason a collision trimesh must come from the collision output (boxmesh), not the drawn shell. G1 has to make
"visible geometry and collision come from the same generator output" true for real.

**The heightfield** replaced only 153 boxes on the range. Of the 765 boxes left, 742 are the tree border. It also
needs a decision under liquids: Rapier's JS heightfield has no holes, so the spike lowered the vertices under water to
the bounds floor. That is a bed the column model does not have (F25). It was the slowest representation per
controller (§3).

## 3. The controller course (60 s, the range)

**Script.** `scripts/s1/course.ts`, with `scripts/s1/courselib.ts`.

- **Bodies.** One capsule per size class, from `rules.size.classes` (`body` footprint as the radius, the class
  `height`), each in its own Rapier world over the same colliders.
- **Fixtures.** The range has neither a deck nor a 0.5 m ledge, so the spike adds two colliders:
  - a ledge box, 0.5 m high, at x −8…−4, z 6…15;
  - a deck, top 3.0 m, 0.6 m slab, 2.4 m gap, at x −18…−10, z −16…−8, against the 2 m terrace's east face.
- **The course, once per lap:**
  1. flat ground;
  2. over the ledge (Rapier's autostep);
  3. up the stairs (2 m over 2 m, 45°);
  4. a jump from the terrace onto the deck;
  5. off the deck's far end (a 3 m drop);
  6. back under the deck;
  7. 2.5 s pushing into the terrace face (the wall slide);
  8. back to the start.

  The course runs about three laps in 60 s.
- **Motion.** Our code owns gravity (30), the jump (10.5 m/s) and the planar ease (`groundAccel` 16, `airAccel` 7)
  from `rules.player`, at 6 m/s. The controller only resolves the translation.
- **Inputs.** Inputs steer to fixed waypoints, read from the body's own position each tick: no RNG, no clock.
- **Hashes.** Every tick hashes each body's translation (float32 bits, two 32-bit FNV lanes). Each class also gets a
  checkpoint every 10 s.

**Results.** Each class ran 34 waypoint legs.

| Representation | Classes that finished every leg | Notes |
|---|---|---|
| boxes | 5 of 5 | ledge 120–122 ticks on top, stairs to 2.00 m, deck 244–251 ticks, under the deck 588–594 ticks (XL included), 3 jumps, 22.8–23.1 m of wall slide |
| boxmesh, with or without FIX_INTERNAL_EDGES | 5 of 5 | the same coverage. FIX_INTERNAL_EDGES gives a byte-identical hash |
| heightfield | 4 of 5 | **XL stuck under the deck** (1,069 ticks there, a leg skipped): exact fit, §7 D |
| chunks (render surfaces) | 0 of 5 | everyone stops at the stairs' lips (§2) |

One body per world, controller plus `step()`, per body-tick: boxes 76.9 µs, boxmesh 28.1, chunks 145.9,
heightfield 148.0 (`-simd`: 70.0 / 23.0 / 110.4 / 122.0). A crowd ranks the representations differently (§5).

**Hashes** (`HASH` lines, the same on every platform in §4):

| Run | `-deterministic` | `-simd` |
|---|---|---|
| course, boxes | `066ca47516a547be` | `066ca47516a547be` |
| course, boxmesh | `00dc7a7a901cbc1d` | `00dc7a7a901cbc1d` |
| course, heightfield | `d7afbbf5dc25d0d2` | `d7afbbf5dc25d0d2` |
| course, chunks | `d70391f36d0624da` | `d70391f36d0624da` |
| pile + queries, boxes | `068b4e71e4861d1a` | `216117778af103f6` |
| pile + queries, boxmesh | `0352a5083959c4dd` | `7f082b6be5542d30` |
| pile + queries, heightfield | `6da1866f0a1bac80` | `820916589b86d597` |

"Pile + queries" covers what the controller course never runs, the solver and contacts:

- 60 dynamic boxes, balls and capsules, 600 ticks, every translation and rotation each tick;
- then the hit distance and normal of 200 rays and 50 ball casts.

The two packages agree on the controller course and differ on the pile, which is expected: different solver code
paths.

## 4. Determinism

| Platform | `-deterministic` | `-simd` | Page (Chromium 158, `-deterministic`) |
|---|---|---|---|
| macOS arm64, Node 24.21.0 (reference) | — | — | — |
| Linux x64 (Xeon 8370C), Node 22.23.5 | identical | identical | identical |
| Linux x64, Node 24.22.3 | identical | identical | identical |
| macOS arm64, Chromium 158 page vs Node | identical | not run | — |

"Identical" covers every `HASH` line, each class's hash, its six 10 s checkpoints, its end position to 6 decimals, and
its coverage line. The workflow ran five times (four pushes, one `workflow_dispatch`); the last full comparison is run
`45291331909`.

**No stop.** The deterministic build gives the same hashes on the Mac and on Linux.

`-simd` matched across platforms too. Its `HASH` lines ran on the same three platforms as `-deterministic` (its page
run was skipped). Upstream promises cross-platform determinism only for the deterministic build. The two are about the
same size and init time, and `-simd` was 9–24 % faster per body on the course (§3). Recommendation: ship
`-deterministic` as D2 says, and do not rely on `-simd`.

Not covered: Windows; Firefox (SpiderMonkey) and Safari (JavaScriptCore) wasm engines; ARM Linux and mobile; and
`takeSnapshot` / `restoreSnapshot` (D6). See risks R11 and R12.

## 5. Cost

**Scripts.** `scripts/s1/cost.ts` and `scripts/s1/cost2.ts`.

**Setup.**
- Capsules of the five classes in turn, on walkable dry ground.
- Every capsule resolves a controller move each tick (gravity, 5 m/s, a new heading every 2 s), then one
  `world.step()`.
- Characters are in collision group 2 and see only the statics (group 1), so they do not block each other.
- 570 ticks are timed after 30 warm-up ticks; all figures are ms per tick.
- **Budget:** perf-sim's gate is p95 2 ms and p99 3 ms for the whole sim. Today's sim alone uses p95 0.689 and
  p99 0.936 at 500 enemies, which leaves about 1.3 ms at p95 for physics.

| Map, representation | 50 controllers p95 / p99 | 150 | 500 |
|---|---|---|---|
| range, boxes | **1.196** / 1.302 | 2.587 / 2.785 | 8.897 / 9.436 |
| range, boxmesh | 2.053 / 2.203 | 5.209 / 5.576 | 19.250 / 20.267 |
| river-gorge@1, boxes | **2.155** / 2.298 | 4.923 / 5.130 | 18.337 / 19.461 |
| river-gorge@1, boxmesh | 4.620 / 5.451 | 13.498 / 14.593 | 47.867 / 49.140 |

**Queries**, measured with 150 controllers present: 100 rays of 40 m and 20 ball casts (r 0.3 m) of 20 m cost
p95 0.69–0.83 ms per tick (range boxes 0.688, gorge boxmesh 0.825), about 5–6 µs per long ray.

**What the alternative costs**, at 500 bodies, p95 per tick:

| | range boxes | range boxmesh | gorge boxes | gorge boxmesh |
|---|---|---|---|---|
| `step()` with 500 kinematic capsules moved by `setNextKinematicTranslation` (no controller) | 0.534 | 0.287 | 0.727 | 0.364 |
| 500 ground rays (3 m down) | 0.648 | 0.623 | 0.601 | 0.725 |
| 500 controller moves, no step | 21.0 | 19.2 | 37.9 | 41.5 |

**The verdict.** A controller per enemy is out:

- **The crowd that tipped it was 50.** At 50 controllers, River Gorge is already over the whole-sim p95 budget
  (2.155 ms) and the range uses all of the headroom (1.196 ms).
- **The alternative fits.** The navmesh corridor with one short ground ray per enemy costs about 1.1–1.5 µs per enemy
  (500: 0.6–0.7 ms). It costs less if the height comes from the navmesh polygon (Detour) instead of a ray.
- **Controllers stay for a few bodies.** Heroes and bots get controllers: 6 cost about 0.15–0.3 ms.

Enemies need no Rapier bodies (owner, O2): the sim's actor broad phase (`sim/spatial.ts`) already sweeps actors, and
500 kinematic bodies would add 0.3–0.7 ms to every step.

**The budget at 500 enemies, if the parts are simply added** (p95 per tick):

| Part | ms |
|---|---|
| today's sim (perf-sim baseline) | 0.69 |
| 500 ground rays | 0.60–0.73 |
| 100 rays and 20 shape casts | 0.69–0.83 |
| 6 controllers (heroes and bots) | 0.15–0.30 |
| **sum** | **≈ 2.1–2.5**, against the 2 ms gate |

The plain sum overstates it in two ways:
- Some of the query cost replaces `sim/spatial.ts` work that is already inside the 0.69.
- Taking the ground height from the navmesh polygon removes the ground rays.

It still says there is no slack. I1a and I1c report physics' share of p95 alongside perf-sim.

## 6. Memory and `free()`

**Script.** `scripts/s1/memory.ts`, run with `--expose-gc`.

**Setup.** Each world is a River Gorge boxes world with 5 controllers, 60 ticks and 100 rays.

| After | JS heap | wasm linear memory |
|---|---|---|
| init | 32.2 MB | 1.1 MB |
| 1 world, freed | 22.4 MB | 3.0 MB |
| +100 worlds, each freed | 22.6 MB | 3.2 MB (Δ 0.2) |
| +100 more, each freed | 22.7 MB | 3.2 MB (Δ 0.0) |
| +100 worlds **not freed** (wrappers dropped, GC run twice, 200 ms wait) | 21.0 MB | **175.0 MB** (Δ 171.8) |
| +100 freed worlds after that | — | 175.0 MB: the freed space is reused, never returned |

Rapier's `FinalizationRegistry` does not rescue a world that is dropped without `free()`. The linear memory only
grows.

**The `free()` discipline (recommended):**
- **`src/physics` owns every Rapier object.** The sim holds plain numbers: collider and body handles, a
  controller's index. It never holds a Rapier object across ticks. That keeps snapshots and replays plain data.
- **One Rapier `World` per loaded map.** It is created when the map is entered, from the WorldModel, and freed when
  the map changes or the run ends. `World.free()` frees its bodies, colliders, joints and every character controller
  made with `world.createCharacterController` (checked in `pipeline/world.js`). Remove a single body or controller
  with `removeRigidBody`, `removeCollider` or `removeCharacterController` (the last one calls `free`).
- **Per-call objects.** The bindings create and free the raw objects of a query themselves:
  `computeColliderMovement` frees its raw vector, and `RayColliderHit.fromRaw` frees the raw hit. The JS `Ray`,
  `Shape` and result objects are plain JS. Keep one `Ray` and one shape per query kind as scratch, so a tick
  allocates nothing beyond the bindings' own objects.
- **Must be freed by the caller:** an `EventQueue`; a `World` from `World.restoreSnapshot`; anything made with
  `new R.World` in a test or script.
- **Today's lifecycle has no dispose.** `createRun` has no dispose step, and `npm test` builds runs by the hundred,
  which would leak about 1.7 MB each on the physics path. I1a needs a run or map disposal entry point, and the shared
  test setup should assert that wasm memory is flat over a batch of runs (decision O7).

## 7. Fit

**Scripts.** `scripts/s1/fit.ts`, `probe-step.ts`, `stepmatrix.ts`, `stepcap.ts`, `manualstep.ts`, `bevel.ts`,
`minspeed.ts`.

**Controller settings, unless stated:**
- offset 0.01 m; the shape is the body shrunk by the offset;
- autostep 0.6 m with minWidth 0.2;
- snap 0.35 m;
- max climb angle and min slide angle 46°; sliding on;
- `normalNudgeFactor` at its default.

| What | Result | Workaround |
|---|---|---|
| Stair ramps (45°) | All classes climb the range flight to 2.00 m (course) | max climb angle above the steepest ramp: 46° for 45° |
| 0.6 m steps | **Unreliable.** See "Steps" below | I1b's own step logic, or bevels (decision O4) |
| Deck underpass (2.4 m gap) | Box and trimesh floors: XL (2.4 m) passes at margin 0. **Heightfield floor: XL stuck at margin 0**, passes at 1 mm | A 1 mm head margin in the shape (`HEAD_EPS`), so the capsule is `h − 2·offset − 0.001` tall |
| Wall slide without sticking | 6 m/s at 20° into a 20 m wall: 16.36 m of 16.92 along 1 m boxes, 16.52 along one box, 16.31 along a trimesh. 3–5 slow ticks at contact, no sticking. Course: 23 m of slide per class | Do not feed the resolved move back into the planar velocity. Doing so starved the autostep: Tiny to Medium never climbed the ledge (fixed in the course) |
| Moving kinematic platform | One `step()` per tick. **Horizontal:** without help the body lags (5.77 m against the platform's 6.00 after 3 s); adding the platform's delta to the desired move carries it exactly (6.02). **Vertical:** without help it rides up and down with a one-tick lag (3.3 cm at 2 m/s); adding the vertical delta makes the body **fall through** a rising platform | Our code adds the support's horizontal delta only. The support is the collider under the feet, from `computedCollision` with an upward normal, and its parent body's delta |
| Seams, controller | Floors of 1 m quads (separate vertices, merged vertices, FIX_INTERNAL_EDGES) and of 1 m boxes: 0 non-up contacts, worst vertical bump 0.0101 m (the offset), 17.4–17.6 m of 18 walked | none needed |
| Seams, dynamic body (ball r 0.3, no friction, 8 m/s) | Separate or merged quads: 3.30 m/s left, 5.6 cm bounces. **FIX_INTERNAL_EDGES: 8.00 m/s, no bounce.** 1 m boxes: 3.93 m/s, 8.3 cm bounces | FIX_INTERNAL_EDGES on every trimesh that dynamic bodies touch. Box seams ghost for dynamic bodies too |
| Slow moves | Flat-ground walking is exact down to 0.1 m/s at offset 0.01. Offset 0.001 stalled (0.05 m in 1 s at 0.5 m/s) | Keep offset 0.01 |

### Steps
This is the open problem. Each pattern below is a speed row (0.5, 1, 2, 4, 6, 9 m/s), with `#` for climbed.

**Rapier's autostep fails slow and diagonal approaches.** `stepmatrix.ts` walks each class into a 0.5 m step:

| Class | Head-on, minWidth 0.2 | 45°, minWidth 0.2 |
|---|---|---|
| Tiny | `....##` | `......` |
| Medium | `...###` | `....##` |
| XL | `.#####` | `...#.#` |

With minWidth 0.02–0.1, almost nothing climbs. Below about 4 m/s, or off-axis, the 0.5 m step usually fails.

**It also over-climbs.** Head-on at 6 m/s (`stepcap.ts`), the highest step climbed with autostep 0.6 is 0.62 (Tiny),
0.65 (Small), 0.68 (Medium), 0.78 (Large) and 0.67 m (XL). The round bottom rides the edge on top of the step.
Lowering autostep does not give a clean cap per class. XL still climbs 0.63 m at autostep 0.35.

**Our own step rule is partial.** `manualstep.ts` turns Rapier's autostep off and checks for a step itself:
- It runs only when a grounded move comes up short.
- Shape casts go up by 0.6 m plus the skin, then probe one radius further along the blocking face's normal.
- A ray down the body's axis must find a face no more than 0.6 m up; then the body moves this tick's wish forward and
  down.

Results:
- Every class climbs every step up to 0.5 m head-on, at every speed.
- Every class refuses 0.62 m and above.
- At exactly 0.6 m, and at 45°, results stay patchy: they depend on speed and class.
- It costs 4–5 casts on the ticks it runs.

**A 45° bevel in front of the step** (geometry, Rapier's autostep off; `bevel.ts`) climbs head-on at every speed from
1 m/s at `normalNudgeFactor` 0.01, but stalls at creases. A trace showed the controller returning zero movement for
8 ticks at the floor-to-ramp crease.

**Conclusion.** Stepping is I1b's first problem. The tile sim climbs any rise up to 0.6 m at any speed and angle, and
the navmesh will claim the same. Until the controller does too, the navmesh and the controller disagree. The matrices
above should be I1b's acceptance gate (risk R1).

**0.5 m is not enough.** The owner's review (2026-11-23) counted the rises between adjacent walkable tile tops (elev +
platform; walls and stairs excluded) over the 28 map sources of `tests/worldmodel.test.ts`:
- There are 227 rises in (0.5, 0.6] m: 147 in (0.5, 0.55] and 80 in (0.55, 0.6].
- The range has none. Every habitat recipe has some (River Gorge 14–21 per seed).
- The tile sim climbs all of them, so on adapter maps the step guarantee must reach 0.6 m. The partial rule's 0.5 m
  head-on would strand bodies on real maps.

## 8. Controller and navmesh numbers per size class

The bodies come from `rules.size.classes` at the class centre, the values `bodyOf` gives at tilt 1. Tilted bodies and
the XL giants use their own `radius` and `height` the same way. For example, Onix (2.78 m) has a walkable height
of 56 cells.

**Controller** (shared by every class):
- offset (skin) 0.01 m; the capsule is the body shrunk by it, with a 1 mm head margin;
- max step 0.6 m (rules.player.stepHeight), by our own rule (§7);
- snap 0.35 m (the sim's STICK);
- max climb angle 46°, min slide angle 46°.

**Navmesh** (for I3): Recast's cells are suggested at cs 0.1 m and ch 0.05 m. **Every Recast value is an integer cell
count, which I3 writes as an integer in rules and never computes.** Recast floors walkableClimb, and 0.6 / 0.05 is
11.999999999999998 in float, so a computed climb is 11 cells (0.55 m), one cell short. Every class uses
walkableClimb **12** cells (0.6 m) and walkableSlopeAngle 45.5°.

| Class | Footprint r | Height h | Capsule radius (r − 0.01) | Capsule half-height ((h − 0.021)/2 − radius) | walkableRadius (cells) | walkableHeight (cells) | walkableClimb (cells) |
|---|---|---|---|---|---|---|---|
| Tiny | 0.30 | 0.6 | 0.29 | 0: a ball of 0.29 (see below) | 3 (0.3 m) | 12 (0.6 m) | 12 (0.6 m) |
| Small | 0.40 | 0.9 | 0.39 | 0.0495 | 4 (0.4 m) | 18 (0.9 m) | 12 |
| Medium | 0.46 | 1.2 | 0.45 | 0.1395 | 5 (0.5 m) | 24 (1.2 m) | 12 |
| Large | 0.66 | 1.7 | 0.65 | 0.1895 | 7 (0.7 m) | 34 (1.7 m) | 12 |
| Extra Large | 0.88 | 2.4 | 0.87 | 0.3195 | 9 (0.9 m) | 48 (2.4 m) | 12 |

The course itself used `h − 0.02`, without the 1 mm head margin. The margin is the §7 D result.

**Tiny has no head margin.** Its capsule formula gives (0.6 − 0.021)/2 − 0.29 = −0.0005, so the shape is a ball of
radius 0.29. With the 0.01 skin it fills the full 0.60 m: no 1 mm margin. That matters only for a gap of exactly
0.6 m; generated deck gaps are at least 2.3 m. A margin would need a ball of radius 0.2895, which narrows the
footprint by 0.5 mm.

**Agreement rule: the navmesh may claim only what the controller can do.**
- The cell counts above are chosen so that radius × cs ≥ footprint and height × ch ≥ body height, so the navmesh is
  the conservative side. They are written as integers, never derived at run time (see above).
- walkableClimb ≤ the controller's guaranteed step. Today that guarantee fails (§7), and Rapier's autostep alone can
  climb more than the navmesh claims.
- walkableSlopeAngle < the controller's max climb angle. Recast marks a triangle walkable when its normal's y is
  greater than cos(angle). A 45° ramp sits exactly on cos 45° in float, so 45° itself is ambiguous: use 45.5° in
  Recast and 46° in the controller.
- One navmesh per size class by default. I3 may merge classes with equal values (owner, O9). The ch of 0.05 makes
  0.6 m and every class height whole cells on paper; float division does not, hence the integers. (I3 moved ch to 0.02 m: O9's review note.)

## Open risks

| # | Risk | Evidence | Owner of the fix |
|---|---|---|---|
| R1 | Stepping. Rapier's autostep fails slow and diagonal approaches, and over-climbs up to 0.78 m. Our own rule and bevels are partial | §7 "Steps" | I1b |
| R2 | A controller costs 20–100 µs per body-tick in a crowd, so only heroes and bots can have one. Long rays cost about 5–6 µs each: I1a should bound queries per tick | §5 | I1a, I1c |
| R3 | Exact-fit gaps (a 2.4 m body under a 2.4 m slab) depend on the floor type without a margin | §7 D | I1b (margin), G0 (gap rules) |
| R4 | The adapter's render surfaces cannot be collision. Collision must come from the collision output | §2 | I1a (use boxes), G1 |
| R5 | The heightfield has no holes, so liquids get a bed (F25), and it is the slowest representation per controller | §2, §3 | G0 |
| R6 | wasm memory never shrinks, and an unfreed world leaks about 1.7 MB. There is no run dispose today, and tests create many runs | §6 | I1a |
| R7 | Dynamic bodies catch on seams: box seams and unflagged trimesh. FIX_INTERNAL_EDGES fixes trimesh and costs 2.1–2.9× the build time | §7 | I1a, I4 |
| R8 | Moving platforms need our horizontal carry. Adding the vertical delta breaks them (the body falls through) | §7 | I1b |
| R9 | The loader depends on wasm-bindgen glue internals: `__wbg_set_wasm`, the import module name, the extensionless `raw.js`. A Rapier upgrade can break it silently. Pin exactly and keep a load test. The Node path needs ≥ 22.15 (`registerHooks`) | §1 | I1a |
| R10 | `instantiateStreaming` needs `application/wasm` (GitHub Pages serves it; the fallback covers `file://`). The page fetches about 1.2 MB gzip at boot | §1 | I1a |
| R11 | Determinism was shown on two OSes, two Node majors and one browser engine (V8), not on Firefox, Safari or Windows, nor for snapshots | §4 | I1a or X1a gate |
| R12 | Snapshot and restore (D6: physics that can be snapshotted) is untested: its determinism, size and cost | — | I1a |
| R13 | The controller stalls at concave creases (8 ticks of no movement on a floor-to-ramp crease) | §7 | I1b |
| R14 | Course inputs are closed-loop (waypoint steering). Bit-level divergence would still show in the per-tick hashes, but an open-loop track was not run | Deviations | — |

## Decisions for the owner

These were not in docs/OVERHAUL_3D.md. Each is the spike's recommendation, then the owner's answer.

- **O1 Package and loading.** `@dimforge/rapier3d-deterministic` 0.21.0, exact pin, plain build. The wasm goes to
  `dist/physics/` as a fetched, content-hashed file through the esbuild plugin. Node loads through the
  `registerHooks` loader. Node ≥ 22.15 becomes a stated requirement (CI runs 22 already).
  - *Owner, 2026-11-23:* yes. I1a adds `"engines": { "node": ">=22.15" }` and a Rapier load test (F38).
- **O2 Enemies.** No character controller per enemy. Ground enemies follow navmesh corridors, with the height from the
  navmesh polygon or one short ground ray. Heroes and bots get controllers. Also to decide: whether enemies exist in
  Rapier at all (kinematic bodies: 0.3–0.7 ms per step at 500) or only in the sim's actor broad phase, as today.
  - *Owner, 2026-11-23:* yes. No controller per enemy, and enemies are not Rapier bodies for now: hits on actors stay
    in `sim/spatial.ts`'s actor broad phase. Ground height comes from the navmesh polygon (Detour), with a ground ray
    only where the polygon can't be trusted.
- **O3 Collider representation.**
  - Adapter maps (until X1b): the adapter's boxes, one cuboid each, the cheapest in a crowd.
  - The mesh world (G1): trimesh chunks with FIX_INTERNAL_EDGES, made from the collision output. Re-measure controller
    cost on G1's chunks: boxmesh was about 2× boxes in a crowd here.
  - No heightfield on adapter maps; G0 decides open terrain.
  - *Owner, 2026-11-23:* yes. Boxes on adapter maps. G1 builds trimesh chunks from the collision output with
    FIX_INTERNAL_EDGES and re-measures controller cost. G0 decides heightfields.
- **O4 Stepping.** Either our own step logic in I1b, with Rapier's autostep off and the §7 matrices as the gate, or
  generators that bevel walkable rises up to 0.6 m (a G0 rule). The third choice is to accept Rapier's autostep, which
  does not match the tile sim or a navmesh at walkableClimb 0.6.
  - *Owner, 2026-11-23:* both.
    - I1b's own step rule, with Rapier's autostep off, must climb every rise ≤ 0.6 m for every class at 0.5–9 m/s,
      head-on and at 45°, and refuse ≥ 0.62 m.
    - G0 keeps generated rises out of a dead band below the lowest blocking ledge; G0 sets the band.
    - Rapier's autostep alone: no.
- **O5 The 1 mm head margin in the capsule** (`HEAD_EPS`), and every generated gap keeps the same tolerance.
  - *Owner, 2026-11-23:* yes.
- **O6 Platform carry** is our code's job, horizontal only (§7).
  - *Owner, 2026-11-23:* yes.
- **O7 Disposal.** A run or map dispose entry point, and a shared test setup that inits Rapier once and asserts flat
  wasm memory over a batch of runs.
  - *Owner, 2026-11-23:* yes, in I1a.
- **O8 Determinism coverage** before X1a: add Firefox and WebKit page runs (Playwright) and a snapshot round-trip
  hash to the S1-style job.
  - *Owner, 2026-11-23:* yes. The snapshot round trip goes in I1a's tests; the Firefox and WebKit page runs come
    before X1a.
- **O9 Navmesh parameters** (I3): cs 0.1 m, ch 0.05 m, walkableSlopeAngle 45.5°, one navmesh per class, the values in
  §8.
  - *Owner, 2026-11-23:* yes, with §8's integer cell counts. One navmesh per class by default; I3 may merge classes
    with equal values.
  - *I3 review, 2026-11-25 (owner):* ch is 0.02 m, not 0.05, and every vertical count is re-derived from the
    physical size it stands for: step 30 cells (0.6 m), Recast's build climb 29, agent heights 48 / 85 / 139 cells
    (Totodile 0.953, Heracross 1.689, Onix 2.777 m), the giant report 179 (3.57 m). cs and the radii are unchanged.
    Why: Recast rounds span tops up to whole cells, so a rise joins by where its tops fall in their cells as well as
    by its size, and no count at 0.05 matches the sim's 0.6 m step (at 11 it cut 45 of the 80 climbable rises in
    (0.55, 0.6] m on the adapter maps; at 12 it joined 31 rises over 0.6 m). At 0.02 / 29: no rise over 0.6 m joins
    and every rise up to 0.58 m does, at every alignment (tests/nav.test.ts); the adapter maps' valid rises in (0.5,
    0.6] m joined on the narrow navmesh go from 176 to 211 of 223 (the other 12: 4 have water below, 8 lie in (0.58,
    0.6) and are routed round in about 2 m), with none of the 621 over 0.6 m (scripts/navrises.ts; S1's 227 counted 4
    rises of 0.5 m plus float noise). Build time and
    wasm memory are unchanged (River Gorge 282 against 285 ms median, heap 64 MB). ch 0.01 is ruled out: Recast's
    compact span stores clearance in 8 bits (`rcCompactSpan::h`, clamped to 255 in `rcBuildCompactHeightfield`), so
    an agent height over 255 cells never connects; Extra Large would be 278 cells and the giant 357. docs/OVERHAUL_3D.md
    "Navigation (I3)" and docs/ROADMAP.md F79 have the rest.

## Reproduce (on `spike/s1-rapier`)

```
npm ci
npx tsx scripts/s1/course.ts deterministic        # §3 / §4 hashes (also: simd)
node scripts/s1/page-course.mjs <scratch dir>      # the same in the Chromium page (npm i --no-save playwright@1.65.0)
npx tsx scripts/s1/colliders.ts deterministic 7    # §2
npx tsx scripts/s1/cost.ts deterministic 600       # §5 (and cost2.ts)
npx tsx --expose-gc scripts/s1/memory.ts           # §6
npx tsx scripts/s1/fit.ts                          # §7 (and stepmatrix.ts, stepcap.ts, manualstep.ts, bevel.ts, minspeed.ts)
node scripts/build.mjs --out <dir> && node scripts/s1/page.mjs <dir> 7   # page init time, ?physics=rapier
gh workflow run s1-determinism.yml --ref spike/s1-rapier                 # the Linux job
```

## Deviations from the brief

- **Inputs.** The course steers to fixed waypoints from the body's own position (closed loop), not an open-loop
  time-based track, so that every class reaches every feature. It uses no RNG and no clock.
- **Fixtures.** The range has no deck and no 0.5 m ledge, so the spike adds two colliders to the Rapier worlds only;
  the map is untouched.
- **Representations.** There are two readings of "one merged trimesh per chunk": the render surface chunks, which
  failed (§2), and the colliders merged per chunk (boxmesh). Both were measured.
- **Extra coverage.** The determinism job also hashes a dynamic pile and query results, and runs the course in
  headless Chromium. It runs on push to the spike branch as well as on `workflow_dispatch`.
- **Spike code in `src/`.** The spike adds `src/physics/` and a `?physics=rapier` boot probe in `src/main.ts`; none of
  it reaches the record branch.
