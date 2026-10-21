// Bots play both scenarios for weeks. Checks the ledger always sums to zero and nothing throws.
import { createWorld, skip, ledgerTotal, HOUR, DAY, nm } from '../engine/index';
import { botsAct } from '../engine/bots';

for (const scenario of ['convention', 'running'] as const) {
  let w = createWorld(scenario);
  const start = w.now;
  const days = scenario === 'convention' ? 40 : 50;
  for (let t = 0; t < (days * DAY) / (6 * HOUR); t++) {
    w = botsAct(w, 'uzair', 1);
    w = skip(w, 6 * HOUR);
    if (ledgerTotal(w) !== 0) throw new Error(`Ledger out of balance (${ledgerTotal(w)}) at step ${t}`);
  }
  console.log(`\n== ${scenario}: ${Math.round((w.now - start) / DAY)} days ==`);
  console.log('phase', w.phase, '| season', w.season.n, '| seats', w.seats.map((s: string) => nm(w, s)).join(', '), '| PM', nm(w, w.pm), '| HOS', nm(w, w.hos.holder));
  console.log('laws', w.laws.length, '| proposals', Object.keys(w.proposals).length, '| offices', Object.keys(w.offices).join(','), '| meters', w.meters.prosperity, w.meters.stability, '| frontpages', w.frontpages.length);
  console.log('objectives done', Object.values(w.citizens).reduce((s: number, c: any) => s + c.objectives.filter((o: any) => o.done).length, 0));
  w.gazette.slice(0, 6).forEach((g: any) => console.log('  -', g.text));
}
