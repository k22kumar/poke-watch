// S3 giant checks in numbers (docs/size-extremes-plan.md §S3): headroom, targeting and terrain clipping, on the real sim
// and World code, with rules.size.axis and xlContinuous on and off. Read-only: nothing here changes a rule or a file
// outside --out.
//
//   npx tsx scripts/sizegiants.ts --pack .capture/giants/giants.bonkpack.json \
//     --measure-on .capture/out/size-giants-on.json --measure-off .capture/out/size-giants-off.json --out .capture/out
//
// --pack adds capture-only species (Wailord, Eternatus) to this process's SPECIES; they never reach content.
// --measure-* are tools/sizecap.mjs results of the size-giants scenes: the drawn sizes the browser measured from the
// packed atlases (__sizeOverlay.measure), which the clipping and targeting checks need.
import fs from 'node:fs';
import path from 'node:path';
import { defaultRules, type Rules } from '../src/rules/defaults';
import { BIOMES } from '../src/rules/stages';
import { SPECIES, SPECIES_BY_ID, type SpeciesDef } from '../src/rules/species';
import { CATALOGUE_BY_ID } from '../src/rules/catalogue';
import { axisOf } from '../src/rules/shapes';
import { bodyOf, enemyHeight } from '../src/rules/sizing';
import { DECK_SLAB, World } from '../src/sim/world';
import { createRun, startStage } from '../src/sim/run';
import { spawnEnemy } from '../src/sim/enemies';
import { Contacts, SK, spatialQuery, sweep } from '../src/sim/spatial';
import { CHASE_CONFIG, boomElevation, chaseArm, chasePivotH } from '../src/render/camera';
import { PLAY_CLIPS, registerArt, spriteOutline } from './lib/silhouette';

const arg = (k: string) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : undefined; };
const OUT = arg('--out') ?? '.capture/out';
const GIANTS = ['snorlax', 'onix', 'wailord', 'eternatus'];
const REF = 'charmeleon'; // a Medium baseline for the clipping scan

// capture-only species, this process only
const packFile = arg('--pack');
if (packFile) {
  const pack = JSON.parse(fs.readFileSync(packFile, 'utf8'));
  for (const s of pack.species) {
    if (SPECIES_BY_ID[s.id]) continue;
    const shape = CATALOGUE_BY_ID[s.id]?.shape ?? undefined;
    const d = { id: s.id, name: s.name, dex: s.dex, types: s.types, elements: s.elements, stats: s.stats, height: s.height, art: 'pokemon:' + s.id, canon: { ...s.canon, shape, axis: axisOf(s.id, shape) } } as SpeciesDef;
    SPECIES.push(d); SPECIES_BY_ID[d.id] = d;
  }
  // --fixture <out.json>: the camera checks' fixture of the capture-only giants (scripts/lib/giants.ts): their body under
  // the default size rules and the measured outline numbers the framing reads, no art. Written, then the script stops
  const fixtureOut = arg('--fixture');
  if (fixtureOut) {
    registerArt(Object.fromEntries(pack.species.map((sp: { id: string; art: unknown }) => [sp.id, { art: sp.art }])) as never);
    const species: Record<string, unknown> = {};
    for (const sp of pack.species as { id: string }[]) {
      if (CATALOGUE_BY_ID[sp.id] === undefined && !SPECIES_BY_ID[sp.id]) continue;
      const o = spriteOutline(sp.id)!, b = bodyOf(SPECIES_BY_ID[sp.id]);
      const clips = Object.fromEntries(PLAY_CLIPS.map((c) => [c, { overlay: o.clips[c].overlay }]));
      const frames = Object.fromEntries(PLAY_CLIPS.map((c) => [c, o.silhouette.frames[c]]));
      species[sp.id] = { body: { height: b.height, visualM: b.visualM, className: b.className, sizeClass: b.sizeClass }, sprite: { id: sp.id, scale: o.scale, outline: o.outline, clips, silhouette: { frames } } };
    }
    fs.mkdirSync(path.dirname(fixtureOut), { recursive: true });
    fs.writeFileSync(fixtureOut, JSON.stringify({ note: 'measured numbers only, no art: scripts/lib/giants.ts; delete when S2 imports these species', pack: path.basename(packFile), species }) + '\n');
    console.log(`${fixtureOut}: ${Object.keys(species).join(', ')}`);
    process.exit(0);
  }
}
const measure = (f?: string) => {
  if (!f) return {} as Record<string, any>;
  const r = JSON.parse(fs.readFileSync(f, 'utf8')).results as any[];
  return r.find((x) => x && !Array.isArray(x) && x.snorlax) as Record<string, any>;
};
// `tall` = `on` + rules.size.xlTall (the sim height follows the drawn size): it draws exactly as `on` (the renderer reads
// no sim height), so it shares the `on` measurements
const MON = measure(arg('--measure-on'));
const M = { on: MON, off: measure(arg('--measure-off')), tall: MON };
type V = 'off' | 'on' | 'tall';
// every flag explicit: since the size-extremes default flip all three are on by default (`tall` = the defaults)
const RULES: Record<V, Rules> = {
  on: { ...defaultRules, size: { ...defaultRules.size, axis: true, xlContinuous: true, xlTall: false } } as Rules,
  tall: { ...defaultRules, size: { ...defaultRules.size, axis: true, xlContinuous: true, xlTall: true } } as Rules,
  off: { ...defaultRules, size: { ...defaultRules.size, axis: false, xlContinuous: false, xlTall: false } } as Rules,
};
const VS = ['off', 'on', 'tall'] as const;
const f2 = (n: number) => (Number.isFinite(n) ? n.toFixed(2) : String(n));
const pct = (n: number) => `${(n * 100).toFixed(0)}%`;
const out: string[] = [];

