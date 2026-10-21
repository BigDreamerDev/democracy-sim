import { useState } from 'preact/hooks';
import { useStore, setMe, setAutoBots, othersAct, skipTime, skipTo, skipToNext, reset, undo, unlockIntrigue, exportWorld, HOUR, DAY } from './store';
import { nextDeadline, fmtTime, fmtLeft, intrigueOpen, isMP, isPM, isHOS, upcoming, DAYS, officesOf } from '../../engine/index';
import { Btn, ThemeSwitch } from './ui';

function role(w: any, id: string) {
  const r: string[] = [];
  if (w.citizens[id].admin) r.push('RO');
  if (isPM(w, id)) r.push('PM');
  if (isHOS(w, id)) r.push(w.config.hos === 'monarchy' ? w.config.hosTitle : 'President');
  if (w.speaker === id) r.push('Speaker');
  if (isMP(w, id)) r.push('MP');
  officesOf(w, id).forEach((o: any) => r.push(o.title));
  return r.join(', ');
}
const LABEL: Record<string, string> = { payday: 'Payday', pmqs: 'PMQs close', frontpage: 'Front page', election: 'Polls open', polls: 'Polls close' };

// the coming week as tappable stops
function Timeline() {
  const { world: w } = useStore();
  const ev = upcoming(w, 6);
  if (!ev.length) return null;
  return (
    <div>
      <div class="small" style={{ fontWeight: 700, marginBottom: 6 }}>Jump to</div>
      <ol class="timeline">
        {ev.map((e) => (
          <li>
            <button type="button" class={'tl-stop tl-' + e.key} onClick={() => skipTo(e.at)}>
              <i aria-hidden="true" />
              <span><b>{LABEL[e.key]}</b><small>{DAYS[new Date(e.at).getUTCDay()].slice(0, 3)} {String(new Date(e.at).getUTCHours()).padStart(2, '0')}:00 · in {fmtLeft(w, e.at)}</small></span>
            </button>
          </li>
        ))}
      </ol>
    </div>
  );
}

function Controls({ onDone }: { onDone?: () => void }) {
  const { world: w, me, autoBots } = useStore();
  const nd = nextDeadline(w);
  const restart = (s: 'convention' | 'running') => {
    reset(s);
    onDone && onDone();
    location.hash = s === 'convention' ? '#/convention' : '#/';
  };
  return (
    <>
      <p class="small muted" style={{ margin: 0 }}>Game time <b>{fmtTime(w, w.now)}</b>. {nd ? <>Next thing happens in {fmtLeft(w, nd)}.</> : 'Nothing scheduled.'}</p>
      <label class="f">Playing as
        <select class="input" value={me} onChange={(e: any) => setMe(e.target.value)}>
          {Object.values(w.citizens).map((c: any) => <option value={c.id}>{c.name}{role(w, c.id) ? ` (${role(w, c.id)})` : ''}</option>)}
        </select>
      </label>
      <Btn full onClick={() => skipToNext()}>Next event</Btn>
      <Timeline />
      <div class="small" style={{ fontWeight: 700 }}>Skip {autoBots ? '(others act as time passes)' : '(nobody else acts)'}</div>
      <div class="grid3">
        <Btn small kind="ghost" onClick={() => skipTime(HOUR)}>+1 hour</Btn>
        <Btn small kind="ghost" onClick={() => skipTime(6 * HOUR)}>+6 hours</Btn>
        <Btn small kind="ghost" onClick={() => skipTime(DAY)}>+1 day</Btn>
        <Btn small kind="ghost" onClick={() => skipTime(7 * DAY)}>+1 week</Btn>
        <Btn small kind="ghost" onClick={() => w.nextGeneralAt && skipTo(w.nextGeneralAt)}>To election</Btn>
        <Btn small kind="plain" onClick={() => undo()}>Undo</Btn>
      </div>
      <div class="grid2">
        <Btn small onClick={() => othersAct()}>Others act now</Btn>
        <Btn small kind={autoBots ? undefined : 'ghost'} onClick={() => setAutoBots(!autoBots)}>Bots: {autoBots ? 'on' : 'off'}</Btn>
      </div>
      <Btn small kind="ghost" onClick={() => unlockIntrigue()}>{w.flags.intrigueNow ? 'Re-lock the backroom' : intrigueOpen(w) ? 'Backroom is open' : 'Unlock the backroom now'}</Btn>
      <div class="small" style={{ fontWeight: 700 }}>Appearance</div>
      <ThemeSwitch />
      <div class="small" style={{ fontWeight: 700 }}>Start again</div>
      <div class="grid2">
        <Btn small kind="danger ghost" onClick={() => restart('convention')}>Fresh convention</Btn>
        <Btn small kind="danger ghost" onClick={() => restart('running')}>Running realm</Btn>
      </div>
      <Btn small kind="plain" onClick={() => exportWorld()}>Export world as JSON</Btn>
      <p class="small muted" style={{ margin: 0 }}>Saved in this browser. Nothing is sent anywhere.</p>
    </>
  );
}

export function DemoPanel() {
  const [open, setOpen] = useState(false);
  const { world: w, me } = useStore();
  return (
    <>
      <button type="button" class="demo-fab" onClick={() => setOpen(true)} aria-label="Open demo controls">Demo: {w.citizens[me].name}</button>
      {open && (
        <>
          <div class="sheet-bg" onClick={() => setOpen(false)} />
          <div class="sheet" role="dialog" aria-label="Demo controls">
            <div class="in stack">
              <div class="row"><b class="serif" style={{ fontSize: 24 }}>Demo controls</b><button type="button" class="btn plain small" onClick={() => setOpen(false)}>Close</button></div>
              <Controls onDone={() => setOpen(false)} />
            </div>
          </div>
        </>
      )}
    </>
  );
}

export function DemoRail() {
  return (
    <aside class="demo-rail" aria-label="Demo controls">
      <div class="stack">
        <div class="rail-head"><span class="kicker" style={{ margin: 0 }}>Single-player demo</span><b class="serif" style={{ fontSize: 26, lineHeight: 1.05 }}>Demo controls</b></div>
        <Controls />
      </div>
    </aside>
  );
}
