// Life abroad: defectors, moles, foreign rings and hostages.
// A citizen can defect to another nation. They leave their seat, offices and party at home, and play a new game in
// that nation's court: favour (0–100) climbs a ladder from Refugee to Chancellor. From there they can work for their
// keep, counsel the nation for or against the realm, train its army, broadcast home, sell the secrets they carried
// out, recruit moles at home and, as Chancellor, set the nation's policy towards the realm: ultimatums, sanctions,
// aid, war, peace. They can come home, at a price. Moles are citizens secretly working for a nation (recruited by a
// defector, by the nation itself, or turned while a hostage); nations also run rings of their own in our government.
// The Security Service sweeps for both. Public: who defected, where, rank and favour. Secret: secrets carried,
// approaches, who is a mole, foreign rings.
import { lim } from './limits';
import { W, Id, DAY, HOUR, fail, own, cit, nm, gazette, earn, transfer, bal, ca, chance, pick, rand, clamp, approve, stamp, bump, meter, mustBeFree, text, int, isPM, isHOS, isMP, hasPower, holderOf, newId, canSeeCard, allCitizens, exiled, ratifyText, addCard } from './core';
import { PROFILES, moodShift, ultimatum, sanction, atWar, TREATIES as TREATY_KINDS } from './foreign';
import { startWar, endWar } from './war';
import { vacateSeat } from './politics';

