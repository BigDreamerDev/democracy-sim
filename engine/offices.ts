// Offices: every role in government is one of these. A law creates an office from a template or from
// a list of powers; whoever holds it gets those powers as buttons.
import { W, Id, approve, fail, newId, pick, shuffle, allCitizens, cit, nm, gazette, stamp, earn, transfer, bal, isPM, isHOS, hasPower, exiled, barred, detained, holdsAnything, own, text, int } from './core';

export const POWERS: Record<string, { label: string; strong?: boolean }> = {
  grant: { label: 'Pay citizens from its weekly budget' },
  rate: { label: 'Set the interest rate' },
  envoy: { label: 'Send envoys and offer treaties' },
  intel: { label: 'Request intelligence on other countries' },
  army: { label: 'Set the Army’s readiness' },
  question: { label: 'Put formal questions to ministers' },
  files: { label: 'Receive the government’s restricted cards' },
  judge: { label: 'Rule on cases before the Court' },
  fine: { label: 'Fine a citizen up to 10 crowns', strong: true },
  block: { label: 'Send one passed bill back for 48 hours each term', strong: true },
  protect: { label: 'Guard one citizen from assassins each day' },
  detain: { label: 'Detain citizens in the Realm Jail', strong: true },
  release: { label: 'Release detainees from the Realm Jail' },
  propose: { label: 'Put bills to the House' },
  govern: { label: 'Run day-to-day government: approve held questions, set the Army’s readiness, and appoint to the PM’s offices with the other officers', strong: true }
};

// officers of state: the holders of offices with the govern power. With two or more, an appointment needs two of them.
export const officers = (w: W): Id[] => [...new Set(Object.values(w.offices).filter((o: any) => o.holder && o.powers.includes('govern')).map((o: any) => o.holder as Id))];
export const canAppoint = (w: W, id: Id, o: any) => (o.fill === 'crown' && isHOS(w, id)) || (o.fill === 'pm' && (isPM(w, id) || (hasPower(w, id, 'govern') && !o.powers.includes('govern'))));

export const TEMPLATES: Record<string, { name: string; title: string; act: string; powers: string[]; fill: string; budget: number; secrecy: string; blurb: string; constitutional?: boolean }> = {
  treasury: { name: 'Treasury', title: 'Chancellor', act: 'Treasury Act', powers: ['grant', 'files'], fill: 'pm', budget: 0, secrecy: 'public', blurb: 'The Treasury maintains financial aspects of the government' },
  reserve: { name: 'Federal Reserve', title: 'Chair of the Reserve', act: 'Currency Act', powers: ['rate', 'files'], fill: 'pm', budget: 0, secrecy: 'public', blurb: 'The Fed determines banking standards and loaning of the nation\n' },
  foreign: { name: 'Foreign Office', title: 'Foreign Minister', act: 'Foreign Affairs Act', powers: ['envoy'], fill: 'pm', budget: 0, secrecy: 'public', blurb: 'The Foreign Office maintains diplomatic relationships with the other 5 nations' },
  security: { name: 'Security Service', title: 'Director', act: 'Security Service Act', powers: ['intel', 'files'], fill: 'pm', budget: 40, secrecy: 'restricted', blurb: 'The Security Service handles discrete intelligence collection of foreign and domestic threats' },
  army: { name: 'The Army', title: 'General', act: 'Defence Act', powers: ['army'], fill: 'pm', budget: 0, secrecy: 'public', blurb: 'The Army acts to defend the Nation, but comes at a financial and loyalty cost.' },
  court: { name: 'Supreme Court', title: 'Justice', act: 'Supreme Court Amendment', powers: ['judge'], fill: 'lot', budget: 0, secrecy: 'public', blurb: 'The Court handles protecting the rights of citizens and protecting against constitutional violations', constitutional: true },
  guard: { name: 'Protection Service', title: 'Bodyguard', act: 'Protection Act', powers: ['protect'], fill: 'pm', budget: 0, secrecy: 'restricted', blurb: 'The Protection Service ensures that those who face a bounty are protected, but only one at a time' },
  whip: { name: 'Chief Whip', title: 'Chief Whip', act: 'Founding Act', powers: ['files'], fill: 'pm', budget: 0, secrecy: 'public', blurb: 'Keeps government MPs voting together. Sees who rebels.' },
  emeritus: { name: 'Office of the Monarch Emeritus', title: 'Monarch Emeritus', act: 'Royal Pensions Act', powers: [], fill: 'crown', budget: 0, secrecy: 'public', blurb: 'A past monarch, granted the office by the reigning one: a royal pension each payday, an honour and a style for life in office.' }
};

