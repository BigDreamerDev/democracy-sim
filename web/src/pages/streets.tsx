// The Streets: the real-life part of the game. Opt-in, with rules and safe zones up front.
import { useState } from 'preact/hooks';
import { useStore, act } from '../store';
import { Page, Sec, Card, Btn, Left, When, Empty, Field, Pick, Opt, QR, siteLink, canScan, Scanner, go } from '../ui';
import { nm, allCitizens, intrigueOpen, ghost, hasPower, fmtTime, exiled } from '../../../engine/index';
import { RULES, inStreets } from '../../../engine/streets';

function Code({ code, kind }: { code: string; kind: 'tag' | 'meet' }) {
  const [show, setShow] = useState(kind === 'meet');
  if (!show)
    return (
      <Card kind="dashed">
        <p class="small" style={{ margin: '0 0 8px' }}>Your tag code is how an assassin proves they got you. Only show it to someone who has just tagged you fairly.</p>
        <Btn small kind="ghost" onClick={() => setShow(true)}>Show my tag code</Btn>
      </Card>
    );
  return (
    <Card>
      <div class="code-box">
        <QR text={siteLink(`${kind}/${code}`)} size={180} label={`${kind === 'tag' ? 'Tag' : 'Meet'} code ${code}`} />
        <div>
          <div class="kicker" style={{ margin: 0 }}>{kind === 'tag' ? 'Your tag code' : 'Your meet code'}</div>
          <div class="code-text tnum">{code}</div>
          <p class="small muted" style={{ margin: '4px 0 0' }}>{kind === 'tag' ? 'It changes every time it’s used.' : 'They scan it with their phone camera, or type it in. It changes after each check-in.'}</p>
          {kind === 'tag' && <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}><Btn small kind="plain" onClick={() => setShow(false)}>Hide</Btn><Btn small kind="plain" onClick={() => act('streets.newCode', {}, 'New code. The old one is dead.')}>New code</Btn></div>}
        </div>
      </div>
    </Card>
  );
}

function Rules() {
  const { world: w } = useStore();
  return (
    <>
      <Sec title="The rules">
        <ol class="rules">{RULES.map((r) => <li>{r}</li>)}</ol>
      </Sec>
      <Sec title="Safe zones" sub="Nothing counts here. Parliament can add more by law; the Returning Officer can add them for safety.">
        <ul class="list">{(w.streets?.zones || []).map((z: any) => <li class="row"><span>{z.text}</span><span class="small muted">{z.by === 'law' ? 'by law' : z.by === 'ro' ? 'RO' : ''}</span></li>)}</ul>
      </Sec>
    </>
  );
}

