#!/usr/bin/env node
// Builds an offline test mirror for scripts/import-pack.mjs (`--mirror tests/fixtures/mirror`).
//
// - pokeapi/: PokéAPI-shaped JSON for Charmander, Squirtle, Totodile and their first
//   evolutions: real base stats, types, HGSS level-up learnsets, evolution levels and move
//   metadata, written in PokéAPI's field layout (verified against live responses).
// - spritecollab/: SpriteCollab-layout folders (AnimData.xml + <Anim>-Anim.png +
//   <Anim>-Shadow.png + portrait Normal.png) using the real frame sizes, durations and
//   Hit/Rush/Return frames from SpriteCollab's AnimData for 0004/0007/0158. The pictures
//   are PLACEHOLDER blobs drawn here, not Pokémon art; they exist to exercise the format.
// - cries/: short generated WAV test tones (Totodile's is deliberately missing).
import fs from 'node:fs';
import path from 'node:path';
import { encodePng } from './lib/png.mjs';

const OUT = process.argv[2] ?? 'tests/fixtures/mirror';
const W = (p, data) => { fs.mkdirSync(path.dirname(path.join(OUT, p)), { recursive: true }); fs.writeFileSync(path.join(OUT, p), data); };
const J = (p, o) => W(p, JSON.stringify(o, null, 1));
const ref = (ep, name) => ({ name, url: `https://pokeapi.co/api/v2/${ep}/${name}/` });

