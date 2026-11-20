// Coups in the open: the contested night, life under a regime (decrees, resistance), the provisional government
// that follows a fall, and the reckoning. Planning a coup is private and lives in the backroom (Plots).
import { useState } from 'preact/hooks';
import { StoryText, plainHeadline } from '../StoryText';
import { useStore, act } from '../store';
import { Page, Sec, Card, Btn, Field, Pick, Seg, Opt, Meter, When, Left, Who, Empty } from '../ui';
import { nm, allCitizens, exiled, detained, held as isHeld, isMP, holderOf, hosTitle, fmtDay, fmtTime, DAY } from '../../../engine/index';
import { coupTally } from '../../../engine/backroom';
import { REGIMES, DECREES, REWRITE, LIFT, FORMS, ACTS, VERDICTS, strikeNeed, strikeOn, detainees, partyShare, arbiter, canJudge } from '../../../engine/regime';
import { VOTING, members } from '../../../engine/politics';

const names = (w: any, ids: string[]) => ids.map((id) => nm(w, id)).join(', ') || 'nobody';
const people = (w: any, ok: (c: any) => boolean = () => true): [string, string][] => allCitizens(w).filter(ok).map((c: any) => [c.id, c.name]);

export function Regime() {
  const { world: w } = useStore();
  const any = w.coup || w.regime || w.transition || w.reckoning;
  return (
    <Page kicker={w.regime ? REGIMES[w.regime.type].name : w.coup ? 'A coup is under way' : w.transition ? 'Provisional government' : 'Power'} title={w.regime ? (w.regime.type === 'civil' ? 'Rule by decree' : `The regime of ${nm(w, w.regime.leader)}`) : w.coup ? 'The night of the coup' : w.transition ? 'After the fall' : w.reckoning ? 'The reckoning' : 'Coups and regimes'}
      intro={w.regime?.type === 'civil' ? 'The Prime Minister’s decrees under the Government Powers Act, and what the realm can do about them.' : w.regime ? 'Its legitimacy is its lifeline: at zero it falls. Every decree costs some, and so does every act of resistance.' : w.coup ? 'Every citizen may declare for the coup or against it. When the night ends, the heavier side wins.' : w.transition ? 'Somebody has to mind the realm until it can vote. It rarely goes smoothly.' : 'What happens when someone takes the realm by force, and what it costs them.'}>
      {w.coup && <Night />}
      {w.regime && <Under />}
      {w.transition && <Transition />}
      {w.reckoning && <Reckoning />}
      {!any && <Sec><Empty>The realm is governed by its Parliament. Nobody has seized it. Yet.</Empty></Sec>}
      <History />
    </Page>
  );
}

// ---------- the contested night ----------
function Night() {
  const { world: w, me } = useStore();
  const k = w.coup;
  const t = coupTally(w);
  const plotter = k.plotters.includes(me);
  const side = (s: string) => t.lines.filter((l) => l[0] === s);
  return (
    <Sec title={k.name} sub={<>Led by {nm(w, k.leader)} against the {k.against}. It ends in <Left at={k.endsAt} />.</>}>
      <div class="grid2">
        <Card kind="warn"><div class="kicker" style={{ margin: 0 }}>For the coup</div><div class="serif tnum" style={{ fontSize: 40, lineHeight: 1 }}>{t.coup}</div><ul class="list small">{side('coup').map((l) => <li class="row"><span>{l[2]}</span><b class="tnum">+{l[1]}</b></li>)}</ul></Card>
        <Card kind="tint"><div class="kicker" style={{ margin: 0 }}>Against it</div><div class="serif tnum" style={{ fontSize: 40, lineHeight: 1 }}>{t.gov}</div><ul class="list small">{side('gov').map((l) => <li class="row"><span>{l[2]}</span><b class="tnum">+{l[1]}</b></li>)}{!side('gov').length && <li class="muted">Nobody has stood up yet.</li>}</ul></Card>
      </div>
      <p class="small muted">The General counts for 3, the {hosTitle(w)} for 2, everyone else for 1. A tie means the coup fails and its plotters go into exile.</p>
      {plotter ? (
        k.leader !== me && <Btn kind="ghost" full onClick={() => act('coup.defect', {}, 'You have changed sides.')}>Abandon the coup and declare against it</Btn>
      ) : exiled(w, me) || detained(w, me) ? null : (
        <div class="grid2">
          <Btn kind={k.declared[me] === 'gov' ? 'plain' : undefined} disabled={k.declared[me] === 'gov'} onClick={() => act('coup.declare', { side: 'gov' }, 'Declared. Everyone can see it.')}>{k.declared[me] === 'gov' ? 'You stand against it' : `Declare for the ${k.against}`}</Btn>
          <Btn kind={k.declared[me] === 'coup' ? 'plain' : 'danger'} disabled={k.declared[me] === 'coup'} onClick={() => act('coup.declare', { side: 'coup' }, 'Declared. Everyone can see it.')}>{k.declared[me] === 'coup' ? 'You back the coup' : 'Declare for the coup'}</Btn>
        </div>
      )}
    </Sec>
  );
}

