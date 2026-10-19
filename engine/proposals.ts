// Proposals: one lifecycle for everything Parliament does. Draft, debate, vote, then the result.
// The kind only changes who votes and what happens. Also: laws, PM's Questions, formal questions and lobbying.
import {
  W, Id, DAY, HOUR, fail, newId, cit, nm, allCitizens, exiled, mustBeFree, gazette, earn, spend, stamp, approve, tick, meter,
  isMP, mps, isPM, isHOS, inGovernment, transfer, ca, hosTitle, superMajority, majority, hasPower, officeWithPower, weekNo
} from './core';
import { TEMPLATES, POWERS, createOffice } from './offices';
import { startHosSelection, callGeneralElection, governmentFalls, vacateSeat, HOS_METHODS, countback } from './politics';

export const KINDS: Record<string, { name: string; who: string; blurb: string }> = {
  bill: { name: 'Bill', who: 'MPs', blurb: 'Changes the law. Each clause is a rule in words or something the game carries out.' },
  no_confidence: { name: 'No confidence', who: 'MPs', blurb: 'If it passes, the government has 3 days to win a confidence vote, or it falls.' },
  confidence: { name: 'Confidence', who: 'MPs', blurb: 'The government asks the House to back it. Wins back confidence after a defeat.' },
  censure: { name: 'Censure', who: 'MPs', blurb: 'A public rebuke of one person. Twice censured, they lose every office.' },
  referendum: { name: 'Referendum', who: 'Every citizen', blurb: 'Every citizen votes, in secret. If Yes wins, its clauses happen. Costs 20 Influence.' },
  dissolution: { name: 'Dissolution', who: 'Head of state', blurb: 'The PM asks for a snap election. The head of state decides.' }
};
export const SETTABLE: Record<string, { label: string; unit: string; min: number; max: number }> = {
  taxRate: { label: 'Income tax', unit: '%', min: 0, max: 50 },
  dividend: { label: 'Citizen dividend each week', unit: ' crowns', min: 0, max: 20 },
  mpPay: { label: 'MP pay each week', unit: ' crowns', min: 0, max: 30 },
  ministerPay: { label: 'Minister pay each week', unit: ' crowns', min: 0, max: 30 },
  tariff: { label: 'Tariff on trade ventures', unit: '%', min: 0, max: 40 },
  debateHours: { label: 'Debate length', unit: ' hours', min: 12, max: 48 },
  voteHours: { label: 'Voting length', unit: ' hours', min: 12, max: 48 }
};
export const CONSTITUTIONAL = ['constitution', 'removeHos'];

export function describe(w: W, e: any): string {
  switch (e.t) {
    case 'text':
      return e.text;
    case 'office': {
      if (e.template) {
        const t = TEMPLATES[e.template];
        return `Creates the ${t.name}, led by a ${t.title.toLowerCase()}. ${t.blurb}`;
      }
      const o = e.office;
      return `Creates the office of ${o.name}, ${({ pm: 'appointed by the PM', house: 'elected by MPs', citizens: 'elected by every citizen', lot: 'drawn by lot' } as any)[o.fill]}. Powers: ${o.powers.map((p: string) => POWERS[p]?.label.toLowerCase()).join('; ') || 'none'}.${o.budget ? ` Budget ${o.budget} crowns a week.` : ''} ${o.secrecy === 'secret' ? 'Its work is secret.' : ''}`;
    }
    case 'abolish':
      return `Abolishes the ${w.offices[e.office]?.name ?? 'office'}.`;
    case 'budget':
      return `Sets the ${w.offices[e.office]?.name ?? 'office'} budget to ${e.value} crowns a week.`;
    case 'set':
      return `Sets ${SETTABLE[e.key].label.toLowerCase()} to ${e.value}${SETTABLE[e.key].unit}.`;
    case 'permit':
      return 'Allows any citizen to open a licensed bank, take savings and make loans.';
    case 'treaty':
      return `Ratifies the ${w.offers[e.offer]?.title ?? 'treaty'}.`;
    case 'breakTreaty':
      return `Breaks the ${w.treaties[e.treaty]?.title ?? 'treaty'}.`;
    case 'repeal':
      return `Repeals ${e.ref}${w.laws.find((l: any) => l.ref === e.ref) ? ', the ' + w.laws.find((l: any) => l.ref === e.ref).title : ''}.`;
    case 'constitution':
      return `Changes the constitution: ${({ seats: 'seats in Parliament', termDays: 'time between general elections', hos: 'the head of state', hosMethod: 'how the head of state is chosen' } as any)[e.key]} becomes ${e.label ?? e.value}.`;
    case 'removeHos':
      return w.config.hos === 'monarchy' ? `Removes the ${w.config.hosTitle}. A new Monarch is chosen as the constitution says.` : 'Impeaches the President. A new one is chosen as the constitution says.';
    case 'war':
      return `Declares war on ${w.nations[e.nation]?.name}.`;
    case 'peace':
      return `Makes peace with ${w.nations[e.nation]?.name}.`;
  }
  return '';
}