// ------------------------------------------------------------------ species facts
const SPECIES = [
  { id: 4, name: 'charmander', types: ['fire'], h: 6, s: [39, 52, 43, 60, 50, 65], chain: 2, learn: [['scratch', 1], ['growl', 1], ['ember', 7], ['smokescreen', 10], ['dragon-rage', 16], ['scary-face', 19], ['fire-fang', 25], ['slash', 28], ['flamethrower', 34], ['fire-spin', 37]], color: [255, 140, 60] },
  { id: 5, name: 'charmeleon', types: ['fire'], h: 11, s: [58, 64, 58, 80, 65, 80], chain: 2, learn: [['scratch', 1], ['growl', 1], ['ember', 7], ['smokescreen', 10], ['dragon-rage', 17], ['scary-face', 21], ['fire-fang', 28], ['slash', 32], ['flamethrower', 39], ['fire-spin', 43]], color: [230, 90, 60] },
  { id: 7, name: 'squirtle', types: ['water'], h: 5, s: [44, 48, 65, 50, 64, 43], chain: 3, learn: [['tackle', 1], ['tail-whip', 4], ['bubble', 7], ['withdraw', 10], ['water-gun', 13], ['bite', 16], ['rapid-spin', 19], ['protect', 22], ['water-pulse', 25], ['aqua-tail', 28], ['skull-bash', 31], ['iron-defense', 34], ['rain-dance', 37], ['hydro-pump', 40]], color: [110, 190, 240] },
  { id: 8, name: 'wartortle', types: ['water'], h: 10, s: [59, 63, 80, 65, 80, 58], chain: 3, learn: [['tackle', 1], ['tail-whip', 4], ['bubble', 7], ['withdraw', 10], ['water-gun', 13], ['bite', 16], ['rapid-spin', 20], ['protect', 24], ['water-pulse', 28], ['aqua-tail', 32], ['skull-bash', 36], ['iron-defense', 40], ['rain-dance', 44], ['hydro-pump', 48]], color: [90, 140, 230] },
  { id: 158, name: 'totodile', types: ['water'], h: 6, s: [50, 65, 64, 44, 48, 43], chain: 79, learn: [['scratch', 1], ['leer', 1], ['water-gun', 6], ['rage', 8], ['bite', 13], ['scary-face', 15], ['ice-fang', 20], ['flail', 22], ['crunch', 27], ['slash', 29], ['screech', 34], ['thrash', 36], ['aqua-tail', 41], ['superpower', 43], ['hydro-pump', 48]], color: [80, 170, 220] },
  { id: 159, name: 'croconaw', types: ['water'], h: 11, s: [65, 80, 80, 59, 63, 58], chain: 79, learn: [['scratch', 1], ['leer', 1], ['water-gun', 6], ['rage', 8], ['bite', 13], ['scary-face', 15], ['ice-fang', 21], ['flail', 24], ['crunch', 30], ['slash', 33], ['screech', 37], ['thrash', 40], ['aqua-tail', 45]], color: [70, 150, 200] },
];
const CHAINS = { 2: [['charmander', null], ['charmeleon', 16], ['charizard', 36]], 3: [['squirtle', null], ['wartortle', 16], ['blastoise', 36]], 79: [['totodile', null], ['croconaw', 18], ['feraligatr', 30]] };
// [type, class, power, accuracy, priority, ailment, chance, category, target, drain, minHits, maxHits, english]
const MOVES = {
  scratch: ['normal', 'physical', 40, 100, 0, 'none', 0, 'damage', 'selected-pokemon', 0, null, null, 'Scratch'],
  growl: ['normal', 'status', null, 100, 0, 'none', 0, 'net-good-stats', 'all-opponents', 0, null, null, 'Growl'],
  ember: ['fire', 'special', 40, 100, 0, 'burn', 10, 'damage+ailment', 'selected-pokemon', 0, null, null, 'Ember'],
  smokescreen: ['normal', 'status', null, 100, 0, 'none', 0, 'net-good-stats', 'selected-pokemon', 0, null, null, 'Smokescreen'],
  'dragon-rage': ['dragon', 'special', null, 100, 0, 'none', 0, 'damage', 'selected-pokemon', 0, null, null, 'Dragon Rage'],
  'scary-face': ['normal', 'status', null, 100, 0, 'none', 0, 'net-good-stats', 'selected-pokemon', 0, null, null, 'Scary Face'],
  'fire-fang': ['fire', 'physical', 65, 95, 0, 'burn', 10, 'damage+ailment', 'selected-pokemon', 0, null, null, 'Fire Fang'],
  slash: ['normal', 'physical', 70, 100, 0, 'none', 0, 'damage', 'selected-pokemon', 0, null, null, 'Slash'],
  flamethrower: ['fire', 'special', 90, 100, 0, 'burn', 10, 'damage+ailment', 'selected-pokemon', 0, null, null, 'Flamethrower'],
  'fire-spin': ['fire', 'special', 35, 85, 0, 'trap', 100, 'damage+ailment', 'selected-pokemon', 0, null, null, 'Fire Spin'],
  tackle: ['normal', 'physical', 40, 100, 0, 'none', 0, 'damage', 'selected-pokemon', 0, null, null, 'Tackle'],
  'tail-whip': ['normal', 'status', null, 100, 0, 'none', 0, 'net-good-stats', 'all-opponents', 0, null, null, 'Tail Whip'],
  bubble: ['water', 'special', 40, 100, 0, 'none', 0, 'damage+lower', 'all-opponents', 0, null, null, 'Bubble'],
  withdraw: ['water', 'status', null, null, 0, 'none', 0, 'net-good-stats', 'user', 0, null, null, 'Withdraw'],
  'water-gun': ['water', 'special', 40, 100, 0, 'none', 0, 'damage', 'selected-pokemon', 0, null, null, 'Water Gun'],
  bite: ['dark', 'physical', 60, 100, 0, 'none', 0, 'damage', 'selected-pokemon', 0, null, null, 'Bite'],
  'rapid-spin': ['normal', 'physical', 50, 100, 0, 'none', 0, 'damage+raise', 'selected-pokemon', 0, null, null, 'Rapid Spin'],
  protect: ['normal', 'status', null, null, 4, 'none', 0, 'unique', 'user', 0, null, null, 'Protect'],
  'water-pulse': ['water', 'special', 60, 100, 0, 'confusion', 20, 'damage+ailment', 'selected-pokemon', 0, null, null, 'Water Pulse'],
  'aqua-tail': ['water', 'physical', 90, 90, 0, 'none', 0, 'damage', 'selected-pokemon', 0, null, null, 'Aqua Tail'],
  'skull-bash': ['normal', 'physical', 130, 100, 0, 'none', 0, 'damage+raise', 'selected-pokemon', 0, null, null, 'Skull Bash'],
  'iron-defense': ['steel', 'status', null, null, 0, 'none', 0, 'net-good-stats', 'user', 0, null, null, 'Iron Defense'],
  'rain-dance': ['water', 'status', null, null, 0, 'none', 0, 'field-effect', 'entire-field', 0, null, null, 'Rain Dance'],
  'hydro-pump': ['water', 'special', 110, 80, 0, 'none', 0, 'damage', 'selected-pokemon', 0, null, null, 'Hydro Pump'],
  leer: ['normal', 'status', null, 100, 0, 'none', 0, 'net-good-stats', 'all-opponents', 0, null, null, 'Leer'],
  rage: ['normal', 'physical', 20, 100, 0, 'none', 0, 'damage', 'selected-pokemon', 0, null, null, 'Rage'],
  'ice-fang': ['ice', 'physical', 65, 95, 0, 'freeze', 10, 'damage+ailment', 'selected-pokemon', 0, null, null, 'Ice Fang'],
  flail: ['normal', 'physical', null, 100, 0, 'none', 0, 'damage', 'selected-pokemon', 0, null, null, 'Flail'],
  crunch: ['dark', 'physical', 80, 100, 0, 'none', 0, 'damage', 'selected-pokemon', 0, null, null, 'Crunch'],
  screech: ['normal', 'status', null, 85, 0, 'none', 0, 'net-good-stats', 'selected-pokemon', 0, null, null, 'Screech'],
  thrash: ['normal', 'physical', 120, 100, 0, 'none', 0, 'damage', 'random-opponent', 0, null, null, 'Thrash'],
  superpower: ['fighting', 'physical', 120, 100, 0, 'none', 0, 'damage', 'selected-pokemon', 0, null, null, 'Superpower'],
};
// SpriteCollab AnimData measured for 0004 / 0007 / 0158 (evolutions reuse their base's table)
const ANIMS = {
  4: { Walk: [32, 32, [6, 8, 6, 8]], Attack: [64, 64, [2, 2, 4, 2, 2, 2, 2, 2, 2, 2, 2], 6], Strike: [56, 56, [2, 6, 2, 4, 2, 2, 2, 2, 2], 3], Shoot: 'Charge', Sleep: [32, 24, [30, 35]], Hurt: [48, 56, [2, 8]], Idle: [32, 40, [12, 8, 8, 8]], Charge: [32, 40, [2, 2, 2, 2, 2, 2, 2, 2, 2, 2], 5], Faint: [32, 32, [8, 12, 4, 10]] },
  7: { Walk: [32, 32, [12, 8, 12, 8]], Idle: [32, 32, [30, 2, 2, 4, 4, 4, 2, 2]], Attack: [64, 72, [2, 4, 1, 1, 1, 2, 2, 2, 2, 2], 3], Strike: 'Attack', Shoot: [40, 32, [2, 6, 2, 2, 2, 2, 2, 2, 2, 2, 2], 4], Charge: [32, 32, [2, 2, 2, 2, 2, 2, 2, 2, 2, 2], 5], Hurt: [40, 56, [2, 8]], Sleep: [24, 24, [30, 35]], Faint: [40, 32, [8, 12, 4, 10]] },
  158: { Walk: [24, 32, [8, 10, 8, 10]], Idle: [32, 48, [30, 4, 2, 6, 3, 2, 3]], Attack: [64, 80, [2, 4, 1, 1, 1, 2, 2, 2, 2, 2], 3], Shoot: [40, 48, [2, 3, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2], 4], Charge: [24, 32, [2, 2, 2, 2, 2, 2, 2, 2, 2, 2], 5], Hurt: [48, 56, [2, 8]], Faint: [40, 32, [8, 12, 4, 10]], Sleep: [24, 32, [30, 35]], Strike: [64, 72, [2, 6, 2, 2, 2, 2, 2, 2, 4], 3] },
};
ANIMS[5] = ANIMS[4]; ANIMS[8] = ANIMS[7]; ANIMS[159] = ANIMS[158];

