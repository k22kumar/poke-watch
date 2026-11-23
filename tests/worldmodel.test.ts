// WM (docs/OVERHAUL_3D.md "WorldModel"): the WorldModel contract and the tile adapter (src/world/adapter.ts). Every
// map source today (the range arena, every habitat recipe and variant at seeds 1 and 3, every Pokémon location at seed
// 1) goes through fromArenaMap, and a pure-TS downward probe against the model's colliders reproduces the column model
// the sim reads (World.height, wallTopAt, the deck and the ground under it, liquidAt) at every tile centre.
//
// The probe lives here, not in src/: physics queries arrive with I1a (Rapier).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultRules, type Rules } from '../src/rules/defaults';
import { BIOMES } from '../src/rules/stages';
import { World } from '../src/sim/world';
import { HABITATS } from '../src/world/habitat';
import { LOCATIONS } from '../src/world/locations';
import { fromArenaMap } from '../src/world/adapter';
import { DECK_SLAB } from '../src/world/tiles';
import type { Collider, WorldModel } from '../src/world/model';

const EPS = 1e-4;

interface Source { name: string; rules: Rules; seed: number }
function sources(): Source[] {
  const gen = (loc: string) => ({ ...defaultRules, worldgen: { ...defaultRules.worldgen, mode: 'generated' as const, locations: { meadow: loc } } });
  const out: Source[] = [{ name: 'range', rules: { ...defaultRules, worldgen: { ...defaultRules.worldgen, arena: 'range' } }, seed: 1 }];
  for (const [id, r] of Object.entries(HABITATS)) for (const v of ['', ...Object.keys(r.variants)]) for (const seed of [1, 3]) {
    const loc = v ? `${id}:${v}` : id;
    out.push({ name: `${loc}@${seed}`, rules: gen(loc), seed });
  }
  for (const id of Object.keys(LOCATIONS)) out.push({ name: `${id}@1`, rules: gen(id), seed: 1 });
  return out;
}

/** The test probe: the model's colliders bucketed by tile, and a downward ray that returns the highest up-facing
 *  surface at or below `y0` over (x, z) (a box's top, an up-facing triangle's plane), or -Infinity. A ray that starts
 *  inside a box does not hit that box's top. */
class Probe {
  private boxes: number[][]; // per tile: indices into `tops` (box top, x0, x1, z0, z1)
  private tris: number[][]; // per tile: triangle refs (collider, first index)
  private B: Float64Array;
  constructor(private M: WorldModel, private w: number, private h: number) {
    const n = w * h, hx = w / 2, hz = h / 2;
    this.boxes = Array.from({ length: n }, () => []);
    this.tris = Array.from({ length: n }, () => []);
    const B: number[] = [];
    const tiles = (x0: number, x1: number, z0: number, z1: number, f: (k: number) => void) => {
      for (let j = Math.max(0, Math.floor(z0 + hz)); j < Math.min(h, Math.ceil(z1 + hz)); j++)
        for (let i = Math.max(0, Math.floor(x0 + hx)); i < Math.min(w, Math.ceil(x1 + hx)); i++) f(j * w + i);
    };
    M.colliders.forEach((c, ci) => {
      if (c.shape === 'box') {
        assert.equal(c.yaw, 0);
        const b = B.length / 6;
        B.push(c.centre[1] - c.half[1], c.centre[1] + c.half[1], c.centre[0] - c.half[0], c.centre[0] + c.half[0], c.centre[2] - c.half[2], c.centre[2] + c.half[2]);
        tiles(B[b * 6 + 2], B[b * 6 + 3], B[b * 6 + 4], B[b * 6 + 5], (k) => this.boxes[k].push(b));
      } else {
        const P = c.positions, I = c.indices;
        for (let t = 0; t < I.length; t += 3) {
          const xs = [P[I[t] * 3], P[I[t + 1] * 3], P[I[t + 2] * 3]], zs = [P[I[t] * 3 + 2], P[I[t + 1] * 3 + 2], P[I[t + 2] * 3 + 2]];
          tiles(Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs), (k) => this.tris[k].push(ci, t));
        }
      }
    });
    this.B = Float64Array.from(B);
  }
  down(x: number, z: number, y0 = Infinity): number {
    const k = Math.floor(z + this.h / 2) * this.w + Math.floor(x + this.w / 2), B = this.B;
    let best = -Infinity;
    for (const b of this.boxes[k]) {
      const o = b * 6;
      if (x <= B[o + 2] || x >= B[o + 3] || z <= B[o + 4] || z >= B[o + 5]) continue;
      if (B[o + 1] <= y0 && B[o + 1] > best) best = B[o + 1];
    }
    const T = this.tris[k];
    for (let r = 0; r < T.length; r += 2) {
      const c = this.M.colliders[T[r]] as Extract<Collider, { shape: 'trimesh' }>, P = c.positions, I = c.indices, t = T[r + 1];
      const a = I[t] * 3, b = I[t + 1] * 3, d = I[t + 2] * 3;
      // barycentric in xz
      const ax = P[a], az = P[a + 2], bx = P[b], bz = P[b + 2], dx = P[d], dz = P[d + 2];
      const den = (bz - dz) * (ax - dx) + (dx - bx) * (az - dz);
      if (den === 0) continue;
      const u = ((bz - dz) * (x - dx) + (dx - bx) * (z - dz)) / den, v = ((dz - az) * (x - dx) + (ax - dx) * (z - dz)) / den, s = 1 - u - v;
      if (u < -1e-9 || v < -1e-9 || s < -1e-9) continue;
      // up-facing only (the normal's y from the winding)
      const ny = (bz - az) * (dx - ax) - (bx - ax) * (dz - az);
      if (ny <= 0) continue;
      const y = u * P[a + 1] + v * P[b + 1] + s * P[d + 1];
      if (y <= y0 + 1e-9 && y > best) best = y;
    }
    return best;
  }
  /** the supporting surface: the probe, or a liquid volume's level when it is higher (a swimmer floats there, as
   *  World.height and World.support report open water) */
  support(x: number, z: number, y0 = Infinity): number {
    let s = this.down(x, z, y0);
    for (const v of this.M.volumes) {
      if (v.kind !== 'liquid' || v.level === undefined || v.level > y0) continue;
      if (x > v.box.min[0] && x < v.box.max[0] && z > v.box.min[2] && z < v.box.max[2] && v.level > s) s = v.level;
    }
    return s;
  }
}