export const FILL: Record<string, string> = { pm: 'The Prime Minister appoints', crown: 'The monarch appoints', house: 'MPs elect', citizens: 'Every citizen elects', lot: 'Drawn by lot' };

export function createOffice(w: W, spec: any, law: string) {
  const t = spec.template ? own(TEMPLATES, spec.template) : null;
  const id = spec.template && !w.offices[spec.template] ? spec.template : newId(w, 'o');
  const o: any = {
    id,
    template: spec.template || null,
    name: t ? t.name : spec.name,
    title: t ? t.title : spec.title || spec.name,
    powers: t ? t.powers.slice() : (Array.isArray(spec.powers) ? spec.powers : []).filter((p: string) => own(POWERS, p)),
    fill: t ? t.fill : own(FILL, spec.fill) ? spec.fill : 'pm',
    budget: Math.max(0, Math.round(Number(spec.budget ?? (t ? t.budget : 0))) || 0),
    secrecy: t ? t.secrecy : spec.secrecy || 'public',
    holder: null,
    members: [],
    law,
    at: w.now,
    blocksUsed: 0,
    config: {},
    nominee: null
  };
  w.offices[id] = o;
  if (o.fill === 'lot') {
    const n = spec.template === 'court' ? 3 : 1;
    const pool = shuffle(w, allCitizens(w).filter((c: any) => !holdsAnything(w, c.id) && !exiled(w, c.id)).map((c: any) => c.id));
    o.members = pool.slice(0, n);
    o.holder = o.members[0] || null;
    o.members.forEach((m: Id) => stamp(w, m, o.title, o.name + ', by lot', 'ink'));
  }
  if (o.fill === 'house' || o.fill === 'citizens') {
    const eid = newId(w, 'e');
    w.elections[eid] = { id: eid, kind: 'office', office: id, title: `Election: ${o.name}`, status: 'open', voters: o.fill === 'house' ? 'mps' : 'all', stand: 'all', winners: 1, candidates: {}, ballots: {}, polls: [], predictions: {}, opensAt: w.now, closesAt: w.now + 86400000, results: null };
  }
  gazette(w, 'law', `The ${o.name} is created. ${FILL[o.fill]} its ${String(o.title).toLowerCase()}.`, '#/offices');
  return o;
}

// the Royal Household: while a monarch reigns, two officers of state the monarch appoints without a law.
// Each new reign starts with both posts empty. Parliament can abolish them by bill; they return with the next reign.
export const HOUSEHOLD: Record<string, string> = { chamberlain: 'Lord Chamberlain', privyseal: 'Lord Privy Seal' };
export const HOUSEHOLD_LAW = 'The Royal Household';
export function household(w: W, on: boolean) {
  Object.entries(HOUSEHOLD).forEach(([id, name]) => {
    const o = w.offices[id];
    if (!on) return void (o && o.law === HOUSEHOLD_LAW && delete w.offices[id]);
    if (o) return void ((o.holder = null), (o.nominee = null));
    const made = createOffice(w, { name, powers: ['propose', 'govern'], fill: 'crown' }, HOUSEHOLD_LAW);
    delete w.offices[made.id];
    made.id = id;
    w.offices[id] = made;
  });
}

