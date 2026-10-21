// Edit text in place (development only). Switch it on with the "Edit text" button, then click any line on any
// page to reword it. Your wording shows on the page straight away (a preview: the code isn't touched until you
// press Apply), and is saved to copy/edits.json, the same file the copy desk at #/copy uses.
//
// How it finds things: it knows every player-facing string in the source (from the dev server), and looks for
// them in the page's text. Lines with parts the game fills in (names, numbers, whole phrases) are matched with
// those parts as wildcards; the preview puts the real values back into your new wording. Wording inside one of
// those parts ("No government has been formed.") can be edited on its own too: the editor lists it.
import { useEffect, useRef, useState } from 'preact/hooks';
import { lint, Text, split, spansOk, spanNames, area, KINDS, type Str } from './pages/copydesk';

type Doc = { edits: { id: string; text: string; original: string; file?: string; line?: number }[]; reviewed: string[] };
type Hit = { s: Str[]; values: string[]; node?: Text; el?: Element; attr?: string };

const ATTRS = ['placeholder', 'aria-label', 'title', 'alt'];
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const matcher = (parts: string[]) => (parts.join('').replace(/\W/g, '').length < 4 ? null : new RegExp('^' + parts.map(esc).join('([\\s\\S]*?)') + '$'));
// a wording with the game's values put in: `values` are in the order of the original's spans
function fill(s: Str, wording: string, values: string[]) {
  if (!s.spans?.length) return wording;
  const sp = split(wording, s.spans);
  if (!sp) return wording;
  return sp.parts.map((p, k) => p + (k < sp.order.length ? values[sp.order[k]] ?? '' : '')).join('');
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
  const [pick, setPick] = useState<{ hit: Hit; choices: Str[]; i: number; x: number; y: number } | null>(null);
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

  // indexes: exact text → strings; templates → a matcher for the original and one for any edited wording
  const index = useRef<{ exact: Map<string, Str[]>; tpl: [RegExp, Str, number[] | null][] } | null>(null);
  useEffect(() => {
    if (!strings) return;
    const exact = new Map<string, Str[]>();
    const tpl: [RegExp, Str, number[] | null][] = [];
    const editOf = new Map(doc.edits.map((e) => [e.id, e.text]));
    strings.forEach((s) => {
      const e = editOf.get(s.id);
      if (s.spans?.length) {
        const m = matcher(s.parts!);
        if (m) tpl.push([m, s, null]);
        const sp = e ? split(e, s.spans) : null;
        const me = sp && matcher(sp.parts);
        if (me) tpl.push([me, s, sp!.order]);
      } else [s.text, e].forEach((t) => t && exact.set(t, [...(exact.get(t) || []), s]));
    });
    // longer static text first, so the most specific template wins
    tpl.sort((a, b) => b[0].source.length - a[0].source.length);
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
      // matched the edited wording: put the values back in the original's order
      const values: string[] = [];
      order.forEach((spanIndex, k) => (values[spanIndex] = m[k + 1]));
      return { s: [s], values };
    }
    return null;
  };
  // wording inside a template's filled-in parts that is also a string of its own
  const inner = (hit: Hit): Str[] => {
    const out: Str[] = [];
    hit.values.forEach((v) => {
      const h = v && find(v);
      if (h) [...h.s, ...inner(h)].forEach((s) => !out.includes(s) && out.push(s));
    });
    return out;
  };

  // walk the page: mark what we know, and show previews of edited lines
  useEffect(() => {
    if (!on || !strings) return;
    let busy = false;
    const pass = () => {
      if (busy) return;
      busy = true;
      obs.disconnect();
      marked.current.forEach((el) => el.removeAttribute('data-cd'));
      marked.current.clear();
      const ed = new Map(docRef.current.edits.map((e) => [e.id, e.text]));
      const rv = new Set(docRef.current.reviewed);
      let here = 0, todo = 0;
      const state = (s: Str) => (ed.has(s.id) && ed.get(s.id) !== s.text ? 'edited' : rv.has(s.id) ? 'fine' : 'todo');
      const mark = (el: Element, ss: Str[]) => {
        const sts = ss.map(state);
        const st = sts.includes('todo') ? 'todo' : sts.includes('edited') ? 'edited' : 'fine';
        el.setAttribute('data-cd', el.getAttribute('data-cd') === 'todo' ? 'todo' : st);
        marked.current.add(el);
        here += ss.length;
        todo += sts.filter((x) => x === 'todo').length;
      };
      // a line's wording, with edits: its own, and those of any wording inside its filled-in parts
      const render = (hit: Hit): string => {
        const s = hit.s[0];
        const values = hit.values.map((v) => {
          const h = v && find(v);
          return h ? render(h) : v;
        });
        return fill(s, ed.get(s.id) ?? s.text, values);
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
            const orig = el.getAttribute('data-cd-orig-' + a) || v;
            const hit = find(orig) || find(v);
            if (!hit) return;
            el.setAttribute('data-cd-orig-' + a, orig);
            const want = render(hit);
            if (v !== want) el.setAttribute(a, want);
            nodes.current.set(el, { ...hit, el, attr: a });
            mark(el, [...hit.s, ...inner(hit)]);
          });
          continue;
        }
        const tn = n as Text;
        if (!tn.parentElement || tn.parentElement.closest('[data-cd-ui], script, style')) continue;
        const known = nodes.current.get(tn);
        // a node we previewed keeps its original reading, so it can be refilled (or put back after an undo)
        const hit = (known && (tn as any)._cdShown === tn.data ? known : null) || find(tn.data);
        if (!hit) continue;
        const lead = tn.data.match(/^\s*/)![0], tail = tn.data.match(/\s*$/)![0];
        const want = lead + render(hit) + tail;
        if (tn.data.replace(/\s+/g, ' ').trim() !== want.replace(/\s+/g, ' ').trim()) tn.data = want;
        (tn as any)._cdShown = tn.data;
        nodes.current.set(tn, { ...hit, node: tn });
        mark(tn.parentElement, [...hit.s, ...inner(hit)]);
      }
      setCount({ here, todo });
      obs.observe(root, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS });
      busy = false;
    };
    let raf = 0;
    const obs = new MutationObserver(() => (cancelAnimationFrame(raf), (raf = requestAnimationFrame(pass))));
    passRef.current = () => requestAnimationFrame(pass);
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
      open(hit, [...hit.s, ...inner(hit)], 0, ev.clientX, ev.clientY);
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

  useEffect(() => void (on && passRef.current()), [doc]);

  const open = (hit: Hit, choices: Str[], i: number, x: number, y: number) => {
    const s = choices[i];
    const e = docRef.current.edits.find((d) => d.id === s.id);
    setDraft(e ? e.text : s.text);
    setPick({ hit, choices, i, x: Math.min(x, innerWidth - 20), y });
  };
  const save = async (next: Doc) => {
    setDoc(next);
    await fetch('/__copy/edits', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(next) }).catch(() => {});
  };
  const current = pick ? pick.choices[pick.i] : null;
  const commit = () => {
    if (!current || !spansOk(current, draft)) return;
    const others = doc.edits.filter((e) => e.id !== current.id);
    const rv = new Set(doc.reviewed);
    if (draft === current.text) {
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
  const ok = current ? spansOk(current, draft) : true;

  return (
    <div data-cd-ui>
      <div class={'cd-bar' + (on ? ' on' : '')}>
        <button type="button" class="btn small" onClick={() => (setOn(!on), setPick(null))}>{on ? 'Stop editing text' : 'Edit text'}</button>
        {on && strings && <span class="small">{count.here} here · {count.todo} to do · {doc.edits.length} saved · Alt-click to use the app</span>}
        {on && doc.edits.length > 0 && <button type="button" class="btn small ghost" onClick={apply}>Apply {doc.edits.length}</button>}
        {on && <a class="small" href="#/copy">Desk</a>}
      </div>
      {pick && current && (
        <div class="cd-pop" style={{ left: Math.max(8, Math.min(pick.x - 160, innerWidth - 348)), top: Math.max(8, Math.min(pick.y + 14, innerHeight - 340)) }} role="dialog" aria-label="Edit this line">
          {pick.choices.length > 1 && (
            <label class="small">Which part?
              <select class="input" value={pick.i} onChange={(e: any) => open(pick.hit, pick.choices, Number(e.currentTarget.value), pick.x, pick.y)}>
                {pick.choices.map((s, i) => <option value={i}>{i < pick.hit.s.length ? (pick.hit.s.length > 1 ? `The whole line (${s.file.split('/').pop()}:${s.line})` : 'The whole line') : `Inside it: “${s.text.slice(0, 40)}${s.text.length > 40 ? '…' : ''}”`}</option>)}
              </select>
            </label>
          )}
          <div class="small muted cd-meta"><span>{area(current.file)} · {KINDS[current.kind]}</span><span class="tnum">{current.file.split('/').pop()}:{current.line}</span></div>
          <div class="cd-orig" style={{ fontSize: 16 }}><Text t={current.text} spans={current.spans} /></div>
          <textarea class="input cd-edit" rows={3} value={draft} autoFocus onInput={(e: any) => setDraft(e.currentTarget.value)} onKeyDown={(e: any) => (e.key === 'Enter' && (e.ctrlKey || e.metaKey) ? commit() : e.key === 'Escape' && setPick(null))} />
          {!ok && <p class="small bad" style={{ margin: '4px 0 0' }}>Keep every grey chip, once each: {spanNames(current)}.</p>}
          {lint(current, draft).length > 0 && <div class="cd-flags">{lint(current, draft).map((x) => <span class="cd-flag">{x}</span>)}</div>}
          <div class="row" style={{ gap: 6, marginTop: 8, justifyContent: 'flex-start', flexWrap: 'wrap' }}>
            <button type="button" class="btn small" disabled={!ok} onClick={commit}>{draft === current.text ? 'Fine as it is' : 'Save'}</button>
            {doc.edits.some((e) => e.id === current.id) && <button type="button" class="btn small plain" onClick={undo}>Undo my change</button>}
            <button type="button" class="btn small plain" onClick={() => setPick(null)}>Close</button>
          </div>
          <p class="small muted" style={{ margin: '6px 0 0' }}>Ctrl+Enter saves. It shows here at once; Apply writes it into the code.</p>
        </div>
      )}
    </div>
  );
}
