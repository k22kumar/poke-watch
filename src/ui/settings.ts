// Saved settings: the defaults and how a browser's saved copy is brought up to date. Pure (no DOM), so tests/settings.test.ts
// can pin the camera default down. main.ts reads and writes localStorage around it.
import { CAMERA_DEFAULT, CAMERA_PRESETS } from '../render/camera';
import { DEFAULT_KEYS, DEFAULT_PAD, restoreUnbound, sanitizeKeyOverrides, sanitizePadOverrides, type KeyBindings, type PadBindings } from '../input/bindings';

export const SETTINGS_DEFAULT = { volume: 0.8, music: 0.55, master: 0.8, cries: 0.85, muted: false, quality: 1, numbers: true, camera: CAMERA_DEFAULT, shake: 1, combat: 'aimed' as 'aimed' | 'assist' | 'auto', sens: 1, invertY: false, fov: 0, camV: 2, world: 'locations' as 'authored' | 'locations', worldV: 2,
  /** Settings → World → Map: '' = the default region rotation, else a Pokémon location or habitat recipe (`id`, or
   *  `id:variant`) for every region; mapSeed ≥ 0 holds that map seed for every region (replay a known layout) */
  map: '' as string, mapSeed: -1,
  /** Settings → Controls → Bindings (R6c, input/bindings.ts): only the actions the player changed, as keyboard codes and
   *  gamepad button indices. Defaults stay out of the save, so a default added later reaches an old save */
  keys: {} as KeyBindings, pad: {} as PadBindings };
type Settings = typeof SETTINGS_DEFAULT;

/** The settings to use given what the browser saved (anything, or nothing). A new player gets the defaults, so the
 *  third-person camera. A copy saved before the third-person camera existed (no `camV`, or the old `bonklab` key)
 *  keeps its other choices but moves to it once. After that a camera the player picked (Classic, Overhead, Wide) is
 *  their choice and is kept; Settings → Camera → Third person, or Reset to defaults, brings the default back. A camera
 *  id that no longer exists falls back to the default. */
export function loadSettings(saved: unknown): Settings {
  const s: Settings = { ...SETTINGS_DEFAULT };
  const o = saved && typeof saved === 'object' ? (saved as Record<string, unknown>) : {};
  Object.assign(s, o);
  if (o.worldV !== 2) s.world = 'locations';
  s.worldV = 2;
  if (o.camV !== 2) { s.camera = CAMERA_DEFAULT; s.camV = 2; }
  if (!CAMERA_PRESETS.some((p) => p.id === s.camera)) s.camera = CAMERA_DEFAULT;
  // Map and Map seed (habitat recipes, docs/HABITATS.md): the picker writes '' or `id` / `id:variant` and a whole number
  // ≥ 0 (-1 = from the run seed); a saved copy that holds anything else gets the default rotation and the run seed
  s.map = typeof o.map === 'string' ? o.map : '';
  s.mapSeed = typeof o.mapSeed === 'number' && Number.isInteger(o.mapSeed) && o.mapSeed >= 0 ? o.mapSeed : -1;
  // bindings: whatever was saved is cut down to known actions and valid codes (a fresh object, never the default's), and
  // an action left with no code gets its free defaults back (restoreUnbound)
  s.keys = restoreUnbound(DEFAULT_KEYS, sanitizeKeyOverrides(o.keys));
  s.pad = restoreUnbound(DEFAULT_PAD, sanitizePadOverrides(o.pad));
  return s;
}
