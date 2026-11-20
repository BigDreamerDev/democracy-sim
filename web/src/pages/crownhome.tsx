// The Crown at home (engine/imperium.ts) and trials (engine/trials.ts): the Sovereign's desk on the Crown page, the
// proclamation and triumph banners on every page, the list of trials and a trial's own page (#/trial/<id>).
import { useState } from 'preact/hooks';
import { useStore, act } from '../store';
import { Page, Sec, Card, Btn, Who, Left, When, Empty, Field, Pick, LinkRow } from '../ui';
import { nm, isHOS } from '../../../engine/index';
import { lim } from '../../../engine/limits';
import { PROVINCES } from '../../../engine/foreign';
import { PEERAGE, peerTitle, peers, absolute, triumphDue, PROGRESS_EVERY, PROGRESS_COST, TRIUMPH_COST, LESE_EVERY } from '../../../engine/imperium';
import { canGovernEmpire } from '../../../engine/empire';
import { CHARGES } from '../../../engine/trials';
import { GazettePoster } from '../PosterView';
import { ESTATES, estateLost, consortOf, inTower, PALACE_COST, PALACE_RENT, EVENTS, EVENT_EVERY } from '../../../engine/dynasty';
import { canGovernEmpire as canRule } from '../../../engine/empire';

// on every page: the Sovereign's proclamation of the day, and a triumph in the streets
export function CrownBanners() {
  const { world: w, me } = useStore();
  const pr = w.crown?.proclamation;
  const t = w.triumph;
  const live = t && !t.done && t.until > w.now;
  const abroad = !!w.citizens[me]?.defected;
  return (
    <>
      {w.commission && w.commission.until > w.now && (
        <div class="proclamation" role="status" style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
          <GazettePoster p={{ id: 'decree', slogan: w.commission.slogan, by: w.commission.by, font: w.commission.font, pal: w.commission.pal }} width={64} />
          <span style={{ display: 'flex', flexDirection: 'column', gap: 4 }}><small>On every wall · by order of {nm(w, w.commission.by)}</small><b class="serif">“{w.commission.slogan}”</b></span>
        </div>
      )}
      {pr && pr.until > w.now && w.config.hos === 'monarchy' && (
        <div class="proclamation" role="status">
          <small>By order of {pr.title} {nm(w, pr.by)}</small>
          <b class="serif">“{pr.text}”</b>
        </div>
      )}
      {w.invasion && !abroad && (
        <div class="proclamation triumph" role="status">
          <small>Invasion warning</small>
          <b class="serif">{w.invasion.name}: the exiles are preparing to invade from {w.nations[w.invasion.nation]?.name}, {w.invasion.members.length} under arms.</b>
          <a class="small" href="#/abroad">What we know</a>
        </div>
      )}
      {Object.entries(w.provinces || {}).filter(([, p]: any) => p.revolt).map(([id, p]: any) => (
        <div class="proclamation triumph" role="status">
          <small>Revolt · answered by <When at={p.revolt.until} /> or lost</small>
          <b class="serif">{PROVINCES[id]?.name} has risen, stirred up from abroad by {nm(w, p.revolt.by)}.</b>
          {(canRule(w, me) || w.pm === me) && <span class="row" style={{ gap: 8, justifyContent: 'flex-start' }}><Btn small kind="danger" onClick={() => act('imperial.suppress', { province: id, how: 'troops' }, 'The troops march.')}>Send troops</Btn><Btn small kind="plain" onClick={() => act('imperial.suppress', { province: id, how: 'concede' }, 'Concessions made.')}>Make concessions</Btn></span>}
        </div>
      ))}
      {w.durbar && !w.durbar.done && w.durbar.until > w.now && !abroad && w.hos?.holder !== me && (
        <div class="proclamation" role="status">
          <small>The Imperial Durbar · closes <When at={w.durbar.until} /></small>
          <b class="serif">{w.durbar.expected.includes(me) ? 'You are summoned to pay homage. Absence is noted.' : 'The court sits to receive homage.'} {w.durbar.attended.length} have come.</b>
          {!w.durbar.attended.includes(me) && <span><Btn small onClick={() => act('durbar.attend', {}, 'You bow before the throne.')}>Pay homage</Btn></span>}
        </div>
      )}
      {w.crown?.proposal && w.crown.proposal.to === me && w.crown.proposal.until > w.now && (
        <div class="proclamation" role="status">
          <small>Only you can answer · by <When at={w.crown.proposal.until} /></small>
          <b class="serif">{w.config.hosTitle} {nm(w, w.crown.proposal.by)} asks for your hand in marriage.</b>
          <span class="row" style={{ gap: 8, justifyContent: 'flex-start' }}><Btn small onClick={() => act('crown.wed', { yes: true }, 'A royal wedding!')}>Accept</Btn><Btn small kind="plain" onClick={() => act('crown.wed', { yes: false }, 'You decline.')}>Decline</Btn></span>
        </div>
      )}
      {live && (
        <div class="proclamation triumph" role="status">
          <small>A triumph · until <When at={t.until} /></small>
          <b class="serif">The Army marches through the capital after the victory over {w.nations[t.nation]?.name}{t.hero ? `, ${nm(w, t.hero)} at its head` : ''}.</b>
          <span class="row" style={{ gap: 8, justifyContent: 'flex-start' }}>
            <span class="small">{t.crowd.length} in the crowd</span>
            {!abroad && !t.crowd.includes(me) && <Btn small onClick={() => act('triumph.cheer', {}, 'You cheer them home.')}>Line the streets</Btn>}
          </span>
        </div>
      )}
    </>
  );
}

