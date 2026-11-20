// Crises: one lands at each payday, when a chained consequence comes due, or when the Returning Officer starts one.
// - Most are decided by the Prime Minister within 24 hours. `house: true` ones go to a vote of MPs (36 hours).
// - If nobody decides, the LAST option runs, so make the last option the "do nothing" one.
// - `then: { type, days }` on an option queues a follow-up crisis: choices come back to bite. If `run` returns
//   exactly `false`, the follow-up is skipped (for gambles that didn't pay off).
// - `chainOnly` crises never appear at random; `weight` makes a crisis rarer (default 1); `needs` limits where it fits.
// `effects` is what players see before choosing, so keep it honest and in step with `run`.
// Money only moves through transfer(), so the ledger balances.
import { lim } from './limits';
import { W, Id, DAY, HOUR, shuffle, bump, stamp, int, clamp, fail, newId, transfer, meter, approve, earn, addCard, allCitizens, holderOf, chance, rand, ca, bal, gazette, legit, detained, exiled, isMP, isPM, mps, nm, mustBeFree, weekNo, tick, own } from './core';
import { armyLoyalty } from './foreign';
import { openMarket, settleMarket } from './markets';
import { callGeneralElection } from './politics';
import { takePower } from './regime';
import { addCondition } from './conditions';
import { fx } from './economy';

// ---------- who a crisis falls on: more than the PM and the meters ----------
const citizensNow = (w: W) => allCitizens(w).filter((c: any) => !c.bot && !exiled(w, c.id));
const byWealth = (w: W) => citizensNow(w).sort((a: any, b: any) => bal(w, ca(b.id)) - bal(w, ca(a.id)));
const richest = (w: W, n = 3) => byWealth(w).slice(0, n).map((c: any) => c.id);
const poorest = (w: W, n = 3) => byWealth(w).slice(-n).map((c: any) => c.id);
// take up to n crowns from each (never into debt), to the Treasury or another account
const levy = (w: W, ids: string[], n: number, to: string, memo: string) => ids.forEach((id) => { const a = Math.min(n, bal(w, ca(id))); if (a > 0) transfer(w, ca(id), to, a, memo); });
const share = (w: W, from: string, ids: string[], n: number, memo: string) => ids.forEach((id) => transfer(w, from, ca(id), n, memo));
const approveAll = (w: W, ids: string[], d: number) => ids.forEach((id) => approve(w, id, d));
const ministers = (w: W) => [...new Set(Object.values(w.offices).filter((o: any) => o.holder && (o.fill === 'pm' || o.fill === 'crown')).map((o: any) => o.holder as string))];
const cond = addCondition;
// a follow-on's cast: someone from the first crisis, if they are still here
const pv = (prev: any, i: number) => prev?.[i]?.id as Id | undefined;
// strip someone of every post the PM or the Crown gave them
const vacate = (w: W, id: Id | undefined) => id && Object.values(w.offices).forEach((o: any) => o.holder === id && (o.fill === 'pm' || o.fill === 'crown') && ((o.holder = null), gazette(w, 'government', `${nm(w, id)} loses the post of ${o.title}.`, '#/offices')));
// two different people from a pool (or anyone)
const pair = (w: W, kind: string, roles: [string, string]) => { const p = shuffle(w, pool(w, kind)); const a = p[0]; const b = shuffle(w, freeCitizens(w).filter((x) => x !== a))[0]; return [a && { id: a, role: roles[0] }, b && { id: b, role: roles[1] }].filter(Boolean) as { id: Id; role: string }[]; };
const one = (w: W, kind: string, role: string) => { const a = shuffle(w, pool(w, kind))[0]; return a ? [{ id: a, role }] : []; };
// n citizens picked at random (seeded)
const some = (w: W, n: number) => shuffle(w, citizensNow(w).map((c: any) => c.id)).slice(0, n);
// Standing comes from how the nations feel: move that many of them a step
const standingShift = (w: W, d: number, why: string) => Object.keys(w.nations).slice(0, Math.abs(d)).forEach((n) => mood(w, n, Math.sign(d), why));

type Option = { label: string; what: string; effects: string[]; run: (w: W, c?: any) => any; then?: { type: string; days: number } };
// cast: who is caught up in it (named players). Without one, castFor() picks people from the crisis's title.
export type Crisis = { id: string; title: string; text: string; needs?: (w: W) => boolean; options: Option[]; house?: boolean; chainOnly?: boolean; weight?: number; extreme?: boolean; cast?: (w: W, prev?: { id: Id; role: string }[]) => { id: Id; role: string }[] };

// ---------- small helpers so each crisis reads like a sentence ----------
const spend = (w: W, n: number, to: string, memo: string) => transfer(w, 'treasury', to, n, memo);
const mood = (w: W, nation: string, d: number, why: string) => {
  const n = w.nations[nation];
  if (!n) return;
  n.mood = clamp(n.mood + d, 0, 4);
  n.reasons.unshift({ sign: d > 0 ? '+' : '−', text: why });
  n.reasons = n.reasons.slice(0, 5);
};
const owe = (w: W, nation: string, why: string) => w.nations[nation]?.reasons.unshift({ sign: '−', text: why });
const army = (w: W, d: number, why: string) => w.offices.army && armyLoyalty(w, d, why);
const prices = (w: W, pct: number) => {
  const p = w.economy.prices;
  p.push(Math.round(p[p.length - 1] * (100 + pct)) / 100);
};
const everyone = (w: W, n: number, why: string) => allCitizens(w).forEach((c: any) => earn(w, c.id, n, why));
const pmCard = (w: W, title: string, from: string) => addCard(w, { title, about: w.pm, from, level: 'restricted', viewers: ['pm'] });
const has = (w: W, office: string) => !!w.offices[office];
const monarchy = (w: W) => w.config.hos === 'monarchy';
const lastPrice = (w: W) => w.economy.prices[w.economy.prices.length - 1];
// a snap general election in two days, unless one is already under way
const snapElection = (w: W) => {
  if (w.acts?.continuity) return gazette(w, 'election', 'A snap election would be called, but the Continuity of Parliament Act forbids it.', '#/house');
  if (Object.values(w.elections).some((e: any) => e.kind === 'general' && e.status === 'open')) return;
  gazette(w, 'election', 'A snap general election is called.', '#/elections');
  callGeneralElection(w, w.now + 2 * DAY);
};
// a state of emergency: Parliament is suspended and the PM rules for 3 days, then a Restoration election
const emergency = (w: W) => {
  if (!w.pm || w.martial || w.regime || w.transition) return;
  w.martial = { leader: w.pm, plotters: [], until: w.now + 3 * DAY, emergency: true };
  w.citizens[w.pm].stats.ruledByDecree = true;
  gazette(w, 'government', `A state of emergency. Parliament is suspended and ${nm(w, w.pm)} rules by decree for 3 days, then the realm votes.`, '#/cabinet');
};
// the head of state's time is up: a new one is chosen as the constitution says
const hosGoes = (w: W) => w.hos.holder && !w.acts?.protection && (w.hos.until = w.now + HOUR);
const card = (w: W, about: Id | null, title: string, from: string, viewers: string[]) => addCard(w, { title, about, from, level: 'restricted', viewers });

