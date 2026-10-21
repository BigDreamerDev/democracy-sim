// The Streets: the parts of the game played in real life. Everything here is opt-in, and nobody who hasn't
// joined can be targeted or can target anyone. Contracts (Assassins), check-ins, bounties, market stalls and
// civic jobs. Crowns never turn into real money and real money never turns into crowns.
import { W, Id, DAY, HOUR, fail, newId, rand, chance, cit, nm, gazette, earn, spend, stamp, approve, transfer, ca, addCard, needIntrigue, mustBeFree, ghost, hasPower, holderOf, isPM, bump, weekNo, adminDid } from './core';

export const SAFE_ZONES = [
  'Lessons, exams, and anywhere a teacher is teaching',
  'Anyone’s home, unless they invite the game in',
  'CCF, sports fixtures and other school clubs',
  'Roads, buses, trains and anywhere people are travelling',
  'Anywhere it would get someone into real trouble'
];
export const RULES = [
  'Only players who have joined the Streets can be targeted, and only they can take out contracts.',
  'A tag is a light tap or a hand-over. Nothing rougher, nothing that damages anything, no chasing.',
  'Tags in a safe zone do not count. If you were tagged in one, deny it.',
  'You can leave at any time. Contracts on you are refunded, and you can rejoin after a week.',
  'No real money, ever. Crowns stay in the game.'
];
const WORDS = ['pineapple', 'umbrella', 'lighthouse', 'marmalade', 'hovercraft', 'tangerine', 'penguin', 'trombone', 'cardigan', 'walrus', 'kettle', 'origami'];
export const WEAPONS = [
  'Tap them on the shoulder with a spoon',
  'Get them to take a sock from you',
  'Stick a sticky note on their bag or sleeve without them noticing',
  'Get them to say the word “{w}” in conversation',
  'Get a high five from them',
  'Get them to hold a pen you hand them',
  'Get them to say the word “{w}” in the group chat',
  'Hand them a folded paper note and have them open it'
];
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export function newCode(w: W) {
  let s = '';
  for (let i = 0; i < 6; i++) s += CODE_CHARS[Math.floor(rand(w) * CODE_CHARS.length)];
  return s;
}
const normCode = (s: unknown) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12);
export const inStreets = (w: W, id: Id) => !!w.citizens[id]?.streets?.in;
function mustBeIn(w: W, id: Id) {
  if (!inStreets(w, id)) fail('Join the Streets first. It’s opt-in, from the Streets page.');
}
export function streetsOf(w: W) {
  w.streets ??= { zones: SAFE_ZONES.map((text, i) => ({ id: 'z' + i, text, by: 'default' })), contracts: {}, protect: null, meets: [] };
  return w.streets;
}

// ---------- joining and leaving ----------
export function join(w: W, actor: Id, agree: boolean) {
  const c = cit(w, actor);
  if (c.bot) fail('Practice bots do not play in real life.');
  if (agree !== true) fail('Read the rules and tick that you agree.');
  if (c.streets?.in) fail('You are already in.');
  if (c.streets?.leftAt && w.now - c.streets.leftAt < 7 * DAY) fail('You left less than a week ago. You can rejoin a week after leaving.');
  c.streets = { in: true, since: w.now };
  c.tagCode = newCode(w);
  c.meetCode ||= newCode(w);
  gazette(w, 'streets', `${c.name} joins the Streets.`, '#/streets');
}
export function leave(w: W, actor: Id) {
  const c = cit(w, actor);
  if (!c.streets?.in) fail('You are not in the Streets.');
  const s = streetsOf(w);
  Object.values(s.contracts).forEach((k: any) => {
    if (!['live', 'claimed'].includes(k.status) || (k.by !== actor && k.target !== actor)) return;
    k.status = 'refunded';
    transfer(w, 'escrow', ca(k.by), k.crowns, 'Contract refunded');
  });
  Object.values(w.bounties || {}).forEach((b: any) => {
    if (b.by === actor && ['open', 'taken'].includes(b.status)) {
      b.status = 'cancelled';
      transfer(w, 'escrow', ca(b.by), b.reward, 'Bounty refunded');
    } else if (b.taker === actor && b.status === 'taken') reopen(b);
  });
  Object.values(w.stalls || {}).forEach((x: any) => x.by === actor && (x.status = 'closed'));
  c.streets = { in: false, leftAt: w.now };
  c.tagCode = null;
  if (s.protect?.who === actor) s.protect = null;
  gazette(w, 'streets', `${c.name} leaves the Streets.`, '#/streets');
}
export function rotate(w: W, actor: Id, kind?: string) {
  if (kind === 'meet') return void (cit(w, actor).meetCode = newCode(w));
  if (kind && kind !== 'tag') fail('Which code: tag or meet?');
  mustBeIn(w, actor);
  cit(w, actor).tagCode = newCode(w);
}

