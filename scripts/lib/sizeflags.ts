// `--size a,b=false,c` for the gate scripts (navwalk, stuckwatch, habplay, perf-sim): sets those rules.size flags in every
// run the script creates (docs/size-extremes-plan.md, xlTall and "Default flip"). A bare name turns a flag on, `name=false`
// turns it off (axis, xlContinuous and xlTall are on by default since the flip: `--size axis=false` is the no-axis worst
// case). Only boolean flags of rules.size are accepted. The pair is taken out of process.argv when this module loads, so
// a script's positional arguments keep their places wherever `--size` is written.
import { defaultRules } from '../../src/rules/defaults';

const at = process.argv.indexOf('--size');
const names = at >= 0 ? (process.argv.splice(at, 2)[1] ?? '').split(',').filter(Boolean) : [];
const pairs = names.map((n): [string, boolean] => {
  const [k, v = 'true'] = n.split('=');
  if (typeof (defaultRules.size as Record<string, unknown>)[k] !== 'boolean') throw new Error(`--size: '${k}' is not a boolean rules.size flag`);
  if (v !== 'true' && v !== 'false') throw new Error(`--size: '${n}' must be name, name=true or name=false`);
  return [k, v === 'true'];
});
/** the --size flags as rules.size overrides ({} when none) */
export const SIZE_FLAGS: Record<string, boolean> = Object.fromEntries(pairs);
/** spread into a run's ruleOverrides: `{ size: { … } }`, or nothing */
export const sizeOverride = (): { size?: Record<string, boolean> } => (names.length ? { size: { ...SIZE_FLAGS } } : {});
/** for a script's header line */
export const sizeLabel = names.length ? `size flags: ${names.join(', ')}` : 'size flags: defaults';
