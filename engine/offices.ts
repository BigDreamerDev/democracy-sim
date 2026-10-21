// Offices: every role in government is one of these. A law creates an office from a template or from
// a list of powers; whoever holds it gets those powers as buttons.
import { W, Id, fail, newId, pick, shuffle, allCitizens, cit, nm, gazette, stamp, earn, transfer, bal, isPM, exiled, holdsAnything } from './core';

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
  protect: { label: 'Guard one citizen from assassins each day' }
};

export const TEMPLATES: Record<string, { name: string; title: string; act: string; powers: string[]; fill: string; budget: number; secrecy: string; blurb: string; constitutional?: boolean }> = {
  treasury: { name: 'Treasury', title: 'Chancellor', act: 'Treasury Act', powers: ['grant', 'files'], fill: 'pm', budget: 0, secrecy: 'public', blurb: 'Runs the budget. Sees the books, including any quiet borrowing.' },
  reserve: { name: 'Federal Reserve', title: 'Chair of the Reserve', act: 'Currency Act', powers: ['rate', 'files'], fill: 'pm', budget: 0, secrecy: 'public', blurb: 'Sets the interest rate. Lending pushes prices up; a higher rate pulls them down.' },
  foreign: { name: 'Foreign Office', title: 'Foreign Minister', act: 'Foreign Affairs Act', powers: ['envoy'], fill: 'pm', budget: 0, secrecy: 'public', blurb: 'Talks to the five nations, sends envoys and brings treaty offers to the House.' },
  security: { name: 'Security Service', title: 'Director', act: 'Security Service Act', powers: ['intel', 'files'], fill: 'pm', budget: 40, secrecy: 'restricted', blurb: 'Gathers intelligence. Each request risks a spy being caught.' },
  army: { name: 'The Army', title: 'General', act: 'Defence Act', powers: ['army'], fill: 'pm', budget: 0, secrecy: 'public', blurb: 'Defends the realm. Costs upkeep. Its loyalty decides whether a coup succeeds.' },
  court: { name: 'Supreme Court', title: 'Justice', act: 'Supreme Court Amendment', powers: ['judge'], fill: 'lot', budget: 0, secrecy: 'public', blurb: 'Three justices drawn by lot decide whether laws and actions break the constitution.', constitutional: true },
  guard: { name: 'Protection Service', title: 'Bodyguard', act: 'Protection Act', powers: ['protect'], fill: 'pm', budget: 0, secrecy: 'restricted', blurb: 'Guards one citizen a day in the Streets. A hit on them fails half the time, and the would-be assassin is exiled.' },
  whip: { name: 'Chief Whip', title: 'Chief Whip', act: 'Founding Act', powers: ['files'], fill: 'pm', budget: 0, secrecy: 'public', blurb: 'Keeps government MPs voting together. Sees who rebels.' }
};

export const FILL: Record<string, string> = { pm: 'The Prime Minister appoints', house: 'MPs elect', citizens: 'Every citizen elects', lot: 'Drawn by lot' };

export function createOffice(w: W, spec: any, law: string) {
  const t = spec.template ? TEMPLATES[spec.template] : null;
  const id = spec.template && !w.offices[spec.template] ? spec.template : newId(w, 'o');
  const o: any = {
    id,
    template: spec.template || null,
    name: t ? t.name : spec.name,
    title: t ? t.title : spec.name,
    powers: t ? t.powers.slice() : (spec.powers || []).filter((p: string) => POWERS[p]),
    fill: t ? t.fill : spec.fill || 'pm',
    budget: spec.budget ?? (t ? t.budget : 0),
    secrecy: t ? t.secrecy : spec.secrecy || 'public',
    holder: null,
    members: [],
    law,
    at: w.now,
    blocksUsed: 0,
    config: {}
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
    w.elections[eid] = { id: eid, kind: 'office', office: id, title: `Election: ${o.name}`, status: 'open', voters: o.fill === 'house' ? 'mps' : 'all', stand: 'all', winners: 1, candidates: {}, ballots: {}, opensAt: w.now, closesAt: w.now + 86400000, results: null };
  }
  gazette(w, 'law', `The ${o.name} is created. ${FILL[o.fill]} its ${o.title.toLowerCase()}.`, '#/offices');
  return o;
}

