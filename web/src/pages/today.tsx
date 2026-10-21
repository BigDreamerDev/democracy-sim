import { useEffect, useState } from 'preact/hooks';
import { useStore, act, ONLINE, signOut, changePassword, toast, securityInfo, unlinkProvider, beginOAuth, signOutEverywhere, passkeysWork, addPasskey, removePasskey, renamePasskey } from '../store';
import { TUTORIAL } from '../../../engine/tutorial';
import { Page, Sec, Card, Btn, Who, Left, When, Seal, Empty, LinkRow, Seg, Meter, Field, Pick, PasswordField } from '../ui';
import { nm, isMP, isPM, isHOS, bal, ca, intrigueOpen, fmtTime, fmtDay, ordinal, METERS, standing, inDanger, canSeeCard, CAL_EVENTS, DAYS, nextAt, hosTitle, upcoming, officesOf, exiled } from '../../../engine/index';
import { canVote } from '../../../engine/politics';
import { canVoteOn, describe, KINDS } from '../../../engine/proposals';
import { POWERS } from '../../../engine/offices';

import { needs } from '../../../engine/alerts';
import { RedBox } from './glory';
import { ghost } from '../../../engine/index';
export { needs };

export function Meters({ compact }: { compact?: boolean }) {
  const { world: w } = useStore();
  const [open, setOpen] = useState(false);
  const vals: [string, number][] = [['prosperity', w.meters.prosperity], ['stability', w.meters.stability], ['standing', standing(w)]];
  return (
    <Card style={{ marginTop: compact ? 0 : 18 }}>
      <div class="row"><h2 class="h" style={{ margin: 0, fontSize: 21 }}>The state of the realm</h2><button type="button" class="btn plain small" onClick={() => setOpen(!open)} aria-expanded={open ? 'true' : 'false'}>{open ? 'Hide why' : 'Why?'}</button></div>
      <div class="meters">
        {vals.map(([k, v]) => (
          <div class={'mtr' + (v <= 15 ? ' danger' : v <= 30 ? ' low' : '')}>
            <div class="row small"><b>{METERS[k].name}</b><b class="tnum">{v}</b></div>
            <div class="mtr-bar" aria-hidden="true"><i style={{ width: v + '%' }} /><span style={{ left: '15%' }} /></div>
            {v <= 15 && <div class="small err-line">{METERS[k].low}</div>}
          </div>
        ))}
      </div>
      {open && (
        <div class="stack" style={{ marginTop: 10 }}>
          {Object.entries(METERS).map(([k, m]) => <p class="small muted" style={{ margin: 0 }}><b style={{ color: 'var(--ink)' }}>{m.name}:</b> {m.blurb} Below 15: {m.low.toLowerCase()}.</p>)}
          <ul class="list small">{w.meters.log.slice(0, 6).map((l: any) => <li class="row"><span>{l.why}</span><b class="tnum" style={{ color: l.d > 0 ? 'var(--teal)' : 'var(--red)' }}>{METERS[l.key].name} {l.d > 0 ? '+' : ''}{l.d}</b></li>)}</ul>
        </div>
      )}
    </Card>
  );
}

function Objectives() {
  const { world: w, me } = useStore();
  const c = w.citizens[me];
  if (!c.objectives?.length) return null;
  const done = c.objectives.filter((o: any) => o.done).length;
  return (
    <Card kind="green" style={{ marginTop: 18 }}>
      <div class="row"><h2 class="h" style={{ margin: 0, fontSize: 21 }}>This week</h2><b class="small">{done} of 3 · +5 Influence each</b></div>
      <ol style={{ listStyle: 'none', margin: '8px 0 0', padding: 0 }}>
        {c.objectives.map((o: any) => (
          <li style={{ display: 'flex', alignItems: 'center', gap: 10, minHeight: 38, fontWeight: 700, textDecoration: o.done ? 'line-through' : 'none', opacity: o.done ? 0.75 : 1 }}>
            <span aria-hidden="true" class={'tickbox' + (o.done ? ' on' : '')}>{o.done ? '✓' : ''}</span>
            <span style={{ flex: 1 }}>{o.text}</span>
            {o.n > 1 && !o.done && <span class="small tnum">{Math.min(o.n, c.week[o.key] || 0)}/{o.n}</span>}
          </li>
        ))}
      </ol>
      {c.ambition && <p class="small" style={{ margin: '8px 0 0', opacity: 0.9 }}>Secret ambition this season: <b>{c.ambition.text}</b> (+{c.ambition.reward}). Only you can see this.</p>}
    </Card>
  );
}

