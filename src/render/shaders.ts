// GLSL sources. Shared fog: linear between uFog.x and uFog.y in view distance.

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

