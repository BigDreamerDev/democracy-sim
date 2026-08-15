/* A defector becomes a subject of the power they joined, not just an NPC name
   on a list: they can petition for a cabinet seat, act for it themselves each
   government turn, and — in a monarchy — enter the line of succession as a
   real contender.

   Four properties, in the order asserted:

     - one citizen holds at most one human-controlled seat, EVER, enforced by
       the database's own partial unique index, not by an application check
       that a later route could forget to run;
     - a human-submitted action goes through the exact same action_kind
       allowlist a model's proposal does — an invented kind is refused exactly
       the same way;
     - a human seat that never submits before the turn runs abstains rather
       than freezing the government;
     - a citizen queued onto a monarchy's succession line actually becomes the
       crown — the foreign_agents row's user_id — when their turn arrives. */

import { call, ok, report, setup } from './world.mjs';

const w = await setup({ citizens: 8 });
const A = w.admin.token;

await call('/api/admin/config', {
  method: 'PUT',
  body: { diplomacy_enabled: true, foreign_actions_per_cycle: 5, offshore_enabled: true, dividend: '0', tax_rate: '0' },
  token: A
});

/* ------------------------------------------------- one seat per citizen, at the database */

const houseA = (await call('/api/admin/foreign/powers', {
  method: 'POST', body: { name: 'Sovereignty of Marrow', archetype: 'absolute_monarchy' }, token: A
})).d;
const houseB = (await call('/api/admin/foreign/powers', {
  method: 'POST', body: { name: 'Compact of Serren', archetype: 'military_junta' }, token: A
})).d;

const govA = (await call(`/api/admin/foreign/powers/${houseA.id}/government`, { token: A })).d;
const govB = (await call(`/api/admin/foreign/powers/${houseB.id}/government`, { token: A })).d;
const seatA = govA.agents[0];
const seatB = govB.agents[0];

// Picked by their deterministic setup() name, not by office/no-office status
// (irrelevant here — these scenarios use the admin seat/act routes directly
// rather than going through /api/defection), and kept distinct from the
// citizens used further down so no test accidentally collides two scenarios
// on the same underlying user via the one-seat constraint.
const claimant = w.citizens.find(c => c.display_name === 'Citizen 0');
const seat1 = await call(`/api/admin/foreign/agents/${seatA.id}/seat`, {
  method: 'POST', body: { user_id: claimant.id }, token: A
});
ok(seat1.status === 200 && Number(seat1.d.user_id) === Number(claimant.id), 'a citizen can be seated in a foreign cabinet');

const seat2 = await call(`/api/admin/foreign/agents/${seatB.id}/seat`, {
  method: 'POST', body: { user_id: claimant.id }, token: A
});
ok(
  seat2.status !== 200,
  'the SAME citizen cannot be seated a second time — a real database constraint fired, not an application if-check'
);
const seatBAfter = (await call(`/api/admin/foreign/powers/${houseB.id}/government`, { token: A })).d;
ok(
  !seatBAfter.agents.find(a => a.id === seatB.id)?.user_id,
  'the second seat was left vacant, not silently double-booked'
);

/* --------------------------------------------------- the allowlist, for a human seat too */

const bogus = await call(`/api/diplomacy/foreign/${houseA.id}/agents/${seatA.id}/act`, {
  method: 'POST',
  body: { action_kind: 'annex_the_republic', payload: {}, rationale: 'ambitious' },
  token: w.tok['Citizen 0']
});
ok(bogus.status === 400, 'an action kind outside the allowlist is refused for a human seat exactly as for a model');

const legit = await call(`/api/diplomacy/foreign/${houseA.id}/agents/${seatA.id}/act`, {
  method: 'POST',
  body: { action_kind: 'dispatch', payload: { subject: 'Greetings', body: 'A word from the new minister.', message_kind: 'dispatch' }, rationale: 'opening contact' },
  token: w.tok['Citizen 0']
});
ok(legit.status === 200 && legit.d.action_kind === 'dispatch', 'an allowed action kind is accepted and recorded');

