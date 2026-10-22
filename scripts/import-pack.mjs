#!/usr/bin/env node
// Creature pack importer: PokéAPI (species data, moves, evolutions) + PMD SpriteCollab
// (animated 8-direction sprites, portraits) + PokeAPI/cries (OGG cries) -> one
// `<pack>.bonkpack.json` that Poke-Watch loads from disk. No dependencies; Node 18+.
//
//   node scripts/import-pack.mjs charmander squirtle totodile --out packs/starters
//
// Options
//   --out DIR              output folder (default packs/<id>)
//   --id ID / --name NAME  pack id and display name (default "starters"/"Starter pack")
//   --evolutions N         also import N evolution stages after each species (default 1)
//   --version-group VG     learnset source (default heartgold-soulsilver; falls back automatically)
//   --no-cries             skip cries (the game synthesises a call instead)
//   --mirror DIR           read every source from a local mirror instead of the network:
//                            DIR/pokeapi/<endpoint>/<key>.json
//                            DIR/spritecollab/sprite/<dex4>/..., DIR/spritecollab/portrait/<dex4>/...
//                            DIR/cries/latest/<id>.ogg
//   --clones DIR           read from git checkouts of api-data, SpriteCollab and cries (DIR/api-data, …)
//   --offline              only use the download cache (.import-cache)
//
// Everything fetched is cached in .import-cache/, so re-running is reproducible and quick.
// The output keeps provenance (source URL + SHA-256 per file), licences and attribution.
// Pokémon names, designs, sprites and cries belong to Nintendo, Creatures, GAME FREAK and
// The Pokémon Company; SpriteCollab art is CC BY-NC 4.0. Packs are for personal,
// non-commercial use and are not meant to be redistributed.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { decodePng, encodePng } from './lib/png.mjs';

// ----------------------------------------------------------------------------- options
const argv = process.argv.slice(2);
const VALUED = new Set(['out', 'id', 'name', 'evolutions', 'version-group', 'mirror', 'clones', 'cry-era', 'learnsets']);
const opts = {}, names = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a.startsWith('--')) { const k = a.slice(2); if (VALUED.has(k)) opts[k] = argv[++i]; else opts[k] = true; }
  else names.push(a);
}
const opt = (k, d) => (typeof opts[k] === 'string' ? opts[k] : d);
const flag = (k) => opts[k] === true;
if (!names.length) { console.error('usage: node scripts/import-pack.mjs <species...> [--out DIR] [--mirror DIR]'); process.exit(2); }
const PACK_ID = opt('id', 'starters');
const PACK_NAME = opt('name', 'Starter pack');
const OUT = opt('out', path.join('packs', PACK_ID));
const EVOS = Number(opt('evolutions', '1'));
const VG = opt('version-group', 'heartgold-soulsilver');
const MIRROR = opt('mirror', null);
// --clones DIR: git checkouts of PokeAPI/api-data, PMDCollab/SpriteCollab and PokeAPI/cries
// (DIR/api-data, DIR/spritecollab, DIR/cries), e.g. sparse clones made by scripts/fetch-sources.sh
const CLONES = opt('clones', null);
const OFFLINE = flag('offline');
const CRIES = !flag('no-cries');
// 'legacy' = the Gen 1-5 recordings heard in the DS games (HGSS era); 'latest' = the modern re-recordings
const CRY_ERA = opt('cry-era', 'legacy');
// curated learnsets: JSON { <baseSpecies>: { starter, moves: [[gameLevel, moveKey], ...] } }
const LEARNSETS = opt('learnsets', null) ? JSON.parse(fs.readFileSync(opt('learnsets', null), 'utf8')) : {};
const CACHE = '.import-cache';

const POKEAPI = 'https://pokeapi.co/api/v2/';
const SPRITES = 'https://raw.githubusercontent.com/PMDCollab/SpriteCollab/master/';
const CRY_URL = 'https://raw.githubusercontent.com/PokeAPI/cries/main/cries/pokemon/';

