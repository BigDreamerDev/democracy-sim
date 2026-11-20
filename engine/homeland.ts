// The homeland strikes back. What the realm can do about its defectors: ask for them back (extradition), smear them at
// their new court, snatch them home, seize what they left behind, or offer an amnesty. And the Security Service can
// send a plant: a citizen who defects on its orders, reports home and sabotages the host, until they come in from the
// cold or are unmasked.
// State: c.defected.amnesty {by, at} (public), .seized, .extraditionAt, .snatchAt (public), .plant {id, by, at} (secret:
// the plant, the PM and the Director only); w.plants (offers: the plant, who sent it, the PM and the Director);
// w.ops (the Service's operations log: PM and Director only).
import { W, Id, DAY, fail, own, cit, nm, gazette, transfer, bal, ca, chance, rand, clamp, approve, stamp, earn, meter, isPM, isHOS, hasPower, holderOf, newId, addCard, mustBeFree, bump } from './core';
import { moodShift, PROFILES } from './foreign';
import { rankOf, bringHome, unmaskPlant, defect } from './abroad';
import { openTrial } from './trials';

export const canSecurity = (w: W, id: Id) => !!w.offices.security && (hasPower(w, id, 'intel') || (isPM(w, id) && !holderOf(w, 'security')));
export const canExtradite = (w: W, id: Id) => isPM(w, id) || hasPower(w, id, 'envoy');
export const canSeize = (w: W, id: Id) => holderOf(w, 'treasury') === id || (isPM(w, id) && !holderOf(w, 'treasury'));
export const OP_COST = { discredit: 15, snatch: 40, plant: 30 };
export const EXTRADITE_COOL = 3 * DAY;
export const SNATCH_COOL = 3 * DAY;

function target(w: W, id: unknown) {
  const c = cit(w, id as Id);
  if (!c.defected) fail(`${c.name} is not abroad.`);
  return c;
}
function budget(w: W, n: number, what: string) {
  if (bal(w, 'office:security') < n) fail(`${what} costs ${n} from the Service's budget. It has ${bal(w, 'office:security')}.`);
}
const log = (w: W, op: any) => {
  w.ops = [{ id: newId(w, 'op'), at: w.now, ...op }, ...(w.ops || [])].slice(0, 40);
};
const note = (c: any, w: W, what: string) => (c.defected.deeds = [{ at: w.now, what, home: true }, ...(c.defected.deeds || [])].slice(0, 20));
// the odds a nation hands someone over: friends oblige, enemies laugh
export function extraditeOdds(w: W, c: any) {
  const n = w.nations[c.defected.nation];
  if (c.defected.naturalised || n.ruler?.id === c.id) return 0;
  return clamp(([0.03, 0.1, 0.25, 0.45, 0.6][n.mood] ?? 0.2) - c.defected.favour / 250, 0.02, 0.6);
}
export function snatchOdds(w: W, c: any) {
  const n = w.nations[c.defected.nation];
  if (n.ruler?.id === c.id) return 0.05;
  return clamp(0.5 - 0.08 * Math.max(0, rankOf(w, c.id)) - 0.07 * Math.max(0, (c.defected.home || 0) - 1) - (n.mood <= 1 ? 0.1 : 0), 0.05, 0.6);
}

