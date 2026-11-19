// Third-person composition report (no GL): where each Pokémon's drawn sprite lands on screen, measured against the
// keep-out around the crosshair (docs/THIRD_PERSON.md "Composition"; acceptance criteria A, B and E4 of
// docs/THIRD_PERSON_IMPLEMENTATION.md §25). Every frame of every gameplay clip of every size-class species is projected
// through the settled rig on open flat ground, with the billboard shader's own maths (render/framing.ts).
//   npx tsx scripts/camframe.ts [--species a,b] [--pitch -89,..] [--json out.json] [-v]
//
//   corner      the body outline's (idle + walk, all rows) top-right corner, degrees from the crosshair (right +, up +)
//   feetY       the anchor's height on screen, 0 top .. 1 bottom (at the base FOV). A PMD sprite's anchor is the middle of
//               its ground footprint, so the picture reaches lower than this:
//   bottomY     the lowest drawn point of any idle or walk frame, 0 top .. 1 bottom
//   share       body top to anchor, as a share of the screen height
//   drawn       body top to bottomY, as a share of the screen height: the size the body is drawn at (criterion B)
//   HUD         the move bar (ui/style.css .hud-bottom: fixed pixels, bottom centre) against every idle and walk frame at
//               common window sizes: species with a frame under it, how far (share of the screen height), and the largest
//               share of a frame's own height it hides
//   body / cast / hurt   frames of those clips inside the keep-out (more than render/framing.ts KEEP_SLACK, 0.3°, past its
//               edge: the composition puts the outline's corner exactly on it), and the worst depth inside it (deg)
//   pitch sweep frames of any gameplay clip inside the keep-out at each view pitch; frames the fade does not cover
//   ground      where the crosshair meets flat ground with no input, metres ahead of the Pokémon (planar aim range 4..26)
import fs from 'node:fs';
import { CHASE_CONFIG } from '../src/render/camera';
import { KEEP_SLACK, cardPoint, seen, subjectBox, type KeepOut } from '../src/render/framing';
import { bodyOf } from '../src/rules/sizing';
import { SPECIES_BY_ID } from '../src/rules/species';
import { RIG_VERSION, applySet, fadeOf, settled } from './lib/camrig';
import { framedSpecies, playFrames, spriteOutline } from './lib/silhouette';
import { frameBodyOf } from './lib/giants';

const arg = (k: string, d: string) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const D2R = Math.PI / 180;
/** the keep-out the criteria are written against (fixed before the second pass: docs/THIRD_PERSON_IMPLEMENTATION.md §25) */
export const KEEP_OUT: KeepOut = { side: 7, below: 3 };
export const PITCHES = [-89, -60, -30, -10, -1, 6, 16, 26, 36, 40, 60, 89];
export const FOVS = [40, 54, 64, 76, 85];
export const ASPECTS: [string, number][] = [['4:3', 4 / 3], ['16:10', 1.6], ['16:9', 16 / 9], ['21:9', 21 / 9]];

export interface FrameRow { id: string; cls: string; boom: number; shoulder: number; lensY: number; cornerX: number; cornerY: number; feetY: number; bottomY: number; share: number; drawn: number; left: number; body: number; bodyDeep: number; cast: number; castDeep: number; hurt: number; hurtDeep: number; frames: number; ground: number }

/** window sizes the HUD overlap is reported at (CSS px: a 1080p screen full screen and in a browser window, laptops) */
export const WINDOWS: [number, number][] = [[1920, 1080], [1920, 970], [1536, 730], [1440, 790], [1366, 650], [1280, 720]];
/** the move bar's box in a window, as screen fractions (ui/style.css: .hud-bottom sits 12 px off the bottom edge, its
 *  slots are 46 px tall, three of 116 px (92 px in windows up to 860 px wide) and one of 104 px, 10 px apart; measured
 *  in a 1280 x 720 capture: left 0.312, right 0.688, top 0.919, bottom 0.983) */
