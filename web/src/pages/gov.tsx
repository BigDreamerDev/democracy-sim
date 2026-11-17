import { useState } from 'preact/hooks';
import { useStore, act } from '../store';
import { Page, Sec, Card, Btn, Who, Left, Empty, LinkRow, Seg, Opt, Field, Pick, Icon, ThemeSwitch, Locked , When } from '../ui';
import { nm, isMP, isPM, isHOS, mps, sideOf, sideName, majority, allCitizens, exiled, intrigueOpen, bal, ca, hosTitle, holderOf, officesOf } from '../../../engine/index';
import { leaderOfOpposition, leaderOfSide, sideSeats, supportFor, members, HOS_METHODS , commands, FORM_DAYS, challengeNeed, BREAKAWAY_MPS } from '../../../engine/politics';
import { POWERS, TEMPLATES, FILL, canAppoint } from '../../../engine/offices';
import { RoleChips } from '../Roles';
import { OATHS, regnal, claimNeed, sworn, CORONATION_BOUNTY } from '../../../engine/crown';
import { watchCoronation } from '../Coronation';
import { sovereign, stateMode } from '../state';

export function Offices() {
  const { world: w } = useStore();
  const missing = Object.entries(TEMPLATES).filter(([k]) => !w.offices[k] && k !== 'whip');
  return (
    <Page back={['#/realm', 'The realm']} title="Offices" intro="The Nation has many offices, each declared by law. If the Government grants you one, you hold its powers">
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

const POWER_LINK: Record<string, [string, string]> = { rate: ['#/economy', 'Set the rate'], envoy: ['#/foreign', 'Send envoys'], intel: ['#/security', 'Request intelligence'], army: ['#/army', 'Set readiness'], question: ['#/questions', 'Ask a formal question'], files: ['#/backroom', 'See your cards'], judge: ['#/court', 'Hear cases'], propose: ['#/new', 'Draft a bill'], govern: ['#/cabinet', 'Make appointments'] };
export function Office({ id }: { id: string }) {
  const { world: w, me } = useStore();
  const o = w.offices[id];
  const [g, setG] = useState({ target: '', amount: '10', reason: '' });
  if (!o) return <Page title="No such office" back={['#/offices', 'Offices']} />;
  const mine = o.holder === me || o.members.includes(me);
  const others = allCitizens(w).map((c: any) => [c.id, c.name]) as any;
  return (
    <Page back={['#/offices', 'Offices']} kicker={`${FILL[o.fill]} · ${o.law}${o.secrecy === 'secret' ? ' · secret' : ''}`} title={o.name} intro={o.template ? TEMPLATES[o.template].blurb : undefined}>
      <Sec><Card kind={mine ? 'tint' : undefined}><div class="small muted">{o.title}</div><b class="serif" style={{ fontSize: 26 }}>{o.members.length > 1 ? o.members.map((m: string) => nm(w, m)).join(', ') : nm(w, o.holder)}</b>{mine && <div class="row small" style={{ fontWeight: 700, marginTop: 4 }}><span>That's you.</span>{o.holder === me && <button type="button" class="linkish small" style={{ color: 'var(--red)' }} onClick={() => confirm(`Resign as ${o.title}? It's announced, and ${o.fill === 'pm' ? 'the Prime Minister picks your successor' : 'the post is filled again the usual way'}.`) && act('office.resign', { office: o.id }, 'You resigned.')}>Resign</button>}</div>}{o.budget > 0 && <div class="small" style={{ marginTop: 6 }}>Budget {o.budget} a week · {bal(w, 'office:' + o.id)} left this week</div>}</Card></Sec>
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
      {o.nominee && <Sec><Card kind="warn"><b>{nm(w, o.nominee.by)}</b> proposes {o.nominee.target ? <><b>{nm(w, o.nominee.target)}</b> as {o.title}</> : `leaving the post vacant`}. Another officer of state must make the same choice.</Card></Sec>}
      {canAppoint(w, me, o) && <Sec title="Appoint" sub={isPM(w, me) ? undefined : 'As an officer of state you propose; a second officer must agree.'}><Pick value={o.holder || ''} onChange={(v) => act('gov.appoint', { office: o.id, target: v || null }, 'Appointed.')} empty="Leave vacant" options={allCitizens(w).filter((c: any) => !c.admin).map((c: any) => [c.id, c.name])} /></Sec>}
      {o.fill !== 'crown' && <Sec><Btn href={'#/law/' + o.law} kind="plain" small>Read the law that created it</Btn></Sec>}
    </Page>
  );
}

export function Cabinet() {
  const { world: w, me } = useStore();
  const pm = isPM(w, me);
  const lo = leaderOfOpposition(w);
  const posts = Object.values(w.offices).filter((o: any) => o.fill === 'pm' || o.fill === 'crown') as any[];
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
    <Page back={['#/house', 'The House']} kicker={sovereign(w) ? `${stateMode(w)!.maj}’s Government` : w.pm ? (w.minority ? 'Minority government' : 'Majority government') : 'No government'} title="Cabinet" intro={sovereign(w) ? <>{stateMode(w)!.name} leads the government as Sovereign under the Crown Act. All authority is vested in the Crown; every minister holds only what the Crown lends them.</> : w.pm ? <>Prime Minister <Who id={w.pm} />, with {supportFor(w, w.pm)} of {w.config.seats} seats. {majority(w)} makes a majority.</> : `The ${hosTitle(w)} invites a Prime Minister after each election.`}>
      {w.confidence && <Card kind="warn" style={{ marginTop: 14 }}><b>Confidence lost.</b> The government must win a confidence vote within <Left at={w.confidence.deadline} /> or it falls.</Card>}
      <Sec title="Ministers" sub="The Prime Minister nominates different ministers over offices">
        <ul class="list">
          {posts.map((o) => (
            <li class="row">
              <span style={{ minWidth: 0 }}><b>{o.title}</b><div class="small"><Who id={o.holder} />{co?.promises?.[o.id] && co.promises[o.id] !== o.holder ? <span class="err-line"> (promised to {nm(w, co.promises[o.id])})</span> : ''}{o.nominee && <span class="muted"> · {nm(w, o.nominee.by)} proposes {o.nominee.target ? nm(w, o.nominee.target) : 'leaving it vacant'}</span>}</div></span>
              {canAppoint(w, me, o) && <select class="input" style={{ width: 140 }} value={o.holder || ''} onChange={(e: any) => act('gov.appoint', { office: o.id, target: e.target.value || null })}><option value="">Vacant</option>{opts.map(([v, l]: any) => <option value={v}>{l}</option>)}</select>}
            </li>
          ))}
        </ul>
        {pm && <div class="grid2" style={{ marginTop: 10 }}><Btn href="#/new?kind=confidence" kind="ghost">Ask for confidence</Btn><Btn kind="danger ghost" onClick={() => confirm('Resign as Prime Minister? Your government falls and the ministers you appointed lose their posts.') && act('gov.resign', {}, 'You resigned.')}>Resign</Btn></div>}
      </Sec>
      <Sec title="Coalition" sub="Sides are parties or independent MPs.">
        <ul class="list">{sides.map((s) => <li class="row"><span><b>{sideName(w, s)}</b><div class="small muted">Led by {nm(w, leaderOfSide(w, s))}</div></span><b class="tnum">{sideSeats(w, s)} seat{sideSeats(w, s) === 1 ? '' : 's'}</b></li>)}</ul>
        {co && co.status !== 'broken' && (
          <Card kind={co.status === 'signed' ? 'tint' : 'dashed'} style={{ marginTop: 10 }}>
            <b>{co.sides.map((s: string) => sideName(w, s)).join(' + ')}</b>
            <div class="small">{co.kind === 'full' ? 'Full coalition' : 'Confidence and supply'}, {co.sides.reduce((n: number, s: string) => n + sideSeats(w, s), 0)} seats. {co.status === 'signed' ? 'Signed.' : 'Draft.'}</div>
            {co.terms.length > 0 && <ol style={{ margin: '8px 0', paddingLeft: 20 }}>{co.terms.map((t: string) => <li>{t}</li>)}</ol>}
            {mySide && co.status === 'draft' && !co.signed[mySide] && <Btn full style={{ marginTop: 8 }} onClick={() => act('coalition.sign', {}, 'Signed.')}>Sign</Btn>}
            {mySide && co.status === 'draft' && <Btn full kind="plain" style={{ marginTop: 8 }} onClick={() => act('coalition.decline', {}, 'The talks are over.')}>{co.lead === mySide ? 'Call off the talks' : 'Turn it down'}</Btn>}
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
    <Page back={['#/realm', 'The realm']} kicker={mon ? 'The Crown' : 'The Presidency'} title={sovereign(w) ? stateMode(w)!.name : <>{hosTitle(w)} <Who id={w.hos.holder} /></>} intro={sovereign(w) ? `The Sovereign. Reigns and rules: Head of State and Prime Minister under the Crown Act. ${nm(w, w.hos.holder)} on the throne.` : `${HOS_METHODS[w.config.hos].find((m) => m.id === w.config.hosMethod)?.label}. ${mon ? 'Reigns, does not rule: grants assent, invites the PM, honours, pardons.' : 'Signs or vetoes bills, invites the PM, honours, pardons.'}`}>
      {!mine && <Card kind="dashed" style={{ marginTop: 14 }}>Switch to {nm(w, w.hos.holder)} in the demo controls to act as head of state.</Card>}
      {!w.pm && w.phase === 'running' && (
        <Sec title="Invite a Prime Minister" sub={<>A government needs {majority(w)} of {w.config.seats} seats. Only the leader of a party or signed coalition with that many can be invited.{w.pmInviteDue ? <> If you haven't acted within <Left at={w.pmInviteDue} />, whoever commands a majority is invited for you.</> : null} {w.formingSince ? <>With no majority, Parliament is dissolved <When at={w.formingSince + FORM_DAYS * 86400000} />.</> : null}</>}>
          <ul class="list">{leaders.sort((a, b) => supportFor(w, b) - supportFor(w, a)).map((l) => { const ok = commands(w, l); return <li class="row"><span><Who id={l} /><div class="small muted">{supportFor(w, l)} of {w.config.seats} seats{ok ? ', a majority' : `, ${majority(w) - supportFor(w, l) > 0 ? `${majority(w) - supportFor(w, l)} short` : 'not the coalition leader'}`}</div></span>{mine && <Btn small disabled={!ok} onClick={() => act('gov.invite', { target: l }, 'Invited.')}>Invite</Btn>}</li>; })}</ul>
          {!leaders.some((l) => commands(w, l)) && <p class="small" style={{ margin: '8px 0 0', fontWeight: 700 }}>Hung parliament: nobody commands a majority yet. Party leaders must agree a coalition in <a href="#/cabinet">Cabinet and coalition</a>.</p>}
        </Sec>
      )}
      <Sec title="Waiting for you"><ul class="list">{waiting.map((p) => <LinkRow href={'#/p/' + p.id} title={p.title} sub={p.stage === 'hos' ? 'Dissolution request' : <>Becomes law anyway in <Left at={p.assentDueAt} /></>} />)}</ul>{!waiting.length && <Empty>Nothing waiting.</Empty>}</Sec>
      {mon && <Crown />}
      <Sec title="Honours" sub={w.crown?.reign?.honours > 0 && mine ? `One a week, and ${w.crown.reign.honours} coronation honour${w.crown.reign.honours === 1 ? '' : 's'} left to give now.` : 'One a week: a title and a stamp for any citizen, plus 5 Influence.'}>
        {mine ? <Card><div class="stack"><Pick value={hon.target} onChange={(v) => setHon({ ...hon, target: v })} empty="Honour whom?" options={allCitizens(w).map((c: any) => [c.id, c.name])} /><Field label="Honour" value={hon.title} onInput={(v) => setHon({ ...hon, title: v })} /><Btn onClick={() => act('hos.honour', hon, 'Honoured.')}>Award</Btn></div></Card> : <Empty>The head of state awards these.</Empty>}
      </Sec>
      <Sec title="Pardons"><ul class="list">{exiles.map((c: any) => <li class="row"><span><b>{c.name}</b><div class="small muted">{c.pardonAsked ? 'Has asked for a pardon' : 'In exile'}</div></span>{mine && <Btn small onClick={() => act('hos.pardon', { target: c.id }, 'Pardoned.')}>Pardon</Btn>}</li>)}</ul>{!exiles.length && <Empty>Nobody is in exile.</Empty>}</Sec>
      {mon && mine && !!w.crown?.reign?.crownedAt && <Sec title="Your title"><Seg value={w.config.hosTitle} onChange={(v) => act('hos.title', { title: v })} options={[['Queen', 'Queen'], ['King', 'King']]} /></Sec>}
    </Page>
  );
}

// The Crown: the coronation, homage, abdication, a pretender's claim, and the line of monarchs
function Crown() {
  const { world: w, me } = useStore();
  const r = w.crown?.reign;
  const offer = w.crown?.offer;
  const line = [...(w.fame?.monarchs || [])].reverse();
  const mine = !!r && r.id === me;
  const [f, setF] = useState({ name: r?.name || '', title: w.config.hosTitle, oath: r?.oath || 'people' });
  const [heir, setHeir] = useState('');
  if (!r && !line.length) return null;
  const who = r ? regnal(w, r) : '';
  const answered = r ? r.homage[me] : undefined;
  const roll = r ? Object.keys(r.homage) : [];
  const c = r?.claim;
  const house = ['chamberlain', 'privyseal'].map((k) => w.offices[k]).filter(Boolean) as any[];
  return (
    <>
      {sovereign(w) && (
        <Sec title="The Sovereign" sub="All authority in the realm is vested in the Crown. Every other office holds only what the Crown lends it.">
          <Card kind="tint">
            <b class="serif" style={{ fontSize: 22 }}>{stateMode(w)!.name}</b>
            <div class="small" style={{ marginTop: 4 }}>Head of State and Prime Minister, for life.{w.acts?.decrees ? ' Law is made by royal decree.' : ''}{w.acts?.protection ? ' Nothing is tabled in the House without the Crown’s consent.' : ''}</div>
            {house.length > 0 && <ul class="list" style={{ marginTop: 8 }}>{house.map((o) => <LinkRow href={'#/office/' + o.id} title={o.title} sub={o.holder ? nm(w, o.holder) : 'Vacant: the Crown appoints'} />)}</ul>}
          </Card>
        </Sec>
      )}
      {r && !r.crownedAt && (
        <Sec title="The coronation" sub={<>{who} is crowned in <Left at={r.crownAt} />. Every citizen gets {CORONATION_BOUNTY} crowns and a stamp, then a day to swear homage.</>}>
          {mine ? (
            <Card><div class="stack">
              <Field label="Regnal name" value={f.name} onInput={(v) => setF({ ...f, name: v })} placeholder="The name you reign under" />
              <Seg value={f.title} onChange={(v) => setF({ ...f, title: v })} options={[['Queen', 'Queen'], ['King', 'King']]} />
              <b>Your oath</b>
              {Object.entries(OATHS).map(([id, o]) => <Opt on={f.oath === id} onClick={() => setF({ ...f, oath: id })} title={o.label} hint={<>“{o.text}” {o.effect}.</>} />)}
              <Btn full onClick={() => act('crown.style', f, 'Your name and oath are set.')}>{r.styled ? 'Change them' : 'Set name and oath'}</Btn>
              <Btn full kind="ghost" onClick={() => confirm('Hold the coronation now? Your regnal name is then fixed for life.') && act('crown.hold', {}, 'You are crowned.')}>Hold the coronation now</Btn>
            </div></Card>
          ) : <Card kind="tint">{r.styled ? <>They will swear the oath {OATHS[r.oath]?.label.toLowerCase()}: “{OATHS[r.oath]?.text}”</> : 'The regnal name and the oath are yet to be chosen.'}</Card>}
        </Sec>
      )}
      {r?.crownedAt && (
        <Sec title={who} sub={<>Crowned <When at={r.crownedAt} />. Sworn {OATHS[r.oath]?.label.toLowerCase()}: “{OATHS[r.oath]?.text}”{r.jubilees ? ` ${r.jubilees} jubilee${r.jubilees === 1 ? '' : 's'}.` : ''}</>}>
          <div class="stack">
            <Btn kind="ghost" onClick={watchCoronation}>Watch the coronation</Btn>
            {!mine && <Btn onClick={() => act('crown.toast', {}, `You raise a glass. Long live the ${w.config.hosTitle}!`)} disabled={r.toastDay === Math.floor(w.now / 86400000) && (r.toastedToday || []).includes(me)}>{r.toastDay === Math.floor(w.now / 86400000) && (r.toastedToday || []).includes(me) ? 'You have toasted today' : `Raise a loyal toast to ${who}`}</Btn>}
            <div class="small muted">{r.toasts || 0} loyal toast{r.toasts === 1 ? '' : 's'} raised this reign{r.toastDay === Math.floor(w.now / 86400000) && r.toastedToday?.length ? `, ${r.toastedToday.length} today` : ''}.</div>
            {r.homageUntil && !mine && answered === undefined && (
              <Card><div class="stack">
                <b>Homage</b>
                <span class="small">Swear to {who}, or refuse in public. The roll closes in <Left at={r.homageUntil} />. Only those who refuse may later claim the throne.</span>
                <div class="grid2"><Btn onClick={() => act('crown.homage', { swear: true }, 'You have sworn homage.')}>Swear homage</Btn><Btn kind="plain" onClick={() => act('crown.homage', { swear: false }, 'You have refused homage.')}>Refuse</Btn></div>
              </div></Card>
            )}
            {roll.length > 0 && <Card kind="tint"><b>The homage roll</b><div class="small" style={{ marginTop: 4 }}>Sworn: {roll.filter((id) => r.homage[id]).map((id) => nm(w, id)).join(', ') || 'nobody yet'}.<br />Refused: {roll.filter((id) => !r.homage[id]).map((id) => nm(w, id)).join(', ') || 'nobody'}.</div></Card>}
            {c && (
              <Card kind="warn"><div class="stack">
                <b><Who id={c.by} /> claims the throne</b>
                <span class="small">{c.backers.length} behind the claim ({c.backers.map((id: string) => nm(w, id)).join(', ')}), {sworn(w, r).length} still sworn to {who}. It needs {claimNeed(w)} backers and more than the sworn. Settled in <Left at={c.until} />.</span>
                {!mine && !c.backers.includes(me) && <Btn kind="danger" onClick={() => confirm(answered === true ? 'You swore homage. Backing the claim breaks your oath and costs you approval. Go on?' : 'Back the claim in public?') && act('crown.back', {}, 'You back the claim.')}>Back the claim</Btn>}
              </div></Card>
            )}
            {!c && !mine && answered === false && !r.claimed.includes(me) && <Btn kind="danger ghost" onClick={() => confirm('Claim the throne? It is public, and it costs you approval if it fails.') && act('crown.claim', {}, 'You have claimed the throne.')}>Claim the throne</Btn>}
          </div>
        </Sec>
      )}
      {offer && (
        <Sec title="Abdication">
          <Card kind="warn"><div class="stack">
            <span>{who} offers the throne to <Who id={offer.heir} />, who has <Left at={offer.until} /> to answer.</span>
            {offer.heir === me && <div class="grid2"><Btn onClick={() => act('crown.heir', { yes: true }, 'The throne is yours.')}>Accept the crown</Btn><Btn kind="plain" onClick={() => act('crown.heir', { yes: false }, 'Declined.')}>Decline</Btn></div>}
            {offer.by === me && <Btn kind="plain" onClick={() => act('crown.withdraw', {}, 'Withdrawn.')}>Withdraw the offer</Btn>}
          </div></Card>
        </Sec>
      )}
      {mine && !offer && (
        <Sec title="Abdicate" sub="Name an heir, who is crowned without an election if they accept. Or leave the throne empty for the realm to fill.">
          <Card><div class="stack">
            <Pick value={heir} onChange={setHeir} empty="No heir: leave the throne empty" options={allCitizens(w).filter((x: any) => x.id !== me && !x.bot && !exiled(w, x.id)).map((x: any) => [x.id, x.name])} />
            <Btn kind="danger ghost" onClick={() => confirm(heir ? `Offer the throne to ${nm(w, heir)}?` : 'Abdicate and leave the throne empty? This cannot be undone.') && act('crown.abdicate', { heir: heir || null }, heir ? 'Offer made.' : 'You have abdicated.')}>{heir ? 'Offer the throne' : 'Abdicate'}</Btn>
          </div></Card>
        </Sec>
      )}
      {line.length > 0 && <Sec title="The line of monarchs"><ul class="list">{line.map((m: any) => <li><span><b>{m.title} {m.name} {m.numeral}</b> <span class="muted">({m.who})</span><div class="small muted">{m.crownedAt ? 'Crowned' : 'Never crowned'}, reigned {Math.max(1, Math.round((m.until - m.at) / 86400000))} day{Math.round((m.until - m.at) / 86400000) > 1 ? 's' : ''}; {m.end}.</div></span></li>)}</ul></Sec>}
    </>
  );
}

export function Parties() {
  const { world: w, me } = useStore();
  const [f, setF] = useState({ name: '', colour: '#3B4A8C' });
  const ps = Object.values(w.parties).filter((p: any) => p.status === 'active') as any[];
  return (
    <Page back={['#/realm', 'The realm']} title="Parties" intro="Parties are groups of similar minded individuals standing united in election. It costs 10 crowns to found one, and you lead it">
      <Sec><ul class="list">{ps.map((p) => <LinkRow href={'#/party/' + p.id} title={<><i class="dot" style={{ background: p.colour, marginRight: 8 }} />{p.name}</>} sub={`Led by ${nm(w, p.leader)}, ${members(w, p.id).length} members, ${sideSeats(w, 'p:' + p.id)} seats`} />)}</ul></Sec>
      <Sec title="Found a party">
        <Card><div class="stack">
          <Field label="Name" value={f.name} onInput={(v) => setF({ ...f, name: v })} placeholder="e.g. Harbour Party" />
          <label class="f">Colour<input type="color" value={f.colour} onInput={(e: any) => setF({ ...f, colour: e.target.value })} style={{ width: 60, height: 40 }} /></label>
          <Btn full onClick={() => act('party.found', { name: f.name, colour: f.colour }, `The ${f.name.trim()} is founded. You lead it.`)}>Found it (10 crowns)</Btn>
        </div></Card>
      </Sec>
    </Page>
  );
}

// who's who: everyone in the realm, grouped by what they do, with their party and standing
export function People() {
  const { world: w, me } = useStore();
  const [q, setQ] = useState('');
  const all = (allCitizens(w) as any[]).filter((c) => !q.trim() || c.name.toLowerCase().includes(q.trim().toLowerCase()));
  const rank = (c: any) => (w.pm === c.id ? 0 : w.hos?.holder === c.id ? 1 : w.speaker === c.id ? 2 : officesOf(w, c.id).length ? 3 : w.seats.includes(c.id) ? 4 : c.party ? 5 : 6);
  const groups: [string, (c: any) => boolean][] = [['Government and officers', (c) => rank(c) <= 3], ['Members of Parliament', (c) => rank(c) === 4], ['Citizens', (c) => rank(c) >= 5]];
  return (
    <Page kicker={`${allCitizens(w).length} citizens`} title="People" intro="Everyone in the realm, what they hold and which side they're on. Tap a name for their passport and record.">
      <input class="input" type="search" placeholder="Find someone" aria-label="Find someone" value={q} onInput={(e: any) => setQ(e.currentTarget.value)} />
      {groups.map(([title, f]) => {
        const list = all.filter(f).sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
        return list.length ? (
          <Sec title={title}>
            <ul class="list people">
              {list.map((c) => {
                const p = c.party && w.parties[c.party];
                return (
                  <li>
                    <a href={'#/passport/' + c.id} class="row" style={{ color: 'inherit', textDecoration: 'none', alignItems: 'flex-start' }}>
                      <span>
                        <b>{c.name}{c.id === me ? ' (you)' : ''}</b>
                        <div class="small muted">{p ? <><i class="dot" style={{ background: p.colour, marginRight: 6 }} />{p.name}{p.leader === c.id ? ', leader' : ''}</> : 'Independent'}{c.bot ? ' · practice bot' : ''}</div>
                        <RoleChips id={c.id} max={3} />
                      </span>
                      <span class="small tnum muted">{c.approval}%</span>
                    </a>
                  </li>
                );
              })}
            </ul>
          </Sec>
        ) : null;
      })}
    </Page>
  );
}

export function Party({ id }: { id: string }) {
  const { world: w, me } = useStore();
  const p = w.parties[id];
  const [m, setM] = useState('');
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
          <Leadership p={p} />
          <Breakaways p={p} />
        </>
      )}
    </Page>
  );
}

// the leadership: a challenge gathering names, a contest, or standing down
function Leadership({ p }: { p: any }) {
  const { world: w, me } = useStore();
  const contest = Object.values(w.elections).find((e: any) => e.kind === 'leadership' && e.party === p.id && e.status === 'open') as any;
  const ch = p.challenge?.status === 'open' ? p.challenge : null;
  const need = challengeNeed(w, p.id);
  const signed = ch ? ch.signed.filter((x: string) => w.citizens[x]?.party === p.id) : [];
  return (
    <Sec title="Leadership" sub={`A challenge needs ${need} members to sign within 2 days. Then any member can stand, and members vote.`}>
      {contest && <Card kind="tint"><div class="row"><span><b>A leadership contest is on.</b> Closes <When at={contest.closesAt} />.</span><Btn small href={'#/election/' + contest.id}>Stand or vote</Btn></div></Card>}
      {!contest && ch && (
        <Card kind="tint">
          <b>{nm(w, ch.by)} is challenging {nm(w, p.leader)}.</b>
          <p class="small" style={{ margin: '4px 0 8px' }}>{signed.length} of {need} signed: {signed.map((x: string) => nm(w, x)).join(', ')}. Runs out <When at={ch.dueAt} />.</p>
          {p.leader !== me && !ch.signed.includes(me) && <Btn small kind="danger ghost" onClick={() => act('party.challengeSign', { party: p.id }, 'Signed.')}>Sign the challenge</Btn>}
        </Card>
      )}
      {!contest && !ch && (p.leader === me ? <Btn small kind="ghost" onClick={() => confirm('Stand down? A contest opens, and you lead until it closes. You can stand in it.') && act('party.standDown', {}, 'You’ve stood down. The contest is open.')}>Stand down</Btn> : <Btn small kind="danger ghost" onClick={() => act('party.challenge', {}, 'Challenge launched. Members can sign it.')}>Challenge the leader</Btn>)}
    </Sec>
  );
}
// breakaways: plotted in private, launched with 2 MPs
function Breakaways({ p }: { p: any }) {
  const { world: w, me } = useStore();
  const [f, setF] = useState<{ name: string; colour: string; invite: string[] } | null>(null);
  const mine = (Object.values(w.breakaways || {}) as any[]).filter((b) => b.from === p.id && b.status === 'plotting' && (b.by === me || b.invited.includes(me)));
  const others = members(w, p.id).filter((x) => x !== me);
  const mpCount = (b: any) => b.signed.filter((x: string) => isMP(w, x) && w.citizens[x]?.party === p.id).length;
  return (
    <Sec title="Break away" sub={`In private, ask members to leave with you and found a new party. Once ${BREAKAWAY_MPS} MPs have signed, you can launch it: everyone who signed goes, seats and all. Unlaunched after 2 days, it’s off.`}>
      <div class="stack">
        {mine.map((b) => (
          <Card kind="tint">
            <div class="row"><b><i class="dot" style={{ background: b.colour, marginRight: 6 }} />{b.name}</b><span class="chip red">Private</span></div>
            <p class="small" style={{ margin: '4px 0' }}>Planned by {nm(w, b.by)}. Signed: {b.signed.map((x: string) => nm(w, x)).join(', ')}{b.declined.length ? `. Said no: ${b.declined.map((x: string) => nm(w, x)).join(', ')}` : ''}. {mpCount(b)} of {BREAKAWAY_MPS} MPs. Off <When at={b.dueAt} />.</p>
            {b.by === me ? <Btn small kind="danger" disabled={mpCount(b) < BREAKAWAY_MPS} onClick={() => confirm(`Launch the ${b.name}? Everyone who signed leaves the ${p.name} with you. Costs 10 crowns.`) && act('party.breakawayLaunch', { breakaway: b.id }, 'You’ve split the party.')}>Launch it (10 crowns)</Btn>
              : <div class="row" style={{ justifyContent: 'flex-start', gap: 8 }}>{!b.signed.includes(me) && <Btn small onClick={() => act('party.breakawaySign', { breakaway: b.id, yes: true }, 'You’re in.')}>I’m in</Btn>}{!b.declined.includes(me) && <Btn small kind="plain" onClick={() => act('party.breakawaySign', { breakaway: b.id, yes: false }, 'You said no.')}>{b.signed.includes(me) ? 'Pull out' : 'No'}</Btn>}</div>}
          </Card>
        ))}
        {!mine.some((b) => b.by === me) && !f && <Btn small kind="ghost" onClick={() => setF({ name: '', colour: '#8C3B3B', invite: [] })}>Plan a breakaway</Btn>}
        {f && (
          <Card><div class="stack">
            <Field label="New party's name" value={f.name} onInput={(v) => setF({ ...f, name: v })} />
            <label class="f">Colour<input type="color" value={f.colour} onInput={(e: any) => setF({ ...f, colour: e.target.value })} style={{ width: 60, height: 40 }} /></label>
            <div class="small" style={{ fontWeight: 700 }}>Who to ask (only they will know)</div>
            <div class="stack" style={{ gap: 6 }}>{others.map((x) => <Opt on={f.invite.includes(x)} onClick={() => setF({ ...f, invite: f.invite.includes(x) ? f.invite.filter((y) => y !== x) : [...f.invite, x] })} title={nm(w, x)} right={isMP(w, x) ? <span class="chip">MP</span> : undefined} />)}</div>
            <div class="row" style={{ justifyContent: 'flex-start', gap: 8 }}><Btn small onClick={() => act('party.breakaway', f, 'Planned. Only the people you asked know.') && setF(null)}>Ask them</Btn><Btn small kind="plain" onClick={() => setF(null)}>Cancel</Btn></div>
          </div></Card>
        )}
      </div>
    </Sec>
  );
}
