// Desktop navigation: the five sections, live counts, and shortcuts into the realm.
import { useStore } from './store';
import { Icon, Seal, ThemeSwitch } from './ui';
import { nm, bal, ca, intrigueOpen, fmtTime, ordinal, standing, canSeeCard, TUTORIAL } from '../../engine/index';
import { needs } from './pages/today';

export function Sidebar({ tabs, current }: { tabs: [string, string, string, boolean][]; current: string }) {
  const { world: w, me } = useStore();
  const c = w.citizens[me];
  const n = needs(w, me).length;
  const cards = w.cards.filter((k: any) => canSeeCard(w, k, me)).length;
  const tut = Object.keys(c.tutorial || {}).length;
  const short: [string, string, string?][] = [
    ['#/learn', 'How to play', tut < TUTORIAL.length ? `${tut}/${TUTORIAL.length}` : ''],
    ['#/proposals', 'Proposals', String(Object.values(w.proposals).filter((p: any) => ['debate', 'vote'].includes(p.stage)).length || '')],
    ['#/questions', 'Questions'],
    ['#/elections', 'Elections', String(Object.values(w.elections).filter((e: any) => e.status === 'open').length || '')],
    ['#/offices', 'Offices'],
    ['#/cabinet', 'Cabinet'],
    ['#/parties', 'Parties'],
    ['#/wallet', 'Wallet', `${bal(w, ca(me))}`],
    ['#/economy', 'Economy'],
    ['#/ventures', 'Ventures'],
    ['#/foreign', 'Foreign Office'],
    ['#/press', 'Press'],
    ['#/season', 'Leaderboard', `${c.influence}`],
    ['#/backroom', intrigueOpen(w) ? 'Backroom' : 'Backroom (locked)', intrigueOpen(w) && cards ? String(cards) : '']
  ];
  if (c.admin) short.push(['#/admin', 'Admin', String(w.pending.length || '')]);
  const meters: [string, number][] = [['P', w.meters.prosperity], ['S', w.meters.stability], ['W', standing(w)]];
  return (
    <aside class="side" aria-label="Sections">
      <a class="side-brand" href="#/">
        <Seal size={46} />
        <span><b class="serif">{w.config.realmName}</b><small>{w.phase === 'convention' ? 'Founding Convention' : w.induction && !w.induction.done ? 'Induction week' : `${ordinal(Math.max(1, w.season.n))} Parliament`}</small></span>
      </a>
      {w.phase === 'running' && (
        <div class="side-meters" aria-label="National meters">
          {meters.map(([k, v]) => <div title={{ P: 'Prosperity', S: 'Stability', W: 'Standing' }[k]} class={v <= 15 ? 'danger' : ''}><span>{{ P: 'Prosperity', S: 'Stability', W: 'Standing' }[k]}</span><i><b style={{ width: v + '%' }} /></i><em class="tnum">{v}</em></div>)}
        </div>
      )}
      <nav class="side-main">
        {tabs.map(([href, label, icon, on]) => (
          <a href={href} class={on ? 'on' : ''} aria-current={on ? 'page' : undefined}>
            {on && <span class="mark" aria-hidden="true" />}
            <Icon name={icon} /><span>{label}</span>
            {label === 'Today' && n > 0 && <i class="badge">{n}</i>}
          </a>
        ))}
      </nav>
      <div class="side-label">Shortcuts</div>
      <nav class="side-short">{short.map(([href, label, count]) => <a href={href} class={current === href ? 'on' : ''}><span>{label}</span>{count && <i class="tnum">{count}</i>}</a>)}</nav>
      <div class="side-foot">
        <div class="small muted">Playing as <b style={{ color: 'var(--ink)' }}>{nm(w, me)}</b> · {c.influence} Influence</div>
        <div class="small muted tnum">{fmtTime(w, w.now)}</div>
        <ThemeSwitch />
      </div>
    </aside>
  );
}
