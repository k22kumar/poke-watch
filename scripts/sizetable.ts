// Size table for the measurement axis and the continuous Extra Large draw (docs/archive/size-extremes-plan.md, Prompt S1).
//
//   npx tsx scripts/sizetable.ts            # markdown: every runtime species and every catalogue species
//   npx tsx scripts/sizetable.ts --changes  # only the species whose class the measurement axis moves
//
// Rows: every runtime species (SPECIES) and every catalogue species (the default record of each species in
// content/catalogue.json) with a listed height. A catalogue record becomes a bare SpeciesDef (its listed height and
// shape) for bodyOf; the script never adds it to SPECIES. Every value is under the default size rules (the axis and the
// continuous XL draw are hard-wired since pivot step 10); "listed class" is the class the listed figure alone would give.
import { defaultRules } from '../src/rules/defaults';
import { CATALOGUE, heightMeters } from '../src/rules/catalogue';
import { SPECIES, type SpeciesDef } from '../src/rules/species';
import { bodyOf, navWide, sizeClassIndex, speciesExtent, xlVisual, type SpeciesBody } from '../src/rules/sizing';
import { axisOf } from '../src/rules/shapes';

const S = defaultRules.size;
const cut = S.classes[S.classes.length - 2].below;

interface Row { id: string; name: string; lane: 'runtime' | 'catalogue'; sp: SpeciesDef; shape: string; listed: number }
const rows: Row[] = [];
const seen = new Set<string>();
for (const sp of SPECIES) {
  if (!sp.canon?.heightM) continue;
  rows.push({ id: sp.id, name: sp.name, lane: 'runtime', sp, shape: sp.canon.shape ?? '?', listed: sp.canon.heightM });
  seen.add(sp.id);
}
for (const r of CATALOGUE) {
  if (r.form.status !== 'species-default' || r.heightKind !== 'listed' || seen.has(r.id)) continue;
  const m = heightMeters(r).m;
  const sp = {
    id: r.id, name: r.name, elements: [], stats: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 }, height: m, art: r.id,
    canon: { levelUp: [], abilities: [], heightM: m, weightKg: 0, shape: r.shape ?? undefined, axis: axisOf(r.id, r.shape) },
  } as SpeciesDef;
  rows.push({ id: r.id, name: r.name, lane: 'catalogue', sp, shape: r.shape ?? '?', listed: m });
}
rows.sort((a, b) => b.listed - a.listed || a.id.localeCompare(b.id));

const body = (r: Row) => bodyOf(r.sp, S);
/** the class the listed figure alone gives (a length read as a height), for the --changes view */
const listedClass = (r: Row) => S.classes[sizeClassIndex(r.listed, S)];
const largest = rows.reduce((a, r) => (speciesExtent(r.sp, S).m > speciesExtent(a.sp, S).m ? r : a));
const maxS = speciesExtent(largest.sp, S).m;
const capAt = cut * (S.xlVisualCap / S.xlFloor) ** (1 / S.xlExponent);

const f2 = (n: number) => n.toFixed(2);
const cls = (b: SpeciesBody) => b.className.replace('Extra Large', 'XL');
const wide = (b: SpeciesBody) => (navWide(b.body) ? 'wide' : '');

function line(r: Row) {
  const b = body(r), e = speciesExtent(r.sp, S), lc = listedClass(r).name.replace('Extra Large', 'XL');
  return [
    r.lane === 'runtime' ? `**${r.name}**` : r.name, r.shape, e.axis, f2(r.listed), f2(e.m), lc, lc === cls(b) ? cls(b) : `**${cls(b)}**`,
    b.sizeClass === 'xl' && !b.authored ? f2(b.visualM) : '—', f2(b.radius), f2(b.height), f2(b.body), wide(b),
  ].join(' | ');
}

const head = `| Pokémon | shape | axis | listed m | extent used | listed class | class | XL draw @ ${S.xlExponent} | radius | height | footprint | nav |
|---|---|---|---:|---:|---|---|---:|---:|---:|---:|---|`;

const changed = rows.filter((r) => listedClass(r).id !== body(r).sizeClass && !body(r).authored && speciesExtent(r.sp, S).source === 'length-rise');
const out: string[] = [];
out.push(`lengthRise ${S.lengthRise}, xlExponent ${S.xlExponent} (fixed), cap ${S.xlVisualCap} m, reached at ${f2(capAt)} m of extent. Largest extent: ${largest.name} (${largest.lane}) ${f2(maxS)} m → draws ${f2(xlVisual(maxS, S))} m.`);
out.push(`Rows: ${rows.length} (${rows.filter((r) => r.lane === 'runtime').length} runtime, ${rows.filter((r) => r.lane === 'catalogue').length} catalogue-only). Classes the axis moves: ${changed.length} (${changed.filter((r) => r.lane === 'runtime').length} runtime).`);
out.push('');
out.push('Classes the measurement axis moves:');
out.push('');
out.push(head);
for (const r of changed) out.push(`| ${line(r)} |`);
if (!process.argv.includes('--changes')) {
  out.push('');
  out.push('All rows (runtime species in bold), by listed extent:');
  out.push('');
  out.push(head);
  for (const r of rows) out.push(`| ${line(r)} |`);
}
console.log(out.join('\n'));
