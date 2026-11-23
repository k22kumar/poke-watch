// Audit of deterministic generation and replay for the habitat recipes (docs/HABITAT_AUDIT.md):
//   npx tsx scripts/habaudit.ts [--seeds 3,7] [--batch 30] [--variantSeeds 8] [--out docs/habaudit] [--skip-children]
//
//   1. fresh loads      every request (recipe, variant, seed) is loaded in separate Node processes through the same path the
//                       game uses (replay link → worldgenFromQuery → createRun), one of them after other maps were built and
//                       played; layout, collision, navigation and the checksum must agree to the bit
//   2. seeds            requested seed, accepted seed, attempts, variant, and that the replay link (and the layout-only link)
//                       loads the accepted map, after a retry too
//   3. layouts          ≥ 2 accepted layouts per recipe: route shape, vertical placement, crossings, hard cover, as numbers
//                       next to the checksum, and top-down sheets with a difference panel (PNG)
//   4. variants         snow and ash against their recipe: collision, navigation, footing in every stage biome, accepted seed
//   5. retries          exhaustion → known-good fallback → failure, on fixtures, with what the player is shown
//   6. batch            generation time and retry rates, for comparison after later changes (baseline.json)
// `--child <query>` is the fresh-load worker (prints one JSON line).
import { execFile } from 'node:child_process';
import { cpus } from 'node:os';
import { mkdirSync, writeFileSync } from 'node:fs';
import { promisify } from 'node:util';
import { createRun, startStage, step } from '../src/sim/run';
import { botInput } from '../src/sim/bot';
import { footing } from '../src/sim/cells';
import { StateHasher } from '../src/sim/checksum';
import { attemptHabitat, generateHabitat, HabitatError, HABITATS, HAB_VERSION, MAX_ATTEMPTS, type HabAttempt } from '../src/world/habitat';
import { HK } from '../src/world/habitat/ctx';
import { regionMap, mapChecksum } from '../src/world/maps';
import { loadInfo, mapErrorMessage, worldgenFromQuery } from '../src/world/replay';
import { BIOMES, STAGES } from '../src/rules/stages';
import { PROP_MATERIALS } from '../src/rules/surfaces';
import { PROP_RULES, T, type ArenaMap, type ArenaPropKind } from '../src/world/tiles';
import { registerPoisoned, registerRecipe, scriptedAttempt, unregister } from './lib/habfixtures';
import { renderHab } from './habsheet';
import { writePng } from './worldsheet';

const arg = (k: string, d: string) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };

// ── hashing ─────────────────────────────────────────────────────────────────────────────────────────────────────────
const fnv = (a: ArrayLike<number>, scale = 1) => { let h = 0x811c9dc5; for (let i = 0; i < a.length; i++) h = Math.imul(h ^ Math.round(a[i] * scale), 0x01000193); return (h >>> 0).toString(16).padStart(8, '0'); };
/** everything a body collides with or stands on: heights, walls, low-prop platforms, decks, fluid levels, stairs, where fluid is, hazards */
export function geometrySum(m: ArenaMap): string {
  const water = Uint8Array.from(m.terrain, (t) => (t === T.water ? 1 : 0));
  return [fnv(m.elev, 100), fnv(m.wall), fnv(m.platform, 100), m.over ? fnv(m.over, 100) : '-', m.wlevel ? fnv(m.wlevel, 100) : '-', fnv(m.stairs), fnv(water), fnv(m.gen?.hab?.hazard ?? [])].join('.');
}
/** what the player sees and the checksum covers beyond geometry: terrain ids and prop kinds */
export function paintSum(m: ArenaMap): string { return fnv(m.terrain) + '.' + fnv(m.props.flatMap((p) => [p.x, p.y, p.kind.charCodeAt(0), p.kind.length, p.kind.charCodeAt(p.kind.length - 1)])); }

// ── one fresh load, the way the game does it ──────────────────────────────────────────────────────────────────────────
export interface Snapshot {
  query: string; map: string; source: string; kind: string; requested: number; loaded: number; attempts: number; version: number; label: string;
  rejections: string; repairs: number; optional: string; shape: string;
  checksum: string; geometry: string; paint: string; nav: string; sim: string; replay: string; layout: string; msLoad: number;
}

export function snapshot(query: string, ticks = 300): Snapshot {
  const p = new URLSearchParams(query.replace(/^\?/, ''));
  const t0 = performance.now();
  const wg = worldgenFromQuery({ world: 'locations', loc: p.get('loc'), mapseed: p.get('mapseed'), hv: p.get('hv'), biomes: Object.keys(BIOMES) }, () => {});
  const ctx = createRun({ seed: 11, species: 'cyndaquil', ruleOverrides: { worldgen: wg } as never });
  const msLoad = performance.now() - t0;
  const W = ctx.world, m = W.map, H = W.hab!, L = loadInfo(H);
  const checksum = mapChecksum(m), geometry = geometrySum(m), paint = paintSum(m);
  // navigation: the enemy flow field from the spawn, and the Raiders' direction to the point on every route tile
  W.updateFlow(W.spawn[0], W.spawn[1]);
  const dirs: number[] = [], out: [number, number] = [0, 0];
  for (let k = 0; k < m.w * m.h; k++) if (m.gen!.route![k]) { W.goalDir((k % W.w) - W.half + 0.5, ((k / W.w) | 0) - W.half + 0.5, out); dirs.push(out[0], out[1]); }
  const nav = fnv(W.flow) + '.' + fnv(dirs, 1000);
  // a short bot-driven match on this map: sim state must agree too
  const h = new StateHasher();
  for (let i = 0; i < ticks; i++) step(ctx, botInput(ctx));
  h.num(ctx.tick).num(ctx.player.x).num(ctx.player.z).num(ctx.player.hp);
  for (let i = 0; i < ctx.enemies.hi; i++) if (ctx.enemies.alive[i]) h.num(ctx.enemies.x[i]).num(ctx.enemies.z[i]);
  return {
    query, map: m.id, source: L.source, kind: L.kind, requested: L.requested, loaded: L.loaded, attempts: L.attempts, version: L.version, label: L.label,
    rejections: H.rejections.map((r) => `${r.seed}[${r.failed.join(',')}]`).join(' '), repairs: H.repairs.length, optional: H.optional.join(','), shape: JSON.stringify(H.shape),
    checksum: checksum.toString(16), geometry, paint, nav, sim: h.h.toString(16), replay: L.replay, layout: L.layout, msLoad: Math.round(msLoad),
  };
}

