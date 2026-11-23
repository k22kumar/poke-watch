// S1 spike §7: the geometry alternative to stepping. The step's face gets an invisible 45° bevel (a trimesh wedge from
// the floor up to the top edge, run = rise); the controller climbs it as a slope (max slope 46°, Rapier autostep off),
// the same way it climbs the range's stairs. Same matrix as stepmatrix.ts.
import { initRapierNode } from '../../src/physics/node';
import { defaultRules } from '../../src/rules/defaults';
import { DT, makeCharacter } from './courselib';
const { R } = await initRapierNode('deterministic');
const speeds = [0.5, 1, 2, 4, 6, 9];
for (const S of [0.3, 0.5, 0.6, 0.65]) {
  console.log(`step ${S} m with a 45° bevel: speeds ${speeds.join('/')} m/s, head-on | 45° | 80° (grazing)`);
  for (const cl of defaultRules.size.classes) {
    const row = [0, 45, 80].map((deg) => speeds.map((sp) => {
      const w = new R.World({ x: 0, y: 0, z: 0 });
      w.createCollider(R.ColliderDesc.cuboid(30, 0.5, 30).setTranslation(0, -0.5, 0));
      w.createCollider(R.ColliderDesc.cuboid(5, S / 2, 20).setTranslation(8, S / 2, 0));
      const x0 = 3 - S, x1 = 3; // wedge: floor at x0 up to the top edge at x1, 40 m wide
      const P = Float32Array.from([x0, 0, -20, x0, 0, 20, x1, S, 20, x1, S, -20]);
      w.createCollider(R.ColliderDesc.trimesh(P, Uint32Array.from([0, 1, 2, 0, 2, 3])));
      const B = makeCharacter(R, w, cl.body, cl.height, 0, 0, 0);
      B.ctl.disableAutostep();
      w.step();
      const a = (deg * Math.PI) / 180, vx = sp * Math.cos(a), vz = sp * Math.sin(a);
      let vy = 0;
      for (let t = 0; t < Math.round(6 / vx / DT); t++) {
        vy -= 30 * DT;
        B.ctl.computeColliderMovement(B.col, { x: vx * DT, y: vy * DT, z: vz * DT });
        const m = B.ctl.computedMovement(), p = B.body.translation();
        if (B.ctl.computedGrounded() && vy < 0) vy = 0;
        B.body.setNextKinematicTranslation({ x: p.x + m.x, y: p.y + m.y, z: p.z + m.z }); w.step();
      }
      const p = B.body.translation(), ok = p.x > 3.5 && p.y - cl.height / 2 > S - 0.05;
      w.free();
      return ok ? '#' : '.';
    }).join('')).join(' | ');
    console.log(`  ${cl.id.padEnd(6)} ${row}`);
  }
}
