// Proposals: one lifecycle for everything Parliament does. Draft, debate, vote, then the result.
// The kind only changes who votes and what happens. Also: laws, PM's Questions, formal questions and lobbying.
import {
  W, Id, DAY, HOUR, fail, newId, cit, nm, allCitizens, exiled, mustBeFree, gazette, earn, spend, stamp, approve, tick, meter,
  isMP, mps, isPM, isHOS, inGovernment, transfer, ca, hosTitle, superMajority, majority, hasPower, officeWithPower, weekNo, adminDid, bump, own, text, int, inForce, inGov } from './core';
import { ACTS, ACT_KEYS, ENTRENCHED, applyAct, repealAct, describeAct, national, expelNational } from './acts';
import { TEMPLATES, POWERS, FILL, createOffice } from './offices';
import { startHosSelection, callGeneralElection, governmentFalls, vacateSeat, HOS_METHODS, countback } from './politics';
import { addJob, addZone } from './streets';
import { openMarket, settleMarket, voidMarket } from './markets';
import { takeDraft } from './drafts';

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
export const CLAUSE_TYPES = ['text', 'office', 'abolish', 'budget', 'set', 'permit', 'treaty', 'breakTreaty', 'repeal', 'constitution', 'removeHos', 'war', 'peace', 'job', 'zone', 'jail', 'decrees', 'continuity', 'unity', 'protection', 'press', 'security', 'crown'];

export function describe(w: W, e: any): string {
  switch (e.t) {
    case 'text':
      return e.text;
    case 'office': {
      if (e.template) {
        const t = own(TEMPLATES, e.template);
        if (!t) return 'Creates an office.';
        return `Creates the ${t.name}, led by a ${t.title.toLowerCase()}. ${t.blurb}`;
      }
      const o = e.office || {};
      return `Creates the office of ${o.name}, ${({ pm: 'appointed by the PM', house: 'elected by MPs', citizens: 'elected by every citizen', lot: 'drawn by lot' } as any)[o.fill]}. Powers: ${(Array.isArray(o?.powers) ? o.powers : []).map((p: string) => POWERS[p]?.label.toLowerCase()).join('; ') || 'none'}.${o.budget ? ` Budget ${o.budget} crowns a week.` : ''} ${o.secrecy === 'secret' ? 'Its work is secret.' : ''}`;
    }
    case 'abolish':
      return `Abolishes the ${w.offices[e.office]?.name ?? 'office'}.`;
    case 'budget':
      return `Sets the ${w.offices[e.office]?.name ?? 'office'} budget to ${e.value} crowns a week.`;
    case 'set':
      return typeof e.from === 'number' && e.from !== e.value
        ? `Changes ${own(SETTABLE, e.key)?.label.toLowerCase() ?? 'a number'} from ${e.from}${own(SETTABLE, e.key)?.unit ?? ''} to ${e.value}${own(SETTABLE, e.key)?.unit ?? ''}.`
        : `Sets ${own(SETTABLE, e.key)?.label.toLowerCase() ?? 'a number'} to ${e.value}${own(SETTABLE, e.key)?.unit ?? ''}.`;
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
    case 'job':
      return `Creates a civic job: ${e.title}. The Treasury pays ${e.pay} crowns each time someone does it, once a week each, signed off by the Chancellor.`;
    case 'zone':
      return `Adds a safe zone to the Streets: ${e.text}.`;
    case 'jail':
    case 'decrees':
    case 'continuity':
    case 'unity':
    case 'protection':
    case 'press':
    case 'security':
    case 'crown':
      return describeAct(e.t);
    case 'war':
      return `Declares war on ${w.nations[e.nation]?.name}.`;
    case 'peace':
      return `Makes peace with ${w.nations[e.nation]?.name}.`;
  }
  return '';
}