// ---------- check-ins: meet up in person, scan each other's code ----------
export function meet(w: W, actor: Id, code: string) {
  const c = cit(w, actor);
  const k = normCode(code);
  if (k.length < 6) fail('Type their 6-character code.');
  const other = Object.values(w.citizens).find((x: any) => x.meetCode === k && x.active) as any;
  if (!other) fail('That code isn’t anyone’s. Codes change after each check-in, so ask them to refresh.');
  if (other.id === actor) fail('That’s your own code. Scan theirs.');
  const s = streetsOf(w);
  if (s.meets.some((m: any) => ((m.a === actor && m.b === other.id) || (m.a === other.id && m.b === actor)) && w.now - m.at < 20 * HOUR)) fail(`You already checked in with ${other.name} today.`);
  s.meets.unshift({ a: actor, b: other.id, at: w.now });
  if (s.meets.length > 400) s.meets.length = 400;
  other.meetCode = newCode(w);
  c.meetCode ||= newCode(w);
  [actor, other.id].forEach((id) => {
    earn(w, id, 3, 'Met up in person');
    bump(w, id, 'meets');
  });
  gazette(w, 'streets', `${c.name} and ${other.name} meet up in person.`, '#/meet');
}

// ---------- contracts ----------
export function takeContract(w: W, actor: Id, target: Id, crowns: number) {
  needIntrigue(w);
  mustBeFree(w, actor);
  mustBeIn(w, actor);
  const t = cit(w, target);
  if (target === actor) fail('Pick someone else.');
  if (!inStreets(w, target)) fail(`${t.name} hasn’t joined the Streets, so they can’t be targeted.`);
  if (ghost(w, target)) fail(`${t.name} is already a ghost. Wait until they are back.`);
  const amt = Math.round(Number(crowns));
  if (!(amt >= 10 && amt <= 100)) fail('Stake between 10 and 100 crowns.');
  const s = streetsOf(w);
  if (Object.values(s.contracts).some((k: any) => k.by === actor && ['live', 'claimed'].includes(k.status))) fail('You already have a live contract. Finish it or let it run out.');
  spend(w, actor, 10, 'Took out a contract');
  transfer(w, ca(actor), 'escrow', amt, 'A sealed envelope');
  const weapon = WEAPONS[Math.floor(rand(w) * WEAPONS.length)].replace('{w}', WORDS[Math.floor(rand(w) * WORDS.length)]);
  const id = newId(w, 'ct');
  s.contracts[id] = { id, by: actor, target, weapon, crowns: amt, at: w.now, dueAt: w.now + 72 * HOUR, status: 'live', claimAt: null, claimDue: null, disputes: 0 };
  return id;
}
const mine = (w: W, actor: Id, target: Id) => Object.values(streetsOf(w).contracts).find((k: any) => k.by === actor && k.target === target && ['live', 'claimed'].includes(k.status)) as any;

