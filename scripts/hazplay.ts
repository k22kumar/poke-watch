// Liquid exposure and exposed falls through the real sim (docs/HAZARDS.md): the trainer is driven by ordinary move
// input (InputFrame) on generated maps, and creatures by their own AI and knockback. Every spot is found on the final
// collision of a fixed map seed and printed with its tile, so each case can be replayed in the browser with
// `?go=1&loc=<map>&mapseed=<seed>&species=<id>&calm=1&tp=<i>,<j>`.
//   npx tsx scripts/hazplay.ts            all cases, one line each (pass / FAIL, measurements)
// tests/hazards.test.ts asserts every case passes.
import { createRun, step } from '../src/sim/run';
import { NO_INPUT, type InputFrame, type SimContext } from '../src/sim/types';
import { T } from '../src/world/tiles';
import { applyAgent } from '../src/sim/cells';
import { spawnEnemy } from '../src/sim/enemies';
import { addMember } from '../src/sim/squad';
import { compileMove } from '../src/sim/moves';
import { DECK_REACH } from '../src/sim/world';

export interface Case { id: string; map: string; seed: number; tile: string; ok: boolean; detail: string }

/** a calm run on one map for every stage (no spawns, no objectives); `hz` changes the sim cadence */
export function mkRun(map: string, seed: number, species: string, extra: Record<string, unknown> = {}): SimContext {
  return createRun({ seed: 1, species, ruleOverrides: { worldgen: { mode: 'generated', regionSeed: seed, locations: { meadow: map, dusk: map, badlands: map, frost: map } }, objectives: { firstAfter: 1e9, secondAfter: 1e9 }, director: { spawnBase: -99, eliteEvery: 1e9, swarmEvery: 1e9 }, ...extra } as never });
}
const centre = (ctx: SimContext, k: number): [number, number] => [(k % ctx.world.w) - ctx.world.half + 0.5, ((k / ctx.world.w) | 0) - ctx.world.half + 0.5];
const tileName = (ctx: SimContext, k: number) => `${k % ctx.world.w},${(k / ctx.world.w) | 0}`;
const DIRS: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]];

/** put the trainer at (x, z) on the surface at its level and make that the safe ground */
export function place(ctx: SimContext, x: number, z: number, y?: number) {
  const P = ctx.player, W = ctx.world;
  P.x = P.px = x; P.z = P.pz = z; P.y = P.py = y ?? W.height(x, z); P.vx = P.vz = P.vy = P.kx = P.kz = 0; P.grounded = true;
  P.safeX = x; P.safeY = P.y; P.safeZ = z;
  W.updateFlow(x, z, P.y);
}

/** step the sim for `sec` seconds of simulation time with one input; `each` runs after every step */
export function run(ctx: SimContext, sec: number, inp: Partial<InputFrame>, each?: () => boolean | void): number {
  const n = Math.round(sec / ctx.dt);
  for (let i = 0; i < n; i++) {
    if (ctx.state === 'dead' || ctx.state === 'over') return i * ctx.dt;
    step(ctx, { ...NO_INPUT, ...inp });
    if (each && each()) return (i + 1) * ctx.dt;
  }
  return n * ctx.dt;
}

/** A shore: a dry open tile whose neighbour in direction d starts a straight run of `depth` open liquid tiles at one
 *  level within a step below it, with dry open ground behind it. The one nearest the map centre wins (ties: index). */
export function findShore(ctx: SimContext, depth = 4): { k: number; d: [number, number]; level: number } | null {
  const W = ctx.world, M = W.map, w = W.w;
  let best: { k: number; d: [number, number]; level: number; s: number } | null = null;
  for (let k = 0; k < w * W.h; k++) {
    if (M.terrain[k] === T.water || M.wall[k] || !W.isOpen(k) || (M.over && M.over[k] > 0)) continue;
    const i = k % w, j = (k / w) | 0;
    for (const d of DIRS) {
      let ok = true, level = NaN;
      for (let s = 1; s <= depth && ok; s++) {
        const ii = i + d[0] * s, jj = j + d[1] * s;
        if (ii < 1 || jj < 1 || ii >= w - 1 || jj >= W.h - 1) { ok = false; break; }
        const t = jj * w + ii;
        const lv = M.wlevel ? M.wlevel[t] : -0.25;
        if (M.terrain[t] !== T.water || M.wall[t] || (M.over && M.over[t] > 0)) ok = false;
        else if (s === 1) level = lv; else if (lv !== level) ok = false;
        // both sides of the lane are liquid or dry ground too (no wall to snag on)
        for (const [px, pz] of [[d[1], d[0]], [-d[1], -d[0]]]) { const q = (jj + pz) * w + ii + px; if (M.wall[q]) ok = false; }
      }
      if (!ok) continue;
      const h = W.topOf(k);
      if (h - level > 0.6 || h - level < 0) continue;
      const bi = i - d[0], bj = j - d[1], b = bj * w + bi;
      if (!W.isOpen(b) || M.terrain[b] === T.water || Math.abs(W.topOf(b) - h) > 0.3) continue;
      const [x, z] = centre(ctx, k), s = x * x + z * z + k * 1e-9;
      if (!best || s < best.s) best = { k, d, level, s };
    }
  }
  return best;
}

