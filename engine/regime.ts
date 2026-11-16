// Regimes: what happens after a coup succeeds, how the realm resists, how a regime ends, and what follows.
// - takePower() makes w.regime. Its `legit` (legitimacy, 0–20) is its lifeline: at zero it falls.
// - Four kinds: martial law (3 days), a junta (a week, by council), a dictatorship (no end, drains daily) and a
//   one-party state (steady while half the realm holds a Party card).
// - The leader issues one decree a day (DECREES). Everything a decree does is undone when the regime falls.
// - Resistance: a general strike, the underground press, prison letters, jailbreaks, a government in exile,
//   a palace coup, and a counter-coup (backroom.ts).
// - fallRegime() ends it: an orderly hand-back goes straight to a Restoration election; anything else gets a
//   provisional government (w.transition) with its own troubles, then the election. Parliament then holds the
//   reckoning (w.reckoning) on the people who ran it.
import { W, Id, DAY, HOUR, fail, newId, chance, pick, cit, nm, own, text as txt, int, clamp, allCitizens, exiled, detained, held, jailed, inForce, isPM, mustBeFree, gazette, earn, spend, stamp, approve, meter, legit, isHOS, isMP, mps, holderOf, transfer, bal, ca, bump, DAYNO, hosTitle } from './core';
import { syncCrown } from './crown';
import { clearMinisters, coalitionGoverns, callGeneralElection, vacateSeat, members, VOTING } from './politics';
import { armyLoyalty } from './foreign';
import { spawnCrisis } from './crises';
import { syncActs, formFromHouse } from './acts';

export const REGIMES: Record<string, { name: string; ruler: string; what: string }> = {
  martial: { name: 'Martial law', ruler: 'Commander', what: 'Three days, then a Restoration election. Parliament is suspended. Only censorship, a curfew and pardons.' },
  junta: { name: 'Junta', ruler: 'Chairman of the junta', what: 'The plotters rule as a council for a week. Decrees need a majority of the council. Legitimacy drains after day 7.' },
  dictatorship: { name: 'Dictatorship', ruler: 'Dictator', what: 'One ruler, every decree, no end date. Legitimacy drains by 1 every day.' },
  party: { name: 'One-party state', ruler: 'Chairman of the Party', what: 'Parliament sits, but only Party members may stand or hold office. Steady while half the realm are members (after two days to recruit).' },
  civil: { name: 'Rule by decree', ruler: 'Prime Minister', what: 'Under the Government Powers Act the Prime Minister issues the regime’s decrees, once a day, with no legitimacy to lose. They stay in force until lifted by decree or the Act is repealed.' }
};
const ALL = ['martial', 'junta', 'dictatorship', 'party'];
const HARD = ['junta', 'dictatorship', 'party'];
// arg: what the decree needs ('target' a citizen, 'party', 'bank', 'n' a number, 'to' a regime type, 'key' a rule, 'text')
export const DECREES: Record<string, { name: string; what: string; cost: string; types: string[]; arg?: string[]; group: string }> = {
  censorship: { name: 'Censorship', what: 'Every story needs the regime’s approval before it is printed.', cost: '−1', types: [...ALL, 'civil'], group: 'Control' },
  curfew: { name: 'Curfew', what: 'No speeches or stories from 22:00 to 06:00. The Streets close for the night too.', cost: '−1', types: [...ALL, 'civil'], group: 'Control' },
  dissolve: { name: 'Dissolve Parliament', what: 'No bills and no votes until the regime ends.', cost: '−2', types: ['junta', 'dictatorship', 'civil'], group: 'Control' },
  police: { name: 'Secret police', what: 'Name a chief. Once a day they learn whether one person has signed the strike, written underground or joined a plot.', cost: '−1', types: [...HARD, 'civil'], arg: ['target'], group: 'Control' },
  arrest: { name: 'Arrest', what: 'Detain someone for up to 2 days. Three held at most. They can read, and write one letter a day.', cost: '−2, −3 for an MP or party leader, free if marked', types: [...HARD, 'civil'], arg: ['target', 'n'], group: 'Repression' },
  exile: { name: 'Exile', what: 'Banish someone for a week.', cost: '−2, free if marked', types: [...HARD, 'civil'], arg: ['target'], group: 'Repression' },
  ban: { name: 'Ban a party', what: 'Its members sit as independents until the regime ends.', cost: '−3', types: [...HARD, 'civil'], arg: ['party'], group: 'Repression' },
  trial: { name: 'Show trial', what: 'Try a detainee or the ousted Prime Minister. Citizens say whether they believe it: belief +2, disbelief −4.', cost: 'A gamble', types: [...HARD, 'civil'], arg: ['target'], group: 'Repression' },
  seize: { name: 'Seize funds', what: 'Freeze up to 50 crowns of one citizen’s money, or a whole bank. Returned when the regime ends.', cost: '−2', types: [...HARD, 'civil'], arg: ['target', 'bank'], group: 'Money and force' },
  nationalise: { name: 'Nationalise', what: 'A bank pays a tenth of its cash to the Treasury each payday; or all profit on trade ventures goes to the Treasury.', cost: '−2', types: [...HARD, 'civil'], arg: ['bank'], group: 'Money and force' },
  tax: { name: 'Set the tax rate', what: 'By decree, from 0% to 40%. Lapses when the regime ends.', cost: '−1', types: [...HARD, 'civil'], arg: ['n'], group: 'Money and force' },
  rate: { name: 'Set the Reserve rate', what: 'By decree, from 0% to 15%. Lapses when the regime ends.', cost: '−1', types: [...HARD, 'civil'], arg: ['n'], group: 'Money and force' },
  conscription: { name: 'Conscription', what: 'Army loyalty +1 now. Every citizen pays 2 crowns each payday.', cost: '−2', types: [...HARD, 'civil'], group: 'Money and force' },
  postpone: { name: 'Postpone the election', what: 'One more day in power.', cost: '−2', types: ['junta'], group: 'Staying in power' },
  rigged: { name: 'Rigged election', what: 'Call an election your people cannot lose. Winning it is worth +4. Any of the council, or the secret police chief, can leak it and end you.', cost: '−3', types: ['junta', 'dictatorship'], group: 'Staying in power' },
  rewrite: { name: 'Rewrite the constitution', what: 'Change how votes are cast, how bills pass, or the length of a term. Lapses when the regime ends.', cost: '−4', types: ['dictatorship', 'party', 'civil'], arg: ['key'], group: 'Staying in power' },
  plebiscite: { name: 'Plebiscite', what: 'Ask every citizen to confirm you. Win and you are President with legitimacy restored. Lose and the regime ends.', cost: 'Everything', types: ['dictatorship'], group: 'Staying in power' },
  heir: { name: 'Name an heir', what: 'If the General removes you, your heir takes over with half your legitimacy.', cost: 'Free', types: ['dictatorship'], arg: ['target'], group: 'Staying in power' },
  escalate: { name: 'Change the regime', what: 'Martial law can become a junta or a dictatorship; a junta a dictatorship or a one-party state; a President a one-party state. Never back down.', cost: '−3', types: ['martial', 'junta', 'dictatorship'], arg: ['to'], group: 'Staying in power' },
  circuses: { name: 'Bread and circuses', what: 'The Treasury pays every citizen 3 crowns. Once a week.', cost: '+2', types: [...HARD, 'civil'], group: 'Buying support' },
  oath: { name: 'Loyalty oath', what: 'Every citizen is asked to swear. Swearing pays 3 crowns and is public. Refusing is public too, and marks you.', cost: 'Free', types: [...HARD, 'civil'], group: 'Buying support' },
  honour: { name: 'Honours for the faithful', what: 'A title for a supporter. It marks them as a collaborator.', cost: 'Free', types: [...HARD, 'civil'], arg: ['target', 'text'], group: 'Buying support' },
  pardon: { name: 'Pardon', what: 'Release a detainee or recall an exile.', cost: '+1', types: [...ALL, 'civil'], arg: ['target'], group: 'Buying support' },
  amnesty: { name: 'Amnesty day', what: 'Free every detainee at once.', cost: '+2 or more', types: [...ALL, 'civil'], group: 'Buying support' },
  purge: { name: 'Purge', what: 'Expel a Party member. They are marked.', cost: '−2', types: ['party'], arg: ['target'], group: 'Repression' },
  lift: { name: 'Lift a decree', what: 'End one of the decrees in force: the censor, the curfew, the suspension of Parliament, conscription, nationalisation, the secret police, the oath, party bans, seizures, or a rate or rule set by decree.', cost: 'Free', types: ['civil'], arg: ['what'], group: 'Lifting decrees' },
  plan: { name: 'Five-year plan', what: 'Promise to pay the people a sum from the Treasury in 7 days. +3 now; −6 if the money isn’t there.', cost: '+3 now', types: ['party'], arg: ['n'], group: 'Buying support' }
};
export const LIFT: Record<string, string> = { censorship: 'Censorship', curfew: 'The curfew', parliament: 'The suspension of Parliament', conscription: 'Conscription', trade: 'Nationalised trade', banks: 'Nationalised banks', police: 'The secret police', oath: 'The loyalty oath', bans: 'Party bans', seized: 'Seized money and frozen banks', exiles: 'Exiles by decree', tax: 'The tax rate', rate: 'The Reserve rate', constitution: 'Constitutional rewrites' };
export const REWRITE: Record<string, string> = { voting: 'How ballots are counted', passRule: 'How a bill passes', termDays: 'Days between elections' };
const PASS = ['cast', 'seats', 'twothirds'];

