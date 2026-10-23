import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultRules } from '../src/rules/defaults';
import { HAB, habitatSpawnFactor } from '../src/rules/habitats';
import { STAGES } from '../src/rules/stages';
import { startStage, createRun } from '../src/sim/run';
import { applyAgent, footing } from '../src/sim/cells';
import { generateRegion } from '../src/world/gen';
import { T } from '../src/world/tiles';

const GENERATED = { ...defaultRules.worldgen, mode: 'generated' as const };

test('local habitat favors native encounters without excluding visitors', () => {
  assert.equal(habitatSpawnFactor('poliwag', HAB.water), 2);
  assert.equal(habitatSpawnFactor('geodude', HAB.water), 0.55);
  assert.equal(habitatSpawnFactor('geodude', HAB.rock), 2);
  assert.equal(habitatSpawnFactor('unlisted', HAB.water), 1);
  assert.equal(habitatSpawnFactor('poliwag', 0), 1);
});

test('all generated regional rosters have reachable habitat and biome-specific traversal', () => {
  const ctx = createRun({ seed: 431, species: 'squirtle', ruleOverrides: { worldgen: GENERATED } as never });
  const tilePoint = (predicate: (k: number) => boolean) => {
    const W = ctx.world;
    const k = W.map.terrain.findIndex((_, i) => predicate(i));
    assert.notEqual(k, -1, `expected terrain in ${W.biome.id}`);
    return [k % W.w - W.half + 0.5, Math.floor(k / W.w) - W.half + 0.5] as const;
  };

  for (let stage = 0; stage < STAGES.length; stage++) {
    startStage(ctx, stage);
    const def = STAGES[stage], map = generateRegion({
      biome: def.biome, seed: 431, species: [...def.spawns.map(([id]) => id), ...def.elites],
    });
    assert.ok(map.gen?.gates.every((gate) => gate.ok), `${def.biome} generation gates`);
    assert.ok(map.gen?.habitat.some((habitat) => habitat !== 0), `${def.biome} has tagged habitat`);

    if (def.biome === 'meadow') {
      const [x, z] = tilePoint((k) => ctx.world.map.terrain[k] === T.tall);
      assert.equal(footing(ctx, x, z, ['plain'])[0], 0.78);
      assert.equal(footing(ctx, x, z, ['bloom'])[0], 1);
    } else if (def.biome === 'badlands') {
      const [x, z] = tilePoint((k) => (ctx.world.map.terrain[k] === T.sand || ctx.world.map.terrain[k] === T.dirt) && !ctx.world.map.wall[k]);
      assert.equal(footing(ctx, x, z, ['plain'])[0], 0.86);
      applyAgent(ctx, 'wet', x, z, 0.5);
      assert.equal(footing(ctx, x, z, ['plain'])[0], 0.62);
      assert.equal(footing(ctx, x, z, ['quake'])[0], 1);
    } else if (def.biome === 'frost') {
      const [x, z] = tilePoint((k) => ctx.world.map.terrain[k] === T.grass || ctx.world.map.terrain[k] === T.sand);
      assert.equal(footing(ctx, x, z, ['plain'])[0], 0.82);
      assert.equal(footing(ctx, x, z, ['frost'])[0], 1);
    } else if (def.biome === 'dusk') {
      const [x, z] = tilePoint((k) => (ctx.world.habitatAt(k % ctx.world.w - ctx.world.half + 0.5, Math.floor(k / ctx.world.w) - ctx.world.half + 0.5) & HAB.water) !== 0
        && ctx.world.map.terrain[k] !== T.water && !ctx.world.map.wall[k]);
      assert.equal(footing(ctx, x, z, ['plain'])[0], 0.78);
      assert.equal(footing(ctx, x, z, ['tide'])[0], 1);
    }
  }
});
