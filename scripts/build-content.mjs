#!/usr/bin/env node
// Builds Poke-Watch's Pokémon content from PokéAPI, PMD SpriteCollab and PokeAPI/cries.
//
//   node scripts/build-content.mjs --clones ../src-data     # from git checkouts (scripts/fetch-sources.sh)
//   node scripts/build-content.mjs                          # straight from the network
//
// Reads content/roster.json (which Pokémon play which role), runs scripts/import-pack.mjs for
// the partners (with their evolutions) and for the wild Pokémon and bosses, then writes:
//   src/content/pokedex.ts  species, moves, type chart and stage tables (imported by the sim)
//   src/content/art.json    sprite atlases, animation frames, portraits, cries, credits
//                           (loaded by the browser at boot)
//   content/report.json     provenance of every source file (URL + SHA-256) and warnings
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const argv = process.argv.slice(2);
const clonesIdx = argv.indexOf('--clones');
const CLONES = clonesIdx >= 0 ? path.resolve(argv[clonesIdx + 1]) : null;
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const roster = JSON.parse(fs.readFileSync(path.join(ROOT, 'content/roster.json'), 'utf8'));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pokewatch-content-'));

fs.writeFileSync(path.join(tmp, 'learnsets.json'), JSON.stringify(roster.learnsets ?? {}));
function runImport(id, names, evolutions) {
  const args = [path.join(ROOT, 'scripts/import-pack.mjs'), ...names, '--out', path.join(tmp, id), '--id', id, '--evolutions', String(evolutions), '--cry-era', roster.cryEra ?? 'latest', '--learnsets', path.join(tmp, 'learnsets.json')];
  if (CLONES) args.push('--clones', CLONES);
  console.log(`importing ${names.length} species (${id})…`);
  const out = execFileSync('node', args, { cwd: ROOT, stdio: ['ignore', 'pipe', 'inherit'] }).toString();
  const warn = out.split('warnings:')[1];
  if (warn) console.log('  warnings:' + warn.trimEnd());
  return {
    pack: JSON.parse(fs.readFileSync(path.join(tmp, id, `${id}.bonkpack.json`), 'utf8')),
    report: JSON.parse(fs.readFileSync(path.join(tmp, id, 'report.json'), 'utf8')),
  };
}

const partners = runImport('partners', roster.partners, roster.partnerEvolutions ?? 1);
const enemyNames = [...Object.keys(roster.wild), ...Object.keys(roster.bosses)];
const enemies = runImport('enemies', enemyNames, 0);