/** walk from the shore tile `depth` m into the liquid and stop; returns the s it took to make first contact */
function wadeIn(ctx: SimContext, k: number, d: [number, number], metres: number): number {
  const [x, z] = centre(ctx, k);
  place(ctx, x, z);
  const P = ctx.player;
  let t = 0, touched = -1;
  const target = [x + d[0] * (0.5 + metres), z + d[1] * (0.5 + metres)];
  while (t < 6 && ctx.state === 'play') {
    const rem = (target[0] - P.x) * d[0] + (target[1] - P.z) * d[1];
    if (rem <= 0.05) break;
    step(ctx, { ...NO_INPUT, mx: d[0], mz: d[1] });
    t += ctx.dt;
    if (touched < 0 && P.hzKind + P.hzSafe > 0) touched = t;
  }
  return touched;
}

interface Exposure { entered: boolean; damage: number; koAt: number | null; hp: number; max: number; enterEvents: number; koEvents: number; faints: number }
function watch(ctx: SimContext) {
  const o: Exposure = { entered: false, damage: 0, koAt: null, hp: 0, max: ctx.player.maxHp, enterEvents: 0, koEvents: 0, faints: 0 };
  let t0 = -1;
  ctx.hooks.onTick.push((c) => {
    for (const e of c.events) {
      if (e.t === 'hazard' && e.who === 'player' && e.phase === 'enter') { o.enterEvents++; if (t0 < 0) t0 = c.time - c.dt; }
      if (e.t === 'hazard' && e.who === 'player' && e.phase === 'ko') { o.koEvents++; o.koAt ??= t0 >= 0 ? c.time - t0 : c.time; }
      if (e.t === 'faint') o.faints++;
      if (e.t === 'hazardHit' && e.who === 'player') o.damage += e.amount;
    }
    o.hp = c.player.hp;
  });
  return { o, since: () => (t0 < 0 ? 0 : ctx.time - t0) };
}

const gorge = (seed: number) => ['river-gorge', seed] as const;
const crater = (seed: number) => ['volcanic-ridge', seed] as const;

/** a Pokémon wades in `metres`, stays `stay` s, walks back out to the shore it came from */
function inAndOut(map: string, seed: number, species: string, metres: number, stay: number, opts: { surf?: boolean; hz?: number; heal?: number; extra?: Record<string, unknown>; members?: string[] } = {}) {
  const extra = { ...(opts.extra ?? {}), ...(opts.hz ? { sim: { hz: opts.hz } } : {}) };
  const ctx = mkRun(map, seed, species, extra);
  if (opts.surf) ctx.player.m.moves.push({ key: 'surf', level: 1, cd: 9, spec: { ...compileMove(ctx.rules, ctx.player.m.moves[0].key), key: 'surf', name: 'Surf' }, uses: 0 });
  for (const id of opts.members ?? []) addMember(ctx, id);
  const sh = findShore(ctx)!;
  const w = watch(ctx);
  if (opts.heal) ctx.hooks.onTick.push((c) => { const P = c.player; if (P.hzKind && c.tick % Math.round(1 / c.dt) === 0) P.hp = Math.min(P.maxHp, P.hp + P.maxHp * opts.heal!); });
  const contactAt = wadeIn(ctx, sh.k, sh.d, metres);
  const P = ctx.player, y0 = P.y, swimming = P.hzSafe, exposed = P.hzKind;
  run(ctx, stay, NO_INPUT);
  const [sx, sz] = centre(ctx, sh.k);
  let out = false;
  run(ctx, 6, { mx: -sh.d[0], mz: -sh.d[1] }, () => { out = ctx.player.hzKind === 0 && (ctx.player.x - sx) * sh.d[0] + (ctx.player.z - sz) * sh.d[1] < 0.2; return out; });
  run(ctx, 0.5, NO_INPUT);
  return { ctx, sh, w: w.o, contactAt, y0, swimming, exposed, out, state: ctx.state, hp: ctx.player.hp, max: ctx.player.maxHp };
}

