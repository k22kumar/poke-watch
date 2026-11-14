// Gate sweep and metrics for location maps: `npx tsx scripts/locstats.ts [location|all] [seeds] [firstSeed]`.
// Prints one line per seed (attempts, failed gates, time) and a summary of every metric per location.
import { generateLocation } from '../src/world/locgen';
import { LOCATIONS } from '../src/world/locations';

const which = process.argv[2] ?? 'all', N = Number(process.argv[3] ?? 10), first = Number(process.argv[4] ?? 1);
const verbose = process.argv.includes('-v');
for (const id of which === 'all' ? Object.keys(LOCATIONS) : [which]) {
  const ms: number[] = [], fails: Record<string, number> = {}, metrics: Record<string, number[]> = {};
  let attempts = 0, pass = 0;
  const sigs = new Set<string>();
  for (let s = first; s < first + N; s++) {
    const m = generateLocation({ location: id, seed: s });
    const g = m.gen!, L = g.loc!;
    ms.push(g.ms); attempts += g.attempts;
    const failed = g.gates.filter((x) => !x.ok);
    if (!failed.length) pass++;
    for (const f of failed) fails[f.id] = (fails[f.id] ?? 0) + 1;
    for (const [k, v] of Object.entries(L.metrics)) (metrics[k] ??= []).push(v);
    sigs.add(L.zones.map((z) => `${z.kind[0]}${z.tier}`).join('') + '|' + L.links.map((l) => l.kind[0]).join(''));
    if (verbose || failed.length) console.log(`${id} seed ${s}: ${g.archetype} attempts ${g.attempts} ${g.ms.toFixed(0)} ms ${failed.length ? 'FAIL ' + failed.map((f) => `${f.id}(${f.value})`).join(' ') : 'ok'}`);
  }
  ms.sort((a, b) => a - b);
  console.log(`\n${id}: ${pass}/${N} pass, attempts ${attempts}, ms p50 ${ms[ms.length >> 1].toFixed(0)} p95 ${ms[Math.floor(ms.length * 0.95)].toFixed(0)} max ${ms[ms.length - 1].toFixed(0)}, distinct structures ${sigs.size}/${N}`);
  if (Object.keys(fails).length) console.log('  failed gates:', fails);
  for (const [k, v] of Object.entries(metrics)) {
    const s = [...v].sort((a, b) => a - b), mean = v.reduce((a, b) => a + b, 0) / v.length;
    console.log(`  ${k.padEnd(12)} mean ${mean.toFixed(2).padStart(7)}  min ${s[0]}  max ${s[s.length - 1]}`);
  }
}
