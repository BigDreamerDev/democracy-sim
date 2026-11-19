// Money: wallets, the weekly payday, the Treasury, the Federal Reserve and prices, citizen banks and trade ventures.
import { W, Id, DAY, HOUR, fail, newId, rand, cit, nm, own, text, int, allCitizens, exiled, mustBeFree, gazette, earn, transfer, bal, ca, tick, meter, inDanger, hasPower, isPM, clamp, standing, holderOf, bump } from './core';
import { fundOffices, officePay } from './offices';
import { hasCond, weekly as conditionsWeekly } from './conditions';

export function send(w: W, actor: Id, to: Id, amount: number, note: string) {
  mustBeFree(w, actor);
  if (!cit(w, to).active) fail('They are no longer a citizen.');
  if (to === actor) fail('You cannot pay yourself.');
  const amt = int(amount, 1, 1_000_000, 'amount');
  const why = text(note, 0, 200, 'note');
  transfer(w, ca(actor), ca(to), amt, why ? `From ${nm(w, actor)}: ${why}` : `From ${nm(w, actor)}`);
  tick(w, actor, 'sends');
}

// ---------- the Federal Reserve ----------
export function setRate(w: W, actor: Id, rate: number) {
  if (!hasPower(w, actor, 'rate') && !(isPM(w, actor) && w.offices.reserve && !w.offices.reserve.holder)) fail('Only the Chair of the Reserve sets the rate.');
  rate = Math.round(Number(rate));
  if (!(rate >= 0 && rate <= 15)) fail('The rate must be between 0% and 15%.');
  w.economy.rate = rate;
  gazette(w, 'money', `The Federal Reserve sets the interest rate at ${rate}%.`, '#/economy');
}
export const priceIndex = (w: W) => w.economy.prices[w.economy.prices.length - 1];

