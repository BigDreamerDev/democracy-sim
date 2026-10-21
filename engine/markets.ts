// The prediction market: bet crowns on bills, elections and crises. Pari-mutuel: everything staked on an
// outcome is pooled, and whoever backed the right answer splits the pool in proportion to their stake.
// Bets are private; the pools (and so the odds) are public. Insiders betting on what they know is allowed.
import { W, Id, DAY, fail, newId, nm, gazette, transfer, ca, bump, mustBeFree, addCard, allCitizens, pick } from './core';

export const MAX_STAKE = 100;
type Opt = { key: string; label: string };

export function openMarket(w: W, kind: 'prop' | 'election' | 'crisis', ref: Id, question: string, options: Opt[] | null, closesAt: number) {
  w.markets ??= {};
  const done = Object.values(w.markets).filter((m: any) => m.status !== 'open').sort((a: any, b: any) => a.at - b.at);
  done.slice(0, Math.max(0, done.length - 40)).forEach((m: any) => delete w.markets[m.id]);
  if (Object.values(w.markets).some((m: any) => m.kind === kind && m.ref === ref && m.status === 'open')) return;
  const id = newId(w, 'mk');
  w.markets[id] = { id, kind, ref, question, options: options || [], pools: {}, bets: {}, status: 'open', at: w.now, closesAt, outcome: null };
}
const label = (w: W, m: any, key: string) => m.options.find((o: Opt) => o.key === key)?.label ?? (m.kind === 'election' ? nm(w, key) : key);

export function bet(w: W, actor: Id, mid: Id, option: string, amount: number) {
  mustBeFree(w, actor);
  const m = w.markets?.[mid];
  if (!m || m.status !== 'open' || w.now >= m.closesAt) fail('Betting on that has closed.');
  const key = String(option || '');
  if (m.kind === 'election') {
    const e = w.elections[m.ref];
    if (!e?.candidates[key]) fail('Pick someone who is standing.');
  } else if (!m.options.some((o: Opt) => o.key === key)) fail('Pick one of the outcomes.');
  const amt = Math.round(Number(amount));
  if (!(amt >= 1)) fail('Bet at least 1 crown.');
  const mine = Object.values(m.bets[actor] || {}).reduce((s: number, v: any) => s + v, 0) as number;
  if (mine + amt > MAX_STAKE) fail(`You can stake at most ${MAX_STAKE} crowns on one market (${MAX_STAKE - mine} left).`);
  transfer(w, ca(actor), 'market', amt, `Bet: ${m.question}`);
  m.bets[actor] = { ...(m.bets[actor] || {}), [key]: (m.bets[actor]?.[key] || 0) + amt };
  m.pools[key] = (m.pools[key] || 0) + amt;
  if (m.kind === 'election' && !m.options.some((o: Opt) => o.key === key)) m.options.push({ key, label: nm(w, key) });
}

// called by the system the market is about, once the answer is known
// deciders: the people whose own choice settled it (MPs who voted that way, the PM who decided, the winning candidate).
// One of them who bet on it and made money leaves a secret card behind: insider trading.
export type Decider = { id: Id; did: string };
export function settleMarket(w: W, kind: string, ref: Id, outcome: string | null, deciders: Decider[] = []) {
  const m = Object.values(w.markets || {}).find((x: any) => x.kind === kind && x.ref === ref && x.status === 'open') as any;
  if (!m) return;
  const total = Object.values(m.pools).reduce((s: number, v: any) => s + v, 0) as number;
  const win = outcome ? m.pools[outcome] || 0 : 0;
  m.outcome = outcome;
  m.settledAt = w.now;
  if (!total) {
    m.status = 'settled';
    return;
  }
  if (!win) return voidMarket(w, m, outcome ? `nobody backed “${label(w, m, outcome)}”` : 'no result');
  m.status = 'settled';
  let paid = 0;
  const winners = Object.entries(m.bets).filter(([, b]: any) => b[outcome!]);
  winners.forEach(([id, b]: any) => {
    const n = Math.floor((b[outcome!] / win) * total);
    if (n > 0) {
      transfer(w, 'market', ca(id), n, `Won: ${m.question}`);
      paid += n;
    }
    bump(w, id, 'betsWon');
    bump(w, id, 'betCrowns', Math.max(0, n - b[outcome!]));
    const d = deciders.find((x) => x.id === id);
    if (d && n > b[outcome!]) insider(w, m, id, b[outcome!], n - b[outcome!], d.did, label(w, m, outcome!));
  });
  if (total - paid > 0) transfer(w, 'market', 'treasury', total - paid, 'Betting pool rounding');
  m.payout = paid;
  gazette(w, 'money', `Betting settled on “${m.question}”: ${label(w, m, outcome!)}. ${winners.length} backer${winners.length === 1 ? '' : 's'} share ${paid} crowns.`, '#/bets');
}
export function voidMarket(w: W, m: any, why: string) {
  m.status = 'void';
  m.why = why;
  m.settledAt = w.now;
  Object.entries(m.bets).forEach(([id, b]: any) => {
    const n = Object.values(b).reduce((s: number, v: any) => s + v, 0) as number;
    if (n > 0) transfer(w, 'market', ca(id), n, `Refunded: ${m.question}`);
  });
}
// a market nobody settled (the bill was withdrawn, the election never closed) refunds three days after it shut
export const marketDue = (m: any) => (m.status === 'open' ? m.closesAt + 3 * DAY : null);
export function staleMarket(w: W, m: any) {
  if (m.status === 'open') voidMarket(w, m, 'it never settled');
}
export function odds(m: any) {
  const total = Object.values(m.pools).reduce((s: number, v: any) => s + v, 0) as number;
  return { total, share: (k: string) => (total ? (m.pools[k] || 0) / total : 0), pays: (k: string) => (m.pools[k] ? total / m.pools[k] : null) };
}

// who notices: the Security Service if there is one, and a rival punter (or, failing that, someone at random)
function insider(w: W, m: any, id: Id, stake: number, profit: number, did: string, what: string) {
  bump(w, id, 'insider');
  const others = Object.keys(m.bets).filter((x) => x !== id && w.citizens[x] && !w.citizens[x].bot);
  const pool = others.length ? others : allCitizens(w).filter((c: any) => c.id !== id && !c.bot).map((c: any) => c.id);
  const viewers = [...(w.offices.security ? ['office:security'] : []), ...(pool.length ? ['cit:' + pick(w, pool)] : [])];
  if (!viewers.length) return;
  addCard(w, { title: `Insider trading: ${nm(w, id)} bet ${stake} crowns on “${what}” (${m.question}), then ${did}. They made ${profit} crowns.`, about: id, from: 'The betting pools', level: 'secret', viewers });
}
