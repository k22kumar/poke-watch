// `--size a,b,c` for the gate scripts (navwalk, stuckwatch, habplay, perf-sim): turns those rules.size flags on in every
// run the script creates (docs/size-extremes-plan.md, xlTall). Only boolean flags of rules.size are accepted (axis,
// xlContinuous, xlTall, …). The pair is taken out of process.argv when this module loads, so a script's positional
// arguments keep their places wherever `--size` is written.
import { defaultRules } from '../../src/rules/defaults';

const at = process.argv.indexOf('--size');
const names = at >= 0 ? (process.argv.splice(at, 2)[1] ?? '').split(',').filter(Boolean) : [];
for (const n of names) {
  if (typeof (defaultRules.size as Record<string, unknown>)[n] !== 'boolean') throw new Error(`--size: '${n}' is not a boolean rules.size flag`);
}
/** the --size flags as rules.size overrides ({} when none) */
export const SIZE_FLAGS: Record<string, boolean> = Object.fromEntries(names.map((n) => [n, true]));
/** spread into a run's ruleOverrides: `{ size: { … } }`, or nothing */
export const sizeOverride = (): { size?: Record<string, boolean> } => (names.length ? { size: { ...SIZE_FLAGS } } : {});
/** for a script's header line */
export const sizeLabel = names.length ? `size flags: ${names.join(', ')}` : 'size flags: defaults';
