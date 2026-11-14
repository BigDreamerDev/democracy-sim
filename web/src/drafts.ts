// Draft proposals. Every change is kept in this browser at once, then copied to your account a few seconds later, so a
// draft follows you to your other devices and you can invite MPs to co-sponsor it. The newer copy (higher rev) wins.
// A draft deleted or tabled on another device disappears here too, unless this browser has changes it never sent.
import { getState, actQuiet } from './store';

export type Draft = { id: string; kind: string; title: string; summary: string; clauses: any[]; target: string; fast: boolean; savedAt: number; rev: number; syncedRev?: number };

const KEY = (me: string) => 'realm-drafts:' + me;
const MAX = 20;
const SYNC_AFTER = 3000;

function local(me: string): Draft[] {
  try {
    const d = JSON.parse(localStorage.getItem(KEY(me)) || '[]');
    return Array.isArray(d) ? d.map((x) => ({ rev: 0, ...x })) : [];
  } catch {
    return [];
  }
}
function write(me: string, list: Draft[]) {
  try {
    localStorage.setItem(KEY(me), JSON.stringify(list.slice(0, MAX)));
  } catch {}
}
const server = (me: string): Record<string, any> => Object.fromEntries(Object.values(getState().world?.drafts || {}).filter((d: any) => d.by === me).map((d: any) => [d.id, d]));
const fromServer = (s: any): Draft => ({ id: s.id, kind: s.kind, title: s.title, summary: s.summary, clauses: s.clauses, target: s.target || '', fast: !!s.fast, savedAt: s.savedAt, rev: s.rev, syncedRev: s.rev });

export function drafts(me: string): Draft[] {
  const srv = server(me);
  const out: Draft[] = [];
  let dropped = false;
  for (const l of local(me)) {
    const s = srv[l.id];
    delete srv[l.id];
    if (!s) {
      // it reached your account once and has no changes since: deleted or tabled elsewhere
      if (l.syncedRev !== undefined && l.rev <= l.syncedRev) dropped = true;
      else out.push(l);
    } else out.push(s.rev > l.rev ? fromServer(s) : l);
  }
  out.push(...Object.values(srv).map(fromServer));
  if (dropped) write(me, out);
  return out.sort((a, b) => b.savedAt - a.savedAt);
}
export const getDraft = (me: string, id: string) => drafts(me).find((d) => d.id === id) || null;
export const newDraftId = () => 'd' + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36);

// worth keeping: a title, a summary, a target or any clause with something written or chosen in it
export function hasContent(d: Pick<Draft, 'title' | 'summary' | 'target' | 'clauses'>) {
  return !!(d.title.trim() || d.summary.trim() || d.target || d.clauses.some((e) => e.t !== 'text' || (e.text || '').trim()));
}

const timers: Record<string, any> = {};
const inFlight: Record<string, Promise<boolean>> = {};
function send(me: string, id: string): Promise<boolean> {
  clearTimeout(timers[id]);
  delete timers[id];
  const d = local(me).find((x) => x.id === id);
  if (!d || (d.syncedRev !== undefined && d.rev <= d.syncedRev)) return Promise.resolve(true);
  const { syncedRev, savedAt, ...args } = d;
  const p = (inFlight[id] || Promise.resolve(true)).then(() => actQuiet('draft.save', args)).then((ok) => {
    if (ok) write(me, local(me).map((x) => (x.id === id ? { ...x, syncedRev: Math.max(x.syncedRev ?? 0, d.rev) } : x)));
    return ok;
  });
  inFlight[id] = p;
  return p;
}
// send any change to the account now (before inviting someone, or tabling it)
export const flushDraft = (me: string, id: string) => send(me, id);

export function saveDraft(me: string, d: Omit<Draft, 'rev' | 'savedAt' | 'syncedRev'>) {
  const was = drafts(me).find((x) => x.id === d.id);
  const next: Draft = { ...d, savedAt: Date.now(), rev: (was?.rev || 0) + 1, syncedRev: was?.syncedRev };
  write(me, [next, ...local(me).filter((x) => x.id !== d.id)]);
  clearTimeout(timers[d.id]);
  timers[d.id] = setTimeout(() => send(me, d.id), SYNC_AFTER);
  return next;
}
export function deleteDraft(me: string, id: string) {
  clearTimeout(timers[id]);
  delete timers[id];
  write(me, local(me).filter((x) => x.id !== id));
  if (server(me)[id]) actQuiet('draft.delete', { draft: id });
}
// after tabling: the server has already used it up
export function forgetDraft(me: string, id: string) {
  clearTimeout(timers[id]);
  delete timers[id];
  write(me, local(me).filter((x) => x.id !== id));
}