// ---------- the budget, as the Treasury page shows it ----------
export function payroll(w: W) {
  const list: { id: Id; amt: number; why: string }[] = [];
  const mp = hasCond(w, 'inquiry') ? Math.floor(w.config.mpPay / 2) : w.config.mpPay;
  w.seats.forEach((m: Id | null) => m && list.push({ id: m, amt: mp, why: 'MP pay' }));
  if (w.speaker) list.push({ id: w.speaker, amt: w.config.mpPay, why: 'Speaker pay' });
  if (w.pm) list.push({ id: w.pm, amt: w.config.ministerPay, why: 'Prime Minister pay' });
  officePay(w).forEach((p: any) => list.push({ id: p.id, amt: p.amt ?? w.config.ministerPay, why: p.why }));
  return list.filter((p) => p.amt > 0);
}
export const ARMY_COST: Record<string, number> = { down: 10, ready: 25, mobilised: 50 };
export function armyCost(w: W) {
  // supplies come from abroad: a weak crown makes them dearer
  // each regiment over the six the Army starts with costs 3 more a week
  return w.offices.army ? Math.round(((ARMY_COST[w.army.readiness] + 3 * Math.max(0, (w.army.troops ?? 6) - 6)) * (w.army.war ? 2 : 1)) / fx(w, Object.keys(w.nations)[0])) : 0;
}
// ---------- exchange rates: what one crown buys abroad. Inflation weakens it; good relations and prosperity strengthen it ----------
export const fx = (w: W, nid: string) => w.economy.fx?.[nid] ?? 1;
export function updateFx(w: W, infl: number) {
  w.economy.fx ??= {};
  w.economy.fxPrev ??= {};
  Object.values(w.nations).forEach((n: any) => {
    const prev = fx(w, n.id);
    const drift = 1 - (infl - 2) / 100 + (n.mood - 2) * 0.005 + (w.meters.prosperity - 50) / 2500 + (rand(w) - 0.5) * 0.02;
    w.economy.fxPrev[n.id] = prev;
    w.economy.fx[n.id] = clamp(Math.round(prev * drift * 1000) / 1000, 0.2, 3);
  });
}
// ---------- the savings tax: a share of every balance above the floor, each payday (both set by law) ----------
export const savingsRate = (w: W) => (w.config.savingsTax || 0) * (hasCond(w, 'controls') ? 2 : 1);
export function savingsTaxDue(w: W, id: Id) {
  const over = bal(w, ca(id)) - (w.config.savingsFloor ?? 200);
  return over > 0 ? Math.floor((over * savingsRate(w)) / 100) : 0;
}
export const dividendNow = (w: W) => Math.max(0, w.config.dividend - (hasCond(w, 'rationing') ? 2 : 0));
export function budget(w: W) {
  const cs = allCitizens(w).filter((c: any) => !exiled(w, c.id));
  const base = cs.reduce((s: number, c: any) => s + (c.weekIncome || 0), 0);
  const fees = w.ledger.filter((l: any) => l.to === 'treasury' && l.at > w.now - 7 * DAY && !['Income tax'].includes(l.memo) && l.from !== 'reserve' && !l.memo.startsWith('Unspent')).reduce((s: number, l: any) => s + l.amt, 0);
  const income = [
    { label: hasCond(w, 'strike') ? 'Income tax (none: general strike)' : `Income tax at ${w.config.taxRate}% (projected)`, v: hasCond(w, 'strike') ? 0 : Math.round((base * w.config.taxRate) / 100) },
    ...(savingsRate(w) > 0 ? [{ label: `Savings tax at ${savingsRate(w)}% over ${w.config.savingsFloor ?? 200} (projected)`, v: cs.reduce((s: number, c: any) => s + savingsTaxDue(w, c.id), 0) }] : []),
    { label: 'Tariffs, fines and fees (last 7 days)', v: fees }
  ];
  const out = [
    { label: `Citizen dividend, ${dividendNow(w)} each to ${cs.length}`, v: inDanger(w, 'prosperity') ? 0 : dividendNow(w) * cs.length },
    { label: 'Pay for MPs, the Speaker and ministers', v: payroll(w).reduce((s, p) => s + p.amt, 0) },
    { label: 'Office budgets', v: (Object.values(w.offices) as any[]).reduce((s: number, o: any) => s + (o.id === 'treasury' ? 0 : o.budget || 0), 0) as number },
    { label: 'Army upkeep', v: armyCost(w) },
    { label: 'Interest owed to the Reserve', v: Math.round((w.economy.lent * w.economy.rate) / 100) },
    { label: 'Treasury bonds falling due', v: (w.bonds?.holdings || []).filter((h: any) => h.dueAt <= w.now + 7 * DAY).reduce((s: number, h: any) => s + h.payout, 0) }
  ].filter((r) => r.v > 0 || r.label.startsWith('Citizen'));
  return { income, out, inTotal: income.reduce((s, r) => s + r.v, 0), outTotal: out.reduce((s, r) => s + r.v, 0) };
}

