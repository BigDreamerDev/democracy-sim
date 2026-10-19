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

const deliveries: { url: string; body: any; headers: any }[] = [];
const send = async (url: string, body: string, headers: any) => (deliveries.push({ url, body: JSON.parse(body), headers }), 200);
const { app, getWorld } = await makeApp({ q, secret: 's', origins: ['http://ok.test'], now: () => t, log: () => {}, send, site: 'http://ok.test/', env: { GOOGLE_CLIENT_ID: 'gid', GOOGLE_CLIENT_SECRET: 'gsecret' }, publicUrl: 'http://api.test' });
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

  const A2 = () => pw.body.token;
  // admin-only routes
  assert.equal((await call('/api/admin/export', undefined, B)).status, 403);
  const R = (await call('/api/login', { username: 'admin', password: 'password' })).body.token;
  assert.equal((await call('/api/admin/export', undefined, R)).status, 200);
  assert.equal((await call('/api/state', undefined, R)).body.world.audit.total, 0);
  // the public API: keys, any origin, read-only vs act, long-poll, revoke
  const T = (await call('/api/login', { username: 'bilal', password: 'password' })).body.token;
  const ro = (await call('/api/keys', { name: 'My bot', scope: 'read' }, T)).body;
  const rw = (await call('/api/keys', { name: 'My app', scope: 'act' }, T)).body;
  assert.ok(ro.key.startsWith('rlm_') && rw.key);
  assert.equal((await call('/api/keys', undefined, T)).body.length, 2);
  assert.equal((await call('/api/v1/me', undefined, T)).status, 401, 'session tokens are not API keys');
  const me = await call('/api/v1/me', undefined, ro.key, 'https://someones-app.example');
  assert.equal(me.status, 200);
  assert.equal(me.cors, '*', 'any origin may call v1');
  assert.equal(me.body.id, 'u3');
  const st = await call('/api/v1/state', undefined, ro.key);
  assert.ok(!('c:u2' in st.body.world.accounts), 'v1 gets the same redacted view');
  assert.equal((await call('/api/v1/act', { cmd: 'money.send', args: { to: 'u2', amount: 1 } }, ro.key)).status, 403, 'read keys cannot act');
  assert.equal((await call('/api/v1/act', { cmd: 'admin.setting', args: { key: 'openSignup', value: true } }, rw.key)).status, 400, 'no admin via keys');
  assert.equal((await call('/api/v1/act', { cmd: 'money.send', args: { to: 'u2', amount: 'x'.repeat(5000) } }, rw.key)).status, 400, 'oversized args refused');
  const since = st.body.version;
  const waiting = call(`/api/v1/state?since=${since}&wait=5`, undefined, ro.key);
  await new Promise((r) => setTimeout(r, 100));
  const sent = await call('/api/v1/act', { cmd: 'money.send', args: { to: 'u2', amount: 2, note: 'via api' } }, rw.key);
  assert.equal(sent.status, 200, JSON.stringify(sent.body));
  assert.ok((await waiting).body.version > since, 'long-poll wakes on change');
  assert.equal(Object.values(getWorld().accounts).reduce((a: number, b: any) => a + b, 0), 0, 'ledger balanced after API act');
  assert.ok(Object.keys((await call('/api/v1/commands')).body).length > 50);
  await call('/api/keys/revoke', { id: rw.id }, T);
  assert.equal((await call('/api/v1/me', undefined, rw.key)).status, 401, 'revoked key refused');
  // apps, Sign in with the Realm, the directory, webhooks and the bot badge
  assert.equal((await call('/api/apps', { name: 'Bad', redirect: 'http://evil.test/cb' }, A2())).status, 400, 'http redirects only for localhost');
  const made = (await call('/api/apps', { name: 'Realm Bot', description: 'Posts news', homepage: 'https://bot.test', redirect: 'https://bot.test/cb' }, A2())).body;
  assert.ok(made.client_id.startsWith('app_'));
  assert.equal((await call('/api/apps/info?app=' + made.client_id, undefined, T)).body.name, 'Realm Bot');
  const auth = await call('/api/authorize', { app: made.client_id, scope: 'act', state: 'xyz' }, T);
  assert.ok(auth.body.redirect.startsWith('https://bot.test/cb#key=rlm_'), JSON.stringify(auth.body));
  assert.ok(auth.body.redirect.endsWith('state=xyz'));
  assert.equal((await call('/api/authorize', { app: made.client_id, redirect: 'https://evil.test/' }, T)).status, 400, 'redirect must match');
  const appKey = new URLSearchParams(auth.body.redirect.split('#')[1]).get('key')!;
  assert.equal((await call('/api/v1/me', undefined, appKey)).body.keyName, 'Realm Bot');
  const dir = (await call('/api/v1/apps')).body;
  assert.equal(dir[0].name, 'Realm Bot');
  assert.equal(dir[0].users, 1);
  assert.equal((await call('/api/v1/hooks', { url: 'http://insecure.test/' }, appKey)).status, 400, 'https hooks only');
  const hook = (await call('/api/v1/hooks', { url: 'https://hooks.test/realm' }, appKey)).body;
  assert.ok(hook.secret.startsWith('whsec_'));
  assert.ok((await call('/api/v1/hooks/test', { id: hook.id }, appKey)).body.ok);
  assert.equal(deliveries.at(-1)!.body.event, 'ping');
  const fp = await call('/api/v1/act', { cmd: 'party.found', args: { name: 'Bot Party', colour: '#aa3300', cofounders: ['u2', 'u4'] } }, appKey);
  assert.equal(fp.status, 200, JSON.stringify(fp.body));
  assert.equal(getWorld().gazette[0].via, 'Realm Bot', 'bot badge on the Gazette');
  await new Promise((r) => setTimeout(r, 50));
  const g = deliveries.filter((x) => x.body.event === 'gazette').at(-1)!;
  assert.equal(g.body.entries.at(-1).via, 'Realm Bot');
  const { createHmac } = await import('node:crypto');
  assert.equal(g.headers['X-Realm-Signature'], 'sha256=' + createHmac('sha256', hook.secret).update(JSON.stringify(g.body)).digest('hex'), 'signed');
  // personal alerts: Bilal is named co-founder of Amara's new party, and only Bilal's hook hears of it
  const mineHook = (await call('/api/hooks', { url: 'https://bilal.test/alerts', kind: 'personal' }, T)).body;
  assert.equal(mineHook.kind, 'personal');
  const before = deliveries.length;
  assert.equal((await call('/api/act', { cmd: 'party.found', args: { name: 'Amara Party', colour: '#225588', cofounders: ['u3', 'u4'] } }, A2())).status, 200);
  await new Promise((r) => setTimeout(r, 100));
  const alerts = deliveries.slice(before).filter((d) => d.body.event === 'alert');
  assert.equal(alerts.length, 1, 'one personal alert');
  assert.equal(alerts[0].url, 'https://bilal.test/alerts');
  assert.ok(alerts[0].body.alerts[0].key.startsWith('cofound:'));
  assert.ok(alerts[0].body.alerts[0].url.includes('#/parties'));
  await call('/api/state', undefined, T);
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(deliveries.slice(before).filter((d) => d.body.event === 'alert').length, 1, 'not sent twice');
  assert.ok((await call('/api/v1/alerts', undefined, appKey)).body.some((x: any) => x.key.startsWith('cofound:')));

  // reviews and the RO's take-down
  assert.equal((await call('/api/apps/review', { app: made.client_id, stars: 5 }, A2())).status, 400, 'no reviewing your own app');
  assert.equal((await call('/api/apps/review', { app: made.client_id, stars: 4, text: 'Handy' }, T)).status, 200);
  const det = (await call('/api/v1/apps/' + made.client_id)).body;
  assert.equal(det.rating, 4);
  assert.equal(det.reviewList[0].text, 'Handy');
  assert.equal((await call('/api/admin/apps/remove', { app: made.client_id, reason: 'Spamming the Gazette' }, T)).status, 403, 'RO only');
  const RO = (await call('/api/login', { username: 'admin', password: 'password' })).body.token;
  assert.equal((await call('/api/admin/apps/remove', { app: made.client_id, reason: 'Spamming the Gazette' }, RO)).body.revoked, 1);
  assert.equal((await call('/api/v1/me', undefined, appKey)).status, 401, 'removed app loses its keys');
  assert.equal((await call('/api/v1/apps')).body.length, 0, 'gone from the directory');
  assert.equal((await call('/api/apps/info?app=' + made.client_id, undefined, T)).status, 400, 'no new sign-ins');
  assert.ok(getWorld().gazette[0].text.includes('removed the app'));
  await call('/api/admin/apps/restore', { app: made.client_id }, RO);
  assert.equal((await call('/api/v1/apps')).body.length, 1);
  await call('/api/apps/delete', { id: made.id }, A2());
  assert.equal((await call('/api/v1/me', undefined, appKey)).status, 401, 'deleting an app revokes its keys');
  // security: headers, weak passwords, lockout, timing-safe unknown users
  const h = await fetch(base + '/api/health');
  assert.equal(h.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(h.headers.get('cache-control'), 'no-store');
  assert.equal((await call('/api/password', { current: 'password', next: 'password123' }, R)).status, 400, 'common passwords refused');
  for (let i = 0; i < 4; i++) assert.equal((await call('/api/login', { username: 'cara', password: 'wrong' + i })).status, 401);
  t += 61_000; // past the per-IP minute
  const locked = await call('/api/login', { username: 'cara', password: 'wrong5' });
  assert.ok(/locked/.test(locked.body.error), 'fifth failure locks');
  assert.equal((await call('/api/login', { username: 'cara', password: 'password' })).status, 429, 'locked even with the right password');
  t += 16 * 60_000;
  assert.equal((await call('/api/login', { username: 'cara', password: 'password' })).status, 200, 'unlocks after 15 minutes');
  assert.equal((await call('/api/state', undefined, 'rlm_x')).status, 401, 'API keys are refused on first-party routes');

  // Sign in with Google (a fake Google: the token endpoint is stubbed)
  const realFetch = globalThis.fetch;
  let idClaims: any = {};
  globalThis.fetch = (async (url: any, init?: any) => {
    if (String(url).startsWith('https://oauth2.googleapis.com/token')) {
      const tok = ['e30', Buffer.from(JSON.stringify(idClaims)).toString('base64url'), 'sig'].join('.');
      return new Response(JSON.stringify({ id_token: tok, access_token: 'x' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    return realFetch(url, init);
  }) as any;
  const browser = 'b'.repeat(32);
  const oauth = async (mode: string, token?: string, sub = 'g-123') => {
    const b = await call('/api/oauth/begin', { provider: 'google', mode, browser }, token, 'http://ok.test');
    assert.equal(b.status, 200, JSON.stringify(b.body));
    const u = new URL(b.body.url);
    assert.equal(u.searchParams.get('code_challenge_method'), 'S256');
    assert.equal(u.searchParams.get('redirect_uri'), 'http://api.test/api/oauth/google/callback');
    const state = u.searchParams.get('state')!;
    idClaims = { iss: 'https://accounts.google.com', aud: 'gid', sub, email: 'bilal@example.com', email_verified: true, name: 'Bilal G', exp: Date.now() / 1000 + 300, nonce: u.searchParams.get('nonce') };
    const cb = await realFetch(base + '/api/oauth/google/callback?code=abc&state=' + state, { redirect: 'manual' });
    assert.equal(cb.status, 303);
    assert.ok(cb.headers.get('location')!.startsWith('http://ok.test/#/oauth?flow='), cb.headers.get('location')!);
    return state;
  };
  let fl = await oauth('login');
  const nope = await call('/api/oauth/finish', { flow: fl, browser }, undefined, 'http://ok.test');
  assert.ok(/No account is linked/.test(nope.body.error), 'unknown Google accounts never match by email: ' + JSON.stringify(nope.body));
  fl = await oauth('link', T);
  assert.equal((await call('/api/oauth/finish', { flow: fl, browser: 'c'.repeat(32) }, undefined, 'http://ok.test')).status, 400, 'another browser cannot finish');
  fl = await oauth('link', T);
  assert.equal((await call('/api/oauth/finish', { flow: fl, browser }, undefined, 'http://ok.test')).body.linked, 'google');
  fl = await oauth('login');
  const gl = await call('/api/oauth/finish', { flow: fl, browser }, undefined, 'http://ok.test');
  assert.equal(gl.body.me, 'u3', 'Google now signs Bilal in');
  assert.equal((await call('/api/oauth/finish', { flow: fl, browser }, undefined, 'http://ok.test')).status, 400, 'each flow works once');
  idClaims = {};
  const sec = await call('/api/me/security', undefined, gl.body.token);
  assert.equal(sec.body.identities[0].provider, 'google');
  assert.equal((await call('/api/oauth/unlink', { provider: 'google' }, gl.body.token)).status, 200, 'can unlink when a password exists');
  globalThis.fetch = realFetch;
  const out = await call('/api/logout-all', {}, gl.body.token);
  assert.equal((await call('/api/state', undefined, gl.body.token)).status, 401, 'sign out everywhere kills old tokens');
  assert.equal((await call('/api/state', undefined, out.body.token)).status, 200);
  console.log('server ok');
} finally {
  srv.close();
}
process.exit(0);