// a clause in words keeps its layout: line breaks (at most one blank line in a row), tidy spaces within each line
function clauseText(v: unknown) {
  if (v !== undefined && v !== null && typeof v !== 'string') fail('The clause must be text.');
  const t = String(v ?? '').replace(/\r/g, '').split('\n').map((l) => l.replace(/[ \t]+/g, ' ').trim()).join('\n').replace(/\n{3,}/g, '\n\n').trim();
  if (t.length < 6) fail('Write the clause (at least 6 characters).');
  if (t.length > 3000) fail('Keep the clause under 3000 characters.');
  return t;
}
// every clause is checked in full when tabled, so enacting it later (often by the clock) can never fail
function checkClause(w: W, e: any, byDecree = false) {
  const choose = (v: unknown, list: unknown[], msg: string) => (list.includes(v) ? v : fail(msg));
  switch (e.t) {
    case 'text':
      e.text = clauseText(e.text);
      break;
    case 'set':
      if (!own(SETTABLE, e.key)) fail('Pick a number to change.');
      e.value = int(e.value, SETTABLE[e.key].min, SETTABLE[e.key].max, SETTABLE[e.key].label.toLowerCase());
      e.from = w.config[e.key]; // what it was when tabled, so the bill and the law can say "from … to …"
      break;
    case 'budget':
      if (!own(w.offices, e.office)) fail('Pick an office.');
      e.value = int(e.value, 0, 200, 'weekly budget');
      break;
    case 'abolish':
      if (!own(w.offices, e.office)) fail('Pick an office.');
      break;
    case 'office':
      if (e.template) {
        if (!own(TEMPLATES, e.template)) fail('Unknown office.');
        if (w.offices[e.template]) fail(`The ${TEMPLATES[e.template].name} already exists.`);
        break;
      }
      if (!e.office || typeof e.office !== 'object') fail('Describe the new office.');
      e.office = {
        name: text(e.office.name, 3, 40, 'office name'),
        // (detaining and releasing come only with the Public Order and Detention Act's own Ministry)
        powers: Array.isArray(e.office.powers) ? [...new Set(e.office.powers.filter((p: unknown) => own(POWERS, p) && p !== 'detain' && p !== 'release'))] : fail('Pick the office’s powers.'),
        fill: choose(e.office.fill ?? 'pm', Object.keys(FILL), 'Pick how the office is filled.'),
        secrecy: choose(e.office.secrecy ?? 'public', ['public', 'restricted', 'secret'], 'Pick public, restricted or secret.'),
        budget: int(e.office.budget ?? 0, 0, 200, 'weekly budget')
      };
      break;
    case 'job':
      e.title = text(e.title, 6, 120, 'civic job');
      e.pay = int(e.pay, 1, 30, 'wage');
      break;
    case 'zone':
      e.text = text(e.text, 4, 120, 'safe zone');
      break;
    case 'treaty':
      if (typeof e.offer !== 'string') fail('Pick a treaty offer.');
      break;
    case 'breakTreaty':
      if (own(w.treaties, e.treaty)?.status !== 'active') fail('Pick a treaty in force.');
      break;
    case 'repeal':
      if (typeof e.ref !== 'string' || e.ref.length > 10 || !w.laws.some((l: any) => l.ref === e.ref)) fail('Pick a law to repeal.');
      // decrees outrank bills: only a later decree can repeal one
      if (!byDecree && w.laws.find((l: any) => l.ref === e.ref)?.decree) fail('That law was made by decree. Only a later decree can repeal it.');
      // the Protection of the State Act entrenches itself and the other Acts: only a decree can repeal them
      if (!byDecree && inForce(w, 'protection') && ENTRENCHED.some((k) => w.acts?.[k] === e.ref)) fail('That Act is entrenched. Only a decree of the Prime Minister can repeal it.');
      break;
    case 'removeHos':
      if (!byDecree && inForce(w, 'protection')) fail('Only a decree of the Prime Minister can remove the head of state.');
      break;
    case 'jail':
    case 'decrees':
    case 'continuity':
    case 'unity':
    case 'protection':
    case 'press':
    case 'security':
    case 'crown':
      if (inForce(w, e.t)) fail(`The ${ACTS[e.t as 'jail'].name} Act is already law.`);
      break;
    case 'war':
    case 'peace':
      if (!own(w.nations, e.nation)) fail('Pick a nation.');
      break;
    case 'constitution': {
      const ok: Record<string, unknown[]> = { seats: [3, 5, 7, 9], termDays: [14, 21, 28], hos: ['monarchy', 'republic'] };
      if (e.key === 'hosMethod') ok.hosMethod = (HOS_METHODS[w.config.hos] || []).map((m: any) => m.id);
      if (!own(ok, e.key)) fail('Pick what to change in the constitution.');
      if ((e.key === 'hos' || e.key === 'hosMethod') && !byDecree && inForce(w, 'protection')) fail('Only a decree of the Prime Minister can change the head of state.');
      choose(e.value, ok[e.key], 'That value isn’t allowed.');
      if (e.label !== undefined) e.label = text(e.label, 0, 40, 'label');
      break;
    }
  }
}
// every clause checked in full: the same rules for a new proposal and an edited one
export function checkClauses(w: W, kind: string, clauses: any, byDecree = false) {
  if (!Array.isArray(clauses)) fail('Clauses must be a list.');
  if (kind === 'bill' && !clauses.length) fail('Add at least one clause.');
  if (clauses.length > 20) fail('A bill can have 20 clauses at most.');
  for (const e of clauses) {
    if (!CLAUSE_TYPES.includes(e?.t)) fail('Unknown kind of clause.');
    checkClause(w, e, byDecree);
    if (e.t === 'treaty' && !own(w.offers, e.offer)) fail('That treaty offer has expired.');
    if ((e.t === 'war' || e.t === 'peace') && !w.offices.army) fail('War and peace need an Army: pass the Defence Act first.');
    if (e.t === 'permit' && w.permits.banks) fail('Banks are already allowed.');
  }
}
export function propose(w: W, actor: Id, a: any) {
  mustBeFree(w, actor);
  if (w.phase !== 'running') fail('Proposals start once the constitution is adopted.');
  if (w.martial) fail('Parliament is suspended under martial law.');
  const kind = a.kind || 'bill';
  if (!own(KINDS, kind)) fail('Unknown kind of proposal.');
  if (kind === 'dissolution' && inForce(w, 'continuity')) fail('Parliament cannot be dissolved under the Continuity of Parliament Act.');
  const guarded = inForce(w, 'protection');
  if (guarded && kind === 'no_confidence') fail('Motions of no confidence can no longer be tabled.');
  if (kind === 'no_confidence' && inForce(w, 'crown') && w.pm && w.pm === w.hos.holder) fail('Under the Crown Act the head of state is Prime Minister, and cannot lose the confidence of the House.');
  if (guarded && kind === 'referendum' && !isPM(w, actor)) fail('Only the Prime Minister can call a referendum.');
  if (guarded && kind === 'censure' && (inGov(w, a.target) || isHOS(w, a.target))) fail('The Prime Minister, ministers and the head of state cannot be censured.');
  // a copy: checking a clause tidies it in place, and the caller's object must not change
  const clauses = kind === 'bill' || kind === 'referendum' ? structuredClone(a.clauses || []) : [];
  let title = kind === 'bill' || kind === 'referendum' ? text(a.title, kind === 'referendum' ? 8 : 4, 120, kind === 'referendum' ? 'question' : 'title') : '';
  const summary = text(a.summary, 0, 500, 'summary');
  if (kind === 'confidence' || kind === 'dissolution') {
    if (!isPM(w, actor)) fail(`Only the Prime Minister can ask for ${kind === 'confidence' ? 'a confidence vote' : 'a dissolution'}.`);
  } else if (!isMP(w, actor) && !hasPower(w, actor, 'propose')) fail('Only MPs put proposals to the House.');
  if ((kind === 'no_confidence' || kind === 'confidence') && !w.pm) fail('There is no government.');
  if (kind === 'censure' && !own(w.citizens, a.target)?.active) fail('Pick who to censure.');
  checkClauses(w, kind, clauses);
  if (Object.values(w.proposals).some((p: any) => p.kind === kind && ['no_confidence', 'confidence', 'dissolution'].includes(kind) && ['debate', 'vote', 'hos'].includes(p.stage))) fail('One of those is already open.');
  if (kind === 'referendum') spend(w, actor, 20, 'Called a referendum');
  const open = Object.values(w.proposals).filter((p: any) => p.by === actor && ['debate', 'vote'].includes(p.stage)).length;
  if (open >= 2) spend(w, actor, 10, 'A third proposal at once');
  if (a.fast) spend(w, actor, 15, 'Fast-tracked a debate');
  const constitutional = clauses.some((e: any) => CONSTITUTIONAL.includes(e.t) || (e.t === 'office' && own(TEMPLATES, e.template)?.constitutional));
  w.propCount += 1;
  const id = newId(w, 'p');
  const titles: any = {
    no_confidence: 'That this House has no confidence in the government',
    confidence: 'That this House has confidence in the government',
    censure: `That this House censures ${nm(w, a.target)}`,
    dissolution: 'That Parliament be dissolved and a general election held'
  };
  // tabled from a saved draft: it's used up, and the MPs who signed this exact wording become co-sponsors
  const fromDraft = own(w.drafts, a.draft)?.by === actor ? (a.draft as string) : null;
  const sponsors = fromDraft ? takeDraft(w, actor, a.draft, { kind, title, summary, clauses: a.clauses ?? [], target: a.target || '' }) : [];
  const debateH = a.fast ? 12 : kind === 'no_confidence' || kind === 'confidence' || kind === 'censure' ? 12 : w.config.debateHours;
  w.proposals[id] = {
    id, n: w.propCount, kind, title: own(titles, kind) || title, summary, by: actor, clauses, target: a.target || null,
    constitutional, voters: kind === 'referendum' || (kind === 'bill' && w.config.billVoters === 'all') ? 'all' : 'mps', rule: w.config.passRule || 'cast',
    // under the Protection of the State Act, anyone but the Prime Minister waits for their consent first
    stage: kind === 'dissolution' ? 'hos' : guarded && !isPM(w, actor) ? 'consent' : 'debate', consentH: debateH, at: w.now,
    debateEndsAt: w.now + debateH * HOUR, voteEndsAt: null, assentDueAt: null, hosDueAt: kind === 'dissolution' ? w.now + DAY : null,
    speeches: [], votes: {}, casting: null, lobby: 0, result: null, lawRef: null, fast: !!a.fast,
    sponsors, amendments: [], draft: fromDraft
  };
  tick(w, actor, 'proposals');
  if (kind === 'bill' || kind === 'referendum') history(w, w.proposals[id], actor, 'Tabled');
  // co-sponsors from another party (or none) than the author's: a cross-party bill, and the public likes it
  const party = (x: Id) => w.citizens[x]?.party || null;
  const across = sponsors.filter((s) => party(s) !== party(actor));
  if (across.length) {
    w.proposals[id].crossParty = true;
    approve(w, actor, 2);
    across.forEach((s) => approve(w, s, 1));
  }
  if (w.proposals[id].stage === 'consent') return (gazette(w, 'proposal', `${nm(w, actor)} asks the Prime Minister’s consent to table: ${w.proposals[id].title}.`, '#/p/' + id), id);
  gazette(w, 'proposal', `${nm(w, actor)} puts a ${across.length ? 'cross-party ' : ''}${KINDS[kind].name.toLowerCase()} to the House${sponsors.length ? `, co-sponsored by ${sponsors.map((s) => nm(w, s)).join(', ')}` : ''}: ${w.proposals[id].title}${constitutional ? ' (constitutional: needs ' + superMajority(w) + ' of ' + w.config.seats + ')' : ''}.`, '#/p/' + id);
  return id;
}

