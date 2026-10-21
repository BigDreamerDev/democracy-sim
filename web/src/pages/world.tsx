import { useState } from 'preact/hooks';
import { useStore, act } from '../store';
import { Page, Sec, Card, Btn, Who, Left, When, Empty, LinkRow, Field, Pick, Locked, Seg, Opt, Photo, PhotoPick } from '../ui';
import { nm, isPM, allCitizens, fmtTime, fmtDay, bal, hasPower, holderOf, standing, isMP } from '../../../engine/index';
import { MOODS, TREATIES, INTEL_Q } from '../../../engine/foreign';
import { ARMY_COST } from '../../../engine/economy';
import { CRISES } from '../../../engine/society';
import { SeasonExtras } from './glory';

const moodColour = ['var(--red)', 'var(--amber)', 'var(--muted)', 'var(--teal)', 'var(--teal)'];

export function Foreign() {
  const { world: w, me } = useStore();
  if (!w.offices.foreign) return <Page back={['#/realm', 'The realm']} title="Foreign Office"><Sec><Locked act="Foreign Affairs Act" href="#/new?office=foreign">Send envoys, receive treaty offers, raise our Standing.</Locked></Sec><Ultimatums /></Page>;
  const can = hasPower(w, me, 'envoy') || (isPM(w, me) && !holderOf(w, 'foreign'));
  return (
    <Page back={['#/realm', 'The realm']} kicker={<>Foreign Minister <Who id={holderOf(w, 'foreign')} /></>} title="Foreign Office" intro={`Our Standing is ${standing(w)}: the average mood of the five nations. Below 15, nobody trades with us.`}>
      <Ultimatums />
      <Sec title="Nations"><ul class="list">{Object.values(w.nations).map((n: any) => <LinkRow href={'#/nation/' + n.id} title={n.name} sub={<span style={{ color: moodColour[n.mood], fontWeight: 700 }}>{MOODS[n.mood]}{w.army.war === n.id ? ', at war' : ''}{n.sanctionsUntil > w.now ? ', sanctions' : ''}</span>} right={<span class="pips5" aria-hidden="true">{[0, 1, 2, 3, 4].map((i) => <i class={i <= n.mood ? 'on' : ''} style={{ background: i <= n.mood ? moodColour[n.mood] : undefined }} />)}</span>} />)}</ul></Sec>
      <Sec title="Treaty offers" sub="Only the House can ratify them, with a bill.">
        <div class="stack">
          {Object.values(w.offers).map((o: any) => <Card kind="tint"><b>{o.title}</b><div class="small">We give: {o.give}. We get: {o.get}.</div><div class="small muted">Expires in <Left at={o.expiresAt} /></div><Btn small style={{ marginTop: 8 }} href={'#/new?treaty=' + o.id}>Put it to the House</Btn></Card>)}
          {!Object.keys(w.offers).length && <Empty>No offers. Friendly nations make them at payday, or propose one from a nation's page.</Empty>}
        </div>
      </Sec>
      <Sec title="Treaties"><ul class="list">{Object.values(w.treaties).map((t: any) => <li class="row"><span><b>{t.title}</b><div class="small muted">{t.law}</div></span><span class="small">{t.status}</span></li>)}</ul>{!Object.keys(w.treaties).length && <Empty>None in force.</Empty>}</Sec>
      {!can && <p class="small muted">Only the Foreign Minister sends envoys and proposes treaties.</p>}
    </Page>
  );
}

// demands for tribute and sanctions: these come whether or not there is a Foreign Office
function Ultimatums() {
  const { world: w, me } = useStore();
  const answer = hasPower(w, me, 'envoy') || isPM(w, me);
  const ults = (w.ultimatums || []).filter((u: any) => u.status === 'sent');
  const sanctions = Object.values(w.nations).filter((n: any) => n.sanctionsUntil && n.sanctionsUntil > w.now) as any[];
  return (
    <>
      {ults.map((u: any) => (
        <Card kind="warn" style={{ marginTop: 14 }}>
          <b>{w.nations[u.nation].name} demands {u.crowns} crowns in tribute.</b>
          <p class="small" style={{ margin: '4px 0 10px' }}>Answer within <Left at={u.dueAt} />. Pay and they warm to us; refuse (or ignore it) and they cool, Stability drops, and they may impose sanctions.</p>
          {answer ? <div class="grid2"><Btn onClick={() => act('foreign.answer', { id: u.id, pay: true }, 'Paid from the Treasury.')}>Pay {u.crowns}</Btn><Btn kind="danger" onClick={() => act('foreign.answer', { id: u.id, pay: false }, 'Refused.')}>Refuse</Btn></div> : <p class="small muted" style={{ margin: 0 }}>The Foreign Minister or the PM answers.</p>}
        </Card>
      ))}
      {sanctions.length > 0 && <Card kind="tint" style={{ marginTop: 14 }}>Sanctions: {sanctions.map((n) => `${n.name} until ${fmtDay(n.sanctionsUntil)}`).join(', ')}. No trade ventures there, and Prosperity falls each payday.</Card>}
    </>
  );
}

export function Nation({ id }: { id: string }) {
  const { world: w } = useStore();
  const n = w.nations[id];
  const [k, setK] = useState('trade');
  if (!n) return <Page title="Unknown country" back={['#/foreign', 'Foreign Office']} />;
  const asks = w.asks.filter((a: any) => a.nation === id);
  return (
    <Page back={['#/foreign', 'Foreign Office']} kicker={<span style={{ color: moodColour[n.mood] }}>{MOODS[n.mood]}</span>} title={n.name} intro={`What they want: ${n.wants}`}>
      <div class="pips5 big" style={{ marginTop: 12 }} aria-hidden="true">{MOODS.map((_, i) => <i class={i <= n.mood ? 'on' : ''} style={{ background: i <= n.mood ? moodColour[n.mood] : undefined }} />)}</div>
      <Sec title="Why they feel this way"><ul class="list">{n.reasons.map((r: any) => <li><b style={{ color: r.sign === '+' ? 'var(--teal)' : 'var(--red)' }}>{r.sign}</b> {r.text}</li>)}</ul></Sec>
      <Sec title="Diplomacy">
        <Btn full onClick={() => act('foreign.envoy', { nation: id }, 'Envoy sent.')}>Send an envoy (once a week)</Btn>
        <p class="small muted">{n.envoyAt ? `Last envoy ${fmtTime(w, n.envoyAt)}.` : 'No envoy sent yet.'}</p>
        <Card>
          <div class="stack">
            <b>Propose a treaty</b>
            {TREATIES.map((t) => <Opt on={k === t.kind} onClick={() => setK(t.kind)} title={t.title} hint={`We give: ${t.give}. We get: ${t.get}.`} />)}
            <Btn onClick={() => act('foreign.propose', { nation: id, kind: k }, 'Sent. They answer within a day.')}>Send proposal</Btn>
            {asks.map((a: any) => <div class="small">{a.title}: {a.status === 'sent' ? <>answer in <Left at={a.decideAt} /></> : a.status}</div>)}
          </div>
        </Card>
      </Sec>
    </Page>
  );
}

export function Security() {
  const { world: w, me } = useStore();
  const [n, setN] = useState('kessmark');
  const [q, setQ] = useState('plans');
  if (!w.offices.security) return <Page back={['#/realm', 'The realm']} title="Security Service"><Sec><Locked act="Security Service Act" href="#/new?office=security">Gathers intelligence abroad. Every request risks a spy being caught, which hurts our Standing.</Locked></Sec></Page>;
  const cleared = hasPower(w, me, 'intel') || isPM(w, me);
  return (
    <Page dark back={['#/realm', 'The realm']} kicker="Restricted" title="Security Service" intro={<>Director <Who id={holderOf(w, 'security')} />. {bal(w, 'office:security')} crowns left this week; each request costs 20, and 1 in 10 agents gets caught.</>}>
      {!cleared ? <Card style={{ marginTop: 16 }}>You are not cleared to read the Service's reports.</Card> : (
        <>
          <Sec title="New request"><Card><div class="stack">
            <Pick label="Country" value={n} onChange={setN} options={Object.values(w.nations).map((x: any) => [x.id, x.name])} />
            <Pick label="Question" value={q} onChange={setQ} options={Object.entries(INTEL_Q)} />
            <Btn full onClick={() => act('intel.request', { nation: n, q }, 'Tasked. Report in 12 hours.')}>Send (20 crowns)</Btn>
          </div></Card></Sec>
          <Sec title="Reports" sub="Each briefing also lands as a secret card in your backroom.">
            <div class="stack">{w.intel.map((r: any) => <Card><div class="small">{w.nations[r.nation].name}: {INTEL_Q[r.q]}</div>{r.status === 'pending' ? <p class="small">Ready in <Left at={r.readyAt} /></p> : <p style={{ margin: '6px 0 0' }}>{r.text}{r.status === 'ready' && <span class="small"> (confidence {r.confidence}/3)</span>}</p>}</Card>)}{!w.intel.length && <Empty>No reports.</Empty>}</div>
          </Sec>
        </>
      )}
    </Page>
  );
}

