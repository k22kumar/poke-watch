// Loads the three.js side file and starts the 3D scene (docs/RENDER3D.md "How it loads"): only with ?render=three,
// the flag that stays off until X1a. The side file is a classic script (it also runs from file://, where module
// scripts do not), content-hashed by scripts/build.mjs like dist/physics/ and dist/nav/; it puts its factory on the
// window and the page calls it with a ThreeHost. Nothing here imports three.
import type { SimContext } from '../sim/types';
import { fromArenaMap } from '../world/adapter';
import type { ArenaMap } from '../world/tiles';
import { THREE_GLOBAL, type CreateThreeView, type ThreeHost, type ThreeSheet, type ThreeView, type ThreeWorld } from './threehost';
import { tileLamps } from './world3d/tilelamps';

/** the side file's URL, relative to the page (scripts/build.mjs, scripts/dev.mjs) */
declare const __THREE_URL__: string;

function loadScript(url: string): Promise<void> {
  return new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = url; s.async = true;
    s.onload = () => res();
    s.onerror = () => rej(new Error(`the three.js side file did not load: ${url}`));
    document.head.appendChild(s);
  });
}

/** the 3D view over the page's canvas; `sheet` reads the page renderer's sizing of each creature sheet */
export async function bootThree(under: HTMLCanvasElement, params: URLSearchParams, sheet: (id: string) => ThreeSheet | undefined): Promise<{ view: ThreeView; ms: number; url: string }> {
  const t0 = performance.now();
  await loadScript(__THREE_URL__);
  const g = (window as unknown as Record<string, { create: CreateThreeView } | undefined>)[THREE_GLOBAL];
  if (!g) throw new Error('the three.js side file loaded but did not register');
  const canvas = document.createElement('canvas');
  canvas.id = 'scene3d';
  // above the page's canvas (which keeps the input), under the 2D overlay and the UI
  canvas.style.cssText = 'position:absolute;left:0;top:0;display:block;pointer-events:none';
  under.insertAdjacentElement('afterend', canvas);
  const cache = new WeakMap<ArenaMap, ThreeWorld>();
  const host: ThreeHost = {
    canvas, params, sheet,
    world(ctx: SimContext) {
      const m = ctx.world.map;
      let w = cache.get(m);
      if (!w) {
        const artKey = m.gen?.loc?.art ?? ctx.world.biome.id;
        w = { model: fromArenaMap(m), artKey, lamps: tileLamps(m, artKey, (x, z) => ctx.world.height(x, z)) };
        cache.set(m, w);
      }
      return w;
    },
  };
  const view = await g.create(host);
  return { view, ms: performance.now() - t0, url: __THREE_URL__ };
}
