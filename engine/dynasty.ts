// The dynasty and its lands. Everything here is public.
// - Royal weddings: the crowned monarch proposes to a citizen, who has a day to answer. A wedding is a national holiday.
//   The consort (w.crown.consort {id, of, at}) draws an allowance each week.
// - The Tower: an absolute monarch may send a citizen convicted at trial to the Tower: jailed with no end date. Friends at
//   home bribe the guards to get them out; each try makes the next likelier, and a helper may be caught.
// - The Imperial Durbar: under the empire, each payday opens a day of homage. Governors, peers, Privy Councillors and the
//   High Commissioner are expected; protectorates send tribute. Whoever stays away is named in the Gazette.
// - Royal holdings: estates across the realm and its provinces (ESTATES), held by the Crown or granted to peers. Each pays its
//   holder a weekly rent; a palace built on one adds to it. Attainder, defection or the Tower forfeits them to the Crown;
//   the end of the monarchy takes them all into the State. Royal palaces stay with the Crown and cost the Treasury upkeep.
import { W, Id, DAY, fail, own, cit, nm, gazette, newId, rand, transfer, bal, ca, chance, stamp, approve, meter, earn, bump, mustBeFree, text, isHOS, isPM, allCitizens, exiled, detained, inForce, clamp } from './core';
import { PROVINCES, seedProvinces } from './foreign';
import { absolute, peers, setPeerTitle, peerTitle } from './imperium';
import { council } from './privy';
import { highCommission } from './empire';

const reign = (w: W) => (w.config.hos === 'monarchy' ? w.crown?.reign : null);
function mustReign(w: W, actor: Id) {
  const r = reign(w);
  if (!r || r.id !== actor || !r.crownedAt) fail(`Only the crowned ${w.config.hos === 'monarchy' ? w.config.hosTitle : 'monarch'} can do that.`);
  return r;
}
const atHome = (w: W, id: Id) => !!w.citizens[id]?.active && !w.citizens[id].bot && !w.citizens[id].defected;
export const consortOf = (w: W) => { const k = w.crown; return k?.consort && reign(w) && k.consort.of === reign(w).id ? k.consort : null; };

// ---------- royal weddings ----------
export function propose(w: W, actor: Id, target: unknown) {
  mustReign(w, actor);
  const k = w.crown;
  if (consortOf(w)) fail(`You are married to ${nm(w, k.consort.id)}.`);
  if (k.proposal && k.proposal.until > w.now) fail('You are waiting for an answer.');
  const c = cit(w, target as Id);
  if (c.id === actor || !atHome(w, c.id) || exiled(w, c.id) || detained(w, c.id)) fail('Pick a free citizen at home.');
  k.proposal = { by: actor, to: c.id, at: w.now, until: w.now + DAY };
  gazette(w, 'hos', `${w.config.hosTitle} ${nm(w, actor)} asks for the hand of ${nm(w, c.id)}. The realm waits for an answer.`, '#/hos');
}
export function answerProposal(w: W, actor: Id, yes: unknown) {
  const k = w.crown;
  const p = k?.proposal;
  if (!p || p.to !== actor || p.until <= w.now) fail('Nobody has proposed to you.');
  k.proposal = null;
  const r = reign(w);
  if (!r || r.id !== p.by) fail('The monarch who asked is no longer on the throne.');
  if (yes !== true) {
    approve(w, p.by, -2);
    return gazette(w, 'hos', `${nm(w, actor)} turns down the ${w.config.hosTitle}. The court is mortified.`, '#/hos');
  }
  mustBeFree(w, actor);
  k.consort = { id: actor, of: p.by, at: w.now };
  stamp(w, actor, 'Royal Consort', `Married ${w.config.hosTitle} ${nm(w, p.by)}`, 'good');
  stamp(w, p.by, 'Married', nm(w, actor), 'good');
  approve(w, actor, 5);
  approve(w, p.by, 3);
  meter(w, 'stability', 2, 'A royal wedding');
  // a national holiday: every citizen at home gets 2 crowns from the Treasury
  allCitizens(w).filter((c: any) => atHome(w, c.id)).forEach((c: any) => transfer(w, 'treasury', ca(c.id), 2, 'The royal wedding holiday'));
  bump(w, actor, 'royalWedding');
  gazette(w, 'hos', `A royal wedding. ${w.config.hosTitle} ${nm(w, p.by)} marries ${nm(w, actor)}. A national holiday: 2 crowns to every citizen.`, '#/hos', { k: 'wedding', who: p.by, title: nm(w, actor) });
}
export function divorce(w: W, actor: Id) {
  mustReign(w, actor);
  const c = consortOf(w);
  if (!c) fail('You are not married.');
  w.crown.consort = null;
  approve(w, actor, -3);
  meter(w, 'stability', -1, 'A royal divorce');
  gazette(w, 'hos', `Scandal at court: ${w.config.hosTitle} ${nm(w, actor)} and ${nm(w, c.id)} divorce.`, '#/hos');
}
// royal heirs at home were removed; the command stays for apps that know it (API contract) and refuses
export function haveHeir(_w: W, _actor: Id, _name: unknown) {
  fail('The Crown no longer has royal children.');
}

