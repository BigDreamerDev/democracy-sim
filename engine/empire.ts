// The empire: the Imperial Prerogative Act (an Act in acts.ts: 'imperial') and the Imperial High Commission.
// The Act makes the monarch an Emperor or Empress, makes the realm an Empire by name, and sets up the High Commission.
// The High Commission (an office: template 'highcommission', power 'imperial') governs what the empire holds beyond
// the realm: it can levy tribute from provinces (more money, more unrest), name a governor for each (a citizen, paid
// 5 a week, who halves the chance of an uprising), garrison them, and, while the Act is law, take friendly nations as
// protectorates: they pay 10 a week and fight beside us, but chafe, and break away if they stop liking us.
import { W, Id, DAY, fail, own, cit, nm, gazette, transfer, bal, ca, chance, stamp, approve, meter, mustBeFree, isPM, hasPower, newId, realmPlace, inForce, allCitizens, earn, bump } from './core';
import { createOffice, TEMPLATES } from './offices';
import { imperialPurse } from './warmachine';
import { establishPrivy, dissolvePrivy } from './privy';
import { callGeneralElection } from './politics';
import { PROVINCES, seedProvinces, moodShift, atWar } from './foreign';

export const HC = 'highcommission';
export const LEVY = 10;
export const GOVERNOR_PAY = 5;
export const PROTECTORATE_TRIBUTE = 10;

// the High Commission: any office with the 'imperial' power; with none filled, the Prime Minister acts for it
export const highCommission = (w: W) => Object.values(w.offices).find((o: any) => o.powers?.includes('imperial')) as any;
export const canGovernEmpire = (w: W, id: Id) => hasPower(w, id, 'imperial') || (isPM(w, id) && !highCommission(w)?.holder);
function mustGovern(w: W, actor: Id) {
  if (!highCommission(w) && !inForce(w, 'imperial')) fail('The empire needs an Imperial High Commission: create it by law, or pass the Imperial Prerogative Act.');
  if (!canGovernEmpire(w, actor)) fail('Only the Imperial High Commissioner governs the empire.');
}
// make sure there is a High Commission; an office already named for it (made by hand, by decree) is adopted, not duplicated
export function adoptHighCommission(w: W, ref: string | null) {
  const found = (Object.values(w.offices) as any[]).find((o) => o.template === HC || /imperial\s+high\s+commission/i.test(o.name || ''));
  if (found) {
    const fixed = found.template !== HC || found.title !== 'Imperial High Commissioner' || !found.powers.includes('imperial') || !found.powers.includes('army');
    found.template = HC;
    found.name = 'Imperial High Commission';
    found.title = 'Imperial High Commissioner';
    found.powers = [...new Set([...(found.powers || []), 'imperial', 'army'])];
    found.blurb = TEMPLATES[HC].blurb;
    return fixed;
  }
  if (ref) createOffice(w, { template: HC }, ref);
  return true;
}

// ---------- titles: Emperor and Empress under the Act ----------
export const imperialTitle = (t: string) => (/^(king|emperor)$/i.test(t) ? 'Emperor' : 'Empress');
export const royalTitle = (t: string) => (/^(king|emperor)$/i.test(t) ? 'King' : 'Queen');
export function titleFor(w: W, t: unknown) {
  if (typeof t !== 'string' || !/^(king|queen|emperor|empress)$/i.test(t)) fail('Choose King or Queen (Emperor or Empress in an empire).');
  return inForce(w, 'imperial') ? imperialTitle(t) : royalTitle(t);
}

