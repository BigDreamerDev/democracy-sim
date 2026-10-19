// Upgrades a saved world to the current shape. The live world persists across deploys, so any change to the
// world's shape (a new field, a renamed key) needs a step here. Steps must be idempotent: they run on every boot.
import { W } from './core';

export function migrate(w: W): W {
  // example: w.newThing ??= {};
  w.flags ??= {};
  w.lastEvent ??= {};
  w.crisisQueue ??= [];
  Object.values(w.crises || {}).forEach((c: any) => (c.votes ??= {}));
  return w;
}