export function cases(): Case[] {
  const out: Case[] = [];
  const add = (id: string, map: string, seed: number, tile: string, ok: boolean, detail: string) => out.push({ id, map, seed, tile, ok, detail });

  // ---------------------------------------------------------------- water, Shrine Gorge seed 3 (and seed 7)
  for (const seed of [3, 7]) {
    const [map] = gorge(seed);
    for (const [label, sp, surf] of [['water-type, no Surf (Totodile)', 'totodile', false], ['non-Water with Surf (Charmander)', 'charmander', true], ['water-type, no Surf (Squirtle)', 'squirtle', false]] as const) {
      if (seed === 7 && sp === 'squirtle') continue;
      const r = inAndOut(map, seed, sp, 3, 3, { surf });
      add(`water.safe.${sp}`, map, seed, tileName(r.ctx, r.sh.k), r.swimming === 1 && r.exposed === 0 && r.w.damage === 0 && r.w.enterEvents === 0 && r.out && r.state === 'play',
        `${label}: in contact ${r.contactAt.toFixed(2)} s after setting off, swims at y ${r.y0.toFixed(2)} (surface ${r.sh.level}), ${r.w.damage} drowning damage, back on shore ${r.out}`);
    }
    // Normal type: enters, takes damage, escapes with partial HP
    const e = inAndOut(map, seed, 'rattata', 2, 1.2);
    add('water.escape.rattata', map, seed, tileName(e.ctx, e.sh.k), e.exposed === 1 && e.w.damage > 0 && e.out && e.state === 'play' && e.hp > 0 && e.hp < e.max && e.ctx.player.hzT === 0,
      `Rattata wades 2 m in, waits 1.2 s, walks back: ${e.w.damage} damage of ${e.max.toFixed(0)} max HP (${((e.w.damage / e.max) * 100).toFixed(0)} %), ${e.hp.toFixed(1)} HP left, exposure cleared on the shore ${e.ctx.player.hzT === 0}`);
    // stays: knocked out by the deadline, once
    const s = inAndOut(map, seed, 'rattata', 2, 8);
    add('water.ko.rattata', map, seed, tileName(s.ctx, s.sh.k), s.w.koEvents === 1 && s.w.faints === 1 && s.state === 'dead' && s.w.koAt !== null && Math.abs(s.w.koAt - 5) <= s.ctx.dt + 1e-6,
      `Rattata stays in: knocked out ${s.w.koAt?.toFixed(3)} s after first contact (lethal 5 s), ${s.w.koEvents} knockout, ${s.w.faints} faint, run ${s.state}`);
  }
  const [gm, gs] = gorge(3);

  // max HP, healing, cadence
  {
    const lo = inAndOut(gm, gs, 'rattata', 2, 8), hi = inAndOut(gm, gs, 'charmander', 2, 8, { extra: { player: { hpBase: 400 } } });
    add('water.maxhp', gm, gs, tileName(lo.ctx, lo.sh.k), lo.w.koAt !== null && hi.w.koAt !== null && Math.abs(lo.w.koAt - hi.w.koAt) <= lo.ctx.dt + 1e-6 && hi.max > 3 * lo.max,
      `max HP ${lo.max.toFixed(0)} and ${hi.max.toFixed(0)}: knocked out after ${lo.w.koAt?.toFixed(3)} s and ${hi.w.koAt?.toFixed(3)} s (20 % of max HP per second each)`);
    const heal = inAndOut(gm, gs, 'rattata', 2, 8, { heal: 0.3 });
    add('water.healing', gm, gs, tileName(heal.ctx, heal.sh.k), heal.w.koAt !== null && Math.abs(heal.w.koAt - 5) <= heal.ctx.dt + 1e-6 && heal.w.koEvents === 1,
      `healed 30 % of max HP every second while in: still knocked out at ${heal.w.koAt?.toFixed(3)} s (the deadline, not the HP, decides)`);
    for (const hz of [60, 30, 20, 10]) {
      const r = inAndOut(gm, gs, 'rattata', 2, 8, { hz });
      add(`water.cadence.${hz}hz`, gm, gs, tileName(r.ctx, r.sh.k), r.w.koAt !== null && Math.abs(r.w.koAt - 5) <= 1 / hz + 1e-6 && r.w.koEvents === 1,
        `${hz} Hz (step ${(1000 / hz).toFixed(1)} ms): knocked out at ${r.w.koAt?.toFixed(3)} s of simulation time, ${r.w.damage} damage cued before the knockout`);
    }
    // damage rate per simulation second at two cadences
    const rate = (hz: number) => { const r = inAndOut(gm, gs, 'rattata', 2, 1.5, { hz }); return r.w.damage / r.max; };
    const r60 = rate(60), r20 = rate(20);
    add('water.rate', gm, gs, '-', Math.abs(r60 - r20) < 0.06, `share of max HP lost on the same in-wait-out walk: ${(r60 * 100).toFixed(1)} % at 60 Hz, ${(r20 * 100).toFixed(1)} % at 20 Hz`);
  }
  // exit and re-enter; adjacent cells keep the clock; a hop keeps it
  {
    const ctx = mkRun(gm, gs, 'rattata'), sh = findShore(ctx)!, P = ctx.player;
    wadeIn(ctx, sh.k, sh.d, 1.5);
    run(ctx, 1, NO_INPUT);
    const t1 = P.hzT;
    // sideways across cells of the same water
    const side: [number, number] = [sh.d[1], sh.d[0]];
    const k0 = ctx.world.tile(P.x, P.z);
    run(ctx, 0.6, { mx: side[0], mz: side[1] });
    const crossed = ctx.world.tile(P.x, P.z) !== k0, t2 = P.hzT;
    const [sx, sz] = centre(ctx, sh.k);
    run(ctx, 6, { mx: -sh.d[0], mz: -sh.d[1] }, () => P.hzKind === 0);
    const cleared = P.hzT === 0 && P.hzKind === 0;
    run(ctx, 0.3, NO_INPUT);
    // back in: a new exposure from zero
    run(ctx, 3, { mx: sh.d[0], mz: sh.d[1] }, () => P.hzKind !== 0);
    const re = P.hzT;
    add('water.cells-exit-reenter', gm, gs, tileName(ctx, sh.k), t2 > t1 + 0.55 && crossed && cleared && re > 0 && re < 0.1 && Math.hypot(P.x - sx, P.z - sz) < 4,
      `clock ${t1.toFixed(2)} s → ${t2.toFixed(2)} s after crossing into the next water cell (kept), 0 on the shore (cleared ${cleared}), ${re.toFixed(3)} s right after re-entering`);
  }
  // the jump rule: an exposed Pokémon cannot jump out; a hop is not an exit
  {
    const ctx = mkRun(gm, gs, 'rattata'), sh = findShore(ctx)!, P = ctx.player;
    wadeIn(ctx, sh.k, sh.d, 1.5);
    let jumped = false;
    run(ctx, 0.5, { jump: true }, () => { if (!P.grounded) jumped = true; });
    const tw = inAndOut(gm, gs, 'totodile', 1.5, 0);
    run(tw.ctx, 0, NO_INPUT);
    const ctx2 = mkRun(gm, gs, 'totodile'), sh2 = findShore(ctx2)!;
    wadeIn(ctx2, sh2.k, sh2.d, 1.5);
    let swimJump = false;
    run(ctx2, 0.5, { jump: true }, () => { if (!ctx2.player.grounded) swimJump = true; });
    add('water.jump', gm, gs, tileName(ctx, sh.k), !jumped && swimJump, `exposed Rattata jumps from the water: ${jumped}; swimming Totodile can: ${swimJump}`);
  }
  // tagging: a compatibility change ends exposure; a drowned Pokémon's replacement comes in on the shore
  {
    const ctx = mkRun(gm, gs, 'rattata'), sh = findShore(ctx)!, P = ctx.player;
    addMember(ctx, 'totodile');
    wadeIn(ctx, sh.k, sh.d, 2);
    run(ctx, 1, NO_INPUT);
    const before = P.hzT;
    P.tagCd = 0;
    run(ctx, 0.1, { btn: 4 }); run(ctx, 0.1, NO_INPUT);
    const swapped = P.species.id === 'totodile', after = P.hzT, still = P.hzSafe === 1;
    add('water.tag-compatible', gm, gs, tileName(ctx, sh.k), before > 0.9 && swapped && after === 0 && still,
      `Rattata exposed ${before.toFixed(2)} s, Tag to Totodile in the water: exposure ${after} s, swimming ${still}`);
    const c2 = mkRun(gm, gs, 'rattata'), s2 = findShore(c2)!, P2 = c2.player;
    addMember(c2, 'charmander');
    const w = watch(c2);
    wadeIn(c2, s2.k, s2.d, 2);
    run(c2, 7, NO_INPUT);
    const [sx, sz] = centre(c2, s2.k);
    add('water.recover', gm, gs, tileName(c2, s2.k), w.o.koEvents === 1 && P2.species.id === 'charmander' && c2.state === 'play' && P2.hzKind === 0 && !c2.world.liquidAt(P2.x, P2.z, P2.y, 0.3) && Math.hypot(P2.x - sx, P2.z - sz) < 2.5,
      `Rattata drowns (1 knockout); Charmander comes in at ${P2.x.toFixed(1)},${P2.z.toFixed(1)} on the shore (${Math.hypot(P2.x - sx, P2.z - sz).toFixed(2)} m from the last safe ground), dry, run ${c2.state}`);
  }
  // a bridge deck over water and supported ice: no liquid damage
  {
    const ctx = mkRun(gm, gs, 'rattata'), W = ctx.world, M = W.map, P = ctx.player;
    // a deck tile over water with deck 3 tiles either way along one axis (the walk stays on it)
    let deck = -1, axis: [number, number] = [1, 0];
    const run3 = (k: number, a: number) => [-3, -2, -1, 1, 2, 3].every((s) => M.over![k + a * s] > 0);
    if (M.over) for (let k = 3 * W.w; k < M.over.length - 3 * W.w && deck < 0; k++) if (M.over[k] > 0 && M.terrain[k] === T.water) {
      if (run3(k, 1)) { deck = k; axis = [1, 0]; } else if (run3(k, W.w)) { deck = k; axis = [0, 1]; }
    }
    const w = watch(ctx);
    let detail = 'no deck over water on this map', ok = false;
    if (deck >= 0) {
      const [x, z] = centre(ctx, deck);
      place(ctx, x, z, M.over![deck]);
      // walk 2 m each way along the deck (half speed), then stand on it
      run(ctx, 0.6, { mx: axis[0] * 0.5, mz: axis[1] * 0.5 });
      run(ctx, 1.2, { mx: -axis[0] * 0.5, mz: -axis[1] * 0.5 });
      run(ctx, 2, NO_INPUT);
      ok = w.o.damage === 0 && w.o.enterEvents === 0 && P.y > M.over![deck] - DECK_REACH && ctx.state === 'play';
      detail = `Rattata on the deck at ${M.over![deck].toFixed(2)} m over water (surface ${(M.wlevel ? M.wlevel[deck] : -0.25).toFixed(2)}) for 4 s: ${w.o.damage} damage, ${w.o.enterEvents} entries, feet ${P.y.toFixed(2)}`;
    }
    add('water.bridge', gm, gs, deck >= 0 ? tileName(ctx, deck) : '-', ok, detail);
    const c2 = mkRun(gm, gs, 'rattata'), sh = findShore(c2)!, w2 = watch(c2);
    const [x0, z0] = centre(c2, sh.k);
    // freeze well past where it stops (ice is slippery: it slides on after the input ends)
    for (let s = 1; s <= 9; s++) applyAgent(c2, 'cold', x0 + sh.d[0] * s, z0 + sh.d[1] * s, 1.5);
    wadeIn(c2, sh.k, sh.d, 3);
    run(c2, 4, NO_INPUT);
    const onIce = c2.world.cells.iceAt(c2.world.tile(c2.player.x, c2.player.z));
    add('water.ice', gm, gs, tileName(c2, sh.k), onIce && w2.o.damage === 0 && w2.o.enterEvents === 0, `Rattata walks 3 m out onto frozen water and stands 4 s: on ice ${onIce}, ${w2.o.damage} damage`);
    // the ice opens under it: now in the water, the exposure rule takes over (no teleport ashore)
    const P2 = c2.player, px = P2.x, pz = P2.z;
    run(c2, 14, NO_INPUT, () => P2.hzKind !== 0);
    add('water.thaw', gm, gs, tileName(c2, sh.k), P2.hzKind === 1 && Math.hypot(P2.x - px, P2.z - pz) < 0.5, `ice thaws under Rattata: exposed ${P2.hzKind === 1} where it stood (moved ${Math.hypot(P2.x - px, P2.z - pz).toFixed(2)} m)`);
  }

  // ---------------------------------------------------------------- lava, Cinder Crater seed 7
  {
    const [cm, cs] = crater(7);
    const e = inAndOut(cm, cs, 'rattata', 1.5, 0.5);
    add('lava.escape', cm, cs, tileName(e.ctx, e.sh.k), e.exposed === 2 && e.w.damage > 0 && e.out && e.state === 'play' && e.hp < e.max && e.hp > 0,
      `Rattata steps 1.5 m into lava, waits 0.5 s, walks back: ${e.w.damage} damage (${((e.w.damage / e.max) * 100).toFixed(0)} % of max HP), ${e.hp.toFixed(1)} HP left`);
    const s = inAndOut(cm, cs, 'totodile', 1.5, 6);
    add('lava.ko', cm, cs, tileName(s.ctx, s.sh.k), s.w.koAt !== null && Math.abs(s.w.koAt - 3) <= s.ctx.dt + 1e-6 && s.w.koEvents === 1,
      `Totodile (Water type: no help in lava) stays: knocked out ${s.w.koAt?.toFixed(3)} s after contact (lethal 3 s)`);
    const im = inAndOut(cm, cs, 'charmander', 1.5, 4, { extra: { hazards: { lava: { safeSpecies: ['charmander'] } } } });
    add('lava.immune', cm, cs, tileName(im.ctx, im.sh.k), im.swimming === 2 && im.w.damage === 0 && im.out && im.state === 'play',
      `Charmander configured lava-safe (rules.hazards.lava.safeSpecies): ${im.w.damage} damage over 4 s in lava`);
    const fire = inAndOut(cm, cs, 'charmander', 1.5, 6);
    add('lava.fire-default', cm, cs, tileName(fire.ctx, fire.sh.k), fire.w.koEvents === 1, `Charmander unconfigured (no Fire-type rule): knocked out at ${fire.w.koAt?.toFixed(3)} s`);
  }

  // ---------------------------------------------------------------- edges: Mt. Moon seed 1 chasms, Shrine Gorge drops
  for (const [map, seed] of [['mt-moon', 1], ['chargestone-cave', 1], ['viridian-forest', 1]] as const) {
    const ctx = mkRun(map, seed, 'rattata'), W = ctx.world, M = W.map, w = W.w;
    // a lip: open dry ground (or a deck) beside open air
    const lips: { k: number; d: [number, number]; y: number }[] = [];
    for (let k = w; k < w * (W.h - 1); k++) {
      const deck = M.over && M.over[k] > 0;
      if (!deck && (!W.isOpen(k) || M.wall[k])) continue;
      for (const d of DIRS) {
        const t = k + d[0] + d[1] * w;
        if (!W.isVoid(t) || (M.over && M.over[t] > 0) || !W.isVoid(t + d[0] + d[1] * w)) continue;
        const back = k - d[0] - d[1] * w;
        if (!deck && (!W.isOpen(back) || M.wall[back])) continue;
        if (deck && !(M.over![back] > 0)) continue;
        lips.push({ k, d, y: deck ? M.over![k] : W.topOf(k) });
      }
    }
    lips.sort((a, b) => a.k - b.k);
    const fall = (lip: (typeof lips)[number], inp: Partial<InputFrame>, kick?: [number, number], diag = false) => {
      const c = mkRun(map, seed, 'rattata'), P = c.player, [x, z] = centre(c, lip.k);
      const ox = diag ? -lip.d[1] * 0.45 : 0, oz = diag ? -lip.d[0] * 0.45 : 0;
      place(c, x + ox, z + oz, lip.y);
      let ko = 0, faint = 0, rescued = false, minY = Infinity;
      c.hooks.onTick.push((cc) => { for (const e of cc.events) { if (e.t === 'hazard' && e.kind === 'fall' && e.phase === 'ko') ko++; if (e.t === 'faint') faint++; } minY = Math.min(minY, cc.player.y); if (Math.abs(cc.player.y - lip.y) < 0.1 && ko === 0 && Math.hypot(cc.player.x - x, cc.player.z - z) < 0.6 && cc.time > 0.5) rescued = rescued || false; });
      if (kick) { P.kx = kick[0]; P.kz = kick[1]; }
      const t = run(c, 3, inp, () => c.state === 'dead');
      return { c, ko, faint, t, minY, rescued, state: c.state };
    };
    if (!lips.length) { add(`void.${map}`, map, seed, '-', false, 'no chasm lip found'); continue; }
    const bridge = (l: (typeof lips)[number]) => (M.over && M.over[l.k] > 0) || M.terrain[l.k] === T.wood;
    const ground = lips.find((l) => !bridge(l)), deck = lips.find(bridge);
    for (const [label, lip] of [['ground lip', ground], ['bridge deck side', deck]] as const) {
      if (!lip) { add(`void.walk.${label.replace(/ /g, '-')}`, map, seed, '-', label === 'bridge deck side', `no ${label} beside a chasm on this map`); continue; }
      const r = fall(lip, { mx: lip.d[0], mz: lip.d[1] });
      add(`void.walk.${label.replace(/ /g, '-')}`, map, seed, tileName(ctx, lip.k), r.ko === 1 && r.faint === 1 && r.state === 'dead' && r.minY < lip.y - 1,
        `walks off the ${label} (${lip.y.toFixed(2)} m) into the chasm: fell to ${r.minY.toFixed(2)} m (kill plane ${W.killY.toFixed(2)}), ${r.ko} fall knockout, ${r.faint} faint after ${r.t.toFixed(2)} s, no rescue to the lip`);
    }
    if (ground) {
      const diag = fall(ground, { mx: ground.d[0] * 0.7071 + ground.d[1] * 0.7071, mz: ground.d[1] * 0.7071 + ground.d[0] * 0.7071 }, undefined, true);
      add('void.diagonal', map, seed, tileName(ctx, ground.k), diag.ko === 1 && diag.faint === 1, `walks diagonally off the lip from a tile edge: ${diag.ko} knockout, ${diag.faint} faint`);
      const kick = fall(ground, NO_INPUT, [ground.d[0] * 14, ground.d[1] * 14]);
      add('void.knocked', map, seed, tileName(ctx, ground.k), kick.ko === 1 && kick.faint === 1, `knocked off the lip by 14 m/s knockback, no input: ${kick.ko} knockout`);
      // with a reserve: one knockout, the next Pokémon on the lip's safe ground, not in the chasm
      const c = mkRun(map, seed, 'rattata'), P = c.player, [x, z] = centre(c, ground.k);
      addMember(c, 'charmander');
      const back: [number, number] = [x - ground.d[0] * 1.5, z - ground.d[1] * 1.5];
      place(c, back[0], back[1]);
      let ko = 0;
      c.hooks.onTick.push((cc) => { for (const e of cc.events) if (e.t === 'hazard' && e.phase === 'ko') ko++; });
      run(c, 1.2, { mx: ground.d[0], mz: ground.d[1] });
      run(c, 2.5, NO_INPUT);
      add('void.recover', map, seed, tileName(ctx, ground.k), ko === 1 && P.species.id === 'charmander' && c.state === 'play' && P.grounded && P.y > W.killY + 1 && W.support(P.x, P.z, P.y) !== -Infinity,
        `Rattata walks off (1 knockout); Charmander comes in at ${P.x.toFixed(1)},${P.z.toFixed(1)} y ${P.y.toFixed(2)} on supported ground`);
      // a creature: avoids the lip on its own, falls when knocked over it
      const ce = mkRun(map, seed, 'rattata'), [lx, lz] = centre(ce, ground.k);
      place(ce, lx + ground.d[0] * 6, lz + ground.d[1] * 6, ground.y);
      ce.player.y = ground.y + 50; // out of reach: the creature chases toward the chasm
      const e = spawnEnemy(ce, 'geodude', lx - ground.d[0] * 0.5, lz - ground.d[1] * 0.5);
      const E = ce.enemies;
      E.x[e] = E.px[e] = lx - ground.d[0] * 0.5; E.z[e] = E.pz[e] = lz - ground.d[1] * 0.5; E.y[e] = E.py[e] = ground.y;
      let kills = 0, fallKo = 0;
      ce.hooks.onTick.push((cc) => { for (const ev of cc.events) { if (ev.t === 'kill') kills++; if (ev.t === 'hazard' && ev.kind === 'fall' && ev.who === 'enemy') fallKo++; } cc.player.y = ground.y + 50; cc.player.vy = 0; });
      let entered = false;
      run(ce, 3, NO_INPUT, () => { if (W.support(E.x[e], E.z[e], E.y[e]) === -Infinity) entered = true; });
      const held = E.alive[e] === 1 && !entered;
      // knocked over the lip from where it stands now
      const kb = mkRun(map, seed, 'rattata'), Eb = kb.enemies;
      place(kb, lx + ground.d[0] * 6, lz + ground.d[1] * 6, ground.y);
      kb.hooks.onTick.push((cc) => { for (const ev of cc.events) { if (ev.t === 'kill') kills++; if (ev.t === 'hazard' && ev.kind === 'fall' && ev.who === 'enemy') fallKo++; } cc.player.y = ground.y + 50; cc.player.vy = 0; });
      const eb = spawnEnemy(kb, 'geodude', lx, lz);
      // spawnEnemy snaps to ground the trainer can reach; the lip may be across the chasm from it
      Eb.x[eb] = Eb.px[eb] = lx; Eb.z[eb] = Eb.pz[eb] = lz; Eb.y[eb] = Eb.py[eb] = ground.y;
      Eb.kx[eb] = ground.d[0] * 12; Eb.kz[eb] = ground.d[1] * 12;
      run(kb, 3, NO_INPUT);
      add('void.creature', map, seed, tileName(ctx, ground.k), held && kills === 1 && fallKo === 1 && !Eb.alive[eb], `Geodude chasing toward the chasm holds at the lip 3 s: ${held}; knocked over it (12 m/s): ${fallKo} fall knockout, ${kills} kill`);
    }
  }
  // a lower solid landing and a liquid landing (Shrine Gorge)
  {
    const ctx = mkRun(gm, gs, 'rattata'), W = ctx.world, M = W.map, w = W.w;
    type Drop = { k: number; d: [number, number]; drop: number };
    let solid = null as Drop | null, wet = null as Drop | null;
    for (let k = w; k < w * (W.h - 1) && (!solid || !wet); k++) {
      if (!W.isOpen(k) || M.terrain[k] === T.water || (M.over && M.over[k] > 0) || M.stairs[k]) continue;
      for (const d of DIRS) {
        const t = k + d[0] + d[1] * w, t2 = t + d[0] + d[1] * w, back = k - d[0] - d[1] * w;
        if (M.wall[t] || M.wall[t2] || (M.over && (M.over[t] > 0 || M.over[t2] > 0)) || M.stairs[t] || !W.isOpen(back)) continue;
        const drop = W.topOf(k) - W.topOf(t);
        if (drop < 1.5 || Math.abs(W.topOf(t) - W.topOf(t2)) > 0.3) continue;
        if (!solid && M.terrain[t] !== T.water && M.terrain[t2] !== T.water && W.isOpen(t) && W.isOpen(t2)) solid = { k, d, drop };
        if (!wet && M.terrain[t] === T.water && M.terrain[t2] === T.water) wet = { k, d, drop };
      }
    }
    for (const [label, s] of [['solid', solid], ['liquid', wet]] as const) {
      if (!s) { add(`ledge.${label}`, gm, gs, '-', false, `no ${label} drop found`); continue; }
      const c = mkRun(gm, gs, 'rattata'), P = c.player, [x, z] = centre(c, s.k);
      place(c, x, z);
      let air = false, ko = 0, landed = -1;
      c.hooks.onTick.push((cc) => { if (!cc.player.grounded) air = true; else if (air && landed < 0) landed = cc.player.y; for (const e of cc.events) if (e.t === 'hazard' && e.phase === 'ko') ko++; });
      run(c, 0.8, { mx: s.d[0], mz: s.d[1] });
      const exposed = P.hzKind;
      run(c, 0.4, NO_INPUT);
      if (label === 'solid') add('ledge.solid', gm, gs, tileName(c, s.k), air && ko === 0 && landed > -Infinity && Math.abs(landed - W.topOf(s.k + s.d[0] + s.d[1] * w)) < 0.7 && c.state === 'play' && P.grounded,
        `walks off a ${s.drop.toFixed(2)} m drop: airborne ${air}, lands at ${landed.toFixed(2)} m, no knockout, grounded ${P.grounded}`);
      else add('ledge.liquid', gm, gs, tileName(c, s.k), air && exposed === 1 && ko === 0, `walks off a ${s.drop.toFixed(2)} m bank into the river: airborne ${air}, then exposed to water ${exposed === 1}`);
    }
  }
  // creatures and water: a chaser holds at the shore; knocked in, it drowns or wades out by the same clock
  {
    const ctx = mkRun(gm, gs, 'rattata'), sh = findShore(ctx)!, [x, z] = centre(ctx, sh.k), E = ctx.enemies;
    place(ctx, x + sh.d[0] * 30, z + sh.d[1] * 30);
    ctx.player.y = 60;
    ctx.hooks.onTick.push((c) => { c.player.y = 60; c.player.vy = 0; });
    const e = spawnEnemy(ctx, 'geodude', x, z);
    let kills = 0, hits = 0;
    ctx.hooks.onTick.push((c) => { for (const ev of c.events) { if (ev.t === 'kill') kills++; if (ev.t === 'hazardHit' && ev.who === 'enemy') hits++; } });
    let wet = false;
    run(ctx, 2, NO_INPUT, () => { if (E.hzKind[e]) wet = true; });
    const dry = E.alive[e] === 1 && !wet;
    // knocked in from the shore: it wades back out by itself (the shore it picked on entry), hurt
    const ck = mkRun(gm, gs, 'rattata'), Ek = ck.enemies;
    place(ck, x + sh.d[0] * 30, z + sh.d[1] * 30);
    ck.hooks.onTick.push((c) => { c.player.y = 60; c.player.vy = 0; for (const ev of c.events) { if (ev.t === 'kill') kills++; if (ev.t === 'hazardHit' && ev.who === 'enemy') hits++; } });
    const ek = spawnEnemy(ck, 'geodude', x, z);
    Ek.kx[ek] = sh.d[0] * 9; Ek.kz[ek] = sh.d[1] * 9;
    let enteredAt = -1;
    run(ck, 8, NO_INPUT, () => { if (enteredAt < 0 && Ek.hzKind[ek]) enteredAt = ck.time; return !Ek.alive[ek] || (enteredAt > 0 && Ek.hzKind[ek] === 0); });
    const escaped = Ek.alive[ek] === 1 && Ek.hzKind[ek] === 0 && Ek.hp[ek] < Ek.maxHp[ek];
    add('water.creature', gm, gs, tileName(ctx, sh.k), dry && enteredAt > 0 && hits > 0 && (escaped || kills === 1), `Geodude chasing across the river holds at the shore 2 s: ${dry}; knocked in (9 m/s), it takes ${hits} damage cues and ${escaped ? `wades out after ${(ck.time - enteredAt).toFixed(2)} s with ${Ek.hp[ek].toFixed(0)}/${Ek.maxHp[ek].toFixed(0)} HP` : kills ? 'drowns (1 kill)' : 'is still in'}`);
    const c2 = mkRun(gm, gs, 'rattata'), s2 = findShore(c2)!, [x2, z2] = centre(c2, s2.k), E2 = c2.enemies;
    place(c2, x2 + s2.d[0] * 30, z2 + s2.d[1] * 30);
    c2.hooks.onTick.push((c) => { c.player.y = 60; c.player.vy = 0; });
    const e2 = spawnEnemy(c2, 'geodude', x2 + s2.d[0] * 2, z2 + s2.d[1] * 2);
    // spawned on the shore (spawnEnemy snaps to walkable); carry it to deep water and hold it there with the AI stunned
    E2.x[e2] = x2 + s2.d[0] * 2.5; E2.z[e2] = z2 + s2.d[1] * 2.5; E2.y[e2] = s2.level;
    let k2 = 0;
    c2.hooks.onTick.push((c) => { E2.stun[e2] = 1; for (const ev of c.events) if (ev.t === 'kill') k2++; });
    const t = run(c2, 7, NO_INPUT, () => !E2.alive[e2]);
    add('water.creature-ko', gm, gs, tileName(c2, s2.k), k2 === 1 && Math.abs(t - 5) <= c2.dt * 2, `Geodude stunned in deep water: knocked out after ${t.toFixed(3)} s (lethal 5 s), ${k2} kill`);
  }
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const cs = cases();
  for (const c of cs) console.log(`${c.ok ? 'pass' : 'FAIL'}  ${c.id.padEnd(26)} ${c.map} seed ${c.seed} tile ${c.tile}: ${c.detail}`);
  const bad = cs.filter((c) => !c.ok).length;
  console.log(`\n${cs.length - bad}/${cs.length} pass`);
  if (bad) process.exitCode = 1;
}
