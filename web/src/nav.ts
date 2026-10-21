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
    { id: 'search', label: 'Search', href: '#/search', routes: ['search'] }
  ] },
  { id: 'house', label: 'Parliament', icon: 'house', href: '#/house', sections: [
    { id: 'house', label: 'Chamber', href: '#/house', routes: ['house'] },
    { id: 'bills', label: 'Bills', href: '#/proposals', routes: ['proposals', 'p', 'new'], count: openProps },
    { id: 'questions', label: 'Questions', href: '#/questions', routes: ['questions'] },
    { id: 'government', label: 'Government', href: '#/government', routes: ['government', 'cabinet', 'offices', 'office', 'hos'] },
    { id: 'laws', label: 'Laws', href: '#/laws', routes: ['laws', 'law'] }
  ] },
  { id: 'politics', label: 'Politics', icon: 'politics', href: '#/elections', sections: [
    { id: 'elections', label: 'Elections', href: '#/elections', routes: ['elections', 'election'], count: (w) => Object.values(w.elections).filter((e: any) => e.status === 'open').length },
    { id: 'parties', label: 'Parties', href: '#/parties', routes: ['parties', 'party'] },
    { id: 'convention', label: 'Convention', href: '#/convention', routes: ['convention'], show: (w) => w.phase === 'convention' },
    { id: 'polls', label: 'Polls', href: '#/polls', routes: ['polls'] }
  ] },
  { id: 'realm', label: 'Realm', icon: 'realm', href: '#/money', sections: [
    { id: 'money', label: 'Money', href: '#/money', routes: ['money', 'realm', 'wallet', 'economy', 'banks', 'ventures', 'bets'], count: (w, me) => bal(w, ca(me)) },
    { id: 'world', label: 'World', href: '#/world', routes: ['world', 'foreign', 'nation', 'security', 'army'] },
    { id: 'society', label: 'Society', href: '#/society', routes: ['society', 'press', 'court', 'case', 'crises', 'crisis'] },
    { id: 'backroom', label: 'Backroom', href: '#/backroom', routes: ['backroom', 'plots', 'exile'], count: (w, me) => (intrigueOpen(w) ? w.cards.filter((k: any) => canSeeCard(w, k, me)).length || null : null) },
    { id: 'streets', label: 'Streets', href: '#/streets', routes: ['streets', 'hunt', 'market', 'tag', 'meet'] }
  ] },
  { id: 'you', label: 'You', icon: 'you', href: '#/you', sections: [
    { id: 'you', label: 'Passport', href: '#/you', routes: ['you', 'passport'] },
    { id: 'honours', label: 'Honours', href: '#/honours', routes: ['honours', 'season', 'fame', 'redbox'], count: (w, me) => (w.daily && w.daily.votes?.[me] === undefined ? 1 : null) },
    { id: 'learn', label: 'How to play', href: '#/learn', routes: ['learn'] },
    { id: 'apps', label: 'Apps', href: '#/apps', routes: ['apps', 'app', 'developers', 'authorize'] },
    { id: 'admin', label: 'Admin', href: '#/admin', routes: ['admin', 'rolog', 'copy'], show: (w, me) => !!w.citizens[me]?.admin, count: (w) => w.pending?.length || null }
  ] }
];

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
