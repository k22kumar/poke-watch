// Tactical Hold evaluation on habitat maps, through the real sim: the real Hold objective, the real Raid party (spawned
// at team B's staging when the Hold activates), the squad, and the director's ordinary horde. The trainer is driven by
// a scripted controller (route following + the balance bot's move buttons, Tag and cards), so the numbers are
// reproducible but they are NOT a human's: read them as "what a competent committed player would meet".
//
//   npx tsx scripts/habtac.ts <map|all> [seeds] [--stage N] [--squad a,b,c] [--level N] [--warm S]
//                             [--horde on|off] [--raid natural|alt|both] [--route direct|flank|both] [--back same|other|both]
//                             [--json out.json] [-v]
//   <map>: river-gorge | volcanic-ridge | viridian-forest | mt-moon | classic (the classic generator, the stage's biome)
//   seeds: comma list (3,7,25) or `first:count`
//
// Raid `natural` = the Raiders walk the contest flow field as the game ships it. `alt` = the harness forces them onto the
// OTHER approach of team B (the one the flow field does not choose), by steering their `goalDir` along it. The trainer's
// `route` is the approach it walks to the point (direct or flank, from the final collision) and `back` the one it retreats by.
import { writeFileSync } from 'node:fs';
import { createRun, startStage, step } from '../src/sim/run';
import { startObjective } from '../src/sim/objectives';
import { addMember } from '../src/sim/squad';
import { gainXp } from '../src/sim/progression';
import { botInput } from '../src/sim/bot';
import { ROLE } from '../src/sim/pools';
import { STAGES } from '../src/rules/stages';
import { HABITATS } from '../src/world/habitat';
import { clearance } from '../src/world/habitat/validate';
import { pathBetween } from '../src/world/locgen/nav';
import { NO_INPUT, type InputFrame, type SimContext } from '../src/sim/types';

import { RANGE, swap } from '../src/mods';
const arg = (k: string, d: string) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const flag = (k: string) => process.argv.includes(k);

export interface TacOpts { map: string; seed: number; stage?: number; squad?: string[]; level?: number; warm?: number; horde?: boolean; raid?: 'natural' | 'alt'; route?: 'direct' | 'flank'; back?: 'same' | 'other'; verbose?: boolean; maxHold?: number; recycle?: boolean; runSeed?: number }
export interface TacResult {
  map: string; seed: number; runSeed: number; stage: number; route: string; back: string; raid: string; horde: boolean; recipeMap: string;
  /** seconds from the start of travel to standing on the point */
  reach: number | null; reachFrac: number;
  /** first contact: seconds into the travel and how far along the route (0..1), with what; `any` = horde or raid, `raid` = a Raider */
  contactAny: { t: number; frac: number; what: string; tile: string } | null;
  contactRaid: { t: number; frac: number; tile: string } | null;
  /** travel damage as a share of the squad's total max HP, and per tenth of the route */
  travelDmg: number; routeDmg: number[];
  /** when the first Raider stood within the Hold radius after the Hold activated (s), and which approach each one used */
  raidAt: number | null; raidersUsed: string[]; raidLen: Record<string, number>;
  /** the Hold */
  hold: 'done' | 'failed' | 'wiped' | 'none'; holdT: number | null; drained: number; endCharge: number; padSeconds: number; outSeconds: number;
  padPressure: { raiders: number; horde: number; peakNear: number };
  holdDmg: number; faints: number; kills: number; killsRaid: number;
  /** retreat */
  backT: number | null; backDmg: number; backContacts: number; backRaidersAlive: number;
  /** where (metres from the pad) and when (s after the Hold activated) the Raiders were first hit and killed */
  raidHit: number | null; raidHitT: number | null; raidSeenT: number | null; raidKills: { d: number; t: number }[];
  /** what the environment did: the trainer entering liquid or falling, and vent hits, by kind */
  hazard: Record<string, number>;
  note: string;
}

// ---- geometry helpers ------------------------------------------------------------------------------------------

type Path = number[];
const tileOf = (ctx: SimContext, x: number, z: number) => ctx.world.tile(x, z);
const xz = (ctx: SimContext, v: number): [number, number] => { const W = ctx.world, n = W.w * W.h, k = v % n; return [(k % W.w) - W.half + 0.5, ((k / W.w) | 0) - W.half + 0.5]; };

