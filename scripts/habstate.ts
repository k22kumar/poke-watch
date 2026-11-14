// Environment-state transitions on the habitat maps, exercised through the real sim (docs/HABITAT_STATES.md):
//   npx tsx scripts/habstate.ts [crater|gorge|all] [seed]
// Each check is tagged `static` (derived from the map or a rule, no sim steps) or `live` (the actual simulation is stepped
// through the transition with real actors). tests/habstate.test.ts runs the same checks and asserts every one passes.
//
// Cinder Crater (volcanic-ridge): the vent cycle is the only state that changes during play (a pure function of the
//   sim tick). Checks: timeline, footprint, late entry and early exit, escape from the deepest tile at the slowest speed,
//   a raider caught in the field, the Hold through eruptions, the raid's flow field, immunities.
// Shrine Gorge (river-gorge): the river is liquid at load, and Cold freezes it, Heat or time thaws it, in the same match.
//   Checks: an actor on the ice and one at the seam when it opens (by time and by Heat), the crack cue, upper-reach ice,
//   every water tile's shore, many occupants at once, spawns and support when the whole river is frozen.
// Both: the props can burn or break in the same match; the run is repeated with the cover stripped (to the sim's loss cap).
import { createRun, step } from '../src/sim/run';
import { startObjective } from '../src/sim/objectives';
import { applyAgent } from '../src/sim/cells';
import { spawnEnemy } from '../src/sim/enemies';
import { forceOnProp } from '../src/sim/props';
import { ventPhase, ventTick } from '../src/sim/hazards';
import { ROLE } from '../src/sim/pools';
import { SPECIES } from '../src/rules/species';
import { NO_INPUT, type SimContext, type SimEvent } from '../src/sim/types';
import { generateHabitat, profilesFor } from '../src/world/habitat';
import { clearance } from '../src/world/habitat/validate';
import { pathBetween } from '../src/world/locgen/nav';
import { ICE_LIFT, T } from '../src/world/tiles';
import { playHabitat } from './habplay';

export interface Check { id: string; recipe: 'volcanic-ridge' | 'river-gorge'; coverage: 'static' | 'live'; transition: string; ok: boolean; detail: string }

type Hit = Extract<SimEvent, { t: 'hazardHit' }> & { step: number };
const N4: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]];

export function mk(recipe: string, seed: number, species = 'totodile'): SimContext {
  return createRun({ seed: 1, species, ruleOverrides: { worldgen: { mode: 'generated', regionSeed: seed, locations: { meadow: recipe, dusk: recipe, badlands: recipe, frost: recipe } }, objectives: { firstAfter: 1e9, secondAfter: 1e9 }, director: { spawnBase: -99 } } as never });
}
const centre = (ctx: SimContext, k: number): [number, number] => [(k % ctx.world.w) - ctx.world.half + 0.5, ((k / ctx.world.w) | 0) - ctx.world.half + 0.5];
const place = (ctx: SimContext, k: number) => { const P = ctx.player, [x, z] = centre(ctx, k); P.x = x; P.z = z; P.y = ctx.world.height(x, z); P.vx = P.vz = P.kx = P.kz = 0; P.vy = 0; P.grounded = true; };
/** the sim step the run is on: whole steps of stage time */
const stepNo = (ctx: SimContext) => Math.round(ctx.stageTime * ctx.rules.sim.hz);
const cyc = (ctx: SimContext) => stepNo(ctx) % Math.round(ctx.rules.habitat.vent.period * ctx.rules.sim.hz);
const ONSET = (ctx: SimContext) => Math.round((ctx.rules.habitat.vent.period - ctx.rules.habitat.vent.active) * ctx.rules.sim.hz);
const PERIOD = (ctx: SimContext) => Math.round(ctx.rules.habitat.vent.period * ctx.rules.sim.hz);

/** collect the environment hits of every step from now on */
function watch(ctx: SimContext): Hit[] {
  const hits: Hit[] = [];
  ctx.hooks.onTick.push((c) => { for (const e of c.events) if (e.t === 'hazardHit') hits.push({ ...e, step: stepNo(c) }); });
  return hits;
}
/** step with no input until the vent cycle is at `at` (the next time it is) */
function until(ctx: SimContext, at: number) { for (let i = 0; i < 2 * PERIOD(ctx) && cyc(ctx) !== at; i++) step(ctx, NO_INPUT); }
/** steer the trainer at (x, z); true when within `r` */
function steer(ctx: SimContext, x: number, z: number, r = 0.25): boolean {
  const dx = x - ctx.player.x, dz = z - ctx.player.z, L = Math.hypot(dx, dz);
  step(ctx, L > r ? { ...NO_INPUT, mx: dx / L, mz: dz / L } : NO_INPUT);
  return L <= r;
}
const ok = (v: boolean) => (v ? 'ok' : 'FAIL');

// ---- the vent field: its tiles, how far each is from safe ground, the ring around it ---------------------------------
interface Field { tiles: number[]; set: Set<number>; d: Map<number, number>; edgeIn: number; exit: number; deep: number; ring: number[] }
export function fieldOf(ctx: SimContext): Field {
  const W = ctx.world, H = W.hab!, n = W.w, set = new Set(H.hazard), d = new Map<number, number>(), Q: number[] = [];
  const near = (k: number, f: (b: number) => void) => { const x = k % n, y = (k / n) | 0; for (const [dx, dy] of N4) { const a = x + dx, b = y + dy; if (a >= 0 && b >= 0 && a < n && b < W.h) f(b * n + a); } };
  for (let k = 0; k < n * W.h; k++) if (W.isOpen(k) && !set.has(k)) { let adj = false; near(k, (b) => { if (set.has(b)) adj = true; }); if (adj) { d.set(k, 0); Q.push(k); } }
  for (let h = 0; h < Q.length; h++) near(Q[h], (b) => { if (set.has(b) && !d.has(b) && Math.abs(W.topOf(b) - W.topOf(Q[h])) <= 0.6) { d.set(b, d.get(Q[h])! + 1); Q.push(b); } });
  const tiles = [...set].filter((k) => d.has(k)).sort((a, b) => a - b);
  const edge = tiles.find((k) => d.get(k) === 1)!, deep = tiles.reduce((b, k) => (d.get(k)! > d.get(b)! ? k : b), tiles[0]);
  let exit = -1; near(edge, (b) => { if (d.get(b) === 0 && exit < 0) exit = b; });
  const ring: number[] = [];
  for (let k = 0; k < n * W.h; k++) {
    if (set.has(k) || !W.isOpen(k)) continue;
    const x = k % n, y = (k / n) | 0;
    if (tiles.some((t) => Math.max(Math.abs((t % n) - x), Math.abs(((t / n) | 0) - y)) <= 3)) ring.push(k);
  }
  return { tiles, set, d, edgeIn: edge, exit, deep, ring };
}

