// Replay checksums: the hero-shooter replay baseline (tests/fixtures/scenarios.ts, docs/hero-shooter-pivot.md Q41–Q44).
//   npx tsx scripts/checksum.ts [scenario|all] [--update]
// Runs each named scenario (all by default) and prints its checkpoints (every 10 s), its end hash and the coverage
// counters it reached. With --update it writes those hashes into tests/fixtures/replays.json (only the scenarios run;
// the rest stay as they are). tests/replays.test.ts asserts the file in `npm test`, so a commit that changes it says why.
// The survivor sets (`on`, `gen`, `aim`, `deck` and the 19 flag-off layers) and legacyHash retired at pivot step 10;
// the `survivor-final` tag reproduces them.
import fs from 'node:fs';
import { SCENARIOS, runScenario } from '../tests/fixtures/scenarios';

const FIXTURE = new URL('../tests/fixtures/replays.json', import.meta.url);
const COMMENT = 'Hero-shooter replay baseline (tests/replays.test.ts). Rewritten by `npx tsx scripts/checksum.ts [scenario|all] --update`; a commit that changes it says why.';

const args = process.argv.slice(2), update = args.includes('--update');
const which = args.find((a) => !a.startsWith('--')) ?? 'all';
const picked = which === 'all' ? SCENARIOS : SCENARIOS.filter((s) => s.id === which);
if (!picked.length) {
  console.error(`unknown scenario ${which}; one of: all, ${SCENARIOS.map((s) => s.id).join(', ')}`);
  process.exit(1);
}

const old: Record<string, unknown> = fs.existsSync(FIXTURE) ? JSON.parse(fs.readFileSync(FIXTURE, 'utf8')).scenarios : {};
const out: Record<string, unknown> = { ...old };
for (const s of picked) {
  const r = runScenario(s);
  out[s.id] = { checkpoints: r.checkpoints, end: r.end };
  const cov = Object.entries(r.coverage ?? {}).filter(([, v]) => v).map(([k, v]) => `${k}=${v}`).join(' ');
  const was = old[s.id] as { checkpoints: string[]; end: string } | undefined;
  const same = was && was.end === r.end && was.checkpoints.join() === r.checkpoints.join();
  console.log(`${s.id.padEnd(18)} ${r.checkpoints.join(' ')} end=${r.end} ${was ? (same ? '(as recorded)' : 'MOVED') : '(not recorded)'}\n${''.padEnd(18)} ${cov}`);
}
if (update) {
  // keep the scenario order of tests/fixtures/scenarios.ts; drop entries for scenarios that no longer exist
  const ordered = Object.fromEntries(SCENARIOS.filter((s) => out[s.id]).map((s) => [s.id, out[s.id]]));
  fs.writeFileSync(FIXTURE, JSON.stringify({ comment: COMMENT, scenarios: ordered }, null, 1) + '\n');
  console.log('wrote tests/fixtures/replays.json');
}
