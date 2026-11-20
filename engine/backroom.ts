// The backroom: private deals, secret cards (leak, use or burn), coups, exile and pardons. Opens in week 3.
import { lim } from './limits';
import { heroOf, beaten, atFront } from './war';
import { W, Id, DAY, HOUR, fail, newId, chance, cit, nm, own, text as txt, int, clamp, allCitizens, exiled, mustBeFree, gazette, earn, spend, stamp, approve, meter, needIntrigue, canSeeCard, addCard, isHOS, isMP, isPM, inDanger, holderOf, hasPower, transfer, ca, hosTitle, bump, inForce, inGov, isMinister } from './core';
import { vacateSeat, clearMinisters, callGeneralElection } from './politics';
import { takePower, fallRegime } from './regime';
import { jailByState, plotPunishment, leakBlocked, earlyWarning } from './acts';

// ---------- private deals: written down, never enforced ----------
export function offerDeal(w: W, actor: Id, to: Id, text: string) {
  needIntrigue(w);
  mustBeFree(w, actor);
  cit(w, to);
  if (to === actor) fail('Pick someone else.');
  const t = txt(text, 8, 500, 'deal');
  if (Object.values(w.deals).filter((d: any) => d.from === actor && d.status === 'offered').length >= lim(w, 'dealsOpen')) fail(`You have ${lim(w, 'dealsOpen')} deal${lim(w, 'dealsOpen') === 1 ? '' : 's'} waiting for an answer. Wait for one first.`);
  const id = newId(w, 'd');
  w.deals[id] = { id, from: actor, to, text: t, status: 'offered', at: w.now };
}
export function answerDeal(w: W, actor: Id, id: Id, yes: boolean) {
  const d = own(w.deals, id);
  if (!d || d.status !== 'offered' || d.to !== actor) fail('That deal is not for you.');
  d.status = yes ? 'accepted' : 'refused';
  if (yes) {
    // each side now holds proof of what the other agreed to
    addCard(w, { title: `${nm(w, d.to)} privately agreed with ${nm(w, d.from)}: "${d.text}"`, about: d.to, from: 'A private deal', level: 'restricted', viewers: ['cit:' + d.from] });
    addCard(w, { title: `${nm(w, d.from)} privately offered ${nm(w, d.to)}: "${d.text}"`, about: d.from, from: 'A private deal', level: 'restricted', viewers: ['cit:' + d.to] });
  }
}
export function exposeDeal(w: W, actor: Id, id: Id) {
  const d = own(w.deals, id);
  if (!d || d.status !== 'accepted') fail('Only an accepted deal can be exposed.');
  if (d.from !== actor && d.to !== actor) fail('Only the two people in it can expose it.');
  const other = d.from === actor ? d.to : d.from;
  d.status = 'exposed';
  approve(w, other, -8);
  stamp(w, other, 'Broke a deal', `Exposed by ${nm(w, actor)}`, 'bad');
  gazette(w, 'scandal', `${nm(w, actor)} says ${nm(w, other)} broke a private deal: "${d.text}"`, '#/backroom');
}

