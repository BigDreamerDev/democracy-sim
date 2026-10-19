// The tutorial: how the realm works, the induction missions, and the first-visit tour.
import { useEffect, useState } from 'preact/hooks';
import { useStore, act } from '../store';
import { Page, Sec, Card, Btn, Seal, Left } from '../ui';
import { TUTORIAL, fmtDay, hosTitle } from '../../../engine/index';

const SYSTEMS: { id: string; title: string; href: string; body: (w: any) => string }[] = [
  { id: 'Basics', title: 'How you win', href: '#/season', body: () => 'Everything you do earns Influence: voting, speaking, holding office, getting laws passed. Influence is spent on political moves (a third proposal at once, a fast-tracked debate, a plot). Each season, the player who earned the most is champion, and everyone has a secret ambition worth 30 more.' },
  { id: 'Elections', title: 'Elections', href: '#/elections', body: (w) => `Every ${w.config.termDays / 7} weeks the whole realm votes. You get one vote; the ${w.config.seats} candidates with the most votes nationwide take the seats. If a seat falls empty, the next in line takes it. Ballots are secret.` },
  { id: 'Parties', title: 'Parties', href: '#/parties', body: () => 'A party needs a founder and two co-founders. Parties that split their vote lose seats, so they pick who stands. The biggest group in the House usually forms the government.' },
  { id: 'Parliament', title: 'Parliament', href: '#/house', body: (w) => `The ${hosTitle(w)} invites a Prime Minister, who appoints ministers. MPs table proposals: bills change the law, and motions can censure someone or bring down the government. Each gets a debate, then a vote. Anyone can ask questions at PMQs.` },
  { id: 'Money', title: 'Money', href: '#/wallet', body: (w) => `Crowns are the currency. Every payday everyone gets ${w.config.dividend}, and MPs and ministers are paid more. Send crowns to anyone, lobby MPs in public, open a bank once the Banking Act passes, or invest abroad.` },
  { id: 'Press', title: 'The press', href: '#/press', body: () => 'Anyone can start a paper and file stories. The most-cheered story of the week makes the front page. Secrets leaked to a paper become front-page news.' },
  { id: 'Crises', title: 'Crises', href: '#/crises', body: () => 'Every payday something goes wrong. The PM decides how to respond within a day; the big ones go to a vote of MPs. Some choices come back to bite weeks later. Every choice moves Prosperity, Stability or relations abroad.' },
  { id: 'Backroom', title: 'The backroom', href: '#/backroom', body: () => 'After the first two weeks: secret cards about real players, private deals, demands, and plots to seize power. Get caught plotting and you go into exile.' }
];

export function Learn() {
  const { world: w, me } = useStore();
  const c = w.citizens[me];
  const done = c.tutorial || {};
  const n = TUTORIAL.filter((m) => done[m.id]).length;
  const induction = w.induction && !w.induction.done;
  useEffect(() => void (!done.welcome && act('tutorial.visit', { mission: 'welcome' })), []);
  return (
    <Page back={['#/you', 'You']} kicker={induction ? 'Induction week' : 'Learn the realm'} title="How to play"
      intro={induction
        ? <>This week is practice. Try everything: it all resets on <b>{fmtDay(w.induction.until)}</b> (in <Left at={w.induction.until} />), when the real first election opens. Each mission you finish is worth 1 real Influence afterwards.</>
        : w.phase === 'convention' ? 'First, the Founding Convention writes the rules. Then a week of practice, then the real thing.' : 'Everything in the realm, in two minutes. The missions walk you through each part by doing it once.'}>
      <Card kind="tint" style={{ marginTop: 16 }}>
        <div class="row"><b>Induction missions</b><b class="tnum">{n} of {TUTORIAL.length}</b></div>
        <div class="tut-bar" aria-hidden="true"><i style={{ width: `${(n / TUTORIAL.length) * 100}%` }} /></div>
        <ol class="missions">
          {TUTORIAL.map((m, i) => (
            <li class={done[m.id] ? 'done' : ''}>
              <span class="tickbox" aria-hidden="true">{done[m.id] ? '✓' : i + 1}</span>
              <span style={{ flex: 1, minWidth: 0 }}><b>{m.title}</b><span class="small muted">{m.text}</span></span>
              {!done[m.id] && <a class="btn small ghost" href={m.href}>Go</a>}
            </li>
          ))}
        </ol>
        {n === TUTORIAL.length && <p style={{ margin: '10px 0 0' }}><b>All done.</b> {induction ? 'You will get the Inducted stamp when the real game starts.' : 'You are fully inducted.'}</p>}
      </Card>
      <Sec title="The realm in eight parts">
        <div class="stack">
          {SYSTEMS.map((s) => (
            <details class="learn-sys">
              <summary><b>{s.title}</b><span class="small muted">{TUTORIAL.filter((m) => m.system === s.id).length ? `${TUTORIAL.filter((m) => m.system === s.id && done[m.id]).length}/${TUTORIAL.filter((m) => m.system === s.id).length} missions` : ''}</span></summary>
              <p>{s.body(w)}</p>
              <a href={s.href}>Open {s.title.toLowerCase()} →</a>
            </details>
          ))}
        </div>
      </Sec>
      <Sec title="Three rules of thumb">
        <ol class="list small">
          <li><b>Nothing binds the realm without a law.</b> Treaties, wars, new offices, banks: Parliament has to pass them.</li>
          <li><b>Your vote is secret; your speeches are not.</b> Everything you say in public goes in the Gazette.</li>
          <li><b>The Returning Officer runs the game and plays it.</b> Every admin action is announced and listed in the public log.</li>
        </ol>
      </Sec>
      <Sec><Btn kind="ghost" small onClick={() => openTour()}>Replay the welcome tour</Btn></Sec>
    </Page>
  );
}

