// What the Acts in acts.ts put on screen: the Realm Jail (public), and the Prime Minister's powers under the
// Government Powers, Continuity of Parliament and National Unity Acts.
import { useState } from 'preact/hooks';
import { useStore, act } from '../store';
import { Page, Sec, Card, Btn, Field, Pick, Who, When, Empty, LinkRow } from '../ui';
import { nm, allCitizens, isPM, isMP, isHOS, exiled, detained, jailed, hasPower, fmtTime } from '../../../engine/index';
import { ACTS, jailList, ministerOf, emptySeats } from '../../../engine/acts';
import { ClauseEditor } from './house';
import { DecreeForm } from './regime';
import { EmpirePanel, WarMachine } from './empire';

const people = (w: any, ok: (c: any) => boolean): [string, string][] => allCitizens(w).filter(ok).map((c: any) => [c.id, c.name]);

// ---------- the Realm Jail ----------
export function Jail() {
  const { world: w, me } = useStore();
  const [t, setT] = useState('');
  const [days, setDays] = useState('');
  const [letter, setLetter] = useState('');
  const list = jailList(w);
  const law = w.acts?.jail;
  const can = !!law && (isPM(w, me) || hasPower(w, me, 'detain'));
  const canFree = !!law && (isPM(w, me) || hasPower(w, me, 'release'));
  const min = ministerOf(w);
  return (
    <Page kicker={law ? `Under ${law}, the Public Order and Detention Act` : 'Closed'} title="The Realm Jail"
      intro={law ? <>Detained by order of the government, with no trial. Only the Prime Minister{min?.holder ? `, ${nm(w, w.pm)},` : ''} or the Minister of Public Order{min?.holder ? `, ${nm(w, min.holder)},` : ''} can release anyone.</> : 'The realm has no law that lets anyone be detained.'}>
      {jailed(w, me) && (
        <Sec title="You are in the Realm Jail" sub={<>{w.citizens[me].jail.until ? <>Until <When at={w.citizens[me].jail.until} />, unless released sooner.</> : 'There is no end date.'} You can read everything and write one letter a day. It is printed in the Gazette.</>}>
          <div class="stack"><Field label="A letter from the Realm Jail" area value={letter} onInput={setLetter} /><Btn full onClick={() => (act('prison.letter', { text: letter }, 'Smuggled out. It is in the Gazette.'), setLetter(''))}>Send it out</Btn></div>
        </Sec>
      )}
      <Sec title={`Detainees (${list.length})`}>
        <ul class="list">
          {list.map((j: any) => (
            <li class="row">
              <span><Who id={j.id} />{isMP(w, j.id) ? ', MP (seat suspended)' : ''}<div class="small muted">Ordered by {nm(w, j.by)}, {fmtTime(w, j.at)}. {j.until ? `Until ${fmtTime(w, j.until)}.` : 'No end date.'}</div></span>
              {canFree && <Btn small kind="ghost" onClick={() => act('jail.release', { target: j.id }, 'Released.')}>Release</Btn>}
            </li>
          ))}
        </ul>
        {!list.length && <Empty>Nobody is detained.</Empty>}
      </Sec>
      {can && (
        <Sec title="Detain someone" sub="Anyone but the Prime Minister and the head of state. No reason is needed, and it is announced in the Gazette. They lose every office and any party leadership; an MP keeps a suspended seat.">
          <div class="stack">
            <Pick value={t} onChange={setT} empty="Pick a citizen" options={people(w, (c) => !isPM(w, c.id) && !isHOS(w, c.id) && !jailed(w, c.id))} />
            <Field label="Days (leave empty for no end date)" type="number" value={days} onInput={setDays} />
            <Btn kind="danger" full onClick={() => act('jail.detain', { target: t, ...(days ? { days: Number(days) } : {}) }, 'Detained.')}>Detain</Btn>
          </div>
        </Sec>
      )}
    </Page>
  );
}