// the assassin scans or types the target's code: the target showing it is their consent
export function tagByCode(w: W, actor: Id, code: string) {
  const k = normCode(code);
  const t = Object.values(w.citizens).find((x: any) => x.tagCode && x.tagCode === k) as any;
  if (!t) fail('That code isn’t live. Codes change after every tag.');
  if (t.id === actor) fail('That’s your own code.');
  const ct = mine(w, actor, t.id);
  if (!ct) fail(`You have no contract on ${t.name}.`);
  complete(w, ct, 'code');
}
// the assassin says they did it without a code; the target confirms or denies (silence for 24 hours counts as yes)
export function claim(w: W, actor: Id, id: Id) {
  const k = streetsOf(w).contracts[id];
  if (!k || k.by !== actor || k.status !== 'live') fail('That contract is not yours to claim.');
  if (k.disputes >= 2) fail('They have denied it twice. Get their code, or let it run out.');
  k.status = 'claimed';
  k.claimAt = w.now;
  k.claimDue = w.now + 24 * HOUR;
}
export function answerClaim(w: W, actor: Id, id: Id, yes: boolean) {
  const k = streetsOf(w).contracts[id];
  if (!k || k.target !== actor || k.status !== 'claimed') fail('There is nothing to answer.');
  if (yes) return complete(w, k, 'confirmed');
  k.status = 'live';
  k.disputes += 1;
  k.claimAt = k.claimDue = null;
  gazette(w, 'streets', `${nm(w, k.by)} says they got ${nm(w, actor)}. ${nm(w, actor)} says they didn’t.`, '#/streets');
}
// the target owns up: "they got me"
export function gotMe(w: W, actor: Id, by: Id) {
  const ct = mine(w, by, actor);
  if (!ct) fail(`${nm(w, by)} had no contract on you. Nothing happens.`);
  complete(w, ct, 'confessed');
}
export function settleClaim(w: W, k: any) {
  if (k.status === 'claimed') complete(w, k, 'unanswered');
}
function complete(w: W, k: any, how: string) {
  const s = streetsOf(w);
  const t = w.citizens[k.target];
  const by = w.citizens[k.by];
  t.tagCode = newCode(w);
  if (s.protect?.who === k.target && s.protect.until > w.now && chance(w, 0.5)) {
    k.status = 'foiled';
    k.doneAt = w.now;
    transfer(w, 'escrow', ca(k.target), k.crowns, 'Compensation for an attempt on your life');
    by.exiledUntil = w.now + 3 * DAY;
    by.exileNoted = false;
    approve(w, k.by, -8);
    stamp(w, k.by, 'Would-be assassin', `Foiled at ${t.name}`, 'bad');
    stamp(w, k.target, 'Survived', 'Saved by a bodyguard', 'ink');
    bump(w, k.target, 'foiled');
    bump(w, k.by, 'exiled');
    gazette(w, 'scandal', `ATTEMPT ON ${t.name.toUpperCase()} FOILED. A bodyguard steps in. ${by.name} flees into exile for 3 days.`, '#/streets');
    return;
  }
  k.status = 'done';
  k.doneAt = w.now;
  k.how = how;
  transfer(w, 'escrow', ca(k.by), k.crowns, 'Your stake back');
  earn(w, k.by, 10, `Got ${t.name}`);
  t.ghostUntil = w.now + 48 * HOUR;
  t.ghostNoted = false;
  t.deaths = [w.now, ...(t.deaths || [])].slice(0, 3);
  approve(w, k.target, 3);
  bump(w, k.by, 'kills');
  bump(w, k.target, 'deaths');
  stamp(w, k.by, 'Assassin', `Got ${t.name}`, 'bad');
  stamp(w, k.target, 'Assassinated', `By ${by.name}`, 'bad');
  const role = w.pm === k.target ? 'PRIME MINISTER' : w.hos.holder === k.target ? 'HEAD OF STATE' : w.seats.includes(k.target) ? 'MP' : Object.values(w.offices).some((o: any) => o.holder === k.target) ? 'MINISTER' : 'CITIZEN';
  gazette(w, 'scandal', `${role} ${t.name.toUpperCase()} ASSASSINATED. ${by.name} did it. ${t.name} is a ghost for 48 hours: they can vote, and nothing else.`, '#/streets');
}
export function expireContract(w: W, k: any) {
  if (k.status === 'claimed') return complete(w, k, 'unanswered');
  if (k.status !== 'live') return;
  k.status = 'expired';
  transfer(w, 'escrow', 'treasury', k.crowns, 'An unclaimed envelope');
  if (chance(w, 0.5) && w.citizens[k.target]) addCard(w, { title: `${nm(w, k.by)} took out a contract on ${nm(w, k.target)}, and ran out of time.`, about: k.by, from: 'The Streets', level: 'secret', viewers: ['cit:' + k.target] });
}
export function ghostBack(w: W, c: any) {
  c.ghostNoted = true;
  gazette(w, 'streets', `${c.name} is back from the dead.`, '#/streets');
}

