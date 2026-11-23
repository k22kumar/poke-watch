// S1 spike §7: controller fit probes. npx tsx scripts/s1/fit.ts
//  A  the highest step each class gets onto, and with what (autostep vs the capsule's round bottom riding the edge)
//  B  moving kinematic platforms (horizontal, vertical): carried or not, and the workaround
//  C  ghost collisions on trimesh seams: a capsule (controller) and a dynamic ball sliding across a floor of separate
//     quads (duplicated vertices), merged vertices, FIX_INTERNAL_EDGES, and a floor of separate 1 m boxes
//  D  the exact-fit underpass: an XL (2.4 m) under a 2.4 m gap on a box floor vs a heightfield floor, by shape margin
//  E  wall slide along a wall made of 1 m boxes (seams in the wall) at a shallow angle: speed kept or stuck
import type { World as RWorld } from '@dimforge/rapier3d-deterministic/exports';
import { initRapierNode } from '../../src/physics/node';
import { defaultRules } from '../../src/rules/defaults';
import { DT, KCC, makeCharacter, type Body } from './courselib';

const { R } = await initRapierNode('deterministic');
const C = defaultRules.size.classes, G = defaultRules.player.gravity;

function walk(w: RWorld, B: Body, ticks: number, vx: number, vz: number, each?: (t: number, mvx: number, mvy: number, mvz: number) => void, carry?: () => { x: number; y: number; z: number }) {
  let vy = 0;
  for (let t = 0; t < ticks; t++) {
    vy -= G * DT;
    const c = carry ? carry() : { x: 0, y: 0, z: 0 };
    B.ctl.computeColliderMovement(B.col, { x: vx * DT + c.x, y: vy * DT + c.y, z: vz * DT + c.z });
    const m = B.ctl.computedMovement(), p = B.body.translation();
    if (B.ctl.computedGrounded() && vy < 0) vy = 0;
    B.body.setNextKinematicTranslation({ x: p.x + m.x, y: p.y + m.y, z: p.z + m.z });
    w.step();
    each?.(t, m.x, m.y, m.z);
  }
}

// A: max step climbed
console.log('A  highest step climbed (walk 6 m/s into a 10 m block; autostep 0.6, minWidth 0.2), step heights 0.05 m apart');
for (const autostep of [true, false]) {
  const row: string[] = [];
  for (const c of C) {
    let best = 0;
    for (let s = 0.05; s <= 1.5001; s += 0.05) {
      const w = new R.World({ x: 0, y: 0, z: 0 });
      w.createCollider(R.ColliderDesc.cuboid(20, 0.5, 20).setTranslation(0, -0.5, 0));
      w.createCollider(R.ColliderDesc.cuboid(5, s / 2, 5).setTranslation(8, s / 2, 0));
      const B = makeCharacter(R, w, c.body, c.height, 0, 0, 0);
      if (!autostep) B.ctl.disableAutostep();
      w.step();
      walk(w, B, 120, 6, 0);
      const p = B.body.translation();
      if (p.x > 3.5 && p.y - c.height / 2 > s - 0.05) best = s;
      w.free();
    }
    row.push(`${c.id} ${best.toFixed(2)}`);
  }
  console.log(`   ${autostep ? 'autostep on ' : 'autostep off'}: ${row.join('  ')}`);
}

