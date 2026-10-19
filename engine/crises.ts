// Crises: one lands at each payday, when a chained consequence comes due, or when the Returning Officer starts one.
// - Most are decided by the Prime Minister within 24 hours. `house: true` ones go to a vote of MPs (36 hours).
// - If nobody decides, the LAST option runs, so make the last option the "do nothing" one.
// - `then: { type, days }` on an option queues a follow-up crisis: choices come back to bite. If `run` returns
//   exactly `false`, the follow-up is skipped (for gambles that didn't pay off).
// - `chainOnly` crises never appear at random; `weight` makes a crisis rarer (default 1); `needs` limits where it fits.
// `effects` is what players see before choosing, so keep it honest and in step with `run`.
// Money only moves through transfer(), so the ledger balances.
import { W, Id, DAY, HOUR, clamp, fail, newId, transfer, meter, approve, earn, addCard, allCitizens, holderOf, chance, rand, ca, bal, gazette, isMP, isPM, mps, nm, mustBeFree, weekNo } from './core';
import { armyLoyalty } from './foreign';
import { callGeneralElection } from './politics';

type Option = { label: string; what: string; effects: string[]; run: (w: W) => any; then?: { type: string; days: number } };
export type Crisis = { id: string; title: string; text: string; needs?: (w: W) => boolean; options: Option[]; house?: boolean; chainOnly?: boolean; weight?: number; extreme?: boolean };

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
  if (Object.values(w.elections).some((e: any) => e.kind === 'general' && e.status === 'open')) return;
  gazette(w, 'election', 'A snap general election is called.', '#/elections');
  callGeneralElection(w, w.now + 2 * DAY);
};
// a state of emergency: Parliament is suspended and the PM rules for 3 days, then a Restoration election
const emergency = (w: W) => {
  if (!w.pm || w.martial) return;
  w.martial = { leader: w.pm, plotters: [], until: w.now + 3 * DAY, emergency: true };
  gazette(w, 'government', `A state of emergency. Parliament is suspended and ${nm(w, w.pm)} rules by decree for 3 days, then the realm votes.`, '#/cabinet');
};
// the head of state's time is up: a new one is chosen as the constitution says
const hosGoes = (w: W) => w.hos.holder && (w.hos.until = w.now + HOUR);
const card = (w: W, about: Id | null, title: string, from: string, viewers: string[]) => addCard(w, { title, about, from, level: 'restricted', viewers });

