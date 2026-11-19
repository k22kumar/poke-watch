# Third-person hero shooter: implementation plan (Phase 0)

This is the migration plan that turns the third-person camera (`docs/THIRD_PERSON.md`, render-only, Phase P0) into a
third-person hero shooter: aiming in 3D, attacks that leave the Pokémon's body, vertical combat, dependable input,
collision for bodies and shots, and shooter movement. It records what the code does today (checked against this checkout
on 2026-11-16), the decisions taken, the staged roadmap, the contracts the stages share, and the replay policy.

`docs/THIRD_PERSON.md` (camera rig), `docs/SIZING.md` (bodies, footprints), `docs/SYSTEMIC.md` (capabilities,
interception), `docs/BUILDS.md`, `docs/SQUAD.md` and `docs/HAZARDS.md` stay canonical for what is already built. When a
stage lands, it updates the subsystem doc it changes and the status table here. This file does not restate those docs.

Phase 0 changed no gameplay code. Everything under "Verified current architecture" was traced in code and, where marked
**R**, reproduced at runtime against this checkout. §2 describes the code as Phase 0 found it; where Phase 1 (§11) changed
it, the paragraph says so. Phase 1 (2026-11-16) landed the view-state contract: Stage 2A and the host-order seam of Stage 1.
Phase 2A (2026-11-16) landed Stage 3: the deterministic spatial queries of `src/sim/spatial.ts`, with no consumers yet (§12).
Phase 2B (2026-11-16) landed the aim-ray schema (Stage 2B) and, for the direct linear shots (bolt, orb), the sim-owned aim and
muzzle (Stage 4A) and their swept 3D flight (the linear part of Stage 4B), with no assistance on that path (§13).
Phase 2C (2026-11-16) moved the beam family onto the same aim, muzzle and spatial queries (the beam half of Stage 5B) and made
the authored foliage rule (`blocksShots`) the cover policy of every spatial attack trace (§14).
Phase 3 (2026-11-16) landed the fire half of roadmap Stage 2C (edge-preserving press capture, a bounded fire buffer,
accept / wind-up / release / cooldown as separate steps) and per-device assistance on the planar path (part of Stage 5A),
with every checksum set unchanged (§15).
Phase 4A (2026-11-16) landed roadmap Stage 6A: the player owns the view direction (no automatic state, slope or climb tilt)
and the vertical aiming envelope is 60° up and 50° down. Zero-input lens placement is unchanged and every checksum set is
unchanged (§16).
R1 (2026-11-16, the audit roadmap's first phase) landed roadmap Stage 6C: bodies meet deck slabs by their sim height, and
wide routing has height classes. Only the `gen` set moves; `gen-headroom-off` reproduces it (§17).
R2 (2026-11-16) made the aim maths pole-safe (audit F6, F7, F8): a continuous muzzle, a fan that keeps its spread at any
pitch, a view basis from the yaw. Only the `aim` set moves (pitched multi-shot fans); `aim-pole-off` reproduces it (§18).
R3 (2026-11-16, completed 2026-11-17) widened the envelope to ±89° (audit F4, F9; owner decisions B, C, E): past 40° down
the lens rises with the view (owner-approved, replacing the first draft's 50° start), looking up an edge cue shows the body,
billboards lean back past 51.3° of seen elevation. Render only: every checksum set unchanged; from 60° up to 40° down the
rig is the R2 rig bit for bit (§19).
R6a–R6c and R1b followed (§20–§23). The camera overhaul (2026-11-18, §24) replaced the threat states, the lagging pivot,
the climb, the shoulder swap and the lens shake with one size-class framing attached to the Pokémon, eased the deck cap
along the boom, and fixed the look input; every checksum set unchanged. Statements below about Explore / Combat /
Pressure, the climb or the swap describe the rig before §24. The second pass (2026-11-18, §25) reframed that rig from
the sprite as drawn, in screen space, against pass marks fixed before tuning: an L-shaped arm, a keep-out around the
crosshair, a fade; statements below about the single diagonal boom, the 0.24 shoulder, the dense-prop pull-in or the
collision look-ahead describe the rig before §25.

**Phases and stages are different numbers.** A *phase* is a work order (Phase 0, 1, 2A, 2B, …); a *stage* is a roadmap row
in §5. They do not line up: Phase 1 = Stage 2A and part of Stage 1; Phase 2A = Stage 3; Phase 2B = Stage 2B + Stage 4A
(direct shots) + Stage 4B (linear shots only) + the spatial-path part of Stage 5A; **Phase 2C = the beam half of Stage 5B**
(chain stays open), **not** roadmap Stage 2C (input acceptance); **Phase 3 = the fire half of Stage 2C + the planar part of
Stage 5A** (the jump half of 2C stays open); **Phase 4A = Stage 6A** (render only). "Owner: Stage X" in this file always names a
roadmap stage.

---

## 1. Product objective and invariants

**Objective.** What the player aims at with the crosshair is what the attack travels toward, in 3D. Shots, beams, strikes
and areas respect height, cover, decks and bodies. Input is never silently lost. Movement reads as a shooter (strafe while
aiming) during combat and as exploration otherwise. Every Pokémon's attacks start from its body (mouth or chest, scaled to
its size class), and each move family keeps the identity it has now.

**Invariants (each stage must keep all of them):**
1. `src/sim/` and `src/world/` never import `render/`, `ui/`, `audio/`, `input/` or `assets/`, and they still run in Node.
2. Fixed 1/60 s ticks, one RNG stream per system, no `Math.random` and no clock in sim output.
3. The sim reads the camera only through serialised `InputFrame` fields. It never reads `ChaseRig` or renderer state.
4. Tunable numbers live in `src/rules/` and systems read them from `ctx.rules`.
5. Every new behaviour sits behind a rules flag. With the flag off, the stage reproduces the previous hashes from
   `scripts/checksum.ts` exactly (§6).
6. The bot (`src/sim/bot.ts`) sends no aim, so it stays on the legacy nearest-enemy path until Stage 7A moves it on purpose.
7. Classic, Overhead and Wide views keep working. Under them the sim receives the legacy `aimX/aimZ`.
8. The camera rig's strengths are kept (§2.9). Stages change the view's *direction* contract, not the collision,
   smoothing, 120 Hz rig clock or culling.
9. Move diversity is kept: the 23 archetypes stay distinct. Stages change how they find their targets and how far they
   reach vertically, not what each one is.
10. No engine replacement and no networking. Determinism is kept so that rollback stays possible later.

---

## 2. Verified current architecture

### 2.1 Frame and tick order (host)
`src/main.ts` `frame()` (L344–L416):
1. `lookInput(real, live)` (L372, L291–L299) reads mouse deltas and the right stick and calls `Renderer.look(dyaw, dpitch)`
   (`src/render/renderer.ts` L343–L347). **Yaw** is written into `rig.yaw` at once. **Pitch** is only accumulated in
   `Renderer.lookPitch`, and is applied the next time `rig.update` runs.
2. Sim loop (L384–L391): for every 1/60 s step that is due, `sampleInput(c)` (L198–L210) calls `input.sample(renderer.yaw)`.
   In chase mode it then calls `renderer.chaseAim(c)` → `chaseAim(rig, P.x, P.z, …, world.height)`
   (`src/render/camera.ts` L578–L598) and writes `inp.aimX/aimZ`. Then `step(c, inp)` runs.
3. `renderer.render(c, alpha, …)` (L408) interpolates the player and calls `rig.update(chaseFrameFor(…))` (renderer
   L596–L601). This is the only place that recomputes `rig.eye` and `rig.viewPitch` and applies the stored pitch.

As a result, every sim tick in a frame aims with **this frame's yaw** but with **last frame's eye position and view
pitch**. The crosshair is drawn from the updated rig, so the sim and the screen disagree for one frame after any turn.

Capture mode (`advance`, L451–L470) follows the same order: `sampleInput` for each tick, then one `render`.

**Fixed in Phase 1 (§11).** The order is now `runFrame` in `src/render/hostframe.ts`: look → one `ViewSample` → the due
ticks with that sample → render. `ChaseRig.look` applies yaw and pitch at once and recomposes the lens, so the sample is
coherent.

### 2.2 Input (`src/input/input.ts`)
- `sample(yaw)` (L219–L248) returns `{ mx, mz, jump, dash, btn }`. Movement is relative to the camera yaw.
- Combat buttons: `btnLatch` ORs every first keydown or mousedown since the last sample, so a click that goes down and up
  between two ticks still reaches the sim for one tick. It is cleared on the first `sample` of a frame (L227).
- Dash: `dashLatch` works the same way.
- **Jump has no latch**: `jump = this.down('jump')` (L223) is the held state at sample time. A gamepad is polled at
  sample time too.
- `InputFrame` (`src/sim/types.ts` L14–L25) carries a planar `aimX/aimZ` only: no height, no ray, no device.

### 2.3 Camera rig (`src/render/camera.ts`)
- Render-owned and deterministic in its own right: a fixed 120 Hz clock, critically damped states, collision, shoulder
  swap and climb. `tests/camstability.test.ts` pins its behaviour.
- View pitch is `cur.tilt + userPitch + slope + lift·0.7` (L563–L564). `userPitch` is clamped to `pitchRange: [-14, 20]`
  (L71). State tilt is 6° / 7.5° / 10° (Explore / Combat / Pressure), so the highest the view can look is **8° above the
  horizon** (**R**).
- The aim ray (`chaseAim`) marches the crosshair ray against `world.height(x, z)`. It uses no layer reference, so it ignores
  decks, and it ignores walls, props and actors. The result is clamped to 4–26 m (L122) and reduced to a ground point
  `(x, z)`.

### 2.4 Player movement (`src/sim/player.ts`)
- Jump (L158): `inp.jump && P.grounded` uses the held flag, so holding Jump re-jumps on every landing (**R**: 8 jumps in 5 s).
- Vertical motion (L163–L179) checks only the support below. **There is no ceiling test and the body height is never
  used.** `World.ceilingAt` exists (`src/sim/world.ts` L246–L252) but only the camera reads it.
- Facing (L190–L197) turns toward the move direction. While a wind-up runs (`aimT`), it turns toward the aim. Casts also
  set `facing` directly (`moves.ts` L427, L464, L494, L605, L732).
- Horizontal collision uses footprints (`World.moveBody`, `docs/SIZING.md`). This is a strength.

### 2.5 Move resolution (`src/sim/moves.ts`)
- `movesSystem.update` (L759–L827) checks, per slot: wind-up, then cooldown, then the button. While the cooldown runs,
  presses are ignored (L795–L796). When it ends, the button must still be held (L799). This is pinned as intended by
  `tests/combat.test.ts` "primary fire: a press only during the cooldown is dropped (no buffer)".
- Wind-up: `rules.feel.windup[archetype]` lasts 0.06–0.14 s (`src/rules/defaults.ts` L479). The aim is resolved again at
  release (L791).
- `resolveAim` (L280–L326) applies **magnetism** to manual aim: the enemy closest to the aim line inside 12° (melee: 28°),
  or within its own radius + 0.6 m of the line (L293–L307). It has no line-of-sight or height test. (Phase 2B: a cast on the
  spatial path returns before this loop, and `straight()` skips its lead; §13.5.)
- `straight()` (L716–L735, used by `bolt`, `orb`) **leads** any magnetised target (L722–L725).
- Every archetype works in `(x, z)` only. `aoe`, `single`, `beam`, `cone`, `chain`, `strike` and the rest never read `y` or
  `World.sight`, so they hit through walls, decks and height differences.

### 2.6 Projectiles (`src/sim/effects.ts` `projectileSystem`, L108–L253)
- Player shots spawn at `player.y + 0.8` (`moves.ts` L195) with `vy = 0`.
- On non-location maps a shot's height is set again every tick to `max(ground + 0.7, P.y + 0.8)` (L204). It follows the
  **player's current height**, not its own launch (**R**: the shot rose 1.58 m while the player jumped).
- On location maps (`W.los`) a shot keeps its height, sinks off ledges at 7 m/s, and ends on a rise (L199–L203).
- Collision is a point test at the end of each tick against `grid.query` candidates, in grid order, not by first contact
  (L211–L229). Pierce is used up in that order. There is no swept test.
- **Phase 2B (§13):** shots launched by the spatial aim (`Pr.traj` 1) no longer use any of the above: they fly their own 3D
  line on swept, ordered contacts. The rules in this section still hold for every other player shot (the bot, the fixed
  views, the other archetypes) and for enemy shots.
- Enemy shots (`shootHostile`, `src/sim/enemies.ts` L136–L156) already have a real `vy` toward the player's chest on
  location maps. That is the precedent for 3D launch.
- The renderer draws `Pr.x/y/z` as they are (`renderer.ts` L1083, L1114), so the visuals follow the sim.

### 2.7 World queries (`src/sim/world.ts`)
- `height(x, z, ref)`, `support`, `collides`, `wallAt`, `ceilingAt`, `node`, `moveBody` (footprints) and `nearestFit`.
- `sight(…)` (L331–L348) is a 3D line test that samples every 0.5 m against wall tiles, terrain and deck slabs. Only enemy
  ranged attacks use it (`enemies.ts` L362). (Phase 2A: it misses corners and treats the 0.9 m `DECK_REACH` band as slab;
  `segmentClear` in `src/sim/spatial.ts` is the exact replacement, unused until Stage 7A. §12.2.)
- Decks: `DECK_REACH = 0.9`, and the underside is at `over − 0.6`. `tests/locations.test.ts` asserts at least 2.9 m of
  clearance from the ground to the deck top.

### 2.8 Tests and diagnostics
- `npm test` (`tsx --test tests/*.test.ts`) gives 374 tests, 374 passing, in about 45 s (2026-11-16). `npm run typecheck`
  is clean. After Phase 1: 383 tests, 383 passing (§11.4).
- `scripts/checksum.ts` holds bot-driven replay hashes for each flag set. The bot never aims, jumps or taps, so **no
  existing hash exercises the manual-aim path** (§6).
- `scripts/camstats.ts` runs the rig headless. `tools/cap.mjs` with `tools/chasecheck.json` runs browser probes.
  `scripts/perf-sim.ts` is the performance gate. `scripts/navwalk.ts` and `scripts/stuckwatch.ts` check movement.
- **No test drives the host order.** `main.ts` needs the DOM and cannot be imported. `tests/camstability.test.ts` "rapid
  direction changes: the move direction and the aim follow the camera on the very frame it turns" calls `r.update()`
  **before** `chaseAim()`, which is the opposite of the host order, so it passes while the host is wrong.
  (Phase 1: the order lives in `src/render/hostframe.ts`, which `tests/viewsample.test.ts` drives; the camstability test
  is rewritten to the host order.)

### 2.9 Strengths to keep unchanged
The camera rig's collision, smoothing, hysteresis, 120 Hz clock, shoulder swap, culling and dissolve, with their
`camstability` pins. Footprint collision and size-aware navigation (`moveBody`, `navblocks`). The flagged-layer checksum
discipline. The data-driven archetype classifier and capability tags. `btnLatch` and `dashLatch` (one-tick press
delivery). Wind-up release that resolves the aim at the HitFrame. The enemy shots' 3D launch and `World.sight`. Guard,
Reflex and the interception systems.

---

## 3. Evidence register (prior-audit claims)

Classes: **C** verified by code · **R** reproduced at runtime · **H** supported hypothesis · **S** subjective preference ·
**U** unverified.

| # | Claim | Class | Evidence | Correction to the prior audit |
|---|---|---|---|---|
| 1 | Third-person aim is a planar `aimX/aimZ` | **C** | `types.ts` L19–L21; `main.ts` L206; `chaseAim` returns `[x, z]` | Also: the ray ignores decks, walls, props and actors, and is clamped to 4–26 m |
| 2 | New yaw is combined with stale eye and pitch | **C R** | Host order §2.1. A rig settled on flat ground, then turned, comparing `chaseAim` before `update` (host order) with after (what is drawn): 17°: 0.92 m; 90°: **5.85 m**; 126°: 7.34 m; 180°: 8.07 m. A pitch-only look of 10° gave 6.48 m (pitch is applied one frame late). Phase 1 re-measured it through the real host order on Viridian Forest seed 1 (Cyndaquil): 0.81 / 5.42 / 6.94 / 7.61 m, pitch 10° down 5.70 m, 10° up 16.3 m, 90° + 8° 8.95 m; after the fix 0.000 m for all (§11.1) | The prior figure of 6.20 m is within this range; the exact value depends on the turn and the terrain. **Fixed in Phase 1** |
| 3 | Hidden magnetism and automatic lead redirect manual attacks | **C R** | `moves.ts` L293–L307, L722–L725. An enemy 6.3° off a due-north aim gave a shot at 6.3° (fully snapped). At 12.5° (outside the cone, perp > r + 0.6) it was not snapped. Aiming straight at a strafing enemy added 1.84° of lead | No LOS or height test in the cone |
| 4 | Straight shots use terrain or player-height rules, not their own 3D trajectory | **C R** | `effects.ts` L199–L204; `moves.ts` L195. Authored map, shot then jump: shot y 0.97 → 2.55 while player y 0.17 → 1.75; `vy` stays 0 | Location maps use a different rule (keep height, sink 7 m/s) that is still not ballistic |
| 5 | Beam, melee and area ignore elevation and cover | **C** | No `y` and no `sight` in any archetype in `moves.ts`. `beam` L469–L499 is a 2D capsule. `aoe` L138–L158 is a 2D circle | Only projectile hits test height, and only on location maps (`effects.ts` L218). Not reproduced at runtime; the code path is unconditional |
| 6 | Camera pitch is constrained and auto framing changes view pitch | **C R** | `camera.ts` L71, L563. Upward limit 8° above the horizon. With no input, a Pressure threat moved the view pitch from 6° to 10°; slope and climb tilt add to it | Also changes the aim point with no player input |
| 7 | Movement facing and attack facing compete | **C** | `player.ts` L190–L197 (move dir, or `aimFacing` for wind-up + 0.18 s); casts write `facing`. Facing is the fallback for `holdAim` (`capabilities.ts` L76–L84; the hold and release direction with no aim), the idle dash direction (`player.ts` L105) and the carried egg's position (`objectives.ts` L203) | — |
| 8a | Jump taps can be lost | **C R** | `input.ts` L223. Stubbed `Input`: keydown + keyup of Space before one `sample()` → `jump: false`. The same tap on J → basic latched; on Shift → dash latched | — |
| 8b | Holding repeats jumps | **C R** | `player.ts` L158; 300 ticks held = 8 jumps | — |
| 8c | Large bodies penetrate ceilings | **C R** | No ceiling in `player.ts`. Chargestone Cave seed 3, deck clearance 3.0 m: Totodile (0.95 m) head 0.30 m into the slab at apex; Feraligatr (2.25 m) 1.60 m; Onix (2.59 m) 0.19 m into it **standing** | The existing deck test checks feet only, so it passes |
| 9 | Primary attacks have move-specific wind-ups and cooldowns; presses during cooldown are discarded | **C R** | `moves.ts` L785–L799; `defaults.ts` L479. Pinned as intended by `tests/combat.test.ts` "primary fire: a press only during the cooldown is dropped (no buffer)" | It is a deliberate rule, not a bug: changing it is a product decision (D6) and must replace that test on purpose |
| 10 | Tests do not reproduce host, render and sim order | **C** | §2.8. The `camstability` "rapid direction changes" test updates the rig before aiming; `main.ts` cannot be imported | — |

Further findings from this audit:
- **N1 (C)** Pierce and multi-hit order is grid order, not contact order (`effects.ts` L211–L229).
- **N2 (C)** Player projectiles have no swept test (point at end of tick). At 1/60 s and the current speeds, tunnelling is
  unlikely but possible for fast, small shots against small bodies. (**H**, not reproduced.)
- **N3 (C)** The bot never aims, jumps or buffers, so the hashes do not cover the manual paths. A recorded human-input
  fixture is needed (Stage 1).
- **N4 (C)** On a frame that runs several ticks, `btnLatch` reaches the first tick only (**R**: tick 1 = 16, tick 2 = 0).
  The wind-up starts on that tick, so this is correct, but buffering (D6) must keep the one-tick delivery.

How to reproduce: Stage 1 turns each **R** row into a `node:test` case in `tests/thirdperson.test.ts`, marked
`{ todo: … }` until the stage that fixes it. Phase 0 used two throwaway scripts that import repo code read-only: camera
host order versus draw order, magnetism and lead, shot height, holding and tapping jump with a stubbed DOM `Input`, and
head height under the decks of Chargestone Cave seed 3 (the same `deckTile` choice as `tests/locations.test.ts`).

---

## 4. Design decision register

Each decision lists its evidence, the selected design, rejected alternatives, trade-offs and consequences.

### D1. Camera-state authority across fixed sim and variable render
- **Evidence:** claim 2 (§2.1), claim 10. The rig must stay render-owned: it reads props, presentation size and frame time.
- **Selected:** The rig stays the only camera authority, in render. Add one pure function, `ChaseRig.viewAt(yaw, pitchDeg)`,
  which returns `{ eye, dir, fov }`. It applies the current yaw and pitch on top of the last rig tick, using the same
  rotation `update()` already uses (L307–L314). `Renderer.look` applies yaw **and** pitch to the rig at once. Both the
  host's `sampleInput` and the renderer's view matrix call `viewAt`, so the sim and the crosshair use the same
  numbers. The host samples the view once per frame, after `lookInput`, and gives that sample to every tick of the frame.
- **Rejected:** (a) moving the rig into the sim: it would hash presentation tuning, read props and sprite sizes, and
  replays would depend on camera config. (b) Calling `rig.update` before the sim loop: the rig needs the interpolated
  player of *this* frame, which exists only after the sim steps, and this would double-step the 120 Hz clock.
  (c) Sending only yaw and pitch and having the sim rebuild the eye: the sim cannot know boom collision.
- **Trade-offs:** the eye position can lag the sim's player by up to one frame (it is interpolated). D3 makes this harmless,
  because the sim casts the ray against its own world and builds the physical origin from its own player position.
- **Consequences:** render only, no hash change (Stage 2A). The `camstability` "rapid direction changes" test is rewritten
  to the host order.
- **As landed (Phase 1, §11.2):** instead of a separate `viewAt(yaw, pitch)`, `ChaseRig.look` applies the input to the rig
  at once and recomposes its view, and `ChaseRig.sample` copies it. Same numbers, one fewer code path: the renderer draws
  the rig the sample was copied from, so there is nothing to keep in step. It also swings the lens for the boom elevation
  that pitch drives, which `viewAt` as specified would have missed (§11.1, finding F2).

### D2. Serialised aim input
- **Evidence:** claim 1; invariant 3; N3.
- **Selected:** extend `InputFrame` with optional fields:
  `aim?: { ox, oy, oz, dx, dy, dz }` (camera ray: eye and unit direction, each passed through `Math.fround` when built so
  that recordings are compact and stable), and `aimDev?: 'mouse' | 'stick' | 'touch'` (device class, for D9).
  `aimX/aimZ` stay as they are: legacy and fixed views. When `aim` is present, the sim derives everything from it.
  When it is absent, the legacy path is used unchanged.
- **Rejected:** sending a precomputed 3D aim point: the host would do the world query outside the sim, which is
  non-deterministic with respect to sim state and repeats the stale-state bug. Sending yaw and pitch only: see D1(c).
  Replacing `aimX/aimZ`: it would move every hash that contains aim and break the fixed views.
- **Consequences:** Stage 2B adds the fields and an adapter, and the sim ignores them until 4A (no hash change). Replays and
  rollback stay deterministic, because the ray is input data.

### D3. Camera hit versus physical-origin obstruction
- **Evidence:** claims 1, 4, 5; `chaseAim` uses ground only; the shoulder offset is "nudged" (L596).
- **Selected:** two queries, both in the sim (Stage 4A):
  1. **Camera trace.** Cast `aim` from `o + d·tNear` up to `rules.aim.maxRange`, where `tNear` = the distance along the ray
     to the plane through the player's pivot (this skips anything between the lens and the Pokémon). It hits terrain, deck
     slabs, wall columns, bodies and enemy hurt cylinders (D4). The result is the **aim point T**, or `o + d·max`.
  2. **Muzzle trace.** Muzzle M = player position + facing-relative offset × body (`rules.size` classes get
     `muzzle: {up, fwd}`, which `profiles.ts` can override per species). The launch direction is `normalize(T − M)`. If the
     segment M→T is blocked before T, the attack meets that obstacle (the physical truth). The host shows a
     "blocked" reticle state computed with the same query function (render may call pure world queries).
  Convergence: within `aim.convergeMin` (≈ 2 m), aim along `d` so that close targets do not swing the shot sideways.
- **Rejected:** firing straight along the camera ray from the lens (shots would leave the camera, not the Pokémon);
  muzzle-only aim (the crosshair would lie whenever the shoulder offset and height differ).
- **Consequences:** this is the core contract for 4A, 4B, 5B and 5C. The legacy `chaseAim` stays for the fixed views and as
  the reticle fallback.

### D4. Collision semantics (terrain, deck, wall, actor, projectile)
- **Evidence:** §2.6–2.7; N1, N2; claim 8c.
- **Selected:** a new pure module, `src/sim/spatial.ts` (Stage 3), with no consumers at first:
  - `raycast(world, ox, oy, oz, dx, dy, dz, maxT, mask, out)` → first contact `{t, kind, id, nx, ny, nz}`, found by
    Amanatides–Woo tile traversal (exact on the tile grid, not 0.5 m sampling).
  - `sweep(world, ctx, p0, p1, radius, mask, cb)` → **ordered** contacts along a segment, for pierce.
  - Semantics: terrain = tile columns with a flat top `height(x, z)` (stairs as their ramp); deck = a slab from
    `[over − 0.6, over]`; a wall tile = an infinite-height column (today's `wallAt` rule for player shots); a chasm = no
    floor; bodies = spheres; enemies = vertical cylinders `E.y .. E.y + E.tall`, radius `E.radius`; player = a cylinder
    `partnerRadius × partnerHeight`.
  - Masks pick the layers: camera trace (terrain | deck | wall | enemy | body), shot (all), beam, LOS (terrain | deck |
    wall).
  - `World.sight` stays (enemy AI and hashes). Stage 7A can move it onto `raycast` behind a flag.
- **Player ceiling (Stage 6C):** vertical motion clamps the head (`y + partnerHeight`) at `ceilingAt`. Under
  `rules.size.headroom`, a footprint whose body is taller than (underside − ground) treats that tile as blocked in
  `moveBody` and in `navblocks` (Onix today stands 0.19 m inside the slab).
- **Rejected:** a third-party physics engine (it does not need replacing, and it threatens determinism); a voxel or BVH
  rebuild (the tile grid is already the spatial index); keeping 0.5 m sampling (it misses thin corners and is not ordered).
- **Trade-offs:** wall tiles stay infinite-height columns, so shooting over a low prop is not possible yet. Prop heights
  (`PROP_RULES`) are a later refinement, recorded as a deferral.
- **As landed (Phase 2A, §12.3):** the names and shapes changed. `raycastWorld(world, o, d, maxT, mask, hit, r, h)` is the
  first world contact; `sweep(ctx, o, d, maxT, query, contacts)` the ordered list. Bodies are upright cylinders `[y, y + 2r]`
  (the bounding cylinder of the ball), not spheres: one volume type keeps every sweep exact. Low props (bush, rock, grave
  markers) are terrain of their platform height, so a ray does pass over them; wall tiles stay infinite columns. The deck
  slab is 0.6 m (`DECK_SLAB`, what the renderer draws and `ceilingAt` uses), not `World.sight`'s 0.9 m. Masks select kinds;
  world kinds always block; actor kinds block, pierce or overlap by the query's `block` and `pierce`.

### D5. Launch-state independence and guidance exceptions
- **Evidence:** claim 4; `shootHostile` precedent.
- **Selected:** a player projectile owns `x, y, z, vx, vy, vz` and a `gravity` scale from its launch. Nothing reads the
  player after launch except the declared exceptions. Each archetype declares a `trajectory` in a new table in
  `src/rules/moves.ts` (data):
  `linear` (bolt, orb, barrage) · `ballistic` (lob: a real arc to T; meteor and smite: fall onto T from above) ·
  `homing` (homing, drain: steers in 3D toward a sim-acquired target) · `return` (boomerang: out along the launch line,
  back to the owner) · `attached` (orbit: follows the owner by design) · `ground` (trail, trap and zones: lie on the
  surface layer of T).
  Out-of-range behaviour: a linear shot that reaches its range ends. One that hits the ground or a wall ends with an
  `endShot` event at the contact point.
- **Rejected:** keeping terrain-following shots (aiming up and down would mean nothing); giving every projectile gravity
  (bolts would feel muddy, and it moves balance).
- **Consequences:** Stage 4B. Hashes move for the `on` set when it is switched on (bot shots are spawned through the same
  code), so it ships behind `rules.aim.trajectory3d` and migrates in 7B.

### D6. Manual fire: acceptance, buffering, hold, wind-up, cooldown, presentation
- **Evidence:** claim 9 (it is a deliberate rule), N4, `btnLatch`.
- **Selected:** split the slot state machine into **accept → (buffer) → wind-up → release → cooldown**, plus presentation
  events:
  - A rising edge of the slot's button during cooldown or wind-up is **buffered** for `rules.combat.fireBuffer` s (default
    0.15). If the slot becomes ready inside that window, it fires once. Holding still repeats on cooldown (unchanged).
    Releasing never cancels a committed wind-up (unchanged).
  - The edge comes from `P.btnPrev` (already in the sim for Guard), so the one-tick `btnLatch` delivery is enough.
  - Presentation keeps the `windup` and `cast` events. Add `fireBuffered` and `fireDropped` (buffer expired) for the UI.
  - Wind-up and cooldown numbers stay per archetype in `rules.feel.windup` and `MoveSpec.cd`.
  - Jump: add `jumpLatch` in `Input` (as for dash) and the edge field `jumpPressed?: boolean` in `InputFrame`. Under
    `rules.player.jumpEdge`, the sim jumps on the edge with `jumpBuffer` (0.12 s) and `coyote` (0.1 s), and holding only
    glides (fliers).
- **Rejected:** buffering in `Input` (host time, not sim time; non-deterministic in replays); auto-repeat on a tap.
- **Decision owner:** replacing "a press only during the cooldown is dropped (no buffer)" is a product change. The plan
  assumes buffering is wanted (as the brief directs) and keeps `fireBuffer: 0` as the legacy setting that keeps the test
  meaningful (§8 Q1).
- **Hash risk:** the bot toggles `BTN.basic` with `basicInReach`, so a buffered edge could fire where it does not today.
  `fireBuffer: 0` under every older checksum set keeps the hashes.

### D7. Look ownership, facing and strafing
- **Evidence:** claim 7.
- **Selected:** under `rules.locomotion.facing`:
  - `'legacy'`: today's rule.
  - `'shooter'`: when an `aim` ray is present and the Pokémon is in **combat stance** (fired or buffered within
    `stanceHold` = 1.5 s, or Guard held, or a hostile within `stanceRange`), facing eases to the aim yaw at
    `aimTurnRate`, and movement strafes (camera-relative, as now). Out of stance, facing follows movement (exploration).
    Dash keeps its rule (move direction, else facing).
  - Casts stop writing `facing` directly when shooter facing is on (the aim already set it).
  - Render: the sprite direction comes from facing (unchanged). Walk-cycle direction against the move vector gives
    "strafe" playback: the same direction sheet, played backwards when moving backwards. This is a subjective feel item
    (§9).
- **Rejected:** always facing the aim (it breaks exploration and the size-class movement feel); turning the camera to face
  the movement (it fights player-owned look).

### D8. Move-family targeting and verticality
- **Evidence:** claims 3 and 5; the archetype list in `defaults.ts` L479.
- **Selected:** a data table `MOVE_FAMILY` in `src/rules/moves.ts` maps archetype → `{ target, trajectory, vertical, cover }`:

  | Family | Archetypes | Target | Vertical | Cover |
  |---|---|---|---|---|
  | Linear shot | bolt, orb, barrage | aim point T (D3) | full 3D launch | sweep stops on solids |
  | Seeker | homing, drain | sim acquires the target nearest the aim ray inside `acquireDeg` with LOS | 3D steering | LOS at acquisition; the shot itself collides |
  | Arc / sky | lob, meteor, smite | T (ground or deck layer) | ballistic / from above | lob: sweep; meteor/smite: overhead slab (deck) blocks |
  | Return | boomerang | T | 3D out, returns to owner | sweep |
  | Beam | beam | ray M→T, length `range` | 3D capsule | stops at the first solid; pierces actors in contact order |
  | Chain | chain | first target as seeker; hops ≤ `hop` m with LOS and Δy ≤ `hopRise` | 3D | LOS per hop |
  | Contact melee | strike, dash, spin, cone | box or cone from M along the aim yaw; pitch limited to ±`meleePitch` | vertical band `[feet − down, head + up]` scaled by size class | LOS chest→target centre |
  | Self area | nova, aura, vortex, orbit, trail | centred on the body | cylinder of height `areaHeight` × body | LOS centre→target (flag) |
  | Placed area | trap | T on its surface layer | cylinder | deck separates layers |
  | Self / global | buff, weather | none | — | — |

- Anatomy: muzzle, melee band and area height come from the size class (`rules.size.classes`), with overrides per species
  in `profiles.ts`. No per-sprite guesswork in the sim.
- **Rejected:** one targeting rule for all (it loses move identity); per-move hand tuning (too many moves; archetype data is
  the existing pattern).

### D9. Device-specific assistance
- **Evidence:** claim 3.
- **Selected:** `rules.aim.assist[device] = { magnetDeg, meleeMagnetDeg, lead, needLos }`. Defaults: `mouse`
  `{0, 8, false, true}` (what you aim at is what you hit; a little melee forgiveness), `stick` `{6, 20, true, true}`,
  `touch` `{10, 28, true, true}`. Legacy (no `aim`, or the bot) keeps `combat.magnetDeg` and `meleeMagnetDeg`. Assistance
  only ever **bends toward an enemy the muzzle can see**. The modes `'assist'` and `'auto'` keep their meaning.
- **Rejected:** removing magnetism outright (gamepad aiming without it is poor); hidden constant magnetism (the current
  problem).

### D10. Camera pitch ownership
- **Evidence:** claim 6.
- **Selected:** under `CHASE_CONFIG.aimPitch` (render), view pitch = `userPitch` as an absolute angle, clamped to
  `[-55°, +45°]` (up, down). State tilt, slope tilt and lift move the **boom** (lens position and elevation) and the
  framing offset, not the view direction. Explore, Combat and Pressure still change boom and FOV. The fixed views are
  unchanged.
- **Rejected:** keeping additive auto tilt (the aim moves without input); a full free camera with no framing (it loses the
  camera composition the brief says to keep).
- **Consequences:** camstats metrics `*PitchTravel` change by design. The `chase.test.ts` "pitch input is clamped to the
  player band" test is updated on purpose, and the `camstability` pins for collision and smoothing must still pass.
- **As landed (Phase 4A, §16):** the flag is `CHASE_CONFIG.aimPitch` `{ on, neutral: 6, up: 60, down: 50 }`. The bounds came
  from measurement (§16.3), not from D10's `[-55°, +45°]`. `userPitch` stays an offset, now around `neutral` instead of the
  state's tilt, and `lookPitchRange()` gives the band in force. The boom elevation keeps its pre-4A rule (state elevation +
  `userPitch`, within `elevation`, plus the climb), so zero-input lens placement is bit-identical in every state. No
  "framing offset" was added. Combat and Pressure now look at the neutral 6° instead of 7.5° and 10°.

### D11. Replay and checksum compatibility
- **Selected:** §6.

