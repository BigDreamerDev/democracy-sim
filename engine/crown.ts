// The Crown: a new monarch's accession and coronation, homage, coronation honours, abdication to an heir,
// jubilees and pretenders. Everything here is public. State: w.crown = { reign, offer }, and the line of
// monarchs in w.fame.monarchs. syncCrown() runs after every command and deadline and whenever the throne changes hands.
import { lim } from './limits';
import { W, Id, DAY, HOUR, fail, cit, nm, own, text, int, chance, allCitizens, exiled, detained, mustBeFree, gazette, stamp, approve, meter, bump, transfer, ca, earn, holderOf } from './core';
import { moodShift } from './foreign';
import { titleFor } from './empire';
import { startWar, heroOf, beaten } from './war';
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
  k.court ??= {};
  const h = w.config.hos === 'monarchy' ? w.hos.holder : null;
  if (k.reign && k.reign.id !== h) endReign(w, k.ending || (h ? 'succeeded' : 'the throne fell vacant'));
  k.ending = null;
  if (k.offer && k.offer.by !== h) k.offer = null;
  if (h && !k.reign) {
    const name = String(nm(w, h)).trim().split(/\s+/)[0].slice(0, 24) || 'Nameless';
    k.reign = { id: h, at: w.now, name, numeral: numeralFor(w, name), styled: false, oath: null, crownAt: w.now + DAY, crownedAt: null, postponed: false,
      homage: {}, homageUntil: null, honours: 0, jubileeAt: null, jubilees: 0, claim: null, claimed: [], toasts: 0, toastDay: null, toastedToday: [] };
    gazette(w, 'hos', `${nm(w, h)} takes the throne. The coronation is in 24 hours.`, '#/hos');
  }
  // the Royal Household: made (or emptied) once per reign, gone when there is no monarch
  if (k.reign && k.householdFor !== k.reign.at) (k.householdFor = k.reign.at), household(w, true);
  if (!k.reign && k.householdFor) (k.householdFor = null), household(w, false);
  // the Court Circular: every evening at 18:00 while a monarch reigns
  if (k.reign && !k.circularAt) {
    let t = Math.floor(w.now / DAY) * DAY + 18 * HOUR;
    if (t <= w.now) t += DAY;
    k.circularAt = t;
  }
  if (!k.reign && k.circularAt) (k.circularAt = null), (k.court = {});
}

// ---------- the Court Circular: what the Sovereign and the officers of state did today (public acts only) ----------
const COURT: Record<string, [string, string]> = {
  'gov.decree': ['royal decree', 'royal decrees'], 'gov.edict': ['decree', 'decrees'], 'regime.decree': ['decree', 'decrees'],
  'gov.appoint': ['appointment', 'appointments'], 'prop.new': ['bill tabled', 'bills tabled'], 'prop.assent': ['Royal Assent', 'Royal Assents'],
  'prop.hasten': ['bill hastened', 'bills hastened'], 'gov.consent': ['bill ruled on', 'bills ruled on'], 'hos.honour': ['honour', 'honours'],
  'hos.pardon': ['pardon', 'pardons'], 'q.approve': ['question ruled on', 'questions ruled on'], 'q.answer': ['question answered', 'questions answered'],
  'army.readiness': ['order to the Army', 'orders to the Army'], 'gov.speaker': ['order on the Speaker', 'orders on the Speaker'],
  'gov.seat': ['seat filled', 'seats filled'], 'gov.unseat': ['MP unseated', 'MPs unseated'], 'gov.deputy': ['Deputy named', 'Deputies named']
};
const courtier = (w: W, id: Id) => ['chamberlain', 'privyseal'].map((k) => w.offices[k]).find((o: any) => o?.holder === id);
export function court(w: W, actor: Id, cmd: string) {
  const k = crown(w);
  if (!k.reign || practice(w) || !own(COURT, cmd)) return;
  if (actor !== k.reign.id && !courtier(w, actor)) return;
  const m = (k.court[actor] ??= {});
  m[cmd] = (m[cmd] || 0) + 1;
}
export function circular(w: W) {
  const k = crown(w);
  const due = k.circularAt;
  if (!due) return;
  k.circularAt = due + DAY;
  while (k.circularAt <= w.now) k.circularAt += DAY;
  const r = k.reign;
  const acts = k.court || {};
  k.court = {};
  if (!r) return void (k.courtToasts = 0);
  const who = (id: Id) => (id === r.id ? regnal(w, r) : `The ${courtier(w, id)?.title ?? 'officer'}, ${nm(w, id)}`);
  const lines = Object.entries(acts).map(([id, m]: [string, any]) => `${who(id)}: ${Object.entries(m).map(([cmd, n]: [string, any]) => `${n} ${COURT[cmd][n === 1 ? 0 : 1]}`).join(', ')}.`);
  const toasts = k.courtToasts || 0;
  k.courtToasts = 0;
  if (!lines.length && !toasts) return;
  gazette(w, 'hos', `Court Circular. ${lines.join(' ')}${toasts ? ` ${toasts} loyal toast${toasts === 1 ? ' was' : 's were'} raised to ${regnal(w, r)}.` : ''}`, '#/hos');
}