// ------------------------------------------------------------------ sizes
out.push('### Sizes (class values, role size 1; drawn = idle reference frame at level view, from the capture build)\n');
out.push('| | flags | class | extent | visual | drawn h × w (front) | widest frame | radius | sim height | footprint |');
out.push('|---|---|---|---:|---:|---:|---:|---:|---:|---:|');
for (const id of GIANTS) for (const v of VS) {
  const b = bodyOf(SPECIES_BY_ID[id], RULES[v].size), m = M[v][id];
  out.push(`| ${SPECIES_BY_ID[id].name} | ${v} | ${b.className.replace('Extra Large', 'XL')} | ${f2(b.extentM)} | ${f2(b.visualM)} | ${m ? `${f2(m.drawnH)} × ${f2(m.drawnW)}` : '?'} | ${m ? `${f2(m.maxWidth)} (${m.maxWidthAt})` : '?'} | ${f2(b.radius)} | ${f2(b.height)} | ${f2(b.body)} |`);
}

// ------------------------------------------------------------------ headroom
/** a flat private world (height 0) with a deck over columns/rows 40..45 whose underside is `gap` m up */
function deckWorld(rules: Rules, gap: number) {
  const W = new World(rules, BIOMES.meadow, 5);
  const n = W.w * W.h, Mp = W.map;
  const map = { ...Mp, terrain: new Uint8Array(n), elev: new Float32Array(n), stairs: new Uint8Array(n), wall: new Uint8Array(n), platform: new Float32Array(n), over: new Float32Array(n), wlevel: undefined };
  Object.assign(W, { map, over: map.over, voids: new Uint8Array(n) });
  for (let j = 40; j < 46; j++) for (let i = 40; i < 46; i++) map.over[j * W.w + i] = gap + DECK_SLAB;
  return { W, x: 43 - W.half, z: 43 - W.half };
}
out.push('\n### Headroom (deck underside 2.4 m and 2.9 m)\n');
out.push('Sim: `World.collides` with the body\'s sim height under the slab (true = cannot stand there). Drawn: the idle frame\'s top above the underside at level view; in play the card is also stretched by the view (classic ×1.47).\n');
out.push('| | flags | sim height | elite ×2 | 2.4 m: sim enters? | 2.4 m: drawn above underside | 2.9 m: sim enters? | 2.9 m: drawn above underside |');
out.push('|---|---|---:|---:|---|---|---|---|');
const headroom: any[] = [];
for (const id of GIANTS) for (const v of VS) {
  const sp = SPECIES_BY_ID[id], h = enemyHeight(sp, 1, RULES[v]), m = M[v][id];
  const cells = [2.4, 2.9].map((gap) => {
    const { W, x, z } = deckWorld(RULES[v], gap);
    const enters = !W.collides(x, z, 0, 0.6, h);
    const above = m ? Math.max(0, m.drawnH - gap) : NaN;
    headroom.push({ id, v, gap, simH: h, enters, drawnH: m?.drawnH, above, share: m ? above / m.drawnH : NaN });
    return `${enters ? 'yes' : '**no**'} | ${m ? `${f2(above)} m (${pct(above / m.drawnH)})` : '?'}`;
  });
  out.push(`| ${sp.name} | ${v} | ${f2(h)} | ${f2(h * 2)} | ${cells.join(' | ')} |`);
}