// ---------- the Tower ----------
export const inTower = (w: W, id: Id) => !!w.citizens[id]?.jail?.tower && w.citizens[id].jail.until == null;
export function sendToTower(w: W, actor: Id, target: unknown) {
  mustReign(w, actor);
  if (!absolute(w)) fail('Only an absolute monarch keeps a Tower: it needs the Royal Prerogative or Royal Veto Act, or the empire.');
  const c = cit(w, target as Id);
  const convicted = Object.values(w.trials || {}).some((t: any) => t.who === c.id && t.status === 'guilty' && w.now - (t.verdictAt || 0) < 14 * DAY);
  if (!convicted) fail(`${c.name} has not been convicted at trial in the last fortnight.`);
  if (isPM(w, c.id) || isHOS(w, c.id)) fail('Not the Prime Minister or the head of state.');
  if (inTower(w, c.id)) fail(`${c.name} is already in the Tower.`);
  c.jail = { by: actor, at: w.now, until: null, why: 'Committed to the Tower', tower: true };
  forfeitAll(w, c.id, 'committed to the Tower');
  if (c.peerage) setPeerTitle(c, null);
  stamp(w, c.id, 'The Tower', `Committed by ${w.config.hosTitle} ${nm(w, actor)}`, 'bad');
  bump(w, c.id, 'tower');
  gazette(w, 'crisis', `${nm(w, c.id)} is taken to the Tower by order of the ${w.config.hosTitle}, to be held at the Crown's pleasure.`, '#/tower');
}
export function releaseFromTower(w: W, actor: Id, target: unknown) {
  mustReign(w, actor);
  const c = cit(w, target as Id);
  if (!inTower(w, c.id)) fail(`${c.name} is not in the Tower.`);
  c.jail = null;
  gazette(w, 'hos', `${nm(w, c.id)} is released from the Tower by the ${w.config.hosTitle}'s mercy.`, '#/tower');
}
// a friend bribes the guards: 10 crowns a try, once a day each; every recent try makes the next likelier
export function escape(w: W, actor: Id, target: unknown) {
  mustBeFree(w, actor);
  if (w.citizens[actor]?.defected) fail('You are abroad.');
  const c = cit(w, target as Id);
  if (!inTower(w, c.id)) fail(`${c.name} is not in the Tower.`);
  if (c.id === actor) fail('You cannot break yourself out.');
  const j = c.jail;
  j.tries = (j.tries || []).filter((t: any) => w.now - t.at < 3 * DAY);
  if (j.tries.some((t: any) => t.by === actor && w.now - t.at < DAY)) fail('Once a day. The guards remember faces.');
  if (bal(w, ca(actor)) < 10) fail('Bribing the guards costs 10 crowns.');
  transfer(w, ca(actor), 'reserve', 10, 'A bribe at the Tower');
  const odds = clamp(0.12 + 0.06 * j.tries.length + (w.meters.stability < 30 ? 0.1 : 0), 0.05, 0.5);
  j.tries.push({ by: actor, at: w.now });
  if (chance(w, odds)) {
    c.jail = null;
    stamp(w, c.id, 'Escaped', 'From the Tower', 'ink');
    const helpers = [...new Set(j.tries.map((t: any) => t.by))] as Id[];
    helpers.forEach((h) => (earn(w, h, 3, 'A jailbreak'), stamp(w, h, 'Jailbreaker', `Freed ${c.name} from the Tower`, 'ink')));
    meter(w, 'stability', -1, 'An escape from the Tower');
    return gazette(w, 'crisis', `${nm(w, c.id)} escapes from the Tower. ${helpers.map((h) => nm(w, h)).join(', ')} bribed the guards.`, '#/tower');
  }
  if (chance(w, 0.3)) {
    w.citizens[actor].exiledUntil = w.now + 3 * DAY;
    w.citizens[actor].exileNoted = false;
    approve(w, actor, -4);
    gazette(w, 'crisis', `${nm(w, actor)} is caught bribing the guards at the Tower, and is held for three days.`, '#/tower');
  }
}

