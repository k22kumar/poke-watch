// R1 headroom (docs/SIZING.md "Headroom", ledger Stage 6C): a body's sim height (class height × tilt × role size, from
// src/rules/sizing.ts) meets deck slabs. A rising head stops at the underside, a body taller than the gap under a deck
// does not walk or jump in under it (World.moveBody), and wide routing leaves such gaps out for that body only. With
// rules.size.headroom off every height argument is ignored (the older checksum layers).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultRules, type Rules } from '../src/rules/defaults';
import { BIOMES } from '../src/rules/stages';
import { DECK_SLAB, HEAD_EPS, World } from '../src/sim/world';
import { createRun, step } from '../src/sim/run';
import { spawnEnemy } from '../src/sim/enemies';
import { NO_INPUT, type SimContext } from '../src/sim/types';
import { SPECIES, SPECIES_BY_ID } from '../src/rules/species';
import { bodyOf, enemyHeight, footprintOf, navWide, partnerFootprint, partnerHeight } from '../src/rules/sizing';
import { CLEARANCE } from '../src/world/locgen/decks';
import { LOCATIONS } from '../src/world/locations';

/** an authored world whose map is replaced by a private flat plain at height 0 with a 3.0 m deck (gap 2.4 m) over
 *  columns i0..i0+5, rows j0..j0+5 (the map arrays are copied: the base map is shared by every World) */
function deckWorld(rules: Rules = defaultRules, top = 3) {
  const W = new World(rules, BIOMES.meadow, 5);
  const n = W.w * W.h, M = W.map;
  const map = { ...M, terrain: new Uint8Array(n), elev: new Float32Array(n), stairs: new Uint8Array(n), wall: new Uint8Array(n), platform: new Float32Array(n), over: new Float32Array(n), wlevel: undefined };
  Object.assign(W, { map, over: map.over, voids: new Uint8Array(n) });
  const i0 = 40, j0 = 40;
  for (let j = j0; j < j0 + 6; j++) for (let i = i0; i < i0 + 6; i++) map.over[j * W.w + i] = top;
  /** west edge of the deck and the centre row, world coordinates */
  return { W, edge: i0 - W.half, z: j0 + 3 - W.half, under: top - DECK_SLAB };
}
const off = { ...defaultRules, size: { ...defaultRules.size, headroom: false } } as Rules;

test('headroom: the slab test reads the body height; on the deck or with the flag off nothing changes', () => {
  const { W, edge, z, under } = deckWorld();
  const x = edge + 2.5;
  assert.equal(under, 2.4);
  assert.equal(W.collides(x, z, 0, 0.6, under - 0.01), false, 'a body under the gap fits');
  assert.equal(W.collides(x, z, 0, 0.6, under), false, 'exactly the gap fits (an Extra Large body at the class height, 2.4 m)');
  assert.equal(W.collides(x, z, 0, 0.6, under + 0.01), true, 'a taller one meets the slab');
  assert.equal(W.collides(x, z, 0, 0.6), false, 'no height given: as before');
  assert.equal(W.collides(x, z, 1.0, 0.6, 1.5), true, 'airborne: from its feet (1.0 + 1.5 > 2.4)');
  assert.equal(W.collides(x, z, 3, 0.6, 9), false, 'on top of the deck there is no ceiling');
  assert.equal(W.headroomAt(x, z, 0), under);
  assert.equal(W.headroomAt(x, z, 3), Infinity, 'none for a body on the deck');
  // beside the deck: the footprint reaches under it, the centre does not
  assert.equal(W.headroomAt(edge - 0.5, z, 0, 0.88), under, 'an Extra Large footprint 0.5 m from the edge is under the slab');
  assert.equal(W.headroomAt(edge - 0.5, z, 0, 0.3), Infinity, 'a Tiny one is not');
  const O = deckWorld(off).W;
  assert.equal(O.collides(x, z, 0, 0.6, under + 1), false, 'headroom off: the height is ignored');
  assert.equal(O.headroomAt(x, z, 0), Infinity);
});