// ---------- payday ----------
export function payday(w: W) {
  const cs = allCitizens(w);
  const start = bal(w, 'treasury') - w.economy.lent;
  let tax = 0;
  cs.forEach((c: any) => {
    const t = Math.round(((c.weekIncome || 0) * w.config.taxRate) / 100);
    c.lastWeekIncome = c.weekIncome || 0;
    c.weekIncome = 0;
    if (t > 0 && !hasCond(w, 'strike') && bal(w, ca(c.id)) >= t) {
      transfer(w, ca(c.id), 'treasury', t, 'Income tax');
      tax += t;
    }
  });
  // the savings tax, before anything is paid out
  let saved = 0;
  if (savingsRate(w) > 0) cs.forEach((c: any) => {
    const s = savingsTaxDue(w, c.id);
    if (s > 0) (transfer(w, ca(c.id), 'treasury', s, 'Savings tax'), (saved += s));
  });
  const recession = inDanger(w, 'prosperity');
  const div = dividendNow(w);
  if (!recession) cs.forEach((c: any) => !exiled(w, c.id) && div > 0 && transfer(w, 'treasury', ca(c.id), div, 'Citizen dividend'));
  conditionsWeekly(w);
  payroll(w).forEach((p) => transfer(w, 'treasury', ca(p.id), p.amt, p.why));
  fundOffices(w);
  if (w.offices.army) {
    const n = Object.keys(w.nations)[0];
    transfer(w, 'treasury', 'nation:' + n, armyCost(w), 'Army upkeep and supplies');
  }
  const interest = Math.round((w.economy.lent * w.economy.rate) / 100);
  if (interest > 0) transfer(w, 'treasury', 'reserve', interest, 'Interest to the Federal Reserve');
  const spare = bal(w, 'treasury') - 150;
  if (w.economy.lent > 0 && spare > 0) {
    const r = Math.min(spare, w.economy.lent);
    transfer(w, 'treasury', 'reserve', r, 'Repaid the Federal Reserve');
    w.economy.lent -= r;
  }
  bankPayday(w);
  // prices move with borrowing and the rate
  const borrowed = w.economy.lentThisWeek || 0;
  const printed = w.economy.inflatingThisWeek || 0;
  let infl = clamp(1 + borrowed / 40 + printed / 25 - (w.economy.rate - 2) * 1.5 + (hasCond(w, 'bubble') ? 3 : 0) + (hasCond(w, 'drought') ? 2 : 0), -2, 15);
  // a price freeze (the hyperinflation crisis) holds inflation down for a week
  if ((w.economy.freezeUntil || 0) > w.now) infl = Math.min(infl, 1);
  w.economy.prices.push(Math.round(priceIndex(w) * (1 + infl / 100) * 100) / 100);
  if (w.economy.prices.length > 12) w.economy.prices.shift();
  w.economy.lastInflation = infl;
  updateFx(w, infl);
  // Prosperity responds to the week's finances
  const net = bal(w, 'treasury') - w.economy.lent - start;
  meter(w, 'prosperity', net >= 0 ? 2 : -3, net >= 0 ? 'The Treasury balanced its books' : 'The Treasury ran a deficit');
  if (borrowed > 0) meter(w, 'prosperity', -2, 'The Treasury had to borrow');
  if (infl > 5) meter(w, 'prosperity', -3, `Inflation hit ${infl.toFixed(1)}%`);
  else if (infl < 2) meter(w, 'prosperity', 1, 'Prices held steady');
  w.economy.lentThisWeek = 0;
  w.economy.printedThisWeek = 0;
  w.economy.inflatingThisWeek = 0;
  // two hot weeks in a row: hyperinflation
  w.economy.hotWeeks = infl > 10 ? (w.economy.hotWeeks || 0) + 1 : 0;
  if (w.economy.hotWeeks >= 2 && !w.crisisQueue.some((q: any) => q.type === 'hyperinflation') && !Object.values(w.crises).some((c: any) => c.type === 'hyperinflation' && c.status === 'open')) {
    w.crisisQueue.push({ type: 'hyperinflation', at: w.now + HOUR, cause: `Prices rose more than 10% two weeks running.` });
  }
  gazette(w, 'money', recession ? `Payday in a recession: no dividend this week. Income tax raised ${tax}.${saved ? ` Savings tax raised ${saved}.` : ''}` : `Payday: ${div} crowns to every citizen. Income tax raised ${tax}.${saved ? ` Savings tax raised ${saved}.` : ''} Prices ${infl >= 0 ? 'up' : 'down'} ${Math.abs(infl).toFixed(1)}%.`, '#/wallet');
}

