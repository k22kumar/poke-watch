// Pixel-art sprite sampling for billboards (props and creatures).
//
// The art is drawn for one texel per screen pixel, which the fixed views guarantee (texel-snapped, 16 px per metre).
// The third-person view is a perspective camera: past ~25 m a sprite texel covers less than a pixel, and plain NEAREST
// sampling then picks a different texel each time the camera moves a fraction of a pixel, so distant trees and
// Pokémon shimmer (measured: ~1300 pixels a frame flipping by more than 48/255 during a slow 1 cm/frame strafe, almost
// all of them in the far tree band). Mip-maps are not an option for the shared atlases (neighbouring sprites would bleed
// into each other). Instead, when a texel is smaller than a pixel the shader takes an n×n box of nearest taps across
// the pixel's footprint, clamped inside the sprite's own frame and averaged with alpha weighting (so transparent texels
// do not darken the edge). At one texel per pixel or larger it is a single nearest tap: close sprites and the fixed
// views stay exactly as crisp as before.
export const SPRITE_SAMPLE_GLSL = `
vec4 spriteTex(sampler2D t, vec2 uv, vec4 rect) {
  vec2 ts = vec2(textureSize(t, 0));
  vec2 dx = dFdx(uv), dy = dFdy(uv);
  float fp = max(length(dx * ts), length(dy * ts)); // texels per screen pixel
  if (fp < 1.3) return textureLod(t, uv, 0.0);
  float n = fp < 2.3 ? 2.0 : 3.0;
  vec2 lo = min(rect.xy, rect.zw) + 0.5 / ts, hi = max(rect.xy, rect.zw) - 0.5 / ts;
  vec4 acc = vec4(0.0);
  for (int j = 0; j < 3; j++) for (int i = 0; i < 3; i++) {
    if (float(i) >= n || float(j) >= n) continue;
    vec2 k = (vec2(float(i), float(j)) + 0.5) / n - 0.5;
    vec4 c = textureLod(t, clamp(uv + dx * k.x + dy * k.y, lo, hi), 0.0);
    acc += vec4(c.rgb * c.a, c.a);
  }
  acc /= n * n;
  return acc.a > 0.0 ? vec4(acc.rgb / acc.a, acc.a) : vec4(0.0);
}`;