// ------------------------------------------------------------------ targeting
/** a run on a private flat world with one frozen giant at the centre (as tests/spatial.test.ts `put`) */
function targetScene(id: string, rules: Rules) {
  const ctx = createRun({ seed: 1, species: 'cyndaquil', ruleOverrides: { size: { axis: rules.size.axis, xlContinuous: rules.size.xlContinuous, xlTall: rules.size.xlTall } } });
  const W = new World(ctx.rules, BIOMES.meadow, 5), n = W.w * W.h, Mp = W.map;
  const map = { ...Mp, terrain: new Uint8Array(n), elev: new Float32Array(n), stairs: new Uint8Array(n), wall: new Uint8Array(n), platform: new Float32Array(n), over: new Float32Array(n), wlevel: undefined };
  Object.assign(W, { map, over: map.over, voids: new Uint8Array(n) });
  ctx.world = W; ctx.enemies.clear(); ctx.bodies.clear(); ctx.projectiles.clear();
  ctx.player.x = 0; ctx.player.z = 20; ctx.player.y = 0;
  const E = ctx.enemies, e = spawnEnemy(ctx, id, 0, 0);
  E.x[e] = E.px[e] = 0; E.z[e] = E.pz[e] = 0; E.y[e] = E.py[e] = 0; E.spawnT[e] = 1; E.hp[e] = E.maxHp[e] = 1e6;
  ctx.grid.rebuild(E.hi, E.x, E.z, E.alive);
  return { ctx, e };
}
out.push('\n### Targeting (shots at the drawn sprite)\n');
out.push('A horizontal shot from 10 m in front, through the drawn point, against the sim cylinder (`spatial.sweep`, enemies only). "ray" is a crosshair trace (radius 0); "bolt" a 0.3 m shot. `tall` = `on` + xlTall. Silhouette shares are of the idle frame\'s opaque texels, against the cylinder\'s side view: **height** = above the hurt window; **width** = inside the window\'s height but further than the radius from the centre line; **outside** = their sum.\n');
out.push('| | flags | hurt window | feet 0.15 m | middle | top (95% drawn) | wing (middle, 75% of half-width) | height (above window) | width (beside, within window) | outside |');
out.push('|---|---|---|---|---|---|---|---:|---:|---:|');
const contacts = new Contacts();
const targets: Record<V, Record<string, any[]>> = { on: {}, off: {}, tall: {} };
const silhouette: any[] = [];
for (const id of GIANTS) for (const v of VS) {
  const m = M[v][id]; if (!m) continue;
  const { ctx, e } = targetScene(id, RULES[v]);
  const E = ctx.enemies, tall = E.tall[e], rad = E.radius[e];
  const shot = (y: number, dx: number, r: number) => { sweep(ctx, dx, y, 10, 0, 0, -1, 20, spatialQuery({ mask: SK.enemy, block: 0, actorR: r, actorH: r }), contacts); return contacts.n > 0; };
  const half = Math.min(m.idleLeft, m.idleRight);
  const pts = [
    { label: 'feet', y: 0.15, dx: 0 },
    { label: 'middle', y: m.drawnH / 2, dx: 0 },
    { label: 'top', y: m.drawnH * 0.95, dx: 0 },
    { label: 'wing', y: m.drawnH / 2, dx: half * 0.75 },
  ].map((p) => ({ ...p, ray: shot(p.y, p.dx, 0), bolt: shot(p.y, p.dx, 0.3) }));
  const cell = (p: any) => `${p.ray ? 'hit' : '**miss**'} / ${p.bolt ? 'hit' : '**miss**'} (y ${f2(p.y)}${p.dx ? `, x ${f2(p.dx)}` : ''})`;
  // split from the measured rows at this run's window (rows: [m above the anchor, texels, texels beyond the radius]); the
  // browser measured them against the class radius, which xlTall keeps
  let n = 0, hi = 0, wide = 0;
  for (const [ly, rn, rw] of (m.rows ?? []) as [number, number, number][]) { n += rn; if (ly > tall) hi += rn; else wide += rw; }
  if (!n) throw new Error(`${id} ${v}: the measurement has no rows (re-run the size-giants scenes with tools/sizeoverlay.js)`);
  silhouette.push({ id, v, tall, radius: rad, height: hi / n, width: wide / n, outside: (hi + wide) / n });
  out.push(`| ${SPECIES_BY_ID[id].name} | ${v} | 0–${f2(tall)} m × r ${f2(rad)} | ${pts.map(cell).join(' | ')} | ${pct(hi / n)} | ${pct(wide / n)} | ${pct((hi + wide) / n)} |`);
  // overlay marks drawn at the frame-scaled height (the classic card is stretched; the mark follows the drawn point)
  targets[v][id] = pts.map((p) => ({ label: `${p.label} ${p.ray ? 'hit' : 'miss'}`, hit: p.ray, y: p.y * 1.4658, dx: p.dx }));
}
for (const v of VS) fs.writeFileSync(path.join(OUT, `targets-${v}.json`), JSON.stringify(targets[v]));