// ---------- the Imperial Durbar ----------
export function expectedAtDurbar(w: W): Id[] {
  const ids = new Set<Id>();
  peers(w).forEach((c: any) => ids.add(c.id));
  Object.values(w.provinces || {}).forEach((p: any) => p.owner === 'realm' && p.governor && ids.add(p.governor));
  council(w).forEach((id) => id && ids.add(id));
  const hc = highCommission(w)?.holder;
  if (hc) ids.add(hc);
  const sov = reign(w)?.id;
  if (sov) ids.delete(sov);
  return [...ids].filter((id) => atHome(w, id) && !detained(w, id));
}
export function openDurbar(w: W) {
  if (!inForce(w, 'imperial') || !reign(w)?.crownedAt) return;
  if (w.durbar && !w.durbar.done) return;
  const tribute: string[] = [];
  Object.values(w.nations).forEach((n: any) => {
    if (!n.protectorate) return;
    const t = Math.min(5, bal(w, 'nation:' + n.id));
    if (t > 0) transfer(w, 'nation:' + n.id, 'treasury', t, `Homage from ${n.name} at the Durbar`);
    tribute.push(n.name);
  });
  const r = reign(w);
  const coronation = !r.durbarHeld;
  r.durbarHeld = true;
  w.durbar = { at: w.now, until: w.now + DAY, expected: expectedAtDurbar(w), attended: [], tribute, done: false, coronation, reign: r.at };
  if (coronation) gazette(w, 'hos', `The Coronation Durbar of ${w.config.hosTitle} ${nm(w, r.id)}: the first of the reign. Who kneels, and who stands apart, goes on the record for as long as it lasts.`, '#/hos', { k: 'durbar', who: r.id });
  else gazette(w, 'hos', `The Imperial Durbar opens: governors, peers and councillors are summoned to pay homage to ${w.config.hosTitle} ${nm(w, reign(w).id)}${tribute.length ? `. Envoys of ${tribute.join(', ')} bring tribute` : ''}. It closes in 24 hours.`, '#/hos', { k: 'durbar', who: reign(w).id });
}
export function attendDurbar(w: W, actor: Id) {
  const d = w.durbar;
  if (!d || d.done || d.until <= w.now) fail('There is no Durbar sitting.');
  mustBeFree(w, actor);
  if (w.citizens[actor]?.defected) fail('You are abroad.');
  if (actor === reign(w)?.id) fail('The Durbar is held for you.');
  if (d.attended.includes(actor)) fail('You have paid homage.');
  d.attended.push(actor);
  earn(w, actor, 1, 'Paid homage at the Durbar');
  if (d.expected.includes(actor)) approve(w, actor, 1);
}
export function closeDurbar(w: W) {
  const d = w.durbar;
  if (!d || d.done) return;
  d.done = true;
  const absent = d.expected.filter((id: Id) => !d.attended.includes(id) && w.citizens[id]);
  absent.forEach((id: Id) => approve(w, id, -2));
  d.absent = absent;
  if (d.attended.length >= 5) meter(w, 'stability', 1, 'A full Durbar');
  // the Coronation Durbar: a record that follows everyone through the reign
  const r = reign(w);
  if (d.coronation && r && r.at === d.reign) {
    r.knelt = d.attended.slice();
    r.stoodApart = absent.slice();
    r.knelt.forEach((id: Id) => stamp(w, id, 'Knelt at the Coronation Durbar', `Of ${w.config.hosTitle} ${nm(w, r.id)}`, 'good'));
    r.stoodApart.forEach((id: Id) => stamp(w, id, 'Stood apart', `From the Coronation Durbar of ${w.config.hosTitle} ${nm(w, r.id)}`, 'bad'));
  }
  gazette(w, 'hos', `The Durbar closes. ${d.attended.length} paid homage.${absent.length ? ` Absent, and noted: ${absent.map((id: Id) => nm(w, id)).join(', ')}.` : ' Nobody summoned stayed away.'}`, '#/hos');
}