export function moveBar(w: number, h: number): { left: number; right: number; top: number; bottom: number } {
  const half = (3 * (w <= 860 ? 92 : 116) + 104 + 30) / 2;
  return { left: 0.5 - half / w, right: 0.5 + half / w, top: 1 - 58 / h, bottom: 1 - 12 / h };
}

/** every idle and walk frame of a species at the neutral pitch, as screen boxes in degrees from the crosshair */
export function bodyBoxes(id: string): { left: number; right: number; top: number; bottom: number }[] {
  const o = spriteOutline(id)!, rig = settled(id, CHASE_CONFIG.aimPitch.neutral);
  return playFrames(o).filter((fr) => fr.clip === 'idle' || fr.clip === 'walk').map((fr) => subjectBox(rig, [0, 0, 0], fr.card, KEEP_OUT));
}

/** the move bar over a species' idle and walk frames in a `w` x `h` window: the furthest a frame reaches under the bar's
 *  top (share of the screen height, 0: none does) and the largest share of a frame's own box the bar covers */
export function hudOverlap(id: string, w: number, h: number): { under: number; hidden: number } {
  const bar = moveBar(w, h), tv = Math.tan((CHASE_CONFIG.fov * D2R) / 2), th = tv * (w / h);
  let under = 0, hidden = 0;
  for (const b of bodyBoxes(id)) {
    const l = 0.5 + Math.tan(b.left * D2R) / th / 2, r = 0.5 + Math.tan(b.right * D2R) / th / 2, t = 0.5 - Math.tan(b.top * D2R) / tv / 2, bt = 0.5 - Math.tan(b.bottom * D2R) / tv / 2;
    const ox = Math.min(r, bar.right) - Math.max(l, bar.left), oy = Math.min(bt, bar.bottom, 1) - Math.max(t, bar.top);
    if (ox <= 0 || oy <= 0) continue;
    under = Math.max(under, oy); hidden = Math.max(hidden, (ox * oy) / ((r - l) * (bt - t)));
  }
  return { under, hidden };
}

/** one species on open flat ground at the neutral pitch */
export function composition(id: string): FrameRow {
  const o = spriteOutline(id)!, rig = settled(id, CHASE_CONFIG.aimPitch.neutral), A = [0, 0, 0];
  const tf = Math.tan((CHASE_CONFIG.fov * D2R) / 2);
  const bodyCard = { l: o.outline.left, r: o.outline.right, t: o.outline.top, b: 0 }, bb = subjectBox(rig, A, bodyCard, KEEP_OUT);
  const feet = seen(rig, 0, 0, 0);
  // the corner the composition pins: the reserved outline's top-right point, as the shader draws it
  const cp = cardPoint(rig, A, rig.cornerRight, rig.cornerTop), cs = seen(rig, cp[0], cp[1], cp[2]);
  const row: FrameRow = { id, cls: frameBodyOf(id).className, boom: +rig.boomUsed.toFixed(2), shoulder: +rig.shoulderUsed.toFixed(2), lensY: +rig.eye[1].toFixed(2), cornerX: +cs[0].toFixed(2), cornerY: +cs[1].toFixed(2), feetY: +(0.5 - Math.tan(feet[1] * D2R) / tf / 2).toFixed(3), bottomY: 0, share: +((Math.tan(bb.top * D2R) - Math.tan(feet[1] * D2R)) / tf / 2).toFixed(3), drawn: 0, left: +bb.left.toFixed(1), body: 0, bodyDeep: 0, cast: 0, castDeep: 0, hurt: 0, hurtDeep: 0, frames: 0, ground: 0 };
  for (const fr of playFrames(o)) {
    const sb = subjectBox(rig, A, fr.card, KEEP_OUT), d = sb.depth;
    if (fr.clip === 'idle' || fr.clip === 'walk') row.bottomY = Math.max(row.bottomY, +(0.5 - Math.tan(sb.bottom * D2R) / tf / 2).toFixed(3));
    row.frames++;
    if (d <= KEEP_SLACK) continue;
    if (fr.clip === 'idle' || fr.clip === 'walk') { row.body++; row.bodyDeep = Math.max(row.bodyDeep, d); }
    else if (fr.clip === 'hurt') { row.hurt++; row.hurtDeep = Math.max(row.hurtDeep, d); }
    else { row.cast++; row.castDeep = Math.max(row.castDeep, d); }
  }
  row.drawn = +(row.bottomY - (0.5 - Math.tan(bb.top * D2R) / tf / 2)).toFixed(3);
  row.bodyDeep = +row.bodyDeep.toFixed(1); row.castDeep = +row.castDeep.toFixed(1); row.hurtDeep = +row.hurtDeep.toFixed(1);
  // where the crosshair ray meets flat ground, ahead of the Pokémon along the view (before chaseAim's clamp)
  const sp = Math.sin(rig.viewPitch), s = sp > 1e-6 ? rig.eye[1] / sp : Infinity;
  row.ground = +(((rig.eye[0] + Math.sin(rig.yaw) * Math.cos(rig.viewPitch) * s) * Math.sin(rig.yaw) + (rig.eye[2] + Math.cos(rig.yaw) * Math.cos(rig.viewPitch) * s) * Math.cos(rig.yaw))).toFixed(1);
  return row;
}

