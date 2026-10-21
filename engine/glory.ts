// Glory: what keeps people coming back. Achievements, the daily Red Box (and its streak), the weekly opinion
// poll, season awards and the Hall of Fame, which survives every reset.
import { W, Id, DAY, fail, nm, gazette, earn, spend, stamp, bal, ca, allCitizens, DAYNO, rand, ordinal } from './core';

// ---------- achievements ----------
type Badge = { id: string; name: string; sub: string; hidden?: boolean; test: (c: any, w: W) => boolean };
const L = (c: any, k: string) => c.life?.[k] || 0;
export const BADGES: Badge[] = [
  { id: 'voter', name: 'Ballot box', sub: 'Voted 25 times', test: (c) => L(c, 'votes') >= 25 },
  { id: 'orator', name: 'Orator', sub: 'Spoke in 10 debates', test: (c) => L(c, 'speeches') >= 10 },
  { id: 'lawmaker', name: 'Lawmaker', sub: 'Wrote a law', test: (c) => L(c, 'laws') >= 1 },
  { id: 'statute', name: 'Statute book', sub: 'Wrote 5 laws', test: (c) => L(c, 'laws') >= 5 },
  { id: 'squeaker', name: 'By a whisker', sub: 'Passed something by a single vote', test: (c) => L(c, 'squeakers') >= 1 },
  { id: 'survivor', name: 'Survivor', sub: 'Survived a no-confidence vote as PM', test: (c) => L(c, 'survived') >= 1 },
  { id: 'pm', name: 'Number One', sub: 'Became Prime Minister', test: (c) => L(c, 'pmTerms') >= 1 },
  { id: 'veteran', name: 'Old hand', sub: 'Won 3 general elections', test: (c) => L(c, 'terms') >= 3 },
  { id: 'regular', name: 'Regular', sub: 'Opened the Red Box 7 days running', test: (c) => (c.streak?.best || 0) >= 7 },
  { id: 'devoted', name: 'Devoted', sub: 'Opened the Red Box 30 days running', test: (c) => (c.streak?.best || 0) >= 30 },
  { id: 'neighbour', name: 'Good neighbour', sub: 'Met up in person 10 times', test: (c) => L(c, 'meets') >= 10 },
  { id: 'oddjobs', name: 'Odd jobs', sub: 'Finished 5 bounties', test: (c) => L(c, 'bounties') >= 5 },
  { id: 'shop', name: 'Shopkeeper', sub: 'Made 5 sales', test: (c) => L(c, 'sales') >= 5 },
  { id: 'oracle', name: 'Oracle', sub: 'Won 5 bets', test: (c) => L(c, 'betsWon') >= 5 },
  { id: 'tycoon', name: 'Tycoon', sub: 'Held 500 crowns at once', test: (c) => L(c, 'maxBalance') >= 500 },
  { id: 'civic', name: 'Public servant', sub: 'Paid for civic work 3 times', test: (c) => L(c, 'jobs') >= 3 },
  { id: 'hitman', name: 'Professional', sub: 'Carried out 3 contracts', test: (c) => L(c, 'kills') >= 3 },
  { id: 'firstblood', name: 'First blood', sub: 'Carried out a contract', hidden: true, test: (c) => L(c, 'kills') >= 1 },
  { id: 'cursed', name: 'Cursed', sub: 'Assassinated twice in one week', hidden: true, test: (c) => (c.deaths || []).length >= 2 && c.deaths[0] - c.deaths[1] <= 7 * DAY },
  { id: 'untouchable', name: 'Untouchable', sub: 'Saved by a bodyguard', hidden: true, test: (c) => L(c, 'foiled') >= 1 },
  { id: 'maverick', name: 'Maverick', sub: 'Never voted with the government line, five times over', hidden: true, test: (c) => (c.whip?.rebel || 0) >= 5 && !(c.whip?.loyal || 0) },
  { id: 'turncoat', name: 'Turncoat', sub: 'Joined 3 parties', hidden: true, test: (c) => L(c, 'parties') >= 3 },
  { id: 'hunter', name: 'Hunter', sub: 'Five hits in the Hunt', test: (c) => L(c, 'huntKills') >= 5 },
  { id: 'lastone', name: 'Last one standing', sub: 'Won the Hunt', test: (c) => L(c, 'huntWins') >= 1 },
  { id: 'insider', name: 'Insider', sub: 'Made money betting on something you decided', hidden: true, test: (c) => L(c, 'insider') >= 1 },
  { id: 'exile', name: 'Came back', sub: 'Went into exile', hidden: true, test: (c) => L(c, 'exiled') >= 1 }
];
export function checkBadges(w: W, id: Id) {
  const c = w.citizens[id];
  if (!c || c.bot) return;
  c.badges ||= {};
  BADGES.forEach((b) => {
    if (c.badges[b.id] || !b.test(c, w)) return;
    c.badges[b.id] = w.now;
    stamp(w, id, b.name, b.sub, b.hidden ? 'bad' : 'good');
    earn(w, id, 3, `Achievement: ${b.name}`);
    if (b.hidden) gazette(w, 'quiet', `${c.name} unlocks a secret achievement: ${b.name}. ${b.sub}.`, '#/season');
  });
}

