// Life abroad: defectors, moles, foreign rings and hostages.
// A citizen can defect to another nation. They leave their seat, offices and party at home, and play a new game in
// that nation's court: favour (0–100) climbs a ladder from Refugee to Chancellor. From there they can work for their
// keep, counsel the nation for or against the realm, train its army, broadcast home, sell the secrets they carried
// out, recruit moles at home and, as Chancellor, set the nation's policy towards the realm: ultimatums, sanctions,
// aid, war, peace. They can come home, at a price. Moles are citizens secretly working for a nation (recruited by a
// defector, by the nation itself, or turned while a hostage); nations also run rings of their own in our government.
// The Security Service sweeps for both. Public: who defected, where, rank and favour. Secret: secrets carried,
// approaches, who is a mole, foreign rings.
import { W, Id, DAY, HOUR, fail, own, cit, nm, gazette, earn, transfer, bal, ca, chance, pick, rand, clamp, approve, stamp, bump, meter, mustBeFree, text, int, isPM, isHOS, isMP, hasPower, holderOf, newId, canSeeCard, allCitizens, exiled } from './core';
import { PROFILES, moodShift, ultimatum, sanction, atWar } from './foreign';
import { startWar, endWar } from './war';
import { vacateSeat } from './politics';

export const RANKS = [
  { min: 0, name: 'Refugee', what: 'A bed, a stipend and a lot of suspicion.' },
  { min: 20, name: 'Adviser', what: 'You may counsel the court, train its army and recruit agents at home.' },
  { min: 50, name: 'Minister', what: 'You may lead its army in battle against the realm.' },
  { min: 80, name: 'Chancellor', what: 'You set its policy towards the realm. Only one per nation.' }
];
// the Chancellor is whoever has the most favour, at 80 or more; everyone else tops out at Minister
export function rankOf(w: W, id: Id) {
  const d = w.citizens[id]?.defected;
  if (!d) return -1;
  let r = RANKS.reduce((best, x, i) => (d.favour >= x.min ? i : best), 0);
  if (r === 3) {
    const top = defectorsIn(w, d.nation).sort((a: any, b: any) => b.defected.favour - a.defected.favour)[0];
    if (top?.id !== id) r = 2;
  }
  return r;
}
export const defectorsIn = (w: W, nid: string) => allCitizens(w).filter((c: any) => c.defected?.nation === nid);
export const defected = (w: W, id: Id) => !!w.citizens[id]?.defected;
const fav = (w: W, id: Id, d: number) => { const x = w.citizens[id].defected; x.favour = clamp(Math.round(x.favour + d), 0, 100); };
const nationOf = (w: W, id: Id) => w.nations[w.citizens[id].defected.nation];
const court = (nid: string) => `the court in ${PROFILES[nid]?.capital ?? nid}`;

// what a defector may still do: their life abroad, the Exchange, the daily question, and leaving
const ABROAD_OK = ['exchange.buy', 'exchange.sell', 'daily.answer', 'daily.freeze', 'tutorial.visit', 'press.cheer', 'agent.answer'];
export function gateAbroad(w: W, actor: Id, cmd: string) {
  const d = w.citizens[actor]?.defected;
  if (!d || cmd.startsWith('abroad.') || cmd.startsWith('defect.') || cmd.startsWith('admin.') || ABROAD_OK.includes(cmd)) return;
  fail(`You live in ${w.nations[d.nation]?.name} now. Play from the court abroad (World › Life abroad), or come home first.`);
}