function routeTo(ctx: SimContext, from: number, to: number, avoid?: Set<number>): Path | null {
  const m = ctx.world.map, n = m.w * m.h, cl = clearance(m), N = cl.length;
  const allow = new Uint8Array(N);
  for (let v = 0; v < N; v++) allow[v] = cl[v] >= 0.75 && !(avoid && avoid.has(v % n)) ? 1 : 0;
  if (ctx.world.hazard) for (let k = 0; k < n; k++) if (ctx.world.hazard[k]) allow[k] = 0;
  return pathBetween(m, from, to, allow);
}
/** tiles within 4 of the path, except within `rFrom` of its start and `rTo` of its end (the shared funnel and the shoulder) */
function avoidOf(ctx: SimContext, path: Path, a: [number, number], rFrom: number, b: [number, number], rTo: number): Set<number> {
  const W = ctx.world, n = W.w * W.h, out = new Set<number>();
  for (const v of path) {
    const k = v % n, x = k % W.w, y = (k / W.w) | 0;
    if (Math.hypot(x - b[0], y - b[1]) <= rTo || Math.hypot(x - a[0], y - a[1]) <= rFrom) continue;
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) out.add((y + dy) * W.w + x + dx);
  }
  return out;
}
/** both approaches between two tiles (tile coordinates): the shortest, and the shortest that keeps away from it */
function approaches(ctx: SimContext, from: number, to: number, a: [number, number], rFrom: number, b: [number, number], rTo: number) {
  const first = routeTo(ctx, from, to);
  if (!first) return null;
  const second = routeTo(ctx, from, to, avoidOf(ctx, first, a, rFrom, b, rTo));
  return { shortest: first, other: second };
}

/** which of the two reference paths a trajectory (world x, z samples) followed, ignoring the shared ends */
function classify(ctx: SimContext, pts: [number, number][], refs: Record<string, Path>, ends: [[number, number], [number, number]], rEnd: number): string {
  const W = ctx.world, n = W.w * W.h;
  const nodes: Record<string, [number, number][]> = {};
  for (const [id, p] of Object.entries(refs)) nodes[id] = p.map((v) => { const k = v % n; return [(k % W.w) + 0.5 - W.half, ((k / W.w) | 0) + 0.5 - W.half]; });
  const score: Record<string, number> = {}; let used = 0;
  for (const [px, pz] of pts) {
    if (Math.hypot(px - ends[0][0], pz - ends[0][1]) < 12 || Math.hypot(px - ends[1][0], pz - ends[1][1]) < rEnd + 3) continue;
    used++;
    for (const id of Object.keys(nodes)) { let d = Infinity; for (const [x, z] of nodes[id]) d = Math.min(d, Math.hypot(px - x, pz - z)); score[id] = (score[id] ?? 0) + Math.min(d, 12); }
  }
  if (!used) return '?';
  const ids = Object.keys(score).sort((p, q) => score[p] - score[q]);
  return ids.length > 1 && score[ids[1]] - score[ids[0]] < used * 1.0 ? 'mixed' : ids[0];
}

// ---- controllers -----------------------------------------------------------------------------------------------

