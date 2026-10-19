// Upgrades a saved world to the current shape. The live world persists across deploys, so any change to the
// world's shape (a new field, a renamed key) needs a step here. Steps must be idempotent: they run on every boot.
import { W } from './core';

export function migrate(w: W): W {
  // example: w.newThing ??= {};
  w.flags ??= {};
  w.lastEvent ??= {};
  w.crisisQueue ??= [];
  w.config.inductionDays ??= 7;
  if (w.phase === 'convention') {
    w.convention.closesAt ??= w.now + 3 * 86400_000;
    w.convention.clauses.forEach((c: any) => ((c.optBy ??= c.options.map(() => null)), (c.vals ??= c.options.slice()), (c.kind ??= 'core'), (c.def ??= 0)));
  }
  Object.values(w.citizens || {}).forEach((c: any) => (c.tutorial ??= {}));
  Object.values(w.crises || {}).forEach((c: any) => (c.votes ??= {}));
  return w;
}