// ---------- royal holdings ----------
export const ESTATES: Record<string, { name: string; province: string | null; rent: number; royal?: boolean }> = {
  royalpalace: { name: 'The Royal Palace', province: null, rent: 0, royal: true },
  summerpalace: { name: 'The Summer Palace', province: null, rent: 0, royal: true },
  kingsmead: { name: 'Kingsmead', province: null, rent: 3 },
  ashcombe: { name: 'Ashcombe', province: null, rent: 2 },
  harrowgate: { name: 'Harrowgate', province: null, rent: 2 },
  stonehollow: { name: 'Stonehollow', province: null, rent: 2 },
  marlowe: { name: 'Marlowe Abbey', province: null, rent: 3 },
  fellgarth: { name: 'Fellgarth', province: 'northfells', rent: 2 },
  slatecross: { name: 'Slatecross', province: 'northfells', rent: 3 },
  oakhurst: { name: 'Oakhurst Chase', province: 'westwold', rent: 3 },
  greywood: { name: 'Greywood', province: 'westwold', rent: 2 },
  riverholm: { name: 'Riverholm', province: 'kessvale', rent: 4 },
  kessford: { name: 'Kessford Manor', province: 'kessvale', rent: 3 }
};
export const PALACE_COST = 60;
export const PALACE_RENT = 3;
export const ROYAL_UPKEEP = 4;
export function holdings(w: W) {
  w.holdings ??= {};
  seedProvinces(w);
  Object.keys(ESTATES).forEach((id) => (w.holdings[id] ??= { holder: 'crown', since: w.now, palace: !!ESTATES[id].royal }));
  return w.holdings;
}
// an estate in a province the realm does not hold is out of reach
export const estateLost = (w: W, id: string) => !!ESTATES[id]?.province && w.provinces?.[ESTATES[id].province!]?.owner !== 'realm';
export const estatesOf = (w: W, who: Id | 'crown') => Object.keys(holdings(w)).filter((id) => w.holdings[id].holder === who);
export const seatOf = (w: W, id: Id) => { const e = estatesOf(w, id).sort((a, b) => ESTATES[b].rent - ESTATES[a].rent)[0]; return e ? ESTATES[e].name : null; };
export function grantEstate(w: W, actor: Id, estate: unknown, target: unknown) {
  mustReign(w, actor);
  const h = holdings(w);
  const e = own(ESTATES, estate);
  if (!e) fail('Pick an estate.');
  if (e.royal) fail('The royal palaces belong to the Crown.');
  if (h[estate as string].holder !== 'crown') fail(`${e.name} is not the Crown's to give: ${nm(w, h[estate as string].holder)} holds it.`);
  if (estateLost(w, estate as string)) fail(`${e.name} lies in ${PROVINCES[e.province!].name}, which the realm does not hold.`);
  const c = cit(w, target as Id);
  if (!c.peerage) fail('Estates go to peers of the realm. Ennoble them first.');
  h[estate as string] = { ...h[estate as string], holder: c.id, since: w.now };
  approve(w, c.id, 1);
  gazette(w, 'hos', `The ${w.config.hosTitle} grants ${e.name}${e.province ? `, in ${PROVINCES[e.province].name},` : ''} to ${c.name}, ${peerTitle(c)}.`, '#/hos');
}
export function resumeEstate(w: W, actor: Id, estate: unknown) {
  mustReign(w, actor);
  const h = holdings(w);
  const e = own(ESTATES, estate);
  if (!e || h[estate as string].holder === 'crown') fail('That estate is the Crown’s already.');
  const was = h[estate as string].holder;
  h[estate as string] = { ...h[estate as string], holder: 'crown', since: w.now };
  approve(w, was, -2);
  aggrieve(w, was, estate as string);
  gazette(w, 'hos', `The Crown takes back ${e.name} from ${nm(w, was)}.`, '#/hos');
}
// a palace: the holder pays (the monarch builds on Crown land from the Treasury)
export function buildPalace(w: W, actor: Id, estate: unknown) {
  const h = holdings(w);
  const e = own(ESTATES, estate);
  if (!e) fail('Pick an estate.');
  const x = h[estate as string];
  const royal = x.holder === 'crown';
  if (royal) mustReign(w, actor);
  else if (x.holder !== actor) fail('You do not hold that estate.');
  if (x.palace) fail(`There is already a palace at ${e.name}.`);
  if (estateLost(w, estate as string)) fail(`${e.name} is out of the realm's reach.`);
  const from = royal ? 'treasury' : ca(actor);
  if (!royal && bal(w, from) < PALACE_COST) fail(`A palace costs ${PALACE_COST} crowns.`);
  transfer(w, from, 'reserve', PALACE_COST, `A palace at ${e.name}`);
  x.palace = true;
  approve(w, actor, 2);
  bump(w, actor, 'palaces');
  gazette(w, 'hos', `${royal ? `The ${w.config.hosTitle}` : nm(w, actor)} builds a palace at ${e.name}.`, '#/hos', { k: 'palace', who: actor, place: e.name });
}
function forfeitAll(w: W, id: Id, why: string) {
  const lost = estatesOf(w, id);
  lost.forEach((e) => ((w.holdings[e] = { ...w.holdings[e], holder: 'crown', since: w.now }), aggrieve(w, id, e)));
  if (lost.length) gazette(w, 'hos', `${nm(w, id)} forfeits ${lost.map((e) => ESTATES[e].name).join(', ')} to the Crown: ${why}.`, '#/hos');
}
export { forfeitAll };

