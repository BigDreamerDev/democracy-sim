// War: a campaign against one nation, fought in battles every 12 hours until one side breaks (the front reaches
// ±100) or Parliament makes peace. The Army's regiments, readiness and loyalty, allies, volunteers and an embargo
// decide the odds; the General (or the PM) chooses the strategy. Citizens can enlist or buy war bonds.
// Victory and defeat feed the coup system (backroom.ts): a war hero weighs more on a coup night, a beaten Army
// leans towards the plotters, and an Army at the front cannot defend the capital.
// State: w.army.war = the enemy's id (as before), w.army.campaign = this war, w.army.hero, w.army.defeatedAt, w.wars (history).
import { lim } from './limits';
import { hasArmy, W, Id, DAY, HOUR, fail, rand, chance, nm, gazette, earn, transfer, bal, ca, hasPower, isPM, holderOf, clamp, meter, approve, stamp, bump, mustBeFree, int, legit, own, newId, pick, isMP, mps, inGov, autocrat, autocratTitle, cap } from './core';
import { moodShift, treatyWith, PROFILES, warSpoils, PROVINCES, seedProvinces } from './foreign';
import { fame } from './glory';
import { enemyKnows, takeHostage } from './abroad';
import { canGovernEmpire } from './empire';
import { machineLines, regimentCost, blockadeFactor, raidBonus } from './warmachine';
import { imposePretender } from './crown';

export const BATTLE_EVERY = 12 * HOUR;
export const REGIMENT_COST = 15;
export const MAX_REGIMENTS = 20;
export const STRATEGIES: Record<string, { label: string; what: string; swing: number; risk: number }> = {
  hold: { label: 'Hold the line', what: 'Dig in. Small gains, few losses.', swing: 0.7, risk: 0.5 },
  advance: { label: 'Advance', what: 'Push for victory. Big swings both ways, and the Army is away from the capital.', swing: 1.5, risk: 1.3 },
  raid: { label: 'Raid', what: 'Strike their supplies. Wears down their army and brings back loot.', swing: 0.8, risk: 0.9 }
};
const READY: Record<string, number> = { down: 0.6, ready: 1, mobilised: 1.3 };
const FRONTS = ['the river crossings', 'the northern passes', 'the coast road', 'the border forts', 'the salt marshes', 'the high moor', 'the bridges at dawn', 'the forest edge'];

const war = (w: W) => w.army?.campaign;
const canCommand = (w: W, id: Id) => hasPower(w, id, 'army') || isPM(w, id) || hasPower(w, id, 'govern');
// allies with a Military Alliance, and the empire's protectorates
export const allies = (w: W) => Object.values(w.nations).filter((n: any) => n.id !== w.army.war && ((treatyWith(w, n.id, 'alliance') && n.mood >= 2) || n.protectorate)) as any[];
export function power(w: W) {
  const k = war(w);
  const garrisons = garrisoned(w);
  const troops = Math.max(0, (w.army.troops ?? 6) - garrisons);
  const lines: [string, number][] = [[`${troops} regiments in the field${garrisons ? ` (${garrisons} on garrison duty)` : ''}`, troops], [`Readiness: ${w.army.readiness}`, troops * (READY[w.army.readiness] - 1)], [`Loyalty ${w.army.loyalty}/5`, troops * (w.army.loyalty - 3) * 0.1]];
  if (holderOf(w, 'army')) lines.push(['A General in command', 1]);
  lines.push(...machineLines(w, k?.strategy || 'hold'));
  allies(w).forEach((n) => lines.push([`${n.name} fights beside us`, Math.round((n.power || 3) / 2)]));
  if (k?.volunteers?.length) lines.push([`${k.volunteers.length} volunteer${k.volunteers.length === 1 ? '' : 's'}`, k.volunteers.length * 0.5]);
  const us = Math.max(0.5, lines.reduce((s, l) => s + l[1], 0));
  const n = k && w.nations[k.nation];
  // a defector leading their army (+2 for one battle), or a mole in our government (+1), helps the enemy
  const them = n ? Math.max(0.5, (n.power || 3) * (n.embargo ? 0.85 : 1) + (k?.enemyBoost || 0) + (enemyKnows(w, n.id) ? 1 : 0)) : 1;
  return { us: Math.round(us * 10) / 10, them: Math.round(them * 10) / 10, lines, odds: clamp(us / (us + them), 0.15, 0.85) };
}

