import { useState } from 'preact/hooks';
import { useStore, act, ONLINE, unlockIntrigue } from '../store';
import { Page, Sec, Card, Btn, Left, When, Empty, Field, Pick } from '../ui';
import { nm, allCitizens, canSeeCard, intrigueOpen, exiled, fmtTime, fmtDay, fmtLeft, DAY } from '../../../engine/index';
import { ASKS, plotNeeds } from '../../../engine/backroom';

// shown until the backroom opens: what's coming, and when
const SEALED: [string, string, string][] = [
  ['Cards', 'Secrets about real players: a quiet loan, a leaked memo, a broken promise. Hold them, leak them to the press, or use one to make a demand.', 'I'],
  ['Deals', 'Private promises between two players. Nobody else sees them, unless one of you decides to expose the other.', 'II'],
  ['Plots', 'Recruit enough of the right people and seize power for three days. Get reported and every plotter goes into exile.', 'III']
];
function Closed({ title = 'The backroom' }: { title?: string }) {
  const { world: w } = useStore();
  const opensAt = w.phase === 'running' ? w.startedAt + w.config.intrigueDelayDays * DAY : null;
  return (
    <Page dark back={['#/realm', 'The realm']} kicker="Sealed until week 3" title={title}
      intro={opensAt
        ? <>Private deals, secret cards and coups open two weeks into the first Parliament, once everyone knows how the House works.</>
        : <>Private deals, secret cards and coups open two weeks after the Founding Convention adopts the constitution.</>}>
      <div class="sealed">
        <div class="sealed-when">
          <span class="sealed-stamp" aria-hidden="true"><b>Sealed</b><small>by order</small></span>
          <div>
            <div class="kicker">{opensAt ? 'Opens' : 'Opens'}</div>
            <div class="sealed-date">{opensAt ? fmtDay(opensAt) : 'Two weeks after the constitution'}</div>
            {opensAt && <div class="small muted tnum">in {fmtLeft(w, opensAt)}</div>}
          </div>
        </div>
        <ol class="sealed-list">
          {SEALED.map(([h, t, n]) => (
            <li><span class="sealed-n" aria-hidden="true">{n}</span><div><b>{h}</b><p>{t}</p></div></li>
          ))}
        </ol>
        <p class="small muted" style={{ margin: 0 }}>Until then, the ledger already keeps a note of anything worth knowing. Some of it will be waiting for you.</p>
        {!ONLINE && w.phase === 'running' && <Btn kind="ghost" small onClick={unlockIntrigue}>Demo: unlock it now</Btn>}
      </div>
    </Page>
  );
}

