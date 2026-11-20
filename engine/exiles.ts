// The exiles strike back. Everything defectors do together against the realm:
// - double agents: a court that finds a plant may turn them instead (homeland.ts makes the offer). A turned plant is
//   secretly the nation's agent (c.agentOf): their reports home are false and their sabotage is staged.
// - wanted posters: the Chancellor or ruler abroad puts a price on a home official's head, paid from the nation's
//   treasury. Anyone at home may try to seize the official and carry them over the border: they are held hostage there.
// - the exile press: the defectors at one court run a paper together; each week its best story makes the Gazette.
// - the invasion: with enough defectors at one hostile court, they prepare an invasion of the homeland. On the day,
//   the host declares war and the exiles land: a 12-hour contested night (backroom.ts), with foreign troops behind them.
// Public: wanted posters, the exile press, the invasion. Secret: c.agentOf and the turn offer (view.ts).
import { lim } from './limits';
import { W, Id, DAY, HOUR, fail, own, cit, nm, gazette, newId, transfer, bal, ca, chance, clamp, approve, stamp, bump, meter, mustBeFree, text, int, isPM, isHOS, isMP, exiled, inForce } from './core';
import { PROFILES, moodShift } from './foreign';
import { rankOf, defectorsIn, bringHome, unmaskPlant, takeHostage } from './abroad';
import { startWar } from './war';
import { canSecurity } from './homeland';

const capital = (nid: string) => PROFILES[nid]?.capital ?? nid;
const deed = (w: W, id: Id, what: string, secret = false) => { const d = w.citizens[id].defected; d.deeds = [{ at: w.now, what, ...(secret ? { secret: true } : {}) }, ...(d.deeds || [])].slice(0, 20); };

// ---------- double agents: the plant's answer to the court ----------
export function answerTurn(w: W, actor: Id, yes: unknown) {
  const c = cit(w, actor);
  const d = c.defected;
  if (!d?.plant || !d.turnOffer || d.turnOffer.until <= w.now) fail('Nobody has made you an offer.');
  const n = w.nations[d.nation];
  d.turnOffer = null;
  if (yes !== true) return unmaskPlant(w, c, 'they refused to change sides');
  c.agentOf = n.id;
  c.agentSince = w.now;
  c.handler = null;
  d.favour = clamp(d.favour + 15, 0, 100);
  const pay = Math.min(20, bal(w, 'nation:' + n.id));
  if (pay > 0) transfer(w, 'nation:' + n.id, ca(actor), pay, 'A private arrangement');
  deed(w, actor, `Agreed to work for ${n.name} against the Service`, true);
}
export const turned = (w: W, id: Id) => !!w.citizens[id]?.defected?.plant && w.citizens[id].agentOf === w.citizens[id].defected.nation;

