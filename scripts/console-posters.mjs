// Puts the site's own poster code (web/src/posters.ts) into the Realm Console, so its posters are the site's posters.
// Run after changing the posters: npm run console:posters. Writes examples/realm-console/console.html and docs/console.html.
import { build } from 'esbuild';
import { readFileSync, writeFileSync, copyFileSync } from 'node:fs';
const out = await build({ entryPoints: ['web/src/posters.ts'], bundle: true, minify: true, format: 'iife', globalName: 'RealmPosters', write: false, target: 'es2019' });
const code = out.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const tag = (s) => `<script id="realm-posters">/* web/src/posters.ts, bundled by scripts/console-posters.mjs */\n${s}</script>`;
for (const f of ['examples/realm-console/console.html']) {
  let html = readFileSync(f, 'utf8');
  const re = /<script id="realm-posters">[\s\S]*?<\/script>/;
  html = re.test(html) ? html.replace(re, () => tag(code)) : html.replace('<script>\n\'use strict\';', () => tag(code) + '\n<script>\n\'use strict\';');
  writeFileSync(f, html);
}
// the site's copy is always the same file
copyFileSync('examples/realm-console/console.html', 'docs/console.html');
console.log(`console posters: ${(code.length / 1024).toFixed(0)} KB`);
