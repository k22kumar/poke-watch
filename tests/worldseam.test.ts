// The world seam (docs/OVERHAUL_3D.md "World seam", task WS): sim systems reach the world only through
// worldOf(ctx) (src/sim/worldquery.ts), I1a's swap point, and ask it WorldQuery's questions; tile-only state goes
// through W.tiles. Two rules over every file under src/sim/, parsed with the TypeScript AST (comments and strings never
// count). A failure names the file and the line.
//   1. No import that names the World class from src/sim/world, however the path is spelled (resolved, so '../world'
//      from src/sim/modes/ counts): a named or renamed binding, `export { World } from`, an `import('…').World` type, and
//      a namespace import or dynamic import() of the module (both reach World). Constants (HEAD_EPS, DECK_REACH) stay
//      importable. Allowed: world.ts (it defines World), spatial.ts (the tile implementation of the actor queries'
//      world half: geoOf, and the raycastWorld(W, …) exports tests and scripts call), run.ts (it constructs the World)
//      and types.ts (SimContext.world stays typed World, so tests, scripts and render keep compiling).
//   2. No `.world` access except where the receiver is `rng` or `rules` (ctx.rng.world, ctx.rules.world): no
//      `ctx.world`, `ctx['world']` or `const { world } = ctx`. Allowed: world.ts, spatial.ts, worldquery.ts (the
//      accessor itself), and exactly one `ctx.world = …` assignment in run.ts (enterMap builds the World).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const ROOT = path.resolve(import.meta.dirname, '..');
const SIM = path.join(ROOT, 'src', 'sim');
const WORLD_MODULE = 'src/sim/world';
const RULE1_ALLOWED = new Set(['src/sim/world.ts', 'src/sim/spatial.ts', 'src/sim/run.ts', 'src/sim/types.ts']);
const RULE2_ALLOWED = new Set(['src/sim/world.ts', 'src/sim/spatial.ts', 'src/sim/worldquery.ts']);
/** the one file allowed one `ctx.world = …` assignment */
const BUILDER = 'src/sim/run.ts';
/** receivers whose `.world` is not the World (ctx.rng.world, ctx.rules.world, rules.world) */
const OTHER_WORLD = /(^|\.)(rng|rules)$/;

/** does an import specifier written in `rel` resolve to src/sim/world? */
function isWorldModule(rel: string, spec: string): boolean {
  if (!spec.startsWith('.')) return false;
  const target = path.posix.normalize(path.posix.join(path.posix.dirname(rel), spec)).replace(/\.(ts|js)$/, '');
  return target === WORLD_MODULE;
}