// ---------- secret cards ----------
export function leakCard(w: W, actor: Id, kid: Id, paperId: Id | null) {
  needIntrigue(w);
  mustBeFree(w, actor);
  const k = w.cards.find((x: any) => x.id === kid);
  if (!k || !canSeeCard(w, k, actor)) fail('You do not hold that card.');
  if (leakBlocked(w, actor, k)) {
    // the Press and Information Act: trying is an offence when the Detention Act is law too
    if (inForce(w, 'press') && inGov(w, k.about) && inForce(w, 'jail') && jailByState(w, actor, 'Tried to leak a state secret')) return;
    fail('That card is about the government. It cannot be leaked.');
  }
  k.state = 'leaked';
  k.leakedBy = actor;
  const paper = paperId ? own(w.papers, paperId) : null;
  const named = chance(w, k.level === 'secret' ? 0.5 : 0.25);
  approve(w, k.about, -10);
  meter(w, 'stability', -4, 'A leak became a scandal');
  gazette(w, 'scandal', `Leaked${paper ? ' to ' + paper.name : ''}: ${k.title}${named ? ` The leak came from ${nm(w, actor)}.` : ''}`, paper ? '#/press' : '#/gazette');
  if (paper) {
    w.stories.unshift({ id: newId(w, 'st'), paper: paperId, by: actor, headline: 'Leaked: ' + k.title.slice(0, 70), body: k.title, status: 'published', at: w.now, cheers: [], leak: true });
    paper.followers = [...new Set([...paper.followers, ...allCitizens(w).filter(() => chance(w, 0.15)).map((c: any) => c.id)])];
  }
  if (named) {
    approve(w, actor, -5);
    stamp(w, actor, 'Leaker', 'Named in the press', 'bad');
  }
}
export const ASKS: Record<string, string> = { pay: 'Pay me 20 crowns', vote: 'Vote my way on the next proposal', resign: 'Resign your posts' };
export function useCard(w: W, actor: Id, kid: Id, ask: string) {
  needIntrigue(w);
  mustBeFree(w, actor);
  const k = w.cards.find((x: any) => x.id === kid);
  if (!k || !canSeeCard(w, k, actor)) fail('You do not hold that card.');
  if (!k.about) fail('That card is not about anyone in particular.');
  if (k.about === actor) fail('That card is about you.');
  if (!own(ASKS, ask)) fail('Pick what you want.');
  if (inForce(w, 'protection') && inGov(w, k.about)) fail('Demands against the Prime Minister or a minister are void.');
  if (Object.values(w.demands).some((d: any) => d.card === kid && d.status === 'sent')) fail('You are already using that card.');
  const id = newId(w, 'dm');
  w.demands[id] = { id, from: actor, target: k.about, card: kid, ask, status: 'sent', at: w.now, dueAt: w.now + DAY };
}
export function answerDemand(w: W, actor: Id, id: Id, how: 'comply' | 'expose') {
  const d = own(w.demands, id);
  if (!d || d.status !== 'sent' || d.target !== actor) fail('That demand is not for you.');
  if (how !== 'comply' && how !== 'expose') fail('Comply or expose it.');
  const k = w.cards.find((x: any) => x.id === d.card);
  if (how === 'comply') {
    d.status = 'complied';
    if (d.ask === 'pay') transfer(w, ca(actor), ca(d.from), 20, 'A quiet payment');
    if (d.ask === 'resign') {
      Object.values(w.offices).forEach((o: any) => o.holder === actor && (o.holder = null));
      if (w.pm === actor) {
        w.pm = null;
        clearMinisters(w);
        w.pmInviteDue = w.now + DAY;
      }
      gazette(w, 'government', `${nm(w, actor)} resigns, giving no reason.`);
    }
    if (k) k.state = 'burned';
  } else {
    d.status = 'exposed';
    approve(w, d.from, -15);
    stamp(w, d.from, 'Blackmailer', `Exposed by ${nm(w, actor)}`, 'bad');
    if (k) {
      k.state = 'leaked';
      approve(w, actor, -6);
    }
    meter(w, 'stability', -3, 'A blackmail scandal');
    gazette(w, 'scandal', `${nm(w, actor)} exposes blackmail by ${nm(w, d.from)}, and publishes what they had: ${k?.title ?? ''}`, '#/backroom');
  }
}
export function burnCard(w: W, actor: Id, kid: Id) {
  const k = w.cards.find((x: any) => x.id === kid);
  if (!k || !canSeeCard(w, k, actor)) fail('You do not hold that card.');
  k.state = 'burned';
  k.burnedBy = actor;
}