/** walks a node path: steers at the farthest of the next few nodes that is a clear straight walk */
class Follower {
  i = 0; replans = 0; private bestI = 0; private bestT = 0; private px = 0; private pz = 0; private movedT = 0;
  /** `replan(tile)` rebuilds the rest of the route from where the trainer was shoved to (knockback, a crowd) */
  constructor(public path: Path, private replan?: (from: number) => Path | null) {}
  /** the unit steer and whether the end is reached */
  steer(ctx: SimContext): { mx: number; mz: number; done: boolean } {
    const W = ctx.world, n = W.w * W.h, P = ctx.player, path = this.path;
    let near = this.i, nd = Infinity;
    for (let j = this.i; j < Math.min(path.length, this.i + 30); j++) {
      const k = path[j] % n, x = (k % W.w) - W.half + 0.5, z = ((k / W.w) | 0) - W.half + 0.5, d = Math.hypot(x - P.x, z - P.z);
      if (d < nd) { nd = d; near = j; }
    }
    this.i = near;
    // no progress along the route (a wall in the way, shoved off a ledge onto the floor beneath it): plan again from here
    const t = ctx.time;
    if (this.i > this.bestI) { this.bestI = this.i; this.bestT = t; }
    if (t - this.bestT > 2.5 && this.replan && W.tile(P.x, P.z) >= 0) { this.bestT = t; const np = this.replan(W.tile(P.x, P.z)); if (np && np.length > 1) { this.path = np; this.i = 0; this.bestI = 0; this.replans++; return this.steer(ctx); } }
    if (nd > 3.2 && this.replan && W.tile(P.x, P.z) >= 0) { const np = this.replan(W.tile(P.x, P.z)); if (np && np.length > 1) { this.path = np; this.i = 0; this.replans++; return this.steer(ctx); } }
    if (this.i >= path.length - 2 && nd < 1.2) return { mx: 0, mz: 0, done: true };
    let tk = path[Math.min(path.length - 1, this.i + 1)] % n;
    for (let ahead = 4; ahead >= 1; ahead--) {
      const c = path[Math.min(path.length - 1, this.i + ahead)] % n, cx = (c % W.w) - W.half + 0.5, cz = ((c / W.w) | 0) - W.half + 0.5;
      let clear = true, feet = P.y;
      const L0 = Math.hypot(cx - P.x, cz - P.z), steps = Math.ceil(L0 / 0.25);
      for (let s = 1; s <= steps && clear; s++) {
        const x = P.x + ((cx - P.x) * s) / steps, z = P.z + ((cz - P.z) * s) / steps;
        for (const [ox, oz] of [[0, 0], [0.45, 0], [-0.45, 0], [0, 0.45], [0, -0.45]]) if (W.blocks(x + ox, z + oz, feet, 0.6) || W.hazardAt(x + ox, z + oz)) { clear = false; break; }
        if (clear) { feet = Math.max(W.height(x, z, feet), feet - 0.6); if (P.y - W.height(x, z, feet) > 0.6 * (s * 0.25) + 0.5) clear = false; } // a ramp, never a ledge
      }
      if (clear) { tk = c; break; }
    }
    const tx = (tk % W.w) - W.half + 0.5, tz = ((tk / W.w) | 0) - W.half + 0.5, dx = tx - P.x, dz = tz - P.z, L = Math.hypot(dx, dz) || 1;
    return { mx: dx / L, mz: dz / L, done: false };
  }
  get frac() { return this.path.length ? this.i / this.path.length : 0; }
}

/** the bot's buttons (move buttons, Tag, cards) with movement replaced: dash off (a dash cannot be steered along a bridge) */
function buttons(ctx: SimContext, mx: number, mz: number): InputFrame {
  const b = botInput(ctx);
  return { ...b, mx, mz, dash: false, jump: false };
}
/** stay near (cx, cz): the bot's own movement (flee threats, avoid lips) pulled back inside the leash */
function leash(ctx: SimContext, cx: number, cz: number, r: number): InputFrame {
  const P = ctx.player, b = botInput(ctx), d = Math.hypot(P.x - cx, P.z - cz);
  let { mx, mz } = b;
  if (d > r) { const L = d || 1; mx = (cx - P.x) / L; mz = (cz - P.z) / L; }
  else if (d > r * 0.7 && mx * (P.x - cx) + mz * (P.z - cz) > 0) { // heading outward near the edge: slide along it
    const L = d || 1, ox = (P.x - cx) / L, oz = (P.z - cz) / L, dot = mx * ox + mz * oz; mx -= dot * ox; mz -= dot * oz; const l2 = Math.hypot(mx, mz) || 1; mx /= l2; mz /= l2;
  }
  return { ...b, mx, mz, dash: false, jump: false };
}

// ---- the run ---------------------------------------------------------------------------------------------------

export function biomeStage(biome: string) { return STAGES.findIndex((s) => s.biome === biome); }

