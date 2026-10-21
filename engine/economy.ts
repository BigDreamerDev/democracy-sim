// Money: wallets, the weekly payday, the Treasury, the Federal Reserve and prices, citizen banks and trade ventures.
import { W, Id, DAY, fail, newId, rand, cit, nm, own, text, int, allCitizens, exiled, mustBeFree, gazette, earn, transfer, bal, ca, tick, meter, inDanger, hasPower, isPM, clamp, standing } from './core';
import { fundOffices, officePay } from './offices';

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
  w.seats.forEach((m: Id | null) => m && list.push({ id: m, amt: w.config.mpPay, why: 'MP pay' }));
  if (w.speaker) list.push({ id: w.speaker, amt: w.config.mpPay, why: 'Speaker pay' });
  if (w.pm) list.push({ id: w.pm, amt: w.config.ministerPay, why: 'Prime Minister pay' });
  officePay(w).forEach((p) => list.push({ id: p.id, amt: w.config.ministerPay, why: p.why }));
  return list.filter((p) => p.amt > 0);
}
export const ARMY_COST: Record<string, number> = { down: 10, ready: 25, mobilised: 50 };
export function armyCost(w: W) {
  return w.offices.army ? ARMY_COST[w.army.readiness] * (w.army.war ? 2 : 1) : 0;
}
export function budget(w: W) {
  const cs = allCitizens(w).filter((c: any) => !exiled(w, c.id));
  const base = cs.reduce((s: number, c: any) => s + (c.weekIncome || 0), 0);
  const fees = w.ledger.filter((l: any) => l.to === 'treasury' && l.at > w.now - 7 * DAY && !['Income tax'].includes(l.memo) && l.from !== 'reserve' && !l.memo.startsWith('Unspent')).reduce((s: number, l: any) => s + l.amt, 0);
  const income = [
    { label: `Income tax at ${w.config.taxRate}% (projected)`, v: Math.round((base * w.config.taxRate) / 100) },
    { label: 'Tariffs, fines and fees (last 7 days)', v: fees }
  ];
  const out = [
    { label: `Citizen dividend, ${w.config.dividend} each to ${cs.length}`, v: inDanger(w, 'prosperity') ? 0 : w.config.dividend * cs.length },
    { label: 'Pay for MPs, the Speaker and ministers', v: payroll(w).reduce((s, p) => s + p.amt, 0) },
    { label: 'Office budgets', v: (Object.values(w.offices) as any[]).reduce((s: number, o: any) => s + (o.id === 'treasury' ? 0 : o.budget || 0), 0) as number },
    { label: 'Army upkeep', v: armyCost(w) },
    { label: 'Interest owed to the Reserve', v: Math.round((w.economy.lent * w.economy.rate) / 100) }
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
    if (t > 0 && bal(w, ca(c.id)) >= t) {
      transfer(w, ca(c.id), 'treasury', t, 'Income tax');
      tax += t;
    }
  });
  const recession = inDanger(w, 'prosperity');
  if (!recession) cs.forEach((c: any) => !exiled(w, c.id) && w.config.dividend > 0 && transfer(w, 'treasury', ca(c.id), w.config.dividend, 'Citizen dividend'));
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
  const infl = clamp(1 + borrowed / 40 - (w.economy.rate - 2) * 1.5, -2, 12);
  w.economy.prices.push(Math.round(priceIndex(w) * (1 + infl / 100) * 100) / 100);
  if (w.economy.prices.length > 12) w.economy.prices.shift();
  w.economy.lastInflation = infl;
  // Prosperity responds to the week's finances
  const net = bal(w, 'treasury') - w.economy.lent - start;
  meter(w, 'prosperity', net >= 0 ? 2 : -3, net >= 0 ? 'The Treasury balanced its books' : 'The Treasury ran a deficit');
  if (borrowed > 0) meter(w, 'prosperity', -2, 'The Treasury had to borrow');
  if (infl > 5) meter(w, 'prosperity', -3, `Inflation hit ${infl.toFixed(1)}%`);
  else if (infl < 2) meter(w, 'prosperity', 1, 'Prices held steady');
  w.economy.lentThisWeek = 0;
  gazette(w, 'money', recession ? `Payday in a recession: no dividend this week. Income tax raised ${tax}.` : `Payday: ${w.config.dividend} crowns to every citizen. Income tax raised ${tax}. Prices ${infl >= 0 ? 'up' : 'down'} ${Math.abs(infl).toFixed(1)}%.`, '#/wallet');
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
  w.ventures.unshift({ id: newId(w, 'v'), by: actor, nation: nid, amount, tariff, r: Math.round(r), at: w.now, dueAt: w.now + 2 * DAY, status: 'out' });
  tick(w, actor, 'ventures');
}
export function settleVenture(w: W, v: any) {
  const n = w.nations[v.nation];
  const back = Math.max(0, Math.round(v.amount * (1 + v.r / 100)));
  v.status = 'back';
  v.returned = back;
  const pay = Math.min(back, bal(w, 'nation:' + v.nation));
  if (pay > 0) transfer(w, 'nation:' + v.nation, ca(v.by), pay, `Venture returns from ${n.name}`);
  if (back > v.amount) {
    earn(w, v.by, 2, 'A profitable venture');
    meter(w, 'prosperity', 1, 'Trade brought money home');
  }
}
