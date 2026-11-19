// The Exchange: ten listed companies whose share prices move every three hours with the state of the realm and
// the world: stability and prosperity at home, each foreign company's nation (mood, sanctions, embargo, war),
// arms makers on war, the bank on the Reserve's rate. Citizens buy and sell at the posted price.
// Money: buying pays the 'exchange' account, plus stamp duty to the Treasury; selling and dividends are paid from
// it. When it runs short it draws on the Reserve (new money, which feeds inflation); its surplus goes back each payday.
// Holdings are private (view.ts), except the Register of Interests: what MPs, ministers and the head of state own.
import { W, Id, DAY, HOUR, fail, rand, chance, nm, gazette, transfer, bal, ca, hasPower, isPM, holderOf, clamp, mustBeFree, int, bump, inGov, isMP, addCard, fmtTime } from './core';
import { atWar, conflictOf } from './foreign';

export type Company = { sym: string; name: string; sector: string; nation: string | null; base: number; yield: number; about: string };
export const COMPANIES: Company[] = [
  { sym: 'NGR', name: 'Northgate Rail', sector: 'Railways', nation: null, base: 8, yield: 1, about: 'The realm’s railways. Rises when the country is stable.' },
  { sym: 'CMB', name: 'Crown Mint Bank', sector: 'Banking', nation: null, base: 12, yield: 1.2, about: 'The oldest bank in the realm. Likes a high interest rate, hates inflation.' },
  { sym: 'IRF', name: 'Ironfoot Armaments', sector: 'Arms', nation: null, base: 6, yield: 0.6, about: 'Rifles and cannon. War, mobilisation and wars abroad are good for business.' },
  { sym: 'HSC', name: 'Hearth & Salt Co-op', sector: 'Food', nation: null, base: 4, yield: 1.5, about: 'Bread and groceries. Steady, follows prosperity.' },
  { sym: 'VGC', name: 'Varnholm Grain Company', sector: 'Grain', nation: 'varnholm', base: 5, yield: 1, about: 'Imports Varnholm grain.' },
  { sym: 'KRS', name: 'Kessmark River Shipping', sector: 'Shipping', nation: 'kessmark', base: 7, yield: 0.8, about: 'Barges on the great river through Kessmark.' },
  { sym: 'OFI', name: 'Orrin Fisheries', sector: 'Fishing', nation: 'orrin', base: 3, yield: 1.3, about: 'The fleets of the Orrin Isles.' },
  { sym: 'TLM', name: 'Tessaly Looms', sector: 'Textiles', nation: 'tessaly', base: 6, yield: 0.9, about: 'Mills in the Commonwealth of Tessaly.' },
  { sym: 'AUT', name: 'Aurel Trust', sector: 'Finance', nation: 'aurel', base: 18, yield: 0.7, about: 'The great bank of the Free City. Hates wars anywhere.' },
  { sym: 'DSF', name: 'Drakmoor Steel Foundries', sector: 'Steel', nation: 'drakmoor', base: 9, yield: 0.8, about: 'Foundries of the Hegemony. Profits from rearmament.' }
];
export const company = (sym: string) => COMPANIES.find((c) => c.sym === sym);
export const TICK = 3 * HOUR;
export const MAX_HOLD = 1000;
export const FLOAT = 500;
const HIST = 56; // a week of three-hour ticks

export function exchange(w: W) {
  if (!w.exchange) {
    const prices: any = {};
    COMPANIES.forEach((c) => (prices[c.sym] = { p: c.base, open: c.base, hist: [c.base] }));
    w.exchange = { prices, index: [100], holdings: {}, nextAt: w.now + TICK, haltedUntil: null, haltBy: null, duty: 1, drawn: 0, dayOpen: 100, day: Math.floor(w.now / DAY), volume: 0 };
  }
  // a company added to the list later gets its opening price
  COMPANIES.forEach((c) => (w.exchange.prices[c.sym] ??= { p: c.base, open: c.base, hist: [c.base] }));
  return w.exchange;
}
export const price = (w: W, sym: string) => w.exchange?.prices?.[sym]?.p ?? company(sym)?.base ?? 0;
export function indexNow(w: W) {
  const x = exchange(w);
  const r = COMPANIES.reduce((s, c) => s + x.prices[c.sym].p / c.base, 0) / COMPANIES.length;
  return Math.round(r * 1000) / 10;
}
export const halted = (w: W) => !!w.exchange?.haltedUntil && w.exchange.haltedUntil > w.now;
export function portfolio(w: W, id: Id) {
  const h = exchange(w).holdings[id] || {};
  const rows = Object.keys(h).filter((s) => h[s].n > 0).map((s) => ({ sym: s, n: h[s].n, cost: h[s].cost, value: Math.floor(h[s].n * price(w, s)) }));
  return { rows, value: rows.reduce((s, r) => s + r.value, 0), cost: rows.reduce((s, r) => s + r.cost, 0) };
}

