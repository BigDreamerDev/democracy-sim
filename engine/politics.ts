// The Founding Convention, national elections (top N win, countback fills gaps), the head of state,
// parties, forming a government, coalitions, the shadow cabinet, seasons, ambitions and weekly objectives.
import {
  W, Id, DAY, fail, newId, pick, rand, shuffle, cit, nm, allCitizens, exiled, mustBeFree, gazette, earn, stamp, approve,
  isMP, mps, isPM, isHOS, sideOf, sideName, govSides, majority, noOfficeForRO, transfer, ca, addCard, meter, hosTitle, ordinal, tick, bal
} from './core';
import { createOffice } from './offices';

// ================= Founding Convention =================
export const HOS_METHODS: Record<string, { id: string; label: string }[]> = {
  monarchy: [
    { id: 'life', label: 'Elected for life by every citizen' },
    { id: 'lot', label: 'Drawn by lot every 4 weeks' },
    { id: 'rotate', label: 'Every citizen takes a week in turn' }
  ],
  republic: [
    { id: 'citizens', label: 'Elected by every citizen at each general election' },
    { id: 'house', label: 'Elected by MPs after each general election' },
    { id: 'lot', label: 'Drawn by lot each term' }
  ]
};
export function conventionClauses() {
  return [
    { id: 'principle', q: 'Every citizen has one vote, and nothing binds the realm without a law.', options: ['Adopt', 'Reject'], votes: {}, adopted: null },
    { id: 'name', q: 'What should the realm be called?', options: ['Kingdom of Aldmere', 'Realm of Westerly', 'Commonwealth of the Isles'], votes: {}, adopted: null },
    { id: 'seats', q: 'How many seats in Parliament? The candidates with the most votes nationwide take them.', options: ['3', '5', '7'], votes: {}, adopted: null },
    { id: 'hos', q: 'Who is head of state?', options: ['A Monarch: reigns, signs every law', 'A President: elected, can veto bills'], votes: {}, adopted: null },
    { id: 'method', q: 'How is the head of state chosen?', options: [], votes: {}, adopted: null, needs: 'hos' },
    { id: 'term', q: 'How long between general elections?', options: ['2 weeks', '3 weeks', '4 weeks'], votes: {}, adopted: null }
  ];
}
export function conventionVote(w: W, actor: Id, clauseId: string, option: number) {
  if (w.phase !== 'convention') fail('The convention has finished.');
  const c = w.convention.clauses.find((x: any) => x.id === clauseId);
  if (!c || c.adopted !== null) fail('That clause is settled.');
  if (c.needs && w.convention.clauses.find((x: any) => x.id === c.needs).adopted === null) fail('This opens once the head of state clause is settled.');
  if (!(option >= 0 && option < c.options.length)) fail('Pick an option.');
  if (c.votes[actor] === undefined) {
    earn(w, actor, 2, 'Voted at the Convention');
    tick(w, actor, 'votes');
  }
  c.votes[actor] = option;
  const counts = c.options.map((_: any, i: number) => Object.values(c.votes).filter((v) => v === i).length);
  const top = counts.findIndex((n: number) => n >= w.config.conventionThreshold);
  if (top >= 0) adoptClause(w, c, top);
}
function adoptClause(w: W, c: any, i: number) {
  if (c.id === 'principle' && i === 1) {
    c.votes = {};
    gazette(w, 'convention', 'The first clause was rejected. Votes reset so the convention can argue it again.', '#/convention');
    return;
  }
  c.adopted = i;
  gazette(w, 'convention', `The convention adopts: ${c.options[i]}.`, '#/convention');
  if (c.id === 'name') w.config.realmName = c.options[i];
  if (c.id === 'seats') w.config.seats = Number(c.options[i]);
  if (c.id === 'hos') {
    w.config.hos = i === 0 ? 'monarchy' : 'republic';
    const m = w.convention.clauses.find((x: any) => x.id === 'method');
    m.options = HOS_METHODS[w.config.hos].map((o) => o.label);
  }
  if (c.id === 'method') w.config.hosMethod = HOS_METHODS[w.config.hos][i].id;
  if (c.id === 'term') w.config.termDays = [14, 21, 28][i];
  if (w.convention.clauses.every((x: any) => x.adopted !== null)) finishConvention(w);
}
export function finishConvention(w: W) {
  w.phase = 'running';
  w.startedAt = w.now;
  w.seats = Array(w.config.seats).fill(null);
  w.laws.push({
    ref: 'L001', title: 'Founding Act', summary: `Adopts the constitution of the ${w.config.realmName}.`, at: w.now, how: 'Founding Convention', repealed: false, classified: false, rulings: [], propId: null,
    text: [
      'Every citizen has one vote, and nothing binds the realm without a law.',
      `The realm is the ${w.config.realmName}.`,
      `Parliament has ${w.config.seats} seats. At each general election the ${w.config.seats} candidates with the most votes nationwide take them. A seat that falls empty goes to the next candidate in line.`,
      `${w.config.hos === 'monarchy' ? 'A Monarch' : 'A President'} is head of state, ${HOS_METHODS[w.config.hos].find((m) => m.id === w.config.hosMethod)!.label.toLowerCase()}.`,
      `A general election every ${w.config.termDays / 7} weeks.`,
      'There is a Chief Whip, appointed by the Prime Minister.'
    ]
  });
  createOffice(w, { template: 'whip' }, 'L001');
  gazette(w, 'law', `The constitution is adopted. The ${w.config.realmName} is founded. Polls open now.`, '#/law/L001');
  callGeneralElection(w, w.now + 2 * DAY);
  if (w.config.hos === 'monarchy') startHosSelection(w);
}