const R = (w: W) => w.regime || fail('There is no regime.');
const free = (w: W, id: Id) => !!w.citizens[id]?.active && !exiled(w, id) && !detained(w, id);
const inRegime = (r: any, id: Id) => r.leader === id || r.council.includes(id);
export const strikeNeed = (w: W) => Math.min(5, Math.max(2, Math.ceil(allCitizens(w).length / 3)));
export const strikeOn = (w: W) => !!w.regime && w.regime.strike.length >= strikeNeed(w);
export const censored = (w: W) => !!w.regime?.censorship;
export function curfewNow(w: W) {
  if (!w.regime?.curfew) return false;
  const h = new Date(w.now).getUTCHours();
  return h >= 22 || h < 6;
}
export const partyShare = (w: W) => (w.regime?.party ? members(w, w.regime.party).length / Math.max(1, allCitizens(w).length) : 0);
// held by a regime (the Realm Jail's detainees are listed on its own page, and no regime can free them)
export const detainees = (w: W): Id[] => allCitizens(w).filter((c: any) => held(w, c.id)).map((c: any) => c.id);

// run() and the bots call this before every command: a detainee can do very little, and curfew closes the night
const DETAINED_OK = ['prison.letter', 'daily.answer', 'daily.freeze', 'tutorial.visit', 'me.profile', 'coup.flee', 'streets.answer', 'streets.gotMe', 'streets.newCode', 'streets.leave'];
const CURFEW_SHUT = ['prop.speak', 'press.submit', 'crisis.speak', 'newsnight.comment', 'streets.contract', 'streets.tag', 'streets.claim', 'streets.meet', 'stall.open', 'stall.buy', 'bounty.post', 'bounty.take'];
export function gate(w: W, actor: Id, cmd: string) {
  if (jailed(w, actor) && !DETAINED_OK.includes(cmd) && !cmd.startsWith('admin.')) fail('You are in the Realm Jail. You can read everything and write one letter a day, and nothing else, until the government releases you.');
  if (detained(w, actor) && !DETAINED_OK.includes(cmd) && !cmd.startsWith('draft.') && !cmd.startsWith('admin.')) fail('You are detained. You can read everything and write one prison letter a day, and nothing else, until you are released.');
  if (curfewNow(w) && CURFEW_SHUT.includes(cmd)) fail('Curfew. Speeches, the presses and the Streets are closed until 06:00.');
}

// ================= Taking power =================
const suspend = (w: W, r: any) => (w.martial = { leader: r.leader, plotters: r.council.slice(), until: null, regime: true });
function say(w: W, r: any, kind: string, text: string) {
  r.decrees.unshift({ at: w.now, kind, text });
  if (r.decrees.length > 40) r.decrees.length = 40;
  gazette(w, 'crisis', text, '#/regime');
}
export function takePower(w: W, o: { leader: Id; council: Id[]; name: string; swift: boolean; legit: number; backer: Id | null; backers: Id[]; type?: string }) {
  // a coup ends the Prime Minister's rule by decree: whatever it decreed is undone first
  if (w.regime?.type === 'civil') endCivil(w, null);
  // a coup breaks the line of succession
  w.deputy = null;
  w.lastPM = null;
  const ousted = w.pm && w.pm !== o.leader ? w.pm : null;
  const r: any = (w.regime = {
    id: newId(w, 'rg'), name: o.name, type: 'martial', chosen: false, chooseBy: w.now + 6 * HOUR, leader: o.leader, council: o.council.slice(), startedAt: w.now, until: w.now + 3 * DAY,
    legit: o.legit, legit0: o.legit, log: [], swift: o.swift, backer: o.backer, ousted, fled: null, stood: false,
    decreeDay: -1, decrees: [], pending: null, censorship: false, curfew: false, police: null, probes: [], probeDay: -1, marked: {}, collab: {},
    exiles: [], banned: {}, suspended: [], seized: [], banks: [], trade: false, conscription: false, oath: null, oathWon: false, heir: null, party: null, applicants: [],
    strike: [], breaks: {}, trial: null, plebiscite: null, president: false, rigged: null, plan: null, prev: {}, foreign: {}, exileGov: null, treaties: [],
    exit: null, ouster: null, freeVotes: [], lastCircus: 0, lastBlow: null, nextTick: w.now + DAY
  });
  o.backers.forEach((id) => (r.collab[id] = 'Declared for the coup'));
  w.transition = null;
  w.pm = o.leader;
  w.pmInviteDue = null;
  w.formingSince = null;
  w.confidence = null;
  // ministers who were in on it keep their posts (the General above all); the rest go, and plotters take the empty chairs
  const posts = Object.values(w.offices).filter((x: any) => x.fill === 'pm') as any[];
  posts.forEach((x) => !o.council.includes(x.holder) && (x.holder = null));
  const spare = o.council.filter((m) => m !== o.leader && !posts.some((x) => x.holder === m));
  posts.filter((x) => !x.holder).forEach((x, i) => (x.holder = spare[i] || null));
  suspend(w, r);
  o.council.forEach((m) => (stamp(w, m, 'Coup', o.name, 'bad'), bump(w, m, 'coups')));
  meter(w, 'stability', -20, 'A coup');
  gazette(w, 'crisis', `Coup. ${nm(w, o.leader)} ${o.council.length > 1 ? `and ${o.council.length - 1} other${o.council.length === 2 ? '' : 's'} seize` : 'seizes'} power${o.swift ? ' in a single night, before anyone could object' : ''}. Martial law is declared.`, '#/regime');
  // the world reacts: the backer recognises the regime and sends its bill; Tessaly and the unfriendly sanction it
  Object.values(w.nations).forEach((n: any) => {
    const v = n.id === o.backer ? 'recognise' : n.id === 'tessaly' || (n.mood <= 2 && chance(w, 0.4)) ? 'sanction' : 'ignore';
    r.foreign[n.id] = v;
    if (v === 'sanction') {
      n.sanctionsUntil = w.now + 90 * DAY;
      n.regimeSanction = true;
    }
  });
  const sanc = Object.keys(r.foreign).filter((k) => r.foreign[k] === 'sanction').map((k) => w.nations[k].name);
  if (sanc.length) gazette(w, 'foreign', `${sanc.join(', ')} refuse${sanc.length === 1 ? 's' : ''} to recognise the regime and impose${sanc.length === 1 ? 's' : ''} sanctions until it ends.`, '#/foreign');
  if (o.backer && w.nations[o.backer]) {
    const n = w.nations[o.backer];
    legit(w, 1, `${n.name} recognises the regime`);
    n.mood = clamp(n.mood + 1, 0, 4);
    n.reasons.unshift({ sign: '+', text: 'They put this regime in power' });
    transfer(w, 'treasury', 'nation:' + n.id, 40, 'The backer’s bill');
    const rival = ({ kessmark: 'orrin', orrin: 'kessmark' } as any)[n.id];
    if (rival && w.nations[rival]) (w.nations[rival].mood = clamp(w.nations[rival].mood - 1, 0, 4)), w.nations[rival].reasons.unshift({ sign: '−', text: `Our regime is ${n.name}’s creature` });
    gazette(w, 'foreign', `${n.name} recognises the new regime, and is paid 40 crowns for its trouble.`, '#/nation/' + n.id);
  }
  if (o.type) setType(w, r, o.type);
}
function setType(w: W, r: any, type: string) {
  r.type = type;
  r.chosen = true;
  if (type === 'martial') {
    r.until = r.startedAt + 3 * DAY;
    suspend(w, r);
  } else if (type === 'junta') {
    r.until = Math.max(w.now + DAY, r.startedAt + 7 * DAY);
    w.martial = null;
  } else if (type === 'dictatorship') {
    r.until = null;
    w.martial = null;
    r.council = [r.leader];
    bump(w, r.leader, 'dictator');
  } else {
    r.until = null;
    w.martial = null;
    const L = w.citizens[r.leader];
    if (!L.party || w.parties[L.party]?.status !== 'active') {
      const id = newId(w, 'p');
      w.parties[id] = { id, name: 'State Party', colour: '#7A1F1F', leader: r.leader, status: 'active', invited: [], signed: [], founded: w.now, formingUntil: null, manifesto: ['One realm, one Party'], motions: [] };
      L.party = id;
    }
    r.party = L.party;
    r.partyAt = w.now;
    w.parties[r.party].leader = r.leader;
    r.council.forEach((m: Id) => w.citizens[m] && (w.citizens[m].party = r.party));
    Object.values(w.parties).forEach((p: any) => p.id !== r.party && p.status === 'active' && ((p.status = 'suspended'), r.suspended.push(p.id)));
    bump(w, r.leader, 'chairman');
    if (!Object.values(w.elections).some((e: any) => e.kind === 'general' && e.status === 'open')) callGeneralElection(w, w.now + 2 * DAY);
  }
}
// the leader's first choice, free for the first six hours. After that, changing the regime is a decree
export function formRegime(w: W, actor: Id, type: unknown) {
  const r = R(w);
  if (r.leader !== actor) fail('Only the leader of the coup chooses.');
  if (r.chosen || w.now > r.chooseBy) fail('That choice has been made. Changing the regime now is a decree.');
  if (type !== 'martial' && type !== 'junta' && type !== 'dictatorship') fail('Choose martial law, a junta or a dictatorship.');
  setType(w, r, type as string);
  say(w, r, 'form', `${nm(w, actor)} announces how the realm will be ruled: ${REGIMES[r.type].name.toLowerCase()}. ${REGIMES[r.type].what}`);
}
// the ousted Prime Minister: flee (safe abroad, and can lead a government in exile) or stand (and rally the resistance)
export function fleeOrStand(w: W, actor: Id, flee: unknown) {
  const r = R(w);
  if (r.ousted !== actor || r.fled || r.stood) fail('That choice isn’t yours, or you have made it.');
  const c = cit(w, actor);
  if (flee) {
    r.fled = actor;
    c.exiledUntil = w.now + 90 * DAY;
    c.exileNoted = true;
    r.exiles.push(actor);
    gazette(w, 'crisis', `${c.name}, the ousted Prime Minister, flees the realm.`, '#/regime');
  } else {
    r.stood = true;
    approve(w, actor, 5);
    legit(w, -3, `${c.name} stayed to face them`);
    gazette(w, 'crisis', `${c.name}, the ousted Prime Minister, refuses to leave. “I was elected. They were not.”`, '#/regime');
  }
}

