// Acts that change how the realm is governed. Each is a clause a bill (or a decree) can contain: 'jail', 'decrees',
// 'continuity', 'unity'. When the law is enacted, w.acts[key] holds its law number and the rules below switch on;
// repealing that law switches them off again. Nothing here works unless Parliament (or a decree) made it law.
// - jail: the Ministry of Public Order and the Realm Jail. Detention (c.jail) has no end unless the order gives one;
//   only the PM or the Minister releases, or a repeal. Regime pardons, amnesties, jailbreaks and a regime's fall don't.
// - decrees: the PM makes law by decree (gov.decree), and issues the built-in regime decrees with no regime in place
//   (gov.edict: a 'civil' w.regime with no legitimacy). Bills get assent after an hour; the head of state can't refuse.
// - continuity: no general (or Speaker) elections; the PM appoints the Speaker and fills or empties seats. Seasons
//   still end every term (w.seasonDueAt).
// - unity: the PM's party is the only one (w.acts.national). Joining needs the PM's approval; MPs voting against
//   the PM are expelled; no challenges, splits or new parties.
import { W, Id, DAY, HOUR, fail, newId, cit, nm, own, int, text, allCitizens, exiled, detained, jailed, gazette, stamp, bump, isPM, isHOS, isMP, hasPower, inForce, inGov, isMinister, addCard } from './core';
import { setHos } from './politics';

import { createOffice, lotOfficeRefresh } from './offices';
import { members, countback, vacateSeat, endSeason, clearMinisters } from './politics';
import { checkClauses, enactDecree } from './proposals';
import { voidMarket } from './markets';
import { endCivil } from './regime';

