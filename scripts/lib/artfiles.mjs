// The game's Pokémon art as side files (docs/ROADMAP.md "Item 3: A1 plan"): scripts/build.mjs and scripts/dev.mjs
// write dist/art/ from src/content/art.json, and the page fetches what it needs (src/assets/loader.ts). Every name is
// content-hashed, so a file can be cached for good.
//   <id>.<hash>.png    the atlas
//   <id>.<hash>.json   its frame table: { anims, shadowSize }
//   <id>-p.<hash>.png  the portrait
//   <id>.<hash>.ogg    the cry (and .mp3 when the bundle carries a transcode)
//   heroes.<hash>.png  one sheet of every PROTOTYPE portrait (the hero pick, fetched at boot)
//   manifest.<hash>.json  per species: file names, credits, licences, cry facts and the clip report the Credits table
//                      shows; the sheet's cells
import * as esbuild from 'esbuild';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { decodePng, encodePng } from './png.mjs';

/** the game's own tables the files are cut by: the hero pick and the clip resolver (bundled from src/, so the build
 *  and the browser resolve clips with the same code) */
async function gameTables() {
  const out = await esbuild.build({
    stdin: { contents: "export { PROTOTYPE } from './src/rules/heroes'; export { resolveClips } from './src/assets/clips'; export { ANIM_STATES, NATIVE_CLIP } from './src/assets/art';", resolveDir: process.cwd(), loader: 'ts' },
    bundle: true, format: 'esm', platform: 'node', write: false, logLevel: 'error',
  });
  return import('data:text/javascript;base64,' + Buffer.from(out.outputFiles[0].text).toString('base64'));
}

const hash = (buf) => crypto.createHash('sha256').update(buf).digest('hex').slice(0, 10);
const fromDataUrl = (u) => Buffer.from(u.slice(u.indexOf(',') + 1), 'base64');
const extOf = (u) => (/^data:audio\/(mpeg|mp3)/.test(u) ? 'mp3' : /^data:audio\/ogg/.test(u) ? 'ogg' : /^data:image\/png/.test(u) ? 'png' : 'bin');

/** Write dist/art/ (replacing what was there). Returns the two names the page is built with, relative to the page. */
export async function writeArt(outDir, bundlePath = 'src/content/art.json') {
  const bundle = JSON.parse(fs.readFileSync(bundlePath, 'utf8'));
  const { PROTOTYPE, resolveClips, ANIM_STATES, NATIVE_CLIP } = await gameTables();
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });
  let bytes = 0;
  const put = (stem, ext, buf) => { const name = `${stem}.${hash(buf)}.${ext}`; fs.writeFileSync(path.join(outDir, name), buf); bytes += buf.length; return name; };
  const species = {};
  const portraits = {};
  for (const [id, e] of Object.entries(bundle.species)) {
    const a = e.art;
    // the clip report and its notes, as src/assets/pack.ts buildArt makes them
    const src = {};
    for (const [name, an] of Object.entries(a.anims)) src[name] = { frames: an.frames.map((row) => row.map(([x, y, w, h, ax, ay]) => ({ x, y, w, h, ax, ay }))), durations: an.durations.map((d) => d / 60), hit: an.hit };
    const { report } = resolveClips(src);
    const notes = [];
    for (const st of ANIM_STATES) if (report[st] !== undefined && report[st] !== NATIVE_CLIP[st]) notes.push(`${st}: substitute ${report[st]}`);
    if (!a.portrait) notes.push('no portrait; using the idle frame');
    if (!e.cry?.src) notes.push('no cry recording; silent');
    const rec = {
      atlas: put(id, 'png', fromDataUrl(a.atlas)),
      frames: put(id, 'json', Buffer.from(JSON.stringify({ anims: a.anims, shadowSize: a.shadowSize }))),
      art: { source: a.source, license: a.license, credits: a.credits ?? [], url: a.url },
      clips: report, notes,
    };
    if (a.portrait) { const buf = fromDataUrl(a.portrait); rec.portrait = put(`${id}-p`, 'png', buf); portraits[id] = buf; }
    if (e.cry?.src) {
      const { src: s, alt, ...facts } = e.cry;
      rec.cry = { ...facts, src: put(id, extOf(s), fromDataUrl(s)) };
      if (alt) rec.cry.alt = put(id, extOf(alt), fromDataUrl(alt));
    }
    if (e.provenance) rec.provenance = e.provenance;
    species[id] = rec;
  }
  // the hero sheet: every PROTOTYPE portrait on one grid, row-major in PROTOTYPE order
  const heroes = PROTOTYPE.filter((id) => portraits[id]);
  const imgs = heroes.map((id) => decodePng(portraits[id]));
  const cw = Math.max(...imgs.map((i) => i.width)), ch = Math.max(...imgs.map((i) => i.height));
  const cols = 8, rows = Math.ceil(heroes.length / cols), W = cols * cw, H = rows * ch;
  const px = new Uint8Array(W * H * 4);
  const cells = {};
  heroes.forEach((id, k) => {
    const im = imgs[k], x0 = (k % cols) * cw, y0 = Math.floor(k / cols) * ch;
    for (let y = 0; y < im.height; y++) px.set(im.data.subarray(y * im.width * 4, (y + 1) * im.width * 4), ((y0 + y) * W + x0) * 4);
    cells[id] = [x0, y0, im.width, im.height];
  });
  const sheet = put('heroes', 'png', encodePng(W, H, px));
  const manifest = { generated: bundle.generated, notice: bundle.notice, licenses: bundle.licenses ?? [], heroes: { file: sheet, cells }, species };
  const mf = put('manifest', 'json', Buffer.from(JSON.stringify(manifest)));
  const rel = path.basename(outDir);
  return { manifest: `${rel}/${mf}`, heroes: `${rel}/${sheet}`, files: fs.readdirSync(outDir).length, bytes };
}
