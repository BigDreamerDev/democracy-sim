// Desktop navigation: the five tabs, and the open tab's sections with live counts.
import { useStore } from './store';
import { Icon, Seal, ThemeSwitch } from './ui';
import { nm, bal, ca, intrigueOpen, fmtTime, ordinal, standing, canSeeCard, TUTORIAL } from '../../engine/index';
import { needs } from './pages/today';
import { TABS, where, visible } from './nav';

export function Sidebar({ tabs, current }: { tabs: [string, string, string, boolean][]; current: string }) {
  const { world: w, me } = useStore();
  const c = w.citizens[me];
  const n = needs(w, me).length;
  const here = where(current).section;
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
        {TABS.map((t, i) => {
          const [href, label, icon, on] = tabs[i];
          return (
            <>
              <a href={href} class={on ? 'on' : ''} aria-current={on ? 'page' : undefined}>
                {on && <span class="mark" aria-hidden="true" />}
                <Icon name={icon} /><span>{label}</span>
                {t.id === 'today' && n > 0 && <i class="badge">{n}</i>}
              </a>
              {on && <div class="side-sub">{visible(t, w, me).map((s) => { const k = s.count?.(w, me); return <a href={s.href} class={here.id === s.id ? 'on' : ''}><span>{s.label}</span>{k ? <i class="tnum">{k}</i> : null}</a>; })}</div>}
            </>
          );
        })}
      </nav>
      <div class="side-foot">
        <div class="small muted">Playing as <b style={{ color: 'var(--ink)' }}>{nm(w, me)}</b> · {c.influence} Influence</div>
        <div class="small muted tnum">{fmtTime(w, w.now)}</div>
        <ThemeSwitch />
      </div>
    </aside>
  );
}
