import { useEffect, useState } from 'preact/hooks';
import { useStore, act, ONLINE } from '../store';
import { Page, Sec, Card, Btn, Who, Left, Empty, LinkRow, Meter, Stamp, Seg, Field, Pick, BallotPaper } from '../ui';
import { nm, allCitizens, fmtDay } from '../../../engine/index';
import { canVote, conventionNeed, conventionSpec, SETTABLE_START, DOW } from '../../../engine/politics';

export function Elections() {
  const { world: w } = useStore();
  const all = Object.values(w.elections).sort((a: any, b: any) => b.opensAt - a.opensAt) as any[];
  const open = all.filter((e) => e.status === 'open');
  const refs = Object.values(w.proposals).filter((p: any) => p.kind === 'referendum') as any[];
  return (
    <Page kicker="One person, one vote" title="Elections" intro={w.nextGeneralAt ? <>The next general election opens in <Left at={w.nextGeneralAt - 2 * 86400000} />. The {w.config.seats} candidates with the most votes nationwide win seats.</> : 'Polls are open now.'}>
      <Sec title="Open now">
        <ul class="list">{open.map((e) => <LinkRow href={'#/election/' + e.id} title={e.title} sub={<>{Object.keys(e.candidates).length} standing, closes in <Left at={e.closesAt} /></>} />)}</ul>
        {!open.length && <Empty>No election is open.</Empty>}
      </Sec>
      {refs.length > 0 && <Sec title="Referendums"><ul class="list">{refs.map((r) => <LinkRow href={'#/p/' + r.id} title={r.title} sub={r.stage} />)}</ul></Sec>}
      <Sec title="Results"><ul class="list">{all.filter((e) => e.status === 'closed').map((e) => <LinkRow href={'#/election/' + e.id} title={e.title} sub={`Closed ${fmtDay(e.closedAt || e.closesAt)}`} />)}</ul></Sec>
    </Page>
  );
}

export function Election({ id }: { id: string }) {
  const { world: w, me } = useStore();
  const e = w.elections[id];
  const [night, setNight] = useState(false);
  if (!e) return <Page title="No such election" back={['#/elections', 'Elections']} />;
  if (e.status !== 'open') {
    return (
      <Page back={['#/elections', 'Elections']} kicker={`Closed ${fmtDay(e.closedAt || e.closesAt)}${e.results ? `, turnout ${e.results.turnout}` : ''}`} title={e.title}>
        {e.results && <div style={{ marginTop: 14 }}><Btn kind="ghost" small onClick={() => setNight(!night)}>{night ? 'Show the full count' : 'Replay election night'}</Btn></div>}
        {night ? <Night e={e} /> : <Count e={e} />}
      </Page>
    );
  }
  const mine = e.ballots[me];
  const standing = !!e.candidates[me];
  const cands = Object.values(e.candidates).sort((a: any, b: any) => w.citizens[b.id].approval - w.citizens[a.id].approval) as any[];
  return (
    <Page back={['#/elections', 'Elections']} kicker={<>Closes in <Left at={e.closesAt} /></>} title={e.title} intro={e.kind === 'general' ? `Vote for one candidate. The top ${e.winners} win seats; the rest stay in line for any seat that falls empty.` : e.voters === 'mps' ? 'Only MPs vote.' : 'Secret ballot. Final once cast.'}>
      <Sec>
        <Card kind={standing ? 'tint' : undefined}>
          {standing ? <div class="row"><b>You are standing.</b><Btn small kind="plain" onClick={() => act('election.withdraw', { election: e.id }, 'Withdrawn.')}>Withdraw</Btn></div> : <div class="row"><span>Put your name on the ballot.</span><Btn small onClick={() => act('election.stand', { election: e.id }, 'You are standing.')}>Stand</Btn></div>}
        </Card>
      </Sec>
      <Sec title="Your ballot">
        {!canVote(w, e, me) ? <Empty>You cannot vote in this one.</Empty> : (
          <BallotPaper
            head={mine ? 'Ballot cast · sealed until polls close' : 'Vote for one · secret and final'}
            options={cands.map((x) => ({
              key: x.id,
              label: <>{x.party && <span class="party-dot" style={{ background: w.parties[x.party]?.colour }} aria-hidden="true" />}{nm(w, x.id)}{x.id === me ? ' (you)' : ''}{x.incumbent && <span class="chip ink" style={{ marginLeft: 8 }}>Sitting</span>}</>,
              sub: <>{x.party ? w.parties[x.party]?.name : 'Independent'} · approval {w.citizens[x.id].approval}%</>
            }))}
            value={mine} locked={!!mine} confirm={`Cast your ballot? It can't be changed.`}
            onPick={(id) => act('election.vote', { election: e.id, candidate: id }, 'Ballot cast. +2 Influence.')}
            empty="Nobody is standing yet. Be the first."
            foot={mine ? <>You voted for <b>{nm(w, mine)}</b>. Only you can see that.</> : undefined}
          />
        )}
      </Sec>
      <Sec title="Turnout so far"><Meter value={Object.keys(e.ballots).length} max={allCitizens(w).length} /><p class="small muted">{Object.keys(e.ballots).length} of {allCitizens(w).length} have voted.</p></Sec>
    </Page>
  );
}