export function appoint(w: W, actor: Id, officeId: string, target: Id | null) {
  const o = own(w.offices, officeId);
  if (!o) fail('No such office.');
  if (o.fill === 'crown' && !isHOS(w, actor)) fail(`Only the monarch appoints the ${o.title}.`);
  // the monarch alone, at once; otherwise the usual rules for the PM's posts
  const pm = o.fill === 'crown' || isPM(w, actor);
  if (!pm && !hasPower(w, actor, 'govern')) fail('Only the Prime Minister makes appointments.');
  if (o.fill !== 'pm' && o.fill !== 'crown') fail(`The ${o.name} is not appointed by the PM.`);
  if (!pm && o.powers.includes('govern')) fail('Only the Prime Minister fills the offices of state.');
  if (!pm && target === actor) fail('You cannot appoint yourself.');
  target = target || null;
  if (target) {
    const t = cit(w, target);
    if (!t.active) fail('They are no longer a citizen.');
    if (exiled(w, target)) fail('They are in exile.');
    if (barred(w, target)) fail('They are barred from office for now.');
    if (detained(w, target)) fail('A detainee cannot hold office.');
    if (w.regime?.type === 'party' && t.party !== w.regime.party) fail('Only members of the Party may hold office.');
  }
  // the Monarch Emeritus: only someone who has reigned before, and not the one reigning now
  if (o.template === 'emeritus' && target) {
    const past = (w.fame?.monarchs || []).filter((m: any) => m.id === target).pop();
    if (!past) fail('Only someone who has reigned before can be Monarch Emeritus.');
    if (w.hos.holder === target) fail('The reigning monarch cannot be their own emeritus.');
  }
  // an officer of state proposes; a second officer agreeing to the same choice makes it so
  if (!pm) {
    const others = officers(w).filter((id) => id !== actor);
    const n = o.nominee;
    if (others.length && !(n && n.target === target && n.by !== actor && others.includes(n.by))) {
      if (n && n.by === actor && n.target === target) fail('You have already proposed that. Another officer of state must agree.');
      o.nominee = { target, by: actor, at: w.now };
      gazette(w, 'government', `${nm(w, actor)} proposes ${target ? nm(w, target) + ' as ' + o.title : 'leaving the post of ' + o.title + ' vacant'}. Another officer of state must agree.`, '#/office/' + o.id);
      return;
    }
  }
  o.nominee = null;
  // a Monarch Emeritus who loses the office loses the style that came with it (the honour and the stamp stay)
  if (o.template === 'emeritus' && o.holder && o.holder !== target && o.style) {
    const prev = w.citizens[o.holder];
    if (prev?.titles) prev.titles = prev.titles.filter((x: string) => x !== o.style);
    o.style = null;
  }
  if (target) {
    const t = cit(w, target);
    const promised = Object.entries(w.coalition?.promises || {}).find(([k]) => k === officeId)?.[1];
    o.holder = target;
    t.stats.heldOffice = true;
    if (o.template === 'emeritus') return grantEmeritus(w, o, target, actor);
    stamp(w, target, o.title, 'Appointed by ' + nm(w, actor), 'ink');
    gazette(w, 'government', `${t.name} is appointed ${o.title}.`, '#/offices');
    if (promised && promised !== target) gazette(w, 'government', `The PM broke a coalition promise: the ${o.title} post was promised to ${nm(w, promised as string)}.`, '#/cabinet');
  } else {
    o.holder = null;
    gazette(w, 'government', `The post of ${o.title} is left vacant.`);
  }
}

export function useGrant(w: W, actor: Id, officeId: string, target: Id, amount: number, reason: string) {
  if ((w.conditions || []).some((c: any) => c.type === 'outage' && c.until > w.now)) fail('The Treasury’s systems are down: no grants until the outage ends.');
  const o = own(w.offices, officeId);
  if (!o || o.holder !== actor || !o.powers.includes('grant')) fail('You cannot pay out from that office.');
  const why = text(reason, 4, 200, 'reason');
  amount = int(amount, 1, 100, 'grant');
  if (!cit(w, target).active) fail('They are no longer a citizen.');
  if (target === actor) fail('Grants go to someone else.');
  const from = o.id === 'treasury' ? 'treasury' : 'office:' + o.id;
  // a grant spends what is there; it never makes the Treasury borrow
  if (bal(w, from) < amount) fail(`The ${o.name} has only ${bal(w, from)} crowns.`);
  transfer(w, from, 'c:' + target, amount, `Grant from the ${o.name}: ${why}`);
  gazette(w, 'money', `The ${o.name} pays ${nm(w, target)} ${amount} crowns: ${why}.`, '#/offices');
}