// ---------- coups: planning ----------
// A plot is private to its members and whoever they approach. An approach can be joined, kept quiet, reported
// (which ends the plot) or joined as an informer for the Security Service, who can then raid it when they like.
// Three preparations make a coup swift (any two of them): the General is in, a foreign backer has signed on,
// the war chest is full. Each one also raises the chance of discovery every day.
export const CHEST_FULL = 150;
export const NIGHT = 12 * HOUR;
export const pretext = (w: W) => inDanger(w, 'stability') || !!w.confidence || !!w.army?.war || beaten(w) || Object.values(w.crises).some((c: any) => c.status === 'open');
// who a double agent reports to: the Director of the Security Service, or the Prime Minister if there is none
export const watcher = (w: W): Id | null => holderOf(w, 'security') || w.pm || null;
export function plotNeeds(w: W, p: any) {
  const general = holderOf(w, 'army');
  const scar = w.scars && w.scars.until > w.now ? 1 : 0;
  // a regime that has lost half its legitimacy can be toppled by two people
  const weak = !!w.regime && w.regime.type !== 'civil' && w.regime.legit <= Math.ceil(w.regime.legit0 / 2);
  const base = weak ? 2 : Math.max(2, (w.offices.army ? 3 : 4) - (inDanger(w, 'stability') ? 1 : 0) - scar);
  // State Security Act: two more, and never fewer than four
  const need = inForce(w, 'security') ? Math.max(4, base + 2) : base;
  const hasGeneral = !!w.offices.army && !!general && p.members.includes(general);
  const chest = p.chest || 0;
  const preps = [hasGeneral, !!p.backer, chest >= lim(w, 'warChestFull')].filter(Boolean).length;
  return { need, enough: p.members.length >= need, armyOk: true, hasGeneral, chest, preps, swift: preps >= 2 && !inForce(w, 'security'), pretext: pretext(w), risk: Math.min(90, 10 + 5 * p.members.length + 5 * preps + (p.heat || 0)) };
}
export function startPlot(w: W, actor: Id, name: string) {
  needIntrigue(w);
  mustBeFree(w, actor);
  if (w.coup) fail('A coup is already under way.');
  if (Object.values(w.plots).some((p: any) => p.status === 'planning' && p.members.includes(actor))) fail('You are already in a plot.');
  spend(w, actor, 20, 'Started a plot');
  const id = newId(w, 'pl');
  w.plots[id] = { id, name: txt(name, 0, 60, 'plot name') || 'Operation Nightjar', leader: actor, members: [actor], invited: {}, informers: [], chest: 0, paid: {}, backer: null, asked: {}, heat: 0, status: 'planning', at: w.now, nextCheck: w.now + DAY };
  // the Protection of the State Act, without State Security: found within the hour
  if (inForce(w, 'protection') && !inForce(w, 'security')) w.plots[id].foundAt = w.now + HOUR;
}
export function invitePlot(w: W, actor: Id, pid: Id, target: Id) {
  const p = own(w.plots, pid);
  if (!p || p.status !== 'planning' || !p.members.includes(actor)) fail('Only plotters can recruit.');
  cit(w, target);
  if (p.members.includes(target) || p.invited[target]) fail('Already approached.');
  p.invited[target] = 'pending';
}
// how: 'join', 'silent' (say no and keep the secret), 'report' (ends the plot) or 'inform' (join, and tell the
// Security Service). Old clients send only `join`: true joins, false stays silent.
export function answerPlot(w: W, actor: Id, pid: Id, join: boolean, how?: unknown) {
  const p = own(w.plots, pid);
  if (!p || p.status !== 'planning' || p.invited[actor] !== 'pending') fail('There is no invitation for you.');
  mustBeFree(w, actor);
  const h = how === undefined || how === null ? (join ? 'join' : 'silent') : how;
  if (h !== 'join' && h !== 'silent' && h !== 'report' && h !== 'inform') fail('Join, stay silent, report it or inform on it.');
  if (h === 'silent') return void (p.invited[actor] = 'silent');
  if (h === 'report') {
    p.invited[actor] = 'reported';
    earn(w, actor, 10, 'Reported a plot');
    approve(w, actor, 5);
    return failPlot(w, p, `${nm(w, actor)} reported it`);
  }
  if (h === 'inform') {
    const to = watcher(w);
    if (!to || p.members.includes(to)) fail('There is nobody to inform: the Security Service is empty, or in on it.');
    p.informers.push(actor);
  }
  p.invited[actor] = 'joined';
  p.members.push(actor);
  earlyWarning(w, p);
}
// the Security Service acts on its informer: every plotter but the informers goes into exile
export function raidPlot(w: W, actor: Id, pid: Id) {
  const p = own(w.plots, pid);
  if (!p || p.status !== 'planning' || !(p.informers || []).length) fail('You have nobody inside that plot.');
  if (watcher(w) !== actor) fail('Only the head of the Security Service orders a raid.');
  earn(w, actor, 5, 'Broke up a plot');
  failPlot(w, p, 'the Security Service had someone inside', p.informers);
}
// one a day: is this person in a plot? The answer is true, and only the asker sees it
export function investigate(w: W, actor: Id, target: Id) {
  needIntrigue(w);
  const acting = inForce(w, 'security') && isPM(w, actor) && !holderOf(w, 'security');
  if (!w.offices.security && !acting) fail('This needs a Security Service.');
  if (!hasPower(w, actor, 'intel') && !(isPM(w, actor) && !holderOf(w, 'security'))) fail('Only the Director of the Security Service investigates.');
  cit(w, target);
  if (target === actor) fail('Pick someone else.');
  // State Security Act: the PM may make two a day while there is no Director
  const per = lim(w, 'probesPerDay') + (inForce(w, 'security') && isPM(w, actor) ? 1 : 0);
  if (w.probes.filter((x: any) => x.by === actor && w.now - x.at < DAY).length >= per) fail(per === 1 ? 'One investigation a day.' : `${per} investigations a day.`);
  w.probeAt = w.now;
  const yes = Object.values(w.plots).some((p: any) => p.status === 'planning' && p.members.includes(target));
  w.probes.unshift({ id: newId(w, 'pb'), by: actor, target, at: w.now, yes });
  w.probes = w.probes.slice(0, 30);
}
// the war chest: held in escrow, refunded if the plot is called off, lost to the Treasury otherwise
export function payChest(w: W, actor: Id, pid: Id, amount: number) {
  const p = own(w.plots, pid);
  if (!p || p.status !== 'planning' || !p.members.includes(actor)) fail('You are not in that plot.');
  const full = lim(w, 'warChestFull');
  const amt = int(amount, 1, full, 'amount');
  if ((p.chest || 0) + amt > full) fail(`The chest is full at ${full} crowns. It has ${p.chest || 0}.`);
  transfer(w, ca(actor), 'escrow', amt, 'A private subscription');
  p.chest = (p.chest || 0) + amt;
  p.paid[actor] = (p.paid[actor] || 0) + amt;
}
// ask a nation to back the coup: friends say yes more often; a refusal makes the plot easier to find
export function askBacker(w: W, actor: Id, pid: Id, nid: Id) {
  const p = own(w.plots, pid);
  if (!p || p.status !== 'planning' || p.leader !== actor) fail('Only the leader deals with foreign powers.');
  const n = own(w.nations, nid);
  if (!n) fail('Unknown country.');
  if (p.backer) fail(`${w.nations[p.backer].name} is already backing you.`);
  if (p.asked[nid]) fail('You have already asked them.');
  // the enemy in a war is glad to back anyone who would end it on their terms
  const yes = chance(w, w.army?.war === nid ? 0.8 : [0.1, 0.3, 0.55, 0.75, 0.9][n.mood]);
  p.asked[nid] = yes ? 'yes' : 'no';
  if (yes) p.backer = nid;
  else p.heat = (p.heat || 0) + 5;
}
function refundChest(w: W, p: any) {
  Object.entries(p.paid || {}).forEach(([id, amt]: any) => amt > 0 && transfer(w, 'escrow', ca(id), amt, 'A subscription returned'));
  p.chest = 0;
  p.paid = {};
}
function loseChest(w: W, p: any, memo: string) {
  // once only: a launched plot banks its chest, and may still fail later
  if (p.chest > 0 && !p.banked) transfer(w, 'escrow', 'treasury', p.chest, memo);
  p.banked = true;
  p.paid = {};
}
export function abandonPlot(w: W, actor: Id, pid: Id) {
  const p = own(w.plots, pid);
  if (!p || p.status !== 'planning' || p.leader !== actor) fail('Only the leader can call it off.');
  refundChest(w, p);
  p.status = 'abandoned';
}
export function failPlot(w: W, p: any, why: string, spare: Id[] = [], auto = false) {
  p.status = 'failed';
  loseChest(w, p, 'Seized from plotters');
  const out = p.members.filter((m: Id) => !spare.includes(m));
  const how = plotPunishment(w, auto);
  gazette(w, 'crisis', `A coup plot is uncovered (${why}). ${out.map((m: Id) => nm(w, m)).join(', ')} ${how === 'jail' ? `${out.length === 1 ? 'is' : 'are'} detained in the Realm Jail` : how === 'forever' ? `${out.length === 1 ? 'goes' : 'go'} into exile, with no end date` : `go${out.length === 1 ? 'es' : ''} into exile for a week`}.`, how === 'jail' ? '#/jail' : '#/exile');
  meter(w, 'stability', -5, 'A coup plot was uncovered');
  spare.forEach((m: Id) => {
    earn(w, m, 10, 'Informed on a plot');
    approve(w, m, 5);
    bump(w, m, 'informer');
    stamp(w, m, 'Double agent', p.name, 'ink');
  });
  out.forEach((m: Id) => {
    const c = w.citizens[m];
    if (how === 'jail' && jailByState(w, m, p.name)) return void (approve(w, m, -15), stamp(w, m, 'Traitor', p.name, 'bad'));
    c.exiledUntil = w.now + (how === 'forever' ? 36500 : 7) * DAY;
    c.exileNoted = false;
    c.asylum = null;
    approve(w, m, -15);
    bump(w, m, 'exiled');
    stamp(w, m, 'Traitor', p.name, 'bad');
    if (isMP(w, m)) vacateSeat(w, m, 'exiled');
    if (w.pm === m && !w.regime) w.pm = null;
    Object.values(w.offices).forEach((o: any) => o.holder === m && (o.holder = null));
  });
}
// the Protection of the State Act: every plot is found an hour after it starts (unless State Security governs coups)
export function autoFind(w: W, p: any) {
  p.foundAt = null;
  if (p.status !== 'planning' || !inForce(w, 'protection') || inForce(w, 'security')) return;
  failPlot(w, p, 'it was found within the hour, as the law provides', [], true);
}
export function checkPlot(w: W, p: any) {
  p.nextCheck = w.now + DAY;
  if (w.offices.security && chance(w, plotNeeds(w, p).risk / 100)) failPlot(w, p, 'the Security Service found it');
  else if (!w.offices.security && chance(w, plotNeeds(w, p).risk / 300)) failPlot(w, p, 'someone talked');
}

