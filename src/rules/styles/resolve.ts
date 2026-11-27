// The style resolver (docs/WORLDGEN3D.md Q18.1): profile defaults ← biome binding ← map `look` ← theme overlay, then
// clamped by the profile's constraints, with every clamp in a log. Pure: the same inputs give the same ResolvedStyle.
// The `look` and overlay layers have no producer yet (a recipe's look section is G1a's, overlays are Q14g's); their
// shape here is what they may override, so they plug in without a change to the renderer.
import { MATERIAL_ROLES, type MaterialRole } from '../materialroles';
import { bindingFor, hexRgb, type BiomeBinding, type LiquidLook } from './bindings';
import { POST_PASS_IDS, type PostPassId } from './passes';
import { STYLE_PROFILES, type BloomParams, type InkParams, type PaintBlock, type ProfileId, type RoleShading, type StyleProfile } from './profiles';
import { mapTime, type LightKey, type MapTime } from './timeofday';

/** a role's resolved material: the profile's shading plus the binding's colour */
export interface RoleMaterial extends RoleShading {
  role: MaterialRole;
  /** 0..1 sRGB */
  base: [number, number, number];
}

/** visual overrides a map's `look` section (Q14.3) or an event overlay (Q14g) may carry; never physical data */
export interface LookLayer {
  roles?: Partial<Record<MaterialRole, { base?: string } & Partial<RoleShading>>>;
  paint?: Partial<PaintBlock>;
  ink?: Partial<InkParams>;
  bloom?: Partial<BloomParams>;
  /** a fixed hour other than the binding's (D12: one per map) */
  hour?: number;
  /** the key light's share of an open top's light at the fixed hour (timeofday.ts KEY_SHARE) */
  keyShare?: number;
  /** the ambient fill's share of an open top's light at the fixed hour; absent: 1 − the key share (timeofday.ts keysFor).
   *  With it the key light and the ambient are set apart, so an open top may take more than 1 */
  ambientShare?: number;
  /** grading on every keyframe */
  grade?: Partial<LightKey['grade']>;
}

export interface ResolvedStyle {
  profile: ProfileId;
  binding: string;
  roles: Record<MaterialRole, RoleMaterial>;
  liquids: Record<string, LiquidLook>;
  liquid: StyleProfile['liquid'];
  paint: PaintBlock;
  creaseAngle: number;
  /** the built pass list: the profile's, minus passes at zero weight (Q23) */
  passes: PostPassId[];
  ink: InkParams;
  bloom: BloomParams;
  time: MapTime;
  vignette: BiomeBinding['vignette'];
  actor: [number, number, number];
  /** every clamp the profile applied, as 'field: from → to' */
  log: string[];
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** a pass's weight: a pass at zero weight is not built. The ink pass also draws the paint block's edge light, so it is
 *  built when either is above zero */
export const passWeight = (id: PostPassId, s: { ink: InkParams; bloom: BloomParams; paint: PaintBlock }) => (id === 'ink' ? Math.max(s.ink.weight, s.paint.edgeLight) : s.bloom.strength);

export function resolve(profileId: ProfileId, artKey: string, opts: { look?: LookLayer; overlay?: LookLayer; stagings?: [number, number][] } = {}): ResolvedStyle {
  const P = STYLE_PROFILES[profileId], B = bindingFor(artKey), layers = [opts.look, opts.overlay].filter((l): l is LookLayer => !!l);
  const log: string[] = [];
  const C = P.constraints;
  const guard = (field: string, v: number, lo: number, hi: number) => { const c = clamp(v, lo, hi); if (c !== v) log.push(`${field}: ${v} → ${c}`); return c; };

  const roles = {} as Record<MaterialRole, RoleMaterial>;
  for (const role of MATERIAL_ROLES) {
    let m: RoleMaterial = { ...P.roles[role], role, base: hexRgb(B.roles[role]) };
    for (const L of layers) { const o = L.roles?.[role]; if (o) m = { ...m, ...o, base: o.base ? hexRgb(o.base) : m.base, role }; }
    m.ramp = { bands: guard(`roles.${role}.ramp.bands`, Math.round(m.ramp.bands), 0, C.maxBands), soft: guard(`roles.${role}.ramp.soft`, m.ramp.soft, 0, 1) };
    m.ink = guard(`roles.${role}.ink`, m.ink, 0, C.maxInk);
    roles[role] = m;
  }
  let paint = { ...P.paint, ...P.paintByLight[B.light] }, ink = { ...P.ink }, bloom = { ...P.bloom };
  for (const L of layers) { paint = { ...paint, ...L.paint }; ink = { ...ink, ...L.ink }; bloom = { ...bloom, ...L.bloom }; }
  ink.weight = guard('ink.weight', ink.weight, 0, C.maxInk);
  bloom.resolution = guard('bloom.resolution', bloom.resolution, 0.125, 1);

  // the keyframes are anchored (calibrated) at the layers' fixed hour and key share
  const hour = layers.reduce<number | undefined>((h, L) => L.hour ?? h, undefined), share = layers.reduce<number | undefined>((k, L) => L.keyShare ?? k, undefined);
  const ambient = layers.reduce<number | undefined>((a, L) => L.ambientShare ?? a, undefined);
  const time = mapTime(B, opts.stagings, { hour, share, ambient });
  const g = layers.reduce<Partial<LightKey['grade']>>((a, L) => ({ ...a, ...L.grade }), {});
  time.keys = time.keys.map((k) => {
    const gr = { ...k.grade, ...g };
    return {
      ...k,
      grade: {
        lift: gr.lift.map((v, i) => guard(`grade.lift[${i}]@${k.hour}`, v, -C.lift, C.lift)) as [number, number, number],
        gamma: gr.gamma.map((v, i) => guard(`grade.gamma[${i}]@${k.hour}`, v, C.gamma[0], C.gamma[1])) as [number, number, number],
        gain: gr.gain.map((v, i) => guard(`grade.gain[${i}]@${k.hour}`, v, C.gain[0], C.gain[1])) as [number, number, number],
        saturation: guard(`grade.saturation@${k.hour}`, gr.saturation, C.saturation[0], C.saturation[1]),
      },
    };
  });
  const passes = P.passes.filter((id) => POST_PASS_IDS.includes(id) && passWeight(id, { ink, bloom, paint }) > 0);
  return { profile: profileId, binding: B.id, roles, liquids: B.liquids, liquid: P.liquid, paint, creaseAngle: P.shape.creaseAngle, passes, ink, bloom, time, vignette: B.vignette, actor: B.actor, log };
}
