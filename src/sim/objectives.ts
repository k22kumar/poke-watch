// Objectives (blueprint section 9, Phase 7): Hold, Hunt and Transport.
//
// Each stage offers two, at the first beat-director Peak after 1:30 and after 3:20. None is required (only
// the boss is), each must be engaged within 45 s or it lapses, and each pays a scarce currency instead of
// gems: Hold pays an item ball (a technique once Phase 8 lands), Hunt pays a recruit, Transport an
// evolution (or a full heal). Ignoring or losing one brings a Peak forward rather than ending the run.
//   Hold       stand within 5 m of the pylon for 30 s; Raiders on the pad drain it
//   Hunt       a marked alpha of a recruitable species with an escort; at half health it runs to a Mender
//   Transport  carry the egg (walk into it: 70% speed, no Move A / B; Guard, Dash or Tag drops it) or push
//              it (Power 2) to the goal ~36 m away; Raiders steal a loose egg
// The schedule teaches one thing at a time: the first region opens with a Hold and then a Hunt (the first
// recruit lands around 4:00), the second with a Transport and then a Hunt (the second recruit around 9:00).

import { dhypot, dsin, dcos } from '../core/detmath';
import { clamp } from '../core/util';
import { STAGES } from '../rules/stages';
import { SPECIES_BY_ID } from '../rules/species';
import { TAG_ACTIONS } from '../rules/tags';
import { fits } from '../rules/compositions';
import { spawnBody, tpl } from './bodies';
import { compositionsFor, forcePeak, spawnComposition } from './director';
import { ringPoint, spawnEnemy } from './enemies';
import { ROLE } from './pools';
import { lineage, openOffer, recomputeMember } from './progression';
import { queueVariant } from './squad';
import type { Objective, ObjectiveKind, SimContext } from './types';

const SCHEDULE: ObjectiveKind[][] = [['hold', 'hunt'], ['transport', 'hunt']];

/** species from this region that could join the squad (not already in it) */
function recruitables(ctx: SimContext): string[] {
  const table = STAGES[ctx.stage % STAGES.length];
  const have = new Set(ctx.player.squad.map((m) => lineage(m.species)[0].id));
  return [...new Set([...table.spawns.map(([id]) => id), ...table.elites])].filter((id) => TAG_ACTIONS[id] && !have.has(id));
}

/** the objective the next Peak should open, if one is due */
export function objectiveDue(ctx: SimContext): ObjectiveKind | null {
  const O = ctx.rules.objectives, B = ctx.beat;
  if (!O.enabled || ctx.director.bossSpawned) return null;
  if (ctx.objective && (ctx.objective.phase === 'offer' || ctx.objective.phase === 'active')) return null;
  const n = B.objectives;
  if (n >= 2 || ctx.stageTime < (n === 0 ? O.firstAfter : O.secondAfter)) return null;
  const first = ctx.loop === 0 && ctx.stage < SCHEDULE.length;
  let kind: ObjectiveKind = first ? SCHEDULE[ctx.stage][n] : ctx.rng.spawn.pick(['hold', 'hunt', 'transport'] as ObjectiveKind[]);
  if (kind === 'hunt' && (ctx.player.squad.length >= ctx.rules.squad.max || !recruitables(ctx).length)) kind = n === 0 ? 'transport' : 'hold';
  return kind;
}

/** an open walkable point (r..R m from the player) with room around it */
function site(ctx: SimContext, rMin: number, rMax: number, fromX = ctx.player.x, fromZ = ctx.player.z): [number, number] {
  const W = ctx.world, b = W.bound - 4;
  for (let k = 0; k < 40; k++) {
    const a = ctx.rng.spawn.range(0, Math.PI * 2), r = ctx.rng.spawn.range(rMin, rMax);
    const x = Math.floor(clamp(fromX + dsin(a) * r, -b, b)) + 0.5, z = Math.floor(clamp(fromZ + dcos(a) * r, -b, b)) + 0.5;
    let ok = W.walkable(x, z);
    for (let q = 0; q < 8 && ok; q++) ok = W.walkable(x + dsin(q * 0.785) * 2.2, z + dcos(q * 0.785) * 2.2);
    if (ok) return [x, z];
  }
  return W.nearestWalkable(fromX + rMin, fromZ);
}

function blank(kind: ObjectiveKind, x: number, z: number, t: number): Objective {
  return { kind, phase: 'offer', t, x, z, sx: x, sz: z, charge: 0, target: -1, targetGen: 0, mender: -1, egg: -1, carrier: -1, species: '' };
}