// ---------- citizen banks ----------
export function openBank(w: W, actor: Id, name: string, saveRate: number, loanRate: number) {
  if (!w.permits.banks) fail('Banks open once Parliament passes the Banking Act.');
  mustBeFree(w, actor);
  name = text(name, 3, 40, 'bank name');
  if (Object.values(w.banks).some((b: any) => b.owner === actor && b.status === 'open')) fail('You already run a bank.');
  if (typeof saveRate !== 'number' || typeof loanRate !== 'number' || !(saveRate >= 0 && saveRate <= 10) || !(loanRate >= 0 && loanRate <= 20)) fail('Savings 0–10%, loans 0–20%.');
  transfer(w, ca(actor), 'treasury', 25, 'Bank licence');
  const id = newId(w, 'b');
  w.banks[id] = { id, owner: actor, name: name.trim(), saveRate, loanRate, deposits: {}, loans: [], status: 'open', at: w.now };
  transfer(w, ca(actor), 'bank:' + id, 25, 'Starting capital');
  gazette(w, 'money', `${nm(w, actor)} opens ${name.trim()}, paying ${saveRate}% a week on savings.`, '#/banks');
}
export function deposit(w: W, actor: Id, bid: Id, amount: number) {
  const b = own(w.banks, bid);
  if (!b || b.status !== 'open') fail('That bank is closed.');
  amount = int(amount, 1, 1_000_000, 'amount');
  transfer(w, ca(actor), 'bank:' + bid, amount, `Saved at ${b.name}`);
  b.deposits[actor] = (b.deposits[actor] || 0) + amount;
  tick(w, actor, 'saves');
}
export function withdraw(w: W, actor: Id, bid: Id, amount: number) {
  const b = own(w.banks, bid);
  if (!b) fail('No such bank.');
  amount = int(amount, 1, 1_000_000, 'amount');
  if ((b.deposits[actor] || 0) < amount) fail(`You have ${b.deposits[actor] || 0} saved there.`);
  if (b.status === 'frozen') fail(`${b.name} is frozen by the regime. Nothing goes in or out until it ends.`);
  // a run on the bank: it fails (and stays failed), and nothing is paid out
  if (bal(w, 'bank:' + bid) < amount) return failBank(w, b);
  b.deposits[actor] -= amount;
  transfer(w, 'bank:' + bid, ca(actor), amount, `Withdrew from ${b.name}`);
}
export function borrowFrom(w: W, actor: Id, bid: Id, amount: number, weeks: number) {
  const b = own(w.banks, bid);
  if (!b || b.status !== 'open') fail('That bank is closed.');
  amount = int(amount, 1, 100, 'loan (the most you can borrow is 100 crowns)');
  weeks = int(weeks, 1, 10, 'number of weeks');
  if (b.loans.some((l: any) => l.who === actor && l.left > 0)) fail('Pay off your current loan first.');
  if (bal(w, 'bank:' + bid) < amount) fail(`${b.name} does not have that much to lend.`);
  const total = Math.round(amount * (1 + (b.loanRate / 100) * weeks));
  transfer(w, 'bank:' + bid, ca(actor), amount, `Loan from ${b.name}`);
  b.loans.push({ id: newId(w, 'l'), who: actor, amount, total, weekly: Math.ceil(total / weeks), left: total, at: w.now });
}
function failBank(w: W, b: any) {
  if (b.status === 'failed') return;
  b.status = 'failed';
  meter(w, 'prosperity', -8, `${b.name} failed`);
  gazette(w, 'money', `${b.name} has failed. Savers get back only the cash that is left.`, '#/banks');
}
export function bankHealth(w: W, b: any) {
  const owed = (b.owedTotal ?? Object.values(b.deposits).reduce((s: number, v: any) => s + v, 0)) as number;
  const cash = bal(w, 'bank:' + b.id);
  return { owed, cash, ratio: owed ? cash / owed : 1 };
}
function bankPayday(w: W) {
  Object.values(w.banks).forEach((b: any) => {
    if (b.status !== 'open') return;
    // (a frozen bank is skipped too: its cash is held by the regime, and it must not fail for that)
    b.loans.forEach((l: any) => {
      if (l.left <= 0) return;
      const due = Math.min(l.weekly, l.left);
      if (bal(w, ca(l.who)) >= due) {
        transfer(w, ca(l.who), 'bank:' + b.id, due, `Loan repayment to ${b.name}`);
        l.left -= due;
      } else gazette(w, 'money', `${nm(w, l.who)} missed a loan payment to ${b.name}.`, '#/banks');
    });
    Object.entries(b.deposits).forEach(([who, amt]: any) => {
      const i = Math.floor((amt * b.saveRate) / 100);
      if (i > 0) b.deposits[who] += i;
    });
    if (bankHealth(w, b).ratio < 0.25) failBank(w, b);
  });
}