export function SeatMap() {
  const { world: w } = useStore();
  const n = w.seats.length || w.config.seats;
  const colour = (id: string | null) => (!id ? 'none' : w.citizens[id]?.party ? w.parties[w.citizens[id].party]?.colour || 'var(--muted)' : 'var(--brown)');
  const pts = Array.from({ length: n }, (_, i) => {
    const a = Math.PI - (Math.PI * (i + 0.5)) / n;
    return [160 + 112 * Math.cos(a), 132 - 104 * Math.sin(a)];
  });
  const counts: Record<string, number> = {};
  w.seats.forEach((s: string) => {
    const k = s ? w.citizens[s]?.party || 'ind' : 'empty';
    counts[k] = (counts[k] || 0) + 1;
  });
  return (
    <Card style={{ marginTop: 18 }}>
      <div class="row"><h2 class="h" style={{ margin: 0, fontSize: 21 }}>The House</h2><a href="#/house" class="small">Open the House</a></div>
      <svg class="house-map" role="img" aria-label="Seats in the House" viewBox="0 0 320 156" style={{ display: 'block', width: '100%', maxWidth: 340, margin: '8px auto 0' }}>
        <path class="arc" d="M40 136a120 120 0 01240 0" fill="none" stroke-width="1.5" stroke-dasharray="3 5" />
        {w.seats.map((s: string, i: number) => {
          const [x, y] = pts[i];
          return (
            <g>
              <circle class={s ? '' : 'empty-seat'} cx={x} cy={y} r="19" style={{ fill: colour(s), stroke: s ? colour(s) : undefined, transformOrigin: `${x}px ${y}px` }} stroke-width="2.5" stroke-dasharray={s ? '' : '4 3'} />
              {s && <text x={x} y={y + 4} text-anchor="middle" font-size="11" font-weight="700" style={{ fill: 'var(--paper)' }}>{nm(w, s).slice(0, 3)}</text>}
            </g>
          );
        })}
        <rect class="chair" x="140" y="112" width="40" height="24" rx="2" />
        <text x="160" y="152" text-anchor="middle" font-size="11">Speaker: {nm(w, w.speaker)}</text>
      </svg>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 14px', fontSize: 14, marginTop: 6 }}>
        {Object.entries(counts).map(([k, c]) => (
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <i class="dot" style={{ background: k === 'ind' ? 'var(--brown)' : k === 'empty' ? 'transparent' : w.parties[k]?.colour, border: k === 'empty' ? '2px dashed var(--ink)' : '' }} />
            {k === 'ind' ? 'Independent' : k === 'empty' ? 'Empty' : w.parties[k]?.name} {c}
          </span>
        ))}
      </div>
    </Card>
  );
}

function InductionBanner() {
  const { world: w, me } = useStore();
  const done = Object.keys(w.citizens[me].tutorial || {}).length;
  const ind = w.induction && !w.induction.done;
  if (!ind && done >= TUTORIAL.length) return null;
  if (!ind && w.phase === 'running' && done >= 3) return null;
  return (
    <a class={'induct rise' + (ind ? ' on' : '')} href="#/learn" style={{ gridColumn: '1 / -1' }}>
      <span class="induct-stamp" aria-hidden="true">{ind ? 'Practice' : 'New?'}</span>
      <span style={{ minWidth: 0 }}>
        <b>{ind ? 'Induction week' : 'How to play'}</b>
        <span class="small">{ind ? <>Everything is practice until {fmtDay(w.induction.until)}. Try it all; it resets, then the real first election opens.</> : 'A two-minute guide and missions that walk you through each part.'}</span>
      </span>
      <span class="induct-n tnum">{done}/{TUTORIAL.length}</span>
    </a>
  );
}

