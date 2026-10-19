import { useState } from 'preact/hooks';
import { useEffect } from 'preact/hooks';
import { useStore, act, ONLINE, resetRealm, downloadExport, resetPassword, adminApps, removeApp, restoreApp, toast } from '../store';
import { Page, Sec, Card, Btn, Empty, LinkRow, Field, Pick } from '../ui';
import { CRISES } from '../../../engine/crises';
import { nm, ledgerTotal, fmtTime, acctLabel } from '../../../engine/index';

export function Admin() {
  const { world: w, me } = useStore();
  const [confirm, setConfirm] = useState('');
  const [who, setWho] = useState('');
  const [crisis, setCrisis] = useState('');
  const [temp, setTemp] = useState('');
  const [apps, setApps] = useState<any[]>([]);
  const [why, setWhy] = useState<Record<string, string>>({});
  const loadApps = () => adminApps().then(setApps).catch(() => {});
  useEffect(() => void (ONLINE && w.citizens[me]?.admin && loadApps()), []);
  if (!w.citizens[me].admin) return <Page back={['#/realm', 'The realm']} title="Returning Officer only" intro={ONLINE ? 'This page is for the person running the game.' : 'Switch to Uzair in the demo controls.'} />;
  const stuck = Object.values(w.proposals).filter((p: any) => p.stage === 'assent') as any[];
  // online, the server checks the whole ledger; this device only holds public accounts and yours
  const total = w.audit ? w.audit.total : ledgerTotal(w);
  return (
    <Page back={['#/realm', 'The realm']} kicker="Returning Officer" title="Admin" intro={<>You run the game and play like anyone else, offices included. Everything you do on this page is announced in the Gazette and kept in the <a href="#/rolog">public log</a>.</>}>
      <Sec title="Sign-ups waiting"><ul class="list">{w.pending.map((p: any) => <li class="row"><b>{p.name}</b><span class="row"><Btn small onClick={() => act('admin.approve', { id: p.id, approve: true }, 'Approved.')}>Approve</Btn><Btn small kind="plain" onClick={() => act('admin.approve', { id: p.id, approve: false })}>Turn down</Btn></span></li>)}</ul>{!w.pending.length && <Empty>Nobody waiting.</Empty>}</Sec>
      <Sec title="Settings">
        <ul class="list">{[['requireApproval', 'New accounts need approval'], ['openSignup', 'The sign-up page is open']].map(([k, l]) => <li class="row"><span>{l}</span><Btn small kind={w.flags[k] ? undefined : 'ghost'} onClick={() => act('admin.setting', { key: k, value: !w.flags[k] })}>{w.flags[k] ? 'On' : 'Off'}</Btn></li>)}</ul>
        <Btn href="#/calendar" kind="ghost" small style={{ marginTop: 10 }}>Change the calendar</Btn>
        <p class="small muted">Game rules change only through Parliament.</p>
      </Sec>
      <Sec title="Start a crisis" sub="One lands every payday anyway. Starting one now is announced, and the PM still decides it.">
        {w.phase !== 'running' ? <Empty>Crises begin once Parliament is running.</Empty> : Object.values(w.crises).some((c: any) => c.status === 'open') ? <Empty>A crisis is already open.</Empty> : (
          <div class="grid2">
            <Pick value={crisis} onChange={setCrisis} empty="Surprise me" options={CRISES.filter((c) => !c.chainOnly && (!c.needs || c.needs(w))).map((c) => [c.id, (c.extreme ? '⚠ ' : '') + c.title + (c.house ? ' (House vote)' : '')])} />
            <Btn style={{ alignSelf: 'end' }} onClick={() => act('admin.crisis', { type: crisis }, 'Crisis started.') && setCrisis('')}>Start it</Btn>
          </div>
        )}
      </Sec>
      <Sec title="Stuck bills" sub="Passed bills awaiting assent can be force-enacted, with a public reason, from the bill's page."><ul class="list">{stuck.map((p) => <LinkRow href={'#/p/' + p.id} title={p.title} />)}</ul>{!stuck.length && <Empty>None.</Empty>}</Sec>
      <Sec title="Ledger check">
        <Card kind={total === 0 ? 'tint' : 'warn'}><b>{total === 0 ? 'Balanced.' : 'Out of balance.'}</b> All accounts sum to {total}. The Reserve's negative balance is every crown it has issued.</Card>
        <ul class="list" style={{ marginTop: 10 }}>{Object.entries(w.accounts).filter(([k]) => !k.startsWith('c:')).map(([k, v]: any) => <li class="row"><span>{acctLabel(w, k)}</span><b class="tnum">{v}</b></li>)}</ul>
      </Sec>
      <Sec title="Admin log" sub="Everyone can read this."><LinkRow href="#/rolog" title="The public log" sub={`${w.adminLog.length} entries`} /></Sec>
      {ONLINE && (
        <Sec title="Forgotten password" sub="Gives you a temporary password to DM them. The Gazette records that you did it.">
          <div class="grid2">
            <Pick value={who} onChange={setWho} empty="Whose" options={Object.values(w.citizens).filter((c: any) => c.id !== me).map((c: any) => [c.id, c.name])} />
            <Btn disabled={!who} onClick={() => resetPassword(who).then((t) => setTemp(`${nm(w, who)}: ${t}`)).catch((e) => toast(e.message, true))}>Reset it</Btn>
          </div>
          {temp && <Card kind="tint" style={{ marginTop: 10 }}><b class="tnum" style={{ userSelect: 'all' }}>{temp}</b><div class="small muted">Send it privately. They can change it on their passport.</div></Card>}
        </Sec>
      )}
      {ONLINE && (
        <Sec title="Player apps" sub="Removing an app takes it out of the directory, stops new sign-ins and revokes every key it holds. The reason is published in the Gazette.">
          {apps.length ? <ul class="list">{apps.map((a) => (
            <li><div class="row"><span><b>{a.name}</b> <span class="small muted">by {a.by}{a.listed ? '' : ' · unlisted'}</span></span>
              {a.removed ? <Btn small kind="ghost" onClick={() => restoreApp(a.client_id).then(() => (toast('Restored. Players must sign in again.'), loadApps())).catch((e) => toast(e.message, true))}>Restore</Btn> : null}</div>
              {a.removed ? <div class="small err-line">Removed: {a.removed}</div> : (
                <div class="grid2" style={{ marginTop: 6 }}><Field label="Reason (public)" value={why[a.client_id] || ''} onInput={(v) => setWhy({ ...why, [a.client_id]: v })} />
                  <Btn small kind="danger" style={{ alignSelf: 'end' }} disabled={(why[a.client_id] || '').trim().length < 4} onClick={() => removeApp(a.client_id, why[a.client_id]).then((r) => (toast(`Removed. ${r.revoked} key${r.revoked === 1 ? '' : 's'} revoked.`), loadApps())).catch((e) => toast(e.message, true))}>Remove</Btn></div>
              )}
            </li>
          ))}</ul> : <Empty>No apps registered.</Empty>}
        </Sec>
      )}
      {ONLINE && (
        <Sec title="Backups and reset" sub="The export holds everything, secrets included. Keep it to yourself.">
          <Btn kind="ghost" small onClick={() => downloadExport().catch((e) => toast(e.message, true))}>Download full export</Btn>
          <Card kind="warn" style={{ marginTop: 12 }}><div class="stack">
            <b>Start over</b>
            <span class="small">Wipes the game and opens a fresh Founding Convention for every approved account. A snapshot is kept on the server first.</span>
            <Field label="Type RESET THE REALM" value={confirm} onInput={setConfirm} />
            <Btn kind="danger" disabled={confirm !== 'RESET THE REALM'} onClick={() => resetRealm(confirm).then(() => (setConfirm(''), toast('A new realm begins.'), (location.hash = '#/'))).catch((e) => toast(e.message, true))}>Reset the realm</Btn>
          </div></Card>
        </Sec>
      )}
    </Page>
  );
}

// public: everything the Returning Officer has done with admin powers
export function RoLog() {
  const { world: w } = useStore();
  const ro = Object.values(w.citizens).find((c: any) => c.admin) as any;
  return (
    <Page back={['#/realm', 'The realm']} kicker="On the record" title="The Returning Officer’s log" intro={<>{ro ? <b>{ro.name}</b> : 'The Returning Officer'} runs the game and also plays it. Every use of admin powers is listed here and announced in the Gazette, so anyone can check them.</>}>
      {w.adminLog.length ? <ol class="gz">{w.adminLog.map((l: any) => <li class="ro"><div class="small muted">{fmtTime(w, l.at)}</div><div style={{ fontSize: 15 }}><b>{nm(w, l.by)}</b> {l.text.charAt(0).toLowerCase() + l.text.slice(1)}</div></li>)}</ol> : <Empty>Nothing yet.</Empty>}
    </Page>
  );
}