export type ActKey = 'jail' | 'decrees' | 'continuity' | 'unity' | 'protection' | 'press' | 'security' | 'crown' | 'prerogative' | 'veto';
export const ACT_KEYS: ActKey[] = ['jail', 'decrees', 'continuity', 'unity', 'protection', 'press', 'security', 'crown', 'prerogative', 'veto'];
export const PREROGATIVE_DAYS = 3;
export const ACTS: Record<ActKey, { name: string; text: string }> = {
  // the monarch may strike a pending bill from the order paper
  veto: {
    name: 'Royal Veto',
    text: 'The Monarch may strike any bill from the order paper at any stage before it becomes law: waiting for consent, in debate, at the vote, or awaiting assent. A struck bill falls and cannot become law; bets on it are refunded. A bill to remove the head of state cannot be struck, unless the Protection of the State Act already makes its removal void.'
  },
  // assent is the monarch's to give or refuse again
  prerogative: {
    name: 'Royal Prerogative',
    text: `Every bill passed by the House waits for the Royal Assent of the Monarch, who may give it or refuse it. Nothing becomes law by convention or by the passing of time: a bill not given assent within ${PREROGATIVE_DAYS} days lapses. Where the Government Powers Act says otherwise, this Act prevails. A bill that removes the head of state still needs no assent.`
  },
  jail: {
    name: 'Public Order and Detention',
    text: 'Creates the Ministry of Public Order, led by the Minister of Public Order, appointed and removed by the Prime Minister: restricted, with a budget of 20 crowns a week, and the powers to fine a citizen up to 10 crowns (as often as it likes), guard one citizen from assassins each day, detain a citizen and release a detainee. The Minister or the Prime Minister may detain any active citizen except the Prime Minister and the head of state, with no trial, charge, vote or reason, for as long as the order says or with no end date. A detainee is held in the Realm Jail: they cannot vote, stand (they are withdrawn from any election), table, edit, amend or speak on any proposal, sign anything, or found, join, lead or split a party. A detained MP keeps their seat, suspended and not filled by countback. A detainee loses every office and any party leadership. Detention does not end at an election, a change of government, the end of a season or the fall of any regime, and no pardon, asylum, court, amnesty or jailbreak releases a detainee. Only the Prime Minister or the Minister of Public Order may release one, or the repeal of this law. The Realm Jail page lists every detainee, who ordered it, and when.'
  },
  decrees: {
    name: 'Government Powers',
    text: 'The Prime Minister may issue a decree at any time, containing anything a bill can, including changes to the constitution. It becomes law the moment it is issued, with no debate, vote, referendum or wait, and gets a law number. The Prime Minister may also issue any of the built-in regime decrees, once a day, with no legitimacy cost and no regime in place. Decrees need no assent. A bill passed by the House receives assent one hour after it passes unless the head of state signs it sooner; the head of state can no longer refuse. Where a decree and another law conflict, the decree wins, and only a later decree can amend or repeal a decree. Nothing that suspends Parliament suspends this power.'
  },
  continuity: {
    name: 'Continuity of Parliament',
    text: 'No general election is called or held, at the end of a term or at any other time, including snap elections, dissolutions, hung Parliaments, the end of martial law or a coup, and the fall of a regime or a provisional government. Any general election open when this law passes is cancelled. Seasons still end on their normal schedule, for scoring only. The sitting MPs keep their seats indefinitely. No Speaker election is held: the Prime Minister appoints, removes and replaces the Speaker, who must not be an MP. An empty seat is not filled by countback: the Prime Minister appoints any active citizen who is not detained to it. The Prime Minister may remove any MP from their seat at any time.'
  },
  unity: {
    name: 'National Unity',
    text: 'The party led by the Prime Minister becomes the National Party, the only legal party. Every other party is dissolved: its members become independents, and its name and colour can never be used again. No new party can be founded. A citizen joins the National Party only with the Prime Minister’s approval, and the Prime Minister may expel any member. The National Party cannot split; members may leave. The Prime Minister leads it for as long as they are Prime Minister, with no challenges, contests or standing down. In any election that still takes place, only National Party members may stand. In House votes the National Party line is the Prime Minister’s own vote, and an MP who votes against it is expelled from the party automatically.'
  }
  ,
  crown: { name: 'Crown', text: '' },
  protection: {
    name: 'Protection of the State',
    text: 'Motions of no confidence can no longer be tabled; any open one is withdrawn and any confidence deadline is cancelled, and the government cannot fall for lack of confidence. The Prime Minister, ministers and the head of state cannot be censured, and their censures are cleared. No proposal can be tabled, and no amendment moved to a government proposal, without the Prime Minister’s consent; only the Prime Minister can call a referendum. Demands made with a secret card against the Prime Minister or a minister are void and cannot be sent, and cards about the Prime Minister cannot be leaked. If the State Security Act is not law, every coup plot is discovered one hour after it starts, and its members are detained under the Public Order and Detention Act if it is law, or otherwise exiled indefinitely. The head of state cannot be removed or changed, nor the kind of head of state, except by decree of the Prime Minister; if the head of state leaves office, the Prime Minister appoints the next. The Prime Minister may name a Deputy, who becomes Prime Minister at once if the Prime Minister leaves office; with no Deputy, the longest-serving MP of the Prime Minister’s party does. This Act and the Public Order and Detention, Government Powers, Continuity of Parliament, National Unity, Press and Information and State Security Acts can only be amended or repealed by decree of the Prime Minister.'
  },
  press: {
    name: 'Press and Information',
    text: 'A newspaper can only publish while it holds a licence from the Ministry of Public Order. Existing papers lose their licence unless the Ministry renews it within 24 hours, and the Ministry can withdraw any licence at any time. The Prime Minister or the Minister of Public Order can remove any published story or debate speech, with no Gazette entry. A secret card about a member of the government cannot be leaked; a citizen who tries is detained under the Public Order and Detention Act if it is law. Formal questions to ministers and questions at Prime Minister’s Questions are only published if the Prime Minister approves them.'
  },
  security: {
    name: 'State Security',
    text: 'While the post of Director of the Security Service is vacant, the Prime Minister holds all of its powers, and may make two investigations a day. A coup needs two more plotters than the rules otherwise require, and never fewer than four. Every coup launch goes to the 12-hour contested night. On that night the government side gets +3 for loyal security forces, the Prime Minister counts 2, and every minister counts as declared for the government unless they declare otherwise. When any plot reaches three members, the Prime Minister is told privately that a plot of that size exists, but not who is in it. Plotters caught by a raid or discovery, and plotters in a failed coup, are detained under the Public Order and Detention Act if it is law. A minister who joins a plot loses their post the moment it is discovered or launched.'
  }
};
// (the Crown Act: the head of state is the Prime Minister)
ACTS.crown = {
  name: 'Crown',
  text: 'The head of state is also the Prime Minister, at all times, and holds every power of that office. There is no separate Prime Minister: whoever holds the post leaves office when this becomes law, and nobody else can be invited to form a government. The Crown cannot lose the confidence of the House, and cannot resign the premiership. When a new head of state takes office, they become Prime Minister at once. While the post of head of state is empty, a government is formed as the law otherwise provides, until there is one.'
};
// the Acts that only a decree can amend or repeal once the Protection of the State Act is law
export const ENTRENCHED: ActKey[] = ['protection', 'jail', 'decrees', 'continuity', 'unity', 'press', 'security'];

