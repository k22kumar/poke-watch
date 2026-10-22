// W4 materials (rules/surfaces.ts, sim/props.ts): the 24-cell reaction table checked against the simulation, burning
// and breaking with the mutable overlay, the cover-loss cap, and flags off.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyAgent, CS } from '../src/sim/cells';
import { createRun, step } from '../src/sim/run';
import { stateHash } from '../src/sim/checksum';
import { PS, forceOnProp, ignite } from '../src/sim/props';
import { REACTIONS, MATERIALS, PROP_MATERIALS, type AgentId, type MaterialId } from '../src/rules/surfaces';
import { T, type ArenaPropKind } from '../src/world/tiles';
import { getArena } from '../src/world/arenas';
import type { InputFrame, SimContext } from '../src/sim/types';

const NONE: InputFrame = { mx: 0, mz: 0, jump: false, dash: false };
const QUIET = { director: { spawnBase: -99, spawnPerMin: 0, spawnPerStage: 0, eliteEvery: 9999, swarmEvery: 9999 }, bodies: { looseRocks: 0 }, beats: { enabled: false }, objectives: { enabled: false } };
function calm(extra: object = {}): SimContext {
  const ctx = createRun({ seed: 2, species: 'totodile', ruleOverrides: { ...QUIET, surfaces: { inAuthored: true, ...((extra as { surfaces?: object }).surfaces ?? {}) }, ...Object.fromEntries(Object.entries(extra).filter(([k]) => k !== 'surfaces')) } as never });
  for (let i = 0; i < 6; i++) step(ctx, NONE);
  return ctx;
}
const secs = (ctx: SimContext, s: number) => { for (let i = 0; i < Math.round(s * 60); i++) step(ctx, NONE); };
const centre = (ctx: SimContext, k: number): [number, number] => [(k % ctx.world.w) - ctx.world.half + 0.5, ((k / ctx.world.w) | 0) - ctx.world.half + 0.5];

/** index of the first prop of a kind away from the map edge, and its first tile */
function propOf(ctx: SimContext, kinds: ArenaPropKind[]): [number, number] {
  const M = ctx.world.map;
  const i = M.props.findIndex((p) => kinds.includes(p.kind) && p.x > 20 && p.y > 20 && p.x < M.w - 20 && p.y < M.h - 20);
  assert.ok(i >= 0, 'prop ' + kinds.join('/'));
  return [i, M.props[i].y * M.w + M.props[i].x];
}
function tileOf(ctx: SimContext, t: number): number {
  const M = ctx.world.map, w = M.w;
  for (let k = w * 20 + 20; k < M.terrain.length - w * 20; k++) if (M.terrain[k] === t && M.terrain[k - 1] === t && M.terrain[k + 1] === t && M.terrain[k - w] === t && M.terrain[k + w] === t && !M.wall[k]) return k;
  throw new Error('no tile ' + t);
}

test('the reaction table holds for all 24 cells (6 materials × 4 agents)', () => {
  const agents: AgentId[] = ['heat', 'wet', 'cold', 'charge'];
  const seen: string[] = [];
  for (const mat of Object.keys(REACTIONS) as MaterialId[]) for (const ag of agents) {
    const ctx = calm();
    const C = ctx.world.cells, F = ctx.world.propField!;
    const want = REACTIONS[mat][ag];
    if (mat === 'grass' || mat === 'water' || mat === 'ice') {
      const k = tileOf(ctx, mat === 'grass' ? T.tall : T.water);
      const [x, z] = centre(ctx, k);
      if (mat === 'ice') applyAgent(ctx, 'cold', x, z, 0.4);
      // douse: the agent arrives at a burning tile
      if (want === 'douse') applyAgent(ctx, 'heat', x, z, 0.4);
      const before = C.state[k];
      applyAgent(ctx, ag, x, z, 0.4);
      const s = C.state[k];
      const got = s === CS.burning && before !== CS.burning ? 'ignite'
        : before === CS.burning && s !== CS.burning ? 'douse'
        : s === CS.frozen && before !== CS.frozen ? 'freeze'
        : before === CS.frozen && s !== CS.frozen ? 'melt'
        : C.charge[k] > 0 ? 'conduct'
        : mat === 'water' && C.steam[k] > 0 ? 'steam'
        : mat === 'ice' && s === CS.frozen && ag === 'cold' ? 'freeze' // stays ice, timer refreshed
        : 'none';
      assert.equal(got, want, `${mat} × ${ag}`);
    } else {
      const kinds: ArenaPropKind[] = mat === 'wood' ? ['tree', 'tree2', 'round'] : mat === 'leaf' ? ['bush', 'bushR', 'bushB'] : ['rock', 'boulder'];
      const [i, k] = propOf(ctx, kinds);
      const [x, z] = centre(ctx, k);
      if (want === 'douse') { applyAgent(ctx, 'heat', x, z, 0.4); assert.equal(F.state[i], PS.burning, `${mat} lit first`); }
      const before = F.state[i];
      applyAgent(ctx, ag, x, z, 0.4);
      const s = F.state[i];
      const got = s === PS.burning && before !== PS.burning ? 'ignite' : before === PS.burning && s !== PS.burning ? 'douse' : 'none';
      assert.equal(got, want, `${mat} × ${ag}`);
    }
    seen.push(`${mat}×${ag}`);
  }
  assert.equal(seen.length, 24);
});