export function Today() {
  const { world: w, me } = useStore();
  const c = w.citizens[me];
  // the Red Box has its own card here, so it isn't one of the slips
  const list = needs(w, me).filter((n) => !n.key.startsWith('daily:'));
  const up = upcoming(w, 3);
  const mine = officesOf(w, me);
  const quick: [string, string][] = [['#/house', 'Parliament'], ['#/realm', 'Everything'], ['#/wallet', `${bal(w, ca(me))} crowns`], ['#/season', `${c.influence} Influence`]];
  return (
    <div class="page today">
      <div class="today-head" style={{ position: 'relative' }}>
        <div class="row today-brand" style={{ justifyContent: 'flex-start', paddingTop: 18 }}>
          <Seal />
          <div>
            <div class="serif" style={{ fontSize: 19, lineHeight: 1.15 }}>{w.config.realmName}</div>
            <div class="small muted">{w.phase === 'convention' ? 'Founding Convention' : w.induction && !w.induction.done ? 'Induction week: practice, resets at the end' : `${ordinal(Math.max(1, w.season.n))} Parliament. ${w.pm ? nm(w, w.pm) + ' is Prime Minister' : 'No government'}.`}</div>
          </div>
        </div>
        <h1 class="title today-title" style={{ marginTop: 30 }}>{list.length ? `${list.length} thing${list.length > 1 ? 's' : ''} need${list.length > 1 ? '' : 's'} you` : 'All caught up'}</h1>
        <p class="intro">{w.phase === 'convention' ? <>Write the constitution together. The Convention closes in <Left at={w.convention.closesAt} />.</> : 'Everything closes on its own. Miss a vote and it goes ahead without you.'}</p>
      </div>
      <InductionBanner />
      {exiled(w, me) && <Card kind="warn" style={{ marginTop: 16, gridColumn: '1 / -1' }}><b>You are in exile</b> until <When at={c.exiledUntil} />. <a href="#/exile">What you can still do</a></Card>}
      {ghost(w, me) && <Card kind="warn" style={{ marginTop: 16, gridColumn: '1 / -1' }}><b>You were assassinated.</b> You’re a ghost until <When at={c.ghostUntil} />: you can vote, and nothing else. <a href="#/streets">The Streets</a></Card>}
      <div class="today-a">
        <div class="stack o1" style={{ marginTop: 18 }}>
          <RedBox />
          {list.map((n) => (
            <a class="slip rise" href={n.href}>
              <div class="main"><span class="small muted">{n.label}</span><span class="t">{n.title}</span></div>
              {n.at && <div class="stub"><b class="tnum" style={{ color: n.urgent ? 'var(--red)' : 'var(--ink)' }}><Left at={n.at} /></b><span class="small muted">left</span></div>}
            </a>
          ))}
        </div>
        {mine.length > 0 && (
          <Card style={{ marginTop: 18, order: 2 }}>
            <div class="small muted">Your office{mine.length > 1 ? 's' : ''}</div>
            {mine.map((o: any) => <a href={'#/office/' + o.id} class="row" style={{ textDecoration: 'none', color: 'inherit', padding: '6px 0' }}><b class="serif" style={{ fontSize: 19 }}>{o.title}</b><span class="small">{o.powers.length} power{o.powers.length === 1 ? '' : 's'} →</span></a>)}
          </Card>
        )}
        <div class="grid2 o4" style={{ marginTop: 18 }}>{quick.map(([h, l]) => <Btn href={h} kind="plain">{l}</Btn>)}</div>
        <section class="sec o5">
          <h2 class="h">In the Gazette</h2>
          <GazetteList items={w.gazette.slice(0, 8)} />
          <a href="#/gazette" class="back">The whole Gazette</a>
        </section>
      </div>
      <div class="today-b">
        {w.phase === 'running' && <div style={{ order: 2 }}><Meters /></div>}
        {w.phase === 'running' && <div style={{ order: 2 }}><Objectives /></div>}
        {w.phase === 'running' && up.length > 0 && (
          <Card style={{ marginTop: 18, order: 3 }}>
            <div class="row"><h2 class="h" style={{ margin: 0, fontSize: 21 }}>Coming up</h2><a href="#/calendar" class="small">Calendar</a></div>
            <ul class="list" style={{ marginTop: 6 }}>{up.map((e) => <li class="row"><span>{e.key === 'election' ? 'Polls open' : e.key === 'polls' ? 'Polls close' : CAL_EVENTS[e.key].name}</span><span class="small tnum">{fmtTime(w, e.at)}</span></li>)}</ul>
          </Card>
        )}
        {w.phase === 'running' && <div style={{ order: 3 }}><SeatMap /></div>}
      </div>
    </div>
  );
}

