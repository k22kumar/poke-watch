// Enemies on the 3D stack (task I1c; docs/OVERHAUL_3D.md "Actors (I1c)"; owner's Q1 and Q2 of 2026-11-27). With both
// flags on (rules/defaults.ts is3D) a ground enemy's move resolves here instead of the tile World's moveBody:
//   walking (mesh 0)   it stays on its width group's navmesh. A move is taken when its end is on a polygon of the group
//                      and Rapier's support there is within the snap-down rule (rules.enemy fall: 0.65 m below the feet,
//                      up to a step above); the one ground ray per moving enemy per tick is that support, and it is the
//                      enemy's height. Refused, it slides along one axis or stands, and follows the field a while. It
//                      leaves the mesh on its own only over a drop link toward its goal (src/nav/graph.ts drops), or into
//                      a liquid it is safe in.
//   on a drop (mesh 1) it walks straight out along the link for the link's distance, through a Rapier sweep, and falls
//                      under the sim's gravity onto the landing; grounded at the end it rejoins the mesh.
//   off the mesh (2)   a knock past rules.hazards.forcedKnock, a swim, a landing where no polygon is: the move is a Rapier
//                      sweep with one slide, the height Rapier's support (a rise up to a step is climbed, anything lower is
//                      fallen to: no snap), and avoidsStep keeps it out of open air and lethal liquids unless knocked.
//                      Grounded on a polygon it rejoins the mesh; grounded beside one (rules.nav.offMesh.rescue) it walks
//                      back; with none near for rules.nav.offMesh.putBack seconds it is put back with place().
// No controller and no Rapier body per enemy (S1 O2); no sweep for an enemy walking on the mesh.

import { NONE } from '../nav/graph';
import { RayHit } from '../world/sight';
import { navWide } from '../rules/sizing';
import { avoidsStep, safeIn } from './hazards';
import type { NavBridge } from './navseam';
import type { PhysicsWorld } from '../physics/world';
import type { SimContext } from './types';
import { GROUND, worldOf, type NavGoal } from './worldquery';

/** the snap-down rule (sim/enemies.ts, the tile path's fall test): supported while the support lies no more than this
 *  below the feet (plus the tick's fall) */
const SNAP = 0.65;
const PT = new Float64Array(3);
const HIT = new RayHit();
const OUT: [number, number] = [0, 0];

/** what the 3D movement did, for tests and tools (per run: reset with the bridge's counters) */
/** tests and tools: with `on`, every reused height is checked against a fresh ray (counts only; the sim uses the reuse) */
export const RAY_AUDIT = { on: false, reused: 0, differ: 0, maxErr: 0, ex: [] as string[] };

export interface Actor3DStats { reused: number; drops: number; landed: number; offMesh: number; rejoined: number; rescues: number; putBacks: number; timeouts: number; refused: number; sweeps: number; rays: number }
export function actorStats(B: NavBridge): Actor3DStats {
  const b = B as NavBridge & { actor3d?: Actor3DStats };
  return (b.actor3d ??= { reused: 0, drops: 0, landed: 0, offMesh: 0, rejoined: 0, rescues: 0, putBacks: 0, timeouts: 0, refused: 0, sweeps: 0, rays: 0 });
}

/** the radius a ground enemy's body moves with: its footprint, or its body radius when it has none */
const bodyR = (ctx: SimContext, i: number) => ctx.enemies.foot[i] > 0 ? ctx.enemies.foot[i] : ctx.enemies.radius[i];

/**
 * A sweep of the body (radius r, from a step above its feet at y to its head) from (x, z) by (dx, dz), with one slide
 * along what it meets; the end into OUT. A body that starts overlapping something moves only to a spot clear of it.
 */
