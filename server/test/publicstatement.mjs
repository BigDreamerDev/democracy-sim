/* A foreign power's public statement — a press release, not a cable to the
   Republic. Two properties, in the order asserted:

     - it goes through the exact same action_kind allowlist every other
       foreign action does: 'public_statement' is accepted, an invented kind
       is refused exactly the same way a bogus kind is refused for 'dispatch';
     - once issued, it is readable on the public dispatch feed with NO auth at
       all — no diplomatic relationship, no officer login, nothing — which is
       the whole point of a wire statement as against a private cable. */

import { call, ok, report, setup } from './world.mjs';

const w = await setup({ citizens: 8 });
const A = w.admin.token;

await call('/api/admin/config', {
  method: 'PUT',
  body: { diplomacy_enabled: true, foreign_actions_per_cycle: 5 },
  token: A
});

const power = (await call('/api/admin/foreign/powers', {
  method: 'POST', body: { name: 'Republic of Kessendine', archetype: 'military_junta' }, token: A
})).d;

const gov = (await call(`/api/admin/foreign/powers/${power.id}/government`, { token: A })).d;
const seat = gov.agents[0];
const minister = w.citizens.find(c => c.display_name === 'Citizen 0');
await call(`/api/admin/foreign/agents/${seat.id}/seat`, { method: 'POST', body: { user_id: minister.id }, token: A });
const ministerTok = w.tok['Citizen 0'];

console.log('\n-- the allowlist');

const bogus = await call(`/api/diplomacy/foreign/${power.id}/agents/${seat.id}/act`, {
  method: 'POST',
  body: { action_kind: 'broadcast_propaganda', payload: {}, rationale: 'x' },
  token: ministerTok
});
ok(bogus.status === 400, `an invented action kind is refused before it touches anything (${bogus.status})`);

const stmt = await call(`/api/diplomacy/foreign/${power.id}/agents/${seat.id}/act`, {
  method: 'POST',
  body: {
    action_kind: 'public_statement',
    payload: { subject: 'On recent events', body: 'The government of Kessendine addresses the record.', idempotency_key: 'stmt-1' },
    rationale: 'a wire statement'
  },
  token: ministerTok
});
ok(stmt.status === 200 && stmt.d.action_kind === 'public_statement', `public_statement is an allowed kind (${stmt.status})`);

const turn = await call(`/api/admin/foreign/powers/${power.id}/run-turn`, { method: 'POST', token: A });
ok(turn.status === 200 && turn.d.chosen?.action_kind === 'public_statement', `the turn actually executes the statement through executeProposal (${turn.status})`);

console.log('\n-- readable by anyone, no auth, distinct from a private cable');

const feed = await call('/api/diplomacy/dispatches');
ok(feed.status === 200, 'the dispatch feed answers with no token at all');
const found = (feed.d || []).find(d => d.power_id === power.id && d.message_kind === 'public_statement');
ok(!!found, 'the statement appears on the public feed');
ok(found?.direction === 'public', `it is tagged with its own direction rather than incoming/outgoing (${found?.direction})`);
ok(found?.subject === 'On recent events', 'with the subject and body actually sent');

console.log('\n-- needs no diplomatic relationship or recognition first');

const unrecognisedPower = (await call('/api/admin/foreign/powers', {
  method: 'POST', body: { name: 'Free City of Norrath', archetype: 'military_junta' }, token: A
})).d;
const gov2 = (await call(`/api/admin/foreign/powers/${unrecognisedPower.id}/government`, { token: A })).d;
const seat2 = gov2.agents[0];
const minister2 = w.citizens.find(c => c.display_name === 'Citizen 1');
await call(`/api/admin/foreign/agents/${seat2.id}/seat`, { method: 'POST', body: { user_id: minister2.id }, token: A });
const stmt2 = await call(`/api/diplomacy/foreign/${unrecognisedPower.id}/agents/${seat2.id}/act`, {
  method: 'POST',
  body: {
    action_kind: 'public_statement',
    payload: { subject: 'Independence maintained', body: 'Norrath speaks for itself.', idempotency_key: 'stmt-2' },
    rationale: 'a wire statement'
  },
  token: w.tok['Citizen 1']
});
ok(stmt2.status === 200, `an unrecognised power may submit the action too (${stmt2.status})`);

const turn2 = await call(`/api/admin/foreign/powers/${unrecognisedPower.id}/run-turn`, { method: 'POST', token: A });
ok(
  turn2.status === 200 && turn2.d.chosen?.action_kind === 'public_statement',
  `an unrecognised power may still issue a public statement — it needs no relationship struck first (${turn2.status})`
);
const feed2 = await call('/api/diplomacy/dispatches');
const found2 = (feed2.d || []).find(d => d.power_id === unrecognisedPower.id && d.message_kind === 'public_statement');
ok(!!found2, 'and it too lands on the public feed');

report();
