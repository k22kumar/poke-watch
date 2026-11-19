// Third-person composition (docs/THIRD_PERSON.md "Composition"; acceptance criteria A, B and C4 of
// docs/THIRD_PERSON_IMPLEMENTATION.md §25): where the sprite as drawn lands on screen against the keep-out around the
// crosshair, on the real atlases, and what holds when the world leaves no room for the framing. Stable camera
// transforms are not a stable picture: these project the outline the shader draws (render/framing.ts) through the rig.
import test from 'node:test';
import assert from 'node:assert/strict';
import { CHASE_CONFIG, ChaseRig, boomElevation, chaseArm, type ChaseFrame } from '../src/render/camera';
import { KEEP_SLACK, classOutline, fadeFor, reserveCorner, seen, subjectBox, type Outline } from '../src/render/framing';
import { bodyOf } from '../src/rules/sizing';
import { SPECIES_BY_ID } from '../src/rules/species';
import { isRecruitable } from '../src/rules/profiles';
import { atPitch, composition, hudOverlap, onScreen } from '../scripts/camframe';
import { settled } from '../scripts/lib/camrig';
import { framedSpecies, playFrames, spriteOutline } from '../scripts/lib/silhouette';
import { FRAME_GIANTS, fixtureOnly, frameBodyOf } from '../scripts/lib/giants';

const R = CHASE_CONFIG.reticle, D2R = Math.PI / 180;
const ROSTER = framedSpecies();

test('criterion A: on open ground no standing or walking frame of any species is inside the keep-out; a combat frame is only where the fixed allowance is capped', () => {
  assert.ok(ROSTER.length >= 60, `${ROSTER.length} species with art and a size class`);
  let capped = 0;
  for (const id of [...ROSTER, ...fixtureOnly()]) { // the capture-only giants too (F3)
    const row = composition(id), arm = chaseArm({ outline: spriteOutline(id)!.outline, height: 1 });
    assert.equal(row.body, 0, `${id}: ${row.body} idle / walk frames inside the keep-out (deepest ${row.bodyDeep}°)`);
    if (row.cast + row.hurt > 0) { capped++; assert.ok(arm.capped, `${id}: ${row.cast + row.hurt} combat frames inside, yet its allowance (${arm.need.toFixed(1)}° needed) is not at the cap`); }
    else assert.ok(!arm.capped || arm.need > R.reach, id);
    assert.ok(!arm.sideCapped, `${id}: the shoulder (${arm.shoulder.toFixed(2)} m) reaches past the widest row`);
  }
  // (the roster of 2026-11: 22 species have attack, shoot, charge or hurt frames past the 4° allowance; those frames
  // dissolve. The catalogue wave adds 37 more, docs/size-extremes-plan.md §S2)
  const older = [...ROSTER, ...fixtureOnly()].filter((id) => !SPECIES_BY_ID[id]?.wave && composition(id).cast + composition(id).hurt > 0).length;
  assert.ok(older <= 24, `${older} pre-wave species have frames past the allowance`);
  assert.ok(capped - older <= 40, `${capped - older} catalogue-wave species have frames past the allowance`);
});

// F3 (docs/size-extremes-plan.md, docs/THIRD_PERSON_IMPLEMENTATION.md §26): the capture-only giants Wailord and
// Eternatus are checked as partners from their measured numbers (tests/fixtures/giants-frame.json, scripts/lib/giants.ts)
// until S2 makes them game species; then the real species are used and the fixture must go
const PARTNERS = [...ROSTER, ...fixtureOnly()];
const backCapped = (id: string) => chaseArm({ outline: spriteOutline(id)!.outline, height: 1 }).back >= CHASE_CONFIG.frame.max - 1e-9;

test('the capture-only giants: in the fixture only while they are not game species', () => {
  assert.ok(fixtureOnly().length >= 2 || ['wailord', 'eternatus'].every((id) => SPECIES_BY_ID[id]), 'Wailord and Eternatus are checked: from the fixture or as game species');
  for (const id of Object.keys(FRAME_GIANTS)) assert.ok(!SPECIES_BY_ID[id], `${id} is a game species now (S2): switch to it and delete tests/fixtures/giants-frame.json`);
});