function Count({ e }: { e: any }) {
  const { world: w } = useStore();
  if (!e.results) return <Empty>{e.status === 'cancelled' ? 'Cancelled when Parliament was dissolved.' : 'No results.'}</Empty>;
  const r = e.results;
  const top = Math.max(1, ...Object.values(r.counts as Record<string, number>));
  return (
    <div class="stack" style={{ marginTop: 16 }}>
      {r.ranked.map((id: string, i: number) => (
        <>
          <div class={'count-row' + (i < e.winners ? ' won' : '')}>
            <div class="row small"><span><b class="tnum">{i + 1}</b> <Who id={id} /> <span class="muted">{w.citizens[id]?.party ? w.parties[w.citizens[id].party]?.name : 'Independent'}</span></span><b class="tnum">{r.counts[id]}</b></div>
            <Meter value={r.counts[id]} max={top} color={i < e.winners ? 'var(--teal)' : 'var(--rule)'} />
          </div>
          {i === e.winners - 1 && r.ranked.length > e.winners && <div class="cutline"><span>{e.kind === 'general' ? `${e.winners} seats` : 'Elected'}</span></div>}
        </>
      ))}
      {r.draw && <p class="small err-line">A tie at the line was settled by drawn lot.</p>}
      {e.kind === 'general' && <p class="small muted">Below the line, in order, is the countback list: if a seat falls empty, the next person takes it.</p>}
    </div>
  );
}

// election night: declared from last place up, the winners land with a stamp
function Night({ e }: { e: any }) {
  const { world: w } = useStore();
  const order = e.results.ranked.slice().reverse();
  const [n, setN] = useState(0);
  useEffect(() => {
    if (n >= order.length) return;
    const t = setTimeout(() => setN(n + 1), n >= order.length - e.winners ? 1400 : 600);
    return () => clearTimeout(t);
  }, [n]);
  const shown = order.slice(0, n).reverse();
  return (
    <div class="stack" style={{ marginTop: 16 }}>
      <Card kind="tint"><b>The count.</b> {n < order.length ? `Declaring ${order.length - n} more...` : 'All declared.'}</Card>
      {shown.map((id: string) => {
        const place = e.results.ranked.indexOf(id);
        const won = place < e.winners;
        return (
          <Card style={{ animation: 'rise .35s ease both', borderColor: won ? 'var(--teal)' : 'var(--rule)' }}>
            <div class="row"><span><span class="kicker" style={{ margin: 0 }}>{place + 1}{['st', 'nd', 'rd'][place] || 'th'} place</span><div class="serif" style={{ fontSize: 22 }}>{nm(w, id)}</div></span><b class="tnum serif" style={{ fontSize: 26 }}>{e.results.counts[id]}</b></div>
            {won && <Stamp label="Elected" sub={e.kind === 'general' ? 'MP' : ''} style={{ top: 6, right: 70, width: 96, height: 96 }} />}
          </Card>
        );
      })}
    </div>
  );
}