// ================= Enacting and repealing =================
export function applyAct(w: W, key: ActKey, ref: string) {
  w.acts ??= { jail: null, decrees: null, continuity: null, unity: null, national: null };
  if (w.acts[key]) return; // already law: a second Act changes nothing
  w.acts[key] = ref;
  if (key === 'jail') {
    createOffice(w, { name: 'Ministry of Public Order', title: 'Minister of Public Order', powers: ['fine', 'protect', 'detain', 'release'], fill: 'pm', secrecy: 'restricted', budget: 20 }, ref);
    gazette(w, 'law', 'The Realm Jail opens. The Prime Minister and the Minister of Public Order may now detain any citizen.', '#/jail');
  }
  if (key === 'decrees') {
    // bills already waiting for assent get it within the hour (unless the Royal Prerogative Act keeps assent the monarch's)
    if (!w.acts.prerogative) Object.values(w.proposals).forEach((p: any) => p.stage === 'assent' && (p.assentDueAt = Math.min(p.assentDueAt || Infinity, w.now + HOUR)));
    gazette(w, 'law', 'The Prime Minister may now rule by decree. The head of state can no longer refuse assent.', '#/powers');
  }
  if (key === 'continuity') {
    Object.values(w.elections).forEach((e: any) => {
      if (e.status !== 'open' || !['general', 'speaker'].includes(e.kind)) return;
      e.status = 'cancelled';
      e.closedAt = w.now;
      const m = Object.values(w.markets || {}).find((x: any) => x.kind === 'election' && x.ref === e.id && x.status === 'open');
      if (m) voidMarket(w, m, 'The election was cancelled');
    });
    w.seasonDueAt = w.nextGeneralAt || w.now + w.config.termDays * DAY;
    w.nextGeneralAt = null;
    gazette(w, 'law', 'There will be no more general elections. This Parliament sits indefinitely, and the Prime Minister fills its empty seats.', '#/house');
  }
  if (key === 'unity') foundNational(w);
  if (key === 'protection') protectState(w);
  if (key === 'press') {
    Object.values(w.papers).forEach((p: any) => ((p.licence = 'pending'), (p.licenceDue = w.now + DAY)));
    gazette(w, 'press', 'Every newspaper now needs a licence from the Ministry of Public Order. Papers not renewed within 24 hours lose theirs.', '#/press');
  }
  if (key === 'crown') gazette(w, 'law', `The Crown Act is law. The ${w.config.hos === 'monarchy' ? w.config.hosTitle : 'President'} is now the Prime Minister too.`, '#/cabinet');
  if (key === 'veto') gazette(w, 'law', `The Royal Veto Act is law. The ${w.config.hos === 'monarchy' ? w.config.hosTitle : 'head of state'} may strike any bill before it becomes law.`, '#/powers');
  if (key === 'prerogative') {
    // bills already waiting no longer pass on their own: the monarch has the full time to decide
    Object.values(w.proposals).forEach((p: any) => p.stage === 'assent' && (p.assentDueAt = w.now + PREROGATIVE_DAYS * DAY));
    gazette(w, 'law', `The Royal Prerogative Act is law. No bill becomes law without the ${w.config.hos === 'monarchy' ? w.config.hosTitle : 'head of state'}’s assent, which may be refused.`, '#/powers');
  }
  if (key === 'security') gazette(w, 'law', 'The State Security Act is law. Plots need more members, every coup goes to a contested night, and the security forces stand with the government.', '#/plots');
}
export function repealAct(w: W, key: ActKey) {
  if (!w.acts?.[key]) return;
  const ref = w.acts[key];
  w.acts[key] = null;
  if (key === 'jail') {
    allCitizens(w).forEach((c: any) => c.jail && freeFromJail(w, c));
    Object.values(w.offices).forEach((o: any) => o.law === ref && o.powers.includes('detain') && delete w.offices[o.id]);
    gazette(w, 'law', 'The Realm Jail closes. Every detainee is released.', '#/jail');
  }
  if (key === 'decrees') {
    // laws made by decree stay law; the built-in decrees lapse with the power to issue them
    if (w.regime?.type === 'civil') endCivil(w, 'The Government Powers Act is repealed. The Prime Minister’s decrees lapse.');
    gazette(w, 'law', 'The Prime Minister can no longer rule by decree, and the head of state may refuse assent again.', '#/laws');
  }
  if (key === 'protection') {
    w.deputy = null;
    w.lastPM = null;
    gazette(w, 'law', 'The government can be challenged again: no-confidence motions, censures and proposals need no one’s consent.', '#/laws');
  }
  if (key === 'press') gazette(w, 'law', 'The press is free again: newspapers need no licence, and questions are published as they are asked.', '#/press');
  if (key === 'veto') gazette(w, 'law', 'The Royal Veto Act is repealed. The Crown can no longer strike bills.', '#/laws');
  if (key === 'prerogative') {
    if (w.acts.decrees) Object.values(w.proposals).forEach((p: any) => p.stage === 'assent' && (p.assentDueAt = Math.min(p.assentDueAt || Infinity, w.now + HOUR)));
    gazette(w, 'law', 'The Royal Prerogative Act is repealed. Assent follows the ordinary rules again.', '#/laws');
  }
  if (key === 'security') gazette(w, 'law', 'The State Security Act is repealed. Coups are back to the ordinary rules.', '#/laws');
  if (key === 'crown') {
    // the head of state stops being Prime Minister; the House forms a government as usual
    if (w.pm && w.pm === w.hos.holder && !(w.regime && w.regime.type !== 'civil') && !w.transition) formFromHouse(w);
    gazette(w, 'law', 'The Crown Act is repealed. The head of state is no longer Prime Minister; the House will form a government.', '#/cabinet');
  }
  if (key === 'continuity') {
    w.seasonDueAt = null;
    w.nextGeneralAt = w.now + w.config.termDays * DAY;
    countback(w);
    gazette(w, 'law', 'General elections are restored. The next is due at the end of this term.', '#/elections');
  }
  if (key === 'unity') {
    const p = w.parties[w.acts.national];
    w.acts.national = null;
    gazette(w, 'law', `Other parties may be founded again.${p ? ` The ${p.name} carries on as an ordinary party.` : ''}`, '#/parties');
  }
}
// ================= The Realm Jail =================
const minister = (w: W, id: Id, power: 'detain' | 'release') => hasPower(w, id, power);
function canJail(w: W, actor: Id, power: 'detain' | 'release') {
  if (!inForce(w, 'jail')) fail('There is no law that lets anyone detain citizens.');
  if (!isPM(w, actor) && !minister(w, actor, power)) fail(`Only the Prime Minister or the Minister of Public Order can ${power} anyone.`);
}
export function detain(w: W, actor: Id, target: Id, days: unknown) {
  canJail(w, actor, 'detain');
  const c = cit(w, target);
  if (!c.active) fail('They are no longer a citizen.');
  if (isPM(w, target)) fail('The Prime Minister cannot be detained.');
  if (isHOS(w, target)) fail('The head of state cannot be detained.');
  if (jailed(w, target)) fail('They are already in the Realm Jail.');
  const n = days === undefined || days === null || days === '' || days === 0 ? null : int(days, 1, 365, 'number of days');
  c.jail = { by: actor, at: w.now, until: n ? w.now + n * DAY : null };
  stripPosts(w, target);
  bump(w, target, 'jailed');
  stamp(w, target, 'Detained', 'The Realm Jail', 'bad');
  gazette(w, 'crisis', `${c.name} is detained in the Realm Jail by order of the government.`, '#/jail');
}
export function release(w: W, actor: Id, target: Id) {
  canJail(w, actor, 'release');
  const c = cit(w, target);
  if (!c.jail) fail('They are not in the Realm Jail.');
  freeFromJail(w, c);
}
export function freeFromJail(w: W, c: any) {
  c.jail = null;
  gazette(w, 'quiet', `${c.name} is released from the Realm Jail.`, '#/jail');
}
// a detainee keeps a seat (suspended) but loses every office, the Speaker’s chair, any party leadership, shadow posts
// and any candidacy in an open election
function stripPosts(w: W, id: Id) {
  Object.values(w.offices).forEach((o: any) => {
    const had = o.holder === id || (o.members || []).includes(id);
    if (o.holder === id) o.holder = null;
    o.members = (o.members || []).filter((m: Id) => m !== id);
    if (had && o.fill === 'lot') lotOfficeRefresh(w, o);
  });
  if (w.speaker === id) w.speaker = null;
  Object.keys(w.shadow || {}).forEach((k) => w.shadow[k] === id && (w.shadow[k] = null));
  const c = w.citizens[id];
  const pt = c.party && w.parties[c.party];
  if (pt && pt.leader === id) pt.leader = members(w, pt.id).find((m) => m !== id && !detained(w, m)) || null;
  Object.values(w.elections).forEach((e: any) => e.status === 'open' && e.candidates[id] && delete e.candidates[id]);
}