### D12. Performance and rollout
- **Evidence:** pool sizes (3000 projectiles, 400 zones, `rules.enemy.cap`); `sight` costs L/0.5 samples.
- **Selected:** tile DDA (one or two tiles per shot per tick at current speeds) plus the existing `grid.query` for actors.
  One camera trace and one muzzle trace per tick. Beams: one trace per cast. Every stage that touches the sim runs
  `npx tsx scripts/perf-sim.ts 500 --repeat 3 --gate`. Rollout: flags default **off** until 7B flips them together and
  migrates the baselines.

### Shared contracts (what the stages agree on)
| Contract | Owner (stage) | Shape | Readers |
|---|---|---|---|
| `ViewSample` | render, 2A (**landed**, §11.2) | `ChaseRig.sample(width, height) → Readonly<{ eye, dir (unit), yaw, viewPitch, userPitch, fov, width, height, aspect, reticleY }>` (frozen), once per host frame after `ChaseRig.look`; `chaseAim` takes it | host `runFrame` / `sampleInput`, capture `advance`; the renderer draws the rig it was copied from |
| `InputFrame.aim` | sim types, 2B (**landed**, Phase 2B §13.4) | `AimRay { ox, oy, oz, dx, dy, dz }` each `Math.fround` (`aimRayOf(view)` in `render/hostframe.ts`); absent = legacy | `sim/aim.ts` under `rules.aim.spatial`; recorded in replays |
| Beam resolution | 5B (**landed for beams**, Phase 2C §14.4) | `moves.ts` `beam3D`: `resolveSpatial` (reach = `beamLength`), core `raycastWorld` (`rules.aim.beamWorldRadius`), width `sweep` (enemies, bodies; spawn guard included), `coreSees` per contact, pierce counted on what it touches; `beam` event `{x1, y1, z1, x2, y2, z2, width, why, kind, hits}` | renderer ribbon and end puff; tests |
| Attack cover policy | Phase 2C (§14.3) | `QF.foliage` in `spatial.ts` (tiles owned by a prop whose material has `blocksShots: false` are open above their ground); `aim.ts` `combatFlags(ctx)` (`rules.aim.foliageCover` false → `QF.foliage`) | camera trace, muzzle, linear shots, beams, `aimbot` |
| `InputFrame.aimDev` | 2B (**landed**, Phase 2B) | `'mouse' \| 'stick' \| 'touch'` (the host sends mouse or stick; nothing sends touch yet) | D9 assistance (5A); no reader yet |
| `InputFrame.jumpPressed` | 2C (**landed**, R6c §22) | `boolean` rising edge (from `Input.jumpLatch`, pad edges latched every frame by `Input.pollPad`); `jump` stays "held". No `jumpEdge` flag: the field's presence is the switch (absent = the legacy held rule), as `press` is for fire | `sim/locomotion.ts` `jumpControl` (`rules.player.jumpBuffer`, `coyote`) |
| `InputFrame.my` | R6c (**landed**, §22) | vertical intent, ascend − descend in −1..1 from buttons only (ascend = Jump held, descend = the `descend` action); absent = 0 | none before R6d (`stepVolume`) |
| `spatial.raycast / sweep` | 3 (**landed**, §12.3) | `raycastWorld` → `RayHit` (first world contact); `sweep` / `sweepTo` → `Contacts` (ordered, struct of arrays: `t, x, y, z, nx, ny, nz, kind, id, flags`, `stop`, `stopT`); `overlapCylinder`, `overlapSector`; `segmentClear`, `solidAt`; `SpatialQuery` `{ mask, block, pierce, worldR/H, actorR/H, selfKind/Id, bodyTeams, flags }` | 4A, 4B, 5B, 5C, 6C, 7A; reticle (world-only calls) |
| `ResolvedAim` (replaces the module-level `AIM`) | 4A | as landed (Phase 2B): `AimState` (`sim/types.ts`): muzzle `o*`, aim point `t*`, `hitKind/hitId`, unit `u*`, `blocked` + point and kind, `reach`, `dist`. `moves.ts` keeps `AIM` (planar view) beside a module `A3`; `ctx.aim` is the per-tick copy for presentation | direct shots; `ctx.aim`: HUD and marker |
| Muzzle and anatomy | 4A (data) | as landed (Phase 2B): fractions of the class body, `rules.aim.muzzle {up: 0.6, fwd: 0.9}` (× class height, × footprint), overrides per archetype or move key in `rules.aim.muzzleBy`; no per-species override yet. Melee bands and `areaHeight`: 5C | `sim/aim.ts`; 5B, 5C |
| `MOVE_FAMILY` table | 4B (data) | not built yet: Phase 2B uses the list `rules.aim.archetypes` (`['bolt', 'orb']`) | moves |
| Rules flags | each stage | `aim.spatial` (**landed**, Phase 2B: it covers both `aim.ray` and `aim.trajectory3d`, default on, effective only with a ray in the input), `aim.archetypes` + `'beam'`, `aim.beamWorldRadius`, `aim.foliageCover` (**landed**, Phase 2C), `aim.assist`, `combat.fireBuffer`, `player.jumpBuffer` / `player.coyote` (R6c; no `jumpEdge` flag, the edge field's presence switches), `locomotion.facing`, `size.headroom`, `CHASE_CONFIG.aimPitch` (render; **landed**, Phase 4A §16: `{on, neutral, up, down}`, `lookPitchRange()`) | `scripts/checksum.ts` sets |
| Fire acceptance | 2C (**landed for fire**, Phase 3 §15.3) | `InputFrame.press` (rising edges, BTN bits; absent = none); `MoveSlot.queued` (ctx.tick of the queued press, hashed when set); `rules.combat.fireBuffer` per slot `[0.15, 0, 0, 0]` s | `movesSystem`; `Input.sample` writes it |
| Device assistance | 5A (**planar path**, Phase 3 §15.4) | `rules.aim.deviceAssist`, `rules.aim.assist[mouse\|stick\|touch] = {shotDeg, meleeDeg, lead, los}`; `cast.assist` (enemy id) | `resolveAim`; renderer ring |
| Events | 2C, 4A | as landed for 2C (Phase 3): `fireQueued {slot, wait}`, `fireDropped {slot, why: early \| queued \| cancel \| expired, wait}`, `windup.queued`; as landed for 4A (Phase 2B): `cast.o {o, t, kind, blocked}` (optional) and `shotEnd {why, kind, x, y, z, element}` in place of `shotBlocked` | render |

---

## 5. Roadmap

Status: ☐ not started · ◐ in progress · ☑ done. The column `Hash` says whether the `on` checksum set may move **with the
stage's flag on** (with it off, every set must match).

| Stage | Title | Depends on | Hash | Status |
|---|---|---|---|---|
| 0 | Evidence, decisions, plan (this file) | — | no | ☑ |
| 1 | Characterisation harness and host-order seam | 0 | no | ◐ (seam and host-order tests landed in Phase 1; R-claim todo cases and `tp-human` fixture open) |
| 2A | One view-sampling contract (`ChaseRig.look` + `sample`) | 1 | no (render) | ☑ (Phase 1) |
| 2B | `InputFrame.aim` / `aimDev` schema and adapter (sim ignores it) | 1 | no | ☑ (Phase 2B; the sim reads it at once, see 4A) |
| 2C | Input acceptance: jump edge and latch, fire buffer | 1 | flag on: yes | ☑ (Phase 3: fire buffer and press edges; R6c §22: jump edge, buffer, coyote. No hash moved: only explicit `press` / `jumpPressed` input uses them) |
| 3 | `src/sim/spatial.ts` raycast and ordered sweep (no consumers) | 1 | no | ☑ (Phase 2A, §12) |
| 4A | Sim-owned camera trace, muzzle, convergence; linear shots launch in 3D | 2A, 2B, 3 | flag on: yes | ◐ (Phase 2B: bolt and orb; the bot sends no ray, so no `on` hash moved) |
| 4B | Independent 3D trajectories, swept ordered contacts, guidance exceptions | 4A | flag on: yes | ◐ (Phase 2B: linear only; barrage, lob, homing, drain, boomerang, orbit open) |
| 5A | Device assistance policies (magnetism, lead, LOS) | 4A | flag on: no (bot has no `aim`) | ◐ (Phase 2B: the spatial path has none for any device; Phase 3: per-device policies on the planar path, `rules.aim.assist`; spatial-path pad assistance open) |
| 5B | Beam and chain in 3D with cover | 3, 4A | flag on: yes | ◐ (Phase 2C: beams; chain open) |
| 5C | Melee and area verticality and cover (anatomical bands) | 3, 4A | flag on: yes | ☐ |
| 6A | Player-owned camera pitch, wider range | 2A | no (render) | ☑ (Phase 4A, §16; full ±89° envelope in R3, §19) |
| 6B | Shooter facing and strafing; exploration mode | 2B, 4A | flag on: no (bot) | ☐ |
| 6C | Headroom: ceilings for bodies, size gate under decks | 3 | flag on: yes | ☑ (R1, §17: bodies, jumps, wide routing, spawn gate. The camera half of F5 is split off as its own open item, §17.7; enemy fliers go with 7A) |
| 7A | Enemy and bot parity (enemies on `spatial`; bot sends `aim`) | 4B, 5B, 5C | yes | ☐ |
| 7B | Default flip, baseline migration, legacy retirement | all | yes (one migration) | ☐ |

Parallel tracks after Stage 1: {2A → 6A}, {2B}, {2C}, {3 → 6C}. They join at 4A. 5A, 5B, 5C and 6B can run in parallel
after 4A.

Changes from the requested sequence: 6C (ceilings) depends only on 3 and can start early, because it fixes a reproduced
bug. 2C has no dependency on the aim contract. Stage 1 also extracts the host's sample-and-step order into a pure module,
because claim 10 shows no stage can be verified without it.

### Stage 0: evidence and plan
- **Objective:** verify the prior claims, decide the architecture, write this plan. **Scope:** docs only. **Risk:** none.
- **Gates:** typecheck and `npm test` unchanged (374/374); `scripts/checksum.ts` unchanged (§6.3). **Status:** done.

### Stage 1: characterisation harness and host-order seam
- **Objective:** make every **R** claim a test, and make host ordering testable.
- **Scope:** `tests/thirdperson.test.ts` with one case per **R** row, marked `{ todo: 'Stage X' }`. A pure
  `src/render/hostframe.ts` (or `src/host/`): `sampleFrame(input-like, rig, ctx) → InputFrame[]` and
  `runFrame(…)`, holding today's order and called by `main.ts`. A recorded human-input fixture
  `tests/fixtures/tp-inputs.json` (aim, taps, jumps), plus a checksum set `tp-human` that replays it.
- **Prerequisites:** none. **Risk:** low (refactor of the host only; `main.ts` behaviour must stay identical).
- **Tests:** the todo cases fail for the reasons in §3. Existing camstability and combat tests pass unchanged.
- **Gates:** `npm run check`; every checksum set unchanged; `tools/cap.mjs … tools/chasecheck.json` frames identical.
- **Deferrals:** no behaviour fixes.

### Stage 2A: one view-sampling contract
- **Objective:** the aim the sim receives equals the crosshair drawn that frame.
- **Scope:** `ChaseRig.viewAt`; `Renderer.look` applies pitch at once; `sampleFrame` samples once per frame after look;
  rewrite the `camstability` "rapid direction changes" test to the host order.
- **Risk:** low and render-only. Watch the camstats `fpsDev` and `JumpMax` values.
- **Tests:** claim-2 cases go from todo to pass (error < 0.05 m at 17°, 90°, 126°, 180° and for a 10° pitch).
- **Gates:** `npx tsx scripts/camstats.ts` within 5 % of the "Stability, second pass" table in `docs/THIRD_PERSON.md`;
  checksums unchanged.
- **Deferrals:** the planar aim is still what reaches the sim.

### Stage 2B: aim-ray schema
- **Objective:** a serialised camera ray and device in `InputFrame`. **Scope:** `types.ts` fields, the host adapter (chase
  sets `aim` and `aimDev`, and keeps setting `aimX/aimZ`), `Math.fround` quantisation, and fixture recording.
- **Risk:** low. **Tests:** round-trip serialisation; "determinism holds with aim and buttons in the input" extended with
  `aim`. **Gates:** all checksum sets unchanged (the sim ignores `aim`).

### Stage 2C: input acceptance
- **Objective:** no lost jump taps, no auto-repeat jumps, buffered fire. **Scope:** `Input.jumpLatch`, `jumpPressed`;
  `rules.player.jumpEdge`, `jumpBuffer`, `coyote`; `rules.combat.fireBuffer`; the `fireBuffered` and `fireDropped` events.
- **Risk:** medium (feel and bot hashes). **Tests:** claim 8a and 8b cases pass; buffered press fires exactly once; a held
  button still repeats on cooldown; "a press only during the cooldown is dropped (no buffer)" still passes with
  `fireBuffer: 0`, and a new twin asserts buffering with the default.
- **Gates:** with flags off, all sets unchanged; with flags on, record new `on` hashes in the PR.
- **Deferrals:** gamepad edge latching (pads are polled; frame-length taps are rare): note it, measure it later.

### Stage 3: spatial queries
- **Objective:** an exact, ordered, allocation-free raycast and sweep. **Scope:** `src/sim/spatial.ts`, unit tests on
  synthetic maps and generated location maps (decks, chasms, stairs, wall columns, cylinders).
- **Risk:** low (no consumers). **Tests:** agrees with `World.sight` on 10 000 random segments where both apply (it
  disagrees only where sampling misses a corner, and those cases are listed); ordered contacts; costs measured.
- **Gates:** `npm run check`; checksums unchanged; micro-benchmark below 2 µs per average shot segment.

### Stage 4A: sim-owned aim, muzzle, convergence
- **Objective:** D3. **Scope:** `resolveAim3D` used when `ctx.input.aim` is present and `rules.aim.ray` is on. Muzzle data
  in `rules.size`. Linear shots launch with `vy`. The reticle's blocked state.
- **Risk:** medium. **Tests:** a shot at a flier hovering 4 m up hits it; a wall between muzzle and T stops the shot at the
  wall; the crosshair on a deck edge puts T on the deck; with the shoulder offset, the shot lands within 0.3 m of the
  crosshair hit at 8, 16 and 26 m.
- **Gates:** with the flag off, everything unchanged; the `tp-human` set moves (document the new hash).
- **Deferrals:** trajectories other than linear (4B); assistance (5A).

### Stage 4B: independent trajectories and ordered contacts
- **Objective:** D5 and N1/N2. **Scope:** `effects.ts` player shots use the sweep; the trajectory table; the 3D steering
  of homing; the ballistic lob; remove the `P.y + 0.8` tracking under the flag.
- **Risk:** high (balance; every projectile archetype). **Tests:** the claim-4 case passes; pierce hits in contact order;
  no tunnelling at the fastest move speed against Tiny; homing, boomerang and orbit exceptions are explicit.
- **Gates:** `perf-sim --gate`; bot kills, level and survival in `scripts/checksum.ts` output and `scripts/locsurvival.ts` within ±10 % of the
  Phase 0 numbers with the flag on (the band is an assumption: set it in Stage 1); `habplay` and `hazplay` pass.

### Stage 5A: assistance policies
- **Scope:** D9. **Tests:** the claim-3 cases: mouse = no bend at 6.3° and no lead; stick bends only toward visible enemies.
  **Gates:** checksums unchanged (the bot has no `aim`).

### Stage 5B: beam and chain
- **Scope:** D8 rows Beam and Chain on `spatial`. **Tests:** a beam stops at a wall and hits two enemies in order; a chain
  does not hop through a wall or up 3 m to a deck. **Gates:** flag off unchanged; the balance band from 4B.

### Stage 5C: melee and area
- **Scope:** D8 rows Contact melee, Self area and Placed area. **Tests:** a strike misses an enemy on the deck above, and an
  XL strike reaches farther vertically than a Tiny one; a nova does not reach through a wall column (with the flag);
  Guard, Push and Hold tests in `tests/caps.test.ts` still pass. **Gates:** as 5B.

### Stage 6A: player-owned pitch
- **Scope:** D10 (render). **Tests:** a Pressure state change does not move the view direction; the upward limit is
  ≥ 45°; the camstability collision pins still pass. **Gates:** camstats; `chasecheck` captures reviewed by a person.

### Stage 6B: shooter facing
- **Scope:** D7. **Tests:** in stance, facing follows the aim while moving sideways; out of stance it follows movement;
  `holdAim` and the idle dash use the aim facing. **Gates:** checksums unchanged (bot); manual feel test (§9).

### Stage 6C: headroom
- **Scope:** D4 ceiling paragraph, plus the `navblocks` height gate (read `docs/SIZING.md` first). **Tests:** the
  claim-8c cases (heads never above the underside); an XL body cannot walk under a deck lower than its height;
  `navwalk all 5` still reaches every mandatory space. **Gates:** `stuckwatch all 3`; the habitat gates
  (`habstate`, `habplay all 6 1 --raid`, `hazplay`), because decks and causeways are on habitat maps; a `LOC_VERSION` or
  `HAB_VERSION` bump only if a generator changes (it should not).

### Stage 7A: enemy and bot parity
- **Scope:** enemy melee and ranged use `spatial` (flag); the bot sends an `aim` ray (from its target) so that hashes cover
  the new path. **Risk:** high (every hash moves). **Gates:** one documented migration of the `on` and `gen` sets;
  the balance band from 4B.

### Stage 7B: default flip and legacy retirement
- **Scope:** turn the flags on by default. Older checksum sets turn the new flags off (the established pattern). Retire
  code only where no set needs it. Update `docs/THIRD_PERSON.md`, `docs/SIZING.md`, `docs/SYSTEMIC.md` and the README.
- **Gates:** `npm run check`; every older set reproduces its recorded hashes; the full manual checklist (§9).

---

## 6. Regression and replay migration policy

### 6.1 Rules
1. Each stage adds a rules flag whose off value is today's behaviour. Hashes with the flag off must equal the previous
   stage's exactly: run `npx tsx scripts/checksum.ts` (all sets) before and after, and diff the two outputs.
2. A stage that moves hashes with its flag on records the new `on` hashes in its PR and in §6.3, with the reason.
3. When 7B flips the defaults, every older set in `scripts/checksum.ts` (`off`, `build-off`, … `gen-size-off`) adds the
   new flags turned **off**, so each older set still prints its recorded hashes. Add a new set `tp-off` that equals the
   pre-flip `on`.
4. The bot does not cover manual paths (N3). Stage 1 adds `tp-human`, a fixed recorded `InputFrame[]` that includes `aim`,
   taps, jumps and buffered presses. It moves only when a stage says so.
5. Never adjust a hash by editing the expected value without one of the reasons above.

### 6.2 Tests that pin current behaviour and will change on purpose
| Test | File | Stage | Why |
|---|---|---|---|
| "primary fire: a press only during the cooldown is dropped (no buffer)" | `tests/combat.test.ts` | 2C | **done (Phase 3)**: renamed "…(fireBuffer 0, or a press far from ready)", sends a real `press`, runs with `fireBuffer` 0 and the default; `tests/primaryfire.test.ts` covers the buffer |
| "rapid direction changes: the move direction and the aim follow the camera on the very frame it turns" | `tests/camstability.test.ts` | 2A | rewritten to the host order |
| "pitch input is clamped to the player band" | `tests/chase.test.ts` | 6A | **done (Phase 4A)**: asserts the absolute envelope and keeps the legacy window under `aimPitch.on = false` |
| "slopes: the view tilts up towards a rise and down over a drop, then settles" | `tests/chase.test.ts` | 6A | **done (Phase 4A)**: owned, the slope never tilts the view; the legacy assertions run with `aimPitch.on = false` |
| "shoulder swaps, camera collision and species sizes …" (walk with look input) | `tests/viewsample.test.ts` | 6A | **done (Phase 4A)**: its pitch gesture integrates to ±25°. It is now kept inside the pre-4A window it was written for, so the walk follows its old lens path. With the full envelope the run reaches a pre-existing safety-net slide (0.69 m, §16.6), which `camstats --sweep` measures instead |
| "aim: 4..26 m from the Pokémon, along the camera yaw with no shoulder", "aim: with the lens on a shoulder the shot converges on the crosshair", "aim stops at a hill in front instead of going through it" | `tests/chase.test.ts` | 4A | `chaseAim` becomes the fixed-view and reticle fallback; equivalent 3D tests are added |
| "decks in the sim: height and collision follow the walker’s level; a jump from beneath never reaches the deck" | `tests/locations.test.ts` | 6C | **done (R1)**: renamed "…, and the head stops at the slab", asserts head ≤ underside; jumps stop at tick 120 because a capped jump lands sooner |

### 6.3 Baseline recorded at Phase 0 (2026-11-16, commit 7bb4010)
`npx tsx scripts/checksum.ts on` end hashes: cyndaquil 2 classic `632d7d25` · totodile 7 classic `17978323` · bulbasaur 3
survival `93ae9839` · charmander 11 boss-rush `53516479`. `gen`: `bc465079` · `72710e43` · `99231ed1` · `c7cd3318`.
(For the full output, rerun the command at this commit.)

Phase 2B (2026-11-16) added two sets (§13.8). `aim-off` sends the `aim` rays with `rules.aim.spatial` off and prints the `on`
hashes exactly. `aim` (the bot plus a chase crosshair ray from `scripts/lib/aimbot.ts`) end hashes: cyndaquil 2 classic
`2ba2a20b` · totodile 7 classic `d5309999` · bulbasaur 3 survival `93ae9839` (Vine Whip: no direct shot, equal to `on`) ·
charmander 11 boss-rush `9fa3e1f0`. Every earlier set is byte-identical to the Phase 0 baseline.

Phase 2C (2026-11-16) moved `aim` on purpose (§14.7): spatial beams, and foliage open to every spatial attack trace (the aimbot
follows the same cover rule). New `aim` end hashes: cyndaquil 2 classic `54ea9ecd` (lvl 9, 251 kills: Ember only, so this
is the foliage rule) · totodile 7 classic `484352c4` (lvl 24) · bulbasaur 3 survival `b46d7072` (Solar Beam from tick ~7200) ·
charmander 11 boss-rush `615644dd`. Single replays reshuffle which seeds die (§14.7 has the sweep). New set `aim-2b` (beams
planar, foliage as cover) prints the Phase 2B `aim` hashes above exactly; every other set is byte-identical to before.

R1 headroom (2026-11-16) moved `gen` on purpose (§17.4): bulbasaur 3 survival `99231ed1` → `bd080f0c` (lvl 6, 105 kills),
charmander 11 boss-rush `c7cd3318` → `7708b606` (lvl 18, 670 kills); cyndaquil 2 and totodile 7 unchanged. New set
`gen-headroom-off` prints the earlier `gen` hashes exactly. Every older set adds `size.headroom: false`; it and every other
set (`on`, `aim`, `aim-off`, …) are byte-identical to before.

R2 pole-safe aim maths (2026-11-16) moved `aim` on purpose (§18.4): totodile 7 classic `484352c4` → `d5109b20` (lvl 4, 64
kills), charmander 11 boss-rush `615644dd` → `4038091c` (lvl 12, 227 kills); cyndaquil 2 and bulbasaur 3 unchanged. Each
moves first at a multi-shot bolt cast at a pitch. New set `aim-pole-off` prints the earlier `aim` hashes exactly; `aim-2b`
adds `aim.poleSafe: false`; every other set is byte-identical to before.

---

## 7. Validation commands and reproduction matrix

### 7.1 Commands
| When | Command |
|---|---|
| Every stage | `npm run check` (typecheck, tests, build; writes `dist/`. In a shared checkout, build screenshots into a private directory, see `CLAUDE.md`) |
| Sim stages | `npx tsx scripts/checksum.ts` (all sets, diff before and after) |
| Sim stages | `npx tsx scripts/perf-sim.ts 500 --repeat 3 --gate` |
| Camera stages (2A, 6A) | `npx tsx scripts/camstats.ts` and `--fps 30,144`; `node tools/cap.mjs <html> tools/chasecheck.json <out>` (needs `npm i --no-save playwright`) |
| Movement and collision (6B, 6C) | `npx tsx scripts/navwalk.ts all 5`, `npx tsx scripts/stuckwatch.ts all 3` |
| Decks, habitats (4B, 5x, 6C) | `npx tsx scripts/habstate.ts`, `npx tsx scripts/habplay.ts all 6 1 --raid`, `npx tsx scripts/hazplay.ts` |
| One suite | `npx tsx --test tests/thirdperson.test.ts` (from Stage 1) |

### 7.2 Reproduction matrix (each becomes a Stage 1 case)
| Case | Setup | Today (R) | Pass condition | Fixed by |
|---|---|---|---|---|
| stale-yaw | `ChaseRig` settled on flat ground; turn 90°/180°; aim before vs after `update` | 5.85 / 8.07 m | < 0.05 m | 2A ☑ (0.000 m, `tests/viewsample.test.ts`) |
| stale-pitch | same, 10° pitch | 6.48 m | < 0.05 m | 2A ☑ (0.000 m) |
| pitch-up | `lookPitch` −∞ | 8° above horizon | ≥ 45° | 6A ☑ (60°, `tests/freelook.test.ts`) |
| auto-tilt | Pressure threat, no input | view pitch 6° → 10° | Δ < 0.1° | 6A ☑ (< 1e-6° through state, slope, climb, jump, shake) |
| magnet-mouse | enemy 6.3° off a due-north aim, `aimDev: 'mouse'` | shot at 6.3° | shot at 0° ± 0.1° | Phase 2B ☑ (spatial path, any device: `tests/aim3d.test.ts`) |
| lead-mouse | aim at a strafing enemy | +1.84° | 0° | Phase 2B ☑ (spatial path) |
| shot-height | authored map, shoot then jump | shot y follows the player (+1.58 m) | shot y constant (linear, no gravity) | Phase 2B ☑ (legacy re-measured: +1.75 m) |
| shot-up | flier hovering 4 m up, crosshair on it | misses (no `vy`) | hits | Phase 2B ☑ |
| jump-tap | stubbed `Input`, Space down+up before a sample | `jump: false` | `jumpPressed: true` | R6c ☑ (`tests/controls.test.ts`; sim side `tests/jumpcontrol.test.ts`) |
| jump-hold | hold 300 ticks | 8 jumps | 1 jump | R6c ☑ (legacy input still 8: `tests/jumpcontrol.test.ts`) |
| head-ceiling | Chargestone Cave seed 3, jump under a deck | Feraligatr head +1.60 m | ≤ 0 | 6C ☑ (R1: ≤ +0.001 m, `tests/headroom.test.ts`, `tests/locations.test.ts`) |
| xl-under-deck | Onix standing under a 3.0 m deck | head +0.19 m | the tile is blocked for that body | 6C ☑ (R1: it stops at the deck's edge and its wide field leaves the gap out) |
| fire-buffer | press 0.1 s before the cooldown ends, release | dropped | one cast at ready | Phase 3 ☑ (`tests/primaryfire.test.ts`; 1–9 ticks before ready) |
| beam-wall | beam through a wall column at an enemy | hits (code) | stops at the wall | Phase 2C ☑ (spatial path: `tests/beam3d.test.ts`) |
| beam-height | enemy on a 4 m plateau, no line of sight from the muzzle | damaged (**R**, Phase 2C) | no damage, the beam ends on the cliff | Phase 2C ☑ |
| strike-deck | enemy on the deck above, strike from below | hits (code) | misses | 5C |
| pierce-order | two enemies on the line, pierce 0 | first in grid order | the nearer one | Phase 2B ☑ (3D shots; the planar shot keeps grid order until 7B) |
| close-reticle | right shoulder, rubble 2.5 m ahead under the crosshair | `chaseAim` point ≥ 4 m out, ~0.35 m beside the line: miss | hit | Phase 2B ☑ (spatial path) |

---

## 8. Unresolved questions and blockers

| # | Question | Assumption used | Who decides |
|---|---|---|---|
| Q1 | Should a press during cooldown be buffered? The current test says no on purpose | Phase 3: yes, 0.15 s for the basic attack only (`fireBuffer` `[0.15, 0, 0, 0]`; 0 restores the old rule) | product owner after a playtest |
| Q2 | Mouse magnetism: zero, or a small amount for feel? | 0° for shots, 8° for melee. Phase 2B: 0° and no lead for direct shots on the spatial path for **every** device (the brief's policy); pad and touch assistance return only as explicit Stage 5A policies | product owner after a playtest |
| Q7 | On classic (authored) arenas, legacy player shots pass through wall tiles and ignore height; spatial shots stop on both (§13.9). Keep that? | Yes: it is the 3D model the plan adopts (D4) | product owner after a playtest |
| Q3 | Can players shoot over low props (bushes, rocks)? It needs prop heights in `spatial` | Low props are terrain of their platform height (a ray passes over them). Wall tiles stay infinite-height columns: a tree's whole 2 × 2 footprint, canopy included, is cover to any height (Phase 2C: foliage props are open, tree crowns are not, §14.8) | resolved by R1b (§23): a wall prop is solid to its measured top for the player's attack traces |
| Q8 | Foliage (bushes, hedges, berry bushes, mushrooms: `blocksShots: false`) is open to player attacks on the spatial path; enemy fire (`World.sight`, `shootHostile`) still treats it as cover | Yes for the player (the authored material rule); enemy parity in Stage 7A | product owner after a playtest |
| Q10 | A beam aimed down at a near target now ends on the ground behind it (its line meets the terrain); to rake a whole line the player aims level. 78 % of aimbot beams on generated maps end on the world (§14.7). Keep, or let beams hug the ground past the aim point? | Keep (it is what the crosshair says) | product owner after a playtest |
| Q9 | Retire the planar player attacks (traj 0 shots, the 2D beam) once nothing but old checksum sets reaches them? | Yes in 7B (§14.9); the older sets keep their recorded hashes by turning the spatial flags off, so the code stays until those sets are frozen or dropped | product owner (which historical sets to keep) |
| Q11 | Free look keeps the lens placement, so a Pressure state still raises the lens, and the crosshair ray rises with it (parallel): 15 m ahead +0.87 m for Cyndaquil, +1.52 m for Feraligatr, with no input (§16.5). The old tilt turned it down instead. Keep the lens rise, or move the state's framing along the aim ray (boom length only) so that the ray stays put? | Keep. It is the brief's "preserve zero-input placement", and the direction is the player's. The alternative changes the Combat and Pressure composition (the lens 0.4–0.9 m lower) | product owner after a playtest |
| Q12 | Pitch envelope: 60° up and 50° down (measured, §16.3) instead of the ±75° first proposed. Past ~33° up the Pokémon is off-screen; 50° down puts the crosshair at its feet | 60 / 50; `CHASE_CONFIG.aimPitch.up / down` | playtest (mouse and pad) |
| Q4 | Do fliers get vertical movement control (ascend and descend), or only glide? | Glide only (unchanged) | product owner; outside this plan |
| Q5 | Strafe animation with 8-direction PMD sheets: is backwards and sideways playback acceptable? | Yes for v1 | manual test (§9) |
| Q6 | Do the new flags apply to the overworld slice (`src/overworld/`)? | No: it has its own loop | — |

No blockers for Stage 1.

---

## 9. Outstanding risks and manual tests

**Risks:** balance shifts when cover and height start to matter (4B, 5B, 5C): mitigated by flags and the bot balance band (4B).
Habitat Hold maps rely on causeways and decks (6C height gate versus navigation): run the habitat gates. Feel of strafing
with billboard sprites (6B). Performance of sweeps in 500-enemy swarms (gate every stage). Two sessions editing
`main.ts`: Stage 1's extraction should land quickly and on its own.

**Manual checklist** (nobody has played the current build with a mouse or a gamepad, see `docs/THIRD_PERSON.md`):
1. Flick 180° and fire at once: the shot goes where the crosshair is (mouse and pad).
2. Aim up at a flier and down from a ledge: shots travel to the crosshair.
3. Fire across the edge of a deck or over a cliff lip: the reticle shows "blocked" exactly when the shot will hit cover.
4. Tap Jump quickly 20 times: 20 jumps. Hold Jump: one jump (fliers glide).
5. Jump under a deck with an XL partner: the head never enters the slab.
6. Mash primary fire during the cooldown: exactly one buffered shot, no lost or double shots.
7. Strafe around an enemy while firing: the Pokémon faces the aim and never snaps to the movement direction.
8. Explore with no hostiles: the Pokémon faces the way it walks.
9. A beam at an enemy behind a pillar: blocked (Phase 2C: the beam is drawn ending on the pillar). A beam past a hedge: it
   reaches the enemy. A strike at an enemy on the deck above: misses.
10. Real GPU, 60 and 144 Hz: no change in feel of the camera collision from the camstats baseline.
11. (Phase 4A) Walk into a fight and stand still: the crosshair must not tilt when the camera enters Combat or Pressure. Note
    whether the lens rise in Pressure (the ray moves up with it, Q11) reads as the aim drifting.
12. (Phase 4A) Aim at an enemy on a ledge or deck above and at one below a rim, with the mouse and with the stick. Does the
    60° / 50° envelope reach every target you want? Is the sky-only view at the top limit disorienting (Q12)?
13. (Phase 4A) Walk up and down Mt. Moon's ramps and stand with a wall behind (the boom climbs). The view must keep its pitch;
    check whether the lost auto-tilt makes slopes harder to read.

---

## 10. Handoff

- **Phase 0 status:** PASSED. All ten prior claims were checked: eight reproduced at runtime, two (5 and 10) verified in
  code. The architecture is decided (D1–D12). The roadmap is staged with gates. Typecheck is clean, `npm test` passes
  374/374, and checksums were recorded (§6.3). No gameplay code changed.
- **Next:** Stage 1. Start with the host-order seam (it unblocks 2A and 2B), then `tests/thirdperson.test.ts` from §7.2.
- **Phase 1 status (2026-11-16):** PASSED. The host-order seam and Stage 2A landed (§11): the defect of claim 2 is fixed,
  with regression tests that fail on the old order. Next: Stage 1's remaining todo cases and `tp-human` fixture, then 2B
  (§11.5). Open: F5 (camera collapse under decks with XL bodies, Stage 6C).
- **Phase 2A status (2026-11-16):** PASSED. Stage 3 landed (§12): `src/sim/spatial.ts` with ordered contacts, explicit
  obstruction, penetration and filter policies, exact against dense sampling on 10 000 generated-map segments and against
  a brute-force pass in a 333-enemy live run; every checksum set unchanged; `perf-sim` gate unchanged; the shot-tick sweep
  0.40–1.01 µs (gate 2 µs) with no collection. Four `todo` tests pin the defects it found in existing code (N1, N2, I1, I2)
  for Stages 4B and 7A. Next: Stage 1's remaining cases, then 2B and 4A (§12.7). (Phase 2B took N1 and N2 for its 3D shots
  and Stages 2B/4A for the direct shots; I1 and I2 stay with 7A.)
- **Phase 2B status (2026-11-16):** PASSED. The chase crosshair ray is input (`InputFrame.aim`); the sim traces it and fires
  bolt and orb shots from a size-class muzzle in 3D, on swept, ordered contacts, with no magnetism or lead (§13). Every
  earlier checksum set unchanged; new `aim` / `aim-off` sets; 434 tests (432 pass, 2 todo: I1 and I2, owner 7A). Next: the
  other move families (§13.10), Stage 1's `tp-human` fixture, a mouse and gamepad playtest (§9 items 1-3).
- **Phase 2C status (2026-11-16):** PASSED. Every beam cast through the chase crosshair leaves the size-class muzzle along
  the spatial aim, stops on the first wall, rise, slab or cliff its core meets, touches only bodies its core can see within
  its width, in contact order, and is drawn exactly from the muzzle to that end (§14). Foliage is no longer cover for any
  spatial attack trace (the authored `blocksShots` rule). Every earlier checksum set unchanged; `aim` moved on purpose and
  `aim-2b` reproduces Phase 2B; 453 tests (451 pass, 2 todo: I1 and I2, owner 7A). Next: chain (rest of 5B), 5A, the
  `tp-human` fixture, a mouse and gamepad playtest (§9 items 1-3 and 9).
- **Phase 3 status (2026-11-16):** PASSED. Primary fire has explicit press, accept, wind-up, release and cooldown semantics: a
  press reaches the sim even between samples (`InputFrame.press`), a press up to 0.15 s before ready casts once on the ready
  tick, earlier ones are dropped with an event, holding repeats on the cadence, releasing starts nothing new, Tag and the egg
  cancel, cinematics expire (§15). Mouse aim on the planar families is direct; the stick and touch bend only toward a
  visible enemy, marked by a ring. Every checksum set unchanged. Next: the jump half of 2C, `tp-human`, a playtest (§15.10).
- **Phase 4A status (2026-11-16):** PASSED. Stage 6A landed (§16). The view axis, and so the crosshair ray, turns only with
  look input; the state, slope, climb, jump, shake and shoulder swap move the lens only. The envelope is 60° up and 50° down
  (it was 8° up and ~26° down). Zero-input lens, boom, shoulder and FOV are bit-identical in every state and size. Every
  checksum set is unchanged. 485 tests: 483 pass, 2 todo (I1, I2). Next: a mouse and gamepad playtest (§9 items 11–13,
  Q11, Q12), then 6B (shooter facing).
- **Watch:** `tests/combat.test.ts` pins "no buffer" under `fireBuffer` 0 (Q1). The bot never covers manual paths (N3). The
  `chaseAim` tests in `tests/chase.test.ts` pass in an order the host does not use (claim 10).
- **Files to read first:** `src/main.ts` L198–L210 and L344–L416; `src/render/camera.ts` L282–L315 and L578–L598;
  `src/sim/moves.ts` L280–L326 and L759–L827; `src/sim/effects.ts` L108–L253; `src/sim/player.ts` L155–L197;
  `src/sim/world.ts` L173–L260 and L331–L348.

---

## 11. Phase 1: one authoritative camera-state contract (2026-11-16)

Scope: Stage 2A, plus the host-order seam of Stage 1 that 2A needs to be testable. Render and host only: no file under
`src/sim/` or `src/world/` changed, and no rules flag was needed (§6.1 rule 1 holds trivially: every checksum set is
unchanged).

### 11.1 Verified findings
- **F1, the host-order defect (claim 2), confirmed and located.** `Renderer.look` wrote `rig.yaw` at once but queued pitch
  in `Renderer.lookPitch`; `rig.eye` and `rig.viewPitch` were recomposed only inside `ChaseRig.update`, which runs in
  `Renderer.render` after the sim loop. Every tick of a frame therefore aimed along the new yaw from last frame's lens and
  with last frame's pitch. Re-measured through the real host order (`runFrame` + `ChaseRig` + a real run, Viridian Forest
  seed 1, Cyndaquil; aim the tick used vs the crosshair drawn that frame): 17° 0.81 m · 90° **5.42 m** · 126° 6.94 m ·
  180° 7.61 m · pitch 10° down 5.70 m · 10° up 16.3 m · 90° + 8° 8.95 m. Pressing fire on the turn frame put the press
  tick's aim 9.68 m off. (The prior audit's 6.20 m and Phase 0's 5.85 m are the same defect on other terrain.) A full
  wind-up hid it for the shot itself: the aim is resolved again at release, frames later, after the rig had caught up.
- **F2, pitch also moves the lens (new).** The boom elevation is `cur.pitch + userPitch` inside the 120 Hz tick, so a pitch
  input moved the lens 0.46–0.66 m (10°) only on the next rig tick, while the yaw was already composed at frame time. A
  sample that only re-tilted the axis (the D1 `viewAt` as written) would still have aimed from the old lens height.
- **F3, the seam.** No test could drive the host order (`main.ts` needs the DOM), and the one test of it ran the opposite
  order (claim 10).
- **F4, camera diagnostics framed the wrong size.** `scripts/camstats.ts` and `tests/camstability.test.ts` gave the rig the
  raw idle frame (`frames[0][0].h / 16`); the renderer gives it that frame times the species' visible-size scale
  (`speciesSizing(...).scale`, added with the 2026-11 size classes). Feraligatr: 1.75 m in the diagnostics, 2.71 m in the
  game (XL); Charmander 1.38 → 1.14 m; Pichu 1.38 → 0.78 m; Typhlosion 1.56 → 2.06 m. Projection assumptions agree: the
  crosshair is the screen centre row (`RETICLE_Y = 0.5`), so the aim does not depend on aspect, and the diagnostics use the
  same `chaseFrameFor` probes and `fov`.
- **F5, a pre-existing camera collapse the wrong size hid (open, not caused by this phase).** At the renderer's size,
  Feraligatr on Viridian Forest seed 3 walks under a deck whose underside is 2.40 m above its feet. The rig's pivot (body ×
  0.8 = 2.17 m) is then inside the deck clearance (`lens.ceiling` 0.35 m), every point of the boom reads as blocked, and the
  boom collapses to the near plane (6.58 → 0.05 m, a 5.4 m lens jump in one frame, then 845 safety-net slides over ~12 s).
  It is claim 8c (bodies taller than the deck clearance) seen through the camera. The rig code is unchanged by this phase
  (`camstats --rawsize` is bit-identical to the baseline). Reproduce: `npx tsx scripts/camstats.ts --seeds 3 --stages 0
  --species feraligatr`. Owner: Stage 6C (headroom), which must also decide what the rig does when the pivot is under a
  slab.
