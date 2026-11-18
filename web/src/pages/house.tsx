import { useEffect, useRef, useState } from 'preact/hooks';
import { drafts, getDraft, newDraftId, hasContent, saveDraft, deleteDraft, flushDraft, forgetDraft } from '../drafts';
import { useStore, act, getState, toast as say } from '../store';
import { go, Page, Sec, Card, Btn, Who, Left, When, Empty, LinkRow, Seg, Opt, Field, Pick, Stamp, BillText } from '../ui';
import { nm, isMP, isPM, isHOS, inGovernment, mps, fmtTime, superMajority, majority, officeWithPower, hosTitle, nextAt, hasPower, HOUR } from '../../../engine/index';
import { leaderOfOpposition, HOS_METHODS } from '../../../engine/politics';
import { describe, KINDS, SETTABLE, canVoteOn, passCheck, PASS_RULES, whipLine, canWhip, rebelsOn, amendmentLine, HOSTILE_BACKERS, LINKABLE, canHasten, HASTE_FLOOR } from '../../../engine/proposals';
import { TEMPLATES, POWERS, FILL } from '../../../engine/offices';
import { ACT_KEYS, ACTS, describeAct } from '../../../engine/acts';

const STAGE: Record<string, string> = { debate: 'Debate', vote: 'Voting', assent: 'Awaiting assent', override: 'Veto override', hos: 'With the head of state', enacted: 'Law', passed: 'Passed', failed: 'Defeated', vetoed: 'Vetoed', withheld: 'Assent refused', withdrawn: 'Withdrawn', consent: 'Waiting for the Prime Minister’s consent', refused: 'Consent refused' };
const LIVE = ['debate', 'vote', 'assent', 'override', 'hos'];
// a whole number from 0 to max, for the bill form's crowns fields
const whole = (v: string, max: number) => Math.min(max, Math.max(0, Math.round(Number(v)) || 0));

export function House() {
  const { world: w } = useStore();
  const lo = leaderOfOpposition(w);
  const bench = (gov: boolean) => w.seats.filter((s: string) => s && inGovernment(w, s) === gov).sort((a: string, b: string) => (w.pm === b ? 1 : 0) - (w.pm === a ? 1 : 0) || String(w.citizens[a].party || '~').localeCompare(String(w.citizens[b].party || '~')));
  const live = Object.values(w.proposals).filter((p: any) => LIVE.includes(p.stage)).sort((a: any, b: any) => b.n - a.n) as any[];
  const empty = w.seats.filter((s: any) => !s).length;
  const [all, setAll] = useState([false, false]);
  return (
    <Page kicker={w.martial ? 'Suspended under martial law' : 'Parliament'} title="The House" intro={`${w.config.seats} MPs and a Speaker. ${w.pm ? `The government needs ${majority(w)} votes to win.` : 'No government has been formed.'}`}>
      <Sec id="chamber" title="The chamber" sub={`${bench(true).length} government, ${bench(false).length} opposition.`}>
        <Card><div class="chamber">
          <Hemicycle />
          <div class="benches">
            {[true, false].map((gov) => (
              <div>
                <div class="small" style={{ fontWeight: 700, color: gov ? 'var(--teal)' : 'var(--red)', marginBottom: 6 }}>{gov ? 'Government' : 'Opposition'}, {bench(gov).length}</div>
                <div class="bench-grid">
                  {bench(gov).slice(0, all[gov ? 1 : 0] || w.seats.length <= 24 ? undefined : 10).map((id: string) => {
                    const c = w.citizens[id];
                    const role = w.pm === id ? 'PM' : lo === id ? 'Opp. leader' : w.speaker === id ? 'Speaker' : '';
                    return (
                      <a href={'#/passport/' + id} class={'bench ' + (gov ? '' : c.party ? 'opp' : 'ind')} style={{ textDecoration: 'none', color: 'inherit' }} title={c.party ? w.parties[c.party].name : 'Independent'}>
                        <div class="row"><b>{c.name}</b><span class="small tnum">{c.approval}%</span></div>
                        <div class="small muted bench-sub"><i class="dot" style={{ background: c.party ? w.parties[c.party].colour : 'var(--muted)' }} />{role || (c.party ? w.parties[c.party].name : 'Independent')}</div>
                      </a>
                    );
                  })}
                </div>
                {w.seats.length > 24 && bench(gov).length > 10 && <button type="button" class="linkish small" style={{ marginTop: 6 }} onClick={() => setAll(gov ? [all[0], !all[1]] : [!all[0], all[1]])}>{all[gov ? 1 : 0] ? 'Show fewer' : `Show all ${bench(gov).length}`}</button>}
              </div>
            ))}
          </div>
          </div>
          {empty > 0 && <p class="small muted" style={{ margin: '10px 0 0' }}>{empty} empty seat{empty > 1 ? 's' : ''}: nobody left on the countback list.</p>}
          <div class="row" style={{ marginTop: 10, flexWrap: 'wrap', justifyContent: 'flex-start' }}>
            <span class="small">Speaker: <Who id={w.speaker} /></span><a href="#/cabinet" class="small">Cabinet and coalition</a><a href="#/questions" class="small">Questions</a><a href="#/offices" class="small">Offices</a>
          </div>
        </Card>
      </Sec>
      <Sec title="Order paper" sub="Everything before the House, newest first.">
        <ul class="list">
          {live.map((p) => <LinkRow href={'#/p/' + p.id} title={p.kind === 'bill' ? `Bill ${p.n}, ${p.title}` : p.title} sub={<>{KINDS[p.kind].name}. {STAGE[p.stage]}{p.stage === 'vote' && <>, closes in <Left at={p.voteEndsAt} /></>}{p.stage === 'debate' && <>, voting opens in <Left at={p.debateEndsAt} /></>}</>} right={p.kind === 'no_confidence' ? <span class="chip red">Danger</span> : undefined} />)}
          {!live.length && <li class="muted">Nothing before the House.</li>}
        </ul>
        <div class="grid2" style={{ marginTop: 12 }}><Btn href="#/new">New proposal</Btn><Btn href="#/proposals" kind="ghost">All proposals</Btn></div>
      </Sec>
    </Page>
  );
}

// the seats as a half-circle of dots, government on the left, coloured by party: it scales to any size of House
function Hemicycle() {
  const { world: w } = useStore();
  const seats: (string | null)[] = w.seats;
  const n = seats.length;
  const rows = n <= 12 ? 2 : n <= 30 ? 3 : n <= 60 ? 4 : n <= 110 ? 5 : 7;
  const r0 = 0.42, r1 = 1;
  const radii = Array.from({ length: rows }, (_, i) => r0 + ((r1 - r0) * i) / Math.max(1, rows - 1));
  const total = radii.reduce((a, r) => a + r, 0);
  const per = radii.map((r) => Math.max(1, Math.round((n * r) / total)));
  per[rows - 1] += n - per.reduce((a, x) => a + x, 0);
  const pts: { x: number; y: number; a: number }[] = [];
  radii.forEach((r, i) => { for (let k = 0; k < per[i]; k++) { const a = Math.PI * (1 - (per[i] === 1 ? 0.5 : k / (per[i] - 1))); pts.push({ x: r * Math.cos(a), y: r * Math.sin(a), a }); } });
  pts.sort((p, q) => q.a - p.a);
  const rank = (id: string | null) => (!id ? 3 : inGovernment(w, id) ? 0 : w.citizens[id].party ? 1 : 2);
  const order = seats.slice().sort((a, b) => rank(a) - rank(b) || String(a && w.citizens[a].party).localeCompare(String(b && w.citizens[b].party)));
  const gap = Math.min((r1 - r0) / Math.max(1, rows - 1), ...radii.map((r, i) => (per[i] > 1 ? (Math.PI * r) / (per[i] - 1) : 2)));
  const dot = Math.min(0.09, gap * 0.42);
  const parties = [...new Set(order.filter(Boolean).map((id) => w.citizens[id!].party || 'ind'))];
  return (
    <figure class="hemi" aria-label={`Seats in the House: ${parties.map((p) => `${p === 'ind' ? 'Independents' : w.parties[p].name} ${order.filter((id) => id && (w.citizens[id].party || 'ind') === p).length}`).join(', ')}`}>
      <svg viewBox={`${-1 - dot} ${-1 - dot} ${2 + dot * 2} ${1 + dot * 2.5}`} role="img">
        {pts.map((p, i) => {
          const id = order[i];
          const c = id && w.citizens[id];
          const fill = !c ? 'none' : c.party ? w.parties[c.party].colour : 'var(--muted)';
          return <a href={id ? '#/passport/' + id : undefined}><circle cx={p.x} cy={-p.y} r={dot} fill={fill} stroke={c && inGovernment(w, id!) ? 'var(--ink)' : 'var(--line, currentColor)'} stroke-width={c && inGovernment(w, id!) ? dot * 0.35 : dot * 0.15} opacity={c ? 1 : 0.5}><title>{c ? `${c.name}, ${c.party ? w.parties[c.party].name : 'Independent'}${inGovernment(w, id!) ? ', government' : ''}` : 'Empty seat'}</title></circle></a>;
        })}
      </svg>
      <figcaption class="hemi-key">{parties.map((p) => <span class="small"><i class="dot" style={{ background: p === 'ind' ? 'var(--muted)' : w.parties[p].colour }} />{p === 'ind' ? 'Independents' : w.parties[p].name} <b class="tnum">{order.filter((id) => id && (w.citizens[id].party || 'ind') === p).length}</b></span>)}<span class="small muted">Outlined: government. Majority {majority(w)}.</span></figcaption>
    </figure>
  );
}