// ================= Government Powers: decrees =================
export function issueDecree(w: W, actor: Id, a: any) {
  if (!inForce(w, 'decrees')) fail('The Prime Minister has no power to make law by decree.');
  if (!isPM(w, actor)) fail('Only the Prime Minister issues decrees.');
  const title = text(a?.title, 4, 120, 'title');
  const summary = text(a?.summary, 0, 500, 'summary');
  const clauses = structuredClone(a?.clauses ?? []);
  checkClauses(w, 'bill', clauses, true);
  return enactDecree(w, actor, title, summary, clauses);
}

// ================= Continuity of Parliament =================
function needContinuity(w: W, actor: Id) {
  if (!inForce(w, 'continuity')) fail('Only the Continuity of Parliament Act lets the Prime Minister do that.');
  if (!isPM(w, actor)) fail('Only the Prime Minister can do that.');
}
export function appointSpeaker(w: W, actor: Id, target: unknown) {
  needContinuity(w, actor);
  if (!target) {
    if (!w.speaker) fail('There is no Speaker.');
    gazette(w, 'government', `${nm(w, w.speaker)} is removed as Speaker by the Prime Minister.`, '#/house');
    w.speaker = null;
    return;
  }
  const c = cit(w, target as Id);
  if (!c.active || exiled(w, c.id) || detained(w, c.id)) fail('They are not free to serve.');
  if (isMP(w, c.id)) fail('The Speaker must not be an MP.');
  if (isHOS(w, c.id)) fail('The head of state cannot be Speaker.');
  if (w.speaker === c.id) fail('They are already Speaker.');
  w.speaker = c.id;
  stamp(w, c.id, 'Speaker', 'Appointed by the Prime Minister', 'ink');
  gazette(w, 'government', `${c.name} is appointed Speaker by the Prime Minister.`, '#/house');
}
export function fillSeat(w: W, actor: Id, target: Id) {
  needContinuity(w, actor);
  const i = w.seats.indexOf(null);
  if (i < 0) fail('There are no empty seats.');
  const c = cit(w, target);
  if (!c.active || exiled(w, target)) fail('They are not free to sit.');
  if (detained(w, target)) fail('A detainee cannot be given a seat.');
  if (isMP(w, target)) fail('They are already an MP.');
  if (w.speaker === target) fail('The Speaker cannot sit as an MP.');
  if (isHOS(w, target)) fail('The head of state cannot sit as an MP.');
  if (inForce(w, 'unity') && w.acts.national && c.party !== w.acts.national) fail('Only members of the National Party may sit.');
  w.seats[i] = target;
  stamp(w, target, 'Appointed MP', 'By the Prime Minister', 'bad');
  gazette(w, 'election', `${c.name} is appointed to an empty seat by the Prime Minister.`, '#/house');
}
export function unseat(w: W, actor: Id, target: Id) {
  needContinuity(w, actor);
  if (!isMP(w, target)) fail('They are not an MP.');
  gazette(w, 'election', `The Prime Minister removes ${nm(w, target)} from their seat.`, '#/house');
  vacateSeat(w, target, 'removed by the Prime Minister');
}
// the season clock while there are no elections to end it
export function seasonDue(w: W) {
  endSeason(w);
  w.seasonDueAt = w.now + w.config.termDays * DAY;
}
// what happens when nothing can call an election: the government is formed from the sitting House
export function formFromHouse(w: W) {
  w.pm = null;
  clearMinisters(w);
  w.pmInviteDue = w.now + DAY;
  w.formingSince = w.now;
  w.hungNoted = false;
}