export function Army() {
  const { world: w } = useStore();
  if (!w.offices.army) return <Page back={['#/realm', 'The realm']} title="The Army"><Sec><Locked act="Defence Act" href="#/new?office=army">An Army costs upkeep. Its loyalty decides whether a coup can succeed.</Locked></Sec></Page>;
  return (
    <Page back={['#/realm', 'The realm']} kicker={<>General <Who id={holderOf(w, 'army')} /></>} title="The Army" intro={`Readiness: ${w.army.readiness}, costing ${ARMY_COST[w.army.readiness] * (w.army.war ? 2 : 1)} crowns a week.${w.army.war ? ` At war with ${w.nations[w.army.war].name}.` : ''}`}>
      <Sec title="Loyalty to the government">
        <div class="pips5 big" aria-hidden="true">{[1, 2, 3, 4, 5].map((i) => <i class={i <= w.army.loyalty ? 'on' : ''} style={{ background: i <= w.army.loyalty ? (w.army.loyalty <= 2 ? 'var(--red)' : 'var(--teal)') : undefined }} />)}</div>
        <p class="small">{w.army.loyalty}/5. At 2 or below the Army will not stop a coup.</p>
        <ul class="list">{w.army.reasons.map((r: any) => <li><b style={{ color: r.sign === '+' ? 'var(--teal)' : 'var(--red)' }}>{r.sign}</b> {r.text}</li>)}</ul>
      </Sec>
      <Sec title="Readiness" sub="The PM or the General. Mobilising worries the neighbours."><Seg value={w.army.readiness} onChange={(v) => act('army.readiness', { level: v })} options={[['down', 'Stood down (10)'], ['ready', 'Ready (25)'], ['mobilised', 'Mobilised (50)']]} /></Sec>
      <Sec><p class="small muted">War and peace are declared by bill. <a href="#/new">Draft one</a>.</p></Sec>
    </Page>
  );
}

