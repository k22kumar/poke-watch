// Minimal WebGL2 helpers + column-major mat4 math (no dependencies).

export type GL = WebGL2RenderingContext;

export function compile(gl: GL, vs: string, fs: string): WebGLProgram {
  const mk = (type: number, src: string) => {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, '#version 300 es\nprecision highp float;\n' + src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(s);
      const lines = src.split('\n').map((l, i) => `${i + 3}: ${l}`).join('\n');
      throw new Error('shader compile failed: ' + log + '\n' + lines);
    }
    return s;
  };
  const p = gl.createProgram()!;
  gl.attachShader(p, mk(gl.VERTEX_SHADER, vs));
  gl.attachShader(p, mk(gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('link failed: ' + gl.getProgramInfoLog(p));
  return p;
}

export class Program {
  readonly p: WebGLProgram;
  private u = new Map<string, WebGLUniformLocation | null>();
  constructor(private gl: GL, vs: string, fs: string) {
    this.p = compile(gl, vs, fs);
  }
  use() {
    this.gl.useProgram(this.p);
    return this;
  }
  loc(name: string) {
    if (!this.u.has(name)) this.u.set(name, this.gl.getUniformLocation(this.p, name));
    return this.u.get(name)!;
  }
  m4(n: string, m: Float32Array) { this.gl.uniformMatrix4fv(this.loc(n), false, m); return this; }
  f(n: string, v: number) { this.gl.uniform1f(this.loc(n), v); return this; }
  i(n: string, v: number) { this.gl.uniform1i(this.loc(n), v); return this; }
  v2(n: string, a: number, b: number) { this.gl.uniform2f(this.loc(n), a, b); return this; }
  v3(n: string, v: ArrayLike<number>) { this.gl.uniform3f(this.loc(n), v[0], v[1], v[2]); return this; }
  v4(n: string, v: ArrayLike<number>) { this.gl.uniform4f(this.loc(n), v[0], v[1], v[2], v[3]); return this; }
}

export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

export function mixRgb(a: number[], b: number[], t: number): [number, number, number] {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

// ---------------------------------------------------------------- mat4
export const mat4 = {
  create(): Float32Array {
    const m = new Float32Array(16);
    m[0] = m[5] = m[10] = m[15] = 1;
    return m;
  },
  perspective(out: Float32Array, fovy: number, aspect: number, near: number, far: number) {
    const f = 1 / Math.tan(fovy / 2);
    out.fill(0);
    out[0] = f / aspect; out[5] = f;
    out[10] = (far + near) / (near - far); out[11] = -1;
    out[14] = (2 * far * near) / (near - far);
    return out;
  },
  ortho(out: Float32Array, l: number, r: number, b: number, t: number, n: number, f: number) {
    out.fill(0);
    out[0] = 2 / (r - l); out[5] = 2 / (t - b); out[10] = -2 / (f - n);
    out[12] = -(r + l) / (r - l); out[13] = -(t + b) / (t - b); out[14] = -(f + n) / (f - n); out[15] = 1;
    return out;
  },
  lookAt(out: Float32Array, eye: number[], at: number[], up: number[]) {
    let zx = eye[0] - at[0], zy = eye[1] - at[1], zz = eye[2] - at[2];
    let l = Math.hypot(zx, zy, zz) || 1; zx /= l; zy /= l; zz /= l;
    let xx = up[1] * zz - up[2] * zy, xy = up[2] * zx - up[0] * zz, xz = up[0] * zy - up[1] * zx;
    l = Math.hypot(xx, xy, xz) || 1; xx /= l; xy /= l; xz /= l;
    const yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;
    out[0] = xx; out[1] = yx; out[2] = zx; out[3] = 0;
    out[4] = xy; out[5] = yy; out[6] = zy; out[7] = 0;
    out[8] = xz; out[9] = yz; out[10] = zz; out[11] = 0;
    out[12] = -(xx * eye[0] + xy * eye[1] + xz * eye[2]);
    out[13] = -(yx * eye[0] + yy * eye[1] + yz * eye[2]);
    out[14] = -(zx * eye[0] + zy * eye[1] + zz * eye[2]);
    out[15] = 1;
    return out;
  },
  mul(out: Float32Array, a: Float32Array, b: Float32Array) {
    const r = new Float32Array(16);
    for (let c = 0; c < 4; c++)
      for (let rI = 0; rI < 4; rI++) {
        let s = 0;
        for (let k = 0; k < 4; k++) s += a[k * 4 + rI] * b[c * 4 + k];
        r[c * 4 + rI] = s;
      }
    out.set(r);
    return out;
  },
  /** compose T * Ry * Rx * Rz * S */
  compose(out: Float32Array, tx: number, ty: number, tz: number, rx: number, ry: number, rz: number, sx: number, sy: number, sz: number) {
    const cx = Math.cos(rx), sxr = Math.sin(rx), cy = Math.cos(ry), syr = Math.sin(ry), cz = Math.cos(rz), szr = Math.sin(rz);
    // R = Ry * Rx * Rz
    const m00 = cy * cz + syr * sxr * szr, m01 = -cy * szr + syr * sxr * cz, m02 = syr * cx;
    const m10 = cx * szr, m11 = cx * cz, m12 = -sxr;
    const m20 = -syr * cz + cy * sxr * szr, m21 = syr * szr + cy * sxr * cz, m22 = cy * cx;
    out[0] = m00 * sx; out[1] = m10 * sx; out[2] = m20 * sx; out[3] = 0;
    out[4] = m01 * sy; out[5] = m11 * sy; out[6] = m21 * sy; out[7] = 0;
    out[8] = m02 * sz; out[9] = m12 * sz; out[10] = m22 * sz; out[11] = 0;
    out[12] = tx; out[13] = ty; out[14] = tz; out[15] = 1;
    return out;
  },
  transformPoint(m: Float32Array, x: number, y: number, z: number): [number, number, number] {
    return [m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]];
  },
  transformDir(m: Float32Array, x: number, y: number, z: number): [number, number, number] {
    return [m[0] * x + m[4] * y + m[8] * z, m[1] * x + m[5] * y + m[9] * z, m[2] * x + m[6] * y + m[10] * z];
  },
};

/** Interleaved static mesh: position(3) normal(3) color(3) [+ extra(1)] */
export class Mesh {
  vao: WebGLVertexArrayObject;
  count: number;
  vbo: WebGLBuffer;
  constructor(public gl: GL, data: Float32Array, stride = 9) {
    this.vao = gl.createVertexArray()!;
    gl.bindVertexArray(this.vao);
    this.vbo = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    const B = stride * 4;
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, B, 0);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, B, 12);
    gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 3, gl.FLOAT, false, B, 24);
    if (stride > 9) { gl.enableVertexAttribArray(3); gl.vertexAttribPointer(3, stride - 9, gl.FLOAT, false, B, 36); }
    this.count = data.length / stride;
    gl.bindVertexArray(null);
  }
}

export const quadCorners = new Float32Array([-0.5, 0, 0.5, 0, 0.5, 1, -0.5, 0, 0.5, 1, -0.5, 1]);
