// Shared rules: ids, randomness, the ledger, the Gazette, Influence, approval, the three national meters,
// secret cards, offices and roles, and the calendar. Every other system builds on these.

export const HOUR = 3600_000;
export const DAY = 24 * HOUR;
export const WEEK = 7 * DAY;

export class GameError extends Error {}
export function fail(msg: string): never {
  throw new GameError(msg);
}

export type Id = string;
export type W = any; // the world is plain JSON; see world.ts for its shape

// ---------- ids and deterministic randomness ----------
export function newId(w: W, prefix: string): Id {
  w.nextId += 1;
  return prefix + w.nextId;
}
export function rand(w: W): number {
  let t = (w.rng = (w.rng + 0x6d2b79f5) | 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
export const chance = (w: W, p: number) => rand(w) < p;
export const pick = <T>(w: W, a: T[]): T => a[Math.floor(rand(w) * a.length)];
export function shuffle<T>(w: W, a: T[]): T[] {
  const b = a.slice();
  for (let i = b.length - 1; i > 0; i--) {
    const j = Math.floor(rand(w) * (i + 1));
    [b[i], b[j]] = [b[j], b[i]];
  }
  return b;
}
export const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

// ---------- citizens ----------
export function cit(w: W, id: Id) {
  const c = w.citizens[id];
  if (!c) fail('No such citizen.');
  return c;
}
export const nm = (w: W, id: Id | null | undefined) => (id && w.citizens[id] ? w.citizens[id].name : 'nobody');
export const allCitizens = (w: W): any[] => Object.values(w.citizens).filter((c: any) => c.active);
export const exiled = (w: W, id: Id) => !!w.citizens[id]?.exiledUntil && w.citizens[id].exiledUntil > w.now;
export function mustBeFree(w: W, id: Id) {
  cit(w, id);
  if (exiled(w, id)) fail('You are in exile and cannot do that until your exile ends.');
}

// ---------- money: a ledger whose accounts always sum to zero ----------
export const bal = (w: W, acct: string): number => w.accounts[acct] || 0;
export const ca = (id: Id) => 'c:' + id;
export function acctLabel(w: W, a: string): string {
  if (a.startsWith('c:')) return nm(w, a.slice(2));
  if (a.startsWith('bank:')) return w.banks[a.slice(5)]?.name ?? 'a bank';
  if (a.startsWith('nation:')) return w.nations[a.slice(7)]?.name ?? 'abroad';
  if (a.startsWith('office:')) return w.offices[a.slice(7)]?.name ?? 'an office';
  return ({ treasury: 'the Treasury', reserve: 'the Federal Reserve', escrow: 'held in escrow', ventures: 'trade ventures' } as any)[a] ?? a;
}
export function transfer(w: W, from: string, to: string, amount: number, memo: string) {
  const amt = Math.round(amount);
  if (!(amt > 0)) fail('The amount must be at least 1 crown.');
  if (from === to) fail('You cannot pay yourself.');
  if (from !== 'reserve' && bal(w, from) < amt) {
    if (from === 'treasury') borrow(w, amt - bal(w, 'treasury'));
    else fail(`Not enough crowns: ${acctLabel(w, from)} has ${bal(w, from)}, needs ${amt}.`);
  }
  w.accounts[from] = bal(w, from) - amt;
  w.accounts[to] = bal(w, to) + amt;
  if (to.startsWith('c:')) {
    const c = w.citizens[to.slice(2)];
    if (c) {
      c.weekIncome = (c.weekIncome || 0) + amt;
      c.stats.maxBalance = Math.max(c.stats.maxBalance || 0, bal(w, to));
    }
  }
  w.ledger.unshift({ at: w.now, from, to, amt, memo });
  if (w.ledger.length > 400) w.ledger.length = 400;
}
// When the Treasury runs dry it borrows from the Reserve automatically. That is recorded on a secret card.
function borrow(w: W, amt: number) {
  w.accounts.reserve = bal(w, 'reserve') - amt;
  w.accounts.treasury = bal(w, 'treasury') + amt;
  w.economy.lent += amt;
  w.economy.lentThisWeek = (w.economy.lentThisWeek || 0) + amt;
  w.ledger.unshift({ at: w.now, from: 'reserve', to: 'treasury', amt, memo: 'Treasury borrowed from the Federal Reserve' });
  const chancellor = holderOf(w, 'treasury');
  addCard(w, {
    title: `The Treasury quietly borrowed ${amt} crowns from the Reserve (now owes ${w.economy.lent}).`,
    about: chancellor || w.pm,
    from: 'Treasury',
    level: 'restricted',
    viewers: ['pm', 'office:treasury', 'office:reserve']
  });
}
export const ledgerTotal = (w: W) => Object.values(w.accounts).reduce((s: number, v: any) => s + v, 0);

// ---------- the Gazette: the public record ----------
export function gazette(w: W, kind: string, text: string, link?: string) {
  w.gazette.unshift({ id: newId(w, 'g'), at: w.now, kind, text, link: link || null });
  if (w.gazette.length > 300) w.gazette.length = 300;
}

// ---------- Influence: earned by taking part, spent on political moves ----------
export function earn(w: W, id: Id, n: number, why: string) {
  const c = w.citizens[id];
  if (!c || !n) return;
  c.influence = Math.max(0, c.influence + n);
  if (n > 0) c.seasonEarned = (c.seasonEarned || 0) + n;
  c.log.unshift({ at: w.now, n, why });
  if (c.log.length > 40) c.log.length = 40;
}
export function spend(w: W, id: Id, n: number, why: string) {
  const c = cit(w, id);
  if (c.influence < n) fail(`That costs ${n} Influence. You have ${c.influence}.`);
  c.influence -= n;
  c.log.unshift({ at: w.now, n: -n, why });
}
export function stamp(w: W, id: Id, label: string, sub: string, tone: 'good' | 'bad' | 'ink' = 'good') {
  w.citizens[id]?.stamps.unshift({ label, sub, tone, at: w.now });
}
// approval: each citizen's public standing, 0 to 100, shown on ballots and benches
export function approve(w: W, id: Id | null, d: number) {
  const c = id && w.citizens[id];
  if (c) c.approval = clamp(Math.round(c.approval + d), 0, 100);
}
// weekly counters feed the objectives
export function tick(w: W, id: Id, key: string, n = 1) {
  const c = w.citizens[id];
  if (c) c.week[key] = (c.week[key] || 0) + n;
}

// ---------- the three national meters ----------
export const METERS: Record<string, { name: string; low: string; blurb: string }> = {
  prosperity: { name: 'Prosperity', low: 'Recession: no dividend this payday', blurb: 'The economy. Surpluses and trade raise it; deficits, borrowing and bank failures drop it.' },
  stability: { name: 'Stability', low: 'Unrest: coups need one fewer plotter and the Army grows restless', blurb: 'Order at home. Laws and confidence votes raise it; scandals, fallen governments and dodged questions drop it.' },
  standing: { name: 'Standing', low: 'Embargo: nobody will trade with us', blurb: 'How the world sees us. The average mood of the five nations.' }
};
export function meter(w: W, key: 'prosperity' | 'stability', d: number, why: string) {
  if (!d) return;
  const before = w.meters[key];
  w.meters[key] = clamp(Math.round(before + d), 0, 100);
  w.meters.log.unshift({ at: w.now, key, d: w.meters[key] - before, why });
  if (w.meters.log.length > 30) w.meters.log.length = 30;
  if (before > 15 && w.meters[key] <= 15) gazette(w, 'crisis', `${METERS[key].name} has collapsed. ${METERS[key].low}.`, '#/');
}
export function standing(w: W) {
  const ns = Object.values(w.nations) as any[];
  return ns.length ? Math.round((ns.reduce((s, n) => s + n.mood, 0) / ns.length) * 25) : 50;
}
export const inDanger = (w: W, key: string) => (key === 'standing' ? standing(w) : w.meters[key]) <= 15;

// ---------- secret cards: the backroom's only currency ----------
// viewers: 'pm', 'hos', 'office:<id>' (that office's holder), 'cit:<id>'
export function addCard(w: W, c: { title: string; about: Id | null; from: string; level: 'restricted' | 'secret'; viewers: string[] }) {
  w.cards.unshift({ id: newId(w, 'k'), at: w.now, state: 'live', ...c });
  if (w.cards.length > 80) w.cards.length = 80;
}
export function canSeeCard(w: W, k: any, id: Id) {
  if (k.state !== 'live') return false;
  return k.viewers.some((v: string) => {
    if (v === 'pm') return w.pm === id;
    if (v === 'hos') return w.hos.holder === id;
    if (v.startsWith('office:')) return holderOf(w, v.slice(7)) === id || (w.offices[v.slice(7)]?.members || []).includes(id);
    if (v.startsWith('cit:')) return v.slice(4) === id;
    return false;
  });
}

// ---------- seats and roles ----------
export const isMP = (w: W, id: Id) => w.seats.includes(id);
export const mps = (w: W): Id[] => w.seats.filter(Boolean);
export const isPM = (w: W, id: Id) => w.pm === id;
export const isHOS = (w: W, id: Id) => w.hos.holder === id;
export function holderOf(w: W, officeId: string): Id | null {
  return w.offices[officeId]?.holder || null;
}
export function officesOf(w: W, id: Id): any[] {
  return Object.values(w.offices).filter((o: any) => o.holder === id || (o.members || []).includes(id));
}
export function hasPower(w: W, id: Id, power: string) {
  return officesOf(w, id).some((o: any) => o.powers.includes(power));
}
export function officeWithPower(w: W, id: Id, power: string) {
  return officesOf(w, id).find((o: any) => o.powers.includes(power));
}
export function holdsAnything(w: W, id: Id) {
  return isPM(w, id) || isHOS(w, id) || w.speaker === id || officesOf(w, id).length > 0;
}
// The Returning Officer plays like anyone else and may hold any office. In return, everything done with
// admin powers goes on the public record: the admin log (public) and the Gazette.
export function adminDid(w: W, by: Id, text: string, link?: string) {
  w.adminLog.unshift({ at: w.now, by, text });
  if (w.adminLog.length > 300) w.adminLog.length = 300;
  gazette(w, 'admin', `The Returning Officer ${text}.`, link || '#/rolog');
}

// government sides: a party ('p:<id>') or an independent MP ('i:<id>')
export const sideOf = (w: W, id: Id) => (w.citizens[id]?.party ? 'p:' + w.citizens[id].party : 'i:' + id);
export function sideName(w: W, side: string) {
  return side.startsWith('p:') ? w.parties[side.slice(2)]?.name ?? 'a party' : nm(w, side.slice(2)) + ' (independent)';
}
export function govSides(w: W): string[] {
  if (!w.pm) return [];
  const s = new Set([sideOf(w, w.pm)]);
  if (w.coalition?.status === 'signed') w.coalition.sides.forEach((x: string) => s.add(x));
  return [...s];
}
export const inGovernment = (w: W, id: Id) => govSides(w).includes(sideOf(w, id));
export const majority = (w: W) => Math.floor(w.config.seats / 2) + 1;
export const superMajority = (w: W) => Math.ceil(w.config.seats * 0.8);
export const hosTitle = (w: W) => (w.config.hos === 'monarchy' ? w.config.hosTitle : 'President');

// ---------- the backroom opens in week 3 ----------
export const intrigueOpen = (w: W) => w.phase === 'running' && (w.flags.intrigueNow || w.now >= w.startedAt + w.config.intrigueDelayDays * DAY);
export function needIntrigue(w: W) {
  if (!intrigueOpen(w)) fail('The backroom opens in week 3, once everyone knows the basics.');
}

// ---------- the calendar ----------
export const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const CAL_EVENTS: Record<string, { name: string; what: string }> = {
  payday: { name: 'Payday', what: 'Dividend and pay, a new crisis, new objectives' },
  pmqs: { name: "PM's Questions close", what: 'The 3 most-backed questions must be answered' },
  frontpage: { name: 'Front page', what: 'The week on one shareable page' }
};
export function nextAt(w: W, key: string, after = w.now) {
  const e = w.calendar[key];
  const d = new Date(after);
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), e.hour, 0));
  let add = (e.dow - t.getUTCDay() + 7) % 7;
  let at = t.getTime() + add * DAY;
  if (at <= after) at += WEEK;
  return at;
}
export const weekNo = (w: W) => Math.floor((w.now - w.epoch) / WEEK);

// ---------- formatting ----------
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function fmtTime(w: W, at: number) {
  const d = new Date(at);
  return `${DAYS[d.getUTCDay()].slice(0, 3)} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}, ${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}
export function fmtDay(at: number) {
  const d = new Date(at);
  return `${DAYS[d.getUTCDay()].slice(0, 3)} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}
export function fmtLeft(w: W, at: number) {
  const ms = at - w.now;
  if (ms <= 0) return 'closing now';
  const h = Math.floor(ms / HOUR);
  if (h >= 48) return `${Math.round(h / 24)} days`;
  if (h >= 1) return `${h}h ${Math.floor((ms % HOUR) / 60000)}m`;
  return `${Math.max(1, Math.floor(ms / 60000))}m`;
}
export const ordinal = (n: number) => n + (n % 10 === 1 && n % 100 !== 11 ? 'st' : n % 10 === 2 && n % 100 !== 12 ? 'nd' : n % 10 === 3 && n % 100 !== 13 ? 'rd' : 'th');
