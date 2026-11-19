// The Exchange (#/exchange): the index, every listed company with its price and what is moving it, buying and
// selling, your portfolio, and the public Register of Interests. Prices move every three hours (engine/exchange.ts).
import { useState } from 'preact/hooks';
import { useStore, act } from '../store';
import { Page, Sec, Card, Btn, Who, Left, Empty, Field, Pick, Seg } from '../ui';
import { bal, ca, isPM, hasPower, holderOf, nm } from '../../../engine/index';
import { COMPANIES, drivers, indexNow, portfolio, halted, register, fund, MAX_HOLD, canMove, listings, fairPrice, worth, LIST_FEE, SECTORS } from '../../../engine/exchange';

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
        <b>{open.oust ? `Boardroom revolt: remove ${nm(w, w.exchange.listed?.[sym]?.owner)} as owner` : <>Shareholder revolt: lobby {open.side === 'aye' ? 'for' : 'against'} “{w.proposals[open.prop]?.title}”</>}</b>
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
// corporate donations: published; and the button for whoever won a revolt
// companies and banks floated by citizens: the list, their owners' controls, and the form to float your own
function Citizens() {
  const { world: w, me } = useStore();
  const [open, setOpen] = useState<string | null>(null);
  const [n, setN] = useState('1');
  const [amt, setAmt] = useState('10');
  const ls = listings(w).sort((a, b) => (a.status === b.status ? b.at - a.at : a.status === 'listed' ? -1 : 1));
  const x = w.exchange;
  return (
    <div class="ex-wide">
      <Sec title="Floated by citizens" sub="Companies and banks run by players. Buying new shares from the float pays the company; after that you trade with the Exchange. Prices drift towards what each one is worth.">
        {ls.length ? (
          <ul class="list ex-list">
            {ls.map((l) => {
              const q = x.prices[l.sym] || { p: 0, open: 0, hist: [0] };
              const held = x.holdings?.[me]?.[l.sym]?.n || 0;
              const on = open === l.sym;
              const bust = l.status !== 'listed';
              const mine = l.owner === me;
              const canOust = !mine && !bust && canMove(w, me, l.sym);
              return (
                <li class={'ex-row' + (on ? ' on' : '')}>
                  <button type="button" class="ex-sum" aria-expanded={on ? 'true' : 'false'} onClick={() => setOpen(on ? null : l.sym)}>
                    <span class="ex-sym">{l.sym}</span>
                    <span class="ex-name"><b>{l.name}</b><span class="small muted">{l.kind === 'bank' ? 'Bank' : l.sector} · {nm(w, l.owner)}{mine ? ' (you)' : ''}{held ? ` · you hold ${held}` : ''}{bust ? ' · BUST' : ''}</span></span>
                    <Spark data={q.hist} w={96} h={28} />
                    <span class="ex-price"><b class="tnum">{bust ? '—' : q.p.toFixed(2)}</b>{!bust && <Move v={pct(q.p, q.open)} />}</span>
                  </button>
                  {on && (
                    <div class="ex-more">
                      <p class="small" style={{ margin: '0 0 6px' }}>{l.about}</p>
                      <ul class="list small">
                        <li class="row"><span>Worth</span><b class="tnum">{worth(w, l)} crowns, {fairPrice(w, l).toFixed(2)} a share</b></li>
                        <li class="row"><span>Shares</span><b class="tnum">{l.shares} · {l.unsold} new for sale · {l.mm} held by the Exchange</b></li>
                        {l.kind === 'company' && (l.profits || []).length > 0 && <li class="row"><span>Last paydays</span><b class="tnum">{l.profits.slice(0, 4).map((d: number) => (d > 0 ? '+' : '') + d).join(', ')}</b></li>}
                      </ul>
                      {!bust && (
                        <div class="grid2" style={{ marginTop: 10 }}>
                          <Field label={`Shares (you hold ${held})`} type="number" value={n} onInput={setN} />
                          <div class="row" style={{ alignSelf: 'end', gap: 6 }}>
                            <Btn small disabled={halted(w)} onClick={() => act('exchange.buy', { sym: l.sym, n: Number(n) }, `Bought ${n} ${l.sym}.`)}>Buy · {Math.ceil(Number(n || 0) * q.p)}</Btn>
                            <Btn small kind="plain" disabled={halted(w) || !held} onClick={() => act('exchange.sell', { sym: l.sym, n: Number(n) }, `Sold ${n} ${l.sym}.`)}>Sell</Btn>
                          </div>
                        </div>
                      )}
                      {mine && !bust && (
                        <Card kind="tint" style={{ marginTop: 10 }}><div class="stack">
                          <b>You own it</b>
                          <div class="grid2"><Field label="Crowns" type="number" value={amt} onInput={setAmt} /><div class="row" style={{ alignSelf: 'end', gap: 6 }}>{l.kind === 'company' && <Btn small kind="ghost" onClick={() => act('exchange.invest', { sym: l.sym, amount: Number(amt) }, 'Invested.')}>Put money in</Btn>}<Btn small onClick={() => act('exchange.dividend', { sym: l.sym, amount: Number(amt) }, 'Dividend paid.')}>Pay a dividend</Btn></div></div>
                          <span class="small muted">A dividend is shared by every share in hands, including yours.</span>
                        </div></Card>
                      )}
                      {canOust && !(x.motions || []).some((m: any) => m.sym === l.sym && m.status === 'open') && <Btn small kind="danger ghost" style={{ marginTop: 10 }} onClick={() => confirm(`Call a vote to remove ${nm(w, l.owner)} as owner?`) && act('exchange.oust', { sym: l.sym }, 'The vote is called.')}>Call a vote to remove the owner</Btn>}
                      <Revolt sym={l.sym} />
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        ) : <Empty>No citizen has floated a company yet. Be the first.</Empty>}
        <Float />
      </Sec>
    </div>
  );
}
function Float() {
  const { world: w, me } = useStore();
  const bank = Object.values(w.banks).find((b: any) => b.owner === me && b.status === 'open') as any;
  const [f, setF] = useState({ kind: 'company', sym: '', name: '', sector: 'Trade', about: '', shares: '200', price: '2', keep: '50', capital: '50' });
  const set = (k: string, v: string) => setF({ ...f, [k]: v });
  const sell = Math.max(0, Number(f.shares) - Number(f.keep));
  return (
    <details class="card dashed" style={{ marginTop: 12 }}>
      <summary><b>Float your own company or bank</b> <span class="small muted">{LIST_FEE} crowns to list</span></summary>
      <div class="stack" style={{ marginTop: 10 }}>
        <Seg value={f.kind} onChange={(v) => set('kind', v)} options={[['company', 'A new company'], ['bank', bank ? `My bank, ${bank.name}` : 'My bank']]} />
        {f.kind === 'bank' && !bank && <span class="small muted">You run no open bank. Open one on the Banks page first (it needs the Banking Act).</span>}
        <div class="grid2">
          <Field label="Ticker (3–4 letters)" value={f.sym} onInput={(v) => set('sym', v.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4))} placeholder="e.g. MAYA" />
          {f.kind === 'company' && <Field label="Company name" value={f.name} onInput={(v) => set('name', v)} placeholder="e.g. Harbour Lights Ltd" />}
        </div>
        {f.kind === 'company' && <div class="grid2"><Pick label="Sector" value={f.sector} onChange={(v) => set('sector', v)} options={SECTORS.map((x) => [x, x])} /><Field label="Starting capital you put in (20–500)" type="number" value={f.capital} onInput={(v) => set('capital', v)} /></div>}
        {f.kind === 'company' && <Field label="What it does (optional)" value={f.about} onInput={(v) => set('about', v.slice(0, 160))} />}
        <div class="grid2">
          <Field label="Shares in all (50–1000)" type="number" value={f.shares} onInput={(v) => set('shares', v)} />
          <Field label="Opening price (1–50)" type="number" value={f.price} onInput={(v) => set('price', v)} />
        </div>
        <Field label="Shares you keep for yourself (a tenth at least)" type="number" value={f.keep} onInput={(v) => set('keep', v)} />
        <span class="small">You sell {sell} new shares at {f.price}: up to {Math.floor(sell * Number(f.price || 0))} crowns raised for {f.kind === 'bank' ? "the bank's reserves" : 'the company'}. Its price will then follow what it is really worth.</span>
        <Btn disabled={f.sym.length < 3 || (f.kind === 'bank' && !bank)} onClick={() => act('exchange.float', { ...f, shares: Number(f.shares), price: Number(f.price), keep: Number(f.keep), capital: Number(f.capital) }, `${f.sym} is listed.`)}>Float it ({LIST_FEE})</Btn>
      </div>
    </details>
  );
}
function Donations() {
  const { world: w, me } = useStore();
  const [party, setParty] = useState('');
  const due = (Object.values(w.proposals) as any[]).flatMap((p) => (p.lobbies || []).filter((l: any) => l.by === me && l.got === true && !l.donated).map((l: any) => ({ p, l })));
  const list = (w.exchange.donations || []) as any[];
  const parties = (Object.values(w.parties) as any[]).filter((p) => p.status === 'active' && p.leader);
  if (!list.length && !due.length) return null;
  return (
    <Sec title="Corporate donations" sub="A company that gets its way on a bill can give 20 crowns to a party, directed by the shareholder who called the vote. Every gift is published here.">
      {due.map(({ p, l }) => <Card kind="tint"><div class="stack"><b>{l.sym} got its way on “{p.title}”. Where does its donation go?</b><div class="grid2"><Pick value={party} onChange={setParty} empty="Which party?" options={parties.map((x) => [x.id, x.name])} /><Btn small style={{ alignSelf: 'end' }} disabled={!party} onClick={() => act('exchange.donate', { prop: p.id, sym: l.sym, party }, 'Donated.')}>Donate 20</Btn></div></div></Card>)}
      {list.length > 0 && <ul class="list">{list.map((d) => <li class="row"><span><b>{d.sym}</b> to the {w.parties[d.party]?.name}<div class="small muted">Directed by {nm(w, d.by)}, after “{w.proposals[d.prop]?.title}”</div></span><b class="tnum">{d.amount}</b></li>)}</ul>}
    </Sec>
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
      <Citizens />
      <Sec title="Your portfolio" sub={`Stamp duty on purchases: ${x.duty}%. You have ${bal(w, ca(me))} crowns.`}>
        {mine.rows.length ? (
          <Card>
            <ul class="list">{mine.rows.map((r) => <li class="row"><span><b>{r.sym}</b> × <span class="tnum">{r.n}</span><div class="small muted">Cost {r.cost}</div></span><span class="tnum">{r.value} <Move v={pct(r.value, r.cost)} /></span></li>)}</ul>
            <div class="row" style={{ marginTop: 8 }}><b>Worth</b><span class="tnum"><b>{mine.value}</b> <Move v={pct(mine.value, mine.cost)} /></span></div>
          </Card>
        ) : <Empty>You own no shares yet. Pick a company below.</Empty>}
      </Sec>
      <Donations />
      <Sec title="Register of Interests" sub="Shares held by MPs, ministers, the Prime Minister and the head of state are public. Everyone else’s are private.">
        {reg.length ? <ul class="list">{reg.map((r) => <li class="row"><Who id={r.id} /><span class="small">{r.holds.map((h: any) => `${h.n} ${h.sym}`).join(', ')}</span></li>)}</ul> : <Empty>Nobody in office owns shares.</Empty>}
      </Sec>
      <Sec title="The wealth fund" sub="Shares the realm owns, bought and sold only by law. Its dividends go to the Treasury.">
        {fund(w).rows.length ? (
          <Card><ul class="list">{fund(w).rows.map((r) => <li class="row"><span><b>{r.sym}</b> × <span class="tnum">{r.n}</span><div class="small muted">Cost {r.cost}</div></span><span class="tnum">{r.value} <Move v={pct(r.value, r.cost)} /></span></li>)}</ul><div class="row" style={{ marginTop: 8 }}><b>Worth</b><span class="tnum"><b>{fund(w).value}</b> <Move v={pct(fund(w).value, fund(w).cost)} /></span></div></Card>
        ) : <Empty>The realm owns no shares.</Empty>}
        <Btn small kind="ghost" href="#/new" style={{ marginTop: 8 }}>{w.acts?.decrees || (w.regime && w.regime.type !== 'civil') ? 'Draft a bill or decree' : 'Draft a bill to buy or sell'}</Btn>
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