export const CRISES: Crisis[] = [
  // ---------- home ----------
  {
    id: 'flood', title: 'The river has flooded', text: 'The east bank is under water. Four families have lost their homes, and the insurers are refusing to pay.',
    options: [
      { label: 'Compensate the families', what: 'The Treasury pays each household and rebuilds.', effects: ['Treasury −60', 'Four citizens +10 each', 'Building programme 1 week', 'Stability +2'], run: (w) => (share(w, 'treasury', some(w, 4), 10, 'Flood compensation'), spend(w, 20, 'reserve', 'Flood defences'), cond(w, 'building', 1), meter(w, 'stability', 2, 'Flood homes rebuilt')) },
      { label: 'Ask Varnholm for help', what: 'They send timber and engineers, and will expect a favour.', effects: ['Free now', 'Varnholm will call in the favour'], run: (w) => owe(w, 'varnholm', 'We owe them for flood help'), then: { type: 'varnholm_favour', days: 7 } },
      { label: 'Leave it to the insurers', what: 'Owners rebuild at their own cost.', effects: ['Four citizens lose up to 8 each', 'Stability −4', 'Ministers approval −1'], run: (w) => (levy(w, some(w, 4), 8, 'reserve', 'Flood damage'), meter(w, 'stability', -4, 'The flood was left to the insurers'), approveAll(w, ministers(w), -1)) }
    ]
  },
  {
    id: 'harvest', title: 'The harvest has failed', text: 'Blight in the wheat. Bread will be scarce for weeks, and the poorest will feel it first.',
    options: [
      { label: 'Import grain', what: 'The Treasury buys abroad. A weak crown makes it dearer.', effects: ['Treasury −40 or more', 'Sundmere warms', 'Stability +2'], run: (w) => (spend(w, Math.round(40 / fx(w, 'sundmere')), 'nation:sundmere', 'Emergency grain'), mood(w, 'sundmere', 1, 'Bought their grain'), meter(w, 'stability', 2, 'Grain was imported')) },
      { label: 'Ration bread', what: 'Fair shares, smaller for everyone.', effects: ['Rationing 2 weeks (dividend −2)', 'Stability −1'], run: (w) => (cond(w, 'rationing', 2), meter(w, 'stability', -1, 'Bread rationing')) },
      { label: 'Let prices rise', what: 'The market sets the price of bread. The poor may not stand for it.', effects: ['Prices +5%', 'The poorest three −3 each', 'Prosperity −3', 'Bread riots may follow'], run: (w) => (prices(w, 5), levy(w, poorest(w), 3, 'reserve', 'Dear bread'), meter(w, 'prosperity', -3, 'Food prices jumped')), then: { type: 'bread_riots', days: 5 } }
    ]
  },
  {
    id: 'fever', title: 'A fever spreads in the capital', text: 'The hospitals are filling and people are scared. The doctors want the markets closed.',
    options: [
      { label: 'Open free clinics', what: 'The Treasury pays for doctors and medicine.', effects: ['Treasury −50', 'The poorest three treated free (+3 each)', 'Stability +2'], run: (w) => (spend(w, 41, 'reserve', 'Free clinics'), share(w, 'treasury', poorest(w), 3, 'Free treatment'), meter(w, 'stability', 2, 'Free clinics opened')) },
      { label: 'Close the markets', what: 'The fever slows, and so does trade.', effects: ['Quarantine 1 week (Prosperity −1)', 'Stability +1'], run: (w) => (cond(w, 'quarantine', 1), meter(w, 'stability', 1, 'The fever was contained')) },
      { label: 'Carry on as normal', what: 'Business continues; the sick fend for themselves.', effects: ['Epidemic 2 weeks (medical bills, Stability −1 a week)'], run: (w) => cond(w, 'epidemic', 2) }
    ]
  },
  {
    id: 'library', title: 'Fire at the Great Library', text: 'Centuries of records are burning. The city is watching.',
    options: [
      { label: 'Rebuild it properly', what: 'A new library, paid for by the state.', effects: ['Treasury −45', 'Stability +3'], run: (w) => (spend(w, 45, 'escrow', 'Rebuilding the Great Library'), meter(w, 'stability', 3, 'The Library rose again')) },
      { label: 'Launch a public appeal', what: 'Every citizen chips in 2 crowns if they can.', effects: ['Everyone −2 crowns', 'Stability +2', 'Everyone +1 Influence'], run: (w) => (allCitizens(w).forEach((c: any) => bal(w, ca(c.id)) >= 2 && transfer(w, ca(c.id), 'treasury', 2, 'Library appeal')), spend(w, 2 * allCitizens(w).length, 'escrow', 'Rebuilding the Great Library'), meter(w, 'stability', 2, 'The city rebuilt its Library'), everyone(w, 1, 'Gave to the Library appeal')) },
      { label: 'Leave the ruins', what: 'A sad gap on the skyline.', effects: ['Stability −3'], run: (w) => meter(w, 'stability', -3, 'The Library lies in ruins') }
    ]
  },
  {
    id: 'bridge', title: 'The old bridge collapses', text: 'The only road to the market towns is cut. Traders are stuck on the far side with their goods.',
    options: [
      { label: 'Build a new bridge', what: 'Expensive, but it lasts a century.', effects: ['Treasury −50', 'Building programme 2 weeks (Prosperity +1 a week)'], run: (w) => (spend(w, 50, 'reserve', 'The new bridge'), cond(w, 'building', 2)) },
      { label: 'Run a ferry', what: 'Cheap and slow. Traders pay a toll.', effects: ['Treasury −10', 'Three citizens pay a 2-crown toll', 'Prosperity −2'], run: (w) => (spend(w, 10, 'reserve', 'Ferry service'), levy(w, some(w, 3), 2, 'treasury', 'Ferry toll'), meter(w, 'prosperity', -2, 'Trade crawls by ferry')) },
      { label: 'Leave it', what: 'The market towns are cut off.', effects: ['Recession 1 week (Prosperity −2)', 'Ministers approval −1'], run: (w) => (cond(w, 'recession', 1), approveAll(w, ministers(w), -1)) }
    ]
  },
  {
    id: 'drought', title: 'A summer drought', text: 'The reservoirs are at their lowest in living memory.',
    options: [
      { label: 'Buy water from Sundmere', what: 'Barges of water upriver, at a price.', effects: ['Treasury −35', 'Sundmere warms'], run: (w) => (spend(w, 35, 'nation:sundmere', 'Emergency water'), mood(w, 'sundmere', 1, 'We bought their water')) },
      { label: 'Ration water', what: 'Fair, but nobody enjoys it.', effects: ['Prosperity −3', 'Stability −1'], run: (w) => (meter(w, 'prosperity', -3, 'Water rationing'), meter(w, 'stability', -1, 'Water rationing')) },
      { label: 'Pray for rain', what: 'It might rain.', effects: ['Half the time: nothing', 'Otherwise: Prosperity −6'], run: (w) => (chance(w, 0.5) && meter(w, 'prosperity', -6, 'The drought dragged on')) }
    ]
  },
  {
    id: 'teachers', title: 'The teachers walk out', text: 'Schools are shut and parents are furious.',
    options: [
      { label: 'Give them a raise', what: 'Back to work by Monday. Every other public worker will want the same.', effects: ['Treasury −40', 'Stability +2', 'Ministers approval +1'], run: (w) => (spend(w, 40, 'escrow', 'Teachers’ pay rise'), meter(w, 'stability', 2, 'The teachers went back'), approveAll(w, ministers(w), 1)) },
      { label: 'Pay for it with a levy', what: 'Every household chips in 2 crowns for the schools.', effects: ['Everyone −2', 'Stability +1'], run: (w) => (levy(w, citizensNow(w).map((c: any) => c.id), 2, 'reserve', 'Schools levy'), meter(w, 'stability', 1, 'The schools reopened')) },
      { label: 'Wait them out', what: 'Parents take time off to mind the children. Other unions are watching.', effects: ['Prosperity −2', 'Stability −2', 'Others may join them'], run: (w) => (meter(w, 'prosperity', -2, 'Parents kept home'), meter(w, 'stability', -2, 'A long school strike')), then: { type: 'general_strike', days: 14 } }
    ]
  },
  {
    id: 'strike', title: 'The dockworkers strike', text: 'Ships sit unloaded in the harbour.',
    options: [
      { label: 'Meet their demands', what: 'A one-off payment ends the strike.', effects: ['Treasury −50', 'Stability +2'], run: (w) => (spend(w, 50, 'escrow', 'Strike settlement'), transfer(w, 'escrow', 'nation:tessaly', 50, 'Dock contracts'), meter(w, 'stability', 2, 'The strike was settled')) },
      { label: 'Wait it out', what: 'Trade stalls until they give up.', effects: ['Prosperity −5'], run: (w) => meter(w, 'prosperity', -5, 'A long strike') }
    ]
  },
  {
    id: 'protest', title: 'Protesters fill the square', text: 'Thousands want the government to listen. Some want it gone.',
    options: [
      { label: 'Meet their leaders', what: 'The PM hears them out on the steps.', effects: ['PM approval −2', 'Stability +3'], run: (w) => (approve(w, w.pm, -2), meter(w, 'stability', 3, 'The PM met the protesters')) },
      { label: 'Clear the square', what: 'Order is restored, bitterly.', effects: ['Stability −3', 'Army loyalty +1 (if there is one)'], run: (w) => (meter(w, 'stability', -3, 'The square was cleared'), army(w, 1, 'Trusted to restore order')) },
      { label: 'Ignore them', what: 'They will go home eventually. Or they won’t.', effects: ['Stability −4', 'It may turn into riots'], run: (w) => meter(w, 'stability', -4, 'The protests were ignored'), then: { type: 'riots', days: 7 } }
    ]
  },
  {
    id: 'expenses', title: 'A minister’s expenses leak', text: 'Receipts for a very expensive dinner are going round the city.', needs: (w) => !!w.pm,
    options: [
      { label: 'Publish everyone’s expenses', what: 'Total openness. Embarrassing for the whole government.', effects: ['PM approval −3', 'Stability +2'], run: (w) => (approve(w, w.pm, -3), meter(w, 'stability', 2, 'Expenses published in full')) },
      { label: 'Make the minister repay it', what: 'A neat ending, if nobody digs further.', effects: ['Stability +1'], run: (w) => meter(w, 'stability', 1, 'The money was repaid') },
      { label: 'Say it was legitimate', what: 'Stonewall, and keep the truth on file.', effects: ['A secret card about the PM', 'Stability −1', 'It may resurface'], run: (w) => (pmCard(w, 'The PM defended a dinner that was never official business.', 'Cabinet Office'), meter(w, 'stability', -1, 'The government stonewalled')), then: { type: 'expenses_return', days: 10 } }
    ]
  },
  {
    id: 'whistle', title: 'A whistleblower comes forward', text: 'A clerk says the government has been hiding the true state of the books.', needs: (w) => !!w.pm,
    options: [
      { label: 'Open an inquiry', what: 'Painful, but the public trusts it.', effects: ['PM approval −2', 'Stability +2'], run: (w) => (approve(w, w.pm, -2), meter(w, 'stability', 2, 'An honest inquiry')) },
      { label: 'Discredit the clerk', what: 'It works, mostly. Someone keeps a copy.', effects: ['A secret card about the PM'], run: (w) => pmCard(w, 'The government smeared a whistleblower who was telling the truth.', 'A clerk') },
      { label: 'Ignore it', what: 'The story grows on its own.', effects: ['Stability −3'], run: (w) => meter(w, 'stability', -3, 'A whistleblower was ignored') }
    ]
  },
  {
    id: 'comet', title: 'A comet over the realm', text: 'Crowds gather every night. Preachers call it an omen; the observatory calls it a tourist season.',
    options: [
      { label: 'Declare a holiday', what: 'A night off to watch the sky.', effects: ['Celebration 1 week', 'Everyone +1 Influence', 'Prosperity −1'], run: (w) => (cond(w, 'celebration', 1), everyone(w, 1, 'Watched the comet'), meter(w, 'prosperity', -1, 'A comet holiday')) },
      { label: 'Sell viewing tickets', what: 'The observatory charges visitors from abroad.', effects: ['Treasury +20 from tourists', 'Tessaly warms'], run: (w) => (bal(w, 'nation:tessaly') >= 20 && transfer(w, 'nation:tessaly', 'treasury', 20, 'Comet tourists'), mood(w, 'tessaly', 1, 'Enjoyed our comet')) },
      { label: 'Carry on', what: 'It is only a rock.', effects: ['Nothing happens'], run: () => {} }
    ]
  },
  {
    id: 'inventor', title: 'An inventor wants funding', text: 'She says her engine will double the mills’ output. She might be right.',
    options: [
      { label: 'Fund her', what: 'A gamble: it works or it doesn’t. If it works, others will want it.', effects: ['Treasury −30', 'Even chance: Prosperity +4 and a 2-week boom'], run: (w) => (spend(w, 30, 'escrow', 'Funding an inventor'), chance(w, 0.5) ? (meter(w, 'prosperity', 4, 'The new engine worked'), cond(w, 'boom', 2), true) : false), then: { type: 'engine_offer', days: 7 } },
      { label: 'Find her a private backer', what: 'The realm’s richest citizen puts up the money and takes the profit.', effects: ['The richest citizen invests 15', 'Even chance: they get 35 back and Prosperity +2'], run: (w) => { const r = richest(w, 1)[0]; if (!r) return; levy(w, [r], 15, 'reserve', 'Backed the inventor'); if (chance(w, 0.5)) (share(w, 'reserve', [r], 35, 'The engine paid off'), meter(w, 'prosperity', 2, 'The new engine worked')); } },
      { label: 'Send her to the banks', what: 'Let private money take the risk. She may take it abroad.', effects: ['Brain drain 1 week'], run: (w) => cond(w, 'drain', 1) }
    ]
  },

  // ---------- the long tail: crises that fall on citizens, MPs and ministers, and leave conditions behind ----------
  {
    id: 'plague', title: 'Cholera in the slums', text: 'Bad water in the poorer streets. Cholera is spreading, and the hospitals are full.', weight: 0.8,
    options: [
      { label: 'Quarantine the city', what: 'Close the markets and keep people home.', effects: ['Quarantine 2 weeks (Prosperity −1 a week)', 'Everyone −2 crowns now', 'Stability +1'], run: (w) => (levy(w, citizensNow(w).map((c: any) => c.id), 2, 'treasury', 'Quarantine levy'), cond(w, 'quarantine', 2), meter(w, 'stability', 1, 'Firm action on the fever')) },
      { label: 'Hire doctors from Orrin', what: 'Expensive, but it works.', effects: ['Treasury −60', 'Orrin warms', 'The poorest three get free care (+5 each)'], run: (w) => (spend(w, 60, w.nations.orrin ? 'nation:orrin' : 'nation:' + Object.keys(w.nations)[0], 'Doctors from abroad'), mood(w, 'orrin', 1, 'Our doctors helped them'), share(w, 'treasury', poorest(w), 5, 'Free care in the fever')) },
      { label: 'Keep everything open', what: 'Life must go on.', effects: ['Epidemic 3 weeks (3 citizens a week pay medical bills)', 'Stability −1 a week'], run: (w) => cond(w, 'epidemic', 3) }
    ]
  },
  {
    id: 'boom', title: 'A boom in the workshops', text: 'Orders are pouring in. Everyone wants to know how long it can last.', weight: 0.7, needs: (w) => w.meters.prosperity >= 55,
    options: [
      { label: 'Tax the windfall', what: 'Take a share for the Treasury while it lasts.', effects: ['Treasury +40 (from the richest five)', 'Boom 2 weeks (everyone +2 a week)'], run: (w) => (levy(w, richest(w, 5), 8, 'treasury', 'Windfall tax'), cond(w, 'boom', 2)) },
      { label: 'Let it run', what: 'Cheap money, rising prices, happy voters. For now.', effects: ['Bubble 3 weeks (everyone +4 a week, prices +3%)', 'A crash follows'], run: (w) => cond(w, 'bubble', 3), then: { type: 'crash', days: 21 } },
      { label: 'Raise the rate to cool it', what: 'The Reserve leans against the wind.', effects: ['Rate +3%', 'Boom 1 week'], run: (w) => ((w.economy.rate = Math.min(15, w.economy.rate + 3)), cond(w, 'boom', 1)) }
    ]
  },
  {
    id: 'crash', chainOnly: true, extreme: true, title: 'The bubble bursts', text: 'Prices collapse overnight. Savers who bought at the top are ruined.',
    options: [
      { label: 'Bail out the savers', what: 'The Treasury makes the biggest losers whole.', effects: ['Treasury −80', 'The ten poorest +8 each', 'Prosperity −2'], run: (w) => (share(w, 'treasury', poorest(w, 10), 8, 'Crash relief'), meter(w, 'prosperity', -2, 'The crash')) },
      { label: 'Let the market clear', what: 'Painful, but honest.', effects: ['The richest five lose up to 15 each', 'Recession 2 weeks (Prosperity −2 a week)'], run: (w) => (levy(w, richest(w, 5), 15, 'reserve', 'Lost in the crash'), cond(w, 'recession', 2)) },
      { label: 'Print to prop it up', what: 'The Reserve buys everything in sight.', effects: ['Everyone +5 (new money)', 'Prices +10%', 'Recession 1 week'], run: (w) => (share(w, 'reserve', citizensNow(w).map((c: any) => c.id), 5, 'Reserve support in the crash'), prices(w, 10), cond(w, 'recession', 1)) }
    ]
  },
  {
    id: 'dry_summer', title: 'The rains have failed', text: 'A dry summer. The harvest is half what it should be.', weight: 0.8,
    options: [
      { label: 'Import grain', what: 'Buy from abroad. A weak crown makes it dear.', effects: ['Treasury pays 40 (more if the crown is weak)', 'Varnholm warms'], run: (w) => { const n = w.nations.varnholm ? 'varnholm' : Object.keys(w.nations)[0]; spend(w, Math.round(40 / fx(w, n)), 'nation:' + n, 'Grain imports'); mood(w, n, 1, 'Bought their grain'); } },
      { label: 'Ration food', what: 'Fair shares for everyone, smaller for all.', effects: ['Rationing 2 weeks (dividend −2)', 'Stability −1'], run: (w) => (cond(w, 'rationing', 2), meter(w, 'stability', -1, 'Rationing')) },
      { label: 'Wait for rain', what: 'It has to come eventually.', effects: ['Drought 3 weeks (prices +2% a week, Prosperity −1 a week)'], run: (w) => cond(w, 'drought', 3) }
    ]
  },
  {
    id: 'expenses_scandal', house: true, title: 'The expenses scandal', text: 'A leaked ledger shows MPs claiming for duck houses, moats and second homes.', weight: 0.8, needs: (w) => mps(w).length >= 3,
    options: [
      { label: 'Every MP repays 5', what: 'Clean hands all round.', effects: ['Every MP −5 to the Treasury', 'Every MP approval +1', 'Stability +1'], run: (w) => (levy(w, mps(w), 5, 'treasury', 'Repaid expenses'), approveAll(w, mps(w), 1), meter(w, 'stability', 1, 'MPs paid it back')) },
      { label: 'A public inquiry', what: 'Half pay for MPs until it reports.', effects: ['Expenses inquiry 3 weeks (MPs on half pay)', 'Every MP approval −1'], run: (w) => (cond(w, 'inquiry', 3), approveAll(w, mps(w), -1)) },
      { label: 'Close ranks', what: 'Nothing to see here.', effects: ['Every MP approval −3', 'Stability −3'], run: (w) => (approveAll(w, mps(w), -3), meter(w, 'stability', -3, 'MPs closed ranks over expenses')) }
    ]
  },
  {
    id: 'unions_out', house: true, title: 'The unions walk out', text: 'Every union in the realm has walked out at once. Nothing moves.', weight: 0.7,
    options: [
      { label: 'Meet their demands', what: 'A permanent rise in the dividend.', effects: ['Dividend +1 for good', 'Treasury −20 now', 'Stability +2'], run: (w) => ((w.config.dividend = Math.min(20, w.config.dividend + 1)), spend(w, 20, 'reserve', 'Strike settlement'), meter(w, 'stability', 2, 'The strike settled')) },
      { label: 'Break the strike', what: 'Send in the Army.', effects: ['Stability −4', 'Army loyalty −1', 'Ministers approval −2'], run: (w) => (meter(w, 'stability', -4, 'Strikers broken'), army(w, -1, 'Used against strikers'), approveAll(w, ministers(w), -2)) },
      { label: 'Sit it out', what: 'They will go back when the money runs out.', effects: ['General strike 2 weeks (no income tax, Prosperity −2 a week)'], run: (w) => cond(w, 'strike', 2) }
    ]
  },
  {
    id: 'brain_drain', title: 'The talented are leaving', text: 'Doctors, engineers and teachers are emigrating to Orrin for better pay.', weight: 0.6,
    options: [
      { label: 'Pay them to stay', what: 'A bonus for the realm’s best.', effects: ['The richest three are paid 10 each to stay (Treasury −30)', 'Prosperity +1'], run: (w) => (share(w, 'treasury', richest(w), 10, 'Paid to stay'), meter(w, 'prosperity', 1, 'Talent kept at home')) },
      { label: 'An exit tax', what: 'Leave if you like, but pay first.', effects: ['Treasury +20 (from Orrin)', 'Orrin cools', 'Brain drain 1 week'], run: (w) => { const n = w.nations.orrin ? 'orrin' : Object.keys(w.nations)[0]; if (bal(w, 'nation:' + n) >= 20) transfer(w, 'nation:' + n, 'treasury', 20, 'Exit tax'); mood(w, n, -1, 'Our exit tax'); cond(w, 'drain', 1); } },
      { label: 'Let them go', what: 'A free country.', effects: ['Brain drain 4 weeks (Prosperity −1 a week)'], run: (w) => cond(w, 'drain', 4) }
    ]
  },
  {
    id: 'kessmark_exodus', house: true, title: 'An exodus from Kessmark', text: 'Thousands are fleeing trouble in Kessmark. They are camped at the frontier.', weight: 0.7,
    options: [
      { label: 'Open the camps', what: 'Costly now, but they will work and pay taxes.', effects: ['Refugee camps 3 weeks (Treasury −10 a week)', 'Prosperity +4 when they close', 'Standing +2'], run: (w) => (cond(w, 'refugees', 3), standingShift(w, 2, 'We took in refugees')) },
      { label: 'Turn them back', what: 'Close the border.', effects: ['Kessmark cools', 'Standing −3', 'Stability +1'], run: (w) => (mood(w, 'kessmark', -1, 'We turned their people away'), standingShift(w, -3, 'Refugees turned back'), meter(w, 'stability', 1, 'The border held')) },
      { label: 'Ask the citizens to take them in', what: 'Every household does its bit.', effects: ['Everyone −3 crowns', 'Every citizen +1 approval', 'Standing +3'], run: (w) => (levy(w, citizensNow(w).map((c: any) => c.id), 3, 'nation:' + (w.nations.kessmark ? 'kessmark' : Object.keys(w.nations)[0]), 'Housing refugees'), approveAll(w, citizensNow(w).map((c: any) => c.id), 1), standingShift(w, 3, 'A welcoming realm')) }
    ]
  },
  {
    id: 'currency_run', extreme: true, title: 'A run on the crown', text: 'Speculators abroad are dumping crowns. The currency is falling by the hour.', weight: 1, needs: (w) => Object.keys(w.nations).some((n) => fx(w, n) < 0.85),
    options: [
      { label: 'Defend it with gold', what: 'Sell the gold reserve to buy crowns back.', effects: ['Gold reserve −50', 'The crown recovers 10%'], run: (w) => { w.economy.gold = Math.max(0, (w.economy.gold || 0) - 50); Object.keys(w.nations).forEach((n) => (w.economy.fx[n] = Math.round(fx(w, n) * 1.1 * 1000) / 1000)); } },
      { label: 'Capital controls', what: 'No money leaves the realm.', effects: ['Capital controls 2 weeks (savings tax doubled, no bonds)', 'Standing −2'], run: (w) => (cond(w, 'controls', 2), standingShift(w, -2, 'Capital controls')) },
      { label: 'Let it fall', what: 'A cheap crown sells abroad.', effects: ['The crown falls another 10%', 'Ventures abroad pay more', 'Prices +4%'], run: (w) => (Object.keys(w.nations).forEach((n) => (w.economy.fx[n] = Math.round(fx(w, n) * 0.9 * 1000) / 1000)), prices(w, 4)) }
    ]
  },
  {
    id: 'cyberattack', title: 'The Treasury is hacked', text: 'Ransomware has locked the Treasury’s ledgers. The hackers want 50 crowns.', weight: 0.6, needs: (w) => !!w.offices.treasury,
    options: [
      { label: 'Pay the ransom', what: 'Quick, quiet and humiliating. Hackers talk to each other.', effects: ['Treasury −50', 'The Chancellor’s approval −3', 'They may come back'], then: { type: 'hackers_return', days: 10 }, run: (w) => (spend(w, 50, 'nation:' + Object.keys(w.nations)[0], 'Ransom'), holderOf(w, 'treasury') && approve(w, holderOf(w, 'treasury')!, -3)) },
      { label: 'Refuse and rebuild', what: 'Weeks without the systems.', effects: ['Treasury outage 2 weeks (no grants)', 'Stability +1'], run: (w) => (cond(w, 'outage', 2), meter(w, 'stability', 1, 'We did not pay')) },
      { label: 'Blame Kessmark', what: 'Point the finger abroad.', effects: ['Kessmark cools sharply', 'Treasury outage 1 week'], run: (w) => (mood(w, 'kessmark', -2, 'Accused of hacking us'), cond(w, 'outage', 1)) }
    ]
  },
  {
    id: 'royal_scandal', title: 'A royal scandal', text: 'The papers have photographs. The palace is not commenting.', weight: 0.7, needs: (w) => monarchy(w) && !!w.hos.holder,
    options: [
      { label: 'A full apology', what: 'The monarch says sorry, on camera.', effects: ['The monarch’s approval −2', 'Stability +1'], run: (w) => (approve(w, w.hos.holder!, -2), meter(w, 'stability', 1, 'The palace apologised')) },
      { label: 'Blame the courtiers', what: 'The officers of state take the fall.', effects: ['The Lord Chamberlain and Lord Privy Seal approval −4', 'The monarch’s approval +1'], run: (w) => (approveAll(w, ['chamberlain', 'privyseal'].map((k) => w.offices[k]?.holder).filter(Boolean), -4), approve(w, w.hos.holder!, 1)) },
      { label: 'Say nothing', what: 'It will blow over.', effects: ['The monarch’s approval −4', 'Stability −2'], run: (w) => (approve(w, w.hos.holder!, -4), meter(w, 'stability', -2, 'Silence from the palace')) }
    ]
  },
  {
    id: 'housing', house: true, title: 'Rents are through the roof', text: 'Landlords have doubled rents. Families are sleeping in their carts.', weight: 0.8,
    options: [
      { label: 'Cap rents', what: 'The richest pay, the poorest keep their homes.', effects: ['The richest three −10 each', 'The poorest three +10 each', 'Stability +1'], run: (w) => { const r = richest(w); const p = poorest(w).filter((id) => !r.includes(id)); levy(w, r, 10, 'treasury', 'Rent cap'); share(w, 'treasury', p, 10, 'Rent relief'); meter(w, 'stability', 1, 'Rents capped'); } },
      { label: 'Build homes', what: 'A long programme of building.', effects: ['Treasury −60', 'Building programme 3 weeks (Prosperity +1 a week)'], run: (w) => (spend(w, 60, 'reserve', 'House building'), cond(w, 'building', 3)) },
      { label: 'Leave it to the market', what: 'Prices will find their level.', effects: ['The poorest three −5 each', 'Stability −2'], run: (w) => (levy(w, poorest(w), 5, 'treasury', 'Rent rises'), meter(w, 'stability', -2, 'Families on the street')) }
    ]
  },
  {
    id: 'tax_revolt', house: true, title: 'A tax revolt', text: 'Citizens are refusing to pay. Protesters burn their tax demands outside the Treasury.', weight: 0.8, needs: (w) => w.config.taxRate >= 15 || (w.config.savingsTax || 0) >= 3,
    options: [
      { label: 'Cut taxes', what: 'Income tax −5%, savings tax halved, for good.', effects: ['Income tax −5% permanently', 'Savings tax halved', 'Stability +2'], run: (w) => ((w.config.taxRate = Math.max(0, w.config.taxRate - 5)), (w.config.savingsTax = Math.floor((w.config.savingsTax || 0) / 2)), meter(w, 'stability', 2, 'Taxes cut')) },
      { label: 'Enforce collection', what: 'Bailiffs at the door.', effects: ['The richest five −10 each', 'Stability −3', 'Ministers approval −2'], run: (w) => (levy(w, richest(w, 5), 10, 'treasury', 'Back taxes collected'), meter(w, 'stability', -3, 'Bailiffs'), approveAll(w, ministers(w), -2)) },
      { label: 'A tax amnesty', what: 'Pay what you owe and no questions asked.', effects: ['Treasury +15', 'General strike 1 week'], run: (w) => (levy(w, richest(w, 3), 5, 'treasury', 'Tax amnesty'), cond(w, 'strike', 1)) }
    ]
  },
  {
    id: 'state_funeral', title: 'A beloved elder dies', text: 'The realm’s oldest citizen, a hero of the founding, has died.', weight: 0.4,
    options: [
      { label: 'A state funeral', what: 'The whole realm stops to mourn.', effects: ['Treasury −30', 'Mourning 1 week (Stability +1, Prosperity −1)', 'Every MP approval +1'], run: (w) => (spend(w, 30, 'reserve', 'State funeral'), cond(w, 'mourning', 1), approveAll(w, mps(w), 1)) },
      { label: 'A quiet family funeral', what: 'As they would have wanted.', effects: ['Stability −1'], run: (w) => meter(w, 'stability', -1, 'A hero buried quietly') }
    ]
  },
  // ---------- chaos: crises built around named players ----------
  {
    id: 'affair', title: 'An affair at the top', text: 'Two of the realm’s best-known figures were photographed leaving a hotel together at dawn. The papers are calling it the scandal of the season.', weight: 0.8,
    cast: (w) => pair(w, 'minister', ['in the photographs', 'the other one in the photographs']),
    options: [
      { label: 'Demand resignations', what: 'Both lose every post they hold.', effects: ['Both lose their posts', 'Stability +2'], run: (w, c) => (vacate(w, castOf(c, 0)), vacate(w, castOf(c, 1)), meter(w, 'stability', 2, 'Resignations over the affair')) },
      { label: 'A private matter', what: 'The PM refuses to comment.', effects: ['Both approval −1', 'PM approval −2'], run: (w, c) => (approveAll(w, [castOf(c, 0), castOf(c, 1)].filter(Boolean) as Id[], -1), w.pm && approve(w, w.pm, -2)) },
      { label: 'Let the tabloids run', what: 'Nobody steps in. It runs for weeks.', effects: ['Both approval −3', 'Stability −1'], run: (w, c) => (approveAll(w, [castOf(c, 0), castOf(c, 1)].filter(Boolean) as Id[], -3), meter(w, 'stability', -1, 'Tabloid frenzy')) }
    ]
  },
  {
    id: 'sting', title: 'Caught on camera', text: 'An undercover reporter posing as a Kessmark businessman filmed a minister offering to change a law for 50 crowns.', weight: 0.8,
    cast: (w) => pair(w, 'minister', ['caught on camera', 'the reporter who ran the sting']),
    options: [
      { label: 'Sack them', what: 'Out of every post, and a fine.', effects: ['The minister loses their posts and 20 crowns', 'The reporter +5 Influence', 'Stability +2'], run: (w, c) => (vacate(w, castOf(c, 0)), levy(w, [castOf(c, 0)!].filter(Boolean), 20, 'treasury', 'Fined over the sting'), castOf(c, 1) && earn(w, castOf(c, 1)!, 5, 'Ran the sting'), meter(w, 'stability', 2, 'A corrupt minister sacked')) },
      { label: 'Stand by them', what: 'It was a joke, taken out of context. There may be more tapes.', effects: ['PM approval −3', 'The minister approval −2', 'A secret card about the PM', 'More tapes may surface'], run: (w, c) => (w.pm && approve(w, w.pm, -3), castOf(c, 0) && approve(w, castOf(c, 0)!, -2), pmCard(w, 'The PM protected a minister filmed offering to sell a law.', 'The newsroom')), then: { type: 'sting_tapes', days: 7 } },
      { label: 'Go after the reporter', what: 'Entrapment, says the government.', effects: ['The reporter −10', 'Stability −2', 'Standing −1'], run: (w, c) => (levy(w, [castOf(c, 1)!].filter(Boolean), 10, 'treasury', 'Prosecuted over the sting'), meter(w, 'stability', -2, 'A reporter prosecuted'), standingShift(w, -1, 'We prosecuted a journalist')) }
    ]
  },
  {
    id: 'chat_leak', extreme: true, title: 'The group chat leaks', text: 'Months of private messages have been posted online. Three people come out of it very badly. Nobody knows who leaked it.', weight: 0.7,
    cast: (w) => shuffle(w, freeCitizens(w)).slice(0, 4).map((id, i) => ({ id, role: i < 3 ? 'whose messages leaked' : 'suspected of leaking it' })),
    options: [
      { label: 'Hunt the leaker', what: 'A full inquiry. Someone will be named.', effects: ['The suspect −3 approval and −10', 'Stability −1'], run: (w, c) => (castOf(c, 3) && (approve(w, castOf(c, 3)!, -3), levy(w, [castOf(c, 3)!], 10, 'treasury', 'Named as the leaker')), meter(w, 'stability', -1, 'A leak inquiry')) },
      { label: 'Everyone apologises', what: 'The three say sorry in public.', effects: ['The three −1 approval', 'Stability +1'], run: (w, c) => (approveAll(w, [0, 1, 2].map((i) => castOf(c, i)).filter(Boolean) as Id[], -1), meter(w, 'stability', 1, 'Apologies all round')) },
      { label: 'Ride it out', what: 'It will be forgotten by next week. Probably.', effects: ['The three −3 approval', 'Every citizen +1 Influence (gossip)'], run: (w, c) => (approveAll(w, [0, 1, 2].map((i) => castOf(c, i)).filter(Boolean) as Id[], -3), everyone(w, 1, 'Read the leaked chat')) }
    ]
  },
  {
    id: 'duel', title: 'A challenge to a duel', text: 'An insult in the House has turned into a formal challenge. Pistols at dawn, unless someone stops it.', weight: 0.6,
    cast: (w) => pair(w, 'mp', ['who issued the challenge', 'who was challenged']),
    options: [
      { label: 'Let it happen', what: 'Honour must be satisfied. The loser pays the winner 20.', effects: ['One of them wins 20 from the other', 'The loser approval −2', 'Stability −1'], run: (w, c) => { const [a, b] = [castOf(c, 0), castOf(c, 1)]; if (!a || !b) return; const [win, lose] = chance(w, 0.5) ? [a, b] : [b, a]; const n = Math.min(20, bal(w, ca(lose))); if (n > 0) transfer(w, ca(lose), ca(win), n, 'Lost a duel'); approve(w, lose, -2); gazette(w, 'crisis', `${nm(w, win)} wins the duel against ${nm(w, lose)}.`, '#/crisis/' + c.id); meter(w, 'stability', -1, 'A duel'); } },
      { label: 'Make them shake hands', what: 'In the chamber, in front of everyone.', effects: ['Both +1 approval', 'Stability +1'], run: (w, c) => (approveAll(w, [castOf(c, 0), castOf(c, 1)].filter(Boolean) as Id[], 1), meter(w, 'stability', 1, 'A duel averted')) },
      { label: 'Ban duelling', what: 'Both are fined for even suggesting it.', effects: ['Both −5', 'Both −1 Influence'], run: (w, c) => [castOf(c, 0), castOf(c, 1)].filter(Boolean).forEach((id) => (levy(w, [id!], 5, 'treasury', 'Fined for a duel'), (w.citizens[id!].influence = Math.max(0, (w.citizens[id!].influence || 0) - 1)))) }
    ]
  },
  {
    id: 'kidnap', extreme: true, title: 'A minister is kidnapped', text: 'Bandits on the Kessmark road have taken a minister and want 40 crowns by tomorrow.', weight: 0.5, needs: (w) => ministers(w).length > 0,
    cast: (w) => one(w, 'minister', 'held for ransom'),
    options: [
      { label: 'Pay the ransom', what: 'They come home. The bandits will be back.', effects: ['Treasury −40', 'The minister +2 approval', 'The bandits will be back for more'], then: { type: 'bandits_return', days: 10 }, run: (w, c) => (spend(w, 40, w.nations.kessmark ? 'nation:kessmark' : 'nation:' + Object.keys(w.nations)[0], 'Ransom'), castOf(c, 0) && approve(w, castOf(c, 0)!, 2)) },
      { label: 'Send in the Army', what: 'A rescue at night. It might go wrong.', effects: ['Even chance: freed (+3 approval, Army loyalty +1)', 'Otherwise: they lose 20 and their posts'], run: (w, c) => { const id = castOf(c, 0); if (!id) return; if (chance(w, 0.5)) (approve(w, id, 3), army(w, 1, 'A daring rescue')); else (levy(w, [id], 20, 'reserve', 'Robbed by bandits'), vacate(w, id)); } },
      { label: 'We do not negotiate', what: 'They are on their own.', effects: ['The minister loses 10 and their posts', 'Stability +1'], run: (w, c) => (levy(w, [castOf(c, 0)!].filter(Boolean), 10, 'reserve', 'Robbed by bandits'), vacate(w, castOf(c, 0)), meter(w, 'stability', 1, 'We did not pay')) }
    ]
  },
  {
    id: 'impostor', title: 'Someone is impersonating the Prime Minister', text: 'A fake account has been issuing “decrees” in the PM’s name, and half the realm believed them. The trail leads to a citizen.', weight: 0.6, needs: (w) => !!w.pm,
    cast: (w) => { const p = shuffle(w, freeCitizens(w).filter((x) => x !== w.pm)); return p[0] ? [{ id: p[0], role: 'behind the fake account' }] : []; },
    options: [
      { label: 'Unmask and fine them', what: 'Named in the Gazette, and a fine.', effects: ['The impostor −15 and −3 approval', 'Stability +1'], run: (w, c) => (levy(w, [castOf(c, 0)!].filter(Boolean), 15, 'treasury', 'Fined for impersonating the PM'), castOf(c, 0) && approve(w, castOf(c, 0)!, -3), meter(w, 'stability', 1, 'The impostor unmasked')) },
      { label: 'Hire them', what: 'Anyone that convincing should write the PM’s speeches. They will see everything.', effects: ['The impostor +10 and +3 Influence', 'PM approval −1', 'They now know your secrets'], then: { type: 'speechwriter_leak', days: 10 }, run: (w, c) => (castOf(c, 0) && (share(w, 'treasury', [castOf(c, 0)!], 10, 'Hired as speechwriter'), earn(w, castOf(c, 0)!, 3, 'Hired by the PM')), w.pm && approve(w, w.pm, -1)) },
      { label: 'Laugh it off', what: 'The PM posts a joke about it.', effects: ['PM approval +1', 'Stability −1', 'The impostor +2 Influence'], run: (w, c) => (w.pm && approve(w, w.pm, 1), meter(w, 'stability', -1, 'Fake decrees'), castOf(c, 0) && earn(w, castOf(c, 0)!, 2, 'Fooled the realm')) }
    ]
  },
  {
    id: 'lottery', title: 'A citizen wins the lottery three times', text: 'Three jackpots in a month. The odds are a billion to one. The winner says they are just lucky.', weight: 0.6,
    cast: (w) => one(w, 'any', 'who keeps winning'),
    options: [
      { label: 'Investigate', what: 'Audit the draws.', effects: ['Even chance: rigged (they lose 20, −3 approval)', 'Otherwise: cleared (+2 approval)'], run: (w, c) => { const id = castOf(c, 0); if (!id) return; if (chance(w, 0.5)) (levy(w, [id], 20, 'treasury', 'Lottery fraud'), approve(w, id, -3)); else approve(w, id, 2); } },
      { label: 'Let them keep it', what: 'Luck is luck. Or is it?', effects: ['The winner +30 (new money)', 'Stability −1', 'They may win again'], then: { type: 'lottery_again', days: 14 }, run: (w, c) => (castOf(c, 0) && share(w, 'reserve', [castOf(c, 0)!], 30, 'Lottery jackpot'), meter(w, 'stability', -1, 'A suspicious lottery')) },
      { label: 'Tax the winnings', what: 'Half to the Treasury.', effects: ['The winner +15', 'Treasury +15'], run: (w, c) => (castOf(c, 0) && share(w, 'reserve', [castOf(c, 0)!], 15, 'Lottery jackpot, after tax'), transfer(w, 'reserve', 'treasury', 15, 'Lottery tax')) }
    ]
  },
  {
    id: 'viral', title: 'A citizen goes viral', text: 'A video of a citizen arguing with a goose has been watched by every country on the continent.', weight: 0.6,
    cast: (w) => one(w, 'any', 'who argued with the goose'),
    options: [
      { label: 'Make them an ambassador', what: 'Soft power.', effects: ['They get +5 Influence', 'Two nations warm'], run: (w, c) => (castOf(c, 0) && earn(w, castOf(c, 0)!, 5, 'National treasure'), Object.keys(w.nations).slice(0, 2).forEach((n) => mood(w, n, 1, 'Loved the goose video'))) },
      { label: 'Ban the video', what: 'It is embarrassing the realm.', effects: ['Stability −1', 'They get +3 Influence anyway'], run: (w, c) => (meter(w, 'stability', -1, 'A video banned'), castOf(c, 0) && earn(w, castOf(c, 0)!, 3, 'Banned and famous')) },
      { label: 'Ignore it', what: 'It will pass.', effects: ['Nothing happens'], run: () => {} }
    ]
  },
  {
    id: 'traitor', extreme: true, house: true, title: 'An MP has been selling secrets', text: 'The Security Service says an MP has been passing papers to Kessmark for months. The evidence is strong but not certain.', weight: 0.5, needs: (w) => mps(w).length >= 2,
    cast: (w) => pair(w, 'mp', ['accused of treason', 'who found the evidence']),
    options: [
      { label: 'A public trial', what: 'In the open. The accused may be acquitted.', effects: ['Even chance: guilty (−25, −5 approval, loses posts)', 'Otherwise: the accuser −3 approval', 'Stability +1'], run: (w, c) => { const a = castOf(c, 0), b = castOf(c, 1); if (!a) return; if (chance(w, 0.5)) (levy(w, [a], 25, 'treasury', 'Convicted of treason'), approve(w, a, -5), vacate(w, a), stamp(w, a, 'Convicted', 'Treason', 'ink')); else if (b) approve(w, b, -3); meter(w, 'stability', 1, 'A treason trial'); } },
      { label: 'A quiet deal', what: 'Trade them back to Kessmark for our own spies.', effects: ['The accused +10 (Kessmark pays)', 'Kessmark warms', 'Stability −2'], run: (w, c) => (castOf(c, 0) && bal(w, 'nation:kessmark') >= 10 && transfer(w, 'nation:kessmark', ca(castOf(c, 0)!), 10, 'A quiet arrangement'), mood(w, 'kessmark', 1, 'A spy swap'), meter(w, 'stability', -2, 'A traitor walked free')) },
      { label: 'Not enough evidence', what: 'Drop it.', effects: ['The accuser −2 approval', 'Kessmark keeps its source'], run: (w, c) => castOf(c, 1) && approve(w, castOf(c, 1)!, -2) }
    ]
  },
  {
    id: 'inside_job', title: 'Money missing from the Treasury', text: 'Eighty crowns have vanished from the Treasury’s accounts. Two people had the keys.', weight: 0.6, needs: (w) => !!w.offices.treasury && bal(w, 'treasury') >= 40,
    cast: (w) => { const a = holderOf(w, 'treasury'); const rest = shuffle(w, freeCitizens(w).filter((x) => x !== a)); return [a && { id: a, role: 'who held the keys' }, rest[0] && { id: rest[0], role: 'the clerk with the other key' }].filter(Boolean) as any; },
    options: [
      { label: 'Call in auditors', what: 'Someone will be found out.', effects: ['One of the two is caught: −20, −3 approval'], run: (w, c) => { const id = castOf(c, chance(w, 0.5) ? 0 : 1) || castOf(c, 0); if (id) (levy(w, [id], 20, 'treasury', 'Caught taking Treasury money'), approve(w, id, -3)); } },
      { label: 'Write it off', what: 'An accounting error, officially.', effects: ['Treasury −40', 'Stability −1'], run: (w) => (spend(w, 40, 'reserve', 'Written off'), meter(w, 'stability', -1, 'Money vanished')) },
      { label: 'Blame the opposition', what: 'They were in charge last year, surely.', effects: ['PM approval +1', 'Stability −2', 'Every non-government MP −1 approval'], run: (w) => (w.pm && approve(w, w.pm, 1), meter(w, 'stability', -2, 'Blame games'), approveAll(w, mps(w).filter((m) => !ministers(w).includes(m) && m !== w.pm), -1)) }
    ]
  },
  {
    id: 'party_crash', title: 'A party during the crisis', text: 'Photographs show ministers drinking at a party in a government building while everyone else was told to stay home.', weight: 0.7, needs: (w) => ministers(w).length > 0,
    cast: (w) => shuffle(w, pool(w, 'minister')).slice(0, 3).map((id) => ({ id, role: 'at the party' })),
    options: [
      { label: 'Fine everyone there', what: 'A fixed penalty each.', effects: ['Each partygoer −10', 'Stability +1'], run: (w, c) => (levy(w, (c.cast || []).map((x: any) => x.id), 10, 'treasury', 'Fined for the party'), meter(w, 'stability', 1, 'Partygoers fined')) },
      { label: 'It was a work event', what: 'Cake was involved, but it was work.', effects: ['Each partygoer −2 approval', 'PM approval −3', 'Stability −2'], run: (w, c) => (approveAll(w, (c.cast || []).map((x: any) => x.id), -2), w.pm && approve(w, w.pm, -3), meter(w, 'stability', -2, 'It was a work event')) },
      { label: 'Sack the lot', what: 'Every one of them loses their post.', effects: ['Every partygoer loses their posts', 'PM approval +2'], run: (w, c) => ((c.cast || []).forEach((x: any) => vacate(w, x.id)), w.pm && approve(w, w.pm, 2)) }
    ]
  },
  {
    id: 'secret_heir', house: true, title: 'A secret heir', text: 'A citizen has produced papers claiming to be the monarch’s secret child, and heir to the throne.', weight: 0.5, needs: (w) => monarchy(w) && !!w.hos.holder,
    cast: (w) => { const p = shuffle(w, freeCitizens(w).filter((x) => x !== w.hos.holder)); return p[0] ? [{ id: p[0], role: 'claiming to be the heir' }] : []; },
    options: [
      { label: 'Recognise them', what: 'A royal title and an allowance.', effects: ['The claimant +20 and +5 Influence', 'Monarch approval −2'], run: (w, c) => (castOf(c, 0) && (share(w, 'treasury', [castOf(c, 0)!], 20, 'A royal allowance'), earn(w, castOf(c, 0)!, 5, 'Recognised as royal'), stamp(w, castOf(c, 0)!, 'Royal blood', 'Recognised heir', 'good')), w.hos.holder && approve(w, w.hos.holder, -2)) },
      { label: 'Demand a DNA test', what: 'Even chance it is true.', effects: ['True: claimant +10, monarch −3 approval', 'False: claimant −10 and −3 approval'], run: (w, c) => { const id = castOf(c, 0); if (!id) return; if (chance(w, 0.5)) (share(w, 'treasury', [id], 10, 'Proved royal'), w.hos.holder && approve(w, w.hos.holder, -3)); else (levy(w, [id], 10, 'treasury', 'A false claim'), approve(w, id, -3)); } },
      { label: 'Call it a fraud', what: 'The palace denies everything.', effects: ['The claimant −2 approval', 'Stability −1'], run: (w, c) => (castOf(c, 0) && approve(w, castOf(c, 0)!, -2), meter(w, 'stability', -1, 'A royal denial')) }
    ]
  },
  // ---------- choices that come back to bite: follow-ons that remember who was involved ----------
  {
    id: 'sting_tapes', chainOnly: true, extreme: true, title: 'More tapes', text: 'The reporter has released a second recording. The minister the PM stood by is heard naming their price again, and this time mentions the PM.',
    cast: (w, prev) => [pv(prev, 0) && { id: pv(prev, 0)!, role: 'on the new tapes' }, w.pm && { id: w.pm, role: 'who stood by them' }].filter(Boolean) as any,
    options: [
      { label: 'Sack them now', what: 'Too late to look principled.', effects: ['The minister loses their posts and 25', 'PM approval −2'], run: (w, c) => (vacate(w, castOf(c, 0)), levy(w, [castOf(c, 0)!].filter(Boolean), 25, 'treasury', 'Fined over the tapes'), w.pm && approve(w, w.pm, -2)) },
      { label: 'Call the tapes fake', what: 'Doubling down.', effects: ['PM approval −4', 'Stability −3', 'A secret card about the PM'], run: (w) => (w.pm && approve(w, w.pm, -4), meter(w, 'stability', -3, 'The tapes were called fake'), pmCard(w, 'The PM called genuine tapes fake to save a corrupt minister.', 'The newsroom')) },
      { label: 'Say nothing', what: 'Hope the next story buries it.', effects: ['PM approval −3', 'The minister −3 approval'], run: (w, c) => (w.pm && approve(w, w.pm, -3), castOf(c, 0) && approve(w, castOf(c, 0)!, -3)) }
    ]
  },
  {
    id: 'bandits_return', chainOnly: true, extreme: true, title: 'The bandits are back', text: 'Paying worked so well that the bandits have taken another minister. This time they want 80 crowns.',
    cast: (w, prev) => one(w, 'minister', 'taken again'),
    options: [
      { label: 'Pay again', what: 'It worked last time.', effects: ['Treasury −80', 'Stability −2', 'The minister +1 approval'], run: (w, c) => (spend(w, 80, w.nations.kessmark ? 'nation:kessmark' : 'nation:' + Object.keys(w.nations)[0], 'Second ransom'), meter(w, 'stability', -2, 'We paid bandits twice'), castOf(c, 0) && approve(w, castOf(c, 0)!, 1)) },
      { label: 'Wipe them out', what: 'The Army goes in, for good.', effects: ['Army loyalty +1', 'Even chance: the minister is lost (−20 and their posts)', 'Kessmark cools'], run: (w, c) => (army(w, 1, 'Wiped out the bandits'), mood(w, 'kessmark', -1, 'Our raid crossed their border'), chance(w, 0.5) && castOf(c, 0) && (levy(w, [castOf(c, 0)!], 20, 'reserve', 'Lost in the raid'), vacate(w, castOf(c, 0)))) },
      { label: 'Refuse', what: 'No more.', effects: ['The minister loses 15 and their posts', 'Stability +1'], run: (w, c) => (levy(w, [castOf(c, 0)!].filter(Boolean), 15, 'reserve', 'Robbed by bandits'), vacate(w, castOf(c, 0)), meter(w, 'stability', 1, 'We stopped paying')) }
    ]
  },
  {
    id: 'prophet_law', chainOnly: true, house: true, title: 'The Spiritual Adviser demands a holy law', text: 'The prophet the government brought inside now demands a law: no work on the day of rest, and a tithe to the faithful.',
    cast: (w, prev) => (pv(prev, 0) ? [{ id: pv(prev, 0)!, role: 'Spiritual Adviser' }] : one(w, 'any', 'Spiritual Adviser')),
    options: [
      { label: 'Pass the holy law', what: 'A day of rest and a tithe.', effects: ['The prophet +5 Influence and +10', 'Prosperity −2', 'Standing −2', 'Stability +2'], run: (w, c) => (castOf(c, 0) && (earn(w, castOf(c, 0)!, 5, 'Their law passed'), share(w, 'treasury', [castOf(c, 0)!], 10, 'The tithe')), meter(w, 'prosperity', -2, 'A day of rest'), standingShift(w, -2, 'A holy law'), meter(w, 'stability', 2, 'The faithful satisfied')) },
      { label: 'Refuse', what: 'The faithful walk out.', effects: ['General strike 1 week', 'The prophet −2 approval'], run: (w, c) => (cond(w, 'strike', 1), castOf(c, 0) && approve(w, castOf(c, 0)!, -2)) },
      { label: 'Sack the Spiritual Adviser', what: 'Out, and the stipend with them.', effects: ['The prophet −10 and −3 approval', 'Stability −2'], run: (w, c) => (levy(w, [castOf(c, 0)!].filter(Boolean), 10, 'treasury', 'Stipend clawed back'), castOf(c, 0) && approve(w, castOf(c, 0)!, -3), meter(w, 'stability', -2, 'The prophet sacked')) }
    ]
  },
  {
    id: 'speechwriter_leak', chainOnly: true, extreme: true, title: 'The speechwriter publishes everything', text: 'The impostor the PM hired has published the PM’s private notes: every joke about the voters, every grudge.',
    cast: (w, prev) => [pv(prev, 0) && { id: pv(prev, 0)!, role: 'the speechwriter' }, w.pm && { id: w.pm, role: 'whose notes leaked' }].filter(Boolean) as any,
    options: [
      { label: 'Sue them', what: 'Every crown they have.', effects: ['The speechwriter −20', 'PM approval −2'], run: (w, c) => (levy(w, [castOf(c, 0)!].filter(Boolean), 20, 'treasury', 'Sued by the PM'), w.pm && approve(w, w.pm, -2)) },
      { label: 'Own it', what: 'The PM reads the worst lines aloud and laughs.', effects: ['Even chance: PM approval +2', 'Otherwise: PM approval −4'], run: (w) => w.pm && approve(w, w.pm, chance(w, 0.5) ? 2 : -4) },
      { label: 'Pay them to stop', what: 'From the PM’s own pocket.', effects: ['The PM pays the speechwriter up to 15', 'A secret card about the PM'], run: (w, c) => { if (w.pm && castOf(c, 0)) { const n = Math.min(15, bal(w, ca(w.pm))); if (n > 0) transfer(w, ca(w.pm), ca(castOf(c, 0)!), n, 'Hush money'); } pmCard(w, 'The PM paid a former speechwriter to stop publishing.', 'The speechwriter'); } }
    ]
  },
  {
    id: 'hackers_return', chainOnly: true, extreme: true, title: 'The hackers are back', text: 'The same gang has locked the Treasury again. They know we pay. This time they want 100.', needs: (w) => !!w.offices.treasury,
    cast: (w) => { const a = holderOf(w, 'treasury'); return a ? [{ id: a, role: 'whose systems fell again' }] : []; },
    options: [
      { label: 'Pay 100', what: 'Again.', effects: ['Treasury −100', 'The Chancellor −3 approval'], run: (w, c) => (spend(w, 100, 'nation:' + Object.keys(w.nations)[0], 'Second ransom'), castOf(c, 0) && approve(w, castOf(c, 0)!, -3)) },
      { label: 'Rebuild from scratch', what: 'Weeks offline.', effects: ['Treasury outage 3 weeks', 'Treasury −30'], run: (w) => (cond(w, 'outage', 3), spend(w, 30, 'reserve', 'New systems')) },
      { label: 'Sack the Chancellor', what: 'Someone has to go.', effects: ['The Chancellor loses their post', 'Treasury outage 1 week'], run: (w, c) => (vacate(w, castOf(c, 0)), cond(w, 'outage', 1)) }
    ]
  },
  {
    id: 'paste_exposed', chainOnly: true, extreme: true, title: 'The jewels are paste', text: 'A jeweller has told the papers that the Crown Jewels on display are glass. The palace knew.', needs: monarchy,
    cast: (w) => { const j = shuffle(w, freeCitizens(w).filter((x) => x !== w.hos.holder))[0]; return [w.hos.holder && { id: w.hos.holder, role: 'who wore the fakes' }, j && { id: j, role: 'the jeweller who noticed' }].filter(Boolean) as any; },
    options: [
      { label: 'Confess', what: 'The monarch admits it and apologises.', effects: ['Monarch approval −3', 'The jeweller +3 Influence', 'Stability +1'], run: (w, c) => (w.hos.holder && approve(w, w.hos.holder, -3), castOf(c, 1) && earn(w, castOf(c, 1)!, 3, 'Exposed the fakes'), meter(w, 'stability', 1, 'The palace confessed')) },
      { label: 'Discredit the jeweller', what: 'A palace briefing about their debts.', effects: ['The jeweller −3 approval and −10', 'Monarch approval −1'], run: (w, c) => (castOf(c, 1) && (approve(w, castOf(c, 1)!, -3), levy(w, [castOf(c, 1)!], 10, 'reserve', 'Business ruined by the palace')), w.hos.holder && approve(w, w.hos.holder, -1)) },
      { label: 'Commission new jewels', what: 'From the Treasury, quietly.', effects: ['Treasury −50', 'Monarch approval −2'], run: (w) => (spend(w, 50, 'nation:tessaly', 'New Crown Jewels'), w.hos.holder && approve(w, w.hos.holder, -2)) }
    ]
  },
  {
    id: 'smuggler_blackmail', chainOnly: true, extreme: true, title: 'The smugglers want their due', text: 'The smugglers the Treasury took a cut from have kept records. They want 25 crowns from the Prime Minister personally, or the records go to the papers.', needs: (w) => !!w.pm,
    cast: (w) => { const s2 = shuffle(w, freeCitizens(w).filter((x) => x !== w.pm))[0]; return [w.pm && { id: w.pm, role: 'being blackmailed' }, s2 && { id: s2, role: 'the go-between' }].filter(Boolean) as any; },
    options: [
      { label: 'Pay them', what: 'From the PM’s own wallet.', effects: ['The PM pays up to 25', 'The go-between +5'], run: (w, c) => { if (!w.pm) return; const n = Math.min(25, bal(w, ca(w.pm))); if (n > 0) transfer(w, ca(w.pm), 'nation:kessmark', n, 'Blackmail'); castOf(c, 1) && share(w, 'reserve', [castOf(c, 1)!], 5, 'A go-between’s fee'); } },
      { label: 'Confess first', what: 'The PM tells the House before the papers can.', effects: ['PM approval −4', 'Stability +1'], run: (w) => (w.pm && approve(w, w.pm, -4), meter(w, 'stability', 1, 'The PM confessed')) },
      { label: 'Arrest the go-between', what: 'Shoot the messenger.', effects: ['The go-between −10', 'Even chance the records come out anyway (PM −4)'], run: (w, c) => (levy(w, [castOf(c, 1)!].filter(Boolean), 10, 'treasury', 'Arrested as a go-between'), w.pm && chance(w, 0.5) && approve(w, w.pm, -4)) }
    ]
  },
  {
    id: 'society_calls', chainOnly: true, extreme: true, title: 'The Grand Master calls in the oath', text: 'The PM swore the society’s oath. Now the Grand Master wants the next Chancellor to be one of theirs.', needs: (w) => !!w.pm,
    cast: (w, prev) => [pv(prev, 2) ? { id: pv(prev, 2)!, role: 'Grand Master' } : one(w, 'any', 'Grand Master')[0], w.pm && { id: w.pm, role: 'bound by the oath' }].filter(Boolean) as any,
    options: [
      { label: 'Obey', what: 'The Grand Master names the Chancellor.', effects: ['The Grand Master +5 Influence', 'The Chancellor post is emptied for them', 'A secret card about the PM'], run: (w, c) => (castOf(c, 0) && earn(w, castOf(c, 0)!, 5, 'Obeyed by the PM'), w.offices.treasury && (w.offices.treasury.holder = null), pmCard(w, 'The PM cleared the Chancellor’s post on the orders of a secret society.', 'A brother of the order')) },
      { label: 'Break the oath', what: 'The society takes revenge in the papers.', effects: ['PM approval −3', 'Stability −2'], run: (w) => (w.pm && approve(w, w.pm, -3), meter(w, 'stability', -2, 'A secret society’s revenge')) },
      { label: 'Have the Grand Master arrested', what: 'On whatever charge sticks.', effects: ['The Grand Master −15', 'Even chance the oath comes out (PM −4)'], run: (w, c) => (levy(w, [castOf(c, 0)!].filter(Boolean), 15, 'treasury', 'Arrested'), w.pm && chance(w, 0.5) && approve(w, w.pm, -4)) }
    ]
  },
  {
    id: 'donor_bill', chainOnly: true, house: true, title: 'The donor sends the bill', text: 'The donor the government let be now wants a favour: the savings tax scrapped and the income tax cut, starting tomorrow.',
    cast: (w) => one(w, 'rich', 'the donor'),
    options: [
      { label: 'Give them what they want', what: 'Taxes down, for everyone, mostly for them.', effects: ['Savings tax 0', 'Income tax −3% permanently', 'The donor +5 Influence', 'Stability −2'], run: (w, c) => ((w.config.savingsTax = 0), (w.config.taxRate = Math.max(0, w.config.taxRate - 3)), castOf(c, 0) && earn(w, castOf(c, 0)!, 5, 'Bought a tax cut'), meter(w, 'stability', -2, 'A tax cut for a donor')) },
      { label: 'Refuse', what: 'The donor funds the opposition instead.', effects: ['PM approval −2', 'Every non-government MP +1 approval'], run: (w) => (w.pm && approve(w, w.pm, -2), approveAll(w, mps(w).filter((m) => !ministers(w).includes(m) && m !== w.pm), 1)) },
      { label: 'Publish the request', what: 'Embarrass them in public.', effects: ['The donor −3 approval', 'PM approval +1', 'The donor may come for you'], run: (w, c) => (castOf(c, 0) && approve(w, castOf(c, 0)!, -3), w.pm && approve(w, w.pm, 1)) }
    ]
  },
  {
    id: 'lottery_again', chainOnly: true, title: 'A fourth jackpot', text: 'The same citizen has won the lottery again. The odds are now beyond calculation.',
    cast: (w, prev) => (pv(prev, 0) ? [{ id: pv(prev, 0)!, role: 'who keeps winning' }] : one(w, 'any', 'who keeps winning')),
    options: [
      { label: 'Seize the winnings', what: 'Nobody is that lucky.', effects: ['The winner −30', 'Stability +1'], run: (w, c) => (levy(w, [castOf(c, 0)!].filter(Boolean), 30, 'treasury', 'Lottery winnings seized'), meter(w, 'stability', 1, 'The lottery cleaned up')) },
      { label: 'Make them run the lottery', what: 'Clearly they understand it.', effects: ['The winner +5 Influence', 'Treasury +20 (better lottery)'], run: (w, c) => (castOf(c, 0) && earn(w, castOf(c, 0)!, 5, 'Put in charge of the lottery'), transfer(w, 'reserve', 'treasury', 20, 'Lottery profits')) },
      { label: 'Close the lottery', what: 'No more draws.', effects: ['Stability −1', 'Every citizen −1 Influence (no fun)'], run: (w) => (meter(w, 'stability', -1, 'The lottery closed'), everyone(w, -1, 'The lottery closed')) }
    ]
  },
  // ---------- the strange ones: mass delusions, prophets and madness, all with names attached ----------
  {
    id: 'prophet', extreme: true, title: 'A prophet in the market square', text: 'A citizen says the spirits speak through them. Hundreds now follow them everywhere, and the followers have stopped paying tax.', weight: 0.5,
    cast: (w) => one(w, 'any', 'who hears the spirits'),
    options: [
      { label: 'Arrest the prophet', what: 'Martyrs are dangerous, but so is this.', effects: ['The prophet −10 and −3 approval', 'Stability −2'], run: (w, c) => (levy(w, [castOf(c, 0)!].filter(Boolean), 10, 'treasury', 'Fined for unlawful assembly'), castOf(c, 0) && approve(w, castOf(c, 0)!, -3), meter(w, 'stability', -2, 'A prophet arrested')) },
      { label: 'Give them a seat at the table', what: 'A post as Spiritual Adviser to the Crown. They will want more.', effects: ['The prophet +10 and +5 Influence', 'Stability +1', 'PM approval −2', 'They will make demands'], then: { type: 'prophet_law', days: 7 }, run: (w, c) => (castOf(c, 0) && (share(w, 'treasury', [castOf(c, 0)!], 10, 'Spiritual Adviser’s stipend'), earn(w, castOf(c, 0)!, 5, 'Made Spiritual Adviser'), stamp(w, castOf(c, 0)!, 'Spiritual Adviser', 'By appointment', 'good')), meter(w, 'stability', 1, 'The prophet was heard'), w.pm && approve(w, w.pm, -2)) },
      { label: 'Ignore them', what: 'It will burn out.', effects: ['General strike 1 week (the faithful pay no tax)', 'The prophet +3 Influence'], run: (w, c) => (cond(w, 'strike', 1), castOf(c, 0) && earn(w, castOf(c, 0)!, 3, 'A growing flock')) }
    ]
  },
  {
    id: 'dancing', extreme: true, title: 'The dancing plague', text: 'It started with one citizen in the street who would not stop dancing. Now four hundred people are dancing day and night, and some have collapsed.', weight: 0.4,
    cast: (w) => one(w, 'any', 'who started dancing first'),
    options: [
      { label: 'Hire musicians', what: 'The physicians say they must dance it out. A stage, a band, and a guard.', effects: ['Treasury −15', 'Epidemic 1 week', 'Celebration 1 week'], run: (w) => (spend(w, 15, 'reserve', 'Musicians for the dancers'), cond(w, 'epidemic', 1), cond(w, 'celebration', 1)) },
      { label: 'Ban dancing', what: 'By order, nobody dances.', effects: ['Stability −2', 'The first dancer −5'], run: (w, c) => (meter(w, 'stability', -2, 'Dancing was banned'), levy(w, [castOf(c, 0)!].filter(Boolean), 5, 'treasury', 'Fined for dancing')) },
      { label: 'Quarantine the square', what: 'Wall it off and wait.', effects: ['Quarantine 1 week', 'The first dancer +2 Influence (a legend)'], run: (w, c) => (cond(w, 'quarantine', 1), castOf(c, 0) && earn(w, castOf(c, 0)!, 2, 'Started the dancing plague')) }
    ]
  },
  {
    id: 'water_theory', extreme: true, title: 'The water is poisoned, they say', text: 'A citizen’s posts claim the government puts something in the water to make people obedient. Half the realm is drinking only beer.', weight: 0.5,
    cast: (w) => one(w, 'any', 'spreading the theory'),
    options: [
      { label: 'Test the water in public', what: 'The Chancellor drinks a glass on the Gazette steps.', effects: ['Treasury −15', 'The theorist −3 approval', 'Stability +1'], run: (w, c) => (spend(w, 15, 'reserve', 'Public water tests'), castOf(c, 0) && approve(w, castOf(c, 0)!, -3), meter(w, 'stability', 1, 'The water was tested')) },
      { label: 'Arrest the theorist', what: 'Which proves the theory, to the believers.', effects: ['The theorist −10', 'Stability −2', 'The theorist +3 Influence'], run: (w, c) => (castOf(c, 0) && (levy(w, [castOf(c, 0)!], 10, 'treasury', 'Fined for spreading panic'), earn(w, castOf(c, 0)!, 3, 'Silenced, and more famous for it')), meter(w, 'stability', -2, 'A theorist arrested')) },
      { label: 'Agree with them', what: 'The PM announces an inquiry into “the water”.', effects: ['PM approval +2', 'Standing −2', 'Prosperity −2 (beer economy)'], run: (w) => (w.pm && approve(w, w.pm, 2), standingShift(w, -2, 'The realm believes its water is drugged'), meter(w, 'prosperity', -2, 'Nobody drinks water')) }
    ]
  },
  {
    id: 'witch_hunt', extreme: true, house: true, title: 'A witch hunt', text: 'A mob says a citizen has cursed the harvest. They have torches. Another citizen is leading them.', weight: 0.4,
    cast: (w) => pair(w, 'any', ['accused of witchcraft', 'leading the mob']),
    options: [
      { label: 'Protect the accused', what: 'The guard stands between them and the mob.', effects: ['The accused +2 approval', 'The mob leader −2 approval', 'Stability −1'], run: (w, c) => (castOf(c, 0) && approve(w, castOf(c, 0)!, 2), castOf(c, 1) && approve(w, castOf(c, 1)!, -2), meter(w, 'stability', -1, 'The mob was turned back')) },
      { label: 'Put them on trial', what: 'Let the court settle it. The court is not immune to torches.', effects: ['The accused −15 and −3 approval', 'Stability +1', 'Standing −2'], run: (w, c) => (levy(w, [castOf(c, 0)!].filter(Boolean), 15, 'treasury', 'Convicted of witchcraft'), castOf(c, 0) && (approve(w, castOf(c, 0)!, -3), stamp(w, castOf(c, 0)!, 'Convicted', 'Witchcraft', 'ink')), meter(w, 'stability', 1, 'The mob got its trial'), standingShift(w, -2, 'A witch trial, in this century')) },
      { label: 'Arrest the mob leader', what: 'Inciting a mob is the only crime here.', effects: ['The mob leader −10 and −3 approval', 'Stability +1'], run: (w, c) => (levy(w, [castOf(c, 1)!].filter(Boolean), 10, 'treasury', 'Fined for leading a mob'), castOf(c, 1) && approve(w, castOf(c, 1)!, -3), meter(w, 'stability', 1, 'The mob leader arrested')) }
    ]
  },
  {
    id: 'secret_society', extreme: true, house: true, title: 'A secret society in Parliament', text: 'Leaked robes, oaths and a membership list: two MPs belong to a society that swears to obey its Grand Master before the realm.', weight: 0.4, needs: (w) => mps(w).length >= 2,
    cast: (w) => { const m = shuffle(w, pool(w, 'mp')).slice(0, 2); const gm = shuffle(w, freeCitizens(w).filter((x) => !m.includes(x)))[0]; return [...m.map((id) => ({ id, role: 'on the membership list' })), ...(gm ? [{ id: gm, role: 'named as Grand Master' }] : [])]; },
    options: [
      { label: 'Expose them', what: 'Names, robes and photographs in the Gazette.', effects: ['Both MPs −3 approval', 'The Grand Master −10', 'Stability −1'], run: (w, c) => (approveAll(w, [castOf(c, 0), castOf(c, 1)].filter(Boolean) as Id[], -3), levy(w, [castOf(c, 2)!].filter(Boolean), 10, 'treasury', 'Fined over the society'), meter(w, 'stability', -1, 'A secret society exposed')) },
      { label: 'Outlaw it', what: 'Members lose every post.', effects: ['Both MPs lose their posts', 'Stability +1'], run: (w, c) => (vacate(w, castOf(c, 0)), vacate(w, castOf(c, 1)), meter(w, 'stability', 1, 'The society outlawed')) },
      { label: 'Ask to join', what: 'If you cannot beat them… but oaths are binding.', effects: ['The Grand Master +5 Influence', 'PM +3 Influence', 'A secret card about the PM', 'The Grand Master will call in the oath'], then: { type: 'society_calls', days: 10 }, run: (w, c) => (castOf(c, 2) && earn(w, castOf(c, 2)!, 5, 'The PM joined the society'), w.pm && earn(w, w.pm, 3, 'Joined a secret society'), pmCard(w, 'The PM has sworn the oath of a secret society.', 'A brother of the order')) }
    ]
  },
  {
    id: 'tulips', extreme: true, title: 'Tulip mania', text: 'A single rare bulb just sold for a house. Everyone is buying bulbs on credit, and one citizen has cornered the market.', weight: 0.4,
    cast: (w) => one(w, 'rich', 'who cornered the bulb market'),
    options: [
      { label: 'Let it run', what: 'What could go wrong?', effects: ['Bubble 2 weeks', 'The bulb baron +20', 'A crash follows'], run: (w, c) => (cond(w, 'bubble', 2), castOf(c, 0) && share(w, 'reserve', [castOf(c, 0)!], 20, 'Bulb profits')), then: { type: 'crash', days: 14 } },
      { label: 'Ban bulb trading', what: 'Overnight, the bulbs are worth nothing.', effects: ['The bulb baron −20', 'The poorest three −3 (they bought in)', 'Stability −1'], run: (w, c) => (levy(w, [castOf(c, 0)!].filter(Boolean), 20, 'reserve', 'Bulbs worthless'), levy(w, poorest(w), 3, 'reserve', 'Bulbs worthless'), meter(w, 'stability', -1, 'Bulb trading banned')) },
      { label: 'Tax every sale', what: 'If they are mad, the Treasury may as well profit.', effects: ['The richest three −8 to the Treasury', 'Boom 1 week'], run: (w) => (levy(w, richest(w), 8, 'treasury', 'Bulb tax'), cond(w, 'boom', 1)) }
    ]
  },
  {
    id: 'emperor', extreme: true, title: 'A citizen crowns themselves Emperor', text: 'A citizen has declared their street an independent empire, issued their own coins and demanded tribute from the neighbours.', weight: 0.4,
    cast: (w) => one(w, 'any', 'Emperor of the street'),
    options: [
      { label: 'Arrest the Emperor', what: 'A short reign.', effects: ['The Emperor −10 and −2 approval', 'Stability +1'], run: (w, c) => (castOf(c, 0) && (levy(w, [castOf(c, 0)!], 10, 'treasury', 'Fined for declaring an empire'), approve(w, castOf(c, 0)!, -2)), meter(w, 'stability', 1, 'The Emperor deposed')) },
      { label: 'Recognise the empire', what: 'Tourists love it. They pay tribute to the realm.', effects: ['The Emperor +10 and a stamp', 'Treasury +15 (tourists)', 'Stability −1'], run: (w, c) => (castOf(c, 0) && (share(w, 'reserve', [castOf(c, 0)!], 10, 'Imperial tribute'), stamp(w, castOf(c, 0)!, 'Emperor', 'Of one street', 'good')), transfer(w, 'reserve', 'treasury', 15, 'Empire tourism'), meter(w, 'stability', -1, 'An empire in the capital')) },
      { label: 'Ignore it', what: 'The idea spreads to the north.', effects: ['The Emperor +3 Influence', 'The north may try it next'], run: (w, c) => castOf(c, 0) && earn(w, castOf(c, 0)!, 3, 'Reigned unchallenged'), then: { type: 'secession', days: 7 } }
    ]
  },
  {
    id: 'curse', extreme: true, title: 'The Prime Minister is cursed', text: 'A soothsayer has cursed the Prime Minister in front of a crowd: “Ruin within the month.” Half the realm believes it.', weight: 0.4, needs: (w) => !!w.pm,
    cast: (w) => { const p = shuffle(w, freeCitizens(w).filter((x) => x !== w.pm)); return [{ id: w.pm!, role: 'cursed' }, ...(p[0] ? [{ id: p[0], role: 'the soothsayer' }] : [])]; },
    options: [
      { label: 'Pay to lift the curse', what: 'The soothsayer names a price.', effects: ['The PM pays the soothsayer up to 15', 'PM approval −1'], run: (w, c) => { const s2 = castOf(c, 1); if (w.pm && s2) { const n = Math.min(15, bal(w, ca(w.pm))); if (n > 0) transfer(w, ca(w.pm), ca(s2), n, 'To lift a curse'); approve(w, w.pm, -1); } } },
      { label: 'Laugh at it', what: 'The PM tears up the curse on camera.', effects: ['Even chance: PM approval +3', 'Otherwise: Prosperity −3 and PM approval −3 (it seems to work)'], run: (w) => { if (!w.pm) return; if (chance(w, 0.5)) approve(w, w.pm, 3); else (meter(w, 'prosperity', -3, 'The curse came true'), approve(w, w.pm, -3)); } },
      { label: 'Banish the soothsayer', what: 'Out of the capital.', effects: ['The soothsayer −10', 'Stability −1', 'The soothsayer +3 Influence (now famous)'], run: (w, c) => (castOf(c, 1) && (levy(w, [castOf(c, 1)!], 10, 'treasury', 'Banished soothsayer'), earn(w, castOf(c, 1)!, 3, 'Cursed the PM')), meter(w, 'stability', -1, 'A soothsayer banished')) }
    ]
  },
  {
    id: 'signal', extreme: true, title: 'A signal from the stars', text: 'The observatory has picked up a repeating signal from deep space. The astronomer who found it wants to answer.', weight: 0.3,
    cast: (w) => one(w, 'any', 'the astronomer who found it'),
    options: [
      { label: 'Answer it', what: 'A message from the realm to the stars. The whole world is watching.', effects: ['Treasury −30', 'All nations warm', 'The astronomer +5 Influence', 'A cult may form'], run: (w, c) => (spend(w, 30, 'reserve', 'A reply to the stars'), Object.keys(w.nations).forEach((n) => mood(w, n, 1, 'We answered the stars')), castOf(c, 0) && earn(w, castOf(c, 0)!, 5, 'Answered the stars')), then: { type: 'cult', days: 7 } },
      { label: 'Classify it', what: 'Nobody needs to know.', effects: ['A secret card', 'The astronomer −2 approval (they talked)'], run: (w, c) => (pmCard(w, 'The observatory found a signal from space. The government buried it.', 'The observatory'), castOf(c, 0) && approve(w, castOf(c, 0)!, -2)) },
      { label: 'Announce it, do nothing', what: 'A national holiday for the end of loneliness.', effects: ['Celebration 1 week', 'The astronomer +3 Influence'], run: (w, c) => (cond(w, 'celebration', 1), castOf(c, 0) && earn(w, castOf(c, 0)!, 3, 'Found the signal')) }
    ]
  },
  {
    id: 'meteor', extreme: true, house: true, title: 'A meteor strikes the capital', text: 'A rock the size of a cart came down in the night. Three streets are gone. Miraculously, nobody died, but some lost everything.', weight: 0.3,
    cast: (w) => shuffle(w, pool(w, 'poor')).slice(0, 3).map((id) => ({ id, role: 'whose home was destroyed' })),
    options: [
      { label: 'Rebuild their homes', what: 'The state pays for everything.', effects: ['Treasury −60', 'Each victim +10', 'Building programme 2 weeks'], run: (w, c) => (spend(w, 30, 'reserve', 'Meteor rebuilding'), share(w, 'treasury', (c.cast || []).map((x: any) => x.id), 10, 'Meteor compensation'), cond(w, 'building', 2)) },
      { label: 'Sell the meteorite', what: 'Collectors in Orrin will pay a fortune.', effects: ['Treasury +50 from Orrin', 'Orrin warms', 'The victims get nothing (−2 approval for the PM)'], run: (w) => (bal(w, 'nation:orrin') >= 50 && transfer(w, 'nation:orrin', 'treasury', 50, 'Sold the meteorite'), mood(w, 'orrin', 1, 'Bought our meteorite'), w.pm && approve(w, w.pm, -2)) },
      { label: 'Give the meteorite to the victims', what: 'Theirs to sell.', effects: ['Each victim +15 (new money)', 'Stability +1'], run: (w, c) => (share(w, 'reserve', (c.cast || []).map((x: any) => x.id), 15, 'Sold their piece of the meteorite'), meter(w, 'stability', 1, 'The meteorite went to the victims')) }
    ]
  },
  // ---------- more of the long tail ----------
  {
    id: 'heatwave', title: 'A record heatwave', text: 'Forty degrees in the capital. The old and the poor are suffering, and the reservoirs are dropping.', weight: 0.8,
    options: [
      { label: 'Open cooling centres', what: 'Public buildings stay open day and night.', effects: ['Treasury −20', 'The poorest three +3', 'Stability +1'], run: (w) => (spend(w, 11, 'reserve', 'Cooling centres'), share(w, 'treasury', poorest(w), 3, 'Heatwave help'), meter(w, 'stability', 1, 'Cooling centres opened')) },
      { label: 'Ban hosepipes', what: 'Save the water for drinking.', effects: ['Rationing 1 week', 'Stability −1'], run: (w) => (cond(w, 'rationing', 1), meter(w, 'stability', -1, 'A hosepipe ban')) },
      { label: 'Tell people to stay inside', what: 'Free advice, and nothing else.', effects: ['Epidemic 1 week', 'Drought 1 week'], run: (w) => (cond(w, 'epidemic', 1), cond(w, 'drought', 1)) }
    ]
  },
  {
    id: 'wildfire', title: 'Wildfires in the hills', text: 'The forests above the market towns are burning. Farms are in the path of the fire.', weight: 0.7,
    options: [
      { label: 'Send in the Army', what: 'Soldiers dig firebreaks. They like being useful.', effects: ['Treasury −25', 'Army loyalty +1', 'Stability +1'], run: (w) => (spend(w, 25, 'reserve', 'Firefighting'), army(w, 1, 'Fought the wildfires'), meter(w, 'stability', 1, 'The fires were fought')) },
      { label: 'Evacuate the farms', what: 'Lives saved, livelihoods lost.', effects: ['Four citizens lose up to 5', 'Recession 1 week'], run: (w) => (levy(w, some(w, 4), 5, 'reserve', 'Farm lost to the fire'), cond(w, 'recession', 1)) },
      { label: 'Ask Sundmere for water bombers', what: 'They have the planes. They will want something.', effects: ['Free now', 'Sundmere warms', 'Kessmark cools'], run: (w) => (mood(w, 'sundmere', 1, 'Their planes saved our forests'), mood(w, 'kessmark', -1, 'We asked Sundmere, not them')) }
    ]
  },
  {
    id: 'earthquake', extreme: true, house: true, title: 'An earthquake', text: 'A magnitude-six quake has flattened the old town. The world is watching how we respond.', weight: 0.4,
    options: [
      { label: 'An emergency budget', what: 'Borrow whatever it takes and rebuild.', effects: ['Treasury −100', 'Building programme 4 weeks', 'Stability +2'], run: (w) => (spend(w, 100, 'reserve', 'Earthquake reconstruction'), cond(w, 'building', 4), meter(w, 'stability', 2, 'The realm rebuilt')) },
      { label: 'A rebuilding levy', what: 'Every citizen pays 5 crowns towards it.', effects: ['Everyone −5', 'Building programme 2 weeks', 'Every citizen approval −1'], run: (w) => (levy(w, citizensNow(w).map((c: any) => c.id), 5, 'treasury', 'Earthquake levy'), cond(w, 'building', 2), approveAll(w, citizensNow(w).map((c: any) => c.id), -1)) },
      { label: 'Accept foreign aid', what: 'Every nation sends help, and every nation will remember.', effects: ['Treasury +40 from abroad', 'All nations warm', 'Varnholm will call in a favour'], run: (w) => { Object.keys(w.nations).forEach((n) => { bal(w, 'nation:' + n) >= 8 && transfer(w, 'nation:' + n, 'treasury', 8, 'Earthquake aid'); mood(w, n, 1, 'Helped after our earthquake'); }); owe(w, 'varnholm', 'We owe them for earthquake aid'); }, then: { type: 'varnholm_favour', days: 10 } }
    ]
  },
  {
    id: 'oil', title: 'Oil off the coast', text: 'Surveyors have found oil under the bay. Orrin’s companies are already circling.', weight: 0.5,
    options: [
      { label: 'A state oil company', what: 'The realm keeps the profits. Kessmark is jealous.', effects: ['Boom 3 weeks', 'Gold reserve +30', 'Kessmark cools'], run: (w) => (cond(w, 'boom', 3), (w.economy.gold = (w.economy.gold || 0) + 30), mood(w, 'kessmark', -1, 'Jealous of our oil')) },
      { label: 'Sell licences to Orrin', what: 'Money now, and Orrin owes us.', effects: ['Treasury +60 from Orrin', 'Orrin warms'], run: (w) => (bal(w, 'nation:orrin') >= 60 && transfer(w, 'nation:orrin', 'treasury', 60, 'Oil licences'), mood(w, 'orrin', 1, 'Got our oil licences')) },
      { label: 'Leave it in the ground', what: 'The fishermen and the greens are delighted.', effects: ['Stability +2', 'The poorest three +2 (fishing)'], run: (w) => (meter(w, 'stability', 2, 'The bay was protected'), share(w, 'reserve', poorest(w), 2, 'A good fishing season')) }
    ]
  },
  {
    id: 'pensions', house: true, title: 'The pension fund is empty', text: 'Decades of raids by past governments. The fund cannot pay next month’s pensions.', weight: 0.6,
    options: [
      { label: 'Raise income tax', what: 'Three points more, for good.', effects: ['Income tax +3% permanently', 'Stability +1', 'Every MP approval −1'], run: (w) => ((w.config.taxRate = Math.min(50, w.config.taxRate + 3)), meter(w, 'stability', 1, 'Pensions saved'), approveAll(w, mps(w), -1)) },
      { label: 'Cut pensions', what: 'The poorest pay for it.', effects: ['The poorest five −5 each', 'Stability −3'], run: (w) => (levy(w, poorest(w, 5), 5, 'treasury', 'Pension cut'), meter(w, 'stability', -3, 'Pensions cut')) },
      { label: 'Borrow to pay them', what: 'Kick it down the road.', effects: ['Treasury −50 (it will borrow)', 'The poorest five +10', 'Prices +2%'], run: (w) => (share(w, 'treasury', poorest(w, 5), 10, 'Pension paid'), prices(w, 2)) }
    ]
  },
  {
    id: 'doctors', title: 'The junior doctors strike', text: 'Twelve-hour shifts and pay frozen for years. The wards are running on agency staff.', weight: 0.7,
    options: [
      { label: 'Meet their pay claim', what: 'Expensive, and the nurses will be next.', effects: ['Treasury −40', 'Stability +2'], run: (w) => (spend(w, 40, 'reserve', 'Doctors’ pay deal'), meter(w, 'stability', 2, 'The doctors went back')) },
      { label: 'Use Army medics', what: 'The soldiers hate it.', effects: ['Army loyalty −1', 'Stability −1'], run: (w) => (army(w, -1, 'Made to cover the hospitals'), meter(w, 'stability', -1, 'Soldiers on the wards')) },
      { label: 'Let it run', what: 'Operations cancelled.', effects: ['Epidemic 2 weeks', 'Ministers approval −2'], run: (w) => (cond(w, 'epidemic', 2), approveAll(w, ministers(w), -2)) }
    ]
  },
  {
    id: 'cup', title: 'The national team wins the cup', text: 'The whole realm is in the streets. The players want a parade.', weight: 0.6,
    options: [
      { label: 'A victory parade', what: 'Open-top bus, the works.', effects: ['Treasury −15', 'Celebration 1 week', 'PM approval +2'], run: (w) => (spend(w, 15, 'reserve', 'Victory parade'), cond(w, 'celebration', 1), w.pm && approve(w, w.pm, 2)) },
      { label: 'Knight the captain', what: 'Two lucky citizens get a bonus and a title.', effects: ['Two citizens +10', 'Stability +1'], run: (w) => (share(w, 'treasury', some(w, 2), 10, 'Cup-winning bonus'), meter(w, 'stability', 1, 'Cup winners honoured')) },
      { label: 'A quiet word of congratulations', what: 'The public thinks it mean.', effects: ['PM approval −1'], run: (w) => w.pm && approve(w, w.pm, -1) }
    ]
  },
  {
    id: 'procurement', title: 'A procurement scandal', text: 'Ministers handed contracts to friends. A paper has the emails.', weight: 0.7, needs: (w) => ministers(w).length > 0,
    options: [
      { label: 'Prosecute', what: 'The ministers repay the money, in public.', effects: ['Every minister −10', 'Every minister approval −2', 'Stability +2'], run: (w) => (levy(w, ministers(w), 10, 'treasury', 'Repaid the contracts'), approveAll(w, ministers(w), -2), meter(w, 'stability', 2, 'Corruption prosecuted')) },
      { label: 'Blame the civil service', what: 'A permanent secretary resigns.', effects: ['The Chancellor’s approval −2', 'Stability −1'], run: (w) => (holderOf(w, 'treasury') && approve(w, holderOf(w, 'treasury')!, -2), meter(w, 'stability', -1, 'Blame passed down')) },
      { label: 'Cover it up', what: 'The emails disappear. Someone kept copies.', effects: ['A secret card about the PM', 'Stability −2'], run: (w) => (pmCard(w, 'The government buried evidence of contracts handed to friends.', 'A civil servant'), meter(w, 'stability', -2, 'A cover-up')) }
    ]
  },
  {
    id: 'donor', title: 'A donor buys a minister', text: 'The realm’s richest citizen has been paying a minister’s bills. In return, a planning law changed.', weight: 0.6, needs: (w) => ministers(w).length > 0,
    options: [
      { label: 'Cap political donations', what: 'The donor is fined and the minister reprimanded.', effects: ['The richest citizen −15', 'Ministers approval −1', 'Stability +2'], run: (w) => (levy(w, richest(w, 1), 15, 'treasury', 'Fined for buying influence'), approveAll(w, ministers(w), -1), meter(w, 'stability', 2, 'Donations capped')) },
      { label: 'Let it be', what: 'That is how politics works. The donor will want something.', effects: ['The richest citizen +3 Influence', 'Stability −2', 'The donor will send a bill'], then: { type: 'donor_bill', days: 10 }, run: (w) => { const r = richest(w, 1)[0]; if (r) earn(w, r, 3, 'Bought a minister'); meter(w, 'stability', -2, 'Influence for sale'); } },
      { label: 'Make the donor pay for a hospital', what: 'A deal: no charges, a big cheque.', effects: ['The richest citizen −20 to the Treasury', 'Building programme 1 week'], run: (w) => (levy(w, richest(w, 1), 20, 'treasury', 'A hospital, to make amends'), cond(w, 'building', 1)) }
    ]
  },
  {
    id: 'cult', title: 'A doomsday cult is growing', text: 'They say the world ends at the next payday. Followers are giving away everything they own.', weight: 0.5,
    options: [
      { label: 'Ban it', what: 'The followers go underground and resent it.', effects: ['Stability −2', 'Three citizens −1 Influence'], run: (w) => (meter(w, 'stability', -2, 'The cult was banned'), some(w, 3).forEach((id) => (w.citizens[id].influence = Math.max(0, (w.citizens[id].influence || 0) - 1)))) },
      { label: 'Freeze their accounts', what: 'The cult’s money goes back to the families.', effects: ['Three citizens +5', 'Stability +1'], run: (w) => (share(w, 'reserve', some(w, 3), 5, 'Returned from the cult'), meter(w, 'stability', 1, 'Families got their money back')) },
      { label: 'Wait for payday', what: 'When the world doesn’t end, they will go home.', effects: ['Stability −1', 'It usually works'], run: (w) => meter(w, 'stability', -1, 'A cult in the streets') }
    ]
  },
  {
    id: 'machines', house: true, title: 'Machines take the clerks’ jobs', text: 'Thinking machines from Orrin can do a clerk’s work in a second. Offices are laying people off.', weight: 0.6,
    options: [
      { label: 'Retrain the clerks', what: 'Slow and costly, but fair.', effects: ['Treasury −40', 'Building programme 2 weeks'], run: (w) => (spend(w, 40, 'reserve', 'Retraining'), cond(w, 'building', 2)) },
      { label: 'Tax the machines', what: 'The owners pay for the people they replace.', effects: ['The richest three −8', 'The poorest three +8', 'Orrin cools'], run: (w) => (levy(w, richest(w), 8, 'treasury', 'Machine tax'), share(w, 'treasury', poorest(w), 8, 'Paid from the machine tax'), mood(w, 'orrin', -1, 'Taxed their machines')) },
      { label: 'Embrace them', what: 'Productivity soars. So does unemployment.', effects: ['Boom 2 weeks', 'The poorest three −5', 'Stability −2'], run: (w) => (cond(w, 'boom', 2), levy(w, poorest(w), 5, 'reserve', 'Laid off'), meter(w, 'stability', -2, 'Clerks on the dole')) }
    ]
  },
  {
    id: 'smugglers', title: 'Smugglers on the Kessmark road', text: 'Cheap goods are pouring across the border untaxed. Shopkeepers are furious; shoppers are delighted.', weight: 0.6,
    options: [
      { label: 'Crack down', what: 'Customs patrols and higher tariffs.', effects: ['Tariff +5% permanently', 'Kessmark cools', 'Stability +1'], run: (w) => ((w.config.tariff = Math.min(40, w.config.tariff + 5)), mood(w, 'kessmark', -1, 'Our border crackdown'), meter(w, 'stability', 1, 'The border was policed')) },
      { label: 'Legalise the trade', what: 'Cut the tariff and let the goods in.', effects: ['Tariff −5% permanently', 'Prosperity +2', 'Kessmark warms'], run: (w) => ((w.config.tariff = Math.max(0, w.config.tariff - 5)), meter(w, 'prosperity', 2, 'Cheap goods'), mood(w, 'kessmark', 1, 'Opened the border trade')) },
      { label: 'Take a cut', what: 'The border guards are paid to look away. So is the Treasury. The smugglers will remember.', effects: ['Treasury +15', 'A secret card about the PM', 'The smugglers now own you'], then: { type: 'smuggler_blackmail', days: 10 }, run: (w) => (bal(w, 'nation:kessmark') >= 15 && transfer(w, 'nation:kessmark', 'treasury', 15, 'Border arrangements'), pmCard(w, 'The Treasury took a cut from the smugglers on the Kessmark road.', 'A customs officer')) }
    ]
  },
  {
    id: 'press_baron', title: 'A press baron buys every paper', text: 'One owner, every front page. Editors who disagree are being let go.', weight: 0.5,
    options: [
      { label: 'Break up the empire', what: 'Competition law, enforced.', effects: ['The richest citizen −10', 'Stability +1'], run: (w) => (levy(w, richest(w, 1), 10, 'treasury', 'Broken up by competition law'), meter(w, 'stability', 1, 'A free press defended')) },
      { label: 'Do a deal for good coverage', what: 'Friendly headlines for the government.', effects: ['PM approval +3', 'A secret card about the PM', 'Stability −1'], run: (w) => (w.pm && approve(w, w.pm, 3), pmCard(w, 'The PM traded favours for friendly headlines.', 'A newsroom'), meter(w, 'stability', -1, 'A captured press')) },
      { label: 'Leave it', what: 'The market decides.', effects: ['Stability −2'], run: (w) => meter(w, 'stability', -2, 'One voice in every paper') }
    ]
  },
  {
    id: 'royal_baby', title: 'A royal heir is born', text: 'The palace announces a healthy baby. Bells ring in every church.', weight: 0.5, needs: monarchy,
    options: [
      { label: 'A public celebration', what: 'Bunting, bonfires and a day off.', effects: ['Treasury −20', 'Celebration 1 week', 'Monarch approval +3'], run: (w) => (spend(w, 20, 'reserve', 'Royal birth celebrations'), cond(w, 'celebration', 1), w.hos.holder && approve(w, w.hos.holder, 3)) },
      { label: 'Name the baby after Varnholm’s queen', what: 'A diplomatic gift.', effects: ['Varnholm warms twice', 'Monarch approval +1'], run: (w) => (mood(w, 'varnholm', 2, 'Our royal baby bears their queen’s name'), w.hos.holder && approve(w, w.hos.holder, 1)) },
      { label: 'Keep it private', what: 'A family matter.', effects: ['Monarch approval +1'], run: (w) => w.hos.holder && approve(w, w.hos.holder, 1) }
    ]
  },
  {
    id: 'jewels', title: 'The Crown Jewels are stolen', text: 'The vault was empty this morning. The insurers are in Tessaly; the thieves may be too.', weight: 0.5, needs: monarchy,
    options: [
      { label: 'A manhunt', what: 'The Security Service and the Army search the realm.', effects: ['Treasury −20', 'Stability +1', 'Even chance: the jewels are found (monarch approval +3)'], run: (w) => (spend(w, 20, 'reserve', 'The jewel manhunt'), meter(w, 'stability', 1, 'A manhunt'), w.hos.holder && chance(w, 0.5) && approve(w, w.hos.holder, 3)) },
      { label: 'Claim the insurance', what: 'Tessaly pays, grudgingly.', effects: ['Treasury +35 from Tessaly', 'Tessaly cools', 'Monarch approval −1'], run: (w) => (bal(w, 'nation:tessaly') >= 35 && transfer(w, 'nation:tessaly', 'treasury', 35, 'Jewel insurance'), mood(w, 'tessaly', -1, 'Paid out on the jewels'), w.hos.holder && approve(w, w.hos.holder, -1)) },
      { label: 'Wear paste and say nothing', what: 'Nobody will notice. Probably.', effects: ['A secret card about the monarch', 'A jeweller may notice'], then: { type: 'paste_exposed', days: 14 }, run: (w) => card(w, w.hos.holder, 'The Crown Jewels on display are fakes. The real ones were stolen.', 'A palace guard', ['pm']) }
    ]
  },
  {
    id: 'rail', title: 'The railway goes bankrupt', text: 'The private railway company has collapsed. Trains stop tomorrow unless someone steps in.', weight: 0.6,
    options: [
      { label: 'Nationalise it', what: 'The state runs the trains.', effects: ['Treasury −50', 'Stability +2', 'The richest citizen loses up to 10 (shareholders)'], run: (w) => (spend(w, 50, 'reserve', 'Nationalised the railway'), levy(w, richest(w, 1), 10, 'reserve', 'Railway shares wiped out'), meter(w, 'stability', 2, 'The trains kept running')) },
      { label: 'Sell it to Varnholm', what: 'Foreign owners, but the trains run.', effects: ['Treasury +20', 'Varnholm warms', 'Stability −1'], run: (w) => (bal(w, 'nation:varnholm') >= 20 && transfer(w, 'nation:varnholm', 'treasury', 20, 'Railway sold'), mood(w, 'varnholm', 1, 'Bought our railway'), meter(w, 'stability', -1, 'The railway sold abroad')) },
      { label: 'Let the trains stop', what: 'Buses, eventually.', effects: ['Recession 2 weeks'], run: (w) => cond(w, 'recession', 2) }
    ]
  },
  {
    // set off by the economy, not by chance: prices rose more than 10% two weeks running (economy.ts, payday)
    id: 'hyperinflation', chainOnly: true, extreme: true, title: 'Hyperinflation', text: 'Prices are rising faster than wages. Shops change their price tags twice a day, and people are spending their crowns before they lose their value.',
    options: [
      { label: 'Issue a new currency', what: 'Strike off the zeros and start the price index again. Savers are furious.', effects: ['Prices reset', 'Stability −5', 'Prosperity −2'], run: (w) => ((w.economy.prices = [2]), (w.economy.hotWeeks = 0), meter(w, 'stability', -5, 'A new currency'), meter(w, 'prosperity', -2, 'A new currency')) },
      { label: 'Raise the rate to 15%', what: 'The Reserve slams on the brakes. Borrowing gets dear.', effects: ['Rate 15%', 'Prosperity −4'], run: (w) => ((w.economy.rate = 15), (w.economy.hotWeeks = 0), meter(w, 'prosperity', -4, 'Interest at 15%')) },
      { label: 'Freeze prices for a week', what: 'By order, nothing costs more than it did today. Shelves empty.', effects: ['Inflation held to 1% next payday', 'Prosperity −3', 'Stability −1'], run: (w) => ((w.economy.freezeUntil = w.now + 7 * DAY), (w.economy.hotWeeks = 0), meter(w, 'prosperity', -3, 'Empty shelves under the price freeze'), meter(w, 'stability', -1, 'The price freeze')) },
      { label: 'Ride it out', what: 'Do nothing and hope it burns out.', effects: ['Prosperity −6', 'Stability −4'], run: (w) => (meter(w, 'prosperity', -6, 'Hyperinflation unchecked'), meter(w, 'stability', -4, 'Hyperinflation unchecked')) }
    ]
  },
  {
    id: 'gold', house: true, title: 'Gold in the hills', text: 'Prospectors have struck a seam. Everyone wants a share.',
    options: [
      { label: 'Nationalise the mine', what: 'The Reserve mints the gold into the Treasury. Kessmark is jealous, and the miners want their cut.', effects: ['Treasury +60', 'Gold reserve +40', 'Prices +3%', 'Kessmark cools', 'The miners may revolt'], run: (w) => (transfer(w, 'reserve', 'treasury', 60, 'Gold from the state mine'), (w.economy.gold = (w.economy.gold || 0) + 40), prices(w, 3), mood(w, 'kessmark', -1, 'Jealous of our gold')), then: { type: 'miners', days: 7 } },
      { label: 'License private miners', what: 'A rush of jobs and money.', effects: ['Everyone +3 crowns', 'Prosperity +3', 'Prices +2%'], run: (w) => (allCitizens(w).forEach((c: any) => transfer(w, 'reserve', ca(c.id), 3, 'Gold rush')), meter(w, 'prosperity', 3, 'A gold rush'), prices(w, 2)) },
      { label: 'Leave it in the ground', what: 'Peace and quiet.', effects: ['Nothing happens'], run: () => {} }
    ]
  },
  {
    id: 'forgery', title: 'Forged crowns turn up', text: 'Shops are refusing notes. Someone is printing money.',
    options: [
      { label: 'Recall and reprint', what: 'New notes with better security.', effects: ['Treasury −25', 'Prosperity −1'], run: (w) => (spend(w, 25, 'escrow', 'New banknotes'), meter(w, 'prosperity', -1, 'A banknote recall')) },
      { label: 'Ignore it', what: 'The fakes keep circulating.', effects: ['Prices +4%', 'Prosperity −2'], run: (w) => (prices(w, 4), meter(w, 'prosperity', -2, 'Forged money circulates')) }
    ]
  },
  {
    id: 'tourists', title: 'Travellers flock to the coast', text: 'The inns are full and the beaches are packed.',
    options: [
      { label: 'Charge a visitor tax', what: 'Foreign money into the Treasury.', effects: ['Treasury +25 (new money)', 'Prosperity +1'], run: (w) => (transfer(w, 'reserve', 'treasury', 25, 'Visitor tax'), meter(w, 'prosperity', 1, 'A busy season')) },
      { label: 'Welcome them freely', what: 'Spending goes straight to local businesses.', effects: ['Prosperity +3'], run: (w) => meter(w, 'prosperity', 3, 'A record tourist season') }
    ]
  },
  // ---------- money ----------
  {
    id: 'rumour', title: 'A run on the banks', text: 'Rumours spread that the banks are short of cash.', needs: (w) => Object.values(w.banks).some((b: any) => b.status === 'open'),
    options: [
      { label: 'Guarantee every deposit', what: 'The Treasury promises to cover savers.', effects: ['Prosperity +2', 'A secret card for the Chancellor'], run: (w) => (meter(w, 'prosperity', 2, 'Deposits were guaranteed'), addCard(w, { title: 'The deposit guarantee has no money behind it. The Treasury could not cover a real run.', about: holderOf(w, 'treasury') || w.pm, from: 'Treasury', level: 'restricted', viewers: ['pm', 'office:treasury'] })) },
      { label: 'Say nothing', what: 'Savers panic and banks lose cash.', effects: ['Prosperity −4', 'Banks lose 20% of cash'], run: (w) => (meter(w, 'prosperity', -4, 'A bank panic'), Object.values(w.banks).forEach((b: any) => { const c = Math.floor((w.accounts['bank:' + b.id] || 0) * 0.2); if (c > 0) transfer(w, 'bank:' + b.id, 'escrow', c, 'Panic withdrawals'); })) }
    ]
  },
  {
    id: 'banker', title: 'A banker vanishes', text: 'A bank manager has disappeared, and so has a stack of savers’ cash.', needs: (w) => Object.values(w.banks).some((b: any) => b.status === 'open'),
    options: [
      { label: 'Compensate the savers', what: 'The Treasury makes them whole.', effects: ['Treasury −40', 'Prosperity +1'], run: (w) => (spend(w, 40, 'escrow', 'Compensating bank savers'), meter(w, 'prosperity', 1, 'Savers were compensated')) },
      { label: 'Let them lose it', what: 'Savers learn a hard lesson.', effects: ['Prosperity −4', 'Stability −2'], run: (w) => (meter(w, 'prosperity', -4, 'Savers lost everything'), meter(w, 'stability', -2, 'Savers lost everything')) }
    ]
  },
  {
    id: 'debt', house: true, title: 'The Reserve calls in its loans', text: 'The Reserve wants the Treasury to start paying back what it borrowed.', needs: (w) => w.economy.lent >= 50,
    options: [
      { label: 'Repay 50 now', what: 'Painful, but the books look healthier.', effects: ['Treasury −50', 'Debt −50', 'Prosperity +1'], run: (w) => (spend(w, 50, 'reserve', 'Repaying the Reserve'), (w.economy.lent = Math.max(0, w.economy.lent - 50)), meter(w, 'prosperity', 1, 'The Treasury paid down its debt')) },
      { label: 'Refuse', what: 'The Reserve raises its rate in protest. Prices may run away.', effects: ['Interest rate +1%', 'Prosperity −2', 'Inflation may follow'], run: (w) => ((w.economy.rate = Math.min(15, w.economy.rate + 1)), prices(w, 6), meter(w, 'prosperity', -2, 'The Treasury refused to repay')), then: { type: 'inflation', days: 10 } }
    ]
  },
  // ---------- abroad ----------
  {
    id: 'insult', title: 'An envoy insulted', text: 'A Kessmark envoy was booed at a public event.',
    options: [
      { label: 'Apologise publicly', what: 'Kessmark is soothed; some citizens are annoyed.', effects: ['Kessmark warms', 'Stability −2'], run: (w) => (mood(w, 'kessmark', 1, 'We apologised'), meter(w, 'stability', -2, 'An unpopular apology')) },
      { label: 'Stand firm', what: 'Kessmark cools; the Army approves.', effects: ['Kessmark cools', 'Army loyalty +1', 'Stability +1'], run: (w) => (mood(w, 'kessmark', -1, 'We refused to apologise'), army(w, 1, 'The government stood firm'), meter(w, 'stability', 1, 'The government stood firm')) }
    ]
  },
  {
    id: 'visit', title: 'A famous visitor', text: 'A celebrated musician wants to play in the realm.',
    options: [
      { label: 'Host a festival', what: 'A great day out, paid by the Treasury.', effects: ['Treasury −30', 'Stability +4', 'Everyone +1 Influence'], run: (w) => (spend(w, 30, 'nation:orrin', 'Festival fee'), meter(w, 'stability', 4, 'A festival'), everyone(w, 1, 'Went to the festival')) },
      { label: 'Let them busk', what: 'Free, and nobody minds much.', effects: ['Nothing happens'], run: () => {} }
    ]
  },
  {
    id: 'refugees', house: true, title: 'Refugees at the border', text: 'Families are fleeing hard times in Kessmark.',
    options: [
      { label: 'Take them in', what: 'Tessaly applauds. Kessmark is embarrassed.', effects: ['Treasury −30', 'Tessaly warms', 'Kessmark cools'], run: (w) => (spend(w, 30, 'escrow', 'Housing refugees'), mood(w, 'tessaly', 1, 'We took in refugees'), mood(w, 'kessmark', -1, 'We sheltered their people')), then: { type: 'refugees_settle', days: 14 } },
      { label: 'Close the border', what: 'Kessmark is grateful. Tessaly is not.', effects: ['Kessmark warms', 'Tessaly cools', 'Stability +1'], run: (w) => (mood(w, 'kessmark', 1, 'We closed the border'), mood(w, 'tessaly', -1, 'We turned refugees away'), meter(w, 'stability', 1, 'The border was closed')) },
      { label: 'Do nothing', what: 'Camps grow along the border.', effects: ['Stability −3'], run: (w) => meter(w, 'stability', -3, 'Camps on the border') }
    ]
  },
  {
    id: 'spy', house: true, title: 'A Kessmark spy is caught', text: 'A clerk at the Treasury was passing papers across the border.',
    options: [
      { label: 'Put them on trial', what: 'A public show of strength.', effects: ['Stability +3', 'Kessmark cools sharply'], run: (w) => (meter(w, 'stability', 3, 'A spy on trial'), mood(w, 'kessmark', -2, 'We put their agent on trial')) },
      { label: 'Expel them quietly', what: 'Firm, but not humiliating.', effects: ['Stability +1', 'Kessmark cools'], run: (w) => (meter(w, 'stability', 1, 'A spy was expelled'), mood(w, 'kessmark', -1, 'We expelled their agent')) },
      { label: 'Swap them for a favour', what: 'Kessmark owes us. Nobody else knows. Spies come back.', effects: ['Kessmark warms', 'A secret card about the PM'], run: (w) => (mood(w, 'kessmark', 1, 'We returned their agent'), pmCard(w, 'The PM quietly handed a caught spy back to Kessmark.', 'Security Service')), then: { type: 'spy_returns', days: 10 } }
    ]
  },
  {
    id: 'pirates', title: 'Pirates on the trade route', text: 'Merchant ships are being stopped off the Orrin Isles.',
    options: [
      { label: 'Pay for armed escorts', what: 'Expensive, and Orrin is grateful.', effects: ['Treasury −35', 'Orrin warms', 'Prosperity +1'], run: (w) => (spend(w, 35, 'nation:orrin', 'Convoy escorts'), mood(w, 'orrin', 1, 'We protected the sea lanes'), meter(w, 'prosperity', 1, 'Trade kept moving')) },
      { label: 'Pay the pirates', what: 'Cheaper. Someone will find out, and pirates always come back.', effects: ['Treasury −15', 'A secret card about the PM', 'They’ll want more'], run: (w) => (spend(w, 15, 'escrow', 'Payments at sea'), pmCard(w, 'The government paid pirates to leave our ships alone.', 'Admiralty clerk')), then: { type: 'pirates_return', days: 7 } },
      { label: 'Accept the losses', what: 'Trade suffers.', effects: ['Prosperity −4'], run: (w) => meter(w, 'prosperity', -4, 'Pirates choked trade') }
    ]
  },
  {
    id: 'fair', title: 'Tessaly offers a trade fair', text: 'They want to hold it here, if we cover the halls.',
    options: [
      { label: 'Host it', what: 'Deals are struck and friendships made.', effects: ['Treasury −20', 'Prosperity +3', 'Tessaly warms'], run: (w) => (spend(w, 20, 'escrow', 'Trade fair halls'), meter(w, 'prosperity', 3, 'A busy trade fair'), mood(w, 'tessaly', 1, 'We hosted their fair')) },
      { label: 'Politely decline', what: 'They take it to Varnholm instead.', effects: ['Tessaly cools'], run: (w) => mood(w, 'tessaly', -1, 'We turned down their fair') }
    ]
  },
  {
    id: 'embassy', title: 'Our embassy in Sundmere burns', text: 'An accident, they say. Our staff are safe.',
    options: [
      { label: 'Demand an apology', what: 'Pride intact, relations strained.', effects: ['Sundmere cools', 'Stability +1'], run: (w) => (mood(w, 'sundmere', -1, 'We blamed them for the fire'), meter(w, 'stability', 1, 'We stood up for our embassy')) },
      { label: 'Rebuild quietly', what: 'We pay, and Sundmere is relieved.', effects: ['Treasury −30', 'Sundmere warms'], run: (w) => (spend(w, 30, 'nation:sundmere', 'Rebuilding the embassy'), mood(w, 'sundmere', 1, 'We were gracious about the fire')) }
    ]
  },
  {
    id: 'grain', title: 'Varnholm asks for a favour', text: 'Their grain buyers want us to drop the tariff, just for them.',
    options: [
      { label: 'Agree', what: 'Varnholm is delighted; the Treasury loses tariff money.', effects: ['Varnholm warms sharply', 'Treasury −20'], run: (w) => (mood(w, 'varnholm', 2, 'We cut their tariff'), spend(w, 20, 'nation:varnholm', 'Tariff rebate')) },
      { label: 'Refuse', what: 'Rules are rules.', effects: ['Varnholm cools'], run: (w) => mood(w, 'varnholm', -1, 'We refused a favour') }
    ]
  },
  {
    id: 'border', house: true, title: 'Kessmark troops at the border', text: 'Columns have been seen on the ridge. Nobody knows why.',
    options: [
      { label: 'Ask Orrin for support', what: 'Our ally sends ships. Kessmark notices.', effects: ['Orrin warms', 'Kessmark cools', 'Stability +1'], run: (w) => (mood(w, 'orrin', 1, 'We stood together'), mood(w, 'kessmark', -1, 'We called in Orrin'), meter(w, 'stability', 1, 'Allies at our side')) },
      { label: 'Send a peace envoy', what: 'Talks calm things down. Some call it weakness.', effects: ['Kessmark warms', 'Stability −2'], run: (w) => (mood(w, 'kessmark', 1, 'We sent a peace envoy'), meter(w, 'stability', -2, 'Accused of weakness')) },
      { label: 'Wait and watch', what: 'Nervous days.', effects: ['Stability −3'], run: (w) => meter(w, 'stability', -3, 'Troops on the ridge') }
    ]
  },
  // ---------- the Army ----------
  {
    id: 'backpay', title: 'Soldiers demand back pay', text: 'The barracks say they have not been paid properly in weeks.', needs: (w) => has(w, 'army'),
    options: [
      { label: 'Pay them', what: 'Loyal soldiers are cheap at the price.', effects: ['Treasury −40', 'Army loyalty +1'], run: (w) => (spend(w, 40, 'escrow', 'Army back pay'), army(w, 1, 'Back pay was paid')) },
      { label: 'Refuse', what: 'The soldiers will remember.', effects: ['Army loyalty −2'], run: (w) => army(w, -2, 'Back pay was refused') }
    ]
  },
  {
    id: 'officers', title: 'Whispers in the officers’ mess', text: 'There is talk of a coup. It might just be talk.', needs: (w) => has(w, 'army'),
    options: [
      { label: 'Purge the plotters', what: 'Safe, and resented.', effects: ['Army loyalty −1', 'Stability +2'], run: (w) => (army(w, -1, 'A purge of officers'), meter(w, 'stability', 2, 'Plotters were removed')) },
      { label: 'Raise officers’ pay', what: 'Buy their loyalty.', effects: ['Treasury −30', 'Army loyalty +1'], run: (w) => (spend(w, 30, 'escrow', 'Officers’ bonuses'), army(w, 1, 'Officers got a raise')) },
      { label: 'Ignore it', what: 'It is probably nothing.', effects: ['Stability −2', 'It may not be nothing'], run: (w) => meter(w, 'stability', -2, 'Coup rumours'), then: { type: 'mutiny', days: 7 } }
    ]
  },
  // ---------- the press ----------
  {
    id: 'scoop', title: 'A paper prints state secrets', text: 'A front page reveals what the Cabinet discussed last week.', needs: (w) => Object.keys(w.papers).length > 0 && !!w.pm,
    options: [
      { label: 'Seek an injunction', what: 'The story stops, and the press is outraged.', effects: ['PM approval −2', 'Stability +1'], run: (w) => (approve(w, w.pm, -2), meter(w, 'stability', 1, 'An injunction against the press')) },
      { label: 'Let it run', what: 'A free press is a free country.', effects: ['Stability −2', 'PM approval +1'], run: (w) => (meter(w, 'stability', -2, 'Cabinet secrets in print'), approve(w, w.pm, 1)) }
    ]
  },
  // ---------- the Crown ----------
  {
    id: 'wedding', title: 'A royal wedding', text: 'The palace has announced an engagement. The wedding will be the event of the decade, and someone has to pay for it. Foreign royals are angling for invitations.', needs: monarchy,
    options: [
      { label: 'A state wedding', what: 'Westminster-scale pageantry: a public holiday, foreign royals, a procession. The Treasury pays; tourists pour in.', effects: ['Treasury −60', 'Tourists bring +30', 'Celebration 1 week', 'Every citizen +2 (souvenir trade)', 'Monarch approval +3', 'Two nations warm'], run: (w) => {
        spend(w, 60, 'reserve', 'The royal wedding');
        Object.keys(w.nations).slice(0, 3).forEach((n) => bal(w, 'nation:' + n) >= 10 && transfer(w, 'nation:' + n, 'treasury', 10, 'Wedding tourists'));
        share(w, 'reserve', citizensNow(w).map((c: any) => c.id), 2, 'Wedding souvenir trade');
        cond(w, 'celebration', 1);
        if (w.hos.holder) approve(w, w.hos.holder, 3);
        Object.keys(w.nations).slice(0, 2).forEach((n) => mood(w, n, 1, 'Their royals were at our wedding'));
      } },
      { label: 'The Crown pays', what: 'A smaller ceremony, paid from the monarch’s own purse. Thrifty, and popular with taxpayers.', effects: ['The monarch pays up to 25', 'Monarch approval +2', 'Stability +1'], run: (w) => (w.hos.holder && (levy(w, [w.hos.holder], 25, 'reserve', 'Paid for my own wedding'), approve(w, w.hos.holder, 2)), meter(w, 'stability', 1, 'A thrifty royal wedding')) },
      { label: 'Sell the broadcast rights', what: 'Tessaly’s networks pay handsomely. Some call it tacky.', effects: ['Treasury +40 from Tessaly', 'Monarch approval −2', 'Celebration 1 week'], run: (w) => (bal(w, 'nation:tessaly') >= 40 && transfer(w, 'nation:tessaly', 'treasury', 40, 'Wedding broadcast rights'), w.hos.holder && approve(w, w.hos.holder, -2), cond(w, 'celebration', 1)) },
      { label: 'A private ceremony', what: 'Family only. The public feels shut out, and Kessmark’s prince is offended not to be asked.', effects: ['Stability −1', 'Kessmark cools'], run: (w) => (meter(w, 'stability', -1, 'A private royal wedding'), mood(w, 'kessmark', -1, 'Not invited to the wedding')) }
    ]
  },
  {
    id: 'snub', title: 'The President is snubbed abroad', text: 'Varnholm left our head of state off a summit guest list.', needs: (w) => !monarchy(w),
    options: [
      { label: 'Protest formally', what: 'Varnholm is annoyed; the public approves.', effects: ['Varnholm cools', 'Stability +1'], run: (w) => (mood(w, 'varnholm', -1, 'We protested a snub'), meter(w, 'stability', 1, 'We stood up for the President')) },
      { label: 'Laugh it off', what: 'Graceful, if a little humiliating.', effects: ['Stability −1'], run: (w) => meter(w, 'stability', -1, 'The President was snubbed') }
    ]
  },
  {
    id: 'storm', title: 'A storm wrecks the harbour', text: 'Boats are smashed and the quay is underwater.',
    options: [
      { label: 'Rebuild the harbour', what: 'Back in business within the week.', effects: ['Treasury −45', 'Prosperity +1'], run: (w) => (spend(w, 45, 'escrow', 'Harbour repairs'), meter(w, 'prosperity', 1, 'The harbour reopened')) },
      { label: 'Ask Orrin for shipwrights', what: 'Free help, and a favour owed.', effects: ['Free', 'Orrin will call in the favour'], run: (w) => owe(w, 'orrin', 'We owe them for the harbour'), then: { type: 'orrin_favour', days: 14 } },
      { label: 'Leave it', what: 'The fishing fleet stays home.', effects: ['Prosperity −4'], run: (w) => meter(w, 'prosperity', -4, 'The harbour lies wrecked') }
    ]
  }  ,
  // ---------- extreme ----------
  {
    id: 'riots', title: 'Riots in the capital', text: 'Shops are burning on the high street. The police have lost control of three districts.', extreme: true, weight: 0.5,
    options: [
      { label: 'Declare a state of emergency', what: 'Parliament is suspended; the PM rules by decree for 3 days, then the realm votes again.', effects: ['Martial law for 3 days', 'Then a snap election', 'Stability +5', 'PM approval −5'], run: (w) => (emergency(w), meter(w, 'stability', 5, 'Order restored under emergency rule'), approve(w, w.pm, -5)) },
      { label: 'Send in the Army', what: 'Soldiers on the streets. Fast, brutal, remembered.', effects: ['Stability +3', 'Army loyalty −1', 'PM approval −3', 'Without an Army: Stability −3'], run: (w) => (has(w, 'army') ? (meter(w, 'stability', 3, 'The Army cleared the streets'), army(w, -1, 'Ordered against our own people')) : meter(w, 'stability', -3, 'There was no Army to send'), approve(w, w.pm, -3)) },
      { label: 'Make concessions', what: 'Cash for the poorest districts, and promises.', effects: ['Treasury −60', 'Stability +3'], run: (w) => (spend(w, 60, 'escrow', 'Relief for the riot districts'), meter(w, 'stability', 3, 'Concessions calmed the streets')) },
      { label: 'Let it burn out', what: 'It ends when it ends.', effects: ['Stability −10', 'Prosperity −4'], run: (w) => (meter(w, 'stability', -10, 'The riots burned for days'), meter(w, 'prosperity', -4, 'Shops looted')) }
    ]
  },
  {
    id: 'general_strike', title: 'A general strike', text: 'Every union walks out at once. Nothing moves: no trains, no post, no bread.', extreme: true, weight: 0.5, house: true,
    options: [
      { label: 'Give in to their demands', what: 'The most expensive peace in the realm’s history.', effects: ['Treasury −80', 'Stability +4', 'Prosperity −1'], run: (w) => (spend(w, 80, 'escrow', 'General strike settlement'), meter(w, 'stability', 4, 'The general strike ended'), meter(w, 'prosperity', -1, 'Wage bill rose')) },
      { label: 'Call a snap election', what: 'Let the voters decide who is right.', effects: ['General election in 2 days', 'Stability +2'], run: (w) => (snapElection(w), meter(w, 'stability', 2, 'The voters will decide')) },
      { label: 'Break the strike', what: 'Volunteers and soldiers keep things running.', effects: ['Stability −6', 'Prosperity +1', 'Army loyalty +1'], run: (w) => (meter(w, 'stability', -6, 'The strike was broken'), meter(w, 'prosperity', 1, 'Trains ran again'), army(w, 1, 'Kept the country running')) },
      { label: 'Wait', what: 'Someone will blink.', effects: ['Prosperity −8', 'Stability −3'], run: (w) => (meter(w, 'prosperity', -8, 'The country stood still'), meter(w, 'stability', -3, 'A long general strike')) }
    ]
  },
  {
    id: 'attempt', title: 'An attempt on the Prime Minister’s life', text: 'A shot was fired at the PM’s carriage. The PM is unhurt. The gunman is in custody and won’t talk.', extreme: true, weight: 0.4, needs: (w) => !!w.pm,
    options: [
      { label: 'Blame Kessmark', what: 'There is no evidence. The crowd doesn’t care.', effects: ['Stability +4', 'Kessmark cools sharply', 'A secret card about the PM'], run: (w) => (meter(w, 'stability', 4, 'The realm rallied'), mood(w, 'kessmark', -3, 'Blamed for the attempt on the PM'), pmCard(w, 'The PM blamed Kessmark for the shooting with no evidence at all.', 'Security Service')) },
      { label: 'Crack down on dissent', what: 'Arrests, curfews, closed meetings.', effects: ['Stability +2', 'Everyone −1 Influence', 'PM approval −2'], run: (w) => (meter(w, 'stability', 2, 'A crackdown'), allCitizens(w).forEach((c: any) => c.influence > 0 && (c.influence -= 1)), approve(w, w.pm, -2)) },
      { label: 'Keep calm and carry on', what: 'The PM goes back to work the same afternoon.', effects: ['PM approval +6', 'Stability +1'], run: (w) => (approve(w, w.pm, 6), meter(w, 'stability', 1, 'The PM carried on')) }
    ]
  },
  {
    id: 'secession', title: 'The north declares independence', text: 'The northern towns have raised their own flag and stopped sending taxes.', extreme: true, weight: 0.4, house: true,
    options: [
      { label: 'Offer them autonomy', what: 'A parliament of their own, inside the realm.', effects: ['Treasury −40', 'Stability −2', 'Prosperity −2'], run: (w) => (spend(w, 40, 'escrow', 'Northern settlement'), meter(w, 'stability', -2, 'The north got its own parliament'), meter(w, 'prosperity', -2, 'Northern taxes fell')) },
      { label: 'Send the Army north', what: 'Works if the Army is loyal. Disaster if it isn’t.', effects: ['Army loyal (3+): Stability +3', 'Otherwise: Stability −8', 'No Army: Stability −6'], run: (w) => (!has(w, 'army') ? meter(w, 'stability', -6, 'There was no Army to send north') : w.army.loyalty >= 3 ? meter(w, 'stability', 3, 'The north was brought back') : (meter(w, 'stability', -8, 'Soldiers refused to march north'), army(w, -1, 'Sent against our own'))) },
      { label: 'Let them hold a referendum', what: 'A vote in a week. They might leave.', effects: ['Stability −1', 'A referendum next week'], run: (w) => meter(w, 'stability', -1, 'The north will vote'), then: { type: 'north_vote', days: 7 } },
      { label: 'Ignore it', what: 'Pretend the flag isn’t there.', effects: ['Stability −8', 'Prosperity −5'], run: (w) => (meter(w, 'stability', -8, 'The north went its own way'), meter(w, 'prosperity', -5, 'Northern taxes stopped')) }
    ]
  },
  {
    id: 'ultimatum', title: 'Kessmark issues an ultimatum', text: 'Hand over control of the river crossings within the week, they say, or face the consequences.', extreme: true, weight: 0.4, house: true,
    options: [
      { label: 'Give in', what: 'Peace, at the price of pride and the river trade.', effects: ['Kessmark warms', 'Stability −5', 'Prosperity −3', 'Orrin cools'], run: (w) => (mood(w, 'kessmark', 2, 'We gave in'), meter(w, 'stability', -5, 'We gave in to Kessmark'), meter(w, 'prosperity', -3, 'Lost the river trade'), mood(w, 'orrin', -1, 'We abandoned the river')) },
      { label: 'Call in our allies', what: 'Orrin and Tessaly stand with us, for a price.', effects: ['Treasury −30', 'Orrin and Tessaly warm', 'Kessmark cools'], run: (w) => (spend(w, 30, 'nation:orrin', 'Allied support'), mood(w, 'orrin', 1, 'Stood with us'), mood(w, 'tessaly', 1, 'Stood with us'), mood(w, 'kessmark', -1, 'We called in allies')) },
      { label: 'Defy them', what: 'Let them try. They might.', effects: ['Stability +3', 'Kessmark cools sharply', 'A blockade may follow'], run: (w) => (meter(w, 'stability', 3, 'We defied Kessmark'), mood(w, 'kessmark', -2, 'We defied their ultimatum')), then: { type: 'blockade', days: 7 } }
    ]
  },
  {
    id: 'bank_freeze', title: 'The banking system freezes', text: 'No bank will lend to another. Cash machines are empty.', extreme: true, weight: 0.5, house: true, needs: (w) => Object.values(w.banks).some((b: any) => b.status === 'open'),
    options: [
      { label: 'Print money to rescue them', what: 'The Reserve floods the system with cash.', effects: ['Treasury +100 (new money)', 'Prices +8%', 'Prosperity +2'], run: (w) => (transfer(w, 'reserve', 'treasury', 100, 'Emergency liquidity'), prices(w, 8), meter(w, 'prosperity', 2, 'The banks were rescued')) },
      { label: 'Guarantee everything', what: 'Calm, unless anyone checks whether the Treasury can pay.', effects: ['Prosperity +1', 'A secret card for the Chancellor'], run: (w) => (meter(w, 'prosperity', 1, 'A blanket guarantee'), card(w, holderOf(w, 'treasury') || w.pm, 'The blanket bank guarantee is worth nothing: the Treasury could never pay it.', 'Treasury', ['pm', 'office:treasury'])) },
      { label: 'Let them fail', what: 'The weak banks go under.', effects: ['Prosperity −10', 'Stability −3'], run: (w) => (meter(w, 'prosperity', -10, 'Banks collapsed'), meter(w, 'stability', -3, 'Savers lost everything')) }
    ]
  },
  {
    id: 'prison', title: 'A mass prison break', text: 'Two hundred prisoners walked out of the city gaol overnight.', extreme: true, weight: 0.6,
    options: [
      { label: 'Launch a manhunt', what: 'Roadblocks and rewards.', effects: ['Treasury −25', 'Stability +1'], run: (w) => (spend(w, 25, 'escrow', 'Manhunt'), meter(w, 'stability', 1, 'The escapees were caught')) },
      { label: 'Offer an amnesty', what: 'Come back and your sentence is halved.', effects: ['Stability −2', 'PM approval −2'], run: (w) => (meter(w, 'stability', -2, 'An amnesty for escapees'), approve(w, w.pm, -2)) },
      { label: 'Do nothing', what: 'Lock your doors.', effects: ['Stability −5'], run: (w) => meter(w, 'stability', -5, 'Escaped prisoners roam free') }
    ]
  },
  {
    id: 'storming', title: 'A mob storms Parliament', text: 'They broke through the doors during a debate. MPs are barricaded in the library.', extreme: true, weight: 0.3, house: true, needs: (w) => mps(w).length > 0,
    options: [
      { label: 'Dissolve and go to the country', what: 'A snap election to settle who governs.', effects: ['General election in 2 days', 'Stability +2'], run: (w) => (snapElection(w), meter(w, 'stability', 2, 'The people will decide')) },
      { label: 'Emergency powers', what: 'The PM rules by decree for 3 days while order is restored.', effects: ['Martial law for 3 days', 'Then a snap election', 'Stability +4'], run: (w) => (emergency(w), meter(w, 'stability', 4, 'Emergency rule after the storming')) },
      { label: 'Sit again tomorrow', what: 'Defiant normality. The doors are repaired overnight.', effects: ['Stability −3', 'Every MP +2 Influence'], run: (w) => (meter(w, 'stability', -3, 'Parliament was stormed'), mps(w).forEach((m) => earn(w, m, 2, 'Sat on after the storming'))) }
    ]
  },
  {
    id: 'hos_scandal', title: 'The head of state in disgrace', text: 'Letters show the head of state took gifts from a Kessmark merchant.', extreme: true, weight: 0.4, house: true, needs: (w) => !!w.hos.holder,
    options: [
      { label: 'Demand they step down', what: 'A new head of state is chosen as the constitution says.', effects: ['The head of state goes', 'Stability −3'], run: (w) => (hosGoes(w), meter(w, 'stability', -3, 'The head of state fell'), approve(w, w.hos.holder, -15)) },
      { label: 'Stand by them', what: 'Loyal, and costly.', effects: ['Stability −2', 'Kessmark warms'], run: (w) => (meter(w, 'stability', -2, 'The head of state survived a scandal'), mood(w, 'kessmark', 1, 'Their merchant was protected')) },
      { label: 'Bury the letters', what: 'Quiet. Someone keeps copies.', effects: ['A secret card about the head of state'], run: (w) => card(w, w.hos.holder, 'The head of state took gifts from a Kessmark merchant, and the government hid it.', 'Royal household', ['pm']) }
    ]
  },
  {
    id: 'inflation', title: 'Prices are spiralling', text: 'Shops reprice twice a day. Wages can’t keep up.', extreme: true, weight: 0.5, needs: (w) => lastPrice(w) >= 2.6 || w.economy.lent >= 150,
    options: [
      { label: 'A new currency', what: 'Knock zeros off and start again.', effects: ['Prices −20%', 'Prosperity −4', 'Stability −1'], run: (w) => (prices(w, -20), meter(w, 'prosperity', -4, 'A currency reform'), meter(w, 'stability', -1, 'Savings were rewritten')) },
      { label: 'Raise the interest rate hard', what: 'Painful, but it works.', effects: ['Interest rate +3%', 'Prosperity −5', 'Prices −5%'], run: (w) => ((w.economy.rate = Math.min(15, w.economy.rate + 3)), prices(w, -5), meter(w, 'prosperity', -5, 'Interest rates soared')) },
      { label: 'Print more', what: 'Everyone feels richer for a week.', effects: ['Prices +10%', 'Prosperity +2', 'Stability −2'], run: (w) => (prices(w, 10), meter(w, 'prosperity', 2, 'More money printed'), meter(w, 'stability', -2, 'Runaway prices')) }
    ]
  },
  {
    id: 'mutiny', title: 'The Army mutinies', text: 'Two regiments have locked their officers in the barracks and want to talk to the government.', extreme: true, weight: 0.5, needs: (w) => has(w, 'army') && w.army.loyalty <= 3,
    options: [
      { label: 'Pay them off', what: 'Everything they ask, and a bonus.', effects: ['Treasury −80', 'Army loyalty +2'], run: (w) => (spend(w, 80, 'escrow', 'Mutiny settlement'), army(w, 2, 'The mutiny was bought off')) },
      { label: 'Let the General negotiate', what: 'They end it. They will remember who did.', effects: ['Army loyalty +1', 'A secret card about the General'], run: (w) => (army(w, 1, 'The General ended the mutiny'), card(w, holderOf(w, 'army'), 'The General settled the mutiny on private terms nobody else has seen.', 'The barracks', ['pm', 'office:army'])) },
      { label: 'Surround the barracks', what: 'Starve them out.', effects: ['Army loyalty −2', 'Stability −6'], run: (w) => (army(w, -2, 'Besieged by the government'), meter(w, 'stability', -6, 'Soldiers besieged in their barracks')) }
    ]
  },
  {
    id: 'famine', title: 'Famine in the countryside', text: 'Villages are running out of food. People are walking to the city.', extreme: true, weight: 0.4, house: true,
    options: [
      { label: 'Emergency rations', what: 'The state feeds everyone, whatever it costs.', effects: ['Treasury −70', 'Stability +3'], run: (w) => (spend(w, 70, 'nation:varnholm', 'Famine rations'), meter(w, 'stability', 3, 'The famine was fought')) },
      { label: 'Seize the grain stores', what: 'Take it from the merchants and share it out.', effects: ['Prosperity −5', 'Stability +1'], run: (w) => (meter(w, 'prosperity', -5, 'Grain stores were seized'), meter(w, 'stability', 1, 'Grain was shared out')) },
      { label: 'Do nothing', what: 'The market will sort it out.', effects: ['Stability −8', 'Prosperity −4'], run: (w) => (meter(w, 'stability', -8, 'Famine was ignored'), meter(w, 'prosperity', -4, 'Famine')) }
    ]
  },
  // ---------- consequences: only ever arrive because of an earlier choice ----------
  {
    id: 'varnholm_favour', title: 'Varnholm calls in the flood favour', text: 'They helped us after the flood. Now they want us to back them in a quarrel with Kessmark.', chainOnly: true,
    options: [
      { label: 'Back Varnholm', what: 'A debt honoured and an enemy made.', effects: ['Varnholm warms', 'Kessmark cools sharply'], run: (w) => (mood(w, 'varnholm', 1, 'We repaid the flood favour'), mood(w, 'kessmark', -2, 'We sided with Varnholm')) },
      { label: 'Pay them instead', what: 'Money settles it.', effects: ['Treasury −40'], run: (w) => spend(w, 40, 'nation:varnholm', 'Settling the flood favour') },
      { label: 'Refuse', what: 'We owe them nothing, we decide.', effects: ['Varnholm cools sharply', 'Stability −1'], run: (w) => (mood(w, 'varnholm', -2, 'We refused to repay them'), meter(w, 'stability', -1, 'We broke our word')) }
    ]
  },
  {
    id: 'orrin_favour', title: 'Orrin calls in the harbour favour', text: 'Their shipwrights rebuilt our harbour. Now they want our ships in a patrol off Kessmark’s coast.', chainOnly: true,
    options: [
      { label: 'Join the patrol', what: 'Allies keep their word.', effects: ['Orrin warms', 'Kessmark cools'], run: (w) => (mood(w, 'orrin', 1, 'We joined their patrol'), mood(w, 'kessmark', -1, 'Our ships off their coast')) },
      { label: 'Pay them instead', what: 'Money settles it.', effects: ['Treasury −30'], run: (w) => spend(w, 30, 'nation:orrin', 'Settling the harbour favour') },
      { label: 'Refuse', what: 'We owe them nothing, we decide.', effects: ['Orrin cools sharply'], run: (w) => mood(w, 'orrin', -2, 'We refused to repay them') }
    ]
  },
  {
    id: 'bread_riots', title: 'Bread riots', text: 'After the price rise, crowds have broken into bakeries across the city.', chainOnly: true,
    options: [
      { label: 'Subsidise bread', what: 'Cheap bread, paid for by the Treasury.', effects: ['Treasury −35', 'Stability +2'], run: (w) => (spend(w, 35, 'escrow', 'Bread subsidy'), meter(w, 'stability', 2, 'Bread was subsidised')) },
      { label: 'Ride it out', what: 'Hunger turns to anger, then to worse.', effects: ['Stability −5', 'Famine may follow'], run: (w) => meter(w, 'stability', -5, 'Bread riots'), then: { type: 'famine', days: 7 } }
    ]
  },
  {
    id: 'expenses_return', title: 'The expenses story is back', text: 'A paper has the original receipts, and the PM’s signature is on them.', chainOnly: true, needs: (w) => !!w.pm,
    options: [
      { label: 'Confess and apologise', what: 'Humiliating, but it ends here.', effects: ['PM approval −5', 'Stability +2'], run: (w) => (approve(w, w.pm, -5), meter(w, 'stability', 2, 'The PM apologised')) },
      { label: 'Blame a junior minister', what: 'Someone else takes the fall.', effects: ['PM approval −1', 'Stability −1', 'Another secret card'], run: (w) => (approve(w, w.pm, -1), meter(w, 'stability', -1, 'A scapegoat'), pmCard(w, 'The PM let a junior minister take the blame for the PM’s own expenses.', 'Cabinet Office')) },
      { label: 'Keep denying it', what: 'The receipts speak for themselves.', effects: ['Stability −4', 'PM approval −3'], run: (w) => (meter(w, 'stability', -4, 'The PM kept denying it'), approve(w, w.pm, -3)) }
    ]
  },
  {
    id: 'engine_offer', title: 'Kessmark wants the new engine', text: 'The inventor’s engine works. Kessmark offers a fortune for the design.', chainOnly: true,
    options: [
      { label: 'Sell it', what: 'A fortune now, a stronger rival later.', effects: ['Treasury +50 (new money)', 'Kessmark warms', 'Orrin cools'], run: (w) => (transfer(w, 'reserve', 'treasury', 50, 'Sale of the engine design'), mood(w, 'kessmark', 1, 'We sold them the engine'), mood(w, 'orrin', -1, 'We armed their rival')) },
      { label: 'Keep it at home', what: 'Our mills, our advantage.', effects: ['Prosperity +2'], run: (w) => meter(w, 'prosperity', 2, 'The engine stayed at home') }
    ]
  },
  {
    id: 'miners', title: 'The gold miners revolt', text: 'The state mine’s workers have taken over the pithead. They want a share of the gold.', chainOnly: true,
    options: [
      { label: 'Give them a share', what: 'A cut of the gold for every miner.', effects: ['Treasury −30', 'Stability +2'], run: (w) => (spend(w, 30, 'escrow', 'Miners’ share'), meter(w, 'stability', 2, 'The miners got their share')) },
      { label: 'Break the occupation', what: 'The mine is retaken by force.', effects: ['Stability −4', 'Army loyalty +1'], run: (w) => (meter(w, 'stability', -4, 'The mine was retaken'), army(w, 1, 'Retook the mine')) },
      { label: 'Wait', what: 'No gold comes out while they sit there.', effects: ['Prosperity −3'], run: (w) => meter(w, 'prosperity', -3, 'The gold mine stopped') }
    ]
  },
  {
    id: 'refugees_settle', title: 'The refugees have settled', text: 'The families we took in have opened workshops and market stalls. They ask to become citizens.', chainOnly: true,
    options: [
      { label: 'Grant them citizenship', what: 'New taxpayers, and an angry Kessmark.', effects: ['Prosperity +3', 'Kessmark cools'], run: (w) => (meter(w, 'prosperity', 3, 'New citizens'), mood(w, 'kessmark', -1, 'Their people became ours')) },
      { label: 'Keep them as guests', what: 'They stay, but uncertain.', effects: ['Prosperity +1'], run: (w) => meter(w, 'prosperity', 1, 'Guests at work') }
    ]
  },
  {
    id: 'spy_returns', title: 'The spy is back', text: 'The agent we handed back has been caught again, in the same building.', chainOnly: true,
    options: [
      { label: 'Expose the old deal', what: 'Tell the realm everything.', effects: ['PM approval −4', 'Stability +2', 'Kessmark cools sharply'], run: (w) => (approve(w, w.pm, -4), meter(w, 'stability', 2, 'The truth about the spy'), mood(w, 'kessmark', -2, 'Their spy exposed twice')) },
      { label: 'Swap again', what: 'Same deal, bigger price.', effects: ['Kessmark warms', 'Another secret card about the PM'], run: (w) => (mood(w, 'kessmark', 1, 'We returned their agent again'), pmCard(w, 'The PM handed the same spy back to Kessmark a second time.', 'Security Service')) },
      { label: 'Put them on trial now', what: 'Better late than never.', effects: ['Stability +1', 'Kessmark cools'], run: (w) => (meter(w, 'stability', 1, 'The spy on trial at last'), mood(w, 'kessmark', -1, 'Their agent on trial')) }
    ]
  },
  {
    id: 'pirates_return', title: 'The pirates want more', text: 'Last time we paid. This time they want double, or they start taking ships.', chainOnly: true,
    options: [
      { label: 'Pay double', what: 'They will be back again.', effects: ['Treasury −30', 'They’ll be back'], run: (w) => spend(w, 30, 'escrow', 'More payments at sea'), then: { type: 'pirates_return', days: 14 } },
      { label: 'Hunt them down', what: 'Hire Orrin’s navy and end it.', effects: ['Treasury −45', 'Orrin warms', 'Prosperity +1'], run: (w) => (spend(w, 45, 'nation:orrin', 'Pirate hunt'), mood(w, 'orrin', 1, 'We hunted the pirates together'), meter(w, 'prosperity', 1, 'The sea lanes are clear')) },
      { label: 'Refuse', what: 'Ships will be taken.', effects: ['Prosperity −5'], run: (w) => meter(w, 'prosperity', -5, 'Pirates took our ships') }
    ]
  },
  {
    id: 'blockade', title: 'Kessmark blockades the river', text: 'After we defied their ultimatum, Kessmark boats have closed the river mouth.', chainOnly: true, house: true,
    options: [
      { label: 'Run the blockade', what: 'Armed merchant ships force their way through.', effects: ['Treasury −40', 'Stability +2', 'Kessmark cools'], run: (w) => (spend(w, 40, 'escrow', 'Running the blockade'), meter(w, 'stability', 2, 'We broke the blockade'), mood(w, 'kessmark', -1, 'We ran their blockade')) },
      { label: 'Negotiate', what: 'Talks, and some face lost.', effects: ['Kessmark warms', 'Stability −2'], run: (w) => (mood(w, 'kessmark', 1, 'We came to talk'), meter(w, 'stability', -2, 'We negotiated under blockade')) },
      { label: 'Endure it', what: 'Trade by land, slowly.', effects: ['Prosperity −6'], run: (w) => meter(w, 'prosperity', -6, 'The river was blockaded') }
    ]
  },
  {
    id: 'north_vote', title: 'The north votes', text: 'Today the northern towns vote on leaving the realm.', chainOnly: true, house: true,
    options: [
      { label: 'Campaign hard to stay', what: 'Money and speeches. Usually enough.', effects: ['Treasury −40', 'Most likely: Stability +4', 'Otherwise: Stability −8, Prosperity −4'], run: (w) => (spend(w, 40, 'escrow', 'Campaign in the north'), chance(w, 0.7) ? meter(w, 'stability', 4, 'The north voted to stay') : (meter(w, 'stability', -8, 'The north voted to leave'), meter(w, 'prosperity', -4, 'The north is gone'))) },
      { label: 'Cancel the vote', what: 'Nobody will forget.', effects: ['Stability −6', 'PM approval −4'], run: (w) => (meter(w, 'stability', -6, 'The northern vote was cancelled'), approve(w, w.pm, -4)) },
      { label: 'Let the result stand, whatever it is', what: 'An even chance they go.', effects: ['Even chance: Stability +3', 'Otherwise: Prosperity −6, Stability −4'], run: (w) => (chance(w, 0.5) ? meter(w, 'stability', 3, 'The north voted to stay') : (meter(w, 'prosperity', -6, 'The north left'), meter(w, 'stability', -4, 'The north left'))) }
    ]
  }
  ,
  // ---------- under a regime: decided by its leader. Each trades legitimacy, money and the Army ----------
  {
    id: 'rg_mutiny', title: 'Mutiny in the barracks', text: 'A garrison has locked its officers out and wants to know who it is taking orders from.', needs: (w) => !!w.regime, chainOnly: true,
    options: [
      { label: 'Pay them off', what: 'Back pay, in cash, tonight.', effects: ['Treasury −40', 'Army loyalty +1'], run: (w) => (spend(w, 40, 'escrow', 'Paying off a mutiny'), army(w, 1, 'The regime paid up')) },
      { label: 'Shoot the ringleaders', what: 'Order is restored. People notice how.', effects: ['Legitimacy −2', 'Army loyalty −1', 'Stability −3'], run: (w) => (legit(w, -2, 'Shot its own soldiers'), army(w, -1, 'Ringleaders were shot'), meter(w, 'stability', -3, 'A mutiny was put down in blood')) },
      { label: 'Ignore it', what: 'They will get hungry eventually.', effects: ['Legitimacy −1', 'Army loyalty −2'], run: (w) => (legit(w, -1, 'Could not control its own barracks'), army(w, -2, 'A mutiny was left to fester')) }
    ]
  },
  {
    id: 'rg_ultimatum', title: 'The neighbours want a date', text: 'Three embassies deliver the same note: name the day of the election, or pay for the delay.', needs: (w) => !!w.regime, chainOnly: true,
    options: [
      { label: 'Name a date', what: 'An election within five days, on the record.', effects: ['Legitimacy +2', 'The regime must end within 5 days'], run: (w) => (legit(w, 2, 'Named a date for elections'), (w.regime.until = Math.min(w.regime.until || Infinity, w.now + 5 * DAY))) },
      { label: 'Pay them to be patient', what: 'It is a lot of patience.', effects: ['Treasury −50'], run: (w) => spend(w, 50, 'nation:sundmere', 'Bought patience abroad') },
      { label: 'Tell them to mind their own realm', what: 'It plays well at home. Abroad, less so.', effects: ['Legitimacy −1', 'Stability +1', 'Sundmere and Varnholm cool'], run: (w) => (legit(w, -1, 'Defied the neighbours'), meter(w, 'stability', 1, 'The regime stood up to the neighbours'), mood(w, 'sundmere', -1, 'The regime insulted them'), mood(w, 'varnholm', -1, 'The regime insulted them')) }
    ]
  },
  {
    id: 'rg_bankrun', title: 'A run on the banks', text: 'Nobody trusts a regime with their savings. The queues go round the block.', needs: (w) => !!w.regime, chainOnly: true,
    options: [
      { label: 'Guarantee every deposit', what: 'The Treasury stands behind the banks.', effects: ['Treasury −40', 'Prosperity +1'], run: (w) => (spend(w, 40, 'escrow', 'Guaranteeing deposits'), meter(w, 'prosperity', 1, 'Deposits were guaranteed')) },
      { label: 'Shut the banks for a week', what: 'No queue, no problem.', effects: ['Prosperity −5', 'Legitimacy −1'], run: (w) => (meter(w, 'prosperity', -5, 'The banks were shut'), legit(w, -1, 'Shut the banks')) },
      { label: 'Let them fall', what: 'The strong will survive.', effects: ['Prosperity −8', 'Legitimacy −2'], run: (w) => (meter(w, 'prosperity', -8, 'A banking panic'), legit(w, -2, 'Let the banks fall')) }
    ]
  },
  {
    id: 'rg_list', title: 'The list gets out', text: 'A clerk has copied the names of everyone the regime is holding, and why. It is on every wall.', needs: (w) => !!w.regime, chainOnly: true,
    options: [
      { label: 'Free them all', what: 'Open the cells and call it mercy.', effects: ['Every detainee released', 'Legitimacy +1'], run: (w) => (allCitizens(w).forEach((c: any) => c.detainedUntil > w.now && (c.detainedUntil = w.now)), legit(w, 1, 'Opened the cells')) },
      { label: 'Call it a forgery', what: 'Nobody believes you.', effects: ['Legitimacy −2'], run: (w) => legit(w, -2, 'Denied the list') },
      { label: 'Hunt the clerk', what: 'Soldiers go door to door.', effects: ['Legitimacy −1', 'Stability −3'], run: (w) => (legit(w, -1, 'Hunted a clerk'), meter(w, 'stability', -3, 'Door-to-door searches')) }
    ]
  },
  // ---------- after a regime falls: the provisional government's troubles ----------
  {
    id: 'aft_loyalists', title: 'Loyalists hold the barracks', text: 'Officers of the old regime have barricaded themselves in with the armoury and are waiting to see who blinks.', needs: (w) => !!w.transition, chainOnly: true,
    options: [
      { label: 'Storm it', what: 'It is over by morning.', effects: ['Army loyalty −1', 'Stability +3'], run: (w) => (army(w, -1, 'Soldiers fought soldiers'), meter(w, 'stability', 3, 'The barracks were retaken')) },
      { label: 'Offer them amnesty', what: 'They walk out, and so does everyone else who served the regime.', effects: ['No reckoning for anyone', 'Stability +1'], run: (w) => (!w.reckoning && (w.transition.amnesty = true), meter(w, 'stability', 1, 'The loyalists walked out')) },
      { label: 'Wait them out', what: 'They are not the ones running out of time.', effects: ['Stability −6', 'The old leader may claim the government'], run: (w) => {
        meter(w, 'stability', -6, 'An armed standoff');
        const t = w.transition, old = t.fallen.leader;
        if (w.citizens[old]?.active && !exiled(w, old) && !detained(w, old) && !t.claims[old] && t.leader !== old) (t.claims[old] = [old]), gazette(w, 'crisis', `${nm(w, old)} appears on the barracks steps and claims the government.`, '#/regime');
      } }
    ]
  },
  {
    id: 'aft_reprisals', title: 'Mobs hunt collaborators', text: 'Lists are going round of everyone who swore, served or took a medal. Windows are being broken.', needs: (w) => !!w.transition, chainOnly: true,
    options: [
      { label: 'Protect them', what: 'The law protects everyone, even them.', effects: ['Stability −2', 'Your approval −3'], run: (w) => (meter(w, 'stability', -2, 'Collaborators were protected'), approve(w, w.pm, -3)) },
      { label: 'People’s courts', what: 'Quick hearings, small fines, and it is done.', effects: ['Each collaborator fined up to 10 crowns', 'Stability −1'], run: (w) => (Object.keys(w.transition.fallen.collab).forEach((id) => bal(w, ca(id)) >= 1 && transfer(w, ca(id), 'treasury', Math.min(10, bal(w, ca(id))), 'Fined by a people’s court')), meter(w, 'stability', -1, 'People’s courts')) },
      { label: 'Look away', what: 'It will burn itself out.', effects: ['Collaborators’ approval −10', 'Stability −5'], run: (w) => (Object.keys(w.transition.fallen.collab).forEach((id) => approve(w, id, -10)), meter(w, 'stability', -5, 'Reprisals in the streets')) }
    ]
  },
  {
    id: 'aft_general', title: 'The General offers to keep order', text: 'Just until the election, the General says. The Army could run things. It would be tidier.', needs: (w) => !!w.transition && !!holderOf(w, 'army') && holderOf(w, 'army') !== w.transition.leader && !exiled(w, holderOf(w, 'army')!), chainOnly: true,
    options: [
      { label: 'Decline, politely', what: 'Thank the Army for its service.', effects: ['Army loyalty −1'], run: (w) => army(w, -1, 'Its offer was declined') },
      { label: 'Dismiss the General', what: 'Nobody who makes that offer should command soldiers.', effects: ['The post falls vacant', 'Army loyalty −2', 'Stability −2'], run: (w) => ((w.offices.army.holder = null), army(w, -2, 'Its General was dismissed'), meter(w, 'stability', -2, 'The General was dismissed')) },
      { label: 'Accept', what: 'The General takes charge. Just until the election.', effects: ['The General rules as a junta'], run: (w) => {
        const g = holderOf(w, 'army')!;
        gazette(w, 'crisis', `${nm(w, g)} accepts the invitation to keep order, and keeps rather more than that.`, '#/regime');
        takePower(w, { leader: g, council: [g], name: 'The Generals’ Peace', swift: true, legit: 6, backer: null, backers: [], type: 'junta' });
      } }
    ]
  },
  {
    id: 'aft_bankrun', title: 'Savers want their money now', text: 'Whatever comes next, people want their crowns under the mattress while it happens.', needs: (w) => !!w.transition, chainOnly: true,
    options: [
      { label: 'Guarantee every deposit', what: 'The Treasury stands behind the banks.', effects: ['Treasury −40'], run: (w) => spend(w, 40, 'escrow', 'Guaranteeing deposits') },
      { label: 'Limit withdrawals', what: 'A little each day.', effects: ['Prosperity −5'], run: (w) => meter(w, 'prosperity', -5, 'Withdrawals were limited') },
      { label: 'Do nothing', what: 'There is no government to do anything.', effects: ['Prosperity −8'], run: (w) => meter(w, 'prosperity', -8, 'A banking panic') }
    ]
  },
  {
    id: 'aft_border', title: 'Kessmark moves troops to the border', text: 'To restore order, they say, if we cannot manage it ourselves.', needs: (w) => !!w.transition, chainOnly: true,
    options: [
      { label: 'Accept peacekeepers', what: 'Foreign soldiers on our streets, and calm.', effects: ['Stability +3', 'Your approval −5', 'Kessmark warms'], run: (w) => (meter(w, 'stability', 3, 'Peacekeepers arrived'), approve(w, w.pm, -5), mood(w, 'kessmark', 1, 'We let their soldiers in')) },
      { label: 'Pay them to go home', what: 'Call it a goodwill payment.', effects: ['Treasury −50'], run: (w) => spend(w, 50, 'nation:kessmark', 'A goodwill payment') },
      { label: 'Warn them off', what: 'Whatever we are, we are not theirs.', effects: ['Stability −2', 'Kessmark cools'], run: (w) => (meter(w, 'stability', -2, 'A standoff at the border'), mood(w, 'kessmark', -1, 'We warned them off')) }
    ]
  },
  {
    id: 'aft_secession', title: 'The north declares independence', text: 'The market towns say they obeyed one government too many, and have elected their own.', needs: (w) => !!w.transition, chainOnly: true,
    options: [
      { label: 'Grant them autonomy', what: 'Their own council, their own taxes, our flag.', effects: ['Treasury −30', 'Stability +1'], run: (w) => (spend(w, 30, 'escrow', 'Settlement with the north'), meter(w, 'stability', 1, 'The north settled for autonomy')) },
      { label: 'Send the Army', what: 'If there is one, and if it will go.', effects: ['Army loyalty −1', 'Stability −2'], run: (w) => (army(w, -1, 'Sent against its own towns'), meter(w, 'stability', -2, 'Soldiers in the north')) },
      { label: 'Let them go', what: 'The realm is smaller this morning.', effects: ['Stability −8'], run: (w) => meter(w, 'stability', -8, 'The north broke away') }
    ]
  }
];

