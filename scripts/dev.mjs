// Dev server: rebuilds dist/index.html on every change and serves it at http://localhost:5173
import * as esbuild from 'esbuild';
import fs from 'node:fs';

const writeHtml = {
  name: 'write-html',
  setup(build) {
    build.onEnd((res) => {
      if (res.errors.length) return;
      const js = res.outputFiles?.[0]?.text ?? '';
      const tpl = fs.readFileSync('index.html', 'utf8');
      const css = fs.readFileSync('src/ui/style.css', 'utf8');
      fs.mkdirSync('dist', { recursive: true });
      fs.writeFileSync('dist/index.html', tpl.replace('/*__CSS__*/', () => css).replace('/*__JS__*/', () => js.replace(/<\/script/g, '<\\/script')));
      console.log(`[${new Date().toLocaleTimeString()}] rebuilt dist/index.html`);
    });
  },
};

const ctx = await esbuild.context({ entryPoints: ['src/main.ts'], bundle: true, format: 'iife', target: 'es2022', write: false, sourcemap: 'inline', plugins: [writeHtml] });
await ctx.watch();
const { port } = await ctx.serve({ servedir: 'dist', port: 5173 });
console.log(`Poke-Watch dev server: http://localhost:${port}  (edit src/** and reload)`);