export function Backroom() {
  const { world: w, me } = useStore();
  const [deal, setDeal] = useState({ to: '', text: '' });
  const [pick, setPick] = useState<Record<string, { paper: string; ask: string }>>({});
  if (!intrigueOpen(w)) return <Closed />;
  const cards = w.cards.filter((k: any) => canSeeCard(w, k, me));
  const deals = Object.values(w.deals).filter((d: any) => d.from === me || d.to === me) as any[];
  const inbound = Object.values(w.demands).filter((d: any) => d.target === me && d.status === 'sent') as any[];
  const outbound = Object.values(w.demands).filter((d: any) => d.from === me) as any[];
  const others = allCitizens(w).filter((c: any) => c.id !== me).map((c: any) => [c.id, c.name]) as any;
  const c = w.citizens[me];
  return (
    <Page dark back={['#/realm', 'The realm']} kicker="Only you can see this" title="The backroom">
      {inbound.map((d) => (
        <Card kind="warn" style={{ marginTop: 14 }}>
          <b>{nm(w, d.from)} holds a card on you.</b>
          <p class="small" style={{ margin: '4px 0' }}>“{w.cards.find((k: any) => k.id === d.card)?.title}”</p>
          <p style={{ margin: '4px 0 10px' }}>They want: <b>{ASKS[d.ask]}</b>. Answer within <Left at={d.dueAt} />, or they can leak it.</p>
          <div class="grid2"><Btn onClick={() => act('demand.answer', { id: d.id, how: 'comply' })}>Give in</Btn><Btn kind="danger" onClick={() => act('demand.answer', { id: d.id, how: 'expose' })}>Expose them</Btn></div>
        </Card>
      ))}
      <Sec title={`Your hand (${cards.length})`} sub="Secret cards come from offices you hold, deals you strike and intelligence. Leak one to hurt someone, use it to make a demand, or burn it to protect them.">
        <div class="hand">
          {cards.map((k: any) => {
            const pk = pick[k.id] || { paper: '', ask: 'pay' };
            const set = (x: any) => setPick({ ...pick, [k.id]: { ...pk, ...x } });
            return (
              <div class={'secret-card ' + k.level}>
                <div class="sc-top"><span>{k.level === 'secret' ? 'Secret' : 'Restricted'}</span><span>{k.from}</span></div>
                <p class="sc-body">{k.title}</p>
                <div class="small sc-meta">{k.about ? <>About <b>{nm(w, k.about)}</b> · </> : ''}{fmtTime(w, k.at)}</div>
                <div class="stack" style={{ gap: 6, marginTop: 8 }}>
                  <div class="grid2"><Pick value={pk.paper} onChange={(v) => set({ paper: v })} empty="To the Gazette" options={Object.values(w.papers).map((p: any) => [p.id, p.name])} /><Btn small kind="danger" onClick={() => act('card.leak', { card: k.id, paper: pk.paper }, 'Leaked.')}>Leak ({k.level === 'secret' ? 50 : 25}% named)</Btn></div>
                  {k.about && k.about !== me && <div class="grid2"><Pick value={pk.ask} onChange={(v) => set({ ask: v })} options={Object.entries(ASKS)} /><Btn small kind="ghost" onClick={() => act('card.use', { card: k.id, ask: pk.ask }, `Demand sent to ${nm(w, k.about)}.`)}>Use on {nm(w, k.about)}</Btn></div>}
                  <Btn small kind="plain" onClick={() => act('card.burn', { card: k.id }, 'Burned. Nobody will ever see it.')}>Burn it</Btn>
                </div>
              </div>
            );
          })}
          {!cards.length && <Empty>No cards. Hold an office, strike a deal, or run the Security Service to get some.</Empty>}
        </div>
      </Sec>
      {outbound.length > 0 && <Sec title="Your demands"><ul class="list">{outbound.map((d) => <li class="row"><span>{nm(w, d.target)}: {ASKS[d.ask]}</span><b class="small">{d.status === 'sent' ? 'Waiting' : d.status === 'ignored' ? 'Ignored: leak the card' : d.status}</b></li>)}</ul></Sec>}
      <Sec title="Private deals" sub="Never enforced. Accepting one gives each side a card about the other.">
        <div class="stack">
          {deals.map((d) => (
            <Card>
              <div class="small">{d.from === me ? `You offered ${nm(w, d.to)}` : `${nm(w, d.from)} offers you`} · {d.status}</div>
              <p style={{ margin: '4px 0' }}>“{d.text}”</p>
              {d.status === 'offered' && d.to === me && <div class="grid2"><Btn small onClick={() => act('deal.answer', { id: d.id, yes: true }, 'Deal struck.')}>Accept</Btn><Btn small kind="plain" onClick={() => act('deal.answer', { id: d.id, yes: false })}>Refuse</Btn></div>}
              {d.status === 'accepted' && <Btn small kind="danger" onClick={() => act('deal.expose', { id: d.id }, 'Exposed.')}>They broke it: expose</Btn>}
            </Card>
          ))}
          <Card><div class="stack">
            <Pick value={deal.to} onChange={(v) => setDeal({ ...deal, to: v })} empty="Offer a deal to..." options={others} />
            <Field label="The deal" value={deal.text} onInput={(v) => setDeal({ ...deal, text: v })} placeholder="I'll back your bill if you vote against the Holidays Bill" />
            <Btn small onClick={() => act('deal.offer', deal, 'Offered privately.') && setDeal({ to: '', text: '' })}>Offer privately</Btn>
          </div></Card>
        </div>
      </Sec>
      {c.ambition && <Sec title="Your secret ambition"><Card><b class="serif" style={{ fontSize: 22 }}>{c.ambition.text}</b><p class="small" style={{ margin: '4px 0 0' }}>Worth {c.ambition.reward} Influence if you get there this season. Revealed to everyone when it ends.</p></Card></Sec>}
    </Page>
  );
}