// ================= Elections =================
// stand: who may stand ('all' or 'party:<id>'); voters: 'all', 'mps' or 'party:<id>'; winners: how many win
export function newElection(w: W, e: any) {
  const id = newId(w, 'e');
  w.elections[id] = { id, status: 'open', candidates: {}, ballots: {}, opensAt: w.now, results: null, stand: 'all', voters: 'all', winners: 1, ...e };
  return w.elections[id];
}
export function callGeneralElection(w: W, closesAt: number) {
  const g = newElection(w, { kind: 'general', title: `General election for the ${ordinal(w.season.n + 1)} Parliament`, winners: w.config.seats, closesAt });
  const s = newElection(w, { kind: 'speaker', title: 'Election for Speaker', closesAt });
  // sitting MPs and the Speaker stand again automatically; they can withdraw
  mps(w).forEach((m) => !exiled(w, m) && (g.candidates[m] = { id: m, party: w.citizens[m].party, at: w.now, incumbent: true }));
  if (w.speaker && !exiled(w, w.speaker)) s.candidates[w.speaker] = { id: w.speaker, at: w.now, incumbent: true };
  if (w.config.hos === 'republic' && w.config.hosMethod === 'citizens') newElection(w, { kind: 'hos', title: 'Election for President', closesAt });
  w.nextGeneralAt = null;
  gazette(w, 'election', `Polls are open. The ${w.config.seats} candidates with the most votes nationwide win seats.`, '#/elections');
}
export function canVote(w: W, e: any, id: Id) {
  const c = w.citizens[id];
  if (!c || !c.active || exiled(w, id) || e.status !== 'open') return false;
  if (e.voters === 'mps') return isMP(w, id);
  if (e.voters.startsWith('party:')) return c.party === e.voters.slice(6);
  return true;
}
export function stand(w: W, actor: Id, eid: Id) {
  mustBeFree(w, actor);
  const e = w.elections[eid];
  if (!e || e.status !== 'open') fail('That election is not open.');
  const c = cit(w, actor);
  if (e.stand.startsWith('party:') && c.party !== e.stand.slice(6)) fail('Only party members can stand.');
  if (e.kind !== 'general') noOfficeForRO(w, actor);
  if (e.candidates[actor]) fail('You are already standing.');
  e.candidates[actor] = { id: actor, party: c.party, at: w.now };
  gazette(w, 'election', `${c.name} stands in the ${e.title.toLowerCase()}.`, '#/election/' + e.id);
}
export function withdraw(w: W, actor: Id, eid: Id) {
  const e = w.elections[eid];
  if (!e || e.status !== 'open' || !e.candidates[actor]) fail('You are not standing.');
  delete e.candidates[actor];
  Object.keys(e.ballots).forEach((v) => e.ballots[v] === actor && delete e.ballots[v]);
}
export function castBallot(w: W, actor: Id, eid: Id, cand: Id) {
  const e = w.elections[eid];
  if (!e || !canVote(w, e, actor)) fail('You cannot vote in this election.');
  if (!e.candidates[cand]) fail('That person is not standing.');
  if (e.ballots[actor]) fail('Your ballot is cast. It cannot be changed.');
  e.ballots[actor] = cand;
  earn(w, actor, 2, 'Voted in an election');
  tick(w, actor, 'votes');
}
function rank(w: W, e: any) {
  const counts: Record<Id, number> = {};
  Object.keys(e.candidates).forEach((c) => (counts[c] = 0));
  Object.values(e.ballots).forEach((c: any) => counts[c] !== undefined && counts[c]++);
  const lot: Record<Id, number> = {};
  Object.keys(counts).forEach((c) => (lot[c] = rand(w)));
  const ranked = Object.keys(counts).sort((a, b) => counts[b] - counts[a] || lot[b] - lot[a]);
  const draws = ranked.filter((c, i) => i > 0 && counts[c] === counts[ranked[i - 1]] && i < e.winners + 1 && i >= e.winners - 1);
  return { counts, ranked, draw: draws.length > 0 };
}
export function closeElection(w: W, e: any) {
  e.status = 'closed';
  e.closedAt = w.now;
  const r = rank(w, e);
  const winners = r.ranked.slice(0, e.winners);
  e.results = { counts: r.counts, ranked: r.ranked, winners, draw: r.draw, turnout: Object.keys(e.ballots).length };
  if (e.kind === 'general') {
    w.seats = Array(w.config.seats).fill(null).map((_, i) => winners[i] || null);
    w.lastRanked = r.ranked;
    winners.forEach((id) => {
      stamp(w, id, 'Elected MP', `${ordinal(w.season.n + 1)} Parliament`, 'bad');
      earn(w, id, 10, 'Won a seat');
      approve(w, id, 4);
    });
    gazette(w, 'election', `General election: ${winners.map((x) => nm(w, x)).join(', ')} win seats. Turnout ${e.results.turnout} of ${allCitizens(w).length}.${r.draw ? ' A tie was settled by drawn lot.' : ''}`, '#/election/' + e.id);
    endSeason(w);
    formGovernmentAfterElection(w);
    w.nextGeneralAt = w.now + w.config.termDays * DAY;
    countback(w);
  } else if (e.kind === 'speaker') {
    const s = winners[0] || null;
    w.speaker = s;
    if (s) {
      stamp(w, s, 'Speaker', 'Elected to the chair', 'ink');
      if (isMP(w, s)) vacateSeat(w, s, 'became Speaker');
    }
    gazette(w, 'election', `${nm(w, s)} is elected Speaker.`);
  } else if (e.kind === 'hos') {
    if (winners[0]) setHos(w, winners[0], w.config.hos === 'monarchy' ? null : w.now + w.config.termDays * DAY);
  } else if (e.kind === 'leadership') {
    const p = w.parties[e.party];
    if (p && winners[0]) {
      p.leader = winners[0];
      gazette(w, 'party', `${nm(w, winners[0])} wins the ${p.name} leadership.`, '#/party/' + p.id);
    }
  } else if (e.kind === 'office') {
    const o = w.offices[e.office];
    if (o && winners[0]) {
      o.holder = winners[0];
      w.citizens[winners[0]].stats.heldOffice = true;
      stamp(w, winners[0], o.title, 'Elected', 'ink');
      gazette(w, 'government', `${nm(w, winners[0])} is elected ${o.title}.`, '#/offices');
    }
  }
}
// an empty seat goes to the next candidate in line from the last general election
export function countback(w: W) {
  w.seats.forEach((s: Id | null, i: number) => {
    if (s) return;
    const next = (w.lastRanked || []).find((c: Id) => !w.seats.includes(c) && w.speaker !== c && w.hos.holder !== c && w.citizens[c]?.active && !exiled(w, c));
    if (next) {
      w.seats[i] = next;
      stamp(w, next, 'Took a seat', 'On countback', 'bad');
      gazette(w, 'election', `${nm(w, next)} takes the empty seat on countback (next in line from the last election).`, '#/house');
    }
  });
}
export function vacateSeat(w: W, id: Id, why: string) {
  const i = w.seats.indexOf(id);
  if (i < 0) return;
  w.seats[i] = null;
  gazette(w, 'election', `${nm(w, id)} leaves the House (${why}).`);
  countback(w);
}