// ---------- under a regime ----------
function Under() {
  const { world: w, me } = useStore();
  const r = w.regime;
  const leader = r.leader === me;
  const inside = leader || r.council.includes(me);
  const days = Math.floor((w.now - r.startedAt) / DAY);
  const held = detainees(w);
  const flags = [r.censorship && 'Censorship', r.curfew && 'Curfew, 22:00 to 06:00', w.martial && 'Parliament suspended', r.conscription && 'Conscription', r.trade && 'Trade nationalised', r.oath && 'Loyalty oath', strikeOn(w) && 'General strike: no payday'].filter(Boolean) as string[];
  const reaction = (v: string) => Object.keys(r.foreign).filter((n) => r.foreign[n] === v).map((n) => w.nations[n]?.name);
  return (
    <>
      <Sec>
        <Card kind="warn">
          {r.type === 'civil' ? <p class="small" style={{ margin: 0 }}>{REGIMES.civil.what} {w.pm ? `The Prime Minister is ${nm(w, w.pm)}.` : 'There is no Prime Minister right now.'}</p> : (
            <>
              <div class="kicker" style={{ margin: 0 }}>{r.president ? 'President' : REGIMES[r.type].ruler} · Legitimacy</div>
              <div class="serif tnum" style={{ fontSize: 44, lineHeight: 1 }}>{r.legit}</div>
              <Meter value={r.legit} max={Math.max(12, r.legit0)} color="var(--red)" />
              <p class="small" style={{ margin: '8px 0 0' }}>Day {days + 1}. {r.until ? <>It must hand back power by <When at={r.until} />.</> : 'It has set no date to go.'} {REGIMES[r.type].what}</p>
            </>
          )}
          {!['dictatorship', 'civil'].includes(r.type) && r.council.length > 1 && <p class="small" style={{ margin: '4px 0 0' }}>{r.type === 'party' ? 'Founders' : 'Council'}: {names(w, r.council)}.</p>}
          {r.type === 'party' && <p class="small" style={{ margin: '4px 0 0' }}>The {w.parties[r.party]?.name} has {members(w, r.party).length} of {allCitizens(w).length} citizens ({Math.round(partyShare(w) * 100)}%). It needs half.</p>}
          {flags.length > 0 && <p class="small" style={{ margin: '4px 0 0' }}><b>In force:</b> {flags.join(' · ')}.</p>}
          {held.length > 0 && <p class="small" style={{ margin: '4px 0 0' }}><b>Detained:</b> {held.map((id) => `${nm(w, id)} (until ${fmtTime(w, w.citizens[id].detainedUntil)})`).join(', ')}.</p>}
          {Object.keys(r.marked).length > 0 && <p class="small" style={{ margin: '4px 0 0' }}><b>Marked</b> (can be arrested or exiled at no cost): {Object.entries(r.marked).map(([id, why]: any) => `${nm(w, id)}, ${String(why).toLowerCase()}`).join('; ')}.</p>}
          <p class="small muted" style={{ margin: '4px 0 0' }}>{reaction('recognise').length ? `Recognised by ${reaction('recognise').join(', ')}. ` : ''}{reaction('sanction').length ? `Sanctioned by ${reaction('sanction').join(', ')}. ` : ''}{r.exileGov ? `${w.nations[r.exileGov]?.name} hosts a government in exile.` : ''}</p>
        </Card>
      </Sec>
      {r.ousted === me && !r.fled && !r.stood && (
        <Sec title="You were overthrown" sub="Flee and you are safe abroad: seek asylum, and if that nation doesn’t recognise the regime you lead a government in exile that drains it every day. Stay and you cost them 3 legitimacy at once, but they can arrest you.">
          <div class="grid2"><Btn onClick={() => act('coup.flee', { flee: false }, 'You stay.')}>Stay and face them</Btn><Btn kind="ghost" onClick={() => act('coup.flee', { flee: true }, 'You are over the border. Seek asylum from the Exile page.')}>Flee the realm</Btn></div>
        </Sec>
      )}
      {isHeld(w, me) && <Cell />}
      {(r.type === 'civil' ? w.pm === me : leader) && <Desk />}
      {inside && <Inside />}
      {r.police === me && <Police />}
      {!inside && !detained(w, me) && !exiled(w, me) && <Resist />}
      <Asked />
      <Sec title="Decrees">
        <ul class="list">{r.decrees.slice(0, 12).map((d: any) => <li><span>{d.text}<div class="small muted">{fmtTime(w, d.at)}</div></span></li>)}</ul>
        {!r.decrees.length && <Empty>No decrees yet.</Empty>}
      </Sec>
      {r.type !== 'civil' && <Sec title="What has moved its legitimacy"><ul class="list small">{r.log.slice(0, 10).map((l: any) => <li class="row"><span>{l.why}</span><b class="tnum" style={{ color: l.d < 0 ? 'var(--red)' : 'var(--teal)' }}>{l.d > 0 ? '+' : ''}{l.d}</b></li>)}</ul>{!r.log.length && <Empty>Nothing yet.</Empty>}</Sec>}
    </>
  );
}