// B: moving platforms
console.log('B  moving kinematic platform (4 × 4 m slab, 2 m/s), Medium capsule standing still on it for 3 s');
for (const [name, v] of [['horizontal +x', { x: 2, y: 0, z: 0 }], ['vertical up', { x: 0, y: 2, z: 0 }], ['vertical down', { x: 0, y: -2, z: 0 }]] as const) {
  for (const carry of [false, true]) {
    const w = new R.World({ x: 0, y: 0, z: 0 });
    w.createCollider(R.ColliderDesc.cuboid(30, 0.5, 30).setTranslation(0, -0.5, 0));
    const plat = w.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setTranslation(0, 1 + 0.25 + (v.y < 0 ? 6 : 0), 0));
    w.createCollider(R.ColliderDesc.cuboid(2, 0.25, 2), plat);
    const c = C[2];
    const B = makeCharacter(R, w, c.body, c.height, 0, 1.5 + (v.y < 0 ? 6 : 0) + 0.02, 0);
    w.step();
    let dy = 0;
    // one world.step() per tick (the game loop): the character resolves against the platform where it is now, with the
    // platform's coming delta added when carried; then both next positions are set and the world steps once
    let vy = 0, maxGap = 0;
    for (let t = 0; t < 180; t++) {
      const d = { x: v.x * DT, y: v.y * DT, z: v.z * DT };
      vy -= G * DT;
      const want = { x: carry ? d.x : 0, y: vy * DT + (carry ? d.y : 0), z: carry ? d.z : 0 };
      B.ctl.computeColliderMovement(B.col, want);
      const m = B.ctl.computedMovement(), p = B.body.translation(), q0 = plat.translation();
      if (B.ctl.computedGrounded() && vy < 0) vy = 0;
      B.body.setNextKinematicTranslation({ x: p.x + m.x, y: p.y + m.y, z: p.z + m.z });
      plat.setNextKinematicTranslation({ x: q0.x + d.x, y: q0.y + d.y, z: q0.z + d.z });
      w.step();
      const q = plat.translation(), feet = B.body.translation().y - c.height / 2, top = q.y + 0.25;
      dy = feet - top; if (Math.abs(B.body.translation().x - q.x) < 2 && Math.abs(dy) > maxGap) maxGap = Math.abs(dy);
    }
    const p = B.body.translation(), q = plat.translation();
    console.log(`   ${name.padEnd(14)} ${carry ? 'carried (delta added)' : 'no carry            '}: on platform at end ${Math.abs(p.x - q.x) < 2 && Math.abs(dy) < 0.05 ? 'yes' : 'NO'} (body x ${p.x.toFixed(2)} vs platform ${q.x.toFixed(2)}; feet − top ${dy.toFixed(3)} m, worst gap while over it ${maxGap.toFixed(3)} m)`);
    w.free();
  }
}

// C: seams
console.log('C  ghost collisions: 20 × 20 m floor at y = 0 made of 1 m cells; Medium controller walks 6 m/s at 30° across the');
console.log('   seams for 3 s (counts contacts whose normal is not up, and the worst vertical bump); a dynamic ball (r 0.3,');
console.log('   friction 0) launched at 8 m/s along the same line (worst bounce above rest, speed kept)');
function floor(w: RWorld, kind: string) {
  if (kind === 'boxes') { for (let i = -10; i < 10; i++) for (let j = -10; j < 10; j++) w.createCollider(R.ColliderDesc.cuboid(0.5, 0.5, 0.5).setTranslation(i + 0.5, -0.5, j + 0.5)); return; }
  const P: number[] = [], I: number[] = [];
  for (let i = -10; i < 10; i++) for (let j = -10; j < 10; j++) {
    const b = P.length / 3;
    P.push(i, 0, j, i, 0, j + 1, i + 1, 0, j + 1, i + 1, 0, j);
    I.push(b, b + 1, b + 2, b, b + 2, b + 3);
  }
  const flags = kind === 'separate' ? 0 : kind === 'merged' ? R.TriMeshFlags.MERGE_DUPLICATE_VERTICES : kind === 'merged+oriented' ? R.TriMeshFlags.MERGE_DUPLICATE_VERTICES | R.TriMeshFlags.ORIENTED : R.TriMeshFlags.FIX_INTERNAL_EDGES;
  const P32 = Float32Array.from(P), I32 = Uint32Array.from(I);
  w.createCollider(flags ? R.ColliderDesc.trimesh(P32, I32, flags) : R.ColliderDesc.trimesh(P32, I32));
}
for (const kind of ['separate', 'merged', 'FIX_INTERNAL_EDGES', 'boxes']) {
  const w = new R.World({ x: 0, y: -G, z: 0 });
  floor(w, kind);
  const c = C[2], B = makeCharacter(R, w, c.body, c.height, -8, 0.02, -6);
  w.step();
  let ghosts = 0, bump = 0, dist = 0;
  const vx = 6 * 0.866, vz = 6 * 0.5;
  walk(w, B, 180, vx, vz, (t, mx, my, mz) => {
    for (let i = 0; i < B.ctl.numComputedCollisions(); i++) { const k = B.ctl.computedCollision(i)!; if (k.normal1.y < 0.99) ghosts++; }
    if (t > 10) bump = Math.max(bump, Math.abs(B.body.translation().y - c.height / 2 - KCC.offset));
    dist += Math.sqrt(mx * mx + mz * mz);
  });
  // dynamic ball
  const ball = w.createRigidBody(R.RigidBodyDesc.dynamic().setTranslation(-8, 0.3, 6).setLinvel(8 * 0.866, 0, -8 * 0.5).lockRotations());
  w.createCollider(R.ColliderDesc.ball(0.3).setFriction(0).setFrictionCombineRule(R.CoefficientCombineRule.Min).setRestitution(0), ball);
  let up = 0;
  for (let t = 0; t < 120; t++) { w.step(); up = Math.max(up, ball.translation().y - 0.3); }
  const lv = ball.linvel();
  console.log(`   ${kind.padEnd(19)} controller: non-up contacts ${String(ghosts).padStart(3)}, worst |Δy| ${bump.toFixed(4)} m, walked ${dist.toFixed(2)} of ${(6 * 3).toFixed(2)} m   ball: worst bounce ${up.toFixed(4)} m, speed ${Math.sqrt(lv.x * lv.x + lv.z * lv.z).toFixed(3)} of 8 m/s, vy ${lv.y.toFixed(3)}`);
  w.free();
}