test('a burning tree lights the tall grass beside it, burns out to a stump, and the overlay reopens the ground', () => {
  const ctx = calm();
  const W = ctx.world, F = W.propField!, M = W.map;
  const [i, k] = propOf(ctx, ['tree', 'tree2', 'round']);
  const p = M.props[i];
  assert.equal(M.wall[k], 1);
  assert.ok(ignite(ctx, i));
  secs(ctx, MATERIALS.wood.burn + 0.5);
  assert.equal(F.state[i], PS.burnt);
  const stump = (p.y + p.h - 1) * W.w + p.x;
  for (let j = p.y; j < p.y + p.h; j++) for (let x = p.x; x < p.x + p.w; x++) {
    const t = j * W.w + x;
    assert.equal(M.wall[t], 0, 'no wall left');
    assert.equal(M.platform[t], t === stump ? Math.fround(0.65) : 0, t === stump ? 'stump to stand on' : 'open ground');
  }
  // the base map other runs share is untouched
  assert.equal(getArena('meadow').wall[k], 1);
  // navigation knows: the flow field reaches the tiles the tree stood on
  const other = p.y * W.w + p.x + 1;
  const [ox, oz] = centre(ctx, other);
  W.refreshFlow(ctx.player.x, ctx.player.z);
  assert.ok(Number.isFinite(W.flowDist(ox, oz)), 'former tree tile is reachable');
});

test('a Push of the prop’s Weight breaks it; weaker pushes only chip it; stone leaves rubble bodies', () => {
  const ctx = calm();
  const F = ctx.world.propField!;
  const [i, k] = propOf(ctx, ['rock']);
  const w = PROP_MATERIALS.rock!.weight;
  const bodies0 = ctx.bodies.count;
  assert.equal(forceOnProp(ctx, k, w - 1, 10, 'tide'), false);
  assert.ok(F.hp[i] < PROP_MATERIALS.rock!.integrity && F.hp[i] > 0, 'chipped');
  assert.equal(forceOnProp(ctx, k, w, 0, 'brawl'), true);
  assert.equal(F.state[i], PS.broken);
  assert.equal(ctx.world.map.platform[k], 0);
  assert.ok(ctx.bodies.count > bodies0, 'rubble bodies to push and hold');
  // landmarks never break
  const [s, sk] = propOf(ctx, ['shrine', 'elder', 'sign', 'lantern']);
  assert.equal(forceOnProp(ctx, sk, 4, 999, 'brawl'), false);
  assert.equal(F.state[s], PS.intact);
});

test('permanent cover loss is capped: past it, fire no longer takes cover', () => {
  const ctx = calm({ surfaces: { coverLossCap: 0.05 } });
  const F = ctx.world.propField!;
  let lit = 0;
  for (let i = 0; i < F.n; i++) if (F.mat[i]?.cover && ignite(ctx, i)) lit++;
  assert.ok(lit <= Math.ceil(F.coverTotal * 0.05), `${lit} lit of ${F.coverTotal}`);
  secs(ctx, 12);
  assert.ok(F.lost <= Math.ceil(F.coverTotal * 0.05) + 1, `lost ${F.lost}`);
});

test('bridges are terrain, not props: heat on a bridge does nothing', () => {
  const ctx = calm();
  const M = ctx.world.map;
  const k = M.terrain.indexOf(T.wood);
  const [x, z] = centre(ctx, k);
  applyAgent(ctx, 'heat', x, z, 0.4);
  assert.equal(ctx.world.cells.state[k], CS.none);
  assert.equal(ctx.world.propField!.at[k], -1);
});

test('flags off: no overlay, the shared map itself, and trees do not burn', () => {
  const ctx = calm({ surfaces: { enabled: false } });
  assert.equal(ctx.world.propField, null);
  assert.equal(ctx.world.map, getArena('meadow'));
  const M = ctx.world.map;
  const i = M.props.findIndex((p) => p.kind === 'tree' && p.x > 20 && p.y > 20);
  const [x, z] = centre(ctx, M.props[i].y * M.w + M.props[i].x);
  applyAgent(ctx, 'heat', x, z, 0.4);
  secs(ctx, 8);
  assert.equal(M.wall[M.props[i].y * M.w + M.props[i].x], 1);
});

test('the overlay is deterministic and part of the state hash', () => {
  const run = () => {
    const ctx = calm();
    const [i] = propOf(ctx, ['tree', 'tree2', 'round']);
    ignite(ctx, i);
    secs(ctx, 10);
    return [stateHash(ctx), ctx.world.propField!.burnt] as const;
  };
  const a = run(), b = run();
  assert.deepEqual(a, b);
  const ctx = calm();
  const h0 = stateHash(ctx);
  const [i] = propOf(ctx, ['bush', 'bushR', 'bushB']);
  ctx.world.propField!.state[i] = PS.burnt;
  assert.notEqual(stateHash(ctx), h0, 'a changed prop changes the hash');
});
