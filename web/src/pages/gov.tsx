import { useState } from 'preact/hooks';
import { useStore, act } from '../store';
import { Page, Sec, Card, Btn, Who, Left, Empty, LinkRow, Seg, Opt, Field, Pick, Icon, ThemeSwitch, Locked } from '../ui';
import { nm, isPM, isHOS, mps, sideOf, sideName, majority, allCitizens, exiled, intrigueOpen, bal, ca, hosTitle, holderOf, officesOf } from '../../../engine/index';
import { leaderOfOpposition, leaderOfSide, sideSeats, supportFor, members, HOS_METHODS } from '../../../engine/politics';
import { POWERS, TEMPLATES, FILL } from '../../../engine/offices';

export function Realm() {
  const { world: w, me } = useStore();
  const has = (k: string) => !!w.offices[k];
  const groups: [string, [string, string, string, boolean?][]][] = [
    ['Parliament', [['#/house', 'The House', `${w.config.seats} seats`], ['#/proposals', 'Proposals', 'Bills, motions, referendums'], ['#/questions', 'Questions', 'PMQs and formal questions'], ['#/elections', 'Elections', 'Ballots and results']]],
    ['Government', [['#/offices', 'Offices', `${Object.keys(w.offices).length} created by law`], ['#/cabinet', 'Cabinet and coalition', w.pm ? `PM ${nm(w, w.pm)}` : 'No government'], ['#/hos', w.config.hos === 'monarchy' ? 'The Crown' : 'The President', nm(w, w.hos.holder)], ['#/parties', 'Parties', `${Object.values(w.parties).filter((p: any) => p.status === 'active').length} active`]]],
    ['Money', [['#/wallet', 'Your wallet', `${bal(w, ca(me))} crowns`], ['#/economy', 'Treasury and Reserve', `Rate ${w.economy.rate}%`], ['#/banks', 'Banks', w.permits.banks ? `${Object.keys(w.banks).length} open` : 'Needs the Banking Act', !w.permits.banks], ['#/ventures', 'Trade ventures', 'Invest abroad']]],
    ['The world', [['#/foreign', 'Foreign Office', has('foreign') ? 'Five nations' : 'Needs the Foreign Affairs Act', !has('foreign')], ['#/security', 'Security Service', has('security') ? 'Intelligence' : 'Needs the Security Service Act', !has('security')], ['#/army', 'The Army', has('army') ? `${w.army.readiness}, loyalty ${w.army.loyalty}/5` : 'Needs the Defence Act', !has('army')]]],
    ['Society', [['#/press', 'The press', `${Object.keys(w.papers).length} papers`], ['#/gazette', 'The Gazette', 'Record and front pages'], ['#/court', 'Supreme Court', has('court') ? 'Cases' : 'Needs an amendment', !has('court')], ['#/crises', 'Crises', 'One a week'], ['#/season', 'Season', `Season ${w.season.n}`], ['#/polls', 'The polls', w.polls?.[0] ? 'Out every payday' : 'First one on payday'], ['#/fame', 'Hall of Fame', 'Kept forever'], ['#/calendar', 'Calendar', 'The weekly rhythm'], ['#/rolog', 'Returning Officer’s log', 'Every use of admin powers']]],
    ['The backroom', [['#/backroom', 'Cards and deals', intrigueOpen(w) ? 'Secrets you hold' : 'Opens in week 3', !intrigueOpen(w)], ['#/plots', 'Plots', intrigueOpen(w) ? 'Coups' : 'Opens in week 3', !intrigueOpen(w)], ['#/exile', 'Exile', 'Where traitors go']]]
  ];
  groups.splice(5, 0, ['Real life', [['#/streets', 'The Streets', w.citizens[me].streets?.in ? 'Contracts, codes, safe zones' : 'Opt-in: contracts and tags'], ['#/hunt', 'The Hunt', w.hunt?.status === 'running' ? `${w.hunt.alive.length} still standing` : w.hunt?.status === 'signup' ? 'Sign-ups open' : 'A new round every payday'], ['#/meet', 'Meet up', 'Check in with someone in person'], ['#/market', 'The market', `${Object.values(w.bounties || {}).filter((b: any) => b.status === 'open').length} bounties, ${Object.values(w.stalls || {}).filter((s: any) => s.status === 'open').length} stalls`], ['#/bets', 'Bets', `${Object.values(w.markets || {}).filter((m: any) => m.status === 'open' && m.closesAt > w.now).length} open`]]]);
  groups.push(['Made by players', [['#/apps', 'App directory', 'Bots and frontends people have built'], ['#/developers', 'Build your own app', 'API keys, apps and webhooks']]]);
  if (w.citizens[me].admin) groups.push(['Returning Officer', [['#/admin', 'Admin', 'Approvals, calendar, fixes']]]);
  return (
    <Page kicker={w.config.realmName} title="The realm" intro="Everything in the game. Locked areas open once Parliament passes the law that creates them.">
      {groups.map(([g, items]) => (
        <Sec title={g}><ul class="list">{items.map(([href, t, s, locked]) => <LinkRow href={href} title={<span style={{ opacity: locked ? 0.55 : 1 }}>{t}</span>} sub={s} right={locked ? <Icon name="lock" /> : undefined} />)}</ul></Sec>
      ))}
      <Sec title="Appearance" sub="Auto follows your device."><ThemeSwitch /></Sec>
    </Page>
  );
}