// the party whips on a bill: set yours if you lead a party; see everyone else's; after the vote, the rebels
function Whips({ p }: { p: any }) {
  const { world: w, me } = useStore();
  const pid = w.citizens[me]?.party;
  const lead = pid && w.parties[pid]?.leader === me && w.parties[pid]?.status === 'active';
  const open = ['debate', 'vote'].includes(p.stage);
  const whips = Object.entries(p.whips || {}).filter(([k]) => w.parties[k]);
  if (!lead && !whips.length && !p.rebels?.length) return null;
  const word = (l: string) => (l === 'aye' ? 'Aye' : l === 'no' ? 'No' : 'Free vote');
  return (
    <Sec title="The whips" sub="Party leaders tell their MPs how to vote. Loyal members follow; the unhappy rebel.">
      <Card>
        {lead && open && <div style={{ marginBottom: 10 }}><div class="small" style={{ fontWeight: 700, marginBottom: 6 }}>Whip the {w.parties[pid].name}</div><Seg value={p.whips?.[pid] || ''} onChange={(v) => act('party.whip', { prop: p.id, line: v }, v === 'free' ? 'A free vote. Your MPs choose.' : `Your MPs are whipped to vote ${v === 'aye' ? 'Aye' : 'No'}.`)} options={[['aye', 'Aye'], ['no', 'No'], ['free', 'Free vote']]} /></div>}
        {whips.length ? <ul class="list">{whips.map(([k, l]: any) => <li class="row"><span><i class="dot" style={{ background: w.parties[k].colour, marginRight: 8 }} />{w.parties[k].name}{k === pid && !lead ? <span class="small muted"> (your party)</span> : ''}</span><b>{word(l)}</b></li>)}</ul> : <p class="small muted" style={{ margin: 0 }}>No whips yet.</p>}
        {pid && !lead && p.whips?.[pid] && p.whips[pid] !== 'free' && open && <p class="small" style={{ margin: '8px 0 0' }}>Your party wants you to vote <b>{word(p.whips[pid])}</b>. Defy it and your colleagues will notice.</p>}
        {p.rebels?.length > 0 && <p class="small" style={{ margin: '8px 0 0' }}>Defied the whip: {p.rebels.map((x: string) => nm(w, x)).join(', ')}.</p>}
      </Card>
    </Sec>
  );
}

export function Proposals() {
  const { world: w } = useStore();
  const all = Object.values(w.proposals).sort((a: any, b: any) => b.n - a.n) as any[];
  return (
    <Page back={['#/house', 'The House']} title="Proposals">
      <Drafts />
      <ul class="list" style={{ marginTop: 16 }}>{all.map((p) => <LinkRow href={'#/p/' + p.id} title={p.title} sub={`${KINDS[p.kind].name}, ${STAGE[p.stage]}. By ${nm(w, p.by)}.`} />)}</ul>
    </Page>
  );
}

