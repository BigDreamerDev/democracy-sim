// The Crown: a new monarch's accession and coronation, homage, coronation honours, abdication to an heir,
// jubilees and pretenders. Everything here is public. State: w.crown = { reign, offer }, and the line of
// monarchs in w.fame.monarchs. syncCrown() runs after every command and deadline and whenever the throne changes hands.
import { W, Id, DAY, fail, cit, nm, own, text, allCitizens, exiled, detained, mustBeFree, gazette, stamp, approve, meter, bump, transfer, ca, earn } from './core';
import { setHos, startHosSelection } from './politics';
import { fame } from './glory';
import { household } from './offices';

export const OATHS: Record<string, { label: string; text: string; effect: string }> = {
  parliament: { label: 'To Parliament', text: 'I will govern by the laws this House makes, and by no others.', effect: 'Stability +4' },
  people: { label: 'To the people', text: 'I hold this crown in trust for every citizen of the realm.', effect: 'Your approval +4' },
  crown: { label: 'To the Crown alone', text: 'I answer to the Crown, and the Crown answers to no one.', effect: 'Influence +8, stability −2' }
};
export const CORONATION_BOUNTY = 10;
export const JUBILEE_BOUNTY = 5;
export const JUBILEE_DAYS = 30;
export const CORONATION_HONOURS = 3;