// counter-intelligence: how many live contracts are out on someone (never who)
export function sweep(w: W, actor: Id, target?: Id | null) {
  mustBeFree(w, actor);
  const who = target || actor;
  cit(w, who);
  const c = w.citizens[actor];
  if (who !== actor) {
    if (!hasPower(w, actor, 'intel')) fail('Only the Security Service can sweep for someone else.');
  } else {
    if (c.sweptAt && w.now - c.sweptAt < 20 * HOUR) fail('One sweep a day.');
    spend(w, actor, 10, 'Swept for contracts');
    c.sweptAt = w.now;
  }
  const n = Object.values(streetsOf(w).contracts).filter((k: any) => k.target === who && ['live', 'claimed'].includes(k.status)).length;
  addCard(w, { title: `Sweep on ${nm(w, who)}: ${n ? `${n} live contract${n > 1 ? 's' : ''} out on them.` : 'nothing found.'}`, about: null, from: 'Counter-intelligence', level: 'restricted', viewers: ['cit:' + actor] });
}
// the bodyguard covers one person for a day: a hit on them fails half the time, and the assassin is exiled
export function protect(w: W, actor: Id, target: Id) {
  mustBeFree(w, actor);
  if (!hasPower(w, actor, 'protect')) fail('Only the bodyguard protects people.');
  cit(w, target);
  if (!inStreets(w, target)) fail('They are not in the Streets, so nobody can touch them anyway.');
  const s = streetsOf(w);
  if (s.protect && s.protect.by === actor && w.now - s.protect.at < 20 * HOUR && s.protect.who !== target) fail('You can switch who you protect once a day.');
  s.protect = { who: target, by: actor, at: w.now, until: w.now + DAY };
}

// ---------- safe zones: Parliament adds them by law, the RO can add or remove them for safety ----------
export function addZone(w: W, text: string, by: string) {
  const t = String(text || '').trim().replace(/\s+/g, ' ');
  if (t.length < 4 || t.length > 120) fail('Describe the safe zone in 4 to 120 characters.');
  const s = streetsOf(w);
  s.zones.push({ id: newId(w, 'z'), text: t, by });
}
export function adminZone(w: W, actor: Id, a: any) {
  if (!w.citizens[actor]?.admin) fail('Only the Returning Officer manages safe zones.');
  const s = streetsOf(w);
  if (a.remove) {
    const z = s.zones.find((x: any) => x.id === a.remove);
    if (!z) fail('No such safe zone.');
    s.zones = s.zones.filter((x: any) => x !== z);
    adminDid(w, actor, `removed a safe zone: ${z.text}`, '#/streets');
  } else {
    addZone(w, a.add, 'ro');
    adminDid(w, actor, `added a safe zone: ${s.zones[s.zones.length - 1].text}`, '#/streets');
  }
}

