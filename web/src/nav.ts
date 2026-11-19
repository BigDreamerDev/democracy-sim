// The map of the site: five tabs, each with a few sections. The sidebar, the phone tab bar and the strip of
// section tabs at the top of every page all read from here, so there is one place to change navigation.
// `routes` are the first path segments that belong to a section; old addresses (#/wallet, #/cabinet…) live on
// as routes of the combined section they now open on.
import { bal, ca, intrigueOpen, canSeeCard } from '../../engine/index';

export type Section = { id: string; label: string; href: string; routes: string[]; show?: (w: any, me: string) => boolean; count?: (w: any, me: string) => string | number | null | undefined };
export type Tab = { id: string; label: string; icon: string; href: string; sections: Section[] };

const openProps = (w: any) => Object.values(w.proposals).filter((p: any) => ['debate', 'vote'].includes(p.stage)).length;
export const TABS: Tab[] = [
  { id: 'today', label: 'Today', icon: 'today', href: '#/', sections: [
    { id: 'today', label: 'Today', href: '#/', routes: [''] },
    { id: 'news', label: 'News', href: '#/gazette', routes: ['gazette', 'frontpage'] },
    { id: 'calendar', label: 'Calendar', href: '#/calendar', routes: ['calendar'] },
    { id: 'search', label: 'Find a page', href: '#/search', routes: ['search', 'map'] }
  ] },
  { id: 'house', label: 'Parliament', icon: 'house', href: '#/house', sections: [
    { id: 'house', label: 'Chamber', href: '#/house', routes: ['house', 'oath'] },
    { id: 'bills', label: 'Bills', href: '#/proposals', routes: ['proposals', 'p', 'new', 'draft'], count: openProps },
    { id: 'questions', label: 'Questions', href: '#/questions', routes: ['questions'] },
    { id: 'government', label: 'Government', href: '#/government', routes: ['government', 'cabinet', 'offices', 'office', 'hos'] },
    { id: 'laws', label: 'Laws', href: '#/laws', routes: ['laws', 'law'] },
    { id: 'powers', label: 'Powers', href: '#/powers', routes: ['powers'], show: (w) => !!(w.acts && (w.acts.jail || w.acts.decrees || w.acts.continuity || w.acts.unity || w.acts.protection || w.acts.press || w.acts.security || w.acts.crown || w.acts.prerogative || w.acts.veto || w.acts.imperial)) || w.config?.hos === 'monarchy' },
    { id: 'regime', label: 'Regime', href: '#/regime', routes: ['regime'], show: (w) => !!(w.coup || w.regime || w.transition || w.reckoning || w.regimes?.length) }
  ] },
  { id: 'politics', label: 'Politics', icon: 'politics', href: '#/elections', sections: [
    { id: 'elections', label: 'Elections', href: '#/elections', routes: ['elections', 'election'], count: (w) => Object.values(w.elections).filter((e: any) => e.status === 'open').length },
    { id: 'parties', label: 'Parties', href: '#/parties', routes: ['parties', 'party'] },
    { id: 'people', label: 'People', href: '#/people', routes: ['people', 'passport'] },
    { id: 'convention', label: 'Convention', href: '#/convention', routes: ['convention'], show: (w) => w.phase === 'convention' },
    { id: 'polls', label: 'Polls', href: '#/polls', routes: ['polls'] }
  ] },
  { id: 'realm', label: 'Realm', icon: 'realm', href: '#/money', sections: [
    { id: 'money', label: 'Money', href: '#/money', routes: ['money', 'realm', 'wallet', 'economy', 'exchange', 'banks', 'ventures', 'bets'], count: (w, me) => bal(w, ca(me)) },
    { id: 'world', label: 'World', href: '#/world', routes: ['world', 'atlas', 'abroad', 'foreign', 'nation', 'security', 'army', 'war'], count: (w) => (w.army?.war ? 'War' : null) },
    { id: 'society', label: 'Society', href: '#/society', routes: ['society', 'press', 'court', 'case', 'crises', 'crisis'] },
    { id: 'backroom', label: 'Backroom', href: '#/backroom', routes: ['backroom', 'plots', 'exile'], count: (w, me) => (intrigueOpen(w) ? w.cards.filter((k: any) => canSeeCard(w, k, me)).length || null : null) },
    { id: 'jail', label: 'Realm Jail', href: '#/jail', routes: ['jail'], show: (w) => !!w.acts?.jail || Object.values(w.citizens).some((c: any) => c.jail), count: (w) => Object.values(w.citizens).filter((c: any) => c.jail && (c.jail.until == null || c.jail.until > w.now)).length || null },
    { id: 'streets', label: 'Streets', href: '#/streets', routes: ['streets', 'hunt', 'market', 'tag', 'meet'] }
  ] },
  { id: 'you', label: 'You', icon: 'you', href: '#/you', sections: [
    { id: 'you', label: 'Passport', href: '#/you', routes: ['you'] },
    { id: 'honours', label: 'Honours', href: '#/honours', routes: ['honours', 'season', 'fame', 'redbox'], count: (w, me) => (w.daily && w.daily.votes?.[me] === undefined ? 1 : null) },
    { id: 'learn', label: 'How to play', href: '#/learn', routes: ['learn', 'ceremonies'] },
    { id: 'apps', label: 'Apps', href: '#/apps', routes: ['apps', 'app', 'developers', 'authorize'] },
    { id: 'admin', label: 'Admin', href: '#/admin', routes: ['admin', 'rolog', 'copy'], show: (w, me) => !!w.citizens[me]?.admin, count: (w) => w.pending?.length || null }
  ] }
];