export function startWar(w: W, nid: Id, by: 'us' | 'them', cause?: { pretender?: Id }) {
  const n = w.nations[nid];
  if (!n || w.army.war) return;
  w.army.war = nid;
  w.army.troops ??= 6;
  n.mood = 0;
  n.embassy = false;
  w.army.campaign = { nation: nid, by, startedAt: w.now, score: 0, strategy: 'hold', nextBattleAt: w.now + BATTLE_EVERY, battles: [], volunteers: [], bonds: {}, bondTotal: 0, pretender: cause?.pretender || null };
  meter(w, 'stability', by === 'them' ? -6 : -3, by === 'them' ? `${n.name} declared war` : `War with ${n.name}`);
  if (by === 'them') gazette(w, 'army', cause?.pretender ? `${n.name} declares war to put ${nm(w, cause.pretender)} on our throne. The first battle is in 12 hours.` : `${n.name} declares war on the realm. Army upkeep doubles until the war is won, lost, or Parliament makes peace. The first battle is in 12 hours.`, '#/war', { k: 'invaded', place: n.name, nation: n.id });
  else gazette(w, 'army', `The realm is at war with ${n.name}. Army upkeep doubles. The first battle is in 12 hours.`, '#/war', { k: 'invade', place: n.name, nation: n.id });
}

// the General, the PM or an officer of state picks how the Army fights
export function setStrategy(w: W, actor: Id, s: string) {
  const k = war(w);
  if (!k) fail('We are not at war.');
  if (!canCommand(w, actor)) fail('Only the General, the Prime Minister or an officer of state commands the Army.');
  if (!own(STRATEGIES, s)) fail('Hold, advance or raid.');
  if (k.strategy === s) fail('That is already the order.');
  k.strategy = s;
  gazette(w, 'army', `New orders at the front: ${STRATEGIES[s].label.toLowerCase()}.`, '#/war', { k: 'orders', title: s, place: w.nations[k.nation]?.name, by: actor });
}
// raise regiments, paid from the Treasury
export function recruit(w: W, actor: Id, n: unknown) {
  if (!hasArmy(w)) fail('There is no Army: pass the Defence Act first.');
  if (!canCommand(w, actor)) fail('Only the General, the Prime Minister or an officer of state raises regiments.');
  const k = int(n, 1, 5, 'number of regiments');
  const have = w.army.troops ?? 6;
  if (have + k > lim(w, 'regiments')) fail(`The realm can field ${lim(w, 'regiments')} regiments at most. It has ${have}.`);
  transfer(w, 'treasury', 'reserve', regimentCost(w, REGIMENT_COST) * k, `Raised ${k} regiment${k === 1 ? '' : 's'}`);
  w.army.troops = have + k;
  gazette(w, 'army', `${k} new regiment${k === 1 ? ' is' : 's are'} raised. The Army now fields ${w.army.troops}.`, '#/army', { k: 'raise', n: k, by: actor, to: [actor] });
}
export function disband(w: W, actor: Id, n: unknown) {
  if (!hasArmy(w)) fail('There is no Army.');
  if (!canCommand(w, actor)) fail('Only the General, the Prime Minister or an officer of state disbands regiments.');
  if (w.army.war) fail('Not in the middle of a war.');
  const k = int(n, 1, 5, 'number of regiments');
  const have = w.army.troops ?? 6;
  if (have - k < 2) fail('The Army keeps at least 2 regiments.');
  w.army.troops = have - k;
  w.army.loyalty = clamp(w.army.loyalty - 1, 0, 5);
  w.army.reasons.unshift({ sign: '−', text: 'Regiments were disbanded' });
  w.army.reasons = w.army.reasons.slice(0, 6);
  gazette(w, 'army', `${k} regiment${k === 1 ? ' is' : 's are'} disbanded. The barracks grumble.`, '#/army');
}
// any free citizen, once per war: worth half a regiment
export function enlist(w: W, actor: Id) {
  const k = war(w);
  if (!k) fail('We are not at war.');
  mustBeFree(w, actor);
  if (k.volunteers.includes(actor)) fail('You have already volunteered.');
  if (k.volunteers.length >= lim(w, 'volunteers')) fail('The recruiting sergeants have all the volunteers they can take.');
  k.volunteers.push(actor);
  earn(w, actor, 2, 'Volunteered for the war');
  approve(w, actor, 1);
  bump(w, actor, 'volunteered');
  gazette(w, 'army', `${nm(w, actor)} volunteers for the front.`, '#/war');
}
// war bonds: lend the Treasury 5–100 crowns. Victory repays 130%, a peace 100%, defeat 50%
export const BOND_PAYS: Record<string, number> = { victory: 1.3, peace: 1, defeat: 0.5 };
export function buyWarBond(w: W, actor: Id, amount: unknown) {
  const k = war(w);
  if (!k) fail('War bonds are sold only in wartime.');
  mustBeFree(w, actor);
  const most = lim(w, 'warBondsEach');
  const amt = int(amount, 5, most, 'amount');
  if ((k.bonds[actor] || 0) + amt > most) fail(`You can hold ${most} crowns of war bonds at most. You hold ${k.bonds[actor] || 0}.`);
  transfer(w, ca(actor), 'treasury', amt, `War bonds, ${w.nations[k.nation].name} campaign`);
  k.bonds[actor] = (k.bonds[actor] || 0) + amt;
  k.bondTotal = (k.bondTotal || 0) + amt;
}