- **F6, aim-point distance is not a coherence measure while moving.** Walking, the lens moves ~0.1 m per frame; where the
  crosshair ray grazes terrain, that moves its ground hit by up to 14 m (Mt. Moon seed 3). The tests measure the view
  (direction, lens) instead, and the aim point only standing still. Stage 4A's camera trace will see the same amplification.

### 11.2 Changed contracts
| What | Before | After |
|---|---|---|
| Look input | `Renderer.look`: yaw into `rig.yaw`, pitch queued until `update` | `ChaseRig.look(dyaw, dpitch, range)`: both at once; recomposes `eye`, `viewPitch`, `target` as `update` composes a frame (lens turned about the pivot by the yaw change, swung by the elevation change, axis tilted). Never advances the rig clock. `Renderer.look` delegates |
| View sample | none: ticks read live `rig` fields | `ChaseRig.sample(w, h)` → frozen `ViewSample` `{eye, dir, yaw, viewPitch, userPitch, fov, width, height, aspect, reticleY}`; `Renderer.viewSample()`; `chaseAim(view: AimView, …)` |
| Host frame | inline loop in `main.ts` | `runFrame(hooks, acc, dt, maxSteps, simulate)` (`src/render/hostframe.ts`): look → one sample → zero/one/several ticks with that sample; render after. `main.ts` frame() uses it; capture `advance()` takes one sample per drawn frame. `lookDelta` holds the mouse/stick → radians maths |
| Frame composition | turned the lens to the newest yaw | also swings it by the elevation of pitch input since the last tick (`swingLens`; zero once a tick has the pitch, zero under a deck). No pitch input: bit-identical |
| Sim input | `aimX/aimZ`, `mx/mz` from live rig | the same fields from the frame's sample. No new sim field; the sim reads no renderer state |
| Rig subject size | renderer: inline; diagnostics: raw frame | `chaseSubjectSize(frame, scale)` (`src/render/chaseinput.ts`) for both; Node measurement in `scripts/lib/chasesize.ts` using the shared `neutralExtent` (`src/assets/measure.ts`, also used by `assets/pack.ts`) |

Ownership: the rig (render) owns camera state; `look` is the only writer of yaw and pitch, `update` the only clock
advance; the host owns ordering (`runFrame`); the sim owns nothing of the camera and sees only `InputFrame`s.

Kept unchanged: boom lengths, neutral heights, pitch range `[-14, 20]`, elevation band, shoulder 0.24 and swap rules, FOVs,
collision, climb, smoothing, the 120 Hz clock and every `CHASE_CONFIG` value.

### 11.3 Alternatives compared
1. **Pre-simulation view evaluation** (run `update` before the ticks): rejected again (D1 b): it needs this frame's
   interpolated player, which exists only after the ticks, and would advance the rig clock twice per frame.
2. **Explicit immutable snapshot only** (copy the rig before the ticks): necessary but not sufficient: the copy was stale,
   because the rig's own fields were not recomposed by look input.
3. **`viewAt(yaw, pitch)` pure function** (D1 as written): correct for direction, but a second composition path to keep in
   step with `update`, and it misses F2.
4. **Chosen:** make the rig's public view always coherent (`look` recomposes), snapshot it once per frame (`sample`), and
   have `update` compose pitch's lens swing too. One composition rule, no extra clock step, no sim change.

### 11.4 Test and gate results (2026-11-16, this checkout)
- `npm run typecheck`: clean.
- `npm test`: **383 / 383** pass (374 before + 9 new in `tests/viewsample.test.ts`); 48.7 s.
- New tests, red before the fix (measured above) and green after: host order for 17/90/126/180°, ±10° pitch and 90° + 8°
  (0.000 m); 30 / 60 / 144 / 240 fps with zero, one and two ticks per frame (ticks of one frame aim identically; < 0.1 m
  from the drawn crosshair while turning and pitching); flick and fire with no wind-up and with the default (shot within 1°
  of the crosshair; press-tick aim < 0.05 m); pause (look dropped, no sample, no step), hitstop (zero-tick frames, then aim
  with all accumulated look), resize (aim unchanged, sample states the new viewport), lost pointer lock; immutability and
  no clock advance; walking with shoulder and boom collision on generated cave and forest for Tiny / Small / XL at the
  renderer's sizes (no-look sample bit-identical to the previous drawn view; drawn direction within 0.6° of the sample;
  lens p99 < 0.3 m); a synthetic walled walk that swaps shoulder, where every sample equals a zero-time `update` to 1e-9;
  deterministic replay (two hosts give identical `InputFrame` logs and `stateHash`; replaying the log with no camera
  reproduces the run); diagnostic sizing.
- `tests/camstability.test.ts` "rapid direction changes" rewritten to the host order (look → sample → aim → update).
- `npx tsx scripts/checksum.ts` (every set): identical to the Phase 0 baseline (§6.3).
- `npx tsx scripts/camstats.ts --rawsize` (old sizing) and `--fps 30,144` before the sizing change: **bit-identical** to the
  pre-change output (the rig change is render-neutral without pitch input; idle drift 0, turning zoom 0, fpsDev unchanged).
- `npx tsx scripts/camstats.ts` at the renderer's sizes (median / worst, 36 runs): idle 0 / 0; turnBoom 0 / 0; walkDvP99
  1.45 / 4.82; walkJumpMax 0.27 / **7.54**; fightJumpMax 0.47 / 6.43; slides 0 / **845**; fpsDev (30/144) 0.021 / 0.269.
  Every worst value above the old table comes from the one F5 run; without it: walkJumpMax 0.26 / 0.76, fightJumpMax
  0.46 / 1.51, slides 0 / 7, fightElevMax 18.5 / 31.2, fightBoomTravel 24 / 87.3 (Feraligatr's boom is 6.6 m at its real
  size instead of 5.2 m, so it meets more collision). The `docs/THIRD_PERSON.md` tables were measured at the wrong sizes
  and are kept as history with a note.
- Not run, not applicable: `perf-sim`, `navwalk`, `stuckwatch`, habitat and hazard gates (no sim, world, movement or
  navigation change). `npm run check` was not run as one command because it writes `dist/` in a shared checkout; its three
  parts were run (typecheck, `npm test`, and `scripts/build.mjs` with the output redirected to a private directory).