function sweepMove(P: PhysicsWorld, S: Actor3DStats, x: number, y: number, z: number, dx: number, dz: number, r: number, tall: number, step: number): void {
  OUT[0] = x; OUT[1] = z;
  const L = Math.sqrt(dx * dx + dz * dz);
  if (!(L > 1e-9)) return;
  // the cylinder starts 1 cm over the step, so the top of a rise the body may climb is not touching it
  const lo = y + step + 0.01, hh = Math.max(0.025, (tall - step - 0.01) / 2), cy = lo + hh;
  let ux = dx / L, uz = dz / L;
  S.sweeps++;
  // a body overlapping something (a landing beside the face it fell past) may move out of it, never deeper
  if (!P.bodySweep(x, cy, z, ux, 0, uz, L, r, hh, HIT, true)) { OUT[0] = x + dx; OUT[1] = z + dz; return; }
  const t = Math.max(0, HIT.t - 0.005);
  let px = x + ux * t, pz = z + uz * t;
  // one slide: the rest of the move along the contact's plan tangent
  let nx = HIT.nx, nz = HIT.nz;
  const nl = Math.sqrt(nx * nx + nz * nz);
  OUT[0] = px; OUT[1] = pz;
  if (!(nl > 1e-6)) return;
  nx /= nl; nz /= nl;
  const rx = dx - ux * t, rz = dz - uz * t, dn = rx * nx + rz * nz;
  const sx = rx - nx * dn, sz = rz - nz * dn, sl = Math.sqrt(sx * sx + sz * sz);
  if (!(sl > 1e-6)) return;
  ux = sx / sl; uz = sz / sl;
  S.sweeps++;
  if (!P.bodySweep(px, cy, pz, ux, 0, uz, sl, r, hh, HIT, true)) { OUT[0] = px + sx; OUT[1] = pz + sz; return; }
  const t2 = Math.max(0, HIT.t - 0.005);
  px += ux * t2; pz += uz * t2;
  OUT[0] = px; OUT[1] = pz;
}

/** fall under the sim's gravity onto support s (no snap): the new feet; vy carries the fall */
function fall(ctx: SimContext, i: number, y: number, s: number, dt: number): number {
  const E = ctx.enemies;
  if (s >= y) { E.vy[i] = 0; return s; }
  E.vy[i] -= ctx.rules.player.gravity * dt;
  const ny = y + E.vy[i] * dt;
  if (ny <= s) { E.vy[i] = 0; return s; }
  return ny;
}

/** a steering probe on the 3D stack: is (x, z) off enemy i's own group's navmesh for feet at y (the edge its moves stop
 *  at: a wall, a face it cannot step, open air, a liquid, a drop)? */
export function offMesh3D(ctx: SimContext, i: number, x: number, y: number, z: number): boolean {
  const B = ctx.nav!, r = bodyR(ctx, i);
  return B.nav!.locate(B.groupOf(r, navWide(r, ctx.rules)), x, y, z, 0, PT) === NONE;
}

/**
 * Resolve ground enemy i's move from (ox, oz) toward (nx, nz) on the 3D stack: sets E.x, E.z, E.y and its mesh state.
 * `forced`: its knock is past rules.hazards.forcedKnock (it leaves the mesh); `goal`: the field it steers by (a drop is
 * taken only toward it); `blocked` is called when a walk was refused at the mesh's edge (the caller follows the field).
 */
