// S1 spike §7: autostep probe. A capsule per class walks +x at 6 m/s on a flat box floor into a step of height s;
// reports whether it got on top. npx tsx scripts/s1/probe-step.ts [minWidth] [snap]
import { initRapierNode } from '../../src/physics/node';
import { defaultRules } from '../../src/rules/defaults';
import { DT, KCC, makeCharacter } from './courselib';

const { R } = await initRapierNode('deterministic');
const minW = Number(process.argv[2] ?? KCC.autostepMinWidth), snap = Number(process.argv[3] ?? KCC.snap);
const opt = { ...KCC, autostepMinWidth: minW, snap };
console.log('minWidth', minW, 'snap', snap, 'autostep', opt.autostep);
for (const C of defaultRules.size.classes) {
  const row: string[] = [];
  for (const s of [0.2, 0.3, 0.4, 0.45, 0.5, 0.55, 0.6, 0.65]) {
    const w = new R.World({ x: 0, y: 0, z: 0 });
    w.createCollider(R.ColliderDesc.cuboid(20, 0.5, 20).setTranslation(0, -0.5, 0));
    w.createCollider(R.ColliderDesc.cuboid(5, s / 2, 5).setTranslation(8, s / 2, 0));
    const B = makeCharacter(R, w, C.body, C.height, 0, 0, 0, opt);
    w.step();
    let vy = 0, top = false;
    for (let t = 0; t < 120; t++) {
      vy -= defaultRules.player.gravity * DT;
      B.ctl.computeColliderMovement(B.col, { x: 6 * DT, y: vy * DT, z: 0 });
      const mv = B.ctl.computedMovement(), p = B.body.translation();
      if (B.ctl.computedGrounded() && vy < 0) vy = 0;
      B.body.setNextKinematicTranslation({ x: p.x + mv.x, y: p.y + mv.y, z: p.z + mv.z });
      w.step();
    }
    const p = B.body.translation();
    top = p.x > 3.5 && p.y - C.height / 2 > s - 0.05;
    row.push(`${s}:${top ? 'up' : 'x@' + p.x.toFixed(2)}`);
    w.free();
  }
  console.log(C.id.padEnd(6), `r ${C.body} h ${C.height}`, row.join('  '));
}
