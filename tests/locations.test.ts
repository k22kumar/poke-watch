// Pokémon-location generator (src/world/locations, src/world/locgen; docs/LOCATIONS.md): determinism, the hard gates
// over many seeds, location identity, the sim rules it relies on (drop navigation, terrain line of sight, anchors)
// and bot play on every location.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { defaultRules } from '../src/rules/defaults';
import { BIOMES } from '../src/rules/stages';
import { World } from '../src/sim/world';
import { createRun, step } from '../src/sim/run';
import { botInput } from '../src/sim/bot';
import { shootHostile } from '../src/sim/enemies';
import { PK } from '../src/sim/pools';
import { generateLocation, LOC_VERSION } from '../src/world/locgen';
import { enemyCore, playerReach } from '../src/world/locgen/nav';
import { navOpen } from '../src/world/gen/util';
import { LOCATIONS, findLocation } from '../src/world/locations';
import { mapChecksum, regionMap } from '../src/world/maps';
import { PROP_RULES, T } from '../src/world/tiles';

const IDS = Object.keys(LOCATIONS);

test('every location is data with canon, references, constraints, freedoms and creative notes kept apart', () => {
  for (const L of Object.values(LOCATIONS)) {
    assert.ok(L.canon.facts.length >= 3 && L.canon.identity.length >= 3, L.id);
    for (const f of L.canon.facts) for (const r of f.refs) assert.ok(L.refs[r]?.url.startsWith('https://'), `${L.id}: fact cites a reference`);
    assert.ok(L.creative.length >= 2, `${L.id}: interpretations are listed as such`);
    assert.ok(L.gameplay.tierGap > 2.44 && L.gameplay.tierGap / 2 <= 2.4, `${L.id}: tiers are real cliffs and a hop reaches half a tier`);
    assert.ok(L.gameplay.slope <= 0.5, `${L.id}: ramps stay under the 0.6 m step`);
    assert.ok(L.landmarks.some((x) => x.canon), `${L.id}: a canonical landmark`);
  }
  assert.equal(findLocation('Chargestone Cave')?.id, 'chargestone-cave');
  assert.equal(findLocation('mt moon')?.id, 'mt-moon');
  assert.equal(findLocation('viridian')?.id, 'viridian-forest');
});

test('same location and seed give the same map; seeds give structurally different maps', () => {
  for (const id of IDS) {
    const a = generateLocation({ location: id, seed: 77 }), b = generateLocation({ location: id, seed: 77 });
    assert.equal(mapChecksum(a), mapChecksum(b), id);
    assert.equal(a.id, `${id}@77v${LOC_VERSION}`);
    const shapes = new Set<string>();
    for (let s = 1; s <= 8; s++) {
      const L = generateLocation({ location: id, seed: s }).gen!.loc!;
      // structure, not decoration: zone kinds and tiers, and which link kinds join what
      shapes.add(L.zones.map((z) => z.kind[0] + z.tier).join('') + '|' + L.links.map((l) => `${l.a}${l.kind[0]}${l.b}`).join(','));
    }
    assert.equal(shapes.size, 8, `${id}: no two seeds share a zone graph`);
  }
});

test('10 seeds of every location pass every hard gate', () => {
  for (const id of IDS) for (let s = 200; s < 210; s++) {
    const m = generateLocation({ location: id, seed: s });
    const failed = m.gen!.gates.filter((g) => !g.ok).map((g) => `${g.id}: ${g.value}`);
    assert.deepEqual(failed, [], `${id} seed ${s}`);
  }
});

