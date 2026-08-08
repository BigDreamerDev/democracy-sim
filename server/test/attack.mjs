/* Attack suite. Every test here is a player trying to cheat. */
import jwt from 'jsonwebtoken';
import { call, ok, report, setup, PW } from './world.mjs';
const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');

const w = await setup();
const admin = w.admin;
const codes = (await call('/api/admin/invites', { method: 'POST', body: { count: 2, note: 'attack suite' }, token: admin.token })).d;
await call('/api/auth/register', { method: 'POST', body: { invite: codes[0], username: 'malloy', display_name: 'Mal', password: PW } });
for (const u of (await call('/api/admin/pending', { token: admin.token })).d)
  await call('/api/admin/approve', { method: 'POST', body: { user_id: u.id, approve: true }, token: admin.token });
const mal = (await call('/api/auth/login', { method: 'POST', body: { username: 'malloy', password: PW } })).d;
const victim = (await call('/api/auth/login', { method: 'POST', body: { username: 'cit0', password: PW } })).d;
ok(!!mal.token && !!victim.token, 'attacker and victim accounts ready');

console.log('\n-- forging identity');

// 1. unsigned "alg: none" token
const none = b64({ alg: 'none', typ: 'JWT' }) + '.' + b64({ id: 1, tv: 0 }) + '.';
ok((await call('/api/me', { token: none })).status === 401, 'alg:none token rejected');

// 2. valid token with the payload swapped to someone else
const [h, , sig] = mal.token.split('.');
const forged = h + '.' + b64({ id: victim.user.id, tv: 0 }) + '.' + sig;
ok((await call('/api/me', { token: forged })).status === 401, 'token with a swapped payload rejected');

// 3. token signed with a guessed secret
for (const guess of ['secret', 'change-me-in-render-env', 'republic', '']) {
  const t = jwt.sign({ id: victim.user.id, tv: 0 }, guess || 'x');
  ok((await call('/api/me', { token: t })).status === 401, `token signed with "${guess || '(empty)'}" rejected`);
}

// 4. junk in the header
ok((await call('/api/me', { token: 'Bearer' })).status === 401, 'malformed header rejected');
ok((await call('/api/me')).status === 401, 'no token rejected');

console.log('\n-- voting as someone else');

const el = (await call('/api/elections', { method: 'POST', body: { kind: 'referendum', title: 'Attack referendum' }, token: admin.token })).d;
await call(`/api/elections/${el.id}/stand`, { method: 'POST', body: { statement: 'A' }, token: mal.token });
await call(`/api/elections/${el.id}/stand`, { method: 'POST', body: { statement: 'B' }, token: victim.token });
await call(`/api/elections/${el.id}/status`, { method: 'POST', body: { status: 'voting' }, token: admin.token });
const cs = (await call(`/api/elections/${el.id}`, { token: mal.token })).d.candidates;

// 5. the body cannot name the voter — identity comes from the token alone
const spoof = await call(`/api/elections/${el.id}/vote`, {
  method: 'POST', token: mal.token,
  body: { candidacy_id: cs[0].id, voter_id: victim.user.id, user_id: victim.user.id, voter: 'cit0' }
});
ok(spoof.status === 200, 'attacker casts their own vote');
const after = (await call(`/api/elections/${el.id}`, { token: victim.token })).d;
ok(after.my_vote === null, 'victim still has an unused vote — the spoofed fields were ignored');

// 6. ten simultaneous ballots from one account
const flood = await Promise.all(Array.from({ length: 10 }, () =>
  call(`/api/elections/${el.id}/vote`, { method: 'POST', body: { candidacy_id: cs[0].id }, token: mal.token })));
ok(flood.every(r => r.status !== 200), 'ten concurrent ballots from one account all rejected');
const t1 = (await call(`/api/elections/${el.id}`, { token: admin.token })).d;
ok(t1.turnout === 1, 'turnout is exactly 1 after the flood');

// 7. voting for a candidate in a different election
const other = (await call('/api/elections', { method: 'POST', body: { kind: 'referendum', title: 'Other' }, token: admin.token })).d;
await call(`/api/elections/${other.id}/status`, { method: 'POST', body: { status: 'voting' }, token: admin.token });
const cross = await call(`/api/elections/${other.id}/vote`, { method: 'POST', body: { candidacy_id: cs[0].id }, token: victim.token });
ok(cross.status === 400, 'cannot vote for a candidacy belonging to another election');

// 8. injection through the candidacy id
for (const payload of ['1 OR 1=1', "1; DELETE FROM votes", { $ne: null }, [1, 2, 3]]) {
  const r = await call(`/api/elections/${el.id}/vote`, { method: 'POST', body: { candidacy_id: payload }, token: victim.token });
  ok(r.status >= 400, `injection payload ${JSON.stringify(payload)} rejected`);
}
ok((await call(`/api/elections/${el.id}`, { token: admin.token })).d.turnout === 1, 'votes table survived the injection attempts');

console.log('\n-- stuffing the roll');