export function Plots() {
  const { world: w, me } = useStore();
  const [name, setName] = useState('Operation Nightjar');
  const [inv, setInv] = useState('');
  if (!intrigueOpen(w)) return <Closed title="Plots" />;
  const mine = Object.values(w.plots).find((p: any) => p.status === 'planning' && p.members.includes(me)) as any;
  const invites = Object.values(w.plots).filter((p: any) => p.status === 'planning' && p.invited[me] === 'pending') as any[];
  return (
    <Page dark back={['#/realm', 'The realm']} kicker="Treason" title="Plots" intro="Seize power: martial law for 3 days, then a Restoration election. If anyone reports it, or it is discovered, every plotter goes into exile for a week. Starting one costs 20 Influence; reporting one earns 10.">
      {w.martial && <Card kind="warn" style={{ marginTop: 14 }}><b>Martial law.</b> {nm(w, w.martial.leader)} rules until <When at={w.martial.until} />.</Card>}
      {invites.map((p) => <Card style={{ marginTop: 14 }}><b>You have been approached about {p.name}.</b><p class="small">{p.members.length} already in. Join, or report it.</p><div class="grid2"><Btn onClick={() => act('plot.answer', { plot: p.id, join: true }, 'You are in.')}>Join</Btn><Btn kind="danger" onClick={() => act('plot.answer', { plot: p.id, join: false }, 'Reported. +10 Influence.')}>Report it</Btn></div></Card>)}
      {mine ? (() => {
        const r = plotNeeds(w, mine);
        return (
          <Sec title={mine.name}>
            <Card>
              <div class="small">Plotters: {mine.members.map((m: string) => nm(w, m)).join(', ')} ({mine.members.length} of {r.need})</div>
              <div class="small">The Army: {r.armyOk ? 'will not stop you' : 'would stop you'}</div>
              <div class="small" style={{ color: 'var(--rose)' }}>Chance of discovery each day: {r.risk}%</div>
              <div class="small">Approached: {Object.entries(mine.invited).map(([k, v]) => `${nm(w, k)} (${v})`).join(', ') || 'nobody'}</div>
            </Card>
            {mine.leader === me && (
              <div class="stack" style={{ marginTop: 10 }}>
                <div class="grid2"><Pick value={inv} onChange={setInv} empty="Approach someone" options={allCitizens(w).filter((c: any) => !mine.members.includes(c.id)).map((c: any) => [c.id, c.name])} /><Btn kind="ghost" onClick={() => act('plot.invite', { plot: mine.id, target: inv }, 'Approached.')}>Approach</Btn></div>
                <Btn kind="danger" full onClick={() => act('plot.launch', { plot: mine.id })}>Launch the coup</Btn>
                <Btn kind="plain" onClick={() => act('plot.abandon', { plot: mine.id }, 'Called off.')}>Call it off</Btn>
              </div>
            )}
          </Sec>
        );
      })() : <Sec title="Start a plot"><div class="grid2"><Field label="Codename" value={name} onInput={setName} /><Btn kind="danger" style={{ alignSelf: 'end' }} onClick={() => act('plot.start', { name }, 'The plot begins.')}>Begin</Btn></div></Sec>}
    </Page>
  );
}

export function Exile() {
  const { world: w, me } = useStore();
  const [n, setN] = useState('kessmark');
  const c = w.citizens[me];
  const ex = allCitizens(w).filter((x: any) => exiled(w, x.id));
  if (!intrigueOpen(w) && !exiled(w, me) && !ex.length) return <Closed title="Exile" />;
  return (
    <Page dark back={['#/realm', 'The realm']} title="Exile" intro="Exiles cannot vote, stand or act for a week. They can seek asylum abroad and ask for a pardon.">
      {exiled(w, me) && <Sec title="You are in exile"><Card><p style={{ margin: 0 }}>Until <When at={c.exiledUntil} />.{c.asylum ? ` Sheltered by ${w.nations[c.asylum].name}.` : ''}</p><div class="grid2" style={{ marginTop: 10 }}><Pick value={n} onChange={setN} options={Object.values(w.nations).map((x: any) => [x.id, x.name])} /><Btn onClick={() => act('exile.asylum', { nation: n }, 'Asylum granted.')}>Seek asylum</Btn></div><Btn kind="ghost" full style={{ marginTop: 8 }} onClick={() => act('exile.pardonRequest', {}, 'Request sent.')}>Ask for a pardon</Btn></Card></Sec>}
      <Sec title="Exiles"><ul class="list">{ex.map((x: any) => <li class="row"><span>{x.name}<div class="small">until {fmtTime(w, x.exiledUntil)}{x.pardonAsked ? ', asked for a pardon' : ''}</div></span></li>)}</ul>{!ex.length && <Empty>Nobody is in exile.</Empty>}</Sec>
    </Page>
  );
}
