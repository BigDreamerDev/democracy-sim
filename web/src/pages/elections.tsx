import { useEffect, useState } from 'preact/hooks';
import { useStore, act } from '../store';
import { Page, Sec, Card, Btn, Who, Left, Empty, LinkRow, Meter, Stamp } from '../ui';
import { nm, allCitizens, fmtDay } from '../../../engine/index';
import { canVote } from '../../../engine/politics';

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
          <div class="ballot">
            <p>Vote for one</p>
            {cands.map((x) => (
              <button type="button" onClick={() => !mine && act('election.vote', { election: e.id, candidate: x.id }, 'Ballot cast. +2 Influence.')} disabled={!!mine} aria-pressed={mine === x.id ? 'true' : 'false'}>
                <span style={{ minWidth: 0 }}><b class="serif" style={{ fontSize: 20 }}>{nm(w, x.id)}{x.id === me ? ' (you)' : ''}</b><div class="small muted">{x.party ? w.parties[x.party]?.name : 'Independent'} · approval {w.citizens[x.id].approval}%</div></span>
                <span class="box" aria-hidden="true">{mine === x.id && <svg width="34" height="34" viewBox="0 0 24 24"><path d="M4 4l16 16M20 4L4 20" stroke-width="3" /></svg>}</span>
              </button>
            ))}
            {!cands.length && <p class="muted" style={{ fontWeight: 400 }}>Nobody is standing yet.</p>}
          </div>
        )}
        {mine && <p class="small" style={{ marginTop: 10 }}>Your ballot is sealed. Results when polls close.</p>}
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
  const cl = w.convention.clauses;
  if (w.phase !== 'convention') return <Page back={['#/laws', 'Laws']} title="The Convention is over" intro="Its result is the Founding Act, L001."><Btn href="#/law/L001" style={{ marginTop: 16 }}>Read the Founding Act</Btn></Page>;
  const done = cl.filter((c: any) => c.adopted !== null).length;
  return (
    <Page kicker={`${done} of ${cl.length} clauses settled`} title="The Founding Convention" intro={`Every citizen votes on each clause. ${w.config.conventionThreshold} votes for one option adopts it. When all are settled the realm is founded and polls open.`}>
      <div style={{ marginTop: 12 }}><Meter value={done} max={cl.length} /></div>
      <div class="stack" style={{ marginTop: 18 }}>
        {cl.map((c: any, i: number) => {
          const locked = c.needs && cl.find((x: any) => x.id === c.needs).adopted === null;
          const counts = c.options.map((_: any, j: number) => Object.values(c.votes).filter((v) => v === j).length);
          return (
            <Card kind={c.adopted !== null ? 'tint' : locked ? 'dashed' : undefined}>
              <div class="kicker" style={{ margin: 0 }}>Clause {i + 1}</div>
              <b style={{ fontSize: 17 }}>{c.q}</b>
              {locked ? <p class="small muted">Opens once the head of state clause is settled.</p> : (
                <div class="stack" style={{ marginTop: 10, gap: 6 }}>
                  {c.options.map((o: string, j: number) => (
                    <button type="button" class={'opt' + (c.votes[me] === j ? ' on' : '')} disabled={c.adopted !== null} onClick={() => act('convention.vote', { clause: c.id, option: j })}>
                      <div class="row" style={{ width: '100%' }}><b>{o}{c.adopted === j ? ' (adopted)' : ''}</b><span class="tnum small">{counts[j]} / {w.config.conventionThreshold}</span></div>
                      <Meter value={counts[j]} max={w.config.conventionThreshold} />
                    </button>
                  ))}
                </div>
              )}
            </Card>
          );
        })}
      </div>
      <p class="small muted" style={{ marginTop: 14 }}>Tip: switch who you play as in the demo controls, or press "Others act".</p>
    </Page>
  );
}