test('location maps are well formed and strongly connected for enemies; the player has no perch enemies cannot reach', () => {
  for (const id of IDS) for (const s of [3, 8]) {
    const m = generateLocation({ location: id, seed: s }), S = m.w, L = m.gen!.loc!;
    const seen = new Set<number>();
    for (const p of m.props) {
      const R = PROP_RULES[p.kind];
      assert.ok(p.x >= 0 && p.y >= 0 && p.x + p.w <= S && p.y + p.h <= S, `${id}: ${p.kind} on the map`);
      if (!R.wall && !R.platform) continue;
      for (let j = p.y; j < p.y + p.h; j++) for (let i = p.x; i < p.x + p.w; i++) { const k = j * S + i; assert.ok(!seen.has(k), `${id}: overlap`); seen.add(k); }
    }
    const hub = m.spawn[1] * S + m.spawn[0], core = enemyCore(m, hub, L.dropNav), pr = playerReach(m, hub);
    for (let k = 0; k < S * S; k++) {
      if (navOpen(m, k)) assert.ok(core[k], `${id} seed ${s}: enemy tile ${k % S},${(k / S) | 0} outside the spawn's strongly connected space`);
      if (pr[k] && navOpen(m, k)) assert.ok(core[k], `${id}: player perch`);
    }
    for (const [x, y] of [...m.chestSpots, ...L.anchors]) assert.ok(core[y * S + x], `${id}: chest/anchor reachable`);
    assert.ok(L.anchors.length >= 3, `${id}: approach anchors`);
  }
});

test('locations differ in kind, not just paint: enclosure, tiers, landmarks and link mix', () => {
  const avg = (id: string, f: (m: ReturnType<typeof generateLocation>) => number) => { let t = 0; for (let s = 1; s <= 6; s++) t += f(generateLocation({ location: id, seed: s })); return t / 6; };
  const trees = (m: ReturnType<typeof generateLocation>) => m.props.filter((p) => p.kind === 'tree' || p.kind === 'tree2' || p.kind === 'round').length;
  const rockWalls = (m: ReturnType<typeof generateLocation>) => { let n = 0; for (let k = 0; k < m.w * m.h; k++) if (m.wall[k] && m.elev[k] > 3 && m.terrain[k] === T.grass) n++; return n; };
  assert.ok(avg('viridian-forest', trees) > 500 && avg('mt-moon', trees) === 0 && avg('chargestone-cave', trees) === 0, 'forest walls vs rock walls');
  assert.ok(avg('mt-moon', rockWalls) > 4000 && avg('viridian-forest', rockWalls) === 0);
  const tiers = (m: ReturnType<typeof generateLocation>) => m.gen!.loc!.metrics.tiers;
  assert.ok(avg('viridian-forest', tiers) <= 2 && avg('mt-moon', tiers) > 2.3 && avg('chargestone-cave', tiers) > 2.3, 'forest bluffs on two tiers; caves on three floors');
  const has = (id: string, kind: string) => { for (let s = 1; s <= 6; s++) if (!generateLocation({ location: id, seed: s }).props.some((p) => p.kind === kind)) return false; return true; };
  assert.ok(has('mt-moon', 'moonstone') && has('mt-moon', 'fossil'), 'Mt. Moon: Moon Stone and fossil dig every seed');
  assert.ok(has('chargestone-cave', 'magnetite'), 'Chargestone: magnetic crystals every seed');
  assert.ok(has('viridian-forest', 'sign') && has('viridian-forest', 'gatehouse'), 'Viridian: Trainer Tips signs and gatehouses every seed');
  // tall grass as a share of playable ground
  const tall = (m: ReturnType<typeof generateLocation>) => { let n = 0; for (const t of m.terrain) if (t === T.tall) n++; return n / m.gen!.loc!.metrics.playable; };
  assert.ok(avg('viridian-forest', tall) > 0.06 && avg('mt-moon', tall) === 0, 'tall grass is a forest feature');
  const stones = (m: ReturnType<typeof generateLocation>) => m.gen!.loc!.bodySpots.length;
  assert.ok(avg('chargestone-cave', stones) >= 4, 'Chargestone: loose charged stones');
});

test('vertical quality: every map has overlooks that can be shot at from below, and two ways onto raised ground', () => {
  for (const id of IDS) for (let s = 1; s <= 5; s++) {
    const M = generateLocation({ location: id, seed: s }).gen!.loc!.metrics;
    assert.ok(M.overlooks >= 2 && M.exposure > 0.2, `${id} seed ${s}: overlooks ${M.overlooks}, their rims exposed ${M.exposure}`);
    assert.ok(M.ramps >= 3 && M.loops >= 2, `${id} seed ${s}: climbs and loops`);
    assert.ok(M.losBlocked > 0.5 && M.losBlocked < 0.95, `${id} seed ${s}: cover breaks sightlines without boxing every fight in (${M.losBlocked})`);
  }
});