// the form for a built-in decree: the regime's leader (regime.decree), or the PM under the Government Powers Act (gov.edict)
export function DecreeForm({ type, cmd, council }: { type: string; cmd: string; council?: boolean }) {
  const { world: w, me } = useStore();
  const r = w.regime;
  const kinds = Object.keys(DECREES).filter((k) => DECREES[k].types.includes(type));
  const [kind, setKind] = useState('');
  const [a, setA] = useState<any>({ target: '', party: '', bank: '', n: '', to: '', key: 'voting', value: '', text: '', what: '' });
  const set = (k: string, v: any) => setA({ ...a, [k]: v });
  const d = kind ? DECREES[kind] : null;
  const needs = d?.arg || [];
  const groups = [...new Set(kinds.map((k) => DECREES[k].group))];
  const send = () => {
    const args: any = { kind };
    needs.forEach((k) => {
      if (k === 'n') args.n = Number(a.n);
      else if (k === 'key') (args.key = a.key), (args.value = a.key === 'termDays' ? Number(a.value) : a.value);
      else if (a[k]) args[k] = a[k];
    });
    act(cmd, args, council ? 'Sent to the council.' : 'Decreed.');
  };
  const banks = (Object.values(w.banks) as any[]).filter((b) => b.status === 'open').map((b): [string, string] => [b.id, b.name]);
  const civil = type === 'civil';
  return (
    <div class="stack">
      <Pick value={kind} onChange={setKind} empty="Choose a decree" options={groups.flatMap((g) => kinds.filter((k) => DECREES[k].group === g).map((k): [string, string] => [k, `${g}: ${DECREES[k].name}${civil ? '' : ` (${DECREES[k].cost})`}`]))} />
      {d && <p class="small" style={{ margin: 0 }}>{d.what}</p>}
      {needs.includes('target') && <Pick label={kind === 'seize' ? 'A citizen (or pick a bank below)' : 'Who'} value={a.target} onChange={(v) => set('target', v)} empty="Pick someone" options={people(w, (c) => c.id !== me)} />}
      {needs.includes('party') && <Pick label="Party" value={a.party} onChange={(v) => set('party', v)} empty="Pick a party" options={(Object.values(w.parties) as any[]).filter((p) => p.status === 'active' && p.id !== r?.party).map((p): [string, string] => [p.id, p.name])} />}
      {needs.includes('bank') && (banks.length ? <Pick label={kind === 'nationalise' ? 'A bank (leave empty to nationalise foreign trade)' : 'Or a bank'} value={a.bank} onChange={(v) => set('bank', v)} empty={kind === 'nationalise' ? 'Foreign trade' : 'No bank'} options={banks} /> : kind === 'nationalise' ? <p class="small muted" style={{ margin: 0 }}>There are no banks, so this nationalises foreign trade.</p> : null)}
      {needs.includes('n') && <Field label={kind === 'arrest' ? 'Days held (1 or 2)' : kind === 'plan' ? 'Crowns promised (20 to 300)' : kind === 'tax' ? 'Tax rate, % (0 to 40)' : 'Interest rate, % (0 to 15)'} type="number" value={a.n} onInput={(v) => set('n', v)} />}
      {needs.includes('to') && <Pick label="Become" value={a.to} onChange={(v) => set('to', v)} empty="Choose" options={(r?.type === 'martial' ? ['junta', 'dictatorship'] : r?.type === 'junta' ? ['dictatorship', 'party'] : ['party']).map((t): [string, string] => [t, REGIMES[t].name])} />}
      {needs.includes('offer') && <Pick label="Treaty" value={a.offer || ''} onChange={(v) => set('offer', v)} empty={Object.keys(w.offers).length ? 'Pick an offer' : 'No treaty is on offer'} options={(Object.values(w.offers) as any[]).map((o) => [o.id, o.title])} />}
      {needs.includes('what') && <Pick label="Lift" value={a.what} onChange={(v) => set('what', v)} empty="Choose" options={Object.entries(LIFT)} />}
      {needs.includes('key') && (
        <>
          <Pick label="Rewrite" value={a.key} onChange={(v) => setA({ ...a, key: v, value: '' })} options={Object.entries(REWRITE)} />
          {a.key === 'termDays' ? <Field label="Days (7 to 42)" type="number" value={a.value} onInput={(v) => set('value', v)} /> : <Pick label="To" value={a.value} onChange={(v) => set('value', v)} empty="Choose" options={a.key === 'voting' ? Object.entries(VOTING).map(([k, v]): [string, string] => [k, v.short]) : [['cast', 'A majority of votes cast'], ['seats', 'A majority of all seats'], ['twothirds', 'Two-thirds']]} />}
        </>
      )}
      {needs.includes('text') && <Field label="Title" value={a.text} onInput={(v) => set('text', v)} placeholder="Hero of the Realm" />}
      <Btn kind="danger" full disabled={!kind} onClick={send}>{council ? 'Put it to the council' : 'Decree it'}</Btn>
    </div>
  );
}

