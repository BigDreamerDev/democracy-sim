// The world map (#/atlas) and the war room (#/war). The map is drawn here from fixed geography: a continent split
// between the realm and its neighbours, the Orrin Isles to the west and the Free City of Aurel on its lagoon to the
// south. Colours follow each nation's mood; lines show treaties, wars and wars abroad. Every country links to its page.
import { useState } from 'preact/hooks';
import { useStore, act } from '../store';
import { Page, Sec, Card, Btn, Who, Left, When, Empty, Field, Seg, Opt } from '../ui';
import { isPM, hasPower, holderOf, standing, bal, ca } from '../../../engine/index';
import { MOODS, PROFILES, TREATIES } from '../../../engine/foreign';
import { power, STRATEGIES, REGIMENT_COST, MAX_REGIMENTS, BOND_PAYS, allies } from '../../../engine/war';

type Pt = [number, number];
const W = 1000;
const H = 660;
// where each country's heart is: its capital sits here and the borders are drawn between these points
const SITES: Record<string, Pt> = { realm: [470, 330], varnholm: [255, 215], sundmere: [500, 118], drakmoor: [815, 150], kessmark: [770, 365], tessaly: [640, 515] };
const ISLES: { at: Pt; rx: number; ry: number; seed: number }[] = [{ at: [92, 430], rx: 46, ry: 70, seed: 3 }, { at: [150, 548], rx: 40, ry: 30, seed: 7 }, { at: [62, 560], rx: 18, ry: 14, seed: 11 }];
const AUREL: Pt = [420, 612];
const CAP: Record<string, Pt> = { orrin: [104, 440], aurel: AUREL };
const LABEL: Record<string, Pt> = { orrin: [118, 382], aurel: [500, 606] };
const moodFill = ['var(--red)', 'var(--amber)', 'var(--soft)', 'var(--teal)', 'var(--teal)'];
const moodAlpha = [0.32, 0.26, 1, 0.18, 0.34];

// a wobbly closed outline: an ellipse roughed up with a few sine waves, so it reads as a coastline
function blob(cx: number, cy: number, rx: number, ry: number, seed: number, n = 140): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const t = (i / n) * Math.PI * 2;
    const r = 1 + 0.07 * Math.sin(3 * t + seed) + 0.05 * Math.sin(7 * t + seed * 2.3) + 0.025 * Math.sin(17 * t + seed * 0.7) + 0.012 * Math.sin(31 * t + seed);
    out.push([cx + Math.cos(t) * rx * r, cy + Math.sin(t) * ry * r]);
  }
  return out;
}
// keep the part of a polygon nearer to a than to b (one cut of a Voronoi cell)
function clip(poly: Pt[], a: Pt, b: Pt): Pt[] {
  const m: Pt = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const d: Pt = [b[0] - a[0], b[1] - a[1]];
  const side = (p: Pt) => (p[0] - m[0]) * d[0] + (p[1] - m[1]) * d[1];
  const out: Pt[] = [];
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    const sp = side(p);
    const sq = side(q);
    if (sp <= 0) out.push(p);
    if ((sp <= 0) !== (sq <= 0)) {
      const t = sp / (sp - sq);
      out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]);
    }
  }
  return out;
}
const path = (pts: Pt[]) => 'M' + pts.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join('L') + 'Z';
const CONTINENT = blob(560, 330, 420, 245, 1.7);
const CELLS: Record<string, Pt[]> = Object.fromEntries(Object.keys(SITES).map((k) => [k, Object.keys(SITES).reduce((poly, o) => (o === k ? poly : clip(poly, SITES[k], SITES[o])), CONTINENT)]));
const capital = (id: string): Pt => CAP[id] || SITES[id] || SITES.realm;
const arc = (a: Pt, b: Pt, bend = 0.18) => {
  const mx = (a[0] + b[0]) / 2 - (b[1] - a[1]) * bend;
  const my = (a[1] + b[1]) / 2 + (b[0] - a[0]) * bend;
  return { d: `M${a[0]},${a[1]} Q${mx},${my} ${b[0]},${b[1]}`, mid: [(a[0] + 2 * mx + b[0]) / 4, (a[1] + 2 * my + b[1]) / 4] as Pt };
};