// ---------- trade ventures: put crowns into a trading run abroad, get them back with profit or loss ----------
export function ventureOdds(w: W, nid: Id) {
  const n = own(w.nations, nid);
  const base = (n.mood - 2) * 6 + (w.meters.prosperity - 50) / 5;
  return { low: Math.round(base - 20), high: Math.round(base + 30) };
}
export function startVenture(w: W, actor: Id, nid: Id, amount: number) {
  mustBeFree(w, actor);
  const n = own(w.nations, nid);
  if (!n) fail('Pick a country.');
  if (inDanger(w, 'standing')) fail('Embargo: no country will trade with us until our Standing recovers.');
  if (w.army.war === nid) fail('We are at war with them.');
  if (n.sanctionsUntil && n.sanctionsUntil > w.now) fail(`${n.name} has sanctions on us. No trade until they lift.`);
  if (n.embargo) fail(`We have ${n.name} under embargo. Lift it first.`);
  if (n.mood < 1) fail(`${n.name} refuses to trade with us.`);
  amount = Math.round(Number(amount));
  if (!(amount >= 5 && amount <= 100)) fail('Put in between 5 and 100 crowns.');
  if (w.ventures.some((v: any) => v.by === actor && v.status === 'out')) fail('You already have a venture at sea.');
  const free = Object.values(w.treaties).some((t: any) => t.status === 'active' && t.nation === nid && t.effect?.tariffFree);
  const tariff = free ? 0 : Math.round((amount * w.config.tariff) / 100);
  transfer(w, ca(actor), 'nation:' + nid, amount, `Trade venture to ${n.name}`);
  if (tariff > 0) transfer(w, ca(actor), 'treasury', tariff, 'Trade tariff');
  const o = ventureOdds(w, nid);
  const r = o.low + rand(w) * (o.high - o.low);
  w.ventures.unshift({ id: newId(w, 'v'), by: actor, nation: nid, amount, tariff, r: Math.round(r), fx: fx(w, nid), at: w.now, dueAt: w.now + 2 * DAY, status: 'out' });
  tick(w, actor, 'ventures');
}
export function settleVenture(w: W, v: any) {
  const n = w.nations[v.nation];
  // earned abroad, brought home at today's rate: a crown that weakened while the ship was out means more crowns back
  const back = Math.max(0, Math.round((v.amount * (1 + v.r / 100) * (v.fx || 1)) / fx(w, v.nation)));
  v.status = 'back';
  v.returned = back;
  const pay = Math.min(back, bal(w, 'nation:' + v.nation));
  // nationalised trade: the stake comes home, the profit goes to the Treasury
  const mine = w.regime?.trade ? Math.min(pay, v.amount) : pay;
  if (mine > 0) transfer(w, 'nation:' + v.nation, ca(v.by), mine, `Venture returns from ${n.name}`);
  if (pay > mine) transfer(w, 'nation:' + v.nation, 'treasury', pay - mine, 'Nationalised trade');
  if (back > v.amount) {
    earn(w, v.by, 2, 'A profitable venture');
    meter(w, 'prosperity', 1, 'Trade brought money home');
  }
}

