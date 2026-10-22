// First-attempt gate statistics and stage timings over many seeds (W1 tool):
// `npx tsx scripts/worldstats.ts [count] [firstSeed]`. Prints how often each gate fails on the first attempt, the
// distribution of attempts and of total generation time.
import { generateAttempt, generateRegion } from '../src/world/gen';

const count = Number(process.argv[2] ?? 100), first = Number(process.argv[3] ?? 1);
const species = ['rattata', 'ledyba', 'sandshrew', 'oddish', 'poliwag', 'mareep', 'heracross', 'geodude'];
const fails = new Map<string, number>(), examples = new Map<string, string[]>();
const timing: Record<string, number> = {};
const totals: number[] = [], attemptsHist = new Map<number, number>();
let finalFail = 0;
const arche = new Map<string, number>();
for (let s = first; s < first + count; s++) {
  const r = generateAttempt({ biome: 'meadow', seed: s, species }, s, true);
  for (const [k, v] of Object.entries(r.g.timing!)) timing[k] = (timing[k] ?? 0) + v;
  for (const gt of r.v.gates) if (!gt.ok) { fails.set(gt.id, (fails.get(gt.id) ?? 0) + 1); const e = examples.get(gt.id) ?? []; if (e.length < 4) e.push(`${s}:${gt.value}`); examples.set(gt.id, e); }
  const t = performance.now();
  const m = generateRegion({ biome: 'meadow', seed: s, species });
  totals.push(performance.now() - t);
  attemptsHist.set(m.gen!.attempts, (attemptsHist.get(m.gen!.attempts) ?? 0) + 1);
  arche.set(m.gen!.archetype, (arche.get(m.gen!.archetype) ?? 0) + 1);
  if (m.gen!.gates.some((g) => !g.ok)) finalFail++;
}
totals.sort((a, b) => a - b);
const pct = (p: number) => totals[Math.min(totals.length - 1, Math.floor(totals.length * p))].toFixed(0);
console.log(`seeds ${count}: final failures ${finalFail}; generation ms p50 ${pct(0.5)} p95 ${pct(0.95)} max ${pct(1)}`);
console.log('attempts:', [...attemptsHist].sort((a, b) => a[0] - b[0]).map(([a, n]) => `${a}:${n}`).join(' '), ' archetypes:', [...arche].map(([a, n]) => `${a} ${n}`).join(', '));
console.log('first-attempt gate failures:');
for (const [id, n] of [...fails].sort((a, b) => b[1] - a[1])) console.log(`  ${id.padEnd(12)} ${n}  e.g. ${examples.get(id)!.join(' | ')}`);
console.log('stage ms per attempt:', Object.entries(timing).map(([k, v]) => `${k} ${(v / count).toFixed(1)}`).join(', '));
