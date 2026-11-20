# Controls

How the player's keys, buttons and touches become the sim's input. Code: `src/input/input.ts` (capture and sampling),
`src/input/bindings.ts` (tables, pure), `src/ui/settings.ts` (saved overrides), `src/ui/ui.ts` (Settings → Controls →
Bindings), `src/sim/locomotion.ts` `jumpControl` (what Jump does in the sim). Tests: `tests/controls.test.ts`,
`tests/jumpcontrol.test.ts`, `tests/primaryfire.test.ts` (combat presses). Harness: `scripts/jumptiming.ts` (T33, the
R6c half). Roadmap: R6c of the architecture audit plan (§12.6, decision M). Related: `docs/LOCOMOTION.md` (the body
step), `docs/THIRD_PERSON.md` (camera, pointer lock).

## What the sim sees

One `InputFrame` per sim tick, built by `Input.sample(yaw)` in the host's frame loop (`render/hostframe.ts`). The fields
this doc covers:

| Field | Meaning | Absent |
|---|---|---|
| `mx, mz` | planar wish in world axes, from the move keys / left stick / touch pad, relative to the camera yaw (yaw only: the movement basis never tilts with pitch) | — |
| `jump` | Jump held | — |
| `jumpPressed` | Jump went down since the last sample (R6c). The game's input always sends it | legacy rule (below) |
| `my` | vertical intent, ascend − descend in −1..1 (R6c). Ascend = Jump held, descend = the `descend` action; both held cancel | 0 |
| `btn`, `press` | combat buttons held, and their rising edges (Phase 3) | no presses |
| `aim`, `aimDev` | the camera's crosshair ray and the aiming device | no ray |

Looking up or down never changes altitude (invariant 4): `my` comes from buttons only, `Input.sample` never reads the
camera pitch, and nothing in `sim/locomotion.ts` takes the aim ray. `tests/jumpcontrol.test.ts` sweeps an aim ray
through ±89° and checks every height, vertical speed and support flag against the same run without it.

## Look

Look input turns the third-person camera, which is the aim (`docs/THIRD_PERSON.md` "Camera"). It is applied at once,
on the frame it arrives (`ChaseRig.look`), before the frame's view sample; it never reaches movement or altitude.

- **Mouse** (pointer-locked): `LOOK.mouse` = 0.0022 rad per count for both yaw and pitch (`src/render/hostframe.ts`),
  times Settings → Look speed, pitch flipped by Invert look. Until 2026-11-18 pitch was 0.0018 rad per count against
  0.0022 for yaw, so a 45° mouse motion turned the view at 39° and a diagonal flick curved.
- **Right stick**: a radial dead zone of 0.18, the magnitude past it rescaled to start from 0, then a response exponent
  of 2 (`shapeStick`, `src/input/stick.ts`, constants `STICK`); full deflection turns `LOOK.stickYaw` 2.6 rad/s of yaw
  and `LOOK.stickPitch` 1.5 rad/s of pitch. Before, each axis had its own 0.18 dead zone with no rescale: the slowest
  turn the stick could make was 0.18 of full speed (27°/s of yaw), and a push just off an axis turned along the axis.
  The movement stick keeps its per-axis dead zone (fixed views read the raw right stick for stick aim, unchanged).
- Touch look (the right-hand touch area) is passed through as it was.

Tests: `tests/lookinput.test.ts`; the host order (look → sample → ticks) is `tests/viewsample.test.ts`.

## Jump

**Edges.** `Input` latches Jump's rising edge (`jumpLatch`) on the first keydown of a bound key (auto-repeat keydowns are
not presses), on the touch button's pointerdown, and on the pad's jump button (polled). A tap that goes down and up
between two samples reaches the next sample as `jumpPressed: true, jump: false` (claim 8a of the ledger, lost before
R6c). Pause, menus and focus loss drop a pending press (`clearButtons`).

