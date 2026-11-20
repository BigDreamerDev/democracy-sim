// What one citizen is allowed to see. The server sends only this; the full world never leaves it.
// Anything secret by the rules (ballots, other people's cards, deals, plots, ambitions, wallets) is stripped here.
import { W, Id, canSeeCard, hasPower, isPM, holderOf } from './core';
import { crisisById } from './crises';
import { register } from './exchange';
import { known, shipping } from './foreign';
const canSeeIntel = (w: W, id: Id) => hasPower(w, id, 'intel') || isPM(w, id);
const PRIVATE_COUNTS = ['trades', 'sends', 'saves', 'ventures', 'betsWon', 'betCrowns', 'insider', 'maxBalance', 'underground', 'strikes', 'jailbreaks', 'informer'];

export function viewFor(full: W, me: Id): W {
  // copy everything except the induction snapshot (a whole world of its own, and never sent)
  const { induction, ...rest } = full;
  const w = structuredClone(rest) as W;
  if (induction) w.induction = { ...induction, snapshot: undefined };
  const mine = (id: Id) => id === me;
  // randomness must not leak, or draws could be predicted
  w.rng = 0;
  w.seed = 0;
  // secret ballots: who voted is public, how they voted is not (except your own)
  Object.values(w.elections).forEach((e: any) => {
    Object.keys(e.ballots).forEach((v) => !mine(v) && (e.ballots[v] = '•'));
    // how many ballots were cast or changed: with turnout, it would show when someone changed their vote
    delete e.moves;
    delete e.movesAtPoll;
    // pundit calls are sealed until the polls close, so nobody can copy the best forecasters
    if (e.status === 'open') Object.keys(e.predictions || {}).forEach((v) => !mine(v) && (e.predictions[v] = '•'));
  });
  Object.values(w.proposals).forEach((p: any) => {
    if (p.voters === 'all') Object.keys(p.votes).forEach((v) => !mine(v) && (p.votes[v] = '•'));
  });
  // people: your own private details only
  Object.values(w.citizens).forEach((c: any) => {
    if (mine(c.id)) return;
    c.ambition = null;
    c.objectives = [];
    c.week = {};
    c.log = [];
    c.pardonAsked = c.pardonAsked && false;
    // real-life codes: whoever has yours can tag you or check in with you
    c.tagCode = null;
    c.meetCode = null;
    c.sweptAt = null;
    c.letterDay = null;
    // private counters: money sent and saved, ventures, bets, insider trades, income, highest balance
    c.weekIncome = 0;
    c.lastWeekIncome = 0;
    [c.stats, c.life].forEach((s: any) => s && PRIVATE_COUNTS.forEach((k) => delete s[k]));
  });
  // money: other citizens' balances and statements are private; public accounts stay visible
  Object.keys(w.accounts).forEach((k) => k.startsWith('c:') && k !== 'c:' + me && delete w.accounts[k]);
  w.ledger = w.ledger.filter((l: any) => (!l.from.startsWith('c:') && !l.to.startsWith('c:')) || l.from === 'c:' + me || l.to === 'c:' + me || l.memo.startsWith('Lobbying') || l.memo.startsWith('Grant') || l.memo.startsWith('Fined') || l.memo.startsWith('Wage'));
  Object.values(w.banks).forEach((b: any) => {
    b.owedTotal = Object.values(b.deposits).reduce((s: number, v: any) => s + v, 0);
    if (b.owner !== me) b.deposits = { [me]: b.deposits[me] || 0 };
    b.loans = b.owner === me ? b.loans : b.loans.filter((l: any) => l.who === me);
  });
  // your own ventures, without the result that's already decided while the ship is at sea
  w.ventures = w.ventures.filter((v: any) => mine(v.by)).map((v: any) => (v.status === 'out' ? { ...v, r: null } : v));
  // the backroom
  // a leak that wasn't named in the press stays anonymous: only the leaker sees leakedBy
  w.cards = full.cards.filter((k: any) => canSeeCard(full, k, me) || k.state === 'leaked').map((k: any) => {
    const c = canSeeCard(full, k, me) ? { ...k } : { ...k, viewers: [] };
    if (c.leakedBy !== me) delete c.leakedBy;
    if (c.burnedBy !== me) delete c.burnedBy;
    return c;
  });
  Object.keys(w.deals).forEach((id) => {
    const d = w.deals[id];
    if (d.from !== me && d.to !== me && d.status !== 'exposed') delete w.deals[id];
  });
  Object.keys(w.demands).forEach((id) => {
    const d = w.demands[id];
    if (d.from !== me && d.target !== me) delete w.demands[id];
  });
  Object.keys(w.plots).forEach((id) => {
    const p = w.plots[id];
    const involved = p.members.includes(me) || p.invited[me];
    // the head of the Security Service sees a plot they have an informer inside
    const watching = p.status === 'planning' && (p.informers || []).length > 0 && (holderOf(full, 'security') || full.pm) === me;
    if (!involved && !watching && p.status === 'planning') delete w.plots[id];
    else if (!p.members.includes(me)) p.invited = { [me]: p.invited[me] };
    // who is informing is known to the informers themselves and to whoever they report to
    if (w.plots[id]) {
      p.informed = watching || (p.informers || []).includes(me);
      if (!p.informed) p.informers = [];
      if (!p.members.includes(me) && !watching) (p.paid = {}), (p.asked = {});
    }
  });
  // Security Service investigations: the asker's own
  w.probes = (w.probes || []).filter((x: any) => x.by === me);
  // a regime: its public face, minus who is striking, what the secret police know, the rigging, and open votes
  const rg = w.regime;
  if (rg) {
    const inside = rg.leader === me || rg.council.includes(me);
    rg.strikeN = rg.strike.length;
    rg.strike = rg.strike.includes(me) ? [me] : [];
    if (rg.police !== me && rg.leader !== me) rg.probes = [];
    if (!inside && rg.police !== me && rg.rigged) rg.rigged = { election: null, at: rg.rigged.at, done: rg.rigged.done };
    rg.breaks = Object.fromEntries(Object.entries(rg.breaks).filter(([, l]: any) => l.includes(me)));
    rg.lastBlow = null;
    if (rg.trial) (rg.trial.cast = Object.keys(rg.trial.votes).length), (rg.trial.votes = rg.trial.votes[me] !== undefined ? { [me]: rg.trial.votes[me] } : {});
    if (rg.plebiscite) (rg.plebiscite.cast = Object.keys(rg.plebiscite.votes).length), (rg.plebiscite.votes = rg.plebiscite.votes[me] !== undefined ? { [me]: rg.plebiscite.votes[me] } : {});
    if (rg.ouster) rg.ouster = rg.ouster.votes.includes(me) ? { by: rg.ouster.by, votes: [me] } : null;
    rg.freeVotes = rg.freeVotes.includes(me) ? [me] : [];
    if (!inside) rg.pending = rg.pending ? { id: rg.pending.id, kind: rg.pending.kind, dueAt: rg.pending.dueAt, votes: {} } : null;
  }
  // the fallen regime's files stay shut until the provisional government opens them
  if (w.transition) w.transition.fallen.files = null;
  if (w.reckoningDue) w.reckoningDue.files = null;
  // an unsigned pamphlet stays unsigned, unless its author was found out
  w.stories.forEach((s: any) => s.underground && !s.named && s.by !== me && (s.by = null));
  if (!canSeeIntel(full, me)) w.intel = [];
  // a breakaway being plotted is known only to its founder and whoever they asked
  Object.keys(w.breakaways || {}).forEach((id) => {
    const b = w.breakaways[id];
    if (b.status === 'launched' || b.by === me || b.invited.includes(me)) return;
    delete w.breakaways[id];
  });
  // a pledge on offer (or turned down) is between the two of them; agreed, it's public
  Object.keys(w.pledges || {}).forEach((id) => {
    const pl = w.pledges[id];
    if (['offered', 'declined'].includes(pl.status) && pl.a !== me && pl.b !== me) delete w.pledges[id];
  });
  // drafts: the author's own, and ones you're invited to co-sponsor (without who else turned it down)
  Object.keys(w.drafts || {}).forEach((id) => {
    const d = w.drafts[id];
    if (d.by === me) return;
    if (!d.sponsors[me]) return void delete w.drafts[id];
    d.rev = 0;
    Object.keys(d.sponsors).forEach((k) => k !== me && d.sponsors[k].status === 'no' && delete d.sponsors[k]);
  });
  // the Streets: a contract is known only to whoever took it out, until it's claimed (then the target sees it)
  // or it's over and in the Gazette. Who the bodyguard covers is known to the two of them. Check-ins: your own.
  if (w.streets) {
    Object.keys(w.streets.contracts).forEach((id) => {
      const k = w.streets.contracts[id];
      if (k.by === me || ['done', 'foiled'].includes(k.status)) return;
      if (k.target === me && k.status === 'claimed') return;
      delete w.streets.contracts[id];
    });
    if (w.streets.protect && w.streets.protect.by !== me && w.streets.protect.who !== me) w.streets.protect = null;
    w.streets.meets = w.streets.meets.filter((m: any) => m.a === me || m.b === me);
  }
  // the Hunt: you know who you're hunting, not who's hunting you
  // alive is kept in ring order, which would give the whole ring away: send it sorted
  if (w.hunt?.ring) w.hunt.ring = w.hunt.ring[me] ? { [me]: w.hunt.ring[me] } : {};
  if (w.hunt?.alive) w.hunt.alive = w.hunt.alive.slice().sort();
  // market orders are between buyer and seller; bets are private (the pools, and so the odds, are public)
  Object.keys(w.orders || {}).forEach((id) => {
    const o = w.orders[id];
    if (o.buyer !== me && o.seller !== me) delete w.orders[id];
  });
  Object.values(w.markets || {}).forEach((m: any) => {
    m.backers = Object.keys(m.bets).length;
    m.bets = m.bets[me] ? { [me]: m.bets[me] } : {};
  });
  // stall ratings are keyed by buyer: anonymise them for everyone but the stallholder
  Object.values(w.stalls || {}).forEach((s: any) => {
    if (s.by !== me && s.ratings) s.ratings = Object.fromEntries(Object.entries(s.ratings).map(([k, v], i) => [k === me ? me : 'r' + i, v]));
  });
  // stories waiting for the editor, or spiked, are for the writer and the editor only
  w.stories = w.stories.filter((s: any) => s.status === 'published' || s.by === me || full.papers[s.paper]?.editor === me || (s.status === 'held' && !!full.regime && (full.regime.leader === me || full.regime.council.includes(me))));
  // the Red Box: your own answer and how many have answered today
  if (w.daily) {
    w.daily.answered = Object.keys(w.daily.votes).length;
    w.daily.votes = w.daily.votes[me] !== undefined ? { [me]: w.daily.votes[me] } : {};
  }
  // the Exchange: your own portfolio; MPs', ministers' and the head of state's holdings are on the public Register of Interests
  if (w.exchange) {
    w.exchange.register = register(full);
    // the wealth fund's holdings are public; so is nobody else's trading record but your own
    w.exchange.holdings = { ...(w.exchange.holdings[me] ? { [me]: w.exchange.holdings[me] } : {}), ...(w.exchange.holdings.treasury ? { treasury: w.exchange.holdings.treasury } : {}), ...(w.exchange.holdings.warchest ? { warchest: w.exchange.holdings.warchest } : {}) };
    w.exchange.trades = (w.exchange.trades || []).filter((t: any) => t.id === me);
  }
  // war bonds: your own, and the total
  if (w.army?.campaign) w.army.campaign.bonds = w.army.campaign.bonds[me] ? { [me]: w.army.campaign.bonds[me] } : {};
  // fog of war: a nation's army strength is known only through an embassy, a recent intelligence report, or a war
  Object.values(w.nations).forEach((n: any) => {
    // a defector living there knows its army
    if (!known(full, n.id) && full.citizens[me]?.defected?.nation !== n.id) n.power = null;
    // what a nation means to do next is known only through a spy ring, and only to the PM and the Director (by card)
    delete n.intent;
    if (!canSeeIntel(full, me)) n.ring = null;
  });
  // life abroad: secrets carried and cooldowns are the defector's own; moles, approaches and foreign rings are secret
  Object.values(w.citizens).forEach((c: any) => {
    if (c.id !== me) {
      if (c.defected) c.defected = { ...c.defected, secrets: (c.defected.secrets || []).map(() => '•'), last: {}, turnOffer: null, suspected: false, deeds: (c.defected.deeds || []).filter((x: any) => !x.secret), plant: canSeeIntel(full, me) ? c.defected.plant ?? null : null };
      delete c.agentOf; delete c.agentSince; delete c.handler; delete c.formerAgentOf; delete c.formerUntil;
    }
  });
  Object.values(w.nations).forEach((n: any) => delete n.mole);
  if (w.approaches) Object.keys(w.approaches).forEach((id) => { const a = w.approaches[id]; if (a.to !== me && a.by !== me) delete w.approaches[id]; });
  w.sweeps = (w.sweeps || []).filter((s: any) => s.by === me);
  // plants: the offer is between the Service and the citizen asked; the operations log is the PM's and the Director's
  if (w.plants) Object.keys(w.plants).forEach((id) => { const p = w.plants[id]; if (p.to !== me && !canSeeIntel(full, me)) delete w.plants[id]; });
  if (!canSeeIntel(full, me)) w.ops = [];
  // letters to the editor: printed ones are public; a waiting or declined one only to its writer and the paper's editor
  (w.stories || []).forEach((st: any) => st.letters && (st.letters = st.letters.filter((l: any) => l.status === 'printed' || l.by === me || full.papers?.[st.paper]?.editor === me)));
  // defaced posters: what was written is public; who wrote it only if they were caught (or it was you)
  Object.values(w.defaced || {}).forEach((list: any) => list.forEach((x: any) => { if (x.by !== me && !x.caught) x.by = null; }));
  // trials: how each judge voted is secret until the verdict; your own vote is yours
  Object.values(w.trials || {}).forEach((t: any) => t.status === 'open' && (t.votes = t.votes[me] ? { [me]: t.votes[me] } : {}));
  // shareholder votes: your own, and the running totals
  (w.exchange?.motions || []).forEach((m: any) => { m.tally = { yes: Object.values(m.votes).filter((v: any) => v.yes).reduce((s: number, v: any) => s + v.n, 0), no: Object.values(m.votes).filter((v: any) => !v.yes).reduce((s: number, v: any) => s + v.n, 0) }; m.votes = m.votes[me] ? { [me]: m.votes[me] } : {}; });
  // ships at sea to each nation are public; whose ventures they are is not (ventures are stripped above)
  w.shipping = shipping(full);
  // Treasury bonds: what each citizen holds is their own business; the issue and the total stay public
  if (w.bonds) w.bonds.holdings = (w.bonds.holdings || []).filter((h: any) => h.owner === me);
  // crises: the title, text and options, so players' apps can show them by name (all public on the crisis page)
  Object.values(w.crises || {}).forEach((c: any) => { const t = crisisById(c.type); if (t) Object.assign(c, { title: t.title, text: t.text, extreme: !!t.extreme, options: t.options.map((o) => ({ label: o.label, what: o.what, effects: o.effects })) }); });
  // crises: a bribe is seen by the one who offered it and by the PM, until it comes out
  Object.values(w.crises || {}).forEach((c: any) => { if (!c.bribes) return; Object.keys(c.bribes).forEach((id) => { if (id !== me && full.pm !== me && !c.bribes[id].exposed) delete c.bribes[id]; }); });
  // the crisis record: others see a cash-in or a hidden bribe only as keeping quiet
  Object.values(w.citizens).forEach((p: any) => { if (p.id !== me && p.crisisLog) p.crisisLog = p.crisisLog.map((e: any) => (e.secret ? { ...e, move: 'none', outcome: 'kept their head down' } : e)).map(({ secret, ...e }: any) => e); });
  // crises: a cash-in is private until it comes out
  Object.values(w.crises || {}).forEach((c: any) => Object.keys(c.responses || {}).forEach((id) => { const r = c.responses[id]; if (r.move === 'cashin' && id !== me && !r.exposed) c.responses[id] = { move: 'quiet', at: r.at }; }));
  // offices marked secret show only to their members
  Object.values(w.offices).forEach((o: any) => {
    if (o.secrecy === 'secret' && o.holder !== me && !o.members.includes(me)) {
      o.holder = null;
      o.members = [];
      o.powers = [];
      o.name = 'A classified office';
      o.title = 'Classified';
      o.nominee = null;
    }
  });
  // questions held for the Prime Minister's approval (Press and Information Act): the asker and the PM only
  w.questions = w.questions.filter((q: any) => !['held', 'refused'].includes(q.status) || q.by === me || full.pm === me || hasPower(full, me, 'govern'));
  // the Protection Act's record of who was last PM is internal
  w.lastPM = null;
  // the Returning Officer sees the sign-up queue; nobody else needs it
  if (!full.citizens[me]?.admin) {
    w.pending = [];
    w.clockErrors = [];
  }
  // the admin log is public on purpose: the Returning Officer plays too, so everyone can see what they did
  if (full.citizens[me]?.admin) w.audit = { total: Object.values(full.accounts).reduce((s: number, v: any) => s + v, 0) };
  w.viewer = me;
  return w;
}
