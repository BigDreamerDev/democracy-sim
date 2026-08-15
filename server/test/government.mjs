/* Foreign governments: archetypes, one-button creation, the scripted mock, key
   validation, and the deliberation the Returning Officer reads.

   The suite that matters most here is the allowlist. Player-authored prose
   reaches these models, so a government that could name its own action kind is
   a government players could talk into anything. `mock:invalid-action` returns
   an action kind the controller has never heard of, and this asserts that
   nothing is written when it does. */
import { createRequire } from 'module';
import { setup, call, ok, report } from './world.mjs';

/* Pure catalogue logic — decision machinery, refusals, council backing,
   succession — is data plus small functions in llm/archetypes.js and does not
   need a running turn to check. Requiring it directly tests the exact module
   diplomacy.js runs, not a copy. */
const require = createRequire(import.meta.url);
const archetypes = require('../llm/archetypes.js');

const w = await setup();
const A = w.admin.token;
await call('/api/admin/config', {
  method: 'PUT',
  body: { diplomacy_enabled: true, foreign_actions_per_cycle: 5 },
  token: A
});

/* ------------------------------------------------------------- the catalogue */

const cat = await call('/api/admin/foreign/archetypes', { token: A });
ok(
  cat.status === 200 && cat.d.archetypes.length === archetypes.IDS.length,
  'the console publishes exactly the archetypes the catalogue defines'
);
const byId = Object.fromEntries(cat.d.archetypes.map(a => [a.id, a]));
ok(
  byId.military_junta && byId.merchant_republic && byId.absolute_monarchy && byId.one_party_state &&
    byId.theocracy && byId.federal_democracy && byId.revolutionary_council && byId.technocracy,
  'the catalogue holds every original archetype the roadmap asked for'
);
ok(
  byId.constitutional_monarchy && byId.theocratic_monarchy && byId.oligarchy &&
    byId.military_dictatorship && byId.tribal_confederation,
  'the catalogue holds every archetype added on top of the original eight'
);
ok(
  cat.d.archetypes.length >= 13,
  'the catalogue has grown past the original eight, not just renamed them'
);

/* ---------------------------------------------------- mechanical distinctness

   The roadmap's condition on a new archetype: a real decision method, not a
   costume. Checked here against the catalogue the console actually reads, so
   a change to one archetype that quietly makes it identical to another is
   caught without needing a live turn. */
ok(
  new Set(cat.d.archetypes.map(a => a.decision_method)).size === 4,
  'archetypes use all four decision methods the controller implements, not a subset'
);
ok(
  byId.military_junta.decision_method === 'weighted' && byId.military_dictatorship.decision_method === 'executive',
  'a junta (a committee of officers) and a dictatorship (one man) are mechanically distinct, not a junta with new flavour text'
);
ok(
  byId.absolute_monarchy.council == null && byId.constitutional_monarchy.council?.min_share === 0.5,
  'an absolute crown answers to no council; a constitutional one needs the ministry\'s backing to bind the realm'
);
ok(
  byId.theocratic_monarchy.decision_method === 'consensus' && byId.absolute_monarchy.decision_method === 'executive',
  'the three monarchies decide differently from one another, not just narrate differently'
);
ok(
  byId.tribal_confederation.decision_method === 'consensus' &&
    byId.tribal_confederation.decision_threshold < byId.theocracy.decision_threshold,
  'a confederation uses the same consensus method as a theocracy at a deliberately low bar, so it acts fast rather than stalling'
);
ok(
  byId.military_junta.posture === 'escalate' && byId.federal_democracy.posture === 'stall',
  'a junta escalates under pressure and a federal democracy stalls'
);
ok(
  byId.theocracy.actions_per_cycle === 1 && byId.military_junta.actions_per_cycle === 3,
  'archetypes differ in how fast they may act, not only in how they talk'
);
ok(
  byId.theocracy.refusals.some(r => /holy/i.test(r.why)) &&
    byId.merchant_republic.refusals.some(r => /war/i.test(r.why)),
  'each archetype publishes what it will never do'
);
ok(
  cat.d.archetypes.every(a => ['executive', 'cabinet', 'weighted', 'consensus'].includes(a.decision_method)),
  'every archetype decides by a method the controller already implements'
);
ok(
  cat.d.default_agent?.provider === 'mock',
  'with no API key configured, a new cabinet is given the scripted mock rather than a dead provider'
);

