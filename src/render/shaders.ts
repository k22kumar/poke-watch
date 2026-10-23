// GLSL sources. Shared fog: linear between uFog.x and uFog.y in view distance.

const FOG = `
uniform vec3 uFogCol; uniform vec2 uFog;
vec3 fog(vec3 c, float d){ float f = clamp((d - uFog.x) / (uFog.y - uFog.x), 0.0, 1.0); return mix(c, uFogCol, f*f*(3.0-2.0*f)); }`;

const LIGHT = `
uniform vec3 uSunDir; uniform vec3 uSunCol; uniform vec3 uAmb;
vec3 light(vec3 n, vec3 albedo){
  float d = max(dot(n, uSunDir), 0.0);
  float band = d > 0.6 ? 1.0 : d > 0.25 ? 0.82 : d > 0.02 ? 0.64 : 0.5;
  float hemi = 0.5 + 0.5 * n.y;
  return albedo * (uSunCol * band * 0.72 + uAmb * (0.38 + 0.22 * hemi));
}`;

export const TERRAIN_VS = `
layout(location=0) in vec3 aPos; layout(location=6) in vec3 aNor; layout(location=7) in vec3 aCol; layout(location=8) in float aPath;
uniform mat4 uVP; uniform vec3 uCam;
out vec3 vN; out vec3 vC; out vec3 vW; out float vD; out float vP;
void main(){ vN=aNor; vC=aCol; vW=aPos; vP=aPath; vD=distance(aPos,uCam); gl_Position=uVP*vec4(aPos,1.0); }`;

export const TERRAIN_FS = `
in vec3 vN; in vec3 vC; in vec3 vW; in float vD; in float vP;
${FOG}${LIGHT}
uniform sampler2D uDetail; uniform vec3 uPath;
out vec4 o;
float hn(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453); }
float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
  return mix(mix(hn(i), hn(i+vec2(1,0)), f.x), mix(hn(i+vec2(0,1)), hn(i+vec2(1,1)), f.x), f.y); }
void main(){
  vec3 n = normalize(vN);
  // pixel-art ground detail (grass strokes / pebbles) at 24 texels per metre
  vec2 tex = floor(vW.xz * 24.0) + 0.5;
  float d = texture(uDetail, tex / 64.0).r * 2.0;
  // crisp, outlined path edges resolved per texel
  float t = vP * 1.25 + (vn(tex / 5.0) - 0.5) * 0.35;
  vec3 col = vC;
  if (t > 0.5) col = uPath * (t < 0.57 ? 0.8 : 1.0);
  else if (t > 0.45) col = vC * 0.74;
  col *= d;
  // snap the lighting to bands so slopes read as flat pixel-art shading
  o = vec4(fog(light(n, col), vD), 1.0);
}`;

export const PROP_VS = `
layout(location=0) in vec3 aPos; layout(location=6) in vec3 aNor; layout(location=7) in vec3 aCol; layout(location=8) in float aEmi;
layout(location=1) in vec4 iPosS;  // xyz, scale
layout(location=2) in vec4 iRot;   // yaw, tint r,g,b (as multipliers around 1)
uniform mat4 uVP; uniform vec3 uCam; uniform float uTime; uniform float uWind;
out vec3 vN; out vec3 vC; out float vD; out vec3 vW; out float vE;
void main(){
  float c = cos(iRot.x), s = sin(iRot.x);
  vec3 p = aPos * iPosS.w;
  // wind sway for tall things
  p.x += uWind * sin(uTime * 1.7 + iPosS.x * 0.3 + iPosS.z * 0.2) * max(aPos.y - 0.4, 0.0) * 0.06 * iPosS.w;
  vec3 w = vec3(c*p.x + s*p.z, p.y, -s*p.x + c*p.z) + iPosS.xyz;
  vN = vec3(c*aNor.x + s*aNor.z, aNor.y, -s*aNor.x + c*aNor.z);
  vC = aCol * iRot.yzw; vW = w; vD = distance(w, uCam); vE = aEmi;
  gl_Position = uVP * vec4(w, 1.0);
}`;

export const PROP_FS = `
in vec3 vN; in vec3 vC; in float vD; in vec3 vW; in float vE;
${FOG}${LIGHT}
uniform vec3 uPlayer; uniform vec3 uCamPos; uniform float uFade;
out vec4 o;
void main(){
  // screen-door fade of props between the camera and the player (PokéBonk does this too)
  if (uFade > 0.0) {
    vec3 ab = uPlayer + vec3(0.0,0.8,0.0) - uCamPos; vec3 ap = vW - uCamPos;
    float t = clamp(dot(ap, ab) / dot(ab, ab), 0.0, 1.0);
    float d = distance(vW, uCamPos + ab * t);
    if (t < 0.92 && d < 2.2) {
      vec2 g = mod(floor(gl_FragCoord.xy), 2.0);
      if (g.x == g.y) discard;
    }
  }
  vec3 c = mix(light(normalize(vN), vC), vC * 1.2, vE);
  o = vec4(fog(c, vD), 1.0);
}`;

