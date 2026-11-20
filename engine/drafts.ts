// Drafts: proposals being written, kept on the server so they follow a player between devices. A draft is private to
// its author and the MPs they invite to co-sponsor it (viewFor strips the rest). Nothing here is checked as strictly as
// a tabled proposal: a draft can be half-written. prop.new checks it properly, and credits the co-sponsors who signed
// the wording that was actually tabled.
import { lim } from './limits';
import { W, Id, fail, own, text, int, isMP, nm } from './core';
import { KINDS, CLAUSE_TYPES } from './proposals';

export const MAX_DRAFTS = 20;
export const MAX_SPONSORS = 6;
const content = (d: any) => JSON.stringify([d.kind, d.title, d.summary, d.clauses, d.target || '']);

function mine(w: W, actor: Id, id: unknown) {
  const d = own(w.drafts, id);
  if (!d) fail('That draft has gone. It may have been tabled or deleted.');
  if (d.by !== actor) fail('That draft belongs to someone else.');
  return d;
}

export function saveDraft(w: W, actor: Id, a: any) {
  if (typeof a?.id !== 'string' || !/^d[a-z0-9]{4,24}$/.test(a.id)) fail('That draft id isn’t valid.');
  // a save that arrives after the draft was tabled must not bring it back
  if (Object.values(w.proposals).some((p: any) => p.draft === a.id && p.by === actor)) return;
  const kind = a.kind ?? 'bill';
  if (!own(KINDS, kind)) fail('Unknown kind of proposal.');
  const title = text(a.title, 0, 120, 'title');
  const summary = text(a.summary, 0, 500, 'summary');
  const clauses = a.clauses ?? [];
  if (!Array.isArray(clauses) || clauses.length > lim(w, 'billClauses')) fail(`A draft can have ${lim(w, 'billClauses')} clauses at most.`);
  for (const e of clauses) if (!e || typeof e !== 'object' || Array.isArray(e) || !CLAUSE_TYPES.includes(e.t)) fail('Unknown kind of clause.');
  const target = a.target ? (own(w.citizens, a.target) ? a.target : fail('No such citizen.')) : '';
  const rev = int(a.rev ?? 0, 0, 1e9, 'revision');
  const d = own(w.drafts, a.id);
  if (d && d.by !== actor) fail('That draft belongs to someone else.');
  if (!d && Object.values(w.drafts).filter((x: any) => x.by === actor).length >= lim(w, 'draftsEach')) fail(`You can keep ${lim(w, 'draftsEach')} drafts at most. Delete one first.`);
  const next: any = { id: a.id, by: actor, kind, title, summary, clauses: structuredClone(clauses), target, fast: !!a.fast, rev, savedAt: w.now, crev: d?.crev || 0, sponsors: d?.sponsors || {} };
  // new wording: anyone who signed the old wording is asked again
  if (d && content(d) !== content(next)) {
    next.crev += 1;
    Object.keys(next.sponsors).forEach((k) => next.sponsors[k].status === 'yes' && (next.sponsors[k] = { status: 'invited', crev: null }));
  }
  (w.drafts ??= {})[a.id] = next;
}
export function deleteDraft(w: W, actor: Id, id: unknown) {
  mine(w, actor, id);
  delete w.drafts[id as string];
}
export function inviteSponsor(w: W, actor: Id, id: unknown, who: unknown) {
  const d = mine(w, actor, id);
  const c = own(w.citizens, who);
  if (!c?.active) fail('Pick who to invite.');
  if (who === actor) fail('You’re already its author.');
  if (!isMP(w, who as Id)) fail(`${nm(w, who as Id)} isn’t an MP. Only MPs can co-sponsor.`);
  if (d.sponsors[who as Id]) fail(`${nm(w, who as Id)} is already invited.`);
  if (Object.keys(d.sponsors).length >= lim(w, 'draftSponsors')) fail(`A draft can have ${lim(w, 'draftSponsors')} co-sponsors at most.`);
  d.sponsors[who as Id] = { status: 'invited', crev: null };
}
export function uninviteSponsor(w: W, actor: Id, id: unknown, who: unknown) {
  const d = mine(w, actor, id);
  if (!own(d.sponsors, who)) fail('They aren’t invited.');
  delete d.sponsors[who as Id];
}
export function answerSponsor(w: W, actor: Id, id: unknown, yes: unknown) {
  const d = own(w.drafts, id);
  if (!d || !own(d.sponsors, actor)) fail('You haven’t been asked to co-sponsor that.');
  if (yes && !isMP(w, actor)) fail('Only MPs can co-sponsor.');
  d.sponsors[actor] = yes ? { status: 'yes', crev: d.crev } : { status: 'no', crev: null };
}

// for prop.new: the MPs who signed exactly the wording being tabled; the draft is used up
export function takeDraft(w: W, actor: Id, id: unknown, tabled: any): Id[] {
  const d = own(w.drafts, id);
  if (!d || d.by !== actor) return [];
  delete w.drafts[id as string];
  if (content(d) !== content(tabled)) return [];
  return Object.entries(d.sponsors).filter(([k, s]: any) => s.status === 'yes' && s.crev === d.crev && isMP(w, k) && k !== actor).map(([k]) => k);
}