// the leader's desk: how to rule, the day's decree, the censor, the Party's applicants, the way out
function Desk() {
  const { world: w } = useStore();
  const r = w.regime;
  const civil = r.type === 'civil';
  const heldStories = w.stories.filter((s: any) => s.status === 'held');
  return (
    <>
      {!r.chosen && w.now < r.chooseBy && (
        <Sec title="How will you rule?" sub={<>Free for the next <Left at={r.chooseBy} />. After that it stays martial law, and changing it costs 3 legitimacy.</>}>
          <div class="stack">{['martial', 'junta', 'dictatorship'].map((t) => <Opt on={r.type === t && r.chosen} onClick={() => act('regime.form', { type: t }, 'So be it.')} title={REGIMES[t].name} hint={REGIMES[t].what} />)}</div>
        </Sec>
      )}
      <Sec title="Issue a decree" sub={civil ? 'One a day, under the Government Powers Act. No legitimacy to lose.' : 'One a day. The cost is in legitimacy.'}>
        <DecreeForm type={r.type} cmd={civil ? 'gov.edict' : 'regime.decree'} council={r.type === 'junta' && r.council.length >= 3} />
      </Sec>
      {heldStories.length > 0 && <Sec title="The censor’s desk">{heldStories.map((s: any) => <Card><div class="kicker" style={{ margin: 0 }}>{w.papers[s.paper]?.name}</div><b>{plainHeadline(s.headline)}</b><StoryText small text={s.body} /><div class="small muted">By {nm(w, s.by)}</div><div class="grid2" style={{ marginTop: 8 }}><Btn small onClick={() => act('regime.censor', { story: s.id, allow: true }, 'Printed.')}>Let it run</Btn><Btn small kind="danger" onClick={() => act('regime.censor', { story: s.id, allow: false }, 'Struck out.')}>Strike it out</Btn></div></Card>)}</Sec>}
      {r.applicants.length > 0 && <Sec title="Applications for a Party card"><ul class="list">{r.applicants.map((id: string) => <li class="row"><Who id={id} /><span class="row" style={{ gap: 6 }}><Btn small onClick={() => act('regime.admit', { target: id, yes: true }, 'Admitted.')}>Admit</Btn><Btn small kind="plain" onClick={() => act('regime.admit', { target: id, yes: false }, 'Refused.')}>Refuse</Btn></span></li>)}</ul></Sec>}
      {!civil && (
        <Sec title="The way out" sub={`Offer to hand back power in return for amnesty. ${arbiter(w) ? `The ${hosTitle(w)} can refuse, which costs you 1.` : 'There is nobody to refuse: it takes effect after a day.'}`}>
          {r.exit ? <Card>Your offer is on the table until <When at={r.exit.dueAt} />.</Card> : <Btn kind="ghost" full onClick={() => act('regime.exit', {}, 'The offer is made.')}>Offer to hand back power</Btn>}
        </Sec>
      )}
    </>
  );
}

