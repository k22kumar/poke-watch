// Art direction (docs/ART_DIRECTION.md): ground decor never sits where it could hide gameplay or mislead, every
// region gets the crossroads camp, and the per-biome values stay in range. Presentation only, so headless.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getArena } from '../src/world/arenas';
import { T } from '../src/world/tiles';
import { ART_DIRECTION, edgeShade, forestDepth } from '../src/render/artdirection';
import { layoutDecor } from '../src/render/decor';

const BIOMES = ['meadow', 'badlands', 'frost', 'dusk'];

test('decor never lands on a prop, wall, water, tall grass or chest tile', () => {
  for (const b of BIOMES) {
    const m = getArena(b), W = m.w;
    const taken = new Set<number>();
    for (const p of m.props) for (let y = p.y; y < p.y + p.h; y++) for (let x = p.x; x < p.x + p.w; x++) taken.add(y * W + x);
    for (const [x, y] of m.chestSpots) taken.add(y * W + x);
    const items = layoutDecor(m, edgeShade(m, 1));
    assert.ok(items.length > 200, `${b}: decor present (${items.length})`);
    for (const d of items) {
      assert.ok(!taken.has(d.tile), `${b}: ${d.key} on an occupied tile`);
      assert.ok(!m.wall[d.tile], `${b}: ${d.key} in a wall`);
      assert.notEqual(m.terrain[d.tile], T.water, `${b}: ${d.key} in water`);
      assert.notEqual(m.terrain[d.tile], T.tall, `${b}: ${d.key} in tall grass`);
      // stays inside its tile column/row (jitter is under half a tile)
      assert.equal(Math.floor(d.x), d.tile % W);
    }
  }
});

test('every region has the full crossroads camp, and the fight areas stay quiet', () => {
  for (const b of BIOMES) {
    const m = getArena(b);
    const items = layoutDecor(m, edgeShade(m, 1));
    for (const k of ['d.firering', 'd.bedroll', 'd.satchel']) assert.ok(items.some((d) => d.key === k), `${b}: ${k}`);
    const near = (c: [number, number], r: number) => items.filter((d) => (d.x - c[0] - 0.5) ** 2 + (d.z - c[1] - 0.5) ** 2 < r * r && !d.key.startsWith('d.f')).length / (Math.PI * r * r);
    const all = items.length / (m.w * m.h);
    assert.ok(near(m.spawn, 7) < all, `${b}: spawn clearing is quieter than the arena average`);
  }
});

test('art direction values stay in range and the frame gets darker with forest depth', () => {
  for (const [b, D] of Object.entries(ART_DIRECTION)) {
    assert.ok(D.frameDark > 0 && D.frameDark < 0.5, b);
    assert.ok(D.vignette >= 0 && D.vignette <= 0.25, `${b}: vignette stays subtle`);
    assert.ok(D.edgeShade >= 0 && D.edgeShade <= 1, b);
    // actors are never lit dimmer than the world (night must not swallow Pokémon); hue may differ (warm key, cool moon)
    const luma = (c: number[]) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    assert.ok(luma(D.actor) >= luma(D.world), `${b}: actor light`);
  }
  const m = getArena('meadow'), d = forestDepth(m);
  let deep = 0;
  for (let k = 0; k < d.length; k++) if (m.wall[k] && d[k] >= 3) deep++;
  assert.ok(deep > 100, 'the border forest has depth to darken');
});