// ---------- the daily Red Box: one question a day, a streak for answering ----------
export const RED_BOX: { q: string; a: string[] }[] = [
  { q: 'A minister is caught napping in the chamber. What should happen?', a: ['A public apology', 'Nothing, we’ve all been there', 'Resignation'] },
  { q: 'Should the realm build a statue of its first Prime Minister?', a: ['Yes, in the square', 'Only after they’re gone', 'Statues are for losers'] },
  { q: 'Kessmark sends us a crate of cheese as a gift. Do we accept?', a: ['Accept with thanks', 'Accept, then check it for spies', 'Send it back'] },
  { q: 'The Speaker wants a bell to call the House to order. Fund it?', a: ['Yes, a big one', 'A small one', 'Shout instead'] },
  { q: 'What should the realm’s national animal be?', a: ['A heron', 'A badger', 'A pigeon'] },
  { q: 'Should MPs wear hats in the chamber?', a: ['Every MP, every day', 'Fridays only', 'Absolutely not'] },
  { q: 'A citizen finds 20 crowns in the street. What’s the decent thing?', a: ['Hand it to the Treasury', 'Keep it', 'Post a bounty to find the owner'] },
  { q: 'Is it fair to bet on a bill you’re voting on?', a: ['Yes, it’s a free market', 'Only if you declare it', 'No, ban it'] },
  { q: 'Who should the realm trust least?', a: ['Kessmark', 'The press', 'Its own Parliament'] },
  { q: 'Should the Gazette print the winner of each day’s Red Box?', a: ['Yes', 'Only big results', 'No, keep it quiet'] },
  { q: 'Should the PM have to answer every question at PMQs?', a: ['Every single one', 'The top three is enough', 'Only if they feel like it'] },
  { q: 'Is a coup ever justified?', a: ['Never', 'Only against a tyrant', 'If it’s funny enough'] },
  { q: 'Should there be a limit on how long one person can be Prime Minister?', a: ['Two terms', 'Four terms', 'No limit'] },
  { q: 'A harbour storm wrecks the fish market. Who pays?', a: ['The Treasury', 'The fishmongers', 'Ask Varnholm for aid'] },
  { q: 'Should the realm have a national anthem?', a: ['Yes, and we write it', 'Hum something', 'No'] },
  { q: 'The Monarch skips a state banquet. Scandal?', a: ['Huge scandal', 'Mild scandal', 'Who cares'] },
  { q: 'Should assassinated ministers keep their jobs when they come back?', a: ['Yes', 'Only if the PM agrees', 'No, fresh start'] },
  { q: 'What’s the best use of a Treasury surplus?', a: ['A bigger dividend', 'Save it', 'A festival'] },
  { q: 'Should there be a second chamber, like a House of Lords?', a: ['Yes', 'Only if I’m in it', 'No'] },
  { q: 'Is lobbying an MP with crowns fair game?', a: ['Yes, it’s declared', 'Cap it', 'Ban it'] },
  { q: 'A rival paper prints a rumour about you. What do you do?', a: ['Sue in the Supreme Court', 'Print a better rumour', 'Ignore it'] },
  { q: 'Should the realm declare a national holiday for its founding?', a: ['Yes', 'Only a half day', 'Work is freedom'] },
  { q: 'Should voting in general elections be compulsory?', a: ['Yes', 'No', 'Only for MPs'] },
  { q: 'Pick a motto for the realm.', a: ['Order and Biscuits', 'Fortune Favours the Loud', 'We Meant to Do That'] },
  { q: 'What should happen to someone who loses three bets in a row?', a: ['Nothing', 'A small tax', 'They become Chancellor'] },
  { q: 'The army asks for new boots. Approve?', a: ['Yes', 'Second-hand boots', 'Sandals'] },
  { q: 'Should the PM live in an official residence?', a: ['A palace', 'A flat above the Treasury', 'A tent'] },
  { q: 'Two MPs fall out in the chat. Who should step in?', a: ['The Speaker', 'The Whip', 'Let them sort it'] },
  { q: 'Should the realm send an envoy to every nation this week?', a: ['Yes, all five', 'Only the friendly ones', 'Stay home'] },
  { q: 'Is it acceptable for the Returning Officer to hold office?', a: ['Yes, it’s all public', 'Only minor offices', 'No'] },
  { q: 'What should the realm’s currency be called if not crowns?', a: ['Ducats', 'Biscuits', 'Crowns are perfect'] },
  { q: 'Should secret deals be banned?', a: ['Yes', 'No', 'Only the boring ones'] },
  { q: 'A bill has a typo in it. Pass it anyway?', a: ['Yes', 'Send it back', 'The typo is now law'] },
  { q: 'Should the realm open its borders to Tessaly?', a: ['Fully', 'For trade only', 'No'] },
  { q: 'What should exiles be allowed to do?', a: ['Nothing', 'Vote', 'Write angry letters'] },
  { q: 'A minister is assassinated during PMQs. What now?', a: ['Carry on', 'Adjourn for the day', 'Declare a day of mourning'] },
  { q: 'Should the Gazette have a horoscope?', a: ['Yes', 'Only for the PM', 'No'] },
  { q: 'Who deserves an honour this week?', a: ['The Speaker', 'Whoever posted the best bounty', 'Nobody, it’s been a bad week'] },
  { q: 'What’s the realm’s biggest problem right now?', a: ['The economy', 'The government', 'Kessmark'] },
  { q: 'Should crowns earn interest under the mattress?', a: ['Yes', 'Banks exist for a reason', 'Mattresses are taxed'] }
];
const qOf = (day: number) => (((day * 11) % RED_BOX.length) + RED_BOX.length) % RED_BOX.length;
export function freshDaily(now: number) {
  const day = DAYNO(now);
  return { day, qi: qOf(day), votes: {}, endsAt: (day + 1) * DAY };
}
export function rollDaily(w: W) {
  const d = w.daily;
  const counts = RED_BOX[d.qi].a.map((_, i) => Object.values(d.votes).filter((v) => v === i).length);
  const n = counts.reduce((a, b) => a + b, 0);
  w.dailyPast = [{ day: d.day, qi: d.qi, counts, n }, ...(w.dailyPast || [])].slice(0, 14);
  if (n >= 3) {
    const top = counts.indexOf(Math.max(...counts));
    gazette(w, 'quiet', `Yesterday’s Red Box: “${RED_BOX[d.qi].q}” ${Math.round((counts[top] / n) * 100)}% said “${RED_BOX[d.qi].a[top]}”.`, '#/polls');
  }
  w.daily = freshDaily(w.now);
}
export function answerDaily(w: W, actor: Id, option: number) {
  const d = w.daily;
  const c = w.citizens[actor];
  if (!c) fail('No such citizen.');
  if (!(Number.isInteger(option) && RED_BOX[d.qi].a[option] !== undefined)) fail('Pick an answer.');
  if (d.votes[actor] !== undefined) fail('You’ve opened today’s Red Box. Come back tomorrow.');
  d.votes[actor] = option;
  const s = c.streak || { n: 0, last: -9, best: 0, freezes: 0 };
  // a streak freeze covers one missed day each; you need enough of them to cover the whole gap
  const gap = d.day - s.last - 1;
  let froze = 0;
  if (gap > 0 && s.n > 0 && gap <= (s.freezes || 0)) {
    s.freezes -= gap;
    froze = gap;
  }
  s.n = gap === 0 || froze ? s.n + 1 : 1;
  s.last = d.day;
  s.best = Math.max(s.best || 0, s.n);
  c.streak = s;
  earn(w, actor, s.n % 7 === 0 ? 5 : 1, s.n % 7 === 0 ? `Red Box streak: ${s.n} days` : froze ? `Opened the Red Box (a freeze saved your streak)` : 'Opened the Red Box');
}
export const MAX_FREEZES = 2;
export const FREEZE_COST = 10;
export function buyFreeze(w: W, actor: Id) {
  const c = w.citizens[actor];
  if (!c) fail('No such citizen.');
  const s = c.streak || { n: 0, last: -9, best: 0, freezes: 0 };
  if ((s.freezes || 0) >= MAX_FREEZES) fail(`You can hold ${MAX_FREEZES} streak freezes at most.`);
  spend(w, actor, FREEZE_COST, 'Bought a Red Box streak freeze');
  s.freezes = (s.freezes || 0) + 1;
  c.streak = s;
}
// the streak still alive today: answered yesterday or today, or a gap the freezes held will cover
export const streakNow = (w: W, c: any) => (c?.streak && c.streak.last >= w.daily.day - 1 - (c.streak.freezes || 0) ? c.streak.n : 0);