/* -------------------------------------------------------- one-button creation */

const made = await call('/api/admin/foreign/powers', {
  method: 'POST',
  body: { name: 'Karsine Directorate', archetype: 'military_junta', strength: 'strong' },
  token: A
});
ok(
  made.status === 200 && made.d.key?.startsWith('fp_') && made.d.government?.ministers === 3,
  'name, archetype and rough strength is the whole of creating a working foreign power'
);
const junta = made.d;
ok(
  junta.government.provider === 'mock' && junta.government.decision_method === 'weighted',
  'creation configures the models itself — model configuration is optional, never required'
);
const juntaGov = await call(`/api/admin/foreign/powers/${junta.id}/government`, { token: A });
ok(
  juntaGov.d.agents.length === 3 && juntaGov.d.agents.every(a => a.system_prompt.length > 40),
  'the cabinet arrives with roles and written instructions, none of them typed by the operator'
);
ok(juntaGov.d.archetype?.id === 'military_junta', 'the console can read back which government a power has');

const badArch = await call('/api/admin/foreign/powers', {
  method: 'POST',
  body: { name: 'Nowhere', archetype: 'benevolent_dictatorship' },
  token: A
});
ok(badArch.status === 400, 'an unknown archetype is refused rather than silently creating a power with no government');

const bare = await call('/api/admin/foreign/powers', { method: 'POST', body: { name: 'Old Style' }, token: A });
ok(bare.status === 200 && bare.d.government === null, 'creating without an archetype still works, for a hand-built government');

/* ------------------------------------------------------ the mock actually plays */

const theo = (
  await call('/api/admin/foreign/powers', {
    method: 'POST',
    body: { name: 'Hierarchy of Sel', archetype: 'theocracy' },
    token: A
  })
).d;
/* A minister whose model returns an action this government has sworn never to
   take. The archetype has to stop it; nothing else will. */
await call(`/api/admin/foreign/powers/${theo.id}/agents`, {
  method: 'POST',
  body: { role: 'tempter', display_name: 'The Tempter', model_provider: 'mock', model_name: 'mock:holy-sites' },
  token: A
});
const theoTurn = await call(`/api/admin/foreign/powers/${theo.id}/run-turn`, { method: 'POST', token: A });
ok(
  theoTurn.status === 200 && theoTurn.d.chosen?.action_kind === 'dispatch',
  'an unconfigured world is not a dead world: the scripted mock proposes and carries a real action'
);
ok(
  (theoTurn.d.result?.refused || []).some(r => /holy sites/i.test(r)),
  'a theocracy does not sell its holy sites, whatever its minister proposed'
);
const publicDispatches = await call('/api/diplomacy/dispatches');
ok(
  publicDispatches.d.some(d => Number(d.power_id) === Number(theo.id) && d.direction === 'incoming'),
  'the mock government actually writes to the public record — the turn is not a no-op'
);
const noOffer = await call('/api/diplomacy/offers');
ok(
  !noOffer.d.some(o => Number(o.power_id) === Number(theo.id)),
  'the refused offer was never written, only noted'
);

/* The archetype narrows the Republic's own limit and can never widen it. The
   theocracy has spent its single action of the cycle on the turn above, while
   foreign_actions_per_cycle is 5. */
const theoSecond = await call('/api/foreign/dispatches', {
  method: 'POST',
  body: { subject: 'Second word', body: 'A second action in the same cycle.', idempotency_key: 'theo-2' },
  token: `Foreign ${theo.key}`,
  raw: true
});
ok(theoSecond.status === 429, 'a theocracy gets one action a cycle even where the Republic allows five');