// what pushes a company this tick, in percent, with the reasons (the company page shows them)
export function drivers(w: W, c: Company) {
  const out: [string, number][] = [];
  const m = w.meters;
  if (!c.nation) {
    if (c.sector === 'Railways') out.push(['Stability at home', ((m.stability - 50) / 50) * 0.6]);
    if (c.sector === 'Food') out.push(['Prosperity at home', ((m.prosperity - 50) / 50) * 0.5]);
    if (c.sector === 'Banking') out.push(['The Reserve’s rate', (w.economy.rate - 4) * 0.12], ['Inflation', w.economy.lastInflation > 5 ? -0.6 : 0.1]);
    if (c.sector === 'Arms') {
      out.push(['The realm at war', w.army?.war ? 1.6 : 0], ['Mobilisation', w.army?.readiness === 'mobilised' ? 0.6 : 0], ['Wars abroad', (w.conflicts || []).some((k: any) => k.status === 'raging') ? 0.5 : 0]);
      if (!w.army?.war) out.push(['Peacetime', -0.25]);
    }
    if (c.sector !== 'Railways') out.push(['The realm’s mood', ((m.stability + m.prosperity - 100) / 100) * 0.3]);
  } else {
    const n = w.nations[c.nation];
    if (n) {
      out.push([`Relations with ${n.name}`, (n.mood - 2) * 0.35]);
      if (n.sanctionsUntil && n.sanctionsUntil > w.now) out.push(['Their sanctions on us', -1.2]);
      if (n.embargo) out.push(['Our embargo', -1.5]);
      if (atWar(w, n.id)) out.push(['At war with the realm', -2.5]);
      if (conflictOf(w, n.id)) out.push(['At war abroad', c.sector === 'Steel' ? 0.8 : -1]);
      if (n.embassy) out.push(['Our embassy there', 0.15]);
      if (Object.values(w.treaties).some((t: any) => t.status === 'active' && t.nation === n.id && t.effect?.tariffFree)) out.push(['A trade agreement', 0.4]);
    }
    if (c.sector === 'Finance') out.push(['Wars anywhere', w.army?.war || (w.conflicts || []).some((k: any) => k.status === 'raging') ? -0.6 : 0.3]);
  }
  // prices drift back towards what the company is really worth
  const p = price(w, c.sym);
  out.push(['Back towards fair value', -Math.log(p / c.base) * 1.2]);
  return out.filter(([, v]) => Math.abs(v) >= 0.01);
}

// every three hours: move the prices; once a day, report a big day
export function tickExchange(w: W) {
  const x = exchange(w);
  x.nextAt = Math.max(x.nextAt + TICK, w.now - DAY);
  if (x.nextAt <= w.now) x.nextAt = w.now + TICK;
  let shock = 0;
  if (chance(w, 0.015)) shock = chance(w, 0.6) ? -(6 + rand(w) * 8) : 4 + rand(w) * 5;
  COMPANIES.forEach((c) => {
    const q = x.prices[c.sym];
    const drift = drivers(w, c).reduce((s, [, v]) => s + v, 0) + 0.05;
    const noise = (rand(w) - 0.5) * 5;
    const pct = clamp(drift + noise + shock, -25, 25);
    q.p = clamp(Math.round(q.p * (1 + pct / 100) * 100) / 100, 1, 999);
    q.hist.push(q.p);
    if (q.hist.length > HIST) q.hist.shift();
  });
  const idx = indexNow(w);
  x.index.push(idx);
  if (x.index.length > HIST) x.index.shift();
  if (shock) gazette(w, 'money', shock < 0 ? `Panic on the Exchange: every share falls about ${Math.round(-shock)}%. The index is at ${idx}.` : `A rush of buying lifts every share on the Exchange about ${Math.round(shock)}%.`, '#/exchange');
  const day = Math.floor(w.now / DAY);
  if (day !== x.day) {
    const move = ((idx - x.dayOpen) / x.dayOpen) * 100;
    if (Math.abs(move) >= 5) gazette(w, 'money', `The Exchange closes the day ${move > 0 ? 'up' : 'down'} ${Math.abs(move).toFixed(1)}%, at ${idx}.`, '#/exchange');
    x.day = day;
    x.dayOpen = idx;
    COMPANIES.forEach((c) => (x.prices[c.sym].open = x.prices[c.sym].p));
  }
}

// the exchange pays out: from its own account, drawing new money from the Reserve if it must
function payOut(w: W, to: string, amt: number, memo: string) {
  if (amt <= 0) return;
  const short = amt - bal(w, 'exchange');
  if (short > 0) {
    transfer(w, 'reserve', 'exchange', short, 'The Exchange drew on the Reserve');
    exchange(w).drawn += short;
    w.economy.inflatingThisWeek = (w.economy.inflatingThisWeek || 0) + short / 4;
  }
  transfer(w, 'exchange', to, amt, memo);
}

