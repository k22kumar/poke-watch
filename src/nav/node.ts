// The Node loader for recast-navigation (tsx scripts, tests; src/nav/recast.ts says why). The `./wasm` glue is imported
// dynamically and the .wasm bytes read from node_modules; the glue's own locate-and-fetch path never runs. The page never
// imports this file.
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { initRecast, recastReady, recast, type GlueFactory, type Recast } from './recast';

/** where @recast-navigation/wasm lives (its exports map hides package.json, so resolve the entry and walk up) */
export function recastWasmDir(): string {
  const req = createRequire(import.meta.url);
  let d = path.dirname(req.resolve('@recast-navigation/wasm'));
  while (!fs.existsSync(path.join(d, 'package.json'))) d = path.dirname(d);
  return d;
}

let pending: Promise<Recast> | null = null;

/** init recast-navigation in this process (once; later calls return the same namespace) */
export function initNavNode(): Promise<Recast> {
  if (recastReady()) return Promise.resolve(recast());
  if (!pending) pending = (async () => {
    const dir = recastWasmDir();
    const gluePath = path.join(dir, 'dist', 'recast-navigation.wasm.js');
    const factory = (await import(pathToFileURL(gluePath).href)).default as GlueFactory;
    const bytes = fs.readFileSync(path.join(dir, 'dist', 'recast-navigation.wasm.wasm'));
    const version = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).version as string;
    return initRecast(factory, bytes, fs.readFileSync(gluePath, 'utf8'), version);
  })();
  return pending;
}
