// The Imperial Oath: under the Imperial Prerogative Act every citizen swears allegiance to the Sovereign. Public.
// w.oath = { since, dueAt, sworn: {id: at}, refused: {id: at}, settled }. The Sovereign takes no oath.
// Until they swear, a citizen cannot vote on or lay an Order, or be appointed to anything. Refusing (or letting the
// deadline pass) costs approval and every office, Council seat and governorship held. A refuser may swear later.
import { W, Id, DAY, fail, nm, gazette, stamp, approve, allCitizens, bump, theName } from './core';

export const OATH_DAYS = 2;
const sovereignOf = (w: W) => w.hos?.holder || null;
export const oathWords = (w: W) => {
  const him = /^(King|Emperor)$/.test(w.config.hosTitle);
  const sov = sovereignOf(w);
  return `I swear that I will be faithful and bear true allegiance to ${him ? 'His' : 'Her'} Imperial Majesty${sov ? ` ${w.config.hosTitle} ${nm(w, sov)}` : ''}, ${him ? 'his' : 'her'} heirs and successors, and that I will serve ${theName(w.config.realmName)} according to its laws, in Council and out of it.`;
};
// does this citizen still owe the oath? (nobody does without one; the Sovereign never does)
export const owesOath = (w: W, id: Id) => !!w.oath && !w.oath.sworn?.[id] && id !== sovereignOf(w) && !w.citizens[id]?.bot;
export const refusedOath = (w: W, id: Id) => !!w.oath && !!w.oath.refused?.[id] && !w.oath.sworn?.[id];
export function mustHaveSworn(w: W, id: Id, what: string) {
  if (owesOath(w, id)) fail(`${what === 'you' ? 'You must' : `${what} must`} swear the Imperial Oath first.`);
}

export function callOath(w: W) {
  if (w.oath) return;
  w.oath = { since: w.now, dueAt: w.now + OATH_DAYS * DAY, sworn: {}, refused: {}, settled: false };
  allCitizens(w).forEach((c: any) => c.bot && (w.oath.sworn[c.id] = w.now));
  gazette(w, 'law', `Every citizen must swear the Imperial Oath of allegiance within ${OATH_DAYS} days. Until they do, they may not vote in Council or hold any office.`, '#/house', { k: 'oathcall', who: sovereignOf(w) });
}
export function endOath(w: W) {
  w.oath = null;
}

export function swear(w: W, actor: Id) {
  if (!w.oath) fail('There is no oath to swear.');
  if (actor === sovereignOf(w)) fail('The Sovereign takes no oath: it is sworn to you.');
  if (w.oath.sworn[actor]) fail('You have already sworn the Imperial Oath.');
  const late = !!w.oath.refused[actor];
  w.oath.sworn[actor] = w.now;
  delete w.oath.refused[actor];
  approve(w, actor, late ? 0 : 1);
  stamp(w, actor, 'Imperial Oath', late ? 'Sworn at last' : 'Sworn', 'ink');
  bump(w, actor, 'oaths');
  gazette(w, 'government', late ? `${nm(w, actor)} swears the Imperial Oath at last.` : `${nm(w, actor)} swears the Imperial Oath.`, '#/house', { k: 'oath', who: actor, to: [actor] });
}
export function refuse(w: W, actor: Id) {
  if (!w.oath) fail('There is no oath to refuse.');
  if (actor === sovereignOf(w)) fail('The Sovereign takes no oath.');
  if (w.oath.sworn[actor]) fail('You have sworn already. There is no taking it back.');
  if (w.oath.refused[actor]) fail('You have already refused it.');
  w.oath.refused[actor] = w.now;
  strip(w, actor);
  gazette(w, 'government', `${nm(w, actor)} refuses to swear the Imperial Oath, and loses every office they held.`, '#/house', { k: 'refuse', who: actor });
}
// the deadline: whoever has not sworn is taken to have refused
export function settleOath(w: W) {
  if (!w.oath || w.oath.settled) return;
  w.oath.settled = true;
  const late = allCitizens(w).filter((c: any) => owesOath(w, c.id) && !w.oath.refused[c.id]);
  late.forEach((c: any) => ((w.oath.refused[c.id] = w.now), strip(w, c.id)));
  const n = Object.keys(w.oath.sworn).length;
  gazette(w, 'government', late.length ? `The time for the Imperial Oath is up. ${n} have sworn. ${late.map((c: any) => c.name).join(', ')} did not, and lose any office they held.` : `The time for the Imperial Oath is up. Every citizen has sworn.`, '#/house');
}
// a refuser loses approval, every office, their Council seat and any governorship
function strip(w: W, id: Id) {
  approve(w, id, -3);
  stamp(w, id, 'Imperial Oath', 'Refused', 'bad');
  Object.values(w.offices).forEach((o: any) => {
    if (o.holder === id) o.holder = null;
    if (o.members?.includes(id)) o.members = o.members.filter((m: Id) => m !== id);
  });
  if (w.privy) w.privy.councillors = (w.privy.councillors || []).map((c: Id | null) => (c === id ? null : c));
  Object.values(w.provinces || {}).forEach((p: any) => p.governor === id && (p.governor = null));
}
