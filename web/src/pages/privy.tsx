// The Imperial Privy Council: the chamber that replaces Parliament under the Imperial Prerogative Act.
// Seven seats round a table, the Orders in Council before it, and the Sovereign's appointments. Rules in engine/privy.ts.
import { useState } from 'preact/hooks';
import { useStore, act } from '../store';
import { Page, Sec, Card, Btn, Who, Pick, When } from '../ui';
import { isHOS, hasPower, allCitizens, majority } from '../../../engine/index';
import { council, SEAT_NAMES } from '../../../engine/privy';

const NUMERALS = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'];
const LIVE = ['debate', 'vote', 'assent', 'passed', 'hos', 'override'];

export function PrivyCouncil() {
  const { world: w, me } = useStore();
  const [pick, setPick] = useState<Record<number, string>>({});
  const seats = council(w);
  const sovereign = isHOS(w, me);
  const people = allCitizens(w).filter((c: any) => !c.bot && !c.defected && !seats.includes(c.id)).map((c: any) => [c.id, c.name] as [string, string]);
  const orders = (Object.values(w.proposals) as any[]).filter((p) => LIVE.includes(p.stage)).sort((a, b) => b.n - a.n);
  const chamberlain = hasPower(w, me, 'chamberlain');
  const seal = hasPower(w, me, 'seal');
  const officeOf = (tpl: string) => Object.values(w.offices).find((o: any) => o.template === tpl) as any;
  const seatOffice = [null, null, officeOf('chamberlain'), officeOf('privyseal')];
  return (
    <Page kicker={`${w.config.realmName} · In Council`} title="The Imperial Privy Council" intro={<>Parliament is dissolved. Seven sit at the Council table in its place, and its Orders are the law of the empire. An Order needs {majority(w)} of 7. There are no elections while the Council sits.</>}>
      <Sec id="table">
        <div class="privy-table" role="list">
          <div class="privy-board" aria-hidden="true"><span class="privy-crest">✠</span><span>In Council</span><small>Since <When at={w.privy.since} /></small></div>
          {seats.map((id, i) => (
            <div class={'privy-seat s' + i + (id === me ? ' me' : '') + (id ? '' : ' empty')} role="listitem">
              <span class="privy-num">{NUMERALS[i]}</span>
              <span class="privy-role">{i === 0 ? (w.config.hosTitle ? `The ${w.config.hosTitle}` : SEAT_NAMES[0]) : SEAT_NAMES[i]}</span>
              <b class="privy-name">{id ? <Who id={id} /> : 'Vacant'}</b>
            </div>
          ))}
        </div>
      </Sec>
      {sovereign && (
        <Sec title="Your appointments" sub="The Sovereign chooses the three Privy Councillors, the Lord Chamberlain and the Lord Privy Seal. The High Commissioner sits by right of office.">
          <Card><div class="stack">
            {[4, 5, 6].map((i) => (
              <div class="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'end' }}>
                <span style={{ minWidth: 150 }}><span class="small muted">Privy Councillor {NUMERALS[i]}</span><br /><b>{seats[i] ? <Who id={seats[i]} /> : 'Vacant'}</b></span>
                <Pick value={pick[i] || ''} onChange={(v) => setPick({ ...pick, [i]: v })} empty={seats[i] ? 'Dismiss them' : 'Choose…'} options={people} />
                {(pick[i] || seats[i]) && <Btn small kind="ghost" onClick={() => act('privy.appoint', { seat: i - 4, target: pick[i] || null }, pick[i] ? 'Sworn of the Council.' : 'Dismissed.')}>{pick[i] ? 'Swear in' : 'Dismiss'}</Btn>}
              </div>
            ))}
            {[2, 3].map((i) => seatOffice[i] && (
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
            <a href={'#/p/' + p.id} style={{ color: 'inherit', textDecoration: 'none' }}><b>{p.title}</b><div class="small muted">{p.stage === 'debate' ? 'In debate' : p.stage === 'vote' ? 'The Council votes' : p.stage === 'assent' ? (p.sealed ? 'Sealed, awaiting assent' : 'Awaiting assent') : p.stage}</div></a>
            <span class="row" style={{ gap: 6 }}>
              {chamberlain && p.stage === 'debate' && <Btn small kind="ghost" onClick={() => act('privy.summon', { prop: p.id }, 'The Council is summoned.')}>Summon the Council</Btn>}
              {seal && p.stage === 'assent' && !p.sealed && <Btn small kind="ghost" onClick={() => act('privy.seal', { prop: p.id }, 'The Seal is set.')}>Set the Seal</Btn>}
            </span>
          </li>
        ))}</ul> : <Card kind="dashed">No Order is before the Council.</Card>}
      </Sec>
    </Page>
  );
}