test('criterion B: every species has the same corner on the keep-out, its whole drawn body in frame at 0.30 to 0.40 of the frame height, and its lowest point over the move bar', () => {
  for (const id of PARTNERS) {
    const row = composition(id);
    assert.ok(Math.abs(row.cornerX + R.side) < 0.5 && Math.abs(row.cornerY + R.below) < 0.5, `${id}: corner (${row.cornerX}°, ${row.cornerY}°)`);
    assert.ok(row.feetY <= 0.95, `${id}: feet at ${row.feetY}`);
    // a PMD sprite's anchor is the middle of its footprint: the picture reaches below it (a fifth of its height at the
    // median). The size and the bottom edge are judged on what is drawn, not on the anchor: framed from the top alone,
    // idle and walk frames reached 0.85 to 1.11 of the frame height (six species off the bottom edge)
    assert.ok(row.bottomY <= 0.95, `${id}: lowest drawn point of an idle / walk frame at ${row.bottomY}`);
    assert.ok(row.drawn >= 0.3 && row.drawn <= 0.4, `${id}: drawn body ${row.drawn} of the frame height`);
    for (const aspect of [4 / 3, 16 / 9]) assert.ok(onScreen(id, CHASE_CONFIG.fov, aspect).feet, `${id}: feet on screen at aspect ${aspect.toFixed(2)}`);
    // the HUD's move bar (fixed pixels, bottom centre): no idle or walk frame under it in a 1080p window; in a
    // 1280 x 720 one a frame reaches at most 2.5 % of the screen height under it
    assert.equal(hudOverlap(id, 1920, 1080).under, 0, `${id}: a frame under the move bar at 1920 x 1080`);
    assert.ok(hudOverlap(id, 1280, 720).under <= 0.025, `${id}: ${(100 * hudOverlap(id, 1280, 720).under).toFixed(1)} % of the screen height under the move bar at 1280 x 720`);
  }
  // criterion E4: with no input the crosshair meets flat ground inside the planar aim range, for every class (a partner
  // whose neutral ground point would lie past aim.max is framed with the subject tilt that brings it back: chaseTilt)
  for (const id of PARTNERS) { const g = composition(id).ground; assert.ok(g >= CHASE_CONFIG.aim.min && g <= CHASE_CONFIG.aim.max, `${id} (${frameBodyOf(id).className}): neutral crosshair ground point ${g} m`); }
  // no partner is held short of its framing by frame.max (a future giant that needs more than it fails here). A species
  // that is never a partner (SPECIES_OVERRIDES `recruitable: false`) is not framed by the chase camera: Stakataka is held
  // out for exactly this (docs/size-extremes-plan.md §S2)
  assert.deepEqual(PARTNERS.filter((id) => isRecruitable(id) && backCapped(id)), []);
  assert.deepEqual(PARTNERS.filter(backCapped), ['stakataka']);
});

test('the whole look range: inside the orbit range no standing or walking frame enters the keep-out; past it the crosshair ray still passes beside the outline and what crosses the keep-out dissolves', () => {
  const sample = ['pichu', 'joltik', 'cyndaquil', 'koffing', 'quilava', 'charizard', 'venusaur', 'feraligatr', 'lapras', 'onix'];
  for (const id of sample) {
    const o = spriteOutline(id)!, frames = playFrames(o).filter((f) => f.clip === 'idle' || f.clip === 'walk');
    for (const pitch of [-89, -60, -30, -10, -1, 11, 20, 30, 36, 40, 60, 89]) {
      const rig = settled(id, pitch);
      // the crosshair ray never passes through the outline: it runs `shoulder` m to the side of the Pokémon's line, the
      // outline reaches `right` m toward it
      assert.ok(rig.shoulderUsed > rig.cornerRight, `${id} ${pitch}°: shoulder ${rig.shoulderUsed.toFixed(2)} m, outline ${rig.cornerRight.toFixed(2)} m`);
      const orbit = boomElevation(pitch - CHASE_CONFIG.aimPitch.neutral) === pitch + R.below || pitch < -1;
      for (const f of frames) {
        const d = subjectBox(rig, [0, 0, 0], f.card, R).depth;
        // (to within KEEP_SLACK: seen from over 51°, a card leans instead of stretching, and its corner is no longer exactly
        // where an upright one's would be)
        if (orbit) assert.ok(d <= KEEP_SLACK, `${id} ${pitch}° ${f.clip} row ${f.row} frame ${f.frame}: ${d.toFixed(2)}° inside the keep-out`);
        else assert.ok(d <= KEEP_SLACK || fadeFor(d) >= 0.5, `${id} ${pitch}°: a frame inside the keep-out is not dissolved`);
      }
    }
    assert.equal(atPitch(id, CHASE_CONFIG.aimPitch.neutral).unfaded, 0, `${id}: every frame inside the keep-out dissolves by half or more`);
  }
});