function Swords({ at, size = 22 }: { at: Pt; size?: number }) {
  const s = size / 2;
  return (
    <g transform={`translate(${at[0]},${at[1]})`} class="atlas-swords" aria-hidden="true">
      <circle r={s + 5} />
      <path d={`M${-s},${-s} L${s},${s} M${s},${-s} L${-s},${s} M${-s + 3},${-s + 9} L${-s + 9},${-s + 3} M${s - 3},${-s + 9} L${s - 9},${-s + 3}`} />
    </g>
  );
}

export function WorldMap({ compact }: { compact?: boolean }) {
  const { world: w } = useStore();
  const [hover, setHover] = useState<string | null>(null);
  const ns = w.nations as Record<string, any>;
  const treaties = Object.values(w.treaties).filter((t: any) => t.status === 'active') as any[];
  const conflicts = (w.conflicts || []).filter((c: any) => c.status === 'raging');
  const enemy = w.army?.war;
  const fillOf = (id: string) => (ns[id] ? moodFill[ns[id].mood] : 'var(--soft)');
  const alphaOf = (id: string) => (ns[id] ? moodAlpha[ns[id].mood] : 1);
  const hatched = (id: string) => ns[id] && (ns[id].embargo || (ns[id].sanctionsUntil && ns[id].sanctionsUntil > w.now));
  const nation = (id: string, shape: any) => (
    <a href={'#/nation/' + id} class={'atlas-land' + (hover === id ? ' on' : '')} onMouseEnter={() => setHover(id)} onMouseLeave={() => setHover(null)} aria-label={`${ns[id]?.name}: ${MOODS[ns[id]?.mood]}`}>
      {shape(fillOf(id), alphaOf(id))}
      {hatched(id) && shape('url(#atlas-hatch)', 1)}
    </a>
  );
  const name = (id: string) => ns[id]?.name.replace('Commonwealth of ', '').replace('Free City of ', '') ?? id;
  return (
    <figure class={'atlas' + (compact ? ' compact' : '')}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Map of the realm and the nations abroad">
        <defs>
          <pattern id="atlas-waves" width="36" height="18" patternUnits="userSpaceOnUse"><path d="M0 12 Q9 6 18 12 T36 12" class="atlas-wave" /></pattern>
          <pattern id="atlas-hatch" width="9" height="9" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="9" class="atlas-hatchline" /></pattern>
          <pattern id="atlas-realm" width="12" height="12" patternUnits="userSpaceOnUse"><circle cx="6" cy="6" r="1.3" class="atlas-dot" /></pattern>
        </defs>
        <rect width={W} height={H} class="atlas-sea" />
        <rect width={W} height={H} fill="url(#atlas-waves)" />
        {/* the coast, drawn twice for an inked edge */}
        <path d={path(CONTINENT)} class="atlas-coast-halo" />
        {Object.keys(SITES).filter((k) => k !== 'realm').map((id) => nation(id, (f: string, a: number) => <path d={path(CELLS[id])} fill={f} fill-opacity={a} class="atlas-cell" />))}
        <path d={path(CELLS.realm)} class="atlas-realm" />
        <path d={path(CELLS.realm)} fill="url(#atlas-realm)" class="atlas-cell" />
        {ISLES.map((i) => nation('orrin', (f: string, a: number) => <path d={path(blob(i.at[0], i.at[1], i.rx, i.ry, i.seed, 60))} fill={f} fill-opacity={a} class="atlas-cell isle" />))}
        {nation('aurel', (f: string, a: number) => <path d={path(blob(AUREL[0], AUREL[1], 30, 20, 5, 50))} fill={f} fill-opacity={a} class="atlas-cell isle" />)}
        <path d={path(CONTINENT)} class="atlas-coast" />
        {/* the great river, through Kessmark to the southern sea */}
        <path d="M700 92 C690 150 720 190 700 240 S668 330 690 380 S730 470 700 560" class="atlas-river" />
        <text x="712" y="210" class="atlas-sea-label small" transform="rotate(78 712 210)">the Kess</text>
        <text x="40" y="150" class="atlas-sea-label">The Grey Sea</text>
        <text x="560" y="636" class="atlas-sea-label">Gulf of Aurel</text>
        <text x="300" y="40" class="atlas-sea-label">The Northern Reach</text>
        {/* treaties: lines from our capital */}
        {treaties.filter((t) => ns[t.nation]).map((t) => {
          const a = arc(capital('realm'), capital(t.nation), 0.12);
          return <path d={a.d} class={'atlas-tie' + (t.effect?.alliance || t.effect?.defence ? ' strong' : '')} />;
        })}
        {/* wars abroad */}
        {conflicts.map((c: any) => {
          const a = arc(capital(c.a), capital(c.b), -0.1);
          return <g><path d={a.d} class="atlas-war abroad" /><Swords at={a.mid} size={16} /></g>;
        })}
        {/* our war */}
        {enemy && ns[enemy] && (() => {
          const a = arc(capital('realm'), capital(enemy), 0.06);
          return <g><path d={a.d} class="atlas-war" /><Swords at={a.mid} /></g>;
        })()}
        {/* capitals and names */}
        {Object.keys(ns).map((id) => {
          const c = capital(id);
          const l = LABEL[id] || [c[0], c[1] - 30];
          return (
            <g class="atlas-capital" pointer-events="none">
              <rect x={c[0] - 4} y={c[1] - 4} width="8" height="8" transform={`rotate(45 ${c[0]} ${c[1]})`} />
              <text x={c[0] + 9} y={c[1] + 15} class="atlas-town">{PROFILES[id]?.capital}</text>
              {ns[id].embassy && <path d={`M${c[0] - 12},${c[1] + 2} v-16 l10,4 l-10,4`} class="atlas-flag" />}
              <text x={l[0]} y={l[1]} text-anchor="middle" class="atlas-name">{name(id)}</text>
              <text x={l[0]} y={l[1] + 15} text-anchor="middle" class={'atlas-mood m' + ns[id].mood}>{enemy === id ? 'At war' : MOODS[ns[id].mood]}</text>
            </g>
          );
        })}
        <g class="atlas-capital home" pointer-events="none">
          <circle cx={capital('realm')[0]} cy={capital('realm')[1]} r="9" />
          <circle cx={capital('realm')[0]} cy={capital('realm')[1]} r="3.5" class="core" />
          <text x={capital('realm')[0]} y={capital('realm')[1] - 22} text-anchor="middle" class="atlas-name home">{w.config.realmName || 'The Realm'}</text>
          <text x={capital('realm')[0]} y={capital('realm')[1] + 26} text-anchor="middle" class="atlas-town">The capital</text>
        </g>
        {/* compass */}
        <g transform="translate(930,580)" class="atlas-compass" aria-hidden="true">
          <circle r="30" /><path d="M0 -40 L7 0 L0 40 L-7 0 Z" /><path d="M-40 0 L0 6 L40 0 L0 -6 Z" class="faint" /><text y="-46" text-anchor="middle">N</text>
        </g>
      </svg>
      {!compact && (
        <figcaption class="atlas-key">
          <span><i class="sw" style={{ background: 'var(--teal)', opacity: 0.6 }} /> Friendly or allied</span>
          <span><i class="sw" style={{ background: 'var(--soft)' }} /> Neutral</span>
          <span><i class="sw" style={{ background: 'var(--amber)', opacity: 0.6 }} /> Cold</span>
          <span><i class="sw" style={{ background: 'var(--red)', opacity: 0.6 }} /> Hostile</span>
          <span><i class="sw hatch" /> Sanctions or embargo</span>
          <span><i class="ln strong" /> Alliance or defence pact</span>
          <span><i class="ln" /> Other treaty</span>
          <span><i class="ln war" /> War</span>
        </figcaption>
      )}
    </figure>
  );
}