// ================= Head of state =================
export function setHos(w: W, id: Id | null, until: number | null) {
  w.hos = { holder: id, since: w.now, until };
  if (!id) return;
  if (isMP(w, id)) vacateSeat(w, id, `became ${hosTitle(w)}`);
  stamp(w, id, w.config.hos === 'monarchy' ? 'Crowned' : 'President', 'Head of state', 'ink');
  gazette(w, 'hos', `${nm(w, id)} becomes ${hosTitle(w)}.`, '#/hos');
}
export function startHosSelection(w: W) {
  const m = w.config.hosMethod;
  const pool = allCitizens(w).filter((c: any) => !c.admin && !exiled(w, c.id)).map((c: any) => c.id);
  if (m === 'life' || m === 'citizens') {
    if (!Object.values(w.elections).some((e: any) => e.kind === 'hos' && e.status === 'open'))
      newElection(w, { kind: 'hos', title: w.config.hos === 'monarchy' ? 'Election of the Monarch, for life' : 'Election for President', closesAt: w.now + 2 * DAY });
  } else if (m === 'house') newElection(w, { kind: 'hos', title: 'MPs elect the President', voters: 'mps', closesAt: w.now + DAY });
  else if (m === 'lot') setHos(w, pick(w, pool), w.now + (w.config.hos === 'monarchy' ? 28 : w.config.termDays) * DAY);
  else if (m === 'rotate') {
    const s = pool.sort((a, b) => nm(w, a).localeCompare(nm(w, b)));
    setHos(w, s[(s.indexOf(w.hos.holder) + 1) % s.length], w.now + 7 * DAY);
  }
}
export function honour(w: W, actor: Id, target: Id, title: string) {
  if (!isHOS(w, actor)) fail(`Only the ${hosTitle(w)} awards honours.`);
  if (w.hos.lastHonour && w.now - w.hos.lastHonour < 7 * DAY) fail('One honour a week.');
  if ((title || '').trim().length < 3) fail('Name the honour.');
  const t = cit(w, target);
  w.hos.lastHonour = w.now;
  t.titles.push(title.trim());
  t.stats.honoured = true;
  stamp(w, target, title.trim(), `From the ${hosTitle(w)}`, 'good');
  earn(w, target, 5, 'Received an honour');
  approve(w, target, 3);
  gazette(w, 'hos', `The ${hosTitle(w)} honours ${t.name}: ${title.trim()}.`, '#/hos');
}

