// S1 spike §7: the autostep workaround. Rapier's autostep (0.21) depends on speed and approach angle (stepmatrix.ts),
// so the step is ours: the controller resolves the plain move with its autostep off; when a grounded move came up short,
// three shape casts of the body's own capsule (up by STEP, forward by the wish, down by the rise plus the snap) and a ray
// down the body's axis decide a step. It is taken when the forward cast went further than the plain move, the cast lands
// on a face the feet stand on (the axis ray finds it within 5 cm: not a corner the round bottom perches on) and the face
// is at most STEP above the start. Then the body is set there directly (kinematic next translation).
import type { World as RWorld } from '@dimforge/rapier3d-deterministic/exports';
import { initRapierNode } from '../../src/physics/node';
import { defaultRules } from '../../src/rules/defaults';
import { DT, KCC, makeCharacter, type Body } from './courselib';

const { R } = await initRapierNode('deterministic');
const STEP = 0.6, ROT = { x: 0, y: 0, z: 0, w: 1 };
const RAY = new R.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 });

export interface StepStats { steps: number; casts: number }
/** one tick's move; returns the vertical velocity to keep (0 after a step or on ground) */
export function moveStep(w: RWorld, B: Body, want: { x: number; y: number; z: number }, grounded: boolean, st: StepStats): { grounded: boolean } {
  const p = B.body.translation();
  B.ctl.computeColliderMovement(B.col, want);
  const m = B.ctl.computedMovement(), g = B.ctl.computedGrounded();
  const wantH = Math.sqrt(want.x * want.x + want.z * want.z), gotH = Math.sqrt(m.x * m.x + m.z * m.z);
  if (grounded && wantH > 1e-6 && gotH < wantH * 0.9) {
    const shape = B.col.shape, off = KCC.offset, exc = B.col, feet0 = p.y - B.h / 2;
    st.casts += 4;
    // 1 up by STEP (a ceiling cuts it short)
    const UP = STEP + 2 * off; // the skin above a STEP-high top
    const hu = w.castShape(p, ROT, { x: 0, y: UP, z: 0 }, shape, off, 1, false, undefined, undefined, exc);
    const u = hu ? hu.time_of_impact * UP : UP;
    const pu = { x: p.x, y: p.y + u, z: p.z };
    // 2 probe one radius past the wish at that height: is there a face to stand on, at most STEP up?
    // probe along the blocking face's normal (the contact the plain move met), else along the wish
    let ux = want.x / wantH, uz = want.z / wantH;
    for (let i = 0; i < B.ctl.numComputedCollisions(); i++) {
      const n = B.ctl.computedCollision(i)!.normal1, l = Math.sqrt(n.x * n.x + n.z * n.z);
      if (Math.abs(n.y) < 0.7 && l > 1e-6 && (n.x * want.x + n.z * want.z) < 0) { ux = -n.x / l; uz = -n.z / l; break; }
    }
    const D = Math.max(wantH, B.r + 0.05);
    const hp = w.castShape(pu, ROT, { x: ux * D, y: 0, z: uz * D }, shape, off, 1, false, undefined, undefined, exc);
    if (!hp) {
      const pp = { x: pu.x + ux * D, y: pu.y, z: pu.z + uz * D };
      RAY.origin = pp;
      const hit = w.castRay(RAY, B.h / 2 + u + KCC.snap, true, undefined, undefined, exc);
      const face = hit ? pp.y - hit.timeOfImpact : -Infinity;
      if (face - feet0 > 0.02 && face - feet0 <= STEP + 1e-3) {
        // 3 the tick's own move at the raised height, 4 down onto what is there (the step's lip or its face)
        const hf = w.castShape(pu, ROT, { x: want.x, y: 0, z: want.z }, shape, off, 1, false, undefined, undefined, exc);
        const f = hf ? hf.time_of_impact : 1;
        const pf = { x: pu.x + want.x * f, y: pu.y, z: pu.z + want.z * f }, drop = u + KCC.snap;
        const hd = w.castShape(pf, ROT, { x: 0, y: -drop, z: 0 }, shape, off, 1, false, undefined, undefined, exc);
        if (hd && f * wantH > gotH + 1e-4) {
          // land with the feet at the face's height when that pose is free (the round bottom then rests on the lip, not
          // below it, and the next plain move slides onto the top); else where the down cast stopped
          const perch = pf.y - hd.time_of_impact * drop, atFace = face + B.h / 2 + off;
          const free = atFace > perch && !w.intersectionWithShape({ x: pf.x, y: atFace, z: pf.z }, ROT, shape, undefined, undefined, exc);
          st.casts++;
          B.body.setNextKinematicTranslation({ x: pf.x, y: free ? atFace : perch, z: pf.z });
          st.steps++;
          return { grounded: true };
        }
      }
    }
  }
  B.body.setNextKinematicTranslation({ x: p.x + m.x, y: p.y + m.y, z: p.z + m.z });
  return { grounded: g };
}

const speeds = [0.5, 1, 2, 4, 6, 9];
const cost = { steps: 0, casts: 0, ticks: 0 };
for (const S of [0.3, 0.5, 0.6, 0.62, 0.65, 0.8]) {
  console.log(`step ${S} m: speeds ${speeds.join('/')} m/s, head-on | 45° ('#' climbed)  [our step rule, Rapier autostep off]`);
  for (const cl of defaultRules.size.classes) {
    const row = [0, 45].map((deg) => speeds.map((sp) => {
      const w = new R.World({ x: 0, y: 0, z: 0 });
      w.createCollider(R.ColliderDesc.cuboid(30, 0.5, 30).setTranslation(0, -0.5, 0));
      w.createCollider(R.ColliderDesc.cuboid(5, S / 2, 20).setTranslation(8, S / 2, 0));
      const B = makeCharacter(R, w, cl.body, cl.height, 0, 0, 0);
      B.ctl.disableAutostep();
      w.step();
      const a = (deg * Math.PI) / 180, vx = sp * Math.cos(a), vz = sp * Math.sin(a);
      let vy = 0, grounded = true;
      for (let t = 0; t < Math.round(6 / vx / DT); t++) {
        vy -= 30 * DT;
        grounded = moveStep(w, B, { x: vx * DT, y: vy * DT, z: vz * DT }, grounded, cost).grounded;
        if (grounded && vy < 0) vy = 0;
        w.step(); cost.ticks++;
      }
      const p = B.body.translation(), ok = p.x > 3.5 && p.y - cl.height / 2 > S - 0.05;
      w.free();
      return ok ? '#' : '.';
    }).join('')).join(' | ');
    console.log(`  ${cl.id.padEnd(6)} ${row}`);
  }
}
console.log(`step rule ran ${cost.steps} steps over ${cost.ticks} ticks (${cost.casts} shape casts: only on ticks a grounded move came up short)`);
