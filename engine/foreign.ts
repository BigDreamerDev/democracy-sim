// The five nations, envoys, treaty offers, the Security Service and the Army.
import { startWar } from './war';
import { W, Id, DAY, HOUR, fail, newId, rand, chance, pick, nm, gazette, earn, transfer, bal, hasPower, isPM, addCard, holderOf, clamp, inDanger, meter, own, approve, stamp } from './core';

export const MOODS = ['Hostile', 'Cold', 'Neutral', 'Friendly', 'Allied'];
// who they are: fixed facts about each nation (the world map, the nation pages and the Exchange read these)
export const PROFILES: Record<string, { capital: string; gov: string; leader: string; strength: number; wealth: number; exports: string; motto: string }> = {
  varnholm: { capital: 'Halvik', gov: 'Grand duchy', leader: 'Grand Duke Osric IV', strength: 4, wealth: 6, exports: 'Grain, timber', motto: 'Bread before banners.' },
  kessmark: { capital: 'Kessbridge', gov: 'Merchant republic', leader: 'First Syndic Ilse Varga', strength: 7, wealth: 7, exports: 'River trade, dyes', motto: 'The river remembers.' },
  sundmere: { capital: 'Lowmere', gov: 'Neutral confederation', leader: 'The Council of Lakes', strength: 3, wealth: 5, exports: 'Salt, wool', motto: 'Still water.' },
  orrin: { capital: 'Port Calloway', gov: 'Island kingdom', leader: 'Queen Maren of the Isles', strength: 5, wealth: 4, exports: 'Fish, ships', motto: 'The sea provides.' },
  tessaly: { capital: 'New Tessa', gov: 'Parliamentary commonwealth', leader: 'Chancellor Abel Moye', strength: 4, wealth: 6, exports: 'Cloth, machines', motto: 'Many voices, one road.' },
  aurel: { capital: 'Aurel', gov: 'Free city', leader: 'The Doge of Aurel', strength: 2, wealth: 10, exports: 'Banking, insurance', motto: 'Gold has no flag.' },
  drakmoor: { capital: 'Ironhold', gov: 'Military hegemony', leader: 'Marshal Teodor Krell', strength: 9, wealth: 5, exports: 'Steel, coal', motto: 'Strength is peace.' }
};
// old quarrels between nations abroad: their wars break out along these lines
export const RIVALS: [string, string][] = [['kessmark', 'orrin'], ['kessmark', 'varnholm'], ['drakmoor', 'sundmere'], ['drakmoor', 'tessaly'], ['drakmoor', 'aurel'], ['orrin', 'tessaly']];
const NATIONS = [
  { id: 'varnholm', name: 'Varnholm', mood: 3, wants: 'A steady buyer for their grain.', reasons: [{ sign: '+', text: 'We trade fairly with them' }] },
  { id: 'kessmark', name: 'Kessmark', mood: 1, wants: 'Control of the river trade. They see us as a rival.', reasons: [{ sign: '−', text: 'They think we spy on them' }] },
  { id: 'sundmere', name: 'Sundmere', mood: 2, wants: 'To stay out of everyone’s quarrels.', reasons: [{ sign: '+', text: 'No disputes with us' }] },
  { id: 'orrin', name: 'Orrin Isles', mood: 2, wants: 'A defence pact against Kessmark.', reasons: [{ sign: '+', text: 'A shared rival in Kessmark' }] },
  { id: 'tessaly', name: 'Commonwealth of Tessaly', mood: 2, wants: 'Open trade with another young parliament.', reasons: [{ sign: '+', text: 'They welcomed our new Parliament' }] },
  { id: 'aurel', name: 'Free City of Aurel', mood: 2, wants: 'Our companies listed on their books, and no wars that spoil business.', reasons: [{ sign: '+', text: 'Bankers like a quiet neighbour' }] },
  { id: 'drakmoor', name: 'Drakmoor', mood: 1, wants: 'Every border in the north redrawn in its favour.', reasons: [{ sign: '−', text: 'They think our Army is weak' }] }
];
// adds any nation the world is missing (a new world gets all of them; migrate() adds new ones to an old world)
export function seedNations(w: W) {
  NATIONS.forEach((n) => {
    if (w.nations[n.id]) return;
    w.nations[n.id] = { ...structuredClone(n), envoyAt: 0, power: PROFILES[n.id].strength, embassy: false, embargo: false };
    w.accounts['nation:' + n.id] = 400;
    w.accounts.reserve = (w.accounts.reserve || 0) - 400;
  });
}
export const atWar = (w: W, nid: string) => w.army?.war === nid;
export const conflictOf = (w: W, nid: string) => (w.conflicts || []).find((c: any) => c.status === 'raging' && (c.a === nid || c.b === nid));
export function foreignPower(w: W, id: Id) {
  return hasPower(w, id, 'envoy') || (isPM(w, id) && (!w.offices.foreign || !w.offices.foreign.holder));
}
export function moodShift(n: any, d: number, text: string) {
  n.mood = clamp(n.mood + d, 0, 4);
  n.reasons.unshift({ sign: d > 0 ? '+' : '−', text });
  n.reasons = n.reasons.slice(0, 5);
}
export function sendEnvoy(w: W, actor: Id, nid: Id) {
  if (!w.offices.foreign) fail('Envoys need a Foreign Office: pass the Foreign Affairs Act.');
  if (!foreignPower(w, actor)) fail('Only the Foreign Minister sends envoys.');
  const n = own(w.nations, nid);
  if (!n) fail('Unknown country.');
  if (n.envoyAt && w.now - n.envoyAt < 7 * DAY) fail('One envoy per country each week.');
  n.envoyAt = w.now;
  const good = chance(w, n.envoyBoost ? 0.95 : (n.mood >= 2 ? 0.7 : 0.45) + (n.embassy ? 0.15 : 0));
  n.envoyBoost = false;
  if (good && n.mood < 4) moodShift(n, 1, 'Our envoy was well received');
  else if (!good) moodShift(n, 0, 'Our envoy was kept waiting');
  if (good) earn(w, actor, 2, 'A successful envoy');
  gazette(w, 'foreign', `An envoy visits ${n.name}. ${good ? 'Relations improve.' : 'It does not go well.'}`, '#/nation/' + nid);
}