/** warm child: builds other maps and plays them first, so any state a generation leaks into the next one shows up */
function warm(sources: string[]) {
  for (const [i, s] of sources.entries()) { const c = createRun({ seed: 5 + i, species: 'totodile', ruleOverrides: { worldgen: worldgenFromQuery({ world: 'locations', loc: s, mapseed: String(20 + i), biomes: Object.keys(BIOMES) }, () => {}) } as never }); for (let t = 0; t < 200; t++) step(c, botInput(c)); }
}

const MAIN = !!process.argv[1]?.endsWith('habaudit.ts');
if (MAIN && process.argv[2] === '--child') {
  const q = process.argv[3], w = process.argv.indexOf('--warm');
  if (w > 0) warm(process.argv[w + 1].split(','));
  console.log('@@' + JSON.stringify(snapshot(q)));
  process.exit(0);
}

// ── the audit ──────────────────────────────────────────────────────────────────────────────────────────────────────
const run = promisify(execFile);
const SEEDS = arg('seeds', '3,7').split(',').map(Number), BATCH = Number(arg('batch', '30')), VSEEDS = Number(arg('variantSeeds', '8')), OUT = arg('out', 'docs/habaudit');
const RECIPES = Object.keys(HABITATS);
const variantOf = (id: string) => Object.keys(HABITATS[id].variants)[0];
const src = (id: string, v = '') => id + (v ? '/' + v : '');
const query = (id: string, seed: number, v = '') => `?loc=${src(id, v)}&mapseed=${seed}&hv=${HAB_VERSION}`;
const report: Record<string, unknown> = { version: HAB_VERSION, node: process.version, cpu: cpus()[0]?.model, date: new Date().toISOString().slice(0, 10) };
let failures = 0;
const check = (ok: boolean, what: string) => { if (!ok) { failures++; console.log('  FAIL ' + what); } return ok; };
const pad = (s: unknown, n: number) => String(s).padEnd(n);

async function child(q: string, warmWith?: string[]): Promise<Snapshot> {
  const args = ['--import', 'tsx', process.argv[1], '--child', q, ...(warmWith ? ['--warm', warmWith.join(',')] : [])];
  const { stdout } = await run(process.execPath, args, { maxBuffer: 1 << 24, env: process.env });
  const line = stdout.split('\n').find((l) => l.startsWith('@@'));
  if (!line) throw new Error('child printed no snapshot: ' + stdout.slice(-300));
  return JSON.parse(line.slice(2));
}
const same = (a: Snapshot, b: Snapshot) => (Object.keys(a) as (keyof Snapshot)[]).filter((k) => k !== 'msLoad' && a[k] !== b[k]);

async function freshLoads() {
  console.log('\n== 1+2. fresh loads, seeds and replay links ==');
  const rows: Snapshot[] = [], tasks: Promise<void>[] = [];
  const mine = cpus().length > 4 ? 4 : 2;
  const queue: (() => Promise<void>)[] = [];
  const results: Record<string, Snapshot[]> = {};
  for (const id of RECIPES) for (const v of ['', variantOf(id)]) for (const seed of SEEDS) {
    const key = `${src(id, v)} seed ${seed}`, q = query(id, seed, v);
    results[key] = [];
    const n = v ? 2 : 3;
    for (let i = 0; i < n; i++) queue.push(async () => { results[key].push(await child(q)); });
    // after other maps were built and played in that process
    queue.push(async () => { results[key].push(await child(q, RECIPES.map((r) => src(r, variantOf(r))).concat(RECIPES))); });
  }
  const pool = Array.from({ length: mine }, async () => { for (let f = queue.shift(); f; f = queue.shift()) await f(); });
  await Promise.all([...pool, ...tasks]);
  const table: Record<string, unknown>[] = [];
  for (const [key, snaps] of Object.entries(results)) {
    const [a, ...rest] = snaps;
    const diffs = rest.map((s) => same(a, s)).flat();
    check(diffs.length === 0, `${key}: fresh loads disagree on ${[...new Set(diffs)].join(',')}`);
    rows.push(a);
    table.push({ request: key, kind: a.kind, requested: a.requested, accepted: a.loaded, attempts: a.attempts, rejected: a.rejections || '-', checksum: a.checksum, geometry: a.geometry, nav: a.nav, sim: a.sim, loads: snaps.length, agree: diffs.length === 0, ms: snaps.map((s) => s.msLoad).join('/') });
    console.log(`  ${pad(key, 30)} ${pad(a.kind, 8)} requested ${pad(a.requested, 4)} accepted ${pad(a.loaded, 11)} attempts ${a.attempts}  checksum ${a.checksum}  ${snaps.length} loads ${diffs.length ? 'DISAGREE' : 'agree'}  [${a.label}]`);
  }
  report.freshLoads = table;
  // the replay links: the link a load reports reproduces that load in a fresh process, and so does the layout-only link
  const linkRows: Record<string, unknown>[] = [];
  for (const a of rows.filter((r) => r.kind !== 'direct' || r.source.includes('volcanic'))) {
    const viaReplay = await child(a.replay), viaLayout = await child(a.layout);
    const r1 = same(a, viaReplay), r2 = viaLayout.checksum === a.checksum && viaLayout.geometry === a.geometry && viaLayout.nav === a.nav;
    check(r1.length === 0, `${a.source} seed ${a.requested}: the replay link ${a.replay} did not reproduce the load (${r1.join(',')})`);
    check(r2, `${a.source} seed ${a.requested}: the layout-only link ${a.layout} did not reproduce the accepted map`);
    check(viaLayout.attempts === 1 && viaLayout.loaded === a.loaded, `${a.source}: the layout link loads in one attempt, from the accepted seed`);
    linkRows.push({ request: a.query, kind: a.kind, accepted: a.loaded, replayLink: a.replay, replayChecksum: viaReplay.checksum, layoutLink: a.layout, layoutChecksum: viaLayout.checksum, layoutAttempts: viaLayout.attempts, layoutMapId: viaLayout.map, equal: r1.length === 0 && r2 });
    console.log(`  ${pad(a.source + ' ' + a.requested, 26)} ${a.replay} → ${viaReplay.checksum} | ${a.layout} → ${viaLayout.checksum} (${viaLayout.attempts} attempt) ${r1.length === 0 && r2 ? 'identical' : 'DIFFERENT'}`);
  }
  report.replayLinks = linkRows;
}