// the council and the leader: the decree before the council, moving against the leader, leaking the rigging
function Inside() {
  const { world: w, me } = useStore();
  const r = w.regime;
  const p = r.pending;
  const canOust = r.leader !== me && r.type !== 'dictatorship' && r.type !== 'party';
  return (
    <>
      {p && (
        <Sec title="Before the council" sub={<>A majority of the {r.council.length} must agree. It lapses in <Left at={p.dueAt} />.</>}>
          <Card><b>{DECREES[p.kind]?.name}</b>{p.args?.target ? `: ${nm(w, p.args.target)}` : ''}<div class="small muted">{Object.entries(p.votes || {}).map(([id, v]) => `${nm(w, id)} ${v ? 'aye' : 'no'}`).join(', ')}</div>
            {p.votes?.[me] === undefined && <div class="grid2" style={{ marginTop: 8 }}><Btn small onClick={() => act('regime.council', { yes: true }, 'Aye.')}>Agree</Btn><Btn small kind="plain" onClick={() => act('regime.council', { yes: false }, 'No.')}>Refuse</Btn></div>}
          </Card>
        </Sec>
      )}
      {r.leader !== me && (canOust || (r.rigged && r.rigged.election)) && (
        <Sec title="From the inside">
          <div class="stack">
            {canOust && <Btn kind="danger ghost" full disabled={!!r.ouster} onClick={() => act('regime.palace', {}, 'You have moved against the leader.')}>{r.ouster ? 'You have moved against the leader. It needs a majority of the council' : 'Move against the leader (a majority of the council removes them)'}</Btn>}
            {r.rigged && r.rigged.election && <Btn kind="danger" full onClick={() => act('regime.leak', {}, 'It is out.')}>Leak that the election is rigged (the regime falls)</Btn>}
          </div>
        </Sec>
      )}
    </>
  );
}

function Police() {
  const { world: w, me } = useStore();
  const r = w.regime;
  const [t, setT] = useState('');
  return (
    <Sec title="The secret police" sub="One name a day. The answer is true. Anyone you checked in the last day can’t pull off a jailbreak.">
      <div class="grid2"><Pick value={t} onChange={setT} empty="Pick a name" options={people(w, (c) => c.id !== me)} /><Btn kind="ghost" onClick={() => act('police.probe', { target: t }, 'The file is on your desk.')}>Open a file</Btn></div>
      <ul class="list small" style={{ marginTop: 8 }}>{r.probes.map((p: any) => <li><span><b>{nm(w, p.target)}</b>: {[p.strike && 'signed the strike', p.underground && 'wrote for the underground press', p.plot && 'is in a plot'].filter(Boolean).join(', ') || 'nothing against them'}<div class="muted">{fmtTime(w, p.at)}</div></span></li>)}</ul>
      {r.rigged && r.rigged.election && <Btn kind="danger" full style={{ marginTop: 8 }} onClick={() => act('regime.leak', {}, 'It is out.')}>Leak that the election is rigged (the regime falls)</Btn>}
    </Sec>
  );
}

function Cell() {
  const { world: w, me } = useStore();
  const [t, setT] = useState('');
  return (
    <Sec title="You are detained" sub={<>Until <When at={w.citizens[me].detainedUntil} />. You can read everything. You can’t vote, speak or use your office. One letter a day gets out, and the censor can’t stop it.</>}>
      <div class="stack"><Field label="A letter from prison" area value={t} onInput={setT} /><Btn full onClick={() => (act('prison.letter', { text: t }, 'Smuggled out. It is in the Gazette.'), setT(''))}>Smuggle it out</Btn></div>
    </Sec>
  );
}