/** the slowest speed (m/s) any playable Pokémon walks at on this map */
function slowest(recipe: string, seed: number): { id: string; speed: number } {
  let best = { id: '', speed: Infinity };
  for (const s of SPECIES.filter((x) => x.playable)) { const sp = mk(recipe, seed, s.id).player.derived.speed; if (sp < best.speed) best = { id: s.id, speed: sp }; }
  return best;
}

/** burn and break every material prop through the sim's own rule (cover stops at the loss cap), then settle; how many went */
export function stripProps(ctx: SimContext): number {
  const W = ctx.world, F = W.propField;
  if (!F) return 0;
  for (let k = 0; k < W.w * W.h; k++) if (F.at[k] >= 0) forceOnProp(ctx, k, 9, 1e6, 'stone');
  for (let i = 0; i < 120; i++) step(ctx, NO_INPUT);
  return F.burnt + F.broken;
}
const freezeAll = (ctx: SimContext) => { const W = ctx.world; for (let k = 0; k < W.w * W.h; k++) if (W.map.terrain[k] === T.water) { const [x, z] = centre(ctx, k); applyAgent(ctx, 'cold', x, z, 0.5); } };

// =====================================================================================================================
// Cinder Crater
// =====================================================================================================================
export function craterChecks(seed: number): Check[] {
  const out: Check[] = [];
  const add = (id: string, coverage: Check['coverage'], transition: string, pass: boolean, detail: string) => out.push({ id, recipe: 'volcanic-ridge', coverage, transition, ok: pass, detail });
  const base = mk('volcanic-ridge', seed), H = base.world.hab!, hz = base.rules.sim.hz;
  const V = base.rules.habitat.vent;
  if (!H.hazard.length) {
    // the optional vent branch is a chance per seed: without it nothing on this map changes state but the props
    add('crater.no-field', 'static', 'seed without a vent branch', !base.world.hazard, `seed ${seed} has no vent field: the hazard system does nothing, the vent cycle is never read`);
    return out;
  }
  const F = fieldOf(base);

  // ---- static: what the map guarantees about the field ----
  const m = generateHabitat({ recipe: 'volcanic-ridge', seed, variant: '' }), HM = m.gen!.hab!, cl = clearance(m), n = m.w * m.h;
  const c = Math.floor(HM.contest.y) * m.w + Math.floor(HM.contest.x);
  const margins: string[] = []; let minMargin = Infinity;
  for (const p of profilesFor().filter((x) => x.essential)) {
    let best = -1;
    for (const margin of [0, 1, 2, 3, 4, 6, 8]) {
      let all = true;
      for (const team of ['A', 'B'] as const) {
        const allow = new Uint8Array(cl.length);
        for (let v = 0; v < cl.length; v++) { const k = v % n, x = k % m.w, y = (k / m.w) | 0; allow[v] = cl[v] >= p.radius && HM.hazard.every((h) => Math.hypot((h % m.w) - x, ((h / m.w) | 0) - y) > margin) ? 1 : 0; }
        const s = Math.floor(HM.stage[team][1]) * m.w + Math.floor(HM.stage[team][0]);
        if (!pathBetween(m, s, c, allow) || !pathBetween(m, c, s, allow)) all = false;
      }
      if (all) best = margin; else break;
    }
    margins.push(`${p.id} (r ${p.radius}) ${best >= 8 ? '≥ 8' : best} tiles`); minMargin = Math.min(minMargin, best);
  }
  const g = (id: string) => HM.gates.find((x) => x.id === id);
  add('static.required-travel-clear', 'static', 'vent field vs required travel', minMargin >= 4 && !!g('hazardExit')?.ok && !!g('reach:venting')?.ok && !!g('independent:venting')?.ok,
    `both stagings reach the Hold and return with every vent tile ≥ ${minMargin >= 8 ? 8 : minMargin} tiles from the route centre line, per body: ${margins.join('; ')}; gates hazardExit (${g('hazardExit')?.value}), reach:venting, independent:venting`);
  {
    const M = base.world.map, rock = H.hazard.filter((k) => M.wall[k]).length;
    add('static.field-on-ground', 'static', 'vent field footprint', H.hazard.every((k) => !(M.over && M.over[k] > 0)) && H.hazard.every((k) => M.terrain[k] !== T.water) && F.tiles.length > 0 && F.tiles.every((k) => F.d.get(k)! <= 4),
      `${H.hazard.length} vent tiles: none under a deck (a deck above the field is a different layer: 3D contact), none in lava; ${rock} lie in rock a prop left standing (nothing can stand there); the ${F.tiles.length} standable ones are at most ${Math.max(...F.tiles.map((k) => F.d.get(k)!))} tile(s) from safe ground (bound 4), warning ${V.warn} s`);
  }

  // ---- live: timeline (player on the boundary, a raider deeper in) ----
  {
    const ctx = mk('volcanic-ridge', seed), f = fieldOf(ctx), hits = watch(ctx), E = ctx.enemies;
    place(ctx, f.edgeIn);
    const [rx, rz] = centre(ctx, f.deep), r = spawnEnemy(ctx, 'rattata', rx, rz, ROLE.raider);
    const first: Record<string, number> = {};
    for (let i = 0; i < 2 * PERIOD(ctx) + 30; i++) {
      E.stun[r] = 9; E.x[r] = rx; E.z[r] = rz; ctx.player.x = centre(ctx, f.edgeIn)[0]; ctx.player.z = centre(ctx, f.edgeIn)[1];
      step(ctx, NO_INPUT);
      first[ventPhase(ctx)] ??= stepNo(ctx);
      if (!E.alive[r]) break;
    }
    const at = (w: 'player' | 'enemy') => hits.filter((h) => h.kind === 'vent' && h.who === w).map((h) => h.step % PERIOD(ctx));
    const want = [0, 1, 2, 3, 4].map((i) => ONSET(ctx) + i * Math.round(V.tick * hz));
    const cycles = (h: Hit[]) => new Set(h.map((x) => Math.floor(x.step / PERIOD(ctx)))).size;
    const pa = at('player'), ea = at('enemy');
    const sec = (s: number) => (s / hz).toFixed(2);
    const frac = (w: 'player' | 'enemy') => hits.filter((h) => h.who === w).every((h) => Math.abs(h.amount - (w === 'player' ? ctx.player.maxHp : E.maxHp[r]) * V.pct) < 1e-3);
    const same = (a: number[], b: number[]) => JSON.stringify(a) === JSON.stringify(b);
    add('crater.timeline', 'live', 'dormant → warn → active → dormant, twice', first.warn === Math.round((V.period - V.active - V.warn) * hz) && first.active === ONSET(ctx)
      && same(pa, [...want, ...want]) && same(ea, [...want, ...want]) && frac('player') && frac('enemy'),
    `warn from ${sec(first.warn)} s (${V.warn} s), erupts ${sec(first.active)} s (${V.active} s), quiet ${sec(first.active + Math.round(V.active * hz))} s; the trainer on the boundary took ${pa.length} hits in ${cycles(hits.filter((h) => h.who === 'player'))} eruptions at ${pa.slice(0, 5).map(sec).join(' ')} s (every ${V.tick} s from the onset step), the raider ${ea.length} at the same steps; each ${(V.pct * 100).toFixed(0)} % of that actor's maximum HP; none while dormant or warning`);
  }

  // ---- live: footprint: probes on every vent tile and the ring of open tiles around it ----
  {
    const ctx = mk('volcanic-ridge', seed), f = fieldOf(ctx), hits = watch(ctx), E = ctx.enemies;
    place(ctx, f.exit); // the trainer beside the field: creatures further than the despawn distance from it relocate
    const tiles = [...f.tiles, ...f.ring], pr = tiles.map((k) => { const [x, z] = centre(ctx, k); return [spawnEnemy(ctx, 'rattata', x, z, ROLE.raider), x, z, k] as const; });
    const placed = pr.filter(([i]) => i >= 0);
    for (let i = 0; i < 30; i++) step(ctx, NO_INPUT); // the spawn grace
    const steam = { warnIn: 0, warnOut: 0, actIn: 0, actOut: 0 };
    const bbox = new Set([...f.tiles, ...f.ring]);
    for (let i = 0; i < PERIOD(ctx); i++) {
      for (const [e, x, z] of placed) { E.stun[e] = 9; E.x[e] = x; E.z[e] = z; }
      ctx.player.iframes = 1; step(ctx, NO_INPUT);
      if (i % 5 === 0) { const ph = ventPhase(ctx); if (ph !== 'dormant') for (const k of bbox) if (ctx.world.cells.steam[k] > 0.1) { if (f.set.has(k)) (ph === 'warn' ? steam.warnIn++ : steam.actIn++); else (ph === 'warn' ? steam.warnOut++ : steam.actOut++); } }
    }
    const per = new Map<number, number>(); for (const h of hits) per.set(h.id, (per.get(h.id) ?? 0) + 1);
    const inHits = placed.filter(([, , , k]) => f.set.has(k)).map(([e]) => per.get(e) ?? 0), outHits = placed.filter(([, , , k]) => !f.set.has(k)).map(([e]) => per.get(e) ?? 0);
    add('crater.footprint', 'live', 'damage and steam footprint', placed.length === tiles.length && inHits.every((v) => v === 5) && outHits.every((v) => v === 0) && steam.warnOut === 0 && steam.actOut === 0 && steam.actIn > 0 && steam.warnIn > 0,
      `${inHits.length} vent tiles each took ${[...new Set(inHits)].join('/')} hits in one eruption; ${outHits.length} open tiles within 3 tiles outside took ${[...new Set(outHits)].join('/')}; steam seen only on vent tiles (warning shows a third of them, the eruption all of them), ${steam.warnOut + steam.actOut} samples outside`);
  }

  // ---- live: late entry and early exit by real walking ----
  {
    const rows: string[] = []; let all = true;
    const cases: [number, number][] = [[-60, 175], [-12, 175], [-6, 175], [-3, 175], [0, 175], [10, 175], [40, 175], [-60, -20], [-60, -3], [-60, 0], [-60, 3], [-60, 35]];
    for (const [enter, leave] of cases) {
      const ctx = mk('volcanic-ridge', seed), f = fieldOf(ctx), hits = watch(ctx), [ex, ez] = centre(ctx, f.exit), [ix, iz] = centre(ctx, f.edgeIn);
      place(ctx, f.exit); until(ctx, ONSET(ctx) + enter < 0 ? PERIOD(ctx) + ONSET(ctx) + enter : ONSET(ctx) + enter);
      const t0 = stepNo(ctx) - cyc(ctx) + ONSET(ctx), inAt: number[] = [], outAt: number[] = [];
      let was = false;
      for (let i = 0; i < 400 && stepNo(ctx) < t0 + 200; i++) {
        const rel = stepNo(ctx) - t0, goingIn = rel < leave;
        if (goingIn) steer(ctx, ix, iz, 0.15); else steer(ctx, ex, ez, 0.15);
        const now = ctx.world.hazardAt(ctx.player.x, ctx.player.z);
        if (now && !was) inAt.push(stepNo(ctx)); if (!now && was) outAt.push(stepNo(ctx));
        was = now;
      }
      const ticks = [0, 1, 2, 3, 4].map((i) => t0 + i * Math.round(V.tick * hz));
      const mine = hits.filter((h) => h.who === 'player').map((h) => h.step);
      const want = ticks.filter((s) => inAt.some((a, q) => a <= s && s < (outAt[q] ?? Infinity)));
      const pass = JSON.stringify(mine) === JSON.stringify(want) && inAt.length >= 1;
      all &&= pass;
      rows.push(`enter ${(((inAt[0] ?? 0) - t0) / hz).toFixed(2)}s${outAt.length ? `, leave ${(((outAt[0] ?? 0) - t0) / hz).toFixed(2)}s` : ''} → ${mine.length} hit${mine.length === 1 ? '' : 's'}`);
    }
    add('crater.late-entry', 'live', 'actor walks in just before / after the eruption, or out just before it', all, `times relative to the eruption; hits = the damage ticks between entering and leaving, no grace and no skipped tick: ${rows.join(' | ')}`);
  }

  // ---- live: escape from the deepest tile when the warning starts, at the slowest speed ----
  {
    const sl = slowest('volcanic-ridge', seed), ctx = mk('volcanic-ridge', seed, sl.id), f = fieldOf(ctx), hits = watch(ctx), W = ctx.world;
    place(ctx, f.deep); until(ctx, PERIOD(ctx) - Math.round((V.warn + V.active) * hz));
    const t0 = stepNo(ctx);
    // walk the way out: toward the tile with the smaller distance to safe ground, then onto the exit
    let k = f.deep, outAt = -1;
    for (let i = 0; i < 300 && outAt < 0; i++) {
      const dk = f.d.get(k) ?? 0;
      if (dk > 0) { let best = k, bd = dk; for (const [dx, dy] of N4) { const q = k + dy * W.w + dx; if (f.d.has(q) && f.d.get(q)! < bd) { bd = f.d.get(q)!; best = q; } } const [x, z] = centre(ctx, best); if (steer(ctx, x, z, 0.3)) k = best; } else steer(ctx, ...centre(ctx, k));
      if (!W.hazardAt(ctx.player.x, ctx.player.z)) outAt = stepNo(ctx);
    }
    for (let i = 0; i < PERIOD(ctx); i++) { if (dkOk(f, k)) steer(ctx, ...centre(ctx, k)); step(ctx, NO_INPUT); }
    const took = (outAt - t0) / hz;
    add('crater.escape', 'live', 'warning starts with the actor in the deepest vent tile', outAt > 0 && took < V.warn && hits.length === 0,
      `slowest playable (${sl.id}, ${sl.speed.toFixed(1)} m/s) from ${F.d.get(F.deep)} tile(s) deep is out ${took.toFixed(2)} s after the steam starts, ${(V.warn - took).toFixed(2)} s before the eruption; ${hits.length} hits`);
  }
  function dkOk(f: Field, k: number) { return f.d.get(k) === 0; }

  // ---- live: a raider caught in the field with the Hold active walks its flow field out ----
  {
    // spawned at the start of the warning (it has the whole warning to leave) and 20 steps before the eruption (its spawn
    // grace ends 5 steps before it: it is in the field when the first tick lands)
    const run = (spawnAt: number) => {
      const ctx = mk('volcanic-ridge', seed), f = fieldOf(ctx), hits = watch(ctx), W = ctx.world, P = ctx.player, E = ctx.enemies, HH = W.hab!;
      const [cx, cz] = [HH.contest.x - W.half, HH.contest.y - W.half];
      P.x = cx; P.z = cz; P.y = W.height(cx, cz);
      startObjective(ctx, 'hold');
      for (let i = 0; i < 600 && ctx.objective!.phase === 'offer'; i++) { P.iframes = 1; P.hp = P.maxHp; step(ctx, NO_INPUT); }
      for (let e = 0; e < E.hi; e++) if (E.alive[e]) E.kill(e); // the raid party is somewhere else; this test is about one raider
      until(ctx, spawnAt);
      const [rx, rz] = centre(ctx, f.deep), r = spawnEnemy(ctx, 'rattata', rx, rz, ROLE.raider), t0 = stepNo(ctx);
      let outAt = -1;
      for (let i = 0; i < 20 * hz && E.alive[r]; i++) { P.iframes = 1; P.hp = P.maxHp; step(ctx, NO_INPUT); if (outAt < 0 && !W.hazardAt(E.x[r], E.z[r])) outAt = stepNo(ctx); }
      return { out: (outAt - t0) / hz, ticks: hits.filter((h) => h.who === 'enemy' && h.id === r).length, closer: Math.hypot(rx - cx, rz - cz) - Math.hypot(E.x[r] - cx, E.z[r] - cz), alive: !!E.alive[r], f };
    };
    const early = run(PERIOD(base) - Math.round((V.warn + V.active) * hz)), late = run(ONSET(base) - 20);
    add('crater.raider-in-field', 'live', 'raider inside the field, Hold active, eruption follows', early.out >= 0 && early.ticks === 0 && late.out >= 0 && late.ticks >= 1 && late.ticks <= V.active / V.tick && early.alive && late.alive && early.closer > 5 && late.closer > 5,
      `a raider put in the deepest vent tile (${F.d.get(F.deep)} deep) with the Hold active follows the contest's flow field out: spawned at the start of the warning it is out in ${early.out.toFixed(2)} s and takes ${early.ticks} ticks; spawned 20 steps (0.33 s) before the eruption it is out in ${late.out.toFixed(2)} s and takes ${late.ticks} of the ${V.active / V.tick} ticks (${(late.ticks * V.pct * 100).toFixed(0)} % of its HP); both are ${early.closer.toFixed(0)} / ${late.closer.toFixed(0)} m closer to the point after 20 s`);
  }

  // ---- live: immunities and the 3D contact rule ----
  {
    const run = (setup: (c: SimContext) => void, species = 'totodile') => { const c = mk('volcanic-ridge', seed, species), ff = fieldOf(c), h = watch(c); place(c, ff.edgeIn); setup(c); until(c, ONSET(c) - 1); for (let i = 0; i < 3; i++) { setup(c); step(c, NO_INPUT); } return h.filter((x) => x.who === 'player').length; };
    const ground = run(() => {}), air = run((c) => { c.player.y = c.world.height(c.player.x, c.player.z) + 1.2; c.player.vy = 0; }), dash = run((c) => { c.player.dashT = 0.5; c.player.dashDx = 0; c.player.dashDz = 0; }),
      hitFrames = run((c) => { c.player.iframes = 1; }), fire = run(() => {}, 'cyndaquil');
    add('crater.contact', 'live', 'who the eruption reaches', ground === 1 && air === 0 && dash === 0 && hitFrames === 1 && fire === 0,
      `on the ground ${ground} hit at the onset; 1.2 m up ${air}; dashing ${dash} (dash i-frames); hit i-frames still hurt (${hitFrames}), they no longer swallow ticks; a Fire type ${fire} (as for a burning tile)`);
  }

  // ---- live: the Hold through eruptions, and the raid's routes ----
  {
    const rs = playHabitat('volcanic-ridge', seed, { raid: true, route: 'both' });
    add('crater.hold-through-eruptions', 'live', 'spawn → Hold → retreat with the vents cycling (both approaches, Raid party live)', rs.every((r) => r.reach !== null && r.back !== null && r.raidAt !== null && r.trainerHits === 0 && r.raiderHits === 0 && r.ventSeconds > 5),
      rs.map((r) => `${r.route}: reach ${r.reach?.toFixed(1)} s, back ${r.back?.toFixed(1)} s, raiders on the point ${r.raidAt} s, ${r.trainerHits} vent hits to the trainer and ${r.raiderHits} to a raider on its way to the Hold (${r.hazardHits - r.trainerHits - r.raiderHits} to creatures that chose to cross after the trainer) over ${r.ventSeconds.toFixed(0)} s of eruption`).join('; ') + ' (the trainer is invulnerable and the raiders drain the Hold in this mode, so it is not held)');
    const geo = playHabitat('volcanic-ridge', seed, { route: 'both' });
    add('crater.hold-geometry', 'live', 'the same with nothing else on the map', geo.every((r) => r.reach !== null && r.held && r.back !== null && r.trainerHits === 0),
      geo.map((r) => `${r.route}: held ${r.holdT} s, trainer damage from all sources ${r.dmg.toFixed(0)}, environment hits on the trainer ${r.trainerHits}`).join('; '));
    const W = base.world, cX = HM.contest.x - W.half, cZ = HM.contest.y - W.half, trace = (team: 'A' | 'B') => {
      let x = HM.stage[team][0] - W.half, z = HM.stage[team][1] - W.half, y = W.height(x, z), touched = 0; const dir: [number, number] = [0, 0];
      for (let i = 0; i < 1200; i++) { if (W.hazardAt(x, z)) touched++; if (!W.goalDir(x, z, dir, y)) break; x += dir[0] * 0.5; z += dir[1] * 0.5; y = W.height(x, z, y); }
      return { touched, ended: Math.hypot(x - cX, z - cZ) < HM.contest.r + 1.5 };
    };
    const a = trace('A'), b = trace('B');
    // every open tile outside the field as a start (a raider can be displaced, or relocate, anywhere), and every vent tile
    let starts = 0, crossing = 0, stuckInside = 0, inside = 0; const dir: [number, number] = [0, 0];
    for (let k = 0; k < W.w * W.h; k++) {
      if (!W.isOpen(k) || (k % 2 && !F.set.has(k))) continue;
      const isIn = F.set.has(k); if (isIn) inside++; else starts++;
      let x = (k % W.w) - W.half + 0.5, z = ((k / W.w) | 0) - W.half + 0.5, y = W.height(x, z), left = !isIn, crossed = false;
      for (let i = 0; i < 900; i++) {
        if (!W.goalDir(x, z, dir, y)) break;
        x += dir[0] * 0.5; z += dir[1] * 0.5; y = W.height(x, z, y);
        if (W.hazardAt(x, z)) { if (left) { crossed = true; break; } } else left = true;
      }
      if (crossed) crossing++; else if (isIn && !left) stuckInside++;
    }
    add('crater.flow-field', 'live', 'path updates: the raid flow field never routes through the field', a.ended && b.ended && a.touched === 0 && b.touched === 0 && crossing === 0 && stuckInside === 0,
      `trace from staging A and B to the point ends at it (${a.ended}/${b.ended}) crossing ${a.touched}/${b.touched} vent tiles; from ${starts} open tiles outside the field (every second one) ${crossing} routes enter it, and from all ${inside} standable vent tiles ${stuckInside} fail to walk out. The flow field is built once, steers round the field whatever the phase (it is not rebuilt by the vent cycle, so there is no path update to miss), and values the field above any way round`);
  }
  return out;
}

