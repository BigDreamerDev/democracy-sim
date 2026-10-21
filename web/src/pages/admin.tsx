import { useState } from 'preact/hooks';
import { useEffect } from 'preact/hooks';
import { useStore, act, ONLINE, resetRealm, downloadExport, resetPassword, adminApps, removeApp, restoreApp, toast, adminInvites, makeInvite, makeInvites, revokeInvite, inviteLink, removeDuplicate, adminNotes, saveNote, adminAllowances, setAllowance, adminDevices } from '../store';
import { Page, Sec, Card, Btn, Empty, LinkRow, Field, Pick, When, Seg } from '../ui';
import { CRISES } from '../../../engine/crises';
import { nm, ledgerTotal, fmtTime, acctLabel } from '../../../engine/index';

export function Admin() {
  const { world: w, me } = useStore();
  const [confirm, setConfirm] = useState('');
  const [fame, setFame] = useState<'keep' | 'clear'>('keep');
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
      <Invites />
      <Sec title="Sign-ups waiting" sub="Check each one against the group chat before approving. Turn down anyone who already has an account."><ul class="list">{w.pending.map((p: any) => <li class="row"><span><b>{p.name}</b>{p.who && <div class="small muted">“{p.who}”</div>}{p.sameDevice && <div class="small bad">Same browser as {p.sameDevice.join(', ')}. Check it’s not a second account.</div>}</span><span class="row"><Btn small onClick={() => act('admin.approve', { id: p.id, approve: true }, 'Approved.')}>Approve</Btn><Btn small kind="plain" onClick={() => act('admin.approve', { id: p.id, approve: false })}>Turn down</Btn></span></li>)}</ul>{!w.pending.length && <Empty>Nobody waiting.</Empty>}</Sec>
      <Sec title="Settings">
        <ul class="list">{[['requireApproval', 'New accounts need approval'], ['openSignup', 'The sign-up page is open']].map(([k, l]) => <li class="row"><span>{l}</span><Btn small kind={w.flags[k] ? undefined : 'ghost'} onClick={() => act('admin.setting', { key: k, value: !w.flags[k] })}>{w.flags[k] ? 'On' : 'Off'}</Btn></li>)}</ul>
        <Btn href="#/calendar" kind="ghost" small style={{ marginTop: 10 }}>Change the calendar</Btn>
        <p class="small muted">Game rules change only through Parliament.</p>
      </Sec>
      {w.induction && !w.induction.done && (
        <Sec title="Induction week" sub="Everything is practice until it ends. Ending it early is announced.">
          <Card kind="tint"><div class="row"><span>Ends <When at={w.induction.until} /></span><Btn small kind="danger ghost" onClick={() => act('admin.endInduction', {}, 'Induction is over. The real game begins.')}>End it now</Btn></div></Card>
        </Sec>
      )}
      <Zones />
      <Vetting />
      <Duplicates />
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
            <span class="small">Wipes the game and opens a fresh Founding Convention for every approved account. Accounts, sign-in methods and the sign-up queue stay. A snapshot is kept on the server first.</span>
            <div><div class="small" style={{ fontWeight: 700, marginBottom: 6 }}>Hall of Fame</div><Seg value={fame} onChange={setFame} options={[['keep', 'Keep it'], ['clear', 'Clear it too']]} /></div>
            <Field label="Type RESET THE REALM" value={confirm} onInput={setConfirm} />
            <Btn kind="danger" disabled={confirm !== 'RESET THE REALM'} onClick={() => resetRealm(confirm, fame === 'clear').then(() => (setConfirm(''), toast('A new realm begins.'), (location.hash = '#/'))).catch((e) => toast(e.message, true))}>Reset the realm</Btn>
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

// safety is the one game area the RO can change directly: safe zones in the Streets (bounties are taken down from the market)
function Zones() {
  const { world: w } = useStore();
  const [t, setT] = useState('');
  return (
    <Sec title="Streets safe zones" sub="Tags in a safe zone don't count. Adding or removing one is announced. Take down unsafe bounties from the market.">
      <ul class="list">{(w.streets?.zones || []).map((z: any) => <li class="row"><span>{z.text}<div class="small muted">{z.by === 'law' ? 'by law' : z.by === 'ro' ? 'added by you' : 'standard'}</div></span><Btn small kind="plain" onClick={() => confirm(`Remove "${z.text}"? It's announced in the Gazette.`) && act('admin.zone', { remove: z.id }, 'Removed.')}>Remove</Btn></li>)}</ul>
      <div class="grid2" style={{ marginTop: 8 }}><Field label="New safe zone" value={t} onInput={setT} placeholder="e.g. The library" /><Btn style={{ alignSelf: 'end' }} onClick={() => act('admin.zone', { add: t }, 'Added. It is in the Gazette.') && setT('')}>Add</Btn></div>
      <Btn small kind="ghost" href="#/market" style={{ marginTop: 8 }}>Bounties</Btn>
    </Sec>
  );
}

// single-use invitation links: they work with sign-ups closed and need no approval. One name per line for a batch.
function Invites() {
  const [list, setList] = useState<any[]>([]);
  const [names, setNames] = useState('');
  const [made, setMade] = useState<{ name: string; link: string }[]>([]);
  const load = () => ONLINE && adminInvites().then(setList).catch(() => {});
  useEffect(() => void load(), []);
  const make = async () => {
    const ns = names.split(/\n|,/).map((x) => x.trim()).filter(Boolean);
    if (!ns.length) return toast('Type at least one name.', true);
    try {
      const r = ns.length === 1 ? [await makeInvite(ns[0])] : (await makeInvites(ns)).invites;
      setMade(r.map((x: any) => ({ name: x.name, link: inviteLink(x.code) })));
      setNames('');
      load();
    } catch (e: any) {
      toast(e.message, true);
    }
  };
  const copy = (t: string) => navigator.clipboard?.writeText(t).then(() => toast('Copied. Send each link privately.')).catch(() => toast('Copy it by hand.', true));
  return (
    <Sec title="Invitations" sub="One link for one person, good for 7 days. It works while sign-ups are closed and needs no approval, so you can keep the sign-up page shut. Making them is announced.">
      {!ONLINE ? <Empty>Invitations need the real server.</Empty> : (
        <div class="stack">
          <Field label="Who they're for (one name per line for several)" area value={names} onInput={setNames} placeholder={'Sam\nPriya\nDev'} />
          <Btn onClick={make}>Make {names.split(/\n|,/).filter((x) => x.trim()).length > 1 ? 'the links' : 'a link'}</Btn>
          {made.length > 0 && (
            <Card kind="tint"><div class="stack" style={{ gap: 8 }}>
              <b>{made.length === 1 ? `Link for ${made[0].name}` : `${made.length} links`}</b>
              <span class="small muted">This is the only time you'll see them. DM each one to its person, not the group: whoever opens a link first gets that account.</span>
              {made.map((m) => <div class="row" style={{ gap: 8, alignItems: 'flex-start' }}><span style={{ minWidth: 0 }}><b class="small">{m.name}</b><code class="small" style={{ display: 'block', wordBreak: 'break-all' }}>{m.link}</code></span><Btn small kind="plain" onClick={() => copy(m.link)}>Copy</Btn></div>)}
              {made.length > 1 && <Btn small onClick={() => copy(made.map((m) => `${m.name}: ${m.link}`).join('\n'))}>Copy them all</Btn>}
            </div></Card>
          )}
          <ul class="list">{list.map((i) => <li class="row"><span>{i.name}<div class="small muted">{i.status === 'used' ? `Used by ${i.usedName}` : i.status === 'open' ? <>Open until <When at={new Date(i.expiresAt).getTime()} /></> : i.status}</div></span>{i.status === 'open' && <Btn small kind="plain" onClick={() => revokeInvite(i.id).then(() => (toast('Revoked.'), load())).catch((e) => toast(e.message, true))}>Revoke</Btn>}</li>)}</ul>
          {!list.length && <Empty>No invitations yet.</Empty>}
        </div>
      )}
    </Sec>
  );
}

// every citizen with your private notes, who invited them, their invitation allowance, and shared-device warnings
function Vetting() {
  const { world: w } = useStore();
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [allow, setAllow] = useState<Record<string, number>>({});
  const [devices, setDevices] = useState<any[]>([]);
  const [open, setOpen] = useState('');
  const load = () => {
    if (!ONLINE) return;
    adminNotes().then(setNotes).catch(() => {});
    adminAllowances().then(setAllow).catch(() => {});
    adminDevices().then(setDevices).catch(() => {});
  };
  useEffect(() => void load(), []);
  if (!ONLINE) return <Sec title="Citizens"><Empty>Notes, invitation allowances and device warnings need the real server.</Empty></Sec>;
  const people = [...w.pending.map((p: any) => ({ id: p.uid, name: p.name, pending: true })), ...(Object.values(w.citizens) as any[]).filter((c) => c.active && !c.bot).map((c) => ({ id: c.id, name: c.name, pending: false }))];
  const note = (id: string) => saveNote(id, draft[id] ?? notes[id] ?? '').then(() => (toast('Note saved. Only you can see it.'), load(), setOpen(''))).catch((e) => toast(e.message, true));
  const give = (id: string, n: number) => setAllowance(id, n).then(() => (toast(n ? `They can send ${n} invitation${n > 1 ? 's' : ''}.` : 'Invitations taken away.'), load())).catch((e) => toast(e.message, true));
  return (
    <>
      {devices.length > 0 && (
        <Sec title="Shared devices" sub="These accounts were used in the same browser. Often that's siblings or a borrowed phone; sometimes it's a second account. Check before acting.">
          <div class="stack">{devices.map((g) => <Card kind="warn"><b>Device {g.device}</b><div class="small">{g.users.map((u: any) => `${u.name}${u.active ? '' : ' (removed)'}`).join(', ')}</div></Card>)}</div>
        </Sec>
      )}
      <Sec title="Citizens" sub="Your notes are private to you. Giving someone invitations lets them invite friends without asking you; it's announced, and the Gazette says who invited whom.">
        <ul class="list">{people.map((p) => (
          <li>
            <div class="row"><span><b>{p.name}</b>{p.pending && <span class="small muted"> · applying</span>}<div class="small muted">{w.citizens[p.id]?.invitedBy ? `Invited by ${nm(w, w.citizens[p.id].invitedBy)}` : ''}{allow[p.id] ? `${w.citizens[p.id]?.invitedBy ? ' · ' : ''}${allow[p.id]} invitation${allow[p.id] > 1 ? 's' : ''} left` : ''}</div>{notes[p.id] && open !== p.id && <div class="small">“{notes[p.id]}”</div>}</span>
              <Btn small kind="plain" onClick={() => setOpen(open === p.id ? '' : p.id)}>{open === p.id ? 'Close' : 'Note'}</Btn></div>
            {open === p.id && (
              <div class="stack" style={{ gap: 6, margin: '6px 0' }}>
                <Field label="Private note" value={draft[p.id] ?? notes[p.id] ?? ''} onInput={(v) => setDraft({ ...draft, [p.id]: v })} placeholder="Confirmed in person" />
                <div class="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                  <Btn small onClick={() => note(p.id)}>Save note</Btn>
                  {!p.pending && [0, 1, 2, 3].map((n) => <Btn small kind={(allow[p.id] || 0) === n ? undefined : 'ghost'} onClick={() => give(p.id, n)}>{n ? `${n} invite${n > 1 ? 's' : ''}` : 'No invites'}</Btn>)}
                </div>
              </div>
            )}
          </li>
        ))}</ul>
      </Sec>
    </>
  );
}

// a second account for someone who already has one
function Duplicates() {
  const { world: w } = useStore();
  const [dup, setDup] = useState('');
  const [keep, setKeep] = useState('');
  const people = Object.values(w.citizens).filter((c: any) => c.active && !c.bot).map((c: any) => [c.id, c.name]) as [string, string][];
  const go = () => {
    if (!dup || !keep) return toast('Pick both accounts.', true);
    if (!confirm(`Remove ${nm(w, dup)} as a second account of ${nm(w, keep)}? Their crowns move to ${nm(w, keep)}, their open votes are struck out, they lose any seat or office, and they can't sign in again. It's announced.`)) return;
    removeDuplicate(dup, keep).then(() => (setDup(''), setKeep(''))).catch((e: any) => toast(e.message, true));
  };
  return (
    <Sec title="Duplicate accounts" sub="When one person has two accounts. The extra one stops being a citizen; their crowns go to the real one and any open votes they cast are struck out, so nobody votes twice.">
      <div class="stack">
        <Pick label="The extra account" value={dup} onChange={setDup} empty="Pick one" options={people} />
        <Pick label="Belongs to" value={keep} onChange={setKeep} empty="Pick their real account" options={people.filter(([id]) => id !== dup)} />
        <Btn kind="danger ghost" onClick={go}>Remove the extra account</Btn>
      </div>
    </Sec>
  );
}