test('the fixed combat allowance: the smallest sideways shift that keeps every combat corner out, capped, never upward, never per frame', () => {
  const body: Outline = { top: 1.4, right: 0.6, left: 0.6, combat: [] };
  assert.deepEqual(reserveCorner(body, 3.5, 1.13, R), { right: 0.6, top: 1.4, need: 0, capped: false });
  // wider but no taller, taller but no wider: neither reaches past the corner both ways, so nothing moves
  assert.equal(reserveCorner({ ...body, combat: [[0.9, 1.4], [0.6, 2.2]] }, 3.5, 1.13, R).right, 0.6);
  // past it both ways: the corner goes sideways to the frame's reach; the top never rises (reticle.rise is 0)
  const c = reserveCorner({ ...body, combat: [[0.75, 1.6], [0.7, 1.9]] }, 3.5, 1.13, R);
  assert.equal(c.right, 0.75); assert.equal(c.top, 1.4); assert.equal(c.capped, false);
  // more than reticle.reach away: capped there, and reported
  const far = reserveCorner({ ...body, combat: [[1.6, 1.8]] }, 3.5, 1.13, R);
  assert.ok(Math.abs(far.right - (0.6 + 3.5 * Math.tan(R.reach * D2R))) < 1e-9 && far.capped && far.need > R.reach, `corner ${far.right.toFixed(3)} m, ${far.need.toFixed(1)}° needed`);
  // a procedural lunge (OVERLAY: 0.18 m along the facing, 0.036 m up) is part of a pack's attack corners
  const o = spriteOutline('cyndaquil')!, arm = chaseArm({ outline: o.outline, height: 1 });
  assert.ok(arm.right >= o.outline.right && arm.top === o.outline.top, 'the allowance only ever widens');
  // one figure per sprite: the same arm whatever the pitch, and the same every frame of a fight
  const a = settled('cyndaquil', 11), b = settled('cyndaquil', 30);
  assert.equal(a.shoulderWant, b.shoulderWant); assert.equal(a.backWant, b.backWant); assert.equal(a.cornerRight, b.cornerRight);
});

// ---- criterion C4: tight poses, measured on the final pose after every adjustment
const WALL = 0.3; // metres of clearance the test asks of the lens, in its own terms
interface Scene { name: string; ground: (x: number, z: number) => number; ceiling?: (x: number, z: number) => number; solid?: (x: number, y: number, z: number) => boolean }
// the view looks along -z (yaw pi): +z is behind it, +x on its right
const SCENES: Scene[] = [
  { name: 'open', ground: () => 0 },
  { name: 'wall 1 m behind', ground: (_x, z) => (z > 1 ? 8 : 0) },
  { name: 'wall 2.5 m behind', ground: (_x, z) => (z > 2.5 ? 8 : 0) },
  { name: 'bare wall on the right', ground: () => 0, solid: (x) => x > 0.9 },
  { name: 'corner: behind and right', ground: (_x, z) => (z > 1.2 ? 8 : 0), solid: (x) => x > 0.9 },
  { name: 'low deck', ground: () => 0, ceiling: () => 2.4 },
  { name: 'alcove: deck, wall behind, wall right', ground: (_x, z) => (z > 1.5 ? 8 : 0), ceiling: () => 2.4, solid: (x) => x > 1 },
  { name: 'floor rising behind', ground: (_x, z) => Math.max(0, z * 0.6) },
];
function clearOf(s: Scene, e: readonly number[]): boolean {
  for (const [dx, dz] of [[0, 0], [WALL - 0.02, 0], [-WALL + 0.02, 0], [0, WALL - 0.02], [0, -WALL + 0.02]]) {
    const x = e[0] + dx, z = e[2] + dz, centre = !dx && !dz;
    if (e[1] < s.ground(x, z) + (centre ? WALL - 0.02 : 0)) return false;
    if (s.ceiling && e[1] > s.ceiling(x, z) - (centre ? WALL - 0.02 : 0)) return false;
    if (s.solid?.(x, e[1], z)) return false;
  }
  return true;
}