export const TREATIES = [
  { kind: 'trade', title: 'Trade Agreement', give: 'No tariffs on their goods', get: 'No tariffs on ventures to them', effect: { tariffFree: true } },
  { kind: 'fishing', title: 'Fishing Treaty', give: 'Shared fishing waters', get: 'A steady friend at sea', effect: {} },
  { kind: 'defence', title: 'Defence Pact', give: 'We help if they are attacked', get: 'They help if we are attacked', effect: { defence: true } },
  { kind: 'alliance', title: 'Military Alliance', give: 'We join their wars', get: 'Their army fights beside ours', effect: { alliance: true, defence: true } },
  { kind: 'nonaggression', title: 'Non-Aggression Pact', give: 'We never attack them', get: 'They never declare war on us', effect: { nonaggression: true } }
];
export const treatyWith = (w: W, nid: string, key: string) => Object.values(w.treaties).some((t: any) => t.status === 'active' && t.nation === nid && t.effect?.[key]);
export function maybeOffers(w: W) {
  Object.values(w.nations).forEach((n: any) => {
    if (n.mood < 2 || chance(w, 0.6) || inDanger(w, 'standing')) return;
    if (Object.values(w.offers).some((o: any) => o.nation === n.id)) return;
    if (Object.values(w.treaties).some((t: any) => t.nation === n.id && t.status === 'active')) return;
    const t = pick(w, TREATIES.filter((x) => x.kind !== 'alliance' || n.mood >= 4));
    const id = newId(w, 'of');
    w.offers[id] = { id, nation: n.id, ...t, title: `${n.name} ${t.title}`, at: w.now, expiresAt: w.now + 5 * DAY };
    gazette(w, 'foreign', `${n.name} offers us a ${t.title}. The House can ratify it with a bill.`, '#/foreign');
  });
}
// we propose; they answer within a day; a yes becomes an offer our House can ratify
export function proposeTreaty(w: W, actor: Id, nid: Id, kind: string) {
  if (!w.offices.foreign) fail('This needs a Foreign Office.');
  if (!foreignPower(w, actor)) fail('Only the Foreign Minister proposes treaties.');
  const n = own(w.nations, nid);
  const t = TREATIES.find((x) => x.kind === kind);
  if (!n || !t) fail('Pick a country and a treaty.');
  if (w.asks.some((a: any) => a.nation === nid && a.status === 'sent')) fail('We are already waiting on them.');
  w.asks.unshift({ id: newId(w, 'ask'), nation: nid, kind, title: `${n.name} ${t.title}`, at: w.now, decideAt: w.now + DAY, status: 'sent' });
  gazette(w, 'foreign', `We propose a ${t.title} to ${n.name}. They answer within a day.`, '#/nation/' + nid);
}
export function answerAsk(w: W, a: any) {
  const n = w.nations[a.nation];
  const yes = chance(w, [0.05, 0.25, 0.55, 0.8, 0.95][n.mood] * (a.kind === 'alliance' ? 0.6 : 1));
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
  if (!own(w.nations, nid) || !own(INTEL_Q, q)) fail('Pick a country and a question.');
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
  n.seenAt = w.now;
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
  if (!hasPower(w, actor, 'army') && !hasPower(w, actor, 'govern') && !isPM(w, actor)) fail('Only the PM, the General or an officer of state sets readiness.');
  if (!['down', 'ready', 'mobilised'].includes(level)) fail('Unknown readiness.');
  const prev = w.army.readiness;
  w.army.readiness = level;
  if (level === 'mobilised' && prev !== 'mobilised') ['kessmark', 'sundmere'].forEach((k) => moodShift(w.nations[k], -1, 'Our Army mobilised at the border'));
  if (level === 'down' && prev !== 'down') armyLoyalty(w, -1, 'Stood down and paid less');
  if (level !== 'down' && prev === 'down') armyLoyalty(w, 1, 'Back on full pay');
  gazette(w, 'army', `The Army is now ${({ down: 'stood down', ready: 'ready', mobilised: 'mobilised' } as any)[level]}.`, '#/army');
}