// ---------- the Act ----------
export function proclaimEmpire(w: W, ref: string) {
  w.config.imperialFrom = { title: w.config.hosTitle, name: w.config.realmName };
  if (w.config.hos === 'monarchy') w.config.hosTitle = imperialTitle(w.config.hosTitle);
  if (!/\bempire\b/i.test(w.config.realmName)) renameRealm(w, realmPlace(w) === 'the Realm' ? 'The Empire' : `The ${realmPlace(w)} Empire`, 'the Imperial Prerogative Act');
  adoptHighCommission(w, ref);
  establishPrivy(w, ref);
  gazette(w, 'law', `The Imperial Prerogative Act is law. ${w.config.hos === 'monarchy' ? `${nm(w, w.hos.holder)} reigns as ${w.config.hosTitle}` : 'The realm is an Empire'}, the ${w.config.realmName} is proclaimed, the Imperial Privy Council sits in place of Parliament, and the Imperial High Commission governs the empire and commands its forces.`, '#/atlas', { k: 'empire', who: w.hos?.holder || null, title: w.config.hosTitle, place: w.config.realmName });
}
export function unproclaimEmpire(w: W) {
  if (w.config.hos === 'monarchy') w.config.hosTitle = royalTitle(w.config.hosTitle);
  Object.values(w.nations).forEach((n: any) => n.protectorate && ((n.protectorate = null), moodShift(n, 1, 'Our protectorate ended')));
  w.config.imperialFrom = null;
  if (w.privy) (dissolvePrivy(w), callGeneralElection(w, w.now + 3 * DAY));
  gazette(w, 'law', `The Imperial Prerogative Act is repealed. ${w.config.hos === 'monarchy' ? `The ${w.config.hosTitle} reigns again as a monarch, not an ${/king/i.test(w.config.hosTitle) ? 'Emperor' : 'Empress'}` : 'The imperial powers lapse'}, and every protectorate is released. The realm keeps its name until a law changes it.`, '#/laws');
}

