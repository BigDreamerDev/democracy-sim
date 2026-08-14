const B = 'http://localhost:' + (process.env.TEST_PORT || '4321');
let fails = 0;
const ok = (c, m) => { console.log((c ? '  ok  ' : 'FAIL  ') + m); if (!c) fails++; };

async function call(path, { method = 'GET', body, token } = {}) {
  const r = await fetch(B + path, {
    method,
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
  const t = await r.text();
  let d; try { d = JSON.parse(t); } catch { d = t; }
  return { status: r.status, d };
}

// --- founder + citizens
const founder = (await call('/api/auth/register', { method: 'POST', body: { username: 'uzair', display_name: 'Uzair', password: 'hunter22' } })).d;
ok(founder.user.is_admin, 'first registrant becomes admin');

const codes = (await call('/api/admin/invites', { method: 'POST', body: { count: 6 }, token: founder.token })).d;
ok(codes.length === 6, 'invite codes generated');

const noInvite = await call('/api/auth/register', { method: 'POST', body: { username: 'gatecrasher', password: 'hunter22' } });
ok(noInvite.status === 400, 'registration blocked without an invite');

const users = [founder];
for (let i = 0; i < 6; i++) {
  const r = await call('/api/auth/register', { method: 'POST', body: { invite: codes[i], username: 'cit' + i, display_name: 'Citizen ' + i, password: 'hunter22' } });
  ok(r.d.pending === true && !r.d.token, `citizen ${i} is queued, not admitted`);
}
const queued = (await call('/api/admin/pending', { token: founder.token })).d;
ok(queued.length === 6, 'approval queue holds all 6 applicants');
const blockedLogin = await call('/api/auth/login', { method: 'POST', body: { username: 'cit0', password: 'hunter22' } });
ok(blockedLogin.status === 403, 'an unapproved account cannot sign in');
for (const u of queued) await call('/api/admin/approve', { method: 'POST', body: { user_id: u.id, approve: true }, token: founder.token });
for (let i = 0; i < 6; i++) {
  const r = await call('/api/auth/login', { method: 'POST', body: { username: 'cit' + i, password: 'hunter22' } });
  users.push(r.d);
}
ok(users.length === 7 && users.every(u => u.token), '6 citizens admitted after approval');

const reuse = await call('/api/auth/register', { method: 'POST', body: { invite: codes[0], username: 'dupe', password: 'hunter22' } });
ok(reuse.status === 400, 'invite codes are single use');

// --- parties
const party = (await call('/api/parties', { method: 'POST', body: { name: 'Order Paper Party', abbr: 'OPP', colour: '#1E2A5A' }, token: users[1].token })).d;
await call(`/api/parties/${party.id}/join`, { method: 'POST', token: users[2].token });
const plist = (await call('/api/parties')).d;
ok(plist[0].members.length === 2, 'party has founder plus one member');

// --- parliamentary election
const el = (await call('/api/elections', { method: 'POST', body: { kind: 'parliament', title: 'First general election' }, token: founder.token })).d;
ok(el.seats === 5, 'parliament election defaults to the configured 5 seats');

for (let i = 1; i <= 6; i++) {
  await call(`/api/elections/${el.id}/stand`, { method: 'POST', body: { statement: 'Vote ' + i }, token: users[i].token });
}
await call(`/api/elections/${el.id}/status`, { method: 'POST', body: { status: 'voting' }, token: founder.token });

const cands = (await call(`/api/elections/${el.id}`, { token: founder.token })).d.candidates;
ok(cands.every(c => c.votes === null), 'counts hidden while the secret ballot is open');

// everyone votes; candidate order engineered so 6th place loses
const plan = [0, 0, 1, 1, 2, 3, 4]; // index into cands
for (let i = 0; i < 7; i++) {
  const r = await call(`/api/elections/${el.id}/vote`, { method: 'POST', body: { candidacy_id: cands[plan[i]].id }, token: users[i].token });
  ok(r.status === 200, `citizen ${i} voted`);
}
const twice = await call(`/api/elections/${el.id}/vote`, { method: 'POST', body: { candidacy_id: cands[0].id }, token: users[0].token });
ok(twice.status === 409, 'second vote rejected — one vote per person');

const certified = (await call(`/api/elections/${el.id}/status`, { method: 'POST', body: { status: 'closed' }, token: founder.token })).d;
ok(certified.seated.length === 5, '5 MPs seated');

const state = (await call('/api/state')).d;
ok(state.offices.filter(o => o.office === 'mp').length === 5, 'state feed shows 5 sitting MPs');
ok(state.offices.filter(o => o.office === 'mp').every(o => o.seat), 'MPs have seat numbers');

// --- who are the MPs?
const mpUserIds = certified.seated.map(s => s.name);
const citizens = (await call('/api/citizens')).d;
const mps = citizens.filter(c => (c.offices || []).includes('mp'));
const tokenFor = name => users.find(u => u.user.display_name === name).token;
const mpTokens = mps.map(m => tokenFor(m.display_name));
ok(mpTokens.length === 5, 'resolved tokens for all 5 MPs');

// --- speaker (MPs only electorate)
const sp = (await call('/api/elections', { method: 'POST', body: { kind: 'speaker', title: 'Speaker' }, token: founder.token })).d;
const outsider = citizens.find(c => !(c.offices || []).includes('mp') && c.display_name !== 'Uzair');
const blocked = await call(`/api/elections/${sp.id}/stand`, { method: 'POST', token: tokenFor(outsider.display_name) });
ok(blocked.status === 403, 'non-MPs cannot stand for Speaker');

await call(`/api/elections/${sp.id}/stand`, { method: 'POST', body: { statement: 'Order' }, token: mpTokens[0] });
await call(`/api/elections/${sp.id}/status`, { method: 'POST', body: { status: 'voting' }, token: founder.token });
const spDetail = (await call(`/api/elections/${sp.id}`, { token: mpTokens[0] })).d;
ok(spDetail.eligible === 5, 'speaker electorate is the 5 MPs only');
const outsiderVote = await call(`/api/elections/${sp.id}/vote`, { method: 'POST', body: { candidacy_id: spDetail.candidates[0].id }, token: tokenFor(outsider.display_name) });
ok(outsiderVote.status === 403, 'non-MPs cannot vote for Speaker');
for (const t of mpTokens) await call(`/api/elections/${sp.id}/vote`, { method: 'POST', body: { candidacy_id: spDetail.candidates[0].id }, token: t });
await call(`/api/elections/${sp.id}/status`, { method: 'POST', body: { status: 'closed' }, token: founder.token });
const speakerToken = mpTokens[0];
ok((await call('/api/me', { token: speakerToken })).d.offices.includes('speaker'), 'speaker seated');

// --- presidential election
const pe = (await call('/api/elections', { method: 'POST', body: { kind: 'president', title: 'Presidency' }, token: founder.token })).d;
await call(`/api/elections/${pe.id}/stand`, { method: 'POST', body: { statement: 'Executive' }, token: users[6].token });
await call(`/api/elections/${pe.id}/status`, { method: 'POST', body: { status: 'voting' }, token: founder.token });
const peD = (await call(`/api/elections/${pe.id}`, { token: founder.token })).d;
for (const u of users) await call(`/api/elections/${pe.id}/vote`, { method: 'POST', body: { candidacy_id: peD.candidates[0].id }, token: u.token });
await call(`/api/elections/${pe.id}/status`, { method: 'POST', body: { status: 'closed' }, token: founder.token });
const presToken = users[6].token;
ok((await call('/api/me', { token: presToken })).d.offices.includes('president'), 'president seated');

// --- a bill through the whole pipeline
const bill = (await call('/api/bills', { method: 'POST', body: { title: 'Tea Break Act', kind: 'law', body: '## 1\nEvery sitting shall pause for tea.' }, token: users[3].token })).d;
ok(bill.ref === 'B001', 'bills are numbered');

const selfSecond = await call(`/api/bills/${bill.id}/second`, { method: 'POST', token: users[3].token });
ok(selfSecond.status === 400, 'authors cannot second their own bill');

const early = await call(`/api/bills/${bill.id}/table`, { method: 'POST', token: speakerToken });
ok(early.status === 400, 'bill cannot be tabled without enough seconders');

await call(`/api/bills/${bill.id}/second`, { method: 'POST', token: users[1].token });
await call(`/api/bills/${bill.id}/second`, { method: 'POST', token: users[2].token });

const notSpeaker = await call(`/api/bills/${bill.id}/table`, { method: 'POST', token: users[5].token });
ok(notSpeaker.status === 403, 'only the Speaker can table');

ok((await call(`/api/bills/${bill.id}/table`, { method: 'POST', token: speakerToken })).status === 200, 'speaker tables the bill');
ok((await call(`/api/bills/${bill.id}/division`, { method: 'POST', token: speakerToken })).status === 200, 'division called');

const nonMp = await call(`/api/bills/${bill.id}/vote`, { method: 'POST', body: { vote: 'aye' }, token: tokenFor(outsider.display_name) });
ok(nonMp.status === 403, 'non-MPs have no vote in a division');

for (let i = 0; i < 4; i++) await call(`/api/bills/${bill.id}/vote`, { method: 'POST', body: { vote: i < 3 ? 'aye' : 'no' }, token: mpTokens[i] });
const dbl = await call(`/api/bills/${bill.id}/vote`, { method: 'POST', body: { vote: 'no' }, token: mpTokens[0] });
ok(dbl.status === 409, 'one vote per MP per division');

const closed = (await call(`/api/bills/${bill.id}/close`, { method: 'POST', token: speakerToken })).d;
ok(closed.carried === true, 'bill carried 3–1');

// veto — and by default that is the end of it
ok((await call(`/api/bills/${bill.id}/assent`, { method: 'POST', body: { veto: true }, token: presToken })).d.status === 'vetoed', 'president vetoes');
ok((await call(`/api/bills/${bill.id}/override`, { method: 'POST', token: speakerToken })).status === 403,
  'a veto is final: assent is required unless the House has granted itself an override');
await call('/api/admin/config', { method: 'POST', body: {}, token: founder.token });
await call('/api/admin/config', { method: 'PUT', body: { allow_veto_override: 'true' }, token: founder.token });
const ov = await call(`/api/bills/${bill.id}/override`, { method: 'POST', token: speakerToken });
ok(ov.d.status === 'enacted', 'once allowed, parliament overrides the veto at 75%');

const laws = (await call('/api/laws')).d;
const tea = laws.find(l => l.title === 'Tea Break Act');
ok(!!tea, 'law entered in the statute book');
ok(laws.some(l => l.ref === 'L001' && l.title === 'The Flag Act'), 'the seeded Flag Act is still in force alongside it');

// --- amendment and repeal
const amend = (await call('/api/bills', { method: 'POST', body: { title: 'Tea Break Act (Longer Tea)', kind: 'amendment', body: '## 1\nTea shall last twenty minutes.', target_law_id: tea.id }, token: users[4].token })).d;
await call(`/api/bills/${amend.id}/second`, { method: 'POST', token: users[1].token });
await call(`/api/bills/${amend.id}/second`, { method: 'POST', token: users[2].token });
await call(`/api/bills/${amend.id}/table`, { method: 'POST', token: speakerToken });
await call(`/api/bills/${amend.id}/division`, { method: 'POST', token: speakerToken });
for (const t of mpTokens) await call(`/api/bills/${amend.id}/vote`, { method: 'POST', body: { vote: 'aye' }, token: t });
await call(`/api/bills/${amend.id}/close`, { method: 'POST', token: speakerToken });
await call(`/api/bills/${amend.id}/assent`, { method: 'POST', token: presToken });
const amended = (await call('/api/laws')).d;
ok(amended.find(l => l.id === tea.id).body.includes('twenty minutes'), 'amendment rewrites the law in place');

const rep = (await call('/api/bills', { method: 'POST', body: { title: 'Repeal the Tea Break Act', kind: 'repeal', body: 'Repealed.', target_law_id: tea.id }, token: users[5].token })).d;
await call(`/api/bills/${rep.id}/second`, { method: 'POST', token: users[1].token });
await call(`/api/bills/${rep.id}/second`, { method: 'POST', token: users[2].token });
await call(`/api/bills/${rep.id}/table`, { method: 'POST', token: speakerToken });
await call(`/api/bills/${rep.id}/division`, { method: 'POST', token: speakerToken });
for (const t of mpTokens) await call(`/api/bills/${rep.id}/vote`, { method: 'POST', body: { vote: 'aye' }, token: t });
await call(`/api/bills/${rep.id}/close`, { method: 'POST', token: speakerToken });
await call(`/api/bills/${rep.id}/assent`, { method: 'POST', token: presToken });
ok(!(await call('/api/laws')).d.some(l => l.id === tea.id), 'repealed law leaves the active statute book');
ok((await call('/api/laws?all=1')).d.some(l => l.id === tea.id), 'repealed law still visible in the archive');

// --- constitutional amendment needs two thirds
const con = (await call('/api/bills', { method: 'POST', body: { title: 'New Constitution', kind: 'constitutional', body: '# Constitution\n## Article I\n1. Tea is mandatory.' }, token: users[1].token })).d;
await call(`/api/bills/${con.id}/second`, { method: 'POST', token: users[2].token });
await call(`/api/bills/${con.id}/second`, { method: 'POST', token: users[3].token });
await call(`/api/bills/${con.id}/table`, { method: 'POST', token: speakerToken });
await call(`/api/bills/${con.id}/division`, { method: 'POST', token: speakerToken });
for (let i = 0; i < 5; i++) await call(`/api/bills/${con.id}/vote`, { method: 'POST', body: { vote: i < 3 ? 'aye' : 'no' }, token: mpTokens[i] });
const conClose = (await call(`/api/bills/${con.id}/close`, { method: 'POST', token: speakerToken })).d;
ok(conClose.carried === false, 'constitutional bill fails at 60% (needs two thirds)');

// --- config is live
await call('/api/admin/config', { method: 'PUT', body: { seats: '7', nation_name: 'Walthamstow Republic' }, token: founder.token });
const s2 = (await call('/api/state')).d;
ok(s2.config.seats === '7' && s2.config.nation_name === 'Walthamstow Republic', 'config changes take effect');

// --- digest
const digest = (await call('/api/digest')).d;
ok(typeof digest === 'string' && digest.includes('Walthamstow Republic'), 'group-chat digest renders');

console.log(fails ? `\n${fails} FAILURES` : '\nall green');
process.exit(fails ? 1 : 0);
