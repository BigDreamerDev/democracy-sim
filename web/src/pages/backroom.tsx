import { lim } from '../../../engine/limits';
import { useState } from 'preact/hooks';
import { useStore, act, ONLINE, unlockIntrigue } from '../store';
import { Page, Sec, Card, Btn, Left, When, Empty, Field, Pick } from '../ui';
import { nm, allCitizens, canSeeCard, intrigueOpen, exiled, fmtTime, fmtDay, fmtLeft, DAY, hasPower, holderOf } from '../../../engine/index';
import { ASKS, plotNeeds, watcher } from '../../../engine/backroom';
import { MOODS } from '../../../engine/foreign';

// shown until the backroom opens: what's coming, and when
const SEALED: [string, string, string][] = [
  ['Cards', 'Secrets about real players: a quiet loan, a leaked memo, a broken promise. Hold them, leak them to the press, or use one to make a demand.', 'I'],
  ['Deals', 'Private promises between two players. Nobody else sees them, unless one of you decides to expose the other.', 'II'],
  ['Plots', 'Recruit the right people, find the money and a backer, and seize power. Then try to keep it. Get reported and every plotter goes into exile.', 'III']
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
  const [amt, setAmt] = useState('30');
  const [nat, setNat] = useState('');
  const [probe, setProbe] = useState('');
  if (!intrigueOpen(w)) return <Closed title="Plots" />;
  const mine = Object.values(w.plots).find((p: any) => p.status === 'planning' && p.members.includes(me)) as any;
  const invites = Object.values(w.plots).filter((p: any) => p.status === 'planning' && p.invited[me] === 'pending') as any[];
  const watched = Object.values(w.plots).filter((p: any) => p.status === 'planning' && p.informed && watcher(w) === me) as any[];
  const director = (!!w.offices.security || !!w.acts?.security) && (hasPower(w, me, 'intel') || (w.pm === me && !holderOf(w, 'security')));
  const answer = (p: any, how: string, done: string) => act('plot.answer', { plot: p.id, how }, done);
  return (
    <Page dark back={['#/realm', 'The realm']} kicker="Treason" title="Plots" intro="Recruit, prepare, and seize power. With two of the General, a foreign backer and a full war chest, a coup succeeds at once. Otherwise the realm gets a night to pick sides. If it is reported or found, every plotter goes into exile for a week. Starting one costs 20 Influence.">
      {(w.coup || w.regime || w.transition) && <Card kind="warn" style={{ marginTop: 14 }}><b>{w.coup ? 'A coup is under way.' : w.regime ? `${nm(w, w.regime.leader)} holds the realm.` : 'A provisional government is in charge.'}</b> <a href="#/regime">See it</a>.</Card>}
      {invites.map((p) => (
        <Card style={{ marginTop: 14 }}>
          <b>You have been approached about {p.name}.</b>
          <p class="small">{p.members.length} already in. Join it; say no and keep the secret; report it, which ends it and exiles them (+10 Influence); or join and quietly tell the Security Service, who can raid it whenever they choose.</p>
          <div class="grid2"><Btn onClick={() => answer(p, 'join', 'You are in.')}>Join</Btn><Btn kind="ghost" onClick={() => answer(p, 'silent', 'You said no, and nothing else.')}>Say no, keep quiet</Btn><Btn kind="danger" onClick={() => answer(p, 'report', 'Reported. +10 Influence.')}>Report it</Btn><Btn kind="danger ghost" onClick={() => answer(p, 'inform', 'You are in, and the Service knows.')}>Join as an informer</Btn></div>
        </Card>
      ))}
      {watched.map((p) => (
        <Card kind="tint" style={{ marginTop: 14 }}>
          <b>You have someone inside {p.name}.</b>
          <p class="small">Plotters: {p.members.map((m: string) => nm(w, m)).join(', ')}. Your informer{p.informers.length > 1 ? 's' : ''}: {p.informers.map((m: string) => nm(w, m)).join(', ')}. If they launch while you are watching, it fails. Raid now and everyone but your informers goes into exile.</p>
          <Btn kind="danger" full onClick={() => act('plot.raid', { plot: p.id }, 'Raided.')}>Raid it</Btn>
        </Card>
      ))}
      {mine ? (() => {
        const r = plotNeeds(w, mine);
        const isLeader = mine.leader === me;
        return (
          <Sec title={mine.name}>
            <Card>
              <div class="small">Plotters: {mine.members.map((m: string) => nm(w, m)).join(', ')} ({mine.members.length} of {r.need})</div>
              <div class="small">Approached: {Object.entries(mine.invited).map(([k, v]) => `${nm(w, k)} (${v === 'silent' ? 'said no' : v})`).join(', ') || 'nobody'}</div>
              <div class="small" style={{ marginTop: 6 }}><b>Preparations</b> ({r.preps} of 3; two make it swift)</div>
              <div class="small">The General: {r.hasGeneral ? 'with you' : w.offices.army ? 'not with you' : 'there is no Army'}</div>
              <div class="small">A foreign backer: {mine.backer ? w.nations[mine.backer].name : 'none'}{Object.keys(mine.asked || {}).filter((n) => mine.asked[n] === 'no').length ? ` (refused by ${Object.keys(mine.asked).filter((n) => mine.asked[n] === 'no').map((n) => w.nations[n].name).join(', ')})` : ''}</div>
              <div class="small">The war chest: {r.chest} of {lim(w, 'warChestFull')} crowns</div>
              <div class="small" style={{ marginTop: 6 }}>{r.swift ? 'Launch now and it is over in a night: no vote, low legitimacy (5).' : `Launch now and the realm gets 12 hours to declare. You start with ${mine.members.length}${r.pretext ? ', +1 for a realm already in trouble' : ''}${mine.backer ? ', +1 for your backer' : ''}${r.chest >= lim(w, 'warChestFull') / 2 ? `, +${r.chest >= lim(w, 'warChestFull') ? 2 : 1} for the chest` : ''}. The more you win by, the more legitimacy you start with.`}</div>
              <div class="small" style={{ color: 'var(--rose)', marginTop: 6 }}>Chance of discovery each day: {r.risk}%</div>
            </Card>
            <div class="stack" style={{ marginTop: 10 }}>
              <div class="grid2"><Field label={`Pay into the chest (refunded if it is called off)`} type="number" value={amt} onInput={setAmt} /><Btn kind="ghost" style={{ alignSelf: 'end' }} onClick={() => act('plot.pay', { plot: mine.id, amount: Number(amt) }, 'Paid in.')}>Pay in</Btn></div>
              {isLeader && (
                <>
                  <div class="grid2"><Pick value={inv} onChange={setInv} empty="Approach someone" options={allCitizens(w).filter((c: any) => !mine.members.includes(c.id) && !mine.invited[c.id]).map((c: any) => [c.id, c.name])} /><Btn kind="ghost" onClick={() => act('plot.invite', { plot: mine.id, target: inv }, 'Approached.')}>Approach</Btn></div>
                  {!mine.backer && <div class="grid2"><Pick value={nat} onChange={setNat} empty="Ask a nation to back you" options={Object.values(w.nations).filter((n: any) => !mine.asked?.[n.id]).map((n: any) => [n.id, `${n.name} (${MOODS[n.mood].toLowerCase()})`])} /><Btn kind="ghost" onClick={() => act('plot.backer', { plot: mine.id, nation: nat }, 'Asked.')}>Ask</Btn></div>}
                  <p class="small muted" style={{ margin: 0 }}>A backer wants 40 crowns from the Treasury once you win, and a refusal makes the plot easier to find.</p>
                  <Btn kind="danger" full onClick={() => act('plot.launch', { plot: mine.id })}>Launch the coup</Btn>
                  <Btn kind="plain" onClick={() => act('plot.abandon', { plot: mine.id }, 'Called off. The chest is refunded.')}>Call it off</Btn>
                </>
              )}
            </div>
          </Sec>
        );
      })() : <Sec title="Start a plot"><div class="grid2"><Field label="Codename" value={name} onInput={setName} /><Btn kind="danger" style={{ alignSelf: 'end' }} onClick={() => act('plot.start', { name }, 'The plot begins.')}>Begin</Btn></div></Sec>}
      {director && (
        <Sec title="Investigate" sub="As head of the Security Service: one name a day. You learn, truthfully, whether they are in a plot. Only you see the answer.">
          <div class="grid2"><Pick value={probe} onChange={setProbe} empty="Pick a name" options={allCitizens(w).filter((c: any) => c.id !== me).map((c: any) => [c.id, c.name])} /><Btn kind="ghost" onClick={() => act('security.investigate', { target: probe }, 'The answer is on your desk.')}>Investigate</Btn></div>
          <ul class="list small" style={{ marginTop: 8 }}>{(w.probes || []).map((p: any) => <li><span><b>{nm(w, p.target)}</b>: {p.yes ? 'is in a plot' : 'clean'}<div class="muted">{fmtTime(w, p.at)}</div></span></li>)}</ul>
        </Sec>
      )}
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
    <Page dark back={['#/realm', 'The realm']} title="Exile" intro="Exiles cannot vote, stand or act until their exile ends. They can seek asylum abroad and ask for a pardon.">
      {exiled(w, me) && <Sec title="You are in exile"><Card><p style={{ margin: 0 }}>Until <When at={c.exiledUntil} />.{c.asylum ? ` Sheltered by ${w.nations[c.asylum].name}.` : ''}</p><div class="grid2" style={{ marginTop: 10 }}><Pick value={n} onChange={setN} options={Object.values(w.nations).map((x: any) => [x.id, x.name])} /><Btn onClick={() => act('exile.asylum', { nation: n }, 'Asylum granted.')}>Seek asylum</Btn></div><Btn kind="ghost" full style={{ marginTop: 8 }} onClick={() => act('exile.pardonRequest', {}, 'Request sent.')}>Ask for a pardon</Btn></Card></Sec>}
      <Sec title="Exiles"><ul class="list">{ex.map((x: any) => <li class="row"><span>{x.name}<div class="small">until {fmtTime(w, x.exiledUntil)}{x.pardonAsked ? ', asked for a pardon' : ''}</div></span></li>)}</ul>{!ex.length && <Empty>Nobody is in exile.</Empty>}</Sec>
    </Page>
  );
}
