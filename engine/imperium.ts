// The Crown at home: what a reigning monarch does to make the realm feel like a monarchy (or an empire).
// - Proclamations: once a day the Sovereign may proclaim something; it hangs over every page for 24 hours.
// - The peerage: the Sovereign creates Barons, Earls and Dukes (up to the 'peers' limit). Peers draw an appanage from
//   the Treasury each week and stand by the Crown on a coup night (backroom.ts). Gone with the monarchy.
// - Royal progresses: the Sovereign tours a province of the empire (every 3 days): calm for a week, and the crowds cheer.
// - Triumphs: within 3 days of a victory, the Sovereign or the High Commissioner holds a triumph in the capital. For 12
//   hours every citizen may line the streets; then the empire counts the crowd.
// - Lèse-majesté: under absolutism (the Royal Prerogative or Royal Veto Act, or the empire) the Sovereign may charge a
//   citizen with insulting the Crown. They go on trial (trials.ts).
// Everything here is public.
import { lim } from './limits';
import { W, Id, DAY, HOUR, fail, own, cit, nm, gazette, transfer, bal, ca, stamp, approve, meter, earn, bump, mustBeFree, text, isPM, isHOS, inForce, allCitizens } from './core';
import { PROVINCES, seedProvinces } from './foreign';
import { imperialPurse } from './warmachine';
import { canGovernEmpire } from './empire';
import { openTrial } from './trials';

const reigning = (w: W, id: Id) => w.config.hos === 'monarchy' && isHOS(w, id) && !!w.crown?.reign?.crownedAt;
function mustReign(w: W, actor: Id) {
  if (!reigning(w, actor)) fail(`Only the crowned ${w.config.hos === 'monarchy' ? w.config.hosTitle : 'monarch'} can do that.`);
}
export const absolute = (w: W) => w.config.hos === 'monarchy' && (inForce(w, 'prerogative') || inForce(w, 'veto') || inForce(w, 'imperial'));

// ---------- proclamations ----------
export function proclaim(w: W, actor: Id, words: unknown) {
  mustReign(w, actor);
  const k = w.crown;
  if (k.proclamation && w.now - k.proclamation.at < DAY) fail('One proclamation a day.');
  const t = text(words, 8, 240, 'proclamation');
  k.proclamation = { text: t, by: actor, at: w.now, until: w.now + DAY, title: w.config.hosTitle };
  bump(w, actor, 'proclamations');
  gazette(w, 'hos', `By order of ${w.config.hosTitle} ${nm(w, actor)}: “${t}”`, '#/hos');
}

// ---------- the peerage ----------
export const PEERAGE: Record<string, { title: string; pay: number }> = { baron: { title: 'Baron', pay: 2 }, earl: { title: 'Earl', pay: 3 }, duke: { title: 'Duke', pay: 5 } };
export const peers = (w: W) => allCitizens(w).filter((c: any) => c.peerage);
export function ennoble(w: W, actor: Id, target: unknown, rank: unknown) {
  mustReign(w, actor);
  const r = own(PEERAGE, rank);
  if (!r) fail('Baron, Earl or Duke.');
  const c = cit(w, target as Id);
  if (c.id === actor) fail('The Crown is above the peerage.');
  if (!c.active || c.bot || c.defected) fail('Pick a citizen at home.');
  if (c.peerage?.rank === rank) fail(`${c.name} is already a ${r.title}.`);
  if (!c.peerage && peers(w).length >= lim(w, 'peers')) fail(`The peerage is full at ${lim(w, 'peers')}. Strip a title first, or ask Parliament for more.`);
  const was = c.peerage?.rank;
  c.peerage = { rank, by: actor, at: w.now };
  stamp(w, c.id, r.title, `Raised to the peerage by ${w.config.hosTitle} ${nm(w, actor)}`, 'good');
  approve(w, c.id, 2);
  bump(w, c.id, 'ennobled');
  gazette(w, 'hos', was ? `${c.name} is raised from ${PEERAGE[was].title} to ${r.title}.` : `${c.name} is raised to the peerage as a ${r.title}.`, '#/hos');
}
export function attaint(w: W, actor: Id, target: unknown) {
  mustReign(w, actor);
  const c = cit(w, target as Id);
  if (!c.peerage) fail(`${c.name} holds no title.`);
  const t = PEERAGE[c.peerage.rank].title;
  c.peerage = null;
  // an attainted peer's estates go back to the Crown (dynasty.ts)
  const lost = Object.keys(w.holdings || {}).filter((e) => w.holdings[e].holder === c.id);
  lost.forEach((e) => (w.holdings[e] = { ...w.holdings[e], holder: 'crown', since: w.now }));
  stamp(w, c.id, 'Attainted', `Stripped of the title of ${t}`, 'bad');
  approve(w, c.id, -3);
  gazette(w, 'hos', `${c.name} is stripped of the title of ${t} by order of the ${w.config.hosTitle}.`, '#/hos');
}
// once a week: the appanage; a peerage outlives neither the monarchy nor its holder's loyalty
export function crownWeek(w: W) {
  const monarchy = w.config.hos === 'monarchy';
  peers(w).forEach((c: any) => {
    if (!monarchy || c.defected) {
      c.peerage = null;
      return;
    }
    transfer(w, 'treasury', ca(c.id), PEERAGE[c.peerage.rank]?.pay ?? 2, `Appanage of a ${PEERAGE[c.peerage.rank]?.title ?? 'peer'}`);
  });
  if (!monarchy && w.crown) w.crown.proclamation = null;
}