test('criterion C4: against a wall, in a corner, under a low deck and in an alcove, over the whole pitch range: the lens keeps its clearance, the view is the player\'s, and the Pokémon is out of the keep-out or dissolved', () => {
  for (const id of ['pichu', 'cyndaquil', 'quilava', 'charizard', 'feraligatr', 'lapras']) {
    const sub = { height: 1, outline: spriteOutline(id)!.outline };
    for (const s of SCENES) for (const pitch of [-89, -45, -1, 11, 36, 60, 89]) {
      const rig = new ChaseRig();
      const f: ChaseFrame = { dt: 1 / 60, x: 0, y: 0, z: 0, ...sub, grounded: true, lookYaw: 0, lookPitch: 0, ground: s.ground, ceiling: s.ceiling, solid: s.solid };
      rig.snapTo(0, 0, 0, Math.PI);
      rig.look(0, (pitch - CHASE_CONFIG.aimPitch.neutral) * D2R);
      const tag = `${id}, ${s.name}, ${pitch}°`;
      for (let k = 0; k < 120; k++) {
        // settling, then turning to and fro: every frame is checked, not only the settled one
        rig.update({ ...f, lookYaw: k > 60 ? Math.sin(k / 7) * 0.01 : 0 });
        // P1 (the Pokémon itself may stand closer to a wall than the lens may: a lens right at the hand of an arm with
        // nowhere to go is the near-plane case, where the Pokémon dissolves)
        const atBody = rig.lensGap < 0.95;
        assert.ok(atBody || clearOf(s, rig.eye), `${tag}, frame ${k}: lens (${rig.eye.map((v) => v.toFixed(2))}) within ${WALL} m of a solid`);
        // P2: the view is the pitch asked for and the yaw the player turned to, nothing else
        assert.ok(Math.abs(rig.viewPitch - pitch * D2R) < 1e-9, `${tag}: view pitch ${(rig.viewPitch / D2R).toFixed(3)}°`);
      }
      // P3 or P4: the body outline is out of the keep-out, or the fade it is drawn with is a half or more
      const o = sub.outline, box = subjectBox(rig, [0, 0, 0], { l: o.left, r: o.right, t: o.top, b: 0 }, R);
      const near = rig.lensGap >= 0.45 ? Math.min(0.75, Math.max(0, (0.95 - rig.lensGap) / 0.5)) : 0.75;
      assert.ok(box.depth <= KEEP_SLACK || Math.max(near, fadeFor(box.depth)) >= 0.5, `${tag}: ${box.depth.toFixed(1)}° inside the keep-out, undissolved`);
      // and in the orbit range, where nothing takes the shoulder or the pivot, the composition holds at any arm length
      if ((s.name === 'open' || s.name.startsWith('wall')) && pitch >= -1 && pitch <= 36) {
        assert.ok(box.depth <= KEEP_SLACK, `${tag}: the wall behind shortened the arm to ${rig.boomUsed.toFixed(2)} m and the outline is ${box.depth.toFixed(2)}° inside the keep-out`);
        const c = seen(rig, 0, rig.pivotH, 0);
        assert.ok(Math.abs(c[1] + R.below) < 0.6, `${tag}: the outline's top is ${(-c[1]).toFixed(2)}° under the crosshair line (${R.below}° asked)`);
      }
    }
  }
});

test('a subject with no measured art is framed from its size class: the medians of the measured roster', () => {
  const tops: number[] = [], reach: number[] = [];
  for (const id of ROSTER) { const o = spriteOutline(id)!.outline, v = bodyOf(SPECIES_BY_ID[id]).visualM; tops.push(o.top / v); reach.push(o.right / v); }
  const med = (a: number[]) => [...a].sort((x, y) => x - y)[a.length >> 1], c = classOutline(1);
  assert.ok(Math.abs(med(tops) - c.top) < 0.1 && Math.abs(med(reach) - c.right) < 0.1, `roster medians ${med(tops).toFixed(2)} / ${med(reach).toFixed(2)} of the visible core, fallback ${c.top} / ${c.right}`);
});