// the author can reword a bill while it's still being debated (speeches made so far are marked as on the earlier draft),
// or withdraw it any time before the vote closes. Bets on it are refunded.
export function editProposal(w: W, actor: Id, pid: unknown, a: any) {
  const p = own(w.proposals, pid);
  if (!p || p.by !== actor) fail('Only the author can edit a proposal.');
  if (p.stage !== 'debate') fail('You can only edit it while it’s being debated, before the vote opens.');
  if (p.kind !== 'bill' && p.kind !== 'referendum') fail('Only bills and referendums have wording to edit.');
  const clauses = structuredClone(a?.clauses ?? p.clauses);
  const title = a?.title === undefined ? p.title : text(a.title, p.kind === 'referendum' ? 8 : 4, 120, p.kind === 'referendum' ? 'question' : 'title');
  const summary = a?.summary === undefined ? p.summary : text(a.summary, 0, 500, 'summary');
  checkClauses(w, p.kind, clauses);
  if (p.kind === 'bill' && !clauses.length) fail('Add at least one clause.');
  p.title = title;
  p.summary = summary;
  p.clauses = clauses;
  p.constitutional = clauses.some((e: any) => CONSTITUTIONAL.includes(e.t) || (e.t === 'office' && own(TEMPLATES, e.template)?.constitutional));
  p.editedAt = w.now;
  p.edits = (p.edits || 0) + 1;
  history(w, p, actor, 'Reworded by its author');
  gazette(w, 'proposal', `${nm(w, actor)} amends their ${KINDS[p.kind].name.toLowerCase()}: ${p.title}.`, '#/p/' + p.id);
}
// Amendments: during the debate any MP but the author can propose changing, adding or removing one clause. Public.
// The author takes it or leaves it; whatever is still waiting when the vote opens lapses.
const AMEND_OPS = ['change', 'add', 'remove'];
export function lapseAmendments(p: any) {
  const open = (p.amendments || []).filter((m: any) => m.status === 'pending' || m.status === 'division' || m.status === 'consent');
  open.forEach((m: any) => (m.status = 'lapsed'));
  return open.length;
}
export function proposeAmendment(w: W, actor: Id, pid: unknown, a: any) {
  mustBeFree(w, actor);
  const p = own(w.proposals, pid);
  if (!p) fail('No such proposal.');
  if (p.kind !== 'bill' && p.kind !== 'referendum') fail('Only bills and referendums can be amended.');
  if (p.stage !== 'debate') fail('Amendments can only be put while it’s being debated.');
  if (p.by === actor) fail('It’s yours: edit it instead.');
  if (!isMP(w, actor)) fail('Only MPs can propose amendments.');
  const op = a?.op;
  if (!AMEND_OPS.includes(op)) fail('Change, add or remove a clause.');
  p.amendments ??= [];
  if (p.amendments.filter((m: any) => m.by === actor && (m.status === 'pending' || m.status === 'consent')).length >= 3) fail('You have 3 amendments waiting on this already.');
  const why = text(a.why, 0, 300, 'reason');
  const index = op === 'add' ? p.clauses.length : int(a.index, 0, p.clauses.length - 1, 'clause number');
  let clause = null;
  if (op !== 'remove') {
    clause = structuredClone(a.clause);
    checkClauses(w, p.kind, [clause]);
  } else if (p.kind === 'bill' && p.clauses.length < 2) fail('A bill needs at least one clause.');
  if (op === 'add' && p.clauses.length >= 20) fail('A bill can have 20 clauses at most.');
  // to a government proposal, under the Protection of the State Act: only with the Prime Minister's consent
  const needsConsent = inForce(w, 'protection') && inGov(w, p.by) && !isPM(w, actor);
  const m = { id: newId(w, 'am'), by: actor, op, index, clause, was: op === 'add' ? null : JSON.stringify(p.clauses[index]), why, status: needsConsent ? 'consent' : 'pending', at: w.now, backers: [], whips: {} };
  p.amendments.push(m);
  const what = op === 'remove' ? `removing clause ${index + 1}` : op === 'add' ? `a new clause: ${describe(w, clause)}` : `clause ${index + 1} to read: ${describe(w, clause)}`;
  gazette(w, 'proposal', `${nm(w, actor)} proposes an amendment to ${p.title}, ${what}.`, '#/p/' + p.id);
  return m.id;
}
export function answerAmendment(w: W, actor: Id, pid: unknown, mid: unknown, accept: unknown) {
  const p = own(w.proposals, pid);
  if (!p || p.by !== actor) fail('Only the author can take or leave an amendment.');
  const m = (p.amendments || []).find((x: any) => x.id === mid);
  if (!m || m.status !== 'pending') fail('That amendment isn’t waiting.');
  if (p.stage !== 'debate') fail('The debate is over.');
  if (!accept) {
    m.answeredAt = w.now;
    // turned down, but enough MPs back it: the House decides instead
    if (backing(w, m).length >= HOSTILE_BACKERS) return openDivision(w, p, m);
    m.status = 'rejected';
    gazette(w, 'proposal', `${nm(w, actor)} turns down ${nm(w, m.by)}’s amendment to ${p.title}.`, '#/p/' + p.id);
    return judgePledges(w);
  }
  if (!fits(p, m)) fail('That clause has changed since. Ask for the amendment to be put again.');
  applyAmendment(w, p, m);
  m.status = 'accepted';
  m.answeredAt = w.now;
  earn(w, m.by, 3, 'Your amendment was accepted');
  gazette(w, 'proposal', `${nm(w, actor)} accepts ${nm(w, m.by)}’s amendment to ${p.title}.`, '#/p/' + p.id);
  judgePledges(w);
}
// Hostile amendments: MPs back one (the proposer counts). If the author turns it down with HOSTILE_BACKERS behind it,
// MPs vote on it before the main vote opens (the debate runs at least DIVISION_HOURS more so there's time).
// More ayes than noes and it goes in anyway. Party leaders and the Chief Whip can whip amendments like bills.
export const HOSTILE_BACKERS = 3;
const DIVISION_HOURS = 6;
const backing = (w: W, m: any) => [m.by, ...(m.backers || [])].filter((id: Id, i: number, a: Id[]) => a.indexOf(id) === i && isMP(w, id));
const fits = (p: any, m: any) => m.op === 'add' || JSON.stringify(p.clauses[m.index]) === m.was;
function applyAmendment(w: W, p: any, m: any) {
  const clauses = structuredClone(p.clauses);
  if (m.op === 'add') clauses.push(structuredClone(m.clause));
  else if (m.op === 'change') clauses[m.index] = structuredClone(m.clause);
  else clauses.splice(m.index, 1);
  checkClauses(w, p.kind, clauses);
  // clause numbers after a removal move up one, so amendments aimed at them no longer fit
  if (m.op === 'remove') p.amendments.forEach((x: any) => ['pending', 'division'].includes(x.status) && x !== m && x.op !== 'add' && x.index > m.index && (x.status = 'lapsed'));
  p.clauses = clauses;
  p.constitutional = clauses.some((e: any) => CONSTITUTIONAL.includes(e.t) || (e.t === 'office' && own(TEMPLATES, e.template)?.constitutional));
  p.editedAt = w.now;
  p.edits = (p.edits || 0) + 1;
  history(w, p, m.by, `${nm(w, m.by)}’s amendment`);
}
function openDivision(w: W, p: any, m: any) {
  m.status = 'division';
  m.votes = {};
  p.debateEndsAt = Math.max(p.debateEndsAt, w.now + DIVISION_HOURS * HOUR);
  gazette(w, 'proposal', `${nm(w, p.by)} turns down ${nm(w, m.by)}’s amendment to ${p.title}, but ${backing(w, m).length} MPs back it. The House divides on it before the vote.`, '#/p/' + p.id);
}
function own_amendment(w: W, pid: unknown, mid: unknown) {
  const p = own(w.proposals, pid);
  if (!p) fail('No such proposal.');
  const m = (p.amendments || []).find((x: any) => x.id === mid);
  if (!m) fail('No such amendment.');
  return { p, m };
}
export function backAmendment(w: W, actor: Id, pid: unknown, mid: unknown) {
  const { p, m } = own_amendment(w, pid, mid);
  if (!isMP(w, actor)) fail('Only MPs can back amendments.');
  if (p.stage !== 'debate' || m.status !== 'pending') fail('It’s no longer waiting.');
  if (actor === p.by) fail('It’s your bill: take it or leave it.');
  if (actor === m.by) fail('It’s your amendment.');
  m.backers ??= [];
  m.backers = m.backers.includes(actor) ? m.backers.filter((x: Id) => x !== actor) : [...m.backers, actor];
}
export function voteAmendment(w: W, actor: Id, pid: unknown, mid: unknown, v: unknown) {
  const { p, m } = own_amendment(w, pid, mid);
  if (m.status !== 'division' || p.stage !== 'debate') fail('There’s no vote on that amendment.');
  if (!isMP(w, actor)) fail('Only MPs vote on amendments.');
  if (v !== 'aye' && v !== 'no' && v !== 'abstain') fail('Vote aye, no or abstain.');
  m.votes[actor] = v;
}
export function whipAmendment(w: W, actor: Id, pid: unknown, mid: unknown, line: unknown) {
  const { p, m } = own_amendment(w, pid, mid);
  if (!['pending', 'division'].includes(m.status) || p.stage !== 'debate') fail('It’s no longer open.');
  if (line !== 'aye' && line !== 'no' && line !== 'free') fail('Pick aye, no or a free vote.');
  if (!canWhip(w, actor)) fail('Only your party leader or the Chief Whip sets the line.');
  const party = w.citizens[actor].party;
  m.whips ??= {};
  if (m.whips[party]?.line === line) return;
  m.whips[party] = { line, by: actor, at: w.now };
  const pt = w.parties[party];
  gazette(w, 'government', line === 'free' ? `${pt.name}: a free vote on ${nm(w, m.by)}’s amendment to ${p.title}.` : `${pt.name} ${line === 'aye' ? 'backs' : 'opposes'} ${nm(w, m.by)}’s amendment to ${p.title}.`, '#/p/' + p.id);
}
export function amendmentLine(w: W, m: any, mp: Id): 'aye' | 'no' | null {
  const party = w.citizens[mp]?.party;
  const line = party && m.whips?.[party]?.line;
  return line === 'aye' || line === 'no' ? line : null;
}
// when the debate ends: settle every division, then whatever's still waiting lapses
function settleDivisions(w: W, p: any) {
  (p.amendments || []).filter((m: any) => m.status === 'division').forEach((m: any) => {
    const ayes = Object.entries(m.votes).filter(([k, v]) => v === 'aye' && isMP(w, k)).length;
    const noes = Object.entries(m.votes).filter(([k, v]) => v === 'no' && isMP(w, k)).length;
    m.result = { ayes, noes };
    trackAmendmentWhip(w, p, m);
    if (ayes <= noes) {
      m.status = 'defeated';
      gazette(w, 'proposal', `The House rejects ${nm(w, m.by)}’s amendment to ${p.title}, ${ayes} to ${noes}.`, '#/p/' + p.id);
      return;
    }
    if (!fits(p, m)) return void (m.status = 'lapsed');
    try {
      applyAmendment(w, p, m);
    } catch {
      return void (m.status = 'lapsed');
    }
    m.status = 'carried';
    earn(w, m.by, 3, 'The House carried your amendment');
    approve(w, p.by, -1);
    gazette(w, 'proposal', `The House carries ${nm(w, m.by)}’s amendment to ${p.title} against its author, ${ayes} to ${noes}.`, '#/p/' + p.id);
  });
}
// whipped amendment votes count towards each MP's record, like bills
function trackAmendmentWhip(w: W, p: any, m: any) {
  const rebels: Id[] = [];
  mps(w).forEach((id) => {
    const line = amendmentLine(w, m, id);
    const v = m.votes[id];
    if (!line || !v || v === 'abstain') return;
    const c = w.citizens[id];
    c.whip ??= { loyal: 0, rebel: 0 };
    if (v === line) c.whip.loyal++;
    else {
      c.whip.rebel++;
      c.whip.last = `an amendment to ${p.title}`;
      rebels.push(id);
    }
  });
  m.rebels = rebels;
  if (rebels.length) gazette(w, 'government', `${rebels.map((r) => nm(w, r)).join(' and ')} defied the whip on ${nm(w, m.by)}’s amendment to ${p.title}.`, '#/p/' + p.id);
}

