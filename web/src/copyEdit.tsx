// Edit text in place (development only). Switch it on with the "Edit text" button, then click any line on any
// page to reword it. Your wording shows on the page straight away (a preview: the code isn't touched until you
// press Apply), and is saved to copy/edits.json, the same file the copy desk at #/copy uses.
//
// How it finds things: it knows every player-facing string in the source (from the dev server), and looks for
// them in the page's text. Lines with parts the game fills in (names, numbers) are matched with those parts as
// wildcards, and the preview puts the real values back into your new wording.
import { useEffect, useRef, useState } from 'preact/hooks';
import { lint, Text, placeholders, area, KINDS, type Str } from './pages/copydesk';

type Doc = { edits: { id: string; text: string; original: string; file?: string; line?: number }[]; reviewed: string[] };
type Hit = { s: Str[]; node?: Text; el?: Element; attr?: string; values: string[] };

const ATTRS = ['placeholder', 'aria-label', 'title', 'alt'];
const PH = /\$\{[^}]*\}/g;
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// a template's static text, with each ${…} as a capture
function matcherFor(t: string) {
  const parts = t.split(PH);
  if (parts.join('').replace(/\W/g, '').length < 5) return null;
  return new RegExp('^' + parts.map(esc).join('([\\s\\S]*?)') + '$');
}
// put the values a template captured back into a new wording, matching each ${…} by its source
function fill(orig: string, edited: string, values: string[]) {
  const names = orig.match(PH) || [];
  const byName: Record<string, string[]> = {};
  names.forEach((n, i) => (byName[n] ||= []).push(values[i] ?? ''));
  const used: Record<string, number> = {};
  return edited.replace(PH, (n) => byName[n]?.[(used[n] = (used[n] ?? -1) + 1)] ?? n);
}