export const crisisById = (id: string) => CRISES.find((c) => c.id === id);

// ---------- the life of a crisis ----------
// spawn: a chosen type (RO, or a due consequence) or a weighted random pick that isn't one of the last five
export function spawnCrisis(w: W, type?: string, cause?: string, prev?: { id: Id; role: string }[]) {
  if (w.phase !== 'running') return type ? fail('Crises start once Parliament is running.') : undefined;
  if (Object.values(w.crises).some((c: any) => c.status === 'open')) return type ? fail('A crisis is already open. Let it be decided first.') : undefined;
  const fits = CRISES.filter((c) => !c.needs || c.needs(w));
  let t: Crisis | undefined;
  if (type) {
    t = fits.find((c) => c.id === type);
    if (!t) fail(CRISES.some((c) => c.id === type) ? 'That crisis does not fit the realm right now.' : 'No such crisis.');
  } else {
    const recent = Object.values(w.crises).sort((a: any, b: any) => b.at - a.at).slice(0, 5).map((c: any) => c.type);
    let pool = fits.filter((c) => !c.chainOnly && !recent.includes(c.id));
    if (!pool.length) pool = fits.filter((c) => !c.chainOnly);
    const total = pool.reduce((s, c) => s + (c.weight ?? 1), 0);
    let r = rand(w) * total;
    t = pool.find((c) => (r -= c.weight ?? 1) < 0) || pool[pool.length - 1];
  }
  const id = newId(w, 'cr');
  const house = !!t!.house && mps(w).length > 0;
  w.crises[id] = { id, type: t!.id, status: 'open', at: w.now, decideBy: w.now + (house ? 36 : 24) * HOUR, choice: null, house, votes: {}, speeches: [], cause: cause || null, pmAtStart: w.pm, cast: castFor(w, t!, prev), responses: {}, helpers: {}, bribes: {} };
  openMarket(w, 'crisis', id, `How will “${t!.title}” end?`, t!.options.map((o, i) => ({ key: String(i), label: o.label })), w.crises[id].decideBy);
  const cast = w.crises[id].cast;
  gazette(w, 'crisis', `${t!.extreme ? 'Emergency' : 'Crisis'}: ${t!.title}.${cause ? ` ${cause}` : ''}${cast.length ? ` Caught up in it: ${cast.map((x: any) => `${nm(w, x.id)} (${x.role})`).join(', ')}.` : ''} ${house ? 'The House has 36 hours to vote on a response.' : 'The Prime Minister has 24 hours to decide.'}`, '#/crisis/' + id);
  cast.forEach((x: any) => bump(w, x.id, 'crisesCaught'));
  // two extreme crises inside a week: the realm goes mad
  if (t!.extreme && Object.values(w.crises).some((x: any) => x.id !== id && crisisById(x.type)?.extreme && x.at > w.now - 7 * DAY) && !(w.conditions || []).some((x: any) => x.type === 'madness' && x.until > w.now)) cond(w, 'madness', 1);
  return id;
}