// ---------- the nations act: once a week, at payday ----------
// hostile nations threaten, sanction or (with an Army to fight) declare war; friends send aid
export function nationsTurn(w: W) {
  w.ultimatums ??= [];
  let sanctioned = 0;
  Object.values(w.nations).forEach((n: any) => {
    if (n.sanctionsUntil && n.sanctionsUntil <= w.now) {
      n.sanctionsUntil = null;
      gazette(w, 'foreign', `${n.name} lifts its sanctions.`, '#/nation/' + n.id);
    }
    if (n.sanctionsUntil) sanctioned++;
    const pending = w.ultimatums.some((u: any) => u.nation === n.id && u.status === 'sent');
    if (n.mood === 0 && !pending && chance(w, 0.45)) {
      // a non-aggression pact holds them back; a strong nation facing a small Army is bolder
      const bold = 0.35 + (w.offices.army && (n.power || 0) > (w.army.troops ?? 6) ? 0.15 : 0);
      if (w.offices.army && !w.army.war && !treatyWith(w, n.id, 'nonaggression') && chance(w, bold)) startWar(w, n.id, 'them');
      else ultimatum(w, n, 30 + Math.round(rand(w) * 30));
    } else if (n.mood === 1 && !pending && chance(w, 0.3)) {
      if (!n.sanctionsUntil && chance(w, 0.5)) sanction(w, n, 'They don’t like the look of us');
      else ultimatum(w, n, 15 + Math.round(rand(w) * 20));
    } else if (n.mood >= 3 && chance(w, 0.25)) {
      const amt = 15 + Math.round(rand(w) * 25);
      if (bal(w, 'nation:' + n.id) >= amt) {
        transfer(w, 'nation:' + n.id, 'treasury', amt, `Aid from ${n.name}`);
        meter(w, 'prosperity', 1, `Aid from ${n.name}`);
        gazette(w, 'foreign', `${n.name} sends ${amt} crowns of aid, as friends do.`, '#/nation/' + n.id);
      }
    }
  });
  if (sanctioned) meter(w, 'prosperity', -2 * sanctioned, 'Foreign sanctions');
  embassiesWeek(w);
  conflictsWeek(w);
  provincesWeek(w);
}
function ultimatum(w: W, n: any, crowns: number) {
  const id = newId(w, 'ul');
  w.ultimatums.unshift({ id, nation: n.id, crowns, at: w.now, dueAt: w.now + 2 * DAY, status: 'sent' });
  w.ultimatums = w.ultimatums.slice(0, 30);
  gazette(w, 'foreign', `${n.name} demands ${crowns} crowns in tribute within 2 days, or else. The ${w.offices.foreign?.holder ? 'Foreign Minister' : 'Prime Minister'} must answer.`, '#/foreign');
}
function sanction(w: W, n: any, why: string) {
  n.sanctionsUntil = w.now + 7 * DAY;
  moodShift(n, 0, why);
  gazette(w, 'foreign', `${n.name} imposes sanctions for a week: no trade ventures there, and Prosperity suffers.`, '#/nation/' + n.id);
}
export function answerUltimatum(w: W, actor: Id, id: Id, pay: boolean) {
  const u = (w.ultimatums || []).find((x: any) => x.id === id);
  if (!u || u.status !== 'sent') fail('That demand has been dealt with.');
  if (!foreignPower(w, actor) && !isPM(w, actor)) fail('Only the Foreign Minister or the PM answers foreign demands.');
  settleUltimatum(w, u, !!pay, actor);
}
export function settleUltimatum(w: W, u: any, pay: boolean, actor?: Id) {
  const n = w.nations[u.nation];
  u.status = pay ? 'paid' : actor ? 'refused' : 'ignored';
  u.by = actor || null;
  if (pay) {
    transfer(w, 'treasury', 'nation:' + n.id, u.crowns, `Tribute to ${n.name}`);
    moodShift(n, 1, 'We paid their tribute');
    meter(w, 'stability', -1, 'We paid tribute abroad');
    gazette(w, 'foreign', `The realm pays ${n.name} ${u.crowns} crowns in tribute.`, '#/nation/' + n.id);
    return;
  }
  moodShift(n, -1, actor ? 'We refused their demand' : 'We ignored their demand');
  meter(w, 'stability', -2, `Standoff with ${n.name}`);
  gazette(w, 'foreign', `The realm ${actor ? 'refuses' : 'ignores'} ${n.name}’s demand.`, '#/nation/' + n.id);
  if (!n.sanctionsUntil && chance(w, 0.5)) sanction(w, n, 'We defied them');
}

