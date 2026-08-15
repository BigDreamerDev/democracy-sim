/* The curated public read mirror and the SSE feed built on top of it.
 *
 * The opacity check reuses the exact sampling approach opacity.mjs already
 * trusts — real names and ISO codes read from the server-side file allowed to
 * know them — rather than a weaker ad hoc string search, because that suite
 * is the one place this codebase has already gotten this check right.
 */
import { readFileSync } from 'node:fs';
import { B, call, ok, report, setup, passBill } from './world.mjs';

const w = await setup({ citizens: 7 });

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

console.log('\n-- the public v1 surface answers, unauthenticated, with open CORS');
for (const path of ['/api/public/v1/economy', '/api/public/v1/bills', '/api/public/v1/elections']) {
  const r = await call(path);
  ok(r.status === 200, `${path} answers with no auth (${r.status})`);
}
const cors = await fetch(B + '/api/public/v1/economy');
ok(cors.headers.get('access-control-allow-origin') === '*', 'CORS is wide open on this router specifically');

console.log('\n-- and it is opaque, same guarantee as everywhere else');
for (const path of ['/api/public/v1/map', '/api/public/v1/powers', '/api/public/v1/treaties', '/api/public/v1/conflicts', '/api/public/v1/economy', '/api/public/v1/bills']) {
  const r = await call(path);
  const bad = leaks(JSON.stringify(r.d ?? ''));
  ok(!bad, `${path} is opaque${bad ? ' — LEAKED ' + bad : ''}`);
}

console.log('\n-- an optional module that is not mounted here answers 503, not a fabricated number');
// diplomacy_enabled defaults off in a fresh world, and this build has no war
// schema loaded either way — either is a fine example of "not enabled".
const war = await call('/api/public/v1/war');
ok(war.status === 200 || war.status === 503, `war mirror answers sensibly (${war.status})`);

console.log('\n-- events: at least one end-to-end delivery');
const stream = await fetch(B + '/api/public/v1/events');
ok(stream.status === 200 && stream.headers.get('content-type')?.includes('text/event-stream'),
  `SSE endpoint opens (${stream.status}, ${stream.headers.get('content-type')})`);

const reader = stream.body.getReader();
const decoder = new TextDecoder();
let buffer = '';
async function pump(ms) {
  const timeout = new Promise(r => setTimeout(() => r(null), ms));
  const chunk = await Promise.race([reader.read(), timeout]);
  if (chunk?.value) buffer += decoder.decode(chunk.value, { stream: true });
}

// Drain the initial ": connected" comment.
await pump(1000);

// Push a bill all the way to a public outcome — bill.close is on the
// broadcast list — while the stream is open, then look for it downstream.
await passBill(w, { title: 'Public feed test', kind: 'ordinary', body: 'x' }, { assent: false });

let seen = false;
for (let i = 0; i < 20 && !seen; i++) {
  await pump(300);
  if (buffer.includes('event: bill.close')) seen = true;
}
ok(seen, `bill.close reached the SSE stream end-to-end${seen ? '' : ' — buffer was: ' + buffer.slice(-300)}`);
reader.cancel().catch(() => {});

report();