/** every gameplay frame of a species at a view pitch: frames inside the keep-out, those the fade leaves under a half,
 *  and the worst depth */
export function atPitch(id: string, pitch: number): { inside: number; unfaded: number; deep: number; frames: number } {
  const o = spriteOutline(id)!, rig = settled(id, pitch), A = [0, 0, 0];
  let inside = 0, unfaded = 0, deep = 0, frames = 0;
  for (const fr of playFrames(o)) {
    const b = subjectBox(rig, A, fr.card, KEEP_OUT);
    frames++;
    if (b.depth <= KEEP_SLACK) continue;
    inside++; deep = Math.max(deep, b.depth);
    if (Math.max(fadeOf(rig, b), 0) < 0.5) unfaded++;
  }
  return { inside, unfaded, deep, frames };
}

/** is the body outline on screen at a field of view and aspect: the anchor above the bottom 5 %, the left edge inside the frame */
export function onScreen(id: string, fov: number, aspect: number): { feet: boolean; left: boolean } {
  const o = spriteOutline(id)!, rig = settled(id, CHASE_CONFIG.aimPitch.neutral);
  const b = subjectBox(rig, [0, 0, 0], { l: o.outline.left, r: o.outline.right, t: o.outline.top, b: 0 }, KEEP_OUT), feet = seen(rig, 0, 0, 0);
  const tv = Math.tan((fov * D2R) / 2), th = tv * aspect;
  return { feet: 0.5 - Math.tan(feet[1] * D2R) / tv / 2 <= 0.95, left: Math.tan(b.left * D2R) / th >= -1 };
}

