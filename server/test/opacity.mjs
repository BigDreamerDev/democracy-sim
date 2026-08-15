/* The map is real coastlines and invented countries, and the whole conceit
 * collapses the first time a player reads "United States of America" off it.
 *
 * That guarantee used to be asserted only about rendering. It was not true of
 * the data: subdivision geometry shipped keyed by ISO 3166-2, so `AE-AJ` told
 * you it was Ajman, United Arab Emirates without a name table involved at all —
 * the identity was in the key. This suite asserts the guarantee about the bytes
 * a player can actually obtain, which is the only version of it that means
 * anything.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { call, ok, report, setup } from './world.mjs';

const w = await setup({ citizens: 7 });
const T = w.admin.token;
const plain = w.users.at(-1).token;          // holds no office, is not the RO

/* A sample of real place names and ISO codes, read from the server-side file
   that is allowed to know them. Nothing in this list may appear in anything a
   player can fetch. */
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
  const iso = realIso.find(c => hay.includes(`"${c}"`));
  if (iso) return `ISO code "${iso}"`;
  return null;
};

console.log('\n-- the sample itself is worth having');
ok(realNames.length > 500, `${realNames.length} real names to check against`);
ok(realIso.length > 500, `${realIso.length} ISO codes to check against`);

console.log('\n-- nothing a player can fetch names the real world');
for (const path of [
  '/api/diplomacy/map',
  '/api/diplomacy/powers',
  '/api/diplomacy/treaties',
  '/api/diplomacy/conflicts',
  '/api/diplomacy/balance'
]) {
  const r = await call(path, { token: plain });
  const bad = leaks(JSON.stringify(r.d ?? ''));
  ok(!bad, `${path} is opaque${bad ? ' — LEAKED ' + bad : ''}`);
}

console.log('\n-- and the names are not reachable by asking politely');
const asPlayer = await call('/api/admin/territories/subdivisions/826', { token: plain });
ok(asPlayer.status === 403, `a citizen is refused the name table (${asPlayer.status})`);
const anon = await call('/api/admin/territories/subdivisions/826');
ok(anon.status === 401 || anon.status === 403, `so is nobody at all (${anon.status})`);

console.log('\n-- the Returning Officer still gets what the console needs');
const asRO = await call('/api/admin/territories/subdivisions/826', { token: T });
ok(asRO.status === 200, 'the RO may read it');
ok(Array.isArray(asRO.d?.subdivisions) && asRO.d.subdivisions.length > 0,
  `and it has content (${asRO.d?.subdivisions?.length || 0} subdivisions)`);
ok(asRO.d.subdivisions.every(s => /^s\d+$/.test(String(s.code))),
  'every code handed out is opaque, even to the RO — it is what the database stores');
ok(asRO.d.subdivisions.some(s => s.name), 'and the RO can see the real names alongside them');

console.log('\n-- the geometry the browser downloads');
const dir = new URL('../../docs/subdiv/', import.meta.url);
const files = readdirSync(dir).filter(f => f.endsWith('.json'));
ok(files.length > 100, `${files.length} territory files are served`);

let badFile = null, badKey = null, shapes = 0;
for (const f of files) {
  const raw = readFileSync(new URL(f, dir), 'utf8');
  if (!badFile && leaks(raw)) badFile = `${f}: ${leaks(raw)}`;
  if (f === 'index.json' || f === 'parents.json') continue;
  for (const k of Object.keys(JSON.parse(raw).shapes || {})) {
    shapes++;
    if (!badKey && !/^s\d+$/.test(k)) badKey = `${f}: ${k}`;
  }
}
ok(!badFile, `no shipped file names the real world${badFile ? ' — ' + badFile : ''}`);
ok(!badKey, `every shipped shape key is opaque${badKey ? ' — ' + badKey : ''}`);
ok(shapes > 2000, `${shapes} shapes checked`);

console.log('\n-- and the files that DO know are not in the served directory');
const served = readdirSync(new URL('../../docs/', import.meta.url));
ok(!served.includes('subdivisions.json'), 'the name table is not under docs/');
ok(!served.includes('subdivision-codes.json'), 'the ISO mapping is not under docs/');
ok(!served.includes('world-subdivisions.js'), 'and the old ISO-keyed bundle is gone');

report();