// the PM decides an ordinary crisis
export function decideCrisis(w: W, actor: Id, id: Id, choice: number) {
  const c = own(w.crises, id);
  if (!c || c.status !== 'open') fail('That crisis is over.');
  if (c.house) fail('The House decides this one. MPs vote on it.');
  if (!isPM(w, actor)) fail('Only the Prime Minister decides.');
  if (!(Number.isInteger(choice) && crisisById(c.type)!.options[choice])) fail('Pick a response.');
  settle(w, c, choice, 'pm', actor);
}

// MPs vote on a House crisis; a majority of all seats settles it at once
export function voteCrisis(w: W, actor: Id, id: Id, choice: number) {
  mustBeFree(w, actor);
  const c = own(w.crises, id);
  if (!c || c.status !== 'open') fail('That crisis is over.');
  if (!c.house) fail('The Prime Minister decides this one.');
  if (!isMP(w, actor)) fail('Only MPs vote on a crisis.');
  if (!(Number.isInteger(choice) && crisisById(c.type)!.options[choice])) fail('Pick a response.');
  if (c.votes[actor] === undefined) (earn(w, actor, 1, 'Voted on a crisis'), tick(w, actor, 'crisis'));
  c.votes[actor] = choice;
  const n = Object.values(c.votes).filter((v) => v === choice).length;
  if (n > w.config.seats / 2) settle(w, c, choice, 'house');
}

