import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { rmSync } from 'node:fs';
import type { Plugin } from 'vite';
import * as C from './scripts/copy';

// The copy desk (#/copy, `npm run dev` only): reads every player-facing string live from the source, saves your
// rewording to copy/edits.json as you type, and writes it into the source when you press Apply.
function copyDesk(): Plugin {
  const body = (req: any) => new Promise<any>((ok) => {
    let b = '';
    req.on('data', (c: any) => (b += c));
    req.on('end', () => {
      try {
        ok(b ? JSON.parse(b) : {});
      } catch {
        ok(null);
      }
    });
  });
  return {
    name: 'copy-desk',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__copy', async (req: any, res: any) => {
        const send = (x: any) => (res.setHeader('Content-Type', 'application/json'), res.end(JSON.stringify(x)));
        // these write source files: only the dev page itself may call them, never another site in your browser
        const origin = req.headers.origin;
        if (origin && origin !== `http://${req.headers.host}`) {
          res.statusCode = 403;
          return send({ error: 'forbidden' });
        }
        try {
          if (req.method === 'GET' && req.url.startsWith('/strings')) return send({ strings: C.extract().map(({ start, end, ...s }: any) => s) });
          if (req.method === 'GET' && req.url.startsWith('/edits')) return send(C.readEdits());
          if (req.method === 'POST' && req.url.startsWith('/edits')) {
            const d = await body(req);
            if (!d || !Array.isArray(d.edits)) return ((res.statusCode = 400), send({ error: 'bad body' }));
            return (C.saveEdits(d), send({ ok: true }));
          }
          if (req.method === 'POST' && req.url.startsWith('/apply')) {
            const data = C.readEdits();
            const r = C.applyEdits(data.edits || []);
            // what you rewrote counts as reviewed under its new wording
            const appliedTexts = new Set((data.edits || []).filter((e: any) => r.done.includes(e.id)).map((e: any) => e.text));
            const fresh = C.extract();
            const reviewed = new Set([...(data.reviewed || []), ...fresh.filter((s: any) => appliedTexts.has(s.text)).map((s: any) => s.id)]);
            C.saveEdits({ edits: (data.edits || []).filter((e: any) => !r.done.includes(e.id)), reviewed: [...reviewed] });
            C.writeStrings();
            return send(r);
          }
          res.statusCode = 404;
          send({ error: 'unknown' });
        } catch (e: any) {
          res.statusCode = 500;
          send({ error: String(e?.message || e) });
        }
      });
    }
  };
}

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
      copyDesk(),
      ...(mode === 'demo' ? [viteSingleFile()] : []),
      {
        name: 'api-config',
        transformIndexHtml(html: string) {
          // the live site: a strict Content Security Policy (GitHub Pages can't send headers, so it rides in a meta tag).
          // Scripts only from this site; the API anywhere over https; fonts from Google Fonts; nothing framed or embedded.
          const csp = ["default-src 'self'", "script-src 'self'", "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com", "font-src https://fonts.gstatic.com", "img-src 'self' data: https:", "connect-src 'self' https:", "object-src 'none'", "base-uri 'self'", "form-action 'self'", "worker-src 'self'", "manifest-src 'self'"].join('; ');
          if (site) return html.replace('<meta charset="utf-8">', `<meta charset="utf-8">\n  <meta http-equiv="Content-Security-Policy" content="${csp}">\n  <meta name="referrer" content="strict-origin-when-cross-origin">`).replace('<script type="module"', '<script src="config.js"></script>\n  <script type="module"');
          if (mode === 'online') return html.replace('<script type="module"', '<script>window.API_BASE = "http://localhost:4321";</script>\n  <script type="module"');
          return html.replace(/<link rel="(manifest|icon|apple-touch-icon)"[^>]*>\n\s*/g, '');
        }
      }
    ],
    // localhost only: the copy desk's endpoints write source files, so they must not be reachable from the network
    server: { port: 5173, host: 'localhost' },
    build: { target: 'es2020', outDir: site ? '../docs' : '../dist', emptyOutDir: !site }
  };
});
