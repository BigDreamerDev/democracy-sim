// War: a campaign against one nation, fought in battles every 12 hours until one side breaks (the front reaches
// ±100) or Parliament makes peace. The Army's regiments, readiness and loyalty, allies, volunteers and an embargo
// decide the odds; the General (or the PM) chooses the strategy. Citizens can enlist or buy war bonds.
// Victory and defeat feed the coup system (backroom.ts): a war hero weighs more on a coup night, a beaten Army
// leans towards the plotters, and an Army at the front cannot defend the capital.
// State: w.army.war = the enemy's id (as before), w.army.campaign = this war, w.army.hero, w.army.defeatedAt, w.wars (history).
import { W, Id, DAY, HOUR, fail, rand, chance, nm, gazette, earn, transfer, bal, ca, hasPower, isPM, holderOf, clamp, meter, approve, stamp, bump, mustBeFree, int, legit, own } from './core';
import { moodShift, treatyWith, PROFILES } from './foreign';
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
export const allies = (w: W) => Object.values(w.nations).filter((n: any) => n.id !== w.army.war && treatyWith(w, n.id, 'alliance') && n.mood >= 2) as any[];
export function power(w: W) {
  const k = war(w);
  const troops = w.army.troops ?? 6;
  const lines: [string, number][] = [[`${troops} regiments`, troops], [`Readiness: ${w.army.readiness}`, troops * (READY[w.army.readiness] - 1)], [`Loyalty ${w.army.loyalty}/5`, troops * (w.army.loyalty - 3) * 0.1]];
  if (holderOf(w, 'army')) lines.push(['A General in command', 1]);
  allies(w).forEach((n) => lines.push([`${n.name} fights beside us`, Math.round((n.power || 3) / 2)]));
  if (k?.volunteers?.length) lines.push([`${k.volunteers.length} volunteer${k.volunteers.length === 1 ? '' : 's'}`, k.volunteers.length * 0.5]);
  const us = Math.max(0.5, lines.reduce((s, l) => s + l[1], 0));
  const n = k && w.nations[k.nation];
  const them = n ? Math.max(0.5, (n.power || 3) * (n.embargo ? 0.85 : 1)) : 1;
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
  if (by === 'them') gazette(w, 'army', cause?.pretender ? `${n.name} declares war to put ${nm(w, cause.pretender)} on our throne. The first battle is in 12 hours.` : `${n.name} declares war on the realm. Army upkeep doubles until the war is won, lost, or Parliament makes peace. The first battle is in 12 hours.`, '#/war');
  else gazette(w, 'army', `The realm is at war with ${n.name}. Army upkeep doubles. The first battle is in 12 hours.`, '#/war');
}

// the General, the PM or an officer of state picks how the Army fights
export function setStrategy(w: W, actor: Id, s: string) {
  const k = war(w);
  if (!k) fail('We are not at war.');
  if (!canCommand(w, actor)) fail('Only the General, the Prime Minister or an officer of state commands the Army.');
  if (!own(STRATEGIES, s)) fail('Hold, advance or raid.');
  if (k.strategy === s) fail('That is already the order.');
  k.strategy = s;
  gazette(w, 'army', `New orders at the front: ${STRATEGIES[s].label.toLowerCase()}.`, '#/war');
}
// raise regiments, paid from the Treasury
export function recruit(w: W, actor: Id, n: unknown) {
  if (!w.offices.army) fail('There is no Army: pass the Defence Act first.');
  if (!canCommand(w, actor)) fail('Only the General, the Prime Minister or an officer of state raises regiments.');
  const k = int(n, 1, 5, 'number of regiments');
  const have = w.army.troops ?? 6;
  if (have + k > MAX_REGIMENTS) fail(`The realm can field ${MAX_REGIMENTS} regiments at most. It has ${have}.`);
  transfer(w, 'treasury', 'reserve', REGIMENT_COST * k, `Raised ${k} regiment${k === 1 ? '' : 's'}`);
  w.army.troops = have + k;
  gazette(w, 'army', `${k} new regiment${k === 1 ? ' is' : 's are'} raised. The Army now fields ${w.army.troops}.`, '#/army');
}
export function disband(w: W, actor: Id, n: unknown) {
  if (!w.offices.army) fail('There is no Army.');
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
  if (k.volunteers.length >= 12) fail('The recruiting sergeants have all the volunteers they can take.');
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
  const amt = int(amount, 5, 100, 'amount');
  if ((k.bonds[actor] || 0) + amt > 100) fail(`You can hold 100 crowns of war bonds at most. You hold ${k.bonds[actor] || 0}.`);
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
    loot = Math.min(bal(w, 'nation:' + n.id), 10 + Math.round(rand(w) * 15));
    if (loot > 0) transfer(w, 'nation:' + n.id, 'treasury', loot, `Spoils of a raid on ${n.name}`);
  }
  k.score = clamp(k.score + delta, -100, 100);
  const text = won ? `Victory at ${where}${loot > 0 ? `, and ${loot} crowns of spoils` : ''}.${lost ? ' A regiment is lost.' : ''}` : `Defeat at ${where}.${lost ? ' A regiment is lost.' : ''}`;
  k.battles.unshift({ at: w.now, won, where, delta, lost, loot, us: p.us, them: p.them });
  k.battles = k.battles.slice(0, 30);
  gazette(w, 'army', `${text} The front stands at ${k.score > 0 ? '+' : ''}${k.score}.`, '#/war');
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
  // war bonds are repaid from the Treasury, which borrows if it must
  Object.entries(k.bonds || {}).forEach(([id, amt]: any) => {
    const pay = Math.round(amt * BOND_PAYS[how]);
    if (pay > 0 && w.citizens[id]) transfer(w, 'treasury', ca(id), pay, `War bonds repaid (${how})`);
  });
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
    gazette(w, 'army', `Victory. ${n.name} sues for peace and pays ${rep} crowns in reparations.${general ? ` ${nm(w, general)} comes home a war hero.` : ''} War bonds are repaid at 130%.`, '#/war');
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
    gazette(w, 'army', `Defeat. The realm pays ${n.name} ${tribute} crowns in tribute. The Army comes home beaten and angry. War bonds are repaid at half.`, '#/war');
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
  if (k.score < -40) (w.army.loyalty = clamp(w.army.loyalty - 1, 0, 5)), w.army.reasons.unshift({ sign: '−', text: 'A war going badly' });
}
export const heroOf = (w: W): Id | null => (w.army?.hero && w.army.hero.until > w.now ? w.army.hero.id : null);
export const beaten = (w: W) => !!w.army?.defeatedAt && w.now - w.army.defeatedAt < 14 * DAY;
export const atFront = (w: W) => !!w.army?.campaign && w.army.campaign.strategy === 'advance';
export const capitalOf = (nid: Id) => PROFILES[nid]?.capital ?? nid;