// ── layouts ────────────────────────────────────────────────────────────────────────────────────────────────────────────
interface Layout {
  seed: number; accepted: number; attempts: number; checksum: string; geometry: string; orientation: string;
  routes: Record<string, { tiles: number; length: number; sinuosity: number; turns: number; rise: number; fall: number; lo: number; hi: number; form: string }>;
  vertical: { contestH: number; stageA: number; stageB: number; relief: number; bands: Record<string, number>; contestAboveMedian: number };
  crossings: Record<string, number>; deckTiles: number; heights: string;
  cover: { hardTiles: number; softTiles: number; spurs: number; ringTiles: number };
  optional: string; metrics: Record<string, number>; shape: Record<string, number>;
}

function accepted(id: string, seed: number, variant = ''): { m: ArenaMap; a: HabAttempt } {
  let got: HabAttempt | undefined;
  const m = generateHabitat({ recipe: id, seed, variant, attempt: (...x) => { const r = attemptHabitat(...x); if (r.ok) got = r; return r; } });
  return { m, a: got! };
}

function analyse(id: string, seed: number, m: ArenaMap, a: HabAttempt): Layout {
  const g = a.g, H = m.gen!.hab!, S = m.w, n = S * S;
  const routes: Layout['routes'] = {};
  for (const A of g.approaches) {
    const pts = A.pts; let length = 0, turn = 0, prev = NaN, rise = 0, fall = 0, lo = Infinity, hi = -Infinity, last = NaN;
    for (let i = 0; i < pts.length; i++) {
      const e = g.H[g.idx(Math.min(S - 1, Math.max(0, Math.floor(pts[i][0]))), Math.min(S - 1, Math.max(0, Math.floor(pts[i][1]))))];
      lo = Math.min(lo, e); hi = Math.max(hi, e);
      if (!Number.isNaN(last)) { rise += Math.max(0, e - last); fall += Math.max(0, last - e); }
      last = e;
      if (i) {
        length += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
        if (i >= 4) { const hd = Math.atan2(pts[i][1] - pts[i - 4][1], pts[i][0] - pts[i - 4][0]); if (!Number.isNaN(prev)) { let d = hd - prev; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; turn += Math.abs(d); } prev = hd; }
      }
    }
    const straight = Math.hypot(pts[pts.length - 1][0] - pts[0][0], pts[pts.length - 1][1] - pts[0][1]) || 1;
    routes[A.id] = { tiles: A.tiles.length, length: +length.toFixed(1), sinuosity: +(length / straight).toFixed(2), turns: +(turn / Math.PI).toFixed(1), rise: +rise.toFixed(1), fall: +fall.toFixed(1), lo: +lo.toFixed(2), hi: +hi.toFixed(2), form: A.form };
  }
  // vertical placement: walkable heights in bands, and where the point and the stagings sit among them
  const bands: Record<string, number> = { '<2': 0, '2-4': 0, '4-6': 0, '6+': 0 }, hs: number[] = [];
  for (let k = 0; k < n; k++) if (!m.wall[k] && m.terrain[k] !== T.water && g.kind[k] !== HK.mass) { const e = m.elev[k]; hs.push(e); bands[e < 2 ? '<2' : e < 4 ? '2-4' : e < 6 ? '4-6' : '6+']++; }
  hs.sort((x, y) => x - y);
  const crossings: Record<string, number> = {};
  for (const j of g.joins) crossings[j.what] = (crossings[j.what] ?? 0) + 1;
  const deckTiles = m.over ? m.over.reduce((c, v) => c + (v > 0 ? 1 : 0), 0) : 0;
  // hard cover around the point (4-16 tiles): rock the terrain made and props nothing can break or burn, against props that can
  const foot = new Uint8Array(n), cx = g.contest.x, cy = g.contest.y;
  let hard = 0, soft = 0, ring = 0;
  for (const p of m.props) for (let y = p.y; y < p.y + p.h; y++) for (let x = p.x; x < p.x + p.w; x++) if (x >= 0 && y >= 0 && x < S && y < S) foot[y * S + x] = PROP_RULES[p.kind]?.wall || PROP_RULES[p.kind]?.platform ? 1 : 0;
  const propAt = new Map<number, string>();
  for (const p of m.props) for (let y = p.y; y < p.y + p.h; y++) for (let x = p.x; x < p.x + p.w; x++) propAt.set(y * S + x, p.kind);
  for (let k = 0; k < n; k++) {
    const d = Math.hypot((k % S) + 0.5 - cx, ((k / S) | 0) + 0.5 - cy);
    if (d < 4 || d > 16) continue;
    ring++;
    const kind = propAt.get(k);
    if (m.wall[k] && !foot[k]) hard++; // terrain rock
    else if (kind && foot[k]) { const mat = (PROP_MATERIALS as Record<string, { integrity: number } | undefined>)[kind]; if (!mat || mat.integrity === 0) hard++; else soft++; }
  }
  const spurs = H.repairs.filter((r) => r.startsWith('occlude')).length;
  return {
    seed, accepted: H.attemptSeed, attempts: H.attempts, checksum: mapChecksum(m).toString(16), geometry: geometrySum(m), orientation: `rot ${g.rot * 90}°${g.mir ? ' mirrored' : ''}`, routes,
    vertical: { contestH: +g.contest.h.toFixed(2), stageA: +m.elev[Math.floor(g.nodes.stageA[1]) * S + Math.floor(g.nodes.stageA[0])].toFixed(2), stageB: +m.elev[Math.floor(g.nodes.stageB[1]) * S + Math.floor(g.nodes.stageB[0])].toFixed(2), relief: +(hs[hs.length - 1] - hs[0]).toFixed(2), bands, contestAboveMedian: +(g.contest.h - hs[hs.length >> 1]).toFixed(2) },
    crossings, deckTiles, heights: [...new Set(g.joins.map((j) => `${j.what}@${j.h.toFixed(1)}`))].sort().join(' '), cover: { hardTiles: hard, softTiles: soft, spurs, ringTiles: ring },
    optional: H.optional.join(','), metrics: H.metrics, shape: H.shape,
  };
}