// ---------- diplomacy: ask the host nation to hand them over ----------
export function extradite(w: W, actor: Id, tid: unknown) {
  if (!canExtradite(w, actor)) fail('Only the Prime Minister or the Foreign Minister asks for a defector back.');
  const c = target(w, tid);
  const d = c.defected;
  const n = w.nations[d.nation];
  if (d.naturalised) fail(`${c.name} is a citizen of ${n.name} now. They will not hand over their own.`);
  if (n.ruler?.id === c.id) fail(`${c.name} rules ${n.name}. Nobody extradites a head of state.`);
  if (d.extraditionAt && w.now - d.extraditionAt < EXTRADITE_COOL) fail(`${n.name} answered only recently. Wait before asking again.`);
  d.extraditionAt = w.now;
  if (chance(w, extraditeOdds(w, c))) {
    bringHome(w, c, 'Extradited', 3);
    stamp(w, c.id, 'Extradited', `Handed back by ${n.name}`, 'bad');
    approve(w, c.id, -3);
    bump(w, actor, 'extradited');
    gazette(w, 'foreign', `${n.name} hands ${nm(w, c.id)} back to the realm at the request of ${nm(w, actor)}. They are held at the border for three days.`, '#/abroad');
    if (!d.plant) openTrial(w, c.id, 'treason', actor, `extradited from ${n.name}`);
    return;
  }
  moodShift(n, -1, `We demanded they hand over ${c.name}`);
  d.favour = clamp(d.favour + 4, 0, 100);
  note(c, w, `The realm asked ${n.name} to hand you over. The court refused (+4 favour)`);
  gazette(w, 'foreign', `${n.name} refuses to hand ${nm(w, c.id)} back to the realm.`, '#/abroad');
}
// ---------- the Security Service: a whispering campaign at their new court ----------
export function discredit(w: W, actor: Id, tid: unknown) {
  if (!canSecurity(w, actor)) fail('Only the Director of the Security Service runs operations abroad.');
  const c = target(w, tid);
  if ((w.ops || []).some((o: any) => o.by === actor && o.kind === 'discredit' && w.now - o.at < DAY)) fail('One whispering campaign a day.');
  budget(w, OP_COST.discredit, 'A whispering campaign');
  transfer(w, 'office:security', 'nation:' + c.defected.nation, OP_COST.discredit, 'Paid to sources abroad');
  const d = c.defected;
  if (chance(w, 0.7)) {
    const amt = Math.min(d.favour, 8 + Math.floor(rand(w) * 7));
    d.favour -= amt;
    note(c, w, `Ugly rumours from home cost you ${amt} favour at court`);
    const n = w.nations[d.nation];
    if (n.ruler?.id === c.id && d.favour < 50) {
      n.ruler = null;
      gazette(w, 'foreign', `${nm(w, c.id)} loses the rule of ${n.name}, brought down by scandal.`, '#/abroad');
    }
    log(w, { kind: 'discredit', by: actor, target: c.id, nation: d.nation, ok: true, text: `Cost ${c.name} ${amt} favour.` });
    return;
  }
  d.favour = clamp(d.favour + 3, 0, 100);
  note(c, w, 'The realm tried to smear you. The court saw through it (+3 favour)');
  log(w, { kind: 'discredit', by: actor, target: c.id, nation: d.nation, ok: false, text: 'The court saw through it.' });
}
// ---------- the Security Service: a snatch squad brings them home by force ----------
export function snatch(w: W, actor: Id, tid: unknown) {
  if (!canSecurity(w, actor)) fail('Only the Director of the Security Service orders a snatch.');
  const c = target(w, tid);
  const d = c.defected;
  if (d.snatchAt && w.now - d.snatchAt < SNATCH_COOL) fail(`${c.name} is on their guard after the last attempt. Wait a few days.`);
  budget(w, OP_COST.snatch, 'A snatch squad');
  const n = w.nations[d.nation];
  const cap = PROFILES[n.id]?.capital ?? n.name;
  transfer(w, 'office:security', 'treasury', OP_COST.snatch, 'Operational costs abroad');
  d.snatchAt = w.now;
  if (chance(w, snatchOdds(w, c))) {
    moodShift(n, -1, `Agents of the realm seized ${c.name} on their soil`);
    bringHome(w, c, 'Snatched', d.plant ? 0 : 5);
    stamp(w, c.id, 'Brought home', `Seized by the Security Service in ${cap}`, 'bad');
    log(w, { kind: 'snatch', by: actor, target: c.id, nation: n.id, ok: true, text: `Brought ${c.name} home.` });
    earn(w, actor, 3, 'A defector brought home');
    gazette(w, 'foreign', `Agents of the realm seize ${nm(w, c.id)} in ${cap} and bring them home${d.plant ? '' : ', to be held at the border until their trial'}. ${n.name} protests.`, '#/abroad');
    if (!d.plant) openTrial(w, c.id, 'treason', actor, `seized in ${cap}`);
    return;
  }
  moodShift(n, -2, `They caught our agents trying to seize ${c.name}`);
  meter(w, 'stability', -1, 'A botched operation abroad');
  d.favour = clamp(d.favour + 5, 0, 100);
  note(c, w, `Agents of the realm tried to seize you in ${cap}. The guards stopped them (+5 favour)`);
  log(w, { kind: 'snatch', by: actor, target: c.id, nation: n.id, ok: false, text: 'The squad was caught.' });
  addCard(w, { title: `The botched snatch of ${c.name} in ${cap} was ordered by ${nm(w, actor)}.`, about: actor, from: 'Security Service', level: 'secret', viewers: ['pm', 'office:security'] });
  gazette(w, 'scandal', `Agents of the realm are caught trying to seize ${nm(w, c.id)} in ${cap}. ${n.name} is furious.`, '#/abroad');
}
// ---------- the Treasury: what they left behind is forfeit (half their wallet, once a defection) ----------
export function seize(w: W, actor: Id, tid: unknown) {
  if (!canSeize(w, actor)) fail('Only the Chancellor (or the PM with no Chancellor) seizes a defector’s money.');
  const c = target(w, tid);
  const d = c.defected;
  if (d.seized) fail(`${c.name}'s money has already been seized once.`);
  if (d.plant && canSecurity(w, actor)) fail('That is one of ours. Leave their cover money alone.');
  const amt = Math.floor(bal(w, ca(c.id)) / 2);
  if (amt < 1) fail(`${c.name} has nothing to seize.`);
  transfer(w, ca(c.id), 'treasury', amt, `Assets of a defector, forfeit to the Treasury`);
  d.seized = { by: actor, at: w.now, amt };
  note(c, w, `The Treasury seized ${amt} crowns of yours`);
  gazette(w, 'money', `The Treasury seizes ${amt} crowns from ${nm(w, c.id)}, who defected to ${w.nations[d.nation].name}.`, '#/abroad');
}
// ---------- the Prime Minister: an amnesty. They may come home with no questions asked ----------
export function amnesty(w: W, actor: Id, tid: unknown, on: unknown) {
  if (!isPM(w, actor)) fail('Only the Prime Minister offers an amnesty.');
  const c = target(w, tid);
  const d = c.defected;
  if (on === false) {
    if (!d.amnesty) fail('There is no amnesty to withdraw.');
    d.amnesty = null;
    note(c, w, 'The Prime Minister withdrew your amnesty');
    return gazette(w, 'foreign', `The Prime Minister withdraws ${nm(w, c.id)}'s amnesty.`, '#/abroad');
  }
  if (d.naturalised) fail(`${c.name} has sworn allegiance to ${w.nations[d.nation].name}.`);
  if (d.amnesty) fail('They have an amnesty already.');
  d.amnesty = { by: actor, at: w.now };
  note(c, w, 'The Prime Minister offers you an amnesty: come home, no questions asked');
  gazette(w, 'foreign', `${nm(w, actor)} offers ${nm(w, c.id)} an amnesty: come home from ${w.nations[d.nation].name}, and no questions will be asked.`, '#/abroad');
}

