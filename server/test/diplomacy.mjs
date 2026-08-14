import { setup, call, ok, report } from './world.mjs';

const w = await setup();
await call('/api/admin/config', { method:'PUT', body:{ diplomacy_enabled:true, foreign_actions_per_cycle:20 }, token:w.admin.token });

const made = await call('/api/admin/foreign/powers', { method:'POST', body:{ name:'Valtish Directorate', adjective:'Valtish', persona:{ temperament:'pragmatic' } }, token:w.admin.token });
ok(made.status === 200 && made.d.key?.startsWith('fp_'), 'admin mints a foreign power and one-time key');
const power = made.d;
const F = power.key;

const state = await call('/api/foreign/state', { token:`Foreign ${F}`, raw:true });
ok(state.status === 200 && state.d.recognised === false && Array.isArray(state.d.laws), 'foreign key reads the narrow public state');

const badTreaty = await call('/api/foreign/treaties', { method:'POST', body:{ title:'Early treaty', articles:'No.', idempotency_key:'early-1' }, token:`Foreign ${F}`, raw:true });
ok(badTreaty.status === 403, 'unrecognised power cannot propose treaties');

const d1 = await call('/api/foreign/dispatches', { method:'POST', body:{ subject:'First contact', body:'Greetings from Valtis.', idempotency_key:'hello-1' }, token:`Foreign ${F}`, raw:true });
const d2 = await call('/api/foreign/dispatches', { method:'POST', body:{ subject:'First contact', body:'Greetings from Valtis.', idempotency_key:'hello-1' }, token:`Foreign ${F}`, raw:true });
ok(d1.status === 200 && d1.d.id === d2.d.id, 'dispatch idempotency prevents duplicate retries');

const citizenMessage = await call('/api/diplomacy/dispatches', { method:'POST', body:{power_id:power.id,message_kind:'treaty_proposal',subject:'Private attempt',body:'I propose a treaty.'}, token:w.plainTok });
ok(citizenMessage.status === 403, 'ordinary citizens cannot conduct official state-to-state diplomacy');
const officialMessage = await call('/api/diplomacy/dispatches', { method:'POST', body:{power_id:power.id,message_kind:'treaty_proposal',subject:'Republic proposal',body:'The Republic proposes talks on a future trade treaty.'}, token:w.pres });
ok(officialMessage.status === 200 && officialMessage.d.direction === 'outgoing' && officialMessage.d.message_kind === 'treaty_proposal', 'President can initiate a plaintext official treaty proposal');
const officialReply = await call(`/api/diplomacy/dispatches/${d1.d.id}/reply`, { method:'POST', body:{subject:'Re: First contact',body:'The Republic welcomes formal talks.'}, token:w.pres });
ok(officialReply.status === 200 && Number(officialReply.d.in_reply_to) === Number(d1.d.id), 'official replies are threaded to the foreign message');
const auditAfterMessage = await call('/api/audit');
ok(auditAfterMessage.d.some(a => a.action === 'foreign.message.send') && auditAfterMessage.d.some(a => a.action === 'foreign.reply'), 'official government diplomacy is written to the public record');

const rec = await call(`/api/diplomacy/powers/${power.id}/recognition`, { method:'POST', token:w.T[0] });
ok(rec.status === 200 && rec.d.kind === 'recognition', 'Republic proposes recognition as a bill');
for (const t of [w.T[1], w.T[2]]) await call(`/api/bills/${rec.d.id}/second`, { method:'POST', token:t });
await call(`/api/bills/${rec.d.id}/table`, { method:'POST', token:w.spk });
await call(`/api/bills/${rec.d.id}/division`, { method:'POST', token:w.spk });
for (const t of w.T) await call(`/api/bills/${rec.d.id}/vote`, { method:'POST', body:{vote:'aye'}, token:t });
await call(`/api/bills/${rec.d.id}/close`, { method:'POST', token:w.spk });
await call(`/api/bills/${rec.d.id}/assent`, { method:'POST', token:w.pres });
const powers = await call('/api/diplomacy/powers');
ok(powers.d.find(p=>p.id===power.id)?.recognised === true, 'assenting recognition marks the power recognised');

const treaty = await call('/api/foreign/treaties', { method:'POST', body:{ title:'Treaty of the Long Table', articles:'1. Trade shall be open.', terms:{trade_open:true, tribute_per_cycle:5}, idempotency_key:'treaty-1' }, token:`Foreign ${F}`, raw:true });
ok(treaty.status === 200 && treaty.d.bill_ref, 'foreign treaty proposal becomes a Republic bill');
const tb = (await call('/api/bills')).d.find(b=>b.ref===treaty.d.bill_ref);
for (const t of [w.T[1], w.T[2]]) await call(`/api/bills/${tb.id}/second`, { method:'POST', token:t });
await call(`/api/bills/${tb.id}/table`, { method:'POST', token:w.spk });
await call(`/api/bills/${tb.id}/division`, { method:'POST', token:w.spk });
for (const t of w.T) await call(`/api/bills/${tb.id}/vote`, { method:'POST', body:{vote:'aye'}, token:t });
const closed = await call(`/api/bills/${tb.id}/close`, { method:'POST', token:w.spk });
ok(closed.d.carried === true, 'treaty uses the treaty division threshold');
await call(`/api/bills/${tb.id}/assent`, { method:'POST', token:w.pres });
const rat = await call(`/api/foreign/treaties/${treaty.d.id}/ratify`, { method:'POST', body:{idempotency_key:'ratify-1'}, token:`Foreign ${F}`, raw:true });
ok(rat.status === 200 && rat.d.foreign_ratified_at, 'foreign ratification completes its side of the treaty');