export function GazetteList({ items }: { items: any[] }) {
  const { world: w } = useStore();
  if (!items.length) return <Empty>Nothing has happened yet.</Empty>;
  const hot = ['law', 'election', 'government'];
  const bad = ['scandal', 'crisis'];
  return (
    <ol class="gz">
      {items.map((g) => (
        <li class={hot.includes(g.kind) ? 'hot' : bad.includes(g.kind) ? 'bad' : g.kind === 'admin' ? 'ro' : ''}>
          <div class="small muted">{fmtTime(w, g.at)}</div>
          <div style={{ fontSize: 15 }}>{g.practice && <span class="via" style={{ marginLeft: 0, marginRight: 6 }}>practice</span>}{g.link ? <a href={g.link} style={{ color: 'inherit' }}>{g.text}</a> : g.text}{g.via && <span class="via" title="Done through a player-made app">via {g.via}</span>}</div>
        </li>
      ))}
    </ol>
  );
}

export function Gazette() {
  const { world: w } = useStore();
  const [kind, setKind] = useState('all');
  const kinds: [string, string][] = [['all', 'Everything'], ['law', 'Laws'], ['proposal', 'Proposals'], ['election', 'Elections'], ['government', 'Government'], ['scandal', 'Scandals'], ['money', 'Money']];
  return (
    <Page title={`The ${w.config.realmName.split(' of ')[1] || 'Realm'} Gazette`} kicker="The official record" intro="Facts only. Newspapers print opinions; this prints what happened.">
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 16 }}>{kinds.map(([k, l]) => <Btn small kind={k === kind ? undefined : 'plain'} onClick={() => setKind(k)}>{l}</Btn>)}</div>
      <Sec title="Front pages" sub="Every Friday, the week on one page.">
        <ul class="list">{w.frontpages.map((f: any) => <LinkRow href={'#/frontpage/' + f.id} title={f.lead ? f.lead.headline : 'A quiet week'} sub={fmtDay(f.at)} />)}</ul>
        {!w.frontpages.length && <Empty>The first front page comes out on Friday.</Empty>}
      </Sec>
      <Sec title="The record"><GazetteList items={w.gazette.filter((g: any) => kind === 'all' || g.kind === kind).slice(0, 120)} /></Sec>
    </Page>
  );
}