// ================= Parties =================
export const members = (w: W, pid: Id): Id[] => allCitizens(w).filter((c: any) => c.party === pid).map((c: any) => c.id);
export function foundParty(w: W, actor: Id, name: string, colour: string, cofounders: Id[]) {
  mustBeFree(w, actor);
  name = (name || '').trim();
  if (name.length < 3) fail('Name the party.');
  if (Object.values(w.parties).some((p: any) => p.name.toLowerCase() === name.toLowerCase())) fail('That name is taken.');
  const co = [...new Set(cofounders)].filter((c) => c && c !== actor);
  if (co.length < 2) fail('Name 2 co-founders.');
  transfer(w, ca(actor), 'treasury', 10, `Registered ${name}`);
  const id = newId(w, 'p');
  w.parties[id] = { id, name, colour, leader: actor, status: 'forming', invited: co, signed: [], founded: w.now, formingUntil: w.now + DAY, manifesto: [], motions: [] };
  gazette(w, 'party', `${nm(w, actor)} is forming the ${name}. Two co-founders have a day to sign.`, '#/parties');
}
export function cosign(w: W, actor: Id, pid: Id) {
  const p = w.parties[pid];
  if (!p || p.status !== 'forming' || !p.invited.includes(actor)) fail('You were not invited to co-found it.');
  if (!p.signed.includes(actor)) p.signed.push(actor);
  if (p.signed.length >= 2) {
    p.status = 'active';
    [p.leader, ...p.signed].forEach((m: Id) => (w.citizens[m].party = p.id));
    w.citizens[p.leader].stats.foundedParty = true;
    stamp(w, p.leader, 'Founded a party', p.name);
    gazette(w, 'party', `The ${p.name} is founded, led by ${nm(w, p.leader)}.`, '#/party/' + p.id);
  }
}
export function joinParty(w: W, actor: Id, pid: Id | null) {
  const c = cit(w, actor);
  if (pid && w.parties[pid]?.status !== 'active') fail('That party is not open.');
  const old = c.party && w.parties[c.party];
  c.party = pid;
  if (old && old.leader === actor) {
    const rest = members(w, old.id);
    old.leader = rest[0] || null;
    if (!rest.length) old.status = 'dissolved';
  }
  gazette(w, 'party', pid ? `${c.name} joins the ${w.parties[pid].name}.` : `${c.name} leaves the ${old ? old.name : 'party'}.`);
}
export function partyMotion(w: W, actor: Id, text: string) {
  const c = cit(w, actor);
  if (!c.party) fail('Join a party first.');
  if ((text || '').trim().length < 6) fail('Write the motion.');
  w.parties[c.party].motions.unshift({ id: newId(w, 'pm'), by: actor, text: text.trim(), votes: {}, status: 'open', at: w.now });
}
export function partyMotionVote(w: W, actor: Id, mid: Id, v: 'for' | 'against') {
  const c = cit(w, actor);
  const p = c.party && w.parties[c.party];
  const m = p?.motions.find((x: any) => x.id === mid);
  if (!m || m.status !== 'open') fail('That motion is closed.');
  m.votes[actor] = v;
  const n = members(w, p.id).length;
  const f = Object.values(m.votes).filter((x) => x === 'for').length;
  const a = Object.values(m.votes).filter((x) => x === 'against').length;
  if (f > n / 2) {
    m.status = 'passed';
    p.manifesto.push(m.text);
    gazette(w, 'party', `The ${p.name} conference adopts: "${m.text}".`, '#/party/' + p.id);
  } else if (a >= n / 2) m.status = 'failed';
}
export function challengeLeader(w: W, actor: Id, backers: Id[]) {
  const c = cit(w, actor);
  const p = c.party && w.parties[c.party];
  if (!p) fail('Join a party first.');
  if (p.leader === actor) fail('You already lead it.');
  if (backers.filter((b) => w.citizens[b]?.party === p.id && b !== actor).length < 2) fail('You need 2 members backing you.');
  const e = newElection(w, { kind: 'leadership', party: p.id, title: `${p.name} leadership contest`, stand: 'party:' + p.id, voters: 'party:' + p.id, closesAt: w.now + 2 * DAY });
  e.candidates[p.leader] = { id: p.leader, party: p.id };
  e.candidates[actor] = { id: actor, party: p.id };
  gazette(w, 'party', `${c.name} challenges ${nm(w, p.leader)} for the ${p.name} leadership.`, '#/election/' + e.id);
}