// =====================================================================================================================
// Shrine Gorge
// =====================================================================================================================
/** a frozen-able water tile with dry open ground beside it at about its own level */
function seamTile(ctx: SimContext, upper: boolean): { w: number; b: number } | null {
  const W = ctx.world, M = W.map, n = W.w;
  for (let k = 0; k < n * W.h; k++) {
    if (M.terrain[k] !== T.water || !M.wlevel || (M.wlevel[k] > 0) !== upper || W.cells.iceAt(k)) continue;
    for (const [dx, dy] of N4) {
      const x = (k % n) + dx, y = ((k / n) | 0) + dy; if (x < 0 || y < 0 || x >= n || y >= W.h) continue;
      const b = y * n + x;
      if (!W.isOpen(b) || M.terrain[b] === T.water || Math.abs(W.topOf(b) - (M.wlevel[k] + ICE_LIFT)) > 0.3) continue;
      // room beyond the bank tile, so there is somewhere to walk on to
      let onward = 0; for (const [ex, ey] of N4) { const q = (y + ey) * n + x + ex; if (q !== k && W.isOpen(q) && M.terrain[q] !== T.water && Math.abs(W.topOf(q) - W.topOf(b)) <= 0.6) onward++; }
      if (onward >= 2) return { w: k, b };
    }
  }
  return null;
}