// the shareable Friday page: a broadsheet in miniature
export function FrontPage({ id }: { id: string }) {
  const { world: w } = useStore();
  const f = w.frontpages.find((x: any) => x.id === id);
  if (!f) return <Page title="No such front page" back={['#/gazette', 'Gazette']} />;
  return (
    <Page back={['#/gazette', 'Gazette']} kicker="Front page" title={fmtDay(f.at)}>
      <article class="frontpage" aria-label="Front page">
        <header class="fp-mast">
          <div class="fp-rule" />
          <div class="fp-name">The {w.config.realmName.split(' of ')[1] || 'Realm'} Gazette</div>
          <div class="fp-meta"><span>{fmtDay(f.at)}</span><span>Week {f.week + 1}</span><span>Free to every citizen</span></div>
        </header>
        {f.crisisLeads ? (
          <>
            {f.crisis.extreme && <div class="fp-flash">Emergency</div>}
            <h2 class="fp-head">{f.crisis.title}</h2>
            <p class="fp-dek">{f.crisis.text} {f.crisis.how === 'house' ? 'The House voted to' : f.crisis.how === 'pm' ? 'The Prime Minister chose to' : 'Nobody decided, so the realm was left to'} <b>{f.crisis.choice.charAt(0).toLowerCase() + f.crisis.choice.slice(1)}</b>. {f.crisis.what}{f.crisis.consequence ? ' It was the price of an earlier decision.' : ''}</p>
            {f.crisis.quote && <blockquote class="fp-quote">“{f.crisis.quote.text}” <span class="small">{nm(w, f.crisis.quote.by)}</span></blockquote>}
            {f.lead && <p class="fp-dek" style={{ borderTop: '1px solid #C3B9A0', paddingTop: 8 }}><b>Also: {f.lead.headline}.</b> {f.lead.body} <span class="small">By {nm(w, f.lead.by)}, {f.lead.paper}.</span></p>}
          </>
        ) : (
          <>
            <h2 class="fp-head">{f.lead ? f.lead.headline : 'A quiet week in the realm'}</h2>
            {f.lead && <p class="fp-dek">{f.lead.body} <span class="small">By {nm(w, f.lead.by)}, {f.lead.paper}.</span></p>}
            {f.crisis && <p class="fp-dek" style={{ borderTop: '1px solid #C3B9A0', paddingTop: 8 }}><b>Crisis of the week: {f.crisis.title}.</b> {f.crisis.how === 'house' ? 'The House chose' : f.crisis.how === 'pm' ? 'The PM chose' : 'Nobody chose, so:'} “{f.crisis.choice}”.</p>}
          </>
        )}
        <div class="fp-cols">
          <div>
            <h3>The state of the realm</h3>
            <ul>
              <li>Prosperity <b>{f.meters.prosperity}</b></li>
              <li>Stability <b>{f.meters.stability}</b></li>
              <li>Standing <b>{f.meters.standing}</b></li>
            </ul>
          </div>
          <div>
            <h3>New laws</h3>
            <ul>{f.laws.length ? f.laws.map((l: any) => <li>{l.ref} {l.title}</li>) : <li>None this week</li>}</ul>
          </div>
          <div>
            <h3>In brief</h3>
            <ul>
              <li>Prime Minister: {nm(w, f.pm)}</li>
              <li>Questions dodged: {f.dodged}</li>
              <li>Scandals: {f.scandals}</li>
              {f.nextElection && <li>Polls close {fmtDay(f.nextElection)}</li>}
            </ul>
          </div>
        </div>
      </article>
      <p class="small muted" style={{ marginTop: 10 }}>Screenshot this and post it in the group.</p>
    </Page>
  );
}

export function Passport({ id }: { id?: string }) {
  const { world: w, me } = useStore();
  const pid = id || me;
  const c = w.citizens[pid];
  if (!c) return <Page title="Not found" />;
  const roles: string[] = [];
  if (isMP(w, pid)) roles.push('Member of Parliament');
  if (w.pm === pid) roles.push('Prime Minister');
  if (w.hos.holder === pid) roles.push(hosTitle(w));
  if (w.speaker === pid) roles.push('Speaker');
  officesOf(w, pid).forEach((o: any) => roles.push(o.title));
  if (c.admin) roles.push('Returning Officer (runs the game)');
  const whip = c.whip.loyal + c.whip.rebel;
  return (
    <div class="page" style={{ padding: 0 }}>
      <header class="passport-head">
        <Seal size={60} />
        <div><div class="small" style={{ opacity: 0.85 }}>{w.config.realmName}</div><h1 class="title" style={{ fontSize: 34, margin: 0 }}>Passport</h1></div>
      </header>
      <div style={{ padding: '0 max(20px, env(safe-area-inset-right, 0px)) 24px max(20px, env(safe-area-inset-left, 0px))' }}>
        <div class="grid2" style={{ marginTop: 16 }}>
          <div style={{ gridColumn: '1 / -1' }}><div class="small muted">Name</div><div class="serif" style={{ fontSize: 30 }}>{c.name}</div></div>
          <div><div class="small muted">Party</div><b>{c.party ? w.parties[c.party]?.name : 'Independent'}</b></div>
          <div><div class="small muted">Approval</div><b class="tnum">{c.approval}%</b></div>
          <div><div class="small muted">Influence</div><b class="tnum">{c.influence}</b></div>
          {(pid === me || !ONLINE) && <div><div class="small muted">Crowns</div><b class="tnum">{bal(w, ca(pid))}</b></div>}
        </div>
        <div style={{ marginTop: 10 }}><Meter value={c.approval} max={100} color={c.approval < 35 ? 'var(--red)' : 'var(--teal)'} /></div>
        <Sec title="Offices">{roles.length ? <ul class="list">{roles.map((r) => <li>{r}</li>)}</ul> : <Empty>No offices held.</Empty>}</Sec>
        {whip > 0 && <Sec title="Voting record"><Card><b class="serif" style={{ fontSize: 28 }}>{Math.round((c.whip.loyal / whip) * 100)}%</b> with the government whip in {whip} votes.{c.whip.rebel ? <span class="err-line"> {c.whip.rebel} rebellion{c.whip.rebel > 1 ? 's' : ''}, latest on {c.whip.last}.</span> : ''}</Card></Sec>}
        <Sec title="Visas" sub="A stamp for every office, vote and scandal.">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>{c.stamps.slice(0, 24).map((s: any) => <span class={'visa ' + (s.tone === 'bad' ? 'bad' : s.tone === 'ink' ? 'ink' : '')}><b>{s.label}</b><small>{s.sub}</small></span>)}</div>
        </Sec>
        {c.titles.length > 0 && <Sec title="Honours"><p style={{ margin: 0 }}>{c.titles.join(' · ')}</p></Sec>}
        {pid === me && <Sec title="Recent Influence"><ul class="list small">{c.log.slice(0, 10).map((l: any) => <li class="row"><span>{l.why}</span><b class="tnum">{l.n > 0 ? '+' : ''}{l.n}</b></li>)}</ul></Sec>}
        {pid === me && <Sec title="Learning"><a class="btn ghost small" href="#/learn">How to play · {Object.keys(c.tutorial || {}).length}/{TUTORIAL.length} missions</a></Sec>}
        {pid === me && ONLINE && <Account />}
        <p class="mrz" aria-hidden="true">P&lt;{w.config.realmName.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 3)}&lt;{c.name.toUpperCase()}&lt;&lt;{'<'.repeat(Math.max(0, 22 - c.name.length))}</p>
      </div>
    </div>
  );
}