function routeSet(m: ArenaMap): Set<number> { const s = new Set<number>(); const r = m.gen!.route!; for (let k = 0; k < r.length; k++) if (r[k]) s.add(k); return s; }

function layouts() {
  console.log('\n== 3. layouts ==');
  mkdirSync(OUT, { recursive: true });
  const all: Record<string, unknown> = {};
  for (const id of RECIPES) {
    const seeds = [...new Set([...SEEDS, id === 'volcanic-ridge' ? 4 : 11])];
    const L: Layout[] = [], M: ArenaMap[] = [], A: HabAttempt[] = [];
    for (const s of seeds) { const { m, a } = accepted(id, s); M.push(m); A.push(a); L.push(analyse(id, s, m, a)); }
    console.log(`\n  ${HABITATS[id].name}`);
    for (const l of L) {
      const rt = Object.entries(l.routes).map(([k, r]) => `${k} ${r.length}m×${r.sinuosity} turns ${r.turns} rise ${r.rise}/fall ${r.fall} h ${r.lo}-${r.hi}`).join(' | ');
      console.log(`   seed ${pad(l.seed, 3)} accepted ${pad(l.accepted, 11)} checksum ${l.checksum} geometry ${l.geometry}\n     orientation ${l.orientation}; shape ${JSON.stringify(l.shape)}; optional ${l.optional || '-'}\n     routes: ${rt}\n     vertical: contest ${l.vertical.contestH} m, stages ${l.vertical.stageA}/${l.vertical.stageB}, relief ${l.vertical.relief}, bands ${JSON.stringify(l.vertical.bands)}\n     crossings: ${JSON.stringify(l.crossings)} (${l.heights}), deck tiles ${l.deckTiles}; hard cover ${l.cover.hardTiles}, soft ${l.cover.softTiles} of ${l.cover.ringTiles} ring tiles, spurs added by repair ${l.cover.spurs}`);
    }
    // pairwise differences
    const pairs: Record<string, unknown>[] = [];
    for (let i = 0; i < L.length; i++) for (let j = i + 1; j < L.length; j++) {
      const ri = routeSet(M[i]), rj = routeSet(M[j]);
      let inter = 0; for (const k of ri) if (rj.has(k)) inter++;
      const jac = inter / (ri.size + rj.size - inter);
      const n = M[i].w * M[i].h; let dElev = 0, dWall = 0, walk = 0;
      for (let k = 0; k < n; k++) { dElev += Math.abs(M[i].elev[k] - M[j].elev[k]); if (M[i].wall[k] !== M[j].wall[k]) dWall++; if (!M[i].wall[k] && !M[j].wall[k]) walk++; }
      const row = { a: L[i].seed, b: L[j].seed, checksumA: L[i].checksum, checksumB: L[j].checksum, routeOverlap: +jac.toFixed(3), meanElevDiff: +(dElev / n).toFixed(2), wallTilesDiffer: +(dWall / n).toFixed(3), crossingsA: L[i].crossings, crossingsB: L[j].crossings, coverA: L[i].cover.hardTiles, coverB: L[j].cover.hardTiles };
      pairs.push(row);
      console.log(`   seeds ${L[i].seed} vs ${L[j].seed}: route tiles shared ${(jac * 100).toFixed(1)} %, mean |Δelevation| ${row.meanElevDiff} m, walls differ on ${(row.wallTilesDiffer * 100).toFixed(1)} % of tiles, hard cover ${L[i].cover.hardTiles} vs ${L[j].cover.hardTiles}`);
      check(L[i].checksum !== L[j].checksum && L[i].geometry !== L[j].geometry && (jac < 0.8 || row.wallTilesDiffer > 0.03), `${id}: seeds ${L[i].seed} and ${L[j].seed} are not meaningfully different layouts`);
    }
    // top-down sheet: each accepted layout (routes: A direct cyan, A flank blue, B direct yellow, B flank orange; point white), then the pairwise route/elevation difference
    const sc = 3, cell = 128 * sc + 6, cols = L.length + 1, sheet = new Uint8Array(cols * cell * cell * 3).fill(24);
    L.forEach((_, i) => { const r = renderHab(M[i], sc, A[i].g, []); blit(sheet, cols * cell, r, i * cell + 3, 3); });
    const d = diffPanel(M[0], M[1], sc);
    blit(sheet, cols * cell, d, L.length * cell + 3, 3);
    const png = `${OUT}/${id}-layouts.png`;
    writePng(png, cols * cell, cell, sheet);
    console.log(`   wrote ${png} (seeds ${seeds.join(', ')}, then route/elevation difference of ${seeds[0]} vs ${seeds[1]}: cyan = only ${seeds[0]}, orange = only ${seeds[1]}, white = both, red = ${seeds[1]} higher, blue = ${seeds[1]} lower)`);
    all[id] = { layouts: L, pairs, sheet: png };
  }
  report.layouts = all;
}

