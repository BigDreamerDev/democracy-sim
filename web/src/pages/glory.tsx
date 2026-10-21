// The Red Box, the polls, achievements, season awards and the Hall of Fame.
import { useStore, act } from '../store';
import { Page, Sec, Card, Btn, Who, Left, Empty } from '../ui';
import { nm, fmtDay, fmtTime, DAY } from '../../../engine/index';
import { RED_BOX, BADGES, AWARDS, RECORDS, leaders, streakNow, pmLabel, MAX_FREEZES, FREEZE_COST } from '../../../engine/glory';

// today's question, on the Today page
export function RedBox() {
  const { world: w, me } = useStore();
  const d = w.daily;
  if (!d) return null;
  const q = RED_BOX[d.qi];
  const mine = d.votes?.[me];
  const streak = streakNow(w, w.citizens[me]);
  const y = w.dailyPast?.[0];
  return (
    <div class="redbox rise">
      <div class="row"><span class="redbox-tag">The Red Box</span><span class="small tnum">{streak ? `${streak}-day streak` : 'Start a streak'} · <Left at={d.endsAt} /> left</span></div>
      <p class="redbox-q">{q.q}</p>
      {mine === undefined ? (
        <div class="stack" style={{ gap: 6 }}>{q.a.map((a, i) => <button type="button" class="redbox-a" onClick={() => act('daily.answer', { option: i }, streak + 1 >= 2 ? `${streak + 1} days running.` : 'Answered. Come back tomorrow.')}>{a}</button>)}</div>
      ) : (
        <p class="small" style={{ margin: 0 }}>You said <b>{q.a[mine]}</b>. {d.answered ? `${d.answered} answered so far.` : ''} Results tomorrow.</p>
      )}
      <div class="row redbox-y" style={{ gap: 8 }}><span class="small">Streak freezes: <b>{w.citizens[me].streak?.freezes || 0}</b> of {MAX_FREEZES}. Each covers one missed day.</span>{(w.citizens[me].streak?.freezes || 0) < MAX_FREEZES && <button type="button" class="redbox-a small" style={{ minHeight: 34, padding: '4px 10px' }} onClick={() => act('daily.freeze', {}, 'Freeze bought. A missed day won’t break your streak.')}>Buy one ({FREEZE_COST} Influence)</button>}</div>
      {y && y.n > 0 && <p class="small redbox-y">Yesterday: “{RED_BOX[y.qi].q}” {RED_BOX[y.qi].a.map((a, i) => `${a} ${Math.round((y.counts[i] / y.n) * 100)}%`).join(' · ')}</p>}
    </div>
  );
}

function PollChart() {
  const { world: w } = useStore();
  const polls = (w.polls || []).slice().reverse();
  if (polls.length < 1) return <Empty>The first poll comes out on payday.</Empty>;
  const keys = [...new Set(polls.flatMap((p: any) => Object.keys(p.parties)))] as string[];
  const colour = (k: string) => (k === 'ind' ? 'var(--muted)' : w.parties[k]?.colour || 'var(--muted)');
  const name = (k: string) => (k === 'ind' ? 'Independents' : w.parties[k]?.name ?? 'A party');
  const W_ = 320, H = 150, pad = 24;
  const x = (i: number) => pad + (polls.length === 1 ? (W_ - 2 * pad) / 2 : (i * (W_ - 2 * pad)) / (polls.length - 1));
  const max = Math.max(50, ...polls.flatMap((p: any) => Object.values(p.parties) as number[]));
  const y = (v: number) => H - pad - (v / max) * (H - 2 * pad);
  const last = polls[polls.length - 1];
  return (
    <Card>
      <svg viewBox={`0 0 ${W_} ${H}`} role="img" aria-label="Party standings in each weekly poll" style={{ width: '100%', display: 'block' }}>
        {[0, 25, 50].filter((v) => v <= max).map((v) => <g><line x1={pad} x2={W_ - pad} y1={y(v)} y2={y(v)} stroke="currentColor" stroke-opacity="0.15" /><text x={2} y={y(v) + 4} font-size="9" fill="currentColor" opacity="0.6">{v}%</text></g>)}
        {keys.map((k) => {
          const pts = polls.map((p: any, i: number) => (p.parties[k] !== undefined ? [x(i), y(p.parties[k])] : null)).filter(Boolean) as number[][];
          return <g>{pts.length > 1 && <polyline points={pts.map((p) => p.join(',')).join(' ')} fill="none" stroke={colour(k)} stroke-width="2.5" stroke-linejoin="round" />}{pts.map(([a, b]) => <circle cx={a} cy={b} r="3" fill={colour(k)} />)}</g>;
        })}
      </svg>
      <ul class="list" style={{ marginTop: 6 }}>{Object.entries(last.parties).sort((a: any, b: any) => b[1] - a[1]).map(([k, v]: any) => <li class="row"><span style={{ display: 'flex', alignItems: 'center', gap: 8 }}><i class="dot" style={{ background: colour(k) }} />{name(k)}</span><b class="tnum">{v}%</b></li>)}</ul>
      {last.pm !== null && <p class="small muted" style={{ margin: '6px 0 0' }}>PM {nm(w, last.pmId)}: {last.pm}% approval · {fmtDay(last.at)}</p>}
    </Card>
  );
}