export function Streets() {
  const { world: w, me } = useStore();
  const c = w.citizens[me];
  const [agree, setAgree] = useState(false);
  const [hit, setHit] = useState({ target: '', crowns: '20' });
  const [code, setCode] = useState('');
  const [scan, setScan] = useState(false);
  const [by, setBy] = useState('');
  const [guard, setGuard] = useState('');
  const [sweepFor, setSweepFor] = useState('');
  const s = w.streets || { contracts: {}, zones: [] };
  const contracts = Object.values(s.contracts) as any[];
  const mine = contracts.find((k) => k.by === me && ['live', 'claimed'].includes(k.status));
  const claims = contracts.filter((k) => k.target === me && k.status === 'claimed');
  const past = contracts.filter((k) => ['done', 'foiled'].includes(k.status)).sort((a, b) => b.doneAt - a.doneAt).slice(0, 12);
  const players = allCitizens(w).filter((x: any) => x.streets?.in);
  const others = players.filter((x: any) => x.id !== me).map((x: any) => [x.id, x.name]) as [string, string][];
  const isIn = inStreets(w, me);
  const tag = (k: string) => {
    act('streets.tag', { code: k }, 'Done. They’re a ghost for 48 hours.');
    setCode('');
    setScan(false);
  };

  if (!isIn)
    return (
      <Page back={['#/realm', 'The realm']} kicker="Real life · opt-in" title="The Streets"
        intro="To add a twist, you can play out bounties, favours, hits and contracts in real life, opt-in only">
        <Rules />
        <Sec title="Join">
          <Card><div class="stack">
            <Opt on={agree} onClick={() => setAgree(!agree)} title="I’ve read the rules and the safe zones, and I agree to them" hint="You can leave whenever you like." />
            <Btn full disabled={!agree || exiled(w, me)} onClick={() => act('streets.join', { agree }, 'You’re in. Watch your back.')}>Join the Streets</Btn>
            {c.streets?.leftAt && <p class="small muted" style={{ margin: 0 }}>You left on {fmtTime(w, c.streets.leftAt)}. You can rejoin a week after leaving.</p>}
          </div></Card>
        </Sec>
        <Sec title={`In the Streets (${players.length})`}><p class="small" style={{ margin: 0 }}>{players.map((x: any) => x.name).join(', ') || 'Nobody yet.'}</p></Sec>
      </Page>
    );

  return (
    <Page back={['#/realm', 'The realm']} kicker="IRL Activities" title="The Streets" intro="Contracts last 72 hours. Tag your target with your weapon, then get their code or ask them to confirm. A hit makes them a ghost for 48 hours: they can vote, and nothing else.">
      {ghost(w, me) && <Card kind="warn" style={{ marginTop: 14 }}><b>You’re a ghost</b> until <When at={c.ghostUntil} />. You can vote, answer the Red Box and bet. Nothing else.</Card>}
      {claims.map((k) => (
        <Card kind="warn" style={{ marginTop: 14 }}>
          <b>{nm(w, k.by)} says they got you.</b>
          <p class="small" style={{ margin: '4px 0' }}>Their weapon: {k.weapon}. Answer within <Left at={k.claimDue} />, or it counts.</p>
          <p class="small muted" style={{ margin: '0 0 10px' }}>If it happened in a safe zone, or didn’t happen, deny it.</p>
          <div class="grid2"><Btn onClick={() => act('streets.answer', { contract: k.id, yes: true }, 'Fair enough. You’re a ghost.')}>They got me</Btn><Btn kind="danger" onClick={() => act('streets.answer', { contract: k.id, yes: false }, 'Denied. It goes in the Gazette.')}>Deny it</Btn></div>
        </Card>
      ))}

      <Sec title="Your contract">
        {mine ? (
          <Card>
            <div class="contract">
              <div class="kicker" style={{ margin: 0 }}>Target</div>
              <div class="serif" style={{ fontSize: 30, lineHeight: 1.1 }}>{nm(w, mine.target)}</div>
              <div class="kicker" style={{ margin: '10px 0 0' }}>Your weapon</div>
              <p style={{ margin: '2px 0', fontWeight: 700 }}>{mine.weapon}</p>
              <p class="small muted" style={{ margin: 0 }}>{mine.crowns} crowns staked. <Left at={mine.dueAt} /> left. Succeed and you get them back with 10 Influence; run out of time and they go to the Treasury.</p>
            </div>
            {mine.status === 'claimed' ? <p class="small" style={{ margin: '10px 0 0' }}>Waiting for {nm(w, mine.target)} to confirm, for up to <Left at={mine.claimDue} />.</p> : (
              <div class="stack" style={{ marginTop: 12 }}>
                <div class="grid2"><Field label="Their tag code" value={code} onInput={setCode} placeholder="6 characters" /><Btn style={{ alignSelf: 'end' }} onClick={() => tag(code)}>Confirm the hit</Btn></div>
                {canScan() && !scan && <Btn kind="ghost" onClick={() => setScan(true)}>Scan their code</Btn>}
                {scan && <Scanner onCode={tag} onClose={() => setScan(false)} />}
                <Btn kind="plain" onClick={() => act('streets.claim', { contract: mine.id }, `Claimed. ${nm(w, mine.target)} has 24 hours to confirm or deny.`)}>No code? Claim it and ask them to confirm</Btn>
              </div>
            )}
          </Card>
        ) : !intrigueOpen(w) ? <Empty>Contracts open with the backroom, two weeks into the first Parliament.</Empty> : (
          <Card><div class="stack">
            <Pick label="Target" value={hit.target} onChange={(v) => setHit({ ...hit, target: v })} empty="Pick someone in the Streets" options={others} />
            <Field label="Stake (10–100 crowns)" type="number" value={hit.crowns} onInput={(v) => setHit({ ...hit, crowns: v })} />
            <p class="small muted" style={{ margin: 0 }}>Costs 10 Influence. You get a secret weapon and 72 hours. Nobody else knows, unless they sweep.</p>
            <Btn kind="danger" onClick={() => act('streets.contract', { target: hit.target, crowns: Number(hit.crowns) }, 'Contract taken. Your weapon is waiting.')}>Take out the contract</Btn>
          </div></Card>
        )}
      </Sec>

      <Sec title="If someone gets you" sub="Show them your tag code, or own up here.">
        <div class="stack">
          <Code code={c.tagCode || '······'} kind="tag" />
          <div class="grid2"><Pick value={by} onChange={setBy} empty="Who got you?" options={others} /><Btn kind="ghost" onClick={() => act('streets.gotMe', { by }, 'Fair play. You’re a ghost for 48 hours.')}>They got me</Btn></div>
        </div>
      </Sec>

      <Sec title="Counter-intelligence">
        <div class="stack">
          <Btn kind="ghost" onClick={() => act('streets.sweep', {}, 'Sweep done. The result is in your backroom hand.')}>Sweep for contracts on me (10 Influence)</Btn>
          {hasPower(w, me, 'intel') && <div class="grid2"><Pick value={sweepFor} onChange={setSweepFor} empty="Sweep for someone" options={others} /><Btn kind="ghost" onClick={() => act('streets.sweep', { target: sweepFor }, 'Sweep done. Check your hand.')}>Security sweep</Btn></div>}
          {hasPower(w, me, 'protect') && (
            <Card kind="tint"><div class="stack">
              <b>You’re the bodyguard.</b>
              <span class="small">{s.protect ? <>Guarding {nm(w, s.protect.who)} until <When at={s.protect.until} />.</> : 'Nobody is under guard.'} A hit on them fails half the time, and the assassin is exiled.</span>
              <div class="grid2"><Pick value={guard} onChange={setGuard} empty="Guard someone" options={players.map((x: any) => [x.id, x.name]) as [string, string][]} /><Btn onClick={() => act('streets.protect', { target: guard }, 'Under guard for 24 hours.')}>Guard</Btn></div>
            </div></Card>
          )}
          {s.protect && s.protect.who === me && <p class="small" style={{ margin: 0 }}>You’re under guard until <When at={s.protect.until} />.</p>}
        </div>
      </Sec>

      <Sec title="Recent hits">
        <ul class="list">{past.map((k) => <li class="row"><span><b>{nm(w, k.by)}</b> {k.status === 'done' ? 'got' : 'failed to get'} <b>{nm(w, k.target)}</b><div class="small muted">{k.weapon}</div></span><span class="small muted">{fmtTime(w, k.doneAt)}</span></li>)}</ul>
        {!past.length && <Empty>No blood yet.</Empty>}
      </Sec>
      <Rules />
      <Sec title={`In the Streets (${players.length})`}>
        <p class="small" style={{ margin: '0 0 12px' }}>{players.map((x: any) => x.name + (ghost(w, x.id) ? ' (ghost)' : '')).join(', ')}</p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}><Btn kind="plain" href="#/hunt">The Hunt</Btn><Btn kind="plain" href="#/meet">Check in with someone</Btn><Btn kind="plain" href="#/market">The market</Btn><Btn kind="danger ghost" onClick={() => confirm('Leave the Streets? Live contracts on you and by you are refunded. You can rejoin after a week.') && act('streets.leave', {}, 'You’ve left. Nobody can target you now.')}>Leave the Streets</Btn></div>
      </Sec>
    </Page>
  );
}