export function battle(w: W) {
  const k = war(w);
  if (!k) return;
  k.nextBattleAt = w.now + BATTLE_EVERY;
  const n = w.nations[k.nation];
  const s = STRATEGIES[k.strategy] || STRATEGIES.hold;
  const p = power(w);
  const won = chance(w, p.odds);
  const delta = Math.round((10 + rand(w) * 12) * s.swing) * (won ? 1 : -1);
  const where = FRONTS[Math.floor(rand(w) * FRONTS.length)];
  let lost = 0;
  if (!won && chance(w, 0.6 * s.risk)) lost = 1;
  if (won && k.strategy === 'advance' && chance(w, 0.25)) lost = 1;
  if (lost) w.army.troops = Math.max(1, (w.army.troops ?? 6) - lost);
  let loot = 0;
  if (won) n.power = Math.max(1, Math.round(((n.power || 3) - (k.strategy === 'raid' ? 0.5 : 0.25)) * 100) / 100);
  if (won && k.strategy === 'raid') {
    loot = Math.min(bal(w, 'nation:' + n.id), Math.round((10 + rand(w) * 15) * raidBonus(w)));
    if (loot > 0) transfer(w, 'nation:' + n.id, 'treasury', loot, `Spoils of a raid on ${n.name}`);
  }
  k.enemyBoost = 0;
  k.score = clamp(k.score + delta, -100, 100);
  const text = won ? `Victory at ${where}${loot > 0 ? `, and ${loot} crowns of spoils` : ''}.${lost ? ' A regiment is lost.' : ''}` : `Defeat at ${where}.${lost ? ' A regiment is lost.' : ''}`;
  k.battles.unshift({ at: w.now, won, where, delta, lost, loot, us: p.us, them: p.them });
  k.battles = k.battles.slice(0, 30);
  gazette(w, 'army', `${text} The front stands at ${k.score > 0 ? '+' : ''}${k.score}.`, '#/war', { k: 'battle', won, place: where, nation: n.id, delta, score: k.score });
  dispatches(w, k, won, where, delta, loot, lost);
  blockade(w, k);
  if (k.score >= 100) endWar(w, 'victory');
  else if (k.score <= -100) endWar(w, 'defeat');
}