// ---------- renaming the realm (a constitution clause, or the Act) ----------
export function renameRealm(w: W, to: string, how: string) {
  const was = w.config.realmName;
  if (was === to) return;
  w.config.formerNames = [...(w.config.formerNames || []), { name: was, until: w.now }].slice(-10);
  w.config.realmName = to;
  gazette(w, 'law', `The realm is renamed by ${how}: the ${was} is now the ${to}.`, '#/laws');
}
// a new name must be plain words, and must not be mistaken for a nation abroad
export function checkRealmName(w: W, v: unknown) {
  if (typeof v !== 'string') fail('Write the new name.');
  const t = v.trim().replace(/\s+/g, ' ');
  if (t.length < 3 || t.length > 60) fail('A realm name is 3 to 60 characters.');
  if (!/^[\p{L}\p{N}][\p{L}\p{N} '’&.,-]*$/u.test(t)) fail('Use letters, numbers, spaces and ordinary punctuation in the realm name.');
  const words = (s: string) => s.toLowerCase().replace(/^the /, '').split(/\s+/).filter((x) => !['of', 'the', 'free', 'city', 'commonwealth', 'isles', 'kingdom', 'empire', 'republic', 'realm'].includes(x));
  const mine = new Set(words(t));
  const clash = (Object.values(w.nations) as any[]).find((n) => words(n.name).some((x) => mine.has(x)));
  if (clash) fail(`That name is too like ${clash.name}, a nation abroad. Pick another.`);
  return t;
}

// ---------- the High Commission's powers ----------
const held = (w: W, pid: unknown) => {
  seedProvinces(w);
  const p = own(w.provinces, pid);
  if (!p || p.owner !== 'realm') fail('That province is not part of the empire.');
  return p;
};
export function levy(w: W, actor: Id, pid: unknown, on: unknown) {
  mustGovern(w, actor);
  const p = held(w, pid);
  if (on !== true && on !== false) fail('Levy tribute, or stop.');
  p.levy = on;
  gazette(w, 'government', on ? `The Imperial High Commission levies tribute on ${PROVINCES[pid as string].name}: ${LEVY} crowns a week, and resentment.` : `The levy on ${PROVINCES[pid as string].name} is lifted.`, '#/atlas', on ? { k: 'levy', by: actor, place: PROVINCES[pid as string].name } : undefined);
}
export function governor(w: W, actor: Id, pid: unknown, target: unknown) {
  mustGovern(w, actor);
  const p = held(w, pid);
  const name = PROVINCES[pid as string].name;
  if (target === null || target === '' || target === undefined) {
    if (!p.governor) fail('There is no governor to recall.');
    gazette(w, 'government', `${nm(w, p.governor)} is recalled as Governor of ${name}.`, '#/atlas');
    p.governor = null;
    return;
  }
  const c = cit(w, target as Id);
  if (!c.active || c.bot || c.defected) fail('Pick a citizen at home.');
  mustBeFree(w, c.id);
  p.governor = c.id;
  stamp(w, c.id, 'Governor', name, 'ink');
  gazette(w, 'government', `${c.name} is appointed Governor of ${name}.`, '#/atlas', { k: 'governor', who: c.id, by: actor, place: name });
}
// take a friendly nation under the empire's protection (the Act must be law); once a week per nation
export function protectorate(w: W, actor: Id, nid: unknown) {
  mustGovern(w, actor);
  if (!inForce(w, 'imperial')) fail('Protectorates need the Imperial Prerogative Act.');
  const n = own(w.nations, nid);
  if (!n) fail('Unknown country.');
  if (n.protectorate) fail(`${n.name} is already under our protection.`);
  if (atWar(w, n.id)) fail('Not while we are at war with them.');
  if (n.ruler) fail(`${n.name} is ruled by one of our own defectors. They will not kneel.`);
  if (n.mood < 3) fail(`${n.name} is not friendly enough to accept our protection.`);
  if (n.protectAskedAt && w.now - n.protectAskedAt < 7 * DAY) fail('They answered recently. Ask again next week.');
  n.protectAskedAt = w.now;
  const yes = chance(w, Math.min(0.85, 0.3 + 0.2 * (n.mood - 3) + (n.embassy ? 0.15 : 0) + ((n.power || 3) <= 3 ? 0.15 : 0)));
  if (!yes) {
    moodShift(n, -1, 'Insulted by an offer of protection');
    return gazette(w, 'foreign', `${n.name} refuses to become a protectorate of the ${w.config.realmName}.`, '#/nation/' + n.id);
  }
  n.protectorate = { since: w.now, by: actor };
  approve(w, actor, 3);
  gazette(w, 'foreign', `${n.name} becomes a protectorate of the ${w.config.realmName}: tribute of ${PROTECTORATE_TRIBUTE} crowns a week, and its army at our side.`, '#/nation/' + n.id, { k: 'protectorate', place: n.name, by: actor });
}
export function release(w: W, actor: Id, nid: unknown) {
  mustGovern(w, actor);
  const n = own(w.nations, nid);
  if (!n?.protectorate) fail('That nation is not a protectorate.');
  n.protectorate = null;
  moodShift(n, 1, 'We gave them back their freedom');
  gazette(w, 'foreign', `The ${w.config.realmName} releases ${n.name} from its protection.`, '#/nation/' + n.id);
}

// ---------- once a week ----------
export function empireWeek(w: W) {
  seedProvinces(w);
  Object.entries(w.provinces as Record<string, any>).forEach(([id, p]) => {
    if (p.owner !== 'realm') return void ((p.levy = false), (p.governor = null));
    if (p.levy) {
      transfer(w, 'reserve', imperialPurse(w), LEVY + (w.army?.campaign ? 5 : 0), `Tribute from ${PROVINCES[id].name}${w.army?.campaign ? ' (a war levy)' : ''}`);
      // a province we always held does not rise, but it riots
      if (PROVINCES[id].start === 'realm' && !(p.calmUntil > w.now) && chance(w, 0.2)) (meter(w, 'stability', -1, `Tax riots in ${PROVINCES[id].name}`), gazette(w, 'government', `Tax riots in ${PROVINCES[id].name} over the imperial levy.`, '#/atlas'));
    }
    if (p.governor) {
      if (!w.citizens[p.governor]?.active || w.citizens[p.governor].defected) p.governor = null;
      else transfer(w, 'treasury', ca(p.governor), GOVERNOR_PAY, `Governor of ${PROVINCES[id].name}`);
    }
  });
  Object.values(w.nations).forEach((n: any) => {
    if (!n.protectorate) return;
    const t = Math.min(PROTECTORATE_TRIBUTE, bal(w, 'nation:' + n.id));
    if (t > 0) transfer(w, 'nation:' + n.id, imperialPurse(w), t, `Tribute from the protectorate of ${n.name}`);
    if (!n.embassy && chance(w, 0.15)) moodShift(n, -1, 'They chafe under our protection');
    if (n.mood < 3 && chance(w, 0.4)) {
      n.protectorate = null;
      moodShift(n, -1, 'They threw off our protection');
      meter(w, 'stability', -2, `${n.name} broke away`);
      gazette(w, 'foreign', `${n.name} declares its independence and throws off the protection of the ${w.config.realmName}.`, '#/nation/' + n.id);
    }
  });
}
// how much more (or less) likely a province we took is to rise this week
export const unrest = (p: any, now = 0) => (p.calmUntil > now ? 0 : ((p.governor ? 0.5 : 1) * 0.35 + (p.levy ? 0.15 : 0)) * (p.fort ? 0.4 : 1) * (p.strainUntil > now ? 1.5 : 1));

// ---------- the Governor's own powers: one decree for their province every three days ----------
export const GOVERNOR_DECREES: Record<string, { label: string; what: string }> = {
  festival: { label: 'Hold a festival', what: '10 from the Treasury. No unrest in the province for a week. +1 approval.' },
  works: { label: 'Pay for public works', what: '15 from your own pocket. No unrest for a week. +2 approval and 2 Influence.' },
  crackdown: { label: 'Crack down', what: 'No unrest for a week, but Stability −1 and −2 approval.' },
  tribute: { label: 'Squeeze extra tribute', what: '12 crowns to the empire now; unrest half as likely again for a week.' },
  militia: { label: 'Raise a militia', what: 'A new regiment for the Army, free (once a week); unrest half as likely again for a week.' }
};
export const DECREE_EVERY = 3 * DAY;
export function governorDecree(w: W, actor: Id, pid: unknown, kind: unknown) {
  seedProvinces(w);
  const p = own(w.provinces, pid);
  if (!p || p.owner !== 'realm') fail('That province is not part of the empire.');
  if (p.governor !== actor) fail('Only its Governor can issue a decree for that province.');
  mustBeFree(w, actor);
  const d = own(GOVERNOR_DECREES, kind);
  if (!d) fail('Pick a decree.');
  if (p.decreeAt && w.now - p.decreeAt < DECREE_EVERY) fail('A Governor issues one decree every three days.');
  const name = PROVINCES[pid as string].name;
  const week = w.now + 7 * DAY;
  if (kind === 'festival') (transfer(w, 'treasury', 'reserve', 10, `A festival in ${name}`), (p.calmUntil = week), approve(w, actor, 1));
  if (kind === 'works') {
    if (bal(w, ca(actor)) < 15) fail('Public works cost 15 crowns from your own pocket.');
    transfer(w, ca(actor), 'reserve', 15, `Public works in ${name}`);
    p.calmUntil = week;
    approve(w, actor, 2);
    earn(w, actor, 2, `Public works in ${name}`);
  }
  if (kind === 'crackdown') (p.calmUntil = week, meter(w, 'stability', -1, `A crackdown in ${name}`), approve(w, actor, -2));
  if (kind === 'tribute') (transfer(w, 'reserve', imperialPurse(w), 12, `Extra tribute from ${name}`), (p.strainUntil = week));
  if (kind === 'militia') {
    if (p.militiaAt && w.now - p.militiaAt < 7 * DAY) fail('The province raised a militia this week already.');
    if ((w.army.troops ?? 6) >= 20) fail('The Army has all the regiments it can field.');
    w.army.troops = (w.army.troops ?? 6) + 1;
    p.militiaAt = w.now;
    p.strainUntil = week;
  }
  p.decreeAt = w.now;
  bump(w, actor, 'decrees');
  gazette(w, 'government', `Governor ${nm(w, actor)} of ${name}: ${({ festival: 'a festival is held for the whole province', works: 'new roads and wells, paid for out of the Governor’s own pocket', crackdown: 'soldiers on the streets, and a curfew', tribute: 'the tax collectors go round again', militia: 'a provincial militia marches to join the Army' } as any)[kind as string]}.`, '#/atlas', { k: 'gdecree', who: actor, place: name, title: d.label, decree: kind });
}
export const governed = (w: W) => allCitizens(w).filter((c: any) => Object.values(w.provinces || {}).some((p: any) => p.governor === c.id));