// someone scanned a tag code: #/tag/CODE
export function TagLanding({ code }: { code: string }) {
  const { world: w, me } = useStore();
  const mine = Object.values(w.streets?.contracts || {}).find((k: any) => k.by === me && ['live', 'claimed'].includes(k.status)) as any;
  return (
    <Page back={['#/streets', 'The Streets']} kicker="Tag code" title={<span class="tnum">{code}</span>} intro={mine ? `If this is ${nm(w, mine.target)}’s code and you got them fairly, confirm it.` : 'You don’t have a live contract. This code does nothing for you.'}>
      {mine && <Sec><Btn full kind="danger" onClick={() => (act('streets.tag', { code }, 'Done. They’re a ghost for 48 hours.'), go('#/streets'))}>Confirm the hit on {nm(w, mine.target)}</Btn></Sec>}
    </Page>
  );
}

// check-ins: #/meet (your code and a scanner) and #/meet/CODE (a scanned code)
export function Meet({ code }: { code?: string }) {
  const { world: w, me } = useStore();
  const c = w.citizens[me];
  const [k, setK] = useState(code || '');
  const [scan, setScan] = useState(false);
  const mineMeets = (w.streets?.meets || []).filter((m: any) => m.a === me || m.b === me).slice(0, 12);
  const checkIn = (x: string) => {
    act('streets.meet', { code: x }, 'Checked in. +3 Influence each.');
    setK('');
    setScan(false);
    if (code) go('#/meet');
  };
  return (
    <Page back={['#/streets', 'The Streets']} kicker="Real life" title="Meet up" intro="When you see someone from the realm in person, scan each other’s code. You both get 3 Influence, once a day per pair. You don’t need to be in the Streets for this.">
      {code && <Card kind="tint" style={{ marginTop: 14 }}><b>Check in with this code?</b><div class="code-text tnum">{code}</div><Btn full onClick={() => checkIn(code)}>Check in</Btn></Card>}
      <Sec title="Your code">{c.meetCode ? <Code code={c.meetCode} kind="meet" /> : <Card><p class="small" style={{ margin: '0 0 8px' }}>You don’t have a meet code yet.</p><Btn small onClick={() => act('streets.newCode', { kind: 'meet' }, 'Your meet code is ready.')}>Make one</Btn></Card>}</Sec>
      <Sec title="Their code">
        <div class="stack">
          <div class="grid2"><Field label="Type it" value={k} onInput={setK} placeholder="6 characters" /><Btn style={{ alignSelf: 'end' }} onClick={() => checkIn(k)}>Check in</Btn></div>
          {canScan() && !scan && <Btn kind="ghost" onClick={() => setScan(true)}>Scan it</Btn>}
          {scan && <Scanner onCode={checkIn} onClose={() => setScan(false)} />}
          {!canScan() && <p class="small muted" style={{ margin: 0 }}>Or point your phone’s camera at their code: it opens this page with the code filled in.</p>}
        </div>
      </Sec>
      <Sec title="Your meet-ups">
        <ul class="list">{mineMeets.map((m: any) => <li class="row"><span>{nm(w, m.a === me ? m.b : m.a)}</span><span class="small muted">{fmtTime(w, m.at)}</span></li>)}</ul>
        {!mineMeets.length && <Empty>None yet.</Empty>}
      </Sec>
    </Page>
  );
}