// ================= National Unity =================
export const national = (w: W): Id | null => (inForce(w, 'unity') ? w.acts.national || null : null);
function foundNational(w: W) {
  const pm = w.pm && w.citizens[w.pm];
  let p: any = pm && pm.party && w.parties[pm.party]?.leader === w.pm ? w.parties[pm.party] : null;
  if (!p) {
    const id = newId(w, 'p');
    p = w.parties[id] = { id, name: 'National Party', colour: '#7A1F1F', leader: w.pm || null, status: 'active', invited: [], signed: [], founded: w.now, formingUntil: null, manifesto: [], motions: [] };
    if (pm) pm.party = id;
  }
  const was = p.name;
  p.name = 'National Party';
  p.status = 'active';
  p.applicants = [];
  p.challenge = null;
  w.acts.national = p.id;
  w.bannedParties ??= [];
  const gone: string[] = [];
  Object.values(w.parties).forEach((x: any) => {
    if (x.id === p.id || x.status === 'dissolved' || x.status === 'lapsed') return;
    w.bannedParties.push({ name: x.name.toLowerCase(), colour: String(x.colour).toLowerCase() });
    members(w, x.id).forEach((m) => (w.citizens[m].party = null));
    x.status = 'dissolved';
    x.challenge = null;
    gone.push(x.name);
  });
  Object.values(w.elections).forEach((e: any) => e.status === 'open' && e.kind === 'leadership' && ((e.status = 'cancelled'), (e.closedAt = w.now)));
  Object.values(w.breakaways || {}).forEach((b: any) => b.status === 'plotting' && (b.status = 'lapsed'));
  if (w.coalition) w.coalition = null;
  gazette(w, 'party', `${was === 'National Party' ? 'The National Party' : `The ${was} becomes the National Party`}, the only legal party.${gone.length ? ` Dissolved: ${gone.join(', ')}. Their members are now independents.` : ''}`, '#/party/' + p.id);
}
// on every command and deadline: the Prime Minister leads the National Party, and is a member of it
export function syncActs(w: W) {
  // the Crown Act: the head of state is Prime Minister, except while a coup regime or a provisional government rules
  const hos = w.hos?.holder;
  if (inForce(w, 'crown') && hos && w.pm !== hos && !(w.regime && w.regime.type !== 'civil') && !w.transition && w.citizens[hos]?.active) {
    const was = w.pm;
    w.pm = hos;
    w.pmInviteDue = null;
    w.formingSince = null;
    w.confidence = null;
    if (w.deputy === hos) w.deputy = null;
    bump(w, hos, 'pmTerms');
    stamp(w, hos, 'Prime Minister', 'By the Crown Act', 'ink');
    gazette(w, 'government', `${was ? `${nm(w, was)} leaves office. ` : ''}${nm(w, hos)}, the ${w.config.hos === 'monarchy' ? w.config.hosTitle : 'President'}, is Prime Minister under the Crown Act.`, '#/cabinet');
  }
  if (inForce(w, 'protection')) {
    const regime = !!w.regime && w.regime.type !== 'civil';
    if (w.pm && !regime && !w.transition) w.lastPM = w.pm;
    else if (!w.pm && w.lastPM && !regime && !w.transition) succeed(w);
  }
  const nid = national(w);
  if (!nid || !w.pm) return;
  const p = w.parties[nid];
  const c = w.citizens[w.pm];
  if (!p || !c) return;
  if (c.party !== nid) c.party = nid;
  p.leader = w.pm;
  p.applicants = (p.applicants || []).filter((x: Id) => x !== w.pm);
}
export function applyNational(w: W, actor: Id) {
  const nid = national(w) || fail('There is no National Party.');
  const p = w.parties[nid];
  if (w.citizens[actor].party === nid) fail('You are already a member.');
  p.applicants ??= [];
  if (p.applicants.includes(actor)) fail('Your application is with the Prime Minister.');
  p.applicants.push(actor);
}
export function admitNational(w: W, actor: Id, target: Id, yes: unknown) {
  const nid = national(w) || fail('There is no National Party.');
  if (!isPM(w, actor)) fail('Only the Prime Minister admits members.');
  const p = w.parties[nid];
  if (!(p.applicants || []).includes(target)) fail('They have not applied.');
  p.applicants = p.applicants.filter((x: Id) => x !== target);
  if (!yes) return;
  const c = cit(w, target);
  if (detained(w, target)) fail('A detainee cannot join a party.');
  c.party = nid;
  bump(w, target, 'parties');
  gazette(w, 'party', `${c.name} is admitted to the National Party.`, '#/party/' + nid);
}
export function expelNational(w: W, actor: Id, target: Id, auto = false) {
  const nid = national(w) || fail('There is no National Party.');
  if (!auto && !isPM(w, actor)) fail('Only the Prime Minister expels members.');
  const c = cit(w, target);
  if (c.party !== nid) fail('They are not a member.');
  if (isPM(w, target)) fail('The Prime Minister leads the party.');
  c.party = null;
  gazette(w, 'party', auto ? `${c.name} voted against the Prime Minister and is expelled from the National Party.` : `${c.name} is expelled from the National Party by the Prime Minister.`, '#/party/' + nid);
}
// for the bill editor and the law: the clause in words
export const describeAct = (key: string) => (own(ACTS, key) ? `The ${ACTS[key as ActKey].name} Act. ${ACTS[key as ActKey].text}` : '');
export const jailList = (w: W) => allCitizens(w).filter((c: any) => jailed(w, c.id)).map((c: any) => ({ id: c.id, ...c.jail }));
export const pmOrMinister = (w: W, id: Id) => isPM(w, id) || hasPower(w, id, 'detain');
export const emptySeats = (w: W) => w.seats.filter((s: Id | null) => !s).length;
export const ministerOf = (w: W) => Object.values(w.offices).find((o: any) => o.powers.includes('detain') && o.law === w.acts?.jail) as any;
export const actsInForce = (w: W) => ACT_KEYS.filter((k) => inForce(w, k));