export function playHold(o: TacOpts): TacResult {
  const map = o.map, isHab = !!HABITATS[map];
  const stage = o.stage ?? (isHab ? biomeStage(HABITATS[map].biomeFit[0]) : map === 'viridian-forest' ? biomeStage('meadow') : map === 'mt-moon' ? biomeStage('dusk') : 0);
  const horde = o.horde ?? true;
  const locations: Record<string, string> = map === 'classic' ? { meadow: '', dusk: '', badlands: '', frost: '' } : { meadow: map, dusk: map, badlands: map, frost: map };
  const ctx = createRun({ mode: horde ? undefined : RANGE, mods: [swap], seed: o.runSeed ?? 1, species: (o.squad ?? ['bulbasaur'])[0], ruleOverrides: { objectives: { firstAfter: 1e9, secondAfter: 1e9 }, worldgen: { mode: 'generated', regionSeed: o.seed, locations }, ...(o.recycle === false ? { enemy: { despawnDistance: 1e9 } } : {}) } as never });
  if (stage) startStage(ctx, stage);
  const level = o.level ?? 10;
  for (let i = 1; i < level; i++) gainXp(ctx, ctx.player.xpNext - ctx.player.xp + 0.01);
  for (const id of (o.squad ?? ['bulbasaur', 'mareep', 'geodude']).slice(1)) addMember(ctx, id);
  ctx.player.hp = ctx.player.maxHp;
  for (const m of ctx.player.squad) m.hp = m.maxHp;
  const W = ctx.world, H = W.hab, E = ctx.enemies, P = ctx.player, n = W.w * W.h;
  const totalMax = () => ctx.player.squad.reduce((s, m) => s + m.maxHp, 0);
  const totalHp = () => ctx.player.squad.reduce((s, m) => s + (m.fainted ? 0 : m.hp), 0);
  const res: TacResult = { map, seed: o.seed, runSeed: o.runSeed ?? 1, stage, route: o.route ?? 'direct', back: o.back ?? 'same', raid: o.raid ?? 'natural', horde, recipeMap: W.map.id, reach: null, reachFrac: 0, contactAny: null, contactRaid: null, travelDmg: 0, routeDmg: Array(10).fill(0), raidAt: null, raidersUsed: [], raidLen: {}, hold: 'none', holdT: null, drained: 0, endCharge: 0, padSeconds: 0, outSeconds: 0, padPressure: { raiders: 0, horde: 0, peakNear: 0 }, holdDmg: 0, faints: 0, kills: 0, killsRaid: 0, backT: null, backDmg: 0, backContacts: 0, backRaidersAlive: 0, raidHit: null, raidHitT: null, raidSeenT: null, raidKills: [], hazard: {}, note: '' };
  let actClock = -1, padX = 0, padZ = 0;
  ctx.hooks.onTick.push((c) => { for (const e of c.events) {
    if (e.t === 'faint') res.faints++;
    if (e.t === 'hazard' && e.who === 'player' && e.phase === 'enter') res.hazard[e.kind] = (res.hazard[e.kind] ?? 0) + 1;
    if (e.t === 'hazardHit' && e.who === 'player') res.hazard[e.kind + 'Hit'] = (res.hazard[e.kind + 'Hit'] ?? 0) + 1;
    if (e.t === 'hazardHit' && e.who === 'enemy' && c.enemies.roles[e.id] & ROLE.raider) res.hazard['raider-' + e.kind] = (res.hazard['raider-' + e.kind] ?? 0) + 1;
    if (e.t === 'kill') { res.kills++; if (e.roles & ROLE.raider) { res.killsRaid++; if (actClock >= 0) res.raidKills.push({ d: +Math.hypot(e.x - padX, e.z - padZ).toFixed(1), t: +(c.time - actClock).toFixed(1) }); } }
    if (e.t === 'hit' && actClock >= 0 && res.raidHit === null && c.enemies.alive[e.enemy] && c.enemies.roles[e.enemy] & ROLE.raider) { res.raidHit = +Math.hypot(e.x - padX, e.z - padZ).toFixed(1); res.raidHitT = +(c.time - actClock).toFixed(1); }
  } });

  const spawn = W.map.spawn[1] * W.w + W.map.spawn[0];
  let stageB: [number, number] | null = null, contest: [number, number] | null = null, rC = 5;
  if (H) { stageB = [H.stage.B[0], H.stage.B[1]]; contest = [H.contest.x, H.contest.y]; rC = H.contest.r; }
  const dead = () => ctx.state === 'dead' || ctx.state === 'over';
  const tick = (inp: InputFrame) => { step(ctx, inp); if (ctx.cards.offer) step(ctx, { ...NO_INPUT, card: { action: 'skip', index: 0 } }); };

  // 1. warm-up: the squad holds its start, fighting what the director sends (the horde is part of the situation)
  const sx = P.x, sz = P.z, warm = o.warm ?? 100;
  while (ctx.time < warm && !dead()) tick(leash(ctx, sx, sz, 5));
  if (dead()) { res.hold = 'wiped'; res.note = 'wiped in warm-up'; return res; }

  // 2. the Hold is offered; work out the pad and the routes
  startObjective(ctx, 'hold');
  const O = ctx.objective!;
  const padK = tileOf(ctx, O.x, O.z);
  const startK = tileOf(ctx, P.x, P.z);
  const FUNNEL = 12, SHOULDER = rC + 3;
  let aSet = approaches(ctx, startK, padK, [P.x + W.half, P.z + W.half], FUNNEL, [O.x + W.half, O.z + W.half], SHOULDER);
  if (!aSet) { res.note = 'no route to the pad'; return res; }
  const want = o.route ?? 'direct';
  let toPad = want === 'direct' || !aSet.other ? aSet.shortest : aSet.other;
  if (want === 'flank' && !aSet.other) res.note += 'no second route; ';
  res.route = want === 'flank' && !aSet.other ? 'direct(only)' : want;

  // 3. travel
  const avoidTo = want === 'flank' && aSet.other ? avoidOf(ctx, aSet.shortest, [P.x + W.half, P.z + W.half], FUNNEL, [O.x + W.half, O.z + W.half], SHOULDER) : undefined;
  const fol = new Follower(toPad, (from) => routeTo(ctx, from, padK, avoidTo) ?? routeTo(ctx, from, padK));
  const t0 = ctx.time, hp0 = totalHp(); let lastHp = hp0, lastDmg = ctx.stats.damageTaken;
  const raidFilter = (i: number) => E.alive[i] && (E.roles[i] & ROLE.raider) !== 0;
  let activated = false, actAt = 0;
  const tileStr = () => { const k = W.tile(P.x, P.z); return `${k % W.w},${(k / W.w) | 0}`; };
  let contactSeen = false;
  const budget = 75;
  while (ctx.time - t0 < budget && !dead()) {
    const s = fol.steer(ctx);
    // arrived: standing on the pad starts the Hold
    if (O.phase === 'active') { activated = true; break; }
    if (s.done) { tick(leash(ctx, O.x, O.z, 2.5)); if ((O.phase as string) === 'active') { activated = true; break; } continue; }
    const before = ctx.stats.damageTaken;
    if (o.verbose && Math.floor((ctx.time - t0) * 2) !== Math.floor((ctx.time - t0 - ctx.dt) * 2) && Math.floor(ctx.time - t0) % 3 === 0) { let c3 = 0, c8 = 0; for (let i = 0; i < E.hi; i++) if (E.alive[i]) { const d = Math.hypot(E.x[i] - P.x, E.z[i] - P.z); if (d < 3) c3++; if (d < 8) c8++; } console.log(`  t=${(ctx.time - t0).toFixed(1)} tile ${tileStr()} y ${P.y.toFixed(2)} frac ${fol.frac.toFixed(2)} steer ${s.mx.toFixed(2)},${s.mz.toFixed(2)} v ${Math.hypot(P.vx, P.vz).toFixed(1)} enemies<3m ${c3} <8m ${c8} hp ${totalHp().toFixed(0)} live ${E.count}`); }
    tick(buttons(ctx, s.mx, s.mz));
    const dmg = ctx.stats.damageTaken - before;
    if (dmg > 0) res.routeDmg[Math.min(9, Math.floor(fol.frac * 10))] += dmg;
    // first contact: a hostile within touching range, or damage
    let nearest = Infinity, nearI = -1, nearRaid = Infinity;
    for (let i = 0; i < E.hi; i++) { if (!E.alive[i]) continue; const d = Math.hypot(E.x[i] - P.x, E.z[i] - P.z); if (d < nearest) { nearest = d; nearI = i; } if (E.roles[i] & ROLE.raider && d < nearRaid) nearRaid = d; }
    if (!res.contactAny && (nearest < 2.2 || dmg > 0)) res.contactAny = { t: +(ctx.time - t0).toFixed(1), frac: +fol.frac.toFixed(2), what: nearI >= 0 ? (E.roles[nearI] & ROLE.raider ? 'raider' : 'horde') : 'damage', tile: tileStr() };
    if (!res.contactRaid && nearRaid < 4) res.contactRaid = { t: +(ctx.time - t0).toFixed(1), frac: +fol.frac.toFixed(2), tile: tileStr() };
    contactSeen = contactSeen || !!res.contactAny;
  }
  res.reach = dead() ? null : +(ctx.time - t0).toFixed(1);
  if (fol.replans) res.note += `replanned ${fol.replans}x; `;
  res.reachFrac = +fol.frac.toFixed(2);
  res.travelDmg = +((hp0 - totalHp()) / totalMax()).toFixed(3);
  if (dead()) { res.hold = 'wiped'; res.note += `wiped on the way (${(fol.frac * 100).toFixed(0)}% along)`; return res; }

  // 4. the Hold on the pad (the Raid party is spawned by activation: it leaves team B's staging)
  if (!activated && O.phase !== 'active') { while (O.phase === 'offer' && ctx.time - t0 < budget + 20 && !dead()) tick(leash(ctx, O.x, O.z, 2.5)); }
  if (O.phase !== 'active') { res.note += 'Hold never activated'; return res; }
  actAt = ctx.time; actClock = ctx.time; padX = O.x; padZ = O.z;
  // the two B approaches, for classifying what the Raiders did
  let bSet: ReturnType<typeof approaches> = null;
  if (stageB && contest) bSet = approaches(ctx, tileOf(ctx, stageB[0] - W.half, stageB[1] - W.half), padK, stageB, FUNNEL, contest, SHOULDER);
  const trail = new Map<number, [number, number][]>();
  // raid `alt`: steer the Raiders along B's other approach (the one the flow field does not take)
  if (o.raid === 'alt' && bSet?.other) {
    const alt = bSet.other, pts = alt.map((v) => xz(ctx, v)), orig = W.goalDir.bind(W);
    W.goalDir = (x: number, z: number, out: [number, number], y?: number) => {
      let bi = -1, bd = Infinity;
      for (let j = 0; j < pts.length; j++) { const d = Math.hypot(pts[j][0] - x, pts[j][1] - z); if (d < bd) { bd = d; bi = j; } }
      if (bd > 3.5 || bi < 0) return orig(x, z, out, y);
      // the farthest of the next few path points that is a clear straight walk (never clip a corner: the path is 4-connected)
      let t = pts[Math.min(pts.length - 1, bi + 1)];
      for (let a = 4; a >= 1; a--) {
        const c = pts[Math.min(pts.length - 1, bi + a)], L0 = Math.hypot(c[0] - x, c[1] - z), steps = Math.ceil(L0 / 0.25);
        let clear = true;
        for (let q = 1; q <= steps && clear; q++) { const px = x + ((c[0] - x) * q) / steps, pz = z + ((c[1] - z) * q) / steps; for (const [ox, oz] of [[0, 0], [0.4, 0], [-0.4, 0], [0, 0.4], [0, -0.4]]) if (W.blocks(px + ox, pz + oz, y ?? 0, 0.6)) { clear = false; break; } }
        if (clear) { t = c; break; }
      }
      const dx = t[0] - x, dz = t[1] - z, L = Math.hypot(dx, dz);
      if (L < 0.01) return orig(x, z, out, y);
      out[0] = dx / L; out[1] = dz / L; return true;
    };
  }
  const holdStart = ctx.time; let lastSample = -1, lastCharge = O.charge, outFor = 0; let back0: Follower | null = null;
  const hold0 = totalHp(); let nearPeak = 0;
  const padR = ctx.rules.objectives.hold.radius;
  while ((O.phase as string) === 'active' && ctx.time - holdStart < (o.maxHold ?? 70) && !dead()) {
    const dPad = Math.hypot(P.x - O.x, P.z - O.z), out = dPad > padR;
    outFor = dPad > padR - 0.5 ? outFor + ctx.dt : 0;
    // knocked off the pad (or round the wrong side of a ruin wall): walk back by the route, not in a straight line
    if (outFor > 1) { if (!back0 || back0.i >= back0.path.length - 3) back0 = new Follower(routeTo(ctx, tileOf(ctx, P.x, P.z), padK) ?? [], (from) => routeTo(ctx, from, padK)); const s = back0.path.length ? back0.steer(ctx) : { mx: 0, mz: 0, done: true }; tick(s.done ? leash(ctx, O.x, O.z, padR - 1.2) : buttons(ctx, s.mx, s.mz)); }
    else { back0 = null; tick(leash(ctx, O.x, O.z, padR - 1.2)); }
    if (out) res.outSeconds += ctx.dt;
    if (O.charge < lastCharge) res.drained += lastCharge - O.charge;
    lastCharge = O.charge;
    let onPad = 0, near = 0, nearH = 0;
    for (let i = 0; i < E.hi; i++) {
      if (!E.alive[i]) continue;
      const d = Math.hypot(E.x[i] - O.x, E.z[i] - O.z);
      if (E.roles[i] & ROLE.raider) { if (d < 2) onPad++; if (d < 8) near++; } else if (d < 8) nearH++;
      if (E.roles[i] & ROLE.raider && d < padR && res.raidAt === null) res.raidAt = +(ctx.time - actAt).toFixed(1);
      if (E.roles[i] & ROLE.raider && d < 14 && res.raidSeenT === null) res.raidSeenT = +(ctx.time - actAt).toFixed(1);
    }
    if (o.verbose && Math.abs(((ctx.time - actAt) % 3)) < ctx.dt) { const rs: string[] = []; for (let i = 0; i < E.hi; i++) if (raidFilter(i)) { let nb = 0; for (let j = 0; j < E.hi; j++) if (j !== i && E.alive[j] && Math.hypot(E.x[j] - E.x[i], E.z[j] - E.z[i]) < 1.5) nb++; const k = W.tile(E.x[i], E.z[i]); rs.push(`(${k % W.w},${(k / W.w) | 0})${Math.hypot(E.x[i] - O.x, E.z[i] - O.z).toFixed(0)}m/y${E.y[i].toFixed(1)}/v${Math.hypot(E.vx[i], E.vz[i]).toFixed(1)}/nb${nb}`); } console.log(`  hold t=${(ctx.time - actAt).toFixed(1)} trainer d${dPad.toFixed(1)}m y${P.y.toFixed(1)} (${tileStr()}) charge ${O.charge.toFixed(2)} raiders [${rs.join(' ')}] near8 ${near}+${nearH} live ${E.count} hp ${totalHp().toFixed(0)}`); }
    if (onPad) res.padSeconds += ctx.dt;
    res.padPressure.raiders += near * ctx.dt; res.padPressure.horde += nearH * ctx.dt; nearPeak = Math.max(nearPeak, near + nearH);
    if (ctx.time - lastSample >= 0.5) { lastSample = ctx.time; for (let i = 0; i < E.hi; i++) if (raidFilter(i)) { const a = trail.get(E.gen[i] * 100000 + i) ?? []; a.push([E.x[i], E.z[i]]); trail.set(E.gen[i] * 100000 + i, a); } }
  }
  res.holdDmg = +((hold0 - totalHp()) / totalMax()).toFixed(3);
  res.padPressure = { raiders: +(res.padPressure.raiders / Math.max(1, ctx.time - holdStart)).toFixed(2), horde: +(res.padPressure.horde / Math.max(1, ctx.time - holdStart)).toFixed(2), peakNear: nearPeak };
  res.padSeconds = +res.padSeconds.toFixed(1); res.outSeconds = +res.outSeconds.toFixed(1); res.drained = +res.drained.toFixed(2);
  res.endCharge = +O.charge.toFixed(2);
  res.hold = dead() ? 'wiped' : (O.phase as string) === 'done' ? 'done' : 'failed';
  res.holdT = res.hold === 'done' ? +(ctx.time - holdStart).toFixed(1) : null;
  if (bSet && stageB && contest) {
    const refs: Record<string, Path> = { shortest: bSet.shortest }; if (bSet.other) refs.other = bSet.other;
    const used = [...trail.values()].filter((t) => t.length > 3).map((t) => classify(ctx, t, refs, [[stageB![0] - W.half, stageB![1] - W.half], [contest![0] - W.half, contest![1] - W.half]], rC));
    res.raidersUsed = used;
    res.raidLen = { shortest: bSet.shortest.length, other: bSet.other?.length ?? 0 };
  }
  if (dead()) return res;

  // 5. retreat to the staging, by the approach we came by or the other one, with whatever is still alive
  const here = tileOf(ctx, P.x, P.z);
  const backWant = o.back ?? 'same';
  const aBack = approaches(ctx, here, spawn, [O.x + W.half, O.z + W.half], SHOULDER, [W.map.spawn[0], W.map.spawn[1]], FUNNEL);
  const cameBy = want === 'flank' && aSet.other ? 'other' : 'shortest';
  const useOther = (backWant === 'other') !== (cameBy === 'other');
  const back = aBack ? (useOther ? aBack.other ?? aBack.shortest : aBack.shortest) : null;
  if (o.verbose) console.log(`  back: want ${backWant} came ${cameBy} useOther ${useOther} shortest ${aBack?.shortest.length} other ${aBack?.other?.length ?? 'none'}`);
  if (back) {
    const avoidBack = useOther && aBack ? avoidOf(ctx, aBack.shortest, [O.x + W.half, O.z + W.half], SHOULDER, [W.map.spawn[0], W.map.spawn[1]], FUNNEL) : undefined;
    const f2 = new Follower(back, (from) => routeTo(ctx, from, spawn, avoidBack) ?? routeTo(ctx, from, spawn)), tb = ctx.time; const hb = totalHp();
    while (ctx.time - tb < 60 && !dead()) {
      const s = f2.steer(ctx);
      if (s.done) break;
      tick(buttons(ctx, s.mx, s.mz));
    }
    res.backT = dead() ? null : +(ctx.time - tb).toFixed(1);
    res.backDmg = +((hb - totalHp()) / totalMax()).toFixed(3);
    let c = 0, r = 0; for (let i = 0; i < E.hi; i++) if (E.alive[i]) { if (Math.hypot(E.x[i] - P.x, E.z[i] - P.z) < 8) c++; if (E.roles[i] & ROLE.raider) r++; }
    res.backContacts = c; res.backRaidersAlive = r;
    if (dead()) res.note += 'wiped on the way back; ';
  } else res.note += 'no way back; ';
  return res;
}

