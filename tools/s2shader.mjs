import { chromium } from 'playwright';
import fs from 'node:fs';
const [file, be, out] = process.argv.slice(2);
const b = await chromium.launch({ headless: false, args: ['--allow-file-access-from-files'] });
const p = await b.newPage({ viewport: { width: 640, height: 360 } });
await p.goto('file://' + file + `?render=three&backend=${be}&freeze=1&res=640x360`);
await p.waitForFunction(() => window.s2?.ready, null, { timeout: 60000 });
const r = await p.evaluate(async () => {
  const s = window.s2, R = s.B.renderer ?? null;
  const mesh = s.scene.children.find((o) => o.isMesh && o.geometry.isInstancedBufferGeometry && o.visible && o.renderOrder === 0);
  const rr = s.B._r;
  const sh = await rr.debug.getShaderAsync(s.scene, s.scene.userData.cam, mesh);
  return sh;
});
fs.writeFileSync(out, r.fragmentShader + '\n//----VERTEX----\n' + r.vertexShader);
await b.close();
