import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import './styles.css';
import { useStore, ONLINE, toast as say } from './store';
import { When } from './ui';
import { nm } from '../../engine/index';
import { SignIn, ResetPassword } from './pages/signin';
import { Icon, getTheme, themeBar, useRoute } from './ui';
import { DemoPanel, DemoRail } from './DemoPanel';
import { Sidebar } from './Sidebar';
import { Coronation } from './Coronation';
import { TABS, where } from './nav';
import { Search } from './search';
import { markSeen } from './pages/today';
import { Today, Gazette, FrontPage, Passport, Laws, Law, Calendar } from './pages/today';
import { House, Proposals, Proposal, NewProposal, Questions, DraftPage } from './pages/house';
import { Elections, Election, Convention } from './pages/elections';
import { Office, Parties, Party, People } from './pages/gov';
import { Government, Money, World, Society, BackroomAll, Honours } from './pages/combined';
import { Nation, Case, Crisis } from './pages/world';
import { Admin, RoLog } from './pages/admin';
import { Learn, Tour } from './pages/learn';
import { Developers, Apps, AppPage, Authorize } from './pages/developers';
import { Streets, TagLanding, Meet, Hunt } from './pages/streets';
import { Market } from './pages/market';
import { Polls } from './pages/glory';
import { CopyDesk } from './pages/copydesk';
import { CopyOverlay } from './copyEdit';
import { watchForUpdates, UpdateBar } from './update';
import { Regime } from './pages/regime';
import { Jail, Powers } from './pages/acts';
import { stateMode, slogans } from './state';
import { useCurrency } from './currency';

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
    house: () => <House />, proposals: () => <Proposals />, p: () => <Proposal id={b} />, new: () => <NewProposal key={qs || ''} query={q} />, draft: () => <DraftPage id={b} />, questions: () => <Questions />,
    elections: () => <Elections />, election: () => <Election id={b} />, convention: () => <Convention />,
    // combined sections: the old addresses open the part they name
    search: () => <Search />, map: () => <Search />, people: () => <People />, redbox: () => <Honours focus="redbox" />, government: () => <Government />, cabinet: () => <Government focus="cabinet" />, offices: () => <Government focus="offices" />, hos: () => <Government focus="hos" />, office: () => <Office id={b} />,
    parties: () => <Parties />, party: () => <Party id={b} />,
    money: () => <Money />, realm: () => <Money />, wallet: () => <Money focus="wallet" />, economy: () => <Money focus="economy" />, banks: () => <Money focus="banks" />, ventures: () => <Money focus="ventures" />, bets: () => <Money focus="bets" />,
    world: () => <World />, foreign: () => <World focus="foreign" />, security: () => <World focus="security" />, army: () => <World focus="army" />,
    society: () => <Society />, press: () => <Society focus="press" />, court: () => <Society focus="court" />, crises: () => <Society focus="crises" />,
    honours: () => <Honours />, season: () => <Honours focus="season" />, fame: () => <Honours focus="fame" />,
    nation: () => <Nation id={b} />, case: () => <Case id={b} />, crisis: () => <Crisis id={b} />,
    regime: () => <Regime />, jail: () => <Jail />, powers: () => <Powers />, backroom: () => <BackroomAll />, plots: () => <BackroomAll focus="plots" />, exile: () => <BackroomAll focus="exile" />, admin: () => <Admin />, learn: () => <Learn />, rolog: () => <RoLog />, developers: () => <Developers />, apps: () => <Apps />, app: () => <AppPage id={b} />, authorize: () => <Authorize query={q} />,
    // an invitation link opened while already signed in: nothing to do but say so
    reset: () => <ResetPassword code={b || ''} />,
    join: () => (setTimeout(() => (say('You are already signed in. Invitations are for new players.'), (location.hash = '#/')), 0), <Today />),
    streets: () => <Streets />, hunt: () => <Hunt />, tag: () => <TagLanding code={b || ''} />, meet: () => <Meet code={b} />, market: () => <Market />, polls: () => <Polls />,
    // the copy desk only exists on the development server (npm run dev)
    ...(import.meta.env.DEV ? { copy: () => <CopyDesk /> } : {})
  };
  return { tab: a || '', key: hash, view: (pages[a || ''] || pages[''])() };
}