// the Returning Officer: link a bill to the Act its wording describes, so the game carries it out (public, logged)
function LinkAct({ p }: { p: any }) {
  const { world: w } = useStore();
  const [k, setK] = useState('');
  const open = ACT_KEYS.filter((x) => !w.acts?.[x] && !p.clauses.some((e: any) => e.t === x));
  if (!open.length) return null;
  return (
    <Sec>
      <Card kind="dashed">
        <div class="small" style={{ fontWeight: 700 }}>Returning Officer: link this bill to an Act</div>
        <p class="small muted" style={{ margin: '4px 0 8px' }}>Adds the coded clause, so the game carries out the Act {p.stage === 'enacted' ? 'at once' : 'if this bill becomes law'}. Announced in the Gazette and the admin log, and shown in the bill’s history.</p>
        <div class="grid2"><Pick value={k} onChange={setK} empty="Pick an Act" options={open.map((x) => [x, `${ACTS[x].name} Act`])} /><Btn kind="danger ghost" onClick={() => k && act('admin.linkAct', { prop: p.id, act: k }, 'Linked and logged.')}>Link</Btn></div>
      </Card>
    </Sec>
  );
}
export function Proposal({ id }: { id: string }) {
  const { world: w, me } = useStore();
  const p = w.proposals[id];
  const [text, setText] = useState('');
  const [side, setSide] = useState('for');
  const [lob, setLob] = useState({ mp: '', amount: '10' });
  const [reason, setReason] = useState('');
  const [edit, setEdit] = useState<any>(null);
  if (!p) return <Page title="No such proposal" back={['#/house', 'The House']} />;
  const book = p.stage === 'override' ? p.overrideVotes || {} : p.votes;
  const mine = book[me];
  const voters = p.voters === 'all' ? Object.keys(w.citizens) : mps(w);
  const ayes = Object.entries(book).filter(([k, v]) => v === 'aye' && voters.includes(k)).length;
  const noes = Object.entries(book).filter(([k, v]) => v === 'no' && voters.includes(k)).length;
  // a bill removing the head of state needs no assent: it goes straight from the vote to law
  const removal = p.kind === 'bill' && p.clauses.some((e: any) => e.t === 'removeHos');
  const steps = removal ? ['Debate', 'Vote', 'Law'] : p.kind === 'bill' ? ['Debate', 'Vote', w.config.hos === 'monarchy' ? 'Royal Assent' : 'Signature', 'Law'] : p.kind === 'dissolution' ? ['Asked', 'Head of state decides', 'Result'] : ['Debate', 'Vote', 'Result'];
  const idx0 = p.kind === 'dissolution' ? (p.stage === 'hos' ? 1 : 2) : ({ debate: 0, vote: 1, assent: 2, override: 2, enacted: 3, passed: p.kind === 'bill' ? 3 : 2, failed: p.kind === 'bill' ? 1 : 2, vetoed: 2, withheld: 2, withdrawn: p.debateEndsAt && p.result?.at > p.debateEndsAt ? 1 : 0 } as any)[p.stage];
  const idx = removal && idx0 >= 3 ? 2 : idx0;
  const failed = ['failed', 'vetoed', 'withheld', 'withdrawn'].includes(p.stage);
  const author = p.by === me && ['debate', 'vote'].includes(p.stage);
  const rebels: string[] = p.voters === 'mps' ? (p.stage === 'vote' ? rebelsOn(w, p) : p.rebels || []) : [];
  const myLine = p.voters === 'mps' ? whipLine(w, p, me) : null;
  const myParty = w.citizens[me]?.party;
  const lines = Object.entries(p.whips || {}).filter(([k]) => w.parties[k]) as [string, any][];
  const need = p.constitutional ? superMajority(w) : p.rule === 'seats' ? majority(w) : null;
  const blocker = officeWithPower(w, me, 'block');
  return (
    <Page back={['#/house', 'The House']} kicker={<>{KINDS[p.kind].name}{p.kind === 'bill' ? ` ${p.n}` : ''}, by <Who id={p.by} />{p.sponsors?.length ? <>, with {p.sponsors.map((x: string, i: number) => <>{i ? ', ' : ''}<Who id={x} /></>)}</> : ''}{p.crossParty ? ', cross-party' : ''}{p.constitutional ? ', constitutional' : ''}{p.fast ? ', fast-tracked' : ''}</>} title={p.title}>
      {['enacted', 'passed', 'failed', 'vetoed', 'withdrawn'].includes(p.stage) && <Stamp label={['enacted', 'passed'].includes(p.stage) ? 'Passed' : p.stage === 'vetoed' ? 'Vetoed' : p.stage === 'withdrawn' ? 'Withdrawn' : 'Defeated'} sub={p.lawRef || (p.result ? `${p.result.ayes} to ${p.result.noes}` : '')} red={failed} style={{ top: 70, right: 16, transformOrigin: '100% 0' }} />}
      {p.summary && <p class="intro">{p.summary}</p>}
      {p.editedAt && <p class="small muted" style={{ margin: '4px 0 0' }}>Amended by its author {p.edits > 1 ? `${p.edits} times, last ` : ''}{fmtTime(w, p.editedAt)}.</p>}
      {author && !edit && (
        <div class="row" style={{ justifyContent: 'flex-start', gap: 8, marginTop: 10 }}>
          {p.stage === 'debate' && ['bill', 'referendum'].includes(p.kind) && <Btn small kind="ghost" onClick={() => setEdit({ title: p.title, summary: p.summary || '', clauses: structuredClone(p.clauses) })}>Edit it</Btn>}
          {!(['no_confidence', 'confidence'].includes(p.kind) && p.stage === 'vote') && <Btn small kind="plain" onClick={() => confirm('Withdraw it? It stops here, and any bets on it are refunded.') && act('prop.withdraw', { prop: p.id }, 'Withdrawn.')}>Withdraw</Btn>}
        </div>
      )}
      {edit && (
        <Card style={{ marginTop: 12 }}><div class="stack">
          <b>Edit your {KINDS[p.kind].name.toLowerCase()}</b>
          <span class="small muted">Allowed until the vote opens. The change is announced, and speeches already made are marked as about the earlier wording.</span>
          <Field label={p.kind === 'referendum' ? 'Question' : 'Title'} value={edit.title} onInput={(v) => setEdit({ ...edit, title: v })} />
          <Field label="Summary" area value={edit.summary} onInput={(v) => setEdit({ ...edit, summary: v })} />
          {edit.clauses.map((e: any, i: number) => <ClauseEditor e={e} n={i + 1} onChange={(x) => setEdit({ ...edit, clauses: edit.clauses.map((y: any, j: number) => (j === i ? x : y)) })} onRemove={p.kind !== 'bill' || edit.clauses.length > 1 ? () => setEdit({ ...edit, clauses: edit.clauses.filter((_: any, j: number) => j !== i) }) : undefined} />)}
          <Btn kind="plain" small onClick={() => setEdit({ ...edit, clauses: [...edit.clauses, { t: 'text', text: '' }] })}>Add a clause</Btn>
          <div class="row" style={{ justifyContent: 'flex-start', gap: 8 }}><Btn small onClick={() => act('prop.edit', { prop: p.id, ...edit }, 'Amended. It is in the Gazette.') && setEdit(null)}>Save changes</Btn><Btn small kind="plain" onClick={() => setEdit(null)}>Cancel</Btn></div>
        </div></Card>
      )}
      {p.stage === 'withdrawn' && <Card kind="warn" style={{ marginTop: 12 }}><b>Withdrawn by its author</b>{p.result?.at ? <> {fmtTime(w, p.result.at)}</> : ''}.</Card>}
      <ol class="steps" aria-label="Stages" style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))` }}>
        {steps.map((s, i) => <li aria-current={i === idx ? 'step' : undefined} class={i < idx || (i === idx && !failed && !LIVE.includes(p.stage)) ? 'done' : i === idx ? (failed ? 'bad' : 'now') : ''}><span />{s}</li>)}
      </ol>
      {p.clauses.length > 0 && (
        <Sec title={p.kind === 'referendum' ? 'If Yes wins' : 'What it does'}>
          <ol class="stack" style={{ margin: 0, padding: 0, listStyle: 'none' }}>{p.clauses.map((e: any, i: number) => <li style={{ display: 'flex', gap: 14, fontSize: 16 }}><span class="serif" style={{ fontSize: 20, width: 16, flex: 'none' }}>{i + 1}</span><div style={{ minWidth: 0, flex: 1 }}>{e.t === 'text' ? <BillText text={e.text} /> : describe(w, e)}</div></li>)}</ol>
        </Sec>
      )}
      {p.kind !== 'bill' && p.kind !== 'referendum' && <p class="small muted" style={{ marginTop: 14 }}>{KINDS[p.kind].blurb}</p>}
      {(p.kind === 'bill' || p.kind === 'referendum') && <Amendments p={p} />}
      {(p.history?.length || 0) > 1 && <History p={p} />}

      {(p.stage === 'vote' || p.stage === 'override' || p.result) && p.stage !== 'withdrawn' && p.kind !== 'dissolution' && (
        <Sec>
          <Card>
            <div class="row"><h2 class="h" style={{ margin: 0 }}>{p.stage === 'override' ? 'Override vote' : p.voters === 'all' ? 'The referendum' : 'The vote'}</h2>{(p.stage === 'vote' || p.stage === 'override') && <b class="small" style={{ color: 'var(--red)' }}>Closes in <Left at={p.stage === 'override' ? p.overrideEndsAt : p.voteEndsAt} /></b>}</div>
            <p class="small muted" style={{ margin: '4px 0 12px' }}>{p.stage === 'override' ? `Needs ${superMajority(w)} of ${w.config.seats} MPs.` : <>Needs {passCheck(w, p, 0, 0).need}.{p.voters === 'all' ? ' Every citizen votes. Ballots are secret.' : (p.rule || 'cast') === 'cast' && !p.constitutional ? ' A tie goes to the Speaker.' : ''}</>}</p>
            {p.voters !== 'all' ? (
              <div class="seats-row" role="img" aria-label={`${ayes} aye, ${noes} no`}>{mps(w).map((m: string) => { const reb = rebels.includes(m); return <span title={nm(w, m) + (reb ? ', against the whip' : '')} class={'seat ' + (book[m] === 'aye' ? 'aye' : book[m] === 'no' ? 'no' : '') + (reb ? ' rebel' : '')}>{nm(w, m).slice(0, 1)}</span>; })}</div>
            ) : (
              <div class="yesno"><i style={{ width: `${ayes + noes ? (ayes / (ayes + noes)) * 100 : 50}%` }} /></div>
            )}
            <div class="row small" style={{ justifyContent: 'flex-start', gap: 16, margin: '10px 0' }}><span><b style={{ color: 'var(--teal)' }}>{ayes}</b> {p.voters === 'all' ? 'yes' : 'aye'}</span><span><b style={{ color: 'var(--red)' }}>{noes}</b> no</span><span class="muted">{voters.length - Object.keys(book).filter((k) => voters.includes(k)).length} yet to vote</span></div>
            {p.voters !== 'all' && (p.stage === 'vote' || p.stage === 'override') && (
              <div class="division-bar" aria-hidden="true">
                <i class="aye" style={{ width: `${(ayes / Math.max(1, w.config.seats)) * 100}%` }} />
                <i class="no" style={{ width: `${(noes / Math.max(1, w.config.seats)) * 100}%` }} />
                {need && <span class="need" style={{ left: `${(need / Math.max(1, w.config.seats)) * 100}%` }} title={`${need} needed`} />}
              </div>
            )}
            {(p.stage === 'vote' || p.stage === 'override') && p.voters !== 'all' && <p class="small" style={{ margin: '6px 0 10px', fontWeight: 700 }}>{passCheck(w, p, ayes, noes).passed ? 'On course to pass.' : need ? (noes > w.config.seats - need ? 'On course to fall.' : `${need - ayes} more aye${need - ayes === 1 ? '' : 's'} needed to pass.`) : ayes || noes ? 'Not passing yet.' : 'Nobody has voted yet.'}</p>}
            {(lines.length > 0 || (p.voters === 'mps' && canWhip(w, me) && ['debate', 'vote'].includes(p.stage))) && (
              <div class="whips">
                {lines.map(([k, l]) => <span class={'chip ' + (l.line === 'aye' ? 'teal' : l.line === 'no' ? 'red' : '')}><i class="dot" style={{ background: w.parties[k].colour, marginRight: 4 }} />{w.parties[k].name}: {l.line === 'free' ? 'free vote' : l.line === 'aye' ? 'Aye' : 'No'}</span>)}
                {p.voters === 'mps' && canWhip(w, me) && ['debate', 'vote'].includes(p.stage) && (
                  <span class="whip-set"><span class="small muted">Your party's line</span><Seg value={p.whips?.[myParty]?.line || ''} onChange={(v) => act('prop.whip', { prop: p.id, line: v }, v === 'free' ? 'A free vote. It is in the Gazette.' : 'Line set. Your MPs can see it.')} options={[['aye', 'Aye'], ['no', 'No'], ['free', 'Free vote']]} /></span>
                )}
              </div>
            )}
            {myLine && (p.stage === 'vote') && <p class="small" style={{ margin: '0 0 8px', fontWeight: 700 }}>Your party whips you to vote {myLine === 'aye' ? 'Aye' : 'No'}.{mine && mine !== 'abstain' && mine !== myLine ? <span class="err-line"> You're voting against it.</span> : ''}</p>}
            {rebels.length > 0 && <p class="small" style={{ margin: '0 0 8px' }}><b style={{ color: 'var(--red)' }}>Against the whip:</b> {rebels.map((r) => nm(w, r)).join(', ')}</p>}
            {(p.stage === 'vote' || p.stage === 'override') && canVoteOn(w, p, me) && !(p.voters === 'all' && mine) && (
              <div class="lobbies" role="group" aria-label="Your vote">
                <button type="button" class={'lobby aye' + (mine === 'aye' ? ' on' : '')} aria-pressed={mine === 'aye' ? 'true' : 'false'} onClick={() => act('prop.vote', { prop: p.id, vote: 'aye' }, mine ? 'Vote changed.' : 'Vote cast. +2 Influence.')}><b>{p.voters === 'all' ? 'Yes' : 'Aye'}</b><small>{p.voters === 'all' ? 'I agree' : 'Content'}</small></button>
                <button type="button" class={'lobby no' + (mine === 'no' ? ' on' : '')} aria-pressed={mine === 'no' ? 'true' : 'false'} onClick={() => act('prop.vote', { prop: p.id, vote: 'no' }, mine ? 'Vote changed.' : 'Vote cast. +2 Influence.')}><b>No</b><small>{p.voters === 'all' ? 'I disagree' : 'Not content'}</small></button>
                <button type="button" class={'lobby abstain' + (mine === 'abstain' ? ' on' : '')} aria-pressed={mine === 'abstain' ? 'true' : 'false'} onClick={() => act('prop.vote', { prop: p.id, vote: 'abstain' }, 'Abstention recorded.')}><b>Abstain</b><small>Present, not voting</small></button>
              </div>
            )}
            {mine && p.voters !== 'all' && (p.stage === 'vote' || p.stage === 'override') && <p class="small muted" style={{ margin: '8px 0 0' }}>You voted <b>{mine}</b>. You can change your vote until it closes.</p>}
            {p.voters === 'all' && mine && <p class="small" style={{ margin: 0 }}>Your ballot is in.</p>}
            {p.stage === 'vote' && w.speaker === me && p.voters === 'mps' && (
              <div style={{ marginTop: 10 }}><div class="small" style={{ fontWeight: 700, marginBottom: 6 }}>Your casting vote, used only on a tie</div><Seg value={p.casting || 'no'} onChange={(v) => act('prop.casting', { prop: p.id, vote: v })} options={[['aye', 'Aye'], ['no', 'No']]} /></div>
            )}
            {p.stage === 'vote' && !canVoteOn(w, p, me) && w.speaker !== me && <p class="small muted" style={{ margin: 0 }}>Only MPs vote on this. You can still speak below.</p>}
            {p.result && <p style={{ margin: '8px 0 0' }}><b>{p.result.passed ? 'Passed' : 'Defeated'}</b> {p.result.ayes} to {p.result.noes}{p.result.note}.</p>}
          </Card>
        </Sec>
      )}
      {!canHasten(w, me, p) && (
        ((p.stage === 'debate' && !p.hastened?.skip) || (p.stage === 'debate' ? p.debateEndsAt : p.voteEndsAt) - w.now > HASTE_FLOOR * HOUR)) && (
        <Sec>
          <Card kind="dashed">
            <h2 class="h">The Crown’s prerogative</h2>
            <p class="small" style={{ margin: '0 0 10px' }}>Hurry this along. The Gazette reports each use. A shortened stage always keeps at least {Math.round(HASTE_FLOOR * 60)} minutes.</p>
            <div class="grid2">
              {p.stage === 'debate' && !p.hastened?.skip && <Btn kind="plain" onClick={() => act('prop.hasten', { prop: p.id, mode: 'skip' }, 'Debate skipped. Voting is open.')}>Skip the debate</Btn>}
              {(p.stage === 'debate' ? p.debateEndsAt : p.voteEndsAt) - w.now > HASTE_FLOOR * HOUR && <Btn kind="plain" onClick={() => act('prop.hasten', { prop: p.id, mode: 'halve' }, 'Time halved.')}>Halve the {p.stage === 'debate' ? 'debate' : 'voting'} time</Btn>}
            </div>
          </Card>
        </Sec>
      )}
      {p.stage === 'assent' && (
        <Sec>
          <Card kind="tint">
            <h2 class="h">{w.config.hos === 'monarchy' ? 'Awaiting Royal Assent' : 'Awaiting the President'}</h2>
            <p style={{ margin: '0 0 10px' }}>{nm(w, w.hos.holder)} has until <When at={p.assentDueAt} />. {w.acts?.prerogative && !p.clauses.some((e: any) => e.t === 'removeHos') ? 'If nothing happens it lapses then: under the Royal Prerogative Act nothing becomes law without assent.' : 'If nothing happens it becomes law then.'}</p>
            {isHOS(w, me) && <div class="grid2"><Btn onClick={() => act('prop.assent', { prop: p.id, yes: true }, 'It is law.')}>{w.config.hos === 'monarchy' ? 'Grant assent' : 'Sign it'}</Btn><Btn kind="danger ghost" onClick={() => act('prop.assent', { prop: p.id, yes: false })}>{w.config.hos === 'monarchy' ? 'Refuse assent' : 'Veto'}</Btn></div>}
            {blocker && <Btn small kind="plain" style={{ marginTop: 10 }} onClick={() => act('prop.block', { prop: p.id }, 'Sent back for 48 hours.')}>Send back ({blocker.name})</Btn>}
          </Card>
          {w.citizens[me].admin && (
            <Card kind="dashed" style={{ marginTop: 10 }}>
              <Field label="Returning Officer: force-enact a stuck bill (reason shown on the law)" value={reason} onInput={setReason} />
              <Btn small kind="danger ghost" style={{ marginTop: 8 }} onClick={() => act('admin.forceEnact', { prop: p.id, reason }, 'Force-enacted and logged.')}>Force-enact</Btn>
            </Card>
          )}
        </Sec>
      )}
      {p.stage === 'hos' && (
        <Sec><Card kind="warn"><p style={{ margin: '0 0 10px' }}>The Prime Minister asks for a snap election. The {hosTitle(w)} has until <When at={p.hosDueAt} />; no answer means no.</p>{isHOS(w, me) && <div class="grid2"><Btn onClick={() => act('prop.dissolve', { prop: p.id, yes: true })}>Dissolve Parliament</Btn><Btn kind="plain" onClick={() => act('prop.dissolve', { prop: p.id, yes: false })}>Refuse</Btn></div>}</Card></Sec>
      )}
      {p.stage === 'withheld' && <Sec><Card kind="warn"><b>Constitutional crisis.</b> The Crown refused assent and Stability fell. The House can censure, or pass a bill removing the Monarch.</Card></Sec>}

      {w.citizens[me].admin && (p.kind === 'bill' || p.kind === 'referendum') && LINKABLE.includes(p.stage) && <LinkAct p={p} />}
      {p.kind !== 'dissolution' && (
        <Sec title={`Debate (${p.speeches.length})`} sub="Hansard, the official record.">
          <ol class="list">
            {p.speeches.map((s: any) => (
              <li>
                <div class="row"><b class="serif" style={{ fontSize: 18 }}><Who id={s.by} /></b><span class="small muted">{fmtTime(w, s.at)}{p.editedAt && s.at < p.editedAt ? ' · on the earlier wording' : ''}</span></div>
                <div class="small" style={{ fontWeight: 700, color: s.side === 'for' ? 'var(--teal)' : s.side === 'against' ? 'var(--red)' : 'var(--muted)' }}>{s.side === 'order' ? 'Order' : s.side[0].toUpperCase() + s.side.slice(1)}</div>
                <p style={{ margin: '4px 0 0', fontStyle: s.side === 'order' ? 'italic' : 'normal' }}>{s.text}</p>
                {w.acts?.press && (isPM(w, me) || hasPower(w, me, 'detain')) && <button type="button" class="btn plain small" style={{ marginTop: 6 }} onClick={() => act('press.remove', { prop: p.id, speech: s.id }, 'Removed.')}>Remove</button>}
              </li>
            ))}
            {!p.speeches.length && <li class="muted">No speeches yet.</li>}
          </ol>
          {['debate', 'vote', 'override'].includes(p.stage) && (
            <Card style={{ marginTop: 12 }}>
              <Field label="Your speech (+1 Influence, up to 3 a day)" area value={text} onInput={setText} placeholder="Speak for or against" />
              <div style={{ marginTop: 10 }}><Seg value={side} onChange={setSide} options={[['for', 'For'], ['against', 'Against'], ['undecided', 'Undecided']]} /></div>
              <div class="grid2" style={{ marginTop: 10 }}>
                <Btn onClick={() => act('prop.speak', { prop: p.id, side, text }, 'Speech recorded.') && setText('')}>Speak</Btn>
                {w.speaker === me && <Btn kind="plain" onClick={() => act('prop.speak', { prop: p.id, side: 'order', text: text || 'Order. Members will address the proposal, not each other.' }) && setText('')}>Call order</Btn>}
              </div>
            </Card>
          )}
        </Sec>
      )}
      {['debate', 'vote'].includes(p.stage) && p.voters === 'mps' && (
        <Sec title="Lobby an MP" sub={`Paid in crowns and declared in the Gazette.${p.lobby ? ` ${p.lobby} crowns so far.` : ''}`}>
          <Card>
            <div class="grid2"><Pick label="MP" value={lob.mp} onChange={(v) => setLob({ ...lob, mp: v })} options={mps(w).filter((m: string) => m !== me).map((m: string) => [m, nm(w, m)])} empty="Pick" /><Field label="Crowns" type="number" value={lob.amount} onInput={(v) => setLob({ ...lob, amount: v })} /></div>
            <Btn full style={{ marginTop: 10 }} onClick={() => act('prop.lobby', { prop: p.id, mp: lob.mp, amount: Number(lob.amount) }, 'Paid and declared.')}>Pay and declare</Btn>
          </Card>
        </Sec>
      )}
    </Page>
  );
}

// ---------- drafting ----------
export const CLAUSES: [string, string][] = [
  ['text', 'A rule in words'], ['office', 'Create an office'], ['set', 'Change a number'], ['budget', 'Set an office budget'], ['abolish', 'Abolish an office'],
  ['permit', 'Allow banks'], ['treaty', 'Ratify a treaty'], ['breakTreaty', 'Break a treaty'], ['repeal', 'Repeal a law'],
  ['constitution', 'Change the constitution'], ['removeHos', 'Remove the head of state'], ['war', 'Declare war'], ['peace', 'Make peace'],
  ['job', 'Create a civic job (paid wage)'], ['zone', 'Add a Streets safe zone'], ['currency', 'Rename the currency'],
  ['jail', 'Act: Public Order and Detention (the Realm Jail)'], ['decrees', 'Act: Government Powers (rule by decree)'],
  ['continuity', 'Act: Continuity of Parliament (no more elections)'], ['unity', 'Act: National Unity (one party)'],
  ['protection', 'Act: Protection of the State'], ['press', 'Act: Press and Information'], ['security', 'Act: State Security'],
  ['crown', 'Act: The Crown (the head of state is Prime Minister)'], ['prerogative', 'Act: Royal Prerogative (assent can be refused)']
];
export function NewProposal({ query }: { query: URLSearchParams }) {
  const { world: w, me } = useStore();
  const init = () => {
    if (query.get('office')) return [{ t: 'office', template: query.get('office') }];
    if (query.get('repeal')) return [{ t: 'repeal', ref: query.get('repeal') }];
    if (query.get('treaty')) return [{ t: 'treaty', offer: query.get('treaty') }];
    if (query.get('banks')) return [{ t: 'permit', what: 'banks' }];
    if (query.get('custom')) return [{ t: 'office', office: { name: '', fill: 'pm', powers: [], secrecy: 'public', budget: 0 } }];
    // a new version of a law: its clauses to rework, and the old Act repealed so the two don't both stand
    if (law) {
      const from = law.propId && w.proposals[law.propId]?.clauses?.length ? structuredClone(w.proposals[law.propId].clauses) : law.text.map((t: string) => ({ t: 'text', text: t }));
      return law.repealed || law.ref === 'L001' ? from : [{ t: 'repeal', ref: law.ref }, ...from];
    }
    return [{ t: 'text', text: '' }];
  };
  const law = query.get('from') ? w.laws.find((l: any) => l.ref === query.get('from') && !l.classified) : null;
  const [draftId] = useState(() => (query.get('draft') && getDraft(me, query.get('draft')!) ? query.get('draft')! : newDraftId()));
  const saved = getDraft(me, draftId);
  const [kind, setKind] = useState(saved?.kind || query.get('kind') || 'bill');
  const [clauses, setClauses] = useState<any[]>(() => saved?.clauses || init());
  const tpl = query.get('office') && TEMPLATES[query.get('office')!];
  const [title, setTitle] = useState(saved ? saved.title : tpl ? tpl.act.replace(/Act|Amendment/, 'Bill') : query.get('repeal') ? `Repeal of ${query.get('repeal')} Bill` : query.get('treaty') ? `${w.offers[query.get('treaty')!]?.title ?? 'Treaty'} Bill` : query.get('banks') ? 'Banking Bill' : law ? `${law.title.replace(/ Act$/i, '')} (Amendment) Bill` : '');
  const [summary, setSummary] = useState(saved ? saved.summary : law?.summary || '');
  const [target, setTarget] = useState(saved?.target || '');
  const [fast, setFast] = useState(!!saved?.fast);
  const [savedAt, setSavedAt] = useState(saved?.savedAt || 0);
  // every change you make is kept in this browser as a draft (just opening the page keeps nothing); emptied, it's dropped
  const first = useRef(true);
  useEffect(() => {
    if (first.current) return void (first.current = false);
    const d = { kind, title, summary, clauses, target, fast };
    if (!hasContent(d)) return void (deleteDraft(me, draftId), setSavedAt(0));
    const t = setTimeout(() => {
      setSavedAt(saveDraft(me, { id: draftId, ...d }).savedAt);
      // a reload (or a new version of the site) reopens this draft
      if (!location.hash.includes('draft=')) history.replaceState(null, '', '#/new?draft=' + draftId);
    }, 400);
    return () => clearTimeout(t);
  }, [kind, title, summary, clauses, target, fast]);
  const c = w.citizens[me];
  const open = Object.values(w.proposals).filter((p: any) => p.by === me && ['debate', 'vote'].includes(p.stage)).length;
  const cost = (kind === 'referendum' ? 20 : 0) + (open >= 2 ? 10 : 0) + (fast ? 15 : 0);
  const constitutional = clauses.some((e) => ['constitution', 'removeHos'].includes(e.t) || (e.t === 'office' && TEMPLATES[e.template]?.constitutional));
  // the draft on your account must match what's tabled, or the co-sponsors' signatures don't count
  const keep = async () => {
    const d = { kind, title, summary, clauses, target, fast };
    if (!hasContent(d)) return false;
    setSavedAt(saveDraft(me, { id: draftId, ...d }).savedAt);
    return flushDraft(me, draftId);
  };
  const submit = async () => {
    const synced = w.drafts?.[draftId] ? await keep() : false;
    if (act('prop.new', { kind, title, summary, clauses, target, fast, ...(synced ? { draft: draftId } : {}) }, 'Put before the House.')) {
      forgetDraft(me, draftId);
      const latest = Object.values(getState().world.proposals).sort((a: any, b: any) => b.n - a.n)[0] as any;
      go('p/' + latest.id);
    }
  };
  const kinds = Object.entries(KINDS).filter(([k]) => (k === 'confidence' || k === 'dissolution' ? isPM(w, me) : true));
  return (
    <Page back={['#/house', 'The House']} kicker="New proposal" title="Put it to the House" intro={isMP(w, me) || isPM(w, me) ? `You have ${c.influence} Influence.` : 'Only MPs can put proposals to the House. You can still draft one to see how it works.'}>
      <Drafts current={draftId} />
      <Sec title="What kind?">
        <div class="stack">{kinds.map(([k, v]) => <Opt on={kind === k} onClick={() => setKind(k)} title={v.name} hint={`${v.blurb} Voted on by: ${v.who}.`} />)}</div>
      </Sec>
      {(kind === 'bill' || kind === 'referendum') && (
        <>
          <div class="stack" style={{ marginTop: 18 }}>
            <Field label={kind === 'referendum' ? 'The question' : 'Title'} value={title} onInput={setTitle} placeholder={kind === 'referendum' ? 'Should the realm become a republic?' : 'e.g. Harbour Lights Bill'} />
            {kind === 'bill' && <Field label="One-line summary" value={summary} onInput={setSummary} placeholder="What it does, in a sentence" />}
          </div>
          <Sec title={kind === 'referendum' ? 'If Yes wins (optional)' : 'Clauses'}>
            <div class="stack">{clauses.map((e, i) => <ClauseEditor e={e} n={i + 1} onChange={(x) => setClauses(clauses.map((y, j) => (j === i ? x : y)))} onRemove={clauses.length > 1 || kind === 'referendum' ? () => setClauses(clauses.filter((_, j) => j !== i)) : undefined} />)}</div>
            <Btn kind="plain" small style={{ marginTop: 10 }} onClick={() => setClauses([...clauses, { t: 'text', text: '' }])}>Add a clause</Btn>
          </Sec>
        </>
      )}
      {kind === 'censure' && <Sec><Pick label="Who?" value={target} onChange={setTarget} empty="Pick a person" options={Object.values(w.citizens).map((x: any) => [x.id, x.name])} /></Sec>}
      <Sec title="Send it">
        <Card>
          {(kind === 'bill' || kind === 'referendum') && clauses.length > 0 && <ol style={{ margin: '0 0 10px', paddingLeft: 20 }}>{clauses.map((e) => <li>{safe(w, e)}</li>)}</ol>}
          {kind !== 'dissolution' && <Opt on={fast} onClick={() => setFast(!fast)} title="Fast-track: half the debate and voting time" hint="Costs 15 Influence." />}
          <p class="small" style={{ fontWeight: 700, margin: '10px 0' }}>{constitutional ? `Constitutional: needs ${superMajority(w)} of ${w.config.seats} MPs. ` : ''}{cost ? `Costs ${cost} Influence.` : 'Free.'} {kind === 'dissolution' ? 'Goes straight to the head of state.' : `Debate ${fast ? w.config.debateHours / 2 : w.config.debateHours}h, then ${fast ? w.config.voteHours / 2 : w.config.voteHours}h to vote.`}</p>
          {kind !== 'dissolution' && kind !== 'confidence' && <Sponsors draftId={draftId} keep={keep} />}
          <Btn full onClick={submit}>Put it to the House</Btn>
          <p class="small muted" style={{ margin: '8px 0 0' }}>{savedAt ? `Draft saved ${when(savedAt)}. ` : 'Drafts save as you type. '}<a href={'#/new?fresh=' + draftId}>Start another</a></p>
        </Card>
      </Sec>
    </Page>
  );
}
// MPs you've asked to put their names to it; a signature counts only for the wording they saw
const SPONSOR_STATE: Record<string, [string, string]> = { yes: ['Signed', 'teal'], invited: ['Asked', ''], no: ['Declined', 'red'] };
function Sponsors({ draftId, keep }: { draftId: string; keep: () => Promise<boolean> }) {
  const { world: w, me } = useStore();
  const [who, setWho] = useState('');
  const d = w.drafts?.[draftId];
  const list = Object.entries(d?.sponsors || {}) as [string, any][];
  const choices = mps(w).filter((m: string) => m !== me && !d?.sponsors?.[m]);
  const invite = async () => {
    if (!who) return;
    if (!(await keep())) return void say('Write something first, then ask people to back it.', true);
    act('draft.invite', { draft: draftId, who }, `Asked ${nm(w, who)}.`) && setWho('');
  };
  return (
    <div class="stack" style={{ margin: '0 0 12px' }}>
      <b class="small">Co-sponsors</b>
      {list.length > 0 && <ul class="list small">{list.map(([k, x]) => <li class="row"><span>{nm(w, k)} <span class={'chip ' + SPONSOR_STATE[x.status][1]}>{SPONSOR_STATE[x.status][0]}</span></span><Btn small kind="plain" onClick={() => act('draft.uninvite', { draft: draftId, who: k })}>Remove</Btn></li>)}</ul>}
      {choices.length > 0 && list.length < 6 && <div class="row" style={{ gap: 8 }}><Pick value={who} onChange={setWho} empty="Ask an MP to co-sponsor" options={choices.map((m: string) => [m, nm(w, m)])} /><Btn small kind="ghost" onClick={invite}>Ask</Btn></div>}
      <span class="small muted">They see the draft and can sign it. If you change the wording, they're asked again. Up to 6.</span>
    </div>
  );
}
// amendments: any other MP proposes changing one clause during the debate; the author takes it or leaves it
const AM_STATE: Record<string, string> = { pending: 'Waiting', accepted: 'Accepted', rejected: 'Turned down', lapsed: 'Lapsed', division: 'The House votes', carried: 'Carried by the House', defeated: 'Defeated' };
const LINE: Record<string, string> = { aye: 'backs it', no: 'opposes it', free: 'free vote' };
function Amendments({ p }: { p: any }) {
  const { world: w, me } = useStore();
  const [draft, setDraft] = useState<any>(null);
  const list = (p.amendments || []) as any[];
  const canAmend = p.stage === 'debate' && p.by !== me && isMP(w, me);
  if (!list.length && !canAmend) return null;
  const what = (m: any) => (m.op === 'remove' ? `Remove clause ${m.index + 1}` : m.op === 'add' ? `Add: ${safe(w, m.clause)}` : `Clause ${m.index + 1} to read: ${safe(w, m.clause)}`);
  const pickOp = (op: string) => setDraft({ ...draft, op, clause: op === 'change' ? structuredClone(p.clauses[draft.index] || { t: 'text', text: '' }) : op === 'add' ? { t: 'text', text: '' } : null });
  const send = () => act('prop.amend', { prop: p.id, op: draft.op, index: draft.index, clause: draft.clause, why: draft.why }, 'Amendment put. The author decides.') && setDraft(null);
  return (
    <Sec title="Amendments" sub={p.stage === 'debate' ? 'Any MP can propose one while it’s debated. The author takes it or leaves it; any still waiting lapse when voting opens.' : undefined}>
      <div class="stack">
        {list.map((m) => (
          <Card kind={m.status === 'pending' ? 'tint' : undefined}>
            <div class="row"><span class="small muted"><Who id={m.by} />, {fmtTime(w, m.at)}</span><span class={'chip' + (['accepted', 'carried'].includes(m.status) ? ' teal' : ['rejected', 'defeated'].includes(m.status) ? ' red' : '')}>{AM_STATE[m.status]}</span></div>
            <p style={{ margin: '6px 0 0' }}>{what(m)}</p>
            {m.why && <p class="small muted" style={{ margin: '4px 0 0' }}>“{m.why}”</p>}
            <AmendmentHouse p={p} m={m} />
            {m.status === 'pending' && p.by === me && p.stage === 'debate' && <div class="row" style={{ justifyContent: 'flex-start', gap: 8, marginTop: 8 }}><Btn small onClick={() => act('prop.amendment', { prop: p.id, amendment: m.id, accept: true }, 'Accepted. The bill is amended.')}>Accept</Btn><Btn small kind="plain" onClick={() => act('prop.amendment', { prop: p.id, amendment: m.id, accept: false }, 'Turned down.')}>Turn down</Btn></div>}
          </Card>
        ))}
        {canAmend && !draft && <Btn kind="ghost" small onClick={() => setDraft({ op: 'change', index: 0, clause: structuredClone(p.clauses[0] || { t: 'text', text: '' }), why: '' })}>Propose an amendment</Btn>}
        {canAmend && draft && (
          <Card><div class="stack">
            <Seg value={draft.op} onChange={pickOp} options={[['change', 'Change a clause'], ['add', 'Add a clause'], ['remove', 'Remove a clause']]} />
            {draft.op !== 'add' && p.clauses.length > 0 && <Pick label="Which clause" value={String(draft.index)} onChange={(v) => setDraft({ ...draft, index: Number(v), clause: draft.op === 'change' ? structuredClone(p.clauses[Number(v)]) : null })} options={p.clauses.map((e: any, i: number) => [String(i), `${i + 1}. ${safe(w, e)}`.slice(0, 80)])} />}
            {draft.op !== 'remove' && <ClauseEditor e={draft.clause} n={draft.op === 'add' ? p.clauses.length + 1 : draft.index + 1} onChange={(x) => setDraft({ ...draft, clause: x })} />}
            <Field label="Why (optional)" value={draft.why} onInput={(v) => setDraft({ ...draft, why: v })} />
            <div class="row" style={{ justifyContent: 'flex-start', gap: 8 }}><Btn small onClick={send}>Put the amendment</Btn><Btn small kind="plain" onClick={() => setDraft(null)}>Cancel</Btn></div>
          </div></Card>
        )}
      </div>
    </Sec>
  );
}
// backing, whips and the House's own vote on one amendment
function AmendmentHouse({ p, m }: { p: any; m: any }) {
  const { world: w, me } = useStore();
  const open = p.stage === 'debate' && ['pending', 'division'].includes(m.status);
  const backers = [m.by, ...(m.backers || [])].filter((x: string) => isMP(w, x));
  const lines = Object.entries(m.whips || {}).filter(([k]) => w.parties[k]) as [string, any][];
  const myLine = amendmentLine(w, m, me);
  const tally = (v: string) => Object.entries(m.votes || {}).filter(([k, x]) => x === v && isMP(w, k)).length;
  const myParty = w.citizens[me]?.party;
  return (
    <div class="stack" style={{ gap: 6, marginTop: 8 }}>
      {(m.status === 'pending' || backers.length > 1) && <span class="small">Backed by {backers.map((x: string) => nm(w, x)).join(', ')}{m.status === 'pending' && backers.length < HOSTILE_BACKERS ? `. With ${HOSTILE_BACKERS} MPs behind it, turning it down sends it to a House vote.` : m.status === 'pending' ? '. If the author turns it down, the House votes on it.' : '.'}</span>}
      {lines.length > 0 && <div class="chips">{lines.map(([k, x]) => <span class="chip" style={{ color: w.parties[k].colour }}>{w.parties[k].name} {LINE[x.line]}</span>)}</div>}
      {m.status === 'pending' && open && isMP(w, me) && me !== p.by && me !== m.by && <div><Btn small kind="ghost" onClick={() => act('prop.amendBack', { prop: p.id, amendment: m.id }, m.backers?.includes(me) ? 'Backing taken back.' : 'You back it.')}>{m.backers?.includes(me) ? 'Stop backing it' : 'Back it'}</Btn></div>}
      {m.status === 'division' && (
        <Card kind="tint">
          <div class="row"><b>The House divides</b><span class="small tnum">Aye {tally('aye')}, No {tally('no')}. Closes <When at={p.debateEndsAt} /></span></div>
          {isMP(w, me) && <div class="row" style={{ justifyContent: 'flex-start', gap: 8, marginTop: 8 }}>{(['aye', 'no', 'abstain'] as const).map((v) => <Btn small kind={m.votes?.[me] === v ? undefined : 'ghost'} onClick={() => act('prop.amendVote', { prop: p.id, amendment: m.id, vote: v }, 'Vote recorded.')}>{v === 'aye' ? 'Aye' : v === 'no' ? 'No' : 'Abstain'}</Btn>)}{myLine && <span class="small muted">Your party says {myLine === 'aye' ? 'Aye' : 'No'}.</span>}</div>}
        </Card>
      )}
      {m.result && <span class="small muted tnum">The House voted {m.result.ayes} to {m.result.noes}.{m.rebels?.length ? ` Defied the whip: ${m.rebels.map((x: string) => nm(w, x)).join(', ')}.` : ''}</span>}
      <Pledges p={p} m={m} />
      {open && canWhip(w, me) && myParty && <div class="row" style={{ justifyContent: 'flex-start', gap: 8 }}><span class="small">Your party’s line:</span><Seg value={m.whips?.[myParty]?.line || ''} onChange={(v) => act('prop.amendWhip', { prop: p.id, amendment: m.id, line: v }, 'Line set. It’s public.')} options={[['aye', 'Back'], ['no', 'Oppose'], ['free', 'Free']]} /></div>}
    </div>
  );
}
// pledges on one amendment: offers to answer, deals made, and a way to offer one
const PLEDGE_STATE: Record<string, string> = { agreed: 'Pledged', kept: 'Kept', broken: 'Broken' };
function Pledges({ p, m }: { p: any; m: any }) {
  const { world: w, me } = useStore();
  const [mine, setMine] = useState('');
  const all = Object.values(w.pledges || {}) as any[];
  const amend = (id: string) => {
    for (const q of Object.values(w.proposals) as any[]) {
      const x = (q.amendments || []).find((y: any) => y.id === id);
      if (x) return { q, x };
    }
    return null;
  };
  const offers = all.filter((pl) => pl.status === 'offered' && pl.b === me && pl.aBacks === m.id);
  const deals = all.filter((pl) => ['agreed', 'kept', 'broken'].includes(pl.status) && (pl.aBacks === m.id || pl.bBacks === m.id));
  const open = p.stage === 'debate' && ['pending', 'division'].includes(m.status);
  const myOpen = open && isMP(w, me) && m.by !== me ? (Object.values(w.proposals) as any[]).filter((q) => q.stage === 'debate').flatMap((q) => (q.amendments || []).filter((x: any) => x.by === me && ['pending', 'division'].includes(x.status)).map((x: any) => [x.id, `${q.title}: ${x.op === 'remove' ? `remove clause ${x.index + 1}` : safe(w, x.clause)}`.slice(0, 80)] as [string, string])) : [];
  if (!offers.length && !deals.length && !myOpen.length) return null;
  return (
    <div class="stack" style={{ gap: 6 }}>
      {deals.map((pl) => {
        const backer = pl.aBacks === m.id ? pl.a : pl.b;
        const other = amend(pl.aBacks === m.id ? pl.bBacks : pl.aBacks);
        return <span class="small"><span class={'chip' + (pl.status === 'broken' ? ' red' : pl.status === 'kept' ? ' teal' : '')}>{PLEDGE_STATE[pl.status]}</span> {nm(w, backer)} backs this, in return for {nm(w, m.by)} backing their amendment{other ? <> to <a href={'#/p/' + other.q.id}>{other.q.title}</a></> : ''}.{pl.status === 'broken' ? ` ${nm(w, pl.brokenBy)} broke it.` : ''}</span>;
      })}
      {offers.map((pl) => {
        const theirs = amend(pl.bBacks);
        return (
          <Card kind="tint">
            <span class="small"><b>{nm(w, pl.a)} offers a pledge:</b> they back this if you back their amendment{theirs ? <> to <a href={'#/p/' + theirs.q.id}>{theirs.q.title}</a>: {theirs.x.op === 'remove' ? `remove clause ${theirs.x.index + 1}` : safe(w, theirs.x.clause)}</> : ''}. Agreed, it’s public, and breaking it is news.</span>
            <div class="row" style={{ justifyContent: 'flex-start', gap: 8, marginTop: 6 }}><Btn small onClick={() => act('pledge.answer', { pledge: pl.id, yes: true }, 'Agreed. It’s in the Gazette.')}>Agree</Btn><Btn small kind="plain" onClick={() => act('pledge.answer', { pledge: pl.id, yes: false }, 'Turned down.')}>No</Btn></div>
          </Card>
        );
      })}
      {myOpen.length > 0 && <div class="row" style={{ gap: 8 }}><Pick value={mine} onChange={setMine} empty="Pledge: back this for theirs on…" options={myOpen} /><Btn small kind="ghost" onClick={() => mine && act('pledge.offer', { mine, theirs: m.id }, `Offered. ${nm(w, m.by)} decides.`) && setMine('')}>Offer</Btn></div>}
    </div>
  );
}
// every wording the bill has had, what changed each time, and why
function History({ p }: { p: any }) {
  const { world: w } = useStore();
  const [open, setOpen] = useState<number | null>(null);
  const h = p.history as any[];
  const changes = (i: number) => {
    if (!i) return `${h[0].clauses.length} clause${h[0].clauses.length === 1 ? '' : 's'}`;
    const a = h[i - 1].clauses.map((e: any) => JSON.stringify(e));
    const b = h[i].clauses.map((e: any) => JSON.stringify(e));
    const out: string[] = [];
    if (h[i].title !== h[i - 1].title) out.push('new title');
    b.forEach((x: string, k: number) => k < a.length && x !== a[k] && out.push(`clause ${k + 1} changed`));
    if (b.length > a.length) out.push(`clause${b.length - a.length > 1 ? 's' : ''} ${a.length + 1}${b.length - a.length > 1 ? `–${b.length}` : ''} added`);
    if (a.length > b.length) out.push(`${a.length - b.length} clause${a.length - b.length > 1 ? 's' : ''} removed`);
    if (h[i].summary !== h[i - 1].summary) out.push('new summary');
    return out.join(', ') || 'no change to the wording';
  };
  return (
    <Sec title="History" sub="Every version of the wording, oldest first.">
      <ol class="list" style={{ paddingLeft: 0, listStyle: 'none' }}>
        {h.map((x, i) => (
          <li>
            <div class="row"><span><b>{x.why}</b> <span class="small muted">{nm(w, x.by)}, {fmtTime(w, x.at)}</span><div class="small">{changes(i)}</div></span><Btn small kind="plain" onClick={() => setOpen(open === i ? null : i)}>{open === i ? 'Hide' : 'Wording'}</Btn></div>
            {open === i && <ol class="small" style={{ margin: '6px 0 0', paddingLeft: 20 }}>{x.clauses.map((e: any) => <li>{safe(w, e)}</li>)}</ol>}
          </li>
        ))}
      </ol>
    </Sec>
  );
}
const when = (t: number) => new Date(t).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
// your unsent drafts, saved in this browser; the one you're editing is left out
function Drafts({ current }: { current?: string }) {
  const { me } = useStore();
  const [, redraw] = useState(0);
  const { world: w } = useStore();
  const list = drafts(me).filter((d) => d.id !== current);
  const asked = Object.values(w.drafts || {}).filter((d: any) => d.by !== me && d.sponsors?.[me]) as any[];
  if (!list.length && !asked.length) return null;
  return (
    <>
    {asked.length > 0 && (
      <Sec title="Asked to co-sponsor">
        <ul class="list">{asked.map((d) => <LinkRow href={'#/draft/' + d.id} title={d.title || 'Untitled draft'} sub={`${nm(w, d.by)}’s ${(KINDS[d.kind]?.name || 'bill').toLowerCase()}. ${SPONSOR_STATE[d.sponsors[me].status][0]}.`} />)}</ul>
      </Sec>
    )}
    {list.length > 0 && <Sec title="Your drafts" sub="Saved as you type, on this device and your account. Only you and anyone you ask to co-sponsor can see them.">
      <ul class="list">
        {list.map((d) => (
          <li class="row">
            <a href={'#/new?draft=' + d.id}><b>{d.title.trim() || 'Untitled draft'}</b><div class="small muted">{KINDS[d.kind]?.name || 'Bill'}, {d.clauses.length} clause{d.clauses.length === 1 ? '' : 's'}, saved {when(d.savedAt)}</div></a>
            <span class="row"><Btn small kind="ghost" href={'#/new?draft=' + d.id}>Edit</Btn><Btn small kind="plain" onClick={() => confirm('Delete this draft? It can’t be got back.') && (deleteDraft(me, d.id), redraw((n) => n + 1))}>Delete</Btn></span>
          </li>
        ))}
      </ul>
    </Sec>}
    </>
  );
}
// a draft you've been asked to co-sponsor: read it, then sign or decline
export function DraftPage({ id }: { id: string }) {
  const { world: w, me } = useStore();
  const d = w.drafts?.[id];
  useEffect(() => void (d?.by === me && go('new?draft=' + id)), [id]);
  if (!d || !d.sponsors?.[me]) return <Page back={['#/proposals', 'Proposals']} title="No such draft" intro="It may have been tabled, deleted, or you're no longer asked to co-sponsor it." />;
  const mine = d.sponsors[me];
  const others = Object.entries(d.sponsors).filter(([k, x]: any) => k !== me && x.status === 'yes').map(([k]) => nm(w, k));
  return (
    <Page back={['#/proposals', 'Proposals']} kicker={<>A draft {(KINDS[d.kind]?.name || 'bill').toLowerCase()} by <Who id={d.by} /></>} title={d.title || 'Untitled draft'} intro={d.summary}>
      {d.clauses.length > 0 && <Sec title="What it would do"><ol class="stack" style={{ paddingLeft: 22, margin: 0 }}>{d.clauses.map((e: any) => <li>{safe(w, e) || 'An unfinished clause.'}</li>)}</ol></Sec>}
      <Sec title="Co-sponsor it?" sub={others.length ? `Signed so far: ${others.join(', ')}.` : 'Nobody has signed yet.'}>
        <Card>
          <p style={{ marginTop: 0 }}>{mine.status === 'yes' ? 'You’ve signed this wording. If it changes, you’ll be asked again.' : mine.status === 'no' ? 'You declined. You can still sign.' : `Your name goes on it when ${nm(w, d.by)} puts it to the House. Only this wording counts: if it changes, you’re asked again.`}</p>
          <div class="row" style={{ justifyContent: 'flex-start', gap: 8 }}>
            {mine.status !== 'yes' && <Btn onClick={() => act('draft.sponsor', { draft: id, yes: true }, 'Signed.')}>Sign it</Btn>}
            {mine.status !== 'no' && <Btn kind="ghost" onClick={() => act('draft.sponsor', { draft: id, yes: false }, mine.status === 'yes' ? 'Signature taken back.' : 'Declined.')}>{mine.status === 'yes' ? 'Take my name off' : 'Decline'}</Btn>}
          </div>
        </Card>
      </Sec>
    </Page>
  );
}
function safe(w: any, e: any) {
  try {
    return describe(w, e);
  } catch {
    return '';
  }
}
export function ClauseEditor({ e, n, onChange, onRemove }: { e: any; n: number; onChange: (e: any) => void; onRemove?: () => void }) {
  const { world: w } = useStore();
  const defaults: Record<string, any> = {
    text: { t: 'text', text: '' },
    office: { t: 'office', template: Object.keys(TEMPLATES).find((k) => !w.offices[k] && k !== 'whip') || null, office: { name: '', fill: 'pm', powers: [], secrecy: 'public', budget: 0 } },
    set: { t: 'set', key: 'taxRate', value: w.config.taxRate },
    budget: { t: 'budget', office: Object.keys(w.offices)[0], value: 20 },
    abolish: { t: 'abolish', office: Object.keys(w.offices).find((k) => k !== 'whip') },
    permit: { t: 'permit', what: 'banks' },
    treaty: { t: 'treaty', offer: Object.keys(w.offers)[0] || '' },
    breakTreaty: { t: 'breakTreaty', treaty: Object.keys(w.treaties).find((k) => w.treaties[k].status === 'active') || '' },
    repeal: { t: 'repeal', ref: w.laws.find((l: any) => !l.repealed && l.ref !== 'L001')?.ref || '' },
    constitution: { t: 'constitution', key: 'seats', value: 7, label: '7' },
    removeHos: { t: 'removeHos' },
    war: { t: 'war', nation: 'kessmark' },
    peace: { t: 'peace', nation: w.army.war || 'kessmark' },
    job: { t: 'job', title: '', pay: 5 },
    zone: { t: 'zone', text: '' },
    currency: { t: 'currency', one: '', many: '' },
    jail: { t: 'jail' },
    decrees: { t: 'decrees' },
    continuity: { t: 'continuity' },
    unity: { t: 'unity' },
    protection: { t: 'protection' },
    press: { t: 'press' },
    security: { t: 'security' },
    crown: { t: 'crown' },
    prerogative: { t: 'prerogative' }
  };
  const ob = e.office || {};
  const setOb = (k: string, v: any) => onChange({ ...e, template: null, office: { ...ob, [k]: v } });
  return (
    <Card>
      <div class="row"><b class="serif" style={{ fontSize: 20 }}>Clause {n}</b>{onRemove && <button type="button" class="btn plain small" onClick={onRemove}>Remove</button>}</div>
      <div class="stack" style={{ marginTop: 8 }}>
        <Pick value={e.t} onChange={(t) => onChange(defaults[t])} options={CLAUSES} />
        {ACT_KEYS.includes(e.t) && <p class="small" style={{ margin: 0 }}>{w.acts?.[e.t] ? <b>Already law ({w.acts[e.t]}). </b> : 'The game carries all of this out the moment it becomes law. '}{describeAct(e.t)}</p>}
        {e.t === 'text' && <Field label="The rule" area value={e.text} onInput={(v) => onChange({ ...e, text: v })} placeholder="e.g. The second Friday of every month is a public holiday." />}
        {e.t === 'text' && <p class="small muted" style={{ margin: 0 }}>Layout: a new line for each paragraph. “1  Section title” for a section, “(1)” and “(a)” for subsections, a line in CAPITALS for a title, **bold** and *italic*.</p>}
        {e.t === 'text' && String(e.text || '').includes('\n') && <div class="bt-preview"><div class="small muted" style={{ marginBottom: 6 }}>Preview</div><BillText text={e.text} /></div>}
        {e.t === 'office' && (
          <>
            <Pick label="Which office" value={e.template || 'custom'} onChange={(v) => onChange(v === 'custom' ? { t: 'office', template: null, office: { name: '', fill: 'pm', powers: [], secrecy: 'public', budget: 0 } } : { t: 'office', template: v })} options={[...Object.entries(TEMPLATES).filter(([k]) => !w.offices[k] && k !== 'whip').map(([k, t]) => [k, `${t.name} (${t.act})`] as [string, string]), ['custom', 'A new office of your own']]} />
            {e.template && <p class="small muted" style={{ margin: 0 }}>{TEMPLATES[e.template].blurb}</p>}
            {!e.template && (
              <>
                <Field label="Name" value={ob.name || ''} onInput={(v) => setOb('name', v)} placeholder="e.g. Minister for Festivals" />
                <div class="small" style={{ fontWeight: 700 }}>Who fills it?</div>
                <Seg value={ob.fill || 'pm'} onChange={(v) => setOb('fill', v)} options={Object.entries(FILL).filter(([k]) => k !== 'crown').map(([k]) => [k, ({ pm: 'PM', house: 'MPs', citizens: 'Everyone', lot: 'Lot' } as any)[k]])} />
                <div class="small" style={{ fontWeight: 700 }}>Powers</div>
                <div class="stack" style={{ gap: 6 }}>{['grant', 'question', 'files', 'fine', 'block', 'propose', 'govern'].map((k) => <Opt on={(ob.powers || []).includes(k)} onClick={() => setOb('powers', (ob.powers || []).includes(k) ? ob.powers.filter((x: string) => x !== k) : [...(ob.powers || []), k])} title={POWERS[k].label} right={POWERS[k].strong ? <span class="chip red">Strong</span> : undefined} />)}</div>
                <div class="grid2"><Field label="Weekly budget (0–200)" type="number" value={ob.budget ?? 0} onInput={(v) => setOb('budget', whole(v, 200))} /><div><div class="small" style={{ fontWeight: 700, marginBottom: 6 }}>Visibility</div><Seg value={ob.secrecy || 'public'} onChange={(v) => setOb('secrecy', v)} options={[['public', 'Public'], ['secret', 'Secret']]} /></div></div>
              </>
            )}
          </>
        )}
        {e.t === 'set' && <div class="grid2"><Pick label="Number" value={e.key} onChange={(v) => onChange({ ...e, key: v, value: w.config[v] })} options={Object.entries(SETTABLE).map(([k, s]) => [k, s.label])} /><Field label={`New value (now ${w.config[e.key]})`} type="number" value={e.value} onInput={(v) => onChange({ ...e, value: Number(v) })} /></div>}
        {(e.t === 'budget' || e.t === 'abolish') && <Pick label="Office" value={e.office} onChange={(v) => onChange({ ...e, office: v })} options={Object.values(w.offices).map((o: any) => [o.id, o.name])} />}
        {e.t === 'budget' && <Field label="Crowns a week (0–200)" type="number" value={e.value} onInput={(v) => onChange({ ...e, value: whole(v, 200) })} />}
        {e.t === 'permit' && <p class="small muted" style={{ margin: 0 }}>Lets any citizen open a licensed bank (25 crowns plus 25 starting capital).</p>}
        {e.t === 'treaty' && (Object.keys(w.offers).length ? <Pick value={e.offer} onChange={(v) => onChange({ ...e, offer: v })} options={Object.values(w.offers).map((o: any) => [o.id, o.title])} /> : <p class="small muted">No offers right now. The Foreign Office can ask for one.</p>)}
        {e.t === 'breakTreaty' && (Object.values(w.treaties).some((t: any) => t.status === 'active') ? <Pick value={e.treaty} onChange={(v) => onChange({ ...e, treaty: v })} options={Object.values(w.treaties).filter((t: any) => t.status === 'active').map((t: any) => [t.id, t.title])} /> : <p class="small muted">No treaties in force.</p>)}
        {e.t === 'repeal' && <Pick value={e.ref} onChange={(v) => onChange({ ...e, ref: v })} options={w.laws.filter((l: any) => !l.repealed && l.ref !== 'L001').map((l: any) => [l.ref, `${l.ref} ${l.title}`])} />}
        {e.t === 'constitution' && (
          <>
            <Pick value={e.key} onChange={(k) => onChange({ t: 'constitution', key: k, value: k === 'seats' ? 7 : k === 'termDays' ? 21 : k === 'hos' ? (w.config.hos === 'monarchy' ? 'republic' : 'monarchy') : HOS_METHODS[w.config.hos][0].id, label: '' })} options={[['seats', 'Seats in Parliament'], ['termDays', 'Time between elections'], ['hos', 'Monarchy or republic'], ['hosMethod', 'How the head of state is chosen']]} />
            {e.key === 'seats' && <Seg value={String(e.value)} onChange={(v) => onChange({ ...e, value: Number(v), label: v })} options={[['3', '3'], ['5', '5'], ['7', '7'], ['9', '9']]} />}
            {e.key === 'termDays' && <Seg value={String(e.value)} onChange={(v) => onChange({ ...e, value: Number(v), label: `${Number(v) / 7} weeks` })} options={[['14', '2 weeks'], ['21', '3 weeks'], ['28', '4 weeks']]} />}
            {e.key === 'hos' && <Seg value={e.value} onChange={(v) => onChange({ ...e, value: v, label: v === 'monarchy' ? 'a Monarch' : 'a President' })} options={[['monarchy', 'Monarchy'], ['republic', 'Republic']]} />}
            {e.key === 'hosMethod' && <Pick value={e.value} onChange={(v) => onChange({ ...e, value: v, label: HOS_METHODS[w.config.hos].find((m) => m.id === v)?.label.toLowerCase() })} options={HOS_METHODS[w.config.hos].map((m) => [m.id, m.label])} />}
          </>
        )}
        {e.t === 'job' && <><Field label="The job" value={e.title} onInput={(v) => onChange({ ...e, title: v })} placeholder="e.g. Pick up litter in a park for 20 minutes" /><Field label="Wage each time (1–30 crowns)" type="number" value={e.pay} onInput={(v) => onChange({ ...e, pay: Math.max(1, whole(v, 30)) })} /><p class="small muted" style={{ margin: 0 }}>Anyone can claim it once a week. The Chancellor (or PM) signs off each claim; the Treasury pays.</p></>}
        {e.t === 'currency' && <div class="grid2"><Field label="New name (one)" value={e.one || ''} onInput={(v) => onChange({ ...e, one: v })} placeholder="e.g. ducat" /><Field label="Plural (optional)" value={e.many || ''} onInput={(v) => onChange({ ...e, many: v })} placeholder="e.g. ducats" /></div>}
        {e.t === 'zone' && <Field label="Where nothing counts" value={e.text} onInput={(v) => onChange({ ...e, text: v })} placeholder="e.g. The library" />}
        {(e.t === 'war' || e.t === 'peace') && <Pick value={e.nation} onChange={(v) => onChange({ ...e, nation: v })} options={Object.values(w.nations).map((x: any) => [x.id, x.name])} />}
      </div>
    </Card>
  );
}

// ---------- questions ----------
export function Questions() {
  const { world: w, me } = useStore();
  const [q, setQ] = useState('');
  const [ans, setAns] = useState<Record<string, string>>({});
  const [formal, setFormal] = useState({ to: '', text: '' });
  const qo = officeWithPower(w, me, 'question');
  const open = w.questions.filter((x: any) => x.status === 'open' && !x.formal).sort((a: any, b: any) => b.backers.length - a.backers.length);
  const formals = w.questions.filter((x: any) => x.formal);
  const past = w.questions.filter((x: any) => x.status !== 'open' && !x.formal).slice(0, 10);
  const answerBox = (x: any) => (
    <div class="stack" style={{ marginTop: 8 }}>
      <input class="input" value={ans[x.id] || ''} onInput={(e: any) => setAns({ ...ans, [x.id]: e.target.value })} placeholder="Your answer" />
      <Btn small onClick={() => act('q.answer', { id: x.id, text: ans[x.id] }, 'Answered.')}>Answer</Btn>
    </div>
  );
  return (
    <Page back={['#/house', 'The House']} title="Questions" intro="Every week, each citizen holds to right to submit questions to the Prime Minister and to agree with other questions">
      <Sec title="PM's Questions" sub={<>Questions close <When at={nextAt(w, 'pmqs')} />.</>}>
        <div class="stack">
          {open.map((x: any, i: number) => (
            <Card style={{ borderColor: i < 3 ? 'var(--ink)' : 'var(--rule)' }}>
              <div style={{ display: 'flex', gap: 12 }}>
                <button type="button" class={'backer' + (x.backers.includes(me) ? ' on' : '')} aria-pressed={x.backers.includes(me) ? 'true' : 'false'} onClick={() => act('q.back', { id: x.id })}><span aria-hidden="true">▲</span><b class="tnum">{x.backers.length}</b></button>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div class="small muted"><Who id={x.by} /></div>
                  <p style={{ margin: '4px 0 0' }}>{x.text}</p>
                  {i < 3 && <div class="small" style={{ color: 'var(--red)', fontWeight: 700, marginTop: 6 }}>Must be answered</div>}
                  {isPM(w, me) && answerBox(x)}
                </div>
              </div>
            </Card>
          ))}
          {!open.length && <Empty>No questions this week yet.</Empty>}
        </div>
        <Card style={{ marginTop: 12 }}><Field label="Ask the Prime Minister" value={q} onInput={setQ} /><Btn full style={{ marginTop: 10 }} onClick={() => act('q.ask', { text: q }, 'Asked.') && setQ('')}>Ask</Btn></Card>
      </Sec>
      <Sec title="Formal questions" sub="Offices with the power to question ministers can demand an answer within 3 days.">
        <div class="stack">
          {formals.map((x: any) => (
            <Card kind={x.status === 'dodged' ? 'warn' : undefined}>
              <div class="small muted">{w.offices[x.office]?.name ?? 'An office'} asks <Who id={x.to} />{x.status === 'open' ? <>, due <When at={x.dueAt} /></> : ''}</div>
              <p style={{ margin: '4px 0 0' }}>{x.text}</p>
              {x.answer && <p class="answer">{x.answer}</p>}
              {x.status === 'dodged' && <b class="small err-line">Not answered</b>}
              {x.status === 'open' && x.to === me && answerBox(x)}
            </Card>
          ))}
          {!formals.length && <Empty>None yet.</Empty>}
        </div>
        {qo && (
          <Card style={{ marginTop: 10 }}>
            <div class="stack">
              <Pick label={`As the ${qo.name}, question`} value={formal.to} onChange={(v) => setFormal({ ...formal, to: v })} empty="Pick a minister" options={[w.pm, ...Object.values(w.offices).map((o: any) => o.holder)].filter(Boolean).map((id: string) => [id, nm(w, id)])} />
              <Field label="Question" value={formal.text} onInput={(v) => setFormal({ ...formal, text: v })} />
              <Btn onClick={() => act('q.ask', { text: formal.text, to: formal.to }, 'Question sent.')}>Send</Btn>
            </div>
          </Card>
        )}
      </Sec>
      <Sec title="Answered and dodged">
        <ul class="list">{past.map((x: any) => <li><div class="small muted">{nm(w, x.by)} asked</div><div>{x.text}</div>{x.answer ? <p class="answer">{x.answer}</p> : <b class="small err-line">{x.status === 'dodged' ? 'Dodged' : 'Expired'}</b>}</li>)}</ul>
      </Sec>
    </Page>
  );
}