export function gorgeChecks(seed: number): Check[] {
  const out: Check[] = [];
  const add = (id: string, coverage: Check['coverage'], transition: string, pass: boolean, detail: string) => out.push({ id, recipe: 'river-gorge', coverage, transition, ok: pass, detail });
  const I = mk('river-gorge', seed).rules.habitat.ice, hz = 60;

  // ---- static: every water tile has a shore, and the whole river frozen leaves spawn, support and routes intact ----
  {
    const ctx = mk('river-gorge', seed), W = ctx.world, M = W.map, n = W.w;
    let tiles = 0, none = 0, otherLevel = 0, far = 0, maxD = 0;
    for (let k = 0; k < n * W.h; k++) {
      if (M.terrain[k] !== T.water) continue;
      tiles++;
      const [x, z] = centre(ctx, k), lvl = (M.wlevel ? M.wlevel[k] : -0.25) + ICE_LIFT;
      for (const r of [ctx.rules.player.radius, 1.42]) {
        const s = W.shore(x, z, r, lvl);
        if (!s) { none++; continue; }
        const sk = W.tile(s[0], s[1]); maxD = Math.max(maxD, Math.hypot(s[0] - x, s[1] - z));
        if (M.terrain[sk] === T.water || !W.isOpen(sk) || W.cells.iceAt(sk)) far++;
        if (Math.abs(W.height(s[0], s[1]) - lvl) > 1.5) otherLevel++;
      }
    }
    add('gorge.shore-everywhere', 'static', 'every water tile that can freeze', tiles > 0 && none === 0 && far === 0,
      `${tiles} water tiles, each with a dry open shore for the trainer (r ${ctx.rules.player.radius}) and the largest wild body (r 1.42): ${none} without one, ${far} landing on water or ice, farthest ${maxD.toFixed(1)} m; ${otherLevel} shore lookups can only be satisfied on another level (none on the upper reach)`);
  }
  {
    const ctx = mk('river-gorge', seed), W = ctx.world, H = W.hab!, M = W.map;
    const stg = (t: 'A' | 'B') => W.tile(H.stage[t][0] - W.half, H.stage[t][1] - W.half);
    const here = { spawn: W.tile(ctx.player.x, ctx.player.z), A: stg('A'), B: stg('B'), contest: W.tile(H.contest.x - W.half, H.contest.y - W.half) };
    const dry = (k: number) => M.terrain[k] !== T.water && W.isOpen(k) && !W.cells.iceAt(k);
    const reach0 = W.reachableCount(ctx.player.x, ctx.player.z);
    freezeAll(ctx);
    const iced = [...Array(W.w * W.h).keys()].filter((k) => W.cells.iceAt(k)).length, water = [...Array(W.w * W.h).keys()].filter((k) => M.terrain[k] === T.water).length;
    for (let i = 0; i < 12; i++) step(ctx, NO_INPUT); // nav refresh
    const reach1 = W.reachableCount(ctx.player.x, ctx.player.z), out: [number, number] = [0, 0];
    const gd = W.goalDir(H.stage.B[0] - W.half, H.stage.B[1] - W.half, out);
    const sup = (['spawn', 'A', 'B', 'contest'] as const).every((s) => dry(here[s]) && !W.blocks(...centre(ctx, here[s]), W.topOf(here[s]), 0.6));
    const spawnIce = ctx.world.cells.iceAt(here.spawn);
    add('gorge.frozen-at-load', 'static', 'river frozen when the match starts (an extreme the cell rules allow)', iced === water && sup && !spawnIce && reach1 >= reach0 && gd,
      `all ${iced}/${water} water tiles frozen: spawn, both stagings and the contest are dry, open and unblocked on their own ground (no spawn on the ice); walkable area from the spawn ${reach0} → ${reach1} tiles (ice only adds); the raid's goal flow from staging B exists (${gd}); the essential routes never needed ice (gate reach:frozen)`);
  }

  // ---- live: an actor on the ice when it opens, by time and by Heat ----
  const iceCase = (upper: boolean, who: 'player' | 'raider', how: 'timer' | 'heat', refreeze = false) => {
    const ctx = mk('river-gorge', seed), W = ctx.world, P = ctx.player, E = ctx.enemies, hits = watch(ctx), s = seamTile(ctx, upper);
    if (!s) return null;
    const [wx, wz] = centre(ctx, s.w), [bx, bz] = centre(ctx, s.b), events: { step: number; change: string }[] = [];
    ctx.hooks.onTick.push((c) => { for (const e of c.events) if (e.t === 'cell' && e.k === s.w) events.push({ step: stepNo(c), change: e.change }); });
    let r = -1;
    if (who === 'player') { P.x = bx; P.z = bz; P.y = W.height(bx, bz); } else { P.x = bx + 8; P.z = bz + 8; r = spawnEnemy(ctx, 'rattata', bx, bz, ROLE.raider); for (let i = 0; i < 20; i++) { E.stun[r] = 9; step(ctx, NO_INPUT); } }
    applyAgent(ctx, 'cold', wx, wz, 0.5);
    const iced = W.cells.iceAt(s.w), top = W.height(wx, wz);
    if (who === 'player') { for (let i = 0; i < 40 && !(W.tile(P.x, P.z) === s.w); i++) steer(ctx, wx, wz, 0.1); } else { E.x[r] = wx; E.z[r] = wz; E.y[r] = top; }
    const onIce = who === 'player' ? W.tile(P.x, P.z) === s.w : W.tile(E.x[r], E.z[r]) === s.w, hp0 = who === 'player' ? P.hp : E.hp[r], max = who === 'player' ? P.maxHp : E.maxHp[r], t0 = stepNo(ctx);
    let thawAt = -1;
    for (let i = 0; i < (refreeze ? 40 : 20) * hz && thawAt < 0; i++) {
      if (who === 'raider') { E.stun[r] = 9; if (!W.cells.iceAt(s.w) === false) { E.x[r] = wx; E.z[r] = wz; } }
      if (how === 'heat' && i === 3 * hz) applyAgent(ctx, 'heat', wx, wz, 0.5);
      if (refreeze && i === 11 * hz) applyAgent(ctx, 'cold', wx, wz, 0.5);
      step(ctx, NO_INPUT);
      if (!W.cells.iceAt(s.w) && thawAt < 0) thawAt = stepNo(ctx);
    }
    for (let i = 0; i < 8; i++) step(ctx, NO_INPUT); // a few steps for the cell pass after the thaw
    // hazards on (docs/HAZARDS.md): nobody is moved; whoever stood on the ice is in the water now and the liquid
    // exposure rule decides (the trainer here is Totodile, a Water type: it swims; the raider is a Rattata: exposed)
    const px = who === 'player' ? P.x : E.x[r], pz = who === 'player' ? P.z : E.z[r], k = W.tile(px, pz);
    // not teleported: still in the water within a step of where the ice was (it may have slid a little on the ice)
    const stayed = W.map.terrain[k] === T.water && Math.hypot(px - wx, pz - wz) < 1.2, exposure = who === 'player' ? (P.hzSafe === 1 && P.hzKind === 0 ? 'swimming' : P.hzKind ? 'exposed' : 'none') : E.hzKind[r] ? 'exposed' : 'none';
    // does it get out? the trainer walks to the bank it came from; the raider, unstunned, wades out by itself
    let moved = false;
    if (who === 'player') {
      for (let i = 0; i < 120 && !moved; i++) { steer(ctx, bx, bz, 0.2); moved = Math.hypot(bx - P.x, bz - P.z) < 0.3 && P.hzKind === 0; }
    } else { E.stun[r] = 0; P.x = px + 8; P.z = pz; for (let i = 0; i < 6 * hz && E.alive[r] && !(E.hzKind[r] === 0 && W.map.terrain[W.tile(E.x[r], E.z[r])] !== T.water); i++) { P.iframes = 1; P.hp = P.maxHp; step(ctx, NO_INPUT); } moved = E.alive[r] === 1 && E.hzKind[r] === 0 && W.map.terrain[W.tile(E.x[r], E.z[r])] !== T.water; }
    const py = who === 'player' ? P.y : E.y[r], hp1 = who === 'player' ? P.hp : E.alive[r] ? E.hp[r] : 0, kq = W.tile(who === 'player' ? P.x : E.x[r], who === 'player' ? P.z : E.z[r]);
    const dry = W.map.terrain[kq] !== T.water && W.isOpen(kq);
    const loss = Math.max(0, hp0 - hp1) / max, dunks = hits.filter((h) => h.kind === 'dunk').length;
    return { iced, top, onIce, thawAt, t0, px, pz, dry, py, loss, dunks, moved, stayed, exposure, who, events, level: W.height(wx, wz), hz, ctx, s, where: Math.hypot(px - wx, pz - wz), refrozen: refreeze };
  };
  const desc = (c: NonNullable<ReturnType<typeof iceCase>>) => `${c.iced ? 'frozen' : 'not frozen'} (ice ${c.top.toFixed(2)} m), actor on it ${c.onIce}, opens ${(((c.thawAt - c.t0) / hz)).toFixed(2)} s later; left where it stood (${c.where.toFixed(2)} m from the tile centre, in the water ${c.stayed}), ${c.exposure}; ${c.moved ? `out on dry ground at ${c.py.toFixed(2)} m` : 'NOT OUT'}, ${(c.loss * 100).toFixed(1)} % HP lost, ${c.dunks} dunks`;
  // the trainer (Totodile) swims out unhurt; the raider (Rattata) is exposed, wades out hurt but alive; nobody is teleported
  const pass = (c: ReturnType<typeof iceCase>, heat = false) => !!c && c.iced && c.onIce && c.thawAt > 0 && c.stayed && c.dunks === 0 && c.moved && c.dry
    && (c.who === 'player' ? c.exposure === 'swimming' && c.loss === 0 : c.exposure === 'exposed' && c.loss > 0 && c.loss < 1) && (!heat || c.thawAt - c.t0 < 4 * hz);

  const P1 = iceCase(false, 'player', 'timer');
  if (P1) {
    const crack = P1.events.find((e) => e.change === 'crack'), thaw = P1.events.find((e) => e.change === 'thaw');
    add('gorge.player-on-ice-timer', 'live', 'trainer on lower-river ice when it thaws by time', pass(P1) && !!crack && !!thaw && Math.abs((thaw.step - crack.step) / hz - I.crack) < 0.25,
      `${desc(P1)}; crack cue ${crack ? ((thaw!.step - crack.step) / hz).toFixed(2) : '-'} s before the thaw (rule ${I.crack} s)`);
  }
  const P2 = iceCase(false, 'player', 'heat'); if (P2) add('gorge.player-on-ice-heat', 'live', 'trainer on ice when Heat melts it (no crack cue)', pass(P2, true) && !P2.events.some((e) => e.change === 'crack'), desc(P2));
  const R1 = iceCase(false, 'raider', 'timer'); if (R1) add('gorge.raider-on-ice', 'live', 'a raider on ice when it thaws', pass(R1), desc(R1));
  const U1 = iceCase(true, 'player', 'timer'); if (U1) add('gorge.upper-reach-ice', 'live', 'trainer on ice in the upper reach above the falls', pass(U1) && Math.abs(U1.py - U1.level) < 1.6, `${desc(U1)}; shore ${Math.abs(U1.py - U1.level).toFixed(2)} m from the ice's own level (never dropped down the falls)`);
  else add('gorge.upper-reach-ice', 'live', 'trainer on ice in the upper reach above the falls', true, `no upper-reach tile with dry ground at its level on seed ${seed} (not applicable)`);
  const Q1 = iceCase(false, 'player', 'timer', true);
  if (Q1) add('gorge.refreeze-occupied', 'live', 'Cold again at the crack while the actor stands on the ice', pass(Q1) && Q1.thawAt - Q1.t0 > 12 * hz, `${desc(Q1)}; the second Cold re-armed the timer, so the ice held past its first thaw time (${((Q1.thawAt - Q1.t0) / hz).toFixed(2)} s)`);

  // ---- live: the seam: an actor on the bank beside ice that forms and opens is left alone ----
  {
    const ctx = mk('river-gorge', seed), W = ctx.world, P = ctx.player, hits = watch(ctx), s = seamTile(ctx, false);
    if (s) {
      const [wx, wz] = centre(ctx, s.w), [bx, bz] = centre(ctx, s.b);
      P.x = bx; P.z = bz; P.y = W.height(bx, bz); const hp0 = P.hp, p0 = [P.x, P.z];
      applyAgent(ctx, 'cold', wx, wz, 0.5);
      const top = W.height(wx, wz);
      for (let i = 0; i < 15 * hz; i++) step(ctx, NO_INPUT);
      add('gorge.seam-bystander', 'live', 'trainer on the bank beside ice that forms and thaws', top > W.topOf(s.b) - 0.3 && !W.cells.iceAt(s.w) && Math.hypot(P.x - p0[0], P.z - p0[1]) < 1e-6 && P.hp >= hp0 && hits.length === 0 && P.grounded,
        `bank at ${W.topOf(s.b).toFixed(2)} m, ice at ${top.toFixed(2)} m (step ${(top - W.topOf(s.b)).toFixed(2)} m, under the 0.6 m limit): the trainer standing there stays put, keeps full footing and HP, takes ${hits.length} hits through the freeze and the thaw`);
    }
  }

  // ---- live: many occupants at once (the whole river frozen, Heat everywhere) ----
  {
    const ctx = mk('river-gorge', seed), W = ctx.world, P = ctx.player, E = ctx.enemies, hits = watch(ctx), M = W.map;
    freezeAll(ctx);
    // occupied tiles spread over the river within the creatures' despawn distance of the trainer (further out they relocate)
    const wt: number[] = []; let anchor = -1;
    for (let k = 0; k < W.w * W.h; k += 1) if (M.terrain[k] === T.water && W.cells.iceAt(k) && (k % 7 === 0) && (((k / W.w) | 0) % 5 === 0)) { if (anchor < 0) anchor = k; if (Math.hypot(centre(ctx, k)[0] - centre(ctx, anchor)[0], centre(ctx, k)[1] - centre(ctx, anchor)[1]) < ctx.rules.enemy.despawnDistance - 5) wt.push(k); }
    const picks = wt.slice(0, 40), probes: number[] = [];
    for (const k of picks.slice(1)) { const [x, z] = centre(ctx, k); const e = spawnEnemy(ctx, 'rattata', x, z, ROLE.raider); if (e >= 0) probes.push(e); }
    for (let i = 0; i < 20; i++) step(ctx, NO_INPUT);
    // everyone onto the ice
    probes.forEach((e, i) => { const [x, z] = centre(ctx, picks[i + 1]); E.x[e] = x; E.z[e] = z; E.y[e] = W.height(x, z); E.stun[e] = 9; });
    const [px, pz] = centre(ctx, picks[0]); P.x = px; P.z = pz; P.y = W.height(px, pz);
    for (let k = 0; k < W.w * W.h; k++) if (M.terrain[k] === T.water) { const [x, z] = centre(ctx, k); applyAgent(ctx, 'heat', x, z, 0.5); }
    for (let i = 0; i < 20; i++) step(ctx, NO_INPUT);
    // hazards on: everyone is in the water where they stood; the trainer (Totodile) swims, every raider is exposed
    const exposed = probes.filter((e) => E.alive[e] && E.hzKind[e] === 1).length, swimming = P.hzSafe === 1 && M.terrain[W.tile(P.x, P.z)] === T.water;
    const enters = new Map<number, number>(), kos = new Map<number, number>();
    ctx.hooks.onTick.push((c) => { for (const e of c.events) if (e.t === 'hazard' && e.who === 'enemy') { const m = e.phase === 'ko' ? kos : e.phase === 'enter' ? enters : null; if (m) m.set(e.id, (m.get(e.id) ?? 0) + 1); } });
    // released: within the lethal time (and a second) every raider is out on dry ground or knocked out exactly once
    for (const e of probes) E.stun[e] = 0;
    for (let i = 0; i < (ctx.rules.hazards.water.lethal + 1) * hz; i++) { P.iframes = 1; step(ctx, NO_INPUT); }
    const out = probes.filter((e) => E.alive[e] && E.hzKind[e] === 0 && M.terrain[W.tile(E.x[e], E.z[e])] !== T.water).length, ko = probes.filter((e) => !E.alive[e] && kos.get(e) === 1).length;
    const stuck = probes.filter((e) => E.alive[e] && (E.hzKind[e] !== 0 || M.terrain[W.tile(E.x[e], E.z[e])] === T.water)).length;
    add('gorge.many-occupants', 'live', 'the whole river thaws under a trainer and ' + probes.length + ' raiders at once', exposed === probes.length && swimming && stuck === 0 && out + ko === probes.length && hits.filter((h) => h.kind === 'dunk').length === 0 && [...enters.values()].every((v) => v <= 1),
      `${picks.length} occupied tiles across both reaches: the trainer swims (${swimming}), ${exposed}/${probes.length} creatures exposed where they stood; ${(ctx.rules.hazards.water.lethal + 1).toFixed(0)} s after release ${out} waded out, ${ko} knocked out once each, ${stuck} still in the water; ${hits.filter((h) => h.kind === 'dunk').length} dunks`);
  }

  // ---- live: the river keeps working: spawn → Hold → retreat while the river is frozen and the cover is stripped ----
  {
    const prepare = (c: SimContext) => { freezeAll(c); stripProps(c); };
    const geo = playHabitat('river-gorge', seed, { route: 'both', prepare }), raid = playHabitat('river-gorge', seed, { raid: true, route: 'both', prepare });
    add('gorge.hold-frozen-stripped', 'live', 'river frozen and cover stripped in the same match, then spawn → Hold → retreat (both approaches)', geo.every((r) => r.reach !== null && r.held && r.back !== null && r.trainerHits === 0) && raid.every((r) => r.reach !== null && r.back !== null && r.raidAt !== null && r.trainerHits === 0 && r.raiderHits === 0),
      geo.map((r) => `${r.route}: reach ${r.reach?.toFixed(1)} s, held ${r.holdT} s, back ${r.back?.toFixed(1)} s, trainer damage from all sources ${r.dmg.toFixed(0)}, environment hits on the trainer ${r.trainerHits}`).join('; ') + '; Raid party live: ' + raid.map((r) => `${r.route}: raiders on the point ${r.raidAt} s, environment hits on the trainer ${r.trainerHits}, on raiders bound for the point ${r.raiderHits}`).join('; '));
  }
  return out;
}

