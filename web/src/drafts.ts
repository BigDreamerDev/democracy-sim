// Draft proposals: saved in this browser as you type, so nothing is lost to a reload or a closed tab, and you can keep
// several on the go and come back to any of them. Private to this device; nothing goes to the server until you table it.
export type Draft = { id: string; kind: string; title: string; summary: string; clauses: any[]; target: string; fast: boolean; savedAt: number };

const KEY = (me: string) => 'realm-drafts:' + me;
const MAX = 20;

export function drafts(me: string): Draft[] {
  try {
    const d = JSON.parse(localStorage.getItem(KEY(me)) || '[]');
    return Array.isArray(d) ? d.sort((a, b) => b.savedAt - a.savedAt) : [];
  } catch {
    return [];
  }
}
function write(me: string, list: Draft[]) {
  try {
    localStorage.setItem(KEY(me), JSON.stringify(list.slice(0, MAX)));
  } catch {}
}
export const getDraft = (me: string, id: string) => drafts(me).find((d) => d.id === id) || null;
export const newDraftId = () => 'd' + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36);

// worth keeping: a title, a summary or any clause with something written or chosen in it
export function hasContent(d: Omit<Draft, 'id' | 'savedAt'>) {
  return !!(d.title.trim() || d.summary.trim() || d.target || d.clauses.some((e) => e.t !== 'text' || (e.text || '').trim()));
}
export function saveDraft(me: string, d: Draft) {
  write(me, [d, ...drafts(me).filter((x) => x.id !== d.id)]);
}
export function deleteDraft(me: string, id: string) {
  write(me, drafts(me).filter((x) => x.id !== id));
}