function blit(dst: Uint8Array, dw: number, src: { w: number; h: number; px: Uint8Array }, ox: number, oy: number) {
  for (let y = 0; y < src.h; y++) for (let x = 0; x < src.w; x++) { const s = (y * src.w + x) * 3, d = ((oy + y) * dw + ox + x) * 3; dst[d] = src.px[s]; dst[d + 1] = src.px[s + 1]; dst[d + 2] = src.px[s + 2]; }
}
function diffPanel(a: ArenaMap, b: ArenaMap, sc: number): { w: number; h: number; px: Uint8Array } {
  const S = a.w, W = S * sc, px = new Uint8Array(W * W * 3), ra = routeSet(a), rb = routeSet(b);
  for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) {
    const k = j * S + i, de = b.elev[k] - a.elev[k];
    let c: [number, number, number] = [40, 40, 40];
    if (Math.abs(de) > 0.3) { const v = Math.min(1, Math.abs(de) / 4); c = de > 0 ? [40 + 200 * v, 40, 40] : [40, 40, 40 + 200 * v]; }
    const inA = ra.has(k), inB = rb.has(k);
    if (inA && inB) c = [255, 255, 255]; else if (inA) c = [60, 230, 230]; else if (inB) c = [255, 140, 30];
    for (let y = 0; y < sc; y++) for (let x = 0; x < sc; x++) { const o = ((j * sc + y) * W + i * sc + x) * 3; px[o] = c[0]; px[o + 1] = c[1]; px[o + 2] = c[2]; }
  }
  return { w: W, h: W, px };
}

// ── variants ───────────────────────────────────────────────────────────────────────────────────────────────────────────
/** footing speed of every walkable tile in each stage biome, for one map source and seed */
export function footingByBiome(source: string, seed: number): Record<string, { sum: string; route: number; off: number }> {
  const wg = worldgenFromQuery({ world: 'locations', loc: source, mapseed: String(seed), biomes: Object.keys(BIOMES) }, () => {});
  const ctx = createRun({ seed: 1, species: 'cyndaquil', ruleOverrides: { worldgen: wg } as never });
  const out: Record<string, { sum: string; route: number; off: number }> = {};
  for (let st = 0; st < STAGES.length; st++) {
    startStage(ctx, st);
    const W = ctx.world, m = W.map, v: number[] = []; let sr = 0, nr = 0, so = 0, no = 0;
    for (let k = 0; k < m.w * m.h; k++) {
      if (m.wall[k] || m.terrain[k] === T.water) { v.push(0); continue; }
      const f = footing(ctx, (k % W.w) - W.half + 0.5, ((k / W.w) | 0) - W.half + 0.5, ['blaze'])[0];
      v.push(f); if (m.gen!.route![k]) { sr += f; nr++; } else { so += f; no++; }
    }
    out[STAGES[st].biome] = { sum: fnv(v, 1000), route: +(sr / nr).toFixed(3), off: +(so / no).toFixed(3) };
  }
  return out;
}

