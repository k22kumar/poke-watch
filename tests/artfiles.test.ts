// Pokémon art outside the HTML (docs/ROADMAP.md "Item 3: A1 plan"): scripts/lib/artfiles.mjs writes dist/art/ from
// src/content/art.json, and the page only fetches it. The page's own size budget is checked by scripts/build.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import ART from '../src/content/art.json';
import { PROTOTYPE } from '../src/rules/heroes';
import { decodePng } from '../scripts/lib/png.mjs';
import { writeArt } from '../scripts/lib/artfiles.mjs';

type Bundle = { species: Record<string, { art: { atlas: string; portrait?: string; anims: Record<string, unknown>; shadowSize?: number; credits?: string[] }; cry?: { src: string } }> };
const bundle = ART as unknown as Bundle;
const bytes = (u: string) => Buffer.from(u.slice(u.indexOf(',') + 1), 'base64');

test('nothing the page bundles imports the art bundle', () => {
  const walk = (d: string): string[] => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
  const bad = walk('src').filter((f) => /\.tsx?$/.test(f) && !f.startsWith(path.join('src', 'content'))).filter((f) => /from\s+['"][^'"]*content\/art\.json['"]/.test(fs.readFileSync(f, 'utf8')));
  assert.deepEqual(bad, []);
});

test('dist/art: every species\' files, the hero sheet and the manifest', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-art-'));
  try {
    const out = path.join(dir, 'art');
    const names = await writeArt(out);
    const read = (rel: string) => fs.readFileSync(path.join(dir, rel));
    const m = JSON.parse(read(names.manifest).toString());
    assert.equal(names.heroes, `art/${m.heroes.file}`);
    assert.deepEqual(Object.keys(m.species).sort(), Object.keys(bundle.species).sort());
    for (const [id, e] of Object.entries(bundle.species)) {
      const r = m.species[id];
      // the same bytes as the bundle carried, under content-hashed names
      assert.ok(bytes(e.art.atlas).equals(read(`art/${r.atlas}`)), `${id} atlas`);
      assert.deepEqual(JSON.parse(read(`art/${r.frames}`).toString()), { anims: e.art.anims, shadowSize: e.art.shadowSize }, `${id} frames`);
      if (e.art.portrait) assert.ok(bytes(e.art.portrait).equals(read(`art/${r.portrait}`)), `${id} portrait`);
      if (e.cry?.src) assert.ok(bytes(e.cry.src).equals(read(`art/${r.cry.src}`)), `${id} cry`);
      assert.deepEqual(r.art.credits, e.art.credits ?? [], `${id} credits`);
      assert.ok(r.clips.idle && r.clips.walk, `${id} clip report`);
    }
    // the hero sheet: every PROTOTYPE portrait, pixel for pixel
    const sheet = decodePng(read(names.heroes));
    for (const id of PROTOTYPE) {
      const cell = m.heroes.cells[id];
      assert.ok(cell, `${id} has a cell on the hero sheet`);
      const p = decodePng(bytes(bundle.species[id].art.portrait!));
      const [x0, y0, w, h] = cell;
      assert.deepEqual([w, h], [p.width, p.height], id);
      for (let y = 0; y < h; y++) assert.ok(Buffer.from(sheet.data.subarray(((y0 + y) * sheet.width + x0) * 4, ((y0 + y) * sheet.width + x0 + w) * 4)).equals(Buffer.from(p.data.subarray(y * w * 4, (y + 1) * w * 4))), `${id} row ${y}`);
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
