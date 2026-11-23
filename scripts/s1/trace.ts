import { initRapierNode } from '../../src/physics/node';
import { buildStatic } from '../../src/physics/colliders';
import { defaultRules } from '../../src/rules/defaults';
import { DT, addFixtures, makeCharacter } from './courselib';
import { rangeModel } from './maps';
const { R } = await initRapierNode('deterministic');
const { M } = rangeModel();
const ci = Number(process.argv[2] ?? 2), C = defaultRules.size.classes[ci];
const w = new R.World({ x: 0, y: 0, z: 0 }); buildStatic(R, w, M, 'boxes'); addFixtures(R, w);
const B = makeCharacter(R, w, C.body, C.height, -2, 0, 10.5); w.step();
let vy = 0;
for (let t = 0; t < 90; t++) {
  vy -= 30 * DT;
  const want = { x: -6 * DT, y: vy * DT, z: 0 };
  B.ctl.computeColliderMovement(B.col, want);
  const mv = B.ctl.computedMovement(), p = B.body.translation(), g = B.ctl.computedGrounded();
  if (g && vy < 0) vy = 0;
  const cols: string[] = [];
  for (let i = 0; i < B.ctl.numComputedCollisions(); i++) { const c = B.ctl.computedCollision(i)!; cols.push(`n(${c.normal1.x.toFixed(2)},${c.normal1.y.toFixed(2)},${c.normal1.z.toFixed(2)}) c${c.collider?.handle}`); }
  if (p.x < -3 && p.x > -5.5) console.log(t, 'x', p.x.toFixed(3), 'feet', (p.y - C.height / 2).toFixed(3), 'mv', mv.x.toFixed(3), mv.y.toFixed(3), 'g', g, cols.join(' '));
  B.body.setNextKinematicTranslation({ x: p.x + mv.x, y: p.y + mv.y, z: p.z + mv.z }); w.step();
}
for (const c of M.colliders) if (c.shape === 'box' && Math.abs(c.centre[2] - 10.5) <= c.half[2] && c.centre[0] - c.half[0] <= -2 && c.centre[0] + c.half[0] >= -10) console.log('box', c.material, c.centre, c.half);
