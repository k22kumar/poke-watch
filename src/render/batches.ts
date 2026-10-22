// Immediate-mode instanced batches (begin / push / end), one draw call each — the same
// pattern PokéBonk uses for its sprite, shadow, ring, beam and text batches.

import type { GL } from './gl';

export class InstanceBatch {
  vao: WebGLVertexArrayObject;
  private ibo: WebGLBuffer;
  data: Float32Array;
  count = 0;
  readonly stride: number;
  cap: number;
  vertCount: number;

  /**
   * @param base per-vertex attribute data (location 0, `baseSize` floats per vertex)
   * @param layout sizes of per-instance attributes, assigned to locations 1.. in order
   */
  constructor(private gl: GL, base: Float32Array, baseSize: number, readonly layout: number[], cap = 256) {
    this.stride = layout.reduce((a, b) => a + b, 0);
    this.cap = cap;
    this.data = new Float32Array(cap * this.stride);
    this.vertCount = base.length / baseSize;
    this.vao = gl.createVertexArray()!;
    gl.bindVertexArray(this.vao);
    const vbo = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, base, gl.STATIC_DRAW);
    if (baseSize === 9 || baseSize === 10) {
      // mesh: pos3 nor3 col3 [emi1]
      const B = baseSize * 4;
      gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, B, 0);
      gl.enableVertexAttribArray(6); gl.vertexAttribPointer(6, 3, gl.FLOAT, false, B, 12);
      gl.enableVertexAttribArray(7); gl.vertexAttribPointer(7, 3, gl.FLOAT, false, B, 24);
      if (baseSize === 10) { gl.enableVertexAttribArray(8); gl.vertexAttribPointer(8, 1, gl.FLOAT, false, B, 36); }
    } else {
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, baseSize, gl.FLOAT, false, 0, 0);
    }
    this.ibo = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.ibo);
    gl.bufferData(gl.ARRAY_BUFFER, this.data.byteLength, gl.DYNAMIC_DRAW);
    this.setupInstanceAttribs();
    gl.bindVertexArray(null);
  }

  private setupInstanceAttribs() {
    const gl = this.gl;
    let off = 0;
    this.layout.forEach((size, k) => {
      const loc = k + 1;
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, this.stride * 4, off * 4);
      gl.vertexAttribDivisor(loc, 1);
      off += size;
    });
  }

  begin() { this.count = 0; }

  /** returns float offset to write `stride` floats into this.data */
  push(): number {
    if (this.count >= this.cap) this.grow();
    return this.count++ * this.stride;
  }

  private grow() {
    const gl = this.gl;
    this.cap *= 2;
    const nd = new Float32Array(this.cap * this.stride);
    nd.set(this.data);
    this.data = nd;
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.ibo);
    gl.bufferData(gl.ARRAY_BUFFER, this.data.byteLength, gl.DYNAMIC_DRAW);
    this.setupInstanceAttribs();
    gl.bindVertexArray(null);
  }

  draw(mode: number = this.gl.TRIANGLES) {
    if (!this.count) return;
    const gl = this.gl;
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.ibo);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.data, 0, this.count * this.stride);
    gl.drawArraysInstanced(mode, 0, this.vertCount, this.count);
    gl.bindVertexArray(null);
  }
}

// unit quad, two triangles, corners in [-0.5,0.5]x[0,1] (sprites) / [-1,1]^2 (glows, decals)
export const QUAD_FEET = new Float32Array([-0.5, 0, 0.5, 0, 0.5, 1, -0.5, 0, 0.5, 1, -0.5, 1]);
export const QUAD_CENTER = new Float32Array([-1, -1, 1, -1, 1, 1, -1, -1, 1, 1, -1, 1]);