if (process.argv[1]?.endsWith('camframe.ts')) {
  const set = applySet();
  if (set) console.log('CHASE_CONFIG overrides:', set);
  const ids = arg('species', '').split(',').filter(Boolean);
  const list = ids.length ? ids : framedSpecies();
  const pitches = arg('pitch', PITCHES.join(',')).split(',').map(Number);
  const rows = list.map(composition);
  if (process.argv.includes('-v')) console.table(rows);
  const q = (v: number[], p: number) => { const s = [...v].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
  const rng = (f: (r: FrameRow) => number) => `${Math.min(...rows.map(f))} .. ${q(rows.map(f), 0.5)} .. ${Math.max(...rows.map(f))}`;
  const summary = {
    rig: RIG_VERSION, keepOut: KEEP_OUT, species: rows.length,
    'A body: species with an idle/walk frame inside': rows.filter((r) => r.body > 0).length,
    'A cast: species with an attack/shoot/charge frame inside': rows.filter((r) => r.cast > 0).length,
    'A hurt: species with a hurt frame inside': rows.filter((r) => r.hurt > 0).length,
    'A any: species with any gameplay frame inside': rows.filter((r) => r.body + r.cast + r.hurt > 0).length,
    'A frames inside / all': `${rows.reduce((n, r) => n + r.body + r.cast + r.hurt, 0)} / ${rows.reduce((n, r) => n + r.frames, 0)}`,
    'A worst depth (deg): body / cast / hurt': `${Math.max(...rows.map((r) => r.bodyDeep))} / ${Math.max(...rows.map((r) => r.castDeep))} / ${Math.max(...rows.map((r) => r.hurtDeep))}`,
    'B pinned corner, right of crosshair (deg) min..median..max': rng((r) => r.cornerX),
    'B pinned corner, above crosshair (deg) min..median..max': rng((r) => r.cornerY),
    'B feet on screen (0..1) min..median..max': rng((r) => r.feetY),
    'B share of screen height, top to anchor, min..median..max': rng((r) => r.share),
    'B drawn body, share of screen height (top to lowest drawn point) min..median..max': rng((r) => r.drawn),
    'B species with the drawn body outside 0.30..0.40': rows.filter((r) => r.drawn < 0.3 || r.drawn > 0.4).map((r) => `${r.id} ${r.drawn}`).join(', ') || 0,
    'B share to the anchor outside 0.30..0.40 (the anchor is the middle of the footprint, not the lowest point)': rows.filter((r) => r.share < 0.3 || r.share > 0.4).length,
    'B species with feet below 0.95': rows.filter((r) => r.feetY > 0.95).map((r) => `${r.id} ${r.feetY}`).join(', ') || 0,
    'B species with a lowest drawn point below 0.95': rows.filter((r) => r.bottomY > 0.95).map((r) => `${r.id} ${r.bottomY}`).join(', ') || 0,
    'lowest drawn point of an idle / walk frame (0..1) min..median..max': rng((r) => r.bottomY),
    'HUD move bar over idle / walk frames, by window': Object.fromEntries(WINDOWS.map(([w, h]) => {
      const v = list.map((id) => hudOverlap(id, w, h)), n = v.filter((x) => x.under > 0).length;
      return [`${w} x ${h}`, `${n} of ${v.length} species; a frame reaches ${(100 * Math.max(...v.map((x) => x.under))).toFixed(1)} % of the screen height under it; hides ${(100 * Math.max(...v.map((x) => x.hidden))).toFixed(0)} % of a frame at most, ${(100 * q(v.map((x) => x.hidden), 0.5)).toFixed(0)} % at the median species`];
    })),
    'back distance (m) min..median..max': rng((r) => r.boom), 'shoulder (m) min..median..max': rng((r) => r.shoulder), 'lens height (m) min..median..max': rng((r) => r.lensY),
    'E4 neutral crosshair ground point (m) by class': Object.fromEntries(['Tiny', 'Small', 'Medium', 'Large', 'Extra Large'].map((c) => { const v = rows.filter((r) => r.cls === c).map((r) => r.ground); return [c, v.length ? `${Math.min(...v)} .. ${Math.max(...v)}` : '-']; })),
  };
  console.log(summary);
  const sweep = pitches.map((p) => { let inside = 0, unfaded = 0, deep = 0, frames = 0, sp = 0; for (const id of list) { const r = atPitch(id, p); inside += r.inside; unfaded += r.unfaded; deep = Math.max(deep, r.deep); frames += r.frames; if (r.inside) sp++; } return { pitch: p, 'species inside': sp, 'frames inside': inside, 'of': frames, 'not faded >= 50 %': unfaded, 'worst depth': +deep.toFixed(1) }; });
  console.table(sweep);
  const screen: Record<string, string> = {};
  for (const fov of FOVS) for (const [name, asp] of ASPECTS) { let feet = 0, left = 0; for (const id of list) { const r = onScreen(id, fov, asp); if (!r.feet) feet++; if (!r.left) left++; } screen[`fov ${fov} ${name}`] = `feet below 0.95: ${feet}; left edge off screen: ${left}`; }
  console.log('B on screen (species failing):', screen);
  const out = arg('json', '');
  if (out) fs.writeFileSync(out, JSON.stringify({ summary, sweep, screen, rows }, null, 1));
}
