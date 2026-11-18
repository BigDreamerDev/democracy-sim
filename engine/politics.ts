// The Founding Convention, national elections (top N win, countback fills gaps), the head of state,
import { syncCrown } from './crown';
// parties, forming a government, coalitions, the shadow cabinet, seasons, ambitions and weekly objectives.
import {
  W, Id, DAY, HOUR, fail, newId, pick, rand, shuffle, cit, nm, allCitizens, exiled, mustBeFree, gazette, earn, stamp, approve,
  isMP, mps, isPM, isHOS, sideOf, sideName, govSides, majority, transfer, ca, addCard, meter, hosTitle, ordinal, tick, bal, fmtDay, bump, adminDid, own, text, barred, detained, legit, inForce } from './core';
import { national } from './acts';
import { openMarket, settleMarket } from './markets';
import { seasonAwards } from './glory';
import { leave } from './streets';
import { createOffice } from './offices';
import { TUTORIAL } from './tutorial';

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
// The Convention: every citizen votes on each clause. A majority of all citizens for one option settles a clause
// at once; when the Convention closes (3 days) every open clause takes its leading option. Players can add their
// own options to most clauses and table whole new clauses: a rule in words, or a different starting setting.
export const DOW = ['Sundays', 'Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays'];
const hh = (h: number) => String(h).padStart(2, '0') + ':00';
export const calLabel = (v: { dow: number; hour: number }) => `${DOW[v.dow]} at ${hh(v.hour)}`;
// suggestion kinds: what a player may add to a clause, and how it's parsed
type Kind = 'name' | 'number' | 'calendar' | 'none';
const CLAUSE_SPECS: Record<string, { kind: Kind; min?: number; max?: number; unit?: string }> = {
  principle: { kind: 'none' }, hos: { kind: 'none' }, method: { kind: 'none' },
  name: { kind: 'name' }, seats: { kind: 'number', min: 3, max: 9, unit: 'seats' }, term: { kind: 'number', min: 1, max: 6, unit: 'weeks' },
  dividend: { kind: 'number', min: 0, max: 20, unit: 'crowns' }, payday: { kind: 'calendar' }, pmqs: { kind: 'calendar' }
};
export const conventionSpec = (id: string) => CLAUSE_SPECS[id] || { kind: 'none' as Kind };
const clause = (id: string, q: string, options: string[], vals: any[], def: number, extra: any = {}) => ({ id, q, options, vals, def, optBy: options.map(() => null), votes: {}, adopted: null, kind: 'core', ...extra });
export function conventionClauses() {
  return [
    clause('principle', 'Every citizen has one vote, and nothing binds the realm without a law.', ['Adopt', 'Reject'], [1, 0], 0),
    clause('name', 'What should the realm be called?', ['Kingdom of Aldmere', 'Realm of Westerly', 'Commonwealth of the Isles'], ['Kingdom of Aldmere', 'Realm of Westerly', 'Commonwealth of the Isles'], 0),
    clause('seats', 'How many seats in Parliament? The candidates with the most votes nationwide take them.', ['3', '5', '7'], [3, 5, 7], 1),
    clause('hos', 'Who is head of state?', ['A Monarch: reigns, signs every law', 'A President: elected, can veto bills'], ['monarchy', 'republic'], 0),
    clause('method', 'How is the head of state chosen?', [], [], 0, { needs: 'hos' }),
    clause('term', 'How long between general elections?', ['2 weeks', '3 weeks', '4 weeks'], [2, 3, 4], 1),
    clause('payday', 'When is payday? The dividend and wages are paid, and the week’s crisis lands.', ['Mondays at 09:00', 'Fridays at 18:00', 'Sundays at 12:00'], [{ dow: 1, hour: 9 }, { dow: 5, hour: 18 }, { dow: 0, hour: 12 }], 0),
    clause('pmqs', 'When are Prime Minister’s Questions?', ['Wednesdays at 20:00', 'Tuesdays at 19:00', 'Thursdays at 20:00'], [{ dow: 3, hour: 20 }, { dow: 2, hour: 19 }, { dow: 4, hour: 20 }], 0),
    clause('dividend', 'How much does every citizen get each payday?', ['3 crowns', '5 crowns', '8 crowns'], [3, 5, 8], 1),
    // how the realm votes
    clause('voting', 'How are elections counted?', ['One vote each: the most votes win', 'Ranked choice: number the candidates; votes transfer until the seats are filled', 'Approval: tick everyone you would accept; the most ticks win', 'Points: rank them; each place down scores one point less'], ['single', 'ranked', 'approval', 'borda'], 0, { group: 'voting' }),
    clause('billVoters', 'Who votes on bills?', ['MPs, in the House', 'Every citizen, on every bill (direct democracy)'], ['mps', 'all'], 0, { group: 'voting' }),
    clause('passRule', 'What does a proposal need to pass?', ['More ayes than noes', 'A majority of everyone entitled to vote, whether they turn up or not', 'Two-thirds of the votes cast'], ['cast', 'seats', 'twothirds'], 0, { group: 'voting' }),
    clause('conventionMethod', 'When this Convention closes, how are the clauses still open decided?', ['The option with the most first choices', 'Ranked choice: everyone’s rankings, counted by instant runoff'], ['plurality', 'ranked'], 0, { group: 'voting' }),
    // how the game starts
    clause('induction', 'How long is induction week, the practice run before the real game?', ['7 days', '3 days', 'No practice: start for real'], [7, 3, 0], 0, { group: 'start' }),
    clause('practiceBots', 'Practice opponents during induction?', ['4 practice bots', '8 practice bots', 'No bots, just us'], [4, 8, 0], 0, { group: 'start' })
  ];
}
// how many votes for one option settle a clause outright: a majority of all citizens
export const conventionNeed = (w: W) => Math.max(2, Math.floor(allCitizens(w).length / 2) + 1);
const openClause = (w: W, id: string) => {
  if (w.phase !== 'convention') fail('The convention has finished.');
  const c = w.convention.clauses.find((x: any) => x.id === id);
  if (!c || c.adopted !== null) fail('That clause is settled.');
  if (c.needs && w.convention.clauses.find((x: any) => x.id === c.needs).adopted === null) fail('This opens once the head of state clause is settled.');
  return c;
};
export function conventionVote(w: W, actor: Id, clauseId: string, option: number) {
  const c = openClause(w, clauseId);
  if (!(Number.isInteger(option) && option >= 0 && option < c.options.length)) fail('Pick an option.');
  if (c.votes[actor] === undefined) {
    earn(w, actor, 2, 'Voted at the Convention');
    tick(w, actor, 'votes');
  }
  if (c.ranks?.[actor] && c.ranks[actor][0] !== option) delete c.ranks[actor];
  c.votes[actor] = option;
  const counts = c.options.map((_: any, i: number) => Object.values(c.votes).filter((v) => v === i).length);
  const top = counts.findIndex((n: number) => n >= conventionNeed(w));
  if (top >= 0) adoptClause(w, c, top);
}
// a full ranking of a clause's options; your first choice also counts as your vote
export function conventionRank(w: W, actor: Id, clauseId: string, ranking: any) {
  const c = openClause(w, clauseId);
  if (!Array.isArray(ranking) || !ranking.length) fail('Rank at least one option.');
  if (ranking.some((i) => !(Number.isInteger(i) && i >= 0 && i < c.options.length)) || new Set(ranking).size !== ranking.length) fail('Rank each option once.');
  c.ranks = c.ranks || {};
  c.ranks[actor] = ranking.slice();
  conventionVote(w, actor, clauseId, ranking[0]);
}
// instant runoff over the rankings (a plain vote counts as a ranking of one)
function runoff(w: W, c: any): number | null {
  const papers = Object.keys(c.votes).map((v) => (c.ranks?.[v]?.length ? c.ranks[v] : [c.votes[v]]));
  if (!papers.length) return null;
  const out = new Set<number>();
  for (let guard = 0; guard < 20; guard++) {
    const t: Record<number, number> = {};
    c.options.forEach((_: any, i: number) => !out.has(i) && (t[i] = 0));
    let live = 0;
    papers.forEach((p: number[]) => {
      const i = p.find((x) => !out.has(x));
      if (i !== undefined) (t[i]++, live++);
    });
    const ids = Object.keys(t).map(Number);
    const best = ids.sort((a, b) => t[b] - t[a])[0];
    if (t[best] * 2 > live || ids.length <= 1) return t[best] > 0 ? best : null;
    const min = Math.min(...ids.map((i) => t[i]));
    const lows = ids.filter((i) => t[i] === min);
    if (lows.length === ids.length) return null;
    out.add(lows[lows.length - 1]);
  }
  return null;
}
const mineCount = (w: W, actor: Id) =>
  w.convention.clauses.reduce((n: number, c: any) => n + c.optBy.filter((b: any) => b === actor).length + (c.by === actor ? 1 : 0), 0);
