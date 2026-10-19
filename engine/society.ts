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

// ---------- the weekly crisis: the PM picks which meter takes the hit (the list lives in crises.ts) ----------
export { CRISES, spawnCrisis, decideCrisis, voteCrisis, timeoutCrisis, fireQueued } from './crises';