// ---------- the weekly opinion poll ----------
export function takePoll(w: W) {
  const cs = allCitizens(w).filter((c: any) => !c.bot);
  if (!cs.length) return;
  const score: Record<string, number> = {};
  cs.forEach((c: any) => {
    const k = c.party && w.parties[c.party]?.status === 'active' ? c.party : 'ind';
    score[k] = (score[k] || 0) + c.approval + (w.seats.includes(c.id) ? 25 : 0) + (w.pm === c.id ? 20 : 0) + rand(w) * 15;
  });
  const total = Object.values(score).reduce((a, b) => a + b, 0) || 1;
  const parties: Record<string, number> = {};
  Object.entries(score).forEach(([k, v]) => (parties[k] = Math.round((v / total) * 100)));
  const pm = w.pm ? Math.round(w.citizens[w.pm].approval * 0.8 + rand(w) * 20) : null;
  w.polls = [{ at: w.now, parties, pm, pmId: w.pm }, ...(w.polls || [])].slice(0, 26);
  const order = Object.entries(parties).sort((a, b) => b[1] - a[1]);
  const name = (k: string) => (k === 'ind' ? 'Independents' : w.parties[k]?.name ?? k);
  gazette(w, 'quiet', `This week’s poll: ${order.slice(0, 3).map(([k, v]) => `${name(k)} ${v}%`).join(', ')}.${pm !== null ? ` The PM’s approval: ${pm}%.` : ''}`, '#/polls');
}