// ---------- embassies: a standing mission abroad. 30 crowns to open, 5 a week to keep; envoys land better,
// and a Cold or Hostile nation with our embassy in it drifts back towards Neutral ----------
export const EMBASSY_COST = 30;
export const EMBASSY_UPKEEP = 5;
export function embassy(w: W, actor: Id, nid: Id, open: unknown) {
  if (!w.offices.foreign) fail('Embassies need a Foreign Office: pass the Foreign Affairs Act.');
  if (!foreignPower(w, actor)) fail('Only the Foreign Minister opens and closes embassies.');
  const n = own(w.nations, nid);
  if (!n) fail('Unknown country.');
  if (open === true) {
    if (n.embassy) fail(`We already have an embassy in ${n.name}.`);
    if (atWar(w, nid)) fail('Not while we are at war with them.');
    transfer(w, 'treasury', 'nation:' + nid, EMBASSY_COST, `An embassy in ${n.name}`);
    n.embassy = true;
    moodShift(n, n.mood < 4 ? 1 : 0, 'We opened an embassy');
    return gazette(w, 'foreign', `The realm opens an embassy in ${PROFILES[nid]?.capital ?? n.name}, ${n.name}.`, '#/nation/' + nid);
  }
  if (open !== false) fail('Open or close the embassy.');
  if (!n.embassy) fail(`We have no embassy in ${n.name}.`);
  n.embassy = false;
  moodShift(n, -1, 'We recalled our ambassador');
  gazette(w, 'foreign', `The realm recalls its ambassador from ${n.name} and closes the embassy.`, '#/nation/' + nid);
}
function embassiesWeek(w: W) {
  Object.values(w.nations).forEach((n: any) => {
    if (!n.embassy) return;
    if (atWar(w, n.id)) return void ((n.embassy = false), gazette(w, 'foreign', `Our embassy in ${n.name} is closed by the war.`, '#/nation/' + n.id));
    transfer(w, 'treasury', 'nation:' + n.id, EMBASSY_UPKEEP, `Embassy upkeep, ${n.name}`);
    if (n.mood < 2 && chance(w, 0.35)) moodShift(n, 1, 'Our ambassador smoothed things over');
  });
}