// ---------- once a week (at payday): rents, the consort's allowance, upkeep, forfeits, the Tower and the Durbar ----------
export function dynastyWeek(w: W) {
  const monarchy = w.config.hos === 'monarchy';
  const h = holdings(w);
  if (!monarchy) {
    // no Crown, no Crown lands: the State takes every estate; the Tower opens
    if (Object.values(h).some((x: any) => x.holder !== 'state')) {
      Object.keys(h).forEach((id) => (h[id] = { ...h[id], holder: 'state', since: w.now }));
      gazette(w, 'law', 'With no monarch, every royal and noble estate passes to the State.', '#/hos');
    }
    allCitizens(w).forEach((c: any) => inTower(w, c.id) && ((c.jail = null), gazette(w, 'law', `${nm(w, c.id)} walks out of the Tower: there is no Crown to hold them.`, '#/tower')));
    if (w.crown) w.crown.consort = null;
    return;
  }
  // a monarchy again: the State hands the estates back to the Crown
  Object.keys(h).forEach((id) => h[id].holder === 'state' && (h[id] = { ...h[id], holder: 'crown', since: w.now }));
  Object.keys(h).forEach((id) => {
    const x = h[id];
    const e = ESTATES[id];
    if (x.holder !== 'crown' && x.holder !== 'state') {
      const c = w.citizens[x.holder];
      if (!c?.active || c.defected || !c.peerage) return forfeitAll(w, x.holder, c?.defected ? 'they defected' : 'they are no longer a peer');
    }
    if (estateLost(w, id) || x.holder === 'state') return;
    const rent = e.rent + (x.palace && !e.royal ? PALACE_RENT : 0);
    if (x.holder === 'crown') {
      if (e.royal && x.palace) transfer(w, 'treasury', 'reserve', ROYAL_UPKEEP, `Upkeep of ${e.name}`);
      else if (rent > 0) transfer(w, 'reserve', 'treasury', rent, `Rents of the Crown Estate: ${e.name}`);
    } else if (rent > 0) transfer(w, 'reserve', ca(x.holder), rent, `Rents from ${e.name}`);
  });
  if (!absolute(w)) allCitizens(w).forEach((c: any) => inTower(w, c.id) && ((c.jail = null), gazette(w, 'law', `${nm(w, c.id)} is released from the Tower: the Crown is no longer absolute.`, '#/tower')));
  const con = consortOf(w);
  if (con && w.citizens[con.id]?.active) transfer(w, 'treasury', ca(con.id), 5, "The consort's allowance");
  openDurbar(w);
  Object.values(w.events || {}).forEach((v: any) => v.done && w.now - v.at > 14 * DAY && delete w.events[v.id]);
}

