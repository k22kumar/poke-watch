import { defaultRules } from '../../src/rules/defaults';
import { BIOMES } from '../../src/rules/stages';
import { World } from '../../src/sim/world';
import { fromArenaMap } from '../../src/world/adapter';
const range = { ...defaultRules, worldgen: { ...defaultRules.worldgen, arena: 'range' } };
const gorge = { ...defaultRules, worldgen: { ...defaultRules.worldgen, mode: 'generated' as const, locations: { meadow: 'river-gorge' } } };
for (const [name, rules, seed] of [['range', range, 1], ['river-gorge@1', gorge, 1]] as const) {
  const Wd = new World(rules as any, BIOMES.meadow, seed), m = Wd.map, M = fromArenaMap(m);
  const elev = new Map<number, number>(); for (let k = 0; k < m.w * m.h; k++) if (!m.wall[k]) elev.set(m.elev[k], (elev.get(m.elev[k]) ?? 0) + 1);
  const tris = M.colliders.reduce((s, c) => s + (c.shape === 'trimesh' ? c.indices.length / 3 : 0), 0);
  const surfTris = M.surfaces.reduce((s, c) => s + c.indices.length / 3, 0);
  console.log(name, m.w + 'x' + m.h, 'colliders', M.colliders.length, 'boxes', M.colliders.filter(c => c.shape === 'box').length, 'trimesh', M.colliders.filter(c => c.shape === 'trimesh').length, 'rampTris', tris, 'surfaces', M.surfaces.length, M.surfaces.map(s => s.material + '@' + s.cx + ',' + s.cz).join(' '), 'surfTris', surfTris, 'bounds', JSON.stringify(M.bounds));
  console.log('  elev hist (non-wall)', [...elev].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([e, c]) => `${e}:${c}`).join(' '));
  let st = 0, ov = 0, pl = 0, wl = 0; for (let k = 0; k < m.w * m.h; k++) { if (m.stairs[k]) st++; if (m.over && m.over[k] > 0) ov++; if (m.platform[k] > 0) pl++; if (m.wall[k]) wl++; }
  console.log('  stairs', st, 'deck tiles', ov, 'platform tiles', pl, 'wall', wl, 'spawn', m.spawn, 'props', m.props.length);
}