// ----------------------------------------------------------------------------- canonical -> game mappings
export const TYPE_TO_ELEMENT = {
  normal: 'plain', fire: 'blaze', water: 'tide', grass: 'bloom', electric: 'volt', ice: 'frost', fighting: 'brawl', poison: 'venom', ground: 'quake',
  flying: 'gale', psychic: 'mind', bug: 'hive', rock: 'stone', ghost: 'wisp', dragon: 'wyrm', dark: 'gloom', steel: 'alloy', fairy: 'fae',
};
const AILMENT = { burn: 'burn', poison: 'poison', paralysis: 'stun', sleep: 'sleep', freeze: 'chill', confusion: 'confuse', trap: 'root', infatuation: 'confuse', yawn: 'sleep' };
const WEATHER = new Set(['rain-dance', 'sunny-day', 'sandstorm', 'hail', 'snowscape']);
const STAT = { hp: 'hp', attack: 'atk', defense: 'def', 'special-attack': 'spa', 'special-defense': 'spd', speed: 'spe' };
const BASE_SLOTS = [3, 6, 9, 13, 18, 24, 28];
const EVO_SLOTS = [20, 26, 32];
// PMD animations the game can use (the rest are skipped to keep packs small)
const WANT_ANIMS = ['Idle', 'Walk', 'Attack', 'Strike', 'Shoot', 'Charge', 'Hurt', 'Faint', 'Sleep'];

// ----------------------------------------------------------------------------- fetching with cache + provenance
const provenance = [];
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');

// name -> id for PokéAPI resources fetched by name from the api-data checkout
let nameIndex = null;
function clonePath(url) {
  if (url.startsWith(POKEAPI)) {
    const [ep, key] = url.slice(POKEAPI.length).replace(/\/$/, '').split('/');
    let id = key;
    if (!/^\d+$/.test(key)) {
      if (!nameIndex) {
        nameIndex = {};
        for (const e of ['pokemon', 'pokemon-species']) {
          const dir = path.join(CLONES, 'api-data/data/api/v2', e);
          if (!fs.existsSync(dir)) continue;
          for (const d of fs.readdirSync(dir)) { const f = path.join(dir, d, 'index.json'); if (fs.existsSync(f)) nameIndex[`${e}/${JSON.parse(fs.readFileSync(f, 'utf8')).name}`] = d; }
        }
      }
      id = nameIndex[`${ep}/${key}`];
      if (!id) return null;
    }
    return path.join(CLONES, 'api-data/data/api/v2', ep, id, 'index.json');
  }
  if (url.startsWith(SPRITES)) return path.join(CLONES, 'spritecollab', url.slice(SPRITES.length));
  if (url.startsWith(CRY_URL)) return path.join(CLONES, 'cries/cries/pokemon', url.slice(CRY_URL.length));
  return null;
}

function mirrorPath(url) {
  if (url.startsWith(POKEAPI)) { const rest = url.slice(POKEAPI.length).replace(/\/$/, ''); const [ep, key] = rest.split('/'); return path.join(MIRROR, 'pokeapi', ep, key + '.json'); }
  if (url.startsWith(SPRITES)) return path.join(MIRROR, 'spritecollab', url.slice(SPRITES.length));
  if (url.startsWith(CRY_URL)) return path.join(MIRROR, 'cries', url.slice(CRY_URL.length));
  return null;
}

async function get(url, { optional = false } = {}) {
  if (url.startsWith('/api/v2/')) url = 'https://pokeapi.co' + url; // api-data uses site-relative links
  const cacheFile = path.join(CACHE, crypto.createHash('sha1').update(url).digest('hex'));
  let buf = null, from = 'network';
  if (CLONES) {
    const p = clonePath(url);
    if (p && fs.existsSync(p)) { buf = fs.readFileSync(p); from = 'git checkout'; }
  } else if (MIRROR) {
    const p = mirrorPath(url);
    if (p && fs.existsSync(p)) { buf = fs.readFileSync(p); from = 'mirror'; }
  } else if (fs.existsSync(cacheFile)) { buf = fs.readFileSync(cacheFile); from = 'cache'; }
  else if (!OFFLINE) {
    for (let attempt = 0; attempt < 3 && !buf; attempt++) {
      try {
        const res = await fetch(url, { headers: { 'user-agent': 'poke-watch-import-pack/1.0 (personal, non-commercial)' } });
        if (res.status === 404) break;
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        buf = Buffer.from(await res.arrayBuffer());
        fs.mkdirSync(CACHE, { recursive: true });
        fs.writeFileSync(cacheFile, buf);
      } catch (e) {
        if (attempt === 2) { if (optional) break; throw new Error(`could not fetch ${url}: ${e.message}`); }
        await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
      }
    }
  }
  if (!buf) { if (optional) return null; throw new Error(`missing source: ${url}${MIRROR || CLONES ? ' (not in local sources)' : ''}`); }
  provenance.push({ url, from, bytes: buf.length, sha256: sha(buf) });
  return buf;
}
const getJson = async (url) => JSON.parse((await get(url)).toString('utf8'));
const pokeapiUrl = (u) => (u.startsWith('/api/v2/') ? 'https://pokeapi.co' + u : u);