// the end of a war: 'victory', 'defeat', or 'peace' (a bill)
export function endWar(w: W, how: 'victory' | 'defeat' | 'peace') {
  const k = war(w);
  const nid = w.army.war;
  const n = nid && w.nations[nid];
  w.army.war = null;
  w.army.campaign = null;
  if (!k || !n) return;
  const general = holderOf(w, 'army');
  const record = { nation: nid, startedAt: k.startedAt, endedAt: w.now, outcome: how, score: k.score, battles: k.battles.length, won: k.battles.filter((b: any) => b.won).length, volunteers: k.volunteers, general, pm: w.pm, pretender: k.pretender || null };
  w.wars = [record, ...(w.wars || [])].slice(0, 20);
  openMemorial(w, record, k);
  // war bonds are repaid from the Treasury, which borrows if it must
  Object.entries(k.bonds || {}).forEach(([id, amt]: any) => {
    const pay = Math.round(amt * BOND_PAYS[how]);
    if (pay > 0 && w.citizens[id]) transfer(w, 'treasury', ca(id), pay, `War bonds repaid (${how})`);
  });
  if (how !== 'peace') warSpoils(w, nid, how === 'victory');
  if (how === 'victory') {
    const rep = Math.min(bal(w, 'nation:' + nid), 100);
    if (rep > 0) transfer(w, 'nation:' + nid, 'treasury', rep, `Reparations from ${n.name}`);
    n.mood = 1;
    moodShift(n, 0, 'They lost a war to us');
    n.power = Math.max(1, (n.power || 3) - 1);
    meter(w, 'stability', 6, `Victory over ${n.name}`);
    meter(w, 'prosperity', 3, 'Reparations and a victory parade');
    w.army.loyalty = clamp(w.army.loyalty + 2, 0, 5);
    w.army.reasons.unshift({ sign: '+', text: `Won the war against ${n.name}` });
    if (general) {
      w.army.hero = { id: general, until: w.now + 14 * DAY };
      stamp(w, general, 'War hero', `Victory over ${n.name}`, 'good');
      approve(w, general, 6);
      earn(w, general, 8, 'Won a war');
    }
    if (w.pm) approve(w, w.pm, 4);
    k.volunteers.forEach((id: Id) => w.citizens[id] && (stamp(w, id, 'Veteran', `The ${n.name} campaign`, 'good'), earn(w, id, 3, 'Came home a veteran')));
    legit(w, 3, `Won the war against ${n.name}`);
    // a war fought to crown a pretender, won: the pretender is sent away
    if (k.pretender && w.citizens[k.pretender]) {
      w.citizens[k.pretender].exiledUntil = w.now + 7 * DAY;
      w.citizens[k.pretender].exileNoted = false;
      gazette(w, 'hos', `${nm(w, k.pretender)}, whose claim ${n.name} fought for, goes into exile for a week.`, '#/exile');
    }
    gazette(w, 'army', `Victory. ${n.name} sues for peace and pays ${rep} crowns in reparations.${general ? ` ${nm(w, general)} comes home a war hero.` : ''} War bonds are repaid at 130%.`, '#/war', { k: 'victory', place: n.name, who: general || null });
  } else if (how === 'defeat') {
    const tribute = 60;
    transfer(w, 'treasury', 'nation:' + nid, tribute, `Tribute to ${n.name} after defeat`);
    n.mood = 1;
    moodShift(n, 0, 'They beat us in a war');
    n.power = (n.power || 3) + 1;
    meter(w, 'stability', -8, `Defeat by ${n.name}`);
    meter(w, 'prosperity', -3, 'The cost of defeat');
    w.army.loyalty = clamp(w.army.loyalty - 2, 0, 5);
    w.army.reasons.unshift({ sign: '−', text: `Lost the war against ${n.name}` });
    w.army.defeatedAt = w.now;
    if (w.pm) approve(w, w.pm, -6);
    if (general) approve(w, general, -4);
    legit(w, -4, `Lost the war against ${n.name}`);
    gazette(w, 'army', `Defeat. The realm pays ${n.name} ${tribute} crowns in tribute. The Army comes home beaten and angry. War bonds are repaid at half.`, '#/war', { k: 'defeat', place: n.name });
    // a war fought to crown a pretender, lost: the enemy puts them on the throne
    if (k.pretender && w.config.hos === 'monarchy' && w.citizens[k.pretender]?.active) imposePretender(w, k.pretender, n.name);
  } else {
    n.mood = 1;
    moodShift(n, 0, 'We made peace');
    meter(w, 'stability', 2, `Peace with ${n.name}`);
    gazette(w, 'army', `Peace with ${n.name}, with the front at ${k.score > 0 ? '+' : ''}${k.score}. War bonds are repaid in full.`, '#/war');
  }
  w.army.reasons = w.army.reasons.slice(0, 6);
}
// a week of war: it wears on the realm
export function warWeek(w: W) {
  const k = war(w);
  if (!k) return;
  meter(w, 'stability', -1, 'War weariness');
  proposeTerms(w, k);
  if (k.score < -40) (w.army.loyalty = clamp(w.army.loyalty - 1, 0, 5)), w.army.reasons.unshift({ sign: '−', text: 'A war going badly' });
}
export const heroOf = (w: W): Id | null => (w.army?.hero && w.army.hero.until > w.now ? w.army.hero.id : null);
export const beaten = (w: W) => !!w.army?.defeatedAt && w.now - w.army.defeatedAt < 14 * DAY;
export const atFront = (w: W) => !!w.army?.campaign && w.army.campaign.strategy === 'advance';
export const capitalOf = (nid: Id) => PROFILES[nid]?.capital ?? nid;