// the debate: MPs (and the PM) argue for an option while the crisis is open. Two speeches each, in the Gazette.
export function speakCrisis(w: W, actor: Id, id: Id, choice: number, text: string) {
  mustBeFree(w, actor);
  const c = own(w.crises, id);
  if (!c || c.status !== 'open') fail('That crisis is over.');
  if (!isMP(w, actor) && !isPM(w, actor)) fail('Only MPs and the PM speak on a crisis.');
  const t = crisisById(c.type)!;
  if (!(Number.isInteger(choice) && t.options[choice])) fail('Pick the response you are speaking for.');
  const said = String(text || '').trim().replace(/\s+/g, ' ');
  if (said.length < 8) fail('Say a little more.');
  if (said.length > 280) fail('Keep it under 280 characters. It goes in the Gazette.');
  c.speeches = c.speeches || [];
  if (c.speeches.filter((s: any) => s.by === actor).length >= lim(w, 'crisisSpeeches')) fail(`You have made your ${lim(w, 'crisisSpeeches') === 1 ? 'speech' : lim(w, 'crisisSpeeches') + ' speeches'} on this one.`);
  if (!c.speeches.some((s: any) => s.by === actor)) (earn(w, actor, 1, 'Spoke on a crisis'), tick(w, actor, 'crisis'));
  c.speeches.push({ id: newId(w, 'cs'), by: actor, choice, text: said, at: w.now });
  w.citizens[actor].stats.crisisSpeeches = (w.citizens[actor].stats.crisisSpeeches || 0) + 1;
  gazette(w, 'speech', `${nm(w, actor)} on ${t.title.charAt(0).toLowerCase() + t.title.slice(1)}, for “${t.options[choice].label}”: “${said}”`, '#/crisis/' + id);
}