// ---------- bounties: real-world jobs for crowns, held in escrow ----------
function reopen(b: any) {
  b.status = 'open';
  b.taker = null;
  b.takenAt = b.takenDue = b.doneAt = b.doneDue = null;
  b.note = '';
}
const clean = (s: unknown, min: number, max: number, what: string) => {
  const t = String(s || '').trim().replace(/\s+/g, ' ');
  if (t.length < min) fail(`Write the ${what}.`);
  if (t.length > max) fail(`Keep the ${what} under ${max} characters.`);
  return t;
};
export function postBounty(w: W, actor: Id, text: string, reward: number) {
  mustBeFree(w, actor);
  mustBeIn(w, actor);
  const t = clean(text, 8, 200, 'task');
  const r = Math.round(Number(reward));
  if (!(r >= 5 && r <= 200)) fail('Offer between 5 and 200 crowns.');
  if (Object.values(w.bounties).filter((b: any) => b.by === actor && ['open', 'taken', 'done'].includes(b.status)).length >= 3) fail('You have 3 bounties going. Settle one first.');
  transfer(w, ca(actor), 'escrow', r, 'Bounty posted');
  const id = newId(w, 'b');
  w.bounties[id] = { id, by: actor, text: t, reward: r, status: 'open', at: w.now, dueAt: w.now + 7 * DAY, taker: null, note: '' };
  gazette(w, 'streets', `Bounty, ${r} crowns: ${t}`, '#/market');
}
const bounty = (w: W, id: Id) => w.bounties[id] || fail('No such bounty.');
export function takeBounty(w: W, actor: Id, id: Id) {
  mustBeFree(w, actor);
  mustBeIn(w, actor);
  const b = bounty(w, id);
  if (b.status !== 'open') fail('Someone else is already on it.');
  if (b.by === actor) fail('That’s your own bounty.');
  b.status = 'taken';
  b.taker = actor;
  b.takenAt = w.now;
  b.takenDue = w.now + 48 * HOUR;
}
export function doneBounty(w: W, actor: Id, id: Id, note: string) {
  const b = bounty(w, id);
  if (b.status !== 'taken' || b.taker !== actor) fail('That bounty isn’t yours to finish.');
  b.status = 'done';
  b.note = String(note || '').trim().slice(0, 200);
  b.doneAt = w.now;
  b.doneDue = w.now + 48 * HOUR;
}
export function confirmBounty(w: W, actor: Id, id: Id, yes: boolean) {
  const b = bounty(w, id);
  if (b.by !== actor || b.status !== 'done') fail('There is nothing to confirm.');
  if (yes) return payBounty(w, b);
  reopen(b);
}
export function payBounty(w: W, b: any) {
  b.status = 'paid';
  b.paidAt = w.now;
  transfer(w, 'escrow', ca(b.taker), b.reward, 'Bounty paid');
  earn(w, b.taker, 3, 'Finished a bounty');
  bump(w, b.taker, 'bounties');
  gazette(w, 'streets', `${nm(w, b.taker)} collects ${b.reward} crowns from ${nm(w, b.by)}: ${b.text}`, '#/market');
}
export function cancelBounty(w: W, actor: Id, id: Id) {
  const b = bounty(w, id);
  if (b.by !== actor) fail('Only the person who posted it can cancel it.');
  if (b.status !== 'open') fail('Someone is on it. You can cancel only while it’s open.');
  b.status = 'cancelled';
  transfer(w, 'escrow', ca(b.by), b.reward, 'Bounty refunded');
}
export function bountyDeadline(w: W, b: any) {
  if (b.status === 'done') return payBounty(w, b);
  if (b.status === 'taken') return reopen(b);
  if (b.status === 'open') {
    b.status = 'expired';
    transfer(w, 'escrow', ca(b.by), b.reward, 'Bounty expired: refunded');
  }
}
export const bountyDue = (b: any) => (b.status === 'done' ? b.doneDue : b.status === 'taken' ? b.takenDue : b.status === 'open' ? b.dueAt : null);
export function removeBounty(w: W, actor: Id, id: Id, reason: string) {
  if (!w.citizens[actor]?.admin) fail('Only the Returning Officer takes bounties down.');
  const b = bounty(w, id);
  if (!['open', 'taken', 'done'].includes(b.status)) fail('That bounty is already settled.');
  const why = clean(reason, 4, 200, 'reason');
  b.status = 'removed';
  b.reason = why;
  transfer(w, 'escrow', ca(b.by), b.reward, 'Bounty removed: refunded');
  adminDid(w, actor, `took down a bounty by ${nm(w, b.by)} (“${b.text}”): ${why}`, '#/market');
}

// ---------- market stalls: sell favours and things, paid through escrow ----------
export function openStall(w: W, actor: Id, title: string, price: number) {
  mustBeFree(w, actor);
  mustBeIn(w, actor);
  const t = clean(title, 4, 120, 'listing');
  const p = Math.round(Number(price));
  if (!(p >= 1 && p <= 200)) fail('Price it between 1 and 200 crowns.');
  if (Object.values(w.stalls).filter((s: any) => s.by === actor && s.status === 'open').length >= 3) fail('You have 3 stalls open. Close one first.');
  const id = newId(w, 'sl');
  w.stalls[id] = { id, by: actor, title: t, price: p, status: 'open', at: w.now, sold: 0, ratings: {} };
  gazette(w, 'streets', `${nm(w, actor)} opens a stall: ${t}, ${p} crowns.`, '#/market');
}
export function closeStall(w: W, actor: Id, id: Id) {
  const s = w.stalls[id];
  if (!s || s.by !== actor) fail('That isn’t your stall.');
  s.status = 'closed';
}
export function buy(w: W, actor: Id, id: Id) {
  mustBeFree(w, actor);
  mustBeIn(w, actor);
  const s = w.stalls[id];
  if (!s || s.status !== 'open') fail('That stall is closed.');
  if (s.by === actor) fail('That’s your own stall.');
  if (Object.values(w.orders).some((o: any) => o.stall === id && o.buyer === actor && ['paid', 'delivered'].includes(o.status))) fail('You already have an order open here.');
  transfer(w, ca(actor), 'escrow', s.price, `Order: ${s.title}`);
  const oid = newId(w, 'or');
  w.orders[oid] = { id: oid, stall: id, title: s.title, buyer: actor, seller: s.by, price: s.price, status: 'paid', at: w.now, dueAt: w.now + 5 * DAY };
}
const order = (w: W, id: Id) => w.orders[id] || fail('No such order.');
export function deliver(w: W, actor: Id, id: Id) {
  const o = order(w, id);
  if (o.seller !== actor || o.status !== 'paid') fail('There is nothing to deliver.');
  o.status = 'delivered';
  o.deliveredAt = w.now;
  o.dueAt = w.now + 3 * DAY;
}
export function receive(w: W, actor: Id, id: Id, stars: number) {
  const o = order(w, id);
  if (o.buyer !== actor || !['paid', 'delivered'].includes(o.status)) fail('There is nothing to confirm.');
  const n = Math.round(Number(stars));
  if (!(n >= 1 && n <= 5)) fail('Rate it 1 to 5 stars.');
  const s = w.stalls[o.stall];
  if (s) s.ratings[actor] = n;
  release(w, o);
}
function release(w: W, o: any) {
  o.status = 'done';
  o.doneAt = w.now;
  transfer(w, 'escrow', ca(o.seller), o.price, `Sold: ${o.title}`);
  const s = w.stalls[o.stall];
  if (s) s.sold += 1;
  bump(w, o.seller, 'sales');
}
export function refund(w: W, actor: Id, id: Id) {
  const o = order(w, id);
  if (o.seller !== actor || !['paid', 'delivered'].includes(o.status)) fail('Only the seller refunds an open order.');
  o.status = 'refunded';
  transfer(w, 'escrow', ca(o.buyer), o.price, `Refund: ${o.title}`);
}
export function orderDeadline(w: W, o: any) {
  if (o.status === 'delivered') return release(w, o);
  if (o.status === 'paid') {
    o.status = 'refunded';
    transfer(w, 'escrow', ca(o.buyer), o.price, `Never delivered, refunded: ${o.title}`);
  }
}
export const rating = (s: any) => {
  const r = Object.values(s.ratings || {}) as number[];
  return r.length ? Math.round((r.reduce((a, b) => a + b, 0) / r.length) * 10) / 10 : null;
};