/** a variant's claim, tested: collision, navigation and footing identical to the recipe's, the same seed accepted on the same attempt */
export function variantAgainstBase(id: string, variant: string, seed: number, footingToo: boolean) {
  const a = generateHabitat({ recipe: id, seed }), b = generateHabitat({ recipe: id, seed, variant });
  const Ha = a.gen!.hab!, Hb = b.gen!.hab!;
  const issues: string[] = [];
  if (Ha.attempts !== Hb.attempts || Ha.attemptSeed !== Hb.attemptSeed || !!Ha.fallback !== !!Hb.fallback) issues.push(`accepted seed (${Ha.attemptSeed} in ${Ha.attempts} vs ${Hb.attemptSeed} in ${Hb.attempts})`);
  if (geometrySum(a) !== geometrySum(b)) issues.push('collision geometry');
  if (JSON.stringify(Ha.shape) !== JSON.stringify(Hb.shape) || JSON.stringify(Ha.metrics) !== JSON.stringify(Hb.metrics)) issues.push('route shape or metrics');
  // paint-only: same footprints for every prop, same terrain ids unless the recipe's surfaces were swapped
  const fa = a.props.map((p) => `${p.x},${p.y},${p.w},${p.h}`).join('|'), fb = b.props.map((p) => `${p.x},${p.y},${p.w},${p.h}`).join('|');
  if (fa !== fb) issues.push('prop footprints');
  let nav = '';
  { const mk = (m: ArenaMap) => { const ctx = createRun({ seed: 1, species: 'cyndaquil', ruleOverrides: { worldgen: { mode: 'generated', regionSeed: seed, locations: { meadow: m === a ? id : src(id, variant).replace('/', ':') } } } as never }); ctx.world.updateFlow(ctx.world.spawn[0], ctx.world.spawn[1]); return fnv(ctx.world.flow); }; nav = mk(a) === mk(b) ? '' : 'navigation'; }
  if (nav) issues.push(nav);
  const foot: Record<string, string> = {};
  if (footingToo) {
    const fa2 = footingByBiome(id, seed), fb2 = footingByBiome(src(id, variant), seed);
    for (const biome of Object.keys(fa2)) if (fa2[biome].sum !== fb2[biome].sum) { issues.push(`footing in ${biome} (route speed ${fa2[biome].route} → ${fb2[biome].route}, off-route ${fa2[biome].off} → ${fb2[biome].off})`); foot[biome] = `${fa2[biome].route}→${fb2[biome].route}`; }
  }
  return { issues, base: { checksum: mapChecksum(a).toString(16), geometry: geometrySum(a), paint: paintSum(a) }, variant: { checksum: mapChecksum(b).toString(16), geometry: geometrySum(b), paint: paintSum(b) }, foot };
}

/** static rule: a variant's replacement props have the footprint, wall and platform of the props they replace */
export function variantPropRuleIssues(id: string): string[] {
  const R = HABITATS[id], out: string[] = [];
  for (const [vn, V] of Object.entries(R.variants)) {
    const rule = (k: string) => { const r = PROP_RULES[k as ArenaPropKind]; return `${r.w}x${r.h} wall=${!!r.wall} platform=${r.platform ?? 0}`; };
    const swap = (what: string, base: string[], over?: string[]) => { if (!over) return; const bs = new Set(base.map(rule)), os = new Set(over.map(rule)); if (bs.size !== 1 || os.size !== 1 || [...bs][0] !== [...os][0]) out.push(`${id}:${vn} ${what} ${over.join('/')} (${[...os].join(' ; ')}) vs ${base.join('/')} (${[...bs].join(' ; ')})`); };
    swap('trees', R.vegetation.trees, V.trees); swap('under', R.vegetation.under, V.under);
    if (V.fill && V.fill !== R.vegetation.fill) swap('fill', [R.vegetation.fill], [V.fill]);
  }
  return out;
}

function variants() {
  console.log('\n== 4. variants against their recipe ==');
  const all: Record<string, unknown> = {};
  for (const id of RECIPES) {
    const v = variantOf(id), rows: unknown[] = [];
    let bad = 0;
    const rules = variantPropRuleIssues(id);
    check(rules.length === 0, `${id}:${v} replacement props differ from the recipe's in collision: ${rules.join('; ')}`);
    for (let s = 1; s <= VSEEDS; s++) {
      const r = variantAgainstBase(id, v, s, s <= 4 || SEEDS.includes(s));
      if (r.issues.length) { bad++; check(false, `${id}:${v} seed ${s}: ${r.issues.join('; ')}`); }
      rows.push({ seed: s, ...r });
    }
    console.log(`  ${pad(id + ':' + v, 22)} ${VSEEDS} seeds: ${bad === 0 ? 'collision, navigation, route shape, footing and the accepted seed are identical to the recipe' : bad + ' seeds differ'}; checksums differ only by paint (${(rows[0] as { base: { checksum: string }; variant: { checksum: string } }).base.checksum} vs ${(rows[0] as { variant: { checksum: string } }).variant.checksum} for seed 1)`);
    all[id] = { variant: v, propRuleIssues: rules, rows };
  }
  // the detector against the old definitions: the swaps this audit found, put back, must be caught
  console.log('  witnesses (the definitions this audit replaced):');
  registerRecipe('legacy-ash', HABITATS['volcanic-ridge'], { variants: { ash: { name: 'old ash', surfaces: { floor: T.sand, route: T.dirt }, art: 'badlands', particles: 'embers' } } });
  registerRecipe('legacy-snow', HABITATS['river-gorge'], { variants: { snow: { name: 'old snow', surfaces: { floor: T.grass, rim: T.grass, route: T.path, bank: T.sand }, art: 'frost', particles: 'snow', trees: ['icepine', 'icepine', 'tree'], under: ['rock'] } } });
  const w1 = variantAgainstBase('legacy-ash', 'ash', 3, true), w2 = variantAgainstBase('legacy-snow', 'snow', 3, false), w3 = variantPropRuleIssues('legacy-snow');
  unregister('legacy-ash'); unregister('legacy-snow');
  check(w1.issues.some((x) => x.startsWith('footing in frost')), 'the audit does not catch the old ash footing change');
  check(w2.issues.includes('collision geometry') && w3.length > 0, 'the audit does not catch the old snow platform change');
  console.log(`    old ash  seed 3: ${w1.issues.join('; ')}`);
  console.log(`    old snow seed 3: ${w2.issues.join('; ')}; ${w3.join('; ')}`);
  all.witnesses = { ash: w1.issues, snow: [...w2.issues, ...w3] };
  report.variants = all;
}