// ================= Decrees =================
export function decree(w: W, actor: Id, a: any) {
  const r = R(w);
  if (r.type === 'civil' ? !isPM(w, actor) : r.leader !== actor) fail(r.type === 'civil' ? 'Only the Prime Minister issues decrees.' : 'Only the leader of the regime issues decrees.');
  const kind = a?.kind;
  const d = own(DECREES, kind);
  if (!d) fail('Unknown decree.');
  if (!d.types.includes(r.type)) fail(`${REGIMES[r.type].name} doesn’t allow that.`);
  if (r.decreeDay === DAYNO(w.now)) fail('One decree a day. Come back tomorrow.');
  r.decreeDay = DAYNO(w.now);
  // a junta rules by council: the decree waits for a majority of it
  if (r.type === 'junta' && r.council.length >= 3) {
    const args: any = {};
    ['target', 'party', 'bank', 'n', 'to', 'key', 'value', 'text'].forEach((k) => a[k] !== undefined && (args[k] = a[k]));
    r.pending = { id: newId(w, 'dc'), kind, args, votes: { [actor]: true }, at: w.now, dueAt: w.now + 12 * HOUR };
    return;
  }
  enact(w, r, kind, a);
}
export function councilVote(w: W, actor: Id, yes: unknown) {
  const r = R(w);
  const p = r.pending;
  if (!p) fail('There is no decree before the council.');
  if (!r.council.includes(actor)) fail('Only the council votes.');
  p.votes[actor] = !!yes;
  const n = r.council.length;
  const ayes = r.council.filter((m: Id) => p.votes[m] === true).length;
  const noes = r.council.filter((m: Id) => p.votes[m] === false).length;
  if (ayes > n / 2) {
    r.pending = null;
    enact(w, r, p.kind, p.args);
  } else if (noes >= n / 2) {
    r.pending = null;
    say(w, r, 'council', `The junta’s council turns down a decree from ${nm(w, r.leader)}: ${DECREES[p.kind].name.toLowerCase()}.`);
  }
}
export const lapseDecree = (w: W) => w.regime && (w.regime.pending = null);
function enact(w: W, r: any, kind: string, a: any) {
  const L = nm(w, r.leader);
  const target = () => {
    const c = cit(w, a.target);
    if (!c.active) fail('They are no longer a citizen.');
    return c;
  };
  const cost = (n: number, why: string) => legit(w, -n, why);
  switch (kind) {
    case 'censorship':
      if (r.censorship) fail('The censor is already at work.');
      r.censorship = true;
      cost(1, 'Censorship');
      return say(w, r, kind, `By decree: censorship. Every story now needs the regime’s approval.`);
    case 'curfew':
      if (r.curfew) fail('There is already a curfew.');
      r.curfew = true;
      cost(1, 'A curfew');
      return say(w, r, kind, `By decree: a curfew from 22:00 to 06:00. No speeches, no presses, and the Streets close for the night.`);
    case 'dissolve':
      if (w.martial) fail('Parliament is already suspended.');
      suspend(w, r);
      cost(2, 'Parliament dissolved');
      return say(w, r, kind, `By decree: Parliament is dissolved until further notice.`);
    case 'police': {
      const c = target();
      if (!free(w, c.id)) fail('They are not free to serve.');
      r.police = c.id;
      r.collab[c.id] = 'Ran the secret police';
      cost(1, 'A secret police');
      return say(w, r, kind, `By decree: ${c.name} is to lead a new secret police.`);
    }
    case 'arrest': {
      const c = target();
      if (inRegime(r, c.id)) fail('You cannot arrest the regime.');
      if (!free(w, c.id)) fail('They are already out of reach.');
      if (detainees(w).length >= 3) fail('The cells are full: three are held already. Free someone first.');
      const days = int(a.n ?? 2, 1, 2, 'number of days');
      c.detainedUntil = w.now + days * DAY;
      c.detainedNoted = false;
      c.detainedBy = r.id;
      bump(w, c.id, 'detained');
      stamp(w, c.id, 'Political prisoner', `Held by ${L}`, 'ink');
      const big = isMP(w, c.id) || Object.values(w.parties).some((p: any) => p.leader === c.id && ['active', 'suspended', 'banned'].includes(p.status));
      if (!r.marked[c.id]) cost(big ? 3 : 2, `Arrested ${c.name}`);
      return say(w, r, kind, `By decree: ${c.name} is arrested and held for ${days} day${days > 1 ? 's' : ''}.`);
    }
    case 'exile': {
      const c = target();
      if (inRegime(r, c.id)) fail('You cannot exile the regime.');
      if (!free(w, c.id)) fail('They are already out of reach.');
      c.exiledUntil = w.now + 7 * DAY;
      c.exileNoted = false;
      c.asylum = null;
      r.exiles.push(c.id);
      bump(w, c.id, 'exiled');
      if (!r.marked[c.id]) cost(2, `Exiled ${c.name}`);
      return say(w, r, kind, `By decree: ${c.name} is banished for a week.`);
    }
    case 'ban': {
      const p = own(w.parties, a.party);
      if (!p || p.status !== 'active') fail('Pick a party.');
      if (p.id === r.party || p.id === w.citizens[r.leader].party) fail('That is your own party.');
      r.banned[p.id] = members(w, p.id);
      r.banned[p.id].forEach((m: Id) => (w.citizens[m].party = null));
      p.status = 'banned';
      cost(3, `Banned the ${p.name}`);
      return say(w, r, kind, `By decree: the ${p.name} is banned. Its members sit as independents.`);
    }
    case 'trial': {
      const c = target();
      if (r.trial) fail('One trial at a time.');
      if (!held(w, c.id) && !(r.ousted === c.id && !r.fled)) fail('Only a detainee or the ousted Prime Minister can be put on trial.');
      r.trial = { target: c.id, closesAt: w.now + DAY, votes: {} };
      return say(w, r, kind, `${c.name} is put on trial for crimes against the realm. Citizens have a day to say whether they believe a word of it.`);
    }
    case 'seize': {
      if (a.bank) {
        const b = own(w.banks, a.bank);
        if (!b || b.status !== 'open') fail('Pick an open bank.');
        const amt = bal(w, 'bank:' + b.id);
        if (amt > 0) transfer(w, 'bank:' + b.id, 'escrow', amt, 'Frozen by the regime');
        b.status = 'frozen';
        r.seized.push({ acct: 'bank:' + b.id, amt, bank: b.id });
        cost(2, `Froze ${b.name}`);
        return say(w, r, kind, `By decree: ${b.name} is frozen. Nobody can pay in or take out.`);
      }
      const c = target();
      if (inRegime(r, c.id)) fail('You cannot seize your own.');
      const amt = Math.min(50, bal(w, ca(c.id)));
      if (amt < 1) fail('They have nothing to seize.');
      transfer(w, ca(c.id), 'escrow', amt, 'Seized by the regime');
      r.seized.push({ acct: ca(c.id), amt });
      cost(2, `Seized ${c.name}’s money`);
      return say(w, r, kind, `By decree: ${amt} crowns of ${c.name}’s money are seized.`);
    }
    case 'nationalise': {
      if (a.bank) {
        const b = own(w.banks, a.bank);
        if (!b || b.status !== 'open') fail('Pick an open bank.');
        if (r.banks.some((x: any) => x.bank === b.id)) fail('That bank is already nationalised.');
        r.banks.push({ bank: b.id, taken: 0 });
        cost(2, `Nationalised ${b.name}`);
        return say(w, r, kind, `By decree: ${b.name} is nationalised. A tenth of its cash goes to the Treasury each payday.`);
      }
      if (r.trade) fail('Trade is already nationalised.');
      r.trade = true;
      cost(2, 'Nationalised foreign trade');
      return say(w, r, kind, `By decree: foreign trade is nationalised. The profit on every venture goes to the Treasury.`);
    }
    case 'tax': {
      const n = int(a.n, 0, 40, 'tax rate');
      r.prev.taxRate ??= w.config.taxRate;
      w.config.taxRate = n;
      cost(1, 'Tax by decree');
      return say(w, r, kind, `By decree: income tax is now ${n}%.`);
    }
    case 'rate': {
      const n = int(a.n, 0, 15, 'interest rate');
      r.prev.rate ??= w.economy.rate;
      w.economy.rate = n;
      cost(1, 'The Reserve overruled');
      return say(w, r, kind, `By decree: the Reserve’s interest rate is now ${n}%.`);
    }
    case 'conscription':
      if (!w.offices.army) fail('There is no Army to conscript into.');
      if (r.conscription) fail('Conscription is already in force.');
      r.conscription = true;
      armyLoyalty(w, 1, 'Conscription swelled the ranks');
      cost(2, 'Conscription');
      return say(w, r, kind, `By decree: conscription. Every citizen pays 2 crowns towards the Army each payday.`);
    case 'postpone':
      r.until = (r.until || w.now) + DAY;
      cost(2, 'The election postponed');
      return say(w, r, kind, `By decree: the Restoration election is put back a day.`);
    case 'rigged': {
      if (inForce(w, 'continuity')) fail('No election can be held under the Continuity of Parliament Act.');
      if (r.rigged && !r.rigged.done) fail('An election is already arranged.');
      if (Object.values(w.elections).some((e: any) => e.kind === 'general' && e.status === 'open')) fail('A general election is already open.');
      callGeneralElection(w, w.now + 2 * DAY);
      const e = (Object.values(w.elections) as any[]).filter((x) => x.kind === 'general' && x.status === 'open').pop();
      r.rigged = { election: e.id, at: w.now, done: false };
      cost(3, 'An election nobody trusts');
      return say(w, r, kind, `${L} calls a general election to prove the people are behind the regime.`);
    }
    case 'rewrite': {
      const key = a.key;
      if (!own(REWRITE, key)) fail('Pick what to rewrite.');
      let v: any = a.value;
      if (key === 'voting' && !own(VOTING, v)) fail('Pick a voting method.');
      if (key === 'passRule' && !PASS.includes(v)) fail('Pick a rule for passing bills.');
      if (key === 'termDays') v = int(v, 7, 42, 'number of days');
      r.prev[key] ??= w.config[key] ?? (key === 'voting' ? 'single' : key === 'passRule' ? 'cast' : 21);
      w.config[key] = v;
      cost(4, 'The constitution rewritten');
      return say(w, r, kind, `By decree: the constitution is rewritten. ${REWRITE[key]}: ${key === 'voting' ? VOTING[v].short : key === 'passRule' ? ({ cast: 'a majority of votes cast', seats: 'a majority of all seats', twothirds: 'two-thirds' } as any)[v] : v + ' days'}.`);
    }
    case 'plebiscite':
      if (r.president) fail('The people have already spoken.');
      if (r.plebiscite) fail('A plebiscite is already open.');
      r.plebiscite = { closesAt: w.now + DAY, votes: {} };
      return say(w, r, kind, `${L} calls a plebiscite: should ${L} lead the realm as President? Every citizen has a day to answer.`);
    case 'heir': {
      const c = target();
      if (c.id === r.leader || !free(w, c.id)) fail('Pick someone else.');
      r.heir = c.id;
      r.collab[c.id] = 'The dictator’s heir';
      return say(w, r, kind, `${L} names ${c.name} as heir.`);
    }
    case 'escalate': {
      const to = a.to;
      const ok = r.type === 'martial' ? ['junta', 'dictatorship'] : r.type === 'junta' ? ['dictatorship', 'party'] : r.president ? ['party'] : [];
      if (!ok.includes(to)) fail(r.type === 'dictatorship' ? 'Only a President, confirmed by plebiscite, can found a one-party state.' : 'The regime can’t become that.');
      cost(3, `Became a ${REGIMES[to].name.toLowerCase()}`);
      setType(w, r, to);
      return say(w, r, kind, `The regime hardens: ${REGIMES[to].name.toLowerCase()}. ${REGIMES[to].what}`);
    }
    case 'circuses': {
      if (w.now - r.lastCircus < 7 * DAY) fail('Once a week.');
      r.lastCircus = w.now;
      allCitizens(w).forEach((c: any) => !exiled(w, c.id) && transfer(w, 'treasury', ca(c.id), 3, 'Bread and circuses'));
      legit(w, 2, 'Bread and circuses');
      return say(w, r, kind, `Bread and circuses: the Treasury pays every citizen 3 crowns, with ${L}’s compliments.`);
    }
    case 'oath':
      if (r.oath) fail('The oath has already been demanded.');
      r.oath = {};
      return say(w, r, kind, `By decree: every citizen is asked to swear loyalty to the regime. Swearing and refusing are both public.`);
    case 'honour': {
      const c = target();
      const title = txt(a.text, 2, 40, 'title');
      c.titles.push(title);
      approve(w, c.id, 2);
      r.collab[c.id] = r.collab[c.id] || 'Took an honour from the regime';
      stamp(w, c.id, title, `From ${L}`, 'ink');
      return say(w, r, kind, `${L} honours ${c.name}: ${title}.`);
    }
    case 'pardon': {
      const c = target();
      if (held(w, c.id)) c.detainedUntil = w.now;
      else if (exiled(w, c.id) && r.exiles.includes(c.id) && r.fled !== c.id) c.exiledUntil = w.now;
      else fail('They are not held or banished by this regime.');
      legit(w, 1, `Pardoned ${c.name}`);
      return say(w, r, kind, `${c.name} is pardoned by the regime.`);
    }
    case 'amnesty': {
      const held = detainees(w);
      if (!held.length) fail('Nobody is being held.');
      held.forEach((id) => (w.citizens[id].detainedUntil = w.now));
      legit(w, Math.max(2, held.length), 'Amnesty day');
      return say(w, r, kind, `Amnesty day: ${held.map((id) => nm(w, id)).join(', ')} walk${held.length === 1 ? 's' : ''} free.`);
    }
    case 'lift': {
      const what = a.what;
      if (typeof what !== 'string' || !own(LIFT, what)) fail('Pick what to lift.');
      lift(w, r, what) || fail('That is not in force.');
      return say(w, r, kind, `By decree: ${LIFT[what].toLowerCase()} ${what === 'tax' || what === 'rate' ? 'goes back to what it was' : what === 'seized' ? 'are returned' : 'is lifted'}.`);
    }
    case 'purge': {
      const c = target();
      if (c.party !== r.party || c.id === r.leader) fail('They are not a Party member.');
      c.party = null;
      r.marked[c.id] = 'Purged from the Party';
      cost(2, `Purged ${c.name}`);
      return say(w, r, kind, `${c.name} is expelled from the Party.`);
    }
    case 'plan': {
      if (r.plan) fail('One plan at a time.');
      const n = int(a.n, 20, 300, 'sum');
      r.plan = { crowns: n, dueAt: w.now + 7 * DAY };
      legit(w, 3, 'A five-year plan');
      return say(w, r, kind, `The Party announces a five-year plan: ${n} crowns to the people within the week.`);
    }
  }
}
export function planDue(w: W) {
  const r = w.regime;
  if (!r?.plan) return;
  const n = r.plan.crowns;
  r.plan = null;
  const cs = allCitizens(w).filter((c: any) => !exiled(w, c.id));
  const each = Math.floor(n / Math.max(1, cs.length));
  if (bal(w, 'treasury') >= n && each > 0) {
    cs.forEach((c: any) => transfer(w, 'treasury', ca(c.id), each, 'The five-year plan'));
    say(w, r, 'plan', `The five-year plan is met: ${each} crowns to every citizen.`);
  } else {
    legit(w, -6, 'The five-year plan failed');
    say(w, r, 'plan', `The five-year plan fails. The money was never there.`);
  }
}
export function closeTrial(w: W) {
  const r = w.regime;
  const t = r?.trial;
  if (!t) return;
  r.trial = null;
  const yes = Object.values(t.votes).filter((v) => v === true).length;
  const no = Object.values(t.votes).filter((v) => v === false).length;
  if (yes > no) (legit(w, 2, 'The trial was believed'), approve(w, t.target, -10));
  else if (no) (legit(w, -4, 'Nobody believed the trial'), approve(w, t.target, 8));
  else legit(w, -1, 'A trial nobody watched');
  say(w, r, 'trial', `The trial of ${nm(w, t.target)} ends: ${yes} believed it, ${no} did not.${yes > no ? '' : ' The regime looks ridiculous.'}`);
}
export function trialVote(w: W, actor: Id, believe: unknown) {
  const r = R(w);
  if (!r.trial) fail('There is no trial.');
  mustBeFree(w, actor);
  if (r.trial.target === actor || r.leader === actor) fail('You are part of the trial.');
  r.trial.votes[actor] = !!believe;
}
export function plebisciteVote(w: W, actor: Id, yes: unknown) {
  const r = R(w);
  if (!r.plebiscite) fail('There is no plebiscite.');
  mustBeFree(w, actor);
  r.plebiscite.votes[actor] = !!yes;
}
export function closePlebiscite(w: W) {
  const r = w.regime;
  const p = r?.plebiscite;
  if (!p) return;
  r.plebiscite = null;
  const yes = Object.values(p.votes).filter((v) => v === true).length;
  const no = Object.values(p.votes).filter((v) => v === false).length;
  if (yes > no) {
    r.president = true;
    r.legit = Math.max(r.legit, 10);
    r.legit0 = Math.max(r.legit0, r.legit);
    stamp(w, r.leader, 'President', 'By plebiscite', 'ink');
    return say(w, r, 'plebiscite', `The plebiscite: ${yes} yes, ${no} no. ${nm(w, r.leader)} is confirmed as President.`);
  }
  gazette(w, 'crisis', `The plebiscite: ${yes} yes, ${no} no. The people have refused ${nm(w, r.leader)}.`, '#/regime');
  fallRegime(w, 'plebiscite', null);
}

