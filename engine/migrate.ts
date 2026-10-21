// Upgrades a saved world to the current shape. The live world persists across deploys, so any change to the
// world's shape (a new field, a renamed key) needs a step here. Steps must be idempotent: they run on every boot.
import { W } from './core';
import { SAFE_ZONES } from './streets';
import { freshDaily } from './glory';

export function migrate(w: W): W {
  // example: w.newThing ??= {};
  w.flags ??= {};
  w.lastEvent ??= {};
  w.crisisQueue ??= [];
  w.clock ??= { offset: 0, pausedAt: null };
  if (!w.pm && w.phase === 'running') w.formingSince ??= w.now;
  w.config.inductionDays ??= 7;
  if (w.phase === 'convention') {
    w.convention.closesAt ??= w.now + 3 * 86400_000;
    w.convention.clauses.forEach((c: any) => ((c.optBy ??= c.options.map(() => null)), (c.vals ??= c.options.slice()), (c.kind ??= 'core'), (c.def ??= 0)));
  }
  Object.values(w.citizens || {}).forEach((c: any) => (c.tutorial ??= {}));
  Object.values(w.crises || {}).forEach((c: any) => (c.votes ??= {}));
  // the Streets, the market, betting, the Red Box, polls and the Hall of Fame
  w.streets ??= { zones: SAFE_ZONES.map((text, i) => ({ id: 'z' + i, text, by: 'default' })), contracts: {}, protect: null, meets: [] };
  w.bounties ??= {};
  w.stalls ??= {};
  w.orders ??= {};
  w.jobs ??= {};
  w.jobClaims ??= [];
  w.markets ??= {};
  w.ultimatums ??= [];
  w.daily ??= freshDaily(w.now);
  w.dailyPast ??= [];
  w.polls ??= [];
  w.fame ??= { pms: [], seasons: [], records: {} };
  w.hunt ??= null;
  Object.values(w.citizens || {}).forEach((c: any) => ((c.streets ??= { in: false }), (c.life ??= {}), (c.badges ??= {})));
  w.clockErrors ??= [];
  // the world saved at the start of induction week comes back when it ends, so it must be upgraded too
  if (w.induction?.snapshot && !w.induction.snapshot.induction) migrate(w.induction.snapshot);
  return w;
}