export function buy(w: W, actor: Id, sym: unknown, n: unknown) {
  mustBeFree(w, actor);
  const c = typeof sym === 'string' ? company(sym) : undefined;
  if (!c) fail('Pick a company on the Exchange.');
  if (halted(w)) fail('Trading is halted. It resumes when the halt ends.');
  const k = int(n, 1, MAX_HOLD, 'number of shares');
  const x = exchange(w);
  const h = (x.holdings[actor] ??= {});
  const have = h[c.sym]?.n || 0;
  if (have + k > MAX_HOLD) fail(`You can hold ${MAX_HOLD} shares of a company at most. You hold ${have}.`);
  if (c.nation && w.nations[c.nation]?.embargo) fail(`${w.nations[c.nation].name} is under our embargo: its shares cannot be bought.`);
  const cost = Math.ceil(k * price(w, c.sym));
  const duty = Math.ceil((cost * x.duty) / 100);
  if (bal(w, ca(actor)) < cost + duty) fail(`That costs ${cost}${duty ? ` plus ${duty} stamp duty` : ''}. You have ${bal(w, ca(actor))}.`);
  transfer(w, ca(actor), 'exchange', cost, `Bought ${k} ${c.sym} at ${price(w, c.sym)}`);
  if (duty > 0) transfer(w, ca(actor), 'treasury', duty, 'Stamp duty on shares');
  h[c.sym] = { n: have + k, cost: (h[c.sym]?.cost || 0) + cost };
  x.volume += k;
  bump(w, actor, 'trades');
  logTrade(w, actor, c.sym, 'buy', k);
}
export function sell(w: W, actor: Id, sym: unknown, n: unknown) {
  mustBeFree(w, actor);
  const c = typeof sym === 'string' ? company(sym) : undefined;
  if (!c) fail('Pick a company on the Exchange.');
  if (halted(w)) fail('Trading is halted. It resumes when the halt ends.');
  const x = exchange(w);
  const h = x.holdings[actor]?.[c.sym];
  const k = int(n, 1, MAX_HOLD, 'number of shares');
  if (!h || h.n < k) fail(`You hold ${h?.n || 0} ${c.sym}.`);
  const got = Math.floor(k * price(w, c.sym));
  const basis = Math.round((h.cost * k) / h.n);
  h.cost -= basis;
  h.n -= k;
  if (!h.n) delete x.holdings[actor][c.sym];
  x.volume += k;
  if (got > 0) payOut(w, ca(actor), got, `Sold ${k} ${c.sym} at ${price(w, c.sym)}`);
  bump(w, actor, 'trades');
  logTrade(w, actor, c.sym, 'sell', k);
  if (got - basis >= 50) gazette(w, 'money', `${nm(w, actor)} makes a killing on the Exchange.`, '#/exchange');
}
// the Chair of the Reserve (or the PM, with no Chair) stops trading for 12 hours, once a day
export function halt(w: W, actor: Id) {
  const x = exchange(w);
  if (!hasPower(w, actor, 'rate') && !(isPM(w, actor) && !holderOf(w, 'reserve'))) fail('Only the Chair of the Reserve can halt trading.');
  if (halted(w)) fail('Trading is already halted.');
  if (x.lastHalt && w.now - x.lastHalt < DAY) fail('Trading can be halted once a day.');
  x.haltedUntil = w.now + 12 * HOUR;
  x.lastHalt = w.now;
  x.haltBy = actor;
  gazette(w, 'money', `${nm(w, actor)} halts trading on the Exchange for 12 hours.`, '#/exchange');
}
// stamp duty on purchases, 0–5%: the Chancellor (power grant), or the PM with no Chancellor
export function setDuty(w: W, actor: Id, rate: unknown) {
  if (!(holderOf(w, 'treasury') === actor) && !(isPM(w, actor) && !holderOf(w, 'treasury'))) fail('Only the Chancellor sets stamp duty.');
  const r = int(rate, 0, 5, 'stamp duty');
  exchange(w).duty = r;
  gazette(w, 'money', `Stamp duty on shares is now ${r}%.`, '#/exchange');
}
// payday: dividends to holders, then any surplus above the float goes back to the Reserve
export function exchangePayday(w: W) {
  const x = exchange(w);
  let paid = 0;
  Object.entries(x.holdings).forEach(([id, h]: [string, any]) => {
    if (id !== FUND && !w.citizens[id]?.active) return;
    const amt = Object.keys(h).reduce((s, sym) => {
      const c = company(sym);
      return s + (c && h[sym].n > 0 ? (h[sym].n * price(w, sym) * c.yield) / 100 : 0);
    }, 0);
    const d = Math.floor(amt);
    if (d > 0) (payOut(w, id === FUND ? 'treasury' : ca(id), d, id === FUND ? 'Dividends to the wealth fund' : 'Dividends from the Exchange'), (paid += d));
  });
  const spare = bal(w, 'exchange') - FLOAT;
  if (spare > 0) transfer(w, 'exchange', 'reserve', spare, 'The Exchange returned its surplus to the Reserve');
  if (paid) gazette(w, 'money', `The Exchange pays ${paid} crowns in dividends.`, '#/exchange');
}
// the Register of Interests: shares held by MPs, ministers, the Prime Minister and the head of state are public
export function register(w: W) {
  const x = exchange(w);
  return Object.entries(x.holdings).filter(([id]) => id !== FUND).filter(([id]) => isMP(w, id) || inGov(w, id) || w.hos?.holder === id).map(([id, h]: [string, any]) => ({ id, holds: Object.keys(h).filter((s) => h[s].n > 0).map((s) => ({ sym: s, n: h[s].n })) })).filter((r) => r.holds.length);
}

