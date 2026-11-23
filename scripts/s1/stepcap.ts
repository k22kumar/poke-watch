// S1 spike §7: which autostep max height makes each class climb exactly the sim's 0.6 m step (and refuse 0.65), at
// 0.01 m resolution, approach at 6 m/s and at 2 m/s, head-on and at 45°
import { initRapierNode } from '../../src/physics/node';
import { defaultRules } from '../../src/rules/defaults';
import { DT, KCC, makeCharacter } from './courselib';
const { R } = await initRapierNode('deterministic');
const climbs = (c: { body: number; height: number }, auto: number, s: number, speed: number, diag: boolean) => {
  const w = new R.World({ x: 0, y: 0, z: 0 });
  w.createCollider(R.ColliderDesc.cuboid(20, 0.5, 20).setTranslation(0, -0.5, 0));
  w.createCollider(R.ColliderDesc.cuboid(5, s / 2, 5).setTranslation(8, s / 2, 0));
  const B = makeCharacter(R, w, c.body, c.height, 0, 0, 0, { ...KCC, autostep: auto });
  w.step();
  let vy = 0;
  const vx = diag ? speed * 0.7071 : speed, vz = diag ? speed * 0.7071 : 0;
  for (let t = 0; t < Math.round(8 / speed / DT) + 60; t++) {
    vy -= 30 * DT;
    B.ctl.computeColliderMovement(B.col, { x: vx * DT, y: vy * DT, z: vz * DT });
    const m = B.ctl.computedMovement(), p = B.body.translation();
    if (B.ctl.computedGrounded() && vy < 0) vy = 0;
    B.body.setNextKinematicTranslation({ x: p.x + m.x, y: p.y + m.y, z: p.z + m.z });
    w.step();
  }
  const p = B.body.translation(), ok = p.x > 3.5 && p.y - c.height / 2 > s - 0.05;
  w.free();
  return ok;
};
for (const c of defaultRules.size.classes) {
  const out: string[] = [];
  for (const auto of [0.6, 0.55, 0.5, 0.45, 0.4, 0.35]) {
    const cases = [[6, false], [2, false], [6, true]] as const;
    const max = cases.map(([sp, dg]) => { let best = 0; for (let s = 0.4; s <= 0.9001; s += 0.01) if (climbs(c, auto, s, sp, dg)) best = s; return best.toFixed(2); });
    out.push(`auto ${auto}: ${max.join('/')}`);
  }
  console.log(`${c.id.padEnd(6)} r ${c.body}  max step climbed (6 m/s / 2 m/s / 6 m/s at 45°)  ${out.join('  ')}`);
}