// ================= Forming a government =================
export const sideSeats = (w: W, side: string) => mps(w).filter((m) => sideOf(w, m) === side).length;
export function supportFor(w: W, id: Id) {
  const side = sideOf(w, id);
  const co = w.coalition;
  if (co?.status === 'signed' && co.sides.includes(side)) return co.sides.reduce((s: number, x: string) => s + sideSeats(w, x), 0);
  return sideSeats(w, side);
}
export const leaderOfSide = (w: W, side: string): Id | null => (side.startsWith('p:') ? w.parties[side.slice(2)]?.leader : side.slice(2));
export function clearMinisters(w: W) {
  Object.values(w.offices).forEach((o: any) => o.fill === 'pm' && (o.holder = null));
}
export function formGovernmentAfterElection(w: W) {
  w.pm = null;
  w.coalition = null;
  w.confidence = null;
  clearMinisters(w);
  w.pmInviteDue = w.now + DAY;
  if (w.config.hos === 'republic' && w.config.hosMethod !== 'citizens') startHosSelection(w);
  gazette(w, 'government', `The ${hosTitle(w)} will now invite someone who can win votes in the House to be Prime Minister. Parties can agree coalitions first.`, '#/cabinet');
}
export function invitePM(w: W, actor: Id | null, target: Id) {
  if (actor && !isHOS(w, actor)) fail(`Only the ${hosTitle(w)} invites the Prime Minister.`);
  if (w.pm) fail('There is already a Prime Minister.');
  const t = cit(w, target);
  noOfficeForRO(w, target);
  if (exiled(w, target)) fail('They are in exile.');
  w.pm = target;
  w.pmInviteDue = null;
  const s = supportFor(w, target);
  w.minority = s < majority(w);
  t.stats.wasPM = true;
  stamp(w, target, 'Prime Minister', actor ? `Invited by ${nm(w, actor)}` : 'Invited by convention', 'ink');
  gazette(w, 'government', `${t.name} becomes Prime Minister with ${s} of ${w.config.seats} seats${w.minority ? ', a minority government' : ''}.`, '#/cabinet');
}
export function autoInvite(w: W) {
  const leaders = new Set<Id>();
  Object.values(w.parties).forEach((p: any) => p.status === 'active' && p.leader && leaders.add(p.leader));
  mps(w).forEach((m) => leaders.add(m));
  const best = [...leaders].filter((l) => !w.citizens[l]?.admin && !exiled(w, l) && w.hos.holder !== l).sort((a, b) => supportFor(w, b) - supportFor(w, a))[0];
  if (best) invitePM(w, null, best);
  else w.pmInviteDue = w.now + DAY;
}
export function resignPM(w: W, actor: Id) {
  if (!isPM(w, actor)) fail('Only the Prime Minister can resign as PM.');
  gazette(w, 'government', `${nm(w, actor)} resigns as Prime Minister.`);
  meter(w, 'stability', -4, 'The Prime Minister resigned');
  w.pm = null;
  clearMinisters(w);
  w.confidence = null;
  w.pmInviteDue = w.now + DAY;
}
export function governmentFalls(w: W) {
  const by = w.confidence?.by;
  if (by && w.citizens[by]) w.citizens[by].stats.toppled = true;
  gazette(w, 'government', `${nm(w, w.pm)}'s government falls after failing to win back the House.`, '#/cabinet');
  meter(w, 'stability', -8, 'The government fell');
  approve(w, w.pm, -10);
  w.pm = null;
  clearMinisters(w);
  w.confidence = null;
  w.pmInviteDue = w.now + DAY;
}
export function leaderOfOpposition(w: W): Id | null {
  const gov = govSides(w);
  const opp = Object.values(w.parties)
    .filter((p: any) => p.status === 'active' && !gov.includes('p:' + p.id))
    .sort((a: any, b: any) => sideSeats(w, 'p:' + b.id) - sideSeats(w, 'p:' + a.id))[0] as any;
  return opp && sideSeats(w, 'p:' + opp.id) > 0 ? opp.leader : null;
}
export function setShadow(w: W, actor: Id, post: string, target: Id) {
  if (leaderOfOpposition(w) !== actor) fail('Only the Leader of the Opposition names the shadow cabinet.');
  w.shadow[post] = target || null;
}