// ---------- plants: the Director asks a citizen, in private, to defect on the Service's orders ----------
export function offerPlant(w: W, actor: Id, tid: unknown, nid: unknown) {
  if (!canSecurity(w, actor)) fail('Only the Director of the Security Service sends someone over.');
  const c = cit(w, tid as Id);
  const n = own(w.nations, nid);
  if (!n) fail('Pick a nation.');
  if (c.id === actor) fail('Send someone else. The Service needs its Director at home.');
  if (c.bot || !c.active) fail('Pick a citizen.');
  if (c.defected) fail(`${c.name} is abroad already.`);
  if (isPM(w, c.id) || isHOS(w, c.id)) fail('The Prime Minister and the head of state cannot vanish abroad.');
  w.plants ??= {};
  if (Object.values(w.plants).some((p: any) => p.to === c.id && p.status === 'offered')) fail(`${c.name} already has an offer to consider.`);
  if (Object.values(w.plants).some((p: any) => p.nation === n.id && (p.status === 'offered' || (p.status === 'abroad' && w.citizens[p.to]?.defected?.plant?.id === p.id)))) fail(`We already have someone going to ${n.name}.`);
  budget(w, OP_COST.plant, 'Sending someone over');
  transfer(w, 'office:security', 'escrow', OP_COST.plant, 'Cover money for an agent');
  const id = newId(w, 'pt');
  w.plants[id] = { id, by: actor, to: c.id, nation: n.id, at: w.now, until: w.now + 2 * DAY, status: 'offered' };
  log(w, { kind: 'plant', by: actor, target: c.id, nation: n.id, ok: null, text: `Asked ${c.name} to go over to ${n.name}.` });
}
export function answerPlant(w: W, actor: Id, pid: unknown, yes: unknown) {
  const p = own(w.plants || {}, pid);
  if (!p || p.to !== actor || p.status !== 'offered' || p.until < w.now) fail('There is no such offer for you.');
  if (yes !== true) {
    p.status = 'refused';
    transfer(w, 'escrow', 'office:security', OP_COST.plant, 'Cover money returned');
    return;
  }
  mustBeFree(w, actor);
  defect(w, actor, p.nation);
  const c = w.citizens[actor];
  c.defected.plant = { id: p.id, by: p.by, at: w.now };
  p.status = 'abroad';
  transfer(w, 'escrow', ca(actor), OP_COST.plant, 'A private arrangement');
}
export function lapsePlant(w: W, p: any) {
  if (p.status !== 'offered') return;
  p.status = 'lapsed';
  transfer(w, 'escrow', 'office:security', OP_COST.plant, 'Cover money returned');
}
// once a week: each plant risks discovery (more as they rise, since more eyes are on them)
export function homelandWeek(w: W) {
  Object.values(w.citizens).forEach((c: any) => {
    const d = c.defected;
    if (!c.active || !d?.plant || c.agentOf === d.nation) return;
    if (d.turnOffer && d.turnOffer.until <= w.now) {
      // they ignored the court's offer: it takes that as a no, and watches them harder
      d.turnOffer = null;
      d.suspected = true;
    }
    if (d.turnOffer) return;
    const risk = 0.06 + 0.02 * Math.max(0, rankOf(w, c.id)) + (d.suspected ? 0.1 : 0);
    if (!chance(w, risk)) return;
    // found out: a hostile court would rather turn a spy than expel one
    if (w.nations[d.nation].mood <= 2 && !d.suspected && chance(w, 0.6)) d.turnOffer = { at: w.now, until: w.now + 2 * DAY };
    else unmaskPlant(w, c, 'the court’s own spies found them out');
  });
  // a plant who is home again is done; closed offers older than a fortnight are forgotten
  Object.values(w.plants || {}).forEach((p: any) => p.status === 'abroad' && w.citizens[p.to]?.defected?.plant?.id !== p.id && (p.status = 'home'));
  Object.values(w.plants || {}).forEach((p: any) => p.status !== 'offered' && p.status !== 'abroad' && w.now - p.at > 14 * DAY && delete w.plants[p.id]);
}
