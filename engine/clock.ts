// Time: everything closes itself. advanceTo() runs every deadline in order, including the calendar's weekly events.
import { W, DAY, HOUR, nm, gazette, exiled, allCitizens, nextAt, meter, inDanger, approve } from './core';
import { closeElection, callGeneralElection, autoInvite, governmentFalls, startHosSelection, newObjectives, closeConvention, endInduction } from './politics';
import { openVote, closeVote, enact, closeOverride, dissolve, closePMQs, missFormal } from './proposals';
import { payday, settleVenture } from './economy';
import { actBots } from './bots';
import { maybeOffers, answerAsk, resolveIntel, armyLoyalty } from './foreign';
import { checkPlot, endMartialLaw } from './backroom';
import { spawnCrisis, timeoutCrisis, fireQueued, rule, makeFrontPage } from './society';

type D = { at: number; run: () => void };
function collect(w: W): D[] {
  const out: D[] = [];
  const add = (at: number | null | undefined, run: () => void) => at && out.push({ at, run });
  Object.values(w.elections).forEach((e: any) => e.status === 'open' && add(e.closesAt, () => closeElection(w, e)));
  if (w.phase === 'convention' && w.convention.closesAt) add(w.convention.closesAt, () => closeConvention(w));
  if (w.induction && !w.induction.done) add(w.induction.until, () => endInduction(w));
  // practice bots take a turn every two hours during induction
  if (w.induction && !w.induction.done && w.induction.nextBotAt) add(w.induction.nextBotAt, () => ((w.induction.nextBotAt = w.now + 2 * HOUR), actBots(w, (id) => !!id && !!w.citizens[id]?.bot, 0.6)));
  if (w.phase === 'running' && w.nextGeneralAt && !w.martial) add(w.nextGeneralAt - 2 * DAY, () => callGeneralElection(w, w.nextGeneralAt));
  Object.values(w.proposals).forEach((p: any) => {
    if (p.stage === 'debate') add(p.debateEndsAt, () => openVote(w, p));
    if (p.stage === 'vote') add(p.voteEndsAt, () => closeVote(w, p));
    if (p.stage === 'assent') add(p.assentDueAt, () => enact(w, p, w.config.hos === 'monarchy' ? 'Royal Assent by convention' : 'became law unsigned'));
    if (p.stage === 'override') add(p.overrideEndsAt, () => closeOverride(w, p));
    if (p.stage === 'hos') add(p.hosDueAt, () => dissolve(w, p, false));
  });
  if (w.confidence) add(w.confidence.deadline, () => governmentFalls(w));
  if (w.pmInviteDue && !w.pm) add(w.pmInviteDue, () => autoInvite(w));
  if (w.hos.until) add(w.hos.until, () => ((w.hos.until = null), startHosSelection(w)));
  Object.values(w.crises).forEach((c: any) => c.status === 'open' && add(c.decideBy, () => timeoutCrisis(w, c)));
  (w.crisisQueue || []).forEach((q: any) => add(q.at, () => fireQueued(w, q)));
  w.intel.forEach((r: any) => r.status === 'pending' && add(r.readyAt, () => resolveIntel(w, r)));
  Object.values(w.plots).forEach((p: any) => p.status === 'planning' && add(p.nextCheck, () => checkPlot(w, p)));
  Object.values(w.demands).forEach((d: any) => d.status === 'sent' && add(d.dueAt, () => ((d.status = 'ignored'), approve(w, d.target, 0))));
  Object.values(w.offers).forEach((o: any) => add(o.expiresAt, () => delete w.offers[o.id]));
  w.asks.forEach((a: any) => a.status === 'sent' && add(a.decideAt, () => answerAsk(w, a)));
  w.questions.forEach((q: any) => q.formal && q.status === 'open' && add(q.dueAt, () => missFormal(w, q)));
  Object.values(w.cases).forEach((k: any) => k.status === 'open' && add(k.dueAt, () => rule(w, k, Object.values(k.votes).filter((v) => v === 'plaintiff').length > Object.values(k.votes).filter((v) => v === 'defence').length)));
  Object.values(w.parties).forEach((p: any) => p.status === 'forming' && add(p.formingUntil, () => ((p.status = 'lapsed'), gazette(w, 'party', `The ${p.name} failed to find two co-founders.`))));
  if (w.martial) add(w.martial.until, () => endMartialLaw(w));
  allCitizens(w).forEach((c: any) => c.exiledUntil && !c.exileNoted && add(c.exiledUntil, () => ((c.exileNoted = true), gazette(w, 'quiet', `${c.name}'s exile is over.`))));
  w.ventures.forEach((v: any) => v.status === 'out' && add(v.dueAt, () => settleVenture(w, v)));
  if (w.phase === 'running') {
    add(nextAt(w, 'payday', w.lastEvent.payday || w.now - 1), () => weeklyPayday(w));
    add(nextAt(w, 'pmqs', w.lastEvent.pmqs || w.now - 1), () => ((w.lastEvent.pmqs = w.now), closePMQs(w)));
    add(nextAt(w, 'frontpage', w.lastEvent.frontpage || w.now - 1), () => ((w.lastEvent.frontpage = w.now), makeFrontPage(w)));
  }
  return out;
}
function weeklyPayday(w: W) {
  w.lastEvent.payday = w.now;
  payday(w);
  (['prosperity', 'stability'] as const).forEach((k) => w.meters[k] !== 50 && meter(w, k, w.meters[k] < 50 ? 2 : -1, 'The realm settles back towards normal'));
  spawnCrisis(w);
  newObjectives(w);
  maybeOffers(w);
  if (w.offices.army) {
    if (inDanger(w, 'stability')) armyLoyalty(w, -1, 'Unrest at home');
    else if (w.army.loyalty < 3 && w.army.readiness !== 'down') armyLoyalty(w, 1, 'A quiet week on full pay');
  }
}
export function upcoming(w: W, limit = 8) {
  // the next calendar events, for the timeline strip
  if (w.phase !== 'running') return [];
  const out: { key: string; at: number }[] = [];
  ['payday', 'pmqs', 'frontpage'].forEach((k) => {
    let t = nextAt(w, k, w.now);
    for (let i = 0; i < 2; i++) {
      out.push({ key: k, at: t });
      t = nextAt(w, k, t);
    }
  });
  if (w.nextGeneralAt) out.push({ key: 'election', at: w.nextGeneralAt - 2 * DAY }, { key: 'polls', at: w.nextGeneralAt });
  return out.filter((e) => e.at > w.now).sort((a, b) => a.at - b.at).slice(0, limit);
}
export function nextDeadline(w: W) {
  const ds = collect(w).filter((d) => d.at > w.now - 1);
  return ds.length ? Math.min(...ds.map((d) => d.at)) : null;
}
export function advanceTo(w: W, t: number) {
  for (let guard = 0; guard < 5000; guard++) {
    const due = collect(w).filter((d) => d.at <= t).sort((a, b) => a.at - b.at)[0];
    if (!due) break;
    w.now = Math.max(w.now, due.at);
    due.run();
  }
  w.now = Math.max(w.now, t);
}