// ------------------------------------------------------------------ terrain clipping
/** every map a run plays: the four authored arenas and the four generated regions (Pokémon locations by default) */
function maps(rules: Rules): { name: string; W: World }[] {
  const res: { name: string; W: World }[] = [];
  for (const mode of ['authored', 'generated'] as const) {
    const ctx = createRun({ seed: 1, species: 'cyndaquil', ruleOverrides: { worldgen: { mode }, size: { axis: rules.size.axis, xlContinuous: rules.size.xlContinuous } } as never });
    for (let s = 0; s < 4; s++) { if (s > 0) startStage(ctx, s); res.push({ name: `${mode === 'authored' ? 'arena' : 'gen'}:${ctx.world.map.id}`, W: ctx.world }); }
  }
  return res;
}
interface Clip { n: number; wall: number; wallLen: number; edge: number; rise: number; riseMax: number }
/** For every point of a 0.5 m grid (tile centres, edges and corners) where the body stands clear, and for 4 camera headings, walk the drawn card's width
 *  along the camera's right vector at 0.25 m: how much of it lies inside a wall (rock or a prop below its top), past the
 *  map edge, or over ground more than 0.5 m above the feet (the card's lower edge buried in a rise or cliff). */
function clipScan(W: World, foot: number, h: number, left: number, right: number): Clip {
  const c: Clip = { n: 0, wall: 0, wallLen: 0, edge: 0, rise: 0, riseMax: 0 };
  const heads = [0, Math.PI / 4, Math.PI / 2, (3 * Math.PI) / 4];
  for (let z = -W.half + 1; z < W.half - 1; z += 0.5) for (let x = -W.half + 1; x < W.half - 1; x += 0.5) {
    const k = W.tile(x, z);
    if (k < 0 || W.map.wall[k] === 1 || W.isVoid(k)) continue;
    const g = W.height(x, z);
    if (!W.fits(x, z, g, foot, 0.6, h)) continue;
    for (const a of heads) {
      const rx = Math.cos(a), rz = Math.sin(a);
      let inWall = 0, edge = false, rise = 0;
      for (let t = -left; t <= right + 1e-9; t += 0.25) {
        if (Math.abs(t) <= foot) continue;
        const px = x + rx * t, pz = z + rz * t, kk = W.tile(px, pz);
        if (kk < 0) { edge = true; continue; }
        if (W.map.wall[kk] === 1 && !W.isVoid(kk)) { if (W.wallTopAt(px, pz) > g + 0.3) inWall += 0.25; continue; }
        rise = Math.max(rise, W.height(px, pz, g + 1) - g);
      }
      c.n++;
      if (inWall > 0) { c.wall++; c.wallLen += inWall; }
      if (edge) c.edge++;
      if (rise > 0.5) c.rise++;
      c.riseMax = Math.max(c.riseMax, rise);
    }
  }
  return c;
}
out.push('\n### Terrain clipping (every map a run plays: 4 arenas + 4 generated regions, seed 1)\n');
out.push('Positions where the body stands clear (a 0.5 m grid: tile centres, edges and corners, so a body can stand against a wall) × 4 camera headings. The card spans the front idle frame ("front") or the widest Idle/Walk frame in any direction, centred ("widest"). "in a wall" = some of the card\'s width is inside rock or a prop below its top (mean width inside when it is); "edge" = past the map edge; "cliff" = over ground > 0.5 m above the feet, so its lower edge is buried.\n');
out.push('| | flags | card | card width | in a wall | mean inside | past the edge | cliff (> 0.5 m) | max rise |');
out.push('|---|---|---|---:|---:|---:|---:|---:|---:|');
const clipRows: any[] = [];
for (const v of ['off', 'on'] as const) {
  const ms = maps(RULES[v]);
  for (const id of [REF, ...GIANTS]) {
    const sp = SPECIES_BY_ID[id], b = bodyOf(sp, RULES[v].size), h = enemyHeight(sp, 1, RULES[v]), m = M[v][id]; if (!m) continue;
    for (const [card, L, R] of [['front', m.idleLeft, m.idleRight], ['widest', m.maxWidth / 2, m.maxWidth / 2]] as const) {
      const tot: Clip = { n: 0, wall: 0, wallLen: 0, edge: 0, rise: 0, riseMax: 0 };
      for (const { W } of ms) { const c = clipScan(W, b.body, h, L, R); tot.n += c.n; tot.wall += c.wall; tot.wallLen += c.wallLen; tot.edge += c.edge; tot.rise += c.rise; tot.riseMax = Math.max(tot.riseMax, c.riseMax); }
      clipRows.push({ id, v, card, width: L + R, ...tot });
      out.push(`| ${sp.name} | ${v} | ${card} | ${f2(L + R)} | ${pct(tot.wall / tot.n)} | ${f2(tot.wall ? tot.wallLen / tot.wall : 0)} m | ${pct(tot.edge / tot.n)} | ${pct(tot.rise / tot.n)} | ${f2(tot.riseMax)} m |`);
    }
  }
  if (v === 'off') out.push(`| | | maps: ${ms.map((m) => m.name).join(', ')} | | | | | | |`);
}