// ---------- hunts and balls: a palace's holder entertains (guests come for Influence; the invited who stay away are named) ----------
export const EVENTS: Record<string, { name: string; cost: number; prize: string }> = {
  hunt: { name: 'a hunt', cost: 15, prize: 'Bagged the stag' },
  ball: { name: 'a ball', cost: 20, prize: 'Belle of the ball' }
};
export const EVENT_EVERY = 3 * DAY;
export function hostEvent(w: W, actor: Id, estate: unknown, kind: unknown, guests: unknown) {
  const h = holdings(w);
  const e = own(ESTATES, estate);
  const ev = own(EVENTS, kind);
  if (!e || !ev) fail('Pick a palace and a hunt or a ball.');
  const x = h[estate as string];
  const royal = x.holder === 'crown';
  if (royal) mustReign(w, actor);
  else if (x.holder !== actor) fail('You do not hold that estate.');
  if (!x.palace) fail(`There is no palace at ${e.name} to entertain in.`);
  if (estateLost(w, estate as string)) fail(`${e.name} is out of the realm's reach.`);
  mustBeFree(w, actor);
  w.events ??= {};
  if (Object.values(w.events).some((v: any) => v.host === actor && w.now - v.at < EVENT_EVERY)) fail('One entertainment every three days.');
  if (!Array.isArray(guests) || !guests.length || guests.length > 10) fail('Invite between 1 and 10 guests.');
  const list = [...new Set(guests)].filter((g) => typeof g === 'string' && g !== actor && atHome(w, g as Id)) as Id[];
  if (!list.length) fail('Invite citizens at home.');
  if (bal(w, ca(actor)) < ev.cost) fail(`${ev.name[0].toUpperCase() + ev.name.slice(1)} costs ${ev.cost} crowns.`);
  transfer(w, ca(actor), 'reserve', ev.cost, `${ev.name[0].toUpperCase() + ev.name.slice(1)} at ${e.name}`);
  const id = newId(w, 'ev');
  w.events[id] = { id, host: actor, estate, kind, guests: list, came: [], at: w.now, until: w.now + DAY, done: false };
  gazette(w, 'hos', `${nm(w, actor)} holds ${ev.name} at ${e.name}. Invited: ${list.map((g) => nm(w, g)).join(', ')}.`, '#/hos', { k: kind as string, who: actor, place: e.name });
}
export function attendEvent(w: W, actor: Id, eid: unknown) {
  const v = own(w.events || {}, eid);
  if (!v || v.done || v.until <= w.now) fail('That party is over.');
  if (!v.guests.includes(actor)) fail('You were not invited.');
  if (v.came.includes(actor)) fail('You are already there.');
  mustBeFree(w, actor);
  v.came.push(actor);
  earn(w, actor, 2, `A guest at ${ESTATES[v.estate].name}`);
  approve(w, actor, 1);
  approve(w, v.host, 1);
}
export function closeEvent(w: W, v: any) {
  if (v.done) return;
  v.done = true;
  const snubs = v.guests.filter((g: Id) => !v.came.includes(g) && w.citizens[g]);
  v.snubs = snubs;
  snubs.forEach((g: Id) => approve(w, g, v.host === reign(w)?.id ? -2 : -1));
  const star = v.came.length ? v.came[Math.floor(rand(w) * v.came.length)] : null;
  if (star) stamp(w, star, EVENTS[v.kind].prize, `At ${ESTATES[v.estate].name}`, 'good');
  v.star = star;
  gazette(w, 'hos', `${EVENTS[v.kind].name[0].toUpperCase() + EVENTS[v.kind].name.slice(1)} at ${ESTATES[v.estate].name}: ${v.came.length} came.${star ? ` ${nm(w, star)}: ${EVENTS[v.kind].prize.toLowerCase()}.` : ''}${snubs.length ? ` Snubbed by ${snubs.map((g: Id) => nm(w, g)).join(', ')}.` : ''}`, '#/hos');
}

// ---------- estate rebellions: a peer whose lands the Crown took back may raise their tenants for a coup night ----------
export const RETINUE_DAYS = 7;
export function aggrieve(w: W, id: Id, estate: string) {
  const c = w.citizens[id];
  if (!c) return;
  const g = c.grievance && c.grievance.until > w.now ? c.grievance : { estates: [], at: w.now, until: 0 };
  c.grievance = { estates: [...new Set([...g.estates, ESTATES[estate]?.name ?? estate])], at: w.now, until: w.now + 14 * DAY };
}
export function raiseTenants(w: W, actor: Id) {
  const c = cit(w, actor);
  const g = c.grievance;
  if (!g || g.until <= w.now) fail('You have no lands taken from you to rally tenants over.');
  if (c.retinue && c.retinue.until > w.now) fail('Your tenants are already under arms.');
  mustBeFree(w, actor);
  if (bal(w, ca(actor)) < 10) fail('Arming your tenants costs 10 crowns.');
  transfer(w, ca(actor), 'reserve', 10, 'Arming the tenants');
  const strength = Math.min(3, g.estates.length);
  c.retinue = { strength, at: w.now, until: w.now + RETINUE_DAYS * DAY, from: g.estates };
  meter(w, 'stability', -1, `${c.name}'s tenants take up arms`);
  gazette(w, 'crisis', `${nm(w, c.id)} raises the tenants of ${g.estates.join(', ')} under arms: a private regiment (+${strength} on any coup night this week).`, '#/hos');
}
export const retinue = (w: W, id: Id) => { const r = w.citizens[id]?.retinue; return r && r.until > w.now ? r.strength : 0; };