// ================= Life under a regime =================
// the censor: a held story is printed or struck
export function censor(w: W, actor: Id, sid: Id, allow: unknown) {
  const r = R(w);
  if (!inRegime(r, actor)) fail('Only the regime censors.');
  const s = w.stories.find((x: any) => x.id === sid);
  if (!s || s.status !== 'held') fail('That story is not waiting for the censor.');
  s.status = allow ? 'published' : 'censored';
  s.at = w.now;
  if (allow) earn(w, s.by, 1, 'Story published');
  else gazette(w, 'press', `A story in ${w.papers[s.paper]?.name || 'the press'} is struck out by the censor.`, '#/press');
}
// the underground press: printed whatever the censor says, unsigned. Three times in ten the author is found out
export function underground(w: W, actor: Id, headline: unknown, body: unknown) {
  const r = R(w);
  if (!r.censorship) fail('The press is free. Write for a newspaper.');
  mustBeFree(w, actor);
  if (inRegime(r, actor)) fail('You are the regime.');
  const h = txt(headline, 5, 120, 'headline');
  if (body !== undefined && body !== null && typeof body !== 'string') fail('The story must be text.');
  const b = String(body ?? '').trim();
  if (b.length > 2000) fail('Keep the story under 2000 characters.');
  if (w.stories.filter((x: any) => x.underground && x.by === actor && x.at > w.now - DAY).length >= 2) fail('Two pamphlets a day is risk enough.');
  const named = chance(w, 0.3);
  w.stories.unshift({ id: newId(w, 'st'), paper: null, by: actor, headline: h, body: b, photo: null, status: 'published', at: w.now, cheers: [], underground: true, named });
  bump(w, actor, 'underground');
  gazette(w, 'press', `An underground pamphlet is passed from hand to hand: “${h}”.`, '#/press');
  if (named) {
    r.marked[actor] = 'Wrote for the underground press';
    gazette(w, 'crisis', `The secret police name the author of an underground pamphlet: ${nm(w, actor)}.`, '#/regime');
  }
}
export function prisonLetter(w: W, actor: Id, text: unknown) {
  const c = cit(w, actor);
  if (!detained(w, actor)) fail('You are not in prison.');
  if (c.letterDay === DAYNO(w.now)) fail('One letter a day is all the guard will carry.');
  const t = txt(text, 8, 500, 'letter');
  c.letterDay = DAYNO(w.now);
  bump(w, actor, 'letters');
  gazette(w, 'letter', `Smuggled out of prison, from ${c.name}: “${t}”`, '#/regime');
}
// two free citizens can spring a detainee, unless the secret police were watching either of them
export function jailbreak(w: W, actor: Id, target: Id) {
  const r = R(w);
  mustBeFree(w, actor);
  if (inRegime(r, actor)) fail('You hold the keys already.');
  cit(w, target);
  if (jailed(w, target)) fail('Nobody breaks out of the Realm Jail. Only the government can release them.');
  if (!held(w, target)) fail('They are not being held.');
  const list: Id[] = (r.breaks[target] ??= []);
  if (list.includes(actor)) fail('You are in. It needs one more person.');
  list.push(actor);
  if (list.length < 2) return;
  delete r.breaks[target];
  const watched = r.probes.some((p: any) => list.includes(p.target) && w.now - p.at < DAY);
  if (watched) {
    list.forEach((id) => (r.marked[id] = 'Tried to break someone out'));
    return gazette(w, 'crisis', `A jailbreak fails: the secret police were waiting. ${list.map((id) => nm(w, id)).join(' and ')} are marked.`, '#/regime');
  }
  w.citizens[target].detainedUntil = w.now;
  list.forEach((id) => (bump(w, id, 'jailbreaks'), approve(w, id, 3)));
  r.lastBlow = actor;
  legit(w, -1, 'A jailbreak');
  gazette(w, 'crisis', `${nm(w, target)} is broken out of prison. Nobody knows who did it.`, '#/regime');
}
export function policeProbe(w: W, actor: Id, target: Id) {
  const r = R(w);
  if (r.police !== actor) fail('Only the chief of the secret police does that.');
  cit(w, target);
  if (r.probeDay === DAYNO(w.now)) fail('One name a day.');
  r.probeDay = DAYNO(w.now);
  r.probes.unshift({
    at: w.now, target, strike: r.strike.includes(target), underground: w.stories.some((s: any) => s.underground && s.by === target && s.at >= r.startedAt),
    plot: Object.values(w.plots).some((p: any) => p.status === 'planning' && p.members.includes(target))
  });
  r.probes = r.probes.slice(0, 20);
}
export function strike(w: W, actor: Id) {
  const r = R(w);
  mustBeFree(w, actor);
  if (inRegime(r, actor)) fail('You are the regime.');
  const was = strikeOn(w);
  const i = r.strike.indexOf(actor);
  if (i >= 0) r.strike.splice(i, 1);
  else r.strike.push(actor);
  if (i < 0) bump(w, actor, 'strikes');
  if (!was && strikeOn(w)) {
    r.lastBlow = actor;
    gazette(w, 'crisis', `A general strike begins. There will be no payday while it holds, and the regime loses legitimacy every day.`, '#/regime');
  } else if (was && !strikeOn(w)) gazette(w, 'crisis', 'The general strike falters: too few are still out.', '#/regime');
}
export function swear(w: W, actor: Id, yes: unknown) {
  const r = R(w);
  if (!r.oath) fail('Nobody has asked you to swear anything.');
  mustBeFree(w, actor);
  if (r.oath[actor]) fail('You have already answered.');
  const c = cit(w, actor);
  if (yes) {
    r.oath[actor] = 'sworn';
    r.collab[actor] = r.collab[actor] || 'Swore the loyalty oath';
    transfer(w, 'treasury', ca(actor), 3, 'For swearing the oath');
    stamp(w, actor, 'Swore the oath', `To ${nm(w, r.leader)}`, 'ink');
    gazette(w, 'quiet', `${c.name} swears loyalty to the regime.`, '#/regime');
    const sworn = Object.values(r.oath).filter((v) => v === 'sworn').length;
    if (!r.oathWon && sworn > allCitizens(w).length / 2) (r.oathWon = true), legit(w, 2, 'Most of the realm has sworn');
  } else {
    r.oath[actor] = 'refused';
    r.marked[actor] = 'Refused the oath';
    approve(w, actor, 2);
    gazette(w, 'crisis', `${c.name} refuses the loyalty oath.`, '#/regime');
  }
}
// the Party: apply, and the Chairman admits or refuses
export function applyParty(w: W, actor: Id) {
  const r = R(w);
  if (r.type !== 'party') fail('There is no Party to join.');
  mustBeFree(w, actor);
  if (w.citizens[actor].party === r.party) fail('You are already a member.');
  if (r.applicants.includes(actor)) fail('Your application is with the Chairman.');
  r.applicants.push(actor);
}
export function admitParty(w: W, actor: Id, target: Id, yes: unknown) {
  const r = R(w);
  if (r.leader !== actor) fail('Only the Chairman admits members.');
  if (!r.applicants.includes(target)) fail('They have not applied.');
  r.applicants = r.applicants.filter((x: Id) => x !== target);
  if (!yes) return;
  const c = cit(w, target);
  c.party = r.party;
  r.collab[target] = r.collab[target] || 'Held a Party card';
  bump(w, target, 'partyCard');
  gazette(w, 'party', `${c.name} is admitted to the ${w.parties[r.party].name}.`, '#/regime');
}
// removing the leader from inside: the council of a junta (or martial law), the members of the Party, or, against
// a dictator, the General alone
export function palace(w: W, actor: Id) {
  const r = R(w);
  mustBeFree(w, actor);
  if (r.type === 'civil') fail('The Prime Minister rules by law, not by force. Bring them down in the House, or in the backroom.');
  if (r.leader === actor) fail('You cannot overthrow yourself.');
  if (r.type === 'dictatorship') {
    if (!w.offices.army || holderOf(w, 'army') !== actor) fail('Only the General can remove a dictator.');
    const old = r.leader;
    r.lastBlow = actor;
    bump(w, actor, 'kingmaker');
    if (r.heir && free(w, r.heir)) {
      r.leader = r.heir;
      r.council = [r.heir];
      r.heir = null;
      r.legit = Math.max(1, Math.ceil(r.legit / 2));
      w.pm = r.leader;
      if (w.martial) suspend(w, r);
      return say(w, r, 'palace', `The General removes ${nm(w, old)}. The heir, ${nm(w, r.leader)}, takes over a weakened regime.`);
    }
    gazette(w, 'crisis', `The General removes ${nm(w, old)} from power.`, '#/regime');
    return fallRegime(w, 'palace', actor);
  }
  const who: Id[] = (r.type === 'party' ? members(w, r.party) : r.council).filter((m: Id) => m !== r.leader);
  if (!who.includes(actor)) fail(r.type === 'party' ? 'Only Party members can remove the Chairman.' : 'Only the council can remove its leader.');
  r.ouster ??= { by: actor, votes: [] };
  if (r.ouster.votes.includes(actor)) fail('You have already moved against the leader.');
  r.ouster.votes.push(actor);
  if (r.ouster.votes.length <= who.length / 2) return;
  const old = r.leader;
  const next = free(w, r.ouster.by) ? r.ouster.by : actor;
  r.ouster = null;
  r.leader = next;
  if (r.type !== 'party') r.council = r.council.filter((m: Id) => m !== old);
  else w.parties[r.party].leader = next;
  w.pm = next;
  if (w.martial) suspend(w, r);
  legit(w, -1, 'A palace coup');
  say(w, r, 'palace', `A palace coup: ${nm(w, old)} is pushed out by ${r.type === 'party' ? 'the Party' : 'the council'}. ${nm(w, next)} now leads the regime.`);
}
// the Party votes to give the realm back
export function freeElections(w: W, actor: Id) {
  const r = R(w);
  if (r.type !== 'party') fail('That is for a one-party state.');
  mustBeFree(w, actor);
  const who = members(w, r.party);
  if (!who.includes(actor)) fail('Only Party members vote on that.');
  if (r.freeVotes.includes(actor)) fail('You have already voted for free elections.');
  r.freeVotes.push(actor);
  if (r.freeVotes.filter((m: Id) => who.includes(m)).length > who.length / 2) {
    gazette(w, 'crisis', `The ${w.parties[r.party].name} votes to restore free elections.`, '#/regime');
    fallRegime(w, 'exit', actor);
  }
}
export function leakRigging(w: W, actor: Id) {
  const r = R(w);
  if (!r.rigged) fail('There is nothing to leak.');
  if (!((r.council.includes(actor) && actor !== r.leader) || r.police === actor)) fail('You don’t know enough to leak it.');
  stamp(w, actor, 'Whistleblower', 'Leaked the rigged election', 'good');
  gazette(w, 'scandal', `${nm(w, actor)} reveals that the regime’s election was rigged from the start.`, '#/regime');
  fallRegime(w, 'leak', actor);
}
// a negotiated exit: the leader offers to hand back power in return for amnesty. The head of state answers
// (if there is one outside the regime); silence for a day is a yes
export const arbiter = (w: W): Id | null => (w.regime && w.hos.holder && !inRegime(w.regime, w.hos.holder) && free(w, w.hos.holder) ? w.hos.holder : null);
export function offerExit(w: W, actor: Id) {
  const r = R(w);
  if (r.type === 'civil') fail('There is no regime to hand back. Repeal the Government Powers Act instead.');
  if (r.leader !== actor) fail('Only the leader can offer to go.');
  if (r.exit) fail('The offer is already on the table.');
  if (r.exitRefused && w.now - r.exitRefused < 2 * DAY) fail('It was refused. Wait two days before offering again.');
  r.exit = { at: w.now, dueAt: w.now + DAY };
  gazette(w, 'crisis', `${nm(w, actor)} offers to hand back power in return for amnesty. ${arbiter(w) ? `The ${hosTitle(w)} has a day to answer.` : 'With nobody to refuse, it takes effect in a day.'}`, '#/regime');
}
export function answerExit(w: W, actor: Id, yes: unknown) {
  const r = R(w);
  if (!r.exit) fail('There is no offer to answer.');
  if (arbiter(w) !== actor) fail(`Only the ${hosTitle(w)} answers that.`);
  settleExit(w, !!yes);
}
export function settleExit(w: W, yes: boolean) {
  const r = w.regime;
  if (!r?.exit) return;
  r.exit = null;
  if (yes) {
    gazette(w, 'hos', `The regime’s offer is accepted: amnesty for those who ran it, and an election at once.`, '#/regime');
    return fallRegime(w, 'exit', null);
  }
  r.exitRefused = w.now;
  legit(w, -1, 'Its offer to go was refused');
  gazette(w, 'hos', `The ${hosTitle(w)} refuses the regime’s offer. No amnesty.`, '#/regime');
}