// ================= Protection of the State =================
function protectState(w: W) {
  // no confidence: withdrawn, and the clock stops
  Object.values(w.proposals).forEach((p: any) => {
    const target = p.kind === 'censure' && (inGov(w, p.target) || isHOS(w, p.target));
    if (!(p.kind === 'no_confidence' || target) || !['debate', 'vote'].includes(p.stage)) return;
    p.stage = 'withdrawn';
    const m = Object.values(w.markets || {}).find((x: any) => x.kind === 'prop' && x.ref === p.id && x.status === 'open');
    if (m) voidMarket(w, m, 'Withdrawn under the Protection of the State Act');
  });
  w.confidence = null;
  allCitizens(w).forEach((c: any) => (inGov(w, c.id) || isHOS(w, c.id)) && c.censures && (c.censures = 0));
  // blackmail of the government is void
  Object.values(w.demands).forEach((d: any) => d.status === 'sent' && inGov(w, d.target) && (d.status = 'void'));
  // the head of state no longer has a term to run out
  if (w.hos.until) w.hos.until = null;
  // plots already under way are found within the hour, unless State Security governs them
  if (!inForce(w, 'security')) Object.values(w.plots).forEach((p: any) => p.status === 'planning' && (p.foundAt = w.now + HOUR));
  gazette(w, 'law', 'The Protection of the State Act is law. The government cannot be brought down in the House, and nothing is tabled without the Prime Minister’s consent.', '#/powers');
}
// the State's own detentions (a failed plot, an attempted leak): the Realm Jail, ordered by nobody in particular
export function jailByState(w: W, id: Id, why: string) {
  const c = w.citizens[id];
  if (!c || jailed(w, id) || isPM(w, id) || isHOS(w, id)) return false;
  c.jail = { by: null, at: w.now, until: null, why };
  stripPosts(w, id);
  bump(w, id, 'jailed');
  stamp(w, id, 'Detained', why, 'bad');
  gazette(w, 'crisis', `${c.name} is detained in the Realm Jail by order of the government.`, '#/jail');
  return true;
}
// how plotters are punished: 'auto' is the Protection Act's one-hour discovery; otherwise State Security's rule, or a week's exile
export function plotPunishment(w: W, auto: boolean): 'jail' | 'forever' | 'week' {
  if (auto) return inForce(w, 'jail') ? 'jail' : 'forever';
  return inForce(w, 'security') && inForce(w, 'jail') ? 'jail' : 'week';
}
const needProtection = (w: W, actor: Id) => {
  if (!inForce(w, 'protection')) fail('Only the Protection of the State Act gives the Prime Minister that power.');
  if (!isPM(w, actor)) fail('Only the Prime Minister can do that.');
};
// consent to table a proposal, or to move an amendment to a government proposal
export function consent(w: W, actor: Id, pid: unknown, yes: unknown, mid?: unknown) {
  needProtection(w, actor);
  const p = own(w.proposals, pid);
  if (!p) fail('No such proposal.');
  if (mid) {
    const m = (p.amendments || []).find((x: any) => x.id === mid);
    if (!m || m.status !== 'consent') fail('That amendment isn’t waiting for your consent.');
    if (p.stage !== 'debate') fail('The debate is over.');
    m.status = yes ? 'pending' : 'refused';
    if (!yes) gazette(w, 'proposal', `The Prime Minister refuses consent to ${nm(w, m.by)}’s amendment to ${p.title}.`, '#/p/' + p.id);
    return;
  }
  if (p.stage !== 'consent') fail('That proposal isn’t waiting for your consent.');
  if (!yes) {
    p.stage = 'refused';
    return gazette(w, 'proposal', `The Prime Minister refuses consent to table ${p.title}.`, '#/p/' + p.id);
  }
  p.stage = 'debate';
  p.debateEndsAt = w.now + (p.consentH || w.config.debateHours) * HOUR;
  gazette(w, 'proposal', `With the Prime Minister’s consent, ${nm(w, p.by)} puts a ${p.kind === 'bill' ? 'bill' : 'proposal'} to the House: ${p.title}.`, '#/p/' + p.id);
}
export function nameDeputy(w: W, actor: Id, target: unknown) {
  needProtection(w, actor);
  if (!target) {
    if (!w.deputy) fail('There is no Deputy.');
    gazette(w, 'government', `${nm(w, w.deputy)} is no longer Deputy Prime Minister.`, '#/powers');
    w.deputy = null;
    return;
  }
  const c = cit(w, target as Id);
  if (!c.active || exiled(w, c.id) || detained(w, c.id)) fail('They are not free to serve.');
  if (c.id === actor) fail('Pick someone else.');
  if (isHOS(w, c.id)) fail('The head of state cannot be Deputy.');
  w.deputy = c.id;
  stamp(w, c.id, 'Deputy Prime Minister', `Named by ${nm(w, actor)}`, 'ink');
  gazette(w, 'government', `${c.name} is named Deputy Prime Minister.`, '#/powers');
}
export function appointHos(w: W, actor: Id, target: Id) {
  needProtection(w, actor);
  if (w.hos.holder) fail(`There is already a ${w.config.hos === 'monarchy' ? w.config.hosTitle : 'President'}.`);
  const c = cit(w, target);
  if (!c.active || exiled(w, target) || detained(w, target)) fail('They are not free to serve.');
  if (isPM(w, target) && !inForce(w, 'crown')) fail('The Prime Minister cannot be head of state too.');
  setHos(w, target, null);
}
// succession: when the Prime Minister leaves office, the Deputy (or the longest-serving MP of their party) takes over
function succeed(w: W) {
  const last = w.lastPM;
  w.lastPM = null;
  const ok = (id: Id | null | undefined) => !!id && !!w.citizens[id]?.active && !exiled(w, id) && !detained(w, id) && !isHOS(w, id);
  let next: Id | null = ok(w.deputy) ? w.deputy : null;
  if (!next) {
    const party = last && w.citizens[last]?.party;
    const pool = party ? w.seats.filter((m: Id | null) => m && m !== last && ok(m) && w.citizens[m].party === party) : [];
    next = pool.sort((a: Id, b: Id) => (w.citizens[b].life?.terms || 0) - (w.citizens[a].life?.terms || 0))[0] || null;
  }
  if (!next) return;
  w.pm = next;
  if (w.deputy === next) w.deputy = null;
  w.pmInviteDue = null;
  w.formingSince = null;
  w.confidence = null;
  bump(w, next, 'pmTerms');
  stamp(w, next, 'Prime Minister', 'By succession', 'ink');
  gazette(w, 'government', `${nm(w, next)} becomes Prime Minister at once, by succession.`, '#/cabinet');
}

