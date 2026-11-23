// S1 spike §7: autostep success (a 0.5 m step, 20 m wide) by minWidth × approach speed × angle, per class
import { initRapierNode } from '../../src/physics/node';
import { defaultRules } from '../../src/rules/defaults';
import { DT, KCC, makeCharacter } from './courselib';
const { R } = await initRapierNode('deterministic');
const S = Number(process.argv[2] ?? 0.5);
function climbs(c: { body: number; height: number }, minW: number, speed: number, deg: number, snap = KCC.snap) {
  const w = new R.World({ x: 0, y: 0, z: 0 });
  w.createCollider(R.ColliderDesc.cuboid(30, 0.5, 30).setTranslation(0, -0.5, 0));
  w.createCollider(R.ColliderDesc.cuboid(5, S / 2, 20).setTranslation(8, S / 2, 0));
  const B = makeCharacter(R, w, c.body, c.height, 0, 0, 0, { ...KCC, autostepMinWidth: minW, snap });
  w.step();
  const a = (deg * Math.PI) / 180, vx = speed * Math.cos(a), vz = speed * Math.sin(a);
  let vy = 0;
  for (let t = 0; t < Math.round(6 / vx / DT); t++) {
    vy -= 30 * DT;
    B.ctl.computeColliderMovement(B.col, { x: vx * DT, y: vy * DT, z: vz * DT });
    const m = B.ctl.computedMovement(), p = B.body.translation();
    if (B.ctl.computedGrounded() && vy < 0) vy = 0;
    B.body.setNextKinematicTranslation({ x: p.x + m.x, y: p.y + m.y, z: p.z + m.z });
    w.step();
  }
  const p = B.body.translation(), ok = p.x > 3.5 && p.y - c.height / 2 > S - 0.05;
  w.free();
  return ok;
}
const speeds = [0.5, 1, 2, 4, 6, 9], mins = [0.02, 0.05, 0.1, 0.2, 0.3, 0.5];
console.log(`step ${S} m; cell = speeds ${speeds.join('/')} m/s, '#' climbed '.' blocked; head-on | 45°`);
for (const c of defaultRules.size.classes) for (const mw of mins) {
  const row = [0, 45].map((deg) => speeds.map((sp) => (climbs(c, mw, sp, deg) ? '#' : '.')).join('')).join(' | ');
  console.log(`${c.id.padEnd(6)} minWidth ${String(mw).padEnd(4)} ${row}`);
}
