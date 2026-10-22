// What needs one citizen right now: votes to cast, bills to sign, deals waiting. Shown on Today, counted in the
// sidebar, and sent to personal webhooks (each alert's `key` is stable, so a hook fires once per new item).
// Always call it on viewFor(world, me), never the full world, so it can only mention what that person may see.
import { W, Id, nm, isHOS, isPM, isMP, intrigueOpen, hasPower, holderOf, sideOf, bal, nextAt, mps, DAY } from './core';
import { RED_BOX } from './glory';
import { canVote , contenders, commands, leaderOfSide, FORM_DAYS } from './politics';
import { canVoteOn, KINDS, whipLine, canWhip, rebelsOn } from './proposals';
import { leaderOfOpposition } from './politics';

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
    const line = p.stage === 'vote' && p.voters === 'mps' ? whipLine(w, p, me) : null;
    if ((p.stage === 'vote' || p.stage === 'override') && canVoteOn(w, p, me) && !book[me]) out.push({ key: `prop:${p.id}:${p.stage}`, href: '#/p/' + p.id, label: p.stage === 'override' ? 'Override the veto' : `${KINDS[p.kind].name}, your vote${line ? ` · whipped ${line === 'aye' ? 'Aye' : 'No'}` : ''}`, title: p.title, at: p.stage === 'override' ? p.overrideEndsAt : p.voteEndsAt, urgent: p.kind === 'no_confidence' });
    // whips: you're voting against your line; or, as the whip, some of yours are; or there's no line yet
    if (line && book[me] && book[me] !== 'abstain' && book[me] !== line) out.push({ key: `rebel:${p.id}:${book[me]}`, href: '#/p/' + p.id, label: 'Against the whip', title: `Your party says ${line === 'aye' ? 'Aye' : 'No'} on ${p.title}. You can change your vote until it closes`, at: p.voteEndsAt });
    if (p.stage === 'vote' && p.voters === 'mps' && canWhip(w, me)) {
      const party = w.citizens[me].party;
      const mine = rebelsOn(w, p).filter((m) => w.citizens[m]?.party === party && m !== me);
      if (mine.length) out.push({ key: `rebels:${p.id}:${mine.length}`, href: '#/p/' + p.id, label: 'Rebellion', title: `${mine.map((m) => nm(w, m)).join(', ')} ${mine.length === 1 ? 'is' : 'are'} voting against your line on ${p.title}`, at: p.voteEndsAt, urgent: mine.length >= 2 });
      if (!p.whips?.[party] && mps(w).filter((m) => w.citizens[m]?.party === party).length >= 2) out.push({ key: `whipline:${p.id}`, href: '#/p/' + p.id, label: 'Set the line', title: `Tell your MPs how to vote on ${p.title}`, at: p.voteEndsAt });
    }
    // the Speaker: a dead heat needs a casting vote; a long debate may need order
    if (w.speaker === me && p.stage === 'vote' && p.voters === 'mps' && !p.casting) {
      const ayes = mps(w).filter((m) => p.votes[m] === 'aye').length;
      const noes = mps(w).filter((m) => p.votes[m] === 'no').length;
      if (ayes && ayes === noes) out.push({ key: `tie:${p.id}:${ayes}`, href: '#/p/' + p.id, label: 'A tie', title: `${p.title} stands at ${ayes} all. Set your casting vote, or it falls`, at: p.voteEndsAt, urgent: true });
    }
    if (w.speaker === me && p.stage === 'debate') {
      const since = p.speeches.length - 1 - p.speeches.map((x: any) => x.side).lastIndexOf('order');
      if (since >= 6) out.push({ key: `order:${p.id}:${Math.floor(since / 6)}`, href: '#/p/' + p.id, label: 'Hansard', title: `${since} speeches on ${p.title} since order was last called`, at: p.debateEndsAt });
    }
    if (p.stage === 'assent' && isHOS(w, me)) out.push({ key: `assent:${p.id}`, href: '#/p/' + p.id, label: w.config.hos === 'monarchy' ? 'Royal Assent' : 'Sign or veto', title: p.title, at: p.assentDueAt });
    if (p.stage === 'hos' && isHOS(w, me)) out.push({ key: `dissolve:${p.id}`, href: '#/p/' + p.id, label: 'Dissolution request', title: 'The PM asks for an election', at: p.hosDueAt, urgent: true });
  });
  if (!w.pm && w.phase === 'running') {
    const who = contenders(w).find((l) => commands(w, l));
    if (isHOS(w, me) && who) out.push({ key: 'nopm:' + who, href: '#/hos', label: 'No government', title: `Invite ${nm(w, who)}, who commands a majority`, at: w.pmInviteDue, urgent: true });
    else if (!who && contenders(w).includes(me) && leaderOfSide(w, sideOf(w, me)) === me) out.push({ key: 'hung:' + (w.formingSince || 0), href: '#/cabinet', label: 'Hung parliament', title: 'Nobody has a majority. Agree a coalition', at: (w.formingSince || w.now) + FORM_DAYS * 86400000 });
  }
  Object.values(w.crises).forEach((c: any) => {
    if (c.status !== 'open') return;
    if (!c.house && isPM(w, me)) out.push({ key: 'crisis:' + c.id, href: '#/crisis/' + c.id, label: 'Crisis', title: 'You must decide', at: c.decideBy, urgent: true });
    if (c.house && isMP(w, me) && c.votes?.[me] === undefined) out.push({ key: 'crisisvote:' + c.id, href: '#/crisis/' + c.id, label: 'Crisis vote', title: 'The House must choose a response', at: c.decideBy, urgent: true });
  });
  w.questions.forEach((q: any) => q.status === 'open' && ((q.to === 'pm' && isPM(w, me) && q.backers.length >= 3) || q.to === me) && out.push({ key: 'question:' + q.id, href: '#/questions', label: q.formal ? 'Formal question' : 'PMQ to answer', title: q.text, at: q.dueAt }));
  if (w.confidence && isPM(w, me)) out.push({ key: 'confidence:' + w.confidence.deadline, href: '#/new?kind=confidence', label: 'Confidence lost', title: 'Win a confidence vote or fall', at: w.confidence.deadline, urgent: true });
  Object.values(w.parties).forEach((p: any) => p.status === 'forming' && p.invited.includes(me) && !p.signed.includes(me) && out.push({ key: 'cofound:' + p.id, href: '#/parties', label: 'Co-found', title: `Sign to found the ${p.name}`, at: p.formingUntil }));
  if (w.coalition?.status === 'draft' && w.coalition.sides.some((s: string) => (s.startsWith('p:') ? w.parties[s.slice(2)]?.leader : s.slice(2)) === me && !w.coalition.signed[s])) out.push({ key: 'coalition:' + w.coalition.id, href: '#/cabinet', label: 'Coalition', title: 'A deal waits for your signature' });
  // the Streets: a claim to answer, your live contract
  Object.values(w.streets?.contracts || {}).forEach((k: any) => {
    if (k.status === 'claimed' && k.target === me) out.push({ key: 'claim:' + k.id + ':' + k.claimAt, href: '#/streets', label: 'The Streets', title: `${nm(w, k.by)} says they got you`, at: k.claimDue, urgent: true });
    if (k.by === me && k.status === 'live') out.push({ key: 'contract:' + k.id, href: '#/streets', label: 'Your contract', title: `${nm(w, k.target)}: ${k.weapon}`, at: k.dueAt });
  });
  const h = w.hunt;
  if (h?.status === 'signup' && w.citizens[me]?.streets?.in && !h.entrants.includes(me)) out.push({ key: `hunt:${h.n}:signup`, href: '#/hunt', label: 'The Hunt', title: `Round ${h.n} is taking sign-ups`, at: h.startsAt });
  if (h?.status === 'running' && h.ring?.[me]) out.push({ key: `hunt:${h.n}:target:${h.ring[me]}`, href: '#/hunt', label: 'The Hunt', title: `You’re hunting ${nm(w, h.ring[me])}`, at: h.endsAt });
  // the market: bounties and orders waiting on you, wages to sign off
  Object.values(w.bounties || {}).forEach((b: any) => {
    if (b.status === 'done' && b.by === me) out.push({ key: 'bounty:' + b.id + ':' + b.doneAt, href: '#/market', label: 'Bounty done?', title: `${nm(w, b.taker)} says they did it: ${b.text}`, at: b.doneDue });
    if (b.status === 'taken' && b.taker === me) out.push({ key: 'bountytaken:' + b.id + ':' + b.takenAt, href: '#/market', label: 'Your bounty', title: b.text, at: b.takenDue });
  });
  Object.values(w.orders || {}).forEach((o: any) => {
    if (o.status === 'paid' && o.seller === me) out.push({ key: 'order:' + o.id, href: '#/market', label: 'Someone bought from you', title: `${nm(w, o.buyer)}: ${o.title}`, at: o.dueAt });
    if (o.status === 'delivered' && o.buyer === me) out.push({ key: 'delivered:' + o.id, href: '#/market', label: 'Did it arrive?', title: o.title, at: o.dueAt });
  });
  // jobs that come with an office: a budget about to be swept back, inflation to answer, cases to decide, a shadow cabinet
  const payday = w.calendar?.payday ? nextAt(w, 'payday') : null;
  (Object.values(w.offices) as any[]).forEach((o) => {
    if (o.holder !== me || o.id === 'treasury' || !(o.budget > 0) || !o.powers.includes('grant')) return;
    const left = bal(w, 'office:' + o.id);
    if (payday && left >= o.budget && payday - w.now < 2 * DAY) out.push({ key: `budget:${o.id}:${payday}`, href: '#/office/' + o.id, label: o.title, title: `${left} crowns of the ${o.name} budget unspent. It goes back to the Treasury at payday`, at: payday });
  });
  if (hasPower(w, me, 'rate') && (w.economy?.lastInflation || 0) > 5) out.push({ key: `rate:${payday}`, href: '#/economy', label: 'The Reserve', title: `Inflation is ${w.economy.lastInflation}%. Consider raising the rate`, at: payday || undefined });
  Object.values(w.cases || {}).forEach((k: any) => {
    if (k.status !== 'open') return;
    if ((w.offices.court?.members || []).includes(me) && !k.votes?.[me]) out.push({ key: 'case:' + k.id, href: '#/case/' + k.id, label: 'Supreme Court', title: k.question, at: k.dueAt });
    if (isPM(w, me) && !k.args?.defence) out.push({ key: 'defend:' + k.id, href: '#/case/' + k.id, label: 'The government is being sued', title: k.question, at: k.dueAt });
  });
  if (w.phase === 'running' && leaderOfOpposition(w) === me && !Object.values(w.shadow || {}).some(Boolean)) out.push({ key: 'shadow:' + (w.season?.n || 0), href: '#/cabinet', label: 'Leader of the Opposition', title: 'Name your shadow cabinet' });
  const signer = holderOf(w, 'treasury') || w.pm;
  (w.jobClaims || []).forEach((c: any) => c.status === 'pending' && c.by !== me && (signer === me || (isPM(w, me) && holderOf(w, 'treasury') === c.by)) && out.push({ key: 'job:' + c.id, href: '#/market', label: 'Wage to sign off', title: `${nm(w, c.by)}: ${c.title}`, at: c.dueAt }));
  (w.ultimatums || []).forEach((u: any) => u.status === 'sent' && (isPM(w, me) || hasPower(w, me, 'envoy')) && out.push({ key: 'ultimatum:' + u.id, href: '#/foreign', label: 'Foreign demand', title: `${w.nations[u.nation]?.name} wants ${u.crowns} crowns`, at: u.dueAt, urgent: true }));
  if (w.daily && w.daily.votes?.[me] === undefined && w.citizens[me] && !w.citizens[me].bot) out.push({ key: 'daily:' + w.daily.day, href: '#/honours', label: 'The Red Box', title: RED_BOX[w.daily.qi].q, at: w.daily.endsAt });
  if (intrigueOpen(w)) {
    Object.values(w.deals).forEach((d: any) => d.status === 'offered' && d.to === me && out.push({ key: 'deal:' + d.id, href: '#/backroom', label: 'Private', title: `${nm(w, d.from)} offers you a deal` }));
    Object.values(w.demands).forEach((d: any) => d.status === 'sent' && d.target === me && out.push({ key: 'demand:' + d.id, href: '#/backroom', label: 'Private', title: 'Someone has a card on you', at: d.dueAt, urgent: true }));
    Object.values(w.plots).forEach((p: any) => p.status === 'planning' && p.invited[me] === 'pending' && out.push({ key: 'plot:' + p.id, href: '#/plots', label: 'Private', title: 'You have been approached' }));
  }
  return out;
}