// ------------------------------------------------------------------ camera framing (read-only: the rig at 90fc1b7)
out.push('\n### Camera framing as a partner (read-only; the chase rig at `90fc1b7`)\n');
const FR = CHASE_CONFIG.frame, RT = CHASE_CONFIG.reticle, elev0 = boomElevation(0);
out.push(`The rig frames the sprite's measured outline at its drawn scale (render/framing.ts; --measure-* carry the renderer's own \`outline\`). Back distance = ${FR.boom} × ((top + drop) / ${FR.ref})^${FR.exp}, inside ${FR.min}–${FR.max} m; shoulder puts the outline's (right, top) corner ${RT.side}° left of the crosshair, at most ${CHASE_CONFIG.shoulderMax} × back; pivot on the outline's top as drawn (chasePivotH) at the neutral arm elevation ${f2(elev0)}°. Ideal arm on open ground, before any wall or deck pulls it in.\n`);
out.push('| | flags | outline top / drop / right (m) | drawn height | back | shoulder | shoulder capped | pivot | pivot / drawn height |');
out.push('|---|---|---|---:|---:|---:|---|---:|---:|');
const framing: any[] = [];
for (const id of GIANTS) for (const v of ['off', 'on'] as const) {
  const m = M[v][id]; if (!m?.outline) continue;
  const o = m.outline, arm = chaseArm({ outline: o, height: m.height }), drawn = o.top + (o.drop ?? 0);
  const piv = chasePivotH(o.top, arm.back, arm.shoulder, elev0);
  framing.push({ id, v, outline: o, drawn, back: arm.back, shoulder: arm.shoulder, sideCapped: arm.sideCapped, pivot: piv });
  out.push(`| ${SPECIES_BY_ID[id].name} | ${v} | ${f2(o.top)} / ${f2(o.drop ?? 0)} / ${f2(o.right)} | ${f2(drawn)} | ${f2(arm.back)}${arm.back >= FR.max - 1e-9 ? ' (max)' : ''} | ${f2(arm.shoulder)} | ${arm.sideCapped ? 'yes' : 'no'} | ${f2(piv)} | ${pct(piv / drawn)} |`);
}

fs.writeFileSync(path.join(OUT, 'sizegiants.json'), JSON.stringify({ headroom, silhouette, clipRows, framing }, null, 1));
console.log(out.join('\n'));