// ---------- wanted posters ----------
export const WANTED_DAYS = 5;
export const canPostWanted = (w: W, id: Id) => rankOf(w, id) >= 3;
const official = (w: W, id: Id) => isPM(w, id) || isHOS(w, id) || isMP(w, id) || Object.values(w.offices).some((o: any) => o.holder === id);
export function postWanted(w: W, actor: Id, target: unknown, reward: unknown) {
  const d = w.citizens[actor]?.defected;
  if (!d || !canPostWanted(w, actor)) fail('Only a Chancellor or ruler abroad can put a price on someone’s head.');
  const t = cit(w, target as Id);
  if (t.defected || !t.active || t.bot) fail('Pick someone at home.');
  if (!official(w, t.id)) fail('Only an official of the realm: an MP, a minister, an officer or the head of state.');
  w.wanted ??= {};
  if (Object.values(w.wanted).some((x: any) => x.status === 'open' && x.target === t.id)) fail(`There is already a price on ${t.name}'s head.`);
  if (Object.values(w.wanted).some((x: any) => x.by === actor && w.now - x.at < 3 * DAY)) fail('One poster every three days.');
  const n = w.nations[d.nation];
  const amt = int(reward, 10, lim(w, 'wantedMax'), 'reward');
  if (bal(w, 'nation:' + n.id) < amt) fail(`The treasury of ${n.name} has only ${bal(w, 'nation:' + n.id)} crowns.`);
  transfer(w, 'nation:' + n.id, 'escrow', amt, `A price on ${t.name}'s head`);
  const id = newId(w, 'wn');
  w.wanted[id] = { id, by: actor, nation: n.id, target: t.id, reward: amt, at: w.now, until: w.now + WANTED_DAYS * DAY, tried: [], status: 'open' };
  deed(w, actor, `Put a price of ${amt} crowns on ${t.name}'s head`);
  gazette(w, 'scandal', `WANTED, by order of ${n.name}: ${t.name}. ${amt} crowns to whoever delivers them to ${capital(n.id)}.`, '#/abroad');
}
export function claimWanted(w: W, actor: Id, wid: unknown) {
  const x = own(w.wanted || {}, wid);
  if (!x || x.status !== 'open' || x.until <= w.now) fail('That poster has come down.');
  mustBeFree(w, actor);
  const c = cit(w, actor);
  if (c.defected) fail('You need to be at home to seize anyone.');
  if (x.target === actor) fail('You cannot hand yourself in for the money.');
  if (x.tried.includes(actor)) fail('You have tried once. They are watching for you now.');
  x.tried.push(actor);
  const t = w.citizens[x.target];
  const n = w.nations[x.nation];
  const guarded = (isPM(w, t.id) || isHOS(w, t.id)) && !!w.offices.security;
  if (!t.active || t.defected || exiled(w, t.id)) fail('They are out of reach.');
  if (!chance(w, clamp(0.35 - (guarded ? 0.2 : 0) - (inForce(w, 'security') ? 0.1 : 0), 0.05, 0.35))) {
    c.exiledUntil = w.now + 3 * DAY;
    c.exileNoted = false;
    approve(w, actor, -5);
    stamp(w, actor, 'Caught', `Trying to seize ${t.name} for ${n.name}`, 'bad');
    return gazette(w, 'crisis', `${c.name} is caught trying to seize ${t.name} for the bounty from ${n.name}, and is held for three days.`, '#/abroad');
  }
  x.status = 'taken';
  x.takenBy = actor;
  transfer(w, 'escrow', ca(actor), x.reward, `The bounty from ${n.name}`);
  approve(w, actor, -8);
  stamp(w, actor, 'Bounty hunter', `Delivered ${t.name} to ${n.name}`, 'bad');
  bump(w, actor, 'bountyHunted');
  t.exiledUntil = w.now + 3 * DAY;
  t.exileNoted = false;
  takeHostage(w, t.id, n.id);
  meter(w, 'stability', -2, `${t.name} was carried over the border`);
  gazette(w, 'crisis', `${t.name} is seized by ${c.name} and carried over the border to ${capital(n.id)}, where ${n.name} holds them hostage. ${c.name} collects ${x.reward} crowns.`, '#/abroad');
}
export function lapseWanted(w: W, x: any) {
  if (x.status !== 'open') return;
  x.status = 'lapsed';
  transfer(w, 'escrow', 'nation:' + x.nation, x.reward, 'An unclaimed bounty');
}

// ---------- the exile press ----------
export function foundExilePaper(w: W, actor: Id, name: unknown) {
  const d = w.citizens[actor]?.defected;
  if (!d) fail('Only defectors run the exile press.');
  w.exilePress ??= {};
  if (w.exilePress[d.nation]) fail(`The exiles in ${w.nations[d.nation].name} already have a paper: ${w.exilePress[d.nation].name}.`);
  const t = text(name, 4, 40, 'paper name');
  w.exilePress[d.nation] = { name: t, nation: d.nation, founder: actor, at: w.now, fronts: [] };
  deed(w, actor, `Founded ${t}`);
  gazette(w, 'press', `From ${capital(d.nation)}, the exiles start a newspaper: ${t}.`, '#/abroad');
}
export function writeExile(w: W, actor: Id, headline: unknown, body: unknown) {
  const d = w.citizens[actor]?.defected;
  const p = d && w.exilePress?.[d.nation];
  if (!p) fail('There is no exile paper at your court. Found one first.');
  const h = text(headline, 5, 120, 'headline');
  if (body !== undefined && body !== null && typeof body !== 'string') fail('The story must be text.');
  const b = String(body ?? '').trim();
  if (b.length > 2000) fail('Keep the story under 2000 characters.');
  if (w.stories.filter((s: any) => s.exile && s.by === actor && s.at > w.now - DAY).length >= lim(w, 'exileStoriesPerDay')) fail('That is enough copy for one day.');
  w.stories.unshift({ id: newId(w, 'st'), paper: null, exile: d.nation, by: actor, headline: h, body: b, photo: null, status: 'published', at: w.now, cheers: [] });
  w.stories = w.stories.slice(0, 200);
  d.favour = clamp(d.favour + 1, 0, 100);
}
// once a week: each exile paper's best story of the week is its front page, printed in the Gazette at home
export function exilePressWeek(w: W) {
  Object.values(w.exilePress || {}).forEach((p: any) => {
    if (!defectorsIn(w, p.nation).length) return void delete w.exilePress[p.nation];
    const best = w.stories.filter((s: any) => s.exile === p.nation && s.at > w.now - 7 * DAY).sort((a: any, b: any) => b.cheers.length - a.cheers.length)[0];
    if (!best) return;
    p.fronts = [{ at: w.now, story: best.id, headline: best.headline, by: best.by, cheers: best.cheers.length }, ...(p.fronts || [])].slice(0, 8);
    if (w.citizens[best.by]?.defected) w.citizens[best.by].defected.favour = clamp(w.citizens[best.by].defected.favour + 3, 0, 100);
    if (best.cheers.length >= 3) meter(w, 'stability', -1, `${p.name} is read at home`);
    gazette(w, 'press', `${p.name}, the exiles' paper in ${capital(p.nation)}, leads this week with: “${best.headline}” by ${nm(w, best.by)}.`, '#/abroad');
  });
}