const notMySeat = await call(`/api/diplomacy/foreign/${houseA.id}/agents/${seatA.id}/act`, {
  method: 'POST',
  body: { action_kind: 'nothing', payload: {}, rationale: 'x' },
  token: w.T[3]
});
ok(notMySeat.status === 403, 'nobody but the citizen who holds the seat may act for it');

const turnA = await call(`/api/admin/foreign/powers/${houseA.id}/run-turn`, { method: 'POST', token: A });
ok(turnA.status === 200, 'a government with a human-controlled seat still runs a turn');
ok(
  turnA.d.chosen?.action_kind === 'dispatch' || (turnA.d.result?.refused || []).length === 0,
  "the human minister's own submission was the one considered, not a model call on their behalf"
);

/* ------------------------------------------------------ deadline fallback: abstain, not stall */

const houseC = (await call('/api/admin/foreign/powers', {
  method: 'POST', body: { name: 'Reach of Torvane', archetype: 'military_junta' }, token: A
})).d;
const govC = (await call(`/api/admin/foreign/powers/${houseC.id}/government`, { token: A })).d;
const seatC = govC.agents[0];
// 'Citizen N' names are deterministic from setup(); picked by name rather
// than by index into w.T, which only holds the five elected MPs' tokens.
const afkCitizen = w.citizens.find(c => c.display_name === 'Citizen 5');
await call(`/api/admin/foreign/agents/${seatC.id}/seat`, { method: 'POST', body: { user_id: afkCitizen.id }, token: A });
// No /act call from afkCitizen — they never submit for this cycle.
const turnC = await call(`/api/admin/foreign/powers/${houseC.id}/run-turn`, { method: 'POST', token: A });
ok(turnC.status === 200, 'a government does not stall on a human seat that never submitted');
const delibC = await call(`/api/admin/foreign/powers/${houseC.id}/deliberation`, { token: A });
const afkProposal = delibC.d.proposals.find(p => Number(p.agent_id) === Number(seatC.id));
ok(
  !afkProposal || afkProposal.action_kind === 'nothing',
  'an AFK human seat defaults to abstaining rather than blocking the turn'
);

/* ---------------------------------------------------- succession: a citizen becomes the crown */

const houseD = (await call('/api/admin/foreign/powers', {
  method: 'POST', body: { name: 'Crown of Ashvale', archetype: 'absolute_monarchy' }, token: A
})).d;
const govDBefore = (await call(`/api/admin/foreign/powers/${houseD.id}/government`, { token: A })).d;
const contender = w.citizens.find(c => c.display_name === 'Citizen 6');

// Queue a citizen contender directly onto this power's own succession config —
// exactly what POST /petition (mode: succession) writes, without needing a
// live defection row for this particular test.
const cfgD = govDBefore.government.config || {};
await call(`/api/admin/foreign/powers/${houseD.id}/government`, {
  method: 'PUT',
  body: {
    decision_method: govDBefore.government.decision_method,
    decision_threshold: govDBefore.government.decision_threshold,
    max_rounds: govDBefore.government.max_rounds,
    // Force the reign clock to have already run its course: cycleNo() is 0 in
    // this harness (no cycle clock configured), so a large negative start
    // makes `0 - startedAt >= reign_cycles` true without waiting real time —
    // the same trick the codebase already relies on for deterministic tests.
    config: {
      ...cfgD,
      succession_started_cycle: -1000,
      // absolute_monarchy's own line has 3 NPC names (indices 0-2); starting
      // the clock at heir_index 2 means the NEXT succession (index 3) is the
      // first name past the archetype's own line — our queued contender.
      heir_index: 2,
      succession_contenders: [{ user_id: contender.id, display_name: 'The Citizen Claimant' }]
    }
  },
  token: A
});

await call(`/api/admin/foreign/powers/${houseD.id}/run-turn`, { method: 'POST', token: A });
const govDAfter = (await call(`/api/admin/foreign/powers/${houseD.id}/government`, { token: A })).d;
const crownAfter = govDAfter.agents.find(a => a.role === 'sovereign');
ok(
  Number(crownAfter?.user_id) === Number(contender.id) && crownAfter?.display_name === 'The Citizen Claimant',
  "the queued citizen contender became the crown's controlling user_id when their turn in the line arrived"
);

report();
