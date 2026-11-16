// The size the renderer tells the third-person rig a Pokémon is (render/renderer.ts, `rig.update(chaseFrameFor(...))`),
// worked out in Node for the headless camera diagnostics (scripts/camstats.ts, tests/camstability.test.ts,
// tests/viewsample.test.ts). The renderer measures the decoded atlas in the browser (assets/pack.ts) and scales the
// idle frame by the species' visible-size multiplier (rules/sizing.ts `speciesSizing`); this decodes the same atlas from
// art.json with the dependency-free PNG codec and runs the same measurement and the same rule, so the rig sees the same
// framing size in both places. Nothing here ships in the game.
import ART from '../../src/content/art.json';
import { TEXELS_PER_METRE, type FrameRect } from '../../src/assets/art';
import { resolveClips, type SourceAnim } from '../../src/assets/clips';
import { neutralExtent } from '../../src/assets/measure';
import { chaseSubjectSize } from '../../src/render/chaseinput';
import { speciesSizing } from '../../src/rules/sizing';
import { SPECIES_BY_ID } from '../../src/rules/species';
import { decodePng } from './png.mjs';

type PackArt = { atlas: string; anims: Record<string, { frames: number[][][]; durations: number[]; hit?: number }> };
const art = (ART as unknown as { species: Record<string, { art: PackArt }> }).species;
const cache = new Map<string, { height: number; width: number; scale: number }>();

/** the rig's subject size for a species, exactly as the renderer submits it (falls back to the renderer's 1.1 m) */
export function rigSize(id: string): { height: number; width: number | undefined; scale: number } {
  const hit = cache.get(id);
  if (hit) return hit;
  const a = art[id]?.art;
  if (!a) return { height: 1.1, width: undefined, scale: 1 };
  const src: Record<string, SourceAnim> = {};
  for (const [name, an] of Object.entries(a.anims)) {
    src[name] = { frames: an.frames.map((row) => row.map(([x, y, w, h, ax, ay]): FrameRect => ({ x, y, w, h, ax, ay }))), durations: an.durations.map((d) => d / 60), hit: an.hit };
  }
  const { clips } = resolveClips(src);
  const f = clips.idle.frames[0][0];
  const png = decodePng(Buffer.from(a.atlas.slice(a.atlas.indexOf(',') + 1), 'base64'));
  // the same pixels assets/pack.ts reads with getImageData(f.x, f.y, f.w, f.h)
  const rgba = new Uint8Array(f.w * f.h * 4);
  for (let y = 0; y < f.h; y++) rgba.set(png.data.subarray(((f.y + y) * png.width + f.x) * 4, ((f.y + y) * png.width + f.x + f.w) * 4), y * f.w * 4);
  const { heightPx, widthPx } = neutralExtent(rgba, f);
  const sp = SPECIES_BY_ID[id];
  const scale = sp ? speciesSizing(sp, heightPx / TEXELS_PER_METRE, widthPx / TEXELS_PER_METRE).scale : 1;
  const out = { ...chaseSubjectSize(f, scale), scale };
  cache.set(id, out as { height: number; width: number; scale: number });
  return out;
}

/** what the diagnostics used before (the raw idle frame, unscaled): kept to report the difference */
export function rawFrameSize(id: string): { height: number; width: number } {
  const f = art[id]?.art.anims.Idle?.frames[0]?.[0];
  return f ? { height: f[3] / TEXELS_PER_METRE, width: f[2] / TEXELS_PER_METRE } : { height: 1.1, width: 1 };
}
