// One quick end-to-end check on an in-memory Postgres: logins, an action, secrecy, and the clock.
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import { connect, SCHEMA } from './db';
import { makeApp } from './app';

let t = Date.UTC(2026, 9, 19, 12);
const q = await connect(undefined);
await q(SCHEMA);
const h = await bcrypt.hash('password', 4);
for (const [u, n, a] of [['admin', 'Uzair', true], ['amara', 'Amara', false], ['bilal', 'Bilal', false], ['cara', 'Cara', false]] as const)
  await q('INSERT INTO users (username, display_name, password_hash, is_admin) VALUES ($1,$2,$3,$4)', [u, n, h, a]);
await q("INSERT INTO users (username, display_name, password_hash, approved) VALUES ('late', 'Late', $1, FALSE)", [h]);

const { app, getWorld } = await makeApp({ q, secret: 's', origins: ['http://ok.test'], now: () => t, log: () => {} });
const srv = app.listen(0);
const base = `http://localhost:${(srv.address() as any).port}`;
const call = async (path: string, body?: any, token?: string, origin?: string) => {
  const r = await fetch(base + path, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(origin ? { Origin: origin } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => ({})), cors: r.headers.get('access-control-allow-origin') };
};

try {
  assert.equal((await call('/api/health')).status, 200);
  assert.equal((await call('/api/health', undefined, undefined, 'http://evil.test')).status, 403, 'unknown origin refused loudly');
  assert.equal((await call('/api/health', undefined, undefined, 'http://ok.test')).cors, 'http://ok.test');
  assert.equal((await call('/api/login', { username: 'amara', password: 'nope' })).status, 401);
  assert.equal((await call('/api/login', { username: 'late', password: 'password' })).status, 403, 'unapproved refused');
  const A = (await call('/api/login', { username: 'Amara', password: 'password' })).body.token;
  const B = (await call('/api/login', { username: 'bilal', password: 'password' })).body.token;
  assert.ok(A && B);
  assert.equal(Object.keys(getWorld().citizens).length, 4, 'approved users became citizens');

  const s = await call('/api/state', undefined, A);
  assert.equal(s.status, 200);
  assert.equal(s.body.me, 'u2');
  assert.equal(s.body.world.phase, 'convention');
  assert.ok(!('c:u3' in s.body.world.accounts), 'other wallets hidden');
  assert.equal(s.body.world.accounts['c:u2'], 100);

  // a convention vote goes through and its ballot stays secret from others
  const clause = getWorld().convention.clauses[0].id;
  const v = await call('/api/act', { cmd: 'convention.vote', args: { clause, option: 0 } }, A);
  assert.equal(v.status, 200, JSON.stringify(v.body));
  assert.equal(getWorld().convention.clauses[0].votes.u2, 0);
  const bad = await call('/api/act', { cmd: 'election.vote', args: { election: 'nope', candidate: 'u3' } }, A);
  assert.equal(bad.status, 400);
  assert.ok(bad.body.error);

  // money moves and the ledger stays balanced
  assert.equal((await call('/api/act', { cmd: 'money.send', args: { to: 'u3', amount: 15, note: 'lunch' } }, A)).status, 200);
  const sum = Object.values(getWorld().accounts).reduce((a: number, b: any) => a + b, 0);
  assert.equal(sum, 0, 'ledger balanced');
  assert.equal((await call('/api/state', undefined, B)).body.world.accounts['c:u3'], 115);

  // the clock runs while nobody is looking: a party nobody co-signs lapses by the next read after its deadline
  const f = await call('/api/act', { cmd: 'party.found', args: { name: 'Test Party', colour: '#336699', cofounders: ['u3', 'u4'] } }, A);
  assert.equal(f.status, 200, JSON.stringify(f.body));
  t += 3 * 86400_000;
  const later = await call('/api/state', undefined, B);
  assert.equal(later.body.world.now, t);
  assert.equal((Object.values(getWorld().parties)[0] as any).status, 'lapsed', 'deadlines caught up after sleep');

  // the world survives a restart
  const again = await makeApp({ q, secret: 's', origins: [], now: () => t, log: () => {} });
  assert.equal(again.getWorld().phase, getWorld().phase);

  // a password change signs out old tokens
  const pw = await call('/api/password', { current: 'password', next: 'longerpass' }, A);
  assert.equal(pw.status, 200);
  assert.equal((await call('/api/state', undefined, A)).status, 401);
  assert.equal((await call('/api/state', undefined, pw.body.token)).status, 200);

  // admin-only routes
  assert.equal((await call('/api/admin/export', undefined, B)).status, 403);
  const R = (await call('/api/login', { username: 'admin', password: 'password' })).body.token;
  assert.equal((await call('/api/admin/export', undefined, R)).status, 200);
  assert.equal((await call('/api/state', undefined, R)).body.world.audit.total, 0);
  console.log('server ok');
} finally {
  srv.close();
}
process.exit(0);