// D: exact-fit underpass
console.log('D  XL (h 2.4, r 0.88) walks 6 m/s under a 2.4 m gap (slab 2.4-3.0): through or stuck, by floor and shape margin');
for (const fl of ['box floor', 'heightfield floor', 'trimesh floor']) {
  const row: string[] = [];
  for (const margin of [0, 0.001, 0.005, 0.01]) {
    const w = new R.World({ x: 0, y: 0, z: 0 });
    if (fl === 'box floor') w.createCollider(R.ColliderDesc.cuboid(20, 0.5, 20).setTranslation(0, -0.5, 0));
    else if (fl === 'heightfield floor') w.createCollider(R.ColliderDesc.heightfield(40, 40, new Float32Array(41 * 41), { x: 40, y: 1, z: 40 }, R.HeightFieldFlags.FIX_INTERNAL_EDGES));
    else w.createCollider(R.ColliderDesc.trimesh(Float32Array.from([-20, 0, -20, -20, 0, 20, 20, 0, 20, 20, 0, -20]), Uint32Array.from([0, 1, 2, 0, 2, 3])));
    w.createCollider(R.ColliderDesc.cuboid(4, 0.3, 4).setTranslation(6, 2.7, 0));
    const c = C[4], B = makeCharacter(R, w, c.body, c.height - margin, 0, 0, 0.3);
    w.step();
    walk(w, B, 150, 6, 0);
    const p = B.body.translation();
    row.push(`margin ${margin}: ${p.x > 10.5 ? 'through' : 'stuck at x ' + p.x.toFixed(2)}`);
    w.free();
  }
  console.log(`   ${fl.padEnd(18)} ${row.join('  ')}`);
}

// E: wall slide along a seamed wall
console.log('E  wall slide: Medium walks 6 m/s at 20° into a 20 m wall (x = 1) made of 1 m boxes / one box / a merged trimesh');
for (const kind of ['1 m boxes', 'one box', 'trimesh quads']) {
  const w = new R.World({ x: 0, y: 0, z: 0 });
  w.createCollider(R.ColliderDesc.cuboid(30, 0.5, 30).setTranslation(0, -0.5, 0));
  if (kind === '1 m boxes') for (let j = -10; j < 10; j++) w.createCollider(R.ColliderDesc.cuboid(0.5, 1.5, 0.5).setTranslation(1.5, 1.5, j + 0.5));
  else if (kind === 'one box') w.createCollider(R.ColliderDesc.cuboid(0.5, 1.5, 10).setTranslation(1.5, 1.5, 0));
  else {
    const P: number[] = [], I: number[] = [];
    for (let j = -10; j < 10; j++) { const b = P.length / 3; P.push(1, 0, j, 1, 3, j, 1, 3, j + 1, 1, 0, j + 1); I.push(b, b + 1, b + 2, b, b + 2, b + 3); }
    w.createCollider(R.ColliderDesc.trimesh(Float32Array.from(P), Uint32Array.from(I), R.TriMeshFlags.FIX_INTERNAL_EDGES));
  }
  const c = C[2], B = makeCharacter(R, w, c.body, c.height, 0.3, 0, -9);
  w.step();
  let stuck = 0, dz = 0;
  walk(w, B, 180, 6 * 0.342, 6 * 0.94, (t, mx, my, mz) => { if (t > 20 && mz < 0.5 * 6 * 0.94 * DT) stuck++; dz += mz; });
  console.log(`   ${kind.padEnd(14)} slid ${dz.toFixed(2)} m along z (free walk ${(6 * 0.94 * 3).toFixed(2)}), ticks below half speed after the first 20: ${stuck}`);
  w.free();
}
