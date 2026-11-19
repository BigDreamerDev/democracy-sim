// The Imperial Privy Council: under the Imperial Prerogative Act, Parliament is dissolved and the Council sits in its
// place. Eight seats: the Sovereign, the Imperial High Commissioner, the General, the Lord Chamberlain, the Lord Privy
// Seal and three Privy Councillors the Sovereign appoints. The Council *is* the House while it sits: syncPrivy() writes
// its members into w.seats (w.config.seats = 8), so bills (Orders in Council), votes, questions and confidence all work
// unchanged. The old Parliament is kept in w.privy.parliament and comes back, with a general election, on repeal.
// No general or Speaker elections while it sits (callGeneralElection and countback check w.privy).
import { W, Id, DAY, HOUR, fail, nm, gazette, stamp, cit, isHOS, hasPower, exiled, detained, own, inForce, mps } from './core';
import { createOffice } from './offices';
import { checkClauses, enactDecree, history } from './proposals';
import { voidMarket } from './markets';
import { notRefused } from './oath';

export const PRIVY_SEATS = 8;
export const SEAT_NAMES = ['The Sovereign', 'Imperial High Commissioner', 'The General', 'Lord Chamberlain', 'Lord Privy Seal', 'Privy Councillor', 'Privy Councillor', 'Privy Councillor'];
export const COUNCILLOR_SEAT = 5; // seats 5–7 are the Councillors'
const officeHolder = (w: W, tpl: string) => (Object.values(w.offices).find((o: any) => o.template === tpl) as any)?.holder || null;
const hcHolder = (w: W) => (Object.values(w.offices).find((o: any) => o.powers?.includes('imperial')) as any)?.holder || null;
const fit = (w: W, id: Id | null) => !!id && !!w.citizens[id]?.active && !w.citizens[id].defected && !w.citizens[id].bot;

// the eight, in seat order; a person may hold several places, and has a vote for each (seatWeight in core.ts)
export function council(w: W): (Id | null)[] {
  if (!w.privy) return [];
  const raw = [w.hos?.holder || null, hcHolder(w), w.offices.army?.holder || null, officeHolder(w, 'chamberlain'), officeHolder(w, 'privyseal'), ...(w.privy.councillors || [null, null, null])];
  return raw.map((id) => (fit(w, id) ? id : null));
}
export const seatOf = (w: W, id: Id) => council(w).indexOf(id);

export function syncPrivy(w: W) {
  if (!w.privy) return;
  w.privy.councillors = (w.privy.councillors || [null, null, null]).map((id: Id | null) => (fit(w, id) ? id : null));
  w.seats = council(w);
  w.config.seats = PRIVY_SEATS;
  w.speaker = null;
}

// the Act: Parliament dissolved, the Council in its place
export function establishPrivy(w: W, ref: string) {
  if (w.privy) return;
  const old = mps(w);
  w.privy = { since: w.now, ref, councillors: [null, null, null], parliament: { seats: w.seats.slice(), n: w.config.seats, speaker: w.speaker || null } };
  // open general and Speaker elections end
  Object.values(w.elections).forEach((e: any) => e.status === 'open' && ['general', 'speaker'].includes(e.kind) && ((e.status = 'cancelled'), (e.closedAt = w.now)));
  w.nextGeneralAt = null;
  ['chamberlain', 'privyseal'].forEach((t) => !Object.values(w.offices).some((o: any) => o.template === t) && createOffice(w, { template: t }, ref));
  // the first Council: the Sovereign and the High Commissioner sit by right; the old Parliament's members fill the rest, in order
  const taken = new Set([w.hos?.holder, hcHolder(w)].filter(Boolean));
  const next = () => { const id = old.find((m) => !taken.has(m) && fit(w, m) && !exiled(w, m)); if (id) taken.add(id); return id || null; };
  const lc = Object.values(w.offices).find((o: any) => o.template === 'chamberlain') as any;
  const ps = Object.values(w.offices).find((o: any) => o.template === 'privyseal') as any;
  if (w.offices.army && !w.offices.army.holder) w.offices.army.holder = next();
  else if (w.offices.army?.holder) taken.add(w.offices.army.holder);
  if (lc && !lc.holder) lc.holder = next();
  if (ps && !ps.holder) ps.holder = next();
  w.privy.councillors = [next(), next(), next()];
  syncPrivy(w);
  council(w).forEach((id, i) => id && stamp(w, id, SEAT_NAMES[i], 'The Privy Council', 'ink'));
  gazette(w, 'law', `Parliament is dissolved. The Imperial Privy Council sits in its place: ${council(w).map((id, i) => (id ? `${nm(w, id)} (${SEAT_NAMES[i]})` : null)).filter(Boolean).join(', ')}. There will be no general elections while it sits.`, '#/house', { k: 'council', who: w.hos?.holder || null });
}
export function dissolvePrivy(w: W) {
  const p = w.privy;
  if (!p) return;
  w.privy = null;
  w.config.seats = p.parliament?.n || 7;
  w.seats = Array(w.config.seats).fill(null).map((_, i) => (p.parliament?.seats?.[i] && fit(w, p.parliament.seats[i]) ? p.parliament.seats[i] : null));
  w.speaker = p.parliament?.speaker && fit(w, p.parliament.speaker) ? p.parliament.speaker : null;
  Object.entries(w.offices).forEach(([id, o]: [string, any]) => ['chamberlain', 'privyseal'].includes(o.template) && delete w.offices[id]);
  gazette(w, 'law', 'The Imperial Privy Council is dissolved. Parliament returns as it last sat, and a general election follows.', '#/house');
}

