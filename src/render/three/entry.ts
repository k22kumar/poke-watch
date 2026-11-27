// The three.js side file's entry (scripts/build.mjs builds it alone into dist/three/scene.<hash>.js; S2 decision 5):
// it registers the scene factory on the window, where src/render/threeload.ts finds it. Loaded only with ?render=three.
import { THREE_GLOBAL } from '../threehost';
import { createThreeView } from './view';

(window as unknown as Record<string, unknown>)[THREE_GLOBAL] = { create: createThreeView };
