// Generates the S3 giant-comparison scenes (docs/size-extremes-plan.md §S3) into tools/sizescenes.json, replacing any
// earlier `size-giants*`, `size-ref*`, `size-clip*`, `size-deck*`, `size-target*` and `size-frame*` entries. Run with
// tools/sizecap.mjs against the private capture builds (.capture/build.mjs on|off), which carry Wailord and Eternatus;
// the committed game does not, so these scenes are capture-only.
//
//   node tools/sizegiants.gen.mjs
import fs from 'node:fs';

const FILE = new URL('./sizescenes.json', import.meta.url);
const Q = 'go=1&seed=1&species=charmander&calm=1&cam=classic&world=authored&tp=56,56';
const GIANTS = ['snorlax', 'onix', 'wailord', 'eternatus'];
const REF = ['rattata', 'sandshrew', 'charmeleon', 'heracross', 'snorlax']; // one per class (height-listed shapes)
const MEASURE = [...new Set([...GIANTS, ...REF])];
const settle = { advance: 1.5, frames: 90 };
const tick = { advance: 0.5, frames: 30 };

/** move the partner to the nearest open, flat, deck-free and dry stretch (a w × d tile box: the row stands in its north
 *  half), so the comparison is not cut by props, bridges or slopes */
const openSpot = (w = 24, d = 8) => `(() => { const pw = window.pokewatch, ctx = pw.ctx, W = ctx.world, M = W.map, P = ctx.player, R = pw.renderer;
  const ok = (ci, cj) => { const g = W.height(ci - W.half + 0.5, cj - W.half + 0.5);
    for (let j = cj - ${d} + 2; j <= cj + 2; j++) for (let i = ci - ${w >> 1}; i <= ci + ${w >> 1}; i++) { if (i < 0 || j < 0 || i >= W.w || j >= W.h) return false;
      const k = j * W.w + i; if (M.wall[k] || (M.over && M.over[k] > 0) || W.waterAt(i - W.half + 0.5, j - W.half + 0.5) > -Infinity || Math.abs(W.height(i - W.half + 0.5, j - W.half + 0.5) - g) > 0.25) return false; }
    return true; };
  const c0 = Math.floor(P.x + W.half), r0 = Math.floor(P.z + W.half);
  for (let r = 0; r < 60; r++) for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) { if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
    const ci = c0 + di, cj = r0 + dj; if (!ok(ci, cj)) continue;
    P.x = P.px = ci - W.half + 0.5; P.z = P.pz = cj - W.half + 0.5; P.y = P.py = W.height(P.x, P.z); R.snapCamera(ctx); return { tile: [ci, cj], x: P.x, z: P.z }; }
  return null; })()`;

/** spawn `ids` in a row `dz` m north of the partner (they face it, so the camera sees their front), frozen in place */
const row = (ids, gap, dz = -2) => `(() => { const pw = window.pokewatch, E = pw.ctx.enemies; const n = ${ids.length}, gap = ${gap};
  return ${JSON.stringify(ids)}.map((id, k) => { const i = pw.spawn(id, (k - (n - 1) / 2) * gap, ${dz}); E.speed[i] = 0; E.hp[i] = E.maxHp[i] = 1e6; return { id, i, x: E.x[i], z: E.z[i] }; }); })()`;

/** a deck slab over every enemy (5 × 5 tiles), its underside `gap` m above the ground there; the stage is rebuilt so
 *  the renderer draws it. Visual only: the frozen giants were placed before the deck existed. */
const deck = (gap) => `(() => { const pw = window.pokewatch, ctx = pw.ctx, W = ctx.world, M = W.map, R = pw.renderer, E = ctx.enemies;
  if (!M.over) M.over = new Float32Array(W.w * W.h);
  const out = [];
  for (let i = 0; i < E.hi; i++) if (E.alive[i]) { const ti = Math.floor(E.x[i] + W.half), tj = Math.floor(E.z[i] + W.half), g = W.height(E.x[i], E.z[i]);
    for (let dj = -2; dj <= 2; dj++) for (let di = -2; di <= 2; di++) M.over[(tj + dj) * W.w + ti + di] = g + ${gap} + 0.6;
    out.push({ i, ground: g, underside: g + ${gap} }); }
  R.stages.delete(M.id); R.setStage(ctx); return out; })()`;

/** put one giant against the nearest wall tile east of it (the wall to its right on screen) that stands at least 2.5 m
 *  (a tree, a building, or rock with no top), its footprint touching the wall face, and move the partner 4 m south so the classic camera frames both */