export function propose(w: W, actor: Id, a: any) {
  mustBeFree(w, actor);
  if (w.phase !== 'running') fail('Proposals start once the constitution is adopted.');
  if (w.martial) fail('Parliament is suspended under martial law.');
  const kind = a.kind || 'bill';
  if (!KINDS[kind]) fail('Unknown kind of proposal.');
  const clauses = kind === 'bill' || kind === 'referendum' ? a.clauses || [] : [];
  let title = (a.title || '').trim();
  if (kind === 'confidence' || kind === 'dissolution') {
    if (!isPM(w, actor)) fail(`Only the Prime Minister can ask for ${kind === 'confidence' ? 'a confidence vote' : 'a dissolution'}.`);
  } else if (!isMP(w, actor) && !hasPower(w, actor, 'propose')) fail('Only MPs put proposals to the House.');
  if ((kind === 'no_confidence' || kind === 'confidence') && !w.pm) fail('There is no government.');
  if (kind === 'censure' && !w.citizens[a.target]) fail('Pick who to censure.');
  if ((kind === 'bill' || kind === 'referendum') && title.length < 4) fail('Give it a title.');
  if (kind === 'bill' && !clauses.length) fail('Add at least one clause.');
  if (kind === 'referendum' && title.length < 8) fail('Write the question.');
  for (const e of clauses) {
    if (e.t === 'text' && (e.text || '').trim().length < 6) fail('Write each clause in full.');
    if (e.t === 'set' && (!SETTABLE[e.key] || !(e.value >= SETTABLE[e.key].min && e.value <= SETTABLE[e.key].max))) fail('That value is out of range.');
    if (e.t === 'office' && e.template && w.offices[e.template]) fail(`The ${TEMPLATES[e.template].name} already exists.`);
    if (e.t === 'office' && !e.template && (e.office?.name || '').trim().length < 3) fail('Name the new office.');
    if (e.t === 'treaty' && !w.offers[e.offer]) fail('That treaty offer has expired.');
    if ((e.t === 'war' || e.t === 'peace') && !w.offices.army) fail('War and peace need an Army: pass the Defence Act first.');
    if (e.t === 'permit' && w.permits.banks) fail('Banks are already allowed.');
  }
  if (Object.values(w.proposals).some((p: any) => p.kind === kind && ['no_confidence', 'confidence', 'dissolution'].includes(kind) && ['debate', 'vote', 'hos'].includes(p.stage))) fail('One of those is already open.');
  if (kind === 'referendum') spend(w, actor, 20, 'Called a referendum');
  const open = Object.values(w.proposals).filter((p: any) => p.by === actor && ['debate', 'vote'].includes(p.stage)).length;
  if (open >= 2) spend(w, actor, 10, 'A third proposal at once');
  if (a.fast) spend(w, actor, 15, 'Fast-tracked a debate');
  const constitutional = clauses.some((e: any) => CONSTITUTIONAL.includes(e.t) || (e.t === 'office' && TEMPLATES[e.template]?.constitutional));
  w.propCount += 1;
  const id = newId(w, 'p');
  const titles: any = {
    no_confidence: 'That this House has no confidence in the government',
    confidence: 'That this House has confidence in the government',
    censure: `That this House censures ${nm(w, a.target)}`,
    dissolution: 'That Parliament be dissolved and a general election held'
  };
  const debateH = a.fast ? 12 : kind === 'no_confidence' || kind === 'confidence' || kind === 'censure' ? 12 : w.config.debateHours;
  w.proposals[id] = {
    id, n: w.propCount, kind, title: titles[kind] || title, summary: (a.summary || '').trim(), by: actor, clauses, target: a.target || null,
    constitutional, voters: kind === 'referendum' ? 'all' : 'mps', stage: kind === 'dissolution' ? 'hos' : 'debate', at: w.now,
    debateEndsAt: w.now + debateH * HOUR, voteEndsAt: null, assentDueAt: null, hosDueAt: kind === 'dissolution' ? w.now + DAY : null,
    speeches: [], votes: {}, casting: null, lobby: 0, result: null, lawRef: null, fast: !!a.fast
  };
  tick(w, actor, 'proposals');
  gazette(w, 'proposal', `${nm(w, actor)} puts a ${KINDS[kind].name.toLowerCase()} to the House: ${w.proposals[id].title}${constitutional ? ' (constitutional: needs ' + superMajority(w) + ' of ' + w.config.seats + ')' : ''}.`, '#/p/' + id);
  return id;
}

