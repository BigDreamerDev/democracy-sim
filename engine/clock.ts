// Time: everything closes itself. advanceTo() runs every deadline in order, including the calendar's weekly events.
import { W, DAY, HOUR, nm, gazette, exiled, allCitizens, nextAt, meter, inDanger, approve } from './core';
import { closeElection, callGeneralElection, autoInvite, governmentFalls, startHosSelection, newObjectives, closeConvention, endInduction } from './politics';
import { openVote, closeVote, enact, closeOverride, dissolve, closePMQs, missFormal } from './proposals';
import { payday, settleVenture } from './economy';
import { actBots } from './bots';
import { maybeOffers, answerAsk, resolveIntel, armyLoyalty } from './foreign';
import { checkPlot, endMartialLaw } from './backroom';
import { spawnCrisis, timeoutCrisis, fireQueued, rule, makeFrontPage } from './society';
import { nationsTurn, settleUltimatum } from './foreign';
import { expireContract, settleClaim, ghostBack, bountyDeadline, bountyDue, orderDeadline, openHunt, startHunt, finishHunt } from './streets';
import { marketDue, staleMarket } from './markets';
import { rollDaily, takePoll, records, afterChange } from './glory';

type D = { at: number; run: () => void; key: string };
// a deadline's identity: what it runs and when (two of the same kind due the same millisecond share it)
const keyOf = (run: () => void, at: number, id?: string) => {
  let h = 5381;
  const s = String(run);
  for (let i = 0; i < s.length; i++) h = (h * 33) ^ s.charCodeAt(i);
  return (h >>> 0).toString(36) + '@' + at + (id ? ':' + id : '');
};
function collect(w: W): D[] {
  const out: D[] = [];
  // deadlines that threw once are quarantined (w.clockErrors) so one bad item can't stop the clock for everyone
  const bad = new Set((w.clockErrors || []).map((e: any) => e.key));
  const add = (at: number | null | undefined, run: () => void, id?: string) => {
    if (!at) return;
    const key = keyOf(run, at, id);
    if (!bad.has(key)) out.push({ at, run, key });
  };
  Object.values(w.elections).forEach((e: any) => e.status === 'open' && add(e.closesAt, () => closeElection(w, e), e.id));
  if (w.phase === 'convention' && w.convention.closesAt) add(w.convention.closesAt, () => closeConvention(w));
  if (w.induction && !w.induction.done) add(w.induction.until, () => endInduction(w));
  // practice bots take a turn every two hours during induction
  if (w.induction && !w.induction.done && w.induction.nextBotAt) add(w.induction.nextBotAt, () => ((w.induction.nextBotAt = w.now + 2 * HOUR), actBots(w, (id) => !!id && !!w.citizens[id]?.bot, 0.6)));
  if (w.phase === 'running' && w.nextGeneralAt && !w.martial) add(w.nextGeneralAt - 2 * DAY, () => callGeneralElection(w, w.nextGeneralAt));
  Object.values(w.proposals).forEach((p: any) => {
    if (p.stage === 'debate') add(p.debateEndsAt, () => openVote(w, p), p.id);
    if (p.stage === 'vote') add(p.voteEndsAt, () => closeVote(w, p), p.id);
    if (p.stage === 'assent') add(p.assentDueAt, () => enact(w, p, w.config.hos === 'monarchy' ? 'Royal Assent by convention' : 'became law unsigned'), p.id);
    if (p.stage === 'override') add(p.overrideEndsAt, () => closeOverride(w, p), p.id);
    if (p.stage === 'hos') add(p.hosDueAt, () => dissolve(w, p, false), p.id);
  });
  if (w.confidence) add(w.confidence.deadline, () => governmentFalls(w));
  if (w.pmInviteDue && !w.pm) add(w.pmInviteDue, () => autoInvite(w));
  if (w.hos.until) add(w.hos.until, () => ((w.hos.until = null), startHosSelection(w)));
  Object.values(w.crises).forEach((c: any) => c.status === 'open' && add(c.decideBy, () => timeoutCrisis(w, c), c.id));
  (w.crisisQueue || []).forEach((q: any) => add(q.at, () => fireQueued(w, q), q.type));
  w.intel.forEach((r: any) => r.status === 'pending' && add(r.readyAt, () => resolveIntel(w, r), r.id));
  Object.values(w.plots).forEach((p: any) => p.status === 'planning' && add(p.nextCheck, () => checkPlot(w, p), p.id));
  Object.values(w.demands).forEach((d: any) => d.status === 'sent' && add(d.dueAt, () => ((d.status = 'ignored'), approve(w, d.target, 0)), d.id));
  Object.values(w.offers).forEach((o: any) => add(o.expiresAt, () => delete w.offers[o.id], o.id));
  w.asks.forEach((a: any) => a.status === 'sent' && add(a.decideAt, () => answerAsk(w, a), a.id));
  w.questions.forEach((q: any) => q.formal && q.status === 'open' && add(q.dueAt, () => missFormal(w, q), q.id));
  Object.values(w.cases).forEach((k: any) => k.status === 'open' && add(k.dueAt, () => rule(w, k, Object.values(k.votes).filter((v) => v === 'plaintiff').length > Object.values(k.votes).filter((v) => v === 'defence').length), k.id));
  Object.values(w.parties).forEach((p: any) => p.status === 'forming' && add(p.formingUntil, () => ((p.status = 'lapsed'), gazette(w, 'party', `The ${p.name} failed to find two co-founders.`)), p.id));
  if (w.martial) add(w.martial.until, () => endMartialLaw(w));
  allCitizens(w).forEach((c: any) => c.exiledUntil && !c.exileNoted && add(c.exiledUntil, () => ((c.exileNoted = true), gazette(w, 'quiet', `${c.name}'s exile is over.`)), c.id));
  w.ventures.forEach((v: any) => v.status === 'out' && add(v.dueAt, () => settleVenture(w, v), v.id));
  // the Streets, the market and the betting pools
  Object.values(w.streets?.contracts || {}).forEach((k: any) => {
    if (k.status === 'live') add(k.dueAt, () => expireContract(w, k), k.id);
    if (k.status === 'claimed') add(Math.min(k.claimDue, k.dueAt + 24 * HOUR), () => settleClaim(w, k), k.id);
  });
  allCitizens(w).forEach((c: any) => c.ghostUntil && !c.ghostNoted && add(c.ghostUntil, () => ghostBack(w, c), c.id));
  Object.values(w.bounties || {}).forEach((b: any) => add(bountyDue(b), () => bountyDeadline(w, b), b.id));
  Object.values(w.orders || {}).forEach((o: any) => ['paid', 'delivered'].includes(o.status) && add(o.dueAt, () => orderDeadline(w, o), o.id));
  (w.jobClaims || []).forEach((c: any) => c.status === 'pending' && add(c.dueAt, () => (c.status = 'lapsed'), c.id));
  Object.values(w.markets || {}).forEach((m: any) => add(marketDue(m), () => staleMarket(w, m), m.id));
  (w.ultimatums || []).forEach((u: any) => u.status === 'sent' && add(u.dueAt, () => settleUltimatum(w, u, false), u.id));
  if (w.daily) add(w.daily.endsAt, () => rollDaily(w));
  if (w.hunt?.status === 'signup') add(w.hunt.startsAt, () => startHunt(w));
  if (w.hunt?.status === 'running') add(w.hunt.endsAt, () => finishHunt(w));
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
  nationsTurn(w);
  openHunt(w);
  takePoll(w);
  records(w);
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
  const ds = collect(w);
  return ds.length ? Math.min(...ds.map((d) => d.at)) : null;
}
export function advanceTo(w: W, t: number) {
  const ran = new Set<string>();
  for (let guard = 0; guard < 5000; guard++) {
    const due = collect(w).filter((d) => d.at <= t).sort((a, b) => a.at - b.at)[0];
    if (!due) break;
    w.now = Math.max(w.now, due.at);
    try {
      // a deadline that runs but doesn't settle itself would fire forever: treat it as an error
      if (ran.has(due.key)) throw new Error('the deadline did not settle');
      ran.add(due.key);
      due.run();
      afterChange(w);
    } catch (e: any) {
      w.clockErrors = [{ key: due.key, at: due.at, when: w.now, error: String(e?.message || e).slice(0, 300) }, ...(w.clockErrors || [])].slice(0, 200);
      gazette(w, 'quiet', 'Something went wrong at a deadline and it was skipped. The Returning Officer has been told.');
    }
  }
  w.now = Math.max(w.now, t);
}
