// Capture-only giants for the camera checks (F3, docs/size-extremes-plan.md): Wailord and Eternatus are not game species
// yet (S2 imports them), but criterion B must hold for them as partners. tests/fixtures/giants-frame.json holds only the
// numbers the framing reads, measured from the capture-only pack (.capture/giants/, never committed): the body (height,
// drawn size, class) under the default size rules, and the sprite's measured outline, per-frame silhouette bounds and
// clip overlays for the gameplay clips. No art, no atlas. Regenerate it with
//   npx tsx scripts/sizegiants.ts --pack .capture/giants/giants.bonkpack.json --fixture tests/fixtures/giants-frame.json
// When S2 imports the real species, the camera test switches to them and fails until this fixture is deleted, so the
// same giant is never defined in two places (tests/camframe.test.ts).
import fs from 'node:fs';
import { bodyOf } from '../../src/rules/sizing';
import { SPECIES_BY_ID } from '../../src/rules/species';

export interface FrameGiant {
  body: { height: number; visualM: number; className: string; sizeClass: string };
  /** a scripts/lib/silhouette.ts SpriteOutline, cut to what the framing reads */
  sprite: { id: string; scale: number; outline: unknown; clips: Record<string, { overlay: string }>; silhouette: { frames: Record<string, unknown> } };
}

export const FIXTURE_URL = new URL('../../tests/fixtures/giants-frame.json', import.meta.url);

const load = (): Record<string, FrameGiant> => {
  try { return (JSON.parse(fs.readFileSync(FIXTURE_URL, 'utf8')) as { species: Record<string, FrameGiant> }).species; } catch { return {}; }
};

/** the fixture's giants, by id (empty when the fixture is gone) */
export const FRAME_GIANTS: Record<string, FrameGiant> = load();

/** the fixture giants that are not (yet) game species: the ones the camera checks add to the roster */
export const fixtureOnly = (): string[] => Object.keys(FRAME_GIANTS).filter((id) => !SPECIES_BY_ID[id]);

/** a framed subject's body: the game species' own (bodyOf, default rules), or a fixture giant's measured one */
export function frameBodyOf(id: string): { height: number; visualM: number; className: string; sizeClass: string } {
  const sp = SPECIES_BY_ID[id];
  if (sp) { const b = bodyOf(sp); return { height: b.height, visualM: b.visualM, className: b.className, sizeClass: b.sizeClass }; }
  const g = FRAME_GIANTS[id];
  if (!g) throw new Error(`${id}: neither a game species nor a fixture giant`);
  return g.body;
}
