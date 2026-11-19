// The right stick as a look input (docs/CONTROLS.md "Look"). Pure, no DOM: input/input.ts calls it on the raw pad axes,
// tests/lookinput.test.ts pins it.

/** the look stick's dead zone (share of full deflection) and response exponent */
export const STICK = { dead: 0.18, exp: 2 };

/** A raw stick (-1..1 per axis) as a look input: a radial dead zone (the direction is kept, so a small diagonal push is
 *  never snapped onto an axis as a per-axis dead zone does), the magnitude past it rescaled to start from 0 at its edge
 *  (no jump to a minimum turn rate), then raised to `exp` so small deflections aim finely and full deflection turns at
 *  the full rate. Before this the look stick had a per-axis 0.18 dead zone and no rescale: the slowest turn it could
 *  make was 0.18 of full speed (27°/s of yaw), and pushing slightly off an axis turned along the axis */
export function shapeStick(x: number, y: number, dead = STICK.dead, exp = STICK.exp): [number, number] {
  const m = Math.hypot(x, y);
  if (m <= dead) return [0, 0];
  const k = Math.pow(Math.min(1, (m - dead) / (1 - dead)), exp) / m;
  return [x * k, y * k];
}
