// Life abroad (#/abroad): defect to another nation and play from its court, or, at home, see who has gone over,
// answer a foreign approach, work as an agent, and ransom hostages. The rules are in engine/abroad.ts.
import { useState } from 'preact/hooks';
import { useStore, act } from '../store';
import { Page, Sec, Card, Btn, Who, Left, When, Empty, Field, Pick, Opt, Meter } from '../ui';
import { isPM, hasPower, holderOf, bal, ca, canSeeCard, nm } from '../../../engine/index';
import { MOODS, PROFILES } from '../../../engine/foreign';
import { RANKS, rankOf, COOL, POLICIES, RANSOM, defectorsIn, throneOf, BID_COOL, BUY_PRICE, threatened, exileNeed } from '../../../engine/abroad';
import { TREATIES } from '../../../engine/foreign';

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
    <Page back={['#/world', 'The world']} kicker={<span style={{ color: 'var(--red)' }}>You have defected · since <When at={d.at} /></span>} title={r === 4 ? `${n.ruler.title}` : `The court in ${p?.capital ?? n.name}`} intro={`${n.name}: ${p?.gov.toLowerCase()}, ruled by ${n.ruler ? `${nm(w, n.ruler.id)}${n.ruler.id === me ? ' (you)' : ''}, once of the realm` : p?.leader}. “${p?.motto}” Your old homeland is ${MOODS[n.mood].toLowerCase()} in their eyes.`}>
      <div class="passport-abroad">
        <div>
          <div class="kicker" style={{ margin: 0 }}>Your standing at court</div>
          <div class="serif" style={{ fontSize: 34, lineHeight: 1 }}>{r === 4 ? n.ruler.title : RANKS[r].name}{d.consort && r !== 4 ? ', royal consort' : ''}</div>
          <div class="small muted">{r === 4 ? `You rule ${n.name}. Policy every 3 days, treaties for the realm, 20 a week. Watch for palace revolts.` : RANKS[r].what}</div>
        </div>
        <div style={{ minWidth: 220, flex: 1 }}>
          <div class="row small"><span>Favour</span><b class="tnum">{d.favour}/100</b></div>
          <Meter value={d.favour} max={100} color="var(--gold)" />
          <div class="ladder">{RANKS.map((x, i) => <span class={i <= r ? 'on' : ''}>{i === 4 ? 'Throne' : x.name}{i < 4 && <i>{x.min}</i>}</span>)}</div>
        </div>
      </div>
      {enemy && <Card kind="warn" style={{ marginTop: 14 }}><b>{n.name} is at war with the realm.</b> <span class="small">The front stands at {w.army.campaign.score > 0 ? '+' : ''}{w.army.campaign.score} (from the realm's side). Ministers and above can lead their army.</span></Card>}
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
      <Throne />
      <Heir />
      <ExileGov />
      <Sec title="The secrets you carried out" sub="Each one sold is printed abroad: +12 favour and 15 crowns. If you ever come home, you will be questioned at the border.">
        {d.secrets.length ? <ul class="list">{d.secrets.map((s: string, i: number) => <li class="row"><span class="small">{s}</span><Btn small kind="danger ghost" onClick={() => confirm('Sell this secret? It will be printed.') && act('abroad.sell', { secret: i }, 'Sold.')}>Sell</Btn></li>)}</ul> : <Empty>You have no secrets to sell. Agents you recruit can send you more.</Empty>}
      </Sec>
      <Sec title={r === 4 ? 'Your orders' : "Chancellor's orders"} sub={r === 4 ? `As ${n.ruler.title} you set policy towards the realm every three days.` : r === 3 ? `You set ${n.name}'s policy towards the realm, once a week.` : `The defector with the most favour, at 80 or more, is ${n.name}'s Chancellor and sets its policy towards the realm.`}>
        {r >= 3 ? (
          <div class="stack">
            <div class="small muted">{when('policy', 3)}</div>
            {Object.entries(POLICIES).map(([k, label]) => <Opt onClick={() => can('policy', 3) && confirm(`${label}?`) && act('abroad.policy', { act: k }, 'Your orders go out.')} title={label} hint={k === 'war' ? 'Their army marches on the realm.' : k === 'peace' ? 'Only while at war. You lose a little favour.' : k === 'aid' ? '30 crowns to the realm, and they warm to it. You lose a little favour.' : 'They will remember who signed it.'} />)}
          </div>
        ) : <Card kind="dashed">You are {d.favour < 80 ? `${80 - d.favour} favour short` : 'outranked by another defector'}.</Card>}
      </Sec>
      {rivals.length > 0 && (
        <Sec title="Rivals at court" sub={<>Intrigue once a day: turn the court against a rival and take their favour (better odds if you have more), or expose a secret they are hoarding. {d.last?.intrigue && w.now - d.last.intrigue < 86400000 ? <>Next intrigue in <Left at={d.last.intrigue + 86400000} />.</> : ''}</>}>
          <ul class="list">{rivals.map((c: any) => <li class="row"><span><Who id={c.id} /><div class="small muted">{rankOf(w, c.id) === 4 ? n.ruler.title : RANKS[Math.max(0, rankOf(w, c.id))].name} · {c.defected.favour} favour · {c.defected.secrets.length} secret{c.defected.secrets.length === 1 ? '' : 's'}</div></span><span class="row" style={{ gap: 6 }}><Btn small kind="ghost" onClick={() => act('abroad.intrigue', { target: c.id, kind: 'steal' }, 'The whispers begin.')}>Steal favour</Btn><Btn small kind="danger ghost" onClick={() => act('abroad.intrigue', { target: c.id, kind: 'expose' }, 'You go digging.')}>Expose</Btn></span></li>)}</ul>
        </Sec>
      )}
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
// the road to the top: marry, stand, buy or seize, depending on the nation
function Throne() {
  const { world: w, me } = useStore();
  const d = w.citizens[me].defected;
  const n = w.nations[d.nation];
  const t = throneOf(n.id);
  const [spend, setSpend] = useState('20');
  const [kind, setKind] = useState('trade');
  const mine = n.ruler?.id === me;
  const bidIn = d.bidAt ? Math.max(0, d.bidAt + BID_COOL - w.now) : 0;
  const need = t.way === 'buy' ? 50 : t.way === 'marry' ? 60 : 65;
  if (mine) {
    return (
      <Sec title="Your reign" sub={`Ruler since ${new Date(n.ruler.since).toUTCString().slice(0, 11)}. A palace revolt is less likely the more favour you keep.`}>
        <div class="grid2">
          <Card><b>Offer the realm a treaty</b><p class="small">It arrives as an offer your old homeland can ratify.</p><Pick value={kind} onChange={setKind} options={TREATIES.map((x) => [x.kind, x.title])} /><Btn small style={{ marginTop: 8 }} onClick={() => act('abroad.offer', { kind }, 'The offer is sent.')}>Send the offer</Btn></Card>
          <Card><b>Give it up</b><p class="small">Step down. You stay at court with your favour.</p><Btn small kind="plain" onClick={() => confirm('Give up the throne?') && act('abroad.abdicate', {}, 'You have stepped down.')}>Abdicate</Btn></Card>
        </div>
      </Sec>
    );
  }
  return (
    <Sec title={`The road to ${t.title}`} sub={t.how}>
      <Card kind={n.ruler ? 'warn' : 'tint'}><div class="stack">
        {n.ruler ? <span class="small"><Who id={n.ruler.id} /> rules here now. A bid against them is harder.</span> : <span class="small">The throne is held by {PROFILES[n.id]?.leader}.</span>}
        {t.way === 'marry' && !d.consort && <>
          <span class="small">First, a royal marriage: 50 favour or more, and better odds with more. Every two days.</span>
          <Btn kind="ghost" disabled={d.favour < 50} onClick={() => act('abroad.marry', {}, 'You have proposed.')}>Propose marriage</Btn>
        </>}
        {t.way === 'elect' && <Field label="Campaign spending (0–100 crowns)" type="number" value={spend} onInput={setSpend} />}
        <span class="small muted">Needs {need} favour (you have {d.favour}){t.way === 'marry' ? ' and a royal marriage' : ''}{t.way === 'buy' ? `, and ${BUY_PRICE} crowns (you have ${bal(w, ca(me))})` : ''}{t.way === 'seize' ? `. Each army drill you have done helps (${d.drills || 0} so far)` : ''}.{bidIn ? <> Next bid in <Left at={w.now + bidIn} />.</> : ''}</span>
        <Btn kind={t.way === 'seize' ? 'danger' : undefined} disabled={d.favour < need || !!bidIn || (t.way === 'marry' && !d.consort)} onClick={() => confirm(t.way === 'seize' ? 'Seize power? If you fail you are thrown out of the country.' : 'Make your bid?') && act('abroad.bid', { spend: Number(spend) }, 'The die is cast.')}>{t.way === 'marry' ? 'Claim the succession' : t.way === 'elect' ? 'Stand for election' : t.way === 'buy' ? `Buy the guilds (${BUY_PRICE})` : 'Seize power'}</Btn>
      </div></Card>
    </Sec>
  );
}
// a royal child abroad, and a claim to the realm's own throne in their name
function Heir() {
  const { world: w, me } = useStore();
  const d = w.citizens[me].defected;
  const [name, setName] = useState('');
  if (!d.consort) return null;
  const n = w.nations[d.nation];
  const reign = w.crown?.reign;
  const claimable = w.config.hos === 'monarchy' && reign?.crownedAt && !reign.claim;
  return (
    <Sec title="Your heir" sub="A child of the royal house of your new country, and of the realm.">
      {d.child ? (
        <Card kind="tint"><div class="stack">
          <b class="serif" style={{ fontSize: 22 }}>{d.child.name}, heir of {n.name}</b>
          <span class="small">Born <When at={d.child.born} />.{' '}{w.config.hos === 'monarchy' ? `In ${d.child.name}'s name you can claim the realm's own throne. ${n.name} will recognise the claim (+2); win it and you come home to be crowned.` : 'The realm has no throne to claim while it is a republic.'}</span>
          {claimable && <Btn kind="danger" onClick={() => confirm(`Press a dynastic claim to the throne of the realm in ${d.child.name}'s name?`) && act('abroad.dynasty', {}, 'The claim is pressed. The realm has two days.')}>Press a dynastic claim</Btn>}
          {reign?.claim && <span class="small muted">A claim is already being pressed at home. <a href="#/hos">See it</a>.</span>}
        </div></Card>
      ) : (
        <Card><div class="stack">
          <span class="small">Hope for an heir: an even chance every two days.</span>
          <Field label="Name the child" value={name} onInput={(v) => setName(v.slice(0, 24))} placeholder="e.g. Edda" />
          <Btn small disabled={name.trim().length < 2} onClick={() => act('abroad.child', { name }, 'We shall see.')}>Hope for an heir</Btn>
        </div></Card>
      )}
    </Sec>
  );
}
// a government in exile: declared abroad, backed at home, and one day led home
function ExileGov() {
  const { world: w, me } = useStore();
  const g = w.exileGov;
  const c = w.citizens[me];
  const [name, setName] = useState('The Free Government of the Realm');
  if (!g) {
    if (!c.defected || rankOf(w, me) < 1) return null;
    return (
      <Sec title="A government in exile" sub="Declare that you, not the government at home, are the realm's rightful government. Citizens at home can back you; with enough backing you can lead the exiles home.">
        <Card><div class="stack"><Field label="Its name" value={name} onInput={(v) => setName(v.slice(0, 60))} /><Btn kind="danger ghost" onClick={() => act('exile.declare', { name }, 'Declared.')}>Declare it</Btn></div></Card>
      </Sec>
    );
  }
  const members = g.members.filter((id: string) => w.citizens[id]?.active);
  const backers = g.backers.filter((id: string) => w.citizens[id]?.active && !w.citizens[id].defected);
  const total = members.length + backers.length;
  const lead = g.leader === me;
  const inIt = g.members.includes(me) || g.backers.includes(me);
  const here = c.defected?.nation === g.nation;
  return (
    <Sec title={g.name} sub={<>A government in exile, sitting in {w.nations[g.nation]?.name}, led by <Who id={g.leader} />. To lead it home it needs {exileNeed(w)} members and backers in all; it has {total}.</>}>
      <Card kind="warn"><div class="stack">
        <Meter value={total} max={exileNeed(w)} color="var(--red)" />
        <span class="small">Members abroad: {members.map((id: string) => nm(w, id)).join(', ')}. Backers at home: {backers.length ? backers.map((id: string) => nm(w, id)).join(', ') : 'none yet'}.</span>
        {!inIt && (c.defected ? here : true) && <Btn kind="danger ghost" onClick={() => act('exile.join', {}, c.defected ? 'You have joined.' : 'You back it, in public.')}>{c.defected ? 'Join it' : 'Back it in public (−2 approval)'}</Btn>}
        {inIt && <Btn small kind="plain" onClick={() => confirm(lead ? 'Dissolve the government in exile?' : 'Leave it?') && act('exile.leave', {}, lead ? 'Dissolved.' : 'You have left.')}>{lead ? 'Dissolve it' : 'Leave it'}</Btn>}
        {lead && <Btn kind="danger" disabled={total < exileNeed(w)} onClick={() => confirm('Lead the exiles home? Every member returns, and a coup night begins.') && act('exile.return', {}, 'You are going home.')}>Lead the exiles home</Btn>}
      </div></Card>
    </Sec>
  );
}
// sheltering in a friendly embassy, when the realm turns on its people
function Refuge() {
  const { world: w, me } = useStore();
  const c = w.citizens[me];
  const [n, setN] = useState('');
  const friends = (Object.values(w.nations) as any[]).filter((x) => x.mood >= 3);
  if (c.refuge) {
    const host = w.nations[c.refuge.nation];
    return (
      <Sec title={`Sheltering in the ${host?.name} embassy`} sub="Out of reach of arrest and the Realm Jail. You cannot take part in politics while you are here.">
        <Card kind="tint"><div class="grid2">
          <Btn kind="plain" onClick={() => confirm('Leave the embassy? You will be within reach again.') && act('asylum.leave', {}, 'You step outside.')}>Leave the embassy</Btn>
          <Btn kind="danger ghost" onClick={() => confirm(`Take safe passage to ${host?.name} and defect?`) && act('defect.go', { nation: c.refuge.nation }, 'Safe passage granted.')}>Take safe passage abroad</Btn>
        </div></Card>
      </Sec>
    );
  }
  if (!threatened(w)) return null;
  return (
    <Sec title="Take refuge" sub="Under a coup, a regime or a law to jail citizens, a friendly nation's embassy will take you in. Nobody can arrest you there.">
      {friends.length ? <Card><div class="grid2"><Pick value={n} onChange={setN} empty="Which embassy?" options={friends.map((x) => [x.id, x.name])} /><Btn style={{ alignSelf: 'end' }} disabled={!n} onClick={() => act('asylum.claim', { nation: n }, 'The embassy doors close behind you.')}>Take refuge</Btn></div></Card> : <Empty>No nation is friendly enough to take you in.</Empty>}
    </Sec>
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
      <Refuge />
      <ExileGov />
      <Sec title="Hostages" sub={`Held abroad for a week under terms of peace. The PM, the Chancellor or the Foreign Minister can pay ${RANSOM} from the Treasury to bring them home early.`}>
        {held.length ? <ul class="list">{held.map((h: any) => <li class="row"><span><Who id={h.who} /> in {PROFILES[h.nation]?.capital}, {w.nations[h.nation]?.name}<div class="small muted">Released in <Left at={h.until} /></div></span>{canRansom && <Btn small onClick={() => act('hostage.ransom', { hostage: h.id }, 'Ransom paid.')}>Pay {RANSOM}</Btn>}</li>)}</ul> : <Empty>Nobody is held abroad.</Empty>}
      </Sec>
      <Sec title="Defectors" sub="Who has gone over, and how far they have risen at their new court.">
        {all.length ? <ul class="list">{all.map((c) => <li class="row"><span><Who id={c.id} /> in {w.nations[c.defected.nation]?.name}<div class="small muted">Since <When at={c.defected.at} />{c.defected.consort ? ' · married into the royal family' : ''}</div></span><span class="small"><b>{rankOf(w, c.id) === 4 ? w.nations[c.defected.nation].ruler.title : RANKS[Math.max(0, rankOf(w, c.id))].name}</b> · {c.defected.favour} favour</span></li>)}</ul> : <Empty>Nobody has defected.</Empty>}
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
