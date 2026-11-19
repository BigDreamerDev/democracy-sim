// The empire: the Imperial Prerogative Act (draft it in one tap, or proclaim it by decree), and the Imperial High
// Commission's desk: tribute and governors for the provinces, and protectorates abroad. Rules in engine/empire.ts.
import { useState } from 'preact/hooks';
import { useStore, act } from '../store';
import { Sec, Card, Btn, Who, Pick, Field } from '../ui';
import { hasArmy, isPM, inForce, allCitizens, hasPower, imperial, bal } from '../../../engine/index';
import { COMPANIES } from '../../../engine/exchange';
import { CHEST, CONTROL, REQUISITION_CAP, WAR_USE, ORDERS, PROCUREMENT, canDirect, canProcure } from '../../../engine/warmachine';
import { PROVINCES, MOODS } from '../../../engine/foreign';
import { ACTS } from '../../../engine/acts';
import { highCommission, canGovernEmpire, LEVY, GOVERNOR_PAY, PROTECTORATE_TRIBUTE } from '../../../engine/empire';

export function EmpirePanel({ compact }: { compact?: boolean }) {
  const { world: w, me } = useStore();
  const [gov, setGov] = useState<Record<string, string>>({});
  const law = w.acts?.imperial;
  const hc = highCommission(w);
  const can = canGovernEmpire(w, me) && (!!hc || !!law);
  const monarchy = w.config.hos === 'monarchy';
  const decree = isPM(w, me) && !!w.acts?.decrees;
  if (!law && !hc && compact) return null;
  const provinces = Object.entries(w.provinces || {}).filter(([, p]: any) => p.owner === 'realm') as [string, any][];
  const protect = (Object.values(w.nations) as any[]).filter((n) => n.protectorate);
  const friends = (Object.values(w.nations) as any[]).filter((n) => !n.protectorate && n.mood >= 3 && w.army?.war !== n.id && !n.ruler);
  const people = allCitizens(w).filter((c: any) => !c.bot && !c.defected).map((c: any) => [c.id, c.name] as [string, string]);
  return (
    <Sec title={law ? `The ${w.config.realmName}` : 'The Imperial Prerogative'} sub={law ? <>Under {law}. {hc ? <>The {hc.title}: <Who id={hc.holder} />.</> : 'No High Commission yet.'}</> : ACTS.imperial.text}>
      {!law && (
        <Card kind="tint"><div class="stack">
          {!monarchy ? <span class="small">An empire needs a monarch: the head of state must be a monarch first.</span> : (
            <>
              <span class="small">{imperial(w) ? `The realm is already called an empire, but the Act is not law: the ${w.config.hosTitle} is not yet ${/king/i.test(w.config.hosTitle) ? 'Emperor' : 'Empress'}, and there are no protectorates.` : 'Make the realm an empire.'} One clause does it all.</span>
              <div class="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                {decree && <Btn onClick={() => confirm('Proclaim the empire by decree? It becomes law at once.') && act('gov.decree', { title: 'The Imperial Prerogative Decree', summary: 'Proclaims the empire.', clauses: [{ t: 'imperial' }] }, 'The empire is proclaimed.')}>Proclaim it by decree</Btn>}
                <Btn kind={decree ? 'ghost' : undefined} href="#/new?act=imperial">Draft the Imperial Prerogative Bill</Btn>
              </div>
              {w.citizens[me]?.admin && <span class="small muted">Returning Officer: if the realm already passed a decree or bill meant to do this, link it to the Imperial Prerogative Act from that bill’s page instead.</span>}
            </>
          )}
        </div></Card>
      )}
      {(law || hc) && (
        <div class="stack">
          <Card><div class="stack">
            <b>Provinces</b>
            <span class="small muted">A levy brings {LEVY} crowns a week and unrest. A governor is paid {GOVERNOR_PAY} a week and halves the chance a conquered province rises. A garrison stops it rising at all.</span>
            {provinces.length ? <ul class="list">{provinces.map(([id, p]) => (
              <li class="row" style={{ flexWrap: 'wrap', gap: 6 }}>
                <span><b>{PROVINCES[id]?.name}</b><div class="small muted">{p.levy ? 'Levied' : 'No levy'} · {p.governor ? <>Governor <Who id={p.governor} /></> : 'no governor'} · {p.garrison ? 'garrisoned' : 'no garrison'}</div></span>
                {can && <span class="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                  <Btn small kind={p.levy ? 'plain' : 'ghost'} onClick={() => act('imperial.levy', { province: id, on: !p.levy }, p.levy ? 'Levy lifted.' : 'Tribute levied.')}>{p.levy ? 'Lift the levy' : 'Levy tribute'}</Btn>
                  <Pick value={gov[id] || ''} onChange={(v) => setGov({ ...gov, [id]: v })} empty={p.governor ? 'Recall the governor' : 'Choose a governor'} options={people} />
                  <Btn small kind="ghost" onClick={() => act('imperial.governor', { province: id, target: gov[id] || null }, gov[id] ? 'Governor appointed.' : 'Governor recalled.')}>{gov[id] ? 'Appoint' : p.governor ? 'Recall' : 'Appoint'}</Btn>
                  {hasArmy(w) && <Btn small kind="ghost" onClick={() => act('army.garrison', { province: id, on: !p.garrison }, p.garrison ? 'Garrison withdrawn.' : 'Garrison posted.')}>{p.garrison ? 'Withdraw garrison' : 'Garrison'}</Btn>}
                </span>}
              </li>
            ))}</ul> : <span class="small">The empire holds no provinces beyond the realm. Win them in war, or by a peace.</span>}
          </div></Card>
          {law && (
            <Card><div class="stack">
              <b>Protectorates</b>
              <span class="small muted">A friendly nation under the empire’s protection pays {PROTECTORATE_TRIBUTE} crowns a week and fights beside us, but chafes, and breaks away if it stops liking us.</span>
              {protect.length > 0 && <ul class="list">{protect.map((n) => <li class="row"><span><b>{n.name}</b><div class="small muted">{MOODS[n.mood]}</div></span>{can && <Btn small kind="plain" onClick={() => confirm(`Release ${n.name}?`) && act('imperial.release', { nation: n.id }, 'Released.')}>Release</Btn>}</li>)}</ul>}
              {can && friends.length > 0 && <div class="row" style={{ gap: 6, flexWrap: 'wrap' }}>{friends.map((n) => <Btn small kind="ghost" onClick={() => act('imperial.protectorate', { nation: n.id }, 'The offer is made.')}>Offer protection to {n.name}</Btn>)}</div>}
              {!protect.length && !friends.length && <span class="small">No nation is friendly enough to accept protection.</span>}
            </div></Card>
          )}
          {!can && <p class="small muted">The {hc?.title || 'Imperial High Commissioner'} governs the empire{!hc?.holder ? ', and with nobody in the post, the Prime Minister does' : ''}.</p>}
        </div>
      )}
    </Sec>
  );
}