// ---------- the Prime Minister's powers ----------
export function Powers() {
  const { world: w, me } = useStore();
  const pm = isPM(w, me);
  const A = w.acts || {};
  const any = A.jail || A.decrees || A.continuity || A.unity || A.protection || A.press || A.security || A.crown || A.prerogative || A.veto || A.imperial;
  return (
    <Page kicker="Acts in force" title="Government powers" intro={any ? 'Powers Parliament has given the government. Each lasts until the law that made it is repealed.' : 'Parliament has given the government no special powers.'}>
      {any && <Sec><ul class="list">{(['jail', 'decrees', 'continuity', 'unity', 'protection', 'press', 'security', 'crown', 'prerogative', 'veto', 'imperial'] as const).filter((k) => A[k]).map((k) => <LinkRow href={'#/law/' + A[k]} title={`${ACTS[k].name} Act`} sub={`${A[k]}. ${({ jail: 'The Realm Jail.', decrees: 'Rule by decree.', continuity: 'No elections.', unity: 'One party.', protection: 'Entrenched: only a decree repeals it.', press: 'Licensed press, approved questions.', security: 'Harder coups.', crown: 'The head of state is Prime Minister.', prerogative: 'Assent can be refused.', veto: 'The Crown can strike bills.', imperial: 'An empire: the Privy Council sits in place of Parliament.' } as any)[k]}`} />)}</ul></Sec>}
      {A.jail && <Sec><Btn kind="ghost" full href="#/jail">The Realm Jail</Btn></Sec>}
      <EmpirePanel />
      {w.acts?.imperial && <WarMachine />}
      {A.decrees && pm && <Decrees />}
      {A.decrees && !pm && <Sec title="Rule by decree"><p class="small" style={{ margin: 0 }}>The Prime Minister makes law by decree, and the head of state can no longer refuse assent. {w.regime?.type === 'civil' ? <a href="#/regime">See what is in force</a> : 'No built-in decrees are in force.'}</p></Sec>}
      {A.continuity && <Continuity />}
      {A.unity && <Unity />}
      {A.protection && <Protection />}
      {A.press && <PressControl />}
      {A.security && <Sec title="State Security"><p class="small" style={{ margin: 0 }}>Plots need {Math.max(4, 2 + (w.offices.army ? 3 : 4))} members or more, and every coup goes to a contested night with the security forces (+3), the Prime Minister (2) and every minister on the government’s side. {pm && !w.offices.security?.holder ? <>With no Director, you hold the Security Service’s powers: <a href="#/plots">two investigations a day, and raids</a>.</> : ''}</p></Sec>}
    </Page>
  );
}

function Decrees() {
  const { world: w } = useStore();
  const [title, setTitle] = useState('');
  const [summary, setSummary] = useState('');
  const [clauses, setClauses] = useState<any[]>([{ t: 'text', text: '' }]);
  const perDay = Math.max(1, Number(w.config.edictsPerDay) || 1);
  const usedToday = w.regime?.type === 'civil' && w.regime.decreeDay === Math.floor(w.now / 86400000) ? w.regime.decreeCount || 1 : 0;
  const today = usedToday >= perDay;
  return (
    <>
      <Sec title="Make law by decree" sub="Anything a bill can contain, including the constitution. It becomes law the moment you issue it: no debate, vote or assent. Only a later decree can repeal it.">
        <div class="stack">
          <Field label="Title" value={title} onInput={setTitle} placeholder="e.g. Public Holidays Decree" />
          <Field label="Summary (optional)" value={summary} onInput={setSummary} />
          {clauses.map((e, i) => <ClauseEditor e={e} n={i + 1} onChange={(x) => setClauses(clauses.map((y, j) => (j === i ? x : y)))} onRemove={clauses.length > 1 ? () => setClauses(clauses.filter((_, j) => j !== i)) : undefined} />)}
          {clauses.length < 20 && <Btn kind="ghost" onClick={() => setClauses([...clauses, { t: 'text', text: '' }])}>Add a clause</Btn>}
          <Btn kind="danger" full onClick={() => act('gov.decree', { title, summary, clauses }, 'Decreed. It is law.')}>Issue the decree</Btn>
        </div>
      </Sec>
      <Sec title="Built-in decrees" sub={today ? `You have issued all ${perDay === 1 ? 'of today’s' : perDay}. Come back tomorrow.` : perDay > 1 ? `${perDay - usedToday} of ${perDay} left today, as if you led a dictatorship, with no legitimacy cost. Everything you decree stays in force until you lift it, a coup ends it, or the Act is repealed.` : 'One a day, as if you led a dictatorship, with no legitimacy cost. Everything you decree stays in force until you lift it, a coup ends it, or the Act is repealed.'}>
        <DecreeForm type="civil" cmd="gov.edict" />
        {w.regime?.type === 'civil' && <p class="small" style={{ marginTop: 8 }}><a href="#/regime">What is in force, the censor’s desk, and the realm’s resistance</a></p>}
      </Sec>
    </>
  );
}