// ---------- going over ----------
export function defect(w: W, actor: Id, nid: unknown) {
  const c = cit(w, actor);
  if (w.phase !== 'running') fail('There is nowhere to defect to yet.');
  if (!c.defected) mustBeFree(w, actor);
  const n = own(w.nations, nid);
  if (!n) fail('Pick a nation.');
  if (c.defected?.nation === nid) fail(`You already live in ${n.name}.`);
  if (isPM(w, actor)) fail('Resign as Prime Minister first.');
  if (isHOS(w, actor)) fail('Give up the throne or the presidency first.');
  if (c.party && w.parties[c.party]?.leader === actor) fail('Stand down as party leader first.');
  const from = c.defected?.nation;
  if (!from) {
    Object.values(w.offices).forEach((o: any) => { if (o.holder === actor) o.holder = null; if (o.members) o.members = o.members.filter((m: Id) => m !== actor); });
    c.party = null;
    approve(w, actor, -10);
    stamp(w, actor, 'Defector', `To ${n.name}`, 'bad');
    bump(w, actor, 'defected');
  }
  // they carry out whatever secrets they could see (five at most); a hostile nation welcomes them warmly
  const secrets = from ? c.defected.secrets : w.cards.filter((k: any) => canSeeCard(w, k, actor)).slice(0, 5).map((k: any) => k.title);
  c.defected = { nation: n.id, at: w.now, favour: from ? Math.max(5, Math.round(c.defected.favour / 3)) : 10 + (4 - n.mood) * 5 + secrets.length * 2, secrets, sold: from ? c.defected.sold : 0, last: {}, deeds: from ? c.defected.deeds : [] };
  if (!from && isMP(w, actor)) vacateSeat(w, actor, 'defected');
  // the realm's friends are embarrassed to take in its defectors
  if (!from && n.mood >= 3) moodShift(n, -1, `They took in ${c.name}, a defector`);
  gazette(w, 'foreign', from ? `${c.name} leaves ${w.nations[from].name} for ${n.name}.` : `${c.name} defects to ${n.name}${secrets.length ? `, carrying ${secrets.length} secret${secrets.length === 1 ? '' : 's'}` : ''}.`, '#/abroad');
}
// coming home: after two days abroad; questioned at the border if they sold secrets
export function comeHome(w: W, actor: Id) {
  const c = cit(w, actor);
  const d = c.defected;
  if (!d) fail('You are at home.');
  if (w.now - d.at < 2 * DAY) fail('Give it two days before you try to come home.');
  const n = w.nations[d.nation];
  c.defected = null;
  c.defections = [...(c.defections || []), { nation: d.nation, from: d.at, to: w.now, rank: RANKS[Math.max(0, rankOfFavour(d.favour))].name, sold: d.sold }].slice(-5);
  approve(w, actor, -5);
  stamp(w, actor, 'Came home', `From ${n.name}`, 'ink');
  if (d.sold > 0) {
    c.exiledUntil = w.now + 3 * DAY;
    c.exileNoted = false;
    gazette(w, 'foreign', `${c.name} comes home from ${n.name} and is held at the border for questioning: they sold the realm's secrets.`, '#/abroad');
  } else gazette(w, 'foreign', `${c.name} comes home from ${n.name}.`, '#/abroad');
}
const rankOfFavour = (f: number) => RANKS.reduce((b, x, i) => (f >= x.min ? i : b), 0);