/** FNV-1a over every byte of the model (typed arrays as bytes, numbers as float64, strings as UTF-16 units, keys in
 *  insertion order) */
function hashModel(M: WorldModel): string {
  let h = 0x811c9dc5;
  const byte = (b: number) => { h = Math.imul(h ^ b, 0x01000193); };
  const f64 = new DataView(new ArrayBuffer(8));
  const walk = (v: unknown): void => {
    if (v === undefined) { byte(0); return; }
    if (typeof v === 'number') { f64.setFloat64(0, v); for (let i = 0; i < 8; i++) byte(f64.getUint8(i)); return; }
    if (typeof v === 'boolean') { byte(v ? 2 : 3); return; }
    if (typeof v === 'string') { for (let i = 0; i < v.length; i++) { const c = v.charCodeAt(i); byte(c & 255); byte(c >> 8); } byte(4); return; }
    if (ArrayBuffer.isView(v)) { const u = new Uint8Array(v.buffer, v.byteOffset, v.byteLength); for (const b of u) byte(b); byte(5); return; }
    if (Array.isArray(v)) { for (const x of v) walk(x); byte(6); return; }
    for (const [k, x] of Object.entries(v as object)) { walk(k); walk(x); }
    byte(7);
  };
  walk(M);
  return (h >>> 0).toString(16).padStart(8, '0');
}

const triCount = (M: WorldModel) => {
  let collider = 0, surface = 0;
  for (const c of M.colliders) if (c.shape === 'trimesh') collider += c.indices.length / 3;
  for (const s of M.surfaces) surface += s.indices.length / 3;
  return { collider, nav: M.navInput.indices.length / 3, surface };
};

