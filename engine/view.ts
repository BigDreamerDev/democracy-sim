// What one citizen is allowed to see. The server sends only this; the full world never leaves it.
// Anything secret by the rules (ballots, other people's cards, deals, plots, ambitions, wallets) is stripped here.
import { W, Id, canSeeCard, hasPower, isPM } from './core';
const canSeeIntel = (w: W, id: Id) => hasPower(w, id, 'intel') || isPM(w, id);
const PRIVATE_COUNTS = ['sends', 'saves', 'ventures', 'betsWon', 'betCrowns', 'insider', 'maxBalance'];

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
    if (!involved && p.status === 'planning') delete w.plots[id];
    else if (!p.members.includes(me)) p.invited = { [me]: p.invited[me] };
  });
  if (!canSeeIntel(full, me)) w.intel = [];
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
  w.stories = w.stories.filter((s: any) => s.status === 'published' || s.by === me || full.papers[s.paper]?.editor === me);
  // the Red Box: your own answer and how many have answered today
  if (w.daily) {
    w.daily.answered = Object.keys(w.daily.votes).length;
    w.daily.votes = w.daily.votes[me] !== undefined ? { [me]: w.daily.votes[me] } : {};
  }
  // offices marked secret show only to their members
  Object.values(w.offices).forEach((o: any) => {
    if (o.secrecy === 'secret' && o.holder !== me && !o.members.includes(me)) {
      o.holder = null;
      o.members = [];
      o.powers = [];
      o.name = 'A classified office';
      o.title = 'Classified';
    }
  });
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
