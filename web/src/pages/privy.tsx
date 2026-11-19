// The Imperial Privy Council: the chamber that replaces Parliament under the Imperial Prerogative Act.
// Eight seats round a table, the Orders in Council before it, and the Sovereign's appointments. Rules in engine/privy.ts.
import { useState } from 'preact/hooks';
import { useStore, act } from '../store';
import { Page, Sec, Card, Btn, Who, Pick, When } from '../ui';
import { isHOS, hasPower, allCitizens, majority } from '../../../engine/index';
import { OathPanel } from './oath';
import { council, SEAT_NAMES, PRIVY_SEATS, canForce, canVeto } from '../../../engine/privy';

const NUMERALS = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII'];
const LIVE = ['debate', 'vote', 'assent', 'override', 'withheld'];

export function PrivyCouncil() {
  const { world: w, me } = useStore();
  const [pick, setPick] = useState<Record<number, string>>({});
  const seats = council(w);
  const sovereign = isHOS(w, me);
  const places = (id: string) => seats.filter((s) => s === id).length;
  const people = allCitizens(w).filter((c: any) => !c.bot && !c.defected).map((c: any) => [c.id, c.name] as [string, string]);
  const orders = (Object.values(w.proposals) as any[]).filter((p) => LIVE.includes(p.stage)).sort((a, b) => b.n - a.n);
  const chamberlain = hasPower(w, me, 'chamberlain');
  const seal = hasPower(w, me, 'seal');
  const officeOf = (tpl: string) => Object.values(w.offices).find((o: any) => o.template === tpl) as any;
  const seatOffice: any[] = [null, null, w.offices.army || null, officeOf('chamberlain'), officeOf('privyseal')];
  const force = canForce(w, me);
  const veto = canVeto(w, me);
  const prerogatives = [
    ['Force an Order through', 'The Sovereign and the High Commissioner can make a pending Order law at once, without a vote.'],
    ['Veto an Order', 'The Sovereign, the High Commissioner, the Lord Chamberlain and the Lord Privy Seal can each strike a pending Order. It falls.'],
    ['Summon the Council', 'The Lord Chamberlain sends an Order in debate to the vote within the hour, once a day.'],
    ['Set the Seal', 'The Lord Privy Seal makes a passed Order take effect within the hour.']
  ];
  return (
    <Page kicker={`${w.config.realmName} · In Council`} title="The Imperial Privy Council" intro={<>Parliament is dissolved. Eight sit at the Council table in its place, and its Orders are the law of the empire. An Order needs {majority(w)} of {PRIVY_SEATS}. There are no elections while the Council sits. One person may hold several places, with a vote for each.</>}>
      <Sec id="table">
        <div class="privy-table" role="list">
          <div class="privy-board" aria-hidden="true"><span class="privy-crest">✠</span><span>In Council</span><small>Since <When at={w.privy.since} /></small></div>
          {seats.map((id, i) => (
            <div class={'privy-seat s' + i + (id === me ? ' me' : '') + (id ? '' : ' empty')} role="listitem">
              <span class="privy-num">{NUMERALS[i]}</span>
              <span class="privy-role">{i === 0 ? (w.config.hosTitle ? `The ${w.config.hosTitle}` : SEAT_NAMES[0]) : SEAT_NAMES[i]}</span>
              <b class="privy-name">{id ? <Who id={id} /> : 'Vacant'}</b>
              {id && places(id) > 1 && <span class="privy-multi">{places(id)} places · {places(id)} votes</span>}
            </div>
          ))}
        </div>
      </Sec>
      <OathPanel />
      <Sec title="The great officers’ prerogatives">
        <div class="privy-powers">{prerogatives.map(([t, d]) => <div><b>{t}</b><span class="small muted">{d}</span></div>)}</div>
      </Sec>
      {sovereign && (
        <Sec title="Your appointments" sub="The Sovereign chooses the three Privy Councillors, the Lord Chamberlain and the Lord Privy Seal. The High Commissioner and the General sit by right of office.">
          <Card><div class="stack">
            {[5, 6, 7].map((i) => (
              <div class="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'end' }}>
                <span style={{ minWidth: 150 }}><span class="small muted">Privy Councillor {NUMERALS[i]}</span><br /><b>{seats[i] ? <Who id={seats[i]} /> : 'Vacant'}</b></span>
                <Pick value={pick[i] || ''} onChange={(v) => setPick({ ...pick, [i]: v })} empty={seats[i] ? 'Dismiss them' : 'Choose…'} options={people} />
                {(pick[i] || seats[i]) && <Btn small kind="ghost" onClick={() => act('privy.appoint', { seat: i - 5, target: pick[i] || null }, pick[i] ? 'Sworn of the Council.' : 'Dismissed.')}>{pick[i] ? 'Swear in' : 'Dismiss'}</Btn>}
              </div>
            ))}
            {[2, 3, 4].map((i) => seatOffice[i] && (
              <div class="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'end' }}>
                <span style={{ minWidth: 150 }}><span class="small muted">{SEAT_NAMES[i]}</span><br /><b>{seatOffice[i].holder ? <Who id={seatOffice[i].holder} /> : 'Vacant'}</b></span>
                <Pick value={pick[i] || ''} onChange={(v) => setPick({ ...pick, [i]: v })} empty="Leave vacant" options={people} />
                <Btn small kind="ghost" onClick={() => act('gov.appoint', { office: seatOffice[i].id, target: pick[i] || null }, 'Appointed.')}>Appoint</Btn>
              </div>
            ))}
          </div></Card>
        </Sec>
      )}
      <Sec title="Orders in Council" sub={seats.includes(me) ? <>You sit on the Council: <a href="#/new">lay an Order before it</a>.</> : 'Only members of the Council lay Orders and vote on them.'}>
        {orders.length ? <ul class="list">{orders.map((p) => (
          <li class="row" style={{ flexWrap: 'wrap', gap: 6 }}>
            <a href={'#/p/' + p.id} style={{ color: 'inherit', textDecoration: 'none' }}><b>{p.title}</b><div class="small muted">{p.stage === 'debate' ? 'In debate' : p.stage === 'vote' ? 'The Council votes' : p.stage === 'assent' ? (p.sealed ? 'Sealed, awaiting assent' : 'Awaiting assent') : p.stage === 'withheld' ? 'Assent withheld' : p.stage}</div></a>
            <span class="row" style={{ gap: 6 }}>
              {chamberlain && p.stage === 'debate' && <Btn small kind="ghost" onClick={() => act('privy.summon', { prop: p.id }, 'The Council is summoned.')}>Summon the Council</Btn>}
              {seal && p.stage === 'assent' && !p.sealed && <Btn small kind="ghost" onClick={() => act('privy.seal', { prop: p.id }, 'The Seal is set.')}>Set the Seal</Btn>}
              {force && p.kind === 'bill' && <Btn small onClick={() => confirm(`Force “${p.title}” through? It becomes law at once, without a vote.`) && act('privy.force', { prop: p.id }, 'Forced through. It is law.')}>Force it through</Btn>}
              {veto && p.kind === 'bill' && <Btn small kind="danger ghost" onClick={() => confirm(`Veto “${p.title}”? It falls.`) && act('privy.veto', { prop: p.id }, 'Vetoed.')}>Veto</Btn>}
            </span>
          </li>
        ))}</ul> : <Card kind="dashed">No Order is before the Council.</Card>}
      </Sec>
    </Page>
  );
}
