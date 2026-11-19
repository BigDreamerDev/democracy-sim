// The empire: the Imperial Prerogative Act (draft it in one tap, or proclaim it by decree), and the Imperial High
// Commission's desk: tribute and governors for the provinces, and protectorates abroad. Rules in engine/empire.ts.
import { useState } from 'preact/hooks';
import { useStore, act } from '../store';
import { Sec, Card, Btn, Who, Pick } from '../ui';
import { isPM, inForce, allCitizens, hasPower, imperial } from '../../../engine/index';
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
                  {w.offices.army && <Btn small kind="ghost" onClick={() => act('army.garrison', { province: id, on: !p.garrison }, p.garrison ? 'Garrison withdrawn.' : 'Garrison posted.')}>{p.garrison ? 'Withdraw garrison' : 'Garrison'}</Btn>}
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