export const SKY_VS = `
layout(location=0) in vec2 aPos;
out vec2 vUV;
void main(){ vUV = aPos * 0.5 + 0.5; gl_Position = vec4(aPos, 0.9999, 1.0); }`;

export const SKY_FS = `
in vec2 vUV;
uniform vec3 uTop; uniform vec3 uBot; uniform float uPitch; uniform float uYaw; uniform vec3 uSun;
out vec4 o;
void main(){
  float y = clamp(vUV.y + uPitch * 0.9 - 0.25, 0.0, 1.0);
  // SNES-style banded gradient with ordered dither
  float bands = 14.0;
  float d = mod(floor(gl_FragCoord.x * 0.5) + floor(gl_FragCoord.y * 0.5), 2.0) * 0.5;
  float t = floor(y * bands + d) / bands;
  vec3 c = mix(uBot, uTop, smoothstep(0.0, 1.0, t));
  // soft sun glow
  float sx = fract(uYaw / 6.2831 + 0.15) - 0.5;
  float sd = length(vec2((vUV.x - 0.5 - sx * 3.0) * 1.6, y - 0.7));
  c += uSun * smoothstep(0.35, 0.0, sd) * 0.35;
  o = vec4(c, 1.0);
}`;

export const SPRITE_VS = `
layout(location=0) in vec2 aCorner;
layout(location=1) in vec4 iPosS;   // feet xyz, world cell size
layout(location=2) in vec4 iCell;   // frame, dir, flash, dissolve
layout(location=3) in vec4 iTint;   // rgb, footV
uniform mat4 uVP; uniform vec3 uRight; uniform vec3 uUp; uniform vec3 uCam; uniform vec2 uGrid;
out vec2 vUV; out vec4 vFx; out vec3 vTint; out float vD;
void main(){
  float S = iPosS.w;
  vec3 base = iPosS.xyz - uUp * (iTint.w * S);
  vec3 w = base + uRight * (aCorner.x * S) + uUp * (aCorner.y * S);
  // pull toward the camera a little so the feet don't clip into slopes
  vec3 toCam = normalize(uCam - iPosS.xyz);
  w += toCam * min(0.6, S * 0.25);
  vUV = (vec2(iCell.x, iCell.y) + vec2(aCorner.x + 0.5, aCorner.y)) / uGrid;
  vFx = iCell; vTint = iTint.rgb; vD = distance(w, uCam);
  gl_Position = uVP * vec4(w, 1.0);
}`;

export const SPRITE_FS = `
in vec2 vUV; in vec4 vFx; in vec3 vTint; in float vD;
uniform sampler2D uTex; uniform vec2 uTexel;
${FOG}
out vec4 o;
float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453); }
void main(){
  vec4 c = texture(uTex, vUV);
  if (c.a < 0.5) discard;
  // death dissolve: hash-noise discard per sprite pixel
  if (vFx.w > 0.0) {
    vec2 px = floor(vUV / uTexel);
    if (h(px) < vFx.w) discard;
  }
  vec3 col = c.rgb * vTint;
  col = mix(col, vec3(1.0), clamp(vFx.z, 0.0, 1.0));
  o = vec4(fog(col, vD * 0.85), 1.0);
}`;

export const GLOW_VS = `
layout(location=0) in vec2 aCorner;
layout(location=1) in vec4 iPosS; // xyz, size
layout(location=2) in vec4 iCol;  // rgba
uniform mat4 uVP; uniform vec3 uRight; uniform vec3 uUp;
out vec2 vC; out vec4 vCol;
void main(){
  vec3 w = iPosS.xyz + (uRight * aCorner.x + uUp * aCorner.y) * iPosS.w;
  vC = aCorner; vCol = iCol;
  gl_Position = uVP * vec4(w, 1.0);
}`;

export const GLOW_FS = `
in vec2 vC; in vec4 vCol;
out vec4 o;
void main(){
  float r = length(vC);
  if (r > 1.0) discard;
  float core = smoothstep(0.45, 0.0, r);
  float halo = pow(1.0 - r, 2.0);
  vec3 c = vCol.rgb * halo + vec3(1.0) * core * 0.85;
  o = vec4(c * vCol.a, (halo * 0.8 + core) * vCol.a);
}`;