/** open an objective; returns false when the region cannot host it */
export function startObjective(ctx: SimContext, kind: ObjectiveKind): boolean {
  const O = ctx.rules.objectives;
  let obj: Objective;
  if (kind === 'hold') {
    const [x, z] = site(ctx, 12, 20);
    obj = blank('hold', x, z, O.offerTime);
  } else if (kind === 'hunt') {
    const pool = recruitables(ctx);
    if (!pool.length) return false;
    const id = ctx.rng.spawn.pick(pool);
    const [rMin, rMax] = ctx.rules.enemy.spawnRadius;
    const [x, z] = ringPoint(ctx, rMin, rMax);
    const t = spawnEnemy(ctx, id, x, z, ROLE.alpha | ROLE.hunt);
    if (t < 0) return false;
    obj = blank('hunt', x, z, O.offerTime);
    obj.target = t; obj.targetGen = ctx.enemies.gen[t]; obj.species = id;
    // the escort, and the Mender it will run to (on the far side, away from you)
    const table = STAGES[ctx.stage % STAGES.length];
    const ids = [...new Set([...table.spawns.map(([s]) => s), ...table.elites])].map((s) => SPECIES_BY_ID[s]);
    const escorts = ids.filter((sp) => fits(sp, { job: 'pursuer', count: 1, roles: 0 }));
    for (let k = 0; k < O.hunt.escort && escorts.length; k++) spawnEnemy(ctx, ctx.rng.spawn.pick(escorts).id, x + dsin(k * 1.6) * 1.8, z + dcos(k * 1.6) * 1.8);
    const menders = ids.filter((sp) => fits(sp, { job: 'mender', count: 1, roles: 0 }));
    if (menders.length) {
      const P = ctx.player, dx = x - P.x, dz = z - P.z, L = dhypot(dx, dz) || 1;
      const [mx, mz] = ctx.world.nearestWalkable(clamp(x + (dx / L) * O.hunt.menderDistance, -ctx.world.bound + 3, ctx.world.bound - 3), clamp(z + (dz / L) * O.hunt.menderDistance, -ctx.world.bound + 3, ctx.world.bound - 3));
      obj.mender = spawnEnemy(ctx, ctx.rng.spawn.pick(menders).id, mx, mz, ROLE.healer);
    }
  } else {
    const [ex, ez] = site(ctx, 7, 11);
    const [gx, gz] = site(ctx, O.transport.distance * 0.85, O.transport.distance * 1.15, ex, ez);
    const egg = spawnBody(ctx, 'egg', ex, ez);
    if (egg < 0) return false;
    obj = blank('transport', gx, gz, O.offerTime);
    obj.sx = ex; obj.sz = ez; obj.egg = egg;
  }
  ctx.objective = obj;
  ctx.beat.objectives++;
  ctx.events.push({ t: 'objective', kind, phase: 'offer', x: obj.x, z: obj.z });
  return true;
}

function activate(ctx: SimContext, O: Objective) {
  const R = ctx.rules.objectives;
  O.phase = 'active';
  O.t = O.kind === 'hold' ? R.hold.limit : O.kind === 'hunt' ? R.hunt.limit : R.transport.limit;
  ctx.events.push({ t: 'objective', kind: O.kind, phase: 'active', x: O.x, z: O.z });
  // a raid party comes for it (Hunts bring their own escort)
  if (O.kind !== 'hunt') {
    const opts = compositionsFor(ctx, 'objective');
    if (opts.length) spawnComposition(ctx, ctx.rng.spawn.weighted(opts, (c) => c.weight));
  }
}

function finish(ctx: SimContext, O: Objective, ok: boolean, reward = '') {
  O.phase = ok ? 'done' : 'failed';
  O.t = 3;
  if (O.carrier === -2) ctx.player.carrying = false;
  O.carrier = -1;
  ctx.events.push({ t: 'objective', kind: O.kind, phase: ok ? 'done' : 'failed', x: O.x, z: O.z, reward });
  if (!ok) forcePeak(ctx);
}

/** the reward: Hold an item ball, Hunt a recruit, Transport an evolution (or a full heal) */
function reward(ctx: SimContext, O: Objective): string {
  const P = ctx.player;
  const itemBall = () => { if (ctx.cards.offer) ctx.cards.chestsQueued++; else openOffer(ctx, true); return 'item'; };
  if (O.kind === 'hold') return itemBall();
  if (O.kind === 'hunt') {
    if (P.squad.length >= ctx.rules.squad.max || ctx.recruit.pending) return itemBall();
    const other = recruitables(ctx).filter((id) => id !== O.species);
    ctx.recruit.pending = other.length ? [O.species, ctx.rng.cards.pick(other)] : [O.species];
    ctx.recruit.offered++;
    return 'recruit';
  }
  // Transport: the evolution stone evolves the field Pokémon if it can, else the first one that can
  const order = [P.active, ...P.squad.map((_, k) => k).filter((k) => k !== P.active)];
  for (const k of order) {
    const m = P.squad[k];
    const to = m.species.evolvesTo;
    if (m.fainted || !to || !SPECIES_BY_ID[to]) continue;
    const first = lineage(m.species).length === 1;
    const from = m.species.id;
    m.species = SPECIES_BY_ID[to];
    recomputeMember(ctx, m);
    m.hp = m.maxHp; m.grey = 0;
    ctx.events.push({ t: 'benchEvolve', from, to });
    if (first) queueVariant(ctx, k);
    return 'evolve:' + to;
  }
  for (const m of P.squad) if (!m.fainted) { m.hp = m.maxHp; m.grey = 0; }
  return 'heal';
}