export function Press() {
  const { world: w, me } = useStore();
  const [name, setName] = useState('');
  const [f, setF] = useState<any>({ paper: Object.keys(w.papers)[0] || '', headline: '', body: '', photo: null });
  const waiting = w.stories.filter((s: any) => s.status === 'submitted' && w.papers[s.paper]?.editor === me);
  const stories = w.stories.filter((s: any) => s.status === 'published').slice(0, 20);
  return (
    <Page back={['#/realm', 'The realm']} title="The press" intro="You and your friends can make a newspaper and publish stories, the most popular of the week makes the Gazette's front page">
      <Sec title="Papers"><ul class="list">{Object.values(w.papers).map((p: any) => <li class="row"><span><b>{p.name}</b><div class="small muted">Editor {nm(w, p.editor)} · {p.followers.length} readers</div></span><Btn small kind={p.followers.includes(me) ? 'plain' : 'ghost'} onClick={() => act('press.follow', { paper: p.id })}>{p.followers.includes(me) ? 'Following' : 'Follow'}</Btn></li>)}</ul></Sec>
      {waiting.length > 0 && <Sec title="Waiting for your decision">{waiting.map((s: any) => <Card><b>{s.headline}</b><Photo id={s.photo} alt={s.headline} /><p class="small">{s.body}</p><div class="small muted">By {nm(w, s.by)}</div><div class="grid2" style={{ marginTop: 8 }}><Btn small onClick={() => act('press.edit', { story: s.id, yes: true }, 'Published.')}>Publish</Btn><Btn small kind="plain" onClick={() => act('press.edit', { story: s.id, yes: false })}>Spike</Btn></div></Card>)}</Sec>}
      <Sec title="Latest">
        <div class="stack">
          {stories.map((s: any) => (
            <Card kind={s.leak ? 'warn' : undefined}>
              <div class="kicker" style={{ margin: 0 }}>{w.papers[s.paper]?.name}{s.leak ? ' · leaked' : ''}</div>
              <div class="serif" style={{ fontSize: 21, lineHeight: 1.15 }}>{s.headline}</div>
              <Photo id={s.photo} alt={s.headline} />
              <p style={{ margin: '4px 0' }}>{s.body}</p>
              <div class="row"><span class="small muted">{nm(w, s.by)}, {fmtDay(s.at)}</span><button type="button" class={'cheer' + (s.cheers.includes(me) ? ' on' : '')} aria-pressed={s.cheers.includes(me) ? 'true' : 'false'} onClick={() => act('press.cheer', { story: s.id })}>Cheer <b class="tnum">{s.cheers.length}</b></button></div>
            </Card>
          ))}
          {!stories.length && <Empty>No stories yet.</Empty>}
        </div>
      </Sec>
      <Sec title="Write a story"><Card><div class="stack">
        <Pick label="Paper" value={f.paper} onChange={(v) => setF({ ...f, paper: v })} options={Object.values(w.papers).map((p: any) => [p.id, p.name])} />
        <Field label="Headline" value={f.headline} onInput={(v) => setF({ ...f, headline: v })} />
        <Field label="Story" area value={f.body} onInput={(v) => setF({ ...f, body: v })} />
        <PhotoPick value={f.photo} onChange={(photo) => setF({ ...f, photo })} />
        <Btn onClick={() => { act('press.submit', f, 'Submitted.'); setF({ ...f, headline: '', body: '', photo: null }); }}>Submit</Btn>
      </div></Card></Sec>
      <Sec title="Start a paper (10 crowns)"><div class="grid2"><Field label="Name" value={name} onInput={setName} /><Btn style={{ alignSelf: 'end' }} onClick={() => act('press.found', { name }, 'Paper founded.')}>Start it</Btn></div></Sec>
    </Page>
  );
}

