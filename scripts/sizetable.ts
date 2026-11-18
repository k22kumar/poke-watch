// Size table for the measurement axis and the continuous Extra Large draw (docs/size-extremes-plan.md, Prompt S1).
//
//   npx tsx scripts/sizetable.ts            # markdown: every runtime species and every catalogue species
//   npx tsx scripts/sizetable.ts --changes  # only the class changes and the exponent fit
//
// Rows: every runtime species (SPECIES) and every catalogue species (the default record of each species in
// content/catalogue.json) with a listed height. A catalogue record becomes a bare SpeciesDef (its listed height and
// shape) for bodyOf; the script never adds it to SPECIES. Columns follow the S1 handoff as amended by the owner
// (2026-11-18: the XL exponent is the fixed rules.size.xlExponent, never fitted): radius, height, footprint and the
// wide-field flag are the values with rules.size.axis on, "today → axis" where they change.
import { defaultRules } from '../src/rules/defaults';
import { CATALOGUE, heightMeters } from '../src/rules/catalogue';
import { SPECIES, type SpeciesDef } from '../src/rules/species';
import { bodyOf, navWide, speciesExtent, xlVisual, type SpeciesBody } from '../src/rules/sizing';
import { axisOf } from '../src/rules/shapes';

const S = defaultRules.size;
const AXIS = { ...S, axis: true };
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

const today = (r: Row) => bodyOf(r.sp, S);
const axisOn = (r: Row) => bodyOf(r.sp, AXIS);
const BOTH = { ...AXIS, xlContinuous: true };
const largest = rows.reduce((a, r) => (speciesExtent(r.sp, AXIS).m > speciesExtent(a.sp, AXIS).m ? r : a));
const maxS = speciesExtent(largest.sp, AXIS).m;
const capAt = cut * (S.xlVisualCap / S.xlFloor) ** (1 / S.xlExponent);

const f2 = (n: number) => n.toFixed(2);
const both = (a: number, b: number) => (Math.abs(a - b) < 1e-9 ? f2(b) : `${f2(a)} → ${f2(b)}`);
const cls = (b: SpeciesBody) => b.className.replace('Extra Large', 'XL');
const wide = (b: SpeciesBody) => (navWide(b.body) ? 'wide' : '');

function line(r: Row) {
  const t = today(r), a = axisOn(r), e = speciesExtent(r.sp, AXIS);
  const xl = (a.sizeClass === 'xl' || t.sizeClass === 'xl') && !a.authored;
  const drawBoth = bodyOf(r.sp, BOTH).visualM;
  return [
    r.lane === 'runtime' ? `**${r.name}**` : r.name, r.shape, e.axis, f2(r.listed), f2(e.m), cls(t), cls(a) === cls(t) ? cls(a) : `**${cls(a)}**`,
    xl ? f2(t.visualM) : '—', xl ? f2(drawBoth) : '—',
    both(t.radius, a.radius), both(t.height, a.height), both(t.body, a.body), wide(t) === wide(a) ? wide(a) : `${wide(t) || 'narrow'} → ${wide(a) || 'narrow'}`,
  ].join(' | ');
}

const head = `| Pokémon | shape | axis | listed m | extent used | class today | class with axis | XL draw today | draw, axis + xl @ ${S.xlExponent} | radius | height | footprint | nav |
|---|---|---|---:|---:|---|---|---:|---:|---:|---:|---:|---|`;

const changed = rows.filter((r) => today(r).sizeClass !== axisOn(r).sizeClass);
const out: string[] = [];
out.push(`lengthRise ${S.lengthRise}, xlExponent ${S.xlExponent} (fixed), cap ${S.xlVisualCap} m, reached at ${f2(capAt)} m of extent. Largest extent with axis on: ${largest.name} (${largest.lane}) ${f2(maxS)} m → draws ${f2(xlVisual(maxS, BOTH))} m.`);
out.push(`Rows: ${rows.length} (${rows.filter((r) => r.lane === 'runtime').length} runtime, ${rows.filter((r) => r.lane === 'catalogue').length} catalogue-only). Class changes with axis on: ${changed.length} (${changed.filter((r) => r.lane === 'runtime').length} runtime).`);
out.push('');
out.push('Class changes with `axis` on:');
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