export function Atlas() {
  const { world: w, me } = useStore();
  const ns = Object.values(w.nations) as any[];
  const conflicts = (w.conflicts || []) as any[];
  const raging = conflicts.filter((c) => c.status === 'raging');
  const canMediate = hasPower(w, me, 'envoy') || (isPM(w, me) && !holderOf(w, 'foreign'));
  return (
    <Page back={['#/world', 'The world']} kicker="Abroad" title="The map" intro={`${ns.length} nations around the realm. Our Standing abroad is ${standing(w)}. Tap a country to open its page.`}>
      <WorldMap />
      <Sec title="Wars abroad" sub="Rivals fight each other. A war abroad unsettles trade; brokering its end makes friends of both sides.">
        <div class="stack">
          {raging.map((c) => (
            <Card kind="warn">
              <div class="row"><b>{w.nations[c.a].name} against {w.nations[c.b].name}</b><span class="small muted">week {c.weeks + 1}</span></div>
              <p class="small" style={{ margin: '4px 0 8px' }}>{c.score === 0 ? 'Neither side is winning.' : `${w.nations[c.score > 0 ? c.a : c.b].name} has the upper hand.`} Both {Math.min(w.nations[c.a].mood, w.nations[c.b].mood) >= 2 ? 'think well enough of us to listen' : 'are wary of us'}.{w.nations[c.a].embassy && w.nations[c.b].embassy ? ' Our embassies in both capitals help.' : ''}</p>
              {c.mediated ? <span class="small muted">We have offered to mediate. They would not hear us twice.</span> : w.offices.foreign ? (canMediate ? <Btn small onClick={() => act('foreign.mediate', { conflict: c.id }, 'Our envoys are at the table.')}>Offer to mediate</Btn> : <span class="small muted">The Foreign Minister can offer to mediate.</span>) : <span class="small muted">Mediation needs a Foreign Office.</span>}
            </Card>
          ))}
          {!raging.length && <Empty>The world is at peace, for now.</Empty>}
          {conflicts.filter((c) => c.status === 'over').slice(0, 4).map((c) => <div class="small muted">{w.nations[c.a]?.name} and {w.nations[c.b]?.name}: {c.peaceBy ? <>peace brokered by <Who id={c.peaceBy} /></> : c.winner ? `${w.nations[c.winner]?.name} won` : 'fought to exhaustion'}.</div>)}
        </div>
      </Sec>
      <Sec title="The nations">
        <div class="atlas-cards">
          {ns.map((n) => {
            const p = PROFILES[n.id];
            return (
              <a class="card atlas-card" href={'#/nation/' + n.id}>
                <div class="row"><b class="serif" style={{ fontSize: 19 }}>{n.name}</b><span class={'chip ' + (n.mood >= 3 ? 'teal' : n.mood <= 1 ? 'red' : 'ink')}>{w.army?.war === n.id ? 'At war' : MOODS[n.mood]}</span></div>
                <div class="small muted">{p?.gov}, ruled from {p?.capital}. {p?.leader}.</div>
                <div class="atlas-stats small"><span>Army <b class="tnum">{Math.round(n.power ?? p?.strength ?? 0)}</b>/10</span><span>Wealth <b class="tnum">{p?.wealth}</b>/10</span><span>{p?.exports}</span></div>
              </a>
            );
          })}
        </div>
      </Sec>
    </Page>
  );
}