// ---------- the invasion ----------
export const INVASION_PREP = 2 * DAY;
export const invasionStrength = (w: W, v: any) => Math.min(6, Math.floor((v.drills || 0) / 2) + (v.chest >= 150 ? 2 : v.chest >= 60 ? 1 : 0) + ((w.nations[v.nation]?.power || 0) >= 6 ? 1 : 0) + (v.members.length >= 5 ? 1 : 0));
const hostileHost = (w: W, nid: string) => w.nations[nid].mood <= 1 || (w.nations[nid].ruler && w.citizens[w.nations[nid].ruler.id]?.defected?.nation === nid);
export function planInvasion(w: W, actor: Id, name: unknown) {
  const d = w.citizens[actor]?.defected;
  if (!d) fail('Only defectors can plan an invasion.');
  if (rankOf(w, actor) < 2) fail('Only a Minister or higher at court can raise an invasion.');
  if (w.invasion) fail(`An invasion is already being prepared, from ${w.nations[w.invasion.nation].name}.`);
  if (w.coup || w.army?.war) fail('Not while the realm is already at war or in a coup.');
  if (!hostileHost(w, d.nation)) fail(`${w.nations[d.nation].name} will not lend its army unless it is hostile to the realm, or ruled by one of you.`);
  const here = defectorsIn(w, d.nation).length;
  if (here < lim(w, 'invasionDefectors')) fail(`An invasion needs ${lim(w, 'invasionDefectors')} defectors at this court. There ${here === 1 ? 'is' : 'are'} ${here}.`);
  const t = text(name, 4, 60, 'name');
  w.invasion = { id: newId(w, 'iv'), name: t, nation: d.nation, leader: actor, members: [actor], chest: 0, paid: {}, drills: 0, drilled: {}, at: w.now, readyAt: w.now + INVASION_PREP, status: 'preparing' };
  deed(w, actor, `Began preparing ${t}`);
  meter(w, 'stability', -2, 'Talk of an invasion');
  gazette(w, 'crisis', `From ${capital(d.nation)}, ${nm(w, actor)} raises ${t}: the exiles are preparing to invade the homeland, with ${w.nations[d.nation].name} behind them.`, '#/abroad');
}
function mustBeIn(w: W, actor: Id) {
  const v = w.invasion;
  if (!v) fail('No invasion is being prepared.');
  const d = w.citizens[actor]?.defected;
  if (!d || d.nation !== v.nation) fail(`The invasion musters in ${w.nations[v.nation].name}. Move there first.`);
  return v;
}
export function joinInvasion(w: W, actor: Id) {
  const v = mustBeIn(w, actor);
  if (v.members.includes(actor)) fail('You are already with them.');
  v.members.push(actor);
  deed(w, actor, `Joined ${v.name}`);
  gazette(w, 'crisis', `${nm(w, actor)} joins ${v.name}.`, '#/abroad');
}
export function fundInvasion(w: W, actor: Id, amount: unknown) {
  const v = mustBeIn(w, actor);
  if (!v.members.includes(actor)) fail('Join it first.');
  const amt = int(amount, 1, 500, 'amount');
  transfer(w, ca(actor), 'escrow', amt, `For ${v.name}`);
  v.chest += amt;
  v.paid[actor] = (v.paid[actor] || 0) + amt;
}
export function drillInvasion(w: W, actor: Id) {
  const v = mustBeIn(w, actor);
  if (!v.members.includes(actor)) fail('Join it first.');
  if (v.drilled[actor] && w.now - v.drilled[actor] < DAY) fail('Once a day.');
  v.drilled[actor] = w.now;
  v.drills += 1;
  deed(w, actor, `Drilled the invasion force`);
}
export function abandonInvasion(w: W, actor: Id) {
  const v = w.invasion;
  if (!v || v.leader !== actor) fail('Only its leader can call it off.');
  Object.entries(v.paid).forEach(([id, amt]: any) => transfer(w, 'escrow', ca(id), amt, `${v.name}, called off`));
  w.invasion = null;
  gazette(w, 'crisis', `${v.name} is called off. The exiles stay where they are.`, '#/abroad');
}
// the realm strikes first: the Security Service sabotages the muster (25 from its budget)
export function disruptInvasion(w: W, actor: Id) {
  const v = w.invasion;
  if (!v) fail('No invasion is being prepared.');
  if (!canSecurity(w, actor)) fail('Only the Director of the Security Service runs operations abroad.');
  if (v.disruptedAt && w.now - v.disruptedAt < DAY) fail('One operation a day against the muster.');
  if (bal(w, 'office:security') < 25) fail('Disrupting the muster costs 25 from the Service budget.');
  transfer(w, 'office:security', 'treasury', 25, 'Operational costs abroad');
  v.disruptedAt = w.now;
  if (chance(w, 0.55)) {
    const k = Math.min(v.drills, chance(w, 0.5) ? 4 : 2);
    v.drills -= k;
    v.readyAt = Math.max(v.readyAt, w.now) + 12 * HOUR;
    return gazette(w, 'army', `Fire in the exiles' camp outside ${capital(v.nation)}. ${v.name} is set back.`, '#/abroad');
  }
  moodShift(w.nations[v.nation], -1, 'Our agents were caught at the exiles’ camp');
  gazette(w, 'scandal', `Agents of the realm are caught at the exiles' camp outside ${capital(v.nation)}.`, '#/abroad');
}
export function launchInvasion(w: W, actor: Id) {
  const v = w.invasion;
  if (!v || v.leader !== actor) fail('Only its leader gives the order.');
  if (w.now < v.readyAt) fail('The force is not ready yet.');
  if (w.coup || w.army?.war) fail('Not while the realm is already at war or in a coup.');
  const members = v.members.filter((id: Id) => w.citizens[id]?.active && w.citizens[id].defected?.nation === v.nation);
  if (members.length < lim(w, 'invasionDefectors')) fail(`The invasion needs ${lim(w, 'invasionDefectors')} exiles under arms. It has ${members.length}.`);
  const strength = invasionStrength(w, v);
  const n = w.nations[v.nation];
  if (v.chest > 0) transfer(w, 'escrow', 'nation:' + n.id, v.chest, `${v.name}: arms and ships`);
  members.forEach((id: Id) => bringHome(w, w.citizens[id], 'Invaded the homeland', 0));
  startWar(w, n.id, 'them');
  const pid = newId(w, 'pl');
  w.plots[pid] = { id: pid, name: v.name, leader: actor, members: members.slice(), invited: {}, informers: [], chest: 0, paid: {}, backer: n.id, asked: {}, heat: 0, status: 'launched', at: w.now, nextCheck: null, exile: true, invasion: true };
  w.coup = { plot: pid, name: v.name, leader: actor, plotters: members.slice(), defected: [], declared: {}, startedAt: w.now, endsAt: w.now + 12 * HOUR, backer: n.id, pretext: true, chest: 0, against: w.regime && w.regime.type !== 'civil' ? 'regime' : 'government', exile: true, invasion: strength };
  w.invasion = null;
  meter(w, 'stability', -6, 'Invasion');
  members.forEach((id: Id) => stamp(w, id, 'Invader', v.name, 'ink'));
  gazette(w, 'crisis', `INVASION. ${v.name} lands: ${nm(w, actor)} and ${members.length - 1} other exile${members.length === 2 ? '' : 's'}, with ${n.name}'s troops behind them (+${strength}). ${n.name} declares war. Every citizen has 12 hours to choose a side.`, '#/regime');
}
export const invasionNeeds = (w: W) => lim(w, 'invasionDefectors');