const againstWall = (id) => `(() => { const pw = window.pokewatch, ctx = pw.ctx, W = ctx.world, P = ctx.player, R = pw.renderer;
  const S = ctx.speciesIndex.find((s) => s.id === '${id}') ?? null;
  for (let r = 3; r < 40; r++) for (let dz = -r; dz <= r; dz++) {
    const x = Math.floor(P.x) + 0.5 + r, z = Math.floor(P.z) + 0.5 + dz;
    const k = W.tile(x, z); if (k < 0 || W.map.wall[k] !== 1) continue;
    const top = W.wallTopAt(x, z); const gx = x - 0.5 - 0.9; const g = W.height(gx, z); if (!(top >= 2.5)) continue;
    let open = true; for (let t = 1; t <= 4; t++) { const kk = W.tile(x - t, z); if (kk < 0 || W.map.wall[kk] === 1 || Math.abs(W.height(x - t, z) - g) > 0.2) open = false; }
    if (!open) continue;
    const i = pw.spawn('${id}', gx - P.x, z - P.z); const E = ctx.enemies; E.speed[i] = 0; E.hp[i] = E.maxHp[i] = 1e6;
    E.x[i] = E.px[i] = x - 0.5 - E.foot[i] - 0.02;
    P.x = P.px = E.x[i]; P.z = P.pz = z + 2; P.y = P.py = W.height(P.x, P.z); R.snapCamera(ctx);
    return { id: '${id}', wallX: x - 0.5, wallTop: top, z, enemyX: E.x[i], foot: E.foot[i] };
  } return null; })()`;

/** put one giant at the west map edge, its footprint touching the boundary */
const atEdge = (id) => `(() => { const pw = window.pokewatch, ctx = pw.ctx, W = ctx.world, P = ctx.player, R = pw.renderer;
  for (let z = Math.floor(P.z) + 0.5; z < W.half - 4; z += 1) {
    let x = -W.half + 0.5; while (x < 0 && W.map.wall[W.tile(x, z)] === 1) x += 1;
    if (x >= 0) continue; const k = W.tile(x - 1, z);
    const i = pw.spawn('${id}', 0, 0); const E = ctx.enemies; E.speed[i] = 0; E.hp[i] = E.maxHp[i] = 1e6;
    E.x[i] = E.px[i] = x - 0.5 + E.foot[i] + 0.02; E.z[i] = E.pz[i] = z; E.y[i] = E.py[i] = W.height(E.x[i], z);
    P.x = P.px = E.x[i] + 3; P.z = P.pz = z + 2; P.y = P.py = W.height(P.x, P.z); R.snapCamera(ctx);
    return { id: '${id}', edgeX: x - 0.5, mapEdge: -W.half, z, enemyX: E.x[i], foot: E.foot[i], wallTilesWest: Math.round(x - 0.5 + W.half) };
  } return null; })()`;

const scenes = [];
for (const build of ['on', 'off']) {
  scenes.push({ name: `size-giants-${build}`, build, query: Q, steps: [settle, { eval: openSpot() }, { eval: row(GIANTS, 5.5) }, tick, { measure: MEASURE }, { overlay: { face: 0 } }, { shot: 'page' }] });
  scenes.push({ name: `size-ref-${build}`, build, query: Q, steps: [settle, { eval: openSpot() }, { eval: row(REF, 4) }, tick, { overlay: { face: 0 } }, { shot: 'page' }] });
  scenes.push({ name: `size-target-${build}`, build, query: Q, steps: [settle, { eval: openSpot() }, { eval: row(GIANTS, 5.5) }, tick, { overlay: { face: 0, labels: false, marksFrom: `.capture/out/targets-${build}.json` } }, { shot: 'page' }] });
  for (const gap of [2.4, 2.9]) scenes.push({ name: `size-deck-${String(gap).replace('.', '')}-${build}`, build, query: Q, steps: [settle, { eval: openSpot() }, { eval: row(GIANTS, 5.5) }, tick, { eval: deck(gap) }, { advance: 0.1, frames: 6 }, { overlay: { face: 0, labels: false } }, { shot: 'page' }] });
  for (const id of GIANTS) {
    scenes.push({ name: `size-clip-wall-${id}-${build}`, build, query: Q, steps: [settle, { eval: againstWall(id) }, tick, { overlay: { face: 0 } }, { shot: 'page' }] });
    scenes.push({ name: `size-frame-${id}-${build}`, build, query: `go=1&seed=1&species=${id}&calm=1&world=authored&tp=56,56`, steps: [{ advance: 1, frames: 60 }, { eval: openSpot() }, { advance: 2, frames: 120 }, { frame: true }, { overlay: { player: true } }, { shot: 'page' }] });
  }
  for (const id of ['wailord', 'eternatus']) scenes.push({ name: `size-clip-edge-${id}-${build}`, build, query: Q, steps: [settle, { eval: atEdge(id) }, tick, { overlay: { face: 0 } }, { shot: 'page' }] });
}

const OURS = /^size-(giants|ref|clip|deck|target|frame)-/;
const all = JSON.parse(fs.readFileSync(FILE, 'utf8')).filter((s) => !OURS.test(s.name));
fs.writeFileSync(FILE, JSON.stringify([...all, ...scenes], null, 2) + '\n');
console.log(`${scenes.length} S3 scenes -> tools/sizescenes.json (${all.length} others kept)`);
