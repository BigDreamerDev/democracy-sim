// The Imperial Oath: under the Imperial Prerogative Act every citizen is asked to swear allegiance to the Sovereign.
// Public: w.oath = { since, sworn: {id: at}, refused: {id: at} }. The Sovereign takes no oath.
// Swearing earns Influence. Not having sworn yet costs nothing: you can vote, lay Orders and hold office as before.
// Refusing outright strips every office, Council seat and governorship, and bars new appointments until you swear.
import { W, Id, fail, nm, gazette, stamp, earn, allCitizens, bump, theName } from './core';

export const OATH_INFLUENCE = 5;
const sovereignOf = (w: W) => w.hos?.holder || null;
export const oathWords = (w: W) => {
  const him = /^(King|Emperor)$/.test(w.config.hosTitle);
  const sov = sovereignOf(w);
  return `I swear that I will be faithful and bear true allegiance to ${him ? 'His' : 'Her'} Imperial Majesty${sov ? ` ${w.config.hosTitle} ${nm(w, sov)}` : ''}, ${him ? 'his' : 'her'} heirs and successors, and that I will serve ${theName(w.config.realmName)} according to its laws, in Council and out of it.`;
};
// still to swear (nobody is without an oath; the Sovereign never is)
export const owesOath = (w: W, id: Id) => !!w.oath && !w.oath.sworn?.[id] && id !== sovereignOf(w) && !w.citizens[id]?.bot;
export const refusedOath = (w: W, id: Id) => !!w.oath && !!w.oath.refused?.[id] && !w.oath.sworn?.[id];
// only a refuser is barred from new appointments; someone who simply has not sworn yet is not
export function notRefused(w: W, id: Id, name: string) {
  if (refusedOath(w, id)) fail(`${name} refused the Imperial Oath, and cannot be appointed until they swear it.`);
}

export function callOath(w: W) {
  if (w.oath) return;
  w.oath = { since: w.now, sworn: {}, refused: {} };
  allCitizens(w).forEach((c: any) => c.bot && (w.oath.sworn[c.id] = w.now));
  gazette(w, 'law', `Every citizen is called to swear the Imperial Oath of allegiance. Those who swear earn ${OATH_INFLUENCE} Influence; those who refuse lose any office they hold.`, '#/oath', { k: 'oathcall', who: sovereignOf(w) });
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
  if (!late) earn(w, actor, OATH_INFLUENCE, 'Swore the Imperial Oath');
  stamp(w, actor, 'Imperial Oath', late ? 'Sworn at last' : 'Sworn', 'ink');
  bump(w, actor, 'oaths');
  gazette(w, 'government', late ? `${nm(w, actor)} swears the Imperial Oath at last.` : `${nm(w, actor)} swears the Imperial Oath.`, '#/oath', { k: 'oath', who: actor, to: [actor] });
}
export function refuse(w: W, actor: Id) {
  if (!w.oath) fail('There is no oath to refuse.');
  if (actor === sovereignOf(w)) fail('The Sovereign takes no oath.');
  if (w.oath.sworn[actor]) fail('You have sworn already. There is no taking it back.');
  if (w.oath.refused[actor]) fail('You have already refused it.');
  w.oath.refused[actor] = w.now;
  stamp(w, actor, 'Imperial Oath', 'Refused', 'bad');
  Object.values(w.offices).forEach((o: any) => {
    if (o.holder === actor) o.holder = null;
    if (o.members?.includes(actor)) o.members = o.members.filter((m: Id) => m !== actor);
  });
  if (w.privy) w.privy.councillors = (w.privy.councillors || []).map((c: Id | null) => (c === actor ? null : c));
  Object.values(w.provinces || {}).forEach((p: any) => p.governor === actor && (p.governor = null));
  gazette(w, 'government', `${nm(w, actor)} refuses to swear the Imperial Oath, and loses every office they held.`, '#/oath', { k: 'refuse', who: actor });
}