// ---- command line ----------------------------------------------------------------------------------------------

function parseSeeds(s: string): number[] { if (s.includes(':')) { const [a, b] = s.split(':').map(Number); return Array.from({ length: b }, (_, i) => a + i); } return s.split(',').map(Number); }
const fmt = (r: TacResult) => `${r.map} s${r.seed}/r${r.runSeed} stage${r.stage} ${r.route.padEnd(6)} back:${r.back.padEnd(5)} raid:${r.raid.padEnd(7)} horde:${r.horde ? 'on ' : 'off'} | reach ${r.reach ?? '-'}s contact ${r.contactAny ? `${r.contactAny.t}s@${(r.contactAny.frac * 100) | 0}% ${r.contactAny.what}` : 'none'} raidSeen ${r.contactRaid ? `${r.contactRaid.t}s@${(r.contactRaid.frac * 100) | 0}%` : '-'} travelDmg ${(r.travelDmg * 100).toFixed(0)}% | raiders@pad ${r.raidAt ?? '-'}s seen@14m ${r.raidSeenT ?? '-'}s firstHit ${r.raidHit ?? '-'}m@${r.raidHitT ?? '-'}s killed@ ${r.raidKills.map((k) => k.d + 'm/' + k.t + 's').join(',') || '-'} used ${r.raidersUsed.join('/') || '-'} | HOLD ${r.hold}${r.holdT ? ' ' + r.holdT + 's' : ''} drained ${r.drained} padSec ${r.padSeconds} out ${r.outSeconds}s dmg ${(r.holdDmg * 100).toFixed(0)}% faints ${r.faints} kills ${r.kills}(${r.killsRaid} raid) | back ${r.backT ?? '-'}s dmg ${(r.backDmg * 100).toFixed(0)}% near ${r.backContacts} ${Object.keys(r.hazard).length ? 'ENV ' + JSON.stringify(r.hazard) + ' ' : ''}${r.note}`;