// ------------------------------------------------------------------ species
const species = [];
const art = {};
const idleHeight = (s) => { const a = s.art.anims.Idle ?? s.art.anims.Walk; return Math.max(8, a.frames[0][0][5]); };
for (const s of partners.pack.species) species.push(s);
for (const s of enemies.pack.species) {
  const wild = roster.wild[s.id], boss = roster.bosses[s.id];
  const out = { ...s, playable: undefined, starter: undefined, learnset: undefined, evolvesTo: undefined, evolveLevel: undefined, blurb: undefined, coverage: undefined };
  if (wild) Object.assign(out, { behaviour: wild.behaviour, shot: wild.shot, flying: wild.flying ?? s.flying });
  if (boss) {
    const px = idleHeight(s);
    const scale = Math.max(2, Math.min(3, Math.round(roster.bossPixelHeight / px)));
    Object.assign(out, { behaviour: 'chase', flying: boss.flying ?? s.flying, scale, height: Math.round(((px * scale) / 16) * 100) / 100, boss: { title: boss.title, attacks: boss.attacks, phaseHp: boss.phaseHp, summon: boss.summon } });
  }
  species.push(out);
}
// cries: keep the original OGG (Vorbis) recording and add an MP3 transcode for browsers that
// can't decode Vorbis; measure each recording's mean loudness for the report
const ffmpeg = (() => { try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); return true; } catch { return false; } })();
if (!ffmpeg) console.log('  ffmpeg not found: cries ship as OGG only (no MP3 fallback)');
for (const s of species) {
  if (s.cry?.src && ffmpeg) {
    const ogg = path.join(tmp, `${s.id}.ogg`), mp3 = path.join(tmp, `${s.id}.mp3`);
    fs.writeFileSync(ogg, Buffer.from(s.cry.src.split(',')[1], 'base64'));
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', ogg, '-ac', '1', '-ar', '22050', '-b:a', '40k', mp3]);
    s.cry.alt = 'data:audio/mpeg;base64,' + fs.readFileSync(mp3).toString('base64');
    const vd = execFileSync('ffmpeg', ['-hide_banner', '-i', ogg, '-af', 'volumedetect', '-f', 'null', '-'], { stdio: ['ignore', 'pipe', 'pipe'] }).toString() + '';
    const err = (() => { try { return execFileSync('sh', ['-c', `ffmpeg -hide_banner -i "${ogg}" -af volumedetect -f null - 2>&1`]).toString(); } catch (e) { return String(e.stdout ?? ''); } })();
    const mean = Number((err.match(/mean_volume: (-?[\d.]+)/) ?? [])[1]);
    const dur = Number((execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', ogg]).toString().trim()));
    s.cry.meanDb = Number.isFinite(mean) ? mean : undefined;
    s.cry.seconds = Math.round(dur * 1000) / 1000;
    s.cry.altSource = `MP3 transcode of ${s.cry.source} (ffmpeg libmp3lame, 22.05 kHz mono 40 kb/s)`;
    void vd;
  }
  art[s.id] = { art: s.art, cry: s.cry, provenance: s.provenance };
}
const defs = species.map((s) => {
  const d = {
    id: s.id, name: s.name, dex: s.dex, types: s.types, elements: s.elements, stats: s.stats, height: s.height, art: 'pokemon:' + s.id,
  };
  for (const k of ['flying', 'scale', 'playable', 'blurb', 'starter', 'learnset', 'coverage', 'evolvesTo', 'evolveLevel', 'behaviour', 'shot', 'boss', 'canon']) if (s[k] !== undefined) d[k] = s[k];
  return d;
});

// ------------------------------------------------------------------ moves
const moves = new Map();
for (const m of [...partners.pack.moves, ...enemies.pack.moves]) if (!moves.has(m.key)) moves.set(m.key, m);

// ------------------------------------------------------------------ type chart (official, from PokéAPI)
const TYPE_TO_ELEMENT = {
  normal: 'plain', fire: 'blaze', water: 'tide', grass: 'bloom', electric: 'volt', ice: 'frost', fighting: 'brawl', poison: 'venom', ground: 'quake',
  flying: 'gale', psychic: 'mind', bug: 'hive', rock: 'stone', ghost: 'wisp', dragon: 'wyrm', dark: 'gloom', steel: 'alloy', fairy: 'fae',
};
const chart = {};
for (const [type, el] of Object.entries(TYPE_TO_ELEMENT)) {
  let json;
  if (CLONES) {
    const dir = path.join(CLONES, 'api-data/data/api/v2/type');
    const hit = fs.readdirSync(dir).map((d) => path.join(dir, d, 'index.json')).find((f) => fs.existsSync(f) && JSON.parse(fs.readFileSync(f, 'utf8')).name === type);
    json = JSON.parse(fs.readFileSync(hit, 'utf8'));
  } else {
    json = await (await fetch(`https://pokeapi.co/api/v2/type/${type}`)).json();
  }
  const R = json.damage_relations;
  const conv = (list) => list.map((t) => TYPE_TO_ELEMENT[t.name]).filter(Boolean);
  chart[el] = { name: type[0].toUpperCase() + type.slice(1), strong: conv(R.double_damage_to), weak: conv(R.half_damage_to), immune: conv(R.no_damage_to) };
}

// ------------------------------------------------------------------ write
const header = `// GENERATED by scripts/build-content.mjs from content/roster.json — do not edit by hand.
// Species, stats, types, moves and the type chart come from PokéAPI (pokeapi.co); names, data and
// designs are © Nintendo / Creatures / GAME FREAK / The Pokémon Company. Fan-made, non-commercial.
`;
const ts = `${header}import type { Element } from '../rules/elements';
import type { MoveData } from '../rules/moves';
import type { SpeciesDef } from '../rules/species';

export const POKEDEX_SPECIES: SpeciesDef[] = ${JSON.stringify(defs, null, 1)};

export const POKEDEX_MOVES: (MoveData & { archetype?: string; source?: string })[] = ${JSON.stringify([...moves.values()], null, 1)};

/** Official type effectiveness: attacker -> defenders it hits for x2 / x0.5 / x0 */
export const TYPE_CHART: Record<Element, { name: string; strong: Element[]; weak: Element[]; immune: Element[] }> = ${JSON.stringify(chart, null, 1)};

export const STAGE_TABLES: { biome: string; spawns: [string, number][]; elites: string[]; boss: string }[] = ${JSON.stringify(roster.stages, null, 1)};
`;
fs.mkdirSync(path.join(ROOT, 'src/content'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'src/content/pokedex.ts'), ts);
const bundle = { generated: new Date().toISOString(), notice: partners.pack.notice, licenses: partners.pack.licenses, species: art };
fs.writeFileSync(path.join(ROOT, 'src/content/art.json'), JSON.stringify(bundle));
fs.writeFileSync(path.join(ROOT, 'content/report.json'), JSON.stringify({ generated: bundle.generated, sources: CLONES ? 'git checkouts' : 'network', species: [...partners.report.species, ...enemies.report.species], files: [...partners.report.sources, ...enemies.report.sources] }, null, 1));
// music slots: licensed recordings listed in content/music/manifest.json (none ship by default)
{
  const man = path.join(ROOT, 'content/music/manifest.json');
  const out = {};
  if (fs.existsSync(man)) {
    const M = JSON.parse(fs.readFileSync(man, 'utf8')).slots ?? {};
    for (const [state, sl] of Object.entries(M)) {
      const f = path.join(ROOT, 'content/music', sl.file);
      if (!fs.existsSync(f)) { console.log(`  music slot ${state}: ${sl.file} not found, skipped`); continue; }
      const ext = path.extname(f).slice(1).toLowerCase();
      const mime = ext === 'mp3' ? 'audio/mpeg' : ext === 'wav' ? 'audio/wav' : 'audio/ogg';
      out[state] = { src: `data:${mime};base64,${fs.readFileSync(f).toString('base64')}`, loopStart: sl.loopStart ?? 0, loopEnd: sl.loopEnd ?? 0, gain: sl.gain, title: sl.title, source: sl.source, license: sl.license };
    }
  }
  fs.writeFileSync(path.join(ROOT, 'src/content/music.json'), JSON.stringify(out));
  console.log(`music slots: ${Object.keys(out).length} recording(s) embedded; other states use the original tracks`);
}
// UI icons (PokeAPI/sprites checkout: types + items listed in content/icons.json)
{
  const spec = JSON.parse(fs.readFileSync(path.join(ROOT, 'content/icons.json'), 'utf8'));
  const base = CLONES ? path.join(CLONES, 'sprites/sprites') : null;
  const out = { license: 'PokeAPI/sprites (CC0 repository); all image contents © The Pokémon Company', types: {}, items: {} };
  const read = async (rel) => {
    if (base && fs.existsSync(path.join(base, rel))) return fs.readFileSync(path.join(base, rel));
    if (!CLONES) { const r = await fetch('https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/' + rel); if (r.ok) return Buffer.from(await r.arrayBuffer()); }
    return null;
  };
  for (const [type, id] of Object.entries(spec.types)) { const b = await read(`types/generation-viii/sword-shield/${id}.png`); if (b) out.types[type] = 'data:image/png;base64,' + b.toString('base64'); }
  for (const it of spec.items) { const b = await read(`items/${it}.png`); if (b) out.items[it] = 'data:image/png;base64,' + b.toString('base64'); }
  fs.writeFileSync(path.join(ROOT, 'src/content/icons.json'), JSON.stringify(out));
  console.log(`icons: ${Object.keys(out.types).length} type badges, ${Object.keys(out.items).length} item icons`);
}
// previews for review
fs.mkdirSync(path.join(ROOT, 'content/preview'), { recursive: true });
for (const r of [['partners', partners], ['enemies', enemies]]) for (const f of fs.readdirSync(path.join(tmp, r[0], 'preview'))) fs.copyFileSync(path.join(tmp, r[0], 'preview', f), path.join(ROOT, 'content/preview', r[0] === 'enemies' && f === 'index.html' ? 'index-enemies.html' : f));
const kb = (f) => (fs.statSync(path.join(ROOT, f)).size / 1024).toFixed(0) + ' KB';
console.log(`\n${defs.length} species, ${moves.size} moves -> src/content/pokedex.ts (${kb('src/content/pokedex.ts')}), src/content/art.json (${kb('src/content/art.json')})`);
