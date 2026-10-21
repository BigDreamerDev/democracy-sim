// One quick end-to-end check on an in-memory Postgres: logins, an action, secrecy, and the clock.
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import { createHash, generateKeyPairSync, sign as ecSign, randomBytes } from 'node:crypto';
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

  // passkeys, with a software authenticator: add one while signed in, then sign in with it alone
  const cbor = (v: any): Buffer => {
    const head = (major: number, n: number) => (n < 24 ? Buffer.from([(major << 5) | n]) : n < 256 ? Buffer.from([(major << 5) | 24, n]) : Buffer.from([(major << 5) | 25, n >> 8, n & 255]));
    if (typeof v === 'number') return v >= 0 ? head(0, v) : head(1, -1 - v);
    if (typeof v === 'string') return Buffer.concat([head(3, Buffer.byteLength(v)), Buffer.from(v)]);
    if (Buffer.isBuffer(v)) return Buffer.concat([head(2, v.length), v]);
    const es = v instanceof Map ? [...v] : Object.entries(v);
    return Buffer.concat([head(5, es.length), ...es.flatMap(([k, x]: any) => [cbor(k), cbor(x)])]);
  };
  const b64 = (b: Buffer) => b.toString('base64url');
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const jwk: any = publicKey.export({ format: 'jwk' });
  const credId = randomBytes(16);
  const rpHash = createHash('sha256').update('ok.test').digest();
  const clientData = (type: string, challenge: string, origin = 'http://ok.test') => Buffer.from(JSON.stringify({ type, challenge, origin, crossOrigin: false }));
  const C = (await call('/api/login', { username: 'cara', password: 'password' })).body.token;
  assert.equal((await call('/api/passkeys/register/begin', {}, C)).status, 400, 'passkeys need the site origin');
  const rb = await call('/api/passkeys/register/begin', {}, C, 'http://ok.test');
  assert.equal(rb.body.options.rp.id, 'ok.test');
  const cose = cbor(new Map<number, any>([[1, 2], [3, -7], [-1, 1], [-2, Buffer.from(jwk.x, 'base64url')], [-3, Buffer.from(jwk.y, 'base64url')]]));
  const regData = Buffer.concat([rpHash, Buffer.from([0x45]), Buffer.alloc(4), Buffer.alloc(16), Buffer.from([0, credId.length]), credId, cose]);
  const regResp = (cd: Buffer) => ({ id: b64(credId), rawId: b64(credId), type: 'public-key', clientExtensionResults: {}, response: { clientDataJSON: b64(cd), attestationObject: b64(cbor({ fmt: 'none', attStmt: {}, authData: regData })), transports: ['internal'] } });
  assert.equal((await call('/api/passkeys/register/finish', { flow: rb.body.flow, response: regResp(clientData('webauthn.create', 'wrong')), name: 'Phone' }, C, 'http://ok.test')).status, 400, 'wrong challenge refused');
  const rb2 = await call('/api/passkeys/register/begin', {}, C, 'http://ok.test');
  const rf = await call('/api/passkeys/register/finish', { flow: rb2.body.flow, response: regResp(clientData('webauthn.create', rb2.body.options.challenge)), name: 'Phone' }, C, 'http://ok.test');
  assert.equal(rf.status, 200, JSON.stringify(rf.body));
  assert.equal((await call('/api/me/security', undefined, C)).body.passkeys[0].name, 'Phone');
  const login = async (counter: number, origin = 'http://ok.test') => {
    const lb = await call('/api/passkeys/login/begin', {}, undefined, 'http://ok.test');
    const ad = Buffer.concat([rpHash, Buffer.from([0x05]), Buffer.from([0, 0, 0, counter])]);
    const cd = clientData('webauthn.get', lb.body.options.challenge, origin);
    const sig = ecSign('sha256', Buffer.concat([ad, createHash('sha256').update(cd).digest()]), privateKey);
    const response = { id: b64(credId), rawId: b64(credId), type: 'public-key', clientExtensionResults: {}, response: { clientDataJSON: b64(cd), authenticatorData: b64(ad), signature: b64(sig), userHandle: b64(Buffer.from('u4')) } };
    return call('/api/passkeys/login/finish', { flow: lb.body.flow, response }, undefined, 'http://ok.test');
  };
  const pl = await login(1);
  assert.equal(pl.status, 200, JSON.stringify(pl.body));
  assert.equal(pl.body.me, 'u4', 'the passkey signs Cara in');
  assert.equal((await login(1)).status, 401, 'a replayed counter is refused');
  assert.equal((await login(2, 'http://evil.test')).status, 401, 'a passkey used on another site is refused');
  assert.equal((await call('/api/passkeys/remove', { id: b64(credId) }, C)).status, 200, 'can remove when a password exists');
  assert.equal((await login(3)).status, 401, 'a removed passkey no longer works');

  // photos: JPEG only, metadata stripped, yours only
  const seg = (m: number, body: Buffer) => Buffer.concat([Buffer.from([0xff, m, (body.length + 2) >> 8, (body.length + 2) & 255]), body]);
  const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8]), seg(0xe0, Buffer.from('JFIF\0')), seg(0xe1, Buffer.from('Exif\0\0GPS 51.5N 0.1W')), seg(0xdb, Buffer.alloc(8, 1)), Buffer.from([0xff, 0xda, 0, 2, 9, 9, 9, 0xff, 0xd9])]);
  assert.equal((await call('/api/images', { data: Buffer.from('not a jpeg').toString('base64') }, gl.body.token)).status, 400, 'non-JPEG refused');
  const up = await call('/api/images', { data: jpeg.toString('base64') }, gl.body.token);
  assert.equal(up.status, 200, JSON.stringify(up.body));
  const got = Buffer.from(await (await fetch(base + '/api/images/' + up.body.id)).arrayBuffer());
  assert.ok(!got.includes(Buffer.from('GPS')) && got.includes(Buffer.from('JFIF')), 'EXIF stripped, the picture kept');
  assert.equal((await call('/api/act', { cmd: 'daily.answer', args: { option: 0, photo: up.body.id } }, C)).status, 400, 'someone else\'s photo refused');
  assert.equal((await call('/api/images/delete', { id: up.body.id }, gl.body.token)).status, 200);
  assert.equal((await fetch(base + '/api/images/' + up.body.id)).status, 404, 'a deleted photo is gone');

  // invitations: single-use, work with sign-ups closed, skip approval
  const RI = (await call('/api/login', { username: 'admin', password: 'password' })).body.token;
  assert.equal((await call('/api/admin/invites', { name: 'Dev' }, C)).status, 403, 'RO only');
  const inv = await call('/api/admin/invites', { name: 'Dev' }, RI);
  assert.equal(inv.status, 200, JSON.stringify(inv.body));
  assert.equal((await call('/api/invites/check?code=' + inv.body.code)).body.name, 'Dev');
  const joined = await call('/api/signup', { username: 'devp', display_name: 'Dev', password: 'a long enough passphrase', invite: inv.body.code });
  assert.equal(joined.status, 200, JSON.stringify(joined.body));
  assert.ok(joined.body.token, 'an invitation needs no approval');
  assert.equal((await call('/api/signup', { username: 'devp2', display_name: 'Dev 2', password: 'a long enough passphrase', invite: inv.body.code })).status, 403, 'an invitation works once');
  // duplicates: struck out, crowns moved, login off
  const dupId = joined.body.me;
  const keepBal = getWorld().accounts['c:u3'] || 0;
  assert.equal((await call('/api/act', { cmd: 'admin.duplicate', args: { dup: dupId, keep: 'u3' } }, RI)).status, 400, 'only through its own route');
  const dd = await call('/api/admin/duplicate', { dup: dupId, keep: 'u3' }, RI);
  assert.equal(dd.status, 200, JSON.stringify(dd.body));
  assert.equal(getWorld().citizens[dupId].active, false);
  assert.ok(getWorld().accounts['c:u3'] > keepBal, 'crowns moved');
  assert.equal((await call('/api/state', undefined, joined.body.token)).status, 401, 'the duplicate is signed out');
  assert.equal((await call('/api/login', { username: 'devp', password: 'a long enough passphrase' })).status >= 400, true, 'and cannot sign in');

  const out = await call('/api/logout-all', {}, gl.body.token);
  assert.equal((await call('/api/state', undefined, gl.body.token)).status, 401, 'sign out everywhere kills old tokens');
  assert.equal((await call('/api/state', undefined, out.body.token)).status, 200);
  console.log('server ok');
} finally {
  srv.close();
}
process.exit(0);
