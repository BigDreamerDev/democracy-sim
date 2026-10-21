import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import './styles.css';
import { useStore, ONLINE } from './store';
import { SignIn } from './pages/signin';
import { Icon, applyTheme, getTheme } from './ui';
import { DemoPanel, DemoRail } from './DemoPanel';
import { Sidebar } from './Sidebar';
import { Today, Gazette, FrontPage, Passport, Laws, Law, Calendar } from './pages/today';
import { House, Proposals, Proposal, NewProposal, Questions } from './pages/house';
import { Elections, Election, Convention } from './pages/elections';
import { Realm, Offices, Office, Cabinet, HOS, Parties, Party } from './pages/gov';
import { Wallet, Economy, Banks, Ventures } from './pages/money';
import { Foreign, Nation, Security, Army, Press, Court, Case, Crises, Crisis, Season } from './pages/world';
import { Backroom, Plots, Exile } from './pages/backroom';
import { Admin, RoLog } from './pages/admin';
import { Learn, Tour } from './pages/learn';
import { Developers, Apps, AppPage, Authorize } from './pages/developers';
import { Streets, TagLanding, Meet, Hunt } from './pages/streets';
import { Market, Bets } from './pages/market';
import { Polls, Fame } from './pages/glory';
import { CopyDesk } from './pages/copydesk';
import { CopyOverlay } from './copyEdit';

const ROOTS = ['', 'house', 'realm', 'laws', 'you', 'gazette'];
function level(hash: string) {
  const [path] = hash.replace(/^#\/?/, '').split('?');
  const seg = path.split('/').filter(Boolean);
  if (!seg.length || (seg.length === 1 && ROOTS.includes(seg[0]))) return 0;
  if (seg[0] === 'new') return 2;
  return seg.length;
}
function useHash() {
  const [h, setH] = useState(location.hash);
  useEffect(() => {
    let prev = location.hash;
    const f = () => {
      const next = location.hash;
      const a = level(prev);
      const b = level(next);
      prev = next;
      const d: any = document;
      if (!d.startViewTransition || matchMedia('(prefers-reduced-motion: reduce)').matches) {
        setH(next);
        window.scrollTo(0, 0);
        return;
      }
      document.documentElement.dataset.nav = b > a ? 'fwd' : b < a ? 'back' : 'tab';
      d.startViewTransition(
        () =>
          new Promise<void>((res) => {
            setH(next);
            setTimeout(() => {
              window.scrollTo(0, 0);
              res();
            }, 0);
          })
      );
    };
    addEventListener('hashchange', f);
    return () => removeEventListener('hashchange', f);
  }, []);
  return h;
}

function route(hash: string) {
  const [path, qs] = hash.replace(/^#\/?/, '').split('?');
  const [a, b] = path.split('/').filter(Boolean);
  const q = new URLSearchParams(qs || '');
  const pages: Record<string, () => any> = {
    '': () => <Today />, gazette: () => <Gazette />, frontpage: () => <FrontPage id={b} />, passport: () => <Passport id={b} />, you: () => <Passport />, laws: () => <Laws />, law: () => <Law refId={b} />, calendar: () => <Calendar />,
    house: () => <House />, proposals: () => <Proposals />, p: () => <Proposal id={b} />, new: () => <NewProposal query={q} />, questions: () => <Questions />,
    elections: () => <Elections />, election: () => <Election id={b} />, convention: () => <Convention />,
    realm: () => <Realm />, offices: () => <Offices />, office: () => <Office id={b} />, cabinet: () => <Cabinet />, hos: () => <HOS />, parties: () => <Parties />, party: () => <Party id={b} />,
    wallet: () => <Wallet />, economy: () => <Economy />, banks: () => <Banks />, ventures: () => <Ventures />,
    foreign: () => <Foreign />, nation: () => <Nation id={b} />, security: () => <Security />, army: () => <Army />, press: () => <Press />, court: () => <Court />, case: () => <Case id={b} />, crises: () => <Crises />, crisis: () => <Crisis id={b} />, season: () => <Season />,
    backroom: () => <Backroom />, plots: () => <Plots />, exile: () => <Exile />, admin: () => <Admin />, learn: () => <Learn />, rolog: () => <RoLog />, developers: () => <Developers />, apps: () => <Apps />, app: () => <AppPage id={b} />, authorize: () => <Authorize query={q} />,
    streets: () => <Streets />, hunt: () => <Hunt />, tag: () => <TagLanding code={b || ''} />, meet: () => <Meet code={b} />, market: () => <Market />, bets: () => <Bets />, polls: () => <Polls />, fame: () => <Fame />,
    // the copy desk only exists on the development server (npm run dev)
    ...(import.meta.env.DEV ? { copy: () => <CopyDesk /> } : {})
  };
  return { tab: a || '', key: hash, view: (pages[a || ''] || pages[''])() };
}

const TABS: [string, string, string, string[]][] = [
  ['#/', 'Today', 'today', ['', 'gazette', 'frontpage']],
  ['#/house', 'House', 'house', ['house', 'proposals', 'p', 'new', 'questions', 'cabinet']],
  ['#/realm', 'Realm', 'realm', []],
  ['#/laws', 'Laws', 'laws', ['laws', 'law', 'convention', 'calendar']],
  ['#/you', 'You', 'you', ['you', 'passport', 'developers', 'authorize', 'learn']]
];

function App() {
  const s = useStore();
  // in development, "Edit text" lets you reword any line in place (see copyEdit.tsx)
  const dev = import.meta.env.DEV && <CopyOverlay />;
  if (!s.world) return <><SignIn />{s.toast && <div class={'toast' + (s.toast.err ? ' err' : '')} role="status">{s.toast.text}</div>}{dev}</>;
  return <><Game />{dev}</>;
}

function Game() {
  const hash = useHash();
  const { toast, offline } = useStore();
  const r = route(hash);
  const known = TABS.some((x) => x[3].includes(r.tab));
  const marked = TABS.map(([href, label, icon, tabs]) => [href, label, icon, tabs.includes(r.tab) || (!known && !tabs.length)] as [string, string, string, boolean]);
  return (
    <div class={'app' + (ONLINE ? ' online' : '')}>
      <Sidebar tabs={marked} current={'#/' + hash.replace(/^#\/?/, '').split('?')[0]} />
      <main key={r.key}>{r.view}</main>
      <nav class="nav" aria-label="Main"><div class="in">
        {marked.map(([href, label, icon, on]) => (
          <a href={href} class={on ? 'on' : ''} aria-current={on ? 'page' : undefined}>{on && <span class="mark" aria-hidden="true" />}<Icon name={icon} /><span>{label}</span></a>
        ))}
      </div></nav>
      {toast && <div class={'toast' + (toast.err ? ' err' : '')} role="status">{toast.text}</div>}
      {offline && <div class="toast err" role="status">Can't reach the server. Retrying…</div>}
      <Tour />
      {!ONLINE && <DemoPanel />}
      {!ONLINE && <DemoRail />}
    </div>
  );
}

render(<App />, document.getElementById('app')!);
