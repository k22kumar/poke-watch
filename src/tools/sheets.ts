// Dev tool: bakes every creature design and shows the sprite sheets (open sheets.html).
import { bakeSheet } from '../render/baker';
import { DESIGNS } from '../render/designs';

const canvas = document.createElement('canvas');
const gl = canvas.getContext('webgl2', { preserveDrawingBuffer: true })!;
const root = document.getElementById('root')!;
const only = new URLSearchParams(location.search).get('only');
const mode = new URLSearchParams(location.search).get('mode') ?? 'portraits';
for (const [id, d] of Object.entries(DESIGNS)) {
  if (only && !only.split(',').includes(id)) continue;
  const big = ['grimbark', 'magmaw', 'rimewing', 'umbraking'].includes(id);
  const sheet = bakeSheet(gl, d, big ? 160 : 96);
  const box = document.createElement('div');
  box.className = 'card';
  if (mode === 'portraits') {
    const c = sheet.portrait;
    c.style.width = '192px'; c.style.height = '192px';
    box.appendChild(c);
  } else {
    // full sheet via readback of texture -> draw in a 2D canvas
    const fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, sheet.tex, 0);
    const px = new Uint8Array(sheet.w * sheet.h * 4);
    gl.readPixels(0, 0, sheet.w, sheet.h, gl.RGBA, gl.UNSIGNED_BYTE, px);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    const c = document.createElement('canvas');
    c.width = sheet.w; c.height = sheet.h;
    const ctx = c.getContext('2d')!;
    const img = ctx.createImageData(sheet.w, sheet.h);
    for (let y = 0; y < sheet.h; y++) img.data.set(px.subarray((sheet.h - 1 - y) * sheet.w * 4, (sheet.h - y) * sheet.w * 4), y * sheet.w * 4);
    ctx.putImageData(img, 0, 0);
    box.appendChild(c);
  }
  const label = document.createElement('div');
  label.textContent = id;
  box.appendChild(label);
  root.appendChild(box);
}
document.title = 'sheets-ready';