export function Offices() {
  const { world: w } = useStore();
  const missing = Object.entries(TEMPLATES).filter(([k]) => !w.offices[k] && k !== 'whip');
  return (
    <Page back={['#/realm', 'The realm']} title="Offices" intro="Every role in government is an office created by law. Holding one gives you its powers as buttons.">
      <Sec>
        <div class="stack">
          {Object.values(w.offices).map((o: any) => (
            <a href={'#/office/' + o.id} class="card office-card" style={{ textDecoration: 'none', color: 'inherit' }}>
              <div class="row"><b class="serif" style={{ fontSize: 20 }}>{o.name}</b><span class="small muted">{o.law}</span></div>
              <div class="small">{o.title}: {o.members.length > 1 ? o.members.map((m: string) => nm(w, m)).join(', ') : <Who id={o.holder} />} <span class="muted">({FILL[o.fill].toLowerCase()})</span></div>
              <div class="chips">{o.powers.map((p: string) => <span class={'chip ' + (POWERS[p].strong ? 'red' : 'teal')}>{POWERS[p].label}</span>)}</div>
            </a>
          ))}
        </div>
      </Sec>
      <Sec title="Not yet created">
        <div class="stack">{missing.map(([k, t]) => <Card kind="dashed"><div class="row"><b>{t.name}</b><Icon name="lock" /></div><p class="small" style={{ margin: '6px 0 10px' }}>{t.blurb}{t.constitutional ? ` Constitutional: needs 4 of 5 MPs.` : ''}</p><Btn href={'#/new?office=' + k} small kind="ghost">Draft the {t.act}</Btn></Card>)}</div>
        <Btn href="#/new?custom=1" kind="ghost" style={{ marginTop: 10 }}>Invent a new office</Btn>
      </Sec>
    </Page>
  );
}