// ---------- printing money and Treasury bonds: the Chancellor and the Chair of the Reserve must agree ----------
// A motion (print, or open a bond issue) is proposed by one key-holder and carried out when the other signs the same terms.
// The PM signs for a post that is vacant. One person holding both posts signs both at once.
export const MINT_MAX = 200; // crowns per print
export const MINT_WEEK = 400; // crowns per week
export const BOND_DAYS = 3; // a bond issue stays open this long
export const MOTION_HOURS = 24;
const keyOf = (w: W, id: Id) => ({
  treasury: !!w.offices.treasury && (holderOf(w, 'treasury') === id || (isPM(w, id) && !holderOf(w, 'treasury'))),
  reserve: !!w.offices.reserve && (hasPower(w, id, 'rate') || (isPM(w, id) && !holderOf(w, 'reserve')))
});
export const canMoneyMotion = (w: W, id: Id) => { const k = keyOf(w, id); return k.treasury || k.reserve; };
const same = (a: any, b: any) => JSON.stringify(a) === JSON.stringify(b);
const sovereignName = (w: W) => {
  const r = w.crown?.reign;
  return r && w.config.hos === 'monarchy' ? `${w.config.hosTitle} ${r.name} ${r.numeral}` : null;
};
function motionTerms(w: W, a: any) {
  const kind = a?.kind;
  if (kind === 'print') {
    const amount = int(a.amount, 1, MINT_MAX, `amount (1–${MINT_MAX} crowns)`);
    if (a.use !== 'treasury' && a.use !== 'debt') fail('Choose where the new money goes: the Treasury, or paying down the debt.');
    if ((w.economy.printedThisWeek || 0) + amount > MINT_WEEK) fail(`At most ${MINT_WEEK} crowns can be printed in a week. ${MINT_WEEK - (w.economy.printedThisWeek || 0)} left this week.`);
    return { kind, amount, use: a.use };
  }
  if (kind === 'bonds') {
    if (w.bonds.issue && w.bonds.issue.closesAt > w.now) fail('A bond issue is already open.');
    if (hasCond(w, 'controls')) fail('No bonds can be issued under capital controls.');
    return { kind, rate: int(a.rate, 1, 10, 'interest (1–10% a week)'), weeks: int(a.weeks, 1, 8, 'term (1–8 weeks)'), cap: int(a.cap, 10, 1000, 'size of the issue (10–1000 crowns)') };
  }
  if (kind === 'gold') {
    const amount = int(a.amount, 10, 200, 'gold to buy (10–200 crowns)');
    if (bal(w, 'treasury') < amount) fail(`The Treasury has only ${bal(w, 'treasury')} crowns.`);
    return { kind, amount };
  }
  return fail('Unknown kind of motion.');
}
export function moneyMotion(w: W, actor: Id, a: any) {
  mustBeFree(w, actor);
  if (!w.offices.treasury || !w.offices.reserve) fail('Printing money and bonds need both the Treasury and the Federal Reserve.');
  const k = keyOf(w, actor);
  if (!k.treasury && !k.reserve) fail('Only the Chancellor and the Chair of the Reserve can do this.');
  const terms = motionTerms(w, a);
  let m = w.economy.motion;
  if (!m || m.expiresAt <= w.now || !same(m.terms, terms)) m = w.economy.motion = { terms, signed: { treasury: null, reserve: null }, by: actor, at: w.now, expiresAt: w.now + MOTION_HOURS * 3600000 };
  else if ((k.treasury ? m.signed.treasury : true) && (k.reserve ? m.signed.reserve : true)) fail('You have already signed this. The other side must agree.');
  if (k.treasury) m.signed.treasury = actor;
  if (k.reserve) m.signed.reserve = actor;
  const what = describeMotion(w, terms);
  if (!m.signed.treasury || !m.signed.reserve) {
    gazette(w, 'money', `${nm(w, actor)} proposes ${what}. The ${m.signed.treasury ? 'Chair of the Reserve' : 'Chancellor'} must agree within ${MOTION_HOURS} hours.`, '#/economy');
    return;
  }
  w.economy.motion = null;
  const who = [...new Set([m.signed.treasury, m.signed.reserve])].map((id: Id) => nm(w, id)).join(' and ');
  if (terms.kind === 'print') return print(w, terms.amount, terms.use, who);
  if (terms.kind === 'gold') return buyGold(w, terms.amount, who);
  openBonds(w, terms, who);
}
export function describeMotion(w: W, t: any) {
  if (t.kind === 'gold') return `buying ${t.amount} crowns of gold abroad for the reserve`;
  return t.kind === 'print'
    ? `printing ${t.amount} new crowns ${t.use === 'debt' ? 'to pay down the debt to the Reserve' : 'into the Treasury'}`
    : `a Treasury bond issue of up to ${t.cap} crowns at ${t.rate}% a week for ${t.weeks} week${t.weeks === 1 ? '' : 's'}`;
}
// new money: the Reserve's balance goes further negative, so the ledger still sums to zero. No debt, but prices rise.
function print(w: W, amount: number, use: string, who: string) {
  const crown = sovereignName(w);
  transfer(w, 'reserve', 'treasury', amount, crown ? `New crowns struck bearing the head of ${crown}` : 'New crowns printed by the Federal Reserve');
  // the gold reserve backs new money first: backed crowns cause no inflation
  const backed = Math.min(amount, w.economy.gold || 0);
  w.economy.gold = (w.economy.gold || 0) - backed;
  w.economy.inflatingThisWeek = (w.economy.inflatingThisWeek || 0) + (amount - backed);
  w.economy.printedThisWeek = (w.economy.printedThisWeek || 0) + amount;
  w.economy.printed = (w.economy.printed || 0) + amount;
  w.economy.coinage.unshift({ at: w.now, amt: amount, by: crown || 'the Realm', use });
  if (w.economy.coinage.length > 30) w.economy.coinage.length = 30;
  let paid = 0;
  if (use === 'debt' && w.economy.lent > 0) {
    paid = Math.min(amount, w.economy.lent, bal(w, 'treasury'));
    if (paid > 0) {
      transfer(w, 'treasury', 'reserve', paid, 'Repaid the Federal Reserve with new money');
      w.economy.lent -= paid;
    }
  }
  gazette(w, 'money', `The Federal Reserve prints ${amount} new crowns${crown ? ` bearing the head of ${crown}` : ''}, agreed by ${who}.${paid ? ` ${paid} go to paying down the debt, which is now ${w.economy.lent}.` : ''}${backed ? ` ${backed} are backed by the gold reserve.` : ''}${amount > backed ? ' Expect prices to rise.' : ''}`, '#/economy');
}

