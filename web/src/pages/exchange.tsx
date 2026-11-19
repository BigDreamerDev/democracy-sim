// The Exchange (#/exchange): the index, every listed company with its price and what is moving it, buying and
// selling, your portfolio, and the public Register of Interests. Prices move every three hours (engine/exchange.ts).
import { useState } from 'preact/hooks';
import { useStore, act } from '../store';
import { Page, Sec, Card, Btn, Who, Left, Empty, Field, Pick, Seg } from '../ui';
import { bal, ca, isPM, hasPower, holderOf } from '../../../engine/index';
import { COMPANIES, drivers, indexNow, portfolio, halted, register, fund, MAX_HOLD, canMove } from '../../../engine/exchange';

function Spark({ data, w = 120, h = 32, base }: { data: number[]; w?: number; h?: number; base?: number }) {
  if (data.length < 2) return <svg width={w} height={h} aria-hidden="true" />;
  const lo = Math.min(...data, base ?? Infinity);
  const hi = Math.max(...data, base ?? -Infinity);
  const x = (i: number) => (i / (data.length - 1)) * (w - 4) + 2;
  const y = (v: number) => h - 3 - ((v - lo) / Math.max(0.0001, hi - lo)) * (h - 6);
  const up = data[data.length - 1] >= data[0];
  const pts = data.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} class="spark" aria-hidden="true">
      {base !== undefined && <line x1="2" x2={w - 2} y1={y(base)} y2={y(base)} class="spark-base" />}
      <polygon points={`2,${h} ${pts} ${w - 2},${h}`} class={'spark-fill ' + (up ? 'up' : 'down')} />
      <polyline points={pts} class={'spark-line ' + (up ? 'up' : 'down')} />
    </svg>
  );
}
const pct = (a: number, b: number) => (b ? ((a - b) / b) * 100 : 0);
const Move = ({ v }: { v: number }) => <b class="tnum" style={{ color: v > 0.05 ? 'var(--teal)' : v < -0.05 ? 'var(--red)' : 'var(--muted)' }}>{v > 0 ? '▲' : v < 0 ? '▼' : '·'} {Math.abs(v).toFixed(1)}%</b>;

