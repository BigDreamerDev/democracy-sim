// The five nations, envoys, treaty offers, the Security Service and the Army.
import { W, Id, DAY, HOUR, fail, newId, rand, chance, pick, nm, gazette, earn, transfer, bal, hasPower, isPM, addCard, holderOf, clamp, inDanger } from './core';

export const MOODS = ['Hostile', 'Cold', 'Neutral', 'Friendly', 'Allied'];
export function seedNations(w: W) {
  [
    { id: 'varnholm', name: 'Varnholm', mood: 3, wants: 'A steady buyer for their grain.', reasons: [{ sign: '+', text: 'We trade fairly with them' }] },
    { id: 'kessmark', name: 'Kessmark', mood: 1, wants: 'Control of the river trade. They see us as a rival.', reasons: [{ sign: '−', text: 'They think we spy on them' }] },
    { id: 'sundmere', name: 'Sundmere', mood: 2, wants: 'To stay out of everyone’s quarrels.', reasons: [{ sign: '+', text: 'No disputes with us' }] },
    { id: 'orrin', name: 'Orrin Isles', mood: 2, wants: 'A defence pact against Kessmark.', reasons: [{ sign: '+', text: 'A shared rival in Kessmark' }] },
    { id: 'tessaly', name: 'Commonwealth of Tessaly', mood: 2, wants: 'Open trade with another young parliament.', reasons: [{ sign: '+', text: 'They welcomed our new Parliament' }] }
  ].forEach((n) => {
    w.nations[n.id] = { ...n, envoyAt: 0 };
    w.accounts['nation:' + n.id] = 400;
    w.accounts.reserve = (w.accounts.reserve || 0) - 400;
  });
}
function foreignPower(w: W, id: Id) {
  return hasPower(w, id, 'envoy') || (isPM(w, id) && (!w.offices.foreign || !w.offices.foreign.holder));
}
function moodShift(n: any, d: number, text: string) {
  n.mood = clamp(n.mood + d, 0, 4);
  n.reasons.unshift({ sign: d > 0 ? '+' : '−', text });
  n.reasons = n.reasons.slice(0, 5);
}
export function sendEnvoy(w: W, actor: Id, nid: Id) {
  if (!w.offices.foreign) fail('Envoys need a Foreign Office: pass the Foreign Affairs Act.');
  if (!foreignPower(w, actor)) fail('Only the Foreign Minister sends envoys.');
  const n = w.nations[nid];
  if (!n) fail('Unknown country.');
  if (n.envoyAt && w.now - n.envoyAt < 7 * DAY) fail('One envoy per country each week.');
  n.envoyAt = w.now;
  const good = chance(w, n.envoyBoost ? 0.95 : n.mood >= 2 ? 0.7 : 0.45);
  n.envoyBoost = false;
  if (good && n.mood < 4) moodShift(n, 1, 'Our envoy was well received');
  else if (!good) moodShift(n, 0, 'Our envoy was kept waiting');
  if (good) earn(w, actor, 2, 'A successful envoy');
  gazette(w, 'foreign', `An envoy visits ${n.name}. ${good ? 'Relations improve.' : 'It does not go well.'}`, '#/nation/' + nid);
}

export const TREATIES = [
  { kind: 'trade', title: 'Trade Agreement', give: 'No tariffs on their goods', get: 'No tariffs on ventures to them', effect: { tariffFree: true } },
  { kind: 'fishing', title: 'Fishing Treaty', give: 'Shared fishing waters', get: 'A steady friend at sea', effect: {} },
  { kind: 'defence', title: 'Defence Pact', give: 'We help if they are attacked', get: 'They help if we are attacked', effect: { defence: true } }
];
export function maybeOffers(w: W) {
  Object.values(w.nations).forEach((n: any) => {
    if (n.mood < 2 || chance(w, 0.6) || inDanger(w, 'standing')) return;
    if (Object.values(w.offers).some((o: any) => o.nation === n.id)) return;
    if (Object.values(w.treaties).some((t: any) => t.nation === n.id && t.status === 'active')) return;
    const t = pick(w, TREATIES);
    const id = newId(w, 'of');
    w.offers[id] = { id, nation: n.id, ...t, title: `${n.name} ${t.title}`, at: w.now, expiresAt: w.now + 5 * DAY };
    gazette(w, 'foreign', `${n.name} offers us a ${t.title}. The House can ratify it with a bill.`, '#/foreign');
  });
}
// we propose; they answer within a day; a yes becomes an offer our House can ratify
export function proposeTreaty(w: W, actor: Id, nid: Id, kind: string) {
  if (!w.offices.foreign) fail('This needs a Foreign Office.');
  if (!foreignPower(w, actor)) fail('Only the Foreign Minister proposes treaties.');
  const n = w.nations[nid];
  const t = TREATIES.find((x) => x.kind === kind);
  if (!n || !t) fail('Pick a country and a treaty.');
  if (w.asks.some((a: any) => a.nation === nid && a.status === 'sent')) fail('We are already waiting on them.');
  w.asks.unshift({ id: newId(w, 'ask'), nation: nid, kind, title: `${n.name} ${t.title}`, at: w.now, decideAt: w.now + DAY, status: 'sent' });
  gazette(w, 'foreign', `We propose a ${t.title} to ${n.name}. They answer within a day.`, '#/nation/' + nid);
}
export function answerAsk(w: W, a: any) {
  const n = w.nations[a.nation];
  const yes = chance(w, [0.05, 0.25, 0.55, 0.8, 0.95][n.mood]);
  a.status = yes ? 'accepted' : 'refused';
  if (yes) {
    const t = TREATIES.find((x) => x.kind === a.kind)!;
    const id = newId(w, 'of');
    w.offers[id] = { id, nation: n.id, ...t, title: a.title, at: w.now, expiresAt: w.now + 5 * DAY };
  }
  gazette(w, 'foreign', `${n.name} ${yes ? 'accepts' : 'turns down'} our proposed ${a.title.replace(n.name + ' ', '')}.${yes ? ' It now needs our House.' : ''}`, '#/foreign');
}