/* -------------------------------------------- the allowlist, on every path */

const rogue = (await call('/api/admin/foreign/powers', { method: 'POST', body: { name: 'Rogue Assembly' }, token: A })).d;
await call(`/api/admin/foreign/powers/${rogue.id}/government`, {
  method: 'PUT',
  body: { decision_method: 'executive', decision_threshold: 0.5, max_rounds: 1 },
  token: A
});
await call(`/api/admin/foreign/powers/${rogue.id}/agents`, {
  method: 'POST',
  body: { role: 'director', display_name: 'The Director', model_provider: 'mock', model_name: 'mock:invalid-action' },
  token: A
});
const rogueTurn = await call(`/api/admin/foreign/powers/${rogue.id}/run-turn`, { method: 'POST', token: A });
ok(rogueTurn.status === 200, 'an invented action kind does not crash the turn');
ok(
  rogueTurn.d.chosen === null && rogueTurn.d.result?.status === 'nothing',
  'a model response naming an action kind outside the allowlist carries nothing'
);
ok(
  (rogueTurn.d.result?.refused || []).some(r => /unknown action kind/i.test(r)),
  'the discarded proposal is reported rather than swallowed'
);
const rogueDelib = await call(`/api/admin/foreign/powers/${rogue.id}/deliberation`, { token: A });
ok(
  rogueDelib.status === 200 && rogueDelib.d.proposals.length === 0,
  'nothing is written to foreign_agent_proposals for an action kind the controller does not recognise'
);
const afterRogue = await call('/api/diplomacy/dispatches');
ok(
  !afterRogue.d.some(d => Number(d.power_id) === Number(rogue.id)),
  'and nothing reaches the Republic either'
);
const malformed = (await call('/api/admin/foreign/powers', { method: 'POST', body: { name: 'Silent Bloc' }, token: A })).d;
await call(`/api/admin/foreign/powers/${malformed.id}/government`, {
  method: 'PUT',
  body: { decision_method: 'executive', decision_threshold: 0.5, max_rounds: 1 },
  token: A
});
await call(`/api/admin/foreign/powers/${malformed.id}/agents`, {
  method: 'POST',
  body: { role: 'director', display_name: 'The Director', model_provider: 'mock', model_name: 'mock:malformed' },
  token: A
});
const malformedTurn = await call(`/api/admin/foreign/powers/${malformed.id}/run-turn`, { method: 'POST', token: A });
ok(
  malformedTurn.status === 200 && malformedTurn.d.chosen === null,
  'a response with no action_kind at all is discarded by the same check'
);

/* ------------------------------ archetypes change mechanics, not just prompts

   One model output — `mock:war`, a declaration of war regardless of anything —
   put to two different governments. The junta declares. The federal democracy
   refuses, because the dispute has not escalated and its assembly has not
   voted. Same words in, different act out: that is the whole claim. */

async function recognise(powerId) {
  const rec = (await call(`/api/diplomacy/powers/${powerId}/recognition`, { method: 'POST', token: w.T[0] })).d;
  for (const t of [w.T[1], w.T[2]]) await call(`/api/bills/${rec.id}/second`, { method: 'POST', token: t });
  await call(`/api/bills/${rec.id}/table`, { method: 'POST', token: w.spk });
  await call(`/api/bills/${rec.id}/division`, { method: 'POST', token: w.spk });
  for (const t of w.T) await call(`/api/bills/${rec.id}/vote`, { method: 'POST', body: { vote: 'aye' }, token: t });
  await call(`/api/bills/${rec.id}/close`, { method: 'POST', token: w.spk });
  await call(`/api/bills/${rec.id}/assent`, { method: 'POST', token: w.pres });
}