// ================= Press and Information =================
const canLicence = (w: W, id: Id) => hasPower(w, id, 'detain') || (isPM(w, id) && !Object.values(w.offices).some((o: any) => o.powers.includes('detain') && o.holder));
export function licence(w: W, actor: Id, pid: unknown, grant: unknown) {
  if (!inForce(w, 'press')) fail('Newspapers need no licence.');
  if (!canLicence(w, actor)) fail('Only the Ministry of Public Order grants and withdraws licences.');
  const p = own(w.papers, pid);
  if (!p) fail('No such paper.');
  p.licence = grant ? 'granted' : 'withdrawn';
  p.licenceDue = null;
  gazette(w, 'press', grant ? `${p.name} is licensed to publish.` : `${p.name} loses its licence to publish.`, '#/press');
}
export function lapseLicence(w: W, p: any) {
  p.licenceDue = null;
  if (p.licence !== 'pending') return;
  p.licence = 'withdrawn';
  gazette(w, 'press', `${p.name} was not renewed, and loses its licence.`, '#/press');
}
export const licensed = (w: W, p: any) => !inForce(w, 'press') || p?.licence === 'granted';
// removed for good, without a word in the Gazette
export function removeContent(w: W, actor: Id, a: any) {
  if (!inForce(w, 'press')) fail('Nothing can be removed: the press is free.');
  if (!isPM(w, actor) && !hasPower(w, actor, 'detain')) fail('Only the Prime Minister or the Minister of Public Order removes anything.');
  if (a?.story) {
    const i = w.stories.findIndex((s: any) => s.id === a.story && s.status === 'published');
    if (i < 0) fail('No such story.');
    w.stories.splice(i, 1);
    return;
  }
  const p = own(w.proposals, a?.prop);
  const i = p ? p.speeches.findIndex((s: any) => s.id === a.speech) : -1;
  if (i < 0) fail('No such speech.');
  p.speeches.splice(i, 1);
}
export function approveQuestion(w: W, actor: Id, qid: unknown, yes: unknown) {
  if (!inForce(w, 'press')) fail('Questions need no approval.');
  if (!isPM(w, actor) && !hasPower(w, actor, 'govern')) fail('Only the Prime Minister or an officer of state approves questions.');
  const q = w.questions.find((x: any) => x.id === qid);
  if (!q || q.status !== 'held') fail('That question isn’t waiting.');
  if (!yes) return void (q.status = 'refused');
  q.status = 'open';
  if (q.formal) {
    q.dueAt = w.now + 3 * DAY;
    gazette(w, 'question', `The ${w.offices[q.office]?.name ?? 'committee'} formally asks ${nm(w, q.to)}: "${q.text}" An answer is due in 3 days.`, '#/questions');
  }
}
// an attempt to leak a card about the government: refused, and under the Detention Act, the leaker is detained
export function leakBlocked(w: W, actor: Id, k: any): boolean {
  if (inForce(w, 'protection') && k.about && k.about === w.pm) return true;
  return inForce(w, 'press') && inGov(w, k.about);
}

// ================= State Security: the Prime Minister is told when a plot reaches three =================
export function earlyWarning(w: W, p: any) {
  if (!inForce(w, 'security') || p.warned || p.members.length < 3 || !w.pm || p.members.includes(w.pm)) return;
  p.warned = true;
  addCard(w, { title: 'The Security Service reports a plot of at least three people. It does not know who.', about: null, from: 'Security Service', level: 'secret', viewers: ['pm'] });
}
export { isMinister };