export function moveGround3D(ctx: SimContext, i: number, ox: number, oz: number, nx: number, nz: number, forced: boolean, dt: number, goal: NavGoal, blocked: () => void): void {
  const E = ctx.enemies, B = ctx.nav!, W = worldOf(ctx), N = B.nav!, P = B.physFor(W), S = actorStats(B);
  const st = ctx.rules.player.stepHeight, R = ctx.rules.nav;
  const r = bodyR(ctx, i), tall = E.tall[i], g = B.groupOf(r, navWide(r, ctx.rules));
  const feet = E.py[i];
  if (E.mesh[i] === 0 && forced) { E.mesh[i] = 2; E.meshT[i] = 0; E.lrem[i] = 0; S.offMesh++; }
  if (E.mesh[i] !== 0) E.rayPoly[i] = -1; // off the mesh or on a link: the next walk casts afresh

  if (E.mesh[i] === 0) {
    const p = N.locate(g, ox, feet, oz, 0, PT);
    if (p === NONE) { E.mesh[i] = 2; E.meshT[i] = 0; E.lrem[i] = 0; S.offMesh++; }
    else {
      if (nx === ox && nz === oz) { E.x[i] = ox; E.z[i] = oz; E.y[i] = feet; return; }
      // the one ground ray: Rapier's support at the move's end, from a step above the feet
      // the owner's ground-ray budget (2026-11-27, option 1): on a flat polygon the support found by the last ray cast on
      // that same polygon is reused; entering another polygon, or on a sloped one, casts again
      const geo = W.tiles.geoGen; // a geometry change rebuilds the physics world and the navmesh: cast afresh
      const take = (x: number, z: number): number => {
        const q = N.locate(g, x, feet, z, 0, PT);
        if (q === NONE) return NaN;
        let s: number;
        if (E.rayPoly[i] === q && E.rayVer[i] === geo && N.graphs[g].isFlat(q) && P.boxPlanHas(E.rayBox[i], x, z)) {
          s = E.rayY[i]; S.reused++;
          if (RAY_AUDIT.on) { RAY_AUDIT.reused++; const t = P.bodySupportBelow(x, feet + st, z, st + SNAP + 0.05); if (t !== s) { RAY_AUDIT.differ++; if (RAY_AUDIT.ex.length < 6) RAY_AUDIT.ex.push(`${x.toFixed(2)},${z.toFixed(2)} feet ${feet} cached ${s} ray ${t} polyFloor ${PT[1]}`); RAY_AUDIT.maxErr = Math.max(RAY_AUDIT.maxErr, t === -Infinity ? Infinity : Math.abs(t - s)); } }
        } else {
          S.rays++;
          s = P.bodySupportBelow(x, feet + st, z, st + SNAP + 0.05);
          if (s === -Infinity) { E.rayPoly[i] = -1; return NaN; }
          // cached only when the ray stood on a box's exact top: the reuse then holds while the walker stays on the same flat
          // polygon and over the same box's plan (a flat polygon may span a small rise of another box), so it is exact
          if (P.supBox >= 0) { E.rayPoly[i] = q; E.rayVer[i] = geo; E.rayY[i] = s; E.rayBox[i] = P.supBox; } else E.rayPoly[i] = -1;
        }
        // a flat polygon's floor is exact: one far from the ground found there is another level's (a lower floor seen past
        // a lip within the layer). A sloped polygon's floor is read from its vertices and may be off by more than a metre
        // (ROADMAP F78: terraces), so only the ground decides there
        if (feet - s > SNAP || (N.graphs[g].isFlat(q) && Math.abs(PT[1] - s) > 1.0)) return NaN;
        return s;
      };
      let s = take(nx, nz);
      if (s === s) { E.x[i] = nx; E.z[i] = nz; E.y[i] = s; return; }
      // over a drop link toward the goal: onto the link
      const d = N.dropCrossed(g, B.fieldOf(W, goal, g), p, ox, oz, nx, nz);
      if (d !== NONE) {
        const D = N.drops(g)[d];
        sweepMove(P, S, ox, feet, oz, nx - ox, nz - oz, r, tall, st);
        E.x[i] = Math.fround(OUT[0]); E.z[i] = Math.fround(OUT[1]); E.y[i] = feet;
        E.mesh[i] = 1; E.meshT[i] = 0; E.ldx[i] = D.nx; E.ldz[i] = D.nz; E.lrem[i] = D.d; E.vy[i] = 0;
        S.drops++;
        return;
      }
      // into a liquid it is safe in (a swimmer's choice, as on the tile World): off the mesh
      const kind = W.liquidContact(nx, W.surfaceAt(nx, GROUND, nz), nz, ctx.rules.hazards.contact);
      if (kind && W.tiles.hazards && safeIn(ctx, kind, ctx.speciesIndex[E.species[i]])) {
        E.mesh[i] = 2; E.meshT[i] = 0; E.lrem[i] = 0; S.offMesh++;
      } else {
        // slide along the mesh's edge (Detour's moveAlongSurface in effect): the nearest point of its group's navmesh to
        // the move's end, within the move's length, nudged a hair back toward where it stands; then one axis; else stand
        S.refused++;
        blocked();
        const L = Math.sqrt((nx - ox) * (nx - ox) + (nz - oz) * (nz - oz));
        if (N.locate(g, nx, feet, nz, L + 0.01, PT) !== NONE) {
          const sx = Math.fround(PT[0] + (ox - PT[0]) * 1e-3), sz = Math.fround(PT[2] + (oz - PT[2]) * 1e-3);
          if ((sx !== ox || sz !== oz) && (s = take(sx, sz)) === s) { E.x[i] = sx; E.z[i] = sz; E.y[i] = s; return; }
        }
        if ((s = take(nx, oz)) === s) { E.x[i] = nx; E.z[i] = oz; E.y[i] = s; return; }
        if ((s = take(ox, nz)) === s) { E.x[i] = ox; E.z[i] = nz; E.y[i] = s; return; }
        E.x[i] = ox; E.z[i] = oz; E.y[i] = feet;
        return;
      }
    }
  }

  if (E.mesh[i] === 1) {
    // on a drop: straight out for the link's distance, then down
    E.meshT[i] += dt;
    let x = ox, z = oz;
    if (E.lrem[i] > 0) {
      const step = Math.min(E.lrem[i], Math.max(E.speed[i], 1) * dt);
      sweepMove(P, S, ox, feet, oz, E.ldx[i] * step, E.ldz[i] * step, r, tall, st);
      x = Math.fround(OUT[0]); z = Math.fround(OUT[1]);
      const moved = Math.sqrt((x - ox) * (x - ox) + (z - oz) * (z - oz));
      E.lrem[i] = moved < step * 0.5 ? 0 : E.lrem[i] - step; // stopped by something: no further out
    }
    S.rays++;
    const s = P.bodySupportBelow(x, feet + 0.01, z);
    const y = fall(ctx, i, feet, s === -Infinity ? W.killY - 1 : s, dt);
    E.x[i] = x; E.z[i] = z; E.y[i] = y;
    if (y === s && E.lrem[i] <= 0) {
      if (N.locate(g, x, y, z, 0, PT) !== NONE) { E.mesh[i] = 0; E.vy[i] = 0; S.landed++; S.rejoined++; }
      else { E.mesh[i] = 2; E.meshT[i] = 0; S.landed++; S.offMesh++; }
    } else if (E.meshT[i] > R.drops.timeout) { E.mesh[i] = 2; E.meshT[i] = 0; E.lrem[i] = 0; S.timeouts++; S.offMesh++; }
    return;
  }

  // off the mesh: sweep, slide, climb a step, fall by gravity
  E.meshT[i] += dt;
  let x = ox, z = oz;
  if (nx !== ox || nz !== oz) {
    sweepMove(P, S, ox, feet, oz, nx - ox, nz - oz, r, tall, st);
    x = Math.fround(OUT[0]); z = Math.fround(OUT[1]);
    // open air or a lethal liquid is never walked into on its own (hazards.ts avoidsStep), only knocked into
    if (!forced && avoidsStep(ctx, i, ox, oz, x, z, feet)) { x = ox; z = oz; }
  }
  S.rays++;
  const s = P.bodySupportBelow(x, feet + st, z);
  const y = fall(ctx, i, feet, s === -Infinity ? W.killY - 1 : s, dt);
  E.x[i] = x; E.z[i] = z; E.y[i] = y;
  E.lrem[i] = 0;
  if (y !== s || forced) return;
  // in a liquid: swimming (safe) or heading for the shore (sim/hazards.ts); it rejoins once out
  if (W.liquidContact(x, y, z, ctx.rules.hazards.contact)) return;
  // grounded: back on the mesh, or walk back to it, or put back
  if (N.locate(g, x, y, z, 0, PT) !== NONE) { E.mesh[i] = 0; E.meshT[i] = 0; S.rejoined++; return; }
  if (N.graphs[g].nearest(x, y, z, R.offMesh.rescue, () => true, PT) !== NONE) {
    const ax = PT[0] - x, az = PT[2] - z, L = Math.sqrt(ax * ax + az * az);
    if (L > 1e-6) { E.ldx[i] = ax / L; E.ldz[i] = az / L; E.lrem[i] = 1; S.rescues++; }
  }
  if (E.lrem[i] === 0 && E.meshT[i] > R.offMesh.putBack) {
    const [px, pz] = W.place(x, GROUND, z, r, navWide(r, ctx.rules), true, tall);
    E.x[i] = E.px[i] = px; E.z[i] = E.pz[i] = pz; E.y[i] = E.py[i] = W.surfaceAt(px, GROUND, pz);
    E.mesh[i] = 0; E.meshT[i] = 0; E.vy[i] = 0; S.putBacks++;
  }
}
