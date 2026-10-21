// Bots: the other citizens take plausible turns so one person can play the whole game.
import { W, Id, chance, pick, rand, allCitizens, exiled, isMP, mps, inGovernment, sideOf, intrigueOpen, canSeeCard, weekNo, ghost, holderOf } from './core';
import { isGhostOk } from './streets';
import { RED_BOX } from './glory';
import { COMMANDS } from './index';
import { canVote, checkObjectives, leaderOfSide, supportFor } from './politics';
import { canVoteOn, KINDS } from './proposals';
import { CRISES } from './society';
import { MOODS } from './foreign';

const LINES = {
  for: ['This is a sensible step and I will vote for it.', 'My constituents asked for exactly this.', 'It costs little and does a lot of good.', 'We promised this at the election. Let us deliver it.'],
  against: ['Nothing in this says how it will be paid for.', 'This is rushed. The House should take more time.', 'I cannot support this as written.', 'Who actually benefits from this? Not the citizens.'],
  bills: [
    ['Market Day Bill', 'Saturday is market day across the realm.'],
    ['Harbour Lights Bill', 'The harbour lights stay lit every night of the year.'],
    ['Open Ledger Bill', 'The Treasury publishes every payment it makes, each week.'],
    ['Quiet Hours Bill', 'No campaigning in the chat between midnight and 7 in the morning.'],
    ['Lighthouse Bill', 'A lighthouse is built on the headland, paid for over two years.']
  ]
};