// ---------- the loyal toast: once a day, any citizen may raise a glass to the monarch ----------
export function toast(w: W, actor: Id) {
  const r = crown(w).reign;
  if (!r || !r.crownedAt) fail('There is no crowned monarch to toast.');
  if (actor === r.id) fail('You cannot toast yourself.');
  mustBeFree(w, actor);
  const day = Math.floor(w.now / DAY);
  if (r.toastDay !== day) (r.toastDay = day), (r.toastedToday = []);
  if (r.toastedToday.includes(actor)) fail('You have already raised a glass today.');
  r.toastedToday.push(actor);
  r.toasts = (r.toasts || 0) + 1;
  crown(w).courtToasts = (crown(w).courtToasts || 0) + 1;
  earn(w, actor, 1, 'A loyal toast');
  bump(w, actor, 'toasts');
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
  w.config.hosTitle = titleFor(w, a?.title);
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

// pretenders: someone who refused homage, or a monarch who lost the throne, may claim it. The realm takes sides in
// public for two days. Each side has weight: a backer counts 1, the General 3 (4 as a war hero); a foreign power that
// recognises the pretender adds 2, the monarch's rally 2, a loyal Army stands with the throne. The claim succeeds with
// at least a third of the realm behind it and more weight than the throne. The monarch may instead buy the pretender
// off with a dukedom. A foreign power whose pretender fails may go to war for them (war.ts); if that war is lost, the
// enemy puts its pretender on the throne. History: w.crown.claims.
export const claimNeed = (w: W) => Math.max(2, Math.ceil(everyone(w).length / 3));
export const CLAIM_COOLDOWN = 10 * DAY;
export const RALLY_COST = 20;
export const sworn = (w: W, r: any) => Object.keys(r.homage).filter((id) => r.homage[id] === true && !(r.claim?.backers || []).includes(id) && w.citizens[id]?.active && !exiled(w, id) && !detained(w, id));
// who may claim: refused homage to this monarch, or once wore the crown themselves (a restoration)
export const mayClaim = (w: W, r: any, id: Id) => own(r.homage, id) === false || (fame(w).monarchs || []).some((m: any) => m.id === id && /dethroned|deposed|vacant/.test(m.end || ''));
const weight = (w: W, id: Id) => (w.offices.army && holderOf(w, 'army') === id ? (heroOf(w) === id ? 4 : 3) : 1);
// foreign recognition is likelier from a nation that dislikes the realm
const RECOGNISE = [0.7, 0.5, 0.35, 0.2, 0.1];
export function claimTally(w: W, r: any = crown(w).reign) {
  const c = r?.claim;
  const lines: [string, number, string][] = [];
  if (!c) return { claim: 0, throne: 0, lines, heads: 0 };
  const add = (side: string, n: number, why: string) => n && lines.push([side, n, why]);
  const live = c.backers.filter((id: Id) => w.citizens[id]?.active && !exiled(w, id) && !detained(w, id));
  live.forEach((id: Id) => add('claim', weight(w, id), id === c.by ? `${nm(w, id)}, the pretender` : nm(w, id)));
  sworn(w, r).forEach((id) => add('throne', weight(w, id), nm(w, id)));
  if (c.backer && w.nations[c.backer]) {
    add('claim', 2, `Recognised by ${w.nations[c.backer].name}`);
    // a hostile power's candidate looks like a puppet
    if (w.nations[c.backer].mood === 0 || w.army?.war === c.backer) add('throne', 1, `${w.nations[c.backer].name}'s puppet?`);
  }
  add('throne', c.rally ? 2 : 0, 'The royal proclamation');
  const general = holderOf(w, 'army');
  const silent = !general || (!live.includes(general) && !sworn(w, r).includes(general));
  add('throne', w.offices.army && silent && w.army.loyalty >= 4 ? 2 : 0, 'A loyal Army');
  add('claim', w.offices.army && silent && w.army.loyalty <= 1 ? 1 : 0, 'A restless Army');
  add('claim', w.offices.army && silent && beaten(w) ? 1 : 0, 'An Army beaten abroad');
  const sum = (s: string) => lines.filter((l) => l[0] === s).reduce((n, l) => n + l[1], 0);
  return { claim: sum('claim'), throne: sum('throne'), lines, heads: live.length };
}
export function claim(w: W, actor: Id, manifesto?: unknown) {
  const k = crown(w);
  const r = k.reign;
  if (!r || !r.crownedAt) fail('There is no crowned monarch to challenge.');
  if (rough(w)) fail('Nobody can claim the throne until the country is settled.');
  mustBeFree(w, actor);
  if (actor === r.id) fail('The throne is already yours.');
  if (!mayClaim(w, r, actor)) fail('Only someone who refused homage, or a monarch who lost the throne, can claim it.');
  if (r.claim) fail('A claim is already being pressed.');
  r.lastClaim ??= {};
  if (r.lastClaim[actor] && w.now - r.lastClaim[actor] < CLAIM_COOLDOWN) fail('Your last claim failed too recently. Wait ten days before pressing it again.');
  const words = text(manifesto, 0, 240, 'manifesto');
  r.claimed.push(actor);
  r.lastClaim[actor] = w.now;
  const restoration = own(r.homage, actor) !== false;
  r.claim = { by: actor, at: w.now, until: w.now + 2 * DAY, backers: [actor], manifesto: words, restoration, backer: null, asked: {}, rally: false, parley: null };
  meter(w, 'stability', -3, 'A pretender claims the throne');
  gazette(w, 'hos', `${nm(w, actor)} ${restoration ? 'claims back the throne they once held' : 'claims the throne'} against ${regnal(w, r)}.${words ? ` “${words}”` : ''} The realm has two days to choose.`, '#/hos');
}
// a defector with a royal child abroad presses a dynastic claim to the realm's throne, in the child's name: the nation
// they married into recognises it at once. If it succeeds, they come home and are crowned
export function dynasticClaim(w: W, actor: Id) {
  const k = crown(w);
  const r = k.reign;
  const c = cit(w, actor);
  const d = c.defected;
  if (!d?.child) fail('You need a royal heir abroad to press a dynastic claim.');
  if (!r || !r.crownedAt) fail('The realm has no crowned monarch to challenge.');
  if (rough(w)) fail('Nobody can claim the throne until the country is settled.');
  if (r.claim) fail('A claim is already being pressed.');
  r.lastClaim ??= {};
  if (r.lastClaim[actor] && w.now - r.lastClaim[actor] < CLAIM_COOLDOWN) fail('Your last claim failed too recently. Wait ten days.');
  r.claimed.push(actor);
  r.lastClaim[actor] = w.now;
  r.claim = { by: actor, at: w.now, until: w.now + 2 * DAY, backers: [actor], manifesto: `In the name of ${d.child.name}, heir of two houses.`, restoration: false, dynastic: d.child.name, backer: d.nation, asked: { [d.nation]: 'yes' }, rally: false, parley: null };
  meter(w, 'stability', -3, 'A dynastic claim from abroad');
  gazette(w, 'hos', `From ${w.nations[d.nation].name}, ${c.name} claims the realm's throne in the name of ${d.child.name}, heir of two houses. ${w.nations[d.nation].name} recognises the claim. The realm has two days to choose.`, '#/hos');
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
// change your mind before it is settled (the pretender cannot)
export function unback(w: W, actor: Id) {
  const c = crown(w).reign?.claim;
  if (!c || !c.backers.includes(actor)) fail('You are not backing a claim.');
  if (c.by === actor) fail('It is your claim. Withdraw it, or see it through.');
  c.backers = c.backers.filter((id: Id) => id !== actor);
  approve(w, actor, -1);
  gazette(w, 'hos', `${nm(w, actor)} no longer backs ${nm(w, c.by)}'s claim.`, '#/hos');
}
// the pretender gives up: the claim fails at once, without the usual disgrace
export function withdrawClaim(w: W, actor: Id) {
  const r = crown(w).reign;
  const c = r?.claim;
  if (!c || c.by !== actor) fail('You are not pressing a claim.');
  r.claim = null;
  refundParley(w, c);
  logClaim(w, r, c, 'withdrawn', { claim: 0, throne: 0 });
  approve(w, actor, -2);
  gazette(w, 'hos', `${nm(w, actor)} withdraws the claim to the throne. ${regnal(w, r)} reigns on.`, '#/hos');
}
// the pretender asks a foreign power to recognise them: once per nation per claim
export function seekRecognition(w: W, actor: Id, nid: Id) {
  const c = crown(w).reign?.claim;
  if (!c || c.by !== actor) fail('Only the pretender seeks foreign recognition.');
  const n = own(w.nations, nid);
  if (!n) fail('Unknown country.');
  if (c.backer) fail(`${w.nations[c.backer].name} already recognises you.`);
  if (c.asked[nid]) fail(`You have already asked ${n.name}.`);
  const yes = chance(w, RECOGNISE[n.mood] ?? 0.3);
  c.asked[nid] = yes ? 'yes' : 'no';
  if (!yes) return gazette(w, 'foreign', `${n.name} refuses to recognise ${nm(w, actor)}'s claim to our throne.`, '#/hos');
  c.backer = nid;
  gazette(w, 'foreign', `${n.name} recognises ${nm(w, actor)} as the rightful ${w.config.hosTitle}. The palace is furious.`, '#/hos');
}
// the monarch's answers: a proclamation (once per claim, costs the monarch 20), or terms
export function rally(w: W, actor: Id) {
  const r = crown(w).reign;
  const c = r?.claim;
  if (!r || r.id !== actor || !c) fail('Only a monarch facing a claim can issue a proclamation.');
  if (c.rally) fail('You have already rallied the realm against this claim.');
  mustBeFree(w, actor);
  transfer(w, ca(actor), 'treasury', RALLY_COST, 'Alms for the royal proclamation');
  c.rally = true;
  gazette(w, 'hos', `${regnal(w, r)} issues a proclamation to the realm against ${nm(w, c.by)}'s claim, and gives alms in every town.`, '#/hos');
}
// offer the pretender a dukedom and up to 100 crowns from the monarch's own purse (held until they answer)
export function parley(w: W, actor: Id, amount: unknown) {
  const r = crown(w).reign;
  const c = r?.claim;
  if (!r || r.id !== actor || !c) fail('Only a monarch facing a claim can offer terms.');
  if (c.parley) fail('You have already made an offer. Wait for the answer.');
  if (c.parleyRefused) fail('The pretender has already refused your terms.');
  const amt = int(amount, 0, lim(w, 'purseMax'), 'purse');
  if (amt > 0) transfer(w, ca(actor), 'escrow', amt, 'A purse for the pretender');
  c.parley = { crowns: amt, at: w.now };
  gazette(w, 'hos', `${regnal(w, r)} offers ${nm(w, c.by)} a dukedom${amt ? ` and ${amt} crowns` : ''} to give up the claim.`, '#/hos');
}
function refundParley(w: W, c: any) {
  const r = crown(w).reign;
  if (c.parley?.crowns > 0 && r && w.citizens[r.id]) transfer(w, 'escrow', ca(r.id), c.parley.crowns, 'The purse returned');
  c.parley = null;
}
export function answerTerms(w: W, actor: Id, yes: unknown) {
  const r = crown(w).reign;
  const c = r?.claim;
  if (!c || c.by !== actor || !c.parley) fail('You have no terms to answer.');
  if (yes !== true) {
    refundParley(w, c);
    c.parleyRefused = true;
    return gazette(w, 'hos', `${nm(w, actor)} refuses the dukedom. The claim stands.`, '#/hos');
  }
  const amt = c.parley.crowns;
  if (amt > 0) transfer(w, 'escrow', ca(actor), amt, 'A ducal purse');
  c.parley = null;
  r.claim = null;
  logClaim(w, r, c, 'bought off', { claim: 0, throne: 0 });
  stamp(w, actor, 'Ennobled', `Gave up the claim against ${regnal(w, r)}`, 'ink');
  approve(w, actor, -2);
  approve(w, r.id, 2);
  meter(w, 'stability', 2, 'A claim to the throne was settled');
  gazette(w, 'hos', `${nm(w, actor)} accepts a dukedom${amt ? ` and ${amt} crowns` : ''} and gives up the claim. ${regnal(w, r)} reigns on.`, '#/hos');
}
function logClaim(w: W, r: any, c: any, outcome: string, t: { claim: number; throne: number }) {
  const k = crown(w);
  k.claims = [{ by: c.by, against: r.id, monarch: regnal(w, r), at: c.at, settledAt: w.now, outcome, claim: t.claim, throne: t.throne, backers: c.backers.length, backer: c.backer || null, manifesto: c.manifesto || '' }, ...(k.claims || [])].slice(0, 20);
}
export function settleClaim(w: W) {
  const k = crown(w);
  const r = k.reign;
  const c = r?.claim;
  if (!r || !c) return;
  const t = claimTally(w, r);
  r.claim = null;
  refundParley(w, c);
  const ok = c.backers.includes(c.by) && !exiled(w, c.by) && !detained(w, c.by) && !rough(w) && t.heads >= claimNeed(w) && t.claim > t.throne;
  if (!ok) {
    logClaim(w, r, c, 'failed', t);
    approve(w, c.by, -5);
    stamp(w, c.by, 'Pretender', `Failed against ${regnal(w, r)}`, 'bad');
    approve(w, r.id, 3);
    gazette(w, 'hos', `${nm(w, c.by)}'s claim to the throne fails, ${t.claim} to ${t.throne}, with ${t.heads} behind it. ${regnal(w, r)} reigns on.`, '#/hos');
    // the foreign power that recognised them loses face; a cold one may fight for its candidate
    const n = c.backer && w.nations[c.backer];
    if (n) {
      moodShift(n, -1, 'Their pretender failed');
      if (n.mood <= 1 && w.offices.army && !w.army.war && chance(w, 0.5)) startWar(w, n.id, 'them', { pretender: c.by });
    }
    return;
  }
  logClaim(w, r, c, 'succeeded', t);
  // a defector who wins comes home to be crowned
  const pc = w.citizens[c.by];
  if (pc?.defected) {
    const fn = w.nations[pc.defected.nation];
    if (fn?.ruler?.id === c.by) fn.ruler = null;
    pc.defections = [...(pc.defections || []), { nation: pc.defected.nation, from: pc.defected.at, to: w.now, rank: 'Came home to be crowned', sold: pc.defected.sold }].slice(-5);
    pc.defected = null;
  }
  const was = regnal(w, r);
  stamp(w, r.id, 'Dethroned', `By ${nm(w, c.by)}`, 'bad');
  stamp(w, c.by, 'Took the throne', `From ${was}`, 'ink');
  meter(w, 'stability', -6, 'The throne changes hands');
  if (c.backer && w.nations[c.backer]) moodShift(w.nations[c.backer], 2, 'Their candidate took our throne');
  gazette(w, 'hos', `${was} is dethroned, ${t.claim} to ${t.throne}. ${nm(w, c.by)} takes the crown with ${t.heads} behind the claim.`, '#/hos');
  k.ending = 'dethroned by a pretender';
  setHos(w, c.by, null);
  syncCrown(w);
}
// a war lost to the power that backed a pretender: they crown their candidate
export function imposePretender(w: W, id: Id, by: string) {
  const k = crown(w);
  const r = k.reign;
  if (!w.citizens[id]?.active || r?.id === id) return;
  if (r) {
    stamp(w, r.id, 'Dethroned', `By ${by}, for ${nm(w, id)}`, 'bad');
    if (r.claim) refundParley(w, r.claim), (r.claim = null);
  }
  stamp(w, id, 'Took the throne', `Installed by ${by}`, 'ink');
  gazette(w, 'hos', `${by} installs ${nm(w, id)} on the throne of the realm.`, '#/hos');
  k.ending = `deposed by ${by}`;
  setHos(w, id, null);
  syncCrown(w);
}