// the deadline: a House crisis goes to the most-voted option (ties and silence fall to the last option);
// a PM crisis nobody decided gets the last option and costs Stability
export function timeoutCrisis(w: W, c: any) {
  const t = crisisById(c.type)!;
  const last = t.options.length - 1;
  if (c.house && Object.keys(c.votes).length) {
    const tally = t.options.map((_, i) => Object.values(c.votes).filter((v) => v === i).length);
    const top = Math.max(...tally);
    const tied = tally.map((n, i) => (n === top ? i : -1)).filter((i) => i >= 0);
    return settle(w, c, tied.length === 1 ? tied[0] : last, 'house');
  }
  settle(w, c, last, 'default');
}

function settle(w: W, c: any, choice: number, how: 'pm' | 'house' | 'default', actor?: Id) {
  const t = crisisById(c.type)!;
  const o = t.options[choice];
  c.status = 'decided';
  c.decidedAt = w.now;
  c.choice = choice;
  settleMarket(w, 'crisis', c.id, String(choice), how === 'pm' && actor ? [{ id: actor, did: 'chose it as Prime Minister' }] : how === 'house' ? Object.keys(c.votes).filter((m) => c.votes[m] === choice).map((id) => ({ id, did: 'voted for it in the House' })) : []);
  c.by = actor || null;
  c.how = how;
  let r: any;
  try {
    r = o.run(w, c);
  } catch {}
  settleBribes(w, c, choice, how, actor);
  settleCast(w, c, choice === t.options.length - 1);
  if (how === 'pm') earn(w, actor!, 3, 'Handled a crisis');
  // for ambitions: MPs on the winning side, and a PM who is still standing afterwards
  if (how === 'house') Object.entries(c.votes).forEach(([m, v]) => v === choice && w.citizens[m] && (w.citizens[m].stats.crisisWins = (w.citizens[m].stats.crisisWins || 0) + 1));
  if (c.pmAtStart && w.pm === c.pmAtStart && w.citizens[w.pm]) w.citizens[w.pm].stats.crisesSurvived = (w.citizens[w.pm].stats.crisesSurvived || 0) + 1;
  if (how === 'default') meter(w, 'stability', -2, 'Nobody handled the crisis');
  const who = how === 'pm' ? 'the PM chose' : how === 'house' ? 'the House voted for' : 'nobody decided, so by default:';
  gazette(w, 'crisis', `${t.title}: ${who} "${o.label}".`, '#/crisis/' + c.id);
  // consequences: queue the follow-up unless the gamble didn't happen
  if (o.then && r !== false) {
    w.crisisQueue = w.crisisQueue || [];
    w.crisisQueue.push({ type: o.then.type, at: w.now + o.then.days * DAY, cast: c.cast || [], cause: `This follows "${o.label}" in week ${weekNo(w)}, after ${t.title.charAt(0).toLowerCase() + t.title.slice(1)}.` });
  }
}

