// Trials: a defector brought home (extradited or snatched) is tried for treason; under an absolute monarchy the
// Sovereign can charge a citizen with lèse-majesté. The Supreme Court's justices sit in judgement; with no Court, three
// citizens drawn by lot form a jury. A majority settles it; at the deadline the votes cast decide (a tie acquits).
// Guilty: the Realm Jail for a fixed term (treason 7 days, lèse-majesté 3), whether or not the Public Order Act is law.
// State: w.trials[id] = { id, who, charge, by, how, at, closesAt, judges[], votes{} (secret until the verdict), defence,
// status 'open'|'guilty'|'acquitted' }. Everything else is public.
import { W, Id, DAY, fail, own, cit, nm, gazette, newId, stamp, bump, approve, allCitizens, exiled, detained, shuffle, text, isPM, isHOS } from './core';

export const CHARGES: Record<string, { name: string; days: number }> = {
  treason: { name: 'Treason', days: 7 },
  lese: { name: 'Lèse-majesté', days: 3 }
};
export const TRIAL_DAYS = 2;
const free = (w: W, id: Id) => w.citizens[id]?.active && !w.citizens[id].bot && !w.citizens[id].defected && !exiled(w, id) && !detained(w, id);

export function openTrial(w: W, who: Id, charge: keyof typeof CHARGES, by: Id | null, how: string) {
  w.trials ??= {};
  if (Object.values(w.trials).some((t: any) => t.who === who && t.status === 'open')) return null;
  const court = (w.offices.court?.members || []).filter((id: Id) => id !== who && id !== by && free(w, id));
  const judges = court.length ? court : shuffle(w, allCitizens(w).filter((c: any) => c.id !== who && c.id !== by && free(w, c.id)).map((c: any) => c.id)).slice(0, 3);
  if (!judges.length) return null;
  const id = newId(w, 'tr');
  w.trials[id] = { id, who, charge, by, how, at: w.now, closesAt: w.now + TRIAL_DAYS * DAY, judges, votes: {}, defence: '', status: 'open', jury: !court.length };
  gazette(w, 'court', `${nm(w, who)} goes on trial for ${CHARGES[charge].name.toLowerCase()}${how ? ` (${how})` : ''}. ${court.length ? 'The Supreme Court sits in judgement' : `A jury drawn by lot will decide: ${judges.map((j: Id) => nm(w, j)).join(', ')}`}. Verdict within ${TRIAL_DAYS} days.`, '#/trial/' + id);
  return id;
}
export function defend(w: W, actor: Id, tid: unknown, words: unknown) {
  const t = own(w.trials || {}, tid);
  if (!t || t.status !== 'open') fail('That trial is over.');
  if (t.who !== actor) fail('Only the accused speaks in their own defence.');
  t.defence = text(words, 8, 1000, 'defence');
}
export function vote(w: W, actor: Id, tid: unknown, verdict: unknown) {
  const t = own(w.trials || {}, tid);
  if (!t || t.status !== 'open') fail('That trial is over.');
  if (!t.judges.includes(actor)) fail('Only the judges or the jury decide.');
  if (verdict !== 'guilty' && verdict !== 'innocent') fail('Guilty or not guilty.');
  t.votes[actor] = verdict;
  const g = Object.values(t.votes).filter((v) => v === 'guilty').length;
  const i = Object.values(t.votes).filter((v) => v === 'innocent').length;
  const need = Math.floor(t.judges.length / 2) + 1;
  if (g >= need || i >= need) settleTrial(w, t);
}
export function settleTrial(w: W, t: any) {
  if (t.status !== 'open') return;
  const g = Object.values(t.votes).filter((v) => v === 'guilty').length;
  const i = Object.values(t.votes).filter((v) => v === 'innocent').length;
  const c = w.citizens[t.who];
  const ch = CHARGES[t.charge];
  if (g > i && c && !isPM(w, c.id) && !isHOS(w, c.id)) {
    t.status = 'guilty';
    c.jail = { by: null, at: w.now, until: w.now + ch.days * DAY, why: `Convicted of ${ch.name.toLowerCase()}` };
    c.exiledUntil = Math.min(c.exiledUntil || 0, w.now);
    // the convicted lose their posts, as any detainee does
    Object.values(w.offices).forEach((o: any) => { if (o.holder === c.id) o.holder = null; if (o.members) o.members = o.members.filter((m: Id) => m !== c.id); });
    stamp(w, c.id, 'Convicted', `${ch.name}, ${ch.days} days in the Realm Jail`, 'bad');
    approve(w, c.id, -5);
    bump(w, c.id, 'convicted');
    gazette(w, 'court', `Guilty. ${c.name} is convicted of ${ch.name.toLowerCase()} (${g} to ${i}) and sent to the Realm Jail for ${ch.days} days.`, '#/trial/' + t.id);
  } else {
    t.status = 'acquitted';
    if (c) {
      c.exiledUntil = Math.min(c.exiledUntil || 0, w.now);
      stamp(w, c.id, 'Acquitted', ch.name, 'good');
      approve(w, c.id, 3);
    }
    if (t.by && t.charge === 'lese') approve(w, t.by, -3);
    gazette(w, 'court', `Not guilty. ${nm(w, t.who)} is acquitted of ${ch.name.toLowerCase()} (${g} to ${i}) and walks free.`, '#/trial/' + t.id);
  }
  t.verdictAt = w.now;
}
