/* Both themes must stay legible whatever the Flag Act says.
   The palette is derived from the flag at runtime, so a bad flag could otherwise
   produce an unreadable site — in either theme. */
import fs from 'fs';
const src = fs.readFileSync(new URL('../../docs/app.js', import.meta.url), 'utf8');
const start = src.indexOf('const hex2rgb'), end = src.indexOf('/* Draws the flag itself');
let code = src.slice(start, end)
  .replace('function applyFlagTheme(flag) {','export function derive(flag, night) {')
  .replace(/const root = document\.documentElement;[\s\S]*?if \(!flag.*?\n/,'')
  .replace('  const night = darkNow();\n','')
  .replace(/const set = \(k, v\) => root\.style\.setProperty\(k, v\);[\s\S]*$/,
`  return { paper, card, ink, box: bar, accent, accentFill, onAccent,
            rule: mix(paper, ink, 0.22), ink2: mix(paper, ink, 0.62) };
}
export { contrast, lum };
`);
// strip the theme helpers that need a browser
code = code.replace(/const THEMES[\s\S]*?^}\n/m,'').replace(/if \(window\.matchMedia\)[\s\S]*?\n}\n/,'');
const m = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));

const flags = {
  'McServerLandia': { bands:[{colour:'#006A44',weight:1},{colour:'#FFFFFF',weight:1},{colour:'#003087',weight:1}], device:'#F2A800' },
  'pale yellow':    { bands:[{colour:'#FFF8B0',weight:2},{colour:'#FFFFFF',weight:1}], device:'#FFF176' },
  'all black':      { bands:[{colour:'#111111',weight:1},{colour:'#222222',weight:1}], device:'#333333' },
  'red/white':      { bands:[{colour:'#C8102E',weight:1},{colour:'#FFFFFF',weight:1}], device:null }
};
let bad = 0;
for (const mode of [false, true]) {
  console.log(`\n${mode ? 'DARK' : 'LIGHT'}`);
  for (const [name,f] of Object.entries(flags)) {
    const t = m.derive(f, mode);
    const checks = [
      ['body on paper', m.contrast(t.ink, t.paper), 7],
      ['body on card',  m.contrast(t.ink, t.card), 7],
      ['link on card',  m.contrast(t.accent, t.card), 4.5],
      ['bar text',      m.contrast('#FFFFFF', t.box), 3.5],
      ['button text',   m.contrast(t.onAccent, t.accentFill), 3.0],
      ['rule visible',  m.contrast(t.rule, t.card), 1.15]
    ];
    const fail = checks.filter(([,r,min]) => r < min);
    bad += fail.length;
    console.log(`  ${fail.length ? 'FAIL' : 'ok  '} ${name.padEnd(16)} paper ${t.paper} card ${t.card} accent ${t.accent}`);
    fail.forEach(([l,r,min]) => console.log(`        ${l}: ${r.toFixed(2)} (need ${min})`));
  }
}
console.log(bad ? `\n${bad} contrast failures` : '\nevery flag is legible in both themes');
process.exit(bad?1:0);
