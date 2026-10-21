// Creating a world: a blank realm at its Founding Convention, or one 12 days into its first Parliament.
import { W, DAY, HOUR, ca, gazette, stamp, transfer, addCard, weekNo } from './core';
import { conventionClauses, assignAmbitions, newObjectives, HOS_METHODS } from './politics';
import { createOffice } from './offices';
import { seedNations } from './foreign';
import { SAFE_ZONES, join, postBounty, openStall, addJob } from './streets';
import { openMarket, bet } from './markets';
import { freshDaily, takePoll } from './glory';

export const NAMES = ['Uzair', 'Maya', 'Sam', 'Josh', 'Priya', 'Kai', 'Lee', 'Rhea', 'Ana', 'Tom', 'Omar', 'Zara', 'Ben', 'Chloe', 'Dev', 'Ella', 'Finn', 'Asha', 'Hugo'];

function blank(seed: number, now: number): W {
  return {
    v: 2, seed, rng: seed, now, epoch: Date.UTC(2026, 9, 5, 0, 0), startedAt: now, nextId: 0, phase: 'convention',
    flags: { intrigueNow: false, requireApproval: true, openSignup: false },
    config: {
      realmName: 'The Realm', seats: 5, termDays: 21, hos: 'monarchy', hosMethod: 'life', hosTitle: 'Queen',
      debateHours: 24, voteHours: 24, intrigueDelayDays: 14, conventionThreshold: 10, inductionDays: 7, conventionDays: 3,
      mpPay: 8, ministerPay: 5, dividend: 5, taxRate: 10, tariff: 10
    },
    calendar: { payday: { dow: 1, hour: 9 }, pmqs: { dow: 3, hour: 20 }, frontpage: { dow: 5, hour: 18 } },
    lastEvent: {},
    permits: { banks: false },
    citizens: {}, pending: [], seats: [], lastRanked: [], speaker: null, hos: { holder: null, since: now, until: null },
    pm: null, pmInviteDue: null, minority: false, coalition: null, shadow: {}, confidence: null,
    convention: { clauses: conventionClauses(), closesAt: now + 3 * DAY }, parties: {}, elections: {}, nextGeneralAt: null,
    proposals: {}, propCount: 0, laws: [], questions: [], lobbying: [],
    offices: {}, accounts: { reserve: 0, treasury: 0 }, ledger: [],
    economy: { lent: 0, rate: 2, prices: [2], lentThisWeek: 0, lastInflation: 0 },
    banks: {}, ventures: [], nations: {}, offers: {}, treaties: {}, asks: [], intel: [],
    army: { readiness: 'ready', loyalty: 3, reasons: [], war: null },
    deals: {}, cards: [], demands: {}, plots: {}, martial: null,
    papers: {}, stories: [], frontpages: [], cases: {}, crises: {}, crisisQueue: [],
    meters: { prosperity: 60, stability: 60, log: [] },
    season: { n: 0, startedAt: now }, archive: [], gazette: [], adminLog: [],
    streets: { zones: SAFE_ZONES.map((text, i) => ({ id: 'z' + i, text, by: 'default' })), contracts: {}, protect: null, meets: [] },
    bounties: {}, stalls: {}, orders: {}, jobs: {}, jobClaims: [], markets: {}, ultimatums: [],
    daily: freshDaily(now), dailyPast: [], polls: [], fame: { pms: [], seasons: [], records: {} }
  };
}
function addCitizen(w: W, name: string, admin = false) {
  const id = name.toLowerCase();
  w.citizens[id] = {
    id, name, party: null, admin, active: true, joinedAt: w.now, influence: 10, seasonEarned: 0, approval: 50,
    log: [], stamps: [], titles: [], censures: 0, stats: {}, whip: { loyal: 0, rebel: 0 }, week: {}, objectives: [],
    exiledUntil: null, asylum: null, ambition: null, weekIncome: 0
  };
  w.accounts.reserve -= 100;
  w.accounts[ca(id)] = 100;
}
export function createWorld(scenario: 'convention' | 'running', seed = 20261019): W {
  const w = blank(seed, Date.UTC(2026, 9, 19, 10, 0));
  NAMES.forEach((n, i) => addCitizen(w, n, i === 0));
  w.pending = [{ id: 'su1', name: 'Nadia' }, { id: 'su2', name: 'Theo' }];
  w.accounts.reserve -= 300;
  w.accounts.treasury = 300;
  seedNations(w);
  if (scenario === 'convention') {
    gazette(w, 'convention', 'The Founding Convention is open for 3 days. Vote on each clause, add your own options, or table new clauses. A majority of citizens for one option settles a clause at once.', '#/convention');
    return w;
  }
  return running(w);
}

