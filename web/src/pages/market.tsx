// The market: bounties, stalls and civic jobs (real life, for crowns), and the betting pools.
import { useState } from 'preact/hooks';
import { useStore, act } from '../store';
import { Page, Sec, Card, Btn, Left, Empty, Field, Pick, Seg, Who, Photo, PhotoPick } from '../ui';
import { nm, holderOf, isPM, fmtTime, bal, ca } from '../../../engine/index';
import { rating, inStreets } from '../../../engine/streets';
import { odds, MAX_STAKE } from '../../../engine/markets';

const STATUS: Record<string, string> = { open: 'Open', taken: 'Taken', done: 'Waiting for sign-off', paid: 'Paid', cancelled: 'Cancelled', expired: 'Expired', removed: 'Taken down' };

export function Market() {
  const { world: w, me } = useStore();
  const [tab, setTab] = useState<'bounties' | 'stalls' | 'jobs'>('bounties');
  const [nb, setNb] = useState({ text: '', reward: '20' });
  const [ns, setNs] = useState({ title: '', price: '10' });
  const [note, setNote] = useState<Record<string, string>>({});
  const [proof, setProof] = useState<Record<string, string | null>>({});
  const [stars, setStars] = useState<Record<string, string>>({});
  const [why, setWhy] = useState('');
  const isIn = inStreets(w, me);
  const admin = w.citizens[me]?.admin;
  const bounties = (Object.values(w.bounties || {}) as any[]).sort((a, b) => b.at - a.at);
  const live = bounties.filter((b) => ['open', 'taken', 'done'].includes(b.status));
  const settled = bounties.filter((b) => !['open', 'taken', 'done'].includes(b.status)).slice(0, 10);
  const stalls = (Object.values(w.stalls || {}) as any[]).filter((s) => s.status === 'open').sort((a, b) => b.at - a.at);
  const orders = (Object.values(w.orders || {}) as any[]).filter((o) => ['paid', 'delivered'].includes(o.status));
  const jobs = (Object.values(w.jobs || {}) as any[]).filter((j) => j.active);
  const claims = (w.jobClaims || []) as any[];
  const signer = holderOf(w, 'treasury') || w.pm;
  const canSign = (c: any) => c.by !== me && (signer === me || (isPM(w, me) && holderOf(w, 'treasury') === c.by));
  const [claimNote, setClaimNote] = useState<Record<string, string>>({});
  return (
    <Page back={['#/realm', 'The realm']} kicker="Real life, for crowns" title="The market" intro="Every crown is held in escrow until the job is done. Crowns never turn into real money, and real money never buys crowns.">
      {!isIn && tab !== 'jobs' && <Card kind="tint" style={{ marginTop: 14 }}>Bounties and stalls are part of the Streets, which is opt-in. <a href="#/streets">Join the Streets</a> to post or take one.</Card>}
      <div style={{ marginTop: 16 }}><Seg value={tab} onChange={setTab} options={[['bounties', `Bounties (${live.length})`], ['stalls', `Stalls (${stalls.length})`], ['jobs', `Civic jobs (${jobs.length})`]]} /></div>

      {tab === 'bounties' && (
        <>
          <Sec title="Open bounties" sub="Take one, do it in real life, say it’s done. The poster has 48 hours to sign it off, or it pays out anyway.">
            <div class="stack">
              {live.map((b) => (
                <Card>
                  <div class="row"><b class="serif" style={{ fontSize: 20 }}>{b.reward} crowns</b><span class="small muted">{STATUS[b.status]}</span></div>
                  <p style={{ margin: '4px 0' }}>{b.text}</p>
                  <div class="small muted">Posted by <Who id={b.by} />{b.taker && <> · taken by <Who id={b.taker} /></>}{b.status === 'open' && <> · <Left at={b.dueAt} /> left</>}</div>
                  {b.note && <p class="small" style={{ margin: '6px 0 0' }}>“{b.note}”</p>}
                  <Photo id={b.photo} alt={`Proof: ${b.text}`} />
                  <div class="stack" style={{ marginTop: 8, gap: 6 }}>
                    {b.status === 'open' && b.by !== me && isIn && <Btn small onClick={() => act('bounty.take', { id: b.id }, 'It’s yours. 48 hours.')}>Take it on</Btn>}
                    {b.status === 'open' && b.by === me && <Btn small kind="plain" onClick={() => act('bounty.cancel', { id: b.id }, 'Cancelled and refunded.')}>Cancel</Btn>}
                    {b.status === 'taken' && b.taker === me && <div class="stack" style={{ gap: 6 }}><Field label="How it went" value={note[b.id] || ''} onInput={(v) => setNote({ ...note, [b.id]: v })} placeholder="Delivered at lunch" /><PhotoPick label="Add a proof photo" value={proof[b.id] || null} onChange={(id) => setProof({ ...proof, [b.id]: id })} /><Btn onClick={() => act('bounty.done', { id: b.id, note: note[b.id] || '', photo: proof[b.id] || null }, 'Sent for sign-off.')}>It’s done</Btn></div>}
                    {b.status === 'done' && b.by === me && <div class="grid2"><Btn onClick={() => act('bounty.confirm', { id: b.id, yes: true }, 'Paid.')}>Pay out</Btn><Btn kind="plain" onClick={() => act('bounty.confirm', { id: b.id, yes: false }, 'Sent back to open.')}>Not done</Btn></div>}
                    {admin && <details><summary class="small">Returning Officer: take it down</summary><div class="grid2" style={{ marginTop: 6 }}><Field label="Reason (published)" value={why} onInput={setWhy} /><Btn small kind="danger ghost" style={{ alignSelf: 'end' }} onClick={() => act('admin.bounty', { id: b.id, reason: why }, 'Taken down and refunded. It’s in the Gazette.')}>Take down</Btn></div></details>}
                  </div>
                </Card>
              ))}
              {!live.length && <Empty>No bounties. Post the first.</Empty>}
            </div>
          </Sec>
          {isIn && (
            <Sec title="Post a bounty" sub="Something safe and fun someone can do in real life. The Returning Officer takes down anything unsafe or humiliating.">
              <Card><div class="stack">
                <Field label="The task" value={nb.text} onInput={(v) => setNb({ ...nb, text: v })} placeholder="Bring the Chancellor a sausage roll before Friday" />
                <Field label="Reward (5–200 crowns)" type="number" value={nb.reward} onInput={(v) => setNb({ ...nb, reward: v })} />
                <Btn onClick={() => act('bounty.post', { text: nb.text, reward: Number(nb.reward) }, 'Posted. The crowns are in escrow.') && setNb({ text: '', reward: '20' })}>Post it ({bal(w, ca(me))} crowns in your wallet)</Btn>
              </div></Card>
            </Sec>
          )}
          {settled.length > 0 && <Sec title="Settled"><ul class="list">{settled.map((b) => <li class="row"><span>{b.text}{b.photo && b.status === 'paid' && <Photo id={b.photo} alt={`Proof: ${b.text}`} />}<div class="small muted">{b.status === 'paid' ? <>{nm(w, b.taker)} collected {b.reward}</> : STATUS[b.status]}{b.reason ? `: ${b.reason}` : ''}</div></span><span class="small muted">{fmtTime(w, b.paidAt || b.at)}</span></li>)}</ul></Sec>}
        </>
      )}

      {tab === 'stalls' && (
        <>
          {orders.length > 0 && (
            <Sec title="Your orders">
              <div class="stack">
                {orders.map((o) => (
                  <Card kind={o.buyer === me && o.status === 'delivered' ? 'warn' : undefined}>
                    <div class="row"><b>{o.title}</b><span class="small">{o.price} crowns</span></div>
                    <div class="small muted">{o.buyer === me ? <>From <Who id={o.seller} /></> : <>For <Who id={o.buyer} /></>} · {o.status === 'paid' ? 'paid, waiting for delivery' : 'delivered'} · <Left at={o.dueAt} /></div>
                    <div style={{ marginTop: 8 }}>
                      {o.seller === me && o.status === 'paid' && <div class="grid2"><Btn small onClick={() => act('stall.deliver', { order: o.id }, 'Marked delivered.')}>Delivered</Btn><Btn small kind="plain" onClick={() => act('stall.refund', { order: o.id }, 'Refunded.')}>Refund</Btn></div>}
                      {o.buyer === me && <div class="grid2"><Pick value={stars[o.id] || '5'} onChange={(v) => setStars({ ...stars, [o.id]: v })} options={[['5', '★★★★★'], ['4', '★★★★'], ['3', '★★★'], ['2', '★★'], ['1', '★']]} /><Btn small onClick={() => act('stall.receive', { order: o.id, stars: Number(stars[o.id] || 5) }, 'Paid. Thanks for rating.')}>It arrived</Btn></div>}
                    </div>
                  </Card>
                ))}
              </div>
            </Sec>
          )}
          <Sec title="Stalls" sub="Pay into escrow; the seller is paid when you say it arrived (or 3 days after they mark it delivered). Not delivered in 5 days: refunded.">
            <div class="stack">
              {stalls.map((s) => (
                <Card>
                  <div class="row"><b>{s.title}</b><b class="serif" style={{ fontSize: 20 }}>{s.price}</b></div>
                  <div class="small muted"><Who id={s.by} /> · {s.sold} sold{rating(s) !== null && <> · {rating(s)}★</>}</div>
                  <div style={{ marginTop: 8 }}>
                    {s.by === me ? <Btn small kind="plain" onClick={() => act('stall.close', { id: s.id }, 'Stall closed.')}>Close the stall</Btn> : isIn && <Btn small onClick={() => act('stall.buy', { id: s.id }, 'Bought. The crowns wait in escrow.')}>Buy for {s.price}</Btn>}
                  </div>
                </Card>
              ))}
              {!stalls.length && <Empty>No stalls open.</Empty>}
            </div>
          </Sec>
          {isIn && (
            <Sec title="Open a stall">
              <Card><div class="stack">
                <Field label="What you’re selling" value={ns.title} onInput={(v) => setNs({ ...ns, title: v })} placeholder="I’ll make your flashcards for one subject" />
                <Field label="Price (1–200 crowns)" type="number" value={ns.price} onInput={(v) => setNs({ ...ns, price: v })} />
                <Btn onClick={() => act('stall.open', { title: ns.title, price: Number(ns.price) }, 'Your stall is open.') && setNs({ title: '', price: '10' })}>Open it</Btn>
              </div></Card>
            </Sec>
          )}
        </>
      )}

      {tab === 'jobs' && (
        <>
          <Sec title="Civic jobs" sub={<>Created by law. Do one, claim the wage, and {signer ? <><Who id={signer} /> signs it off</> : 'the Chancellor or PM signs it off'}. Once per job each week.</>}>
            <div class="stack">
              {jobs.map((j) => (
                <Card>
                  <div class="row"><b>{j.title}</b><b class="serif" style={{ fontSize: 20 }}>{j.pay}</b></div>
                  <div class="small muted">{j.law}</div>
                  <div class="grid2" style={{ marginTop: 8 }}><Field label="What you did" value={claimNote[j.id] || ''} onInput={(v) => setClaimNote({ ...claimNote, [j.id]: v })} /><Btn small style={{ alignSelf: 'end' }} onClick={() => act('job.claim', { job: j.id, note: claimNote[j.id] || '' }, 'Claimed. It needs signing off.')}>Claim {j.pay}</Btn></div>
                </Card>
              ))}
              {!jobs.length && <Empty>No civic jobs yet. An MP can create one with a bill: add a “Create a civic job” clause.</Empty>}
            </div>
          </Sec>
          <Sec title="Claims">
            <ul class="list">{claims.slice(0, 20).map((c) => (
              <li class="row">
                <span><Who id={c.by} />: {c.title}{c.note && <div class="small muted">“{c.note}”</div>}</span>
                {c.status === 'pending' && canSign(c) ? <span class="row" style={{ gap: 6 }}><Btn small onClick={() => act('job.approve', { claim: c.id, yes: true }, 'Paid from the Treasury.')}>Pay {c.pay}</Btn><Btn small kind="plain" onClick={() => act('job.approve', { claim: c.id, yes: false })}>Refuse</Btn></span> : <span class="small muted">{c.status}</span>}
              </li>
            ))}</ul>
            {!claims.length && <Empty>No claims yet.</Empty>}
          </Sec>
        </>
      )}
    </Page>
  );
}