// ---------- insider trading: every trade is logged privately. Someone who traded a company in the 24 hours before
// taking a decision that moves it is found out: a secret card for the Security Service and the PM, ready to leak ----------
function logTrade(w: W, id: Id, sym: string, side: 'buy' | 'sell', n: number) {
  const x = exchange(w);
  x.trades = [{ id, sym, side, n, at: w.now }, ...(x.trades || [])].slice(0, 300);
}
// the companies a decision moves
export const MOVES: Record<string, (w: W, a: any) => string[]> = {
  nation: (w, nid) => COMPANIES.filter((c) => c.nation === nid).map((c) => c.sym),
  conflict: (w, cid) => { const k = (w.conflicts || []).find((c: any) => c.id === cid); return k ? COMPANIES.filter((c) => c.nation === k.a || c.nation === k.b || c.sector === 'Finance').map((c) => c.sym) : []; },
  arms: () => ['IRF', 'DSF'],
  rate: () => ['CMB'],
  all: () => COMPANIES.map((c) => c.sym)
};
export function insider(w: W, actor: Id, syms: string[], what: string) {
  const x = w.exchange;
  if (!x || !syms.length) return;
  const t = (x.trades || []).find((r: any) => r.id === actor && syms.includes(r.sym) && w.now - r.at <= DAY && !r.caught);
  if (!t) return;
  t.caught = true;
  bump(w, actor, 'insider');
  addCard(w, { title: `${nm(w, actor)} ${t.side === 'buy' ? 'bought' : 'sold'} ${t.n} ${t.sym} shares at ${fmtTime(w, t.at)}, shortly before ${what}.`, about: actor, from: 'The Exchange', level: 'secret', viewers: w.offices.security ? ['office:security', 'pm'] : ['pm'] });
}

// ---------- the sovereign wealth fund: by law the Treasury buys or sells shares. It holds them as 'treasury';
// its dividends go to the Treasury; it is always on the Register of Interests ----------
export const FUND = 'treasury';
export function fundTrade(w: W, sym: string, crowns: number, sell: boolean, ref: string) {
  const c = company(sym);
  const x = exchange(w);
  if (!c) return;
  const p = price(w, sym);
  const h = (x.holdings[FUND] ??= {});
  if (!sell) {
    const n = Math.min(MAX_HOLD * 5 - (h[sym]?.n || 0), Math.floor(crowns / p));
    if (n < 1) return gazette(w, 'money', `${ref}: the wealth fund could not buy any ${sym}.`, '#/exchange');
    const cost = Math.ceil(n * p);
    transfer(w, 'treasury', 'exchange', cost, `Wealth fund bought ${n} ${sym} (${ref})`);
    h[sym] = { n: (h[sym]?.n || 0) + n, cost: (h[sym]?.cost || 0) + cost };
    return gazette(w, 'money', `The realm’s wealth fund buys ${n} shares of ${c.name} for ${cost} crowns, under ${ref}.`, '#/exchange');
  }
  const have = h[sym]?.n || 0;
  const n = Math.min(have, Math.ceil(crowns / p));
  if (n < 1) return gazette(w, 'money', `${ref}: the wealth fund holds no ${sym} to sell.`, '#/exchange');
  const got = Math.floor(n * p);
  h[sym].cost -= Math.round((h[sym].cost * n) / have);
  h[sym].n -= n;
  if (!h[sym].n) delete h[sym];
  if (got > 0) payOut(w, 'treasury', got, `Wealth fund sold ${n} ${sym} (${ref})`);
  gazette(w, 'money', `The realm’s wealth fund sells ${n} shares of ${c.name} for ${got} crowns, under ${ref}.`, '#/exchange');
}
export const fund = (w: W) => portfolio(w, FUND);
