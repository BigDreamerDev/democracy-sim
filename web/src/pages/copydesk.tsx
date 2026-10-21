// The copy desk: go through every line a player can read and make it sound like a person wrote it.
// Development only (`npm run dev`, then #/copy). The dev server reads the strings live from the source,
// saves your drafts to copy/edits.json, and Apply writes them into the code. See copy/STYLE.md.
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { Page, Sec, Card, Btn, Empty, Field, Pick, Seg } from '../ui';
import { toast } from '../store';

type Str = { id: string; file: string; line: number; kind: string; where: string; text: string; template: boolean; ctx: string };

const AREAS: Record<string, string> = {
  'web/src/pages/today.tsx': 'Today, Gazette, passport', 'web/src/pages/house.tsx': 'The House', 'web/src/pages/elections.tsx': 'Elections and Convention',
  'web/src/pages/gov.tsx': 'Government', 'web/src/pages/money.tsx': 'Money', 'web/src/pages/world.tsx': 'World, press, court, season',
  'web/src/pages/backroom.tsx': 'Backroom', 'web/src/pages/streets.tsx': 'The Streets', 'web/src/pages/market.tsx': 'Market and bets',
  'web/src/pages/glory.tsx': 'Red Box, polls, fame', 'web/src/pages/learn.tsx': 'How to play', 'web/src/pages/signin.tsx': 'Sign-in',
  'web/src/pages/admin.tsx': 'Admin', 'web/src/pages/developers.tsx': 'Developers', 'web/src/ui.tsx': 'Shared pieces', 'web/src/Sidebar.tsx': 'Shared pieces',
  'web/src/store.ts': 'Shared pieces', 'web/src/main.tsx': 'Shared pieces',
  'engine/crises.ts': 'Crises (game text)', 'engine/glory.ts': 'Red Box, achievements (game text)', 'engine/streets.ts': 'Streets (game text)',
  'engine/world.ts': 'Demo world', 'engine/tutorial.ts': 'Tutorial (game text)', 'engine/alerts.ts': 'Alerts'
};
const area = (f: string) => AREAS[f] || (f.startsWith('engine/') ? 'Rules and messages (game text)' : 'Other pages');
const KINDS: Record<string, string> = { screen: 'On screen', label: 'Labels and titles', message: 'Messages and errors', gazette: 'Gazette lines', data: 'Game text', stamp: 'Stamps', influence: 'Influence reasons' };

// the house style, as checks. Each returns a short reason when a line breaks it.
const RULES: [RegExp, string][] = [
  [/\b(do|does|did|is|are|was|were|has|have|had|could|would|should|will) not\b|\bcannot\b|\bcan not\b/i, 'Use a contraction (don’t, can’t, isn’t)'],
  [/\b(utili[sz]e|commence|terminate|prior to|subsequently|hereby|thus|assistance|sufficient|insufficient|in order to|whereby|aforementioned)\b/i, 'Plainer word'],
  [/\b(please note|simply|successfully|currently|kindly)\b/i, 'Filler: cut it'],
  [/\b(invalid|error|failed to|unable to)\b/i, 'Say what went wrong and how to fix it'],
  [/\b(click|tap here|user|users|data)\b/i, 'Talk to the player, not about the software'],
  [/\b(color|organize|favor|behavior|center|license)\b/i, 'British spelling'],
  [/!.*!|!!/, 'Too many exclamation marks'],
  [/(^|[^\w$])'|'($|[^\w])|"/, 'Curly quotes: ’ “ ”'],
  [/  /, 'Double space']
];
function lint(s: Str, text: string) {
  const plain = text.replace(/\$\{[^}]*\}/g, 'X');
  const out = RULES.filter(([re]) => re.test(plain)).map(([, why]) => why);
  if (plain.split(/\s+/).length > 26) out.push('Long: split it into two sentences');
  // short labels with three or more Capitalised Words are probably Title Case (proper nouns can trip this)
  if (s.kind === 'label' && plain.split(' ').length <= 5 && (plain.match(/\b[A-Z][a-z]+/g) || []).length >= 3) out.push('Sentence case, not Title Case');
  return out;
}
const placeholders = (t: string) => (t.match(/\$\{[^}]*\}/g) || []).sort().join('|');

function Text({ t }: { t: string }) {
  // show the game's ${…} parts as chips, so they're easy to keep
  return <>{t.split(/(\$\{[^}]*\})/).map((p) => (p.startsWith('${') ? <code class="cd-ph" title="Filled in by the game. Keep it.">{p.slice(2, -1).replace(/^.*\./, '').slice(0, 24)}</code> : p))}</>;
}