// ================= Coalitions =================
export function proposeCoalition(w: W, actor: Id, partners: string[], kind: 'full' | 'cs', terms: string[]) {
  const own = sideOf(w, actor);
  if (leaderOfSide(w, own) !== actor) fail('Only a party leader or an independent MP can lead coalition talks.');
  if (!partners.length) fail('Pick at least one partner.');
  const sides = [own, ...partners.filter((p) => p !== own)];
  w.coalition = { id: newId(w, 'co'), lead: own, sides, kind, terms: terms.map((t) => t.trim()).filter(Boolean), signed: { [own]: true }, status: 'draft', promises: {}, at: w.now };
  gazette(w, 'government', `${sideName(w, own)} opens coalition talks with ${partners.map((p) => sideName(w, p)).join(' and ')}.`, '#/cabinet');
}
export function signCoalition(w: W, actor: Id) {
  const co = w.coalition;
  if (!co || co.status !== 'draft') fail('There is no coalition waiting for signatures.');
  const side = co.sides.find((s: string) => leaderOfSide(w, s) === actor);
  if (!side) fail('Only the leaders in the deal can sign.');
  co.signed[side] = true;
  if (co.sides.every((s: string) => co.signed[s])) {
    co.status = 'signed';
    gazette(w, 'government', `Coalition signed: ${co.sides.map((s: string) => sideName(w, s)).join(' and ')}. ${co.kind === 'full' ? 'Full coalition.' : 'Confidence and supply.'}`, '#/cabinet');
    if (Object.keys(co.promises).length)
      addCard(w, { title: `Before the coalition was signed, posts were promised: ${Object.entries(co.promises).map(([o, t]: any) => `${w.offices[o]?.title ?? o} to ${nm(w, t)}`).join(', ')}.`, about: leaderOfSide(w, co.lead), from: 'Coalition talks', level: 'restricted', viewers: co.sides.map((s: string) => 'cit:' + leaderOfSide(w, s)) });
    if (w.pm) w.minority = supportFor(w, w.pm) < majority(w);
  }
}
export function leaveCoalition(w: W, actor: Id) {
  const co = w.coalition;
  if (!co || co.status !== 'signed') fail('There is no coalition to leave.');
  const side = co.sides.find((s: string) => leaderOfSide(w, s) === actor);
  if (!side) fail('Only a leader in the coalition can walk out.');
  co.status = 'broken';
  meter(w, 'stability', -4, 'A coalition broke apart');
  gazette(w, 'government', `${sideName(w, side)} walks out of the coalition.`, '#/cabinet');
  if (w.pm) w.minority = supportFor(w, w.pm) < majority(w);
}
export function promisePost(w: W, actor: Id, officeId: string, target: Id) {
  const co = w.coalition;
  if (!co || leaderOfSide(w, co.lead) !== actor) fail('Only the leader running the talks can promise posts.');
  if (!w.offices[officeId] || w.offices[officeId].fill !== 'pm') fail('Pick a post the PM appoints.');
  co.promises[officeId] = target;
}