/** the rule violations of one file (repo-relative path, posix separators) */
function violations(rel: string, text: string): string[] {
  if (!rel.startsWith('src/sim/')) return [];
  const sf = ts.createSourceFile(rel, text, ts.ScriptTarget.Latest, true);
  const lineOf = (n: ts.Node) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
  const out: string[] = [];
  const r1 = !RULE1_ALLOWED.has(rel), r2 = !RULE2_ALLOWED.has(rel);
  const world1 = (n: ts.Node, spec: string, how: string) => out.push(`${rel}:${lineOf(n)} imports World from '${spec}' (${how}): sim code takes WorldQuery (src/sim/worldquery.ts)`);
  const world2 = (n: ts.Node, how: string) => out.push(`${rel}:${lineOf(n)} reads the world as ${how}: use worldOf(ctx) (src/sim/worldquery.ts)`);
  let assigns = 0;
  const named = (b: ts.NamedImportBindings | ts.NamedExportBindings | undefined): boolean => {
    if (!b) return false;
    if (ts.isNamespaceImport(b) || ts.isNamespaceExport(b)) return true;
    return b.elements.some((e) => (e.propertyName ?? e.name).text === 'World');
  };
  const visit = (n: ts.Node) => {
    if (r1) {
      if (ts.isImportDeclaration(n) && ts.isStringLiteral(n.moduleSpecifier) && isWorldModule(rel, n.moduleSpecifier.text)) {
        const c = n.importClause;
        if (c && (c.name?.text === 'World' || named(c.namedBindings))) world1(n, n.moduleSpecifier.text, c.namedBindings && ts.isNamespaceImport(c.namedBindings) ? 'namespace import' : 'named import');
      } else if (ts.isExportDeclaration(n) && n.moduleSpecifier && ts.isStringLiteral(n.moduleSpecifier) && isWorldModule(rel, n.moduleSpecifier.text)) {
        if (!n.exportClause || named(n.exportClause)) world1(n, n.moduleSpecifier.text, 're-export');
      } else if (ts.isImportTypeNode(n) && ts.isLiteralTypeNode(n.argument) && ts.isStringLiteral(n.argument.literal) && isWorldModule(rel, n.argument.literal.text)) {
        const q = n.qualifier;
        if (q && (ts.isIdentifier(q) ? q.text : q.getText(sf).split('.')[0]) === 'World') world1(n, n.argument.literal.text, 'import() type');
      } else if (ts.isCallExpression(n) && n.expression.kind === ts.SyntaxKind.ImportKeyword && n.arguments.length && ts.isStringLiteral(n.arguments[0]) && isWorldModule(rel, n.arguments[0].text)) {
        world1(n, n.arguments[0].text, 'dynamic import()');
      }
    }
    if (r2) {
      if (ts.isPropertyAccessExpression(n) && n.name.text === 'world' && !OTHER_WORLD.test(n.expression.getText(sf))) {
        const assign = ts.isBinaryExpression(n.parent) && n.parent.left === n && n.parent.operatorToken.kind === ts.SyntaxKind.EqualsToken;
        if (assign && rel === BUILDER && assigns++ === 0) { /* enterMap builds the World */ } else world2(n, `${n.expression.getText(sf)}.world`);
      } else if (ts.isElementAccessExpression(n) && ts.isStringLiteralLike(n.argumentExpression) && n.argumentExpression.text === 'world' && !OTHER_WORLD.test(n.expression.getText(sf))) {
        world2(n, `${n.expression.getText(sf)}['world']`);
      } else if (ts.isBindingElement(n) && ts.isObjectBindingPattern(n.parent) && ((n.propertyName ?? n.name) as ts.Node).getText(sf) === 'world') {
        const decl = n.parent.parent;
        const from = ts.isVariableDeclaration(decl) && decl.initializer ? decl.initializer.getText(sf) : '';
        if (!OTHER_WORLD.test(from)) world2(n, `a destructured { world }${from ? ` of ${from}` : ''}`);
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...sourceFiles(p));
    else if (/\.ts$/.test(e.name) && !e.name.endsWith('.d.ts')) out.push(p);
  }
  return out;
}

test('worldseam: src/sim reads the world only through worldOf and never names the World type', () => {
  const files = sourceFiles(SIM);
  assert.ok(files.length > 30, `found ${files.length} source files under src/sim/`);
  const bad: string[] = [];
  for (const f of files) {
    const rel = path.relative(ROOT, f).split(path.sep).join('/');
    bad.push(...violations(rel, fs.readFileSync(f, 'utf8')));
  }
  assert.deepEqual(bad, [], `world seam violations:\n  ${bad.join('\n  ')}`);
});

test('worldseam: the checker catches each rule and names the file and line', () => {
  const R1 = (rel: string, line: number, spec: string, how: string) => `${rel}:${line} imports World from '${spec}' (${how}): sim code takes WorldQuery (src/sim/worldquery.ts)`;
  const R2 = (rel: string, line: number, how: string) => `${rel}:${line} reads the world as ${how}: use worldOf(ctx) (src/sim/worldquery.ts)`;
  const cases: [string, string, string[]][] = [
    // rule 1
    ['src/sim/x.ts', "import type { World } from './world';", [R1('src/sim/x.ts', 1, './world', 'named import')]],
    ['src/sim/x.ts', "import { HEAD_EPS, type World as W } from './world';", [R1('src/sim/x.ts', 1, './world', 'named import')]],
    ['src/sim/modes/x.ts', "\nimport { World } from '../world';", [R1('src/sim/modes/x.ts', 2, '../world', 'named import')]],
    ['src/sim/x.ts', "import * as w from './world.ts';", [R1('src/sim/x.ts', 1, './world.ts', 'namespace import')]],
    ['src/sim/x.ts', "export { World } from './world';", [R1('src/sim/x.ts', 1, './world', 're-export')]],
    ['src/sim/x.ts', "type K = import('./world').World;", [R1('src/sim/x.ts', 1, './world', 'import() type')]],
    ['src/sim/x.ts', "const m = await import('../sim/world');", [R1('src/sim/x.ts', 1, '../sim/world', 'dynamic import()')]],
    ['src/sim/x.ts', "import { HEAD_EPS, DECK_REACH } from './world'; import { T } from '../world/tiles';", []],
    ['src/sim/run.ts', "import { World } from './world';", []],
    ['src/sim/types.ts', "import type { World } from './world';", []],
    // rule 2
    ['src/sim/x.ts', "const h = ctx.world.height(0, 0);", [R2('src/sim/x.ts', 1, 'ctx.world')]],
    ['src/sim/x.ts', "const W = ctx['world'];", [R2('src/sim/x.ts', 1, "ctx['world']")]],
    ['src/sim/x.ts', "\nconst { world, player } = ctx;", [R2('src/sim/x.ts', 2, 'a destructured { world } of ctx')]],
    ['src/sim/x.ts', "const a = ctx.rng.world.next(), b = ctx.rules.world.size, c = rules.world.gridCell, { world: r } = ctx.rng;", []],
    ['src/sim/x.ts', "const W = worldOf(ctx), T = W.tiles; // ctx.world.height\nconst s = 'ctx.world';", []],
    ['src/sim/worldquery.ts', "export function worldOf(ctx) { return ctx.world; }", []],
    ['src/sim/run.ts', "ctx.world = new World(rules, biome, seed);", []],
    ['src/sim/run.ts', "ctx.world = a;\nctx.world = b;\nconst s = ctx.world.spawn;", [R2('src/sim/run.ts', 2, 'ctx.world'), R2('src/sim/run.ts', 3, 'ctx.world')]],
    ['src/render/x.ts', "import { World } from '../sim/world'; const h = ctx.world.height(0, 0);", []],
  ];
  for (const [rel, text, want] of cases) assert.deepEqual(violations(rel, text), want, `${rel}: ${text}`);
});