// ── retry exhaustion, fallback, failure ────────────────────────────────────────────────────────────────────────────────────
function retries() {
  console.log('\n== 5. retry exhaustion, fallback, failure ==');
  const out: Record<string, unknown> = {};
  // a real retry: the batch's Cinder Crater seed 3
  const real = generateHabitat({ recipe: 'volcanic-ridge', seed: 3 }).gen!.hab!;
  console.log(`  real retry: Cinder Crater seed 3 → ${real.rejections.map((r) => `${r.seed} [${r.failed.join(',')}]`).join(', ')}; accepted seed ${real.attemptSeed} on attempt ${real.attempts}`);
  out.realRetry = { seed: 3, rejections: real.rejections, accepted: real.attemptSeed, attempts: real.attempts };
  check(real.attempts > 1 && real.rejections.length === real.attempts - 1, 'Cinder Crater seed 3 needed no retry (the retry examples use it)');
  for (const id of RECIPES) {
    const R = HABITATS[id], fs = R.fallbackSeeds, rows: unknown[] = [];
    // 1. every fallback seed passes every gate on its first attempt (a fallback is one attempt, and valid), base and variant
    for (const v of ['', variantOf(id)]) for (const s of fs) { const H = generateHabitat({ recipe: id, seed: s, variant: v }).gen!.hab!; check(H.attempts === 1 && !H.fallback && H.gates.every((g) => g.ok), `${src(id, v)}: fallback seed ${s} is not valid on its first attempt (${H.attempts} attempts)`); }
    // 2. exhaustion → fallback, on the real validator: only the fallback seed is let through
    const log: number[] = [], REQ = 9;
    const t0 = performance.now();
    const m = generateHabitat({ recipe: id, seed: REQ, attempt: scriptedAttempt((s) => s === fs[0], log) });
    const H = m.gen!.hab!, L = loadInfo(H);
    check(log.length === MAX_ATTEMPTS + 1 && log[MAX_ATTEMPTS] === fs[0] && H.rejections.length === MAX_ATTEMPTS && !!H.fallback && H.fallback.used === fs[0] && H.fallback.requested === REQ, `${id}: expected ${MAX_ATTEMPTS} rejected attempts then fallback ${fs[0]}, saw ${log.join(',')}`);
    check(H.gates.length > 0 && H.gates.every((g) => g.ok), `${id}: the fallback map's gates did not all run and pass`);
    const direct = generateHabitat({ recipe: id, seed: fs[0] });
    check(mapChecksum(m) === mapChecksum(direct) && geometrySum(m) === geometrySum(direct), `${id}: the fallback map is not the known valid seed's map`);
    // 3. what the player sees
    console.log(`  ${HABITATS[id].name}: seed ${REQ} rejected ×${MAX_ATTEMPTS} (${H.rejections.map((r) => r.seed).join(', ')}) → fallback ${H.fallback!.used}; ${(performance.now() - t0).toFixed(0)} ms\n    plaque:  "Region 1 of 4 · ${L.label}"\n    console: ${L.note}\n    checksum ${mapChecksum(m).toString(16)} = direct seed ${fs[0]} ${mapChecksum(direct).toString(16)}; layout link ${L.layout}`);
    rows.push({ requested: REQ, attemptsAsked: log, fallbackUsed: H.fallback!.used, plaque: L.label, console: L.note, checksum: mapChecksum(m).toString(16), directChecksum: mapChecksum(direct).toString(16), layoutLink: L.layout, gates: H.gates.length });
    // 4. the first fallback seed fails too → the second is used (the fallback list is walked)
    const log2: number[] = [];
    const m2 = generateHabitat({ recipe: id, seed: REQ, attempt: scriptedAttempt((s) => s === fs[1], log2) });
    check(m2.gen!.hab!.fallback!.used === fs[1] && log2.slice(MAX_ATTEMPTS).join() === fs.slice(0, 2).join(), `${id}: the list was not walked (${log2.join(',')})`);
    // 5. nothing usable → a clear failure, and nothing is generated
    let err: unknown;
    try { generateHabitat({ recipe: id, seed: REQ, attempt: scriptedAttempt(() => false) }); } catch (e) { err = e; }
    check(err instanceof HabitatError && err.rejections.length === MAX_ATTEMPTS + fs.length, `${id}: exhaustion did not raise HabitatError with every candidate listed`);
    const msg = mapErrorMessage(err);
    console.log(`    nothing usable → ${(err as Error)?.constructor?.name} with ${(err as HabitatError).rejections.length} rejections\n    dialog:  "${msg}"`);
    rows.push({ failure: { candidates: (err as HabitatError).rejections.length, dialog: msg } });
    out[id] = rows;
  }
  report.retries = out;
}