export function Court() {
  const { world: w } = useStore();
  const [f, setF] = useState({ question: '', against: 'the government', lawRef: '', argument: '' });
  if (!w.offices.court) return <Page back={['#/realm', 'The realm']} title="Supreme Court"><Sec><Locked act="Supreme Court Amendment" href="#/new?office=court">Three justices drawn by lot rule on whether laws and actions break the constitution.</Locked></Sec></Page>;
  return (
    <Page back={['#/realm', 'The realm']} title="Supreme Court" intro={`Justices: ${w.offices.court.members.map((j: string) => nm(w, j)).join(', ')}. Two of three decide.`}>
      <Sec title="Cases"><ul class="list">{Object.values(w.cases).map((k: any) => <LinkRow href={'#/case/' + k.id} title={k.question} sub={`${nm(w, k.plaintiff)} v ${k.against}. ${k.status === 'open' ? 'Open' : 'Ruled for ' + (k.ruling === 'plaintiff' ? nm(w, k.plaintiff) : k.against)}`} />)}</ul>{!Object.keys(w.cases).length && <Empty>No cases.</Empty>}</Sec>
      <Sec title="Bring a case (5 crowns)"><Card><div class="stack">
        <Field label="Question for the Court" value={f.question} onInput={(v) => setF({ ...f, question: v })} placeholder="Did the PM break L001 by...?" />
        <Field label="Against" value={f.against} onInput={(v) => setF({ ...f, against: v })} />
        <Pick label="Law in question" value={f.lawRef} onChange={(v) => setF({ ...f, lawRef: v })} empty="None" options={w.laws.map((l: any) => [l.ref, `${l.ref} ${l.title}`])} />
        <Field label="Your argument" area value={f.argument} onInput={(v) => setF({ ...f, argument: v })} />
        <Btn full onClick={() => act('court.file', f, 'Case filed.')}>File</Btn>
      </div></Card></Sec>
    </Page>
  );
}
export function Case({ id }: { id: string }) {
  const { world: w, me } = useStore();
  const k = w.cases[id];
  const [d, setD] = useState('');
  if (!k) return <Page title="No such case" back={['#/court', 'Court']} />;
  const js = w.offices.court?.members || [];
  return (
    <Page back={['#/court', 'Supreme Court']} kicker={`${nm(w, k.plaintiff)} v ${k.against}`} title={k.question}>
      <Sec title="For the plaintiff"><p>{k.args.plaintiff || '—'}</p></Sec>
      <Sec title="For the defence"><p>{k.args.defence || 'No defence filed yet.'}</p>{k.status === 'open' && <div class="stack"><Field label="Government's defence" area value={d} onInput={setD} /><Btn small onClick={() => act('court.defend', { case: id, text: d }, 'Filed.')}>File defence</Btn></div>}</Sec>
      <Sec title="Justices">
        <ul class="list">{js.map((j: string) => <li class="row"><span>{nm(w, j)}</span><b>{k.votes[j] || 'undecided'}</b></li>)}</ul>
        {k.status === 'open' && js.includes(me) && <div class="grid2" style={{ marginTop: 10 }}><Btn onClick={() => act('court.judge', { case: id, side: 'plaintiff' })}>For plaintiff</Btn><Btn kind="ghost" onClick={() => act('court.judge', { case: id, side: 'defence' })}>For defence</Btn></div>}
        {k.status === 'open' ? <p class="small">Decided by <When at={k.dueAt} /> at the latest.</p> : <Card kind="tint" style={{ marginTop: 10 }}><b>Ruled for {k.ruling === 'plaintiff' ? nm(w, k.plaintiff) : k.against}.</b></Card>}
      </Sec>
    </Page>
  );
}