// ---------- our own embargo: no ventures there, their companies suffer, and their war effort is weaker ----------
export function embargo(w: W, actor: Id, nid: Id, on: unknown) {
  if (!foreignPower(w, actor) && !isPM(w, actor)) fail('Only the Foreign Minister or the Prime Minister imposes an embargo.');
  const n = own(w.nations, nid);
  if (!n) fail('Unknown country.');
  if (on !== true && on !== false) fail('Impose the embargo or lift it.');
  if (!!n.embargo === on) fail(on ? 'They are already under our embargo.' : 'There is no embargo to lift.');
  n.embargo = on;
  if (on) {
    moodShift(n, -1, 'We placed them under embargo');
    meter(w, 'prosperity', -1, `An embargo on ${n.name}`);
    gazette(w, 'foreign', `The realm places ${n.name} under a trade embargo. No ventures go there until it is lifted.`, '#/nation/' + nid);
  } else {
    moodShift(n, 0, 'We lifted our embargo');
    gazette(w, 'foreign', `The realm lifts its embargo on ${n.name}.`, '#/nation/' + nid);
  }
}

// ---------- wars abroad: rivals fight each other. The realm can broker a peace, or profit from it ----------
export function conflictsWeek(w: W) {
  w.conflicts ??= [];
  w.conflicts.filter((c: any) => c.status === 'raging').forEach((c: any) => {
    const A = w.nations[c.a];
    const B = w.nations[c.b];
    c.weeks += 1;
    c.score += Math.round(((A.power || 3) - (B.power || 3)) / 2 + (rand(w) - 0.5) * 6);
    // a treaty partner at war: they expect us to stand with them
    [A, B].forEach((n: any) => {
      const foe = n.id === c.a ? c.b : c.a;
      if (treatyWith(w, n.id, 'defence') && !atWar(w, foe)) moodShift(n, -1, `We did not stand by them against ${w.nations[foe].name}`);
    });
    if (Math.abs(c.score) >= 6 || c.weeks >= 4) {
      const win = c.score === 0 ? null : c.score > 0 ? A : B;
      const lose = win === A ? B : win === B ? A : null;
      c.status = 'over';
      c.endedAt = w.now;
      c.winner = win?.id ?? null;
      if (lose) lose.power = Math.max(1, (lose.power || 3) - 1);
      gazette(w, 'foreign', win ? `The war between ${A.name} and ${B.name} ends: ${win.name} prevails.` : `The war between ${A.name} and ${B.name} ends in exhaustion.`, '#/atlas');
    }
  });
  if (w.conflicts.some((c: any) => c.status === 'raging') || !chance(w, 0.25)) return;
  const pairs = RIVALS.filter(([a, b]) => w.nations[a] && w.nations[b] && !atWar(w, a) && !atWar(w, b) && !conflictOf(w, a) && !conflictOf(w, b));
  if (!pairs.length) return;
  const [a, b] = pick(w, pairs);
  const id = newId(w, 'cf');
  w.conflicts.unshift({ id, a, b, at: w.now, weeks: 0, score: 0, status: 'raging', mediated: false, winner: null });
  w.conflicts = w.conflicts.slice(0, 12);
  meter(w, 'prosperity', -1, 'War abroad unsettles trade');
  gazette(w, 'foreign', `War abroad: ${w.nations[a].name} and ${w.nations[b].name} take up arms against each other. Our Foreign Office may offer to mediate.`, '#/atlas');
}
// once per war abroad: both sides must think well enough of us to listen
export function mediate(w: W, actor: Id, cid: Id) {
  if (!w.offices.foreign) fail('Mediation needs a Foreign Office.');
  if (!foreignPower(w, actor)) fail('Only the Foreign Minister mediates.');
  const c = (w.conflicts || []).find((x: any) => x.id === cid);
  if (!c || c.status !== 'raging') fail('That war is over.');
  if (c.mediated) fail('We have already tried. They will not sit down with us twice.');
  c.mediated = true;
  const A = w.nations[c.a];
  const B = w.nations[c.b];
  const ok = chance(w, clamp(0.15 + 0.15 * Math.min(A.mood, B.mood) + (A.embassy && B.embassy ? 0.15 : 0), 0.1, 0.85));
  if (!ok) {
    moodShift(A.mood <= B.mood ? A : B, -1, 'Our mediation insulted them');
    return gazette(w, 'foreign', `Our mediation between ${A.name} and ${B.name} fails. The war goes on.`, '#/atlas');
  }
  c.status = 'over';
  c.endedAt = w.now;
  c.peaceBy = actor;
  [A, B].forEach((n: any) => moodShift(n, 1, 'We brokered their peace'));
  earn(w, actor, 6, 'Brokered a peace abroad');
  approve(w, actor, 4);
  stamp(w, actor, 'Peacemaker', `${A.name} and ${B.name}`, 'good');
  meter(w, 'stability', 1, 'Peace abroad');
  gazette(w, 'foreign', `${nm(w, actor)} brokers an end to the war between ${A.name} and ${B.name}.`, '#/atlas');
}

