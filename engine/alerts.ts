// What needs one citizen right now: votes to cast, bills to sign, deals waiting. Shown on Today, counted in the
// sidebar, and sent to personal webhooks (each alert's `key` is stable, so a hook fires once per new item).
// Always call it on viewFor(world, me), never the full world, so it can only mention what that person may see.
import { W, Id, nm, isHOS, isPM, isMP, intrigueOpen } from './core';
import { canVote } from './politics';
import { canVoteOn, KINDS } from './proposals';

export type Alert = { key: string; href: string; label: string; title: string; at?: number; urgent?: boolean };

export function needs(w: W, me: Id): Alert[] {
  const out: Alert[] = [];
  if (w.phase === 'convention') {
    const open = w.convention.clauses.filter((x: any) => x.adopted === null && x.votes[me] === undefined && x.options.length && !(x.needs && w.convention.clauses.find((y: any) => y.id === x.needs).adopted === null));
    if (open.length) out.push({ key: 'convention', href: '#/convention', label: 'Founding Convention', title: `${open.length} clause${open.length > 1 ? 's' : ''} to vote on` });
  }
  Object.values(w.elections).forEach((e: any) => {
    if (e.status === 'open' && canVote(w, e, me) && !e.ballots[me]) out.push({ key: 'election:' + e.id, href: '#/election/' + e.id, label: `${Object.keys(e.candidates).length} standing`, title: e.title, at: e.closesAt });
  });
  Object.values(w.proposals).forEach((p: any) => {
    const book = p.stage === 'override' ? p.overrideVotes || {} : p.votes;
    if ((p.stage === 'vote' || p.stage === 'override') && canVoteOn(w, p, me) && !book[me]) out.push({ key: `prop:${p.id}:${p.stage}`, href: '#/p/' + p.id, label: p.stage === 'override' ? 'Override the veto' : `${KINDS[p.kind].name}, your vote`, title: p.title, at: p.stage === 'override' ? p.overrideEndsAt : p.voteEndsAt, urgent: p.kind === 'no_confidence' });
    if (p.stage === 'assent' && isHOS(w, me)) out.push({ key: `assent:${p.id}`, href: '#/p/' + p.id, label: w.config.hos === 'monarchy' ? 'Royal Assent' : 'Sign or veto', title: p.title, at: p.assentDueAt });
    if (p.stage === 'hos' && isHOS(w, me)) out.push({ key: `dissolve:${p.id}`, href: '#/p/' + p.id, label: 'Dissolution request', title: 'The PM asks for an election', at: p.hosDueAt, urgent: true });
  });
  if (!w.pm && w.phase === 'running' && isHOS(w, me)) out.push({ key: 'nopm', href: '#/hos', label: 'No government', title: 'Invite a Prime Minister', at: w.pmInviteDue, urgent: true });
  Object.values(w.crises).forEach((c: any) => {
    if (c.status !== 'open') return;
    if (!c.house && isPM(w, me)) out.push({ key: 'crisis:' + c.id, href: '#/crisis/' + c.id, label: 'Crisis', title: 'You must decide', at: c.decideBy, urgent: true });
    if (c.house && isMP(w, me) && c.votes?.[me] === undefined) out.push({ key: 'crisisvote:' + c.id, href: '#/crisis/' + c.id, label: 'Crisis vote', title: 'The House must choose a response', at: c.decideBy, urgent: true });
  });
  w.questions.forEach((q: any) => q.status === 'open' && ((q.to === 'pm' && isPM(w, me) && q.backers.length >= 3) || q.to === me) && out.push({ key: 'question:' + q.id, href: '#/questions', label: q.formal ? 'Formal question' : 'PMQ to answer', title: q.text, at: q.dueAt }));
  if (w.confidence && isPM(w, me)) out.push({ key: 'confidence:' + w.confidence.deadline, href: '#/new?kind=confidence', label: 'Confidence lost', title: 'Win a confidence vote or fall', at: w.confidence.deadline, urgent: true });
  Object.values(w.parties).forEach((p: any) => p.status === 'forming' && p.invited.includes(me) && !p.signed.includes(me) && out.push({ key: 'cofound:' + p.id, href: '#/parties', label: 'Co-found', title: `Sign to found the ${p.name}`, at: p.formingUntil }));
  if (w.coalition?.status === 'draft' && w.coalition.sides.some((s: string) => (s.startsWith('p:') ? w.parties[s.slice(2)]?.leader : s.slice(2)) === me && !w.coalition.signed[s])) out.push({ key: 'coalition:' + w.coalition.id, href: '#/cabinet', label: 'Coalition', title: 'A deal waits for your signature' });
  if (intrigueOpen(w)) {
    Object.values(w.deals).forEach((d: any) => d.status === 'offered' && d.to === me && out.push({ key: 'deal:' + d.id, href: '#/backroom', label: 'Private', title: `${nm(w, d.from)} offers you a deal` }));
    Object.values(w.demands).forEach((d: any) => d.status === 'sent' && d.target === me && out.push({ key: 'demand:' + d.id, href: '#/backroom', label: 'Private', title: 'Someone has a card on you', at: d.dueAt, urgent: true }));
    Object.values(w.plots).forEach((p: any) => p.status === 'planning' && p.invited[me] === 'pending' && out.push({ key: 'plot:' + p.id, href: '#/plots', label: 'Private', title: 'You have been approached' }));
  }
  return out;
}