export const CRISES: Crisis[] = [
  // ---------- home ----------
  {
    id: 'flood', title: 'The river has flooded', text: 'Homes on the east bank are under water.',
    options: [
      { label: 'Pay for repairs', what: 'The Treasury rebuilds the homes.', effects: ['Treasury −60', 'Stability +3'], run: (w) => (spend(w, 60, 'nation:varnholm', 'Flood repairs'), meter(w, 'stability', 3, 'Flood homes rebuilt')) },
      { label: 'Ask Varnholm for help', what: 'They send timber and workers, and will expect a favour.', effects: ['Free', 'Varnholm will call in the favour'], run: (w) => owe(w, 'varnholm', 'We owe them for flood help'), then: { type: 'varnholm_favour', days: 14 } },
      { label: 'Do nothing', what: 'Owners rebuild at their own cost.', effects: ['Stability −6'], run: (w) => meter(w, 'stability', -6, 'The flood was ignored') }
    ]
  },
  {
    id: 'harvest', title: 'The harvest has failed', text: 'Bread will be scarce this week.',
    options: [
      { label: 'Import grain', what: 'The Treasury buys grain abroad.', effects: ['Treasury −40', 'Stability +2'], run: (w) => (spend(w, 40, 'nation:sundmere', 'Emergency grain'), meter(w, 'stability', 2, 'Grain was imported')) },
      { label: 'Let prices rise', what: 'Bread gets dearer for a while. The poor may not stand for it.', effects: ['Prices +5%', 'Prosperity −4', 'Bread riots may follow'], run: (w) => (prices(w, 5), meter(w, 'prosperity', -4, 'Food prices jumped')), then: { type: 'bread_riots', days: 7 } }
    ]
  },
  {
    id: 'fever', title: 'A fever spreads in the capital', text: 'The hospitals are filling and people are scared.',
    options: [
      { label: 'Open free clinics', what: 'The Treasury pays for doctors and medicine.', effects: ['Treasury −50', 'Stability +3'], run: (w) => (spend(w, 50, 'escrow', 'Free clinics'), meter(w, 'stability', 3, 'Free clinics opened')) },
      { label: 'Close the markets', what: 'The fever slows, and so does trade.', effects: ['Prosperity −5', 'Stability +1'], run: (w) => (meter(w, 'prosperity', -5, 'Markets closed for the fever'), meter(w, 'stability', 1, 'The fever was contained')) },
      { label: 'Carry on as normal', what: 'Business continues; the sick fend for themselves.', effects: ['Stability −5'], run: (w) => meter(w, 'stability', -5, 'The fever was ignored') }
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
    id: 'bridge', title: 'The old bridge collapses', text: 'The only road to the market towns is cut.',
    options: [
      { label: 'Build a new bridge', what: 'Expensive, but it lasts a century.', effects: ['Treasury −50', 'Prosperity +2'], run: (w) => (spend(w, 50, 'escrow', 'The new bridge'), meter(w, 'prosperity', 2, 'A new bridge opened')) },
      { label: 'Run a ferry', what: 'Cheap and slow.', effects: ['Treasury −10', 'Prosperity −2'], run: (w) => (spend(w, 10, 'escrow', 'Ferry service'), meter(w, 'prosperity', -2, 'Trade crawls by ferry')) },
      { label: 'Leave it', what: 'The market towns are cut off.', effects: ['Prosperity −5'], run: (w) => meter(w, 'prosperity', -5, 'The market towns were cut off') }
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
      { label: 'Give them a raise', what: 'Back to work by Monday.', effects: ['Treasury −40', 'Stability +2'], run: (w) => (spend(w, 40, 'escrow', 'Teachers’ pay rise'), meter(w, 'stability', 2, 'The teachers went back')) },
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
    id: 'comet', title: 'A comet over the realm', text: 'Crowds gather every night. Some call it an omen.',
    options: [
      { label: 'Declare a holiday', what: 'A night off to watch the sky.', effects: ['Prosperity −2', 'Stability +2', 'Everyone +1 Influence'], run: (w) => (meter(w, 'prosperity', -2, 'A comet holiday'), meter(w, 'stability', 2, 'A comet holiday'), everyone(w, 1, 'Watched the comet')) },
      { label: 'Carry on', what: 'It is only a rock.', effects: ['Nothing happens'], run: () => {} }
    ]
  },
  {
    id: 'inventor', title: 'An inventor wants funding', text: 'She says her engine will double the mills’ output. She might be right.',
    options: [
      { label: 'Fund her', what: 'A gamble: it works or it doesn’t. If it works, others will want it.', effects: ['Treasury −30', 'Even chance: Prosperity +6'], run: (w) => (spend(w, 30, 'escrow', 'Funding an inventor'), chance(w, 0.5) ? (meter(w, 'prosperity', 6, 'The new engine worked'), true) : false), then: { type: 'engine_offer', days: 7 } },
      { label: 'Send her to the banks', what: 'Let private money take the risk.', effects: ['Nothing now'], run: () => {} }
    ]
  },
  {
    id: 'gold', house: true, title: 'Gold in the hills', text: 'Prospectors have struck a seam. Everyone wants a share.',
    options: [
      { label: 'Nationalise the mine', what: 'The Reserve mints the gold into the Treasury. Kessmark is jealous, and the miners want their cut.', effects: ['Treasury +60', 'Prices +3%', 'Kessmark cools', 'The miners may revolt'], run: (w) => (transfer(w, 'reserve', 'treasury', 60, 'Gold from the state mine'), prices(w, 3), mood(w, 'kessmark', -1, 'Jealous of our gold')), then: { type: 'miners', days: 7 } },
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
    id: 'wedding', title: 'A royal wedding', text: 'The palace wants a celebration fit for the realm.', needs: monarchy,
    options: [
      { label: 'A public holiday', what: 'Bunting everywhere, paid by the Treasury.', effects: ['Treasury −25', 'Stability +4', 'Prosperity −1'], run: (w) => (spend(w, 25, 'escrow', 'Royal wedding'), meter(w, 'stability', 4, 'A royal wedding'), meter(w, 'prosperity', -1, 'A day off for the wedding'), approve(w, w.hos.holder, 3)) },
      { label: 'A private ceremony', what: 'Modest. Some feel snubbed.', effects: ['Stability −1'], run: (w) => meter(w, 'stability', -1, 'A quiet royal wedding') }
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

];

export const crisisById = (id: string) => CRISES.find((c) => c.id === id);

// ---------- the life of a crisis ----------
// spawn: a chosen type (RO, or a due consequence) or a weighted random pick that isn't one of the last five
export function spawnCrisis(w: W, type?: string, cause?: string) {
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
  w.crises[id] = { id, type: t!.id, status: 'open', at: w.now, decideBy: w.now + (house ? 36 : 24) * HOUR, choice: null, house, votes: {}, cause: cause || null };
  gazette(w, 'crisis', `${t!.extreme ? 'Emergency' : 'Crisis'}: ${t!.title}.${cause ? ` ${cause}` : ''} ${house ? 'The House has 36 hours to vote on a response.' : 'The Prime Minister has 24 hours to decide.'}`, '#/crisis/' + id);
  return id;
}

// the PM decides an ordinary crisis
export function decideCrisis(w: W, actor: Id, id: Id, choice: number) {
  const c = w.crises[id];
  if (!c || c.status !== 'open') fail('That crisis is over.');
  if (c.house) fail('The House decides this one. MPs vote on it.');
  if (!isPM(w, actor)) fail('Only the Prime Minister decides.');
  if (!crisisById(c.type)!.options[choice]) fail('Pick a response.');
  settle(w, c, choice, 'pm', actor);
}

// MPs vote on a House crisis; a majority of all seats settles it at once
export function voteCrisis(w: W, actor: Id, id: Id, choice: number) {
  mustBeFree(w, actor);
  const c = w.crises[id];
  if (!c || c.status !== 'open') fail('That crisis is over.');
  if (!c.house) fail('The Prime Minister decides this one.');
  if (!isMP(w, actor)) fail('Only MPs vote on a crisis.');
  if (!(Number.isInteger(choice) && crisisById(c.type)!.options[choice])) fail('Pick a response.');
  if (c.votes[actor] === undefined) earn(w, actor, 1, 'Voted on a crisis');
  c.votes[actor] = choice;
  const n = Object.values(c.votes).filter((v) => v === choice).length;
  if (n > w.config.seats / 2) settle(w, c, choice, 'house');
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
  c.choice = choice;
  c.by = actor || null;
  c.how = how;
  let r: any;
  try {
    r = o.run(w);
  } catch {}
  if (how === 'pm') earn(w, actor!, 3, 'Handled a crisis');
  if (how === 'default') meter(w, 'stability', -2, 'Nobody handled the crisis');
  const who = how === 'pm' ? 'the PM chose' : how === 'house' ? 'the House voted for' : 'nobody decided, so by default:';
  gazette(w, 'crisis', `${t.title}: ${who} "${o.label}".`, '#/crisis/' + c.id);
  // consequences: queue the follow-up unless the gamble didn't happen
  if (o.then && r !== false) {
    w.crisisQueue = w.crisisQueue || [];
    w.crisisQueue.push({ type: o.then.type, at: w.now + o.then.days * DAY, cause: `This follows "${o.label}" in week ${weekNo(w)}, after ${t.title.charAt(0).toLowerCase() + t.title.slice(1)}.` });
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
  spawnCrisis(w, q.type, q.cause);
}
