import { useState } from 'preact/hooks';
import { useStore, act } from '../store';
import { Page, Sec, Card, Btn, Who, Left, When, Empty, Field, Pick, Locked, Meter, Banknote, noteBreakdown } from '../ui';
import { nm, bal, ca, acctLabel, allCitizens, fmtTime, isPM, hasPower, inDanger, holderOf } from '../../../engine/index';
import { budget, bankHealth, ventureOdds, priceIndex, fx, savingsRate, savingsTaxDue, canMoneyMotion, describeMotion } from '../../../engine/economy';
import { lim } from '../../../engine/limits';
import { MOODS } from '../../../engine/foreign';
import { Meters } from './today';

function NoteFan({ amount, serial }: { amount: number; serial: string }) {
  const notes = noteBreakdown(amount);
  if (!notes.length) return <Empty>Your pockets are empty. The dividend arrives on payday.</Empty>;
  return (
    <div class="fan">
      <div class="fan-stack">{notes.slice().reverse().map(([d], i, arr) => <div class="fan-note" style={{ '--i': i, '--n': arr.length } as any}><Banknote denom={d as any} serial={serial} /></div>)}</div>
      <div class="row small" style={{ justifyContent: 'flex-start', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>{notes.map(([d, k]) => <span class="chip ink tnum">{k} × {d}</span>)}</div>
    </div>
  );
}

export function Wallet() {
  const { world: w, me } = useStore();
  const [s, setS] = useState({ to: '', amount: '5', note: '' });
  const ledger = w.ledger.filter((l: any) => l.from === ca(me) || l.to === ca(me)).slice(0, 30);
  return (
    <Page back={['#/realm', 'The realm']} kicker="Your wallet" title={<span class="tnum">{bal(w, ca(me))} crowns</span>} intro={`Every Payday you recieve ${w.config.dividend} ${inDanger(w, 'prosperity') ? ' (not during a recession)' : ''}, plus pay for MPs and ministers. Income tax ${w.config.taxRate}%.`}>
      <Sec title="What you have"><NoteFan amount={bal(w, ca(me))} serial={'RA ' + String(1000 + Object.keys(w.citizens).indexOf(me) * 37).padStart(6, '0')} /></Sec>
      <Sec title="Send crowns">
        <Card><div class="stack">
          <Pick value={s.to} onChange={(v) => setS({ ...s, to: v })} empty="To whom" options={allCitizens(w).filter((c: any) => c.id !== me).map((c: any) => [c.id, c.name])} />
          <div class="grid2"><Field label="Amount" type="number" value={s.amount} onInput={(v) => setS({ ...s, amount: v })} /><Field label="Note" value={s.note} onInput={(v) => setS({ ...s, note: v })} /></div>
          <Btn full onClick={() => act('money.send', { to: s.to, amount: Number(s.amount), note: s.note }, 'Sent.')}>Send</Btn>
        </div></Card>
      </Sec>
      <Sec title="Statement">
        <ul class="list">
          {ledger.map((l: any) => { const inn = l.to === ca(me); return <li class="row"><span style={{ minWidth: 0 }}><b style={{ fontSize: 15 }}>{l.memo}</b><div class="small muted">{inn ? 'From ' + acctLabel(w, l.from) : 'To ' + acctLabel(w, l.to)}, {fmtTime(w, l.at)}</div></span><b class="tnum" style={{ color: inn ? 'var(--teal)' : 'var(--red)' }}>{inn ? '+' : '−'}{l.amt}</b></li>; })}
          {!ledger.length && <li class="muted">Nothing yet.</li>}
        </ul>
      </Sec>
    </Page>
  );
}

export function Economy() {
  const { world: w, me } = useStore();
  const [rate, setRate] = useState(String(w.economy.rate));
  const b = budget(w);
  const ps = w.economy.prices;
  const max = Math.max(...ps), min = Math.min(...ps);
  const canRate = hasPower(w, me, 'rate') || (isPM(w, me) && w.offices.reserve && !w.offices.reserve.holder);
  return (
    <Page back={['#/realm', 'The realm']} kicker="Treasury and Reserve" title="The economy" intro={<>The Treasury holds <b class="tnum">{bal(w, 'treasury')}</b> crowns and owes the Reserve <b class="tnum">{w.economy.lent}</b>. Should the Treasury enter a deficit, it automatically borrows</>}>
      <Sec><Meters compact /></Sec>
      <DebtClock />
      <Exchange />
      <Printing />
      <Bonds />
      <Sec title="This week's budget" sub={<>Chancellor: <Who id={holderOf(w, 'treasury')} /></>}>
        <Card>
          <div class="small" style={{ fontWeight: 700 }}>Coming in</div>
          <ul class="list">{b.income.map((r) => <li class="row"><span>{r.label}</span><b class="tnum">{r.v}</b></li>)}</ul>
          <div class="small" style={{ fontWeight: 700, marginTop: 10 }}>Going out</div>
          <ul class="list">{b.out.map((r) => <li class="row"><span>{r.label}</span><b class="tnum">{r.v}</b></li>)}</ul>
          <div class="row" style={{ marginTop: 10, fontWeight: 700 }}><span>{b.inTotal - b.outTotal >= 0 ? 'Surplus' : 'Deficit'}</span><span class="tnum" style={{ color: b.inTotal - b.outTotal >= 0 ? 'var(--teal)' : 'var(--red)' }}>{b.inTotal - b.outTotal}</span></div>
        </Card>
        <p class="small muted">When the Treasury runs a deficit, the Prosperity is automatically decreased once a week. <a href="#/new">Draft a bill</a>.</p>
      </Sec>
      {!w.offices.reserve ? <Sec><Locked act="Currency Act" href="#/new?office=reserve">The Federal Reserve sets the interest rate.</Locked></Sec> : (
        <Sec title="The Federal Reserve" sub={<>Chair: <Who id={holderOf(w, 'reserve')} />. Rate {w.economy.rate}%. Last week prices moved {w.economy.lastInflation.toFixed(1)}%.</>}>
          <Card>
            <svg viewBox="0 0 300 100" width="100%" height="110" role="img" aria-label="Price index over recent weeks">
              <path d="M5 95H295" stroke="var(--rule)" stroke-width="1" />
              <polyline fill="none" stroke="var(--teal)" stroke-width="2.5" points={ps.map((p: number, i: number) => `${(i / Math.max(1, ps.length - 1)) * 290 + 5},${88 - ((p - min) / Math.max(0.01, max - min)) * 76}`).join(' ')} />
              <circle cx="295" cy={88 - ((priceIndex(w) - min) / Math.max(0.01, max - min)) * 76} r="4" fill="var(--teal)" />
            </svg>
            <p class="small muted" style={{ margin: 0 }}>Borrowing pushes prices up; a higher rate pulls them down. Inflation over 5% costs Prosperity.</p>
            {canRate && <div class="grid2" style={{ marginTop: 10 }}><Field label="Rate (0–15%)" type="number" value={rate} onInput={setRate} /><Btn style={{ alignSelf: 'end' }} onClick={() => act('reserve.rate', { rate: Number(rate) }, 'Rate set.')}>Set</Btn></div>}
          </Card>
          <div class="note-grid" style={{ marginTop: 14 }}>{(['1', '5', '20', '100'] as const).map((d) => <Banknote denom={d} />)}</div>
        </Sec>
      )}
    </Page>
  );
}

// the debt clock: what the Treasury owes, what it has printed, and what that is doing to prices
function DebtClock() {
  const { world: w } = useStore();
  const e = w.economy;
  const cells: [string, string | number][] = [['Owed to the Reserve', e.lent], ['Gold reserve', e.gold || 0], ['Bonds outstanding', w.bonds?.outstanding || 0], ['Printed this week', `${e.printedThisWeek || 0} / ${lim(w, 'mintWeek')}`], ['Printed in all', e.printed || 0], ['Prices last week', `${e.lastInflation >= 0 ? '+' : ''}${Number(e.lastInflation || 0).toFixed(1)}%`], ['Price index', priceIndex(w).toFixed(2)]];
  return (
    <Sec title="The debt clock" sub="Printing clears debt but raises prices; borrowing costs interest every payday.">
      <div class="corner-stats">{cells.map(([k, v]) => <a href="#/economy"><b class="tnum">{v}</b><span>{k}</span></a>)}</div>
    </Sec>
  );
}

// exchange rates: what a crown buys in each country this week, and the savings tax
function Exchange() {
  const { world: w, me } = useStore();
  const prev = w.economy.fxPrev || {};
  const due = savingsTaxDue(w, me);
  return (
    <Sec title="The crown abroad" sub="What one crown buys in each country, against 1.00 at the founding. Inflation weakens it; good relations and Prosperity strengthen it. A weak crown makes ventures pay more and imports (Army supplies, grain, gold) cost more.">
      <ul class="list">{Object.values(w.nations).map((n: any) => { const v = fx(w, n.id); const p = prev[n.id] ?? v; return <li class="row"><span>{n.name}</span><b class="tnum" style={{ color: v > p ? 'var(--teal)' : v < p ? 'var(--red)' : undefined }}>{v.toFixed(2)} {v > p ? '▲' : v < p ? '▼' : ''}</b></li>; })}</ul>
      <p class="small muted" style={{ marginTop: 10 }}>{savingsRate(w) > 0 ? <>Savings tax: {savingsRate(w)}% of every balance above {w.config.savingsFloor ?? 200} crowns, each payday. You will pay {due} at the next one.</> : <>There is no savings tax. A law can set one (“Change a number”).</>}</p>
    </Sec>
  );
}

// printing money and opening a bond issue: the Chancellor proposes, the Chair of the Reserve agrees (or the other way round)
function Printing() {
  const { world: w, me } = useStore();
  const [p, setP] = useState({ amount: '50', use: 'debt' });
  const [b, setB] = useState({ rate: '2', weeks: '4', cap: '200' });
  const [g, setG] = useState('50');
  if (!w.offices.treasury || !w.offices.reserve) return null;
  const mine = canMoneyMotion(w, me);
  const m = w.economy.motion && w.economy.motion.expiresAt > w.now ? w.economy.motion : null;
  const signedBy = m ? [m.signed.treasury && `the Chancellor (${nm(w, m.signed.treasury)})`, m.signed.reserve && `the Chair (${nm(w, m.signed.reserve)})`].filter(Boolean).join(' and ') : '';
  return (
    <Sec title="Printing money and bonds" sub={<>The Chancellor (<Who id={holderOf(w, 'treasury')} />) and the Chair of the Reserve (<Who id={holderOf(w, 'reserve')} />) must both sign. The Prime Minister signs for a vacant post.</>}>
      <div class="stack">
        {m && (
          <Card kind="warn">
            <b>Waiting: {describeMotion(w, m.terms)}.</b>
            <div class="small" style={{ marginTop: 4 }}>Signed by {signedBy}. Lapses in <Left at={m.expiresAt} />.</div>
            {mine && <Btn small style={{ marginTop: 8 }} onClick={() => act('money.agree', {}, 'Agreed.')}>Agree</Btn>}
          </Card>
        )}
        {mine && (
          <>
            <Card>
              <b>Print new crowns</b>
              <p class="small muted" style={{ margin: '4px 0 8px' }}>No debt. Crowns backed by the gold reserve are free; beyond that, every 25 crowns printed adds about 1% to this week’s inflation. Up to {lim(w, 'mintMax')} a time, {lim(w, 'mintWeek')} a week.</p>
              <div class="grid2"><Field label="Crowns" type="number" value={p.amount} onInput={(v) => setP({ ...p, amount: v })} /><Pick label="Where it goes" value={p.use} onChange={(v) => setP({ ...p, use: v })} options={[['debt', 'Pay down the debt'], ['treasury', 'Into the Treasury']]} /></div>
              <Btn small style={{ marginTop: 8 }} onClick={() => act('money.print', { amount: Number(p.amount), use: p.use }, 'Signed. The other side must agree.')}>Propose printing</Btn>
            </Card>
            <Card>
              <b>Issue Treasury bonds</b>
              <p class="small muted" style={{ margin: '4px 0 8px' }}>Citizens lend the Treasury crowns for 3 days of sales; each is repaid with interest when it matures.</p>
              <div class="grid2"><Field label="% a week (1–10)" type="number" value={b.rate} onInput={(v) => setB({ ...b, rate: v })} /><Field label="Weeks (1–8)" type="number" value={b.weeks} onInput={(v) => setB({ ...b, weeks: v })} /></div>
              <Field label="Size of the issue (crowns)" type="number" value={b.cap} onInput={(v) => setB({ ...b, cap: v })} />
              <Btn small style={{ marginTop: 8 }} onClick={() => act('money.bonds', { rate: Number(b.rate), weeks: Number(b.weeks), cap: Number(b.cap) }, 'Signed. The other side must agree.')}>Propose a bond issue</Btn>
            </Card>
            <Card>
              <b>Buy gold for the reserve</b>
              <p class="small muted" style={{ margin: '4px 0 8px' }}>Treasury crowns spent on gold abroad. The Reserve can then print that much without raising prices. The reserve holds {w.economy.gold || 0}.</p>
              <div class="grid2"><Field label="Crowns of gold (10–200)" type="number" value={g} onInput={setG} /><Btn style={{ alignSelf: 'end' }} onClick={() => act('money.gold', { amount: Number(g) }, 'Signed. The other side must agree.')}>Propose buying gold</Btn></div>
            </Card>
          </>
        )}
        {(w.economy.coinage || []).length > 0 && (
          <Card kind="tint">
            <b>The coinage</b>
            <ul class="list" style={{ marginTop: 6 }}>{w.economy.coinage.slice(0, 8).map((c: any) => <li class="row"><span class="small">{c.amt} crowns bearing the head of {c.by}{c.use === 'debt' ? ', to pay the debt' : ''}</span><span class="small muted"><When at={c.at} /></span></li>)}</ul>
          </Card>
        )}
      </div>
    </Sec>
  );
}

// Treasury bonds: anyone may lend while an issue is open
function Bonds() {
  const { world: w, me } = useStore();
  const [amt, setAmt] = useState('10');
  const s = w.bonds?.issue && w.bonds.issue.closesAt > w.now ? w.bonds.issue : null;
  const [ask, setAsk] = useState<Record<string, string>>({});
  const mine = (w.bonds?.holdings || []).filter((h: any) => h.owner === me);
  const market = (w.bonds?.market || []).filter((m: any) => !mine.some((h: any) => h.id === m.id));
  if (!s && !mine.length && !market.length) return null;
  return (
    <Sec title="Treasury bonds">
      <div class="stack">
        {s && (
          <Card>
            <b>{s.rate}% a week for {s.weeks} week{s.weeks === 1 ? '' : 's'}</b>
            <div class="small muted">{s.sold} of {s.cap} crowns sold. Sales close in <Left at={s.closesAt} />. 100 crowns lent now returns {Math.round(100 * (1 + (s.rate * s.weeks) / 100))}.</div>
            <div class="grid2" style={{ marginTop: 8 }}><Field label="Crowns to lend" type="number" value={amt} onInput={setAmt} /><Btn style={{ alignSelf: 'end' }} onClick={() => act('bond.buy', { amount: Number(amt) }, 'Bonds bought.')}>Buy bonds</Btn></div>
          </Card>
        )}
        {mine.length > 0 && (
          <Card kind="tint">
            <b>Your bonds</b>
            <ul class="list" style={{ marginTop: 6 }}>{mine.map((h: any) => (
              <li class="stack" style={{ gap: 6 }}>
                <div class="row"><span class="small">{h.amt} lent, {h.payout} back</span><span class="small muted">due <When at={h.dueAt} /></span></div>
                {h.ask ? <div class="row"><span class="small">On the market at {h.ask}</span><Btn small kind="plain" onClick={() => act('bond.unlist', { bond: h.id }, 'Taken off the market.')}>Withdraw</Btn></div>
                  : <div class="grid2"><Field label="Sell for" type="number" value={ask[h.id] ?? String(h.payout)} onInput={(v) => setAsk({ ...ask, [h.id]: v })} /><Btn small style={{ alignSelf: 'end' }} onClick={() => act('bond.sell', { bond: h.id, price: Number(ask[h.id] ?? h.payout) }, 'Offered for sale.')}>Offer for sale</Btn></div>}
              </li>
            ))}</ul>
          </Card>
        )}
        {market.length > 0 && (
          <Card>
            <b>The bond market</b>
            <p class="small muted" style={{ margin: '4px 0 6px' }}>Bonds other citizens are selling. Sellers stay anonymous; the Treasury repays whoever holds a bond when it falls due.</p>
            <ul class="list">{market.map((m: any) => <li class="row"><span class="small">Pays {m.payout}, due <When at={m.dueAt} /></span><Btn small onClick={() => act('bond.take', { bond: m.id }, 'Bond bought.')}>Buy for {m.price}</Btn></li>)}</ul>
          </Card>
        )}
      </div>
    </Sec>
  );
}

export function Banks() {
  const { world: w, me } = useStore();
  const [f, setF] = useState({ name: '', save: '2', loan: '5' });
  const [amt, setAmt] = useState('20');
  if (!w.permits.banks) return <Page back={['#/realm', 'The realm']} title="Banks"><Sec><Locked act="Banking Act" href="#/new?banks=1">Any citizen can open a bank, take savings and make loans. A failure costs the realm Prosperity.</Locked></Sec></Page>;
  return (
    <Page back={['#/realm', 'The realm']} title="Banks" intro="Savers earn interest each payday. If cash falls below a quarter of what is owed, the bank fails.">
      <Sec>
        <div class="stack">
          {Object.values(w.banks).map((b: any) => {
            const h = bankHealth(w, b);
            const loan = b.loans.find((l: any) => l.who === me && l.left > 0);
            return (
              <Card kind={b.status === 'failed' ? 'warn' : undefined}>
                <div class="row"><b class="serif" style={{ fontSize: 20 }}>{b.name}</b><span class="small">{b.status === 'failed' ? 'Failed' : `${b.saveRate}% savings · ${b.loanRate}% loans`}</span></div>
                <div class="small muted">Run by {nm(w, b.owner)}. Cash {h.cash} against {h.owed} owed.</div>
                <Meter value={Math.min(100, h.ratio * 100)} max={100} color={h.ratio < 0.4 ? 'var(--red)' : 'var(--teal)'} />
                <div class="small" style={{ margin: '6px 0' }}>You have {b.deposits[me] || 0} saved.{loan ? ` You owe ${loan.left} (${loan.weekly} a week).` : ''}</div>
                {b.status === 'open' && <><Field label="Amount" type="number" value={amt} onInput={setAmt} /><div class="grid3" style={{ marginTop: 8 }}><Btn small onClick={() => act('bank.deposit', { bank: b.id, amount: Number(amt) }, 'Saved.')}>Save</Btn><Btn small kind="ghost" onClick={() => act('bank.withdraw', { bank: b.id, amount: Number(amt) }, 'Withdrawn.')}>Withdraw</Btn><Btn small kind="plain" onClick={() => act('bank.borrow', { bank: b.id, amount: Number(amt), weeks: 4 }, 'Borrowed over 4 weeks.')}>Borrow</Btn></div></>}
              </Card>
            );
          })}
          {!Object.keys(w.banks).length && <Empty>No banks yet. Be the first.</Empty>}
        </div>
      </Sec>
      <Sec title="Open a bank" sub="25 crown licence plus 25 starting capital.">
        <Card><div class="stack">
          <Field label="Name" value={f.name} onInput={(v) => setF({ ...f, name: v })} />
          <div class="grid2"><Field label="Savings rate %" type="number" value={f.save} onInput={(v) => setF({ ...f, save: v })} /><Field label="Loan rate %" type="number" value={f.loan} onInput={(v) => setF({ ...f, loan: v })} /></div>
          <Btn full onClick={() => act('bank.open', { name: f.name, saveRate: Number(f.save), loanRate: Number(f.loan) }, 'Bank open.')}>Open</Btn>
        </div></Card>
      </Sec>
    </Page>
  );
}

export function Ventures() {
  const { world: w, me } = useStore();
  const [n, setN] = useState('varnholm');
  const [amt, setAmt] = useState('20');
  const mine = w.ventures.filter((v: any) => v.by === me);
  const o = w.nations[n] ? ventureOdds(w, n) : { low: 0, high: 0 };
  return (
    <Page back={['#/realm', 'The realm']} kicker="Trade" title="Ventures" intro={`Invest crowns into foreign nations and wait 2 days for either a profit or a loss, these are dependent on Prosperity. Tariff ${w.config.tariff}% unless a trade agreement removes it.`}>
      {inDanger(w, 'standing') && <Card kind="warn" style={{ marginTop: 14 }}><b>Embargo.</b> Nobody will trade with us until our Standing recovers.</Card>}
      <Sec title="Send a venture">
        <Card><div class="stack">
          <Pick label="Where" value={n} onChange={setN} options={Object.values(w.nations).map((x: any) => [x.id, `${x.name} (${MOODS[x.mood]})`])} />
          <Field label={`Crowns (5–${lim(w, 'ventureMax')})`} type="number" value={amt} onInput={setAmt} />
          <p class="small muted" style={{ margin: 0 }}>Likely return: {o.low > 0 ? '+' : ''}{o.low}% to +{o.high}%.</p>
          <Btn full onClick={() => act('venture.start', { nation: n, amount: Number(amt) }, 'The ship sails.')}>Send it</Btn>
        </div></Card>
      </Sec>
      <Sec title="Your ventures">
        <ul class="list">{mine.map((v: any) => <li class="row"><span><b>{w.nations[v.nation].name}</b>, {v.amount} crowns<div class="small muted">{v.status === 'out' ? <>Back in <Left at={v.dueAt} /></> : `Returned ${v.returned}`}</div></span>{v.status === 'back' && <b class="tnum" style={{ color: v.returned >= v.amount ? 'var(--teal)' : 'var(--red)' }}>{v.returned >= v.amount ? '+' : ''}{v.returned - v.amount}</b>}</li>)}</ul>
        {!mine.length && <Empty>You have not sent any yet.</Empty>}
      </Sec>
    </Page>
  );
}