// ================= The daily turn, payday, and keeping things consistent =================
const REGIME_CRISES = ['rg_mutiny', 'rg_ultimatum', 'rg_bankrun', 'rg_list'];
export function regimeDay(w: W) {
  const r = w.regime;
  if (!r) return;
  r.nextTick = w.now + DAY;
  if (r.type === 'civil') return;
  if (r.type === 'dictatorship') legit(w, -1, 'Another day of one-man rule');
  if (r.type === 'junta' && w.now >= r.startedAt + 7 * DAY) legit(w, -1, 'The junta has outstayed its week');
  // (two days' grace to hand out cards)
  if (r.type === 'party' && w.now - r.partyAt >= 2 * DAY && partyShare(w) < 0.5) legit(w, -1, 'The Party speaks for a minority');
  if (strikeOn(w)) legit(w, -1, 'The general strike');
  // a government in exile: the fled Prime Minister, sheltered by a nation that doesn't recognise the regime
  const f = r.fled && w.citizens[r.fled];
  if (f && f.asylum && r.foreign[f.asylum] !== 'recognise') {
    if (r.exileGov !== f.asylum) {
      r.exileGov = f.asylum;
      r.lastBlow = r.fled;
      Object.values(w.treaties).forEach((t: any) => t.nation === f.asylum && t.status === 'active' && ((t.status = 'suspended'), r.treaties.push(t.id)));
      gazette(w, 'foreign', `${w.nations[f.asylum].name} recognises ${f.name}’s government in exile, and suspends its treaties with the regime.`, '#/regime');
    }
    legit(w, -1, 'A government in exile');
  }
  if (!Object.values(w.crises).some((c: any) => c.status === 'open') && chance(w, 0.35)) {
    try {
      spawnCrisis(w, pick(w, REGIME_CRISES));
    } catch {}
  }
}
// at payday: conscription, nationalised banks, and the Party's stipend
export function regimePayday(w: W) {
  const r = w.regime;
  if (!r) return;
  if (r.conscription) allCitizens(w).forEach((c: any) => !exiled(w, c.id) && bal(w, ca(c.id)) >= 2 && transfer(w, ca(c.id), 'treasury', 2, 'Conscription levy'));
  r.banks.forEach((x: any) => {
    const amt = Math.floor(bal(w, 'bank:' + x.bank) / 10);
    if (amt > 0 && w.banks[x.bank]?.status === 'open') (transfer(w, 'bank:' + x.bank, 'treasury', amt, 'Nationalised bank'), (x.taken += amt));
  });
  if (r.type === 'party') members(w, r.party).forEach((m: Id) => !exiled(w, m) && transfer(w, 'treasury', ca(m), 2, 'Party stipend'));
}
// after every command and every deadline: the leader is the Prime Minister, a regime with no legitimacy falls,
// a finished Restoration election ends the provisional government and opens the reckoning
export function sync(w: W) {
  syncActs(w);
  syncCrown(w);
  coalitionGoverns(w);
  const r = w.regime;
  // rule by decree follows whoever is Prime Minister; nothing about it can fall
  if (r && r.type === 'civil') {
    r.leader = w.pm || null;
    r.council = w.pm ? [w.pm] : [];
    if (w.martial?.regime) w.martial.leader = w.pm || w.martial.leader;
  } else if (r) {
    const L = w.citizens[r.leader];
    if (!L || !L.active || L.suspended || exiled(w, r.leader) || detained(w, r.leader)) return fallRegime(w, 'collapse', r.lastBlow);
    if (w.pm !== r.leader) {
      w.pm = r.leader;
      w.pmInviteDue = null;
      w.formingSince = null;
    }
    w.confidence = null;
    if (r.rigged && !r.rigged.done && w.elections[r.rigged.election]?.status === 'closed') {
      r.rigged.done = true;
      legit(w, 4, 'Won an election');
      say(w, r, 'rigged', `The regime wins its election handsomely. Nobody is surprised.`);
    }
    if (r.legit <= 0) return fallRegime(w, 'collapse', r.lastBlow);
  }
  const t = w.transition;
  if (t) {
    if (t.election && w.elections[t.election]?.status === 'closed') endTransition(w);
    else {
      const L = w.citizens[t.leader];
      if (!L || !L.active || L.suspended || exiled(w, t.leader)) t.leader = pickLeader(w, null, t.fallen);
      if (w.pm !== t.leader) {
        w.pm = t.leader;
        w.pmInviteDue = null;
        w.formingSince = null;
      }
    }
  }
  const due = w.reckoningDue;
  if (due && !w.transition && !w.regime && w.elections[due.election]?.status === 'closed') {
    w.reckoningDue = null;
    openReckoning(w, due, 'mps', []);
  }
}