// the Sovereign's desk, on the Crown page
export function CrownDesk() {
  const { world: w, me } = useStore();
  const [words, setWords] = useState('');
  const [peer, setPeer] = useState({ target: '', rank: 'baron', of: '' });
  const [prov, setProv] = useState('');
  const [lese, setLese] = useState({ target: '', text: '' });
  if (w.config.hos !== 'monarchy') return null;
  const mine = isHOS(w, me) && !!w.crown?.reign?.crownedAt;
  const k = w.crown || {};
  const roll = peers(w).sort((a: any, b: any) => ['duke', 'earl', 'baron'].indexOf(a.peerage.rank) - ['duke', 'earl', 'baron'].indexOf(b.peerage.rank));
  const home = (Object.values(w.citizens) as any[]).filter((c) => c.active && !c.bot && !c.defected && c.id !== me);
  const provinces = Object.keys(w.provinces || {}).filter((id) => w.provinces[id].owner === 'realm');
  const victory = triumphDue(w);
  const canTriumph = victory && (mine || canGovernEmpire(w, me));
  const progIn = k.progressAt ? Math.max(0, k.progressAt + PROGRESS_EVERY - w.now) : 0;
  const leseIn = k.leseAt ? Math.max(0, k.leseAt + LESE_EVERY - w.now) : 0;
  return (
    <>
      <Sec title="The peerage" sub={`Peers of the realm, created by the Crown: up to ${lim(w, 'peers')}. Dukes draw 5 a week, Earls 3, Barons 2, and the peers stand by the Crown on a coup night.`}>
        {roll.length ? <ul class="list">{roll.map((c: any) => <li class="row"><span><Who id={c.id} />, <b>{peerTitle(c)}</b><div class="small muted">Since <When at={c.peerage.at} /></div></span>{mine && <Btn small kind="danger ghost" onClick={() => confirm(`Strip ${c.name} of their title?`) && act('crown.attaint', { target: c.id }, 'Attainted.')}>Strip the title</Btn>}</li>)}</ul> : <Empty>No peers yet.</Empty>}
        {mine && <Card style={{ marginTop: 10 }}><div class="grid2"><Pick value={peer.target} onChange={(v) => setPeer({ ...peer, target: v })} empty="Whom?" options={home.map((c) => [c.id, c.name])} /><Pick value={peer.rank} onChange={(v) => setPeer({ ...peer, rank: v })} options={Object.entries(PEERAGE).map(([id, p]) => [id, p.title])} /></div><Field label={`Of… (the place in the title${w.citizens[peer.target]?.peerage?.of ? `; now ${w.citizens[peer.target].peerage.of}` : ', or leave blank for a free estate name'})`} value={peer.of} onInput={(v) => setPeer({ ...peer, of: v.slice(0, 30) })} placeholder="Kingsmead" /><Btn small style={{ marginTop: 8 }} disabled={!peer.target} onClick={() => act('crown.ennoble', peer, 'Raised to the peerage.') && setPeer({ target: '', rank: 'baron', of: '' })}>Ennoble</Btn></Card>}
      </Sec>
      {mine && (
        <Sec title="The Sovereign's desk">
          <div class="grid2">
            <Card><b>Proclaim</b><p class="small">Once a day. Your words hang over every page for 24 hours.</p><Field label="Proclamation" value={words} onInput={(v) => setWords(v.slice(0, 240))} placeholder="Let it be known…" /><Btn small disabled={words.trim().length < 8 || (k.proclamation && w.now - k.proclamation.at < 86400000)} onClick={() => act('crown.proclaim', { text: words }, 'Proclaimed.') && setWords('')}>Proclaim it</Btn></Card>
            {provinces.length > 0 && <Card><b>A royal progress</b><p class="small">Tour a province: {PROGRESS_COST} from the Treasury. No unrest there for a week, stability +1, +2 approval. Every three days.</p><Pick value={prov} onChange={setProv} empty="Which province?" options={provinces.map((id) => [id, PROVINCES[id]?.name ?? id])} />{progIn ? <span class="small muted">Next <Left at={w.now + progIn} /></span> : null}<Btn small disabled={!prov || !!progIn} onClick={() => act('crown.progress', { province: prov }, 'The court sets out.')}>Set out</Btn></Card>}
            {absolute(w) && <Card kind="warn"><b>Lèse-majesté</b><p class="small">An absolute monarch may charge a citizen with insulting the Crown. They go on trial; guilty means {CHARGES.lese.days} days in the Realm Jail. An acquittal costs you 3 approval.</p><Pick value={lese.target} onChange={(v) => setLese({ ...lese, target: v })} empty="Whom?" options={home.map((c) => [c.id, c.name])} /><Field label="The charge" value={lese.text} onInput={(v) => setLese({ ...lese, text: v.slice(0, 200) })} placeholder="Mocked the Crown in the Gazette" />{leseIn ? <span class="small muted">Next charge <Left at={w.now + leseIn} /></span> : null}<Btn small kind="danger" disabled={!lese.target || lese.text.trim().length < 8 || !!leseIn} onClick={() => confirm('Bring the charge?') && act('crown.lese', lese, 'The charge is brought.') && setLese({ target: '', text: '' })}>Bring the charge</Btn></Card>}
          </div>
        </Sec>
      )}
      <RoyalFamily />
      <Holdings />
      <Entertainments />
      <Tenants />
      <CoronationRecord />
      <Tower />
      {w.durbar?.done && <Sec title="The last Durbar"><p class="small">{w.durbar.attended.length} paid homage <When at={w.durbar.at} />.{w.durbar.absent?.length ? ` Absent, and noted: ${w.durbar.absent.map((id: string) => nm(w, id)).join(', ')}.` : ' Nobody summoned stayed away.'}</p></Sec>}
      {canTriumph && <Sec title="A triumph"><Card kind="tint"><div class="row"><span class="small">Celebrate the victory over {w.nations[victory.nation]?.name}: the Army marches through the capital. {TRIUMPH_COST} crowns, stability +2, and a crowd for 12 hours.</span><Btn onClick={() => act('crown.triumph', {}, 'The triumph begins.')}>Hold a triumph</Btn></div></Card></Sec>}
    </>
  );
}

