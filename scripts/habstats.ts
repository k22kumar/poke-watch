// Seed sweep for habitat recipes: `npx tsx scripts/habstats.ts [recipe|all] [seeds] [firstSeed] [-v] [--json out.json]`.
// For every seed: whether the requested seed was accepted on its first attempt, how many attempts it took, every
// rejected attempt's failed gates, a fallback if one was needed, and the time. Then a summary per recipe: acceptance,
// rejection causes by gate, distinct traversable layouts, and every metric.
import { writeFileSync } from 'node:fs';
import { attemptHabitat, generateHabitat, HabitatError, HABITATS, profilesFor } from '../src/world/habitat';
import { CONTROL_POINT } from '../src/world/habitat/mode';
import { defaultRules } from '../src/rules/defaults';

const which = process.argv[2] ?? 'all', N = Number(process.argv[3] ?? 10), first = Number(process.argv[4] ?? 1);
const verbose = process.argv.includes('-v'), jsonAt = process.argv.indexOf('--json');
const profiles = profilesFor(defaultRules, 4);
const out: Record<string, unknown> = {};
for (const id of which === 'all' ? Object.keys(HABITATS) : [which]) {
  const ms: number[] = [], rejectBy: Record<string, number> = {}, metrics: Record<string, number[]> = {};
  let firstTry = 0, accepted = 0, fallbacks = 0, errors = 0, attempts = 0;
  const shapes = new Set<string>(), rows: unknown[] = [];
  for (let s = first; s < first + N; s++) {
    const t0 = performance.now();
    // the first attempt on its own, to count first-try acceptance and the gates a raw seed fails
    const a0 = attemptHabitat(HABITATS[id], CONTROL_POINT, s, 128, '', profiles);
    if (a0.ok) firstTry++;
    try {
      const m = generateHabitat({ recipe: id, seed: s });
      const H = m.gen!.hab!;
      ms.push(performance.now() - t0); attempts += H.attempts; accepted++;
      if (H.fallback) fallbacks++;
      for (const r of H.rejections) for (const f of r.failed) rejectBy[f.split(':').slice(0, 2).join(':')] = (rejectBy[f.split(':').slice(0, 2).join(':')] ?? 0) + 1;
      for (const [k, v] of Object.entries(H.metrics)) (metrics[k] ??= []).push(v);
      shapes.add(JSON.stringify(H.shape));
      rows.push({ seed: s, attempts: H.attempts, attemptSeed: H.attemptSeed, fallback: H.fallback ?? null, rejections: H.rejections, repairs: H.repairs, optional: H.optional, metrics: H.metrics });
      if (verbose || H.attempts > 1 || H.fallback) console.log(`${id} seed ${s}: attempts ${H.attempts}${H.fallback ? ` FALLBACK→${H.fallback.used}` : ''} ${(performance.now() - t0).toFixed(0)} ms${H.rejections.length ? ' rejected: ' + H.rejections.map((r) => `${r.seed}[${r.failed.join(',')}]`).join(' ') : ''}${H.repairs.length ? ' repairs: ' + H.repairs.length : ''}${verbose ? ' optional: ' + H.optional.join(',') : ''}`);
    } catch (e) {
      errors++;
      console.log(`${id} seed ${s}: ERROR ${(e as Error).message}`);
      if (e instanceof HabitatError) for (const r of e.rejections) for (const f of r.failed) rejectBy[f] = (rejectBy[f] ?? 0) + 1;
      rows.push({ seed: s, error: (e as Error).message });
    }
  }
  ms.sort((a, b) => a - b);
  console.log(`\n${id}: ${firstTry}/${N} accepted on the first attempt, ${accepted}/${N} accepted (${fallbacks} by fallback, ${errors} errors), ${attempts} attempts, ms p50 ${ms[ms.length >> 1]?.toFixed(0)} p95 ${ms[Math.floor(ms.length * 0.95)]?.toFixed(0)} max ${ms[ms.length - 1]?.toFixed(0)}, distinct layouts ${shapes.size}/${accepted}`);
  if (Object.keys(rejectBy).length) console.log('  rejected attempts by gate:', rejectBy);
  for (const [k, v] of Object.entries(metrics)) {
    const s = [...v].sort((a, b) => a - b), mean = v.reduce((a, b) => a + b, 0) / v.length;
    console.log(`  ${k.padEnd(18)} mean ${mean.toFixed(2).padStart(8)}  min ${s[0]}  max ${s[s.length - 1]}`);
  }
  out[id] = { seeds: N, first, firstTry, accepted, fallbacks, errors, attempts, distinct: shapes.size, rejectBy, rows };
}
if (jsonAt > 0) writeFileSync(process.argv[jsonAt + 1], JSON.stringify(out, null, 1));