// ---------- Treasury bonds: citizens lend the Treasury crowns and are repaid with interest ----------
function openBonds(w: W, t: any, who: string) {
  w.bonds.issue = { id: newId(w, 'bond'), rate: t.rate, weeks: t.weeks, cap: t.cap, sold: 0, at: w.now, closesAt: w.now + BOND_DAYS * DAY };
  gazette(w, 'money', `Treasury bonds on sale, agreed by ${who}: up to ${t.cap} crowns, paying ${t.rate}% a week for ${t.weeks} week${t.weeks === 1 ? '' : 's'}. Open for ${BOND_DAYS} days.`, '#/economy');
}
export function buyBond(w: W, actor: Id, amount: unknown) {
  mustBeFree(w, actor);
  const s = w.bonds.issue;
  if (!s || s.closesAt <= w.now) fail('No bonds are on sale.');
  if (hasCond(w, 'controls')) fail('No bonds can be sold under capital controls.');
  const amt = int(amount, 1, 1000, 'amount');
  if (s.sold + amt > s.cap) fail(`Only ${s.cap - s.sold} crowns of this issue are left.`);
  if (bal(w, ca(actor)) < amt) fail('You do not have that many crowns.');
  transfer(w, ca(actor), 'treasury', amt, `Bought Treasury bonds (${s.rate}% a week, ${s.weeks} weeks)`);
  s.sold += amt;
  w.bonds.holdings.push({ id: newId(w, 'bh'), issue: s.id, owner: actor, ask: null, amt, payout: Math.round(amt * (1 + (s.rate * s.weeks) / 100)), at: w.now, dueAt: w.now + s.weeks * 7 * DAY });
  w.bonds.outstanding = (w.bonds.outstanding || 0) + amt;
  bump(w, actor, 'bonds');
}
// at maturity the Treasury repays, borrowing from the Reserve if it must
export function redeemBond(w: W, h: any) {
  const i = w.bonds.holdings.indexOf(h);
  if (i < 0) return;
  w.bonds.holdings.splice(i, 1);
  w.bonds.market = (w.bonds.market || []).filter((m: any) => m.id !== h.id);
  w.bonds.outstanding = Math.max(0, (w.bonds.outstanding || 0) - h.amt);
  if (w.citizens[h.owner]) transfer(w, 'treasury', ca(h.owner), h.payout, 'Treasury bond repaid with interest');
}

