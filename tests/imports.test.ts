// Layering rules (CLAUDE.md "Architecture rules", README §Architecture, docs/OVERHAUL_3D.md "Target layout"): every
// import of every file under src/ is parsed (TypeScript's preProcessFile: static imports, `export … from`, `import x =
// require()`, dynamic `import()` and `import('…')` types; comments and strings are skipped) and checked against the
// layer rules below. A failure names the file, the line and the import.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const ROOT = path.resolve(import.meta.dirname, '..');
const SRC = path.join(ROOT, 'src');
const CODE = /\.(ts|tsx|mts|cts|js|mjs|cjs)$/;

/** the top-level folder under src/ a repo-relative path belongs to ('' for a file directly in src/, null outside src/) */
function layerOf(rel: string): string | null {
  const parts = rel.split('/');
  if (parts[0] !== 'src') return null;
  return parts.length > 2 ? parts[1] : '';
}

/** the npm package a bare specifier names ('@scope/name' or 'name') */
function packageOf(spec: string): string {
  const parts = spec.split('/');
  return spec.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
}

const UI_LAYERS = ['render', 'ui', 'audio', 'input', 'assets'];
/** layers each layer must not import */
const FORBIDDEN_LAYERS: Record<string, string[]> = {
  world: ['sim', ...UI_LAYERS],
  sim: UI_LAYERS,
};
/** layers that must not import three */
const NO_THREE = ['sim', 'world', 'physics', 'nav', 'core'];

interface Imported { line: number; spec: string }

function importsOf(text: string): Imported[] {
  const info = ts.preProcessFile(text, true, true);
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) starts.push(i + 1);
  const lineOf = (pos: number) => { let lo = 0, hi = starts.length - 1; while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (starts[mid] <= pos) lo = mid; else hi = mid - 1; } return lo + 1; };
  return info.importedFiles.map(f => ({ line: lineOf(f.pos), spec: f.fileName }));
}

/** the rule violations of one file (repo-relative path, posix separators) */
function violations(rel: string, text: string): string[] {
  const from = layerOf(rel);
  if (from === null) return [];
  const out: string[] = [];
  for (const { line, spec } of importsOf(text)) {
    const at = `${rel}:${line} imports '${spec}'`;
    if (spec.startsWith('.')) {
      const target = path.posix.normalize(path.posix.join(path.posix.dirname(rel), spec));
      const to = layerOf(target);
      if (to !== null && to !== from && FORBIDDEN_LAYERS[from]?.includes(to)) out.push(`${at} (${target}): src/${from} must not import src/${to}`);
      continue;
    }
    const pkg = packageOf(spec);
    if (pkg.startsWith('@dimforge/') && from !== 'physics') out.push(`${at}: only src/physics imports @dimforge/*`);
    if ((pkg === 'recast-navigation' || pkg.startsWith('@recast-navigation/')) && from !== 'nav') out.push(`${at}: only src/nav imports recast-navigation`);
    if (pkg === 'three' && NO_THREE.includes(from)) out.push(`${at}: src/${from} must not import three`);
  }
  return out;
}

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...sourceFiles(p));
    else if (CODE.test(e.name) && !e.name.endsWith('.d.ts')) out.push(p);
  }
  return out;
}

test('imports: every file under src/ keeps the layer rules', () => {
  const files = sourceFiles(SRC);
  assert.ok(files.length > 100, `found ${files.length} source files under src/`);
  let parsed = 0;
  const bad: string[] = [];
  for (const f of files) {
    const rel = path.relative(ROOT, f).split(path.sep).join('/');
    bad.push(...violations(rel, fs.readFileSync(f, 'utf8')));
    parsed++;
  }
  assert.equal(parsed, files.length);
  assert.deepEqual(bad, [], `layering violations:\n  ${bad.join('\n  ')}`);
});

test('imports: the checker catches each rule and names the file and import', () => {
  const cases: [string, string, string[]][] = [
    ['src/world/habitat/x.ts', "import { a } from '../../sim/spatial';", ["src/world/habitat/x.ts:1 imports '../../sim/spatial' (src/sim/spatial): src/world must not import src/sim"]],
    ['src/world/x.ts', "\n\nexport { b } from '../render/y';", ["src/world/x.ts:3 imports '../render/y' (src/render/y): src/world must not import src/render"]],
    ['src/world/x.ts', "type M = import('../sim/types').SimContext;", ["src/world/x.ts:1 imports '../sim/types' (src/sim/types): src/world must not import src/sim"]],
    ['src/sim/x.ts', "import type { U } from '../ui/hud';", ["src/sim/x.ts:1 imports '../ui/hud' (src/ui/hud): src/sim must not import src/ui"]],
    ['src/sim/x.ts', "const m = await import('../audio/mix');", ["src/sim/x.ts:1 imports '../audio/mix' (src/audio/mix): src/sim must not import src/audio"]],
    ['src/sim/x.ts', "import '../input/keys';", ["src/sim/x.ts:1 imports '../input/keys' (src/input/keys): src/sim must not import src/input"]],
    ['src/sim/x.ts', "import { A } from '../assets/art';", ["src/sim/x.ts:1 imports '../assets/art' (src/assets/art): src/sim must not import src/assets"]],
    ['src/render/x.ts', "import RAPIER from '@dimforge/rapier3d-compat';", ["src/render/x.ts:1 imports '@dimforge/rapier3d-compat': only src/physics imports @dimforge/*"]],
    ['src/sim/x.ts', "import { init } from 'recast-navigation';", ["src/sim/x.ts:1 imports 'recast-navigation': only src/nav imports recast-navigation"]],
    ['src/world/x.ts', "import { g } from '@recast-navigation/generators';", ["src/world/x.ts:1 imports '@recast-navigation/generators': only src/nav imports recast-navigation"]],
    ['src/core/x.ts', "import * as THREE from 'three';", ["src/core/x.ts:1 imports 'three': src/core must not import three"]],
    ['src/physics/x.ts', "import { Vector3 } from 'three/src/math/Vector3.js';", ["src/physics/x.ts:1 imports 'three/src/math/Vector3.js': src/physics must not import three"]],
    // allowed
    ['src/physics/x.ts', "import RAPIER from '@dimforge/rapier3d-compat';", []],
    ['src/nav/x.ts', "import { init } from 'recast-navigation'; import { g } from '@recast-navigation/generators';", []],
    ['src/render/x.ts', "import * as THREE from 'three'; import { W } from '../sim/world'; import { T } from '../world/tiles';", []],
    ['src/sim/x.ts', "import { T } from '../world/tiles'; import { R } from '../rules/defaults'; // from '../render/stage'", []],
    ['src/world/x.ts', "const s = \"import { a } from '../sim/world'\"; /* import '../ui/hud'; */", []],
    ['scripts/x.ts', "import { W } from '../src/sim/world'; import * as THREE from 'three';", []],
  ];
  for (const [rel, text, want] of cases) assert.deepEqual(violations(rel, text), want, `${rel}: ${text}`);
});