export function CopyOverlay() {
  const [on, setOn] = useState(() => {
    try {
      return localStorage.getItem('realm-copy-edit') === '1';
    } catch {
      return false;
    }
  });
  const [strings, setStrings] = useState<Str[] | null>(null);
  const [doc, setDoc] = useState<Doc>({ edits: [], reviewed: [] });
  const [pick, setPick] = useState<{ hit: Hit; i: number; x: number; y: number } | null>(null);
  const [draft, setDraft] = useState('');
  const [count, setCount] = useState({ here: 0, todo: 0 });
  const nodes = useRef(new WeakMap<Node, Hit>());
  const marked = useRef<Set<Element>>(new Set());
  const passRef = useRef<() => void>(() => {});
  const docRef = useRef(doc);
  docRef.current = doc;

  useEffect(() => {
    try {
      localStorage.setItem('realm-copy-edit', on ? '1' : '0');
    } catch {}
    if (!on || strings) return;
    Promise.all([fetch('/__copy/strings').then((r) => r.json()), fetch('/__copy/edits').then((r) => r.json())])
      .then(([s, e]) => (setStrings(s.strings), setDoc({ edits: e.edits || [], reviewed: e.reviewed || [] })))
      .catch(() => setStrings([]));
  }, [on]);

  // indexes: exact text → strings, templates → matchers. Edited wording is indexed too, so previews stay found.
  const index = useRef<{ exact: Map<string, Str[]>; tpl: [RegExp, Str, string[] | null][] } | null>(null);
  useEffect(() => {
    if (!strings) return;
    const exact = new Map<string, Str[]>();
    const tpl: [RegExp, Str, string[] | null][] = [];
    const editOf = new Map(doc.edits.map((e) => [e.id, e.text]));
    strings.forEach((s) => {
      const e = editOf.get(s.id);
      [s.text, e].forEach((t, i) => {
        if (!t) return;
        const names = t.match(PH);
        if (s.template && names) {
          const m = matcherFor(t);
          // an edited wording may have moved the ${…} parts: remember its order to map values back
          if (m) tpl.push([m, s, i ? names : null]);
        } else exact.set(t, [...(exact.get(t) || []), s]);
      });
    });
    index.current = { exact, tpl };
  }, [strings, doc]);

  const find = (raw: string): Hit | null => {
    const t = raw.replace(/\s+/g, ' ').trim();
    if (!t || !index.current) return null;
    const ex = index.current.exact.get(t);
    if (ex) return { s: ex, values: [] };
    for (const [re, s, order] of index.current.tpl) {
      const m = t.match(re);
      if (!m) continue;
      if (!order) return { s: [s], values: m.slice(1) };
      const got: Record<string, string[]> = {};
      order.forEach((n, i) => (got[n] ||= []).push(m[i + 1]));
      const used: Record<string, number> = {};
      return { s: [s], values: (s.text.match(PH) || []).map((n) => got[n]?.[(used[n] = (used[n] ?? -1) + 1)] ?? '') };
    }
    return null;
  };

  // walk the page: mark what we know, and show previews of edited lines
  useEffect(() => {
    if (!on || !strings) return;
    const editOf = () => new Map(docRef.current.edits.map((e) => [e.id, e.text]));
    const reviewed = () => new Set(docRef.current.reviewed);
    let busy = false;
    const pass = () => {
      if (busy) return;
      busy = true;
      obs.disconnect();
      marked.current.forEach((el) => el.removeAttribute('data-cd'));
      marked.current.clear();
      const ed = editOf();
      const rv = reviewed();
      let here = 0, todo = 0;
      const state = (s: Str) => (ed.has(s.id) && ed.get(s.id) !== s.text ? 'edited' : rv.has(s.id) ? 'fine' : 'todo');
      const mark = (el: Element, s: Str) => {
        const st = state(s);
        const prev = el.getAttribute('data-cd');
        if (prev !== 'todo') el.setAttribute('data-cd', st === 'todo' || prev === null ? st : prev);
        marked.current.add(el);
        here++;
        if (st === 'todo') todo++;
      };
      const root = document.getElementById('app')!;
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        if (n.nodeType === 1) {
          const el = n as Element;
          if (el.closest('[data-cd-ui]')) continue;
          ATTRS.forEach((a) => {
            const v = el.getAttribute(a);
            if (!v) return;
            const keyA = `cd-orig-${a}`;
            const orig = el.getAttribute('data-' + keyA) || v;
            const hit = find(orig) || find(v);
            if (!hit) return;
            el.setAttribute('data-' + keyA, orig);
            const s = hit.s[0];
            const e = ed.get(s.id);
            const want = e ? fill(s.text, e, hit.values) : orig;
            if (v !== want) el.setAttribute(a, want);
            nodes.current.set(el, { ...hit, el, attr: a });
            mark(el, s);
          });
          continue;
        }
        const tn = n as Text;
        if (!tn.parentElement || tn.parentElement.closest('[data-cd-ui], script, style')) continue;
        const known = nodes.current.get(tn);
        // a node we previewed keeps its original reading, so it can be refilled (or put back after an undo)
        const hit = (known && (tn as any)._cdShown === tn.data ? known : null) || find(tn.data);
        if (!hit) continue;
        const s = hit.s[0];
        const e = ed.get(s.id);
        const lead = tn.data.match(/^\s*/)![0], tail = tn.data.match(/\s*$/)![0];
        const want = lead + fill(s.text, e ?? s.text, hit.values) + tail;
        if ((e || known) && tn.data.trim() !== want.trim()) tn.data = want;
        (tn as any)._cdShown = tn.data;
        nodes.current.set(tn, { ...hit, node: tn });
        mark(tn.parentElement, s);
      }
      setCount({ here, todo });
      obs.observe(document.getElementById('app')!, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS });
      busy = false;
    };
    passRef.current = () => requestAnimationFrame(pass);
    let raf = 0;
    const obs = new MutationObserver(() => (cancelAnimationFrame(raf), (raf = requestAnimationFrame(pass))));
    pass();
    // clicking a marked line opens the editor instead of doing what it normally does (hold Alt to use the app)
    const click = (ev: MouseEvent) => {
      if (ev.altKey || (ev.target as Element).closest?.('[data-cd-ui]')) return;
      let hit: Hit | undefined;
      const r = (document as any).caretRangeFromPoint?.(ev.clientX, ev.clientY);
      const pos = !r && (document as any).caretPositionFromPoint?.(ev.clientX, ev.clientY);
      const tn = r ? r.startContainer : pos ? pos.offsetNode : null;
      if (tn && tn.nodeType === 3) hit = nodes.current.get(tn);
      if (!hit) for (let el = ev.target as Element | null; el && !hit; el = el.parentElement) hit = nodes.current.get(el);
      if (!hit) return;
      ev.preventDefault();
      ev.stopPropagation();
      const s = hit.s[0];
      const e = docRef.current.edits.find((x) => x.id === s.id);
      setDraft(e ? e.text : s.text);
      setPick({ hit, i: 0, x: Math.min(ev.clientX, innerWidth - 20), y: ev.clientY });
    };
    document.addEventListener('click', click, true);
    return () => {
      document.removeEventListener('click', click, true);
      obs.disconnect();
      cancelAnimationFrame(raf);
      marked.current.forEach((el) => el.removeAttribute('data-cd'));
      marked.current.clear();
    };
  }, [on, strings]);

  // previews follow edits: nudge the walker after every change to the doc
  useEffect(() => void (on && passRef.current()), [doc]);

  const save = async (next: Doc) => {
    setDoc(next);
    await fetch('/__copy/edits', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(next) }).catch(() => {});
  };
  const current = pick ? pick.hit.s[pick.i] : null;
  const commit = (fine = false) => {
    if (!current) return;
    const others = doc.edits.filter((e) => e.id !== current.id);
    const rv = new Set(doc.reviewed);
    if (fine || draft === current.text) {
      rv.add(current.id);
      save({ edits: others, reviewed: [...rv] });
    } else save({ edits: [...others, { id: current.id, text: draft, original: current.text, file: current.file, line: current.line }], reviewed: [...rv] });
    setPick(null);
  };
  const undo = () => {
    if (!current) return;
    save({ edits: doc.edits.filter((e) => e.id !== current.id), reviewed: doc.reviewed });
    setPick(null);
  };
  const apply = async () => {
    if (!confirm(`Write ${doc.edits.length} edit${doc.edits.length === 1 ? '' : 's'} into the source code? The page reloads afterwards.`)) return;
    const r = await fetch('/__copy/apply', { method: 'POST' }).then((x) => x.json());
    alert(r.error || `Applied ${r.applied}.${r.problems?.length ? '\n\nSkipped:\n' + r.problems.join('\n') : ''}\n\nRun npm run typecheck && npm run smoke before committing.`);
    location.reload();
  };
  const broken = current && current.template && placeholders(draft) !== placeholders(current.text);

  return (
    <div data-cd-ui>
      <div class={'cd-bar' + (on ? ' on' : '')}>
        <button type="button" class="btn small" onClick={() => (setOn(!on), setPick(null))}>{on ? 'Stop editing text' : 'Edit text'}</button>
        {on && strings && <span class="small">{count.here} here · {count.todo} to do · {doc.edits.length} saved · Alt-click to use the app</span>}
        {on && doc.edits.length > 0 && <button type="button" class="btn small ghost" onClick={apply}>Apply {doc.edits.length}</button>}
        {on && <a class="small" href="#/copy">Desk</a>}
      </div>
      {pick && current && (
        <div class="cd-pop" style={{ left: Math.max(8, Math.min(pick.x - 160, innerWidth - 348)), top: Math.min(pick.y + 14, innerHeight - 320) }} role="dialog" aria-label="Edit this line">
          <div class="small muted cd-meta"><span>{area(current.file)} · {KINDS[current.kind]}</span><span class="tnum">{current.file.split('/').pop()}:{current.line}</span></div>
          {pick.hit.s.length > 1 && (
            <label class="small">This exact text is in {pick.hit.s.length} places in the code. Editing:
              <select class="input" value={pick.i} onChange={(e: any) => { const i = Number(e.currentTarget.value); setPick({ ...pick, i }); const ed = doc.edits.find((x) => x.id === pick.hit.s[i].id); setDraft(ed ? ed.text : pick.hit.s[i].text); }}>
                {pick.hit.s.map((s, i) => <option value={i}>{s.file.split('/').pop()}:{s.line} {s.where}</option>)}
              </select>
            </label>
          )}
          <div class="cd-orig" style={{ fontSize: 16 }}><Text t={current.text} /></div>
          <textarea class="input cd-edit" rows={3} value={draft} autoFocus onInput={(e: any) => setDraft(e.currentTarget.value)} onKeyDown={(e: any) => (e.key === 'Enter' && (e.ctrlKey || e.metaKey) ? commit() : e.key === 'Escape' && setPick(null))} />
          {broken && <p class="small bad" style={{ margin: '4px 0 0' }}>Keep every grey chip: {placeholders(current.text).split('|').map((p) => p.slice(2, -1)).join(', ')}.</p>}
          {lint(current, draft).length > 0 && <div class="cd-flags">{lint(current, draft).map((x) => <span class="cd-flag">{x}</span>)}</div>}
          <div class="row" style={{ gap: 6, marginTop: 8, justifyContent: 'flex-start', flexWrap: 'wrap' }}>
            <button type="button" class="btn small" disabled={!!broken} onClick={() => commit()}>{draft === current.text ? 'Fine as it is' : 'Save'}</button>
            {doc.edits.some((e) => e.id === current.id) && <button type="button" class="btn small plain" onClick={undo}>Undo my change</button>}
            <button type="button" class="btn small plain" onClick={() => setPick(null)}>Close</button>
          </div>
          <p class="small muted" style={{ margin: '6px 0 0' }}>Ctrl+Enter saves. It shows here at once; Apply writes it into the code.</p>
        </div>
      )}
    </div>
  );
}