// ---------- coups: the launch ----------
// Swift (two preparations): power changes hands at once, with little legitimacy. Otherwise a contested night:
// 12 hours in which every citizen may declare for the coup or the government; the heavier side wins.
export function launchCoup(w: W, actor: Id, pid: Id) {
  const p = own(w.plots, pid);
  if (!p || p.status !== 'planning' || p.leader !== actor) fail('Only the leader can launch it.');
  if (w.coup) fail('A coup is already under way.');
  if (w.phase !== 'running') fail('There is nothing to seize yet.');
  if (w.regime && (w.regime.leader === actor || w.regime.council.includes(actor))) fail(w.regime.type === 'civil' ? 'You are the government.' : 'You are the regime.');
  const r = plotNeeds(w, p);
  if (!r.enough) fail(`You need ${r.need} plotters.`);
  const to = watcher(w);
  if ((p.informers || []).length && to && !p.members.includes(to)) return failPlot(w, p, 'the Security Service was waiting', p.informers);
  loseChest(w, p, 'The plotters’ war chest');
  // State Security Act: a minister in the plot loses their post the moment it launches
  if (inForce(w, 'security')) p.members.forEach((m: Id) => Object.values(w.offices).forEach((o: any) => o.fill === 'pm' && o.holder === m && (o.holder = null)));
  if (r.swift) return seize(w, p, { swift: true, margin: 0, declared: {} });
  p.status = 'launched';
  w.coup = { plot: p.id, name: p.name, leader: actor, plotters: p.members.slice(), defected: [], declared: {}, startedAt: w.now, endsAt: w.now + NIGHT, backer: p.backer || null, pretext: r.pretext, chest: p.chest || 0, against: w.regime && w.regime.type !== 'civil' ? 'regime' : 'government' };
  meter(w, 'stability', -8, 'Soldiers in the streets');
  gazette(w, 'crisis', `Coup attempt. ${nm(w, actor)} and ${p.members.length - 1} other${p.members.length === 2 ? '' : 's'} move against the ${w.coup.against}. Every citizen has 12 hours to declare for the coup or against it.`, '#/regime');
}
// ---------- the march on the capital: the General turns the Army on the government, with no plot behind it.
// Only a war hero, or a General whose Army has lost faith in the government (loyalty 2 or less), can make soldiers
// follow; never while the Army is on the advance abroad. It is a contested night like any coup, with the Army's
// weight (+3) on the General's side; if it fails, the General is treated as a failed plotter. Once every 14 days. ----------
export const MARCH_EVERY = 14 * DAY;
export function canMarch(w: W, id: Id) {
  if (!w.offices.army || holderOf(w, 'army') !== id) return 'Only the General can order the Army to march.';
  if (heroOf(w) !== id && w.army.loyalty > 2) return 'The soldiers will not follow you: be a war hero, or wait until the Army has lost faith in the government (loyalty 2 or less).';
  if (atFront(w)) return 'The Army is away at the front.';
  if (w.army.marchedAt && w.now - w.army.marchedAt < MARCH_EVERY) return 'The Army will not march again so soon.';
  return null;
}
export function marchOnCapital(w: W, actor: Id) {
  needIntrigue(w);
  mustBeFree(w, actor);
  if (w.coup) fail('A coup is already under way.');
  if (w.phase !== 'running') fail('There is nothing to seize yet.');
  if (w.regime && (w.regime.leader === actor || w.regime.council.includes(actor))) fail('You are already the regime.');
  const why = canMarch(w, actor);
  if (why) fail(why);
  w.army.marchedAt = w.now;
  const id = newId(w, 'pl');
  w.plots[id] = { id, name: 'The March on the Capital', leader: actor, members: [actor], invited: {}, informers: [], chest: 0, paid: {}, backer: null, asked: {}, heat: 0, status: 'launched', at: w.now, nextCheck: null, march: true };
  w.coup = { plot: id, name: 'The March on the Capital', leader: actor, plotters: [actor], defected: [], declared: {}, startedAt: w.now, endsAt: w.now + NIGHT, backer: null, pretext: pretext(w), chest: 0, against: w.regime && w.regime.type !== 'civil' ? 'regime' : 'government', march: true };
  meter(w, 'stability', -10, 'The Army marches on the capital');
  gazette(w, 'crisis', `The Army marches on the capital. ${nm(w, actor)}, the General${heroOf(w) === actor ? ' and a war hero' : ''}, moves against the ${w.coup.against}. Every citizen has 12 hours to declare for the Army or against it.`, '#/regime');
}