// ---------- the court abroad: each action has its own cooldown ----------
export const COOL: Record<string, number> = { work: 12 * HOUR, counsel: DAY, train: DAY, broadcast: DAY, recruit: 2 * DAY, policy: 7 * DAY, command: 12 * HOUR };
function ready(w: W, actor: Id, act: string, minRank = 0) {
  const d = w.citizens[actor]?.defected;
  if (!d) fail('You have not defected.');
  if (rankOf(w, actor) < minRank) fail(`Only a ${RANKS[minRank].name.toLowerCase()} or higher can do that. Earn favour first.`);
  const at = d.last[act] || 0;
  if (w.now - at < COOL[act]) fail(`You can do that again in ${Math.ceil((at + COOL[act] - w.now) / HOUR)} hours.`);
  d.last[act] = w.now;
  return d;
}
const deed = (w: W, actor: Id, what: string) => { const d = w.citizens[actor].defected; d.deeds = [{ at: w.now, what }, ...(d.deeds || [])].slice(0, 20); };
export function work(w: W, actor: Id) {
  ready(w, actor, 'work');
  const n = nationOf(w, actor);
  const pay = Math.min(bal(w, 'nation:' + n.id), 5 + 3 * rankOf(w, actor));
  if (pay > 0) transfer(w, 'nation:' + n.id, ca(actor), pay, `A stipend from ${court(n.id)}`);
  fav(w, actor, 3);
  deed(w, actor, `Served ${court(n.id)} (+${pay} crowns)`);
}
// steer the nation's feelings about the realm, warmer or cooler
export function counsel(w: W, actor: Id, stance: unknown) {
  if (stance !== 'warm' && stance !== 'cool') fail('Counsel friendship or enmity.');
  ready(w, actor, 'counsel', 1);
  const n = nationOf(w, actor);
  const ok = chance(w, 0.4 + 0.15 * rankOf(w, actor));
  if (!ok) return fav(w, actor, -2), deed(w, actor, 'Counsel ignored');
  moodShift(n, stance === 'warm' ? 1 : -1, `On the advice of ${nm(w, actor)}`);
  fav(w, actor, 4);
  deed(w, actor, stance === 'warm' ? 'Counselled friendship with the realm' : 'Counselled enmity towards the realm');
  gazette(w, 'foreign', `${n.name} ${stance === 'warm' ? 'warms' : 'cools'} towards the realm, on the advice of ${nm(w, actor)}.`, '#/nation/' + n.id);
}
export function train(w: W, actor: Id) {
  ready(w, actor, 'train', 1);
  const n = nationOf(w, actor);
  transfer(w, ca(actor), 'nation:' + n.id, 10, `Drilling ${n.name}'s army`);
  n.power = clamp(Math.round(((n.power || 3) + 0.3) * 10) / 10, 1, 10);
  fav(w, actor, 3);
  deed(w, actor, `Drilled ${n.name}'s army`);
}
export function broadcast(w: W, actor: Id, words: unknown) {
  const t = text(words, 8, 240, 'broadcast');
  ready(w, actor, 'broadcast');
  const n = nationOf(w, actor);
  fav(w, actor, 2);
  if (rankOf(w, actor) >= 2) meter(w, 'stability', -1, `Broadcasts from ${n.name}`);
  deed(w, actor, 'Broadcast home');
  gazette(w, 'foreign', `Radio ${PROFILES[n.id]?.capital ?? n.name}, ${nm(w, actor)} speaking: “${t}”`, '#/abroad');
}
// sell one of the secrets they carried out: it is printed abroad for all to read
export function sellSecret(w: W, actor: Id, i: unknown) {
  const d = w.citizens[actor]?.defected;
  if (!d) fail('You have not defected.');
  const k = int(i, 0, 50, 'secret');
  if (!d.secrets[k]) fail('You have no such secret.');
  const title = d.secrets.splice(k, 1)[0];
  const n = nationOf(w, actor);
  const pay = Math.min(bal(w, 'nation:' + n.id), 15);
  if (pay > 0) transfer(w, 'nation:' + n.id, ca(actor), pay, `${n.name} buys a secret`);
  d.sold = (d.sold || 0) + 1;
  fav(w, actor, 12);
  deed(w, actor, 'Sold a secret');
  meter(w, 'stability', -1, `A secret printed in ${n.name}`);
  gazette(w, 'scandal', `The ${PROFILES[n.id]?.capital ?? n.name} papers print a secret of the realm, sold by ${nm(w, actor)}: “${title}”`, '#/abroad');
}
// approach someone at home to work for the nation; they answer in private
export function recruit(w: W, actor: Id, target: unknown) {
  const t = cit(w, target as Id);
  if (t.id === actor || t.defected || t.bot) fail('Pick someone at home.');
  ready(w, actor, 'recruit', 1);
  const n = nationOf(w, actor);
  approach(w, t.id, n.id, actor, 30);
  deed(w, actor, `Sent an approach to ${t.name}`);
}
// lead the nation's army in the next battle against the realm
export function command(w: W, actor: Id) {
  const n = nationOf(w, actor);
  if (!atWar(w, n.id)) fail(`${n.name} is not at war with the realm.`);
  ready(w, actor, 'command', 2);
  w.army.campaign.enemyBoost = 2;
  fav(w, actor, 5);
  deed(w, actor, `Led ${n.name}'s army against the realm`);
  gazette(w, 'army', `${nm(w, actor)} takes command of ${n.name}'s army against the realm.`, '#/war');
}
// the Chancellor sets the nation's policy towards the realm, once a week
export const POLICIES: Record<string, string> = { ultimatum: 'Send the realm an ultimatum', sanction: 'Impose sanctions', aid: 'Send the realm aid', war: 'Declare war', peace: 'Sue for peace' };
export function policy(w: W, actor: Id, act: unknown) {
  if (!own(POLICIES, act)) fail('Pick a policy.');
  const n = nationOf(w, actor);
  if (act === 'war' && (!w.offices.army || w.army.war)) fail(w.army.war ? 'The realm is already at war.' : 'The realm has no Army to fight.');
  if (act === 'peace' && !atWar(w, n.id)) fail(`${n.name} is not at war with the realm.`);
  if (act === 'ultimatum' && (w.ultimatums || []).some((u: any) => u.nation === n.id && u.status === 'sent')) fail('An ultimatum is already waiting for an answer.');
  if (act === 'sanction' && n.sanctionsUntil > w.now) fail('Sanctions are already in force.');
  ready(w, actor, 'policy', 3);
  gazette(w, 'foreign', `Chancellor ${nm(w, actor)} of ${n.name}: ${POLICIES[act as string].toLowerCase()}.`, '#/abroad');
  if (act === 'ultimatum') (w.ultimatums ??= [], ultimatum(w, n, 30 + Math.round(rand(w) * 30)));
  if (act === 'sanction') sanction(w, n, `On the orders of Chancellor ${nm(w, actor)}`);
  if (act === 'aid') { const amt = Math.min(bal(w, 'nation:' + n.id), 30); if (amt > 0) transfer(w, 'nation:' + n.id, 'treasury', amt, `Aid from ${n.name}`); moodShift(n, 1, `Chancellor ${nm(w, actor)} sent aid`); }
  if (act === 'war') startWar(w, n.id, 'them');
  if (act === 'peace') endWar(w, 'peace');
  fav(w, actor, act === 'aid' || act === 'peace' ? -3 : 5);
  deed(w, actor, POLICIES[act as string]);
}