function Continuity() {
  const { world: w, me } = useStore();
  const pm = isPM(w, me);
  const [sp, setSp] = useState('');
  const [seat, setSeat] = useState('');
  const [out, setOut] = useState('');
  const empty = emptySeats(w);
  const nat = w.acts?.unity && w.acts.national;
  return (
    <Sec title="Continuity of Parliament" sub="No general elections. The House sits as it is; the Prime Minister appoints the Speaker and fills empty seats.">
      <Card>
        <div class="small">Speaker: {w.speaker ? <Who id={w.speaker} /> : 'none'}. Empty seats: {empty}. Seasons still end every {w.config.termDays} days{w.seasonDueAt ? <>; this one ends <When at={w.seasonDueAt} /></> : ''}.</div>
      </Card>
      {pm && (
        <div class="stack" style={{ marginTop: 10 }}>
          <div class="grid2"><Pick value={sp} onChange={setSp} empty="Appoint a Speaker" options={people(w, (c) => !isMP(w, c.id) && !isHOS(w, c.id) && !detained(w, c.id) && !exiled(w, c.id))} /><Btn kind="ghost" onClick={() => act('gov.speaker', { target: sp }, 'Appointed.')}>Appoint</Btn></div>
          {w.speaker && <Btn kind="plain" onClick={() => act('gov.speaker', { target: null }, 'Removed.')}>Remove the Speaker</Btn>}
          {empty > 0 && <div class="grid2"><Pick value={seat} onChange={setSeat} empty="Fill an empty seat" options={people(w, (c) => !isMP(w, c.id) && w.speaker !== c.id && !isHOS(w, c.id) && !detained(w, c.id) && !exiled(w, c.id) && (!nat || c.party === nat))} /><Btn kind="ghost" onClick={() => act('gov.seat', { target: seat }, 'Seated.')}>Give them the seat</Btn></div>}
          <div class="grid2"><Pick value={out} onChange={setOut} empty="Remove an MP" options={w.seats.filter(Boolean).map((m: string) => [m, nm(w, m)])} /><Btn kind="danger ghost" onClick={() => act('gov.unseat', { target: out }, 'Removed from the House.')}>Remove</Btn></div>
        </div>
      )}
    </Sec>
  );
}

function Unity() {
  const { world: w, me } = useStore();
  const p = w.parties[w.acts.national];
  const [x, setX] = useState('');
  if (!p) return null;
  const pm = isPM(w, me);
  const mine = w.citizens[me].party === p.id;
  const members = allCitizens(w).filter((c: any) => c.party === p.id);
  return (
    <Sec title="The National Party" sub="The only legal party. The Prime Minister leads it and decides who joins. In the House its line is the Prime Minister’s own vote; an MP who votes against it is expelled.">
      <Card><div class="small">{members.length} member{members.length === 1 ? '' : 's'}: {members.map((c: any) => c.name).join(', ') || 'none'}.</div></Card>
      {pm && (p.applicants || []).length > 0 && <ul class="list">{p.applicants.map((id: string) => <li class="row"><Who id={id} /><span class="row" style={{ gap: 6 }}><Btn small onClick={() => act('party.admit', { target: id, yes: true }, 'Admitted.')}>Admit</Btn><Btn small kind="plain" onClick={() => act('party.admit', { target: id, yes: false }, 'Refused.')}>Refuse</Btn></span></li>)}</ul>}
      {pm && <div class="grid2" style={{ marginTop: 10 }}><Pick value={x} onChange={setX} empty="Expel a member" options={members.filter((c: any) => c.id !== me).map((c: any) => [c.id, c.name])} /><Btn kind="danger ghost" onClick={() => act('party.expel', { target: x }, 'Expelled.')}>Expel</Btn></div>}
      {!pm && !mine && ((p.applicants || []).includes(me) ? <Card>Your application is with the Prime Minister.</Card> : <Btn full style={{ marginTop: 10 }} onClick={() => act('party.apply', {}, 'Application sent.')}>Apply to join</Btn>)}
      {!pm && mine && <Btn kind="plain" full style={{ marginTop: 10 }} onClick={() => act('party.join', { party: null }, 'You have left. You are an independent.')}>Leave the party</Btn>}
    </Sec>
  );
}

