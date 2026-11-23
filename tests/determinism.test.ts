// The determinism rule for every sim and world source, with its allow-list (moved from tests/worldgen.test.ts when the
// classic generator was deleted at C1).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';

// The determinism rule (src/core/detmath.ts, CLAUDE.md): src/sim, src/world, src/core and src/rules (and src/mods, which
// adds sim systems) call detmath for the implementation-approximated maths, never Math.random, and read a clock only for
// timing metrics. These are the call sites left on 2026-11-21, per file: the count may shrink (lower or drop the entry)
// but not grow, and no other file may gain one. Moving one to detmath moves replay hashes or habitat layouts, so it is
// P2b (sim, rules) or P2c (habitat, with a HAB_VERSION bump) in docs/ROADMAP.md, not a drive-by edit.
// `**` with a non-literal exponent is a pow. `clock` is performance.now, Date.now or new Date.
const DETERMINISM_SCOPE = ['core', 'mods', 'rules', 'sim', 'world'];
const DETERMINISM_ALLOWED: Record<string, Record<string, number>> = {
  'rules/sizing.ts': { log: 2, '**': 1 },
  'sim/bot.ts': { hypot: 1 },
  'sim/moves.ts': { tan: 1 },
  'sim/targets.ts': { hypot: 1 },
  'sim/world.ts': { hypot: 1 },
  'world/habitat/dress.ts': { atan2: 1, cos: 3, sin: 3, exp: 2 },
  'world/habitat/families.ts': { hypot: 9 },
  'world/habitat/graves.ts': { tan: 1, hypot: 1 },
  'world/habitat/index.ts': { hypot: 2, clock: 2 },
  'world/habitat/lagoon.ts': { hypot: 1 },
  'world/habitat/landforms.ts': { hypot: 17, atan2: 6, cos: 5, sin: 5 },
  'world/habitat/ruins.ts': { hypot: 2 },
  'world/habitat/sanctuary-checks.ts': { hypot: 4, atan2: 1 },
  'world/habitat/validate.ts': { hypot: 3, cos: 1, sin: 1 },
  'world/locgen/index.ts': { clock: 2 },
  'world/sight.ts': { hypot: 1 }, // mapExposureClear, moved from sim/spatial.ts at C2
};

/** the determinism-rule call sites in one source file, comments stripped, counted by function */
function determinismSites(src: string): Record<string, number> {
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  const out: Record<string, number> = {};
  const add = (k: string) => { out[k] = (out[k] ?? 0) + 1; };
  for (const m of code.matchAll(/\bMath\.(sin|cos|tan|asin|acos|atan2?|sinh|cosh|tanh|asinh|acosh|atanh|hypot|exp|expm1|log|log1p|log2|log10|pow|cbrt|random)\b/g)) add(m[1]);
  for (const _ of code.matchAll(/\*\*(?!\s*\d+\b)/g)) add('**');
  for (const _ of code.matchAll(/\bperformance\.now\b|\bDate\.now\b|\bnew Date\b/g)) add('clock');
  return out;
}

test('the determinism rule: sim, world, core, rules and mods use detmath, no Math.random, clocks only for timing; the allow-list cannot grow', () => {
  const root = new URL('../src/', import.meta.url);
  const files = DETERMINISM_SCOPE.flatMap((d) => (readdirSync(new URL(d, root), { recursive: true }) as string[]).map((f) => `${d}/${f.replace(/\\/g, '/')}`)).filter((f) => f.endsWith('.ts')).sort();
  assert.ok(files.length > 90 && files.includes('sim/run.ts') && files.includes('world/habitat/landforms.ts'), 'the scan reaches the sim and world sources');
  const found: Record<string, Record<string, number>> = {};
  let total = 0;
  for (const f of files) {
    const s = determinismSites(readFileSync(new URL(f, root), 'utf8'));
    if (Object.keys(s).length) found[f] = s;
    total += Object.values(s).reduce((a, b) => a + b, 0);
  }
  for (const [f, s] of Object.entries(found)) {
    assert.ok(!s.random, `${f}: Math.random is never allowed (one Rng stream per system)`);
    for (const [k, n] of Object.entries(s)) {
      const allowed = DETERMINISM_ALLOWED[f]?.[k] ?? 0;
      assert.ok(n <= allowed, `${f}: ${n} × ${k}, allowed ${allowed}; use core/detmath (or, for a clock, keep it out of the output)`);
    }
  }
  // a site that went to detmath lowers its entry, so the list stays a ceiling of what is there
  for (const [f, s] of Object.entries(DETERMINISM_ALLOWED)) for (const [k, n] of Object.entries(s)) {
    assert.equal(found[f]?.[k] ?? 0, n, `${f}: ${k} is allowed ${n} but found ${found[f]?.[k] ?? 0}; lower the allow-list entry`);
  }
  assert.equal(total, 80, 'today: 76 maths call sites (75 Math.*, one non-literal **) and 4 timing clocks');
});