// Pledges: two MPs agree to back each other's amendments. On offer it's private; agreed, it's public. Each side is
// judged when the amendment they promised to back is settled: kept if it went in, or they backed it (and voted Aye if
// the House divided). Lapsed for other reasons (the bill withdrawn, the vote opening first) is nobody's fault.
const findAmendment = (w: W, mid: unknown) => {
  for (const p of Object.values(w.proposals) as any[]) {
    const m = (p.amendments || []).find((x: any) => x.id === mid);
    if (m) return { p, m };
  }
  return null;
};
export function offerPledge(w: W, actor: Id, mine: unknown, theirs: unknown) {
  mustBeFree(w, actor);
  const a = findAmendment(w, mine);
  const b = findAmendment(w, theirs);
  if (!a || a.m.by !== actor) fail('Pick one of your own amendments.');
  if (!b || b.m.by === actor) fail('Pick someone else’s amendment.');
  for (const x of [a, b]) if (x.p.stage !== 'debate' || !['pending', 'division'].includes(x.m.status)) fail('Both amendments must still be open.');
  if (!isMP(w, actor) || !isMP(w, b.m.by)) fail('Only MPs make pledges.');
  if (Object.values(w.pledges || {}).some((pl: any) => ['offered', 'agreed'].includes(pl.status) && ((pl.a === actor && pl.aBacks === b.m.id) || (pl.b === actor && pl.bBacks === b.m.id)))) fail('You’ve already pledged on that one.');
  const id = newId(w, 'pl');
  (w.pledges ??= {})[id] = { id, a: actor, b: b.m.by, aBacks: b.m.id, bBacks: a.m.id, aProp: b.p.id, bProp: a.p.id, status: 'offered', kept: {}, at: w.now };
  return id;
}
export function answerPledge(w: W, actor: Id, pid: unknown, yes: unknown) {
  const pl = own(w.pledges, pid);
  if (!pl || pl.b !== actor || pl.status !== 'offered') fail('There’s no pledge waiting for you.');
  const x = findAmendment(w, pl.aBacks);
  const y = findAmendment(w, pl.bBacks);
  if (!yes) return void (pl.status = 'declined');
  if (!x || !y || [x, y].some((v) => v.p.stage !== 'debate' || !['pending', 'division'].includes(v.m.status))) {
    pl.status = 'void';
    fail('One of the amendments has been settled already.');
  }
  pl.status = 'agreed';
  pl.agreedAt = w.now;
  gazette(w, 'proposal', `${nm(w, pl.a)} and ${nm(w, pl.b)} pledge to back each other’s amendments, to ${x!.p.title}${x!.p.id === y!.p.id ? '' : ` and ${y!.p.title}`}.`, '#/p/' + x!.p.id);
}
export function judgePledges(w: W) {
  Object.values(w.pledges || {}).forEach((pl: any) => {
    if (pl.status === 'offered') {
      const ms = [pl.aBacks, pl.bBacks].map((id) => findAmendment(w, id)?.m);
      if (ms.some((m) => !m || !['pending', 'division'].includes(m.status))) pl.status = 'void';
      return;
    }
    if (pl.status !== 'agreed') return;
    for (const [who, mid] of [[pl.a, pl.aBacks], [pl.b, pl.bBacks]] as [Id, Id][]) {
      if (pl.kept[who] !== undefined) continue;
      const f = findAmendment(w, mid);
      if (!f || ['pending', 'division'].includes(f.m.status)) continue;
      const m = f.m;
      const backed = m.votes ? m.votes[who] === 'aye' : (m.backers || []).includes(who);
      const kept = ['accepted', 'carried'].includes(m.status) || backed;
      pl.kept[who] = kept ? true : m.status === 'lapsed' ? null : false;
      if (pl.kept[who] === false) {
        const other = who === pl.a ? pl.b : pl.a;
        pl.status = 'broken';
        pl.brokenBy = who;
        bump(w, who, 'pledgesBroken');
        approve(w, who, -2);
        gazette(w, 'proposal', `${nm(w, who)} broke their pledge to back ${nm(w, other)}’s amendment to ${f.p.title}.`, '#/p/' + f.p.id);
        return;
      }
    }
    if (pl.kept[pl.a] !== undefined && pl.kept[pl.b] !== undefined) {
      pl.status = 'kept';
      [pl.a, pl.b].forEach((x: Id) => pl.kept[x] && bump(w, x, 'pledgesKept'));
    }
  });
}

