// Crises: one lands at each payday (or when the Returning Officer starts one). The Prime Minister has 24 hours to
// pick an option; if nobody does, the LAST option runs, so make the last option the "do nothing" one.
// `effects` is what players are shown before choosing, so keep it honest and in step with `run`.
// `needs` limits a crisis to realms where it makes sense. Money only moves through transfer(), so the ledger balances.
import { W, clamp, transfer, meter, approve, earn, addCard, allCitizens, holderOf, chance, ca, bal } from './core';
import { armyLoyalty } from './foreign';

type Option = { label: string; what: string; effects: string[]; run: (w: W) => void };
export type Crisis = { id: string; title: string; text: string; needs?: (w: W) => boolean; options: Option[] };

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

export const CRISES: Crisis[] = [
  // ---------- home ----------
  {
    id: 'flood', title: 'The river has flooded', text: 'Homes on the east bank are under water.',
    options: [
      { label: 'Pay for repairs', what: 'The Treasury rebuilds the homes.', effects: ['Treasury −60', 'Stability +3'], run: (w) => (spend(w, 60, 'nation:varnholm', 'Flood repairs'), meter(w, 'stability', 3, 'Flood homes rebuilt')) },
      { label: 'Ask Varnholm for help', what: 'They send timber and workers, and will expect a favour.', effects: ['Free', 'Varnholm remembers'], run: (w) => owe(w, 'varnholm', 'We owe them for flood help') },
      { label: 'Do nothing', what: 'Owners rebuild at their own cost.', effects: ['Stability −6'], run: (w) => meter(w, 'stability', -6, 'The flood was ignored') }
    ]
  },
  {
    id: 'harvest', title: 'The harvest has failed', text: 'Bread will be scarce this week.',
    options: [
      { label: 'Import grain', what: 'The Treasury buys grain abroad.', effects: ['Treasury −40', 'Stability +2'], run: (w) => (spend(w, 40, 'nation:sundmere', 'Emergency grain'), meter(w, 'stability', 2, 'Grain was imported')) },
      { label: 'Let prices rise', what: 'Bread gets dearer for a while.', effects: ['Prices +5%', 'Prosperity −4'], run: (w) => (prices(w, 5), meter(w, 'prosperity', -4, 'Food prices jumped')) }
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
      { label: 'Wait them out', what: 'Parents take time off to mind the children.', effects: ['Prosperity −2', 'Stability −2'], run: (w) => (meter(w, 'prosperity', -2, 'Parents kept home'), meter(w, 'stability', -2, 'A long school strike')) }
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
      { label: 'Ignore them', what: 'They will go home eventually.', effects: ['Stability −4'], run: (w) => meter(w, 'stability', -4, 'The protests were ignored') }
    ]
  },
  {
    id: 'expenses', title: 'A minister’s expenses leak', text: 'Receipts for a very expensive dinner are going round the city.', needs: (w) => !!w.pm,
    options: [
      { label: 'Publish everyone’s expenses', what: 'Total openness. Embarrassing for the whole government.', effects: ['PM approval −3', 'Stability +2'], run: (w) => (approve(w, w.pm, -3), meter(w, 'stability', 2, 'Expenses published in full')) },
      { label: 'Make the minister repay it', what: 'A neat ending, if nobody digs further.', effects: ['Stability +1'], run: (w) => meter(w, 'stability', 1, 'The money was repaid') },
      { label: 'Say it was legitimate', what: 'Stonewall, and keep the truth on file.', effects: ['A secret card about the PM', 'Stability −1'], run: (w) => (pmCard(w, 'The PM defended a dinner that was never official business.', 'Cabinet Office'), meter(w, 'stability', -1, 'The government stonewalled')) }
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
      { label: 'Fund her', what: 'A gamble: it works or it doesn’t.', effects: ['Treasury −30', 'Even chance: Prosperity +6'], run: (w) => (spend(w, 30, 'escrow', 'Funding an inventor'), chance(w, 0.5) && meter(w, 'prosperity', 6, 'The new engine worked')) },
      { label: 'Send her to the banks', what: 'Let private money take the risk.', effects: ['Nothing now'], run: () => {} }
    ]
  },
  {
    id: 'gold', title: 'Gold in the hills', text: 'Prospectors have struck a seam. Everyone wants a share.',
    options: [
      { label: 'Nationalise the mine', what: 'The Reserve mints the gold into the Treasury. Kessmark is jealous.', effects: ['Treasury +60', 'Prices +3%', 'Kessmark cools'], run: (w) => (transfer(w, 'reserve', 'treasury', 60, 'Gold from the state mine'), prices(w, 3), mood(w, 'kessmark', -1, 'Jealous of our gold')) },
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
    id: 'debt', title: 'The Reserve calls in its loans', text: 'The Reserve wants the Treasury to start paying back what it borrowed.', needs: (w) => w.economy.lent >= 50,
    options: [
      { label: 'Repay 50 now', what: 'Painful, but the books look healthier.', effects: ['Treasury −50', 'Debt −50', 'Prosperity +1'], run: (w) => (spend(w, 50, 'reserve', 'Repaying the Reserve'), (w.economy.lent = Math.max(0, w.economy.lent - 50)), meter(w, 'prosperity', 1, 'The Treasury paid down its debt')) },
      { label: 'Refuse', what: 'The Reserve raises its rate in protest.', effects: ['Interest rate +1%', 'Prosperity −2'], run: (w) => ((w.economy.rate = Math.min(15, w.economy.rate + 1)), meter(w, 'prosperity', -2, 'The Treasury refused to repay')) }
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
    id: 'refugees', title: 'Refugees at the border', text: 'Families are fleeing hard times in Kessmark.',
    options: [
      { label: 'Take them in', what: 'Tessaly applauds. Kessmark is embarrassed.', effects: ['Treasury −30', 'Tessaly warms', 'Kessmark cools'], run: (w) => (spend(w, 30, 'escrow', 'Housing refugees'), mood(w, 'tessaly', 1, 'We took in refugees'), mood(w, 'kessmark', -1, 'We sheltered their people')) },
      { label: 'Close the border', what: 'Kessmark is grateful. Tessaly is not.', effects: ['Kessmark warms', 'Tessaly cools', 'Stability +1'], run: (w) => (mood(w, 'kessmark', 1, 'We closed the border'), mood(w, 'tessaly', -1, 'We turned refugees away'), meter(w, 'stability', 1, 'The border was closed')) },
      { label: 'Do nothing', what: 'Camps grow along the border.', effects: ['Stability −3'], run: (w) => meter(w, 'stability', -3, 'Camps on the border') }
    ]
  },
  {
    id: 'spy', title: 'A Kessmark spy is caught', text: 'A clerk at the Treasury was passing papers across the border.',
    options: [
      { label: 'Put them on trial', what: 'A public show of strength.', effects: ['Stability +3', 'Kessmark cools sharply'], run: (w) => (meter(w, 'stability', 3, 'A spy on trial'), mood(w, 'kessmark', -2, 'We put their agent on trial')) },
      { label: 'Expel them quietly', what: 'Firm, but not humiliating.', effects: ['Stability +1', 'Kessmark cools'], run: (w) => (meter(w, 'stability', 1, 'A spy was expelled'), mood(w, 'kessmark', -1, 'We expelled their agent')) },
      { label: 'Swap them for a favour', what: 'Kessmark owes us. Nobody else knows.', effects: ['Kessmark warms', 'A secret card about the PM'], run: (w) => (mood(w, 'kessmark', 1, 'We returned their agent'), pmCard(w, 'The PM quietly handed a caught spy back to Kessmark.', 'Security Service')) }
    ]
  },
  {
    id: 'pirates', title: 'Pirates on the trade route', text: 'Merchant ships are being stopped off the Orrin Isles.',
    options: [
      { label: 'Pay for armed escorts', what: 'Expensive, and Orrin is grateful.', effects: ['Treasury −35', 'Orrin warms', 'Prosperity +1'], run: (w) => (spend(w, 35, 'nation:orrin', 'Convoy escorts'), mood(w, 'orrin', 1, 'We protected the sea lanes'), meter(w, 'prosperity', 1, 'Trade kept moving')) },
      { label: 'Pay the pirates', what: 'Cheaper. Someone will find out.', effects: ['Treasury −15', 'A secret card about the PM'], run: (w) => (spend(w, 15, 'escrow', 'Payments at sea'), pmCard(w, 'The government paid pirates to leave our ships alone.', 'Admiralty clerk')) },
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
    id: 'border', title: 'Kessmark troops at the border', text: 'Columns have been seen on the ridge. Nobody knows why.',
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
      { label: 'Ignore it', what: 'It is probably nothing.', effects: ['Stability −2'], run: (w) => meter(w, 'stability', -2, 'Coup rumours') }
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
      { label: 'Ask Orrin for shipwrights', what: 'Free help, and a favour owed.', effects: ['Free', 'Orrin remembers'], run: (w) => owe(w, 'orrin', 'We owe them for the harbour') },
      { label: 'Leave it', what: 'The fishing fleet stays home.', effects: ['Prosperity −4'], run: (w) => meter(w, 'prosperity', -4, 'The harbour lies wrecked') }
    ]
  }
];

export const crisisById = (id: string) => CRISES.find((c) => c.id === id);
