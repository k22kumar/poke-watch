// A species' sprite outline in Node, for the headless camera diagnostics and tests (scripts/camframe.ts,
// scripts/camstats.ts, tests/camframe.test.ts). The browser measures the decoded atlas at load (assets/pack.ts buildArt);
// this decodes the same atlas from art.json with the dependency-free PNG codec and runs the same measurement
// (assets/measure.ts silhouetteOf) and the same visible-size rule (rules/sizing.ts speciesSizing), so the rig is framed
// from the same numbers in both places. Nothing here ships in the game.
import fs from 'node:fs';
import { TEXELS_PER_METRE, type AnimState, type Clip, type FrameRect, type Silhouette } from '../../src/assets/art';
import { resolveClips, type SourceAnim } from '../../src/assets/clips';
import { neutralExtent, overlayReach, silhouetteOf } from '../../src/assets/measure';
import { cardOf, outlineOf, type CardBounds, type Outline } from '../../src/render/framing';
import { bodyOf, speciesSizing } from '../../src/rules/sizing';
import { SPECIES_BY_ID } from '../../src/rules/species';
import { decodePng } from './png.mjs';

type PackArt = { atlas: string; anims: Record<string, { frames: number[][][]; durations: number[]; hit?: number }> };
let bundle: Record<string, { art: PackArt }> | null = null;
const art = () => (bundle ??= (JSON.parse(fs.readFileSync(new URL('../../src/content/art.json', import.meta.url), 'utf8')) as { species: Record<string, { art: PackArt }> }).species);

export interface SpriteOutline {
  id: string;
  clips: Record<AnimState, Clip>;
  silhouette: Silhouette;
  /** the multiplier the renderer draws the sprite with (SpeciesSizing.scale × the authored encounter scale) */
  scale: number;
  /** what the rig is told (render/chaseinput.ts ChaseSubject.outline) */
  outline: Outline;
}
const cache = new Map<string, SpriteOutline | null>();

/** the species that have art and a size class (no authored encounter scale): the roster the framing is checked on */
export function framedSpecies(): string[] {
  return Object.keys(art()).filter((id) => SPECIES_BY_ID[id] && !bodyOf(SPECIES_BY_ID[id]).authored);
}

/** the measured outline of a species' sprite set, or null when it has no art */
export function spriteOutline(id: string): SpriteOutline | null {
  const hit = cache.get(id);
  if (hit !== undefined) return hit;
  const a = art()[id]?.art, sp = SPECIES_BY_ID[id];
  if (!a || !sp) { cache.set(id, null); return null; }
  const src: Record<string, SourceAnim> = {};
  for (const [name, an] of Object.entries(a.anims)) {
    src[name] = { frames: an.frames.map((row) => row.map(([x, y, w, h, ax, ay]): FrameRect => ({ x, y, w, h, ax, ay }))), durations: an.durations.map((d) => d / 60), hit: an.hit };
  }
  const { clips } = resolveClips(src);
  const png = decodePng(Buffer.from(a.atlas.slice(a.atlas.indexOf(',') + 1), 'base64')), pw = png.width, pd = png.data;
  const silhouette = silhouetteOf(clips, (x, y) => pd[(y * pw + x) * 4 + 3]);
  // the same pixels assets/pack.ts reads with getImageData(f.x, f.y, f.w, f.h)
  const f = clips.idle.frames[0][0], rgba = new Uint8Array(f.w * f.h * 4);
  for (let y = 0; y < f.h; y++) rgba.set(pd.subarray(((f.y + y) * pw + f.x) * 4, ((f.y + y) * pw + f.x + f.w) * 4), y * f.w * 4);
  const { heightPx, widthPx } = neutralExtent(rgba, f);
  const scale = speciesSizing(sp, heightPx / TEXELS_PER_METRE, widthPx / TEXELS_PER_METRE).scale * (sp.scale ?? 1);
  const out: SpriteOutline = { id, clips, silhouette, scale, outline: outlineOf(silhouette, scale) };
  cache.set(id, out);
  return out;
}

/** the gameplay clips the player's own sprite shows (the framing reserves room for all of them) */
export const PLAY_CLIPS: AnimState[] = ['idle', 'walk', 'attack', 'shoot', 'charge', 'hurt'];

/** every distinct drawn frame of the gameplay clips as a card (metres, the procedural offset at its furthest right and up) */
export function playFrames(o: SpriteOutline): { clip: AnimState; row: number; frame: number; card: CardBounds }[] {
  const out: { clip: AnimState; row: number; frame: number; card: CardBounds }[] = [];
  for (const clip of PLAY_CLIPS) {
    const ov = overlayReach(o.clips[clip]), rows = o.silhouette.frames[clip];
    for (let row = 0; row < rows.length; row++) for (let frame = 0; frame < rows[row].length; frame++) {
      const b = rows[row][frame];
      if (b) out.push({ clip, row, frame, card: cardOf(b, o.scale, ov.x, ov.y) });
    }
  }
  return out;
}