await recognise(junta.id);
await call(`/api/admin/foreign/powers/${junta.id}/agents`, {
  method: 'POST',
  body: { role: 'firebrand', display_name: 'The Firebrand', model_provider: 'mock', model_name: 'mock:war' },
  token: A
});
const juntaTurn = await call(`/api/admin/foreign/powers/${junta.id}/run-turn`, { method: 'POST', token: A });
ok(
  juntaTurn.d.chosen?.action_kind === 'declare',
  'a weighted junta carries its hawks: the declaration wins on vote weight'
);
const juntaConflicts = await call('/api/diplomacy/conflicts');
ok(
  juntaConflicts.d.some(x => Number(x.power_id) === Number(junta.id) && x.kind === 'war'),
  'and the declaration becomes a motion before the House, like every other binding act'
);

const fed = (
  await call('/api/admin/foreign/powers', {
    method: 'POST',
    body: { name: 'Union of Marrow', archetype: 'federal_democracy' },
    token: A
  })
).d;
await call(`/api/admin/foreign/powers/${fed.id}/agents`, {
  method: 'POST',
  body: { role: 'firebrand', display_name: 'The Firebrand', model_provider: 'mock', model_name: 'mock:war' },
  token: A
});
const fedTurn = await call(`/api/admin/foreign/powers/${fed.id}/run-turn`, { method: 'POST', token: A });
ok(
  fedTurn.d.chosen?.action_kind !== 'declare',
  'the same model output does not carry in a federal democracy'
);
ok(
  (fedTurn.d.result?.refused || []).some(r => /assembly|escalat/i.test(r)),
  'and the government says why it refused, in the record'
);

const crown = (
  await call('/api/admin/foreign/powers', {
    method: 'POST',
    body: { name: 'Crown of Vess', archetype: 'absolute_monarchy' },
    token: A
  })
).d;
await recognise(crown.id);
await call(`/api/admin/foreign/powers/${crown.id}/agents`, {
  method: 'POST',
  body: { role: 'flatterer', display_name: 'The Flatterer', model_provider: 'mock', model_name: 'mock:tribute' },
  token: A
});
const crownTurn = await call(`/api/admin/foreign/powers/${crown.id}/run-turn`, { method: 'POST', token: A });
ok(
  (crownTurn.d.result?.refused || []).some(r => /tribute/i.test(r)),
  'the Crown does not pay tribute, whichever minister drafted the instrument'
);
const crownTreaties = await call('/api/diplomacy/treaties');
ok(
  !crownTreaties.d.some(t => Number(t.power_id) === Number(crown.id) && Number(t.terms?.tribute_per_cycle) > 0),
  'and no tribute treaty was ever put before the House'
);

/* --------------------------------------------------------- succession, real

   Not flavour text: the crown installed on day one is the FIRST name in the
   archetype's line, and the government row carries where the reign clock
   started — the two facts diplomacy.js needs to hand the throne on without
   the console ever telling it to. */
const crownGov = await call(`/api/admin/foreign/powers/${crown.id}/government`, { token: A });
const crownAgent = crownGov.d.agents.find(a => a.role === 'sovereign');
ok(
  crownAgent?.display_name === 'The Widowed Regent',
  'a newly installed monarchy starts with the first name in its succession line, not a generic placeholder'
);
ok(
  crownGov.d.government.config?.heir_index === 0 && Number.isFinite(crownGov.d.government.config?.succession_started_cycle),
  'the reign clock is written down at installation so a later turn can tell when it started'
);
ok(
  crownGov.d.archetype?.succession?.heirs?.length === 3 && crownGov.d.archetype.succession.crown_role === 'sovereign',
  'the console can read the whole line of succession, not just who currently reigns'
);

/* -------------------------------------------------------------- the council

   A constitutional crown's declaration only binds the realm if the ministry
   actually backed it. Checked here as the pure requirement diplomacy.js
   consults after a vote, since driving the scripted mock to a specific
   council split turn-by-turn would make this test depend on vote-preference
   internals rather than on the mechanic itself. */