// ---------- the gold reserve: crowns spent abroad on gold let the Reserve print that much without inflation ----------
function buyGold(w: W, amount: number, who: string) {
  if (bal(w, 'treasury') < amount) fail(`The Treasury has only ${bal(w, 'treasury')} crowns.`);
  const seller = Object.keys(w.nations)[0];
  transfer(w, 'treasury', 'nation:' + seller, amount, 'Gold bought abroad for the reserve');
  const got = Math.max(1, Math.round(amount * fx(w, seller)));
  w.economy.gold = (w.economy.gold || 0) + got;
  gazette(w, 'money', `The Treasury spends ${amount} crowns on ${got} crowns' worth of gold from ${w.nations[seller]?.name ?? 'abroad'}, agreed by ${who}. The gold reserve is now ${w.economy.gold}: the Reserve can print that much without raising prices.`, '#/economy');
}

// ---------- the bond market: holders sell bonds to each other before they mature. Sellers stay anonymous. ----------
export function listBond(w: W, actor: Id, hid: unknown, price: unknown) {
  mustBeFree(w, actor);
  const h = w.bonds.holdings.find((x: any) => x.id === hid);
  if (!h || h.owner !== actor) fail('That is not your bond.');
  const p = int(price, 1, 5000, 'price');
  h.ask = p;
  w.bonds.market = w.bonds.market.filter((m: any) => m.id !== h.id);
  w.bonds.market.push({ id: h.id, price: p, amt: h.amt, payout: h.payout, dueAt: h.dueAt, at: w.now });
}
export function unlistBond(w: W, actor: Id, hid: unknown) {
  const h = w.bonds.holdings.find((x: any) => x.id === hid);
  if (!h || h.owner !== actor) fail('That is not your bond.');
  h.ask = null;
  w.bonds.market = w.bonds.market.filter((m: any) => m.id !== h.id);
}
export function takeBond(w: W, actor: Id, hid: unknown) {
  mustBeFree(w, actor);
  const m = w.bonds.market.find((x: any) => x.id === hid);
  const h = m && w.bonds.holdings.find((x: any) => x.id === m.id);
  if (!m || !h) fail('That bond is no longer for sale.');
  if (h.owner === actor) fail('That bond is already yours.');
  if (bal(w, ca(actor)) < m.price) fail('You do not have that many crowns.');
  transfer(w, ca(actor), ca(h.owner), m.price, 'A Treasury bond changed hands');
  h.owner = actor;
  h.ask = null;
  w.bonds.market = w.bonds.market.filter((x: any) => x.id !== h.id);
  bump(w, actor, 'bonds');
}