export function Crises() {
  const { world: w } = useStore();
  const list = Object.values(w.crises).sort((a: any, b: any) => b.at - a.at) as any[];
  return (
    <Page back={['#/realm', 'The realm']} title="Crises" intro="Once a week, a crisis hits the nation, giving the PM a day to respond, or for major events, the House must respond. Beware your choice, it could return...">
      {(w.crisisQueue || []).length > 0 && <Card kind="dashed" style={{ marginTop: 14 }}><b>{w.crisisQueue.length} consequence{w.crisisQueue.length > 1 ? 's' : ''} pending.</b> <span class="small">Earlier choices will come back. Nobody knows quite when.</span></Card>}
      <ul class="list" style={{ marginTop: 16 }}>{list.map((c) => { const t = CRISES.find((x) => x.id === c.type)!; return <LinkRow href={'#/crisis/' + c.id} title={<>{t.extreme && <span class="via" style={{ marginLeft: 0, marginRight: 6, color: 'var(--red)', opacity: 1 }}>emergency</span>}{t.title}</>} sub={c.status === 'open' ? <>{c.house ? 'House vote' : 'PM decides'} · closes in <Left at={c.decideBy} /></> : `${c.how === 'house' ? 'House chose' : c.how === 'default' ? 'Nobody chose' : 'PM chose'}: ${t.options[c.choice].label}`} />; })}</ul>
      {!list.length && <Empty>No crises yet. One arrives at payday.</Empty>}
    </Page>
  );
}
export function Crisis({ id }: { id: string }) {
  const { world: w, me } = useStore();
  const [say, setSay] = useState({ choice: 0, text: '' });
  const c = w.crises[id];
  if (!c) return <Page title="No such crisis" back={['#/crises', 'Crises']} />;
  const t = CRISES.find((x) => x.id === c.type)!;
  const open = c.status === 'open';
  const votes = c.votes || {};
  const count = (i: number) => Object.values(votes).filter((v) => v === i).length;
  const mine = votes[me];
  const canVote = open && c.house && isMP(w, me);
  const need = Math.floor(w.config.seats / 2) + 1;
  const speeches = c.speeches || [];
  const canSpeak = open && (isMP(w, me) || isPM(w, me)) && speeches.filter((s: any) => s.by === me).length < 2;
  return (
    <Page back={['#/crises', 'Crises']} kicker={open ? <>{t.extreme ? 'Emergency · ' : ''}{c.house ? 'House vote' : 'PM decides'} · closes in <Left at={c.decideBy} /></> : 'Decided'} title={t.title} intro={t.text}>
      {c.cause && <Card kind="warn" style={{ marginTop: 14 }}><b>This is a consequence.</b> <span class="small">{c.cause}</span></Card>}
      {c.house && <Sec><p class="small muted" style={{ margin: 0 }}>{open ? <>MPs vote. {need} votes for one response settle it at once; otherwise the most votes win when time runs out, and a tie or silence means the last option.</> : `Settled by the House, ${Object.keys(votes).length} MPs voting.`}</p></Sec>}
      <Sec>
        <div class="stack">
          {t.options.map((o, i) => (
            <Card kind={c.choice === i ? 'tint' : mine === i ? 'green' : undefined}>
              <div class="row"><b>{o.label}</b>{c.house && <span class="small tnum">{count(i)} {count(i) === 1 ? 'vote' : 'votes'}</span>}</div>
              <p class="small" style={{ margin: '4px 0' }}>{o.what}</p>
              <div class="chips">{o.effects.map((x) => <span class={'chip ' + (/[−-]\d|cools|may|follow|Martial|Otherwise|back|more|goes|card/.test(x) ? 'red' : 'teal')}>{x}</span>)}</div>
              {c.house && Object.entries(votes).some(([, v]) => v === i) && <div class="small muted" style={{ marginTop: 6 }}>{Object.entries(votes).filter(([, v]) => v === i).map(([m]) => nm(w, m)).join(', ')}</div>}
              {open && !c.house && isPM(w, me) && <Btn small style={{ marginTop: 8 }} onClick={() => act('crisis.decide', { id, choice: i }, 'Decided. +3 Influence.')}>Choose this</Btn>}
              {canVote && mine !== i && <Btn small kind={mine === undefined ? undefined : 'ghost'} style={{ marginTop: 8 }} onClick={() => act('crisis.vote', { id, choice: i }, mine === undefined ? 'Voted. +1 Influence.' : 'Vote changed.')}>{mine === undefined ? 'Vote for this' : 'Change to this'}</Btn>}
            </Card>
          ))}
        </div>
        {open && !c.house && !isPM(w, me) && <p class="small muted">Only the PM decides. Lean on them at PMQs.</p>}
        {open && c.house && !isMP(w, me) && <p class="small muted">Only MPs vote. Lobby yours.</p>}
      </Sec>
      <Sec title="The debate" sub={open ? 'MPs and the PM make the case for a response. Every speech goes in the Gazette.' : undefined}>
        {speeches.length ? (
          <ul class="list">{speeches.map((s: any) => (
            <li><div class="row"><b><Who id={s.by} /></b><span class="small muted"><When at={s.at} /></span></div>
              <div class="small" style={{ margin: '2px 0 4px' }}>for <b>{t.options[s.choice].label}</b></div>
              <q style={{ fontFamily: 'var(--serif)', fontSize: 17 }}>{s.text}</q></li>
          ))}</ul>
        ) : <Empty>{open ? 'Nobody has spoken yet.' : 'Nobody spoke.'}</Empty>}
        {canSpeak && (
          <Card style={{ marginTop: 12 }}><div class="stack">
            <Pick label="Speaking for" value={String(say.choice)} onChange={(v) => setSay({ ...say, choice: Number(v) })} options={t.options.map((o, i) => [String(i), o.label])} />
            <Field label={`Your speech (${280 - say.text.length} left)`} value={say.text} onInput={(v) => setSay({ ...say, text: v.slice(0, 280) })} area placeholder="Make it quotable." />
            <Btn full disabled={say.text.trim().length < 8} onClick={() => act('crisis.speak', { id, choice: say.choice, text: say.text }, 'Speech made. It is in the Gazette.') && setSay({ ...say, text: '' })}>Make the speech</Btn>
          </div></Card>
        )}
      </Sec>
    </Page>
  );
}

