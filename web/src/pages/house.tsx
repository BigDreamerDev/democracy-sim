import { useState } from 'preact/hooks';
import { useStore, act, getState } from '../store';
import { go, Page, Sec, Card, Btn, Who, Left, When, Empty, LinkRow, Seg, Opt, Field, Pick, Stamp } from '../ui';
import { nm, isMP, isPM, isHOS, inGovernment, mps, fmtTime, superMajority, majority, officeWithPower, hosTitle, nextAt } from '../../../engine/index';
import { leaderOfOpposition, HOS_METHODS } from '../../../engine/politics';
import { describe, KINDS, SETTABLE, canVoteOn, passCheck, PASS_RULES } from '../../../engine/proposals';
import { TEMPLATES, POWERS, FILL } from '../../../engine/offices';

const STAGE: Record<string, string> = { debate: 'Debate', vote: 'Voting', assent: 'Awaiting assent', override: 'Veto override', hos: 'With the head of state', enacted: 'Law', passed: 'Passed', failed: 'Defeated', vetoed: 'Vetoed', withheld: 'Assent refused' };
const LIVE = ['debate', 'vote', 'assent', 'override', 'hos'];
// a whole number from 0 to max, for the bill form's crowns fields
const whole = (v: string, max: number) => Math.min(max, Math.max(0, Math.round(Number(v)) || 0));