// a queued consequence comes due: it lands now, or a day later if another crisis is still open
export function fireQueued(w: W, q: any) {
  const def = crisisById(q.type);
  if (w.phase !== 'running' || !def || (def.needs && !def.needs(w))) {
    w.crisisQueue = w.crisisQueue.filter((x: any) => x !== q);
    return;
  }
  if (Object.values(w.crises).some((c: any) => c.status === 'open')) {
    q.at = w.now + DAY;
    return;
  }
  w.crisisQueue = w.crisisQueue.filter((x: any) => x !== q);
  spawnCrisis(w, q.type, q.cause, q.cast);
}


// ================= Caught up in it: every crisis pulls in named players =================
// Who: picked when the crisis starts, from the crisis's own cast() or from what its title is about. Each can make one move
// while it is open (deny, apologise, blame someone, or quietly cash in); what that move costs them is settled at the end.
// Anyone can give to the relief fund. Cash-ins are private until they come out.
export const MOVES: Record<string, { label: string; what: string }> = {
  deny: { label: 'Deny everything', what: 'It may hold. If it comes out, it costs you more.' },
  apologise: { label: 'Apologise', what: 'Approval −1 now; the public usually forgives (+2 at the end).' },
  blame: { label: 'Blame someone else', what: 'They lose 2 approval now. It can backfire on you.' },
  cashin: { label: 'Quietly cash in', what: '10 crowns now, in secret. Even odds it comes out: a 15-crown fine and −3 approval.' }
};
const freeCitizens = (w: W) => allCitizens(w).filter((c: any) => !c.bot && !c.suspended && !exiled(w, c.id) && !detained(w, c.id)).map((c: any) => c.id as Id);
function pool(w: W, kind: string): Id[] {
  const free = freeCitizens(w);
  const pick = (ids: (Id | null | undefined)[]) => ids.filter((id): id is Id => !!id && free.includes(id));
  const by = (ids: Id[]) => (ids.length ? ids : free);
  if (kind === 'minister') return by(pick(ministers(w)));
  if (kind === 'mp') return by(pick(mps(w)));
  if (kind === 'rich') return by(pick(richest(w, 4)));
  if (kind === 'poor') return by(pick(poorest(w, 5)));
  if (kind === 'monarch') return by(pick([w.hos.holder]));
  return free;
}
// what a crisis is about, from its title: who would really be caught up in it
const ROLE_RULES: [RegExp, string, string][] = [
  [/expenses|scandal|whistle|procurement|donor|bribe|corrupt|forg|banker|leak/i, 'minister', 'accused'],
  [/strike|walk out|teachers|doctors|unions|miners|back pay/i, 'any', 'leading the walkout'],
  [/flood|fire|quake|storm|wildfire|heat|drought|rains|harvest|famine|bridge|fever|cholera|plague|epidemic/i, 'poor', 'lost everything'],
  [/boom|bubble|crash|bank|oil|gold|rail|machine|pension|rent|tax|crown|inflation|debt|lottery/i, 'rich', 'with the most money at stake'],
  [/royal|wedding|jewel|heir|monarch|king|queen/i, 'any', 'the royal favourite'],
  [/spy|envoy|embassy|border|ultimatum|pirate|smuggl|refugee|exodus|kessmark|varnholm|orrin|sundmere|tessaly|blockade/i, 'any', 'caught in the middle'],
  [/riot|protest|mob|storm|prison|mutiny|attempt|secession|north|cult/i, 'any', 'blamed for stirring it up']
];
export function castFor(w: W, t: Crisis, prev?: { id: Id; role: string }[]): { id: Id; role: string }[] {
  if (t.cast) return t.cast(w, (prev || []).filter((x) => w.citizens[x.id]?.active)).filter((x) => x && x.id && w.citizens[x.id]);
  const [, kind, role] = ROLE_RULES.find(([re]) => re.test(t.title + ' ' + t.text)) || [null, 'any', 'at the centre of it'];
  const p = pool(w, kind);
  if (!p.length) return [];
  const out = [{ id: shuffle(w, p)[0], role }];
  // a scandal has someone who blew the whistle too
  if (kind === 'minister') {
    const rest = freeCitizens(w).filter((id) => id !== out[0].id);
    if (rest.length) out.push({ id: shuffle(w, rest)[0], role: 'who blew the whistle' });
  }
  return out;
}
const castOf = (c: any, n: number): Id | undefined => c?.cast?.[n]?.id;