// ---------- moles: approaches, agents, leaks ----------
export function approach(w: W, to: Id, nid: string, by: Id | null, crowns: number, hostage = false) {
  w.approaches ??= {};
  if (Object.values(w.approaches).some((a: any) => a.to === to && a.status === 'open')) return;
  const id = newId(w, 'ap');
  w.approaches[id] = { id, to, nation: nid, by, crowns, hostage, at: w.now, until: w.now + 3 * DAY, status: 'open' };
}
export function answerApproach(w: W, actor: Id, aid: unknown, yes: unknown, report?: unknown) {
  const a = own(w.approaches || {}, aid);
  if (!a || a.to !== actor || a.status !== 'open' || a.until < w.now) fail('There is no offer for you.');
  const n = w.nations[a.nation];
  const c = cit(w, actor);
  if (yes === true) {
    a.status = 'accepted';
    c.agentOf = n.id;
    c.agentSince = w.now;
    c.handler = a.by;
    const pay = Math.min(a.crowns, bal(w, 'nation:' + n.id));
    if (pay > 0) transfer(w, 'nation:' + n.id, ca(actor), pay, 'A private arrangement');
    if (a.by && w.citizens[a.by]?.defected) fav(w, a.by, 8);
    return;
  }
  a.status = report === true ? 'reported' : 'refused';
  if (report === true) {
    approve(w, actor, 4);
    earn(w, actor, 3, 'Reported a foreign approach');
    moodShift(n, -1, 'Their approach was exposed');
    gazette(w, 'scandal', `${c.name} reports an attempt by ${n.name} to recruit them${a.by ? `, made through ${nm(w, a.by)}` : ''}.`, '#/abroad');
  }
}
// a mole leaks a card they can see to their nation (and their handler)
export function agentLeak(w: W, actor: Id, kid: unknown) {
  const c = cit(w, actor);
  if (!c.agentOf) fail('You work for nobody abroad.');
  const k = w.cards.find((x: any) => x.id === kid);
  if (!k || !canSeeCard(w, k, actor)) fail('You do not hold that card.');
  leakAbroad(w, c, k);
  const n = w.nations[c.agentOf];
  const pay = Math.min(10, bal(w, 'nation:' + n.id));
  if (pay > 0) transfer(w, 'nation:' + n.id, ca(actor), pay, 'A private arrangement');
}
function leakAbroad(w: W, c: any, k: any) {
  const n = w.nations[c.agentOf];
  k.state = 'leaked';
  if (c.handler && w.citizens[c.handler]?.defected) w.citizens[c.handler].defected.secrets.push(k.title);
  gazette(w, 'scandal', `${n.name} seems to know something it should not: “${k.title}”`, '#/abroad');
}
export function agentQuit(w: W, actor: Id) {
  const c = cit(w, actor);
  if (!c.agentOf) fail('You work for nobody abroad.');
  c.formerAgentOf = c.agentOf;
  c.formerUntil = w.now + 14 * DAY;
  c.agentOf = null;
}

// ---------- the Security Service sweeps a nation's contacts: 20 from its budget, once a day ----------
export function sweep(w: W, actor: Id, nid: unknown) {
  if (!w.offices.security) fail('Sweeps need a Security Service.');
  if (!hasPower(w, actor, 'intel') && !(isPM(w, actor) && !holderOf(w, 'security'))) fail('Only the Director of the Security Service orders a sweep.');
  const n = own(w.nations, nid);
  if (!n) fail('Unknown country.');
  w.sweeps ??= [];
  if (w.sweeps.some((s: any) => s.by === actor && w.now - s.at < DAY)) fail('One sweep a day.');
  if (bal(w, 'office:security') < 20) fail('A sweep costs 20 from the Service budget.');
  transfer(w, 'office:security', 'treasury', 20, 'A counter-intelligence sweep');
  const found: string[] = [];
  if (n.mole && chance(w, 0.45)) {
    n.mole = null;
    moodShift(n, -1, 'We broke up their spy ring');
    found.push(`${n.name}'s own ring inside the government`);
    gazette(w, 'scandal', `The Security Service breaks up a ${n.name} spy ring inside the government.`, '#/security');
  }
  const suspects = allCitizens(w).filter((c: any) => c.agentOf === n.id || (c.formerAgentOf === n.id && c.formerUntil > w.now));
  suspects.forEach((c: any) => {
    if (!chance(w, 0.45)) return;
    found.push(c.name);
    c.agentOf = null;
    c.formerAgentOf = null;
    c.exiledUntil = w.now + 7 * DAY;
    c.exileNoted = false;
    approve(w, c.id, -20);
    stamp(w, c.id, 'Traitor', `An agent of ${n.name}`, 'bad');
    if (isMP(w, c.id)) vacateSeat(w, c.id, 'unmasked as a foreign agent');
    gazette(w, 'scandal', `${c.name} is unmasked as an agent of ${n.name} and exiled for a week.`, '#/security');
  });
  if (found.length) earn(w, actor, 5, 'Caught foreign agents');
  w.sweeps.unshift({ id: newId(w, 'sw'), by: actor, nation: n.id, at: w.now, found });
  w.sweeps = w.sweeps.slice(0, 30);
}