// ---------- war correspondents: a paper's editor sends a reporter to the front (10 crowns, once per war). After every
// battle the paper prints a dispatch under the editor's name; dispatches count double for the front page (society.ts) ----------
export const EMBED_COST = 10;
export function embed(w: W, actor: Id, pid: unknown) {
  const k = war(w);
  if (!k) fail('There is no war to report on.');
  mustBeFree(w, actor);
  const p = own(w.papers, pid);
  if (!p || p.editor !== actor) fail('Only the editor can send a correspondent.');
  if (w.acts?.press && p.licence !== 'granted') fail('Your paper needs a licence to report from the front.');
  k.correspondents ??= [];
  if (k.correspondents.includes(p.id)) fail(`${p.name} already has a reporter at the front.`);
  transfer(w, ca(actor), 'treasury', EMBED_COST, 'A correspondent’s pass');
  k.correspondents.push(p.id);
  gazette(w, 'press', `${p.name} sends a correspondent to the front.`, '#/war');
}
const OPENERS: Record<string, string[]> = {
  won: ['Our boys hold {where}', 'Triumph at {where}', 'The line advances at {where}', 'A famous day at {where}'],
  lost: ['Disaster at {where}', 'Retreat from {where}', 'Grim news from {where}', 'Blood and mud at {where}']
};
function dispatches(w: W, k: any, won: boolean, where: string, delta: number, loot: number, lost: number) {
  (k.correspondents || []).forEach((pid: string) => {
    const p = w.papers[pid];
    if (!p || !w.citizens[p.editor]?.active) return;
    const n = w.nations[k.nation];
    const headline = pick(w, OPENERS[won ? 'won' : 'lost']).replace('{where}', where);
    const body = `From our correspondent with the Army. ${pick(w, won ? [`The ${n.name} line broke after a hard day's fighting`, `${n.name}'s men fell back in good order, but they fell back`, `Our lads were singing by nightfall`] : [`${n.name}'s guns had the range from first light`, `We were outnumbered and it showed`, `The rain, the mud and ${n.name}'s cavalry did for us`])}${loot ? `, and the wagons came back with ${loot} crowns of spoils` : ''}.${lost ? ' One of our regiments did not come back.' : ''} The front now stands at ${k.score > 0 ? '+' : ''}${k.score}${delta ? ` (${delta > 0 ? '+' : ''}${delta} today)` : ''}.`;
    w.stories.unshift({ id: newId(w, 'st'), paper: pid, by: p.editor, headline, body, photo: null, status: 'published', at: w.now, cheers: [], war: true });
  });
  // keep the 40 newest dispatches: a long war shouldn't bury the paper
  let n = 0;
  w.stories = w.stories.filter((s: any) => !s.war || ++n <= 40);
}

// ---------- garrisons: a regiment left in a province we took keeps it from rising (foreign.ts provincesWeek) ----------
export const garrisoned = (w: W) => Object.values(w.provinces || {}).filter((p: any) => p.owner === 'realm' && p.garrison).length;
export function garrison(w: W, actor: Id, pid: unknown, on: unknown) {
  if (!hasArmy(w)) fail('There is no Army.');
  if (!canCommand(w, actor) && !canGovernEmpire(w, actor)) fail('Only the General, the Prime Minister, an officer of state or the Imperial High Commissioner posts garrisons.');
  seedProvinces(w);
  const p = own(w.provinces, pid);
  if (!p || p.owner !== 'realm') fail('That province is not ours to garrison.');
  if (on !== true && on !== false) fail('Post a garrison or withdraw it.');
  if (!!p.garrison === on) fail(on ? 'There is already a garrison there.' : 'There is no garrison there.');
  if (on && (w.army.troops ?? 6) - garrisoned(w) < 2) fail('The Army needs at least one regiment in the field.');
  p.garrison = on;
  gazette(w, 'army', on ? `A regiment is posted to ${PROVINCES[pid as string].name}.` : `The garrison leaves ${PROVINCES[pid as string].name}.`, '#/atlas', on ? { k: 'march', place: PROVINCES[pid as string].name, by: actor } : undefined);
}