// ---------- civic jobs: Parliament pays wages by law, the Chancellor (or PM) signs off each claim ----------
export function addJob(w: W, e: any, law: string) {
  const id = newId(w, 'jb');
  w.jobs[id] = { id, title: e.title.trim(), pay: e.pay, law, at: w.now, active: true };
  gazette(w, 'money', `New civic job: ${e.title.trim()}, paid ${e.pay} crowns by the Treasury.`, '#/market');
}
export const approver = (w: W) => holderOf(w, 'treasury') || w.pm;
export function claimJob(w: W, actor: Id, jid: Id, note: string) {
  mustBeFree(w, actor);
  const j = w.jobs[jid];
  if (!j || !j.active) fail('That job no longer exists.');
  const wk = weekNo(w);
  if (w.jobClaims.some((c: any) => c.job === jid && c.by === actor && c.week === wk && c.status !== 'refused')) fail('One claim per job each week.');
  w.jobClaims.unshift({ id: newId(w, 'jc'), job: jid, title: j.title, pay: j.pay, by: actor, note: String(note || '').trim().slice(0, 200), at: w.now, dueAt: w.now + 3 * DAY, week: wk, status: 'pending' });
  if (w.jobClaims.length > 200) w.jobClaims.length = 200;
}
export function approveJob(w: W, actor: Id, cid: Id, yes: boolean) {
  const c = w.jobClaims.find((x: any) => x.id === cid);
  if (!c || c.status !== 'pending') fail('That claim is already settled.');
  const ok = holderOf(w, 'treasury') === actor || (isPM(w, actor) && (!holderOf(w, 'treasury') || holderOf(w, 'treasury') === c.by));
  if (!ok) fail('Only the Chancellor signs off wages (or the PM, if there is no Chancellor).');
  if (c.by === actor) fail('Someone else must sign off your own claim.');
  c.status = yes ? 'paid' : 'refused';
  c.by2 = actor;
  if (yes) {
    transfer(w, 'treasury', ca(c.by), c.pay, `Wage: ${c.title}`);
    bump(w, c.by, 'jobs');
    gazette(w, 'money', `${nm(w, c.by)} is paid ${c.pay} crowns for civic work: ${c.title}.`, '#/market');
  }
}
export const isGhostOk = (cmd: string) => GHOST_OK.includes(cmd) || cmd.startsWith('admin.');
const GHOST_OK = ['election.vote', 'prop.vote', 'crisis.vote', 'convention.vote', 'convention.rank', 'tutorial.visit', 'daily.answer', 'streets.leave', 'streets.newCode', 'streets.answer', 'market.bet', 'stall.receive', 'bounty.confirm'];