- Browser (headless Chromium, real build, built to a private directory; old = this commit's HEAD, new = this change):
  - In-page host-order probe (`renderer.look`, then the aim of the next `advance` tick vs the crosshair drawn after it).
    Viridian Forest, Cyndaquil, old: 17° 0.81 · 90° 5.42 · 180° 7.61 · pitch ±10° 5.70 · 90° + 8° 8.95 m; new: 0 for all.
    Mt. Moon, Feraligatr, old: 2.05 / 3.51 / 2.44 / 2.75 / 9.96 m; new: 0 for all.
  - `node tools/cap.mjs <html> tools/chasecheck.json <out>`: every probe value (idle, combat, boss, deck, and the four
    `stress-*` elevation, frame-step and zoom figures) is identical old vs new. 30 of 37 captures are pixel-identical; the 7
    that differ (turn-forest a–c, cave-b, deck-under2, stress-tree-turn-a, stress-cave-walk-end; 8–1382 px) differ only
    at the in-world aim marker, which is drawn from the sim's aim and now sits where the corrected aim puts it.

### 11.5 Next-stage prerequisites and open items
- **Stage 1 (remaining):** the R-claim todo cases for claims 3, 4, 6, 8a–c in `tests/thirdperson.test.ts`, and the recorded
  `tp-human` fixture and checksum set. `tests/viewsample.test.ts`'s `Host` is the harness to build them on; its replay test
  already records `InputFrame`s from scripted look, fire and movement.
- **Stage 2B** (`InputFrame.aim`): build the ray from the frame's `ViewSample` (`eye`, `dir`), once per frame, in
  `sampleInput`; never from live rig fields.
- **Stage 4A:** the sim's camera trace starts from the sample's `eye`. F6 applies: test the trace by direction and contact,
  not by ground-point distance.
- **Stage 6A** (player-owned pitch): `swingLens` assumes the boom elevation is `cur.pitch + userPitch` clamped to
  `CHASE_CONFIG.elevation`; if 6A decouples the view pitch from the boom, `elevFor` changes with it and the
  `tests/viewsample.test.ts` pitch cases are the gate.
- **Stage 6C:** F5 (the rig collapses when an XL body's pivot is under a deck). Add the forest seed 3 Feraligatr run to its
  gates; `camstats` now sees it.
- **Diagnostics:** `docs/THIRD_PERSON.md`'s camstats tables predate F4; a fresh baseline at the real sizes should be taken
  after F5 is fixed, not before.
- **Manual:** nobody has played this with a mouse or gamepad (§9 item 1 and 10 remain).

---

## 12. Phase 2A: deterministic spatial queries (2026-11-16)

Scope: Stage 3. A pure query module with **no consumers**: no system calls it, so no replay hash can move (§6.1 rule 1
holds trivially; every checksum set was diffed and is identical). Files: `src/sim/spatial.ts` (new), `tests/spatial.test.ts`
(new), `scripts/spatialbench.ts` (new). Small supporting changes: `rules.spatial` (`gridSlack`, `spawnGuard`) in
`src/rules/defaults.ts`; `DECK_SLAB = 0.6` exported from `src/sim/world.ts` (`ceilingAt` uses it, same value); `Grid.starts`
and `Grid.items` made readable (`src/core/grid.ts`, type-level only). Direct shots, beams and every other move are
untouched (they migrate in 4A–5C).

### 12.1 Inventory: geometry, collision and visibility before this phase
| Function | What it answers | Limits for aiming and projectiles |
|---|---|---|
| `World.tile`, `height(x, z, ref)`, `support`, `collides`, `blocks`, `wallAt`, `ceilingAt`, `node`, `solid`, `liquidAt` | point predicates on the half-open tile grid, layer-aware through `ref` / `DECK_REACH` | points only; no ray or contact |
| `World.sight` | 3D line of sight, samples every 0.5 m, skips the first and last 0.5 m | misses corners and thin clips (I2); slab = the 0.9 m reach band (I1); boolean only |
| `World.wallBetween` | walls on a 2D line, 0.25 m samples | walls only; sampled |
| `World.moveBody` / `fits` / `overlap` | footprint circles against tiles (movement) | the movement resolver; stays as it is |
| `Grid.query` | enemy candidates in a circle into the shared `result` buffer | a nested query clobbers a caller's iteration (I6); cells reflect positions before enemies move (I5) |
| `effects.ts` projectile loop | end-of-tick point against grid candidates, `wallAt`, a 1.1 m vertical band | no sweep (N2, reproduced), grid order (N1, reproduced) |
| `moves.ts` `enemiesInRadius`, `resolveAim`, archetypes | 2D circles, cones, capsules | no height, no cover (claim 5) |
| `bodies.ts` `eachBodyIn` | 2D circle, linear over the pool | no height |
| `render/camera.ts` `chaseAim` | march against `world.height` | ground only (claim 1) |

Reusable as they are: the tile grid (it is the spatial index for the world), `World` arrays read live (ice, tide and W4
blocks write them in place), `Grid` cells (the enemy broad phase), `rules/sizing.ts` bodies, the body templates.

### 12.2 Inconsistencies and defects found (R = reproduced by a test)
- **I1 (R) slab thickness.** `World.sight` treats `[top − 0.9, top]` as solid (`DECK_REACH`, a layer-selection reach);
  the renderer draws a 0.6 m slab and `ceilingAt` returns `top − 0.6`. A line 0.15 m under the drawn underside is blocked
  for enemies. Spatial uses 0.6 m. 1 of 10 000 random segments hit the band. Test: `todo` "World.sight (I1)". Owner: Stage
  7A (enemy line of fire); acceptance: the todo test becomes active and passes, enemy hashes migrate once (§6.1 rule 2).
  Phase 2B does not depend on it: its shots and traces use `spatial.ts` (0.6 m `DECK_SLAB`), never `World.sight`.
- **I2 (R) sampling misses corners.** A segment that clips a wall's corner over a 0.28 m chord is clear to `World.sight`
  for some phases of its samples. 24 of 10 000 random generated-map segments. Test: `todo` "World.sight (I2)". Owner: Stage
  7A; acceptance as I1. Phase 2B does not call `World.sight`.
- **N2 (R) tunnelling, now reproduced.** The real `projectileSystem`: a bolt at its native 26 m/s (0.433 m per tick),
  radius 0.4, past a Tiny body whose reach it enters by 1 cm, with the tick ends half a step either side: 0 damage. The
  sweep meets it on the tick that passes it. Test: `todo` "tunnelling (effects.ts, N2)". Owner: 4B. **Resolved for 3D shots in
  Phase 2B** (§13.1): the test is active; the planar shot keeps the defect and the test pins that too.
- **N1 (R) pierce in grid order, now reproduced.** Two Tiny bodies inside reach on the same tick, the near one by contact
  order in the higher slot: the far one takes the hit and the pierce-0 shot ends. Test: `todo` "pierce order (effects.ts,
  N1)". Owner: 4B. **Resolved for 3D shots in Phase 2B**, as N2.
- **I5 grid staleness.** `gridSystem` rebuilds before `enemySystem` moves anyone. Measured in a 333-enemy run: an enemy
  moved up to **1.035 m on one axis** (1.385 m total) in one tick after the rebuild: an Extra Large Snorlax's footprint
  pushed out of a wall after a fall (`moveBody` with a zero move). Walking and knockback stay under 0.5 m. Spatial widens
  its cells by `rules.spatial.gridSlack` = 2.5 m plus the largest live enemy radius. An actor teleported later in the tick
  (relocation, a shore rescue) stays in its old cell until the next rebuild, for every grid reader. **Phase 2B (§13.2):**
  `spatial.ts` now finds these "strays" itself and tests them where they are; plain `grid.query` readers still miss them.
- **I6 shared `Grid.result`.** Any nested `grid.query` overwrites a caller's candidate list. Spatial reads cells directly
  and never touches `result` (test: "an in-use grid.result").
- **I7 bodies have no height in the sim.** D4 called them spheres; spatial uses the bounding upright cylinder `[y, y + 2r]`.
- **I8 (engineering) V8 boxing.** A first version allocated ~100 B per query: doubles written to module variables or
  passed to calls V8 does not inline are boxed, and code that had seen an authored world (null `over` / `voids`, no
  `wlevel`) before a generated one boxed every typed-array load (65 B per call). Fixed by passing numbers through one
  `Float64Array` and reading geometry through a per-world view of one hidden class (`Geo`).

### 12.3 Interfaces (`src/sim/spatial.ts`)
```ts
SK = { bounds: 1, wall: 2, deck: 4, terrain: 8, liquid: 16, body: 32, player: 64, enemy: 128 }   // kinds; bit order = tie-break order
SK_WORLD, SK_ACTOR, SK_ALL
MASK = { los: SK_WORLD, camera: SK_WORLD | enemy | body, shot: SK_WORLD | enemy | body, hostile: SK_WORLD | player | body }
CF = { block: 1, pierced: 2, overlap: 4, initial: 8, seal: 16 }                                   // contact flags
QF = { skipInitialWorld: 1, spawning: 2, sight: 4 }                                               // query flags

class RayHit { t; x; y; z; nx; ny; nz; kind; id; flags }                     // one contact (caller-owned, reused)
class Contacts(cap = 32) { n; truncated; stop; stopT; occluded; t, x, y, z, nx, ny, nz: Float64Array; kind, flags: Uint8Array; id: Int32Array }
interface SpatialQuery { mask; block; pierce; worldR; worldH; actorR; actorH; selfKind; selfId; bodyTeams; flags }
spatialQuery(init?)                                                          // defaults: MASK.shot, block all actors, pierce 0, all body teams

raycastWorld(world, ox, oy, oz, dx, dy, dz, maxT, mask, hit, r = 0, h = 0, flags = 0): boolean   // first world contact; render may call
segmentClear(world, x0, y0, z0, x1, y1, z1, mask = MASK.los): boolean                           // exact line of sight; render may call
solidAt(world, x, y, z, mask = SK_WORLD): number                                                // solid kind at a point (0 = open)
sweep(ctx, ox, oy, oz, dx, dy, dz, maxT, query, out): number                                    // ordered contacts; sim systems only
sweepTo(ctx, x0, y0, z0, x1, y1, z1, query, out): number
overlapCylinder(ctx, x, y0, y1, z, r, query, out): number                                       // areas
overlapSector(ctx, x, y0, y1, z, r, fx, fz, cosHalf, query, out): number                        // melee wedges (cos from dcos)
```
Semantics (the header of `spatial.ts` is the reference):
- **Geometry.** Tiles are half-open `[i, i + 1) × [j, j + 1)` (`World.tile`'s rule). A wall tile is a column `(-∞, +∞)`,
  or up to a deck's underside. Other tiles are solid below `World.height(x, z)` with no reference: ground, low props
  (platform height), ice, a stairs ramp as its plane. Open water is the same column, kind `liquid` (a mask without
  `liquid` passes the surface and has no bed under it). A chasm (hazards on) has no floor. A deck is a slab
  `(top − 0.6, top)` over whatever the ground holds; the underpass is the open air between. Outside the map is `bounds`.
  Actors are closed upright cylinders: enemy `[E.y, E.y + E.tall]` × `E.radius` (fliers' `E.y` includes the hover);
  partner `[P.y, P.y + partnerHeight]` × `partnerRadius`; body `[B.y, B.y + 2r]` × template `r`.
- **Volumes.** A query is an upright cylinder of radius `r` and half-height `h` swept along the ray (0 = a ray), with
  separate world and actor sizes. Against actors the Minkowski sum is exact. Against the world `r < 1 m`: the tile
  footprint grows to a rounded square (exact corners: a pass 0.32 m from a corner with `r` = 0.3 is clear, where a square
  grow would hit), and a stairs ramp is taken at its higher edge (conservative).
- **Contact rules.** World solids are open: a contact needs a positive length inside (a ray in a floor's plane or along a
  wall face does not hit it; a segment ending on a surface does not). The **corner seal**: a ray exactly through a tile
  corner whose two side tiles are both solid stops there (`CF.seal`). Actors are closed (touching counts, as `effects.ts`
  does). A start inside a volume is a `t = 0` contact with `CF.initial` and normal `−d`; `QF.skipInitialWorld` ignores the
  world solids that contain the start (a muzzle poking into a wall it is leaving) and meets the next.
- **Order.** `(t, kind bit, id)`, total: independent of pool slots, grid layout and iteration order. Cover wins a tie
  (world kinds sort before actors).
- **Responses.** World kinds in the mask always block. An actor kind in `block` blocks unless `pierce` is left (then
  `CF.pierced`, and the count drops; `pierce: Infinity` never stops on actors, which is what a shot's `pierce = −1` means). Other masked
  actor kinds are `CF.overlap`. Unmasked kinds are ignored (never tested). The list ends at the first block; nothing behind
  it is reported. A list that fills up keeps the nearest, sets `truncated`, and does not claim a clear path.
- **Filters.** `selfKind` / `selfId` (the shooter); `bodyTeams` (bit per `TEAM`); enemies in their spawn guard
  (`rules.spatial.spawnGuard`, 0.25 s, the projectile rule) unless `QF.spawning` (which still sees only enemies in the
  grid, i.e. spawned before `gridSystem` this tick). Overlaps with `QF.sight` drop actors with a world kind of the mask
  between the shape's mid-height centre and the actor's centre (`out.occluded` counts them).
- **Tick state.** Actor tests read the pools when called: after `enemySystem`, this tick's moved enemies. Render may call
  only `raycastWorld`, `segmentClear` and `solidAt` (static geometry, never actor state).
- **Determinism and cost.** `+ − × / sqrt floor abs min max` only. No allocation per call (§12.5). Scratch is per module,
  per world and per grid, sized once.

### 12.4 Tests (`tests/spatial.test.ts`, 26 cases: 22 pass, 4 `todo`; after Phase 2B 27 cases: 25 pass, 2 `todo`, §13.7)
Synthetic scenes copy an authored world's map arrays before editing them (the base map is cached and shared).
- Terrain and props: down to the ground, the side of a 1 m rise, a ray in the floor plane, over a 0.7 m prop, a segment
  ending on the ground. Stairs: contacts on `World.height` to 1e-6 with the plane normal.
- Decks: underside at 2.4 m from below, top from above, the underpass, the slab edge, a mask without decks, the ground
  beneath; a wall under a deck; a chasm with and without a bridge; 20 real deck tiles each on Mt. Moon and Chargestone
  Cave seed 4 (underside, top, top-to-ground blocked, underpass open).
- Walls and bounds, corners (seal, graze, a hair off, both face lines of the half-open rule), adjacent blockers (a seam
  between two wall tiles, a row of walls).
- Fat sweeps (rounded corner entry exact to 1e-9, a parallel pass, the diagonal corner pass, half-height against the
  floor); initial overlap (wall, ground, `skipInitialWorld`).
- Actors: real Tiny and Extra Large bodies (height and radius), actor radius and half-height inflation, the top cap, the
  partner cylinder and self-ignore; ordered multiple contacts with reversed slots, pierce 0 / 1 / ∞, overlaps, an enemy
  behind a wall, capacity truncation; overlapping obstacles (an enemy half inside a wall, two overlapping enemies, an exact
  tie broken by id, a wall-vs-enemy tie won by the wall); a deck between shooter and enemy, bodies by team, the spawn guard;
  overlap cylinder and an exact sector (edge within 1 cm, zero-width wedge, vertical band, line of sight).
- Tunnelling: the sweep meets the Tiny graze that the end-of-tick test misses; the N1, N2, I1, I2 `todo` cases.
- Oracles: 10 000 random segments on Mt. Moon seed 4, Chargestone Cave seed 3 and Viridian Forest seed 1: no false
  negative against 1 cm dense sampling of the same point rule, no false positive (inside a solid just past every
  non-seal contact), every disagreement with `World.sight` explained (24 sampling misses, 1 deck band, 0 other). A live
  crowd: 4 200 sweeps over 70 s at up to 333 enemies agree with a brute-force pass over the whole pool (10 905 contacts).
- Determinism: 1 500 sweeps and overlaps hashed twice, on a second replay of the same run, with a 5 m grid instead of 3 m,
  and with `grid.result` in use: identical. 3 000 queries leave `stateHash` unchanged, and the run then steps identically to
  one that never queried.

### 12.5 Performance and allocation
`npx tsx scripts/spatialbench.ts --gate` (this machine, Node 24.21; min of 5 passes of 20 000 calls; a full collection
before each timed loop, then collections counted and heap growth per call). 475 enemies on Mt. Moon / 477 on the meadow:

| Workload | Mt. Moon | Meadow | Allocation |
|---|---|---|---|
| camera ray, world only, 26 m (`raycastWorld`) | 0.23 µs | 0.51 µs | 0 gc, ≤ 0.13 B/call |
| camera trace, world + enemies + bodies, 26 m (`sweep`) | 2.30 µs | 1.10 µs | 0 gc, ≤ 0.08 B/call |
| **shot tick** 0.433 m, thin vs world, r 0.4 vs actors | **1.01 µs** | **0.40 µs** | 0 gc, ≤ 0.12 B/call |
| shot tick, r 0.3 vs world too | 1.45 µs | 0.87 µs | 0 gc, ≤ 2.84 B/call |
| beam 14 m, r 0.6, pierce all | 1.63 µs | 1.24 µs | 0 gc, 0.08 B/call |
| line of sight 20 m (`segmentClear`) | 0.14 µs | 0.49 µs | 0 gc, 0.08 B/call |
| area `overlapCylinder` r 3 (with sight) | 2.58 (4.51) µs | 0.47 (0.73) µs | 0 gc, 0.08 B/call |
| melee `overlapSector` r 2.5, 60° | 1.59 µs | 0.41 µs | 0 gc, 0.08 B/call |
| *legacy* end-of-tick shot test (`grid.query` + points + `wallAt`) | 0.17 µs | 0.10 µs | 78 / 52 B/call |
| *legacy* `World.sight` 20 m | 0.09 µs | 0.41 µs | 127 B/call, collections |

Stage 3 gate (average shot segment under 2 µs): **PASS**. The sweep costs 4–6× the legacy point test per tick, and it is
exact, ordered and swept; at the plan's one sweep per live shot per tick, 300 shots cost 0.12–0.3 ms. The first working
version cost 1.33 µs per shot tick on Mt. Moon with 26 collections per 100 000 calls; the scratch-array and `Geo` changes
(I8) took it to 0.94–1.01 µs (across runs) and none. The residual ≤ 2.8 B/call on fat sweeps is the optimiser's occasional box on wall hits (about one per
ten hits).

`npx tsx scripts/perf-sim.ts 500 --repeat 3 --gate` (min of 3), before → after: p50 0.380 → 0.380 ms, p95 0.487 → 0.486 ms,
p99 0.844 → 0.829 ms, max 1.081 → 1.059 ms: PASS (no consumer, so no change is expected).

### 12.6 Gates run (2026-11-16, this checkout)
- `npm run typecheck`: clean. `npm test`: **416 tests, 412 pass, 0 fail, 4 todo** (the four §12.2 defects); 45 s.
- `npx tsx scripts/checksum.ts` (all sets, 40 lines): byte-identical to the same command run before this change, which
  matches §6.3 (`on` `632d7d25` · `17978323` ·
  `93ae9839` · `53516479`; `gen` `bc465079` · `72710e43` · `99231ed1` · `c7cd3318`).
- `scripts/spatialbench.ts --gate`: PASS. `perf-sim --gate`: PASS (above).
- Production build: `scripts/build.mjs` with the output redirected to a private directory (the shared checkout rule);
  `npm run check` was not run as one command because it writes `dist/`.
- Not run, not applicable: `navwalk`, `stuckwatch`, habitat and hazard gates, camstats. Nothing in movement, navigation,
  world generation, habitats, hazards or the camera changed (the `DECK_SLAB` constant replaces an equal literal; the
  checksum sets, which drive movement and navigation on classic and generated maps, are identical).

### 12.7 Handoff
- **4A (camera trace, muzzle).** Camera trace: `sweep(ctx, eye + d·tNear, d, maxT, spatialQuery({ mask: MASK.camera,
  selfKind: SK.player, selfId: 0 }), out)`; T = the first contact or the end. Muzzle trace: `sweepTo(ctx, M, T, …)` with
  `QF.skipInitialWorld` if the muzzle may start inside a wall face it is leaving. The reticle's blocked state can use
  `raycastWorld` (world only) from render, never `sweep`. F6 applies: test by contact, not ground-point distance.
- **4B (projectiles).** One `sweep` per live shot per tick from the previous position along the tick's motion, `actorR =
  Pr.radius`, `worldR` 0 (or a small radius for fat shots), `pierce = Pr.pierce < 0 ? Infinity : Pr.pierce`; apply contacts
  in list order and keep `recentlyHit` / `markHit` (repeat-hit cooldowns are the consumer's). That makes the N1 and N2
  `todo` tests pass. Choose the vertical band on purpose: the legacy test is 1.1 m + half the body, the cylinders here are
  exact.
- **5B / 5C.** Beam: `sweep` with `pierce: Infinity`. Chain hops: `segmentClear` per hop. Strike and cone:
  `overlapSector` with the anatomical band; areas: `overlapCylinder`; both with `QF.sight` and `MASK.los` in the mask for
  cover.
- **6C.** `raycastWorld` straight up from the head with `MASK.los` gives the ceiling the body meets (decks only, by mask).
- **7A.** `segmentClear` replaces `World.sight` behind a flag; it moves enemy hashes by design (I1, I2: 25 of 10 000
  random segments differ).
- **Open:** wall tiles stay infinite (Q3); stairs are conservative for fat world sweeps; liquids have no bed; teleported
  enemies are missed until the next grid rebuild; `QF.spawning` sees only enemies in the grid; Stage 1's remaining
  `todo` cases and `tp-human` fixture are still open.

---

## 13. Phase 2B: spatial aim and 3D direct shots (2026-11-16)

Scope (Phase ↔ Stage mapping in the header): Stage 2B (aim-ray schema and host adapter), Stage 4A for the direct linear shots
(sim-owned camera trace, size-aware muzzle, convergence, obstruction state), the linear-trajectory part of Stage 4B
(independent 3D flight, swept ordered contacts) and the spatial-path part of Stage 5A (no assistance). Migrated
archetypes: **bolt** (Ember, Water Gun, every `shard|needle|shot|spit` move) and **orb** (Bubble, every `ball|orb|sphere|pulse`
move), both through `straight()`. No camera, cadence, wind-up or ability change.

### 13.1 Phase 2A re-verified; the TODO cases reconciled
- Acceptance re-checked before any change: `tests/spatial.test.ts` 22 pass / 4 todo; every checksum set byte-identical to
  §6.3; `scripts/spatialbench.ts --gate` shot tick 0.99 µs (Mt. Moon) / 0.38 µs (meadow), as in §12.5; `perf-sim --gate`
  min-of-3 p50 0.379 / p95 0.484 / p99 0.830 ms (§12.5: 0.380 / 0.486 / 0.829).
- The four `todo` tests described real legacy defects, each deferred to the stage that replaces the code:

  | Test | Defect | Owner then | Now |
  |---|---|---|---|
  | tunnelling (effects.ts, N2) | end-of-tick point test misses a graze | 4B | **active**: the 3D shot hits; the planar shot's miss is pinned in the same test (it flies for the bot and the fixed views until 7B) |
  | pierce order (effects.ts, N1) | pierce in grid order | 4B | **active**, as N2 |
  | World.sight (I2) | 0.5 m samples miss a corner | 7A | `todo`, owner Stage 7A (enemy line of fire on `segmentClear`); gate: the test active, enemy hashes migrated once. Phase 2B never calls `World.sight` |
  | World.sight (I1) | 0.9 m `DECK_REACH` band treated as slab | 7A | `todo`, as I2. Phase 2B's traces and shots use the 0.6 m `DECK_SLAB` |
- Ledger references corrected: the Phase/Stage mapping is stated in the header; §12.2's N1/N2/I1/I2/I5 entries, §12.4's
  counts, the contracts table, the roadmap rows and the §7.2 matrix name what Phase 2B changed.

### 13.2 Grid timing and `gridSlack` (I5) reviewed
`gridSystem` rebuilds before `enemySystem`; spatial queries run in `movesSystem` and `projectileSystem`, after it. What moves
an enemy in between, and by how much per tick: walking and knockback (< 0.5 m), Lasso holds (`holdSpeed · dt`), a boss's
slam leap (~0.3 m), a footprint pushed out of a wall after a fall (1.035 m measured, §12.2), **a relocation by
`enemies.ts` (~30 m ahead of the trainer: a teleport)**, and enemies spawned after the rebuild (not in the grid at all). The
ice rescue (`cellSystem`) and zone pulls (`zoneSystem`) run after the projectiles; the next rebuild covers them.

Finding: the slack makes the broad phase correct for every bounded mover, but a relocated enemy was invisible to every query
for the rest of its tick (a stale cell 30 m away), so a 3D shot could pass through it unhit. **Fixed in `spatial.ts`**
(`enemyBroad`): once per tick (and whenever the live count, the pool bound or the grid changes) the pass that already found
the largest radius also lists the *strays*: enemies outside their filed cell's box grown by `gridSlack`, or not filed at
all. The cell walk skips them and every sweep and overlap tests them where they are. `gridSlack` now bounds cost, not
correctness; no legacy reader changed (`Grid` only exposes `cellOf`, `n` and `gen`; the rebuild is the same).
- Evidence: "live strays (Phase 2B)" (`tests/spatial.test.ts`): 60 s at up to 330 enemies, every live enemy probed every
  tick: 730 262 probes, all met; a plain `grid.query` widened by the slack missed 15 (13 ticks; 10 of them relocated onto the
  ring). "an enemy moved far after the grid rebuild" (`tests/aim3d.test.ts`): a 3D shot through a relocated Tiny body hits it
  that tick. Mutation check: with the stray list disabled both tests fail.
- Not fixed (other owners): plain `grid.query` readers (`resolveAim` magnetism, `enemiesInRadius` for areas and zones, the
  planar projectile test) still miss a stray for one tick. They are replaced family by family (5B, 5C, 7A); until then this
  is the documented legacy behaviour every checksum set relies on. A position change inside a tick after the first spatial
  query (zone pulls) is not re-classified; no spatial query runs after `zoneSystem` today.

### 13.3 The project checks
`npm run check` is `npm run typecheck && npm test && npm run build`. Phase 2A ran the same three parts, with the build
redirected to a private directory (shared checkout). Phase 2B did the same: `scripts/build.mjs` copied with only the output
path changed (diffed: no other difference), run from the repository root; `dist/` untouched. Equivalent.

### 13.4 Contracts landed
| What | Where | Shape |
|---|---|---|
| Aim ray input | `src/sim/types.ts` `InputFrame.aim?: AimRay`, `aimDev?` | `{ox, oy, oz, dx, dy, dz}`; absent = the planar path |
| Host adapter | `src/render/hostframe.ts` `aimRayOf(view)`; `src/main.ts` `sampleInput` | the frame's one `ViewSample` (`eye`, `dir`), each through `Math.fround`; only in chase view, not in `auto` mode; `aimDev` = stick for a pad or the right stick, else mouse |
| Rules | `rules.aim` (`src/rules/defaults.ts`) | `spatial: true`, `archetypes: ['bolt', 'orb']`, `sightRange: 80`, `convergeMin: 0.5`, `muzzle {up 0.6, fwd 0.9}`, `muzzleBy {}`, `reachMult 1.25`, `reachPad 0.2`, `worldRadius 0` |
| Resolution | `src/sim/aim.ts` `spatialFor`, `resolveSpatial(ctx, spec, out: AimState)`, `shotReach` | camera trace → muzzle → launch direction → obstruction (header of the file) |
| Per-tick aim state | `ctx.aim: AimState` (written by `movesSystem` for the first migrated slot) | presentation only: never hashed, never read back by the sim |
| Projectile fields | `ProjectilePool.traj` (0 planar, 1 linear 3D), `oy`, `rem` | `traj` reset by `spawn()` and by `launchShot` / a Hold catch |
| 3D flight | `src/sim/effects.ts` `flyLinear` | one `sweep` per shot per tick, contacts in order, exact reach clip |
| Events | `cast.o {o, t, kind, blocked}` (optional), `shotEnd {why: world \| actor \| range, kind, x, y, z, element}` | render: muzzle flash at `o`, puff at a world `shotEnd` |
| Broad phase | `spatial.ts` `enemyBroad` (strays) | §13.2 |

### 13.5 Behaviour of the spatial path
A cast takes it when `rules.aim.spatial` is on, the input carries a ray, the cast is player-aimed (`combat.mode` 'aimed', or
'assist' for slots 1-3; not under `basicNeedsTarget`), and the archetype is listed. Then:
1. **Camera trace** (`MASK.camera` without `bounds`): from where the ray crosses the plane through the partner's chest
   (nothing between the lens and the Pokémon counts; world solids containing that point are skipped), up to 80 m. The first
   world solid, enemy or body (a body the partner holds is skipped) is the aim point T; nothing → T is the ray's end (empty
   space, off the map included).
2. **Muzzle** M = feet + 0.6 × class height up, + 0.9 × footprint along the ray's heading (at the class values, before the
   ±8 % in-class tilt: Tiny 0.36 m up / 0.27 m ahead, Medium 0.72 / 0.41, Extra Large 1.44 / 0.79). Size geometry off: 1.2 m height and the hurt radius. A wall between the
   body's axis and M puts M on the axis. M is computed at release from the body where it is then (in the air too).
3. **Launch** along (T − M), or along the ray when T is within 0.5 m of M or behind it. A fan (`count` > 1) turns each shot
   about the vertical by the move's spread and keeps the pitch.
4. **Obstruction**: the shot's own volume swept from M toward T with the move's pierce: the first stopping contact before T
   that is not what the crosshair is on → `blocked`, its kind and point (the cast event and `ctx.aim` carry it).
5. **Flight**: `x, y, z` advance by the launch velocity; nothing reads the shooter or the ground again (no gravity, no
   terrain following, no sinking). Each tick's whole path is swept: shot radius against bodies (upright cylinders, exact),
   `worldRadius` (0, a ray) against the world. Contacts apply in the order the shot reaches them: each enemy or body once
   (`recentlyHit` / `markHit` as before), each spending a pierce; the first world solid (terrain, wall column, deck slab,
   liquid surface, map bounds) or the actor that spends the last pierce ends it there (`shotEnd`). Reach = range × 1.25 +
   speed × 0.2 from the muzzle (the planar shot's flight, so no range changed), clipped exactly on the last tick. A Bulwark's
   shield, interception between shots and the ground agents a shot paints (every third tick) keep their planar rules.

**Targeting policy.** On this path nothing redirects the aim: `resolveAim` returns before its magnetism loop (and its 0.6 m
radius rule), `straight()` skips its lead, and `AIM.t` only reports what the crosshair is on. The planar path (magnetism 12°,
the radius rule, lead) is kept, unchanged, exactly where it is still required: no ray (the bot, Classic / Overhead / Wide
views), `rules.aim.spatial` off, `combat.mode` 'auto', the basic attack under 'assist', and every archetype not migrated.

### 13.6 Migrated and unmigrated move families
| Family (D8) | Archetypes | Phase 2B | Notes / owner |
|---|---|---|---|
| Linear shot | **bolt, orb** | **migrated end to end** | `straight()` |
| Linear shot | barrage | not migrated | same `PK.straight` and `flyLinear` would fit, but its random spread draws `rng.combat` per shot: decide whether the jitter is yaw-only or 3D first (Stage 4B) |
| Seeker | homing, drain | not migrated | 3D steering toward a sim-acquired target (4B) |
| Arc / sky | lob, meteor, smite | not migrated | ballistic / from above (4B) |
| Return, attached | boomerang, orbit | not migrated | 4B |
| Beam, chain | beam, chain | not migrated | 5B (Phase 2C migrated beams, §14.5; chain open) |
| Contact melee, self area, placed area | strike, dash, spin, cone, nova, aura, vortex, trail, trap | not migrated | 5C |
| Self / global | buff, weather | n/a | — |
| Enemy shots | `shootHostile` | not migrated | 7A |

### 13.7 Tests
- `tests/aim3d.test.ts` (new, 17 cases, real `step()` on a private flat world; "legacy" = the same inputs with
  `aim.spatial` off): shot-up at a 4 m flier (legacy misses); 6.3° off the crosshair (spatial misses, legacy snaps on; the aim
  point lies on the ray within 1e-4 m); shot height while the shooter jumps (spatial: identical to a run without the jump,
  linear in y, authored and location rules; legacy authored: +1.75 m); close-range reticle on the right shoulder (rubble
  2.5 m ahead: `chaseAim` ≥ 4 m out and > 0.8 m beside the crosshair line, legacy misses, spatial hits); near 3 m, far 20 m,
  3 m above, from a 4 m plateau down; a strafing target (legacy leads by > 0.5°, spatial flies exactly M → T); empty space
  (camera met nothing, flew exactly its 27.7 m reach, not the 80 m sight); reach edge ± 0.3 m; Tiny / Medium / Extra Large ×
  both shoulders × standing / jumping (origin = muzzle, heights grow with class); a wall between muzzle and the target the
  lens sees (`blocked`, shot ends on the wall face, `ctx.aim` gives the point); rubble before the target (contact order,
  pierce continues); decks (underside from below, the underpass, the top from above, beyond the edge); 120 m/s against a
  Tiny graze (no tunnelling); a relocated stray; flag off or no ray = identical `stateHash` per tick; determinism of a
  240-tick scripted aim replay; the host adapter on a settled real `ChaseRig`.
  Red before the sim change: 12 of 17 failed for the defects themselves (e.g. "the jump moved the shot 1.75 m").
- `tests/spatial.test.ts`: N1 and N2 promoted (§13.1); "live strays (Phase 2B)" added. 27 cases: 25 pass, 2 todo.
- Whole suite: **434 tests, 432 pass, 0 fail, 2 todo** (I1, I2), 46 s. `npm run typecheck` clean.

### 13.8 Gates (2026-11-16, this checkout)
- `npx tsx scripts/checksum.ts` (all 40 earlier lines): byte-identical to before the change (= §6.3). New sets: `aim-off` =
  `on` exactly (rays present, flag off); `aim` reproducible run to run (hashes in §6.3). The `aim` input is built with
  detmath and `sqrt` only, so it does not depend on the engine's `Math.sin`.
- `scripts/perf-sim.ts 500 --repeat 3 --gate`: PASS, min-of-3 p50 0.379 / p95 0.484 / p99 0.830 / max 1.060 ms (bot, no ray:
  unchanged). With `--aim` (ray on every tick: the per-tick aim state plus every primary on the 3D path): PASS, min-of-3 p50
  0.368 / p95 0.482 / p99 0.822 / max 2.047 ms (a different crowd history; raw p99 1.77 ms on a busy machine).
- `scripts/shotbench.ts --gate` (new; the real `projectileSystem` over a frozen crowd, min of 5, a full GC before each pass):

  | Map, crowd | Live shots | Planar | 3D swept | GC |
  |---|---|---|---|---|
  | Mt. Moon, 455 | 50 | 2.2 µs/tick (1.12 µs per shot-tick) | 3.3 µs/tick (2.61) | 0 / 0 |
  | Mt. Moon, 455 | 300 | 8.8 (0.83) | 14.0 (1.58) | 0 / 0 |
  | meadow, 454 | 50 | 9.8 (0.21) | 11.5 (0.43) | 0 / 0 |
  | meadow, 454 | 300 | 54.1 (0.19) | 63.6 (0.39) | 0 / 0 |

  About 2× the planar test per shot-tick, 64 µs per tick at 300 live shots; gate (≤ 3 µs per shot-tick, no collection) PASS.
  On Mt. Moon 3D shots end sooner (cliffs, slabs), so they log fewer shot-ticks.
- `scripts/spatialbench.ts --gate`: PASS, unchanged from §12.5 (the stray pass costs nothing when there are none).
- Production build: `scripts/build.mjs` to a private directory (§13.3), 17.2 MB.
- Browser (headless Chromium on that build, capture mode, Viridian Forest seed 1, Cyndaquil, chase): the input carries the
  ray (`aimDev` mouse); `ctx.aim.on`; crosshair placed on a Rattata 7.4 m out: `hitKind` enemy, muzzle 0.55 m up on the body
  while the lens is 0.9 m to the side, the shot `traj` 1 descending linearly to it, the Rattata hit. Classic view: no ray, no
  aim state. (A first placement put the crosshair 0.5 m above the Rattata; the shot truthfully passed over it to the wall.)
- Not run, not applicable: `navwalk`, `stuckwatch` (no movement or navigation change), habitat and hazard gates (no habitat,
  hazard or objective code changed; their scripts drive the bot, which sends no ray), `camstats` and `chasecheck` (the rig is
  unchanged; the renderer only adds markers).

### 13.9 Behaviour changes (intended) and balance
On the spatial path, compared with the planar shot of the same move: no magnetism and no lead; height matters (fliers,
ledges, decks); cover is solid: wall columns, terrain rises, deck slabs, and a low prop that rises above the shot's line;
a shot that misses ends where it meets the ground or a wall instead of flying its full range; **on classic (authored)
arenas the planar shot ignored wall tiles and height entirely** (it spent 15 % of its flight inside wall tiles in a
totodile seed 7 run), the spatial one does not (Q7); shots never pass their reach; a body the partner holds is passed. Cast
rate is unchanged (128 vs 126 bolt casts in 80 s of the same run).

Balance, measured with the bot plus the `aimbot` ray (4 bolt/orb starters × seeds 1-6, 240 s each; means over 24 runs):

| Map | Path | Survived | Level | Kills | Hits |
|---|---|---|---|---|---|
| classic | planar | 17 | 14.4 | 727 | 1546 |
| classic | spatial, ray at the nearest enemy even behind a wall | 11 | 12.1 | 543 (−25 %) | 1213 |
| classic | spatial, ray at the nearest *visible* enemy | 16 | 14.4 | 706 (−3 %) | 1486 |
| generated | planar | 12 | 12.8 | 610 | 1052 |
| generated | spatial, nearest visible | 11 | 12.0 | 581 (−5 %) | 1099 |

A player who shoots what is visible stays inside the 4B ±10 % band on both map families; firing into cover is now a real
loss, which is the intended 3D rule. Single replays diverge after the first different card pick (totodile seed 7 dies early
in `aim`), so only the sweep is evidence. Owner of the product call: Q7.

### 13.10 Limitations and open items
- Only bolt and orb are migrated (§13.6). The other families keep their planar targeting and magnetism.
- Pad and touch players have **no** aim assistance on the spatial path (it was hidden magnetism); explicit per-device
  policies are Stage 5A. `aimDev` is recorded for it; the host never sends 'touch' yet.
- The camera trace hits wall tiles as infinite columns and low props at their platform height (Q3): a crosshair on a tree
  top is on the tree.
- Interception between shots, the Bulwark shield and the agents a shot paints stay planar (they read x/z only).
- Plain `grid.query` readers still miss strays for one tick (§13.2); owners 5B (the spatial beam no longer does, §14), 5C, 7A.
- The muzzle has no per-species override (class fractions plus per-archetype / per-move `muzzleBy`). Muzzles of Extra Large
  bodies under low decks can start inside the slab (claim 8c); the shot then ends at once on the slab, which is truthful,
  and Stage 6C owns the body.
- The reticle shows blocked (red cross) and out-of-reach (dimmed) from `ctx.aim`; the in-world marker sits at the stop point.
  These are presentation only and have not been seen by a person: nobody has played this with a mouse or a gamepad (§9 1-3).
- `tp-human` (Stage 1) is still open; the `aim` checksum set is the interim cover for the spatial path.

### 13.11 Handoff
- **Status:** PASSED (scope above). Next: barrage and the seekers (4B), assistance policies (5A), beams and chains (5B), the
  `tp-human` fixture, a mouse and gamepad playtest.
- **Files:** `src/sim/aim.ts` (new), `src/sim/moves.ts` (`resolveAim` branch, `spawnShot3D`, `straight`, `presentAim`),
  `src/sim/effects.ts` (`flyLinear`, `shotEnd`), `src/sim/spatial.ts` (`enemyBroad`), `src/sim/types.ts`, `src/sim/pools.ts`,
  `src/sim/run.ts`, `src/sim/capabilities.ts` (`traj` reset), `src/core/grid.ts` (`cellOf`, `n`, `gen` readable),
  `src/rules/defaults.ts` (`rules.aim`), `src/render/hostframe.ts` (`aimRayOf`), `src/main.ts` (ray, crosshair state),
  `src/render/renderer.ts` (marker, muzzle flash, impact), `scripts/lib/aimbot.ts`, `scripts/shotbench.ts` (new),
  `scripts/checksum.ts` (`aim`, `aim-off`), `scripts/perf-sim.ts` (`--aim`), `tests/aim3d.test.ts` (new),
  `tests/spatial.test.ts`.

---

## 14. Phase 2C: spatial beams (2026-11-16)

Scope (Phase ↔ Stage mapping in the header): the beam half of roadmap Stage 5B, on the Phase 2B aim (Stage 4A) and the
Phase 2A queries (Stage 3), plus one cover policy for every spatial attack trace. Roadmap Stage 2C (input acceptance) is a
different item and is untouched. No melee, chain, lobbed, homing or ground-zone move changed; no damage, cooldown, range,
width or duration number changed.

Files: `src/sim/moves.ts` (`beam3D`, `coreSees`, `beamContacts`; the `beam` archetype branches to it), `src/sim/aim.ts`
(`combatFlags`, `beamLength`; beams' reach and world radius in `resolveSpatial`), `src/sim/spatial.ts` (`QF.foliage`, the
per-world foliage map, a `flags` argument on `solidAt` / `segmentClear`), `src/sim/effects.ts` (linear shots use
`combatFlags`), `src/sim/types.ts` (beam event fields), `src/rules/defaults.ts` (`aim.archetypes` + `'beam'`,
`aim.beamWorldRadius`, `aim.foliageCover`), `src/render/renderer.ts` (3D ribbon, end puff), `scripts/lib/aimbot.ts`
(visibility by the same cover rule), `scripts/checksum.ts` (`aim-2b`), `tests/beam3d.test.ts` (new).

### 14.1 Prerequisites re-verified (before any change, this checkout)
- `npm run typecheck` clean; `npm test` **434 tests, 432 pass, 0 fail, 2 todo** (I1, I2), as §13.7 states.
- `npx tsx scripts/checksum.ts`: all 48 lines byte-identical to §6.3 (Phase 0 sets, `aim` and `aim-off` from Phase 2B).
- Contracts as §13.4 records them: `resolveSpatial` (camera trace, muzzle, launch, obstruction), `sweep` with ordered contacts
  and the stray pass (`enemyBroad`), `DECK_SLAB` 0.6 m, `MASK`, `QF`. Checked in code, not taken from the handoff.
- **World.sight.** The two `todo` tests (I1 slab band, I2 sampled corners) have an owner (Stage 7A, enemy line of fire on
  `segmentClear`) and a gate (the test turns active and passes; enemy hashes migrate once, §6.1 rule 2). Phase 2C does not
  depend on them: no beam code calls `World.sight` (`raycastWorld`, `sweep` and `segmentClear` only), so neither defect
  can reach a beam. They stay `todo`, unchanged.
- **Strays (relocated enemies).** The beam's width test is a `sweep`, which tests strays where they are (§13.2). A test
  relocates an enemy after the rebuild onto the beam's line and the beam hits it on that tick; with the stray pass disabled
  that test fails (§14.6).

### 14.2 Defects reproduced on the current code (the planar beam, `moves.ts` before this phase)
The planar beam is a 2D capsule from the partner's centre: every enemy whose centre lies within `range × area` along the aim
and within `radius + E.radius` of the line takes damage, at any height, through anything. Each row is a case in
`tests/beam3d.test.ts` run on both paths (`PHASE2B` = `aim.archetypes ['bolt', 'orb']`, `foliageCover: true`):

| Case | Planar beam today | Spatial beam |
|---|---|---|
| **The reported case**: enemy on a 4 m plateau 9 m out, lip 5.5 m out; the line from the partner's chest (0.8 m, where the planar beam is drawn) and from the muzzle are both blocked | damaged | no damage; the beam ends on the cliff face (terrain, z = 5.5 m, y < 4 m) |
| Camera sees over the lip (lens 6 m up), the muzzle does not | damaged | no damage, `blocked` reported, ends on the cliff |
| Pillar 1.5 m ahead, right-shoulder lens sees past it | damaged | ends on the pillar face; `blocked` |
| Flier 4 m up on the crosshair, a ground enemy under the line | both damaged | the flier only |
| Tree trunk, boulder, pillar, stalagmite between | damaged | ends on the wall face |
| Rock (0.75 m) in front of a Tiny partner (muzzle 0.36 m) | damaged | ends on the rock; a Medium beam above its top passes |
| Deck: enemy on top from below; enemy below from on top | both damaged | slab between: no damage (underpass: hit) |
| Enemy within the width but behind a wall face beside the line | damaged | not reached (the core cannot see it) |
| Authored pierce ≥ 0 on a beam | ignored (hits all) | honoured: ends on the body that uses it up |
| Visual | drawn at the partner's chest height at render time (`P.y + 0.8`), full length, whatever it hit | drawn from the muzzle to where the core stopped, in 3D |

Further findings:
- **B1 (R) foliage was cover for every spatial trace**, against the authored material table: `rules/surfaces.ts` gives
  leaf `blocksShots: false`, but nothing read it, so a bush (a 0.7 m platform) stopped a Tiny partner's shots and a hedge
  or berry bush was an infinite wall to the crosshair, the shots and (now) the beams. Fixed (§14.3).
- **B2 (R) a fixed contact list truncated crowded beams.** A first version kept 96 contacts; a 15 m beam through a dense
  500-enemy Mt. Moon crowd met 323 bodies, so the farthest were silently not hit. The list is now sized from the pools
  (`beamContacts`: enemy cap + body cap), as the planar beam's 4096 scratch was; a test puts 150 bodies on one beam.
- The planar beam ignored the spawn guard (it hits enemies under 0.25 s old, as every area does); the spatial beam keeps
  that (`QF.spawning`), so the move's reach in time is unchanged.

### 14.3 The cover policy for spatial attacks
One rule, read by the camera trace, the muzzle, linear shots and beams (`aim.ts` `combatFlags`):
- `spatial.ts` builds, per map, which tiles foliage owns: a prop with a material row whose material does not block shots
  (`MATERIALS[..].blocksShots` false: leaf). Ownership follows `PropField.at` (the last prop with a material row on a
  tile; decoration such as flowers, reeds and tall grass claims nothing).
- With `QF.foliage` such a tile is open air above its ground: its wall column or low-prop platform is not cover. The deck
  over it, the ground under it and every other tile are unchanged.
- Cover stays cover: tree trunks (`tree`, `tree2`, `round`, `blossom`, `elder`, `deadtree`, `icepine`: wood), boulders,
  rocks, pillars, statues, graves, crystals (stone), fences, stumps, logs, cabins (wood), and every wall with no material
  row (`thicket`, `stalagmite`, rock masses, cliffs). Open: `bush`, `bushR`, `bushB`, `hedge`, `berry`, `mushroom`.
- `rules.aim.foliageCover` (default false) restores the Phase 2B behaviour; `aim-2b` uses it.
- Scope: player attacks on the spatial path only. Movement (hedges still block walking), navigation, `World.sight` and
  enemy fire are unchanged; enemy parity is Stage 7A (Q8). The test "foliage on real maps" checks every leaf tile is open
  and every other wall or low-prop tile stays solid on the meadow and dusk classic maps and generated Viridian Forest and
  Mt. Moon.
- Tree crowns: a tree is a 2 × 2 wall footprint, an infinite column, so its crown is cover to any height (Q3; R1b, §23, ends it at the tree's 2.75 m top).

### 14.4 The beam contract (`moves.ts` `beam3D`)
A cast takes it when `spatialFor` holds (flag, ray, player-aimed, `'beam'` in `rules.aim.archetypes`). Then:
1. **Aim.** `resolveSpatial` as for shots (§13.5): camera trace → aim point T; muzzle M (class height × 0.6, footprint × 0.9
   ahead); direction u = M → T (along the ray within 0.5 m). The reach is `beamLength` = range × area, and the obstruction
   sweep uses the beam's width and `beamWorldRadius`.
2. **Core against the world.** `raycastWorld(M, u, length, SK_WORLD, beamWorldRadius = 0, combatFlags)`: the first wall
   column, terrain, deck slab, liquid surface or map bound ends the beam there. A muzzle that starts inside a solid (an
   Extra Large body under a low deck, claim 8c) ends at once, truthfully (Stage 6C owns the body).
3. **Width against bodies.** `sweep` of the actor kinds (enemies, rocks and other bodies; held bodies skipped) with the
   move's radius as radius and half-height, up to that end, spawn guard included. Contacts in `(t, kind, id)` order.
4. **Line of sight from the core** (`coreSees`): a contact counts only if the open segment from the core's closest point to
   the body's centre (kept just before the end) to the body cylinder's nearest point is clear (`segmentClear`, same flags).
   The width never reaches around a corner or through a slab beside the line.
5. **Penetration.** `pierce < 0` (every beam as authored): all reached bodies. `pierce ≥ 0`: counts down on each body it
   touches; the one that uses it up ends the beam at its contact (`why: 'actor'`).
6. **Effects.** Each reached enemy takes `damageEnemy(s.dmg, knock along the beam's heading)`; each body `moveOnBody` (Push,
   Hold, integrity). Planar, under the clipped beam: enemy shots it crosses (`forceOnShots`, a capsule from M along the
   heading to the end's horizontal distance) and ground agents (every 1.5 m from M to that distance).
7. **Events.** `beam {x1, y1, z1 (= M), x2, y2, z2 (= end), width, life, why: 'world' | 'actor' | 'range', kind, hits}` and
   `cast {tx, tz = end, o: {o: M, t: T, kind, blocked}}`. The renderer draws the ribbon between the two points and a puff at a
   world end. Without `y1` (the planar beam) it draws as before.

Truthfulness (asserted by `truthful()` in every spatial test): the cast's muzzle is the ribbon's start and its target point
the ribbon's end; a world end has solid 2 mm past it and open air 2 mm before; a range end is exactly the length; every
damaged enemy, at the position it had when hit (knockback is a velocity, applied later), lies inside the drawn band (the
segment grown by the width, horizontally and vertically); the event's `hits` equals the enemies damaged plus bodies struck.

### 14.5 Move families
| Family | Archetypes / moves | Phase 2C |
|---|---|---|
| Beam | `beam`: Solar Beam, Dragon Rage, Bubble Beam, Hydro Pump, Signal Beam, Hyper Beam, Acid Spray, Ice Beam, and every `*beam*` / `*ray*` key the classifier maps there; Pressure Jet (Water Gun's beam transform) | **migrated**: all share one archetype implementation and differ only in data (range, width, knock, duration, Push), so they are truly equivalent; `duration` is the ribbon's life (the damage is instantaneous at the cast, as before) |
| Linear shot | bolt, orb | Phase 2B; now with the foliage rule |
| Linear shot | barrage | not migrated (4B; spread jitter decision) |
| Chain | chain (Thunder Shock, …) | not migrated: the other half of 5B (hops need LOS and a rise limit) |
| Seeker, arc, return, attached | homing, drain, lob, meteor, smite, boomerang, orbit | not migrated (4B) |
| Melee, self area, placed area | strike, dash, spin, cone, nova, aura, vortex, trail, trap | not migrated (5C) |
| Enemy fire | `shootHostile`, enemy melee | not migrated (7A) |

No beam has a special mechanic beyond its data, so there is no separate declarative mechanic to test; Pressure Jet's (a
transform: shorter, narrower, Push 2, self-root) is covered by its own case.

### 14.6 Tests (`tests/beam3d.test.ts`, 19 cases, real `step()` on a private flat world)
The reported case; camera clear, muzzle blocked; close-range obstruction (a pillar the shoulder lens sees past, and a wall
0.6 m ahead); a 4 m flier versus a ground enemy under the line; a plateau enemy hit from below and one hit from the top;
tree trunk, boulder, pillar and stalagmite; a rock against Tiny and Medium muzzles; foliage (hedge, bush, blue bush, berry)
open, and cover with `foliageCover`; foliage on four real maps; decks (underside or slab edge from below, the underpass, the
slab between layers from on top); width (Tiny and Extra Large targets 0.05 m inside and outside); adjacent geometry (the
width does not reach behind a wall face; the core runs along it); multiple targets in contact order against pool order, a
rock struck, authored pierce 0 and 1; a crowded line of 150; range ± 0.1 m; Tiny, Medium and Extra Large partners from both
shoulders (muzzle height grows with class); a relocated stray; determinism (a 360-tick scripted replay twice: identical
state hashes and beam events) and the flag (Phase 2B rules with or without a ray, and the new rules without a ray, give
identical hashes: the planar path); Pressure Jet.
- Red before: on the Phase 2B defaults, 17 of the first 18 cases failed (the 18th, "foliage on real maps", tests
  `spatial.ts` directly with the flag). Mutations: `coreSees` disabled fails "adjacent geometry" only; the stray pass disabled
  fails "a relocated enemy" only.
- Whole suite: **453 tests, 451 pass, 0 fail, 2 todo** (I1, I2). `npm run typecheck` clean.

### 14.7 Gates (2026-11-16, this checkout)
- `npx tsx scripts/checksum.ts`: every set except `aim` byte-identical to before this phase (`off` … `gen-size-off`, `on`,
  `gen`, `aim-off`). `aim` moved on purpose (§6.3). New `aim-2b` = the Phase 2B `aim` hashes exactly.
- Balance (bot + `aimbot` ray, 4 checksum starters × seeds 1-6 × 240 s, means of 24 runs; beams are cast by Bulbasaur,
  Charmander and Totodile in these runs):

  | Map | Layer | Survived | Level | Kills | Bodies per beam | Beams ending on the world |
  |---|---|---|---|---|---|---|
  | classic | Phase 2B | 15 | 14.1 | 686 | (planar) | — |
  | classic | foliage open only | 14 | 13.5 | 665 (−3 %) | (planar) | — |
  | classic | spatial beams only | 12 | 13.3 | 625 (−9 %) | 2.50 | 42 % |
  | classic | Phase 2C (both) | 13 | 13.1 | 637 (−7 %) | 2.71 | 41 % |
  | generated | Phase 2B | 11 | 11.9 | 562 | (planar) | — |
  | generated | foliage open only | 12 | 12.9 | 613 (+9 %) | (planar) | — |
  | generated | spatial beams only | 11 | 11.9 | 550 (−2 %) | 2.54 | 80 % |
  | generated | Phase 2C (both) | 10 | 12.2 | 552 (−2 %) | 2.54 | 78 % |

  Inside the ±10 % band of 4B on both map families; no beam number was changed. Single replays reshuffle which seeds die
  (Cyndaquil, which has no beam: Phase 2B loses classic seeds 5 and 6, the foliage rule seeds 2 and 4; mean kills 707 →
  720), so only the sweep is evidence. Most world ends are the ground behind a target the aimbot looks down on (Q10).
- `scripts/perf-sim.ts 500 --repeat 3 --gate`: PASS, bot min-of-3 p50 0.380 / p95 0.486 / p99 0.829 / max 1.052 ms (equal
  to Phase 2A/2B); `--aim` PASS, 0.404 / 0.506 / 0.841 / 2.114 ms (another crowd history).
- `scripts/spatialbench.ts --gate`: PASS (shot tick 0.41 µs meadow; no collection in any loop). `scripts/shotbench.ts
  --gate`: PASS; the first run read 2.98 µs per shot-tick on Mt. Moon 50 shots, two reruns 2.61 and 2.56 (Phase 2B: 2.61)
  with identical shot-tick counts, so the first was machine noise.
- Beam cast cost (aim resolution + cast + damage, min of 3 × 3000 casts, 500 invulnerable-player crowd): meadow 17.9 µs with 6
  bodies per beam; Mt. Moon 112 µs with 323 bodies per beam (damage applied to each). A beam fires at most every ~2 s.
- Production build: `scripts/build.mjs` copied with only the output paths (and the esbuild import path) changed, to a
  private directory: 17.2 MB. `dist/` untouched.
- Browser (headless Chromium on that build, capture mode, Viridian Forest seed 1, Totodile with Pressure Jet, chase view, a
  crosshair ray in the input): the renderer's ribbon starts exactly at the sim's muzzle (difference 0 on each axis), runs
  10.000 m (Pressure Jet's length) and the Rattata on it took 33.6 damage; with a wall tile written between them, the ribbon
  ends at the wall face (x = −16.000, 2.18 m) and the Rattata took 0.
- Not run, not applicable: `navwalk`, `stuckwatch` (no movement or navigation change), `camstats` / `chasecheck` (the rig is
  unchanged), habitat and hazard gates (no habitat, hazard or objective code changed; they drive the bot, which sends no
  ray, and the bot sets on classic and generated maps are byte-identical).

### 14.8 Remaining exceptions (each with an owner and a gate)
| Exception | Where | Owner | Gate |
|---|---|---|---|
| The planar beam (no ray: the bot, Classic / Overhead / Wide, `combat.mode` 'auto', the basic attack under 'assist', `aim.spatial` off) still damages through cover and at any height | `moves.ts` beam, the planar branch | 7A (the bot sends a ray; auto and assist acquire visible targets, 5A) and 7B (the fixed views send a ray built from their ground aim point) | §14.9 |
| Planar shots (traj 0) keep N1 (pierce in grid order) and N2 (tunnelling) | `effects.ts` | 7A / 7B | the two cases in `tests/spatial.test.ts` pin both paths; §14.9 |
| `World.sight` I1 / I2 | enemy line of fire | 7A | the `todo` tests active; one enemy hash migration |
| Enemy fire treats foliage as cover (asymmetric with the player since this phase) | `World.sight`, `shootHostile` | 7A (Q8) | enemy fire on `segmentClear` with `combatFlags` |
| Tree crowns are cover to any height | `spatial.ts` wall column | done in R1b (§23) | `QF.tops`: a wall prop ends at its `World.wallTop` |
| A beam's ground agents, its Push / Hold on enemy shots and its knockback are planar (under the clipped beam, along its heading) | `beam3D` | agents 5C; interception 7A | a beam over a gap paints nothing under it; shots met in 3D |
| Beams aimed down end on the ground behind the target | the D3 aim model | product (Q10) | playtest |
| `thicket` has no material row, so it is cover | `rules/surfaces.ts` | content | add a row if it is meant as foliage |
| `cast.o.blocked` is false when the crosshair itself rests on the cover (the beam still ends there; the marker sits on it) | `aim.ts` (Phase 2B rule) | 5A reticle work | — |
| Plain `grid.query` readers miss strays for one tick (chain, areas, magnetism) | `moves.ts` | 5B chain, 5C, 7A | each family moved onto `sweep` / `overlap*` |

### 14.9 Planar retirement plan (concrete)
1. **7A:** the bot builds a crosshair ray from its own target (as `scripts/lib/aimbot.ts` does today, with the cover rule), so
   the `on` and `gen` sets cover the spatial path; the 'auto' and 'assist' modes pick targets the muzzle can see. One
   documented migration of `on` and `gen`; older sets turn `aim.spatial` off and keep their hashes.
2. **7B:** the fixed views send a ray (from above the partner's chest through their ground aim point), so no runtime input
   reaches the planar beam or traj 0 shots. Gate: a test that, with default rules, every player cast in chase, Classic,
   Overhead, Wide and 'auto' emits a 3D beam event (`y1` set) or a traj 1 shot.
3. **Retirement:** the planar code stays only while a checksum set needs it (`off` … `size-off`, `aim-off`, `aim-2b`). Q9
   (product owner): freeze those sets' recorded hashes as historical and delete the planar branches, or keep them. Until
   then the planar beam is legacy behaviour reachable only by replays, never by a player in the chase view.

### 14.10 Handoff
- **Status:** PASSED (scope above).
- **Next:** chain (the rest of 5B: first target as a seeker, hops with `segmentClear` and a rise limit, on `sweep` /
  `overlapCylinder` so strays are met), then 5A (device assistance), 5C, Stage 1's `tp-human`, Stage 2C (input).
- **Manual:** nobody has seen a spatial beam with a mouse or a gamepad (§9 item 9); the ribbon placement was checked
  headless only.


---

## 15. Phase 3: primary-fire input acceptance (2026-11-16)

Scope (Phase ↔ Stage mapping in the header): the **fire** half of roadmap Stage 2C (edge-preserving capture, a bounded fire
buffer, the `fireQueued` / `fireDropped` events) and the planar-path part of Stage 5A (per-device assistance). The jump half
of 2C (`jumpLatch`, `jumpPressed`, `rules.player.jumpEdge`) is **not** in this phase. No wind-up, cooldown, damage or range
number changed, no animation changed, and no move moved family.

Files: `src/sim/types.ts` (`InputFrame.press`, `MoveSlot.queued`, events), `src/sim/moves.ts` (slot state machine,
`offerQueue` / `dropQueued`, device policy in `resolveAim`, `AIM.lead`, `cast.assist`), `src/sim/aim.ts` (`assistSees`),
`src/sim/checksum.ts` (a queued press is hashed when present), `src/rules/defaults.ts` (`combat.fireBuffer`,
`aim.deviceAssist`, `aim.assist`), `src/input/input.ts` (`pressLatch`, pad edges), `src/main.ts` (`aimDev` in the fixed
views), `src/render/renderer.ts` (assist ring), `scripts/firetiming.ts` (new), `tests/primaryfire.test.ts` (new),
`tests/combat.test.ts`, `tests/aim3d.test.ts`, `tests/beam3d.test.ts` (legacy rule sets), `README.md`, `docs/THIRD_PERSON.md`.

### 15.1 Prerequisites re-verified (this checkout, before any change)
- `npm run typecheck` clean; `npm test` **453 tests, 451 pass, 0 fail, 2 todo** (I1, I2), as §14.6 states.
- `npx tsx scripts/checksum.ts`: 52 lines, saved and diffed after every change below.
- Phases 1–2C in code, not from the handoff: `runFrame` samples once per frame after look (`hostframe.ts`); `InputFrame.aim`
  / `aimDev` reach `resolveSpatial`; bolt, orb and beam take the spatial path with no magnetism or lead; every other family
  goes through the planar `resolveAim`.

### 15.2 Mechanisms traced (the claims of the brief, against the code and measured ticks)
| Claim | Verdict | Evidence |
|---|---|---|
| Basic attacks have ~60–140 ms wind-ups | **C R**, refined | `rules.feel.windup` 0.06–0.14 s. The sim subtracts `dt` until the wind-up is no longer positive, in floating point, so the real release is: 0.06 → 4 ticks (67 ms), 0.07 → 5 (83), 0.08 → 5 (83), 0.09 → 6 (100), **0.1 → 7 (117 ms, not 100: six steps leave 1e-17)**, 0.12 → 8 (133), 0.14 → 9 (150). Seven archetypes (strike, cone, nova, aura, lob, orbit, trap) carry the extra tick |
| Cooldowns ~0.7–1.6 s, move-dependent | **C R**, wider | basic attacks of the roster: bolt 0.60–0.63 s, strike 0.72–0.75, orb 0.85, barrage 1.02, cone / drain 1.11, chain 1.19, boomerang 1.39, lob 1.53, dash 1.59–2.02, nova 2.04–2.26 s (level 1, haste 1) |
| Presses discarded during cooldown | **C R** | `movesSystem`: during the cooldown the button is not read; at ready it must still be held. Measured: a one-tick tap 1, 3, 6, 9, 12, 15, 20 or 30 ticks before ready was dropped **every time, for every family** (`scripts/firetiming.ts legacy`) |
| Press-triggered and held attacks differ | **C R** | a press on a ready slot is accepted on its own tick (0 ticks); holding repeats on the cooldown. Tapping at 8 Hz cast fewer attacks than holding: bolt 15 vs 17 in 10 s, orb 11 vs 12, strike 13 vs 14, barrage DPS 142 vs 174 (−18 %), orb 47 vs 55, lob 39 vs 45 |
| Animation, hit-stop and release are coupled | **C**, host only | the sim never waits for animation: the wind-up is a rules number, the renderer plays `windup {dur}` and `cast` as they come (`renderer.ts` `playerAttack`). Hit-stop is a host time scale (`main.ts`: `hitstopScale` 0.08 for 0.06 s big kill, 0.08 s hurt, 0.5 s boss kill), so the whole sim slows together and sim-time contracts hold; in real time a press waits up to the hit-stop's length plus one tick before its tick runs. It is **not lost**: `sampleInput` runs only on ticks, so the latch waits (test "input: a click … between two samples") |
| Legacy magnetism / automatic lead on manual aim | **C R** | spatial path (bolt, orb, beam through the crosshair): none since Phase 2B/2C. Every other family (strike, dash, cone, nova, chain, lob, boomerang, barrage, drain …) went through the 12° / 28° cone and the width snap for **every device, the mouse included**, with no sight test; planar shots, lobs (0.5 s) and meteors (0.4 s) led the snapped target |
| Hold cadence equals the declared cooldown | **R**, not quite | cadence = wind-up ticks + the refunded cooldown rounded up to ticks: bolt 37 ticks vs 35.7 declared, orb 52 / 51.0, strike 45 / 43.3, dash 96 / 95.4, nova 137 / 135.4, chain 73 / 71.4, lob 93 / 91.8, cone 68 / 66.3, boomerang 84 / 83.5, barrage 62 / 61.2, drain 67 / 66.3 (1–4 % slower; the 0.1 s wind-ups lose the most). Left as is: it is balance (§15.8) |
| Edge capture | **C** | `btnLatch` delivers a click that goes down and up between samples as one tick held. It cannot show a release and re-press inside one sample (the button reads held throughout), and the pad is polled (a pull shorter than a frame is missed) |

### 15.3 The input contract (landed)
Per button slot, every tick, in `movesSystem` (sim time; the host only delivers input):
1. **Press.** `InputFrame.press` carries the rising edges since the previous sample (`Input.pressLatch` for keys, mouse and
   touch; `padPrev` edges for the pad). `btn` stays "held this tick". The bot and older replays send no `press`.
2. **Accept.** The slot is ready (no wind-up, cooldown ≤ 0) and either its button is held or a press is queued: the cast is
   accepted on that tick (the aim resolved, `windup {queued?}` emitted). The press tick itself when ready: 0 ticks.
3. **Wind-up.** Committed: releasing the button never cancels it. It ends on the HitFrame tick (§15.2 table).
4. **Release.** The aim is resolved again and the move fires (`cast`); damage follows the move's own delivery.
5. **Cooldown.** `spec.cd − windup` (the refund), counted down at `dt × pressure`.
6. **Hold.** While held, the slot is accepted again on each ready tick: the cadence of step 5.
7. **Buffer.** A press while the slot is ≤ `fireBuffer[slot]` s (default **0.15 s = 9 ticks**, basic attack only) from ready
   (rest of the wind-up + refunded cooldown, or the cooldown, both at the current pressure) is **queued**
   (`fireQueued {wait}`); it is accepted on the ready tick, held or not, exactly once. Further presses while one waits
   are dropped (`fireDropped 'queued'`); presses farther out are dropped (`'early'`). Nothing ever auto-repeats from a
   queue: one press, at most one attack.
8. **Cancel / expire.** Tag held (it takes primary and secondary fire for the reserve pick) and carrying the egg (Move A / B)
   cancel a queued press at once (`'cancel'`). A queued press older than `2 × window + 1` ticks is dropped (`'expired'`):
   the evolution and stage-transition cinematics (the tick runs, the moves do not), a Tag swap or a faint that leaves it on a
   benched member. `combat.mode` 'auto' reads no press.
9. **Pause and focus loss** (host): `setPaused` and the pointer-lock loss call `Input.clearButtons()`, and window blur does
   too: pending presses and held buttons are cleared, so nothing new reaches the sim. A paused sim runs no tick, so a
   wind-up or a press already queued is frozen with sim time and resolves on resume, as before.
10. **No player stun exists.** Paralysis halves move speed only; it blocks neither casting nor the buffer (tested).

### 15.4 Device assistance (planar path, `rules.aim.assist`, flag `rules.aim.deviceAssist`)
| Device | Shots (cone) | Melee: strike, cone, spin, dash, aura, nova | Lead | Sight |
|---|---|---|---|---|
| mouse | 0° (no cone, no width snap) | 0° | no | — |
| stick | 12° | 28° | yes | the partner's chest must see the enemy (`assistSees`: `segmentClear`, attack cover policy) |
| touch | 12° | 28° | yes | as stick |
| none (bot, scripted input, older replays) | `combat.magnetDeg` 12° | `meleeMagnetDeg` 28° | yes | none (legacy) |

- The host now sends `aimDev` in the fixed views too (cursor → mouse, right stick or touch → stick); chase keeps its rule.
- **Visible:** an assisted cast names its enemy (`cast.assist`), and the renderer draws a 0.25 s pale ring under it.
- Seekers keep their identity: chain, homing and drain acquire the enemy nearest the aim point (`needTarget`, 5 m) for every
  device. That is the family's targeting (D8), not magnetism of a direct attack. The spatial path still has no assistance for
  any device (Phase 2B rule; pad assistance in 3D remains Stage 5A).
- `deviceAssist: false` ignores the device (the Phase 2C layer exactly); `tests/aim3d.test.ts` `LEGACY` and
  `tests/beam3d.test.ts` `PHASE2B` set it (§6.1 rule 3).

### 15.5 Timing measured after the change (`npx tsx scripts/firetiming.ts`, ticks of 1/60 s)
| Family (species, move) | cd s | w s | press→accept | →release | hold casts / 10 s | gap | tap k ticks before ready: delay (1,3,6,9 / 12–30) | taps 3 / 5 / 8 Hz casts | DPS tap 8 Hz / hold |
|---|---|---|---|---|---|---|---|---|---|
| bolt (Cyndaquil, Ember) | 0.595 | 0.07 | 0 | 5 | 17 | 37 | 1 3 6 9 / dropped | 15 17 17 | 51 / 51 |
| orb (Squirtle, Bubble) | 0.850 | 0.09 | 0 | 6 | 12 | 52 | same | 10 12 12 | 55 / 55 |
| strike (Bulbasaur, Vine Whip) | 0.722 | 0.10 | 0 | 7 | 14 | 45 | same | 12 14 14 | 69 / 69 |
| dash (Impidimp, Fake Out) | 1.589 | 0.06 | 0 | 4 | 7 | 96 | same | 6 7 7 | 26 / 26 |
| nova (Magcargo, Earth Power) | 2.256 | 0.10 | 0 | 7 | 5 | 137 | same | 5 5 5 | 8 / 8 |
| chain (Pichu, Thunder Shock) | 1.190 | 0.12 | 0 | 8 | 9 | 73 | same | 8 9 9 | 24 / 24 |
| lob (Slugma, Smog) | 1.530 | 0.10 | 0 | 7 | 7 | 93 | same | 6 7 7 | 45 / 45 |
| cone (Snom, Powder Snow) | 1.105 | 0.10 | 0 | 7 | 9 | 68 | same | 9 9 9 | 16 / 16 |
| boomerang (Chikorita, Razor Leaf) | 1.392 | 0.08 | 0 | 5 | 8 | 84 | same | 7 8 8 | 41 / 41 |
| barrage (Heracross, Arm Thrust) | 1.020 | 0.08 | 0 | 5 | 10 | 62 | same | 10 10 10 | 174 / 174 |
| drain (Oddish, Absorb) | 1.105 | 0.08 | 0 | 5 | 9 | 67 | same | 9 9 9 | 41 / 41 |

Before (`firetiming.ts legacy`, identical to the pre-change code line for line): every pre-ready tap dropped; 8 Hz taps
cast 15 / 11 / 13 / 7 / 5 / 8 / 7 / 9 / 7 / 10 / 9 and DPS 48 / 47 / 64 / 26 / 8 / 22 / 39 / 16 / 41 / 142 / 37 (same order).
After: a tap within 9 ticks of ready casts on the ready tick (delay = k), mashing at 5–8 Hz reaches the hold cadence and never
exceeds it; press→accept and wind-up lengths are unchanged for every family. Host side, a press reaches the sim on the next
tick (0–16.7 ms at 60 Hz; up to the hit-stop length during a hit-stop).

### 15.6 Tests (`tests/primaryfire.test.ts`, 20 cases, real `step()`; Input on a stubbed DOM)
Single click when ready; click 1, 2, 5 and 9 ticks before ready (one cast on the ready tick after release); clicks 10, 20,
30 ticks out (dropped, event); the window as a rule (`fireBuffer` 0 drops a press one tick out; 0.3 queues 15 out); input
without `press` never queues; rapid taps every 2, 4, 7, 12 ticks (no two accepts closer than the cadence, mashing keeps the
cadence, every accept backed by a press); hold with extra presses (steady cadence, no double); release during the cooldown
and during the wind-up; a press during the wind-up; Tag cancel, carrying cancel (Move A with a buffer), paralysis keeps it;
an evolution expires it, a pause keeps it; assist and auto modes; all 11 basic-attack families (accept on ready, release after
the family's own wind-up); determinism (state hash and event log twice); DPS (8.6 Hz taps = hold within one cast, never more
casts, one slow tap = one attack) for Cyndaquil, Heracross, Slugma; device assistance (mouse direct, stick bent and named,
stick blocked by a wall, no device legacy, `deviceAssist` off legacy, melee strike mouse / stick); Input: a tap between two
samples, held is not a press, re-press inside one sample is, key auto-repeat is not, pause and blur clear, pad edges.
- `tests/combat.test.ts` "a press only during the cooldown is dropped" now sends a real `press` and runs with `fireBuffer` 0
  and with the default (the press is ~27 ticks out, so it is dropped either way); its old version sent no `press`.
- Red before: with the default buffer set to 0 and the device policy disabled, 8 of the 20 fail (every buffer, cancel,
  expiry, family, DPS, determinism and assistance case); against the pre-change code they cannot even queue.
- Whole suite: 473 tests, 471 pass, 0 fail, 2 todo (§15.7).

### 15.7 Gates (2026-11-16, this checkout)
- `npm run typecheck` clean. `npm test`: **473 tests, 471 pass, 0 fail, 2 todo** (I1, I2; +20 new).
- `npx tsx scripts/checksum.ts`: **all 52 lines byte-identical** to before this phase (every set: the bot and the aimbot send
  no `press`, and the aimbot sends no `aimX`, so neither the buffer nor the planar device policy is reached). No set added.
- `scripts/perf-sim.ts 500 --repeat 3 --gate`: PASS, min-of-3 p50 0.383 / p95 0.491 / p99 0.838 / max 1.081 ms (Phase 2C: 0.380 / 0.486 / 0.829 / 1.052). The new per-slot work is a few comparisons; `assistSees` runs only for input that names a stick or touch device, never for the bot.
- `habstate` 24/24, `hazplay` 49/49, `habplay all 6 1 --raid` 72/72 (bot-driven; identical inputs and hashes, so identical outcomes expected).
- Production build into a private directory (`scripts/build.mjs`, output paths only changed): 17.2 MB; `dist/` untouched.
- Browser (headless Chromium on that build, capture mode, classic view, Cyndaquil, real `MouseEvent`s dispatched on the
  canvas, so the real `Input` and `sampleInput`): a click is accepted on the next tick; a click 4 ticks before ready is queued
  (`MoveSlot.queued` set, cooldown 0.058 s) and casts (2 casts in all); a click right after an accept is not queued.
- Not run, not applicable: `navwalk`, `stuckwatch` (no movement), `camstats` / `chasecheck` (no camera change), `habaudit`
  (no generator change).

### 15.8 Balance implications and families needing later tuning
- Sweep (the bot's own input, 4 checksum starters × seeds 1–12 × 240 s, classic maps; primary fire either held as the bot does,
  or turned into one-tick taps every 10 ticks = 6 Hz with press edges, the rest of the bot's input unchanged):

  | Primary fire | Survived | Level | Kills | Damage / s alive | Basic casts / s alive | Presses queued / dropped early |
  |---|---|---|---|---|---|---|
  | held (bot; = before and after, hashes identical) | 37/48 | 14.7 | 761 | 752 | 1.545 | 0 / 0 |
  | 6 Hz taps, `fireBuffer` 0 (before) | 31/48 | 13.8 | 668 | 723 | 1.330 (−14 %) | 0 / 38 662 |
  | 6 Hz taps, default buffer (after) | 29/48 | 14.0 | 688 | 719 | 1.504 (−3 %) | 11 435 / 36 940 |

  The clean signal is the basic cast rate: the buffer recovers a tapping player's rate to within 3 % of holding (the rest is
  the 1 in 10 ready ticks with no tap in the window). Survival and total damage move inside run-to-run chaos: one shot on a
  different tick reshuffles which seeds die, as in §14.7. Legacy and buffered tapping are within two runs of each other
  at equal damage per second. Both trail holding by more than the cast rate explains. Checked and ruled out: Tag
  hold-picks (the bot never held Tag with basic in these runs) and Hold-power catches (no tick held anything by primary
  fire in 12 runs either way). It is unexplained and needs a larger sweep. It is not attributable to the buffer, because
  legacy tapping shows it too.
- **Holding is unchanged** (every bot hash identical), so the balance of a player who holds primary fire does not move. A
  player who taps gains up to the hold rate: +14 % basic casts in the sweep above, up to +22 % DPS on barrage at 8 Hz. This
  is the intended removal of a tapping penalty, not a buff past the declared cadence.
- **Mouse players lose planar magnetism** on the non-migrated families. For strikes and cones the area still covers a
  near miss; lobs and boomerangs now land where aimed. Needs a mouse playtest (§9 item 6 and below).
- Later tuning (owner: a balance pass; none changed here, the brief excludes arbitrary balance changes):
  1. **0.1 s wind-ups release on tick 7** (117 ms): strike, cone, nova, aura, lob, orbit, trap. An epsilon in the wind-up
     test, or authoring 0.1 as 6 ticks, fixes it; it moves every bot hash (the bot casts these), so it needs a flag and a
     recorded migration.
  2. **Hold cadence is 1–4 % slower than the declared cooldown** (tick rounding, plus item 1). Carrying the overshoot into the
     next cooldown would make it exact; same hash consequence.
  3. **Slow basics feel committed by design**: nova (2.0–2.3 s), dash (1.6–2.0 s), lob (1.5 s), boomerang (1.4 s). A 0.15 s
     buffer is small against them; whether they want a longer window (`fireBuffer` per slot already allows it) or a faster
     cadence is a feel decision for a playtest.
  4. **Move A / B / Signature buffers are 0.** The mechanism supports them (`fireBuffer[1..3]`, tested for Move A); the
     Signature's button is also Tag, so it should stay 0.
  5. **Seekers (chain, homing, drain)** acquire near the aim point for every device; a sight test at acquisition is 5B / 4B.
  6. **Spatial-path pad assistance** (bolt, orb, beam with a stick) is still none: Stage 5A.

### 15.9 Remaining exceptions
| Exception | Owner | Gate |
|---|---|---|
| Jump: no latch, held re-jumps (claims 8a, 8b) | Stage 2C jump half | `jumpPressed`, `rules.player.jumpEdge` |
| A pad pull shorter than one frame is missed (polled) | host; no Gamepad event API | measure with a real pad |
| Two separate clicks inside one sample count as one press | by design (one sample = one edge) | — |
| The assist ring is the only HUD cue (no reticle change for an assisted aim) | 5A reticle work | — |
| `tp-human` recorded fixture still absent, so no checksum set exercises `press` | Stage 1 | a set replaying recorded taps |

### 15.10 Handoff
- **Status:** PASSED (scope above).
- **Next:** the jump half of Stage 2C; the `tp-human` fixture (it would make `press` part of the replay gates); a mouse and
  gamepad playtest of the buffer and the assistance (§9 item 6, plus: tap a nova or dash basic during its cooldown; aim a
  Vine Whip with the mouse beside an enemy: it should not bend); then 5A for the spatial path.

---

## 16. Phase 4A: player-owned free look and the vertical aiming envelope (2026-11-16)

Scope: roadmap Stage 6A (D10). Render only: no file under `src/sim/` or `src/world/` changed, so every checksum set is
unchanged by construction, and was diffed anyway. The camera composition was not redesigned: boom lengths, elevations,
shoulder, FOVs, collision, climb, smoothing and the 120 Hz clock are untouched. No jump physics, movement-facing or attack
number changed.

Files: `src/render/camera.ts` (`CHASE_CONFIG.aimPitch`, `lookPitchRange()`, the axis rule in `step`, `update` and `look`),
`src/render/renderer.ts` (one line: the rig gets `lookPitchRange()`), `scripts/camstats.ts` (`--legacypitch`, `--sweep`),
`tests/freelook.test.ts` (new), `tests/chase.test.ts`, `tests/viewsample.test.ts`, `tests/aim3d.test.ts` (the harnesses pass
the band in force), `docs/THIRD_PERSON.md`.

### 16.1 Prerequisites re-verified (this checkout, before any change)
- The view contract of Phase 1 is in code: `runFrame` does look, then one `ViewSample`, then the ticks. `ChaseRig.look`
  recomposes the view at once. `aimRayOf(view)` is the `InputFrame.aim` the sim traces (`sim/aim.ts`).
- `tests/aim3d.test.ts` and `tests/beam3d.test.ts` pass (direct shots and beams fly the 3D ray). `npx tsx scripts/checksum.ts`
  gives 52 lines, saved as the baseline. `npx tsx scripts/camstats.ts --fps 30,60,144` was saved as the baseline (108 runs).

### 16.2 Inventory (before)
| Item | Value / rule | Where |
|---|---|---|
| Mouse look gain | yaw 0.0022 rad/px, pitch 0.0018 rad/px (vertical is 0.82 × horizontal), × `sens` (0.6 / 1 / 1.6) | `hostframe.ts` `lookDelta` |
| Stick look gain | yaw 2.6 rad/s, pitch 1.5 rad/s (0.58 ×), × `sens` × frame `dt`; axial dead zone 0.18 with no rescale, linear; touch look reads as a stick | `lookDelta`, `input.ts` `pad()` |
| Invert Y | flips pitch for both mouse and stick | `lookDelta` |
| Player pitch | `userPitch` in [−14°, +20°] (+ = down) **around the state's tilt** | `CHASE_CONFIG.pitchRange` |
| State tilt | Explore 6°, Combat 7.5°, Pressure 10° below the horizon, blended over 0.25 s / 0.6 s | `CHASE_CONFIG.states` |
| Slope tilt | −0.5 × the walkable slope ahead, clamped to [−9°, +8°], eased over 0.5 s | `step`, `CHASE_CONFIG.slope` |
| Climb tilt | 0.7 × the boom's climb (up to 12°), so up to 8.4° | `CHASE_CONFIG.liftTilt` |
| View axis | `clamp(state tilt + userPitch + slope + 0.7 × climb, −40°, 70°)` | `step` |
| Boom elevation | `clamp(state elevation + userPitch, 2°, 40°)` + climb; under a deck, set by the slab | `step`, `elevFor` |
| Measured envelope | at most **8° up** in Explore (claim 6); down to 26° in Explore and 30° in Pressure, plus slope and climb. camstats worst view pitch: walk 22.2°, fight 25.8°. With no input, the axis travelled 14.4° median and 48.7° worst in a 20 s walk |
| Ground movement | `mx/mz` from the camera **yaw** only (`Input.sample(yaw)`); the aim ray's pitch never reaches `player.ts` | `main.ts`, `player.ts` |

What turned the crosshair with no input: the state blend, the slope tilt and the climb tilt (claim 6). The shake, the
shoulder swap, boom collision and jump follow move only the lens.

### 16.3 Choosing the envelope (measured, `ChaseRig` on synthetic terrain at the renderer's sizes)
The brief proposed ±75° as a starting point. The bounds come from three measurements.

**Down: where does the crosshair land on level ground?** Distance ahead of the feet (m; negative = behind the Pokémon). At
these angles the boom has reached its 40° elevation cap:

| View pitch down | 30° | 40° | 45° | 48° | 50° | 55° | 60° |
|---|---|---|---|---|---|---|---|
| Cyndaquil, Explore | 1.8 | 0.9 | 0.3 | 0.0 | −0.2 | −0.6 | −1.0 |
| Cyndaquil, Pressure | 3.3 | 0.9 | 0.1 | −0.3 | −0.6 | −1.2 | −1.7 |
| Feraligatr, Explore | 4.5 | 2.6 | 1.4 | 0.7 | 0.3 | −0.6 | −1.3 |
| Feraligatr, Pressure | 7.1 | 2.6 | 1.0 | 0.1 | −0.4 | −1.5 | −2.6 |

Past 48–50°, the crosshair only aims at the ground beside or behind the Pokémon. Raising the boom further would turn the
camera top-down, and its elevation cap is part of the composition the brief keeps. From a 4 m rim, the deepest look that
clears the lip is 43° for Cyndaquil, 44° for Charmander and 49° for Feraligatr when standing 0.5 m from the edge (34°, 37°
and 44° from 1.5 m back). The ground within 3.5–6 m of the cliff foot is hidden by the rim. **Down = 50°.**

**Up: when does the Pokémon leave the frame?** The boom cannot go below 2° of elevation. The head reaches the bottom edge at
about 31° up (Explore) to 35° up (Pressure), and the whole body is off-screen from 35–40° up, for every size. At 60° the frame
can be all sky (`cap-env` captures, §16.6).

**Up: what do targets need?** The pitch up from the Explore lens to the centre of an enemy standing 1 m back from a ledge H
metres high whose lip is D metres ahead:

| | H 4, D 1 | H 6, D 1 | H 8, D 1 | H 10, D 1 | H 6, D 4 | H 8, D 4 | H 10, D 4 |
|---|---|---|---|---|---|---|---|
| Pichu (Tiny) | 35° | 47° | 56° | 61° | 35° | 43° | 50° |
| Cyndaquil (Small) | 32° | 44° | 53° | 59° | 32° | 41° | 47° |
| Feraligatr (XL) | 14° | 26° | 35° | 43° | 19° | 28° | 35° |

Relief on 20 generated maps (seeds 1, 2, 3, 5, 7 × stages 0–3): walkable steps up to 4.2 m (median of the per-map maxima
2.3 m), relief up to 7.8 m, deck tops up to 7 m. Wild fliers hover only 0.9–1.35 m. An 8 m ledge right ahead needs 53–56°.
Nothing in the game needs more than 60°, and between 60° and 75° the frame shows only sky. **Up = 60°.**

### 16.4 The contract (landed)
- **`CHASE_CONFIG.aimPitch = { on: true, neutral: 6, up: 60, down: 50 }`.** With `on`, the view axis (and so `ViewSample.dir`
  and `InputFrame.aim`) is `neutral + userPitch`, exactly, in `step`, in the frame composition of `update` and in `look`.
  `userPitch` is clamped to `lookPitchRange()` = `[−up − neutral, down − neutral]` = `[−66°, +44°]`. Nothing automatic
  enters the axis. `on: false` is the pre-4A rig, bit for bit (camstats `--legacypitch` reproduces the baseline exactly).
- **Lens placement is unchanged for any given input.** The boom elevation is still state elevation + `userPitch` (within
  2°..40°) + climb, and boom length, shoulder, collision and FOV are untouched. Looking further down raises the lens up to its
  40° cap. Looking up holds it at 2°.
- **Ownership:** look input owns yaw and pitch. The rig's presentation (state, size, collision, climb, shoulder, jump follow,
  shake) owns the lens position. The sim owns nothing of the camera and still sees only the `InputFrame`.
- **Rate independence:** the axis is a pure function of the accumulated look input (mouse deltas per pixel, stick × frame
  `dt`). Nothing about it is interpolated between rig ticks, so 30, 60, 144 and 240 fps reach the same pitch and ray.
- **Ground movement:** unchanged and independent of pitch (`mx/mz` from yaw).
- **Slope probe:** under free look the slope probe (10 ground samples per rig tick) is skipped. Its state is legacy-only.

### 16.5 Behaviour changes (intended) and their consequence
- **Zero input, every state and size** (Pichu, Cyndaquil, Charmander, Feraligatr; Explore, Combat, Pressure): the lens, boom,
  shoulder and FOV are bit-identical to the pre-4A rig (test). The view pitch is unchanged in Explore (6°). In Combat it is 6°
  instead of 7.5°, and in Pressure 6° instead of 10°: the horizon sits up to 4° higher and the Pokémon slightly lower in the
  frame (`boss-a` captures).
- **Consequence: the ray now moves with the lens (Q11).** In Combat and Pressure the lens is higher and further back, as it
  always was. With the axis fixed, the crosshair ray moves up with the lens instead of being tilted back down. Zero input,
  level ground:

  | | Crosshair on the ground (m ahead of the feet), legacy → owned | Ray height 15 m ahead (m), legacy → owned |
  |---|---|---|
  | Cyndaquil Explore | 9.4 → 9.4 | −0.58 → −0.58 |
  | Cyndaquil Combat | 9.3 → 12.8 | −0.75 → −0.23 |
  | Cyndaquil Pressure | 8.4 → 17.7 | −1.16 → +0.29 |
  | Feraligatr Explore | 24.0 → 24.0 | 0.94 → 0.94 |
  | Feraligatr Combat | 22.2 → 29.8 | 0.95 → 1.56 |
  | Feraligatr Pressure | 19.1 → 38.4 | 0.73 → 2.46 |

  The old tilt kept the ground point roughly fixed, at the cost of turning the crosshair with no input. Now the direction is
  fixed and the ray moves in parallel by the lens rise (≤ 0.87 m for Small, ≤ 1.52 m for XL, eased over the 0.25 s state
  blend). An XL partner in Pressure aims over the head of a small enemy 15 m away unless the player pitches down. That is the
  player-owned contract the brief asks for. The alternative, the state's framing moved along the aim ray only, would lower the
  Combat and Pressure lens by 0.4–0.9 m: a change to the composition, so it is left to a playtest decision.
- **Slope and climb no longer tilt the view.** Walking up Mt. Moon's ramps or with a wall behind (the boom climbs), the
  player sees the slope as it is. The crest is not brought into frame automatically.
- **Shoulder swap.** The ray direction never moves, and its origin glides sideways with the lens (by about 2 × 0.24 × boom).
  (Under the legacy rig the same test also reports 0.27°. That comes from the rig's initial `viewPitch` of 0.1 rad settling
  to the 6° tilt on the first update, not from the swap.)

### 16.6 Camera stability (after)
- `npx tsx scripts/camstats.ts --fps 30,60,144` (108 runs): **every lens column is identical** to the baseline: idle 0 / 0,
  turn* 0 / 0, walkDvP99 1.44 / 15.4, walkJumpMax 0.26 / 7.56, fightDvP99 4.01 / 12.36, fightJumpMax 0.44 / 5.78,
  walkBoomTravel 9.2 / 24, fightBoomTravel 25 / 83.9, walkElevMax 9 / 26.5, fightElevMax 20.6 / 29, slides 0 / 815 (the F5
  run), fpsDev 0.004 / 0.269 (median / worst). The automatic axis travel is gone: walkPitchTravel 14.4 / 48.7° → **0 / 0**,
  walkPitchMax 7.1 / 22.2° → 6 / 6, fightPitchMax 14.9 / 25.8° → 6 / 6. The `--legacypitch` summary is byte-identical to the
  baseline's.
- **Full-envelope sweep** (`--sweep`: the 20 s walk while the pitch sweeps from 60° up to 50° down and back every 8 s; 36 runs
  at 60 fps; the F5 run, forest seed 3 Feraligatr, excluded and reported separately). The legacy column is the same sweep
  clamped to the old window, which reaches 8–10° up and 26–33° down:

  | | owned, median / worst | legacy window, median / worst |
  |---|---|---|
  | lens velocity change p99 (m/s) | 2.12 / 4.75 | 1.51 / 4.42 |
  | largest one-frame lens move (m) | 0.34 / 0.95 | 0.31 / 0.70 |
  | boom elevation max (°) | 38.7 / 50 | 28.1 / 38 |
  | safety-net slides | 0 / 1 | 0 / 1 |
  | axis error vs the player's pitch (°) | **0 / 0** (also at 30 and 144 fps) | — |
  | F5 run: jump / slides | 7.54 m / 813 | 7.54 m / 813 |

  The extra smoothness cost is the lens travelling further: down-looks lift it to the 40° cap, plus the climb. The worst
  frame step (0.95 m, Mt. Moon seed 1 Cyndaquil) is one safety-net slide on a cave wall, the existing "convex corners" limit
  of `docs/THIRD_PERSON.md`. The lowest lens clearance, −1.18 m (legacy −0.84 m), is the drawn lens 2–3 cm across the edge of
  a wall tile's column on Mt. Moon (seeds 1 and 2, Feraligatr), at the same spots as legacy. It is the tile probe, not terrain
  clipping. Median clearance is 0.55 m (legacy 0.59 m).
- `tests/viewsample.test.ts` walking test, with its pitch gesture free to use the whole envelope (it integrates to ±25°):
  lens p99 0.258 m, worst 0.690 m (legacy and owned-with-the-old-window: 0.265 / 0.333 m). The worst is one safety-net slide
  at frame 388 (`userPitch` −10.7°), on a path the old clamp never took. The test now keeps its gesture inside the window it
  was written for (§6.2).
- **Browser** (headless Chromium, private builds of this checkout, owned vs the same build with `aimPitch.on` patched off,
  `tools/chasecheck.json`): of the 17 in-page probes, every `elevMaxDeg`, `closeUpMax`, `jumpMax` and `boomRange` is
  identical. `viewPitchDeg` differs where it should: Pressure 10.9° → 6° and 10° → 6°, and a climb or slope case 2.3° → 6°.
  30 of 37 captures are byte-identical. The 7 that differ are the frames whose state or slope used to tilt the axis (`badlands-b`, `boss-a`,
  `combat-a`, `combat-b`, and the `stress-*-end` frames of the badlands fight, cave fight and cave walk). Envelope captures
  (scratch `envelope.json`): forest Cyndaquil at 60° up shows only sky with the crosshair; at 50° down the lens is at its 40°
  cap and the crosshair lies beside the Pokémon's feet; Mt. Moon Feraligatr at 50° down is the same.

### 16.7 Tests (`tests/freelook.test.ts`, 12 cases: real `ChaseRig`, renderer probes and sizes; shots through real `step()`)
No automatic state, slope, climb, jump or shake turns the ray (< 1e-6°; the legacy twin turns it > 4°) while the lens still
moves > 0.5 m. Neutral placement equals the pre-4A rig bit for bit (4 sizes × 3 states). The bounds hold exactly in Explore
and Pressure (and the legacy limit is 8° up). The same look gesture gives the same direction (to 1e-9) on flat ground, in
Pressure, uphill, with a wall behind, under a deck, for an XL body and in the air. A shoulder swap changes no direction.
Walking forward at 60° up, level and 50° down gives identical paths, and a vertical mouse or stick gesture never changes the
yaw. The same mouse and stick input at 30, 60, 144 and 240 fps gives the same pitch and ray. An enemy at the rim of a 6 m
ledge and one hovering 7 m up are centred and hit (the legacy band leaves the crosshair more than 1 m under each). From a 4 m
rise, an enemy below at more than 30° down is centred and hit (legacy cannot). A shot fired at a jump's apex at a hovering
enemy hits. Under a 2.4 m deck at both limits, the lens stays under the slab (Cyndaquil, Feraligatr). The §16.3 geometry is
pinned (ahead of the feet at 45°, at the body at 50°, the body below the frame at 40° up, the elevation within its cap).
- **Red before:** run with `aimPitch.on = false`, 7 of the 12 fail. The other 5 already compare against an explicit legacy
  twin.
- `tests/chase.test.ts`: "pitch input is clamped" asserts the envelope and the legacy window; "slopes" asserts no tilt under
  free look and keeps its legacy assertions under the flag.
- Pause, hitstop and pointer-lock loss are unchanged and still pinned by `tests/viewsample.test.ts` (look input is dropped
  while paused).

### 16.8 Gates (2026-11-16, this checkout)
- `npm run typecheck` clean. `npm test`: **485 tests, 483 pass, 0 fail, 2 todo** (I1, I2; +12 new).
- `npx tsx scripts/checksum.ts`: **all 52 lines byte-identical** to before (no sim change; the bot sends no ray).
- `camstats` as §16.6. Production build into a private directory (16.8 MB); `dist/` untouched. `npm run check` was not run
  as one command (it writes the shared `dist/`); its three parts were.
- Not run, not applicable: `perf-sim` (no sim change), `navwalk` and `stuckwatch` (no movement or collision change), the
  habitat and hazard gates (no world, hazard or objective change).

### 16.9 Mouse and gamepad semantics (checked; nothing changed)
Mouse down and stick down both look down (+ pitch). Invert Y flips both. The pitch and yaw gains keep their pre-4A values.
At `sens` 1, crossing the whole 110° envelope takes about 1070 px of mouse travel, or 1.3 s at full stick. Deferred to a
settings pass, since no minimal correction is required: a separate vertical sensitivity (vertical is 0.82 × horizontal on
the mouse and 0.58 × on the stick), a radial and rescaled stick dead zone (the axial 0.18 cut makes the slowest stick look
15°/s), and a response curve.

### 16.10 Remaining exceptions and manual playtest
| Exception | Owner | Gate |
|---|---|---|
| The lens rise of Combat and Pressure moves the ray in parallel (§16.5, Q11) | product (playtest) | §9 item 11 |
| Past ~33° up the Pokémon is off-screen; 60° up can be all sky (Q12) | playtest | §9 item 12 |
| The ground within 3.5–6 m of a 4 m cliff foot cannot be aimed at from the rim (the boom's 40° cap) | by design (no top-down) | — |
| The lost automatic slope and climb tilt may make ramps harder to read | playtest | §9 item 13 |
| Stick dead zone, curve and vertical gain unchanged | settings pass | §16.9 |
| Nobody has played this with a mouse or a pad | manual | §9 items 1–2, 11–13 |

### 16.11 Handoff
- **Status:** PASSED (scope above).
- **Next:** the playtest of §9 items 11–13 (decide Q11 and Q12). Then Stage 6B (shooter facing), which can now assume a
  player-owned axis. Stage 6C (headroom, F5) stays the owner of the XL camera collapse that shows in every camstats worst
  column.

---

## 17. R1: headroom (roadmap Stage 6C, 2026-11-16)

The audit roadmap (R0–R9, owner-approved rev 4) runs through this ledger's stages. R0 is the validated baseline of the
uncommitted Phases 1–4A (nothing committed). R1 is Stage 6C: problem F5 of the audit, claim 8c here.

### 17.1 Baseline before the change (R0, this checkout)
`npm run typecheck` clean. `npm test`: 495 tests, 489 pass, **4 fail**, 2 todo. The four failures are all in the untracked
`tests/pointerlock.test.ts` (promise rejection reporting, a shared pending request, cancelling a request). They test lock
handling that `src/input/input.ts` does not have yet: work in progress outside this ledger, left untouched. Every
`scripts/checksum.ts` set matched §6.3. `perf-sim 500 --repeat 3 --gate` PASS (min of 3: p95 0.497, p99 0.847 ms).
`navwalk all 5` 0 failures. `stuckwatch all 3`: 68 bot episodes (1 pinned, 0 trapped), 2 enemy. `habstate` 24/24,
`habplay all 6 1 --raid` 72/72, `hazplay` 49/49.

### 17.2 What was measured first
- Every deck over open ground leaves a **2.40 m gap** under its slab on Viridian Forest, Chargestone Cave, River Gorge and
  Tidal Cave (a 3.0 m deck on flat ground), and ≥ 2.9 m on Mt. Moon and Volcanic Ridge (5 seeds each). The generators'
  `CLEARANCE` (2.9 m) is measured to the deck **top** (no hopping on from below), so the gap is ≥ 2.3 m by contract.
- Sim heights carry the class tilt: Extra Large spans 2.22–2.59 m. At ×1 only Onix (2.59 m) exceeds 2.4 m; every elite from
  Medium up (2.26–5.18 m), every alpha and boss (3.4–4.5 m) exceeds it. No narrow body (footprint < 0.5 m) is above 2.3 m.

### 17.3 Contract (landed, flag `rules.size.headroom`, default on)
- One height per body, the one the hurt window uses (`partnerHeight`, `E.tall`). `HEAD_EPS` (1 mm) lets a body of exactly
  the gap fit.
- `World.collides` / `blocks` take an optional `tall`: on a deck tile, below the deck's reach, the tile is solid when
  max(feet, ground) + tall is above the underside. `overlap`, `fits`, `moveBody`, `nearestFit` pass it on, so the
  footprint rule covers every tile the circle touches. No height given, flag off, or no decks: the old queries exactly.
- `World.headroomAt(x, z, feet, r)`: the lowest underside over the footprint. `player.ts` clamps a **rising** head there
  (velocity to 0); falling is never clamped; a head already in a slab rises no further.
- Wide routing: each wide block's lowest gap is cached with the mask; the map's distinct gaps are the class steps; field
  index = link rule + 2 × height class, built on demand; class *c* leaves out the blocks with one of the *c* lowest gaps
  (seeds and search). `wideDir`, `wideGoalDir`, `wideReached`, `nearestFit` take the height. Callers pass it: enemy
  steering, relocation and placement, the director's spawn gate, objective sites, hazard and cell rescues, rock and
  crowd pushes of the partner.
- The ordinary field has no height classes; `tests/headroom.test.ts` pins the reason (no narrow body above the 2.3 m floor).
- Not changed: `World.sight`, `spatial.ts` (shots already stop at slabs), generators and validators (no layout moves, no
  `LOC_VERSION` / `HAB_VERSION` bump), enemy fliers, the camera.

### 17.4 Replay checksums
Flag off reproduces every earlier hash. Only `gen` moves (two of four runs), each traced to its first divergent tick:
- bulbasaur 3 survival, tick 2481: a Heracross elite (3.38 m) standing on a deck takes another route, because its height
  class leaves out the ground under the 2.4 m-gap decks.
- charmander 11 boss-rush, tick 7533: a generated map picks the spawn spot first and filters the pool by `allowedAt`. Onix's
  height class has no wide route from that spot, so the same weighted draw picks another species (a Ledyba swarm, three
  more `rng.ai` draws). No earlier stream differs.
New set `gen-headroom-off`; every older set (`off` … `roster-off`, `gen-classic`, `gen-size-off`, `aim-2b`) adds
`size.headroom: false`. New hashes in §6.3.

### 17.5 Tests (`tests/headroom.test.ts`, 6 cases; `tests/locations.test.ts` deck case extended)
Slab test by height (fits at exactly the gap, not 1 cm over; airborne from the feet; none on the deck; flag off ignores it);
`moveBody` stops 2.59 m at the deck edge, lets 2.25 m and 2.40 m under, every step clear; a Feraligatr jump stops the head at
the underside (flag off: +1.6 m, the defect); a walking Onix stays outside and a Feraligatr walks under, with jumps on the
way, never a tick in the slab; on a real underpass the field reaches the tile for 2.25 m and not for 2.59 m, and placement
puts a 2.59 m body where it fits; the narrow-body invariant over every species and role size, and the maps' gap floor.
Real-map check (probe, Chargestone Cave seed 3, the head-ceiling case): Feraligatr head − underside +1.599 m → 0.000 m; an
Onix spawned on that tile went 0.19 m into the slab, now it is put on open ground beside the deck.

### 17.6 Gates (after the change, this checkout)
| Gate | Result |
|---|---|
| `npm run check` | typecheck clean; tests 501: 495 pass, 4 fail, 2 todo; build OK (`npm run build` run on its own, since `check` stops at the failing tests). The 4 failures are the R0 pointer-lock ones, same names (§17.1, §17.8); the 6 new tests pass; no test that passed at R0 fails |
| `scripts/checksum.ts` (all) | as §17.4: only `gen` moves; `gen-headroom-off` = old `gen`; every other line identical (rerun on the final code: identical) |
| `navwalk all 5` | 0 failures; every class reaches every mandatory space (elite 291/291, xl 291/291); navwalk now also checks heads against slabs |
| `stuckwatch all 3` | 67 bot episodes (1 pinned, **0 trapped**), 2 enemy episodes over 115 818 enemy-seconds; the escape probe now uses the partner's height |
| `habstate` / `habplay all 6 1 --raid` / `hazplay` | 24/24 / 72/72 / 49/49 |
| `perf-sim 500 --repeat 3 --gate` | PASS (final code, min of 3: p95 0.507, p99 0.851 ms; R0 0.497 / 0.847) |
| perf on deck maps (optional, Chargestone Cave and River Gorge, flag off vs on) | **incomplete**: stopped by the owner during its first run (flag off) after ~8 CPU-minutes; neither passed nor failed. The gate map has no decks, so the headroom paths' cost under a crowd on a deck map is not measured |
| camstats F5 case (`--seeds 3 --stages 0 --species feraligatr`) | unchanged, 815 slides with the flag on and off (§17.7) |

### 17.7 Open items
- **F5, the camera half.** Feraligatr's sim body (2.25 m) fits the 2.4 m gap, so it still walks under decks and the rig still
  collapses there: the pivot follows the drawn sprite (2.69 m class visual), which is inside the slab's clearance. That
  is a camera rule (what the rig does when its pivot is under a slab) and two size sources for one body (audit F13), not
  body headroom. Owner: the camera work (R3) or a separate render-only fix; needs the owner's call.
- **Drawn versus sim height.** Extra Large sprites (2.69 m core) are taller than the 2.4 m gap, so a body that fits in the
  sim is drawn through the slab. Same F13 question.
- **Enemy fliers** hover with no wall or slab test; R7 moves them onto the shared movement.
- **Deck-map performance** is unmeasured (the optional comparison above was stopped).
- **Validators.** The location and habitat gates do not read heights. Measured: no mandatory route needs the space under
  a deck (`navwalk`), so no layout was affected. If a later generator change routes an essential path under a low deck,
  the gates would not catch it for tall bodies; adding a height check would change acceptance and needs a version bump.

### 17.8 Pre-existing failures (not R1)
`tests/pointerlock.test.ts` (untracked, not part of any phase in this ledger) fails 4 of its 10 cases at R0 and after R1,
with the same names: "a rejected promise reports failure even without a pointerlockerror event", "a throwing or missing API
reports failure and does not swallow every attack", "repeated Resume clicks share a pending request", "cancelling a pending
request releases a late grant without resuming". They specify behaviour `src/input/input.ts` does not implement yet
(`requestPointerLock` rejection is swallowed, no shared pending request, no cancel). Unfinished work; R1 did not touch it.

### 17.9 Handoff
- **Status:** R1 complete against its acceptance criteria: the P4 probe gives head ≤ underside; a body taller than a gap
  cannot enter it (Onix 2.59 m at a 2.4 m gap); flag off reproduces every earlier hash; navwalk, stuckwatch, habitat,
  hazard and perf gates pass. Nothing committed.
- **Open:** §17.7 (F5 camera half, drawn vs sim height, enemy fliers, deck-map perf, height-blind validators) and §17.8.
- **Next:** R2 (pole-safe aim maths) is ready with no dependency; R1b (wall tops) needs only its `/grilling` now that
  Appendix A's review points are answered. Decide F5's camera half separately.

## 18. R2: pole-safe aim maths (2026-11-16)

Audit problems F6 (muzzle jumps at the pole), F7 (fan spread closes with pitch) and F8 (view matrix built with world up).
Decision E: pitch is clamped to ±89°, so the pole is never reached, but the maths must stay continuous up to it. Decision G:
the `aim` set may move if the old hashes stay reproducible, every difference is explained, and every other set stays
byte-identical. R2 changes no camera envelope (still 60° up / 50° down; R3 widens it), no movement and no planar family.

### 18.1 Baseline before the change (this checkout, commit d0d557e: Phases 1–4A and R1, committed by the owner)
`git status` clean. `npm run typecheck` clean. `npm test`: 501 tests, 495 pass, 4 fail (the four `tests/pointerlock.test.ts`
cases of §17.8, same names), 2 todo. Every `scripts/checksum.ts` set matched §6.3.

### 18.2 What was measured first
- The `aim` bot's crosshair ray (`scripts/lib/aimbot.ts`) is pitched on nearly every cast: up to 44.8° over the four
  replays (min launch horizontal fraction 0.12). So the plan's literal muzzle rule (offset × the ray's horizontal fraction
  at every pitch) would move the muzzle of almost every `aim` shot and break `aim3d`'s "muzzle `fwd` ahead" case, while
  decision G's terms say only fans should move. Resolved in favour of G: the offset is unchanged up to a fade pitch and
  only then follows the horizontal fraction (18.3). A diagnostic run with the fade pushed to 89.9° printed the same `aim`
  hashes as the default 60°, so the fade never engages in the replays.
- Pre-R2 probes (flag off): Extra Large muzzle 1.120 m jump between 89.99° up and exactly up when the facing is 90° off the
  camera yaw (audit P5); a 4-shot Ember fan's outer angle 10.31° level, 7.24° at 45°, 1.67° at 80°, 0.06° at 89° (the
  audit's P6 figures are the full fan width).

### 18.3 Contract (landed, flag `rules.aim.poleSafe`, default on)
- **Muzzle** (`sim/aim.ts` `resolveSpatial`): forward offset = `fwd` along the ray's heading while the ray's horizontal
  fraction `hl` ≥ `h0` = cos(`rules.aim.muzzleFadeDeg`, 60°): the pre-R2 expression, bit for bit. Below it the offset is
  (dx, dz) / h0 × `fwd`: linear in `hl`, 0 at the pole, no division by a vanishing `hl`, no facing fallback. 60° is today's
  envelope edge, so every ray the camera can send keeps its pre-R2 muzzle (at exactly 60° the two may differ by float
  rounding, < 1e-7 m).
- **Fan** (`moves.ts` `straight`, spatial path): shot k = u cos(off) + r sin(off), r = the horizontal right of u's heading:
  rotation about u's local up, in the plane perpendicular to u, so every shot is `off` from u at any pitch. Level, it is the
  Phase 2B fan. Pre-R2: rotated about world Y with u's pitch kept.
- **Heading of a vertical launch** (`aim.ts` `launchHeading`, read by `resolveAim` and `beam3D` for facing, knockback and the
  beam's ground paint): u's own heading; if u has no horizontal part, the crosshair ray's heading; only a ray that is itself
  vertical (never sent by the clamped camera) falls back to the facing. Pre-R2: u's heading, else the facing.
- **View matrix** (`render/gl.ts` `mat4.viewYawPitch`, used by `renderer.ts` for both the chase and fixed views): basis from
  the yaw, right = (−cos yaw, 0, sin yaw), back = −(sin yaw cos p, −sin p, cos yaw cos p), up = back × right. Orthonormal at
  every pitch including ±90°; inside the envelope it equals the `lookAt` matrix element by element within 1e-5 (Float32),
  because both views already look from the eye along (yaw, pitch). Render only; no flag. `overworld/render.ts` and
  `baker.ts` keep `lookAt` (fixed views far from the pole; not in R2).

### 18.4 Replay checksums
Only `aim` moves, two of four runs (§6.3), each traced to its first divergent tick by running `aim` and `aim-pole-off` in
lockstep and comparing every projectile:
- totodile 7 classic, tick 3659: a 3-shot Water Gun (spread 0.35, a build multi-shot), launch ~1° up (the ray 6.4° down from a
  lens above the chest); muzzle and aim point identical, the two outer shots' `vy` 0.4206 vs 0.4478 m/s (the `uy cos(off)` term).
- charmander 11 boss-rush, tick 5371: a 2-shot Ember (count bonus at cast time), launch ~35° up; outer shots 6.88° apart in
  3D (pre-R2 5.6°).
Cyndaquil 2 and Bulbasaur 3 unchanged. Totodile 7 then dies at level 4 (was 24): single replays reshuffle (§14.7), so the
sweep is the evidence. Sweep (bot + aimbot ray, 4 starters × seeds 1–6 × 240 s, classic mode):

| Map | Layer | Survived | Level | Kills |
|---|---|---|---|---|
| classic | pre-R2 (`poleSafe` off) | 13 | 13.1 | 637 |
| classic | R2 | 13 | 13.0 | 619 (−2.8 %) |
| generated | pre-R2 | 12 | 13.9 | 678 |
| generated | R2 | 15 | 14.2 | 698 (+3.0 %) |

Inside the ±10 % band; Bulbasaur (no multi-shot bolt) is identical in every run; the others move both ways. The classic
pre-R2 row equals the Phase 2C row of §14.7 exactly. New set `aim-pole-off` = the earlier `aim` hashes; `aim-2b` adds
`aim.poleSafe: false`; every other set byte-identical.

### 18.5 Tests (`tests/aim3d.test.ts` +5, `tests/freelook.test.ts` +1)
- T2: muzzle over ±89.99° in 0.01° steps, largest step 0.09 mm (Tiny) / 0.28 mm (XL), limit 1 cm; through both poles
  (89.9° → 90° → 89.9° beyond) in 0.001° steps, muzzle < 1 mm and launch < 0.01° per step, on the body axis at 90°; flag
  off reproduces the 1.120 m jump.
- Envelope identity: −59.5° … +50° × 4 yaws × three classes, muzzle, launch and aim point `deepEqual` to flag off; past
  the fade the offset is the formula's at ±70/80/89°.
- T1: Tiny, Medium, XL × both shoulders × −89, −60, 0, +50, +89°: the bolt leaves the class muzzle (faded offset, on the
  ray's heading, class height above the feet) and hits the crosshair target.
- T3: 4-shot fan outer angle 10.31° at 0, ±45, ±80, ±89° (limit 0.5°); flag off: level identical, 80° up closes below a third.
- `launchHeading`: vertical launch takes the ray's heading; flag off and a vertical ray take the facing.
- View matrix: orthonormal, right-handed, right from the yaw, looking along (yaw, pitch) at pitches −90 … +90 and five
  yaws; equal to `lookAt` within 1e-5 inside ±60°; continuous into the pole.

### 18.6 Gates (after the change, this checkout)
| Gate | Result |
|---|---|
| `npm run typecheck` | clean |
| `npm test` | 507: 501 pass, 4 fail, 2 todo. The 4 are the pointer-lock cases of §17.8 (same names); the 6 new tests pass; nothing that passed before fails |
| `npm run build` | OK (run on its own: `npm run check` stops at the pointer-lock failures) |
| `scripts/checksum.ts` (all) | as §18.4: only `aim` totodile 7 and charmander 11 move; `aim-pole-off` = old `aim`; `aim-2b` unchanged; every other line identical |
| `perf-sim 500 --repeat 3 --gate` | PASS, min of 3: p95 0.495, p99 0.839 ms (R1: 0.507 / 0.851) |
| `perf-sim 500 --repeat 3 --gate --aim` | PASS, min of 3: p95 0.536, p99 0.867 ms |
Not run: `navwalk`, `stuckwatch`, habitat and hazard gates (R2 changes no movement, collision, habitat, hazard or
objective code), browser captures (18.7).

### 18.7 Open items and limits
- **Reach.** The camera still clamps to 60° up / 50° down, so in play only the fan fix shows; the muzzle fade and the
  view basis matter once R3 widens the envelope. Every ±89° case is exercised by sim-level rays in tests only.
- **Fade start is a choice.** 60° keeps every reachable ray's muzzle bit-identical; the plan's text read literally
  (fade at every pitch) would move every pitched shot. `rules.aim.muzzleFadeDeg` is tunable if R3 playtests want another
  start.
- **Overhead shots and facing.** Near the vertical, u's heading is ill-conditioned: with the lens behind the body, a
  shot almost straight up can lean backwards, so the facing turns toward the camera and the fan's order swaps (the set of
  directions is unchanged). That is the facing question of R5, not maths continuity.
- **View matrix not captured.** It equals the old matrix within 1e-5 inside the envelope, so no visual change is expected;
  no browser capture was run.
- §17.7 (F5 camera half, drawn vs sim height, enemy fliers, deck-map perf, height-blind validators) and §17.8 are unchanged.

### 18.8 Handoff
- **Status:** R2 complete against its acceptance criteria: muzzle step < 1 cm per 0.01° over ±89.99° (0.28 mm worst);
  fan outer angle within 0.5° at 0 / 45 / 80 / 89° (identical); view matrix orthonormal at ±89.9° (and ±90°). The `aim`
  migration followed decision G. Nothing committed.
- **Next:** R3 (full-sphere envelope) now has its prerequisite. R1b still needs its `/grilling`. Neither started.

## 19. R3: the full-sphere envelope (roadmap Stage 6A extended, 2026-11-16 / 17)

Audit problems F4 (the envelope stopped at 60° up / 50° down) and F9 (billboards foreshorten at steep elevation). Owner
decisions B (aim nearly straight up even if the body leaves the frame, with an unobtrusive off-screen indicator), C (the lens
may go overhead for steep down-aim; today's behaviour kept inside today's envelope; smooth transitions, collision
avoidance, aim alignment), E (±89°). Render only: no file under `src/sim/` or `src/world/` changed. A completion review on
2026-11-17 (19.11) replaced the first draft's overhead mapping, with the owner's approval, and fixed two new camera pops.

Files: `src/render/camera.ts` (`aimPitch` up 89 / down 89 + `overhead`, `boomElevation`, the rig's overhead easing, climb
cap, pitch and forward-walk anticipation, `lean`, `cue`, `offFrameCue`), `src/render/renderer.ts` (lean uniform, culling
`behind`, `selfCue`), `src/render/tilestage.ts` (`LEAN_GLSL`, `LEAN_FROM`, prop shader lean), `src/render/view.ts`
(`chaseBehind`, `StageView.behind`), `src/ui/ui.ts` (`selfCue`), `src/main.ts` (draws the cue; `pokewatch.chase`),
`scripts/camstats.ts` (`--r2envelope`, `--sweepband`), `tests/freelook.test.ts` (+9, one adjusted), `docs/THIRD_PERSON.md`.

### 19.1 Baseline before the change (this checkout, commit 1b31f31: Phases 1–4A, R1, R2, committed by the owner)
`git status` clean. `npm run typecheck` clean. `npm test`: 507 tests, 501 pass, 4 fail (the four `tests/pointerlock.test.ts`
cases of §17.8, same names), 2 todo. `scripts/checksum.ts`: 60 lines, saved. `camstats --fps 30,60,144` (108 runs) and
`camstats --sweep` (36 runs) saved.

### 19.2 What was measured first
- **F5 (the XL camera collapse under decks).** Traced on the camstats walk (Viridian Forest seed 3, Feraligatr): 797 of the
  813 slides happen with the pivot just *outside* a deck while the boom points back under it; 16 with the pivot under it.
  The pivot is 0.8 × the drawn idle sprite (2.715 m) = 2.17 m; the slab's lens clearance is 2.40 − 0.35 = 2.05 m, so
  behind the pivot no lens position at an elevation ≥ 2° is legal and the safety net slides the lens onto the Pokémon's
  back (boom 0.05–0.09 m) on every tick. The sim height (2.249 m) would put the pivot at 1.80 m. The collapse is
  pitch-independent (it happens with no look input) and identical in the R2 rig at any pitch: walking under a synthetic
  2.4 m deck the lens jumps 9.1 m with R2 at 50° and with R3 at 20°, 70° and 89° alike. Not a prerequisite of R3 and not
  fixed here; options compared in 19.11.
- **The crosshair at the old limit.** Where the crosshair meets level ground, ahead of the feet, at 50° down: Cyndaquil
  −0.19 / −0.35 / −0.60 m (Explore / Combat / Pressure), Feraligatr +0.33 / +0.05 / −0.38 m: the §16.3 table exactly. With
  the R2 lens capped at 40° from ~37° (Explore) or ~29° (Pressure) on, the crosshair runs back past the feet before 50°.
- **F9, measured.** From an overhead lens (elevation 80° on a 4 m boom) the Pokémon's feet are seen 81.6° from above; the
  1.6 stretch cap leaves its sprite 1.6 × cos 81.6° = 23 % of its height on screen.
- **Culling.** `VIEW_BEHIND` (6 m behind the lens) assumed the frame never looks back past the lens. The bottom edge of the
  frame looks back once pitch + fov/2 > 90°: from 54–58° at the states' FOVs. At 89° from Feraligatr's Pressure lens (≈ 12 m
  up, FOV 84°) the frame reaches ~10 m behind the lens: the old plane skipped visible props.

### 19.3 Contract (landed, render only)
- **Envelope:** `CHASE_CONFIG.aimPitch = { on, neutral 6, up 89, down 89, overhead: { on, settle 0.3, enter 0.1 } }`;
  `lookPitchRange()` = [−95°, +83°] of `userPitch`. The axis is still `neutral + userPitch` and nothing else (Phase 4A).
- **Boom elevation (`boomElevation`), owner-approved 2026-11-17:** the Phase 4A expression (state pitch + userPitch within
  2°–40°), and with `overhead.on` never below the view pitch. Every state's pitch exceeds the neutral 6°, so up to 40° down
  the Phase 4A value is returned bit for bit; past 40° the elevation is the view pitch. The crosshair ray then passes the
  pivot's vertical line at the pivot (beside it by the shoulder offset): its ground point is pivot height / tan(pitch)
  ahead of the feet, and the lens never swings faster than the look. Same critically damped boom, collision, shoulder,
  climb and safety net as before.
- **Decks.** Under a deck the overhead rise (the elevation above the Phase 4A one) eases out over `enter` (0.1 s); after one
  it eases back in over `settle` (0.3 s). Under the slab the Phase 4A slab rule then sets the elevation, as before.
- **Climb.** Elevation + climb ≤ max(52°, the elevation): the 40° + 12° cap of Phase 4A, which an overhead boom (already
  above any wall behind) does not climb past. `elevFor` (the lens swing of `look` and `update` for pitch input since the
  last tick) applies the same cap, so a swing never overshoots what the next tick draws.
- **Anticipation (overhead only).** While the rise is in force: the boom is also tested at the elevation the pitch is
  heading for (frame-to-frame pitch rate smoothed per tick, × `anticipate` 0.35 s, at most 24°), and the forward part of
  the Pokémon's motion counts toward the predicted position in proportion to the rise (0 at the 40° cap, all of it at the
  vertical): an overhead lens is above the pivot, not behind it, so walking forward brings obstacles into its boom. In
  the Phase 4A envelope neither changes anything (the factor is exactly 1).
- **Off-frame cue (decision B).** `offFrameCue(view, [feet, middle, head])`: null while any of the three points is on screen;
  else the screen direction toward the middle point (valid also behind the lens) and an opacity that rises from 0 at the
  frame edge to 1 at `cue.fade` (15 %) of the half-screen past it. Drawn by `ui.selfCue` as a small pale-cyan ring with a
  point (the x-ray silhouette's colour), on the overlay canvas after the threat chevrons, kept clear of the move bar.
- **Billboard lean (F9, `CHASE_CONFIG.lean`, `LEAN_GLSL`).** Third person only, creatures and props alike: seen from steeper
  than `LEAN_FROM` = acos(1/1.6) = 51.3° (where the stretch cap stops squaring texels), a card leans back about the
  camera's right axis by the excess, top along the camera's horizontal forward when seen from above and toward the lens
  from below; a creature's vertical offset (hover, bob, sink) stays vertical. Its screen height then stays what it is at
  51.3°: the level view's, at every elevation (test). Below 51.3° the shader takes the old expression unchanged.
- **Culling (`chaseBehind`).** The plane behind the lens moves back to where the frame's bottom edge meets ground `VIEW_DROP`
  (4 m) below the Pokémon's feet, plus `VIEW_BEHIND`, once that edge looks back past the vertical; otherwise `VIEW_BEHIND`.
  At the states' FOVs it never moves inside the Phase 4A envelope. Creature culling (a radius) is unchanged.
- **Unchanged:** sim, `ViewSample`, `aimRayOf`, `chaseAim` (beyond ~50° its planar point is still clamped to 4 m ahead),
  the view matrix (R2's `viewYawPitch`), the fixed views, shake, FOVs, boom lengths, states, shoulder, the 120 Hz clock.
- **R2 camera on demand:** `up 60 / down 50` with `overhead.on = false` is the R2 rig bit for bit (`camstats --r2envelope`,
  and in the page `Object.assign(pokewatch.chase.aimPitch, { up: 60, down: 50 }); pokewatch.chase.aimPitch.overhead.on =
  false`); `pokewatch.chase.lean = false` turns the lean off.

### 19.4 Behaviour past 40° (level ground, settled rig)
Where the crosshair meets the ground, metres ahead of the feet (every state gives the same value from 40°: it depends only
on the pivot height), with the R2 rig's value at 50° for comparison:

| View pitch down | 40° | 44° | 48° | 50° | 56° | 60° | 70° | 80° | 89° | R2 rig at 50°, Explore / Pressure |
|---|---|---|---|---|---|---|---|---|---|---|
| Pichu | 0.74 | 0.64 | 0.56 | 0.52 | 0.42 | 0.36 | 0.23 | 0.11 | 0.01 | −0.23 / −0.59 |
| Cyndaquil | 0.95 | 0.82 | 0.71 | 0.67 | 0.54 | 0.46 | 0.29 | 0.14 | 0.01 | −0.19 / −0.60 |
| Feraligatr | 2.59 | 2.25 | 1.96 | 1.82 | 1.46 | 1.25 | 0.79 | 0.38 | 0.04 | +0.33 / −0.38 |

Ahead of the feet for every size and state from 30° to 89° and monotone toward them (test, 0.5° steps); across it the
point lies the shoulder offset to the right (0.24 × the boom). The Pokémon's chest stays just below the crosshair
(0.05–0.14 of the half-height) instead of climbing 0.2 above it near 50° as it did with the R2 lens. The price, inside
the old envelope: from 40° to 50° the lens is up to 10° higher than R2's (at 50°: Pichu +0.41 m, Cyndaquil +0.47 / +0.69 m
Explore / Pressure, Feraligatr +0.81 / +1.19 m). Up to 40° down and looking up, nothing moves (test). Looking up the
lens stays at 2° elevation; the cue appears from ~33–35° up and is opaque by 45°.

### 19.5 Camera stability (final code)
- `camstats --fps 30,60,144` (108 runs, no pitch input): **byte-identical** to the 19.1 baseline.
- `camstats --sweep --r2envelope` (36 runs): **byte-identical** to the R2 sweep.
- `camstats --sweep` (the pitch swept −89° → +89° and back every 8 s, up to 70°/s, while walking and turning): axis error 0
  at 30, 60 and 144 fps; lowest lens clearance median 0.59 m (the negative worst values are the §16.6 tile-probe artefact,
  a lens ≤ 1–2 cm across a wall tile's edge, checked frame by frame). Same gesture on the R2 rig (`--sweepband 89,89
  --r2envelope`), the F5 run excluded (35 runs):

  | | R2 rig, same gesture | R3 first draft | R3 final |
  |---|---|---|---|
  | safety-net slides, 60 / 30 / 144 fps (sum) | 17 / 17 / 9 | 21 / 28 / 12 | 19 / 17 / 12 |
  | largest one-frame lens move, worst, 60 / 30 / 144 fps (m) | 0.95 / 1.35 / 0.64 | 1.06 / 1.35 / 0.78 | 1.08 / 1.36 / 0.79 |
  | lens velocity change p99, median / worst, 60 fps (m/s) | 2.36 / 5.66 | 2.75 / 6.03 | 2.74 / 5.66 |
  | F5 run: slides at 60 fps | 813 | 557 | 557 |

  What each remaining difference is, from a frame-by-frame forensic pass (19.11): two R3-only slides at 60 fps (0.16 and
  0.18 m, lens velocity change 3.2 and 4.3 m/s, at the level of the runs' own 99th percentile) and three at 144 fps
  (0.08 m each); the one large difference is a ledge drop in Mt. Moon (seed 3) right after an overhead pass, where both
  rigs pop (R2 0.70 m on the next frame, R3 1.08 m): code below 40° is identical, the rig's state differs by its history.
- **Decks** (synthetic 2.4 m deck; walk out from under it, back into it, and through it; Pichu, Cyndaquil, Charmander): the
  lens never enters the slab, and its largest frame step at 50°, 70° and 89° down is at most 0.02 m above the R2 rig's at 50°
  (and lower walking in backwards: 0.55–0.73 m against 0.69–0.82 m).
- **Rig cost** (per frame, 60 fps sweep walk, three maps, first draft): median 0.025–0.034 ms against 0.025–0.030 ms (R2),
  p99 equal; the final code adds one elevation evaluation per tick.

### 19.6 Browser (headless Chromium 1254, private builds of this checkout and of 1b31f31)
- **Regression set** (`tools/chasecheck.json`, 37 captures, 17 in-page probes, final build against a build of 1b31f31):
  the 17 probes (`elevMaxDeg`, `closeUpMax`, `jumpMax`, `boomRange`, `viewPitchDeg`, …) are identical; 34 of 37 captures
  are byte-identical. The other three are `stress-*-end` frames after 8–30 s of in-page fighting or walking.
  `stress-badlands-fight-end` (4.3 % of pixels) and `stress-cave-walk-end` (65 %, the lens jammed at Feraligatr's back in
  a cave, the sprite filling the screen in both builds) are the billboard lean: with `pokewatch.chase.lean = false` they
  equal the 1b31f31 frames exactly. `stress-cave-fight-end` is not repeatable on 1b31f31 itself (5 runs: 0 or 739 pixels
  apart, glow particles: the seeded presentation stream is consumed at varying times); on R3 its runs also vary in
  particle and hit-flash placement (up to 8.7k pixels), and with the lean off they fall on 1b31f31's two variants.
- **Envelope scenes** (scratch `envelope2.json`: forest Cyndaquil and Feraligatr, the cave, a bot fight, a deck, at 6°,
  40°, 45°, 50°, 56°, 62°, 70°, 75°, 80°, 89° down and 33°, 45°, 60°, 70°, 89° up, plus 50° with the R2 camera set in the
  page): at 50° the R2 camera puts the aim ring level with the feet and the Pokémon above the crosshair; the final rig puts
  it ahead of the feet with the Pokémon below. At 89° down the Pokémon is drawn below and left of the crosshair, the aim
  ring beside its feet. With the lean off the same frame shows Cyndaquil as a one-pixel line and Feraligatr as a sliver
  (F9); with it on, the whole sprite, lying back from its feet. Leaned trees and enemies read as cards lying back from
  their bases. Looking up the cue sits on the bottom edge just left of centre, above the move bar (`{dx −0.13, dy 0.99,
  alpha 1}` at 60° and 89° up for both sizes) and is absent in every down-look on open ground. Under a deck at 89° down the
  slab keeps the lens low, so the frame shows the ground under the lens and the cue points up to the Pokémon.

### 19.7 Tests (`tests/freelook.test.ts`, +9; the Phase 4A geometry test now pins 40° and the R2 rig's 50°)
±89° reachable exactly in every state (unit ray). From 60° up to 40° down the rig equals the R2 rig frame for frame
(6 terrain cases × 3 states × 3 sizes, fast gestures to both limits, `deepEqual`). From 30° to 89° down the lens is at
`boomElevation`, rises monotonically, is never below the view pitch and equals it from 40°; the crosshair is ahead of the
feet and moves monotonically toward them (4 sizes × 3 states, 0.5° steps), more than 5 cm ahead at 80°, while the R2 rig
in Pressure is behind the feet at 50°. A 0.05° pitch sweep over the whole envelope moves the lens at most 1.05 × the
pitch step's arc, with no slide on open ground; the same mouse and stick gesture to ~80° down reaches the same pitch and
a lens within 2 cm at 30, 60, 144 and 240 fps. Walking under, through and out of a deck at 70° and 89° down: never in
the slab, frame steps within 5 cm of the R2 rig at 50°. An enemy down a 3 m pit at the feet and one hovering 16 m
overhead are centred with look input (60°+ and 70°+) and hit through real `step()`; with the R2 envelope neither is hit.
The cue: absent from 30° up to 89° down for every size and state, pointing down (and left: the lens is on the right
shoulder) and fading in continuously beyond, opaque by 45° up. The stage view keeps every ground point of an 89° frame
from the highest lens (and the old plane did not). The lean: `LEAN_GLSL` is pinned and its TS mirror keeps a card's
screen height at the level view's at every seen elevation −90…+90°, upright up to 51.3°. The existing T13 test ("under a
deck at both pitch limits") runs at ±89°.
- **Red before:** on the R2 code the new tests do not load (`boomElevation`, `offFrameCue`, `LEAN_GLSL`, `chaseBehind` are
  new). With the first draft's mapping, the rise test fails (crosshair behind the feet at 46°–57°).

### 19.8 Gates (final code, this checkout)
| Gate | Result |
|---|---|
| `npm run typecheck` | clean |
| `npm test` | 516: 510 pass, 4 fail, 2 todo. The 4 are the pointer-lock cases of §17.8 (same names); the 9 new tests pass; nothing that passed before fails |
| `npm run build` | private build of this checkout (17.2 MB); `dist/` untouched (`npm run check` writes the shared `dist/`, and stops at the pointer-lock failures) |
| `scripts/checksum.ts` (all) | all 60 lines byte-identical to 19.1 (no sim change; the bot's ray is built in `scripts/lib/aimbot.ts`, not by the rig) |
| `perf-sim 500 --repeat 3 --gate` | PASS, min of 3: p95 0.511, p99 0.875 ms (R2 0.495 / 0.839; no sim code changed) |
| `camstats` | 19.5 |
Not run, not applicable: `navwalk`, `stuckwatch` (no movement or collision change), the habitat and hazard gates (no world,
hazard or objective change), the `aim` balance sweep (the sim's aim maths and every hash are unchanged).

### 19.9 Acceptance against the plan, and open items
- **"Crosshair ground point monotone and ahead of the feet down to 80°":** met over the whole range (30°–89°), with the
  owner-approved 40° start (19.11).
- **"Zero-input lens bit-identical; camstats lens columns unchanged inside the old envelope":** met for zero input and up to
  40° down; between 40° and 50° the lens is deliberately higher (approved trade-off, 19.4).
- **"`--sweep` to ±89° with no new safety-net slides":** not met to the letter: 19 / 17 / 12 against 17 / 17 / 9 on the same
  gesture at 60 / 30 / 144 fps. The remainder is the ledge-drop pop after an overhead pass (a mechanism the R2 rig shares)
  and five sub-20 cm corrections (19.5, 19.11).
- **The Pokémon's own axis cannot be centred near the vertical** (a geometric property of the over-the-shoulder lens): the
  crosshair's ground track passes the axis at the shoulder offset, 0.24 × the boom. A target straight over the head is
  beside the crosshair; a test target 0.5 m off the axis could not be centred, 1.5 m off it was.
- **F5 unchanged** (19.2); options and a recommendation in 19.11.
- **Facing past the vertical.** Overhead shots that lean backwards still turn the Pokémon toward the camera (R2's open
  item, R5's facing rule).
- **The billboard lean is visible inside the old envelope** wherever a sprite is seen steeper than 51.3° (a prop under a
  high lens, an enemy at the foot of a cliff, the Pokémon under a lens jammed at its back), which drew foreshortened
  before. It is the F9 fix, not a lens change; `CHASE_CONFIG.lean = false` restores the upright cards everywhere. The lean
  is computed from the card's base, like the stretch, so a tall sprite very close to the lens leans by its feet's angle.
- **Under a deck, looking steeply down** shows the ground under the low lens, not the Pokémon: the slab rule keeps the lens
  under it, so the overhead view is unavailable there; the cue points to the Pokémon.
- **T20, the mouse and pad playtest on a real GPU**, has still not been done (no hardware here); the plan wants it before
  R3's sign-off. Checklist: 19.11.
- §17.7 and §17.8 (pointer-lock) unchanged.

### 19.10 Handoff
- **Status:** R3 implemented and reviewed. Render only; every checksum set unchanged; up to 40° down the R2 rig bit for bit.
  Open before sign-off: the T20 playtest (19.11) and the residual ledge-drop pop (19.5). Nothing committed.
- **Next:** the T20 playtest; then the owner's sign-off and a decision on F5 (19.11). No roadmap phase started.

### 19.11 Completion review (2026-11-17)
The owner asked for R3 to be finished properly before acceptance: the extra camera snap-backs, the crosshair at 50°–57°,
the XL collapse, and validation.

**Snap-backs.** A forensic probe re-ran the camstats sweep frame by frame on the R3 and R2 rigs with the same gesture and
paired every slide (by run and time) with the R2 rig's. The first draft had four R3-only slides and two worse than R2's:
- *Overhead lens beside a tall wall* (Mt. Moon seed 3, 87.5°, 0.61 m and 0.49 m, lens velocity change 23.6 and 15.5 m/s,
  about 5 × the run's 99th percentile: a visible pop). The lens sat 3 m over the pivot and 0.9 m to its right (the
  shoulder), beside a 3.1 m rock wall; the eased boom lagged while the walk carried the pivot along the wall. Root cause:
  the collision anticipation ignored forward walking ("walking away from the lens never brings an obstacle into the boom"),
  which stops being true once the lens is above the pivot rather than behind it. **Fixed** (19.3, forward-walk
  anticipation in proportion to the rise; bit-identical below 40°): both pops gone.
- *Ledge drop after an overhead pass* (Mt. Moon seed 3, −18°, 1.06 m, 46 m/s: a visible pop). The Pokémon walks off a
  3.5 m shelf while the lens, low behind it, is still over the shelf; the R2 rig pops there too (0.70 m one frame later).
  At that moment both rigs run the same code (−18° is inside the identical range); R2's lens happened to carry a decaying
  12° climb from its capped phase and a shorter boom. Not fixed: a pre-existing mechanism (R2's own worst sweep pop, 0.95 m
  in Mt. Moon seed 1, is the same), whose general fix (predicting the pivot's fall, a faster pull-in) would change the R2
  camera everywhere. Tried and rejected: deciding the climb from the Phase 4A elevation while overhead (no effect).
- *Sub-20 cm corrections* (61°, 0.16–0.18 m; 144 fps: 0.08 m): at the level of normal sweep motion, not visible.
In play terms: the sweep flicks the whole ±89° range at up to 70°/s while walking along cave walls; the remaining
differences are one ledge-drop pop already in the R2 camera's repertoire.

**Crosshair at 50°–57°.** The conflict was real: decision C froze the R2 lens to 50°, and the R2 lens, capped at 40°
elevation, puts the crosshair behind the feet from ~46° (Combat, Pressure), so any mapping that preserves 50° has a band
where the crosshair is behind or at the feet, and the first draft's catch-up swung the lens at up to 2.25 × the look.
Proposed to the owner with the trade-off in numbers (19.4) and **approved 2026-11-17**: the elevation never drops below
the view pitch. Preserved behaviour now ends at 40° instead of 50°.

**XL collapse (F5), options measured** (scratch prototypes, not landed; Viridian Forest seed 3, Feraligatr):

| Option | Walk: slides / largest frame move | ±89° sweep: slides / largest move | Effect elsewhere |
|---|---|---|---|
| Today (drawn-sprite pivot 2.17 m) | 813 / 7.54 m | 557 / 7.54 m | — |
| (a) frame the sim body (height 2.25 m: pivot 1.80 m, boom −10 %) | 3 / 4.39 m | 250 / 1.53 m | every species whose drawn and sim heights differ is framed differently on every map |
| (b) slab-aware pivot (pivot lowered to fit a 2° boom under the lowest slab over the boom's track, eased 0.15 s) | 49 / 4.08 m | 106 / 1.10 m | none away from decks |
| (c) (b) + the slab elevation rule taken along the boom's track, not only at the pivot | 12 / 1.30 m | 56 / 4.29 m | Cyndaquil and Charmander on that map: sweep slides 5 → 0; other maps identical |

(a) fits Feraligatr with 0.02 m to spare and would not fit a taller body; it is a global framing change. **Recommended:
(c) plus eased cover transitions** (the remaining 4.3 m moves are the slab rule's elevation snap when the pivot passes
under a deck edge, the same snap R2 has), as its own small render-only phase with camstats and capture gates. It works
for any body size (only a pivot higher than a slab's clearance is lowered), changes nothing away from decks, and keeps
the framing of every body that fits. Not essential to R3: the collapse is pitch-independent and R3 reduces it.

**Validation.** Automated, run here: 19.5–19.8. Requiring the owner's hands (mouse, pad, real GPU), not run:
1. Normal movement and aiming: walk, strafe, turn at mouse and stick speeds; the crosshair stays put on screen, the
   camera neither drifts nor tilts by itself; shots land at the crosshair.
2. Near-vertical up: look straight up while standing still and while walking; the view stays stable at 89°; the cue
   appears once the Pokémon leaves the frame and points at it; nothing rolls or spins.
3. Near-vertical down: sweep from level to 89° slowly and quickly; the camera rises over the Pokémon without a jolt at 40°;
   the crosshair stays ahead of the feet, beside the Pokémon; the Pokémon stays visible (leaned sprite), not a sliver.
4. Shooting above and below: a target on a high ledge, a hovering one overhead (off the Pokémon's own axis), one in a pit or
   at a cliff foot; shots leave the body and hit; the red blocked crosshair appears when the rim is in the way.
5. Walls, cliffs, decks: back into a wall and a cliff while looking down; walk under a bridge and out at 0°, 50°, 89° down;
   step off a ledge with the camera looking up (the known ledge-drop pop); turn beside cave walls overhead.
6. Sizes: repeat 1–5 with a small (Cyndaquil or Pichu), a medium (Charmander) and an Extra Large Pokémon (Feraligatr; under
   a 2.4 m deck expect the known F5 collapse).
7. Mouse and pad: invert Y, the three sensitivities; full stick deflection across the whole range; mouse flicks of
   ±90° in under 0.2 s; no lost or doubled pitch at either limit.
8. Indicators and sprites: the cue is readable but unobtrusive and never overlaps the move bar; threat chevrons and the
   objective arrow still behave; trees and enemies seen from above read as cards lying back, with no flicker at 51°
   (toggle `pokewatch.chase.lean` to compare); the frame's edges at 89° down show no missing props.
9. For each, note anything disorienting, any pop, and whether the 40°–50° band (now higher than before) feels right.

## 20. R6a: shared locomotion seam, no behaviour change (2026-11-17)

Baseline: commit 060f184 (R3 committed by the owner; its T20 hands-on playtest, 19.11, is still owed and R6a does not
depend on it: R3 gates R6d). R6a touches no camera, render, input or UI file.

**Landed.** `src/sim/locomotion.ts` (contract: `docs/LOCOMOTION.md`): `LocoBody` / `LocoIntent` / `LocoNumbers` /
`LocoTick`, the `supported`, `ballistic` and `scripted` (Dash, dash-shaped moves) integrators over one shared body step,
`selectIntegrator`, `mediumAt`, `clearLanding`. `src/sim/player.ts` keeps Reflex, Guard, Dash start, the speed rules and
facing, and calls the shared step; it no longer holds gravity, jump, glide, support, headroom or wall arithmetic.
`Player.loco = { integrator, medium }` (record only; nothing reads it yet). The literals 16 / 7 / 8 became
`rules.player.groundAccel / airAccel / knockDecay`. Enemy motion is unchanged; only the landing clear (already the same
`World.moveBody` call) is shared. Everything else waits for R7 (§12.10).

**Evidence.** Every `scripts/checksum.ts` line identical (56 of 56). The checksum skips `vy`, knockback and `grounded`,
and the bot never jumps, so a stricter oracle hashed every player motion field and every enemy's height each tick with
the bot plus injected jumps (Charizard for the glide row) over seven rule sets: 56 of 56 identical to 060f184.
`navwalk all 5` (0 failures) and `stuckwatch all 3` (TRAPPED 0), `hazplay` (49/49), `habstate` (24/24): output identical
to 060f184. `perf-sim 500 --repeat 3 --gate`: p95 0.513 ms / p99 0.879 ms (060f184: 0.517 / 0.866), PASS.
`tests/locomotion.test.ts` (+9): integrator table, fall and landing, jump apex, lift row, grip and footing, scripted
under gravity, medium, the player controller vs a plain body on the shared step (bit-identical), and the T38 source
gate for `player.ts`. `npm test`: 525, 519 pass, 4 fail — the same four pointer-lock tests that fail at 060f184.

**Next.** R6b (capability data, `traversalOf()` for the nine `species.flying` readers; `LocoTick.lift` is the first).

## 21. R6b: traversal capability data, no behaviour change (2026-11-17)

Baseline: the R6a working tree (§20; uncommitted on 060f184, so R6b is layered on it and was compared against a
snapshot of it). R6b touches no camera, input or pointer-lock code; the render and UI edits are one-line reader swaps.

**Landed.** `src/rules/traversal.ts`: capability kinds `glide`, `hover`, `swim` (implemented as today) and `fly`,
`levitate`, `dive` (reserved for R6d, R6e, R8; the validator rejects a row of those kinds), the row types and the
shipped templates `glider`, `fixed-hover`, `surface-swimmer` in `rules.locomotion.templates`. `src/rules/profiles.ts`:
`traversalOf(species, rules)` (cached per rules object and species object), `traversalIds`, `validateTraversal`,
`SPECIES_OVERRIDES[id].traversal` (a template list replacing the derived one) and `.ventImmune`; `canSwim` reads the
swim row (plus the Surf move rule, unchanged). The `fly` field left `SpeciesProfile` (only a test read it). Derived
defaults: the roster's `flying: true` → `glider` + `fixed-hover` (the two things it meant), a type in
`rules.hazards.water.safeTypes` → `surface-swimmer`. Policies kept apart in `Traversal`: `air` (camera framing,
roster label), `groundNav` (footprint, walkable placement, relocation, spawn room, Hold raiders, habitat ground
profiles, spawn-pool `fly` filter), `ventImmune` (habitat vents, player). The hover literals 0.9 / 0.05 / 10 / 0.15 / 3
became the `fixed-hover` row. Readers migrated (all twelve, not the nine the audit counted): `player.ts` lift,
`enemies.ts` role / footprint / placement / hover height / relocation / bob, `director.ts` standAt / allowedAt,
`hazards.ts` vent, `spawning.ts` filter, `compositions.ts` raider, `habitat/mode.ts` ground profiles, `chaseinput.ts`
camera flag, `ui.ts` label. `tests/traversal.test.ts` gates the source: only `profiles.ts` reads `.flying`.

**Evidence.** Every `scripts/checksum.ts` line identical to the R6a tree (60 of 60). A stricter oracle extended R6a's:
per tick, every player motion field and every enemy's x / y / z / hover height / footprint / roles / HP plus hazard
events, bot input with and without injected jumps, eight partners (gliders Charizard, Gastly, Haunter, Koffing; swimmers
Totodile, Squirtle; walkers) over nine rule sets including Cinder Crater (vents) and Shrine Gorge (river): 144 of 144
identical. Pure readers (spawn tables for every preset × stage × `fly` filter and every map pool, composition jobs
for every species, habitat ground profiles under three rule sets, `canSwim` with and without Surf, `spawnEnemy`
placement / hover / footprint / roles for every species on three maps, the camera's air flag): 1576 of 1576 lines
identical. Every species as the partner on a Cinder Crater vent through an eruption: 72 of 72 identical (24 immune,
48 hit five times, so the check discriminates). `navwalk all 5` (0 failures), `stuckwatch all 3` (TRAPPED 0),
`hazplay` (49/49), `habstate` (24/24), `habplay all 6 1 --raid` (72/72): output identical to the R6a tree.
`habaudit`: all checks pass, identical apart from timings (its rewrite of `docs/habaudit/baseline.json`, timings and
date only, was reverted). `perf-sim 500 --repeat 3 --gate`: p95 0.499 ms / p99 0.844 ms (R6a tree 0.501 / 0.846),
PASS. `tests/traversal.test.ts` (+10): templates and validation, the legacy mapping, T25 (Doduo: Flying type, no
capability; Gastly, Koffing …: air capability, no Flying type; Gengar: none), several capabilities on one species,
overrides and independent policies, per-rules numbers, the wild hover reading the row, player glide vs wild hover as
separate rows, and the source gate. `npm test`: 535, 529 pass, 4 fail — the same four pointer-lock tests as R6a and
060f184. `npm run build` passes.

**Next.** R6c (input: `my?`, `jumpPressed?`, descend binding, the bindings table) depends on R6a only. R6d consumes the
reserved `fly` kind: it adds a `wings` row and the volume integrator, and is the first phase whose templates carry body
numbers (speeds per axis, limits).

## 22. R6c: shared movement input and the Jump control (2026-11-17)

Baseline: commit 9d855f5 (R6a and R6b committed by the owner). R6c touches no camera, pointer-lock, world, habitat,
hazard or enemy code. Doc: `docs/CONTROLS.md` (new; the input subsystem); `docs/LOCOMOTION.md` "Controls".

**Landed.**
- Sim (`sim/locomotion.ts`, `sim/player.ts`, `sim/types.ts`, `rules/defaults.ts`): `InputFrame.jumpPressed?` (rising
  edge) and `InputFrame.my?` (ascend − descend, −1..1). `LocoIntent` carries both; `jumpControl` (inside the shared body
  step, where the take-off always was) is the §12.6 table for the states that exist: supported, ballistic (coyote first,
  then the template's `airPress`), scripted (Dash: grounded jump kept, air presses ignored). Buffer
  `rules.player.jumpBuffer` 0.12 s (7 ticks) and coyote `rules.player.coyote` 0.1 s (6 ticks), counted in whole ticks
  on `Player.ctl` (hashed only when non-zero). No `jumpEdge` flag: the field's presence is the switch, as `press` is
  for fire, so every driver without it (bot, checksum sets, replays, tests) keeps the held rule bit for bit. `my` is
  read by nothing before R6d.
- Capability data (`rules/traversal.ts`, `rules/profiles.ts`): optional `airPress` on any row (`doubleJump`; `takeoff`
  only on a fly / levitate row); `Traversal.airPress`; the validator rejects two meanings on one species (§12.6 rule 1)
  and a take-off from any other kind. No shipped row sets it. `ACT.takeoff` exists and nothing acts on it before R6d.
- Input (`input/bindings.ts` new, `input/input.ts`, `main.ts`): keyboard and gamepad bindings tables (pad buttons left
  the hardcoded `pad()`); `descend` = V / left-stick click (provisional; X free as the alternative, owner decision) / touch button (hidden until R6d); C stays
  `cardPointer`; `jumpLatch`; `pollPad()` every frame of play latches pad edges (jump and combat). Every earlier default
  unchanged (`tests/controls.test.ts` pins the pre-R6c tables).
- Settings and UI (`ui/settings.ts`, `ui/ui.ts`, `ui/style.css`): saved overrides `keys` / `pad` (only changed actions,
  sanitised on load), Settings → Controls → Bindings (two key and two pad slots per action, capture, move-on-conflict
  note, Esc cancels, Delete clears, Reset), the HUD hint follows the bindings.
- Tests: `tests/jumpcontrol.test.ts` (18), `tests/controls.test.ts` (16), `tests/locomotion.test.ts` helpers (+34 tests: 535 → 569). Harness:
  `scripts/jumptiming.ts` (T33, R6c half).

**Behaviour changes (intended, only with the game's input, which now sends the edge):** holding Jump jumps once, not on
every landing (claim 8b: 300 held ticks 8 → 1); a tap between two samples jumps (claim 8a); a press up to 7 ticks before
landing jumps on landing; a press up to 6 ticks after walking off a ledge still jumps; a pad press that only a frame saw
(a display above 60 Hz) is no longer lost, for Jump and for the combat buttons (fire acceptance itself unchanged). The
Dash keeps its jump. Gliders glide as before (hold after the press).

**Owner decisions (2026-11-17, R6c accepted).** The Dash keeps its grounded jump. A press inside the coyote window is a
ground jump before any airborne meaning (double jump, take-off). Left-stick click is the provisional pad descend; X is
not bound by default (no duplicate active bindings) and is the alternative if the playtest finds the click
uncomfortable or too easy to press by accident. The optional `jumpPressed` field is the compatibility switch; no rules
flag, as long as the contract stays documented (`docs/CONTROLS.md`, `docs/LOCOMOTION.md`) and tested
(`tests/jumpcontrol.test.ts`, `tests/controls.test.ts`).

**Evidence.**
- `scripts/checksum.ts`: 60 of 60 lines identical to 9d855f5, after the sim change and again on the final tree.
- Strict per-tick oracle (R6b's, extended): every player motion field, every enemy's x / y / z / hover / footprint /
  roles / HP, jump and hazard events; nine rule sets × eight partners × four input variants (bot; held Jump injected
  without an edge; the same plus `my` every tick; bot plus `jumpPressed: false`): 288 of 288 identical to 9d855f5.
- `tests/jumpcontrol.test.ts`: legacy 8 jumps / edge 1; buffer 1–7 ticks jump on the landing tick, 8+ dropped; coyote
  1–6 ticks jump, 7+ not; `airPress` doubleJump once per airtime, take-off only from a new airborne press; the Dash;
  `my` ±1 and an aim ray swept ±89° leave every height, vertical speed and support flag identical; determinism.
- `scripts/jumptiming.ts` at 30 / 60 / 144 fps: every key tap (2–200 ms, three frame phases) jumps once, 0 ticks after
  the first sample following the key; pad taps of at least one frame likewise (shorter ones fall between polls); a 5 s
  hold jumps once (legacy rule 8). It found the pad defect fixed above (144 fps, 8 ms taps were lost).
- Real Chromium (production build in a private directory): `tools/navcheck.mjs` 28 / 28 (gamepad Start now through the
  bindings); an ad-hoc browser check of the Bindings screen, not kept in the repo, 21 / 21 (capture, move-on-conflict note, Esc, Delete, virtual-pad capture, saved,
  Reset, a rebound G jumps in play and Space does not, a 2.4 s hold takes off once, hint follows, no page errors).
- `navwalk all 5` (0 failures), `stuckwatch all 3` (TRAPPED 0), `hazplay`, `habstate`: output identical to 9d855f5.
  `perf-sim 500 --repeat 3 --gate`: p95 0.493 ms / p99 0.839 ms (9d855f5: 0.494 / 0.840), PASS.
- `npm run typecheck` clean. `npm test`: 569, 563 pass, 4 fail, 2 todo — the same four `tests/pointerlock.test.ts`
  tests as 9d855f5, 060f184 and R6a / R6b (a pending-request lock state machine that `input.ts` does not implement;
  they test `capture()` / `releaseLock()`, which R6c does not touch, and do not obstruct input testing: the R6c input
  tests use their own stub). `npm run check` therefore stops before its build; the production build passes on its own.

**Found and fixed after R6c (pre-existing; reproduced at 060f184).** Runs in one process were not independent: a
`boss-rush` run (bulbasaur, seed 3) before a classic gastly run (seed 4) with injected held jumps changed the gastly
run from tick 3261. Cause: the balance bot's shore target (`shoreFor`, `src/sim/hazards.ts`) was one cache slot for
the process, keyed by tile index alone, and both runs use the authored meadow layout. The sim itself was never affected
(recorded frames replay identically in any order). The cache is now per World (`WeakMap`); `tests/crossrun.test.ts`
pins it; docs/HAZARDS.md "Shore target" has the details and the within-world staleness that remains (not fixed).

**Owed (hands-on).** Left-stick-click descend comfort over a 10 s descent and accidental clicks under hard steering on
real pads (only meaningful once R6d flies); the feel of the 0.12 s buffer and 0.1 s coyote time; the Bindings screen on
a real keyboard, pad and screen reader. T20 (R3) is still owed independently.

**Next.** R6d: act on `ACT.takeoff` (→ volume × air), read `my` in `stepVolume`, the volume rows of §12.6 (ascend,
descend, landing on support contact while descending, `idle`, `settle`), show the touch Descend button for volume
bodies, T33's take-off / ascend / descend / landing half, T34.

## 23. R1b: wall tops, finite obstacle heights (2026-11-17)

A wall prop (tree, fence, boulder, building) is solid only up to its measured height for every reader that opts in;
bare walls and the map edge stay infinite. Doc: `docs/SIZING.md` "Wall tops". Flag `rules.world.wallTops` (on).
Implemented on 5d85b19; nothing committed.

### 23.1 Owner decisions (`/grilling`, Q1–Q26)

| # | Decision |
|---|---|
| Q1, Q2, Q26 | Only an explicitly permitted body crosses above a top; permission is separate from the integrator (not every volume mode crosses). R1b ships it as an explicit parameter (`World.blocks` / `collides` / `fits` / `moveBody` `over`, `LocoTick.over`) that no driver passes; the traversal policy field arrives in R6d with the first template that sets it. Jumping, gliding, walking and every enemy meet walls as before |
| Q3, Q11, Q12 | No standing or landing on tops. A permitted descent is a swept stop at the top: integrator, `grounded` and support untouched, no relocation. No reserved schema field: one height source that later support rules can read. Capability loss above a prop is R6d's (T31: Tag swap, expiry) |
| Q4, Q13 | One top per kind: the tallest unstretched drawn variant over the eight palettes, rounded up to 0.05 m. Billboard stretch (≤ 1.6× third person) and lean are presentation only and never enlarge collision; the mismatch is documented |
| Q5 | The six location-kit kinds with no material row keep blocking shots; the lamp stays a full-tile column (2.40 m); sub-tile shapes out of scope |
| Q6, Q16 | A report-only cover comparison (`scripts/covercheck.ts`), including where combat and the validators now disagree. Validators (`sightAbs`, `laneField`, `sightTiles`) unchanged; no generator, layout or version change |
| Q7, Q24, Q25 | Default on. Historical checksum sets pin `wallTops: false`; `aim-tops-off` prints the old `aim`; only `aim` may move, every moved run explained. Flag-off equivalence also by a per-tick oracle |
| Q8, Q15 | Enemy fliers unchanged (they skip every wall; R7). `World.sight` and enemy fire stay infinite and move to R7 together, so enemies never see over cover their shots cannot pass |
| Q9, Q19 | No roofs: no map has overhead geometry and caves are open-top by design. A flier's altitude limit is R6d's movement rule; any future real ceiling is authored geometry |
| Q10, Q18 | The chase lens reads `wallTop` for wall props; bare walls keep the `height + 2.4 m` lens margin (presentation clearance, not an obstacle height) |
| Q14 | Per-query opt-in: `QF.tops`, through `combatFlags`, for the player's attack traces only |
| Q17 | Every bare wall stays infinite, including the habitat's low ruin, broken and cemetery walls (1.1–1.4 m): a recorded limitation |
| Q20 | Rock recovery: a permitted body at or above a top is not in rock; everything else as before; tests for both |
| Q21 | `top` beside `w` / `h` / `platform` in `PROP_RULES`; `World.wallTop` derived per tile; `setBlock` keeps it in step |
| Q22 | A Node test measures the painters (ImageData shim, the shader's alpha cut, 16 px per m) against the table |
| Q23 | Pre-existing limitations recorded apart from anything R1b introduces (23.7) |

Revisions to the audit's R1b text (§9): `World.sight` moves to R7 with enemy fire (it was listed as an R1b reader);
roofs are dropped; habitat ruin walls stay infinite (the audit gave them top = rise); no reserved field; the permission is
a parameter until R6d; heights re-measured (tree 2.75 m with the `tree3` variant, not 2.70) and rounded up, not to the
nearest 0.05 m.

### 23.2 What changed

- `src/world/tiles.ts`: `PropRule.top` on every wall kind; `wallTopsOf(map)`: footing (the card's bottom-left tile) +
  top per footprint tile, never below the tile's own ground (props forced across a cliff on River Gorge and Cascade
  Lagoon span up to 6 m of relief), Infinity elsewhere. Float64, so a top is exactly footing + table value.
- `src/rules/defaults.ts`: `rules.world.wallTops: true`.
- `src/sim/world.ts`: `World.wallTop` (null with the flag off); `over` on `blocks`, `collides`, `fits`, `moveBody` and the
  private `overlap`; `wallTopAt`, `inRock`, `topUnder`; `setBlock` clears a cleared wall's top.
- `src/sim/locomotion.ts`: `LocoTick.over`; the planar move passes it on; `moveVertical` stops a permitted descent at
  `topUnder` (downward speed only); `recoverFromRock` reads `inRock`.
- `src/sim/spatial.ts`: `QF.tops`; the wall column ends at `Geo.top` when the cast carries it; `segmentClear` and the
  overlap sight line pass it through (`QF_WORLD`).
- `src/sim/aim.ts`: `combatFlags` adds `QF.tops` with the flag (camera trace, muzzle, bolt/orb flight, beams, device
  assist, the aimbot).
- `src/render/chaseinput.ts`, `src/render/camera.ts` (doc): the lens prop probe.
- `scripts/checksum.ts`: `TOPS_OFF` in every historical set; `aim-tops-off`. `scripts/covercheck.ts` (new, report only).
- `tests/walltops.test.ts` (new, 14 tests). Docs: SIZING, THIRD_PERSON, CAMERA, LOCOMOTION, README, CLAUDE.md.

### 23.3 Measured heights (m, rounded up)

fence 0.90 · hedge 1.00 · sign 1.10 · thicket 1.20 · crystal 1.35 · boulder, berry 1.60 · lantern 1.65 · well 1.90 ·
tent 1.95 · pillar, stalagmite, moonstone 2.00 · lamp 2.40 · statue 2.50 · shrine 2.60 · blossom 2.65 · round 2.70 ·
tree, tree2, icepine, magnetite 2.75 · deadtree 2.95 · gatehouse 3.20 · cabin 3.75 · elder 5.20.

### 23.4 Determinism and hashes

- **G1 checksums.** 60 lines before, 64 after. 59 of the 60 earlier lines byte-identical; `aim-tops-off` prints the four
  earlier `aim` lines exactly. Moved: `aim totodile seed 7 classic` (`266edfa0 end=d5109b20 lvl=4 kills=64` →
  `68888ab7 end=1aae2dec lvl=2 kills=33`). The other three `aim` runs, every `gen*`, `on`, `aim-off` (= `on`), `aim-2b`
  and `aim-pole-off` line unchanged.
- **G3 cause.** First divergence at tick 1771: a spatial Water Gun bolt (`traj 1`) the Small Totodile fired at tick 1439
  climbing about 19° from a 0.72 m muzzle reached the meadow's border forest at 9.3 m and crossed a `round` tree (tile
  (8, 78), top 2.70 m). The infinite column ended it there; with tops it flew on 6.6 m above the canopy and expired at
  its range a tick later. The projectile pool and hit timing diverge from there (a cascade, not further causes).
- **G2 oracle (Q25).** A per-tick hash of every player motion field, every live enemy (x, y, z, vx, vz, hover, footprint,
  roles, hp) and every live projectile (position, velocity, life, kind, pierce, hits) plus jump, hit, kill and hurt
  events, 60 s, 8 species (Tiny to Extra Large, gliders and a levitating ghost), 6 rule sets (`on`, `off`, `size-off`,
  `gen` = Viridian Forest, Mt. Moon, Memorial Ridge), inputs bot / held jump / aimbot / aimbot + jump: 192 runs. The R1b
  tree with the flag off equals the pre-R1b tree on all 192. With the flag on, all 96 non-aim runs are identical too (no
  body or enemy path reads the tops); the aim runs move.
- **Every enabled-state difference explained.** A classifier ran each aim run with tops on and off in lockstep on a
  full-state hash and named the first cause: 54 of 96 runs diverge within 60 s — aimbot sight 20, camera trace 15, shot
  flight 18, muzzle obstruction 1 — each a tops-flagged line crossing a wall-prop tile at or above its top (margin 0 to
  6.63 m). None crosses below a top, none passes a bare wall, none is unexplained. (An earlier pass flagged six cases;
  each was its own detection lag or endpoint artefact and is resolved in the record.)

### 23.5 Tests and gates

| Gate | Result |
|---|---|
| G4 one height, every reader (T37) | `tests/walltops.test.ts`: a permitted body, a `QF.tops` line and the lens agree at top − 1 cm (solid), at the top and + 1 cm (clear) for all 26 wall kinds, on flat ground and a 2 m plateau; without the opt-in all three stay solid 50 m up. Each reader keeps its own volume (footprint, ray, lens point) |
| G4 muzzle heights | a level line at each class's muzzle (0.36 / 0.54 / 0.72 / 1.02 / 1.44 m) clears exactly the kinds lower than it: fence → Large, Extra Large; sign, thicket, crystal → Extra Large; boulder → none |
| G5 no permission | `collides` / `blocks` solid at feet 0–50 m over a fence; a footprint at feet 1.0 m stops at a 0.90 m fence without the permission, crosses with it. Real `step()`: a jumping Cyndaquil (apex 1.84 m) never passes a fence; a gliding Charizard off a 6 m ledge and a walker on a 4 m tier never pass a 2.75 m tree |
| G6 permitted body | at 3.0 m it crosses a 2.75 m tree, at 2.0 m it stops at the trunk; a fall from 4 m stops exactly at 2.75 m with `vy` 0, `grounded` false, integrator ballistic, x / z unchanged, held Jump never jumps, `support` and `height` still the ground. Without the permission the same fall reaches the ground as before |
| G7 rock recovery | hovering 1 m over a canopy on a location-rules map: permitted, untouched; unpermitted (false or absent), snapped to footing as before; inside the trunk both are recovered identically |
| G8 bare walls | a bare wall tile is solid 100 m up for a permitted body and 60 m up for a `QF.tops` line; the lens keeps its 2.4 m margin there; the map edge is solid at any height. On the authored meadow, Mt. Moon and Memorial Ridge every wall tile with no wall prop over it has an infinite top |
| G9 burn / break | `setBlock(k, 0, 0.65)`: the tile's top is gone, a line over the 0.65 m stump passes and one through it does not; the rest of the tree keeps its top |
| G10 painter drift | every wall kind equals ceil₀.₀₅(tallest drawn height over 8 palettes); the test also pins the conventions it copies (tree / tree3 variants, 16 px per m, alpha ≥ 0.5, the card's bottom-left footing) |
| G11 shots and beams | real flight, both ways, the line's height at the cover's face checked against the result: Extra Large level over a fence hits; Small level into it stops on the fence below the top; Extra Large level into a boulder stops; Extra Large and Small aimed at a flier 3–4 m over a boulder's far side hit; a Medium at a flier 1.5 m behind a tree stops on the trunk, at one 6 m up hits over the canopy; flag off, the Extra Large fence shot stops on the infinite wall above the fence's top. Ice Beam: Extra Large over a fence hits, Small stops at it. `spatial.test.ts:487` (sight vs `segmentClear` without the flag) still green |
| G12 camera | `freelook`, `camstability`, `chase` green. `camstats --sweep` (36 generated + 36 authored rows) against the pre-R1b tree: no new safety-net slides (generated worst 815 → 814, the known F5 Feraligatr row; sweep 557 → 557; authored 3 → 3, 0 → 0), worst jumps and worst velocity changes unchanged, Small and Medium boom travel within 1 %. Extra Large boom travel rises (generated walk +11 %, fight +4 %; authored fight 212 → 284 m): its lens now meets 2.75 m canopies it passed under the old 2.4 m margin. Mt. Moon seed 1 Feraligatr `walkDvMax` 1.99 → 7.92: the lens stays out over a 1.6 m boulder it used to fold in for (mean boom 3.77 → 3.94 m) and is then pulled in by the rock rim on the existing terrain response |
| G13 captures | private build, `tools/cap.mjs`, 10 scenes (scratchpad `walltopscenes.json`): fence, boulder, cabin, elder, tree (Small and Extra Large), thicket and a Mt. Moon rim at 0°, 30°, 50° and 80° down; 34 rig reports, 0 safety-net slides. Level fire at a fence: a Small Ember bursts on the rails, an Extra Large Water Gun leaves over them. For the owner's review: the canopy cards lean back and stretch at 50°+ (taller than their collision), the elder dissolves near an overhead lens |
| G14 suite, types, build, perf | `npm run typecheck` clean. Tests 585: 579 pass, 4 fail, 2 todo; pre-R1b 571: 565 / 4 / 2. The same four `tests/pointerlock.test.ts` failures (5, 7, 8, 9), no new failure, 14 new tests. `npm run check` therefore stops before its build; the production build (`scripts/build.mjs`, output redirected to a private directory) passes. `perf-sim 500 --repeat 3 --gate`: p95 0.493 / p99 0.835 ms (pre 0.494 / 0.837), PASS; `--aim` p95 0.489 / p99 0.851, PASS. `spatialbench --gate`: every family within noise of pre, no allocation, PASS |
| G15 movement | `navwalk all 5`: output byte-identical to pre-R1b, 0 failures. `stuckwatch all 3`: byte-identical, TRAPPED 0 |
| G16 habitats | `habstate` 24 / 24, `hazplay` 49 / 49, `habplay all 6 1 --raid` 72 / 72: each output byte-identical to the pre-R1b tree. `habaudit`: all checks passed; its rewrite of `docs/habaudit/baseline.json` changed only the date and timings (no checksum, accepted seed or attempt), and was reverted. No `HAB_VERSION` / `LOC_VERSION` change |
| G17 cover report | 23.6 (`scripts/covercheck.ts`), report only |
| G18 docs | `docs/SIZING.md` "Wall tops" (heights, readers, crossing rule, cover table, steep views, limitations, hashes) and "Checking it"; `docs/THIRD_PERSON.md` lens collision; `docs/CAMERA.md`; `docs/LOCOMOTION.md` (`LocoTick.over`); README and CLAUDE.md checksum lists; this section; Q3 and the tree-crown rows of §8, §14 point here |

### 23.6 Cover report (Q6, `npx tsx scripts/covercheck.ts 2 400`, report only)

Four authored arenas, three locations and six habitat recipes at seeds 1–2; 400 seeded lines of fire per map between open
tiles 4–20 m apart, from each class's muzzle to a Medium body's centre, with walls infinite (the rule before R1b and the
validators' rule) and with the player's attack policy (foliage open in both, so only the tops differ).

- **Level fire over barrier props:** only Extra Large clears signs, thickets and crystals; Large and Extra Large clear
  fences (none on these maps; the classic regions have them); no class clears a boulder or a lantern. The kit thickets are
  the bulk of it: Viridian Forest 637–641, River Gorge 157–738, Memorial Ridge 72–99, Cascade Lagoon 1 583–1 627 thickets.
- **Sampled lines opened by the tops** (blocked with walls infinite, clear now): over all maps 3 / 3 489 Tiny, 3 / 3 417
  Small, 3 / 3 328 Medium, 5 / 3 120 Large, 18 / 3 014 Extra Large (0.1–0.6 %). Viridian Forest and Cascade Lagoon carry
  most of them (Extra Large 2.2–3.6 %, over thickets), then a sign, a boulder and a tree2. Authored arenas, Mt. Moon,
  Chargestone, Volcanic Ridge, Memorial Ridge, Shoal Grotto and Spear Sanctuary: 0–1 line each.
- **Objective sightlines where combat and the validators now disagree:** River Gorge seed 2, staging B → point, and
  Cascade Lagoon seed 1, staging B → point: blocked for the validators, open now for Large and Extra Large muzzles.
  No location entry → spawn line changed. Every other staging line is unchanged.
- No asset, layout, validator or version was changed. Proposed for review, not done: whether the two staging lines should
  stay open (they are a Large / Extra Large advantage over thicket-height cover), and whether the kit thicket (1.20 m)
  should stay below the Extra Large muzzle (1.44 m) on lane maps.

### 23.7 Limitations (pre-existing, owned by later phases; not R1b defects)

- Enemy fliers skip every wall test and ride over trees and raised rock (`enemies.ts`): R7.
- `World.sight` (ranged enemy line of sight) and enemy fire keep walls infinite, so a player can now fire over a fence at an
  enemy that cannot fire back over it: R7, both together (decision Q15).
- `World.sight` treats the 0.9 m `DECK_REACH` band as slab where spatial uses the 0.6 m slab (todo I1): R7.
- Lobs arc to about 5.1 m with no wall test at all; planar player families end on walls at any height: R4.
- The habitat's low ruin, broken and cemetery walls (1.1–1.4 m) stay infinite (Q17).
- Five copies of the infinite-wall rule remain (`World.sight`, `sightAbs`, `laneField`, `sightTiles`, and the spatial
  column without `QF.tops`); 23.6 shows where they now disagree with combat.
- Billboards drawn taller than their collision at steep views (by design, Q13).
- The four `tests/pointerlock.test.ts` failures (a separate baseline issue).

Introduced by R1b and open for the owner: none found as a defect. Behaviour changes to judge: the Extra Large lens zooms
more beside 2.75 m canopies (23.5 G12), and the two staging sightlines (23.6).

### 23.8 Owed and next

- **Owed (hands-on):** the G13 frames and a short mouse playtest beside a fence line, a forest edge and a boulder with a
  Small and an Extra Large partner: does the Extra Large lens feel busier in forests; does firing over a fence read
  correctly; is the canopy stretch at 50°+ acceptable. The cover report's two staging lines.
- **R6d inherits:** `over` / `LocoTick.over` (its first template sets it), `World.topUnder` (the stop at a top),
  `World.inRock` (recovery), T31 (capability loss above a prop), the sky ceiling.
- **Next:** owner review of R1b; R6d once authorised.

## 24. Camera overhaul: one stable combat framing (2026-11-18)

The user asked for an evidence-based rework of the third-person camera toward a close, stable, Garden Warfare 2-style
shooter camera, consistent across the five size classes, with the supporting input and integration fixes. Implemented
on b89fb55; nothing committed. Doc of record: `docs/THIRD_PERSON.md` "Camera" and "Overhaul: what was wrong" (the
before/after tables live there, not here).

### 24.1 Root causes (reproduced at b89fb55 before changing anything)

A headless probe drove the real sim and the real rig on a flat plain (60 and 144 fps): the lens trailed the Pokémon by
speed / 16 (pivot lag: 0.51 m walking, 1.03 m reversing, 1.0 m dashing, 0.51 m strafing); a jump moved the Pokémon 0.24–0.42
of the half-height on screen (65 % air follow, vertical lag); one hostile 15 m away and then a crowd changed boom (+1.8 to
+3.1 m), FOV (+8°) and the crosshair's point 15 m ahead (1.6–2.8 m) with no input (threat states); the automatic climb and
shoulder swap changed angle and composition; shake moved the ray's origin; framing came from the art's idle frame with
boom ∝ size^0.55 (Tiny 0.17 of the frame, XL 0.30) and an XL pivot above a 2.4 m deck's clearance (F5); the deck cap
switched in one tick (1.5–9 m pops leaving a deck); mouse pitch was 82 % of yaw per count; the look stick had a per-axis
0.18 dead zone with no rescale. Found on the way: `P.px` went stale in the `dead` state (the drawn Pokémon swung up to
0.9 m a frame at 144 fps).

### 24.2 Decisions (and the alternatives not taken)

| Decision | Why | Not taken |
|---|---|---|
| One framing, no threat states | entity independence; the crosshair ray must not move without input (decision hierarchy 1–2) | a softer state blend (still entity-driven); a "combat zoom" (moves the aim) |
| Rigid anchor at the drawn position, all axes | the Pokémon never moves in the frame; the ray moves with the body exactly; Cinemachine documents its third-person camera as rigidly attached to its target, and Unreal's spring arm makes lag an opt-in | a shorter lag (still drifts with speed); partial jump follow (moves the Pokémon in frame) |
| Stair smoothing on the ground only: rate-limited (4 m/s, ≤ 0.6 m), keyed to the sim's support flags over the span drawn | the sim snaps tile steps (0.25 / 0.5 m) in one tick; a rate limit follows ramps exactly | a critically damped filter (lags on ramps); a speed threshold (missed small steps and 30 fps) |
| Size-class framing: boom = 3.5 m × (visual / 1.37)^0.85, shoulder 0.24 × boom, pivot 0.8 × body height | one law, data in `rules.size`; near-constant composition (share 0.28–0.34); pivot from the body fixes F5 | exponent 1 (7.3 m XL boom, 0.74 m Tiny lens); per-class rows (more data, steps at class edges) |
| No climb, no automatic shoulder swap: collision shortens the boom | both were automatic view changes; Nesky's "intent wins" | keeping them with longer holds |
| Deck cap from every slab over the boom's track (and 0.5 s ahead, ≤ 3 m), eased in 0.2 s / out 0.3 s; replaces R3's separate overhead easing | one mechanism; no frame moves the lens > 0.5 m walking under, out of or through a 2.4 m deck at any pitch or size | the pivot-only switch (the pops) |
| No shake in third person | the lens is the ray's origin (Cinemachine's 3rd-person aim cancels noise for this reason) | an aim-neutral view-only shake (the crosshair would no longer be the ray) |
| Equal mouse yaw/pitch; stick radial dead zone 0.18, rescale, exponent 2 | precision and direction fidelity | a settings UI for curves (later, with a playtest) |
| Fixed views (Classic / Overhead / Wide) kept | isolated from the rig; their removal belongs with the planar retirement (H) and the capture tooling | removal now |

### 24.3 What changed

- `src/render/camera.ts`: the rig rewritten around the decisions above (822 → ~690 lines): `CHASE_CONFIG.frame`, `pivot`,
  `fov`, `arm`, `step`, `deck`; `chaseBoom`, `chasePivot`; `boomElevation(up, overhead)`; removed `states`, `threat`,
  `blend`, `size`, `swap`, `maxLift`/`liftStep`/`liftClear`/`liftTime`/`liftTilt`, `air`, `slope`, `pitchRange`, `shake`,
  `aimPitch.on`, `aimPitch.overhead`, `ChaseThreat`, `NO_THREAT`, `CHASE_STATES`, `wobble`, `ChaseRig.pick/state/cur/liftDeg`.
  Collision (terrain, decks, edge, dense props, anticipation, the slide, the floor), the 120 Hz clock, the view-state
  contract, the envelope, the cue and `chaseAim` are kept.
- `src/render/chaseinput.ts`: `chaseSubject` (size class), the span support flag; `threatOf` and the traversal coupling
  removed. `scripts/lib/chasesize.ts` (art-measured size) deleted.
- `src/render/renderer.ts`: no lens shake; the cue's sprite height computed locally.
- `src/render/hostframe.ts` `LOOK`; `src/input/stick.ts` `shapeStick`; `src/input/input.ts` `pad().look`.
- `src/sim/types.ts` `Player.pgrounded`, `src/sim/player.ts`, `src/sim/run.ts` (the `dead`-state span refresh): render
  interpolation state only, read by no system, not hashed.
- `src/ui/ui.ts`: "Screen shake (fixed views)". `src/main.ts`: the `pokewatch.chase` hint.
- Diagnostics: `scripts/camstats.ts` (`*RelDvP99`, `*LagMax`, `walkStepMax`; legacy flags removed), `scripts/habcam.ts`,
  `tools/chasescenes.json`.
- Tests: `tests/camfollow.test.ts` (new, the regression scenarios), `tests/lookinput.test.ts` (new); `chase`,
  `camstability`, `freelook`, `viewsample` rewritten where they pinned removed behaviour (states, climb, swap, legacy
  pitch, the R2 rig, art sizes); `aim3d`, `locations`, `controls` adjusted.
- Docs: `docs/THIRD_PERSON.md`, `docs/CONTROLS.md` "Look", `docs/SIZING.md`, `docs/CAMERA.md`.

### 24.4 Verification

- `scripts/checksum.ts`: all 64 lines identical to b89fb55 (every set, `aim` included).
- `npm test`: every test passes except the four known `tests/pointerlock.test.ts` failures (unchanged since 060f184).
- `scripts/camstats.ts --fps 60,144,30 --sweep` (36 runs per rate) and `tools/chasecheck.json` captures of private builds
  of both trees: the tables in `docs/THIRD_PERSON.md`.
- Not done: any hands-on play with a mouse or a pad, real-GPU timing, a long-run multiplayer check (there is no
  multiplayer).

### 24.5 Open

- Playtest (owed): the closer framing per class, the fixed FOV in fights (no widening for a boss), the stick curve, steps
  and knockback read with a rigid lens, a shoulder-swap binding.
- Frame-rate dependence rose (144 vs 60 fps: 0.033 / 0.175 m against 0.004 / 0.065 m): the stair smoothing's per-frame
  decision and unfiltered probe inputs.
- Thin ridges in caves still slide (0 / 15 per 36 runs, from 0 / 814).
- Planar move families (strikes, cones, lobs, areas) still read `aimX/aimZ`; shooter facing; the fixed views and the
  planar aim path they feed (decision H).

## 25. Camera, second pass: composition, apparent size, aim (2026-11-18)

The owner asked for an evidence-based diagnosis of what was still wrong after §24 (the Pokémon over the crosshair, its
apparent size changing when reversing, turning and attacking, a camera that keeps moving), an independent look at §24's
own claims, and the fix, judged on the picture the player sees and not on camera transforms. Implemented on the
uncommitted §24 tree (b89fb55); nothing committed. Doc of record: `docs/THIRD_PERSON.md` "Camera", "Second pass" and
"Known limits". Figures: `docs/camaudit/2026-11-18-before.json` and `-after.json`.

### 25.1 Root causes (measured on the §24 rig before changing it)

| # | Symptom | Cause | Evidence |
|---|---|---|---|
| A1 | Pokémon over the crosshair | shoulder = 0.24 × boom from the size class alone | all 68 species have idle or walk frames inside 7° / 3° of the crosshair; 23 548 of 24 952 gameplay frames |
| A2 | Head over the crosshair line | pivot at 0.8 × the class height, arm 3° over the view | body top at 0.20 to 0.44 of the frame height (crosshair 0.5) |
| A3 | Framing figures are not what is drawn | boom and pivot read the class's visible core | drawn body 0.31 to 0.76 of the frame height, median 0.48; §24's doc said 0.28 to 0.34 |
| B1 | Pokémon grows | one diagonal arm: collision shortens it and the shoulder with it, so the sprite grows into the centre | over 1.25 × its size in 39 % of tuning frames, 74 % in the worst cell |
| B2 | ... mostly in woods | dense props pull the boom to 45 % | props passing through: forward 48 % to 5 % (Quilava) |
| B3 | ... more when reversing or strafing | collision looks 0.35 s ahead along the velocity and the turn | without it: strafing 73 to 64 % (Pichu); lens steps over 0.25 m 481 to 298 (Quilava) |
| B4 | ... amplified | billboard stretch rises as the lens closes in | shader formula on the measured lens positions |
| B5 | The sprite itself changes size | facing follows movement and snaps to the aim on an attack; rows and clips differ 0.9 to 3.0 × in area | atlas bounds per row and clip. Not the camera |
| C1 | Camera keeps moving | B1 to B3: 0.39 m/s of arm travel, a lens step over 0.25 m 12 times a minute | relative lens motion |
| C2 | Pokémon bounces in frame | the stair smoothing moved the lens, the sprite was drawn at the true height | 4 to 21 steps a minute of walking |
| C3 | View jolts with the body | rigid follow shows dashes and knockback 1:1 | by design; unchanged |

Why §24's report missed it: its tests ran on a flat plain and compared lens against body. None projected the drawn sprite
to the screen, none measured real maps by movement direction, and its pass marks were set after the fact.

### 25.2 Decisions

- **Owner, asked before the plan:** props never block the lens (they dissolve; replaces R1b Q10's "the lens reads
  `wallTop`"); camera only (B5, the facing rule, stays with Stage 6B / D7).
- **Owner's review of the plan** (five points, all taken): combat frames are in the space reserved for the Pokémon, as a
  fixed allowance and never a per-frame camera move; success is decided before the results, with maps held out; the
  framing promises are conditional (P1 to P4) and tested on the final pose over the whole look and FOV range; the stair
  smoothing is checked for detaching the Pokémon from the game (criterion F); aim is tested alongside the replay hashes
  (criteria E).
- **Architecture:** improve the existing rig with proven structure. Libraries rejected (camera-controls,
  three-player-controller, ecctrl, Babylon and PlayCanvas cameras: each needs three.js or an engine and mesh colliders;
  none frames a sprite's silhouette). The repo's own exact cast (`sim/spatial.ts raycastWorld`) not used: it has no
  "props open, bare walls solid" mode, and some 60 rig tests drive synthetic terrain through callbacks. Borrowed:
  Cinemachine Third Person Follow (origin, shoulder, hand, camera), Cinemachine Decollider (clearance apart from
  smoothing), Unreal's spring arm (pull-in only on a hit), Little Polygon (frame in picture-plane coordinates).
  GW2: only its 70° vertical FOV is documented; the target picture is an inference.
- **Data-driven body proportions, not size-class parameters:** the class's core is 0.64 to 1.33 × the drawn top and says
  nothing of the reach or of what is drawn below the anchor. The outline is measured once per sprite at load; nothing in
  the camera follows the animation frame.

### 25.3 Where the result departs from the approved plan

1. **The allowance moves the corner sideways only** (`reticle.rise` 0). Moving it up put feet off the screen. More hurt
   frames go to the fade for it.
2. **34 of 68 species need an allowance, not 13.** The plan's figure was measured against the crosshair point, not the
   keep-out's corner. 22 need more than the 4° cap.
3. **`shoulderMax` 0.6, not 0.45:** no species is capped (the most is 0.48), so the plan's exception for long bodies in
   side rows is not used.
4. **`aimPitch.neutral` 11°, from 6°:** what E4 needs with the higher lens.
5. **The framing law reads the drawn height** (top + drop), proportional, 4.3 m at 1.9 m. The plan's law read the top. See
   25.5.
6. **The pivot holds past the orbit range.** See 25.5.
7. **The sprite's share of a step is capped at 0.35 × its outline top,** not at the plan's fixed 0.3 m. Same bound on what
   is hidden (one sprite over half on the first frame, three over a third three frames later), and 47 sprites instead of
   none still take a 0.5 m step whole.
8. **The benches were corrected after the first baseline and before any result was judged** (relative lens motion in the
   view's frame; "obstruction starting" also when the free length drops; a forced-step test by carrying the previous arm
   along; path clearance on the rig's own ring; chasm falls and ended runs as the renderer treats them; the 0.3° slack).
   To keep before and after comparable the §24 rig was rebuilt from its source, checked against its first recording
   (330 values over 55 cells, no difference), and re-measured with the final benches.
9. **Criterion B's size is read on the drawn body.** As first written (top to anchor) it measured a point inside the
   picture; 21 species are under 0.30 on it because they draw far below their anchor. The lowest drawn point and the
   move bar were added to the bench. This is stricter than what was fixed, and it was changed after results were seen.
10. **The way in is neither eased, as the plan kept it, nor all at once, as P1 first made it.** An eased pull-in leaves
    the lens in rock for a few frames; all at once moved it up to 8 m in a frame (25.5). The lens comes in at a capped
    speed along the straight line to its new place and hops only the part of that line that is itself blocked.
11. **Bounds loosened in tests, each with its measured figure in a comment:** the frame-rate replay in caves (was "within
    0.6 m", is "within 0.6 m for nine tenths of the walk and at its end"); an Extra Large under a 2.4 m deck (0.9 to
    1.1 m in a frame); the on-screen shift of a Small on stepped terrain (0.5 to 1 % of clear frames); a cliff in a
    synthetic turn test moved from 1.5 to 1.6 m.

### 25.4 Acceptance criteria (fixed before tuning) and where they ended

"Clear" frame: the ideal arm unobstructed now and for the previous 2 s. Tuning set: generated seeds 1 to 3, four regions,
8 headings, 5 movement modes, Pichu, Cyndaquil, Quilava, Charizard, Feraligatr (423 588 frames). Hold-out set: generated
seeds 7 to 9, authored arenas, the river-gorge and volcanic-ridge approaches, Joltik, Totodile, Croconaw, Venusaur, Lapras
(754 347 frames).

| # | Pass mark | Before | After, tuning | After, hold-out | |
|---|---|---|---|---|---|
| A | No gameplay frame in the keep-out on clear frames, except past the 4° cap, and those dissolved by half | 68 of 68 species; 100 % of clear frames | 0 species with an idle or walk frame; 131 of 24 952 frames past the cap, dissolved; 53 of 336 000 clear frames (see note) | 0 of 654 000 | met |
| B | Same corner (±0.5°); feet in frame at 4:3 and 16:9; body 0.30 to 0.40 of the frame | corner 4.5 to 20.7° over the line; drawn body 0.31 to 0.76 | corner (−7°, −3°) for all 68; lowest drawn point 0.88 to 0.94; drawn body 0.34 to 0.40 | (composition is not per set) | met on the drawn body (25.3 no. 9) |
| C1 | Clear frames: size 1 ± 2 %, every frame | 39.5 % off | 0.14 % off | 0.03 % off | not to the letter |
| C2 | Same pose, any velocity or yaw rate: same arm | differed | the rig reads neither (`tests/camfollow`, `camframe`) | | met |
| C3 | Over 1.25 ×: each cell ≤ 25 %, the sum over cells ≤ ⅓ of before | 39.4 % of frames; worst cell 74.5 %; sum 985.5 | 2.6 %; worst 7.4 %; sum 65.0 | 2.3 %; worst 10.9 %; sum 90.1 (before 1101.9) | met |
| C4 | Tight frames: P1 and P2 always; in the keep-out only dissolved | 70 % undissolved; lens in a solid 0.28 %, within 0.3 m 3.9 % | 0 undissolved; view turned 0; lens in a solid 0.062 % (all while falling into a chasm), within 0.3 m 0.24 % | 0; 0; 0; 0.17 % | P2 and the fade met; P1 not 100 % |
| D1 | Clear frames: lens within 1 mm of its place against the drawn Pokémon; the Pokémon within 0.2 % of the screen height, steps included | 20.5 % / 10.0 % of clear frames | 0.22 % / 0.21 % (largest 0.52 m / 0.080) | 0.07 % / 0.07 % (0.33 m / 0.098) | not to the letter |
| D2 | Lens steps over 0.25 m only within 0.3 s of an obstruction starting; rate ≤ ½ of before | 12.1 a minute, 9.6 of them late; over 1 m: 0.01 a minute, largest 1.1 m | 5.5, 2.0 late, 1.2 nothing forced; over 1 m: 0.93, largest 4.3 m | 3.4, 1.4 late, 0.4 unforced (before 9.5); over 1 m: 0.39 (before 0.00), largest 7.6 m (1.4 m) | rate met; late steps remain; **steps are larger than before** (not a mark that was set: 25.5) |
| E1 | Aim, standing, every tight pose: within 0.05° of the crosshair | 0.0003° | 0.0026° | | met |
| E2 | Moving, mid pull-in, mid step: error ≤ that frame's lens travel + 0.05° | 0° unexplained | 0.0044° unexplained (largest one-frame error 14°, all of it lens travel as an arm comes in) | | met |
| E3 | Bolt, orb, beam at a target on the crosshair: hits, or reports blocked and stops on the cover | 28 hit, 7 occluded | 28 hit, 6 blocked and stopped, 1 occluded, 0 missed | | met |
| E4 | No input, flat ground: crosshair's ground point inside 4 to 26 m (Tiny to Large) | inside; Extra Large 19.8 to 23 m | inside for every class (Extra Large 18.9 to 25.4 m) | | met |
| E5 | Blocked crosshair in a bot fight: no more than 5 points over before, per species | 7.0 to 27.2 % | 28.2 to 38.1 %: 1 of 7 species within 5 points | | **not met** |
| F | Step: gap ≤ 0.6 m, gone in 0.15 s; ring and shadow on the true ground; hidden part ≤ 50 %, ≤ ⅓ after 3 frames; ≤ 3 % of shots with over 0.15 m offset | sprite popped against the camera | gone in 0.117 s; ring on the true ground (code, and the step strip); 67 of 68 sprites ≤ 50 % (Diglett 60 %), 65 of 68 ≤ ⅓; 1.23 % of casts | | met with the fallback, bar three sprites |
| G | Hashes identical; no new test failure; rig cost ≤ 0.10 ms median, 0.20 ms p99 | 0.008 / 0.016 ms | 64 lines identical; 596 tests, the 4 pointer-lock failures only; 0.010 to 0.017 ms median, 0.041 to 0.075 ms p99 | | met |

Notes.
- A, the 54 clear frames: 53 are one stand of Quilava's against a deck's edge, where the bench's path test calls the
  ideal arm free while the slab holds the lens down (a tight pose the bench classes clear); one is a Pichu frame. All
  dissolved.
- C1 / D1: the tail of an arm easing back out after rock (the bench's 2 s of "clear" does not always outlast it), and,
  for D1, small sprites on 0.5 m steps (25.5).
- E5 is the cost of A: see "Known limits" in the doc. With the crosshair on an enemy, the world stopped the shot in 8.4 to
  15.4 % of frames (1.3 to 2.9 % before); the bot had the crosshair on an enemy in 41 to 51 % of aimed frames (61 to
  71 %) and looked over 60° down in 10 to 41 % (2 to 15 %), chasing enemies nearer than the shoulder offset.
- The Pokémon is out of the frame (a wall right behind) in 0.026 % of tuning frames and 0.001 % of hold-out frames.

### 25.5 What looking at the frames found

The first complete version passed A to D, E1 to E4 and G on both sets. Reading the captured frames, the split of E5's
blocked frames by cause and the browser stress scenes found four defects the marks had not been written to see. Each was
fixed, or reduced, and everything re-run.

- **The feet under the move bar.** Criterion B measured the sprite's anchor (0.88 to 0.94 of the frame). The drawn
  picture reaches below it: the lowest drawn point of an idle or walk frame was at 0.85 to 1.11, half the roster under
  the HUD's move bar at 1280 × 720 and six species off the bottom of the screen. Fix: `Outline.drop`, and the back
  distance from the drawn height (4.3 m at 1.9 m, proportional; it was 3.5 m × (top / 1.45 m)^0.92). Arms are 0.91 to
  1.59 × what they were (median 1.15); the lowest point is at 0.88 to 0.94 for every species.
- **The lens flying up when looking down.** The pivot follows the drawn top; past the orbit range, where a card leans,
  that put it five to six outline heights up at 89° (the lens 8 m over a Pichu, 24 m over a Feraligatr) and the Pokémon
  shrank to a third. Found because the fight bot was looking straight down from 24 m. Fix: `chasePivotH` holds the
  pivot at the orbit range's end. Fewer frames enter the keep-out straight down for it (46 % against 100 %).
- **The sprite sunk into the step.** Criterion F's own measure: a 0.5 m step's whole offset drew over half of 12 of the
  68 sprites under the tile on its first frame. Fix: the sprite's share is capped by its own height.

- **The size of a lens step.** D2 counted steps over 0.25 m and asked for half as many. `tools/chasecheck.json`'s stress
  scenes, run on both builds, showed what it had not asked: the largest one-frame lens move in the cave walk went from
  0.42 m to 2.78 m and in the cave fight from 0.73 m to 3.25 m. On the tuning tracks, by region, with each arm coming in
  all at once: over a metre 2.3 times a minute in the forest and 4.3 in the cave, up to 8.1 m; the rig before, never
  over 1.1 m. Three in four of those cuts had 1.3 m of rock or less on the lens's own straight way in (the rest of the
  arm was cut by a wall's end or a ridge's corner crossing it near the Pokémon), and a longer hold before easing back
  out changed little (they are first contacts, not a cycle). Fix: `boomTime.in`, the lens comes in at 15 m/s and hops
  only what is in its own way. Forest 1.2 a minute over a metre and none over 4 m; cave 2.6 and 4.3 m at most; the
  stress scenes' cave fight is back to 0.77 m, the cave walk (an Extra Large) is still 2.78 m. Not removed: what is left is rock thicker than that on the line, a tall Pokémon's pivot coming down under a deck's slab
  (half of the forest's), and a small Pokémon pressed into a corner where no arm fits. The bench now reports steps by
  size (`pops1`, `pops2`, `popMax`).

The hold-out set was therefore run five times, and all five are here. None of the four changes was chosen from a
hold-out figure: the first two came from frames and from the tuning-side aim split, the third from criterion F's roster
table, computed before either bench was run with it, the fourth from the stress scenes and the tuning tracks.

| Hold-out run | Over 1.25 × (sum; worst cell) | Lens steps a minute (late; unforced) | Clear frames with lens moved / Pokémon shifted |
|---|---|---|---|
| 1: first complete version (law on the top) | 100.8; 11.7 % | 2.99 (0.96; 0.67) | 0.0 % / 0.0 % |
| 2: drawn-height law, pivot held | 120.2; 16.7 % | 3.54 (1.15; 0.79) | 0.0 % / 0.0 % |
| 3: sprite's step share capped at a fixed 0.3 m | 120.2; 16.7 % | 3.92 (1.47; 1.15) | 0.3 % / 0.3 % |
| 4: capped at 0.35 × the outline top | 120.2; 16.7 % | 3.62 (1.20; 0.87); over 1 m not recorded | 0.1 % / 0.1 % |
| 5: the lens comes in at 15 m/s and hops only what is in its way (final) | 90.1; 10.9 % | 3.37 (1.40; 0.43); over 1 m 0.39, largest 7.6 m | 0.1 % / 0.1 % |

The longer arms cost a little on every motion figure (run 1 to run 2), and the step share shows in the bench as the
sprite moving against the lens (runs 3 and 4). All of it is inside the marks. Run 5 is better on every column: an arm
that is still on its way in when the rock has passed never gets as short.

### 25.6 What changed

- `src/assets/art.ts`, `measure.ts`, `pack.ts`: `FrameBounds`, `Silhouette` (every frame's bounds, the body, the combat
  corners), `OVERLAY` (the procedural lunge and bob, shared with the renderer); one atlas readback.
- `src/render/framing.ts` (new, pure): the card as the shaders draw it, `seen`, `subjectBox`, the keep-out, `fadeFor`,
  `Outline` (top, right, left, drop), `backFor`, `reserveCorner`, `pivotHeight`, `idealArm`.
- `src/render/camera.ts`: the L-shaped arm in four stages (ideal, clearance, smoothing, a last P1 check in `update` and
  `look`); `chasePivotH`; `spriteStep`; `boomTime.in`. Removed: `shoulder`, `pivot`, `arm.lift`, the lens floor and safety net, the
  dense-prop channel (`propsBlockLens`, `propDense`, `propBoom`, `minBoom`), `pullIn`, `anticipate`, the deck lead.
- `src/render/chaseinput.ts`: the outline; `solid` is bare walls only, deck-aware.
- `src/render/renderer.ts`, `tilestage.ts`: the measured outline to the rig; the sprite at `py + rig.spriteStep`; the
  keep-out fade from the frame about to be drawn; `subjectBox()`; the prop dissolve radius follows the lens distance.
- Benches: `scripts/camframe.ts`, `scripts/camaim.ts`, `scripts/camstats.ts --bench`, `scripts/lib/cambench.ts`,
  `camrig.ts`, `camposes.ts`, `silhouette.ts`; `tools/camframescenes.gen.mjs` and `.json`.
- Tests: `tests/camframe.test.ts`, `tests/camaim.test.ts` (new); `chase`, `camstability`, `freelook`, `viewsample`,
  `camfollow`, `walltops` rewritten where they pinned removed behaviour.
- No sim file. Every checksum line is the tree's before this pass.

### 25.7 Verification

- `npx tsx scripts/checksum.ts`: 64 lines, identical.
- `npm run typecheck`: clean. `npm test`: 596 tests, 590 pass, 2 skipped, the 4 known `tests/pointerlock.test.ts`
  failures.
- `scripts/camframe.ts`, `scripts/camstats.ts --bench tuning|holdout`, `scripts/camaim.ts --fight`: the table above;
  the same on the rebuilt §24 rig for the "before" column.
- Captures: a private build of each tree, `tools/cap.mjs` with `tools/camframescenes.json` (27 scenes; headless
  Chromium, software rendering), read frame by frame: ten species on open ground in every state, four at 1280 × 720,
  walls, a corner, a deck, forest and cave walks, the step strips, a target fired at. `tools/chasecheck.json` still runs
  on the new build.
- Not done: any hands-on play with a mouse or a pad; real-GPU timing; the off-frame cue in a wall-behind pose at a real
  window size (in the 640 × 360 captures it falls under the move bar).
- At commit: `npm run check` (typecheck clean; 596 tests, 590 pass, the same 4 `tests/pointerlock.test.ts` failures,
  so it stops before the build), `npm run build` separately (clean), the camera suites 156 / 156, and all 64
  `scripts/checksum.ts` lines identical to a b89fb55 snapshot.

### 25.8 Open

- **Large lens steps near rock** (0.9 a minute over a metre on the tuning maps; before, none). Options: look ahead of
  the arm sideways (a corridor: the arm shortens before rock reaches it; smooth, but the arm length then follows the
  surroundings); ease the pivot down for a slab over the arm when the lens itself is clear of it; a shorter arm for
  Large and Extra Large. Needs hands on a pad to choose.
- **Aiming past a close enemy, and the muzzle's parallax (E5).** Owner's call between: accept it with the blocked marker;
  move where shots leave from, or trace from the camera (sim work, its own checksum set); a smaller keep-out or
  `shoulderMax` (the sprite's widest rows dissolve instead).
- Playtest, owed: the framing by class; aiming at enemies in contact; a wall behind; steps for the smallest sprites; the
  dissolve when looking down; the move bar in a small window.
- The move bar is in the picture's lower centre in fixed pixels; a HUD that left the band under the crosshair free would
  let the Pokémon be drawn larger.
- `raycastWorld` for the lens; a shoulder-swap binding; a finer dissolve than the 4 × 4 dither.
- B5 (the sprite's own size by row and clip) stays with Stage 6B.