test('headroom: World.moveBody stops a body taller than the gap at the deck edge and lets a shorter one walk under', () => {
  const { W, edge, z } = deckWorld();
  const out: [number, number] = [0, 0], r = 0.88;
  for (const [tall, under] of [[2.59, false], [2.25, true], [2.4, true]] as const) {
    let x = edge - 3;
    for (let s = 0; s < 40; s++) { W.moveBody(x, z, 0.2, 0, 0, 0.6, r, out, undefined, tall); x = out[0]; assert.ok(W.fits(x, z, 0, r - 2e-3, 0.6, tall), `${tall} m: clear of the slab at step ${s}`); }
    if (under) assert.ok(x > edge + 2, `${tall} m walks in under the deck (x ${(x - edge).toFixed(2)} past the edge)`);
    else assert.ok(x + r <= edge + 1e-3, `${tall} m stops with its footprint at the edge (${(x + r - edge).toFixed(3)} m)`);
  }
  // with the flag off the tall body walks in, as before
  const O = deckWorld(off);
  let x = O.edge - 3;
  for (let s = 0; s < 40; s++) { O.W.moveBody(x, O.z, 0.2, 0, 0, 0.6, r, out, undefined, 2.59); x = out[0]; }
  assert.ok(x > O.edge + 2, 'headroom off: heads pass through slabs');
});

/** a run on the authored meadow as `species` with no enemies, on a private deck world */
function scene(species: string, rules?: object, top = 3): { ctx: SimContext; W: World; edge: number; z: number; under: number } {
  const ctx = createRun({ seed: 1, species, ruleOverrides: rules as never });
  const D = deckWorld(ctx.rules, top);
  ctx.world = D.W;
  ctx.enemies.clear(); ctx.bodies.clear(); ctx.projectiles.clear();
  return { ctx, ...D };
}

test('headroom: a jump under a deck stops the head at the underside (P4: Feraligatr, head +1.60 m before)', () => {
  for (const [rules, capped] of [[undefined, true], [{ size: { headroom: false } }, false]] as const) {
    const { ctx, W, edge, z, under } = scene('feraligatr', rules);
    const P = ctx.player, tall = partnerHeight(P.species, ctx.rules);
    P.x = P.px = edge + 3; P.z = P.pz = z; P.y = P.py = 0; P.vy = 0; P.grounded = true;
    let head = -Infinity;
    for (let t = 0; t < 90; t++) { step(ctx, { ...NO_INPUT, jump: t === 0 }); head = Math.max(head, P.y + tall); }
    if (capped) {
      assert.ok(head <= under + HEAD_EPS, `head ${head.toFixed(3)} ≤ underside ${under}`);
      assert.ok(head > under - 0.01, 'and the jump does reach it');
      assert.ok(P.grounded && Math.abs(P.y) < 1e-6, 'lands back on the ground');
    } else assert.ok(head > under + 1.5, `flag off reproduces the defect (head ${(head - under).toFixed(2)} m into the slab)`);
  }
});

test('headroom: walking at a 2.4 m deck, Onix (2.59 m) stops at the edge while Feraligatr (2.25 m) walks under; neither ends a tick in the slab', () => {
  for (const [species, under] of [['onix', false], ['feraligatr', true]] as const) {
    const { ctx, W, edge, z } = scene(species);
    const P = ctx.player, tall = partnerHeight(P.species, ctx.rules), foot = partnerFootprint(P.species, ctx.rules);
    P.x = P.px = edge - 3; P.z = P.pz = z; P.y = P.py = 0; P.grounded = true;
    for (let t = 0; t < 120; t++) {
      // walk east, with a few jumps on the way (an airborne body meets the slab from its feet)
      step(ctx, { ...NO_INPUT, mx: 1, jump: t % 30 === 0 });
      assert.ok(W.fits(P.x, P.z, P.y, foot - 2e-3, 0.6, tall - 2e-3), `${species}: clear of the slab at tick ${t} (x ${(P.x - edge).toFixed(2)}, y ${P.y.toFixed(2)})`);
    }
    if (under) assert.ok(P.x > edge + 1.5, `${species} is under the deck`);
    else assert.ok(P.x < edge, `${species} stays outside (${(P.x - edge).toFixed(2)} m from the edge)`);
  }
});

/** a generated location map with decks, and a 2 × 2 block of open ground under one deck height (a wide block: room for
 *  an Extra Large footprint at its shared corner), as that corner */