if (process.argv[1]?.endsWith('habtac.ts')) {
  const which = process.argv[2] ?? 'river-gorge';
  const seeds = parseSeeds(process.argv[3] && !process.argv[3].startsWith('-') ? process.argv[3] : '3');
  const routes = arg('route', 'both') === 'both' ? ['direct', 'flank'] : [arg('route', 'direct')];
  const raids = arg('raid', 'both') === 'both' ? ['natural', 'alt'] : [arg('raid', 'natural')];
  const backs = arg('back', 'same') === 'both' ? ['same', 'other'] : [arg('back', 'same')];
  const runs = parseSeeds(arg('runs', '1'));
  const hordes = arg('horde', 'on') === 'both' ? [true, false] : [arg('horde', 'on') !== 'off'];
  const all: TacResult[] = [];
  for (const map of which === 'all' ? ['river-gorge', 'volcanic-ridge'] : which.split(',')) for (const seed of seeds) for (const runSeed of runs) for (const horde of hordes) for (const raid of raids) for (const route of routes) for (const back of backs) {
    const r = playHold({ map, seed, runSeed, stage: process.argv.includes('--stage') ? Number(arg('stage', '0')) : undefined, squad: arg('squad', 'bulbasaur,mareep,geodude').split(','), level: Number(arg('level', '10')), warm: Number(arg('warm', '100')), horde, recycle: arg('recycle', 'on') !== 'off', raid: raid as 'natural' | 'alt', route: route as 'direct' | 'flank', back: back as 'same' | 'other', verbose: flag('-v') });
    all.push(r); console.log(fmt(r));
  }
  const ji = process.argv.indexOf('--json'); if (ji > 0) writeFileSync(process.argv[ji + 1], JSON.stringify(all, null, 1));
}