export const objectiveSystem = {
  name: 'objectives',
  update(ctx: SimContext, dt: number) {
    const O = ctx.objective;
    if (!O) return;
    const P = ctx.player, E = ctx.enemies, R = ctx.rules.objectives;
    O.t -= dt;
    if (O.phase === 'done' || O.phase === 'failed') { if (O.t <= 0) ctx.objective = null; return; }
    if (ctx.director.bossSpawned && O.phase === 'offer') { O.phase = 'failed'; O.t = 0; ctx.events.push({ t: 'objective', kind: O.kind, phase: 'expired', x: O.x, z: O.z }); return; }
    const dP = dhypot(P.x - O.x, P.z - O.z);

    if (O.kind === 'hold') {
      if (O.phase === 'offer' && dP < R.hold.radius) activate(ctx, O);
      if (O.phase === 'active') {
        if (dP < R.hold.radius && P.faintT < 0) O.charge += dt / R.hold.time;
        // Raiders standing on the pad drain it
        const n = ctx.grid.query(O.x, O.z, 2);
        for (let k = 0; k < n; k++) { const e = ctx.grid.result[k]; if (E.alive[e] && E.roles[e] & ROLE.raider) O.charge -= R.hold.drain * dt; }
        O.charge = clamp(O.charge, 0, 1);
        if (O.charge >= 1) { finish(ctx, O, true, reward(ctx, O)); return; }
      }
    } else if (O.kind === 'hunt') {
      const alive = O.target >= 0 && E.alive[O.target] && E.gen[O.target] === O.targetGen;
      if (alive) { O.x = E.x[O.target]; O.z = E.z[O.target]; }
      if (!alive) { finish(ctx, O, true, reward(ctx, O)); return; }
      if (O.phase === 'offer' && E.hp[O.target] < E.maxHp[O.target]) activate(ctx, O);
    } else {
      const B = ctx.bodies, g = O.egg;
      if (g < 0 || !B.alive[g]) { finish(ctx, O, false); return; }
      const reach = tpl(ctx, g).radius + ctx.rules.player.radius + 0.3;
      if (O.carrier === -2) {
        // dropped by Guard, Dash, Tag, a faint or anything that ends normal play
        if (P.guardT >= 0 || P.dashT > 0 || P.tagPending >= 0 || P.faintT >= 0 || ctx.state !== 'play') { O.carrier = -1; P.carrying = false; }
        else { B.x[g] = P.x + dsin(P.facing) * 0.9; B.z[g] = P.z + dcos(P.facing) * 0.9; B.vx[g] = B.vz[g] = 0; }
      } else if (O.carrier >= 0) {
        const r = O.carrier;
        if (!E.alive[r]) O.carrier = -1;
        else { B.x[g] = E.x[r] - dsin(E.facing[r]) * 0.6; B.z[g] = E.z[r] - dcos(E.facing[r]) * 0.6; B.vx[g] = B.vz[g] = 0; }
      }
      if (O.carrier === -1) {
        if (dhypot(P.x - B.x[g], P.z - B.z[g]) < reach && P.faintT < 0 && P.guardT < 0 && P.dashT <= 0) { O.carrier = -2; P.carrying = true; }
        else {
          const n = ctx.grid.query(B.x[g], B.z[g], 1.2);
          for (let k = 0; k < n; k++) { const e = ctx.grid.result[k]; if (E.alive[e] && E.roles[e] & ROLE.raider) { O.carrier = e; break; } }
        }
      }
      if (O.phase === 'offer' && (O.carrier === -2 || dhypot(B.x[g] - O.sx, B.z[g] - O.sz) > 1.5)) activate(ctx, O);
      if (dhypot(B.x[g] - O.x, B.z[g] - O.z) < R.transport.goalRadius) {
        B.kill(g); O.egg = -1;
        finish(ctx, O, true, reward(ctx, O));
        return;
      }
    }

    if (O.t <= 0) {
      // lapsed (never engaged) or ran out of time: the target leaves, the egg stays put
      if (O.kind === 'hunt' && O.target >= 0 && E.alive[O.target] && E.gen[O.target] === O.targetGen) E.kill(O.target);
      if (O.kind === 'transport' && O.egg >= 0) ctx.bodies.kill(O.egg);
      if (O.phase === 'offer') ctx.events.push({ t: 'objective', kind: O.kind, phase: 'expired', x: O.x, z: O.z });
      finish(ctx, O, false);
    }
  },
};