// ================= The fall =================
const HOW: Record<string, string> = {
  handback: 'handed power back on the day it promised', exit: 'left by agreement, with amnesty', collapse: 'ran out of legitimacy and collapsed', countercoup: 'was overthrown by a counter-coup',
  palace: 'was ended by its own General', plebiscite: 'lost its own plebiscite', leak: 'fell when its rigged election was exposed', comeback: 'was swept away'
};
export function fallRegime(w: W, why: string, by: Id | null | undefined) {
  const r = w.regime;
  if (!r) return;
  const days = Math.max(0, Math.round((w.now - r.startedAt) / DAY));
  // everything is undone (except the Realm Jail, which no regime's fall empties)
  undoAll(w, r);
  w.martial = null;
  w.confidence = null;
  // the record
  const L = w.citizens[r.leader];
  const label = r.president ? 'President for life' : REGIMES[r.type].ruler;
  if (L) stamp(w, r.leader, label, `${days} day${days === 1 ? '' : 's'} in power`, 'bad');
  bump(w, r.leader, 'ruledDays', days);
  if (by && ['dictatorship', 'party'].includes(r.type) && !['handback', 'exit'].includes(why)) {
    bump(w, by, 'tyrannicide');
    stamp(w, by, 'Tyrannicide', `Brought down ${L?.name || 'a tyrant'}`, 'good');
  }
  const h = { id: r.id, name: r.name, type: r.type, president: r.president, leader: r.leader, leaderName: L?.name || 'someone', council: r.council.slice(), from: r.startedAt, to: w.now, days, how: why, by: by || null, decrees: r.decrees.length, verdict: null as any };
  w.regimes.unshift(h);
  w.regimes = w.regimes.slice(0, 10);
  if (w.fame && !(w.induction && !w.induction.done) && !L?.bot) {
    w.fame.regimes ??= [];
    w.fame.regimes.unshift({ name: h.leaderName, type: REGIMES[r.type].name, days, how: HOW[why] || why, at: w.now });
    w.fame.regimes = w.fame.regimes.slice(0, 20);
  }
  w.scars = { until: w.now + 14 * DAY };
  const fallen = { id: r.id, leader: r.leader, council: [...new Set([r.leader, ...r.council])], type: r.type, dictator: r.type === 'dictatorship' || r.type === 'party', collab: { ...r.collab }, files: { police: r.police, probes: r.probes.slice(0, 10), rigged: !!r.rigged }, resisters: [...new Set([...(by ? [by] : []), ...r.strike])] };
  w.regime = null;
  w.pm = null;
  clearMinisters(w);
  gazette(w, 'crisis', `The regime of ${h.leaderName} ${HOW[why] || 'has ended'} after ${days} day${days === 1 ? '' : 's'}. Detainees are freed, exiles recalled, and everything it seized is returned.`, '#/regime');
  meter(w, 'stability', why === 'handback' || why === 'exit' ? 6 : 2, 'The regime ended');
  if (why === 'handback' || why === 'exit') {
    // an orderly end: straight to the Restoration election; then Parliament judges them, unless amnesty was agreed
    const e = restoration(w, 2);
    w.pmInviteDue = null;
    if (!e) formFromHouse(w);
    if (why === 'exit') h.verdict = 'amnesty';
    else if (e) w.reckoningDue = { ...fallen, election: e };
    else openReckoning(w, fallen, 'mps', []);
    return;
  }
  startTransition(w, fallen, by || null, why);
}
// call the Restoration election (or reuse one already open) and say which it is. Under the Continuity of
// Parliament Act there is none: null, and the government is formed from the sitting House instead
function restoration(w: W, days: number): Id | null {
  const open = () => (Object.values(w.elections) as any[]).filter((x) => x.kind === 'general' && x.status === 'open').pop();
  if (!open()) {
    if (inForce(w, 'continuity')) return null;
    gazette(w, 'election', 'Polls open for the Restoration election.', '#/elections');
    callGeneralElection(w, w.now + days * DAY);
  }
  return open()?.id || null;
}

