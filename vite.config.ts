import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { rmSync } from 'node:fs';

// npm run dev         the demo, served locally (no server needed)
// npm run dev:online  the real app against a local server on :4321 (run `npm run dev` in server/ too)
// npm run build       the real app into docs/ for GitHub Pages. docs/config.js, icons and the manifest are never touched.
// npm run build:demo  one self-contained demo HTML file in dist/
export default defineConfig(({ mode }) => {
  const site = mode === 'production';
  if (site) rmSync('docs/assets', { recursive: true, force: true });
  return {
    root: 'web',
    base: './',
    publicDir: false,
    plugins: [
      preact(),
      ...(mode === 'demo' ? [viteSingleFile()] : []),
      {
        name: 'api-config',
        transformIndexHtml(html: string) {
          if (site) return html.replace('<script type="module"', '<script src="config.js"></script>\n  <script type="module"');
          if (mode === 'online') return html.replace('<script type="module"', '<script>window.API_BASE = "http://localhost:4321";</script>\n  <script type="module"');
          return html.replace(/<link rel="(manifest|icon|apple-touch-icon)"[^>]*>\n\s*/g, '');
        }
      }
    ],
    server: { port: 5173, host: true },
    build: { target: 'es2020', outDir: site ? '../docs' : '../dist', emptyOutDir: !site }
  };
});