// ---------- royal progresses ----------
export const PROGRESS_EVERY = 3 * DAY;
export const PROGRESS_COST = 15;
export function progress(w: W, actor: Id, pid: unknown) {
  mustReign(w, actor);
  mustBeFree(w, actor);
  seedProvinces(w);
  const p = own(w.provinces, pid);
  if (!p || p.owner !== 'realm') fail('That province is not part of the realm.');
  const k = w.crown;
  if (k.progressAt && w.now - k.progressAt < PROGRESS_EVERY) fail('The court travels every three days at most.');
  if (bal(w, 'treasury') < PROGRESS_COST) fail(`A progress costs ${PROGRESS_COST} from the Treasury.`);
  transfer(w, 'treasury', 'reserve', PROGRESS_COST, `A royal progress through ${PROVINCES[pid as string].name}`);
  k.progressAt = w.now;
  p.calmUntil = Math.max(p.calmUntil || 0, w.now + 7 * DAY);
  approve(w, actor, 2);
  meter(w, 'stability', 1, 'A royal progress');
  if (p.governor && w.citizens[p.governor]) (approve(w, p.governor, 1), earn(w, p.governor, 2, 'Received the Sovereign in your province'));
  bump(w, actor, 'progresses');
  gazette(w, 'hos', `${w.config.hosTitle} ${nm(w, actor)} makes a royal progress through ${PROVINCES[pid as string].name}. The crowds turn out${p.governor ? `, and Governor ${nm(w, p.governor)} receives the court` : ''}.`, '#/atlas', { k: 'progress', who: actor, place: PROVINCES[pid as string].name });
}

// ---------- triumphs ----------
export const TRIUMPH_COST = 30;
export const triumphDue = (w: W) => {
  const last = (w.wars || [])[0];
  return last && last.outcome === 'victory' && w.now - last.endedAt < 3 * DAY && !(w.triumph && w.triumph.war === last.endedAt) ? last : null;
};
export function holdTriumph(w: W, actor: Id) {
  if (!reigning(w, actor) && !canGovernEmpire(w, actor)) fail('Only the Sovereign or the Imperial High Commissioner holds a triumph.');
  const war = triumphDue(w);
  if (!war) fail('There is no fresh victory to celebrate.');
  const purse = imperialPurse(w);
  if (bal(w, purse) < TRIUMPH_COST && purse !== 'treasury') fail(`A triumph costs ${TRIUMPH_COST}. The war chest holds ${bal(w, purse)}.`);
  transfer(w, purse, 'reserve', TRIUMPH_COST, 'A triumph in the capital');
  const n = w.nations[war.nation]?.name ?? 'the enemy';
  w.triumph = { war: war.endedAt, nation: war.nation, by: actor, hero: war.general || null, at: w.now, until: w.now + 12 * HOUR, crowd: [] };
  meter(w, 'stability', 2, 'A triumph');
  if (war.general && w.citizens[war.general]) stamp(w, war.general, 'Triumph', `Rode through the capital after the victory over ${n}`, 'good');
  gazette(w, 'army', `A triumph for the victory over ${n}: the Army marches through the capital${war.general ? `, ${nm(w, war.general)} at its head` : ''}. Line the streets in the next 12 hours.`, '#/hos', { k: 'triumph', who: war.general || actor, place: n });
}
export function cheerTriumph(w: W, actor: Id) {
  const t = w.triumph;
  if (!t || t.until <= w.now) fail('There is no triumph in the streets.');
  mustBeFree(w, actor);
  if (cit(w, actor).defected) fail('You are abroad.');
  if (t.crowd.includes(actor)) fail('You are already in the crowd.');
  t.crowd.push(actor);
  earn(w, actor, 1, 'Lined the streets for the triumph');
  approve(w, actor, 1);
}
export function endTriumph(w: W) {
  const t = w.triumph;
  if (!t || t.done) return;
  t.done = true;
  if (t.crowd.length >= 3) meter(w, 'stability', 1, 'The crowds at the triumph');
  gazette(w, 'army', `The triumph is over. ${t.crowd.length} citizen${t.crowd.length === 1 ? '' : 's'} lined the streets.`, '#/hos');
}

// ---------- lèse-majesté ----------
export const LESE_EVERY = 2 * DAY;
export function chargeLese(w: W, actor: Id, target: unknown, words: unknown) {
  mustReign(w, actor);
  if (!absolute(w)) fail('Only an absolute monarch can charge lèse-majesté: it needs the Royal Prerogative or Royal Veto Act, or the empire.');
  const c = cit(w, target as Id);
  if (c.id === actor || !c.active || c.bot || c.defected) fail('Pick a citizen at home.');
  if (isPM(w, c.id)) fail('The Prime Minister answers to Parliament, not the dock.');
  const k = w.crown;
  if (k.leseAt && w.now - k.leseAt < LESE_EVERY) fail('The Crown may bring a charge every two days.');
  const why = text(words, 8, 200, 'charge');
  const id = openTrial(w, c.id, 'lese', actor, why);
  if (!id) fail(`${c.name} is on trial already, or there is nobody to try them.`);
  k.leseAt = w.now;
  approve(w, actor, -1);
}