// a shareholder revolt: big holders put a motion; every holder votes, weighted by shares
function Revolt({ sym }: { sym: string }) {
  const { world: w, me } = useStore();
  const [f, setF] = useState({ prop: '', side: 'aye' });
  const open = (w.exchange.motions || []).find((m: any) => m.sym === sym && m.status === 'open');
  const bills = (Object.values(w.proposals) as any[]).filter((p) => ['debate', 'vote'].includes(p.stage));
  const mine = w.exchange.holdings?.[me]?.[sym]?.n || 0;
  if (open) {
    // online the server sends the totals; the demo adds them up from the votes
    const sum = (y: boolean) => Object.values(open.votes).filter((v: any) => v.yes === y).reduce((n: number, v: any) => n + v.n, 0);
    const t = open.tally || { yes: sum(true), no: sum(false) };
    return (
      <Card kind="warn" style={{ marginTop: 10 }}><div class="stack">
        <b>Shareholder revolt: lobby {open.side === 'aye' ? 'for' : 'against'} “{w.proposals[open.prop]?.title}”</b>
        <span class="small">Called by <Who id={open.by} />. {t.yes} shares for, {t.no} against so far. Closes in <Left at={open.closesAt} />.</span>
        {mine ? <div class="grid2"><Btn small onClick={() => act('exchange.vote', { motion: open.id, yes: true }, 'Voted with your shares.')}>For ({mine})</Btn><Btn small kind="plain" onClick={() => act('exchange.vote', { motion: open.id, yes: false }, 'Voted with your shares.')}>Against ({mine})</Btn></div> : <span class="small muted">Only {sym} shareholders vote.</span>}
      </div></Card>
    );
  }
  if (!canMove(w, me, sym) || !bills.length) return null;
  return (
    <Card style={{ marginTop: 10 }}><div class="stack">
      <b>Call a shareholder vote</b>
      <span class="small muted">You hold enough {sym} to make the company take a side on a bill. If it carries, the company lobbies publicly, and its price jumps 6% if it gets its way (falls 6% if not).</span>
      <div class="grid2"><Pick value={f.prop} onChange={(v) => setF({ ...f, prop: v })} empty="Which bill?" options={bills.map((p) => [p.id, p.title])} /><Seg value={f.side} onChange={(v) => setF({ ...f, side: v })} options={[['aye', 'For it'], ['no', 'Against it']]} /></div>
      <Btn small kind="ghost" disabled={!f.prop} onClick={() => act('exchange.motion', { sym, prop: f.prop, side: f.side }, 'The vote is called.')}>Call the vote</Btn>
    </div></Card>
  );
}
export function Exchange() {
  const { world: w, me } = useStore();
  const [open, setOpen] = useState<string | null>(null);
  const [n, setN] = useState('1');
  const [duty, setDuty] = useState('');
  const x = w.exchange;
  if (!x) return <Page title="The Exchange"><Empty>The Exchange opens with the realm.</Empty></Page>;
  const idx = indexNow(w);
  const mine = portfolio(w, me);
  const stop = halted(w);
  const chair = hasPower(w, me, 'rate') || (isPM(w, me) && !holderOf(w, 'reserve'));
  const chancellor = holderOf(w, 'treasury') === me || (isPM(w, me) && !holderOf(w, 'treasury'));
  // online the server sends the Register; the demo works it out from the whole world
  const reg = (x.register || register(w)) as any[];
  return (
    <Page back={['#/money', 'Money']} kicker={stop ? <span style={{ color: 'var(--red)' }}>Trading halted · resumes in <Left at={x.haltedUntil} /></span> : 'Open · prices move every three hours'} title="The Exchange" intro="Ten companies, at home and abroad. Their prices follow the realm’s stability and prosperity, our relations with their countries, wars, sanctions and the Reserve’s rate. Dividends are paid each payday.">
      <div class="ex-head">
        <div>
          <div class="kicker" style={{ margin: 0 }}>Realm Index</div>
          <div class="serif tnum" style={{ fontSize: 46, lineHeight: 1 }}>{idx.toFixed(1)}</div>
          <div class="small">Today <Move v={pct(idx, x.dayOpen)} /> · this week <Move v={pct(idx, x.index[0])} /></div>
        </div>
        <Spark data={x.index} w={260} h={72} base={100} />
      </div>
      <div class="ticker" aria-hidden="true"><div>{[...COMPANIES, ...COMPANIES].map((c) => { const q = x.prices[c.sym]; return <span><b>{c.sym}</b> {q.p.toFixed(2)} <Move v={pct(q.p, q.open)} /></span>; })}</div></div>
      <div class="ex-wide"><Sec title="Listed companies">
        <ul class="list ex-list">
          {COMPANIES.map((c) => {
            const q = x.prices[c.sym];
            const held = x.holdings?.[me]?.[c.sym]?.n || 0;
            const on = open === c.sym;
            return (
              <li class={'ex-row' + (on ? ' on' : '')}>
                <button type="button" class="ex-sum" aria-expanded={on ? 'true' : 'false'} onClick={() => setOpen(on ? null : c.sym)}>
                  <span class="ex-sym">{c.sym}</span>
                  <span class="ex-name"><b>{c.name}</b><span class="small muted">{c.sector}{c.nation ? ` · ${w.nations[c.nation]?.name}` : ' · the realm'}{held ? ` · you hold ${held}` : ''}</span></span>
                  <Spark data={q.hist} w={96} h={28} />
                  <span class="ex-price"><b class="tnum">{q.p.toFixed(2)}</b><Move v={pct(q.p, q.open)} /></span>
                </button>
                {on && (
                  <div class="ex-more">
                    <p class="small" style={{ margin: '0 0 6px' }}>{c.about} Dividend about {c.yield}% a week.</p>
                    <ul class="list small">{drivers(w, c).map(([why, v]) => <li class="row"><span>{why}</span><b class="tnum" style={{ color: v > 0 ? 'var(--teal)' : 'var(--red)' }}>{v > 0 ? '+' : ''}{v.toFixed(2)}%</b></li>)}</ul>
                    <Revolt sym={c.sym} />
                    <div class="grid2" style={{ marginTop: 10 }}>
                      <Field label={`Shares (you hold ${held}, ${MAX_HOLD} at most)`} type="number" value={n} onInput={setN} />
                      <div class="row" style={{ alignSelf: 'end', gap: 6 }}>
                        <Btn small disabled={stop} onClick={() => act('exchange.buy', { sym: c.sym, n: Number(n) }, `Bought ${n} ${c.sym}.`)}>Buy · {Math.ceil(Number(n || 0) * q.p)}</Btn>
                        <Btn small kind="plain" disabled={stop || !held} onClick={() => act('exchange.sell', { sym: c.sym, n: Number(n) }, `Sold ${n} ${c.sym}.`)}>Sell</Btn>
                      </div>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </Sec></div>
      <Sec title="Your portfolio" sub={`Stamp duty on purchases: ${x.duty}%. You have ${bal(w, ca(me))} crowns.`}>
        {mine.rows.length ? (
          <Card>
            <ul class="list">{mine.rows.map((r) => <li class="row"><span><b>{r.sym}</b> × <span class="tnum">{r.n}</span><div class="small muted">Cost {r.cost}</div></span><span class="tnum">{r.value} <Move v={pct(r.value, r.cost)} /></span></li>)}</ul>
            <div class="row" style={{ marginTop: 8 }}><b>Worth</b><span class="tnum"><b>{mine.value}</b> <Move v={pct(mine.value, mine.cost)} /></span></div>
          </Card>
        ) : <Empty>You own no shares yet. Pick a company below.</Empty>}
      </Sec>
      <Sec title="Register of Interests" sub="Shares held by MPs, ministers, the Prime Minister and the head of state are public. Everyone else’s are private.">
        {reg.length ? <ul class="list">{reg.map((r) => <li class="row"><Who id={r.id} /><span class="small">{r.holds.map((h: any) => `${h.n} ${h.sym}`).join(', ')}</span></li>)}</ul> : <Empty>Nobody in office owns shares.</Empty>}
      </Sec>
      <Sec title="The wealth fund" sub="Shares the realm owns, bought and sold only by law. Its dividends go to the Treasury.">
        {fund(w).rows.length ? (
          <Card><ul class="list">{fund(w).rows.map((r) => <li class="row"><span><b>{r.sym}</b> × <span class="tnum">{r.n}</span><div class="small muted">Cost {r.cost}</div></span><span class="tnum">{r.value} <Move v={pct(r.value, r.cost)} /></span></li>)}</ul><div class="row" style={{ marginTop: 8 }}><b>Worth</b><span class="tnum"><b>{fund(w).value}</b> <Move v={pct(fund(w).value, fund(w).cost)} /></span></div></Card>
        ) : <Empty>The realm owns no shares.</Empty>}
        <Btn small kind="ghost" href="#/new" style={{ marginTop: 8 }}>Draft a bill to buy or sell</Btn>
      </Sec>
      {(chair || chancellor) && (
        <Sec title="Powers over the Exchange">
          <div class="grid2">
            {chair && <Card><b>Halt trading</b><p class="small" style={{ margin: '4px 0 8px' }}>Stop all buying and selling for 12 hours, once a day. For a panic.</p><Btn small kind="danger ghost" disabled={stop} onClick={() => confirm('Halt all trading for 12 hours?') && act('exchange.halt', {}, 'Trading halted.')}>Halt trading</Btn></Card>}
            {chancellor && <Card><b>Stamp duty</b><p class="small" style={{ margin: '4px 0 8px' }}>A tax on every purchase, 0–5%, paid to the Treasury.</p><div class="grid2"><Field label="Percent" type="number" value={duty || String(x.duty)} onInput={setDuty} /><Btn small style={{ alignSelf: 'end' }} onClick={() => act('exchange.duty', { rate: Number(duty || x.duty) }, 'Stamp duty set.')}>Set</Btn></div></Card>}
          </div>
        </Sec>
      )}
      <p class="small muted">Every trade is on file. Anyone who trades a company in the day before taking a decision that moves it (an embargo, an embassy, the rate, the Army's orders) is found out: the Security Service and the PM get a secret card. When the Exchange pays out more than it holds, it draws new money from the Reserve, and that feeds inflation. Its surplus goes back each payday.</p>
    </Page>
  );
}
