// The backroom: private deals, secret cards (leak, use or burn), coups, exile and pardons. Opens in week 3.
import { W, Id, DAY, fail, newId, chance, cit, nm, own, text as txt, allCitizens, exiled, mustBeFree, gazette, earn, spend, stamp, approve, meter, needIntrigue, canSeeCard, addCard, isHOS, isMP, isPM, inDanger, holderOf, transfer, ca, hosTitle, bump } from './core';
import { vacateSeat, clearMinisters, callGeneralElection } from './politics';

// ---------- private deals: written down, never enforced ----------
export function offerDeal(w: W, actor: Id, to: Id, text: string) {
  needIntrigue(w);
  mustBeFree(w, actor);
  cit(w, to);
  if (to === actor) fail('Pick someone else.');
  const t = txt(text, 8, 500, 'deal');
  if (Object.values(w.deals).filter((d: any) => d.from === actor && d.status === 'offered').length >= 5) fail('You have 5 deals waiting for an answer. Wait for one first.');
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

// ---------- coups ----------
export function plotNeeds(w: W, p: any) {
  const general = holderOf(w, 'army');
  const need = (w.offices.army ? 4 : 5) - (inDanger(w, 'stability') ? 1 : 0);
  const armyOk = !w.offices.army || w.army.loyalty <= 2 || (!!general && p.members.includes(general));
  return { need, enough: p.members.length >= need, armyOk, risk: Math.min(90, 10 + 5 * p.members.length) };
}
export function startPlot(w: W, actor: Id, name: string) {
  needIntrigue(w);
  mustBeFree(w, actor);
  if (Object.values(w.plots).some((p: any) => p.status === 'planning' && p.members.includes(actor))) fail('You are already in a plot.');
  spend(w, actor, 20, 'Started a plot');
  const id = newId(w, 'pl');
  w.plots[id] = { id, name: txt(name, 0, 60, 'plot name') || 'Operation Nightjar', leader: actor, members: [actor], invited: {}, status: 'planning', at: w.now, nextCheck: w.now + DAY };
}
export function invitePlot(w: W, actor: Id, pid: Id, target: Id) {
  const p = own(w.plots, pid);
  if (!p || p.status !== 'planning' || !p.members.includes(actor)) fail('Only plotters can recruit.');
  cit(w, target);
  if (p.members.includes(target) || p.invited[target]) fail('Already approached.');
  p.invited[target] = 'pending';
}
export function answerPlot(w: W, actor: Id, pid: Id, join: boolean) {
  const p = own(w.plots, pid);
  if (!p || p.status !== 'planning' || p.invited[actor] !== 'pending') fail('There is no invitation for you.');
  if (join) {
    p.invited[actor] = 'joined';
    p.members.push(actor);
  } else {
    p.invited[actor] = 'reported';
    earn(w, actor, 10, 'Reported a plot');
    approve(w, actor, 5);
    failPlot(w, p, `${nm(w, actor)} reported it`);
  }
}
export function launchCoup(w: W, actor: Id, pid: Id) {
  const p = own(w.plots, pid);
  if (!p || p.status !== 'planning' || p.leader !== actor) fail('Only the leader can launch it.');
  const r = plotNeeds(w, p);
  if (!r.enough) fail(`You need ${r.need} plotters.`);
  if (!r.armyOk) fail('The Army would stop you. Win over the General, or wait for its loyalty to fall to 2.');
  p.status = 'succeeded';
  w.martial = { leader: actor, plotters: p.members.slice(), until: w.now + 3 * DAY };
  w.pm = actor;
  clearMinisters(w);
  const pmOffices = Object.values(w.offices).filter((o: any) => o.fill === 'pm');
  pmOffices.forEach((o: any, i) => (o.holder = p.members[i + 1] || null));
  w.confidence = null;
  p.members.forEach((m: Id) => stamp(w, m, 'Coup', p.name, 'bad'));
  meter(w, 'stability', -20, 'A coup');
  gazette(w, 'crisis', `Coup. ${nm(w, actor)} and ${p.members.length - 1} others seize power. Martial law for 3 days, then a Restoration election.`, '#/plots');
}
export function abandonPlot(w: W, actor: Id, pid: Id) {
  const p = own(w.plots, pid);
  if (!p || p.status !== 'planning' || p.leader !== actor) fail('Only the leader can call it off.');
  p.status = 'abandoned';
}
export function failPlot(w: W, p: any, why: string) {
  p.status = 'failed';
  gazette(w, 'crisis', `A coup plot is uncovered (${why}). ${p.members.map((m: Id) => nm(w, m)).join(', ')} go into exile for a week.`, '#/exile');
  meter(w, 'stability', -5, 'A coup plot was uncovered');
  p.members.forEach((m: Id) => {
    const c = w.citizens[m];
    c.exiledUntil = w.now + 7 * DAY;
    c.exileNoted = false;
    c.asylum = null;
    approve(w, m, -15);
    bump(w, m, 'exiled');
    stamp(w, m, 'Traitor', p.name, 'bad');
    if (isMP(w, m)) vacateSeat(w, m, 'exiled');
    if (w.pm === m) w.pm = null;
    Object.values(w.offices).forEach((o: any) => o.holder === m && (o.holder = null));
  });
}
export function checkPlot(w: W, p: any) {
  p.nextCheck = w.now + DAY;
  if (w.offices.security && chance(w, plotNeeds(w, p).risk / 100)) failPlot(w, p, 'the Security Service found it');
  else if (!w.offices.security && chance(w, plotNeeds(w, p).risk / 300)) failPlot(w, p, 'someone talked');
}
export function endMartialLaw(w: W) {
  gazette(w, 'election', 'Martial law ends. Polls open for the Restoration election.', '#/elections');
  w.martial = null;
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