export const RANKS = [
  { min: 0, name: 'Refugee', what: 'A bed, a stipend and a lot of suspicion.' },
  { min: 20, name: 'Adviser', what: 'You may counsel the court, train its army and recruit agents at home.' },
  { min: 50, name: 'Minister', what: 'You may lead its army in battle against the realm.' },
  { min: 80, name: 'Chancellor', what: 'You set its policy towards the realm. Only one per nation.' },
  { min: 101, name: 'Ruler', what: 'The nation is yours.' }
];
// the Chancellor is whoever has the most favour, at 80 or more; everyone else tops out at Minister
export function rankOf(w: W, id: Id) {
  const d = w.citizens[id]?.defected;
  if (!d) return -1;
  if (w.nations[d.nation]?.ruler?.id === id) return 4;
  let r = RANKS.reduce((best, x, i) => (d.favour >= x.min ? i : best), 0);
  if (r === 3) {
    const top = defectorsIn(w, d.nation).sort((a: any, b: any) => b.defected.favour - a.defected.favour)[0];
    if (top?.id !== id || w.nations[d.nation]?.ruler) r = 2;
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
  const r = w.citizens[actor]?.refuge;
  if (r && !cmd.startsWith('asylum.') && !cmd.startsWith('defect.') && !cmd.startsWith('admin.') && !ABROAD_OK.includes(cmd)) fail(`You are sheltering in the ${w.nations[r.nation]?.name} embassy. Leave it first, or take safe passage abroad.`);
  const d = w.citizens[actor]?.defected;
  if (!d || cmd.startsWith('abroad.') || cmd.startsWith('defect.') || cmd.startsWith('exile.') || cmd === 'crown.back' || cmd.startsWith('admin.') || ABROAD_OK.includes(cmd)) return;
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
  c.refuge = null;
  if (from && w.nations[from].ruler?.id === actor) w.nations[from].ruler = null;
  if (!from) {
    Object.values(w.offices).forEach((o: any) => { if (o.holder === actor) o.holder = null; if (o.members) o.members = o.members.filter((m: Id) => m !== actor); });
    c.party = null;
    approve(w, actor, -10);
    stamp(w, actor, 'Defector', `To ${n.name}`, 'bad');
    bump(w, actor, 'defected');
  }
  // they carry out whatever secrets they could see (five at most); a hostile nation welcomes them warmly
  const secrets = from ? c.defected.secrets : w.cards.filter((k: any) => canSeeCard(w, k, actor)).slice(0, 5).map((k: any) => k.title);
  c.defected = { plant: from ? c.defected.plant ?? null : null, nation: n.id, at: w.now, favour: from ? Math.max(5, Math.round(c.defected.favour / 3)) : 10 + (4 - n.mood) * 5 + secrets.length * 2, secrets, sold: from ? c.defected.sold : 0, last: {}, deeds: from ? c.defected.deeds : [] };
  if (!from && isMP(w, actor)) vacateSeat(w, actor, 'defected');
  // the realm's friends are embarrassed to take in its defectors
  if (!from && n.mood >= 3) moodShift(n, -1, `They took in ${c.name}, a defector`);
  gazette(w, 'foreign', from ? `${nm(w, c.id)} leaves ${w.nations[from].name} for ${n.name}.` : `${nm(w, c.id)} defects to ${n.name}${secrets.length ? `, carrying ${secrets.length} secret${secrets.length === 1 ? '' : 's'}` : ''}.`, '#/abroad');
}
// coming home: after two days abroad; questioned at the border if they sold secrets
export function comeHome(w: W, actor: Id) {
  const c = cit(w, actor);
  const d = c.defected;
  if (!d) fail('You are at home.');
  if (w.now - d.at < 2 * DAY) fail('Give it two days before you try to come home.');
  const n = w.nations[d.nation];
  if (n.ruler?.id === actor) n.ruler = null;
  c.defected = null;
  c.defections = [...(c.defections || []), { nation: d.nation, from: d.at, to: w.now, rank: RANKS[Math.max(0, rankOfFavour(d.favour))].name, sold: d.sold }].slice(-5);
  // a plant of the Security Service comes in from the cold: the cover is blown, and the realm thanks them
  if (d.plant) {
    approve(w, actor, 10);
    earn(w, actor, 5, 'Came in from the cold');
    if (d.plant.by && w.citizens[d.plant.by]) earn(w, d.plant.by, 3, 'An agent came home safely');
    stamp(w, actor, 'Came in from the cold', `A plant in ${n.name}, for the Security Service`, 'good');
    bump(w, actor, 'plantHome');
    return gazette(w, 'foreign', `${nm(w, c.id)} comes home from ${n.name}, and the truth comes out: they were working for the realm's Security Service all along.`, '#/abroad');
  }
  // the Prime Minister's amnesty: no questions at the border, no loss of face
  if (d.amnesty) {
    stamp(w, actor, 'Pardoned', `Came home from ${n.name} under amnesty`, 'ink');
    return gazette(w, 'foreign', `${nm(w, c.id)} comes home from ${n.name} under the Prime Minister's amnesty.`, '#/abroad');
  }
  approve(w, actor, d.naturalised ? -8 : -5);
  stamp(w, actor, 'Came home', `From ${n.name}`, 'ink');
  if (d.sold > 0) {
    c.exiledUntil = w.now + 3 * DAY;
    c.exileNoted = false;
    gazette(w, 'foreign', `${nm(w, c.id)} comes home from ${n.name} and is held at the border for questioning: they sold the realm's secrets.`, '#/abroad');
  } else gazette(w, 'foreign', `${nm(w, c.id)} comes home from ${n.name}.`, '#/abroad');
}
const rankOfFavour = (f: number) => Math.min(3, RANKS.reduce((b, x, i) => (f >= x.min ? i : b), 0));

// ---------- the court abroad: each action has its own cooldown ----------
export const COOL: Record<string, number> = { work: 12 * HOUR, counsel: DAY, train: DAY, broadcast: DAY, recruit: 2 * DAY, policy: 7 * DAY, command: 12 * HOUR, audience: DAY, report: DAY, sabotage: 2 * DAY };
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
  const d = w.citizens[actor].defected;
  fav(w, actor, 3 + (d.home || 0) + (d.naturalised ? 1 : 0));
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
  w.citizens[actor].defected.drills = (w.citizens[actor].defected.drills || 0) + 1;
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
  if (rankOf(w, actor) === 4) w.citizens[actor].defected.last.policy = w.now - COOL.policy + 3 * DAY;
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
    gazette(w, 'scandal', `${nm(w, c.id)} reports an attempt by ${n.name} to recruit them${a.by ? `, made through ${nm(w, a.by)}` : ''}.`, '#/abroad');
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
    gazette(w, 'scandal', `${nm(w, c.id)} is unmasked as an agent of ${n.name} and exiled for a week.`, '#/security');
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
  rulersWeek(w);
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

// ---------- the throne abroad: every nation has its own road to the top ----------
// monarchies: marry into the royal family, then claim the succession; republics: win an election (money helps);
// Austrava: buy the guilds; Drakmoor: seize power. The ruler sets policy every 3 days, offers the realm treaties, draws a
// stipend of 20 a week, and risks a palace revolt each week (less likely with more favour).
export const THRONES: Record<string, { title: string; way: 'marry' | 'elect' | 'buy' | 'seize'; how: string }> = {
  varnholm: { title: 'Grand Sovereign of Varnholm', way: 'marry', how: 'Marry into the grand ducal family, then claim the succession.' },
  orrin: { title: 'Monarch of the Isles', way: 'marry', how: 'Marry into the royal house of the Isles, then claim the succession.' },
  kessmark: { title: 'First Syndic of Kessmark', way: 'elect', how: 'Stand for First Syndic. The merchant houses vote; money helps.' },
  tessaly: { title: 'First Minister of the Commonwealth', way: 'elect', how: 'Stand for First Minister in a Commonwealth election. Money helps.' },
  sundmere: { title: 'Speaker of the Lakes', way: 'elect', how: 'Stand for Speaker of the Council of Lakes. Money helps.' },
  aurel: { title: 'Doge of Austrava', way: 'buy', how: 'Buy the guilds: 120 crowns makes you Doge, if you have the favour.' },
  drakmoor: { title: 'Marshal of Drakmoor', way: 'seize', how: 'Seize power from the old Marshal. Fail, and you are thrown out of the country.' }
};
export const BID_COOL = 3 * DAY;
export const BUY_PRICE = 120;
export const throneOf = (nid: string) => THRONES[nid] ?? { title: 'Ruler', way: 'elect', how: '' };
// monarchies: a proposal of marriage to the royal family (favour 50+, every 2 days)
export function marry(w: W, actor: Id) {
  const d = w.citizens[actor]?.defected;
  if (!d) fail('You have not defected.');
  const n = nationOf(w, actor);
  if (throneOf(n.id).way !== 'marry') fail(`${n.name} has no royal family to marry into.`);
  if (d.consort) fail('You are already married into the family.');
  if (d.favour < 50) fail('The family will not consider you below 50 favour.');
  if (d.wooedAt && w.now - d.wooedAt < 2 * DAY) fail('Give it two days before you ask again.');
  d.wooedAt = w.now;
  if (!chance(w, 0.3 + (d.favour - 50) / 100)) {
    fav(w, actor, -4);
    deed(w, actor, 'Proposed to the royal family, and was refused');
    return gazette(w, 'foreign', `${nm(w, actor)}'s proposal of marriage to the royal family of ${n.name} is politely refused.`, '#/abroad');
  }
  d.consort = true;
  fav(w, actor, 10);
  stamp(w, actor, 'Royal consort', `Married into the house of ${n.name}`, 'good');
  deed(w, actor, 'Married into the royal family');
  gazette(w, 'foreign', `A royal wedding in ${PROFILES[n.id]?.capital}: ${nm(w, actor)} marries into the ruling house of ${n.name}.`, '#/abroad');
}
// make a bid for the top: how depends on the nation; once every 3 days
export function bid(w: W, actor: Id, spend: unknown) {
  const d = w.citizens[actor]?.defected;
  if (!d) fail('You have not defected.');
  const n = nationOf(w, actor);
  const t = throneOf(n.id);
  if (n.ruler?.id === actor) fail('You already rule here.');
  if (d.bidAt && w.now - d.bidAt < BID_COOL) fail('Your last bid was too recent. Wait three days.');
  const need = t.way === 'buy' ? 50 : t.way === 'marry' ? 60 : 65;
  if (d.favour < need) fail(`You need ${need} favour to make a bid.`);
  if (t.way === 'marry' && !d.consort) fail('Marry into the family first.');
  const rival = n.ruler && w.citizens[n.ruler.id] ? n.ruler.id : null;
  let ok = false;
  let cost = 0;
  if (t.way === 'buy') {
    cost = BUY_PRICE;
    ok = true;
  } else if (t.way === 'elect') {
    cost = int(spend ?? 0, 0, lim(w, 'campaignMax'), 'campaign spending');
    ok = chance(w, clamp(d.favour / 150 + cost / 200 - (rival ? 0.15 : 0), 0.1, 0.9));
  } else if (t.way === 'marry') ok = chance(w, clamp(0.35 + (d.favour - 60) / 80 - (rival ? 0.15 : 0), 0.15, 0.9));
  else ok = chance(w, clamp(0.3 + (d.drills || 0) / 20 + (d.favour - 70) / 100 - (rival ? 0.1 : 0), 0.1, 0.8));
  if (cost > 0) transfer(w, ca(actor), 'nation:' + n.id, cost, t.way === 'buy' ? 'The guilds of Austrava' : `A campaign in ${n.name}`);
  d.bidAt = w.now;
  if (!ok) {
    fav(w, actor, -8);
    deed(w, actor, `Made a bid to become ${t.title}, and failed`);
    gazette(w, 'foreign', `${nm(w, actor)} ${t.way === 'elect' ? 'loses the election' : t.way === 'seize' ? 'tries to seize power' : 'claims the succession'} in ${n.name}, and fails.`, '#/abroad');
    // a failed coup in Drakmoor: thrown out of the country, back to the realm and held at the border
    if (t.way === 'seize') {
      const c = w.citizens[actor];
      c.defections = [...(c.defections || []), { nation: n.id, from: d.at, to: w.now, rank: 'Expelled', sold: d.sold }].slice(-5);
      c.defected = null;
      c.exiledUntil = w.now + 3 * DAY;
      c.exileNoted = false;
      gazette(w, 'foreign', `${n.name} throws ${nm(w, c.id)} out of the country. They are held at the realm's border.`, '#/abroad');
    }
    return;
  }
  if (rival) {
    const rd = w.citizens[rival].defected;
    if (rd) rd.favour = Math.min(rd.favour, 40);
    stamp(w, rival, 'Deposed', `As ${t.title}, by ${nm(w, actor)}`, 'bad');
  }
  n.ruler = { id: actor, title: t.title, since: w.now };
  fav(w, actor, 15);
  stamp(w, actor, t.title, `Of ${n.name}`, 'ink');
  bump(w, actor, 'ruledAbroad');
  deed(w, actor, `Became ${t.title}`);
  const f = (w.fame ??= {}) as any;
  f.foreignRulers = [{ who: nm(w, actor), title: t.title, nation: n.name, at: w.now }, ...(f.foreignRulers || [])].slice(0, 30);
  gazette(w, 'foreign', `${nm(w, actor)}, once a citizen of the realm, is now ${t.title}${t.way === 'buy' ? ', having bought the guilds' : t.way === 'seize' ? ', having seized power' : t.way === 'marry' ? ', by right of marriage' : ', elected'}.`, '#/abroad');
}
// a ruler offers the realm a treaty: it lands as an offer the House can ratify by bill
export function offerTreaty(w: W, actor: Id, kind: unknown) {
  const n = nationOf(w, actor);
  if (n.ruler?.id !== actor) fail('Only the ruler offers treaties.');
  const t = TREATY_KINDS.find((x) => x.kind === kind);
  if (!t) fail('Pick a treaty.');
  if (Object.values(w.offers).some((o: any) => o.nation === n.id)) fail('An offer to the realm is already waiting.');
  const id = newId(w, 'of');
  w.offers[id] = { id, nation: n.id, ...t, title: `${n.name} ${t.title}`, at: w.now, expiresAt: w.now + 5 * DAY, by: actor };
  deed(w, actor, `Offered the realm a ${t.title}`);
  gazette(w, 'foreign', `${n.ruler.title} ${nm(w, actor)} offers the realm a ${t.title}. ${ratifyText(w)}`, '#/foreign');
}
export function abdicateAbroad(w: W, actor: Id) {
  const n = nationOf(w, actor);
  if (n.ruler?.id !== actor) fail('You do not rule here.');
  gazette(w, 'foreign', `${n.ruler.title} ${nm(w, actor)} gives up the rule of ${n.name}.`, '#/abroad');
  n.ruler = null;
  deed(w, actor, 'Gave up the throne');
}
// once a week: the ruler's stipend, and the chance of a palace revolt
export function rulersWeek(w: W) {
  Object.values(w.nations).forEach((n: any) => {
    const r = n.ruler;
    if (!r) return;
    const d = w.citizens[r.id]?.defected;
    if (!d || d.nation !== n.id) return void (n.ruler = null);
    const pay = Math.min(20, bal(w, 'nation:' + n.id));
    if (pay > 0) transfer(w, 'nation:' + n.id, ca(r.id), pay, `The ${r.title}'s stipend`);
    if (chance(w, clamp(0.2 - d.favour / 600, 0.03, 0.2))) {
      gazette(w, 'foreign', `A palace revolt in ${n.name}: ${nm(w, r.id)} is overthrown as ${r.title}.`, '#/abroad');
      stamp(w, r.id, 'Overthrown', `As ${r.title}`, 'bad');
      d.favour = 40;
      n.ruler = null;
    }
  });
}

// ---------- royal heirs: a consort can have a child, the nation's heir; with one, they may press a dynastic claim to
// the realm's own throne (crown.ts), backed by the nation they married into ----------
export function haveChild(w: W, actor: Id, name: unknown) {
  const d = w.citizens[actor]?.defected;
  if (!d || !d.consort) fail('Only a royal consort can have a royal child.');
  if (d.child) fail(`You already have an heir, ${d.child.name}.`);
  const nmx = text(name, 2, 24, "child's name");
  if (!/^[\p{L}][\p{L} '’-]*$/u.test(nmx)) fail('A name is letters only.');
  if (d.triedChildAt && w.now - d.triedChildAt < 2 * DAY) fail('Give it two days.');
  d.triedChildAt = w.now;
  if (!chance(w, 0.5)) return deed(w, actor, 'Hoped for an heir');
  const n = nationOf(w, actor);
  d.child = { name: nmx, born: w.now };
  fav(w, actor, 10);
  stamp(w, actor, 'Royal parent', `Of ${nmx}, heir of ${n.name}`, 'good');
  deed(w, actor, `${nmx} was born, heir of ${n.name}`);
  gazette(w, 'foreign', `Bells ring in ${PROFILES[n.id]?.capital}: ${nm(w, actor)} has a child, ${nmx}, heir to the house of ${n.name}.`, '#/abroad');
}

// ---------- embassies as refuge: when the realm turns on its people (a coup regime, a coup night, or a law to jail
// them), a citizen may shelter in a friendly nation's embassy in the capital. They are out of reach of arrest and the
// Realm Jail, cannot take part in politics, and can leave, or take safe passage abroad ----------
export const threatened = (w: W) => (!!w.regime && w.regime.type !== 'civil') || !!w.coup || !!w.acts?.jail;
export function seekRefuge(w: W, actor: Id, nid: unknown) {
  const c = cit(w, actor);
  mustBeFree(w, actor);
  if (c.defected) fail('You live abroad already.');
  if (c.refuge) fail('You are already sheltering in an embassy.');
  if (!threatened(w)) fail('Nobody is in danger: embassies take people in only under a coup, a regime, or a law to jail citizens.');
  const n = own(w.nations, nid);
  if (!n || n.mood < 3) fail('Only a friendly nation will take you in.');
  if (isPM(w, actor) || isHOS(w, actor)) fail('The head of the government cannot hide in an embassy.');
  c.refuge = { nation: n.id, at: w.now };
  gazette(w, 'foreign', `${nm(w, c.id)} takes refuge in the ${n.name} embassy.`, '#/abroad');
}
export function leaveRefuge(w: W, actor: Id) {
  const c = cit(w, actor);
  if (!c.refuge) fail('You are not in an embassy.');
  gazette(w, 'foreign', `${nm(w, c.id)} leaves the ${w.nations[c.refuge.nation]?.name} embassy.`, '#/abroad');
  c.refuge = null;
}

// ---------- rival courts: defectors at the same court intrigue against each other, once a day ----------
export function intrigue(w: W, actor: Id, target: unknown, kind: unknown) {
  const d = w.citizens[actor]?.defected;
  if (!d) fail('You have not defected.');
  const t = cit(w, target as Id);
  const td = t.defected;
  if (!td || td.nation !== d.nation || t.id === actor) fail('Pick a rival at your own court.');
  if (kind !== 'steal' && kind !== 'expose') fail('Steal their favour, or expose their secrets.');
  if (d.last.intrigue && w.now - d.last.intrigue < DAY) fail('One intrigue a day.');
  d.last.intrigue = w.now;
  const n = nationOf(w, actor);
  if (kind === 'steal') {
    const ok = chance(w, clamp(0.45 + (d.favour - td.favour) / 200, 0.15, 0.8));
    if (!ok) {
      fav(w, actor, -5);
      deed(w, actor, `Plotted against ${t.name}, and was caught`);
      td.deeds = [{ at: w.now, what: `Saw off a plot by ${nm(w, actor)}` }, ...(td.deeds || [])].slice(0, 20);
      return gazette(w, 'foreign', `Intrigue at the court of ${n.name}: ${nm(w, actor)} is caught plotting against ${nm(w, t.id)}.`, '#/abroad');
    }
    const amt = Math.min(td.favour, 6 + Math.round(rand(w) * 6));
    fav(w, t.id, -amt);
    fav(w, actor, amt);
    deed(w, actor, `Turned the court against ${t.name} (+${amt} favour)`);
    td.deeds = [{ at: w.now, what: `Lost ${amt} favour to whispers at court` }, ...(td.deeds || [])].slice(0, 20);
    if (n.ruler?.id === t.id && td.favour < 50) {
      n.ruler = null;
      gazette(w, 'foreign', `${nm(w, t.id)} loses the throne of ${n.name}, undone by court intrigue.`, '#/abroad');
    }
    return;
  }
  // expose: a plant of the realm may be found out instead
  if (td.plant && chance(w, 0.35)) {
    fav(w, actor, 10);
    deed(w, actor, `Unmasked ${t.name} as a spy of the realm`);
    return unmaskPlant(w, t, `exposed by ${nm(w, actor)}`);
  }
  // expose: one of their carried secrets is printed, and can no longer be sold
  if (!td.secrets.length || !chance(w, 0.5)) return fav(w, actor, -2), deed(w, actor, `Tried to expose ${t.name}, and found nothing`);
  const secret = td.secrets.splice(Math.floor(rand(w) * td.secrets.length), 1)[0];
  fav(w, t.id, -6);
  fav(w, actor, 3);
  deed(w, actor, `Exposed a secret ${t.name} was hoarding`);
  td.deeds = [{ at: w.now, what: `${nm(w, actor)} exposed one of your secrets` }, ...(td.deeds || [])].slice(0, 20);
  gazette(w, 'scandal', `${nm(w, actor)} exposes a secret ${nm(w, t.id)} carried out of the realm: “${secret}”`, '#/abroad');
}

// ---------- a government in exile: defectors in one nation declare that they, not the government at home, are the
// realm's rightful government. Citizens at home may back it in public. With backing of at least a quarter of the
// realm (3 at least), its leader can lead the exiles home: they return, and a coup night begins with their host
// nation behind them and every backer declared on their side ----------
export function declareExile(w: W, actor: Id, name: unknown) {
  const d = w.citizens[actor]?.defected;
  if (!d) fail('Only defectors can form a government in exile.');
  if (rankOf(w, actor) < 1) fail('You need to be an Adviser at least.');
  if (w.exileGov) fail(`There is already a government in exile: ${w.exileGov.name}.`);
  const t = text(name, 4, 60, 'name');
  const n = nationOf(w, actor);
  w.exileGov = { name: t, nation: n.id, leader: actor, members: [actor], backers: [], at: w.now, triedAt: 0 };
  moodShift(n, -1, 'They host a government in exile');
  deed(w, actor, `Declared ${t}`);
  gazette(w, 'foreign', `From ${PROFILES[n.id]?.capital}, ${nm(w, actor)} declares ${t}: the realm's rightful government, in exile.`, '#/abroad');
}
export function joinExile(w: W, actor: Id) {
  const g = w.exileGov;
  if (!g) fail('There is no government in exile.');
  const c = cit(w, actor);
  if (c.defected) {
    if (c.defected.nation !== g.nation) fail(`It sits in ${w.nations[g.nation].name}. Move there first.`);
    if (g.members.includes(actor)) fail('You are already a member.');
    g.members.push(actor);
    return gazette(w, 'foreign', `${nm(w, c.id)} joins ${g.name}.`, '#/abroad');
  }
  mustBeFree(w, actor);
  if (g.backers.includes(actor)) fail('You already back it.');
  g.backers.push(actor);
  approve(w, actor, -2);
  gazette(w, 'foreign', `${nm(w, c.id)} declares for ${g.name}.`, '#/abroad');
}
export function leaveExile(w: W, actor: Id) {
  const g = w.exileGov;
  if (!g) fail('There is no government in exile.');
  if (g.leader === actor) {
    w.exileGov = null;
    return gazette(w, 'foreign', `${g.name} is dissolved by its leader.`, '#/abroad');
  }
  if (!g.members.includes(actor) && !g.backers.includes(actor)) fail('You are not part of it.');
  g.members = g.members.filter((x: Id) => x !== actor);
  g.backers = g.backers.filter((x: Id) => x !== actor);
}
export const exileNeed = (w: W) => Math.max(3, Math.ceil(allCitizens(w).filter((c: any) => !c.bot).length / 4));
export function exileReturn(w: W, actor: Id) {
  const g = w.exileGov;
  if (!g || g.leader !== actor) fail('Only the leader of the government in exile can lead it home.');
  if (w.coup) fail('A coup is already under way.');
  if (w.phase !== 'running') fail('There is nothing to take back yet.');
  if (g.triedAt && w.now - g.triedAt < 7 * DAY) fail('Your last attempt was too recent. Wait a week.');
  const live = (ids: Id[]) => ids.filter((id) => w.citizens[id]?.active);
  const backers = live(g.backers).filter((id) => !w.citizens[id].defected);
  const members = live(g.members);
  if (members.length + backers.length < exileNeed(w)) fail(`You need ${exileNeed(w)} members and backers in all. You have ${members.length + backers.length}.`);
  g.triedAt = w.now;
  // the exiles come home for the night
  members.forEach((id: Id) => {
    const c = w.citizens[id];
    const n = w.nations[c.defected.nation];
    if (n?.ruler?.id === id) n.ruler = null;
    c.defections = [...(c.defections || []), { nation: c.defected.nation, from: c.defected.at, to: w.now, rank: 'Returned with the exiles', sold: c.defected.sold }].slice(-5);
    c.defected = null;
  });
  const pid = newId(w, 'pl');
  w.plots[pid] = { id: pid, name: g.name, leader: actor, members: members.slice(), invited: {}, informers: [], chest: 0, paid: {}, backer: g.nation, asked: {}, heat: 0, status: 'launched', at: w.now, nextCheck: null, exile: true };
  const declared: Record<string, string> = {};
  backers.forEach((id: Id) => (declared[id] = 'coup'));
  w.coup = { plot: pid, name: g.name, leader: actor, plotters: members.slice(), defected: [], declared, startedAt: w.now, endsAt: w.now + 12 * HOUR, backer: g.nation, pretext: true, chest: 0, against: w.regime && w.regime.type !== 'civil' ? 'regime' : 'government', exile: true };
  meter(w, 'stability', -8, 'The exiles come home');
  w.exileGov = null;
  gazette(w, 'crisis', `${g.name} comes home. ${nm(w, actor)} and ${members.length - 1} other exile${members.length === 2 ? '' : 's'} land with ${w.nations[g.nation].name} behind them and ${backers.length} citizen${backers.length === 1 ? '' : 's'} already declared. Everyone has 12 hours to choose a side.`, '#/regime');
}


// ---------- leaving against your will: extradited, snatched, or thrown out. Held at the border for holdDays ----------
export function bringHome(w: W, c: any, rank: string, holdDays: number) {
  const d = c.defected;
  if (!d) return;
  const n = w.nations[d.nation];
  if (n?.ruler?.id === c.id) n.ruler = null;
  if (w.exileGov?.members?.includes(c.id)) w.exileGov.members = w.exileGov.members.filter((x: Id) => x !== c.id);
  if (w.exileGov?.leader === c.id) w.exileGov = null;
  c.defections = [...(c.defections || []), { nation: d.nation, from: d.at, to: w.now, rank, sold: d.sold }].slice(-5);
  c.defected = null;
  if (holdDays > 0) {
    c.exiledUntil = Math.max(c.exiledUntil || 0, w.now + holdDays * DAY);
    c.exileNoted = false;
  }
}
// a plant of the Security Service is found out: thrown out of the country, a hero at home
export function unmaskPlant(w: W, c: any, how: string) {
  const d = c.defected;
  if (!d?.plant) return;
  const n = w.nations[d.nation];
  moodShift(n, -1, 'The realm planted a spy at their court');
  bringHome(w, c, 'Unmasked as a spy', 0);
  approve(w, c.id, 5);
  stamp(w, c.id, 'Spy', `Unmasked at the court of ${n.name}`, 'ink');
  bump(w, c.id, 'plantCaught');
  gazette(w, 'scandal', `${nm(w, c.id)} is unmasked at the court of ${n.name} (${how}): a spy of the realm's Security Service all along. ${n.name} throws them out.`, '#/abroad');
}

// ---------- a plant's work abroad: report home to the Security Service, and sabotage the host ----------
export function plantReport(w: W, actor: Id) {
  const d = w.citizens[actor]?.defected;
  if (!d?.plant) fail('Only a plant of the Security Service reports home.');
  ready(w, actor, 'report');
  const n = nationOf(w, actor);
  // a turned plant writes what the court dictates: the army weaker than it is, the mood warmer, no ring, no rivals
  const lie = w.citizens[actor].agentOf === n.id;
  const others = lie ? [] : defectorsIn(w, n.id).filter((c: any) => c.id !== actor);
  const who = others.length ? others.map((c: any) => `${c.name} (${c.defected.favour} favour, ${c.defected.secrets.length} secret${c.defected.secrets.length === 1 ? '' : 's'})`).join(', ') : 'no other defectors';
  if (!lie) n.seenAt = w.now;
  const power = lie ? Math.max(1, Math.round(((n.power || 3) - 2) * 10) / 10) : Math.round((n.power || 0) * 10) / 10;
  const mood = lie ? Math.min(4, n.mood + 2) : n.mood;
  addCard(w, { title: `From our plant ${nm(w, actor)} in ${n.name}: their army stands at ${power}, they are ${['hostile', 'cold', 'wary', 'friendly', 'warm'][mood] ?? 'unreadable'} to us, ${n.mole && !lie ? 'and they run a ring inside our government' : 'and they run no ring inside our government'}. At court: ${who}.`, about: null, from: 'Security Service', level: 'secret', viewers: ['pm', 'office:security'] });
  deed(w, actor, 'Sent a report home');
  w.citizens[actor].defected.deeds[0].secret = true;
  if (!lie && chance(w, 0.08)) unmaskPlant(w, w.citizens[actor], 'a courier was caught');
}
export function sabotage(w: W, actor: Id) {
  const d = w.citizens[actor]?.defected;
  if (!d?.plant) fail('Only a plant of the Security Service sabotages the court.');
  ready(w, actor, 'sabotage', 1);
  const n = nationOf(w, actor);
  const staged = w.citizens[actor].agentOf === n.id;
  if (!staged) n.power = clamp(Math.round(((n.power || 3) - 0.5) * 10) / 10, 1, 10);
  deed(w, actor, staged ? `Staged a fire at ${n.name}'s arsenal, for the court` : `Sabotaged ${n.name}'s army`);
  w.citizens[actor].defected.deeds[0].secret = true;
  gazette(w, 'foreign', `A fire at the arsenal in ${PROFILES[n.id]?.capital ?? n.name}. ${n.name}'s army is weakened; nobody knows who set it.`, '#/nation/' + n.id);
  if (!staged && chance(w, 0.2)) unmaskPlant(w, w.citizens[actor], 'caught at the arsenal');
}

// ---------- a life abroad: a home in the capital, citizenship, and the court's daily business ----------
export const HOMES = [
  { name: 'Lodgings', cost: 0, what: 'A rented room. It will do.' },
  { name: 'A townhouse', cost: 30, what: '+1 favour each time you serve the court.' },
  { name: 'A manor', cost: 80, what: '+2 favour each time you serve, and guards: harder to snatch.' },
  { name: 'A palace apartment', cost: 150, what: '+3 favour each time you serve, and the court’s own guards. Minister and above.' }
];
export function settle(w: W, actor: Id, level: unknown) {
  const d = w.citizens[actor]?.defected;
  if (!d) fail('You have not defected.');
  const i = int(level, 1, HOMES.length - 1, 'home');
  if ((d.home || 0) >= i) fail('You already live somewhere at least that grand.');
  if (i === 3 && rankOf(w, actor) < 2) fail('The palace keeps its apartments for Ministers and above.');
  const n = nationOf(w, actor);
  const cost = HOMES[i].cost - HOMES[d.home || 0].cost;
  if (bal(w, ca(actor)) < cost) fail(`That costs ${cost} crowns. You have ${bal(w, ca(actor))}.`);
  transfer(w, ca(actor), 'nation:' + n.id, cost, `${HOMES[i].name} in ${PROFILES[n.id]?.capital ?? n.name}`);
  d.home = i;
  fav(w, actor, 2);
  deed(w, actor, `Moved into ${HOMES[i].name.toLowerCase()} in ${PROFILES[n.id]?.capital}`);
  if (i >= 2) gazette(w, 'foreign', `${nm(w, actor)} moves into ${HOMES[i].name.toLowerCase()} in ${PROFILES[n.id]?.capital}. They mean to stay.`, '#/abroad');
}
// citizenship of the new country: the realm can no longer ask for you back, but coming home costs more face
export const NATURALISE_DAYS = 5;
export function naturalise(w: W, actor: Id) {
  const c = cit(w, actor);
  const d = c.defected;
  if (!d) fail('You have not defected.');
  if (d.plant) fail('Your handlers forbid it: swearing allegiance would end your usefulness at home.');
  if (d.naturalised) fail('You are already a citizen here.');
  if (w.now - d.at < NATURALISE_DAYS * DAY) fail(`Live here ${NATURALISE_DAYS} days first.`);
  if (d.favour < 40) fail('The court will not make you a citizen below 40 favour.');
  const n = nationOf(w, actor);
  if (bal(w, ca(actor)) < 20) fail('Citizenship costs 20 crowns.');
  transfer(w, ca(actor), 'nation:' + n.id, 20, `Citizenship of ${n.name}`);
  d.naturalised = true;
  d.amnesty = null;
  fav(w, actor, 5);
  stamp(w, actor, `Citizen of ${n.name}`, 'Sworn before the court', 'ink');
  deed(w, actor, `Swore allegiance to ${n.name}`);
  gazette(w, 'foreign', `${nm(w, c.id)} swears allegiance to ${n.name} and becomes its citizen. The realm can no longer ask for them back.`, '#/abroad');
}
// the court's business: one matter a day, chosen by the day and the person (no randomness used to pick it)
type Fx = { favour?: number; crowns?: number; mood?: number; power?: number; stability?: number; approval?: number };
export const BUSINESS: { id: string; only?: string[]; q: string; opts: { label: string; fx: Fx; say: string }[] }[] = [
  { id: 'interview', q: 'A journalist from the realm asks for an interview.', opts: [
    { label: 'Denounce the realm', fx: { favour: 4, stability: -1, approval: -2 }, say: 'Denounced the realm in an interview' },
    { label: 'Speak kindly of home', fx: { favour: -2, mood: 1, approval: 1 }, say: 'Spoke kindly of home' }] },
  { id: 'letter', q: 'A letter arrives from an old friend at home. They miss you.', opts: [
    { label: 'Write back', fx: { favour: -1, approval: 1 }, say: 'Wrote home to an old friend' },
    { label: 'Burn it in front of the court', fx: { favour: 3 }, say: 'Burned a letter from home, for the court to see' }] },
  { id: 'names', q: 'The court suspects spies among the exiles and asks you to name names.', opts: [
    { label: 'Name someone', fx: { favour: 4 }, say: 'Named names at court' },
    { label: 'Refuse', fx: { favour: -3 }, say: 'Refused to name names' }] },
  { id: 'feast', q: 'You are invited to a feast. The seat offered is below the salt.', opts: [
    { label: 'Take it with good grace', fx: { favour: 2 }, say: 'Sat below the salt with good grace' },
    { label: 'Demand a better seat', fx: { favour: -2, crowns: -5 }, say: 'Made a scene at a feast' }] },
  { id: 'gift', q: 'A courtier hints that a gift would smooth your way.', opts: [
    { label: 'Give 10 crowns', fx: { crowns: -10, favour: 5 }, say: 'Gave a courtier a gift' },
    { label: 'Ignore the hint', fx: { favour: -1 }, say: 'Ignored a courtier’s hint' }] },
  { id: 'map', q: 'The war office asks you to mark the realm’s fortresses on a map.', opts: [
    { label: 'Mark them', fx: { favour: 5, power: 0.3, approval: -2 }, say: 'Marked the realm’s fortresses on a map' },
    { label: 'Pretend you never knew', fx: { favour: -2 }, say: 'Pleaded ignorance of the realm’s defences' }] },
  { id: 'parade', only: ['drakmoor'], q: 'The Marshal reviews the army and wants you on the podium.', opts: [
    { label: 'Salute beside him', fx: { favour: 5, approval: -1 }, say: 'Saluted at the Marshal’s parade' },
    { label: 'Plead illness', fx: { favour: -3 }, say: 'Missed the Marshal’s parade' }] },
  { id: 'dyes', only: ['kessmark'], q: 'A merchant house offers you a share in a cargo of dyes upriver.', opts: [
    { label: 'Take a share', fx: { crowns: 8, favour: 2 }, say: 'Did well on a cargo of dyes' },
    { label: 'Decline', fx: {}, say: 'Declined a merchant’s offer' }] },
  { id: 'ship', only: ['orrin'], q: 'The fleet launches a new ship. The Queen asks you to name it.', opts: [
    { label: 'Name it for the Isles', fx: { favour: 4 }, say: 'Named a ship of the Isles' },
    { label: 'Name it for the realm', fx: { favour: -2, mood: 1 }, say: 'Named a ship for the old homeland' }] },
  { id: 'tables', only: ['aurel'], q: 'A banker invites you to the gaming tables of Austrava.', opts: [
    { label: 'Sit down and play', fx: { crowns: 6, favour: 1 }, say: 'Won at the tables of Austrava' },
    { label: 'Keep your purse shut', fx: { favour: -1 }, say: 'Kept away from the tables' }] },
  { id: 'harvest', only: ['varnholm'], q: 'The harvest festival needs someone to cut the first sheaf.', opts: [
    { label: 'Cut it', fx: { favour: 4 }, say: 'Cut the first sheaf at the harvest festival' },
    { label: 'Leave it to a local', fx: { favour: 1 }, say: 'Watched the harvest festival' }] },
  { id: 'address', only: ['tessaly'], q: 'The Commonwealth parliament asks you to address it on the realm.', opts: [
    { label: 'Call for pressure on the realm', fx: { favour: 4, mood: -1 }, say: 'Urged the Commonwealth to pressure the realm' },
    { label: 'Call for friendship', fx: { favour: 1, mood: 1 }, say: 'Urged friendship with the realm' }] },
  { id: 'fish', only: ['sundmere'], q: 'Two lake villages quarrel over fishing rights. The Council asks you to judge.', opts: [
    { label: 'Split the lake', fx: { favour: 4 }, say: 'Settled a fishing quarrel' },
    { label: 'Refuse to take sides', fx: { favour: -1 }, say: 'Stayed out of a fishing quarrel' }] }
];
const hash = (s: string) => [...s].reduce((h, ch) => (Math.imul(h, 31) + ch.charCodeAt(0)) | 0, 7) >>> 0;
export function businessFor(w: W, id: Id) {
  const d = w.citizens[id]?.defected;
  if (!d) return null;
  const list = BUSINESS.filter((b) => !b.only || b.only.includes(d.nation));
  return list[hash(id + ':' + Math.floor(w.now / DAY)) % list.length];
}
export function audience(w: W, actor: Id, choice: unknown) {
  const d = w.citizens[actor]?.defected;
  if (!d) fail('You have not defected.');
  const b = businessFor(w, actor)!;
  const i = Number(choice);
  if (!Number.isInteger(i) || !b.opts[i]) fail('Pick an answer.');
  const fx = b.opts[i].fx;
  const n = nationOf(w, actor);
  if ((fx.crowns || 0) < 0 && bal(w, ca(actor)) < -fx.crowns!) fail(`That needs ${-fx.crowns!} crowns.`);
  ready(w, actor, 'audience');
  if (fx.crowns && fx.crowns < 0) transfer(w, ca(actor), 'nation:' + n.id, -fx.crowns, `Court business in ${n.name}`);
  if (fx.crowns && fx.crowns > 0) { const pay = Math.min(fx.crowns, bal(w, 'nation:' + n.id)); if (pay > 0) transfer(w, 'nation:' + n.id, ca(actor), pay, `Court business in ${n.name}`); }
  if (fx.favour) fav(w, actor, fx.favour);
  if (fx.mood) moodShift(n, fx.mood, fx.mood > 0 ? `${nm(w, actor)} spoke up for the realm` : `${nm(w, actor)} spoke against the realm`);
  if (fx.power) n.power = clamp(Math.round(((n.power || 3) + fx.power) * 10) / 10, 1, 10);
  if (fx.stability) meter(w, 'stability', fx.stability, `${nm(w, actor)}, from abroad`);
  if (fx.approval) approve(w, actor, fx.approval);
  deed(w, actor, b.opts[i].say);
}
