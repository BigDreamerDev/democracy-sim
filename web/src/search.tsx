// Find anything: people, parties, bills, laws, offices, nations, elections. In the sidebar and at #/search.
import { useState } from 'preact/hooks';
import { useStore } from './store';
import { Page, Sec, Empty } from './ui';
import { places, TABS, visible } from './nav';

type Hit = { href: string; title: string; sub: string; score: number };
export function searchRealm(w: any, q: string, me = ''): Hit[] {
  const s = q.trim().toLowerCase();
  if (s.length < 2) return [];
  const hits: Hit[] = [];
  const add = (href: string, title: string, sub: string, hay: string) => {
    const t = hay.toLowerCase();
    const i = t.indexOf(s);
    if (i >= 0) hits.push({ href, title, sub, score: (i === 0 ? 0 : 1) + (title.toLowerCase().startsWith(s) ? 0 : 1) });
  };
  // pages first: "tax", "dark mode" or "coup" should find where to do it
  places().forEach((p) => {
    if (p.show && !p.show(w, me)) return;
    const t = p.title.toLowerCase();
    if (t.includes(s)) hits.push({ href: p.href, title: p.title, sub: 'Page · ' + p.where, score: t.startsWith(s) ? -2 : -1 });
    else if (s.length >= 3 && p.words.split(' ').some((x) => x.startsWith(s) || (s.includes(' ') && p.words.includes(s)))) hits.push({ href: p.href, title: p.title, sub: 'Page · ' + p.where, score: 0.5 });
  });
  Object.values(w.citizens).forEach((c: any) => c.active && add('#/passport/' + c.id, c.name, ['Person', c.party && w.parties[c.party]?.name].filter(Boolean).join(' · '), c.name));
  Object.values(w.parties).forEach((p: any) => p.status === 'active' && add('#/party/' + p.id, p.name, 'Party', p.name));
  Object.values(w.proposals).forEach((p: any) => add('#/p/' + p.id, p.title, `${p.kind === 'bill' ? `Bill ${p.n}` : 'Proposal'} · ${p.stage}`, `${p.title} ${p.summary || ''} bill ${p.n}`));
  w.laws.forEach((l: any) => add('#/law/' + l.ref, `${l.ref} ${l.title}`, l.repealed ? 'Law, repealed' : 'Law', `${l.ref} ${l.title} ${l.summary || ''}`));
  Object.values(w.offices).forEach((o: any) => add('#/office/' + o.id, o.name, `Office · ${o.title}`, `${o.name} ${o.title}`));
  Object.values(w.nations || {}).forEach((n: any) => add('#/nation/' + n.id, n.name, 'Nation', n.name));
  Object.values(w.elections).forEach((e: any) => add('#/election/' + e.id, e.title, `Election · ${e.status}`, e.title));
  return hits.sort((a, b) => a.score - b.score || a.title.localeCompare(b.title)).slice(0, 12);
}
export function SearchBox({ compact, autofocus }: { compact?: boolean; autofocus?: boolean }) {
  const { world: w, me } = useStore();
  const [q, setQ] = useState('');
  const hits = searchRealm(w, q, me);
  return (
    <div class={'search' + (compact ? ' compact' : '')} role="search">
      <input class="input" type="search" autoFocus={autofocus} value={q} placeholder="Find a page, person, bill…" aria-label="Search the realm" onInput={(e: any) => setQ(e.currentTarget.value)} onKeyDown={(e: any) => e.key === 'Enter' && hits[0] && ((location.hash = hits[0].href), setQ(''))} />
      {q.trim().length >= 2 && (
        <ul class="search-hits">{hits.length ? hits.map((h) => <li><a href={h.href} onClick={() => setQ('')}><b>{h.title}</b><span class="small muted">{h.sub}</span></a></li>) : <li class="small muted" style={{ padding: 8 }}>Nothing matches.</li>}</ul>
      )}
    </div>
  );
}
export function Search() {
  const { world: w, me } = useStore();
  const all = places();
  return (
    <Page kicker="Find anything" title="Find a page" intro="Type what you want to do (pay someone, tax, coup, dark mode) or a name. Every page in the game is listed below.">
      <Sec><SearchBox autofocus /></Sec>
      <Sec title="Every page">
        <div class="sitemap">
          {TABS.map((t) => (
            <div>
              <h3 class="h" style={{ fontSize: 19, margin: '0 0 6px' }}><a href={t.href} style={{ color: 'inherit' }}>{t.label}</a></h3>
              <ul class="list small">
                {visible(t, w, me).map((sec) => (
                  <li>
                    <a href={sec.href}><b>{sec.label}</b></a>
                    {(() => { const kids = all.filter((p) => p.where === `${t.label} › ${sec.label}` && (!p.show || p.show(w, me))); return kids.length ? <span class="muted"> · {kids.map((k, i) => <>{i ? ', ' : ''}<a href={k.href}>{k.title}</a></>)}</span> : null; })()}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </Sec>
    </Page>
  );
}
export const NoResults = () => <Empty>Nothing matches.</Empty>;
