// The public face of the engine: every player action is a named command. run() applies one to a copy of the world.
import { W, Id, fail, cit, nm, gazette, isPM, holderOf, hasPower, adminDid } from './core';
import * as P from './politics';
import * as L from './proposals';
import * as E from './economy';
import * as F from './foreign';
import * as B from './backroom';
import * as S from './society';
import * as O from './offices';
import { advanceTo } from './clock';

export * from './core';
export { createWorld, createLiveWorld, NAMES } from './world';
export { viewFor } from './view';
export { migrate } from './migrate';
export { CATALOG } from './catalog';
export { needs } from './alerts';
export type { Alert } from './alerts';
export { advanceTo, nextDeadline, upcoming } from './clock';

type Cmd = (w: W, me: Id, a: any) => any;
export const COMMANDS: Record<string, Cmd> = {
  'convention.vote': (w, me, a) => P.conventionVote(w, me, a.clause, a.option),
  'election.stand': (w, me, a) => P.stand(w, me, a.election),
  'election.withdraw': (w, me, a) => P.withdraw(w, me, a.election),
  'election.vote': (w, me, a) => P.castBallot(w, me, a.election, a.candidate),
  'party.found': (w, me, a) => P.foundParty(w, me, a.name, a.colour, a.cofounders),
  'party.cosign': (w, me, a) => P.cosign(w, me, a.party),
  'party.join': (w, me, a) => P.joinParty(w, me, a.party),
  'party.motion': (w, me, a) => P.partyMotion(w, me, a.text),
  'party.motionVote': (w, me, a) => P.partyMotionVote(w, me, a.motion, a.vote),
  'party.challenge': (w, me, a) => P.challengeLeader(w, me, a.backers),
  'gov.invite': (w, me, a) => P.invitePM(w, me, a.target),
  'gov.resign': (w, me) => P.resignPM(w, me),
  'gov.appoint': (w, me, a) => O.appoint(w, me, a.office, a.target),
  'gov.shadow': (w, me, a) => P.setShadow(w, me, a.post, a.target),
  'coalition.propose': (w, me, a) => P.proposeCoalition(w, me, a.partners, a.kind, a.terms),
  'coalition.sign': (w, me) => P.signCoalition(w, me),
  'coalition.leave': (w, me) => P.leaveCoalition(w, me),
  'coalition.promise': (w, me, a) => P.promisePost(w, me, a.office, a.target),
  'hos.honour': (w, me, a) => P.honour(w, me, a.target, a.title),
  'hos.title': (w, me, a) => {
    if (w.hos.holder !== me || w.config.hos !== 'monarchy') fail('Only the Monarch picks their title.');
    w.config.hosTitle = a.title === 'King' ? 'King' : 'Queen';
  },
  'prop.new': (w, me, a) => L.propose(w, me, a),
  'prop.speak': (w, me, a) => L.speak(w, me, a.prop, a.side, a.text),
  'prop.vote': (w, me, a) => L.vote(w, me, a.prop, a.vote),
  'prop.casting': (w, me, a) => L.casting(w, me, a.prop, a.vote),
  'prop.assent': (w, me, a) => L.assent(w, me, a.prop, a.yes),
  'prop.dissolve': (w, me, a) => L.answerDissolution(w, me, a.prop, a.yes),
  'prop.block': (w, me, a) => L.block(w, me, a.prop),
  'prop.lobby': (w, me, a) => L.lobby(w, me, a.prop, a.mp, a.amount),
  'q.ask': (w, me, a) => L.ask(w, me, a.text, a.to),
  'q.back': (w, me, a) => L.back(w, me, a.id),
  'q.answer': (w, me, a) => L.answer(w, me, a.id, a.text),
  'office.grant': (w, me, a) => O.useGrant(w, me, a.office, a.target, a.amount, a.reason),
  'office.fine': (w, me, a) => O.useFine(w, me, a.office, a.target, a.amount, a.reason),
  'money.send': (w, me, a) => E.send(w, me, a.to, a.amount, a.note),
  'reserve.rate': (w, me, a) => E.setRate(w, me, a.rate),
  'bank.open': (w, me, a) => E.openBank(w, me, a.name, a.saveRate, a.loanRate),
  'bank.deposit': (w, me, a) => E.deposit(w, me, a.bank, a.amount),
  'bank.withdraw': (w, me, a) => E.withdraw(w, me, a.bank, a.amount),
  'bank.borrow': (w, me, a) => E.borrowFrom(w, me, a.bank, a.amount, a.weeks),
  'venture.start': (w, me, a) => E.startVenture(w, me, a.nation, a.amount),
  'foreign.envoy': (w, me, a) => F.sendEnvoy(w, me, a.nation),
  'foreign.propose': (w, me, a) => F.proposeTreaty(w, me, a.nation, a.kind),
  'intel.request': (w, me, a) => F.requestIntel(w, me, a.nation, a.q),
  'army.readiness': (w, me, a) => F.setReadiness(w, me, a.level),
  'deal.offer': (w, me, a) => B.offerDeal(w, me, a.to, a.text),
  'deal.answer': (w, me, a) => B.answerDeal(w, me, a.id, a.yes),
  'deal.expose': (w, me, a) => B.exposeDeal(w, me, a.id),
  'card.leak': (w, me, a) => B.leakCard(w, me, a.card, a.paper || null),
  'card.use': (w, me, a) => B.useCard(w, me, a.card, a.ask),
  'card.burn': (w, me, a) => B.burnCard(w, me, a.card),
  'demand.answer': (w, me, a) => B.answerDemand(w, me, a.id, a.how),
  'plot.start': (w, me, a) => B.startPlot(w, me, a.name),
  'plot.invite': (w, me, a) => B.invitePlot(w, me, a.plot, a.target),
  'plot.answer': (w, me, a) => B.answerPlot(w, me, a.plot, a.join),
  'plot.launch': (w, me, a) => B.launchCoup(w, me, a.plot),
  'plot.abandon': (w, me, a) => B.abandonPlot(w, me, a.plot),
  'exile.asylum': (w, me, a) => B.seekAsylum(w, me, a.nation),
  'exile.pardonRequest': (w, me) => B.askPardon(w, me),
  'hos.pardon': (w, me, a) => B.pardon(w, me, a.target),
  'press.found': (w, me, a) => S.foundPaper(w, me, a.name),
  'press.follow': (w, me, a) => S.follow(w, me, a.paper),
  'press.submit': (w, me, a) => S.submitStory(w, me, a.paper, a.headline, a.body),
  'press.edit': (w, me, a) => S.editStory(w, me, a.story, a.yes),
  'press.cheer': (w, me, a) => S.cheer(w, me, a.story),
  'court.file': (w, me, a) => S.fileCase(w, me, a.question, a.against, a.lawRef, a.argument),
  'court.defend': (w, me, a) => S.defendCase(w, me, a.case, a.text),
  'court.judge': (w, me, a) => S.judge(w, me, a.case, a.side),
  'crisis.decide': (w, me, a) => S.decideCrisis(w, me, a.id, a.choice),
  'admin.forceEnact': (w, me, a) => L.forceEnact(w, me, a.prop, a.reason),
  'admin.approve': (w, me, a) => {
    if (!w.citizens[me]?.admin) fail('Only the Returning Officer approves sign-ups.');
    const p = w.pending.find((x: any) => x.id === a.id);
    if (!p) fail('Nobody by that name is waiting.');
    w.pending = w.pending.filter((x: any) => x.id !== a.id);
    if (a.approve) {
      const id = p.uid || p.name.toLowerCase().replace(/[^a-z]/g, '') + w.nextId;
      w.citizens[id] = { id, name: p.name, party: null, admin: false, active: true, joinedAt: w.now, influence: 10, seasonEarned: 0, approval: 50, log: [], stamps: [], titles: [], censures: 0, stats: {}, whip: { loyal: 0, rebel: 0 }, week: {}, objectives: [], exiledUntil: null, asylum: null, ambition: null, weekIncome: 0 };
      w.accounts.reserve -= 100;
      w.accounts['c:' + id] = 100;
      gazette(w, 'quiet', `${p.name} becomes a citizen.`);
    }
    adminDid(w, me, `${a.approve ? 'approved' : 'turned down'} ${p.name}'s application for citizenship`);
  },
  'admin.setting': (w, me, a) => {
    if (!w.citizens[me]?.admin) fail('Only the Returning Officer changes settings.');
    if (!['requireApproval', 'openSignup'].includes(a.key)) fail('Unknown setting.');
    w.flags[a.key] = !!a.value;
    adminDid(w, me, a.key === 'openSignup' ? `${a.value ? 'opened' : 'closed'} the sign-up page` : `${a.value ? 'now requires' : 'no longer requires'} approval for new accounts`);
  },
  'admin.crisis': (w, me, a) => {
    if (!w.citizens[me]?.admin) fail('Only the Returning Officer starts a crisis.');
    const id = S.spawnCrisis(w, a.type || undefined);
    adminDid(w, me, `started a crisis: ${S.CRISES.find((c) => c.id === w.crises[id].type)!.title}`, '#/crisis/' + id);
  },
  'admin.calendar': (w, me, a) => {
    if (!w.citizens[me]?.admin) fail('Only the Returning Officer changes the calendar.');
    const e = w.calendar[a.key];
    if (!e) fail('Unknown event.');
    const dow = Number(a.dow), hour = Number(a.hour);
    if (!(dow >= 0 && dow <= 6) || !(hour >= 0 && hour <= 23)) fail('Pick a day and an hour.');
    // the week already in progress is kept: the change applies from the next occurrence
    w.lastEvent[a.key] = w.now;
    w.calendar[a.key] = { dow, hour };
    adminDid(w, me, `moved ${a.key === 'payday' ? 'payday' : a.key === 'pmqs' ? "PM's Questions" : 'the front page'} to ${['Sundays', 'Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays'][dow]} at ${String(hour).padStart(2, '0')}:00`, '#/calendar');
  }
};