const POWER_LINK: Record<string, [string, string]> = { rate: ['#/economy', 'Set the rate'], envoy: ['#/foreign', 'Send envoys'], intel: ['#/security', 'Request intelligence'], army: ['#/army', 'Set readiness'], question: ['#/questions', 'Ask a formal question'], files: ['#/backroom', 'See your cards'], judge: ['#/court', 'Hear cases'] };
export function Office({ id }: { id: string }) {
  const { world: w, me } = useStore();
  const o = w.offices[id];
  const [g, setG] = useState({ target: '', amount: '10', reason: '' });
  if (!o) return <Page title="No such office" back={['#/offices', 'Offices']} />;
  const mine = o.holder === me || o.members.includes(me);
  const others = allCitizens(w).map((c: any) => [c.id, c.name]) as any;
  return (
    <Page back={['#/offices', 'Offices']} kicker={`${FILL[o.fill]} · ${o.law}${o.secrecy === 'secret' ? ' · secret' : ''}`} title={o.name} intro={o.template ? TEMPLATES[o.template].blurb : undefined}>
      <Sec><Card kind={mine ? 'tint' : undefined}><div class="small muted">{o.title}</div><b class="serif" style={{ fontSize: 26 }}>{o.members.length > 1 ? o.members.map((m: string) => nm(w, m)).join(', ') : nm(w, o.holder)}</b>{mine && <div class="small" style={{ fontWeight: 700, marginTop: 4 }}>That's you.</div>}{o.budget > 0 && <div class="small" style={{ marginTop: 6 }}>Budget {o.budget} a week · {bal(w, 'office:' + o.id)} left this week</div>}</Card></Sec>
      <Sec title="Powers" sub={mine ? 'Use them here, or on the page each one links to.' : `Only the ${o.title.toLowerCase()} can use these.`}>
        <div class="stack">
          {o.powers.map((p: string) => (
            <Card>
              <div class="row"><b>{POWERS[p].label}</b>{POWERS[p].strong && <span class="chip red">Strong</span>}</div>
              {mine && POWER_LINK[p] && <Btn href={POWER_LINK[p][0]} small kind="ghost" style={{ marginTop: 8 }}>{POWER_LINK[p][1]}</Btn>}
              {mine && (p === 'grant' || p === 'fine') && (
                <div class="stack" style={{ marginTop: 8 }}>
                  <div class="grid2"><Pick value={g.target} onChange={(v) => setG({ ...g, target: v })} empty="To whom" options={others} /><Field label="Crowns" type="number" value={g.amount} onInput={(v) => setG({ ...g, amount: v })} /></div>
                  <Field label="Reason (public)" value={g.reason} onInput={(v) => setG({ ...g, reason: v })} />
                  <Btn small kind={p === 'fine' ? 'danger ghost' : undefined} onClick={() => act(p === 'grant' ? 'office.grant' : 'office.fine', { office: o.id, target: g.target, amount: Number(g.amount), reason: g.reason }, p === 'grant' ? 'Paid.' : 'Fined.')}>{p === 'grant' ? 'Pay' : 'Fine'}</Btn>
                </div>
              )}
              {mine && p === 'block' && <p class="small muted" style={{ margin: '6px 0 0' }}>Open a bill awaiting assent to send it back. {o.blocksUsed ? 'Used this term.' : 'Unused this term.'}</p>}
            </Card>
          ))}
          {!o.powers.length && <Empty>This office has no powers yet. A law can give it some.</Empty>}
        </div>
      </Sec>
      {isPM(w, me) && o.fill === 'pm' && <Sec title="Appoint"><Pick value={o.holder || ''} onChange={(v) => act('gov.appoint', { office: o.id, target: v || null }, 'Appointed.')} empty="Leave vacant" options={allCitizens(w).filter((c: any) => !c.admin).map((c: any) => [c.id, c.name])} /></Sec>}
      <Sec><Btn href={'#/law/' + o.law} kind="plain" small>Read the law that created it</Btn></Sec>
    </Page>
  );
}

export function Cabinet() {
  const { world: w, me } = useStore();
  const pm = isPM(w, me);
  const lo = leaderOfOpposition(w);
  const posts = Object.values(w.offices).filter((o: any) => o.fill === 'pm') as any[];
  const opts = allCitizens(w).filter((c: any) => !c.admin).map((c: any) => [c.id, c.name]) as any;
  const co = w.coalition;
  const sides = [...new Set(mps(w).map((m: string) => sideOf(w, m)))] as string[];
  const own = sideOf(w, me);
  const iLead = leaderOfSide(w, own) === me;
  const mySide = co?.sides.find((s: string) => leaderOfSide(w, s) === me);
  const [partners, setPartners] = useState<string[]>([]);
  const [kind, setKind] = useState('full');
  const [terms, setTerms] = useState('');
  const [pp, setPp] = useState({ office: posts[0]?.id || '', target: '' });
  return (
    <Page back={['#/house', 'The House']} kicker={w.pm ? (w.minority ? 'Minority government' : 'Majority government') : 'No government'} title="Cabinet" intro={w.pm ? <>Prime Minister <Who id={w.pm} />, with {supportFor(w, w.pm)} of {w.config.seats} seats. {majority(w)} makes a majority.</> : `The ${hosTitle(w)} invites a Prime Minister after each election.`}>
      {w.confidence && <Card kind="warn" style={{ marginTop: 14 }}><b>Confidence lost.</b> The government must win a confidence vote within <Left at={w.confidence.deadline} /> or it falls.</Card>}
      <Sec title="Ministers" sub="Offices the PM fills.">
        <ul class="list">
          {posts.map((o) => (
            <li class="row">
              <span style={{ minWidth: 0 }}><b>{o.title}</b><div class="small"><Who id={o.holder} />{co?.promises?.[o.id] && co.promises[o.id] !== o.holder ? <span class="err-line"> (promised to {nm(w, co.promises[o.id])})</span> : ''}</div></span>
              {pm && <select class="input" style={{ width: 140 }} value={o.holder || ''} onChange={(e: any) => act('gov.appoint', { office: o.id, target: e.target.value || null })}><option value="">Vacant</option>{opts.map(([v, l]: any) => <option value={v}>{l}</option>)}</select>}
            </li>
          ))}
        </ul>
        {pm && <div class="grid2" style={{ marginTop: 10 }}><Btn href="#/new?kind=confidence" kind="ghost">Ask for confidence</Btn><Btn kind="danger ghost" onClick={() => act('gov.resign', {}, 'You resigned.')}>Resign</Btn></div>}
      </Sec>
      <Sec title="Coalition" sub="Sides are parties or independent MPs.">
        <ul class="list">{sides.map((s) => <li class="row"><span><b>{sideName(w, s)}</b><div class="small muted">Led by {nm(w, leaderOfSide(w, s))}</div></span><b class="tnum">{sideSeats(w, s)} seat{sideSeats(w, s) === 1 ? '' : 's'}</b></li>)}</ul>
        {co && co.status !== 'broken' && (
          <Card kind={co.status === 'signed' ? 'tint' : 'dashed'} style={{ marginTop: 10 }}>
            <b>{co.sides.map((s: string) => sideName(w, s)).join(' + ')}</b>
            <div class="small">{co.kind === 'full' ? 'Full coalition' : 'Confidence and supply'}, {co.sides.reduce((n: number, s: string) => n + sideSeats(w, s), 0)} seats. {co.status === 'signed' ? 'Signed.' : 'Draft.'}</div>
            {co.terms.length > 0 && <ol style={{ margin: '8px 0', paddingLeft: 20 }}>{co.terms.map((t: string) => <li>{t}</li>)}</ol>}
            {mySide && co.status === 'draft' && !co.signed[mySide] && <Btn full style={{ marginTop: 8 }} onClick={() => act('coalition.sign', {}, 'Signed.')}>Sign</Btn>}
            {mySide && co.status === 'signed' && <Btn full kind="danger ghost" style={{ marginTop: 8 }} onClick={() => act('coalition.leave', {}, 'You walked out.')}>Walk out</Btn>}
            {leaderOfSide(w, co.lead) === me && (
              <div class="stack" style={{ marginTop: 10 }}>
                <div class="small" style={{ fontWeight: 700 }}>Promise a post. Breaking it later is public; the promise itself becomes a secret card.</div>
                <div class="grid2"><Pick value={pp.office} onChange={(v) => setPp({ ...pp, office: v })} options={posts.map((o) => [o.id, o.title])} /><Pick value={pp.target} onChange={(v) => setPp({ ...pp, target: v })} empty="To whom" options={opts} /></div>
                <Btn small onClick={() => act('coalition.promise', pp, 'Promised.')}>Promise</Btn>
              </div>
            )}
          </Card>
        )}
        {iLead && (!co || co.status !== 'signed') && (
          <Card style={{ marginTop: 10 }}>
            <div class="stack">
              <b>Open coalition talks</b>
              {sides.filter((s) => s !== own).map((s) => <Opt on={partners.includes(s)} onClick={() => setPartners(partners.includes(s) ? partners.filter((x) => x !== s) : [...partners, s])} title={sideName(w, s)} right={<span class="tnum">{sideSeats(w, s)}</span>} />)}
              <Seg value={kind} onChange={setKind} options={[['full', 'Full coalition'], ['cs', 'Confidence and supply']]} />
              <Field label="Terms, one per line (published)" area value={terms} onInput={setTerms} />
              <Btn full onClick={() => act('coalition.propose', { partners, kind, terms: terms.split('\n') }, 'Talks opened.')}>Propose</Btn>
            </div>
          </Card>
        )}
      </Sec>
      <Sec title="Shadow cabinet" sub={lo ? <>Named by the Leader of the Opposition, <Who id={lo} />.</> : 'There is no official opposition.'}>
        <ul class="list">
          {[{ id: 'pm', title: 'Prime Minister' }, ...posts].map((o: any) => (
            <li class="row"><span><b>Shadow {o.title}</b><div class="small"><Who id={w.shadow[o.id]} /></div></span>{lo === me && <select class="input" style={{ width: 140 }} value={w.shadow[o.id] || ''} onChange={(e: any) => act('gov.shadow', { post: o.id, target: e.target.value })}><option value="">Vacant</option>{opts.map(([v, l]: any) => <option value={v}>{l}</option>)}</select>}</li>
          ))}
        </ul>
      </Sec>
    </Page>
  );
}

export function HOS() {
  const { world: w, me } = useStore();
  const mon = w.config.hos === 'monarchy';
  const mine = isHOS(w, me);
  const [hon, setHon] = useState({ target: '', title: mon ? 'Order of the Lantern' : 'Medal of the Republic' });
  const waiting = Object.values(w.proposals).filter((p: any) => p.stage === 'assent' || p.stage === 'hos') as any[];
  const exiles = allCitizens(w).filter((c: any) => exiled(w, c.id));
  const leaders = [...new Set([...Object.values(w.parties).filter((p: any) => p.status === 'active').map((p: any) => p.leader), ...mps(w)])].filter((x) => x && x !== w.hos.holder) as string[];
  return (
    <Page back={['#/realm', 'The realm']} kicker={mon ? 'The Crown' : 'The Presidency'} title={<>{hosTitle(w)} <Who id={w.hos.holder} /></>} intro={`${HOS_METHODS[w.config.hos].find((m) => m.id === w.config.hosMethod)?.label}. ${mon ? 'Reigns, does not rule: grants assent, invites the PM, honours, pardons.' : 'Signs or vetoes bills, invites the PM, honours, pardons.'}`}>
      {!mine && <Card kind="dashed" style={{ marginTop: 14 }}>Switch to {nm(w, w.hos.holder)} in the demo controls to act as head of state.</Card>}
      {!w.pm && w.phase === 'running' && (
        <Sec title="Invite a Prime Minister" sub={w.pmInviteDue ? <>If nobody is invited within <Left at={w.pmInviteDue} />, the leader with most support is invited automatically.</> : undefined}>
          <ul class="list">{leaders.map((l) => <li class="row"><span><Who id={l} /><div class="small muted">Can command {supportFor(w, l)} of {w.config.seats} seats</div></span>{mine && <Btn small onClick={() => act('gov.invite', { target: l }, 'Invited.')}>Invite</Btn>}</li>)}</ul>
        </Sec>
      )}
      <Sec title="Waiting for you"><ul class="list">{waiting.map((p) => <LinkRow href={'#/p/' + p.id} title={p.title} sub={p.stage === 'hos' ? 'Dissolution request' : <>Becomes law anyway in <Left at={p.assentDueAt} /></>} />)}</ul>{!waiting.length && <Empty>Nothing waiting.</Empty>}</Sec>
      <Sec title="Honours" sub="One a week: a title and a stamp for any citizen, plus 5 Influence.">
        {mine ? <Card><div class="stack"><Pick value={hon.target} onChange={(v) => setHon({ ...hon, target: v })} empty="Honour whom?" options={allCitizens(w).map((c: any) => [c.id, c.name])} /><Field label="Honour" value={hon.title} onInput={(v) => setHon({ ...hon, title: v })} /><Btn onClick={() => act('hos.honour', hon, 'Honoured.')}>Award</Btn></div></Card> : <Empty>The head of state awards these.</Empty>}
      </Sec>
      <Sec title="Pardons"><ul class="list">{exiles.map((c: any) => <li class="row"><span><b>{c.name}</b><div class="small muted">{c.pardonAsked ? 'Has asked for a pardon' : 'In exile'}</div></span>{mine && <Btn small onClick={() => act('hos.pardon', { target: c.id }, 'Pardoned.')}>Pardon</Btn>}</li>)}</ul>{!exiles.length && <Empty>Nobody is in exile.</Empty>}</Sec>
      {mon && mine && <Sec title="Your title"><Seg value={w.config.hosTitle} onChange={(v) => act('hos.title', { title: v })} options={[['Queen', 'Queen'], ['King', 'King']]} /></Sec>}
    </Page>
  );
}

export function Parties() {
  const { world: w, me } = useStore();
  const [f, setF] = useState({ name: '', colour: '#3B4A8C', a: '', b: '' });
  const ps = Object.values(w.parties).filter((p: any) => ['active', 'forming'].includes(p.status)) as any[];
  const opts = allCitizens(w).filter((c: any) => c.id !== me).map((c: any) => [c.id, c.name]) as any;
  return (
    <Page back={['#/realm', 'The realm']} title="Parties" intro="10 crowns and two co-founders who sign within a day. With a national vote, parties that split their vote lose seats, so pick who stands.">
      <Sec><ul class="list">{ps.map((p) => <LinkRow href={'#/party/' + p.id} title={<><i class="dot" style={{ background: p.colour, marginRight: 8 }} />{p.name}</>} sub={p.status === 'forming' ? `Forming: ${p.signed.length} of 2 signed` : `Led by ${nm(w, p.leader)}, ${members(w, p.id).length} members, ${sideSeats(w, 'p:' + p.id)} seats`} />)}</ul></Sec>
      {ps.filter((p) => p.status === 'forming' && p.invited.includes(me) && !p.signed.includes(me)).map((p) => <Card kind="tint"><b>{nm(w, p.leader)} asked you to co-found the {p.name}.</b><Btn small style={{ marginTop: 8 }} onClick={() => act('party.cosign', { party: p.id }, 'Signed.')}>Co-sign</Btn></Card>)}
      <Sec title="Found a party">
        <Card><div class="stack">
          <Field label="Name" value={f.name} onInput={(v) => setF({ ...f, name: v })} placeholder="e.g. Harbour Party" />
          <label class="f">Colour<input type="color" value={f.colour} onInput={(e: any) => setF({ ...f, colour: e.target.value })} style={{ width: 60, height: 40 }} /></label>
          <div class="grid2"><Pick label="Co-founder" value={f.a} onChange={(v) => setF({ ...f, a: v })} empty="Pick" options={opts} /><Pick label="Co-founder" value={f.b} onChange={(v) => setF({ ...f, b: v })} empty="Pick" options={opts} /></div>
          <Btn full onClick={() => act('party.found', { name: f.name, colour: f.colour, cofounders: [f.a, f.b] }, 'Forming. Co-founders have a day.')}>Found it (10 crowns)</Btn>
        </div></Card>
      </Sec>
    </Page>
  );
}

export function Party({ id }: { id: string }) {
  const { world: w, me } = useStore();
  const p = w.parties[id];
  const [m, setM] = useState('');
  const [backers, setBackers] = useState<string[]>([]);
  if (!p) return <Page title="No such party" back={['#/parties', 'Parties']} />;
  const ms = members(w, id);
  const isMember = w.citizens[me].party === id;
  return (
    <Page back={['#/parties', 'Parties']} kicker={<><i class="dot" style={{ background: p.colour, marginRight: 6 }} />{ms.length} members, {sideSeats(w, 'p:' + id)} seats</>} title={p.name} intro={<>Leader: <Who id={p.leader} /></>}>
      <Sec title="Manifesto">{p.manifesto.length ? <ol style={{ margin: 0, paddingLeft: 20 }}>{p.manifesto.map((x: string) => <li>{x}</li>)}</ol> : <Empty>Nothing yet. Conference motions add to it.</Empty>}</Sec>
      <Sec title="Members"><p style={{ margin: 0 }}>{ms.map((x) => nm(w, x)).join(', ')}</p>{isMember ? <Btn small kind="plain" style={{ marginTop: 8 }} onClick={() => act('party.join', { party: null }, 'You left.')}>Leave</Btn> : p.status === 'active' && <Btn small style={{ marginTop: 8 }} onClick={() => act('party.join', { party: id }, 'Joined.')}>Join</Btn>}</Sec>
      {isMember && (
        <>
          <Sec title="Conference" sub="A majority of members adopts a motion into the manifesto.">
            <div class="stack">
              {p.motions.map((x: any) => (
                <Card><div class="small muted">{nm(w, x.by)}, {x.status}</div><p style={{ margin: '4px 0' }}>{x.text}</p><div class="small">{Object.values(x.votes).filter((v) => v === 'for').length} for, {Object.values(x.votes).filter((v) => v === 'against').length} against</div>{x.status === 'open' && <div class="grid2" style={{ marginTop: 8 }}><Btn small onClick={() => act('party.motionVote', { motion: x.id, vote: 'for' })}>For</Btn><Btn small kind="danger ghost" onClick={() => act('party.motionVote', { motion: x.id, vote: 'against' })}>Against</Btn></div>}</Card>
              ))}
              <Field label="New motion" value={m} onInput={setM} /><Btn small onClick={() => act('party.motion', { text: m }, 'Put to conference.') && setM('')}>Put to conference</Btn>
            </div>
          </Sec>
          {p.leader !== me && (
            <Sec title="Challenge the leader" sub="Two members must back you.">
              <div class="stack">{ms.filter((x) => x !== me && x !== p.leader).map((x) => <Opt on={backers.includes(x)} onClick={() => setBackers(backers.includes(x) ? backers.filter((y) => y !== x) : [...backers, x])} title={nm(w, x)} />)}<Btn kind="danger ghost" onClick={() => act('party.challenge', { backers }, 'Leadership contest called.')}>Challenge</Btn></div>
            </Sec>
          )}
        </>
      )}
    </Page>
  );
}