function Account() {
  const [pw, setPw] = useState({ cur: '', next: '' });
  const [open, setOpen] = useState(false);
  const [sec, setSec] = useState<any>(null);
  const [naming, setNaming] = useState<{ id: string; name: string } | null>(null);
  const rename = () => naming && renamePasskey(naming.id, naming.name).then(() => (setNaming(null), toast('Passkey renamed.'), load())).catch(err);
  const load = () => securityInfo().then(setSec).catch(() => {});
  useEffect(() => void load(), []);
  const err = (e: any) => toast(e.message, true);
  const linked = (id: string) => sec?.identities.find((x: any) => x.provider === id);
  return (
    <Sec title="Account and security" sub={sec ? <>Signed in as <b>{sec.username}</b>{sec.lastLogin && <> · last sign-in <When at={new Date(sec.lastLogin).getTime()} /></>}</> : undefined}>
      <div class="stack">
        {sec && (
          <Card><div class="stack">
            <b>Sign-in methods</b>
            <ul class="list">
              <li class="row"><span>Password</span><span class="small muted">{sec.password ? 'Set' : 'Not set'}</span></li>
              {(sec.passkeys || []).map((k: any) => (
                <li class="row">
                  {naming?.id === k.id ? (
                    <form style={{ display: 'flex', gap: 6, flex: 1 }} onSubmit={(e) => (e.preventDefault(), rename())}>
                      <input class="input" aria-label="Passkey name" maxLength={40} value={naming.name} onInput={(e: any) => setNaming({ id: k.id, name: e.currentTarget.value })} autoFocus />
                      <Btn small kind="ghost" onClick={rename}>Save</Btn>
                    </form>
                  ) : (
                    <span>Passkey · {k.name}<span class="small muted"> · {k.last_used ? <>used <When at={new Date(k.last_used).getTime()} /></> : <>added <When at={new Date(k.created_at).getTime()} /></>}</span></span>
                  )}
                  {naming?.id !== k.id && <Btn small kind="plain" onClick={() => setNaming({ id: k.id, name: k.name })}>Rename</Btn>}
                  <Btn small kind="plain" onClick={() => confirm(`Remove the passkey "${k.name}"? Delete it from that device too.`) && removePasskey(k.id).then(() => (toast('Passkey removed.'), load())).catch(err)}>Remove</Btn>
                </li>
              ))}
              {passkeysWork() && (
                <li class="row">
                  <span>{sec.passkeys?.length ? 'Another passkey' : 'Passkey'}<span class="small muted"> · your face, fingerprint or device PIN</span></span>
                  <Btn small kind="ghost" onClick={() => addPasskey().then(() => (toast('Passkey added. Next time, tap "Sign in with a passkey".'), load())).catch(err)}>Add</Btn>
                </li>
              )}
              {sec.providers.map((x: any) => (
                <li class="row">
                  <span>{x.name}{linked(x.id)?.email && <span class="small muted"> · {linked(x.id).email}</span>}</span>
                  {linked(x.id)
                    ? <Btn small kind="plain" onClick={() => unlinkProvider(x.id).then(() => (toast(`${x.name} unlinked.`), load())).catch(err)}>Unlink</Btn>
                    : <Btn small kind="ghost" onClick={() => beginOAuth(x.id, 'link').catch(err)}>Link</Btn>}
                </li>
              ))}
            </ul>
            <span class="small muted">A passkey lives on your device and can't be guessed or phished. {sec.providers.length > 0 && 'Linking lets you sign in with that account instead of your password. We only learn its name and email, and never post anything.'}</span>
          </div></Card>
        )}
        {open ? (
          <Card><div class="stack">
            {sec?.password !== false && <PasswordField label="Current password" value={pw.cur} onInput={(v) => setPw({ ...pw, cur: v })} autoComplete="current-password" />}
            <PasswordField label="New password" value={pw.next} onInput={(v) => setPw({ ...pw, next: v })} autoComplete="new-password" hint="At least 10 characters. Changing it signs out your other devices." />
            <div class="row" style={{ gap: 8, justifyContent: 'flex-end' }}>
              <Btn small kind="plain" onClick={() => setOpen(false)}>Cancel</Btn>
              <Btn small onClick={() => changePassword(pw.cur, pw.next).then(() => (toast('Password saved. Other devices are signed out.'), setOpen(false), setPw({ cur: '', next: '' }), load())).catch(err)}>{sec?.password === false ? 'Set password' : 'Change password'}</Btn>
            </div>
          </div></Card>
        ) : (
          <div class="row" style={{ justifyContent: 'flex-start', gap: 10, flexWrap: 'wrap' }}>
            <Btn kind="ghost" small onClick={() => setOpen(true)}>{sec?.password === false ? 'Set a password' : 'Change password'}</Btn>
            <Btn kind="ghost" small onClick={() => signOutEverywhere().then(() => toast('Every other device is signed out.')).catch(err)}>Sign out everywhere else</Btn>
            <Btn kind="ghost" small href="#/developers">Build your own app</Btn>
            <Btn kind="plain" small onClick={signOut}>Sign out</Btn>
          </div>
        )}
      </div>
    </Sec>
  );
}