// ---------- undoing decrees: all of them when a regime falls, one at a time under the Government Powers Act ----------
function lift(w: W, r: any, what: string): boolean {
  const any = (b: any) => !!b;
  switch (what) {
    case 'censorship':
      if (!r.censorship) return false;
      r.censorship = false;
      w.stories.forEach((s: any) => s.status === 'held' && (s.status = 'published'));
      return true;
    case 'curfew':
      return any(r.curfew) && !(r.curfew = false);
    case 'parliament':
      if (!w.martial?.regime) return false;
      w.martial = null;
      return true;
    case 'conscription':
      return any(r.conscription) && !(r.conscription = false);
    case 'trade':
      return any(r.trade) && !(r.trade = false);
    case 'police':
      return any(r.police) && !(r.police = null);
    case 'oath':
      return any(r.oath) && !(r.oath = null);
    case 'banks':
      if (!r.banks.length) return false;
      r.banks.forEach((x: any) => x.taken > 0 && w.banks[x.bank] && transfer(w, 'treasury', 'bank:' + x.bank, x.taken, 'Returned: nationalisation ended'));
      r.banks = [];
      return true;
    case 'bans':
      if (!Object.keys(r.banned).length) return false;
      Object.entries(r.banned).forEach(([pid, ms]: any) => {
        if (w.parties[pid]?.status !== 'banned') return;
        w.parties[pid].status = 'active';
        ms.forEach((m: Id) => w.citizens[m] && !w.citizens[m].party && (w.citizens[m].party = pid));
      });
      r.banned = {};
      return true;
    case 'seized':
      if (!r.seized.length) return false;
      r.seized.forEach((s: any) => {
        if (s.amt > 0) transfer(w, 'escrow', s.acct, s.amt, 'Returned: seized by decree');
        if (s.bank && w.banks[s.bank]?.status === 'frozen') w.banks[s.bank].status = 'open';
      });
      r.seized = [];
      return true;
    case 'exiles': {
      const out = allCitizens(w).filter((c: any) => r.exiles.includes(c.id) && exiled(w, c.id) && r.fled !== c.id);
      out.forEach((c: any) => ((c.exiledUntil = w.now), (c.exileNoted = true)));
      r.exiles = r.exiles.filter((id: Id) => id === r.fled);
      return out.length > 0;
    }
    case 'tax':
    case 'rate':
    case 'constitution': {
      const keys = what === 'tax' ? ['taxRate'] : what === 'rate' ? ['rate'] : ['voting', 'passRule', 'termDays'];
      const set = keys.filter((k) => own(r.prev, k));
      set.forEach((k) => ((k === 'rate' ? (w.economy.rate = r.prev[k]) : (w.config[k] = r.prev[k])), delete r.prev[k]));
      return set.length > 0;
    }
  }
  return false;
}
function undoAll(w: W, r: any) {
  allCitizens(w).forEach((c: any) => held(w, c.id) && (c.detainedUntil = w.now));
  ['censorship', 'curfew', 'conscription', 'trade', 'police', 'oath', 'banks', 'bans', 'seized', 'exiles', 'tax', 'rate', 'constitution'].forEach((k) => lift(w, r, k));
  r.suspended.forEach((pid: Id) => w.parties[pid]?.status === 'suspended' && (w.parties[pid].status = 'active'));
  w.stories.forEach((s: any) => s.status === 'held' && (s.status = 'published'));
  Object.values(w.nations).forEach((n: any) => n.regimeSanction && ((n.sanctionsUntil = null), (n.regimeSanction = false)));
  r.treaties.forEach((id: Id) => w.treaties[id]?.status === 'suspended' && (w.treaties[id].status = 'active'));
}

// ---------- rule by decree under the Government Powers Act ----------
// The Prime Minister's built-in decrees need somewhere to keep what they did: a 'civil' regime, which follows the
// PM, has no legitimacy, never falls, and is undone only by a coup or the repeal of the Act
export function edict(w: W, actor: Id, a: any) {
  if (!inForce(w, 'decrees')) fail('The Prime Minister has no power to issue decrees.');
  if (!isPM(w, actor)) fail('Only the Prime Minister issues decrees.');
  // a regime's leader is the Prime Minister: they decree as the regime, at its usual price
  if (w.regime && w.regime.type !== 'civil') return decree(w, actor, a);
  if (!w.regime) {
    w.regime = {
      id: newId(w, 'rg'), name: 'Rule by decree', type: 'civil', chosen: true, chooseBy: w.now, leader: actor, council: [actor], startedAt: w.now, until: null,
      legit: 10, legit0: 10, log: [], swift: false, backer: null, ousted: null, fled: null, stood: false,
      decreeDay: -1, decrees: [], pending: null, censorship: false, curfew: false, police: null, probes: [], probeDay: -1, marked: {}, collab: {},
      exiles: [], banned: {}, suspended: [], seized: [], banks: [], trade: false, conscription: false, oath: null, oathWon: false, heir: null, party: null, applicants: [],
      strike: [], breaks: {}, trial: null, plebiscite: null, president: false, rigged: null, plan: null, prev: {}, foreign: {}, exileGov: null, treaties: [],
      exit: null, ouster: null, freeVotes: [], lastCircus: 0, lastBlow: null, nextTick: w.now + DAY
    };
  }
  decree(w, actor, a);
}
export function endCivil(w: W, why: string | null) {
  const r = w.regime;
  if (!r || r.type !== 'civil') return;
  undoAll(w, r);
  if (w.martial?.regime) w.martial = null;
  w.regime = null;
  if (why) gazette(w, 'law', why, '#/laws');
}