function running(w: W): W {
  const day = (d: number) => w.now - d * DAY;
  w.phase = 'running';
  w.startedAt = day(12);
  w.lastEvent = { payday: day(0) - HOUR, pmqs: day(5), frontpage: day(3) };
  Object.assign(w.config, { realmName: 'Kingdom of Aldmere', hos: 'monarchy', hosMethod: 'life' });
  w.convention.clauses.forEach((c: any) => {
    if (c.id === 'method') c.options = HOS_METHODS.monarchy.map((o) => o.label);
    c.adopted = ({ principle: 0, name: 0, seats: 1, hos: 0, method: 0, term: 1 } as any)[c.id];
  });
  const party = (id: string, name: string, colour: string, leader: string, ms: string[], manifesto: string[]) => {
    w.parties[id] = { id, name, colour, leader, status: 'active', invited: [], signed: [], founded: day(11), manifesto, motions: [] };
    ms.forEach((m) => (w.citizens[m].party = id));
  };
  party('lantern', 'Lantern Party', '#1F5E57', 'maya', ['maya', 'uzair', 'ana', 'ella', 'finn', 'priya'], ['A holiday a month and a dividend for all']);
  party('oak', 'Oak Party', '#A8321F', 'sam', ['sam', 'lee', 'tom', 'ben', 'hugo'], ['Lower taxes and a stronger Army']);
  party('free', 'Free Traders', '#6B4E1F', 'kai', ['kai', 'zara', 'dev'], ['Open every border to trade']);
  w.parties.lantern.motions.push({ id: 'pm1', by: 'priya', text: 'Never go into coalition with the Oak Party', votes: { priya: 'for', ana: 'for', ella: 'against' }, status: 'open', at: day(2) });

  // the founding general election, already counted
  const counts: Record<string, number> = { maya: 4, sam: 4, lee: 3, uzair: 2, rhea: 2, kai: 2, omar: 1, hugo: 1, dev: 0 };
  const ballots: Record<string, string> = {};
  const voters = Object.keys(w.citizens);
  let vi = 0;
  Object.entries(counts).forEach(([c, n]) => {
    for (let i = 0; i < n; i++) ballots[voters[vi++]] = c;
  });
  const ranked = Object.keys(counts);
  const cands: any = {};
  ranked.forEach((c) => (cands[c] = { id: c, party: w.citizens[c].party }));
  w.elections.e1 = { id: 'e1', kind: 'general', title: 'General election for the 1st Parliament', status: 'closed', stand: 'all', voters: 'all', winners: 5, opensAt: day(14), closesAt: day(12), closedAt: day(12), candidates: cands, ballots, results: { counts, ranked, winners: ranked.slice(0, 5), draw: true, turnout: 19 } };
  w.elections.e2 = { id: 'e2', kind: 'speaker', title: 'Election for Speaker', status: 'closed', stand: 'all', voters: 'all', winners: 1, opensAt: day(14), closesAt: day(12), closedAt: day(12), candidates: { josh: { id: 'josh' }, zara: { id: 'zara' } }, ballots: {}, results: { counts: { josh: 12, zara: 6 }, ranked: ['josh', 'zara'], winners: ['josh'], draw: false, turnout: 18 } };
  w.elections.e3 = { id: 'e3', kind: 'hos', title: 'Election of the Monarch, for life', status: 'closed', stand: 'all', voters: 'all', winners: 1, opensAt: day(14), closesAt: day(12), closedAt: day(12), candidates: { asha: { id: 'asha' }, hugo: { id: 'hugo' } }, ballots: {}, results: { counts: { asha: 12, hugo: 6 }, ranked: ['asha', 'hugo'], winners: ['asha'], draw: false, turnout: 18 } };
  w.seats = ranked.slice(0, 5);
  w.lastRanked = ranked;
  w.speaker = 'josh';
  w.hos = { holder: 'asha', since: day(12), until: null };
  w.config.hosTitle = 'Queen';
  w.pm = 'maya';
  w.minority = false;
  w.coalition = { id: 'co1', lead: 'p:lantern', sides: ['p:lantern', 'i:rhea'], kind: 'full', terms: ['Rhea becomes Chancellor', 'Rhea backs the Public Holidays Bill'], signed: { 'p:lantern': true, 'i:rhea': true }, status: 'signed', promises: { treasury: 'rhea' }, at: day(11) };
  w.shadow = { pm: 'sam', treasury: 'lee', foreign: 'kai' };
  w.season = { n: 1, startedAt: day(12) };
  w.nextGeneralAt = day(12) + 21 * DAY;

  const law = (ref: string, title: string, summary: string, text: string[], d: number) => w.laws.push({ ref, title, summary, text, propId: null, at: day(d), classified: false, how: 'Royal Assent', repealed: false, rulings: [] });
  law('L001', 'Founding Act', 'Adopts the constitution of the Kingdom of Aldmere.', ['Every citizen has one vote, and nothing binds the realm without a law.', 'The realm is the Kingdom of Aldmere.', 'Parliament has 5 seats. At each general election the 5 candidates with the most votes nationwide take them. A seat that falls empty goes to the next candidate in line.', 'A Monarch is head of state, elected for life by every citizen.', 'A general election every 3 weeks.', 'There is a Chief Whip, appointed by the Prime Minister.'], 13);
  law('L002', 'Treasury Act', 'Creates the Treasury.', ['Creates the Treasury, led by a chancellor.'], 10);
  law('L003', 'Currency Act', 'Creates the Federal Reserve.', ['Creates the Federal Reserve, led by a chair of the Reserve.'], 9);
  law('L004', 'Foreign Affairs Act', 'Creates the Foreign Office.', ['Creates the Foreign Office, led by a foreign minister.'], 8);
  law('L005', 'Parks Act', 'Protects four parks from building.', ['The four parks of the realm are protected from building.'], 5);
  const t = w.now;
  [['whip', 'L001', 'finn'], ['treasury', 'L002', 'rhea'], ['reserve', 'L003', 'kai'], ['foreign', 'L004', 'ana']].forEach(([tpl, ref, holder]) => {
    w.now = day(10);
    createOffice(w, { template: tpl }, ref);
    w.offices[tpl].holder = holder;
    w.citizens[holder].stats.heldOffice = true;
  });
  w.now = t;

  // proposals in progress
  w.propCount = 9;
  const prop = (id: string, n: number, kind: string, title: string, summary: string, by: string, clauses: any[], stage: string, extra: any = {}) => {
    w.proposals[id] = { id, n, kind, title, summary, by, clauses, target: null, constitutional: false, voters: 'mps', stage, at: day(2), debateEndsAt: null, voteEndsAt: null, assentDueAt: null, hosDueAt: null, speeches: [], votes: {}, casting: null, lobby: 0, result: null, lawRef: null, fast: false, ...extra };
  };
  prop('p7', 7, 'bill', 'Public Holidays Bill', 'Makes the second Friday of every month a public holiday.', 'maya',
    [{ t: 'text', text: 'The second Friday of every month is a public holiday.' }, { t: 'text', text: 'A holiday that falls on a weekend moves to the next Monday.' }], 'vote', {
      voteEndsAt: w.now + 5 * HOUR + 12 * 60000, votes: { maya: 'aye', rhea: 'aye', sam: 'no' },
      speeches: [
        { id: 's1', by: 'maya', side: 'for', text: 'One Friday a month off costs nothing, and every citizen gets something from this Parliament.', at: day(2) },
        { id: 's2', by: 'sam', side: 'against', text: 'Nothing in this bill says what actually changes on the day.', at: day(2) + HOUR },
        { id: 's3', by: 'josh', side: 'order', text: 'Order. Members will address the bill, not each other.', at: day(2) + 2 * HOUR }
      ]
    });
  prop('p8', 8, 'bill', 'Citizen Dividend (Amendment) Bill', 'Raises the weekly dividend to 6 crowns.', 'lee', [{ t: 'set', key: 'dividend', value: 6 }], 'assent', { assentDueAt: w.now + 30 * HOUR, result: { ayes: 4, noes: 1, passed: true, note: '' }, votes: { maya: 'aye', rhea: 'aye', sam: 'aye', lee: 'aye', uzair: 'no' }, lobby: 20 });
  prop('p9', 9, 'bill', 'Security Service Bill', 'Creates a Security Service to gather intelligence abroad.', 'ana', [{ t: 'office', template: 'security' }], 'debate', {
    at: w.now - 4 * HOUR, debateEndsAt: w.now + 20 * HOUR, speeches: [{ id: 's4', by: 'ana', side: 'for', text: 'Kessmark already spies on us. We should at least know what they plan.', at: w.now - 3 * HOUR }]
  });
  w.propCount = 10;
  prop('p10', 10, 'no_confidence', 'That this House has no confidence in the government', '', 'sam', [], 'vote', { at: w.now - 14 * HOUR, voteEndsAt: w.now + 10 * HOUR, votes: { sam: 'aye', lee: 'aye', maya: 'no' } });
  w.lobbying = [{ at: day(1), from: 'kai', to: 'lee', prop: 'p8', amt: 20 }];
  transfer(w, ca('kai'), ca('lee'), 20, 'Lobbying on the Citizen Dividend (Amendment) Bill');

  const wk = weekNo(w);
  w.questions = [
    { id: 'q1', by: 'sam', to: 'pm', text: 'Will the Prime Minister say how much the Treasury has borrowed this month?', backers: ['lee', 'tom', 'ben', 'hugo', 'kai', 'zara', 'dev', 'chloe', 'omar'], answer: null, status: 'open', formal: false, at: day(1), week: wk },
    { id: 'q2', by: 'lee', to: 'pm', text: 'Did the PM promise the Treasury to Rhea before the election?', backers: ['sam', 'tom', 'ben', 'hugo', 'dev', 'zara', 'kai'], answer: null, status: 'open', formal: false, at: day(1), week: wk },
    { id: 'q3', by: 'ana', to: 'pm', text: 'Will the new holiday include the parks?', backers: ['ella'], answer: 'Yes. All four parks stay open on holidays.', status: 'answered', formal: false, at: day(2), week: wk }
  ];
  w.papers.np1 = { id: 'np1', name: 'The Oak Herald', editor: 'sam', followers: ['sam', 'lee', 'tom', 'ben', 'hugo', 'kai', 'zara', 'dev', 'uzair'], at: day(9) };
  w.papers.np2 = { id: 'np2', name: 'The Lamplighter', editor: 'priya', followers: ['priya', 'maya', 'ana', 'ella', 'finn', 'uzair', 'rhea'], at: day(7) };
  w.stories = [
    { id: 'st1', paper: 'np1', by: 'sam', headline: 'Where did the Treasury’s money go?', body: 'The Chancellor will not say how much has been borrowed. Ask her at PMQs.', status: 'published', at: day(1), cheers: ['lee', 'tom', 'ben', 'zara'] },
    { id: 'st2', paper: 'np2', by: 'priya', headline: 'Holidays Act: what changes on Friday', body: 'A plain guide to the realm’s first public holiday.', status: 'published', at: day(2), cheers: ['maya', 'ana'] },
    { id: 'st3', paper: 'np2', by: 'ella', headline: 'Why the Army needs a law', body: 'We have no Defence Act. Kessmark has noticed.', status: 'submitted', at: day(0.5), cheers: [] }
  ];
  w.frontpages = [{ id: 'fp1', at: day(3), week: wk - 1, lead: { headline: 'Coalition signed: Rhea to be Chancellor', body: 'The Lantern Party and Rhea agree terms after two days of talks.', by: 'priya', paper: 'The Lamplighter' }, laws: [{ ref: 'L004', title: 'Foreign Affairs Act' }, { ref: 'L005', title: 'Parks Act' }], meters: { prosperity: 61, stability: 58, standing: 50 }, pm: 'maya', dodged: 1, scandals: 0, nextElection: w.nextGeneralAt }];
  w.ventures = [{ id: 'v1', by: 'kai', nation: 'varnholm', amount: 40, tariff: 4, r: 18, at: day(1), dueAt: w.now + DAY, status: 'out' }];
  w.accounts['c:kai'] -= 44;
  w.accounts['nation:varnholm'] += 40;
  w.accounts.treasury += 4;
  w.economy.lent = 60;
  w.accounts.reserve -= 60;
  w.accounts.treasury += 60;
  w.now = day(4);
  addCard(w, { title: 'The Treasury quietly borrowed 60 crowns from the Reserve to cover the first payday.', about: 'rhea', from: 'Treasury', level: 'restricted', viewers: ['pm', 'office:treasury', 'office:reserve'] });
  addCard(w, { title: 'Before the coalition was signed, Maya promised Rhea the Treasury in exchange for her vote on the Holidays Bill.', about: 'maya', from: 'Coalition talks', level: 'restricted', viewers: ['cit:maya', 'cit:rhea'] });
  w.now = t;
  w.meters = { prosperity: 57, stability: 52, log: [{ at: day(1), key: 'stability', d: -3, why: 'A motion of no confidence was tabled' }, { at: day(5), key: 'prosperity', d: -2, why: 'The Treasury had to borrow' }] };
  Object.values(w.citizens).forEach((c: any) => {
    stamp(w, c.id, 'Founding Convention', 'Delegate', 'good');
    c.influence = 12 + ((c.id.charCodeAt(0) * 7) % 38);
    c.seasonEarned = c.influence + 6;
    c.approval = 42 + ((c.id.charCodeAt(1) * 13) % 25);
  });
  w.seats.forEach((id: string) => stamp(w, id, 'Elected MP', '1st Parliament', 'bad'));
  stamp(w, 'maya', 'Prime Minister', 'Invited by Queen Asha', 'ink');
  stamp(w, 'asha', 'Crowned', 'Queen of the realm', 'ink');
  stamp(w, 'josh', 'Speaker', 'Elected to the chair', 'ink');
  w.citizens.maya.stats.wasPM = true;
  w.citizens.uzair.whip = { loyal: 11, rebel: 1, last: 'Citizen Dividend (Amendment) Bill' };
  assignAmbitions(w);
  w.citizens.uzair.ambition = { id: 'pm', text: 'Become Prime Minister', reward: 30 };
  w.citizens.maya.stats.wasPM = true;
  newObjectives(w);
  const g = (d: number, kind: string, text: string, link?: string) => w.gazette.push({ id: 'gs' + w.gazette.length, at: day(d), kind, text, link: link || null });
  g(0.04, 'money', 'Payday: 5 crowns to every citizen. Income tax raised 22. Prices up 1.5%.', '#/wallet');
  g(0.6, 'proposal', 'Sam puts a no confidence motion to the House: that this House has no confidence in the government.', '#/p/p10');
  g(0.7, 'proposal', 'Passed 4 to 1: Citizen Dividend (Amendment) Bill.', '#/p/p8');
  g(1, 'money', 'Kai paid Lee 20 crowns to back the Citizen Dividend (Amendment) Bill. Declared publicly.', '#/p/p8');
  g(2, 'proposal', 'Voting opens: Public Holidays Bill. MPs vote.', '#/p/p7');
  g(3, 'press', 'This week’s front page: Coalition signed: Rhea to be Chancellor.', '#/frontpage/fp1');
  g(5, 'law', 'Parks Act becomes law L005 (Royal Assent).', '#/law/L005');
  g(11, 'government', 'Coalition signed: Lantern Party and Rhea (independent). Full coalition.', '#/cabinet');
  g(12, 'election', 'General election: Maya, Sam, Lee, Uzair and Rhea win seats. Turnout 19 of 19. A tie was settled by drawn lot.', '#/election/e1');
  w.gazette.sort((a: any, b: any) => b.at - a.at);
  w.nextId = 200;
  // the Streets and the market, a few days in (Uzair, the demo player, hasn't joined: that's his choice)
  const tn = w.now;
  w.now = day(3);
  ['maya', 'sam', 'lee', 'priya', 'kai', 'zara', 'tom', 'ella', 'dev', 'rhea'].forEach((id) => join(w, id, true));
  postBounty(w, 'sam', 'Bring the Chancellor a Greggs sausage roll before Friday', 30);
  postBounty(w, 'priya', 'Get a selfie with a teacher’s dog', 25);
  openStall(w, 'zara', 'I’ll make your flashcards for one subject', 15);
  openStall(w, 'kai', 'A hand-drawn campaign poster', 20);
  addJob(w, { title: 'Read the week’s Gazette out loud to the group', pay: 4 }, 'L005');
  w.now = day(7);
  takePoll(w);
  w.now = day(0) - HOUR;
  takePoll(w);
  w.now = tn;
  openMarket(w, 'prop', 'p7', 'Will “Public Holidays Bill” pass the vote?', [{ key: 'yes', label: 'Passes' }, { key: 'no', label: 'Fails' }], w.proposals.p7.voteEndsAt);
  openMarket(w, 'prop', 'p10', 'Will “That this House has no confidence in the government” pass the vote?', [{ key: 'yes', label: 'Passes' }, { key: 'no', label: 'Fails' }], w.proposals.p10.voteEndsAt);
  Object.values(w.markets).forEach((m: any, i: number) => ['maya', 'sam', 'kai', 'tom', 'lee'].forEach((id, j) => bet(w, id, m.id, (i + j) % 3 ? 'yes' : 'no', 5 + j * 3)));
  w.gazette.sort((a: any, b: any) => b.at - a.at);
  return w;
}

// the real thing: a fresh realm at its Founding Convention, peopled by the real accounts
export function createLiveWorld(people: { id: string; name: string; admin: boolean }[], now: number, seed: number): W {
  const w = blank(seed, now);
  people.forEach((p) => {
    w.citizens[p.id] = {
      id: p.id, name: p.name, party: null, admin: p.admin, active: true, joinedAt: now, influence: 10, seasonEarned: 0, approval: 50,
      log: [], stamps: [], titles: [], censures: 0, stats: {}, whip: { loyal: 0, rebel: 0 }, week: {}, objectives: [],
      exiledUntil: null, asylum: null, ambition: null, weekIncome: 0
    };
    w.accounts.reserve -= 100;
    w.accounts[ca(p.id)] = 100;
  });
  w.accounts.reserve -= 300;
  w.accounts.treasury = 300;
  seedNations(w);
  gazette(w, 'convention', 'The Founding Convention is open for 3 days. Vote on each clause, add your own options, or table new clauses. A majority of citizens for one option settles a clause at once.', '#/convention');
  return w;
}