export function crown(w: W) {
  w.crown ??= { reign: null, offer: null };
  return w.crown;
}
const practice = (w: W) => !!w.induction && !w.induction.done;
// a coup regime or a provisional government: ceremonies wait
const rough = (w: W) => (!!w.regime && w.regime.type !== 'civil') || !!w.transition;
const roman = (n: number) => {
  let out = '';
  ([[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']] as [number, string][]).forEach(([v, s]) => {
    while (n >= v) (out += s), (n -= v);
  });
  return out;
};
const numeralFor = (w: W, name: string) => roman(1 + (fame(w).monarchs || []).filter((m: any) => String(m.name).toLowerCase() === name.toLowerCase()).length);
export const regnal = (w: W, r: any = w.crown?.reign) => (r ? `${w.config.hosTitle} ${r.name} ${r.numeral}` : '');
const everyone = (w: W) => allCitizens(w).filter((c: any) => !c.bot && !c.suspended);
function payAll(w: W, n: number, memo: string) {
  everyone(w).forEach((c: any) => transfer(w, 'treasury', ca(c.id), n, memo));
}

export function syncCrown(w: W) {
  const k = crown(w);
  const h = w.config.hos === 'monarchy' ? w.hos.holder : null;
  if (k.reign && k.reign.id !== h) endReign(w, k.ending || (h ? 'succeeded' : 'the throne fell vacant'));
  k.ending = null;
  if (k.offer && k.offer.by !== h) k.offer = null;
  if (h && !k.reign) {
    const name = String(nm(w, h)).trim().split(/\s+/)[0].slice(0, 24) || 'Nameless';
    k.reign = { id: h, at: w.now, name, numeral: numeralFor(w, name), styled: false, oath: null, crownAt: w.now + DAY, crownedAt: null, postponed: false,
      homage: {}, homageUntil: null, honours: 0, jubileeAt: null, jubilees: 0, claim: null, claimed: [] };
    gazette(w, 'hos', `${nm(w, h)} takes the throne. The coronation is in 24 hours.`, '#/hos');
  }
  // the Royal Household: made (or emptied) once per reign, gone when there is no monarch
  if (k.reign && k.householdFor !== k.reign.at) (k.householdFor = k.reign.at), household(w, true);
  if (!k.reign && k.householdFor) (k.householdFor = null), household(w, false);
}
function endReign(w: W, end: string) {
  const k = crown(w);
  const r = k.reign;
  k.reign = null;
  if (!r || practice(w)) return;
  const f = fame(w);
  f.monarchs ??= [];
  f.monarchs.push({ id: r.id, who: nm(w, r.id), name: r.name, numeral: r.numeral, title: w.config.hosTitle, at: r.at, crownedAt: r.crownedAt, until: w.now, end, oath: r.oath, jubilees: r.jubilees });
  if (f.monarchs.length > 60) f.monarchs.shift();
}

// the monarch chooses a regnal name, King or Queen, and the oath they will swear
export function style(w: W, actor: Id, a: any) {
  const r = crown(w).reign;
  if (!r || r.id !== actor) fail('Only the monarch about to be crowned can do that.');
  if (r.crownedAt) fail('You are already crowned. A regnal name is for life.');
  const name = text(a?.name, 2, 24, 'regnal name').trim();
  if (!/^[\p{L}][\p{L} '’-]*$/u.test(name)) fail('A regnal name is letters only.');
  if (!own(OATHS, a?.oath)) fail('Choose one of the three oaths.');
  if (a?.title !== 'King' && a?.title !== 'Queen') fail('Choose King or Queen.');
  w.config.hosTitle = a.title;
  r.name = name;
  r.numeral = numeralFor(w, name);
  r.oath = a.oath;
  r.styled = true;
  gazette(w, 'hos', `${nm(w, actor)} will reign as ${regnal(w, r)}.`, '#/hos');
}
// the monarch may hold the ceremony early; otherwise the clock holds it at crownAt
export function hold(w: W, actor: Id) {
  const r = crown(w).reign;
  if (!r || r.id !== actor) fail('Only the monarch about to be crowned can do that.');
  if (r.crownedAt) fail('You are already crowned.');
  if (rough(w)) fail('There can be no coronation until the country is settled.');
  crownNow(w);
}
export function crownNow(w: W) {
  const r = crown(w).reign;
  if (!r || r.crownedAt) return;
  if (rough(w)) {
    if (!r.postponed) gazette(w, 'hos', 'The coronation is postponed until the country is settled.', '#/hos');
    r.postponed = true;
    r.crownAt = w.now + DAY;
    return;
  }
  r.crownedAt = w.now;
  r.crownAt = null;
  r.oath = r.oath || 'people';
  r.homageUntil = w.now + DAY;
  r.honours = CORONATION_HONOURS;
  r.jubileeAt = w.now + JUBILEE_DAYS * DAY;
  if (r.oath === 'parliament') meter(w, 'stability', 4, 'The coronation oath');
  else if (r.oath === 'people') approve(w, r.id, 4);
  else (earn(w, r.id, 8, 'Crowned'), meter(w, 'stability', -2, 'The coronation oath'));
  const title = regnal(w, r);
  everyone(w).forEach((c: any) => c.id !== r.id && stamp(w, c.id, 'Witnessed the Coronation', title, 'good'));
  stamp(w, r.id, 'Anointed', title, 'good');
  bump(w, r.id, 'crowned');
  payAll(w, CORONATION_BOUNTY, 'Coronation bounty');
  gazette(w, 'hos', `${title} is crowned, and swears the oath ${OATHS[r.oath].label.toLowerCase()}: “${OATHS[r.oath].text}” Every citizen receives ${CORONATION_BOUNTY} crowns. Long live the ${w.config.hosTitle}!`, '#/hos');
}

// homage: for a day after the coronation, every citizen may swear or publicly refuse
export function homage(w: W, actor: Id, swear: unknown) {
  const r = crown(w).reign;
  if (!r || !r.crownedAt || !r.homageUntil || w.now >= r.homageUntil) fail('Homage is not being taken now.');
  if (actor === r.id) fail('You cannot swear homage to yourself.');
  mustBeFree(w, actor);
  if (own(r.homage, actor) !== undefined) fail('You have already answered.');
  const yes = swear === true;
  r.homage[actor] = yes;
  approve(w, r.id, yes ? 1 : -1);
  bump(w, actor, yes ? 'homage' : 'homageRefused');
  stamp(w, actor, yes ? 'Swore homage' : 'Refused homage', regnal(w, r), yes ? 'good' : 'ink');
  if (!yes) gazette(w, 'hos', `${nm(w, actor)} refuses homage to ${regnal(w, r)}.`, '#/hos');
}
export function closeHomage(w: W) {
  const r = crown(w).reign;
  if (!r) return;
  r.homageUntil = null;
  const v = Object.values(r.homage);
  gazette(w, 'hos', `The homage roll closes: ${v.filter((x) => x).length} swore to ${regnal(w, r)}, ${v.filter((x) => !x).length} refused.`, '#/hos');
}

// abdication: to a named heir (who must accept within a day), or leaving the throne empty
export function abdicate(w: W, actor: Id, heir: unknown) {
  const k = crown(w);
  const r = k.reign;
  if (!r || r.id !== actor) fail('Only the monarch can abdicate.');
  if (rough(w)) fail('You cannot abdicate until the country is settled.');
  if (heir) {
    const h = cit(w, heir as Id);
    if (h.id === actor) fail('Name someone else as your heir.');
    if (!h.active || h.bot || h.suspended || exiled(w, h.id) || detained(w, h.id)) fail(`${h.name} cannot take the throne.`);
    k.offer = { by: actor, heir: h.id, until: w.now + DAY };
    return gazette(w, 'hos', `${regnal(w, r)} offers to abdicate in favour of ${h.name}, who has a day to answer.`, '#/hos');
  }
  k.offer = null;
  k.ending = 'abdicated';
  stamp(w, actor, 'Abdicated', regnal(w, r), 'ink');
  gazette(w, 'hos', `${regnal(w, r)} abdicates. The throne is empty.`, '#/hos');
  w.hos = { holder: null, since: w.now, until: null };
  syncCrown(w);
  startHosSelection(w);
}
export function withdrawOffer(w: W, actor: Id) {
  const k = crown(w);
  if (!k.offer || k.offer.by !== actor) fail('You have made no offer.');
  k.offer = null;
  gazette(w, 'hos', `${regnal(w)} will not abdicate after all.`, '#/hos');
}
export function answerHeir(w: W, actor: Id, yes: unknown) {
  const k = crown(w);
  const o = k.offer;
  if (!o || o.heir !== actor) fail('Nobody has offered you the throne.');
  k.offer = null;
  if (yes !== true) return gazette(w, 'hos', `${nm(w, actor)} declines the throne.`, '#/hos');
  mustBeFree(w, actor);
  const was = regnal(w);
  stamp(w, o.by, 'Abdicated', was, 'ink');
  gazette(w, 'hos', `${was} abdicates in favour of ${nm(w, actor)}.`, '#/hos');
  k.ending = 'abdicated';
  setHos(w, actor, null);
  syncCrown(w);
}
export function lapseOffer(w: W) {
  const k = crown(w);
  if (!k.offer) return;
  gazette(w, 'hos', `${nm(w, k.offer.heir)} did not answer. ${regnal(w)} stays on the throne.`, '#/hos');
  k.offer = null;
}

export function jubilee(w: W) {
  const r = crown(w).reign;
  if (!r) return;
  r.jubileeAt = w.now + JUBILEE_DAYS * DAY;
  if (rough(w)) return;
  r.jubilees += 1;
  payAll(w, JUBILEE_BOUNTY, 'Jubilee bounty');
  meter(w, 'stability', 2, 'The Jubilee');
  stamp(w, r.id, 'Jubilee', `${r.jubilees * JUBILEE_DAYS} days on the throne`, 'good');
  gazette(w, 'hos', `Jubilee: ${regnal(w, r)} has reigned ${r.jubilees * JUBILEE_DAYS} days. A public holiday, and ${JUBILEE_BOUNTY} crowns for every citizen.`, '#/hos');
}

// pretenders: someone who refused homage may claim the throne. Citizens back the claim in public for two days.
// It succeeds with more backers than citizens still sworn to the monarch, and at least a third of the realm.
export const claimNeed = (w: W) => Math.max(2, Math.ceil(everyone(w).length / 3));
export const sworn = (w: W, r: any) => Object.keys(r.homage).filter((id) => r.homage[id] === true && !(r.claim?.backers || []).includes(id));
export function claim(w: W, actor: Id) {
  const r = crown(w).reign;
  if (!r || !r.crownedAt) fail('There is no crowned monarch to challenge.');
  if (rough(w)) fail('Nobody can claim the throne until the country is settled.');
  mustBeFree(w, actor);
  if (own(r.homage, actor) !== false) fail('Only someone who refused homage can claim the throne.');
  if (r.claim) fail('A claim is already being pressed.');
  if (r.claimed.includes(actor)) fail('You have already pressed your claim against this monarch.');
  r.claimed.push(actor);
  r.claim = { by: actor, at: w.now, until: w.now + 2 * DAY, backers: [actor] };
  meter(w, 'stability', -3, 'A pretender claims the throne');
  gazette(w, 'hos', `${nm(w, actor)} claims the throne against ${regnal(w, r)}. The realm has two days to choose.`, '#/hos');
}
export function back(w: W, actor: Id) {
  const r = crown(w).reign;
  const c = r?.claim;
  if (!r || !c) fail('Nobody is claiming the throne.');
  mustBeFree(w, actor);
  if (actor === r.id) fail('You cannot back a claim against yourself.');
  if (c.backers.includes(actor)) fail('You already back the claim.');
  c.backers.push(actor);
  if (r.homage[actor] === true) {
    approve(w, actor, -3);
    stamp(w, actor, 'Oathbreaker', `Swore to ${regnal(w, r)}, then backed ${nm(w, c.by)}`, 'bad');
  }
  gazette(w, 'hos', `${nm(w, actor)} backs ${nm(w, c.by)}'s claim to the throne.`, '#/hos');
}
export function settleClaim(w: W) {
  const k = crown(w);
  const r = k.reign;
  const c = r?.claim;
  if (!r || !c) return;
  r.claim = null;
  const backers = c.backers.filter((id: Id) => w.citizens[id]?.active && !exiled(w, id) && !detained(w, id));
  const ok = backers.includes(c.by) && !rough(w) && backers.length >= claimNeed(w) && backers.length > sworn(w, { ...r, claim: c }).length;
  if (!ok) {
    approve(w, c.by, -5);
    stamp(w, c.by, 'Pretender', `Failed against ${regnal(w, r)}`, 'bad');
    approve(w, r.id, 3);
    return gazette(w, 'hos', `${nm(w, c.by)}'s claim to the throne fails with ${backers.length} behind it. ${regnal(w, r)} reigns on.`, '#/hos');
  }
  const was = regnal(w, r);
  stamp(w, r.id, 'Dethroned', `By ${nm(w, c.by)}`, 'bad');
  stamp(w, c.by, 'Took the throne', `From ${was}`, 'ink');
  meter(w, 'stability', -6, 'The throne changes hands');
  gazette(w, 'hos', `${was} is dethroned. ${nm(w, c.by)} takes the crown with ${backers.length} behind the claim.`, '#/hos');
  k.ending = 'dethroned by a pretender';
  setHos(w, c.by, null);
  syncCrown(w);
}