// ----------------------------------------------------------------------------- PokéAPI -> normalised species
const moveCache = new Map();
async function move(name, url) {
  if (!moveCache.has(name)) moveCache.set(name, await getJson(url ?? `${POKEAPI}move/${name}`));
  return moveCache.get(name);
}

function englishName(obj, fallback) {
  return obj?.names?.find((n) => n.language?.name === 'en')?.name ?? fallback.replace(/(^|-)([a-z])/g, (_, a, b) => (a ? ' ' : '') + b.toUpperCase());
}

/** level-up moves for a version group, falling back to the group with the most level-up data */
function levelUpMoves(pokemon) {
  const by = new Map();
  for (const m of pokemon.moves) for (const d of m.version_group_details) {
    if (d.move_learn_method.name !== 'level-up') continue;
    const vg = d.version_group.name;
    if (!by.has(vg)) by.set(vg, []);
    by.get(vg).push({ name: m.move.name, url: m.move.url, level: d.level_learned_at });
  }
  let vg = VG;
  if (!by.has(vg)) vg = [...by.entries()].sort((a, b) => b[1].length - a[1].length)[0]?.[0];
  const list = (by.get(vg) ?? []).sort((a, b) => a.level - b.level || a.name.localeCompare(b.name));
  return { vg, list };
}

/** PokéAPI move -> Poke-Watch MoveData row (+ archetype hint from metadata), or null if unusable */
function toMoveRow(m) {
  const element = TYPE_TO_ELEMENT[m.type.name];
  const cls = m.damage_class.name;
  const key = m.name.replace(/-/g, '_');
  const name = englishName(m, m.name);
  const meta = m.meta ?? {};
  if (cls === 'status') {
    if (WEATHER.has(m.name)) return { key, name, element, cls, power: 0, statusKind: 'weather', source: `pokeapi move/${m.name}` };
    if (meta.category?.name === 'net-good-stats' && m.target?.name === 'user') return { key, name, element, cls, power: 0, statusKind: 'buff', source: `pokeapi move/${m.name}` };
    return null;
  }
  if (meta.category?.name === 'ohko') return null;
  const row = { key, name, element, cls, power: m.power ?? 0, priority: m.priority || undefined, accuracy: m.accuracy ?? null, source: `pokeapi move/${m.name}` };
  const ail = AILMENT[meta.ailment?.name];
  if (ail && meta.ailment_chance) { row.ailment = ail; row.ailmentChance = meta.ailment_chance; }
  if (meta.drain > 0) row.drain = meta.drain / 100;
  if (meta.min_hits > 1) row.hits = Math.round((meta.min_hits + meta.max_hits) / 2);
  // archetype hints from canonical targeting, so behaviour doesn't depend on name regexes alone
  if (['all-other-pokemon', 'all-opponents'].includes(m.target?.name) && row.power > 0) row.archetype = 'nova';
  else if ((m.priority ?? 0) > 0 && cls === 'physical') row.archetype = 'dash';
  return row;
}

async function evolutionInfo(speciesJson, pokemonName) {
  const chain = (await getJson(pokeapiUrl(speciesJson.evolution_chain.url))).chain;
  const find = (node) => (node.species.name === speciesJson.name ? node : node.evolves_to.map(find).find(Boolean));
  const node = find(chain);
  const next = node?.evolves_to?.[0];
  if (!next) return null;
  const det = next.evolution_details?.[0];
  return { to: next.species.name, level: det?.trigger?.name === 'level-up' && det.min_level ? det.min_level : null, trigger: det?.trigger?.name ?? 'unknown', from: pokemonName };
}

// ----------------------------------------------------------------------------- SpriteCollab -> packed atlas
function parseAnimData(xml) {
  const tag = (s, t) => (s.match(new RegExp(`<${t}>([^<]*)</${t}>`)) ?? [])[1];
  const anims = {};
  for (const block of xml.match(/<Anim>[\s\S]*?<\/Anim>/g) ?? []) {
    const name = tag(block, 'Name');
    const copy = tag(block, 'CopyOf');
    if (copy) { anims[name] = { copyOf: copy }; continue; }
    anims[name] = {
      fw: Number(tag(block, 'FrameWidth')), fh: Number(tag(block, 'FrameHeight')),
      durations: (block.match(/<Duration>(\d+)<\/Duration>/g) ?? []).map((d) => Number(d.replace(/\D/g, ''))),
      hit: tag(block, 'HitFrame') !== undefined ? Number(tag(block, 'HitFrame')) : undefined,
    };
  }
  for (const [n, a] of Object.entries(anims)) if (a.copyOf) anims[n] = { ...anims[a.copyOf], copiedFrom: a.copyOf };
  return { shadowSize: Number(tag(xml, 'ShadowSize') ?? 1), anims };
}