// the list of trials, on the Supreme Court page
export function TrialsList() {
  const { world: w } = useStore();
  const all = (Object.values(w.trials || {}) as any[]).sort((a, b) => b.at - a.at).slice(0, 12);
  return (
    <Sec title="Trials" sub="Defectors brought home are tried for treason; an absolute monarch may charge lèse-majesté. The justices sit in judgement, or a jury drawn by lot.">
      {all.length ? <ul class="list">{all.map((t) => <LinkRow href={'#/trial/' + t.id} title={<>{CHARGES[t.charge]?.name}: <Who id={t.who} /></>} sub={t.status === 'open' ? <>Verdict by <When at={t.closesAt} /></> : t.status === 'guilty' ? 'Guilty' : 'Acquitted'} />)}</ul> : <Empty>No trials.</Empty>}
    </Sec>
  );
}
export function TrialPage({ id }: { id: string }) {
  const { world: w, me } = useStore();
  const [words, setWords] = useState('');
  const t = w.trials?.[id];
  if (!t) return <Page back={['#/court', 'Supreme Court']} title="No such trial" />;
  const ch = CHARGES[t.charge];
  const judge = t.judges.includes(me);
  return (
    <Page back={['#/court', 'Supreme Court']} kicker={`${ch.name} · ${t.jury ? 'a jury drawn by lot' : 'before the Supreme Court'}`} title={<>The Realm v <Who id={t.who} /></>} intro={`${t.how ? t.how[0].toUpperCase() + t.how.slice(1) + '. ' : ''}${t.by ? `Brought by ${nm(w, t.by)}. ` : ''}Guilty means ${ch.days} days in the Realm Jail.`}>
      <Sec title={t.status === 'open' ? <>Verdict by <When at={t.closesAt} /></> : t.status === 'guilty' ? 'Guilty' : 'Not guilty'}>
        <Card><div class="stack">
          <span class="small">{t.jury ? 'The jury' : 'The justices'}: {t.judges.map((j: string) => nm(w, j)).join(', ')}. A majority decides; at the deadline, the votes cast decide, and a tie acquits.{t.status !== 'open' ? ` ${Object.values(t.votes).filter((v) => v === 'guilty').length} found guilty, ${Object.values(t.votes).filter((v) => v === 'innocent').length} not guilty.` : ''}</span>
          {judge && t.status === 'open' && <div class="grid2"><Btn kind={t.votes[me] === 'guilty' ? 'danger' : 'danger ghost'} onClick={() => act('trial.vote', { trial: t.id, verdict: 'guilty' }, 'Your verdict is in.')}>Guilty</Btn><Btn kind={t.votes[me] === 'innocent' ? undefined : 'ghost'} onClick={() => act('trial.vote', { trial: t.id, verdict: 'innocent' }, 'Your verdict is in.')}>Not guilty</Btn></div>}
          {judge && t.status === 'open' && t.votes[me] && <span class="small muted">You found them {t.votes[me] === 'guilty' ? 'guilty' : 'not guilty'}. You can change your mind until the verdict.</span>}
        </div></Card>
      </Sec>
      <Sec title="The defence">
        {t.defence ? <blockquote class="small">{t.defence}</blockquote> : <Empty>The accused has said nothing.</Empty>}
        {t.who === me && t.status === 'open' && <Card><Field label="Speak in your defence" area value={words} onInput={(v) => setWords(v.slice(0, 1000))} /><Btn small disabled={words.trim().length < 8} onClick={() => act('trial.defend', { trial: t.id, text: words }, 'The court has heard you.')}>Say it</Btn></Card>}
      </Sec>
    </Page>
  );
}

