/* Editing and withdrawing a bill.

   `withdrawn` sat in the schema comment and the front end's status colours from
   the beginning, and nothing set it — so a typo in a bill was permanent, and
   the only remedy was a second bill correcting the first. Nineteen people
   drafting on phones deserve better than that.

   The two rules that keep it honest: nothing changes once a division is called,
   because people are voting on a text; and an edit clears the seconds, because
   a signature was for the text that was signed. */

import { call, ok, report, setup } from './world.mjs';

const w = await setup({ citizens: 8 });
const T = w.admin.token;
const mk = (token, body) => call('/api/bills', { method: 'POST', body: { kind: 'motion', ...body }, token });
const get = id => call(`/api/bills/${id}`).then(r => r.d);

console.log('-- a proposer may fix their own draft');

let b = (await mk(w.T[0], { title: 'Teh Straits Motion', body: 'That the House regrest the blockade.' })).d;
ok(b.status === 'draft', 'a new bill starts as a draft');
ok((await call(`/api/bills/${b.id}`, { method: 'PATCH', body: { title: 'The Straits Motion', body: 'That the House regrets the blockade.' }, token: w.T[1] })).status === 403,
  'another member cannot edit it');
const ed = await call(`/api/bills/${b.id}`, { method: 'PATCH', body: { title: 'The Straits Motion', body: 'That the House regrets the blockade.' }, token: w.T[0] });
ok(ed.status === 200, 'the proposer can');
ok((await get(b.id)).title === 'The Straits Motion', 'and the text is corrected');

console.log('\n-- an edit clears the seconds');

await call(`/api/bills/${b.id}/second`, { method: 'POST', token: w.T[1] });
await call(`/api/bills/${b.id}/second`, { method: 'POST', token: w.T[2] });
ok((await get(b.id)).seconds === 2, 'two members second it');
const ed2 = await call(`/api/bills/${b.id}`, { method: 'PATCH', body: { body: 'That the House condemns the blockade and demands the Straits reopened.' }, token: w.T[0] });
ok(ed2.d.seconds_cleared === 2, 'rewriting it clears both seconds');
ok((await get(b.id)).seconds === 0, 'so the proposer has to earn them again — a signature was for the text signed');

console.log('\n-- nothing changes once the House is voting');

await call(`/api/bills/${b.id}/second`, { method: 'POST', token: w.T[1] });
await call(`/api/bills/${b.id}/second`, { method: 'POST', token: w.T[2] });
await call(`/api/bills/${b.id}/table`, { method: 'POST', token: w.spk });
ok((await call(`/api/bills/${b.id}`, { method: 'PATCH', body: { body: 'Something else entirely.' }, token: w.T[0] })).status === 200,
  'a tabled bill can still be corrected');
await call(`/api/bills/${b.id}/division`, { method: 'POST', token: w.spk });
const late = await call(`/api/bills/${b.id}`, { method: 'PATCH', body: { body: 'Something else entirely.' }, token: w.T[0] });
ok(late.status === 400, 'but not once a division is called');
ok(/voting on a text/.test(late.d.error || ''), 'and the refusal says why');
ok((await call(`/api/bills/${b.id}/withdraw`, { method: 'POST', token: w.T[0] })).status === 400,
  'nor can it be withdrawn out from under a vote');

console.log('\n-- withdrawing');

const b2 = (await mk(w.T[0], { title: 'A motion of regret', body: 'That the House regrets everything.' })).d;
ok((await call(`/api/bills/${b2.id}/withdraw`, { method: 'POST', token: w.T[1] })).status === 403,
  'nobody can pull someone else\'s bill');
ok((await call(`/api/bills/${b2.id}/withdraw`, { method: 'POST', token: T })).status === 403,
  'not even the Returning Officer');
ok((await call(`/api/bills/${b2.id}/withdraw`, { method: 'POST', token: w.T[0] })).status === 200,
  'the proposer withdraws it');
const gone = await get(b2.id);
ok(gone.status === 'withdrawn', 'and it reads as withdrawn');
ok(!!gone.ref, 'the bill is kept, not deleted — a hole in the reference numbers would be worse');
ok((await call(`/api/bills/${b2.id}/second`, { method: 'POST', token: w.T[1] })).status !== 200,
  'and a withdrawn bill collects no more signatures');

report();