// the bill's history: every wording it has had, and why it changed. Capped so a much-edited bill stays small.
const HISTORY_MAX = 25;
export function history(w: W, p: any, by: Id, why: string) {
  p.history ??= [];
  p.history.push({ at: w.now, by, why, title: p.title, summary: p.summary, clauses: structuredClone(p.clauses) });
  if (p.history.length > HISTORY_MAX) p.history.splice(1, p.history.length - HISTORY_MAX);
}
export function withdrawProposal(w: W, actor: Id, pid: unknown) {
  const p = own(w.proposals, pid);
  if (!p || p.by !== actor) fail('Only the author can withdraw a proposal.');
  if (!['debate', 'vote'].includes(p.stage)) fail('It’s too late to withdraw it.');
  if (['no_confidence', 'confidence'].includes(p.kind) && p.stage === 'vote') fail('A confidence vote can’t be withdrawn once voting has started.');
  p.stage = 'withdrawn';
  lapseAmendments(p);
  judgePledges(w);
  p.result = { withdrawn: true, at: w.now };
  Object.values(w.markets || {}).forEach((m: any) => m.kind === 'prop' && m.ref === p.id && m.status === 'open' && voidMarket(w, m, 'The proposal was withdrawn.'));
  gazette(w, 'proposal', `${nm(w, actor)} withdraws ${p.title}.`, '#/p/' + p.id);
}

export function speak(w: W, actor: Id, pid: Id, side: string, speech: string) {
  mustBeFree(w, actor);
  const p = own(w.proposals, pid);
  if (!p || !['debate', 'vote', 'override'].includes(p.stage)) fail('This is not being debated.');
  const said = text(speech, 3, 1000, 'speech');
  if (!['for', 'against', 'undecided', 'order'].includes(side)) fail('Speak for, against or undecided.');
  if (p.speeches.filter((s: any) => s.by === actor).length >= 5) fail('You have made 5 speeches on this already.');
  if (side === 'order' && w.speaker !== actor) fail('Only the Speaker can call order.');
  p.speeches.push({ id: newId(w, 's'), by: actor, side, text: said, at: w.now });
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
  const p = own(w.proposals, pid);
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
  const p = own(w.proposals, pid);
  if (!p || p.stage !== 'vote') fail('There is no open vote.');
  if (v !== 'aye' && v !== 'no') fail('Cast aye or no.');
  p.casting = v;
}