// ================= Seasons, ambitions and objectives =================
export const AMBITIONS = [
  { id: 'pm', text: 'Become Prime Minister', test: (c: any) => c.stats.wasPM },
  { id: 'laws', text: 'Get 2 of your proposals passed', test: (c: any) => (c.stats.passed || 0) >= 2 },
  { id: 'office', text: 'Hold any office', test: (c: any) => c.stats.heldOffice },
  { id: 'court', text: 'Win a case in the Supreme Court', test: (c: any) => (c.stats.courtWins || 0) > 0 },
  { id: 'topple', text: 'Bring down a government', test: (c: any) => c.stats.toppled },
  { id: 'rich', text: 'Hold 250 crowns at once', test: (c: any) => (c.stats.maxBalance || 0) >= 250 },
  { id: 'party', text: 'Found a party', test: (c: any) => c.stats.foundedParty },
  { id: 'honour', text: 'Receive an honour', test: (c: any) => c.stats.honoured },
  { id: 'scoop', text: 'Get a story on the front page', test: (c: any) => c.stats.frontPage }
];
export function assignAmbitions(w: W) {
  allCitizens(w).forEach((c: any) => {
    const a = pick(w, AMBITIONS);
    c.ambition = { id: a.id, text: a.text, reward: 30 };
    c.stats = { maxBalance: bal(w, ca(c.id)) };
  });
}
export function endSeason(w: W) {
  if (w.season.n === 0) {
    w.season = { n: 1, startedAt: w.now };
    assignAmbitions(w);
    return;
  }
  const cs = allCitizens(w);
  const reveals = cs.map((c: any) => {
    const a = AMBITIONS.find((x) => x.id === c.ambition?.id);
    const done = !!(a && a.test(c));
    if (done) earn(w, c.id, c.ambition.reward, 'Fulfilled your secret ambition');
    return { id: c.id, text: c.ambition?.text, done };
  });
  const ranked = cs.slice().sort((a: any, b: any) => (b.seasonEarned || 0) - (a.seasonEarned || 0));
  const champ = ranked[0];
  if (champ) {
    champ.titles.push(`Champion of Season ${w.season.n}`);
    stamp(w, champ.id, 'Champion', `Season ${w.season.n}`);
  }
  w.archive.unshift({
    n: w.season.n, from: w.season.startedAt, to: w.now, pm: w.pm, hos: w.hos.holder, champion: champ?.id,
    meters: { prosperity: w.meters.prosperity, stability: w.meters.stability },
    laws: w.laws.filter((l: any) => l.at >= w.season.startedAt).map((l: any) => ({ ref: l.ref, title: l.title })),
    top: ranked.slice(0, 5).map((c: any) => ({ id: c.id, n: c.seasonEarned || 0 })),
    reveals
  });
  gazette(w, 'season', `Season ${w.season.n} is over. ${champ ? champ.name + ' is champion.' : ''} Every secret ambition is now public.`, '#/season');
  cs.forEach((c: any) => (c.seasonEarned = 0));
  w.season = { n: w.season.n + 1, startedAt: w.now };
  assignAmbitions(w);
}