// ------------------------------------------------------------------ PokéAPI JSON
const statNames = ['hp', 'attack', 'defense', 'special-attack', 'special-defense', 'speed'];
for (const sp of SPECIES) {
  const pokemon = {
    id: sp.id, name: sp.name, height: sp.h, weight: sp.h * 15, base_experience: 60,
    cries: { latest: `https://raw.githubusercontent.com/PokeAPI/cries/main/cries/pokemon/latest/${sp.id}.ogg`, legacy: null },
    species: ref('pokemon-species', String(sp.id)),
    stats: sp.s.map((v, i) => ({ base_stat: v, effort: 0, stat: ref('stat', statNames[i]) })),
    types: sp.types.map((t, i) => ({ slot: i + 1, type: ref('type', t) })),
    moves: sp.learn.map(([m, lvl]) => ({ move: ref('move', m), version_group_details: [{ level_learned_at: lvl, move_learn_method: ref('move-learn-method', 'level-up'), version_group: ref('version-group', 'heartgold-soulsilver'), order: null }] })),
  };
  J(`pokeapi/pokemon/${sp.name}.json`, pokemon);
  J(`pokeapi/pokemon/${sp.id}.json`, pokemon);
  J(`pokeapi/pokemon-species/${sp.id}.json`, {
    id: sp.id, name: sp.name, evolution_chain: { url: `https://pokeapi.co/api/v2/evolution-chain/${sp.chain}/` },
    names: [{ name: sp.name[0].toUpperCase() + sp.name.slice(1), language: ref('language', 'en') }],
  });
}
for (const [id, stages] of Object.entries(CHAINS)) {
  const node = (k) => k >= stages.length ? null : { is_baby: false, species: ref('pokemon-species', stages[k][0]), evolution_details: stages[k][1] ? [{ min_level: stages[k][1], trigger: ref('evolution-trigger', 'level-up') }] : [], evolves_to: node(k + 1) ? [node(k + 1)] : [] };
  J(`pokeapi/evolution-chain/${id}.json`, { id: Number(id), chain: node(0) });
}
for (const [name, [type, cls, power, acc, pri, ail, chance, cat, target, drain, minH, maxH, en]] of Object.entries(MOVES)) {
  J(`pokeapi/move/${name}.json`, {
    name, power, accuracy: acc, priority: pri, pp: 20, type: ref('type', type), damage_class: ref('move-damage-class', cls), target: ref('move-target', target),
    meta: { ailment: ref('move-ailment', ail), ailment_chance: chance, category: ref('move-category', cat), crit_rate: 0, drain, flinch_chance: 0, healing: 0, min_hits: minH, max_hits: maxH, min_turns: null, max_turns: null, stat_chance: 0 },
    names: [{ name: en, language: ref('language', 'en') }],
  });
}

