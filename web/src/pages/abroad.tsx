// Life abroad (#/abroad): defect to another nation and play from its court, or, at home, see who has gone over,
// answer a foreign approach, work as an agent, and ransom hostages. The rules are in engine/abroad.ts.
import { useState } from 'preact/hooks';
import { useStore, act } from '../store';
import { Page, Sec, Card, Btn, Who, Left, When, Empty, Field, Pick, Opt, Meter } from '../ui';
import { isPM, hasPower, holderOf, bal, ca, canSeeCard, nm } from '../../../engine/index';
import { MOODS, PROFILES } from '../../../engine/foreign';
import { RANKS, rankOf, COOL, POLICIES, RANSOM, defectorsIn } from '../../../engine/abroad';

const moodColour = ['var(--red)', 'var(--amber)', 'var(--muted)', 'var(--teal)', 'var(--teal)'];

export function Abroad() {
  const { world: w, me } = useStore();
  const d = w.citizens[me]?.defected;
  return d ? <Court /> : <Home />;
}

// ---------- the defector's game ----------
function Court() {
  const { world: w, me } = useStore();
  const d = w.citizens[me].defected;
  const n = w.nations[d.nation];
  const p = PROFILES[d.nation];
  const r = rankOf(w, me);
  const [say, setSay] = useState('');
  const [target, setTarget] = useState('');
  const left = (k: string) => Math.max(0, (d.last?.[k] || 0) + COOL[k] - w.now);
  const can = (k: string, minRank = 0) => r >= minRank && left(k) === 0;
  const when = (k: string, minRank = 0) => (r < minRank ? `${RANKS[minRank].name} and above` : left(k) ? <>again in <Left at={w.now + left(k)} /></> : 'ready');
  const rivals = defectorsIn(w, d.nation).filter((c: any) => c.id !== me);
  const enemy = w.army?.war === d.nation;
  const home = (Object.values(w.citizens) as any[]).filter((c) => c.active && !c.bot && !c.defected && c.id !== me);
  return (
    <Page back={['#/world', 'The world']} kicker={<span style={{ color: 'var(--red)' }}>You have defected · since <When at={d.at} /></span>} title={`The court in ${p?.capital ?? n.name}`} intro={`${n.name}: ${p?.gov.toLowerCase()}, ruled by ${p?.leader}. “${p?.motto}” Your old homeland is ${MOODS[n.mood].toLowerCase()} in their eyes.`}>
      <div class="passport-abroad">
        <div>
          <div class="kicker" style={{ margin: 0 }}>Your standing at court</div>
          <div class="serif" style={{ fontSize: 34, lineHeight: 1 }}>{RANKS[r].name}</div>
          <div class="small muted">{RANKS[r].what}</div>
        </div>
        <div style={{ minWidth: 220, flex: 1 }}>
          <div class="row small"><span>Favour</span><b class="tnum">{d.favour}/100</b></div>
          <Meter value={d.favour} max={100} color="var(--gold)" />
          <div class="ladder">{RANKS.map((x, i) => <span class={i <= r ? 'on' : ''}>{x.name}<i>{x.min}</i></span>)}</div>
        </div>
      </div>
      {enemy && <Card kind="warn" style={{ marginTop: 14 }}><b>{n.name} is at war with the realm.</b> <span class="small">The front stands at {w.army.campaign.score > 0 ? '+' : ''}{w.army.campaign.score} (from the realm's side). As a Minister you can lead their army.</span></Card>}
      <Sec title="Your day at court" sub="Each action has its own wait. Favour lifts you up the ladder; failure costs a little.">
        <div class="court-grid">
          <Card><b>Serve the court</b><p class="small">A stipend of {5 + 3 * r} crowns and +3 favour.</p><div class="small muted">{when('work')}</div><Btn small disabled={!can('work')} onClick={() => act('abroad.work', {}, 'A day’s work done.')}>Serve</Btn></Card>
          <Card><b>Counsel the court</b><p class="small">Push {n.name} warmer or cooler towards your old homeland. Better odds the higher you rise.</p><div class="small muted">{when('counsel', 1)}</div><div class="grid2"><Btn small kind="ghost" disabled={!can('counsel', 1)} onClick={() => act('abroad.counsel', { stance: 'warm' }, 'You counselled friendship.')}>Friendship</Btn><Btn small kind="danger ghost" disabled={!can('counsel', 1)} onClick={() => act('abroad.counsel', { stance: 'cool' }, 'You counselled enmity.')}>Enmity</Btn></div></Card>
          <Card><b>Drill the army</b><p class="small">{n.name}'s army stands at {Math.round((n.power || 0) * 10) / 10}. Training costs you 10 and adds 0.3.</p><div class="small muted">{when('train', 1)}</div><Btn small disabled={!can('train', 1)} onClick={() => act('abroad.train', {}, 'The drill sergeants thank you.')}>Drill them</Btn></Card>
          <Card><b>Broadcast home</b><p class="small">Radio {p?.capital}: your words, in the Gazette at home.{r >= 2 ? ' As a Minister, it unsettles the realm.' : ''}</p><Field label="What you say" value={say} onInput={(v) => setSay(v.slice(0, 240))} placeholder="Citizens of the realm…" /><div class="small muted">{when('broadcast')}</div><Btn small disabled={!can('broadcast') || say.trim().length < 8} onClick={() => act('abroad.broadcast', { text: say }, 'On the air.') && setSay('')}>Broadcast</Btn></Card>
          <Card><b>Recruit an agent</b><p class="small">Send someone at home a secret offer of 30 crowns to spy for {n.name}. If they say yes, what they leak comes to you.</p><Pick value={target} onChange={setTarget} empty="Whom?" options={home.map((c) => [c.id, c.name])} /><div class="small muted">{when('recruit', 1)}</div><Btn small kind="ghost" disabled={!can('recruit', 1) || !target} onClick={() => act('abroad.recruit', { target }, 'The offer is on its way.')}>Send the offer</Btn></Card>
          {enemy && <Card kind="warn"><b>Lead their army</b><p class="small">Take command for the next battle against the realm: +2 to {n.name}'s strength.</p><div class="small muted">{when('command', 2)}</div><Btn small kind="danger" disabled={!can('command', 2)} onClick={() => act('abroad.command', {}, 'You ride at the head of their army.')}>Take command</Btn></Card>}
        </div>
      </Sec>
      <Sec title="The secrets you carried out" sub="Each one sold is printed abroad: +12 favour and 15 crowns. If you ever come home, you will be questioned at the border.">
        {d.secrets.length ? <ul class="list">{d.secrets.map((s: string, i: number) => <li class="row"><span class="small">{s}</span><Btn small kind="danger ghost" onClick={() => confirm('Sell this secret? It will be printed.') && act('abroad.sell', { secret: i }, 'Sold.')}>Sell</Btn></li>)}</ul> : <Empty>You have no secrets to sell. Agents you recruit can send you more.</Empty>}
      </Sec>
      <Sec title="Chancellor's orders" sub={r === 3 ? `You set ${n.name}'s policy towards the realm, once a week.` : `The defector with the most favour, at 80 or more, is ${n.name}'s Chancellor and sets its policy towards the realm.`}>
        {r === 3 ? (
          <div class="stack">
            <div class="small muted">{when('policy', 3)}</div>
            {Object.entries(POLICIES).map(([k, label]) => <Opt onClick={() => can('policy', 3) && confirm(`${label}?`) && act('abroad.policy', { act: k }, 'Your orders go out.')} title={label} hint={k === 'war' ? 'Their army marches on the realm.' : k === 'peace' ? 'Only while at war. You lose a little favour.' : k === 'aid' ? '30 crowns to the realm, and they warm to it. You lose a little favour.' : 'They will remember who signed it.'} />)}
          </div>
        ) : <Card kind="dashed">You are {d.favour < 80 ? `${80 - d.favour} favour short` : 'outranked by another defector'}.</Card>}
      </Sec>
      {rivals.length > 0 && <Sec title="Other defectors at court"><ul class="list">{rivals.map((c: any) => <li class="row"><Who id={c.id} /><span class="small">{RANKS[Math.max(0, rankOf(w, c.id))].name} · {c.defected.favour} favour</span></li>)}</ul></Sec>}
      <Sec title="Your record abroad">
        <ul class="list small">{(d.deeds || []).map((x: any) => <li class="row"><span>{x.what}</span><span class="muted"><When at={x.at} /></span></li>)}</ul>
        {!(d.deeds || []).length && <Empty>Nothing yet.</Empty>}
      </Sec>
      <Sec title="Leave">
        <div class="grid2">
          <Card><b>Move on</b><p class="small">Defect again, to another nation. You keep your secrets and a third of your favour.</p><MoveOn /></Card>
          <Card><b>Come home</b><p class="small">After two days abroad. −5 approval{d.sold ? ', and three days held at the border: you sold secrets' : ''}.</p><Btn small kind="ghost" onClick={() => confirm('Go home to the realm?') && act('defect.return', {}, 'Welcome home.')}>Come home</Btn></Card>
        </div>
      </Sec>
    </Page>
  );
}
function MoveOn() {
  const { world: w, me } = useStore();
  const d = w.citizens[me].defected;
  const [to, setTo] = useState('');
  return <div class="stack"><Pick value={to} onChange={setTo} empty="Where to?" options={Object.values(w.nations).filter((n: any) => n.id !== d.nation).map((n: any) => [n.id, n.name])} /><Btn small kind="plain" disabled={!to} style={{ alignSelf: 'flex-start' }} onClick={() => confirm(`Leave for ${w.nations[to].name}?`) && act('defect.go', { nation: to }, 'You are on the road.')}>Go</Btn></div>;
}

// ---------- at home: defecting, approaches, agents, hostages ----------
function Home() {
  const { world: w, me } = useStore();
  const [to, setTo] = useState('');
  const me_ = w.citizens[me];
  const all = (Object.values(w.citizens) as any[]).filter((c) => c.active && c.defected);
  const offers = (Object.values(w.approaches || {}) as any[]).filter((a) => a.to === me && a.status === 'open' && a.until > w.now);
  const held = (w.hostages || []).filter((h: any) => h.status === 'held' && h.until > w.now);
  const canRansom = isPM(w, me) || hasPower(w, me, 'envoy') || holderOf(w, 'treasury') === me;
  const cards = w.cards.filter((k: any) => canSeeCard(w, k, me));
  const n = w.nations[to];
  return (
    <Page back={['#/world', 'The world']} kicker="Across the border" title="Life abroad" intro="Some go over to the other side. Some are bought. Some are held hostage. Here is who, and what you can do about it.">
      {offers.map((a) => (
        <Card kind="warn" style={{ marginTop: 14 }}><div class="stack">
          <div class="kicker" style={{ margin: 0 }}>Only you can see this</div>
          <b class="serif" style={{ fontSize: 20 }}>{w.nations[a.nation].name} wants you to work for them.</b>
          <span class="small">{a.hostage ? 'Your captors make you an offer before you go home. ' : a.by ? <>The offer comes through <Who id={a.by} />. </> : ''}{a.crowns} crowns now and 10 a week. You would leak what you see to them, and the Security Service might find you. It lapses in <Left at={a.until} />.</span>
          <div class="grid2"><Btn kind="danger" onClick={() => confirm('Become a foreign agent?') && act('agent.answer', { approach: a.id, yes: true }, 'You are on their books now.')}>Accept</Btn><Btn kind="plain" onClick={() => act('agent.answer', { approach: a.id, yes: false }, 'Refused, quietly.')}>Refuse quietly</Btn></div>
          <Btn kind="ghost" small onClick={() => act('agent.answer', { approach: a.id, yes: false, report: true }, 'Reported. The realm thanks you.')}>Refuse and report it (+4 approval)</Btn>
        </div></Card>
      ))}
      {me_.agentOf && (
        <Sec title={`You are an agent of ${w.nations[me_.agentOf]?.name}`} sub="Only you can see this. You are paid 10 a week, and now and then something you can see leaks on its own.">
          <Card kind="warn"><div class="stack">
            {cards.length ? <ul class="list small">{cards.map((k: any) => <li class="row"><span>{k.title}</span><Btn small kind="danger ghost" onClick={() => confirm('Leak this card abroad?') && act('agent.leak', { card: k.id }, 'Sent. 10 crowns.')}>Leak (10)</Btn></li>)}</ul> : <span class="small muted">You hold no cards to leak.</span>}
            <Btn small kind="plain" onClick={() => confirm('Stop working for them? You can still be caught for two weeks.') && act('agent.quit', {}, 'You have stopped.')}>Stop working for them</Btn>
          </div></Card>
        </Sec>
      )}
      <Sec title="Hostages" sub={`Held abroad for a week under terms of peace. The PM, the Chancellor or the Foreign Minister can pay ${RANSOM} from the Treasury to bring them home early.`}>
        {held.length ? <ul class="list">{held.map((h: any) => <li class="row"><span><Who id={h.who} /> in {PROFILES[h.nation]?.capital}, {w.nations[h.nation]?.name}<div class="small muted">Released in <Left at={h.until} /></div></span>{canRansom && <Btn small onClick={() => act('hostage.ransom', { hostage: h.id }, 'Ransom paid.')}>Pay {RANSOM}</Btn>}</li>)}</ul> : <Empty>Nobody is held abroad.</Empty>}
      </Sec>
      <Sec title="Defectors" sub="Who has gone over, and how far they have risen at their new court.">
        {all.length ? <ul class="list">{all.map((c) => <li class="row"><span><Who id={c.id} /> in {w.nations[c.defected.nation]?.name}<div class="small muted">Since <When at={c.defected.at} /></div></span><span class="small"><b>{RANKS[Math.max(0, rankOf(w, c.id))].name}</b> · {c.defected.favour} favour</span></li>)}</ul> : <Empty>Nobody has defected.</Empty>}
      </Sec>
      <Sec title="Defect" sub="Leave the realm and play from a foreign court. You give up your seat, your offices and your party, and lose 10 approval. You take whatever secrets you can see with you.">
        <Card><div class="stack">
          <Pick value={to} onChange={setTo} empty="To which nation?" options={Object.values(w.nations).map((x: any) => [x.id, `${x.name} (${MOODS[x.mood].toLowerCase()} to the realm)`])} />
          {n && <span class="small">{PROFILES[to]?.gov}, ruled from {PROFILES[to]?.capital} by {PROFILES[to]?.leader}. <span style={{ color: moodColour[n.mood] }}>{n.mood <= 1 ? 'They hate the realm, so they will welcome you warmly.' : n.mood >= 3 ? 'They like the realm: taking you in embarrasses them, and you start low.' : 'They will take you in, warily.'}</span> You would start with about {10 + (4 - n.mood) * 5 + Math.min(5, cards.length) * 2} favour.</span>}
          {(isPM(w, me) || w.hos?.holder === me) && <span class="small muted">The Prime Minister and the head of state must step down first.</span>}
          <Btn kind="danger" disabled={!to} onClick={() => confirm(`Defect to ${n.name}? You lose your seat, offices and party. This is public.`) && act('defect.go', { nation: to }, `You cross the border into ${n.name}.`)}>Defect</Btn>
        </div></Card>
      </Sec>
    </Page>
  );
}