export function speak(w: W, actor: Id, pid: Id, side: string, text: string) {
  mustBeFree(w, actor);
  const p = w.proposals[pid];
  if (!p || !['debate', 'vote', 'override'].includes(p.stage)) fail('This is not being debated.');
  if ((text || '').trim().length < 3) fail('Write your speech.');
  if (!['for', 'against', 'undecided', 'order'].includes(side)) fail('Speak for, against or undecided.');
  if (side === 'order' && w.speaker !== actor) fail('Only the Speaker can call order.');
  p.speeches.push({ id: newId(w, 's'), by: actor, side, text: text.trim(), at: w.now });
  const c = cit(w, actor);
  const day = Math.floor(w.now / DAY);
  if (c.speakDay !== day) (c.speakDay = day), (c.speaksToday = 0);
  if (c.speaksToday++ < 3) earn(w, actor, 1, 'Spoke in a debate');
  tick(w, actor, 'speeches');
}

export function canVoteOn(w: W, p: any, id: Id) {
  if (exiled(w, id)) return false;
  if (p.stage === 'override') return isMP(w, id);
  return p.voters === 'all' ? !!w.citizens[id]?.active : isMP(w, id);
}
export function vote(w: W, actor: Id, pid: Id, v: string) {
  const p = w.proposals[pid];
  if (!p) fail('No such proposal.');
  if (p.stage === 'debate') fail('Voting opens when the debate ends.');
  if (p.stage !== 'vote' && p.stage !== 'override') fail('Voting has closed.');
  if (!canVoteOn(w, p, actor)) fail(w.speaker === actor ? 'The Speaker only votes to break a tie: set your casting vote.' : p.voters === 'all' ? 'You cannot vote in exile.' : 'Only MPs vote on this.');
  const book = p.stage === 'override' ? (p.overrideVotes = p.overrideVotes || {}) : p.votes;
  if (p.voters === 'all' && book[actor]) fail('Referendum ballots are secret and final.');
  if (book[actor] === undefined) {
    earn(w, actor, 2, 'Voted on a proposal');
    tick(w, actor, 'votes');
  }
  if (!['aye', 'no', 'abstain'].includes(v)) fail('Vote aye, no or abstain.');
  book[actor] = v;
}
export function casting(w: W, actor: Id, pid: Id, v: 'aye' | 'no') {
  if (w.speaker !== actor) fail('Only the Speaker has the casting vote.');
  const p = w.proposals[pid];
  if (!p || p.stage !== 'vote') fail('There is no open vote.');
  if (v !== 'aye' && v !== 'no') fail('Cast aye or no.');
  p.casting = v;
}

