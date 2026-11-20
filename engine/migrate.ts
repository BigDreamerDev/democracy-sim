// Upgrades a saved world to the current shape. The live world persists across deploys, so any change to the
// world's shape (a new field, a renamed key) needs a step here. Steps must be idempotent: they run on every boot.
import { callOath } from './oath';
import { adoptCourtOffices } from './privy';
import { W } from './core';
import { SAFE_ZONES } from './streets';
import { freshDaily } from './glory';
import { activateParty } from './politics';
import { seedNations, seedProvinces, PROFILES } from './foreign';
import { exchange } from './exchange';
import { adoptHighCommission } from './empire';

export function migrate(w: W): W {
  // example: w.newThing ??= {};
  w.flags ??= {};
  w.lastEvent ??= {};
  w.crisisQueue ??= [];
  w.clock ??= { offset: 0, pausedAt: null };
  Object.values(w.offices || {}).forEach((o: any) => (o.nominee ??= null));
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
  // coups, regimes and what follows them
  w.coup ??= null;
  w.regime ??= null;
  w.transition ??= null;
  w.reckoning ??= null;
  w.reckoningDue ??= null;
  w.regimes ??= [];
  w.probes ??= [];
  w.probeAt ??= 0;
  w.scars ??= null;
  w.fame.regimes ??= [];
  w.fame.monarchs ??= [];
  w.economy.printedThisWeek ??= 0;
  w.economy.printed ??= 0;
  w.economy.coinage ??= [];
  w.economy.motion ??= null;
  w.economy.gold ??= 0;
  w.economy.inflatingThisWeek ??= w.economy.printedThisWeek || 0;
  w.economy.hotWeeks ??= 0;
  w.economy.freezeUntil ??= null;
  w.bonds ??= { issue: null, holdings: [], outstanding: 0, market: [] };
  w.bonds.market ??= [];
  w.config.currency ??= null;
  w.config.savingsTax ??= 0;
  w.config.savingsFloor ??= 200;
  w.config.edictsPerDay ??= 1;
  w.config.honoursPerWeek ??= 1;
  w.config.emeritusPay ??= 10;
  w.config.limits ??= {}; // caps a law has changed (limits.ts); missing keys use the default
  Object.values(w.offices || {}).forEach((o: any) => { if (o.template !== 'emeritus') return; o.styles ??= o.holder && o.style ? { [o.holder]: o.style } : {}; if (o.holder && !(o.members || []).includes(o.holder)) o.members = [o.holder, ...(o.members || [])]; });
  w.conditions ??= [];
  Object.values(w.crises || {}).forEach((c: any) => ((c.cast ??= []), (c.responses ??= {}), (c.helpers ??= {}), (c.bribes ??= {})));
  w.grudges ??= {};
  w.feuds ??= {};
  w.economy.fx ??= {};
  w.economy.fxPrev ??= {};
  w.crown ??= { reign: null, offer: null };
  w.crown.court ??= {};
  w.crown.circularAt ??= null;
  if (w.crown.reign) (w.crown.reign.toasts ??= 0), (w.crown.reign.toastDay ??= null), (w.crown.reign.toastedToday ??= []);
  // once: every proposal gets 12 hours of debate and 24 hours of voting (Parliament can still change the setting by bill)
  w.flags ??= {};
  if (!w.flags.timing1224) {
    w.flags.timing1224 = true;
    if (w.config) ((w.config.debateHours = 12), (w.config.voteHours = 24));
  }
  // Acts that change how the realm is governed (acts.ts)
  w.acts ??= { jail: null, decrees: null, continuity: null, unity: null, national: null };
  w.bannedParties ??= [];
  w.seasonDueAt ??= null;
  w.deputy ??= null;
  w.lastPM ??= null;
  Object.values(w.plots || {}).forEach((p: any) => ((p.informers ??= []), (p.chest ??= 0), (p.paid ??= {}), (p.asked ??= {}), (p.heat ??= 0), (p.backer ??= null)));
  w.drafts ??= {};
  w.pledges ??= {};
  w.breakaways ??= {};
  Object.values(w.elections || {}).forEach((e: any) => ((e.polls ??= []), (e.predictions ??= {}), (e.moves ??= Object.keys(e.ballots || {}).length), (e.movesAtPoll ??= 0)));
  // parties no longer need co-founders: any still waiting for signatures are founded now
  Object.values(w.parties || {}).forEach((p: any) => p.status === 'forming' && activateParty(w, p));
  Object.values(w.proposals || {}).forEach((p: any) => ((p.sponsors ??= []), (p.amendments ??= []), (p.history ??= []), p.amendments.forEach((m: any) => ((m.backers ??= []), (m.whips ??= {})))));
  // the wider world: two more nations, embassies and embargoes, wars abroad, the war campaign, the Exchange
  if (w.nations && w.accounts) {
    seedNations(w);
    seedProvinces(w);
    Object.values(w.nations).forEach((n: any) => ((n.power ??= PROFILES[n.id]?.strength ?? 4), (n.embassy ??= false), (n.embargo ??= false)));
  }
  w.conflicts ??= [];
  w.memorials ??= [];
  w.pensions ??= {};
  w.hostages ??= [];
  w.approaches ??= {};
  w.plants ??= {};
  w.ops ??= [];
  w.sweeps ??= [];
  w.exileGov ??= null;
  // the free city abroad was renamed so it is never mistaken for a realm named Aurel
  if (w.nations?.aurel?.name === 'Free City of Aurel') {
    w.nations.aurel.name = 'Free City of Austrava';
    if (w.nations.aurel.ruler?.title === 'Doge of Aurel') w.nations.aurel.ruler.title = 'Doge of Austrava';
  }
  // an Imperial High Commission made by hand (a custom office) becomes the real one, with its powers and proper title
  if (w.offices) adoptHighCommission(w, null);
  w.config && (w.config.formerNames ??= []);
  w.privy ??= null;
  w.oath ??= null;
  if (w.privy) adoptCourtOffices(w);
  if (w.acts?.imperial && !w.oath) callOath(w);
  if (w.oath) (delete w.oath.dueAt, delete w.oath.settled);
  w.warchest ??= { firms: {}, drawn: 0, drawnWeek: 0 };
  w.warchest.firms ??= {};
  if (w.army) w.army.kit ??= {};
  w.wars ??= [];
  if (w.army) {
    w.army.troops ??= 6;
    w.army.hero ??= null;
    w.army.defeatedAt ??= null;
    w.army.campaign ??= null;
    if (w.army.war && !w.army.campaign) w.army.campaign = { nation: w.army.war, by: 'us', startedAt: w.now, score: 0, strategy: 'hold', nextBattleAt: w.now + 12 * 3600_000, battles: [], volunteers: [], bonds: {}, bondTotal: 0, pretender: null };
  }
  if (w.now && w.citizens) exchange(w);
  if (w.crown) w.crown.claims ??= [];
  // the world saved at the start of induction week comes back when it ends, so it must be upgraded too
  if (w.induction?.snapshot && !w.induction.snapshot.induction) migrate(w.induction.snapshot);
  return w;
}