function Protection() {
  const { world: w, me } = useStore();
  const pm = isPM(w, me);
  const [d, setD] = useState('');
  const [h, setH] = useState('');
  const waiting = (Object.values(w.proposals) as any[]).filter((p) => p.stage === 'consent');
  const amends = (Object.values(w.proposals) as any[]).flatMap((p) => (p.amendments || []).filter((m: any) => m.status === 'consent').map((m: any) => ({ p, m })));
  return (
    <Sec title="Protection of the State" sub="No confidence votes, no censures of the government, and nothing tabled without the Prime Minister’s consent. Entrenched with the other Acts: only a decree repeals them.">
      <Card><div class="small">Deputy Prime Minister: {w.deputy ? <Who id={w.deputy} /> : 'none named'}. If the Prime Minister leaves office, {w.deputy ? 'the Deputy' : 'the longest-serving MP of their party'} takes over at once.</div></Card>
      {pm && (
        <div class="stack" style={{ marginTop: 10 }}>
          <div class="grid2"><Pick value={d} onChange={setD} empty="Name a Deputy" options={people(w, (c) => c.id !== me && !isHOS(w, c.id) && !detained(w, c.id) && !exiled(w, c.id))} /><Btn kind="ghost" onClick={() => act('gov.deputy', { target: d }, 'Named.')}>Name</Btn></div>
          {w.deputy && <Btn kind="plain" onClick={() => act('gov.deputy', { target: null }, 'Removed.')}>Remove the Deputy</Btn>}
          {!w.hos.holder && <div class="grid2"><Pick value={h} onChange={setH} empty="Appoint a head of state" options={people(w, (c) => c.id !== me && !detained(w, c.id) && !exiled(w, c.id))} /><Btn onClick={() => act('gov.hos', { target: h }, 'Appointed.')}>Appoint</Btn></div>}
          <div class="small" style={{ fontWeight: 700, marginTop: 6 }}>Waiting for your consent</div>
          {waiting.map((p) => <Card><b>{p.title}</b><div class="small muted">{p.kind === 'bill' ? 'Bill' : p.kind} by {nm(w, p.by)}. <a href={'#/p/' + p.id}>Read it</a></div><div class="grid2" style={{ marginTop: 8 }}><Btn small onClick={() => act('gov.consent', { prop: p.id, yes: true }, 'Tabled.')}>Consent</Btn><Btn small kind="plain" onClick={() => act('gov.consent', { prop: p.id, yes: false }, 'Refused.')}>Refuse</Btn></div></Card>)}
          {amends.map(({ p, m }) => <Card><b>Amendment to {p.title}</b><div class="small muted">By {nm(w, m.by)}. <a href={'#/p/' + p.id}>Read it</a></div><div class="grid2" style={{ marginTop: 8 }}><Btn small onClick={() => act('gov.consent', { prop: p.id, amendment: m.id, yes: true }, 'Allowed.')}>Consent</Btn><Btn small kind="plain" onClick={() => act('gov.consent', { prop: p.id, amendment: m.id, yes: false }, 'Refused.')}>Refuse</Btn></div></Card>)}
          {!waiting.length && !amends.length && <Empty>Nothing waiting.</Empty>}
        </div>
      )}
    </Sec>
  );
}

function PressControl() {
  const { world: w, me } = useStore();
  const pm = isPM(w, me);
  const ministry = hasPower(w, me, 'detain') || (pm && !Object.values(w.offices).some((o: any) => o.powers.includes('detain') && o.holder));
  const held = w.questions.filter((q: any) => q.status === 'held');
  return (
    <Sec title="Press and Information" sub="Newspapers publish only under licence. Questions are published only with the Prime Minister’s approval. Stories and speeches can be removed from their own pages.">
      <ul class="list">{Object.values(w.papers).map((p: any) => (
        <li class="row"><span><b>{p.name}</b><div class="small muted">{p.licence === 'granted' ? 'Licensed' : p.licence === 'pending' ? <>Licence pending{p.licenceDue ? <>, lapses <When at={p.licenceDue} /></> : ''}</> : 'No licence'}</div></span>
          {ministry && <span class="row" style={{ gap: 6 }}>{p.licence !== 'granted' && <Btn small onClick={() => act('press.licence', { paper: p.id, grant: true }, 'Licensed.')}>Grant</Btn>}{p.licence !== 'withdrawn' && <Btn small kind="plain" onClick={() => act('press.licence', { paper: p.id, grant: false }, 'Withdrawn.')}>Withdraw</Btn>}</span>}</li>
      ))}</ul>
      {!Object.keys(w.papers).length && <Empty>There are no newspapers.</Empty>}
      {(pm || hasPower(w, me, 'govern')) && held.length > 0 && (
        <div class="stack" style={{ marginTop: 10 }}>
          <div class="small" style={{ fontWeight: 700 }}>Questions waiting for your approval</div>
          {held.map((q: any) => <Card><p style={{ margin: 0 }}>“{q.text}”</p><div class="small muted">{nm(w, q.by)}{q.formal ? `, formally to ${nm(w, q.to)}` : ', at PMQs'}</div><div class="grid2" style={{ marginTop: 8 }}><Btn small onClick={() => act('q.approve', { id: q.id, yes: true }, 'Published.')}>Publish</Btn><Btn small kind="plain" onClick={() => act('q.approve', { id: q.id, yes: false }, 'Refused.')}>Refuse</Btn></div></Card>)}
        </div>
      )}
    </Sec>
  );
}
