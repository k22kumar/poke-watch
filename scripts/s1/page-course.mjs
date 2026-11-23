// S1 spike §4: bundle page-course-entry.ts with the rapier plugin into <out>, open it headless, print its lines
import * as esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { rapierWasm } from '../lib/rapierwasm.mjs';
const out = path.resolve(process.argv[2]);
fs.mkdirSync(out, { recursive: true });
const r = await esbuild.build({ entryPoints: ['scripts/s1/page-course-entry.ts'], bundle: true, format: 'iife', target: 'es2022', write: false, define: { __ART__: '{"manifest":{},"heroes":[]}' }, plugins: [rapierWasm(out)], outdir: out, logLevel: 'error' });
fs.writeFileSync(path.join(out, 'index.html'), `<!doctype html><meta charset="utf-8"><script>${r.outputFiles[0].text.replace(/<\/script/g, '<\\/script')}</script>`);
const browser = await chromium.launch({ args: ['--allow-file-access-from-files'] });
const page = await browser.newPage();
await page.goto('file://' + path.join(out, 'index.html'));
const s = await page.waitForFunction(() => window.s1, null, { timeout: 300000 }).then((h) => h.jsonValue());
console.log(`S1 course in the page: ${await browser.version()} (${process.platform}-${process.arch})`);
console.log(s);
await browser.close();