export function Convention() {
  const { world: w, me } = useStore();
  const [tab, setTab] = useState('open');
  const [newKind, setNewKind] = useState<'text' | 'setting'>('text');
  const [draft, setDraft] = useState({ text: '', setting: 'taxRate', value: '' });
  if (w.phase !== 'convention') return <Page back={['#/laws', 'Laws']} title="The Convention is over" intro="Its result is the Founding Act, L001."><Btn href="#/law/L001" style={{ marginTop: 16 }}>Read the Founding Act</Btn></Page>;
  const cl = w.convention.clauses;
  const need = conventionNeed(w);
  const done = cl.filter((c: any) => c.adopted !== null).length;
  const isOpen = (c: any) => c.adopted === null;
  const shown = cl.filter((c: any) => (tab === 'open' ? isOpen(c) : !isOpen(c)));
  const myVotes = cl.filter((c: any) => isOpen(c) && c.votes[me] !== undefined).length;
  const openCount = cl.filter(isOpen).length;
  const s = SETTABLE_START[draft.setting];
  return (
    <Page kicker={<>Closes in <Left at={w.convention.closesAt} /></>} title="The Founding Convention"
      intro={<>Write the constitution together. <b>{need} votes</b> for one option (a majority of all {allCitizens(w).length} citizens) settles a clause at once. When the Convention closes, every open clause takes its leading option. Add your own options, or table a whole new clause.</>}>
      <div class="conv-head">
        <div><b class="tnum">{done}</b><span>of {cl.length} settled</span></div>
        <div><b class="tnum">{myVotes}</b><span>of {openCount} open clauses voted on by you</span></div>
        <div><b class="tnum"><Left at={w.convention.closesAt} /></b><span>until it closes</span></div>
      </div>
      <div style={{ marginTop: 14 }}><Seg value={tab} onChange={setTab} options={[['open', `Open (${openCount})`], ['settled', `Settled (${done})`]]} /></div>
      <div class="stack" style={{ marginTop: 16 }}>
        {shown.map((c: any) => <ClauseCard c={c} n={cl.indexOf(c) + 1} need={need} />)}
        {!shown.length && <Empty>{tab === 'open' ? 'Every clause is settled.' : 'Nothing is settled yet.'}</Empty>}
      </div>
      <Sec title="Table a new clause" sub="Anything you think the realm should start with. Each citizen can table 2, and make 4 suggestions in all.">
        <Card><div class="stack">
          <Seg value={newKind} onChange={setNewKind} options={[['text', 'A rule in words'], ['setting', 'A starting setting']]} />
          {newKind === 'text' ? (
            <Field label="The rule" area value={draft.text} onInput={(v) => setDraft({ ...draft, text: v.slice(0, 300) })} placeholder="e.g. Every MP posts a weekly update in the group chat." />
          ) : (
            <div class="grid2">
              <Pick label="Setting" value={draft.setting} onChange={(v) => setDraft({ ...draft, setting: v, value: '' })} options={Object.entries(SETTABLE_START).map(([k, x]) => [k, `${x.label} (now ${w.config[k]}${x.unit})`])} />
              <Field label={`New value (${s.min} to ${s.max}${s.unit})`} type="number" value={draft.value} onInput={(v) => setDraft({ ...draft, value: v })} />
            </div>
          )}
          <Btn full disabled={newKind === 'text' ? draft.text.trim().length < 12 : draft.value === ''} onClick={() => act('convention.propose', newKind === 'text' ? { text: draft.text } : { setting: draft.setting, value: Number(draft.value) }, 'Clause tabled. Everyone can vote on it now.') && setDraft({ text: '', setting: draft.setting, value: '' })}>Table it</Btn>
        </div></Card>
      </Sec>
      {!ONLINE && <p class="small muted" style={{ marginTop: 14 }}>Demo: switch who you play as in the demo controls, or press "Others act".</p>}
    </Page>
  );
}

