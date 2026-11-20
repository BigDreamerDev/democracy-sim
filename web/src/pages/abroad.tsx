// Life abroad (#/abroad): defect to another nation and play from its court, or, at home, see who has gone over,
// answer a foreign approach, work as an agent, and ransom hostages. The rules are in engine/abroad.ts.
import { lim } from '../../../engine/limits';
import { StoryText, plainHeadline } from '../StoryText';
import { GazettePoster, posterChoices } from '../PosterView';
import { useState } from 'preact/hooks';
import { useStore, act } from '../store';
import { Page, Sec, Card, Btn, Who, Left, When, Empty, Field, Pick, Opt, Meter } from '../ui';
import { isPM, hasPower, holderOf, bal, ca, canSeeCard, nm } from '../../../engine/index';
import { MOODS, PROFILES } from '../../../engine/foreign';
import { RANKS, rankOf, COOL, POLICIES, RANSOM, defectorsIn, throneOf, BID_COOL, BUY_PRICE, threatened, exileNeed, HOMES, NATURALISE_DAYS, businessFor } from '../../../engine/abroad';
import { canSecurity, canExtradite, canSeize, extraditeOdds, snatchOdds, OP_COST, EXTRADITE_COOL, SNATCH_COOL } from '../../../engine/homeland';
import { TREATIES, PROVINCES as PROVINCES_ } from '../../../engine/foreign';
import { canPostWanted, invasionStrength, INVASION_PREP, WANTED_DAYS } from '../../../engine/exiles';

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
          <div class="visa-line small">{HOMES[d.home || 0].name} in {p?.capital} · {d.naturalised ? `citizen of ${n.name}` : 'resident alien'} · day {Math.floor((w.now - d.at) / 86400000) + 1} abroad</div>
        </div>
        <div style={{ minWidth: 220, flex: 1 }}>
          <div class="row small"><span>Favour</span><b class="tnum">{d.favour}/100</b></div>
          <Meter value={d.favour} max={100} color="var(--gold)" />
          <div class="ladder">{RANKS.map((x, i) => <span class={i <= r ? 'on' : ''}>{i === 4 ? 'Throne' : x.name}{i < 4 && <i>{x.min}</i>}</span>)}</div>
        </div>
      </div>
      {d.turnOffer && d.turnOffer.until > w.now && <TurnOffer />}
      {d.plant && <PlantDesk />}
      <FromHome />
      <Business />
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
      <Life />
      <Throne />
      <Heir />
      <ExileGov />
      <Invasion />
      <ExilePress />
      {canPostWanted(w, me) && <PostWanted />}
      <Stir />
      <Succession />
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
          <Card><b>Come home</b><p class="small">After two days abroad. {d.plant ? 'Your cover is blown and the realm learns the truth: +10 approval and 5 Influence.' : d.amnesty ? 'Under the Prime Minister’s amnesty: no approval lost, no questions at the border.' : <>−{d.naturalised ? 8 : 5} approval{d.sold ? ', and three days held at the border: you sold secrets' : ''}.</>}</p><Btn small kind="ghost" onClick={() => confirm('Go home to the realm?') && act('defect.return', {}, 'Welcome home.')}>Come home</Btn></Card>
        </div>
      </Sec>
    </Page>
  );
}
// the court's business of the day: one matter, two answers
function Business() {
  const { world: w, me } = useStore();
  const d = w.citizens[me].defected;
  const b = businessFor(w, me);
  if (!b) return null;
  const next = (d.last?.audience || 0) + COOL.audience;
  const done = next > w.now;
  return (
    <Sec title="The court's business" sub="One matter a day. What you say is remembered, at court and at home.">
      <Card kind="tint"><div class="stack">
        <b class="serif" style={{ fontSize: 20 }}>{done ? 'You have dealt with today’s business.' : b.q}</b>
        {done ? <span class="small muted">More business <Left at={next} />.</span> : <div class="grid2">{b.opts.map((o, i) => <Btn kind={i ? 'plain' : undefined} onClick={() => act('abroad.audience', { choice: i }, 'The court takes note.')}>{o.label}</Btn>)}</div>}
      </div></Card>
    </Sec>
  );
}
// a home in the capital, and citizenship of the new country
function Life() {
  const { world: w, me } = useStore();
  const d = w.citizens[me].defected;
  const n = w.nations[d.nation];
  const p = PROFILES[d.nation];
  const r = rankOf(w, me);
  const h = d.home || 0;
  const days = (w.now - d.at) / 86400000;
  return (
    <Sec title={`Your life in ${p?.capital ?? n.name}`} sub={`${p?.gov} · exports ${p?.exports?.toLowerCase()} · “${p?.motto}”`}>
      <div class="grid2">
        <Card><b>Your home</b>
          <ul class="list small" style={{ margin: '6px 0' }}>{HOMES.map((x, i) => <li class="row"><span>{i === h ? <b>{x.name}</b> : x.name}<div class="muted">{x.what}</div></span>{i === h ? <span class="chip teal">Yours</span> : i > h ? <Btn small kind="ghost" disabled={i === 3 && r < 2} onClick={() => act('abroad.settle', { level: i }, `You move into ${x.name.toLowerCase()}.`)}>{x.cost - HOMES[h].cost} crowns</Btn> : null}</li>)}</ul>
        </Card>
        <Card><b>Citizenship</b>
          {d.naturalised ? <p class="small">You are a citizen of {n.name}. The realm cannot ask for you back. Coming home would cost you more face.</p>
            : d.plant ? <p class="small">Your handlers forbid it. A sworn citizen is no use to the Service.</p>
            : <><p class="small">Swear allegiance to {n.name}: the realm can no longer extradite you, and the court trusts you more (+1 favour each time you serve). Needs {NATURALISE_DAYS} days here, 40 favour and 20 crowns.</p>
              <Btn small disabled={days < NATURALISE_DAYS || d.favour < 40} onClick={() => confirm(`Swear allegiance to ${n.name}? It is public, and the realm will not forget.`) && act('abroad.naturalise', {}, `You are a citizen of ${n.name}.`)}>Swear allegiance</Btn>
              {days < NATURALISE_DAYS && <span class="small muted">Possible <When at={d.at + NATURALISE_DAYS * 86400000} />.</span>}</>}
        </Card>
      </div>
    </Sec>
  );
}
// what the old homeland is doing about you
function FromHome() {
  const { world: w, me } = useStore();
  const d = w.citizens[me].defected;
  const n = w.nations[d.nation];
  const c = w.citizens[me];
  const home = (d.deeds || []).filter((x: any) => x.home).slice(0, 5);
  const risk = Math.round(extraditeOdds(w, c) * 100);
  return (
    <Sec title="Word from home" sub="The realm has not forgotten you.">
      {d.amnesty && <Card kind="tint" style={{ marginBottom: 10 }}><div class="row"><span><b>The Prime Minister offers you an amnesty.</b> <span class="small">Come home, and no questions will be asked.</span></span><Btn small onClick={() => confirm('Accept the amnesty and go home?') && act('defect.return', {}, 'Welcome home.')}>Go home</Btn></div></Card>}
      <Card><div class="stack">
        <span class="small">{d.naturalised ? `As a citizen of ${n.name}, you cannot be extradited.` : n.ruler?.id === me ? 'Nobody extradites a head of state.' : `If the realm asks ${n.name} to hand you over, there is about a ${risk}% chance they will. More favour makes them less willing.`} {(d.home || 0) >= 2 ? 'Your guards make you hard to snatch.' : 'A manor or better comes with guards.'}{d.seized ? ` The Treasury seized ${d.seized.amt} crowns of yours.` : ''}</span>
        {home.length ? <ul class="list small">{home.map((x: any) => <li class="row"><span>{x.what}</span><span class="muted"><When at={x.at} /></span></li>)}</ul> : <span class="small muted">Nothing yet. Silence, for now.</span>}
      </div></Card>
    </Sec>
  );
}
// a plant's real orders: only the plant sees this
function PlantDesk() {
  const { world: w, me } = useStore();
  const d = w.citizens[me].defected;
  const r = rankOf(w, me);
  const left = (k: string) => Math.max(0, (d.last?.[k] || 0) + COOL[k] - w.now);
  return (
    <Sec title="Your real orders" sub="Only you, the Prime Minister and the Director of the Security Service know. To everyone else, you are a traitor.">
      <Card kind="warn"><div class="stack">
        <span class="small">You went over on the orders of <Who id={d.plant.by} />. Rise at court, report home and do quiet damage. Come home whenever you like: the truth comes out and the realm thanks you. Every week there is a chance the court finds you out, and more as you rise.</span>
        <div class="grid2">
          <div><Btn small disabled={left('report') > 0} onClick={() => act('abroad.report', {}, 'Your report is on its way home.')}>Report home</Btn><div class="small muted">{left('report') ? <>Again <Left at={w.now + left('report')} /></> : 'A secret card for the PM and the Director. Couriers are sometimes caught.'}</div></div>
          <div><Btn small kind="danger" disabled={left('sabotage') > 0 || r < 1} onClick={() => confirm('Sabotage their army? One time in five you are caught.') && act('abroad.sabotage', {}, 'The arsenal burns.')}>Sabotage the army</Btn><div class="small muted">{r < 1 ? 'Adviser and above.' : left('sabotage') ? <>Again <Left at={w.now + left('sabotage')} /></> : '−0.5 to their army. Risky.'}</div></div>
        </div>
      </div></Card>
    </Sec>
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
        {t.way === 'elect' && <Field label={`Campaign spending (0–${lim(w, 'campaignMax')} crowns)`} type="number" value={spend} onInput={setSpend} />}
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
  const plantOffers = (Object.values(w.plants || {}) as any[]).filter((p) => p.to === me && p.status === 'offered' && p.until > w.now);
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
      {plantOffers.map((p: any) => (
        <Card kind="warn" style={{ marginTop: 14 }}><div class="stack">
          <div class="kicker" style={{ margin: 0 }}>Only you can see this · the Security Service</div>
          <b class="serif" style={{ fontSize: 20 }}>Go over to {w.nations[p.nation]?.name}, for us.</b>
          <span class="small"><Who id={p.by} /> asks you to defect to {w.nations[p.nation]?.name} as the Service’s plant. To everyone else you will be a traitor: you lose your seat, offices and party, and 10 approval. Abroad, you report home and sabotage them. Come home whenever you like and the truth comes out: +10 approval and 5 Influence. 30 crowns of cover money. Lapses <Left at={p.until} />.</span>
          <div class="grid2"><Btn kind="danger" onClick={() => confirm(`Defect to ${w.nations[p.nation]?.name} as a plant? It is public, and it starts now.`) && act('plant.answer', { plant: p.id, yes: true }, 'You cross the border. Good luck.')}>Go over</Btn><Btn kind="plain" onClick={() => act('plant.answer', { plant: p.id, yes: false }, 'You said no.')}>Say no</Btn></div>
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
      <Wanted />
      <Invasion />
      <ExileGov />
      <ExilePress />
      <Sec title="Hostages" sub={`Held abroad for a week under terms of peace. The PM, the Chancellor or the Foreign Minister can pay ${RANSOM} from the Treasury to bring them home early.`}>
        {held.length ? <ul class="list">{held.map((h: any) => <li class="row"><span><Who id={h.who} /> in {PROFILES[h.nation]?.capital}, {w.nations[h.nation]?.name}<div class="small muted">Released in <Left at={h.until} /></div></span>{canRansom && <Btn small onClick={() => act('hostage.ransom', { hostage: h.id }, 'Ransom paid.')}>Pay {RANSOM}</Btn>}</li>)}</ul> : <Empty>Nobody is held abroad.</Empty>}
      </Sec>
      <Sec title="Defectors" sub="Who has gone over, and how far they have risen at their new court.">
        {all.length ? <ul class="list">{all.map((c) => <DefectorRow c={c} />)}</ul> : <Empty>Nobody has defected.</Empty>}
      </Sec>
      <SendOver />
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

// one defector, and what the realm's officers can do about them
function DefectorRow({ c }: { c: any }) {
  const { world: w, me } = useStore();
  const d = c.defected;
  const n = w.nations[d.nation];
  const sec = canSecurity(w, me), ext = canExtradite(w, me), tre = canSeize(w, me), pm = isPM(w, me);
  const ours = !!d.plant;
  const extIn = d.extraditionAt ? Math.max(0, d.extraditionAt + EXTRADITE_COOL - w.now) : 0;
  const snIn = d.snatchAt ? Math.max(0, d.snatchAt + SNATCH_COOL - w.now) : 0;
  const any = (sec || ext || tre || pm) && c.id !== me;
  return (
    <li class="stack" style={{ gap: 6 }}>
      <div class="row"><span><Who id={c.id} /> in {n?.name}{ours && <span class="chip teal" style={{ marginLeft: 6 }}>Our plant</span>}{d.naturalised && <span class="chip" style={{ marginLeft: 6 }}>Citizen of {n?.name}</span>}{d.amnesty && <span class="chip" style={{ marginLeft: 6 }}>Amnesty offered</span>}<div class="small muted">Since <When at={d.at} />{d.consort ? ' · married into the royal family' : ''} · {HOMES[d.home || 0].name.toLowerCase()} in {PROFILES[d.nation]?.capital}</div></span><span class="small"><b>{rankOf(w, c.id) === 4 ? n.ruler.title : RANKS[Math.max(0, rankOf(w, c.id))].name}</b> · {d.favour} favour</span></div>
      {any && (
        <div class="row" style={{ gap: 6, justifyContent: 'flex-start', flexWrap: 'wrap' }}>
          {ext && <Btn small kind="ghost" disabled={!!extIn || d.naturalised || n?.ruler?.id === c.id} onClick={() => confirm(`Ask ${n.name} to hand ${c.name} over? A refusal cools them towards us.`) && act('defector.extradite', { target: c.id }, 'The request is delivered.')}>{extIn ? <>Ask again <Left at={w.now + extIn} /></> : `Extradite (${Math.round(extraditeOdds(w, c) * 100)}%)`}</Btn>}
          {sec && !ours && <Btn small kind="ghost" onClick={() => act('intel.discredit', { target: c.id }, 'The whispers begin.')}>Smear at court ({OP_COST.discredit})</Btn>}
          {sec && <Btn small kind="danger ghost" disabled={!!snIn} onClick={() => confirm(`Send a snatch squad for ${c.name}? About ${Math.round(snatchOdds(w, c) * 100)}% chance. Failure is a public scandal.`) && act('intel.snatch', { target: c.id }, 'The squad is on its way.')}>{snIn ? <>Snatch again <Left at={w.now + snIn} /></> : `Snatch (${OP_COST.snatch}, ${Math.round(snatchOdds(w, c) * 100)}%)`}</Btn>}
          {tre && !d.seized && !(ours && sec) && <Btn small kind="ghost" onClick={() => confirm(`Seize half of ${c.name}'s money for the Treasury?`) && act('defector.seize', { target: c.id }, 'Seized.')}>Seize their money</Btn>}
          {pm && !d.naturalised && (d.amnesty ? <Btn small kind="plain" onClick={() => act('defector.amnesty', { target: c.id, on: false }, 'Amnesty withdrawn.')}>Withdraw amnesty</Btn> : <Btn small kind="plain" onClick={() => act('defector.amnesty', { target: c.id, on: true }, 'Amnesty offered.')}>Offer amnesty</Btn>)}
        </div>
      )}
    </li>
  );
}
// the Security Service sends someone over
function SendOver() {
  const { world: w, me } = useStore();
  const [who, setWho] = useState('');
  const [to, setTo] = useState('');
  if (!canSecurity(w, me)) return null;
  const pool = (Object.values(w.citizens) as any[]).filter((c) => c.active && !c.bot && !c.defected && c.id !== me);
  const plants = (Object.values(w.plants || {}) as any[]).filter((p) => p.status === 'offered' || p.status === 'abroad');
  const ops = (w.ops || []).slice(0, 8);
  return (
    <Sec title="Send someone over" sub={`Secret. Ask a citizen to defect on the Service's orders: they rise at a foreign court, report home and sabotage it. ${OP_COST.plant} cover money from the budget (${bal(w, 'office:security')} left); returned if they say no.`}>
      <Card kind="warn"><div class="stack">
        <div class="grid2"><Pick value={who} onChange={setWho} empty="Whom?" options={pool.map((c) => [c.id, c.name])} /><Pick value={to} onChange={setTo} empty="Where?" options={Object.values(w.nations).map((x: any) => [x.id, x.name])} /></div>
        <Btn disabled={!who || !to} onClick={() => act('intel.plant', { target: who, nation: to }, 'The request goes out, in private.')}>Ask them</Btn>
        {plants.length > 0 && <ul class="list small">{plants.map((p) => <li class="row"><span><Who id={p.to} /> → {w.nations[p.nation]?.name}</span><span class="muted">{p.status === 'offered' ? <>Waiting for an answer, lapses <Left at={p.until} /></> : w.citizens[p.to]?.defected?.plant?.id === p.id ? `In place: ${w.citizens[p.to].defected.favour} favour` : 'Home'}</span></li>)}</ul>}
        {ops.length > 0 && <><b class="small">Operations log</b><ul class="list small">{ops.map((o: any) => <li class="row"><span>{({ discredit: 'Smear', snatch: 'Snatch', plant: 'Plant' } as any)[o.kind]}: {o.text}</span><span class="muted"><When at={o.at} /></span></li>)}</ul></>}
      </div></Card>
    </Sec>
  );
}

// a plant found out: the court's offer, only they see it
function TurnOffer() {
  const { world: w, me } = useStore();
  const d = w.citizens[me].defected;
  const n = w.nations[d.nation];
  return (
    <Card kind="warn" style={{ marginTop: 14 }}><div class="stack">
      <div class="kicker" style={{ margin: 0 }}>Only you can see this</div>
      <b class="serif" style={{ fontSize: 20 }}>The court of {n.name} knows what you are.</b>
      <span class="small">They will not throw you out, if you work for them now. Your reports home will say what they tell you to, your sabotage will be staged, and the Service will never know. 20 crowns and +15 favour. Refuse, and you are expelled as a spy. Decide by <When at={d.turnOffer.until} />.</span>
      <div class="grid2"><Btn kind="danger" onClick={() => confirm('Betray the Security Service?') && act('abroad.turn', { yes: true }, 'You work for them now.')}>Work for them</Btn><Btn kind="plain" onClick={() => confirm('Refuse? They will throw you out.') && act('abroad.turn', { yes: false }, 'You are thrown out.')}>Refuse</Btn></div>
    </div></Card>
  );
}
// wanted posters: public, and at home anyone may try their luck
function Wanted() {
  const { world: w, me } = useStore();
  const open = (Object.values(w.wanted || {}) as any[]).filter((x) => x.status === 'open' && x.until > w.now);
  if (!open.length) return null;
  return (
    <Sec title="Wanted" sub="Prices put on the heads of the realm's officials by nations abroad. Seize one and carry them over the border, and the reward is yours. Fail, and you are held for three days.">
      <div class="court-grid">{open.map((x) => (
        <div class="card wanted-poster"><div class="kicker" style={{ margin: 0 }}>Wanted by {w.nations[x.nation]?.name}</div><b class="serif" style={{ fontSize: 24 }}><Who id={x.target} /></b><span class="small">{x.reward} crowns, delivered to {PROFILES[x.nation]?.capital}. Posted by {nm(w, x.by)}. Comes down <Left at={x.until} />.</span>
          {x.target !== me && !w.citizens[me]?.defected && !x.tried.includes(me) && <Btn small kind="danger" onClick={() => confirm(`Try to seize ${nm(w, x.target)}? It is public either way.`) && act('wanted.claim', { wanted: x.id }, 'Done.')}>Try to seize them</Btn>}
          {x.tried.includes(me) && <span class="small muted">You tried.</span>}
        </div>
      ))}</div>
    </Sec>
  );
}
function PostWanted() {
  const { world: w, me } = useStore();
  const d = w.citizens[me].defected;
  const [f, setF] = useState({ target: '', reward: '40' });
  const officials = (Object.values(w.citizens) as any[]).filter((c) => c.active && !c.bot && !c.defected && (c.id === w.pm || c.id === w.hos?.holder || (w.seats || []).includes(c.id) || Object.values(w.offices).some((o: any) => o.holder === c.id)));
  return (
    <Sec title="Put a price on a head" sub={`From ${w.nations[d.nation].name}'s treasury (${bal(w, 'nation:' + d.nation)} crowns). Anyone at home may try to seize them and carry them over the border, to be held here as a hostage. The poster stays up ${WANTED_DAYS} days; unclaimed, the money comes back.`}>
      <Card><div class="grid2"><Pick value={f.target} onChange={(v) => setF({ ...f, target: v })} empty="Which official?" options={officials.map((c) => [c.id, c.name])} /><Field label={`Reward (10–${lim(w, 'wantedMax')})`} type="number" value={f.reward} onInput={(v) => setF({ ...f, reward: v })} /></div><Btn small kind="danger" style={{ marginTop: 8 }} disabled={!f.target} onClick={() => act('abroad.wanted', { target: f.target, reward: Number(f.reward) }, 'The posters go up.')}>Post it</Btn></Card>
    </Sec>
  );
}
// the exile press: one paper per court, written by every defector there
function ExilePress() {
  const { world: w, me } = useStore();
  const d = w.citizens[me]?.defected;
  const [name, setName] = useState('');
  const [st, setSt] = useState<any>({ headline: '', body: '', poster: '' });
  const papers = Object.values(w.exilePress || {}) as any[];
  const mine = d && w.exilePress?.[d.nation];
  if (!papers.length && !d) return null;
  const stories = w.stories.filter((x: any) => x.exile).slice(0, 8);
  return (
    <Sec title="The exile press" sub="Papers written by the defectors at each court. Each week the most-cheered story is printed in the Gazette at home.">
      {d && !mine && <Card><b>Found a paper for the exiles in {w.nations[d.nation].name}</b><div class="grid2" style={{ marginTop: 6 }}><Field label="Its name" value={name} onInput={(v) => setName(v.slice(0, 40))} placeholder="The Free Voice" /><Btn style={{ alignSelf: 'end' }} disabled={name.trim().length < 4} onClick={() => act('exile.paper', { name }, 'The presses roll.')}>Found it</Btn></div></Card>}
      {mine && <Card><b>Write for {mine.name}</b><Field label="Headline" value={st.headline} onInput={(v) => setSt({ ...st, headline: v.slice(0, 120) })} /><Field label={`Story (${st.body.length} of ${lim(w, 'storyLength')})`} area value={st.body} onInput={(v) => setSt({ ...st, body: v.slice(0, lim(w, 'storyLength')) })} /><span class="small muted">*bold*, _italic_, ~strike~; a blank line between paragraphs.</span><Pick label="Print a poster with it" value={st.poster || ''} onChange={(v) => setSt({ ...st, poster: v })} options={posterChoices(w)} /><Btn small disabled={st.headline.trim().length < 5} onClick={() => act('exile.write', { ...st, poster: st.poster || null }, 'Printed.') && setSt({ headline: '', body: '', poster: '' })}>Print it</Btn></Card>}
      {papers.length > 0 && <p class="small muted">{papers.map((p) => `${p.name} (${PROFILES[p.nation]?.capital})`).join(' · ')}</p>}
      {stories.length ? <ul class="list">{stories.map((x: any) => <li class="stack" style={{ gap: 2 }}><b>{plainHeadline(x.headline)}</b>{x.poster && <GazettePoster p={x.poster} width={100} float="right" />}<span class="small muted">{w.exilePress?.[x.exile]?.name ?? 'The exile press'} · <Who id={x.by} /> · <When at={x.at} /></span>{x.body && <StoryText small text={x.body.length > 600 ? x.body.slice(0, 600) + '…' : x.body} />}<span><Btn small kind="ghost" disabled={x.by === me} onClick={() => act('press.cheer', { story: x.id })}>{x.cheers.includes(me) ? 'Cheered' : 'Cheer'} ({x.cheers.length})</Btn></span></li>)}</ul> : <Empty>Nothing printed yet.</Empty>}
    </Sec>
  );
}
// the invasion: prepared in public, abroad; at home, a warning (and the Service's chance to strike first)
function Invasion() {
  const { world: w, me } = useStore();
  const v = w.invasion;
  const d = w.citizens[me]?.defected;
  const [name, setName] = useState('');
  const [amt, setAmt] = useState('20');
  const need = lim(w, 'invasionDefectors');
  if (!v) {
    if (!d) return null;
    const here = defectorsIn(w, d.nation).length;
    const n = w.nations[d.nation];
    const hostile = n.mood <= 1 || !!n.ruler;
    return (
      <Sec title="Invade the homeland" sub={`With ${need} defectors at a court that hates the realm (or that one of you rules), a Minister or higher can raise an invasion. ${INVASION_PREP / 86400000} days to prepare; then the exiles land with foreign troops, the host declares war, and the realm has 12 hours to choose a side.`}>
        <Card kind="dashed"><div class="stack">
          <span class="small">{here} of {need} defectors here. {n.name} is {hostile ? 'ready to lend its army' : `${MOODS[n.mood].toLowerCase()} to the realm, and will not lend its army`}.</span>
          {here >= need && hostile && rankOf(w, me) >= 2 && <><Field label="Name the force" value={name} onInput={(x) => setName(x.slice(0, 60))} placeholder="The Army of Return" /><Btn kind="danger" disabled={name.trim().length < 4} onClick={() => confirm('Begin preparing an invasion? It is public at once.') && act('exile.invade', { name }, 'The muster begins.')}>Raise the invasion</Btn></>}
        </div></Card>
      </Sec>
    );
  }
  const n = w.nations[v.nation];
  const inIt = v.members.includes(me);
  const here = d?.nation === v.nation;
  const lead = v.leader === me;
  const ready = w.now >= v.readyAt;
  return (
    <Sec title={v.name} sub={`An invasion of the homeland, mustering in ${PROFILES[v.nation]?.capital}, ${n.name}. Led by ${nm(w, v.leader)}.`}>
      <Card kind="warn"><div class="stack">
        <span class="small">{v.members.length} exiles under arms ({need} needed): {v.members.map((x: string) => nm(w, x)).join(', ')}. War chest {v.chest} crowns, {v.drills} drills. Strength +{invasionStrength(w, v)} on the night. {ready ? 'Ready to sail.' : <>Ready <Left at={v.readyAt} />.</>}</span>
        {here && !inIt && <Btn kind="danger" onClick={() => act('exile.muster', {}, 'You take up arms.')}>Join the invasion</Btn>}
        {inIt && <div class="grid2"><Btn kind="ghost" onClick={() => act('exile.drill', {}, 'Drilled.')}>Drill (once a day)</Btn><div class="row" style={{ gap: 6 }}><Field label="Crowns" type="number" value={amt} onInput={setAmt} /><Btn small onClick={() => act('exile.fund', { amount: Number(amt) }, 'Into the chest.')}>Fund</Btn></div></div>}
        {lead && <div class="grid2"><Btn kind="danger" disabled={!ready || v.members.length < need} onClick={() => confirm('Launch the invasion? Every member sails home tonight, and the host declares war.') && act('exile.launch', {}, 'The ships sail.')}>Launch the invasion</Btn><Btn kind="plain" onClick={() => confirm('Call it off? The chest is refunded.') && act('exile.standDown', {}, 'Called off.')}>Call it off</Btn></div>}
        {!d && canSecurity(w, me) && <Btn kind="danger ghost" onClick={() => act('intel.disrupt', {}, 'Agents are on their way.')}>Disrupt the muster (25 from the Service)</Btn>}
        {!d && !canSecurity(w, me) && <span class="small muted">The Security Service can strike at the muster. Extraditing or snatching its members weakens it too.</span>}
      </div></Card>
    </Sec>
  );
}

// stir up a province of the realm from abroad
function Stir() {
  const { world: w, me } = useStore();
  const d = w.citizens[me].defected;
  const [pid, setPid] = useState('');
  const ours = Object.keys(w.provinces || {}).filter((id) => w.provinces[id].owner === 'realm');
  if (!ours.length) return null;
  const next = (d.last?.stir || 0) + 2 * 86400000;
  return (
    <Sec title="Stir up the provinces" sub="Smuggle pamphlets and agitators into a province the realm holds. At 3 unrest it rises; if the realm does not answer in 2 days it breaks away to the nation that claims it. Claimed by your host? Twice as fast. Adviser and above, every 2 days.">
      <Card><div class="stack">
        <ul class="list small">{ours.map((id) => <li class="row"><span>{PROVINCES_[id]?.name}</span><span class="muted">{w.provinces[id].revolt ? 'In revolt' : `Unrest ${w.provinces[id].agitation || 0} of 3`}{PROVINCES_[id]?.claims.includes(d.nation) ? ` · claimed by ${w.nations[d.nation].name}` : ''}</span></li>)}</ul>
        <div class="grid2"><Pick value={pid} onChange={setPid} empty="Which province?" options={ours.filter((id) => !w.provinces[id].revolt).map((id) => [id, PROVINCES_[id]?.name ?? id])} /><Btn kind="danger" disabled={!pid || rankOf(w, me) < 1 || next > w.now} onClick={() => act('abroad.stir', { province: pid }, 'The pamphlets go over the border.')}>{next > w.now ? <>Again <Left at={next} /></> : 'Stir it up'}</Btn></div>
      </div></Card>
    </Sec>
  );
}

// a royal child abroad, and an empty throne at home
function Succession() {
  const { world: w, me } = useStore();
  const d = w.citizens[me].defected;
  const e = (Object.values(w.elections) as any[]).find((x) => x.kind === 'hos' && x.status === 'open');
  if (!d.child || w.config.hos !== 'monarchy' || !e) return null;
  const on = !!e.candidates[me];
  return (
    <Sec title="The throne is empty" sub={`The realm is choosing a new monarch. ${d.child.name}, your child and heir of two houses, has a claim.`}>
      <Card kind="warn"><div class="row"><span class="small">{on ? <>Your claim is on the ballot. The polls close <When at={e.closesAt} />. Win, and you come home to take the throne.</> : `Put ${d.child.name}'s claim before the realm. You stand in the child's name; if the realm chooses you, you come home to reign.`}</span>{!on && <Btn kind="danger" onClick={() => confirm(`Claim the throne in the name of ${d.child.name}?`) && act('abroad.succession', { election: e.id }, 'Your claim is before the realm.')}>Claim the throne</Btn>}</div></Card>
    </Sec>
  );
}