export function appoint(w: W, actor: Id, officeId: string, target: Id | null) {
  if (!isPM(w, actor)) fail('Only the Prime Minister makes appointments.');
  const o = w.offices[officeId];
  if (!o) fail('No such office.');
  if (o.fill !== 'pm') fail(`The ${o.name} is not appointed by the PM.`);
  if (target) {
    const t = cit(w, target);
    if (exiled(w, target)) fail('They are in exile.');
    const promised = Object.entries(w.coalition?.promises || {}).find(([k]) => k === officeId)?.[1];
    o.holder = target;
    t.stats.heldOffice = true;
    stamp(w, target, o.title, 'Appointed by ' + nm(w, actor), 'ink');
    gazette(w, 'government', `${t.name} is appointed ${o.title}.`, '#/offices');
    if (promised && promised !== target) gazette(w, 'government', `The PM broke a coalition promise: the ${o.title} post was promised to ${nm(w, promised as string)}.`, '#/cabinet');
  } else {
    o.holder = null;
    gazette(w, 'government', `The post of ${o.title} is left vacant.`);
  }
}

export function useGrant(w: W, actor: Id, officeId: string, target: Id, amount: number, reason: string) {
  const o = w.offices[officeId];
  if (!o || o.holder !== actor || !o.powers.includes('grant')) fail('You cannot pay out from that office.');
  if ((reason || '').trim().length < 4) fail('Say what it is for. Grants are public.');
  const from = o.id === 'treasury' ? 'treasury' : 'office:' + o.id;
  transfer(w, from, 'c:' + target, amount, `Grant from the ${o.name}: ${reason.trim()}`);
  gazette(w, 'money', `The ${o.name} pays ${nm(w, target)} ${Math.round(amount)} crowns: ${reason.trim()}.`, '#/offices');
}

export function useFine(w: W, actor: Id, officeId: string, target: Id, amount: number, reason: string) {
  const o = w.offices[officeId];
  if (!o || (o.holder !== actor && !o.members.includes(actor)) || !o.powers.includes('fine')) fail('That office cannot fine anyone.');
  if (amount > 10) fail('Fines are capped at 10 crowns.');
  if ((reason || '').trim().length < 4) fail('Give a reason.');
  transfer(w, 'c:' + target, 'treasury', amount, `Fined by the ${o.name}: ${reason}`);
  gazette(w, 'money', `The ${o.name} fines ${nm(w, target)} ${amount} crowns: ${reason}.`);
}

// weekly office budgets are swept back and refilled at payday
export function fundOffices(w: W) {
  Object.values(w.offices).forEach((o: any) => {
    if (!o.budget || o.id === 'treasury') return;
    const acct = 'office:' + o.id;
    if (bal(w, acct) > 0) transfer(w, acct, 'treasury', bal(w, acct), `Unspent ${o.name} budget returned`);
    transfer(w, 'treasury', acct, o.budget, `${o.name} weekly budget`);
  });
}

export function officePay(w: W) {
  return Object.values(w.offices).filter((o: any) => o.holder && o.fill === 'pm').map((o: any) => ({ id: o.holder, why: `${o.title} pay` }));
}

export function lotOfficeRefresh(w: W, o: any) {
  if (o.fill !== 'lot') return;
  const pool = allCitizens(w).filter((c: any) => !exiled(w, c.id) && !o.members.includes(c.id)).map((c: any) => c.id);
  o.members = o.members.filter((m: Id) => !exiled(w, m));
  const extra = shuffle(w, pool);
  while (o.members.length < (o.template === 'court' ? 3 : 1) && extra.length) o.members.push(extra.shift());
  o.holder = o.members[0] || null;
}