// the front: a tug of war from −100 (defeat) to +100 (victory)
function Front({ score }: { score: number }) {
  const at = (score + 100) / 2;
  return (
    <div class="front" role="img" aria-label={`The front stands at ${score}`}>
      <div class="front-bar"><i class="us" style={{ width: `${at}%` }} /><b style={{ left: `${at}%` }} /></div>
      <div class="row small muted"><span>Defeat</span><span class="tnum"><b>{score > 0 ? '+' : ''}{score}</b></span><span>Victory</span></div>
    </div>
  );
}

export function War() {
  const { world: w, me } = useStore();
  const [bond, setBond] = useState('10');
  const [n, setN] = useState('1');
  if (!w.offices.army) return <Page back={['#/world', 'The world']} title="The war room"><Sec><Card kind="dashed">There is no Army, so the realm cannot fight. Pass the Defence Act to raise one. Without it, a hostile nation can only threaten and sanction us.</Card></Sec><Past /></Page>;
  const k = w.army.campaign;
  const cmd = hasPower(w, me, 'army') || isPM(w, me) || hasPower(w, me, 'govern');
  const troops = w.army.troops ?? 6;
  if (!k) {
    return (
      <Page back={['#/world', 'The world']} kicker="At peace" title="The war room" intro={`The Army fields ${troops} regiment${troops === 1 ? '' : 's'}. War is declared by bill, or by a hostile nation.`}>
        {w.army.hero && w.army.hero.until > w.now && <Card kind="tint" style={{ marginTop: 14 }}><b><Who id={w.army.hero.id} /> is a war hero.</b> <span class="small">Until <When at={w.army.hero.until} />, they weigh 4 on a coup night instead of 3.</span></Card>}
        {w.army.defeatedAt && w.now - w.army.defeatedAt < 14 * 86400000 && <Card kind="warn" style={{ marginTop: 14 }}><b>The Army came home beaten.</b> <span class="small">For two weeks after a defeat it leans towards plotters and pretenders.</span></Card>}
        <Regiments cmd={cmd} n={n} setN={setN} troops={troops} />
        <Past />
      </Page>
    );
  }
  const enemy = w.nations[k.nation];
  const p = power(w);
  const mine = k.bonds?.[me] || 0;
  return (
    <Page back={['#/world', 'The world']} kicker={<span style={{ color: 'var(--red)' }}>At war since <When at={k.startedAt} /></span>} title={`War with ${enemy.name}`} intro={<>{k.pretender ? <>They fight to put <Who id={k.pretender} /> on our throne. </> : ''}The next battle is in <Left at={k.nextBattleAt} />. Win at +100; at −100 we are beaten. Parliament can make peace at any time with a bill.</>}>
      <Sec><Front score={k.score} /></Sec>
      <Sec title="The odds" sub={`Each battle we win about ${Math.round(p.odds * 100)} times in 100.`}>
        <div class="grid2">
          <Card><div class="kicker" style={{ margin: 0 }}>Our strength</div><div class="serif tnum" style={{ fontSize: 34 }}>{p.us}</div><ul class="list small">{p.lines.filter((l) => Math.abs(l[1]) >= 0.05).map(([why, v]) => <li class="row"><span>{why}</span><b class="tnum">{v > 0 ? '+' : ''}{Math.round(v * 10) / 10}</b></li>)}</ul></Card>
          <Card><div class="kicker" style={{ margin: 0 }}>{enemy.name}</div><div class="serif tnum" style={{ fontSize: 34 }}>{p.them}</div><ul class="list small"><li class="row"><span>Their army</span><b class="tnum">{Math.round((enemy.power || 0) * 10) / 10}</b></li>{enemy.embargo && <li class="row"><span>Our embargo</span><b>−15%</b></li>}</ul>{!enemy.embargo && <p class="small muted" style={{ margin: '6px 0 0' }}>An embargo would weaken them by 15%.</p>}</Card>
        </div>
        {allies(w).length === 0 && <p class="small muted">No ally fights beside us. A Military Alliance with a friendly nation would.</p>}
      </Sec>
      <Sec title="Strategy" sub={cmd ? 'You command. Change it before the next battle.' : <>Set by <Who id={holderOf(w, 'army') || w.pm} />.</>}>
        <div class="stack">{Object.entries(STRATEGIES).map(([id, s]) => <Opt on={k.strategy === id} onClick={() => cmd && k.strategy !== id && act('war.strategy', { strategy: id }, `Orders sent: ${s.label.toLowerCase()}.`)} title={s.label} hint={s.what} />)}</div>
        {k.strategy === 'advance' && <p class="small" style={{ color: 'var(--red)' }}>On the advance the Army is away from the capital: a coup would find the city undefended.</p>}
      </Sec>
      <Sec title="Do your bit">
        <div class="grid2">
          <Card><b>Volunteer</b><p class="small" style={{ margin: '4px 0 8px' }}>Each volunteer adds half a regiment. +2 Influence, and a Veteran stamp if we win. {k.volunteers.length} so far.</p>{k.volunteers.includes(me) ? <span class="chip teal">You volunteered</span> : <Btn small onClick={() => act('war.enlist', {}, 'You are off to the front.')}>Enlist</Btn>}</Card>
          <Card><b>War bonds</b><p class="small" style={{ margin: '4px 0 8px' }}>Lend the Treasury 5–100. Repaid {BOND_PAYS.victory * 100}% on victory, {BOND_PAYS.peace * 100}% on peace, {BOND_PAYS.defeat * 100}% on defeat. {k.bondTotal || 0} sold.{mine ? ` You hold ${mine}.` : ''}</p><div class="grid2"><Field label="Crowns" type="number" value={bond} onInput={setBond} /><Btn small style={{ alignSelf: 'end' }} onClick={() => act('war.bond', { amount: Number(bond) }, 'Bonds bought. Thank you.')}>Buy</Btn></div><div class="small muted" style={{ marginTop: 4 }}>You have {bal(w, ca(me))}.</div></Card>
        </div>
        {k.volunteers.length > 0 && <p class="small muted">Volunteers: {k.volunteers.map((id: string) => w.citizens[id]?.name).join(', ')}.</p>}
      </Sec>
      <Regiments cmd={cmd} n={n} setN={setN} troops={troops} war />
      <Sec title="Dispatches from the front">
        <ul class="list">{k.battles.map((b: any) => <li class="row"><span><b style={{ color: b.won ? 'var(--teal)' : 'var(--red)' }}>{b.won ? 'Victory' : 'Defeat'}</b> at {b.where}{b.loot ? `, ${b.loot} in spoils` : ''}{b.lost ? ', a regiment lost' : ''}<div class="small muted"><When at={b.at} /> · {b.us} against {b.them}</div></span><b class="tnum" style={{ color: b.delta > 0 ? 'var(--teal)' : 'var(--red)' }}>{b.delta > 0 ? '+' : ''}{b.delta}</b></li>)}</ul>
        {!k.battles.length && <Empty>No battles yet.</Empty>}
      </Sec>
      <Past />
    </Page>
  );
}
function Regiments({ cmd, n, setN, troops, war }: { cmd: boolean; n: string; setN: (v: string) => void; troops: number; war?: boolean }) {
  return (
    <Sec title="Regiments" sub={`${troops} of ${MAX_REGIMENTS}. Each new one costs ${REGIMENT_COST} from the Treasury, and every one over six adds 3 a week to upkeep.`}>
      <div class="regiments" aria-hidden="true">{Array.from({ length: MAX_REGIMENTS }, (_, i) => <i class={i < troops ? 'on' : ''} />)}</div>
      {cmd && <div class="grid2" style={{ marginTop: 10 }}><Field label="Regiments (1–5)" type="number" value={n} onInput={setN} /><div class="row" style={{ alignSelf: 'end', gap: 6 }}><Btn small onClick={() => act('army.recruit', { n: Number(n) }, 'Raised.')}>Raise</Btn>{!war && <Btn small kind="plain" onClick={() => confirm('Disband regiments? The Army will not like it.') && act('army.disband', { n: Number(n) }, 'Disbanded.')}>Disband</Btn>}</div></div>}
    </Sec>
  );
}
function Past() {
  const { world: w } = useStore();
  const wars = (w.wars || []) as any[];
  if (!wars.length) return null;
  return (
    <Sec title="Past wars">
      <ul class="list">{wars.map((x) => <li class="row"><span><b>{w.nations[x.nation]?.name}</b> · {x.won} of {x.battles} battles won<div class="small muted"><When at={x.startedAt} /> to <When at={x.endedAt} />{x.general ? ` · General ${w.citizens[x.general]?.name}` : ''}</div></span><span class={'chip ' + (x.outcome === 'victory' ? 'teal' : x.outcome === 'defeat' ? 'red' : 'ink')}>{x.outcome}</span></li>)}</ul>
    </Sec>
  );
}