// ---------- the Security Service ----------
export const INTEL_Q: Record<string, string> = {
  plans: 'What are they planning?',
  opinion: 'What do they really think of us?',
  weak: 'Where are they weak?'
};
export function requestIntel(w: W, actor: Id, nid: Id, q: string) {
  if (!w.offices.security) fail('This needs a Security Service.');
  if (!hasPower(w, actor, 'intel') && !(isPM(w, actor) && !holderOf(w, 'security'))) fail('Only the Director sends requests.');
  if (!w.nations[nid] || !INTEL_Q[q]) fail('Pick a country and a question.');
  if (bal(w, 'office:security') < 20) fail('The Service has spent this week’s budget. Each request costs 20.');
  transfer(w, 'office:security', 'escrow', 20, 'Intelligence request');
  w.intel.unshift({ id: newId(w, 'i'), nation: nid, q, by: actor, at: w.now, readyAt: w.now + 12 * HOUR, status: 'pending', text: null });
}
export function resolveIntel(w: W, r: any) {
  const n = w.nations[r.nation];
  transfer(w, 'escrow', 'nation:' + r.nation, 20, 'Paid to sources abroad');
  if (chance(w, 0.1)) {
    r.status = 'caught';
    r.text = `Our agent in ${n.name} was caught.`;
    moodShift(n, -2, 'They caught one of our spies');
    gazette(w, 'scandal', `Spy scandal: ${n.name} arrests an agent of the realm.`, '#/nation/' + n.id);
    addCard(w, { title: `The spy caught in ${n.name} was sent on the orders of ${nm(w, r.by)}.`, about: r.by, from: 'Security Service', level: 'secret', viewers: ['pm', 'office:security'] });
    return;
  }
  r.status = 'ready';
  r.confidence = 1 + Math.floor(rand(w) * 3);
  const offer = Object.values(w.offers).find((o: any) => o.nation === n.id) as any;
  if (r.q === 'plans') r.text = offer ? `${n.name} wants the ${offer.title} passed soon, and will cool on us if it stalls.` : n.mood >= 2 ? `${n.name} is preparing to offer us a treaty.` : `${n.name} is courting our rivals.`;
  if (r.q === 'opinion') r.text = `In private, ${n.name}'s leaders call us ${MOODS[n.mood].toLowerCase()}. Their grievance: ${n.reasons.find((x: any) => x.sign !== '+')?.text.toLowerCase() ?? 'none'}.`;
  if (r.q === 'weak') {
    r.text = `${n.name}'s treasury is stretched. A friendly envoy this week is likely to land well.`;
    n.envoyBoost = true;
  }
  addCard(w, { title: `Intelligence on ${n.name}: ${r.text}`, about: null, from: 'Security Service', level: 'secret', viewers: ['pm', 'office:security'] });
}

// ---------- the Army ----------
export function armyLoyalty(w: W, d: number, why: string) {
  w.army.loyalty = clamp(w.army.loyalty + d, 0, 5);
  w.army.reasons.unshift({ sign: d > 0 ? '+' : '−', text: why });
  w.army.reasons = w.army.reasons.slice(0, 6);
}
export function setReadiness(w: W, actor: Id, level: string) {
  if (!w.offices.army) fail('There is no Army: pass the Defence Act first.');
  if (!hasPower(w, actor, 'army') && !isPM(w, actor)) fail('Only the PM or the General sets readiness.');
  if (!['down', 'ready', 'mobilised'].includes(level)) fail('Unknown readiness.');
  const prev = w.army.readiness;
  w.army.readiness = level;
  if (level === 'mobilised' && prev !== 'mobilised') ['kessmark', 'sundmere'].forEach((k) => moodShift(w.nations[k], -1, 'Our Army mobilised at the border'));
  if (level === 'down' && prev !== 'down') armyLoyalty(w, -1, 'Stood down and paid less');
  if (level !== 'down' && prev === 'down') armyLoyalty(w, 1, 'Back on full pay');
  gazette(w, 'army', `The Army is now ${({ down: 'stood down', ready: 'ready', mobilised: 'mobilised' } as any)[level]}.`, '#/army');
}