function underpass(id: string, seed: number) {
  const ctx = createRun({ seed: 1, species: 'feraligatr', ruleOverrides: { worldgen: { mode: 'generated', regionSeed: seed, locations: { meadow: id, dusk: id, badlands: id, frost: id } } } as never });
  const W = ctx.world, m = W.map, S = W.w;
  for (let k = 0; k < S * (S - 1) - 1; k++) {
    if (k % S === S - 1) continue;
    const ok = [k, k + 1, k + S, k + S + 1].every((t) => (W.over?.[t] ?? 0) > 0 && W.isOpen(t) && !m.stairs[t] && m.elev[t] === m.elev[k] && W.over![t] === W.over![k]);
    if (ok && W.fits((k % S) + 1 - W.half, ((k / S) | 0) + 1 - W.half, m.elev[k], 0.88, 0.6, 2.25)) return { ctx, W, x: (k % S) + 1 - W.half, z: ((k / S) | 0) + 1 - W.half, ground: m.elev[k], under: W.over![k] - DECK_SLAB };
  }
  return null;
}

test('headroom: wide routing and placement use the body height (a gap is left out only for a body it does not fit)', () => {
  const U = underpass('viridian-forest', 1) ?? underpass('chargestone-cave', 1) ?? underpass('viridian-forest', 2) ?? underpass('chargestone-cave', 3);
  assert.ok(U, 'an underpass wide enough for an Extra Large body');
  const { W, x, z, ground, under } = U!;
  assert.ok(Math.abs(under - ground - 2.4) < 1e-6, `the generators' 2.4 m gap (${(under - ground).toFixed(2)})`);
  // the player stands beneath the deck: the field for a 2.25 m body reaches its tile, the one for 2.59 m does not
  W.updateFlow(x, z, ground);
  assert.ok(W.wideReached(x, z, false, ground, 2.25), 'Feraligatr (2.25 m) has a wide route under the deck');
  assert.ok(W.wideReached(x, z, false, ground), 'no height given: as before');
  assert.equal(W.wideReached(x, z, false, ground, 2.59), false, 'Onix (2.59 m) has none');
  // placement: a tall body put down there goes where it fits, never under the slab
  const [px, pz] = W.nearestFit(x, z, 0.88, true, true, 2.59);
  assert.ok(W.fits(px, pz, W.height(px, pz), 0.88, 0.6, 2.59), `placed clear of the slab at ${px},${pz}`);
  assert.ok(W.headroomAt(px, pz, W.height(px, pz), 0.88) - W.height(px, pz) >= 2.59, 'with headroom for its height');
  const [qx, qz] = W.nearestFit(x, z, 0.88, true, true, 2.25);
  assert.ok(qx === x && qz === z, `a body that fits is put down where asked (${qx},${qz} for ${x},${z})`);
});

test('headroom: every narrow body the sim can field fits under the lowest deck gap the generators allow (the narrow field has no height classes)', () => {
  // the ordinary (tile-centre) flow field is not height-aware: that is sound only while no narrow body is taller than
  // the gap. The generators keep every deck CLEARANCE (2.9 m) above the ground under it, so the gap is ≥ 2.3 m
  const gap = CLEARANCE - DECK_SLAB, R = defaultRules, roles = R.enemy.roles;
  const bad: string[] = [];
  for (const sp of SPECIES) {
    if (sp.flying) continue;
    for (const size of sp.boss ? [roles.boss.size] : [1, roles.elite.size, roles.alpha.size]) {
      const f = footprintOf(sp, size, R);
      if (!navWide(f, R) && enemyHeight(sp, size, R) > gap) bad.push(`${sp.id} ×${size}: ${enemyHeight(sp, size, R).toFixed(2)} m, footprint ${f.toFixed(2)}`);
    }
  }
  assert.deepEqual(bad, []);
  // and the maps keep the generators' promise (decks over open ground)
  for (const id of Object.keys(LOCATIONS)) for (const seed of [1, 2]) {
    const ctx = createRun({ seed: 1, species: 'totodile', ruleOverrides: { worldgen: { mode: 'generated', regionSeed: seed, locations: { meadow: id, dusk: id, badlands: id, frost: id } } } as never });
    const W = ctx.world;
    if (!W.over) continue;
    for (let k = 0; k < W.over.length; k++) if (W.over[k] > 0 && W.isOpen(k)) assert.ok(W.over[k] - DECK_SLAB - W.topOf(k) >= gap - 1e-6, `${id} ${seed}: gap ${(W.over[k] - DECK_SLAB - W.topOf(k)).toFixed(2)} at tile ${k}`);
  }
  // the bodies headroom changes most: Onix is the one species over 2.4 m at ×1; every Medium-or-larger elite is over it
  assert.ok(bodyOf(SPECIES_BY_ID.onix, R.size).height > 2.4 && bodyOf(SPECIES_BY_ID.feraligatr, R.size).height < 2.4);
});

