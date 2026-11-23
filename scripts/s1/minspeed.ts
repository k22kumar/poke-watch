// S1 spike §7: the controller's smallest per-tick move: distance walked in 1 s on flat ground by speed and offset
// (Medium; with the body's gravity each tick, and without vertical intent)
import { initRapierNode } from '../../src/physics/node';
import { defaultRules } from '../../src/rules/defaults';
import { DT, KCC, makeCharacter } from './courselib';
const { R } = await initRapierNode('deterministic');
const cl = defaultRules.size.classes[2];
for (const grav of [true, false]) for (const offset of [0.01, 0.005, 0.002, 0.001]) {
  const row: string[] = [];
  for (const sp of [0.1, 0.3, 0.5, 0.6, 0.7, 1, 2]) {
    const w = new R.World({ x: 0, y: 0, z: 0 });
    w.createCollider(R.ColliderDesc.cuboid(30, 0.5, 30).setTranslation(0, -0.5, 0));
    const B = makeCharacter(R, w, cl.body, cl.height, 0, 0, 0, { ...KCC, offset });
    w.step();
    let vy = 0;
    for (let t = 0; t < 60; t++) {
      if (grav) vy -= 30 * DT;
      B.ctl.computeColliderMovement(B.col, { x: sp * DT, y: vy * DT, z: 0 });
      const m = B.ctl.computedMovement(), p = B.body.translation();
      if (B.ctl.computedGrounded() && vy < 0) vy = 0;
      B.body.setNextKinematicTranslation({ x: p.x + m.x, y: p.y + m.y, z: p.z + m.z }); w.step();
    }
    row.push(`${sp}:${B.body.translation().x.toFixed(2)}`);
    w.free();
  }
  console.log(`gravity ${grav ? 'on ' : 'off'} offset ${String(offset).padEnd(5)} m walked in 1 s (speed:distance) ${row.join('  ')}`);
}
