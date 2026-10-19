// What one citizen is allowed to see. The server sends only this; the full world never leaves it.
// Anything secret by the rules (ballots, other people's cards, deals, plots, ambitions, wallets) is stripped here.
import { W, Id, canSeeCard, hasPower, isPM } from './core';
const canSeeIntel = (w: W, id: Id) => hasPower(w, id, 'intel') || isPM(w, id);

export function viewFor(full: W, me: Id): W {
  const w = structuredClone(full);
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
  });
  // money: other citizens' balances and statements are private; public accounts stay visible
  Object.keys(w.accounts).forEach((k) => k.startsWith('c:') && k !== 'c:' + me && delete w.accounts[k]);
  w.ledger = w.ledger.filter((l: any) => (!l.from.startsWith('c:') && !l.to.startsWith('c:')) || l.from === 'c:' + me || l.to === 'c:' + me || l.memo.startsWith('Lobbying') || l.memo.startsWith('Grant') || l.memo.startsWith('Fined'));
  Object.values(w.banks).forEach((b: any) => {
    b.owedTotal = Object.values(b.deposits).reduce((s: number, v: any) => s + v, 0);
    if (b.owner !== me) b.deposits = { [me]: b.deposits[me] || 0 };
    b.loans = b.owner === me ? b.loans : b.loans.filter((l: any) => l.who === me);
  });
  w.ventures = w.ventures.filter((v: any) => mine(v.by));
  // the backroom
  w.cards = full.cards.filter((k: any) => canSeeCard(full, k, me) || k.state === 'leaked').map((k: any) => (canSeeCard(full, k, me) ? k : { ...k, viewers: [] }));
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
  if (!full.citizens[me]?.admin) w.pending = [];
  w.adminLog = full.citizens[me]?.admin ? w.adminLog : [];
  if (full.citizens[me]?.admin) w.audit = { total: Object.values(full.accounts).reduce((s: number, v: any) => s + v, 0) };
  w.viewer = me;
  return w;
}