// ---------- the first-visit tour ----------
const TOUR_KEY = 'realm-tour-v1';
let opener: (() => void) | null = null;
export const openTour = () => opener?.();
const SLIDES: { title: string; body: (w: any) => string }[] = [
  { title: 'Welcome to the realm', body: (w) => `${w.config.realmName} is a country run by this group chat. You vote, stand, legislate, trade and scheme. Everything happens here; the group chat is for arguing about it.` },
  { title: 'Today is your front door', body: () => 'Today shows what needs you right now, with a red badge when something does: a vote closing, a bill to sign, a deal waiting. Check it once a day.' },
  { title: 'Five tabs', body: () => 'Today for what matters now. House for Parliament. Realm for everything else: offices, money, the press, crises. Laws for the statute book. You for your passport.' },
  { title: 'The rhythm of the week', body: (w) => `Payday is ${['Sundays', 'Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays'][w.calendar.payday.dow]}, when money arrives and a crisis lands. PM's Questions and the front page come later in the week. Elections every few weeks.` },
  { title: 'Learn by doing', body: (w) => (w.phase === 'convention' ? 'After the Convention comes induction week: a full week of practice that resets at the end. Use it to try everything.' : 'The missions on How to play walk you through each part of the game. You can reopen this tour there any time.') }
];
export function Tour() {
  const { world: w } = useStore();
  const [open, setOpen] = useState(() => {
    try {
      return !localStorage.getItem(TOUR_KEY);
    } catch {
      return false;
    }
  });
  const [i, setI] = useState(0);
  opener = () => (setI(0), setOpen(true));
  if (!open) return null;
  const close = () => {
    try {
      localStorage.setItem(TOUR_KEY, '1');
    } catch {}
    setOpen(false);
  };
  const s = SLIDES[i];
  return (
    <div class="tour" role="dialog" aria-modal="true" aria-label="Welcome tour" onClick={(e) => e.target === e.currentTarget && close()}>
      <div class="tour-card" key={i}>
        <Seal size={54} />
        <div class="kicker" style={{ marginTop: 10 }}>{i + 1} of {SLIDES.length}</div>
        <h2 class="title" style={{ fontSize: 32, margin: '2px 0 8px', fontFamily: 'var(--serif)', fontWeight: 400 }}>{s.title}</h2>
        <p style={{ margin: 0 }}>{s.body(w)}</p>
        <div class="tour-dots" aria-hidden="true">{SLIDES.map((_, j) => <i class={j === i ? 'on' : ''} />)}</div>
        <div class="row" style={{ gap: 8 }}>
          <button type="button" class="btn plain small" onClick={close}>Skip</button>
          {i < SLIDES.length - 1 ? <button type="button" class="btn small" onClick={() => setI(i + 1)}>Next</button> : <a class="btn small" href="#/learn" onClick={close}>Show me how to play</a>}
        </div>
      </div>
    </div>
  );
}