// the General speaks for the Army (3), the head of state for the realm (2), everyone else for themselves
// a General back from a victory (a war hero, war.ts) speaks for the Army with 4
export const coupWeight = (w: W, id: Id) => (w.offices.army && holderOf(w, 'army') === id ? (heroOf(w) === id ? 4 : 3) : isHOS(w, id) || (inForce(w, 'security') && isPM(w, id)) ? 2 : 1);
export function coupTally(w: W) {
  const k = w.coup;
  if (!k) return { coup: 0, gov: 0, lines: [] as [string, number, string][] };
  const lines: [string, number, string][] = [];
  const add = (side: string, n: number, why: string) => n && lines.push([side, n, why]);
  k.plotters.forEach((m: Id) => add('coup', coupWeight(w, m), `${nm(w, m)}, plotter`));
  Object.entries(k.declared).forEach(([id, side]: any) => w.citizens[id]?.active && add(side, coupWeight(w, id), nm(w, id)));
  // State Security Act: the security forces, and the PM and ministers unless they say otherwise, stand with the government
  if (inForce(w, 'security')) {
    add('gov', 3, 'Loyal security forces');
    [w.pm, ...Object.values(w.offices).filter((o: any) => o.fill === 'pm').map((o: any) => o.holder)].filter((id, i, a) => id && a.indexOf(id) === i && !k.plotters.includes(id) && !k.declared[id] && w.citizens[id]?.active).forEach((id: Id) => add('gov', coupWeight(w, id), `${nm(w, id)}, ${w.pm === id ? 'Prime Minister' : 'minister'}`));
  }
  add('coup', k.march ? 3 : 0, 'The Army marches with its General');
  add('coup', k.backer ? 1 : 0, `Backed by ${w.nations[k.backer]?.name}`);
  add('coup', k.pretext ? 1 : 0, 'A realm already in trouble');
  add('coup', k.chest >= lim(w, 'warChestFull') ? 2 : k.chest >= lim(w, 'warChestFull') / 2 ? 1 : 0, 'A war chest');
  add('gov', w.meters.stability >= 60 ? 1 : 0, 'A settled realm');
  const general = holderOf(w, 'army');
  const silent = !general || (!k.plotters.includes(general) && !k.declared[general]);
  // the Army can only defend the capital if it is home: on the advance, it is at the front
  add('gov', w.offices.army && silent && w.army.loyalty >= 4 && !atFront(w) ? 2 : 0, 'A loyal Army');
  add('coup', w.offices.army && silent && w.army.loyalty <= 1 ? 1 : 0, 'A restless Army');
  add('coup', w.offices.army && silent && beaten(w) ? 1 : 0, 'An Army beaten abroad');
  add('coup', w.offices.army && atFront(w) ? 1 : 0, 'The Army is away at the front');
  const sum = (s: string) => lines.filter((l) => l[0] === s).reduce((n, l) => n + l[1], 0);
  return { coup: sum('coup'), gov: sum('gov'), lines };
}
export function declareCoup(w: W, actor: Id, side: unknown) {
  const k = w.coup;
  if (!k) fail('There is no coup under way.');
  mustBeFree(w, actor);
  if (k.plotters.includes(actor)) fail('You are one of the plotters. You can only defect.');
  if (side !== 'coup' && side !== 'gov') fail('Declare for the coup or against it.');
  if (k.declared[actor] === side) fail('You have already declared that.');
  k.declared[actor] = side;
  gazette(w, 'crisis', `${nm(w, actor)} declares ${side === 'coup' ? 'for the coup' : `for the ${k.against}`}.`, '#/regime');
}
// a plotter changes sides during the night: they are spared whatever happens to the rest
export function defectCoup(w: W, actor: Id) {
  const k = w.coup;
  if (!k || !k.plotters.includes(actor)) fail('You are not one of the plotters.');
  if (k.leader === actor) fail('The leader cannot defect from their own coup.');
  k.plotters = k.plotters.filter((m: Id) => m !== actor);
  k.defected.push(actor);
  k.declared[actor] = 'gov';
  const p = w.plots[k.plot];
  if (p) p.members = p.members.filter((m: Id) => m !== actor);
  stamp(w, actor, 'Turned', `Left ${k.name} on the night`, 'ink');
  gazette(w, 'crisis', `${nm(w, actor)} abandons the coup and declares for the ${k.against}.`, '#/regime');
}
export function resolveCoup(w: W) {
  const k = w.coup;
  if (!k) return;
  const t = coupTally(w);
  const p = w.plots[k.plot];
  const won = t.coup > t.gov;
  w.coup = null;
  if (p) p.night = { coup: t.coup, gov: t.gov, at: w.now };
  Object.entries(k.declared).forEach(([id, side]: any) => {
    if (!w.citizens[id]) return;
    if (side === 'gov') {
      stamp(w, id, 'Loyalist', `Stood against ${k.name}`, 'good');
      bump(w, id, 'loyalist');
      approve(w, id, won ? 1 : 3);
    } else if (!won) {
      stamp(w, id, 'Backed a failed coup', k.name, 'bad');
      approve(w, id, -5);
    }
    if (won === (side === 'coup') && coupWeight(w, id) > 1) bump(w, id, 'kingmaker');
  });
  gazette(w, 'crisis', `The night is over: ${t.coup} for the coup, ${t.gov} against. ${won ? 'The coup succeeds.' : 'The coup collapses.'}`, '#/regime');
  if (!p) return;
  if (won) seize(w, p, { swift: false, margin: t.coup - t.gov, declared: k.declared });
  else failPlot(w, p, 'it collapsed overnight');
}
function seize(w: W, p: any, o: { swift: boolean; margin: number; declared: Record<Id, string> }) {
  p.status = 'succeeded';
  // against a regime it is a restoration: the regime falls and the plot's leader heads what comes next
  // (against a Prime Minister ruling by decree it is an ordinary coup: takePower undoes the decrees)
  if (w.regime && w.regime.type !== 'civil') {
    p.members.forEach((m: Id) => stamp(w, m, 'Restorer', p.name, 'good'));
    return fallRegime(w, 'countercoup', p.leader);
  }
  takePower(w, { leader: p.leader, council: p.members.slice(), name: p.name, swift: o.swift, legit: o.swift ? 5 : clamp(3 + o.margin, 5, 12), backer: p.backer || null, backers: Object.keys(o.declared).filter((id) => o.declared[id] === 'coup') });
}
// an old-style martial law saved before regimes existed (and the state of emergency from a crisis) still ends this way
export function endMartialLaw(w: W) {
  w.martial = null;
  if (inForce(w, 'continuity')) return gazette(w, 'government', 'Martial law ends. Under the Continuity of Parliament Act there is no election: the House sits as it is.', '#/house');
  gazette(w, 'election', 'Martial law ends. Polls open for the Restoration election.', '#/elections');
  callGeneralElection(w, w.now + 2 * DAY);
}

// ---------- exile ----------
export function seekAsylum(w: W, actor: Id, nid: Id) {
  const c = cit(w, actor);
  if (!exiled(w, actor)) fail('You are not in exile.');
  if (!own(w.nations, nid)) fail('Unknown country.');
  c.asylum = nid;
  gazette(w, 'foreign', `${c.name} takes refuge in ${w.nations[nid].name}.`);
}
export function askPardon(w: W, actor: Id) {
  if (!exiled(w, actor)) fail('You are not in exile.');
  cit(w, actor).pardonAsked = true;
}
export function pardon(w: W, actor: Id, target: Id) {
  if (!isHOS(w, actor)) fail(`Only the ${hosTitle(w)} grants pardons.`);
  const c = cit(w, target);
  if (!exiled(w, target)) fail('They are not in exile.');
  c.exiledUntil = w.now;
  c.pardonAsked = false;
  gazette(w, 'hos', `The ${hosTitle(w)} pardons ${c.name}.`, '#/exile');
}