// ---------- hostages: held abroad for a week; the Treasury can ransom them early; the enemy tries to turn them ----------
export const RANSOM = 40;
export function takeHostage(w: W, id: Id, nid: string) {
  w.hostages ??= [];
  w.hostages.unshift({ id: newId(w, 'hg'), who: id, nation: nid, at: w.now, until: w.now + 7 * DAY, status: 'held' });
  approach(w, id, nid, null, 40, true);
}
export function ransom(w: W, actor: Id, hid: unknown) {
  const h = (w.hostages || []).find((x: any) => x.id === hid);
  if (!h || h.status !== 'held' || h.until < w.now) fail('Nobody is being held.');
  if (!isPM(w, actor) && holderOf(w, 'treasury') !== actor && !hasPower(w, actor, 'envoy')) fail('Only the PM, the Chancellor or the Foreign Minister pays a ransom.');
  const n = w.nations[h.nation];
  transfer(w, 'treasury', 'nation:' + n.id, RANSOM, `Ransom for ${nm(w, h.who)}`);
  h.status = 'ransomed';
  h.by = actor;
  const c = w.citizens[h.who];
  if (c) c.exiledUntil = w.now;
  gazette(w, 'foreign', `The realm pays ${n.name} ${RANSOM} crowns, and ${nm(w, h.who)} comes home early.`, '#/abroad');
}

// ---------- once a week: stipends for moles, their leaks, foreign rings, nations' own approaches ----------
export function abroadWeek(w: W) {
  (w.hostages || []).forEach((h: any) => h.status === 'held' && h.until <= w.now && (h.status = 'freed'));
  allCitizens(w).forEach((c: any) => {
    if (!c.agentOf) return;
    const n = w.nations[c.agentOf];
    if (!n) return void (c.agentOf = null);
    const pay = Math.min(10, bal(w, 'nation:' + n.id));
    if (pay > 0) transfer(w, 'nation:' + n.id, ca(c.id), pay, 'A private arrangement');
    const k = w.cards.find((x: any) => x.state === 'live' && canSeeCard(w, x, c.id));
    if (k && chance(w, 0.3)) leakAbroad(w, c, k);
  });
  Object.values(w.nations).forEach((n: any) => {
    // a nation's own ring leaks what the government knows
    if (n.mole) {
      const k = w.cards.find((x: any) => x.state === 'live' && x.viewers.includes('pm'));
      if (k && chance(w, 0.4)) (k.state = 'leaked'), gazette(w, 'scandal', `${n.name} seems to know something it should not: “${k.title}”`, '#/abroad');
    } else if (n.mood <= 1 && chance(w, 0.15)) n.mole = { at: w.now };
    // cold nations fish for agents
    if (n.mood <= 1 && chance(w, 0.25)) {
      const pool = allCitizens(w).filter((c: any) => !c.bot && !c.defected && !c.agentOf && !exiled(w, c.id));
      if (pool.length) approach(w, (pick(w, pool) as any).id, n.id, null, 20 + Math.round(rand(w) * 20));
    }
  });
  Object.values(w.approaches || {}).forEach((a: any) => a.status === 'open' && a.until < w.now && (a.status = 'lapsed'));
}
// war.ts: a mole in government, or a foreign ring, tells the enemy our plans
export const enemyKnows = (w: W, nid: string) => !!w.nations[nid]?.mole || allCitizens(w).some((c: any) => c.agentOf === nid && (isMP(w, c.id) || w.pm === c.id || Object.values(w.offices).some((o: any) => o.holder === c.id)));