// the royal family: the consort
function RoyalFamily() {
  const { world: w, me } = useStore();
  const [who, setWho] = useState('');
  const k = w.crown || {};
  const r = k.reign;
  const mine = r?.id === me && !!r?.crownedAt;
  const con = consortOf(w);
  const home = (Object.values(w.citizens) as any[]).filter((c) => c.active && !c.bot && !c.defected && c.id !== me);
  return (
    <Sec title="The royal family" sub="The monarch may marry a citizen: a royal wedding is a national holiday, and the consort draws 5 a week.">
      <Card><div class="stack">
        <span class="small">{con ? <>Consort: <Who id={con.id} />, married <When at={con.at} />.</> : 'The monarch is unmarried.'}{k.inNameOf && r?.id === k.inNameOf.id && k.inNameOf.child ? ` Reigns in the name of ${k.inNameOf.child}, heir of two houses.` : ''}</span>
        {mine && !con && (k.proposal && k.proposal.until > w.now ? <span class="small muted">Waiting for {nm(w, k.proposal.to)} to answer, <Left at={k.proposal.until} />.</span> : <div class="grid2"><Pick value={who} onChange={setWho} empty="Propose to…" options={home.map((c) => [c.id, c.name])} /><Btn disabled={!who} onClick={() => confirm(`Propose to ${nm(w, who)}? It is public.`) && act('crown.propose', { target: who }, 'You have asked.')}>Propose</Btn></div>)}
        {mine && con && <Btn small kind="danger ghost" style={{ alignSelf: 'flex-start' }} onClick={() => confirm('Divorce your consort? It is a scandal.') && act('crown.divorce', {}, 'Divorced.')}>Divorce</Btn>}
      </div></Card>
    </Sec>
  );
}
// estates and palaces: the Crown's lands and the peers'
function Holdings() {
  const { world: w, me } = useStore();
  const [to, setTo] = useState<Record<string, string>>({});
  const h = w.holdings || {};
  const mine = w.crown?.reign?.id === me && !!w.crown?.reign?.crownedAt;
  const peerList = (Object.values(w.citizens) as any[]).filter((c) => c.peerage && c.active && !c.defected);
  return (
    <Sec title="Royal holdings" sub={`Estates across the realm, held by the Crown or granted to peers. Each pays its holder rent every payday (Crown rents go to the Treasury). A palace adds ${PALACE_RENT} a week and costs ${PALACE_COST}; the royal palaces cost the Treasury upkeep.`}>
      <ul class="list">{Object.entries(ESTATES).map(([id, e]) => {
        const x = h[id] || { holder: w.config.hos === 'monarchy' ? 'crown' : 'state', palace: !!e.royal };
        const lost = estateLost(w, id);
        const holder = x.holder === 'crown' ? 'The Crown' : x.holder === 'state' ? 'The State' : null;
        return (
          <li class="row">
            <span><b>{e.name}</b>{x.palace && <span class="chip" style={{ marginLeft: 6 }}>{e.royal ? 'Royal palace' : 'Palace'}</span>}<div class="small muted">{e.province ? PROVINCES[e.province]?.name : 'The home counties'} · {e.royal ? 'royal residence' : `${e.rent + (x.palace ? PALACE_RENT : 0)} a week`}{lost ? ' · beyond our borders' : ''} · {holder ?? <Who id={x.holder} />}</div></span>
            <span class="row" style={{ gap: 6 }}>
              {mine && x.holder === 'crown' && !e.royal && !lost && peerList.length > 0 && <><Pick value={to[id] || ''} onChange={(v) => setTo({ ...to, [id]: v })} empty="Grant to…" options={peerList.map((c) => [c.id, c.name])} /><Btn small disabled={!to[id]} onClick={() => act('crown.grant', { estate: id, target: to[id] }, 'Granted.')}>Grant</Btn></>}
              {mine && x.holder !== 'crown' && x.holder !== 'state' && <Btn small kind="danger ghost" onClick={() => confirm(`Take ${e.name} back from ${nm(w, x.holder)}?`) && act('crown.resume', { estate: id }, 'Taken back.')}>Take back</Btn>}
              {!x.palace && !lost && ((x.holder === me) || (mine && x.holder === 'crown')) && <Btn small kind="ghost" onClick={() => confirm(`Build a palace at ${e.name} for ${PALACE_COST}?`) && act('estate.palace', { estate: id }, 'The builders arrive.')}>Build a palace</Btn>}
            </span>
          </li>
        );
      })}</ul>
    </Sec>
  );
}
// the Tower: who is held, and the chance to get them out
export function Tower() {
  const { world: w, me } = useStore();
  const [who, setWho] = useState('');
  const held = (Object.values(w.citizens) as any[]).filter((c) => inTower(w, c.id));
  const mine = w.crown?.reign?.id === me && !!w.crown?.reign?.crownedAt;
  const convicted = [...new Set((Object.values(w.trials || {}) as any[]).filter((t) => t.status === 'guilty' && w.now - (t.verdictAt || 0) < 14 * 86400000 && !inTower(w, t.who)).map((t) => t.who))] as string[];
  if (!absolute(w) && !held.length) return null;
  return (
    <Sec title="The Tower" sub="Under an absolute monarch, a citizen convicted at trial can be held in the Tower at the Crown's pleasure, with no end date. Friends can bribe the guards (10 crowns, once a day each); every try makes the next likelier, and some helpers are caught.">
      {held.length ? <ul class="list">{held.map((c) => <li class="row"><span><Who id={c.id} /><div class="small muted">Since <When at={c.jail.at} />{c.jail.tries?.length ? ` · ${c.jail.tries.filter((t: any) => w.now - t.at < 3 * 86400000).length} recent attempts` : ''}</div></span><span class="row" style={{ gap: 6 }}>{mine ? <Btn small kind="plain" onClick={() => act('crown.towerRelease', { target: c.id }, 'Released.')}>Release</Btn> : c.id !== me && !w.citizens[me]?.defected && <Btn small kind="danger ghost" onClick={() => confirm(`Bribe the guards to free ${c.name}? 10 crowns, and you may be caught.`) && act('tower.escape', { target: c.id }, 'The money changes hands.')}>Bribe the guards</Btn>}</span></li>)}</ul> : <Empty>The Tower is empty.</Empty>}
      {mine && absolute(w) && convicted.length > 0 && <Card style={{ marginTop: 10 }}><div class="grid2"><Pick value={who} onChange={setWho} empty="Commit whom?" options={convicted.map((id) => [id, nm(w, id)])} /><Btn kind="danger" disabled={!who} onClick={() => confirm(`Commit ${nm(w, who)} to the Tower? Their title and estates are forfeit.`) && act('crown.tower', { target: who }, 'To the Tower.')}>To the Tower</Btn></div></Card>}
    </Sec>
  );
}
export function TowerPage() {
  return <Page back={['#/hos', 'The Crown']} kicker="At the Crown's pleasure" title="The Tower"><Tower /></Page>;
}