export function strippedChecks(recipe: 'volcanic-ridge' | 'river-gorge', seed: number): Check[] {
  const prepare = (c: SimContext) => { stripProps(c); };
  const geo = playHabitat(recipe, seed, { route: 'both', prepare }), raid = playHabitat(recipe, seed, { raid: true, route: 'both', prepare });
  const lost = stripProps(mk(recipe, seed));
  return [{ id: `${recipe}.hold-stripped`, recipe, coverage: 'live', transition: 'props burnt and broken in the same match (to the sim\'s cover-loss cap) with the vents / river running',
    ok: geo.every((r) => r.reach !== null && r.held && r.back !== null && r.trainerHits === 0) && raid.every((r) => r.reach !== null && r.back !== null && r.raidAt !== null && r.trainerHits === 0 && r.raiderHits === 0),
    detail: `${lost} props burnt or broken before the run (cover capped at ${(mk(recipe, seed).rules.surfaces.coverLossCap * 100).toFixed(0)} %); ` + geo.map((r) => `${r.route}: reach ${r.reach?.toFixed(1)} s, held ${r.holdT} s, back ${r.back?.toFixed(1)} s, trainer damage from all sources ${r.dmg.toFixed(0)}, environment hits on the trainer ${r.trainerHits}`).join('; ') + '; Raid party live: ' + raid.map((r) => `${r.route}: raiders on the point ${r.raidAt} s, environment hits on the trainer ${r.trainerHits}, on raiders bound for the point ${r.raiderHits}`).join('; ') }];
}

if (process.argv[1]?.endsWith('habstate.ts')) {
  const which = process.argv[2] ?? 'all', seed = Number(process.argv[3] ?? 2);
  const all: Check[] = [];
  if (which === 'all' || which === 'crater') all.push(...craterChecks(seed), ...strippedChecks('volcanic-ridge', seed));
  if (which === 'all' || which === 'gorge') all.push(...gorgeChecks(seed), ...strippedChecks('river-gorge', seed));
  for (const c of all) console.log(`${c.ok ? 'ok  ' : 'FAIL'} [${c.coverage.padEnd(6)}] ${c.recipe} ${c.id}\n       ${c.transition}\n       ${c.detail}`);
  const live = all.filter((c) => c.coverage === 'live'), stat = all.filter((c) => c.coverage === 'static');
  console.log(`\n${all.filter((c) => c.ok).length}/${all.length} checks pass (${live.filter((c) => c.ok).length}/${live.length} exercised in the running simulation, ${stat.filter((c) => c.ok).length}/${stat.length} static)`);
  process.exitCode = all.every((c) => c.ok) ? 0 : 1;
}