function ClauseCard({ c, n, need }: { c: any; n: number; need: number }) {
  const { world: w, me } = useStore();
  const cl = w.convention.clauses;
  const [add, setAdd] = useState({ text: '', value: '', dow: '1', hour: '9' });
  const [adding, setAdding] = useState(false);
  const locked = c.needs && cl.find((x: any) => x.id === c.needs).adopted === null;
  const counts = c.options.map((_: any, j: number) => Object.values(c.votes).filter((v) => v === j).length);
  const spec: any = c.kind === 'core' ? conventionSpec(c.id) : { kind: 'none' };
  const settled = c.adopted !== null;
  const voters = Object.keys(c.votes).length;
  return (
    <section class={'clause' + (settled ? ' settled' : '')}>
      <div class="clause-top">
        <span class="kicker" style={{ margin: 0 }}>Clause {n}{c.kind !== 'core' && <> · tabled by <Who id={c.by} /></>}</span>
        {settled && <span class={'chip ' + (c.kind !== 'core' && c.adopted === 1 ? 'red' : 'teal')}>{c.kind !== 'core' ? (c.adopted === 0 ? 'Adopted' : 'Rejected') : 'Settled'}</span>}
      </div>
      <h3 class="clause-q">{c.q}</h3>
      {locked ? <p class="small muted" style={{ margin: 0 }}>Opens once the head of state clause is settled.</p> : (
        <BallotPaper
          head={settled ? `Result · ${voters} voted` : c.votes[me] === undefined ? 'Vote for one · you can change it' : 'Your vote is marked · tap another to change it'}
          options={c.options.map((o: string, j: number) => ({ key: j, label: o, count: counts[j], sub: c.optBy?.[j] ? <>suggested by {nm(w, c.optBy[j])}</> : undefined }))}
          value={c.votes[me]} need={need} adopted={settled ? c.adopted : undefined} locked={settled}
          onPick={(j) => act('convention.vote', { clause: c.id, option: j }, c.votes[me] === undefined ? 'Vote cast. +2 Influence.' : 'Vote changed.')}
        />
      )}
      {!settled && !locked && spec.kind !== 'none' && c.options.length < 8 && (
        adding ? (
          <div class="clause-add">
            {spec.kind === 'name' && <Field label="Your name for the realm" value={add.text} onInput={(v) => setAdd({ ...add, text: v.slice(0, 40) })} placeholder="e.g. The Free Isles of Larkmoor" />}
            {spec.kind === 'number' && <Field label={`A number from ${spec.min} to ${spec.max}`} type="number" value={add.value} onInput={(v) => setAdd({ ...add, value: v })} />}
            {spec.kind === 'calendar' && (
              <div class="grid2">
                <Pick label="Day" value={add.dow} onChange={(v) => setAdd({ ...add, dow: v })} options={DOW.map((d, i) => [String(i), d])} />
                <Pick label="Time" value={add.hour} onChange={(v) => setAdd({ ...add, hour: v })} options={Array.from({ length: 24 }, (_, h) => [String(h), String(h).padStart(2, '0') + ':00'])} />
              </div>
            )}
            <div class="row" style={{ gap: 8, justifyContent: 'flex-end' }}>
              <Btn small kind="plain" onClick={() => setAdding(false)}>Cancel</Btn>
              <Btn small onClick={() => act('convention.suggest', { clause: c.id, text: add.text, value: Number(add.value), dow: Number(add.dow), hour: Number(add.hour) }, 'Added to the ballot.') && (setAdding(false), setAdd({ text: '', value: '', dow: '1', hour: '9' }))}>Add to the ballot</Btn>
            </div>
          </div>
        ) : <button type="button" class="clause-more" onClick={() => setAdding(true)}>+ Suggest another option</button>
      )}
    </section>
  );
}