// the weekly Hunt: a ring where everyone hunts the next person
export function Hunt() {
  const { world: w, me } = useStore();
  const h = w.hunt;
  const isIn = inStreets(w, me);
  const target = h?.status === 'running' ? h.ring?.[me] : null;
  const ranked = h ? Object.entries(h.kills || {}).sort((a: any, b: any) => b[1] - a[1]) : [];
  return (
    <Page back={['#/streets', 'The Streets']} kicker={h ? `Round ${h.n}` : 'Weekly'} title="The Hunt"
      intro="Every payday a new round opens for 24 hours. Then everyone in it gets one target, the next person in a secret ring, and the round’s weapon. Tag your target and you take on theirs. Last one standing wins 20 Influence and a title; if 5 days pass first, the most hits wins. Safe zones and the rules of the Streets apply.">
      {!h && <Sec><Empty>The first round opens on payday.</Empty></Sec>}
      {h && (
        <>
          <Sec title={h.status === 'signup' ? 'Sign-ups are open' : h.status === 'running' ? 'The Hunt is on' : h.status === 'cancelled' ? 'Called off' : 'Finished'}>
            <Card>
              <div class="kicker" style={{ margin: 0 }}>This round’s weapon</div>
              <p style={{ margin: '2px 0 8px', fontWeight: 700 }}>{h.weapon}</p>
              {h.status === 'signup' && (
                <>
                  <p class="small" style={{ margin: '0 0 8px' }}>{h.entrants.length} signed up. It starts in <Left at={h.startsAt} /> if at least 3 are in.</p>
                  {!isIn ? <Btn href="#/streets" kind="ghost">Join the Streets to take part</Btn> : h.entrants.includes(me) ? <Btn kind="plain" onClick={() => act('hunt.withdraw', {}, 'You’re out of this round.')}>Drop out</Btn> : <Btn onClick={() => act('hunt.enter', {}, 'You’re in. Your target arrives when it starts.')}>Sign up</Btn>}
                </>
              )}
              {h.status === 'running' && (
                target ? (
                  <div class="contract">
                    <div class="kicker" style={{ margin: 0 }}>You’re hunting</div>
                    <div class="serif" style={{ fontSize: 30, lineHeight: 1.1 }}>{nm(w, target)}</div>
                    <p class="small muted" style={{ margin: '4px 0 0' }}>Tag them with the weapon, then use their tag code on <a href="#/streets">the Streets page</a>, or ask them to own up there. <Left at={h.endsAt} /> left.</p>
                  </div>
                ) : <p class="small" style={{ margin: 0 }}>{h.alive.includes(me) ? '' : 'You’re not in this round.'} <Left at={h.endsAt} /> left.</p>
              )}
              {h.status === 'done' && <p style={{ margin: 0 }}>{h.winners.length ? <>Won by <b>{h.winners.map((x: string) => nm(w, x)).join(' and ')}</b>.</> : 'Nobody was caught.'}</p>}
            </Card>
          </Sec>
          {h.status === 'running' && <Sec title={`Still standing (${h.alive.length})`}><p class="small" style={{ margin: 0 }}>{h.alive.map((x: string) => nm(w, x)).join(', ')}</p></Sec>}
          {ranked.length > 0 && <Sec title="Hits"><ul class="list">{ranked.map(([id, n]: any) => <li class="row"><span>{nm(w, id)}</span><b class="tnum">{n}</b></li>)}</ul></Sec>}
          {h.log.length > 0 && <Sec title="How it went"><ul class="list">{h.log.map((l: any) => <li class="row"><span>{nm(w, l.by)} got {nm(w, l.victim)}</span><span class="small muted">{fmtTime(w, l.at)}</span></li>)}</ul></Sec>}
        </>
      )}
    </Page>
  );
}