// ---------- fog of war: we only know a nation's army strength through an embassy, a Security Service report in the
// last week, or by fighting it. Otherwise view.ts hides it ----------
export const KNOWN_FOR = 7 * DAY;
export const known = (w: W, nid: string) => { const n = w.nations[nid]; return !!n && (!!n.embassy || atWar(w, nid) || (!!n.seenAt && w.now - n.seenAt < KNOWN_FOR)); };

// ---------- disputed provinces: border lands that change hands in war. Each has its owner ('realm' or a nation)
// and the nations that claim it. Win a war and the enemy's claimed provinces are ours; lose and they take one back.
// A nation whose province we hold resents it ----------
export const PROVINCES: Record<string, { name: string; claims: string[]; start: string; blurb: string }> = {
  kessvale: { name: 'The Kess Valley', claims: ['kessmark', 'drakmoor'], start: 'kessmark', blurb: 'Rich river farmland on the west bank of the Kess. Kessmark has held it for a generation; the realm has never stopped wanting it back.' },
  northfells: { name: 'The North Fells', claims: ['sundmere', 'drakmoor'], start: 'realm', blurb: 'Hill country under the Spine. Shepherds, slate and a road north that Drakmoor would love to own.' },
  westwold: { name: 'The Westwold', claims: ['varnholm'], start: 'realm', blurb: 'Old forest on the Varnholm march. Varnholm’s maps still show it as theirs.' }
};
export function seedProvinces(w: W) {
  w.provinces ??= {};
  Object.entries(PROVINCES).forEach(([id, p]) => (w.provinces[id] ??= { owner: p.start, since: w.now }));
}
const pname = (id: string) => PROVINCES[id]?.name ?? id;
// war.ts calls this when a war ends in victory or defeat
export function warSpoils(w: W, nid: string, won: boolean) {
  seedProvinces(w);
  const n = w.nations[nid];
  if (won) {
    Object.keys(PROVINCES).filter((id) => w.provinces[id].owner === nid).forEach((id) => {
      w.provinces[id] = { owner: 'realm', since: w.now };
      meter(w, 'prosperity', 2, `${pname(id)} is ours`);
      meter(w, 'stability', 2, `${pname(id)} is ours`);
      moodShift(n, 0, `We took ${pname(id)}`);
      gazette(w, 'army', `${pname(id)} passes to the realm. The flag goes up over its towns.`, '#/atlas');
    });
    return;
  }
  const lost = Object.keys(PROVINCES).find((id) => w.provinces[id].owner === 'realm' && PROVINCES[id].claims.includes(nid));
  if (!lost) return;
  w.provinces[lost] = { owner: nid, since: w.now };
  meter(w, 'stability', -3, `${pname(lost)} is lost`);
  meter(w, 'prosperity', -2, `${pname(lost)} is lost`);
  gazette(w, 'army', `${pname(lost)} is ceded to ${n.name} in the terms of defeat.`, '#/atlas');
}
// once a week: a nation whose claimed province we hold may cool on us
function provincesWeek(w: W) {
  seedProvinces(w);
  Object.entries(PROVINCES).forEach(([id, p]) => {
    if (w.provinces[id].owner !== 'realm') return;
    p.claims.forEach((nid) => {
      const n = w.nations[nid];
      if (n && n.mood > 1 && chance(w, 0.2)) moodShift(n, -1, `They want ${p.name} back`);
    });
  });
}

// ---------- shipping: how many trade ventures are at sea to each nation (public; the ventures themselves are not) ----------
export function shipping(w: W) {
  const out: Record<string, number> = {};
  w.ventures.forEach((v: any) => v.status === 'out' && (out[v.nation] = (out[v.nation] || 0) + 1));
  return out;
}
// a sea lane is closed by sanctions, our embargo, war, or a nation that refuses to trade
export const laneClosed = (w: W, nid: string) => { const n = w.nations[nid]; return !n || n.embargo || atWar(w, nid) || (n.sanctionsUntil && n.sanctionsUntil > w.now) || n.mood < 1; };
