// A run that has ended (a knockout out of Pokémon) no longer advances time: step() returns at once in 'over'.
// A harness loop that waits on ctx.time would then spin forever (navwalk did, 2026-11-20, when its
// driven trainer fell into a chasm). Every such loop checks runEnded and fails fast: loops that return a verdict report
// the end as a failure with its reason; the others throw assertRunning's error.
import type { SimContext } from '../../src/sim/types';

export const runEnded = (ctx: SimContext): boolean => ctx.state === 'over';

/** a one-line reason: which state, when and where */
export const endedNote = (ctx: SimContext): string =>
  `the run ended (${ctx.state}) at ${ctx.time.toFixed(2)} s with ${ctx.player.species.id} at ${ctx.player.x.toFixed(2)},${ctx.player.z.toFixed(2)} y ${ctx.player.y.toFixed(2)}`;

export function assertRunning(ctx: SimContext, where: string): void {
  if (runEnded(ctx)) throw new Error(`${where}: ${endedNote(ctx)}`);
}
