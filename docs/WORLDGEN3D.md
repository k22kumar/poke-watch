# The 3D world generator (G0)

The design of the procedural generator that replaces `src/world/habitat/`, `locgen/` and `arenas.ts` with one that
writes a WorldModel (docs/OVERHAUL_3D.md, task G0). Design only: G1 builds the core and the 3D range, G2 the first 3D
Hold map. Every decision below is the owner's, dated, from the G0 grilling unless marked "inherited".

**Status: grilling complete (2026-11-23 to 2026-11-24), Q1–Q22.** Every topic of the G0 brief has a decision. What
is still undecided, unmeasured or missing is listed under "Open items" at the end. "WorldModel contract changes"
collects what has to be added to `src/world/model.ts` (task WM2, by the owner's answer C). No code was written.

**The owner's review of 2026-11-24** corrected five points (two in Q3, Q8h, Q14.2, G1's dependencies) and gave four
answers: A (Q19 amendment d), B (the cutover's scope), C (task WM2) and D (task CL). Each is recorded where it
applies, dated; B, C and D are also under "Open items", task order and scope. A second round the same day amended
B (the time-of-day system is built for the cutover) and settled two points on the layers of Q14.10(c): the five
routes are laid out from layer 1, and each later layer's hash change is planned.

**Q23 (the low-poly profile and the render plan) is the owner's addition of 2026-11-24, after the grilling.** The
wording it replaces in the earlier sections (Q14 to Q22, the contract table, the open items) is kept where it was
and marked with a Q23 note. The owner's answers to the seven questions the record raised (one corrected, one
settled, five confirmed) are in Q23 under "Confirmed by the owner".

## Inherited decisions (not reopened here)

| Source | Decision |
|---|---|
| OVERHAUL_3D D1, D2 | A mesh world (WorldModel), Rapier physics inside the sim, three.js renderer. Determinism is a hard rule: fixed 1/60 s ticks, one seeded RNG stream per system |
| OVERHAUL_3D "Target layout" | Recipes and world styles live in `src/rules/`. `src/world/` produces a WorldModel as plain data and never imports three, Rapier, recast or `src/sim/` |
| OVERHAUL_3D "The WorldModel contract" | One plain record per map: meta, bounds, colliders, volumes, navInput, surfaces, markers. Visible geometry and collision come from the same generator output |
| OVERHAUL_3D WS Q7 | `hab` (contest and stagings) stays a tile extension until G2 defines 3D Hold markers against the WorldModel's markers |
| S1 O2 | Enemies have no character controller and are not Rapier bodies. They follow navmesh corridors; ground height from the navmesh polygon. Controllers are for heroes and bots |
| S1 O3 | Adapter maps use boxes. G1 builds trimesh chunks from the collision output with FIX_INTERNAL_EDGES and re-measures controller cost. G0 decides open terrain |
| S1 O4 | I1b's own step rule climbs every rise ≤ 0.6 m for every class and refuses ≥ 0.62 m. G0 keeps generated rises out of a dead band below the lowest blocking ledge and sets the band |
| S1 O5 | A 1 mm head margin in the capsule; every generated exact-fit gap keeps the same tolerance |
| S1 O9 | Navmesh: cs 0.1 m, ch 0.05 m, walkableSlopeAngle 45.5°, walkableClimb 12 cells (0.6 m), one navmesh per size class by default, every Recast value an integer cell count written in rules |
| S2 decisions 1, 2 | WebGPURenderer with TSL (conditional on F39). One `RenderPipeline` from the start, ending in `renderOutput`; no sRGB in materials |
| S2 decision 4 | Creature shadows are blob decals |
| Owner, 2026-11-23 (G0 brief) | Recipes and world styles are typed TS data in `src/rules/`, checked by a small validator function with tests. No schema library (no Zod): the game keeps zero runtime dependencies beyond three, Rapier and recast |
| Owner, 2026-11-23 (G0 brief) | Maps are generated from seed at run start, so replays keep working from seed and version. At most a curated list of validated seeds per recipe; no shipped map files |
| G0 brief | Code that imports three (tree generators, BVH ray lints) stays out of `src/world/`; visual-only geometry is generated in `src/render/` or a build script |

## Facts this design rests on (checked 2026-11-23, `main` 583dcea)

- **Size classes** (`rules.size.classes`): footprint radius / sim height: Tiny 0.30 / 0.6 m, Small 0.40 / 0.9, Medium
  0.46 / 1.2, Large 0.66 / 1.7, Extra Large 0.88 / 2.4. Extra Large sim height follows the draw: Onix 2.78 m; the
  capture-only giants Wailord 3.23 and Eternatus 3.55 (docs/SIZING.md "Tall giants").
- **Movement** (`rules.player`): step 0.6 m, jump 10.5 m/s under gravity 30 (apex 1.84 m, so 2.44 m with the step),
  climb out of a liquid 0.8 m. Controller max climb angle 46°, navmesh 45.5° (S1 §8).
- **Camera** (`CHASE_CONFIG.frame`, src/render/camera.ts): back distance = 4.3 m × (drawn height ÷ 1.9), inside
  [1.8, 14] m; the lens keeps a clearance from terrain and deck undersides.
- **Traversal** (`src/rules/traversal.ts`): shipped kinds are `glide`, `hover` (wild bodies, no wall test) and `swim`.
  `fly`, `levitate` and `dive` are reserved kinds with no mechanics yet.
- **Hold graph today** (`src/world/habitat/mode.ts` `CONTROL_POINT`): spawn → staging → {direct, flank} → contest per
  side; approach edges ask width 5 m, headroom 2.9 m, grade ≤ 0.5, step ≤ 0.6 m; stagings 33–47 m from the point.
- **WorldModel material ids today** (`src/world/adapter.ts`): a collider's `material` is a `rules/surfaces.ts`
  MaterialId for a prop (`wood`, `leaf`, `stone`) or a terrain name for ground (`grass`, `path`, …). A surface chunk's
  `material` is only `'terrain'` or `'liquid'`, with per-vertex linear rgb baked from the tile palette.
- **Style tables today**: `BIOMES` (src/rules/stages.ts: colours, prop counts, ecology, music), `BIOME_ART` and
  `TERRAIN_STYLE` (src/render/tileart.ts), `ART_DIRECTION` (src/render/artdirection.ts), `SKY` (src/render/sky.ts).
- **The range** (`src/world/arenas.ts buildRange`): an authored 112 m arena; the only map with stairs.

## Decisions (G0 grilling)

### Q1 Pipeline and intermediate representation (owner, 2026-11-23: accepted with amendments a–e)

Three data layers sit between a recipe and the WorldModel. Every stage is a small pure function of its input and its
own RNG stream. The strategy is the spec's hybrid (Pokemon_World_Environment_Specification §H): topology-first
constraints inside an environment-first envelope. The recipe fixes the landform envelope (height levels, medium,
locked anchors) first, and the zone graph is embedded into it.

| # | Stage | Input → output | Notes |
|---|---|---|---|
| 1 | `plan` | recipe, seed → **zone graph** | Nodes and typed edges with requirements. No geometry |
| 2 | `check` (Tier 0) | zone graph → pass or typed failure | Graph validation before any geometry (amendment b) |
| 3 | `embed` | zone graph, landform envelope → **space IR** | Volumes with floor and ceiling heights (open sky allowed), portals with clear width and height, traversal links with capability requirements, semantic tags. Metres, no meshes |
| 4 | `build` | space IR → **pieces** | See "Pieces" below |
| 5 | `emit` | pieces → **WorldModel** | Colliders, navInput, surfaces, volumes, markers |
| 6 | `validate` | WorldModel → gates, bounded repair | On the finished collision and the navmesh built from it |
| 7 | freeze, then `dress` | accepted WorldModel → visual-only geometry | Dressing runs after the gameplay model is frozen (amendment d) |