export function openVote(w: W, p: any) {
  p.stage = 'vote';
  p.voteEndsAt = w.now + (p.fast || ['no_confidence', 'confidence', 'censure'].includes(p.kind) ? 12 : w.config.voteHours) * HOUR;
  gazette(w, 'proposal', `Voting opens: ${p.title}. ${p.voters === 'all' ? 'Every citizen votes.' : 'MPs vote.'}`, '#/p/' + p.id);
}
function tally(w: W, p: any, book: any) {
  const valid = Object.entries(book).filter(([id]) => (p.voters === 'all' ? !!w.citizens[id] : isMP(w, id)));
  return { ayes: valid.filter(([, v]) => v === 'aye').length, noes: valid.filter(([, v]) => v === 'no').length };
}
export function closeVote(w: W, p: any) {
  const { ayes, noes } = tally(w, p, p.votes);
  let passed: boolean;
  let note = '';
  if (p.constitutional) {
    passed = ayes >= superMajority(w);
    note = ` (needed ${superMajority(w)})`;
  } else if (ayes === noes && p.voters === 'mps') {
    passed = (p.casting || 'no') === 'aye';
    note = `, the Speaker's casting vote ${passed ? 'for' : 'against'}`;
  } else passed = ayes > noes;
  p.result = { ayes, noes, passed, note };
  trackWhip(w, p);
  const sp = w.citizens[p.by];
  if (!passed) {
    p.stage = 'failed';
    approve(w, p.by, -2);
    gazette(w, 'proposal', `Defeated ${ayes} to ${noes}${note}: ${p.title}.`, '#/p/' + p.id);
    return;
  }
  gazette(w, 'proposal', `Passed ${ayes} to ${noes}${note}: ${p.title}.`, '#/p/' + p.id);
  approve(w, p.by, 3);
  if (p.kind === 'bill') {
    p.stage = 'assent';
    p.assentDueAt = w.now + 48 * HOUR;
    return;
  }
  p.stage = 'passed';
  if (sp) sp.stats.passed = (sp.stats.passed || 0) + 1;
  if (p.kind === 'no_confidence') {
    w.confidence = { at: w.now, deadline: w.now + 3 * DAY, by: p.by };
    meter(w, 'stability', -5, 'The government lost a confidence vote');
    gazette(w, 'government', 'The government has lost the confidence of the House. It has 3 days to win it back, or it falls.', '#/cabinet');
  }
  if (p.kind === 'confidence') {
    w.confidence = null;
    meter(w, 'stability', 3, 'The government won a confidence vote');
    approve(w, w.pm, 3);
  }
  if (p.kind === 'censure') {
    const t = w.citizens[p.target];
    t.censures = (t.censures || 0) + 1;
    approve(w, p.target, -10);
    stamp(w, p.target, 'Censured', 'By the House', 'bad');
    if (t.censures >= 2) {
      Object.values(w.offices).forEach((o: any) => o.holder === p.target && o.fill === 'pm' && (o.holder = null));
      gazette(w, 'government', `${t.name} has been censured twice and loses every ministerial post.`);
    }
  }
  if (p.kind === 'referendum') {
    p.clauses.forEach((e: any) => applyClause(w, e, 'referendum'));
    meter(w, 'stability', 2, 'The people decided by referendum');
  }
}
function trackWhip(w: W, p: any) {
  if (p.voters !== 'mps' || !w.pm) return;
  const line = p.votes[w.pm] || (p.kind === 'no_confidence' || p.kind === 'censure' ? 'no' : null);
  if (!line) return;
  const rebels: Id[] = [];
  mps(w).forEach((m) => {
    if (!inGovernment(w, m) || m === w.pm) return;
    const v = p.votes[m];
    const c = w.citizens[m];
    if (!v || v === 'abstain') return;
    if (v === line) c.whip.loyal++;
    else {
      c.whip.rebel++;
      c.whip.last = p.title;
      rebels.push(m);
    }
  });
  if (rebels.length) gazette(w, 'government', `${rebels.map((r) => nm(w, r)).join(' and ')} defied the government whip.`, '#/p/' + p.id);
}
export function assent(w: W, actor: Id, pid: Id, yes: boolean) {
  const p = w.proposals[pid];
  if (!p || p.stage !== 'assent') fail('Nothing is waiting for assent.');
  if (!isHOS(w, actor)) fail(`Only the ${hosTitle(w)} can do this.`);
  if (yes) return enact(w, p, w.config.hos === 'monarchy' ? 'Royal Assent' : 'signed by the President');
  if (w.config.hos === 'monarchy') {
    p.stage = 'withheld';
    meter(w, 'stability', -10, 'The Crown refused assent');
    gazette(w, 'hos', `Constitutional crisis: the ${w.config.hosTitle} refuses assent to ${p.title}.`, '#/p/' + p.id);
  } else {
    p.stage = 'override';
    p.overrideVotes = {};
    p.overrideEndsAt = w.now + DAY;
    gazette(w, 'hos', `The President vetoes ${p.title}. MPs have 24 hours to override with ${superMajority(w)} votes.`, '#/p/' + p.id);
  }
}
export function closeOverride(w: W, p: any) {
  const { ayes } = tally(w, p, p.overrideVotes || {});
  if (ayes >= superMajority(w)) enact(w, p, 'veto overridden');
  else {
    p.stage = 'vetoed';
    gazette(w, 'hos', `The veto stands on ${p.title}.`, '#/p/' + p.id);
  }
}
export function block(w: W, actor: Id, pid: Id) {
  const o = officeWithPower(w, actor, 'block');
  if (!o) fail('You hold no office that can block bills.');
  if (o.blocksUsed >= 1) fail('That power has been used this term.');
  const p = w.proposals[pid];
  if (!p || p.stage !== 'assent') fail('Only a passed bill waiting for assent can be sent back.');
  o.blocksUsed++;
  p.stage = 'debate';
  p.debateEndsAt = w.now + 48 * HOUR;
  p.votes = {};
  gazette(w, 'proposal', `The ${o.name} sends ${p.title} back to the House for 48 hours.`, '#/p/' + p.id);
}
export function enact(w: W, p: any, how: string) {
  const ref = 'L' + String(w.laws.length + 1).padStart(3, '0');
  p.stage = 'enacted';
  p.lawRef = ref;
  const secret = p.clauses.some((e: any) => e.t === 'office' && e.office?.secrecy === 'secret');
  w.laws.push({ ref, title: p.title.replace(/ Bill$/i, ' Act'), summary: p.summary, text: p.clauses.map((e: any) => describe(w, e)), propId: p.id, at: w.now, classified: secret, how, repealed: false, rulings: [] });
  p.clauses.forEach((e: any) => applyClause(w, e, ref));
  const sp = w.citizens[p.by];
  if (sp) {
    sp.stats.passed = (sp.stats.passed || 0) + 1;
    earn(w, p.by, 10, `Your bill became law ${ref}`);
    stamp(w, p.by, `Bill ${p.n}`, `Became ${ref}`, 'ink');
  }
  meter(w, 'stability', p.constitutional ? 2 : 1, 'Parliament passed a law');
  gazette(w, 'law', `${secret ? 'A classified Act' : p.title.replace(/ Bill$/i, ' Act')} becomes law ${ref} (${how}).`, '#/law/' + ref);
}
export function applyClause(w: W, e: any, ref: string) {
  switch (e.t) {
    case 'office':
      createOffice(w, e.template ? { template: e.template } : e.office, ref);
      break;
    case 'abolish':
      if (w.offices[e.office]) {
        gazette(w, 'law', `The ${w.offices[e.office].name} is abolished.`);
        delete w.offices[e.office];
      }
      break;
    case 'budget':
      if (w.offices[e.office]) w.offices[e.office].budget = e.value;
      break;
    case 'set':
      w.config[e.key] = e.value;
      break;
    case 'permit':
      w.permits.banks = true;
      gazette(w, 'money', 'Banks are now allowed. Any citizen can open one.', '#/banks');
      break;
    case 'treaty': {
      const o = w.offers[e.offer];
      if (!o) break;
      const id = newId(w, 't');
      w.treaties[id] = { id, nation: o.nation, title: o.title, effect: o.effect, at: w.now, status: 'active', law: ref };
      delete w.offers[e.offer];
      const n = w.nations[o.nation];
      n.mood = Math.min(4, n.mood + 1);
      n.reasons.unshift({ sign: '+', text: `We ratified the ${o.title}` });
      break;
    }
    case 'breakTreaty': {
      const t = w.treaties[e.treaty];
      if (!t || t.status !== 'active') break;
      t.status = 'broken';
      Object.values(w.nations).forEach((n: any) => {
        n.mood = Math.max(0, n.mood - (n.id === t.nation ? 2 : 1));
        n.reasons.unshift({ sign: '−', text: n.id === t.nation ? `We broke the ${t.title}` : 'We broke a treaty' });
      });
      break;
    }
    case 'repeal': {
      const law = w.laws.find((l: any) => l.ref === e.ref);
      if (!law) break;
      law.repealed = true;
      const src = law.propId && w.proposals[law.propId];
      src?.clauses.forEach((x: any) => {
        if (x.t === 'office') Object.values(w.offices).forEach((o: any) => o.law === e.ref && delete w.offices[o.id]);
        if (x.t === 'permit') w.permits.banks = false;
      });
      break;
    }
    case 'constitution':
      if (e.key === 'seats') {
        w.config.seats = e.value;
        gazette(w, 'law', `From the next general election the House will have ${e.value} seats.`);
      }
      if (e.key === 'termDays') w.config.termDays = e.value;
      if (e.key === 'hos' && e.value !== w.config.hos) {
        w.config.hos = e.value;
        w.config.hosMethod = e.value === 'monarchy' ? 'life' : 'citizens';
        w.hos = { holder: null, since: w.now, until: null };
        startHosSelection(w);
      }
      if (e.key === 'hosMethod') w.config.hosMethod = e.value;
      break;
    case 'removeHos':
      gazette(w, 'hos', `${nm(w, w.hos.holder)} is removed as ${hosTitle(w)}.`);
      w.hos = { holder: null, since: w.now, until: null };
      startHosSelection(w);
      break;
    case 'war':
      w.army.war = e.nation;
      w.nations[e.nation].mood = 0;
      gazette(w, 'army', `The realm is at war with ${w.nations[e.nation].name}. Army upkeep doubles.`, '#/army');
      break;
    case 'peace':
      if (w.army.war === e.nation) w.army.war = null;
      w.nations[e.nation].mood = 1;
      gazette(w, 'army', `Peace with ${w.nations[e.nation].name}.`, '#/army');
      break;
  }
}
export function answerDissolution(w: W, actor: Id, pid: Id, yes: boolean) {
  const p = w.proposals[pid];
  if (!p || p.stage !== 'hos') fail('There is no dissolution request.');
  if (!isHOS(w, actor)) fail(`Only the ${hosTitle(w)} decides.`);
  dissolve(w, p, yes);
}
export function dissolve(w: W, p: any, yes: boolean) {
  p.stage = yes ? 'passed' : 'failed';
  if (yes) {
    Object.values(w.elections).forEach((e: any) => e.kind === 'general' && e.status === 'open' && (e.status = 'cancelled'));
    gazette(w, 'hos', 'Parliament is dissolved. A snap general election closes in 2 days.', '#/elections');
    callGeneralElection(w, w.now + 2 * DAY);
  } else gazette(w, 'hos', `The ${hosTitle(w)} refuses to dissolve Parliament.`);
}
export function forceEnact(w: W, actor: Id, pid: Id, reason: string) {
  if (!w.citizens[actor]?.admin) fail('Only the Returning Officer can do this.');
  const p = w.proposals[pid];
  if (!p || p.stage !== 'assent') fail('Only a passed bill stuck waiting for assent can be force-enacted.');
  if (p.by === actor || p.votes[actor]) fail('You took part in this bill, so you cannot use admin tools on it.');
  if ((reason || '').trim().length < 6) fail('Give a reason. It is shown on the law.');
  enact(w, p, `force-enacted by the Returning Officer: ${reason.trim()}`);
  w.adminLog.unshift({ at: w.now, by: actor, text: `Force-enacted ${p.title}: ${reason.trim()}` });
}
export function lobby(w: W, actor: Id, pid: Id, mp: Id, amount: number) {
  mustBeFree(w, actor);
  const p = w.proposals[pid];
  if (!p || !['debate', 'vote'].includes(p.stage)) fail('You can only lobby on a proposal still in the House.');
  if (!isMP(w, mp)) fail('You can only lobby MPs.');
  transfer(w, ca(actor), ca(mp), amount, `Lobbying on ${p.title}`);
  p.lobby += Math.round(amount);
  w.lobbying.unshift({ at: w.now, from: actor, to: mp, prop: pid, amt: Math.round(amount) });
  gazette(w, 'money', `${nm(w, actor)} paid ${nm(w, mp)} ${Math.round(amount)} crowns to back ${p.title}. Declared publicly.`, '#/p/' + pid);
}