// ---------- season awards ----------
// black marks: the stamps that are scandals (red stamps also mark things like winning a seat, so go by label)
export const INFAMY = ['Broke a deal', 'Leaker', 'Blackmailer', 'Censured', 'Traitor', 'Coup', 'Would-be assassin', 'Assassin'];
const infamous = (c: any, since = 0) => (c.stamps || []).filter((s: any) => INFAMY.includes(s.label) && s.at >= since).length;
const bad = (w: W, c: any) => infamous(c, w.season.startedAt);
export const AWARDS: { id: string; name: string; unit: string; score: (w: W, c: any) => number; hidden?: boolean }[] = [
  { id: 'richest', name: 'Richest', unit: 'crowns', score: (w, c) => bal(w, ca(c.id)), hidden: true },
  { id: 'laws', name: 'Lawmaker of the season', unit: 'laws', score: (_w, c) => c.stats?.laws || 0 },
  { id: 'scandal', name: 'Most scandalous', unit: 'scandals', score: (w, c) => bad(w, c) },
  { id: 'kills', name: 'Deadliest', unit: 'contracts', score: (_w, c) => c.stats?.kills || 0 },
  { id: 'meets', name: 'Socialite', unit: 'check-ins', score: (_w, c) => c.stats?.meets || 0 },
  { id: 'oracle', name: 'Oracle', unit: 'crowns won betting', score: (_w, c) => c.stats?.betCrowns || 0 },
  { id: 'hustle', name: 'Hustler', unit: 'bounties and sales', score: (_w, c) => (c.stats?.bounties || 0) + (c.stats?.sales || 0) }
];
export function leaders(w: W, id: string) {
  const a = AWARDS.find((x) => x.id === id)!;
  return allCitizens(w).filter((c: any) => !c.bot).map((c: any) => ({ id: c.id, n: a.score(w, c) })).filter((r) => r.n > 0).sort((x, y) => y.n - x.n);
}
export function seasonAwards(w: W) {
  const out: any[] = [];
  AWARDS.forEach((a) => {
    const top = leaders(w, a.id)[0];
    if (!top) return;
    out.push({ award: a.id, name: a.name, id: top.id, who: nm(w, top.id), n: top.n, unit: a.unit });
    stamp(w, top.id, a.name, `Season ${w.season.n}`, 'ink');
  });
  if (out.length) gazette(w, 'season', `Season ${w.season.n} awards: ${out.map((x) => `${x.name}, ${x.who}`).join('. ')}.`, '#/fame');
  const f = fame(w);
  f.seasons.unshift({ n: w.season.n, at: w.now, awards: out });
  f.seasons = f.seasons.slice(0, 30);
  records(w);
  return out;
}