// ---------- blockades: we have no navy. In wartime, each battle the enemy may seize ships at sea ----------
function blockade(w: W, k: any) {
  const n = w.nations[k.nation];
  w.ventures.forEach((v: any) => {
    if (v.status !== 'out' || !chance(w, 0.12 * blockadeFactor(w))) return;
    v.status = 'seized';
    v.returned = 0;
    gazette(w, 'army', `${n.name}'s raiders seize a ship bound for ${w.nations[v.nation]?.name}. ${nm(w, v.by)}'s venture is lost.`, '#/war');
  });
}

// ---------- peace conferences: once a week while a war is stalled, the enemy proposes terms. MPs vote for a day;
// a majority of votes cast makes peace on those terms. Terms follow the front: losing, they ask; winning, we are asked ----------
export const TERMS_HOURS = 24;
function proposeTerms(w: W, k: any) {
  if (k.terms?.status === 'open' || w.now - k.startedAt < 4 * DAY || Math.abs(k.score) >= 60) return;
  seedProvinces(w);
  const n = w.nations[k.nation];
  const ahead = k.score > 0; // we are winning: they offer; otherwise they demand
  const kinds = ['tribute', 'land', 'hostage'];
  const land = Object.keys(PROVINCES).find((id) => (ahead ? w.provinces[id].owner === n.id : w.provinces[id].owner === 'realm' && PROVINCES[id].claims.includes(n.id)));
  let kind = pick(w, kinds.filter((x) => x !== 'land' || land));
  // the enemy asks for a minister, or failing that any MP
  const hostages = (mps(w).filter((id) => inGov(w, id)).length ? mps(w).filter((id) => inGov(w, id)) : mps(w)).filter((id) => w.citizens[id]?.active);
  if (kind === 'hostage' && (ahead || !hostages.length)) kind = 'tribute';
  const crowns = 30 + Math.round(rand(w) * 50);
  k.terms = { id: newId(w, 'tm'), kind, ahead, province: kind === 'land' ? land : null, crowns: kind === 'tribute' ? crowns : 0, hostage: kind === 'hostage' ? pick(w, hostages) : null, at: w.now, closesAt: w.now + TERMS_HOURS * HOUR, votes: {}, status: 'open' };
  const solo = autocrat(w);
  gazette(w, 'army', `${n.name} proposes peace: ${termsText(w, k.terms, n.name)}. ${solo ? `${cap(autocratTitle(w))} alone will accept or reject them, within a day.` : 'MPs have a day to accept or reject.'}`, '#/war');
}
export function termsText(w: W, t: any, name: string) {
  if (t.kind === 'land') return t.ahead ? `they give up ${PROVINCES[t.province]?.name}` : `we give up ${PROVINCES[t.province]?.name}`;
  if (t.kind === 'hostage') return `${nm(w, t.hostage)} goes to ${name} as a hostage for a week`;
  return t.ahead ? `they pay us ${t.crowns} crowns` : `we pay them ${t.crowns} crowns`;
}
export function voteTerms(w: W, actor: Id, yes: unknown) {
  const k = war(w);
  const t = k?.terms;
  if (!t || t.status !== 'open') fail('There are no terms on the table.');
  // under one-person rule the ruler answers alone, and at once
  const solo = autocrat(w);
  if (solo ? actor !== solo : !isMP(w, actor)) fail(solo ? `Only ${autocratTitle(w)} answers terms of peace.` : 'Only MPs vote on terms of peace.');
  mustBeFree(w, actor);
  if (yes !== true && yes !== false) fail('Accept or reject.');
  t.votes[actor] = yes;
  if (solo) settleTerms(w);
}
export function settleTerms(w: W) {
  const k = war(w);
  const t = k?.terms;
  if (!t || t.status !== 'open') return;
  const v = Object.values(t.votes);
  const ayes = v.filter((x) => x).length;
  const noes = v.length - ayes;
  t.status = ayes > noes ? 'accepted' : 'rejected';
  t.result = { ayes, noes };
  const n = w.nations[k.nation];
  const who = autocrat(w) ? cap(autocratTitle(w)) : 'The House';
  const score = autocrat(w) ? '' : `, ${ayes} to ${noes}`;
  if (t.status === 'rejected') return gazette(w, 'army', `${who} rejects ${n.name}'s terms${score}. The war goes on.`, '#/war');
  gazette(w, 'army', `${who} accepts ${n.name}'s terms${score}: ${termsText(w, t, n.name)}.`, '#/war');
  if (t.kind === 'land' && t.province) w.provinces[t.province] = { owner: t.ahead ? 'realm' : n.id, since: w.now, garrison: false };
  if (t.kind === 'tribute') {
    if (t.ahead) { const c = Math.min(t.crowns, bal(w, 'nation:' + n.id)); if (c > 0) transfer(w, 'nation:' + n.id, 'treasury', c, `Peace terms from ${n.name}`); }
    else transfer(w, 'treasury', 'nation:' + n.id, t.crowns, `Peace terms to ${n.name}`);
  }
  if (t.kind === 'hostage' && w.citizens[t.hostage]) {
    const c = w.citizens[t.hostage];
    takeHostage(w, t.hostage, n.id);
    c.exiledUntil = w.now + 7 * DAY;
    c.exileNoted = false;
    c.asylum = n.id;
    stamp(w, t.hostage, 'Hostage', `Held in ${PROFILES[n.id]?.capital} for the peace`, 'ink');
    approve(w, t.hostage, 5);
  }
  endWar(w, 'peace');
}