export function Laws() {
  const { world: w } = useStore();
  const [q, setQ] = useState('');
  const [tab, setTab] = useState('laws');
  const laws = w.laws.filter((l: any) => !q || (l.title + l.summary + l.text.join(' ')).toLowerCase().includes(q.toLowerCase()));
  return (
    <Page kicker="The statute book" title="Laws" intro="Every law in force, and the constitution they all rest on.">
      <div style={{ marginTop: 16 }}><Seg value={tab} onChange={setTab} options={[['laws', 'Statute book'], ['constitution', 'Constitution']]} /></div>
      {tab === 'laws' ? (
        <>
          <div style={{ marginTop: 12 }}><Field label="Search" value={q} onInput={setQ} placeholder="Try “holiday”" /></div>
          <Sec><ul class="list">{laws.slice().reverse().map((l: any) => <LinkRow href={'#/law/' + l.ref} title={<>{l.ref} <span style={{ textDecoration: l.repealed ? 'line-through' : 'none' }}>{l.classified ? 'Classified Act' : l.title}</span></>} sub={l.repealed ? 'Repealed' : l.classified ? 'Its contents are secret' : l.summary} />)}</ul></Sec>
        </>
      ) : <Constitution />}
    </Page>
  );
}
function Constitution() {
  const { world: w } = useStore();
  const rows: [string, string][] = [
    ['Name', w.config.realmName],
    ['Head of state', w.config.hos === 'monarchy' ? `A Monarch (${w.config.hosTitle})` : 'A President'],
    ['Seats', `${w.config.seats}, the top ${w.config.seats} candidates nationwide`],
    ['Empty seats', 'Filled by the next candidate in line'],
    ['Elections', `Every ${w.config.termDays / 7} weeks`],
    ['Debates', `${w.config.debateHours} hours, then ${w.config.voteHours} hours to vote`],
    ['Constitutional change', `${Math.ceil(w.config.seats * 0.8)} of ${w.config.seats} MPs`]
  ];
  return (
    <Sec>
      <Card><ul class="list">{rows.map(([k, v]) => <li class="row"><span class="muted">{k}</span><b style={{ textAlign: 'right' }}>{v}</b></li>)}</ul></Card>
      <p class="small muted">Change any of this with a constitutional bill. <a href="#/new">Draft one</a>.</p>
    </Sec>
  );
}
export function Law({ refId }: { refId: string }) {
  const { world: w } = useStore();
  const l = w.laws.find((x: any) => x.ref === refId);
  const me = useStore().me;
  useEffect(() => void (l?.ref === 'L001' && !w.citizens[me]?.tutorial?.law && act('tutorial.visit', { mission: 'law' })), [refId]);
  if (!l) return <Page title="No such law" back={['#/laws', 'Laws']} />;
  return (
    <Page back={['#/laws', 'Laws']} kicker={`${l.ref}, ${fmtDay(l.at)}, ${l.how}`} title={l.classified ? 'Classified Act' : l.title} intro={l.classified ? 'This Act created a secret body. Its contents are known only to its members.' : l.summary}>
      {!l.classified && <Sec><ol class="stack" style={{ paddingLeft: 22, margin: 0 }}>{l.text.map((t: string) => <li style={{ fontSize: 17 }}>{t}</li>)}</ol></Sec>}
      {l.rulings.length > 0 && <Sec title="Court rulings"><ul class="list">{l.rulings.map((r: string) => <li>{r}</li>)}</ul></Sec>}
      {l.repealed ? <p class="err-line">Repealed.</p> : l.ref !== 'L001' && <Btn href={'#/new?repeal=' + l.ref} kind="ghost" style={{ marginTop: 18 }}>Propose repealing it</Btn>}
    </Page>
  );
}

