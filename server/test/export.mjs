/* The nation as an SVG a player can drop straight into the group chat.

   Two things have to be true for that to be safe: the export has to actually
   draw what the Republic holds, and it must not carry a single byte that
   identifies a real place — no ISO code, no id, no comment, no metadata. An
   image is the thing most likely to be forwarded outside the game, so this is
   the one surface where a leak cannot be walked back. */

import { readFileSync } from 'node:fs';
import { B, call, ok, report, setup } from './world.mjs';

const w = await setup({ citizens: 7 });
const T = w.admin.token;
const plain = w.plainTok;

const setRepublic = codes =>
  call('/api/admin/republic/territories', { method: 'PUT', body: { codes }, token: T });

/* Same sample the opacity suite checks the rest of the API against. Nothing an
   export produces may contain any of these. */
const NAMES = JSON.parse(readFileSync(new URL('../subdivisions.json', import.meta.url)));
const realNames = [];
const realIso = [];
for (const list of Object.values(NAMES)) {
  for (const s of list) {
    if (s.name && s.name.length > 4) realNames.push(s.name);
    if (/^[A-Z]{2}-/.test(s.code || '')) realIso.push(s.code);
  }
}
const leaks = text => {
  const hay = String(text);
  const name = realNames.find(n => hay.includes(n));
  if (name) return `real place name "${name}"`;
  const iso = realIso.find(c => hay.includes(c));
  if (iso) return `ISO code "${iso}"`;
  return null;
};

console.log('-- before the Republic holds anything');

let info = await call('/api/world/export');
ok(info.status === 200, `the info route answers even with nothing held (${info.status})`);
ok(info.d.available === false, 'and says there is nothing to export');

const empty = await fetch(B + '/api/world/export.svg');
ok(empty.status === 404, `the SVG itself refuses with 404 when the Republic holds no ground (${empty.status})`);

console.log('\n-- give the Republic some ground');

/* Two whole territories, so the export has real geometry to union without
   needing the subdivision-level assignment route. */
const territories = (JSON.parse(readFileSync(new URL('../../docs/subdiv/index.json', import.meta.url)))).territories;
const codes = Object.keys(territories).slice(0, 2);
ok(codes.length === 2, `picked two territory codes from the atlas to hand the Republic (${codes.join(', ')})`);
ok((await setRepublic(codes)).status === 200, 'the Returning Officer assigns them');

console.log('\n-- the export itself');

const svgRes = await fetch(B + '/api/world/export.svg');
const svg = await svgRes.text();
ok(svgRes.status === 200, `the export answers 200 once there is ground to draw (${svgRes.status})`);
ok((svgRes.headers.get('content-type') || '').includes('image/svg+xml'), 'served as image/svg+xml');
ok(svg.startsWith('<svg'), 'the body is an SVG document');
ok(/<path/.test(svg), 'and it contains at least one path');

console.log('\n-- nothing in the bytes identifies a real place');

const bad = leaks(svg);
ok(!bad, `the default export is opaque${bad ? ' — LEAKED ' + bad : ''}`);
ok(!/\sid\s*=/.test(svg), 'no element carries an id attribute');
ok(!/\sclass\s*=/.test(svg), 'no element carries a class attribute');
ok(!/\sdata-/.test(svg), 'no element carries a data- attribute');
ok(!/<!--/.test(svg), 'no XML comment survived into the output');
ok(!/<metadata/i.test(svg), 'no <metadata> element');
ok(!new RegExp(codes.join('|')).test(svg), 'the M49 territory codes themselves are not in the bytes either');

console.log('\n-- query parameters');

const borders = await (await fetch(B + '/api/world/export.svg?borders=1')).text();
ok(borders.length >= svg.length, 'borders=1 draws at least as much as the default');
const noBad = leaks(borders);
ok(!noBad, `borders=1 is still opaque${noBad ? ' — LEAKED ' + noBad : ''}`);

const noLabel = await (await fetch(B + '/api/world/export.svg?labels=0')).text();
ok(!/<text/.test(noLabel), 'labels=0 removes the name and date entirely');
ok(/<text/.test(svg), 'and the default DOES carry a label, so the previous check means something');

const big = await (await fetch(B + '/api/world/export.svg?scale=3')).text();
const wMatch = s => Number((s.match(/width="(\d+(\.\d+)?)"/) || [])[1]);
ok(wMatch(big) > wMatch(svg), 'scale=3 produces a wider image than the default');

const transparent = await (await fetch(B + '/api/world/export.svg?bg=transparent')).text();
ok(!/<rect/.test(transparent), 'bg=transparent omits the background rect entirely');
ok(/<rect/.test(svg), 'and the default DOES paint one, so that check means something');

const custom = await (await fetch(B + '/api/world/export.svg?bg=112233')).text();
ok(/#112233/i.test(custom), 'a bare hex bg is accepted and painted');

const badBg = await (await fetch(B + '/api/world/export.svg?bg=not-a-colour')).text();
ok(!/not-a-colour/.test(badBg), 'a nonsense bg value is rejected rather than echoed into the SVG');

const world = await (await fetch(B + '/api/world/export.svg?frame=world')).text();
ok(world.includes('viewBox="0 0'), 'frame=world uses the whole atlas viewBox, not a crop');

const dl = await fetch(B + '/api/world/export.svg?download=1');
ok((dl.headers.get('content-disposition') || '').includes('attachment'), 'download=1 sends an attachment header');

console.log('\n-- determinism');

const again = await (await fetch(B + '/api/world/export.svg')).text();
ok(again === svg, 'the same request produces byte-identical output — evidence, not a screenshot');

console.log('\n-- the palette comes from the Flag Act');

ok(svg.includes('#006A44') || svg.includes('#003087'), 'the seeded Flag Act colours appear in the export');

console.log('\n-- no server-side rasteriser');

ok(!info.d.png || /browser|canvas/i.test(info.d.png), 'the info route points PNG at the browser, not a server route');
const png = await fetch(B + '/api/world/export.png');
ok(png.status === 404, `there is no export.png route at all (${png.status})`);

console.log('\n-- who may call it');

ok((await call('/api/world/export.svg', { token: plain })).status === 200, 'an ordinary citizen may fetch it');
ok((await call('/api/world/export.svg')).status === 200, 'so may a signed-out visitor — the export is public, like the map it is drawn from');

report();