// the Sovereign appoints the three Privy Councillors
export function appointCouncillor(w: W, actor: Id, seat: unknown, target: unknown) {
  if (!w.privy) fail('There is no Privy Council.');
  if (!isHOS(w, actor)) fail('Only the Sovereign appoints Privy Councillors.');
  if (seat !== 0 && seat !== 1 && seat !== 2) fail('Pick one of the three Councillors’ seats.');
  const was = w.privy.councillors[seat];
  if (target === null || target === '' || target === undefined) {
    if (!was) fail('That seat is already empty.');
    w.privy.councillors[seat] = null;
    syncPrivy(w);
    return gazette(w, 'government', `${nm(w, was)} is dismissed from the Privy Council.`, '#/house');
  }
  const c = cit(w, target as Id);
  if (!fit(w, c.id) || exiled(w, c.id) || detained(w, c.id)) fail('Pick a free citizen at home.');
  notRefused(w, c.id, c.name);
  if (w.privy.councillors[seat] === c.id) fail(`${c.name} already holds that seat.`);
  w.privy.councillors[seat] = c.id;
  syncPrivy(w);
  stamp(w, c.id, 'Privy Councillor', 'Appointed by the Sovereign', 'ink');
  gazette(w, 'government', `${c.name} is sworn of the Privy Council${was ? `, in place of ${nm(w, was)}` : ''}.`, '#/house', { k: 'sworn', who: c.id, by: actor, title: 'Privy Councillor' });
}

// the Lord Chamberlain summons the Council: a bill in debate goes to the vote within the hour (once a day)
export function summon(w: W, actor: Id, pid: unknown) {
  if (!hasPower(w, actor, 'chamberlain')) fail('Only the Lord Chamberlain summons the Council.');
  const p = own(w.proposals, pid);
  if (!p || p.stage !== 'debate') fail('Pick an Order still in debate.');
  if (w.privy?.summonedAt && w.now - w.privy.summonedAt < DAY) fail('The Council can be summoned once a day.');
  if (w.privy) w.privy.summonedAt = w.now;
  p.debateEndsAt = Math.min(p.debateEndsAt, w.now + HOUR);
  gazette(w, 'proposal', `The Lord Chamberlain summons the Council to an urgent sitting: ${p.title} goes to the vote within the hour.`, '#/p/' + p.id, { k: 'summon', by: actor, title: p.title });
}
// the Lord Privy Seal seals a passed Order: it takes effect within the hour (not under the Royal Prerogative Act)
export function seal(w: W, actor: Id, pid: unknown) {
  if (!hasPower(w, actor, 'seal')) fail('Only the Lord Privy Seal keeps the Seal.');
  const p = own(w.proposals, pid);
  if (!p || p.stage !== 'assent') fail('Pick an Order waiting for assent.');
  if (inForce(w, 'prerogative')) fail('Under the Royal Prerogative Act only the Sovereign gives assent.');
  if (p.sealed) fail('It already bears the Seal.');
  p.sealed = true;
  p.assentDueAt = Math.min(p.assentDueAt || Infinity, w.now + HOUR);
  gazette(w, 'proposal', `The Imperial Seal is set on ${p.title}. It takes effect within the hour.`, '#/p/' + p.id, { k: 'seal', by: actor, title: p.title });
}