export function Bets() {
  const { world: w, me } = useStore();
  const [pick, setPick] = useState<Record<string, { option: string; amount: string }>>({});
  const all = (Object.values(w.markets || {}) as any[]).sort((a, b) => a.closesAt - b.closesAt);
  const open = all.filter((m) => m.status === 'open' && m.closesAt > w.now);
  const done = all.filter((m) => m.status !== 'open').sort((a, b) => b.settledAt - a.settledAt).slice(0, 15);
  const optsOf = (m: any) => (m.kind === 'election' ? Object.keys(w.elections[m.ref]?.candidates || {}).map((id) => ({ key: id, label: nm(w, id) })) : m.options);
  const link = (m: any) => (m.kind === 'prop' ? '#/p/' + m.ref : m.kind === 'election' ? '#/election/' + m.ref : '#/crisis/' + m.ref);
  return (
    <Page back={['#/realm', 'The realm']} kicker="The betting pools" title="Bets" intro={`Back an outcome with crowns, up to ${MAX_STAKE} on each. Everyone who called it right splits the whole pool in proportion to what they put in. Nobody backed the winner? Everyone is refunded. Bets are private; the pools are public.`}>
      <Sec title="Open">
        <div class="stack">
          {open.map((m) => {
            const o = odds(m);
            const mine = m.bets?.[me] || {};
            const opts = optsOf(m);
            const pk = pick[m.id] || { option: opts[0]?.key || '', amount: '10' };
            const set = (x: any) => setPick({ ...pick, [m.id]: { ...pk, ...x } });
            return (
              <Card>
                <a href={link(m)} class="serif" style={{ fontSize: 20, color: 'inherit' }}>{m.question}</a>
                <div class="small muted">{o.total} crowns in the pool{m.backers ? `, ${m.backers} backer${m.backers > 1 ? 's' : ''}` : ''} · closes in <Left at={m.closesAt} /></div>
                <ul class="list" style={{ marginTop: 6 }}>
                  {opts.map((x: any) => (
                    <li class="odds">
                      <div class="row"><span>{x.label}{mine[x.key] ? <b class="small" style={{ color: 'var(--teal)' }}> · you: {mine[x.key]}</b> : ''}</span><span class="small tnum">{Math.round(o.share(x.key) * 100)}%{o.pays(x.key) ? ` · pays ${o.pays(x.key)!.toFixed(1)}×` : ''}</span></div>
                      <div class="odds-bar" aria-hidden="true"><i style={{ width: Math.round(o.share(x.key) * 100) + '%' }} /></div>
                    </li>
                  ))}
                  {!opts.length && <li class="small muted">Nobody is standing yet.</li>}
                </ul>
                {opts.length > 0 && <div class="grid2" style={{ marginTop: 8 }}><Pick value={pk.option} onChange={(v) => set({ option: v })} options={opts.map((x: any) => [x.key, x.label])} /><div class="row" style={{ gap: 6 }}><Field label="Crowns" type="number" value={pk.amount} onInput={(v) => set({ amount: v })} /><Btn style={{ alignSelf: 'end' }} onClick={() => act('market.bet', { market: m.id, option: pk.option, amount: Number(pk.amount) }, 'Bet placed.')}>Bet</Btn></div></div>}
              </Card>
            );
          })}
          {!open.length && <Empty>Nothing to bet on right now. A market opens when a vote opens, an election is called or a crisis breaks.</Empty>}
        </div>
      </Sec>
      <Sec title="Settled">
        <ul class="list">{done.map((m) => <li class="row"><span>{m.question}<div class="small muted">{m.status === 'void' ? `Refunded: ${m.why}` : `${(optsOf(m).find((x: any) => x.key === m.outcome) || m.options.find((x: any) => x.key === m.outcome))?.label ?? nm(w, m.outcome)}${m.payout ? `, ${m.payout} crowns paid out` : ''}`}{m.bets?.[me] ? ' · you were in' : ''}</div></span><span class="small muted">{fmtTime(w, m.settledAt)}</span></li>)}</ul>
        {!done.length && <Empty>Nothing settled yet.</Empty>}
      </Sec>
    </Page>
  );
}