// ------------------------------------------------------------------ placeholder sprite sheets (PMD layout)
const DIR_VEC = [[0, 1], [1, 1], [1, 0], [1, -1], [0, -1], [-1, -1], [-1, 0], [-1, 1]]; // PMD row order
function blobFrame(img, W, x0, y0, fw, fh, dir, i, n, anim, color, scale) {
  const cx = x0 + fw / 2, feet = y0 + Math.min(fh - 4, Math.round(fh * 0.5 + 10 * scale));
  const [dx, dy] = DIR_VEC[dir];
  const t = n > 1 ? i / (n - 1) : 0;
  let lean = 0, squash = 0, flash = false;
  if (anim === 'Walk') squash = (i % 2) * 1;
  if (anim === 'Idle') squash = i % 2;
  if (anim === 'Attack' || anim === 'Strike') lean = Math.round(Math.sin(t * Math.PI) * 6);
  if (anim === 'Hurt') { flash = i === 0; lean = -2; }
  if (anim === 'Faint') squash = Math.round(t * 6);
  if (anim === 'Sleep') squash = 3;
  const rx = 7 * scale, ry = (8 - squash * 0.6) * scale;
  const bx = cx + dx * lean, by = feet - ry - 1 + (anim === 'Charge' ? (i % 2) : 0);
  const put = (x, y, c) => { x = Math.round(x); y = Math.round(y); if (x < x0 || y < y0 || x >= x0 + fw || y >= y0 + fh) return; img.set(c, (y * W + x) * 4); };
  for (let y = -ry - 1; y <= ry + 1; y++) for (let x = -rx - 1; x <= rx + 1; x++) {
    const d = (x * x) / (rx * rx) + (y * y) / (ry * ry);
    if (d <= 1) { const shade = y < -ry * 0.3 && x < 0 ? 1.15 : y > ry * 0.4 ? 0.8 : 1; put(bx + x, by + y, flash ? [255, 255, 255, 255] : [Math.min(255, color[0] * shade), Math.min(255, color[1] * shade), Math.min(255, color[2] * shade), 255]); }
    else if (d <= 1.35) put(bx + x, by + y, [40, 32, 48, 255]);
  }
  // eyes show facing (hidden when facing away)
  if (dy >= 0 || dx !== 0) for (const s of dx === 0 ? [-1, 1] : [Math.sign(dx)]) put(bx + s * 3 * scale + dx * 2, by - 2 * scale, anim === 'Sleep' || anim === 'Faint' ? [40, 32, 48, 255] : [20, 20, 30, 255]);
  // feet
  put(bx - 3, feet - 1, [60, 48, 40, 255]); put(bx + 3, feet - 1 - ((i + dir) % 2), [60, 48, 40, 255]);
  return [Math.round(bx - x0), feet - y0];
}