// the nation page's diplomacy panel: embassy, embargo, every treaty kind
export function Diplomacy({ id }: { id: string }) {
  const { world: w, me } = useStore();
  const n = w.nations[id];
  const [k, setK] = useState('trade');
  const can = hasPower(w, me, 'envoy') || (isPM(w, me) && !holderOf(w, 'foreign'));
  const asks = w.asks.filter((a: any) => a.nation === id);
  const p = PROFILES[id];
  const ties = Object.values(w.treaties).filter((t: any) => t.nation === id && t.status === 'active') as any[];
  const war = (w.conflicts || []).find((c: any) => c.status === 'raging' && (c.a === id || c.b === id));
  return (
    <>
      {p && (
        <Sec title="The country">
          <div class="atlas-facts">
            <div><span class="small muted">Capital</span><b>{p.capital}</b></div>
            <div><span class="small muted">Government</span><b>{p.gov}</b></div>
            <div><span class="small muted">Ruled by</span><b>{p.leader}</b></div>
            <div><span class="small muted">Army</span><b class="tnum">{Math.round((n.power ?? p.strength) * 10) / 10} / 10</b></div>
            <div><span class="small muted">Wealth</span><b class="tnum">{p.wealth} / 10</b></div>
            <div><span class="small muted">Exports</span><b>{p.exports}</b></div>
          </div>
          <p class="small muted" style={{ fontStyle: 'italic' }}>“{p.motto}”</p>
          {war && <Card kind="warn">At war with {w.nations[war.a === id ? war.b : war.a].name}. <a href="#/atlas">See the map</a>.</Card>}
          {ties.length > 0 && <div class="chips">{ties.map((t) => <span class="chip teal">{t.title.replace(n.name + ' ', '')}</span>)}</div>}
        </Sec>
      )}
      <Sec title="Diplomacy" sub={can ? undefined : 'The Foreign Minister acts here.'}>
        <div class="stack">
          <Btn full onClick={() => act('foreign.envoy', { nation: id }, 'Envoy sent.')}>Send an envoy (once a week)</Btn>
          <p class="small muted" style={{ margin: 0 }}>{n.envoyAt ? <>Last envoy <When at={n.envoyAt} />.</> : 'No envoy sent yet.'}{n.embassy ? ' Our embassy makes envoys likelier to land well.' : ''}</p>
          <div class="grid2">
            <Card><b>Embassy</b><p class="small" style={{ margin: '4px 0 8px' }}>{n.embassy ? `Open in ${p?.capital}. Costs 5 a week; softens a cold nation over time.` : 'Opening one costs 30 from the Treasury and 5 a week. They warm to us at once.'}</p>{w.offices.foreign ? <Btn small kind={n.embassy ? 'plain' : undefined} onClick={() => (n.embassy ? confirm(`Recall our ambassador from ${n.name}? They will take it badly.`) && act('foreign.embassy', { nation: id, open: false }, 'Embassy closed.') : act('foreign.embassy', { nation: id, open: true }, 'Embassy opened.'))}>{n.embassy ? 'Close the embassy' : 'Open an embassy'}</Btn> : <span class="small muted">Needs a Foreign Office.</span>}</Card>
            <Card><b>Embargo</b><p class="small" style={{ margin: '4px 0 8px' }}>{n.embargo ? 'In force: no ventures, their shares cannot be bought, and their army is weaker against us.' : 'Cut trade: they cool, their companies fall, and in a war their army fights 15% weaker.'}</p><Btn small kind={n.embargo ? 'plain' : 'danger ghost'} onClick={() => act('foreign.embargo', { nation: id, on: !n.embargo }, n.embargo ? 'Embargo lifted.' : 'Embargo imposed.')}>{n.embargo ? 'Lift the embargo' : 'Impose an embargo'}</Btn></Card>
          </div>
          <Card>
            <div class="stack">
              <b>Propose a treaty</b>
              {TREATIES.map((t) => <Opt on={k === t.kind} onClick={() => setK(t.kind)} title={t.title} hint={`We give: ${t.give}. We get: ${t.get}.${t.kind === 'alliance' ? ' Only close friends agree.' : ''}`} />)}
              <Btn onClick={() => act('foreign.propose', { nation: id, kind: k }, 'Sent. They answer within a day.')}>Send proposal</Btn>
              {asks.map((a: any) => <div class="small">{a.title}: {a.status === 'sent' ? <>answer in <Left at={a.decideAt} /></> : a.status}</div>)}
            </div>
          </Card>
        </div>
      </Sec>
    </>
  );
}