// 9. an account made after the poll opened cannot vote in it
await call('/api/admin/config', { method: 'PUT', body: { require_approval: 'false' }, token: admin.token });
await call('/api/auth/register', { method: 'POST', body: { invite: codes[1], username: 'latecomer', display_name: 'Late', password: 'hunter22' } });
const late = (await call('/api/auth/login', { method: 'POST', body: { username: 'latecomer', password: 'hunter22' } })).d;
ok(!!late.token, 'sockpuppet created after the poll opened');
const lateVote = await call(`/api/elections/${el.id}/vote`, { method: 'POST', body: { candidacy_id: cs[0].id }, token: late.token });
ok(lateVote.status === 403, 'account created mid-poll is not on the roll');
await call('/api/admin/config', { method: 'PUT', body: { require_approval: 'true' }, token: admin.token });

// 10. a candidate cannot withdraw mid-poll to void ballots cast for them
ok((await call(`/api/elections/${el.id}/withdraw`, { method: 'POST', token: mal.token })).status === 400,
  'cannot withdraw once the poll is open');

console.log('\n-- climbing the ladder');

// 11. no self-promotion
ok((await call('/api/admin/user', { method: 'POST', body: { user_id: mal.user.id, is_admin: true }, token: mal.token })).status === 403,
  'ordinary citizen cannot make themselves admin');
ok((await call('/api/me', { method: 'PUT', body: { display_name: 'Mal', is_admin: true, approved: true }, token: mal.token })).status === 200,
  'profile update accepted');
ok((await call('/api/me', { token: mal.token })).d.is_admin === false, 'is_admin was ignored in the profile body');

// 12. no seizing office
ok((await call('/api/admin/office', { method: 'POST', body: { user_id: mal.user.id, office: 'president' }, token: mal.token })).status === 403,
  'cannot appoint yourself President');
ok((await call('/api/admin/config', { method: 'PUT', body: { seats: '99' }, token: mal.token })).status === 403,
  'cannot rewrite the rules');
ok((await call('/api/admin/invites', { method: 'POST', body: { count: 20 }, token: mal.token })).status === 403,
  'cannot mint invite codes');
ok((await call('/api/admin/pending', { token: mal.token })).status === 403, 'cannot see or approve the queue');

// 13. speaker and president powers are checked server side
const anyBill = (await call('/api/bills', { method: 'POST', body: { title: 'Attack bill', body: 'x' }, token: mal.token })).d;
ok((await call(`/api/bills/${anyBill.id}/table`, { method: 'POST', token: mal.token })).status === 403, 'cannot table a bill');
ok((await call(`/api/bills/${anyBill.id}/division`, { method: 'POST', token: mal.token })).status === 403, 'cannot call a division');
ok((await call(`/api/bills/${anyBill.id}/assent`, { method: 'POST', token: mal.token })).status === 403, 'cannot grant assent');

console.log('\n-- the secret ballot');

const leaky = JSON.stringify((await call(`/api/elections/${el.id}`, { token: mal.token })).d);
ok(!leaky.includes('voter_id'), 'election feed never exposes who voted for whom');
const rec = JSON.stringify((await call('/api/audit')).d);
ok(!/election\.vote[^"]*candidacy/.test(rec), 'the record logs that a vote happened, not what it was');

console.log('\n-- sessions');

// 14. changing a password kills the old session
const pw = await call('/api/me/password', { method: 'POST', body: { current: 'hunter22', next: 'newpass123' }, token: mal.token });
ok(pw.status === 200 && !!pw.d.token, 'password changed and a fresh token issued');
ok((await call('/api/me', { token: mal.token })).status === 401, 'the old token stopped working immediately');
ok((await call('/api/me', { token: pw.d.token })).status === 200, 'the new token works');

// 15. an admin reset also kills the target's sessions, and is written to the record
const reset = await call('/api/admin/user', { method: 'POST', body: { user_id: victim.user.id, reset_password: true }, token: admin.token });
ok(!!reset.d.temp_password, 'admin can reset a forgotten password');
ok((await call('/api/me', { token: victim.token })).status === 401, 'the reset logged the victim out');
const rec2 = (await call('/api/audit')).d;
ok(rec2.some(r => r.action === 'password.reset'), 'the reset is visible to everyone in the public record');

// 16. suspended accounts lose access at once
const suspend = (await call('/api/auth/login', { method: 'POST', body: { username: 'latecomer', password: 'hunter22' } })).d;
await call('/api/admin/user', { method: 'POST', body: { user_id: late.user.id, is_active: false }, token: admin.token });
ok((await call('/api/me', { token: suspend.token })).status === 401, 'a suspended citizen is cut off immediately');

console.log('\n-- brute force');
let blocked = false;
for (let i = 0; i < 14; i++) {
  const r = await call('/api/auth/login', { method: 'POST', body: { username: 'cit1', password: 'wrong' + i } });
  if (r.status === 429) { blocked = true; break; }
}
ok(blocked, 'repeated password guessing gets locked out');

report();