export const OBJECTIVES: { id: string; text: string; key: string; n: number; needs?: (w: W) => boolean }[] = [
  { id: 'vote2', text: 'Vote twice: on proposals or in elections', key: 'votes', n: 2 },
  { id: 'speak', text: 'Speak in a debate', key: 'speeches', n: 1 },
  { id: 'back', text: 'Back a question at PMQs', key: 'backs', n: 1 },
  { id: 'ask', text: 'Ask the Prime Minister a question', key: 'asks', n: 1 },
  { id: 'send', text: 'Send crowns to someone', key: 'sends', n: 1 },
  { id: 'cheer', text: 'Cheer a story in the press', key: 'cheers', n: 1 },
  { id: 'write', text: 'Write a story for a paper', key: 'stories', n: 1 },
  { id: 'venture', text: 'Back a trade venture', key: 'ventures', n: 1 },
  { id: 'save', text: 'Save crowns in a bank', key: 'saves', n: 1, needs: (w) => w.permits.banks && Object.keys(w.banks).length > 0 },
  { id: 'propose', text: 'Put a proposal before the House', key: 'proposals', n: 1 }
];
export function newObjectives(w: W) {
  const pool = OBJECTIVES.filter((o) => !o.needs || o.needs(w));
  allCitizens(w).forEach((c: any) => {
    c.week = {};
    c.objectives = shuffle(w, pool).slice(0, 3).map((o) => ({ id: o.id, text: o.text, key: o.key, n: o.n, done: false }));
  });
}
export function checkObjectives(w: W, id: Id) {
  const c = w.citizens[id];
  if (!c?.objectives) return;
  c.objectives.forEach((o: any) => {
    if (!o.done && (c.week[o.key] || 0) >= o.n) {
      o.done = true;
      earn(w, id, 5, `Objective: ${o.text}`);
      if (c.objectives.every((x: any) => x.done)) stamp(w, id, 'Full week', 'All 3 objectives', 'good');
    }
  });
}