export function useFine(w: W, actor: Id, officeId: string, target: Id, amount: number, reason: string) {
  const o = own(w.offices, officeId);
  if (!o || (o.holder !== actor && !o.members.includes(actor)) || !o.powers.includes('fine')) fail('That office cannot fine anyone.');
  amount = int(amount, 1, 10, 'fine');
  const why = text(reason, 4, 200, 'reason');
  if (!cit(w, target).active) fail('They are no longer a citizen.');
  transfer(w, 'c:' + target, 'treasury', amount, `Fined by the ${o.name}: ${why}`);
  gazette(w, 'money', `The ${o.name} fines ${nm(w, target)} ${amount} crowns: ${why}.`);
}

// weekly office budgets are swept back and refilled at payday
export function fundOffices(w: W) {
  Object.values(w.offices).forEach((o: any) => {
    // older worlds may hold a budget that isn't a whole positive number; skip it rather than stop payday
    const budget = Math.round(Number(o.budget));
    if (!(budget > 0) || o.id === 'treasury') return;
    const acct = 'office:' + o.id;
    if (bal(w, acct) > 0) transfer(w, acct, 'treasury', bal(w, acct), `Unspent ${o.name} budget returned`);
    transfer(w, 'treasury', acct, budget, `${o.name} weekly budget`);
  });
}

export function officePay(w: W) {
  return Object.values(w.offices).filter((o: any) => o.holder && (o.fill === 'pm' || o.fill === 'crown')).map((o: any) => (o.template === 'emeritus' ? { id: o.holder, why: 'Royal pension', amt: w.config.emeritusPay ?? 10 } : { id: o.holder, why: `${o.title} pay` }));
}
// a past monarch made Monarch Emeritus: a style for life in office (their old regnal name, emeritus), an honour and a stamp
function grantEmeritus(w: W, o: any, target: Id, actor: Id) {
  const t = cit(w, target);
  const past = (w.fame?.monarchs || []).filter((m: any) => m.id === target).pop();
  const style = past ? `${past.title} ${past.name} ${past.numeral}, Emeritus` : `${t.name}, Monarch Emeritus`;
  o.style = style;
  t.titles ??= [];
  if (!t.titles.includes(style)) t.titles.push(style);
  stamp(w, target, 'Monarch Emeritus', `Granted by ${nm(w, actor)}`, 'good');
  earn(w, target, 5, 'Made Monarch Emeritus');
  approve(w, target, 3);
  gazette(w, 'hos', `${t.name} is made Monarch Emeritus, to be styled ${style}, with a royal pension of ${w.config.emeritusPay ?? 10} crowns each payday.`, '#/office/' + o.id);
}

export function lotOfficeRefresh(w: W, o: any) {
  if (o.fill !== 'lot') return;
  const pool = allCitizens(w).filter((c: any) => !exiled(w, c.id) && !detained(w, c.id) && !o.members.includes(c.id)).map((c: any) => c.id);
  o.members = o.members.filter((m: Id) => !exiled(w, m) && !detained(w, m));
  const extra = shuffle(w, pool);
  while (o.members.length < (o.template === 'court' ? 3 : 1) && extra.length) o.members.push(extra.shift());
  o.holder = o.members[0] || null;
}

// step down from an office you hold; the post falls vacant and whoever fills it can fill it again
export function resignOffice(w: W, actor: Id, oid: unknown) {
  const o = own(w.offices, oid);
  if (!o || o.holder !== actor) fail('You don’t hold that office.');
  o.holder = null;
  gazette(w, 'government', `${nm(w, actor)} resigns as ${o.title}.`, '#/office/' + o.id);
}