**Pad polling.** A pad has no events, so its buttons are polled: `Input.pollPad()` runs every frame of play (`main.ts`)
and inside every sample, and latches the jump edge and the combat buttons' edges. Before R6c the pad was read only at a
sample, so on a display faster than 60 Hz (most frames take no sample) a press shorter than a tick was lost even when a
frame saw it. A press shorter than one frame still falls between two polls; nothing can see it.

**In the sim** (`jumpControl`, §12.6; the integrators are in `docs/LOCOMOTION.md`). With `jumpPressed` present:

| State | Jump pressed (edge) | Jump held | Descend held |
|---|---|---|---|
| supported | ground jump. If it cannot (an exposed body in a liquid) the press waits in the buffer | no repeat jump (fixes claim 8b) | nothing |
| ballistic, inside the coyote window | ground jump | glide (lift row) | nothing |
| ballistic | the template's `airPress`: `doubleJump` once per airtime, `takeoff` (R6d), or `none`: the press waits in the buffer | glide (lift row) | nothing |
| scripted (Dash) | ground jump when supported (the Dash declares it; a grounded dash could always jump); air presses are ignored and wait in the buffer | as its support state | nothing |
| volume × air, volume × liquid | R6d / R8 (not built) | ascend (`my`) | descend (`my`) |

- **Buffer**: a press stays eligible for a ground jump `rules.player.jumpBuffer` = 0.12 s (7 ticks) after its tick.
- **Coyote time**: a body that left its support without jumping may still ground-jump for `rules.player.coyote` = 0.1 s
  (6 ticks). A jump spends it.
- Both are whole ticks of sim time held on the body (`Player.ctl`), never host time, so a replay of the frames
  reproduces them. 0 turns either off.
- A buffered press only ever makes a ground jump. An airborne meaning needs a press on its own tick, so the press that
  started a jump can never also double jump or take off, and holding never takes off.
- `airPress` comes from the species' traversal rows (`rules/traversal.ts`, `traversalOf(...).airPress`). A species' rows
  give it at most one meaning; `takeoff` only on a fly or levitate row (both reserved until R6d / R6e). No shipped
  template sets one, so today an airborne press means nothing and waits for the landing.

**Legacy rule.** An `InputFrame` without `jumpPressed` (the bot, older replays, tests that send
`jump: true`) keeps the pre-R6c rule bit for bit: held Jump jumps whenever the body is supported, so holding repeats a
jump on every landing (8 jumps in 300 ticks), and a tap shorter than a sample is lost. `Player.ctl` stays zero, so the
state hash is unchanged.

## Descend and the vertical intent

`descend` is a new action. `my = (Jump held) − (descend held)`, so ascend and descend share the Jump button by state
(§12.6: Jump = jump, take-off or ascend). Nothing reads `my` before R6d's volume integrator: supported, ballistic and
scripted bodies ignore it (checked per tick against runs without it). The touch Descend button exists beside Jump but
stays hidden until a partner can fly (R6d shows it for a body with a volume capability).

**Pad default: left-stick click (L3), provisional; X is the alternative.** What the automated checks show: the
click and the stick are separate inputs, so L3 at full deflection or during hard diagonal steering still gives the full
planar wish and `my = −1` together; L3 + A cancel to 0; descend is a hold, not a toggle, so an accidental click is a
descent only while the click lasts (and does nothing at all before R6d). What they cannot show, and a hands-on session
must: whether L3 can be held comfortably through a 10 s descent while steering, and how often hard steering clicks it
by accident on real pads. X stays unbound by default (no duplicate active binding, owner decision 2026-11-17): if the
playtest finds L3 uncomfortable or too easy to click by accident, X is the alternative, bound on the Bindings screen or
made the default then. It costs the right thumb its aim while held, which is why it is not the first choice.

## Bindings