// ---------- the war memorial: after a war, MPs vote for two days on whose names go on it (the volunteers and the
// General). A name with a majority of the MPs who voted is carved: a stamp, and a place in the Hall of Fame ----------
function openMemorial(w: W, record: any, k: any) {
  const names = [...new Set([...(k.volunteers || []), record.general].filter((id: any) => id && w.citizens[id]))] as Id[];
  if (!names.length || record.battles < 2) return;
  w.memorials ??= [];
  w.memorials.unshift({ id: newId(w, 'mem'), nation: record.nation, outcome: record.outcome, names, votes: {}, closesAt: w.now + 2 * DAY, status: 'open', carved: [] });
  w.memorials = w.memorials.slice(0, 10);
  gazette(w, 'army', autocrat(w) ? `${cap(autocratTitle(w))} will choose whose names go on the memorial to the ${w.nations[record.nation].name} war.` : `The House will decide whose names go on the memorial to the ${w.nations[record.nation].name} war. MPs have two days.`, '#/war');
}
export function voteMemorial(w: W, actor: Id, mid: unknown, names: unknown) {
  const m = (w.memorials || []).find((x: any) => x.id === mid);
  if (!m || m.status !== 'open') fail('That memorial vote is closed.');
  const solo = autocrat(w);
  if (solo ? actor !== solo : !isMP(w, actor)) fail(solo ? `Only ${autocratTitle(w)} chooses the names.` : 'Only MPs decide the memorial.');
  if (!Array.isArray(names) || names.length > 30 || names.some((x) => typeof x !== 'string' || !m.names.includes(x))) fail('Pick names from the list.');
  m.votes[actor] = [...new Set(names as string[])];
  if (solo) closeMemorial(w, m);
}
export function closeMemorial(w: W, m: any) {
  m.status = 'closed';
  const voters = Object.keys(m.votes).length;
  m.carved = m.names.filter((id: Id) => voters > 0 && Object.values(m.votes).filter((l: any) => l.includes(id)).length * 2 > voters);
  const n = w.nations[m.nation]?.name ?? 'abroad';
  m.carved.forEach((id: Id) => stamp(w, id, 'On the memorial', `The ${n} war`, 'good'));
  // every carved name draws a veteran's pension each payday (config.veteranPension, set by law)
  w.pensions ??= {};
  m.carved.forEach((id: Id) => (w.pensions[id] ??= { since: w.now, war: n }));
  const f = fame(w);
  f.memorials = [{ nation: n, outcome: m.outcome, at: w.now, names: m.carved.map((id: Id) => nm(w, id)) }, ...(f.memorials || [])].slice(0, 30);
  gazette(w, 'army', m.carved.length ? `The memorial to the ${n} war is unveiled. Carved on it: ${m.carved.map((id: Id) => nm(w, id)).join(', ')}.` : `The memorial to the ${n} war is unveiled with no names on it.`, '#/fame', { k: 'memorial', place: n });
}

// ---------- veterans' pensions: paid each payday to every name on a memorial, at the rate the law sets (0 cuts them) ----------
export const pensionRate = (w: W) => w.config.veteranPension ?? 3;
export function payPensions(w: W) {
  const r = pensionRate(w);
  if (r <= 0) return;
  Object.keys(w.pensions || {}).forEach((id) => w.citizens[id]?.active && transfer(w, 'treasury', ca(id), r, "A veteran's pension"));
}
