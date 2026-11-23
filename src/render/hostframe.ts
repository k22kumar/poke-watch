// The host's per-frame order between look input, the view sample and the fixed sim ticks (docs/THIRD_PERSON.md,
// "View-state contract"). main.ts runs it every animation frame; tests/viewsample.test.ts drives the same function
// headless with a real rig and a real run, so the order the game uses is the order that is tested. Pure: no DOM, no GL.
//
//   1. look()      this frame's mouse / stick look input is applied to the camera (yaw and pitch, at once)
//   2. view()      one immutable view sample is taken (render/camera.ts ViewSample)
//   3. tick(view)  every fixed 1/60 s sim step due this frame aims with that same sample (zero, one or several)
//   4. (caller)    render: the camera advances its own clock by the frame time and the frame is drawn
//
// The camera's clock advances only in step 4, once per frame; steps 1-2 never advance it. The sim receives only what
// tick() writes into its InputFrame (aimX/aimZ today), so replays depend on recorded input, never on renderer state.

/** The crosshair ray of a view sample as the sim receives it (InputFrame.aim, docs/THIRD_PERSON_IMPLEMENTATION.md §13):
 *  the lens and the unit view axis (the crosshair is the screen centre, RETICLE_Y = 0.5), each through Math.fround so a
 *  recording stores exactly what the sim saw. Built once per frame from the frame's one sample, never from the live rig. */
export function aimRayOf(view: { readonly eye: readonly number[]; readonly dir: readonly number[] }): { ox: number; oy: number; oz: number; dx: number; dy: number; dz: number } {
  const f = Math.fround;
  return { ox: f(view.eye[0]), oy: f(view.eye[1]), oz: f(view.eye[2]), dx: f(view.dir[0]), dy: f(view.dir[1]), dz: f(view.dir[2]) };
}

/** look sensitivity: radians per pointer-locked mouse count (the same for yaw and pitch, as in most PC shooters: an unequal
 *  pair bends a diagonal flick), and the right stick's full-deflection turn rates (rad/s, yaw and pitch) */
export const LOOK = { mouse: 0.0022, stickYaw: 2.6, stickPitch: 1.5 };

/** what one look gesture turns the camera by: radians of yaw (+ right) and pitch (+ down) from the mouse movement
 *  since the last frame (px, pointer-locked) and the look stick (-1..1, already shaped: input/stick.ts), scaled by the
 *  frame time, or null for none */
export function lookDelta(mouse: readonly [number, number], stick: readonly [number, number], dt: number, sens: number, invertY: boolean): [number, number] | null {
  const inv = invertY ? -1 : 1;
  let yaw = mouse[0] * LOOK.mouse * sens, pitch = mouse[1] * LOOK.mouse * sens * inv;
  const [rx, ry] = stick;
  if (rx || ry) { yaw += rx * LOOK.stickYaw * sens * dt; pitch += ry * LOOK.stickPitch * sens * inv * dt; }
  return yaw || pitch ? [yaw, pitch] : null;
}

interface FrameHooks<V> {
  /** apply this frame's look input to the camera */
  look(): void;
  /** the view every tick of this frame aims with (taken once, after look) */
  view(): V;
  /** one fixed sim step with that view: 'go' to continue, 'end' after a step that ended the run (no more steps this
   *  frame), 'abort' when the run was torn down (the frame stops at once: nothing to draw) */
  tick(view: V): 'go' | 'end' | 'abort';
}

interface FrameResult<V> {
  /** the accumulator left after the steps (the render interpolates by acc / dt) */
  acc: number;
  steps: number;
  /** the sample the steps used, or null when the sim did not run this frame */
  view: V | null;
  aborted: boolean;
}

/** One host frame up to the render. `acc` already holds this frame's (scaled) time. With `simulate` false (paused, run
 *  over) look input is still consumed by look() but no sample is taken and no step runs. */
export function runFrame<V>(h: FrameHooks<V>, acc: number, dt: number, maxSteps: number, simulate = true): FrameResult<V> {
  h.look();
  if (!simulate) return { acc, steps: 0, view: null, aborted: false };
  const view = h.view();
  let steps = 0;
  while (acc >= dt && steps < maxSteps) {
    const r = h.tick(view);
    if (r === 'abort') return { acc, steps, view, aborted: true };
    acc -= dt;
    steps++;
    if (r === 'end') break;
  }
  // a frame that could not catch up drops the backlog rather than spiralling
  if (steps >= maxSteps) acc = 0;
  return { acc, steps, view, aborted: false };
}
