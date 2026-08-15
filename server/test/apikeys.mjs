/* API keys: a citizen's delegated credential for a third-party app. The one
 * invariant that matters most — a read-only key is REJECTED by every write
 * route, not merely discouraged — is asserted by hand against two different
 * gates in the app: economy/transfer (requireScope, in economy.js) and
 * bills POST (the blanket block in auth(), server.js). Both have to hold,
 * because they're two different code paths reaching the same guarantee.
 */
import { call, ok, report, setup } from './world.mjs';

const w = await setup({ citizens: 7, parliament: false });
const T = w.admin.token;               // the founder's own JWT session
const otherUser = w.users[1].user.id;  // someone to pay, who isn't the founder

async function makeKey(scopes = [], cap) {
  const body = { label: 'test app ' + Math.random().toString(36).slice(2), scopes };
  if (cap) Object.assign(body, cap);
  const r = await call('/api/me/keys', { method: 'POST', body, token: T });
  return r.d;
}

console.log('\n-- creating and listing keys');
const readOnly = await makeKey();
ok(readOnly.key?.startsWith('rk_'), `raw key returned once, prefixed rk_ (${readOnly.key?.slice(0, 6)}...)`);
const listed = (await call('/api/me/keys', { token: T })).d;
ok(listed.some(k => k.id === readOnly.id), 'the new key shows up in the list');
ok(!('key' in listed[0]), 'the list never re-exposes the raw key');
ok(!('key_hash' in listed[0]), 'nor the hash');

console.log('\n-- a read-only key can read');
const meViaKey = await call('/api/economy/me', { token: readOnly.key });
ok(meViaKey.status === 200, `GET works with a bare key (${meViaKey.status})`);

console.log('\n-- and is rejected on every write route, traced by hand');
const xferAsReadOnly = await call('/api/economy/transfer', {
  method: 'POST', token: readOnly.key, body: { user_id: otherUser, amount: 10 }
});
ok(xferAsReadOnly.status === 403, `economy/transfer refuses a scopeless key (${xferAsReadOnly.status})`);

const billAsReadOnly = await call('/api/bills', {
  method: 'POST', token: readOnly.key, body: { title: 'x', kind: 'ordinary', body: 'x' }
});
ok(billAsReadOnly.status === 403, `POST /api/bills refuses a scopeless key too (${billAsReadOnly.status})`);

console.log('\n-- a scoped key succeeds within its cap, and is refused over it');
const payer = w.users[2];         // a citizen other than the founder, to isolate the cap to their key
const payerKey = (await call('/api/me/keys', {
  method: 'POST', token: payer.token,
  body: { label: 'the casino', scopes: ['economy:pay'], cap_amount: 100, cap_window_ms: 24 * 3600000 }
})).d;
// The payer needs something to pay with — the dividend, not a hand-written balance.
await call('/api/economy/payrun', {
  method: 'POST', token: T,
  body: { cycle_no: 1, dividend: true, tax: false, salaries: false, interest: false, banks: false, upkeep: false, conflicts: false, diplomacy: false, offshore: false }
});

const within = await call('/api/economy/transfer', {
  method: 'POST', token: payerKey.key, body: { user_id: otherUser, amount: 60 }
});
ok(within.status === 200, `first payment within the cap succeeds (${within.status})`);

const over = await call('/api/economy/transfer', {
  method: 'POST', token: payerKey.key, body: { user_id: otherUser, amount: 60 }
});
ok(over.status === 400, `a second payment that would push past the 100 cap is refused (${over.status})`);

const underAgain = await call('/api/economy/transfer', {
  method: 'POST', token: payerKey.key, body: { user_id: otherUser, amount: 30 }
});
ok(underAgain.status === 200, `a smaller payment that stays under the remaining cap still goes through (${underAgain.status})`);

console.log('\n-- revocation takes effect immediately');
const revoke = await call(`/api/me/keys/${payerKey.id}/revoke`, { method: 'POST', token: payer.token });
ok(revoke.status === 200, `revoke succeeds (${revoke.status})`);
const afterRevoke = await call('/api/economy/me', { token: payerKey.key });
ok(afterRevoke.status === 401, `the revoked key is refused on the very next request (${afterRevoke.status})`);

console.log('\n-- the Returning Officer can revoke anyone\'s key, same precedent as a password reset');
const anotherKey = await makeKey();
const roRevoke = await call(`/api/admin/keys/${anotherKey.id}/revoke`, { method: 'POST', token: T });
ok(roRevoke.status === 200, `admin revoke works (${roRevoke.status})`);
const plainAdminAttempt = await call(`/api/admin/keys/${readOnly.id}/revoke`, { method: 'POST', token: w.users[3].token });
ok(plainAdminAttempt.status === 403, `an ordinary citizen may not use the admin revoke route (${plainAdminAttempt.status})`);

console.log('\n-- a key can never mint or revoke keys, or act as the RO, on its own');
const keyMintsKey = await call('/api/me/keys', { method: 'POST', token: readOnly.key, body: { label: 'nested' } });
ok(keyMintsKey.status === 403, `a key cannot create another key (${keyMintsKey.status})`);
const keyAsAdmin = await call('/api/admin/invites', { method: 'POST', token: readOnly.key, body: { count: 1 } });
ok(keyAsAdmin.status === 403, `a key cannot use an admin route even if its owner is the RO (${keyAsAdmin.status})`);

report();