Tables in `src/input/bindings.ts`: `DEFAULT_KEYS` (KeyboardEvent codes) and `DEFAULT_PAD` (standard-mapping button
indices), one list per action, at most two codes each. Every earlier default is unchanged (`tests/controls.test.ts`
pins the pre-R6c tables).

| Device | Defaults |
|---|---|
| Keyboard | W A S D / arrows move, Space jump, **V descend**, Shift dash, J attack, K Move A, R Move B, Q Signature / Tag, E / L Guard, F Touch (hold: Breakthrough), Esc / P pause, M mute, \` tuning (the card picks, reroll, skip, banish and the C cursor toggle went with the cards at hero-shooter pivot step 9) |
| Mouse (fixed) | left attack, right Move A; captured mouse looks and aims |
| Gamepad | A jump, B dash, Y Signature, LB Guard, RB Move B, LT Move A, RT attack, Start pause, **left-stick click descend**; left stick moves, right stick looks (axes, fixed). X, Back and right-stick click are free |
| Touch | Atk, A, B, Sig, Guard, Jump, Dash; Descend (hidden until R6d) |

Ctrl is not a default anywhere: Ctrl + W / S / D are browser shortcuts while moving, and Ctrl + W cannot be intercepted.
A player may still bind it. Tab is never bound (focus order); Esc cancels a capture on the Bindings screen, so it can
only stay where it is (Pause) or be replaced there.

**Overrides.** The settings save only the actions the player changed (`settings.keys`, `settings.pad`), so a default
added later reaches an old save. `resolveBindings(defaults, overrides)` builds the table in use: an overridden action has
exactly its override's codes, and a code an override claims leaves every action that was not overridden. One code drives
one action: `assignBinding` moves a code from the action that had it (the screen says from where), and
`bindingConflicts` of any resolved table is empty (checked over a seeded storm of 400 random assignments).
`loadSettings` cuts whatever was saved down to known actions and valid codes.

**Settings → Controls → Bindings.** Every action with two keyboard and two gamepad slots. Choose a slot, then press a key
or a pad button; Esc cancels, Delete or Backspace clears the slot; Reset bindings restores the defaults (so does Settings
→ Reset to defaults). Changes apply and save at once. The HUD's key hint follows the keyboard table; the help screen
lists the defaults and says where to change them. Menu navigation on the pad (A confirm, B back, d-pad or stick to move
focus) and the sticks are fixed.

## Jump timing (T33, R6c half)

`npx tsx scripts/jumptiming.ts` drives the real `Input` on a stubbed DOM through `runFrame` into the real sim at 30, 60
and 144 frames per second. 2026-11-17:

- Key taps of 2, 8, 16, 50 and 200 ms at three phases inside a frame: every one jumps exactly once, on the first tick
  sampled after the key went down (0 ticks of lag at every frame rate; the wall-clock wait is the time to the next frame).
- Pad taps: every tap that lasts at least one frame jumps once, on that frame's first tick. Shorter taps fall between two
  polls (2–16 ms at 30 fps, 2–8 ms at 60 fps, 2 ms at 144 fps).
- A 5 s hold: one jump with edges (the legacy rule: 8).
- Tapping at 8 Hz: a jump on each landing that a tap reaches within the buffer, never two from one tap.

The buffer and coyote windows are measured on the real step in `tests/jumpcontrol.test.ts` (a press 1–7 ticks before
landing jumps on the first supported tick, 8+ is dropped; a press 1–6 ticks after walking off a ledge jumps, 7+ does
not).

## Not covered here (yet)

- Take-off, ascend, descend and landing timing: they need the volume integrator (R6d, T33's other half, T34).
- Hands-on: the look stick's dead zone and curve on real pads (drift, feel at low deflection), and whether the 2.6 / 1.5
  rad/s full-deflection rates suit the closer camera; left-stick-click comfort and accidental clicks on real pads; the Bindings screen with a real keyboard, pad
  and screen reader; touch Descend once it is visible.