// ================= The provisional government =================
export const FORMS: Record<string, { name: string; what: string; effects: string[] }> = {
  // (under the Continuity of Parliament Act there is no election: the provisional government simply ends when stated)
  unity: { name: 'Government of national unity', what: 'Every party leader gets a seat at the table. The election is called at once and closes in 3 days.', effects: ['Stability +5', 'Parliament sits'] },
  caretaker: { name: 'Caretaker government', what: 'Nobody governs, somebody minds the shop. Parliament stays shut and the election closes in 2 days.', effects: ['Prosperity +3', 'No bills until the election'] },
  council: { name: 'Revolutionary council', what: 'The people who brought the regime down rule for 3 days before any election, and try the regime themselves, at once.', effects: ['Stability −5', 'A tribunal instead of Parliament', 'More trouble'] },
  regency: { name: 'Regency', what: 'The head of state rules directly for 2 days, then calls the election.', effects: ['Army loyalty +1', 'No bills until the election'] }
};
export const ACTS: Record<string, { name: string; what: string; effects: string[] }> = {
  amnesty: { name: 'Amnesty', what: 'Nobody is tried. The realm moves on.', effects: ['Stability +4', 'Your approval −5', 'No reckoning'] },
  lustrate: { name: 'Lustration', what: 'Everyone who ran the regime or collaborated is barred from standing or holding office for two weeks.', effects: ['Stability −3'] },
  truth: { name: 'Open the files', what: 'Publish what the regime kept secret: who ran the secret police, who they watched, whether the election was rigged.', effects: ['Stability +2', 'Collaborators’ approval −3'] }
};
function pickLeader(w: W, by: Id | null, fallen: any): Id {
  const ok = (id: Id | null | undefined) => !!id && free(w, id) && !fallen.council.includes(id);
  if (ok(by)) return by!;
  if (ok(w.hos.holder)) return w.hos.holder;
  if (ok(w.speaker)) return w.speaker;
  const rest = allCitizens(w).filter((c: any) => ok(c.id) && !c.bot).sort((a: any, b: any) => b.approval - a.approval);
  return (rest[0] || allCitizens(w).filter((c: any) => ok(c.id))[0] || allCitizens(w)[0]).id;
}
function startTransition(w: W, fallen: any, by: Id | null, why: string) {
  const leader = pickLeader(w, by, fallen);
  w.transition = { id: newId(w, 'tr'), at: w.now, leader, by, why, form: null, formDue: w.now + 12 * HOUR, callAt: null, election: null, acts: {}, claims: {}, amnesty: false, fallen, nextTick: w.now + DAY, council: [] };
  w.pm = leader;
  w.pmInviteDue = null;
  w.formingSince = null;
  gazette(w, 'government', `${nm(w, leader)} leads a provisional government until the realm can vote. They have 12 hours to decide what kind.`, '#/regime');
}
export function formTransition(w: W, actor: Id, kind: unknown) {
  const t = w.transition || fail('There is no provisional government.');
  if (t.leader !== actor) fail('Only the leader of the provisional government decides.');
  if (t.form) fail('That has been decided.');
  if (typeof kind !== 'string' || !own(FORMS, kind)) fail('Pick a kind of government.');
  if (kind === 'regency' && !(w.hos.holder && free(w, w.hos.holder) && !t.fallen.council.includes(w.hos.holder))) fail('There is no head of state to be regent.');
  if (kind === 'council' && t.fallen.resisters.filter((id: Id) => free(w, id)).length < 1) fail('Nobody brought this regime down: there is no one to sit on a revolutionary council.');
  setForm(w, t, kind);
}
export function setForm(w: W, t: any, kind: string) {
  t.form = kind;
  t.formDue = null;
  const shut = () => (w.martial = { leader: t.leader, plotters: [], until: null, regime: true, provisional: true });
  if (kind === 'unity') {
    meter(w, 'stability', 5, 'A government of national unity');
    const leaders = Object.values(w.parties).filter((p: any) => p.status === 'active' && p.leader && p.leader !== t.leader && free(w, p.leader) && !t.fallen.council.includes(p.leader)).map((p: any) => p.leader);
    Object.values(w.offices).filter((o: any) => o.fill === 'pm').forEach((o: any, i) => (o.holder = leaders[i] || null));
    t.election = restoration(w, 3);
    if (!t.election) t.endsAt = w.now + 3 * DAY;
  } else if (kind === 'caretaker') {
    meter(w, 'prosperity', 3, 'A steady caretaker');
    shut();
    t.election = restoration(w, 2);
    if (!t.election) t.endsAt = w.now + 2 * DAY;
  } else if (kind === 'council') {
    meter(w, 'stability', -5, 'A revolutionary council');
    t.council = [...new Set([t.leader, ...t.fallen.resisters.filter((id: Id) => free(w, id))])];
    shut();
    t.callAt = w.now + 3 * DAY;
    if (!t.amnesty) openReckoning(w, t.fallen, 'council', t.council);
  } else {
    t.leader = w.hos.holder;
    w.pm = t.leader;
    if (w.offices.army) armyLoyalty(w, 1, 'The Crown took command');
    shut();
    t.callAt = w.now + 2 * DAY;
  }
  gazette(w, 'government', `The provisional government: ${FORMS[kind].name.toLowerCase()}, led by ${nm(w, t.leader)}. ${FORMS[kind].what}`, '#/regime');
}
export function callRestoration(w: W) {
  const t = w.transition;
  if (!t) return;
  t.callAt = null;
  t.election = restoration(w, 2);
  if (!t.election) endTransition(w);
}
export function actTransition(w: W, actor: Id, act: unknown) {
  const t = w.transition || fail('There is no provisional government.');
  if (t.leader !== actor) fail('Only the leader of the provisional government does that.');
  if (typeof act !== 'string' || !own(ACTS, act)) fail('Pick an act.');
  if (t.acts[act]) fail('That is already done.');
  if ((act === 'amnesty' && t.acts.lustrate) || (act === 'lustrate' && t.acts.amnesty)) fail('You can forgive them or bar them, not both.');
  t.acts[act] = w.now;
  const f = t.fallen;
  if (act === 'amnesty') {
    if (w.reckoning) fail('The tribunal is already sitting.');
    t.amnesty = true;
    meter(w, 'stability', 4, 'An amnesty');
    approve(w, actor, -5);
    gazette(w, 'government', `${nm(w, actor)} declares an amnesty: nobody will be tried for the regime.`, '#/regime');
  } else if (act === 'lustrate') {
    const out = [...new Set([...f.council, ...Object.keys(f.collab)])];
    out.forEach((id) => {
      const c = w.citizens[id];
      if (!c) return;
      c.barredUntil = w.now + 14 * DAY;
      Object.values(w.elections).forEach((e: any) => e.status === 'open' && ['general', 'speaker', 'office', 'hos'].includes(e.kind) && delete e.candidates[id]);
      Object.values(w.offices).forEach((o: any) => o.holder === id && (o.holder = null));
    });
    meter(w, 'stability', -3, 'Lustration');
    gazette(w, 'government', `Lustration: ${out.map((id) => nm(w, id)).join(', ')} ${out.length === 1 ? 'is' : 'are'} barred from standing or holding office for two weeks.`, '#/regime');
  } else {
    meter(w, 'stability', 2, 'The files were opened');
    Object.keys(f.collab).forEach((id) => approve(w, id, -3));
    const watched = [...new Set(f.files.probes.map((p: any) => nm(w, p.target)))];
    gazette(w, 'scandal', `The regime’s files are opened. ${f.files.police ? `${nm(w, f.files.police)} ran the secret police${watched.length ? `, and watched ${watched.join(', ')}` : ''}.` : 'It had no secret police.'}${f.files.rigged ? ' Its election was rigged.' : ''} Collaborators: ${Object.keys(f.collab).map((id) => nm(w, id)).join(', ') || 'none named'}.`, '#/regime');
  }
}
// a rival claim: anyone can declare themselves the rightful government (10 Influence). Citizens back one claimant;
// each day the best-backed leads. If the fallen leader wins the backing, the regime is back
export function claimPower(w: W, actor: Id) {
  const t = w.transition || fail('There is no provisional government.');
  mustBeFree(w, actor);
  if (t.leader === actor) fail('You already lead it.');
  if (t.claims[actor]) fail('You have already claimed it.');
  spend(w, actor, 10, 'Claimed the government');
  t.claims[actor] = [actor];
  meter(w, 'stability', -3, 'A rival government');
  gazette(w, 'crisis', `${nm(w, actor)} declares a rival government${t.fallen.council.includes(actor) ? ': the old regime wants its realm back' : ''}. Citizens can back either.`, '#/regime');
}
export function backClaim(w: W, actor: Id, who: Id) {
  const t = w.transition || fail('There is no provisional government.');
  mustBeFree(w, actor);
  if (who !== t.leader && !t.claims[who]) fail('They have made no claim.');
  t.claims[t.leader] ??= [];
  Object.keys(t.claims).forEach((k) => (t.claims[k] = t.claims[k].filter((x: Id) => x !== actor)));
  t.claims[who].push(actor);
}
const AFTERMATH = ['aft_loyalists', 'aft_reprisals', 'aft_general', 'aft_bankrun', 'aft_border', 'aft_secession'];
export function transitionDay(w: W) {
  const t = w.transition;
  if (!t) return;
  t.nextTick = w.now + DAY;
  const rivals = Object.keys(t.claims).filter((k) => k !== t.leader && free(w, k));
  if (rivals.length) {
    meter(w, 'stability', -3, 'Two governments');
    const n = (k: Id) => (t.claims[k] || []).length;
    const top = rivals.sort((a, b) => n(b) - n(a))[0];
    if (n(top) > n(t.leader)) {
      if (t.fallen.council.includes(top)) {
        // the Hundred Days: the old regime is carried back in
        gazette(w, 'crisis', `${nm(w, top)} is carried back to power by ${n(top)} supporters. The provisional government melts away.`, '#/regime');
        w.reckoning = null;
        return takePower(w, { leader: top, council: [top], name: 'The Return', swift: false, legit: 5, backer: null, backers: t.claims[top].filter((x: Id) => x !== top), type: 'dictatorship' });
      }
      delete t.claims[top];
      t.claims[t.leader] = [];
      t.leader = top;
      w.pm = top;
      if (w.martial) w.martial.leader = top;
      gazette(w, 'government', `${nm(w, top)} now leads the provisional government, with more of the realm behind them.`, '#/regime');
    }
  }
  if (!Object.values(w.crises).some((c: any) => c.status === 'open') && chance(w, t.form === 'council' ? 0.85 : 0.6)) {
    const seen = t.seen || (t.seen = []);
    const left = AFTERMATH.filter((x) => !seen.includes(x));
    if (left.length) {
      const type = pick(w, left);
      seen.push(type);
      try {
        spawnCrisis(w, type);
      } catch {}
    }
  }
}
export function endTransition(w: W) {
  const t = w.transition;
  if (!t) return;
  w.transition = null;
  if (w.martial?.provisional) w.martial = null;
  // with no election to form a government, the head of state invites one from the House as it stands
  if (inForce(w, 'continuity')) {
    formFromHouse(w);
    gazette(w, 'government', 'The provisional government stands down. With no election, the head of state will invite a government from the House as it stands.', '#/cabinet');
  } else gazette(w, 'government', 'The provisional government stands down. The realm has an elected Parliament again.', '#/house');
  if (!t.amnesty && !w.reckoning && !w.regimes.find((h: any) => h.id === t.fallen.id)?.verdict) openReckoning(w, t.fallen, 'mps', []);
  else if (t.amnesty) {
    const h = w.regimes.find((x: any) => x.id === t.fallen.id);
    if (h && !h.verdict) h.verdict = 'amnesty';
  }
}

// ================= The reckoning =================
export const VERDICTS: Record<string, string> = { pardon: 'Pardon them', fine: 'Fine each of them 30 crowns', exile: 'Exile for a week, and no office for two' };
function openReckoning(w: W, fallen: any, voters: 'mps' | 'council', council: Id[]) {
  w.reckoning = { id: newId(w, 'rk'), regime: fallen.id, at: w.now, closesAt: w.now + (voters === 'council' ? DAY : 2 * DAY), voters, council, leader: fallen.leader, targets: fallen.council.slice(), dictator: fallen.dictator, collab: fallen.collab, votes: {} };
  gazette(w, 'court', `The reckoning: ${voters === 'council' ? 'the revolutionary council sits as a tribunal on' : 'Parliament must decide what happens to'} ${fallen.council.map((id: Id) => nm(w, id)).join(', ')}.`, '#/regime');
}
export const canJudge = (w: W, id: Id) => !!w.reckoning && (w.reckoning.voters === 'council' ? w.reckoning.council.includes(id) : isMP(w, id)) && !w.reckoning.targets.includes(id);
export function reckoningVote(w: W, actor: Id, verdict: unknown) {
  const k = w.reckoning || fail('There is no reckoning.');
  mustBeFree(w, actor);
  if (!canJudge(w, actor)) fail(k.targets.includes(actor) ? 'You cannot sit in judgment on yourself.' : k.voters === 'council' ? 'Only the revolutionary council sits on the tribunal.' : 'Only MPs vote on the reckoning.');
  if (typeof verdict !== 'string' || !own(VERDICTS, verdict)) fail('Pardon, fine or exile.');
  k.votes[actor] = verdict;
}
export function closeReckoning(w: W) {
  const k = w.reckoning;
  if (!k) return;
  w.reckoning = null;
  const order = ['pardon', 'fine', 'exile'];
  const n = (v: string) => Object.values(k.votes).filter((x) => x === v).length;
  const top = Math.max(...order.map(n));
  // a tie goes to the milder verdict; silence is a pardon
  const verdict = top ? order.find((v) => n(v) === top)! : 'pardon';
  const h = w.regimes.find((x: any) => x.id === k.regime);
  if (h) h.verdict = verdict;
  k.targets.forEach((id: Id) => {
    const c = w.citizens[id];
    if (!c) return;
    if (verdict === 'fine') {
      const amt = Math.min(30, bal(w, ca(id)));
      if (amt > 0) transfer(w, ca(id), 'treasury', amt, 'Fined at the reckoning');
    } else if (verdict === 'exile') {
      const long = k.dictator && id === k.leader ? 2 : 1;
      c.exiledUntil = w.now + 7 * long * DAY;
      c.exileNoted = false;
      c.asylum = null;
      c.barredUntil = w.now + 14 * long * DAY;
      bump(w, id, 'exiled');
      if (isMP(w, id)) vacateSeat(w, id, 'exiled');
      if (w.pm === id) (w.pm = null), clearMinisters(w), (w.pmInviteDue = w.now + DAY);
      Object.values(w.offices).forEach((o: any) => o.holder === id && (o.holder = null));
    }
  });
  gazette(w, 'court', `The reckoning is over: ${n('pardon')} for pardon, ${n('fine')} for a fine, ${n('exile')} for exile. ${verdict === 'pardon' ? 'They are pardoned.' : verdict === 'fine' ? 'Each is fined 30 crowns.' : 'They go into exile, and are barred from office.'}`, '#/regime');
}
