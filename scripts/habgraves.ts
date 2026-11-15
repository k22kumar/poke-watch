// Memorial Ridge's evidence (docs/HABITATS.md "Cemetery"): per seed, the marker family against both muzzle extremes, the firing
// lanes, whether the second way in stays unwatched, and the accepted/retry result through the normal flow.
//   npx tsx scripts/habgraves.ts [seeds] [--play]
//   seeds: comma list (3,5,7) or first:count (default 1:12). --play also walks both approaches in the real sim.
import { attemptHabitat, generateHabitat, HABITATS, profilesFor } from '../src/world/habitat';
import { CONTROL_POINT } from '../src/world/habitat/mode';
import { bracketsMuzzles } from '../src/world/habitat/graves';
import { LANE, muzzles, WATCH } from '../src/world/habitat/validate';
import { GRAVE_TOP } from '../src/world/tiles';
import { playHabitat } from './habplay';

const ID = 'forest-cemetery', P = profilesFor();
const spec = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : '1:12';
const seeds = spec.includes(':') ? Array.from({ length: Number(spec.split(':')[1]) }, (_, i) => Number(spec.split(':')[0]) + i) : spec.split(',').map(Number);
const play = process.argv.includes('--play');

const [lo, hi] = muzzles(P);
console.log(`muzzle extremes (essential bodies): ${lo} m (smallest wild) .. ${hi} m (tallest partner); marker tops: kerb ${GRAVE_TOP.kerb}, headstone ${GRAVE_TOP.stone}, stele ${GRAVE_TOP.stele} → ${bracketsMuzzles(lo, hi).why}`);
console.log(`limits: firing lane ≤ ${LANE} tiles, watched share < ${WATCH * 100} %, both measured at the small and the tall muzzle\n`);

let acc = 0, first = 0, ms = 0;
const lanes: number[] = [], marks: number[] = [], watch: number[] = [];
for (const seed of seeds) {
  const t0 = performance.now(), m = generateHabitat({ recipe: ID, seed }), dt = performance.now() - t0, H = m.gen!.hab!;
  ms += dt; acc++; if (H.attempts === 1) first++;
  const M = H.metrics, w = Object.entries(M).filter(([k]) => k.startsWith('watch:')).map(([, v]) => v);
  lanes.push(Math.max(M['lane:small'], M['lane:tall'])); marks.push(M.markers); watch.push(Math.max(...w));
  const row = `seed ${String(seed).padStart(3)} ${H.attempts === 1 ? 'first try' : `try ${H.attempts} (${H.rejections.map((r) => r.failed.join('+')).join('; ')})`}${H.fallback ? ' FALLBACK' : ''}`.padEnd(46)
    + ` plots ${H.shape.plots} markers ${M.markers} (${M.kerbs}k/${M.stones}h/${M.steles}s) wall ${H.shape.wallRim}+${H.shape.wallCourt}+${H.shape.wings} open ${H.shape.openings}`
    + ` | lane small ${M['lane:small']} tall ${M['lane:tall']} | watched ≤ ${Math.max(...w).toFixed(2)} | travel A ${M.timeA} B ${M.timeB} s skew ${(M.skew * 100).toFixed(0)} % | ${dt.toFixed(0)} ms`;
  console.log(row);
  if (play) for (const r of playHabitat(ID, seed, {})) console.log(`      ${r.route.padEnd(6)} walk ${r.reach?.toFixed(1)} s, hold ${r.held ? 'done' : 'NO'}, back ${r.back?.toFixed(1)} s, stalls ${r.stalls}`);
}
const q = (a: number[], p: number) => [...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(a.length * p))];
console.log(`\n${acc}/${seeds.length} accepted, ${first} on the first attempt; generation ${(ms / seeds.length).toFixed(0)} ms mean; markers ${Math.min(...marks)}-${Math.max(...marks)}; longest lane ${Math.min(...lanes)}-${Math.max(...lanes)} (p50 ${q(lanes, 0.5)}); worst watched share ${Math.max(...watch).toFixed(2)}`);

// raw attempts (no retry) over the same seeds: how often the generator needs one
let raw = 0; const fails: Record<string, number> = {};
for (const s of seeds) { const a = attemptHabitat(HABITATS[ID], CONTROL_POINT, s, 128, '', P); if (a.ok) raw++; else for (const f of a.failed) fails[f] = (fails[f] ?? 0) + 1; }
console.log(`raw first attempts ${raw}/${seeds.length}${Object.keys(fails).length ? '; rejected by ' + JSON.stringify(fails) : ''}`);