export function Season() {
  const { world: w, me } = useStore();
  const ranked = allCitizens(w).slice().sort((a: any, b: any) => (b.seasonEarned || 0) - (a.seasonEarned || 0));
  const c = w.citizens[me];
  return (
    <Page back={['#/realm', 'The realm']} kicker={`Season ${w.season.n}`} title="Leaderboard" intro="Each season spans one election cycle, ranking players by influence earned that season from different actions in the nation. Complete your ambition, and gain even more influence">
      {c.ambition && <Card kind="tint" style={{ marginTop: 14 }}><div class="kicker" style={{ margin: 0 }}>Your secret ambition</div><b>{c.ambition.text}</b> <span class="small">(+{c.ambition.reward})</span></Card>}
      <Sec><ol class="list">{ranked.map((x: any, i: number) => <li class="row"><span><b class="tnum" style={{ width: 26, display: 'inline-block' }}>{i + 1}</b><Who id={x.id} /></span><span class="small tnum"><b>{x.seasonEarned || 0}</b> earned · {x.influence} to spend</span></li>)}</ol></Sec>
      <SeasonExtras />
      <Btn kind="plain" href="#/fame">The Hall of Fame</Btn>
      <Sec title="Past seasons">
        <div class="stack">{w.archive.map((a: any) => <Card><div class="serif" style={{ fontSize: 22 }}>Season {a.n}</div><div class="small">Champion {nm(w, a.champion)}. PM {nm(w, a.pm)}. Laws: {a.laws.map((l: any) => l.ref).join(', ') || 'none'}.</div><details style={{ marginTop: 6 }}><summary class="small">Ambitions revealed</summary><ul class="small">{a.reveals.map((r: any) => <li>{nm(w, r.id)}: {r.text} {r.done ? '✓' : '✗'}</li>)}</ul></details></Card>)}{!w.archive.length && <Empty>No season has ended yet. In the demo, skip to the next election.</Empty>}</div>
      </Sec>
    </Page>
  );
}