- **Zone graph nodes** (amendment a): the blueprint's set plus staging: `spawn`, `staging`, `objective`, `combat`,
  `transit`, `vantage`, `landmark`, `hidden`. `contest` does **not** replace `objective`: the node role is `objective`
  (mode-neutral), and the Hold's contested point is an `objective` node whose mode kind is `hold`. `contest` stays the
  name of what is emitted for it (the WorldModel's `contest` volume and marker). Owner confirmed, 2026-11-23.
- **`hidden`** (owner, 2026-11-23; the research input's alternate-route pattern, after Hullett): an optional concealed
  space off or alongside required routes, not visible from them. It may be a dead end or a pass-through. It is exempt
  from the two-route rule and not exempt from reach-and-return. It is subject to the dominance and exposure checks, so
  it can never be an unanswerable ambush on a spawn or the sole approach to an objective.
- **Zone graph edges**: `walk`, `ramp`, `stairs`, `bridge`, `tunnel`, `jump`, `drop`, `climb`, `fly`, `burrow`,
  `swim`, `dive`. Each carries its requirements: clear width, headroom, maximum grade, the capability it needs,
  exposure and its approach group. `burrow` (scope notes below) and `swim` and `dive` (Q9) were added on 2026-11-23,
  while the vocabulary is still free.
- **Tier-0 graph validation** (amendment b) runs between `plan` and `embed`: the checks that need no geometry (reach,
  route redundancy, estimated clearances, phase directions) reject a topology before the expensive stages.
- **Embedders fail loudly** (amendment c). An embedder (the code that fits a zone graph into one landform envelope,
  shared across recipes) returns a typed failure, never a degraded layout. The orchestrator retries with a bounded
  number of sub-seeds, then rejects the topology. It never relaxes an edge requirement to make a layout fit.
- **Pieces** (amendment d) are two things: IR-dimensioned pieces (a wall of this length, a ramp of this rise, a
  terrain patch) and gameplay-tier archetype proxies (anything that collides or blocks sight). Both carry role ids
  only, never materials or meshes. Everything else is dressing, placed after the freeze.
- **Planned against realised** (amendment e). The validator compares the planned zone graph with the navmesh built
  from the WorldModel. A missing planned link is a failure. An unexpected link is a warning, unless it bypasses a
  chokepoint or breaks fairness, in which case it is a failure.
- **Versioning.** A change to the node or edge vocabulary bumps the generator version.

### Q2 Spaces and portals in the WorldModel (owner, 2026-11-23: option A, with amendments a–c)

The WorldModel gains a slim projection of the space IR. This is a contract change to `src/world/model.ts`.

- **`spaces: Space[]`**: `{ id, role, tags, footprint, floor, ceiling }`. `role` is the zone node role. The geometry is
  a footprint polygon with a floor height and a ceiling height, `ceiling: null` meaning open sky; it is not a single
  box (amendment a).
- **`portals: Portal[]`**: `{ id, a, b, centre, width, height }`, the opening between spaces `a` and `b` with its clear
  width and height.
- **Tags** are a closed string union declared in `model.ts`: `camera-clearance`, `long-lane`, `cover-zone`,
  `landmark-anchor` and `soft-soil` (added with burrowing, scope notes below) to start. The union is contract:
  changing it bumps the model version (amendment c).
- **Order.** Spaces and portals are sorted by id before the model is hashed (amendment b).
- **Who reads them.** Physics and navigation never read `spaces` or `portals`. The sim may read a space's role and
  tags, never its geometry for collision. Render reads them for dressing, culling and lints, and never mutates them.
- **Tests** (amendment c): no dressing instance lies inside a `camera-clearance` space; render never mutates `spaces`.
- **What stays out.** The zone graph, the edge requirements and the resolution log go in a separate `GenReport`
  (validation output, replay link, debug overlay). Nothing in physics, navigation or the sim reads it.
- The tile adapter emits both arrays empty until it is deleted at X1b.

### Q3 Geometry representation per class (owner, 2026-11-23: accepted with amendments a–d)

| Class | Generator data | Emitted collider |
|---|---|---|
| Structures (walls, floors, slabs, pillars, roofs, cover) | one solid per piece | `box`, with yaw. One floor box per room |
| Sweeps (ramps, stairs, bridges, arches, tunnel shells) | centreline and profile | `trimesh` per piece, FIX_INTERNAL_EDGES |
| Open ground | a height grid per terrain patch | `trimesh` chunks of at most 64 m, FIX_INTERNAL_EDGES, cut from the grid |
| Rapier heightfield collider | — | not used |

- **This is a deliberate departure from the blueprint, in two places. Do not "fix" it back.**
  - Blueprint §7 says "heightfield per terrain chunk". The generator keeps a height grid as its authoring form and
    emits it as trimesh chunks; the Rapier heightfield collider is not used.
  - Blueprint rule 4 allows trimesh only for SDF caves. Here trimesh is also the collider for sweeps and for terrain.
  - **The reason is holes and one source** (rewritten in the owner's review, 2026-11-24).
    - A heightfield has no holes. It forces a bed under liquids and cannot open at a cave mouth or a shaft.
    - A trimesh cut from the generator's own grid is also the drawn ground, so what is drawn is what collides ("One
      source", below).
    - **Cost does not decide it, and controller cost on a terrain trimesh is unmeasured.** S1 §3 timed one body per
      world, per body-tick: boxes 76.9 µs, the 9,190-triangle boxmesh 28.1 µs, the trimesh at terrain resolution
      ("chunks", 29,234 triangles) 145.9 µs, the heightfield 148.0 µs. A trimesh at terrain resolution is level with
      the heightfield. S1 §5 has the boxmesh 1.7–2.1 × slower than boxes per controller in a crowd of 50. G1
      measures the generated terrain before the 80,000-triangle cap is accepted ("Open items").
    - The first version of this bullet gave "28 µs for merged trimesh" against the heightfield's 148 µs as the
      reason. That 28.1 µs is the small boxmesh, not a terrain mesh.
    - S1 also saw an Extra Large body stuck under a 2.4 m deck at margin 0 on a heightfield floor only (§7 D).
    - The G0 brief's summary "heightfields for open ground (per S1)" misreads S1.
- **S1 O3 is refined, not reversed.** O3's "trimesh chunks from the collision output" now covers terrain and sweeps;
  structures stay boxes (one box per wall: the collider comes from the piece's meaning, not from a render mesh). G1's
  re-measure is the tie-break: it compares this hybrid with all-merged trimesh on the first map and may move
  structures to merged trimesh if the hybrid loses.
- **(a) Stairs collide as a smooth slope.** A stair emits a sloped collider and a sloped navInput surface. The steps
  are render-only. Stepped collision would run the step rule on every tread and make movement jitter.
- **(b) Seams between colliders.** FIX_INTERNAL_EDGES works only inside one trimesh; it does nothing between two
  terrain chunks, or between a box and the terrain. So terrain chunks share their exact edge vertices, all cut from
  one grid. A conformance test walks a controller of each size class across chunk edges, box-to-terrain joins and
  sweep ends, and fails on a snag or an upward kick.
- **(c) A trimesh triangle budget** for terrain plus sweeps (grid resolution × chunk count has a ceiling), checked at
  `emit`. The research report's default was 150,000 trimesh triangles; the number is set with the other budgets.
- **(d) Convex hulls.** G1 may also measure a single convex-hull collider for straight ramps and straight stairs
  (possibly cheaper than a trimesh, and no internal edges at all). A measurement option, not a blocker; it would add
  a collider shape to `model.ts`.
- **Liquids (S1 risk R5).** The terrain mesh continues under every liquid as a real bed: no holes under liquids and no
  missing bed (ROADMAP F25, for generated maps).
- **One source.** The same height grid and the same pieces feed colliders, navInput and render surfaces, so the
  ground that is drawn is the ground that collides (the fault class of ROADMAP F35).

### Scope notes (owner, 2026-11-23)

- **The map's static geometry does not change after validation.** No deformable terrain. (The owner's first wording,
  "digging out of scope", was corrected the same day: burrowing is in scope, below; terrain deformation is not.)
  Narrowed by Q10(f): the map is a static base plus a capped set of stateful features, every state of which is
  validated before the match.
- **In scope: swimming, including full submersion.** It needs a liquid volume, a swim mode, underwater navigation and
  depth rules, not only a bed. Decided in Q9.
- **In scope: burrowing**, for a Dugtrio-style hero. Burrow is a movement mode inside tagged soft-soil regions: the
  hero travels hidden under the surface and emerges elsewhere in soil. The terrain does not deform; holes are
  visual-only and never collide. Added to the vocabulary now: the `burrow` edge kind (Q1), a `soft-soil` surface
  value and the `soft-soil` space tag (Q2). Validation must cover emergence points (never inside an enemy spawn or a
  protected area), counterplay, the share of space only burrowers reach, and a minimum depth between soft soil and
  any tunnel or chamber below it. Decided in Q10.

### Q4 Caves are local SDF volumes at G2 (owner, 2026-11-23: option B, with conditions a–e)

**A deliberate change from the blueprint**, which placed SDF caves at milestone 12. The recommendation put to the
owner was swept tunnels and kit chambers at G2 with SDF later; the owner chose SDF caves at G2.

- **(a) Bounded.** Each cave is carved inside a bounded box at a fixed resolution, so its maximum triangle count is
  known before meshing and is checked against the Q3(c) trimesh budget.
- **(b) Deterministic.** SDF evaluation uses deterministic maths only (`core/detmath`). Each cave has a golden-hash
  test.
- **(c) The portal-frame contract.** Each cave ends at frames with fixed vertex rings. Near a frame the SDF surface is
  blended to the frame's profile and stitched to the exact ring vertices. The Q3(b) walk-across seam test runs at
  every frame.
- **(d) Fallback behind the IR.** To the space IR a cave is a volume with a ceiling plus portals; the builder is
  swappable. If the SDF builder is not ready, G2 may temporarily use swept tunnels and kit chambers, then switch with
  no IR change.
- **(e)** The burrow minimum-depth rule applies to SDF chambers too.

### Q5 Floors and vertical connections (owner, 2026-11-23: accepted with amendments a–e)

There is no global storey index. Five rules:

1. **Every space is a prism**: a footprint polygon × `[floor, ceiling]` (Q2). Anything more complex is several spaces
   joined by portals; ground half-covered by an overhang is two spaces (covered, open) with one full-width portal.
   - *(a)* For a cave, and for any space whose floor or ceiling is not flat, the prism is an **envelope only**. SDF
     cave floors and ceilings are surfaces, not slabs. Headroom and camera clearance are checked point-wise, from the
     actual floor surface to the actual ceiling surface, never from the prism's numbers.
2. **Floor kinds.** `flat` (a slab at one height), `terrain` (follows the height grid; the space stores its minimum
   and maximum), and a cave's own surface (a). The recipe's envelope names datum levels in metres; flat floors snap to
   a datum.
3. **Stacking by interval.** Two spaces may overlap in plan only if their `[floor, ceiling]` intervals are disjoint
   with solid between them of at least the slab thickness, 0.6 m (today's `DECK_SLAB`). This one rule gives
   multi-storey interiors, bridges over routes, tunnels under ground and caves under terrain.
   - *(d)* Where the upper space has soft soil, the burrow minimum-depth rule replaces the 0.6 m slab.
4. **Every level change between spaces is an explicit link**, built by a piece with a flat landing at each end. Link
   kinds are the Q1 edge kinds (`ramp`, `stairs`, `drop`, `jump`, `climb`, `fly`, `burrow`). No portal hides a height
   difference beyond the step band. Landing size derives from the largest body, not from the recipe.
   - *(e)* The link vocabulary must accept `swim` and `dive` from the swimming question with no model change. A
     link's `kind` in the WorldModel stays a string checked against the generator's edge vocabulary (as
     `OffMeshLink.kind` is today), so adding a kind is a vocabulary change (generator version), not a model change.
5. **Portal kinds.** `opening` and `door`: bodies and sight pass. `window`: sight and shots pass, bodies do not.
   Sight-line metrics and navigation read the same portal list.
   - *(b)* A window physically blocks every body size, flyers included. Either its clear size is below the smallest
     body, or a body-only collider fills the opening (it blocks bodies and passes rays and shots; in today's
     `ColliderBase` terms `blocksShots: false`, enforced by collision groups in `src/physics`). The sight-line
     metrics read the same `blocksShots` flag, so a window is see-through in validation as it is in play.
   - *(c)* Doors are static in v1: always open, no moving parts, no change to navigation or sight after the freeze.

**Kit v1.** Each piece is a prism builder or a link builder.

| Kit piece | Builds | Representation |
|---|---|---|
| room, corridor | a space with a ceiling | floor box, wall boxes on footprint edges, roof box |
| roof, overhang | the ceiling of the space below, optionally the floor of a space above | box |
| wall, pillar, cover block | a structure inside a space | box |
| arch, bridge | a link, or a span over a lower space | sweep |
| ramp, stairs | a link | sweep, sloped collider (Q3a) |
| tunnel | a space with a ceiling | sweep shell |
| cave | a space with a ceiling | SDF (Q4) |
| mouth | the portal frame between terrain and a tunnel or cave | fixed vertex ring |
| terrain patch | a `terrain` floor | height grid |

A building interior is rooms, door and window portals and stairs links; nothing is special-cased. Not in v1: moving
platforms and lifts (S1 O6 covers the carry; no piece until a recipe asks), and ladders as geometry (the `climb` link
is in the vocabulary; the piece waits for climb mechanics).

### Q6 The step band, the slope band and exact-fit gaps (owner, 2026-11-23: accepted with amendments a–d)

The controller (exact numbers) and the navmesh (heights rounded to 0.05 m cells) are two judges of where a body can
go. A value close to a limit can be judged differently by each: the tile maps have 227 rises in (0.5, 0.6] m. The
cure is that the generator never emits a value near a limit.

1. **Height lattice.** Every generated flat height (slab tops, landings, cover tops, datum levels) sits on a 0.05 m
   lattice, the navmesh cell height.
   - *(a)* The generator stores flat heights as integer lattice units and converts to metres only at `emit`. No
     height decision accumulates floats.
2. **Step band.** The rise between adjacent walkable surfaces is ≤ 0.50 m (walked as a step) or ≥ 0.80 m (a wall to
   walkers). Nothing lies in (0.50, 0.80); a climb through that range is a ramp or stairs. It applies in both
   directions, and a `drop` link is ≥ 0.80 m by definition.
3. **Slope band.** Walkable surfaces are ≤ 40°. Blocking faces are ≥ 50°. Nothing in (40°, 50°) on any face a body
   can touch from walkable ground. Inside that: ramps on required routes ≤ grade 0.5 (26.6°), stairs ≤ grade 0.7
   (35°). Cliffs are explicit vertical faces with their own vertices, never stretched grid cells.
4. **Exact-fit gaps (S1 O5).** No generated gap sits within 0.10 m of a size threshold: clear heights and widths come
   from a fixed ladder (Q7). The 1 mm `HEAD_EPS` stays in the capsule as a tolerance, never as a design value.
5. **The `band` gate** runs at `emit` on the emitted colliders and navInput at 0.05 m. Any rise in the step dead
   band, any touchable slope in the slope dead band, or any gap within 0.10 m of a class dimension fails the attempt
   with a typed failure (Q1c). There is no repair: it is a builder bug or a bad embed.
   - *(b)* The gate is a backstop, not the shaping tool. The terrain and SDF cave builders satisfy both bands by
     construction: they flatten walkable floors, remove lips inside the band, and clamp slopes to ≤ 40° or ≥ 50°.
   - *(c)* `GenReport` records band failures per builder. Seed-batch runs fail CI when any builder's band-failure
     rate exceeds a set threshold, so a buggy builder shows up instead of quietly raising the rejection rate.
   - *(d)* The band limits are derived constants, computed from the shared movement numbers, not literals. Today:
     the controller's guaranteed step (0.6 m, 12 cells) gives 10 cells below (0.50 m) and 16 cells above (0.80 m,
     three cells over the 0.62 m refusal rounded up to the lattice); the navmesh slope (45.5°) and the controller's
     slide angle (46°) give 40° and 50°. If the controller changes, the bands move with it. G1 names the margins in
     `src/rules/` and a test pins today's results.

Carried to the hazards question: a burnt tree leaves a 0.65 m stump platform today (docs/SYSTEMIC.md), which is
inside the step dead band. Destructible residues must obey the band.

### Q7 Size-class guarantees and camera clearance (owner, 2026-11-23: accepted with amendments a–d)

Every number here is computed from `rules.size` with Q6's 0.10 m keep-away. None is set per recipe.

- **Bodies.** Footprint diameter (no tilt): Tiny 0.60, Small 0.80, Medium 0.92, Large 1.32, Extra Large 1.76 m. Sim
  height with tilt: Tiny 0.55–0.65, Small 0.83–0.97, Medium 1.10–1.30, Large 1.56–1.84, Extra Large 2.21–3.57 m
  (continuous: a giant follows its draw up to `xlVisualCap`; Onix 2.78 m, the cap 3.57 m).
- **Three width groups.** Small and Medium diameters differ by 0.12 m and Tiny and Small by 0.20 m, so no gap can
  admit one and clearly refuse the next. The groups are **narrow** (Tiny, Small, Medium), **Large** and **Extra
  Large**, the split of today's navigation classes (S1 O9 lets I3 merge navmeshes with equal values).
- **Extra Large cannot be split by height.** Its heights are continuous, so any ceiling between 2.21 and 3.57 m is
  within 0.10 m of some legal body. Today's 2.4 m deck gap is that fault. Two clean ceilings exist.

| Clear width | Admits | Clear height | Admits |
|---|---|---|---|
| 1.10 m | narrow only | 2.00 m | Large and below, no Extra Large |
| 1.50 m | Large and below | 3.70 m | everything, giants at the cap included |
| 2.00 m | any body, single file | | |
| 5.00 m | any body, passing and fighting (today's approach width) | | |

- **The guarantee.** Required routes, objective spaces, and spawn and staging exits are ≥ 5.00 m wide and ≥ 3.70 m
  clear, with doorways on them ≥ 3.00 × 3.70 m. Every body any rule set can produce fits, so a new hero never moves a
  layout (the fault class of ROADMAP F3). Link landings are the route width × 2.00 m on required routes and
  2.00 × 2.00 m elsewhere.
- **Optional and `hidden` spaces** may use any rung. The size restriction is carried as an edge capability, so the
  validator checks that the admitted group reaches and the refused group is refused.
  - *(d)* Size-restricted optional spaces count toward `exclusiveAccessShare` and need counterplay (a reachable
    counter position), the same as mobility-gated vantages.
- ***Superseded in part by Q15(g), 2026-11-23:*** the camera law changes (low, close, view height clamped to a
  band). The camera table, the camera reasoning behind 3.70 m and the 8.00 m short-side rule below are to be
  recomputed from the new law through the single framing source (c). The 3.70 m clear height itself stands on body
  clearance. The bullets below are kept as the record of what was accepted before (g).
- **Camera clearance** is sized for the Extra Large class, not for giants. Giants indoors use the camera's existing
  deck rule (the pivot lowers, the elevation is capped).
  - Enclosed **objective, combat and staging** spaces are tagged `camera-clearance`, with a ceiling ≥ 3.70 m and a
    shorter side ≥ 8.00 m (the Extra Large back distance plus the body).
  - *(a)* Enclosed **transit** spaces on required routes (corridors, tunnels, caves) need ≥ 3.70 m clear and ≥ 5.00 m
    width only, and rely on the camera's collision pull-in. Point-wise clearance per Q5(a) still applies.
  - *(b)* **The camera table is provisional.** These are estimates from the framing law (back distance = 4.3 m ×
    drawn height ÷ 1.9; arm elevation 14° at the neutral pitch; pivot at 0.8 × height; lens clearance 0.3 m), not
    measurements: Large 4.35 m back and a 2.71 m ceiling for an untouched lens; Extra Large class 6.09 m and 3.69 m;
    a giant at the cap 9.05 m and 5.35 m. G1 adds a camera probe test per size class (Large, Extra Large class, a
    giant at the cap) in a 3.70 m space and records the measured lens clearance, replacing the estimates.
- **Where the numbers live.**
  - *(c)* Single source: the framing-law inputs move into `src/rules/`, and `CHASE_CONFIG` reads them. A mirror in
    rules with a pin test against `CHASE_CONFIG` is the fallback only if the move is not possible.
  - One function in `src/rules/` computes the envelope and the ladder from `rules.size` and those inputs.

### Q8 Flight (owner, 2026-11-23: accepted with amendments a–h)

1. **Capability, not species.** The generator knows the capability `fly` on edges and spaces and nothing about
   species. Who holds it is `traversalOf(species)` (`fly` and `levitate` are reserved kinds today, roadmap R6d and
   R6e). Elemental type never implies flight. No recipe names a species. *(Superseded in part by Q14(e): a recipe
   may carry a species section, from which only the capability set is derived.)*
2. **Flight is resource-limited** (f, a new design fact): fuel, time or a jump count; the mechanic is still to be
   decided (Overwatch-like). Rules expose derived limits per full resource: maximum airborne time, maximum climb and
   maximum horizontal range. Every `fly` edge fits inside them with a keep-away margin, as in Q6.
3. **Flight envelope.** In an enclosed space it is the ceiling (point-wise in caves). Under open sky it is a flight
   cap of 8.00 m, one number in rules.
   - *(a)* The cap is continuous. Between adjacent open spaces it changes over a transition distance at a bounded
     grade, never as a vertical step. A flyer above the local cap is eased down, never blocked.
   - *(b)* The reach check (a flyer at the cap can be hit from the ground: the cap stays under the shortest ranged
     reach, 13 m for Raiders today) is measured from the lowest walkable ground beneath each air sample, not from the
     space's highest floor.
4. **No invisible barriers**, except the flight cap, the map edge and the spawn barrier (h). Whatever else keeps a
   flyer out is real geometry: a roof, a canopy, an overhang, a cave, a window blocker (Q5b).
   - *(h)* **The spawn barrier is the single allowed exception.** There is no roof requirement: most maps are
     outdoors and open sky is the default. Spawn and staging areas are protected by a rule-enforced barrier, as in
     most hero shooters. It may be invisible (a subtle visual hint is optional art). It blocks every enemy body in
     every movement mode (walk, fly, burrow, swim) and does not block shots or sight. The spawn-safety gate therefore
     checks that spawn exits are not exposed to long sight lines. Roofs and canopies near spawns are optional art.
     The barrier is team-specific, so it is emitted as a volume with its team and enforced by the sim, not as a
     static collider (a `model.ts` volume kind). The sim rule that enforces it lands with G2, the first map with a
     barrier, and is tested on the range's spawn-barrier station (Q22a), whose geometry G1 builds. *(Corrected in
     the owner's review, 2026-11-24: this read "I1b enforces it".)*
5. **Fly-only space is allowed, budgeted and never essential.** A space reached only by `fly` edges may be a
   `vantage` or `hidden`, never an `objective`, `staging` or `spawn`, and never on a required route. It counts toward
   `exclusiveAccessShare`, and it has a ground counter position: reachable by every body, within weapon range, with
   line of sight to it and cover of its own.
   - *(f)* Every fly-only space allows exit by a drop, or by take-off after recharge (reach-and-return).
6. **Air exposure and landing perches** (g). Flyers cannot hold an air position, so the two rules split:
   - **Air samples use the exposure rule only**: each is seen from at least two covered ground positions within
     reach. *(c)* Samples are tested at several heights, at least mid-envelope and the cap, not the cap only.
   - **The dominance gate applies to fly-reachable landing spots** (rooftops, ledges, cliff tops), which are treated
     as perches (sees ≥ 50 % of both of a side's final approaches and the point: fail, with the bounded repair).
7. **Volume routing data.** Flyers steer locally with physics queries; they need coarse routes between spaces.
   Navigation may not read `spaces` (Q2), so the generator emits a coarse routing graph in `navInput`.
   - *(e)* It is a **volume-routing graph with a medium**, `'air' | 'water'`, so swimming and diving reuse it. Nodes
     sit at portal centres and space centres at travel height; edges carry a clear radius. `fly` edges of the zone
     graph become edges of it. This is a `model.ts` addition.
   - *(d)* At `emit`, each edge is swept with its clear radius against the emitted colliders. A blocked edge is a
     typed failure (Q1c).

Not decided here: whether a hovering body captures a Hold (the contest marker already carries a radius and a height;
a mode rule, with the Hold question). *(Decided in Q11: a body inside the capture cylinder captures, hovering
included.)*

Owner, 2026-11-23, on the spawn barrier as a team volume: reachability analysis is team-aware, so an enemy route
never passes through the other team's spawn volume.

### Q9 Swimming, diving and liquids (owner, 2026-11-23: accepted with the owner's design changes 1–10)

These replace parts of today's liquid rules (docs/HAZARDS.md: contact at the surface, 5 s and 3 s knock-outs, no
bed). The sim side is input to I4 and I1b; the generator's part is depth, banks, spaces and routes.

- **Who goes under.** Only a `dive` capability submerges. Every other body that is out of its depth floats at the
  surface.
- **(1) Damage is depth-relative.** Below half its own body height a body wades and takes no damage. Deeper, every
  body floats at the surface and takes damage that scales with depth relative to its body height. Full-rate
  knock-out: water 8 s, lava and toxic 4 s. All tunable. The generator emits depth only; the sim computes damage per
  body. This replaces fixed ford and liquid bands; a wet-ground ford at ≤ 0.25 m may remain as a navigation
  convenience (walkable, on the navmesh).
- **(2) Depth tiers.** Water depth uses a small set of standard tiers (count and depths tunable). Between adjacent
  tiers the bed slopes gradually over a minimum transition width (tunable, at a walkable slope). An abrupt drop to a
  deeper tier is allowed only where the shore itself is a non-walkable edge (a cliff, a dock, a ledge), never on a
  walkable beach or wading area.
- **(3) No exit-distance guarantee.** Being pushed or falling into inescapable liquid is intended play (ring-outs).
  Exit distance and lethal-liquid exposure are reported as metrics, and the fairness gate checks that they are
  balanced between the teams.
- **Bank bands** still apply wherever a bank exists: an exit (top ≤ 0.50 m above the surface, or a beach ≤ 40°) or a
  wall (top ≥ 1.00 m above it), nothing between. `climbOut` (0.8 m) equals Q6's blocking height exactly, so 0.8 m
  itself would be a threshold fault. Derived from `climbOut`.
- **(4) Liquids are data.** A liquid's medium is an id from a liquids registry (water, lava, poison, more later).
  Each entry holds its tunables: damage curve, knock-out time, element, which capabilities apply.
- **(5) Typed liquids are traversable by matching bodies.** Rules map type and abilities to per-liquid capabilities
  (`swim:lava`, `dive:lava`); the generator sees capabilities only, never types. A typed-liquid route is an overlay:
  never required, counted in `exclusiveAccessShare`, with a counter position. (This replaces the recommendation that
  lava is never an edge.)
- **(6) Diving is breath-limited** (tunable). Every `dive` edge fits inside the breath limit with a keep-away margin,
  and every submerged point is within breath range of air (the surface or an air pocket), flooded SDF caves
  especially.
- **(7) Survivable crossings for non-swimmers** are modelled as costed links open to every body (time plus damage,
  from the tunables). They are known shortcuts, not unexpected links (Q1e).
- **(8)** The spawn barrier (Q8h) blocks swim and dive entry too.
- **(9)** Depth, bank and submerged-clearance checks run per water level in every environment state.
- **(10) Tunables.** All of these numbers live in one data-driven rules file. The tunables version is part of
  `gameplayHash`, so changing a tunable marks the affected maps for re-validation. (`gameplayHash` is defined with
  determinism, below.)
  - *(Superseded by Q19(d), 2026-11-24.)* The tunables reach `requirementsHash`, which is a validation stamp beside
    `gameplayHash`, not a part of it. A changed stamp marks the curated seeds for re-validation. A map's
    `gameplayHash` moves only when the tunable changes the map itself.
- **Baseline stays dry** (as proposed, unchanged by 1–10): required routes never enter a liquid, in any environment
  state. `swim` and `dive` are capability overlays added after the baseline passes; swim-only or dive-only space
  counts toward `exclusiveAccessShare` and needs a ground counter and reach-and-return (as Q8.5).
- **Data.** A `Space` gains a `medium`: `'air'` or a liquids-registry id. A submerged space is a prism from the bed to
  the surface, or to the rock ceiling in a flooded cave; its clearances use the Q7 ladder. The `liquid` volume stays
  as the sim's contact data (level, medium), with the bed's depth available beneath it. Routes for swimmers and
  divers go in the Q8(e) volume graph with medium `'water'` (generalised to the liquid's id); bank exits are links
  between that graph and the navmesh. The zone-graph vocabulary gains `swim` and `dive` edges.
- **Kept** from the tile generator: the `drainage` gate (levels never rise downstream; a fall joins a reach to a
  pool). **Not in v1:** currents.

### Q10 Burrowing, concealment and stateful features (owner, 2026-11-23: accepted with amendments a–h)

**Burrowing.**

1. **Travel is under the surface, not in a tunnel.** A burrowing body moves in 2D across a connected soft-soil
   surface. No underground geometry exists for it. The generator knows the capability `burrow` only, never a species.
2. **Two things in the data.** A **soft-soil region** is a connected patch of walkable `terrain` floor with the
   surface value `soft-soil` (and the space tag). A burrower may travel and emerge anywhere inside it. A **`burrow`
   edge** is a declared underpass joining two soil patches beneath something a walker cannot cross (a wall, a fence,
   a cover line, a low terrace). Without edges burrowing is stealth only; the edges are what change routes.
   - *(c)* A `burrow` edge may pass under a liquid (a lake, a river, a waterfall cave). Emergence happens only on
     soft soil, never into a liquid.
3. **Sizes** (a). Underpasses and soil regions may use any rung of the Q7 ladder and carry the size restriction as an
   edge capability (for example a small-only burrow escape route). A region's width fits the largest body its edges
   admit.
4. **Speeds** (b). Burrow speed is a tunable and may exceed walk speed. The walker speed modifier on soft soil is a
   tunable, default 1.0. The validator uses both in its travel-time metrics.
5. **Minimum depth.** No tunnel, chamber, room or SDF cave lies under soft soil with less than `burrow.minDepth` of
   solid between the soil surface and the ceiling below (default 2.00 m, tunable). It replaces the 0.6 m slab there
   (Q5d, Q4e) and is checked point-wise against real cave ceilings. *(c)* It applies equally to any cave or chamber
   between the soil and the path of a `burrow` edge.
6. **Emergence.** Legal wherever the body fits on soft soil. Never inside an enemy spawn barrier (Q8h). Soft soil is
   never generated inside a protected area: a spawn, a staging area, or the objective's contest disc plus its
   shoulder. Soil may reach the edge of the objective space, not the point.
7. **Counterplay.** Every soft-soil sample is seen from at least two covered ground positions within reach (the
   exposure rule of Q8.6). A burrow-reachable landing spot that walkers cannot reach is a perch under the dominance
   gate. The detection cue itself (a mound, a tremor) is sim and render work (I4).
8. **Budget.** Space reached only by `burrow` counts toward `exclusiveAccessShare` and needs a ground counter
   position and reach-and-return. A separate cap limits soft soil's share of the playable area.
9. **Navigation data.** No new graph. Soft-soil polygons carry a navmesh area flag from the surface value;
   underpasses are off-mesh links of kind `burrow`.

**Size-gated routes** (a). Topology should aim for size-gated alternative routes with distinct payoffs, the "3-lane"
pattern: main lanes fit every size, side routes favour smaller bodies. An **interest metric** checks that exclusive
layers are not dead filler. (The size restriction is an edge capability on any edge kind, consistent with Q7(d). The
metric's definition goes to the validation question; the topology target goes to the recipe question.)

**Resource-limited capabilities: one generic rule** (d), for `fly`, `dive` and `burrow`. A long route is a chain of
legs. Each leg fits within one full resource with the keep-away margin. Legs are joined by **refill nodes**:
surfacing pockets, air pockets, perches. Refill nodes are hidden spaces under the exposure and dominance rules. This
replaces the per-capability wording of Q8.2 and Q9.6, which stay as its instances.

**Item spawn candidates** (e). The generator emits item spawn candidate markers, including in hidden and exclusive
spaces. The sim chooses the actual items per match from the match seed. Candidate count and value are balanced
between the teams (a fairness check). The game has no item system today (pickups left with the survivor loop); the
generator's part is the candidates only.

**Stateful environment features** (f). This generalises the breakable seal (the interaction specification's ST03
breach insert). *The owner's note: design not final; expect changes.*

- A feature is pre-placed and has a small, fixed set of states, changed by a capability or an elemental action.
  Examples: breakable walls, floors and ceilings; a pool evaporated by heat to reveal a hidden entrance; water frozen
  into a walkable bridge; vines burned away or grown to climb; sand or fog cleared by wind; boulders pushed; dark
  caves lit. The closest reference is Pokémon field moves (Cut, Rock Smash, Strength, Surf, Waterfall, Flash).
- **Every required guarantee holds in the all-base state.** A longer route always exists.
- **A state change only adds**: links, walkable area, or route width. It never removes walkable area that a base
  guarantee relies on.
- **The validator checks** the all-base state, the all-changed state and each single feature changed, with fairness
  between the teams in each.
- The feature count per map is a tunable cap. Trigger capability, strength tier, hit points and any revert timer are
  tunables.
- Changed-state geometry obeys the Q6 bands.
- Readable cues (cracks, steam, frost marks) are a presentation requirement.
- Reinforce, repair and the reaction rules go to I4.

This narrows the scope note "static geometry does not change after validation": the map is a static base plus a
capped set of features whose every state was validated before the match. Nothing else changes.

**Concealment.**

- *(g)* A one-way concealment spot (for example a vantage behind a waterfall that sees out and is hidden from
  outside) needs an explicit **concealment volume kind** and is a perch under the dominance gate. Detail goes to the
  validation question.
- *(h)* The surface of a liquid hides a submerged diver, in every liquid including the typed ones. Diving is then
  concealment like burrowing: surfacing points follow the emergence rule (6) and submerged samples follow the
  exposure rule (7) at the surface above them.

**WorldModel additions this implies** (shapes decided with the model contract, below): a marker kind for item
candidates with a value; a `concealment` volume kind; the feature records and their per-state colliders, links and
volumes (the existing `ColliderBase.destructible` id is the hook).

**Reads recorded with this answer (owner, 2026-11-23: all four confirmed):**

- Refill nodes "are hidden spaces" is read as: they are held to the hidden-space rules of Q1 (optional, off required
  routes, exposure and dominance checked). A perch may be open to the sky.
- Soft soil that some environment state floods is checked per state (Q9.9): where liquid stands, emergence is
  illegal in that state.
- Mixed feature combinations beyond "all base, all changed, each single" are not validated as gates. Reachability is
  safe in every combination because changes only add. **Added by the owner:** a non-gating seed-batch check samples
  random mixed feature combinations offline and reports fairness outliers.
- The validation count per map becomes (features + 2) × environment states. It is an input to the budgets question.

**Notes for I4 (game rules, not the generator).** An underground senses mechanic (Rek'Sai-like: movement and
silhouette cues above ground, no reveal, no targeting, per-hero trade-offs). UI that shows burrowers where they can
travel and emerge (from the space tags and `burrow` links). Underground encounters between burrowers. Emergence
knock-up as an engage or an escape. Ground-shaking attacks that hit hidden burrowers and divers. Elemental reactions
(grass plus water grows a tree that blocks emergence; rocks that small bodies cannot break) as temporary sim objects
outside map validation.

### Q11 The Hold mode graph in 3D (owner, 2026-11-23: accepted with a revised template)

The template is data in `src/rules/`, in the Q1 vocabulary, separate from any recipe. It replaces `CONTROL_POINT`
(`src/world/habitat/mode.ts`: one direct and one flank approach per side, one-way return edges). Exit nodes are
dropped: baseline edges are two-way and reach-and-return covers the way back.

**(1) Five route roles per side.**

| Role | Tier | Who | Character |
|---|---|---|---|
| Primary 1, "direct" | baseline | all bodies | fastest, level arrival, open |
| Primary 2, "screened" | baseline | all bodies | cover-rich, high or low arrival |
| Secondary, "rotation" | baseline | all bodies | longer; joins both primaries mid-way; for rotation and retreat; reaches the objective indirectly |
| Tertiary, "over" | overlay | `fly` and `climb` | cliffs, rooftops, perches, refill nodes |
| Tertiary, "under" | overlay | `burrow`, `dive` and small sizes | soil, lake, crawlspaces |

- The two primaries are node-disjoint between the staging exit and the objective entrance.
- The secondary may touch the primaries only at declared cross-links.
- Tertiaries are overlays stacked above or below baseline space, so they add options without extra footprint. Each
  tertiary serves several capabilities.
  - *(Owner, 2026-11-24.)* **G2's `plan` and `embed` lay out all five route roles from layer 1** of Q14.10(c). The
    "over" and "under" tertiaries are planned and their space is kept empty, so layers 2 and 3 fill it without
    moving the baseline routes.
- Baseline edge kinds are `walk`, `ramp`, `stairs`, `bridge` and `tunnel` only, at 5.00 × 3.70 m (Q7). `fly`,
  `burrow`, `swim`, `dive`, `jump`, `drop`, `climb` and size-gated edges are never baseline.

**(2) Cross-links in three tiers**: safe rotation links near staging, contested mid links at a landmark, and
objective-edge links for late flanks and retreat. Every route has a retreat path. Liquid edges may still allow
ring-outs (Q9.3).

**(3) Role metrics.** Each route is scored on travel time, exposure, arrival height advantage, accessible roster
share and engagement range. Every route must be Pareto-optimal (best at something). A route dominated on all scores
fails the attempt as redundant. The same dominance test applies to vantages and perches: no universally superior
position.

**(4) No dominant route choice.** A route-choice payoff proxy (attacker against defender, from the time, exposure
and arrival metrics) must have no strictly dominant route. Graph checks: no articulation node on required routes, a
loop count at or above a tunable minimum, and the objective's betweenness share at or below a tunable cap.

**(5) Depth per complexity**, a reported metric: distinct non-dominated options ÷ (spaces + active mechanics). Any
route or mechanic that adds no non-dominated option is pruned.

**(6) Environmental control.** Stateful features (Q10f) are placed to create control decisions between routes: a
breakable wall from rotation to screened, a freezable lake that turns "under" into a temporary walkway for all,
construction sockets. Still validated all-base, all-changed and each single.

**(7) Rhythm.** Each route alternates combat spaces with transit and a recovery pocket (cover, out of the
objective's sight).

**(8) Asymmetric trade-offs are between routes, not between teams.** Team symmetry is `half-turn` by default;
`mirror` is the other value; `none` is deferred until the fairness thresholds are calibrated on symmetric maps.
- Symmetry covers the whole gameplay half: spaces, gameplay-tier pieces, features, item candidates. The generator
  builds side A and derives side B (half-turn is negating x and z: exact in floats, no trigonometry, winding kept).
- Lighting and readability are fair per side. Dressing and landmark art may differ per side.
- Opened-shortcut gains (a feature's changed state) are capped and checked per state.

**As proposed, accepted unchanged.**

- **Vertical arrival classes**, measured at the objective space: `level` within ±0.50 m of the objective floor;
  `high` on a terrace ≥ 2.00 m above (over the 1.84 m jump apex, so it is real high ground), linked down by a ramp or
  stairs; `low` from ≥ 2.00 m below through a tunnel or cave mouth. No approach leaves ±8.00 m of the objective
  floor (today's `rise`). One approach may cross over another by a bridge (Q5 stacking).
- **Objective space.** The disc (r 5 m, `rules.objectives.hold.radius`) plus a 1.00 m shoulder sits on one lattice
  height. Dry in every state; no soft soil; no liquid. At least 60 % of the disc is clear for the XL footprint
  (today's `contest` gate).
- **Capture volume**: a cylinder r 5 m × h 3.70 m with exactly one walkable level inside it. A body centred inside
  it captures, hovering included; a body above it does not. Balconies and tunnels over or under it do not capture.
- **Distance.** The plan stage places the staging barrier exit 33–47 m horizontally from the point. The gate is the
  baseline walk time at a reference speed held in rules. Spawns are ≥ 40 m apart and never in each other's sight
  (today's `spawns` gate).
- **High ground.** Every `high` terrace and every vantage that sees the disc is a perch under the dominance gate. It
  needs a baseline route from both sides or a counter position (today's `counter` gate).
- **Overlay gain.** An overlay route's time gain over the best baseline route is capped (number with validation).
- **PvE.** The Raid party and the T1 waves keep using team B's spawn and staging markers. The Raider pin against
  the despawn relocation stays a sim rule.

**Correction to the proposal's walk-time band.** The proposal quoted "today's 8–15 s". That figure is path length ÷
the frozen 7.2 m/s trainer speed (`src/world/habitat/validate.ts`), over winding paths of 60–109 m. Heroes move at
5.6–6.4 m/s today (`topSpeed` 6.0, `speedBand` 0.8). A direct route at 33–47 m with little winding takes roughly
7–10 s at 6.0 m/s. The thresholds are therefore set at G2 from measured maps, in time at the reference speed, not
taken from the old band.

**Embedding check, asked for by the owner** ("33–47 m may be tight for five routes; flag if the plan stage cannot
embed it"). An estimate, not a measurement:

- The objective space takes about 10 m of radius (disc, shoulder, entrances), which leaves 23–37 m of radial run.
- A primary needs, by (7), at least one combat space (about 10 m), transit either side (about 6 m each) and a
  pocket off the lane: about 22 m. **At 33 m a primary holds exactly one combat space.** It fits, with no slack.
- A `high` arrival costs about 8 m of ramp and landings. A `low` arrival that passes under another baseline space
  must go down 4.30 m (3.70 m clearance plus the 0.60 m slab) and come back up: about 21 m of ramp and landings. It
  fits only where the lane is about 40 m or longer, or curves.
- Three cross-link tiers sit 8–12 m apart radially.
- Lateral room is not bounded by the staging distance: three baseline lanes fit side by side in a half-turn wedge.

**Read: it embeds, with the plan stage skewing toward 40–47 m** when the screened route arrives `low`. The number
is not changed here. G2 reports the embed success rate against staging distance; a poor rate below 40 m is the
signal to move the band, the owner's decision.

**Reads recorded with this answer (owner, 2026-11-23: all five confirmed; embed skew and speed correction noted):**

- "No articulation node on required routes" is read as: between the staging exit and the objective entrances. The
  spawn, the staging and the objective itself are single nodes by the mode's definition.
- A cap on the objective's betweenness share implies at least one bypass around the objective space joining the two
  halves (the objective-edge links). Under half-turn symmetry bypasses come in pairs.
- (3) and (5) together: a role route of the template that is dominated fails the attempt; an optional element (a
  cross-link, a vantage, a feature, a mechanic) that adds no non-dominated option is pruned, which is a bounded
  repair.
- With five scores, almost any route is Pareto-optimal by a hair. "Best at something" needs a margin per score to
  mean anything; the margins are tunables set with the validation question.
- `climb` and `burrow` are not traversal kinds in `src/rules/traversal.ts` today (shipped: glide, hover, swim;
  reserved: fly, levitate, dive). The generator needs only the capability names; the kinds are a follow-up for the
  movement tasks.

### Q12 Validation: where gates run, what they measure, which are hard (owner, 2026-11-23: accepted with amendments a–d)

1. **Three checkpoints.**
   - `check` (the graph, before embed): template roles, node-disjoint primaries, articulation, loops, betweenness,
     refill legs, retreat paths, rhythm.
   - `emit` backstops, with no repair: bands, seams, point-wise clearance, the slab and `minDepth`, depth tiers, bank
     bands, volume-edge sweeps, budgets.
   - `validate` (the finished WorldModel): everything that is measured.
2. **Gates measure with the game's own structures.** A gate is a pure function in `src/world` over (WorldModel,
   GenReport, `Probe`). `Probe` is a small interface (path, shape sweep, ray) implemented by `src/physics` and
   `src/nav` and passed in, so the validator and the game cannot disagree and `src/world` still imports neither.
   Real controller walks stay in the CI conformance tests (Q3b), not in per-map validation.
3. **When.** A validation result is a pure function of the recipe, the seed, the generator version and the tunables.
   - **Curated seeds**: the full gates and metrics run offline in CI. At run start the game regenerates the map,
     compares its `gameplayHash` with the recorded one and runs no gates.
   - **Free seeds**: run start runs the hard classes A–C only. Metrics are skipped.
   - *(c)* A free-seed map that ran classes A–C only is marked **unranked** and is never served in ranked play.
4. **Six classes, in priority order.** A lower class is never traded against a higher one.
   - **A, reach and bounds (hard):** reach per size class and capability; reach-and-return; primaries disjoint as
     built; planned links exist; the team-aware spawn barrier; resource legs; the objective disc; no emergence in a
     protected area.
   - **B, fairness (hard):** under symmetry these are assertions. Per-side walk time within 2 %; equal item
     candidates, features and lethal-liquid exposure.
   - **C, budgets (hard):** numbers with the budgets question.
   - **D, engagement and cover (repair, then fail):** dominance, counter position, the exposure rule, watch, longest
     lane, exposed run, chokepoint width, spawn safety, exclusive share, soil share, overlay gain.
   - **E, design quality:** route and vantage Pareto, the payoff proxy, depth per complexity, interest, sight-line
     histograms.
   - **F, looks:** never a generator gate. *(d)* The blueprint's phantom-concealment lint and a per-side readability
     lint gate a **visual variant** before it ships (render-side, offline; with archetypes and world styles below).
5. **Class D starting numbers.** All are tunables, calibrated at G2.

   | Gate | Starting value |
   |---|---|
   | Perch (dominance) | fails when it sees ≥ 50 % of both of a side's final approaches and the point (today's rule) |
   | Longest straight firing lane | ≤ 18.0 m (today's `LANE`: ranged reach 13 m + 2 × 1.8 m + 1.4 m) |
   | Exposure rule | ≥ 2 covered ground positions within 13 m |
   | Exclusive-access share | ≤ 25 % of the playable floor in total, ≤ 15 % per tertiary |
   | Soft-soil share | ≤ 20 % of the walkable area |
   | Overlay and opened-shortcut gain | between 10 % and 30 % over the best baseline route; below 10 % is dead filler, the interest metric's floor |

   The owner expects to raise the per-tertiary cap if burrowing feels limited in playtests.
6. **Class E.**
   - On from the first map, needing no number: strict dominance (a route worse or equal on every score fails), no
     strictly dominant route in the payoff proxy, no articulation node, loop count ≥ 2 per side.
   - Named tunables with no value yet: the Pareto margins and the betweenness cap. The first G2 seed batch reports
     their distributions, the owner sets the values, and the gates switch on then.
   - *(b)* Dominance and Pareto checks compare routes **within one side's route set only**. Mirrored counterparts are
     excluded, so symmetric twins are never "equal on every score".
7. **Sampling is deterministic, with no RNG.** Navmesh positions on a 1.0 m grid; eye heights from the size ladder
   (*Q15(g): the viewer end of a sight sample is the clamped view height from the framing source; the target end is
   the body*); air samples at mid-envelope and at the cap; rays read `blocksShots`. "Covered" and "exposed" are
   defined once and used by every gate.
8. **States.** A, B and D run in every environment state × (all-base, all-changed, each single feature). C runs
   once. E runs in all-base and all-changed. Mixed combinations are sampled offline, non-gating (Q10).
9. **Concealment volume** (deferred from Q10g).
   - *(a)* **It blocks sight only.** Shots and bodies pass in both directions, and rays used for shot and cover
     checks ignore it. Otherwise it would be an invulnerable nest.
   - Sight rays from outside stop at it; sight rays from inside pass.
   - It is a perch under the dominance gate.
   - It needs a baseline entrance open to both teams, or it counts as exclusive space with a counter position.
   - The count per side is capped. Reveal on firing is I4's.
10. **Report.** `GenReport` carries gate results, metrics, repairs and the resolution log. A seed-batch harness
    writes one baseline JSON per recipe; CI fails on failure-rate thresholds per gate and per builder (Q6c).

### Q13 Repairs, attempts and fallback (owner, 2026-11-23: accepted with amendments a–c)

Today (`src/world/habitat/index.ts`): 6 attempts per seed, each with up to 4 repair rounds of two repairs (`occlude`,
`widen`), then the recipe's `fallbackSeeds`, then an error.

1. **Budgets are counts, never wall-clock time.** A time cut-off would give a slow machine a different map from the
   same seed. Measured time is a CI threshold only.
2. **The failure ladder**, each step bounded:
   - Plan: up to 8 graph candidates until `check` passes (graph only, cheap).
   - Embed: up to 4 sub-seeds per graph.
   - Topology: up to 3 graphs per seed, so at most 12 built attempts.
   - Repair: up to 3 rounds per attempt.
   - Then the fallback. No step ever relaxes a requirement (Q1c).
3. **A repair patches the IR, never the emitted model.** It is a pure function (IR, failed gate) → IR patch; the
   affected spaces are rebuilt, re-emitted and re-validated, so collision, navigation and render keep one source.
   Under symmetry the patch goes to side A and is derived for side B.
4. **Catalogue v1**, for class D and for class E pruning only:
   - `occlude`: add a kit cover piece or a parapet to break a sight line (perch, watch, lane, exposed run, spawn
     safety).
   - `open`: remove or lower a cover piece, or cut a window, to create a sight line (exposure rule, a counter
     position's line of sight).
   - `counter`: add cover that makes a covered ground counter position.
   - `prune`: delete an optional element (a cross-link, a vantage, a hidden space, a feature, a tertiary segment, an
     item candidate, a soil patch) that is dominated or over a share cap. Fixed order, lowest interest first.
     - *(b)* **Prune cascades.** Removing an element removes its dependants (a refill node and its legs; a soil
       patch and its `burrow` edges; a feature and its links). Class A is then re-checked for every affected
       capability. Prune never removes the last instance of a template route role.
5. **Never repaired:** classes A, B and C. Today's `widen` (clearing props to fix reach) is not carried over: with
   IR-dimensioned pieces a reach failure is a builder bug, so it is a typed failure counted in CI.
6. **Never touched by a repair:** the required spaces and clear widths of the five role routes, the objective disc
   and its shoulder, spawn and staging, landmark anchors, the required part of the zone graph.
7. **Termination.** A round must lower the failing-gate count or the attempt ends. A repair that breaks a higher
   class ends the attempt at once. Repairs run in a fixed order and use no RNG.
   - *(a)* Both tests are evaluated over the **full state matrix** (environment states × all-base, all-changed and
     each single feature), not over one state.
8. **The fallback is the recipe's curated list**, which does both jobs.
   - A free seed that exhausts the ladder takes `curated[hash(seed) mod n]`, deterministically. `meta` records the
     requested seed, the used seed and why (as today).
   - A replay stores the requested seed; regeneration takes the same fallback because the ladder is count-based.
   - Every shipped recipe needs at least 3 curated seeds. CI regenerates each, runs every gate and matches the
     recorded `gameplayHash`. A recipe with an empty list cannot ship.
   - When the generator version or the tunables change, CI re-validates the curated seeds; an offline seed-search
     script replaces the failures, and that commit says why.
9. **A hash mismatch on a curated seed at run start** is a determinism bug: log it, run classes A–C, play the map
   unranked.
10. **Yield is reported and gated in CI** per recipe: first-attempt pass rate, mean attempts, fallback rate, failures
    per gate, repairs per seed. Starting threshold: a fallback rate ≤ 5 % of a free-seed batch, calibrated at G2.

*(c)* **Flag carried to the determinism question.** Per the blueprint, ranked and curated maps may load the stored,
validated GameplayBundle instead of regenerating, so cross-browser drift cannot affect ranked play;
regenerate-and-compare then stays as a CI check. This touches the inherited decision "no shipped map files", so it is
put to the owner there rather than assumed. **Resolved in Q19(c):** regenerate now; the bundle is deferred behind a
named trigger.

### Q14 Recipe schema and knob compilation (owner, 2026-11-23: accepted with amendments a–g)

Point 9 of the proposal is replaced by (f). The amendments arrived in two messages: (e)–(g), then (a)–(d).

Today a recipe names a `landform` kernel (gorge, crater, shoal, ridge, lagoon, sanctuary), each bespoke code, and
carries per-recipe sub-schemas (`tide`, `graves`).

1. **A recipe is data that picks from closed registries.** One record per file in `src/rules/recipes/`. The id
   unions (embedder, kit family, placement pattern, liquid, feature kind, style) live in `src/rules`; the
   implementations live in `src/world` as `Record<Id, Impl>`, so a missing implementation fails the typecheck. A new
   map is data only. A new landform shape is new embedder code and a generator-version bump.
   - *(Q23)* Three render-side registries follow the same rule: **mesh builders, post passes and emitter kinds**.
     Their ids live in `src/rules`; their implementations are a `Record<Id, Impl>` in `src/render`, because they
     import three.
2. **The sections an author edits:**

   ```ts
   interface Recipe {
     id; name; summary;
     canon: { anchors; adaptations; refs };      // provenance, documentation only
     mode: 'hold';
     symmetry: 'half-turn' | 'mirror';
     routes: {                                   // per-role options the template leaves open
       screened: 'high' | 'low' | 'either';
       over: Capability[]; under: Capability[];  // which capabilities each tertiary serves
     };
     layout: { embedder: EmbedderId; freedoms: Record<string, [min, max]> };
     spaces: Record<NodeRole, { enclosure; floor; kit: KitFamilyId[] }>;
     liquids: { id: LiquidId; tiers: DepthTierId[] }[];   // (b): tier ids from the rules registry, not metres
     states: EnvStateId[];
     features: { kinds: FeatureKindId[]; count: [min, max] };
     knobs: { openness; cover; verticality; enclosure; wetness; soil; complexity };  // 'low' | 'mid' | 'high'
     species?: SpeciesSelection;                 // (e), below
     curatedSeeds: number[];
   }
   ```

   - *(Owner's review, 2026-11-24.)* `curatedSeeds: number[]` is shorthand. The curated list must carry each
     seed's recorded `gameplayHash`, which run start compares against (Q12.3), and beside it the `requirementsHash`
     stamp of Q19(d). The shape of that record is G1's.

3. **What a recipe cannot hold:** any class A–C threshold; movement, size or camera numbers (derived from rules).
   *(Species names were on this list in the proposal; (e) removes them from it.)*
   - *Reworded by Q16(a):* a recipe may hold both the **physical binding** (role → `MaterialId`, hashed) and an
     optional **`look`** section with visual overrides (role → style material or colour, palette bias), applied as
     the map-override layer between biome and style. `look` is presentation only: never part of `gameplayHash`,
     never read by the generator, physics, nav or sim, and gated by the Q12(d) lints and the Q16 readability check.
4. **Knobs are levels, not numbers.** Each knob is `low | mid | high`. One rules table maps each level to a
   generation target range and a class D or E validation threshold. Seeds vary inside the range.
5. **`compile(recipe, rules) → Requirements`** is a pure function run before `plan`. It outputs per-stage generation
   parameters and the validation thresholds. An author never sets a threshold directly, so no recipe can weaken a
   gate.
6. **Resolution log.** When knobs conflict with each other or with a higher class, `compile` resolves by the
   priority order (reach and bounds > fairness > budgets > engagement and cover > looks) and records, per knob, the
   requested level, the resolved value and the rule that overrode it. The log goes in `GenReport`.
7. **`validateRecipe(recipe, rules) → Issue[]`**, with no schema library: ids exist in the registries; ranges are
   ordered and inside the limits the embedder declares; every freedom is one the embedder declares; no unknown keys;
   statically contradictory knob sets are reported; a shipped recipe has at least 3 curated seeds. It runs in tests
   and as a dev-build assert.
8. **Bespoke sub-schemas go away.** Graves become a cover kit family with the placement pattern `lattice`. Ruins
   become a kit family. Tide becomes an environment state on a liquid.
9. *(Replaced by (f).)*
10. **The first G2 recipe is River Gorge, re-authored in the new format**, not a port of its kernel. It is today's
    replay Hold map, and it covers the owner's own examples: a waterfall cave (SDF, concealment volume), a river
    (depth tiers, dive), rims and benches (high arrival, perches), soil banks (burrow). The porting order of the
    other five recipes is a roadmap item.
    - *(c)* **It is built in layers, each a passing checkpoint:** baseline walking routes → the "over" tertiary →
      the "under" tertiary (burrow, then dive) → liquid states → stateful features and the concealment volume.
      - *(Owner, 2026-11-24, answer B.)* The cutover X1a needs layer 1 only. Layers 2–5 are tasks after X1c
        ("Open items", task order and scope).
      - *(Owner, 2026-11-24.)* **All five route roles are laid out from layer 1** (Q11). `plan` and `embed` plan
        the "over" and "under" tertiaries and keep their space empty, so layers 2 and 3 fill it without moving
        the baseline routes.
      - *(Owner, 2026-11-24.)* **Each of layers 2 to 5 changes River Gorge's `gameplayHash`, and that is a planned
        change.** The layer's task names it, re-records the River Gorge scenarios once, and its commit says why
        (the Q19.6 rule). Any other moved hash is still a stop.

**(a) A dev-only experiment overrides file** (the blueprint's expert layer). It may override any tunable or threshold
for experimentation. A map generated with it is always unranked, never curated, and can never ship. Shipped recipes
stay unable to set thresholds (point 5).

**(b)** `liquids[].tiers` names depth-tier ids from the rules registry (Q9.2), not metres.

**(d)** The hand-written `validateRecipe` in place of the blueprint's Zod is recorded as a deliberate change from the
blueprint (the owner's 2026-11-23 decision in the brief: no schema library).

**(e) Recipes may carry a species section.**

- Forms: an explicit list; filters (a region such as Hoenn, a type, a theme); or a seeded random draw from filters.
- It applies to wild and ambient spawns, to the allowed roster, or to both.
- The generator still never makes a geometry decision from a species. `compile` derives the capability set from the
  recipe's species through `traversalOf` and uses capabilities only.
- `validateRecipe` fails if a tertiary serves a capability that no species in the pool holds.
- The species selection is part of `gameplayHash` when it affects validation.
  - *(Superseded by Q19(d), 2026-11-24.)* The species capability set is part of `requirementsHash`, the validation
    stamp. It moves a map's `gameplayHash` only through the geometry it changes.
- This supersedes "no recipe names a species" in Q8.1; the rest of Q8.1 stands.

**(f) No visual variants of a map.** No snow or ash versions; each map has one style binding.

- A future day/night cycle runs within a match. Lighting is presentation and never changes `gameplayHash`.
- The readability and phantom-concealment lints run at sampled times across the cycle. Heroes stay readable at night
  (for example by rim light).
- The sun path is chosen so both sides get equal glare and shadow over the cycle (this extends Q11's per-side
  lighting fairness).
- Anything night changes in gameplay (spawns, tide, abilities) is an environment state, validated like tide.
- *(Amended by Q23.2.)* Time of day is per map: a fixed time, a partial range or a complete cycle. "A cycle runs
  within a match" above now holds only for a map that declares a range or a cycle. "Across the cycle" here, in (g)
  and in Q16.7(b) now reads "inside the map's range". The environment-state bullet stands unchanged.

**(g) Seasonal events are wanted.** They are time-limited theme overlays (the blueprint's Theme Overlay) on the same
map: the same `gameplayHash`, gated by the Q12(d) lints across the day/night cycle. An event that changes gameplay
sets `gameplayVariant: true` and gets full validation. "No visual variants" in (f) means no permanent alternate
versions of a map; it does not exclude event overlays.

**Reads and facts recorded with this answer (owner, 2026-11-23: all four confirmed):**

- The seeded draw in (e) needs the seed, so `compile` takes the seed for that draw only, on its own RNG stream.
- Only the capability set derives from the species pool. The size-class guarantees of Q7 stay universal regardless
  of a recipe's roster.
- `SpeciesDef` (`src/rules/species.ts`) has `dex`, `elements` and `types`, and no region or theme field. A region
  filter can derive from the `dex` range through a rules table; a theme filter needs a new authored field. The
  reference catalogue holds regions but may not be imported by `src/sim` or `src/world` (CLAUDE.md).
- Pivot decision Q9 removed spawn pools. (e) adds recipe-level species data; the sim system that reads it for wild
  and ambient spawns is not designed here.

### Q15 Archetypes: gameplay proxy, visual envelope, phantom checks (owner, 2026-11-23: accepted with amendments a–f)

Today `ColliderBase.blocksShots` means shots and sight together, and `foliage` means shots pass and bodies stop. A
bush therefore hides a body on screen but not from the sim's sight rays.

1. **An archetype is one record in `src/rules/`** (a rock, a trunk, a wall piece, a pillar, a hedge, a grave marker,
   a ruin piece). It declares a **gameplay proxy** and a **visual envelope**, never a mesh.
2. **Proxy:** 1–4 yawed boxes on the 0.05 m lattice. *(b)* G1 measures cylinder and hull proxies.
   - *(Q23.7)* **Chunky proportions.** Gameplay-tier proxies are chunky by a default exaggeration value in
     `src/rules`, with an override per archetype. Both are proxy dimensions, the same in every style profile.
     Changing either re-validates the affected maps and moves their `gameplayHash`, so the Q19 version discipline
     applies. They stay on the 0.05 m lattice, inside the Q6 and Q7 bands and on the Q15b cover ladder:
     exaggeration moves a dimension between legal values only (confirmed by the owner, 2026-11-24).
   - *(Q23)* Faceted rocks are the case for the hull proxies that G1 measures.
3. **Colliders come from semantics only.** `emit` builds colliders from proxies. No collider ever comes from a visual
   mesh, and no instance sets flags by hand.
4. **Three flags, five kinds.** The semantics are `blocksBodies`, `blocksShots` and `blocksSight`, used only through
   a closed list:

   | Kind | Bodies | Shots | Sight | Examples |
   |---|---|---|---|---|
   | `solid` | stop | stop | stop | rock, wall, trunk |
   | `foliage` | stop | pass | stop | hedge, dense canopy |
   | `grate` | stop | pass | pass | fence, railing, window blocker (Q5b) |
   | `screen` | pass | pass | stop | tall grass, a waterfall sheet: a concealment volume (Q12a), not a collider |
   | `dressing` | pass | pass | pass | no collider |

   `ColliderBase` gains an explicit `blocksSight`: a model contract change.
5. **Cover heights are a ladder with dead-bands**, like Q6, derived from `rules.size`, not literals.
   - *(a)* The ladder is **1.00, 1.50, 2.00 and 3.70 m**. Each rung hides one more group: Tiny and Small (0.6,
     0.9 m), Medium (1.2 m), Large (1.7 m), then every body including giants at the 3.57 m cap.
   - *(a)* The proposal's 2.70 m rung is dropped: it lies inside the XL class's continuous height range, the same
     fault as in Q7. A 2.70 m piece may exist only as a rung that guarantees to hide no further class.
   - No cover top lies within 0.10 m of a class height.
6. **Jumpable tops are landing spots.** Any proxy top a jump reaches (the 1.84 m apex less a margin) is treated as
   standable in validation and is seen by the dominance gate.
7. **Visual envelope:** the proxy grown and shrunk by a tolerance. The render mesh must fill the shrunk proxy and
   stay inside the grown one.
   - *(b)* The tolerance is per archetype with a capped maximum (starting at 0.10 m), so organic shapes (boulders,
     trunks) are not forced boxy.
8. **Two lints**, both render-side (they import three), offline in CI, gating visuals per Q12(d):
   - **Phantom cover:** rays from sampled directions hit the visual mesh and the proxy; the first-hit distances must
     agree within the tolerance. It catches visible mass that stops nothing, and invisible walls.
   - **Phantom concealment:** what hides a body on screen must match `blocksSight`, per kind.
     - *(Q23.4c)* The same holds for signals: what hides a signal on screen is what blocks sight in the sim, under
       the one occlusion rule its kind declares. Atmosphere and dressing never hide a signal.
9. **Dressing can never read as cover.** A dressing archetype's envelope is ≤ 0.50 m tall inside reachable space.
   Taller dressing is allowed only where no body can go.
   - *(c)* The flight envelope is reachable space. A canopy or an overhang inside it needs a proxy (`foliage` or
     `solid`), never dressing.
   - *(e)* Event-overlay dressing and night dressing obey the same rule, unless the overlay sets
     `gameplayVariant: true` (Q14g).
10. **Per-state archetypes** (d). `breaksInto` is generalised to a per-state archetype map for every stateful feature
    (Q10f): broken, evaporated, frozen, grown, cleared. Each state's proxy obeys the Q6 bands. (The 0.65 m stump is
    settled with the hazards question.)

*(f)* **Note for I4.** The third-person camera sits above the body's eye, so peeking over cover with the camera is
possible. Validation uses body eye heights. I4 decides whether to limit camera peek. *(Resolved by (g).)*

**(g) Camera direction (owner, 2026-11-23, added after the answer; for I4 and the camera owner).** *Amended by Q15c
(owner, 2026-11-25): the band is no longer a gameplay constraint; sight origins come from anatomy. See Q15c below.*

- The chase camera stays low, close and behind every hero, at about the body's own eye level, for immersion.
- **View height is clamped to a band.** A maximum cap means tall bodies gain no view advantage. A minimum floor sits
  just above the 0.50 m dressing height (rule 9), so tiny bodies see over dressing but never over cover.
- The hero's own body fades where it occludes the view. The camera pulls in and around walls in tight spaces.
- **"What you see is what you can hit."** Shots need line of sight from the clamped view point, so a capped giant
  cannot fire over cover it cannot see over. Size is balanced by hitbox, not by view.
- **Consequence for the generator.** The Q7 camera table, the camera reasoning behind 3.70 m and the 8.00 m
  short-side rule (Q7a) are recomputed from the new camera law through the single framing source in `src/rules`
  (Q7c). Validation sight samples use the clamped view height. The camera-peek note (f) is resolved by this.

What (g) leaves standing and what it voids, as read here:

- The 3.70 m clear height stands on body clearance alone (a giant at the 3.57 m cap plus the keep-away). Only its
  camera justification is void.
- The 8.00 m short side and the Q7(b) camera table are void until the camera law has its numbers (the view band and
  the camera distance). The `camera-clearance` tag stays; its dimension rule is open until then.
  - *(Owner, 2026-11-24, answer D.)* "The camera task" in this document is the new task **CL, "Camera law"**,
    queued before G2 and I2b: the view band and the camera distance law in `src/rules` (Q7c), and the sim rule
    above (line of sight from the clamped view point, `src/sim/aim.ts`), flagged off until X1a.
- A sight sample has two ends: the viewer at its clamped view height, the target as its body (to its top). Cover
  hides by body height; a body sees over cover by view height.
- The camera documents (docs/CAMERA.md, docs/THIRD_PERSON.md) still describe the framing law this replaces. They
  are the camera task's to update, not this design's.

**Q15b: correction to rule 5, found while applying (g) (owner, 2026-11-23: accepted as starting tunables;
provisional since Q15c, 2026-11-25).** The
view band 0.60–1.35 m and the cover ladder 1.45 / 2.00 / 3.70 m below replace rule 5(a)'s numbers. Both are derived
and are recomputed if the camera task changes the band. The owner accepts the consequence that tall bodies see no
further than the cap. The camera distance stays the camera task's number; until it exists the `camera-clearance`
dimension is open.

The accepted ladder used nominal
class heights. With the tilt ranges of Q7 (Small 0.83–0.97 m, Medium 1.10–1.30 m, Large 1.56–1.84 m), two rungs are
threshold faults of the kind (a) removed: 1.00 m is 0.03 m above the tallest Small, and 1.50 m is 0.06 m below the
shortest Large. No height separates Tiny from Small or Small from Medium with 0.10 m on both sides, the same result
as Q7's width groups. Derived with tilt, the ladder is **1.45, 2.00 and 3.70 m**: it hides the narrow group, then
Large and below, then every body. Proposed with it: the view band's ends are derived, not chosen: floor = dressing
height + 0.10 = **0.60 m**; cap = lowest cover rung − 0.10 = **1.35 m**. No body then sees or fires over any cover
rung. A Large or Extra Large body behind 1.45 m cover still shows its top, so size is paid in hitbox. Fighting over
cover needs high ground or a jump. A view law stepped per size class (shoot-over half cover for some classes) was
not recommended and is not adopted: it would bring back a view advantage by size.

**Q15c: physical proportions, size-dependent gameplay (owner, 2026-11-25, in the CL grilling; amends Q15b and
Q15(g)).** Given in answer to CL's first question (how the 0.60–1.35 m band should live in `src/rules`), and replacing
that question as framed. Recorded verbatim:

> The intention is to create a world with believable physical proportions relative to Pokémon, allowing slight
> exaggerations where they improve gameplay, readability or visual quality. Use consistent world-scale units and
> physical rules. Environmental objects and Pokémon should have meaningful dimensions, shapes and physical properties.
>
> *Size-dependent gameplay*
> - Concealment, cover, visibility, accessibility and exposure should emerge naturally from the relationship between
>   Pokémon anatomy, size, posture, position and environmental geometry.
> - Small Pokémon should be able to hide behind smaller objects or within vegetation when their physical dimensions
>   permit it.
> - Larger Pokémon should require larger objects for equivalent concealment but may naturally see over obstacles that
>   obstruct smaller Pokémon.
> - Support partial exposure, partial concealment and partial cover rather than unnecessarily binary states.
> - Preserve size-dependent strengths, weaknesses and trade-offs rather than artificially equalizing physical
>   outcomes.
>
> *System separation.* Keep the following systems logically separate but geometrically consistent: presentation
> camera; gameplay sight origin and line of sight; visual concealment; physical cover; attack origin and trajectory;
> body and collision geometry; environmental material properties. Vegetation may provide visual concealment without
> providing physical protection. Solid objects may provide both.
>
> *View height.* Do not enforce the universal 0.60–1.35 m view band as a gameplay visibility constraint. Derive
> gameplay sight origins from each Pokémon's anatomy, orientation and posture. Camera-specific constraints may remain
> as presentation rules if necessary, but they must not provide unintended information advantages, such as seeing
> enemies through or over obstacles that should conceal them.
>
> *Environmental scale.* Determine environmental dimensions from believable world-scale proportions and intentional
> level design. Do not derive all environmental heights exclusively from Pokémon size categories. Use natural
> variation in environmental geometry to create different tactical opportunities for different Pokémon.
>
> *Gameplay balance and validation*
> - Ensure visual geometry and collision geometry correspond reasonably.
> - Prevent camera peeking, attack-origin exploits and clipping exploits.
> - Ensure concealment rules apply consistently to targeting, enemy detection and gameplay information.
> - Provide meaningful environmental opportunities for Pokémon of different sizes without guaranteeing identical
>   accessibility or cover effectiveness.
> - Balance size-related disadvantages through complementary, meaningful gameplay advantages where appropriate.
> - Validate representative Pokémon across the full size range, including different anatomies, postures, terrain
>   elevations and environmental materials.
> - Use deterministic geometric rules, a single source of truth for physical dimensions and automated tests to
>   preserve intended relationships.
>
> Treat the existing 0.60–1.35 m view band and 1.45 m cover rung as provisional values, not mandatory physical
> constraints. Review their purpose and dependencies before retaining, replacing or removing them. The governing
> principle is to standardize physical rules, not physical outcomes. Meaningful gameplay differences should emerge
> from consistent interactions between Pokémon and the world.

With it (same answer): creatures stay flat sprites for now and 3D models may come later, so a creature's gameplay
body and sight origin come from data, not from its picture: a table of simple measurements per species (eye height,
body dimensions, any postures gameplay needs) with defaults by size class that a species can override, built so a
future 3D model reads the same table, which stays the single source of truth.

What Q15c changes, as read here (the full list of reopened decisions and who owns each is settled in the CL
grilling and recorded under "Open items"):

- Q15(g)'s "view height is clamped to a band" and "a capped giant cannot fire over cover it cannot see over; size is
  balanced by hitbox, not by view" no longer hold as gameplay rules. "What you see is what you can hit" stands, with
  the viewer's end at its sight origin from the anatomy table, not a clamped height.
- Q15b's band 0.60–1.35 m and its ladder 1.45 / 2.00 / 3.70 m are provisional, not derived constraints. The camera may
  keep a band as a presentation rule only, and only where it gives no information the sight origin lacks.
- Q15(f), camera peek, is open again: (g) closed it with the band.

**CL grilling answers under Q15c (owner, 2026-11-25).**

- **CL-Q2, the anatomy table and CL's scope: accepted as proposed, with conditions.** `src/rules/anatomy.ts` holds
  per species `height`, `length`, `width`, an `eye` point (the gameplay sight origin) and named attack origins, with
  postures (only `stand` used now), in in-game metres from the size curve (not official metres). Size class × official
  shape gives fallback defaults (fractions of the class body). Overrides may set any dimension or point and are
  reviewed data. The sim never reads the art; a Node lint compares the table with each sprite's measured outline.
  CL builds the table, the lint (report-only), the framing source and the camera distance law, and the aim rule
  under `rules.aim.viewSight`. Conditions:
  1. Flag off, nothing changes: `CHASE_CONFIG` framing, the muzzle and every replay hash stay as recorded;
     `tests/camframe.test.ts` and `tests/camaim.test.ts` pass unedited. Only the new law's functions and the aim rule
     under `rules.aim.viewSight` read the eye.
  2. In CL an override is added only where the lint shows the default eye outside the sprite, each listed with its
     measurement. No other hand tuning and no exaggeration rules without the owner.
  3. The table has room to grow: named attack origins (`mouth` now; tail, horns, hands later) and postures beyond
     `stand`. In CL nothing reads the attack origins; the attack origin stays `rules.aim.muzzle`.
  4. The lint's output (per species: drawn top ÷ sim height, eye inside the sprite) and its script are committed.
  5. Follow-ups F86 and up: the lint becomes a gate no later than the task that builds hit bodies from the table; an
     automatic review flag for new species whose sprite contradicts the table; attack origins from the table;
     postures beyond `stand`; cover, concealment and detection from the table's dimensions.
  - *Direction (for the design, not CL work):* the long-term goal is one consistent in-game scale across Pokémon and
    world objects, so hit bodies, cover, concealment and visibility follow each species' shape and posture. Movement
    collision and navigation stay in class tiers (one navmesh per class, routes cleared for Large), as recorded.
  - *Second set of conditions (same day, with CL-Q3).* The mouth is stored and nothing reads it; whether the flagged
    rule launches from the mouth or from `rules.aim.muzzle` is CL-Q(e)'s. The table stores the anatomical eye,
    unclamped. The lint is report-only: per species the drawn-to-table ratio (top, and width where measured), the
    outliers, and exactly what it compares; no threshold until the owner sets an expected ratio. The class × shape
    defaults ship; every species override is listed in the report with its reason. Every deferred item (sim bodies from
    the table, partial cover, concealment, enemy detection, materials, generator scale) gets a ROADMAP row (F86 and up).
  - *Noted, not changed:* "routes cleared for Large" differs from Q7 as recorded (required routes ≥ 5.00 × 3.70 m
    admit every body, giants at the cap included). Q7 stands until the owner says otherwise.
- **CL-Q3, how the sight origin follows the body: accepted, with a vertical pull-back, and amended on the band.**
  - The eye is the table's point in the body frame: the feet + `eye.up`, + `eye.fwd` ahead. It rides the feet 1:1
    (a jump or high ground raises it; the render-only stair smoothing plays no part).
  - For the shot check, "ahead" is the crosshair ray's horizontal heading, as for the muzzle, not `P.facing`.
  - `eye.fwd` is capped at the footprint radius (Tiny 0.30 to Extra Large 0.88 m). A wall between the body's axis and
    the eye puts the eye back on the axis, as for the muzzle.
  - **Vertical pull-back:** the eye never sits inside or above a solid over the body. If the vertical segment from
    the feet up to the eye is blocked (a low overhang, a deck underside), the eye is pulled down to just below the
    blocker, so the shot check never starts inside a solid, on either engine (ties to CL-Q(h) and I1a's D6).
  - **Amended (the band):** the shot check under `rules.aim.viewSight` uses the table's **unclamped** anatomical
    eye. The band clamp (0.60–1.35 m) is a function for the presentation camera's view point only (I2b's rig), with
    its own test; the band's cap appears only in that test.
  - Measured for it (2026-11-25, `main` 25e20ed): all 48 Tiny species are 0.552–0.636 m tall, 12 of them under the
    0.60 m floor (Tynamo, a hero, 0.552 m), so a clamped view point sits above their own top; Small and up are
    ≥ 0.83 m. On the adapter maps (the 10 tile replay scenarios, the 6 habitat recipes × seeds 1–6) the lowest clear
    height over walkable ground under a deck is 2.40 m, so the vertical pull-back does not fire on today's maps; its
    tests need a built overhang.
  - Confirmed for it: decoration (flowers, reeds, lilies, the `tall` grass prop) has no `PROP_MATERIALS` entry, so
    neither engine gives it a collider and it never blocks the shot check (`src/world/sight.ts`, `src/world/adapter.ts`).
    A Tiny eye under 0.50 m loses nothing in the sim. Found with it: the `tall` grass decoration can hide a small body
    on screen while the sim sees it (a Q15c consistency gap for I4's `screen` kind).
  - Step 3's tests: each body against each cover rung (1.45, 2.00, 3.70 m) from its own eye; a giant sees over the
    rungs below its eye, a Small is blocked by all three. "A giant at the cap" is not a sight case.
  - *Confirmed (owner, 2026-11-25, after a conflicting first answer to CL-Q4 was withdrawn):* CL-Q3 stands. The shot
    check uses the unclamped anatomical eye (Q15c); the band is a presentation rule for the camera only.
- **CL-Q4, the eye sees more than a capped camera: the lens is at eye height, with no cap.** The camera's height
  follows the eye, so what the camera sees over is what the eye sees over. The 1.35 m cap stays only as a value in the
  clamp function's own test. *(A first answer that clamped the sim's sight origin to the band was withdrawn by the
  owner the same day, since it reversed Q15c and CL-Q3.)*
  - Numbers for the generator, on the draft eye fractions of sim height by shape (humanoid 0.90; upright, squiggle
    0.85; quadruped, wings, armor 0.80; bug-wings 0.75; legs, heads 0.70; ball, blob, arms, fish, tentacles 0.60;
    awaiting the owner): tallest eye 3.12 m (Celesteela), tallest hero eye 2.06 m (Hariyama). The `camera-clearance`
    ceiling at the neutral pose is the tallest eye + the 0.45 m deck clearance = 3.57 m, so the 3.70 m clear height
    holds every lens with 0.13 m spare. The short side and the tall-dressing keep-out need the camera distance
    (CL-Q(c)).
  - Under the adapter maps' 2.40 m decks, five species that fit have eye + 0.45 m above the underside (Snorlax 2.00,
    Hariyama 2.06, Melmetal 2.11, Rillaboom 2.00, Koraidon 1.99 m): the deck rule lowers their lens by up to 0.16 m.
    Under 2.90 m decks none are affected. Pull-in is CL-Q(d)'s.
- **CL-Q5, the camera floor for low eyes: floor = min(0.60, eye).** Lens height = eye height for every body; the
  band's 0.60 and 1.35 m stay rules values used only in the clamp function's test.
  - Measured for it (draft fractions): every Tiny eye (0.33–0.57 m, 48 species) and 8 of 42 Small eyes (0.52–0.59 m)
    lie under 0.60 m. On 46 adapter maps (the 10 tile replay scenarios, 6 habitat recipes × seeds 1–6), 8,970 collider
    tops (terrain step edges and wall-prop tops, distinct tiles per map) lie 0.33–0.60 m above adjacent walkable
    ground: 3,757 at 0.33–0.40, 4,154 at 0.40–0.50, 1,059 at 0.50–0.60. A 0.60 m floor would have let those cameras
    see over ledges their eye cannot.
  - Follow-ups: the low lens against the 0.30 m near plane (ROADMAP F96, I2b) and dressing in front of low eyes
    (F97, G1 and I2b).
  - *"Flowers fill a Tiny's view."* This phrase was CL's, in the option text, not Q15c's, and "as Q15c intends"
    overstated it. As built today it is **visual only**: dressing has no collider, so the sim eye sees and shoots
    through it. Q15c asks for more than that where vegetation conceals ("concealment rules apply consistently to
    targeting, enemy detection and gameplay information"): vegetation that hides is a `foliage` or `screen` kind
    with a sight block (Q15.4), not dressing. F95 and F97 carry the gap.
- **CL-Q6, the default eye fractions: accepted as provisional defaults, no class factor, 0 overrides.**
  - `eye.up` × sim height by official shape: humanoid 0.90; upright, squiggle 0.85; quadruped, wings, armor 0.80;
    bug-wings 0.75; legs, heads 0.70; ball, blob, arms, fish, tentacles 0.60; unknown 0.75. `eye.fwd` × footprint
    radius: quadruped 0.9; armor 0.8; squiggle, fish 0.6; wings, heads 0.5; bug-wings, legs 0.4; upright, humanoid,
    ball, blob, arms, tentacles 0.3; unknown 0.5. The size class enters only through the body it scales.
  - Eyes: Tiny 0.33–0.57, Small 0.52–0.86, Medium 0.68–1.15, Large 0.95–1.62, Extra Large 1.33–3.12 m. On 240
    species with art no eye lies above the drawn top (smallest margin 0.17 m, Roselia) or past the drawn side reach,
    so the Q2 rule adds no override.
  - Two additions to the report-only lint: (1) the eye against the drawn picture, (eye + drop) ÷ (top + drop) from
    the lowest drawn point, listing species under 0.6 (the eye visibly below the drawn head); (2) who sees over cover:
    per size class the species whose eye is above each rung (1.45, 2.00, 3.70 m), and the Large and Extra Large
    species within 0.10 m of a rung, where a wrong shape label flips the result.
  - Measured now (2026-11-25, `main` 25e20ed): the drawn fraction is 0.38–0.87, median 0.66; **80 of 240** species
    fall under 0.6, mostly ball, arms, blob, tentacles and fish shapes at the 0.60 default (Poltchageist 0.38, Rotom
    0.39), and heroes among them (Magnemite 0.46, Chandelure 0.49, Tynamo 0.49, Corviknight 0.54, Charmeleon 0.56).
    Eye above 1.45 m: 21 of 57 Large, 36 of 38 Extra Large; above 2.00 m: 23 Extra Large; above 3.70 m: none. No
    Tiny, Small or Medium eye is above any rung. 45 Large and Extra Large species lie within 0.10 m of a rung, 11 of
    them heroes (Venusaur 1.46, Charizard 1.49, Blastoise 1.46, Meganium 1.42, Typhlosion 1.40, Togekiss 1.35,
    Avalugg 1.46, Golem 1.49, Salamence 1.35 against 1.45; Feraligatr 1.94, Hariyama 2.06 against 2.00).
  - Follow-up (ROADMAP F98): the fractions are balance values under Q15c, checked with this report at the first 3D
    playtest; whether eyes follow the drawn height instead of the sim height is decided then, through reviewed
    override data, so the sim still never reads the art.
- **CL-Q7, camera peek (Q15f, reopened by Q15c): an information gate.** The camera keeps its composition (shoulder
  offset and orbit as today; shrinking them for feel is I2b's call, not a peek fix). The renderer draws a gated thing
  only when the player's eye sees it.
  - Scope: the gate hides enemy bodies and the signal kinds whose declared occlusion rule is "hidden by the world"
    (Q23 signal language). Signals marked "always visible" or "silhouette through cover", incoming telegraphs and
    attacks aimed at the player, teammates and the player's own partner are never gated.
  - The query is a deterministic pure function of the sim state (the shot check's sight test, from the eye), called
    by the renderer, not part of the sim tick or the replay hash. A target counts as seen when either sample (its top
    or its centre) is visible from the eye. Partial visibility stays F90.
  - Cost: CL measures it at 500 enemies (two rays each) and proposes a rate (staggered, in-view only) that keeps it
    inside the frame budget, in the CL report.
  - Measured for it (today's rig, `main` 25e20ed): the shoulder offset is 0.49–4.01 m (median 1.50); the arm sits 14°
    over the pivot at the neutral pitch and up to 40° looking down, so for a 4.3 m arm the lens rises 1.0 m and 2.8 m
    above the eye.
  - *Correction (CL, same day):* the question's text said both that the lens is at eye height at the neutral pose and
    that the orbit raises it 1.0 m above the eye there; the second is today's rig (a pivot under the eye, the arm 14°
    over it). Under CL-Q4 the lens is at eye height at the neutral pitch, and looking down orbits it up from there,
    by D × (sin 40° − sin 14°) at 40° down.
- **CL-Q8, the camera distance law (the 3D rig; the old renderer's framing stays as is): D = 3.5 × the anatomy
  table's height, inside 1.8–9.0 m.** k, min and max are provisional rules values in the single framing source (Q7c).
  The camera law is presentation: it never changes physical scale, line of sight, concealment, targeting or combat.
  The one exception is the map generator, which sizes spaces from it (camera clearance and the tall-dressing keep-out).
  - k 3.5 is today's median arm ÷ sim height (3.48 over 240 species, p10–p90 3.05–4.39, steady across classes:
    Tiny 3.42, Small 3.49, Medium 3.54, Large 3.34, Extra Large 3.50), without reading art.
  - The max was 14 as first answered; the owner chose 9.0 after the generator consequences (below). It binds only
    above 2.57 m tall, which is no hero (the tallest, Hariyama, 2.29 m, D 8.02 m). Giants above 2.57 m frame at
    9.0 m and rely on pull-in and fade (I2b). If a body taller than 2.57 m becomes a hero, its framing is judged at a
    playtest, and raising the max is a planned layout change, not a tuning tweak (ROADMAP F99).
  - **Generator numbers** (camera clearance sized for the Extra Large class, Q7): the `camera-clearance` ceiling is
    the tallest eye + 0.45 m deck clearance (3.66 m for a giant at the cap with the largest fraction, 3.57 m for the
    tallest real eye, Celesteela's 3.12 m), inside the 3.70 m clear height; the short side is D max + footprint
    radius 0.88 + lens clearance 0.30 = **10.18 m**; the tall-dressing keep-out grows reachable space by
    D max + 0.30 = **9.30 m** (Q17.5). This replaces the void 8.00 m short side and the Q7(b) camera table.
  - Measured for it (16 adapter maps: the 10 tile replay scenarios and the 6 habitat recipes at seed 1; every third
    walkable tile, 4 headings, neutral pose, the arm straight back from the axis at eye height with no shoulder
    offset, props never stopping the lens; footprint fit ignored, so giants are overcounted). Share of samples where
    the arm comes within 0.30 m of ground, a deck underside or a bare wall, k 3.5 / k 2.5: giant at the cap (D 12.49 /
    8.92 m before the max) 26.6 % / 19.8 %; Hariyama (8.02 / 5.72) 19.3 % / 13.7 %; a Medium upright (4.20 / 3.00)
    10.7 % / 8.5 %; Tynamo (1.93 / 1.80) 8.7 % / 8.7 %, set by the floor clearance, not by D (F96). The lens at 40°
    down for the giant: 8.22 m (k 3.5, D 12.49), 6.79 m (k 2.5).
- **CL-Q9, the room the generator leaves for pull-in and fade: nothing more.** Beyond the `camera-clearance` spaces
  (CL-Q8) and the transit rule (Q7a: ≥ 5.00 m wide, ≥ 3.70 m clear, which covers every lens vertically), the camera
  pulls in and the body fades. Both are I2b's; today's thresholds (fade under about 0.95 m, 75 % by 0.45 m, the
  0.30 m near plane) are starting values. The generator's only camera inputs are the framing source's clearance and
  keep-out numbers.
  - Measured for it (the CL-Q8 method, k 3.5, max 9.0): the free arm is under 0.95 m in 3.7 % of samples for a giant
    at the cap, 3.4 % for Hariyama, 3.7 % for a Medium upright, 5.5 % for Tynamo; under 0.45 m in 1.7–2.0 %. Most are
    bodies backed against a wall or a rise. A Large with the tallest eye (1.62 m) under an optional 2.00 m ceiling has
    its lens lowered 0.07 m by the 0.45 m deck clearance.
  - I2b reports the fade rate on G2's map, split into moving along required routes and stationary. If fading while
    moving on required routes exceeds the adapter maps' 5.5 %, the rule of a free arm ≥ 2.0 m both ways along the
    route axis on required routes is reopened for G2 (ROADMAP F99).
- **CL-Q10, where the flagged shot launches (question e, to which CL-Q2 condition 3 deferred): from the eye, under
  `rules.aim.viewSight` only.** Flag off, the muzzle launch is as today and every hash is unchanged.
  - The launch point is the same eye point as the check, after CL-Q3's horizontal and vertical pull-backs, so a shot
    never starts inside a solid. Tested on both engines with the 1.45 m rung and two of the species whose eye clears
    it while the muzzle does not (one a hero, Feraligatr).
  - Measured for it (draft eyes, `rules.aim.muzzle` 0.6 × height): eye − muzzle is 0.00–1.04 m, median 0.23 (equal
    for the 59 species of the 0.60-fraction shapes). Eye over 1.45 m with the muzzle under it: 31 species, 9 heroes
    (Venusaur, Charizard, Blastoise, Feraligatr, Hariyama, Mewtwo, Avalugg, Corviknight, Golem); over 2.00 m: 21
    species (Hariyama); over 3.70 m: none.
  - Paths the flag changes, all through `resolveSpatial` (`src/sim/aim.ts`): the spatial direct shots (bolt, orb:
    `moves.ts` spawns the `traj` 1 projectile at the aim's origin), the spatial beams (`beam3D` casts from it), and,
    following them, the cast event's `o` and the HUD's `ctx.aim` (presentation). Paths left on the muzzle or on their
    own origin: `assistSees` (device assistance's sight test on the planar path, from the muzzle height), every planar
    cast (`traj` 0: the bot, the fixed views, lob, orbit, boomerang, and every archetype not in `rules.aim.archetypes`),
    melee, and `scripts/covercheck.ts` (class muzzle figures).
  - Where the attack is drawn from (mouth or body) is presentation, I2b's. F88 stays open: whether a table mouth ever
    becomes the gameplay origin is decided there.
- **CL-Q11, the check's target end and a blocked shot (question f): the check ends at T, and a blocked shot fires
  and is reported.** T is the aim point (the first thing the crosshair ray meets). Under the flag the check is the
  shot's own volume swept from the eye point to T (`aim.ts` step 4). A blocked shot fires and meets the blocker (cover
  takes the hit, breakables included), and the HUD shows it blocked, as today. No aim bending and no refused-cast
  outcome.
  - Under the flag the HUD's blocked indicator uses the identical check as the shot. A test holds that the indicator
    and the shot never disagree, on both engines.
  - Known edge case: the CL-Q7 gate samples with thin rays and the shot sweeps a volume, so near a cover edge an enemy
    can be drawn while the shot is blocked; the red crosshair covers it. Partial visibility stays F90.
- **CL-Q12, the bot, the fixed views and the replay crosshair (question g): the aimbot follows the law when
  flagged.** The bot and the fixed views send no crosshair ray and stay on the planar path, which the flag does not
  touch, in CL. When the bot moves onto the spatial path (Stage 7A) it takes the eye check and the eye launch; the
  fixed views retire at X1a (ROADMAP X1a row).
  - `scripts/lib/aimbot.ts` with `rules.aim.viewSight` on: the lens is at eye height, D from the framing source, and
    the shoulder stays 1.25 m (a test value only; I2b sets the real shoulder); its target pick uses sight from the eye.
    Flag off it is unchanged byte for byte, so every hash is as recorded, range-charmander's own rays included.
  - Measured for it: today's aimbot lens (4.5 m back, 1.7 m up) is 0.15–1.19 m above the draft eye of 9 of the 12
    scenario species (Caterpie +1.19, Charmander +0.89, Tauros +0.37, Mewtwo +0.15) and below it for Onix (−0.66) and
    Wailord (−0.24).
  - The `-viewsight` scenario includes a body whose shots change under the flag (an eye well above the muzzle, or a
    giant). The CL report says whether its hashes differ from the unflagged twin's, beside the test that the flagged
    path ran.
- **CL-Q13, where the crosshair trace starts and I1a's D6 (question h): at the eye's plane, with the skip; D6 is
  accepted for the aim point only.** Flag off, unchanged (the chest plane, the muzzle's height).
  - Under the flag the camera trace starts where the ray passes the eye's plane and keeps `QF.skipInitialWorld`, so
    on Rapier a start inside a merged box skips the box and on tiles only its tile (D6). That moves only the aim
    point T. The shot's own sweep starts at the eye point (after CL-Q3's pull-backs) with no skip, on both engines, so
    no shot passes a solid. Tested on Rapier: a trace starting inside a merged box puts T beyond the rock; the shot is
    blocked by the rock and the HUD shows it blocked (CL-Q11).
  - Measured for it (the 12 replay tracks, today's aimbot, `main` 25e20ed): the trace start lies inside a solid on
    0–28 of 3,600 ticks on most tracks, 184 in Crater, 209 in range-swap and 1,360 (38 %) in Grotto, where the
    aimbot's lens, which has no wall clearance, puts the ray inside the cave rock; at the eye's plane the counts are
    the same except Gorge (6 → 2, on both engines).
  - The CL report gives the counts for the flagged aimbot (lens at eye height, CL-Q8's distance). If they stay high
    (Grotto), the aimbot gets a simple lens pull-in (a ray back from the eye, stopping short of the first hit), in the
    test harness only.
  - ROADMAP F59 is narrowed to an aim-point difference, re-measured on the mesh world at G1.

### Q16 Material roles (owner, 2026-11-23: accepted with amendments a–d)

Checked today: a collider's `material` is one string holding two vocabularies, a `MaterialId` for props (`stone`,
`wood`, `leaf`) or a terrain name for ground. Render chunks carry only `'terrain'` or `'liquid'`, with colour baked
per vertex into the model. `src/rules/surfaces.ts` already states the principle: the generator writes material
references, never behaviour (six materials × four agents).

1. **A role is a closed union in `src/rules/`.** Kit pieces and archetypes declare a role per face group (top, side,
   trim, underside). The generator emits roles and nothing else about material.
2. **Role list v1 (15).** Natural: `ground`, `path`, `soil`, `rock`, `cliff`, `bed`. Built: `floor`, `wall`, `roof`,
   `trim`. Props: `cover`, `foliage`, `trunk`. Marked: `objective`, `hazard`. A liquid surface takes its id from the
   liquids registry (Q9.4), not a role.
3. **Two bindings, kept apart.**
   - **Physical:** role → `MaterialId`, in the recipe's biome binding. Gameplay data, hashed. The same `ground` is
     `grass` in a meadow and `stone` in a cave.
   - **Visual:** role → style material, in the world style. Render data, never hashed.
   - *(a)* A recipe may also carry the optional `look` section (Q14.3 as reworded): visual overrides only.
4. **Model changes.** A collider gets `role` plus the resolved `material: MaterialId`, so the sim never needs the
   recipe. Render chunks split by role. Baked colours leave the model; render resolves colour from the style, so
   day/night and event overlays cannot change the model.
   - *(Extended by Q23.)* **A render chunk carries welded positions, indices, a role and the optional blend of
     point 5. No normals and no colour.** The renderer computes the normals, across chunk borders, and splits them
     by the profile's crease angle (Q18.1).
5. **Terrain blends are visual only.** A terrain vertex may carry two roles and one weight for a soft edge (path
   into ground). Physics and sim read the triangle's dominant role, so footing is never ambiguous.
6. **A new physical material `soil`** with the property `burrowable`. The navmesh area flag (Q10.9) derives from the
   property, not from a role name. Other properties stay in `MATERIALS` (burn, reactions, type).
   - *(c)* Burrowing keys off the property, so other materials (sand, snow) can become burrowable by a data change
     alone. Intended.
7. **Affordance groups must read apart in every style:** walkable (`ground`, `path`, `floor`), blocking (`cliff`,
   `wall`), `soil`, `hazard`, `objective`, and each liquid.
   - *(b)* The readability check also covers climbable surfaces, stateful features per state and tier (cracks,
     steam, frost: Q10f), concealment screens (tall grass) and the optional spawn-barrier hint. These cues come from
     capability and feature data, not from new roles. The lint checks that they read apart in every style and across
     the day/night cycle. *(Q23.2: inside the map's time range.)*
8. **Surface states** (wet, burning, frozen, ash) are runtime sim state keyed by `MaterialId`, not by role (the
   hazards question).
9. **A change to the role union bumps the model version; a new `MaterialId` bumps the generator version.**
   - *(d)* An event overlay that changes a physical material or its properties (for example slippery or burrowable
     snow) sets `gameplayVariant: true` and gets full validation. A visual-only overlay never touches the physical
     binding.

### Q17 Placement tiers (owner, 2026-11-23: accepted with amendments a–c)

1. **Three tiers.**

   | | Structure | Gameplay | Dressing |
   |---|---|---|---|
   | What | spaces, kit pieces | archetypes of kind `solid`, `foliage`, `grate`, `screen`; features; item candidates; soil patches; landmarks | kind `dressing` only |
   | Stage | `build` | `build`, after structure | `dress`, after `freeze` |
   | RNG stream | `build` | `cover` | `dress` |
   | Colliders | yes | from proxies | never |
   | In the IR, validated, repairable | yes | yes | no |
   | Symmetric | yes | yes | may differ per side |
   | In `gameplayHash` | yes | yes | no |

   - *(b)* **Landmarks are gameplay tier with a symmetric proxy.** Their visual mesh may differ per side within the
     Q15 envelope, which is how the sides read differently.
2. **Promotion rule.** Anything that must block, hide or be stood on is gameplay tier by definition. A dressing
   archetype that outgrows 0.50 m is re-declared as a gameplay kind or fails the lint.
3. **Gameplay tier placement.**
   - Only inside spaces tagged `cover-zone`, never inside a required route's clear width.
   - Positions on the lattice; patterns from the registry (`scatter`, `lattice`, `edge`, `cluster`).
   - Density from the `cover` knob level.
   - Every gap a placement leaves is sealed or a clean Q7 rung; nothing lies within 0.10 m of a width threshold
     (Q6).
4. **Dressing output is plain data outside the model.** `dress` in `src/world` (no three) returns an instance list
   (archetype id, transform) as a separate `Dressing` record beside the WorldModel. `src/render` builds geometry from
   it. It cannot reach `gameplayHash` by construction.
5. **Dressing keep-outs.**
   - Height ≤ 0.50 m anywhere a body can be (Q15.9), the flight envelope included.
   - Taller dressing only outside reachable space grown by the camera distance, so a camera backed against a ledge
     or a rail never clips it. This uses the camera task's distance number.
   - Zero density on: the objective disc, `hazard` marks, link landings, portal thresholds, feature cue zones, item
     candidates.
   - Never spans a doorway, a gap or a shoreline.
   - *(c)* Dressing never uses an affordance cue reserved for breakable, burrowable, climbable or concealment
     surfaces (Q16b). The lint checks dressing against those cue sets.
6. **Per-side dressing may differ; its density may not.** The readability lint compares the sides (Q11.8).
   - *(a)* Light-emitting dressing (lamps, torches, glowing plants, fires) counts in per-side fairness. The lint
     compares the sides at night samples of the day/night cycle, including lighting levels on the approaches.
     *(With Q23.2: "night samples" means the darkest sampled times inside the map's range.)*
7. **Tests.** Changing the `dress` stream or dressing code changes no `gameplayHash`. No `Dressing` instance has a
   collider or sits in a keep-out. Gameplay tier placement is identical under the half-turn.
8. *(Q23)* **`Dressing` gains two lists.**
   - **A backdrop list:** instances beyond the map's bounds, with no proxies, no shadow casting and a budget of
     their own (Q20). The map edge stays a real boundary.
   - **Atmosphere emitters:** kinds `halo`, `mist`, `steam` and `shaft`, from the emitter-kind registry (Q14.1).
     A dressing `steam` emitter must read apart from a stateful feature's steam cue (point 5c; owner, 2026-11-24).
   - Both are presentation, written by `dress`, and outside `gameplayHash` like the rest of `Dressing`.

### Q18 World styles and the shading model (owner, 2026-11-23: accepted with amendments a–c; (a) extended 2026-11-24; amended by Q23, 2026-11-24)

Today the look is spread over four tables: `BIOMES` colours (`src/rules/stages.ts`), `BIOME_ART` and `TERRAIN_STYLE`
(`src/render/tileart.ts`), `ART_DIRECTION` (`src/render/artdirection.ts`) and `SKY` (`src/render/sky.ts`).
`src/render/metrics.ts` already measures actor readability: camouflaged means ΔL* < 12 and ΔE < 20.

1. **Four layers, one resolver.** All are typed data in `src/rules/styles/`, with no three.
   - **Style profile:** the game's look and its constraints.
   - **Biome binding:** one record per biome, replacing the four tables: role → material parameters, sky, fog, light
     rig, particles, day/night keyframes.
   - **Map `look`:** optional, in the recipe (Q16a).
   - **Theme overlay:** events (Q14g).
   - `resolve(profile, biome, look?, overlay?) → ResolvedStyle` is pure. Order: profile defaults ← biome ← look ←
     overlay, then **clamped by the profile's constraints**. The profile is both the base and the final guard. Clamps
     go in a resolution log.
   - *(a)* **Profiles are data.** Several dev-only profiles may exist for experimentation (like the Q14(a) experiment
     layer); one ships.
     - *(Q23.1)* The second dev-only profile is `lowpoly`, beside `storybook`. Which of the two ships is open.
   - *(Q23)* **A profile gains two blocks.** `shape`: crease angle, chamfer width, irregularity, minimum thickness
     (the default for dressing and backdrop archetypes, with an override per archetype class: Q23.7) and stroke
     density. `paint`: facet tone, vertical gradient, edge light and strata. A profile also holds its pass list
     (point 4).
2. **One shading model: storybook.** One TSL node material family for every opaque world surface in all three
   tiers. Banded diffuse from one sun plus ambient; tinted shadows, never black; a role-driven pattern in world
   space; ink edges from the depth-and-normal pass S2 measured. Per-role parameters only: base colour, band
   thresholds, shadow tint, pattern id and strength, ink weight, emissive. No per-biome shader.
   - *(a)* Reducing the blueprint's three style families and shading models to one is recorded as a **deliberate
     change from the blueprint**. A second shading model can be added later behind the same role interface, with a
     version bump.
   - *(Superseded in part by Q23.)* **One world material family whose parameters span both looks**, `storybook` and
     `lowpoly`, in place of a model named for one look. The diffuse ramp runs from continuous to banded. The normal
     mode is set per role. The profile's paint terms apply (point 1). Pattern and ink go down to zero. The banded
     diffuse, the pattern and the ink edges above are now parameter settings, not fixed features. It is still one
     shading model, not a second one.
3. **Allowed material kinds, a closed list:** `storybook`; `liquid` (the same bands plus transparency and flow);
   `sky`; plus S2's actor billboard and effects materials. A biome is data, never a shader.
   - *(a, extended 2026-11-24)* The list is closed for shipped builds. The dev-only experiment mode of point 4 may
     register alternative material kinds beside it.
   - *(Q23)* The kind listed as `storybook` is the world material family of point 2, which serves both profiles.
     **No authored image textures** for world surfaces or atmospheric effects (Q23.6, as amended 2026-11-24).
     Code-made textures, generated once and shared, are allowed where sampling is cheaper than repeated maths.
     Pokémon sprite art is exempt.
4. **One `RenderPipeline` with a fixed pass list:** the scene with MRT normals → ink → `renderOutput`. Styles and
   overlays set pass parameters; they never add a pass.
   - *(a)* **Dev-only experiment mode:** shading models and post-processing passes are swappable and toggleable
     there (alternative material kinds, extra passes such as bloom), so looks can be compared freely. A shipped
     build uses one locked profile, one shading model and the fixed pass list, and must pass the performance budget
     and every lint.
   - *(Superseded by Q23.)* **The pass list is per profile, from a closed registry of post passes** (Q14.1), in
     place of one fixed list.
     - Ink and bloom are optional passes. A pass at zero weight is not built. The normals target exists only when a
       pass in the list needs it.
     - A shipped build runs one locked list.
     - Glow never depends on bloom (Q23.5).
     - Still standing: one `RenderPipeline` that ends in `renderOutput`. Biome bindings, `look` and overlays set
       pass parameters and never add a pass.
5. **Reserved hero band.** The profile reserves a lightness and chroma region for actors and signals; no world role,
   dressing or overlay may resolve inside it. The art bible's signal hues (hostile red and orange, own white and
   cyan) stay reserved the same way. The band limits are profile numbers calibrated by the lint, not set here.
   - *(Superseded by Q23.4.)* **The signal language is reserved, not a colour region.** Environment colours are
     unrestricted. Team colours are a player setting whose defaults are the hues above. The hero band is measured
     and reported in dev profiles, not enforced.
6. **Readability lint per roster**, extending `render/metrics.ts`, render-side, offline in CI.
   - Every sprite of the map's roster and wild pool (Q14e) against every resolved role it can stand before. It fails
     on camouflage by today's thresholds.
   - Affordance groups and cue sets read apart (Q16.7, Q16b).
   - Side A against side B (Q11.8, Q17a).
   - All of it at sampled times across the day/night cycle. *(Q23.2: inside the map's time range.)*
   - *(c)* **The fix for a camouflaged actor is rim light or outline, at any time of day**, not only at night. Canon
     sprite colours are never altered.
   - *(Q23.3, Q23.4)* Two checks are added beside it: the resolved top tone against the side tone, and the
     signal-language requirements in greyscale and under simulated colour-vision deficiencies.
7. **The light rig is data.** Sun path, colours, ambient and the fog curve are keyframes per biome. The shadow setup
   stays S2's (one directional light, a 2048² map).
   - *(Extended by Q23; clarified by the owner, 2026-11-24.)* **Ambient is two sets of six colours per keyframe**
     (open sky and enclosed; one colour per axis direction, +x, −x, +y, −y, +z, −z; twelve in all), blended by
     a per-vertex sky visibility. **Grading** (lift, gamma, gain, saturation) is a keyframe value, applied in the
     output step. Which part of the keyframes a map plays is its own time range (Q23.2).
8. **Sun path.** The starting choice is a path plane perpendicular to the team axis, symmetric about noon, so
   neither team ever faces into or away from the sun.
   - *(b)* **Day/night fairness is per instant, not integrated over the cycle:** a match may not span a full cycle.
     The lint bounds the side A against side B difference (glare, shadow coverage on the approaches, light levels) at
     every sampled time. If `half-turn` fails that bound, the recipe uses `mirror` (under which the perpendicular
     path is equal at every instant), or the cycle phase is set so each match covers side-balanced times.
     - *(Q23.2)* The sampled times are those inside the map's range. Setting that range is how "the cycle phase is
       set" here.
9. **Local lights are data; the technique is chosen at I2.** Emitters (colour, radius, intensity) are instances in
   `Dressing`. The lint computes light levels analytically from the emitter data, so it does not depend on the
   render technique. Whether they render as baked vertex light or as real lights is measured at I2; S2 measured
   neither.
   - *(Superseded by Q23: the technique is decided.)* **Local light is baked per vertex at load into a lamp
     channel**, scaled by a time-of-day curve and confined to the emitter's space and its portals. Actors take a
     per-instance tint. Real-time local lights are not the baseline. Emitters stay data in `Dressing`, and the lint
     still computes light levels from that data.
10. **The old tables** are deleted with the tile stack at X1b.

### Q19 Determinism, versions, hashes and replay links (owner, 2026-11-24: accepted with amendments a–c; amendment (d) added 2026-11-24)

Checked on main 583dcea. `src/core/detmath.ts` exports `dsin`, `dcos`, `datan2`, `dhypot`, `dexp`, `dlog` and `dpow`.
`src/core/rng.ts` has `Rng` and named streams (`streamSeed(seed, name)`); its `fnv1a` is 32-bit. `WorldMeta.version`
is the generator version, and no model contract version exists. `mapChecksum` (`src/world/maps.ts`) is a 32-bit FNV
over the tile arrays, used for the co-op handshake. Replay fixtures (`tests/fixtures/replays.json`) hold sim
checkpoints and an end hash, and nothing about the map.

1. **Maths.** Generator stages use only operations that IEEE 754 defines exactly (+ − × ÷, `Math.sqrt`, floor,
   round, abs, min, max, `Math.fround`, `Math.imul`) and `core/detmath`. Heights stay integer lattice units until
   `emit` (Q6a). No clock and no `Math.random`.
   - *(a)* **No locale- or `Intl`-dependent operation** in generation: no `localeCompare`, no `toLocaleString`, no
     `Intl.*`. Sorts use total-order comparators on ids. Nothing relies on object-key order or on any
     engine-dependent iteration order.
2. **One named stream per stage:** `plan`, `embed`, `build`, `cover`, `features`, `species`, `dress`, each from
   `streamSeed`. A stage receives only its own stream. A ladder retry mixes the attempt index into the seed. Repairs
   and validation sampling draw nothing (Q12.7, Q13.7).
3. **Two hand-bumped versions and one computed hash.**
   - `WORLD_VERSION`: bumped when stage code, the vocabulary, the kit or a proxy changes any accepted map. It
     replaces `HAB_VERSION` and `LOC_VERSION` at X1b.
   - `MODEL_VERSION`: a new constant in `src/world/model.ts`, bumped when the contract changes (its shape, the tag
     union, the role union, the volume kinds).
   - `requirementsHash`: the hash of what `compile` returns (Q14.5). That record already holds every generation
     parameter, every threshold and the species capability set, so tunables need no hand-kept version number, and
     only a tunable that reaches generation or validation moves the hash.
     - *(d)* It is a **validation stamp**, stored beside `gameplayHash` in the curated record. It is not part of a
       map's identity.
4. **`gameplayHash`** is the hash of `MODEL_VERSION`, `WORLD_VERSION`, `requirementsHash` and the canonical bytes of
   the gameplay model: colliders, volumes, `navInput` with the volume-routing graph, markers, spaces, portals, and
   features in every state.
   - *(Superseded by (d), 2026-11-24.)* **`gameplayHash` covers `MODEL_VERSION`, `WORLD_VERSION` and the canonical
     bytes of the gameplay model only.** `requirementsHash` leaves it.
   - Excluded: render chunks, `Dressing`, `look`, lighting and display names.
   - Canonical form: arrays sorted by id; floats as 32-bit patterns, little-endian; −0 written as +0. `emit` rejects
     a non-finite value.
   - 64 bits, in pure integer code in `src/core`. A 32-bit hash is too short to identify a map.
5. **Replay link.** A replay records the recipe id, the requested seed, both versions and the played map's
   `gameplayHash`. Loading it regenerates the map and compares. A mismatch refuses the replay with a message; it
   never plays a diverged map silently. Scenario fixtures gain the map hash as checkpoint 0, so a map change and a
   sim change read apart.
6. **The stop rule extends to maps.** A curated seed's `gameplayHash` that moves unexpectedly is a stop, not
   something to re-record (CLAUDE.md, "Working with the owner").
   - *(b)* **Version discipline is enforced by CI.** A commit that changes any curated golden `gameplayHash` must
     also bump `WORLD_VERSION` or `MODEL_VERSION`, or change `requirementsHash` through the tunables, and must say
     why in its commit message. Otherwise CI fails.
     - *(Adjusted by (d), 2026-11-24.)* The rule keeps its form: a moved golden `gameplayHash` needs a version bump
       or a changed `requirementsHash` stamp in the same commit (a tunable that changed the map), and the reason. A
       changed stamp with an unchanged `gameplayHash` is not a map change: CI re-validates the curated seeds
       against the new requirements, and the commit records the new stamp.
7. **Tests at G1.**
   - The same inputs twice give the same hash; a golden hash per curated seed.
   - Stream isolation: extra draws in `dress` leave `gameplayHash` unchanged.
   - Poisoned maths: generation runs with `Math.sin`, `Math.cos`, `Math.pow`, `Math.random` and the clock replaced
     by throwing stubs. *(a)* It also stubs `localeCompare` and `Intl`. This is stronger than a source grep.
   - Cross-engine, run by hand like `tests/browser/range.py`: Node against headless Chromium, the same hashes.
8. **Stored GameplayBundle (the Q13(c) flag): option C.** *(c)* The game regenerates every map now. A stored bundle
   per curated seed is deferred; the trigger to revisit it is the first measured cross-engine hash mismatch, or
   ranked play being scheduled. **"No shipped map files" stands until then.** The model is plain serialisable data,
   so a bundle is one serialise call added later; nothing in this design blocks it. Until then drift is caught by
   the run-start hash compare, and a mismatch plays unranked (Q13.9).

**(d) `requirementsHash` is a validation stamp, not identity (owner, 2026-11-24).**

- `gameplayHash` covers `MODEL_VERSION`, `WORLD_VERSION` and the canonical bytes of the gameplay model only.
- `requirementsHash` leaves it and is stored beside it in the curated record, as a validation stamp.
- A changed stamp makes CI re-validate the curated seeds. It does not change a map's identity, refuse a replay, or
  move a scenario's checkpoint 0.
- Adjusted to match: Q9.10, Q14(e), and points 3, 4 and 6(b) above. The replay link of point 5 never carried
  `requirementsHash` and stands as written.

**Notes for G1.**
- The commit-message half of (b) needs a rule CI can check: for example, a line `gameplayHash: <reason>` in the
  message of any commit whose diff touches the golden-hash fixture. The exact form is G1's.
- `mapChecksum` and the tile checksums in `docs/habaudit/baseline.json` go with the tile stack at X1b; `gameplayHash`
  takes over the handshake role.

### Q20 Budgets (owner, 2026-11-24: accepted with amendments a–d)

Measured today, all on an Apple M3 Max. River Gorge seed 1 through the tile adapter: 2,938 box colliders, 45,506
render triangles in 8 chunks, about 1.7 MB of Rapier memory (S1 §2, §6; S2 "The numbers"). S1 measured Rapier up to
43,420 trimesh triangles (20 ms to build with FIX_INTERNAL_EDGES). The tile generator takes p95 383 ms for River
Gorge and p95 1,437 ms for Volcanic Ridge with its retries (`docs/habaudit/baseline.json`). S2's stress scene drew
857,180 triangles in 2–3.4 ms of GPU time. No lower-end machine has been measured (ROADMAP F39), and a Recast build
has never been measured.

1. **Counts are hard gates at `emit`** (class C, never repaired; Q12, Q13.5). Time and memory are CI measurements on
   the reference machine, never a runtime cut-off (Q13.1). The numbers are starting tunables in `src/rules`.

   | Budget | Starting number | Basis |
   |---|---|---|
   | Plan bounds | ≤ 128 × 128 m | today's habitat size; see (a) |
   | Vertical span | ≤ 32 m, from the lowest floor to the top of the flight cap | derived: arrivals within ±8 m, the 8 m cap, the under-routes |
   | Terrain grid cell | 1.0 m | today's tile; at most 32,768 triangles if the whole plan were terrain |
   | Colliders | ≤ 3,000 | River Gorge today |
   | Collision trimesh triangles | ≤ 80,000 in total, ≤ 20,000 per cave | S1 measured to 43k |
   | Off-mesh links | ≤ 256 | a guess |
   | Render triangles, structure and gameplay tiers | ≤ 150,000 | drawn up to three times a frame (main, shadow, normals); the normals target only where a pass needs it (Q23) |
   | Dressing | ≤ 6,000 instances, ≤ 48 archetypes, ≤ 250,000 triangles | S2's stress scene ran 5,000 instanced props |
   | Backdrop (Q23) | set by profiling at I2a and F39 | its own budget, outside the dressing caps (Q17.8) |
   | Particle cards (Q23) | set by profiling at I2a and F39 | overdraw: glow sprites and atmosphere emitters, all code-made (Q23.6) |
   | Strokes (Q23) | set by profiling at I2a and F39 | the stroke geometry of painted accents (Q23.6) |
   | Stateful features | ≤ 4 per map | see (d) |
   | Environment states | ≤ 3 per map | with the feature cap: at most 18 validation states per attempt (Q10) |
   | WorldModel bytes | ≤ 16 MB | about 6 MB at the caps above |
   | Rapier memory per map | ≤ 8 MB, one world alive, freed on a map change | S1 O7 |

   - **80,000 collision triangles, not the research report's 150,000** (owner confirmed). Terrain collision is the
     terrain render mesh (one source, Q3), and nothing above 43k has been measured. G1 may raise it with data. This
     settles Q3(c).
     - *(Owner's review, 2026-11-24.)* The cap is not accepted until G1 has measured controller cost on the
       generated terrain at its real triangle count (Q3, "Open items"). S1's only terrain-resolution trimesh cost
       145.9 µs per body-tick, level with the heightfield.
   - *(a)* **Plan bounds are a starting tunable.** G2 reports the five-route embed success rate against plan bounds
     and staging distance (Q11), and the bounds are raised if the template often fails to fit. Research report 1
     assumed arenas of 150–300 m.
   - *(d)* **The feature cap of 4 is a starting value.** The owner expects to raise it, for more destruction and
     construction, when the timing allows.
2. **Generation time targets**, in Node on the reference machine, reported per recipe in the baseline JSON (Q12.10).
   CI fails above 1.5 × the recorded p95.
   - A curated seed at run start: p95 ≤ 250 ms.
   - A free seed: first attempt with the class A–C gates p95 ≤ 400 ms; the full ladder p95 ≤ 1,500 ms.
   - The Rapier build: ≤ 50 ms. The Recast build has no number until the nav task measures it.
   - *(b)* **Validation cost is unmeasured:** navmesh builds × environment and feature states × size groups. The
     navmesh is **tiled, and only the tiles a feature or a state touches are rebuilt**. The free-seed targets and the
     feature and state caps are revisited when the nav task measures Recast.
3. **A curated seed passes on its first built attempt with zero repairs.** Q12.3 has a curated seed regenerate at run
   start with no gates, and a repair cannot be rediscovered without the gates. The offline seed search rejects every
   other seed. No patch list is stored, so nothing here is a map file.
4. **The sim gate is unchanged:** `perf-sim` p95 2 ms and p99 3 ms with physics inside, run on the generated map at
   G2.
5. **The render numbers are provisional** until F39 names the lower-end machine; the table is recalibrated once, at
   I2a. Dev-only experiment profiles (Q18a) are exempt; the shipped profile is not.
   - *(c)* **Local light emitters get budgets:** a count per map, and an overlap count per screen region. Both are
     checked at the night samples of the day/night cycle, on the WebGL 2 backend as the baseline. Starting numbers
     (owner confirmed, 2026-11-24): ≤ 64 emitters per map and ≤ 4 overlapping in any screen region. They are
     recalibrated with the technique choice at I2 (Q18.9).
     - *(Q23)* The technique is now decided: a baked lamp channel (Q18.9). The count still bounds the bake. I2a
       restates what the overlap number bounds under baking (owner, 2026-11-24). "Night samples" reads as the
       darkest sampled times inside the map's range (Q23.2).
   - *(Q23.5)* **Bloom's budget and default quality come from the same profiling** on low-end hardware (F39).
   - *(c)* **An event overlay shares the dressing caps.** Its instances, archetypes, triangles and emitters count
     inside the same numbers; it gets no allowance of its own.
6. **Page budget.** The generator, the recipes and the styles live in `dist/index.html`; the 3 MB limit stands.

### Q21 Hazards, surface states and destructibles in 3D (owner, 2026-11-24: accepted with amendments a–b)

This is the generator's side, and the input to I4. Checked on main 583dcea. Surface states sit on the 1 m tile grid
(`src/sim/cells.ts`: wet, burning, frozen, ash, rubble, bramble). A burnt tree leaves a 0.65 m stump platform, which
is inside the Q6 step dead band. The cover-loss cap is 40 %, and a reachability watchdog reverts stumps
(docs/SYSTEMIC.md). Vents and the tide are pure functions of the sim tick. Any water freezes into walkable ice for
12 s. docs/HAZARDS.md lists two gaps that matter here: bridge sides are open, and the Viridian Forest gully is drawn
with a floor but is a void.

**Hazards.**

1. **Three kinds, all existing volume kinds:** `liquid` (Q9), `hazard` (a timed source: an element, a schedule id
   and an exposure box) and `kill`. A schedule stays a pure function of the sim tick and has a warning phase.
2. **A timed hazard is not an environment state.** Instead, every required route keeps a hazard-free lane of the
   baseline width (5.00 m) in every phase. No hazard volume lies in a spawn, a staging area, or the objective disc
   and its shoulder. The validation count (Q20) does not change.
3. **No pits.** Any point a body can fall to or be knocked to is in a space with a return route for that body
   (class A), or inside a `kill` volume with a visible cue.
4. **Lethal edges** (a drop into a `kill` volume or a lethal liquid) are allowed, declared by the recipe, and
   symmetric. On a required route a lethal edge carries a rail by default: a `grate` archetype at least 0.80 m high,
   which stops walkers and lets shots and sight pass.
   - *(a)* **Ring-outs.** A recipe may declare a capped number of **unrailed ring-out edges on required routes**.
     They are symmetric, and their lethal exposure is fairness-checked between the teams with the Q9 exposure
     metric. Off required routes an edge may be unrailed as before. Knockback strength over a rail is an I4 tunable.

**Surface states.**

5. **The sim owns the states**, keyed by `MaterialId` (Q16.8). The generator emits only the addressing: **surface
   cells** on the same 1.0 m lattice as the terrain grid (Q20) and the validation samples (Q12.7). A cell is
   (space id, i, j) with a floor height and a `MaterialId`, so stacked floors get distinct cells.
6. **A surface state never changes support, collision or links.** All six are fields: speed, traction, damage and
   nav cost. Walkable ice comes only from a pre-placed freeze feature (Q10f) or from an I4 temporary sim object.
   Owner confirmed: this ends freeze-any-water-and-walk; systemic freezing survives as an I4 temporary object.
7. **Three invariants for I4's temporary objects** (an ice sheet, a created rock, a fallen tree).
   - One only adds support, or it expires on a timer.
   - None is placed inside the spawn barrier, a staging area or the objective disc.
   - Expiry resolves the occupants by today's rule: a thaw leaves the body in the liquid and the exposure rule
     decides.
   - *(b)* **A temporary object that adds support obeys the Q6 step and slope bands at its edges.** Navigation reads
     it as a temporary obstacle or area (TileCache-style), never as a map change.

**Destructibles.**

8. **Two classes.** Stateful features (Q10f) are few, change routes, and have every state validated. **Breakables**
   are the many gameplay-tier props (trees, bushes, rocks, pillars); they never change routes.
9. **Breaking only removes colliders.** The residue has no collider: it is a `dressing`-kind archetype at most
   0.50 m high (a stump, a rubble pile). The 0.65 m stump platform is gone, which settles the note carried from Q6
   and Q15.10. Destruction then only adds walkable area, so the reachability watchdog and the stump revert are
   dropped. Owner confirmed: broken cover leaves no residual cover.
10. **Class D and E gates run on the stripped state** (every breakable gone). The guarantees rest on unbreakable
    pieces; breakable cover is a bonus on top. The intact state is reported, not gated. This replaces a state in the
    matrix and adds none. It carries today's "terrain-grade cover" rule (`PROP_MATERIALS.grave`).
11. **A single-removal gap check at `build`:** removing any one breakable leaves no gap within 0.10 m of a size
    threshold (Q6.4). Multi-removal combinations are reported, not gated.
12. **The cover-loss cap, fire spread, hit points and weight** stay rules tunables that the sim reads. An archetype
    record carries its material, weight, integrity and per-state archetype map (Q15.10).

**Model shape.**

13. **The arrays stay flat.** Colliders, links and volumes gain an optional `when: { feature, state }` or
    `when: { env }`. `features[]` lists id, kind, state count, position and the nav tiles each state touches (Q20b).
    `breakables[]` lists id, archetype and position. `ColliderBase.destructible` stays the hook from a collider to
    its breakable.

**Notes for I4.** Knockback strength over a rail and at a ring-out edge. Fall damage (none today). Fire spread between
breakables and surface cells in 3D, and its caps. The freeze rules of point 6. Lava-safe species
(`rules.hazards.lava.safeSpecies` is empty today). The cap on ring-out edges per recipe is a tunable with no number
yet.

### Q22 The training range in the new format (owner, 2026-11-24: option A accepted with amendments a–c)

Checked on main 583dcea. The range is authored code today (`buildRange`, `src/world/arenas.ts`), 112 m on a side. Its
stations are a firing field with the targets, a 2 m terrace with stairs, a 1.5 m jump block, four cover rocks
(0.75 m, inside the Q6 dead band), a pond, a tall-grass patch and three throwables (docs/RANGE.md). Five of the ten
replay scenarios run on it with scripted input tracks, and the targets anchor at the spawn plus offsets.

The option not taken was a fixed recipe and seed through the whole pipeline. Its stations would move whenever the
`plan` or `embed` code changed, which breaks the scripted tracks, and it needs a second mode template, because
Hold's five routes do not describe a range.

1. **The range is authored data**: an `AuthoredMap` in `src/rules/` (id, name, the space IR, a material binding and
   a style binding), typed TS like a recipe. It skips `plan` and `embed` and enters the pipeline at `build`; from
   there it takes the same `build`, `emit`, `validate`, freeze and `dress` as every map, with the same kit,
   archetypes, proxies and hash.
   - Owner confirmed: an authored range as TS source does not conflict with "no shipped map files". That decision
     covers dumps of generated maps; the range is hand-written data, as `buildRange` is today.
2. **No gameplay seed.** `dress` uses a fixed constant. The range has one golden `gameplayHash`, and the Q19 stop
   rule applies to it.
3. **Gates: class A and class C.** Each station is reachable by its declared size class and capability; no pits;
   every band holds. There is no class B, D or E, because there are no teams.
4. **Stations: one per rule the game depends on, each with a named marker.** Targets and tests anchor to markers,
   not to spawn offsets.
   - Kept from today: the firing field, the terrace with stairs, the jump block, cover, the pond, tall grass and the
     throwables. Heights are re-snapped to legal lattice values.
   - Added: a ramp; a 0.50 m step and a 0.80 m wall; the clear-height and gap rungs per size class; the cover rungs
     (1.45, 2.00 and 3.70 m); the wade, swim and dive tiers; soft soil; a climbable wall; a breakable; one stateful
     feature; a concealment volume; a timed hazard; a railed lethal edge with its `kill` volume; the flight cap.
   - *(a)* **Added by the owner:**
     - a burrow underpass with an emergence patch and a refill node;
     - a size-gated, small-only tunnel;
     - a flight course with a refill perch;
     - an underwater passage with an air pocket, with volume-graph samples for air and water;
     - camera probe rooms per size class (a 3.70 m ceiling, and a tight corridor for the pull-in), which host the
       Q7(b) camera test;
     - a team spawn-barrier test;
     - one breakable per strength tier;
     - an item-candidate marker;
     - a small SDF cave, added when the G2 cave builder lands;
     - an open sandbox for I4's temporary objects and elemental reactions.
5. **The shipped range obeys every generation rule.** Geometry that probes a threshold on purpose (a 0.62 m step, an
   exact-fit gap) lives in test-only fixtures built with the same kit, and never ships.
6. **The G1 / G2 split this gives.**
   - G1: the IR types, the kit, `build`, `emit`, classes A and C, the hash, the dressing interface, and the range.
   - G2: `plan`, `embed`, the Hold template, classes B, D and E, the repairs, and the first recipe.
7. **Replay.** The tile range stays the baseline until X1a. There the range scenarios are re-scripted against the
   markers and re-recorded, as a planned baseline change.
8. *(b)* **Dev-only: the range loads the Q14(a) experiment overrides**, so it doubles as a tunables playground. An
   experiment run is unranked. The shipped range uses the shipped tunables and its golden hash.
9. *(c)* **The range runs the day/night cycle**, and the readability and affordance lints (Q16.7, Q18.6) run on it,
   so a look experiment can be checked there first. *(Q23.2, confirmed by the owner, 2026-11-24: the range declares
   a complete cycle as its time of day.)*

**Notes.** Several stations wait for a later task: the SDF cave (G2), the camera probe rooms (the camera task sets
the band and the distance: Q15g), the temporary-object sandbox (I4), and the burrow, flight and dive stations (the
`climb` and `burrow` traversal kinds and the flight mechanic do not exist yet). G1 builds the geometry and the
markers for all of them; each task switches its own station on.

### Q23 The low-poly profile and the render plan (owner, 2026-11-24)

Added after the grilling: owner decisions and design changes, not a grilled question. Where a point replaces earlier
wording, that wording stays where it was and carries a Q23 note ("superseded", "extended" or "amended"), as Q15(g)
did. The owner's answers to the questions the record raised are under "Confirmed by the owner" below. Everything
here is presentation and outside `gameplayHash`, except the proxy dimensions of decision 7.

**Owner decisions.**

1. **A second dev-only style profile, `lowpoly`, beside `storybook`** (Q18.1a). One of the two ships. Which one is
   not decided.
2. **Time of day is per map.** A map declares a fixed time, a partial range or a complete cycle, with a period.
   - A partial range runs back and forth between its ends. Only a complete cycle wraps.
   - It is presentation data. The lints of Q14(f), Q18.6 and Q18.8(b) sample inside the map's range only.
   - Anything the time of day changes in gameplay stays an environment state (Q14f).
   - *(Owner, 2026-11-24.)* **The complete time-of-day system is built for the cutover:** fixed times, partial
     cycles and complete cycles, with working time progression, and developer controls to preview and test any
     time of day. In production a map may use a fixed time until it passes its combat readability, visual
     consistency, competitive fairness and performance checks. Its running cycle is then switched on, per map,
     with no architectural change.
3. **Tops read apart from sides.** An exposed top is distinguishable from its vertical sides by geometry, colour,
   light, a material transition or layering.
   - Caps, lips, bands, bevels and deposits are optional treatments. They depend on the material and are chosen per
     biome and role, from a closed list that includes `none`.
   - A lint checks the resolved top and side tones.
4. **The signal language is reserved, not the colours.**
   - Environment colours are unrestricted.
   - Team colours are a player setting. The defaults are hostile red and orange, own white and cyan, with presets
     for colour-vision deficiencies. These colours are not exclusive to combat.
   - Environment effects never imitate the complete signal language.
   - This replaces the hue reservation of Q18.5. The hero band is measured and reported in dev profiles, not
     enforced.
   - **Approved treatments:**
     - a dark underlay beneath ground telegraphs;
     - a two-tone keyline on every signal shape;
     - patterns and pulse timing that only signals use;
     - a shape and an icon per signal kind;
     - signals composited after grading, untouched by fog and bloom. *(The requirement is the result, not the
       order: confirmed point 6 below.)*
   - **Requirements:**
     - (a) Every signal is recognisable with colour removed. Motion carries no meaning that a static shape or
       pattern does not also carry.
     - (b) Contrast holds on the lightest, the darkest and the most saturated resolved ground of each map, at
       sampled times in its range.
     - (c) Each signal kind declares one occlusion rule: always visible, a silhouette through cover, or hidden by
       the world. The rule holds in every biome and style. Atmosphere and dressing never hide a signal. What hides
       a signal on screen is what blocks sight in the sim (Q15.8).
     - (d) At least two non-colour traits identify each signal kind and each team.
   - The lint checks these in greyscale and under simulated colour-vision deficiencies.
5. **Glow never depends on bloom.** The baseline is emissive materials, glow sprites, baked illumination and vertex
   colour. Bloom is optional and scalable. Its budgets and default quality come from profiling on low-end hardware
   (ROADMAP F39).
6. **No authored image textures.** Tonal variation comes from per-facet tone, a vertical gradient, lighter chamfer
   edges and strata bands. Painted accents (grain, cracks, tile edges) are stroke geometry, made by the render-side
   builders. *(Amended by the owner, 2026-11-24: first recorded as "No image textures". Code-made textures are
   allowed and Pokémon sprite art is exempt: confirmed point 2 below.)*
7. **Chunky proportions are a default with a configurable degree.**
   - For gameplay-tier archetypes they are proxy dimensions in `src/rules`: one default exaggeration value and an
     override per archetype, the same in every profile. Changing one re-validates the affected maps.
   - For dressing and backdrop archetypes they are visual: the profile's shape block sets a default minimum
     thickness, with an override per archetype class.

**Design changes.** Each is also marked at the section it amends.

- **Render chunks (Q16.4, the contract table).** A chunk carries welded positions, indices, a role and the optional
  blend of Q16.5. No normals and no colour. The renderer computes normals across chunk borders and splits them by
  crease angle.
- **Archetypes (Q15).** The exaggeration default and the per-archetype override of decision 7.
- **Dressing (Q17).** `Dressing` gains a backdrop list and atmosphere emitters.
  - The backdrop lies beyond the bounds, has no proxies, casts no shadows and has its own budget. The map edge
    stays a real boundary.
  - The atmosphere emitter kinds are halo, mist, steam and shaft.
- **Profile (Q18.1).** A profile gains `shape` (crease angle, chamfer width, irregularity, minimum thickness, stroke
  density) and `paint` (facet tone, vertical gradient, edge light, strata).
- **Material (Q18.2).** One world material family whose parameters span both looks: a ramp from continuous to
  banded, a normal mode per role, the paint terms, and pattern and ink down to zero. It is not a second shading
  model.
- **Passes (Q18.4).** The pass list is per profile, from a closed registry. Ink and bloom are optional. A pass at
  zero weight is not built. The normals target exists only when a pass needs it. A shipped build runs one locked
  list.
- **Light rig (Q18.7).** Ambient is two sets of six colours per keyframe (open sky, enclosed; one colour per axis
  direction; twelve in all), blended by a per-vertex sky visibility. Grading (lift, gamma, gain, saturation) is a
  keyframe value applied in the output step. *(First recorded as "six colours per keyframe, in two sets"; the
  owner clarified it on 2026-11-24: confirmed point 1 below.)*
- **Local light (Q18.9).** It is baked per vertex at load into a lamp channel, scaled by a time-of-day curve and
  confined to the emitter's space and its portals. Actors take a per-instance tint. Real-time local lights are not
  the baseline.
- **Registries (Q14.1).** Mesh builders, post passes and emitter kinds: ids in `src/rules`, a `Record` of
  implementations.
- **Budgets (Q20).** Rows for the backdrop, particle cards and strokes, each "set by profiling at I2a and F39".
- **Open items.** Where the kit-piece list for the render-side skins travels (G1); bloom's default; which profile
  ships.

**Confirmed by the owner (2026-11-24).** These points were first recorded with Q23 as reads. The owner answered
the seven that were put as questions: one is corrected, one is settled, five are confirmed.

1. **Ambient is twelve colours per keyframe.** Each set holds six colours, one per axis direction (+x, −x, +y, −y,
   +z, −z). There are two sets, open sky and enclosed. *(Corrected: the read recorded here, six in total and three
   per set, was wrong.)*
2. **Effect cards are code-made only.**
   - Shader maths for simple effects. Small, reusable, procedurally generated textures where sampling is cheaper
     than repeated maths: gradients, noise, glow masks, mist, steam, light shafts. Each is generated once and
     shared across instances.
   - Priorities: measured GPU cost, minimal memory, batching, instancing, distance culling and controlled
     transparent overdraw.
   - No authored image textures for world surfaces or atmospheric effects. Pokémon sprite art is exempt.
   - The aim is to remove authored texture assets, not to forbid efficient GPU techniques or procedural texture
     caching. Decision 6 and Q18.3 now say "no authored image textures".
3. **Where the time range is written.** In a recipe's `look` section (Q14.3), or in an `AuthoredMap`'s style
   binding (Q22.1). The training range declares a complete cycle (Q22.9).
4. **Steam.** A dressing `steam` emitter must read apart from a stateful feature's steam cue (Q16.7b, Q17.5c).
5. **The emitter overlap budget of Q20(c).** It was written before the technique was chosen. Under the baked lamp
   channel the count still bounds the bake, and I2a restates what the overlap number bounds.
6. **Signal compositing: the requirement is the result.** A signal's colour and luminance on screen do not change
   with a map's grade, fog or bloom. The pass order and the mechanism are I2a's and I2b's.
7. **Exaggerated proxies** stay on the 0.05 m lattice, inside the Q6 and Q7 bands and on the Q15b cover ladder.
   Exaggeration moves a dimension between legal values only.

**Also confirmed, as recorded** (the owner, 2026-11-24, on the other reads in the list).

- **The clock.** Where a map ties an environment state to a time of day, the sim's state is the authority and the
  presentation follows it (the sim emits, render reacts). Which clock drives the rest is I2a's choice.
- **The two new lints are class F** (Q12.4d): render-side, offline in CI, a gate on a look before it ships, never a
  generator gate. Their thresholds have no numbers yet.
- **The roster camouflage check of Q18.6 stands.** Decision 4 removes the reserved colour region. It does not
  remove the check that an actor reads against the ground behind it, or its fix (rim light or outline).
- **Sky visibility and the lamp channel are computed by the renderer at load**, from the model's chunks, spaces and
  portals. Neither is a model field (the chunk contract above lists what a chunk carries).
- **Visual geometry stays inside the Q15.7 envelope.** Chamfers, irregularity, top treatments and strokes are built
  render-side from the profile. None moves a model vertex, so the drawn ground is still the colliding ground (Q3),
  and the phantom-cover lint (Q15.8) guards the rest.
- **The signal kinds** (the list, with each kind's shape, icon and occlusion rule) are I2b's to write.
- Two reads were not named one by one in the owner's confirmation and rest on its general wording. **"Night
  samples"** in Q17.6(a) and Q20(c) means the darkest sampled times inside the map's range. **Mist or steam that
  hides a body** without a `screen` volume is phantom concealment (Q15.8).

**Where the work lands.** ROADMAP rows I2a, I2b and G1 carry the pointers.

## WorldModel contract changes (consolidated)

Everything the decisions above add to `src/world/model.ts`, in one place for G1. The field names and exact shapes
are G1's to settle; the content is decided. Each is a `MODEL_VERSION` change.

*(Owner, 2026-11-24, answer C.)* **A new task, WM2 "WorldModel contract v2", takes this table**, queued after G0 and
run before I2a, I3 and G1. It writes the table as types in `src/world/model.ts` (render chunks without normals or
colour, per Q23), adds `MODEL_VERSION`, and has the tile adapter fill defaults. Where the table says a field name
or a shape is G1's to settle, that is now WM2's. G1 fills the types from the generator. The convex-hull row stays
conditional on G1's measurement.

*(WM2, 2026-11-25.)* The third column names what WM2 settled. Ids whose registries do not exist yet (`LiquidId`,
`EnvStateId`, `FeatureKind`, `ArchetypeId`, `ScheduleId`, `CapabilityId`, `SpaceRole`) are string aliases in
`model.ts`, each commented with the task that closes it.

| Change | From | Settled (WM2, 2026-11-25) |
|---|---|---|
| A `MODEL_VERSION` constant | Q19.3 | `MODEL_VERSION = 2` (`src/world/model.ts`; WM's shape is 1) |
| `meta`: the requested seed, the used seed and why they differ. Where `WORLD_VERSION`, `requirementsHash` and `gameplayHash` travel (in `meta` or beside the model) is G1's choice. *(Q19(d): `requirementsHash` is a validation stamp in the curated record, beside the recorded `gameplayHash`; it is not part of the map's identity.)* | Q13.8, Q19 | `WorldMeta.requestedSeed: number`, `seed` (the used seed), `seedReason?: string` (absent when equal). `WORLD_VERSION` and the hashes: not added (G1) |
| `spaces[]`: id, role, tags, footprint polygon, floor, ceiling (`null` for open sky), `medium` (`'air'` or a liquid id) | Q2, Q9 | `spaces: Space[]`, `Space { id: SpaceId; role: SpaceRole; tags: SpaceTag[]; footprint: [x, z][]; floor: number; ceiling: number \| null; medium: Medium }`; `Medium = 'air' \| LiquidId`; `SpaceRole` a string alias (closed by G1) |
| `portals[]`: id, the two spaces, centre, clear width and height | Q2 | `portals: Portal[]`, `Portal { id; a; b: SpaceId; centre: Vec3; width; height }` |
| The closed tag union: `camera-clearance`, `long-lane`, `cover-zone`, `landmark-anchor`, `soft-soil` | Q2, Q10 | `SPACE_TAGS` / `SpaceTag` in `model.ts` |
| Colliders: a `role` and the resolved `material`; an explicit `blocksSight`; an optional `when` | Q15.4, Q16, Q21.13 | `ColliderBase.role: MaterialRole` (`MATERIAL_ROLES` in `src/rules/materialroles.ts`), `blocksSight: boolean`, `when?: When` with `When = { feature: FeatureId; state: number } \| { env: EnvStateId }` (also on volumes, links and route edges). `material` stays the tile era's string (ROADMAP F55) |
| A convex-hull collider shape, only if G1's measurement favours it | Q3(d) | not added (waits for G1) |
| Volume kinds: `concealment` (blocks sight only) and a team spawn barrier (carries its team) | Q8(h), Q10(g), Q12(a) | `VolumeKind` gains `'concealment'` and `'barrier'`; `Volume.team?: TeamId` (`'A' \| 'B'`) |
| `liquid` volumes: the liquid id, the level per environment state, the bed depth beneath | Q9 | `Volume.liquid?: LiquidId`, `levels?: { env: EnvStateId; level: number }[]` (states other than the base `level`), `bed?: number` (the bed's world y; depth = level − bed) |
| `hazard` volumes: an element, a schedule id, an exposure box | Q21.1 | `element` (as today), `Volume.schedule?: ScheduleId`, `exposure?: Aabb` |
| Marker kinds: an item candidate with a value; named station and anchor markers | Q10(e), Q22.4 | `MarkerKind` gains `'item'` (with `Marker.value?: number`) and `'station'`; `name` (as today) names stations and anchors |
| `navInput`: off-mesh links with a kind and the capability they need (`burrow` included); a soft-soil area flag; the volume-routing graph with a medium | Q8(e), Q9, Q10 | `OffMeshLink.needs?: CapabilityId[]`, `when?`; `NavInput.areas: Uint8Array` (one `NAV_AREA` bit set per triangle, `softSoil: 1`); `NavInput.routes: VolumeGraph { nodes: { position }[]; edges: { a; b; medium: Medium; radius; needs?; when? }[] }` |
| `features[]`: id, kind, state count, position, the nav tiles each state touches | Q10(f), Q20(b), Q21.13 | `features: Feature[]`, `Feature { id: FeatureId; kind: FeatureKind; states: number; position: Vec3; navTiles: [tx, tz][][] }` (per state; tile size is I3's, F56) |
| `breakables[]`: id, archetype, position; `ColliderBase.destructible` points at one | Q21.13 | `breakables: Breakable[]`, `Breakable { id: BreakableId (= number, as destructible); archetype: ArchetypeId; position: Vec3 }` |
| Surface cells: (space id, i, j), floor height, `MaterialId`, on the 1.0 m lattice | Q21.5 | `cells: SurfaceCells[]`, one per space: `{ space: SpaceId; i, j: Int32Array; floor: Float32Array; material: Uint8Array; materials: MaterialId[] }` (cell (i, j) covers x in [i, i + 1), z in [j, j + 1)) |
| *(Superseded by the next row, Q23.)* Render chunks split by role, with no baked colour. Outside `gameplayHash` | Q16, Q19.4 | (see the next row) |
| Render chunks split by role: welded positions, indices, the role and the optional two-role blend. No normals and no colour (today's `SurfaceChunk.normals` and `colours` go); the renderer computes normals. Outside `gameplayHash` | Q16.4, Q16.5, Q19.4, Q23 | `SurfaceChunk { cx; cz; material; positions; indices; role?: MaterialRole; liquid?: LiquidId; blend?: { role: MaterialRole; weight: Float32Array } }` (one second role per chunk, a weight per vertex); `normals` and `colours` removed |

Two records stay outside the model: `GenReport` (the zone graph, edge requirements, gate results, metrics, repairs
and the resolution log: Q2, Q12.10) and `Dressing` (the unhashed instance list, emitters included: Q17, Q18.9; since
Q23 also the backdrop list and the atmosphere emitters: Q17.8). Where the kit-piece list for the render-side skins
travels, in the model outside the hash or beside it like `Dressing`, is G1's to settle (Q23).

## Deliberate changes from the blueprint

The owner's blueprint and the research reports are quoted throughout and are not in the repository. Where this
design departs from them on purpose, the departure is recorded so that nobody "fixes" it back:

- **Q3:** the Rapier heightfield collider is not used; terrain is trimesh chunks cut from a height grid, and trimesh
  is also the collider for sweeps, not only for SDF caves.
- **Q14(d):** `validateRecipe` is hand-written TypeScript, not Zod.
- **Q18(a):** one shading model (storybook) instead of three style families and shading models. *(Q23: still one
  model. It is now one world material family whose parameters span two looks, `storybook` and `lowpoly`.)*
- **Q20:** 80,000 collision trimesh triangles, not the research report's 150,000.

## Open items

**Decisions still the owner's.**

- **The flight mechanic** (fuel, time or a jump count): Q8.2. The generator needs only the derived limits per full
  resource.
- **Stateful features: the design is not final** (the owner's note on Q10f). The cap of 4 per map is expected to
  rise (Q20d).
- **Who reads a recipe's species section in the sim** (Q14e). Pivot Q9 removed spawn pools, and nothing reads a wild
  or ambient list today.
- **Items.** The generator emits candidate markers (Q10e); the game has no item system.
- **The `none` symmetry** is deferred until the fairness thresholds are calibrated on symmetric maps (Q11.8).
- **The cap on ring-out edges per recipe** has no number (Q21a).
- **The porting order of the other five habitat recipes** after River Gorge (Q14.10).
- **A stored GameplayBundle** is deferred. The trigger is the first measured cross-engine hash mismatch, or ranked
  play being scheduled (Q19.8).
- **Which style profile ships**, `storybook` or `lowpoly` (Q23.1).

**Task order and scope (owner, 2026-11-24).**

- **G1 depends on I3** as well as I1b and I2a: its class A gate needs the navmesh (the `Probe` of Q12.2). It also
  follows WM2.
- **The cutover is narrow (answer B, as amended the same day).** X1a needs layer 1 of Q14.10(c) only: baseline
  walking routes, with liquids, timed hazards and breakables per Q9 and Q21. Layers 2–5 and their mechanics are
  tasks after X1c: fly, climb, burrow, dive, stateful features, concealment, items, the species section and
  overlays. *(Answer B as first given also listed day/night here; the next point replaces that.)*
- **Time of day is built for the cutover** (Q23.2). The complete system is there at X1a: fixed times, partial
  cycles and complete cycles, with working time progression, and developer controls to preview and test any time
  of day. A map may ship on a fixed time until it passes its combat readability, visual consistency, competitive
  fairness and performance checks. What comes after X1c is switching a map's running cycle on once it passes,
  with no architectural change.
- **All five route roles from layer 1.** G2's `plan` and `embed` lay out the "over" and "under" tertiaries and
  keep their space empty, so layers 2 and 3 fill it without moving the baseline routes (Q11, Q14.10c).
- **The replay baseline after the cutover.** Each of layers 2 to 5 changes River Gorge's `gameplayHash` as a
  planned change: its task names it, re-records the River Gorge scenarios once, and its commit says why (Q19.6).
  Any other moved hash is still a stop.
- **WM2, "WorldModel contract v2" (answer C)**, queued after G0 and run before I2a, I3 and G1: the consolidated
  contract table as types in `src/world/model.ts` (render chunks without normals or colour, per Q23),
  `MODEL_VERSION`, and the tile adapter filling defaults.
- **CL, "Camera law" (answer D)**, queued before G2 and I2b: the view band and the camera distance law in
  `src/rules` (Q7c), and the sim rule of Q15(g) (line of sight from the clamped view point, `src/sim/aim.ts`),
  flagged off until X1a. ROADMAP F45 and F51.
- **The blueprint** (ROADMAP F49): the owner will add it to `docs/`, or name this document the record. The owner
  believes the source is "Map and Environment Generation Blueprint" (`claude/00-blueprint.md` in another Claude
  project). Its text was not given in the grilling; the answers quoted it by section and term, without a title.

**Numbers that wait for the camera task (CL; this heading read "I2b" before answer D).**

- The camera distance. Until it exists the `camera-clearance` dimension rule (Q7, Q15g) and the tall-dressing
  keep-out (Q17) have no number, and the Q7 camera table and its 8.00 m short side are void.
- The view band 0.60–1.35 m and the cover ladder 1.45 / 2.00 / 3.70 m are starting tunables derived from each other;
  both are recomputed if the camera task changes the band (Q15b).

**Numbers that G1 measures.**

- The hybrid of boxes and trimesh against all-merged trimesh, on the first map (Q3).
- A convex hull for straight ramps and stairs (Q3d); cylinder and hull proxies (Q15.2, amendment b).
- **Controller cost on the generated terrain, before the 80,000 cap is accepted** (owner's review, 2026-11-24):
  per body-tick at the terrain's real triangle count, at 6 controllers, and physics' share of the `perf-sim` p95
  (Q3, Q20).
- Whether the collision trimesh budget can rise above 80,000 (Q20).
- The band margins, named in `src/rules/` with a test that pins today's controller and navmesh results (Q6).
- The camera probe per size class in a 3.70 m space (Q7b, hosted on the range: Q22a).
- The generation-time baseline per recipe; the Q20 targets are targets until then.
- Where the kit-piece list for the render-side skins travels (Q23): G1 settles it with the first mesh builders.

**Numbers that G2 measures or calibrates.**

- Walk-time thresholds at the reference speed (Q11).
- The five-route embed success rate against staging distance and plan bounds; the bounds rise if the template often
  fails to fit (Q11, Q20a).
- The class D starting numbers, the class E Pareto margins and the betweenness cap (Q12).
- The exclusive-access caps; the owner expects to raise the per-tertiary cap if burrowing feels limited (Q12).
- The fallback-rate threshold of 5 % (Q13.10).

**Numbers that wait for navigation (I3).**

- The Recast build time, and the cost of rebuilding the tiles a feature or a state touches (Q20b).
- The validation cost: navmesh builds × states × size groups. The free-seed time targets and the feature and state
  caps are revisited with it (Q20b).

**Numbers that wait for the renderer (F39, I2a, I2).**

- The lower-end machine (ROADMAP F39), then the render rows of the Q20 table, once, at I2a.
- The technique for local lights, and with it the emitter budgets (Q18.9, Q20c). *(Q23: the technique is decided,
  a baked lamp channel. The emitter budgets are still recalibrated at I2a.)*
- The hero band limits, calibrated by the readability lint (Q18.5). *(Superseded by Q23.4: the band is measured and
  reported in dev profiles, not enforced.)*
- Bloom's default, on or off and at what quality, with its budget (Q23.5).
- The backdrop, particle-card and stroke budgets (Q20, Q23).
- The thresholds of the two lints Q23 adds: top against side tones, and signal contrast.

**Things this design assumes that do not exist yet.**

- `climb` and `burrow` are not traversal kinds; `fly`, `levitate` and `dive` are reserved kinds with no mechanics
  (`src/rules/traversal.ts`).
- `SpeciesDef` has no region or theme field for a recipe's species filters to read (Q14e).
- `src/core` has no 64-bit hash (Q19.4).
- docs/CAMERA.md and docs/THIRD_PERSON.md describe the framing law that Q15(g) replaces.

**Input to I4**, collected: the liquid rules of Q9 (depth-relative damage, breath, typed liquids); the notes under
Q10 (underground senses, burrower UI, emergence, ground-shaking attacks, elemental reactions as temporary objects);
"what you see is what you can hit" (Q15g); and Q21 with its notes (the hazard lane, ring-outs and knockback, surface
states as fields, the three invariants for temporary objects, breakables, the model shape).