export const DECAL_VS = `
layout(location=0) in vec2 aCorner;
layout(location=1) in vec4 iPosR;  // x, y, z, radius
layout(location=2) in vec4 iCol;   // rgba
layout(location=3) in vec4 iShape; // kind, thickness, progress, rotation
uniform mat4 uVP; uniform vec3 uCam;
out vec2 vC; out vec4 vCol; out vec4 vShape; out float vD;
void main(){
  float c = cos(iShape.w), s = sin(iShape.w);
  vec2 q = vec2(c*aCorner.x - s*aCorner.y, s*aCorner.x + c*aCorner.y) * iPosR.w;
  vec3 w = vec3(iPosR.x + q.x, iPosR.y, iPosR.z + q.y);
  vC = aCorner; vCol = iCol; vShape = iShape; vD = distance(w, uCam);
  gl_Position = uVP * vec4(w, 1.0);
}`;

export const DECAL_FS = `
in vec2 vC; in vec4 vCol; in vec4 vShape; in float vD;
out vec4 o;
void main(){
  float k = vShape.x;
  if (k > 4.5) { // tile overlay (surface states): joins its same-state neighbours, rounds off where they end
    int m = int(vShape.y + 0.5); // neighbour bits: 1 east, 2 west, 4 south, 8 north
    float ex = vC.x > 0.0 ? ((m & 1) != 0 ? 0.0 : max(0.0, vC.x - 0.25)) : ((m & 2) != 0 ? 0.0 : max(0.0, -vC.x - 0.25));
    float ez = vC.y > 0.0 ? ((m & 4) != 0 ? 0.0 : max(0.0, vC.y - 0.25)) : ((m & 8) != 0 ? 0.0 : max(0.0, -vC.y - 0.25));
    float d = length(vec2(ex, ez));
    if (d > 0.72) discard;
    vec2 g = mod(floor(gl_FragCoord.xy), 2.0);
    if (d > 0.5 && g.x != g.y) discard; // a stippled rim instead of a hard square edge
    o = vec4(vCol.rgb, vCol.a);
    return;
  }
  float r = length(vC);
  if (r > 1.0) discard;
  float a = 0.0;
  if (k < 0.5) { // DS-style blob shadow: flat, hard-edged, two tones
    a = r < 0.6 ? 0.42 : 0.28;
  } else if (k < 1.5) { // ring
    float t = vShape.y;
    a = smoothstep(t, 0.0, abs(r - (1.0 - t))) ;
  } else if (k < 2.5) { // telegraph: faint fill + rim + growing inner fill
    float rim = smoothstep(0.08, 0.0, abs(r - 0.96));
    float fill = r < vShape.z ? 0.35 : 0.12;
    a = max(rim, fill);
  } else if (k < 3.5) { // swirl (vortex / portal)
    float ang = atan(vC.y, vC.x);
    float sw = 0.5 + 0.5 * sin(ang * 3.0 + r * 9.0 - vShape.z * 6.0);
    a = sw * smoothstep(1.0, 0.6, r) * 0.7 + smoothstep(0.1, 0.0, abs(r - 0.95)) * 0.8;
  } else { // filled disc with soft edge
    a = smoothstep(1.0, 0.85, r) * 0.6;
  }
  o = vec4(vCol.rgb, a * vCol.a);
}`;

export const RIBBON_VS = `
layout(location=0) in vec2 aCorner; // x: 0..1 along, y: -1..1 across
layout(location=1) in vec4 iA; // start xyz, width
layout(location=2) in vec4 iB; // end xyz, alpha
layout(location=3) in vec4 iCol;
uniform mat4 uVP; uniform vec3 uCam;
out vec2 vC; out vec4 vCol;
void main(){
  vec3 p = mix(iA.xyz, iB.xyz, aCorner.x);
  vec3 dir = normalize(iB.xyz - iA.xyz + vec3(1e-4));
  vec3 side = normalize(cross(dir, normalize(uCam - p)));
  vec3 w = p + side * aCorner.y * iA.w;
  vC = aCorner; vCol = vec4(iCol.rgb, iCol.a * iB.w);
  gl_Position = uVP * vec4(w, 1.0);
}`;

export const RIBBON_FS = `
in vec2 vC; in vec4 vCol;
out vec4 o;
void main(){
  float e = 1.0 - abs(vC.y);
  float core = smoothstep(0.55, 1.0, e);
  vec3 c = vCol.rgb * e + core * 0.9;
  o = vec4(c * vCol.a, e * vCol.a);
}`;

export const WATER_FS = `
in vec3 vN; in vec3 vC; in vec3 vW; in float vD;
${FOG}
uniform float uTime; uniform float uGlow;
out vec4 o;
void main(){
  float w = sin(vW.x * 0.9 + uTime * 1.3) * sin(vW.z * 0.8 - uTime * 1.1);
  float band = step(0.55, w) * 0.18;
  vec3 c = vC * (0.9 + band) + band * 0.4;
  if (uGlow > 0.5) c = vC * (1.0 + 0.25 * sin(uTime * 2.0 + vW.x * 0.3)) + band;
  o = vec4(fog(c, vD), uGlow > 0.5 ? 1.0 : 0.82);
}`;