export function openVote(w: W, p: any) {
  settleDivisions(w, p);
  p.stage = 'vote';
  if (lapseAmendments(p)) gazette(w, 'proposal', `Amendments not taken up on ${p.title} lapse as voting opens.`, '#/p/' + p.id);
  judgePledges(w);
  p.voteEndsAt = w.now + (p.fast || ['no_confidence', 'confidence', 'censure'].includes(p.kind) ? 12 : w.config.voteHours) * HOUR;
  gazette(w, 'proposal', `Voting opens: ${p.title}. ${p.voters === 'all' ? 'Every citizen votes.' : 'MPs vote.'}`, '#/p/' + p.id);
  openMarket(w, 'prop', p.id, `Will “${p.title}” pass the vote?`, [{ key: 'yes', label: 'Passes' }, { key: 'no', label: 'Fails' }], p.voteEndsAt);
}
function tally(w: W, p: any, book: any) {
  const valid = Object.entries(book).filter(([id]) => (p.voters === 'all' ? !!w.citizens[id] : isMP(w, id)));
  return { ayes: valid.filter(([, v]) => v === 'aye').length, noes: valid.filter(([, v]) => v === 'no').length };
}
// what it takes to pass, chosen at the Convention (config.passRule, fixed on each proposal when tabled):
// 'cast' more ayes than noes; 'seats' a majority of everyone entitled to vote; 'twothirds' two-thirds of votes cast.
// Constitutional changes always need a supermajority.
export const PASS_RULES: Record<string, string> = { cast: 'More ayes than noes', seats: 'A majority of everyone entitled to vote', twothirds: 'Two-thirds of the votes cast' };
const electorate = (w: W, p: any) => (p.voters === 'all' ? allCitizens(w).length : w.config.seats);
export function passCheck(w: W, p: any, ayes: number, noes: number): { passed: boolean; tie: boolean; need: string } {
  const n = electorate(w, p);
  if (p.constitutional) {
    if (p.voters === 'all') return { passed: ayes > 0 && ayes * 5 >= (ayes + noes) * 4, tie: false, need: 'four in five of the votes cast' };
    return { passed: ayes >= superMajority(w), tie: false, need: `${superMajority(w)} of ${n} ayes` };
  }
  const rule = p.rule || 'cast';
  if (rule === 'seats') return { passed: ayes >= Math.floor(n / 2) + 1, tie: false, need: `${Math.floor(n / 2) + 1} of ${n} ayes` };
  if (rule === 'twothirds') return { passed: ayes > 0 && ayes * 3 >= (ayes + noes) * 2, tie: false, need: 'two-thirds of the votes cast' };
  return { passed: ayes > noes, tie: ayes === noes, need: 'more ayes than noes' };
}
export function closeVote(w: W, p: any) {
  const { ayes, noes } = tally(w, p, p.votes);
  const chk = passCheck(w, p, ayes, noes);
  let passed = chk.passed;
  let note = p.constitutional ? ` (needed ${chk.need})` : '';
  if (!p.constitutional && chk.tie && p.voters === 'mps' && (ayes || noes)) {
    passed = (p.casting || 'no') === 'aye';
    note = `, the Speaker's casting vote ${passed ? 'for' : 'against'}`;
  }
  p.result = { ayes, noes, passed, note };
  trackWhip(w, p);
  settleMarket(w, 'prop', p.id, passed ? 'yes' : 'no', Object.keys(p.votes).filter((k) => p.votes[k] === (passed ? 'aye' : 'no')).map((id) => ({ id, did: `voted ${passed ? 'for' : 'against'} it` })));
  if (passed && ayes - noes === 1) bump(w, p.by, 'squeakers');
  if (!passed && p.kind === 'no_confidence' && w.pm) bump(w, w.pm, 'survived');
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
    // under the Government Powers Act, assent follows within the hour whatever the head of state does
    p.assentDueAt = w.now + (inForce(w, 'decrees') ? 1 : 48) * HOUR;
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
// ================= Whips =================
// A party's line on a House vote: set by its leader, or for a governing party by the Chief Whip. Public, like real
// whipping. 'free' means a free vote. Without a line, government MPs are measured against the PM's own vote.
export function whipLine(w: W, p: any, mp: Id): 'aye' | 'no' | null {
  const party = w.citizens[mp]?.party;
  // the National Party's line is always the Prime Minister's own vote
  if (party && party === national(w)) {
    if (!w.pm || mp === w.pm) return null;
    const v = p.votes?.[w.pm];
    return v === 'aye' || v === 'no' ? v : null;
  }
  const set = party && p.whips?.[party]?.line;
  if (set === 'free') return null;
  if (set) return set;
  if (!w.pm || mp === w.pm || !inGovernment(w, mp)) return null;
  return p.votes?.[w.pm] || (p.kind === 'no_confidence' || p.kind === 'censure' ? 'no' : null);
}
export function canWhip(w: W, actor: Id) {
  const party = w.citizens[actor]?.party;
  const pt = party && w.parties[party];
  if (!pt || pt.status !== 'active') return false;
  return pt.leader === actor || (w.offices.whip?.holder === actor && inGovernment(w, actor));
}
export function setWhip(w: W, actor: Id, pid: unknown, line: unknown) {
  const p = own(w.proposals, pid);
  if (!p) fail('No such proposal.');
  if (p.voters !== 'mps') fail('Only votes in the House are whipped.');
  if (!['debate', 'vote'].includes(p.stage)) fail('The vote is over.');
  if (line !== 'aye' && line !== 'no' && line !== 'free') fail('Pick aye, no or a free vote.');
  if (!canWhip(w, actor)) fail('Only your party leader or the Chief Whip sets the line.');
  const party = w.citizens[actor].party;
  p.whips ??= {};
  if (p.whips[party]?.line === line) return;
  p.whips[party] = { line, by: actor, at: w.now };
  const pt = w.parties[party];
  gazette(w, 'government', line === 'free' ? `${pt.name}: a free vote on ${p.title}.` : `${pt.name}: MPs whipped to vote ${line === 'aye' ? 'Aye' : 'No'} on ${p.title}.`, '#/p/' + p.id);
}
// MPs voting against their line right now, for the whip's alert and the seat map
export function rebelsOn(w: W, p: any): Id[] {
  return mps(w).filter((m) => { const l = whipLine(w, p, m); const v = p.votes?.[m]; return l && v && v !== 'abstain' && v !== l; });
}
function trackWhip(w: W, p: any) {
  if (p.voters !== 'mps') return;
  const rebels: Id[] = [];
  mps(w).forEach((m) => {
    const line = whipLine(w, p, m);
    if (!line) return;
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
  p.rebels = rebels;
  if (rebels.length) gazette(w, 'government', `${rebels.map((r) => nm(w, r)).join(' and ')} defied the whip.`, '#/p/' + p.id);
  // under the National Unity Act, voting against the Prime Minister costs you your party card
  const nid = national(w);
  if (nid) rebels.forEach((r) => w.citizens[r]?.party === nid && r !== w.pm && expelNational(w, r, r, true));
}
export function assent(w: W, actor: Id, pid: Id, yes: boolean) {
  const p = own(w.proposals, pid);
  if (!p || p.stage !== 'assent') fail('Nothing is waiting for assent.');
  if (!isHOS(w, actor)) fail(`Only the ${hosTitle(w)} can do this.`);
  if (yes) return enact(w, p, w.config.hos === 'monarchy' ? 'Royal Assent' : 'signed by the President');
  if (inForce(w, 'decrees')) fail(`The ${hosTitle(w)} can no longer refuse assent. It becomes law within the hour.`);
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
// the Monarch's prerogative over the timetable: skip a bill's debate (once), or halve what's left of its debate or vote
// (once per stage). A halved stage always keeps at least HASTE_FLOOR hours, so a vote is never closed on the spot.
export const HASTE_FLOOR = 1;
export const HASTE_KINDS = ['bill', 'referendum'];
export function canHasten(w: W, id: Id, p: any): '' | string {
  if (w.config.hos !== 'monarchy' || !isHOS(w, id)) return 'Only the Monarch can hurry a bill along.';
  if (!p || !HASTE_KINDS.includes(p.kind)) return 'The Crown can only hurry bills and referendums.';
  if (!['debate', 'vote'].includes(p.stage)) return 'It is not being debated or voted on.';
  return '';
}
export function hasten(w: W, actor: Id, pid: Id, mode: string) {
  const p = own(w.proposals, pid);
  const no = canHasten(w, actor, p);
  if (no) fail(no);
  if (mode !== 'skip' && mode !== 'halve') fail('Choose to skip the debate or halve the time.');
  p.hastened = p.hastened || {};
  const who = `The ${w.config.hosTitle}`;
  if (mode === 'skip') {
    if (p.stage !== 'debate') fail('The debate is already over.');
    if (p.hastened.skip) fail('The Crown has already cut this debate short.');
    p.hastened.skip = true;
    gazette(w, 'hos', `${who} cuts the debate short on ${p.title}. It goes straight to a vote.`, '#/p/' + p.id);
    return openVote(w, p);
  }
  const key = p.stage === 'debate' ? 'debateEndsAt' : 'voteEndsAt';
  const left = p[key] - w.now;
  if (left <= HASTE_FLOOR * HOUR) fail(`There is ${HASTE_FLOOR} hour or less left already.`);
  p[key] = w.now + Math.max(HASTE_FLOOR * HOUR, Math.ceil(left / 2));
  p.hastened[p.stage] = (Number(p.hastened[p.stage]) || 0) + 1;
  if (p.stage === 'vote') Object.values(w.markets || {}).forEach((m: any) => m.kind === 'prop' && m.ref === p.id && m.status === 'open' && (m.closesAt = Math.min(m.closesAt, p[key])));
  gazette(w, 'hos', `${who} halves the time left for the ${p.stage === 'debate' ? 'debate' : 'vote'} on ${p.title}. It now ends at the new time shown.`, '#/p/' + p.id);
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
  const p = own(w.proposals, pid);
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
    bump(w, p.by, 'laws');
    stamp(w, p.by, `Bill ${p.n}`, `Became ${ref}`, 'ink');
  }
  meter(w, 'stability', p.constitutional ? 2 : 1, 'Parliament passed a law');
  gazette(w, 'law', `${secret ? 'A classified Act' : p.title.replace(/ Bill$/i, ' Act')} becomes law ${ref} (${how}).`, '#/law/' + ref);
}
export function applyClause(w: W, e: any, ref: string) {
  switch (e.t) {
    case 'office':
      if (e.template ? own(TEMPLATES, e.template) : e.office?.name) createOffice(w, e.template ? { template: e.template } : e.office, ref);
      break;
    case 'abolish':
      if (w.offices[e.office]) {
        gazette(w, 'law', `The ${w.offices[e.office].name} is abolished.`);
        delete w.offices[e.office];
      }
      break;
    case 'budget':
      if (own(w.offices, e.office)) w.offices[e.office].budget = Math.max(0, Math.round(Number(e.value)) || 0);
      break;
    case 'set':
      if (own(SETTABLE, e.key)) w.config[e.key] = e.value;
      break;
    case 'job':
      addJob(w, { title: String(e.title), pay: e.pay }, ref);
      break;
    case 'zone':
      addZone(w, e.text, 'law');
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
        if (x.t === 'job') Object.values(w.jobs).forEach((j: any) => j.law === e.ref && (j.active = false));
        if (ACT_KEYS.includes(x.t) && w.acts?.[x.t] === e.ref) repealAct(w, x.t);
      });
      break;
    }
    case 'constitution':
      if (e.key === 'seats') {
        if (![3, 5, 7, 9].includes(e.value)) break;
        w.config.seats = e.value;
        gazette(w, 'law', `From the next general election the House will have ${e.value} seats.`);
      }
      if (e.key === 'termDays' && [14, 21, 28].includes(e.value)) w.config.termDays = e.value;
      if (e.key === 'hos' && ['monarchy', 'republic'].includes(e.value) && e.value !== w.config.hos) {
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
    case 'jail':
    case 'decrees':
    case 'continuity':
    case 'unity':
    case 'protection':
    case 'press':
    case 'security':
    case 'crown':
      applyAct(w, e.t, ref);
      break;
    case 'war':
      if (!own(w.nations, e.nation)) break;
      w.army.war = e.nation;
      w.nations[e.nation].mood = 0;
      gazette(w, 'army', `The realm is at war with ${w.nations[e.nation].name}. Army upkeep doubles.`, '#/army');
      break;
    case 'peace':
      if (!own(w.nations, e.nation)) break;
      if (w.army.war === e.nation) w.army.war = null;
      w.nations[e.nation].mood = 1;
      gazette(w, 'army', `Peace with ${w.nations[e.nation].name}.`, '#/army');
      break;
  }
}
export function answerDissolution(w: W, actor: Id, pid: Id, yes: boolean) {
  const p = own(w.proposals, pid);
  if (!p || p.stage !== 'hos') fail('There is no dissolution request.');
  if (!isHOS(w, actor)) fail(`Only the ${hosTitle(w)} decides.`);
  dissolve(w, p, yes);
}
export function dissolve(w: W, p: any, yes: boolean) {
  if (yes && inForce(w, 'continuity')) yes = false;
  p.stage = yes ? 'passed' : 'failed';
  if (yes) {
    Object.values(w.elections).forEach((e: any) => e.kind === 'general' && e.status === 'open' && (e.status = 'cancelled'));
    gazette(w, 'hos', 'Parliament is dissolved. A snap general election closes in 2 days.', '#/elections');
    callGeneralElection(w, w.now + 2 * DAY);
  } else gazette(w, 'hos', `The ${hosTitle(w)} refuses to dissolve Parliament.`);
}
// a decree under the Government Powers Act: law at once, with a number, and a record like a bill's
export function enactDecree(w: W, actor: Id, title: string, summary: string, clauses: any[]) {
  w.propCount += 1;
  const id = newId(w, 'p');
  const ref = 'L' + String(w.laws.length + 1).padStart(3, '0');
  w.proposals[id] = {
    id, n: w.propCount, kind: 'bill', decree: true, title, summary, by: actor, clauses, target: null, constitutional: false, voters: 'mps', rule: 'cast',
    stage: 'enacted', at: w.now, debateEndsAt: null, voteEndsAt: null, assentDueAt: null, hosDueAt: null, speeches: [], votes: {}, casting: null, lobby: 0,
    result: null, lawRef: ref, fast: false, sponsors: [], amendments: [], history: [], draft: null
  };
  const secret = clauses.some((e: any) => e.t === 'office' && e.office?.secrecy === 'secret');
  w.laws.push({ ref, title, summary, text: clauses.map((e: any) => describe(w, e)), propId: id, at: w.now, classified: secret, how: 'By decree of the Prime Minister', decree: true, repealed: false, rulings: [] });
  clauses.forEach((e: any) => applyClause(w, e, ref));
  bump(w, actor, 'decrees');
  gazette(w, 'law', `By decree of the Prime Minister: ${secret ? 'a classified decree' : title}.`, '#/law/' + ref);
  return ref;
}
// The Returning Officer links a bill to the Act its wording describes, so the game carries it out. Public, like every
// admin power: the admin log, the Gazette, and the bill's own history. On a bill already enacted, the Act takes effect at once.
export const LINKABLE = ['debate', 'vote', 'assent', 'override', 'enacted'];
export function linkAct(w: W, actor: Id, pid: unknown, key: unknown) {
  if (!w.citizens[actor]?.admin) fail('Only the Returning Officer can do this.');
  const p = own(w.proposals, pid);
  if (!p || (p.kind !== 'bill' && p.kind !== 'referendum')) fail('Pick a bill.');
  if (!LINKABLE.includes(p.stage)) fail('That bill has failed or was withdrawn. There is nothing to link.');
  if (typeof key !== 'string' || !ACT_KEYS.includes(key as any)) fail('Pick an Act.');
  if (p.clauses.some((e: any) => e.t === key)) fail('That bill already carries that Act.');
  if (inForce(w, key as any)) fail(`The ${ACTS[key as 'jail'].name} Act is already law.`);
  if (p.clauses.length >= 20) fail('That bill already has 20 clauses.');
  p.clauses.push({ t: key });
  p.linked = [...(p.linked || []), { act: key, by: actor, at: w.now }];
  history(w, p, actor, `Linked to the ${ACTS[key as 'jail'].name} Act by the Returning Officer`);
  if (p.stage === 'enacted' && p.lawRef) {
    const law = w.laws.find((l: any) => l.ref === p.lawRef);
    if (law) law.text.push(describe(w, { t: key }));
    applyClause(w, { t: key }, p.lawRef);
  }
  adminDid(w, actor, `linked ${p.title} to the ${ACTS[key as 'jail'].name} Act${p.stage === 'enacted' ? `, which takes effect now under ${p.lawRef}` : ': the game will carry it out if the bill becomes law'}`, '#/p/' + p.id);
}
export function forceEnact(w: W, actor: Id, pid: Id, reason: string) {
  if (!w.citizens[actor]?.admin) fail('Only the Returning Officer can do this.');
  const p = own(w.proposals, pid);
  if (!p || p.stage !== 'assent') fail('Only a passed bill stuck waiting for assent can be force-enacted.');
  if (p.by === actor || p.votes[actor]) fail('You took part in this bill, so you cannot use admin tools on it.');
  const why = text(reason, 6, 200, 'reason');
  enact(w, p, `force-enacted by the Returning Officer: ${why}`);
  adminDid(w, actor, `force-enacted ${p.title}: ${why}`, '#/p/' + p.id);
}
export function lobby(w: W, actor: Id, pid: Id, mp: Id, amount: number) {
  mustBeFree(w, actor);
  const p = own(w.proposals, pid);
  if (!p || !['debate', 'vote'].includes(p.stage)) fail('You can only lobby on a proposal still in the House.');
  if (!isMP(w, mp)) fail('You can only lobby MPs.');
  if (mp === actor) fail('You cannot lobby yourself.');
  amount = int(amount, 1, 100, 'amount');
  transfer(w, ca(actor), ca(mp), amount, `Lobbying on ${p.title}`);
  p.lobby += Math.round(amount);
  w.lobbying.unshift({ at: w.now, from: actor, to: mp, prop: pid, amt: Math.round(amount) });
  gazette(w, 'money', `${nm(w, actor)} paid ${nm(w, mp)} ${Math.round(amount)} crowns to back ${p.title}. Declared publicly.`, '#/p/' + pid);
}

// ================= Questions: PMQs for everyone, formal questions for offices with the power =================
export function ask(w: W, actor: Id, question: string, to?: Id) {
  mustBeFree(w, actor);
  const q = text(question, 8, 300, 'question');
  if (to && to !== 'pm') {
    const o = officeWithPower(w, actor, 'question');
    if (!o) fail('Only offices with the power to question ministers can do that. Ask the PM at PMQs instead.');
    if (!own(w.citizens, to)?.active) fail('Pick who to question.');
    // under the Press and Information Act a question is only published once the Prime Minister approves it
    if (inForce(w, 'press')) return void w.questions.unshift({ id: newId(w, 'q'), by: actor, to, text: q, backers: [], answer: null, status: 'held', formal: true, office: o.id, at: w.now, dueAt: null, week: weekNo(w) });
    w.questions.unshift({ id: newId(w, 'q'), by: actor, to, text: q, backers: [], answer: null, status: 'open', formal: true, office: o.id, at: w.now, dueAt: w.now + 3 * DAY, week: weekNo(w) });
    gazette(w, 'question', `The ${o.name} formally asks ${nm(w, to)}: "${q}" An answer is due in 3 days.`, '#/questions');
    return;
  }
  if (!w.pm) fail('There is no Prime Minister to ask.');
  if (w.questions.some((q: any) => q.by === actor && !q.formal && q.week === weekNo(w))) fail('You get one PMQ a week.');
  w.questions.unshift({ id: newId(w, 'q'), by: actor, to: 'pm', text: q, backers: [], answer: null, status: inForce(w, 'press') && !isPM(w, actor) ? 'held' : 'open', formal: false, at: w.now, week: weekNo(w) });
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
export function answer(w: W, actor: Id, qid: Id, reply: string) {
  const q = w.questions.find((x: any) => x.id === qid);
  if (!q || q.status !== 'open') fail('That question is closed.');
  if (q.to === 'pm' ? !isPM(w, actor) : q.to !== actor) fail('This question is not for you.');
  q.answer = text(reply, 3, 1000, 'answer');
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