// ── batch ───────────────────────────────────────────────────────────────────────────────────────────────────────────────
function batch() {
  console.log(`\n== 6. batch: seeds 1-${BATCH} per recipe ==`);
  const out: Record<string, unknown> = {};
  for (const id of RECIPES) {
    const ms: number[] = [], rej: Record<string, number> = {}, tries: number[] = [];
    let first = 0, fb = 0, err = 0; const retried: string[] = [], routes: { s: number; r: Set<number>; o: string; rot: number; mir: boolean }[] = [];
    for (let s = 1; s <= BATCH; s++) {
      const t0 = performance.now();
      try {
        const { m: M, a: A } = accepted(id, s), H = M.gen!.hab!;
        routes.push({ s, r: routeSet(M), o: `${A.g.rot}${A.g.mir ? 'm' : ''}`, rot: A.g.rot, mir: A.g.mir });
        ms.push(performance.now() - t0); tries.push(H.attempts);
        if (H.attempts === 1) first++; else retried.push(`${s}→${H.attemptSeed}(${H.attempts})`);
        if (H.fallback) fb++;
        for (const r of H.rejections) for (const f of r.failed) { const k = f.split(':').slice(0, 2).join(':'); rej[k] = (rej[k] ?? 0) + 1; }
      } catch { err++; }
    }
    // variety across the batch: how much of one accepted layout's route another's repeats (route tiles shared, Jaccard)
    const jac: number[] = [], rel: Record<string, number[]> = { sameRotSameMirror: [], sameRotOtherMirror: [], otherRot: [] }; let sameO = 0, sameOHigh = 0;
    for (let i = 0; i < routes.length; i++) for (let j = i + 1; j < routes.length; j++) {
      let inter = 0; for (const k of routes[i].r) if (routes[j].r.has(k)) inter++;
      const v = inter / (routes[i].r.size + routes[j].r.size - inter); jac.push(v);
      if (routes[i].o === routes[j].o) { sameO++; if (v > 0.5) sameOHigh++; }
      rel[routes[i].rot !== routes[j].rot ? 'otherRot' : routes[i].mir === routes[j].mir ? 'sameRotSameMirror' : 'sameRotOtherMirror'].push(v);
    }
    jac.sort((a, b) => a - b);
    const variety = { pairs: jac.length, routeOverlapMedian: +jac[jac.length >> 1].toFixed(3), routeOverlapMax: +jac[jac.length - 1].toFixed(3), pairsAbove50: jac.filter((v) => v > 0.5).length, pairsAbove80: jac.filter((v) => v > 0.8).length, orientations: new Set(routes.map((r) => r.o)).size, sameOrientationPairs: sameO, sameOrientationAbove50: sameOHigh, byRelation: Object.fromEntries(Object.entries(rel).map(([k, v]) => [k, { pairs: v.length, mean: +(v.reduce((a, b) => a + b, 0) / (v.length || 1)).toFixed(3), above50: v.filter((x) => x > 0.5).length }])) };
    ms.sort((a, b) => a - b);
    const q = (p: number) => Math.round(ms[Math.min(ms.length - 1, Math.floor(ms.length * p))]);
    const row = { seeds: BATCH, firstAttempt: first, retried: BATCH - first - err, fallbacks: fb, errors: err, attemptsMean: +(tries.reduce((a, b) => a + b, 0) / tries.length).toFixed(2), attemptsMax: Math.max(...tries), rejectedByGate: rej, retriedSeeds: retried, msP50: q(0.5), msP95: q(0.95), msMax: q(1), msMean: Math.round(ms.reduce((a, b) => a + b, 0) / ms.length), variety };
    out[id] = row;
    console.log(`  ${pad(id, 15)} first attempt ${first}/${BATCH}, retried ${row.retried}, fallback ${fb}, errors ${err}, attempts mean ${row.attemptsMean} max ${row.attemptsMax}; ms p50 ${row.msP50} p95 ${row.msP95} max ${row.msMax}; rejected by gate ${JSON.stringify(rej)}; retried: ${retried.join(' ')}\n    variety: route tiles shared by two seeds: median ${variety.routeOverlapMedian}, max ${variety.routeOverlapMax}; ${variety.pairsAbove50}/${variety.pairs} pairs above 50 %, ${variety.pairsAbove80} above 80 %; ${variety.orientations} orientations, ${variety.sameOrientationAbove50}/${variety.sameOrientationPairs} same-orientation pairs above 50 %\n    by relation (pairs, mean route tiles shared, above 50 %): ${Object.entries(variety.byRelation).map(([k, v]) => `${k} ${v.pairs}, ${v.mean}, ${v.above50}`).join(' | ')}`);
    check(err === 0 && fb === 0, `${id}: batch had errors or fallbacks`);
  }
  report.batch = out;
}

// ── cache: play never rewrites the map the next load reads ──────────────────────────────────────────────────────────────────────
function cache() {
  console.log('\n== cache ==');
  const wg = { mode: 'generated' as const, biomes: [], size: 128, version: 1, locations: { meadow: 'volcanic-ridge' } };
  const before = mapChecksum(regionMap(wg, 'meadow', 7));
  const ctx = createRun({ seed: 3, species: 'cyndaquil', ruleOverrides: { worldgen: { mode: 'generated', regionSeed: 7, locations: { meadow: 'volcanic-ridge' } } } as never });
  for (let i = 0; i < 1800; i++) step(ctx, botInput(ctx));
  const after = mapChecksum(regionMap(wg, 'meadow', 7));
  check(before === after, 'play changed the cached map');
  console.log(`  cached volcanic-ridge seed 7 checksum before play ${before.toString(16)}, after 30 s of play ${after.toString(16)}`);
  report.cache = { before: before.toString(16), after: after.toString(16) };
}

if (MAIN) (async () => {
  if (!process.argv.includes('--skip-children')) await freshLoads();
  layouts();
  variants();
  retries();
  cache();
  batch();
  report.failures = failures;
  mkdirSync(OUT, { recursive: true });
  writeFileSync(`${OUT}/baseline.json`, JSON.stringify(report, null, 1));
  console.log(`\n${failures ? failures + ' FAILURES' : 'all checks passed'}; wrote ${OUT}/baseline.json`);
  process.exit(failures ? 1 : 0);
})();