export function run(world: W, actor: Id, cmd: string, args: any = {}): W {
  const f = COMMANDS[cmd];
  if (!f) fail('Unknown action.');
  checkArgs(args);
  const w = structuredClone(world);
  cit(w, actor);
  f(w, actor, args || {});
  P.checkObjectives(w, actor);
  Object.keys(w.citizens).forEach((id) => P.checkObjectives(w, id));
  return w;
}
// anything can arrive from a third-party app: plain JSON only, short strings, shallow
function checkArgs(a: any, depth = 0) {
  if (depth > 4) fail('That request is nested too deeply.');
  if (a === null || typeof a === 'boolean') return;
  if (typeof a === 'number') return Number.isFinite(a) || fail('Numbers must be finite.');
  if (typeof a === 'string') return a.length <= 4000 || fail('That text is too long (4000 characters at most).');
  if (Array.isArray(a)) return a.length <= 50 ? a.forEach((x) => checkArgs(x, depth + 1)) : fail('That list is too long.');
  if (typeof a === 'object') {
    const ks = Object.keys(a);
    if (ks.length > 30) fail('Too many fields.');
    ks.forEach((k) => (k === '__proto__' || k === 'constructor' || k === 'prototype' ? fail('Bad field name.') : checkArgs(a[k], depth + 1)));
    return;
  }
  fail('Unsupported value.');
}
export function skip(world: W, ms: number): W {
  const w = structuredClone(world);
  advanceTo(w, w.now + ms);
  return w;
}
export const nameOf = nm;