test('WorldModel adapter: every map source reproduces the column model at every tile centre', () => {
  const rows: string[] = [];
  for (const S of sources()) {
    const W = new World(S.rules, BIOMES.meadow, S.seed), m = W.map, half = W.half;
    const t0 = performance.now();
    const M = fromArenaMap(m);
    const ms = performance.now() - t0;
    const P = new Probe(M, m.w, m.h);
    const bad: string[] = [];
    const check = (what: string, k: number, got: number, want: number) => {
      if (!(Math.abs(got - want) <= EPS) && got !== want) bad.push(`${what} tile ${k % m.w},${(k / m.w) | 0}: got ${got}, want ${want}`);
    };
    const chasm = new Set(m.gen?.loc?.chasm ?? []);
    for (let j = 0; j < m.h; j++) for (let i = 0; i < m.w; i++) {
      const k = j * m.w + i, x = i - half + 0.5, z = j - half + 0.5, ov = m.over ? m.over[k] : 0;
      if (chasm.has(k)) {
        // open air: nothing under a deck's slab (or at all)
        check('chasm', k, P.down(x, z, ov > 0 ? ov - DECK_SLAB : Infinity), -Infinity);
        if (ov > 0) check('chasm deck', k, P.down(x, z), W.height(x, z, ov));
        continue;
      }
      if (m.wall[k] === 1) {
        const wt = W.wallTopAt(x, z), want = wt === Infinity ? M.bounds.max[1] : wt;
        if (ov > 0) {
          check('deck over wall', k, P.down(x, z), W.height(x, z, ov));
          check('wall under deck', k, P.down(x, z, ov - DECK_SLAB), Math.min(want, ov - DECK_SLAB));
        } else check(wt === Infinity ? 'bare wall' : 'wall top', k, P.down(x, z), want);
        continue;
      }
      if (ov > 0) {
        check('deck top', k, P.support(x, z), W.height(x, z, ov));
        check('under deck', k, P.support(x, z, ov - DECK_SLAB), W.height(x, z));
        continue;
      }
      check('ground', k, P.support(x, z), W.height(x, z));
    }
    // liquids: a liquid volume at a tile centre exactly where World.liquidAt finds open liquid, with its element and
    // the surface World.waterAt reports
    for (let j = 0; j < m.h; j++) for (let i = 0; i < m.w; i++) {
      const k = j * m.w + i, x = i - half + 0.5, z = j - half + 0.5;
      const v = M.volumes.find((q) => q.kind === 'liquid' && x > q.box.min[0] && x < q.box.max[0] && z > q.box.min[2] && z < q.box.max[2]);
      const code = W.liquidAt(x, z, M.bounds.min[1], 0);
      if (!v) { if (code !== 0) bad.push(`liquid missing tile ${i},${j}`); continue; }
      if (code === 0) { bad.push(`liquid extra tile ${i},${j}`); continue; }
      if (v.element !== (code === 2 ? 'blaze' : 'tide')) bad.push(`liquid element tile ${i},${j}: ${v.element}`);
      if (v.level !== W.waterAt(x, z) || v.box.max[1] !== v.level) bad.push(`liquid level tile ${i},${j}: ${v.level} vs ${W.waterAt(x, z)}`);
    }
    assert.deepEqual(bad.slice(0, 20), [], `${S.name}: ${bad.length} tiles differ`);

    // determinism and plain data: the same map gives the same bytes, and the model survives structuredClone
    const h1 = hashModel(M), M2 = fromArenaMap(m);
    assert.equal(hashModel(M2), h1, `${S.name}: same map in, same model out`);
    const C = structuredClone(M);
    assert.deepEqual(C, M, `${S.name}: structuredClone round trip`);
    assert.equal(hashModel(C), h1);

    const T = triCount(M), tris = T.collider + T.nav + T.surface;
    assert.ok(M.colliders.length < 20000, `${S.name}: ${M.colliders.length} colliders`);
    assert.ok(tris < 500000, `${S.name}: ${tris} triangles`);
    rows.push(`${S.name.padEnd(28)} colliders ${String(M.colliders.length).padStart(5)}  tris collider ${String(T.collider).padStart(4)} nav ${String(T.nav).padStart(6)} surface ${String(T.surface).padStart(6)} total ${String(tris).padStart(6)}  volumes ${String(M.volumes.length).padStart(4)}  markers ${String(M.markers.length).padStart(3)}  ${ms.toFixed(1).padStart(6)} ms  ${h1}`);
  }
  console.log('WorldModel per map source:\n' + rows.join('\n'));
});

test('WorldModel adapter: contract shape (meta, bounds, markers, chunk size)', () => {
  const S = sources(), hab = S.find((s) => s.name === 'river-gorge@1')!;
  const W = new World(hab.rules, BIOMES.meadow, hab.seed), M = fromArenaMap(W.map);
  assert.equal(M.meta.source, 'habitat:river-gorge');
  assert.equal(M.meta.seed, 1);
  assert.ok(M.meta.version > 0);
  assert.deepEqual(M.navInput.links, []);
  for (const kind of ['spawn', 'staging', 'contest'] as const) assert.ok(M.markers.some((q) => q.kind === kind), kind);
  assert.equal(M.markers.filter((q) => q.kind === 'staging').length, 2);
  const c = M.markers.find((q) => q.kind === 'contest')!, H = W.map.gen!.hab!.contest;
  assert.deepEqual([c.position[0], c.position[2], c.radius], [H.x - W.half, H.y - W.half, H.r]);
  for (const ch of M.surfaces) {
    assert.ok(ch.material === 'terrain' || ch.material === 'liquid');
    assert.equal(ch.positions.length, ch.normals.length);
    assert.equal(ch.positions.length, ch.colours.length);
    for (let a = 0; a < ch.positions.length; a += 3) {
      const x = ch.positions[a] + W.half, z = ch.positions[a + 2] + W.half;
      assert.ok(x >= ch.cx * 64 - 1e-6 && x <= ch.cx * 64 + 64 + 1e-6 && z >= ch.cz * 64 - 1e-6 && z <= ch.cz * 64 + 64 + 1e-6, 'chunk extent');
    }
  }
  const range = fromArenaMap(new World(S[0].rules, BIOMES.meadow, 1).map);
  assert.equal(range.meta.source, 'arena:range');
  assert.ok(range.markers.filter((q) => q.kind === 'body').length >= 3, 'the range throwables');
  const loc = S.find((s) => s.name === 'mt-moon@1')!;
  assert.equal(fromArenaMap(new World(loc.rules, BIOMES.meadow, 1).map).meta.source, 'location:mt-moon');
});
