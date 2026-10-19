// Shared building blocks, styled like the mockup canvas.
import { ComponentChildren } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { useStore } from './store';
import { fmtLeft, fmtTime, nm } from '../../engine/index';

export function useRoute(): string[] {
  const get = () => (location.hash.replace(/^#\/?/, '') || '').split('/').filter(Boolean);
  const [r, setR] = useState(get());
  useEffect(() => {
    const f = () => {
      setR(get());
      window.scrollTo(0, 0);
    };
    window.addEventListener('hashchange', f);
    return () => window.removeEventListener('hashchange', f);
  }, []);
  return r;
}
export const go = (path: string) => (location.hash = path.startsWith('#') ? path : '#/' + path);

export function Page(p: { kicker?: ComponentChildren; title: ComponentChildren; intro?: ComponentChildren; back?: [string, string]; dark?: boolean; children?: ComponentChildren; right?: ComponentChildren }) {
  const { world: w } = useStore();
  return (
    <div class={'page' + (p.dark ? ' dark' : '')}>
      <div>
        <div class="masthead" aria-hidden="true"><span>{p.dark ? 'Eyes only · not for the Gazette' : `${w.config.realmName} · ${fmtTime(w, w.now).split(',')[0]}`}</span></div>
        {p.back && (
          <a class="back" href={p.back[0]} style={{ marginTop: 4 }}>
            <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7" /></svg>
            {p.back[1]}
          </a>
        )}
        <div class="row" style={{ alignItems: 'flex-end' }}>
          <div style={{ minWidth: 0 }}>
            {p.kicker && <div class="kicker">{p.kicker}</div>}
            <h1 class="title">{p.title}</h1>
            {p.dark && <div class="eyes">Restricted circulation</div>}
          </div>
          {p.right}
        </div>
        {p.intro && <p class="intro">{p.intro}</p>}
      </div>
      <div class="page-body">{p.children}</div>
    </div>
  );
}

export function Sec(p: { title?: ComponentChildren; sub?: ComponentChildren; children?: ComponentChildren; id?: string }) {
  return (
    <section class="sec" id={p.id}>
      {p.title && <h2 class="h">{p.title}</h2>}
      {p.sub && <p class="small muted" style={{ margin: '-4px 0 10px' }}>{p.sub}</p>}
      {p.children}
    </section>
  );
}

export function Card(p: { children?: ComponentChildren; kind?: 'dashed' | 'tint' | 'warn' | 'green'; style?: any }) {
  return <div class={'card ' + (p.kind || '')} style={{ position: 'relative', ...(p.style || {}) }}>{p.children}</div>;
}

export function Btn(p: { onClick?: () => void; href?: string; kind?: 'ghost' | 'plain' | 'danger' | 'danger ghost'; full?: boolean; small?: boolean; disabled?: boolean; children?: ComponentChildren; style?: any }) {
  const cls = ['btn', p.kind || '', p.full ? 'full' : '', p.small ? 'small' : ''].join(' ');
  if (p.href) return <a class={cls} href={p.href} style={p.style}>{p.children}</a>;
  return <button type="button" class={cls} onClick={p.onClick} disabled={p.disabled} style={p.style}>{p.children}</button>;
}

export function Opt(p: { on?: boolean; onClick: () => void; title: ComponentChildren; hint?: ComponentChildren; right?: ComponentChildren }) {
  return (
    <button type="button" class={'opt' + (p.on ? ' on' : '')} aria-pressed={p.on ? 'true' : 'false'} onClick={p.onClick}>
      <div class="row" style={{ width: '100%' }}>
        <b>{p.title}</b>
        {p.right}
      </div>
      {p.hint && <span>{p.hint}</span>}
    </button>
  );
}

export function Seg(p: { value: string; options: [string, string][]; onChange: (v: any) => void }) {
  return (
    <div class="seg" role="group">
      {p.options.map(([v, l]) => (
        <button type="button" class={p.value === v ? 'on' : ''} aria-pressed={p.value === v ? 'true' : 'false'} onClick={() => p.onChange(v)}>{l}</button>
      ))}
    </div>
  );
}

export function Field(p: { label: ComponentChildren; value: any; onInput: (v: string) => void; type?: string; area?: boolean; placeholder?: string }) {
  return (
    <label class="f">
      {p.label}
      {p.area ? (
        <textarea class="input" value={p.value} placeholder={p.placeholder} onInput={(e: any) => p.onInput(e.target.value)} />
      ) : (
        <input class="input" type={p.type || 'text'} value={p.value} placeholder={p.placeholder} onInput={(e: any) => p.onInput(e.target.value)} />
      )}
    </label>
  );
}

export function Pick(p: { label?: ComponentChildren; value: string; onChange: (v: string) => void; options: [string, string][]; empty?: string }) {
  return (
    <label class="f">
      {p.label}
      <select class="input" value={p.value} onChange={(e: any) => p.onChange(e.target.value)}>
        {p.empty !== undefined && <option value="">{p.empty}</option>}
        {p.options.map(([v, l]) => <option value={v}>{l}</option>)}
      </select>
    </label>
  );
}

export function Who({ id }: { id: string | null | undefined }) {
  const s = useStore();
  if (!id) return <span class="muted">nobody</span>;
  return <a href={'#/passport/' + id} style={{ color: 'inherit', fontWeight: 700, textDecoration: 'none' }}>{nm(s.world, id)}{id === s.me ? ' (you)' : ''}</a>;
}

export function Left({ at }: { at: number }) {
  const s = useStore();
  return <span class="tnum">{fmtLeft(s.world, at)}</span>;
}
export function When({ at }: { at: number }) {
  const s = useStore();
  return <span class="tnum">{fmtTime(s.world, at)}</span>;
}

export function Meter({ value, max, color }: { value: number; max: number; color?: string }) {
  return <div class="meter" aria-hidden="true"><i style={{ width: `${Math.max(0, Math.min(100, (value / Math.max(1, max)) * 100))}%`, background: color }} /></div>;
}

export function Empty({ children }: { children: ComponentChildren }) {
  return <div class="empty">{children}</div>;
}

export function Stamp({ label, sub, red, style }: { label: string; sub?: string; red?: boolean; style?: any }) {
  return (
    <div class={'stamp' + (red ? ' red' : '')} style={style} aria-hidden="true">
      <b>{label}</b>
      {sub && <small>{sub}</small>}
    </div>
  );
}

export function Seal({ size = 44, dark }: { size?: number; dark?: boolean }) {
  return (
    <svg class={'seal' + (dark ? ' seal-out' : '')} role="img" aria-label="Seal of the realm" width={size} height={size} viewBox="0 0 120 120">
      <circle class="seal-fill" cx="60" cy="60" r="59" stroke-width="2" />
      <path class="seal-line" d={rosette(60, 42, 4, 16, 4, 3.4)} fill="none" stroke-width="0.9" />
      <path class="seal-fg" d="M38 76L34 46l14 13 12-24 12 24 14-13-4 30z" />
      <rect class="seal-fg" x="38" y="80" width="44" height="6" />
    </svg>
  );
}

// ---------- theme: auto (follows the device), light or dark ----------
const THEME_KEY = 'realm-theme';
export function getTheme(): 'auto' | 'light' | 'dark' {
  try {
    const t = localStorage.getItem(THEME_KEY);
    if (t === 'light' || t === 'dark') return t;
  } catch {}
  return 'auto';
}
export function applyTheme(t: 'auto' | 'light' | 'dark') {
  const root = document.documentElement;
  const go = () => {
    if (t === 'auto') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', t);
  };
  const d: any = document;
  if (d.startViewTransition && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
    root.dataset.nav = 'theme';
    d.startViewTransition(go);
  } else go();
  try {
    if (t === 'auto') localStorage.removeItem(THEME_KEY);
    else localStorage.setItem(THEME_KEY, t);
  } catch {}
}
export function ThemeSwitch() {
  const [t, setT] = useState(getTheme());
  useEffect(() => {
    const f = () => setT(getTheme());
    addEventListener('realm-theme', f);
    return () => removeEventListener('realm-theme', f);
  }, []);
  return <Seg value={t} onChange={(v) => { applyTheme(v); dispatchEvent(new Event('realm-theme')); }} options={[['auto', 'Auto'], ['light', 'Light'], ['dark', 'Dark']]} />;
}

const cache: Record<string, string> = {};
export function rosette(c: number, base: number, amp: number, lobes: number, rings: number, step: number) {
  const k = [c, base, amp, lobes, rings, step].join();
  if (cache[k]) return cache[k];
  let d = '';
  for (let r = 0; r < rings; r++) {
    const rk = base + r * step;
    for (let i = 0; i <= 240; i++) {
      const t = (i / 240) * Math.PI * 2;
      const rr = rk + amp * Math.sin(lobes * t + r * 0.55);
      d += (i ? 'L' : 'M') + (c + rr * Math.cos(t)).toFixed(1) + ' ' + (c + rr * Math.sin(t)).toFixed(1);
    }
    d += 'Z';
  }
  return (cache[k] = d);
}

export function Icon({ name }: { name: string }) {
  const paths: Record<string, string> = {
    today: 'M3 5h18v16H3zM3 10h18M8 3v4M16 3v4',
    house: 'M3 9l9-5 9 5M5 9v9M10 9v9M14 9v9M19 9v9M3 21h18',
    realm: 'M12 3l2.6 5.6 6 .7-4.5 4.1 1.2 6L12 16.4 6.7 19.4l1.2-6L3.4 9.3l6-.7z',
    laws: 'M4 4h11a3 3 0 013 3v13H7a3 3 0 01-3-3zM4 17a3 3 0 013-3h11',
    you: 'M12 12a4 4 0 100-8 4 4 0 000 8zM4 21c1.5-4 4.5-6 8-6s6.5 2 8 6',
    lock: 'M5 11h14v10H5zM8 11V8a4 4 0 018 0v3',
    key: 'M11 15a4 4 0 11-8 0 4 4 0 018 0zM10 12l10-10M15 7l3 3M18 4l2 2',
    chev: 'M9 5l7 7-7 7'
  };
  return (
    <svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
      <path d={paths[name]} />
    </svg>
  );
}

export function LinkRow({ href, title, sub, right }: { href: string; title: ComponentChildren; sub?: ComponentChildren; right?: ComponentChildren }) {
  return (
    <li>
      <a class="li" href={href}>
        <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <b style={{ fontSize: 16 }}>{title}</b>
          {sub && <span class="small muted">{sub}</span>}
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>{right}<Icon name="chev" /></span>
      </a>
    </li>
  );
}

export function Locked({ act, href, children }: { act: string; href: string; children?: ComponentChildren }) {
  return (
    <Card kind="dashed">
      <div class="row" style={{ justifyContent: 'flex-start' }}><Icon name="lock" /><b>Not open yet</b></div>
      <p style={{ margin: '8px 0 12px' }}>{children} It opens once the <b>{act}</b> becomes law. Any MP can propose it.</p>
      <Btn href={href} kind="ghost" small>Draft the {act}</Btn>
    </Card>
  );
}

// ---------- banknotes: printed on fixed paper stock, so they look the same in either theme ----------
const NOTE_INK: Record<string, string> = { '1': '#6B4E1F', '5': '#1F5E57', '20': '#3B4A8C', '100': '#A8321F' };
const NOTE_WORDS: Record<string, string> = { '1': 'One Crown', '5': 'Five Crowns', '20': 'Twenty Crowns', '100': 'One Hundred Crowns' };
const waveCache: Record<string, string> = {};
function waves(w: number, h: number, lines: number) {
  const k0 = [w, h, lines].join();
  if (waveCache[k0]) return waveCache[k0];
  let d = '';
  for (let k = 0; k < lines; k++) {
    const y0 = ((k + 0.5) * h) / lines;
    for (let x = 0; x <= w; x += 5) d += (x ? 'L' : 'M') + x + ' ' + (y0 + Math.sin(x / 18 + k * 0.7) * 6).toFixed(1);
  }
  return (waveCache[k0] = d);
}
export function Banknote({ denom, serial, style }: { denom: '1' | '5' | '20' | '100'; serial?: string; style?: any }) {
  const { world: w } = useStore();
  const ink = NOTE_INK[denom];
  const chair = w.offices.reserve?.holder;
  return (
    <svg class="note" role="img" aria-label={`${NOTE_WORDS[denom]} banknote`} viewBox="0 0 640 300" style={{ display: 'block', width: '100%', height: 'auto', ...style }}>
      <rect x="5" y="5" width="630" height="290" rx="6" fill="#EEF0E8" stroke={ink} stroke-width="10" />
      <path d={waves(620, 280, 28)} transform="translate(10 10)" fill="none" stroke={ink} stroke-opacity="0.18" stroke-width="0.7" />
      <g transform="translate(24 30)">
        <path d={rosette(120, 44, 16, 18, 16, 4.2)} fill="none" stroke={ink} stroke-width="0.8" />
        <circle cx="120" cy="120" r="36" fill="#EEF0E8" stroke={ink} stroke-width="1.5" />
        <g transform="translate(105 78) scale(.5)"><path d="M38 76L34 46l14 13 12-24 12 24 14-13-4 30zM38 80h44v6H38z" fill={ink} /></g>
        <text x="120" y="148" text-anchor="middle" font-family="Gloock, Georgia, serif" font-size="24" fill={ink}>{denom}</text>
      </g>
      <text x="290" y="48" font-family="Atkinson Hyperlegible, sans-serif" font-size="14" fill="#1B2430">{w.config.realmName}</text>
      <text x="290" y="86" font-family="Gloock, Georgia, serif" font-size={denom === '100' ? 30 : 34} fill={ink}>{NOTE_WORDS[denom]}</text>
      <text x="290" y="114" font-family="Atkinson Hyperlegible, sans-serif" font-size="12.5" fill="#1B2430">Legal tender in the realm. Issued by the</text>
      <text x="290" y="131" font-family="Atkinson Hyperlegible, sans-serif" font-size="12.5" fill="#1B2430">Federal Reserve under the Currency Act.</text>
      <path d="M294 242c10-18 18-18 20-4s8 10 16-6 12 2 18 8 14-10 24-6 18 6 34-2" fill="none" stroke="#1B2430" stroke-width="2" stroke-linecap="round" />
      <line x1="290" y1="256" x2="430" y2="256" stroke="#1B2430" stroke-width="1" />
      <text x="290" y="272" font-family="Atkinson Hyperlegible, sans-serif" font-size="11" fill="#1B2430">{chair ? nm(w, chair) : 'Chair'}, Chair of the Reserve</text>
      <text x="612" y="270" text-anchor="end" font-family="Gloock, Georgia, serif" font-size="18" letter-spacing="1" fill="#A8321F">{serial || 'RP 000019'}</text>
      <text x="612" y="62" text-anchor="end" font-family="Gloock, Georgia, serif" font-size="48" fill={ink} opacity="0.9">{denom}</text>
    </svg>
  );
}
export function noteBreakdown(n: number) {
  const out: [string, number][] = [];
  let left = Math.max(0, Math.floor(n));
  for (const d of [100, 20, 5, 1]) {
    const k = Math.floor(left / d);
    if (k) out.push([String(d), k]);
    left -= k * d;
  }
  return out;
}

// ---------- ballot paper: one shared look for every vote in the realm ----------
// `confirm` makes it two-step (pick, then cast) for ballots that are final; otherwise a tap votes and can be changed.
export type BallotOpt = { key: string | number; label: ComponentChildren; sub?: ComponentChildren; count?: number; tag?: ComponentChildren };
export function BallotPaper(p: { head: ComponentChildren; options: BallotOpt[]; value?: any; onPick?: (k: any) => void; need?: number; confirm?: string; locked?: boolean; adopted?: any; foot?: ComponentChildren; empty?: ComponentChildren }) {
  const [pending, setPending] = useState<any>(null);
  const counted = p.options.some((o) => o.count !== undefined);
  const top = counted ? Math.max(0, ...p.options.map((o) => o.count || 0)) : 0;
  const leaders = p.options.filter((o) => (o.count || 0) === top && top > 0);
  const pick = (k: any) => {
    if (p.locked || !p.onPick) return;
    if (p.confirm) setPending(pending === k ? null : k);
    else p.onPick(k);
  };
  const shown = p.confirm ? pending ?? p.value : p.value;
  return (
    <div class={'ballot' + (p.locked ? ' locked' : '')}>
      <p>{p.head}</p>
      {p.options.map((o) => {
        const on = shown === o.key;
        const lead = counted && leaders.length === 1 && leaders[0].key === o.key;
        return (
          <button type="button" class={(on ? 'on ' : '') + (p.adopted === o.key ? 'won' : '')} onClick={() => pick(o.key)} disabled={p.locked || !p.onPick} aria-pressed={on ? 'true' : 'false'}>
            <span class="b-main">
              <span class="b-label">{o.label}{p.adopted === o.key && <span class="chip teal" style={{ marginLeft: 8 }}>Adopted</span>}{lead && p.adopted === undefined && <span class="chip ink" style={{ marginLeft: 8 }}>Leading</span>}{o.tag}</span>
              {o.sub && <span class="small muted">{o.sub}</span>}
              {counted && (
                <span class="b-tally">
                  <i style={{ width: `${Math.min(100, ((o.count || 0) / Math.max(1, p.need || top || 1)) * 100)}%` }} />
                  <em class="tnum">{o.count || 0}{p.need ? ` / ${p.need}` : ''}</em>
                </span>
              )}
            </span>
            <span class="box" aria-hidden="true">{on && <svg width="34" height="34" viewBox="0 0 24 24"><path d="M4 4l16 16M20 4L4 20" stroke-width="3" /></svg>}</span>
          </button>
        );
      })}
      {!p.options.length && <div class="b-empty">{p.empty || 'Nothing on the ballot yet.'}</div>}
      {p.confirm && pending !== null && pending !== p.value && (
        <div class="b-confirm">
          <span>{p.confirm}</span>
          <div class="row" style={{ gap: 8, justifyContent: 'flex-end' }}>
            <button type="button" class="btn plain small" onClick={() => setPending(null)}>Not yet</button>
            <button type="button" class="btn small" onClick={() => (p.onPick!(pending), setPending(null))}>Cast my ballot</button>
          </div>
        </div>
      )}
      {p.foot && <div class="b-foot">{p.foot}</div>}
    </div>
  );
}

// ranked and approval ballots: tap to number (1, 2, 3…) or to tick, then cast. `onCast` gets the list, best first.
export function MultiBallot(p: { head: ComponentChildren; options: BallotOpt[]; mode: 'rank' | 'approve'; value?: any[] | null; onCast?: (list: any[]) => void; locked?: boolean; foot?: ComponentChildren; empty?: ComponentChildren; castLabel?: string; final?: boolean }) {
  const [list, setList] = useState<any[]>(p.value || []);
  const shown = p.locked ? p.value || [] : list;
  const toggle = (k: any) => {
    if (p.locked) return;
    setList(list.includes(k) ? list.filter((x) => x !== k) : [...list, k]);
  };
  const changed = JSON.stringify(list) !== JSON.stringify(p.value || []);
  return (
    <div class={'ballot multi' + (p.locked ? ' locked' : '')}>
      <p>{p.head}</p>
      {p.options.map((o) => {
        const i = shown.indexOf(o.key);
        return (
          <button type="button" class={i >= 0 ? 'on' : ''} onClick={() => toggle(o.key)} disabled={p.locked || !p.onCast} aria-pressed={i >= 0 ? 'true' : 'false'}>
            <span class="b-main"><span class="b-label">{o.label}{o.tag}</span>{o.sub && <span class="small muted">{o.sub}</span>}</span>
            <span class="box" aria-hidden="true">{i >= 0 && (p.mode === 'rank' ? <b class="b-rank">{i + 1}</b> : <svg width="34" height="34" viewBox="0 0 24 24"><path d="M4 13l5 5L20 6" stroke-width="3" fill="none" /></svg>)}</span>
          </button>
        );
      })}
      {!p.options.length && <div class="b-empty">{p.empty || 'Nothing on the ballot yet.'}</div>}
      {!p.locked && p.onCast && p.options.length > 0 && (
        <div class="b-confirm">
          <span>{list.length ? (p.mode === 'rank' ? `${list.length} ranked. Tap again to remove.` : `${list.length} ticked.`) : p.mode === 'rank' ? 'Tap in order: your favourite first.' : 'Tick everyone you would accept.'}</span>
          <div class="row" style={{ gap: 8, justifyContent: 'flex-end' }}>
            {list.length > 0 && <button type="button" class="btn plain small" onClick={() => setList([])}>Clear</button>}
            <button type="button" class="btn small" disabled={!list.length || !changed} onClick={() => p.onCast!(list)}>{p.castLabel || (p.final ? 'Cast my ballot' : 'Save my ranking')}</button>
          </div>
        </div>
      )}
      {p.foot && <div class="b-foot">{p.foot}</div>}
    </div>
  );
}

// a password box with a show/hide toggle and a caps-lock warning; `autoComplete` tells password managers what it is
export function PasswordField(p: { label: ComponentChildren; value: string; onInput: (v: string) => void; autoComplete: 'current-password' | 'new-password'; hint?: ComponentChildren }) {
  const [show, setShow] = useState(false);
  const [caps, setCaps] = useState(false);
  const check = (e: any) => setCaps(!!e.getModifierState?.('CapsLock'));
  return (
    <label class="f">
      {p.label}
      <span class="pw">
        <input class="input" type={show ? 'text' : 'password'} value={p.value} autoComplete={p.autoComplete} autoCapitalize="none" spellcheck={false} maxLength={72}
          onInput={(e: any) => p.onInput(e.target.value)} onKeyUp={check} onKeyDown={check} />
        <button type="button" class="pw-eye" aria-label={show ? 'Hide password' : 'Show password'} aria-pressed={show ? 'true' : 'false'} onClick={() => setShow(!show)}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
            <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" />{show && <path d="M3 3l18 18" />}
          </svg>
          <span>{show ? 'Hide' : 'Show'}</span>
        </button>
      </span>
      {caps && <span class="small" style={{ color: 'var(--red)', fontWeight: 700 }}>Caps Lock is on.</span>}
      {p.hint && <span class="small muted" style={{ fontWeight: 400 }}>{p.hint}</span>}
    </label>
  );
}