// hunts and balls at the palaces
function Entertainments() {
  const { world: w, me } = useStore();
  const [f, setF] = useState<{ estate: string; kind: string; guests: string[] }>({ estate: '', kind: 'hunt', guests: [] });
  const h = w.holdings || {};
  const monarch = w.crown?.reign?.id === me && !!w.crown?.reign?.crownedAt;
  const mine = Object.keys(h).filter((id) => h[id].palace && !estateLost(w, id) && (h[id].holder === me || (monarch && h[id].holder === 'crown')));
  const home = (Object.values(w.citizens) as any[]).filter((c) => c.active && !c.bot && !c.defected && c.id !== me);
  const evs = (Object.values(w.events || {}) as any[]).sort((a, b) => b.at - a.at).slice(0, 6);
  const last = evs.find((v) => v.host === me);
  const wait = last ? Math.max(0, last.at + EVENT_EVERY - w.now) : 0;
  if (!mine.length && !evs.length) return null;
  const toggle = (id: string) => setF({ ...f, guests: f.guests.includes(id) ? f.guests.filter((x) => x !== id) : f.guests.length >= 10 ? f.guests : [...f.guests, id] });
  return (
    <Sec title="Hunts and balls" sub="A palace's holder entertains: 2 Influence for each guest who comes, approval for host and guest. The invited who stay away are named in the Gazette.">
      {evs.length > 0 && <ul class="list">{evs.map((v) => (
        <li class="row"><span><b>{EVENTS[v.kind].name[0].toUpperCase() + EVENTS[v.kind].name.slice(1)} at {ESTATES[v.estate]?.name}</b><div class="small muted">Hosted by {nm(w, v.host)} · {v.came.length} of {v.guests.length} came{v.done ? (v.snubs?.length ? ` · snubbed by ${v.snubs.map((g: string) => nm(w, g)).join(', ')}` : '') : <> · until <When at={v.until} /></>}{v.star ? ` · ${EVENTS[v.kind].prize.toLowerCase()}: ${nm(w, v.star)}` : ''}</div></span>
          {!v.done && v.until > w.now && v.guests.includes(me) && !v.came.includes(me) && <Btn small onClick={() => act('event.attend', { event: v.id }, 'You arrive in style.')}>Go</Btn>}</li>
      ))}</ul>}
      {mine.length > 0 && <Card style={{ marginTop: 10 }}><div class="stack">
        <div class="grid2"><Pick value={f.estate} onChange={(v) => setF({ ...f, estate: v })} empty="Which palace?" options={mine.map((id) => [id, ESTATES[id].name])} /><Pick value={f.kind} onChange={(v) => setF({ ...f, kind: v })} options={Object.entries(EVENTS).map(([k, x]) => [k, `${x.name[0].toUpperCase() + x.name.slice(1)} (${x.cost} crowns)`])} /></div>
        <div class="small">Invite up to 10 ({f.guests.length} chosen):</div>
        <div class="row" style={{ flexWrap: 'wrap', gap: 6, justifyContent: 'flex-start' }}>{home.map((c) => <Btn small kind={f.guests.includes(c.id) ? undefined : 'ghost'} onClick={() => toggle(c.id)}>{c.name}</Btn>)}</div>
        <Btn disabled={!f.estate || !f.guests.length || !!wait} onClick={() => act('estate.host', f, 'The invitations go out.') && setF({ ...f, guests: [] })}>{wait ? <>Next <Left at={w.now + wait} /></> : 'Send the invitations'}</Btn>
      </div></Card>}
    </Sec>
  );
}
// estate rebellions: lords with a grievance, and the tenants under arms
function Tenants() {
  const { world: w, me } = useStore();
  const c = w.citizens[me];
  const armed = (Object.values(w.citizens) as any[]).filter((x) => x.retinue && x.retinue.until > w.now);
  const sore = c?.grievance && c.grievance.until > w.now && !(c.retinue && c.retinue.until > w.now);
  if (!armed.length && !sore) return null;
  return (
    <Sec title="Tenants under arms" sub="A lord whose lands the Crown took back can arm their tenants for a week: they fight for their lord's side on any coup night.">
      {armed.length > 0 && <ul class="list">{armed.map((x) => <li class="row"><span><Who id={x.id} /><div class="small muted">Tenants of {x.retinue.from.join(', ')} · until <When at={x.retinue.until} /></div></span><b>+{x.retinue.strength}</b></li>)}</ul>}
      {sore && <Card kind="warn" style={{ marginTop: 10 }}><div class="row"><span class="small">The Crown took {c.grievance.estates.join(', ')} from you. Your tenants are angry too. Arm them for 10 crowns: +{Math.min(3, c.grievance.estates.length)} for your side on a coup night, for a week.</span><Btn kind="danger" onClick={() => confirm('Arm your tenants? It is public.') && act('estate.raise', {}, 'Your tenants take up arms.')}>Raise the tenants</Btn></div></Card>}
    </Sec>
  );
}
// the Coronation Durbar's record: who knelt and who stood apart, for the length of the reign
function CoronationRecord() {
  const { world: w } = useStore();
  const r = w.crown?.reign;
  if (!r?.knelt) return null;
  return (
    <Sec title="The Coronation Durbar" sub="On the record for as long as the reign lasts. The Crown will not ennoble anyone who stood apart.">
      <Card><div class="stack small">
        <span><b>Knelt:</b> {r.knelt.length ? r.knelt.map((id: string) => nm(w, id)).join(', ') : 'nobody'}</span>
        <span><b>Stood apart:</b> {r.stoodApart?.length ? r.stoodApart.map((id: string) => nm(w, id)).join(', ') : 'nobody'}</span>
      </div></Card>
    </Sec>
  );
}