// ================= Questions: PMQs for everyone, formal questions for offices with the power =================
export function ask(w: W, actor: Id, text: string, to?: Id) {
  mustBeFree(w, actor);
  if ((text || '').trim().length < 8) fail('Write your question.');
  if (to && to !== 'pm') {
    const o = officeWithPower(w, actor, 'question');
    if (!o) fail('Only offices with the power to question ministers can do that. Ask the PM at PMQs instead.');
    if (!w.citizens[to]) fail('Pick who to question.');
    w.questions.unshift({ id: newId(w, 'q'), by: actor, to, text: text.trim(), backers: [], answer: null, status: 'open', formal: true, office: o.id, at: w.now, dueAt: w.now + 3 * DAY, week: weekNo(w) });
    gazette(w, 'question', `The ${o.name} formally asks ${nm(w, to)}: "${text.trim()}" An answer is due in 3 days.`, '#/questions');
    return;
  }
  if (!w.pm) fail('There is no Prime Minister to ask.');
  if (w.questions.some((q: any) => q.by === actor && !q.formal && q.week === weekNo(w))) fail('You get one PMQ a week.');
  w.questions.unshift({ id: newId(w, 'q'), by: actor, to: 'pm', text: text.trim(), backers: [], answer: null, status: 'open', formal: false, at: w.now, week: weekNo(w) });
  tick(w, actor, 'asks');
}
export function back(w: W, actor: Id, qid: Id) {
  const q = w.questions.find((x: any) => x.id === qid);
  if (!q || q.status !== 'open' || q.formal) fail('That question is closed.');
  if (q.by === actor) fail('You cannot back your own question.');
  const i = q.backers.indexOf(actor);
  if (i >= 0) q.backers.splice(i, 1);
  else {
    q.backers.push(actor);
    tick(w, actor, 'backs');
  }
}
export function answer(w: W, actor: Id, qid: Id, text: string) {
  const q = w.questions.find((x: any) => x.id === qid);
  if (!q || q.status !== 'open') fail('That question is closed.');
  if (q.to === 'pm' ? !isPM(w, actor) : q.to !== actor) fail('This question is not for you.');
  if ((text || '').trim().length < 3) fail('Write an answer.');
  q.answer = text.trim();
  q.answeredBy = actor;
  q.status = 'answered';
  earn(w, actor, 1, 'Answered a question');
}
export function closePMQs(w: W) {
  const open = w.questions.filter((q: any) => q.status === 'open' && !q.formal).sort((a: any, b: any) => b.backers.length - a.backers.length);
  const top = open.slice(0, 3);
  top.forEach((q: any) => (q.status = 'dodged'));
  open.slice(3).forEach((q: any) => (q.status = 'expired'));
  if (top.length && w.pm) {
    approve(w, w.pm, -3 * top.length);
    meter(w, 'stability', -top.length, 'The PM dodged questions');
    gazette(w, 'question', `The Prime Minister dodged ${top.length} of the week's top questions, including: "${top[0].text}"`, '#/questions');
  }
}
export function missFormal(w: W, q: any) {
  q.status = 'dodged';
  approve(w, q.to, -5);
  stamp(w, q.to, 'Refused to answer', w.offices[q.office]?.name ?? 'A committee', 'bad');
  gazette(w, 'question', `${nm(w, q.to)} failed to answer the ${w.offices[q.office]?.name ?? 'committee'}.`, '#/questions');
}