// ---------- the Hall of Fame: survives induction and resets ----------
export function fame(w: W) {
  w.fame ??= { pms: [], seasons: [], records: {} };
  return w.fame;
}
export const RECORDS: { id: string; name: string; unit: string; score: (c: any) => number }[] = [
  { id: 'laws', name: 'Most laws written', unit: 'laws', score: (c) => L(c, 'laws') },
  { id: 'terms', name: 'Longest in the House', unit: 'terms won', score: (c) => L(c, 'terms') },
  { id: 'kills', name: 'Most contracts carried out', unit: 'hits', score: (c) => L(c, 'kills') },
  { id: 'deaths', name: 'Most assassinated', unit: 'times', score: (c) => L(c, 'deaths') },
  { id: 'infamy', name: 'Most infamous', unit: 'black marks', score: (c) => infamous(c) },
  { id: 'hunts', name: 'Most Hunts won', unit: 'wins', score: (c) => L(c, 'huntWins') },
  { id: 'streak', name: 'Longest Red Box streak', unit: 'days', score: (c) => c.streak?.best || 0 },
  { id: 'meets', name: 'Most check-ins', unit: 'meet-ups', score: (c) => L(c, 'meets') },
  { id: 'bets', name: 'Best gambler', unit: 'bets won', score: (c) => L(c, 'betsWon') },
  { id: 'rich', name: 'Biggest fortune', unit: 'crowns at once', score: (c) => L(c, 'maxBalance') }
];
export function records(w: W) {
  const f = fame(w);
  allCitizens(w).forEach((c: any) => {
    if (c.bot) return;
    RECORDS.forEach((r) => {
      const n = r.score(c);
      if (n > 0 && n > (f.records[r.id]?.n || 0)) f.records[r.id] = { id: c.id, name: c.name, n, at: w.now };
    });
  });
}
// former Prime Ministers: noticed whenever the PM changes, however it happened
export function trackPM(w: W) {
  const f = fame(w);
  const last = f.pms[0];
  const open = last && !last.to ? last : null;
  if (open && open.id === w.pm) return;
  if (open) open.to = w.now;
  if (w.pm && w.citizens[w.pm] && !w.citizens[w.pm].bot && !(w.induction && !w.induction.done)) {
    f.pms.unshift({ id: w.pm, name: w.citizens[w.pm].name, from: w.now, to: null, n: f.pms.filter((p: any) => p.id === w.pm).length + 1 });
    f.pms = f.pms.slice(0, 60);
  }
}
export const pmLabel = (p: any) => `${p.name}${p.n > 1 ? `, ${ordinal(p.n)} time` : ''}`;

// after any change, by a player or the clock: achievements, and the Hall of Fame's list of Prime Ministers
export function afterChange(w: W) {
  Object.keys(w.citizens).forEach((id) => checkBadges(w, id));
  trackPM(w);
}