export function Calendar() {
  const { world: w, me } = useStore();
  const admin = w.citizens[me].admin;
  return (
    <Page kicker="The calendar" title="The week" intro="The same rhythm every week. The Returning Officer sets the times; lengths change by law.">
      <Sec title="Every week">
        <div class="stack">
          {Object.entries(CAL_EVENTS).map(([k, e]) => (
            <Card>
              <div class="row"><b class="serif" style={{ fontSize: 20 }}>{e.name}</b><span class="small tnum">Next: {fmtTime(w, nextAt(w, k))}</span></div>
              <p class="small muted" style={{ margin: '4px 0 8px' }}>{e.what}. {DAYS[w.calendar[k].dow]}s at {String(w.calendar[k].hour).padStart(2, '0')}:00.</p>
              {admin && (
                <div class="grid2">
                  <Pick label="Day" value={String(w.calendar[k].dow)} onChange={(v) => act('admin.calendar', { key: k, dow: v, hour: w.calendar[k].hour }, 'Calendar updated.')} options={DAYS.map((d, i) => [String(i), d])} />
                  <Pick label="Time" value={String(w.calendar[k].hour)} onChange={(v) => act('admin.calendar', { key: k, dow: w.calendar[k].dow, hour: v }, 'Calendar updated.')} options={Array.from({ length: 24 }, (_, h) => [String(h), String(h).padStart(2, '0') + ':00'])} />
                </div>
              )}
            </Card>
          ))}
        </div>
        {!admin && <p class="small muted">Only the Returning Officer moves these. Switch to Uzair in the demo panel to try it.</p>}
      </Sec>
      <Sec title="Set by law">
        <Card><ul class="list">
          <li class="row"><span>Debate length</span><b>{w.config.debateHours} hours</b></li>
          <li class="row"><span>Voting length</span><b>{w.config.voteHours} hours</b></li>
          <li class="row"><span>Between general elections</span><b>{w.config.termDays / 7} weeks</b></li>
        </ul></Card>
        <Btn href="#/new" kind="ghost" style={{ marginTop: 10 }}>Propose a change</Btn>
      </Sec>
    </Page>
  );
}
