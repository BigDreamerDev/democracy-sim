// The press and the Friday front page, the Supreme Court, and the weekly crisis.
import { W, Id, DAY, WEEK, fail, newId, pick, cit, nm, allCitizens, mustBeFree, gazette, earn, stamp, transfer, ca, meter, approve, tick, isPM, weekNo, standing, fmtDay, addCard, holderOf } from './core';
import { armyLoyalty } from './foreign';

// ---------- press ----------
export function foundPaper(w: W, actor: Id, name: string) {
  mustBeFree(w, actor);
  if ((name || '').trim().length < 3) fail('Name the paper.');
  if (Object.values(w.papers).some((p: any) => p.editor === actor)) fail('You already edit a paper.');
  transfer(w, ca(actor), 'treasury', 10, 'Newspaper registration');
  const id = newId(w, 'np');
  w.papers[id] = { id, name: name.trim(), editor: actor, followers: [actor], at: w.now };
  gazette(w, 'press', `${nm(w, actor)} launches a newspaper, ${name.trim()}.`, '#/press');
}
export function follow(w: W, actor: Id, pid: Id) {
  const p = w.papers[pid];
  if (!p) fail('No such paper.');
  const i = p.followers.indexOf(actor);
  i >= 0 ? p.followers.splice(i, 1) : p.followers.push(actor);
}
export function submitStory(w: W, actor: Id, pid: Id, headline: string, body: string) {
  mustBeFree(w, actor);
  const p = w.papers[pid];
  if (!p) fail('Pick a paper.');
  if ((headline || '').trim().length < 5) fail('Write a headline.');
  const own = p.editor === actor;
  w.stories.unshift({ id: newId(w, 'st'), paper: pid, by: actor, headline: headline.trim(), body: (body || '').trim(), status: own ? 'published' : 'submitted', at: w.now, cheers: [] });
  tick(w, actor, 'stories');
  if (own) earn(w, actor, 1, 'Published a story');
}
export function editStory(w: W, actor: Id, sid: Id, yes: boolean) {
  const s = w.stories.find((x: any) => x.id === sid);
  if (!s || s.status !== 'submitted') fail('That story is not waiting.');
  if (w.papers[s.paper].editor !== actor) fail('Only the editor decides.');
  s.status = yes ? 'published' : 'spiked';
  s.at = w.now;
  if (yes) earn(w, s.by, 1, 'Story published');
}
export function cheer(w: W, actor: Id, sid: Id) {
  const s = w.stories.find((x: any) => x.id === sid);
  if (!s || s.status !== 'published') fail('No such story.');
  if (s.by === actor) fail('You cannot cheer your own story.');
  const i = s.cheers.indexOf(actor);
  if (i >= 0) s.cheers.splice(i, 1);
  else {
    s.cheers.push(actor);
    tick(w, actor, 'cheers');
  }
}

// ---------- the Friday front page ----------
export function makeFrontPage(w: W) {
  const since = w.now - WEEK;
  const stories = w.stories.filter((s: any) => s.status === 'published' && s.at > since);
  const score = (s: any) => s.cheers.length * 2 + (w.papers[s.paper]?.followers.length || 0) / 4 + (s.leak ? 3 : 0);
  const lead = stories.sort((a: any, b: any) => score(b) - score(a))[0] || null;
  if (lead) {
    w.citizens[lead.by].stats.frontPage = true;
    earn(w, lead.by, 5, 'Your story made the front page');
    stamp(w, lead.by, 'Front page', fmtDay(w.now), 'ink');
  }
  const fp = {
    id: newId(w, 'fp'), at: w.now, week: weekNo(w),
    lead: lead ? { headline: lead.headline, body: lead.body, by: lead.by, paper: w.papers[lead.paper]?.name } : null,
    laws: w.laws.filter((l: any) => l.at > since && !l.classified).map((l: any) => ({ ref: l.ref, title: l.title })),
    meters: { prosperity: w.meters.prosperity, stability: w.meters.stability, standing: standing(w) },
    pm: w.pm, dodged: w.questions.filter((q: any) => q.status === 'dodged' && q.at > since).length,
    scandals: w.gazette.filter((g: any) => g.kind === 'scandal' && g.at > since).length,
    nextElection: w.nextGeneralAt
  };
  w.frontpages.unshift(fp);
  w.frontpages = w.frontpages.slice(0, 12);
  gazette(w, 'press', `This week's front page: ${lead ? lead.headline : 'a quiet week in the realm'}.`, '#/frontpage/' + fp.id);
}