ok(
  archetypes.councilRequirement('constitutional_monarchy', 'declare')?.roles.includes('first_minister'),
  'a constitutional crown cannot declare without its first minister among the roles counted'
);
ok(
  archetypes.councilRequirement('absolute_monarchy', 'declare') === null,
  'an absolute crown has no council to answer to — the absence is the archetype'
);
ok(
  archetypes.councilRequirement('constitutional_monarchy', 'dispatch') === null,
  'the council only binds the acts that actually bind the realm, not a letter'
);

/* ---------------------------------------------------------- monarchy posture

   A crown's answer to pressure is neither a junta's escalation nor a
   democracy's stall — it spends legitimacy first and only reaches for force
   once that has stopped working. */
ok(
  archetypes.posturePriorityBias('absolute_monarchy', 'treaty', { pressure: 20 }) >
    archetypes.posturePriorityBias('military_junta', 'treaty', { pressure: 20 }),
  'under low pressure a crown favours a negotiated settlement more than a junta does'
);
ok(
  archetypes.posturePriorityBias('absolute_monarchy', 'declare', { pressure: 90 }) >
    archetypes.posturePriorityBias('absolute_monarchy', 'declare', { pressure: 20 }),
  'a crown only reaches for a declaration once pressure is near the top of the scale'
);

/* ------------------------------------------------- the deliberation, visible */

const delib = await call(`/api/admin/foreign/powers/${junta.id}/deliberation`, { token: A });
ok(delib.status === 200 && delib.d.proposals.length >= 2, 'the console can read what every minister proposed');
ok(
  delib.d.proposals.every(p => Array.isArray(p.voters) && typeof p.weight === 'number'),
  'each proposal carries who voted for it and what their votes weighed'
);
ok(
  delib.d.proposals.filter(p => p.carried).length === 1,
  'exactly one proposal is marked as having carried'
);
ok(
  delib.d.proposals.find(p => p.carried)?.weight >= 3,
  'a weighted government is legibly weighted — the carried proposal shows the weight behind it'
);
const turnsList = await call(`/api/admin/foreign/powers/${junta.id}/turns`, { token: A });
ok(
  turnsList.d[0]?.proposal_count >= 2 && turnsList.d[0]?.result?.status,
  'the turn list says what came of each turn, not only that one happened'
);

/* ---------------------------------------------------- keys, tested at save time */

const mockProbe = await call('/api/admin/foreign/llm-test', {
  method: 'POST',
  body: { model_provider: 'mock', model_name: 'mock' },
  token: A
});
ok(mockProbe.status === 200 && mockProbe.d.ok === true, 'the mock provider reports plainly that it works');

const noKey = await call('/api/admin/foreign/llm-test', {
  method: 'POST',
  body: { model_provider: 'groq', model_name: 'llama-3.1-8b-instant' },
  token: A
});
ok(
  noKey.d.ok === false && /GROQ_API_KEY/.test(noKey.d.hint || ''),
  'a missing key names the environment variable to set, instead of failing through four providers'
);

const badModel = await call('/api/admin/foreign/llm-test', {
  method: 'POST',
  body: { model_provider: 'groq', model_name: 'gpt-9-ultra' },
  token: A
});
ok(
  badModel.d.ok === false && /allowlist/i.test(badModel.d.error || ''),
  'a model outside the free allowlist is named as the problem before any call is made'
);

const paid = await call('/api/admin/foreign/llm-test', {
  method: 'POST',
  body: { model_provider: 'openai', model_name: 'gpt-5' },
  token: A
});
ok(
  paid.d.ok === false && /free/i.test(paid.d.error || ''),
  'this build stays hard-locked to free providers and says so'
);

const audit = await call('/api/audit');
ok(
  audit.d.some(a => a.action === 'foreign.archetype.apply') && audit.d.some(a => a.action === 'foreign.llm.test'),
  'installing a government and testing a key are both written to the public record'
);

report();