export function House() {
  const { world: w } = useStore();
  const lo = leaderOfOpposition(w);
  const bench = (gov: boolean) => w.seats.filter((s: string) => s && inGovernment(w, s) === gov);
  const live = Object.values(w.proposals).filter((p: any) => LIVE.includes(p.stage)).sort((a: any, b: any) => b.n - a.n) as any[];
  const empty = w.seats.filter((s: any) => !s).length;
  return (
    <Page kicker={w.martial ? 'Suspended under martial law' : 'Parliament'} title="The House" intro={`${w.config.seats} MPs and a Speaker. ${w.pm ? `The government needs ${majority(w)} votes to win.` : 'No government has been formed.'}`}>
      <Sec title="The chamber">
        <Card>
          <div style={{ textAlign: 'center', marginBottom: 12 }}><span aria-hidden="true" class="chair-box" /><div style={{ fontSize: 14 }}><Who id={w.speaker} />, Speaker</div></div>
          <div class="benches">
            {[true, false].map((gov) => (
              <div>
                <div class="small" style={{ fontWeight: 700, color: gov ? 'var(--teal)' : 'var(--red)', marginBottom: 6 }}>{gov ? 'Government' : 'Opposition'}, {bench(gov).length}</div>
                <div class="stack" style={{ gap: 6 }}>
                  {bench(gov).map((id: string) => {
                    const c = w.citizens[id];
                    return (
                      <a href={'#/passport/' + id} class={'bench ' + (gov ? '' : c.party ? 'opp' : 'ind')} style={{ textDecoration: 'none', color: 'inherit' }}>
                        <div class="row"><b style={{ fontSize: 15 }}>{c.name}</b><span class="small tnum">{c.approval}%</span></div>
                        <div class="small muted">{[w.pm === id ? 'PM' : '', lo === id ? 'Leader of the Opposition' : '', c.party ? w.parties[c.party].name : 'Independent'].filter(Boolean).join(', ')}</div>
                      </a>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
          {empty > 0 && <p class="small muted" style={{ margin: '10px 0 0' }}>{empty} empty seat{empty > 1 ? 's' : ''}: nobody left on the countback list.</p>}
          <div class="row" style={{ marginTop: 10, flexWrap: 'wrap', justifyContent: 'flex-start' }}>
            <a href="#/cabinet" class="small">Cabinet and coalition</a><a href="#/questions" class="small">Questions</a><a href="#/offices" class="small">Offices</a>
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

export function Proposals() {
  const { world: w } = useStore();
  const all = Object.values(w.proposals).sort((a: any, b: any) => b.n - a.n) as any[];
  return (
    <Page back={['#/house', 'The House']} title="Proposals">
      <ul class="list" style={{ marginTop: 16 }}>{all.map((p) => <LinkRow href={'#/p/' + p.id} title={p.title} sub={`${KINDS[p.kind].name}, ${STAGE[p.stage]}. By ${nm(w, p.by)}.`} />)}</ul>
    </Page>
  );
}

export function Proposal({ id }: { id: string }) {
  const { world: w, me } = useStore();
  const p = w.proposals[id];
  const [text, setText] = useState('');
  const [side, setSide] = useState('for');
  const [lob, setLob] = useState({ mp: '', amount: '10' });
  const [reason, setReason] = useState('');
  if (!p) return <Page title="No such proposal" back={['#/house', 'The House']} />;
  const book = p.stage === 'override' ? p.overrideVotes || {} : p.votes;
  const mine = book[me];
  const voters = p.voters === 'all' ? Object.keys(w.citizens) : mps(w);
  const ayes = Object.entries(book).filter(([k, v]) => v === 'aye' && voters.includes(k)).length;
  const noes = Object.entries(book).filter(([k, v]) => v === 'no' && voters.includes(k)).length;
  const steps = p.kind === 'bill' ? ['Debate', 'Vote', w.config.hos === 'monarchy' ? 'Royal Assent' : 'Signature', 'Law'] : p.kind === 'dissolution' ? ['Asked', 'Head of state decides', 'Result'] : ['Debate', 'Vote', 'Result'];
  const idx = p.kind === 'dissolution' ? (p.stage === 'hos' ? 1 : 2) : ({ debate: 0, vote: 1, assent: 2, override: 2, enacted: 3, passed: p.kind === 'bill' ? 3 : 2, failed: p.kind === 'bill' ? 1 : 2, vetoed: 2, withheld: 2 } as any)[p.stage];
  const failed = ['failed', 'vetoed', 'withheld'].includes(p.stage);
  const need = p.constitutional ? superMajority(w) : p.rule === 'seats' ? majority(w) : null;
  const blocker = officeWithPower(w, me, 'block');
  return (
    <Page back={['#/house', 'The House']} kicker={<>{KINDS[p.kind].name}{p.kind === 'bill' ? ` ${p.n}` : ''}, by <Who id={p.by} />{p.constitutional ? ', constitutional' : ''}{p.fast ? ', fast-tracked' : ''}</>} title={p.title}>
      {['enacted', 'passed', 'failed', 'vetoed'].includes(p.stage) && <Stamp label={['enacted', 'passed'].includes(p.stage) ? 'Passed' : p.stage === 'vetoed' ? 'Vetoed' : 'Defeated'} sub={p.lawRef || (p.result ? `${p.result.ayes} to ${p.result.noes}` : '')} red={failed} style={{ top: 70, right: 16, transformOrigin: '100% 0' }} />}
      {p.summary && <p class="intro">{p.summary}</p>}
      <ol class="steps" aria-label="Stages" style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))` }}>
        {steps.map((s, i) => <li aria-current={i === idx ? 'step' : undefined} class={i < idx || (i === idx && !failed && !LIVE.includes(p.stage)) ? 'done' : i === idx ? (failed ? 'bad' : 'now') : ''}><span />{s}</li>)}
      </ol>
      {p.clauses.length > 0 && (
        <Sec title={p.kind === 'referendum' ? 'If Yes wins' : 'What it does'}>
          <ol class="stack" style={{ margin: 0, padding: 0, listStyle: 'none' }}>{p.clauses.map((e: any, i: number) => <li style={{ display: 'flex', gap: 14, fontSize: 16 }}><span class="serif" style={{ fontSize: 20, width: 16 }}>{i + 1}</span>{describe(w, e)}</li>)}</ol>
        </Sec>
      )}
      {p.kind !== 'bill' && p.kind !== 'referendum' && <p class="small muted" style={{ marginTop: 14 }}>{KINDS[p.kind].blurb}</p>}

      {(p.stage === 'vote' || p.stage === 'override' || p.result) && p.kind !== 'dissolution' && (
        <Sec>
          <Card>
            <div class="row"><h2 class="h" style={{ margin: 0 }}>{p.stage === 'override' ? 'Override vote' : p.voters === 'all' ? 'The referendum' : 'The vote'}</h2>{(p.stage === 'vote' || p.stage === 'override') && <b class="small" style={{ color: 'var(--red)' }}>Closes in <Left at={p.stage === 'override' ? p.overrideEndsAt : p.voteEndsAt} /></b>}</div>
            <p class="small muted" style={{ margin: '4px 0 12px' }}>{p.stage === 'override' ? `Needs ${superMajority(w)} of ${w.config.seats} MPs.` : <>Needs {passCheck(w, p, 0, 0).need}.{p.voters === 'all' ? ' Every citizen votes. Ballots are secret.' : (p.rule || 'cast') === 'cast' && !p.constitutional ? ' A tie goes to the Speaker.' : ''}</>}</p>
            {p.voters !== 'all' ? (
              <div class="seats-row" role="img" aria-label={`${ayes} aye, ${noes} no`}>{mps(w).map((m: string) => <span title={nm(w, m)} class={'seat ' + (book[m] === 'aye' ? 'aye' : book[m] === 'no' ? 'no' : '')}>{nm(w, m).slice(0, 1)}</span>)}</div>
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
      {p.stage === 'assent' && (
        <Sec>
          <Card kind="tint">
            <h2 class="h">{w.config.hos === 'monarchy' ? 'Awaiting Royal Assent' : 'Awaiting the President'}</h2>
            <p style={{ margin: '0 0 10px' }}>{nm(w, w.hos.holder)} has until <When at={p.assentDueAt} />. If nothing happens it becomes law then.</p>
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

      {p.kind !== 'dissolution' && (
        <Sec title={`Debate (${p.speeches.length})`} sub="Hansard, the official record.">
          <ol class="list">
            {p.speeches.map((s: any) => (
              <li>
                <div class="row"><b class="serif" style={{ fontSize: 18 }}><Who id={s.by} /></b><span class="small muted">{fmtTime(w, s.at)}</span></div>
                <div class="small" style={{ fontWeight: 700, color: s.side === 'for' ? 'var(--teal)' : s.side === 'against' ? 'var(--red)' : 'var(--muted)' }}>{s.side === 'order' ? 'Order' : s.side[0].toUpperCase() + s.side.slice(1)}</div>
                <p style={{ margin: '4px 0 0', fontStyle: s.side === 'order' ? 'italic' : 'normal' }}>{s.text}</p>
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
const CLAUSES: [string, string][] = [
  ['text', 'A rule in words'], ['office', 'Create an office'], ['set', 'Change a number'], ['budget', 'Set an office budget'], ['abolish', 'Abolish an office'],
  ['permit', 'Allow banks'], ['treaty', 'Ratify a treaty'], ['breakTreaty', 'Break a treaty'], ['repeal', 'Repeal a law'],
  ['constitution', 'Change the constitution'], ['removeHos', 'Remove the head of state'], ['war', 'Declare war'], ['peace', 'Make peace'],
  ['job', 'Create a civic job (paid wage)'], ['zone', 'Add a Streets safe zone']
];
export function NewProposal({ query }: { query: URLSearchParams }) {
  const { world: w, me } = useStore();
  const init = () => {
    if (query.get('office')) return [{ t: 'office', template: query.get('office') }];
    if (query.get('repeal')) return [{ t: 'repeal', ref: query.get('repeal') }];
    if (query.get('treaty')) return [{ t: 'treaty', offer: query.get('treaty') }];
    if (query.get('banks')) return [{ t: 'permit', what: 'banks' }];
    if (query.get('custom')) return [{ t: 'office', office: { name: '', fill: 'pm', powers: [], secrecy: 'public', budget: 0 } }];
    return [{ t: 'text', text: '' }];
  };
  const [kind, setKind] = useState(query.get('kind') || 'bill');
  const [clauses, setClauses] = useState<any[]>(init);
  const tpl = query.get('office') && TEMPLATES[query.get('office')!];
  const [title, setTitle] = useState(tpl ? tpl.act.replace(/Act|Amendment/, 'Bill') : query.get('repeal') ? `Repeal of ${query.get('repeal')} Bill` : query.get('treaty') ? `${w.offers[query.get('treaty')!]?.title ?? 'Treaty'} Bill` : query.get('banks') ? 'Banking Bill' : '');
  const [summary, setSummary] = useState('');
  const [target, setTarget] = useState('');
  const [fast, setFast] = useState(false);
  const c = w.citizens[me];
  const open = Object.values(w.proposals).filter((p: any) => p.by === me && ['debate', 'vote'].includes(p.stage)).length;
  const cost = (kind === 'referendum' ? 20 : 0) + (open >= 2 ? 10 : 0) + (fast ? 15 : 0);
  const constitutional = clauses.some((e) => ['constitution', 'removeHos'].includes(e.t) || (e.t === 'office' && TEMPLATES[e.template]?.constitutional));
  const submit = () => {
    if (act('prop.new', { kind, title, summary, clauses, target, fast }, 'Put before the House.')) {
      const latest = Object.values(getState().world.proposals).sort((a: any, b: any) => b.n - a.n)[0] as any;
      go('p/' + latest.id);
    }
  };
  const kinds = Object.entries(KINDS).filter(([k]) => (k === 'confidence' || k === 'dissolution' ? isPM(w, me) : true));
  return (
    <Page back={['#/house', 'The House']} kicker="New proposal" title="Put it to the House" intro={isMP(w, me) || isPM(w, me) ? `You have ${c.influence} Influence.` : 'Only MPs can put proposals to the House. You can still draft one to see how it works.'}>
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
          {kind !== 'dissolution' && <Opt on={fast} onClick={() => setFast(!fast)} title="Fast-track: 12-hour debate" hint="Costs 15 Influence." />}
          <p class="small" style={{ fontWeight: 700, margin: '10px 0' }}>{constitutional ? `Constitutional: needs ${superMajority(w)} of ${w.config.seats} MPs. ` : ''}{cost ? `Costs ${cost} Influence.` : 'Free.'} {kind === 'dissolution' ? 'Goes straight to the head of state.' : `Debate ${fast ? 12 : w.config.debateHours}h, then ${w.config.voteHours}h to vote.`}</p>
          <Btn full onClick={submit}>Put it to the House</Btn>
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
function ClauseEditor({ e, n, onChange, onRemove }: { e: any; n: number; onChange: (e: any) => void; onRemove?: () => void }) {
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
    zone: { t: 'zone', text: '' }
  };
  const ob = e.office || {};
  const setOb = (k: string, v: any) => onChange({ ...e, template: null, office: { ...ob, [k]: v } });
  return (
    <Card>
      <div class="row"><b class="serif" style={{ fontSize: 20 }}>Clause {n}</b>{onRemove && <button type="button" class="btn plain small" onClick={onRemove}>Remove</button>}</div>
      <div class="stack" style={{ marginTop: 8 }}>
        <Pick value={e.t} onChange={(t) => onChange(defaults[t])} options={CLAUSES} />
        {e.t === 'text' && <Field label="The rule" area value={e.text} onInput={(v) => onChange({ ...e, text: v })} placeholder="e.g. The second Friday of every month is a public holiday." />}
        {e.t === 'office' && (
          <>
            <Pick label="Which office" value={e.template || 'custom'} onChange={(v) => onChange(v === 'custom' ? { t: 'office', template: null, office: { name: '', fill: 'pm', powers: [], secrecy: 'public', budget: 0 } } : { t: 'office', template: v })} options={[...Object.entries(TEMPLATES).filter(([k]) => !w.offices[k] && k !== 'whip').map(([k, t]) => [k, `${t.name} (${t.act})`] as [string, string]), ['custom', 'A new office of your own']]} />
            {e.template && <p class="small muted" style={{ margin: 0 }}>{TEMPLATES[e.template].blurb}</p>}
            {!e.template && (
              <>
                <Field label="Name" value={ob.name || ''} onInput={(v) => setOb('name', v)} placeholder="e.g. Minister for Festivals" />
                <div class="small" style={{ fontWeight: 700 }}>Who fills it?</div>
                <Seg value={ob.fill || 'pm'} onChange={(v) => setOb('fill', v)} options={Object.entries(FILL).map(([k]) => [k, ({ pm: 'PM', house: 'MPs', citizens: 'Everyone', lot: 'Lot' } as any)[k]])} />
                <div class="small" style={{ fontWeight: 700 }}>Powers</div>
                <div class="stack" style={{ gap: 6 }}>{['grant', 'question', 'files', 'fine', 'block'].map((k) => <Opt on={(ob.powers || []).includes(k)} onClick={() => setOb('powers', (ob.powers || []).includes(k) ? ob.powers.filter((x: string) => x !== k) : [...(ob.powers || []), k])} title={POWERS[k].label} right={POWERS[k].strong ? <span class="chip red">Strong</span> : undefined} />)}</div>
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
