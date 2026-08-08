/* The flag comes out of the statute book, and amending the law repaints the state. */
import { call, ok, report, setup, passBill, PW } from './world.mjs';
const w = await setup();
const admin = w.admin;
const citizens = w.citizens;
const mps = w.mps;
const T = w.T;
const tok = w.tok;

console.log('\n-- the Flag Act exists from the first minute');
const laws = (await call('/api/laws')).d;
const act = laws.find(l => l.ref === 'L001');
ok(!!act && act.title === 'The Flag Act', 'L001 The Flag Act is in the statute book at startup');
const f = (await call('/api/flag')).d;
ok(f.bands.length === 3, 'three bands');
ok(f.bands.map(b => b.colour).join(',') === '#006A44,#FFFFFF,#003087', 'emerald, white, ocean in order');
ok(f.device === '#F2A800' && f.stars === 19, 'nineteen gold stars');
ok(f.bands.every(b => b.weight === 1), 'equal thirds');
ok(f.bands[0].label === 'Emerald', 'band names are read from the schedule');
ok((await call('/api/state')).d.flag.law_ref === 'L001', 'the state feed carries the flag');

console.log('\n-- amending the Act repaints the state');
const newAct = `The flag is two bands, crimson over sand, with no device.

## Schedule
band = #8C1C13 2 — Crimson
band = #E8D8B0 1 — Sand
stars = 0`;
await passBill(w, { title: 'The Flag Act', kind: 'amendment', body: newAct, target_law_id: act.id });

const f2 = (await call('/api/flag')).d;
ok(f2.bands.length === 2 && f2.bands[0].colour === '#8C1C13', 'the new flag is live the moment assent is given');
ok(f2.bands[0].weight === 2, 'unequal bands are read as weights');
ok(f2.stars === 0 && !f2.device, 'the device is gone');

console.log('\n-- a flag with no law');
await call('/api/admin/config', { method: 'PUT', body: { flag_law_ref: 'L999' }, token: admin.token });
ok((await call('/api/flag')).status === 404, 'pointing at a law that does not exist leaves no flag');
ok((await call('/api/state')).d.flag === null, 'the state feed says so plainly rather than breaking');
await call('/api/admin/config', { method: 'PUT', body: { flag_law_ref: 'L001' }, token: admin.token });
ok((await call('/api/state')).d.flag.bands.length === 2, 'pointing it back restores the flag');

console.log('\n-- a repealed flag');
await passBill(w, { title: 'Abolish the flag', kind: 'repeal', body: 'Repealed.', target_law_id: act.id });
ok((await call('/api/state')).d.flag === null, 'repealing the Flag Act leaves the Republic with no flag, and the site falls back to its default palette');

report();