// everyone outside the regime: the strike, the underground press, jailbreaks, and (for the right people) a palace coup
function Resist() {
  const { world: w, me } = useStore();
  const r = w.regime;
  const [f, setF] = useState({ headline: '', body: '' });
  const [jb, setJb] = useState('');
  const held = detainees(w);
  const need = strikeNeed(w);
  const signed = r.strike.includes(me);
  const general = r.type === 'dictatorship' && w.offices.army && holderOf(w, 'army') === me;
  const member = r.type === 'party' && w.citizens[me].party === r.party;
  return (
    <Sec title="Resistance">
      <div class="stack">
        <Card>
          <b>The general strike</b>
          <p class="small" style={{ margin: '4px 0 8px' }}>{r.strikeN ?? r.strike.length} of the {need} signatures it needs. Once it holds there is no payday{r.type === 'civil' ? '' : ', and the regime loses 1 legitimacy a day'}. Nobody can see who has signed, except the secret police if they check your name.</p>
          <Btn kind={signed ? 'plain' : undefined} full onClick={() => act('regime.strike', {}, signed ? 'Your name is off it.' : 'Signed.')}>{signed ? 'Take your name off the strike' : 'Sign the strike'}</Btn>
        </Card>
        {r.censorship && (
          <Card>
            <b>The underground press</b>
            <p class="small" style={{ margin: '4px 0 8px' }}>An unsigned pamphlet the censor can’t stop. Three times in ten the author is found out and marked.</p>
            <div class="stack"><Field label="Headline" value={f.headline} onInput={(v) => setF({ ...f, headline: v })} /><Field label="Pamphlet" area value={f.body} onInput={(v) => setF({ ...f, body: v })} /><Btn kind="ghost" full onClick={() => (act('press.underground', f, 'Printed and passed on.'), setF({ headline: '', body: '' }))}>Print it</Btn></div>
          </Card>
        )}
        {held.length > 0 && (
          <Card>
            <b>A jailbreak</b>
            <p class="small" style={{ margin: '4px 0 8px' }}>It takes two. It fails if the secret police checked either of you in the last day, and then you are both marked.{Object.keys(r.breaks).length ? ` You are waiting for a second pair of hands for ${names(w, Object.keys(r.breaks))}.` : ''}</p>
            <div class="grid2"><Pick value={jb} onChange={setJb} empty="Who to free" options={held.map((id): [string, string] => [id, nm(w, id)])} /><Btn kind="ghost" onClick={() => act('prison.break', { target: jb }, 'You are in.')}>Join the break</Btn></div>
          </Card>
        )}
        {general && <Btn kind="danger" full onClick={() => act('regime.palace', {}, 'The Army has acted.')}>As General: remove the dictator{r.heir ? ` (the heir, ${nm(w, r.heir)}, takes over)` : ''}</Btn>}
        {member && (
          <Card>
            <b>Inside the Party</b>
            <p class="small" style={{ margin: '4px 0 8px' }}>A majority of members can replace the Chairman, or vote to restore free elections (which ends the regime with amnesty).</p>
            <div class="grid2"><Btn kind="ghost" disabled={!!r.ouster} onClick={() => act('regime.palace', {}, 'You have moved against the Chairman.')}>{r.ouster ? 'Moved against the Chairman' : 'Move against the Chairman'}</Btn><Btn disabled={r.freeVotes.includes(me)} onClick={() => act('regime.free', {}, 'Your vote is cast.')}>{r.freeVotes.includes(me) ? 'Voted for free elections' : 'Vote for free elections'}</Btn></div>
          </Card>
        )}
        {r.type === 'party' && !member && (r.applicants.includes(me) ? <Card>Your application for a Party card is with the Chairman.</Card> : <Btn kind="ghost" full onClick={() => act('regime.apply', {}, 'Application sent.')}>Apply for a Party card (2 crowns a payday; you may stand and hold office)</Btn>)}
        <p class="small muted" style={{ margin: 0 }}>{r.type === 'civil' ? <>A coup against the Prime Minister is planned in the <a href="#/plots">backroom</a>, and ends every decree in force.</> : <>A counter-coup is planned in the <a href="#/plots">backroom</a>. Once the regime is down to half its legitimacy, two plotters are enough.</>}</p>
      </div>
    </Sec>
  );
}