// The war machine: the war chest, its shares and companies, and the Army's equipment. Rules in engine/warmachine.ts.
export function WarMachine() {
  const { world: w, me } = useStore();
  const [req, setReq] = useState('50');
  const [fort, setFort] = useState('');
  if (!hasArmy(w)) return null;
  const direct = canDirect(w, me);
  const procure = canProcure(w, me);
  const chest = bal(w, CHEST);
  const holds = w.exchange?.holdings?.warchest || {};
  const firms = w.warchest?.firms || {};
  const k = w.army?.kit || {};
  const ours = Object.entries(w.provinces || {}).filter(([, p]: any) => p.owner === 'realm') as [string, any][];
  const left = REQUISITION_CAP - (w.warchest?.drawnWeek === Math.floor(w.now / (7 * 86400000)) ? w.warchest.drawn || 0 : 0);
  return (
    <>
      <Sec title="The war chest" sub={<>{inForce(w, 'imperial') ? 'The empire’s levies and tribute are paid into it.' : 'Money set aside for the Army.'} Equipment is paid from it first, then from the Treasury.</>}>
        <div class="grid2">
          <Card><div class="kicker" style={{ margin: 0 }}>In the chest</div><div class="serif tnum" style={{ fontSize: 34 }}>{chest}</div>
            <div class="small muted">Shares worth {Object.entries(holds).reduce((s: number, [sym, h]: any) => s + Math.floor(h.n * (w.exchange?.prices?.[sym]?.p || 0)), 0)}. {Object.keys(firms).length} compan{Object.keys(firms).length === 1 ? 'y' : 'ies'} under its control.</div></Card>
          {direct ? <Card><b>Requisition</b><p class="small" style={{ margin: '4px 0 8px' }}>Draw on the Treasury: {left} of {REQUISITION_CAP} left this week.</p>
            <div class="stack" style={{ gap: 6 }}><Field label="Crowns" type="number" value={req} onInput={setReq} /><span class="row" style={{ gap: 6, justifyContent: 'flex-start' }}><Btn small onClick={() => act('imperial.requisition', { crowns: Number(req) }, 'Requisitioned.')}>Draw</Btn><Btn small kind="ghost" onClick={() => act('imperial.repay', { crowns: Number(req) }, 'Returned to the Treasury.')}>Give back</Btn></span></div></Card>
            : <Card kind="dashed"><span class="small">The {highCommission(w)?.title || 'Imperial High Commissioner'} runs the war chest{highCommission(w)?.holder ? '' : ' (the Prime Minister, while the post is empty)'}.</span></Card>}
        </div>
      </Sec>
      <Sec title="Companies and acquisitions" sub={`The war chest can trade the ten companies on the Exchange. ${CONTROL} shares gives control: a director’s order turns a company to war production or requisitions its profits.`}>
        <ul class="list">{COMPANIES.map((c) => {
          const h = holds[c.sym]?.n || 0;
          const f = firms[c.sym];
          const p = w.exchange?.prices?.[c.sym]?.p ?? c.base;
          const u = WAR_USE[c.sym];
          return (
            <li class="stack" style={{ gap: 6 }}>
              <div class="row" style={{ flexWrap: 'wrap' }}><span><b>{c.sym}</b> {c.name}{f && <span class="chip teal" style={{ marginLeft: 6 }}>Controlled · {f.order === 'war' ? 'war production' : f.order}</span>}<div class="small muted">{u ? `${u.label}: ${u.what}` : c.about}</div></span><span class="tnum">{Number(p).toFixed(2)}{h ? <span class="small muted"> · holds {h}</span> : null}</span></div>
              {direct && <div class="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                {!f && <Btn small onClick={() => confirm(`Acquire a controlling stake in ${c.name} for about ${Math.ceil(Math.max(0, CONTROL - h) * p * 1.2)} from the war chest?`) && act('imperial.acquire', { sym: c.sym }, 'Acquired.')}>Acquire</Btn>}
                <Btn small kind="ghost" onClick={() => act('imperial.trade', { sym: c.sym, n: 5, sell: false }, 'Bought.')}>Buy 5</Btn>
                {h > 0 && <Btn small kind="ghost" onClick={() => act('imperial.trade', { sym: c.sym, n: Math.min(5, h), sell: true }, 'Sold.')}>Sell {Math.min(5, h)}</Btn>}
                {f && Object.keys(ORDERS).filter((o) => o !== f.order).map((o) => <Btn small kind="plain" onClick={() => act('imperial.direct', { sym: c.sym, order: o }, 'Order given.')}>{o === 'war' ? 'War production' : o === 'requisition' ? 'Requisition' : 'Dividends'}</Btn>)}
              </div>}
            </li>
          );
        })}</ul>
      </Sec>
      <Sec title="Military acquisitions" sub="Equipment for the Army, paid from the war chest if it can, else the Treasury, with weekly upkeep.">
        <div class="grid2">{Object.entries(PROCUREMENT).filter(([id]) => id !== 'fort').map(([id, p]) => (
          <Card><div class="row"><b>{p.name}</b><span class="tnum">{k[id] || 0}/{p.max}</span></div>
            <p class="small" style={{ margin: '4px 0 8px' }}>{p.what} {p.cost} crowns, {p.upkeep} a week.</p>
            {procure && <div class="row" style={{ gap: 6 }}><Btn small disabled={(k[id] || 0) >= p.max} onClick={() => act('army.procure', { item: id }, 'Acquired for the Army.')}>Buy</Btn>{(k[id] || 0) > 0 && <Btn small kind="plain" onClick={() => confirm(`Stand down one ${p.name.toLowerCase()}?`) && act('army.scrap', { item: id }, 'Stood down.')}>Scrap one</Btn>}</div>}
          </Card>
        ))}
          <Card><div class="row"><b>Forts</b><span class="tnum">{ours.filter(([, p]) => p.fort).length}/{ours.length}</span></div>
            <p class="small" style={{ margin: '4px 0 8px' }}>{PROCUREMENT.fort.what} {PROCUREMENT.fort.cost} crowns, {PROCUREMENT.fort.upkeep} a week.</p>
            {ours.length ? procure && <div class="row" style={{ gap: 6, flexWrap: 'wrap' }}><Pick value={fort} onChange={setFort} empty="Choose a province" options={ours.filter(([, p]) => !p.fort).map(([id]) => [id, PROVINCES[id]?.name || id])} /><Btn small disabled={!fort} onClick={() => act('army.procure', { item: 'fort', province: fort }, 'The fort is built.')}>Build</Btn></div> : <span class="small muted">We hold no provinces beyond the realm.</span>}
          </Card>
        </div>
      </Sec>
    </>
  );
}