// under the Imperial Prerogative Act the House is the Privy Council: the tabs say so
export function relabel(w: any) {
  const privy = !!w?.privy;
  const t = TABS.find((x) => x.id === 'house')!;
  t.label = privy ? 'Council' : 'Parliament';
  t.sections.find((s) => s.id === 'house')!.label = privy ? 'Privy Council' : 'Chamber';
  t.sections.find((s) => s.id === 'bills')!.label = privy ? 'Orders' : 'Bills';
}
export function where(hash: string) {
  const seg = hash.replace(/^#\/?/, '').split('?')[0].split('/')[0] || '';
  for (const t of TABS) for (const s of t.sections) if (s.routes.includes(seg)) return { tab: t, section: s, seg };
  return { tab: TABS[0], section: TABS[0].sections[0], seg };
}
// the page at a section's own address (not a detail page like #/p/12): it gets no back link, the tabs do that job
export const isSectionRoot = (hash: string) => {
  const path = hash.replace(/^#\/?/, '').split('?')[0];
  const [a, b] = path.split('/');
  return !b && TABS.some((t) => t.sections.some((s) => s.href === '#/' + (a || '') || (s.routes[0] === (a || '') && !b)));
};
export const visible = (t: Tab, w: any, me: string) => t.sections.filter((s) => !s.show || s.show(w, me));

// every place worth finding, with the words people might type for it; search and the site map (#/search) read this
export type Place = { href: string; title: string; where: string; words: string; show?: (w: any, me: string) => boolean };
const PARTS: [string, string, string, string][] = [
  // [href, title, section id, words]
  ['#/cabinet', 'Cabinet', 'government', 'prime minister ministers appoint sack shadow cabinet coalition confidence'],
  ['#/offices', 'Offices', 'government', 'chancellor treasury reserve foreign security army court whip powers budget'],
  ['#/hos', 'Head of state', 'government', 'king queen monarch president assent veto crown'],
  ['#/wallet', 'Your wallet', 'money', 'crowns balance send pay give money transfer'],
  ['#/economy', 'Treasury and Reserve', 'money', 'tax interest rate dividend inflation budget payday'],
  ['#/banks', 'Banks', 'money', 'loan deposit savings bank'],
  ['#/ventures', 'Ventures', 'money', 'trade invest business abroad'],
  ['#/bets', 'Bets', 'money', 'betting pools odds gamble wager market'],
  ['#/atlas', 'World map', 'world', 'map atlas countries nations abroad geography wars abroad mediate'],
  ['#/abroad', 'Life abroad', 'world', 'defect defector asylum court abroad hostage ransom spy mole agent traitor'],
  ['#/foreign', 'Foreign Office', 'world', 'nations envoys treaties diplomacy relations embassy embargo alliance'],
  ['#/war', 'The war room', 'world', 'war battle front strategy regiments volunteer enlist war bonds'],
  ['#/oath', 'The Imperial Oath', 'house', 'oath allegiance swear refuse empire empress emperor loyalty'],
  ['#/ceremonies', 'Ceremonies', 'learn', 'animations scenes appointments coronation invasion veto seal governor turn off'],
  ['#/exchange', 'The Exchange', 'money', 'stock market shares stocks trade invest dividends portfolio register of interests'],
  ['#/army', 'The Army', 'world', 'military readiness war defence'],
  ['#/security', 'Security Service', 'world', 'intel intelligence spies'],
  ['#/crises', 'Crises', 'society', 'emergency disaster decide'],
  ['#/press', 'The press', 'society', 'newspapers front page story leak scandal'],
  ['#/court', 'Supreme Court', 'society', 'case judge lawsuit sue justice'],
  ['#/plots', 'Plots', 'backroom', 'coup conspiracy overthrow'],
  ['#/jail', 'The Realm Jail', 'jail', 'detained detention prison prisoners'],
  ['#/powers', 'Government powers', 'powers', 'decree continuity national party unity acts'],
  ['#/regime', 'Coups and regimes', 'regime', 'coup junta dictatorship martial law strike decree reckoning'],
  ['#/exile', 'Exile', 'backroom', 'banished traitor pardon'],
  ['#/season', 'This season', 'honours', 'leaderboard awards ranking'],
  ['#/fame', 'Hall of Fame', 'honours', 'records history past seasons'],
  ['#/redbox', 'The Red Box', 'honours', 'daily question streak'],
  ['#/new', 'Table a proposal', 'bills', 'propose new bill draft referendum motion no confidence'],
  ['#/frontpage', 'Front page', 'news', 'newspaper weekly headline'],
  ['#/developers', 'Build an app', 'apps', 'api keys webhooks bot developers'],
  ['#/rolog', 'RO log', 'admin', 'returning officer admin actions log']
];
const WORDS: Record<string, string> = {
  today: 'home dashboard to do needs inbox', news: 'gazette announcements what happened', calendar: 'dates schedule when deadlines',
  search: 'map all pages find', house: 'chamber seats parliament mps speaker', bills: 'proposals vote laws debate aye no', questions: 'pmqs ask minister question time',
  government: 'pm cabinet ministers', laws: 'statute book acts constitution', elections: 'vote ballot stand candidate polls',
  parties: 'join found party leader', people: 'citizens players who is who members directory', convention: 'constitution founding clauses', polls: 'opinion survey approval',
  money: 'crowns wallet', world: 'foreign nations', society: 'press court crises', backroom: 'secret cards deals', streets: 'real life tag bounty safe zones',
  you: 'passport profile name bio account password security settings theme dark mode', honours: 'badges achievements', learn: 'how to play tutorial missions help rules guide', apps: 'api bots integrations', admin: 'returning officer ro'
};
export function places(): Place[] {
  const out: Place[] = [];
  for (const t of TABS) for (const s of t.sections) out.push({ href: s.href, title: s.label === 'Today' ? 'Today' : s.label, where: t.label, words: WORDS[s.id] || '', show: s.show });
  for (const [href, title, sid, words] of PARTS) {
    const t = TABS.find((x) => x.sections.some((s) => s.id === sid))!;
    const s = t.sections.find((x) => x.id === sid)!;
    out.push({ href, title, where: `${t.label} › ${s.label}`, words, show: s.show });
  }
  return out;
}