const offer = await call('/api/foreign/offers', { method:'POST', body:{title:'Valtish tea',price:20,stock:2,idempotency_key:'offer-1'}, token:`Foreign ${F}`, raw:true });
ok(offer.status === 200, 'recognised treaty partner can create a trade offer');
await call('/api/economy/payrun', { method:'POST', body:{cycle_no:77,tax:false,salaries:false,interest:false}, token:w.admin.token });
const buy = await call(`/api/diplomacy/offers/${offer.d.id}/buy`, { method:'POST', token:w.plainTok });
ok(buy.status === 200 && buy.d.price === 20 && buy.d.tax === 2, 'citizen import charges price plus configured foreign trade tax');
const bal = await call('/api/foreign/balance', { token:`Foreign ${F}`, raw:true });
ok(Number(bal.d.imports) === 20 && Number(bal.d.net) === -20, 'balance of trade records the import');

const decl = await call('/api/foreign/declare', { method:'POST', body:{kind:'ultimatum',grievance:'Tariffs are unacceptable.',demands:'Reduce them.',idempotency_key:'ult-1'}, token:`Foreign ${F}`, raw:true });
ok(decl.status === 200 && decl.d.bill_ref, 'foreign ultimatum creates a motion before the House');
const resolved = await call(`/api/admin/foreign/conflicts/${decl.d.id}/resolve`, { method:'POST', body:{outcome:'Republic prevailed',citation:'Match result #12'}, token:w.admin.token });
ok(resolved.status === 200 && resolved.d.status === 'resolved', 'admin records externally resolved conflict with citation');

await call(`/api/admin/foreign/powers/${power.id}/government`, { method:'PUT', body:{decision_method:'cabinet',decision_threshold:0.5,max_rounds:1}, token:w.admin.token });
const llmPolicy = await call('/api/admin/foreign/llm-policy', { token:w.admin.token });
ok(llmPolicy.status === 200 && llmPolicy.d.free_only === true && llmPolicy.d.paid_providers_disabled.includes('openai'), 'free-only LLM policy is enabled by default');
const paidAgent = await call(`/api/admin/foreign/powers/${power.id}/agents`, { method:'POST', body:{role:'paid_test',display_name:'Paid Test',model_provider:'openai',model_name:'gpt-5'}, token:w.admin.token });
ok(paidAgent.status === 400, 'free-only mode refuses paid provider configurations');
const paidRouter = await call(`/api/admin/foreign/powers/${power.id}/agents`, { method:'POST', body:{role:'router_test',display_name:'Router Test',model_provider:'openrouter',model_name:'some/paid-model'}, token:w.admin.token });
ok(paidRouter.status === 400, 'free-only mode refuses non-free OpenRouter models');
for (const [role,name] of [['director','Director Karsen'],['foreign_minister','Minister Vel'],['finance_minister','Minister Oran']]) {
  await call(`/api/admin/foreign/powers/${power.id}/agents`, { method:'POST', body:{role,display_name:name,model_provider:'mock',model_name:'mock'}, token:w.admin.token });
}
const turn = await call(`/api/admin/foreign/powers/${power.id}/run-turn`, { method:'POST', token:w.admin.token });
ok(turn.status === 200 && turn.d.turn_id, 'multi-agent government runs a structured cabinet turn');
const turns = await call(`/api/admin/foreign/powers/${power.id}/turns`, { token:w.admin.token });
ok(turns.d.length === 1, 'database constraint permits one government turn per power per cycle');

const rotated = await call(`/api/admin/foreign/powers/${power.id}/rotate-key`, { method:'POST', token:w.admin.token });
ok(rotated.status === 200 && rotated.d.key?.startsWith(`fp_${power.id}_`), 'Returning Officer can rotate a foreign credential');
const oldKeyAfterRotate = await call('/api/foreign/state', { token:`Foreign ${F}`, raw:true });
ok(oldKeyAfterRotate.status === 401, 'rotating a key invalidates the previous foreign credential');
const auditAfterRotate = await call('/api/audit');
ok(auditAfterRotate.d.some(a => a.action === 'foreign.power.key.rotate'), 'Returning Officer credential rotation is written to the public record');

report();