// things the regime has asked of everyone: the oath, the trial, the plebiscite; and the offer the head of state answers
function Asked() {
  const { world: w, me } = useStore();
  const r = w.regime;
  const can = !exiled(w, me) && !detained(w, me);
  const two = (cmd: string, key: string, yes: string, no: string, done: [string, string]) => <div class="grid2" style={{ marginTop: 8 }}><Btn small onClick={() => act(cmd, { [key]: true }, done[0])}>{yes}</Btn><Btn small kind="ghost" onClick={() => act(cmd, { [key]: false }, done[1])}>{no}</Btn></div>;
  const oath = r.oath && r.leader !== me;
  const sworn = r.oath ? Object.keys(r.oath).filter((id) => r.oath[id] === 'sworn') : [];
  const refused = r.oath ? Object.keys(r.oath).filter((id) => r.oath[id] === 'refused') : [];
  if (!oath && !r.trial && !r.plebiscite && !(r.exit && arbiter(w) === me)) return null;
  return (
    <Sec title="Asked of you">
      <div class="stack">
        {r.exit && arbiter(w) === me && <Card kind="tint"><b>The regime offers to go.</b><p class="small" style={{ margin: '4px 0 0' }}>Accept and it ends now, with amnesty for those who ran it and an election at once. Refuse and it loses 1 legitimacy and carries on. Say nothing and it is accepted on <When at={r.exit.dueAt} />.</p>{two('regime.exitAnswer', 'yes', 'Accept', 'Refuse', ['Accepted.', 'Refused.'])}</Card>}
        {oath && <Card><b>The loyalty oath.</b><p class="small" style={{ margin: '4px 0 0' }}>Swear and you get 3 crowns and are listed as a collaborator when it ends. Refuse and you are marked: the regime can arrest or exile you at no cost. Both are public.</p><p class="small muted" style={{ margin: '4px 0 0' }}>Sworn: {names(w, sworn)}. Refused: {names(w, refused)}.</p>{can && !r.oath[me] && two('regime.oath', 'swear', 'Swear', 'Refuse', ['Sworn.', 'Refused.'])}</Card>}
        {r.trial && <Card><b>The trial of {nm(w, r.trial.target)}.</b><p class="small" style={{ margin: '4px 0 0' }}>Closes <When at={r.trial.closesAt} />. {r.trial.cast ?? Object.keys(r.trial.votes).length} have answered. If more believe it than not, the regime gains 2 and the accused loses standing. Otherwise it loses 4.</p>{can && r.trial.target !== me && r.leader !== me && r.trial.votes[me] === undefined ? two('regime.verdict', 'believe', 'I believe it', 'I don’t', ['Noted.', 'Noted.']) : r.trial.votes[me] !== undefined && <p class="small muted" style={{ margin: '4px 0 0' }}>You said you {r.trial.votes[me] ? 'believe it' : 'don’t believe it'}.</p>}</Card>}
        {r.plebiscite && <Card kind="tint"><b>Plebiscite: should {nm(w, r.leader)} lead the realm as President?</b><p class="small" style={{ margin: '4px 0 0' }}>Closes <When at={r.plebiscite.closesAt} />. {r.plebiscite.cast ?? Object.keys(r.plebiscite.votes).length} have voted. More yes than no and the regime’s legitimacy is restored. Otherwise it ends. Your vote is secret.</p>{can && r.plebiscite.votes[me] === undefined ? two('regime.vote', 'yes', 'Yes', 'No', ['Vote cast.', 'Vote cast.']) : r.plebiscite.votes[me] !== undefined && <p class="small muted" style={{ margin: '4px 0 0' }}>You voted {r.plebiscite.votes[me] ? 'yes' : 'no'}.</p>}</Card>}
      </div>
    </Sec>
  );
}