function cropFrame(img, x0, y0, fw, fh) {
  let minX = fw, minY = fh, maxX = -1, maxY = -1;
  for (let y = 0; y < fh; y++) for (let x = 0; x < fw; x++) if (img.data[((y0 + y) * img.width + x0 + x) * 4 + 3] > 0) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
  if (maxX < 0) return { empty: true, minX: fw >> 1, minY: fh >> 1, w: 1, h: 1 };
  return { empty: false, minX, minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

/** feet anchor of a frame from the PMD shadow sheet (centroid of its marker pixels) */
function shadowAnchor(shadow, x0, y0, fw, fh) {
  if (!shadow) return null;
  let sx = 0, sy = 0, n = 0;
  for (let y = 0; y < fh; y++) for (let x = 0; x < fw; x++) if (shadow.data[((y0 + y) * shadow.width + x0 + x) * 4 + 3] > 0) { sx += x; sy += y; n++; }
  return n ? [Math.round(sx / n), Math.round(sy / n)] : null;
}

// SpriteCollab credits.txt lists contributors by Discord id; credit_names.txt maps ids to the
// names (and links) the artists chose. Ids without a name are kept, labelled.
let creditNameMap = null;
async function creditNames() {
  if (creditNameMap) return creditNameMap;
  creditNameMap = {};
  const buf = await get(`${SPRITES}credit_names.txt`, { optional: true });
  if (buf) for (const line of buf.toString('utf8').split(/\r?\n/).slice(1)) {
    const [name, id] = line.split('\t');
    if (id && name?.trim()) creditNameMap[id.trim()] = name.trim();
  }
  return creditNameMap;
}

async function importSprites(dex) {
  const d4 = String(dex).padStart(4, '0');
  const base = `${SPRITES}sprite/${d4}/`;
  const xmlBuf = await get(base + 'AnimData.xml');
  const ad = parseAnimData(xmlBuf.toString('utf8'));
  const frames = []; // { anim, dir, i, img, sx, sy, w, h, ax, ay }
  const anims = {};
  const warnings = [];
  for (const name of WANT_ANIMS) {
    const a = ad.anims[name];
    if (!a || !a.fw) continue;
    const file = (a.copiedFrom ?? name);
    const sheetBuf = await get(`${base}${file}-Anim.png`, { optional: true });
    if (!sheetBuf) { warnings.push(`${name}: ${file}-Anim.png missing`); continue; }
    const sheet = decodePng(sheetBuf);
    const shadowBuf = await get(`${base}${file}-Shadow.png`, { optional: true });
    const shadow = shadowBuf ? decodePng(shadowBuf) : null;
    const cols = Math.floor(sheet.width / a.fw), rows = Math.floor(sheet.height / a.fh);
    if (cols !== a.durations.length) warnings.push(`${name}: sheet has ${cols} columns but AnimData lists ${a.durations.length} durations; using ${Math.min(cols, a.durations.length)}`);
    const n = Math.min(cols, a.durations.length);
    if (rows !== 8 && rows !== 1) { warnings.push(`${name}: ${rows} direction rows (expected 8 or 1); skipped`); continue; }
    const out = [];
    for (let d = 0; d < 8; d++) {
      const row = rows === 8 ? d : 0;
      const list = [];
      for (let i = 0; i < n; i++) {
        const x0 = i * a.fw, y0 = row * a.fh;
        const c = cropFrame(sheet, x0, y0, a.fw, a.fh);
        const anchor = shadowAnchor(shadow, x0, y0, a.fw, a.fh) ?? [a.fw >> 1, Math.min(a.fh - 1, c.minY + c.h)];
        const f = { anim: name, img: sheet, sx: x0 + c.minX, sy: y0 + c.minY, w: c.w, h: c.h, ax: anchor[0] - c.minX, ay: anchor[1] - c.minY };
        frames.push(f);
        list.push(f);
      }
      out.push(list);
    }
    anims[name] = { frames: out, durations: a.durations.slice(0, n), hit: a.hit, fw: a.fw, fh: a.fh, rows, copiedFrom: a.copiedFrom };
    if (!shadow) warnings.push(`${name}: no shadow sheet; feet anchored at the lowest opaque row`);
  }
  if (!anims.Walk) throw new Error(`sprite ${d4}: no usable Walk animation`);
  // pack: dedupe identical frames, shelf-pack by height
  const key = (f) => sha(Buffer.concat(Array.from({ length: f.h }, (_, y) => Buffer.from(f.img.data.buffer, f.img.data.byteOffset + ((f.sy + y) * f.img.width + f.sx) * 4, f.w * 4))));
  const uniq = new Map();
  for (const f of frames) { const k = key(f); if (!uniq.has(k)) uniq.set(k, f); f.dup = uniq.get(k); }
  const list = [...uniq.values()].sort((a, b) => b.h - a.h || b.w - a.w);
  const MAXW = 1024;
  let x = 1, y = 1, rowH = 0, W = 0;
  for (const f of list) {
    if (x + f.w + 1 > MAXW) { x = 1; y += rowH + 1; rowH = 0; }
    f.px = x; f.py = y; x += f.w + 1; rowH = Math.max(rowH, f.h); W = Math.max(W, x);
  }
  const H = y + rowH + 1;
  const atlas = new Uint8Array(W * H * 4);
  for (const f of list) for (let yy = 0; yy < f.h; yy++) atlas.set(f.img.data.subarray(((f.sy + yy) * f.img.width + f.sx) * 4, ((f.sy + yy) * f.img.width + f.sx + f.w) * 4), ((f.py + yy) * W + f.px) * 4);
  const atlasPng = encodePng(W, H, atlas);
  const packAnims = {};
  for (const [name, a] of Object.entries(anims)) packAnims[name] = { frames: a.frames.map((row) => row.map((f) => [f.dup.px, f.dup.py, f.w, f.h, f.ax, f.ay])), durations: a.durations, ...(a.hit !== undefined ? { hit: a.hit } : {}) };
  // visible height of the front idle (or walk) frame, for gameplay size
  const front = (anims.Idle ?? anims.Walk).frames[0][0];
  const heightPx = Math.max(8, front.ay);
  const portraitBuf = await get(`${SPRITES}portrait/${d4}/Normal.png`, { optional: true });
  if (!portraitBuf) warnings.push('no Normal portrait; the game will use the idle frame');
  const creditsBuf = await get(`${base}credits.txt`, { optional: true });
  const names = await creditNames();
  const credits = creditsBuf ? [...new Set(creditsBuf.toString('utf8').split(/\r?\n/).map((l) => l.split('\t')[1] ?? l).map((s) => s.trim()).filter(Boolean).map((c) => names[c] ?? (/^<@!\d+>$/.test(c) ? 'unnamed SpriteCollab contributor ' + c.replace(/\D/g, '') : c)))] : [];
  if (!credits.length) warnings.push(`no credits.txt for sprite ${d4}; credit the artists listed for ${d4} in SpriteCollab's tracker.json`);
  return {
    d4, atlasPng, W, H, anims: packAnims, shadowSize: ad.shadowSize, heightPx, portraitPng: portraitBuf, credits, warnings,
    available: Object.keys(ad.anims), used: Object.keys(anims), frames: frames.length, uniqueFrames: list.length,
  };
}

// ----------------------------------------------------------------------------- main
const dataUrl = (mime, buf) => `data:${mime};base64,${buf.toString('base64')}`;

async function importOne(nameOrId, role, report) {
  const pokemon = await getJson(`${POKEAPI}pokemon/${String(nameOrId).toLowerCase()}`);
  const species = await getJson(pokemon.species.url);
  const id = pokemon.name.replace(/[^a-z0-9]+/g, '-');
  const display = englishName(species, pokemon.name);
  const types = pokemon.types.sort((a, b) => a.slot - b.slot).map((t) => t.type.name);
  const stats = {};
  for (const s of pokemon.stats) stats[STAT[s.stat.name]] = s.base_stat;
  const dex = species.id;
  const sprites = await importSprites(dex);
  const evo = await evolutionInfo(species, pokemon.name);
  const { vg, list } = levelUpMoves(pokemon);
  const rows = [];
  for (const { name, url, level } of list) {
    const row = toMoveRow(await move(name, url));
    if (row) rows.push({ row, level });
  }
  let cry = null;
  if (CRIES) {
    // preferred era first; if that recording doesn't exist, fall back to the other and record which
    const eras = CRY_ERA === 'legacy' ? ['legacy', 'latest'] : ['latest', 'legacy'];
    let url = null, buf = null, era = null;
    for (const e of eras) {
      const u = pokemon.cries?.[e] ?? `${CRY_URL}${e}/${pokemon.id}.ogg`;
      const b = await get(u, { optional: true });
      if (b) { url = u; buf = b; era = e; break; }
    }
    const magic = buf?.subarray(0, 4).toString('latin1');
    if (magic === 'OggS' || magic === 'RIFF') cry = { src: dataUrl(magic === 'OggS' ? 'audio/ogg' : 'audio/wav', buf), source: url, era, license: MIRROR && !CLONES ? 'fixture (generated test tone)' : 'PokeAPI/cries (CC0 repository); audio © The Pokémon Company' };
    else sprites.warnings.push('cry missing or not an OGG/WAV file; the game will synthesise a call');
  }
  report.push({ id, dex, role, versionGroup: vg, levelUpMoves: list.length, usableMoves: rows.length, sprite: { folder: `sprite/${sprites.d4}`, available: sprites.available, used: sprites.used, frames: sprites.frames, uniqueFrames: sprites.uniqueFrames, atlas: `${sprites.W}x${sprites.H}`, heightPx: sprites.heightPx }, warnings: sprites.warnings });
  // canonical facts, kept apart from the game's balancing: HGSS-era abilities (no hidden abilities,
  // which arrived in Gen 5), the HGSS level-up list with real levels, size, evolution level
  const abilities = (pokemon.abilities ?? []).filter((a) => !a.is_hidden).sort((a, b) => a.slot - b.slot).map((a) => a.ability.name.replace(/-/g, '_'));
  const canon = { versionGroup: vg, levelUp: rows.map((r) => [r.level, r.row.key]), abilities, heightM: pokemon.height / 10, weightKg: pokemon.weight / 10, evolveLevel: evo?.level ?? undefined, evolveTrigger: evo?.trigger };
  return {
    id, dex, display, types, stats, sprites, evo, rows, cry, canon,
    flying: types.includes('flying'),
    heightM: Math.round((Math.max(0.9, Math.min(3.2, sprites.heightPx / 16 * 1.05))) * 100) / 100,
  };
}

function buildSpecies(e, { playable, learnset, starter, evolvesTo, evolveLevel, coverage }) {
  const elements = [...new Set(e.types.map((t) => TYPE_TO_ELEMENT[t]).filter(Boolean))];
  const typeLabel = e.types.map((t) => t[0].toUpperCase() + t.slice(1)).join('/');
  return {
    id: e.id, name: e.display, dex: e.dex, types: e.types, elements, stats: e.stats, height: e.heightM, flying: e.flying || undefined,
    playable: playable || undefined,
    blurb: `${typeLabel} type.${evolvesTo ? ` Evolves at Lv ${evolveLevel}.` : ''} Imported from PokéAPI and PMD SpriteCollab.`,
    starter, learnset, evolvesTo, evolveLevel, coverage, canon: e.canon,
    art: {
      source: `PMD SpriteCollab sprite/${e.sprites.d4}`,
      atlas: dataUrl('image/png', e.sprites.atlasPng), anims: e.sprites.anims, shadowSize: e.sprites.shadowSize,
      portrait: e.sprites.portraitPng ? dataUrl('image/png', e.sprites.portraitPng) : undefined,
      credits: e.sprites.credits.length ? e.sprites.credits : ['PMD SpriteCollab contributors (see tracker.json)'],
      license: 'CC BY-NC 4.0', url: `https://sprites.pmdcollab.org/#/${e.sprites.d4}`,
    },
    cry: e.cry ?? undefined,
    provenance: { data: `PokéAPI v2 pokemon/${e.id}, pokemon-species/${e.dex}`, dataLicense: 'PokéAPI data; Pokémon names and stats © Nintendo / Creatures / GAME FREAK / The Pokémon Company', fetched: new Date().toISOString(), sha256: { atlas: sha(e.sprites.atlasPng) } },
  };
}

async function main() {
  const report = [];
  const species = [];
  const moves = new Map();
  for (const n of names) {
    console.log(`importing ${n}…`);
    const base = await importOne(n, 'starter', report);
    // evolution chain (N stages)
    const chain = [base];
    let cur = base;
    for (let k = 0; k < EVOS && cur.evo; k++) {
      const next = await importOne(cur.evo.to, 'evolution', report);
      chain.push(next); cur = next;
    }
    for (const e of chain) for (const r of e.rows) moves.set(r.row.key, r.row);
    const curated = LEARNSETS[base.id];
    if (curated) {
      // curated learnset (content/roster.json): every move must be one the line canonically learns
      // by level-up in HGSS; each is attached to the earliest form that learns it, at its game level
      const stageOf = (key) => chain.findIndex((e) => e.rows.some((r) => r.row.key === key));
      for (const key of [curated.starter, ...curated.moves.map((m) => m[1])]) if (stageOf(key) < 0) throw new Error(`${base.id}: curated move ${key} is not in the line's ${base.canon.versionGroup} level-up moves (or is unsupported)`);
      const per = chain.map(() => []);
      for (const [lv, key] of curated.moves) per[stageOf(key)].push([lv, key]);
      const chosen = new Set([curated.starter, ...curated.moves.map((m) => m[1])]);
      // coverage: the line's remaining canonical damaging moves, each on the form that first learns
      // it and at its canonical level (offered rarely; never a random dex move)
      const covSeen = new Set(chosen);
      const coverage = chain.map((e) => e.rows.filter((r) => r.row.cls !== 'status' && r.row.power > 0 && !covSeen.has(r.row.key) && (covSeen.add(r.row.key), true)).map((r) => [Math.max(1, r.level), r.row.key]));
      chain.forEach((e, k) => species.push(buildSpecies(e, {
        playable: k === 0, starter: k === 0 ? curated.starter : undefined, learnset: per[k].sort((a, b) => a[0] - b[0]),
        evolvesTo: chain[k + 1]?.id, evolveLevel: chain[k + 1] ? e.evo?.level ?? (k === 0 ? 16 : 32) : undefined,
        coverage: coverage[k].length ? coverage[k] : undefined,
      })));
      continue;
    }
    // learnsets: starter + base moves mapped onto the game's pacing; evolutions add later moves
    const damaging = base.rows.filter((r) => r.row.cls !== 'status');
    // starter: an early same-type attack if there is one (Ember over Scratch), else the first attack
    const primary = TYPE_TO_ELEMENT[base.types[0]];
    const starterRow = damaging.find((r) => r.row.power > 0 && r.row.element === primary && r.level <= 10) ?? damaging.find((r) => r.row.power > 0) ?? damaging[0];
    if (!starterRow) throw new Error(`${base.id}: no damaging level-up move to start with`);
    const seen = new Set([starterRow.row.key]);
    const baseMoves = [];
    for (const r of base.rows) { if (seen.has(r.row.key) || baseMoves.length >= BASE_SLOTS.length - 1) continue; if (r.row.cls === 'status' && baseMoves.some((m) => m.cls === 'status')) continue; seen.add(r.row.key); baseMoves.push(r.row); }
    species.push(buildSpecies(base, {
      playable: true, starter: starterRow.row.key,
      learnset: baseMoves.map((m, i) => [BASE_SLOTS[i], m.key]),
      evolvesTo: chain[1]?.id, evolveLevel: chain[1] ? base.evo.level ?? 16 : undefined,
    }));
    for (let k = 1; k < chain.length; k++) {
      const e = chain[k];
      const extra = e.rows.filter((r) => !seen.has(r.row.key) && r.row.cls !== 'status' && r.level >= (chain[k - 1].evo?.level ?? 16)).slice(0, EVO_SLOTS.length);
      extra.forEach((r) => seen.add(r.row.key));
      species.push(buildSpecies(e, { playable: false, learnset: extra.map((r, i) => [EVO_SLOTS[i], r.row.key]), evolvesTo: chain[k + 1]?.id, evolveLevel: chain[k + 1] ? e.evo?.level ?? 32 : undefined }));
    }
  }
  // keep only moves some species actually uses
  const used = new Set(species.flatMap((s) => [s.starter, ...(s.learnset ?? []).map((l) => l[1]), ...(s.coverage ?? []).map((c) => c[1])].filter(Boolean)));
  const pack = {
    format: 'poke-watch-pack', version: 1, id: PACK_ID, name: PACK_NAME,
    generator: 'scripts/import-pack.mjs 1.0', created: new Date().toISOString(),
    notice: 'Personal, non-commercial use only. Do not redistribute. Pokémon names, designs, sprites and cries are owned by Nintendo, Creatures, GAME FREAK and The Pokémon Company. Sprites and portraits: PMD SpriteCollab contributors, CC BY-NC 4.0.',
    licenses: [
      { scope: 'sprites, portraits', name: 'CC BY-NC 4.0', url: 'https://creativecommons.org/licenses/by-nc/4.0/', holder: 'PMD SpriteCollab contributors', note: 'Attribution required; non-commercial only. Underlying character designs © Nintendo/Creatures/GAME FREAK/TPC.' },
      { scope: 'species and move data', name: 'PokéAPI', url: 'https://pokeapi.co/docs/v2', holder: 'PokéAPI', note: 'Game data © Nintendo/Creatures/GAME FREAK/TPC.' },
      { scope: 'cries', name: 'CC0 repository; audio © The Pokémon Company', url: 'https://github.com/PokeAPI/cries', holder: 'The Pokémon Company', note: 'Repository is CC0, but its LICENSE states the audio is copyright The Pokémon Company.' },
    ],
    species,
    moves: [...moves.values()].filter((m) => used.has(m.key)),
  };
  fs.mkdirSync(path.join(OUT, 'preview'), { recursive: true });
  const file = path.join(OUT, `${PACK_ID}.bonkpack.json`);
  fs.writeFileSync(file, JSON.stringify(pack));
  // previews: every used animation, 8 directions, anchors marked
  const previews = [];
  for (const s of species) previews.push(writePreview(s, OUT));
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify({ pack: PACK_ID, generated: pack.created, mirror: MIRROR ?? null, species: report, sources: provenance }, null, 2));
  fs.writeFileSync(path.join(OUT, 'preview', 'index.html'), `<!doctype html><meta charset="utf-8"><title>${PACK_NAME} preview</title><style>body{font:13px sans-serif;background:#202430;color:#eee;margin:16px}img{image-rendering:pixelated;background:#78dcac;display:block;margin:6px 0 18px}</style><h1>${PACK_NAME}</h1><p>${pack.notice}</p>` + previews.map((p) => `<h2>${p.name}</h2><p>${p.note}</p><img src="${p.file}" width="${p.w * 2}">`).join(''));
  const warn = report.flatMap((r) => r.warnings.map((w) => `${r.id}: ${w}`));
  console.log(`\nwrote ${file} (${(fs.statSync(file).size / 1024).toFixed(0)} KB): ${species.length} species, ${pack.moves.length} moves`);
  console.log(`preview: ${path.join(OUT, 'preview', 'index.html')}  report: ${path.join(OUT, 'report.json')}`);
  if (warn.length) console.log('\nwarnings:\n  ' + warn.join('\n  '));
}

function writePreview(s, out) {
  const names = Object.keys(s.art.anims);
  const atlas = decodePng(Buffer.from(s.art.atlas.split(',')[1], 'base64'));
  let W = 0, H = 0;
  const cells = [];
  for (const n of names) {
    const a = s.art.anims[n];
    const cw = Math.max(...a.frames.flat().map((f) => f[4] + Math.max(...a.frames.flat().map((g) => g[2] - g[4])))) + 4;
    const chTop = Math.max(...a.frames.flat().map((f) => f[5])), chBot = Math.max(...a.frames.flat().map((f) => f[3] - f[5]));
    const ch = chTop + chBot + 4;
    const rowW = a.frames[0].length * cw;
    cells.push({ n, a, cw, ch, chTop, y: H });
    W = Math.max(W, rowW); H += ch * 8 + 6;
  }
  const img = new Uint8Array(W * H * 4);
  for (const { a, cw, ch, chTop, y } of cells)
    for (let d = 0; d < 8; d++) for (let i = 0; i < a.frames[d].length; i++) {
      const [fx, fy, fw, fh, ax, ay] = a.frames[d][i];
      const ox = i * cw + 2 + (cw - 4) / 2 - ax | 0, oy = y + d * ch + 2 + chTop - ay;
      for (let yy = 0; yy < fh; yy++) for (let xx = 0; xx < fw; xx++) {
        const si = ((fy + yy) * atlas.width + fx + xx) * 4;
        if (!atlas.data[si + 3]) continue;
        const di = ((oy + yy) * W + ox + xx) * 4;
        img.set(atlas.data.subarray(si, si + 4), di);
      }
      // anchor marker: one red pixel at the feet
      const mx = ox + ax, my = oy + ay;
      if (mx >= 0 && my >= 0 && mx < W && my < H) img.set([255, 40, 40, 255], (my * W + mx) * 4);
    }
  const file = `${s.id}.png`;
  fs.writeFileSync(path.join(out, 'preview', file), encodePng(W, H, img));
  return { name: s.name, file, w: W, note: `Animations: ${names.join(', ')} · 8 directions each (rows: down, down-right, right, up-right, up, up-left, left, down-left). Red pixel = feet anchor.` };
}

main().catch((e) => { console.error('\nimport failed: ' + e.message); process.exit(1); });