export function CopyDesk() {
  const [all, setAll] = useState<Str[] | null>(null);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [reviewed, setReviewed] = useState<Set<string>>(new Set());
  const [f, setF] = useState({ area: '', kind: '', status: 'todo', q: '' });
  const [page, setPage] = useState(0);
  const [report, setReport] = useState<any>(null);
  // lines you've touched stay on screen until you change the filter or page, even if they no longer match it
  const [held, setHeld] = useState<Set<string>>(new Set());
  const hold = (id: string) => held.has(id) || setHeld(new Set([...held, id]));
  const timer = useRef<any>(null);
  const load = async () => {
    try {
      const [s, e] = await Promise.all([fetch('/__copy/strings').then((r) => r.json()), fetch('/__copy/edits').then((r) => r.json())]);
      setAll(s.strings);
      setEdits(Object.fromEntries((e.edits || []).map((x: any) => [x.id, x.text])));
      setReviewed(new Set(e.reviewed || []));
    } catch {
      setAll([]);
    }
  };
  useEffect(() => void load(), []);
  const byId = useMemo(() => new Map((all || []).map((s) => [s.id, s])), [all]);
  // drafts save themselves to copy/edits.json
  const persist = (ed: Record<string, string>, rv: Set<string>) => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const list = Object.entries(ed).filter(([id, t]) => byId.has(id) && t !== byId.get(id)!.text).map(([id, text]) => ({ id, text, original: byId.get(id)!.text, file: byId.get(id)!.file, line: byId.get(id)!.line }));
      fetch('/__copy/edits', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ edits: list, reviewed: [...rv] }) }).catch(() => toast('Couldn’t save the draft. Is npm run dev still running?', true));
    }, 500);
  };
  const edit = (id: string, t: string) => {
    hold(id);
    const next = { ...edits, [id]: t };
    setEdits(next);
    persist(next, reviewed);
  };
  const mark = (id: string, on: boolean) => {
    hold(id);
    const rv = new Set(reviewed);
    on ? rv.add(id) : rv.delete(id);
    setReviewed(rv);
    persist(edits, rv);
  };
  const reset = (id: string) => {
    const next = { ...edits };
    delete next[id];
    setEdits(next);
    persist(next, reviewed);
  };
  if (!all) return <Page title="Copy desk"><Empty>Reading every string in the game…</Empty></Page>;
  if (!all.length) return <Page title="Copy desk" intro="The copy desk runs inside the development server. Start it with npm run dev and open this page from there."><Empty>No strings found.</Empty></Page>;

  const status = (s: Str) => (edits[s.id] !== undefined && edits[s.id] !== s.text ? 'edited' : reviewed.has(s.id) ? 'fine' : 'todo');
  const shown = all.filter((s) => {
    if (held.has(s.id)) return true;
    if (f.area && area(s.file) !== f.area) return false;
    if (f.kind && s.kind !== f.kind) return false;
    const st = status(s);
    if (f.status === 'todo' && st !== 'todo') return false;
    if (f.status === 'edited' && st !== 'edited') return false;
    if (f.status === 'fine' && st !== 'fine') return false;
    if (f.status === 'flagged' && !lint(s, edits[s.id] ?? s.text).length) return false;
    if (f.q && !(s.text + ' ' + (edits[s.id] || '')).toLowerCase().includes(f.q.toLowerCase())) return false;
    return true;
  });
  const per = 30;
  const pages = Math.max(1, Math.ceil(shown.length / per));
  const at = Math.min(page, pages - 1);
  const done = all.filter((s) => status(s) !== 'todo').length;
  const nEdited = all.filter((s) => status(s) === 'edited').length;
  const areas = [...new Set(all.map((s) => area(s.file)))].sort();
  const setFilter = (x: any) => (setF({ ...f, ...x }), setPage(0), setHeld(new Set()));
  const apply = async () => {
    if (!confirm(`Write ${nEdited} edit${nEdited === 1 ? '' : 's'} into the source code?`)) return;
    const r = await fetch('/__copy/apply', { method: 'POST' }).then((x) => x.json());
    setReport(r);
    toast(r.error ? r.error : `Applied ${r.applied}. Now run the checks.`, !!r.error);
    load();
  };

  return (
    <Page kicker="Development only" title="Copy desk" intro={<>Every line a player can read, {all.length} in all. Make each one sound like a person said it. Drafts save to <code>copy/edits.json</code> as you type; <b>Apply</b> writes them into the code. The rules are in <code>copy/STYLE.md</code>.</>}>
      <Card style={{ marginTop: 14 }}>
        <div class="row"><b>{done} of {all.length} looked at</b><span class="small tnum">{nEdited} rewritten</span></div>
        <div class="odds-bar" style={{ margin: '8px 0' }}><i style={{ width: (done / all.length) * 100 + '%' }} /></div>
        <div class="row" style={{ gap: 8, flexWrap: 'wrap' }}><Btn small disabled={!nEdited} onClick={apply}>Apply {nEdited} to the code</Btn><span class="small muted">Then run <code>npm run typecheck && npm run smoke</code> and check the pages.</span></div>
        {report && (report.problems?.length ? <ul class="small bad" style={{ margin: '8px 0 0' }}>{report.problems.map((p: string) => <li>{p}</li>)}</ul> : <p class="small good" style={{ margin: '8px 0 0' }}>All {report.applied} applied cleanly.</p>)}
      </Card>
      <details class="cd-guide"><summary><b>The house style, in short</b></summary>
        <ul class="small">
          <li>Talk to one person: “you”. Use contractions: can’t, it’s, you’ll.</li>
          <li>Lead with what happens. One idea per sentence. Plain words.</li>
          <li>Errors say how to fix it: “That costs 15 Influence. You have 9.”</li>
          <li>Buttons are verbs in sentence case: “Pass the bill”.</li>
          <li>British spelling, curly quotes (’ “ ”), dry rather than wacky, no filler.</li>
          <li>Keep the game’s words: crowns, Influence, the House, the Gazette, the Streets.</li>
          <li>Keep every grey chip: the game fills it in. You can move it.</li>
        </ul>
      </details>
      <Sec title="Filter">
        <div class="stack">
          <Seg value={f.status} onChange={(v) => setFilter({ status: v })} options={[['todo', 'To do'], ['flagged', 'Flagged'], ['edited', 'Rewritten'], ['fine', 'Fine'], ['all', 'All']]} />
          <div class="grid2">
            <Pick value={f.area} onChange={(v) => setFilter({ area: v })} empty="Every page" options={areas.map((a) => [a, `${a} (${all.filter((s) => area(s.file) === a).length})`])} />
            <Pick value={f.kind} onChange={(v) => setFilter({ kind: v })} empty="Every kind" options={Object.entries(KINDS)} />
          </div>
          <Field label="Search" value={f.q} onInput={(v) => setFilter({ q: v })} placeholder="Words in the line" />
        </div>
      </Sec>
      <Sec title={`${shown.length} line${shown.length === 1 ? '' : 's'}`} sub={pages > 1 ? `Page ${at + 1} of ${pages}` : undefined}>
        <div class="stack">
          {shown.slice(at * per, at * per + per).map((s) => {
            const now = edits[s.id] ?? s.text;
            const st = status(s);
            const flags = lint(s, now);
            const broken = s.template && placeholders(now) !== placeholders(s.text);
            return (
              <Card kind={st === 'edited' ? 'green' : undefined}>
                <div class="small muted cd-meta"><span>{area(s.file)} · {KINDS[s.kind]}{s.where ? ` · ${s.where}` : ''}</span><span class="tnum">{s.file.split('/').pop()}:{s.line}</span></div>
                <div class="cd-orig"><Text t={s.text} /></div>
                <code class="cd-ctx">{s.ctx}</code>
                <textarea class="input cd-edit" rows={Math.min(6, Math.ceil(now.length / 44) + 1)} value={now} aria-label="New wording" onInput={(e: any) => edit(s.id, e.currentTarget.value)} onKeyDown={(e: any) => e.key === 'Enter' && (e.ctrlKey || e.metaKey) && mark(s.id, true)} />
                {broken && <p class="small bad" style={{ margin: '4px 0 0' }}>Keep every grey chip from the original: {placeholders(s.text).split('|').map((p) => p.slice(2, -1)).join(', ')}.</p>}
                {flags.length > 0 && <div class="cd-flags">{flags.map((x) => <span class="cd-flag">{x}</span>)}</div>}
                <div class="row" style={{ gap: 6, marginTop: 8, justifyContent: 'flex-start' }}>
                  {st !== 'edited' && <Btn small kind={st === 'fine' ? undefined : 'ghost'} onClick={() => mark(s.id, st !== 'fine')}>{st === 'fine' ? 'Marked fine' : 'Fine as it is'}</Btn>}
                  {st === 'edited' && <Btn small kind="plain" onClick={() => reset(s.id)}>Undo my change</Btn>}
                </div>
              </Card>
            );
          })}
          {!shown.length && <Empty>Nothing here. Try another filter.</Empty>}
        </div>
        {pages > 1 && <div class="row" style={{ marginTop: 12 }}><Btn small kind="plain" disabled={at === 0} onClick={() => (setPage(at - 1), setHeld(new Set()), scrollTo(0, 0))}>Previous</Btn><span class="small tnum">{at + 1} / {pages}</span><Btn small kind="plain" disabled={at >= pages - 1} onClick={() => (setPage(at + 1), setHeld(new Set()), scrollTo(0, 0))}>Next</Btn></div>}
      </Sec>
    </Page>
  );
}
