import { useState } from 'preact/hooks';
import { useStore, act } from '../store';
import { Page, Sec, Card, Btn, Who, Left, When, Empty, Field, Pick, Locked, Meter, Banknote, noteBreakdown } from '../ui';
import { nm, bal, ca, acctLabel, allCitizens, fmtTime, isPM, hasPower, inDanger, holderOf } from '../../../engine/index';
import { budget, bankHealth, ventureOdds, priceIndex } from '../../../engine/economy';
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
    <Page back={['#/realm', 'The realm']} kicker="Your wallet" title={<span class="tnum">{bal(w, ca(me))} crowns</span>} intro={`Payday brings ${w.config.dividend} crowns to everyone${inDanger(w, 'prosperity') ? ' (not during a recession)' : ''}, plus pay for MPs and ministers. Income tax ${w.config.taxRate}%.`}>
      <Sec title="In your pocket"><NoteFan amount={bal(w, ca(me))} serial={'RA ' + String(1000 + Object.keys(w.citizens).indexOf(me) * 37).padStart(6, '0')} /></Sec>
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
    <Page back={['#/realm', 'The realm']} kicker="Treasury and Reserve" title="The economy" intro={<>The Treasury holds <b class="tnum">{bal(w, 'treasury')}</b> crowns and owes the Reserve <b class="tnum">{w.economy.lent}</b>. If it runs dry it borrows automatically, and a secret card records it.</>}>
      <Sec><Meters compact /></Sec>
      <Sec title="This week's budget" sub={<>Chancellor: <Who id={holderOf(w, 'treasury')} /></>}>
        <Card>
          <div class="small" style={{ fontWeight: 700 }}>Coming in</div>
          <ul class="list">{b.income.map((r) => <li class="row"><span>{r.label}</span><b class="tnum">{r.v}</b></li>)}</ul>
          <div class="small" style={{ fontWeight: 700, marginTop: 10 }}>Going out</div>
          <ul class="list">{b.out.map((r) => <li class="row"><span>{r.label}</span><b class="tnum">{r.v}</b></li>)}</ul>
          <div class="row" style={{ marginTop: 10, fontWeight: 700 }}><span>{b.inTotal - b.outTotal >= 0 ? 'Surplus' : 'Deficit'}</span><span class="tnum" style={{ color: b.inTotal - b.outTotal >= 0 ? 'var(--teal)' : 'var(--red)' }}>{b.inTotal - b.outTotal}</span></div>
        </Card>
        <p class="small muted">A deficit costs Prosperity at payday; a surplus raises it. Tax, the dividend and pay change only by law. <a href="#/new">Draft a bill</a>.</p>
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
    <Page back={['#/realm', 'The realm']} kicker="Trade" title="Ventures" intro={`Put crowns into a trading run abroad. It comes back in 2 days with a profit or a loss. Friendlier nations and higher Prosperity mean better odds. Tariff ${w.config.tariff}% unless a trade agreement removes it.`}>
      {inDanger(w, 'standing') && <Card kind="warn" style={{ marginTop: 14 }}><b>Embargo.</b> Nobody will trade with us until our Standing recovers.</Card>}
      <Sec title="Send a venture">
        <Card><div class="stack">
          <Pick label="Where" value={n} onChange={setN} options={Object.values(w.nations).map((x: any) => [x.id, `${x.name} (${MOODS[x.mood]})`])} />
          <Field label="Crowns (5–100)" type="number" value={amt} onInput={setAmt} />
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