// ---------- the Supreme Court ----------
export function fileCase(w: W, actor: Id, question: string, against: string, lawRef: string | null, argument: string) {
  if (!w.offices.court) fail('There is no Supreme Court yet.');
  mustBeFree(w, actor);
  if ((question || '').trim().length < 10) fail('State the question for the Court.');
  transfer(w, ca(actor), 'treasury', 5, 'Court fee');
  const id = newId(w, 'case');
  w.cases[id] = { id, plaintiff: actor, question: question.trim(), against: against || 'the government', lawRef: lawRef || null, args: { plaintiff: (argument || '').trim(), defence: '' }, votes: {}, status: 'open', at: w.now, dueAt: w.now + 3 * DAY };
  gazette(w, 'court', `${nm(w, actor)} brings a case: ${question.trim()}`, '#/case/' + id);
}
export function defendCase(w: W, actor: Id, cid: Id, text: string) {
  const k = w.cases[cid];
  if (!k || k.status !== 'open') fail('That case is closed.');
  if (!isPM(w, actor) && !Object.values(w.offices).some((o: any) => o.holder === actor && o.fill === 'pm')) fail('The government (PM or a minister) answers cases.');
  k.args.defence = (text || '').trim();
}
export function judge(w: W, actor: Id, cid: Id, side: 'plaintiff' | 'defence') {
  const k = w.cases[cid];
  if (!k || k.status !== 'open') fail('That case is closed.');
  if (!(w.offices.court?.members || []).includes(actor)) fail('Only the justices decide.');
  if (side !== 'plaintiff' && side !== 'defence') fail('Find for the plaintiff or the defence.');
  k.votes[actor] = side;
  const p = Object.values(k.votes).filter((v) => v === 'plaintiff').length;
  const d = Object.values(k.votes).filter((v) => v === 'defence').length;
  if (p >= 2 || d >= 2) rule(w, k, p >= 2);
}
export function rule(w: W, k: any, forPlaintiff: boolean) {
  k.status = 'decided';
  k.ruling = forPlaintiff ? 'plaintiff' : 'defence';
  if (forPlaintiff) {
    const c = w.citizens[k.plaintiff];
    c.stats.courtWins = (c.stats.courtWins || 0) + 1;
    earn(w, k.plaintiff, 5, 'Won a case');
    const law = k.lawRef && w.laws.find((l: any) => l.ref === k.lawRef);
    if (law) law.rulings.push(`The Supreme Court ruled for ${nm(w, k.plaintiff)}: ${k.question}`);
  }
  gazette(w, 'court', `The Supreme Court rules for ${forPlaintiff ? nm(w, k.plaintiff) : k.against}: ${k.question}`, '#/case/' + k.id);
}

