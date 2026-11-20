// The Exchange: ten listed companies whose share prices move every three hours with the state of the realm and
// the world: stability and prosperity at home, each foreign company's nation (mood, sanctions, embargo, war),
// arms makers on war, the bank on the Reserve's rate. Citizens buy and sell at the posted price.
// Money: buying pays the 'exchange' account, plus stamp duty to the Treasury; selling and dividends are paid from
// it. When it runs short it draws on the Reserve (new money, which feeds inflation); its surplus goes back each payday.
// Holdings are private (view.ts), except the Register of Interests: what MPs, ministers and the head of state own.
import { lim } from './limits';
import { own, text, stamp, W, Id, DAY, HOUR, fail, rand, chance, nm, newId, gazette, transfer, bal, ca, hasPower, isPM, holderOf, clamp, mustBeFree, int, bump, inGov, isMP, addCard, fmtTime } from './core';
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
  { sym: 'AUT', name: 'Austrava Trust', sector: 'Finance', nation: 'aurel', base: 18, yield: 0.7, about: 'The great bank of the Free City. Hates wars anywhere.' },
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
  tickListed(w, shock);
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
    Object.keys(x.prices).forEach((s) => (x.prices[s].open = x.prices[s].p));
  }
}

// the exchange pays out: from its own account, drawing new money from the Reserve if it must
export function payOut(w: W, to: string, amt: number, memo: string) {
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
  if (typeof sym === 'string' && own(exchange(w).listed || {}, sym)) return buyListed(w, actor, sym, n);
  const c = typeof sym === 'string' ? company(sym) : undefined;
  if (!c) fail('Pick a company on the Exchange.');
  if (halted(w)) fail('Trading is halted. It resumes when the halt ends.');
  const k = int(n, 1, lim(w, 'holdMax'), 'number of shares');
  const x = exchange(w);
  const h = (x.holdings[actor] ??= {});
  const have = h[c.sym]?.n || 0;
  if (have + k > lim(w, 'holdMax')) fail(`You can hold ${lim(w, 'holdMax')} shares of a company at most. You hold ${have}.`);
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
  if (typeof sym === 'string' && own(exchange(w).listed || {}, sym)) return sellListed(w, actor, sym, n);
  const c = typeof sym === 'string' ? company(sym) : undefined;
  if (!c) fail('Pick a company on the Exchange.');
  if (halted(w)) fail('Trading is halted. It resumes when the halt ends.');
  const x = exchange(w);
  const h = x.holdings[actor]?.[c.sym];
  const k = int(n, 1, lim(w, 'holdMax'), 'number of shares');
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
  const r = int(rate, 0, lim(w, 'stampDutyMax'), 'stamp duty');
  exchange(w).duty = r;
  gazette(w, 'money', `Stamp duty on shares is now ${r}%.`, '#/exchange');
}
// payday: dividends to holders, then any surplus above the float goes back to the Reserve
export function exchangePayday(w: W) {
  const x = exchange(w);
  listedPayday(w);
  let paid = 0;
  Object.entries(x.holdings).forEach(([id, h]: [string, any]) => {
    if (id !== FUND && id !== 'warchest' && !w.citizens[id]?.active) return;
    const amt = Object.keys(h).reduce((s, sym) => {
      const c = company(sym);
      return s + (c && h[sym].n > 0 ? (h[sym].n * price(w, sym) * c.yield) / 100 : 0);
    }, 0);
    const d = Math.floor(amt);
    if (d > 0) (payOut(w, id === FUND ? 'treasury' : id === 'warchest' ? 'warchest' : ca(id), d, id === FUND ? 'Dividends to the wealth fund' : id === 'warchest' ? 'Dividends to the war chest' : 'Dividends from the Exchange'), (paid += d));
  });
  const spare = bal(w, 'exchange') - FLOAT;
  if (spare > 0) transfer(w, 'exchange', 'reserve', spare, 'The Exchange returned its surplus to the Reserve');
  if (paid) gazette(w, 'money', `The Exchange pays ${paid} crowns in dividends.`, '#/exchange');
}
// the Register of Interests: shares held by MPs, ministers, the Prime Minister and the head of state are public
export function register(w: W) {
  const x = exchange(w);
  return Object.entries(x.holdings).filter(([id]) => id !== FUND && id !== 'warchest').filter(([id]) => isMP(w, id) || inGov(w, id) || w.hos?.holder === id).map(([id, h]: [string, any]) => ({ id, holds: Object.keys(h).filter((s) => h[s].n > 0).map((s) => ({ sym: s, n: h[s].n })) })).filter((r) => r.holds.length);
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
    const n = Math.min(lim(w, 'holdMax') * 5 - (h[sym]?.n || 0), Math.floor(crowns / p));
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

// ---------- shareholder revolts: anyone holding at least a tenth of a company's citizen-held shares (and 5 or more)
// can put a motion to its shareholders: that the company lobby for or against a bill before the House. Shareholders
// vote for a day, weighted by their shares (votes are private, the totals public). Carried, the company's lobby is
// public on the bill, and when the House decides, the company's price jumps 6% if it got its way and falls 6% if not ----------
export const MOTION_HOURS = 24;
const held = (w: W, id: Id, sym: string) => (id === FUND || id === 'warchest' ? 0 : exchange(w).holdings[id]?.[sym]?.n || 0);
export const heldBy = held;
const floatOf = (w: W, sym: string) => Object.keys(exchange(w).holdings).reduce((s, id) => s + held(w, id, sym), 0);
export function canMove(w: W, id: Id, sym: string) { const n = held(w, id, sym); return n >= 5 && n * 10 >= floatOf(w, sym); }
export function shareMotion(w: W, actor: Id, sym: unknown, prop: unknown, side: unknown) {
  mustBeFree(w, actor);
  const c = typeof sym === 'string' ? companyOf(w, sym) : undefined;
  if (!c) fail('Pick a company on the Exchange.');
  if (!canMove(w, actor, c.sym)) fail(`You need at least 5 ${c.sym} shares and a tenth of all held to call a vote.`);
  const p = typeof prop === 'string' ? w.proposals[prop] : null;
  if (!p || !['debate', 'vote'].includes(p.stage)) fail('Pick a bill before the House.');
  if (side !== 'aye' && side !== 'no') fail('For or against?');
  const x = exchange(w);
  x.motions ??= [];
  if (x.motions.some((m: any) => m.status === 'open' && m.sym === c.sym)) fail(`${c.name} already has a shareholder vote open.`);
  if ((p.lobbies || []).some((l: any) => l.sym === c.sym)) fail(`${c.name} has already taken a side on that bill.`);
  x.motions.unshift({ id: newId(w, 'sm'), sym: c.sym, by: actor, prop: p.id, side, votes: { [actor]: { yes: true, n: held(w, actor, c.sym) } }, at: w.now, closesAt: w.now + MOTION_HOURS * HOUR, status: 'open' });
  x.motions = x.motions.slice(0, 30);
  gazette(w, 'money', `Shareholder revolt: ${nm(w, actor)} calls on ${c.name} to lobby ${side === 'aye' ? 'for' : 'against'} “${p.title}”. Shareholders vote for a day.`, '#/exchange');
}
export function voteMotion(w: W, actor: Id, mid: unknown, yes: unknown) {
  const m = (exchange(w).motions || []).find((x: any) => x.id === mid);
  if (!m || m.status !== 'open') fail('That vote has closed.');
  mustBeFree(w, actor);
  const n = held(w, actor, m.sym);
  if (!n) fail(`Only ${m.sym} shareholders vote.`);
  if (yes !== true && yes !== false) fail('For or against?');
  m.votes[actor] = { yes, n };
}
export function closeMotion(w: W, m: any) {
  m.status = 'closed';
  // weight is what each voter holds when the vote closes, at most what they held when they voted
  const tally = (y: boolean) => Object.entries(m.votes).filter(([, v]: any) => v.yes === y).reduce((s, [id, v]: any) => s + Math.min(v.n, held(w, id, m.sym)), 0);
  m.yes = tally(true);
  m.no = tally(false);
  const p = w.proposals[m.prop];
  const c = companyOf(w, m.sym)!;
  if (m.oust) return settleOust(w, m, c);
  if (m.yes <= m.no || !p || !['debate', 'vote'].includes(p.stage)) return gazette(w, 'money', `${c.name}'s shareholders vote the motion down, ${m.yes} shares to ${m.no}.`, '#/exchange');
  p.lobbies = [...(p.lobbies || []), { sym: m.sym, side: m.side, at: w.now, by: m.by }];
  gazette(w, 'money', `${c.name}'s shareholders carry the motion, ${m.yes} shares to ${m.no}: the company lobbies ${m.side === 'aye' ? 'for' : 'against'} “${p.title}”.`, '#/p/' + p.id);
}
// proposals.ts calls this when a bill's vote closes
export function lobbyOutcome(w: W, p: any, passed: boolean) {
  (p.lobbies || []).forEach((l: any) => {
    const q = exchange(w).prices[l.sym];
    if (!q) return;
    const got = (l.side === 'aye') === passed;
    q.p = clamp(Math.round(q.p * (got ? 1.06 : 0.94) * 100) / 100, 1, 999);
    l.got = got;
  });
}

// ---------- corporate donors: when a company gets its way on a bill, the shareholder who called the vote may direct a
// donation of 20 crowns from it to a party (paid to the party's leader). Every donation is on the Register ----------
export const DONATION = 20;
export function donate(w: W, actor: Id, prop: unknown, sym: unknown, party: unknown) {
  const p = typeof prop === 'string' ? w.proposals[prop] : null;
  const l = (p?.lobbies || []).find((x: any) => x.sym === sym);
  if (!l || l.by !== actor) fail('Only the shareholder who called the vote directs the donation.');
  if (l.got !== true) fail('The company only donates when it gets its way.');
  if (l.donated) fail('That donation has been made.');
  const pt = typeof party === 'string' ? w.parties[party] : null;
  if (!pt || pt.status !== 'active' || !pt.leader) fail('Pick a party with a leader.');
  payOut(w, ca(pt.leader), DONATION, `Donation to ${pt.name} from ${companyOf(w, l.sym)!.name}`);
  l.donated = pt.id;
  const x = exchange(w);
  x.donations = [{ sym: l.sym, party: pt.id, amount: DONATION, by: actor, prop: p!.id, at: w.now }, ...(x.donations || [])].slice(0, 40);
  gazette(w, 'money', `${companyOf(w, l.sym)!.name} donates ${DONATION} crowns to the ${pt.name}.`, '#/exchange');
}

// ---------- citizens' own companies and banks on the Exchange ----------
// A citizen floats a company (with starting capital they put in) or their bank. They choose the number of shares, the
// opening price and how many to keep. The rest is the float: buying from it pays the company (or the bank's reserves),
// so floating really raises money. After that, shares trade against the Exchange, which holds what it buys back
// (its inventory) and sells it on. A listed company's price drifts towards what it is worth: its cash per share for a
// company, the bank's cash plus loans out minus what it owes savers for a bank. A company earns or loses each payday
// with the realm's prosperity. The owner pays dividends from its funds; shareholders can vote the owner out.
// State: w.exchange.listed[sym]; its cash in the account 'co:<sym>' (companies) or 'bank:<id>' (banks).
export const LIST_FEE = 25;
export const SECTORS = ['Trade', 'Shipping', 'Farming', 'Mining', 'Building', 'Media', 'Leisure', 'Technology'];
export const listed = (w: W, sym: string) => own(w.exchange?.listed || {}, sym);
export const listings = (w: W) => Object.values(w.exchange?.listed || {}) as any[];
export function companyOf(w: W, sym: string): Company | undefined {
  const c = company(sym);
  if (c) return c;
  const l = listed(w, sym);
  return l ? { sym: l.sym, name: l.name, sector: l.sector, nation: null, base: l.ipo, yield: 0, about: l.about } : undefined;
}
const acct = (l: any) => (l.kind === 'bank' ? 'bank:' + l.bank : 'co:' + l.sym);
// what a listed company is worth, in all and per share
export function worth(w: W, l: any) {
  if (l.status === 'bust') return 0;
  if (l.kind === 'bank') {
    const b = w.banks[l.bank];
    if (!b || b.status === 'failed') return 0;
    const owed = Object.values(b.deposits).reduce((s: number, v: any) => s + v, 0) as number;
    const lent = (b.loans || []).reduce((s: number, x: any) => s + (x.left || 0), 0);
    return Math.max(0, bal(w, acct(l)) + lent - owed);
  }
  return bal(w, acct(l));
}
// per share in issue: shares still unsold in the float have not been paid for, so they dilute nothing
export const issued = (l: any) => Math.max(1, l.shares - l.unsold);
export const fairPrice = (w: W, l: any) => Math.max(0, Math.round((worth(w, l) / issued(l)) * 100) / 100);
export function floatCompany(w: W, actor: Id, a: any) {
  mustBeFree(w, actor);
  const x = exchange(w);
  x.listed ??= {};
  const kind = a?.kind === 'bank' ? 'bank' : a?.kind === 'company' ? 'company' : fail('Float a company or a bank.');
  const sym = text(a?.sym, 3, 4, 'ticker').toUpperCase();
  if (!/^[A-Z]{3,4}$/.test(sym)) fail('A ticker is 3 or 4 letters.');
  if (company(sym) || own(x.listed, sym)) fail(`${sym} is taken.`);
  if (listings(w).filter((l) => l.owner === actor && l.status === 'listed').length >= lim(w, 'companiesEach')) fail(lim(w, 'companiesEach') === 1 ? 'You can run one listed company at most.' : `You can run ${lim(w, 'companiesEach')} listed companies at most.`);
  const shares = int(a?.shares, 50, lim(w, 'listSharesMax'), 'number of shares');
  const ipo = Math.round(Number(a?.price) * 100) / 100;
  if (!(ipo >= 1 && ipo <= lim(w, 'ipoMax'))) fail(`The opening price must be from 1 to ${lim(w, 'ipoMax')} crowns.`);
  // the founder keeps at least a tenth, and sells at least 10
  const keep = int(a?.keep ?? 0, Math.ceil(shares / 10), shares - 10, 'shares you keep');
  let name: string;
  let bankId: string | null = null;
  if (kind === 'bank') {
    const b = Object.values(w.banks).find((x: any) => x.owner === actor && x.status === 'open') as any;
    if (!b) fail('You run no open bank to float.');
    if (listings(w).some((l) => l.bank === b.id && l.status === 'listed')) fail(`${b.name} is already listed.`);
    name = b.name;
    bankId = b.id;
  } else {
    name = text(a?.name, 3, 40, 'company name');
  }
  const capital = kind === 'company' ? int(a?.capital, 20, lim(w, 'capitalMax'), 'starting capital') : 0;
  transfer(w, ca(actor), 'treasury', LIST_FEE, `Listing ${sym} on the Exchange`);
  const l = { sym, name, kind, bank: bankId, owner: actor, founder: actor, sector: kind === 'bank' ? 'Banking' : SECTORS.includes(a?.sector) ? a.sector : 'Trade', about: kind === 'bank' ? `${name}, a citizen's bank.` : text(a?.about, 0, 160, 'description') || `${name}, founded by ${nm(w, actor)}.`, shares, unsold: shares - keep, mm: 0, ipo, at: w.now, status: 'listed', profits: [] as number[] };
  x.listed[sym] = l;
  if (capital) transfer(w, ca(actor), acct(l), capital, `Starting capital for ${name}`);
  if (keep) (x.holdings[actor] ??= {})[sym] = { n: keep, cost: 0 };
  x.prices[sym] = { p: ipo, open: ipo, hist: [ipo] };
  gazette(w, 'money', `${nm(w, actor)} floats ${name} (${sym}) on the Exchange: ${shares - keep} shares at ${ipo} crowns.`, '#/exchange');
}
function buyListed(w: W, actor: Id, sym: string, n: unknown) {
  const x = exchange(w);
  const l = x.listed[sym];
  if (l.status !== 'listed') fail(`${l.name} has gone bust.`);
  if (halted(w)) fail('Trading is halted. It resumes when the halt ends.');
  const k = int(n, 1, lim(w, 'holdMax'), 'number of shares');
  const h = (x.holdings[actor] ??= {});
  const have = h[sym]?.n || 0;
  if (have + k > lim(w, 'holdMax')) fail(`You can hold ${lim(w, 'holdMax')} shares of a company at most. You hold ${have}.`);
  if (k > l.unsold + l.mm) fail(`Only ${l.unsold + l.mm} ${sym} shares are for sale.`);
  const p = price(w, sym);
  const cost = Math.ceil(k * p);
  const duty = Math.ceil((cost * x.duty) / 100);
  if (bal(w, ca(actor)) < cost + duty) fail(`That costs ${cost}${duty ? ` plus ${duty} stamp duty` : ''}. You have ${bal(w, ca(actor))}.`);
  // new shares from the float first (the money goes to the company), then the Exchange's own stock
  const fresh = Math.min(k, l.unsold);
  const fromFloat = Math.ceil(fresh * p);
  if (fromFloat > 0) transfer(w, ca(actor), acct(l), fromFloat, `Bought ${fresh} new ${sym} shares`);
  if (cost - fromFloat > 0) transfer(w, ca(actor), 'exchange', cost - fromFloat, `Bought ${k - fresh} ${sym} at ${p}`);
  if (duty > 0) transfer(w, ca(actor), 'treasury', duty, 'Stamp duty on shares');
  l.unsold -= fresh;
  l.mm -= k - fresh;
  h[sym] = { n: have + k, cost: (h[sym]?.cost || 0) + cost };
  x.volume += k;
  bump(w, actor, 'trades');
  logTrade(w, actor, sym, 'buy', k);
}
function sellListed(w: W, actor: Id, sym: string, n: unknown) {
  const x = exchange(w);
  const l = x.listed[sym];
  if (halted(w)) fail('Trading is halted. It resumes when the halt ends.');
  const h = x.holdings[actor]?.[sym];
  const k = int(n, 1, lim(w, 'holdMax'), 'number of shares');
  if (!h || h.n < k) fail(`You hold ${h?.n || 0} ${sym}.`);
  if (l.status !== 'listed') fail(`${l.name} has gone bust. Its shares are worth nothing.`);
  // the Exchange buys back at the market price, but never above what the company is worth
  const p = Math.min(price(w, sym), Math.max(0.5, fairPrice(w, l)));
  const got = Math.floor(k * p);
  h.cost -= Math.round((h.cost * k) / h.n);
  h.n -= k;
  if (!h.n) delete x.holdings[actor][sym];
  l.mm += k;
  x.volume += k;
  if (got > 0) payOut(w, ca(actor), got, `Sold ${k} ${sym} at ${p}`);
  bump(w, actor, 'trades');
  logTrade(w, actor, sym, 'sell', k);
}
// the owner puts more of their own money in (companies only; a bank takes deposits)
export function invest(w: W, actor: Id, sym: unknown, amount: unknown) {
  const l = typeof sym === 'string' ? listed(w, sym) : null;
  if (!l || l.owner !== actor) fail('Only the owner puts money into the company.');
  if (l.kind !== 'company') fail('A bank raises money through deposits, not investment.');
  if (l.status !== 'listed') fail(`${l.name} has gone bust.`);
  const amt = int(amount, 1, 1000, 'amount');
  transfer(w, ca(actor), acct(l), amt, `Invested in ${l.name}`);
}
// a dividend: the owner pays out of the company's funds, the same for every share in hands (unsold shares get nothing)
export function payDividend(w: W, actor: Id, sym: unknown, amount: unknown) {
  const l = typeof sym === 'string' ? listed(w, sym) : null;
  if (!l || l.owner !== actor) fail('Only the owner declares a dividend.');
  if (l.status !== 'listed') fail(`${l.name} has gone bust.`);
  const amt = int(amount, 1, 1000, 'dividend');
  if (bal(w, acct(l)) < amt) fail(`${l.name} has ${bal(w, acct(l))} crowns.`);
  if (l.kind === 'bank' && worth(w, l) < amt) fail(`${l.name} cannot pay that and still cover its savers.`);
  const x = exchange(w);
  const inHands = l.shares - l.unsold;
  if (inHands <= 0) fail('Nobody holds any shares yet.');
  const per = amt / inHands;
  let paid = 0;
  Object.entries(x.holdings).forEach(([id, hh]: [string, any]) => {
    const k = hh[l.sym]?.n || 0;
    const d = Math.floor(k * per);
    if (d > 0 && w.citizens[id]?.active) (transfer(w, acct(l), ca(id), d, `Dividend from ${l.name}`), (paid += d));
  });
  const toEx = Math.floor(l.mm * per);
  if (toEx > 0) (transfer(w, acct(l), 'exchange', toEx, `Dividend from ${l.name}`), (paid += toEx));
  gazette(w, 'money', `${l.name} pays its shareholders a dividend of ${paid} crowns.`, '#/exchange');
}
// shareholders vote the owner out: carried, the biggest holder who voted for it takes over
export function oustMotion(w: W, actor: Id, sym: unknown) {
  mustBeFree(w, actor);
  const l = typeof sym === 'string' ? listed(w, sym) : null;
  if (!l || l.status !== 'listed') fail('Pick a company floated by a citizen.');
  if (l.owner === actor) fail('You own it already.');
  if (!canMove(w, actor, l.sym)) fail(`You need at least 5 ${l.sym} shares and a tenth of all held to call a vote.`);
  const x = exchange(w);
  x.motions ??= [];
  if (x.motions.some((m: any) => m.status === 'open' && m.sym === l.sym)) fail(`${l.name} already has a shareholder vote open.`);
  x.motions.unshift({ id: newId(w, 'sm'), sym: l.sym, by: actor, prop: null, side: null, oust: true, votes: { [actor]: { yes: true, n: held(w, actor, l.sym) } }, at: w.now, closesAt: w.now + MOTION_HOURS * HOUR, status: 'open' });
  gazette(w, 'money', `Boardroom revolt: ${nm(w, actor)} calls on ${l.name}'s shareholders to remove ${nm(w, l.owner)} as owner. They vote for a day.`, '#/exchange');
}
function settleOust(w: W, m: any, c: any) {
  const l = listed(w, m.sym);
  // the owner's shares count against, whether or not they voted
  const ownerN = held(w, l.owner, m.sym);
  const no = Math.max(m.no, ownerN);
  if (!l || l.status !== 'listed' || m.yes <= no) return gazette(w, 'money', `${c.name}'s owner survives the vote, ${m.yes} shares to ${no}.`, '#/exchange');
  const heir = Object.entries(m.votes).filter(([id, v]: any) => v.yes && id !== l.owner && w.citizens[id]?.active).sort((a: any, b: any) => held(w, b[0], m.sym) - held(w, a[0], m.sym))[0]?.[0] as Id | undefined;
  if (!heir) return;
  const was = l.owner;
  l.owner = heir;
  if (l.kind === 'bank' && w.banks[l.bank]) w.banks[l.bank].owner = heir;
  stamp(w, was, 'Ousted', `From ${l.name}`, 'bad');
  gazette(w, 'money', `${nm(w, was)} is voted out of ${l.name}, ${m.yes} shares to ${no}. ${nm(w, heir)} takes over.`, '#/exchange');
}
// every three hours: listed prices drift towards what the company is worth, with the market's mood and some noise
export function tickListed(w: W, shock: number) {
  listings(w).forEach((l) => {
    const q = w.exchange.prices[l.sym];
    if (!q) return;
    if (l.kind === 'bank' && (!w.banks[l.bank] || w.banks[l.bank].status === 'failed') && l.status === 'listed') bust(w, l, 'the bank failed');
    if (l.status !== 'listed') return void ((q.p = 0), q.hist.push(0), q.hist.length > 56 && q.hist.shift());
    const fair = Math.max(0.2, fairPrice(w, l));
    const pull = (fair / Math.max(0.2, q.p) - 1) * 12;
    const mood = ((w.meters.prosperity - 50) / 50) * 0.4;
    const pct = clamp(pull + mood + (rand(w) - 0.5) * 6 + shock, -25, 25);
    q.p = clamp(Math.round(q.p * (1 + pct / 100) * 100) / 100, 0.2, 999);
    q.hist.push(q.p);
    if (q.hist.length > 56) q.hist.shift();
  });
}
function bust(w: W, l: any, why: string) {
  l.status = 'bust';
  l.bustAt = w.now;
  gazette(w, 'money', `${l.name} (${l.sym}) goes bust: ${why}. Its shares are worthless.`, '#/exchange');
}
// payday: a company makes or loses money with the realm's prosperity, and can go bust
export function listedPayday(w: W) {
  listings(w).forEach((l) => {
    if (l.kind !== 'company' || l.status !== 'listed') return;
    const cash = bal(w, acct(l));
    const pct = (w.meters.prosperity - 45) / 10 + (rand(w) - 0.5) * 8; // roughly −7% to +9% a week
    const d = Math.round((cash * pct) / 100);
    if (d > 0) transfer(w, 'reserve', acct(l), d, `${l.name}: a profitable week`);
    if (d < 0) transfer(w, acct(l), 'reserve', Math.min(cash, -d), `${l.name}: a losing week`);
    l.profits = [d, ...(l.profits || [])].slice(0, 8);
    if (bal(w, acct(l)) < 1) bust(w, l, 'it ran out of money');
  });
}