// xlTall (docs/SIZING.md "Giants", size-extremes-plan xlTall): with xlContinuous on too, an Extra Large body's height is
// its drawn size × (class height ÷ class visual), and headroom reads it like any other height
// (all three flags are the defaults since the size-extremes flip; each set below pins every flag explicitly)
const OFF = { size: { axis: false, xlContinuous: false, xlTall: false } };
const TALL = { size: { axis: false, xlContinuous: true, xlTall: true } };
const GIANTS = { size: { axis: true, xlContinuous: true, xlTall: true } };
const FLAG_SETS: [string, object | undefined][] = [['defaults', undefined], ['off', OFF], ['axis', { size: { axis: true, xlContinuous: false, xlTall: false } }], ['xl', { size: { axis: false, xlContinuous: true, xlTall: false } }], ['tall', TALL], ['giants', GIANTS]];

test('headroom (xlTall): at a 2.7 m gap Onix walks under at the class height and stops at the edge once it is as tall as drawn', () => {
  const at = (sp: string, rules?: object) => {
    const { ctx, W, edge, z } = scene(sp, rules, 3.3);
    const P = ctx.player, tall = partnerHeight(P.species, ctx.rules), foot = partnerFootprint(P.species, ctx.rules);
    P.x = P.px = edge - 3; P.z = P.pz = z; P.y = P.py = 0; P.grounded = true;
    for (let t = 0; t < 120; t++) {
      step(ctx, { ...NO_INPUT, mx: 1 });
      assert.ok(W.fits(P.x, P.z, P.y, foot - 2e-3, 0.6, tall - 2e-3), `${sp}: clear of the slab at tick ${t}`);
    }
    return { tall, inside: P.x > edge + 1.5, outside: P.x < edge };
  };
  const base = at('onix', OFF), giants = at('onix', GIANTS), tall = at('onix', TALL), gator = at('feraligatr', GIANTS);
  assert.ok(base.tall < 2.7 && base.inside, `Onix at ${base.tall.toFixed(2)} m walks under`);
  assert.ok(giants.tall > 2.7 && giants.outside, `Onix at ${giants.tall.toFixed(2)} m (all three flags) stops`);
  assert.ok(tall.tall > giants.tall && tall.outside, `Onix at ${tall.tall.toFixed(2)} m (no axis) stops`);
  assert.ok(gator.tall < 2.7 && gator.inside, `Feraligatr at ${gator.tall.toFixed(2)} m walks under`);
  // a wild Onix carries the same height in its hit window (E.tall) and its spawn fit
  const ctx = createRun({ seed: 1, species: 'totodile', ruleOverrides: GIANTS as never });
  const e = spawnEnemy(ctx, 'onix', ctx.player.x + 6, ctx.player.z);
  assert.equal(ctx.enemies.tall[e], Math.fround(enemyHeight(SPECIES_BY_ID.onix, 1, ctx.rules)), 'E.tall (float32)');
  assert.equal(enemyHeight(SPECIES_BY_ID.onix, 1, ctx.rules), giants.tall);
  assert.equal(at('onix').tall, giants.tall, 'the defaults are all three flags');
});

test('headroom: no narrow body is taller than the lowest deck gap under any size flag set (S1, xlTall)', () => {
  const gap = CLEARANCE - DECK_SLAB;
  for (const [name, over] of FLAG_SETS) {
    const R = createRun({ seed: 1, species: 'totodile', ruleOverrides: over as never }).rules, roles = R.enemy.roles;
    const bad: string[] = [];
    for (const sp of SPECIES) {
      if (sp.flying) continue;
      for (const size of sp.boss ? [roles.boss.size] : [1, roles.elite.size, roles.alpha.size]) {
        const f = footprintOf(sp, size, R);
        if (!navWide(f, R) && enemyHeight(sp, size, R) > gap) bad.push(`${sp.id} ×${size}: ${enemyHeight(sp, size, R).toFixed(2)} m, footprint ${f.toFixed(2)}`);
      }
      const pf = partnerFootprint(sp, R);
      if (!navWide(pf, R) && partnerHeight(sp, R) > gap) bad.push(`${sp.id} as partner: ${partnerHeight(sp, R).toFixed(2)} m`);
    }
    assert.deepEqual(bad, [], name);
  }
});