// ---------- the weekly crisis: the PM picks which meter takes the hit ----------
export const CRISES: { id: string; title: string; text: string; needs?: (w: W) => boolean; options: { label: string; what: string; effects: string[]; run: (w: W) => void }[] }[] = [
  {
    id: 'flood', title: 'The river has flooded', text: 'Homes on the east bank are under water.',
    options: [
      { label: 'Pay for repairs', what: 'The Treasury rebuilds the homes.', effects: ['Treasury −60', 'Stability +3'], run: (w) => (transfer(w, 'treasury', 'nation:varnholm', 60, 'Flood repairs'), meter(w, 'stability', 3, 'Flood homes rebuilt')) },
      { label: 'Ask Varnholm for help', what: 'They send timber and workers, and will expect a favour.', effects: ['Free', 'Varnholm grows impatient later'], run: (w) => w.nations.varnholm.reasons.unshift({ sign: '−', text: 'We owe them for flood help' }) },
      { label: 'Do nothing', what: 'Owners rebuild at their own cost.', effects: ['Stability −6'], run: (w) => meter(w, 'stability', -6, 'The flood was ignored') }
    ]
  },
  {
    id: 'harvest', title: 'The harvest has failed', text: 'Bread will be scarce this week.',
    options: [
      { label: 'Import grain', what: 'The Treasury buys grain abroad.', effects: ['Treasury −40', 'Stability +2'], run: (w) => (transfer(w, 'treasury', 'nation:sundmere', 40, 'Emergency grain'), meter(w, 'stability', 2, 'Grain was imported')) },
      { label: 'Let prices rise', what: 'Bread gets dearer for a while.', effects: ['Prices +5%', 'Prosperity −4'], run: (w) => (w.economy.prices.push(Math.round(w.economy.prices[w.economy.prices.length - 1] * 105) / 100), meter(w, 'prosperity', -4, 'Food prices jumped')) }
    ]
  },
  {
    id: 'insult', title: 'An envoy insulted', text: 'A Kessmark envoy was booed at a public event.',
    options: [
      { label: 'Apologise publicly', what: 'Kessmark is soothed; some citizens are annoyed.', effects: ['Kessmark warms', 'Stability −2'], run: (w) => ((w.nations.kessmark.mood = Math.min(4, w.nations.kessmark.mood + 1)), meter(w, 'stability', -2, 'An unpopular apology')) },
      { label: 'Stand firm', what: 'Kessmark cools; the Army approves.', effects: ['Kessmark cools', 'Army loyalty +1', 'Stability +1'], run: (w) => ((w.nations.kessmark.mood = Math.max(0, w.nations.kessmark.mood - 1)), armyLoyalty(w, 1, 'The government stood firm'), meter(w, 'stability', 1, 'The government stood firm')) }
    ]
  },
  {
    id: 'visit', title: 'A famous visitor', text: 'A celebrated musician wants to play in the realm.',
    options: [
      { label: 'Host a festival', what: 'A great day out, paid by the Treasury.', effects: ['Treasury −30', 'Stability +4', 'Everyone +1 Influence'], run: (w) => (transfer(w, 'treasury', 'nation:orrin', 30, 'Festival fee'), meter(w, 'stability', 4, 'A festival'), allCitizens(w).forEach((c: any) => earn(w, c.id, 1, 'Went to the festival'))) },
      { label: 'Let them busk', what: 'Free, and nobody minds much.', effects: ['Nothing happens'], run: () => {} }
    ]
  },
  {
    id: 'strike', title: 'The dockworkers strike', text: 'Ships sit unloaded in the harbour.',
    options: [
      { label: 'Meet their demands', what: 'A one-off payment ends the strike.', effects: ['Treasury −50', 'Stability +2'], run: (w) => (transfer(w, 'treasury', 'escrow', 50, 'Strike settlement'), transfer(w, 'escrow', 'nation:tessaly', 50, 'Dock contracts'), meter(w, 'stability', 2, 'The strike was settled')) },
      { label: 'Wait it out', what: 'Trade stalls until they give up.', effects: ['Prosperity −5'], run: (w) => meter(w, 'prosperity', -5, 'A long strike') }
    ]
  },
  {
    id: 'rumour', title: 'A run on the banks', text: 'Rumours spread that the banks are short of cash.', needs: (w) => Object.values(w.banks).some((b: any) => b.status === 'open'),
    options: [
      { label: 'Guarantee every deposit', what: 'The Treasury promises to cover savers.', effects: ['Prosperity +2', 'A secret card for the Chancellor'], run: (w) => (meter(w, 'prosperity', 2, 'Deposits were guaranteed'), addCard(w, { title: 'The deposit guarantee has no money behind it. The Treasury could not cover a real run.', about: holderOf(w, 'treasury') || w.pm, from: 'Treasury', level: 'restricted', viewers: ['pm', 'office:treasury'] })) },
      { label: 'Say nothing', what: 'Savers panic and banks lose cash.', effects: ['Prosperity −4', 'Banks lose 20% of cash'], run: (w) => (meter(w, 'prosperity', -4, 'A bank panic'), Object.values(w.banks).forEach((b: any) => { const c = Math.floor((w.accounts['bank:' + b.id] || 0) * 0.2); if (c > 0) transfer(w, 'bank:' + b.id, 'escrow', c, 'Panic withdrawals'); })) }
    ]
  }
];
export function spawnCrisis(w: W) {
  if (w.phase !== 'running' || Object.values(w.crises).some((c: any) => c.status === 'open')) return;
  const t = pick(w, CRISES.filter((c) => !c.needs || c.needs(w)));
  const id = newId(w, 'cr');
  w.crises[id] = { id, type: t.id, status: 'open', at: w.now, decideBy: w.now + DAY, choice: null };
  gazette(w, 'crisis', `Crisis: ${t.title}. The Prime Minister has 24 hours to decide.`, '#/crisis/' + id);
}
export function decideCrisis(w: W, actor: Id | null, id: Id, choice: number) {
  const c = w.crises[id];
  if (!c || c.status !== 'open') fail('That crisis is over.');
  if (actor && !isPM(w, actor)) fail('Only the Prime Minister decides.');
  const t = CRISES.find((x) => x.id === c.type)!;
  const o = t.options[choice];
  if (!o) fail('Pick a response.');
  c.status = 'decided';
  c.choice = choice;
  c.by = actor;
  try {
    o.run(w);
  } catch {}
  if (actor) earn(w, actor, 3, 'Handled a crisis');
  else meter(w, 'stability', -2, 'Nobody handled the crisis');
  gazette(w, 'crisis', `${t.title}: ${actor ? 'the PM chose' : 'nobody decided, so by default:'} "${o.label}".`, '#/crisis/' + id);
}