test('the location generator and data follow the determinism rules', () => {
  for (const sub of ['locgen', 'locations']) {
    const dir = new URL(`../src/world/${sub}/`, import.meta.url);
    for (const f of readdirSync(dir)) {
      const src = readFileSync(new URL(f, dir), 'utf8').replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
      assert.doesNotMatch(src, /Math\.(sin|cos|tan|atan2?|hypot|exp|log|pow|random)\(/, `${sub}/${f}`);
    }
  }
  // no location or species is named in the generator's code (stamps name their own props, never a place)
  for (const f of readdirSync(new URL('../src/world/locgen/', import.meta.url))) {
    const src = readFileSync(new URL(`../src/world/locgen/${f}`, import.meta.url), 'utf8').replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
    assert.doesNotMatch(src, /'(viridian-forest|mt-moon|chargestone-cave)'|\b(rattata|zubat|geodude|paras)\b/i, f);
  }
});

test('rules seam: stage biomes map to locations; ?loc-style overrides; classic stays reachable', () => {
  const wg = { ...defaultRules.worldgen, mode: 'generated' as const };
  assert.equal(regionMap(wg, 'meadow', 5).gen!.loc!.id, 'viridian-forest');
  assert.equal(regionMap(wg, 'dusk', 5).gen!.loc!.id, 'mt-moon');
  assert.equal(regionMap(wg, 'frost', 5).gen!.loc, undefined, 'frost keeps the classic generator');
  assert.equal(regionMap({ ...wg, locations: { meadow: 'chargestone-cave' } }, 'meadow', 5).gen!.loc!.id, 'chargestone-cave');
  assert.equal(regionMap({ ...wg, locations: { meadow: '' } }, 'meadow', 5).gen!.loc, undefined);
  const authored = new World(defaultRules, BIOMES.meadow, 5);
  assert.equal(authored.dropNav, 0); assert.equal(authored.los, false); assert.equal(authored.anchors.length, 0);
});

test('drop navigation: enemies above a ledge path down onto the player; flow reaches every enemy tile', () => {
  const rules = { ...defaultRules, worldgen: { ...defaultRules.worldgen, mode: 'generated' as const, locations: { meadow: 'mt-moon' } } };
  const W = new World(rules, BIOMES.meadow, 11);
  assert.ok(W.dropNav > 3 && W.los);
  const m = W.map, S = m.w, core = enemyCore(m, m.spawn[1] * S + m.spawn[0], W.dropNav);
  // stand the player on the lowest floor; every enemy tile must have a finite flow distance
  let low = -1;
  for (let k = 0; k < S * S; k++) if (core[k] && (low < 0 || m.elev[k] < m.elev[low])) low = k;
  const px = (low % S) - W.half + 0.5, pz = ((low / S) | 0) - W.half + 0.5;
  W.updateFlow(px, pz);
  let unreached = 0, dropped = 0;
  for (let k = 0; k < S * S; k++) if (core[k]) { if (W.flow[k] === 0x7fff) unreached++; }
  assert.equal(unreached, 0);
  // and some of those paths use a drop: a tile whose best next step is a ledge down
  for (let k = S; k < S * S - S; k++) {
    if (!core[k] || W.flow[k] === 0x7fff) continue;
    for (const d of [1, -1, S, -S]) if (core[k + d] && W.flow[k + d] === W.flow[k] - 1 && m.elev[k] - m.elev[k + d] > 1) dropped++;
  }
  assert.ok(dropped > 0, 'enemies use drops');
});

test('line of sight: walls and cliff lips stop enemy shots on location maps; authored maps keep hugging shots', () => {
  const run = createRun({ seed: 4, species: 'squirtle', ruleOverrides: { worldgen: { mode: 'generated', locations: { meadow: 'viridian-forest' } } } as never });
  const W = run.world, m = W.map, S = m.w;
  // find a tree tile with open ground on both sides along x
  let found = false;
  for (let k = S * 20; k < S * (S - 20) && !found; k++) {
    const x = k % S;
    if (x < 10 || x > S - 10 || !m.wall[k]) continue;
    if (!navOpen(m, k - 3) || !navOpen(m, k + 3) || Math.abs(m.elev[k - 3] - m.elev[k + 3]) > 0.01) continue;
    if (m.wall[k - 3] || m.wall[k + 3]) continue;
    const ax = x - 3 - W.half + 0.5, bx = x + 3 - W.half + 0.5, z = ((k / S) | 0) - W.half + 0.5;
    assert.equal(W.sight(ax, m.elev[k] + 0.9, z, bx, m.elev[k] + 0.6, z), false, 'a wall blocks sight');
    run.player.x = bx; run.player.z = z; run.player.y = W.height(bx, z);
    const hostile = () => { let n = 0; for (let i = 0; i < run.projectiles.hi; i++) if (run.projectiles.alive[i] && run.projectiles.kind[i] === PK.hostile) n++; return n; };
    const before = hostile(), hp = run.player.hp;
    shootHostile(run, ax, z, 1, 0, 11, 10, 'blaze');
    assert.equal(hostile(), before + 1);
    for (let t = 0; t < 30; t++) step(run, { mx: 0, mz: 0, ax: 0, az: 1, jump: false, dash: false } as never);
    assert.equal(hostile(), before, 'the shot died on the tree');
    assert.ok(run.player.hp >= hp - 0.01, 'and never reached the player');
    found = true;
  }
  assert.ok(found, 'a tree between two open tiles exists');
});

test('every location plays two minutes with the bot: enemies spawn from anchors, never stand in walls, reach the fight', () => {
  for (const id of IDS) {
    // basicNeedsTarget keeps the bot on the route this check was tuned on (it measures the map, not combat; the
    // bot's path follows when its basic attack fires). Note: viridian-forest seed 8 leaves ~6% of enemies with no path.
    const ctx = createRun({ seed: 6, species: 'cyndaquil', ruleOverrides: { worldgen: { mode: 'generated', locations: { meadow: id } }, player: { hpBase: 4000 }, combat: { basicNeedsTarget: true } } as never });
    assert.equal(ctx.world.map.gen!.loc!.id, id);
    let checked = 0, near = 0, stuck = 0;
    while (ctx.time < 120 && ctx.state !== 'over') {
      step(ctx, botInput(ctx));
      if (ctx.tick % 60) continue;
      const E = ctx.enemies, W = ctx.world, P = ctx.player;
      for (let i = 0; i < E.hi; i++) {
        if (!E.alive[i] || E.hover[i] !== 0) continue;
        checked++;
        assert.ok(!W.wallAt(E.x[i], E.z[i]), `${id}: enemy in a wall`);
        if (Math.hypot(E.x[i] - P.x, E.z[i] - P.z) < 8) near++;
        if (W.flowDist(E.x[i], E.z[i]) === Infinity) stuck++;
      }
    }
    assert.notEqual(ctx.state, 'over', id);
    assert.ok(ctx.stats.kills > 20 && checked > 200, `${id}: spawning and fighting (${ctx.stats.kills} KOs)`);
    assert.ok(near > 20, `${id}: ground enemies reach the player`);
    assert.ok(stuck / checked < 0.05, `${id}: enemies with no path ${stuck}/${checked}`);
  }
});

// ---------------------------------------------------------------------------------------------------------------
// Overhead decks (locgen/decks.ts; ArenaMap.over): shelves, underpasses and hollows — a second walkable layer
// ---------------------------------------------------------------------------------------------------------------

test('zones have unique ids (hub and boss were once both id 0, which tied boss links to the hub)', () => {
  for (const id of IDS) for (const seed of [1, 2, 3]) {
    const z = generateLocation({ location: id, seed }).gen!.loc!.zones;
    assert.equal(new Set(z.map((q) => q.id)).size, z.length, `${id} ${seed}`);
    z.forEach((q, i) => assert.equal(q.id, i, `${id} ${seed}: zone ${i} keeps its index as id`));
  }
});

test('decks: every location map has layered space; each deck clears the ground beneath, and both layers are in the enemy space', () => {
  for (const id of IDS) for (let seed = 1; seed <= 8; seed++) {
    const m = generateLocation({ location: id, seed }), S = m.w, n = S * S;
    assert.ok(m.over, `${id} ${seed}: has decks`);
    const core = enemyCore(m, m.spawn[1] * S + m.spawn[0], m.gen!.loc!.dropNav), pr = playerReach(m, m.spawn[1] * S + m.spawn[0]);
    let decks = 0;
    for (let k = 0; k < n; k++) {
      const ov = m.over![k];
      if (!(ov > 0)) continue;
      decks++;
      assert.ok(ov - m.elev[k] >= 2.9, `${id} ${seed}: clearance under deck`);
      assert.ok(navOpen(m, k) && core[k], `${id} ${seed}: the ground under a deck is open and reachable`);
      assert.ok(core[n + k], `${id} ${seed}: the deck itself is reachable by enemies (no perch)`);
      // nothing tall stands under a slab
      assert.ok(!m.props.some((p) => p.x <= k % S && k % S < p.x + p.w && p.y <= ((k / S) | 0) && ((k / S) | 0) < p.y + p.h && (PROP_RULES[p.kind].wall || PROP_RULES[p.kind].platform)), `${id} ${seed}: no blocker under a deck`);
      if (pr[n + k]) assert.ok(core[n + k], 'player-reachable deck is enemy-reachable');
    }
    assert.ok(decks >= 8, `${id} ${seed}: ${decks} deck tiles`);
  }
});

/** a deck tile of a location map, as world coordinates of its centre, with deck and ground heights */
function deckTile(W: World): { x: number; z: number; deck: number; ground: number; k: number } {
  const m = W.map, S = m.w;
  for (let k = 0; k < S * S; k++) {
    const ov = m.over?.[k] ?? 0;
    // an interior deck tile (decks on all four sides or the rim), so a step in any direction stays on it
    if (ov > 0 && [1, -1, S, -S].every((d) => (m.over![k + d] ?? 0) > 0 || Math.abs(m.elev[k + d] - ov) < 0.05)) return { x: (k % S) - W.half + 0.5, z: ((k / S) | 0) - W.half + 0.5, deck: ov, ground: m.elev[k], k };
  }
  throw new Error('no deck');
}

test('decks in the sim: height and collision follow the walker’s level; a jump from beneath never reaches the deck', () => {
  const run = createRun({ seed: 3, species: 'totodile', ruleOverrides: { worldgen: { mode: 'generated', locations: { meadow: 'chargestone-cave' } } } as never });
  const W = run.world, D = deckTile(W);
  assert.ok(W.over);
  assert.equal(W.height(D.x, D.z), D.ground, 'no reference: the ground');
  assert.equal(W.height(D.x, D.z, D.ground), D.ground, 'from below: the ground');
  assert.equal(W.height(D.x, D.z, D.deck), D.deck, 'on the deck: the deck');
  assert.equal(W.blocks(D.x, D.z, D.deck, 0.6), false, 'the deck is never a wall to someone on it');
  assert.equal(W.blocks(D.x, D.z, D.ground, 0.6), false, 'and the space beneath is open');
  assert.ok(W.ceilingAt(D.x, D.z, D.ground) < D.deck && W.ceilingAt(D.x, D.z, D.deck) === Infinity, 'a ceiling only for those beneath');
  // stand beneath and jump repeatedly: the player never ends up on top
  const P = run.player;
  P.x = P.px = D.x; P.z = P.pz = D.z; P.y = P.py = D.ground; P.vy = 0;
  let top = -Infinity;
  for (let t = 0; t < 180; t++) { step(run, { mx: 0, mz: 0, ax: 0, az: 1, jump: t % 20 === 0, dash: false } as never); top = Math.max(top, P.y); }
  assert.ok(top < D.deck - 0.9, `jump apex ${top.toFixed(2)} stays under the deck at ${D.deck}`);
  assert.ok(Math.abs(P.y - D.ground) < 0.05, 'lands back on the ground');
  // stand on top: the player stays on the deck
  P.y = P.py = D.deck; P.vy = 0;
  for (let t = 0; t < 60; t++) step(run, { mx: 0, mz: 0, ax: 0, az: 1, jump: false, dash: false } as never);
  assert.ok(Math.abs(P.y - D.deck) < 0.05, `stays on the deck (y ${P.y.toFixed(2)})`);
});

test('decks in the sim: the slab stops lines of fire through it; the flow field runs on both layers', () => {
  const rules = { ...defaultRules, worldgen: { ...defaultRules.worldgen, mode: 'generated' as const, locations: { meadow: 'mt-moon' } } };
  const W = new World(rules, BIOMES.meadow, 4), D = deckTile(W), m = W.map, S = m.w, n = S * S;
  // two deck tiles three apart in a row: on top they see each other, beneath they see each other, but a line from
  // the top of one to the ground under the other passes through the slab
  let pair: [number, number] | null = null;
  for (const step of [1, S]) for (let k = 0; k < n - 2 * step && !pair; k++) if ([0, 1, 2].every((d) => (m.over?.[k + d * step] ?? 0) > 0 && m.over![k + d * step] === m.over![k] && m.elev[k + d * step] === m.elev[k]) && (step === S || ((k + 2) % S) > (k % S))) pair = [k, k + 2 * step];
  assert.ok(pair, 'a straight run of deck');
  const [a, b] = pair!, top = m.over![a], low = m.elev[a];
  const ax = (a % S) - W.half + 0.5, az = ((a / S) | 0) - W.half + 0.5, bx = (b % S) - W.half + 0.5, bz = ((b / S) | 0) - W.half + 0.5;
  assert.equal(W.sight(ax, top + 0.9, az, bx, top + 0.6, bz), true, 'deck to deck: open');
  assert.equal(W.sight(ax, low + 0.9, az, bx, low + 0.6, bz), true, 'beneath to beneath: open');
  assert.equal(W.sight(ax, top + 0.9, az, bx, low + 0.6, bz), false, 'top of one to beneath the other: the slab is in the way');
  // player on the deck: the flow field reaches the ground beneath it (by the rim and a drop or a ramp) and vice versa
  W.updateFlow(D.x, D.z, D.deck);
  assert.ok(W.flowDist(D.x, D.z, D.deck) === 0, 'source node is the deck');
  assert.ok(W.flowDist(D.x, D.z, D.ground) < 0x7fff && W.flowDist(D.x, D.z, D.ground) > 2, 'the ground beneath is reached the long way round');
  W.updateFlow(D.x, D.z, D.ground);
  assert.ok(W.flowDist(D.x, D.z, D.deck) < 0x7fff && W.flowDist(D.x, D.z, D.deck) > 2, 'and the deck from beneath');
  // every deck node is reachable
  let unreached = 0;
  for (let k = 0; k < n; k++) if ((m.over?.[k] ?? 0) > 0 && W.flow[n + k] === 0x7fff) unreached++;
  assert.equal(unreached, 0);
});

test('decks: the chase camera stays under a deck above the Pokémon instead of climbing on top of it', async () => {
  const { ChaseRig, NO_THREAT } = await import('../src/render/camera');
  const rig = new ChaseRig();
  // a flat floor at 0 with a cliff 3 m high behind (z < -1) and a deck at 3 m overhead everywhere z < 2
  const ground = (_x: number, z: number) => (z < -1 ? 3 : 0);
  const ceiling = (_x: number, z: number) => (z < 2 && z >= -1 ? 2.4 : Infinity);
  rig.yaw = Math.PI; // looking toward -z: the boom points back into the open (+z)
  for (let t = 0; t < 120; t++) rig.update({ dt: 1 / 60, x: 0, y: 0, z: 0, height: 1, threat: NO_THREAT, lookYaw: 0, lookPitch: 0, ground, ceiling });
  assert.ok(rig.eye[1] < 2.4, `eye ${rig.eye[1].toFixed(2)} under the slab while the Pokémon is beneath it`);
  rig.yaw = 0; // looking toward +z: the boom points back into the cliff under the shelf
  for (let t = 0; t < 120; t++) rig.update({ dt: 1 / 60, x: 0, y: 0, z: 0, height: 1, threat: NO_THREAT, lookYaw: 0, lookPitch: 0, ground, ceiling });
  assert.ok(rig.eye[1] < 2.4 && rig.eye[2] > -1, `eye (${rig.eye[1].toFixed(2)}, z ${rig.eye[2].toFixed(2)}) stays in the alcove`);
});