// ---------- the provisional government ----------
function Transition() {
  const { world: w, me } = useStore();
  const t = w.transition;
  const lead = t.leader === me;
  const claimants = Object.keys(t.claims).filter((k) => k !== t.leader);
  const backing = Object.keys(t.claims).find((k) => t.claims[k].includes(me));
  const can = !exiled(w, me) && !detained(w, me);
  return (
    <>
      <Sec title={t.form ? FORMS[t.form].name : 'A provisional government'} sub={<>Led by {nm(w, t.leader)}. {t.form ? FORMS[t.form].what : <>They have <Left at={t.formDue} /> to decide what kind; otherwise it is a government of national unity.</>} Expect trouble: each day may bring a new crisis for them to handle.</>}>
        {lead && !t.form && <div class="stack">{Object.entries(FORMS).map(([k, f]) => <Opt onClick={() => act('transition.form', { kind: k }, 'Decided.')} title={f.name} hint={`${f.what} ${f.effects.join(' · ')}.`} />)}</div>}
        {t.form === 'council' && <p class="small">The council: {names(w, t.council)}.</p>}
        {t.amnesty && <Card kind="green">An amnesty has been declared. There will be no reckoning.</Card>}
      </Sec>
      {lead && (
        <Sec title="Settling accounts" sub="Each can be done once. You can forgive the regime’s people or bar them, not both.">
          <div class="stack">{Object.entries(ACTS).map(([k, a]) => <Opt on={!!t.acts[k]} onClick={() => !t.acts[k] && act('transition.act', { act: k }, 'Done.')} title={a.name} hint={`${a.what} ${a.effects.join(' · ')}.`} right={t.acts[k] ? <span class="chip">Done</span> : undefined} />)}</div>
        </Sec>
      )}
      <Sec title="Who governs?" sub="Anyone can declare a rival government (10 Influence). Each day, whoever has the most citizens behind them leads; two governments cost the realm 3 Stability a day. If someone from the old regime wins the backing, the regime is back.">
        <ul class="list">
          {[t.leader, ...claimants].map((id) => (
            <li class="row"><span><Who id={id} />{id === t.leader ? ', the provisional leader' : t.fallen.council.includes(id) ? ', of the old regime' : ', a rival claim'}<div class="small muted">{(t.claims[id] || []).length} behind them{(t.claims[id] || []).length ? `: ${names(w, t.claims[id])}` : ''}</div></span>
              {can && backing !== id && (claimants.length > 0 || id !== t.leader) && <Btn small kind="ghost" onClick={() => act('transition.back', { who: id }, 'You are behind them.')}>Back</Btn>}</li>
          ))}
        </ul>
        {can && !lead && !t.claims[me] && <Btn kind="danger ghost" full style={{ marginTop: 8 }} onClick={() => act('transition.claim', {}, 'You have claimed the government.')}>Declare a rival government</Btn>}
      </Sec>
    </>
  );
}

// ---------- the reckoning ----------
function Reckoning() {
  const { world: w, me } = useStore();
  const k = w.reckoning;
  const tally = (v: string) => Object.values(k.votes).filter((x) => x === v).length;
  return (
    <Sec title="The reckoning" sub={<>{k.voters === 'council' ? 'The revolutionary council sits as a tribunal' : 'MPs decide'} what happens to {names(w, k.targets)}. Closes <When at={k.closesAt} />. A tie goes to the milder verdict.{k.dictator ? ` ${nm(w, k.leader)} ruled alone: exile and the ban are doubled for them.` : ''}</>}>
      <div class="stack">{Object.entries(VERDICTS).map(([v, label]) => <Opt on={k.votes[me] === v} onClick={() => canJudge(w, me) && act('reckoning.vote', { verdict: v }, 'Vote cast.')} title={label} right={<b class="tnum">{tally(v)}</b>} />)}</div>
      {!canJudge(w, me) && <p class="small muted">{k.targets.includes(me) ? 'You are the one being judged.' : k.voters === 'council' ? 'Only the council votes.' : isMP(w, me) ? '' : 'Only MPs vote.'}</p>}
      {Object.keys(k.collab || {}).length > 0 && <p class="small muted">Collaborators, on the record but not on trial: {Object.entries(k.collab).map(([id, why]: any) => `${nm(w, id)} (${String(why).toLowerCase()})`).join(', ')}.</p>}
    </Sec>
  );
}

const HOW: Record<string, string> = { handback: 'Handed power back on time', exit: 'Left by agreement', collapse: 'Collapsed', countercoup: 'Overthrown by a counter-coup', palace: 'Removed by the General', plebiscite: 'Lost its plebiscite', leak: 'Fell when its rigged election was exposed' };
const VERDICT: Record<string, string> = { amnesty: 'amnesty', pardon: 'pardoned', fine: 'fined', exile: 'exiled and barred from office' };
function History() {
  const { world: w } = useStore();
  if (!w.regimes?.length) return null;
  return (
    <Sec title="Regimes past">
      <ul class="list">{w.regimes.map((h: any) => <li><span><b>{h.leaderName}</b>, {(h.president ? 'President' : REGIMES[h.type]?.name || h.type).toLowerCase()}, {h.days} day{h.days === 1 ? '' : 's'}<div class="small muted">{fmtDay(h.from)} to {fmtDay(h.to)}. {HOW[h.how] || h.how}{h.by ? `, brought down by ${nm(w, h.by)}` : ''}.{h.verdict ? ` Verdict: ${VERDICT[h.verdict] || h.verdict}.` : ''}</div></span></li>)}</ul>
    </Sec>
  );
}
