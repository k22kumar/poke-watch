import { rangeModel } from './maps';
const { M } = rangeModel();
for (const s of M.surfaces) {
  if (s.material !== 'terrain') continue;
  const P = s.positions, I = s.indices;
  for (let t = 0; t < I.length; t += 3) {
    const v = [0, 1, 2].map((k) => [P[I[t + k] * 3], P[I[t + k] * 3 + 1], P[I[t + k] * 3 + 2]]);
    if (v.every((p) => p[0] >= -28 && p[0] <= -26 && p[2] >= -6.01 && p[2] <= -3.99)) console.log(JSON.stringify(v));
  }
}