function sheet(spec, color, name, scale) {
  const [fw, fh, durs] = spec;
  const n = durs.length, Wd = fw * n, Hd = fh * 8;
  const img = new Uint8Array(Wd * Hd * 4), sh = new Uint8Array(Wd * Hd * 4);
  for (let d = 0; d < 8; d++) for (let i = 0; i < n; i++) {
    const [ax, ay] = blobFrame(img, Wd, i * fw, d * fh, fw, fh, d, i, n, name, color, scale);
    sh.set([255, 255, 255, 255], ((d * fh + ay) * Wd + i * fw + ax) * 4);
  }
  return [encodePng(Wd, Hd, img), encodePng(Wd, Hd, sh)];
}

for (const sp of SPECIES) {
  const d4 = String(sp.id).padStart(4, '0');
  const table = ANIMS[sp.id];
  const scale = sp.h >= 10 ? 1.25 : 1;
  let xml = `<?xml version="1.0" ?>\n<AnimData>\n\t<ShadowSize>${scale > 1 ? 2 : 1}</ShadowSize>\n\t<Anims>\n`;
  let idx = 0;
  for (const [name, spec] of Object.entries(table)) {
    if (typeof spec === 'string') { xml += `\t\t<Anim>\n\t\t\t<Name>${name}</Name>\n\t\t\t<CopyOf>${spec}</CopyOf>\n\t\t</Anim>\n`; continue; }
    const [fw, fh, durs, hit] = spec;
    xml += `\t\t<Anim>\n\t\t\t<Name>${name}</Name>\n\t\t\t<Index>${idx++}</Index>\n\t\t\t<FrameWidth>${fw}</FrameWidth>\n\t\t\t<FrameHeight>${fh}</FrameHeight>\n` + (hit !== undefined ? `\t\t\t<HitFrame>${hit}</HitFrame>\n` : '') + `\t\t\t<Durations>\n${durs.map((d) => `\t\t\t\t<Duration>${d}</Duration>`).join('\n')}\n\t\t\t</Durations>\n\t\t</Anim>\n`;
    const [a, s] = sheet(spec, sp.color, name, scale);
    W(`spritecollab/sprite/${d4}/${name}-Anim.png`, a);
    if (!(sp.id === 7 && name === 'Hurt')) W(`spritecollab/sprite/${d4}/${name}-Shadow.png`, s); // one missing shadow sheet on purpose
  }
  xml += '\t</Anims>\n</AnimData>\n';
  W(`spritecollab/sprite/${d4}/AnimData.xml`, xml);
  W(`spritecollab/sprite/${d4}/credits.txt`, `2026-10-20\tFixture Artist\tplaceholder fixture, not real SpriteCollab art\n`);
  // 40x40 portrait placeholder
  const p = new Uint8Array(40 * 40 * 4);
  for (let y = 0; y < 40; y++) for (let x = 0; x < 40; x++) {
    const d = ((x - 20) ** 2) / 196 + ((y - 24) ** 2) / 225;
    p.set(d < 1 ? [...sp.color, 255] : [250, 240, 220, 255], (y * 40 + x) * 4);
    if ((x === 15 || x === 25) && y === 20) p.set([20, 20, 30, 255], (y * 40 + x) * 4);
  }
  W(`spritecollab/portrait/${d4}/Normal.png`, encodePng(40, 40, p));
  // cry: WAV test tone (Totodile's left out to exercise the fallback)
  if (sp.id !== 158) W(`cries/latest/${sp.id}.ogg`, wav(sp.id));
}

function wav(seed) {
  const rate = 22050, n = Math.round(rate * 0.35), data = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i++) {
    const t = i / rate, f = 500 + (seed % 7) * 60 + Math.sin(t * 40) * 80 - t * 600;
    data.writeInt16LE(Math.round(Math.sin(2 * Math.PI * f * t) * Math.min(1, t * 40, (0.35 - t) * 20) * 9000), i * 2);
  }
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVE', 8); h.write('fmt ', 12);
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write('data', 36); h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}
console.log(`fixture mirror written to ${OUT}`);