export function botsAct(world: W, you: Id, intensity = 1): W {
  const w = structuredClone(world);
  actBots(w, (id) => !!id && id !== you, intensity);
  return w;
}
// the same turns, in place, for whichever citizens `isBot` picks (the demo: everyone but you; induction: the practice bots)
export function actBots(w: W, isBot: (id: Id | null | undefined) => boolean, intensity = 1) {
  const go = (actor: Id, cmd: string, a: any = {}) => {
    if (ghost(w, actor) && !isGhostOk(cmd)) return false;
    try {
      COMMANDS[cmd](w, actor, a);
      checkObjectives(w, actor);
      return true;
    } catch {
      return false;
    }
  };
  const bots = allCitizens(w).filter((c: any) => isBot(c.id) && !exiled(w, c.id));
  const p = (x: number) => chance(w, Math.min(1, x * intensity));

  // the Founding Convention
  if (w.phase === 'convention') {
    w.convention.clauses.forEach((c: any) => {
      if (c.adopted !== null || !c.options.length) return;
      bots.forEach((b: any) => p(0.5) && c.votes[b.id] === undefined && go(b.id, 'convention.vote', { clause: c.id, option: chance(w, 0.7) ? (c.id === 'seats' || c.id === 'term' ? 1 : 0) : Math.floor(rand(w) * c.options.length) }));
    });
    return;
  }

  // elections: stand, then vote for your own party first, otherwise the best-liked candidate
  Object.values(w.elections).forEach((e: any) => {
    if (e.status !== 'open') return;
    bots.forEach((b: any) => {
      const leader = b.party && w.parties[b.party]?.leader === b.id;
      if (e.kind !== 'general' && (b.id === w.hos.holder || b.id === w.speaker)) return;
      if (!e.candidates[b.id] && !b.admin && (e.kind === 'general' ? leader || isMP(w, b.id) || p(0.12) : e.kind === 'speaker' ? p(0.05) : e.kind === 'hos' ? p(0.06) : p(0.15))) go(b.id, 'election.stand', { election: e.id });
    });
    const cands = Object.keys(e.candidates);
    if (!cands.length) return;
    bots.forEach((b: any) => {
      if (e.ballots[b.id] || !canVote(w, e, b.id) || !p(0.55)) return;
      const own = cands.filter((c) => w.citizens[c].party && w.citizens[c].party === b.party);
      const pool = own.length && chance(w, 0.85) ? own : cands;
      const order = pool.slice().sort((x, y) => w.citizens[y].approval + rand(w) * 30 - (w.citizens[x].approval + rand(w) * 30));
      const rest = cands.filter((c) => !order.includes(c)).sort(() => rand(w) - 0.5);
      const m = e.method || 'single';
      if (m === 'single') go(b.id, 'election.vote', { election: e.id, candidate: order[0] });
      else if (m === 'approval') go(b.id, 'election.vote', { election: e.id, approve: [...order.slice(0, 2), ...rest.slice(0, 1)] });
      else go(b.id, 'election.vote', { election: e.id, ranking: [...order, ...rest].slice(0, 3 + Math.floor(rand(w) * 3)) });
    });
  });

  // proposals: MPs follow their side, with the odd rebel; everyone votes in referendums
  Object.values(w.proposals).forEach((pr: any) => {
    if (pr.stage === 'debate' || pr.stage === 'vote') {
      bots.forEach((b: any) => {
        if (pr.speeches.length < 8 && (isMP(w, b.id) || p(0.3)) && p(0.08)) {
          const side = inGovernment(w, b.id) === inGovernment(w, pr.by) ? 'for' : 'against';
          go(b.id, 'prop.speak', { prop: pr.id, side, text: pick(w, LINES[side as 'for' | 'against']) });
        }
      });
    }
    if (pr.stage === 'vote' || pr.stage === 'override') {
      bots.forEach((b: any) => {
        if (!canVoteOn(w, pr, b.id) || !p(0.6)) return;
        const book = pr.stage === 'override' ? pr.overrideVotes || {} : pr.votes;
        if (book[b.id]) return;
        let v: string;
        if (pr.voters === 'all') v = chance(w, 0.55) ? 'aye' : 'no';
        else if (pr.kind === 'no_confidence') v = inGovernment(w, b.id) ? 'no' : 'aye';
        else if (pr.kind === 'confidence') v = inGovernment(w, b.id) ? 'aye' : 'no';
        else if (pr.kind === 'censure') v = inGovernment(w, pr.target) === inGovernment(w, b.id) ? 'no' : 'aye';
        else v = inGovernment(w, pr.by) === inGovernment(w, b.id) || pr.by === b.id ? 'aye' : chance(w, 0.25) ? 'aye' : 'no';
        if (chance(w, 0.08)) v = v === 'aye' ? 'no' : 'aye';
        go(b.id, 'prop.vote', { prop: pr.id, vote: v });
      });
    }
    if (pr.stage === 'assent' && w.hos.holder && isBot(w.hos.holder) && p(0.6)) go(w.hos.holder, 'prop.assent', { prop: pr.id, yes: chance(w, 0.92) });
    if (pr.stage === 'hos' && w.hos.holder && isBot(w.hos.holder) && p(0.6)) go(w.hos.holder, 'prop.dissolve', { prop: pr.id, yes: w.minority || chance(w, 0.4) });
  });
  // MPs vote on House crises
  Object.values(w.crises).forEach((c: any) => c.status === 'open' && c.house && w.seats.filter((m: string) => m && isBot(m) && c.votes[m] === undefined).forEach((m: string) => p(0.35) && go(m, 'crisis.vote', { id: c.id, choice: Math.floor(rand(w) * CRISES.find((x) => x.id === c.type)!.options.length) })));
  // an MP occasionally puts a bill forward
  mps(w).forEach((m) => {
    if (!isBot(m) || !p(0.03)) return;
    if (chance(w, 0.25)) {
      const [title, job, pay] = pick(w, [['Clean Parks Bill', 'Pick up litter in a park for 20 minutes', 5], ['Town Crier Bill', 'Read the week’s Gazette out to the group', 4], ['Welcome Committee Bill', 'Show a new citizen how the game works', 6]] as [string, string, number][]);
      if (!Object.values(w.proposals).some((x: any) => x.title === title)) go(m, 'prop.new', { kind: 'bill', title, summary: `Pays citizens to ${job.toLowerCase()}.`, clauses: [{ t: 'job', title: job, pay }] });
      return;
    }
    const [title, text] = pick(w, LINES.bills);
    if (Object.values(w.proposals).some((x: any) => x.title === title)) return;
    go(m, 'prop.new', { kind: 'bill', title, summary: text, clauses: [{ t: 'text', text }] });
  });

  // head of state
  const hos = w.hos.holder;
  if (hos && isBot(hos)) {
    if (!w.pm && p(0.5)) {
      const leaders = [...new Set([...Object.values(w.parties).filter((x: any) => x.status === 'active').map((x: any) => x.leader), ...mps(w)])].filter((x) => x && !w.citizens[x]?.admin && x !== hos) as Id[];
      const best = leaders.sort((a, b) => supportFor(w, b) - supportFor(w, a))[0];
      if (best) go(hos, 'gov.invite', { target: best });
    }
    const exiles = allCitizens(w).filter((c: any) => c.pardonAsked && exiled(w, c.id));
    exiles.forEach((c: any) => p(0.2) && go(hos, 'hos.pardon', { target: c.id }));
  }

  // the Prime Minister
  const pm = w.pm;
  if (pm && isBot(pm)) {
    const pool = allCitizens(w).filter((c: any) => !c.admin && c.id !== pm && c.id !== hos && !exiled(w, c.id) && inGovernment(w, c.id)).map((c: any) => c.id);
    Object.values(w.offices).forEach((o: any) => {
      if (o.fill === 'pm' && !o.holder && p(0.6)) {
        const promised = w.coalition?.promises?.[o.id];
        const free = pool.filter((x) => !Object.values(w.offices).some((y: any) => y.holder === x));
        const target = promised || pick(w, free.length ? free : pool);
        if (target) go(pm, 'gov.appoint', { office: o.id, target });
      }
    });
    w.questions.filter((q: any) => q.status === 'open' && q.to === 'pm' && q.backers.length >= 2).slice(0, 2).forEach((q: any) => p(0.3) && go(pm, 'q.answer', { id: q.id, text: pick(w, ['The government is getting on with the job.', 'I will write to the member with the details.', 'We have nothing to hide, and the figures will be published.']) }));
    Object.values(w.crises).forEach((c: any) => c.status === 'open' && !c.house && p(0.4) && go(pm, 'crisis.decide', { id: c.id, choice: Math.floor(rand(w) * CRISES.find((x) => x.id === c.type)!.options.length) }));
    if (w.confidence && p(0.3)) go(pm, 'prop.new', { kind: 'confidence' });
  }
  // formal questions get answered, sometimes
  w.questions.filter((q: any) => q.formal && q.status === 'open' && isBot(q.to)).forEach((q: any) => p(0.25) && go(q.to, 'q.answer', { id: q.id, text: 'I refer the committee to my earlier statement.' }));

  // coalitions and parties
  if (w.coalition?.status === 'draft') w.coalition.sides.forEach((s: string) => { const l = leaderOfSide(w, s); if (l && isBot(l) && p(0.5)) go(l, 'coalition.sign'); });
  Object.values(w.parties).forEach((pt: any) => {
    if (pt.status === 'forming') pt.invited.forEach((i: Id) => isBot(i) && p(0.6) && go(i, 'party.cosign', { party: pt.id }));
    pt.motions?.forEach((m: any) => m.status === 'open' && bots.forEach((b: any) => b.party === pt.id && !m.votes[b.id] && p(0.2) && go(b.id, 'party.motionVote', { motion: m.id, vote: chance(w, 0.6) ? 'for' : 'against' })));
  });

  // offices use their powers
  const fm = w.offices.foreign?.holder;
  if (fm && isBot(fm) && p(0.15)) go(fm, 'foreign.envoy', { nation: pick(w, Object.keys(w.nations)) });
  const dir = w.offices.security?.holder;
  if (dir && isBot(dir) && p(0.1)) go(dir, 'intel.request', { nation: pick(w, Object.keys(w.nations)), q: pick(w, ['plans', 'opinion', 'weak']) });
  const chair = w.offices.reserve?.holder;
  if (chair && isBot(chair) && w.economy.lastInflation > 5 && p(0.3)) go(chair, 'reserve.rate', { rate: Math.min(15, w.economy.rate + 1) });
  (w.offices.court?.members || []).forEach((j: Id) => isBot(j) && Object.values(w.cases).forEach((k: any) => k.status === 'open' && !k.votes[j] && p(0.3) && go(j, 'court.judge', { case: k.id, side: chance(w, 0.5) ? 'plaintiff' : 'defence' })));

  // everyday life: questions, the press, money
  bots.forEach((b: any) => {
    const open = w.questions.filter((q: any) => q.status === 'open' && !q.formal && q.by !== b.id && !q.backers.includes(b.id));
    if (open.length && p(0.08)) go(b.id, 'q.back', { id: (pick(w, open) as any).id });
    if (w.pm && !w.questions.some((q: any) => q.by === b.id && q.week === weekNo(w)) && p(0.01)) go(b.id, 'q.ask', { text: pick(w, ['Will the PM publish what the Treasury owes?', 'When will the Army get a law of its own?', 'Will the government cut the tariff?', 'Why was the crisis handled so slowly?']) });
    const stories = w.stories.filter((s: any) => s.status === 'published' && s.by !== b.id && !s.cheers.includes(b.id));
    if (stories.length && p(0.05)) go(b.id, 'press.cheer', { story: (pick(w, stories) as any).id });
    if (p(0.02)) go(b.id, 'venture.start', { nation: pick(w, Object.keys(w.nations).filter((n) => w.nations[n].mood >= 2)), amount: 10 + Math.floor(rand(w) * 30) });
    const banks = Object.values(w.banks).filter((x: any) => x.status === 'open');
    if (banks.length && p(0.02)) go(b.id, 'bank.deposit', { bank: (pick(w, banks) as any).id, amount: 10 });
  });
  Object.values(w.papers).forEach((pp: any) => isBot(pp.editor) && w.stories.filter((s: any) => s.paper === pp.id && s.status === 'submitted').forEach((s: any) => p(0.3) && go(pp.editor, 'press.edit', { story: s.id, yes: chance(w, 0.75) })));

  // the backroom answers back
  if (intrigueOpen(w)) {
    Object.values(w.deals).forEach((d: any) => d.status === 'offered' && isBot(d.to) && p(0.3) && go(d.to, 'deal.answer', { id: d.id, yes: chance(w, 0.55) }));
    Object.values(w.demands).forEach((d: any) => d.status === 'sent' && isBot(d.target) && p(0.3) && go(d.target, 'demand.answer', { id: d.id, how: chance(w, 0.5) ? 'comply' : 'expose' }));
    Object.values(w.plots).forEach((pl: any) => pl.status === 'planning' && Object.entries(pl.invited).forEach(([id, s]) => s === 'pending' && isBot(id) && p(0.3) && go(id, 'plot.answer', { plot: pl.id, join: chance(w, 0.55) })));
    bots.forEach((b: any) => {
      const mine = w.cards.filter((k: any) => canSeeCard(w, k, b.id) && k.about && k.about !== b.id);
      if (mine.length && p(0.01)) go(b.id, 'card.leak', { card: (pick(w, mine) as any).id, paper: pick(w, [null, ...Object.keys(w.papers)]) });
    });
  }

  // the Red Box and the betting pools
  bots.forEach((b: any) => {
    if (w.daily && w.daily.votes[b.id] === undefined && p(0.4)) go(b.id, 'daily.answer', { option: Math.floor(rand(w) * RED_BOX[w.daily.qi].a.length) });
    Object.values(w.markets || {}).forEach((m: any) => {
      if (m.status !== 'open' || m.bets[b.id] || !p(0.04)) return;
      const opts = m.kind === 'election' ? Object.keys(w.elections[m.ref]?.candidates || {}) : m.options.map((o: any) => o.key);
      if (opts.length) go(b.id, 'market.bet', { market: m.id, option: pick(w, opts), amount: 3 + Math.floor(rand(w) * 15) });
    });
  });
  // the Streets: bots only ever target other bots, and own up when they're got
  const inS = (id: Id) => !!w.citizens[id]?.streets?.in;
  bots.forEach((b: any) => {
    if (!inS(b.id) && !b.bot && p(0.01)) go(b.id, 'streets.join', { agree: true });
    if (!inS(b.id)) return;
    const prey = bots.filter((x: any) => x.id !== b.id && inS(x.id));
    if (intrigueOpen(w) && prey.length && p(0.008)) go(b.id, 'streets.contract', { target: (pick(w, prey) as any).id, crowns: 10 + Math.floor(rand(w) * 20) });
    const open = Object.values(w.bounties).filter((x: any) => x.status === 'open' && x.by !== b.id);
    if (open.length && p(0.04)) go(b.id, 'bounty.take', { id: (pick(w, open) as any).id });
    if (p(0.006)) go(b.id, 'bounty.post', { text: pick(w, ['Bring the Chancellor a meal deal', 'Draw the PM a portrait', 'Get a selfie with the Speaker', 'Write a song about the Treasury']), reward: 10 + Math.floor(rand(w) * 30) });
    if (p(0.004)) go(b.id, 'stall.open', { title: pick(w, ['Homework help, one subject', 'A hand-drawn campaign poster', 'Spare trading cards', 'A week of Gazette summaries']), price: 5 + Math.floor(rand(w) * 25) });
    const stalls = Object.values(w.stalls).filter((x: any) => x.status === 'open' && x.by !== b.id);
    if (stalls.length && p(0.015)) go(b.id, 'stall.buy', { id: (pick(w, stalls) as any).id });
  });
  // the Hunt: bots join, and own up when another bot gets them
  if (w.hunt?.status === 'signup') bots.forEach((b: any) => inS(b.id) && !w.hunt.entrants.includes(b.id) && p(0.3) && go(b.id, 'hunt.enter'));
  if (w.hunt?.status === 'running') Object.entries(w.hunt.ring).forEach(([hunter, prey]: any) => isBot(hunter) && isBot(prey) && w.hunt.status === 'running' && w.hunt.ring[hunter] === prey && p(0.05) && go(prey, 'streets.gotMe', { by: hunter }));
  bots.forEach((b: any) => (b.streak?.n || 0) >= 3 && !(b.streak?.freezes) && b.influence > 40 && p(0.02) && go(b.id, 'daily.freeze'));
  Object.values(w.streets?.contracts || {}).forEach((k: any) => {
    if (k.status === 'live' && isBot(k.by) && isBot(k.target) && p(0.08)) go(k.target, 'streets.gotMe', { by: k.by });
    if (k.status === 'claimed' && isBot(k.target) && p(0.4)) go(k.target, 'streets.answer', { contract: k.id, yes: chance(w, 0.7) });
  });
  Object.values(w.bounties || {}).forEach((x: any) => {
    if (x.status === 'taken' && isBot(x.taker) && p(0.2)) go(x.taker, 'bounty.done', { id: x.id, note: 'Done.' });
    if (x.status === 'done' && isBot(x.by) && p(0.3)) go(x.by, 'bounty.confirm', { id: x.id, yes: chance(w, 0.85) });
  });
  Object.values(w.orders || {}).forEach((o: any) => {
    if (o.status === 'paid' && isBot(o.seller) && p(0.3)) go(o.seller, 'stall.deliver', { order: o.id });
    if (o.status === 'delivered' && isBot(o.buyer) && p(0.3)) go(o.buyer, 'stall.receive', { order: o.id, stars: 3 + Math.floor(rand(w) * 3) });
  });
  const jobs = Object.values(w.jobs || {}).filter((j: any) => j.active);
  bots.forEach((b: any) => jobs.length && p(0.02) && go(b.id, 'job.claim', { job: (pick(w, jobs) as any).id, note: 'Did my bit.' }));
  const signer = holderOf(w, 'treasury') || w.pm;
  (w.jobClaims || []).forEach((c: any) => c.status === 'pending' && signer && isBot(signer) && signer !== c.by && p(0.3) && go(signer, 'job.approve', { claim: c.id, yes: chance(w, 0.8) }));
  (w.ultimatums || []).forEach((u: any) => u.status === 'sent' && w.pm && isBot(w.pm) && p(0.3) && go(w.pm, 'foreign.answer', { id: u.id, pay: chance(w, 0.5) }));
  return;
}
export { KINDS, MOODS, sideOf };