export function Polls() {
  const { world: w } = useStore();
  return (
    <Page back={['#/realm', 'The realm']} kicker="Public opinion" title="The polls" intro="Every payday, a poll of the realm: how each party stands, and how the Prime Minister is doing. It follows approval, seats and who is in power, with a little noise, like any poll.">
      <Sec title="Party standings"><PollChart /></Sec>
      <Sec title="The Red Box" sub="One question a day. Answer it to keep your streak; every seventh day running is worth 5 Influence.">
        <RedBox />
        <ul class="list" style={{ marginTop: 12 }}>
          {(w.dailyPast || []).map((p: any) => {
            const q = RED_BOX[p.qi];
            const top = p.counts.indexOf(Math.max(...p.counts));
            return <li><div class="small muted">{fmtDay(p.day * DAY)} · {p.n} answered</div><div>{q.q}</div>{p.n > 0 && <div class="small"><b>{q.a[top]}</b> {Math.round((p.counts[top] / p.n) * 100)}%</div>}</li>;
          })}
        </ul>
      </Sec>
    </Page>
  );
}

// achievements and the race for this season's awards (shown on the Season page)
export function SeasonExtras() {
  const { world: w, me } = useStore();
  const c = w.citizens[me];
  const got = c.badges || {};
  return (
    <>
      <Sec title="Season awards" sub="Each one is a passport visa at the end of the season. The richest is only revealed then.">
        <ul class="list">{AWARDS.map((a) => {
          const top = a.hidden ? null : leaders(w, a.id)[0];
          return <li class="row"><span><b>{a.name}</b><div class="small muted">{a.unit}</div></span><span class="small">{a.hidden ? 'Revealed at the end' : top ? <><Who id={top.id} /> · {top.n}</> : 'Nobody yet'}</span></li>;
        })}</ul>
      </Sec>
      <Sec title={`Your achievements (${Object.keys(got).length} of ${BADGES.length})`} sub="Each is worth 3 Influence and a stamp. Secret ones show as a question mark until someone unlocks them.">
        <div class="badges">
          {BADGES.map((b) => {
            const on = !!got[b.id];
            const known = on || !b.hidden;
            return <div class={'badge' + (on ? ' on' : '') + (b.hidden ? ' secret' : '')}><b>{known ? b.name : '?'}</b><small>{known ? b.sub : 'A secret achievement'}</small></div>;
          })}
        </div>
      </Sec>
    </>
  );
}

export function Fame() {
  const { world: w } = useStore();
  const f = w.fame || { pms: [], seasons: [], records: {} };
  const days = (p: any) => Math.max(0, Math.round(((p.to || w.now) - p.from) / DAY));
  const longest = f.pms.slice().sort((a: any, b: any) => days(b) - days(a))[0];
  return (
    <Page back={['#/realm', 'The realm']} kicker="Kept forever" title="Hall of Fame" intro="Records, Prime Ministers and season winners. This page survives every reset of the realm.">
      <Sec title="Records">
        <ul class="list">
          {RECORDS.map((r) => {
            const x = f.records[r.id];
            return <li class="row"><span><b>{r.name}</b>{x && <div class="small muted">set {fmtDay(x.at)}</div>}</span><span class="small">{x ? <><b>{x.name}</b> · {x.n} {r.unit}</> : '—'}</span></li>;
          })}
          {longest && <li class="row"><span><b>Longest-serving Prime Minister</b></span><span class="small"><b>{longest.name}</b> · {days(longest)} days</span></li>}
        </ul>
      </Sec>
      <Sec title="Prime Ministers">
        <ol class="list">{f.pms.map((p: any) => <li class="row"><span>{pmLabel(p)}</span><span class="small muted">{fmtDay(p.from)} – {p.to ? fmtDay(p.to) : 'now'} · {days(p)} days</span></li>)}</ol>
        {!f.pms.length && <Empty>No Prime Minister yet.</Empty>}
      </Sec>
      <Sec title="Seasons">
        <div class="stack">
          {f.seasons.map((s: any) => (
            <Card><div class="serif" style={{ fontSize: 22 }}>Season {s.n}</div><div class="small muted">Ended {fmtTime(w, s.at)}</div><ul class="list small" style={{ marginTop: 6 }}>{s.awards.map((a: any) => <li class="row"><span>{a.name}</span><span><b>{a.who}</b> · {a.n} {a.unit}</span></li>)}</ul></Card>
          ))}
          {!f.seasons.length && <Empty>No season has ended yet.</Empty>}
        </div>
      </Sec>
      <Btn kind="plain" href="#/season">This season’s leaderboard</Btn>
    </Page>
  );
}
