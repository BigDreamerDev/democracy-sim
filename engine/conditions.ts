// Conditions: what a crisis leaves behind. Each lasts some weeks and acts on the whole realm at every payday, or changes a
// rule while it lasts (no income tax in a strike, half pay for MPs under an inquiry, no grants in an outage...). Public.
// State: w.conditions = [{ id, type, at, until, note }]. Payday calls weekly(); the clock ends each one at `until`.
import { W, DAY, newId, gazette, meter, transfer, allCitizens, exiled, ca, bal, shuffle } from './core';

type Cond = { label: string; blurb: string; weekly?: (w: W) => void; end?: (w: W) => void; good?: boolean };
const people = (w: W) => allCitizens(w).filter((c: any) => !c.bot && !exiled(w, c.id));
const payAll = (w: W, n: number, memo: string) => people(w).forEach((c: any) => transfer(w, 'reserve', ca(c.id), n, memo));

export const CONDITIONS: Record<string, Cond> = {
  quarantine: { label: 'Quarantine', blurb: 'Shops shut early. Prosperity −1 each payday.', weekly: (w) => meter(w, 'prosperity', -1, 'The quarantine') },
  epidemic: { label: 'Epidemic', blurb: 'Each payday three citizens fall ill and pay 5 crowns in medical bills. Stability −1.', weekly: (w) => {
    shuffle(w, people(w).map((c: any) => c.id)).slice(0, 3).forEach((id: string) => bal(w, ca(id)) >= 5 && transfer(w, ca(id), 'treasury', 5, 'Medical bills in the epidemic'));
    meter(w, 'stability', -1, 'The epidemic');
  } },
  boom: { label: 'Boom', good: true, blurb: 'Wages are up: every citizen gets 2 crowns each payday.', weekly: (w) => payAll(w, 2, 'Boom-time wages') },
  bubble: { label: 'Bubble', good: true, blurb: 'Easy money: every citizen gets 4 crowns each payday, and prices rise 3% faster. It will burst.', weekly: (w) => payAll(w, 4, 'Bubble money') },
  recession: { label: 'Recession', blurb: 'Prosperity −2 each payday.', weekly: (w) => meter(w, 'prosperity', -2, 'The recession') },
  drought: { label: 'Drought', blurb: 'Food is dear: prices rise 2% faster and Prosperity −1 each payday.', weekly: (w) => meter(w, 'prosperity', -1, 'The drought') },
  rationing: { label: 'Rationing', blurb: 'The citizen dividend is 2 crowns lower.' },
  inquiry: { label: 'Expenses inquiry', blurb: 'MPs are on half pay.' },
  strike: { label: 'General strike', blurb: 'No income tax is collected. Prosperity −2 each payday.', weekly: (w) => meter(w, 'prosperity', -2, 'The general strike') },
  drain: { label: 'Brain drain', blurb: 'The talented are leaving. Prosperity −1 each payday.', weekly: (w) => meter(w, 'prosperity', -1, 'The brain drain') },
  refugees: { label: 'Refugee camps', blurb: 'The Treasury spends 10 crowns a week on the camps. When they close, the newcomers lift Prosperity by 4.', weekly: (w) => {
    const n = w.nations.kessmark ? 'kessmark' : Object.keys(w.nations)[0];
    transfer(w, 'treasury', 'nation:' + n, 10, 'Refugee camp supplies');
  }, end: (w) => meter(w, 'prosperity', 4, 'Refugees settled and working') },
  controls: { label: 'Capital controls', blurb: 'The savings tax is doubled, and no new bonds can be sold.' },
  outage: { label: 'Treasury outage', blurb: 'The Treasury’s systems are down: no grants can be paid.' },
  building: { label: 'Building programme', good: true, blurb: 'New homes going up. Prosperity +1 each payday.', weekly: (w) => meter(w, 'prosperity', 1, 'The building programme') },
  celebration: { label: 'Celebrations', good: true, blurb: 'Street parties and full hotels. Stability +1 and Prosperity +1 each payday.', weekly: (w) => (meter(w, 'stability', 1, 'Celebrations'), meter(w, 'prosperity', 1, 'Celebrations')) },
  mourning: { label: 'Mourning', blurb: 'The realm is in mourning. Stability +1 each payday, Prosperity −1.', weekly: (w) => (meter(w, 'stability', 1, 'A nation in mourning'), meter(w, 'prosperity', -1, 'A nation in mourning')) }
};

export const hasCond = (w: W, type: string) => (w.conditions || []).some((c: any) => c.type === type && c.until > w.now);
export function addCondition(w: W, type: string, weeks: number, note = '') {
  const d = CONDITIONS[type];
  if (!d) return;
  w.conditions ??= [];
  const c = w.conditions.find((x: any) => x.type === type && x.until > w.now);
  if (c) c.until += weeks * 7 * DAY;
  else w.conditions.push({ id: newId(w, 'cd'), type, at: w.now, until: w.now + weeks * 7 * DAY, note });
  gazette(w, 'government', `${d.label}, for ${weeks} week${weeks === 1 ? '' : 's'}: ${d.blurb}`, '#/realm');
}
export function weekly(w: W) {
  (w.conditions || []).forEach((c: any) => c.until > w.now && CONDITIONS[c.type]?.weekly?.(w));
}
export function endCondition(w: W, c: any) {
  w.conditions = (w.conditions || []).filter((x: any) => x !== c);
  const d = CONDITIONS[c.type];
  if (!d) return;
  d.end?.(w);
  gazette(w, 'government', `The ${d.label.toLowerCase()} is over.`, '#/realm');
}