// add an option to a clause: a name, a number, or a day and hour
export function conventionSuggest(w: W, actor: Id, clauseId: string, raw: any) {
  const c = openClause(w, clauseId);
  const spec = conventionSpec(c.kind === 'core' ? c.id : '');
  if (spec.kind === 'none') fail('This clause has fixed options.');
  if (c.options.length >= 8) fail('This clause already has 8 options. Vote for one of them.');
  if (mineCount(w, actor) >= 4) fail('You have made 4 suggestions already. Leave room for others.');
  let label = '', val: any;
  if (spec.kind === 'name') {
    val = String(raw?.text || '').trim().replace(/\s+/g, ' ');
    if (val.length < 3 || val.length > 40) fail('A name of 3 to 40 characters.');
    if (!/^[\p{L}\p{N} '’\-.&]+$/u.test(val)) fail('Letters, numbers, spaces and simple punctuation only.');
    label = val;
  } else if (spec.kind === 'number') {
    val = Math.round(Number(raw?.value));
    if (!(val >= spec.min! && val <= spec.max!)) fail(`Pick a number from ${spec.min} to ${spec.max}.`);
    label = `${val} ${val === 1 ? spec.unit!.replace(/s$/, '') : spec.unit}`;
  } else {
    const dow = Number(raw?.dow), hour = Number(raw?.hour);
    if (!(Number.isInteger(dow) && dow >= 0 && dow <= 6 && Number.isInteger(hour) && hour >= 0 && hour <= 23)) fail('Pick a day and an hour.');
    val = { dow, hour };
    label = calLabel(val);
  }
  if (c.options.some((o: string) => o.toLowerCase() === label.toLowerCase())) fail('That option is already on the ballot.');
  c.options.push(label);
  c.vals.push(val);
  c.optBy.push(actor);
  tick(w, actor, 'conventionIdeas');
  gazette(w, 'convention', `${nm(w, actor)} adds an option to “${c.q}”: ${label}.`, '#/convention');
}
// table a whole new clause: a rule in words, or a different starting value for a setting
export function conventionPropose(w: W, actor: Id, a: any) {
  if (w.phase !== 'convention') fail('The convention has finished.');
  if (mineCount(w, actor) >= 4) fail('You have made 4 suggestions already. Leave room for others.');
  if (w.convention.clauses.filter((c: any) => c.kind !== 'core').length >= 14) fail('The Convention has enough extra clauses. Vote on those.');
  if (w.convention.clauses.filter((c: any) => c.by === actor).length >= 2) fail('You can table 2 clauses of your own.');
  let c: any;
  if (a?.setting) {
    const s = own(SETTABLE_START, a.setting);
    if (!s) fail('Pick a setting to change.');
    const v = Math.round(Number(a.value));
    if (!(v >= s.min && v <= s.max)) fail(`${s.label}: pick from ${s.min} to ${s.max}.`);
    if (v === w.config[a.setting]) fail('That is already the starting value.');
    if (w.convention.clauses.some((x: any) => x.kind === 'setting' && x.setting === a.setting && x.adopted === null && x.vals[0] === v)) fail('Someone has already tabled exactly that.');
    c = { kind: 'setting', setting: a.setting, q: `Start with ${s.label.toLowerCase()} at ${v}${s.unit} (normally ${w.config[a.setting]}${s.unit}).` };
    c.vals = [v, null];
  } else {
    c = { kind: 'custom', q: text(a?.text, 12, 300, 'rule'), vals: [true, false] };
  }
  const id = newId(w, 'cl');
  w.convention.clauses.push({ ...c, id, options: ['Adopt', 'Reject'], optBy: [null, null], def: 1, by: actor, votes: {}, adopted: null, at: w.now });
  tick(w, actor, 'conventionIdeas');
  gazette(w, 'convention', `${nm(w, actor)} tables a new clause: “${c.q}”`, '#/convention');
}
// starting values players may ask the Convention to change (the House can change them later too)
export const SETTABLE_START: Record<string, { label: string; unit: string; min: number; max: number }> = {
  taxRate: { label: 'Income tax', unit: '%', min: 0, max: 50 },
  mpPay: { label: 'MP pay each week', unit: ' crowns', min: 0, max: 30 },
  ministerPay: { label: 'Minister pay each week', unit: ' crowns', min: 0, max: 30 },
  tariff: { label: 'Tariff on trade ventures', unit: '%', min: 0, max: 40 },
  debateHours: { label: 'Debate length', unit: ' hours', min: 12, max: 48 },
  voteHours: { label: 'Voting length', unit: ' hours', min: 12, max: 48 },
  intrigueDelayDays: { label: 'Days before the backroom opens', unit: ' days', min: 0, max: 28 }
};
function adoptClause(w: W, c: any, i: number) {
  if (c.id === 'principle' && i === 1) {
    c.votes = {};
    gazette(w, 'convention', 'The first clause was rejected. Votes reset so the convention can argue it again.', '#/convention');
    return;
  }
  c.adopted = i;
  const v = c.vals[i];
  if (c.kind === 'custom' || c.kind === 'setting') {
    gazette(w, 'convention', `The convention ${i === 0 ? 'adopts' : 'rejects'}: “${c.q}”`, '#/convention');
    if (c.kind === 'setting' && i === 0) w.config[c.setting] = v;
  } else {
    gazette(w, 'convention', `The convention settles “${c.q}”: ${c.options[i]}.`, '#/convention');
    if (c.id === 'name') w.config.realmName = v;
    if (c.id === 'seats') w.config.seats = v;
    if (c.id === 'hos') {
      w.config.hos = v;
      const m = w.convention.clauses.find((x: any) => x.id === 'method');
      m.options = HOS_METHODS[w.config.hos].map((o) => o.label);
      m.vals = HOS_METHODS[w.config.hos].map((o) => o.id);
      m.optBy = m.options.map(() => null);
    }
    if (c.id === 'method') w.config.hosMethod = v;
    if (c.id === 'term') w.config.termDays = v * 7;
    if (c.id === 'payday') w.calendar.payday = { ...v };
    if (c.id === 'pmqs') w.calendar.pmqs = { ...v };
    if (c.id === 'dividend') w.config.dividend = v;
    if (c.id === 'voting') w.config.voting = v;
    if (c.id === 'billVoters') w.config.billVoters = v;
    if (c.id === 'passRule') w.config.passRule = v;
    if (c.id === 'conventionMethod') w.convention.method = v;
    if (c.id === 'induction') w.config.inductionDays = v;
    if (c.id === 'practiceBots') w.config.practiceBots = v;
  }
  if (w.convention.clauses.every((x: any) => x.adopted !== null)) finishConvention(w);
}
// the deadline: every open clause takes its leading option (ties go to the default); new clauses need more
// Adopt than Reject. The principle clause can't fail at the deadline: the realm needs it to exist.
export function closeConvention(w: W) {
  if (w.phase !== 'convention') return;
  gazette(w, 'convention', 'The Convention closes. Every open clause takes its leading option.', '#/convention');
  const order = (c: any) => (c.id === 'conventionMethod' ? -1 : c.id === 'hos' ? 0 : c.id === 'method' ? 1 : 2);
  w.convention.closing = true; // adoptClause must not finish the Convention halfway through this loop
  [...w.convention.clauses].sort((a: any, b: any) => order(a) - order(b)).forEach((c: any) => {
    if (c.adopted !== null) return;
    const counts = c.options.map((_: any, i: number) => Object.values(c.votes).filter((v) => v === i).length);
    const top = Math.max(0, ...counts);
    let pick = top > 0 && counts.filter((n: number) => n === top).length === 1 ? counts.indexOf(top) : c.def;
    if (w.convention.method === 'ranked' && c.id !== 'conventionMethod') {
      const r = runoff(w, c);
      if (r !== null) pick = r;
    }
    if (c.id === 'principle') pick = 0;
    if (!(pick < c.options.length)) pick = 0;
    adoptClause(w, c, pick);
  });
  w.convention.closing = false;
  finishConvention(w);
}
export function finishConvention(w: W) {
  if (w.convention.closing) return;
  w.phase = 'running';
  w.startedAt = w.now;
  w.seats = Array(w.config.seats).fill(null);
  const extra = w.convention.clauses.filter((c: any) => c.kind !== 'core' && c.adopted === 0).map((c: any) => (c.kind === 'custom' ? c.q : c.q.replace(/^Start with/, 'The realm starts with').replace(/ \(normally.*\)\.$/, '.')));
  w.laws.push({
    ref: 'L001', title: 'Founding Act', summary: `Adopts the constitution of the ${w.config.realmName}.`, at: w.now, how: 'Founding Convention', repealed: false, classified: false, rulings: [], propId: null,
    text: [
      'Every citizen has one vote, and nothing binds the realm without a law.',
      `The realm is the ${w.config.realmName}.`,
      `Parliament has ${w.config.seats} seats. At each general election the ${w.config.seats} candidates with the most votes nationwide take them. A seat that falls empty goes to the next candidate in line.`,
      `${w.config.hos === 'monarchy' ? 'A Monarch' : 'A President'} is head of state, ${HOS_METHODS[w.config.hos].find((m) => m.id === w.config.hosMethod)!.label.toLowerCase()}.`,
      `A general election every ${w.config.termDays / 7} week${w.config.termDays === 7 ? '' : 's'}.`,
      `Payday is ${calLabel(w.calendar.payday)}, when every citizen receives ${w.config.dividend} crowns. Prime Minister’s Questions are ${calLabel(w.calendar.pmqs)}.`,
      'There is a Chief Whip, appointed by the Prime Minister.',
      ...extra
    ]
  });
  createOffice(w, { template: 'whip' }, 'L001');
  gazette(w, 'law', `The constitution is adopted. The ${w.config.realmName} is founded.`, '#/law/L001');
  startInduction(w);
  callGeneralElection(w, w.now + 2 * DAY);
  if (w.config.hos === 'monarchy') startHosSelection(w);
}

// ================= Induction week =================
// The first week after the Convention is practice. Everything works, the backroom included, so people can learn
// by doing. When it ends the realm goes back to the moment the constitution was adopted (keeping new citizens,
// tutorial progress and the public admin log) and the real first election opens.
export function startInduction(w: W) {
  const days = w.config.inductionDays ?? 7;
  if (!days) return;
  const snap = structuredClone(w);
  delete snap.induction;
  w.induction = { until: w.now + days * DAY, startedAt: w.now, snapshot: snap, done: false, nextBotAt: null };
  // practice opponents: clearly named, gone when induction ends (they aren't in the snapshot)
  const bots = Math.max(0, Math.min(8, w.config.practiceBots ?? 4));
  PRACTICE_BOTS.slice(0, bots).forEach((name, i) => {
    const id = 'bot' + (i + 1);
    w.citizens[id] = { id, name: name + ' (bot)', bot: true, party: null, admin: false, active: true, joinedAt: w.now, influence: 10, seasonEarned: 0, approval: 50, log: [], stamps: [], titles: [], censures: 0, stats: {}, whip: { loyal: 0, rebel: 0 }, week: {}, objectives: [], exiledUntil: null, asylum: null, ambition: null, weekIncome: 0, tutorial: {} };
    transfer(w, 'reserve', ca(id), 100, 'Practice bot float');
  });
  if (bots) w.induction.nextBotAt = w.now + HOUR;
  gazette(w, 'induction', `Induction week begins. For ${days} days everything is practice: stand, vote, legislate, scheme. On ${fmtDay(w.induction.until)} the realm resets and the real first election opens.`, '#/learn');
}
export function endInduction(w: W) {
  const ind = w.induction;
  if (!ind || ind.done) return;
  const snap = ind.snapshot;
  const keep = { citizens: w.citizens, drafts: w.drafts, pending: w.pending, adminLog: w.adminLog, rng: w.rng, nextId: w.nextId, flags: w.flags, now: w.now, gazette: w.gazette, daily: w.daily, dailyPast: w.dailyPast, zones: w.streets?.zones };
  Object.keys(w).forEach((k) => delete w[k]);
  Object.assign(w, structuredClone(snap));
  w.now = keep.now;
  w.rng = keep.rng;
  w.nextId = Math.max(keep.nextId, w.nextId);
  w.pending = keep.pending;
  w.adminLog = keep.adminLog;
  w.flags = keep.flags;
  // the daily Red Box and the Streets' safe zones are not practice: they carry on
  if (keep.daily) w.daily = keep.daily;
  if (keep.dailyPast) w.dailyPast = keep.dailyPast;
  if (keep.zones && w.streets) w.streets.zones = keep.zones;
  // drafts are writing, not practice: they carry on, without the practice bots
  w.drafts = Object.fromEntries(Object.entries(keep.drafts || {}).filter(([, d]: any) => !keep.citizens[d.by]?.bot));
  Object.values(w.drafts).forEach((d: any) => Object.keys(d.sponsors).forEach((k) => keep.citizens[k]?.bot && delete d.sponsors[k]));
  // the Gazette keeps everything from before induction, then a line for the week of practice
  const before = new Set(snap.gazette.map((g: any) => g.id));
  const practised = keep.gazette.filter((g: any) => !before.has(g.id)).length;
  w.gazette = snap.gazette;
  Object.values(keep.citizens).forEach((c: any) => {
    if (c.bot) return;
    const fresh = w.citizens[c.id];
    if (!fresh) {
      // joined during induction: a clean start like everyone else
      w.citizens[c.id] = { ...c, party: null, influence: 10, seasonEarned: 0, approval: 50, log: [], stamps: [], titles: [], censures: 0, stats: {}, whip: { loyal: 0, rebel: 0 }, week: {}, objectives: [], exiledUntil: null, asylum: null, ambition: null, weekIncome: 0, life: {}, ghostUntil: null, deaths: [] };
      if (c.active !== false) {
        w.accounts.reserve = (w.accounts.reserve || 0) - 100;
        w.accounts['c:' + c.id] = 100;
      }
    } else fresh.admin = c.admin;
    const now = w.citizens[c.id];
    // a duplicate account removed during induction stays removed (the snapshot is pre-election, so it holds no seat)
    if (c.active === false) {
      now.active = false;
      now.removed = c.removed;
      now.party = null;
      Object.values(w.offices).forEach((o: any) => {
        if (o.holder === c.id) o.holder = null;
        o.members = (o.members || []).filter((m: Id) => m !== c.id);
      });
      if (w.hos.holder === c.id) w.hos = { holder: null, since: w.now, until: null };
      return;
    }
    now.tutorial = c.tutorial || {};
    // opting in to the Streets is consent, not practice; it carries over (contracts made in practice do not)
    now.streets = c.streets?.in ? { in: true, since: w.now } : c.streets || { in: false };
    now.tagCode = c.tagCode || null;
    now.meetCode = c.meetCode || null;
    now.streak = c.streak;
    // real Influence for every induction mission done
    const n = Object.keys(now.tutorial).length;
    if (n) earn(w, c.id, n, 'Completed induction missions');
    if (n >= TUTORIAL.length) stamp(w, c.id, 'Inducted', 'All missions', 'ink');
  });
  w.induction = { until: ind.until, startedAt: ind.startedAt, done: true, endedAt: w.now };
  w.startedAt = w.now;
  w.phase = 'running';
  w.seats = Array(w.config.seats).fill(null);
  w.nextGeneralAt = null;
  gazette(w, 'induction', `Induction week is over: ${practised} practice events are wiped. Everyone starts fresh, and the real first general election opens now.`, '#/elections');
  callGeneralElection(w, w.now + 2 * DAY);
  if (w.config.hos === 'monarchy') startHosSelection(w);
}
export const PRACTICE_BOTS = ['Ada', 'Barnaby', 'Clem', 'Dot', 'Ezra', 'Fen', 'Gus', 'Hattie'];
export const inInduction = (w: W) => !!w.induction && !w.induction.done && w.now < w.induction.until;

// ================= Elections =================
// stand: who may stand ('all' or 'party:<id>'); voters: 'all', 'mps' or 'party:<id>'; winners: how many win
export function newElection(w: W, e: any) {
  const id = newId(w, 'e');
  w.elections[id] = { id, status: 'open', candidates: {}, ballots: {}, polls: [], predictions: {}, opensAt: w.now, results: null, stand: 'all', voters: 'all', winners: 1, method: w.config.voting || 'single', ...e };
  const el = w.elections[id];
  if (el.closesAt && w.phase === 'running') openMarket(w, 'election', id, el.kind === 'general' ? `Who tops the poll in the ${el.title.replace(/^General election for the /, '').replace(/^./, (x: string) => x.toLowerCase())} election?` : `Who wins the ${el.title.replace(/^./, (x: string) => x.toLowerCase())}?`, null, el.closesAt);
  return el;
}
export function callGeneralElection(w: W, closesAt: number) {
  // under the Continuity of Parliament Act nothing calls one: not a term ending, a dissolution, a crisis or a regime falling
  if (inForce(w, 'continuity')) return false;
  const g = newElection(w, { kind: 'general', title: `General election for the ${ordinal(w.season.n + 1)} Parliament`, winners: w.config.seats, closesAt });
  const s = newElection(w, { kind: 'speaker', title: 'Election for Speaker', closesAt });
  // sitting MPs and the Speaker stand again automatically; they can withdraw
  // (not the barred or the detained, and in a one-party state only Party members)
  const nid = national(w);
  const may = (m: Id) => !exiled(w, m) && !barred(w, m) && !detained(w, m) && !(w.regime?.type === 'party' && w.citizens[m].party !== w.regime.party) && !(nid && w.citizens[m].party !== nid);
  mps(w).forEach((m) => may(m) && (g.candidates[m] = { id: m, party: w.citizens[m].party, at: w.now, incumbent: true }));
  if (w.speaker && may(w.speaker)) s.candidates[w.speaker] = { id: w.speaker, at: w.now, incumbent: true };
  if (w.config.hos === 'republic' && w.config.hosMethod === 'citizens' && !inForce(w, 'protection')) newElection(w, { kind: 'hos', title: 'Election for President', closesAt });
  w.nextGeneralAt = null;
  gazette(w, 'election', `Polls are open. The ${w.config.seats} candidates with the most votes nationwide win seats.`, '#/elections');
  return true;
}
export function canVote(w: W, e: any, id: Id) {
  const c = w.citizens[id];
  if (!c || !c.active || exiled(w, id) || detained(w, id) || e.status !== 'open') return false;
  if (e.voters === 'mps') return isMP(w, id);
  if (e.voters.startsWith('party:')) return c.party === e.voters.slice(6);
  return true;
}
export function stand(w: W, actor: Id, eid: Id) {
  mustBeFree(w, actor);
  const e = own(w.elections, eid);
  if (!e || e.status !== 'open') fail('That election is not open.');
  const c = cit(w, actor);
  if (e.stand.startsWith('party:') && c.party !== e.stand.slice(6)) fail('Only party members can stand.');
  if (e.kind !== 'leadership' && barred(w, actor)) fail('You are barred from standing for office for now.');
  if (w.regime?.type === 'party' && ['general', 'speaker', 'office'].includes(e.kind) && c.party !== w.regime.party) fail('Only members of the Party may stand.');
  if (national(w) && c.party !== national(w)) fail('Only members of the National Party may stand.');
  if (e.candidates[actor]) fail('You are already standing.');
  if ((e.withdrawn || []).includes(actor)) fail('You withdrew from this election. You can’t stand again in it.');
  e.candidates[actor] = { id: actor, party: c.party, at: w.now };
  gazette(w, 'election', `${c.name} stands in the ${e.title.toLowerCase()}.`, '#/election/' + e.id);
}
export function withdraw(w: W, actor: Id, eid: Id) {
  const e = own(w.elections, eid);
  if (!e || e.status !== 'open' || !own(e.candidates, actor)) fail('You are not standing.');
  // once anyone has voted for you, withdrawing would spoil their ballot (and could be repeated to farm Influence)
  if (Object.values(e.ballots).some((b: any) => b === actor || (Array.isArray(b) && b.includes(actor)))) fail('People have voted for you. You can’t withdraw now.');
  delete e.candidates[actor];
  e.withdrawn = [...(e.withdrawn || []), actor];
}
// Returning Officer: take a candidate off the ballot at their request, even after votes are in.
// Votes for them are struck out (a ranked/approval ballot keeps its other names); those voters can vote again.
export function adminWithdraw(w: W, actor: Id, eid: Id, cand: Id, reason: unknown) {
  if (!w.citizens[actor]?.admin) fail('Only the Returning Officer can do this.');
  const e = own(w.elections, eid);
  if (!e || e.status !== 'open') fail('That election is not open.');
  if (!own(e.candidates, cand)) fail('They are not standing.');
  if (own(e.candidates, actor)) fail('You are standing in this election, so you cannot use admin tools on it.');
  const why = text(reason, 6, 200, 'reason');
  let struck = 0;
  Object.keys(e.ballots).forEach((v) => {
    const b = e.ballots[v];
    if (b === cand) { delete e.ballots[v]; struck++; return; }
    if (Array.isArray(b) && b.includes(cand)) {
      struck++;
      const rest = b.filter((c: Id) => c !== cand);
      if (rest.length) e.ballots[v] = rest; else delete e.ballots[v];
    }
  });
  delete e.candidates[cand];
  e.withdrawn = [...(e.withdrawn || []), cand];
  e.moves = (e.moves || 0) + 1;
  adminDid(w, actor, `withdrew ${nm(w, cand)} from the ${e.title.replace(/^./, (x: string) => x.toLowerCase())}: ${why}`, '#/election/' + e.id);
  if (struck) gazette(w, 'election', `${struck} ballot${struck === 1 ? '' : 's'} naming ${nm(w, cand)} ${struck === 1 ? 'was' : 'were'} struck out. Check your ballot and vote again.`, '#/election/' + e.id);
}
// Returning Officer: close an open election now and count it. Public, with a reason.
// If you're standing in it, only once everyone who can vote has voted (closing early then changes nothing).
export function adminClose(w: W, actor: Id, eid: Id, reason: unknown) {
  if (!w.citizens[actor]?.admin) fail('Only the Returning Officer can do this.');
  const e = own(w.elections, eid);
  if (!e || e.status !== 'open') fail('That election is not open.');
  const why = text(reason, 6, 200, 'reason');
  const left = allCitizens(w).filter((c: any) => canVote(w, e, c.id) && e.ballots[c.id] === undefined).length;
  if (own(e.candidates, actor) && left) fail(`You are standing in this election, so you can only close it once everyone has voted. ${left} still can.`);
  const turnout = Object.keys(e.ballots).length;
  e.closesAt = w.now;
  adminDid(w, actor, `closed the ${e.title.replace(/^./, (x: string) => x.toLowerCase())} early, with ${turnout} ballot${turnout === 1 ? '' : 's'} in${left ? ` and ${left} not yet voted` : ''}: ${why}`, '#/election/' + e.id);
  closeElection(w, e);
}
// ---------- how ballots are cast and counted: chosen at the Convention (config.voting) ----------
export const VOTING: Record<string, { label: string; short: string; how: string; unit: string }> = {
  single: { label: 'One vote each: the most votes win', short: 'Single vote', how: 'Vote for one candidate.', unit: 'votes' },
  ranked: { label: 'Ranked choice: number the candidates; votes transfer until the seats are filled', short: 'Ranked choice', how: 'Number as many candidates as you like, 1 for your favourite. If your 1 can’t win or has votes to spare, your vote moves to your next choice.', unit: 'first preferences' },
  approval: { label: 'Approval: tick everyone you would accept; the most ticks win', short: 'Approval', how: 'Tick every candidate you would be happy with.', unit: 'approvals' },
  borda: { label: 'Points: rank them; each place down scores one point less', short: 'Points (Borda)', how: 'Number the candidates in order. First place scores the most points.', unit: 'points' }
};
export function castBallot(w: W, actor: Id, eid: Id, cand: Id, a: any = {}) {
  const e = own(w.elections, eid);
  if (!e || !canVote(w, e, actor)) fail('You cannot vote in this election.');
  if (e.status !== 'open') fail('This election has closed.');
  // a ballot can be changed until the polls close; only the first one earns Influence
  const again = e.ballots[actor] !== undefined;
  e.moves = (e.moves || 0) + 1;
  const method = e.method || 'single';
  if (method === 'single') {
    if (!own(e.candidates, cand)) fail('That person is not standing.');
    e.ballots[actor] = cand;
  } else {
    // ranked and points take an ordered list; approval takes a set. One name on its own is fine for all three.
    const list: Id[] = Array.isArray(a.ranking) ? a.ranking : Array.isArray(a.approve) ? a.approve : cand ? [cand] : [];
    if (!list.length) fail(method === 'approval' ? 'Tick at least one candidate.' : 'Number at least one candidate.');
    if (new Set(list).size !== list.length) fail('Each candidate can appear only once on your ballot.');
    if (list.some((c) => !own(e.candidates, c))) fail('Your ballot names someone who is not standing.');
    e.ballots[actor] = list.slice();
  }
  if (again) return;
  earn(w, actor, 2, 'Voted in an election');
  tick(w, actor, 'votes');
}
// ---------- Newsnight: a public exit poll every few hours while the polls are open ----------
// Published only once NEWSNIGHT_MOVES ballots have been cast or changed since the last one, so the change
// between two polls never shows how one person voted. e.moves (that count) is private: viewFor strips it.
export const NEWSNIGHT_EVERY = 10 * 60000;
export const NEWSNIGHT_MOVES = 3;
export const newsnightDue = (e: any) => (e.status === 'open' ? (e.pollAt || e.opensAt) + NEWSNIGHT_EVERY : null);
export function newsnight(w: W, e: any) {
  e.pollAt = w.now;
  e.polls ??= [];
  const turnout = Object.keys(e.ballots).length;
  if ((e.moves || 0) - (e.movesAtPoll || 0) < NEWSNIGHT_MOVES || turnout < NEWSNIGHT_MOVES || !Object.keys(e.candidates).length) return;
  e.movesAtPoll = e.moves;
  const r: any = countElection(w, e);
  const projected = r.ranked.slice(0, e.winners);
  const prev = e.polls[0];
  e.polls.unshift({ at: w.now, turnout, counts: r.counts, projected, close: !!r.draw, rounds: r.rounds ? r.rounds.length : null });
  if (e.polls.length > 20) e.polls.length = 20;
  // the Gazette hears only when the call changes, or it would fill up every 10 minutes
  if (prev && prev.close === !!r.draw && prev.projected.join() === projected.join()) return;
  const gains = prev ? projected.filter((c: Id) => !prev.projected.includes(c)) : [];
  const call = r.draw ? 'too close to call at the line' : e.winners === 1 ? `${nm(w, projected[0])} on course to win` : `projected to win: ${projected.map((c: Id) => nm(w, c)).join(', ')}`;
  gazette(w, 'newsnight', `Newsnight exit poll, ${e.title.replace(/^./, (x: string) => x.toLowerCase())}: ${call}. ${turnout} ballot${turnout === 1 ? '' : 's'} in.${gains.length ? ` New in the frame: ${gains.map((c: Id) => nm(w, c)).join(', ')}.` : ''}`, '#/election/' + e.id);
}
// ---------- the pundit desk: call the winners before the last hour, free; scored when the polls close ----------
export const PUNDIT_LOCK = HOUR;
export function predict(w: W, actor: Id, eid: Id, picks: unknown) {
  const e = own(w.elections, eid);
  if (!e || e.status !== 'open') fail('That election is not open.');
  if (!cit(w, actor)) fail('Only citizens can make a call.');
  if (w.now >= e.closesAt - PUNDIT_LOCK) fail('The pundit desk closes an hour before the polls do.');
  const n = Math.min(e.winners, Object.keys(e.candidates).length);
  if (!Array.isArray(picks) || picks.length !== n || picks.some((c) => typeof c !== 'string')) fail(n === 1 ? 'Pick one winner.' : `Pick exactly ${n} winners.`);
  if (new Set(picks).size !== picks.length) fail('Pick each candidate only once.');
  if ((picks as Id[]).some((c) => !own(e.candidates, c))) fail('You picked someone who is not standing.');
  e.predictions ??= {};
  const first = !e.predictions[actor];
  e.predictions[actor] = { picks: (picks as Id[]).slice(), at: w.now };
  if (first) bump(w, actor, 'punditCalls');
}
function scorePundits(w: W, e: any, winners: Id[]) {
  const preds = Object.entries(e.predictions || {}) as [Id, any][];
  if (!preds.length || !winners.length) return;
  const perfect: Id[] = [];
  preds.forEach(([id, p]) => {
    if (!w.citizens[id]) return;
    const hits = p.picks.filter((c: Id) => winners.includes(c)).length;
    p.hits = hits;
    if (!hits) return;
    const all = hits === winners.length;
    earn(w, id, hits + (all ? 2 : 0), all ? 'Called the election perfectly' : 'Called part of the election');
    bump(w, id, 'punditHits', hits);
    if (all) (bump(w, id, 'punditPerfect'), perfect.push(id));
  });
  gazette(w, 'newsnight', `Pundit desk, ${e.title.replace(/^./, (x: string) => x.toLowerCase())}: ${!perfect.length ? 'nobody called it perfectly' : perfect.length > 4 ? `${perfect.length} pundits called it perfectly` : `${perfect.map((id) => nm(w, id)).join(', ')} called it perfectly`}. ${preds.length} made a call.`, '#/election/' + e.id);
}
// ---------- the Newsnight anchor desk: newspaper editors add a line to the latest exit poll ----------
export function anchor(w: W, actor: Id, eid: Id, line: unknown) {
  const e = own(w.elections, eid);
  if (!e || e.status !== 'open') fail('That election is not open.');
  const paper = Object.values(w.papers || {}).find((p: any) => p.editor === actor) as any;
  if (!paper) fail('Only a newspaper editor can anchor Newsnight. Found a paper first.');
  const poll = e.polls?.[0];
  if (!poll) fail('There is no exit poll to comment on yet.');
  poll.comments ??= [];
  if (poll.comments.some((c: any) => c.by === actor)) fail('You have already had your say on this poll.');
  if (poll.comments.length >= 5) fail('The panel is full for this poll. Wait for the next one.');
  poll.comments.push({ by: actor, paper: paper.name, text: text(line, 3, 200, 'comment'), at: w.now });
}
// every method returns the same shape: a score per candidate for display, the full order (winners first, then
// the countback list), and for ranked choice the rounds of the count
function countElection(w: W, e: any) {
  const cands = Object.keys(e.candidates);
  const lot: Record<Id, number> = {};
  cands.forEach((c) => (lot[c] = rand(w)));
  const method = e.method || 'single';
  const ballots: any[] = Object.values(e.ballots);
  const counts: Record<Id, number> = {};
  cands.forEach((c) => (counts[c] = 0));
  const asList = (b: any): Id[] => (Array.isArray(b) ? b : [b]).filter((c: Id) => counts[c] !== undefined);
  if (method === 'single') ballots.forEach((b) => asList(b).slice(0, 1).forEach((c) => counts[c]++));
  if (method === 'approval') ballots.forEach((b) => asList(b).forEach((c) => counts[c]++));
  if (method === 'borda') ballots.forEach((b) => asList(b).forEach((c, i) => (counts[c] += Math.max(0, cands.length - 1 - i))));
  if (method === 'ranked') {
    ballots.forEach((b) => asList(b).slice(0, 1).forEach((c) => counts[c]++));
    const r = stv(asList, ballots, cands, Math.min(e.winners, cands.length), lot);
    const tied = r.rounds.some((x: any) => x.byLot);
    return { counts, ranked: r.order, draw: tied, rounds: r.rounds, quota: r.quota };
  }
  const ranked = cands.slice().sort((a, b) => counts[b] - counts[a] || lot[b] - lot[a]);
  const draws = ranked.filter((c, i) => i > 0 && counts[c] === counts[ranked[i - 1]] && i < e.winners + 1 && i >= e.winners - 1);
  return { counts, ranked, draw: draws.length > 0 };
}
// single transferable vote with fractional surplus transfers and a Droop quota; one seat makes it instant runoff
function stv(asList: (b: any) => Id[], raw: any[], cands: Id[], seats: number, lot: Record<Id, number>) {
  let papers = raw.map((b) => ({ prefs: asList(b), weight: 1 })).filter((p) => p.prefs.length);
  const quota = Math.floor(papers.length / (seats + 1)) + 1;
  const elected: Id[] = [];
  const out: Id[] = [];
  const rounds: any[] = [];
  const live = () => cands.filter((c) => !elected.includes(c) && !out.includes(c));
  const top = (p: any) => p.prefs.find((c: Id) => live().includes(c));
  for (let guard = 0; guard < 100 && elected.length < seats && live().length; guard++) {
    const tally: Record<Id, number> = {};
    live().forEach((c) => (tally[c] = 0));
    papers.forEach((p) => {
      const c = top(p);
      if (c) tally[c] += p.weight;
    });
    const round: any = { counts: Object.fromEntries(Object.entries(tally).map(([k, v]) => [k, Math.round(v * 100) / 100])) };
    rounds.push(round);
    const order = live().sort((a, b) => tally[b] - tally[a] || lot[b] - lot[a]);
    if (live().length <= seats - elected.length) {
      round.elected = order.slice();
      elected.push(...order);
      break;
    }
    if (tally[order[0]] >= quota) {
      const winner = order[0];
      round.elected = [winner];
      const surplus = tally[winner] - quota;
      const factor = tally[winner] > 0 ? surplus / tally[winner] : 0;
      papers.forEach((p) => top(p) === winner && (p.weight *= factor));
      elected.push(winner);
      continue;
    }
    const low = order[order.length - 1];
    if (order.length > 1 && tally[order[order.length - 2]] === tally[low]) round.byLot = true;
    round.eliminated = low;
    out.push(low);
  }
  // countback order: winners as elected, then the rest from the last eliminated back to the first
  const order = [...elected, ...live(), ...out.slice().reverse()];
  return { order, rounds, quota };
}
export function closeElection(w: W, e: any) {
  e.status = 'closed';
  e.closedAt = w.now;
  const r: any = countElection(w, e);
  // a rigged election: the regime's own people are counted in first, whatever the ballots say
  const rg = w.regime;
  if (rg?.rigged?.election === e.id) {
    const ours = r.ranked.filter((c: Id) => c === rg.leader || rg.council.includes(c) || (rg.party && w.citizens[c]?.party === rg.party));
    r.ranked = [...ours, ...r.ranked.filter((c: Id) => !ours.includes(c))];
  }
  const winners = r.ranked.slice(0, e.winners);
  e.results = { counts: r.counts, ranked: r.ranked, winners, draw: r.draw, turnout: Object.keys(e.ballots).length, method: e.method || 'single', rounds: r.rounds || null, quota: r.quota || null };
  scorePundits(w, e, winners);
  settleMarket(w, 'election', e.id, r.ranked[0] || null, r.ranked[0] ? [{ id: r.ranked[0], did: 'won it themselves' }] : []);
  if (e.kind === 'general') {
    w.seats = Array(w.config.seats).fill(null).map((_, i) => winners[i] || null);
    w.lastRanked = r.ranked;
    winners.forEach((id) => {
      stamp(w, id, 'Elected MP', `${ordinal(w.season.n + 1)} Parliament`, 'bad');
      earn(w, id, 10, 'Won a seat');
      bump(w, id, 'terms');
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
    if (p?.challenge?.status === 'contest') p.challenge.status = 'done';
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
  // under the Continuity of Parliament Act an empty seat waits for the Prime Minister to fill it
  if (inForce(w, 'continuity')) return;
  const nid = national(w);
  w.seats.forEach((s: Id | null, i: number) => {
    if (s) return;
    const next = (w.lastRanked || []).find((c: Id) => !w.seats.includes(c) && w.speaker !== c && w.hos.holder !== c && w.citizens[c]?.active && !exiled(w, c) && !barred(w, c) && !detained(w, c) && !(w.regime?.type === 'party' && w.citizens[c].party !== w.regime.party) && !(nid && w.citizens[c].party !== nid));
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
  if (!id) return syncCrown(w);
  if (isMP(w, id)) vacateSeat(w, id, `became ${hosTitle(w)}`);
  stamp(w, id, w.config.hos === 'monarchy' ? 'Crowned' : 'President', 'Head of state', 'ink');
  gazette(w, 'hos', `${nm(w, id)} becomes ${hosTitle(w)}.`, '#/hos');
  syncCrown(w);
}
export function startHosSelection(w: W) {
  // under the Protection of the State Act the Prime Minister appoints the next head of state
  if (inForce(w, 'protection')) return gazette(w, 'hos', `The Prime Minister will appoint the next ${hosTitle(w)}.`, '#/powers');
  const m = w.config.hosMethod;
  const pool = allCitizens(w).filter((c: any) => !exiled(w, c.id) && !detained(w, c.id)).map((c: any) => c.id);
  if (m === 'life' || m === 'citizens') {
    if (!Object.values(w.elections).some((e: any) => e.kind === 'hos' && e.status === 'open'))
      newElection(w, { kind: 'hos', title: w.config.hos === 'monarchy' ? 'Election of the Monarch, for life' : 'Election for President', closesAt: w.now + (w.config.hos === 'monarchy' ? 1 : 2) * DAY });
  } else if (m === 'house') newElection(w, { kind: 'hos', title: 'MPs elect the President', voters: 'mps', closesAt: w.now + DAY });
  else if (m === 'lot') setHos(w, pick(w, pool), w.now + (w.config.hos === 'monarchy' ? 28 : w.config.termDays) * DAY);
  else if (m === 'rotate') {
    const s = pool.sort((a, b) => nm(w, a).localeCompare(nm(w, b)));
    setHos(w, s[(s.indexOf(w.hos.holder) + 1) % s.length], w.now + 7 * DAY);
  }
}
export function honour(w: W, actor: Id, target: Id, title: string) {
  if (!isHOS(w, actor)) fail(`Only the ${hosTitle(w)} awards honours.`);
  // coronation honours: three on top of the weekly one
  const r = w.crown?.reign;
  const free = !!r && r.id === actor && r.honours > 0;
  // one a week, unless a law allows more (config.honoursPerWeek); counted over the last seven days
  const per = Math.max(1, Math.round(Number(w.config.honoursPerWeek) || 1));
  const recent = (w.hos.honoursAt || (w.hos.lastHonour ? [w.hos.lastHonour] : [])).filter((t: number) => w.now - t < 7 * DAY);
  if (!free && recent.length >= per) fail(per === 1 ? 'One honour a week.' : `All ${per} of this week’s honours are given.`);
  title = text(title, 2, 40, 'honour');
  const t = cit(w, target);
  if (free) r.honours -= 1;
  else (w.hos.lastHonour = w.now), (w.hos.honoursAt = [...recent, w.now]);
  t.titles.push(title.trim());
  t.stats.honoured = true;
  stamp(w, target, title.trim(), `From the ${hosTitle(w)}`, 'good');
  earn(w, target, 5, 'Received an honour');
  approve(w, target, 3);
  gazette(w, 'hos', `The ${hosTitle(w)} honours ${t.name}: ${title.trim()}.`, '#/hos');
}

// ================= Parties =================
export const members = (w: W, pid: Id): Id[] => allCitizens(w).filter((c: any) => c.party === pid).map((c: any) => c.id);
// a party is founded the moment it's registered: no co-founders. `cofounders` from older clients is ignored.
export function foundParty(w: W, actor: Id, name: string, colour: string) {
  mustBeFree(w, actor);
  name = text(name, 3, 40, 'party name');
  if (typeof colour !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(colour)) fail('Pick a colour.');
  if (national(w)) fail('No new party can be founded. The National Unity Act allows only the National Party.');
  if ((w.bannedParties || []).some((b: any) => b.name === name.toLowerCase() || b.colour === colour.toLowerCase())) fail('That party’s name or colour was outlawed, and can’t be used again.');
  if (Object.values(w.parties).some((p: any) => p.name.toLowerCase() === name.toLowerCase() && p.status !== 'lapsed')) fail('That name is taken.');
  transfer(w, ca(actor), 'treasury', 10, `Registered ${name}`);
  const id = newId(w, 'p');
  w.parties[id] = { id, name, colour, leader: actor, status: 'forming', invited: [], signed: [], founded: w.now, formingUntil: null, manifesto: [], motions: [] };
  activateParty(w, w.parties[id]);
  return id;
}
// founds a party: its leader, and anyone who already co-signed under the old rules, become members
export function activateParty(w: W, p: any) {
  p.status = 'active';
  p.formingUntil = null;
  [p.leader, ...(p.signed || [])].forEach((m: Id) => w.citizens[m] && (w.citizens[m].party = p.id));
  if (w.citizens[p.leader]) {
    w.citizens[p.leader].stats.foundedParty = true;
    stamp(w, p.leader, 'Founded a party', p.name);
  }
  gazette(w, 'party', `The ${p.name} is founded, led by ${nm(w, p.leader)}.`, '#/party/' + p.id);
}
// kept for older clients and apps: co-signing now just joins a party still waiting from before the change
export function cosign(w: W, actor: Id, pid: Id) {
  const p = own(w.parties, pid);
  if (!p || p.status !== 'forming' || !p.invited.includes(actor)) fail('Parties no longer need co-founders. Join one instead.');
  if (!p.signed.includes(actor)) p.signed.push(actor);
  activateParty(w, p);
}
export function joinParty(w: W, actor: Id, pid: Id | null) {
  const c = cit(w, actor);
  if (pid && own(w.parties, pid)?.status !== 'active') fail('That party is not open.');
  if (pid && w.regime?.type === 'party' && pid === w.regime.party) fail('Apply to the Party. The Chairman decides who gets a card.');
  if (pid && pid === national(w)) fail('Apply to join the National Party. The Prime Minister decides.');
  if (!pid && c.party && c.party === national(w) && w.pm === actor) fail('The Prime Minister leads the National Party while in office.');
  if (!pid && w.regime?.type === 'party' && w.regime.leader === actor) fail('The Chairman cannot leave the Party.');
  const old = c.party && w.parties[c.party];
  c.party = pid;
  if (old && old.leader === actor) {
    const rest = members(w, old.id);
    old.leader = rest[0] || null;
    if (!rest.length) old.status = 'dissolved';
  }
  if (pid) bump(w, actor, 'parties');
  gazette(w, 'party', pid ? `${c.name} joins the ${w.parties[pid].name}.` : `${c.name} leaves the ${old ? old.name : 'party'}.`);
}
export function partyMotion(w: W, actor: Id, motion: string) {
  const c = cit(w, actor);
  if (!c.party) fail('Join a party first.');
  const t = text(motion, 6, 300, 'motion');
  if (w.parties[c.party].motions.filter((m: any) => m.by === actor && m.status === 'open').length >= 3) fail('You have 3 motions open already.');
  w.parties[c.party].motions.unshift({ id: newId(w, 'pm'), by: actor, text: t, votes: {}, status: 'open', at: w.now });
}
export function partyMotionVote(w: W, actor: Id, mid: Id, v: 'for' | 'against') {
  const c = cit(w, actor);
  const p = c.party && w.parties[c.party];
  const m = p?.motions.find((x: any) => x.id === mid);
  if (!m || m.status !== 'open') fail('That motion is closed.');
  if (v !== 'for' && v !== 'against') fail('Vote for or against.');
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
// Leadership: a member starts a challenge; once enough members sign it (CHALLENGE_NEED: 3, or a quarter of the party if
// that's more) a contest opens. The leader stands automatically, any member can stand, members vote. A leader can also
// stand down, which opens a contest without them (they lead until it closes). A challenge not signed in 2 days lapses.
export const challengeNeed = (w: W, pid: Id) => Math.max(3, Math.ceil(members(w, pid).length / 4));
const contestOpen = (w: W, pid: Id) => Object.values(w.elections).some((e: any) => e.kind === 'leadership' && e.party === pid && e.status === 'open');
function openContest(w: W, p: any, incumbent: boolean) {
  const e = newElection(w, { kind: 'leadership', party: p.id, title: `${p.name} leadership contest`, stand: 'party:' + p.id, voters: 'party:' + p.id, closesAt: w.now + 2 * DAY });
  if (incumbent && p.leader) e.candidates[p.leader] = { id: p.leader, party: p.id, at: w.now };
  return e;
}
const noChallenges = (w: W, pid: Id) => pid && pid === national(w) && fail('The Prime Minister leads the National Party. There are no challenges or contests.');
export function challengeLeader(w: W, actor: Id) {
  mustBeFree(w, actor);
  const c = cit(w, actor);
  const p = c.party && w.parties[c.party];
  if (!p || p.status !== 'active') fail('Join a party first.');
  noChallenges(w, p.id);
  if (p.leader === actor) fail('You already lead it.');
  if (contestOpen(w, p.id)) fail('A leadership contest is already running.');
  if (p.challenge?.status === 'open') fail('A challenge is already gathering names. Sign it instead.');
  p.challenge = { by: actor, signed: [actor], status: 'open', at: w.now, dueAt: w.now + 2 * DAY };
  gazette(w, 'party', `${c.name} launches a challenge to ${nm(w, p.leader)}’s leadership of the ${p.name}. It needs ${challengeNeed(w, p.id)} members to sign.`, '#/party/' + p.id);
  signChallenge(w, actor, p.id);
}
export function signChallenge(w: W, actor: Id, pid: unknown) {
  const p = own(w.parties, pid);
  const ch = p?.challenge;
  if (!ch || ch.status !== 'open') fail('There’s no challenge to sign.');
  noChallenges(w, p.id);
  if (w.citizens[actor]?.party !== p.id) fail('Only members can sign.');
  if (p.leader === actor) fail('You can’t sign a challenge to yourself.');
  if (!ch.signed.includes(actor)) ch.signed.push(actor);
  const live = ch.signed.filter((x: Id) => w.citizens[x]?.party === p.id);
  if (live.length < challengeNeed(w, p.id)) return;
  ch.status = 'contest';
  const e = openContest(w, p, true);
  if (w.citizens[ch.by]?.party === p.id) e.candidates[ch.by] = { id: ch.by, party: p.id, at: w.now };
  gazette(w, 'party', `${live.length} members sign: the ${p.name} holds a leadership contest. Any member can stand.`, '#/election/' + e.id);
}
export function lapseChallenge(w: W, p: any) {
  if (p.challenge?.status !== 'open') return;
  p.challenge.status = 'lapsed';
  gazette(w, 'party', `The challenge to ${nm(w, p.leader)}’s leadership of the ${p.name} runs out of names.`, '#/party/' + p.id);
}
export function standDown(w: W, actor: Id) {
  const c = cit(w, actor);
  const p = c.party && w.parties[c.party];
  if (!p || p.leader !== actor) fail('You don’t lead a party.');
  noChallenges(w, p.id);
  if (contestOpen(w, p.id)) fail('A leadership contest is already running.');
  if (members(w, p.id).length < 2) fail('You’re its only member. Leave it instead.');
  if (p.challenge?.status === 'open') p.challenge.status = 'lapsed';
  const e = openContest(w, p, false);
  gazette(w, 'party', `${c.name} stands down as leader of the ${p.name}. They lead until a successor is chosen.`, '#/election/' + e.id);
}

// Breakaways: members plot in private to split from their party. When at least 2 MPs have signed, the founder launches
// it: a new party with everyone who signed, seats and all. Costs the founder 10 crowns. Unlaunched after 2 days, it's off.
export const BREAKAWAY_MPS = 2;
export function planBreakaway(w: W, actor: Id, a: any) {
  mustBeFree(w, actor);
  const c = cit(w, actor);
  const from = c.party && w.parties[c.party];
  if (!from || from.status !== 'active') fail('You can only break away from a party you’re in.');
  if (national(w)) fail('The National Party cannot split, and no new party can be founded. You can leave it.');
  const name = text(a?.name, 3, 40, 'party name');
  if (typeof a?.colour !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(a.colour)) fail('Pick a colour.');
  if (Object.values(w.parties).some((p: any) => p.name.toLowerCase() === name.toLowerCase() && p.status !== 'lapsed')) fail('That name is taken.');
  const invite = a?.invite ?? [];
  if (!Array.isArray(invite) || invite.length > 15) fail('Invite up to 15 members.');
  const invited = [...new Set(invite)].filter((x: any) => typeof x === 'string' && x !== actor) as Id[];
  if (invited.some((x) => w.citizens[x]?.party !== from.id)) fail(`Only members of the ${from.name} can be asked.`);
  if (Object.values(w.breakaways || {}).filter((b: any) => b.by === actor && b.status === 'plotting').length) fail('You’re already planning one.');
  const id = newId(w, 'bk');
  (w.breakaways ??= {})[id] = { id, from: from.id, by: actor, name, colour: a.colour, invited, signed: [actor], declined: [], status: 'plotting', at: w.now, dueAt: w.now + 2 * DAY };
  return id;
}
export function signBreakaway(w: W, actor: Id, bid: unknown, yes: unknown) {
  const b = own(w.breakaways, bid);
  if (!b || b.status !== 'plotting' || !b.invited.includes(actor)) fail('You haven’t been asked to join that.');
  if (w.citizens[actor]?.party !== b.from) fail('You’ve left that party already.');
  b.signed = b.signed.filter((x: Id) => x !== actor);
  b.declined = b.declined.filter((x: Id) => x !== actor);
  (yes ? b.signed : b.declined).push(actor);
}
export function launchBreakaway(w: W, actor: Id, bid: unknown) {
  mustBeFree(w, actor);
  const b = own(w.breakaways, bid);
  if (!b || b.by !== actor || b.status !== 'plotting') fail('That isn’t yours to launch.');
  if (national(w)) fail('No new party can be founded under the National Unity Act.');
  const from = w.parties[b.from];
  const going = b.signed.filter((x: Id) => w.citizens[x]?.party === b.from && w.citizens[x].active);
  const mpsGoing = going.filter((x: Id) => isMP(w, x));
  if (mpsGoing.length < BREAKAWAY_MPS) fail(`A breakaway needs at least ${BREAKAWAY_MPS} MPs. ${mpsGoing.length} ha${mpsGoing.length === 1 ? 's' : 've'} signed.`);
  if (Object.values(w.parties).some((p: any) => p.name.toLowerCase() === b.name.toLowerCase() && p.status !== 'lapsed')) fail('That name has been taken since. Plan it again under another.');
  transfer(w, ca(actor), 'treasury', 10, `Registered ${b.name}`);
  const id = newId(w, 'p');
  const p = (w.parties[id] = { id, name: b.name, colour: b.colour, leader: actor, status: 'active', invited: [], signed: [], founded: w.now, formingUntil: null, manifesto: [], motions: [], splitFrom: from.id });
  going.forEach((x: Id) => (w.citizens[x].party = id));
  w.citizens[actor].stats.foundedParty = true;
  stamp(w, actor, 'Led a breakaway', b.name);
  b.status = 'launched';
  b.party = id;
  b.signed = going;
  // what's left behind: a new leader if theirs walked out, or nothing at all
  const rest = members(w, from.id);
  if (going.includes(from.leader)) from.leader = rest[0] || null;
  if (!rest.length) from.status = 'dissolved';
  gazette(w, 'party', `Split in the ${from.name}: ${going.map((x: Id) => nm(w, x)).join(', ').replace(/, ([^,]*)$/, ' and $1')} walk out to found the ${b.name}, taking ${mpsGoing.length} seats with them.`, '#/party/' + id);
  meter(w, 'stability', -2, `The ${from.name} split`);
  return id;
}
export function lapseBreakaway(w: W, b: any) {
  if (b.status === 'plotting') b.status = 'lapsed';
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
// who can be Prime Minister: the leader of a party with a majority on its own, or of the side that leads a signed
// coalition (or confidence-and-supply deal) with one. Nobody else, so a hung parliament has to do a deal first.
export const FORM_DAYS = 5;
export function commands(w: W, id: Id) {
  const side = sideOf(w, id);
  if (leaderOfSide(w, side) !== id || supportFor(w, id) < majority(w)) return false;
  const co = w.coalition;
  return !(co?.status === 'signed' && co.sides.includes(side) && co.lead !== side);
}
export function contenders(w: W) {
  const ids = new Set<Id>();
  Object.values(w.parties).forEach((p: any) => p.status === 'active' && p.leader && ids.add(p.leader));
  mps(w).forEach((m) => ids.add(m));
  return [...ids].filter((l) => !exiled(w, l) && !detained(w, l) && w.hos.holder !== l && w.citizens[l]?.active);
}
export function clearMinisters(w: W) {
  Object.values(w.offices).forEach((o: any) => o.fill === 'pm' && (o.holder = null));
}
export function formGovernmentAfterElection(w: W) {
  // under a regime an election changes the House, not who rules
  if (w.regime && w.regime.type !== 'civil') return;
  w.pm = null;
  w.coalition = null;
  w.confidence = null;
  clearMinisters(w);
  w.pmInviteDue = w.now + DAY;
  w.formingSince = w.now;
  w.hungNoted = false;
  if (w.config.hos === 'republic' && w.config.hosMethod !== 'citizens' && !inForce(w, 'protection')) startHosSelection(w);
  gazette(w, 'government', `The ${hosTitle(w)} will invite whoever commands a majority of ${majority(w)} seats to be Prime Minister. Without one, parties must agree a coalition first.`, '#/cabinet');
}
export function invitePM(w: W, actor: Id | null, target: Id) {
  if (actor && !isHOS(w, actor)) fail(`Only the ${hosTitle(w)} invites the Prime Minister.`);
  if (inForce(w, 'crown') && w.hos.holder) fail(`Under the Crown Act the ${hosTitle(w)} is Prime Minister. Nobody else can be invited.`);
  if (w.pm) fail('There is already a Prime Minister.');
  const t = cit(w, target);
  if (!t.active) fail('They are no longer a citizen.');
  if (exiled(w, target)) fail('They are in exile.');
  if (barred(w, target)) fail('They are barred from office for now.');
  if (detained(w, target)) fail('They are detained.');
  if (!commands(w, target)) {
    const s = supportFor(w, target);
    fail(leaderOfSide(w, sideOf(w, target)) !== target ? `${t.name} doesn’t lead their side, so they can’t be invited.` : w.coalition?.status === 'signed' && w.coalition.sides.includes(sideOf(w, target)) && supportFor(w, target) >= majority(w) ? `The coalition is led by ${sideName(w, w.coalition.lead)}. Invite its leader.` : `${t.name} has ${s} of the ${majority(w)} seats needed. Nobody can be invited until a party or coalition commands a majority.`);
  }
  w.pm = target;
  w.formingSince = null;
  w.pmInviteDue = null;
  const s = supportFor(w, target);
  w.minority = s < majority(w);
  t.stats.wasPM = true;
  bump(w, target, 'pmTerms');
  stamp(w, target, 'Prime Minister', actor ? `Invited by ${nm(w, actor)}` : 'Invited by convention', 'ink');
  gazette(w, 'government', `${t.name} becomes Prime Minister with ${s} of ${w.config.seats} seats${w.minority ? ', a minority government' : ''}.`, '#/cabinet');
}
// the head of state hasn't acted: invite whoever commands a majority. If nobody does, wait for a deal, a day at a
// time; after FORM_DAYS of a hung parliament, dissolve it and let the voters try again.
export function autoInvite(w: W) {
  w.formingSince ??= w.now - DAY;
  const best = contenders(w).filter((l) => commands(w, l)).sort((a, b) => supportFor(w, b) - supportFor(w, a))[0];
  if (best) return invitePM(w, null, best);
  const electing = Object.values(w.elections).some((e: any) => e.kind === 'general' && e.status === 'open');
  if (!electing && !inForce(w, 'continuity') && w.now - w.formingSince >= FORM_DAYS * DAY) {
    gazette(w, 'hos', `No party or coalition could command a majority in ${FORM_DAYS} days. The ${hosTitle(w)} dissolves Parliament: a fresh general election closes in 2 days.`, '#/elections');
    meter(w, 'stability', -3, 'A hung parliament');
    w.formingSince = null;
    w.pmInviteDue = null;
    callGeneralElection(w, w.now + 2 * DAY);
    return;
  }
  if (!w.hungNoted) gazette(w, 'government', `Hung parliament: nobody commands the ${majority(w)} seats needed. The ${hosTitle(w)} will invite a Prime Minister only once a party or coalition does. Leaders, start talking.`, '#/cabinet');
  w.hungNoted = true;
  w.pmInviteDue = w.now + DAY;
}
export function resignPM(w: W, actor: Id) {
  if (!isPM(w, actor)) fail('Only the Prime Minister can resign as PM.');
  if (inForce(w, 'crown') && isHOS(w, actor)) fail('Under the Crown Act the head of state is Prime Minister. Repeal the Act to step down.');
  if ((w.regime && w.regime.type !== 'civil') || w.transition) fail(w.regime && w.regime.type !== 'civil' ? 'A regime does not resign. Offer to hand back power instead.' : 'The provisional government stays until the election.');
  gazette(w, 'government', `${nm(w, actor)} resigns as Prime Minister.`);
  meter(w, 'stability', -4, 'The Prime Minister resigned');
  w.pm = null;
  clearMinisters(w);
  w.confidence = null;
  w.pmInviteDue = w.now + DAY;
}
export function governmentFalls(w: W) {
  // under the Protection of the State Act (or with the Crown as PM) the government cannot fall for lack of confidence
  if (inForce(w, 'protection') || (inForce(w, 'crown') && w.pm && w.pm === w.hos.holder)) return void (w.confidence = null);
  // a regime ignores the House, at a price
  if (w.regime && w.regime.type !== 'civil') {
    w.confidence = null;
    return legit(w, -3, 'The House voted no confidence');
  }
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
  if (!own(w.offices, post)) fail('Pick an office.');
  if (target) cit(w, target);
  w.shadow[post] = target || null;
}

// ================= Coalitions =================
export function proposeCoalition(w: W, actor: Id, partners: string[], kind: 'full' | 'cs', terms: string[]) {
  const mine = sideOf(w, actor);
  if (leaderOfSide(w, mine) !== actor) fail('Only a party leader or an independent MP can lead coalition talks.');
  if (!Array.isArray(partners) || !partners.length) fail('Pick at least one partner.');
  // a partner is an active party, or an MP who sits as an independent (not a party member under another name)
  if (partners.some((p) => typeof p !== 'string' || !(p.startsWith('p:') ? own(w.parties, p.slice(2))?.status === 'active' : p.startsWith('i:') && own(w.citizens, p.slice(2))?.active && sideOf(w, p.slice(2)) === p && isMP(w, p.slice(2))))) fail('Pick parties or independent MPs.');
  if (!partners.some((p) => p !== mine)) fail('Pick at least one partner other than your own side.');
  // one deal at a time: a signed one stands until someone in it walks out, and fresh talks get a day before anyone else can replace them
  const old = w.coalition;
  if (old?.status === 'signed') fail(old.sides.includes(mine) ? 'You are in a signed coalition. Walk out of it first.' : `${old.sides.map((s: string) => sideName(w, s)).join(' and ')} have a signed coalition. It stands until one of them walks out.`);
  if (old?.status === 'draft' && old.lead !== mine && w.now - old.at < DAY) fail(`${sideName(w, old.lead)} opened talks less than a day ago. Wait for them to be signed, declined or a day to pass.`);
  if (kind !== 'full' && kind !== 'cs') fail('Pick a full coalition or confidence and supply.');
  if (!Array.isArray(terms)) fail('Terms are a list of lines.');
  const sides = [mine, ...new Set(partners.filter((p) => p !== mine))];
  w.coalition = { id: newId(w, 'co'), lead: mine, sides, kind, terms: terms.map((t) => text(t, 0, 300, 'term')).filter(Boolean), signed: { [mine]: true }, status: 'draft', promises: {}, at: w.now };
  gazette(w, 'government', `${sideName(w, mine)} opens coalition talks with ${partners.map((p) => sideName(w, p)).join(' and ')}.`, '#/cabinet');
}
// whoever commands a majority of the House governs: a party with one on its own, or the lead side of a signed
// coalition. If the Prime Minister has lost their majority and someone else now commands one, the government falls
// and that leader becomes Prime Minister; with no Prime Minister, they are invited at once. Checked after every
// command and deadline, so defections, by-elections and deals all count. Not where the law fixes who governs.
export function coalitionGoverns(w: W) {
  if (w.phase !== 'running') return;
  if (inForce(w, 'protection') || (inForce(w, 'crown') && !!w.hos.holder) || (!!w.regime && w.regime.type !== 'civil') || !!w.transition) return;
  if (Object.values(w.elections).some((e: any) => e.kind === 'general' && e.status === 'open')) return;
  if (w.pm && supportFor(w, w.pm) >= majority(w)) return;
  const next = contenders(w).filter((l) => l !== w.pm && commands(w, l) && !barred(w, l)).sort((a, b) => supportFor(w, b) - supportFor(w, a))[0];
  if (!next) return;
  if (w.pm) {
    gazette(w, 'government', `${nm(w, w.pm)}'s government falls: ${sideName(w, sideOf(w, next))}${w.coalition?.status === 'signed' && w.coalition.sides.includes(sideOf(w, next)) ? ' and its coalition' : ''} now holds ${supportFor(w, next)} of ${w.config.seats} seats.`, '#/cabinet');
    meter(w, 'stability', -3, 'The government lost its majority');
    w.pm = null;
    clearMinisters(w);
    w.confidence = null;
  }
  invitePM(w, null, next);
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
    coalitionGoverns(w);
    if (w.pm) w.minority = supportFor(w, w.pm) < majority(w);
  }
}
// an invited leader turns the talks down, or the leader running them calls them off
export function declineCoalition(w: W, actor: Id) {
  const co = w.coalition;
  if (!co || co.status !== 'draft') fail('There are no coalition talks to turn down.');
  const side = co.sides.find((s: string) => leaderOfSide(w, s) === actor);
  if (!side) fail('Only the leaders in the talks can end them.');
  w.coalition = null;
  gazette(w, 'government', side === co.lead ? `${sideName(w, side)} calls off its coalition talks.` : `${sideName(w, side)} turns down a coalition with ${sideName(w, co.lead)}. The talks are over.`, '#/cabinet');
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
  if (!co || co.status === 'broken' || leaderOfSide(w, co.lead) !== actor) fail('Only the leader running the talks can promise posts.');
  if (own(w.offices, officeId)?.fill !== 'pm') fail('Pick a post the PM appoints.');
  cit(w, target);
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
  { id: 'scoop', text: 'Get a story on the front page', test: (c: any) => c.stats.frontPage },
  { id: 'survivor', text: 'Be Prime Minister through 3 crises and still be standing', test: (c: any) => (c.stats.crisesSurvived || 0) >= 3 },
  { id: 'firefighter', text: 'Be on the winning side of 3 House votes on crises', test: (c: any) => (c.stats.crisisWins || 0) >= 3 },
  { id: 'orator', text: 'Make 3 speeches on crises', test: (c: any) => (c.stats.crisisSpeeches || 0) >= 3 },
  { id: 'decree', text: 'Rule by decree under a state of emergency', test: (c: any) => c.stats.ruledByDecree }
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
  const awards = seasonAwards(w);
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
    awards,
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

// out of every post: seat, offices, the premiership, the chair, the throne, party leadership (and, unless kept, the party)
function leavePosts(w: W, id: Id, why: string, keepParty: boolean) {
  const d = w.citizens[id];
  if (isMP(w, id)) vacateSeat(w, id, why);
  Object.values(w.offices).forEach((o: any) => {
    if (o.holder === id) o.holder = null;
    o.members = (o.members || []).filter((m: Id) => m !== id);
  });
  if (w.pm === id) {
    w.pm = null;
    clearMinisters(w);
    w.pmInviteDue = w.now + DAY;
    w.formingSince = w.now;
  }
  if (w.speaker === id) w.speaker = null;
  if (w.hos.holder === id) {
    w.hos = { holder: null, since: w.now, until: null };
    startHosSelection(w);
  }
  if (d.party) {
    const pt = w.parties[d.party];
    if (pt?.leader === id) {
      const rest = members(w, pt.id).filter((m: Id) => m !== id);
      pt.leader = rest[0] || null;
      if (!rest.length) pt.status = 'dissolved';
    }
    if (!keepParty) d.party = null;
  }
  Object.values(w.elections).forEach((e: any) => e.status === 'open' && delete e.candidates[id]);
  if (d.streets?.in) leave(w, id);
}

// ================= Suspension, a second Returning Officer, pausing the clock =================
// Suspend someone who has left the group: they lose their seat and posts but keep their crowns, party and record,
// and can be restored later (as an ordinary citizen; posts aren't given back). The server switches the login off and on.
export function suspend(w: W, actor: Id, target: unknown, on: unknown, reason: unknown) {
  if (!w.citizens[actor]?.admin) fail('Only the Returning Officer can suspend an account.');
  const c = own(w.citizens, target);
  if (!c) fail('Pick a citizen.');
  if (c.id === actor) fail('You can’t suspend yourself.');
  if (c.removed) fail(`${c.name} was removed as a duplicate account.`);
  const why = text(reason, 0, 200, 'reason');
  if (on === true) {
    if (c.suspended) fail(`${c.name} is already suspended.`);
    if (c.admin) fail('Take away their Returning Officer role first.');
    leavePosts(w, c.id, 'a suspended account', true);
    c.active = false;
    c.suspended = { at: w.now, reason: why };
    adminDid(w, actor, `suspended ${c.name}${why ? `: ${why}` : ''}`, '#/rolog');
  } else if (on === false) {
    if (!c.suspended) fail(`${c.name} isn’t suspended.`);
    c.active = true;
    delete c.suspended;
    adminDid(w, actor, `restored ${c.name}'s account${why ? `: ${why}` : ''}`, '#/rolog');
  } else fail('Say whether to suspend or restore.');
}
// share the job: another citizen becomes a Returning Officer too (or stops being one). There's always at least one.
export function setRO(w: W, actor: Id, target: unknown, on: unknown) {
  if (!w.citizens[actor]?.admin) fail('Only a Returning Officer can do this.');
  const c = own(w.citizens, target);
  if (!c?.active) fail('Pick an active citizen.');
  if (on === true) {
    if (c.admin) fail(`${c.name} is already a Returning Officer.`);
    c.admin = true;
    adminDid(w, actor, `made ${c.name} a Returning Officer too`, '#/rolog');
  } else if (on === false) {
    if (!c.admin) fail(`${c.name} isn’t a Returning Officer.`);
    if (allCitizens(w).filter((x: any) => x.admin).length < 2) fail('There must always be at least one Returning Officer.');
    c.admin = false;
    adminDid(w, actor, `${c.id === actor ? 'stepped down' : `took away ${c.name}'s role`} as Returning Officer`, '#/rolog');
  } else fail('Say whether to add or remove.');
}
// pause the realm (exam week, a holiday): game time stops; on resume the clock jumps back to real time and every
// pending deadline moves later by the same amount, so each has exactly as long left as it had when the pause began.
// `real` is the server's clock, passed only by the server's own route (never by a player).
// 'sync' does the same for any lag left by older pauses (when game time = real time - offset).
const TIME_KEY = /(At|Until|Due|deadline|nextCheck)$|^(at|until)$/;
// move every future timestamp in the world later by `ms` (history is in the past and stays put)
function shiftFuture(w: W, from: number, ms: number) {
  if (ms <= 0) return 0;
  let n = 0;
  const seen = new Set<any>();
  const walk = (o: any) => {
    if (!o || typeof o !== 'object' || seen.has(o) || o === w.clock) return;
    seen.add(o);
    for (const k of Object.keys(o)) {
      const v = o[k];
      if (typeof v === 'number' && TIME_KEY.test(k) && v > from && v < from + 3650 * DAY) ((o[k] = v + ms), n++);
      else if (v && typeof v === 'object') walk(v);
    }
  };
  walk(w);
  return n;
}
export function pauseClock(w: W, actor: Id, on: unknown, real: unknown, reason: unknown) {
  if (!w.citizens[actor]?.admin) fail('Only the Returning Officer can pause the realm.');
  const t = Number(real);
  if (!Number.isFinite(t)) fail('The server clock is missing.');
  w.clock ??= { offset: 0, pausedAt: null };
  const why = text(reason, 0, 200, 'reason');
  const off = w.clock.offset || 0;
  if (on === true) {
    if (w.clock.pausedAt) fail('The realm is already paused.');
    w.clock.pausedAt = t;
    w.clock.reason = why;
    adminDid(w, actor, `paused the realm${why ? `: ${why}` : ''}. Nothing closes and no deadline moves until it resumes`, '#/rolog');
  } else if (on === false) {
    if (!w.clock.pausedAt) fail('The realm isn’t paused.');
    const gone = Math.max(0, t - w.clock.pausedAt);
    shiftFuture(w, w.clock.pausedAt - off, gone + off);
    w.clock.offset = 0;
    w.clock.pausedAt = null;
    delete w.clock.reason;
    adminDid(w, actor, `resumed the realm after ${Math.round(gone / 3600000)} hours. The date is back to real time and every deadline moved back by the same`, '#/rolog');
  } else if (on === 'sync') {
    if (w.clock.pausedAt) fail('Resume the realm first: resuming puts the clock back on real time.');
    if (!off) fail('The clock is already on real time.');
    shiftFuture(w, t - off, off);
    w.clock.offset = 0;
    adminDid(w, actor, `put the clock back on real time (it was ${Math.round(off / 3600000)} hours behind). Every deadline moved back by the same`, '#/rolog');
  } else fail('Say whether to pause, resume or resync.');
}

// ================= Your own name and bio =================
export function setProfile(w: W, actor: Id, name: unknown, bio: unknown) {
  const c = cit(w, actor);
  if (bio !== undefined) c.bio = text(bio, 0, 280, 'bio');
  if (name !== undefined && name !== c.name) {
    const n = text(name, 2, 30, 'name').replace(/\s+/g, ' ');
    if (!/^[\p{L}\p{N} '’.-]+$/u.test(n)) fail('Use letters, numbers, spaces, apostrophes, dots or hyphens.');
    if (allCitizens(w).some((x: any) => x.id !== actor && x.name.toLowerCase() === n.toLowerCase())) fail('Someone already has that name.');
    if (c.renamedAt && w.now - c.renamedAt < 7 * DAY) fail('You can change your name once a week.');
    const old = c.name;
    c.name = n;
    c.renamedAt = w.now;
    gazette(w, 'citizen', `${old} is now known as ${n}.`, '#/passport/' + actor);
  }
}

// ================= Duplicate accounts =================
// The Returning Officer strikes out a second account belonging to someone who already has one. Its crowns
// go to the real account, its open votes and ballots are struck out (so nobody voted twice), it loses any
// seat or office, and it stops being a citizen. All of it is published. The server also deactivates the login.
export function removeDuplicate(w: W, actor: Id, dup: Id, keep: Id) {
  if (!w.citizens[actor]?.admin) fail('Only the Returning Officer removes duplicate accounts.');
  const d = cit(w, dup);
  const k = cit(w, keep);
  if (dup === keep) fail('Pick two different accounts.');
  if (!d.active) fail(`${d.name} has already been removed.`);
  if (d.admin) fail('You can’t remove an admin account this way.');
  let struck = 0;
  // money: everything in the duplicate's wallet, banks and bets goes to the real account
  const cash = bal(w, ca(dup));
  if (cash > 0) transfer(w, ca(dup), ca(keep), cash, `Merged from a duplicate account (${d.name})`);
  Object.values(w.banks || {}).forEach((b: any) => {
    const dep = b.deposits?.[dup] || 0;
    if (dep > 0) {
      b.deposits[keep] = (b.deposits[keep] || 0) + dep;
      delete b.deposits[dup];
    }
    (b.loans || []).forEach((l: any) => l.who === dup && (l.who = keep));
  });
  Object.values(w.markets || {}).forEach((m: any) => {
    const bets = m.bets?.[dup];
    if (!bets || m.status !== 'open') return;
    Object.entries(bets).forEach(([opt, n]: any) => {
      m.pools[opt] -= n;
      if (n > 0) transfer(w, 'market', ca(keep), n, `Refunded bet from a duplicate account (${d.name})`);
    });
    delete m.bets[dup];
  });
  // votes still open are struck out
  Object.values(w.elections).forEach((e: any) => {
    if (e.status !== 'open') return;
    if (e.ballots[dup] !== undefined) (delete e.ballots[dup], struck++);
    delete e.candidates[dup];
  });
  Object.values(w.proposals).forEach((p: any) => {
    if (p.votes?.[dup] !== undefined && ['vote', 'debate'].includes(p.stage)) (delete p.votes[dup], struck++);
    if (p.overrideVotes?.[dup] !== undefined) (delete p.overrideVotes[dup], struck++);
  });
  if (w.phase === 'convention') w.convention.clauses.forEach((c: any) => c.votes[dup] !== undefined && (delete c.votes[dup], struck++));
  Object.values(w.crises).forEach((c: any) => c.status === 'open' && c.votes?.[dup] !== undefined && (delete c.votes[dup], struck++));
  if (w.daily?.votes?.[dup] !== undefined) delete w.daily.votes[dup];
  leavePosts(w, dup, 'a duplicate account', false);
  d.active = false;
  d.removed = { at: w.now, as: 'duplicate', of: keep };
  adminDid(w, actor, `removed ${d.name} as a duplicate account of ${k.name}: ${cash} crowns moved to ${k.name}${struck ? `, ${struck} open vote${struck > 1 ? 's' : ''} struck out` : ''}`, '#/rolog');
}