function App() {
  const s = useStore();
  // in development, "Edit text" lets you reword any line in place (see copyEdit.tsx)
  const dev = import.meta.env.DEV && <CopyOverlay />;
  const r = useRoute();
  const resetCode = r[0] === 'reset' && /^[A-Za-z0-9]{16,40}$/.test(r[1] || '') ? r[1] : '';
  if (!s.world) return <>{resetCode && !s.loading ? <ResetPassword code={resetCode} /> : <SignIn />}{s.toast && <div class={'toast' + (s.toast.err ? ' err' : '')} role="status">{s.toast.text}</div>}{dev}</>;
  return <><Game />{dev}</>;
}

function Game() {
  const hash = useHash();
  const { toast, offline } = useStore();
  const r = route(hash);
  const here = where(hash).tab.id;
  useEffect(() => markSeen(here), [here]);
  const marked = TABS.map((t) => [t.href, t.label, t.icon, t.id === here] as [string, string, string, boolean]);
  // state stock: the whole site changes colour once the realm is a dictatorship in all but name
  const { world } = useStore();
  const state = !!stateMode(world);
  useEffect(() => void document.documentElement.toggleAttribute('data-state', state), [state]);
  useCurrency(world);
  return (
    <div class={'app' + (ONLINE ? ' online' : '')}>
      <Sidebar tabs={marked} current={'#/' + hash.replace(/^#\/?/, '').split('?')[0]} />
      <main key={r.key}>{state && <Ticker />}<StatusBanner />{r.view}</main>
      <nav class="nav" aria-label="Main"><div class="in">
        {marked.map(([href, label, icon, on]) => (
          <a href={href} class={on ? 'on' : ''} aria-current={on ? 'page' : undefined}>{on && <span class="mark" aria-hidden="true" />}<Icon name={icon} /><span>{label}</span></a>
        ))}
      </div></nav>
      {toast && <div class={'toast' + (toast.err ? ' err' : '')} role="status">{toast.text}</div>}
      {offline && <div class="toast err" role="status">Can't reach the server. Retrying…</div>}
      <Coronation />
      <UpdateBar />
      <Tour />
      {!ONLINE && <DemoPanel />}
      {!ONLINE && <DemoRail />}
    </div>
  );
}

// state stock: the State's slogans across the top of every page (still, for anyone who prefers less motion)
function Ticker() {
  const { world: w } = useStore();
  const line = slogans(w).join('  ★  ');
  return <div class="ticker" aria-hidden="true"><div><span>{line}  ★  </span><span>{line}  ★  </span></div></div>;
}
// on every page while it's true: the clock is paused, or the realm is under emergency rule
function StatusBanner() {
  const { world: w } = useStore();
  const p = w.clock?.pausedAt;
  const m = w.martial;
  const k = w.coup, r = w.regime, t = w.transition;
  if (!p && !m && !k && !r && !t) return null;
  const rule: Record<string, string> = { martial: 'Martial law', junta: 'A junta rules', dictatorship: 'A dictatorship', party: 'A one-party state', civil: 'Rule by decree' };
  return (
    <div class={'status-banner' + (!p ? ' martial' : '')} role="status">
      {p ? <><b>The realm is paused</b>{w.clock.reason ? `: ${w.clock.reason}` : ''}. No deadline passes until the Returning Officer resumes it.</>
        : k ? <><b>A coup is under way</b>, led by {nm(w, k.leader)}. <a href="#/regime">Declare for or against it</a> by <When at={k.endsAt} />.</>
        : r ? <><b>{rule[r.type]}</b>{r.leader ? `, ${r.type === 'civil' ? 'by' : 'led by'} ${nm(w, r.leader)}` : ''}. <a href="#/regime">See what is in force</a>.</>
        : t ? <><b>Provisional government</b>, led by {nm(w, t.leader)}, until the Restoration election. <a href="#/regime">What happens now</a>.</>
        : <><b>{m.emergency ? 'State of emergency' : 'Martial law'}</b>, led by {nm(w, m.leader)}{m.until ? <>, until <When at={m.until} /></> : ''}.</>}
    </div>
  );
}

// the theme you picked last time, before the first paint; and the offline copy of the site, kept on the latest build
{
  const t = getTheme();
  if (t !== 'auto') document.documentElement.setAttribute('data-theme', t);
  themeBar(t);
  watchForUpdates();
}

render(<App />, document.getElementById('app')!);