// ---------- the great officers' prerogatives in Council ----------
// force an Order through: the Sovereign or the High Commissioner makes a pending Order law at once, without the vote
export const canForce = (w: W, id: Id) => !!w.privy && (isHOS(w, id) || hasPower(w, id, 'imperial'));
// veto an Order: the Sovereign, the High Commissioner, the Lord Chamberlain or the Lord Privy Seal strikes it; it falls
export const canVeto = (w: W, id: Id) => !!w.privy && (isHOS(w, id) || hasPower(w, id, 'imperial') || hasPower(w, id, 'chamberlain') || hasPower(w, id, 'seal'));
const PENDING = ['consent', 'debate', 'vote', 'assent', 'override', 'withheld'];
const roleOf = (w: W, id: Id) => (isHOS(w, id) ? `the ${w.config.hosTitle || 'Sovereign'}` : hasPower(w, id, 'imperial') ? 'the Imperial High Commissioner' : hasPower(w, id, 'chamberlain') ? 'the Lord Chamberlain' : 'the Lord Privy Seal');
const pendingOrder = (w: W, pid: unknown) => {
  const p = own(w.proposals, pid);
  if (!p || p.kind !== 'bill') fail('Pick an Order in Council.');
  if (!PENDING.includes(p.stage)) fail('That Order is not pending: it is already law, or it has fallen.');
  return p;
};
export function force(w: W, actor: Id, pid: unknown) {
  if (!canForce(w, actor)) fail('Only the Sovereign or the Imperial High Commissioner can force an Order through.');
  const p = pendingOrder(w, pid);
  const clauses = structuredClone(p.clauses || []);
  checkClauses(w, 'bill', clauses, true);
  Object.values(w.markets || {}).forEach((m: any) => m.kind === 'prop' && m.ref === p.id && m.status === 'open' && voidMarket(w, m, 'Forced through before the vote.'));
  const ref = enactDecree(w, actor, p.title, p.summary || '', clauses);
  const law = w.laws.find((l: any) => l.ref === ref);
  if (law) (law.commanded = p.id), (law.how = `Forced through the Privy Council by ${roleOf(w, actor)}`);
  p.stage = 'commanded';
  p.lawRef = ref;
  history(w, p, actor, `Forced through as ${ref}`);
  gazette(w, 'law', `${cap1(roleOf(w, actor))}, ${nm(w, actor)}, forces “${p.title}” through the Privy Council without a vote. It is law as ${ref}.`, '#/law/' + ref, { k: 'force', by: actor, title: p.title, role: roleOf(w, actor) });
}
export function veto(w: W, actor: Id, pid: unknown) {
  if (!canVeto(w, actor)) fail('Only the Sovereign, the High Commissioner, the Lord Chamberlain or the Lord Privy Seal can veto an Order.');
  const p = pendingOrder(w, pid);
  if (p.clauses.some((e: any) => e.t === 'removeHos') && !isHOS(w, actor) && !inForce(w, 'protection')) fail('Only the Sovereign can veto an Order to remove the Sovereign.');
  Object.values(w.markets || {}).forEach((m: any) => m.kind === 'prop' && m.ref === p.id && m.status === 'open' && voidMarket(w, m, 'Vetoed in Council.'));
  p.stage = 'vetoed';
  p.vetoedBy = actor;
  history(w, p, actor, `Vetoed by ${roleOf(w, actor)}`);
  gazette(w, 'proposal', `${cap1(roleOf(w, actor))}, ${nm(w, actor)}, vetoes “${p.title}”. It falls.`, '#/p/' + p.id, { k: 'veto', by: actor, title: p.title, role: roleOf(w, actor) });
}
const cap1 = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