export function respond(w: W, actor: Id, id: unknown, move: unknown, target: unknown) {
  const c = own(w.crises, id);
  if (!c || c.status !== 'open') fail('That crisis is over.');
  if (!(c.cast || []).some((x: any) => x.id === actor)) fail('You are not caught up in this one.');
  mustBeFree(w, actor);
  if (c.responses[actor]) fail('You have already made your move.');
  const m = own(MOVES, move) ? String(move) : fail('Pick a move.');
  const t = crisisById(c.type)!;
  if (m === 'blame') {
    const who = String(target || '');
    if (!w.citizens[who]?.active || who === actor) fail('Pick someone else to blame.');
    // revenge: blaming someone who blamed you before carries no risk
    const revenge = (w.grudges?.[actor]?.[who] || 0) > 0;
    if (revenge) w.grudges[actor][who] -= 1;
    c.responses[actor] = { move: m, target: who, at: w.now, ...(revenge ? { revenge: true } : {}) };
    w.grudges ??= {};
    w.grudges[who] ??= {};
    w.grudges[who][actor] = (w.grudges[who][actor] || 0) + 1;
    feud(w, actor, who);
    approve(w, who, -2);
    gazette(w, 'crisis', `${nm(w, actor)} blames ${nm(w, who)} for ${t.title.charAt(0).toLowerCase() + t.title.slice(1)}.`, '#/crisis/' + c.id);
    return;
  }
  c.responses[actor] = { move: m, at: w.now };
  if (m === 'cashin') return void transfer(w, 'treasury', ca(actor), 10, 'A quiet arrangement');
  if (m === 'apologise') approve(w, actor, -1);
  gazette(w, 'crisis', m === 'deny' ? `${nm(w, actor)} denies everything over ${t.title.charAt(0).toLowerCase() + t.title.slice(1)}.` : `${nm(w, actor)} apologises over ${t.title.charAt(0).toLowerCase() + t.title.slice(1)}.`, '#/crisis/' + c.id);
}
export function help(w: W, actor: Id, id: unknown, amount: unknown) {
  const c = own(w.crises, id);
  if (!c || c.status !== 'open') fail('That crisis is over.');
  mustBeFree(w, actor);
  const most = lim(w, 'crisisGift');
  const n = int(amount, 1, most, `gift (1–${most} crowns)`);
  if (bal(w, ca(actor)) < n) fail('You do not have that many crowns.');
  if ((c.helpers[actor] || 0) + n > most) fail(`You can give up to ${most} to each crisis.`);
  transfer(w, ca(actor), 'treasury', n, 'Crisis relief fund');
  const before = Math.floor((c.helpers[actor] || 0) / 5);
  c.helpers[actor] = (c.helpers[actor] || 0) + n;
  const up = Math.min(3, Math.floor(c.helpers[actor] / 5)) - Math.min(3, before);
  if (up > 0) approve(w, actor, up);
  bump(w, actor, 'crisisGifts', n);
}
// the end of a crisis: what each move cost, a stamp for everyone caught up in it, and thanks to the biggest giver
function settleCast(w: W, c: any, leftHanging: boolean) {
  const t = crisisById(c.type)!;
  const lines: string[] = [];
  (c.cast || []).forEach((x: any) => {
    if (!w.citizens[x.id]) return;
    const r = c.responses?.[x.id];
    stamp(w, x.id, 'Caught up in a crisis', t.title, 'ink');
    if (r?.move === 'deny') {
      if (chance(w, 0.4)) (approve(w, x.id, -4), (r.exposed = true), lines.push(`${nm(w, x.id)}’s denial fell apart (approval −4)`), stamp(w, x.id, 'Caught lying', t.title, 'ink'));
      else approve(w, x.id, 1);
    } else if (r?.move === 'apologise') (approve(w, x.id, 2), meter(w, 'stability', 1, `${nm(w, x.id)} said sorry`));
    else if (r?.move === 'blame') {
      if (!r.revenge && chance(w, 0.3)) (approve(w, x.id, -3), (r.backfired = true), lines.push(`blaming ${nm(w, r.target)} backfired on ${nm(w, x.id)} (approval −3)`));
    } else if (r?.move === 'cashin') {
      if (chance(w, 0.5)) {
        r.exposed = true;
        levy(w, [x.id], 15, 'treasury', 'Fined for cashing in on a crisis');
        approve(w, x.id, -3);
        lines.push(`${nm(w, x.id)} was caught cashing in (fined 15, approval −3)`);
      }
    } else approve(w, x.id, leftHanging ? -1 : 1);
  });
  (c.cast || []).forEach((x: any) => record(w, c, x, leftHanging));
  const top = Object.entries(c.helpers || {}).sort((a: any, b: any) => b[1] - a[1])[0] as [string, number] | undefined;
  if (top) (lines.push(`${nm(w, top[0])} gave most to the relief fund (${top[1]})`), stamp(w, top[0], 'Crisis benefactor', t.title, 'good'));
  if (lines.length) gazette(w, 'crisis', `After ${t.title.charAt(0).toLowerCase() + t.title.slice(1)}: ${lines.join('; ')}.`, '#/crisis/' + c.id);
}


// ---------- grudges and feuds: who blamed whom ----------
// w.grudges[victim][blamer] = how many times; a grudge lets the victim blame back once with no risk.
// Two blames between the same pair, either way, is a feud: both passports say so.
function feud(w: W, a: Id, b: Id) {
  const n = (w.grudges?.[a]?.[b] || 0) + (w.grudges?.[b]?.[a] || 0) + ((w.feuds || {})[[a, b].sort().join(':')]?.n || 0);
  w.feuds ??= {};
  const k = [a, b].sort().join(':');
  const f = (w.feuds[k] ??= { n: 0, stamped: false });
  f.n += 1;
  if (!f.stamped && (f.n >= 2 || n >= 2)) {
    f.stamped = true;
    stamp(w, a, 'Feud', `with ${nm(w, b)}`, 'ink');
    stamp(w, b, 'Feud', `with ${nm(w, a)}`, 'ink');
    gazette(w, 'crisis', `A feud: ${nm(w, a)} and ${nm(w, b)} keep blaming each other.`, '#/crises');
  }
}
export const grudgeAgainst = (w: W, me: Id) => Object.entries(w.grudges?.[me] || {}).filter(([, n]) => (n as number) > 0).map(([id]) => id);

// ---------- the crisis record: every crisis a citizen was caught up in, and a reputation from how they handled it ----------
function record(w: W, c: any, x: any, leftHanging: boolean) {
  const p = w.citizens[x.id];
  if (!p) return;
  const r = c.responses?.[x.id];
  const t = crisisById(c.type)!;
  let d = 0, outcome = '';
  if (!r) (d = leftHanging ? 0 : 1), (outcome = leftHanging ? 'said nothing, and it went badly' : 'kept quiet; it was dealt with');
  else if (r.move === 'apologise') (d = 1), (outcome = 'apologised, and was forgiven');
  else if (r.move === 'deny') (d = r.exposed ? -2 : 1), (outcome = r.exposed ? 'denied it, and was found out' : 'denied it, and got away with it');
  else if (r.move === 'blame') (d = r.backfired ? -1 : 0), (outcome = `blamed ${nm(w, r.target)}${r.revenge ? ' (revenge)' : ''}${r.backfired ? ', and it backfired' : ''}`);
  else if (r.move === 'cashin') (d = r.exposed ? -3 : 0), (outcome = r.exposed ? 'cashed in, and was caught' : 'quietly cashed in');
  const b = c.bribes?.[x.id];
  if (b?.exposed) (d -= 3), (outcome += '; a bribe came out');
  p.crisisRep = (p.crisisRep || 0) + d;
  p.crisisLog ??= [];
  p.crisisLog.unshift({ at: w.now, crisis: c.id, title: t.title, role: x.role, move: r?.move || 'none', secret: (r?.move === 'cashin' && !r.exposed) || (!!b && !b.exposed), outcome, d });
  if (p.crisisLog.length > 20) p.crisisLog.length = 20;
}

// ---------- bribing the decider: someone caught up offers the PM crowns for an option, in private ----------
export function bribe(w: W, actor: Id, id: unknown, choice: unknown, amount: unknown) {
  const c = own(w.crises, id);
  if (!c || c.status !== 'open') fail('That crisis is over.');
  if (c.house) fail('MPs decide this one. There is nobody to bribe.');
  if (!(c.cast || []).some((x: any) => x.id === actor)) fail('Only someone caught up in it has a reason to.');
  if (actor === w.pm) fail('You are the one deciding.');
  mustBeFree(w, actor);
  const t = crisisById(c.type)!;
  const i = Number(choice);
  if (!(Number.isInteger(i) && t.options[i])) fail('Pick a response.');
  const n = int(amount, 5, lim(w, 'crisisBribeMax'), `offer (5–${lim(w, 'crisisBribeMax')} crowns)`);
  if (bal(w, ca(actor)) < n) fail('You do not have that many crowns.');
  c.bribes ??= {};
  c.bribes[actor] = { choice: i, amount: n, at: w.now };
}
// paid only if the PM chose that option; a third of the time it comes out
function settleBribes(w: W, c: any, choice: number, how: string, decider?: Id) {
  const t = crisisById(c.type)!;
  Object.entries(c.bribes || {}).forEach(([by, b]: [string, any]) => {
    if (how !== 'pm' || !decider || b.choice !== choice || !w.citizens[by] || by === decider) return;
    const n = Math.min(b.amount, bal(w, ca(by)));
    if (n <= 0) return;
    transfer(w, ca(by), ca(decider), n, 'A private arrangement');
    b.paid = n;
    if (chance(w, 0.35)) {
      b.exposed = true;
      approve(w, decider, -4);
      approve(w, by, -3);
      stamp(w, decider, 'Took a bribe', t.title, 'ink');
      stamp(w, by, 'Paid a bribe', t.title, 'ink');
      gazette(w, 'crisis', `Exposed: ${nm(w, by)} paid the Prime Minister ${n} crowns to choose “${t.options[choice].label}”.`, '#/crisis/' + c.id);
    }
  });
}
